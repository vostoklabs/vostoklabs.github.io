// Worker-side 2D CSG on manifold-3d's CrossSection. Nothing here touches the DOM.
//
// The bridge between our ring contract (islands of rings, any winding) and manifold's
// (outer CCW positive, holes CW negative, one flat list) lives in `toCS` / `fromCS`, and
// nothing else in the app needs to know manifold's conventions.
import type { CutRing } from '@vostok/export';
import { csOf, ringsOf } from '@vostok/manifold';
import { signedArea, circleRing, simplifyRing } from './rings';
import type { Keyring } from './types';
import type { KeychainParams } from './types';

/** Anything manifold hands out that has to be freed — the WASM heap only grows. */
export type Keep = <M extends { delete(): void }>(m: M) => M;

export function withScope<T>(fn: (keep: Keep) => T): T {
  const created: { delete(): void }[] = [];
  const keep: Keep = (m) => {
    created.push(m);
    return m;
  };
  try {
    return fn(keep);
  } finally {
    for (const m of created) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

/*
  manifold-3d 3.5.1's JS glue leaks every ring that passes through it, both ways: 16 bytes a
  vertex on every boolean in this file — most of what the Laser Studio worker's heap grew by on
  every rebuild of one design (0.16 MB a name tag, 0.87 MB a pattern cut out of a coaster).
  `csOf` and `ringsOf` build and read CrossSections without it. They live in @vostok/manifold
  now, where the 3D generators get them too, and are re-exported here for this package's users.
*/
export { csOf, ringsOf };

/** Islands → one CrossSection. The largest ring of an island is its outer, made CCW; the
 *  rest are holes, made CW; the Positive rule then fills exactly the material. */
export function toCS(wasm: any, shapes: CutRing[][], keep: Keep): any {
  const rings: number[][][] = [];
  for (const island of shapes) {
    const live = island.filter((r) => r.length >= 3);
    if (live.length === 0) continue;
    const areas = live.map(signedArea);
    let outer = 0;
    for (let i = 1; i < live.length; i++) if (Math.abs(areas[i]!) > Math.abs(areas[outer]!)) outer = i;
    live.forEach((r, i) => {
      const ccw = areas[i]! > 0;
      const wantCcw = i === outer;
      rings.push(ccw === wantCcw ? (r as number[][]) : ([...r].reverse() as number[][]));
    });
  }
  if (rings.length === 0) return keep(wasm.CrossSection.circle(0.01, 3));
  return keep(csOf(wasm, rings));
}

/** CrossSection → islands, one per connected component, counters kept as holes. */
export function fromCS(cs: any, keep: Keep): CutRing[][] {
  if (cs.numContour() > DECOMPOSE_LIMIT) return islandsOf(ringsOf(cs));
  const parts = (cs.decompose() as any[]).map((c) => keep(c));
  const areas: number[] = parts.map((c) => c.area());
  /*
    A hole whose corners all lie on its island's outline comes back from `decompose()` as a part
    of its own: the hole alone, NEGATIVE area, and the island beside it as if solid there. Laser
    Studio's tall card less uroko's scales decomposes into seven parts, five of them a lone
    triangle at −52.4 mm² — each triangle's three corners on the band's outline, which visits the
    apex twice — and dropping them as slivers cut none of the five. So when any part is a hole,
    every ring is regrouped as past the limit below, and the hole goes back to the island that
    holds it.
  */
  if (areas.some((a) => a < -0.01)) return islandsOf(parts.flatMap((c) => ringsOf(c)));
  return parts.filter((_, i) => areas[i]! > 0.01).map((c) => ringsOf(c));
}

/*
  Past a few thousand islands, `decompose()` TRAPS manifold's WASM. Measured on manifold-3d 3.5.1:
  4 000 separate squares decompose, 6 000 throw "table index is out of bounds" (a 300 mm asanoha
  lattice's 4 356 faces, "memory access out of bounds") — and the module is dead for every call
  after it, so one big pattern broke every build until the page was reloaded. One island with
  17 000 holes decomposes fine; it is the count of COMPONENTS. `toPolygons()` never traps, so past
  the limit the islands are grouped here instead, the way manifold winds them: each
  counter-clockwise ring an outer, each clockwise ring a hole of the smallest outer holding it.
  Under the limit nothing changes.
*/
const DECOMPOSE_LIMIT = 2000;

function islandsOf(rings: CutRing[]): CutRing[][] {
  type Outer = { ring: CutRing; area: number; minX: number; minY: number; maxX: number; maxY: number; holes: CutRing[] };
  const outers: Outer[] = [];
  const holes: CutRing[] = [];
  for (const r of rings) {
    const a = signedArea(r);
    if (a > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of r) {
        if (x! < minX) minX = x!;
        if (x! > maxX) maxX = x!;
        if (y! < minY) minY = y!;
        if (y! > maxY) maxY = y!;
      }
      outers.push({ ring: r, area: a, minX, minY, maxX, maxY, holes: [] });
    } else if (a < 0) holes.push(r);
  }
  if (holes.length) {
    // A grid of the outers' boxes, so each hole meets only the outers near it.
    const size = Math.max(1, Math.sqrt(outers.reduce((s, o) => s + (o.maxX - o.minX) * (o.maxY - o.minY), 0) / Math.max(1, outers.length)));
    const cells = new Map<string, Outer[]>();
    for (const o of outers) {
      for (let x = Math.floor(o.minX / size); x <= Math.floor(o.maxX / size); x++) {
        for (let y = Math.floor(o.minY / size); y <= Math.floor(o.maxY / size); y++) {
          const k = `${x},${y}`;
          const bucket = cells.get(k);
          if (bucket) bucket.push(o);
          else cells.set(k, [o]);
        }
      }
    }
    for (const h of holes) {
      const [px, py] = h[0]!;
      let owner: Outer | null = null;
      for (const o of cells.get(`${Math.floor(px! / size)},${Math.floor(py! / size)}`) ?? []) {
        if (px! < o.minX || px! > o.maxX || py! < o.minY || py! > o.maxY || (owner && o.area >= owner.area)) continue;
        if (holdsRing(o.ring, h)) owner = o;
      }
      owner?.holes.push(h);
    }
  }
  return outers
    .filter((o) => o.area - o.holes.reduce((s, h) => s - signedArea(h), 0) > 0.01)
    .map((o) => [o.ring, ...o.holes]);
}

/** Does `outer` enclose `hole`? Rings out of one boolean never cross, but they can TOUCH — a hole
 *  meets its outline or another hole at a corner, and each of uroko's triangles above has all
 *  three on its outline. So the first point of the hole that is not ON the outer decides: a
 *  corner, else the middle of an edge (a hole can share corners with its outline, never an edge —
 *  the wood between would have no width). A ray test from a shared corner can go either way: it
 *  dropped a hole whose ring manifold started on the corner of a square it touched. */
function holdsRing(outer: CutRing, hole: CutRing): boolean {
  for (const mid of [false, true]) {
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i]!;
      const b = mid ? hole[(i + 1) % hole.length]! : a;
      const side = sideOf(outer, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (side !== 0) return side > 0;
    }
  }
  return false;
}

/** How near a ring a point counts as on it, mm: manifold snaps vertices to a grid of about 1e-8,
 *  so a corner two rings share is on both. */
const ON_RING = 1e-6;

/** 1 inside the ring (even-odd), −1 outside, 0 on it. */
function sideOf(ring: CutRing, x: number, y: number): number {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const dx = xj - xi;
    const dy = yj - yi;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / l2)) : 0;
    const ex = xi + t * dx - x;
    const ey = yi + t * dy - y;
    if (ex * ex + ey * ey <= ON_RING * ON_RING) return 0;
    if (yi > y !== yj > y && x < (dx * (y - yi)) / dy + xi) inside = !inside;
  }
  return inside ? 1 : -1;
}

export function offsetShapes(wasm: any, shapes: CutRing[][], delta: number): CutRing[][] {
  return withScope((keep) => {
    const cs = toCS(wasm, shapes, keep);
    // Round joins with enough circular segments that a keyring halo's curve doesn't facet.
    /*
      No `circularSegments` argument. Manifold's default (0) means "ask the quality settings,
      which know the radius" — `setMinCircularEdgeLength` / `setMinCircularAngle`, set once when
      the worker starts. A hardcoded 32 was overriding that with a fixed count, which is fine on
      a 3 mm fillet and visibly polygonal on a 20 mm one: the same 32 chords have to cover a
      circumference six times longer. `simplify` afterwards because the close operation offsets
      twice in a row, and Manifold's own docs ask for it between chained offsets. Both kept: the
      offset is a CrossSection of its own, and one never freed stays in the heap for good.
    */
    const out = keep(keep(cs.offset(delta, 'Round', 2.0)).simplify(1e-3));
    return fromCS(out, keep);
  });
}

export function unionShapes(wasm: any, shapes: CutRing[][]): CutRing[][] {
  return withScope((keep) => fromCS(toCS(wasm, shapes, keep), keep));
}

export function subtractShapes(wasm: any, a: CutRing[][], b: CutRing[][]): CutRing[][] {
  return withScope((keep) => {
    const out = keep(toCS(wasm, a, keep).subtract(toCS(wasm, b, keep)));
    return fromCS(out, keep);
  });
}

/** Keep only the outer loops, so a plate hugging two words does not trap a hole between them. */
function fillHoles(wasm: any, cs: any, keep: Keep): any {
  const polys = ringsOf(cs);
  const outers = polys.filter((p) => signedArea(p) > 0);
  if (outers.length === 0 || outers.length === polys.length) return cs;
  return keep(csOf(wasm, outers));
}

function bbox(contours: number[][][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of contours) {
    for (const p of poly) {
      const x = p[0]!;
      const y = p[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * The flat keychain: a plate around the letters with a keyring lug, and the letters themselves.
 *
 * A slimmed-down relative of name-keychain's `buildProfiles` — same operations (offset,
 * hull, union, subtract), same conventions (round joins, holes filled, lug fused by a hull
 * tab). Intended to be merged with that builder so the two cannot drift; until then this is
 * deliberately the minimal shape.
 */
export function buildKeychainProfile(wasm: any, textContours: number[][][], p: KeychainParams) {
  return withScope((keep) => {
    const { CrossSection } = wasm;
    const hasText = textContours.some((c) => c.length >= 3);
    const glyphs = hasText ? keep(csOf(wasm, textContours, 'NonZero')) : keep(CrossSection.circle(0.01, 3));
    const box = bbox(textContours);
    const w = Math.max(box.maxX - box.minX, 0.1);
    const h = Math.max(box.maxY - box.minY, 0.1);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;

    const margin = p.outlineWidth;
    const lugOuter = p.holeDia / 2 + p.ringThickness;
    const lugPre = Math.max(lugOuter - margin, 0.6);

    // Plate source: the letters (fused by a strip so a word is one piece) or a box.
    let src: any;
    if (p.plateShape === 'rectangle') {
      src = keep(keep(CrossSection.square([w, h], true)).translate([cx, cy]));
    } else {
      const strip = keep(keep(CrossSection.square([w, Math.max(h * 0.35, 0.5)], true)).translate([cx, cy]));
      src = keep(glyphs.add(strip));
    }

    let hole: any = null;
    if (p.holeSide !== 'none') {
      const left = p.holeSide === 'left';
      const hx = left ? box.minX - (lugOuter + 1.5) : cx;
      const hy = left ? cy : box.maxY + lugOuter + 1.5;
      const neck = Math.max(lugOuter * 2.2, 8);
      const ax = left ? hx + neck : hx;
      const ay = left ? hy : hy - neck;
      const lug = keep(keep(CrossSection.circle(lugPre, 32)).translate([hx, hy]));
      const anchor = keep(keep(CrossSection.circle(Math.min(lugPre * 0.85, 2), 16)).translate([ax, ay]));
      const tab = keep(CrossSection.hull([lug, anchor]));
      src = keep(src.add(tab));
      hole = keep(keep(CrossSection.circle(p.holeDia / 2, 48)).translate([hx, hy]));
    }

    const smooth = Math.max(0, p.smoothing);
    let plate = keep(src.offset(margin + smooth, 'Round', 2.0, 24));
    if (smooth > 0.05) plate = keep(plate.offset(-smooth, 'Round', 2.0, 24));
    plate = fillHoles(wasm, plate, keep);
    if (hole) plate = keep(plate.subtract(hole));

    const text = hole ? keep(glyphs.subtract(hole)) : glyphs;
    return { plate: fromCS(plate, keep), text: hasText ? fromCS(text, keep) : [] };
  });
}

export function intersectShapes(wasm: any, a: CutRing[][], b: CutRing[][]): CutRing[][] {
  return withScope((keep) => {
    const out = keep(toCS(wasm, a, keep).intersect(toCS(wasm, b, keep)));
    return fromCS(out, keep);
  });
}

/** A close (grow then shrink): every concavity narrower than 2 × r is filled, everything else
 *  comes back as it was. Manifold asks for a simplify between chained offsets; `offsetShapes`
 *  already does one per call. */
function closeShapes(wasm: any, shapes: CutRing[][], r: number): CutRing[][] {
  return offsetShapes(wasm, offsetShapes(wasm, shapes, r), -r);
}

/** A ring's area and perimeter — enough to tell a fillet from a tessellation sliver. */
function ringMetrics(ring: CutRing): { area: number; perimeter: number } {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    perimeter += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  }
  return { area: Math.abs(signedArea(ring)), perimeter };
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function ringBox(ring: CutRing): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0]! < minX) minX = p[0]!;
    if (p[0]! > maxX) maxX = p[0]!;
    if (p[1]! < minY) minY = p[1]!;
    if (p[1]! > maxY) maxY = p[1]!;
  }
  return { minX, minY, maxX, maxY };
}

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.maxX + pad >= b.minX && b.maxX + pad >= a.minX && a.maxY + pad >= b.minY && b.maxY + pad >= a.minY;

const grown = (b: Rect, by: number): Rect => ({ minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by });

/** An island's rings split into its outer (the largest) and its holes. `toPolygons` hands the
 *  rings back in no particular order, so the outer is found by area, exactly as `toCS` does — a
 *  hole treated as the outer would leave the piece's real edge looking like a hole to drop. */
function splitRings(island: CutRing[]): { outer: CutRing; holes: CutRing[] } {
  let at = 0;
  for (let i = 1; i < island.length; i++) if (Math.abs(signedArea(island[i]!)) > Math.abs(signedArea(island[at]!))) at = i;
  return { outer: island[at] ?? [], holes: island.filter((_, i) => i !== at) };
}

/**
 * Drop any hole the weld TRAPPED — a pocket of air the lug sealed off that the design never had.
 *
 * Welding a lug across the mouth of a design's notch (a bone's V at the end of a lobe) leaves the
 * rest of that notch enclosed: a hole in the middle of the part that nobody drew, that nothing
 * can pass through, and that drops a loose offcut on the bed.
 *
 * Two things have to be true before a hole is dropped, because dropping a real one — a frame's
 * window, an O's counter — would weld the design shut, which is the very bug this file is fixing.
 * It must overlap NO hole the design drew, and it must lie against the lug and its neck (`near`),
 * which is the only place this function can have made one.
 */
function dropTrappedHoles(result: CutRing[][], design: CutRing[][], near: Rect): CutRing[][] {
  if (!result.some((island) => island.length > 1)) return result;
  const designHoles = design.flatMap((island) => splitRings(island).holes).map(ringBox);
  return result.map((island) => {
    const { outer, holes } = splitRings(island);
    return [outer, ...holes.filter((h) => {
      const b = ringBox(h);
      const trapped = !designHoles.some((d) => overlaps(d, b)) && overlaps(near, b);
      return !trapped;
    })];
  });
}

/**
 * Bake a keyring into a shape: a lug welded on and filleted (outside), then the hole cut.
 * The placement is `holeCentre` from `keyring.ts`; this is the CSG half, synchronous so it
 * runs inside one worker call alongside everything else the part needs.
 *
 * `neck` is the bar that reaches back to the body when the lug has floated clear of it. It is
 * passed in rather than built here because only the caller knows where the lug's anchor on the
 * body is — and it has to arrive SEPARATELY from `shapes`, because `shapes` is the design and
 * the fillet below is defined against it.
 */
export function applyKeyring(
  wasm: any,
  shapes: CutRing[][],
  centre: [number, number],
  k: Keyring,
  opts: { neck?: CutRing[][] } = {},
): CutRing[][] {
  const hole = [[circleRing(centre[0], centre[1], k.dia / 2, 48)]];
  let body = shapes;
  if (k.mode === 'outside') {
    const lug = [[circleRing(centre[0], centre[1], k.dia / 2 + k.ring, 64)]];
    const attach = [...lug, ...(opts.neck ?? [])];
    body = unionShapes(wasm, [...shapes, ...attach]);
    /*
      The fillet is the material the close adds BECAUSE THE LUG IS THERE — never what it would
      have done to the design on its own.

      A close (grow, shrink) rounds the notch where the lug and its neck meet the outline, which
      is the whole point. But a close fills EVERY concavity narrower than twice the ring, and the
      design's own concavities are not the lug's business: a bone's two lobes meet in a cusp, a
      shaft meets a lobe in a notch, an "N" has two. Closing the plate welds those shut, and
      that is the random shape artifact — a disc and a straight-edged fill bridging the
      notch between a pet tag's lobes whenever the loop was dragged near them.

      Clipping the close to a disc around the lug (what this used to do) does not help: the disc
      is dia/2 + 3·ring across — 11.5 mm on the shipped pet tag — so the notch the loop was
      dragged next to was inside it every time.

      So: close the design WITH the lug, close the design WITHOUT it, and keep only the
      difference. A concavity the design already had is filled in both and cancels; the junction
      the lug just made exists in one only. Nothing the design drew can change, wherever the loop
      lands.

      It is done TWICE, at two radii, because the weld has two jobs.

      At `ring` it ROUNDS: the notch where the lug or its neck meets the outline becomes a flare,
      and the tab reads as grown on rather than glued on.

      At half the minimum web it DEBURRS: wherever the lug has narrowed the design's own air to
      less than a millimetre — a lug that grazes the next lobe, a neck that pinches the mouth of a
      notch down to a hair — that air closes. A 0.3 mm slit is not a feature; it is a line the
      laser burns through and the customer sees as a scratch. It has to be a second pass and not
      just a wider first one: at `ring` the close would ALSO bridge anything within 2·ring, which
      is how a 3 mm slot beside the loop lost its mouth.
    */
    const weldAt = (r: number): CutRing[][] => {
      const added = subtractShapes(wasm, closeShapes(wasm, body, r), closeShapes(wasm, shapes, r));
      // The two closes are separate offset round trips, so their outlines can disagree by a
      // tessellation hair along edges neither of them filled. The offsets simplify at 1e-3, so a
      // hair is about that thick; the deburr pass's own answer — the sliver of air it just
      // closed — is also long and thin, 0.01 mm of mean thickness over 50 mm of wedge. So the
      // threshold sits just above the hair and nowhere near the sliver. A hair that slips through
      // costs nothing anyway: it is unioned back onto the edge it came from and `simplifyRing`
      // takes it off again.
      return added.filter((island) => {
        const m = ringMetrics(splitRings(island).outer);
        return m.area > 0.002 && m.perimeter > 0 && (2 * m.area) / m.perimeter > 0.002;
      });
    };
    const DEBURR = 0.5;
    // Where a trapped pocket can be: against the lug and its neck, and no further than the fillet
    // could have reached.
    const near = grown(attach.map((isl) => ringBox(isl[0] ?? [])).reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    })), 2 * k.ring);
    /*
      The lug lands where the customer dropped it, and sometimes that is in the mouth of one of
      the design's own notches. Then the notch behind it is sealed, and a sealed notch is not a
      hole the part wants — it is an offcut that falls out on the bed. `dropTrappedHoles` fills
      those, and only those: a pocket against the lug that overlaps nothing the design drew.

      The alternative — refusing to seal, so the notch stays open past the lug — was tried and is
      worse: what is left is a 0.5 mm slit running out of the notch, which no laser can cut and
      which reads as a scratch across the part.
    */
    const welds = [...weldAt(k.ring), ...(k.ring > DEBURR ? weldAt(DEBURR) : [])];
    body = dropTrappedHoles(welds.length ? unionShapes(wasm, [...body, ...welds]) : body, shapes, near);
  }
  const out = subtractShapes(wasm, body, hole);
  /*
    0.01 mm, not the 0.05 this used to use. The tolerance is a chord error, so on a 12 mm
    fillet 0.05 mm let the simplifier merge segments until they turned ~10° each — it undid
    the tessellation the offset had just been asked for, and the plate came back visibly
    polygonal. Manifold's own `simplify` inside `offsetShapes` already drops the spurious
    slivers; what is left here is only to keep a ring from carrying duplicate points.
  */
  return out.map((isl) => isl.map((r) => simplifyRing(r, 0.01)).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6));
}
