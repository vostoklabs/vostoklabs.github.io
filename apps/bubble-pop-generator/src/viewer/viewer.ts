// three.js viewer for the bubble pop generator: Z-up CAD frame, ACES tone mapping,
// room-environment PBR, a pickable part layer. Adapted from the clicker generator's
// viewer (no section/explode modes — the fidget is a single-flip part).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';
import type { PopPart, RGB } from '../types';
import { themeColorHex } from '@vostok/ui-kit';

/* Scene background = the `--bg` token, read live. These two literals used to be written out
   by hand here and in four sibling files; they are `--bg` in each theme, so the viewport
   matched the chrome only by coincidence. `themeColorHex` resolves the current theme itself,
   so this needs no theme argument. */
const sceneBg = () => themeColorHex('--bg', 0x15171c);


const FRAME_MUL = 2.2;
const FRAME_PAD = 15;

/** front = the image face, back = the button face,
 *  iso = the default three-quarter view. */
export type ViewPreset = 'front' | 'back' | 'iso';

export interface ButtonHandleOptions {
  /** Pocket centres in body coordinates, mm. */
  positions: [number, number][];
  /** Inner marker radius, mm — the bore, drawn inside the keep-out ring. */
  innerRadius: number;
  /** Pocket outline: a disc pocket is round or a hexagon, a block is a rectangle. */
  outline: 'circle' | 'hex' | 'rect';
  /** Block footprint (mm) when outline is 'rect'. */
  size?: [number, number];
  /** Per-socket rotation in degrees (unused here; kept for the shared marker code). */
  rotations?: number[];
  /** Which one is selected, or -1. */
  active: number;
  /** Interactive (button mode) draws them bright; otherwise a faint guide. */
  interactive: boolean;
}

export interface Viewer {
  /** Rebuilds the meshes. The camera is kept unless `refit` is asked for or the
   *  model's size changed enough that it would leave the frame. */
  setParts(parts: PopPart[], refit?: boolean): void;
  /** Frame the model from a named angle. */
  setView(preset: ViewPreset): void;
  /** Screen point -> body coordinates (mm from the model centre), or null if the
   *  ray misses the model. Used to place buttons by clicking on the part. */
  pickBodyPoint(clientX: number, clientY: number): [number, number] | null;
  /** Draw socket markers over the model. Empty positions clears them. */
  setButtonHandles(opts: ButtonHandleOptions): void;
  /** Swap the floor the model stands on: a build plate, or the plain grid. */
  setPlate(choice: PlateChoice): void;
  /** Which handle is under the pointer, or null. */
  handleAt(clientX: number, clientY: number): number | null;
  /** Suspend orbit while dragging a button. */
  setOrbitEnabled(on: boolean): void;
  /** Turn off left-drag orbit so button mode can place instead of spin. */
  setPlacementMode(on: boolean): void;
  renderToPng(): Promise<Blob | null>;
  setTheme(theme: string): void;
  onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void): void;
  setPartColor(index: number, rgb: RGB): void;
  highlightPart(index: number | null): void;
  clearHighlight(): void;
  dispose(): void;
}

// The floor sits a hair BELOW the model's bottom face (z = 0) so the solid bottom
// occludes it cleanly — coplanar at z = 0 causes z-fighting.
const FLOOR_GAP = 0.06;

function partToGeometry(p: PopPart): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  let positions: Float32Array;
  if (p.numProp === 3) {
    positions = p.vertProperties;
  } else {
    const count = p.vertProperties.length / p.numProp;
    positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = p.vertProperties[i * p.numProp];
      positions[i * 3 + 1] = p.vertProperties[i * p.numProp + 1];
      positions[i * 3 + 2] = p.vertProperties[i * p.numProp + 2];
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(p.triVerts, 1));
  // Crease-split normals: keep domes/round walls smooth, hard edges crisp.
  const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
  geo.dispose();
  return creased;
}

function color(rgb: RGB): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

export function createViewer(container: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  scene.background = new THREE.Color(sceneBg());

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 5000);
  camera.up.set(0, 0, 1); // Z up (CAD)
  camera.position.set(60, -60, 45);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(40, -30, 70);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  // The floor: a Bambu build plate (default) or the plain reference grid, with
  // the model resting on its top surface.
  const floorZ = -FLOOR_GAP;
  const buildPlate: BuildPlate = createBuildPlate(THREE, { theme: currentTheme, topZ: floorZ });
  buildPlate.setChoice(loadPlateChoice());
  scene.add(buildPlate.object);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const root = new THREE.Group();
  scene.add(root);

  const materials: THREE.Material[] = [];
  const partMeshes: THREE.Mesh[] = [];

  let placeholder: THREE.Group | null = null;

  function framePlaceholder() {
    root.position.set(0, 0, 0);
    const radius = 70 * FRAME_MUL + FRAME_PAD;
    camera.position.set(radius, -radius, radius * 0.75);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  framePlaceholder();

  function clearPlaceholder() {
    if (!placeholder) return;
    root.remove(placeholder);
    for (const child of placeholder.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    placeholder = null;
  }

  function clearGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  // Radius the camera was last framed for. A rebuild only re-frames when the
  // model grew/shrank enough to leave the view — otherwise dragging a slider
  // would yank the camera back to default on every single tick.
  let framedRadius = 0;
  let lastSize = new THREE.Vector3(40, 40, 4);

  function setParts(parts: PopPart[], refit = false) {
    clearPlaceholder();
    clearGroup(root);
    materials.length = 0;
    partMeshes.length = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const mat = new THREE.MeshStandardMaterial({
        color: color(p.colorRgb),
        metalness: 0.0,
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

    // Center X/Y; place the bottom face at z = 0 so the model sits on the grid.
    // Reset to the origin and push the world matrices down before measuring —
    // expandByObject reuses the parent's cached matrixWorld, so otherwise the box carries
    // the previous build's offset and the new offset compounds on top of it.
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().expandByObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -center.y, -box.min.z);

    const size = box.getSize(new THREE.Vector3());
    lastSize = size;

    syncHandles(); // root moved, so the handles have to follow

    const radius = Math.max(size.x, size.y, size.z);
    if (refit || framedRadius === 0) {
      frame('iso');
      return;
    }

    // Editing a parameter must never move the camera in a way the user can feel.
    // This used to re-frame to 'iso' once the radius crossed a 1.6x / 0.62x
    // threshold, which both teleported the camera to a fixed angle (discarding
    // the user's orbit) and fired as a single lurch part-way through a drag.
    // Controls that barely change the outer size felt perfectly smooth; the ones
    // that do — size, spacing, count — jumped. Now the angle is never touched and
    // the distance only eases outward, and only while the model is outgrowing the
    // frame, so every step of a drag gets a small proportional correction.
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

  /** Re-place the socket markers after the model group moves. */
  function syncHandles() {
    handleGroup.children.forEach((child, i) => {
      const p = handlePositions[i];
      if (p) child.position.set(p[0] + root.position.x, p[1] + root.position.y, root.position.z - 0.05);
    });
  }

  /** Point the camera at the model from a preset angle, at a distance that fits it. */
  function frame(preset: ViewPreset) {
    const radius = Math.max(lastSize.x, lastSize.y, lastSize.z);
    const dist = radius * FRAME_MUL + FRAME_PAD;
    const midZ = lastSize.z / 2;
    // Face-on views keep a few degrees of tilt: dead-on would put the view axis
    // parallel to camera.up (Z) and leave the roll undefined.
    const tilt = dist * 0.08;
    if (preset === 'front') camera.position.set(0, -tilt, dist + midZ);
    else if (preset === 'back') camera.position.set(0, tilt, -dist + midZ);
    else camera.position.set(dist, -dist, dist * 0.75);
    controls.target.set(0, 0, midZ);
    controls.update();
    framedRadius = radius;
  }

  async function renderToPng(): Promise<Blob | null> {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.min(prevRatio * 2, 4));
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>((res) =>
      renderer.domElement.toBlob((b) => res(b), 'image/png'),
    );
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(w, h);
    return blob;
  }

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
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (
      w > 0 &&
      h > 0 &&
      (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio()))
    ) {
      onResize();
    }
    controls.update();
    // The floor sits under the model; looking at the button side it would sit
    // between the camera and the part. Fade it to a ghost rather than dropping
    // it, so the plate never pops in and out as you orbit past level.
    buildPlate.setGhosted(camera.position.z <= floorZ);
    renderer.render(scene, camera);
  })();

  // ---- Part picking / hover / selection ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const HILITE = new THREE.Color(0x3b82f6);
  let hoveredIndex: number | null = null;
  let selectedIndex: number | null = null;
  let pickCb: ((index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;

  let outlineMesh: any = null;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false });

  function applyHighlight() {
    if (outlineMesh) {
      outlineMesh.removeFromParent();
      outlineMesh.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
      });
      outlineMesh = null;
    }
    for (let i = 0; i < partMeshes.length; i++) {
      const m = materials[i] as THREE.MeshStandardMaterial;
      if (m) {
        const isSelected = selectedIndex === i;
        const isHovered = hoveredIndex === i;
        if (isSelected || isHovered) {
          m.emissive.copy(HILITE);
          m.emissiveIntensity = isHovered ? 0.4 : 0.2;
        } else {
          m.emissiveIntensity = 0;
        }
      }
    }
    if (selectedIndex !== null && partMeshes[selectedIndex]) {
      const mesh = partMeshes[selectedIndex];
      const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
      outlineMesh = new THREE.LineSegments(edges, outlineMaterial) as any;
      outlineMesh.renderOrder = 999;
      mesh.parent?.add(outlineMesh);
    } else if (hoveredIndex !== null && partMeshes[hoveredIndex]) {
      const mesh = partMeshes[hoveredIndex];
      const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
      outlineMesh = new THREE.LineSegments(edges, outlineMaterial) as any;
      outlineMesh.renderOrder = 999;
      mesh.parent?.add(outlineMesh);
    }
  }

  function pickIndexAt(clientX: number, clientY: number): number | null {
    if (partMeshes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(partMeshes, false);
    for (const h of hits) {
      const idx = (h.object.userData as { partIndex?: number }).partIndex;
      if (typeof idx === 'number') return idx;
    }
    return null;
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
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    if (performance.now() - downT > 500) return;
    const idx = pickIndexAt(e.clientX, e.clientY);
    if (idx === null) {
      selectedIndex = null;
      applyHighlight();
      pickCb?.(null, e.clientX, e.clientY, e.shiftKey);
      return;
    }
    selectedIndex = idx;
    applyHighlight();
    pickCb?.(idx, e.clientX, e.clientY, e.shiftKey);
  };
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  function onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) {
    pickCb = cb;
  }

  // ---- Socket markers: the keep-out outline plus the bore, drawn over the
  //      model with depthTest off so they read from either side. An embedded pocket
  //      is invisible in the solid, so these are shown whenever pockets exist —
  //      not only while placing. ----
  const handleGroup = new THREE.Group();
  scene.add(handleGroup);
  let handleRadius = 0;
  let handlePositions: [number, number][] = [];

  /** Outline points (unit-less, body mm) for one pocket profile. */
  function outlinePoints(o: ButtonHandleOptions, rot: number): THREE.Vector2[] {
    const pts: THREE.Vector2[] = [];
    if (o.outline === 'rect') {
      const [w, h] = o.size ?? [o.innerRadius * 2, o.innerRadius * 2];
      const a = (rot * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      for (const [x, y] of [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ]) {
        pts.push(new THREE.Vector2(x * cos - y * sin, x * sin + y * cos));
      }
    } else if (o.outline === 'hex') {
      // Same construction as the pocket: inradius = the inner radius.
      const r = o.innerRadius / Math.cos(Math.PI / 6);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
    } else {
      for (let i = 0; i < 48; i++) {
        const a = (Math.PI * 2 * i) / 48;
        pts.push(new THREE.Vector2(Math.cos(a) * o.innerRadius, Math.sin(a) * o.innerRadius));
      }
    }
    return pts;
  }

  function clearHandles() {
    for (const child of [...handleGroup.children]) {
      handleGroup.remove(child);
      child.traverse?.((n: any) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) n.material.dispose();
      });
    }
  }

  function setButtonHandles(o: ButtonHandleOptions) {
    handlePositions = o.positions;
    handleRadius = Math.max(o.innerRadius, 2);
    clearHandles();

    o.positions.forEach((p, i) => {
      const isActive = o.interactive && i === o.active;
      const color = isActive ? 0x3b82f6 : 0x9aa3b2;
      const opacity = o.interactive ? (isActive ? 1 : 0.6) : 0.4;
      const group = new THREE.Group();

      // Pocket outline (hex / rect / circle).
      const outline = outlinePoints(o, o.rotations?.[i] ?? 0);
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(outline.map((v) => new THREE.Vector3(v.x, v.y, 0))),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
      );
      loop.renderOrder = 998;
      group.add(loop);

      // Extra outline passes to make it look thicker (offset slightly outward).
      const cx = outline.reduce((s, v) => s + v.x, 0) / outline.length;
      const cy = outline.reduce((s, v) => s + v.y, 0) / outline.length;
      for (const scale of [1.012, 1.024]) {
        const scaled = outline.map((v) => new THREE.Vector3(
          cx + (v.x - cx) * scale,
          cy + (v.y - cy) * scale,
          0,
        ));
        const extra = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(scaled),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.7, depthTest: false }),
        );
        extra.renderOrder = 998;
        group.add(extra);
      }

      // Semi-transparent fill — always shown so the helper/pocket is clearly visible.
      {
        const shape = new THREE.Shape(outline.map((v) => new THREE.Vector2(v.x, v.y)));
        const fillOpacity = isActive ? 0.18 : 0.08;
        const fill = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshBasicMaterial({ color: isActive ? 0x3b82f6 : 0x9aa3b2, transparent: true, opacity: fillOpacity, depthTest: false }),
        );
        fill.renderOrder = 997;
        group.add(fill);
      }

      // The bore — always a circle, and always INSIDE the
      // hex outline, which is the point of the hex profile.
      if (o.outline === 'hex') {
        const circle: THREE.Vector3[] = [];
        for (let s = 0; s <= 48; s++) {
          const a = (Math.PI * 2 * s) / 48;
          circle.push(new THREE.Vector3(Math.cos(a) * o.innerRadius, Math.sin(a) * o.innerRadius, 0));
        }
        const inner = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(circle),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.75, depthTest: false }),
        );
        inner.renderOrder = 998;
        group.add(inner);
      }

      // A filled disc makes the handle easy to hit and to see at a glance.
      if (o.interactive) {
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(o.innerRadius, 32),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: isActive ? 0.28 : 0.12,
            depthTest: false,
            side: THREE.DoubleSide,
          }),
        );
        fill.renderOrder = 997;
        group.add(fill);
      }

      group.position.set(p[0] + root.position.x, p[1] + root.position.y, root.position.z - 0.05);
      handleGroup.add(group);
    });
  }

  /** Body coordinates of the point under the cursor on the model surface. */
  function pickBodyPoint(clientX: number, clientY: number): [number, number] | null {
    if (partMeshes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(partMeshes, false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return [p.x - root.position.x, p.y - root.position.y];
  }

  /** Index of the handle under the cursor (within its radius), else null. */
  function handleAt(clientX: number, clientY: number): number | null {
    const body = pickBodyPoint(clientX, clientY);
    if (!body) return null;
    let best: number | null = null;
    // A little slop so markers stay easy to grab.
    let bestD = Math.max(handleRadius, 3.5) ** 2;
    handlePositions.forEach((p, i) => {
      const d = (p[0] - body[0]) ** 2 + (p[1] - body[1]) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function setOrbitEnabled(on: boolean) {
    controls.enabled = on;
  }

  /** In button mode, left-drag places buttons — it must NOT orbit. OrbitControls
   *  listens on the canvas and sees pointerdown before our stage handler, so we
   *  can't disable it reactively; instead we turn left-button rotate off up front.
   *  Right-drag pans and the wheel still zooms. */
  function setPlacementMode(on: boolean) {
    controls.enableRotate = !on;
  }
  function setPartColor(index: number, rgb: RGB) {
    const m = materials[index] as THREE.MeshStandardMaterial | undefined;
    if (m) m.color = color(rgb);
  }
  function highlightPart(index: number | null) {
    selectedIndex = index;
    applyHighlight();
  }
  function clearHighlight() {
    selectedIndex = null;
    hoveredIndex = null;
    applyHighlight();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    clearGroup(root);
    buildPlate.dispose();
    outlineMaterial.dispose();
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  function setTheme(theme: string) {
    scene.background = new THREE.Color(sceneBg());
    buildPlate.setTheme(theme);
  }

  return {
    setParts,
    setView: frame,
    pickBodyPoint,
    setButtonHandles,
    setPlate: (choice) => buildPlate.setChoice(choice),
    handleAt,
    setOrbitEnabled,
    setPlacementMode,
    renderToPng,
    setTheme,
    onPartPick,
    setPartColor,
    highlightPart,
    clearHighlight,
    dispose,
  };
}
