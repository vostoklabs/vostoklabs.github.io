// The keyring hole: where a tunnel through the body's side wall fits, and how wide.
//
// The tunnel is half a flat ring (a torus seen from above) centred on a point of the body's edge:
// it enters the side wall, bends round inside the body and leaves it again a little further
// along, so a split ring or a cord threads through two round openings. Above the well floor the
// wall is only the border's width, far too thin for a hole, so the tunnel runs through the solid
// slab under the well, its bottom one floor thickness above the underside. It prints standing up,
// so its roof is the only overhang, and a bore of up to 6 mm bridges without support.
//
// Pure: no manifold here. The build cuts what `planHole` says and refuses when it says no, and
// places a new hole where `findHoleBearing` says it fits.

import { insideShapes } from '@vostok/shapes';
import type { Ring } from '../types';

type Pt = [number, number];

export const HOLE = {
  /** Solid left round the tunnel on every side, mm. */
  WALL: 1.2,
  /** Solid under the tunnel, mm: the body's own floor under the switch pocket. */
  FLOOR: 1.6,
  /** The narrowest bore the engine will make, mm: a split ring or a cord still threads it. */
  BORE_MIN: 3.2,
  /** The widest, mm: past this a round tunnel's roof is too wide to bridge without support. */
  BORE_MAX: 6,
  /** How much narrower each next try is, mm. */
  STEP: 0.4,
  /** The tunnel's centre line runs at the bore radius plus this, so the bend is never tighter. */
  BEND: 1.4,
  /** Clear solid kept between the tunnel and an internal cavity, mm. */
  VOID_GAP: 0.4,
} as const;

/** A small spherical cavity inside the body that the tunnel must keep clear of. */
export interface HoleVoid {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface HoleIn {
  /** The body's footprint. */
  rings: Ring[];
  /** The point on the body's edge the tunnel's ring is centred on. */
  p: Pt;
  /** The bore asked for, mm (capped to BORE_MIN..BORE_MAX). */
  askedBore: number;
  bodyBottomZ: number;
  wellFloorZ: number;
  switches: { x: number; y: number; rotation: number }[];
  /** Half the switch pocket's width, mm. */
  pocketHalf: number;
  voids: HoleVoid[];
}

/** Why no tunnel fits: too little height under the well floor, the edge is not one clean arc
 *  through the ring (a notch or a point), a switch pocket is in the way, or an internal cavity. */
export type HoleWhy = 'height' | 'edge' | 'pocket' | 'voids';

export type HolePlan =
  | { ok: true; bore: number; r: number; R: number; zLo: number; zHi: number; zMid: number; narrowed: boolean }
  | { ok: false; why: HoleWhy };

const inBody = (rings: Ring[], q: Pt) => insideShapes([rings], q);

/** How many runs of consecutive `true` there are round a closed loop of samples. */
function runs(flags: boolean[]): number {
  let n = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] && !flags[(i + flags.length - 1) % flags.length]) n++;
  return n;
}

/** The point of the outline nearest `q`: where a point slid along the edge's tangent lands back
 *  on a curved edge. */
export function snapToEdge(rings: Ring[], q: Pt): Pt {
  let best: Pt = q;
  let bd = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const ex = bx - ax;
      const ey = by - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((q[0] - ax) * ex + (q[1] - ay) * ey) / len2)) : 0;
      const fx = ax + ex * t;
      const fy = ay + ey * t;
      const d = (q[0] - fx) ** 2 + (q[1] - fy) ** 2;
      if (d < bd) {
        bd = d;
        best = [fx, fy];
      }
    }
  }
  return best;
}

/** The ring is sampled every 3 degrees. */
const PLAN_STEP_DEG = 3;

function tryBore(i: HoleIn, bore: number): HolePlan {
  const r = bore / 2;
  const R = r + HOLE.BEND;
  const zLo = i.bodyBottomZ + HOLE.FLOOR;
  const zHi = zLo + bore;
  if (zHi > i.wellFloorZ - HOLE.WALL) return { ok: false, why: 'height' };
  const ring = (rho: number): Pt[] => {
    const out: Pt[] = [];
    for (let a = 0; a < 360; a += PLAN_STEP_DEG) {
      const t = (a * Math.PI) / 180;
      out.push([i.p[0] + rho * Math.cos(t), i.p[1] + rho * Math.sin(t)]);
    }
    return out;
  };
  // One clean arc through the wall: the tube's inner edge, centre line and outer edge each cross
  // the body along one run only, and the centre line is roughly half inside.
  for (const rho of [R - r, R, R + r]) {
    const flags = ring(rho).map((q) => inBody(i.rings, q));
    if (runs(flags) !== 1) return { ok: false, why: 'edge' };
    if (rho === R) {
      const f = flags.filter(Boolean).length / flags.length;
      if (f < 0.3 || f > 0.75) return { ok: false, why: 'edge' };
    }
  }
  // Solid all round it, seen from above: nothing of the tube or its wall inside a switch pocket.
  for (let rho = Math.max(R - r - HOLE.WALL, 0.2); rho <= R + r + HOLE.WALL + 1e-6; rho += 0.4) {
    for (const q of ring(rho)) {
      if (!inBody(i.rings, q)) continue;
      for (const s of i.switches) {
        const c = Math.cos((-s.rotation * Math.PI) / 180);
        const sn = Math.sin((-s.rotation * Math.PI) / 180);
        const dx = q[0] - s.x;
        const dy = q[1] - s.y;
        if (Math.abs(dx * c - dy * sn) <= i.pocketHalf && Math.abs(dx * sn + dy * c) <= i.pocketHalf) {
          return { ok: false, why: 'pocket' };
        }
      }
    }
  }
  // Clear of every internal cavity, which sits in the same slab: the distance from its centre to
  // the tube's centre circle, less both radii, keeps VOID_GAP.
  const zMid = (zLo + zHi) / 2;
  for (const v of i.voids) {
    const dp = Math.abs(Math.hypot(v.x - i.p[0], v.y - i.p[1]) - R);
    if (Math.hypot(dp, v.z - zMid) < r + v.r + HOLE.VOID_GAP) return { ok: false, why: 'voids' };
  }
  return { ok: true, bore, r, R, zLo, zHi, zMid, narrowed: false };
}

/** The bores tried, widest first: the asked one (capped), then STEP narrower each time, ending
 *  on BORE_MIN itself even when the steps would step past it. */
export function boresToTry(askedBore: number): number[] {
  const asked = Math.min(HOLE.BORE_MAX, Math.max(HOLE.BORE_MIN, askedBore));
  const out: number[] = [];
  for (let b = asked; b >= HOLE.BORE_MIN - 1e-9; b -= HOLE.STEP) out.push(Math.round(b * 10) / 10);
  if (out[out.length - 1] > HOLE.BORE_MIN) out.push(HOLE.BORE_MIN);
  return out;
}

/** The widest tunnel up to the asked bore (and BORE_MAX) that fits at `p`, or why none does.
 *  `narrowed` is true when the bore built is narrower than the one asked for. */
export function planHole(i: HoleIn): HolePlan {
  let why: HoleWhy = 'edge';
  for (const bore of boresToTry(i.askedBore)) {
    const plan = tryBore(i, bore);
    if (plan.ok) return { ...plan, narrowed: bore < i.askedBore - 0.05 };
    why = plan.why;
  }
  return { ok: false, why };
}

/** How far apart the bearings `findHoleBearing` tries are, degrees. */
export const SCAN_STEP_DEG = 5;

/** What the scan needs: the planner's input without its point, and where the edge is for a
 *  bearing, as the build places a hole there with no Fine offset (the build passes its own
 *  construction, so a found bearing builds exactly where it was tried). */
export interface HoleScan extends Omit<HoleIn, 'p'> {
  pointAt: (deg: number) => Pt;
  /** The bearing the scan starts from and keeps closest to, degrees. Default 90, the top. */
  nearDeg?: number;
}

/** The bearings tried, nearest `near` first: `near` itself, then a step either side, and so on
 *  round to the opposite side. Counter-clockwise first where two are as near. */
export function scanBearings(near = 90): number[] {
  const out: number[] = [];
  const at = (d: number) => Math.round((((d % 360) + 360) % 360) * 1000) / 1000;
  out.push(at(near));
  for (let k = SCAN_STEP_DEG; k < 180; k += SCAN_STEP_DEG) out.push(at(near + k), at(near - k));
  out.push(at(near + 180));
  return out;
}

/** Where on the edge a hole fits best: the bearing nearest `nearDeg` where the asked bore fits
 *  as asked (capped at BORE_MAX); failing that, the one where the widest bore fits, nearest
 *  first among equals; null when no bearing has room for even BORE_MIN. Every bearing is tried
 *  with no Fine offset, every SCAN_STEP_DEG. */
export function findHoleBearing(i: HoleScan): { deg: number; bore: number } | null {
  const bores = boresToTry(i.askedBore);
  const order = scanBearings(i.nearDeg ?? 90);
  const points = new Map<number, Pt>();
  const pointAt = (deg: number) => {
    let p = points.get(deg);
    if (!p) points.set(deg, (p = i.pointAt(deg)));
    return p;
  };
  for (const deg of order) {
    if (tryBore({ ...i, p: pointAt(deg) }, bores[0]).ok) return { deg, bore: bores[0] };
  }
  let best: { deg: number; bore: number } | null = null;
  for (const deg of order) {
    for (const bore of bores.slice(1)) {
      if (best && bore <= best.bore) break;
      if (tryBore({ ...i, p: pointAt(deg) }, bore).ok) {
        best = { deg, bore };
        break;
      }
    }
  }
  return best;
}
