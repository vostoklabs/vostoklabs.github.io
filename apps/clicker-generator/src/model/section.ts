// 2-D questions about a model, answered with cross-sections instead of 3-D booleans.
//
// A boolean against the whole uploaded model costs about 1.7 µs a triangle in the worker
// (measured 2026-09-30: 114 ms to subtract a small box from 65k triangles), and every one of them
// copies the whole mesh. A slice of the same model is 2 ms. So everything that is really a
// question — where does the switch fit, is the wall thick enough, is this point buried — is
// asked of slices or rays, and the 3-D booleans are kept for the cuts that make the pieces.
import type { Scope } from './switchKit';

type Solid = any;
type Section = any;

/** The model's cross-section at height z, simplified to a tolerance nobody can print. */
export function sectionAt(sc: Scope, model: Solid, z: number): Section {
  const raw = sc.keep(model.slice(z));
  return raw.isEmpty() ? raw : sc.keep(raw.simplify(0.05));
}

/** The part of the plane inside the model at EVERY one of these heights. */
export function commonSection(sc: Scope, model: Solid, zs: number[]): Section {
  let acc: Section | null = null;
  for (const z of zs) {
    const s = sectionAt(sc, model, z);
    acc = acc ? sc.keep(acc.intersect(s)) : s;
    if (acc.isEmpty()) break;
  }
  return acc ?? sc.keep(model.slice(zs[0] ?? 0));
}

/**
 * The point of a section furthest from its edges, and that distance.
 *
 * A binary search on how far the section can be eroded before it vanishes: the last non-empty
 * erosion is a sliver round the deepest point, and its centre is the answer. Holes and islands
 * are handled by the erosion itself, which is the reason for doing it this way rather than with
 * a ring-based pole-of-inaccessibility — a model's section has both, a drawn base shape never did.
 */
export function deepestPoint(sc: Scope, cs: Section, iterations = 11): { x: number; y: number; clearance: number } | null {
  if (cs.isEmpty()) return null;
  const b = cs.bounds();
  let lo = 0;
  let hi = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 + 0.5;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (sc.keep(cs.offset(-mid, 'Round', 2, 12)).isEmpty()) hi = mid;
    else lo = mid;
  }
  const core = lo > 0.01 ? sc.keep(cs.offset(-lo, 'Round', 2, 12)) : cs;
  const pick = largestIsland(sc, core.isEmpty() ? cs : core);
  const pb = pick.bounds();
  return { x: (pb.min[0] + pb.max[0]) / 2, y: (pb.min[1] + pb.max[1]) / 2, clearance: lo };
}

/** Largest connected piece of a section. */
export function largestIsland(sc: Scope, cs: Section): Section {
  const parts: Section[] = cs.decompose();
  if (parts.length <= 1) {
    for (const p of parts) p.delete();
    return cs;
  }
  let best = parts[0];
  for (const p of parts) {
    sc.keep(p);
    if (p.area() > best.area()) best = p;
  }
  return best;
}

/** A square of side `side` centred at (x, y), turned `rotation` degrees. */
export function squareAt(wasm: any, sc: Scope, side: number, x: number, y: number, rotation: number): Section {
  let s = sc.keep(wasm.CrossSection.square([side, side], true));
  if (Math.abs(rotation) > 1e-6) s = sc.keep(s.rotate(rotation));
  return sc.keep(s.translate([x, y]));
}

/** How much of `shape` lies outside `section`, mm². 0 means it fits. */
export function overhangArea(sc: Scope, shape: Section, section: Section): number {
  if (section.isEmpty()) return shape.area();
  return sc.keep(shape.subtract(section)).area();
}

/**
 * Is a sphere buried in a closed solid? Asked with rays rather than a boolean.
 *
 * The image clicker intersects the body with each void and compares volumes — nine booleans
 * against a body it built itself, a few thousand triangles. Against an uploaded model that is
 * nine full copies of a hundred thousand triangles per rebuild. Fourteen rays from the centre
 * answer the same question: every one must cross the surface an odd number of times (the centre
 * is inside) and its first crossing must be further than the radius plus a margin (nothing comes
 * near). A surface sneaking between two rays that close to a 1.6 mm void would have to be a
 * spike thinner than the margin; the mark's own rule is "never visible", and 0.25 mm of plastic
 * over a void is still plastic.
 */
export function sphereBuried(solid: Solid, cx: number, cy: number, cz: number, r: number, margin = 0.25): boolean {
  const dirs: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const k = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) dirs.push([sx * k, sy * k, sz * k]);
  const reach = 1000;
  for (const [dx, dy, dz] of dirs) {
    let hits: { distance: number }[];
    try {
      hits = solid.rayCast([cx, cy, cz], [cx + dx * reach, cy + dy * reach, cz + dz * reach]);
    } catch {
      return false;
    }
    if (hits.length % 2 === 0) return false;
    if (hits[0].distance * reach < r + margin) return false;
  }
  return true;
}

/** Heights of the top surface under a set of XY points (null where the ray misses). */
export function topSurface(solid: Solid, pts: [number, number][], zHigh: number, zLow: number): (number | null)[] {
  return pts.map(([x, y]) => {
    try {
      const hits = solid.rayCast([x, y, zHigh], [x, y, zLow]);
      return hits.length ? hits[0].position[2] : null;
    } catch {
      return null;
    }
  });
}
