/**
 * Product photography for models, without a camera or a lightbox.
 *
 * A model *viewer* is built for reading a shape at 60 fps: a few analytic lights, no shadows, no
 * tone mapping, no environment. That is the right set of choices for a viewer and the wrong one
 * for a listing photograph, and the gap between the two is small and entirely known:
 *
 *   1. **An environment**, so the surface has something to reflect. `RoomEnvironment` is
 *      procedural and ships inside the `three` package: no asset file, so no HDRI licence, no
 *      download and no network. It is the single biggest change.
 *   2. **Filmic tone mapping**, so highlights roll off instead of clipping to flat white.
 *   3. **A shadow the object sits in**, because a print with no contact shadow floats.
 *   4. **Accumulation**, which is what actually separates this from a screenshot. See
 *      `renderStill` in `still.ts`.
 *
 * There is no path tracer and no layer-line fakery; the seam for a progressive backend is the
 * sample loop in `renderStill`, which already thinks in "N samples averaged", so swapping the
 * per-sample body is the whole of that change.
 *
 * **The scene itself is built once, in `buildStudioScene`, and used twice**: by the live preview
 * and by the still renderer. A preview that builds its own scene drifts from the render, and a
 * preview that disagrees with its output is worse than none at all. The two differ in sample
 * count and nothing else.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LoadedModel } from './load';
import { regionColour, STOCK_HEX, type PaintRegion } from './regions';
import {
  AUTO_FINISH, PRESET_SHOTS, clamp, finishById, resolveFinish, type Finish, type SceneOptions,
} from './studio';

/* ------------------------------------------------------------------ framing */

/** The camera's vertical field of view, in degrees. Narrow, as a product lens is. */
export const FOV = 30;

/**
 * Distance at which a bounding sphere of `radius` fits, for a given viewport aspect.
 *
 * Fitted against both axes: a frame wider than it is tall runs out of vertical room first, and a
 * portrait one runs out horizontally.
 */
export function fitDistance(radius: number, aspect: number): number {
  const vFov = (FOV * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fitVertical = radius / Math.sin(vFov / 2);
  const fitHorizontal = radius / Math.sin(hFov / 2);
  return Math.max(fitVertical, fitHorizontal) * 1.08; // a little breathing room
}

/* ---------------------------------------------------------------- materials */

/** Roughness, metalness and coat per finish. Filament is never a mirror. */
export function materialFor(
  hex: string,
  finish: Finish,
  ambience = 1,
): THREE.MeshPhysicalMaterial {
  const spec = finishById(finish);
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    // Print walls are thin and a solid model is often not watertight after slicing edits, so the
    // back faces have to draw or the object shows its own inside.
    side: THREE.DoubleSide,
    envMapIntensity: ambience,
    roughness: spec.roughness,
    metalness: spec.metalness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    transmission: spec.transmission,
    // Only read when `transmission` is above zero, and then it is what stops a translucent part
    // looking like a soap bubble.
    thickness: spec.transmission > 0 ? 1.4 : 0,
    ior: 1.48,
  });
}

/* ------------------------------------------------------------- environment */

/**
 * The procedural room, prefiltered for image-based lighting.
 *
 * Built once per renderer. The PMREM is a few hundred kilobytes of GPU texture and rebuilding it
 * per render is measurably the slowest part of a batch. It cannot be shared between WebGL
 * contexts, which is why this is a function rather than a module constant.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

/**
 * A disc that is solid in the middle and gone at the rim, used as the floor's alpha.
 *
 * Without it the ground plane ends somewhere in shot and draws a hard line across the frame,
 * which is the single most reliable way to make a render look like a render. Fading the floor
 * out into the background instead is what a photographer gets for free from a paper sweep, and
 * it costs one gradient here.
 */
function floorFadeTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.45, '#ffffff');
    // Most of the falloff happens in the outer third, so the ground stays solid where the model
    // and its shadow actually sit.
    grad.addColorStop(0.78, '#9a9a9a');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
}

/** A wash as a small canvas texture. Cheaper and softer than a shader. */
function skyTexture(top: string, bottom: string, radial = false): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = radial ? 256 : 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = radial
      // Centred a little above the middle, where the model's head is, so the falloff sits behind
      // the object rather than behind the floor.
      ? ctx.createRadialGradient(128, 108, 8, 128, 108, 190)
      : ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------- scene */

export interface StudioScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Centre of the model's bounding sphere. */
  center: THREE.Vector3;
  /** What the camera looks at and orbits: the centre, moved by the shot's pan. */
  target: THREE.Vector3;
  radius: number;
  /** Where the shot put the camera, before anyone dragged it. */
  distance: number;
  /** Re-aims the lights for wherever the camera is now. Cheap; call after every move. */
  relight(): void;
  /** Nudges the key inside its softness disc, for pass `i` of `n`. */
  jitter(i: number, n: number): void;
  /** Frees everything this built. The loaded model is left as it was found. */
  dispose(): void;
}

const DEG = Math.PI / 180;

/** The hero shot's direction: the reference frame of a rig locked to the model. */
const HERO_DIR = new THREE.Vector3(...(PRESET_SHOTS[0]?.dir ?? ([1, 0.8, 1.25] as const))).normalize();

/**
 * Everything a photograph of this model is, except how many passes to average.
 *
 * The scene draws a **copy** of `model.object` (`clone()`, which shares the geometry), with its
 * own materials. The loaded model is never re-parented, re-painted or re-flagged, so a preview
 * and a still can each hold a scene of the same model at the same time, and disposing one cannot
 * free anything the other is drawing.
 *
 * The one subtlety is `relight`. A directional light at a fixed world direction is a lamp bolted
 * to the wall: it is a three-quarter key at the hero angle and almost directly behind the model
 * at the side angle, so half the angles come out as silhouettes. Measuring azimuth and elevation
 * from the *camera* instead makes the rig a lightbox (you walk round the table and the softbox
 * comes with you), so every shot in a batch is lit the same way. `lockToModel` restores the
 * bolted-to-the-wall behaviour for anyone shooting a turntable, and then the reference frame is
 * the hero direction rather than the camera's.
 */
export function buildStudioScene(
  model: LoadedModel,
  look: SceneOptions,
  env: THREE.Texture,
  aspect: number,
): StudioScene {
  const scene = new THREE.Scene();
  scene.environment = env;

  const sky = look.backdrop.sky
    ? skyTexture(look.backdrop.sky[0], look.backdrop.sky[1], look.backdrop.radial)
    : null;
  if (sky) scene.background = sky;

  /*
   * The model hangs off a pivot rather than being rotated in place.
   *
   * The loader already spent the object's own rotation on z-up-to-y-up. Turning the pivot keeps
   * that untouched, so the tumble is never applied twice.
   */
  const subject = model.object.clone();
  const materials = paintSubject(subject, model.regions, look);
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  const quarter = (n: number) => (((n % 4) + 4) % 4) * (Math.PI / 2);
  const o = look.orientation;
  pivot.rotation.x = quarter(o.tip) + o.tipFine * DEG;
  pivot.rotation.y = quarter(o.turn) + o.turnFine * DEG;
  pivot.rotation.z = quarter(o.roll) + o.rollFine * DEG;
  pivot.add(subject);
  scene.add(pivot);
  pivot.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(pivot);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  // A single NaN vertex poisons the whole bounding box, and a NaN camera renders a blank frame
  // that looks like a success. Fall back to the origin instead.
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
    center.set(0, 0, 0);
  }
  // A degenerate sphere (a single point, or nothing) would put the camera on the model.
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 1000);
  const dir = new THREE.Vector3(...look.shot.dir).normalize();
  if (dir.lengthSq() < 1e-9) dir.copy(HERO_DIR);
  const distance = fitDistance(radius, aspect) * look.shot.zoom;
  const offset = look.shot.offset ?? [0, 0, 0];
  const target = center.clone().add(new THREE.Vector3(
    Number.isFinite(offset[0]) ? offset[0] : 0,
    Number.isFinite(offset[1]) ? offset[1] : 0,
    Number.isFinite(offset[2]) ? offset[2] : 0,
  ).multiplyScalar(radius));
  camera.position.copy(target).addScaledVector(dir, distance);
  camera.lookAt(target);
  // Near and far scaled to the model: a fixed 0.01 to 1000 on a small part leaves so little depth
  // precision that coplanar faces z-fight into noise.
  camera.near = radius / 100;
  camera.far = (distance + radius + target.distanceTo(center)) * 40;
  camera.updateProjectionMatrix();

  // The floor sits on the model's lowest point, not on y = 0. A model authored away from the
  // origin would otherwise cast its shadow onto a plane somewhere behind it.
  const floorY = Number.isFinite(box.min.y) ? box.min.y : 0;
  /*
   * Sized from the camera, not from the model.
   *
   * A flat `radius * 60` is invisible at the hero angle and ruinous at the low and front ones: a
   * plane that big seen nearly edge-on covers the whole frame in grazing-angle fragments, and
   * every one of them is shaded and sampled against the shadow map, once per accumulation pass
   * (measured: 1.4 s at `hero` against 6.0 s at `front`, for an identical scene). Reaching a little
   * past the far edge of the frame is all the plane has to do.
   */
  const floorSpan = Math.max(radius * 14, distance * 3.5);
  // The transparent backdrop needs no fade: a ShadowMaterial only draws where there is a shadow,
  // so its plane has no visible edge to hide in the first place.
  const fade = look.backdrop.floor ? floorFadeTexture() : null;
  const strength = clamp(look.lighting.shadowStrength, 0, 1);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSpan, floorSpan),
    look.backdrop.floor
      ? new THREE.MeshStandardMaterial({
        color: new THREE.Color(look.backdrop.floor),
        roughness: 0.92,
        envMapIntensity: look.lighting.ambience,
        alphaMap: fade,
        transparent: true,
      })
      : new THREE.ShadowMaterial({ opacity: 0.42 * strength }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY - radius * 0.002;
  floor.receiveShadow = true;
  scene.add(floor);

  const key = new THREE.DirectionalLight(0xffffff, look.lighting.key);
  key.castShadow = look.shadow;
  key.shadow.intensity = strength;
  const cam = key.shadow.camera;
  cam.left = -radius * 1.6;
  cam.right = radius * 1.6;
  cam.top = radius * 1.6;
  cam.bottom = -radius * 1.6;
  cam.near = radius * 0.5;
  cam.far = radius * 14;
  cam.updateProjectionMatrix();
  /*
   * 1024, not 2048. The accumulation loop already averages this shadow over `samples` jittered
   * light positions, so map resolution buys far less here than it would in a single-pass render,
   * while costing a full extra shadow draw of the scene per pass.
   */
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0009;
  key.target.position.copy(center);
  scene.add(key, key.target);

  // Fill and rim cast nothing. Two more shadow maps per pass would double the cost of a batch to
  // soften an edge the key has already lit.
  const fill = new THREE.DirectionalLight(0xffffff, look.lighting.fill);
  fill.target.position.copy(center);
  scene.add(fill, fill.target);

  const rim = new THREE.DirectionalLight(0xffffff, look.lighting.rim);
  rim.target.position.copy(center);
  scene.add(rim, rim.target);

  subject.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = look.shadow;
      child.receiveShadow = look.shadow;
    }
  });

  // Recomputed by `relight`, read by `jitter`. The jitter basis has to be perpendicular to the
  // light direction, or moving the light slides it towards the model and the exposure changes
  // between passes.
  const keyBase = new THREE.Vector3();
  const jitterU = new THREE.Vector3();
  const jitterV = new THREE.Vector3();

  const relight = () => {
    const from = look.lighting.lockToModel
      ? HERO_DIR.clone()
      : camera.position.clone().sub(center).normalize();
    if (from.lengthSq() < 1e-9) from.set(0, 0, 1);

    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), from);
    // Looking straight down, "camera right" is undefined and the cross product collapses.
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const up = new THREE.Vector3().crossVectors(from, right).normalize();

    const place = (light: THREE.DirectionalLight, azDeg: number, elDeg: number) => {
      const az = azDeg * DEG;
      const el = elDeg * DEG;
      light.position.copy(center).addScaledVector(
        new THREE.Vector3()
          .addScaledVector(from, Math.cos(el) * Math.cos(az))
          .addScaledVector(right, Math.cos(el) * Math.sin(az))
          .addScaledVector(up, Math.sin(el))
          .normalize(),
        radius * 6,
      );
    };

    const { azimuth, elevation } = look.lighting;
    place(key, azimuth, elevation);
    // Opposite side, lower and flatter: a fill that matches the key's height fights it.
    place(fill, -azimuth - 12, elevation * 0.35);
    // Behind the model from where you are standing, which is what puts a line on the edge.
    place(rim, azimuth + 168, Math.max(14, elevation * 0.7));

    keyBase.copy(key.position);
    const lightDir = keyBase.clone().sub(center).normalize();
    jitterU.crossVectors(new THREE.Vector3(0, 1, 0), lightDir);
    if (jitterU.lengthSq() < 1e-6) jitterU.set(1, 0, 0); else jitterU.normalize();
    jitterV.crossVectors(lightDir, jitterU).normalize();
  };
  relight();

  return {
    scene,
    camera,
    center,
    target,
    radius,
    distance,
    relight,
    jitter(i, n) {
      if (n <= 1) { key.position.copy(keyBase); return; }
      // Concentric disc sampling, so the light positions cover the area evenly instead of
      // clumping in the middle the way raw random pairs do.
      const r = Math.sqrt((i + 0.5) / n) * radius * look.lighting.softness;
      const theta = (i + 1) * 2.399963; // golden angle
      key.position.copy(keyBase)
        .addScaledVector(jitterU, Math.cos(theta) * r)
        .addScaledVector(jitterV, Math.sin(theta) * r);
    },
    dispose() {
      pivot.remove(subject);
      scene.remove(pivot);
      for (const m of materials) m.dispose();
      sky?.dispose();
      fade?.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      key.dispose();
      fill.dispose();
      rim.dispose();
    },
  };
}

/**
 * Gives the scene's copy of the model one material per region, in the order the geometry's
 * groups were added, and returns every material it made.
 *
 * A region carries a finish as well as a colour, and roughness, metalness and clearcoat are
 * material properties with no per-vertex channel in three.js. Vertex colours can carry the hue
 * and nothing else, which is the difference between silk gold lettering on a matte black plate
 * and two colours of the same plastic.
 *
 * Regions that resolve to the same colour and finish share one material.
 */
function paintSubject(
  subject: THREE.Object3D,
  regions: readonly PaintRegion[],
  look: SceneOptions,
): THREE.Material[] {
  const byKey = new Map(regions.map((r) => [r.key, r]));
  const made = new Map<string, THREE.MeshPhysicalMaterial>();
  const materialOf = (key: string) => {
    const region = byKey.get(key);
    const { hex, finishId } = region
      ? regionColour(region, look.colourway)
      : { hex: STOCK_HEX, finishId: AUTO_FINISH };
    const finish = resolveFinish(hex, finishId);
    const id = `${hex.toLowerCase()}|${finish}`;
    let m = made.get(id);
    if (!m) {
      m = materialFor(hex, finish, look.lighting.ambience);
      made.set(id, m);
    }
    return m;
  };

  subject.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const keys = (child.userData.regionKeys as string[] | undefined) ?? [];
    const built = (keys.length ? keys : ['']).map(materialOf);
    child.material = built.length === 1 ? built[0] : built;
  });
  return [...made.values()];
}
