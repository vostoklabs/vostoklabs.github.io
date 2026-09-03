// The net, turned into drawable paths. Shared, because both halves of the app draw
// the same thing: the cut exporter writes these to SVG and DXF, and the flat view on
// the stage renders them to screen. That is deliberate — if it looks wrong in the
// preview it IS wrong in the file, so no bug can hide between the two.
//
// A fold's DASH is part of that shared truth. It is decided once, in `foldDashSpec`,
// and carried on the path as a spec rather than cut into the geometry, so the preview
// and the file cannot disagree about where the dashes fall — both render it through
// `explodeDashes`, and the `.lac` hands Suite the same two numbers.
//
// It lives here rather than in `cutFiles.ts` because the cut exporter is fenced out
// of the print-only build (see `virtual:cut-pack` in vite.config.ts) and the flat
// view is not.

import type { BoxParams, Crease, Op, Poly, Pt, SolveResult } from '../types';
import { EPS, dashSegment, dist, perfSpec, signedArea } from '../geometry/poly';
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

/** How a fold line is broken up. Millimetres, rounded to 0.1 — Suite's Dash and Gap
 *  fields step in tenths, so an unrounded 2.53 snaps to 2.5 the moment a user touches
 *  the box, and the dashes stop landing where our geometry says they do. */
export interface DashSpec {
  cutMm: number;
  gapMm: number;
}

export interface Path {
  op: Op;
  points: Poly;
  closed: boolean;
  /** Set on a FOLD line that has to arrive broken up. The line is still ONE unbroken
   *  polyline here, and each writer decides how to say "break this": the SVG, the DXF
   *  and the on-screen dieline explode it into real geometry, because geometry is the
   *  only thing an importer cannot ignore; a `.lac` on the blade carries Suite's own
   *  object-level `dash` instead, and Suite breaks the line up at make time.
   *
   *  Never set on a cut ring, a slit or the check rectangle — only the fold loop below
   *  sets it — so nothing that must cut through can ever be turned into a perforation,
   *  and nothing that must stay whole can ever be dashed. */
  dash?: DashSpec;
}

/** The dash a fold of this length gets. The ONE place a dash size is decided, so the
 *  preview, the SVG, the DXF and the `.lac` cannot disagree about it.
 *
 *  The clamp is not optional. `dashSegment` returns ONE UNBROKEN LINE when a fold is
 *  shorter than a single dash-plus-gap, which on a shape-blind importer is a cut
 *  straight through the fold — precisely the bug this whole path exists to prevent, and
 *  reachable from the manual sliders on any short tab. So the pattern is shrunk to fit
 *  rather than allowed to vanish: two dashes and a gap always fit. */
export function foldDashSpec(params: BoxParams, lengthMm: number): DashSpec {
  const base = params.perfAuto
    ? perfSpec(lengthMm, stockById(params.stockId).caliperMm, minPerfCutMm(machineById(params.machineId)))
    : { cutMm: params.perfCutMm, gapMm: params.perfGapMm };
  const need = 2 * base.cutMm + base.gapMm;
  const k = need > lengthMm && need > 0 ? lengthMm / need : 1;
  const r = (v: number): number => Math.max(0.1, Math.round(v * k * 10) / 10);
  return { cutMm: r(base.cutMm), gapMm: r(base.gapMm) };
}

/** Fold lines -> their dashes, as real geometry, spliced in place so document order —
 *  and therefore CUT ORDER — is unchanged. For every writer that has no way of being
 *  told that a line is a fold. Only a two-point fold ever carries a `dash`, so no
 *  polyline can be silently straightened here. */
export function explodeDashes(paths: Path[]): Path[] {
  const out: Path[] = [];
  for (const p of paths) {
    const a = p.points[0];
    const b = p.points[1];
    if (!p.dash || p.closed || p.points.length !== 2 || !a || !b) {
      out.push(p);
      continue;
    }
    for (const seg of dashSegment(a, b, p.dash.cutMm, p.dash.gapMm)) {
      // `op` is preserved: a dashed crease stays on the CREASE layer in the CREASE
      // colour. The layer says what the line MEANS; the geometry says what an importer
      // that ignores layers will do to it.
      out.push({ op: p.op, points: seg, closed: false });
    }
  }
  return out;
}

/** Two folds that a HEM puts side by side, and which must not both be perforated.
 *
 *  A hem is a wall folded back on itself: the wall creases, then the inner ply creases
 *  back over it, and the strip between the two is the material's own thickness — exactly
 *  2 x caliper, 0.76 mm on the default card. Five of the ten styles build one.
 *
 *  Perforate both and that strip is cut from BOTH sides at every dash station, which
 *  leaves a row of loose tabs joined by nothing and it tears off in the hand. It is also
 *  simply redundant: a strip that narrow folds wherever it is weakened, so one
 *  perforation through it serves both folds. A score or a pen line has no such problem
 *  and marks both, which is why this only ever applies to a fold being DASHED.
 *
 *  This is only ever a GUARD on a structural test, never the test itself. Proximity
 *  alone cannot tell a hem from a genuinely short wall: on a 30 x 30 x 6 mm mailer in
 *  2 mm board it also matches {base -> wall} and {back -> lid}, and dropping by distance
 *  took the LID's fold line off the dieline. The hem is marked at its source instead —
 *  see `Panel.hem` and `rollEnd`. */
function hemPartner(a: Crease, b: Crease, limitMm: number): boolean {
  const va: Pt = [a.b[0] - a.a[0], a.b[1] - a.a[1]];
  const vb: Pt = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
  const la = Math.hypot(va[0], va[1]);
  const lb = Math.hypot(vb[0], vb[1]);
  if (la < EPS || lb < EPS) return false;
  // Parallel? (unit cross product ~ 0)
  if (Math.abs(va[0] * vb[1] - va[1] * vb[0]) / (la * lb) > 0.02) return false;
  // Perpendicular distance between the two lines.
  if (Math.abs(va[0] * (b.a[1] - a.a[1]) - va[1] * (b.a[0] - a.a[0])) / la > limitMm) return false;
  // And they must actually run alongside each other, not merely sit on the same line.
  const ux = va[0] / la;
  const uy = va[1] / la;
  const t = (p: Pt): number => (p[0] - a.a[0]) * ux + (p[1] - a.a[1]) * uy;
  const lo = Math.max(Math.min(0, la), Math.min(t(b.a), t(b.b)));
  const hi = Math.min(Math.max(0, la), Math.max(t(b.a), t(b.b)));
  // Proportional, not a fixed 1 mm: a tapered pair must not be judged on its narrow end.
  return hi - lo >= 0.5 * Math.min(la, lb);
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
  //
  // A fold arrives BROKEN UP for one of two reasons, and they are different reasons:
  //
  //   · the user ASKED for a perforation — every machine, every file, both modes;
  //   · the machine's front-end reads shape only, so a solid fold line arrives as a cut
  //     straight through it. Bambu Suite is the one that does this, and it is not a
  //     theory: it re-saved an import of our own SVG with every blue fold line put
  //     back on the blade. That dash is TRANSPORT — it exists to survive an importer, not
  //     because the user wanted a perforation — so it only applies to a file going to a
  //     cutter. A printed box folds on a grooved living hinge and wants a plain line.
  //
  // Either way the dash is CARRIED from here, never cut in: one unbroken polyline per
  // fold, with the spec attached. `explodeDashes` turns it into geometry for whichever
  // writer has no other way to be told, and the `.lac` hands Suite its own `dash`
  // instead. Sized per fold, not once for the whole net — a 20 mm tab and a 200 mm body
  // fold do not want the same pitch.
  if (params.foldMode !== 'none') {
    // A PRINTED box folds on a grooved living hinge, so neither reason applies to it and
    // its fold is always a plain line. This is also what lets the cut half default to a
    // perforation without the shipped print-only app's dieline going dashed underneath it.
    const cutting = params.makeMode === 'cut';
    const perf = cutting && params.foldMode === 'perf';
    const transport = cutting && machineById(params.machineId).svgFold === 'dashed';
    const dashed = perf || transport;

    // A hem's two creases get ONE perforation between them, never two. The inner ply
    // folds back over the roll and the strip between the two creases is the board's own
    // thickness — 2 x caliper, 0.76 mm on the default card. Perforate both and that strip
    // is severed from BOTH sides at every station: a row of loose tabs that tears off in
    // the hand. One perforation through a strip that narrow relieves both folds anyway.
    //
    // Identified by PARENTAGE, not by measuring — `Panel.hem` says which panels these are
    // and `hemPartner` is only a sanity guard on top. A distance test misreads a short
    // wall as a hem and drops the wrong crease, or an unrelated one entirely.
    //
    // The crease that is KEPT is the parent, wall -> roll: it sets the wall height and is
    // what the ear and the nib lock register against. The one dropped folds a 2t-wide
    // strip, which folds wherever it is weakened.
    const hemPly = new Set(net.panels.filter((x) => x.hem).map((x) => x.id));
    const creaseOf = new Map(net.creases.map((c) => [c.panelId, c]));
    const limitMm = Math.min(4.5, Math.max(1.5, 3 * params.caliperMm));
    const dropped = new Set<Crease>();
    if (dashed) {
      for (const c of net.creases) {
        if (!hemPly.has(c.panelId)) continue;
        const parent = creaseOf.get(c.parentId);
        if (parent && hemPartner(parent, c, limitMm)) dropped.add(c);
      }
    }

    for (const c of net.creases) {
      if (dropped.has(c)) continue;
      inner.push({
        op: perf ? 'perf' : 'crease',
        points: [c.a, c.b],
        closed: false,
        ...(dashed ? { dash: foldDashSpec(params, dist(c.a, c.b)) } : {}),
      });
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
