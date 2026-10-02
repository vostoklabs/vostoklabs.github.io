// The one build: for every piece, blank or hugging outline → keyring → cut-outs → clipped
// engraves and scores; then the pieces are placed on the sheet and merged into one output.
// Pure and worker-side: takes manifold's wasm module, never touches the DOM. Every boolean the
// part needs happens here, in one call, so the main thread only ever draws.
//
// Written 2026-09-19 and grown on 2026-09-20 for
// the template programme: a layer with `hugOnly` shapes the body and is otherwise invisible;
// `keep` / `minus` intersect and subtract a layer before it is used; a hugging outline's
// bridges have a real width (`bridge`); and a build may carry `parts` — more pieces built
// through the same pipeline in their own frames (a backer, a base, tiles, a set of cards),
// optionally sharing the primary's keyring hole so a stack registers, then laid out beside it.
import {
  applyKeyring,
  bboxOf,
  circleRing,
  csOf,
  fromCS,
  intersectShapes,
  offsetShapes,
  placeShapes,
  ringsOf,
  roundedRectRing,
  signedArea,
  subtractShapes,
  toCS,
  unionShapes,
  withScope,
  type Box,
  type Shapes,
} from '@vostok/laser';
import type { CutImage } from '@vostok/export';
import { LATTICE_STATUS, latticeFaces } from '@vostok/patterns/lattice';
import { OUTLINE_STATUS, type Blank, type BuildInput, type BuildObject, type BuildOutput, type DesignLayer, type KeyringSpec, type PartInput, type PartPlacement } from './types';
import { clipPolylines, clipShapesToLines, lineLength } from './clip';
import { distanceToOutline, finalHoleCentre, insideShapes, nearestBridge, nearestOutlinePoint } from './editorGeometry';
import { buildRimResult } from './frame';
import { MIN_BRIDGE, stencilPunch } from './stencil';
import { cutLinePieces } from './cut-lines';

type Pt = [number, number];

/** How far inside the plate a plain score is kept: enough that a rule drawn on the outline does
 *  not come back as a second burn along the cut. */
const SCORE_INSET = 0.1;

/**
 * The seams of a welded word: for each letter, the run of ITS outline that a LATER letter covers
 * (G32).
 *
 * The letters are handed over as islands in reading order, so "later" is "further along the
 * word": each letter tucks behind the one after it, and the line burnt at a junction is the
 * buried edge of the earlier letter — one clean line per join, which is what a reader's eye
 * takes for the letter's own edge.
 *
 * Per LETTER, and `glyphIslands` is what says where one letter ends (W3). An island is a
 * contour group, not a glyph: a stroke-built face draws Fredoka's H as three overlapping bars
 * and its y as two, Baloo's H and E as five each. Read island-by-island, the rule scored the
 * junctions a letter makes with ITSELF — two lines straight across the H's crossbar and one down
 * the middle of the y, three of the seven seams on "Holly". So the probe is the LETTER'S OWN
 * OUTLINE (its islands unioned, which is what a reader calls the edge of an H) and the target is
 * the union of the LATER GLYPHS; a sibling stroke is neither. Unioning matters twice over:
 * handing the strokes over separately leaves each one's buried edge in the probe, and Baloo's
 * "HE" scored its junction twice — two runs down the same line, overlapping by 2.2 mm, because
 * the H's right stem is two overlapping bars. Only manifold can do it (concatenating the
 * contours into one island cannot: `toCS` orients the largest ring CCW and every other ring CW
 * under 'Positive', so the H's second stem would be read as a hole in the first) — which is why
 * this is the engine's job and not a template's.
 *
 * No `glyphIslands` (or a count that does not add up to the islands handed over): one island is
 * one glyph, which is exactly what this did before — so a layer built by hand behaves as it did.
 *
 * What this replaced was every glyph's whole outline, inset and clipped to the plate. That kept
 * a fragment of every edge that happened to lie a third of a millimetre inside the border, so a
 * four-letter name came out as a dozen scratches at no particular place ("N o a h"). Nothing is
 * inset here, nothing is clipped to the plate, and a word whose letters do not touch has no
 * seams at all — and nothing to say about it.
 *
 * `union: true` because these islands OVERLAP: under even-odd the deepest part of a junction —
 * where two letters cover the same material — reads as a hole, and the seam would come back cut
 * in half at exactly the point it matters.
 *
 * Two things are never seams. A DOT — an i's tittle, an inline symbol's pip — is not a letter
 * tucking behind its neighbour; it is a crumb the hug bridges, and a line burnt round it reads as
 * a scratch. And the bridges themselves are never here at all: they are made by the hug, out of
 * the plate, after this runs.
 *
 * A seam RUNS TO THE CUT (2026-09-22). It used to lose `SEAM_TRIM` = 0.3 mm off each end so
 * the score could never double the burn on the cut line — and what that bought, in the cut file,
 * was a visible gap between the blue and the red at both ends of every junction: the seam reads
 * as a scratch that stops short rather than as the join it is drawing. A seam runs from one
 * crossing of the later letter's outline to the next, and both crossings are corners OF THE
 * UNION, so an untrimmed seam ends exactly on the outline and never a step past it — the trim
 * was protecting against nothing the geometry could do. What is left is a tolerance: manifold
 * re-tessellates the union, so an end can miss the re-drawn ring by a few microns, and
 * `snapEnds` puts it back on the ring when it is within `SEAM_SNAP`. Nothing is shortened.
 *
 * `plate` is the piece as it will be cut. It is only ever used to snap the ends onto; a seam is
 * never clipped to it (the clip is what left "N o a h" as a dozen scratches).
 */
function seamPaths(wasm: any, islands: Shapes, glyphIslands?: number[], plate?: Shapes): Pt[][] {
  const out: Pt[][] = [];
  const boxes = islands.map((isl) => bboxOf([isl]));
  // The same rule `dotIndex` uses, applied to every island at once: a crumb beside the body of
  // the word. Measured against the tallest letter's SHORT side, so it holds at any size. Still
  // per ISLAND, so an i's tittle is a dot whether or not its stem is the same glyph.
  const body = Math.max(0, ...boxes.map((b) => Math.min(b.maxX - b.minX, b.maxY - b.minY)));
  const isDot = boxes.map((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) <= 0.4 * body);
  const glyphs = glyphGroups(islands.length, glyphIslands);
  for (let g = 0; g < glyphs.length - 1; g++) {
    const own = glyphs[g]!.filter((i) => !isDot[i]).map((i) => islands[i]!);
    if (!own.length) continue;
    // The letter's own outline: one union per glyph, and only where there is more than one
    // stroke to union.
    const probe = own.length > 1 ? unionShapes(wasm, own) : own;
    if (!probe.length) continue;
    // Only the later letters whose box actually meets this one's: a letter cannot bury an edge
    // it is nowhere near, and a name of twenty letters would otherwise clip every letter against
    // every letter after it — a hundredfold more edges than the two neighbours that matter.
    const a = bboxOf(probe);
    const later: Shapes = [];
    for (let k = g + 1; k < glyphs.length; k++) {
      for (const j of glyphs[k]!) {
        if (isDot[j]) continue;
        const b = boxes[j]!;
        if (b.maxX < a.minX || b.minX > a.maxX || b.maxY < a.minY || b.minY > a.maxY) continue;
        later.push(islands[j]!);
      }
    }
    if (!later.length) continue;
    const clipped = clipShapesToLines(probe, later, { union: true });
    for (const path of clipped.paths) {
      if (lineLength([], [path]) < MIN_SEAM) continue;
      out.push(plate ? snapEnds(path, plate) : path);
    }
    // A letter swallowed WHOLE by the next one keeps its ring; drawn as a closed path it is
    // still one seam and still an open run in the export, which is what every seam is. A ring has
    // no ends to poke out of anything, so it is not trimmed.
    for (const island of clipped.shapes) for (const ring of island) out.push([...ring, ring[0]!]);
  }
  return out;
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

/** The shortest run worth burning as a seam, mm. Not a trim — a floor: under this a junction is
 *  a nick where two outlines graze, and a line a tenth of a millimetre long is a dot on the
 *  material and a stutter in the machine. */
const MIN_SEAM = 0.1;

/** How far an end may be off the re-tessellated outline and still be pulled onto it, mm. A seam's
 *  ends are corners of the union by construction, so the only distance here is the union's own
 *  re-drawing — microns. Wide enough to catch that, far too narrow to move a seam that genuinely
 *  ends in the middle of the material (where three letters overlap and the run stops against a
 *  third letter's edge, not the piece's). */
const SEAM_SNAP = 0.05;

/** The polyline with each END moved onto the nearest point of the cut outline, when it is already
 *  within `SEAM_SNAP` of it. Nothing is shortened and nothing in between is touched: this only
 *  closes the micron the boolean's re-tessellation opened, so blue meets red. */
function snapEnds(path: Pt[], plate: Shapes): Pt[] {
  if (path.length < 2 || !plate.length) return path;
  const out = [...path];
  for (const at of [0, out.length - 1]) {
    const p = out[at]!;
    const near = nearestCutPoint(plate, p, SEAM_SNAP);
    if (near) out[at] = near;
  }
  return out;
}

/** The closest point on ANY of the plate's rings to `p`, within `within` mm, or null. Every ring,
 *  not just the outer one: a letter buried by the next one can end its run on the edge of a
 *  counter — the inside of an o — and that ring is cut red too, so blue has to meet it there as
 *  well. `nearestOutlinePoint` answers on outer rings only, which is right for a keyring neck and
 *  wrong here. */
function nearestCutPoint(plate: Shapes, p: Pt, within: number): Pt | null {
  let best: Pt | null = null;
  let d = within;
  for (const island of plate) for (const ring of island) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      const q: Pt = [a[0] + t * dx, a[1] + t * dy];
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd < d) { d = dd; best = q; }
    }
  }
  return best;
}

/** The plate an empty hug-mode part shows, so the stage is never blank. */
const EMPTY_PLATE = (): Shapes => [[roundedRectRing(40, 20, 4)]];

/** Keep each island's outer ring only, so a plate hugging two words does not trap a hole
 *  between them. The outer is the largest ring; everything else in the island is a hole. */
function fillHoles(shapes: Shapes): Shapes {
  return shapes
    .map((island) => {
      let best = island[0];
      for (const r of island) if (best && Math.abs(signedArea(r)) > Math.abs(signedArea(best))) best = r;
      return best ? [best] : [];
    })
    .filter((isl) => isl.length > 0);
}

/** Every hole narrower than `min` (its box's short side) is filled: a speck the border seals
 *  between two letters is not a counter, and a 1 mm hole in 3 mm ply is a weak spot, not a detail. */
function dropSmallHoles(shapes: Shapes, min: number): Shapes {
  if (min <= 0) return shapes;
  return shapes.map((island) => {
    let outer = island[0];
    for (const r of island) if (outer && Math.abs(signedArea(r)) > Math.abs(signedArea(outer))) outer = r;
    if (!outer) return island;
    return [outer, ...island.filter((r) => {
      if (r === outer) return false;
      const b = bboxOf([[r]]);
      return Math.min(b.maxX - b.minX, b.maxY - b.minY) >= min;
    })];
  });
}

/** An island's material: its outer ring less every hole it carries. Winding-agnostic, because a
 *  layer's shapes come from a font, not from manifold. */
function areaOf(shapes: Shapes): number {
  let total = 0;
  for (const island of shapes) {
    const areas = island.map((r) => Math.abs(signedArea(r)));
    if (!areas.length) continue;
    const outer = Math.max(...areas);
    total += 2 * outer - areas.reduce((a, b) => a + b, 0);
  }
  return total;
}

/**
 * What ran off the part, in the customer's words (G15).
 *
 * The engine used to say nothing until a layer was 100 % outside the part, so "Princess
 * Buttercup" came out "RINCESS BUTTERC" with a clean bill of health. `gone` is the share of the
 * layer that fell outside — area for an engrave, line length for a score.
 */
function lost(warnings: string[], label: string, gone: number): void {
  if (gone > 0.4) warnings.push(`${label} is mostly off the part.`);
  else if (gone > 0.01) warnings.push(`${label} runs past the edge — shorten it or make it smaller.`);
}

/**
 * The share of an engrave that lies OUTSIDE the piece's outer edge.
 *
 * What the subtraction leaves, never the difference of two areas: manifold re-tessellates on
 * every boolean, so a monogram sitting dead centre of a coaster "loses" 0.8 % of its area to the
 * round trip alone — and a 1 % threshold would then warn about every design in the library.
 */
function shareOutside(wasm: any, shapes: Shapes, solid: Shapes): number {
  const whole = areaOf(shapes);
  if (whole <= 1e-6) return 0;
  return areaOf(subtractShapes(wasm, shapes, solid)) / whole;
}

/** The bar width a cut-out layer's counters hang off, or null when it wants no bridges. On by
 *  default for every cut layer: whether there is a counter to lose is `stencilPunch`'s question,
 *  not this one's.
 *
 *  It used to be asked here, as "does any island already carry a second ring?", and that skipped
 *  exactly the layers the stencil exists for. A font may draw one glyph as several OVERLAPPING
 *  contours — Playfair's R is a bowl, a stem and a leg — and then the counter exists only in
 *  their union: no island has two rings, this returned null, and the middles of two R's came off
 *  the bed loose with nothing said. `stencilPunch` unions first and can see them; a slot or a
 *  screw hole still comes back through it untouched, boolean round trip and all. */
function stencilBridge(l: DesignLayer): number | null {
  if (l.stencil === false) return null;
  const asked = typeof l.stencil === 'object' ? l.stencil.bridge : undefined;
  return asked && asked > 0 ? asked : MIN_BRIDGE;
}

/**
 * The smallest island that is a DOT rather than a letter, or −1 when every piece left is a
 * letter in its own right.
 *
 * "Dots only" has to tell the tittle of an "i" from a capital that simply did not reach its
 * neighbour, and the only thing the engine knows about either is how big it is. A dot is tiny
 * next to the body it belongs to: its whole box fits inside two fifths of the biggest island's
 * SHORT side, so a 3 mm tittle beside a 30 mm-tall welded word qualifies and a 25 mm "C" does
 * not, at any size, in any face.
 */
function dotIndex(shapes: Shapes): number {
  const side = (island: Shapes[number]) => {
    const b = bboxOf([island]);
    return { long: Math.max(b.maxX - b.minX, b.maxY - b.minY), short: Math.min(b.maxX - b.minX, b.maxY - b.minY) };
  };
  const sides = shapes.map(side);
  const body = Math.max(...sides.map((s) => s.short));
  let pick = -1;
  let smallest = Infinity;
  for (let i = 0; i < sides.length; i++) {
    const s = sides[i]!;
    if (s.long > 0.4 * body || s.long >= smallest) continue;
    smallest = s.long;
    pick = i;
  }
  return pick;
}

/** A picture's box as a rectangle island — what a hugging outline wraps when the design is pixels. */
function imageRect(i: CutImage): Shapes {
  return [[[[i.x, i.y], [i.x + i.width, i.y], [i.x + i.width, i.y + i.height], [i.x, i.y + i.height]]]];
}

function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

const EMPTY_BOX: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** What one piece needs: its own blank and layers, and how its keyring is decided. */
interface PieceSpec {
  id: string;
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  bodyMembers?: string[];
  /** The primary's editable keyring, or a fixed copy of the primary's hole for a shared part. */
  keyring: { kind: 'own'; spec: KeyringSpec } | { kind: 'fixed'; spec: KeyringSpec; centre: Pt; anchor: Pt } | { kind: 'none' };
  /** `BuildInput.snapBox` — the primary's ring-snap box, when the template names one. */
  snapBox?: Box;
}

interface PieceResult {
  id: string;
  label: string;
  plate: Shapes;
  body: Shapes;
  bodyBox: Box;
  /** What a dragged ring snaps to: the template's `snapBox`, else `bodyBox`. */
  snapBox: Box;
  hole: BuildOutput['hole'];
  /** The hole's resting anchor on the body, for a shared part to reuse. */
  anchor: Pt | null;
  editorLayers: DesignLayer[];
  objects: BuildObject[];
  designBox: Box | null;
  bbox: Box;
  warnings: string[];
  /** How many pieces the piece's OPEN cut lines part it into (a jigsaw's), when it has any. */
  cutPieces?: number;
}

/**
 * A pattern cut as a lattice: the faces between its struts, which is booleans and so is done
 * here, all of it — @vostok/patterns' `latticeFaces` takes the pattern's lines (`lattice.runs`),
 * keeps the ones held at both ends, builds the struts, and cuts the region shrunk by the inset,
 * less the solids (`minus`), less the struts, with its rules on top (no confetti, no cantilever,
 * no floating strut, no reserve dropped, or nothing at all and a sentence). The faces replace
 * the region, `minus` is spent, and what the rules did rides back on the layer as
 * `lattice.stats`. The faces are single rings by construction, so no stencil pass is wanted.
 */
function latticeLayer(wasm: any, l: DesignLayer, warnings: string[]): DesignLayer {
  const spec = l.lattice!;
  const r = latticeFaces({ ...spec, region: l.shapes, solids: l.minus ?? [] }, {
    // Coarse: an octagon's arcs, for the tests and the kerf rounding — the quality settings'
    // fine arcs on thousands of faces were seconds of a 300 mm build. (Under 0.2 mm the quality
    // settings' edge-length floor is coarser still.)
    offset: (s, d, coarse) => (coarse && Math.abs(d) > 0.2
      ? withScope((keep) => fromCS(keep(toCS(wasm, s, keep).offset(d, 'Round', 2.0, 8)), keep))
      : offsetShapes(wasm, s, d)),
    subtract: (a, b) => subtractShapes(wasm, a, b),
    outline: (rings) => {
      const cs = csOf(wasm, rings, 'EvenOdd');
      try {
        return ringsOf(cs);
      } finally {
        cs.delete();
      }
    },
  });
  warnings.push(...r.warnings);
  const { minus: _solids, ...rest } = l;
  const shapes = l.keep?.length ? intersectShapes(wasm, r.faces, l.keep) : r.faces;
  // The lines are spent too: only what the rules did goes back to the page.
  return { ...rest, shapes, stencil: false, lattice: { ...spec, runs: [], outlines: [], stats: r.stats } };
}

/**
 * A pattern's shapes scored as what they paint (`PatternOutline`): their union, its hairline gaps
 * closed, eroded if the pattern asks, traced and clipped AS LINES to the pattern's zone — beside the
 * layer's own shapes and lines. The rings come straight off the boolean, never through
 * `decompose()`, which traps past a few thousand islands (a plaid at 70 % is six thousand).
 */
function outlineLayer(wasm: any, l: DesignLayer): DesignLayer {
  const o = l.outline!;
  const rings = o.shapes.length
    ? withScope((keep) => {
      let cs = toCS(wasm, o.shapes, keep);
      // Mitred, so a corner comes back the corner it was: a round join would round every one.
      if (o.seal > 0) cs = keep(cs.offset(o.seal, 'Miter', 2));
      if (o.seal + o.erode > 0) cs = keep(cs.offset(-(o.seal + o.erode), 'Miter', 2));
      return ringsOf(cs);
    })
    : [];
  // A ring no edge of the zone comes near is wholly on it or wholly off it, and one point says
  // which; only the rings the zone's edge crosses are clipped as lines (the clip tries every edge
  // of the zone against every step of a ring — a plaid is fifteen hundred rings).
  const edges = o.zone.flatMap((island) => island.flatMap((ring) => ring.map((a, i) => {
    const c = ring[(i + 1) % ring.length]!;
    return { minX: Math.min(a[0]!, c[0]!), maxX: Math.max(a[0]!, c[0]!), minY: Math.min(a[1]!, c[1]!), maxY: Math.max(a[1]!, c[1]!) };
  })));
  const crossing: Shapes = [];
  const traced: { shapes: Shapes; paths: Pt[][] } = { shapes: [], paths: [] };
  for (const r of rings) {
    const b = bboxOf([[r]]);
    if (edges.some((e) => e.minX <= b.maxX && e.maxX >= b.minX && e.minY <= b.maxY && e.maxY >= b.minY)) crossing.push([r]);
    else if (insideShapes(o.zone, r[0]!)) traced.shapes.push([r]);
  }
  if (crossing.length) {
    const clipped = clipShapesToLines(crossing, o.zone);
    traced.shapes.push(...clipped.shapes);
    traced.paths.push(...clipped.paths);
  }
  const shapes = [...l.shapes, ...traced.shapes];
  const paths = [...(l.paths ?? []), ...traced.paths];
  return { ...l, shapes, paths, outline: { ...o, shapes: [], length: lineLength(shapes, paths) } };
}

/** What a pattern's shapes paint, hairline gaps closed, eroded by `by` mm: its lines between shapes
 *  drawn thicker (`DesignLayer.erode`). */
function erodeShapes(wasm: any, shapes: Shapes, e: { seal: number; by: number }): Shapes {
  return withScope((keep) => {
    let cs = toCS(wasm, shapes, keep);
    if (e.seal > 0) cs = keep(cs.offset(e.seal, 'Miter', 2));
    cs = keep(cs.offset(-(e.seal + e.by), 'Miter', 2));
    return fromCS(cs, keep);
  });
}

/** Boldness, keep and minus: what a layer IS before the plate and the ops read it. */
function prepareLayers(wasm: any, layers: DesignLayer[], warnings: string[]): DesignLayer[] {
  let merged = false;
  const out = layers
    // A layer is live when it has closed shapes, a picture, open runs (a pattern of lines), or a
    // pattern's shapes to score round.
    .filter((l) => (l.op !== 'off' || l.hugOnly) && (l.shapes.length > 0 || l.image || l.paths?.length || l.outline?.shapes.length))
    .map((l) => {
      if (l.outline) return outlineLayer(wasm, l);
      if (!l.shapes.length) return l;
      if (l.lattice) return latticeLayer(wasm, l, warnings);
      let shapes = l.shapes;
      if (l.solid) shapes = fillHoles(unionShapes(wasm, shapes));
      if (l.minus && l.minus.length) shapes = subtractShapes(wasm, shapes, l.minus);
      if (l.keep && l.keep.length) shapes = intersectShapes(wasm, shapes, l.keep);
      if (l.erode && shapes.length) shapes = erodeShapes(wasm, shapes, l.erode);
      let glyphIslands = l.glyphIslands;
      if (l.grow && Math.abs(l.grow) > 1e-3 && shapes.length) {
        // A seam layer is the letters ONE AT A TIME — grow them together and manifold unions
        // them on the way out, leaving no "letter i" whose edge the seam could be. Offsetting
        // island by island keeps them apart, and the piece is unaffected: a Minkowski sum
        // distributes over a union, so (A ∪ B) ⊕ d and (A ⊕ d) ∪ (B ⊕ d) are the same plate.
        //
        // The tally of which islands belong to which glyph (W3) is re-counted as they go: an
        // offset that split or swallowed one would otherwise leave `glyphIslands` a letter out
        // of step with the islands it names, and the seams would be read off the wrong letter.
        const perIsland: number[] = [];
        const grown = l.seams
          ? shapes.flatMap((island) => { const g = offsetShapes(wasm, [island], l.grow!); perIsland.push(g.length); return g; })
          : offsetShapes(wasm, shapes, l.grow);
        if (l.seams && glyphIslands) {
          let at = 0;
          glyphIslands = glyphIslands.map((n) => { let sum = 0; for (let k = 0; k < n; k++) sum += perIsland[at++] ?? 1; return sum; });
        }
        // Boldness welds: past some thickness "OLIVIA" is one blob with a few notches in it, and
        // the customer cannot see it happen on a 300 px preview. Only a POSITIVE offset can do it,
        // and only a drop in the number of separate pieces proves it did — a script face whose
        // letters already touch was never two pieces to begin with. Material that shapes a hugging
        // outline is exempt: welding the letters is what a cake topper IS, and the border would
        // join them at the next step anyway — and so is a seam layer (G3), which is a second copy
        // of that same welded material, drawn only to find where the letters meet.
        const artwork = !l.hugOnly && !l.seams && l.op !== 'off';
        if (artwork && l.grow > 0 && grown.length < shapes.length && grown.length < unionShapes(wasm, shapes).length) merged = true;
        shapes = grown;
      }
      return { ...l, shapes, ...(glyphIslands ? { glyphIslands } : {}) };
    });
  if (merged) warnings.push('At this thickness two letters have merged — the name may no longer read.');
  return out;
}

function buildPiece(wasm: any, piece: PieceSpec): PieceResult {
  const warnings: string[] = [];
  const layers = prepareLayers(wasm, piece.layers, warnings);
  const belongs = (l: DesignLayer) => piece.bodyMembers === undefined || piece.bodyMembers.includes(l.owner ?? 'design');
  const attached = layers.filter(belongs);

  // The plate, before its keyring.
  let plate: Shapes;
  if (piece.blank.kind === 'none') {
    plate = [];
  } else if (piece.blank.kind === 'shape') {
    // Overlapping outer rings union here, so tiles and welded pieces come in as one island.
    plate = piece.blank.shapes.length ? unionShapes(wasm, piece.blank.shapes) : [];
    if (piece.blank.solid) plate = fillHoles(plate);
  } else if (piece.blank.kind === 'rim') {
    // A picture frame: the silhouette minus itself inset by the rim width. Everything after
    // this — the lug, cut-outs, clipped engraves — reads it as any other plate, so a frame
    // wears a loop and carries engraving on the ring exactly like a solid piece does.
    const rim = buildRimResult(wasm, piece.blank.outer, piece.blank.rimWidth, piece.blank.smoothing ?? 0.35 * piece.blank.rimWidth);
    plate = rim.shapes;
    if (rim.collapsed) warnings.push('The frame is wider than the shape allows — reduce the rim width.');
  } else {
    const material = attached.flatMap((l) => (l.image ? imageRect(l.image) : l.shapes));
    if (material.length === 0) {
      plate = piece.bodyMembers === undefined && piece.keyring.kind === 'own' ? EMPTY_PLATE() : [];
    } else {
      const { margin, smoothing } = piece.blank;
      const smooth = Math.max(0, smoothing);
      const bridge = Math.max(0.6, piece.blank.bridge ?? Math.max(1, margin));
      const source = unionShapes(wasm, material);
      // Border 0 with no rounding is a real answer, not a degenerate one: the piece IS the
      // letters' own union, cut on the glyph outlines (G31). Running an offset of nothing over
      // it costs a boolean round trip and re-tessellates every curve the type designer drew, so
      // at zero the union goes through untouched.
      let src = source;
      if (margin > 0.001 || smooth > 0.05) {
        src = offsetShapes(wasm, source, margin + smooth);
        if (smooth > 0.05) src = offsetShapes(wasm, src, -smooth);
      }
      // A cut-out name keeps every hole the border makes — its counters, and the pockets between
      // letters the smoothing seal closes (a block face at a small size would otherwise come out
      // as a slab). A plate under engraved letters stays solid: every hole filled.
      const counters = piece.blank.counters ?? (attached.every((l) => l.hugOnly || l.op === 'cut' || l.seams) ? 'open' : 'filled');
      const minHole = Math.max(0, piece.blank.minHole ?? 1.2);
      const tidy = counters === 'open' ? (s: Shapes) => dropSmallHoles(s, minHole) : fillHoles;
      plate = tidy(src);
      // Most letters join through their border alone. Bridge remaining islands along their
      // nearest contours — a bridge of real width, so the piece survives being lifted.
      //
      // `bridges` is the customer's "Connect": everything, the dots only — an i's tittle, an
      // inline symbol's pip, the pieces that are not letters and can never be reached by
      // welding — or nothing at all, which is a deliberate choice on a design meant to come off
      // the bed in parts. Only `all` complains about what is left over: in the other two modes
      // separate pieces are what was asked for.
      const joining = piece.blank.bridges ?? 'all';
      let bridged = 0;
      let guard = 0;
      while (joining !== 'none' && plate.length > 1 && guard++ < 64) {
        const pick = joining === 'dots' ? dotIndex(plate) : 0;
        if (pick < 0) break;
        const bridgeShapes = nearestBridge([plate[pick]!], plate.filter((_, i) => i !== pick), bridge);
        const joined = tidy(unionShapes(wasm, [...plate, ...bridgeShapes]));
        if (joined.length >= plate.length) {
          if (joining === 'all') warnings.push('Some letters are still separate pieces — bring them closer or widen the bridges.');
          break;
        }
        plate = joined;
        bridged++;
      }
      // How much of the weld the customer paid for. One or two bridges is an i's dot and a word
      // space — the design working. Past that the face simply does not connect and every join is
      // a bar the engine invented, which is worth saying before they cut it.
      // The fix names what to change, not a control: "a wider Border" is a field plenty of these
      // templates do not have, and a warning that points at a knob the form never drew reads as
      // a bug in the app.
      if (bridged > 2 && joining === 'all') warnings.push(`This font's letters do not meet — ${bridged} joining bars were added. A bolder face or a wider outline joins them cleanly.`);
      // A bridge meets the outline at a hard corner; the same close that rounds the border
      // rounds the junction, so the join reads as part of the shape and not a stick glued on.
      if (bridged > 0 && smooth > 0.05) plate = tidy(offsetShapes(wasm, offsetShapes(wasm, plate, smooth), -smooth));
    }
  }

  const body = plate;
  const bodyBox = body.length ? bboxOf(body) : EMPTY_BOX;
  // The keyring: a hole through the body, or a lug welded on with the hole through it.
  let hole: BuildOutput['hole'] = null;
  let anchor: Pt | null = null;
  if (piece.keyring.kind !== 'none' && body.length) {
    const k = piece.keyring.spec;
    if (k.enabled) {
      let centre: Pt;
      if (piece.keyring.kind === 'own') {
        const r = finalHoleCentre(body, k);
        centre = r.centre;
        anchor = r.anchor;
      } else {
        // The HOLE is shared — that is what registers a stack — but the neck is not. The
        // primary's anchor sits on the primary's outline, and every piece above it in a layered
        // stack is tighter: a name piece is 5–6 mm inside its backer, more at a wide border. Weld
        // the lug to a point 6 mm off this piece and it stands in mid-air; the letterform decides
        // whether the fillet happens to catch it, which is why S, O and I came off the bed in two
        // and A, M, N did not. So the neck is re-anchored on THIS body, and lands on its material.
        centre = piece.keyring.centre;
        anchor = nearestOutlinePoint(body, centre);
      }
      // A loop that has floated clear of the body gets a neck back to it, so the part is one
      // piece — the name keychain's tab, in laser. A loop still touching the body (or sitting
      // inside it) needs none: the union already joins them.
      //
      // The neck is handed to `applyKeyring` rather than unioned into the plate first, because
      // the fillet there is defined as "what the close adds BECAUSE of the lug and its neck".
      // Union it in early and the design it is measured against already contains the neck, so
      // the one junction that needs rounding is the one that cancels.
      const islandsBefore = plate.length;
      let neck: Shapes | undefined;
      if (k.mode === 'outside') {
        const gap = Math.hypot(centre[0] - anchor[0], centre[1] - anchor[1]);
        if (!insideShapes(body, centre) && gap > k.dia / 2 + k.ring) {
          const w = k.dia + 1.6 * k.ring;
          neck = placeShapes([[roundedRectRing(gap + w * 0.5, w, w / 2)]], (centre[0] + anchor[0]) / 2, (centre[1] + anchor[1]) / 2, (Math.atan2(centre[1] - anchor[1], centre[0] - anchor[0]) * 180) / Math.PI);
        }
      }
      plate = applyKeyring(wasm, plate, centre, k, neck ? { neck } : {});
      hole = { centre, dia: k.dia };
      // The loop has to land on material that can hold it. A hole through a thin rail, a slot
      // severed by a corner, a lug hanging off one letter: the part comes off the bed in two.
      if (plate.length > islandsBefore) warnings.push('The ring cuts the piece apart — move it onto solid material or widen the hole border.');
      // And it has to land clear of the design. `fitText` dodges the hole where a template uses
      // it; this is the net under the drag, the nudge pad and every template that does not.
      //
      // Material that is never lasered counts only when the hole has LOST its border: on a
      // hugging outline the lettering IS the material, and a hanging hole through the boss a
      // template put there for it is the design, not a mistake. `holdInside` keeps that border
      // wherever the shape allows, so its failing is the signal.
      const bare = k.mode === 'inside' && distanceToOutline(body, centre) < k.dia / 2 + k.ring - 0.05;
      // How far from the hole's centre the lettering has to stay, and it is not the same number in
      // the two modes — which is `shared.ts`'s `fitText` rule, and this net was not following it.
      // A HOLE punched through the part takes its border out of the part's own material, so ink
      // anywhere inside `dia/2 + ring` is ink on a web that must stay solid. A LOOP TAB welds the
      // border on OUTSIDE the edge: the lug stands proud of the piece, so the only thing a rim
      // caption can actually collide with is the hole itself. Charging it for the whole lug made
      // every framed ornament's rim names trip the net — the framed name's default cleared the hole
      // by 3.5 mm and the cut edge by 1.5 mm, and sat 0.07 mm from a warning saying otherwise.
      const keepOff = k.mode === 'inside' ? k.dia / 2 + k.ring : k.dia / 2 + 0.5;
      const disc: Shapes = [[circleRing(centre[0], centre[1], keepOff, 48)]];
      // And it is LETTERING the disc is tested against, not every mark on the piece. The sentence
      // says "the lettering"; run against a border rule, a frame's inset line or a blank's own
      // whiskers it is simply false, and a hole punched in a bordered part always meets the rule
      // that runs round it — so the warning fired at every hole with no letter anywhere near,
      // and qr-stand's tag gave up its punched hole to escape it. `kind` says which layers are
      // words: absent means a template built the layer by hand and has not claimed it is text.
      //
      // A SEAM layer is excluded whatever its op says. It is not a mark on the piece: it is a
      // second copy of the material, handed in so the engine can find where the letters meet, and
      // only the fragments that turn out to be buried are ever burnt. Counting it as lettering
      // made the welded name keychain warn "the ring sits on the lettering" at every default,
      // because the lug is welded to the first letter — which is the design.
      const lettering = (l: DesignLayer) => (l.kind === 'text' || l.kind === 'symbol') && !l.seams;
      const ink = layers
        .filter((l) => lettering(l) && (l.op === 'engrave' || l.op === 'score' || l.op === 'cut' || (bare && l.hugOnly)))
        .flatMap((l) => (l.image ? [] : l.shapes));
      if (ink.length && intersectShapes(wasm, disc, ink).length) {
        warnings.push('The ring sits on the lettering — drag it clear, or shrink the hole.');
      }
    }
  }

  // Cut-outs: a design layer set to Cut goes through the part, so it becomes part of the plate.
  // A layer with counters (letters, symbols) keeps them with stencil bridges first, or the inside
  // of every o and B is a loose island on the bed.
  const cuts = attached.filter((l) => l.op === 'cut' && !l.image).flatMap((l) => {
    const bridge = stencilBridge(l);
    return bridge === null ? l.shapes : stencilPunch(wasm, l.shapes, bridge).punch;
  });
  if (cuts.length > 0 && plate.length) {
    const before = plate.length;
    plate = subtractShapes(wasm, plate, cuts);
    if (plate.length > before) warnings.push('A cut-out splits the part into pieces.');
  }

  // Engraves and scores stay inside the part: an engrave is clipped to the plate as a region, a
  // score AS A LINE (a ring has no area to intersect). A picture is pixels, so it rides through
  // as it is.
  //
  // How much of a mark the clip took is measured against the piece's OUTER outline, never the
  // plate with its holes: a glue guide crossing the keyring hole, or lettering round a cut-out,
  // loses material on purpose. Only what ran off the EDGE is a name the customer has lost.
  const objects: BuildObject[] = [];
  const holey = plate.some((island) => island.length > 1);
  const solidPlate = holey ? fillHoles(plate) : plate;
  let designBox: Box | null = null;
  // What the cut head has already been sent over on this piece. A free-standing cut layer — one
  // the plate did not swallow — is unioned before it is written and then loses whatever an
  // earlier cut object already covers, so no two red rings in the file can cross.
  //
  // This is the hole the "Holly" export fell through (G33): a welded word handed in as a cut
  // layer beside an empty blank went out as nine overlapping glyph outlines, one per letter,
  // because nothing between the layer and the file ever unioned them. The plate is the union
  // wherever the plate is involved; this makes the rest of the cut group obey the same rule,
  // whatever a template does.
  let cutSoFar: Shapes = [];
  const cutLines: Pt[][] = [];
  let scoreInner = null as { of: Shapes; shapes: Shapes } | null;
  for (const l of layers) {
    if (l.image) {
      objects.push({ id: l.id, label: l.label, op: 'engrave', shapes: [], image: l.image });
      designBox = unionBox(designBox, { minX: l.image.x, minY: l.image.y, maxX: l.image.x + l.image.width, maxY: l.image.y + l.image.height });
      continue;
    }
    const boundToBody = plate.length > 0 && belongs(l);
    // A cut layer's OPEN runs: a jigsaw's seams, one line per shared edge, so every
    // edge is burnt once instead of twice as two touching outlines. Clipped to the piece exactly,
    // never inset the way a score is — a seam has to END ON the outline or the pieces stay joined.
    // The layer's closed shapes, if it has any, carry on below as before.
    if (l.op === 'cut' && l.paths?.length) {
      const paths = boundToBody ? clipPolylines(l.paths, plate) : l.paths;
      if (!paths.length) warnings.push(`${l.label} lies outside the part.`);
      else {
        objects.push({ id: l.shapes.length ? `${l.id}-lines` : l.id, label: l.label, op: 'cut', shapes: [], paths });
        designBox = unionBox(designBox, bboxOf([paths]));
        cutLines.push(...paths);
      }
      if (!l.shapes.length) continue;
    }
    if (l.op === 'cut' && !boundToBody) {
      const merged = l.shapes.length > 1 ? unionShapes(wasm, l.shapes) : l.shapes;
      const shapes = cutSoFar.length ? subtractShapes(wasm, merged, cutSoFar) : merged;
      if (!shapes.length) continue;
      cutSoFar = cutSoFar.length ? unionShapes(wasm, [...cutSoFar, ...shapes]) : shapes;
      objects.push({ id: l.id, label: l.label, op: 'cut', shapes });
      designBox = unionBox(designBox, bboxOf(shapes));
      continue;
    }
    if (l.op !== 'engrave' && l.op !== 'score') {
      if (l.op === 'cut') designBox = unionBox(designBox, bboxOf(l.shapes));
      continue;
    }
    if (l.op === 'score' && l.seams) {
      // The seams are the buried edges and nothing else — no inset, no plate clip, no margin
      // arithmetic. A word whose letters never meet has none, and that is not a fault to report:
      // a connecting script IS one body already.
      const paths = seamPaths(wasm, l.shapes, l.glyphIslands, plate);
      if (!paths.length) continue;
      objects.push({ id: l.id, label: l.label, op: 'score', shapes: [], paths });
      designBox = unionBox(designBox, bboxOf([paths]));
      continue;
    }
    if (l.op === 'score') {
      // One inset of the piece serves every score layer on it: a two-layer bag tag carries a
      // score layer per welded ink (name, number, laces), and recomputing the same offset for
      // each was 100–200 ms of a football build (2026-09-26).
      if (boundToBody && scoreInner?.of !== plate) scoreInner = { of: plate, shapes: offsetShapes(wasm, plate, -SCORE_INSET) };
      const inner = boundToBody ? scoreInner!.shapes : [];
      const region = boundToBody ? (inner.length ? inner : plate) : null;
      const clipped = region ? clipShapesToLines(l.shapes, region) : { shapes: l.shapes, paths: [] as Pt[][] };
      // A layer's own open runs (a pattern's lattice, a hinge scored rather than cut) are
      // clipped the same way and ride in the same object.
      if (l.paths?.length) clipped.paths.push(...(region ? clipPolylines(l.paths, region) : l.paths));
      if (!clipped.shapes.length && !clipped.paths.length) {
        warnings.push(`${l.label} lies outside the part.`);
        continue;
      }
      if (region) {
        // Against the OUTER edge: a rule the keyring hole or a cut-out interrupts is not a rule
        // that ran off the part. Pure arithmetic, so what it measures is what was really lost.
        const gauge = holey ? clipShapesToLines(l.shapes, fillHoles(region)) : clipped;
        const whole = lineLength(l.shapes);
        // A `fill` is a pattern covering the piece: being trimmed at the edge is the design.
        if (whole > 1e-6 && l.kind !== 'fill') lost(warnings, l.label, 1 - lineLength(gauge.shapes, gauge.paths) / whole);
      }
      objects.push({ id: l.id, label: l.label, op: 'score', shapes: clipped.shapes, ...(clipped.paths.length ? { paths: clipped.paths } : {}) });
      designBox = unionBox(designBox, bboxOf(clipped.paths.length ? [...clipped.shapes, clipped.paths] : clipped.shapes));
      continue;
    }
    const shapes = boundToBody ? intersectShapes(wasm, l.shapes, plate) : l.shapes;
    if (shapes.length === 0) {
      warnings.push(`${l.label} lies outside the part.`);
      continue;
    }
    if (boundToBody && l.kind !== 'fill') lost(warnings, l.label, shareOutside(wasm, l.shapes, solidPlate));
    objects.push({ id: l.id, label: l.label, op: l.op, shapes });
    // What is left after the clip, not what was asked for: a name that runs past the edge used
    // to inflate the reported size to 80 × 93 mm on a 68 × 40 mm tag, and the preview zoomed out
    // to the empty space around it.
    designBox = unionBox(designBox, bboxOf(boundToBody ? shapes : l.shapes));
  }
  objects.sort((a, b) => (a.op === b.op ? 0 : a.op === 'engrave' ? -1 : 1));

  // A design whose whole promise is "this comes off the bed in one piece" says so, with the
  // count manifold actually made — a template can only estimate it, and a split monogram's
  // estimate said three where the truth was nine. Counted here, at the end, because the weld
  // can fail at the union, at a cut-out or under the ring; the generic sentence is replaced
  // rather than joined, so the customer reads one warning with the number in it. A shape blank
  // is loose islands by design for plenty of templates, so this is opt-in.
  if (piece.blank.kind === 'shape' && piece.blank.oneIsland && plate.length > 1) {
    const counted = `The piece is in ${plate.length} separate pieces — they come off the bed loose.`;
    const generic = warnings.indexOf('A cut-out splits the part into pieces.');
    if (generic >= 0) warnings[generic] = counted;
    else warnings.unshift(counted);
  }

  const bbox = plate.length ? unionBox(designBox, bboxOf(plate)) : designBox ?? { minX: -30, minY: -20, maxX: 30, maxY: 20 };
  // The runs never split `plate` (they are lines, not holes), so the pieces they make are counted
  // by making the cut — see cut-lines.ts.
  const cutPieces = cutLines.length && plate.length ? cutLinePieces(wasm, plate, cutLines).length : undefined;
  return { id: piece.id, label: piece.label, plate, body, bodyBox, snapBox: piece.snapBox ?? bodyBox, hole, anchor, editorLayers: layers, objects, designBox, bbox, warnings, ...(cutPieces ? { cutPieces } : {}) };
}

/** Move a built piece by (dx, dy) — everything that has a position. */
function movePiece(r: PieceResult, dx: number, dy: number): PieceResult {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return r;
  const shift = (s: Shapes) => placeShapes(s, dx, dy, 0);
  const box = (b: Box): Box => ({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
  return {
    ...r,
    plate: shift(r.plate),
    body: shift(r.body),
    bodyBox: box(r.bodyBox),
    snapBox: box(r.snapBox),
    hole: r.hole ? { centre: [r.hole.centre[0] + dx, r.hole.centre[1] + dy], dia: r.hole.dia } : null,
    anchor: r.anchor ? [r.anchor[0] + dx, r.anchor[1] + dy] : null,
    editorLayers: r.editorLayers.map((l) => ({ ...l, shapes: shift(l.shapes) })),
    objects: r.objects.map((o) => ({
      ...o,
      shapes: shift(o.shapes),
      ...(o.paths ? { paths: o.paths.map((p) => p.map(([x, y]) => [x + dx, y + dy] as Pt)) } : {}),
      ...(o.image ? { image: { ...o.image, x: o.image.x + dx, y: o.image.y + dy } } : {}),
    })),
    designBox: r.designBox ? box(r.designBox) : null,
    bbox: box(r.bbox),
  };
}

/**
 * Lay the extra pieces out beside the primary. `row`: to its right, centres level; `column`:
 * under it, centres aligned; `wrap`: shelves from the primary's top-left, no wider than
 * `maxWidth`, rows running down the sheet. A part with `at` goes exactly there instead.
 */
function placePieces(primary: PieceResult, parts: PieceResult[], inputs: PartInput[], layout: BuildInput['layout'], sheet: BuildInput['sheet']): { placed: PieceResult[]; pages: Box[] } {
  const flow = layout?.flow ?? (sheet ? 'wrap' : 'row');
  const gap = layout?.gap ?? 4;
  const margin = sheet?.margin ?? 5;
  const gutter = sheet?.gutter ?? 10;
  const maxWidth = Math.max(20, sheet ? sheet.width - 2 * margin : layout?.maxWidth ?? 300);
  const pageHeight = sheet ? Math.max(20, sheet.height - 2 * margin) : Infinity;
  const out: PieceResult[] = [];
  const p = primary.bbox;
  const pcx = (p.minX + p.maxX) / 2;
  const pcy = (p.minY + p.maxY) / 2;
  let cursorX = p.maxX + gap;
  let cursorY = p.minY - gap;
  // Shelf state for `wrap`: the current row's left edge, its top and its tallest piece; the
  // page's top-left corner is the primary's, and a sheet that fills starts a new page to the right.
  let left = p.minX;
  let pageTop = p.maxY;
  let shelfX = p.maxX + gap;
  let shelfTop = p.maxY;
  let shelfH = p.maxY - p.minY;
  const pages: Box[] = sheet ? [{ minX: left - margin, maxX: left - margin + sheet.width, minY: pageTop + margin - sheet.height, maxY: pageTop + margin }] : [];
  for (let i = 0; i < parts.length; i++) {
    const r = parts[i]!;
    const at = inputs[i]?.at;
    const b = r.bbox;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (at) { out.push(movePiece(r, at.x - cx, at.y - cy)); continue; }
    if (flow === 'column') {
      out.push(movePiece(r, pcx - cx, cursorY - h / 2 - cy));
      cursorY -= h + gap;
    } else if (flow === 'wrap') {
      if (shelfX + w > left + maxWidth && shelfX > left) {
        shelfTop -= shelfH + gap;
        shelfX = left;
        shelfH = 0;
      }
      // Off the bottom of the page: a fresh page to the right, and this piece opens it.
      if (sheet && shelfTop - h < pageTop - pageHeight && shelfX === left && shelfTop < pageTop) {
        left = (pages[pages.length - 1]?.maxX ?? left) + gutter + margin;
        shelfX = left;
        shelfTop = pageTop;
        shelfH = 0;
        pages.push({ minX: left - margin, maxX: left - margin + sheet.width, minY: pageTop + margin - sheet.height, maxY: pageTop + margin });
      }
      out.push(movePiece(r, shelfX - b.minX, shelfTop - b.maxY));
      shelfX += w + gap;
      shelfH = Math.max(shelfH, h);
    } else {
      out.push(movePiece(r, cursorX - b.minX, pcy - cy));
      cursorX += w + gap;
    }
  }
  return { placed: out, pages };
}

export function buildKeychain(wasm: any, input: BuildInput): BuildOutput {
  const primary = buildPiece(wasm, {
    id: 'main',
    label: input.label ?? '',
    blank: input.blank,
    layers: input.layers,
    ...(input.bodyMembers ? { bodyMembers: input.bodyMembers } : {}),
    keyring: { kind: 'own', spec: input.keyring },
    ...(input.snapBox ? { snapBox: input.snapBox } : {}),
  });

  const partInputs = input.parts ?? [];
  // What a `shared` part registers to: the piece's hole and anchor in its own (unplaced) frame,
  // and the keyring that made them. The primary is the default; a batch's copies each register
  // their own stack to themselves through `registerTo`. Pieces build in order, so a part can
  // only register to one already built — naming a later one is a template bug, not a silent
  // mis-registration.
  type Registration = { spec: KeyringSpec; centre: Pt; anchor: Pt };
  const registry = new Map<string, Registration | null>();
  const register = (id: string, spec: KeyringSpec, r: PieceResult) =>
    registry.set(id, r.hole && r.anchor ? { spec, centre: r.hole.centre, anchor: r.anchor } : null);
  register('main', input.keyring, primary);
  const built = partInputs.map((part) => {
    let keyring: PieceSpec['keyring'] = { kind: 'none' };
    if (part.keyring === 'shared') {
      const to = part.registerTo ?? 'main';
      if (!registry.has(to)) throw new Error(`Part "${part.id}" registers to "${to}", which is not a piece built before it.`);
      const r = registry.get(to);
      if (r) keyring = { kind: 'fixed', spec: r.spec, centre: r.centre, anchor: r.anchor };
    } else if (part.keyring && part.keyring !== 'none') {
      keyring = { kind: 'own', spec: part.keyring };
    }
    const r = buildPiece(wasm, {
      id: part.id,
      label: part.label,
      blank: part.blank,
      layers: part.layers,
      ...(part.bodyMembers ? { bodyMembers: part.bodyMembers } : {}),
      keyring,
    });
    register(part.id, keyring.kind === 'none' ? input.keyring : keyring.spec, r);
    return r;
  });
  const { placed, pages } = placePieces(primary, built, partInputs, input.layout, input.sheet);
  const pieces = [primary, ...placed];

  const objects: BuildObject[] = [];
  // The piece coming apart outranks anything a template has to say; the template's own
  // sentences come next, then the engine's lesser notes.
  const severe = (w: string) => /separate pieces|splits the part|cuts the piece apart|sits on the lettering|runs past the edge|mostly off the part/.test(w);
  const warnings = [...primary.warnings.filter(severe), ...(input.warnings ?? []), ...primary.warnings.filter((w) => !severe(w))];
  let designBox = primary.designBox;
  let bbox = primary.bbox;
  const parts: PartPlacement[] = [];
  const plate: Shapes = [];
  // The outlines cut from a DIFFERENT material — a `card` piece's kraft. They stay in `plate`
  // (the preview draws every outline from it, and the box match finds each piece there), but they
  // are also written as their own cut object, so the export can label them and an operator can
  // run the wood, swap the sheet and run just the card.
  const cardPlate: Shapes = [];
  let cardLabel = '';
  // A set is many pieces built from ONE design, so a note about that design is one note however
  // many pieces it was cut into: tic-tac-toe's five X tokens are the same symbol five times, and
  // printing "X: this font's letters do not meet" five times over says nothing the first line
  // did not. Kept in the order they first appeared, with the copies as a count.
  const partWarnings: string[] = [];
  const partCount = new Map<string, number>();
  for (const r of pieces) {
    const isPrimary = r === primary;
    for (const o of r.objects) objects.push(isPrimary ? o : { ...o, id: `${r.id}:${o.id}`, label: r.label ? `${r.label} · ${o.label}` : o.label });
    if (!isPrimary) {
      for (const w of r.warnings) {
        const line = r.label ? `${r.label}: ${w}` : w;
        const seen = partCount.get(line);
        if (seen === undefined) partWarnings.push(line);
        partCount.set(line, (seen ?? 0) + 1);
      }
      if (r.designBox) designBox = unionBox(designBox, r.designBox);
      bbox = unionBox(bbox, r.bbox);
    }
    plate.push(...r.plate);
    const index = isPrimary ? -1 : placed.indexOf(r);
    const spec = isPrimary ? null : partInputs[index];
    const box = r.plate.length ? bboxOf(r.plate) : r.bbox;
    // The primary's assembled position is its own centre: the stack is built in its frame. And
    // `'built'` is a part saying the same thing — its own centre BEFORE the layout moved it, so
    // the glue-up is exactly the build frame again.
    const unplaced = index < 0 ? null : built[index];
    const centreOf = (b: Box) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    const assembledAt = isPrimary
      ? (partInputs.some((p) => p.assembledAt) ? centreOf(box) : undefined)
      : spec?.assembledAt === 'built'
        ? centreOf(unplaced && unplaced.plate.length ? bboxOf(unplaced.plate) : unplaced?.bbox ?? box)
        : spec?.assembledAt;
    const material = isPrimary ? input.material ?? 'light' : spec?.material ?? 'light';
    if (material === 'card') { cardPlate.push(...r.plate); if (!cardLabel) cardLabel = r.label; }
    const pose = isPrimary ? input.pose : spec?.pose;
    parts.push({ id: r.id, label: r.label, box, pieces: r.plate.length, ...(assembledAt ? { assembledAt } : {}), material, ...(spec?.previewStyle ? { previewStyle: spec.previewStyle } : {}), ...(spec?.z !== undefined ? { z: spec.z } : {}), ...(pose ? { pose } : {}) });
  }
  for (const line of partWarnings) {
    const count = partCount.get(line) ?? 1;
    warnings.push(count > 1 ? `${line} (×${count})` : line);
  }
  objects.sort((a, b) => (a.op === b.op ? 0 : a.op === 'engrave' ? -1 : 1));
  if (plate.length) {
    const kraft = new Set(cardPlate);
    const wood = cardPlate.length ? plate.filter((island) => !kraft.has(island)) : plate;
    if (wood.length) objects.push({ id: 'plate', label: pieces.length > 1 ? 'Outlines' : 'Keychain body', op: 'cut', shapes: wood });
    if (cardPlate.length) objects.push({ id: 'plate:card', label: cardLabel || 'Card', op: 'cut', shapes: cardPlate });
  }

  const status = outlineClause(latticeClause(input.status, pieces), pieces) ?? loosePieces(input, primary) ?? cutLineClause(pieces);
  return {
    plate,
    body: primary.body,
    bodyBox: primary.bodyBox,
    ...(input.snapBox ? { snapBox: primary.snapBox } : {}),
    editorLayers: primary.editorLayers,
    hole: primary.hole,
    objects,
    bbox,
    designBox,
    warnings,
    parts,
    ...(input.sheet ? { sheets: { count: pages.length, width: input.sheet.width, height: input.sheet.height, pages } } : {}),
    ...(status ? { status } : {}),
  };
}

/**
 * A pattern template names a lattice cut in its status before the faces exist (they are booleans,
 * cut here): the name becomes their count once they are, or "nothing cut out" when the rules
 * refused it — the warning beside it says why. Never "cut as a lattice" over a plain piece.
 */
function latticeClause(status: string | undefined, pieces: PieceResult[]): string | undefined {
  if (!status?.includes(LATTICE_STATUS)) return status;
  const layers = pieces.flatMap((p) => p.editorLayers).filter((l) => l.lattice?.stats);
  if (!layers.length) return status;
  const faces = layers.reduce((s, l) => s + (l.lattice?.stats?.faces ?? 0), 0);
  return status.replace(LATTICE_STATUS, faces ? `${faces} openings` : 'nothing cut out');
}

/** A scored pattern of shapes names its length in its status before it is traced (a union, done
 *  here): the name becomes the length the worker scored. */
function outlineClause(status: string | undefined, pieces: PieceResult[]): string | undefined {
  if (!status?.includes(OUTLINE_STATUS)) return status;
  const length = pieces.flatMap((p) => p.editorLayers).reduce((s, l) => s + (l.outline?.length ?? 0), 0);
  return status.replace(OUTLINE_STATUS, `${Math.round(length)} mm of line`);
}

/**
 * "2 pieces" — how many the file holds, when a design turned the joining bars OFF on purpose.
 *
 * A clause in the status line, never a warning (2026-09-22): a welded name that comes off the
 * bed in two pieces is the product — it will be glued anyway — and a yellow line saying so reads
 * as a fault the customer has to fix. Only where `bridges: 'none'` was asked for: everywhere else
 * the engine is still trying to make one piece and failing to is worth a warning, which is what
 * the bridge loop already says.
 *
 * The template's own clause wins; this is the fallback for the designs that have none.
 */
function loosePieces(input: BuildInput, primary: PieceResult): string | undefined {
  if (input.blank.kind !== 'hug' || input.blank.bridges !== 'none') return undefined;
  return primary.plate.length > 1 ? `${primary.plate.length} pieces` : undefined;
}

/** "24 pieces" — what a design's open cut lines really part it into (a jigsaw), counted by the
 *  cut itself rather than taken from the template's arithmetic. Every other piece counts as the
 *  islands it is. Nothing when no piece carries cut lines. */
function cutLineClause(pieces: PieceResult[]): string | undefined {
  if (!pieces.some((r) => r.cutPieces)) return undefined;
  const total = pieces.reduce((n, r) => n + (r.cutPieces ?? r.plate.length), 0);
  return `${total} piece${total === 1 ? '' : 's'}`;
}
