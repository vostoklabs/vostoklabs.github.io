// The name puzzle: a child's name where every letter is its own loose piece, a rounded BOARD
// carries one letter-shaped pocket per piece, and a BACKER board under it is the floor those
// pieces sit on. Three things make it the product: the backer, a finger notch at the top of every
// pocket, and letters that read as letters in the export rather than as doubled outlines.
//
// The fit. The piece is the glyph at TRUE size; the pocket is that same glyph opened by
// `clearance` (0.4 mm, the middle of the 0.3–0.5 mm a part meant to be lifted in and out
// wants). Nothing interlocks: a clearance fit degrades
// gracefully across every kerf this app exposes, where a tab tuned to one assumed kerf either
// welds shut or falls out.
//
// The counters. An "A", a "B", an "O" have a middle, and it is not part of the letter — it is a
// loose island of the BOARD. That is the construction every name puzzle uses (§7.4): the middle
// is glued to the backer where it falls, the letter drops in around it with the same clearance
// on both sides, and the backer does the bridging no stencil bar could do without blocking the
// pocket. So the pockets are punched with no stencil bridges, and the export note says to glue
// the middles down.
//
// How the board is cut. One `hug` layer, margin 0: the board's ring with every pocket in its
// `minus` and a NEGATIVE `grow` of the clearance. That one offset does all three jobs at once —
// every pocket opens by the clearance, every counter island closes by it, and the board's own
// outline comes back to the nominal size it was drawn 2 × clearance over. It is also the only
// way to leave a counter loose without the engine calling it an accident: a `cut` layer that
// leaves islands trips "A cut-out splits the part into pieces", which here is the design.
//
// The finger notch. A Ø 12 disc (§7.3: a fingertip beside a 55 mm letter) sunk 1 mm INTO the
// letter's top edge, over the run of ink nearest the letter's centre, so it unions into the
// pocket with real area and every pocket is one clean cut. What stands proud of the letter is the
// semicircle of a finger notch. The board's height is the cap plus that rise plus the margins,
// so the notch always has a full margin of board above it.
import { bboxOf, placeShapes, roundedRectRing, signedArea, type Box, type Shapes } from '@vostok/laser';
import { FONTS } from '@vostok/fonts';
import { glyphLayers } from '../engine/text';
import { insideShapes, nearestBridge } from '../engine/editorGeometry';
import { sizeForCapHeight } from '../engine/metrics';
import { stem } from './shared';
import { bool, num, str, type TemplateDef } from './types';
import type { KeyringSpec, PartInput } from '../engine/types';

/** The text field's own cap; `build()` re-slices in case a saved file carries more. */
const MAX_LETTERS = 14;
/** Past this the board is wider than a lot of hobby beds — a nudge, never a block. */
const WIDE_BOARD = 300;
/** The Letter height slider's own floor and ceiling. 50–70 mm is the shipped range for this
 *  product (§7.1's real example runs 76 mm at four letters); under 40 a piece is fiddly for the
 *  hands it is made for. */
const MIN_LETTER = 40;
/** How far the notch's chord sits inside the letter's top edge, mm. Not zero: a chord laid
 *  exactly on the edge touches the letter along a line and a line has no area, so the union that
 *  makes pocket and notch ONE cut would be a coin toss. 1 mm of real overlap is not. */
const NOTCH_BITE = 1;
/** Where the letter's top ink is measured, as a share of the cap height: low enough that a round
 *  letter answers with its crown rather than the single point at its apex. */
const NOTCH_PROBE = 0.08;
/** Board left standing between two pockets, mm — §2.1's floor for 3 mm stock is the material
 *  thickness, and this board is handled by children. */
const WEB_MIN = 4;
/** The frame round the letters, as a share of the cap height, and its bounds in mm. A proportion,
 *  never a slider: it is right at every letter height, and it cannot land on a hairline frame or
 *  a slab. At the 55 mm default it is 14.9 mm. */
const MARGIN_RATIO = 0.27;
const MARGIN_MIN = 10;
const MARGIN_MAX = 20;
/** The smallest counter island worth gluing, mm across. Under it, the middle of the letter is a
 *  chip a small hand cannot place and a brush of glue would swallow. */
const MIN_COUNTER = 3;
/** How far a mark may be bridged back onto its letter, as a share of the letter height — the
 *  distance a diacritic sits at is a property of the type, not a number of millimetres, and the
 *  tilde of an Ñ is half again as far up as the dots of an Ë. Past it the bar is longer than the
 *  mark it holds, which is a chip waiting to happen rather than a repair. */
const CHIP_REACH = 0.16;
/** The bar that holds a diacritic on, mm. Wider than the ply is thick, so it is not the weak
 *  point; `nearestBridge` narrows it further if the mark itself is smaller. */
const CHIP_BAR = 4;
/** Two contours this close are the same piece of material: one letter, several overlapping
 *  strokes, which is how most faces draw an H or an E. */
const TOUCHING = 0.05;

/** This design does not hang: it sits on a table. Disabled, and `outside` because a loop tab is
 *  the only ring the app still has (the shared control is Loop tab | None). */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 5, ring: 2.5, position: -1 });

/** A number the way a person writes it: 4, 2.5, 0.45. */
const mm = (x: number) => String(Math.round(x * 100) / 100);

/** Any Unicode letter, and nothing else: a digit, a space and a punctuation mark all have one
 *  case, so they fail this without a hand-built character class. */
const isLetter = (ch: string) => ch.toLocaleLowerCase() !== ch.toLocaleUpperCase();

type Pt = [number, number];
type Ring = Shapes[number][number];

/** The ring that bounds an island — the biggest by area. The rest of the island are its
 *  counters, whatever order the font's contours arrived in. */
const outerOf = (island: Shapes[number]): Ring => island.reduce((best, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(best)) ? r : best), island[0] ?? []);

/**
 * Do two outlines actually cross?
 *
 * Neither a vertex test nor a nearest-vertex distance can see it: fredoka draws an "X" as two
 * diagonal bars, and every vertex of each bar is a corner out at a tip, 20 mm clear of the other
 * bar. So "are they the same piece of material?" answered NO across the middle of the most
 * obviously-single letter there is, and the X came off the bed as a backslash with the other
 * stroke dropped as a chip. Edges cross; vertices do not. Test the edges.
 */
function ringsCross(a: Ring, b: Ring): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const ba = bboxOf([[a]]);
  const bb = bboxOf([[b]]);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
  const side = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i]!;
    const p2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j]!;
      const q2 = b[(j + 1) % b.length]!;
      if (side(p1, p2, q1) !== side(p1, p2, q2) && side(q1, q2, p1) !== side(q1, q2, p2)) return true;
    }
  }
  return false;
}

/** The shortest distance between two islands' outlines, mm — point to EDGE, both ways, so two
 *  contours that cross answer 0 rather than however far apart their vertices happen to fall. */
function islandGap(a: Shapes[number], b: Shapes[number]): number {
  const toEdges = (p: Pt, ring: Ring) => {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i]!;
      const w = ring[(i + 1) % ring.length]!;
      const vx = w[0] - u[0];
      const vy = w[1] - u[1];
      const len2 = vx * vx + vy * vy || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * vx + (p[1] - u[1]) * vy) / len2));
      d = Math.min(d, Math.hypot(p[0] - (u[0] + t * vx), p[1] - (u[1] + t * vy)));
    }
    return d;
  };
  const ra = outerOf(a);
  const rb = outerOf(b);
  if (!ra.length || !rb.length) return Infinity;
  // Overlap first, and it is not the same question: fredoka draws an "H" as two stems and a bar
  // whose ends sit INSIDE them, so the two outlines never cross and the nearest pair of edges is
  // 0.9 mm apart — a gap, by any measurement that only looks at boundaries, in a letter that is
  // obviously one piece.
  if (ringsCross(ra, rb) || ra.some((p) => insideShapes([[rb]], p)) || rb.some((p) => insideShapes([[ra]], p))) return 0;
  let best = Infinity;
  for (const p of ra) best = Math.min(best, toEdges(p, rb));
  for (const q of rb) best = Math.min(best, toEdges(q, ra));
  return best;
}

/**
 * A letter, in one piece.
 *
 * The diaeresis of an "Ë" is two 7 × 7 mm discs floating above the E with nothing joining them:
 * cut as drawn, the part is a letter plus two chips a toddler could swallow, and the board grows
 * three pockets for them. So every island but the body is joined back on with a bar — the same
 * `nearestBridge` the engine welds separate letters with — and a mark too far away to reach is
 * dropped instead and named, because a long bar IS the chip, one snap later.
 */
function holdChips(shapes: Shapes, reach: number): { shapes: Shapes; dropped: boolean } {
  if (shapes.length < 2) return { shapes, dropped: false };
  const n = shapes.length;
  const gap: number[][] = shapes.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) gap[i]![j] = gap[j]![i] = islandGap(shapes[i]!, shapes[j]!);

  // A font is free to draw one letter as several OVERLAPPING contours — fredoka's "H" is two
  // stems and a bar — so "a separate island" is not "a loose piece". Islands that touch are one
  // piece of material; only a group that touches nothing else is a chip.
  const group = shapes.map((_, i) => i);
  const merge = (a: number, b: number) => { const from = group[b]!; for (let k = 0; k < n; k++) if (group[k] === from) group[k] = group[a]!; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (gap[i]![j]! <= TOUCHING && group[i] !== group[j]) merge(i, j);

  const boxes = shapes.map((island) => bboxOf([island]));
  const longest = (b: Box) => Math.max(b.maxX - b.minX, b.maxY - b.minY);
  let biggest = 0;
  for (let i = 1; i < n; i++) if (longest(boxes[i]!) > longest(boxes[biggest]!)) biggest = i;
  const body = group[biggest]!;
  if (group.every((g) => g === body)) return { shapes, dropped: false };

  const out: Shapes = shapes.filter((_, i) => group[i] === body);
  let dropped = false;
  for (const mark of new Set(group.filter((g) => g !== body))) {
    const members = group.flatMap((g, i) => (g === mark ? [i] : []));
    let near = { d: Infinity, from: members[0]!, to: biggest };
    for (const i of members) for (let j = 0; j < n; j++) if (group[j] === body && gap[i]![j]! < near.d) near = { d: gap[i]![j]!, from: i, to: j };
    if (near.d > reach) { dropped = true; continue; }
    // The bar overlaps both pieces, so the piece cuts as one island — and the pocket is the same
    // shapes, so the slot matches what drops into it.
    out.push(...members.map((i) => shapes[i]!), ...nearestBridge([shapes[near.to]!], [shapes[near.from]!], CHIP_BAR));
  }
  return { shapes: out, dropped };
}

/** The x-runs of ink at height `y`: even-odd across each island's rings (so a counter reads as a
 *  gap), then merged across islands (so two overlapping strokes read as one run). */
function inkRuns(shapes: Shapes, y: number): [number, number][] {
  const runs: [number, number][] = [];
  for (const island of shapes) {
    const xs: number[] = [];
    for (const ring of island) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        if (a[1] <= y === b[1] <= y) continue;
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) runs.push([xs[i]!, xs[i + 1]!]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Where the finger notch goes: over the letter's centre when there is ink there to bite into,
 * and over the nearest run of top ink when there is not.
 *
 * "Centred on the letter" is right for an A, an M, an O — and wrong for a U, whose centre at the
 * top is the gap between its two stems. A notch there would be a separate round hole in the
 * board with a web between it and the pocket, which is neither one cut nor a finger hold.
 */
function notchCentre(shapes: Shapes, box: Box, cap: number): number {
  const cx = (box.minX + box.maxX) / 2;
  const runs = inkRuns(shapes, box.maxY - Math.max(0.5, NOTCH_PROBE * cap));
  if (!runs.length) return cx;
  let best = runs[0]!;
  let bestD = Infinity;
  for (const r of runs) {
    const d = cx < r[0] ? r[0] - cx : cx > r[1] ? cx - r[1] : 0;
    if (d < bestD - 1e-9) { bestD = d; best = r; }
  }
  return bestD === 0 ? cx : (best[0] + best[1]) / 2;
}

/**
 * The notch itself: a WHOLE disc, CCW, sunk `NOTCH_BITE` into the letter's top edge.
 *
 * A half-disc on a chord was the first try and it is wrong in the wood: the chord runs out past
 * the stem on both sides, so the pocket comes off the bed as a mushroom — a flat brim with two
 * sharp re-entrant corners where the letter's edge meets it. A whole disc has no chord, so the
 * union is exactly the circle's arc running into the letter's own sides (a round hole
 * overlapping the top of each letter and standing proud of it).
 * What shows above the letter is the semicircle; what is below it is bite.
 */
function disc(cx: number, cy: number, r: number, steps = 72): Ring {
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) ring.push([cx + r * Math.cos((2 * Math.PI * i) / steps), cy + r * Math.sin((2 * Math.PI * i) / steps)]);
  return ring;
}

/** The narrowest counter the FONT draws as a hole, mm across — what is left as a loose island of
 *  the board once the clearance has closed it by `clearance` on every side. A counter that only
 *  exists in the union of two overlapping contours (fredoka's "A" is a lambda and a crossbar) is
 *  invisible from here, which is why the suite measures the built board's islands as well. */
function narrowestCounter(shapes: Shapes): number {
  let narrowest = Infinity;
  for (const island of shapes) {
    const outer = outerOf(island);
    for (const ring of island) {
      if (ring === outer) continue;
      const b = bboxOf([[ring]]);
      narrowest = Math.min(narrowest, Math.min(b.maxX - b.minX, b.maxY - b.minY));
    }
  }
  return narrowest;
}

/**
 * What to actually do about a board that is too wide — the letter height that fits, worked out
 * rather than suggested. "Try a lower letter height" was advice that did not work: the letters
 * are only part of the width, so shrinking them 20 % takes 20 % off less than the whole.
 */
function shorterAdvice(width: number, count: number, fixed: number, size: number): string {
  const ink = width - fixed;
  const fits = ink > 0 ? Math.floor(((WIDE_BOARD - fixed) / ink) * size) : 0;
  if (fits >= MIN_LETTER) return `A letter height of ${fits} mm brings it under ${WIDE_BOARD} mm.`;
  return `Even at ${MIN_LETTER} mm — the smallest letter this design cuts — ${count} letters come to ${(fixed + (ink * MIN_LETTER) / size).toFixed(0)} mm. It needs a shorter name, or a bed this big.`;
}

/** Capitals that enclose a middle in any face worth cutting this in — used only to say why the
 *  backer matters, never to build geometry (the measurement is `narrowestCounter`). */
const HAS_COUNTER = new Set(Array.from('ABDOPQRÀÁÂÃÄÅÆÐÒÓÔÕÖØ'));

/** The faces this design is safe in: fat, round, and drawn so the middle of an A or an O is big
 *  enough to glue back down. Here the face is an engineering decision, not a look — a piece is
 *  only as strong as the thinnest part of its letter, and a counter is only as glueable as the
 *  island it leaves.
 *
 *  Measured, not guessed: every face here cuts "Luna" and "Elijah"
 *  with no warning of any kind at the defaults, every counter over the 3 mm
 *  floor. `bakbak-one` was on this list and is not any more: it is the widest of the fat rounded
 *  faces, and "Elijah" at the default letter height comes to 311 mm in it — over the bed the
 *  width warning names, on a name the product is sold under. */
const RECOMMENDED = ['fredoka', 'baloo-2', 'lilita-one', 'chewy', 'luckiest-guy'];

export const namePuzzle: TemplateDef = {
  id: 'name-puzzle',
  name: 'Name puzzle',
  blurb: 'Every letter of a name becomes a loose piece that drops into its own pocket in the board.',
  tags: ['kids', 'cut'],
  fields: [
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text',
      value: 'Luna', placeholder: 'A name', maxLength: MAX_LETTERS,
      symbols: false,
      help: 'Letters only, everything else is dropped.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka', recommended: RECOMMENDED },

    // ------------------------------------------------------- LEFT: "Board", opens first --
    {
      kind: 'number', key: 'letterSize', label: 'Letter height', section: 'Board',
      value: 55, min: MIN_LETTER, max: 70, step: 1, unit: 'mm',
      help: 'Sets the size of the whole board, not just the letters.',
    },
    {
      kind: 'toggle', key: 'backer', label: 'Backer board', section: 'Board', value: true,
      help: 'The floor the letters and their loose middles sit on.',
    },

    // ------------------------------------------------------------ LEFT: "More options" --
    {
      kind: 'number', key: 'clearance', label: 'Letter clearance', section: 'Board',
      value: 0.4, min: 0.3, max: 0.6, step: 0.05, unit: 'mm', advanced: true,
      help: 'Air around each letter, higher is looser.',
    },
    {
      kind: 'number', key: 'notch', label: 'Finger notch', section: 'Board',
      value: 12, min: 10, max: 14, step: 0.5, unit: 'mm', advanced: true,
      help: 'The dip above each letter you lift it out by.',
    },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Board', value: 10, min: 4, max: 20, step: 1, unit: 'mm', advanced: true },
    {
      kind: 'number', key: 'spacing', label: 'Letter spacing', section: 'Board',
      value: 8, min: 6, max: 20, step: 0.5, unit: 'mm', advanced: true,
      help: 'Board left standing between two pockets.',
    },
  ],
  async build(v) {
    // Letters in, everything else out. A space runs two words together silently — a first and a
    // middle name is expected enough that a warning would be noise.
    const chars: string[] = [];
    let dropped = '';
    for (const ch of Array.from(str(v, 'text'))) {
      if (isLetter(ch)) chars.push(...Array.from(ch.toLocaleUpperCase()));
      else if (!dropped && ch.trim() !== '') dropped = ch;
    }
    const truncated = chars.length > MAX_LETTERS;
    const kept = truncated ? chars.slice(0, MAX_LETTERS) : chars;

    const font = str(v, 'font');
    const nothing = (): ReturnType<TemplateDef['build']> => {
      const w = dropped ? [`Dropped "${dropped}" — only letters become puzzle pieces.`] : [];
      return Promise.resolve({ blank: { kind: 'none' }, keyring: noRing(), layers: [], ...(w.length ? { warnings: w } : {}) });
    };
    if (!kept.length) return nothing();

    const cap = Math.max(1, num(v, 'letterSize'));
    const clearance = Math.min(1, Math.max(0.05, num(v, 'clearance')));
    const notchDia = Math.max(4, num(v, 'notch'));
    // Drawn `clearance` under size, because the board's own negative offset grows every pocket —
    // notch included — by exactly that. What ends up in the wood is the number on the slider.
    const notchR = notchDia / 2 - clearance;
    // The gap is between EXTENTS (ink or notch, whichever reaches further), so the board left
    // standing between two pockets is this minus the clearance each pocket takes from its side.
    const gap = Math.max(num(v, 'spacing'), WEB_MIN + 2 * clearance);
    const margin = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, MARGIN_RATIO * cap));

    // One call, one baseline: a call per character centres each letter's own ink box and floats
    // a "Q"'s bowl above its neighbours by half its tail. The pitch below is this template's
    // own — the font's advances are the spacing running text wants, not the air loose pieces do.
    const em = await sizeForCapHeight(font, cap);
    const letters: { char: string; shapes: Shapes; box: Box; notchX: number }[] = [];
    const chipped: string[] = [];
    let tightest = Infinity;
    for (const g of await glyphLayers({ text: kept.join(''), font, size: em })) {
      // A character neither the font nor the fallback can draw has no ink: drop it, and name it
      // the same way a punctuation mark is named.
      if (!g.shapes.length) { if (!dropped) dropped = g.char; continue; }
      const held = holdChips(g.shapes, CHIP_REACH * cap);
      if (held.dropped) chipped.push(g.char);
      const box = bboxOf(held.shapes);
      letters.push({ char: g.char, shapes: held.shapes, box, notchX: notchCentre(held.shapes, box, cap) });
      tightest = Math.min(tightest, narrowestCounter(held.shapes));
    }
    if (!letters.length) return nothing();

    // The pitch: every letter's extent (its ink, or its notch where the notch reaches further)
    // set `gap` apart from the next, then the whole run centred on the origin.
    const shifts: number[] = [];
    let cursor = 0;
    for (const l of letters) {
      const left = Math.min(l.box.minX, l.notchX - notchR);
      const right = Math.max(l.box.maxX, l.notchX + notchR);
      shifts.push(cursor - left);
      cursor += right - left + gap;
    }
    const runW = cursor - gap;
    const inkTop = Math.max(...letters.map((l) => l.box.maxY));
    const inkBottom = Math.min(...letters.map((l) => l.box.minY));
    // How far a notch stands above the letter it belongs to, once the board's offset has grown
    // it: (top − bite) + notchR + clearance.
    const rise = notchDia / 2 - NOTCH_BITE;
    const width = runW + 2 * margin;
    const height = inkTop - inkBottom + rise + 2 * margin;
    const corner = Math.max(0, Math.min(num(v, 'corner'), Math.min(width, height) / 2 - 1));
    // The board is centred on the origin, so the letters sit half the notch band low: the frame
    // reads even, and the notches have the same `margin` of board above them as the letters have
    // below — never under the 5 mm a finger hold needs to stay inside the board.
    const dx = -runW / 2;
    const dy = -(inkTop + inkBottom) / 2 - rise / 2;
    const placed = letters.map((l, i) => ({
      char: l.char,
      shapes: placeShapes(l.shapes, shifts[i]! + dx, dy, 0),
      notchX: l.notchX + shifts[i]! + dx,
      top: l.box.maxY + dy,
    }));

    // One pocket per letter: the glyph and its finger notch, which overlap by `NOTCH_BITE` and so
    // come out of the board as ONE hole. Nothing here is a cut LAYER — see the header: the board
    // is a hug whose single layer carries these in `minus`, so the counters can fall out as
    // islands without the engine reading that as an accident.
    const pockets: Shapes = [];
    for (const p of placed) pockets.push(...p.shapes, [disc(p.notchX, p.top - NOTCH_BITE, notchR)]);

    const parts: PartInput[] = [];
    // Under everything, and the reason the letters have a floor: on by default.
    if (bool(v, 'backer')) {
      parts.push({
        id: 'backer', label: 'Backer', blank: { kind: 'shape', shapes: [[roundedRectRing(width, height, corner)]] },
        layers: [], keyring: 'none', assembledAt: { x: 0, y: 0 }, material: 'dark', z: 0,
      });
    }
    // Then one part per letter, in name order, each cut at TRUE size — the clearance lives in the
    // pocket. `material: 'dark'` because the letters are the contrasting sheet in every one of
    // these products; the board's own counter islands stay light.
    for (const [i, p] of placed.entries()) {
      const b = bboxOf(p.shapes);
      parts.push({
        id: `letter-${i}`, label: p.char,
        blank: { kind: 'shape', shapes: placeShapes(p.shapes, -(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2, 0) },
        layers: [], keyring: 'none',
        // Where this letter goes when the puzzle is done: its own pocket.
        assembledAt: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
        material: 'dark', z: 1,
      });
    }

    // Practical/size first, then content-changing, then what the assembly needs, then a quality
    // nudge: the status line shows warnings[0] only.
    const fontMeta = FONTS.find((f) => f.id === font);
    const island = tightest - 2 * clearance;
    const warnings = [
      ...(width > WIDE_BOARD ? [`This board is ${width.toFixed(1)} mm wide — wider than a lot of hobby lasers (the Bambu H2D's bed is 310 × 270 mm). ${shorterAdvice(width, letters.length, gap * (letters.length - 1) + 2 * margin, cap)}`] : []),
      ...(dropped ? [`Dropped "${dropped}" — only letters become puzzle pieces.`] : []),
      ...chipped.map((c) => `The accent on "${c}" would come off as a loose chip, so the letter is cut without it.`),
      ...(truncated ? [`Only the first ${MAX_LETTERS} letters are used.`] : []),
      ...(Number.isFinite(island) && island < MIN_COUNTER
        ? [`${fontMeta?.label ?? font} leaves the middle of a letter only ${mm(island)} mm across — too small to glue back in. A rounder face, or a taller letter, keeps it.`]
        : []),
      ...(!bool(v, 'backer') && placed.some((p) => HAS_COUNTER.has(p.char))
        ? [`The middle of the "${placed.find((p) => HAS_COUNTER.has(p.char))!.char}" comes out loose — turn the backer board on to give it something to glue to.`]
        : []),
      ...(fontMeta && (fontMeta.category === 'Script' || fontMeta.category === 'Handwriting')
        ? [`${fontMeta.label} is a script or handwriting face — its thin strokes are easy for little hands to snap off. A chunky sans like Fredoka or Baloo holds up better.`]
        : []),
    ];

    return {
      label: 'Board',
      material: 'light',
      // Drawn 2 × clearance over size and offset back: that one negative offset opens every
      // pocket by the clearance, closes every counter island by it, and leaves the board at the
      // nominal size the status line reports.
      blank: { kind: 'hug', margin: 0, smoothing: 0, bridges: 'none', counters: 'open' },
      keyring: noRing(),
      layers: [{
        id: 'board', label: 'Board', op: 'off', hugOnly: true, grow: -clearance,
        shapes: [[roundedRectRing(width + 2 * clearance, height + 2 * clearance, corner + clearance)]],
        minus: pockets,
      }],
      parts,
      layout: { flow: 'wrap', gap: 6 },
      status: `${placed.length} piece${placed.length === 1 ? '' : 's'}`,
      ...(warnings.length ? { warnings } : {}),
    };
  },
  exportNote: (v) => (bool(v, 'backer')
    ? 'Glue the board onto the backer, then glue each loose middle — the inside of an A or an O — to the backer inside its pocket.'
    : 'The loose middles — the inside of an A or an O — have nothing to hold them: turn the backer board on and glue each one to it.'),
  fileName: (v) => stem(str(v, 'text') || 'name', 'puzzle'),
};
