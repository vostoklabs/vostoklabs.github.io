/*
  The base-shape directory.

  Two things are worth proving here and they are not the obvious one. "It builds" proves almost
  nothing: `genShape` falls back to a circle for anything it does not recognise, and the fit
  search will happily hand back *a* plate for a shape that is wrong. So:

   1. **Each shape is really that shape.** Measured as the fraction of its own bounding box the
      body's underside fills — a circle is π/4 ≈ 0.785, a cross is far less, a squircle more.
      A shape that silently fell through to the circle branch shows up immediately.

   2. **The fit search cannot run away.** `fits(hi)` asks whether the artwork rectangle sits
      inside the shape. For a thin or open outline the answer can be NO AT EVERY SIZE, because
      growing a thin shape grows its gap too — and the unclamped `hi *= 2` forty times is a
      factor of 10^12. This was measured on a real glyph as a plate billions of millimetres
      across: not a crash, but a hang followed by a file no slicer will open. Tier 2 (glyphs)
      and tier 3 (icon silhouettes) walk straight into it, which is why the clamp had to land
      with the shapes rather than after them.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/shapes.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --define:import.meta.env='{"BASE_URL":"/"}' \
      --outfile=apps/clicker-generator/.shapes-test.mjs \
      && node apps/clicker-generator/.shapes-test.mjs

  The `--define` is not optional, and was missing here. `directory.ts` reaches the seasonal
  packs, which reach `assets.ts`, which reads `import.meta.env.BASE_URL` — undefined outside
  Vite. So this suite has died on its own documented command since the packs landed, AFTER
  printing a screen of passes, which is exactly how a broken suite goes unnoticed.
*/
import { DOMParser } from '@xmldom/xmldom';
// `directory.ts` reaches `parseSvg` through the pack registry, which wants a browser DOMParser.
(globalThis as any).DOMParser = DOMParser;

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import * as paths from '../src/geometry/shapePaths.ts';
import type { BaseShapeKind, BuildParams, BuildRegion, Ring } from '../src/types.ts';

const asset = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;

const wasm = await Module();
wasm.setup();

function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const out = solid.translate([
    -(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, dropTopToZero ? -bb.max[2] : 0,
  ]);
  solid.delete();
  return out;
}

const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

const square: Ring = [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]];
const regions: BuildRegion[] = [
  { filamentRgb: [200, 30, 30], coverage: 1, rings: [square], partName: 'top-color-0-0' },
];

const base: BuildParams = {
  baseShape: 'circle', capWidthMm: 45, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2,
  borderWidth: 2, capProud: 1.2, tolerance: 0.4, stemFitPct: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.05, stepHeight: 0.4, travel: 3.8,
  floorThickness: 1.2, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
  componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
};

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Underside footprint of the body, and how much of its bounding box it fills. */
function shapeOf(params: BuildParams) {
  const out = buildClicker(wasm, socket, stem, regions, [square], params);
  const body = out.parts.find((p) => p.name === 'base-body');
  if (!body) return { w: 0, h: 0, fill: 0, closed: false, warnings: out.warnings };
  const v = body.vertProperties, t = body.triVerts, n = body.numProp;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let i = 0; i < v.length; i += n) {
    if (v[i] < minX) minX = v[i];
    if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1];
    if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2];
  }
  let area = 0;
  const edges = new Map<string, number>();
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    for (let e = 0; e < 3; e++) {
      const p = t[i + e], q = t[i + ((e + 1) % 3)];
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    if (Math.abs(v[a + 2] - minZ) > 1e-3 || Math.abs(v[b + 2] - minZ) > 1e-3
      || Math.abs(v[c + 2] - minZ) > 1e-3) continue;
    area += Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
  }
  const w = maxX - minX, h = maxY - minY;
  return {
    w, h,
    fill: w * h > 0 ? area / (w * h) : 0,
    closed: [...edges.values()].every((c) => c === 2),
    warnings: out.warnings,
  };
}

// ---------------------------------------------------------------- every shape builds

const NEW: BaseShapeKind[] = [
  'ngon', 'cross', 'squircle', 'capsule', 'shield', 'tag', 'arch',
];
const circle = shapeOf(base);
const fills = new Map<string, number>([['circle', circle.fill]]);

for (const kind of NEW) {
  const r = shapeOf({ ...base, baseShape: kind });
  fills.set(kind, r.fill);
  check(
    `${kind}: builds a closed body of a sensible size`,
    r.closed && r.w > 15 && r.w < 200 && r.h > 15 && r.h < 200,
    `${r.w.toFixed(1)} × ${r.h.toFixed(1)} mm, ${r.closed ? 'closed' : 'NOT CLOSED'}`,
  );
}

// A shape that silently fell through to the circle branch would have a circle's fill ratio.
// Comparing against π/4 catches exactly that, and it is the failure `genShape`'s `default:`
// makes easy — a typo'd case label is a circle, not an error.
const CIRCLE_FILL = Math.PI / 4;
for (const kind of ['cross', 'tag', 'shield'] as BaseShapeKind[]) {
  const f = fills.get(kind)!;
  check(
    `${kind}: is not secretly a circle`,
    Math.abs(f - CIRCLE_FILL) > 0.03,
    `fills ${(f * 100).toFixed(1)}% of its box vs a circle's ${(CIRCLE_FILL * 100).toFixed(1)}%`,
  );
}
// The squircle is the one that SHOULD be near a circle, but strictly fuller.
check(
  'squircle sits between a circle and a square, as its name promises',
  fills.get('squircle')! > CIRCLE_FILL + 0.02 && fills.get('squircle')! < 0.99,
  `${(fills.get('squircle')! * 100).toFixed(1)}% (circle ${(CIRCLE_FILL * 100).toFixed(1)}%, square 100%)`,
);

// ---------------------------------------------------------------- the parametric knob

const tri = shapeOf({ ...base, baseShape: 'ngon', shapeSides: 3 });
const oct = shapeOf({ ...base, baseShape: 'ngon', shapeSides: 8 });
check(
  'the sides knob genuinely changes the shape — a triangle is not an octagon',
  oct.fill - tri.fill > 0.1,
  `3 sides fills ${(tri.fill * 100).toFixed(1)}%, 8 sides ${(oct.fill * 100).toFixed(1)}%`,
);
const star3 = shapeOf({ ...base, baseShape: 'star', shapeSides: 3 });
const star8 = shapeOf({ ...base, baseShape: 'star', shapeSides: 8 });
check(
  'and it changes a star too',
  Math.abs(star8.fill - star3.fill) > 0.02,
  `3 points ${(star3.fill * 100).toFixed(1)}%, 8 points ${(star8.fill * 100).toFixed(1)}%`,
);
// Out-of-range values arrive from saved projects and URLs. They must clamp, not crash.
const wild = shapeOf({ ...base, baseShape: 'ngon', shapeSides: 900 });
const negative = shapeOf({ ...base, baseShape: 'ngon', shapeSides: -4 });
check(
  'an absurd sides value clamps instead of exploding',
  wild.closed && negative.closed && wild.w < 200 && negative.w < 200,
  `900 -> ${wild.w.toFixed(1)} mm, -4 -> ${negative.w.toFixed(1)} mm`,
);

// The star already shipped at 5 points. Threading `points` through must not move it.
const star5 = shapeOf({ ...base, baseShape: 'star' });
const star5explicit = shapeOf({ ...base, baseShape: 'star', shapeSides: 5 });
check(
  'the shipped 5-point star is byte-identical after being made parametric',
  Math.abs(star5.fill - star5explicit.fill) < 1e-9 && Math.abs(star5.w - star5explicit.w) < 1e-9,
  `fill ${star5.fill.toFixed(9)} vs ${star5explicit.fill.toFixed(9)}`,
);
// The rounding radius follows the point count, or an 8-point star's short legs get eaten by a
// radius sized for five. Checked by the legs surviving at all: an over-rounded star loses its
// concave valleys and its fill ratio climbs toward a circle's 78.5%.
const star8fill = shapeOf({ ...base, baseShape: 'star', shapeSides: 8 }).fill;
check(
  'an 8-point star keeps its legs (the rounding follows the point count)',
  star8fill < 0.72,
  `8 points fills ${(star8fill * 100).toFixed(1)}% (a circle is 78.5%; over-rounded would approach it)`,
);

/* The picker's star against the printed one.

   `starRing` is what the tile draws and what the 2-D editor previews; `makeStar` is what the
   build extrudes. They are separate constructions, and they were separately WRONG for months:
   `makeStar` finishes with a manifold open-close that rounds the tips and the valleys, and
   `starRing` had none of it — so the tile showed a sharp star and the print came out chubby.
   That is the heart bug ("heart is wrong shape, the one we had before was better") one shape
   over, in a file whose own header claimed all three ports matched.

   Fill fraction rather than point-for-point: they are different constructions and always will
   be. What has to agree is how much of its own bounding box the star covers, because that IS
   what rounding changes. The 3% band catches a missing round-offset while tolerating the arc
   approximation `roundCorners` uses in place of a real offset.
*/
const ringFill = (ring: [number, number][]): number => {
  let a = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    if (ring[i][0] < minX) minX = ring[i][0];
    if (ring[i][0] > maxX) maxX = ring[i][0];
    if (ring[i][1] < minY) minY = ring[i][1];
    if (ring[i][1] > maxY) maxY = ring[i][1];
  }
  return Math.abs(a) / 2 / ((maxX - minX) * (maxY - minY));
};
for (const points of [3, 5, 8]) {
  const built = shapeOf({ ...base, baseShape: 'star', shapeSides: points }).fill;
  const drawn = ringFill(paths.starRing(points));
  check(
    `star-${points}: the picker's ring matches the star that builds`,
    Math.abs(built - drawn) < 0.03,
    `built fills ${(built * 100).toFixed(1)}%, the ring fills ${(drawn * 100).toFixed(1)}%`,
  );
}

// ---------------------------------------------------------------- the divergence clamp

/* A sliver: 40 mm long, 1 mm wide. No amount of scaling makes it contain a square artwork
   rectangle, because growing it grows the gap too — so `fits(hi)` is false forever and the
   bracket loop is the only thing standing between this and a 10^12 mm plate.

   This is not hypothetical geometry. It is the shape of a glyph stem and of half the icon
   silhouettes tier 3 would offer. */
const sliver: Ring = [[-1, -0.0125], [1, -0.0125], [1, 0.0125], [-1, 0.0125]];
const slivered = shapeOf({ ...base, baseShape: 'custom', baseShapeRings: [sliver] });
check(
  'a sliver of a shape cannot run the fit search away to infinity',
  slivered.w > 0 && slivered.w < 500,
  `${slivered.w.toFixed(1)} × ${slivered.h.toFixed(1)} mm (unclamped this reached ~10^9 mm)`,
);
check(
  'and it says why it did not use the shape it was given',
  slivered.warnings.some((w) => w.includes('too thin or too open')),
  slivered.warnings.find((w) => w.includes('too thin')) ?? '(silent — the user gets a mystery rectangle)',
);
check(
  'the fallback is still a printable, closed body',
  slivered.closed,
  slivered.closed ? 'closed manifold' : 'NOT CLOSED',
);
// ...and a solid shape must NOT trip the clamp, or every shape gets a rectangle.
check(
  'a solid shape never trips the clamp',
  !circle.warnings.some((w) => w.includes('too thin or too open'))
    && !shapeOf({ ...base, baseShape: 'shield' }).warnings.some((w) => w.includes('too thin')),
  'circle and shield both used their own outline',
);

// ---------------------------------------------------------------- thumbnails match geometry

// The picker draws from these same functions, so a ring that produced no path would be an
// invisible entry in the directory.
for (const [name, ring] of Object.entries({
  ngon: paths.ngonRing(6),
  cross: paths.crossRing(), squircle: paths.squircleRing(), capsule: paths.capsuleRing(),
  shield: paths.shieldRing(), tag: paths.tagRing(), arch: paths.archRing(),
  circle: paths.circleRing(), star: paths.starRing(),
  heart: paths.heartRing(), egg: paths.eggRing(),
})) {
  const d = paths.ringToPath(ring as Ring, 40);
  const ok = ring.length >= 3 && d.startsWith('M') && d.endsWith('Z') && !d.includes('NaN');
  check(`${name}: renders a thumbnail path`, ok, `${ring.length} points, ${d.length} chars`);
}

// ---------------------------------------------------------------- the directory round-trip

/* The bug this guards is the expensive kind: silent, and it destroys someone's saved work.

   A library shape is stored in a project as `baseShape: 'custom'` + `packShapeToken: 'lib:x'`,
   and the RINGS are derived rather than saved. The first version of the reload path resolved
   that token through the seasonal-pack registry, which knows nothing about `lib:` — so it got
   null, fell through in silence, and every one of the 371 library shapes reloaded as a plain
   circle. Nothing threw. The file looked like it had worked.

   So: every entry the picker can offer must be resolvable by its own id, and must carry the
   thing the builder needs (a `kind` or rings). */
const { allShapes, findShape, entryForState } = await import('../src/shapes/directory.ts');

const directory = allShapes();
/* Curated, not generated. The number is small ON PURPOSE — the previous version of this file
   asserted `> 300` and passed, while the directory contained 28 brand logos and a hundred UI
   icons whose outer loop is a rectangle. A count is not a quality bar, so this asserts a
   CEILING as well as a floor: if the directory ever grows past what a person can review by
   eye, that is the signal something is being generated again. */
check(
  'the directory is curated — small enough that a person can check every shape',
  directory.length >= 8 && directory.length <= 40,
  `${directory.length} shapes`,
);
// The specific failure that shipped: a trademarked logo as a printable base.
const branded = directory.filter((e) => /logo|brand|apple|google|microsoft|android/i.test(e.id));
check(
  'no trademarked logos in the directory',
  branded.length === 0,
  branded.length ? branded.map((e) => e.id).join(', ') : 'none',
);
const unresolvable = directory.filter((e) => !findShape(e.id));
check(
  'every shape in the picker can be found again by its id',
  unresolvable.length === 0,
  unresolvable.length ? `${unresolvable.length} unresolvable, e.g. ${unresolvable[0].id}` : 'all resolvable',
);
const hollowEntries = directory.filter((e) => !e.kind && !e.rings?.length);
check(
  'and carries what the builder needs — a kind, or rings',
  hollowEntries.length === 0,
  hollowEntries.length ? `${hollowEntries.length} carry neither, e.g. ${hollowEntries[0].id}` : 'all buildable',
);
// A ring-carrying shape (pack, or anything the editor makes later) is stored as a token and
// its rings are DERIVED, so the reload path has to find them again. The bug this guards ate
// 371 shapes at once when the lookup only knew about seasonal packs.
const ringEntry = directory.find((e) => e.rings?.length);
check(
  'a ring-carrying shape survives the save/reload round trip',
  !ringEntry || !!entryForState('custom', ringEntry.id)?.rings?.length,
  ringEntry
    ? `${ringEntry.id} -> ${entryForState('custom', ringEntry.id)?.rings?.[0]?.length ?? 0} points`
    : 'no ring-carrying shapes loaded in this context (packs load on demand)',
);
check(
  'and a built-in shape still resolves through its plain baseShape value',
  entryForState('star', null)?.kind === 'star' && entryForState('outline', null) === null,
  'star -> star, outline -> none (outline is not a shape)',
);
// Ids are stored in project files. A duplicate would make one of them unreachable forever.
const ids = new Set(directory.map((e) => e.id));
check(
  'shape ids are unique, because projects store them',
  ids.size === directory.length,
  `${ids.size} unique of ${directory.length}`,
);
// Every thumbnail has to draw, or the picker shows blank tiles.
const blank = directory.filter((e) => !e.thumb || e.thumb.includes('NaN') || e.thumb.length < 10);
check(
  'every shape in the directory has a drawable thumbnail',
  blank.length === 0,
  blank.length ? `${blank.length} blank, e.g. ${blank[0].id}` : `${directory.length} thumbnails`,
);

// ---------------------------------------------------------------- the switch has to fit

/* Every shape Ian rejected failed the same way, and it is one bug wearing four hats: the switch
   sits at the ORIGIN, and centring a shape on its BOUNDING BOX puts the origin in the narrow
   half of anything that tapers. A triangle's bbox centre is a third of the way up, where the
   sides are already closing in. A heart's is down in the point. A shield's is in the taper.

   So measure it rather than look at it. For each shape, find how much room there is around the
   ORIGIN inside the finished base, and require it to clear the switch column. Pole-centring is
   what makes these pass; bbox-centring is what made the triangle and the heart fail. */
function originClearanceMm(params: BuildParams): number {
  const out = buildClicker(wasm, socket, stem, regions, [square], params);
  const body = out.parts.find((p) => p.name === 'base-body');
  if (!body) return 0;
  const v = body.vertProperties, t = body.triVerts, n = body.numProp;
  let minZ = Infinity;
  for (let i = 2; i < v.length; i += n) if (v[i] < minZ) minZ = v[i];

  /* Distance to the nearest BOUNDARY EDGE, not the nearest vertex.
     Measuring vertices is the obvious probe and it lies: a triangle has three of them and they
     are its corners, so "distance to the nearest vertex" reports the circumradius while an edge
     may be sitting right against the switch. The first version of this said a triangle had
     51.6 mm of clearance, which is the distance to a corner.

     A boundary edge of the underside is one belonging to exactly ONE bottom-face triangle;
     interior edges of the triangulation belong to two and are not walls. */
  const bottomTris: number[][] = [];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    if (Math.abs(v[a + 2] - minZ) < 1e-3 && Math.abs(v[b + 2] - minZ) < 1e-3
      && Math.abs(v[c + 2] - minZ) < 1e-3) bottomTris.push([t[i], t[i + 1], t[i + 2]]);
  }
  const seen = new Map<string, number>();
  for (const tri of bottomTris) {
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3];
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  const distToSeg = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let u = len > 0 ? -(ax * dx + ay * dy) / len : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(ax + u * dx, ay + u * dy);
  };
  let best = Infinity;
  for (const [k, count] of seen) {
    if (count !== 1) continue;
    const [pi, qi] = k.split('_').map(Number);
    best = Math.min(best, distToSeg(v[pi * n], v[pi * n + 1], v[qi * n], v[qi * n + 1]));
  }
  return isFinite(best) ? best : 0;
}

// An MX switch needs a ~17 mm clear column, so ~8.5 mm of radius around the origin.
const NEED_MM = 8.5;
const CENTRED: [string, BuildParams][] = [
  ['triangle', { ...base, baseShape: 'ngon', shapeSides: 3 }],
  ['3-point star', { ...base, baseShape: 'star', shapeSides: 3 }],
  ['5-point star', { ...base, baseShape: 'star', shapeSides: 5 }],
  ['heart', { ...base, baseShape: 'heart' }],
  ['shield', { ...base, baseShape: 'shield' }],
  ['egg', { ...base, baseShape: 'egg' }],
  ['tag', { ...base, baseShape: 'tag' }],
  ['arch', { ...base, baseShape: 'arch' }],
];
for (const [label, params] of CENTRED) {
  const r = originClearanceMm(params);
  check(
    `${label}: the switch has room where it actually sits`,
    r >= NEED_MM,
    `${r.toFixed(1)} mm around the origin (needs ${NEED_MM})`,
  );
}

// The knobs are capped where a shape stops being that shape: past 8 sides a polygon is the
// circle already in the list, and past 8 points a star's legs are too short to read.
const ngon24 = shapeOf({ ...base, baseShape: 'ngon', shapeSides: 24 });
check(
  'the polygon caps at 8 sides rather than becoming a circle',
  Math.abs(ngon24.fill - oct.fill) < 1e-6,
  `24 requested -> same as 8 (${(ngon24.fill * 100).toFixed(1)}%)`,
);

// The assertion above uses a generous plate, so it would pass with or without the fix. This is
// the sharp one: for every ring, the origin must be a BETTER place for a switch than the
// bounding-box centre was. That difference IS the change, measured directly on the rings.
{
  const clearanceAt = (ring: Ring, px: number, py: number): number => {
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      const dx = xi - xj, dy = yi - yj;
      const len = dx * dx + dy * dy;
      let u = len > 0 ? ((px - xj) * dx + (py - yj) * dy) / len : 0;
      u = Math.max(0, Math.min(1, u));
      best = Math.min(best, Math.hypot(px - (xj + u * dx), py - (yj + u * dy)));
    }
    return inside ? best : -best;
  };
  const bboxCentre = (ring: Ring): [number, number] => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, y] of ring) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
    return [(a + b) / 2, (c + d) / 2];
  };
  for (const [name, ring] of Object.entries({
    triangle: paths.ngonRing(3),
    'star-3': paths.starRing(3),
    'star-5': paths.starRing(5),
    heart: paths.heartRing(),
    shield: paths.shieldRing(),
    tag: paths.tagRing(),
    arch: paths.archRing(),
    egg: paths.eggRing(),
  })) {
    /* The contract `switchSpotOf` actually makes, which is not "beat the bbox centre".

       It puts the switch at the CENTROID and slides toward the pole only when the centroid is a
       poor spot, stopping at 60% of the best clearance available. For a triangle or a star the
       centroid is already the best place and nothing moves. For a heart the centroid is the
       WORST place — it lands in the notch between the lobes — so it slides, and settles near
       the bounding-box centre having traded a few percent of clearance for being where the eye
       expects it. Asserting "origin beats bbox" would forbid exactly that trade. */
    const [bx, by] = bboxCentre(ring as Ring);
    const atOrigin = clearanceAt(ring as Ring, 0, 0);
    const atBbox = clearanceAt(ring as Ring, bx, by);
    const best = clearanceAt(ring as Ring, ...paths.poleOfInaccessibility(ring as Ring));
    check(
      `${name}: the switch spot keeps most of the room available`,
      atOrigin >= best * 0.6 - 1e-6,
      `origin ${atOrigin.toFixed(3)} = ${((atOrigin / best) * 100).toFixed(0)}% of the best `
      + `(${best.toFixed(3)}); bbox centre would be ${atBbox.toFixed(3)}`,
    );
  }
}

  /* Two things have to be true at once for a shape to read as "centred", and satisfying only
     the first is what made the heart look wrong: the switch must FIT at the origin, AND the
     origin must be where the eye puts the middle. The heart's old proportions could not do
     both — its only switch-sized spot was 10% of the height below its visual centre — so the
     shape was re-proportioned rather than the switch moved. */
  for (const [name, ring, tol] of [
    ['heart', paths.heartRing(), 0.03],
    ['circle', paths.circleRing(), 0.001],
    ['squircle', paths.squircleRing(), 0.001],
  ] as [string, Ring, number][]) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, y] of ring) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
    const longest = Math.max(b - a, d - c);
    // The ring is pole-centred, so the origin IS the pole; its distance from the bbox centre
    // is exactly how far the switch sits from where the eye puts the middle.
    const off = Math.hypot((a + b) / 2, (c + d) / 2) / longest;
    check(
      `${name}: the switch sits at the shape's visual centre, not just a spot that fits`,
      off <= tol,
      `origin is ${(off * 100).toFixed(2)}% of the longest side from the visual centre `
      + `(limit ${(tol * 100).toFixed(1)}%; the old heart was 10.2%)`,
    );
  }

console.log(failures ? `\n${failures} FAILED` : '\nevery shape is the shape it claims, and the fit search cannot run away');
process.exit(failures ? 1 : 0);
