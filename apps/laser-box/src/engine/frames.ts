// Where a piece sits in 3D, in the words the house 3D view takes.
//
// A piece is drawn in its own frame (u → x, v → y, its show face toward +z). Assembled, local
// (x, y, z) lands at `origin + x·u + y·v + z·n`, n = u × v. The 3D view (@vostok/laser's
// material preview, and ours) wants that as a pose: the world position of the piece's BOX
// CENTRE at mid-thickness, and Euler angles in degrees about the WORLD axes, X first, then Y,
// then Z — rotation matrix R = Rz·Ry·Rx, three.js order 'ZYX'.
import type { Motion, Pt, V3 } from './types';

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** A frame: where local (0, 0, 0) lands and the three local axes in world terms. */
export interface Frame {
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
}

export const frameOf = (origin: V3, u: V3, v: V3): Frame => ({ origin, u, v, n: cross(u, v) });

/** Local (x, y) on the mid-plane → world. */
export const toWorld = (f: Frame, p: Pt, z = 0): V3 => add(add(add(f.origin, scale(f.u, p[0])), scale(f.v, p[1])), scale(f.n, z));

const DEG = 180 / Math.PI;
const tidy = (a: number) => {
  const r = Math.round(a * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** Euler angles (degrees, world X then Y then Z) of the rotation whose columns are u, v, n. */
export function eulerOf(f: Frame): { rx: number; ry: number; rz: number } {
  // R = [u v n]: R[row][col]; column 0 = u, 1 = v, 2 = n.
  const R = (r: number, c: number) => [f.u, f.v, f.n][c]![r]!;
  const sy = -R(2, 0);
  const ry = Math.asin(Math.max(-1, Math.min(1, sy)));
  let rx: number;
  let rz: number;
  if (Math.abs(Math.cos(ry)) > 1e-9) {
    rx = Math.atan2(R(2, 1), R(2, 2));
    rz = Math.atan2(R(1, 0), R(0, 0));
  } else {
    // Gimbal lock: only rx ∓ rz is defined; put it all in rx.
    rz = 0;
    rx = Math.atan2(-R(1, 2), R(1, 1));
  }
  return { rx: tidy(rx * DEG), ry: tidy(ry * DEG), rz: tidy(rz * DEG) };
}

/** The pose of a piece whose outline's box is `box` in its own frame. */
export function poseOf(f: Frame, box: { minX: number; minY: number; maxX: number; maxY: number }): Pose {
  const c = toWorld(f, [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]);
  return { x: tidy(c[0]), y: tidy(c[1]), z: tidy(c[2]), ...eulerOf(f) };
}

/** Rotate a vector about a unit axis by `deg` (Rodrigues). */
export function rotateVec(p: V3, axis: V3, deg: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = axis;
  const kxp = cross(k, p);
  const kdp = dot(k, p);
  return [
    p[0] * c + kxp[0] * s + k[0] * kdp * (1 - c),
    p[1] * c + kxp[1] * s + k[1] * kdp * (1 - c),
    p[2] * c + kxp[2] * s + k[2] * kdp * (1 - c),
  ];
}

/**
 * The frame a moving part has at `amount` (0 = shut, 1 = fully open): a hinge turns the frame
 * about its axis line, a slide moves it along, a lift raises it. The 3D view's "Open" switch.
 */
export function moved(f: Frame, motion: Motion | undefined, amount: number): Frame {
  if (!motion || amount <= 0) return f;
  if (motion.kind === 'hinge') {
    const deg = motion.degrees * amount;
    const turn = (p: V3) => add(motion.at, rotateVec(sub(p, motion.at), motion.axis, deg));
    return { origin: turn(f.origin), u: rotateVec(f.u, motion.axis, deg), v: rotateVec(f.v, motion.axis, deg), n: rotateVec(f.n, motion.axis, deg) };
  }
  if (motion.kind === 'slide') return { ...f, origin: add(f.origin, scale(motion.dir, motion.distance * amount)) };
  return { ...f, origin: add(f.origin, [0, 0, motion.distance * amount]) };
}

/** Pull a piece away from the box's centre along its own normal — the exploded view. */
export function exploded(f: Frame, centre: V3, by: number): Frame {
  const away = dot(sub(f.origin, centre), f.n) >= 0 ? 1 : -1;
  return { ...f, origin: add(f.origin, scale(f.n, away * by)) };
}
