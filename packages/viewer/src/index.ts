// The standard Vostok Labs 3D preview, extracted from the magnet generator's
// viewer so a new generator gets a working stage on day one: Z-up CAD frame,
// ACES + room-environment PBR, a build plate under the model, view presets,
// part picking and highlighting, and a PNG grab for cover images.
//
// Existing generators still ship their own viewer (each has app-specific extras
// — section/explode, magnet handles, socket markers). This is the baseline the
// template starts from and the place to grow shared behaviour: the options and
// hooks below are what lets an app keep its extras beside this stage instead of
// in a copy of it, and every one of them is off until an app asks for it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { themeColorHex } from '@vostok/ui-kit';
import { createBuildPlate, type BuildPlate } from '@vostok/plates/three';
import { loadPlateChoice, type PlateChoice } from '@vostok/plates';
import {
  COVER_DIR, FLOOR_GAP, FAR, NEAR, coverDistance, fillDistance, floorGapFor, followOutDistance, frameDistance,
  presetDirection, presetPosition, seatOf, type ViewPreset,
} from './framing';
import { partGeometry } from './mesh';

// `setPlate` takes this, so an app that calls it needs to be able to name it without
// taking its own dependency on @vostok/plates just for a type.
export type { PlateChoice, ViewPreset };

export type RGB = [number, number, number];

/** One coloured body of the model — the shape a manifold/three mesh reduces to. */
export interface ViewerPart {
  name: string;
  /** Flat xyz triples, millimetres — or `stride` floats per vertex, xyz first. */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  /** Filament colour, 0-255. */
  color: RGB;
  /** Floats per vertex in `positions`, xyz first: a manifold mesh's `numProp`. Default 3. */
  stride?: number;
  /**
   * The named group the part is drawn in (`Viewer.layer`), so an app can move all of a layer's
   * parts together: the top of an exploded view. Default: none, the part sits in the model
   * group itself.
   */
  layer?: string;
}

export interface ViewerOptions {
  /** Camera distance = model radius * this + `framePad`. */
  frameMul?: number;
  framePad?: number;
  /** Follow `<html data-theme>` automatically. Default true — turn it off only
   *  if the app wants to drive `setTheme` itself. */
  observeTheme?: boolean;
  /**
   * Frame the model so its bounding sphere fills `fill` of the narrower field of view, so it
   * covers the same share of the stage whatever the stage's shape; every view then puts the
   * camera at that distance. Default: the `frameMul` and `framePad` rule.
   */
  frame?: { fill: number };
  /**
   * The light. 'studio' (the default): a room environment, a key light and ACES tone mapping.
   * 'soft': a hemisphere light with a white key and a cool fill, no environment and no tone
   * mapping, the keycap generator's stage.
   */
  look?: 'studio' | 'soft';
  /** Ask the context for a stencil buffer, which a section view's caps are drawn through.
   *  Default false. `hasStencil` says whether the context gave one. */
  stencil?: boolean;
  /** A canvas that can show through where nothing is drawn, which `renderThumbnail` needs for
   *  a picture on a transparent background. The stage itself still paints its background over
   *  every pixel. Default false. */
  alpha?: boolean;
  /** Let a material carry its own clipping planes (a section view). Default false. */
  localClipping?: boolean;
  /** Keep a drawn frame readable after it is shown, for pictures taken of it. Default true. */
  preserveDrawingBuffer?: boolean;
  /** Hand the WebGL context back to the browser on dispose instead of waiting for it to be
   *  collected. Default false. */
  forceContextLoss?: boolean;
  /** Draw into this canvas rather than one of the viewer's own. The viewer does not move it
   *  and leaves it where it is on dispose. Default: a new canvas, added to the container. */
  canvas?: HTMLCanvasElement;
  /** Shift-click adds a part to the selection or takes it out of it; a plain click still
   *  selects one. Default false: every click selects one part. */
  multiSelect?: boolean;
  /** Draw the selected parts' edges (or the hovered part's, when none is selected) over
   *  everything else, on the part itself, so they move, turn and hide with it. Default false:
   *  the glow alone. */
  outline?: boolean;
}

/** How a cover is shot (`renderCoverPng`). */
export interface CoverOptions {
  /** Pixels a side. Default 512. */
  edge?: number;
  /** 'iso' (the default): from a fixed three-quarter angle, so two covers of one model match.
   *  'view': from the way the user is looking at it now. */
  angle?: 'iso' | 'view';
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
   *
   * The model is measured with every layer in its place, so a layer an app has moved (an
   * exploded top) does not move where the model sits.
   */
  setParts(parts: ViewerPart[], refit?: boolean, anchor?: [number, number, number]): void;
  /** Frame the model from a named angle. */
  setView(preset: ViewPreset): void;
  /** Recolour one part in place, without rebuilding its geometry. */
  setPartColor(index: number, color: RGB): void;
  /** Replace one part's shape, without rebuilding the others or moving the camera: its colour,
   *  its place in the list and any offset or pose it has stay. */
  setPartGeometry(index: number, part: Pick<ViewerPart, 'positions' | 'indices' | 'stride'>): void;
  /** Show or hide one part. A hidden part is not picked, and a cover or a thumbnail is framed
   *  without it; so is a part in a layer the app has hidden. */
  setPartVisible(index: number, on: boolean): void;
  /** Called with the clicked part's index, or null when the click missed. */
  onPartPick(cb: (index: number | null, event: PointerEvent) => void): void;
  highlightPart(index: number | null): void;
  /** Select several parts at once, as shift-clicking each does with `multiSelect`. */
  highlightParts(indices: number[]): void;
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
  /** The group a layer's parts are drawn in (`ViewerPart.layer`), made the first time it is
   *  asked for and kept across `setParts`: move it, and its parts move. */
  layer(name: string): THREE.Group;
  /** The parts' meshes, in part order. */
  partMeshes(): THREE.Mesh[];
  /** Called after every `setParts`, once the parts are built and the model is seated, with
   *  their meshes. Returns a function that stops it. */
  onPartsSet(cb: (meshes: THREE.Mesh[], parts: ViewerPart[]) => void): () => void;
  /** Called once a frame, before the frame is drawn. Returns a function that stops it. */
  onFrame(cb: () => void): () => void;
  /** Stop drawing while something covers the stage, and start again. */
  setPaused(paused: boolean): void;
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
  /**
   * A square, framed PNG of the whole model for a cover image: from a fixed three-quarter angle
   * (or the user's own, with `angle: 'view'`), on the stage's background, an explicit edge in
   * pixels a side (default 512).
   *
   * What a picture shows, this and `renderThumbnail` alike: the model as it is built, every layer
   * back in its place (an exploded view is shot put together) and the fold rig as it stands,
   * framed whole. Not the build plate, not a part that is hidden, and none of the pointer's
   * business: no hover, no selection, no outline. The stage gets all of it back once the picture
   * is taken.
   */
  renderCoverPng(opts?: number | CoverOptions): Promise<Blob | null>;
  /**
   * A square picture, as a PNG data URL: of `parts` if given (a result the stage is not
   * showing, built for the picture and freed after it), otherwise of the model on the stage,
   * shown as `renderCoverPng` shows it. From the default three-quarter angle whatever the user
   * has orbited to, so pictures side by side compare the models and not the camera. On a
   * transparent background with `alpha`, on the stage's background without. Null if the canvas
   * cannot be read.
   */
  renderThumbnail(edge: number, parts?: ViewerPart[]): string | null;
  /** Escape hatches for generator-specific overlays. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Where the model group sits, so overlays can follow it. */
  readonly root: THREE.Group;
  readonly controls: OrbitControls;
  readonly renderer: THREE.WebGLRenderer;
  /** Whether the context has a stencil buffer: asked for with `stencil`, and given. Without
   *  one every stencil test passes, so stencilled caps would paint across the whole scene. */
  readonly hasStencil: boolean;
  dispose(): void;
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

export function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Viewer {
  const FRAME_MUL = opts.frameMul ?? 2.2;
  const FRAME_PAD = opts.framePad ?? 15;
  const soft = opts.look === 'soft';

  // Only what an app asked for is passed: the parameters the renderer has always been made
  // with are the parameters it is made with.
  const params: THREE.WebGLRendererParameters = { antialias: true, preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true };
  if (opts.canvas) params.canvas = opts.canvas;
  if (opts.stencil) params.stencil = true;
  if (opts.alpha) params.alpha = true;
  const renderer = new THREE.WebGLRenderer(params);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  if (!soft) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (opts.localClipping) renderer.localClippingEnabled = true;
  if (!opts.canvas) container.appendChild(renderer.domElement);
  const hasStencil = !!opts.stencil && renderer.getContext().getContextAttributes()?.stencil === true;

  let theme = readTheme();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sceneBg());

  const camera = new THREE.PerspectiveCamera(45, aspect(), NEAR, FAR);
  camera.up.set(0, 0, 1); // Z up (CAD)
  camera.position.set(60, -60, 45);

  let pmrem: THREE.PMREMGenerator | null = null;
  if (soft) {
    // The keycap generator's stage, turned Z-up: sky from above, a white key over the front
    // right shoulder, a cool fill from behind on the left.
    const sky = new THREE.HemisphereLight(0xffffff, 0x404654, 1.05);
    sky.position.set(0, 0, 1);
    scene.add(sky);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(12, -18, 30);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
    fill.position.set(-18, 14, 10);
    scene.add(fill);
  } else {
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(40, -30, 70);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  }

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
  /** The layers asked for, by name: groups inside `root` that `clearParts` empties but keeps. */
  const layers = new Map<string, THREE.Group>();
  const partsSetHooks = new Set<(meshes: THREE.Mesh[], parts: ViewerPart[]) => void>();
  const frameHooks = new Set<() => void>();

  // Radius the camera was last framed for. A rebuild only re-frames when the
  // model grew or shrank enough to leave the view — otherwise dragging a slider
  // would yank the camera back to default on every tick.
  let framedRadius = 0;
  /** The extent the camera was last framed for, which `frame` measures by. */
  const framedSize = new THREE.Vector3();
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

  /** How far from the model the camera is framed: `radius` is the model's largest extent,
   *  `size` its extent on each axis. */
  function distanceFor(radius: number, size: THREE.Vector3): number {
    if (opts.frame) return fillDistance(size.length() / 2, camera.fov, camera.aspect, opts.frame.fill);
    return frameDistance(radius, FRAME_MUL, FRAME_PAD);
  }

  function disposeMesh(mesh: THREE.Mesh) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  function clearParts() {
    clearOutline();
    for (const child of [...root.children]) {
      // A layer stays where the app put it; only its parts go.
      if (child instanceof THREE.Group && [...layers.values()].includes(child)) {
        for (const part of [...child.children]) {
          child.remove(part);
          if (part instanceof THREE.Mesh) disposeMesh(part);
        }
        continue;
      }
      root.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    materials.length = 0;
    partMeshes.length = 0;
  }

  function layer(name: string): THREE.Group {
    let group = layers.get(name);
    if (!group) {
      group = new THREE.Group();
      group.name = `layer:${name}`;
      layers.set(name, group);
      root.add(group);
    }
    return group;
  }

  /** Every layer moved back into its place while `fn` measures or draws, then put back. */
  function withLayersInPlace<T>(fn: () => T): T {
    if (!layers.size) return fn();
    const moved = [...layers.values()].map((g) => [g, g.position.clone(), g.quaternion.clone()] as const);
    for (const [g] of moved) {
      g.position.set(0, 0, 0);
      g.quaternion.identity();
    }
    try {
      return fn();
    } finally {
      for (const [g, p, q] of moved) {
        g.position.copy(p);
        g.quaternion.copy(q);
      }
    }
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
      framedSize.copy(size);
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(0, 0, size.z / 2);
      camera.position
        .copy(controls.target)
        .add(offset.setLength(distanceFor(radius, size)));
      controls.update();
    }
  }

  function setParts(parts: ViewerPart[], refit = false, anchor?: [number, number, number]) {
    buildParts(parts, refit, anchor);
    if (partsSetHooks.size) {
      const meshes = partMeshes.slice();
      for (const cb of [...partsSetHooks]) cb(meshes, parts);
    }
  }

  function buildParts(parts: ViewerPart[], refit: boolean, anchor?: [number, number, number]) {
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
      const mesh = new THREE.Mesh(partGeometry(p), mat);
      mesh.userData.partIndex = i;
      mesh.userData.partName = p.name;
      partMeshes.push(mesh);
      (p.layer === undefined ? root : layer(p.layer)).add(mesh);
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
    const box = withLayersInPlace(() => {
      root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(root);
    });
    const seat = seatOf(box, anchor);
    root.position.copy(seat.offset);
    lastSize = box.getSize(new THREE.Vector3());
    lastCentre = seat.centre;

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
    // genuinely needs more room (`followOutDistance`).
    const offset = camera.position.clone().sub(controls.target);
    const to = followOutDistance(
      offset.length(),
      framedRadius === 0 ? null : distanceFor(framedRadius, framedSize),
      distanceFor(radius, lastSize),
      radius > framedRadius,
    );
    if (to !== null) {
      camera.position.copy(controls.target).add(offset.setLength(to));
      controls.update();
    }
    framedRadius = radius;
    framedSize.copy(lastSize);
  }

  /** Point the camera at the model from a preset angle, at a fitting distance. */
  function setView(preset: ViewPreset) {
    const radius = Math.max(lastSize.x, lastSize.y, lastSize.z);
    if (opts.frame) camera.position.copy(lastCentre).addScaledVector(presetDirection(preset), distanceFor(radius, lastSize));
    else presetPosition(preset, lastCentre, lastSize, frameDistance(radius, FRAME_MUL, FRAME_PAD), camera.position);
    controls.target.copy(lastCentre);
    controls.update();
    framedRadius = radius;
    framedSize.copy(lastSize);
  }

  // ---- picking, hover and selection ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const HILITE = new THREE.Color(0x3b82f6);
  let hoveredIndex: number | null = null;
  /** The selected parts: one, or with `multiSelect` and shift-clicks, several. */
  let selected: number[] = [];
  let pickCb: ((index: number | null, event: PointerEvent) => void) | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;

  /** The edges drawn over the selection (`outline`), and their one material. */
  const outlines: THREE.LineSegments[] = [];
  const outlineMaterial = opts.outline ? new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false }) : null;

  function clearOutline() {
    for (const line of outlines) {
      line.removeFromParent();
      line.geometry.dispose();
    }
    outlines.length = 0;
  }

  function applyHighlight() {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]!;
      const on = selected.includes(i) || hoveredIndex === i;
      if (on) {
        m.emissive.copy(HILITE);
        m.emissiveIntensity = hoveredIndex === i ? 0.4 : 0.2;
      } else {
        m.emissiveIntensity = 0;
      }
    }
    if (!outlineMaterial) return;
    clearOutline();
    const traced = selected.length ? selected : hoveredIndex !== null ? [hoveredIndex] : [];
    for (const i of traced) {
      const mesh = partMeshes[i];
      if (!mesh) continue;
      // On the part itself, so an offset, a pose or hiding it takes its outline along.
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 15), outlineMaterial);
      line.renderOrder = 999;
      mesh.add(line);
      outlines.push(line);
    }
  }

  /** Whether an object is drawn: it and every group it hangs in are visible. three's raycaster
   *  and Box3 look at neither, so a hidden part is left out of picks and pictures here. */
  function drawn(obj: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  /** Aim the raycaster from the camera through a point on the stage. The camera's world matrix
   *  is brought up to date first: a rebuild or a view moves the camera, and only the next frame
   *  would update it, so a pick in between looked from where the camera had been. */
  function aimAt(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
  }

  function castAt(clientX: number, clientY: number) {
    if (partMeshes.length === 0) return null;
    aimAt(clientX, clientY);
    // The parts too: seating, an offset or a pose moves them, and the next frame would place them.
    root.updateMatrixWorld();
    return raycaster.intersectObjects(partMeshes.filter(drawn), false)[0] ?? null;
  }

  function pickIndexAt(clientX: number, clientY: number): number | null {
    const hit = castAt(clientX, clientY);
    const idx = hit ? (hit.object.userData as { partIndex?: number }).partIndex : undefined;
    return typeof idx === 'number' ? idx : null;
  }

  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  function pickOnPlane(clientX: number, clientY: number, value: number, axis: 'z' | 'y' = 'z'): [number, number, number] | null {
    aimAt(clientX, clientY);
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
  /** A tap on part `idx`, or on empty space: select it (with `multiSelect` and shift, add it to
   *  the selection or take it out), and tell the app. */
  function tapPart(idx: number | null, e: PointerEvent) {
    if (opts.multiSelect && e.shiftKey && idx !== null) {
      selected = selected.includes(idx) ? selected.filter((i) => i !== idx) : [...selected, idx];
    } else {
      selected = idx === null ? [] : [idx];
    }
    applyHighlight();
    pickCb?.(idx, e);
  }
  const onPointerUp = (e: PointerEvent) => {
    // Ignore the pointerup that ends an orbit drag or a long press.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    if (performance.now() - downT > 500) return;
    tapPart(pickIndexAt(e.clientX, e.clientY), e);
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
  function animate() {
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
    for (const cb of [...frameHooks]) cb();
    renderer.render(scene, camera);
  }
  animate();

  /** Stop drawing, or start again. Two render loops running at once is double the GPU's work
   *  for a scene nobody can see, and the extra pressure is what makes a browser drop a context. */
  function setPaused(paused: boolean) {
    if (paused) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      animate();
    }
  }

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

  /** Draw a picture's frame: `draw` runs with the pointer's business cleared (no hover, no
   *  selection, no outline) and every layer in its place, and the stage gets both back the moment
   *  it returns, before anything else can draw or click. The one rule both pictures follow (see
   *  `Viewer.renderCoverPng`). */
  function asPictured<T>(draw: () => T): T {
    const hovered = hoveredIndex;
    const chosen = selected;
    hoveredIndex = null;
    selected = [];
    applyHighlight();
    try {
      return withLayersInPlace(draw);
    } finally {
      hoveredIndex = hovered;
      selected = chosen;
      applyHighlight();
    }
  }

  const partBox = new THREE.Box3();
  /** What a picture frames: every part that is drawn (`drawn`: one hidden with setPartVisible,
   *  or in a hidden layer, is not) and the fold rig. Read once `root` and `rig` have their world
   *  matrices; each part is measured as Box3.expandByObject measures it, without its outline. */
  function pictureBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const mesh of partMeshes) {
      if (!drawn(mesh)) continue;
      mesh.updateWorldMatrix(false, false);
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
      box.union(partBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
    }
    if (rig.children.length) box.expandByObject(rig);
    return box;
  }

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
   * same cover: a cover is the product shot, not a record of the last orbit. `angle: 'view'`
   * shoots from where the user is looking instead.
   */
  async function renderCoverPng(cover: number | CoverOptions = {}): Promise<Blob | null> {
    const { edge = 512, angle = 'iso' } = typeof cover === 'number' ? { edge: cover } : cover;
    /* Restore from the RENDERER's own size, not from `container.clientWidth`. The container
       measures 0 x 0 whenever its pane is hidden or mid-layout, and restoring to that leaves
       the canvas permanently 0 x 0 — the viewport goes black until a window resize. */
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevPos = camera.position.clone();
    const prevTarget = controls.target.clone();
    const plateWasVisible = buildPlate.object.visible;
    const dir = angle === 'view' ? prevPos.clone().sub(prevTarget).normalize() : COVER_DIR;
    if (dir.lengthSq() === 0) dir.copy(COVER_DIR);

    capturing = true;
    // `finally`, because a throw in here would otherwise leave the viewport frozen at 512 px
    // with the plate gone and the render loop parked: the capture owns the canvas, so it has
    // to hand it back whatever happens.
    try {
      buildPlate.object.visible = false;
      asPictured(() => {
        root.updateMatrixWorld(true);
        rig.updateMatrixWorld(true);

        // Both the flat parts and anything hierarchical (a fold rig), so a model that lives
        // only in the rig — which is every foldbox box — is framed rather than missed.
        const box = pictureBox();
        if (!box.isEmpty()) {
          const centre = box.getCenter(new THREE.Vector3());
          // Sphere radius, so the fit holds at any angle, and the frame is square, so the
          // vertical FOV governs both directions.
          const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
          camera.position.copy(centre).addScaledVector(dir, coverDistance(radius, camera.fov));
          camera.lookAt(centre);
        }
        camera.aspect = 1;
        camera.updateProjectionMatrix();

        // `updateStyle: false` — the drawing buffer changes shape, the canvas element on
        // screen does not, so nothing flickers while the shot is taken.
        renderer.setPixelRatio(1);
        renderer.setSize(edge, edge, false);
        renderer.render(scene, camera);
      });
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

  /** A card's picture: see `Viewer.renderThumbnail`. Synchronous, so the frame on the stage is
   *  put back before anything can paint in between. */
  function renderThumbnail(edge: number, parts?: ViewerPart[]): string | null {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevPos = camera.position.clone();
    const prevBackground = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const plateWasVisible = buildPlate.object.visible;
    const rigWasVisible = rig.visible;
    const rootWasVisible = root.visible;
    let shot: THREE.Group | null = null;
    let url: string | null = null;

    buildPlate.object.visible = false;
    try {
      asPictured(() => {
        const box = new THREE.Box3();
        if (parts) {
          shot = new THREE.Group();
          for (const p of parts) {
            const mat = new THREE.MeshStandardMaterial({ color: toColor(p.color), metalness: 0, roughness: 0.5 });
            shot.add(new THREE.Mesh(partGeometry(p), mat));
          }
          scene.add(shot);
          root.visible = false;
          rig.visible = false;
          shot.updateMatrixWorld(true);
          box.expandByObject(shot);
        } else {
          // The flat parts and anything hierarchical (a fold rig), as the cover frames them.
          root.updateMatrixWorld(true);
          rig.updateMatrixWorld(true);
          box.copy(pictureBox());
        }
        const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const radius = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
        camera.position.copy(centre).addScaledVector(COVER_DIR, coverDistance(radius, camera.fov, 1));
        camera.lookAt(centre);
        camera.aspect = 1;
        camera.updateProjectionMatrix();

        if (opts.alpha) {
          scene.background = null;
          renderer.setClearColor(0x000000, 0);
        }
        renderer.setPixelRatio(1);
        renderer.setSize(edge, edge, false);
        renderer.render(scene, camera);
        try {
          url = renderer.domElement.toDataURL('image/png');
        } catch {
          url = null;
        }
      });
    } finally {
      if (shot) {
        scene.remove(shot);
        disposeSubtree(shot);
      }
      root.visible = rootWasVisible;
      rig.visible = rigWasVisible;
      scene.background = prevBackground;
      renderer.setClearColor(prevClear, prevClearAlpha);
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      camera.position.copy(prevPos);
      controls.update(); // re-aims the camera at the untouched orbit target
      buildPlate.object.visible = plateWasVisible;
      renderer.render(scene, camera);
    }
    return url;
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
    outlineMaterial?.dispose();
    setFoldRig(null);
    buildPlate.dispose();
    controls.dispose();
    pmrem?.dispose();
    partsSetHooks.clear();
    frameHooks.clear();
    renderer.dispose();
    // dispose() frees three's own objects and leaves the context alive; this hands it back.
    if (opts.forceContextLoss) renderer.forceContextLoss();
    if (!opts.canvas) renderer.domElement.remove();
  }

  return {
    setParts,
    setView,
    setPartColor(index, color) {
      const m = materials[index];
      if (m) m.color = toColor(color);
    },
    setPartGeometry(index, part) {
      const mesh = partMeshes[index];
      if (!mesh) return;
      mesh.geometry.dispose();
      mesh.geometry = partGeometry(part);
      if (outlineMaterial) applyHighlight();
    },
    setPartVisible(index, on) {
      const mesh = partMeshes[index];
      if (mesh) mesh.visible = on;
    },
    onPartPick(cb) {
      pickCb = cb;
    },
    highlightPart(index) {
      selected = index === null ? [] : [index];
      applyHighlight();
    },
    highlightParts(indices) {
      selected = [...indices];
      applyHighlight();
    },
    clearHighlight() {
      selected = [];
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
    layer,
    partMeshes: () => partMeshes.slice(),
    onPartsSet(cb) {
      partsSetHooks.add(cb);
      return () => void partsSetHooks.delete(cb);
    },
    onFrame(cb) {
      frameHooks.add(cb);
      return () => void frameHooks.delete(cb);
    },
    setPaused,
    setFoldRig,
    settleFoldRig,
    setPlate: (choice) => buildPlate.setChoice(choice),
    setTheme,
    setOrbitEnabled: (on) => {
      controls.enabled = on;
    },
    renderToPng,
    renderCoverPng,
    renderThumbnail,
    scene,
    camera,
    root,
    controls,
    renderer,
    hasStencil,
    dispose,
  };
}
