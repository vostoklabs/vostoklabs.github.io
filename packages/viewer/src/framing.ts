// The 3D viewer's arithmetic: where the camera goes, where the model sits, how far below it the
// floor has to be. Apart from the renderer and the page, so node can test it (tests/).
import * as THREE from 'three';

export type ViewPreset = 'iso' | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';

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
export const FLOOR_GAP = 0.06;
export const NEAR = 0.1;
export const FAR = 5000;

/** Cover framing: how much air round the model's bounding sphere, and the fixed
 *  three-quarter direction the cover is shot from (Z up, the same quarter the 'iso'
 *  preset uses, so a cover looks like the view the user has been working in). */
export const COVER_PAD = 1.15;
export const COVER_DIR = new THREE.Vector3(1, -1, 0.75).normalize();

/** Smallest depth difference the 24-bit buffer can still tell apart at distance `z`. */
export function depthResolution(z: number): number {
  return (z * z * (FAR - NEAR)) / (NEAR * FAR * 16777216);
}

/** Twelve depth buckets of clearance, and never less than the old constant — so
 *  every model small enough to have been fine already is left exactly as it was. */
export function floorGapFor(dist: number): number {
  return Math.max(FLOOR_GAP, depthResolution(dist) * 12);
}

/** The camera distance a model of `radius` (its largest extent) is framed at. */
export function frameDistance(radius: number, frameMul: number, framePad: number): number {
  return radius * frameMul + framePad;
}

/**
 * Where a preset puts the camera, `dist` from the model's centre `c` (`size` is the model's
 * extent). Face-on views keep a few degrees of tilt: dead-on would put the view axis parallel
 * to camera.up (Z) and leave the roll undefined.
 */
export function presetPosition(preset: ViewPreset, c: THREE.Vector3, size: THREE.Vector3, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
  const tilt = dist * 0.08;
  switch (preset) {
    case 'front': return out.set(c.x, c.y - dist, c.z + tilt);
    case 'back': return out.set(c.x, c.y + dist, c.z + tilt);
    case 'left': return out.set(c.x - dist, c.y, c.z + tilt);
    case 'right': return out.set(c.x + dist, c.y, c.z + tilt);
    case 'top': return out.set(c.x, c.y - tilt, c.z + dist);
    case 'bottom': return out.set(c.x, c.y + tilt, c.z - dist);
    default: return out.set(c.x + dist, c.y - dist, c.z + dist * 0.75 - size.z / 2);
  }
}

/**
 * Where the model group goes so the model sits on the plate: centred in X and Y with its
 * bottom face on z = 0, or with `anchor` (a model point) held at the origin instead. Returns
 * that offset, and where the model's centre ends up once it is applied.
 */
export function seatOf(box: THREE.Box3, anchor?: [number, number, number]): { offset: THREE.Vector3; centre: THREE.Vector3 } {
  const centre = box.getCenter(new THREE.Vector3());
  const offset = anchor ? new THREE.Vector3(-anchor[0], -anchor[1], -anchor[2]) : new THREE.Vector3(-centre.x, -centre.y, -box.min.z);
  return { offset, centre: centre.clone().add(offset) };
}

/**
 * After a rebuild, how far the camera should now be from its target, or null to leave it.
 *
 * Editing a parameter must never move the camera in a way the user can feel. The angle is never
 * touched, and the distance only eases outward, and only while the model is actually outgrowing
 * the frame — and only for a camera still roughly at the framing distance: a user who has zoomed
 * in on a detail has said where they want to look.
 *
 * `current`: the camera's distance from its target now. `framed` and `needed`: the framing
 * distances of the model it was last framed for and of the model now. `grew`: the model now is
 * bigger than the one it was framed for.
 */
export function followOutDistance(current: number, framed: number | null, needed: number, grew: boolean): number | null {
  if (!grew) return null;
  const wasFramed = framed === null || current >= framed * 0.85;
  return wasFramed && current < needed ? needed : null;
}

/** The cover's camera distance: the bounding sphere of `radius`, seen square through a
 *  vertical field of view of `fovDeg`, with `pad` of air round it. */
export function coverDistance(radius: number, fovDeg: number, pad = COVER_PAD): number {
  return (radius / Math.sin((fovDeg * Math.PI) / 360)) * pad;
}
