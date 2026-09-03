// Build the net, then tell the truth about it.
//
// The single most useful thing this tool can say is "that will not fit", because the
// arithmetic nobody does is the sheet arithmetic: a tuck carton's blank is about
// 4S+12 by 3S+24 for a cube of side S, so the largest cube a Cricut mat or an H2D
// can cut is around 70 mm. Every incumbent lets the user find that out at the end.
// Here it is in the status line the whole time.

import type { BoxParams, Diagnostic, Machine, Net, Poly, Sheet, SolveResult, Stock } from '../types';
import { MACHINES, SHEETS, STOCKS } from '../types';
import { buildNet, placeNet } from './net';
import { TRADE_INSET, buildStyle, insideDims, styleMeta } from './styles';
import { slotFit } from './fit';
import { at, bboxOf, offsetRing, signedArea } from './poly';

export const SHEET_MARGIN_MM = 5;

export function machineById(id: string): Machine {
  return MACHINES.find((m) => m.id === id) ?? (MACHINES[0] as Machine);
}
export function sheetById(id: string): Sheet {
  return SHEETS.find((s) => s.id === id) ?? (SHEETS[0] as Sheet);
}
/** Shortest dash this machine can actually make. The H2D's drag knife swivels through
 *  a 0.36 mm arc at every direction change, so anything near 1 mm is mostly turn. */
export function minPerfCutMm(machine: Machine): number {
  return machine.id.startsWith('h2d') && machine.foldMode !== 'score' ? 1 : 0.5;
}

export function stockById(id: string): Stock {
  return STOCKS.find((s) => s.id === id) ?? (STOCKS[2] as Stock);
}

/** Kerf compensation: grow every cut ring by half the beam so the finished part
 *  measures what it was drawn as. Applied at the very end, to the rings only —
 *  creases and pen marks have no kerf, and a fold line moved by half a beam width
 *  would put the crease off the corner.
 *
 *  A drag knife is effectively zero here, which is why the field defaults to 0 on
 *  every blade machine and only wakes up for a laser. */
function applyKerf(net: Net, kerfMm: number): Net {
  if (kerfMm <= 0) return net;
  const d = kerfMm / 2;
  // Kerf compensation runs in OPPOSITE directions for a boundary and a hole, and this
  // used to push both the same way.
  //
  // The beam removes a band of width `kerf` centred on the path. To finish a boundary
  // at nominal you draw it half a kerf OUTSIDE and let the beam eat back to the line.
  // To finish a HOLE at nominal you must draw it half a kerf INSIDE, for exactly the
  // same reason — the beam eats outward from the path, so a hole drawn on the nominal
  // line comes out a full kerf too big.
  //
  // Growing both was measurable and it landed on the one feature that can least afford
  // it: a 1.80 mm nib slot exported at 1.97 mm on a 0.17 mm-kerf laser and finished
  // near 2.14 mm. The lock got looser the finer the machine, which is backwards.
  //
  // `cutRings` holds outers wound CCW and holes wound CW, so the winding is the test.
  const hole = (r: Poly) => signedArea(r) < 0;
  const cutRings = net.cutRings.map((r) => offsetRing(r, hole(r) ? -d : d));
  const loose = net.loose.map((l) => ({
    ...l,
    outline: offsetRing(l.outline, l.op === 'film' ? 0 : d),
    holes: l.holes.map((h) => offsetRing(h, hole(h) ? -d : d)),
  }));
  return {
    ...net,
    cutRings,
    loose,
    // Recompute, or the blank silently reports its pre-kerf size — which makes the
    // fit check wrong by exactly the amount the compensation just added, on the one
    // axis where it matters most.
    bbox: bboxOf([...cutRings, ...loose.map((l) => l.outline)]),
  };
}

/** The blank size for a cube of side S in the current style, used to invert the fit
 *  question into "what is the biggest box that WOULD fit". Measured rather than
 *  derived: build the net at two sizes and fit a line, which stays correct as the
 *  builders change and costs two cheap builds. */
function largestCube(p: BoxParams, sheet: Sheet, margin: number): number {
  const avail: [number, number] = [sheet.widthMm - 2 * margin, sheet.heightMm - 2 * margin];
  const measure = (s: number): [number, number] => {
    const { net } = rawNet({ ...p, lengthMm: s, widthMm: s, heightMm: s, dimBasis: 'inside' });
    return [net.bbox[2] - net.bbox[0], net.bbox[3] - net.bbox[1]];
  };
  const s0 = 20;
  const s1 = 100;
  const a = measure(s0);
  const b = measure(s1);

  // Blank size is affine in S for every style here — panels are sums of L, W, H and
  // constants — so two builds determine it exactly. The sheet can be used either way
  // round, so the answer is the better of the two orientations.
  const limitFor = (av: [number, number]): number => {
    let lim = Infinity;
    for (const axis of [0, 1]) {
      const slope = ((b[axis] as number) - (a[axis] as number)) / (s1 - s0);
      if (slope <= 1e-6) continue; // this axis does not grow with S
      const intercept = (a[axis] as number) - slope * s0;
      lim = Math.min(lim, ((av[axis] as number) - intercept) / slope);
    }
    return lim === Infinity ? 0 : lim;
  };
  return Math.max(0, Math.floor(Math.max(limitFor(avail), limitFor([avail[1], avail[0]]))));
}

/** The biggest version of THIS box, at the proportions the user typed, that still
 *  fits the chosen sheet.
 *
 *  `largestCube` answers a different question — the biggest CUBE — and a cube is
 *  rarely the box anyone wants. Boxes eat paper at a rate nobody predicts (a mailer
 *  is `L + 4H` wide before it is anything else), so "the one you asked for does not
 *  fit, here is the same box that does" is worth more than any amount of advice.
 *
 *  Bisection rather than arithmetic: blank size is affine in the dimensions but the
 *  clamps inside the builders are not, and a solve is cheap. */
export function fitToSheet(input: BoxParams): Pick<BoxParams, 'lengthMm' | 'widthMm' | 'heightMm'> {
  const p: BoxParams = { ...input, caliperMm: effectiveCaliper(input) };
  const sheet = sheetById(p.sheetId);
  const availW = sheet.widthMm - 2 * SHEET_MARGIN_MM;
  const availH = sheet.heightMm - 2 * SHEET_MARGIN_MM;

  const at = (s: number): Pick<BoxParams, 'lengthMm' | 'widthMm' | 'heightMm'> => ({
    lengthMm: Math.max(8, Math.round(p.lengthMm * s)),
    widthMm: Math.max(8, Math.round(p.widthMm * s)),
    heightMm: Math.max(4, Math.round(p.heightMm * s)),
  });
  const fits = (dims: ReturnType<typeof at>): boolean => {
    const { net } = rawNet({ ...p, ...dims });
    const w = net.bbox[2] - net.bbox[0];
    const h = net.bbox[3] - net.bbox[1];
    return (w <= availW && h <= availH) || (h <= availW && w <= availH);
  };

  if (fits(at(1))) {
    // Already fits — grow it instead, so the button is useful in both directions.
    let lo = 1;
    let hi = 8;
    if (fits(at(hi))) return at(hi);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    return at(lo);
  }

  let lo = 0.02;
  let hi = 1;
  if (!fits(at(lo))) return at(lo);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (fits(at(mid))) lo = mid;
    else hi = mid;
  }
  // Rounding to whole millimetres can push it back over the edge, so step down until
  // the answer is one that actually fits rather than one that nearly does.
  let dims = at(lo);
  for (let guard = 0; guard < 40 && !fits(dims); guard++) {
    lo *= 0.98;
    dims = at(lo);
  }
  return dims;
}

function rawNet(p: BoxParams): { net: Net; windowFitted: boolean; windowInsetMm: number } {
  const { parts, windowFitted, windowInsetMm } = buildStyle(p);
  return { net: placeNet(buildNet(parts), SHEET_MARGIN_MM), windowFitted, windowInsetMm };
}

/** The thickness the blank is actually built for.
 *
 *  When you are printing the net, that is not a number to type — it is layers times
 *  layer height, and it can only ever be that. Deriving it here rather than asking
 *  the user to keep two fields in step deletes a whole class of "the tabs do not fit"
 *  and, with it, the drift warning and the reconcile button that used to sit under
 *  the print settings. */
export function effectiveCaliper(p: BoxParams): number {
  return p.makeMode === 'print'
    ? Math.max(1, p.sheetLayers) * p.layerHeightMm
    : p.caliperMm;
}

export function solve(input: BoxParams): SolveResult {
  const p: BoxParams = { ...input, caliperMm: effectiveCaliper(input) };
  const machine = machineById(p.machineId);
  const sheet = sheetById(p.sheetId);
  const stock = stockById(p.stockId);
  const { H } = insideDims(p);
  const meta = styleMeta(p.style);

  const { net: base, windowFitted, windowInsetMm } = rawNet(p);
  const net = applyKerf(base, p.kerfMm);

  const netW = net.bbox[2] - net.bbox[0];
  const netH = net.bbox[3] - net.bbox[1];
  const availW = sheet.widthMm - 2 * SHEET_MARGIN_MM;
  const availH = sheet.heightMm - 2 * SHEET_MARGIN_MM;

  const fitsAsIs = netW <= availW && netH <= availH;
  const fitsRotated = netH <= availW && netW <= availH;
  const overflow = !fitsAsIs && !fitsRotated;
  const rotated = !fitsAsIs && fitsRotated;

  const diagnostics: Diagnostic[] = [];

  if (overflow) {
    const cube = largestCube(p, sheet, SHEET_MARGIN_MM);
    diagnostics.push({
      level: 'error',
      code: 'sheet',
      message: `The blank is ${netW.toFixed(0)} × ${netH.toFixed(0)} mm and ${sheet.name} gives you ${availW.toFixed(0)} × ${availH.toFixed(0)} mm.`,
      fix:
        cube > 20
          ? `A cube up to about ${cube} mm fits this sheet in this style. Boxes eat a lot of paper: go smaller, pick a bigger sheet, or use the 12 × 24 mat.`
          : 'Pick a larger sheet: this box will not fit any orientation of the current one.',
    });
  }

  // The blank must be ONE piece. A parameter combination that severs a panel gives a
  // net that falls apart on the mat, and no other check catches it.
  const outerRings = net.cutRings.filter((r) => {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const a = at(r, i);
      const b = at(r, i + 1);
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s > 0;
  });
  // Read off the style's own metadata rather than testing the id here. A new style
  // whose blank comes in two pieces used to have to remember to edit this line, and
  // the failure mode was silent: the check passed for the wrong reason.
  const expectedOuter = meta.outerPieces;
  if (net.panels.length && outerRings.length !== expectedOuter) {
    diagnostics.push({
      level: 'error',
      code: 'connectivity',
      message: `The blank came out as ${outerRings.length} separate piece${outerRings.length === 1 ? '' : 's'} instead of ${expectedOuter}.`,
      fix: 'Some panel has been squeezed to nothing at this size. Try a taller box or a thinner stock.',
    });
  }

  // A lock the machine cannot cut tight. Reported rather than silently produced: the
  // whole reason the old slot was four times too wide is that nothing ever said so.
  // Gated on the built net, not on the style id: a style has nib locks exactly when
  // its floor has slots cut in it, and reading that off the geometry means the check
  // cannot drift out of step with the builders the way a hardcoded list would.
  const hasNibLocks = net.panels.some((x) => /base$/.test(x.id) && x.holes.length > 0);
  if (hasNibLocks) {
    const fit = slotFit(p, machine, p.caliperMm);
    if (fit.coarse) {
      diagnostics.push({
        level: 'warning',
        code: 'lock-fit',
        message:
          `The locking slots come out ${fit.widthMm.toFixed(2)} mm for a ${p.caliperMm.toFixed(2)} mm tab, ` +
          `${(fit.widthMm - p.caliperMm - 2 * fit.clearMm).toFixed(2)} mm wider than the fit needs.`,
        fix:
          p.makeMode === 'print'
            ? `A slot under ${fit.minFeatureMm.toFixed(2)} mm would print closed at this layer height. Drop the layer height, or add a layer so the tab is thicker relative to the slot.`
            : `${machine.name} cannot cut a slot narrower than about ${fit.minFeatureMm.toFixed(2)} mm and have the waste come out. On a laser it can go to ${(2 * 0.17).toFixed(2)} mm, and the lock will be noticeably tighter.`,
      });
    }
  }

  if (p.makeMode === 'cut' && machine.maxCaliperMm > 0 && p.caliperMm > machine.maxCaliperMm) {
    diagnostics.push({
      level: 'error',
      code: 'caliper',
      message: `${stock.name} is ${p.caliperMm.toFixed(2)} mm and ${machine.name} tops out at ${machine.maxCaliperMm} mm.`,
      fix: 'Drop to a lighter stock, or cut this one on the laser instead: the laser has no thickness limit here.',
    });
  }

  if (p.window && meta.uses.window && !windowFitted) {
    diagnostics.push({
      level: 'error',
      code: 'window',
      message: 'There is no room for a window on that panel.',
      fix: 'A window has to sit clear of every fold and cut or the panel loses its stiffness and creases. Make the box bigger, shrink the window, or turn it off.',
    });
  } else if (p.window && meta.uses.window && windowInsetMm < TRADE_INSET - 0.01) {
    diagnostics.push({
      level: 'warning',
      code: 'window-margin',
      message: `The window leaves a ${windowInsetMm.toFixed(0)} mm border, where a converter would leave ${TRADE_INSET} mm.`,
      fix: 'Fine on a hand-folded box, but that face is now the weak one: it will bow if you stack anything on it. Shrink the window or make the box taller to get the full border back.',
    });
  }

  // A grid of 1 x 1 is a box with no dividers in it: both strip loops run zero times,
  // so the blank comes out genuinely empty. Gate on the built net rather than on the
  // raw slider values, which the builder clamps behind our back.
  if (p.style === 'divider' && !net.loose.length) {
    diagnostics.push({
      level: 'error',
      code: 'divider',
      message: 'A 1 x 1 grid has no dividers in it: there is nothing to cut.',
      fix: 'Take columns or rows to 2 or more. One divider strip splits a box in two.',
    });
  }

  // A hand hole needs ~14 mm of clear opening plus a margin to the rim, so the roll
  // end refuses to cut one it cannot place. Refusing quietly is worse than not
  // offering it: the switch moves, the file does not change, and there is no way to
  // tell that from a bug. Read it off the built net rather than re-deriving the
  // condition here, so the two can never drift apart.
  if (p.handHoles && meta.uses.handHoles) {
    const cut = net.panels.some((x) => /wall|inner/.test(x.id) && x.holes.length > 0);
    if (!cut) {
      diagnostics.push({
        level: 'warning',
        code: 'hand-hole',
        message: `There is no room for a hand hole on a ${H.toFixed(0)} mm tall end.`,
        fix: 'A hole you can get a finger through needs about 14 mm, and it has to stay clear of the rim or it tears out. Take the box to 30 mm tall or more, or leave the holes off.',
      });
    }
  }

  const tuckNeeded = 2 * 8;
  if (meta.uses.tuck && H < tuckNeeded) {
    diagnostics.push({
      level: 'warning',
      code: 'short',
      message: `At ${H.toFixed(0)} mm tall there is barely room for a tuck flap to grip.`,
      fix: 'Under about 16 mm a tuck carton will not stay shut. A tray and lid works much better at this height.',
    });
  }

  // The hem collapse takes a fold line OFF the dieline, and it comes back when the fold
  // mode changes. A line that appears and disappears with no explanation is a landmine,
  // so say it out loud. `Panel.hem` is set by `rollEnd`, the only thing that builds one.
  const hems = net.panels.filter((x) => x.hem).length;
  const dashedFolds =
    p.makeMode === 'cut' && p.foldMode !== 'none' && (p.foldMode === 'perf' || machine.svgFold === 'dashed');
  if (hems > 0 && dashedFolds) {
    diagnostics.push({
      level: 'info',
      code: 'hem',
      message: `The double-ply ends carry one perforated line each, not two.`,
      fix: `Their two creases sit ${(2 * p.caliperMm).toFixed(2)} mm apart — the thickness of your card. Perforating both would cut that strip out. Choose Laser score or Draw a pen line to get both lines marked.`,
    });
  }

  if (p.makeMode === 'cut' && p.foldMode === 'perf' && !p.perfAuto) {
    const minFeature = minPerfCutMm(machine);
    if (p.perfCutMm < minFeature) {
      diagnostics.push({
        level: 'warning',
        code: 'perf',
        message: `${p.perfCutMm} mm dashes are below what ${machine.name} can reliably cut.`,
        fix: `Keep dashes at ${minFeature} mm or more: below that the blade tip cannot make the move.`,
      });
    }
  }

  // Grain is a one-bit decision, never an optimisation: a tube's body creases and its
  // flap creases are mutually orthogonal, so no rotation puts all of them with the
  // grain. It is only worth saying anything at all on heavy coated stock.
  if (p.makeMode === 'cut' && stock.gsm >= 300 && meta.uses.tuck) {
    diagnostics.push({
      level: 'info',
      code: 'grain',
      message: `At ${stock.gsm} gsm the creases running across the grain may crack.`,
      fix: 'Score them a little deeper, or fold slowly over a straight edge. Turning the sheet only trades one set of folds for the other: they run at right angles.',
    });
  }

  if (p.makeMode === 'cut' && machine.mirror) {
    diagnostics.push({
      level: 'info',
      code: 'mirror',
      message: 'This machine folds into the score, so the sheet goes on the mat pretty side down.',
      fix: 'Mirror any artwork you add. The dieline itself is symmetric, so the cut file needs nothing.',
    });
  }

  // The printed sheet's own gotcha, and the only one it has: a groove can only be
  // on the face that is up, so a fold that goes the other way has to be worked from
  // underneath. Silence about it is why the first test print of a handle box comes
  // back with two cracked straps.
  if (p.makeMode === 'print') {
    const mountains = net.creases.filter((c) => c.dir === 'mountain').length;
    if (mountains > 0) {
      diagnostics.push({
        level: 'info',
        code: 'mountain',
        message: `${mountains} of the ${net.creases.length} folds go the opposite way to the rest.`,
        fix: 'The grooves are all on the top face, so press those ones in from underneath; the edge of a table works well. They still fold; they just fold against their groove.',
      });
    }
    if (p.hingeLayers >= p.sheetLayers) {
      diagnostics.push({
        level: 'warning',
        code: 'no-hinge',
        message: 'With the hinge as thick as the sheet there are no fold lines on the print at all.',
        fix: 'It comes out as a plain slab with nothing to fold against. Drop the hinge to one layer unless you meant to score it by hand.',
      });
    }
  }

  return {
    net,
    params: p,
    diagnostics,
    netSizeMm: [netW, netH],
    overflow,
    rotated,
    largestCubeMm: largestCube(p, sheet, SHEET_MARGIN_MM),
    cutLengthMm:
      net.lengthByOp.cut + net.lengthByOp.crease + net.lengthByOp.perf + net.lengthByOp.film,
    ecmaDimsMm: ecmaDims(p),
  };
}

/** ECMA A x B x H — the standard's own convention, measured centre to centre of the
 *  crease lines (ECMA Code s.2, p.6).
 *
 *  We work in INSIDE dimensions everywhere, because that is what has to fit the
 *  product. The trade works centre-to-centre, because that is what the die is cut to.
 *  The two differ by half a caliper per wall: the inside face is t/2 in from the
 *  crease centre on each side, so A = L + t, B = W + t.
 *
 *  H is the odd one out and the standard says why (p.7): for a carton with a closure
 *  it is measured between the flaps that close FIRST — that is, from the base crease
 *  to the top crease, which is one t/2 at the bottom only, since the top of a tray
 *  wall is a cut edge and not a crease at all. So H = inside height + t/2.
 *
 *  Reported alongside our own numbers rather than instead of them. A printer quotes
 *  against these; nobody's product fits them. */
function ecmaDims(p: BoxParams): [number, number, number] {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  return [L + t, W + t, H + t / 2];
}
