// The designer's numbers. A fit gives a radius of 0.199996 mm where the designer typed 0.2: the
// file then holds a torus whose ring is a hair smaller than its tube, which an importer may
// refuse, and a person editing the part reads 0.199996 in every dialog.
//
// Each radius (and a cone's angle) is rounded to the coarsest step that still holds every
// vertex of every face on that surface within the tolerance the fit already met. A derived
// number (11.4142 = 10 + 1.4142) stays as fitted, because no round number holds the points.

import { type Mesh, triVerts, vtx } from './mesh';
import { type Analytic, type Surface, distance } from './surfaces';

/** Steps a length is rounded to, coarsest first (mm). */
const MM = [1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001];
/** Steps an angle is rounded to, coarsest first (degrees). */
const DEG = [1, 0.5, 0.1, 0.05, 0.01];

type Face = { tris: number[]; surf: Surface | null; err: number };

/** Rounds the surfaces' numbers in place. Returns how many numbers moved. */
export function snapSurfaces(m: Mesh, faces: Face[], eps: number): number {
  const on = new Map<Analytic, Set<number>>();
  for (const f of faces) {
    const s = f.surf;
    if (!s || !(s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'sphere' || s.kind === 'torus')) continue;
    const vs = on.get(s) ?? new Set<number>();
    for (const t of f.tris) for (const v of triVerts(m, t)) vs.add(v);
    on.set(s, vs);
  }
  let moved = 0;
  for (const [s, vs] of on) {
    const pts = [...vs].map((v) => vtx(m.pos, v));
    const worst = () => { let e = 0; for (const p of pts) e = Math.max(e, Math.abs(distance(s, p))); return e; };
    // A face read loosely may move by the point tolerance too: its worst vertex is where two
    // surfaces meet, and the rounded number is the design's.
    const limit = Math.max(eps, worst() + eps);
    /** Round one number of s, read and written through get/set, to the coarsest step that holds. */
    const snap = (get: () => number, set: (x: number) => void, steps: number[], unit = 1) => {
      const x = get();
      for (const step of steps) {
        const y = (Math.round(x / unit / step) * step) * unit;
        if (y === x) return;
        if (!(y > 0)) continue;
        set(y);
        if (worst() <= limit) { moved++; return; }
        set(x);
      }
    };
    switch (s.kind) {
      case 'cylinder': case 'sphere':
        snap(() => s.r, (x) => (s.r = x), MM);
        break;
      case 'cone':
        snap(() => s.ang, (x) => (s.ang = x), DEG, Math.PI / 180);
        break;
      case 'torus':
        snap(() => s.r, (x) => (s.r = x), MM);
        snap(() => s.R, (x) => (s.R = x), MM);
        // A ring a hair smaller than its tube is the designer's ring equal to it (a round run
        // round a corner of the same radius): written as fitted, it is a different, self-crossing
        // surface that importers may refuse.
        if (s.R < s.r && s.r - s.R <= limit) {
          const R = s.R;
          s.R = s.r;
          if (worst() <= limit) moved++;
          else s.R = R;
        }
        break;
    }
  }
  return moved;
}
