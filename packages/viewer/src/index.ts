// The standard Vostok Labs 3D preview, extracted from the magnet generator's
// viewer so a new generator gets a working stage on day one: Z-up CAD frame,
// ACES + room-environment PBR, a build plate under the model, view presets,
// part picking and highlighting, and a PNG grab for cover images.
//
// Existing generators still ship their own viewer (each has app-specific extras
// — section/explode, magnet handles, socket markers). This is the baseline the
// template starts from and the place to grow shared behaviour.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';

export type RGB = [number, number, number];

/** One coloured body of the model — the shape a manifold/three mesh reduces to. */
export interface ViewerPart {
  name: string;
  /** Flat xyz triples, millimetres. */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  /** Filament colour, 0-255. */
  color: RGB;
}

export type ViewPreset = 'iso' | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';

export interface ViewerOptions {
  /** Camera distance = model radius * this + `framePad`. */
  frameMul?: number;
  framePad?: number;
  /** Follow `<html data-theme>` automatically. Default true — turn it off only
   *  if the app wants to drive `setTheme` itself. */
  observeTheme?: boolean;
}

export interface Viewer {
  /** Rebuild the meshes. The camera is kept unless `refit` is asked for, or the
   *  model changed size enough that it would leave the frame. */
  setParts(parts: ViewerPart[], refit?: boolean): void;
  /** Frame the model from a named angle. */
  setView(preset: ViewPreset): void;
  /** Recolour one part in place, without rebuilding its geometry. */
  setPartColor(index: number, color: RGB): void;
  /** Called with the clicked part's index, or null when the click missed. */
  onPartPick(cb: (index: number | null, event: PointerEvent) => void): void;
  highlightPart(index: number | null): void;
  clearHighlight(): void;
  /** Screen point -> model coordinates (mm, relative to the model's centre), or
   *  null if the ray misses. */
  pickPoint(clientX: number, clientY: number): [number, number, number] | null;
  /** Swap the floor: a build plate, or the plain grid. */
  setPlate(choice: PlateChoice): void;
  setTheme(theme: string): void;
  /** Suspend orbit — while dragging a handle, for instance. */
  setOrbitEnabled(on: boolean): void;
  /** A 2x-supersampled PNG of the current view, for cover images. */
  renderToPng(): Promise<Blob | null>;
  /** Escape hatches for generator-specific overlays. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Where the model group sits, so overlays can follow it. */
  readonly root: THREE.Group;
  dispose(): void;
}

// The floor sits a hair BELOW the model's bottom face (z = 0) so the solid
// bottom occludes it cleanly — coplanar at z = 0 causes z-fighting.
const FLOOR_GAP = 0.06;

function readTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function toColor(rgb: RGB): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

function partToGeometry(p: ViewerPart): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
  // Crease-split normals: domes and round walls stay smooth, hard edges crisp.
  const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
  geo.dispose();
  return creased;
}

export function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Viewer {
  const FRAME_MUL = opts.frameMul ?? 2.2;
  const FRAME_PAD = opts.framePad ?? 15;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  let theme = readTheme();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme === 'light' ? 0xf3f4f6 : 0x15171c);

  const camera = new THREE.PerspectiveCamera(45, aspect(), 0.1, 5000);
  camera.up.set(0, 0, 1); // Z up (CAD)
  camera.position.set(60, -60, 45);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(40, -30, 70);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  const floorZ = -FLOOR_GAP;
  const buildPlate: BuildPlate = createBuildPlate(THREE, { theme, topZ: floorZ });
  buildPlate.setChoice(loadPlateChoice());
  scene.add(buildPlate.object);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const root = new THREE.Group();
  scene.add(root);

  const materials: THREE.MeshStandardMaterial[] = [];
  const partMeshes: THREE.Mesh[] = [];

  // Radius the camera was last framed for. A rebuild only re-frames when the
  // model grew or shrank enough to leave the view — otherwise dragging a slider
  // would yank the camera back to default on every tick.
  let framedRadius = 0;
  let lastSize = new THREE.Vector3(40, 40, 10);

  function aspect() {
    const h = container.clientHeight;
    return h > 0 ? container.clientWidth / h : 1;
  }

  function clearParts() {
    for (const child of [...root.children]) {
      root.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    materials.length = 0;
    partMeshes.length = 0;
  }

  function setParts(parts: ViewerPart[], refit = false) {
    clearParts();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const mat = new THREE.MeshStandardMaterial({
        color: toColor(p.color),
        metalness: 0,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(partToGeometry(p), mat);
      mesh.userData.partIndex = i;
      mesh.userData.partName = p.name;
      partMeshes.push(mesh);
      root.add(mesh);
    }

    // An empty build is a real state, not an error: a generator whose text field is
    // momentarily blank calls this with no parts. Measuring it is what breaks the view.
    // A fresh Box3 starts at min +Infinity / max -Infinity; `getCenter` guards for that
    // and returns the origin, but `box.min.z` below is read raw, so the model group lands
    // at z = -Infinity — and the *next* build measures against that and goes to NaN. The
    // model then never comes back until reload. `framedRadius` is deliberately left alone:
    // zeroing it makes the following build satisfy `framedRadius === 0` and hard-reset to
    // iso, which is the camera jump this whole block exists to avoid.
    if (parts.length === 0) {
      lastSize.set(0, 0, 0);
      return;
    }

    // Centre X/Y and drop the bottom face to z = 0, so the model sits on the plate.
    //
    // Measure from a zeroed, freshly-updated matrix. `expandByObject` calls
    // `updateWorldMatrix(false, false)` on the group and then derives each child's world
    // matrix from it, so the group's *previous* offset is still baked in — the box comes
    // back in the last build's frame and the new offset stacks on the old one. With an
    // off-centre model that makes `root.position` flip-flop between two values on every
    // rebuild, so the model hops sideways on every keystroke. The four apps that carry
    // their own viewer fixed this in 34224d7; this shared one was missed.
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.set(-centre.x, -centre.y, -box.min.z);
    lastSize = box.getSize(new THREE.Vector3());

    const radius = Math.max(lastSize.x, lastSize.y, lastSize.z);
    if (refit || framedRadius === 0) {
      setView('iso');
      return;
    }

    // Editing a parameter must never move the camera in a way the user can feel.
    //
    // This used to re-frame to the 'iso' preset once the model's radius crossed a
    // 1.6x / 0.62x threshold. Two problems: it teleported the camera to a fixed
    // angle, discarding whatever orbit the user had set, and because it was a
    // THRESHOLD it fired as a single discontinuous jolt part-way through a drag.
    // Corner radius and thickness barely change the radius so they never tripped
    // it and felt perfectly smooth — width and height did, and jumped.
    //
    // Now the angle is never touched, and the distance only eases outward, and
    // only while the model is actually outgrowing the frame. Every intermediate
    // value of a slider drag gets a proportional correction instead of one lurch,
    // and a user who deliberately zoomed in keeps their close-up until the model
    // genuinely needs more room.
    if (radius > framedRadius) {
      const offset = camera.position.clone().sub(controls.target);
      const needed = radius * FRAME_MUL + FRAME_PAD;
      if (offset.length() < needed) {
        camera.position.copy(controls.target).add(offset.setLength(needed));
        controls.update();
      }
    }
    framedRadius = radius;
  }

  /** Point the camera at the model from a preset angle, at a fitting distance. */
  function setView(preset: ViewPreset) {
    const radius = Math.max(lastSize.x, lastSize.y, lastSize.z);
    const dist = radius * FRAME_MUL + FRAME_PAD;
    const midZ = lastSize.z / 2;
    // Face-on views keep a few degrees of tilt: dead-on would put the view axis
    // parallel to camera.up (Z) and leave the roll undefined.
    const tilt = dist * 0.08;
    switch (preset) {
      case 'front': camera.position.set(0, -dist, midZ + tilt); break;
      case 'back': camera.position.set(0, dist, midZ + tilt); break;
      case 'left': camera.position.set(-dist, 0, midZ + tilt); break;
      case 'right': camera.position.set(dist, 0, midZ + tilt); break;
      case 'top': camera.position.set(0, -tilt, dist + midZ); break;
      case 'bottom': camera.position.set(0, tilt, -dist + midZ); break;
      default: camera.position.set(dist, -dist, dist * 0.75);
    }
    controls.target.set(0, 0, midZ);
    controls.update();
    framedRadius = radius;
  }

  // ---- picking, hover and selection ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const HILITE = new THREE.Color(0x3b82f6);
  let hoveredIndex: number | null = null;
  let selectedIndex: number | null = null;
  let pickCb: ((index: number | null, event: PointerEvent) => void) | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;

  function applyHighlight() {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]!;
      const on = selectedIndex === i || hoveredIndex === i;
      if (on) {
        m.emissive.copy(HILITE);
        m.emissiveIntensity = hoveredIndex === i ? 0.4 : 0.2;
      } else {
        m.emissiveIntensity = 0;
      }
    }
  }

  function castAt(clientX: number, clientY: number) {
    if (partMeshes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(partMeshes, false)[0] ?? null;
  }

  function pickIndexAt(clientX: number, clientY: number): number | null {
    const hit = castAt(clientX, clientY);
    const idx = hit ? (hit.object.userData as { partIndex?: number }).partIndex : undefined;
    return typeof idx === 'number' ? idx : null;
  }

  function pickPoint(clientX: number, clientY: number): [number, number, number] | null {
    const hit = castAt(clientX, clientY);
    if (!hit) return null;
    const p = hit.point;
    return [p.x - root.position.x, p.y - root.position.y, p.z - root.position.z];
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0) return;
    const idx = pickIndexAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = idx === null ? '' : 'pointer';
    if (idx !== hoveredIndex) {
      hoveredIndex = idx;
      applyHighlight();
    }
  };
  const onPointerLeave = () => {
    if (hoveredIndex !== null) {
      hoveredIndex = null;
      applyHighlight();
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
  };
  const onPointerUp = (e: PointerEvent) => {
    // Ignore the pointerup that ends an orbit drag or a long press.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    if (performance.now() - downT > 500) return;
    selectedIndex = pickIndexAt(e.clientX, e.clientY);
    applyHighlight();
    pickCb?.(selectedIndex, e);
  };
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // ---- sizing ----
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  const resizeObserver = new ResizeObserver(() => onResize());
  resizeObserver.observe(container);

  let raf = 0;
  (function animate() {
    raf = requestAnimationFrame(animate);
    // Self-heal the canvas size: the stage is a CSS-grid cell whose height
    // settles a frame or two after the viewer is built, and neither the window
    // 'resize' event nor the first ResizeObserver callback reliably catches
    // that — so the canvas can get stuck at its tiny initial size. Comparing
    // each frame is cheap and fixes it whenever it drifts.
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (
      w > 0 && h > 0 &&
      (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio()))
    ) {
      onResize();
    }
    controls.update();
    // From below, a solid plate would sit between the camera and the model —
    // ghost it rather than hiding it, so it never pops as you orbit past level.
    buildPlate.setGhosted(camera.position.z <= floorZ);
    renderer.render(scene, camera);
  })();

  // ---- theme ----
  function setTheme(next: string) {
    theme = next === 'light' ? 'light' : 'dark';
    scene.background = new THREE.Color(theme === 'light' ? 0xf3f4f6 : 0x15171c);
    buildPlate.setTheme(theme);
  }
  const themeObserver =
    opts.observeTheme === false
      ? null
      : new MutationObserver(() => setTheme(readTheme()));
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  async function renderToPng(): Promise<Blob | null> {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.min(prevRatio * 2, 4));
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>((res) => renderer.domElement.toBlob((b) => res(b), 'image/png'));
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(w, h);
    return blob;
  }

  function dispose() {
    cancelAnimationFrame(raf);
    themeObserver?.disconnect();
    window.removeEventListener('resize', onResize);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    clearParts();
    buildPlate.dispose();
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    setParts,
    setView,
    setPartColor(index, color) {
      const m = materials[index];
      if (m) m.color = toColor(color);
    },
    onPartPick(cb) {
      pickCb = cb;
    },
    highlightPart(index) {
      selectedIndex = index;
      applyHighlight();
    },
    clearHighlight() {
      selectedIndex = null;
      hoveredIndex = null;
      applyHighlight();
    },
    pickPoint,
    setPlate: (choice) => buildPlate.setChoice(choice),
    setTheme,
    setOrbitEnabled: (on) => {
      controls.enabled = on;
    },
    renderToPng,
    scene,
    camera,
    root,
    dispose,
  };
}
