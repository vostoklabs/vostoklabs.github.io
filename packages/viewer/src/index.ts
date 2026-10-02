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
import { themeColorHex } from '@vostok/ui-kit';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';

// `setPlate` takes this, so an app that calls it needs to be able to name it without
// taking its own dependency on @vostok/plates just for a type.
export type { PlateChoice };

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
  /**
   * Replace the model. `refit` re-frames the camera; otherwise the view is left alone.
   *
   * `anchor` is a model point to hold at the origin instead of centring the bounding box.
   * Centring is right for a single object; for an assembly whose extent changes as parts
   * come and go, it moves the part the user is looking at on every rebuild. A generator
   * that knows which part is the stable one passes its centre here.
   */
  setParts(parts: ViewerPart[], refit?: boolean, anchor?: [number, number, number]): void;
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
  /** Which part is under the pointer, or null. For a drag that starts on a specific part. */
  pickPart(clientX: number, clientY: number): number | null;
  /** Where the pointer's ray meets an axis-aligned plane (`axis` = `value`), in model
   *  coordinates — what a drag reads once the pointer has left the part it picked up. */
  pickOnPlane(clientX: number, clientY: number, value: number, axis?: 'z' | 'y'): [number, number, number] | null;
  /** Slide one part without rebuilding it — how a drag stays smooth. Cleared by `setParts`. */
  setPartOffset(index: number, offset: [number, number, number]): void;
  /** Place one part: a translation and a rotation about the Y axis, in model coordinates —
   *  how an animation moves a part without touching its geometry. Cleared by `setParts`. */
  setPartPose(index: number, position: [number, number, number], rotationY: number): void;
  /** Show or hide the build plate. */
  setPlateVisible(on: boolean): void;
  /** Hand the viewer a hierarchy it did not build — a fold rig, a linkage, anything
   *  whose parts are parented to each other rather than sitting flat on the root.
   *
   *  It lives in its own group beside the parts, because `setParts` clears the root
   *  and does NOT traverse Group children: a hierarchy parented there would lose
   *  every descendant's geometry and material on the next rebuild without ever
   *  disposing them. Pass null to clear. The viewer takes ownership and disposes
   *  the whole subtree.
   *
   *  Framing uses the rig's extent at the moment it is set, and is never touched
   *  again — so a rig that animates does not drag the camera around with it. */
  setFoldRig(rig: THREE.Object3D | null, refit?: boolean): void;
  /** Put the fold rig back down on the floor after its progress has changed.
   *
   *  `setFoldRig` seats the model by measuring it ONCE, and that measurement stops
   *  being true the moment the fold moves — six of foldbox's nine styles swing a panel
   *  below where it put the floor, by up to 16 mm, which over a build plate reads as
   *  the box sinking into the bed. Call this whenever the fold is scrubbed or played;
   *  it only touches Z, so the framing and the centring stay where they were. */
  settleFoldRig(): void;
  /** Swap the floor: a build plate, or the plain grid. */
  setPlate(choice: PlateChoice): void;
  setTheme(theme: string): void;
  /** Suspend orbit — while dragging a handle, for instance. */
  setOrbitEnabled(on: boolean): void;
  /** A 2x-supersampled PNG of the current view, at the viewport's own size. */
  renderToPng(): Promise<Blob | null>;
  /** A square, framed PNG of the whole model for a cover image: a fixed three-quarter
   *  angle, the build plate off, and an explicit edge in pixels (default 512). */
  renderCoverPng(edge?: number): Promise<Blob | null>;
  /** Escape hatches for generator-specific overlays. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Where the model group sits, so overlays can follow it. */
  readonly root: THREE.Group;
  dispose(): void;
}

// The floor sits BELOW the model's bottom face (z = 0) so the solid bottom occludes
// it cleanly — coplanar at z = 0 causes z-fighting.
//
// How far below cannot be a constant, which is what it used to be. Depth-buffer
// precision falls off as the SQUARE of the viewing distance, so a gap that is ample
// on a keycap is beneath the buffer's notice on a carton blank lying on a build
// plate: at 40 mm the buffer resolves 0.001 mm, at 400 mm only 0.095 mm. A flat
// blank sitting 0.06 mm above the plate therefore lands in the same depth bucket as
// the plate, and the plate's speckle texture and grid lines punch straight through
// it. `floorGapFor` keeps the gap ahead of the buffer instead.
const FLOOR_GAP = 0.06;
const NEAR = 0.1;
const FAR = 5000;

/** Cover framing: how much air round the model's bounding sphere, and the fixed
 *  three-quarter direction the cover is shot from (Z up, the same quarter the 'iso'
 *  preset uses, so a cover looks like the view the user has been working in). */
const COVER_PAD = 1.15;
const COVER_DIR = new THREE.Vector3(1, -1, 0.75).normalize();

/** Smallest depth difference the 24-bit buffer can still tell apart at distance `z`. */
function depthResolution(z: number): number {
  return (z * z * (FAR - NEAR)) / (NEAR * FAR * 16777216);
}

/** Twelve depth buckets of clearance, and never less than the old constant — so
 *  every model small enough to have been fine already is left exactly as it was. */
function floorGapFor(dist: number): number {
  return Math.max(FLOOR_GAP, depthResolution(dist) * 12);
}

function readTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Scene background = the `--bg` token, read live so the viewport can never seam against
 *  the chrome behind it. Fallbacks are the values these files used to hardcode. */
const sceneBg = () => themeColorHex('--bg', readTheme() === 'light' ? 0xf3f4f6 : 0x15171c);

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
  scene.background = new THREE.Color(sceneBg());

  const camera = new THREE.PerspectiveCamera(45, aspect(), NEAR, FAR);
  camera.up.set(0, 0, 1); // Z up (CAD)
  camera.position.set(60, -60, 45);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(40, -30, 70);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  let floorZ = -FLOOR_GAP;
  const buildPlate: BuildPlate = createBuildPlate(THREE, { theme, topZ: floorZ });
  buildPlate.setChoice(loadPlateChoice());
  scene.add(buildPlate.object);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const root = new THREE.Group();
  scene.add(root);

  // A sibling of `root`, deliberately: `clearParts` empties the root on every
  // rebuild, so anything long-lived and hierarchical has to live outside it.
  const rig = new THREE.Group();
  scene.add(rig);

  const materials: THREE.MeshStandardMaterial[] = [];
  const partMeshes: THREE.Mesh[] = [];

  // Radius the camera was last framed for. A rebuild only re-frames when the
  // model grew or shrank enough to leave the view — otherwise dragging a slider
  // would yank the camera back to default on every tick.
  let framedRadius = 0;
  let lastSize = new THREE.Vector3(40, 40, 10);
  /** Where the model's centre ended up in world space after `setParts` positioned it. The
   *  presets aim here. With no anchor it is (0, 0, height/2) — the model sits on the plate —
   *  but an anchored assembly can hang below the origin, and aiming at height/2 then framed
   *  empty air above it. */
  let lastCentre = new THREE.Vector3(0, 0, 5);

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

  /** Dispose a whole subtree. `clearParts` only reaches direct Mesh children, which
   *  is enough for the flat part list and not enough for anything nested. */
  function disposeSubtree(obj: THREE.Object3D) {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const m = child.material;
        if (Array.isArray(m)) for (const one of m) one.dispose();
        else (m as THREE.Material).dispose();
      }
    });
  }

  /** Lowest point of the fold rig right now, measured from a zeroed offset so the
   *  last frame's lift cannot compound into this one. */
  function settleFoldRig(): void {
    if (!rig.children.length) return;
    const prev = rig.position.z;
    rig.position.z = 0;
    rig.updateMatrixWorld(true);
    const min = new THREE.Box3().setFromObject(rig).min.z;
    if (!Number.isFinite(min)) {
      rig.position.z = prev;
      return;
    }
    // Keep whatever is currently lowest resting ON the floor. A box folding on a
    // table never passes through it, and this is the same statement.
    rig.position.z = -min;
  }

  function setFoldRig(next: THREE.Object3D | null, refit = false) {
    for (const child of [...rig.children]) {
      rig.remove(child);
      disposeSubtree(child);
    }
    if (!next) return;
    rig.add(next);

    // Same measure-from-zero discipline as setParts: `setFromObject` reuses the
    // parent's cached matrix, so measuring without resetting first folds the last
    // build's offset into this one and the model creeps on every rebuild.
    rig.position.set(0, 0, 0);
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    if (!Number.isFinite(box.min.x)) return;
    const centre = box.getCenter(new THREE.Vector3());
    rig.position.set(-centre.x, -centre.y, -box.min.z);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);

    if (refit || framedRadius === 0) {
      framedRadius = radius;
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(0, 0, size.z / 2);
      camera.position
        .copy(controls.target)
        .add(offset.setLength(radius * FRAME_MUL + FRAME_PAD));
      controls.update();
    }
  }

  function setParts(parts: ViewerPart[], refit = false, anchor?: [number, number, number]) {
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
    if (anchor) root.position.set(-anchor[0], -anchor[1], -anchor[2]);
    else root.position.set(-centre.x, -centre.y, -box.min.z);
    lastSize = box.getSize(new THREE.Vector3());
    lastCentre = centre.clone().add(root.position);

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
      // Only a camera that is still roughly at the framing distance follows the frame out.
      // A user who has zoomed in on a detail has said where they want to look: a rebuild
      // that grows the model leaves them there, however much longer the chain gets — the
      // camera leaping out to frame a chain they were not looking at was the jump.
      const wasFramed = framedRadius === 0 || offset.length() >= (framedRadius * FRAME_MUL + FRAME_PAD) * 0.85;
      if (wasFramed && offset.length() < needed) {
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
    const c = lastCentre;
    // Face-on views keep a few degrees of tilt: dead-on would put the view axis
    // parallel to camera.up (Z) and leave the roll undefined.
    const tilt = dist * 0.08;
    switch (preset) {
      case 'front': camera.position.set(c.x, c.y - dist, c.z + tilt); break;
      case 'back': camera.position.set(c.x, c.y + dist, c.z + tilt); break;
      case 'left': camera.position.set(c.x - dist, c.y, c.z + tilt); break;
      case 'right': camera.position.set(c.x + dist, c.y, c.z + tilt); break;
      case 'top': camera.position.set(c.x, c.y - tilt, c.z + dist); break;
      case 'bottom': camera.position.set(c.x, c.y + tilt, c.z - dist); break;
      default: camera.position.set(c.x + dist, c.y - dist, c.z + dist * 0.75 - lastSize.z / 2);
    }
    controls.target.copy(c);
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

  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  function pickOnPlane(clientX: number, clientY: number, value: number, axis: 'z' | 'y' = 'z'): [number, number, number] | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (axis === 'z') dragPlane.set(new THREE.Vector3(0, 0, 1), -(value + root.position.z));
    else dragPlane.set(new THREE.Vector3(0, 1, 0), -(value + root.position.y));
    if (!raycaster.ray.intersectPlane(dragPlane, dragHit)) return null;
    return [dragHit.x - root.position.x, dragHit.y - root.position.y, dragHit.z - root.position.z];
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
  /** True while `renderCoverPng` owns the canvas. The self-heal below would otherwise
   *  resize the drawing buffer back to the viewport between the cover render and the
   *  `toBlob` that reads it — which clears it, and the cover comes back blank. */
  let capturing = false;
  (function animate() {
    raf = requestAnimationFrame(animate);
    if (capturing) return;
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
    // Depth precision follows where the camera actually IS, not how the model was
    // framed, so this tracks the zoom rather than being set once per build. Cheap:
    // `setTopZ` is a position write, and the guard means it only fires on real moves.
    //
    // Measured to the FAR side of the model, not to the point the camera is aimed at.
    // A big flat blank seen at a grazing angle has its far edge hundreds of mm beyond
    // the centre, and precision falls off as the square of distance — so sizing the
    // gap on the centre leaves the far half of the sheet still fighting the plate,
    // which is exactly how it looks: clean near the camera, hatched further away.
    // A hidden plate has no reach: framing against it left a hanging model tiny in the view.
    const reach = Math.max(framedRadius, buildPlate.object.visible ? buildPlate.radius() : 0);
    const wantFloor = -floorGapFor(camera.position.distanceTo(controls.target) + reach);
    if (Math.abs(wantFloor - floorZ) > 1e-3) {
      floorZ = wantFloor;
      buildPlate.setTopZ(floorZ);
    }
    // From below, a solid plate would sit between the camera and the model —
    // ghost it rather than hiding it, so it never pops as you orbit past level.
    buildPlate.setGhosted(camera.position.z <= floorZ);
    renderer.render(scene, camera);
  })();

  // ---- theme ----
  function setTheme(next: string) {
    theme = next === 'light' ? 'light' : 'dark';
    scene.background = new THREE.Color(sceneBg());
    buildPlate.setTheme(theme);
  }
  const themeObserver =
    opts.observeTheme === false
      ? null
      : new MutationObserver(() => setTheme(readTheme()));
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /**
   * A cover image, deliberately NOT a screenshot of the viewport.
   *
   * A screenshot ships whatever the user last dragged: the model half out of frame, the
   * build plate and its grid filling most of the picture, and a PNG sized by the pane —
   * foldbox's was 1704 x 1698 and about 3 MB as a data URL, six times the clicker's.
   * This frames the model itself, square, from one fixed three-quarter angle, on the flat
   * scene background, at `edge` pixels a side.
   *
   * The angle is fixed rather than the user's, so two exports of the same box produce the
   * same cover: a cover is the product shot, not a record of the last orbit.
   */
  async function renderCoverPng(edge = 512): Promise<Blob | null> {
    /* Restore from the RENDERER's own size, not from `container.clientWidth`. The container
       measures 0 x 0 whenever its pane is hidden or mid-layout, and restoring to that leaves
       the canvas permanently 0 x 0 — the viewport goes black until a window resize. */
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevPos = camera.position.clone();
    const prevTarget = controls.target.clone();
    const plateWasVisible = buildPlate.object.visible;

    capturing = true;
    // `finally`, because a throw in here would otherwise leave the viewport frozen at 512 px
    // with the plate gone and the render loop parked: the capture owns the canvas, so it has
    // to hand it back whatever happens.
    try {
      buildPlate.object.visible = false;
      root.updateMatrixWorld(true);
      rig.updateMatrixWorld(true);

      // Both the flat parts and anything hierarchical (a fold rig), so a model that lives
      // only in the rig — which is every foldbox box — is framed rather than missed.
      const box = new THREE.Box3();
      if (partMeshes.length) box.expandByObject(root);
      if (rig.children.length) box.expandByObject(rig);
      if (!box.isEmpty()) {
        const centre = box.getCenter(new THREE.Vector3());
        // Sphere radius, so the fit holds at any angle, and the frame is square, so the
        // vertical FOV governs both directions.
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
        const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * COVER_PAD;
        camera.position.copy(centre).addScaledVector(COVER_DIR, dist);
        camera.lookAt(centre);
      }
      camera.aspect = 1;
      camera.updateProjectionMatrix();

      // `updateStyle: false` — the drawing buffer changes shape, the canvas element on
      // screen does not, so nothing flickers while the shot is taken.
      renderer.setPixelRatio(1);
      renderer.setSize(edge, edge, false);
      renderer.render(scene, camera);
      return await new Promise<Blob | null>((res) => renderer.domElement.toBlob((b) => res(b), 'image/png'));
    } finally {
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      camera.position.copy(prevPos);
      controls.target.copy(prevTarget);
      controls.update(); // re-aims the camera at the user's own orbit target
      buildPlate.object.visible = plateWasVisible;
      renderer.render(scene, camera); // put the user's frame back before they can see this one
      capturing = false;
    }
  }

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
    setFoldRig(null);
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
    pickPart: pickIndexAt,
    pickOnPlane,
    setPartOffset(index, offset) {
      const m = partMeshes[index];
      if (m) m.position.set(offset[0], offset[1], offset[2]);
    },
    setPlateVisible(on) {
      buildPlate.object.visible = on;
    },
    setPartPose(index, position, rotationY) {
      const m = partMeshes[index];
      if (!m) return;
      m.position.set(position[0], position[1], position[2]);
      m.rotation.set(0, rotationY, 0);
    },
    setFoldRig,
    settleFoldRig,
    setPlate: (choice) => buildPlate.setChoice(choice),
    setTheme,
    setOrbitEnabled: (on) => {
      controls.enabled = on;
    },
    renderToPng,
    renderCoverPng,
    scene,
    camera,
    root,
    dispose,
  };
}
