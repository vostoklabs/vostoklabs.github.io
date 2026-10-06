// The pieces a set of OPEN cut lines makes of a plate — a jigsaw's seams (2026-09-27).
//
// A cut layer's `paths` are burnt once each along a line, never as two touching outlines (a
// double pass scorches the edge and loosens the fit), so nothing in the build ever holds the
// pieces as islands: the plate stays one ring with lines drawn across it. The only honest count
// is to make the cut. Every segment of every run becomes a ribbon a twentieth of a millimetre
// wide, the ribbons come off the plate, and what is left falls apart into its pieces the way the
// sheet will. Each ribbon is carried a hair past both ends of its segment, so a run that ends ON
// the outline, or on another run, really does part the material rather than leaving a bridge
// of rounding error — and consecutive segments overlap, so a bend never opens a gap.
//
// Per segment rather than one offset polygon per run: a ribbon walked round a whole polyline
// twists into a figure-8 wherever the line turns tighter than its own width, and a twisted ring
// under the 'Positive' fill rule leaves the twist unfilled — a bridge nobody drew. A quad cannot
// twist.
import { subtractShapes } from '@vostok/laser/csg2d';
import type { Shapes } from '@vostok/shapes';

type Pt = [number, number];

/** Half the ribbon's width, mm. Far under any kerf: two runs this close are one cut anyway. */
const HALF = 0.025;
/** How far a run's true ends are carried on past where the run stops, mm. */
const REACH = 0.08;

/** One segment as a thin quad, carried `before` and `after` mm past its ends. */
function quad(a: Pt, b: Pt, before: number, after: number): Pt[] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * HALF;
  const ny = ux * HALF;
  const s: Pt = [a[0] - ux * before, a[1] - uy * before];
  const e: Pt = [b[0] + ux * after, b[1] + uy * after];
  return [[s[0] - nx, s[1] - ny], [e[0] - nx, e[1] - ny], [e[0] + nx, e[1] + ny], [s[0] + nx, s[1] + ny]];
}

/** The plate less a thin ribbon along every run: the pieces the cut lines make, as islands. */
export function cutLinePieces(wasm: any, plate: Shapes, paths: Pt[][]): Shapes {
  const ribbons: Shapes = [];
  for (const path of paths) {
    const n = path.length;
    for (let i = 0; i + 1 < n; i++) {
      const q = quad(path[i]!, path[i + 1]!, i === 0 ? REACH : 2 * HALF, i + 2 === n ? REACH : 2 * HALF);
      if (q) ribbons.push([q]);
    }
  }
  if (!ribbons.length || !plate.length) return plate;
  return subtractShapes(wasm, plate, ribbons);
}
