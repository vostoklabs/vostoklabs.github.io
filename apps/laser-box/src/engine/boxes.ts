// Box styles → slabs, joints and the features no joint describes (feet, a finger notch, a
// hinge's pins and rounds, a lid's slots). Every style is the same body — four walls and a floor
// — with a different top; what differs is one function per style below, each with its numbers
// derived in its header.
//
// Ranks — who keeps a corner block shared by three pieces: FRONT
// and BACK keep every corner (rank 3), the SIDES keep their run along the floor and the lid
// (rank 2), the FLOOR and LID keep nothing at a corner (rank 1). One total order, so a corner
// can never be claimed twice. A drawer's case has no front, so its back and sides lead.
import { fingerMin, fingerTarget, flexMin, flexTarget, footCount, planFingers } from './fingers';
import { circleRing } from '@vostok/laser/rings';
import { rectRing, roundedRectRing } from '@vostok/shapes';
import { doorwayRing, edgeNotchRing } from './shapes';
import { along, axisOf, clearRect, footprintOn, originOf, outlineOf, type SlabWorld } from './slabs';
import type { BoxSpec } from './spec';
import type { Axis, FaceId, Joint, JointKind, Motion, Pt, Ring, Shapes, Slab, V3 } from './types';

/** One piece as the engine drew it, before the worker adds and takes away its features, fills
 *  a pattern and offsets for the kerf. Everything in the piece's own frame. */
export interface PieceDraft {
  id: string;
  label: string;
  face: FaceId | null;
  /** The traced (or drawn) outline: one island. */
  outline: Shapes;
  /** Material added before anything is taken away: a hinge's ears. */
  addOn: Ring[];
  /** Taken away: feet arches, a finger notch, a hinge's round, a lid's slot. */
  cutAway: Ring[];
  /** A flex tab's slits: open cuts, tip to root. */
  slits: Pt[][];
  /** Where a pattern may go, before its margin, in the piece's frame. */
  safe: { u0: number; v0: number; u1: number; v1: number } | null;
  /** Rings a pattern must keep its margin from (a finger hole). */
  keepOut: Ring[];
  origin: V3;
  u: V3;
  v: V3;
  thickness: number;
  motion?: Motion;
  /** `lid` and `drawer` parts move in the 3D view; `insert` parts (dividers, a lip) explode
   *  further; `body` stays put. */
  role: 'body' | 'lid' | 'drawer' | 'insert';
}

export interface BoxModel {
  pieces: PieceDraft[];
  world: SlabWorld;
  /** Outside size, mm: the walls' — what the customer set, or what was built from the inside. */
  outside: { x: number; y: number; z: number };
  /** Everything included, mm: a hinge's knuckles above the walls and its latch tab in front of
   *  them stand proud of `outside`. Equal to it on every other box. */
  overall: { x: number; y: number; z: number };
  /** The space inside, mm. */
  inside: { x: number; y: number; z: number };
  warnings: string[];
}

/** The frames the six faces are drawn in: u × v points OUT of the box, and "up" on every wall
 *  is up in the world, so a pattern reads the right way round from outside. */
const FRAMES: Record<FaceId, { u: V3; v: V3; normal: 0 | 1 | 2 }> = {
  front: { u: [1, 0, 0], v: [0, 0, 1], normal: 1 },
  back: { u: [-1, 0, 0], v: [0, 0, 1], normal: 1 },
  left: { u: [0, -1, 0], v: [0, 0, 1], normal: 0 },
  right: { u: [0, 1, 0], v: [0, 0, 1], normal: 0 },
  bottom: { u: [1, 0, 0], v: [0, -1, 0], normal: 2 },
  lid: { u: [1, 0, 0], v: [0, 1, 0], normal: 2 },
};

/** A slab facing like `face`, spanning `min`–`max`. */
function slab(id: string, face: FaceId, min: V3, max: V3, rank: number): Slab {
  const f = FRAMES[face];
  return { id, normal: f.normal, box: { min, max }, rank, u: f.u, v: f.v };
}

interface Ctx {
  spec: BoxSpec;
  t: number;
  warnings: string[];
}

/** Extra interference a flex tab is drawn with, mm, along the joint: its arms give into the
 *  slits, so it takes a firmer press than a solid finger without splitting either piece. Smaller
 *  than a long spring's would be — a sheet-wide arm a sheet long is stiff. */
export const FLEX_BONUS = 0.1;

/** Fingers along `[lo, hi]`: the customer's own tab width when they set one; else a flex tab's
 *  width on a joint that takes them (`flexy`) — and a plain finger's where an edge is too short
 *  for even one flex tab, rather than none — and a plain finger's everywhere else. */
function plan(c: Ctx, lo: number, hi: number, flexy = false): [number, number][] {
  if (c.spec.finger > 0) return planFingers(lo, hi, c.spec.finger, fingerMin(c.t)).intervals;
  if (flexy) {
    const p = planFingers(lo, hi, flexTarget(c.t), flexMin(c.t));
    if (p.intervals.length) return p.intervals;
  }
  return planFingers(lo, hi, fingerTarget(c.t), fingerMin(c.t)).intervals;
}

/**
 * Fingers along `[lo, hi]` laid out BETWEEN `crossings` — where a divider's line meets the edge —
 * a sheet clear either side of each. A divider standing over a floor's tab notches it (the
 * wall keeps that corner block), and a tab under a divider's end leaves the wall a sliver
 * between the two; two divider tabs straddling a crossing box in a square of floor that falls
 * out (a 120 × 80 box with one divider each way did exactly that).
 */
function planAround(c: Ctx, lo: number, hi: number, crossings: number[], flexy = false): [number, number][] {
  if (!crossings.length) return plan(c, lo, hi, flexy);
  const t = c.t;
  const cuts = [...crossings].sort((a, b) => a - b);
  const edges = [lo, ...cuts.flatMap((x) => [x - t / 2 - t, x + t / 2 + t]), hi];
  const out: [number, number][] = [];
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k]!;
    const b = edges[k + 1]!;
    if (b - a > fingerMin(t)) out.push(...plan(c, a, b, flexy));
  }
  return out;
}

/**
 * A joint between slabs `a` and `b` along `axis`, `b` keeping the tabs. Flex tabs go only where a
 * tab goes INTO A SLOT — a raised floor, a shelf, a divider, a drawer's sides through its front —
 * never on a corner, where two walls meet at an angle (Ian, 2026-10-03): the corners are plain
 * fingers in every box.
 */
function joint(c: Ctx, a: string, b: string, axis: 0 | 1 | 2, lo: number, hi: number, kind: JointKind = 'finger', crossings: number[] = []): Joint {
  const flexy = c.spec.flex && kind === 'slot';
  const intervals = planAround(c, lo, hi, crossings, flexy);
  if (!intervals.length && hi - lo > 0.5) c.warnings.push('An edge is too short for a finger — make the box bigger, or glue that edge.');
  return { a, b, axis, range: [lo, hi], intervals, kind, fit: c.spec.fit, ...(flexy ? { flex: FLEX_BONUS } : {}) };
}

/**
 * A corner's tabs kept off the BANDS where a third piece crosses the corner — a raised floor, a
 * case's shelves. That stretch of the corner is three pieces deep and goes to its owner by rank,
 * so a tab running through it came out notched, and a flex tab's slit could land in the notch
 * (a two-drawer case on feet did). The tab is cut back to either side of the band; a stub
 * narrower than a finger is dropped.
 */
function clearOf(c: Ctx, j: Joint, bands: [number, number][]): Joint {
  const min = fingerMin(c.t);
  let intervals = j.intervals;
  for (const [a, b] of bands) {
    intervals = intervals.flatMap(([s, e]): [number, number][] =>
      b <= s || a >= e ? [[s, e]] : ([[s, Math.min(e, a)], [Math.max(s, b), e]] as [number, number][]).filter(([p, q]) => q - p >= min),
    );
  }
  return { ...j, intervals };
}

// ---------------------------------------------------------------------------- the body --

/** How far a floor sits above the table: flush, on a skirt one sheet tall, or on feet. */
export function floorRise(bottom: BoxSpec['bottom'], t: number): number {
  return bottom === 'flush' ? 0 : bottom === 'slots' ? Math.max(t, 3) : Math.max(2.5 * t, 8);
}

interface BodyOpts {
  /** Where the body's outside corner sits. */
  at: V3;
  L: number;
  W: number;
  /** Wall tops, mm above `at`. */
  front: number;
  back: number;
  sides: number;
  bottom: BoxSpec['bottom'];
  /** Ids: '' for the box itself, 'd-' for a drawer. */
  prefix: string;
  /** Dividers inside, and how high they stand (mm above `at`). */
  dividers?: { nx: number; ny: number; top: number };
  /** How far down from the top the side walls keep their back corners whole, mm: a hinged lid's
   *  knuckles sit there (`hingeBox`). 0 — the usual — and the back keeps its corner's ends. */
  ears?: number;
}

interface Body {
  slabs: Slab[];
  joints: Joint[];
  /** The floor's top, mm above `at`. */
  floorTop: number;
  cutAway: Map<string, Ring[]>;
}

/**
 * Four walls and a floor, `L × W` outside, the walls' tops where `o` says. Joints:
 *
 *   flush   the floor is the bottom face, finger-jointed to all four walls;
 *   slots   the floor sits one sheet up, its tabs through slots in the walls, the walls running
 *           down past it as a skirt — every slot keeps a sheet of wood under it;
 *   feet    the floor sits max(2.5 t, 8) up and the skirt is cut away between feet: one at each
 *           corner, and another wherever a span would pass 140 mm.
 *
 * The corner fingers run the walls' whole height, from the table to the lower of the two tops —
 * a raised floor's skirt included, so every corner speaks the same rhythm top to bottom. The floor's own band at a corner is
 * three pieces deep and goes to the corner's owner by rank, as it always did.
 */
function body(c: Ctx, o: BodyOpts): Body {
  const t = c.t;
  const [x0, y0, z0] = o.at;
  const { L, W, prefix: p } = o;
  const f = floorRise(o.bottom, t);
  const slabs: Slab[] = [
    slab(`${p}front`, 'front', [x0, y0, z0], [x0 + L, y0 + t, z0 + o.front], 3),
    slab(`${p}back`, 'back', [x0, y0 + W - t, z0], [x0 + L, y0 + W, z0 + o.back], 3),
    slab(`${p}left`, 'left', [x0, y0, z0], [x0 + t, y0 + W, z0 + o.sides], 2),
    slab(`${p}right`, 'right', [x0 + L - t, y0, z0], [x0 + L, y0 + W, z0 + o.sides], 2),
    slab(`${p}bottom`, 'bottom', [x0, y0, z0 + f], [x0 + L, y0 + W, z0 + f + t], 1),
  ];
  const kind: JointKind = o.bottom === 'flush' ? 'finger' : 'slot';
  const lines = dividerLines(c, o, f);
  // The floor's tabs into each wall keep clear of the dividers ending at that wall; the corners'
  // tabs keep clear of the floor's band.
  const floorBand: [number, number][] = [[z0 + f, z0 + f + t]];
  const corner = (a: string, b: string, top: number, ear = 0): Joint => {
    const j = clearOf(c, joint(c, `${p}${a}`, `${p}${b}`, 2, z0, z0 + top - ear), floorBand);
    if (ear <= 0) return j;
    // The side keeps the top `ear` of this corner whole, through the back's thickness: one solid
    // tab round the knuckle's pin hole. Without it the back kept the corner's end and cut the
    // side back to its inner face — 0.05 mm from the hole in 3 mm ply (Ian, 2026-10-03: "too
    // thin and will break, the finger slots messing it up"). The tab runs past the top so no
    // sliver of the back is left over it; a tab that owns its corner gets no slits (flexTabs).
    return { ...j, range: [z0, z0 + top], intervals: [...j.intervals, [z0 + top - ear, z0 + top + 1]] };
  };
  const joints: Joint[] = [
    corner('front', 'left', Math.min(o.front, o.sides)),
    corner('front', 'right', Math.min(o.front, o.sides)),
    corner('back', 'left', Math.min(o.back, o.sides), o.ears),
    corner('back', 'right', Math.min(o.back, o.sides), o.ears),
    joint(c, `${p}front`, `${p}bottom`, 0, x0 + t, x0 + L - t, kind, lines?.xcs),
    joint(c, `${p}back`, `${p}bottom`, 0, x0 + t, x0 + L - t, kind, lines?.xcs),
    joint(c, `${p}left`, `${p}bottom`, 1, y0 + t, y0 + W - t, kind, lines?.ycs),
    joint(c, `${p}right`, `${p}bottom`, 1, y0 + t, y0 + W - t, kind, lines?.ycs),
  ];
  if (lines) {
    const d = dividerSlabs(c, o, f, lines);
    slabs.push(...d.slabs);
    joints.push(...d.joints);
  }
  const cutAway = new Map<string, Ring[]>();
  if (o.bottom === 'feet') {
    for (const id of ['front', 'back', 'left', 'right']) cutAway.set(`${p}${id}`, feetArches(id === 'front' || id === 'back' ? L : W, f, t));
  }
  return { slabs, joints, floorTop: f + t, cutAway };
}

/**
 * The skirt cut away between feet along a wall's bottom edge `len` long, in the wall's own frame:
 * a foot max(10, 3t) wide at each end and another wherever a span would pass 140 mm. The arches
 * stop a sheet under the floor (`f` up), so every slot keeps a full sheet of wood below it.
 */
function feetArches(len: number, f: number, t: number): Ring[] {
  const rise = f - t;
  const foot = Math.max(10, 3 * t);
  const n = footCount(len, 140);
  const centres = Array.from({ length: n }, (_, i) => foot / 2 + ((len - foot) * i) / (n - 1));
  const arches: Ring[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = centres[i]! + foot / 2;
    const b = centres[i + 1]! - foot / 2;
    if (b - a > 4) arches.push(doorwayRing(a, b, 0, rise, Math.min(rise, 6)));
  }
  return arches;
}

/** How far a divider stands under whatever closes the box, mm, so a lid shuts over it. */
const DIVIDER_HEADROOM = 1;
/** How much deeper than half each cross-halving notch is cut, mm. */
const CROSS_RELIEF = 0.25;

/** Where the dividers stand: `xcs` the centres of those across the length, `ycs` of those front
 *  to back, evenly spaced in the space inside. Null when there are none — or the box is too
 *  shallow for them, which it says. */
function dividerLines(c: Ctx, o: BodyOpts, f: number): { xcs: number[]; ycs: number[] } | null {
  if (!o.dividers || (o.dividers.nx <= 0 && o.dividers.ny <= 0)) return null;
  const t = c.t;
  if (o.dividers.top - (f + t) < 2 * t) {
    c.warnings.push('The box is too shallow for dividers — make it taller.');
    return null;
  }
  const [x0, y0] = o.at;
  const { nx, ny } = o.dividers;
  return {
    xcs: Array.from({ length: nx }, (_, i) => x0 + t + ((o.L - 2 * t) * (i + 1)) / (nx + 1)),
    ycs: Array.from({ length: ny }, (_, j) => y0 + t + ((o.W - 2 * t) * (j + 1)) / (ny + 1)),
  };
}

/**
 * Dividers: `nx` walls across the length and `ny` from front to back, evenly spaced in the
 * space inside, standing on the floor. Each is tabbed through slots in the two walls it meets
 * and in the floor (a `slot` joint each), and where two cross they halve into each other — the
 * one running front to back keeps the lower half, the other the upper, so the egg-crate drops
 * together from above. A cross-lap's notches are stops, not fits: exact, never squeezed.
 *
 * Assembly: floor, then the dividers crossed into each other and dropped onto the floor's
 * slots, then the walls slid on from the sides onto their tabs and the corner fingers at once.
 */
function dividerSlabs(c: Ctx, o: BodyOpts, f: number, lines: { xcs: number[]; ycs: number[] }): { slabs: Slab[]; joints: Joint[] } {
  const t = c.t;
  const [x0, y0, z0] = o.at;
  const { L, W, prefix: p } = o;
  const zb = z0 + f;
  const zf = z0 + f + t;
  const zt = z0 + o.dividers!.top;
  const slabs: Slab[] = [];
  const joints: Joint[] = [];
  const xs: Slab[] = [];
  const ys: Slab[] = [];
  const { xcs, ycs } = lines;
  // A divider's tabs into the floor are laid out between the dividers crossing it (planAround).
  for (const [i, xc] of xcs.entries()) {
    const d = { ...slab(`${p}div-x${i + 1}`, 'right', [xc - t / 2, y0, zb], [xc + t / 2, y0 + W, zt], 0), insert: true };
    xs.push(d);
    joints.push(joint(c, `${p}front`, d.id, 2, zf, zt, 'slot'), joint(c, `${p}back`, d.id, 2, zf, zt, 'slot'), joint(c, `${p}bottom`, d.id, 1, y0 + t, y0 + W - t, 'slot', ycs));
  }
  for (const [j, yc] of ycs.entries()) {
    const d = { ...slab(`${p}div-y${j + 1}`, 'front', [x0, yc - t / 2, zb], [x0 + L, yc + t / 2, zt], 0), insert: true };
    ys.push(d);
    joints.push(joint(c, `${p}left`, d.id, 2, zf, zt, 'slot'), joint(c, `${p}right`, d.id, 2, zf, zt, 'slot'), joint(c, `${p}bottom`, d.id, 0, x0 + t, x0 + L - t, 'slot', xcs));
  }
  // Each half-notch is cut CROSS_RELIEF deeper than half: a laser leaves the notch's bottom
  // rounded and charred, and a notch cut exactly to depth seats the crate proud (joints.md §3.2,
  // 0.2–0.5 mm). A negative fit along the joint is that gap, a quarter of it each side.
  const mid = (zf + zt) / 2;
  for (const a of xs) for (const b of ys) joints.push({ a: a.id, b: b.id, axis: 2, range: [zf, zt], intervals: [[zf, mid]], kind: 'finger', fit: -4 * CROSS_RELIEF });
  slabs.push(...xs, ...ys);
  return { slabs, joints };
}

const BOX_LABELS = { front: 'Front', back: 'Back', left: 'Left side', right: 'Right side', bottom: 'Bottom' };

/** The spec's dividers, standing `top` mm high. */
const divs = (c: Ctx, top: number) => ({ nx: c.spec.dividersX, ny: c.spec.dividersY, top });

// ---------------------------------------------------------------------------- styles --

/** Open box (tray): the body and nothing else. */
function openBox(c: Ctx): BoxModel {
  const { length: L, width: W, height: H } = c.spec;
  const t = c.t;
  const b = body(c, { at: [0, 0, 0], L, W, front: H, back: H, sides: H, bottom: c.spec.bottom, prefix: '', dividers: divs(c, H - 2) });
  const model = trace(c, { slabs: b.slabs, joints: b.joints }, b.cutAway, BOX_LABELS, 'body', '');
  if (c.spec.fingerHole) {
    // A finger scoop in each of the two shorter walls' top edges, where a tray is picked up by
    // its ends — clear of any divider ending there.
    const ends = W <= L;
    const len = ends ? W : L;
    const r = Math.min(15, len / 5, (H - b.floorTop) / 2.5);
    const along = notchAt(len, r, t, dividerCentres(c, len, ends ? c.spec.dividersY : c.spec.dividersX));
    for (const id of ends ? (['left', 'right'] as const) : (['front', 'back'] as const)) {
      const piece = model.pieces.find((p) => p.id === id)!;
      // Each wall's u runs its own way (left: back → front, back: right → left).
      const u = id === 'left' || id === 'back' ? len - along : along;
      piece.cutAway.push(edgeNotchRing(u, H, r, true));
      piece.keepOut.push(circleRing(u, H, r + 1, 24));
    }
  }
  const outside = { x: L, y: W, z: H };
  return { ...model, outside, overall: outside, inside: { x: L - 2 * t, y: W - 2 * t, z: H - b.floorTop } };
}

/** How much smaller than the opening a lift-off lid's lip is drawn, a side, mm. A slide fit at
 *  every Fit stop — 0.50 at Looser down to 0.25 at Tighter — never a press: it comes off by hand
 *  every day. It follows Fit the same way every
 *  joint does, so Tighter is snugger here too. */
export const lipPlay = (fit: number): number => Math.max(0.25, Math.min(0.5, 0.5 - 0.7143 * (fit + 0.15)));

/**
 * Where a thumb notch goes along a wall `L` long: its middle, unless a divider stands there — a
 * notch over a divider would cut the wall away round the divider's slot. Then the middle of the
 * compartment nearest the middle. `xs` are the dividers' centres along the wall, from its start.
 */
function notchAt(L: number, r: number, t: number, xs: number[]): number {
  const clear = (x: number) => xs.every((d) => Math.abs(d - x) > r + t);
  if (clear(L / 2)) return L / 2;
  const edges = [t, ...xs, L - t].sort((a, b) => a - b);
  let best = L / 2;
  for (let i = 0; i + 1 < edges.length; i++) {
    const m = (edges[i]! + edges[i + 1]!) / 2;
    if (clear(m) && (best === L / 2 || Math.abs(m - L / 2) < Math.abs(best - L / 2))) best = m;
  }
  return best;
}

/** The thumb notch's radius in a wall `top` mm tall on an edge `L` long. */
const notchRadius = (L: number, top: number) => Math.min(12, L / 7, top / 3);

/**
 * Lift-off lid: the body one sheet short of `H`, and a lid as big as the box with a LIP glued
 * under it — a frame that drops inside the walls with `lipPlay(fit)` all round, so the lid sits on
 * the walls and cannot slide off. The lip's outer corners are rounded so it finds the opening
 * blind. The lip is a frame, not a plate, so a pattern cut through the lid shows through — and a
 * pattern on the lid is kept inside the frame's window, off the ring it is glued by. A thumb notch
 * in the front wall's top edge lets a finger under the lid's edge: a flush lid has nothing else to
 * catch.
 */
function lidBox(c: Ctx): BoxModel {
  const { length: L, width: W, height: H } = c.spec;
  const t = c.t;
  const b = body(c, { at: [0, 0, 0], L, W, front: H - t, back: H - t, sides: H - t, bottom: c.spec.bottom, prefix: '', dividers: divs(c, H - 2 * t - DIVIDER_HEADROOM) });
  const model = trace(c, { slabs: b.slabs, joints: b.joints }, b.cutAway, BOX_LABELS, 'body', '');
  const lift: Motion = { kind: 'lift', distance: Math.max(25, H * 0.6) };
  const play = lipPlay(c.spec.fit);
  const lw = Math.max(6, 2.5 * t);
  const ix = L - 2 * t - 2 * play;
  const iy = W - 2 * t - 2 * play;
  const lid = drawn('lid', 'Lid', 'lid', 'lid', [0, 0, H - t / 2], rectRing(0, 0, L, W), t, 'lid');
  lid.motion = lift;
  // The pattern's room is the lip's window: the ring under it is what holds the lid on.
  lid.safe = { u0: t + play + lw, v0: t + play + lw, u1: L - t - play - lw, v1: W - t - play - lw };
  const lip = drawn('lip', 'Lid lip', null, 'lid', [t + play, t + play, H - 1.5 * t], roundedRectRing(ix, iy, Math.max(1, Math.min(2, t / 2)), 8, [ix / 2, iy / 2]), t, 'insert');
  lip.cutAway.push(roundedRectRing(ix - 2 * lw, iy - 2 * lw, 2, 8, [ix / 2, iy / 2]));
  lip.safe = null;
  lip.motion = lift;
  if (c.spec.fingerHole) {
    const front = model.pieces.find((p) => p.id === 'front')!;
    const r = notchRadius(L, H - t);
    const x = notchAt(L, r, t, dividerCentres(c, L, c.spec.dividersX));
    front.cutAway.push(edgeNotchRing(x, H - t, r, true));
    front.keepOut.push(circleRing(x, H - t, r + 1, 24));
  }
  model.pieces.push(lid, lip);
  const outside = { x: L, y: W, z: H };
  return { ...model, outside, overall: outside, inside: { x: L - 2 * t, y: W - 2 * t, z: H - t - b.floorTop } };
}

/** The centres of `n` dividers across a body `L` long, from its outside face (as `dividerLines`). */
function dividerCentres(c: Ctx, L: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => c.t + ((L - 2 * c.t) * (i + 1)) / (n + 1));
}

/** Clearances on a hinged lid, mm: between the lid and each side wall, between its front edge
 *  and the front wall, and the margin the swing gets on top of its own reach (below). */
const LID_SIDE_PLAY = 0.3;
const LID_FRONT_PLAY = 0.3;
const SWING_PLAY = 0.3;
/** How much bigger than the pin's diagonal its round is, mm. */
const PIN_PLAY = 0.5;
/** The latch's grip on top of the Fit stop, mm across the tab: Standard closes it with a light
 *  press and it stays shut tipped over; Looser lets it drop in free. */
export const LATCH_BONUS = 0.05;

/** The interference across the latch tab for a fit, mm — never a press fit (it is opened every
 *  day), never so loose it rattles. */
export const latchGrip = (fit: number): number => Math.max(-0.1, Math.min(0.2, fit + LATCH_BONUS));

/**
 * Hinged lid — the flip-top people buy most of. Rebuilt on 2026-10-02: the first version had
 * nothing holding it shut.
 *
 * THE HINGE (kept: the reference tools all build it this way). The lid sits between the side
 * walls, flush with every wall's top. At its back corners two square pins — the lid's own sheet,
 * `w` wide, running out through the side walls to their outer faces — turn in round holes,
 * Ø = √(t² + w²) + PIN_PLAY. The pin's centre is the lid's mid-thickness, half a sheet under the
 * walls' top, too close for that hole: each side wall carries a round KNUCKLE over its pin, `rim`
 * of wood outside the hole, standing `rise` above the top line (3.3 mm in 3 mm ply). `H` is the
 * walls' height — the knuckles stand proud of it, like a hinge's barrels.
 *
 *   · the back wall rises to the lid's top. Turning, the lid's back edge sweeps a circle of
 *     radius ρ = √((w/2)² + (t/2)²) about the pin: the back wall stands ρ − w/2 + SWING_PLAY
 *     behind the lid, and a divider ρ − t/2 + SWING_PLAY under it (tests/run.mjs's sweep found a
 *     fixed gap hit at 4 mm). Opened, the lid's top face comes to rest on the back wall's top
 *     edge, about 116° open: it stays open on its own.
 *
 * THE LATCH. The front wall stands full height
 * with a RECESS in the middle of its top edge, a sheet deep; the lid stops a hair behind the front
 * wall and a rounded PULL TAB on its front edge reaches through the recess and `out` past the
 * front face. Closed, the tab rests on the recess floor (the lid's front stop), its sides pressed
 * by `latchGrip(fit)` against the recess's (the catch: it stays shut tipped over), and the overhang
 * is the pull. One feature, three jobs, nothing but the cut sheet.
 *
 * Nothing glues. Assembly: the bottom, front and back; one side wall; the lid's pin into that
 * wall's round; the other side wall slid on over the other pin; close the lid onto its tab.
 */
function hingeBox(c: Ctx): BoxModel {
  const { length: L, width: W, height: H } = c.spec;
  const t = c.t;
  const w = Math.max(t, 3);
  const rho = Math.hypot(w / 2, t / 2);
  const backPlay = rho - w / 2 + SWING_PLAY;
  const dip = rho - t / 2 + SWING_PLAY;
  const hole = Math.hypot(t, w) + PIN_PLAY;
  const rim = Math.max(2, 0.8 * t);
  const earR = hole / 2 + rim;
  const rise = earR - t / 2;
  // The side walls keep their back corners whole down past the knuckle (`ears`): the pin's hole
  // comes to within a hair of the back wall's inner face (the lid's back edge stands only
  // backPlay in front of it), too close for the back to keep that corner.
  const b = body(c, { at: [0, 0, 0], L, W, front: H, back: H, sides: H, bottom: c.spec.bottom, prefix: '', dividers: divs(c, H - t - Math.max(DIVIDER_HEADROOM, dip)), ears: t / 2 + earR });
  const model = trace(c, { slabs: b.slabs, joints: b.joints }, b.cutAway, BOX_LABELS, 'body', '');
  const back = W - t - backPlay;
  const front0 = t + LID_FRONT_PLAY;
  const yp = back - w / 2;
  const zp = H - t / 2;
  const body0 = t + LID_SIDE_PLAY;
  // The latch tab: a third of the box's length, 20–40 mm, never more
  // than three-fifths of the lid; `out` past the front face for a fingernail.
  const tabW = Math.min(Math.max(20, Math.min(40, 0.33 * L)), 0.6 * (L - 2 * body0));
  const out = Math.max(1.2, Math.min(2.5, 0.5 * t));
  const grip = latchGrip(c.spec.fit);
  const cx = L / 2;
  const half = (tabW + grip) / 2;
  const tipR = Math.min(1.5, out);
  const tipArc = (x0: number, y0: number, a0: number): Pt[] =>
    Array.from({ length: 7 }, (_, i) => {
      const a = a0 + (i / 6) * (Math.PI / 2);
      return [x0 + tipR * Math.cos(a), y0 + tipR * Math.sin(a)] as Pt;
    });
  const lidRing: Ring = [
    [body0, front0],
    [cx - half, front0],
    [cx - half, -out + tipR],
    ...tipArc(cx - half + tipR, -out + tipR, Math.PI),
    ...tipArc(cx + half - tipR, -out + tipR, -Math.PI / 2),
    [cx + half, front0],
    [L - body0, front0],
    [L - body0, back - w],
    [L, back - w],
    [L, back],
    [0, back],
    [0, back - w],
    [body0, back - w],
  ];
  const lid = drawn('lid', 'Lid', 'lid', 'lid', [0, 0, zp], lidRing, t, 'lid');
  lid.safe = { u0: body0, v0: front0, u1: L - body0, v1: back - w };
  lid.motion = { kind: 'hinge', at: [0, yp, zp], axis: [-1, 0, 0], degrees: 105 };
  // The side walls: a round for each pin and a knuckle over it. In a side wall's frame u runs
  // along the box's depth (left: back → front; right: front → back) and v is height.
  for (const id of ['left', 'right'] as const) {
    const piece = model.pieces.find((p) => p.id === id)!;
    const u = id === 'left' ? W - yp : yp;
    piece.cutAway.push(circleRing(u, zp, hole / 2, 40));
    piece.addOn.push(earCap(u, zp, earR, H));
    piece.keepOut.push(circleRing(u, zp, earR, 24));
  }
  // The front wall: the recess the tab sits in, its mouth rounded so the tab finds it.
  const front = model.pieces.find((p) => p.id === 'front')!;
  front.cutAway.push(recessRing(cx, H, tabW, t, Math.min(1, t / 3)));
  front.keepOut.push(rectRing(cx - tabW / 2 - 2, H - t - 2, cx + tabW / 2 + 2, H + 1));
  model.pieces.push(lid);
  return {
    ...model,
    outside: { x: L, y: W, z: H },
    overall: { x: L, y: W + out, z: H + rise },
    inside: { x: L - 2 * t, y: W - 2 * t, z: H - t - b.floorTop },
  };
}

/** A notch `w` wide and `depth` deep in an edge running along u at v = `top`, centred on `cx`,
 *  its two mouth corners rounded by `r` — the recess a hinged lid's pull tab drops into. */
function recessRing(cx: number, top: number, w: number, depth: number, r: number): Ring {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const arc = (ox: number, from: number, to: number): Pt[] =>
    Array.from({ length: 7 }, (_, i) => {
      const a = from + ((to - from) * i) / 6;
      return [ox + r * Math.cos(a), top - r + r * Math.sin(a)] as Pt;
    });
  return [
    [x0 - r, top + 1],
    ...arc(x0 - r, Math.PI / 2, 0),
    [x0, top - depth],
    [x1, top - depth],
    ...arc(x1 + r, Math.PI, Math.PI / 2),
    [x1 + r, top + 1],
  ];
}

/** The part of a circle (centre (cx, cy), radius r) above the line y = `base`, closed along it.
 *  Not dipped under the line to weld: behind the side wall's own wood the cap overhangs the back
 *  wall's top corner, and a dip there was the back wall's wood (tests/run.mjs caught 3.3 mm³).
 *  The union welds an edge the two share. */
function earCap(cx: number, cy: number, r: number, base: number, seg = 32): Ring {
  const dy = base - cy;
  const half = Math.sqrt(Math.max(0, r * r - dy * dy));
  const a0 = Math.atan2(dy, half);
  const a1 = Math.PI - a0;
  const out: Ring = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Clearances round a drawer in its bay, mm, growing with the sheet (thicker
 *  stock varies more): each side, over its top, and behind it. */
const drawerSide = (t: number) => Math.max(0.4, 0.15 * t);
const drawerTop = (t: number) => Math.max(1.5, 0.5 * t);
const drawerBack = (t: number) => Math.max(1, 0.3 * t);
/** Gaps round the drawer fronts, mm: at the box's edges, and between two fronts. */
const FRONT_EDGE = 0.5;
const FRONT_GAP = 1;

/**
 * Drawer box — one to three drawers in a case (a chest of drawers: the second-best seller after
 * the hinged lid). Rebuilt 2026-10-02.
 *
 * THE CASE is the body turned on its back: the BACK leads (it keeps every corner), the sides keep
 * their runs along the floor, the shelves and the top, and along the open front edge the sides
 * keep the ends. It stands a sheet back from the front, behind the drawers' fronts. Its floor is
 * the Bottom setting, as on every box — flush, raised on a skirt, or on feet (the case's sides
 * and back carry them). N − 1 SHELVES split it into N equal BAYS.
 *
 * EACH DRAWER is a small open box sliding in its bay on the bay's floor, `drawerSide(t)` clear of
 * each side, `drawerTop(t)` under the bay's ceiling, `drawerBack(t)` short of the back. Its FRONT
 * is an overlay plate: wider and taller than the bay, it covers the case's raw front edges (the
 * fronts tile the whole front of the box with a 1 mm gap between them), so a little drift in the
 * cut never shows as an uneven gap, and pushed home its back face against the case's front edges
 * is the drawer's inward stop. The drawer's sides and bottom tab THROUGH the plate — no glue,
 * the same tab-through-slot look as a raised floor. The plate carries the finger notch.
 *
 * No outward stop, on purpose: a stop a drawer cannot get past is a drawer that never comes out
 * for cleaning (a captive fin would add one if it is ever wanted).
 */
function drawerBox(c: Ctx): BoxModel {
  const { length: L, width: W, height: H } = c.spec;
  const t = c.t;
  const f = floorRise(c.spec.bottom, t);
  // As many drawers as asked for, while each bay still holds a drawer with room inside it.
  const bay = (n: number) => (H - f - (n + 1) * t) / n;
  const asked = Math.max(1, Math.min(3, Math.round(c.spec.drawers)));
  let N = asked;
  while (N > 1 && bay(N) < 3 * t + 8) N--;
  if (N < asked) c.warnings.push(`Only ${N} drawer${N === 1 ? '' : 's'} fit${N === 1 ? 's' : ''} this height — make the box taller for ${asked}.`);
  const S = (id: string, face: FaceId, min: V3, max: V3, rank: number): Slab => slab(id, face, min, max, rank);
  // ---- the case, behind the fronts (y from t to W)
  const y0 = t;
  const hb = Math.max(bay(N), 2 * t + drawerTop(t) + 1);
  const shelfZ = Array.from({ length: N - 1 }, (_, k) => f + t + (k + 1) * hb + k * t);
  const slabs: Slab[] = [
    S('back', 'back', [0, W - t, 0], [L, W, H], 3),
    S('left', 'left', [0, y0, 0], [t, W, H], 2),
    S('right', 'right', [L - t, y0, 0], [L, W, H], 2),
    S('bottom', 'bottom', [0, y0, f], [L, W, f + t], 1),
    ...shelfZ.map((z, k) => S(`shelf${k + 1}`, 'bottom', [0, y0, z], [L, W, z + t], 1)),
    S('top', 'lid', [0, y0, H - t], [L, W, H], 1),
  ];
  const kind: JointKind = c.spec.bottom === 'flush' ? 'finger' : 'slot';
  const across = ['bottom', ...shelfZ.map((_, k) => `shelf${k + 1}`), 'top'];
  // The top sits on the walls' top edges (fingers); a shelf passes through holes in them (slots),
  // and so does a raised floor.
  const kindOf = (id: string): JointKind => (id === 'top' ? 'finger' : id === 'bottom' ? kind : 'slot');
  // The back's corners are crossed by the floor, every shelf and the top.
  const bands: [number, number][] = [[f, f + t], ...shelfZ.map((z): [number, number] => [z, z + t]), [H - t, H]];
  const joints: Joint[] = [
    clearOf(c, joint(c, 'back', 'left', 2, 0, H), bands),
    clearOf(c, joint(c, 'back', 'right', 2, 0, H), bands),
    ...across.flatMap((id) => [
      joint(c, 'back', id, 0, t, L - t, kindOf(id)),
      joint(c, 'left', id, 1, y0, W - t, kindOf(id)),
      joint(c, 'right', id, 1, y0, W - t, kindOf(id)),
    ]),
  ];
  const caseCut = new Map<string, Ring[]>();
  if (c.spec.bottom === 'feet') {
    caseCut.set('back', feetArches(L, f, t));
    caseCut.set('left', feetArches(W - y0, f, t));
    caseCut.set('right', feetArches(W - y0, f, t));
  }
  const CASE_LABELS: Record<string, string> = { back: 'Back', left: 'Left side', right: 'Right side', bottom: 'Bottom', top: 'Top', ...Object.fromEntries(shelfZ.map((_, k) => [`shelf${k + 1}`, N > 2 ? `Shelf ${k + 1}` : 'Shelf'])) };
  const outer = trace(c, { slabs, joints }, caseCut, CASE_LABELS, 'body', '');
  // The shelves are inside: no pattern on them.
  for (const p of outer.pieces) if (p.id.startsWith('shelf')) { p.face = null; p.safe = null; }

  // ---- the drawers
  const side = drawerSide(t);
  const dL = L - 2 * t - 2 * side;
  const dW = W - 2 * t - drawerBack(t);
  const dH = hb - drawerTop(t);
  const x0 = t + side;
  const pieces = [...outer.pieces];
  const world: SlabWorld = { slabs: [...slabs], joints: [...joints] };
  let inside = { x: dL - 2 * t, y: dW - t, z: dH - t };
  for (let k = 0; k < N; k++) {
    const p = `d${k + 1}-`;
    const z0 = f + t + k * (hb + t);
    // The fronts tile the box's front in equal heights, FRONT_GAP between two and FRONT_EDGE in
    // from its edges: from the table, or — on a skirt or feet — from the floor's underside, so
    // the plinth shows at the front as it does round the sides. Equal fronts put each boundary
    // within a sixth of a sheet of its shelf's middle: every gap shows a shelf's edge, not a bay.
    const base = c.spec.bottom === 'flush' ? 0 : f;
    const pitch = (H - base) / N;
    const lo = base + k * pitch + (k === 0 ? FRONT_EDGE : FRONT_GAP / 2);
    const hi = base + (k + 1) * pitch - (k === N - 1 ? FRONT_EDGE : FRONT_GAP / 2);
    const ds: Slab[] = [
      slab(`${p}front`, 'front', [FRONT_EDGE, 0, lo], [L - FRONT_EDGE, t, hi], 3),
      slab(`${p}back`, 'back', [x0, t + dW - t, z0], [x0 + dL, t + dW, z0 + dH], 3),
      slab(`${p}left`, 'left', [x0, 0, z0], [x0 + t, t + dW, z0 + dH], 2),
      slab(`${p}right`, 'right', [x0 + dL - t, 0, z0], [x0 + dL, t + dW, z0 + dH], 2),
      slab(`${p}bottom`, 'bottom', [x0, 0, z0], [x0 + dL, t + dW, z0 + t], 1),
    ];
    // The sides and the bottom tab through the front plate; the back is jointed as a body's.
    const dj: Joint[] = [
      joint(c, `${p}front`, `${p}left`, 2, z0 + t, z0 + dH, 'slot'),
      joint(c, `${p}front`, `${p}right`, 2, z0 + t, z0 + dH, 'slot'),
      joint(c, `${p}front`, `${p}bottom`, 0, x0 + t, x0 + dL - t, 'slot'),
      joint(c, `${p}back`, `${p}left`, 2, z0, z0 + dH),
      joint(c, `${p}back`, `${p}right`, 2, z0, z0 + dH),
      joint(c, `${p}back`, `${p}bottom`, 0, x0 + t, x0 + dL - t),
      joint(c, `${p}left`, `${p}bottom`, 1, t, t + dW - t),
      joint(c, `${p}right`, `${p}bottom`, 1, t, t + dW - t),
    ];
    const opts: BodyOpts = { at: [x0, 0, z0], L: dL, W: t + dW, front: dH, back: dH, sides: dH, bottom: 'flush', prefix: p, dividers: divs(c, dH - DIVIDER_HEADROOM) };
    const lines = dividerLines(c, opts, 0);
    if (lines) {
      const d = dividerSlabs(c, opts, 0, lines);
      ds.push(...d.slabs);
      dj.push(...d.joints);
    }
    const name = N > 1 ? `Drawer ${k + 1}` : 'Drawer';
    const labels = { front: `${name} front`, back: `${name} back`, left: `${name} left`, right: `${name} right`, bottom: `${name} bottom` };
    const inner = trace(c, { slabs: ds, joints: dj }, new Map(), labels, 'drawer', p);
    const slide: Motion = { kind: 'slide', dir: [0, -1, 0], distance: dW * 0.6 };
    for (const piece of inner.pieces) {
      piece.motion = slide;
      // The drawer's front is the face a pattern on "front" means; its other walls are hidden.
      piece.face = piece.id === `${p}front` ? 'front' : null;
    }
    if (c.spec.fingerHole) {
      const front = inner.pieces.find((q) => q.id === `${p}front`)!;
      const w = L - 2 * FRONT_EDGE;
      const r = Math.min(16, w / 6, (hi - lo) / 3);
      // In the front's frame u runs from its own left edge; the dividers' centres, likewise.
      const u = notchAt(w, r, t, (lines?.xcs ?? []).map((x) => x - FRONT_EDGE));
      front.cutAway.push(edgeNotchRing(u, hi - lo, r, true));
      front.keepOut.push(circleRing(u, hi - lo, r + 1, 24));
    }
    pieces.push(...inner.pieces);
    world.slabs.push(...ds);
    world.joints.push(...dj);
    inside = { x: dL - 2 * t, y: dW - t, z: dH - t };
  }
  return {
    pieces,
    world,
    outside: { x: L, y: W, z: H },
    overall: { x: L, y: W, z: H },
    inside,
    warnings: c.warnings,
  };
}

// ---------------------------------------------------------------------------- pieces --

/** A piece no joint touches, drawn directly: its ring in its own frame, its frame's origin. */
function drawn(id: string, label: string, face: FaceId | null, frame: FaceId, origin: V3, outer: Ring, t: number, role: PieceDraft['role']): PieceDraft {
  const f = FRAMES[frame];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    id, label, face, outline: [[outer]], addOn: [], cutAway: [], slits: [],
    safe: { u0: minX, v0: minY, u1: maxX, v1: maxY }, keepOut: [], origin, u: f.u, v: f.v, thickness: t, role,
  };
}

/** Trace every slab of `world` into a piece. */
function trace(c: Ctx, world: SlabWorld, cutAway: Map<string, Ring[]>, labels: Record<string, string>, role: PieceDraft['role'], prefix: string): Pick<BoxModel, 'pieces' | 'world' | 'warnings'> {
  const inserts = world.slabs.filter((s) => s.insert);
  const pieces: PieceDraft[] = world.slabs.map((s) => {
    const thickness = s.box.max[s.normal] - s.box.min[s.normal];
    const tabs = flexTabs(world, s);
    const islands = roundCorners(outlineOf(world, s), tabs.corners, tipRadius(thickness));
    const name = s.id.slice(prefix.length);
    const label = s.insert ? `${prefix ? 'Drawer divider' : 'Divider'} ${name.startsWith('div-x') ? 'across' : 'front to back'} ${name.slice(5)}` : labels[name] ?? s.id;
    if (islands.length !== 1) c.warnings.push(`${label} came out in ${islands.length} pieces.`);
    const face: FaceId | null = s.insert ? null : name === 'top' ? 'lid' : name in FRAMES ? (name as FaceId) : null;
    // A pattern keeps off every divider's slots on this piece.
    const keepOut: Ring[] = [];
    for (const d of inserts) {
      if (d === s) continue;
      const r = footprintOn(s, d);
      if (r) keepOut.push(rectRing(r.u0, r.v0, r.u1, r.v1));
    }
    return {
      id: s.id,
      label,
      face,
      outline: islands,
      addOn: [],
      cutAway: cutAway.get(s.id) ?? [],
      slits: tabs.slits,
      safe: s.insert ? null : clearRect(world, s),
      keepOut,
      origin: originOf(s),
      u: s.u,
      v: s.v,
      thickness,
      role: s.insert ? 'insert' : role,
    };
  });
  return { pieces, world, warnings: c.warnings };
}

/**
 * Flex tabs: each of `s`'s tabs on a joint that asks for
 * them gets two slits, from its tip back to its root (the inner face of the piece it goes
 * into), each an ARM's width in from a side. Pressed into its notch, the arms either side give
 * into the slits, so a tab drawn a little too big still goes home by hand instead of splitting
 * the wood — the slits are where the interference goes.
 *
 * The arm is a sheet wide, or a quarter of the tab when the tab is narrower than four sheets;
 * under half a sheet it would snap across the grain, so a tab that narrow (a short edge's)
 * stays solid. The slits stop at the root, so nothing shows inside the box. The tab's two tip
 * corners come back too, to be rounded: a lead-in, and room for the round the beam leaves in
 * the notch's inner corners.
 */
function flexTabs(world: SlabWorld, s: Slab): { slits: Pt[][]; corners: Pt[] } {
  const slits: Pt[][] = [];
  const corners: Pt[] = [];
  const ua = axisOf(s.u);
  const va = axisOf(s.v);
  const t = s.box.max[s.normal] - s.box.min[s.normal];
  const mid = (s.box.min[s.normal] + s.box.max[s.normal]) / 2;
  for (const j of world.joints) {
    if (!j.flex || j.b !== s.id) continue;
    const a = world.slabs.find((x) => x.id === j.a);
    if (!a) continue;
    const across = (j.axis === ua ? va : ua) as Axis;
    // Which end of `s` the tab is at, along `across`: its tip is s's own edge there, its root
    // the far face of the piece it goes into.
    const atLow = Math.abs(a.box.min[across] - s.box.min[across]) < Math.abs(a.box.max[across] - s.box.max[across]);
    const tip = atLow ? s.box.min[across] : s.box.max[across];
    const root = atLow ? a.box.max[across] : a.box.min[across];
    const at = (x: number, y: number): Pt => {
      const p: V3 = [0, 0, 0];
      p[j.axis] = x;
      p[across] = y;
      p[s.normal] = mid;
      return localOf(s, p);
    };
    const d = along(j);
    for (const [i0, i1] of j.intervals) {
      // A tab running off the end of its edge owns that corner (a hinge's knuckle block): it has
      // no tip on that side to give, so it stays solid and square.
      if (i0 <= j.range[0] || i1 >= j.range[1]) continue;
      const lo = i0 - d;
      const hi = i1 + d;
      corners.push(at(lo, tip), at(hi, tip));
      const arm = Math.min(t, (hi - lo) / 4);
      if (arm < Math.max(1, t / 2)) continue;
      for (const x of [lo + arm, hi - arm]) slits.push([at(x, tip), at(x, root)]);
    }
  }
  return { slits, corners };
}

/** How round a flex tab's tip corners are, mm: about 0.65 in 3 mm ply. */
const tipRadius = (t: number): number => Math.max(0.4, Math.min(1.2, 0.22 * t));

/** Round the outline's convex corners that sit at `corners` (a flex tab's tip), radius `r`. */
function roundCorners(islands: Ring[][], corners: Pt[], r: number): Ring[][] {
  if (!corners.length) return islands;
  const at = (p: Pt) => corners.some((c) => Math.abs(c[0] - p[0]) < 1e-6 && Math.abs(c[1] - p[1]) < 1e-6);
  return islands.map((island) =>
    island.map((ring, k) => {
      // Only the outline: a hole's corners are another piece's, never a tab's tip.
      if (k > 0) return ring;
      const out: Ring = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const a = ring[(i - 1 + ring.length) % ring.length]!;
        const b = ring[(i + 1) % ring.length]!;
        // Counter-clockwise outline: a convex corner turns left.
        const turn = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
        if (!at(p) || turn <= 0) {
          out.push(p);
          continue;
        }
        const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
        const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
        const rr = Math.min(r, la / 2.5, lb / 2.5);
        const ea: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
        const eb: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
        const c: Pt = [p[0] + (ea[0] + eb[0]) * rr, p[1] + (ea[1] + eb[1]) * rr];
        const s0 = Math.atan2(-eb[1], -eb[0]);
        let sweep = Math.atan2(-ea[1], -ea[0]) - s0;
        while (sweep <= -Math.PI) sweep += 2 * Math.PI;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        const n = 6;
        for (let q = 0; q <= n; q++) {
          const th = s0 + (sweep * q) / n;
          out.push([c[0] + rr * Math.cos(th), c[1] + rr * Math.sin(th)]);
        }
      }
      return out;
    }),
  );
}

function localOf(s: Slab, p: V3): Pt {
  const o = originOf(s);
  return [(p[0] - o[0]) * s.u[0] + (p[1] - o[1]) * s.u[1] + (p[2] - o[2]) * s.u[2], (p[0] - o[0]) * s.v[0] + (p[1] - o[1]) * s.v[1] + (p[2] - o[2]) * s.v[2]];
}

/**
 * The box. Sized from the inside, it is built at a guess, measured, and built again with the
 * difference taken up — what lies between the inside and the outside (walls, a raised floor, a
 * lid and its lip, a hinge's ears, a drawer's case) is the construction's
 * own and nearly constant, so two corrections land within a hundredth of a millimetre.
 *
 * A chest's inside is each drawer's, and its drawers share the height: a millimetre more inside
 * every drawer is N more outside.
 */
export function buildBox(spec: BoxSpec): BoxModel {
  if (spec.measure !== 'inside') return buildOutside(spec);
  const want = { x: spec.length, y: spec.width, z: spec.height };
  const stacked = (m: BoxModel) => (spec.style === 'drawer' ? Math.max(1, m.pieces.filter((p) => /^d\d+-front$/.test(p.id)).length) : 1);
  const n0 = spec.style === 'drawer' ? Math.max(1, Math.min(3, Math.round(spec.drawers))) : 1;
  let out = { x: want.x + 2 * spec.t, y: want.y + 2 * spec.t, z: (want.z + 2 * spec.t) * n0 };
  let model = buildOutside({ ...spec, measure: 'outside', length: out.x, width: out.y, height: out.z });
  for (let i = 0; i < 3; i++) {
    const err = { x: want.x - model.inside.x, y: want.y - model.inside.y, z: want.z - model.inside.z };
    if (Math.abs(err.x) < 0.01 && Math.abs(err.y) < 0.01 && Math.abs(err.z) < 0.01) break;
    out = { x: out.x + err.x, y: out.y + err.y, z: out.z + err.z * stacked(model) };
    model = buildOutside({ ...spec, measure: 'outside', length: out.x, width: out.y, height: out.z });
  }
  return model;
}

function buildOutside(spec: BoxSpec): BoxModel {
  const c: Ctx = { spec, t: spec.t, warnings: [] };
  switch (spec.style) {
    case 'lid':
      return lidBox(c);
    case 'hinge':
      return hingeBox(c);
    case 'drawer':
      return drawerBox(c);
    default:
      return openBox(c);
  }
}
