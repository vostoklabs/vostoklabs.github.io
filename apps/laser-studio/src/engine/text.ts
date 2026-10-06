// Text and symbols → design layers, in millimetres. The same font pipeline the name keychain
// uses (@vostok/fonts contours → islands), with the knobs a template
// is likely to expose.
import { buildSymbol } from '@vostok/laser';
import { FALLBACK_FONT_ID, getFont, getHorizontalContours, getVerticalContours, pathCommandsToPolygons } from '@vostok/fonts';
import { bboxOf, centreShapes, islandsFromContours, placeShapes, pointInRing, type Box, type Shapes } from '@vostok/shapes';
import { withSymbols, symbolIslands, type SymbolMap } from '../symbols/model';
import { unionIndex, unionOutlineDistance, type UnionIndex } from './editorGeometry';
import type { DesignLayer, OpChoice } from './types';

/**
 * How a word is made into ONE body: the letters' own union, not a hug with a margin (G31/G32).
 *
 * Two faces of one idea. A connecting script already writes as a single connected line, so all
 * it wants is a hairline of bold — `overlap` 0 leaves the font's own advances exactly as the
 * type designer drew them. A block face does not connect at all, so each letter is walked left
 * until it is buried `overlap` mm in the one before it; the cut is their union and the score is
 * the buried edges (weld-and-score).
 */
export interface ConnectSpec {
  /** Bold added to every glyph before the weld, mm — a fatter letter, NOT a border round the
   *  word. Default 0.012 × size: about a hairline at any size. */
  thicken?: number;
  /** How deep each letter must bury itself in the letter before it, mm. 0 (a connecting script)
   *  leaves the layout alone; `shared.ts`'s `connectSpec()` picks the number by face. */
  overlap?: number;
  /** For a face that JOINS on its own (a connecting script, `overlap` 0): how deep a letter that
   *  does not touch the one before it at all is walked into it, mm. Every letter the type
   *  designer already joined stays exactly where it was drawn — this only ever moves a letter
   *  standing clear, like Pacifico's P, which never reaches the a after it. Without it "Paisley"
   *  cut as a P plus the rest of the word. */
  joinLoose?: number;
  /** The narrowest a counter — the hole in an a, an e, an o — may be left after `thicken`, mm.
   *  The thicken is reduced until every counter still measures this across; 0 turns the floor
   *  off. Default `MIN_COUNTER`. */
  minCounter?: number;
}

export interface TextSpec {
  text: string;
  symbols?: SymbolMap;
  line2?: string;
  font: string;
  /** Letter height, mm. */
  size: number;
  letterSpacing?: number;
  lineSpacing?: number;
  /** Grow every outline by this many mm (bold) — applied by the engine. */
  boldness?: number;
  line2Scale?: number;
  /** The second line in its OWN face — a pet's name in a display face over "Breakfast · Dinner"
   *  in a plain sans, a luggage tag's name over its contact lines. Absent: `font` sets both. */
  line2Font?: string;
  layout?: 'horizontal' | 'vertical';
  align?: 'left' | 'center' | 'right';
  x?: number;
  y?: number;
  rotation?: number;
  /** Set the text as ONE connected body: the glyphs come back as separate islands in reading
   *  order, welded by overlap where the face needs it. Horizontal layout only. */
  connect?: ConnectSpec;
}

/** Text as one layer, centred, then placed. Empty text gives nothing. */
export async function textLayer(spec: TextSpec, op: OpChoice, id = 'design', label = 'Text'): Promise<DesignLayer[]> {
  const text = spec.text ?? '';
  const line2 = spec.line2 ?? '';
  if (!text.trim() && !line2.trim()) return [];
  if (spec.connect && spec.layout !== 'vertical') return connectedLayer(spec, op, id, label);
  // A second line in its own face cannot go through `getHorizontalContours`: that layout holds ONE
  // font for the whole block. `connectedLayer` already sets each line separately and stacks them
  // at the same two baselines, and with no `connect` on the spec it welds nothing and thickens
  // nothing — so it is the two-face path too.
  if (spec.line2Font && spec.line2Font !== spec.font && line2.trim() && spec.layout !== 'vertical') return connectedLayer(spec, op, id, label);
  const [baseFont, baseFallback] = await Promise.all([getFont(spec.font), getFont(FALLBACK_FONT_ID).catch(() => null)]);
  const font = withSymbols(baseFont, spec.symbols ?? {});
  const fallback = baseFallback ? withSymbols(baseFallback, spec.symbols ?? {}) : null;
  const lineSpacing = spec.lineSpacing ?? 1;
  const tracking = spec.letterSpacing ?? 0;
  const layout =
    spec.layout === 'vertical'
      ? getVerticalContours(font, fallback, text, spec.size, lineSpacing, tracking)
      : getHorizontalContours(font, fallback, text, line2, spec.size, spec.size * (spec.line2Scale ?? 0.7), 0, spec.align ?? 'center', lineSpacing * 0.55, tracking, {
          alignMode: 'block',
        });
  // Layout moves these contours, but must not change which glyph owns a hole.
  // Symbols already carry explicit islands (including ink inside holes).
  let offset = 0;
  const islands: Shapes = [];
  // How many islands each character owns, in reading order (W3). A glyph is not one island —
  // Fredoka's H is three strokes — and the seam clip has no other way to tell a junction between
  // two letters from a junction inside one.
  const glyphIslands: number[] = [];
  const chars = Array.from(spec.layout === 'vertical' ? text : text + line2);
  for (const char of chars) {
    let glyph = font.charToGlyph(char);
    if ((!glyph || glyph.index === 0) && fallback) {
      const candidate = fallback.charToGlyph(char);
      if (candidate && candidate.index !== 0) glyph = candidate;
    }
    const count = pathCommandsToPolygons(glyph.getPath(0, 0, spec.size).commands).length;
    const contours = layout.contours.slice(offset, offset + count);
    offset += count;
    const symbol = spec.symbols?.[char];
    const before = islands.length;
    if (symbol) {
      islands.push(...symbolIslands([contours as Shapes[number]]));
    } else islands.push(...islandsFromContours(contours));
    glyphIslands.push(islands.length - before);
  }
  const shapes = centreShapes(islands).shapes;
  return [{ id, label, kind: 'text', shapes: placeShapes(shapes, spec.x ?? 0, spec.y ?? 0, spec.rotation ?? 0), op, glyphIslands, ...(spec.boldness ? { grow: spec.boldness } : {}) }];
}

/** A symbol from the icon font, `size` mm tall, centred at (x, y). */
export async function symbolLayer(char: string, size: number, op: OpChoice, at: { x?: number; y?: number; rotation?: number; symbols?: SymbolMap } = {}, id = 'design'): Promise<DesignLayer[]> {
  if (!char) return [];
  const asset = at.symbols?.[char];
  const shapes = asset ? symbolIslands(asset.shapes).map(i=>i.map(r=>r.map(([x,y])=>[x*size,y*size] as [number,number]))) : await buildSymbol(char, size);
  if (!shapes.length) return [];
  return [{ id, label: 'Symbol', kind: 'symbol', shapes: placeShapes(shapes, at.x ?? 0, at.y ?? 0, at.rotation ?? 0), op }];
}

// ------------------------------------------------------------------ one glyph at a time --

/**
 * One laid-out character in the layout frame: the pen runs along y = 0 (the baseline) starting
 * at x = 0, exactly as `layoutLine` in @vostok/fonts does it, so a run built here and a run
 * built by `textLayer` put their ink in the same places.
 */
interface GlyphRun {
  char: string;
  shapes: Shapes;
  /** Step to the next pen position, mm: the glyph's advance plus its kerning and tracking. */
  advance: number;
  penX: number;
}

/**
 * The single-line horizontal layout `textLayer` uses, kept per character instead of merged.
 *
 * It is a deliberate re-walk of `layoutLine` (kerning, tracking, the fallback face, the symbol
 * override) rather than a slice of `getHorizontalContours`' output, because what a tile, a
 * puzzle piece or an arc needs is the thing that layout throws away: where each glyph's pen sat
 * and how wide its cell was.
 */
async function layoutGlyphRun(spec: TextSpec): Promise<GlyphRun[]> {
  const text = spec.text ?? '';
  if (!text) return [];
  const [baseFont, baseFallback] = await Promise.all([getFont(spec.font), getFont(FALLBACK_FONT_ID).catch(() => null)]);
  const font = withSymbols(baseFont, spec.symbols ?? {});
  const fallback = baseFallback ? withSymbols(baseFallback, spec.symbols ?? {}) : null;
  const size = spec.size;
  const scale = size / font.unitsPerEm;
  const fallbackScale = fallback ? size / fallback.unitsPerEm : scale;
  const track = (spec.letterSpacing ?? 0) * size;
  const chars = Array.from(text);
  const out: GlyphRun[] = [];
  let penX = 0;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    let glyph = font.charToGlyph(char);
    let isFallback = false;
    if ((!glyph || glyph.index === 0) && fallback) {
      const candidate = fallback.charToGlyph(char);
      if (candidate && candidate.index !== 0) {
        glyph = candidate;
        isFallback = true;
      }
    }
    // Laid out at the pen, not at zero and shifted: `pathCommandsToPolygons` rounds to three
    // decimals, and rounding before a shift lands a micron off rounding after it.
    const contours = pathCommandsToPolygons(glyph.getPath(penX, 0, size).commands);
    const symbol = spec.symbols?.[char];
    const shapes = symbol ? symbolIslands([contours as Shapes[number]]) : islandsFromContours(contours);
    let advance = (glyph.advanceWidth || 0) * (isFallback ? fallbackScale : scale);
    if (i < chars.length - 1 && !isFallback) {
      const next = font.charToGlyph(chars[i + 1]!);
      if (next && next.index !== 0 && font.getKerningValue) advance += font.getKerningValue(glyph, next) * scale;
    }
    advance += track;
    out.push({ char, shapes, advance, penX });
    penX += advance;
  }
  return out;
}

export interface GlyphLayer {
  char: string;
  /** This character's islands, in their absolute positions inside the centred block. */
  shapes: Shapes;
  /** Advance to the next character, mm — kerning and letter spacing included. */
  advance: number;
  /** The character's ink box. A character with no ink (a space) gets its advance box instead. */
  box: Box;
}

/**
 * The same single-line layout `textLayer` produces, handed back one character at a time.
 *
 * The block is centred on the origin exactly as `textLayer` centres it, so the union of these
 * entries' shapes has the same bounding box as `textLayer`'s single layer — a caller can cut one
 * piece per letter, put each letter on a tile, or re-place them on an arc, and the un-warped
 * design still measures the same. Spaces come back as an entry with no shapes, because a word
 * game and a puzzle both need to know the gap is there.
 */
export async function glyphLayers(spec: TextSpec): Promise<GlyphLayer[]> {
  // `connect` welds the run here too, so a design that lays its own glyphs out — a set of place
  // cards, a row of a family tree — gets the same welded word and the same reading-order islands
  // as `textLayer` does, with its per-glyph boxes and baselines measured AFTER the weld.
  const run = weldRun(await layoutGlyphRun(spec), weldDepth(spec.connect), (spec.letterSpacing ?? 0) * spec.size, looseOnly(spec.connect));
  if (!run.length) return [];
  const ink = run.flatMap((g) => g.shapes);
  const b = ink.length ? bboxOf(ink) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const dx = -(b.minX + b.maxX) / 2;
  const dy = -(b.minY + b.maxY) / 2;
  const x = spec.x ?? 0;
  const y = spec.y ?? 0;
  const rotation = spec.rotation ?? 0;
  const place = (shapes: Shapes) => placeShapes(shapes.map((isl) => isl.map((r) => r.map(([px, py]) => [px + dx, py + dy] as [number, number]))), x, y, rotation);
  return run.map((g) => {
    const shapes = place(g.shapes);
    const box = shapes.length ? bboxOf(shapes) : bboxOf(place([[[[g.penX, 0], [g.penX + g.advance, 0]]]]));
    return { char: g.char, shapes, advance: g.advance, box };
  });
}

// ------------------------------------------------------------------ the welded word --

/** How far a letter is moved per try in the overlap walk, mm. Coarse enough that a long name is
 *  a few hundred point tests rather than a few thousand; the step that first reaches the depth
 *  asked for is then bisected, so the coarseness never reaches the geometry. */
const WELD_STEP = 0.25;

/**
 * How far a letter may be BURIED in the one before it, as a share of its own advance.
 *
 * 0.4, down from the 0.6 the first cut of G32 used: the number that stands between "letters
 * overlap a little" and a letter shoved half-way through its neighbour. The walk reaches for it
 * whenever the letter behind is too thin to bite into (an "o" beside an "l"), because there the
 * fallback takes the deepest bite it found, which is the cap. At 0.6 that put an o a stem and a
 * half into an l; at 0.4 the pair still welds and still reads as two letters.
 *
 * Buried, not travelled — and that distinction is the whole of it. The walk has to close the
 * font's own sidebearings BEFORE it buries anything, and a narrow letter's sidebearings are wide
 * next to its advance: an "i" in Fredoka advances 6.7 mm at a 30 mm size and stands 3 mm clear of
 * its neighbour, so a cap on the TRAVEL of 0.4 × 6.7 never reached the letter behind at all.
 * "Olivia" in Fredoka came back in five pieces with four joining bars invented to hold them
 * together. So the cap is the gap plus this share.
 *
 * Since W2 it is the REACH and no longer the burial: how far a letter may hunt for its neighbour
 * before it gives up and is bridged. How much of that hunt may end up inside the neighbour is
 * `MIN_BODY`'s question, and an advance was always the wrong ruler for it.
 */
const WELD_CAP = 0.4;

/**
 * A bite this deep is already a weld, mm: the letters are not moved at all.
 *
 * The reference's rule is "where two glyphs already touch at natural advance, no move" — and
 * "touch" has to be a number, because a face whose letters graze each other by a hundredth of a
 * millimetre is not welded, it is tangent. 0.6 mm is the floor `weldOverlap` itself uses: the
 * shallowest bite that survives kerf and a wandering focus in 3 mm stock.
 */
const WELD_FLOOR = 0.6;

/**
 * The band of its OWN ink every letter keeps bare, mm — the rule that stands between a weld and
 * a buried letter (W2).
 *
 * The seam trim is 0.3 mm each end and a person needs about a millimetre of material to read a
 * stroke as a stroke, so 1.5 mm is the narrowest band of a letter that still says which letter it
 * is. It is the number that was missing: the walk capped the burial by the letter's ADVANCE
 * (`WELD_CAP`), and a narrow capital's advance says nothing about how much ink it has to lose.
 * A Fredoka "I" at a 20 mm size is 1.8 mm of ink inside a 4.4 mm advance, so 0.4 × advance let
 * the S bite 0.61 mm off its left and the E another 0.61 mm off its right: 0.58 mm of stem left
 * between two stems flush against it, and "ELSIE" cut out as ELSE with the I surviving as a
 * scored seam.
 *
 * Both neighbours are charged against the same band, so the budget is HALVED and spent from the
 * narrower letter of each pair: a weld may bury `(min(inkWidth) − 1.5) / 2` mm past first
 * contact, never more than `WELD_BODY_SHARE` of that same width. The letter behind has already
 * spent at most its own half, so whatever the pair does, every letter comes out of the walk with
 * ≥ 1.5 mm of ink no neighbour covers. That I now keeps 1.5 mm of its 1.8 (0.15 mm a side), the
 * Fredoka "i" of "Paisley" at 30 mm keeps 1.5 of its 3.1 and still bites 0.65 mm — above the
 * 0.6 mm weld floor — and nothing 5 mm wide or more is touched by the rule at all.
 */
const MIN_BODY = 1.5;

/** And never more than a third of the narrower letter of the pair, however wide the pair is: the
 *  guard that keeps a big size's deep bite (`0.03 × size`) from eating a letter whose ink happens
 *  to be slim. Binding above ~5 mm of ink, where the halved body budget is the looser of the two. */
const WELD_BODY_SHARE = 0.35;

/** A bite this shallow is where the two letters first TOUCH, mm — the point the burial is
 *  measured from. Small enough to be contact rather than a weld, large enough that a vertex
 *  grazing an outline is not mistaken for one. */
const WELD_CONTACT = 0.02;

/** The narrowest a counter — the hole in an a, an e, an o — may be left once the glyphs are
 *  thickened, mm. Under this a laser's kerf closes it and an "a" prints as a blob. */
export const MIN_COUNTER = 1;

/** How far apart the walk probes a glyph's outline BETWEEN its vertices, mm — the walk's own step.
 *  Only an edge longer than this gets points of its own: a curve is already drawn in short
 *  steps, and its vertices sample it as finely as this would. */
const PROBE_STEP = 0.25;

/**
 * Every point of a glyph's outline the walk tests, flat — `[x0, y0, x1, y1, …]`: each vertex, and
 * points every `PROBE_STEP` along any edge longer than that. Made once per glyph per walk.
 *
 * Vertices alone were blind to the commonest junction in a block or pixel face: two stems side
 * by side, the same height. A stem's only vertices are its corners, and those sit ON the
 * neighbour's cap line and baseline — inside by nothing, depth 0 — so the walk read "not touching
 * yet" with the stems a millimetre deep in each other, and kept walking until some vertex in the
 * middle of a letter, the corner where an N's diagonal leaves its stem, finally got in: Bebas
 * "MINNIE" bit 3.9 mm where 0.9 was asked, Press Start 2P's "ll" 8.4 mm. Where no such vertex ever
 * got in, the pair never registered contact and was left standing apart — Bebas's M and I, Anton's
 * "Olivia" either side of its v. The middle of the stem's edge is where the depth is, so the middle
 * of the edge is probed.
 */
function probePoints(shapes: Shapes): Float64Array {
  const out: number[] = [];
  for (const island of shapes) {
    for (const ring of island) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[(i + 1) % ring.length]!;
        out.push(ax, ay);
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / PROBE_STEP);
        for (let k = 1; k < steps; k++) out.push(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
      }
    }
  }
  return Float64Array.from(out);
}

/** One glyph as the walk measures it, made once per walk: its islands, the points of its outline
 *  it is probed at (`probePoints`), its union indexed (`unionIndex`), its box, and whether its
 *  islands stand apart (`islandsApart`). */
interface Measured {
  shapes: Shapes;
  probe: Float64Array;
  union: UnionIndex;
  box: Box;
  apart: boolean;
}

function measured(shapes: Shapes): Measured {
  return { shapes, probe: probePoints(shapes), union: unionIndex(shapes), box: bboxOf(shapes), apart: islandsApart(shapes) };
}

/**
 * The deepest any of `probe`'s points, moved `dx` mm along x, lies INSIDE `target`, or `floor` if
 * none lies deeper — 0 when the two do not overlap at all.
 *
 * `insideUnion` / `unionOutlineDistance` rather than the even-odd pair: a glyph drawn as several
 * overlapping contours (Playfair's R is a bowl, a stem and a leg) reads as a hole where they
 * cross under even-odd, and the seam between two of its own contours is not an edge to measure
 * to. Nothing is allocated but the point asked about — the offset is applied to the probe point,
 * not to the outline — so the walk costs point tests and no geometry.
 *
 * Where the target's islands overlap, the depth is also held to the union's own reach along the
 * axes (`UnionIndex.exit`): `unionOutlineDistance` skips an edge whose nearest point is buried in
 * another island, and on a stroke-built face whose strokes share outlines that read a point just
 * inside Baloo's n as 2.4 mm deep — the walk stopped at first contact, the letters only touching.
 * Islands that stand apart are measured plainly and need no such hold.
 *
 * Either way no point is deeper than it is inside the target's box, so a point nearer the box's
 * edge than the deepest bite found so far cannot change the answer and is not asked about. That is
 * every probe point lying on a shared cap line or baseline, most of what probing the edges added.
 */
function deepestInside(probe: Float64Array, dx: number, target: Measured, floor: number): number {
  const box = target.box;
  let deepest = floor;
  for (let i = 0; i < probe.length; i += 2) {
    // Nowhere near the letter behind: two comparisons instead of a point-in-polygon over its
    // whole outline. Most of a glyph's outline is the far side of it, and the walk asks this of
    // every probe point at every step of every letter of the word.
    const y = probe[i + 1]!;
    if (y < box.minY || y > box.maxY) continue;
    const px = probe[i]! + dx;
    if (px < box.minX || px > box.maxX) continue;
    if (Math.min(px - box.minX, box.maxX - px, y - box.minY, box.maxY - y) <= deepest) continue;
    if (!target.union.inside(px, y)) continue;
    let d = unionOutlineDistance(target.shapes, [px, y]);
    if (d > deepest && !target.apart) d = Math.min(d, target.union.exit(px, y));
    if (d > deepest) deepest = d;
  }
  return deepest;
}

/** Whether no two of these islands' outer rings share any of their boxes — the case in which
 *  `unionOutlineDistance` is the plain distance to the nearest outer ring. */
function islandsApart(shapes: Shapes): boolean {
  const boxes = shapes.map((island) => bboxOf([[island[0] ?? []]]));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (!(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY)) return false;
    }
  }
  return true;
}

/**
 * How deeply `glyph`, moved `dx` mm along x, and `prev` cover each other — the real depth of the
 * weld between them.
 *
 * BOTH WAYS, and that is the whole point. Asking only "is a vertex of the new letter inside the
 * old one" is blind to the commonest overlap in type: a straight stem crossing a round bowl. A
 * "P" has vertices at the corners of its stem, which are at the cap line and the baseline, and
 * an "O" at those heights has already curved away — so an O and a P could be a third of a letter
 * into each other with no vertex of the P inside the O, and the walk reported nothing.
 * "SOPHIA" in Oswald came out with four joining bars invented for junctions that were already
 * overlapping. The O's own vertices ARE inside the P's stem, so the reverse test sees it.
 */
function penetration(glyph: Measured, prev: Measured, dx: number): number {
  const forward = deepestInside(glyph.probe, dx, prev, 0);
  // `prev`'s outline moved back by dx, against the glyph where it is drawn: the same overlap
  // read from the other side, so the glyph's own box (never shifted) is the box to cull against.
  // It starts from the forward bite, so only a deeper one is looked for.
  return deepestInside(prev.probe, -dx, glyph, forward);
}

/**
 * How far LEFT this glyph has to move to be welded to the one before it.
 *
 * Walk in `WELD_STEP` steps until the bite is `want` mm deep, and never past `travel` mm of
 * movement nor `burial` mm past the point where the two letters first TOUCH.
 *
 * Two caps, because they answer two different questions. `travel` is how far the glyph may move
 * at all — the font's own sidebearings plus a share of its advance, so a letter that would have
 * to cross half a word to find its neighbour stays where the type designer put it and is bridged
 * instead. `burial` is how much of the letter may DISAPPEAR once they meet (`MIN_BODY`), the cap
 * that keeps a narrow capital a letter: everything before first contact is clear air and costs
 * the letter no ink, so charging the burial from contact is the only place the measurement means
 * anything.
 *
 * A letter that cannot reach keeps its place and is bridged as today. "Cannot reach" is not the
 * same as "ran out of cap", though: the depth measured is the distance to the nearest edge, so a
 * stroke can only ever be entered by half its own width, and a thin neighbour saturates well
 * under `want` however far the walk goes. So a walk that has touched its neighbour but never
 * reached `want` stops at its burial cap, and only a walk that never touched it at all leaves the
 * glyph where the font put it.
 */
function weldShift(glyph: Shapes, prev: Shapes, want: number, travel: number, burial: number, loose = false): number {
  if (want <= 0 || travel <= 0 || !glyph.length || !prev.length) return 0;
  const g = measured(glyph);
  const p = measured(prev);
  const at = (shift: number) => penetration(g, p, -shift);
  const deepest0 = at(0);
  // `joinLoose`: a script's own joins are the type designer's and are never deepened — only a
  // letter that does not touch its neighbour at all is walked.
  if (loose && deepest0 > WELD_CONTACT) return 0;
  // Where the type designer already welded them, nothing moves: a connecting script, or a tight
  // face whose sidebearings sit inside their neighbour. Not "penetration > 0" — a hundredth of a
  // millimetre is tangency, not a weld — but a bite that would hold on its own.
  if (deepest0 >= Math.min(want, WELD_FLOOR)) return 0;
  /** The smallest shift in (lo, hi] whose bite is at least `depth`. */
  const bisect = (lo: number, hi: number, depth: number) => {
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) >= depth) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  /** Where the walk must stop once the two have met: `burial` past contact, never past the reach. */
  const stopAt = (contact: number) => Math.max(0, Math.min(travel, contact + burial));
  let contact = deepest0 > WELD_CONTACT ? 0 : -1;
  for (let shift = WELD_STEP; shift <= travel + 1e-9; shift += WELD_STEP) {
    const depth = at(shift);
    if (contact < 0 && depth > WELD_CONTACT) contact = bisect(shift - WELD_STEP, shift, WELD_CONTACT);
    const stop = contact < 0 ? travel : stopAt(contact);
    // The coarse step overshot by up to a quarter of a millimetre, which on a 0.9 mm bite is a
    // quarter more overlap than was asked for and visibly more letter buried. Bisect back to the
    // smallest shift that still reaches `want`.
    if (depth >= want) return Math.min(stop, bisect(shift - WELD_STEP, shift, want));
    if (shift >= stop) return stop;
  }
  return contact < 0 ? 0 : stopAt(contact);
}

// ------------------------------------------------------------------ the counters --

/** Distance from `p` to the nearest point of a closed ring. */
function ringDistance(p: [number, number], ring: readonly [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  }
  return d;
}

/**
 * The widest circle that fits inside a closed ring, mm — how far ACROSS a counter really is.
 *
 * Not the hole's bounding box: an "a" drawn by a script face has a counter that leans, and its
 * box is half again as wide as the hole a laser has to leave open. A grid of candidate centres,
 * then a shrinking hill-climb from the best of them; a bold offset shrinks the inscribed circle
 * by exactly the offset, which is what makes this the number the thicken has to be capped by.
 */
function inscribedDiameter(ring: readonly [number, number][]): number {
  if (ring.length < 3) return 0;
  const b = bboxOf([[ring as [number, number][]]]);
  const steps = 20;
  let best = 0;
  let at: [number, number] | null = null;
  for (let iy = 0; iy <= steps; iy++) {
    for (let ix = 0; ix <= steps; ix++) {
      const p: [number, number] = [b.minX + ((b.maxX - b.minX) * ix) / steps, b.minY + ((b.maxY - b.minY) * iy) / steps];
      if (!pointInRing(p, ring)) continue;
      const d = ringDistance(p, ring);
      if (d > best) { best = d; at = p; }
    }
  }
  if (!at) return 0;
  let step = Math.max(b.maxX - b.minX, b.maxY - b.minY) / steps;
  for (let k = 0; k < 14; k++) {
    let moved = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const p: [number, number] = [at[0] + dx * step, at[1] + dy * step];
      if (!pointInRing(p, ring)) continue;
      const d = ringDistance(p, ring);
      if (d > best) { best = d; at = p; moved = true; }
    }
    if (!moved) step /= 2;
  }
  return 2 * best;
}

/** The narrowest counter these islands carry, mm — `Infinity` when none of them has a hole. */
export function smallestCounter(shapes: Shapes): number {
  let min = Infinity;
  for (const island of shapes) for (let i = 1; i < island.length; i++) min = Math.min(min, inscribedDiameter(island[i]!));
  return min;
}

/**
 * How much bold these glyphs can take before their narrowest counter closes past `minCounter`,
 * mm.
 *
 * A bold is an outward offset of the ink, which is an inward offset of every counter, so a
 * counter loses exactly `2 × thicken` across. `Infinity` when there is no counter to lose;
 * 0 when the face already draws one narrower than the floor, which is the case the caller warns
 * about rather than silently thickening into.
 */
export function counterCap(shapes: Shapes, minCounter = MIN_COUNTER): number {
  const min = smallestCounter(shapes);
  if (!Number.isFinite(min)) return Infinity;
  return Math.max(0, (min - minCounter) / 2);
}

/**
 * The same laid-out run with every glyph walked left until it is welded to the one before it.
 *
 * Pure translation — no outline is touched, so the face is the face — and a glyph that moves
 * takes the whole rest of the word with it, or the walk would simply reopen the next gap.
 *
 * Two things the walk may never do (W2):
 *
 * · **Bury a letter.** Past first contact it may take `(min(ink width of the pair) − 1.5) / 2` mm,
 *   and never more than 35 % of that width, so every letter keeps 1.5 mm of ink no neighbour
 *   covers — see `MIN_BODY`. The pair's NARROWER letter sets the budget for both of its sides.
 * · **Eat the letter spacing.** `track` is air the customer asked for, so the weld is worked out
 *   as if it were not there and the air is handed back afterwards: the walk's answer LESS
 *   `track`. Tracking used to be added to the advance and then walked straight back out of it —
 *   0 %, 10 % and 25 % of a 20 mm "ELSIE" in Dela Gothic all built 71.4 mm. Now they build
 *   71.4, 79.4 and 91.4: the welded word, pulled apart by exactly the spacing asked for, and
 *   where that opens a letter clear of its neighbour the engine bridges it as it always has.
 *
 * A space resets the chain: a word gap is a deliberate space, and a word that welded backwards
 * across one would run its two words together. The engine's own baseline bar is what joins two
 * words, and it is drawn to be seen.
 */
/** The depth the walk welds to: the face's `overlap`, or — for a face that joins on its own —
 *  `joinLoose`, which only ever reaches the letters standing clear (`looseOnly`). */
const weldDepth = (c?: ConnectSpec): number => Math.max(0, c?.overlap ?? 0) || Math.max(0, c?.joinLoose ?? 0);
const looseOnly = (c?: ConnectSpec): boolean => !((c?.overlap ?? 0) > 0) && (c?.joinLoose ?? 0) > 0;

function weldRun(run: GlyphRun[], overlap: number, track = 0, loose = false): GlyphRun[] {
  if (overlap <= 0) return run;
  const out: GlyphRun[] = [];
  let carry = 0;
  let prev: Shapes = [];
  for (const g of run) {
    if (!g.shapes.length) {
      prev = [];
      out.push({ ...g, penX: g.penX - carry });
      continue;
    }
    const at = placeShapes(g.shapes, -carry, 0, 0);
    const inkBox = bboxOf(at);
    const prevBox = prev.length ? bboxOf(prev) : inkBox;
    // The clear air between this letter's ink and the last letter's. The walk may cross all of it
    // plus a share of the advance, for a pair whose boxes interlock before their ink meets — the
    // advance WITHOUT the tracking, so widening the spacing never widens the hunt.
    const gap = prev.length ? Math.max(0, inkBox.minX - prevBox.maxX) : 0;
    const air = Math.max(0, track);
    const ink = Math.min(inkBox.maxX - inkBox.minX, prevBox.maxX - prevBox.minX);
    const burial = Math.max(0, Math.min((ink - MIN_BODY) / 2, WELD_BODY_SHARE * ink));
    // The weld is worked out as if the customer had asked for no spacing at all, and the spacing
    // is then handed back: the walk's own answer LESS the air. So a tracked word is the untracked
    // welded word pulled apart by exactly the tracking — at 25 % the letters stand clear and the
    // engine bridges them, which is what the control's own help promises.
    const walk = prev.length ? weldShift(at, prev, overlap, gap + WELD_CAP * Math.max(0, g.advance - air), burial, loose) : 0;
    const shift = Math.max(0, walk - air);
    const placed = shift > 0 ? placeShapes(at, -shift, 0, 0) : at;
    carry += shift;
    out.push({ ...g, shapes: placed, penX: g.penX - carry });
    prev = placed;
  }
  return out;
}

/** One line of a connected word: its glyphs' islands in reading order, welded, on the baseline
 *  `y`, with the pen starting at `x`. `counts` is how many of those islands each glyph owns —
 *  what `seamPaths` needs to tell a junction between two letters from one inside a letter (W3). */
async function connectedLine(spec: TextSpec, text: string, size: number, x: number, y: number): Promise<{ islands: Shapes; width: number; counts: number[] }> {
  const run = weldRun(await layoutGlyphRun({ ...spec, text, size, connect: undefined }), weldDepth(spec.connect), (spec.letterSpacing ?? 0) * size, looseOnly(spec.connect));
  const islands: Shapes = [];
  const counts: number[] = [];
  let end = 0;
  for (const g of run) {
    if (g.shapes.length) islands.push(...placeShapes(g.shapes, x, y, 0));
    counts.push(g.shapes.length);
    end = Math.max(end, g.penX + g.advance);
  }
  return { islands, width: end, counts };
}

/**
 * A word as ONE body: its glyphs' islands in reading order, welded where the face needs welding
 * (G31 for a script, G32 for a block face).
 *
 * The islands are handed back separately on purpose. The plate unions them — that is the cut —
 * but a seam layer needs to know which edge belonged to which letter, and a union has forgotten.
 * A glyph is NOT one island, which is the thing W3 had to fix: a stroke-built face draws
 * Fredoka's H as three overlapping bars and Baloo's E as five, so `glyphIslands` rides along to
 * say how many of these islands each character owns.
 *
 * `layoutGlyphRun` rather than `getHorizontalContours`: the walk needs each glyph's own advance
 * and its own ink, which is exactly what whole-line layout throws away. Two lines are stacked
 * the way that layout stacks them — baselines ±dy/2, each line centred in the block — so a
 * connected two-line piece measures the same as the same words set the ordinary way.
 */
async function connectedLayer(spec: TextSpec, op: OpChoice, id: string, label: string): Promise<DesignLayer[]> {
  const size = spec.size;
  const line2 = (spec.line2 ?? '').trim() ? spec.line2! : '';
  const size2 = size * (spec.line2Scale ?? 0.7);
  // The same baseline separation `getHorizontalContours` uses, with the same 0.55 `textLayer`
  // passes it: half of it each way. The first line goes UP and the second DOWN — the font layout
  // writes the same two baselines with the signs the other way round because it places them
  // before `pathCommandsToPolygons` turns the glyph's y-down outline the right way up, and these
  // glyphs are already the right way up.
  const dy = line2 ? ((size + size2) * (spec.lineSpacing ?? 1) * 0.55) / 2 : 0;
  const first = await connectedLine(spec, spec.text ?? '', size, 0, dy);
  const second = line2 ? await connectedLine({ ...spec, font: spec.line2Font ?? spec.font }, line2, size2, 0, -dy) : null;
  let islands = first.islands;
  if (second) {
    // Block alignment: both lines inside a block as wide as the wider of them, so the short one
    // is the one that visibly moves.
    const block = Math.max(first.width, second.width);
    const offset = (w: number) => (spec.align === 'left' ? 0 : spec.align === 'right' ? block - w : (block - w) / 2);
    islands = [
      ...placeShapes(first.islands, offset(first.width), 0, 0),
      ...placeShapes(second.islands, offset(second.width), 0, 0),
    ];
  }
  if (!islands.length) return [];
  const centred = centreShapes(islands).shapes;
  // The hairline bold belongs to the WELD (G31): it is what keeps a script's thin strokes cuttable
  // once the glyphs are one body. A two-face stack that came here for the stacking only asks for
  // no connect, and must not be silently emboldened.
  //
  // And it is capped by the counters. A percentage of the letter height is the right decision for
  // the STROKES and the wrong one for the hole in an "a": Sacramento's counter at 30 mm is a
  // millimetre across, and 1.2 % of the size closes it to a quarter of that — a blob where a
  // letter was. The cap is measured off the glyphs actually drawn, so a bigger size or a rounder
  // face simply never meets it. `smallestCounter` is what a template reads to say so out loud.
  const asked = spec.connect ? spec.connect.thicken ?? 0.012 * size : 0;
  const thicken = asked > 0 ? Math.min(asked, counterCap(centred, spec.connect?.minCounter ?? MIN_COUNTER)) : asked;
  const grow = (spec.boldness ?? 0) + thicken;
  return [{
    id, label, kind: 'text',
    shapes: placeShapes(centred, spec.x ?? 0, spec.y ?? 0, spec.rotation ?? 0),
    op,
    // Reading order, the second line after the first — the order the islands were pushed in.
    glyphIslands: [...first.counts, ...(second ? second.counts : [])],
    ...(Math.abs(grow) > 1e-4 ? { grow } : {}),
  }];
}

export interface ArcTextSpec extends TextSpec {
  /** Baseline radius, mm: the circle the letters stand on, centred on the origin. */
  radius: number;
  /** Where the middle of the text sits, degrees. 90 = top, 270 = bottom. Default 90. */
  centreAngle?: number;
  /**
   * `outside` (default) puts the letter tops away from the centre — the text reads clockwise
   * round the top of the circle, which is what a badge or a round ornament wants.
   *
   * `inside` puts them toward the centre and reads counter-clockwise, which is the only way the
   * bottom of a circle reads right way up.
   */
  direction?: 'outside' | 'inside';
  /** Extra angle between letters, degrees. Positive opens the word out. */
  spread?: number;
}

/**
 * Text set round a circle, one glyph at a time.
 *
 * Each glyph's advance becomes an angle (`advance / radius`, so the spacing a reader sees is the
 * spacing the font asked for), and the glyph is rotated so its baseline is tangent to the circle
 * with its advance box centred on its own angle. The word as a whole is centred on `centreAngle`.
 *
 * Warping a straight line of text into a ring instead would shear every letter; this does not
 * touch the outlines at all, which is why a script face survives it.
 */
export async function arcTextLayer(spec: ArcTextSpec, op: OpChoice, id = 'design', label = 'Arc text'): Promise<DesignLayer[]> {
  const run = await layoutGlyphRun(spec);
  if (!run.length) return [];
  const radius = Math.max(Math.abs(spec.radius), 1e-3);
  const spread = ((spec.spread ?? 0) * Math.PI) / 180;
  const steps = run.map((g) => g.advance / radius + spread);
  const total = steps.reduce((a, b) => a + b, 0);
  const inside = spec.direction === 'inside';
  // Clockwise for the top arc, counter-clockwise for the bottom one: both read left to right.
  const dir = inside ? 1 : -1;
  const islands: Shapes = [];
  let angle = ((spec.centreAngle ?? 90) * Math.PI) / 180 - (dir * total) / 2;
  for (let i = 0; i < run.length; i++) {
    const g = run[i]!;
    const step = steps[i]!;
    const at = angle + (dir * step) / 2;
    angle += dir * step;
    if (!g.shapes.length) continue;
    // Into the glyph's own frame — advance box centred on x = 0, baseline on y = 0 — then out to
    // the circle. `placeShapes` rotates about the local origin before it translates.
    const local = placeShapes(g.shapes, -(g.penX + g.advance / 2), 0, 0);
    const spin = (at * 180) / Math.PI + (inside ? 90 : -90);
    islands.push(...placeShapes(local, radius * Math.cos(at), radius * Math.sin(at), spin));
  }
  if (!islands.length) return [];
  const shapes = placeShapes(islands, spec.x ?? 0, spec.y ?? 0, spec.rotation ?? 0);
  return [{ id, label, kind: 'text', shapes, op, ...(spec.boldness ? { grow: spec.boldness } : {}) }];
}

// --------------------------------------------------------------------------- case --

/** What the shared "Capitalise" control offers. `as-typed` is the identity. */
export type TextCase = 'as-typed' | 'upper' | 'lower' | 'title';

/**
 * A name in the case the design wants, whatever the customer typed.
 *
 * Caps on an arc and lowercase on a script are typographic decisions, not typing errors, and
 * asking someone to retype "ELSIE" because the topper looks better that way is the kind of
 * chore a generator exists to remove.
 *
 * `toLocaleUpperCase` rather than `toUpperCase`, and `Array.from` rather than `[0]`: a Turkish
 * dotless i and an emoji-range symbol token are both one character and neither survives the
 * naive version. An unknown mode is left alone, so a value from a newer save cannot mangle text.
 */
export function applyCase(text: string, mode: string): string {
  if (mode === 'upper') return text.toLocaleUpperCase();
  if (mode === 'lower') return text.toLocaleLowerCase();
  if (mode !== 'title') return text;
  return text.replace(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu, (word) => {
    const [first, ...rest] = Array.from(word);
    return (first ?? '').toLocaleUpperCase() + rest.join('').toLocaleLowerCase();
  });
}

/** Scale islands so the longest side is `size` mm, centred on the origin. */
export function fitShapes(shapes: Shapes, size: number): Shapes {
  const b = bboxOf(shapes);
  const long = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
  const k = size / long;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return shapes.map((isl) => isl.map((r) => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as [number, number])));
}
