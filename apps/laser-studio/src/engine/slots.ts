// Kerf-aware joints: the two widths a cut joint is drawn at, and the slot and tab rings
// themselves. Pure rings, millimetres, Y up, outer rings CCW. The constructions built OUT of
// The stands that used them live in ./cross-stand.ts, ./tent.ts and ./slot-stand.ts (2026-09-22).
//
// There is no CSG on the main thread, so nothing here subtracts anything: a notch is built as
// part of the outline ring that carries it, and `slotRing`/`tabRing` hand back plain rings for
// the cases where the worker (or a `minus` layer) does the boolean.
import type { CutRing } from '@vostok/export';
import { rectRing } from '@vostok/shapes';

export type SlotEdge = 'top' | 'bottom' | 'left' | 'right';

/** How far past its own edge a slot or tab runs, mm — enough that the cut clears the corner. */
const OVERSHOOT = 0.5;
/** The lead-in chamfer on a tab's free end, mm. */
const CHAMFER = 0.4;

// ------------------------------------------------------------------ the fit --
//
// 2026-09-26: the constructions — a phone stand, a QR stand — were all extremely loose, even at
// the Tight setting. The kerf arithmetic below was
// never wrong — what was wrong was the fit it aimed at. Two things, both measured in the field:
//
//   · "3 mm" ply is not 3 mm. Calipered sheets run 2.6–3.3 mm,
//     and a customer who leaves Material thickness on 3 while cutting 2.8 mm ply gets a slot
//     0.2 mm wide of the sheet before any clearance is added. The old Tight (0) and Snug (+0.05)
//     were both POSITIVE gaps on top of that, so no setting on the form could make a joint grip.
//   · A clearance is amplified into wobble by the joint's engagement. A slot 3 mm deep (a board
//     through a base) with 0.2 mm of play rocks ~4°, which at the top of a 120 mm plate is a
//     finger's width of slop. A friction joint in wood only holds under INTERFERENCE.
//
// The fix is the one Ponoko and every flat-pack maker uses: crush NODES. Small bumps on both
// walls of a slot that stand 0.12 mm proud and crush into the mating face as it goes home. The
// walls themselves sit at the Fit's clearance, so the sheet still enters; the nodes are what
// grip, and because a node is only a couple of millimetres long, wood fibre gives under it
// instead of the joint needing a mallet (Ponoko, "Interlocking 3D laser cut designs"; 1CutFab,
// "Optimizing multi-part assemblies"; a press-fit tab is 0.1–0.2 mm over its slot). Nodes also
// absorb the sheet-to-sheet variance a single wall number cannot — but only a tenth or two of it.
// `tests/node/assembly-check.mjs` measured it: a 3.0 sheet meets 0.125 mm of node per side; a
// 2.8 sheet cut from a file drawn for 3 meets 0.02, which is barely a grip. Nodes forgive a
// sheet that varies; they do not forgive a thickness nobody measured. The form says so.
//
// Fit, as the physical wall clearance (negative = interference) — nodes add NODE_BITE per side.
//   Tight  −0.05   walls already grip; nodes pinch 0.29 under the sheet.  Knock it home.
//   Snug    0      walls kiss; nodes pinch 0.24 under.                   Firm thumb press.
//   Easy   +0.10   walls clear; nodes pinch 0.14 under.                  Hand push, comes apart.

/** Fit name → wall clearance, mm. The ONE table every joint in the app reads (it used to be
 *  copied into qr-shared, phone-stand and table-sign, each at the old loose numbers). */
export const FIT: Record<string, number> = { tight: -0.05, snug: 0, easy: 0.1 };
/** The clearance a form's Fit select asks for; an unknown value is Snug. */
export const fitClearance = (name: string | undefined): number => FIT[name ?? ''] ?? FIT.snug!;

/** How far a crush node stands proud of its wall, mm, per side. After the cut both the wall and
 *  the node's crown move back by the same half-kerf, so the drawn height is the height you get. */
export const NODE_BITE = 0.12;
/** A node's footprint along the wall, mm: long enough for a shallow arc the beam follows as a
 *  bump rather than a step, short enough that the fibre under it crushes by thumb. */
const NODE_LEN = 2.4;
/** Kept clear of a slot's mouth, mm, so the mating piece is started square before it grips. */
const NODE_LEAD = 1.5;

/**
 * The width to DRAW a slot so a piece `thickness` thick fits it after cutting.
 *
 * Sign convention: the beam removes `kerf` of material, so a slot leaves the machine about
 * `kerf` WIDER than it was drawn. Draw it that much narrower and the cut slot lands on
 * `thickness + clearance`. The clearance is the Fit's (see FIT above): ≤ 0 is interference, which
 * is what a friction joint in wood needs; a joint that also carries nodes grips on those.
 */
export function slotWidth(thickness: number, kerf: number, clearance = FIT.snug!): number {
  return thickness - kerf + clearance;
}

/**
 * One straight wall from `a` to `b` with crush nodes on it, bulging toward `inward` (the unit
 * normal pointing INTO the slot's void). Returns the points strictly between `a` and `b`, so a
 * caller splices them into its own ring. `skipFromA` / `skipFromB` keep the nodes off a mouth.
 *
 * Node count scales with the wall: one per ~14 mm, at least one, at most four, spread evenly
 * over the part of the wall that is not lead-in.
 */
function nodedWall(
  a: [number, number], b: [number, number], inward: [number, number],
  skipFromA = 0, skipFromB = 0,
): [number, number][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const usable = len - skipFromA - skipFromB;
  if (usable < NODE_LEN * 1.5) return [];
  const count = Math.max(1, Math.min(4, Math.round(usable / 14)));
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const out: [number, number][] = [];
  const half = NODE_LEN / 2;
  // A circular segment: chord NODE_LEN, sagitta NODE_BITE.
  const R = (half * half + NODE_BITE * NODE_BITE) / (2 * NODE_BITE);
  const SEG = 6;
  for (let k = 0; k < count; k++) {
    const s = skipFromA + usable * ((k + 0.5) / count);
    for (let j = 0; j <= SEG; j++) {
      const along = -half + (j / SEG) * NODE_LEN;
      const up = Math.sqrt(Math.max(0, R * R - along * along)) - (R - NODE_BITE);
      out.push([a[0] + ux * (s + along) + inward[0] * up, a[1] + uy * (s + along) + inward[1] * up]);
    }
  }
  return out;
}

/**
 * The width to DRAW a TAB so it comes off the machine `nominal` mm across.
 *
 * `slotWidth`'s missing companion, and the other half of a joint where BOTH sides are cut. A
 * slot is a void, so the beam takes its `kerf` out of the walls and the opening grows; a tab is
 * a boss, so the beam takes the same `kerf` out of the tab itself and it shrinks. Mating two cut
 * faces therefore splits the compensation: draw the tab a kerf WIDE (`n + kerf`) and the slot a
 * kerf NARROW (`slotWidth`), and the physical pair lands exactly `clearance` apart.
 *
 * Never needed where a "tab" is the raw sheet edge — the material's own thickness is not cut
 * in-plane, so `slotWidth` alone is right there and always has been.
 */
export function tabWidth(nominal: number, kerf: number): number {
  return nominal + kerf;
}

// ------------------------------------------------------------------ slots and tabs --

/** Into the part, from each edge. */
const AXIS: Record<SlotEdge, [number, number]> = {
  bottom: [0, 1],
  top: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** A band `width` across, running from `t0` to `t1` along the inward axis of `from`. */
function band(cx: number, cy: number, width: number, t0: number, t1: number, from: SlotEdge): Rect {
  const [ax, ay] = AXIS[from];
  const half = width / 2;
  const x0 = cx + ax * t0;
  const x1 = cx + ax * t1;
  const y0 = cy + ay * t0;
  const y1 = cy + ay * t1;
  return {
    minX: Math.min(x0, x1) - Math.abs(ay) * half,
    maxX: Math.max(x0, x1) + Math.abs(ay) * half,
    minY: Math.min(y0, y1) - Math.abs(ax) * half,
    maxY: Math.max(y0, y1) + Math.abs(ax) * half,
  };
}

/**
 * An open slot: `width` × `depth`, its open end on the part's edge at (cx, cy) and its closed
 * end `depth` INTO the part. `from: 'bottom'` opens downward at the bottom edge, so it spans
 * y ∈ [cy − 0.5, cy + depth] — the half millimetre of overshoot past the edge is what makes it
 * an open slot instead of a slot with a 0.0 mm sliver of material left across its mouth.
 *
 * Meant to be subtracted: give it to a layer with `op: 'cut'`, or to `minus`.
 */
export function slotRing(
  cx: number, cy: number, width: number, depth: number, from: SlotEdge,
  o: { nodes?: boolean } = {},
): CutRing {
  const r = band(cx, cy, width, -OVERSHOOT, depth, from);
  if (!o.nodes) return rectRing(r.minX, r.minY, r.maxX, r.maxY);
  // The two long walls carry nodes; the mouth end (OVERSHOOT outside the edge, then a lead-in)
  // and the closed end stay plain. Corners walked CCW: bottom-left, bottom-right, top-right,
  // top-left — so the bottom wall runs +x, the right wall +y, the top −x and the left −y.
  const bl: [number, number] = [r.minX, r.minY];
  const br: [number, number] = [r.maxX, r.minY];
  const tr: [number, number] = [r.maxX, r.maxY];
  const tl: [number, number] = [r.minX, r.maxY];
  const lead = OVERSHOOT + NODE_LEAD;
  const tail = 0.6;
  if (from === 'left' || from === 'right') {
    // Walls run along x; the mouth is at minX for 'left', maxX for 'right'.
    const [fromMin, fromMax] = from === 'left' ? [lead, tail] : [tail, lead];
    return [
      bl, ...nodedWall(bl, br, [0, 1], fromMin, fromMax),
      br, tr, ...nodedWall(tr, tl, [0, -1], fromMax, fromMin),
      tl,
    ];
  }
  // Walls run along y; the mouth is at minY for 'bottom', maxY for 'top'.
  const [fromMin, fromMax] = from === 'bottom' ? [lead, tail] : [tail, lead];
  return [
    bl, br, ...nodedWall(br, tr, [-1, 0], fromMin, fromMax),
    tr, tl, ...nodedWall(tl, bl, [1, 0], fromMax, fromMin),
  ];
}

/**
 * A closed rectangular through-slot centred on (cx, cy): `across` wide (the mating sheet's
 * thickness direction) and `along` long, with crush nodes on the two long walls. `alongAxis`
 * says which axis the long walls run on. For the slots a brace or a tongue passes THROUGH —
 * the tent's, a slotted base's — where `slotRing`'s open mouth does not apply.
 */
export function slotHoleRing(cx: number, cy: number, across: number, along: number, alongAxis: 'x' | 'y'): CutRing {
  const hx = (alongAxis === 'x' ? along : across) / 2;
  const hy = (alongAxis === 'x' ? across : along) / 2;
  const bl: [number, number] = [cx - hx, cy - hy];
  const br: [number, number] = [cx + hx, cy - hy];
  const tr: [number, number] = [cx + hx, cy + hy];
  const tl: [number, number] = [cx - hx, cy + hy];
  const end = 0.8;
  if (alongAxis === 'x') {
    return [bl, ...nodedWall(bl, br, [0, 1], end, end), br, tr, ...nodedWall(tr, tl, [0, -1], end, end), tl];
  }
  return [bl, br, ...nodedWall(br, tr, [-1, 0], end, end), tr, tl, ...nodedWall(tl, bl, [1, 0], end, end)];
}

/**
 * The mating tab: `width` × `depth` sticking OUT of the edge at (cx, cy), overlapping the part
 * by half a millimetre so a union welds it on rather than leaving a hairline seam. Its free end
 * is chamfered 0.4 mm so it starts in the slot instead of catching on the lip.
 */
export function tabRing(cx: number, cy: number, width: number, depth: number, from: SlotEdge): CutRing {
  const b = band(cx, cy, width, -depth, OVERSHOOT, from);
  const ring = rectRing(b.minX, b.minY, b.maxX, b.maxY);
  const [ax, ay] = AXIS[from];
  const along = (p: [number, number]) => (p[0] - cx) * ax + (p[1] - cy) * ay;
  const free = Math.min(...ring.map(along));
  const ch = Math.max(0, Math.min(CHAMFER, width / 2, depth));
  if (ch === 0) return ring;
  return chamfer(ring, (p) => along(p) < free + 1e-9, ch);
}

/** Replace the picked corners with a short flat, walking order preserved. */
function chamfer(ring: CutRing, pick: (p: [number, number]) => boolean, ch: number): CutRing {
  const n = ring.length;
  const out: CutRing = [];
  const towards = (p: [number, number], q: [number, number]): [number, number] => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t = len === 0 ? 0 : Math.min(ch, len / 2) / len;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    if (!pick(p)) {
      out.push(p);
      continue;
    }
    out.push(towards(p, ring[(i + n - 1) % n]!), towards(p, ring[(i + 1) % n]!));
  }
  return out;
}

// ------------------------------------------------------------------ the stand --

