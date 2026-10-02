import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';
import type { ClickerPart, MeshData, RGB, SwitchPlacement, ViewMode } from '../types';
import { MAKERLAB } from 'virtual:makerlab';
import { themeColorHex } from '@vostok/ui-kit';

/* Scene background = the `--bg` token, read live. These two literals used to be written out
   by hand here and in four sibling files; they are `--bg` in each theme, so the viewport
   matched the chrome only by coincidence. `themeColorHex` resolves the current theme itself,
   so this needs no theme argument. */
const sceneBg = () => themeColorHex('--bg', 0x15171c);


export type SectionAxis = 'x' | 'y' | 'z';

/** Model mode's cutter, drawn over the parts in their own coordinates. `plane` is the slice (a
 *  sheet the user can grab and drag up and down); `column` is the button (a ghost prism through
 *  the model where the plug will go). */
export type CutterOverlay =
  | { kind: 'plane'; z: number; minX: number; maxX: number; minY: number; maxY: number }
  | {
    kind: 'column'; x: number; y: number; shape: 'round' | 'square'; size: number;
    rotation: number; z0: number; z1: number;
  };

/** A DOM grip the viewer places on the stage (the kit's `stageHandle()`): an element in the
 *  stage, positioned from the point it hangs off, or hidden with null. */
export type PlaneHandle = HTMLElement & { place(at: { x: number; y: number } | null): void };

// The embedded build frames the model ~25% further back; orbit/zoom untouched. The public
// build keeps the original framing.
/** Breathing room around the model in an exported cover: 1.0 is the sphere touching all
 *  four edges, which reads as cramped at thumbnail size. */
const COVER_PAD = 1.15;
const FRAME_MUL = MAKERLAB ? 2.75 : 2.2;
const FRAME_PAD = MAKERLAB ? 19 : 15;

export interface Viewer {
  setParts(parts: ClickerPart[], preserveCamera?: boolean): void;
  setView(mode: ViewMode): void;
  /** Turn the cut on or off. Independent of assembled/exploded — you can cut either. */
  setSectionEnabled(on: boolean): void;
  setSection(axis: SectionAxis, pos: number): void;
  setSwitch(mesh: MeshData | null): void;
  showSwitch(on: boolean): void;
  /** Place one preview switch mesh per (clamped) placement the geometry was built with. */
  setSwitchPlacements(placements: SwitchPlacement[]): void;
  renderToPng(): Promise<Blob | null>;
  /** A small PNG of the model for embedding as a file cover. */
  renderCoverPng(maxEdge?: number): Promise<Uint8Array | null>;
  /** A square picture on a transparent background, as a data URL: of `parts` if given (a result
   *  the viewport is not showing), else of what is on screen, put together. */
  renderThumbnail(edge: number, parts?: ClickerPart[]): string | null;
  setTheme(theme: string): void;
  /** Swap the floor the model stands on: a build plate, or the plain grid. */
  setPlate(choice: PlateChoice): void;
  /** Register a callback fired when the user clicks a colored part of the model, or null if clicking empty space. */
  onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void): void;
  /** Live-recolor a single part's material (no rebuild — geometry is unchanged). */
  setPartColor(index: number, rgb: RGB): void;
  /** Mark a part as the active selection (highlight), or null to clear. */
  highlightPart(index: number | null): void;
  /** Mark multiple parts as active selection. */
  highlightParts(indices: number[]): void;
  /** Clear hover + selection highlights. */
  clearHighlight(): void;
  /** Model mode: draw the cutter over the parts, or clear it with null. */
  setCutterOverlay(o: CutterOverlay | null): void;
  /** How far Exploded lifts the top, mm; null = the image clicker's own, which grows with the
   *  model's height. A fixed gap is also framed, so a tall top never leaves the view. */
  setExplodeGap(mm: number | null): void;
  /** Model mode: the cut plane was dragged to `z` (part coordinates); `done` on release. */
  onPlaneDrag(cb: (z: number, done: boolean) => void): void;
  /** Model mode: a grip to hang off the cut plane's right-hand corner, kept there every frame
   *  and hidden while there is no plane. Dragging it is the same drag as grabbing the plane. */
  setPlaneHandle(handle: PlaneHandle | null): void;
  /** 'surface': a tap on the model reports where it landed (onSurfacePick) instead of picking
   *  a part to recolour. */
  setPickMode(mode: 'part' | 'surface'): void;
  onSurfacePick(cb: (x: number, y: number, z: number) => void): void;
  dispose(): void;
}

// The floor sits a hair BELOW the model's bottom face (which lands at z = 0) so the
// solid bottom occludes it cleanly — coplanar at z = 0 causes z-fighting that bleeds
// grid lines up through the lower body.
const FLOOR_GAP = 0.06;

function partToGeometry(p: ClickerPart): THREE.BufferGeometry {
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
  // Crease-split normals: keep the domed top / round walls smooth while keeping
  // hard edges crisp (preview shading only — matches the keycap generator).
  const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
  geo.dispose();
  return creased;
}

function color(rgb: RGB): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

export function createViewer(container: HTMLElement): Viewer {
  /* `stencil: true` is not the default any more — three.js turned it off, and without it every
     stencil test passes trivially, so the section caps below render as full-size white quads
     standing in the scene instead of painting only the cut face. */
  /* `alpha: true` only matters to `renderThumbnail`, which clears to transparent so a card's
     picture follows the theme. Every other frame has `scene.background` set and paints every
     pixel opaque, so the viewport itself looks exactly as it did without it. */
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    stencil: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  // Section view: a single clipping plane swept along an axis.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const materials: THREE.Material[] = [];
  // Parallel to `materials`/parts: the pickable meshes, each tagged with its part
  // index in userData so a raycast hit maps straight back to the part/material.
  const partMeshes: THREE.Mesh[] = [];
  const bounds = new THREE.Vector3(40, 40, 40);
  let sectionAxis: SectionAxis = 'y';
  let sectionPos = 0;
  /* The cut is its own switch, not a third view mode. It was one at first, which meant
     turning it on cost you assembled/exploded — two unrelated questions sharing one control.
     Now either view can be cut. */
  let sectionOn = false;

  const scene = new THREE.Scene();
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  scene.background = new THREE.Color(sceneBg());

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    5000,
  );
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

  // Root group is recentered for viewing; children keep relative positions.
  const root = new THREE.Group();
  scene.add(root);
  const capGroup = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const switchGroup = new THREE.Group(); // the real MX switch — display-only, toggleable
  switchGroup.visible = false;
  root.add(capGroup, bodyGroup, switchGroup);

  let placeholder: THREE.Group | null = null;
  framePlaceholder();

  let viewMode: ViewMode = 'assembled';
  let explodeOffset = 0;
  let explodeGap: number | null = null;
  let switchMaterial: THREE.MeshStandardMaterial | null = null;
  // The switch mesh (shared across placements) and where to seat copies of it.
  let switchGeometry: THREE.BufferGeometry | null = null;
  let switchPlacements: SwitchPlacement[] = [{ x: 0, y: 0, rotation: 0 }];

  // ---- Part picking / hover / selection ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const HILITE = new THREE.Color(0x3b82f6);
  let hoveredIndex: number | null = null;
  let selectedIndices: number[] = [];
  let pickCb: ((index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;

  let outlineMesh: THREE.LineSegments | null = null;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false });

  // ---- Model mode: the cutter overlay ----
  // A child of `root`, so it is in the parts' own coordinates and follows the model wherever
  // `setParts` re-seats it on the plate.
  const overlayGroup = new THREE.Group();
  root.add(overlayGroup);
  let overlay: CutterOverlay | null = null;
  let planeMesh: THREE.Mesh | null = null;
  let pickMode: 'part' | 'surface' = 'part';
  let planeDragCb: ((z: number, done: boolean) => void) | null = null;
  let surfaceCb: ((x: number, y: number, z: number) => void) | null = null;
  /** The cut plane while it is held: where it has got to, and how far the grab point sat from
   *  it, so the plane does not jump to the pointer on the first move. */
  let dragging: { z: number; offset: number } | null = null;
  let planeHandle: PlaneHandle | null = null;
  const handleCorner = new THREE.Vector3();
  /** Set when a press grabbed the plane, so its release is not also read as a tap. */
  let pressGrabbedPlane = false;
  const dragPlane = new THREE.Plane();

  function disposeTree(o: THREE.Object3D) {
    o.traverse((child) => {
      const m = child as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }

  function setCutterOverlay(o: CutterOverlay | null) {
    overlay = o;
    for (const child of [...overlayGroup.children]) {
      overlayGroup.remove(child);
      disposeTree(child);
    }
    planeMesh = null;
    if (!o) return;
    const col = new THREE.Color(themeColorHex('--accent', 0x3b82f6));
    const skin = () => new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
    const line = () => new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
    if (o.kind === 'plane') {
      const pad = 6;
      const geo = new THREE.PlaneGeometry(o.maxX - o.minX + 2 * pad, o.maxY - o.minY + 2 * pad);
      const mesh = new THREE.Mesh(geo, skin());
      mesh.position.set((o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, o.z);
      mesh.renderOrder = 998;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), line()));
      overlayGroup.add(mesh);
      planeMesh = mesh;
    } else {
      const h = Math.max(0.5, o.z1 - o.z0);
      let geo: THREE.BufferGeometry;
      if (o.shape === 'round') {
        geo = new THREE.CylinderGeometry(o.size / 2, o.size / 2, h, 64, 1, true);
        geo.rotateX(Math.PI / 2); // three's cylinders stand on Y; the scene is Z-up
      } else {
        geo = new THREE.BoxGeometry(o.size, o.size, h);
      }
      const mesh = new THREE.Mesh(geo, skin());
      mesh.position.set(o.x, o.y, (o.z0 + o.z1) / 2);
      mesh.rotation.z = (o.rotation * Math.PI) / 180;
      mesh.renderOrder = 998;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), line()));
      overlayGroup.add(mesh);
    }
  }

  function aimRay(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function overPlane(clientX: number, clientY: number): boolean {
    if (!planeMesh || overlay?.kind !== 'plane' || !planeDragCb) return false;
    aimRay(clientX, clientY);
    return raycaster.intersectObject(planeMesh, false).length > 0;
  }

  /** Where a drag has taken the plane: the pointer's ray against an upright sheet through the
   *  plane's centre, turned to face the camera, so up the screen is up the model. */
  function dragZ(clientX: number, clientY: number): number | null {
    if (!planeMesh) return null;
    aimRay(clientX, clientY);
    const centre = planeMesh.getWorldPosition(new THREE.Vector3());
    const n = camera.getWorldDirection(new THREE.Vector3());
    n.z = 0;
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    dragPlane.setFromNormalAndCoplanarPoint(n.normalize(), centre);
    const hit = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
    return hit ? overlayGroup.worldToLocal(hit).z : null;
  }

  /** Take hold of the plane, from the plane itself or from its grip. */
  function beginPlaneDrag(e: PointerEvent, holder: Element) {
    const start = (overlay as { z: number }).z;
    const at = dragZ(e.clientX, e.clientY);
    dragging = { z: start, offset: at === null ? 0 : start - at };
    controls.enabled = false;
    holder.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  // Capture phase, so a press on the plane is claimed before OrbitControls starts an orbit with
  // it: a one-finger drag must never be ambiguous between moving the cut and turning the view.
  const onPlanePointerDown = (e: PointerEvent) => {
    pressGrabbedPlane = false;
    if (e.button !== 0 || !overPlane(e.clientX, e.clientY)) return;
    pressGrabbedPlane = true;
    beginPlaneDrag(e, renderer.domElement);
  };
  // The grip is off the canvas, so OrbitControls never sees its press to begin with.
  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !planeMesh || overlay?.kind !== 'plane' || !planeDragCb) return;
    beginPlaneDrag(e, e.currentTarget as Element);
  };
  const onPlanePointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const at = dragZ(e.clientX, e.clientY);
    if (at === null || !planeMesh) return;
    const z = at + dragging.offset;
    dragging.z = z;
    planeMesh.position.z = z;
    planeDragCb?.(z, false);
  };
  const onPlanePointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    const z = dragging.z;
    dragging = null;
    controls.enabled = true;
    renderer.domElement.releasePointerCapture?.(e.pointerId);
    planeDragCb?.(z, true);
  };

  function setPlaneHandle(h: PlaneHandle | null) {
    if (planeHandle) {
      planeHandle.removeEventListener('pointerdown', onHandlePointerDown);
      planeHandle.removeEventListener('pointermove', onPlanePointerMove);
      planeHandle.removeEventListener('pointerup', onPlanePointerUp);
      planeHandle.removeEventListener('pointercancel', onPlanePointerUp);
      planeHandle.place(null);
    }
    planeHandle = h;
    if (!h) return;
    h.addEventListener('pointerdown', onHandlePointerDown);
    h.addEventListener('pointermove', onPlanePointerMove);
    h.addEventListener('pointerup', onPlanePointerUp);
    h.addEventListener('pointercancel', onPlanePointerUp);
  }

  /** Hang the grip off whichever of the plane's corners is furthest right on screen. Every
   *  frame, because the camera, the plane and the stage can each move without the others. */
  function placePlaneHandle() {
    if (!planeHandle) return;
    const stage = planeHandle.parentElement;
    if (!planeMesh || overlay?.kind !== 'plane' || !overlayGroup.visible || !stage) {
      planeHandle.place(null);
      return;
    }
    const { width, height } = (planeMesh.geometry as THREE.PlaneGeometry).parameters;
    let bestX = -Infinity;
    let bestY = 0;
    for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      handleCorner.set((u * width) / 2, (v * height) / 2, 0);
      planeMesh.localToWorld(handleCorner).project(camera);
      if (Math.abs(handleCorner.z) > 1) continue; // behind the camera, or past its far plane
      if (handleCorner.x > bestX) {
        bestX = handleCorner.x;
        bestY = handleCorner.y;
      }
    }
    const canvas = renderer.domElement.getBoundingClientRect();
    if (bestX === -Infinity || canvas.width === 0) {
      planeHandle.place(null);
      return;
    }
    const box = stage.getBoundingClientRect();
    const x = canvas.left - box.left + ((bestX + 1) / 2) * canvas.width;
    const y = canvas.top - box.top + ((1 - bestY) / 2) * canvas.height;
    // It hangs to the right of its point, so near the stage's edge it would run off it.
    planeHandle.place({ x: Math.min(x, box.width - planeHandle.offsetWidth - 26), y });
  }

  function framePlaceholder() {
    root.position.set(0, 0, 0);
    const radius = 40 * FRAME_MUL + FRAME_PAD;
    camera.position.set(radius, -radius, radius * 0.75);
    controls.target.set(0, 0, 11);
    controls.update();
  }

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

  /* --- The cut face -------------------------------------------------------------------
     A clipped mesh is an open shell, so the first version of this let you see straight
     through the cut into the lit inside of the far wall — which is why it read as a mess
     rather than as a cross-section.

     The fix is the standard stencil cap. For every part we draw its geometry twice into the
     stencil buffer and nowhere else: back faces incrementing, front faces decrementing. What
     survives is a non-zero stencil exactly where the plane passes through solid material.
     Then one quad per part, laid on the plane in that part's own colour, is drawn through
     that stencil — so the cut paints as solid material and the model reads the way a
     sectioned CAD drawing does. Each quad clears the stencil after itself, or the next
     part's cap would inherit it.

     The reference switch is deliberately NOT clipped: it is not part of the print, and a
     whole switch sitting inside a cutaway body is exactly the picture this view exists to
     give ("does the switch fit?"). Cutting it too just adds a second open shell. */
  const capPlanes = new THREE.Group();
  capPlanes.visible = false;
  scene.add(capPlanes);
  const capQuadGeom = new THREE.PlaneGeometry(1, 1);

  /* Ask the context whether it really gave us a stencil buffer, rather than assuming the
     request above was honoured. Without one every stencil test passes, and the caps stop
     being caps: each quad paints its full size across the scene. That failure is far worse
     than having no caps at all, so when the buffer is missing we simply do without them and
     the cut falls back to an open shell. */
  const HAS_STENCIL = renderer.getContext().getContextAttributes()?.stencil === true;

  /* Render order is GLOBAL in three.js, not per object, so the stencil pair and the cap that
     consumes it have to interleave per part: write part 0, cap part 0, write part 1, cap
     part 1… Give every stencil pair one slot and its cap the next, or all the writes happen
     first, the first cap paints the union of every part and clears, and every cap after it
     draws against an empty stencil and disappears. */
  const stencilSlot = (i: number) => 10 + i * 2;

  function stencilGroupFor(geometry: THREE.BufferGeometry, index: number): THREE.Group {
    const group = new THREE.Group();
    for (const [side, op] of [
      [THREE.BackSide, THREE.IncrementWrapStencilOp],
      [THREE.FrontSide, THREE.DecrementWrapStencilOp],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        side,
        clippingPlanes: [clipPlane],
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op,
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.renderOrder = stencilSlot(index);
      group.add(mesh);
    }
    return group;
  }

  function capQuadFor(c: THREE.Color, index: number): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      metalness: 0,
      roughness: 0.7,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const quad = new THREE.Mesh(capQuadGeom, mat);
    quad.renderOrder = stencilSlot(index) + 1;
    // Without this the stencil left by one part is still standing when the next part's cap
    // is drawn, and every cap after the first paints the union of the ones before it.
    quad.onAfterRender = (r) => r.clearStencil();
    return quad;
  }

  /** Lay every cap quad on the plane, facing it, big enough to cover the whole model. */
  function updateCaps() {
    capPlanes.visible = sectionOn;
    if (!sectionOn) return;
    const span = Math.max(bounds.x, bounds.y, bounds.z) * 2.5 + 20;
    for (const quad of capPlanes.children) {
      clipPlane.coplanarPoint(quad.position);
      quad.lookAt(
        quad.position.x - clipPlane.normal.x,
        quad.position.y - clipPlane.normal.y,
        quad.position.z - clipPlane.normal.z,
      );
      quad.scale.set(span, span, 1);
    }
  }

  function clearCaps() {
    for (const quad of [...capPlanes.children]) {
      capPlanes.remove(quad);
      if (quad instanceof THREE.Mesh) (quad.material as THREE.Material).dispose();
    }
  }

  function clearGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Group) {
        // A stencil pair. Its two meshes SHARE the part's geometry, which the part's own
        // mesh disposes above, so only the materials are ours to free here.
        for (const m of child.children) {
          if (m instanceof THREE.Mesh) (m.material as THREE.Material).dispose();
        }
      }
    }
  }

  function setParts(parts: ClickerPart[], preserveCamera = false) {
    clearPlaceholder();
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    clearCaps();
    materials.length = 0;
    partMeshes.length = 0;
    hoveredIndex = null;
    selectedIndices = [];

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const mat = new THREE.MeshStandardMaterial({
        color: color(p.colorRgb),
        metalness: 0.0,
        roughness: 0.5,
        side: THREE.DoubleSide, // so the interior shows in section view
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(partToGeometry(p), mat);
      mesh.userData.partIndex = i; // raycast hit -> part/material index
      mesh.userData.partName = p.name; // essential for live preview and syncing heights
      partMeshes.push(mesh);
      const group = p.kind === 'body' ? bodyGroup : capGroup;
      group.add(mesh);
      // The stencil pair rides in the same group as the part, so it inherits the same
      // transform; the cap quad is world-space and lives with the other quads.
      if (HAS_STENCIL) {
        group.add(stencilGroupFor(mesh.geometry, i));
        capPlanes.add(capQuadFor(mat.color, i));
      }
    }

    // Center X/Y, but place the bottom of the assembly at z = 0 so it sits on the grid.
    root.position.set(0, 0, 0);
    capGroup.position.set(0, 0, 0);
    // Box3.expandByObject only refreshes the object's OWN world matrix — it reuses the
    // parent's cached one. Without this force-update, `root.matrixWorld` still holds the
    // PREVIOUS build's offset, so every box below is measured in a stale frame and the
    // new offset is computed on top of the old one. That is what made the model hop above
    // the plate or sink into it on each rebuild (resize, shape change).
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().expandByObject(capGroup).expandByObject(bodyGroup);
    // Anchor on the BASE alone. The base is the part that defines where the model sits;
    // the caps and their legends ride on top of it and change shape constantly (a bolder
    // or larger letter, a different font), and centring on those made the whole model
    // twitch sideways on every keystroke.
    const anchor = bodyGroup.children.length
      ? new THREE.Box3().expandByObject(bodyGroup)
      : box;
    const center = anchor.getCenter(new THREE.Vector3());
    // X/Y from the base alone (stable while the legend changes), but Z from the FULL
    // assembly: the cap skirt reaches down past the body bottom on some configurations,
    // and anchoring Z on the body alone let that skirt hang through the build plate.
    root.position.set(-center.x, -center.y, -Math.min(anchor.min.z, box.min.z));

    const size = box.getSize(new THREE.Vector3());
    bounds.copy(size);
    explodeOffset = explodeGap ?? size.z * 0.8 + 10;
    applyView();


    if (!preserveCamera) {
      // With a fixed gap (Model mode) the frame takes in the lifted top as well; the image
      // clicker's framing is left exactly as it always was.
      const tall = explodeGap !== null && viewMode === 'exploded' ? size.z + explodeOffset : size.z;
      const radius = Math.max(size.x, size.y, tall) * FRAME_MUL + FRAME_PAD;
      camera.position.set(radius, -radius, radius * 0.75);
      controls.target.set(0, 0, tall / 2);
      controls.update();
    }

  }

  function updateClipPlane() {
    const n =
      sectionAxis === 'x'
        ? new THREE.Vector3(-1, 0, 0)
        : sectionAxis === 'z'
          ? new THREE.Vector3(0, 0, -1)
          : new THREE.Vector3(0, -1, 0);
    const half = (sectionAxis === 'x' ? bounds.x : sectionAxis === 'z' ? bounds.z : bounds.y) / 2;
    clipPlane.normal.copy(n);
    /* Every one of these normals is -1 on its own axis, so `normal · x + constant = 0`
       reduces to `axis = constant` and the constant IS the cut's position along that axis.
       The model is centred on X and Y but SITS on z = 0, so the middle of a Z cut is half
       the height up — without that term, "0%" on Z cut at the build plate and the whole
       negative half of the slider did nothing. */
    const middle = sectionAxis === 'z' ? bounds.z / 2 : 0;
    clipPlane.constant = middle + sectionPos * half;
  }

  function applyView() {
    capGroup.position.z = viewMode === 'exploded' ? explodeOffset : 0;
    if (sectionOn) updateClipPlane();
    const planes = sectionOn ? [clipPlane] : [];
    for (const m of materials) (m as THREE.MeshStandardMaterial).clippingPlanes = planes;
    if (switchMaterial) switchMaterial.clippingPlanes = planes;
    updateCaps();
  }

  function setView(mode: ViewMode) {
    viewMode = mode;
    applyView();
  }

  // Remove the switch meshes from the group WITHOUT disposing the geometry/material —
  // every placement shares one BufferGeometry + material, freed once in setSwitch/dispose.
  function clearSwitchMeshes() {
    for (const child of [...switchGroup.children]) switchGroup.remove(child);
  }

  // Seat one mesh per placement, all sharing the (dense) switch geometry + material.
  function rebuildSwitchMeshes() {
    clearSwitchMeshes();
    if (!switchGeometry || !switchMaterial) return;
    for (const p of switchPlacements) {
      const m = new THREE.Mesh(switchGeometry, switchMaterial);
      m.position.set(p.x, p.y, p.z ?? 0);
      m.rotation.z = (p.rotation * Math.PI) / 180; // match the geometry's socket/stem rotation
      switchGroup.add(m);
    }
    applyView(); // pick up section clipping if it's active
  }

  // The real MX switch, already placed in the assembly frame (display only). Smooth
  // shading and no crease-splitting — the mesh is dense (~hundreds of k tris).
  function setSwitch(mesh: MeshData | null) {
    clearSwitchMeshes();
    switchGeometry?.dispose();
    switchGeometry = null;
    switchMaterial?.dispose();
    switchMaterial = null;
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3)); // numProp = 3
    geo.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
    geo.computeVertexNormals();
    switchGeometry = geo;
    switchMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x2a2a30),
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    rebuildSwitchMeshes();
  }

  function showSwitch(on: boolean) {
    switchGroup.visible = on;
  }

  function setSwitchPlacements(placements: SwitchPlacement[]) {
    switchPlacements = placements.length ? placements : [{ x: 0, y: 0, rotation: 0 }];
    rebuildSwitchMeshes();
  }

  function setSectionEnabled(on: boolean) {
    sectionOn = on;
    applyView();
  }

  function setSection(axis: SectionAxis, pos: number) {
    sectionAxis = axis;
    sectionPos = pos;
    if (sectionOn) {
      updateClipPlane();
      updateCaps();
    }
  }

  /**
   * A square PNG of the model, for embedding as a file's cover.
   *
   * Deliberately NOT a screenshot of the viewport. The first version was, and it showed: the
   * build plate and its grid filled most of the frame, the model sat wherever the user had
   * last dragged it, an exploded lid ran off the top edge, and the plate's noise texture made
   * a 512px PNG weigh 328KB — over half the export, twice, since it is written under two
   * names. This frames the model itself, on the flat scene background, from whatever angle
   * the user is viewing it at.
   *
   * The cut is switched off for the shot: a file whose cover shows a sliced model looks like
   * a broken model.
   */
  async function renderCoverPng(edge = 512): Promise<Uint8Array | null> {
    /* Restore from the RENDERER's own size, not from `container.clientWidth`. The container
       measures 0×0 whenever its pane is hidden or mid-layout, and restoring to that left the
       canvas permanently 0×0 — the viewport went black and only a window resize brought it
       back. The renderer always knows the size it is actually at. */
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevPos = camera.position.clone();
    const wasCut = sectionOn;
    const plateWasVisible = buildPlate.object.visible;

    if (wasCut) setSectionEnabled(false);
    buildPlate.object.visible = false;
    // The cutter is a tool, not part of the model: a cover with the cut plane through it would
    // look like a file with a stray sheet in it.
    const overlayWasVisible = overlayGroup.visible;
    overlayGroup.visible = false;

    // Frame whatever is actually on screen — exploded included, so a cover of an exploded
    // view shows both halves rather than clipping the one that floats above the frame.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().expandByObject(capGroup).expandByObject(bodyGroup);
    if (switchGroup.visible) box.expandByObject(switchGroup);
    const center = box.getCenter(new THREE.Vector3());
    // Sphere radius, so the fit holds at every orbit angle, and the frame is square, so the
    // vertical FOV governs both directions.
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * COVER_PAD;
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    camera.aspect = 1;
    camera.updateProjectionMatrix();

    // `updateStyle: false` — the drawing buffer changes shape, the canvas element on screen
    // does not, so nothing flickers while the shot is taken.
    renderer.setPixelRatio(1);
    renderer.setSize(edge, edge, false);
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>((res) =>
      renderer.domElement.toBlob((b) => res(b), 'image/png'),
    );

    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    camera.position.copy(prevPos);
    controls.update(); // re-aims the camera at the untouched orbit target
    buildPlate.object.visible = plateWasVisible;
    overlayGroup.visible = overlayWasVisible;
    if (wasCut) setSectionEnabled(true);
    renderer.render(scene, camera); // put the user's own frame back before they can see this one

    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  /**
   * A square picture on a transparent background, as a PNG data URL — a card's picture.
   *
   * Given `parts`, those: a result the viewport is not showing, built for the shot and freed
   * after it. Without, what is on screen, put back together if it is exploded. Always from the
   * default framing's angle rather than wherever the user has orbited to, so three cards side
   * by side compare the results and not the camera. Transparent, so the picture sits on the
   * card's own background in either theme. Synchronous: rendered and read in the same task, so
   * the frame on screen is restored before anything can paint in between.
   */
  function renderThumbnail(edge: number, parts?: ClickerPart[]): string | null {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevPos = camera.position.clone();
    const prevBackground = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const wasCut = sectionOn;
    const plateWasVisible = buildPlate.object.visible;
    const overlayWasVisible = overlayGroup.visible;
    const switchWasVisible = switchGroup.visible;
    const capZ = capGroup.position.z;
    const hovered = hoveredIndex;
    const selected = selectedIndices;

    if (wasCut) setSectionEnabled(false);
    buildPlate.object.visible = false;
    overlayGroup.visible = false;
    switchGroup.visible = false;
    // A hover glow or a selection outline is the pointer's business, not the picture's.
    hoveredIndex = null;
    selectedIndices = [];
    applyHighlight();

    let shot: THREE.Group | null = null;
    if (parts) {
      shot = new THREE.Group();
      for (const p of parts) {
        const mat = new THREE.MeshStandardMaterial({ color: color(p.colorRgb), metalness: 0, roughness: 0.5 });
        shot.add(new THREE.Mesh(partToGeometry(p), mat));
      }
      scene.add(shot);
      capGroup.visible = false;
      bodyGroup.visible = false;
    } else {
      capGroup.position.z = 0;
    }

    const box = new THREE.Box3();
    if (shot) {
      shot.updateMatrixWorld(true);
      box.expandByObject(shot);
    } else {
      root.updateMatrixWorld(true);
      box.expandByObject(capGroup).expandByObject(bodyGroup);
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.copy(center).addScaledVector(new THREE.Vector3(1, -1, 0.75).normalize(), dist);
    camera.lookAt(center);
    camera.aspect = 1;
    camera.updateProjectionMatrix();

    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    renderer.setSize(edge, edge, false);
    renderer.render(scene, camera);
    let url: string | null = null;
    try {
      url = renderer.domElement.toDataURL('image/png');
    } catch {
      url = null;
    }

    if (shot) {
      scene.remove(shot);
      disposeTree(shot);
      capGroup.visible = true;
      bodyGroup.visible = true;
    }
    capGroup.position.z = capZ;
    scene.background = prevBackground;
    renderer.setClearColor(prevClear, prevClearAlpha);
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    camera.position.copy(prevPos);
    controls.update(); // re-aims the camera at the untouched orbit target
    buildPlate.object.visible = plateWasVisible;
    overlayGroup.visible = overlayWasVisible;
    switchGroup.visible = switchWasVisible;
    hoveredIndex = hovered;
    selectedIndices = selected;
    applyHighlight();
    if (wasCut) setSectionEnabled(true);
    renderer.render(scene, camera);
    return url;
  }

  async function renderToPng(): Promise<Blob | null> {
    // Render one frame at 2× into an offscreen-sized target, then capture.
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
    if (w === 0 || h === 0) return; // container not laid out yet — wait for a real size
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  // The container is a CSS-grid cell whose height settles after this viewer is
  // constructed, so window 'resize' alone misses it (the canvas would stay stuck
  // at its tiny init size). Track the container directly.
  const resizeObserver = new ResizeObserver(() => onResize());
  resizeObserver.observe(container);

  let raf = 0;
  (function animate() {
    raf = requestAnimationFrame(animate);
    // Self-heal the canvas size: the container is a CSS-grid cell whose height
    // settles a frame or two after this viewer is built, and neither window
    // 'resize' nor the initial ResizeObserver callback reliably catches that
    // first settle — so the canvas can get stuck at its tiny init size. Compare
    // each frame and only call setSize when it actually drifts (cheap).
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0 && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio()))) {
      onResize();
    }
    controls.update();
    // The floor sits under the model; from below it would sit between the camera
    // and the part. Fade it to a ghost rather than dropping it, so the plate
    // never pops in and out as you orbit past level.
    buildPlate.setGhosted(camera.position.z <= floorZ);
    renderer.render(scene, camera);
    placePlaneHandle();
  })();

  // Paint hover/selection glow via emissive (keeps each part's true base color).
  function applyHighlight() {
    if (outlineMesh) {
      outlineMesh.removeFromParent();
      outlineMesh.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
      });
      outlineMesh = null;
    }
    for (let i = 0; i < partMeshes.length; i++) {
      const isSelected = selectedIndices.includes(i);
      const isHovered = hoveredIndex === i;
      const m = materials[i] as THREE.MeshStandardMaterial;
      if (m) {
        if (isSelected || isHovered) {
          m.emissive.copy(HILITE);
          m.emissiveIntensity = isHovered ? 0.4 : 0.2;
        } else {
          m.emissiveIntensity = 0;
        }
      }
    }

    if (selectedIndices.length > 0) {
      const outlineGroup = new THREE.Group();
      for (const idx of selectedIndices) {
        const mesh = partMeshes[idx];
        if (mesh) {
          const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
          const subOutline = new THREE.LineSegments(edges, outlineMaterial);
          subOutline.position.copy(mesh.position);
          subOutline.quaternion.copy(mesh.quaternion);
          subOutline.scale.copy(mesh.scale);
          outlineGroup.add(subOutline);
        }
      }
      outlineMesh = outlineGroup as any;
      outlineMesh!.renderOrder = 999;
      partMeshes[selectedIndices[0]].parent?.add(outlineMesh!);
    } else if (hoveredIndex !== null && partMeshes[hoveredIndex]) {
      const mesh = partMeshes[hoveredIndex];
      const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
      outlineMesh = new THREE.LineSegments(edges, outlineMaterial) as any;
      outlineMesh!.renderOrder = 999;
      mesh.parent?.add(outlineMesh!);
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
    if (e.buttons !== 0) return; // mid orbit/pan — don't fight the controls

    // Model mode: the cut plane is a handle, and says so; placing a button is aiming, not picking.
    if (overPlane(e.clientX, e.clientY)) {
      renderer.domElement.style.cursor = 'ns-resize';
      if (hoveredIndex !== null) {
        hoveredIndex = null;
        applyHighlight();
      }
      return;
    }
    if (pickMode === 'surface') {
      renderer.domElement.style.cursor = pickIndexAt(e.clientX, e.clientY) === null ? '' : 'crosshair';
      return;
    }

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
    // A press that grabbed the cut plane was a drag of the plane, however short.
    if (pressGrabbedPlane) {
      pressGrabbedPlane = false;
      return;
    }
    // Only a tap (not an orbit drag) counts as a part click.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    if (performance.now() - downT > 500) return;

    if (pickMode === 'surface') {
      // Where on the model the tap landed, in the parts' own coordinates — the hit mesh's group
      // may be lifted by the exploded view, and worldToLocal takes that back off.
      aimRay(e.clientX, e.clientY);
      const hit = raycaster.intersectObjects(partMeshes, false)[0];
      if (hit && hit.object.parent) {
        const p = hit.object.parent.worldToLocal(hit.point.clone());
        surfaceCb?.(p.x, p.y, p.z);
      }
      return;
    }

    const idx = pickIndexAt(e.clientX, e.clientY);

    // Empty space clears the selection (all modes).
    if (idx === null) {
      selectedIndices = [];
      applyHighlight();
      pickCb?.(null, e.clientX, e.clientY, e.shiftKey);
      return;
    }

    // Shift-click toggles multi-selection in every mode; plain click selects one.
    if (e.shiftKey) {
      selectedIndices = selectedIndices.includes(idx)
        ? selectedIndices.filter(i => i !== idx)
        : [...selectedIndices, idx];
    } else {
      selectedIndices = [idx];
    }
    applyHighlight();
    pickCb?.(idx, e.clientX, e.clientY, e.shiftKey);
  };
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerdown', onPlanePointerDown, { capture: true });
  renderer.domElement.addEventListener('pointermove', onPlanePointerMove);
  renderer.domElement.addEventListener('pointerup', onPlanePointerUp);
  renderer.domElement.addEventListener('pointercancel', onPlanePointerUp);

  function onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) {
    pickCb = cb;
  }
  function setPartColor(index: number, rgb: RGB) {
    const m = materials[index] as THREE.MeshStandardMaterial | undefined;
    if (m) m.color = color(rgb);
  }
  function highlightPart(index: number | null) {
    selectedIndices = index !== null ? [index] : [];
    applyHighlight();
  }
  function highlightParts(indices: number[]) {
    selectedIndices = indices;
    applyHighlight();
  }
  function clearHighlight() {
    selectedIndices = [];
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
    renderer.domElement.removeEventListener('pointerdown', onPlanePointerDown, { capture: true });
    renderer.domElement.removeEventListener('pointermove', onPlanePointerMove);
    renderer.domElement.removeEventListener('pointerup', onPlanePointerUp);
    renderer.domElement.removeEventListener('pointercancel', onPlanePointerUp);
    setPlaneHandle(null);
    setCutterOverlay(null);
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    clearCaps();
    capQuadGeom.dispose();
    buildPlate.dispose();
    clearSwitchMeshes();
    switchGeometry?.dispose();
    switchMaterial?.dispose();
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  function setTheme(theme: string) {
    const bgColor = sceneBg();
    scene.background = new THREE.Color(bgColor);
    buildPlate.setTheme(theme);
  }

  return {
    setParts,
    setView,
    setSectionEnabled,
    setSection,
    setSwitch,
    showSwitch,
    setSwitchPlacements,
    renderToPng,
    renderCoverPng,
    renderThumbnail,
    setTheme,
    setPlate: (choice) => buildPlate.setChoice(choice),
    onPartPick,
    setPartColor,
    highlightPart,
    highlightParts,
    clearHighlight,
    setCutterOverlay,
    setExplodeGap: (mm) => {
      explodeGap = mm;
      explodeOffset = mm ?? bounds.z * 0.8 + 10;
      applyView();
    },
    onPlaneDrag: (cb) => { planeDragCb = cb; },
    setPlaneHandle,
    setPickMode: (mode) => {
      pickMode = mode;
      if (mode === 'surface') {
        hoveredIndex = null;
        applyHighlight();
      }
    },
    onSurfacePick: (cb) => { surfaceCb = cb; },
    dispose,
  };
}
