// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// @ts-ignore
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// @ts-ignore
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';

interface PartMesh {
  name: string;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  colorRgb: [number, number, number];
}

export interface Viewer {
  setParts(parts: PartMesh[], preserveCamera?: boolean): void;
  setPartColor(name: string, colorHex: string): void;
  setTheme(theme: 'dark' | 'light'): void;
  /** Swap the floor the model stands on: a build plate, or the plain grid. */
  setPlate(choice: PlateChoice): void;
  dispose(): void;
}

export function createViewer(container: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const currentTheme = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
  scene.background = new THREE.Color(currentTheme === 'dark' ? 0x15171c : 0xf3f4f6);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.up.set(0, 0, 1); // Z-up CAD coordinate system
  camera.position.set(70, -70, 70);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(50, -50, 100);
  scene.add(keyLight);
  
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-50, 50, 50);
  scene.add(fillLight);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // The floor: a Bambu build plate (default) or the plain reference grid, with
  // the model resting on its top surface.
  const floorZ = -0.06;
  const buildPlate: BuildPlate = createBuildPlate(THREE, {
    theme: currentTheme,
    topZ: floorZ,
    gridSize: 200,
  });
  buildPlate.setChoice(loadPlateChoice());
  scene.add(buildPlate.object);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.01; // don't go below grid

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  let animationFrameId = 0;
  const animate = () => {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  const handleResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', handleResize);

  function clearGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m: any) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  function parsePartGeometry(p: PartMesh): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.vertProperties, 3));
    geo.setIndex(new THREE.BufferAttribute(p.triVerts, 1));
    
    // Smooth curves, keep sharp corners distinct
    const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
    geo.dispose();
    return creased;
  }

  const meshes = new Map<string, THREE.Mesh>();

  return {
    setParts(parts: PartMesh[], preserveCamera = false) {
      clearGroup(modelGroup);
      meshes.clear();

      for (const p of parts) {
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setRGB(p.colorRgb[0] / 255, p.colorRgb[1] / 255, p.colorRgb[2] / 255, THREE.SRGBColorSpace),
          metalness: 0.1,
          roughness: 0.45,
          side: THREE.DoubleSide,
        });
        
        const geom = parsePartGeometry(p);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = p.name;
        modelGroup.add(mesh);
        meshes.set(p.name, mesh);
      }

      // Re-center assembly
      modelGroup.position.set(0, 0, 0);
      // setFromObject reuses the PARENT's cached world matrix, so the reset above is not
      // visible to it until the matrices are pushed down — otherwise the box is measured
      // in the previous build's frame and the offsets compound.
      modelGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Shift so XY is centered, bottom of the plate sits at Z = 0
      modelGroup.position.set(-center.x, -center.y, -box.min.z);

      if (!preserveCamera) {
        const radius = Math.max(size.x, size.y, size.z) * 1.5 + 20;
        camera.position.set(radius, -radius, radius * 0.9);
        controls.target.set(0, 0, size.z / 2);
        controls.update();
      }
    },

    setPartColor(name: string, colorHex: string) {
      const mesh = meshes.get(name);
      if (mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.color.set(colorHex);
      }
    },

    setTheme(theme: 'dark' | 'light') {
      scene.background = new THREE.Color(theme === 'dark' ? 0x15171c : 0xf3f4f6);
      buildPlate.setTheme(theme);
    },

    setPlate(choice: PlateChoice) {
      buildPlate.setChoice(choice);
    },

    dispose() {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      clearGroup(modelGroup);
      scene.remove(modelGroup);
      buildPlate.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
