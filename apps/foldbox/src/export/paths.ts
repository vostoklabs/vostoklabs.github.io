// The net, turned into drawable paths. Shared, because both halves of the app draw
// the same thing: the cut exporter writes these to SVG and DXF, and the flat view on
// the stage renders them to screen. That is deliberate — if it looks wrong in the
// preview it IS wrong in the file, so no bug can hide between the two.
//
// It lives here rather than in `cutFiles.ts` because the cut exporter is fenced out
// of the print-only build (see `virtual:cut-pack` in vite.config.ts) and the flat
// view is not.

import type { Op, Poly, SolveResult } from '../types';
import { dashSegment, dist, perfSpec, signedArea } from '../geometry/poly';
import { machineById, minPerfCutMm, stockById } from '../geometry/solve';

/** Operation -> colour. These are the conventions the machines actually recognise:
 *  red cuts on every laser front-end since the 1990s, and the rest simply have to be
 *  distinct from it and from each other. */
export const OP_COLOR: Record<Op, string> = {
  cut: '#FF0000',
  crease: '#0000FF',
  perf: '#00A0FF',
  film: '#00C0C0',
  engrave: '#000000',
};

export interface Path {
  op: Op;
  points: Poly;
  closed: boolean;
}

/** Every path in the file, in cut order. */
export function collectPaths(result: SolveResult): Path[] {
  const { net, params } = result;
  const holes: Path[] = [];
  const outers: Path[] = [];
  const inner: Path[] = [];

  for (const ring of net.cutRings) {
    (signedArea(ring) < 0 ? holes : outers).push({ op: 'cut', points: ring, closed: true });
  }

  // Fold lines. What they become is the single decision this whole file turns on,
  // because no target machine has a crease operation: a laser scores (and browns the
  // outside of the box), a blade perforates, a pen draws a line you fold by hand.
  if (params.foldMode !== 'none') {
    const caliperMm = stockById(params.stockId).caliperMm;
    const minCutMm = minPerfCutMm(machineById(params.machineId));
    for (const c of net.creases) {
      if (params.foldMode === 'perf') {
        // Sized per fold, not once for the whole net. Rule of thumb in `perfSpec`.
        const spec = params.perfAuto
          ? perfSpec(dist(c.a, c.b), caliperMm, minCutMm)
          : { cutMm: params.perfCutMm, gapMm: params.perfGapMm };
        for (const seg of dashSegment(c.a, c.b, spec.cutMm, spec.gapMm)) {
          inner.push({ op: 'perf', points: seg, closed: false });
        }
      } else {
        inner.push({ op: 'crease', points: [c.a, c.b], closed: false });
      }
    }
  }

  for (const s of net.slits) {
    if (s.op === 'crease' && params.foldMode === 'none') continue;
    inner.push({ op: s.op, points: s.points, closed: false });
  }

  for (const l of net.loose) {
    for (const h of l.holes) holes.push({ op: l.op, points: h, closed: true });
    outers.push({ op: l.op, points: l.outline, closed: true });
  }

  // Holes and interior features first, perimeters last. Rule 2.
  return [...holes, ...inner, ...outers];
}
