// An SVG tile as a pattern. Give it what an SVG `<pattern>` would hold — a width, a height and
// the path data of its `<path>` elements — and it becomes a tiled PatternDef whose knobs are
// the tile library's own: the period in mm, the spacing the tile allows, and the stroke width
// its lines are engraved at. Stroke tiles become lines (score, or engraved bands); fill tiles
// become closed shapes (engrave, and cut where the shapes leave a web — measured, not
// assumed). The `source` travels with it, because this is the one kind of pattern that did
// not come from maths.
//
// A fill tile is read the way a browser paints it, because the picker's card IS a browser
// painting it: each `<path>` filled by SVG's nonzero rule, an open subpath filled as if closed,
// and the whole tile clipped to its cell by the `<pattern>`. `tests/library-import.test.mjs`
// holds every tile to its own SVG, pixel for pixel, within 1 %.
import { EdgeIndex, clipIslandToRegion, clipPolylines, clipToConvex, sameRing } from '../clip';
import { bboxOfShapes, pointInRing, pointSegmentDistance, segmentDistance, signedArea } from '../geom';
import { number, num } from '../params';
import type { Box, Island, ParamSpec, PatternDef, PatternGeometry, PatternSource, Polyline, Pt, Ring } from '../types';

export interface SvgTileSpec {
  id: string;
  name: string;
  /** The tile's own units, as its SVG `<pattern>` would declare them. */
  width: number;
  height: number;
  /** Path data (`d`) of each `<path>`, in the tile's units, SVG orientation (Y down). */
  paths: string[];
  /** `stroke` / `stroke-join`: the paths are lines. `fill`: the paths are filled regions. */
  mode: 'stroke' | 'stroke-join' | 'fill';
  tags?: string[];
  blurb?: string;
  source?: PatternSource;
  /** The period in mm at which the tile reads well. Default 20. */
  defaultSize?: number;
  /** The most spacing the tile allows, tile units, [x, y] — Pattern Monster's own ranges. */
  maxSpacing?: [number, number];
  /** The widest stroke the tile is drawn with, tile units. Default 6. */
  maxStroke?: number;
  /** For fill tiles: drop any ring covering more than this share of the cell — a background
   *  rectangle is not a motif. Default 0.9. */
  backgroundShare?: number;
  /** For fill tiles: tile units by which the lines between the shapes are drawn thicker — the
   *  painted region eroded by half this (`PatternDef.erode`). */
  thicken?: number;
}

type Flatten = (d: string, tol: number) => { rings: Ring[]; polylines: Polyline[] };

/** The cell as a clip region: the rectangle the tile is allowed to paint in.
 *
 *  A hair larger than the cell on every side, so a line drawn exactly ON the cell edge — the
 *  wrap copy of a motif, which most of these tiles carry — is kept rather than landing on the
 *  boundary and being judged out. The overlap is far below a kerf and the neighbouring cell
 *  draws the same hair, so nothing shows. */
function cellIndex(cell: Box, e: number): EdgeIndex {
  return new EdgeIndex([[boxRing({ minX: cell.minX - e, minY: cell.minY - e, maxX: cell.maxX + e, maxY: cell.maxY + e })]]);
}

/**
 * A stroke tile's lines clipped to its cell (`index`, a hair of `e` larger) — except a stretch
 * that runs ALONG an edge just outside it, within `reach`. That is the edge's own line, drawn a
 * little over it: Lines - 6 draws its chevrons' stubs at x = −0.03, Lines - 5 its seam at
 * x = −0.17, and the card shows them because a stroke reaches half its width into the cell. The
 * clip judged them out and the chevrons lost a stub at every other seam. A line with no such
 * stretch goes through the clip untouched.
 */
function clipStrokes(lines: Polyline[], index: EdgeIndex, cell: Box, e: number, reach: number): Polyline[] {
  const along = (a: Pt, b: Pt): Polyline | null => {
    const vertical = Math.abs(a[0] - b[0]) <= 1e-9 * (1 + Math.abs(a[1] - b[1]));
    const horizontal = Math.abs(a[1] - b[1]) <= 1e-9 * (1 + Math.abs(a[0] - b[0]));
    const outside = (v: number, lo: number, hi: number) => (v < lo - e && v >= lo - reach) || (v > hi + e && v <= hi + reach);
    if (vertical && outside(a[0], cell.minX, cell.maxX)) {
      const y0 = Math.max(cell.minY, Math.min(a[1], b[1]));
      const y1 = Math.min(cell.maxY, Math.max(a[1], b[1]));
      return y1 > y0 ? [[a[0], y0], [a[0], y1]] : [];
    }
    if (horizontal && outside(a[1], cell.minY, cell.maxY)) {
      const x0 = Math.max(cell.minX, Math.min(a[0], b[0]));
      const x1 = Math.min(cell.maxX, Math.max(a[0], b[0]));
      return x1 > x0 ? [[x0, a[1]], [x1, a[1]]] : [];
    }
    return null;
  };
  const out: Polyline[] = [];
  const rest: Polyline[] = [];
  for (const line of lines) {
    let from = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const edge = along(line[i]!, line[i + 1]!);
      if (!edge) continue;
      if (edge.length) out.push(edge);
      if (i > from) rest.push(line.slice(from, i + 1));
      from = i + 1;
    }
    rest.push(from ? line.slice(from) : line);
  }
  return [...clipPolylines(rest.filter((l) => l.length >= 2), index), ...out];
}

/** Least distance between any two islands of a tiled fill (3 × 3 cells), mm — the web a cut
 *  would leave; 0 when shapes touch or overlap and a cut would drop the material between. */
function measureWeb(holes: Island[], cell: { w: number; h: number }): number {
  const outers: Ring[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const island of holes) outers.push(island[0]!.map(([x, y]): Pt => [x + i * cell.w, y + j * cell.h]));
  const boxes = outers.map((r) => bboxOfShapes([[r]]));
  let best = Infinity;
  for (let a = 0; a < outers.length; a++) {
    for (let b = a + 1; b < outers.length; b++) {
      const A = boxes[a]!;
      const B = boxes[b]!;
      const gap = Math.max(B.minX - A.maxX, A.minX - B.maxX, B.minY - A.maxY, A.minY - B.maxY);
      if (gap >= best) continue;
      const ra = outers[a]!;
      const rb = outers[b]!;
      for (let i = 0; i < ra.length && best > 0; i++) {
        const p = ra[i]!;
        const q = ra[(i + 1) % ra.length]!;
        for (let j = 0; j < rb.length; j++) {
          const d = segmentDistance(p, q, rb[j]!, rb[(j + 1) % rb.length]!);
          if (d < best) best = d;
          if (best <= 1e-6) return 0;
        }
      }
    }
  }
  return Number.isFinite(best) ? best : Infinity;
}

/** Identical rings (a subpath drawn twice) collapse to one: a fingerprint finds the candidates,
 *  the vertices decide. */
function dedupeRings(rings: Ring[], tol: number): Ring[] {
  const seen = new Map<string, Ring[]>();
  const out: Ring[] = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    let x = 0;
    let y = 0;
    for (const p of r) {
      x += p[0];
      y += p[1];
    }
    const k = `${r.length}|${Math.round(signedArea(r) * 1e4)}|${Math.round((x / r.length) * 1e4)},${Math.round((y / r.length) * 1e4)}`;
    const same = seen.get(k);
    if (same?.some((q) => sameRing(q, r, tol))) continue;
    if (same) same.push(r);
    else seen.set(k, [r]);
    out.push(r);
  }
  return out;
}

/**
 * The ring without its zero-width spikes: a vertex the outline runs out to and straight back
 * from. A browser paints nothing there, but a spike that crosses the zone's edge is a loop with
 * no area, which the clip cannot close — and an island it cannot clip used to be engraved whole,
 * into the border (Triangles - 9 draws `…L40 31.36V60z`: up to y 60 and back down its own line).
 * A ring with no spike is returned as it came, vertex for vertex.
 */
function withoutSpikes(ring: Ring): Ring {
  const spike = (a: Pt, b: Pt, c: Pt): boolean => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < 1e-12 || lv < 1e-12) return false;
    // Straight back: the two sides at b run opposite ways along one line.
    return ux * vx + uy * vy < 0 && Math.abs(ux * vy - uy * vx) <= 1e-3 * lu * lv;
  };
  const n = ring.length;
  if (!ring.some((b, i) => spike(ring[(i + n - 1) % n]!, b, ring[(i + 1) % n]!))) return ring;
  const r = [...ring];
  for (let i = 0; r.length >= 3 && i < r.length; ) {
    const m = r.length;
    if (spike(r[(i + m - 1) % m]!, r[i]!, r[(i + 1) % m]!)) {
      r.splice(i, 1);
      // The vertex before may be a spike's tip now: look again from there.
      i = Math.max(0, i - 1);
    } else i++;
  }
  return r;
}

/**
 * The ring cut along its zero-width slits: an edge it runs out along and, later, straight back
 * along (a keyhole). Squares - 1 draws each square frame as one ring — round the outside, in
 * along a slit, round the inside and back out — and a browser paints the frame; the slit has no
 * width. Cut there, it is the frame's outline and its hole, which the nonzero reading then sorts
 * out, and which a clip at the zone's edge can close. A ring with no slit comes back as it went.
 */
function withoutSlits(ring: Ring): Ring[] {
  const key = (p: Pt) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const n = ring.length;
  const edges = new Map<string, number>();
  for (let i = 0; i < n; i++) edges.set(`${key(ring[i]!)}>${key(ring[(i + 1) % n]!)}`, i);
  for (let i = 0; i < n; i++) {
    const a = key(ring[i]!);
    const b = key(ring[(i + 1) % n]!);
    if (a === b) continue;
    const j = edges.get(`${b}>${a}`);
    if (j === undefined || j === i) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    // Each side of the slit is a loop that ends where it began.
    const open = (loop: Ring): Ring => (loop.length > 1 && key(loop[0]!) === key(loop[loop.length - 1]!) ? loop.slice(0, -1) : loop);
    return [open(ring.slice(lo + 1, hi + 1)), open([...ring.slice(hi + 1), ...ring.slice(0, lo + 1)])].filter((r) => r.length >= 3).flatMap(withoutSlits);
  }
  return [ring];
}

/** SVG's nonzero winding number of a point about one ring. */
function windingAt(p: Pt, ring: Ring): number {
  let w = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && side > 0) w++;
    } else if (b[1] <= p[1] && side < 0) w--;
  }
  return w;
}

/**
 * A layer's rings as islands, painted the way SVG paints them — the NONZERO rule, decided by the
 * winding number itself. Each ring's edges are asked which of their two sides is paint: a ring
 * whose edges have the paint inside is an outline, one whose edges have it outside is a hole
 * (joining the smallest outline that holds it), and one with paint on both sides or neither is
 * no boundary at all. A lone ring is paint whichever way it runs: Flower - 3's petals and
 * Batik - 2's dots are drawn "backwards", and a guess from the largest ring's winding lost them.
 * Overlapping outlines stay separate islands — the consumer's union makes them one region.
 */
function nonzeroIslands(rings: Ring[], eps: number): Island[] {
  if (!rings.length) return [];
  const areas = rings.map(signedArea);
  const boxes = rings.map((r) => bboxOfShapes([[r]]));
  const painted = (p: Pt): boolean => {
    let w = 0;
    for (let i = 0; i < rings.length; i++) {
      const b = boxes[i]!;
      if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY) continue;
      w += windingAt(p, rings[i]!);
    }
    return w !== 0;
  };
  const paint: { r: Ring; i: number; area: number }[] = [];
  const holes: number[] = [];
  rings.forEach((r, i) => {
    const s = Math.sign(areas[i]!) || 1;
    let outline = 0;
    let hole = 0;
    for (let j = 0; j < r.length; j++) {
      const a = r[j]!;
      const b = r[(j + 1) % r.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < eps * 10) continue;
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // A hair to the ring's own inside, and a hair out.
      const nx = (-(b[1] - a[1]) / len) * s * eps;
      const ny = ((b[0] - a[0]) / len) * s * eps;
      const inside = painted([m[0] + nx, m[1] + ny]);
      const outside = painted([m[0] - nx, m[1] - ny]);
      if (inside && !outside) outline++;
      else if (!inside && outside) hole++;
    }
    if (outline > 0 && outline >= hole) paint.push({ r, i, area: Math.abs(areas[i]!) });
    else if (hole > 0) holes.push(i);
  });
  paint.sort((a, b) => a.area - b.area);
  const islands = new Map<number, Island>();
  for (const p of paint) islands.set(p.i, [p.r]);
  for (const i of holes) {
    const owner = paint.find((p) => p.area > Math.abs(areas[i]!) && pointInRing(rings[i]![0]!, p.r));
    if (owner) islands.get(owner.i)!.push(rings[i]!);
  }
  return [...islands.values()];
}

/** The rectangle `b` as a ring. */
const boxRing = (b: Box): Ring => [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];

/** An island clipped to a rectangle: the general clip, else ring by ring (a crossing on a vertex
 *  defeats the chaining; Sutherland–Hodgman against a rectangle never fails). */
function clipIsland(island: Island, cell: Box): Island[] {
  const pieces = clipIslandToRegion(island, new EdgeIndex([[boxRing(cell)]]));
  if (pieces) return pieces;
  const [outer, ...holes] = island.map((r) => clipToConvex(r, boxRing(cell)));
  if (!outer || outer.length < 3 || Math.abs(signedArea(outer)) < 1e-9) return [];
  return [[outer, ...holes.filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 1e-9)]];
}

/**
 * The tile clipped to its cell, as the `<pattern>` clips it — whole motifs kept whole.
 *
 * Pattern Monster draws a motif that crosses the cell's edge twice (or four times, on a corner):
 * once where it crosses, and again one period over, so each copy's overhang is painted anyway by
 * the neighbouring cell and the card shows the motif whole across the seam. A shape whose overhang
 * the neighbours paint like that is left exactly as drawn: clipped, each motif would come apart
 * into pieces meeting on the seam, and a cut would read the seam as a web of nothing. Only a shape
 * whose overhang lands where the card shows NO ink is cut off at the cell's edge, as the card cuts
 * it: Scales - 2's discs are half discs there, Halloween - 5's lattice stops at its cell.
 */
function clipToCell(holes: Island[], cell: Box, tol: number): Island[] {
  const w = cell.maxX - cell.minX;
  const h = cell.maxY - cell.minY;
  const boxes = holes.map((island) => bboxOfShapes([island]));
  const inIsland = (p: Pt, i: number): boolean => {
    const b = boxes[i]!;
    if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY) return false;
    const island = holes[i]!;
    return pointInRing(p, island[0]!) && !island.slice(1).some((r) => pointInRing(p, r));
  };
  // What the tile paints inside its own cell — all a neighbour shows of it.
  const painted = (p: Pt): boolean => p[0] >= cell.minX && p[0] <= cell.maxX && p[1] >= cell.minY && p[1] <= cell.maxY && holes.some((_, i) => inIsland(p, i));
  // A grid over the overhang, twenty samples or so a side: the share of it the card shows as bare.
  // Not on the shape's own outline, where a copy drawn a last decimal off decides nothing; and
  // offset off the grid the data is drawn on, so a row of samples never runs down an edge.
  const bare = (i: number): boolean => {
    const b = boxes[i]!;
    if (b.minX >= cell.minX - tol && b.maxX <= cell.maxX + tol && b.minY >= cell.minY - tol && b.maxY <= cell.maxY + tol) return false;
    const step = Math.max(Math.min(w, h) / 100, Math.sqrt(((b.maxX - b.minX) * (b.maxY - b.minY)) / 400));
    const edges = holes[i]!.flatMap((r) => r.map((a, j): [Pt, Pt] => [a, r[(j + 1) % r.length]!]));
    let samples = 0;
    let uncovered = 0;
    for (let x = b.minX + step * 0.382; x < b.maxX; x += step) {
      for (let y = b.minY + step * 0.618; y < b.maxY; y += step) {
        const di = x < cell.minX ? -1 : x > cell.maxX ? 1 : 0;
        const dj = y < cell.minY ? -1 : y > cell.maxY ? 1 : 0;
        if ((!di && !dj) || !inIsland([x, y], i)) continue;
        // The neighbouring cell paints this point iff the tile paints it one period back.
        const covered = painted([x - di * w, y - dj * h]);
        if (!covered && edges.some(([a, c]) => pointSegmentDistance([x, y], a, c) < tol)) continue;
        samples++;
        if (!covered) uncovered++;
      }
    }
    return uncovered > Math.max(2, samples / 50);
  };
  const cut = holes.map((_, i) => bare(i));
  // In the order the tile drew them; a tile with nothing to cut comes back as it went in.
  if (!cut.some(Boolean)) return holes;
  return holes.flatMap((island, i) => (cut[i] ? clipIsland(island, cell) : [island]));
}

export function svgTilePattern(spec: SvgTileSpec, flatten: Flatten): PatternDef {
  const W = spec.width;
  const H = spec.height;
  const isFill = spec.mode === 'fill';
  const maxSpacing = spec.maxSpacing ?? [0, 0];
  const cache = new Map<string, { geo: PatternGeometry; web: number }>();

  const build = (p: Record<string, unknown>): { geo: PatternGeometry; web: number } => {
    const size = num(p as never, 'size');
    const k = size / W;
    const sx = maxSpacing[0] > 0 ? num(p as never, 'spacingX') : 0;
    const sy = maxSpacing[1] > 0 ? num(p as never, 'spacingY') : 0;
    const key = `${k}|${sx}|${sy}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const tol = Math.max(0.02, Math.min(W, H) / 400);
    const layers: Ring[][] = [];
    const lines: Polyline[] = [];
    // The tile sits at the top of its cell (`cell` below): the horizontal spacing is air split
    // either side of it, as Pattern Monster moves half of it in front, and the vertical spacing
    // is air under it.
    const toMm = ([x, y]: Pt): Pt => [(x + sx / 2) * k, (H - y) * k];
    for (const d of spec.paths) {
      const flat = flatten(d, tol);
      const rings = flat.rings.map((r) => r.map(toMm));
      if (isFill) {
        // SVG fills an open subpath as if it were closed — Zebra's stripes, Leaves - 4 — and one
        // of two points encloses nothing, so it paints nothing.
        for (const l of flat.polylines) {
          if (l.length < 3) continue;
          const first = l[0]!;
          const last = l[l.length - 1]!;
          rings.push((Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9 ? l.slice(0, -1) : l).map(toMm));
        }
      } else for (const l of flat.polylines) lines.push(l.map(toMm));
      layers.push(rings);
    }
    let geo: PatternGeometry;
    let web = Infinity;
    // The `<pattern>` cell: the tile's width and its spacing across, its height with the air BELOW
    // it, where Pattern Monster puts it (the tile is drawn at the top of a cell H + sy tall, and
    // y down in the tile is down here too).
    const cell: Box = { minX: 0, maxX: (W + sx) * k, minY: -sy * k, maxY: H * k };
    if (!isFill) {
      // Clipped to the cell, because that is what an SVG `<pattern>` does and these tiles are
      // drawn for one.
      //
      // Several of them draw far outside their own cell and let the pattern element cut it
      // back: `scales-4` is a 25 × 13 cell holding circles of radius 12.5 — twice its own
      // height. Repeating that unclipped lays a full circle down per cell, and the result is a
      // thicket of overlapping rings with no scales in it at all (2026-09-22: the waves pattern
      // did not work at all). The card preview looked right the whole time, because the
      // card IS an SVG `<pattern>` and the browser was clipping it.
      //
      // Once per tile, not once per cell: this runs inside the memoised `build`, so a field of
      // four hundred cells clips nothing — it copies geometry that is already cut to size.
      //
      // Only the imported tiles. A procedural pattern's cell is centred on its motif and is MEANT
      // to overflow — a hexagon on a corner belongs to four cells — which is why the tiler does
      // not do this for everyone.
      const all = [...lines, ...layers.flat().map((r): Polyline => [...r, r[0]!])];
      const e = Math.max(W + sx, H + sy) * k * 1e-4;
      // Half the card's stroke (1 tile unit): how far outside the cell a line along its edge still
      // shows in it.
      geo = { holes: [], lines: clipStrokes(all, cellIndex(cell, e), cell, e, 0.5 * k), slits: [] };
    } else {
      const cellArea = (W + sx) * (H + sy) * k * k;
      const share = spec.backgroundShare ?? 0.9;
      // A tenth of a hundredth of a tile unit: the most two copies of one ring in Pattern
      // Monster's three-decimal data differ by (Halloween - 5's by 0.005).
      const same = 0.01 * k;
      // Each path is one colour layer, painted over the ones before it, with SVG's default
      // NONZERO rule (`nonzeroIslands`); a ring covering the whole cell is that layer's
      // background unless it carries holes (a frame). The card paints every layer in one colour,
      // and so does the laser: the layers are simply more shapes.
      const holes: Island[] = [];
      for (const rings of layers) {
        for (const island of nonzeroIslands(dedupeRings(rings.flatMap((r) => withoutSlits(withoutSpikes(r))), same), k * Math.min(W, H) * 1e-4)) {
          if (island.length > 1 || Math.abs(signedArea(island[0]!)) < cellArea * share) holes.push(island);
        }
      }
      const clipped = clipToCell(holes, cell, same);
      geo = { holes: clipped, lines, slits: [] };
      web = measureWeb(clipped, { w: (W + sx) * k, h: (H + sy) * k });
    }
    const out = { geo, web };
    cache.set(key, out);
    return out;
  };

  const params: ParamSpec[] = [number('size', 'Tile size', spec.defaultSize ?? 20, 2, 200, 0.5)];
  if (maxSpacing[0] > 0) params.push(number('spacingX', 'Horizontal spacing', 0, 0, maxSpacing[0], 0.5, ''));
  if (maxSpacing[1] > 0) params.push(number('spacingY', 'Vertical spacing', 0, 0, maxSpacing[1], 0.5, ''));
  if (!isFill) params.push(number('stroke', 'Stroke', 1, 0.5, spec.maxStroke ?? 6, 0.5, '', 'How wide the lines are engraved. A score is always a hairline.'));

  return {
    id: spec.id,
    name: spec.name,
    family: 'library',
    tags: spec.tags ?? [],
    ...(spec.blurb ? { blurb: spec.blurb } : {}),
    ...(spec.source ? { source: spec.source } : {}),
    ops: isFill ? ['engrave', 'cut', 'score'] : ['score', 'engrave'],
    params,
    cell: (p) => {
      const k = num(p, 'size') / W;
      const sx = maxSpacing[0] > 0 ? num(p, 'spacingX') : 0;
      const sy = maxSpacing[1] > 0 ? num(p, 'spacingY') : 0;
      return { w: (W + sx) * k, h: (H + sy) * k };
    },
    tile: (p) => build(p).geo,
    ...(isFill ? { web: (p: Record<string, unknown>) => build(p).web } : {}),
    ...(isFill && spec.thicken ? { erode: (p: Record<string, unknown>) => (spec.thicken! / 2) * (num(p as never, 'size') / W) } : {}),
    // The stroke slider is in tile units, as on the site; in millimetres it scales with the tile.
    ...(!isFill ? { strokeWidth: (p: Record<string, unknown>) => (num(p as never, 'stroke') * num(p as never, 'size')) / W } : {}),
  } as PatternDef;
}
