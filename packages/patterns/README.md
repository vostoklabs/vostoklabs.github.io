# @vostok/patterns

Repeating patterns as laser geometry. A pattern is maths — a tile or a field — and the engine
fills any shape with it and hands back what the laser does: holes to **cut** out (with the web
between them guaranteed), lines to **score**, regions to **engrave**. Pure TypeScript, no
dependencies, millimetres, Y up, the same `Shapes = Ring[][]` contract as `@vostok/laser`.

```ts
import { fillShape, patternById, circle } from '@vostok/patterns';

const coaster = [[circle(0, 0, 45)]];                       // any islands of rings; holes allowed
const r = fillShape(coaster, patternById('honeycomb')!, {
  op: 'cut', params: { size: 8, gap: 2 }, web: 2, inset: 4, angle: 30,
});
r.shapes    // Ring[][]  — one island per hole (cut) or filled region (engrave) or whole ring (score)
r.paths     // Pt[][]    — open runs: score lines, or hinge slits when the op is cut
r.stats     // { cells, holes, dropped, lines, lineLength, area, unclipped }
r.warnings  // plain sentences: "Honeycomb leaves only 1 mm between cuts here; 2 mm is the minimum…"
```

```bash
pnpm --filter @vostok/patterns typecheck
pnpm --filter @vostok/patterns test           # node suite, no browser (tests/run.mjs)
pnpm --filter @vostok/patterns sheet          # every pattern in a disc → tests/.out/sheet.png
node packages/patterns/tests/sheet.mjs --ops --only=dots,kikko --shape=ring   # variations
pnpm --filter @vostok/patterns fetch-monster  # regenerate the Pattern Monster tile data
```

## What the fill does

1. **Resolve** the params (defaults from the definition, the caller's on top, clamped).
2. **Place** the pattern: scaled, rotated about the region's centre, slid by `dx`/`dy`. A tiled
   pattern gets a cell centred on the region's centre, so a symmetric shape gets a symmetric
   fill (a coaster has a hole in the middle, not a web). `align: 'corner'` anchors the pattern
   to the bounding box instead.
3. **Generate** — the tile repeated over the region's box plus a margin, or the field drawn
   into it — then **merge**: duplicate and collinear line segments collapse (a hexagon lattice
   drawn hexagon by hexagon comes out with each edge once, four half-lines from four cells
   come out as one line), identical shapes dedupe.
4. **Inset** the region by `inset` (a vertex offset with a mitre cap; a corner rounder than the
   inset — a card's 3 mm corner under a 4 mm margin — collapses to the sharp corner its sides
   make). If the outline still cannot take it, a cut drops every hole nearer the bare outline
   than the inset; a score or an engrave runs to the edge and says so.
5. **Clip** by op:
   - `cut` — a closed shape is kept only when it is wholly on material and clears the edge by
     `web`; anything crossing the edge is dropped (a hole that touches the edge opens the
     outline). The wood between the holes is then **measured** (a tile once, on one cell among
     its neighbours; a field hole by hole, and a hole against itself where it comes back round a
     finger of wood): under `web`, every hole gives up half the shortfall all round, so the
     closest two end exactly a web apart; if that leaves under half the holes, it says the zoom
     it cuts from; shapes that meet or overlap are cut as a lattice. A hinge's slots are a kerf
     wide — nothing to shrink — so a hinge only says so. `slits` (living hinges) are clipped as lines and trimmed by `web`; `slitWidth`
     turns them into closed slots for a host whose cut layer takes shapes only. A pattern with
     no holes of its own to punch — lines, or shapes that touch — is cut as a **lattice** (below).
   - `score` — lines are clipped as lines (split at every crossing, the pieces on material
     kept), and a line drawn twice a few microns off itself is burnt once (`dropNearDuplicates`).
     Closed shapes are scored as the outline of what they PAINT — the union, one colour, as the
     picker's card — never each shape's own outline. With `hostOutline` the host traces that
     union with its boolean (`result.outline`: the shapes and the zone to clip the outline to,
     as lines); without, the fill traces it here by parity, exact only where shapes meet edge
     to edge.
   - `engrave` — closed shapes are clipped to the outline: exactly for convex ones, through
     `clipPolygons` (the host's boolean — manifold's `intersectShapes`) for concave ones, else
     kept whole with `stats.unclipped` counting them and `result.zone` saying where the host must
     trim them. Lines ride along as paths. A pattern with `erode` (below) asks the host to erode
     what it paints, for Engrave and Score (`result.erode`).

## Cut as a lattice

Every pattern can be cut. One whose `ops` list `cut` punches its own holes (above); any other —
asanoha, kikkō, cubes, rays, every stroke tile, and a fill tile whose shapes touch (a measured
web of 0) — is cut the way a laser-cut lattice card is: the lines stay as wooden struts `web`
wide and the faces between them are cut out. The drawing thickened is exactly what a Score burns
(the lines, and the outline of the shapes — an edge two cells share cancels, one where shapes
cross stays).

Everything past the lines is polygon booleans, which this package does not have, so it is two
calls — the second in the host (the studio's worker):

```ts
const r = fillShape(region, def, { op: 'cut', web: 1.5, inset: 4 });
r.lattice   // LatticeCut: { name, region, inset, runs, outlines, solids, web, minWidth, minArea, scale, period? }
const { faces, stats, warnings, zoom } = latticeFaces(r.lattice, {
  offset: (shapes, d, coarse) => /* host offset, round joins (coarse: octagon arcs are fine) */,
  subtract: (a, b) => /* host a − b, b read as a union */,
  outline: (rings) => /* the boundary of what the rings cover, even-odd */,
});
faces       // one ring per face to cut — or none, and one sentence in `warnings` saying why
stats       // { faces, cells, coverage, areaCoverage, tooSmall, pruned, snapped, loose, solid, tight }
zoom        // too fine here: the zoom, %, it cuts from
```

`@vostok/patterns/lattice` exports the second half alone, for a worker that should not pull in
the pattern registry. The lines first become the runs a lattice can HOLD (`src/lattice-graph.ts`):
a near miss is joined (an end carries straight on to a line within two webs × zoom, or snaps to
one within a web), and every strut that hangs — a bridge of the graph, with the frame and every
solid one node: a ray with nothing at its tip, a stub, a coil, a loop on a stick — is taken
away, as is a free loop too narrow to hold a cut. Then the rules (`src/lattice.ts` has the
numbers and why):

1. **A solid frame.** Faces are taken inside the region shrunk by `inset` (≥ `web`) — by the
   host's offset, since a vertex offset folds on a card's rounded corner — so every strut lands
   on a border of material. The region's holes (reserves) and the pattern's `solids` (the hub
   Rays lands on — left out under a reserve, where the rays land on the reserve) keep the same
   distance and hold the struts that reach them. The zone is opened by 1 mm, so where a panel's
   inset nearly meets the border's there is wood, not a kerf slot.
2. **No confetti, no hairlines.** A face that cannot hold a 1 mm disc, or is under 2 mm², stays
   material; so does every part of a face under 1 mm wide and over 2 mm long (a crack where two
   struts' sides meet, a point running into a corner) — a corner's own point stays sharp.
3. **No loose struts.** A ring floating inside a face goes with that face, cut whole — unless
   the face is its region's background (≥ ¼ of it), what floats inside is more than half the
   face (concentric rings), or it would drop a reserve; then the face stays material.
4. **The web, everywhere.** Every edge of a band lies `web/2` off its line (mitred ribbons,
   tangent fans and caps); faces still closer than that leave all but the biggest as material;
   a face that comes back round on itself closer than the web — hanging a panel's bump or a
   motif on a neck — stays material too.
5. **No cantilevers, no windows.** Nothing hangs (above); a hole-less face a quarter of its
   region is not a cell and stays material — nor, on a band or a ring round a panel, is a face
   lying along the zone's edge and far roomier than the pattern's cells, or a moat along a
   quarter of a panel's edge.
6. **It reads as the pattern, or nothing is cut.** The cells are counted at zero width, so one
   that vanishes under its struts counts: under 60 % of them cut and under half their area,
   under half the area that could open cut, a solid quarter of the region, a stretch of plain
   wood three times the pattern's own cells, or under 1 % opened — nothing is cut, and the
   sentence says what would work: the zoom it cuts from (worked out from the cells, with a
   margin for the points rule 2 trims), zooming out (a piece under two periods across), or
   scoring it.

## Writing a pattern

A tiled pattern is a cell and one period; a field pattern draws into a box. Both hand back
`{ holes, lines, slits }` — closed shapes, decoration lines, and lines that are safe to cut
through. Put the motif on the cell's centre. Draw only what the cell owns where you can; where a
whole polygon is clearer, draw it and let the merge drop the shared edges.

```ts
export const honeycomb: PatternDef = {
  id: 'honeycomb', name: 'Honeycomb', family: 'geometric', tags: ['holes', 'hexagon'],
  blurb: 'Hexagonal holes leaving a honeycomb web.',
  ops: ['cut', 'engrave', 'score'],                     // first = default
  params: [SIZE(8, 2, 80, 'Hole size'), GAP(2)],        // the studio renders these as its own field kinds
  cell: (p) => { const pitch = num(p, 'size') + num(p, 'gap'); return { w: pitch, h: pitch * SQRT3 }; },
  tile: (p) => {
    const s = num(p, 'size'); const pitch = s + num(p, 'gap');
    return { holes: [[hexagon(pitch / 2, (pitch * SQRT3) / 2, s)], [hexagon(0, 0, s)]], lines: [], slits: [] };
  },
  web: (p) => num(p, 'gap'),                            // what the pattern leaves between its own holes
};
```

Rules a pattern must keep:

- **Holes never overlap or touch** at legal params; `web(p)` reports the narrowest gap so the
  fill can warn against the caller's minimum.
- **A closed hole is simple** (one ring). An island with counters is an engrave region; as a
  cut, only its outer ring is used (an annulus would drop its middle on the bed).
- **`lines` are never cut through** (under a cut they are the lattice's struts); **`slits`
  are** — only a hinge should put anything in `slits`.
- **Y up**: `+y` is up on the finished piece (seigaiha's fans open upward).
- **Deterministic**: a random field takes a `seed` param and hashes the cell, not the call
  order, so scrolling the region does not reshuffle it.
- **No artwork**: procedural only. Traced or drawn tiles go through `svgTilePattern` with a
  `source` (see the library) and a licence that owes nothing on a customer's export.

Register in `src/patterns/index.ts` (one line), run the suite (it drives every registered
pattern through every op it claims) and look at `pnpm sheet`.

## The tile library

`import { LIBRARY, LIBRARY_TILES, tileById, tileSvg, inspireLook } from '@vostok/patterns/library'`
— Pattern Monster's 330 free tiles (MIT, © 2020–2023 pattern.monster) as patterns, lazy so the
procedural half never pays for the ~900 KB of path data; `@vostok/patterns/library-index` is the
70 KB metadata file (id, title, mode, tags, the site's own slider ranges, a measured default
size) a picker lists and filters without the geometry.

- `tileSvg(tile, look, w, h)` is an exact clone of the site's renderer — the same `<pattern>`
  markup, stroke/join rules, zoom · rotate · spacing · slide — so a gallery card here is the
  card there; `inspireLook(tile, seed, colours)` is their "Inspire me"; `MONSTER_DARK/LIGHT`
  their palettes. `pnpm sheet --cards --tag=x --only=a,b` renders cards to hold against the site.
- `svgTilePattern({ width, height, paths, mode, maxSpacing, maxStroke })` turns any SVG tile
  into a `PatternDef` with the site's knobs: `size` (the period, mm), `spacingX/Y` where the
  tile allows it, `stroke` for line tiles (engraved as bands of that width via `strokeWidth`).
  Stroke tiles become lines (score, or engraved bands), clipped to the cell as the `<pattern>`
  clips them (a line along the cell's edge a hair outside it is the edge's own line, and stays).
  Fill tiles are read the way a browser paints the card: each colour layer by SVG's **nonzero**
  rule, decided by the winding number (a lone ring is paint whichever way it runs), an open
  subpath filled as if closed, zero-width spikes and keyhole slits taken out, a ring drawn twice
  collapsed only when its vertices agree; overlapping paint unions (the consumer's job: nonzero
  fill or manifold's Positive rule), and a full-cell ring is a background unless it carries
  holes. A shape whose overhang the card shows bare is cut at its cell; a motif the tile repeats
  across its edge stays whole. `tests/library-import.test.mjs` holds every tile to its own SVG,
  pixel for pixel, within 1 %. Fill tiles carry a **measured** `web` (least distance between
  islands over 3 × 3 cells), so a tile whose shapes touch is cut as a lattice on its outlines
  rather than dropping loose pieces.
- `library/tuning.ts` (`TILE_TUNING`) says which tiles the picker leaves out (`hidden` —
  `PICKER_TILES` is the rest) and which have their lines between shapes drawn thicker
  (`thicken`, tile units → `PatternDef.erode`).
- Each tile's default `size` is measured by the fetch script: about 0.45 mm per tile unit (the
  site's look on a coaster), raised for stroke tiles whose lines would crowd under 0.8 mm.
- Every library pattern carries `source`; the licence text sits in `data/` and goes into every
  bundle's THIRD-PARTY-NOTICES (`scripts/third-party-notices.mjs` adds it for any app that
  depends on this package).

## Clipping, exactly

Lines are clipped as lines. Closed shapes crossing the edge are clipped exactly: convex ones by
Sutherland–Hodgman, everything else by the general intersection in `clip.ts` — the boundary of
A ∩ B is the parts of A's edges inside B plus the parts of B's edges inside A, both already
computed by the line clipper, chained back into loops at their shared crossing points (snapped
by proximity, zero-length pieces dropped, degenerate rings discarded, many-ringed islands
retried ring by ring). Only a crossing that lands on a vertex still defeats it; those shapes are
handed to `clipPolygons` (the host's boolean) or kept whole with `stats.unclipped` counting
them — two of the 330 tiles, in a disc.

## Pickers

`thumbPath(def)` renders a 40 × 40 tile of the pattern as one SVG path `d` — the studio's
`thumbs` field takes exactly that. A field pattern that needs different numbers at that size
says so in `def.thumb`.

## Layout

```
src/types.ts        the vocabulary (PatternDef, FillOptions, FillResult, PatternGeometry)
src/fill.ts         fillShape — the one entry point; insetShapes
src/lattice.ts      cut as a lattice: latticeOf (the recipe), latticeFaces (struts, faces, rules — host booleans)
src/lattice-graph.ts the runs a lattice can hold (near misses joined, cantilevers pruned) and their cells
src/tiler.ts        repeat a cell over a box
src/clip.ts         lines clipped to a region, convex polygon clip, segment merge, EdgeIndex
src/geom.ts         primitives: circle, arc, hexagon, regularPolygon, roundedRect, slot, star…
src/svgpath.ts      SVG path data → polylines/rings (M L H V C S Q T A Z, arcs, flags)
src/svg.ts          fillSvg (a preview), thumbPath (a picker tile)
src/patterns/       geometric · lattices (incl. the Japanese hex family) · hinges · fields
src/library/        svgTilePattern + the Pattern Monster data
tests/run.mjs       the suite; tests/sheet.mjs the contact sheet (sharp, no browser)
tests/library-import.test.mjs  every library tile against its own SVG, within 1 % (sharp, no browser)
```
