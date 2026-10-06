// Plant stake: a long garden stake whose top edge IS the plant's name.
//
// Heavy capitals stand on a rail that runs the stake's whole length; the material above the rail
// and between the letters is cut away, so at the head end the word is the stake's silhouette.
// After the word the stake is full width again, down to a long point. One cut outline, nothing
// engraved — the lettering is the edge.
//
// The numbers that hold it together (W = stake width, default 16 mm):
//
//   RAIL   r = max(5 mm, 35 % of W) — 5.6 mm at the default. It is the only material that runs
//          under the word, so it is the stake's spine there: never under 5 mm on 3 mm stock.
//   CAPS   the letters' visible height is W − r (10.4 mm at the default) — the name's tallest
//          letter touches the stake's top edge, which is where the photo puts them. Tallest, not
//          the H: a round capital rises 1–2 % past the flat ones, and trimming that overshoot at
//          the edge left every S, O and Q with a flat chord across its top. So the flat tops sit
//          a hair under the edge instead (0.25 mm at most), which nobody sees.
//   WELD   every letter's baseline is sunk SINK = 1 mm INTO the rail, so the union is a real
//          overlap and not a tangent that the kerf could part. What holds a letter on is the
//          width of its foot where it leaves the rail; the recommended faces measure ≥ 1.5 mm
//          there for every capital at the default width (the node suite asserts it).
//   TAILS  a letter that hangs below the line — a Q's tail, a lowercase p's descender — stands on
//          its lowest point instead, shrunk only if it would then rise past the top edge: the
//          rail would swallow the very part that tells a Q from an O. A Q whose tail already
//          shows above the rail (Secular One draws it across the bowl) stays as it is.
//   MARKS  anything that does not reach the rail — a hyphen, an apostrophe, an accent over a
//          capital — would come off the bed loose, so it is left off and the build says so. A
//          mark that would lose a part (the stroke of a "!", the top dot of a ":") goes whole:
//          its leftover dot on the rail would read as a full stop. A lowercase i's dot is set
//          down on its stem first (`joinDots`).
//   TIP    38° included angle, the photo's long point, blunted to a 0.6 mm radius so it does
//          not char: 23 mm long at the default width.
//
// Batch mode is the product: one name per line, a sheet of stakes.
import { bboxOf, placeShapes, type Box, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { pointInRing } from '@vostok/shapes';
import { readSymbols } from '../symbols/model';
import { MIN_COUNTER, applyCase, glyphLayers, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { joinDots, letteringFields, stem, weldOverlap } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

/** The photo's stake: ~16 mm wide, ~180 mm long. */
const WIDTH = 16;
const LENGTH = 180;
/** The rail under the letters, as a share of the width, and its floor in mm. */
const RAIL_SHARE = 35;
const RAIL_MIN = 5;
/** How deep every letter's baseline sits inside the rail, mm (the weld). */
const SINK = 1;
/** The point: included angle in degrees and the radius it is blunted to, mm. */
const TIP_ANGLE = 38;
const TIP_ROUND = 0.6;
/** Rail left bare before the first letter, as a share of W — the photo's small stub. */
const HEAD = 0.1;
/** Air between the last letter and the full-width body, as a share of the letters' height. */
const TAIL_GAP = 0.15;
/** The shortest full-width body after the word, as a multiple of W, so a long name never runs
 *  into the point. */
const MIN_BODY = 2;
/** The narrowest stroke and the narrowest foot a cut-out letter may have on 3 mm stock, mm
 *  (1.5–2 mm strokes on 3 mm plywood). */
const MIN_STROKE = 1.5;
/** The bed the default has to fit. */
const BED = 300;
/** The house's readable floor for a capital, mm. */
const MIN_CAP = 3;
/** The engraved second line's cap height, as a share of W; it shrinks to fit down to MIN_CAP. */
const NOTE_SHARE = 0.28;

/**
 * Faces whose capitals survive as the cut edge of a 16 mm stake: every stroke and every foot on
 * the rail ≥ 1.5 mm, counters ≥ 1 mm, one piece for the twelve names in the node suite, and a Q
 * that still reads as a Q. Measured there, not assumed; the geometric heavy sans of the photo
 * first. Days One is not here: its Q's tail is a stub sitting ON the baseline, so it neither
 * hangs (nothing to stand on) nor shows — the rail turns it into an O with a bump.
 */
const HEAVY = ['secular-one', 'archivo-black', 'paytone-one', 'russo-one', 'lilita-one'];

const EMPTY_WARNING = 'Type a plant name to see it on the stake.';
const MARKS_WARNING = 'Marks that don’t reach the rail, like - or ’, are left off — they would fall out.';
const THIN_WARNING = 'This font is too thin to cut as the stake’s edge — pick a heavier font or widen the stake.';
const grownWarning = (len: number) => `The text needs a longer stake, so it grew to ${Math.round(len)} mm.`;
const bedWarning = (len: number) => `At ${Math.round(len)} mm this stake is longer than a ${BED} mm bed.`;

/** A stake is never hung from anything; `keyringFrom` with no keyring fields would report an
 *  enabled 0 mm hole (business-card and place-cards say the same). */
const NO_KEYRING: KeyringSpec = { enabled: false, mode: 'outside', side: 'left', along: 0.5, dia: 4, ring: 2, position: -1 };

// ---------------------------------------------------------------------------- measuring --

/** The material spans a horizontal line at `y` crosses in one island, even–odd (so a counter
 *  reads as a gap), left to right. */
function spansAtY(island: CutRing[], y: number): [number, number][] {
  const hits: number[] = [];
  for (const ring of island) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if ((a[1] > y) === (b[1] > y)) continue;
      hits.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  hits.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i]!, hits[i + 1]!]);
  return out;
}

/** The same along a vertical line at `x`, bottom to top. */
function spansAtX(island: CutRing[], x: number): [number, number][] {
  const flipped = island.map((r) => r.map(([px, py]): Pt => [py, px]));
  return spansAtY(flipped, x);
}

/** The thinnest stroke of an "H" — its stem, or its crossbar where that is lighter — mm. The
 *  H is the gauge every face draws, which is why it is set in front of the word at all. */
function hStroke(h: Shapes, box: Box): number {
  const cap = box.maxY - box.minY;
  const stems = h.flatMap((isl) => spansAtY(isl, box.minY + 0.2 * cap));
  const bars = h.flatMap((isl) => spansAtX(isl, (box.minX + box.maxX) / 2));
  const stem = stems.length ? Math.min(...stems.map(([a, b]) => b - a)) : Infinity;
  const bar = bars.length ? Math.min(...bars.map(([a, b]) => b - a)) : Infinity;
  return Math.min(stem, bar);
}

// ----------------------------------------------------------------------------- the stake --

/** The rail's height for a stake `w` wide and a rail share `pct`, mm: never under 5 mm, and never
 *  so tall that the letters above it drop under the house's 3 mm readable capital (a saved value
 *  from outside the sliders' ranges is the only way to get there). */
const railHeight = (w: number, pct: number): number => Math.min(w - MIN_CAP, Math.max(RAIL_MIN, (w * pct) / 100));

/** The length of an unblunted point for a stake `w` wide, mm; the real one is a hair shorter. */
const tipLength = (w: number): number => (w / 2) / Math.tan(((TIP_ANGLE / 2) * Math.PI) / 180);

/**
 * The stake's outline without its letters, one ring, counter-clockwise: the rail from the head
 * end to `bodyStart`, full width from there to the point. `bodyStart` 0 is a plain stake.
 */
function stakeRing(len: number, w: number, rail: number, bodyStart: number): CutRing {
  const a = ((TIP_ANGLE / 2) * Math.PI) / 180;
  // The rounded point's circle touches x = len; the two edges are tangent to it, and meet where
  // the sharp point would have been, `apex`, a little past the end.
  const cx = len - TIP_ROUND;
  const apex = cx + TIP_ROUND / Math.sin(a);
  const tipStart = apex - tipLength(w);
  const arc: Pt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = -(Math.PI / 2 - a) + (i / n) * (Math.PI - 2 * a);
    arc.push([cx + TIP_ROUND * Math.cos(t), w / 2 + TIP_ROUND * Math.sin(t)]);
  }
  const ring: Pt[] = [[0, 0], [tipStart, 0], ...arc, [tipStart, w]];
  if (bodyStart > 1e-6) ring.push([bodyStart, w], [bodyStart, rail], [0, rail]);
  else ring.push([0, w]);
  return ring;
}

// ------------------------------------------------------------------------------ the type --

interface SetLine {
  /** Each character's islands, baseline on y = 0, the line's first ink at x = 0. */
  glyphs: Shapes[];
  /** The face's thinnest H stroke at this size, mm. */
  stroke: number;
}

/** The letters and figures a name is fitted to when it uses them. A lowercase i and j are left
 *  out: their dots are set down on their stems before anything is cut. */
const FITS = /[A-Za-hk-z0-9]/;
/** A letter or a figure keeps its size whatever it carries above the line (an accent is left off
 *  as a mark); anything else that rises past it — a symbol, a bracket — is shrunk to fit. */
const LETTER = /[\p{L}\p{N}]/u;
/** How far under the baseline a glyph may reach, as a share of the cap, and still count as
 *  standing on it: past every bundled heavy face's round overshoot (≤ 2.5 %), short of the
 *  shallowest Q tail that hangs (Changa One's and Black Han Sans', 8 %). */
const HANG = 0.05;
/** How much more ink than its face's O a Q must show above the rail for its tail to read there,
 *  as a share of the O's: Secular One's tail, drawn across the bowl, shows 2.7 %; a tail that
 *  hangs wholly under the bowl (Archivo Black, Paytone, Russo, Lilita) shows 0.0–0.1 %. */
const TAIL_SHOWS = 0.015;

/** The material of `shapes` above the line `y`, mm² — read in 0.05 mm strips. */
function inkAbove(shapes: Shapes, y: number): number {
  const top = bboxOf(shapes).maxY;
  let area = 0;
  for (let at = y + 0.025; at < top; at += 0.05) {
    for (const isl of shapes) for (const [a, b] of spansAtY(isl, at)) area += (b - a) * 0.05;
  }
  return area;
}

/**
 * A line of type standing on y = 0 and starting at x = 0: its capitals `height` tall, or — with
 * `fit` — its TALLEST letter `height` tall, which is what the name on the stake's edge needs.
 *
 * `glyphLayers` hands the run back centred on its INK, which throws the baseline away — and the
 * baseline is the one thing this design is built on. So a gauge is set in front of the text: an
 * "H", whose foot is the baseline, and with `fit` one of every letter and figure the name uses,
 * whose highest top is the line the name has to fill. Measured off the outlines rather than
 * trusted to the face's OS/2 table, and dropped once read. Scaling the run about the baseline so
 * that top lands at `height` puts an S's or an O's overshoot exactly on the stake's top edge —
 * fitted, not trimmed — and a word of flat capitals (KALE) flush with it too.
 *
 * With `fit` — the name on the rail, whose top SINK mm over the baseline swallows everything
 * under it — two more things:
 *
 *  · a letter that hangs below the line stands on its lowest point instead. A Q's tail, a p's or
 *    a y's descender is exactly what the rail would swallow, and a Q without its tail is an O
 *    (SQUASH came out SOUASH in five of the six recommended faces). Lifted, it is shrunk about
 *    its new foot only if it would then rise past the top edge: a Q to 80–84 %, a lowercase p not
 *    at all. The one exception is a Q whose tail already shows above the rail — drawn across the
 *    bowl, as Secular One draws it (`TAIL_SHOWS`, read against the face's own O). Lifting that
 *    one would only shrink it and leave a hairline slit under its bowl.
 *  · a symbol or a punctuation mark that still rises past the line (a heart icon, a bracket) is
 *    shrunk about its own foot until it fits, so it keeps its shape instead of losing its top to
 *    the edge. A letter that stands on the line is never shrunk: what it carries above the line
 *    is an accent, and an accent is a loose mark.
 */
async function setLine(text: string, font: string, height: number, track: number, symbols: ReturnType<typeof readSymbols>, fit = false): Promise<SetLine | null> {
  if (!text) return null;
  const gauge = fit ? ['H', ...new Set(Array.from(text).filter((c) => FITS.test(c)))].join('') : 'H';
  // A Q is judged against its own face's O, set after the gauge and read the same way.
  const judge = fit && text.includes('Q') ? 'O' : '';
  const size = await sizeForCapHeight(font, height);
  const run = await glyphLayers({ text: gauge + judge + text, font, size, letterSpacing: track, symbols });
  const h = run[0];
  const glyphs = run.slice(gauge.length + judge.length);
  const ink = glyphs.flatMap((g) => g.shapes);
  if (!h?.shapes.length || !ink.length) return null;
  const foot = h.box.minY;
  const top = Math.max(...run.slice(0, gauge.length).map((g) => g.box.maxY));
  const k = height / Math.max(1e-6, top - foot);
  const x0 = bboxOf(ink).minX;
  const place = (s: Shapes): Shapes => s.map((isl) => isl.map((r) => r.map(([x, y]): Pt => [(x - x0) * k, (y - foot) * k])));
  const o = judge ? place(run[gauge.length]!.shapes) : [];
  const tailShows = (q: Shapes): boolean => o.length > 0 && inkAbove(q, SINK) - inkAbove(o, SINK) > TAIL_SHOWS * inkAbove(o, SINK);
  const stand = (s: Shapes, char: string): Shapes => {
    const b = bboxOf(s);
    const letter = LETTER.test(char);
    const lift = letter && -b.minY > HANG * height && !(char === 'Q' && tailShows(s)) ? -b.minY : 0;
    const base = b.minY + lift;
    const rise = b.maxY + lift;
    const f = (lift || !letter) && rise > height && base < height ? (height - base) / (rise - base) : 1;
    if (!lift && f === 1) return s;
    const cx = (b.minX + b.maxX) / 2;
    return s.map((isl) => isl.map((r) => r.map(([x, y]): Pt => [cx + (x - cx) * f, base + (y + lift - base) * f])));
  };
  return {
    glyphs: glyphs.map((g) => {
      const s = place(g.shapes);
      return fit && s.length ? stand(s, g.char) : s;
    }),
    stroke: hStroke(h.shapes, h.box) * k,
  };
}

interface Word {
  /** The letters' islands in the stake's frame — only those standing on the rail. */
  islands: Shapes;
  /** How many of `islands` each character owns, in reading order. */
  glyphIslands: number[];
  /** The right edge of the last letter, mm; 0 when nothing stands on the rail. */
  end: number;
  /** Islands left off because they do not reach the rail. */
  dropped: number;
  /** The face's thinnest stroke and the narrowest foot on the rail, mm. */
  stroke: number;
  foot: number;
}

/**
 * The name, standing on the rail: capitals `w − rail` tall above it, their baselines SINK deep
 * inside it, the first letter a small margin from the head end.
 *
 * Anything that does not reach down into the rail is left off: a hyphen, an apostrophe, a colon
 * (whole — `keptOnRail`), an accent over a capital that sits above the stake's top edge. Each of
 * those is a separate island once the material round it is cut away, and a piece that falls out
 * of the bed is a bug, not a detail. A lowercase i's or j's dot is first set down on its own stem
 * (`joinDots`, the connected-text rule), so "basil" keeps its i.
 */
async function setWord(v: Values, text: string, w: number, rail: number): Promise<Word> {
  const none: Word = { islands: [], glyphIslands: [], end: 0, dropped: 0, stroke: Infinity, foot: Infinity };
  const cap = w - rail + SINK;
  const line = await setLine(text, str(v, 'font'), cap, num(v, 'letterSpacing') / 100, readSymbols(v), true);
  if (!line) return none;
  const placed = line.glyphs.map((g) => placeShapes(g, HEAD * w, rail - SINK, 0));
  // One character at a time, so every island still knows whose it is once its dot has moved.
  const chars = joinDots(placed.map((g) => ({
    id: 'name', label: 'Plant name', kind: 'text', op: 'off', hugOnly: true, shapes: g, glyphIslands: [g.length],
  }) satisfies DesignLayer), weldOverlap(cap));
  const all = chars.flatMap((l) => l.shapes);
  const tally = chars.flatMap((l) => l.glyphIslands ?? [l.shapes.length]);
  const owner = chars.flatMap((l, c) => l.shapes.map(() => c));
  const kept = keptOnRail(all, owner, Array.from(text), rail, w);
  const standing = all.filter((_, i) => kept[i]);
  if (!standing.length) return { ...none, dropped: all.length };
  // A name that opened on a mark ("'BASIL") starts where its first letter does.
  const islands = placeShapes(standing, HEAD * w - bboxOf(standing).minX, 0, 0);
  // The narrowest foot of any letter, read per GLYPH: a stroke-built face draws a V as two
  // overlapping bars, and each bar's foot alone is narrower than the letter's.
  let foot = Infinity;
  let at = 0;
  const glyphIslands: number[] = [];
  for (const n of tally) {
    const own = all.slice(at, at + n).filter((_, j) => kept[at + j]);
    at += n;
    glyphIslands.push(own.length);
    for (const run of footRuns(own, rail)) foot = Math.min(foot, run);
  }
  return { islands, glyphIslands, end: bboxOf(islands).maxX, dropped: all.length - islands.length, stroke: line.stroke, foot };
}

/** An island's outer ring: the largest, whatever order the rings came in. */
const outerOf = (island: CutRing[]): CutRing =>
  island.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a), island[0]!);
const ringArea = (r: CutRing): number => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** Whether two segments properly cross. */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Whether two islands share material — without manifold, which `build()` does not have.
 *
 * A vertex of one inside the other's material, or an outer edge of one crossing any ring of the
 * other (a crossing into a counter still lands in material right beside it). That covers the two
 * ways a stroke-built face assembles a letter: Montserrat's H is two stems and a crossbar laid
 * over them, and the crossbar alone reaches nowhere near the rail.
 */
function touches(a: CutRing[], b: CutRing[]): boolean {
  const ba = bboxOf([a]);
  const bb = bboxOf([b]);
  if (ba.minX > bb.maxX || bb.minX > ba.maxX || ba.minY > bb.maxY || bb.minY > ba.maxY) return false;
  const inMaterial = (p: Pt, isl: CutRing[]) => { const o = outerOf(isl); return pointInRing(p, o) && !isl.some((r) => r !== o && pointInRing(p, r)); };
  const oa = outerOf(a);
  const ob = outerOf(b);
  if (oa.some((p) => inMaterial(p, b)) || ob.some((p) => inMaterial(p, a))) return true;
  const edgesCross = (outer: CutRing, rings: CutRing[]) => outer.some((p, i) => {
    const q = outer[(i + 1) % outer.length]!;
    return rings.some((r) => r.some((s, j) => crosses(p, q, s, r[(j + 1) % r.length]!)));
  });
  return edgesCross(oa, b) || edgesCross(ob, a);
}

/**
 * Which islands stay: those that reach down into the rail, and everything joined to them.
 *
 * Reaching the rail means by more than a graze — 0.2 mm, well inside the SINK every letter is set
 * at and well past a mark that merely sits on the rail's top. An island above the stake's top edge
 * would be trimmed to nothing, so it cannot hold anything up. A `barred` island never stays and
 * never holds anything else up.
 */
function attachedToRail(islands: Shapes, rail: number, w: number, barred: boolean[]): boolean[] {
  const kept = islands.map((isl, i) => { const b = bboxOf([isl]); return !barred[i] && b.minY < rail - 0.2 && b.minY < w; });
  for (let grew = true; grew;) {
    grew = false;
    islands.forEach((isl, i) => {
      if (kept[i] || barred[i] || bboxOf([isl]).minY >= w) return;
      if (islands.some((other, j) => kept[j] && touches(isl, other))) { kept[i] = true; grew = true; }
    });
  }
  return kept;
}

/**
 * `attachedToRail`, with one rule on top: a mark that is not a letter or a figure stays whole or
 * goes whole. The stroke of a "!" floats while its dot stands on the rail, and the dot alone reads
 * as a full stop ("THYME!?" came out "THYME.."). A letter keeps its body when its accent goes —
 * an N without its tilde is still the right letter. `owner` is each island's character index.
 */
function keptOnRail(islands: Shapes, owner: number[], chars: string[], rail: number, w: number): boolean[] {
  const barred = islands.map(() => false);
  for (;;) {
    const kept = attachedToRail(islands, rail, w, barred);
    const broken = new Set(owner.filter((c, i) => !kept[i] && !barred[i] && !LETTER.test(chars[c] ?? '')));
    const more = owner.map((c, i) => broken.has(c) && kept[i]);
    if (!more.some(Boolean)) return kept;
    more.forEach((m, i) => { if (m) barred[i] = true; });
  }
}

/** The widths of one letter's feet where they leave the rail: the material a line just above the
 *  rail's top crosses, overlapping islands merged, mm. A letter wholly inside the rail (an
 *  underscore) has none — it is rail. */
function footRuns(own: Shapes, rail: number): number[] {
  const spans = own.flatMap((isl) => spansAtY(isl, rail + 0.1)).sort((p, q) => p[0] - q[0]);
  const runs: number[] = [];
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else { if (cur) runs.push(cur[1] - cur[0]); cur = [a, b]; }
  }
  if (cur) runs.push(cur[1] - cur[0]);
  return runs;
}

/**
 * The optional engraved second line — "sown 12 May" — on the full-width body after the word,
 * starting at `from`, its capitals centred on the stake's middle. Always at its full size (28 %
 * of W, 4.5 mm at the default): like the name, a line too long for the stake grows the stake
 * rather than shrinking into a smudge.
 */
async function noteLayers(v: Values, text: string, w: number, from: number): Promise<DesignLayer[]> {
  const cap = Math.max(MIN_CAP, NOTE_SHARE * w);
  const line = await setLine(text, str(v, 'font'), cap, 0, {});
  if (!line) return [];
  const shapes = placeShapes(line.glyphs.flat(), from, w / 2 - cap / 2, 0);
  return [{ id: 'note', label: 'Second line', kind: 'text', shapes, op: 'engrave' }];
}

// ------------------------------------------------------------------------------ the form --

export const plantStake: TemplateDef = {
  id: 'plant-stake',
  name: 'Plant stake',
  blurb: 'A garden stake whose top edge is the plant’s name, cut in one piece.',
  tags: ['gift', 'home', 'cut'],
  batch: { key: 'name', noun: 'stake' },
  exportNote: 'Seal wooden stakes with outdoor varnish before they go in the soil.',
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    { kind: 'text', key: 'name', label: 'Plant name', panel: 'right', section: 'Text', value: 'SQUASH', placeholder: 'A plant', maxLength: 18 },
    {
      kind: 'text', key: 'note', label: 'Second line', panel: 'right', section: 'Text', value: '',
      placeholder: 'Optional, e.g. sown 12 May', maxLength: 24, symbols: false,
      help: 'Engraved small on the stake, after the name.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'secular-one', recommended: HEAVY, previewFrom: 'name' },

    // ---------------------------------------------------------------- LEFT: the stake --
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Stake', value: WIDTH, min: 14, max: 25, step: 0.5, unit: 'mm',
      help: 'The letters grow with it to fill the stake’s top.',
    },
    { kind: 'number', key: 'length', label: 'Length', section: 'Stake', value: LENGTH, min: 100, max: 280, step: 5, unit: 'mm' },
    {
      kind: 'number', key: 'rail', label: 'Rail under the letters', section: 'Stake', value: RAIL_SHARE, min: 30, max: 45, step: 1, unit: '%',
      help: 'The strip the letters stand on, never under 5 mm.',
    },
    ...letteringFields('Lettering', { textCase: 'upper' }),
  ],

  async build(v) {
    const warnings: string[] = [];
    const w = num(v, 'width');
    const rail = railHeight(w, num(v, 'rail'));
    const text = applyCase(str(v, 'name'), str(v, 'textCase')).trim();
    const word = await setWord(v, text, w, rail);

    // After the word the stake is full width again, one letter-gap on. The second line starts
    // 0.4 W along the body and keeps 0.25 W clear of the point. Text too long for the length
    // asked for grows the stake rather than running into the point.
    const bodyStart = word.islands.length ? word.end + TAIL_GAP * (w - rail) : 0;
    const note = str(v, 'note').trim();
    const noteLayer = note ? await noteLayers(v, note, w, bodyStart + 0.4 * w) : [];
    const noteEnd = noteLayer.length ? bboxOf(noteLayer[0]!.shapes).maxX + 0.25 * w : 0;
    const asked = num(v, 'length');
    const len = Math.max(asked, Math.max(bodyStart + MIN_BODY * w, noteEnd) + tipLength(w));
    const ring = stakeRing(len, w, rail, bodyStart);

    if (!text) warnings.push(EMPTY_WARNING);
    if (word.dropped) warnings.push(MARKS_WARNING);
    if (word.islands.length && Math.min(word.stroke, word.foot) < MIN_STROKE) warnings.push(THIN_WARNING);
    if (len > asked + 0.5) warnings.push(grownWarning(len));
    if (len > BED) warnings.push(bedWarning(len));

    // The stake's top edge is a hard line. The name is fitted under it (`setLine`), so this only
    // catches what a letter carries above its own line and still reaches the rail by — an Å
    // whose ring touches the A — and anything under the bottom edge.
    const band: Shapes = [[[[-1, 0], [len + 1, 0], [len + 1, w], [-1, w]]]];
    const layers: DesignLayer[] = [{ id: 'stake', label: 'Stake', shapes: [[ring]], op: 'off', hugOnly: true }];
    if (word.islands.length) layers.push({ id: 'name', label: 'Plant name', kind: 'text', shapes: word.islands, glyphIslands: word.glyphIslands, op: 'off', hugOnly: true, keep: band });
    layers.push(...noteLayer);

    return {
      // The union of the stake and its letters, exactly — no border, no rounding: the lettering
      // IS the edge. Counters stay open down to the 1 mm the rest of the library keeps. The
      // bridges are a net only: every island that could float was left off above, so a bar here
      // would mean a face drew something this file has not met.
      blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', minHole: MIN_COUNTER, bridge: MIN_STROKE, bridges: 'all' },
      keyring: NO_KEYRING,
      layers,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v) => stem(str(v, 'name') || 'plant', 'stake'),
};
