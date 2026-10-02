// Dahlia: pointed petals in rings round one point, each ring turned half a petal against the
// ring inside it and every petal a size up. It is the burst on the half business card,
// the half card's default, and the library had nothing like it: Rays is a fan of wedges, and
// rosette, sunflower and mandala are motifs with no petals that stand free of each other.
//
// It is a LINE pattern, so a cut is a lattice (`@vostok/patterns` lattice.ts): the lines stay as
// struts `web` wide and every petal between them is cut out. The lines are a tessellation drawn
// in log-polar space, (ln r, θ): a plain grid of diamonds, staggered row by row, becomes petals
// that grow with their distance from the centre and keep their shape, because a step along ln r
// is the same step in proportion anywhere (the petal at 40 mm is the one at 20 mm, twice the
// size). Every edge is shared by two petals, the inner half of one and the outer half of the
// next ring's; bowing it into the outer petal pinches that petal's inner end and swells the other
// one's outer end, so every petal is narrow where it starts and full where it ends, the dahlia's
// teardrop. The strut is the web whatever the petal, so the petals near the centre, too small to
// hold the lattice's 1 mm opening, stay wood, and the burst grows out of a solid heart as it does
// in the photo. The heart itself is a `solid` (as Rays' hub is), so every line lands on it.
//
// An app's own pattern, registered at load through the package's `registerPatterns`: the pattern
// engine is shared, and this is the one pattern only the cards needed. It could move into
// `packages/patterns/src/patterns/radial.ts` as it is.
import { circle, num, number, registerPatterns, type PatternDef, type Polyline, type Pt } from '@vostok/patterns';

/** How far a box reaches from the origin: the burst is drawn out to there. */
const reach = (b: { minX: number; minY: number; maxX: number; maxY: number }): number =>
  Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

/** Points per edge of the tessellation: an edge is a bowed spiral arc, and ten steps keep it
 *  within a kerf of the curve on the biggest petal a card carries. */
const STEPS = 10;

export const dahlia: PatternDef = {
  id: 'dahlia',
  name: 'Dahlia',
  family: 'radial',
  tags: ['lines', 'flower', 'petals', 'burst', 'radial', 'floral'],
  blurb: 'Pointed petals ring on ring from one centre, a dahlia in bloom.',
  ops: ['score', 'engrave'],
  params: [
    number('count', 'Petals', 20, 8, 48, 1, ''),
    number('length', 'Petal length', 2.4, 1.2, 4, 0.1, '×'),
    number('bulge', 'Fullness', 0.3, 0, 0.6, 0.05, ''),
    number('inner', 'Heart', 4, 1, 50, 0.5),
  ],
  thumb: { params: { inner: 2 } },
  generate: (box, p) => {
    const n = Math.round(num(p, 'count'));
    const w = Math.PI / n;
    const h = num(p, 'length') * w;
    const bulge = num(p, 'bulge');
    const r0 = Math.max(0.5, num(p, 'inner'));
    const u0 = Math.log(r0);
    const top = Math.max(1, Math.ceil((Math.log(reach(box) + 1) - u0) / h));
    // (U, V) are the grid's own units: a diamond's centre sits on integers with U + V even, its
    // corners on the integers with U + V odd, so every line runs through corners only.
    const at = (U: number, V: number): Pt => {
      const r = Math.exp(u0 + U * h);
      return [r * Math.cos(V * w), r * Math.sin(V * w)];
    };
    const lines: Polyline[] = [];
    // Two families of lines, V = dir·(U − c) for every odd c round the circle: `dir` −1 falls
    // as U climbs, +1 climbs with it. Each edge bows `bulge` of the way toward the centre of the
    // petal whose INNER half it is — the one a row further out, (+½, −dir·½) from the edge's
    // middle in these units — and the same way on every edge of a line, so a line is scalloped.
    for (const dir of [-1, 1]) {
      for (let c = 1; c < 2 * n; c += 2) {
        const run: Polyline = [];
        for (let m = 0; m < top; m++) {
          for (let s = m ? 1 : 0; s <= STEPS; s++) {
            const U = m + s / STEPS;
            const b = 0.5 * bulge * Math.sin((Math.PI * s) / STEPS);
            run.push(at(U + b, dir * (U - c - b)));
          }
        }
        lines.push(run);
      }
    }
    // The heart: drawn round the circle (chords outside it), so every line's first point is on
    // or inside it — as Rays does its hub.
    return { holes: [], lines, slits: [], solids: [[circle(0, 0, r0 / Math.cos(Math.PI / 96), 96)]] };
  },
};

registerPatterns([dahlia]);
