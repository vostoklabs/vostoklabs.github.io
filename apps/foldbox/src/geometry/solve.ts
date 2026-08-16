// Build the net, then tell the truth about it.
//
// The single most useful thing this tool can say is "that will not fit", because the
// arithmetic nobody does is the sheet arithmetic: a tuck carton's blank is about
// 4S+12 by 3S+24 for a cube of side S, so the largest cube a Cricut mat or an H2D
// can cut is around 70 mm. Every incumbent lets the user find that out at the end.
// Here it is in the status line the whole time.

import type { BoxParams, Diagnostic, Machine, Net, Sheet, SolveResult, Stock } from '../types';
import { MACHINES, SHEETS, STOCKS } from '../types';
import { buildNet, placeNet } from './net';
import { TRADE_INSET, buildStyle, insideDims, styleMeta } from './styles';
import { at, bboxOf, offsetRing } from './poly';

export const SHEET_MARGIN_MM = 5;

export function machineById(id: string): Machine {
  return MACHINES.find((m) => m.id === id) ?? (MACHINES[0] as Machine);
}
export function sheetById(id: string): Sheet {
  return SHEETS.find((s) => s.id === id) ?? (SHEETS[0] as Sheet);
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
  const cutRings = net.cutRings.map((r) => offsetRing(r, d));
  const loose = net.loose.map((l) => ({
    ...l,
    outline: offsetRing(l.outline, l.op === 'film' ? 0 : d),
    holes: l.holes.map((h) => offsetRing(h, d)),
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

function rawNet(p: BoxParams): { net: Net; windowFitted: boolean; windowInsetMm: number } {
  const { parts, windowFitted, windowInsetMm } = buildStyle(p);
  return { net: placeNet(buildNet(parts), SHEET_MARGIN_MM), windowFitted, windowInsetMm };
}

export function solve(p: BoxParams): SolveResult {
  const machine = machineById(p.machineId);
  const sheet = sheetById(p.sheetId);
  const stock = stockById(p.stockId);
  const { L, W, H } = insideDims(p);
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
          ? `A cube up to about ${cube} mm fits this sheet in this style. Boxes eat a lot of paper — go smaller, pick a bigger sheet, or use the 12 × 24 mat.`
          : 'Pick a larger sheet — this box will not fit any orientation of the current one.',
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
  const expectedOuter = p.style === 'tray-lid' ? 2 : p.style === 'divider' ? 0 : 1;
  if (net.panels.length && outerRings.length !== expectedOuter) {
    diagnostics.push({
      level: 'error',
      code: 'connectivity',
      message: `The blank came out as ${outerRings.length} separate piece${outerRings.length === 1 ? '' : 's'} instead of ${expectedOuter}.`,
      fix: 'Some panel has been squeezed to nothing at this size. Try a taller box or a thinner stock.',
    });
  }

  if (machine.maxCaliperMm > 0 && p.caliperMm > machine.maxCaliperMm) {
    diagnostics.push({
      level: 'error',
      code: 'caliper',
      message: `${stock.name} is ${p.caliperMm.toFixed(2)} mm and ${machine.name} tops out at ${machine.maxCaliperMm} mm.`,
      fix: 'Drop to a lighter stock, or cut this one on the laser instead — the laser has no thickness limit here.',
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
      fix: 'Fine on a hand-folded box, but that face is now the weak one — it will bow if you stack anything on it. Shrink the window or make the box taller to get the full border back.',
    });
  }

  // A grid of 1 x 1 is a box with no dividers in it: both strip loops run zero times,
  // so the blank comes out genuinely empty. Gate on the built net rather than on the
  // raw slider values, which the builder clamps behind our back.
  if (p.style === 'divider' && !net.loose.length) {
    diagnostics.push({
      level: 'error',
      code: 'divider',
      message: 'A 1 x 1 grid has no dividers in it — there is nothing to cut.',
      fix: 'Take columns or rows to 2 or more. One divider strip splits a box in two.',
    });
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

  if (p.foldMode === 'perf') {
    const minFeature = machine.id.startsWith('h2d') && machine.foldMode !== 'score' ? 1 : 0.5;
    if (p.perfCutMm < minFeature) {
      diagnostics.push({
        level: 'warning',
        code: 'perf',
        message: `${p.perfCutMm} mm dashes are below what ${machine.name} can reliably cut.`,
        fix: `Keep dashes at ${minFeature} mm or more — below that the blade tip cannot make the move.`,
      });
    }
  }

  // Grain is a one-bit decision, never an optimisation: a tube's body creases and its
  // flap creases are mutually orthogonal, so no rotation puts all of them with the
  // grain. It is only worth saying anything at all on heavy coated stock.
  if (stock.gsm >= 300 && meta.uses.tuck) {
    diagnostics.push({
      level: 'info',
      code: 'grain',
      message: `At ${stock.gsm} gsm the creases running across the grain may crack.`,
      fix: 'Score them a little deeper, or fold slowly over a straight edge. Turning the sheet only trades one set of folds for the other — they run at right angles.',
    });
  }

  if (machine.mirror) {
    diagnostics.push({
      level: 'info',
      code: 'mirror',
      message: 'This machine folds into the score, so the sheet goes on the mat pretty side down.',
      fix: 'Mirror any artwork you add. The dieline itself is symmetric, so the cut file needs nothing.',
    });
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
  };
}
