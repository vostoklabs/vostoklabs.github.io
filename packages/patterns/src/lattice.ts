// Cut as a lattice — how a pattern of LINES is cut out.
//
// Every laser-cut lattice card does the same thing: the lines of the pattern stay as wooden
// struts and the spaces between them are cut away. So a "cut" of asanoha, kikkō, cubes, a
// diamond trellis, rays or any of Pattern Monster's stroke tiles is not a refusal any more: it is
// the scored drawing thickened into struts `web` wide, and every face between them punched out.
// A fill tile whose shapes TOUCH (plaid, hexagon-4) gets the same treatment on its outlines,
// which is the drawing a Score of it burns.
//
// Two halves, because the second is polygon booleans and this package has none:
//
//   `latticeOf`     pure, called by `fillShape` on the main thread: the lines clipped to the
//                   region — a recipe (`LatticeCut`) light enough to post to a worker.
//   `latticeFaces`  everything else, with the host's booleans (manifold, in the studio's worker):
//                   the runs a lattice can hold (`lattice-graph.ts`), a strut round each, the
//                   faces between them, and the rules below.
//
// The rules, and the numbers that hold them:
//   0. Motifs are no lattice. Shapes that stand apart on one background — stars, snowflakes, a
//      tile's motifs welded back across its cells' seams — are cut out as themselves, clipped at
//      the zone's edge: at their drawn size where they stand a web apart, and where two come
//      closer both giving way by half the shortfall; those then under the floors (a 0.8 mm slot,
//      2 mm²) left as wood (`motifCut`). So are the strokes of a stroke tile whose lines hold no
//      lattice. Topology decides, with the host's booleans: shapes joined by the kerf (two closer
//      than the laser leaves wood between are one cut) that cage cells or ring a reserve are a
//      network — a lattice, as below.
//   1. The edge is solid. Faces are taken inside the region shrunk by `inset` (≥ web), so a
//      frame of material runs round the lattice and every strut lands on it. The host shrinks
//      the region, because a vertex offset folds on a card's rounded corner and a boolean does
//      not — and opens it by the narrowest cut, so where a panel's inset nearly meets the
//      border's the zone's neck is wood, not a kerf slot along the panel.
//   2. No confetti, no hairlines. A face that cannot hold a `LATTICE_MIN_WIDTH` disc, or is
//      smaller than `LATTICE_MIN_AREA`, is not cut — it stays material, and `stats.tooSmall`
//      counts it. Nor is any PART of a face narrower than that and over twice as long: the crack
//      where two struts' sides meet, a point tapering into a corner (`stripHairlines`,
//      `stats.trimmed`).
//   3. No loose struts. A ring of strut connected to nothing (a dot's outline, a motif that
//      touches no other) sits in a HOLE of the face around it; that face is cut whole (its outer
//      ring), so the ring leaves with the offcut instead of dropping out of the bed on its own
//      (`stats.loose`) — while what floats inside is a crumb (at most half the face) and the
//      face holds none of the region's reserves or solids. Otherwise the face stays material
//      and only the faces inside it are cut (`stats.solid`).
//   4. The web holds everywhere: every edge of a band lies web/2 off its line — the straight
//      sides, the mitres of gentle bends, and the TANGENT polygons of corners and caps — so no
//      chord ever cuts inside the web/2 circle. Two ends that nearly meet would make a waist
//      narrower than that; they are joined before any band is built (`lattice-graph.ts`), and two
//      faces still closer than the web afterwards leave the smaller as material (`stats.tight`).
//      And a face that comes back round on ITSELF closer than the web — round a panel's bump, a
//      motif on a stick — would hang that wood on a neck: it stays material (`stats.necks`).
//   5. No cantilevers, no windows. A strut that hangs — ends in mid-air, or holds a loop on a
//      stick — is taken away (`lattice-graph.ts`): what is cut is held at both ends. And a face
//      that is not a cell but the space round a few lines stays material (`stats.solid`): a
//      quarter or more of its region; on a band or a ring round a panel, where a quarter is a big
//      window, one lying along the zone's edge and far roomier than the pattern's cells
//      (`windowOf`), or a moat along a good part of a panel's edge (`moatOf`).
//   6. It reads as a lattice, or it is not cut. The pattern's cells are counted at zero width,
//      before any strut (`lattice-graph.ts`), so a cell that vanishes under its struts counts as
//      much as one left as confetti. Unless `COVERAGE_MIN` of them are cut or `AREA_MIN` of their
//      area is, and `OPEN_SHARE_MIN` of the area that could open does (the flecks a band of
//      partial cells leaves), or when rule 5 would leave over `BACKGROUND_MAX` of the region
//      solid, the cut opens under `OPEN_MIN` of it, or a stretch of plain wood is wider than the
//      pattern's cells, the piece would be solid wood with a few flecks in it: nothing is cut,
//      and the sentence says what would work — the zoom the pattern cuts from (worked out from
//      its cells), zooming out, or scoring it.
import { EdgeIndex, clipPolylines, mergeLines } from './clip';
import { bboxOfPoints, poleOf, pointInRing, pointSegmentDistance, signedArea } from './geom';
import { holdRuns, type Cell, type HeldRun } from './lattice-graph';
import type { Box, DrawnLines, LatticeCut, LatticeStats, Polyline, Pt, Ring, Shapes } from './types';

/** What a template's status line says of a lattice cut before the worker has cut it — the host
 *  swaps it for the count of openings, or says nothing was cut, once `latticeFaces` has run. */
export const LATTICE_STATUS = 'cut as a lattice';

/** The narrowest opening worth cutting, mm: a face that cannot hold a disc this wide stays
 *  material. Ponoko's thickness-independent floor (laser-cutting-knowledge §2.1, §2.5) — under
 *  1 mm the beam burns the gap away rather than cutting a clean one. */
export const LATTICE_MIN_WIDTH = 1;

/** The smallest opening worth cutting, mm². §2.2: a hole much smaller than the stock is thick
 *  chars instead of cutting through, and a lattice card is cut from thin 1.5–2 mm stock — 2 mm²
 *  is a 1.6 mm disc, the smallest hole that stock takes cleanly. On 3 mm ply the customer's Web
 *  slider is the knob that grows the openings. */
export const LATTICE_MIN_AREA = 2;

/** A face is a CELL while it is under this share of its region; at or past it, it is the space
 *  round lines that barely divide the region (rule 5), or round motifs that never touch (rule 3),
 *  and stays material. A lattice face is a few per cent of any region it fills, so a quarter
 *  separates the two with room on both sides. */
const BACKGROUND_SHARE = 0.25;

/** A face with a loose ring inside is cut whole only while what floats inside it is at most this
 *  share of the face: a CRUMB in a cell (a dot, a little cross). Past it the face is a ring round
 *  a structure of its own — the annulus between two concentric rings — and cutting it whole
 *  takes every ring inside with it. */
const CRUMB_SHARE = 0.5;

/** Rule 6, by count: the share of the pattern's cells that, cut, is the pattern. */
export const COVERAGE_MIN = 0.6;

/** Rule 6, by area: the share of the cells' area that, cut, is the pattern — for a pattern that
 *  mixes big cells with small (asanoha's two triangles, a tile's stitching), where every big one
 *  cut is the pattern read at a glance though the small ones stay. Both measured on all 364
 *  lattices of the picker on a card and read off their renders: every sheet that looked like
 *  flecks in solid wood was under both (hexagon-11 40 % / 46 %, batik-4 44 % / 44 %, rings
 *  40 % / 16 %), and every one that looked like its pattern was over one of them. */
export const AREA_MIN = 0.5;

/** Rule 6, by what could open: the least share of the zone-less-struts that must be cut. Under
 *  it the piece is the pattern's struts with most of its openings left as wood — flecks, or
 *  stubs where hairlines were trimmed (yagasuri on a coaster at a 2 mm web keeps 36 %: its
 *  feathers' thin halves go and what is left is triangles). Every sheet read off the renders as
 *  its pattern keeps over half (waves-4 on a framed card 50 %, arcs; most keep 75–100 %). */
export const OPEN_SHARE_MIN = 0.5;

/** Rule 6: the least of the region the cut must open. Under it — a card with eight 2 mm stars
 *  in it — the pattern is not there to see, whatever share of its cells were cut. */
const OPEN_MIN = 0.01;

/** Rule 6: the most of the region rule 5 may leave solid — faces too big to be cells, with
 *  nothing in them. Past it the "lattice" is a plain piece with a few cuts round a solid patch. */
const BACKGROUND_MAX = 0.25;

/** Degrees of bend per step of a strut's rounded joint or cap: 30° keeps the tangent polygon
 *  within 3.5 % of the circle — the same reach as the sharpest mitre (`SHARP`) — while a
 *  library tile's thousands of joints stay nine points each. Facets 0.4 mm long on a 1.5 mm
 *  strut are under what a kerf can draw. */
const ARC_STEP = Math.PI / 6;

/** The host's booleans, on the package's own `Shapes` (islands of rings, any winding). */
export interface LatticeHost {
  /** Every island offset by `delta` mm — negative shrinks — with round joins. `coarse`: the
   *  joins' arcs may be as rough as an octagon's — for a test, or a kerf-sized rounding no one
   *  will see; on thousands of curvy faces the fine arcs were most of a 300 mm build. */
  offset(shapes: Shapes, delta: number, coarse?: boolean): Shapes;
  /** `a − b`; `b` may be many overlapping islands, read as their union. */
  subtract(a: Shapes, b: Shapes): Shapes;
  /** The boundary of what `rings` cover by the EVEN-ODD rule, as rings (any winding, any
   *  order): where two rings share an edge it cancels, where one crosses another it stays. */
  outline(rings: Ring[]): Ring[];
}

export interface LatticeResult {
  /** The faces to cut, one ring per island, counter-clockwise. */
  faces: Shapes;
  stats: LatticeStats;
  warnings: string[];
  /** When the pattern is too fine to cut here: the zoom, %, from which it cuts. */
  zoom?: number;
}

/** A `LatticeCut` less its region and solids (a host layer carries those as its own geometry —
 *  the studio's `DesignLayer.shapes` and `minus`), plus what `latticeFaces` reported. */
export type LatticeSpec = Omit<LatticeCut, 'region' | 'solids'> & { stats?: LatticeStats };

/**
 * The lines of a pattern as a lattice cut of `region`: every run clipped to the region and
 * simplified, and the closed shapes whose outline is lines too (`outlines`) kept where they reach
 * the region — the struts are built round them by `latticeFaces`, in the host. Null when nothing
 * reaches the region: then there is no lattice, and a cut of the bare region would be a hole
 * where the pattern should be.
 */
export function latticeOf(
  lines: Polyline[], region: Shapes,
  o: { name: string; web: number; inset: number; outlines?: Ring[]; solids?: Shapes; scale?: number; period?: number; shapes?: Shapes; stroke?: number; hairline?: boolean; origin?: Pt; drawn?: DrawnLines; holes?: boolean; field?: boolean; thinnest?: number },
): { cut: LatticeCut; runs: Polyline[] } | null {
  if (o.web <= 0) return null;
  const runs = clipPolylines(lines, new EdgeIndex(region)).map((r) => simplifyRun(r, SIMPLIFY)).filter((r) => r.length >= 2);
  const b = bboxOfPoints(region.flatMap((island) => island[0] ?? []));
  const near = (ring: Ring): boolean => {
    const r = bboxOfPoints(ring);
    return ring.length >= 3 && r.maxX >= b.minX && r.minX <= b.maxX && r.maxY >= b.minY && r.minY <= b.maxY;
  };
  const outlines = (o.outlines ?? []).filter(near);
  // (A pattern whose lines reach the region is a lattice first, whatever its shapes do — argyle's
  // lines cross its diamonds' ground — and its shapes are tried as motifs only if that cuts nothing.)
  // As drawn: rule 0 reads each island's rings even-odd, with the host's boolean (`evenOddIslands`).
  const shapes = (o.shapes ?? []).filter((island) => !!island[0] && near(island[0]));
  if (!runs.length && !outlines.length) return null;
  // Strokes and hairlines may be cut as motifs (rule 0): their lines as drawn go with the recipe.
  const drawn = (o.stroke && o.stroke > 0) || o.hairline ? o.drawn : undefined;
  return {
    cut: {
      name: o.name, region, inset: Math.max(o.inset, o.web), runs, outlines, solids: o.solids ?? [], web: o.web,
      minWidth: LATTICE_MIN_WIDTH, minArea: LATTICE_MIN_AREA, scale: o.scale ?? 1, ...(o.period ? { period: o.period } : {}),
      ...(shapes.length ? { shapes } : {}),
      ...(o.stroke && o.stroke > 0 ? { stroke: o.stroke } : {}),
      ...(o.hairline ? { hairline: true } : {}),
      ...(o.holes ? { holes: true } : {}),
      ...(o.field ? { field: true } : {}),
      ...(o.origin ? { origin: o.origin } : {}),
      ...(drawn ? { drawn } : {}),
      ...(o.thinnest && o.thinnest > 0 ? { thinnest: o.thinnest } : {}),
    },
    runs,
  };
}

/**
 * Islands as the even-odd rule reads their rings — Engrave's fill, as the fill's own clip reads an
 * island: a ring inside a hole is ink again (Tribal - 1's square inside a square frame), so it is
 * an island of its own, with the rings just inside it its holes. Rule 0 unions islands as outers
 * and holes: read as drawn, that square was a second hole, and the motifs on it vanished from the
 * cut. Rings that nest are read by containment; an island whose rings CROSS — a tile's wrap-around
 * ring straddling its outer, Halloween - 5's sky — takes the host's even-odd boundary first
 * (containment read of crossing rings filled the sky, and cut it out as one opening).
 */
function evenOddIslands(shapes: Shapes, host: LatticeHost): Shapes {
  const out: Shapes = [];
  for (const island of shapes) {
    if (island.length < 2) {
      out.push(island);
      continue;
    }
    const drawn = island.map((r) => ({ r, a: Math.abs(signedArea(r)), box: bboxOfPoints(r) })).sort((x, y) => y.a - x.a);
    const rings = crossing(drawn) ? host.outline(island).map((r) => ({ r, a: Math.abs(signedArea(r)), box: bboxOfPoints(r) })).sort((x, y) => y.a - x.a) : drawn;
    const parent: number[] = [];
    const depth: number[] = [];
    rings.forEach((x, i) => {
      let at = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (boxWithin(x.box, rings[j]!.box) && pointInRing(x.r[0]!, rings[j]!.r)) { at = j; break; }
      }
      parent.push(at);
      depth.push(at < 0 ? 0 : depth[at]! + 1);
    });
    rings.forEach((x, i) => {
      if (depth[i]! % 2 === 0) out.push([x.r, ...rings.filter((_, j) => parent[j] === i).map((y) => y.r)]);
    });
  }
  return out;
}

/** Do any two of an island's rings (largest first) cross? Each smaller ring's points — up to
 *  `CROSS_PROBES` of them, evenly spaced — must all fall on one side of every larger ring. */
function crossing(rings: { r: Ring; box: Box }[]): boolean {
  for (let i = 1; i < rings.length; i++) {
    const r = rings[i]!.r;
    const step = Math.max(1, Math.floor(r.length / CROSS_PROBES));
    for (let j = 0; j < i; j++) {
      const big = rings[j]!;
      const b = rings[i]!.box;
      if (b.maxX < big.box.minX || b.minX > big.box.maxX || b.maxY < big.box.minY || b.minY > big.box.maxY) continue;
      const first = pointInRing(r[0]!, big.r);
      for (let k = step; k < r.length; k += step) if (pointInRing(r[k]!, big.r) !== first) return true;
    }
  }
  return false;
}
/** How many of a ring's points `crossing` asks. */
const CROSS_PROBES = 32;

/** How far a strut's centreline may move to lose a point, mm. The library's curves are
 *  flattened to a hundredth of a millimetre, which as struts is tens of thousands of quads for
 *  a card; at 0.05 the boolean does a fraction of the work and nothing a 0.1 mm kerf can show
 *  moves — and the struts keep their width exactly, since each band is built round the
 *  simplified line. */
const SIMPLIFY = 0.05;

/** Douglas–Peucker, iterative (a long spiral would overflow the recursive one): the points a
 *  run cannot lose without moving more than `tol`. */
function simplifyRun(run: Polyline, tol: number): Polyline {
  if (run.length <= 2) return run;
  const keep = new Uint8Array(run.length);
  keep[0] = 1;
  keep[run.length - 1] = 1;
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = pointSegmentDistance(run[k]!, run[i]!, run[j]!);
      if (d > best) { best = d; at = k; }
    }
    if (best > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return run.filter((_, k) => keep[k]);
}

/** A bend sharper than this is a CORNER: the run is split there and the corner gets a round
 *  fan. Gentler bends stay inside one ribbon with mitred sides, whose mitre reaches at most
 *  `1 / cos(15°)` = 1.035 × web/2 — a hair of extra strut, never less. */
const SHARP = Math.PI / 6;

/**
 * One run as a strut `width` wide, all rings counter-clockwise and overlapping on purpose (the
 * host's union makes them one band):
 *   · each SMOOTH stretch — no bend sharper than `SHARP` — is one ribbon: its two sides offset
 *     by width/2 with mitred joints, forward along the right, back along the left. A flattened
 *     curve is then a few dozen points, not a quad and a fan per point (a card of curvy
 *     library tiles was 70 000 points for the boolean before this);
 *   · a stretch whose ribbon would FOLD (a bend tighter than the strut is wide) falls back to a
 *     quad per segment and a fan per bend;
 *   · every corner gets a round fan on its outside, and each end a round cap — TANGENT
 *     polygons, whose edges touch the width/2 circle from outside.
 * So the strut is never narrower than `width`, at a bend or anywhere else. `capAt` may say an
 * end needs no cap (it lies where no face can reach).
 */
export function strutBands(run: Polyline, width: number, capAt: (p: Pt) => boolean = () => true): Ring[] {
  const h = width / 2;
  // Consecutive duplicates would give a segment no direction.
  const pts: Pt[] = [];
  for (const p of run) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push(p);
  }
  if (pts.length < 2) return pts.length ? [fan(pts[0]!, 0, 2 * Math.PI, h)] : [];
  const dirs: number[] = [];
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    dirs.push(Math.atan2(pts[i + 1]![1] - pts[i]![1], pts[i + 1]![0] - pts[i]![0]));
    lens.push(Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]));
  }
  const out: Ring[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const last = i === pts.length - 1;
    const turn = last ? 0 : wrap(dirs[i]! - dirs[i - 1]!);
    // A corner: a sharp bend, or one whose inner mitre would eat more than half a neighbouring
    // segment (a curl tighter than the strut) — the ribbon either side of it then cannot fold.
    const corner = Math.abs(turn) > SHARP || h * Math.tan(Math.abs(turn) / 2) > 0.5 * Math.min(lens[i - 1]!, lens[i] ?? Infinity);
    if (!last && !corner) continue;
    out.push(...smoothBand(pts, dirs, start, i, h));
    // The outside of a left turn is the right side, and the other way round.
    if (!last) out.push(fan(pts[i]!, turn > 0 ? dirs[i - 1]! - Math.PI / 2 : dirs[i - 1]! + Math.PI / 2, turn, h));
    start = i;
  }
  const end = pts[pts.length - 1]!;
  if (isLoop(pts)) {
    // A loop has no ends, only the joint where it closes: a fan like any other bend.
    const before = dirs[dirs.length - 1]!;
    const turn = wrap(dirs[0]! - before);
    if (Math.abs(turn) > 1e-9) out.push(fan(end, turn > 0 ? before - Math.PI / 2 : before + Math.PI / 2, turn, h));
  } else {
    // Round caps: a half-turn round each end, from one side of the strut to the other.
    if (capAt(end)) out.push(fan(end, dirs[dirs.length - 1]! - Math.PI / 2, Math.PI, h));
    if (capAt(pts[0]!)) out.push(fan(pts[0]!, dirs[0]! + Math.PI / 2, Math.PI, h));
  }
  return out;
}

/** The band round `pts[s..e]` (no bend in it sharper than `SHARP`): one mitred ribbon, or —
 *  where an offset side would run backwards, i.e. fold — a quad per segment and a fan per bend. */
function smoothBand(pts: Pt[], dirs: number[], s: number, e: number, h: number): Ring[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = s; i <= e; i++) {
    const a = dirs[Math.max(s, i - 1)]!;
    const b = dirs[Math.min(e - 1, i)]!;
    // The mitre: the bisector of the two left normals, long enough that both offset lines pass
    // through its tip.
    const mx = -Math.sin(a) - Math.sin(b);
    const my = Math.cos(a) + Math.cos(b);
    const ml = Math.hypot(mx, my);
    const k = h / Math.cos(wrap(b - a) / 2) / ml;
    const p = pts[i]!;
    left.push([p[0] + mx * k, p[1] + my * k]);
    right.push([p[0] - mx * k, p[1] - my * k]);
  }
  let folds = false;
  for (let j = 0; j < e - s && !folds; j++) {
    const dx = Math.cos(dirs[s + j]!);
    const dy = Math.sin(dirs[s + j]!);
    for (const side of [left, right]) {
      if ((side[j + 1]![0] - side[j]![0]) * dx + (side[j + 1]![1] - side[j]![1]) * dy <= 1e-9) folds = true;
    }
  }
  // Both butt ends pushed `OVERLAP` past their vertex, into the neighbour: a corner's fan and the
  // two stretches either side of it would otherwise share an edge exactly, and a boolean rounding
  // a shared edge leaves a crack — a hairline of face running into the strut to its centreline
  // (measured: a 0.87 mm "strut" on hexagon-4 that was a 1.5 mm strut with a slit in it).
  const back: Pt = [Math.cos(dirs[s]!) * OVERLAP, Math.sin(dirs[s]!) * OVERLAP];
  const on: Pt = [Math.cos(dirs[e - 1]!) * OVERLAP, Math.sin(dirs[e - 1]!) * OVERLAP];
  for (const side of [left, right]) {
    side[0] = [side[0]![0] - back[0], side[0]![1] - back[1]];
    side[side.length - 1] = [side[side.length - 1]![0] + on[0], side[side.length - 1]![1] + on[1]];
  }
  const ribbon: Ring = [...right, ...left.reverse()];
  if (!folds && signedArea(ribbon) > 0) return [ribbon];
  const out: Ring[] = [];
  for (let i = s; i < e; i++) {
    const ox = Math.cos(dirs[i]!) * OVERLAP;
    const oy = Math.sin(dirs[i]!) * OVERLAP;
    const a: Pt = [pts[i]![0] - ox, pts[i]![1] - oy];
    const b: Pt = [pts[i + 1]![0] + ox, pts[i + 1]![1] + oy];
    const nx = -Math.sin(dirs[i]!) * h;
    const ny = Math.cos(dirs[i]!) * h;
    // a-right, b-right, b-left, a-left: counter-clockwise.
    out.push([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]);
    if (i > s) {
      const turn = wrap(dirs[i]! - dirs[i - 1]!);
      if (Math.abs(turn) > 1e-9) out.push(fan(pts[i]!, turn > 0 ? dirs[i - 1]! - Math.PI / 2 : dirs[i - 1]! + Math.PI / 2, turn, h));
    }
  }
  return out;
}

/** How far each straight stretch of strut runs on past its end vertex, mm — far below anything
 *  a laser draws, far above a boolean's rounding. */
const OVERLAP = 0.01;

/** A run that ends where it began: it has a closing joint, not two ends. */
const isLoop = (run: Polyline): boolean => {
  const a = run[0];
  const b = run[run.length - 1];
  return run.length > 3 && !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
};

/** Radians into (−π, π]. */
const wrap = (a: number): number => {
  let t = a;
  while (t <= -Math.PI) t += 2 * Math.PI;
  while (t > Math.PI) t -= 2 * Math.PI;
  return t;
};

/**
 * The region swept round `c` from angle `from` through `sweep` (signed) at radius `h`, as a
 * polygon of TANGENTS: its two end points lie on the circle (where they meet the quads beside
 * them) and every other vertex is where two neighbouring tangents cross, `h / cos(step/2)` out.
 * Wound counter-clockwise whichever way it sweeps.
 */
function fan(c: Pt, from: number, sweep: number, h: number): Ring {
  const full = Math.abs(sweep) >= 2 * Math.PI - 1e-9;
  const k = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
  const step = sweep / k;
  const far = h / Math.cos(Math.abs(step) / 2);
  const at = (a: number, r: number): Pt => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const ring: Ring = [];
  if (full) {
    for (let j = 0; j < k; j++) ring.push(at(from + (j + 0.5) * step, far));
  } else {
    ring.push(c, at(from, h));
    for (let j = 1; j <= k; j++) ring.push(at(from + (j - 0.5) * step, far));
    ring.push(at(from + sweep, h));
  }
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

/** One face as the boolean handed it back: its outer ring (the largest), its holes, its box. */
interface Face {
  outer: Ring;
  holes: Ring[];
  box: Box;
  area: number;
  /** Cut WHOLE: a loose strut floats in one of its holes and leaves with it. */
  whole?: boolean;
  /** A motif piece with other pieces in its holes (`unnested`): how many, cut with it. */
  holds?: number;
  /** A motif piece the kerf joined from several (`kerfPieces`): the cells of 2 mm² its joins close
   *  — holes that lie in none of its drawn shapes — mm². */
  enclosed?: number;
}

function faceOf(island: Ring[]): Face | null {
  let at = -1;
  let best = 0;
  for (let i = 0; i < island.length; i++) {
    const a = Math.abs(signedArea(island[i]!));
    if (a > best) { best = a; at = i; }
  }
  if (at < 0) return null;
  const outer = island[at]!;
  return { outer, holes: island.filter((_, i) => i !== at), box: bboxOfPoints(outer), area: best };
}

const inBox = (p: Pt, b: Box): boolean => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
/** `a` inside `b`, give or take the boolean's re-tessellation. */
const boxWithin = (a: Box, b: Box, eps = 1e-3): boolean => a.minX >= b.minX - eps && a.maxX <= b.maxX + eps && a.minY >= b.minY - eps && a.maxY <= b.maxY + eps;
const round = (v: number) => Math.round(v * 100) / 100;

/** The faces whose outer ring holds `p`, found through a coarse grid of their boxes: a card's
 *  lattice has a few hundred faces and a coaster's a few thousand, and every erosion survivor
 *  and every nesting test asks this once. */
class FaceGrid {
  private readonly cells = new Map<string, Face[]>();
  constructor(faces: Face[], private readonly size: number) {
    for (const f of faces) this.each(f.box, (k) => {
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(f);
      else this.cells.set(k, [f]);
    });
  }
  private each(b: Box, fn: (k: string) => void): void {
    for (let x = Math.floor(b.minX / this.size); x <= Math.floor(b.maxX / this.size); x++) {
      for (let y = Math.floor(b.minY / this.size); y <= Math.floor(b.maxY / this.size); y++) fn(`${x},${y}`);
    }
  }
  holding(p: Pt): Face[] {
    const bucket = this.cells.get(`${Math.floor(p[0] / this.size)},${Math.floor(p[1] / this.size)}`) ?? [];
    return bucket.filter((f) => inBox(p, f.box) && pointInRing(p, f.outer));
  }
}

/** Faces by their boxes, for the ones whose box holds a given box — a strip's face, an opening's —
 *  without trying every face against every strip on a 300 mm piece. */
class BoxGrid {
  private readonly cells = new Map<string, Face[]>();
  constructor(faces: Face[], private readonly size: number) {
    for (const f of faces) {
      for (let x = Math.floor(f.box.minX / size); x <= Math.floor(f.box.maxX / size); x++) {
        for (let y = Math.floor(f.box.minY / size); y <= Math.floor(f.box.maxY / size); y++) {
          const k = `${x},${y}`;
          const list = this.cells.get(k);
          if (list) list.push(f);
          else this.cells.set(k, [f]);
        }
      }
    }
  }
  /** The faces whose box holds `b`, give or take `eps`. */
  within(b: Box, eps: number): Face[] {
    const k = `${Math.floor((b.minX + b.maxX) / 2 / this.size)},${Math.floor((b.minY + b.maxY) / 2 / this.size)}`;
    return (this.cells.get(k) ?? []).filter((f) => boxWithin(b, f.box, eps));
  }
}

/** Rule 2: the faces big enough to cut, and the rest. The area floor is arithmetic; the width
 *  floor is one erosion of every face at once — a face that can hold a `minWidth` disc keeps a
 *  piece of itself when shrunk by half of it, and one that cannot vanishes. */
function floors(faces: Face[], minWidth: number, minArea: number, host: LatticeHost, cellSize: number): { kept: Face[]; small: Face[]; eroded: Shapes } {
  const small: Face[] = [];
  let kept: Face[] = [];
  let eroded: Shapes = [];
  for (const f of faces) (f.area >= minArea ? kept : small).push(f);
  if (minWidth > 0 && kept.length) {
    const grid = new FaceGrid(kept, cellSize);
    const wide = new Set<Face>();
    eroded = host.offset(kept.map((f) => [f.outer]), -minWidth / 2, true);
    for (const island of eroded) {
      const probe = island[0]?.[0];
      if (probe) for (const f of grid.holding(probe)) wide.add(f);
    }
    for (const f of kept) if (!wide.has(f)) small.push(f);
    kept = kept.filter((f) => wide.has(f));
  }
  return { kept, small, eroded };
}

/**
 * The faces that come closer than `web` (less 0.02 mm for the boolean's rounding) to another —
 * what a near miss the graph could not join leaves behind — in groups: every face grown by half
 * the limit, and the faces whose growth runs together are one group. One offset, where comparing
 * every face's edges with its neighbours' was a third of a curvy tile's build.
 */
function tightGroups(faces: Face[], web: number, host: LatticeHost, cellSize: number): Face[][] {
  if (faces.length < 2) return [];
  // Thinned first (a face's arcs come back from the booleans a point every 0.15 mm): the
  // growth is short of the limit by the thinning's reach either side, so thinning never makes
  // two faces look closer than they are.
  const thin = faces.map((f) => [simplifyRun([...f.outer, f.outer[0]!], SIMPLIFY).slice(0, -1)]);
  const grown = host.offset(thin, (web - 0.02) / 2 - SIMPLIFY, true).map(faceOf).filter((f): f is Face => !!f);
  if (grown.length >= faces.length) return [];
  const blobs = new FaceGrid(grown, cellSize);
  const groups = new Map<Face, Face[]>();
  for (const f of faces) {
    const blob = blobs.holding(f.outer[0]!)[0];
    if (!blob) continue;
    const list = groups.get(blob);
    if (list) list.push(f);
    else groups.set(blob, [f]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** A part of a face the opening loses is a STRIP once it runs on for more than this many
 *  narrowest cuts: the point of a 30° corner is under two, a crack between two struts runs their
 *  length. */
const STRIP = 2;
/** …and is more than a boolean's rounding: its mean width at least this, mm. What the opening's
 *  arcs shave off a curve is a hundredth of that. */
const STRIP_MEAN = 0.02;

/** How far a face's outline may lie off its opening and still be on it, mm: what the opening's
 *  octagon arcs cut inside a curve, with room to spare. */
const ON_OPENING = 0.1;

/**
 * Every face opened by a `minWidth` disc — `eroded` (rule 2's shrink by half of it) grown back —
 * and each part the opening loses that is a strip taken off the face: the crack where two struts'
 * sides meet, a face tapering into a corner of the zone, a slot along a panel. Cut, each reads as
 * a crack in the wood; a corner's point is shorter and stays sharp. Only the faces whose outline
 * leaves the opening for longer than a strip go through the booleans; they come back as their
 * pieces (`pieces`, for rule 2 again) — a face cut whole for the ring floating in it too: a strip
 * is a sliver at its edge, never where a ring has room to float, and its pieces are cut by their
 * outer rings as it was, so the ring still leaves with the offcut.
 */
function stripHairlines(kept: Face[], eroded: Shapes, minWidth: number, host: LatticeHost): { untouched: Face[]; pieces: Face[]; strips: number } {
  const none = { untouched: kept, pieces: [], strips: 0 };
  if (minWidth <= 0 || !eroded.length) return none;
  const opened = host.offset(eroded, minWidth / 2, true);
  // Cells a strip long: on a 300 mm piece the default (a 24th of it) puts thousands of edges in
  // every query.
  const index = new EdgeIndex(opened, Math.max(1, STRIP * minWidth));
  const long = (pts: Pt[]) => {
    const b = bboxOfPoints(pts);
    return Math.hypot(b.maxX - b.minX, b.maxY - b.minY) > STRIP * minWidth;
  };
  // A face with a strip: a stretch of its outline off the opening — sampled every half
  // millimetre, so a neck drawn as two long edges is seen — as long as a strip, counting how far
  // off the opening it reaches (a tail's tip is its length off it; a 60° corner's point, half a
  // millimetre).
  const flagged = kept.filter((f) => {
    const pts: Pt[] = [];
    for (let i = 0; i < f.outer.length; i++) {
      const a = f.outer[i]!;
      const b = f.outer[(i + 1) % f.outer.length]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    const reach = STRIP * minWidth;
    const off = pts.map((p) => index.distance(p, reach));
    const start = off.findIndex((d) => d < ON_OPENING);
    if (start < 0) return long(pts);
    let run: Pt[] = [];
    let far = 0;
    for (let k = 1; k <= pts.length; k++) {
      const i = (start + k) % pts.length;
      if (off[i]! >= ON_OPENING) {
        run.push(pts[i]!);
        far = Math.max(far, Math.min(off[i]!, reach));
        continue;
      }
      if (run.length) {
        const b = bboxOfPoints(run);
        if (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) + far > reach) return true;
      }
      run = [];
      far = 0;
    }
    return false;
  });
  if (!flagged.length) return none;
  const byBox = new BoxGrid(flagged, Math.max(2, STRIP * minWidth));
  const inside = opened.filter((island) => byBox.within(bboxOfPoints(island[0] ?? []), 0.05).length > 0);
  const strips = host.subtract(flagged.map((f) => [f.outer]), inside).map(faceOf).filter((s): s is Face => {
    if (!s) return false;
    const d = Math.hypot(s.box.maxX - s.box.minX, s.box.maxY - s.box.minY);
    return d > STRIP * minWidth && islandArea(s) / d > STRIP_MEAN;
  });
  if (!strips.length) return none;
  // A strip is part of its face, so its box is within the face's.
  const hit = new Set<Face>();
  for (const s of strips) for (const f of byBox.within(s.box, 0.02)) hit.add(f);
  // Grown by a hair first: where a strip's side is the face's own edge, the face less the bare
  // strip keeps that edge as a slit of no width — which the laser would cut.
  const cutter = host.offset(strips.map((s) => [s.outer, ...s.holes]), 0.01);
  const piecesOf = (faces: Face[], whole: boolean): Face[] => (faces.length
    ? host.subtract(faces.map((f) => [f.outer]), cutter).map(faceOf).filter((f): f is Face => !!f && f.area > 1e-6).map((f) => (whole ? { ...f, whole } : f))
    : []);
  // A whole face's pieces are still cut by their outer rings, and still take what floats in them.
  const pieces = [...piecesOf([...hit].filter((f) => !f.whole), false), ...piecesOf([...hit].filter((f) => f.whole), true)];
  return { untouched: kept.filter((f) => !hit.has(f)), pieces, strips: strips.length };
}

/** How far under half the web a face is grown to find where it closes on itself, mm: the
 *  boolean's rounding, so a strut exactly a web wide is never read as a neck. */
const NECK_SLACK = 0.05;

/**
 * The faces that wrap round wood hanging on a neck under the web. Rule 4 holds the web between
 * two faces; this holds it between a face and itself — a face round a panel's bump, a motif's
 * outline on a stick, a circle's strut that grazes the panel, which hangs on whatever wood is
 * left where the face comes back round. Grown by just under half the web, such a face closes
 * round the wood: its growth has a hole, and every face along that hole stays wood.
 */
function neckedFaces(kept: Face[], web: number, host: LatticeHost): Set<Face> {
  const out = new Set<Face>();
  const d = web / 2 - NECK_SLACK;
  if (!kept.length || d <= 0) return out;
  const holes = host.offset(kept.map((f) => [f.outer]), d, true).flatMap((island) => faceOf(island)?.holes ?? []);
  const reach = d + 0.1;
  for (const h of holes) {
    const hb = bboxOfPoints(h);
    const edge = new EdgeIndex([[h]]);
    for (const f of kept) {
      if (out.has(f) || f.box.maxX < hb.minX - reach || f.box.minX > hb.maxX + reach || f.box.maxY < hb.minY - reach || f.box.minY > hb.maxY + reach) continue;
      if (f.outer.some((a, i) => edge.segmentDistance(a, f.outer[(i + 1) % f.outer.length]!, reach) <= reach)) out.add(f);
    }
  }
  return out;
}

/** How much roomier than the pattern's own cells a face lying along the zone's edge may be
 *  before it is a WINDOW — the space the pattern leaves round a panel, not a cell of it — by the
 *  widest disc each holds. */
const WINDOW = 2.5;
/** The share of its outline on the zone's edge from which a face that roomy is a window: the gap
 *  above a panel that three stubs of line poke into still has four tenths of its outline on the
 *  frame and the panel; a stripe's strip, as roomy as its neighbours, is never that roomy. */
const WINDOW_ROOMY_EDGE = 0.4;
/** …or how many of its cells bigger, by area, when nearly all its outline is the zone's edge:
 *  the space between a panel and the border that a few struts cross. A stripe along the border
 *  has its strut for half its outline, and stays a cell. */
const WINDOW_EDGE = 0.65;

/**
 * Rule 5 on a band or a ring round a panel, where a quarter of the island is a big window: a face
 * is a window when `WINDOW_ROOMY_EDGE` of its outline is the zone's edge and it holds a disc `WINDOW`
 * times the pattern's own (`cell`, the median widest disc of its cells at zero width), or when
 * `WINDOW_EDGE` of it is the zone's edge and it is `MOAT_CELLS` of the pattern's cells by area
 * (`cellArea`). A strip of a stripe pattern is long, not roomy; a mandala's corner of the card
 * round the panel is both; the gap above a panel that three plus signs cross is the second.
 */
function windowOf(cell: number, cellArea: number, web: number, zoneEdge: EdgeIndex): (f: Face) => boolean {
  const room = WINDOW * cell - web / 2;
  const roomy = room > 0 ? Math.PI * room * room : Infinity;
  const big = Number.isFinite(cellArea) ? MOAT_CELLS * cellArea : Infinity;
  if (!Number.isFinite(roomy) && !Number.isFinite(big)) return () => false;
  return (f) => {
    if (f.area < Math.min(roomy, big)) return false;
    let on = 0;
    let all = 0;
    for (let i = 0; i < f.outer.length; i++) {
      const a = f.outer[i]!;
      const b = f.outer[(i + 1) % f.outer.length]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      all += l;
      if (zoneEdge.distance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0.05) < 0.02) on += l;
    }
    if (f.area >= big && on > WINDOW_EDGE * all) return true;
    return f.area >= roomy && on > WINDOW_ROOMY_EDGE * all && poleOf(f.outer, 0.05, f.holes, room + 0.01).radius > room;
  };
}

/** Rule 5 round a reserve: the share of a reserve's edge, and how many of the pattern's own
 *  cells (by area), past which a face along it is the space round the reserve, not a cell. */
const MOAT_EDGE = 0.25;
const MOAT_CELLS = 4;

/**
 * Rule 5 round a reserve: a face many cells big that runs along a good part of a reserve's edge — a
 * moat along a card's panel, the gap the pattern leaves above and below it — leaves the panel
 * hanging on whatever wood is left round the rest of it: a panel floating in a window. It is the
 * space round the panel, not a cell of the pattern. `cell` is the median area of the pattern's
 * own cells at zero width.
 */
function moatOf(zone: Shapes, cell: number): (f: Face) => boolean {
  const holes = zone.flatMap((island) => {
    const outer = faceOf(island)?.outer;
    return island.filter((r) => r !== outer && r.length >= 3);
  }).map((r) => ({ box: bboxOfPoints(r), edge: new EdgeIndex([[r]]), length: r.reduce((s, p, i) => s + Math.hypot(r[(i + 1) % r.length]![0] - p[0], r[(i + 1) % r.length]![1] - p[1]), 0) }));
  if (!holes.length || !Number.isFinite(cell)) return () => false;
  return (f) => f.area > MOAT_CELLS * cell && holes.some((h) => {
    if (f.box.maxX < h.box.minX - 0.05 || f.box.minX > h.box.maxX + 0.05 || f.box.maxY < h.box.minY - 0.05 || f.box.minY > h.box.maxY + 0.05) return false;
    let along = 0;
    for (let i = 0; i < f.outer.length; i++) {
      const a = f.outer[i]!;
      const b = f.outer[(i + 1) % f.outer.length]!;
      if (h.edge.distance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0.05) < 0.02) along += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return along > MOAT_EDGE * h.length;
  });
}

const pointKey = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/** A point `d` on past `p`, carrying on the way the run arrives at it from its inside. */
function beyond(run: Pt[], atStart: boolean, d: number): Pt {
  const p = atStart ? run[0]! : run[run.length - 1]!;
  // The direction off the last stretch at least 0.05 mm long, not off a sliver of a segment.
  let from = p;
  for (let k = 1; k < run.length; k++) {
    from = atStart ? run[k]! : run[run.length - 1 - k]!;
    if (Math.hypot(p[0] - from[0], p[1] - from[1]) >= 0.05) break;
  }
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const l = Math.hypot(dx, dy) || 1;
  return [p[0] + (dx / l) * d, p[1] + (dy / l) * d];
}

/**
 * A strut `web` wide round every run: ribbons and fans along it, one round cap per point where
 * runs END on another strut (where three runs meet, one disc covers all three), and an end that
 * lands on the zone's edge carried on past it by a web — so its band crosses the edge at any
 * angle and no sliver of face slips round its end. All rings counter-clockwise and overlapping,
 * to be read as their union.
 */
function strutsOf(runs: HeldRun[], web: number): Shapes {
  const struts: Shapes = [];
  const ends = new Map<string, Pt>();
  for (const run of runs) {
    let pts = run.points;
    if (!run.loop) {
      pts = [...pts];
      if (run.held[0]) pts.unshift(beyond(run.points, true, web));
      if (run.held[1]) pts.push(beyond(run.points, false, web));
      for (const at of [0, 1] as const) {
        if (run.held[at]) continue;
        const p = at ? run.points[run.points.length - 1]! : run.points[0]!;
        ends.set(pointKey(p), p);
      }
    }
    for (const ring of strutBands(pts, web, () => false)) struts.push([ring]);
  }
  for (const p of ends.values()) struts.push([fan(p, 0, 2 * Math.PI, web / 2)]);
  return struts;
}

/** "Kikkō's", "Rings'". */
const whose = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const neverClose = (name: string) => `${whose(name)} lines never close a space, so there is nothing to cut out — score or engrave it instead.`;
const tooFine = (name: string, zoom: number | null) =>
  zoom ? `${name} is too fine to cut out here — it cuts from ${zoom} % zoom, or score it instead.` : `${name} is too fine to cut out here — score or engrave it instead.`;
const tooLoose = (name: string) => `${whose(name)} lines don't join into a lattice here, so cutting it would drop loose pieces — score or engrave it instead.`;
const tooCoarse = (name: string) => `${name} is too large to cut out on this shape — zoom out, or score or engrave it.`;
const tooSparse = (name: string) => `${name} would leave most of this shape plain wood, cut out — score or engrave it instead.`;
/** Two cuts closer than the web asked for that cannot give way — a hinge's slots, a kerf wide:
 *  cut as drawn, and said (its gap is a control of its own). */
export const betweenCuts = (name: string, wall: number) =>
  `${name} leaves only ${round(wall)} mm between cuts — widen the gap.`;
// The sentences of a pattern of shapes (holes, motifs): one plain sentence each, at most twelve
// words for a name of four, naming a stop of the Zoom slider that cuts (`deliveringZoom`).
/** Every shape under the floors. */
export const tooSmall = (name: string, zoom: number | null) =>
  (zoom ? `${name} is too small to cut — try ${zoom} % zoom.` : `${name} is too small to cut — engrave it instead.`);
/** Held to the web — every two cuts at least the web apart — most shapes fall under the floors. */
export const tooTight = (name: string, zoom: number | null) =>
  (zoom ? `${name} is too fine to cut — try ${zoom} % zoom.` : `${name} is too fine to cut — engrave it instead.`);
/** None of its shapes lands on the shape at all. */
export const nothingReaches = (name: string) => `Nothing of ${name} reaches this shape — move it over.`;
/** Cut, but with more than `FLOORED_QUIET` of it (by area) left as wood: shapes under the floors,
 *  given way to the web, or cut only where they hold the slot (a finger of wood inside them). Big
 *  and small shapes at a wide web: what fits is cut, and this says so (Ian, 2026-09-29). */
export const partlyTooSmall = (_name: string, zoom: number | null) =>
  (zoom ? `Some small shapes stay wood — try ${zoom} % zoom.` : 'Some small shapes stay wood.');
/** Cut, with the pieces round a bit of wood that would fall out left as wood (`unloosed`): said
 *  whenever it happens — the true reason, never "too small". */
export const looseStaysWood = (_name: string) => 'Some shapes stay wood so no loose wood falls out.';
/** A network of shapes (they touch, or ring wood) cut as the lattice of their outlines, which cuts
 *  mostly what lies BETWEEN them — the negative of what Engrave shows: kept, and said (Ian,
 *  2026-09-29), in at most twelve words for a name of four. */
export const cutAsGaps = (name: string) => `${name} is cut as the gaps between its shapes.`;
/** A cut that leaves shapes as wood, or cuts the gaps between them, is no clean cut: a zoom named
 *  for a "Some small shapes stay wood" must say none of these. */
const NOT_CLEAN = /stay wood|gaps between its shapes/;
/** The share of a pattern of shapes, by area, the cut may leave as wood unsaid. */
export const FLOORED_QUIET = 0.1;

/** The Zoom slider, %: its range and its step. A sentence of a pattern of shapes names one of its
 *  stops; the lattice keeps its own coarser `ZOOMS`, which its sentences are held to. */
const ZOOM_MAX = 300;
const ZOOM_STEP = 5;

/** The least stop of the Zoom slider above `current` % and at least `needed` %, or null past its end. */
export function zoomStop(needed: number, current: number): number | null {
  const next = (Math.floor(current / ZOOM_STEP + 1e-6) + 1) * ZOOM_STEP;
  const z = Math.max(next, Math.ceil((needed - 1e-3) / ZOOM_STEP) * ZOOM_STEP);
  return Number.isFinite(z) && z <= ZOOM_MAX ? z : null;
}

/**
 * A shape of a pattern as the zoom model sees it: its area and outline (mm², mm), the radius of
 * the widest disc it holds, and its gap to the nearest other cut (Infinity past the web). Zoomed
 * by k, all four scale — area by k², the rest by k — and the web does not: under it the shape gives
 * way by half the shortfall (`giveWay`), and then must still pass the floors. `finger`: the width of
 * the narrowest finger of wood it holds, mm (round 7) — it scales too, and the shape is whole only
 * once that is the thinnest wood the cut may leave.
 */
export interface ShapeModel { area: number; outline: number; radius: number; gap: number; long?: boolean; finger?: number }

/** How far a cut gives way where another comes `gap` from it, under a `web`: half the shortfall,
 *  and a hair more (a wall exactly the web must measure as the web). */
export const giveWay = (gap: number, web: number): number => (gap < web - 1e-3 ? (web - gap) / 2 + GIVE_SLACK : 0);
/** The hair a cut gives way past half the shortfall, mm. */
export const GIVE_SLACK = 0.005;

/** Does a shape pass the floors at k × the zoom — `minArea` and a slot `minWidth` wide at its
 *  widest, the studio's 1 mm disc unless it is `long` — once it has given way to its neighbour, and
 *  with no finger of wood in it thinner than `thinnest`? (The area it loses to the give-way is its
 *  outline times the distance, which errs on the side of cutting less; a shape with a finger is
 *  counted lost whole, though the cut keeps the parts of it that hold the slot.) */
function passesAt(m: ShapeModel, k: number, web: number, minWidth: number, minArea: number, thinnest: number): boolean {
  if (m.finger !== undefined && m.finger * k < thinnest - FLOOR_SLACK) return false;
  const d = giveWay(m.gap * k, web);
  const width = m.long === false ? Math.max(minWidth, LATTICE_MIN_WIDTH) : minWidth;
  return m.radius * k - d >= width / 2 - FLOOR_SLACK && m.area * k * k - m.outline * k * d >= minArea;
}

/** At k × the zoom: the share of a pattern of shapes, by area, the floors leave as wood, and the
 *  share of its shapes that pass them. */
export function flooredShareAt(models: ShapeModel[], k: number, web: number, minWidth: number, minArea: number, thinnest = THINNEST_WOOD): { lost: number; passing: number } {
  let all = 0;
  let lost = 0;
  let passing = 0;
  for (const m of models) {
    all += m.area;
    if (passesAt(m, k, web, minWidth, minArea, thinnest)) passing++;
    else lost += m.area;
  }
  return { lost: all > 0 ? lost / all : 0, passing: models.length ? passing / models.length : 0 };
}

/** The least stop of the Zoom slider above `current` % at which the floors leave no more than
 *  `FLOORED_QUIET` of the shapes as wood (and most of them cut) — the zoom a sentence names, so
 *  what it promises cuts, cleanly. */
export function deliveringZoom(models: ShapeModel[], current: number, web: number, minWidth: number, minArea: number, thinnest = THINNEST_WOOD): number | null {
  if (!models.length) return null;
  for (let z = zoomStop(current, current); z !== null && z <= ZOOM_MAX; z += ZOOM_STEP) {
    const at = flooredShareAt(models, z / current, web, minWidth, minArea, thinnest);
    if (at.lost <= FLOORED_QUIET && at.passing >= HELD_SHARE) return z;
  }
  return null;
}

/** The zoom at which the narrowest wall between two cuts reaches the web: walls scale with the
 *  zoom, so it is current × web / wall, rounded up to a stop of the slider. */
export const webZoom = (wall: number, web: number, current: number): number | null =>
  (wall > 0 ? zoomStop((current * web) / wall, current) : null);

/**
 * The edges of some rings in a grid, for the ones within `reach` of a point: a vertex meets the
 * edges in its cell and the eight round it. A cell is one and a half `reach`es across, and an edge
 * is filed in every cell of a walk along it in half-cell steps — the step's point nearest any point
 * within `reach` is within a cell of it — never in every cell of its box, which for a long
 * diagonal on a fine grid was hundreds (Plaid's stripes: most of a snowflake card's time).
 */
class EdgeGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly size: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  /** The nine cells round a vertex, as offsets of its cell's key. */
  readonly around: number[];
  constructor(readonly rings: Ring[], reach: number) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (const r of rings) {
      for (const p of r) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
      }
    }
    this.size = 1.5 * reach;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / this.size) + 3;
    const c = this.cols;
    this.around = [-c - 1, -c, -c + 1, -1, 0, 1, c - 1, c, c + 1];
    const step = this.size / 2;
    rings.forEach((r, i) => {
      for (let a = 0; a < r.length; a++) {
        const p = r[a]!;
        const q = r[(a + 1) % r.length]!;
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
        let last = NaN;
        for (let s = 0; s <= n; s++) {
          const k = this.key(p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n);
          if (k === last) continue;
          last = k;
          const list = this.cells.get(k);
          if (list) list.push(i, a);
          else this.cells.set(k, [i, a]);
        }
      }
    });
  }
  key(x: number, y: number): number {
    return (Math.floor((y - this.minY) / this.size) + 1) * this.cols + Math.floor((x - this.minX) / this.size) + 1;
  }
  /** The (ring, edge) pairs filed in a cell, flat. */
  at(key: number): number[] | undefined {
    return this.cells.get(key);
  }
}

/** Two rings that come closer than a pair limit, and how close. */
export interface Pinch { i: number; j: number; d: number }

/**
 * For every ring, the least distance to any OTHER ring, looking no further than `limit` (Infinity
 * past it) — and every pair of rings closer than `pairLimit`, with how close. The rings are cuts, which never cross, so the least gap between two is a vertex of
 * one against an edge of the other: every vertex meets the edges of the OTHER rings near it
 * (`EdgeGrid`). (Every edge of one ring against every edge of the next was most of a second of a
 * snowflake card.)
 */
export function nearestGaps(rings: Ring[], limit: number, pairLimit = 0): { gap: number[]; pinches: Pinch[] } {
  const gap = rings.map(() => Infinity);
  const pairs = new Map<number, number>();
  if (rings.length < 2 || !(limit > 0)) return { gap, pinches: [] };
  const grid = new EdgeGrid(rings, limit);
  rings.forEach((r, i) => {
    for (const p of r) {
      const k0 = grid.key(p[0], p[1]);
      for (const dk of grid.around) {
        const list = grid.at(k0 + dk);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const j = list[k]!;
          if (j === i) continue;
          const other = rings[j]!;
          const b = list[k + 1]!;
          const s = other[b]!;
          const e = other[(b + 1) % other.length]!;
          const d = pointSegmentDistance(p, s, e);
          if (d < gap[i]!) gap[i] = d;
          if (d < gap[j]!) gap[j] = d;
          if (d < pairLimit) {
            const key = Math.min(i, j) * rings.length + Math.max(i, j);
            const was = pairs.get(key);
            if (was === undefined || d < was) pairs.set(key, d);
          }
        }
      }
    }
  });
  const n = rings.length;
  return { gap: gap.map((g) => (g < limit ? g : Infinity)), pinches: [...pairs].map(([key, d]) => ({ i: Math.floor(key / n), j: key % n, d })) };
}

/** How much longer than the gap across it the way round a piece's outline between two points of it
 *  may be and still be one CORNER of it (a wedge of wood wider than about 29°), not a bay — a
 *  mouth or a slit — that the kerf closes. */
const SELF_ARC = 4;

/**
 * Where the kerf burns between cuts: the pieces (`rings`, which never cross) it touches — another
 * within `touch` (a kerf wall; or, where the shapes fused so would be a network, only two drawn to
 * meet: `kerfPieces`), or a bay of its own narrower than `reach`: two stretches of its outline facing
 * each other across wood, as a C's mouth or a slit does, not the two sides of a corner (`SELF_ARC`),
 * nor the two sides of a spike of the cut itself (across ink, not wood) — or touching itself at a
 * PINCH, which the laser burns through whichever side the wood is on — and the wood it burns there:
 * for every two edges that close, the quadrilateral between the parts of each within `reach` of the
 * other (`filler`). Measured edge to edge, so two tips that meet are one cut as surely as two long
 * sides are, and nothing but that wood is added.
 */
function kerfFillers(rings: Ring[], reach: number, touch: number): { touched: boolean[]; fillers: Ring[] } {
  const touched = rings.map(() => false);
  const fillers: Ring[] = [];
  if (!rings.length) return { touched, fillers };
  const grid = new EdgeGrid(rings, reach);
  const paired = new Set<string>();
  const pair = (i: number, a: number, j: number, b: number): void => {
    const key = i < j || (i === j && a < b) ? `${i},${a},${j},${b}` : `${j},${b},${i},${a}`;
    if (paired.has(key)) return;
    paired.add(key);
    const r = rings[i]!;
    const o = rings[j]!;
    const f = filler(r[a]!, r[(a + 1) % r.length]!, o[b]!, o[(b + 1) % o.length]!, reach);
    if (f) fillers.push(f);
  };
  rings.forEach((r, i) => {
    const n = r.length;
    const along: number[] = [0];
    for (let a = 0; a < n; a++) along.push(along[a]! + Math.hypot(r[(a + 1) % n]![0] - r[a]![0], r[(a + 1) % n]![1] - r[a]![1]));
    const total = along[n]!;
    const ccw = signedArea(r) > 0;
    for (let a = 0; a < n; a++) {
      const p = r[a]!;
      const before = (a + n - 1) % n;
      const k0 = grid.key(p[0], p[1]);
      for (const dk of grid.around) {
        const list = grid.at(k0 + dk);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const j = list[k]!;
          const b = list[k + 1]!;
          const o = rings[j]!;
          const s = o[b]!;
          const e = o[(b + 1) % o.length]!;
          const d = pointSegmentDistance(p, s, e);
          if (d >= reach) continue;
          if (j !== i) {
            // Two shapes: one cut only where they touch.
            if (d > touch) continue;
            touched[i] = touched[j] = true;
            pair(i, before, j, b);
            pair(i, a, j, b);
            continue;
          }
          if (b === a || b === before) continue;
          const c = closestOn(p, s, e);
          // Across wood: `p` lies outside the edge — right of it on a counter-clockwise ring. At a
          // pinch the two sides meet and no side can be told: burnt through either way.
          const side = (e[0] - s[0]) * (p[1] - c[1]) - (e[1] - s[1]) * (p[0] - c[0]);
          if (d > PINCH && (ccw ? side >= 0 : side <= 0)) continue;
          const way = Math.abs(along[b]! + Math.hypot(c[0] - s[0], c[1] - s[1]) - along[a]!);
          if (Math.min(way, total - way) <= SELF_ARC * d) continue;
          touched[i] = true;
          // The two edges at `p`, each against edge `b` — unless it shares a corner with it.
          if ((b + 1) % n !== before && b !== (before + n - 1) % n) pair(i, before, i, b);
          if ((b + 1) % n !== a && b !== (a + 1) % n) pair(i, a, i, b);
        }
      }
    }
  });
  return { touched, fillers };
}

/** The wood between two edges of cut outline, where they come within `reach` of each other: the
 *  quadrilateral round the part of each that close (a hair wider, so it meets the pieces without a
 *  seam), or null. A point's distance to a segment is convex along another, so each part is one
 *  stretch, found round its nearest point. */
function filler(p1: Pt, p2: Pt, q1: Pt, q2: Pt, reach: number): Ring | null {
  const part = (a: Pt, b: Pt, c: Pt, d: Pt): [Pt, Pt] | null => {
    const at = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const f = (t: number): number => pointSegmentDistance(at(t), c, d);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (f(m1) <= f(m2)) hi = m2;
      else lo = m1;
    }
    const tm = (lo + hi) / 2;
    if (f(tm) >= reach) return null;
    const edge = (inside: number, outside: number): number => {
      if (f(outside) < reach) return outside;
      let i = inside;
      let o = outside;
      for (let k = 0; k < 30; k++) {
        const m = (i + o) / 2;
        if (f(m) < reach) i = m;
        else o = m;
      }
      return i;
    };
    return [at(edge(tm, 0)), at(edge(tm, 1))];
  };
  const P = part(p1, p2, q1, q2);
  const Q = part(q1, q2, p1, p2);
  if (!P || !Q) return null;
  const hull = convexHull([P[0], P[1], Q[0], Q[1]]);
  if (hull.length < 3 || Math.abs(signedArea(hull)) < 1e-9) return null;
  const cx = hull.reduce((s, q) => s + q[0], 0) / hull.length;
  const cy = hull.reduce((s, q) => s + q[1], 0) / hull.length;
  return hull.map((q) => {
    const l = Math.hypot(q[0] - cx, q[1] - cy) || 1;
    return [q[0] + ((q[0] - cx) / l) * FILLER_HAIR, q[1] + ((q[1] - cy) / l) * FILLER_HAIR] as Pt;
  });
}
/** How far past the pieces a `filler` reaches, mm, so the union has no seam of no width. */
const FILLER_HAIR = 0.005;

/** The convex hull of a few points, counter-clockwise (Andrew's monotone chain). */
function convexHull(points: Pt[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The point of segment s→e nearest `p`. */
function closestOn(p: Pt, s: Pt, e: Pt): Pt {
  const vx = e[0] - s[0];
  const vy = e[1] - s[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - s[0]) * vx + (p[1] - s[1]) * vy) / l2));
  return [s[0] + vx * t, s[1] + vy * t];
}

/** How much wider than the pattern's own cells (the widest disc of its cut cells, averaged by
 *  their area, so a mandala's big openings outweigh its dots) a patch of plain wood may be before
 *  the cut stops reading as the pattern. A lattice's widest patch is a strut's junction; a dot
 *  grid's is the gap between dots, about a dot across. */
const PATCH = 3;

/**
 * A point of the zone at least `reach` from every face, half that from the zone's edge, and inside
 * no face — the middle of a patch of plain wood that wide that is not just the border — or null.
 * Sampled on a grid half as fine as `reach`, so any patch that big has a sample well inside it —
 * and a band a patch wide, one and a half `reach`es, has a row of samples down its middle.
 */
function solidPatch(zone: Shapes, faces: Face[], reach: number): Pt | null {
  const edges = new EdgeIndex(faces.map((f) => [f.outer]));
  const within = new EdgeIndex(zone);
  // Half that off the zone's edge: a patch is the middle of the plain wood, not the border's own
  // margin — and on a band or a ring round a panel, narrower than two `reach`es, the middle of the
  // band is where a stretch the pattern left plain shows.
  const off = reach / 2;
  const cellSize = Math.max(2, Math.sqrt(faces.reduce((s, f) => s + (f.box.maxX - f.box.minX) * (f.box.maxY - f.box.minY), 0) / Math.max(1, faces.length)));
  const grid = new FaceGrid(faces, cellSize);
  const b = bboxOfPoints(zone.flatMap((island) => island[0] ?? []));
  const step = reach / 2;
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      const p: Pt = [x, y];
      if (edges.distance(p, reach) < reach || within.distance(p, off) < off || !within.inside(p) || grid.holding(p).length) continue;
      return p;
    }
  }
  return null;
}

/** Area of an island: its outer ring less its holes. */
const islandArea = (f: Face): number => f.area - f.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);

/** A zoom is named once the estimate reads at this much LESS than it: the cells say when a face
 *  first holds the narrowest cut, not when the hairline strips trimmed off its points leave enough
 *  of it (seigaiha's crescents on a coaster: 150 % by the estimate, 175 % in fact). */
const ZOOM_MARGIN = 1.1;

/** The zooms a too-fine pattern is offered at, %, in order — stops of the Zoom slider. */
const ZOOMS = [125, 150, 175, 200, 250, 300];

/** Rule 6 before the boolean: a pattern whose cells, measured at zero width, would come out
 *  more than this far under both `COVERAGE_MIN` and `AREA_MIN` is not worth building struts
 *  for — a library tile's dense texture was five seconds of boolean to learn it cuts nothing. The
 *  margin is the estimate's error: a cell's face is worked out, not built. */
const HOPELESS = 0.2;

/**
 * The zoom — as a multiple of the one it is drawn at — a cell needs before its face can be cut.
 * Zooming in by k grows every cell by k and leaves the web alone, so the face's widest disc is
 * k·radius less half a web. Its area is the cell's shrunk the same way: exactly
 * k²·area·(1 − web / 2k·radius)² for a triangle or any shape round a circle, and less than the
 * truth for a slot — so the estimate errs on the side of cutting less.
 */
function zoomNeeded(c: Cell, radius: number, web: number, minWidth: number, minArea: number): number {
  if (!(radius > 0) || !(c.area > 0)) return Infinity;
  const byWidth = (web + minWidth) / (2 * radius);
  const byArea = web / (2 * radius) + Math.sqrt(minArea / c.area);
  return Math.max(byWidth, byArea);
}

/** The least wood between two cuts that the laser does not burn through, mm: a kerf takes 0.1 off
 *  each side. Two cuts closer than this are ONE (`kerfPieces`, `fillShape`) — measured between them,
 *  point to point, so two tips that nearly meet are one cut as surely as two long sides are — unless,
 *  joined so, the shapes are a network: then only two that touch are one (`TOUCH`). */
export const KERF_WALL = 0.2;
/** Half a kerf wall: what a kerf takes off the wood on each side of a cut. */
const KERF_HALF = KERF_WALL / 2;
/** How far the wood a cut leaves is eroded to find what a kerf frees, mm: half the kerf wall, and
 *  the most a small offset's arcs cut short of a true circle. */
const KERF_BITE = KERF_HALF + 0.02;
/** The bites the wood a cut leaves is eroded by to find what would fall out (round 7): the kerf's
 *  own, `KERF_HALF`; `KERF_BITE`; and a 0.12 mm bite as the host's arcs read it — they fall up to
 *  0.016 mm short of a circle at this radius (a 0.235 mm neck reads 0.242: Halloween - 2's teeth
 *  hung on it) — so nothing a cut leaves parts at a true 0.1 or 0.12 mm bite. */
const LOOSE_BITES = [KERF_HALF, KERF_BITE, KERF_BITE + 0.02];
/** Two distinct shapes of a drawing this close at 100 % zoom, mm, TOUCH: drawn to meet. It is the
 *  drawing's own rounding — Pattern Monster's coordinates are hundredths of a tile unit, so two shapes
 *  drawn to meet come back microns apart (across the picker at 100 %: 1,336 pairs of shapes 0.1–5 µm
 *  apart, and 440 more to 20 µm) — and it scales with the zoom, as the drawing does. Where the kerf
 *  would fuse a pattern's shapes into a network or a plate, only shapes this close are one cut; the
 *  rest are two however near, and give way to hold the web between them: the thin lines between
 *  Interlocked Hexagons - 3's stripes (0.16 mm) are wood (Ian, 2026-09-29), not a seam to burn. */
export const TOUCH = 0.02;
/** Where a shape's outline comes back to ITSELF this close, mm, it touches itself — a PINCH, as where
 *  two of Triangles - 15's triangles meet at a corner — and the laser burns through it whichever
 *  side of it the wood lies: the bay behind it is closed, as a bay narrower than a kerf wall is. */
const PINCH = 1e-4;
/** Round 7: the narrowest strip of wood a cut may leave inside one opening, mm, unless the customer
 *  asks for more ("Thinnest wood", `LatticeCut.thinnest`): two kerf walls. A kerf takes 0.1 off each
 *  side of it, and a finger thinner than this chars through or snaps along its whole length. */
export const THINNEST_WOOD = 2 * KERF_WALL;
/** A bay of one piece is a FINGER — a band of wood about as wide all along, which a kerf thins from
 *  both sides at once — when it runs on over this, mm (half its outline)… */
export const FINGER_MIN = 2;
/** …is this many times as long as it is wide… */
export const FINGER_LONG = 5;
/** …and fills this share of the band its length and widest width make. A V between two arms tapers
 *  from its tip and fills half of it or less (Snowflakes - 1's 0.16–0.24, Lanterns' 0.11–0.47); a
 *  comb's fingers fill 0.81–0.99 of it (the round-6 review, §2.1). */
export const FINGER_BAND = 0.75;
/** A bay thinner than this on average, mm (its area over its length), is a boolean's rounding. */
const FINGER_MEAN = 0.05;
/** The narrowest shape of a pattern a laser cuts cleanly, mm, as a SLOT — a curl, a stroke, long
 *  and thin (`SLOT_LONG`; Waves - 7's curls are 0.88 mm wide). Any other shape holds the studio's
 *  own 1 mm disc (`LATTICE_MIN_WIDTH`), as the lattice's faces do. */
export const SLOT_MIN_WIDTH = 0.8;
/** A slot is a shape at least this many times as long as it is wide: its area over the square of
 *  its widest disc's width. */
export const SLOT_LONG = 3;
/** The most cells one piece may enclose and still be a motif whatever its size: a ring's middle, a
 *  figure eight's two. A piece round more is a CAGE — shapes joined into a network — when it is a
 *  real part of its zone (`BACKGROUND_SHARE` of it) or runs on over more than a cell of the tile; a
 *  lantern with five panes between its ribs is still a lantern. */
const MOTIF_OWNS = 2;
/** A caging piece that runs on over this many periods of its tile is a network, not a motif. */
const CAGE_SPAN = 1.5;
/** A piece whose kerf joins close cells of this share of it, running on over `JOIN_SPAN` of its
 *  tile's period, is copies fused round the ground between them: a network. */
const ENCLOSED_SHARE = 0.2;
const JOIN_SPAN = 0.75;
/** A piece whose holes hold more than this share of the zone is no motif: cut by its outline, one
 *  opening would take that much plain wood. */
const HOLES_SHARE = 0.1;
/** Wood under this, mm², once the kerf has burnt round it, is smoke, not a piece that falls. */
const LOOSE_WOOD = 0.01;
/** A freed bit of wood between SEVERAL pieces under this, mm² (as the kerf leaves it), is cut with
 *  the pieces round it; a bigger one keeps them as wood. Never the whole pattern. (One in a single
 *  piece's own bay is cut with that piece whatever its size.) */
const LOOSE_SMALL = 0.5;
/** The least share of the zone the wood a motif cut leaves must be: shapes covering nearly all of
 *  it, one of them a real part of its zone (`BACKGROUND_SHARE`), are a plate with holes drawn in
 *  ink, not motifs on a ground. Many shapes parted only by the drawing's thin lines are motifs, and
 *  the lines are wood: they give way to hold the web (Interlocked Hexagons - 3; Ian, 2026-09-29). */
const MOTIF_ROOM = 0.1;
/** The floors' give, mm: a shape exactly the narrowest cut wide still takes it. */
export const FLOOR_SLACK = 0.01;
/** Pieces that, given way to hold the web, keep under this share of those above the floors are
 *  not the pattern any more: refused, naming the zoom at which the walls reach the web. */
export const HELD_SHARE = 0.5;
/** A cut under this share of what Engrave draws in the zone is not the pattern: refused, naming a
 *  zoom that cuts it. */
export const NEAR_EMPTY = 0.25;

/** Everything off the zone, in a box round it — what a clip to the zone subtracts, so the zone's
 *  edge is crossed once, never traced twice (two booleans on one edge leave a strip of no width). */
function offZone(zone: Shapes, shapes: Shapes, host: LatticeHost): Shapes {
  const b = bboxOfPoints([...zone.flatMap((island) => island.flat()), ...shapes.flatMap((island) => island[0] ?? [])]);
  const m = 10;
  return host.subtract([[[[b.minX - m, b.minY - m], [b.maxX + m, b.minY - m], [b.maxX + m, b.maxY + m], [b.minX - m, b.maxY + m]]]], zone);
}

/** The side of a cell that faces are sorted into for a grid of `faces`: their mean box. */
const cellSizeOf = (faces: Face[]): number =>
  Math.max(2, Math.sqrt(faces.reduce((s, f) => s + (f.box.maxX - f.box.minX) * (f.box.maxY - f.box.minY), 0) / Math.max(1, faces.length)));

/**
 * The shapes on the zone as the laser cuts them — the pieces: their union clipped to the zone (a
 * motif a tile split at its cell's seam is one shape again), and wherever the kerf burns between
 * stretches of cut outline — a bay of one shape narrower than a kerf wall (a C's mouth, a pinch),
 * two shapes that touch — the wood between them burnt with the cut, so they are one
 * (`kerfFillers`). Worked on the cut, never on the wood: a wall that runs into the zone's edge ends
 * on the border, and its foot keeps its width. A piece inside another's outline goes with it (a
 * piece is cut by its outline), so it is no piece of its own. Null when the pieces are a `network`
 * (asked of the shapes as drawn, and again as the kerf joins them). `seen.ink` keeps the shapes as
 * Engrave draws them on the zone, for a lattice of a network to say what it cut.
 */
function kerfPieces(shapes: Shapes, outside: Shapes, host: LatticeHost, network: (pieces: Face[]) => boolean, plate: (pieces: Face[]) => boolean, touch: number, seen?: Seen): Face[] | null {
  const live = (islands: Shapes): Face[] => islands.map(faceOf).filter((f): f is Face => !!f && f.area > 1e-6);
  const ink = live(host.subtract(evenOddIslands(shapes, host), outside));
  if (seen) seen.ink = ink;
  if (!ink.length) return [];
  // Shapes that join into a network before the kerf joins anything are one after it too: said
  // now, before the kerf's boolean on a plaid's hundred stripes.
  const drawn = unnested(ink);
  if (network(drawn)) return null;
  // The wood a kerf burns between them (`kerfFillers`) — its own bays narrower than a kerf wall, and
  // two shapes nearer than `between` — and a piece it does not reach is cut as it is.
  const joinedBy = (between: number): Face[] => {
    const { touched, fillers } = kerfFillers(ink.map((f) => f.outer), KERF_WALL, between);
    if (!touched.some(Boolean)) return drawn;
    const joined = live(host.subtract([...ink.filter((_, i) => touched[i]).map((f) => [f.outer, ...f.holes]), ...fillers.map((r) => [r])], outside));
    // The cells the joins close (`Face.enclosed`): a joined piece's holes of 2 mm² that lie in none
    // of its shapes, mm². A shape's own counter is no such hole — it goes with the shape, as drawn.
    const joinedInk = ink.filter((_, i) => touched[i]);
    for (const j of joined) {
      const enclosed = j.holes.reduce((sum, h) => {
        const a = Math.abs(signedArea(h));
        if (a < LATTICE_MIN_AREA) return sum;
        const p = insideOf(h);
        return joinedInk.some((f) => inBox(p, f.box) && pointInRing(p, f.outer)) ? sum : sum + a;
      }, 0);
      if (enclosed) j.enclosed = enclosed;
    }
    return unnested([...ink.filter((_, i) => !touched[i]), ...joined]);
  };
  // Two shapes nearer than a kerf wall are one cut, as the laser burns them — unless, fused so, they
  // are a network or a plate: then the drawing's thin lines between them are wood, two shapes are one
  // only where they touch (`touch`), and nearer than the web they give way to hold it (Interlocked
  // Hexagons - 3's stripes, 0.16 mm apart: Ian, 2026-09-29).
  const fused = joinedBy(KERF_WALL);
  if (!network(fused) && !plate(fused)) return fused;
  if (touch >= KERF_WALL) return network(fused) ? null : fused;
  const parted = joinedBy(touch);
  return network(parted) ? null : parted;
}

/** A point just inside a ring: off the middle of its longest edge, a hundredth of a millimetre in. */
function insideOf(ring: Ring): Pt {
  const s = signedArea(ring) > 0 ? 1 : -1;
  let best = 0;
  let at = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) {
      best = l;
      at = i;
    }
  }
  const a = ring[at]!;
  const b = ring[(at + 1) % ring.length]!;
  const e = Math.min(0.01, best / 4) / (best || 1);
  return [(a[0] + b[0]) / 2 - (b[1] - a[1]) * e * s, (a[1] + b[1]) / 2 + (b[0] - a[0]) * e * s];
}

/** The pieces less any that lie in another's hole: cut by its outline, the outer piece takes them
 *  (`holds` counts them — afresh on every call). */
function unnested(pieces: Face[]): Face[] {
  for (const f of pieces) delete f.holds;
  const holed = pieces.filter((f) => f.holes.length);
  if (!holed.length) return pieces;
  const grid = new FaceGrid(holed, cellSizeOf(holed));
  return pieces.filter((f) => {
    const round = grid.holding(f.outer[0]!).filter((g) => g !== f && g.area > f.area);
    for (const g of round) g.holds = (g.holds ?? 0) + 1;
    return !round.length;
  });
}

/**
 * The web between two cuts: every piece closer than `web` to another gives way by half the
 * shortfall (`giveWay`), all round its outline — a piece of `keeps` none to a smaller one, which
 * takes it all (`yields`); a piece whose neighbours are all a web off keeps its drawn size. (A
 * piece's wall with ITSELF — a spiral's turns, a snowflake's branches — is no wall between two
 * cuts: the wood there is open to the rest.) What a piece shrinks to may part: each
 * part is a piece, with `from` the piece it came from. `gaps` holds each piece's nearest other cut,
 * as far as the web.
 */
function holdWeb(pieces: Face[], gaps: number[], web: number, host: LatticeHost, keeps?: Set<Face>): { parts: Face[]; from: Face[]; wall: number } {
  const wall = gaps.reduce((m, g) => Math.min(m, g), Infinity);
  let parts: Face[] = pieces;
  let from: Face[] = pieces;
  let gap = gaps;
  // A piece that shrinks may part at a neck, and its two parts then stand closer than the web:
  // they give way in turn — a round or two more, and what is left holds the web everywhere.
  for (let round = 0; round < GIVE_ROUNDS; round++) {
    if (round) gap = nearestGaps(parts.map((f) => f.outer), web).gap;
    if (!gap.some((g) => giveWay(g, web) > 0)) break;
    const give = keeps?.size ? yields(parts, web, keeps) : gap.map((g) => giveWay(g, web));
    const nextParts: Face[] = [];
    const nextFrom: Face[] = [];
    const byDepth = new Map<number, number[]>();
    parts.forEach((f, i) => {
      const d = give[i]!;
      if (d <= 0) {
        nextParts.push(f);
        nextFrom.push(from[i]!);
        return;
      }
      // In steps of a two-hundredth of a millimetre, rounded up: one boolean per step, not per piece.
      const key = Math.ceil(d * 200) / 200;
      const list = byDepth.get(key);
      if (list) list.push(i);
      else byDepth.set(key, [i]);
    });
    const indexOf = new Map(parts.map((f, i) => [f, i] as const));
    for (const [d, group] of byDepth) {
      const members = group.map((i) => parts[i]!);
      const grid = new FaceGrid(members, cellSizeOf(members));
      for (const island of host.offset(members.map((f) => [f.outer]), -d)) {
        const part = faceOf(island);
        if (!part || part.area <= 1e-6) continue;
        const source = grid.holding(part.outer[0]!)[0];
        if (!source) continue;
        nextParts.push({ ...part, holes: [] });
        nextFrom.push(from[indexOf.get(source)!]!);
      }
    }
    parts = nextParts;
    from = nextFrom;
  }
  return { parts, from, wall };
}
/** Rounds of giving way: the first holds every wall between two pieces; the rest the walls between
 *  the parts a piece parts into at a neck. */
const GIVE_ROUNDS = 3;

/**
 * How far each piece gives way to hold the web when some `keeps` their drawn size: half the
 * shortfall to every piece nearer than it, and a hair more (`giveWay`) — but against a piece of
 * `keeps` bigger than it, and not `ALIKE`, the whole shortfall (both hairs): the kept one gives
 * none. A piece gives the most any neighbour asks of it.
 */
function yields(pieces: Face[], web: number, keeps: Set<Face>): number[] {
  const out = pieces.map(() => 0);
  for (const { i, j, d } of nearestGaps(pieces.map((f) => f.outer), web, web).pinches) {
    const half = giveWay(d, web);
    if (!(half > 0)) continue;
    const [big, small] = pieces[i]!.area >= pieces[j]!.area ? [i, j] : [j, i];
    if (keeps.has(pieces[big]!) && pieces[small]!.area < ALIKE * pieces[big]!.area) {
      out[small] = Math.max(out[small]!, 2 * half);
    } else {
      out[i] = Math.max(out[i]!, half);
      out[j] = Math.max(out[j]!, half);
    }
  }
  return out;
}
/** Two cuts within a fifth of each other in area are alike: neither is the bigger (copies of one
 *  motif the tile's seams or the import left a little apart, Plus - 5's crosses). */
const ALIKE = 0.8;

/** The pieces above the floors: at least `minArea` inside their outline, and the studio's 1 mm disc
 *  at their widest — or, for a piece `SLOT_LONG` times as long as it is wide, a slot
 *  `SLOT_MIN_WIDTH` wide: the outline shrunk by half of it (less a hair) keeps something, with the
 *  host's own fine arcs, so a band at the floor still takes the cut. (A motif clipped at the zone's
 *  edge is still the motif: a curl cut short is a curl.) */
function aboveFloors(pieces: Face[], minArea: number, host: LatticeHost): Set<Face> {
  const wide = new Set<Face>();
  const big = pieces.filter((f) => f.area >= minArea);
  if (!big.length) return wide;
  const holding = (faces: Face[], d: number): Set<Face> => {
    const grid = new FaceGrid(faces, cellSizeOf(faces));
    const out = new Set<Face>();
    for (const island of host.offset(faces.map((f) => [f.outer]), -d)) {
      const probe = island[0]?.[0];
      if (probe) for (const f of grid.holding(probe)) out.add(f);
    }
    return out;
  };
  const slots = [...holding(big, SLOT_MIN_WIDTH / 2 - FLOOR_SLACK)];
  if (!slots.length) return wide;
  const discs = holding(slots, LATTICE_MIN_WIDTH / 2 - FLOOR_SLACK);
  const widest = widestOf();
  for (const f of slots) if (discs.has(f) || f.area >= SLOT_LONG * (2 * widest.radius(f)) ** 2) wide.add(f);
  return wide;
}

/**
 * Nothing may hang: the wood the cut leaves on the region, a kerf burnt off every cut, must all
 * still reach the region's OUTER edge — the frame, and the rest of the piece past it (a reserve's
 * edge anchors nothing: a card's panel is held only by the wood round it). A bit of wood that does
 * not would fall out. Looked for at every one of `LOOSE_BITES`: a sliver one of them burns away
 * whole, a lesser one frees (Plaid - 4's comb on the tall card). A bit in ONE piece's own bay — the
 * teeth in a skull's mouth, the wood a pinch closes among Triangles - 15's triangles — is cut with
 * that piece, whatever its size, as the kerf burns a bay narrower than a kerf wall: what the laser
 * does (inv-4 A; the piece loses a detail the laser takes anyway, never the whole motif). A bit
 * among several pieces under `LOOSE_SMALL` is cut with them, as one opening; a bigger one keeps them
 * as wood (`dropped`), and the cut says so. The pattern is cut either way.
 */
function unloosed(kept: Face[], region: Shapes, outside: Shapes, reserves: Pt[], host: LatticeHost): { kept: Face[]; joined: number; dropped: Set<Face> } {
  const none = { kept, joined: 0, dropped: new Set<Face>() };
  if (!kept.length) return none;
  // The pieces round a bit: within the greatest bite (and a hair) of its outline.
  const reach = LOOSE_BITES[LOOSE_BITES.length - 1]! + 0.05;
  const around = (bit: Face): Face[] => {
    const edge = new EdgeIndex([[bit.outer]]);
    return kept.filter((f) => f.box.maxX >= bit.box.minX - reach && f.box.minX <= bit.box.maxX + reach && f.box.maxY >= bit.box.minY - reach && f.box.minY <= bit.box.maxY + reach
      && f.outer.some((a, i) => edge.segmentDistance(a, f.outer[(i + 1) % f.outer.length]!, reach) <= reach));
  };
  // A bit hangs behind a neck a bite burns through: between two pieces, or a piece and itself. Where no
  // two pieces come that near — the web keeps them apart — every bit lies in one piece's own bay, and
  // is looked for motif by motif (`ownBits`); else in all the wood the cut leaves at once.
  const near = kept.length > 1 && nearestGaps(kept.map((f) => f.outer), 2 * reach, 2 * reach).pinches.length > 0;
  let bits: { bit: Face; with: Face[] }[];
  if (near) {
    const wood = host.subtract(region, kept.map((f) => [f.outer]));
    const outerEdge = new EdgeIndex(region.map((island) => faceOf(island)).filter((f): f is Face => !!f).map((f) => [f.outer]));
    // What a lesser bite frees holds what a greater frees of the same wood (an erosion only
    // shrinks): a bit of a greater bite counts only where no bit of a lesser one holds it.
    const found: Face[] = [];
    for (const bite of LOOSE_BITES) {
      for (const f of host.offset(wood, -bite).map(faceOf)) {
        if (!f || islandArea(f) <= LOOSE_WOOD || f.outer.some((p) => outerEdge.distance(p, KERF_WALL) <= KERF_WALL)) continue;
        if (!found.some((h) => boxWithin(f.box, h.box) && pointInRing(f.outer[0]!, h.outer))) found.push(f);
      }
    }
    bits = found.map((bit) => ({ bit, with: around(bit) }));
  } else bits = ownBits(kept, host);
  if (!bits.length) return none;
  const drop = new Set<Face>();
  const join: { bit: Face; with: Face[] }[] = [];
  for (const { bit, with: with_ } of bits) {
    // (Never a bit round a reserve or a solid: cut with the piece, the reserve would fall out with it.)
    const round = reserves.some((p) => inBox(p, bit.box) && pointInRing(p, bit.outer));
    if (!round && (with_.length === 1 || (with_.length && islandArea(bit) < LOOSE_SMALL))) join.push({ bit, with: with_ });
    else for (const f of with_) drop.add(f);
  }
  let out = kept.filter((f) => !drop.has(f));
  const joining = join.filter((j) => j.with.every((f) => !drop.has(f)));
  if (joining.length) {
    const members = new Set(joining.flatMap((j) => j.with));
    const grown = host.offset(joining.map((j) => [j.bit.outer]), reach);
    const merged = host.subtract([...[...members].map((f) => [f.outer]), ...grown], outside).map(faceOf).filter((f): f is Face => !!f && f.area > 1e-6);
    out = [...out.filter((f) => !members.has(f)), ...merged.map((f) => ({ ...f, holes: [] }))];
  }
  return { kept: out, joined: joining.length, dropped: drop };
}

/**
 * The bits of wood the pieces' own bays hold once each of `LOOSE_BITES` is burnt off: each piece's box
 * (grown past the greatest bite) less the piece, eroded, and what no longer reaches the box's edge.
 * Once a motif (`byMotif`), every motif in one boolean — each alone in a box of its own, the boxes laid
 * out apart — and moved to each of its copies; each bit with the piece it lies in.
 */
function ownBits(kept: Face[], host: LatticeHost): { bit: Face; with: Face[] }[] {
  const motifs = byMotif(kept);
  const most = LOOSE_BITES[LOOSE_BITES.length - 1]!;
  const g = most + 0.1;
  // Only a piece whose outline comes back to itself across less wood than a bite closes can hold a
  // bit: the bay behind that neck holds a disc wider than the neck, so the way round it is over π − 1
  // times the neck (`NECK_ARC`) — never a corner's.
  const firsts = [...motifs.keys()];
  const necked = selfNecks(firsts.map((f) => f.outer), 2 * most + 0.03, NECK_ARC);
  const slots: { f: Face; dx: number; dy: number; box: Box }[] = [];
  let x = 0;
  for (const f of firsts.filter((_, i) => necked[i])) {
    const w = f.box.maxX - f.box.minX + 2 * g;
    const h = f.box.maxY - f.box.minY + 2 * g;
    slots.push({ f, dx: x + g - f.box.minX, dy: g - f.box.minY, box: { minX: x, minY: 0, maxX: x + w, maxY: h } });
    x += w + 1;
  }
  if (!slots.length) return [];
  const local = host.subtract(
    slots.map((s) => [[[s.box.minX, s.box.minY], [s.box.maxX, s.box.minY], [s.box.maxX, s.box.maxY], [s.box.minX, s.box.maxY]] as Ring]),
    slots.map((s) => [s.f.outer.map((p): Pt => [p[0] + s.dx, p[1] + s.dy])]),
  );
  const slotOf = (b: Box): number => slots.findIndex((s) => b.minX >= s.box.minX - 1e-6 && b.maxX <= s.box.maxX + 1e-6);
  const found = slots.map((): Face[] => []);
  for (const bite of LOOSE_BITES) {
    for (const f of host.offset(local, -bite).map(faceOf)) {
      if (!f || islandArea(f) <= LOOSE_WOOD) continue;
      const i = slotOf(f.box);
      if (i < 0) continue;
      // Still reaching its box's edge: the wood round the piece, not a bit.
      const s = slots[i]!.box;
      const e = bite + 0.01;
      if (f.box.minX <= s.minX + e || f.box.maxX >= s.maxX - e || f.box.minY <= s.minY + e || f.box.maxY >= s.maxY - e) continue;
      if (!found[i]!.some((h) => boxWithin(f.box, h.box) && pointInRing(f.outer[0]!, h.outer))) found[i]!.push(f);
    }
  }
  const out: { bit: Face; with: Face[] }[] = [];
  slots.forEach((s, i) => {
    for (const bit of found[i]!) {
      const home = moved(bit, -s.dx, -s.dy);
      for (const copy of motifs.get(s.f)!) out.push({ bit: copy === s.f ? home : moved(home, copy.box.minX - s.f.box.minX, copy.box.minY - s.f.box.minY), with: [copy] });
    }
  });
  return out;
}

/** The zoom model of each piece (`ShapeModel`), for a sentence that must name a zoom that cuts;
 *  `fingers`, the width of each piece's narrowest finger of wood, where it holds one. */
function modelsOf(pieces: Face[], gaps: number[], current: number, widest: Widest, fingers?: Map<Face, number>): ShapeModel[] {
  // A piece this small never passes the floors at any zoom the slider offers: no need to find its
  // widest disc.
  const least = LATTICE_MIN_AREA * (current / ZOOM_MAX) ** 2;
  return pieces.map((f, i) => {
    const radius = f.area < least ? 0 : widest.radius(f);
    const finger = fingers?.get(f);
    // Long or not is the same at any zoom: area and the widest disc's width squared grow alike.
    return { area: f.area, outline: widest.outline(f), radius, gap: gaps[i] ?? Infinity, long: f.area >= SLOT_LONG * (2 * radius) ** 2, ...(finger !== undefined ? { finger } : {}) };
  });
}

/**
 * Round 7: the pieces that hold a FINGER of wood inside their own outline — a band narrower than
 * `thinnest` between two arms of one piece, which a kerf thins from both sides along its whole
 * length until it chars through or snaps (Plaid's hatching; a hair in Memphis - 6, Christmas - 2,
 * Waves - 10). A piece's own bays are what closing it by half `thinnest` fills (`close(piece) −
 * piece`: every bay narrower than that, and nothing else), and one is a finger when it is a BAND:
 * over `FINGER_MIN` long (half its outline), `FINGER_LONG` times as long as it is wide, and filling
 * `FINGER_BAND` of that band. A V between two arms (a snowflake's, a star's, a lantern's) tapers from
 * its tip, held along both sides: no finger. Only a piece whose outline comes back to itself across
 * wood nearer than `thinnest` is closed (`selfNecks`), and a bay two pieces share is a gap between
 * them, the web's. Asked once a motif (`byMotif`). Each piece with a finger → its narrowest finger's
 * width (twice its widest disc).
 */
function fingersOf(pieces: Face[], thinnest: number, host: LatticeHost): Map<Face, number> {
  const out = new Map<Face, number>();
  const motifs = byMotif(pieces);
  const firsts = [...motifs.keys()];
  const necked = selfNecks(firsts.map((f) => f.outer), thinnest);
  const suspects = firsts.filter((_, i) => necked[i]);
  if (!suspects.length) return out;
  const r = thinnest / 2;
  const outers = suspects.map((f) => [f.outer]);
  const bays = host.subtract(host.offset(host.offset(outers, r), -r), outers).map(faceOf).filter((b): b is Face => !!b && islandArea(b) > FINGER_MEAN * FINGER_MIN);
  const reach = r + 0.05;
  // Whose bay: the one piece whose outline comes within reach of it (-1: none, or two — a gap).
  const grid = new EdgeGrid(suspects.map((f) => f.outer), reach);
  const ownerOf = (bay: Face): number => {
    let who = -1;
    for (const p of bay.outer) {
      const k0 = grid.key(p[0], p[1]);
      for (const dk of grid.around) {
        const list = grid.at(k0 + dk);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const i = list[k]!;
          if (i === who) continue;
          const ring = grid.rings[i]!;
          const a = list[k + 1]!;
          if (pointSegmentDistance(p, ring[a]!, ring[(a + 1) % ring.length]!) > reach) continue;
          if (who >= 0) return -1;
          who = i;
        }
      }
    }
    return who;
  };
  const widths = new Map<Face, number>();
  for (const bay of bays) {
    const L = ringLength(bay.outer) / 2;
    const area = islandArea(bay);
    if (L <= FINGER_MIN || area / L < FINGER_MEAN) continue;
    const who = ownerOf(bay);
    if (who < 0) continue;
    const f = suspects[who]!;
    // Its widest disc ρ, looked for only as far as it could make a finger — the band test holds for ρ
    // up to the lesser root of 1.5ρ(L − 2ρ) = area, the length test up to L / 12 — or narrow the
    // piece's narrowest finger found so far: a comb's hundreds of bays are asked a moment each.
    const disc = 2.25 * L * L - 12 * area;
    const band = disc >= 0 ? (1.5 * L - Math.sqrt(disc)) / 6 : Infinity;
    const known = widths.get(f);
    const bound = Math.min(band, L / (2 * (FINGER_LONG + 1)), known !== undefined ? known / 2 - 0.0025 : Infinity);
    const rho = alongPole(bay, bound);
    if (!(rho > 0) || rho >= bound) continue;
    const width = 2 * rho;
    const len = L - width;
    if (len < FINGER_LONG * width || area < FINGER_BAND * len * width) continue;
    widths.set(f, Math.min(known ?? Infinity, width));
  }
  for (const [first, width] of widths) for (const f of motifs.get(first)!) out.set(f, width);
  return out;
}

/** A bay's widest disc, to 0.005 mm, looked for no further than `enough`: the bay turned to lie along
 *  its own length first (its points' principal axis), so a thin finger running on a diagonal is
 *  searched in cells its own width, not in the square its box makes. */
function alongPole(bay: Face, enough: number): number {
  const pts = bay.outer;
  let mx = 0;
  let my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length;
  my /= pts.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of pts) { const dx = p[0] - mx; const dy = p[1] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const t = -0.5 * Math.atan2(2 * xy, xx - yy);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const turn = (r: Ring): Ring => r.map(([x, y]): Pt => [(x - mx) * c - (y - my) * s, (x - mx) * s + (y - my) * c]);
  return poleOf(turn(pts), 0.005, bay.holes.map(turn), enough).radius;
}

/** How much longer than the neck the way round a bay's outline must be for the bay to hold a bit of
 *  wood a bite frees: its inscribed disc is wider than the neck, so the way is over (π − 1) times it,
 *  less the host's arcs. Shorter, it is a corner. */
const NECK_ARC = 1.5;

/** A ring's length round, closed. */
const ringLength = (r: Ring): number => r.reduce((s, p, i) => s + Math.hypot(r[(i + 1) % r.length]![0] - p[0], r[(i + 1) % r.length]![1] - p[1]), 0);

/** The pieces by motif, each under its first: a tile's pieces are copies of a few motifs — the same
 *  points, area, outline and box to a ten-thousandth, and every point where the first's is, moved by
 *  the difference of their boxes (a mirrored or turned copy measures the same and is no translate) —
 *  so what a piece's own outline holds (its fingers, what opening it leaves, a bit in its bay) is asked
 *  once a motif, and moved to each copy. */
function byMotif(pieces: Face[]): Map<Face, Face[]> {
  const firstsOf = new Map<string, { f: Face; at: Set<string> }[]>();
  const out = new Map<Face, Face[]>();
  const spot = (p: Pt, f: Face): string => `${Math.round((p[0] - f.box.minX) * 1e3)},${Math.round((p[1] - f.box.minY) * 1e3)}`;
  for (const f of pieces) {
    const key = [f.outer.length, f.area, ringLength(f.outer), f.box.maxX - f.box.minX, f.box.maxY - f.box.minY].map((v) => Math.round(v * 1e4)).join(',');
    const firsts = firstsOf.get(key) ?? [];
    const first = firsts.find((c) => f.outer.every((p) => c.at.has(spot(p, f))));
    if (first) out.get(first.f)!.push(f);
    else {
      firsts.push({ f, at: new Set(f.outer.map((p) => spot(p, f))) });
      firstsOf.set(key, firsts);
      out.set(f, [f]);
    }
  }
  return out;
}

/** A face moved by (dx, dy). */
const moved = (f: Face, dx: number, dy: number): Face => ({
  ...f,
  outer: f.outer.map((p): Pt => [p[0] + dx, p[1] + dy]),
  holes: f.holes.map((h) => h.map((p): Pt => [p[0] + dx, p[1] + dy])),
  box: { minX: f.box.minX + dx, minY: f.box.minY + dy, maxX: f.box.maxX + dx, maxY: f.box.maxY + dy },
});

/**
 * Round 7, the cut of a piece with a finger: only where it holds the slot — the piece opened by half
 * of it (`SLOT_MIN_WIDTH`, less the floors' give), so every arm narrower than that stays wood with
 * the fingers beside it, and each part it falls into goes back through the floors; a part that still
 * holds a finger (between two arms wider than the slot) stays wood too. Worked once a motif and moved
 * to its copies. The parts to cut of each piece in `fingers` (none, when nothing of it is left).
 */
function fingerParts(fingers: Map<Face, number>, thinnest: number, minArea: number, host: LatticeHost): Map<Face, Face[]> {
  const out = new Map<Face, Face[]>();
  if (!fingers.size) return out;
  const motifs = byMotif([...fingers.keys()]);
  const firsts = [...motifs.keys()];
  const d = SLOT_MIN_WIDTH / 2 - FLOOR_SLACK;
  const grid = new FaceGrid(firsts, cellSizeOf(firsts));
  const parts: Face[] = [];
  const from = new Map<Face, Face>();
  for (const island of host.offset(host.offset(firsts.map((f) => [f.outer]), -d), d)) {
    const part = faceOf(island);
    if (!part || part.area <= 1e-6) continue;
    const source = grid.holding(insideOf(part.outer))[0];
    if (!source) continue;
    const p = { ...part, holes: [] };
    parts.push(p);
    from.set(p, source);
  }
  const wide = aboveFloors(parts, minArea, host);
  const passing = parts.filter((p) => wide.has(p));
  const still = fingersOf(passing, thinnest, host);
  const kept = new Map<Face, Face[]>(firsts.map((f) => [f, []]));
  for (const p of passing) if (!still.has(p)) kept.get(from.get(p)!)!.push(p);
  for (const [first, copies] of motifs) {
    const mine = kept.get(first)!;
    for (const f of copies) out.set(f, f === first ? mine : mine.map((p) => moved(p, f.box.minX - first.box.minX, f.box.minY - first.box.minY)));
  }
  return out;
}

/**
 * Which rings come back to THEMSELVES across wood nearer than `reach`: two stretches of one outline
 * facing each other across a bay (a comb's slot, a C's mouth) — not the two sides of a corner
 * (`SELF_ARC`, or `arc`), nor of a spike of the cut itself (across ink) — or touching at a pinch. A
 * ring with none holds no bay narrower than `reach`, and no finger. (`kerfFillers`' own test, as a yes
 * or no.)
 */
function selfNecks(rings: Ring[], reach: number, arc = SELF_ARC): boolean[] {
  const out = rings.map(() => false);
  if (!rings.length) return out;
  const grid = new EdgeGrid(rings, reach);
  rings.forEach((r, i) => {
    const n = r.length;
    if (n < 4) return;
    const along: number[] = [0];
    for (let a = 0; a < n; a++) along.push(along[a]! + Math.hypot(r[(a + 1) % n]![0] - r[a]![0], r[(a + 1) % n]![1] - r[a]![1]));
    const total = along[n]!;
    const ccw = signedArea(r) > 0;
    for (let a = 0; a < n && !out[i]; a++) {
      const p = r[a]!;
      const before = (a + n - 1) % n;
      const k0 = grid.key(p[0], p[1]);
      for (const dk of grid.around) {
        const list = grid.at(k0 + dk);
        if (!list || out[i]) continue;
        for (let k = 0; k < list.length; k += 2) {
          if (list[k] !== i) continue;
          const b = list[k + 1]!;
          if (b === a || b === before) continue;
          const s = r[b]!;
          const e = r[(b + 1) % n]!;
          const d = pointSegmentDistance(p, s, e);
          if (d >= reach) continue;
          const c = closestOn(p, s, e);
          const side = (e[0] - s[0]) * (p[1] - c[1]) - (e[1] - s[1]) * (p[0] - c[0]);
          if (d > PINCH && (ccw ? side >= 0 : side <= 0)) continue;
          const way = Math.abs(along[b]! + Math.hypot(c[0] - s[0], c[1] - s[1]) - along[a]!);
          if (Math.min(way, total - way) <= arc * d) continue;
          out[i] = true;
          break;
        }
      }
    }
  });
  return out;
}

/** Past this, mm, a piece's widest disc is not looked for further: it holds a slot at any zoom
 *  above this one, and after giving way to any web up to two. */
const WIDEST_ENOUGH = SLOT_MIN_WIDTH / 2 + 1;

/** The widest disc of a piece's outline (`poleOf`, to 0.02 mm; at most `WIDEST_ENOUGH`) and its
 *  length — found once for every copy of it: a tile's pieces are copies of a few motifs, and a
 *  copy has the same points, area, outline and box to a ten-thousandth. */
interface Widest { radius(f: Face): number; outline(f: Face): number }
function widestOf(): Widest {
  const lengths = new Map<Face, number>();
  const radii = new Map<string, number>();
  const outline = (f: Face): number => {
    let l = lengths.get(f);
    if (l === undefined) {
      l = f.outer.reduce((s, p, k) => s + Math.hypot(f.outer[(k + 1) % f.outer.length]![0] - p[0], f.outer[(k + 1) % f.outer.length]![1] - p[1]), 0);
      lengths.set(f, l);
    }
    return l;
  };
  return {
    outline,
    radius: (f) => {
      const key = [f.outer.length, f.area, outline(f), f.box.maxX - f.box.minX, f.box.maxY - f.box.minY].map((v) => Math.round(v * 1e4)).join(',');
      let r = radii.get(key);
      if (r === undefined) {
        r = poleOf(f.outer, 0.02, [], WIDEST_ENOUGH).radius;
        radii.set(key, r);
      }
      return r;
    },
  };
}

/**
 * Rule 0, before any lattice, for a pattern of SHAPES (`cut.shapes`): are they motifs? Topology
 * decides, with the host's booleans, on the pieces the laser would cut (`kerfPieces`): a piece
 * that rings a reserve (a card's panel) or cages the zone's cells (`MOTIF_OWNS`, `CAGE_SPAN`) is a
 * network — a lattice's, and null says so. Stars, snowflakes, dots, lanterns stand apart on one
 * background, each cut by its outline (what it encloses leaves with it, so no wood can fall).
 *
 * Motifs are cut as Engrave draws them, clipped at the zone's edge, and the Web holds between any
 * two: where two cuts come closer than the web, both give way by half the shortfall (`holdWeb`) —
 * unless that ruins the bigger, which then keeps its drawn size and the smaller takes it all; a
 * motif whose neighbours are all a web off keeps its drawn size. A piece under the floors — 2 mm², and a slot `SLOT_MIN_WIDTH`
 * wide at its widest — stays wood. Refused, with a zoom that cuts, when
 * nothing is above the floors (`tooSmall`), when held to the web most of what was falls under them
 * (`tooTight`: the zoom at which the walls reach the web), or when what is left is under
 * `NEAR_EMPTY` of what Engrave draws; said, when more than `FLOORED_QUIET` of it stays wood, or when
 * a piece stays wood so no wood hangs (`unloosed`). The zoom a sentence names is tried there first
 * (`provenZoom`).
 */
function motifCut(cut: LatticeCut, zone: Shapes, host: LatticeHost, stats: LatticeStats, warnings: string[], trial: ZoomTrial, seen?: Seen): MotifResult | null {
  const v = motifPass(cut, zone, host, stats, seen);
  if (!v) return null;
  const result = (faces: Shapes, zoom?: number | null): MotifResult => ({ faces, stats, warnings, ...(zoom ? { zoom } : {}) });
  if (v.kind === 'nothing') {
    warnings.push(nothingReaches(cut.name));
    return result([]);
  }
  if (v.kind === 'cut') {
    // (A field is drawn afresh at another zoom: its likeness grown is no promise of a clean cut there.)
    if (v.parts) warnings.push(partlyTooSmall(cut.name, cut.field ? null : provenZoom(cut, zone, host, v.zoom(), true, trial)));
    if (v.loose) warnings.push(looseStaysWood(cut.name));
    return result(v.kept!.map((f) => [signedArea(f.outer) < 0 ? [...f.outer].reverse() : f.outer]));
  }
  const zoom = provenZoom(cut, zone, host, v.zoom(), false, trial);
  stats.faces = 0;
  warnings.push(v.kind === 'tooSmall' ? tooSmall(cut.name, zoom) : tooTight(cut.name, zoom));
  return { ...result([], zoom), ...(v.ink ? { ink: v.ink } : {}) };
}

/** Rule 0's cut or refusal; a refusal carries the pieces it refused (`latticeCut`'s fallback). */
interface MotifResult extends LatticeResult {
  ink?: Face[];
}

/** What rule 0 saw on its way to reading the shapes as a network: the shapes as Engrave draws them
 *  on the zone (`kerfPieces`), so the lattice that cuts them instead can say what it cut. */
interface Seen {
  ink?: Face[];
}

/**
 * How a lattice of refused motifs' outlines reads, if as the pattern at all: 'lines' when
 * `LINE_SHARE` of the ink is in shapes no disc half the web wide fits, most of it `SLOT_LONG` times as
 * long as they are wide (the struts are the lines — not dots, whose struts would close the ground
 * between them);
 * 'bodies' when over `CORE_SHARE` of it lies more than half a web in from its edges (the struts
 * only narrow the shapes — if the lattice then cuts `IN_INK` of its faces inside them); else null.
 */
function strutsRead(ink: Face[], web: number, host: LatticeHost): 'lines' | 'bodies' | null {
  const inkArea = ink.reduce((s, f) => s + islandArea(f), 0);
  if (!(inkArea > 0)) return null;
  const widest = widestOf();
  let thin = 0;
  let long = 0;
  for (const f of ink) {
    const r = widest.radius(f);
    if (r >= web / 2) continue;
    thin += islandArea(f);
    if (f.area >= SLOT_LONG * (2 * r) ** 2) long += islandArea(f);
  }
  if (thin >= LINE_SHARE * inkArea && long >= 0.5 * inkArea) return 'lines';
  const core = host.offset(ink.map((f) => [f.outer, ...f.holes]), -web / 2).reduce((s, island) => s + areaOf(island), 0);
  return core > CORE_SHARE * inkArea ? 'bodies' : null;
}
/** The share of `faces` (by area) that lies in the ink. */
function inInk(faces: Shapes, ink: Face[], host: LatticeHost): number {
  const all = faces.reduce((s, island) => s + areaOf(island), 0);
  if (!(all > 0)) return 0;
  const out = host.subtract(faces, ink.map((f) => [f.outer, ...f.holes])).reduce((s, island) => s + areaOf(island), 0);
  return (all - out) / all;
}
/** An island's area: its outer less its holes. */
const areaOf = (island: Ring[]): number => {
  const f = faceOf(island);
  return f ? islandArea(f) : 0;
};
/** Ink that is this share lines — shapes no disc half the web wide fits — is a pattern of lines. */
const LINE_SHARE = 0.9;
/** Ink with more than this share more than half a web in from its edges is shapes, not lines. */
const CORE_SHARE = 0.3;
/** A lattice of shapes' outlines that cuts this share of itself inside them cuts the shapes. */
const IN_INK = 0.6;
/** A lattice of a network's outlines that cuts under this share of itself inside the shapes cuts
 *  the gaps between them, and says so (`cutAsGaps`). */
const GAPS_SHARE = 0.4;

/** What rule 0 comes to at one zoom: nothing in the zone, a refusal — too small, or too tight for
 *  the web — or a cut (its pieces; whether the floors, the web or the fingers left over
 *  `FLOORED_QUIET` of it as wood; whether a piece stays wood so no wood hangs); with the zoom the
 *  pass's own model names, for the sentence. Null: a network. */
interface MotifVerdict {
  kind: 'nothing' | 'tooSmall' | 'tooTight' | 'cut';
  kept?: Face[];
  parts?: boolean;
  loose?: boolean;
  zoom: () => number | null;
  /** A refusal: the pieces refused. */
  ink?: Face[];
}

function motifPass(cut: LatticeCut, zone: Shapes, host: LatticeHost, stats: LatticeStats, seen?: Seen): MotifVerdict | null {
  const zoneFaces = zone.map(faceOf).filter((f): f is Face => !!f);
  const zoneArea = zoneFaces.reduce((s, f) => s + islandArea(f), 0);
  if (!(zoneArea > 0)) return null;
  const outside = offZone(zone, cut.shapes!, host);
  // A network: a piece round a reserve, or caging cells that are a real part of the zone.
  const reserves: Pt[] = [...cut.region, ...cut.solids].flatMap((island) => island.filter((r) => r.length >= 3).map((r) => r[0]!));
  const home = (b: Box): number => zoneFaces.filter((i) => boxWithin(b, i.box)).reduce((m, i) => Math.min(m, i.area), Infinity);
  const network = (all: Face[]): boolean => !cut.holes && all.some((f) => {
    if (f.holes.some((h) => { const hb = bboxOfPoints(h); return reserves.some((p) => inBox(p, hb) && pointInRing(p, h)); })) return true;
    // Nor is a piece cut by its outline when that outline takes plain wood no shape of it draws: its
    // kerf joins close cells, a fifth of what it would cut, and it runs on over most of a period of
    // its tile — copies of the motif fused round the ground between them (Squares - 1's squares,
    // touching at their corners; Interlocked Hexagons - 1's lines) — or its holes are a real part of
    // the zone. (A cell the joins close within one motif goes with it: a lantern's pane, a ring the
    // tile's seam split.)
    if ((f.enclosed ?? 0) > ENCLOSED_SHARE * f.area && !!cut.period && Math.max(f.box.maxX - f.box.minX, f.box.maxY - f.box.minY) >= JOIN_SPAN * cut.period) return true;
    if (f.area - islandArea(f) > HOLES_SHARE * zoneArea) return true;
    // A cage — more than a couple of cells, or other pieces in its holes (concentric rings) — is a
    // network when it is a real part of its zone or runs on over more than a cell of its tile.
    if (!f.holds && f.holes.filter((h) => Math.abs(signedArea(h)) >= cut.minArea).length <= MOTIF_OWNS) return false;
    const island = home(f.box);
    return f.area >= BACKGROUND_SHARE * (Number.isFinite(island) ? island : zoneArea)
      || (!!cut.period && Math.max(f.box.maxX - f.box.minX, f.box.maxY - f.box.minY) > CAGE_SPAN * cut.period);
  });
  // A plate with holes drawn in ink, not motifs on a ground (`MOTIF_ROOM`).
  const plateOf = (f: Face): boolean => { const island = home(f.box); return f.area >= BACKGROUND_SHARE * (Number.isFinite(island) ? island : zoneArea); };
  const plate = (all: Face[]): boolean => !cut.holes && zoneArea - all.reduce((s, f) => s + f.area, 0) < MOTIF_ROOM * zoneArea && all.some(plateOf);
  // (Two shapes touch within the drawing's own rounding, which grows with the zoom as it does.)
  const drawn = kerfPieces(cut.shapes!, outside, host, network, plate, TOUCH * cut.scale, seen);
  if (!drawn) return null;
  const none = (): null => null;
  if (!drawn.length) {
    stats.motifs = true;
    return { kind: 'nothing', zoom: none };
  }
  if (plate(drawn)) return null;
  const inkArea = drawn.reduce((s, f) => s + islandArea(f), 0);

  // A piece the zone's edge clipped: some of its outline lies on that edge (asked vertex by vertex
  // only of a piece whose box comes that near the edge).
  const zoneEdge = new EdgeIndex(zone);
  const clippedSet = new Set(drawn.filter((f) => {
    const reach = Math.hypot(f.box.maxX - f.box.minX, f.box.maxY - f.box.minY) / 2 + 0.02;
    return zoneEdge.distance([(f.box.minX + f.box.maxX) / 2, (f.box.minY + f.box.maxY) / 2], reach) < reach
      && f.outer.some((p) => zoneEdge.distance(p, 0.02) < 0.02);
  }));

  // The floors as Engrave draws the pieces, and each piece's nearest other CUT: a piece under the
  // floors stays wood, and nothing gives way to wood.
  const drawnWide = aboveFloors(drawn, cut.minArea, host);
  // Round 7: a piece with a finger of wood thinner than `thinnest` inside it is cut only where it
  // holds the slot (`fingerParts`). Its parts are the pieces from here on; what the opening left as
  // wood is lost as the floors' is, and the zoom model knows the finger (the piece is whole once the
  // finger is the thinnest wood allowed).
  const thinnest = Math.max(THINNEST_WOOD, cut.thinnest ?? THINNEST_WOOD);
  const fingers = fingersOf(drawn.filter((f) => drawnWide.has(f)), thinnest, host);
  const fingered = fingerParts(fingers, thinnest, cut.minArea, host);
  const pieces: Face[] = [];
  const sourceOf = new Map<Face, Face>();
  const wide = new Set<Face>();
  for (const f of drawn) {
    const parts = fingered.get(f);
    for (const p of parts ?? [f]) {
      pieces.push(p);
      sourceOf.set(p, f);
      if (parts || drawnWide.has(f)) wide.add(p);
      if (parts && clippedSet.has(f)) clippedSet.add(p);
    }
  }
  /** What the fingers' openings left as wood of pieces as drawn, mm². */
  const fingerLost = (list: Face[]): number => list.reduce((s, f) => {
    const parts = fingered.get(f);
    return parts ? s + f.area - parts.reduce((t, p) => t + p.area, 0) : s;
  }, 0);
  const before = pieces.filter((f) => wide.has(f));
  const beforeGaps = nearestGaps(before.map((f) => f.outer), cut.web).gap;

  const gapOf = new Map(before.map((f, k) => [f, beforeGaps[k]!] as const));
  const gaps = pieces.map((f) => gapOf.get(f) ?? Infinity);
  stats.motifs = true;
  stats.cells = drawn.length;
  const current = cut.scale * 100;
  // The shares count the pattern's WHOLE pieces, when one of them is above the floors: a sliver the
  // zone's edge clipped off is the edge's, at any zoom. When none is — a narrow zone where every
  // motif big enough to cut crosses its edge, and only crumbs are whole (Halloween Pattern - 4 on
  // the tall card) — they count every piece. A piece the edge clipped that is still bigger than
  // every whole one is no sliver either: a flake that lost its tips to the edge is still the
  // pattern, beside its diamonds (Snowflakes - 1 on the half card). (Asked of the pieces as drawn; a
  // piece's parts are judged with it.)
  const whole = drawn.filter((f) => !clippedSet.has(f));
  const biggest = whole.reduce((m, f) => (drawnWide.has(f) ? Math.max(m, f.area) : m), 0);
  const judgeDrawn = biggest > 0 ? drawn.filter((f) => !clippedSet.has(f) || (drawnWide.has(f) && f.area > biggest)) : drawn;
  const judgedDrawn = new Set(judgeDrawn);
  const judge = pieces.filter((f) => judgedDrawn.has(sourceOf.get(f)!));
  const judged = new Set(judge);
  const indexOf = new Map(pieces.map((f, i) => [f, i] as const));
  const drawnIndex = new Map(drawn.map((f, i) => [f, i] as const));
  const widest = widestOf();
  // The zoom model: each piece as drawn grown, and given way to every other — at a zoom that cuts
  // them, the pieces under the floors here are neighbours there.
  const byFloors = (): number | null => {
    const all = nearestGaps(drawn.map((f) => f.outer), cut.web).gap;
    return deliveringZoom(modelsOf(judgeDrawn, judgeDrawn.map((f) => all[drawnIndex.get(f)!] ?? Infinity), current, widest, fingers), current, cut.web, SLOT_MIN_WIDTH, cut.minArea, thinnest);
  };
  const refusal = (kind: 'tooSmall' | 'tooTight', wall: number): MotifVerdict => {
    stats.faces = 0;
    return { kind, ink: drawn, zoom: () => (kind === 'tooTight' ? webZoom(wall, cut.web, current) : null) ?? byFloors() };
  };
  const areaOfList = (list: Face[]): number => list.reduce((s, f) => s + f.area, 0);
  const beforeJudged = before.filter((f) => judged.has(f));
  if (!beforeJudged.length) {
    stats.tooSmall = pieces.length - before.length;
    stats.gaveWay = 0;
    return refusal('tooSmall', Infinity);
  }

  // Held to the web, a piece keeps a slot's width only if its widest disc, less what it gives way,
  // still holds one (an erosion takes the same off every disc): when too little of them could, the
  // web refuses it before any boolean, as the booleans would. By AREA (Ian, 2026-09-29): big shapes
  // that hold the web are the pattern, however many small ones give way and go — what fits is cut,
  // and the cut says so.
  const wall = gaps.reduce((m, g) => Math.min(m, g), Infinity);
  const could = beforeJudged.filter((f) => {
    const d = giveWay(gaps[indexOf.get(f)!]!, cut.web);
    if (d <= 0) return true;
    const r = widest.radius(f);
    return r >= WIDEST_ENOUGH || r + 0.02 - d >= SLOT_MIN_WIDTH / 2 - FLOOR_SLACK;
  });
  if (areaOfList(could) < HELD_SHARE * areaOfList(beforeJudged)) {
    stats.tooSmall = pieces.length - could.length;
    stats.gaveWay = pieces.filter((f) => giveWay(gaps[indexOf.get(f)!]!, cut.web) > 0).length;
    return refusal('tooTight', wall);
  }

  // The web, then the floors again on what gave way.
  const hold = (src: Face[], g: number[], keeps?: Set<Face>) => {
    const held = holdWeb(src, g, cut.web, host, keeps);
    const moved = held.parts.filter((f, i) => held.from[i] !== f);
    const movedWide = moved.length ? aboveFloors(moved, cut.minArea, host) : new Set<Face>();
    const kept = held.parts.filter((f, i) => held.from[i] === f || movedWide.has(f));
    const keptSet = new Set(kept);
    const survivors = new Set<Face>();
    held.parts.forEach((f, i) => { if (keptSet.has(f)) survivors.add(held.from[i]!); });
    return { held, kept, keptSet, survivors, gaveWay: new Set(held.from.filter((s, i) => held.parts[i] !== s)) };
  };
  // A piece that gave way to neighbours the floors then left as wood takes its drawn size back: the
  // web once more, among the pieces that are cut, and what `keeps` its size still does. (Giving way
  // less only grows a piece, so each still passes the floors; should one not — an offset's arcs —
  // the first pass stands.)
  const settled = (p: ReturnType<typeof hold>, keeps?: Set<Face>): ReturnType<typeof hold> => {
    if (!p.gaveWay.size || p.survivors.size === before.length) return p;
    const src = before.filter((f) => p.survivors.has(f));
    const again = hold(src, nearestGaps(src.map((f) => f.outer), cut.web).gap, keeps);
    return again.survivors.size === src.length ? again : p;
  };
  let pass = hold(before, beforeGaps);
  let settledYet = false;
  // A piece the halves ruin — what it gave way left nothing of it, or left it under the slot on
  // average (area over outline: a snowflake's arms beside its diamonds) — keeps its drawn size
  // against a smaller neighbour, not alike, which takes the whole shortfall instead: big shapes
  // that hold the web are the pattern (Ian, 2026-09-29). Taken when, both settled, it cuts more.
  if (pass.gaveWay.size || pass.survivors.size < before.length) {
    const area = new Map<Face, number>();
    const outline = new Map<Face, number>();
    pass.held.parts.forEach((f, i) => {
      if (!pass.keptSet.has(f)) return;
      const s = pass.held.from[i]!;
      area.set(s, (area.get(s) ?? 0) + f.area);
      outline.set(s, (outline.get(s) ?? 0) + ringLength(f.outer));
    });
    const whole = new Set(pass.held.parts.filter((f, i) => pass.held.from[i] === f));
    const ruined = (f: Face): boolean => !whole.has(f) && (!area.has(f) || area.get(f)! < (SLOT_MIN_WIDTH / 2 - FLOOR_SLACK) * outline.get(f)!);
    const keeps = new Set<Face>();
    for (const { i, j, d } of nearestGaps(before.map((f) => f.outer), cut.web, cut.web).pinches) {
      if (!(giveWay(d, cut.web) > 0)) continue;
      const [big, small] = before[i]!.area >= before[j]!.area ? [before[i]!, before[j]!] : [before[j]!, before[i]!];
      if (small.area < ALIKE * big.area && ruined(big)) keeps.add(big);
    }
    if (keeps.size) {
      const first = settled(pass);
      const second = settled(hold(before, beforeGaps, keeps), keeps);
      pass = areaOfList(second.kept) > areaOfList(first.kept) + 1e-6 ? second : first;
      settledYet = true;
    }
  }
  const heldBefore = beforeJudged.filter((f) => pass.survivors.has(f));
  if (areaOfList(heldBefore) < HELD_SHARE * areaOfList(beforeJudged)) {
    stats.tooSmall = pieces.filter((f) => !pass.survivors.has(f)).length;
    stats.gaveWay = pass.gaveWay.size;
    return refusal('tooTight', pass.held.wall);
  }
  if (!settledYet) pass = settled(pass);
  const { held, keptSet, survivors, gaveWay } = pass;
  let kept = pass.kept;
  stats.tooSmall = pieces.filter((f) => !survivors.has(f)).length;
  stats.gaveWay = gaveWay.size;

  // Nothing may hang.
  const loose = unloosed(kept, cut.region, outside, reserves, host);
  kept = loose.kept;
  stats.loose = loose.joined;
  stats.solid = loose.dropped.size;
  // A piece left as wood so no bit of wood hangs is a piece lost, like one under the floors — when
  // every part of it that was to be cut is — but for its own reason, said in its own words.
  const hung = new Set<Face>();
  if (loose.dropped.size) {
    const left = new Map<Face, number>();
    held.parts.forEach((f, i) => { if (keptSet.has(f) && !loose.dropped.has(f)) left.set(held.from[i]!, (left.get(held.from[i]!) ?? 0) + 1); });
    for (const src of [...survivors]) {
      if (left.has(src)) continue;
      survivors.delete(src);
      hung.add(src);
    }
  }

  const judgedArea = areaOfList(judgeDrawn);
  const lostArea = areaOfList(judge.filter((f) => !survivors.has(f))) + fingerLost(judgeDrawn);
  const keptArea = kept.reduce((s, f) => s + f.area, 0);
  stats.faces = kept.length;
  stats.coverage = drawn.length ? new Set([...survivors].map((f) => sourceOf.get(f)!)).size / drawn.length : 0;
  stats.areaCoverage = judgedArea > 0 ? (judgedArea - lostArea) / judgedArea : 0;
  stats.open = stats.areaCoverage;
  if (!kept.length || keptArea < NEAR_EMPTY * inkArea) {
    // Near empty: the floors' fault, or the web's.
    const byWeb = gaveWay.size > 0 && beforeJudged.length - heldBefore.length >= judge.length - beforeJudged.length;
    return refusal(byWeb ? 'tooTight' : 'tooSmall', held.wall);
  }
  // Said when more than `FLOORED_QUIET` of the whole pieces stays wood to the floors, the web or the
  // fingers — or of everything drawn on the zone: a clip that leaves a ring's arc, an octagon's side,
  // under the floors is the edge's for a sliver, but not when those are most of the pattern (a
  // narrow zone of big motifs). A piece kept as wood so no wood hangs is said whenever it happens.
  const allArea = areaOfList(drawn);
  const lostAll = areaOfList(pieces.filter((f) => !survivors.has(f))) + fingerLost(drawn);
  const lostHung = areaOfList(judge.filter((f) => hung.has(f)));
  const lostAllHung = areaOfList(pieces.filter((f) => hung.has(f)));
  return {
    kind: 'cut', kept, zoom: byFloors, loose: hung.size > 0,
    parts: lostArea - lostHung > FLOORED_QUIET * judgedArea || lostAll - lostAllHung > FLOORED_QUIET * allArea,
  };
}

/** How many named zooms `provenStop` follows up from the first; the rungs, %, it climbs past them
 *  (every stop of the slider this far apart, from the zoom up to its end); and how many trials it
 *  spends on the least stop that cuts below the first rung that does. */
const ZOOM_TRIES = 3;
const ZOOM_RUNG = 25;
const ZOOM_SEARCH = 3;

/**
 * The zoom a sentence names, tried there first: `at(z)` says whether the pattern cuts at `z` (null
 * when that cannot be told here) and the zoom its own sentence there would name. Up that chain a few
 * times — each view names its next stop from what it sees (a model a stop or two short is the usual
 * miss). Past it, or with no named zoom at all, up the slider a rung at a time from the zoom itself
 * — a pattern need not cut more as it grows: a web or a kerf wall its own gaps straddle comes and
 * goes, so a stop between can cut where the slider's end does not — to the first rung that cuts,
 * then the least stop below it that does (by halves, from the last stop that did not); nothing, only
 * when no rung cuts. Without `search` — a "Some small shapes stay wood", where the pattern is cut and
 * the zoom only a hint — the chain alone, and null past it. No stop is tried twice.
 */
export function provenStop(first: number | null, current: number, at: (z: number) => { cuts: boolean | null; next: () => number | null }, search = true): number | null {
  const tried = new Map<number, boolean>();
  const cuts = (z: number): { cuts: boolean; next: () => number | null } => {
    const v = at(z);
    tried.set(z, v.cuts !== false);
    return { cuts: v.cuts !== false, next: v.next };
  };
  let z = first;
  for (let tries = 0; z !== null && tries < ZOOM_TRIES; tries++) {
    const v = cuts(z);
    if (v.cuts) return z;
    const next = v.next();
    z = next !== null && next > z ? next : null;
  }
  if (!search) return null;
  let hi: number | null = null;
  for (let rung = (Math.floor(current / ZOOM_RUNG + 1e-6) + 1) * ZOOM_RUNG; rung <= ZOOM_MAX && hi === null; rung += ZOOM_RUNG) {
    if (tried.get(rung) ?? cuts(rung).cuts) hi = rung;
  }
  if (hi === null) return null;
  let lo = current;
  for (const [t, c] of tried) if (!c && t < hi && t > lo) lo = t;
  for (let pass = 0; pass < ZOOM_SEARCH; pass++) {
    const mid = zoomStop((lo + hi) / 2, lo);
    if (mid === null || mid >= hi) break;
    if (tried.get(mid) ?? cuts(mid).cuts) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A pattern's lines in the region at `scale` — exactly `fillShape`'s `toRegion`, term for term, so a
 *  zoom's lines here are the fill's at that zoom to the last bit. */
function linesAt(drawn: DrawnLines, scale: number): Polyline[] {
  const { c, o, cos, sin, d } = drawn;
  return drawn.lines.map((line) => line.map(([x, y]): Pt => {
    const px = x * scale + (o[0] - c[0]);
    const py = y * scale + (o[1] - c[1]);
    return [c[0] + px * cos - py * sin + d[0], c[1] + px * sin + py * cos + d[1]];
  }));
}

/** Rule 0's lines for a stroke or hairline pattern: drawn at its zoom, to the region's box (never
 *  clipped round a panel), merged and thinned as the lattice's are. */
function inkLines(cut: LatticeCut): Polyline[] {
  const b = bboxOfPoints(cut.region.flatMap((island) => island[0] ?? []));
  const box: Shapes = [[[[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]]];
  return clipPolylines(mergeLines(linesAt(cut.drawn!, cut.scale)), new EdgeIndex(box)).map((r) => simplifyRun(r, SIMPLIFY)).filter((r) => r.length >= 2);
}

/** How a zoom a sentence names is tried: the recipe as the build had it, and whether rule 0's ink
 *  was its lines. */
interface ZoomTrial { recipe: LatticeCut; fromLines: boolean }

/** A recipe at k times its zoom: every shape and line of the pattern k times as far from its origin
 *  (`LatticeCut.origin`), the lines clipped to the region again; the region, its reserves and the
 *  web as they were. The whole build is then run on it — lattice, rule 0 and all — so a zoom is
 *  tried the way the build at that zoom would cut. Null when the recipe at hand does not cover the
 *  view: no origin in the region's box, lines clipped round a reserve (no `drawn`), or solids of
 *  the pattern's own, which grow with it where a reserve's would not. */
function recipeAt(cut: LatticeCut, scale: number): LatticeCut | null {
  const o = cut.origin;
  const k = scale / cut.scale;
  const rb = bboxOfPoints(cut.region.flatMap((island) => island[0] ?? []));
  if (!o || cut.solids.length || !inBox(o, rb)) return null;
  const grow = (p: Pt): Pt => [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k];
  // Only what the region's box still shows (the fill's own "near the region").
  const near = (line: Pt[]): boolean => {
    const b = bboxOfPoints(line);
    return b.maxX >= rb.minX && b.minX <= rb.maxX && b.maxY >= rb.minY && b.minY <= rb.maxY;
  };
  const grown = (lines: Pt[][]): Pt[][] => lines.map((line) => line.map(grow)).filter(near);
  let runs: Polyline[] = [];
  if (cut.runs.length) {
    const source = cut.drawn ? mergeLines(linesAt(cut.drawn, scale)) : cut.region.some((island) => island.length > 1) ? null : grown(cut.runs);
    if (!source) return null;
    runs = clipPolylines(source, new EdgeIndex(cut.region)).map((run) => simplifyRun(run, SIMPLIFY)).filter((run) => run.length >= 2);
  }
  return {
    ...cut, scale, runs,
    outlines: grown(cut.outlines),
    ...(cut.shapes ? { shapes: cut.shapes.map((island) => island.map((ring) => ring.map(grow))).filter((island) => near(island[0] ?? [])) } : {}),
    ...(cut.period ? { period: cut.period * k } : {}),
  };
}

/** A build running at another zoom to try the zoom a sentence names: it names its own untried. */
let probing = 0;
/** A refusal's words; a sentence's zoom. */
const REFUSED = /too (?:small|fine|large) to cut|plain wood|never close|don't join/;
const NAMED = /(?:try|cuts from) (\d+) % zoom/;

/** `provenStop` for rule 0: the whole build at the zoom (`recipeAt`) cuts — for a "Some small shapes
 *  stay wood", cleanly (no shape left as wood there, to the floors or so no wood hangs, and not the
 *  gaps between them: `NOT_CLEAN`), and only up the chain (no zoom proven there: "… stay wood").
 *  Where the recipe cannot be grown, rule 0 alone on its ink grown the same way; failing that, the
 *  model's zoom stands. */
function provenZoom(cut: LatticeCut, zone: Shapes, host: LatticeHost, first: number | null, clean: boolean, trial: ZoomTrial): number | null {
  if (probing) return first;
  const current = cut.scale * 100;
  const o = trial.recipe.origin;
  const inBoxOf = !!o && inBox(o, bboxOfPoints(trial.recipe.region.flatMap((island) => island[0] ?? [])));
  const recipe = trial.recipe;
  const linesOf = !trial.fromLines ? null
    : recipe.drawn ? (scale: number): Polyline[] => linesAt(recipe.drawn!, scale)
    : recipe.region.some((island) => island.length > 1) ? null
    : (scale: number): Polyline[] => recipe.runs.map((run) => run.map((p) => [o![0] + (p[0] - o![0]) * (scale / recipe.scale), o![1] + (p[1] - o![1]) * (scale / recipe.scale)] as Pt));
  if (!inBoxOf || (trial.fromLines && !linesOf)) return first;
  const zb = bboxOfPoints(zone.flatMap((island) => island[0] ?? []));
  return provenStop(first, current, (z) => {
    const k = z / current;
    const whole = recipeAt(trial.recipe, z / 100);
    if (whole) {
      probing++;
      let r: LatticeResult;
      try {
        r = cutFaces(whole, host);
      } finally {
        probing--;
      }
      const said = r.warnings.join(' ');
      return { cuts: r.faces.length > 0 && !REFUSED.test(said) && !(clean && NOT_CLEAN.test(said)), next: () => r.zoom ?? (Number(NAMED.exec(said)?.[1]) || null) };
    }
    // Rule 0 alone, on its ink grown.
    const grow = (p: Pt): Pt => [o![0] + (p[0] - o![0]) * k, o![1] + (p[1] - o![1]) * k];
    const ink = trial.fromLines
      ? motifInk({ ...recipe, shapes: undefined, drawn: undefined, runs: mergeLines(linesOf!(z / 100)) }) ?? []
      : (recipe.shapes ?? []).map((island) => island.map((ring) => ring.map(grow)));
    const shapes = ink.filter((island) => {
      const b = bboxOfPoints(island[0] ?? []);
      return b.maxX >= zb.minX && b.minX <= zb.maxX && b.maxY >= zb.minY && b.minY <= zb.maxY;
    });
    if (!shapes.length) return { cuts: false, next: () => null };
    const scratch: LatticeStats = { faces: 0, cells: 0, tooSmall: 0, loose: 0, solid: 0, pruned: 0, snapped: 0, tight: 0, necks: 0, trimmed: 0, open: 0, coverage: 0, areaCoverage: 0 };
    const v = motifPass({ ...cut, shapes, scale: z / 100, ...(cut.period ? { period: cut.period * k } : {}) }, zone, host, scratch);
    return { cuts: !!v && v.kind === 'cut' && !(clean && (v.parts || v.loose)), next: () => (v && v.kind !== 'nothing' ? v.zoom() : null) };
  }, !clean);
}

/**
 * The faces of a lattice cut, with the host's booleans: `region` shrunk by `inset` and less the
 * solids is the zone; the runs it can hold (`holdRuns`) and the cells they close are found; the
 * zone less a strut round every run is the faces; then the rules in the header. What comes back
 * is one ring per face, ready to subtract from the piece — or none, and a sentence saying what
 * would cut. A pattern of shapes that stand apart is cut as its motifs instead (`motifCut`), and
 * so is a pattern of lines whose lattice cut nothing but whose ink stands apart (`motifInk`).
 *
 * The last few cuts are kept by their recipe (`recipeKey`): the studio's worker rebuilds the whole
 * design on every change, and most changes — the text, the material, a keyring — leave a pattern's
 * recipe as it was, so its cut (or its refusal) comes back at once.
 */
export function latticeFaces(cut: LatticeCut, host: LatticeHost): LatticeResult {
  const key = recipeKey(cut);
  const kept = recent.get(key);
  if (kept) {
    recent.delete(key);
    recent.set(key, kept);
    return copyResult(kept);
  }
  const r = cutFaces(cut, host);
  recent.set(key, copyResult(r));
  while (recent.size > RECENT) recent.delete(recent.keys().next().value!);
  return r;
}

/** How many cuts `latticeFaces` keeps by their recipe. */
const RECENT = 8;
const recent = new Map<string, LatticeResult>();
/** Forget the cuts kept by their recipe — for a harness that times the work itself. */
export function clearLatticeCache(): void {
  recent.clear();
}

const copyResult = (r: LatticeResult): LatticeResult => ({
  faces: r.faces.map((island) => island.map((ring) => ring.map((p) => [p[0], p[1]] as Pt))),
  stats: { ...r.stats },
  warnings: [...r.warnings],
  ...(r.zoom ? { zoom: r.zoom } : {}),
});

/** A recipe's fingerprint: two 32-bit hashes of every number and name in it (the bits of each
 *  coordinate, in order, with every list's length), so two recipes that differ anywhere differ. */
function recipeKey(cut: LatticeCut): string {
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const word = (w: number): void => {
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ ((w + 0x9e3779b9) | 0), 0x5bd1e995);
    h2 ^= h2 >>> 15;
  };
  const num = (v: number): void => {
    f64[0] = v;
    word(u32[0]!);
    word(u32[1]!);
  };
  const pts = (list: Pt[]): void => {
    word(list.length);
    for (const p of list) {
      num(p[0]);
      num(p[1]);
    }
  };
  const rings = (list: Pt[][]): void => {
    word(list.length);
    for (const r of list) pts(r);
  };
  const shapes = (list: Shapes | undefined): void => {
    word(list ? list.length : -1);
    for (const island of list ?? []) rings(island);
  };
  for (let i = 0; i < cut.name.length; i++) word(cut.name.charCodeAt(i));
  for (const v of [cut.inset, cut.web, cut.minWidth, cut.minArea, cut.scale, cut.period ?? -1, cut.stroke ?? -1, cut.hairline ? 1 : 0, cut.holes ? 1 : 0, cut.field ? 1 : 0, cut.origin?.[0] ?? NaN, cut.origin?.[1] ?? NaN, cut.thinnest ?? -1]) num(v);
  shapes(cut.region);
  shapes(cut.solids);
  rings(cut.runs);
  rings(cut.outlines);
  shapes(cut.shapes);
  rings(cut.drawn?.lines ?? []);
  for (const v of cut.drawn ? [...cut.drawn.c, ...cut.drawn.o, cut.drawn.cos, cut.drawn.sin, ...cut.drawn.d] : []) num(v);
  return `${h1 >>> 0}:${h2 >>> 0}`;
}

function cutFaces(cut: LatticeCut, host: LatticeHost): LatticeResult {
  const lattice = latticeCut(cut, host);
  if (lattice.faces.length || !cut.runs.length) return lattice;
  const ink = motifInk(cut);
  if (!ink) return lattice;
  const zone = zoneOf(cut, host);
  if (!zone.length) return lattice;
  const stats: LatticeStats = { faces: 0, cells: 0, tooSmall: 0, loose: 0, solid: 0, pruned: 0, snapped: 0, tight: 0, necks: 0, trimmed: 0, open: 0, coverage: 0, areaCoverage: 0 };
  const warnings: string[] = [];
  // Rule 0 decided these are motifs, not a network: its own cut, or its own sentence — never the
  // lattice's, which speaks of lines.
  return motifCut({ ...cut, shapes: ink }, zone, host, stats, warnings, { recipe: cut, fromLines: !cut.shapes?.length }) ?? lattice;
}

/**
 * A line pattern's ink as Engrave draws it, for rule 0 once its lattice cut nothing: its shapes;
 * else its strokes, a band `stroke` wide round every line; else — a tile drawn in hairlines — a
 * notional band a kerf wall wide, so the shapes its lines CLOSE are seen (Circles - 4's rings cut
 * as discs). Hairlines with no line closing on itself close nothing: there is nothing to try, and
 * the lattice's refusal stands. Strokes are tried however thin — rule 0's own sentence is the true
 * one ("too small to cut"), where the lattice's would say to zoom out.
 */
function motifInk(cut: LatticeCut): Shapes | null {
  if (cut.shapes?.length) return cut.shapes;
  const width = cut.stroke && cut.stroke > 0 ? cut.stroke : cut.hairline ? KERF_WALL : 0;
  const runs = cut.drawn ? inkLines(cut) : cut.runs;
  if (!(width > 0) || (!(cut.stroke && cut.stroke > 0) && !runs.some(isLoop))) return null;
  return runs.flatMap((run) => strutBands(run, width)).map((ring) => [ring]);
}

/** The zone motifs are cut in: the region shrunk by the inset, less the solids — the zone Engrave
 *  clips to (a lattice's is opened by the narrowest cut too, `latticeCut`). */
function zoneOf(cut: LatticeCut, host: LatticeHost): Shapes {
  const inner = cut.inset > 1e-6 ? host.offset(cut.region, -cut.inset) : cut.region;
  if (!inner.length) return [];
  return cut.solids.length ? host.subtract(inner, cut.solids) : inner;
}

function latticeCut(cut: LatticeCut, host: LatticeHost): LatticeResult {
  const stats: LatticeStats = { faces: 0, cells: 0, tooSmall: 0, loose: 0, solid: 0, pruned: 0, snapped: 0, tight: 0, necks: 0, trimmed: 0, open: 0, coverage: 0, areaCoverage: 0 };
  const warnings: string[] = [];
  const done = (faces: Shapes, zoom?: number | null): LatticeResult => ({ faces, stats, warnings, ...(zoom ? { zoom } : {}) });
  if (!cut.region.length || (!cut.runs.length && !cut.outlines.length)) return done([]);

  const inner = cut.inset > 1e-6 ? host.offset(cut.region, -cut.inset) : cut.region;
  if (!inner.length) {
    warnings.push(`There is no room for ${cut.name} inside a ${round(cut.inset)} mm border — make the shape bigger or the border narrower.`);
    return done([]);
  }
  // Opened by the narrowest cut: where a reserve's inset meets the border's (a panel almost as
  // wide as the card) the zone pinches to a neck a fraction of a millimetre wide, and a face
  // there is a kerf slot running along the panel — wood, not a cut. Its corners round by half
  // a millimetre, which no one will see.
  const pinched = cut.solids.length ? host.subtract(inner, cut.solids) : inner;
  const zone = cut.minWidth > 0 && pinched.length ? host.offset(host.offset(pinched, -cut.minWidth / 2), cut.minWidth / 2) : pinched;
  // (A hole cut handed over to say why says it, however narrow the zone.)
  if (!zone.length && !cut.holes) return done([]);
  // Rule 0: shapes that stand apart on one background are motifs, each cut out as itself — in the
  // zone Engrave clips to, not opened (a motif's clipped edge is Engrave's; the floors judge it).
  // Shapes that are a network go on to the lattice of their outlines (`seen`: as Engrave draws them).
  const seen: Seen = {};
  if (cut.shapes?.length && !cut.runs.length) {
    const motifs = motifCut(cut, pinched, host, stats, warnings, { recipe: cut, fromLines: false }, seen);
    if (motifs?.faces.length) return motifs;
    if (motifs) {
      // Motifs, refused: their own sentence, with the zoom it has tried. A lattice of their outlines
      // — a web-wide strut round every shape — keeps the shapes as wood and cuts the ground between
      // them, the negative (Tribal - 4, Chinese - 9), so it stands only where it reads as the
      // pattern: ink that is lines, its struts closing the cells the lines draw (New Pattern - 3),
      // or shapes the struts only narrow, the lattice cutting them (Egyptian Pattern - 1's band of
      // hexagons, too tight for the web as motifs) — `strutsRead`.
      const reads = cut.holes ? null : strutsRead(motifs.ink ?? [], cut.web, host);
      if (!reads) return motifs;
      const lattice = latticeCut({ ...cut, shapes: undefined }, host);
      return lattice.faces.length && (reads === 'lines' || inInk(lattice.faces, motifs.ink!, host) >= IN_INK) ? lattice : motifs;
    }
  }
  if (!zone.length) return done([]);
  // The shapes' outline, traced by the host and thinned like the lines; each ring closed, so the
  // graph reads it as a loop.
  const traced = cut.outlines.length
    ? host.outline(cut.outlines).filter((r) => r.length >= 3).map((r) => simplifyRun([...r, r[0]!], SIMPLIFY))
    : [];
  const held = holdRuns([...cut.runs, ...traced], zone, cut.web, cut.minWidth, cut.scale);
  stats.snapped = held.snapped;
  stats.pruned = held.pruned;
  if (!held.runs.length) {
    warnings.push(neverClose(cut.name));
    return done([]);
  }

  // The pattern's cells at zero width, and what each needs to be cut. The cells counted are the
  // ones inside the pattern — a partial cell the frame trims off is how every lattice ends at its
  // border, cut or not — unless there are hardly any (stripes: every cell reaches the frame).
  const islands = zone.map(faceOf).filter((f): f is Face => !!f).sort((a, b) => a.area - b.area);
  const homeArea = (box: Box): number => islands.find((i) => boxWithin(box, i.box))?.area ?? Infinity;
  const zoneArea = islands.reduce((s, i) => s + islandArea(i), 0);
  const inside = held.cells.filter((c) => !c.frame);
  // Each cell's widest disc, to a two-hundredth of its size: the radius only has to be right to
  // within what a web can tell apart, and once it is three struts and a floor wide, the cell cuts
  // at any zoom offered — no need to find the exact centre of a zone-wide background.
  const roomy = 3 * (cut.web + cut.minWidth);
  const poleIn = (c: Cell, box: Box) => poleOf(c.ring, Math.max(0.02, 0.005 * Math.min(box.maxX - box.minX, box.maxY - box.minY)), c.holes, roomy);
  const basis = (inside.length >= 4 ? inside : held.cells).map((c) => {
    const box = bboxOfPoints(c.ring);
    const background = c.area >= BACKGROUND_SHARE * homeArea(box);
    const pole = background ? null : poleIn(c, box);
    // What it needs to cut (`need`, by its widest disc), and — for the zoom a sentence names —
    // by the narrower of that and its mean half-width (twice its area over its outline: the
    // inradius of a compact cell, less for one that tapers): a fan or a crescent holds the
    // narrowest cut at its middle long before its points stop being hairlines the strip rule
    // trims away, and a zoom named from the middle would not cut.
    const outline = [c.ring, ...c.holes].reduce((s, r) => s + r.reduce((q, p, i) => q + Math.hypot(r[(i + 1) % r.length]![0] - p[0], r[(i + 1) % r.length]![1] - p[1]), 0), 0);
    const reach = pole ? Math.min(pole.radius, outline > 0 ? (2 * c.area) / outline : pole.radius) : 0;
    return {
      c, box, background, pole: pole?.at ?? null, radius: pole?.radius ?? 0,
      need: pole ? zoomNeeded(c, pole.radius, cut.web, cut.minWidth, cut.minArea) : Infinity,
      named: pole ? zoomNeeded(c, reach, cut.web, cut.minWidth, cut.minArea) : Infinity,
    };
  });
  stats.cells = basis.length;
  const current = cut.scale * 100;
  const basisArea = basis.reduce((s, b) => s + b.c.area, 0);
  // The share of the cells, by count and by area, that would cut at k × the zoom — and how much
  // of the zone they would open: k times fewer cells each way, each k² bigger less its struts.
  type Reading = { count: number; area: number; open: number };
  const estimate = (k: number, strict = false): Reading => {
    const ok = basis.filter((b) => (strict ? b.named : b.need) <= k);
    return {
      count: basis.length ? ok.length / basis.length : 0,
      area: basisArea > 0 ? ok.reduce((s, b) => s + b.c.area, 0) / basisArea : 0,
      open: zoneArea > 0 ? ok.reduce((s, b) => s + b.c.area * Math.max(0, 1 - cut.web / (2 * b.radius * k)) ** 2, 0) / zoneArea : 0,
    };
  };
  const reads = (e: Reading, slack = 0) => (e.count >= COVERAGE_MIN - slack || e.area >= AREA_MIN - slack) && e.open >= OPEN_MIN * (slack ? 0.5 : 1);
  const zoomFrom = (): number | null => ZOOMS.find((z) => z >= current * 1.1 && reads(estimate(z / (ZOOM_MARGIN * current), true))) ?? null;
  // Why a pattern does not cut, from what its cells lack: most too small is the zoom's fault;
  // most too big, or held by nothing, is the lines'. `empty` says a face was left as background:
  // too big a cell (zoom out), or a space whose lines went as cantilevers (no zoom helps).
  const refuse = (cutCells: number, empty?: 'big' | 'pruned'): LatticeResult => {
    if (empty) {
      warnings.push(empty === 'pruned' ? tooLoose(cut.name) : tooCoarse(cut.name));
      return done([]);
    }
    // A piece whose zone is under two periods of the pattern across (kikkō on a 20 mm coaster:
    // one hexagon and its clipped neighbours): the cells are too big for it, whatever the partial
    // ones round it say.
    if (cut.period && inside.length < 4 && zone.every((island) => { const f = faceOf(island); return !f || poleOf(f.outer, 0.1, f.holes, cut.period!).radius < cut.period!; })) {
      warnings.push(tooCoarse(cut.name));
      return done([]);
    }
    const coarse = basis.filter((b) => b.background).length;
    const small = basis.filter((b) => !b.background && b.need > 1).length;
    const other = basis.length - cutCells - coarse - small;
    if (small >= coarse && small >= other && small > 0) {
      const zoom = zoomFrom();
      warnings.push(tooFine(cut.name, zoom));
      return done([], zoom);
    }
    const loose = other > coarse || held.prunedLength > 0.5 * held.totalLength;
    warnings.push(loose ? tooLoose(cut.name) : tooCoarse(cut.name));
    return done([]);
  };
  const guess = estimate(1);
  if (!reads(guess, HOPELESS)) {
    stats.coverage = guess.count;
    stats.areaCoverage = guess.area;
    return refuse(0);
  }

  const faces = host.subtract(zone, strutsOf(held.runs, cut.web)).map(faceOf).filter((f): f is Face => !!f && f.area > 1e-6);
  if (!faces.length) return refuse(0);

  // Rules 3 and 5. A face's island is the smallest whose box holds it — never a point test: the
  // background face's outer ring IS its island's edge, and a point on an edge is a coin toss.
  // A face is too big for a cell when it is a quarter of its island, or — on a band or a ring
  // round a panel, whose island is big — when it is a WINDOW: mostly bounded by the zone's edge
  // and far roomier than the pattern's own cells (`windowOf`).
  const reserves: Pt[] = [...cut.region, ...cut.solids].flatMap((island) => island.filter((r) => r.length >= 3).map((r) => r[0]!));
  const zoneEdge = new EdgeIndex(zone);
  const radii = basis.filter((b) => !b.background && b.radius > 0).map((b) => b.radius).sort((a, b) => a - b);
  const areas = basis.filter((b) => !b.background).map((b) => b.c.area).sort((a, b) => a - b);
  const cellArea = areas.length ? areas[areas.length >> 1]! : Infinity;
  const isWindow = windowOf(radii.length ? radii[radii.length >> 1]! : 0, cellArea, cut.web, zoneEdge);
  const isMoat = moatOf(zone, cellArea);
  const candidates: Face[] = [];
  let backgroundArea = 0;
  const backgrounds: Face[] = [];
  const holdings: Face[] = [];
  for (const f of faces) {
    const big = f.area >= BACKGROUND_SHARE * homeArea(f.box) || isWindow(f) || isMoat(f);
    if (!f.holes.length) {
      if (big) {
        stats.solid++;
        backgroundArea += f.area;
        backgrounds.push(f);
      } else candidates.push(f);
      continue;
    }
    const swallows = f.holes.some((h) => { const hb = bboxOfPoints(h); return reserves.some((p) => inBox(p, hb) && pointInRing(p, h)); });
    const floating = f.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    if (swallows || big || floating > CRUMB_SHARE * f.area) {
      stats.solid++;
      holdings.push(f);
      continue;
    }
    f.whole = true;
    candidates.push(f);
  }

  // Rule 2.
  const cellSize = Math.max(2, Math.sqrt(candidates.reduce((s, f) => s + (f.box.maxX - f.box.minX) * (f.box.maxY - f.box.minY), 0) / Math.max(1, candidates.length)));
  const sized = floors(candidates, cut.minWidth, cut.minArea, host, cellSize);
  let kept = sized.kept;
  stats.tooSmall = sized.small.length;

  // A face cut whole takes everything inside it: the faces in its holes are already offcut.
  const whole = kept.filter((f) => f.whole);
  if (whole.length) {
    const grid = new FaceGrid(whole, cellSize);
    kept = kept.filter((f) => !grid.holding(f.outer[0]!).some((w) => w !== f && boxWithin(f.box, w.box)));
  }
  stats.loose = kept.filter((f) => f.whole).length;

  // No hairlines (`stripHairlines`): no part of a face narrower than the narrowest cut runs on
  // for more than twice that — a crack where two struts' sides meet, a face tapering to a sliver
  // in a corner of the zone. Rule 2 holds again for what a strip parted.
  // What each rule left as wood, by area, for the sentence when too little is cut.
  const areaOf = (list: Face[]) => list.reduce((s, f) => s + islandArea(f), 0);
  let lostSmall = areaOf(sized.small);
  const stripped = stripHairlines(kept, sized.eroded, cut.minWidth, host);
  stats.trimmed = stripped.strips;
  if (stripped.strips) {
    const again = floors(stripped.pieces, cut.minWidth, cut.minArea, host, cellSize);
    lostSmall += areaOf(kept) - areaOf(stripped.untouched) - areaOf(again.kept);
    kept = [...stripped.untouched, ...again.kept];
    stats.tooSmall += again.small.length;
  }

  // Rule 4's remainder: of faces closer than the web to each other, all but the biggest stay
  // material — never a bite out of both.
  const drop = new Set<Face>();
  for (const group of tightGroups(kept, cut.web, host, cellSize)) {
    const biggest = group.reduce((m, f) => (f.area > m.area ? f : m));
    for (const f of group) if (f !== biggest) drop.add(f);
  }
  stats.tight = drop.size;
  if (drop.size) kept = kept.filter((f) => !drop.has(f));

  // …and between a face and itself (`neckedFaces`): a face that wraps round wood hanging on a
  // neck under the web stays wood, and the wood is held by it.
  const necked = neckedFaces(kept, cut.web, host);
  stats.necks = necked.size;
  if (necked.size) kept = kept.filter((f) => !necked.has(f));
  const lostLoose = areaOf([...drop, ...necked]);

  // Rule 6, measured: a cell is cut when a kept face lies in it (a face is its cell less the
  // struts, so any of its points off the zone's edge is inside the cell), or it lies inside a face
  // cut whole.
  const cutBasis = new Set<number>();
  const size = Math.max(2, Math.sqrt(basis.reduce((s, b) => s + (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY), 0) / Math.max(1, basis.length)));
  const buckets = new Map<string, number[]>();
  basis.forEach((b, i) => {
    for (let x = Math.floor(b.box.minX / size); x <= Math.floor(b.box.maxX / size); x++) {
      for (let y = Math.floor(b.box.minY / size); y <= Math.floor(b.box.maxY / size); y++) {
        const k = `${x},${y}`;
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
      }
    }
  });
  const edge = new EdgeIndex(zone);
  for (const f of kept) {
    const step = Math.max(1, Math.floor(f.outer.length / 8));
    // Its middle first, when that is inside it: a strip of a stripe pattern, cut from frame to
    // frame, has every corner on the zone's edge.
    let mx = 0;
    let my = 0;
    for (const q of f.outer) { mx += q[0]; my += q[1]; }
    const mid: Pt = [mx / f.outer.length, my / f.outer.length];
    const probes = pointInRing(mid, f.outer) ? [mid] : [];
    for (let k = 0; k < f.outer.length; k += step) probes.push(f.outer[k]!);
    for (const p of probes) {
      if (edge.distance(p, 1e-3) < 1e-3) continue;
      const hit = (buckets.get(`${Math.floor(p[0] / size)},${Math.floor(p[1] / size)}`) ?? []).find((i) => {
        const c = basis[i]!.c;
        return inBox(p, basis[i]!.box) && pointInRing(p, c.ring) && !c.holes.some((h) => pointInRing(p, h));
      });
      if (hit !== undefined) {
        cutBasis.add(hit);
        break;
      }
    }
  }
  for (const w of kept.filter((f) => f.whole)) basis.forEach((b, i) => {
    const at = b.pole ?? poleIn(b.c, b.box).at;
    if (inBox(at, w.box) && pointInRing(at, w.outer)) cutBasis.add(i);
  });
  stats.coverage = basis.length ? cutBasis.size / basis.length : kept.length ? 1 : 0;
  stats.areaCoverage = basisArea > 0 ? basis.reduce((s, b, i) => s + (cutBasis.has(i) ? b.c.area : 0), 0) / basisArea : stats.coverage;
  const open = kept.reduce((s, f) => s + islandArea(f), 0);
  // A face left whole for what it holds is solid wood too — unless what it holds is cut: the
  // background of motifs that never touch, their insides cut as holes, reads as the motifs.
  const heldSolid = holdings
    .filter((h) => !kept.some((k) => inBox(k.outer[0]!, h.box) && h.holes.some((r) => pointInRing(k.outer[0]!, r))))
    .reduce((s, h) => s + islandArea(h), 0);
  const solid = backgroundArea + heldSolid <= BACKGROUND_MAX * zoneArea;
  // Rule 6, by what could open: the zone less its struts, less the background of motifs that
  // never touch (cut round them, it would drop them). Counting cells misses a band or a ring round
  // a panel, where nearly every cell is a partial one the frame trims; the area left as wood does
  // not — and it is where the flecks a strip or a floor left behind show.
  const openable = areaOf(faces) - (areaOf(holdings) - heldSolid);
  stats.open = openable > 0 ? Math.min(1, open / openable) : 0;
  const opens = stats.open >= OPEN_SHARE_MIN;
  const shares = reads({ count: stats.coverage, area: stats.areaCoverage, open: open / Math.max(1e-9, zoneArea) });
  // Rule 6, where it shows: no patch of plain wood much wider than the pattern's own cells. A band
  // where the lines crowd too close to cut (wood grain's middle), a dozen dots scattered on a
  // coaster, read as "a plain piece with a few holes" whatever the shares say.
  const cutCells = basis.filter((_, i) => cutBasis.has(i));
  const cutArea = cutCells.reduce((s, b) => s + b.c.area, 0);
  const typical = cutArea > 0 ? cutCells.reduce((s, b) => s + b.c.area * b.radius, 0) / cutArea : 0;
  const reach = Math.max(PATCH * typical, 2 * (cut.web + cut.minWidth));
  const patch = kept.length && shares && solid && opens ? solidPatch(zone, kept, reach) : null;
  if (kept.length && shares && solid && opens && !patch) {
    stats.faces = kept.length;
    const openings = kept.map((f) => [signedArea(f.outer) < 0 ? [...f.outer].reverse() : f.outer]);
    // Shapes that touch or ring wood (rule 0's network), cut as the lattice of their outlines: what
    // that cuts is mostly the gaps between them — the negative of what Engrave shows. Cut, and said
    // (Ian, 2026-09-29).
    if (seen.ink?.length && inInk(openings, seen.ink, host) < GAPS_SHARE) warnings.push(cutAsGaps(cut.name));
    return done(openings);
  }
  if (kept.length && shares && solid && !opens) {
    // Most of what could open stayed wood: to floors and hairlines (the cells are too fine for
    // this web), to windows round a panel (too large), or to faces that would hang wood (the
    // lines do not hold together here).
    const lostBig = backgroundArea + heldSolid;
    if (lostSmall >= lostBig && lostSmall >= lostLoose) {
      const zoom = zoomFrom();
      warnings.push(tooFine(cut.name, zoom));
      return done([], zoom);
    }
    warnings.push(lostBig >= lostLoose ? tooCoarse(cut.name) : tooLoose(cut.name));
    return done([]);
  }
  if (patch) {
    const under = basis.find((b) => inBox(patch, b.box) && pointInRing(patch, b.c.ring) && !b.c.holes.some((h) => pointInRing(patch, h)));
    if (under && under.need > 1) {
      const zoom = zoomFrom();
      warnings.push(tooFine(cut.name, zoom));
      return done([], zoom);
    }
    warnings.push(tooSparse(cut.name));
    return done([]);
  }
  if (!solid) {
    // Solid because it holds loose lines, or because the lines there went as cantilevers: no zoom
    // helps. Solid because the cells are that big: zoom out.
    const lost = held.prunedAt.some((p) => backgrounds.some((f) => inBox(p, f.box) && pointInRing(p, f.outer)));
    return refuse(cutBasis.size, heldSolid > backgroundArea || lost || held.prunedLength > 0.5 * held.totalLength ? 'pruned' : 'big');
  }
  // Cells its lines close, its faces lost: to the floors and the hairline strips — too fine for
  // this web, whatever the cells promised at zero width.
  if (lostSmall > 0 && lostSmall >= backgroundArea + areaOf(holdings) && lostSmall >= lostLoose && held.prunedLength <= 0.5 * held.totalLength) {
    const zoom = zoomFrom();
    warnings.push(tooFine(cut.name, zoom));
    return done([], zoom);
  }
  return refuse(cutBasis.size);
}
