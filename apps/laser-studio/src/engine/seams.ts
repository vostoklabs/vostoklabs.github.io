// The seams of a welded word: where one letter meets the next, scored so a piece cut as ONE
// outline still reads letter by letter. Worker-side and pure apart from manifold's wasm module,
// which the unions need; `buildKeychain` calls `seamPaths` for a layer with
// `op: 'score', seams: true`.
import { ringsOf, toCS, withScope } from '@vostok/laser/csg2d';
import { bboxOf, type Box, type Shapes } from '@vostok/shapes';
import { lineLength } from '@vostok/patterns/clip';
import { insideShapes } from './editorGeometry';

type Pt = [number, number];

/**
 * The seams of a welded word (G32), read the way a reader reads the piece: a stack of letters in
 * reading order, each one lying ON TOP of the letters after it. A seam is where the part of one
 * letter you can see meets the part of another you can see, and nothing else is scored.
 *
 * So a seam is a stretch of one letter's own outline that
 *   (a) lies on a LATER letter — inside it, or within `SEAM_EPS` of it;
 *   (b) is NOT under an EARLIER letter, nor within `SEAM_EPS` of one; and
 *   (c) is further than `SEAM_EPS` from the outline of the whole word, the line that is cut.
 *
 * (a) is the junction: the earlier letter's edge where the later one tucks behind it, one line
 * per join, which a reader's eye takes for the letter's own edge. "Within" because pixel and block
 * faces put letters edge to edge, and a midpoint test on a line lying exactly on another outline
 * is a coin toss — the junction came back scored for one stretch and bare for the next.
 *
 * (b) is what a letter hides. A narrow letter squeezed between two neighbours is half under the
 * one before it, and the rule this replaced, which only asked whether an edge was inside a later
 * letter, scored its edge inside the NEXT letter straight across the body of the letter on top. An
 * edge two letters share is scored once, from the earlier letter's side.
 *
 * (c) keeps the score off the cut. Two letters standing on one baseline, or reaching one x-height,
 * have feet and tops that lie ON each other — on the cut line — and the old midpoint test scored
 * them there in fragments: the L-shaped scraps along the bottom of a pixel face, the dashes along a
 * mono face's serifs. Its wider half is `SEAM_CLEAR`: a run that never gets further than that from
 * the cut is dropped whole, because what it marks is a sliver of a letter peeking out along the cut.
 *
 * A seam RUNS TO THE CUT (2026-09-22). It used to lose `SEAM_TRIM` = 0.3 mm off each end, and in
 * the cut file that read as a gap between the blue and the red at every junction. (c) stops a run
 * a hair short of the outline, so each end is carried back along its letter's outline until it
 * meets it — the cut, or the edge of the earlier letter it stops against where three letters meet
 * — and nothing is trimmed. `snapEnds` then closes the microns between the letters' own outline
 * and the plate as manifold re-drew it. On a piece with a border the letters' outline is inside
 * the plate, and that is where a seam ends: where the letters do.
 *
 * Per LETTER, and `glyphIslands` is what says where one letter ends (W3). An island is a contour
 * group, not a glyph: a stroke-built face draws Fredoka's H as three overlapping bars and its y as
 * two, Baloo's H and E as five each. Read island by island, the rule scored the junctions a letter
 * makes with ITSELF — two lines straight across the H's crossbar and one down the middle of the y,
 * three of the seven seams on "Holly". So the outline walked is the LETTER'S OWN (its islands
 * unioned, which is what a reader calls the edge of an H), and the letters it is tested against
 * are whole letters too; a sibling stroke is neither earlier nor later. Unioning matters twice
 * over: handing the strokes over separately leaves each one's buried edge in the outline, and
 * Baloo's "HE" scored its junction twice — two runs down the same line, overlapping by 2.2 mm,
 * because the H's right stem is two overlapping bars. Only manifold can do it (concatenating the
 * contours into one island cannot: `toCS` orients the largest ring CCW and every other ring CW
 * under 'Positive', so the H's second stem would be read as a hole in the first) — which is why
 * this is the engine's job and not a template's.
 *
 * A DOT is part of its letter, never a seam of its own (`lettersOf`). An i's tittle is never
 * scored against its own stem — a letter never scores itself — and a tittle that touches nothing
 * else gets nothing. `joinDots` drops a tittle onto its stem and hands it over as a glyph of its
 * own right after that stem; it is folded back into the letter here. Where a dotted letter meets
 * a neighbour the line runs on through the dot: a pixel face's tittle overhangs the l before it,
 * and a seam that stopped at the top of the i's stem ended in the middle of the material. A crumb
 * that belongs to no letter is material and nothing more.
 *
 * No `glyphIslands` (or a count that does not add up to the islands handed over): one island is
 * one glyph, so a layer built by hand behaves as it did.
 *
 * What this replaced, before the rule had a direction, was every glyph's whole outline, inset and
 * clipped to the plate. That kept a fragment of every edge that happened to lie a third of a
 * millimetre inside the border, so a four-letter name came out as a dozen scratches at no
 * particular place ("N o a h"). Nothing is inset here, nothing is clipped to the plate, and a word
 * whose letters do not touch has no seams at all — and nothing to say about it.
 *
 * It runs on every keystroke, so it is built to be cheap: two kinds of boolean — the word's
 * outline, and one union per letter drawn as more than one island — read straight off manifold as
 * rings; the rest is segment arithmetic against a grid of the edges nearby, and a letter's outline
 * is only examined where a later letter is within reach of it. Nothing is tested for
 * inside-or-outside closer than `SEAM_EPS` to the outline it is tested against, which is where a
 * point test stops meaning anything.
 *
 * `plate` is the piece as it will be cut. It is only ever used to snap the ends onto; a seam is
 * never clipped to it (the clip is what left "N o a h" as a dozen scratches).
 */
export function seamPaths(wasm: any, islands: Shapes, glyphIslands?: number[], plate?: Shapes): Pt[][] {
  if (islands.length < 2) return [];
  const letters: Letter[] = [];
  for (const members of lettersOf(islands, glyphIslands)) {
    const own = members.map((i) => islands[i]!);
    // Unioned only where its islands overlap: a floating tittle or a stencil face's split bowl is
    // already the letter's outline as it stands.
    const boxes = own.map((isl) => bboxOf([isl]));
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && boxesMeet(a, b, 0)));
    const shapes = overlap ? outlineOf(wasm, own) : own;
    if (shapes.length) letters.push({ shapes, box: bboxOf(shapes) });
  }
  // The later letters within reach of each letter. Only a letter that has one can carry a seam;
  // a word whose letters never meet stops here, with nothing to score and nothing to say.
  const reach = letters.map((l, g) => letters.flatMap((m, k) => (k > g && boxesMeet(l.box, m.box, SEAM_EPS) ? [k] : [])));
  if (reach.every((r) => !r.length)) return [];
  const edges: Edge[] = [];
  letters.forEach((l, k) => addEdges(edges, l.shapes, k));
  // The outline of the word as it is cut: every island, dots and crumbs included.
  addEdges(edges, outlineOf(wasm, islands), WORD);
  const grid = edgeGrid(edges);
  let snap: EdgeGrid | null = null;
  const out: Pt[][] = [];
  for (let g = 0; g < letters.length; g++) {
    const near = reach[g]!.map((k) => letters[k]!.box);
    if (!near.length) continue;
    for (const island of letters[g]!.shapes) {
      for (const ring of island) {
        for (const path of ringSeams(ring, g, letters, near, edges, grid)) {
          if (path.length < 2 || lineLength([], [path]) < MIN_SEAM) continue;
          if (plate?.length) {
            if (!snap) {
              const cut: Edge[] = [];
              addEdges(cut, plate, WORD);
              snap = edgeGrid(cut);
            }
            out.push(snapEnds(path, snap));
          } else out.push(path);
        }
      }
    }
  }
  return out;
}

/** How near two outlines have to come to count as meeting, mm: the tolerance of (a), (b) and (c).
 *  A font's outlines are rounded to a micron and manifold's to far less, so two edges set on
 *  each other are within a few thousandths; 0.03 mm is ten times that, and still a tenth of the
 *  kerf, so nothing a laser could tell apart is ever read as touching. */
const SEAM_EPS = 0.03;

/** Where a carried-back end counts as having met the outline, mm. */
const SEAM_TOUCH = 1e-4;

/** The furthest an end is carried back along its letter's outline, mm. (c) stops a run where it
 *  comes within `SEAM_EPS` of the cut, which is `SEAM_EPS / sin(angle)` short of where it meets
 *  it: 0.9 mm at a 2° crossing. A run that has not met anything by this far keeps its end. */
const SEAM_REACH = 3;

/** The shortest run worth burning as a seam, mm. Not a trim — a floor: under this a junction is
 *  a nick where two outlines graze, and a line a tenth of a millimetre long is a dot on the
 *  material and a stutter in the machine. */
const MIN_SEAM = 0.1;

/** How far from the cut a run has to get, somewhere along it, to be a seam at all, mm. A run that
 *  never does marks a sliver of the later letter peeking out along the cut — Playfair's cupped
 *  foot serifs sit a tenth of a millimetre apart, a mono l's tail grazes the next foot — and a
 *  score that close to the cut is not a line anyone can see: it only thickens the cut's own burn.
 *  A quarter of a millimetre is a kerf and a score line side by side. */
const SEAM_CLEAR = 0.25;

/** How far an end may be off the plate's re-tessellated outline and still be pulled onto it, mm.
 *  A carried-back end already lies on the letters' own outline, so the only distance here is
 *  manifold re-drawing the same curve for the plate — microns. Wide enough to catch that, far too
 *  narrow to move a seam that genuinely ends in the middle of the material (where three letters
 *  overlap and the run stops against a third letter's edge, not the piece's), or inside a border. */
const SEAM_SNAP = 0.05;

/** One letter: its outline (a single island as handed over, or its islands unioned), and its box. */
interface Letter { shapes: Shapes; box: Box }

/**
 * The outline manifold makes of overlapping islands — their union — as rings, one per island
 * entry. Every test here reads a letter's rings even-odd, which a union's non-crossing outers and
 * holes satisfy without being grouped into islands, so the grouping `fromCS` does — a decompose
 * and a second read of every ring, a fifth of the union's cost — is skipped.
 */
function outlineOf(wasm: any, islands: Shapes): Shapes {
  return withScope((keep) => ringsOf(toCS(wasm, islands, keep))).map((ring) => [ring]);
}

/**
 * The letters of the word, as lists of island indices in reading order.
 *
 * A glyph is a letter — except a tittle that `joinDots` dropped onto its stem, which comes over
 * as a glyph of its own right after the stem and is put back into it here: small next to that
 * letter (no side over half its tallest island), in its upper half, and over it. A glyph that is
 * nothing but crumbs (`isCrumb`) and is no letter's tittle belongs to no letter. A space (a glyph
 * with no islands) ends the letter before it, so nothing is folded across a word gap.
 */
function lettersOf(islands: Shapes, glyphIslands?: number[]): number[][] {
  const boxes = islands.map((isl) => bboxOf([isl]));
  // Measured against the tallest letter's SHORT side, so it holds at any size; per ISLAND, so an
  // i's tittle is a crumb whether or not its stem is the same glyph.
  const body = Math.max(0, ...boxes.map((b) => Math.min(b.maxX - b.minX, b.maxY - b.minY)));
  const isCrumb = (i: number) => {
    const b = boxes[i]!;
    return Math.max(b.maxX - b.minX, b.maxY - b.minY) <= 0.4 * body;
  };
  const letters: number[][] = [];
  // The letter the glyph just before this one made or joined; -1 after a space or a crumb.
  let last = -1;
  for (const group of glyphGroups(islands.length, glyphIslands)) {
    if (!group.length) { last = -1; continue; }
    const before = last >= 0 ? letters[last]! : null;
    if (before && group.every((i) => tittleOf(boxes[i]!, before.map((j) => boxes[j]!)))) {
      before.push(...group);
      continue;
    }
    if (group.every(isCrumb)) { last = -1; continue; }
    last = letters.push([...group]) - 1;
  }
  return letters;
}

/** Whether an island with box `b` is a tittle of the letter whose islands have `boxes`. */
function tittleOf(b: Box, boxes: Box[]): boolean {
  const tallest = Math.max(...boxes.map((o) => o.maxY - o.minY));
  const minX = Math.min(...boxes.map((o) => o.minX));
  const maxX = Math.max(...boxes.map((o) => o.maxX));
  const minY = Math.min(...boxes.map((o) => o.minY));
  const maxY = Math.max(...boxes.map((o) => o.maxY));
  return Math.max(b.maxX - b.minX, b.maxY - b.minY) <= 0.5 * tallest
    && (b.minY + b.maxY) / 2 >= (minY + maxY) / 2
    && b.minX < maxX && b.maxX > minX;
}

/** The island indices of each glyph, in reading order. A `counts` that does not account for
 *  every island is not trusted — a layer whose shapes were rebuilt since `textLayer` set it
 *  falls back to one island per glyph rather than grouping by a stale tally. */
function glyphGroups(total: number, counts?: number[]): number[][] {
  if (counts && counts.reduce((a, b) => a + b, 0) === total) {
    const out: number[][] = [];
    let at = 0;
    for (const n of counts) {
      out.push(Array.from({ length: n }, (_, k) => at + k));
      at += n;
    }
    return out;
  }
  return Array.from({ length: total }, (_, i) => [i]);
}

// ------------------------------------------------------------------ the walk round one ring --

/** The owner of an edge of the word's own outline; a letter's edges carry its index. */
const WORD = -1;

/** One edge of an outline, with its box and whose outline it is. */
interface Edge { c: Pt; d: Pt; minX: number; minY: number; maxX: number; maxY: number; owner: number }

/** A stretch of a ring between two consecutive breakpoints: everything the rule asks is constant
 *  along it. `near*` = within `SEAM_EPS` of a later letter, an earlier letter, the word's outline;
 *  `in*` = inside a later / an earlier letter (asked only where the matching `near*` is false).
 *  A whole segment out of reach of every later letter is one piece with all of it false. */
interface Piece {
  seg: number; t0: number; t1: number;
  nearL: boolean; nearE: boolean; nearU: boolean; inL: boolean; inE: boolean;
  seam: boolean; far: boolean;
}

/**
 * The seams on one ring of letter `g`'s outline, as open runs (or the closed ring itself, for a
 * letter a later one swallows whole). `near` is the boxes of the later letters within its reach.
 *
 * Every segment is cut where it enters or leaves the `SEAM_EPS` band round any nearby edge, so
 * each piece is wholly near an outline or wholly clear of it. A piece clear of every later
 * letter's outline is wholly inside one or wholly outside all of them, and that is asked once per
 * such stretch, at a point a full `SEAM_EPS` from any edge it could be confused with.
 */
function ringSeams(raw: Pt[], g: number, letters: Letter[], near: Box[], edges: Edge[], grid: EdgeGrid): Pt[][] {
  const ring = compact(raw);
  const n = ring.length;
  if (n < 3) return [];
  const pieces: Piece[] = [];
  const hits: number[] = [];
  const spans: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const minX = Math.min(a[0], b[0]) - SEAM_EPS;
    const minY = Math.min(a[1], b[1]) - SEAM_EPS;
    const maxX = Math.max(a[0], b[0]) + SEAM_EPS;
    const maxY = Math.max(a[1], b[1]) + SEAM_EPS;
    // Nowhere near a later letter: nothing on this segment can be a seam, or carry one.
    if (!near.some((o) => o.minX <= maxX && o.maxX >= minX && o.minY <= maxY && o.maxY >= minY)) {
      pieces.push({ seg: i, t0: 0, t1: 1, nearL: false, nearE: false, nearU: false, inL: false, inE: false, seam: false, far: true });
      continue;
    }
    grid.query(minX, minY, maxX, maxY, hits);
    // [kind, lo, hi] triples; kind 0 = a later letter, 1 = an earlier one, 2 = the word.
    spans.length = 0;
    const cuts = [0, 1];
    for (const e of hits) {
      const edge = edges[e]!;
      if (edge.owner === g || !nearSpan(a, b, edge.c, edge.d, SEAM_EPS)) continue;
      spans.push(edge.owner === WORD ? 2 : edge.owner > g ? 0 : 1, SPAN[0]!, SPAN[1]!);
      cuts.push(SPAN[0]!, SPAN[1]!);
    }
    cuts.sort((x, y) => x - y);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t0 = 0;
    for (let k = 1; k < cuts.length; k++) {
      const t1 = k === cuts.length - 1 ? 1 : cuts[k]!;
      if ((t1 - t0) * len < 1e-9) continue;
      const m = (t0 + t1) / 2;
      let nearL = false;
      let nearE = false;
      let nearU = false;
      for (let s = 0; s < spans.length; s += 3) {
        if (m < spans[s + 1]! || m > spans[s + 2]!) continue;
        const kind = spans[s]!;
        if (kind === 0) nearL = true;
        else if (kind === 1) nearE = true;
        else nearU = true;
      }
      pieces.push({ seg: i, t0, t1, nearL, nearE, nearU, inL: false, inE: false, seam: false, far: false });
      t0 = t1;
    }
  }
  const m = pieces.length;
  // Inside or not, once per stretch that stays clear of the outlines asked about: it cannot cross
  // one without coming near it first. A segment skipped as out of reach was not watched, so the
  // stretch after it is asked afresh. The earlier letters are only asked about where the answer
  // decides anything.
  let inL: boolean | null = null;
  let inE: boolean | null = null;
  for (const p of pieces) {
    if (p.far) { inL = null; inE = null; continue; }
    const at = pointAt(ring, p.seg + (p.t0 + p.t1) / 2);
    if (p.nearL) inL = null;
    else p.inL = inL ??= insideAny(letters, g + 1, letters.length, at);
    if (p.nearE) inE = null;
    else if ((p.nearL || p.inL) && !p.nearU) p.inE = inE ??= insideAny(letters, 0, g, at);
    p.seam = (p.nearL || p.inL) && !p.nearE && !p.inE && !p.nearU;
  }
  if (!pieces.some((p) => p.seam)) return [];
  // A ring a later letter covers end to end is still one seam, and a closed ring has no ends to
  // carry anywhere.
  if (pieces.every((p) => p.seam)) return [[...ring, ring[0]!]];
  const start = pieces.findIndex((p) => !p.seam);
  const runs: Pt[][] = [];
  let from = -1;
  for (let k = 1; k <= m; k++) {
    const p = pieces[(start + k) % m]!;
    if (p.seam && from < 0) from = k;
    if (p.seam || from < 0) continue;
    // The run is pieces `from` … `k − 1` after `start`. A sliver along the cut is no seam; a run
    // that is one has both ends carried to the outline they stop short of.
    const own: Piece[] = [];
    for (let j = from; j < k; j++) own.push(pieces[(start + j) % m]!);
    if (!own.some((q) => clearOfCut(ring, q, edges, grid))) { from = -1; continue; }
    const first = own[0]!;
    const last = own[own.length - 1]!;
    let u0 = first.seg + first.t0;
    let u1 = last.seg + last.t1;
    if (u1 < u0) u1 += n;
    const back = carry(ring, pieces, start + from, -1, g, edges, grid);
    const ahead = carry(ring, pieces, start + k - 1, +1, g, edges, grid);
    if (back !== null) u0 = back;
    if (ahead !== null) u1 = ahead;
    while (u1 <= u0) u1 += n;
    runs.push(along(ring, u0, Math.min(u1, u0 + n)));
    from = -1;
  }
  return runs;
}

/**
 * Where the end of a run really meets the outline it stopped short of: walk on from piece `at`
 * in direction `dir` along the ring, through pieces still on a later letter, to the first point
 * within `SEAM_TOUCH` of the word's outline or an earlier letter's. Null when the walk leaves the
 * later letters, runs into another seam, or goes `SEAM_REACH` without meeting anything — the end
 * then stays where (b) or (c) put it, within `SEAM_EPS` of what it was about to meet.
 *
 * The answer is a position along the ring: segment index plus the fraction along it. It may run
 * below zero or past the ring's length; `along` reads it modulo the ring.
 */
function carry(ring: Pt[], pieces: Piece[], at: number, dir: 1 | -1, g: number, edges: Edge[], grid: EdgeGrid): number | null {
  const m = pieces.length;
  const n = ring.length;
  const hits: number[] = [];
  let walked = 0;
  // Which lap of the ring the walk is on, so the position keeps counting past the wrap.
  let lap = 0;
  let prevSeg = pieces[((at % m) + m) % m]!.seg;
  for (let step = 1; step < m && walked <= SEAM_REACH; step++) {
    const p = pieces[(((at + dir * step) % m) + m) % m]!;
    if (dir > 0 && p.seg < prevSeg) lap += n;
    if (dir < 0 && p.seg > prevSeg) lap -= n;
    prevSeg = p.seg;
    if (p.seam || !(p.nearL || p.inL)) return null;
    const a = ring[p.seg]!;
    const b = ring[(p.seg + 1) % n]!;
    const pa = lerp(a, b, p.t0);
    const pb = lerp(a, b, p.t1);
    grid.query(Math.min(pa[0], pb[0]) - SEAM_TOUCH, Math.min(pa[1], pb[1]) - SEAM_TOUCH, Math.max(pa[0], pb[0]) + SEAM_TOUCH, Math.max(pa[1], pb[1]) + SEAM_TOUCH, hits);
    let hit: number | null = null;
    for (const e of hits) {
      const edge = edges[e]!;
      if (edge.owner !== WORD && !(edge.owner >= 0 && edge.owner < g)) continue;
      if (!nearSpan(a, b, edge.c, edge.d, SEAM_TOUCH)) continue;
      const lo = Math.max(SPAN[0]!, p.t0);
      const hi = Math.min(SPAN[1]!, p.t1);
      if (lo > hi) continue;
      // The first contact in the direction of the walk.
      const t = dir > 0 ? lo : hi;
      if (hit === null || (dir > 0 ? t < hit : t > hit)) hit = t;
    }
    if (hit !== null) return lap + p.seg + hit;
    walked += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  }
  return null;
}

/** Whether some part of piece `p` lies further than `SEAM_CLEAR` from the cut: the spans of it
 *  within that distance of the word's outline, laid end to end, leave a gap. */
function clearOfCut(ring: Pt[], p: Piece, edges: Edge[], grid: EdgeGrid): boolean {
  const a = ring[p.seg]!;
  const b = ring[(p.seg + 1) % ring.length]!;
  const pa = lerp(a, b, p.t0);
  const pb = lerp(a, b, p.t1);
  const hits: number[] = [];
  grid.query(Math.min(pa[0], pb[0]) - SEAM_CLEAR, Math.min(pa[1], pb[1]) - SEAM_CLEAR, Math.max(pa[0], pb[0]) + SEAM_CLEAR, Math.max(pa[1], pb[1]) + SEAM_CLEAR, hits);
  const spans: [number, number][] = [];
  for (const e of hits) {
    const edge = edges[e]!;
    if (edge.owner === WORD && nearSpan(a, b, edge.c, edge.d, SEAM_CLEAR)) spans.push([SPAN[0]!, SPAN[1]!]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let covered = p.t0;
  for (const [lo, hi] of spans) {
    if (lo > covered) return true;
    covered = Math.max(covered, hi);
    if (covered >= p.t1) return false;
  }
  return covered < p.t1;
}

/** The ring from position `u0` to `u1` (segment index plus fraction, read modulo the ring). */
function along(ring: Pt[], u0: number, u1: number): Pt[] {
  const n = ring.length;
  const out: Pt[] = [pointAt(ring, u0)];
  for (let v = Math.floor(u0) + 1; v < u1; v++) out.push(ring[((v % n) + n) % n]!);
  out.push(pointAt(ring, u1));
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1]![0], p[1] - out[i - 1]![1]) > 1e-9);
}

function pointAt(ring: Pt[], u: number): Pt {
  const n = ring.length;
  const i = Math.floor(u);
  const a = ring[((i % n) + n) % n]!;
  const b = ring[(((i + 1) % n) + n) % n]!;
  return lerp(a, b, u - i);
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Inside any of letters `from` … `to − 1`. */
function insideAny(letters: Letter[], from: number, to: number, p: Pt): boolean {
  for (let k = from; k < to; k++) {
    const l = letters[k]!;
    if (p[0] < l.box.minX || p[0] > l.box.maxX || p[1] < l.box.minY || p[1] > l.box.maxY) continue;
    if (insideShapes(l.shapes, p)) return true;
  }
  return false;
}

/** Where `nearSpan` leaves its answer: the hot loop asks it for every nearby edge of every
 *  segment, and a fresh pair per call is most of what the walk would allocate. */
const SPAN = new Float64Array(2);

/**
 * The part of segment a→b (as fractions t ∈ [0, 1] along it) lying within `r` of segment c→d,
 * into `SPAN`; false when there is none. The points within `r` of a segment make a capsule, which
 * is convex, so a line meets it in ONE interval: the hull of where it meets the two end discs and
 * the band between them.
 */
function nearSpan(a: Pt, b: Pt, c: Pt, d: Pt, r: number): boolean {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const vv = vx * vx + vy * vy;
  if (vv < 1e-24) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let end = 0; end < 2; end++) {
    const q = end ? d : c;
    const wx = a[0] - q[0];
    const wy = a[1] - q[1];
    const half = wx * vx + wy * vy;
    const disc = half * half - vv * (wx * wx + wy * wy - r * r);
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    lo = Math.min(lo, (-half - root) / vv);
    hi = Math.max(hi, (-half + root) / vv);
  }
  const ux = d[0] - c[0];
  const uy = d[1] - c[1];
  const uu = ux * ux + uy * uy;
  if (uu > 1e-24) {
    const ax = a[0] - c[0];
    const ay = a[1] - c[1];
    const ul = Math.sqrt(uu);
    // Along c→d (0 … 1) and across it (−r … r), both linear in t: the band is where both hold.
    let tl = -Infinity;
    let th = Infinity;
    for (let side = 0; side < 2; side++) {
      const k0 = side ? (ux * ay - uy * ax) / ul : (ax * ux + ay * uy) / uu;
      const k1 = side ? (ux * vy - uy * vx) / ul : (vx * ux + vy * uy) / uu;
      const min = side ? -r : 0;
      const max = side ? r : 1;
      if (Math.abs(k1) < 1e-15) {
        if (k0 < min || k0 > max) { tl = Infinity; th = -Infinity; }
        continue;
      }
      const x = (min - k0) / k1;
      const y = (max - k0) / k1;
      tl = Math.max(tl, Math.min(x, y));
      th = Math.min(th, Math.max(x, y));
    }
    if (tl <= th) {
      lo = Math.min(lo, tl);
      hi = Math.max(hi, th);
    }
  }
  lo = Math.max(lo, 0);
  hi = Math.min(hi, 1);
  if (lo > hi) return false;
  SPAN[0] = lo;
  SPAN[1] = hi;
  return true;
}

function boxesMeet(a: Box, b: Box, pad: number): boolean {
  return a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;
}

function addEdges(out: Edge[], shapes: Shapes, owner: number): void {
  for (const island of shapes) {
    for (const raw of island) {
      const ring = compact(raw);
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i]!;
        const d = ring[(i + 1) % ring.length]!;
        out.push({ c, d, minX: Math.min(c[0], d[0]), minY: Math.min(c[1], d[1]), maxX: Math.max(c[0], d[0]), maxY: Math.max(c[1], d[1]), owner });
      }
    }
  }
}

/** The ring with its zero-length steps (and a closing copy of the first point) removed: a step of
 *  no length has no direction to measure along. */
function compact(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (q && Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0]![0] - out[out.length - 1]![0]) < 1e-9 && Math.abs(out[0]![1] - out[out.length - 1]![1]) < 1e-9) out.pop();
  return out;
}

/** Every edge whose box meets a query box, by a uniform grid — a word's outlines are a few
 *  thousand edges, and each segment of a letter is only ever near a handful of them. */
interface EdgeGrid {
  edges: Edge[];
  query(minX: number, minY: number, maxX: number, maxY: number, out: number[]): void;
}

const GRID_CELL = 1.5;

function edgeGrid(edges: Edge[]): EdgeGrid {
  const cells = new Map<number, number[]>();
  const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
  edges.forEach((e, i) => {
    for (let x = Math.floor(e.minX / GRID_CELL); x <= Math.floor(e.maxX / GRID_CELL); x++) {
      for (let y = Math.floor(e.minY / GRID_CELL); y <= Math.floor(e.maxY / GRID_CELL); y++) {
        const k = key(x, y);
        const cell = cells.get(k);
        if (cell) cell.push(i);
        else cells.set(k, [i]);
      }
    }
  });
  const seen = new Int32Array(edges.length);
  let stamp = 0;
  return {
    edges,
    query(minX, minY, maxX, maxY, out) {
      out.length = 0;
      stamp++;
      for (let x = Math.floor(minX / GRID_CELL); x <= Math.floor(maxX / GRID_CELL); x++) {
        for (let y = Math.floor(minY / GRID_CELL); y <= Math.floor(maxY / GRID_CELL); y++) {
          const cell = cells.get(key(x, y));
          if (!cell) continue;
          for (const i of cell) {
            if (seen[i] === stamp) continue;
            seen[i] = stamp;
            const e = edges[i]!;
            if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
            out.push(i);
          }
        }
      }
    },
  };
}

/** The polyline with each END moved onto the nearest point of the cut outline, when it is already
 *  within `SEAM_SNAP` of it. Nothing is shortened and nothing in between is touched: this only
 *  closes the micron the boolean's re-tessellation opened, so blue meets red. The cut is EVERY
 *  ring of the plate, not just the outer one: a letter buried by the next one can end its run on
 *  the edge of a counter — the inside of an o — and that ring is cut red too. */
function snapEnds(path: Pt[], cut: EdgeGrid): Pt[] {
  const out = [...path];
  const hits: number[] = [];
  for (const at of [0, out.length - 1]) {
    const p = out[at]!;
    cut.query(p[0] - SEAM_SNAP, p[1] - SEAM_SNAP, p[0] + SEAM_SNAP, p[1] + SEAM_SNAP, hits);
    let best: Pt | null = null;
    let d = SEAM_SNAP;
    for (const e of hits) {
      const { c: a, d: b } = cut.edges[e]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      const q: Pt = [a[0] + t * dx, a[1] + t * dy];
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd < d) { d = dd; best = q; }
    }
    if (best) out[at] = best;
  }
  return out;
}
