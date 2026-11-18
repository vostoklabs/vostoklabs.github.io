/*
  Seasonal packs: a pumpkin has to survive the whole way from an SVG on disk to a printable
  body, and the only interesting question is whether the two ends agree.

  This is the path with nobody watching it. A pack asset is fetched, traced, handed to the
  geometry as `baseShape: 'custom'` and turned into a body — and every failure mode in that
  chain is SILENT. A stroke-only SVG traces as a hollow ring. A file that will not load leaves
  no rings, and `makeCustom` falls back to a circle, so the pumpkin simply comes out round and
  nothing anywhere says why. Both are things a person would only catch by looking at the
  screen and knowing what a pumpkin looks like.

  So the assertions are shape measurements, not "it built": a pumpkin is wider than it is tall
  and it is NOT a circle, which is exactly what distinguishes a working trace from the
  fallback.

  It also holds the pack manifests to their files (on disk, light, hard-edged) and the rule
  for which sample groups lead and start open, checked on fixed dates.

  Run from the repo root:

    node apps/clicker-generator/tests/suites.mjs packs
*/
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import Module from 'manifold-3d';
import { DOMParser } from '@xmldom/xmldom';

// parseSvg needs a browser DOMParser — the same polyfill svg-coverage.test.ts uses.
(globalThis as any).DOMParser = DOMParser;

const { parseSvg } = await import('@vostok/trace');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const { HALLOWEEN } = await import('../src/packs/halloween.ts');
const { CHRISTMAS } = await import('../src/packs/christmas.ts');
const { designIsVector, inSeason, orderPacks, packFold } = await import('../src/packs/types.ts');
const { PACKS, orderedDesignPacks } = await import('../src/packs/index.ts');
const { SAMPLES } = await import('../src/image/sample.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type Ring = import('../src/types.ts').Ring;

const appDir = join(process.cwd(), 'apps/clicker-generator');
const asset = (p: string) => readFileSync(join(appDir, 'public/assets', p)).buffer as ArrayBuffer;

const wasm = await Module();
wasm.setup();

function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = readModel(buf, 'asset.3mf');
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  const out = solid.translate([-cx, -cy, dropTopToZero ? -bb.max[2] : 0]);
  solid.delete();
  return out;
}

const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const square: Ring = [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]];
const regions: BuildRegion[] = [
  { filamentRgb: [255, 106, 19], coverage: 1, rings: [square], partName: 'top-color-0-0' },
];

const base: BuildParams = {
  baseShape: 'circle', capWidthMm: 45, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2,
  borderWidth: 2, capProud: 1.2, tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.05, stepHeight: 0.4, travel: 3.8,
  floorThickness: 1.2, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
  componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
};

/** Body footprint, and how much of its own bounding box it actually fills. A circle fills
 *  π/4 ≈ 0.785 of its box; anything with lobes and a stalk fills less. */
function bodyShape(params: BuildParams) {
  const out = buildClicker(wasm, socket, stem, regions, [square], params);
  const body = out.parts.find((p) => p.name === 'base-body')!;
  const v = body.vertProperties, t = body.triVerts, n = body.numProp;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let i = 0; i < v.length; i += n) {
    if (v[i] < minX) minX = v[i];
    if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1];
    if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2];
  }
  // Underside area, by summing the triangles that lie on the bottom face. That is the body's
  // real footprint, which is what "is this a circle" has to be asked of.
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    const onFloor = Math.abs(v[a + 2] - minZ) < 1e-3
      && Math.abs(v[b + 2] - minZ) < 1e-3
      && Math.abs(v[c + 2] - minZ) < 1e-3;
    if (!onFloor) continue;
    area += Math.abs(
      (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1]),
    ) / 2;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  // Every edge of every floor triangle, for the width profile below.
  const segs: Seg[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    const onFloor = Math.abs(v[a + 2] - minZ) < 1e-3
      && Math.abs(v[b + 2] - minZ) < 1e-3
      && Math.abs(v[c + 2] - minZ) < 1e-3;
    if (!onFloor) continue;
    segs.push([v[a], v[a + 1], v[b], v[b + 1]]);
    segs.push([v[b], v[b + 1], v[c], v[c + 1]]);
    segs.push([v[c], v[c + 1], v[a], v[a + 1]]);
  }
  return {
    w, h, fill: w * h > 0 ? area / (w * h) : 0, warnings: out.warnings,
    profile: widthProfile(segs),
  };
}

/**
 * The shape's WIDTH at nine heights, each as a fraction of its full width.
 *
 * This replaced "the footprint fills less of its box than a circle would", which was the
 * first attempt at "did the rings actually reach the geometry, or did `makeCustom` quietly
 * fall back to a circle". Area cannot answer that. A circle fills 78.5% of its box, a coffin
 * 77.3% and a crest 77.3% — so the check passed for a pumpkin and failed for the two real
 * files that landed next, having discovered nothing about either.
 *
 * A profile can, because the fallback's failure is one of SHAPE, not of size. A circle is
 * 44% of its width at nine-tenths height; a crest, which is flat on top, is 100%. Comparing
 * the built body's profile against the same measurement taken from the SVG on disk asks the
 * question directly — "is the body the shape of the drawing" — for any drawing, including
 * ones that happen to be round.
 */
type Seg = [number, number, number, number];
const PROFILE_AT = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function widthProfile(segs: Seg[]): number[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of segs) {
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
  }
  const w = maxX - minX;
  if (!(w > 0) || !(maxY - minY > 0)) return PROFILE_AT.map(() => 0);
  return PROFILE_AT.map((f) => {
    const y = minY + (maxY - minY) * f;
    let lo = Infinity, hi = -Infinity;
    for (const [x1, y1, x2, y2] of segs) {
      // A horizontal edge contributes nothing the two edges meeting it do not.
      if (y1 === y2 || (y1 - y) * (y2 - y) > 0) continue;
      const x = x1 + (x2 - x1) * ((y - y1) / (y2 - y1));
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return hi > lo ? (hi - lo) / w : 0;
  });
}

/** The same measurement, taken from a traced outline rather than from a built mesh. */
function ringProfile(rings: Ring[]): number[] {
  const segs: Seg[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return widthProfile(segs);
}

const profileGap = (a: number[], b: number[]) =>
  a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

// ---------------------------------------------------------------- the manifest

check(
  'the pack has at least one shape wired up, so the whole path is exercised',
  HALLOWEEN.shapes.length > 0,
  HALLOWEEN.shapes.map((s) => s.id).join(', ') || '(none — the pack path is untested code)',
);
check(
  'season ordering wraps correctly and never runs all year',
  inSeason(HALLOWEEN, new Date('2026-10-15')) && !inSeason(HALLOWEEN, new Date('2026-06-15')),
  `in season 15 Oct: ${inSeason(HALLOWEEN, new Date('2026-10-15'))}, `
  + `15 Jun: ${inSeason(HALLOWEEN, new Date('2026-06-15'))}`,
);
// Christmas is the case the wrap exists for, and the one a naive `from <= md <= to` gets wrong.
check(
  'a season that crosses the new year is two ranges, not none',
  inSeason({ ...HALLOWEEN, season: { from: '12-15', to: '01-06' } }, new Date('2026-12-28'))
    && inSeason({ ...HALLOWEEN, season: { from: '12-15', to: '01-06' } }, new Date('2026-01-02'))
    && !inSeason({ ...HALLOWEEN, season: { from: '12-15', to: '01-06' } }, new Date('2026-07-01')),
  '28 Dec and 2 Jan in, 1 Jul out',
);

// ---------------------------------------------------------------- the trace

for (const shape of HALLOWEEN.shapes) {
  const svg = readFileSync(
    join(appDir, 'public/assets/packs', HALLOWEEN.dir, 'shapes', shape.file),
    'utf-8',
  );
  const traced = parseSvg(svg, { removeBg: true, asPainted: true });
  check(
    `${shape.id}: the file traces to a filled silhouette`,
    traced.outline.length > 0 && traced.outline.some((r) => r.length >= 3),
    `${traced.outline.length} ring(s), ${traced.outline[0]?.length ?? 0} points on the first`,
  );

  const custom = bodyShape({ ...base, baseShape: 'custom', baseShapeRings: traced.outline });
  const circle = bodyShape({ ...base, baseShape: 'circle' });
  const drawnProfile = ringProfile(traced.outline);

  /* The assertion that matters. `makeCustom` falls back to a circle when the rings are
     missing or degenerate, which is right — a pack file that failed to load should give a
     plain clicker rather than a build error — but it means "it built" proves nothing at all.

     So: the body's width profile has to match the DRAWING's and not the circle's. Both
     halves are needed. Matching the drawing alone would pass on a shape that happens to be
     round; beating the circle alone would pass on a body that is neither. */
  const toDrawing = profileGap(custom.profile, drawnProfile);
  const toCircle = profileGap(custom.profile, circle.profile);
  check(
    `${shape.id}: the base is really that shape, not the circle fallback`,
    toDrawing < 0.12 && toDrawing < toCircle,
    `width profile is ${toDrawing.toFixed(3)} from the drawing's and ${toCircle.toFixed(3)} from a circle's`,
  );
  /* The drawing's own aspect, measured — never a literal.

     This was `200 / 180`, the pumpkin's ratio typed in by hand, which asserted that every
     shape a pack ever adds is roughly square. A coffin is 0.69 and a potion 0.73, so the
     first two real files to land would have failed a test that was right about nothing
     except the one shape it was written against. What the check is actually for is "the
     body came out the shape of the drawing", and the drawing is on disk to be measured. */
  const bb = traced.outline.flat().reduce(
    (a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const drawn = (bb[2] - bb[0]) / (bb[3] - bb[1]);
  check(
    `${shape.id}: it keeps the drawing's proportions`,
    Math.abs(custom.w / custom.h - drawn) < 0.12,
    `${custom.w.toFixed(1)} × ${custom.h.toFixed(1)} mm (aspect ${(custom.w / custom.h).toFixed(2)}, drawn at ${drawn.toFixed(2)})`,
  );
  check(
    `${shape.id}: it still carries every identity mark`,
    !custom.warnings.some((w) => w.startsWith('Provenance:')),
    custom.warnings.find((w) => w.startsWith('Provenance:')) ?? 'all marks buried',
  );
}

// ---------------------------------------------------------------- the designs

/* Designs never had a test, and the failure they invite is the quiet kind: a manifest line
   whose file is not there loads nothing, and the tile is simply absent from the grid with
   no error anywhere. So this asserts the two things the manifest can get wrong on its own —
   the file exists, and the loader that will be chosen for it matches what it actually is. */
check(
  'the pack ships artwork as well as shapes',
  HALLOWEEN.designs.length > 0,
  `${HALLOWEEN.designs.length} design(s)`,
);
for (const pack of [HALLOWEEN, CHRISTMAS]) for (const d of pack.designs) {
  const design = { ...d, id: `${pack.id}/${d.id}` };
  const file = join(appDir, 'public/assets/packs', pack.dir, 'designs', design.file);
  const there = existsSync(file);
  check(`${design.id}: its file is on disk`, there, there ? design.file : `missing: ${design.file}`);
  /* A filename a URL has to encode is a filename that works in Node's `join` and may not
     work in a fetch. Rather than trusting that every future consumer encodes correctly,
     require the names to be ones that need no encoding at all. */
  check(
    `${design.id}: its filename needs no URL encoding`,
    encodeURIComponent(design.file) === design.file,
    design.file,
  );
  /* The design grid wires the BITMAP path only — `loadDesignImage`, the same call the
     bundled samples make. `designIsVector` marks where the vector branch goes, and the
     branch is not written, so a vector design would be declared, pass every other check
     here, and then simply not appear in the panel. Failing loudly now is the cheaper of
     the two, and it is the line to delete on the day someone wires `loadDesign` up. */
  check(
    `${design.id}: it is a bitmap, which is the only design path wired up`,
    !designIsVector(design),
    designIsVector(design) ? 'vector — nothing renders this yet' : 'bitmap → loadUrlToImage',
  );
}

// ---------------------------------------------------------------- the Christmas pack

check('PACKS holds Christmas then Halloween', PACKS.map((p) => p.id).join() === 'christmas,halloween', PACKS.map((p) => p.id).join());
check('Christmas has fifteen designs', CHRISTMAS.designs.length === 15, `${CHRISTMAS.designs.length}`);
check('Christmas has no base shapes', CHRISTMAS.shapes.length === 0, `${CHRISTMAS.shapes.length}`);
check(
  'Christmas design ids are unique inside the pack',
  new Set(CHRISTMAS.designs.map((d) => d.id)).size === CHRISTMAS.designs.length,
  CHRISTMAS.designs.map((d) => d.id).join(', '),
);
/* The picker knows the loaded sample by its NAME, across every grid, so a name shared by two
   tiles would mark both and open the wrong group. */
{
  const names = [...PACKS.flatMap((p) => p.designs.map((d) => d.name)), ...SAMPLES.map((s) => s.name)];
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check('every sample name is unique across every pack and the stock samples', dupes.length === 0, dupes.join(', ') || `${names.length} names`);
}

/* Light and hard-edged: read straight from the PNG chunks, no decoder needed. A palette PNG
   whose transparency table holds only 0 and 255 has no half-transparent pixel anywhere. */
function pngFacts(buf: Buffer) {
  let p = 8, width = 0, height = 0, depth = 0, colourType = 0;
  let trns: number[] | null = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; colourType = d[9]; }
    else if (type === 'tRNS') trns = [...d];
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  return { width, height, depth, colourType, trns };
}
/** The alpha of pixel (x, y) of an 8-bit palette PNG: its index through the transparency table. */
function paletteAlphaAt(buf: Buffer, x: number, y: number): number {
  const { width, trns } = pngFacts(buf);
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    if (buf.toString('ascii', p + 4, p + 8) === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  // Undo each row's filter (one byte a pixel) down to row y.
  let prev = new Uint8Array(width), row = new Uint8Array(width);
  for (let r = 0; r <= y; r++) {
    const f = raw[r * (width + 1)];
    const src = raw.subarray(r * (width + 1) + 1, (r + 1) * (width + 1));
    row = new Uint8Array(width);
    for (let i = 0; i < width; i++) {
      const a = i ? row[i - 1] : 0, b = prev[i], c = i ? prev[i - 1] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      row[i] = (src[i] + pred) & 255;
    }
    prev = row;
  }
  return trns?.[row[x]] ?? 255;
}
{
  let total = 0;
  for (const d of CHRISTMAS.designs) {
    const buf = readFileSync(join(appDir, 'public/assets/packs', CHRISTMAS.dir, 'designs', d.file));
    total += buf.length;
    const f = pngFacts(buf);
    check(`christmas/${d.id}: under 20,000 bytes`, buf.length < 20_000, `${buf.length} B`);
    check(
      `christmas/${d.id}: square and at most 1100 px (the loader never shrinks it)`,
      f.width === f.height && f.width > 0 && f.width <= 1100,
      `${f.width} x ${f.height}`,
    );
    check(
      `christmas/${d.id}: a palette PNG with a hard edge (alpha only 0 or 255)`,
      f.colourType === 3 && f.depth === 8 && !!f.trns && f.trns.includes(0) && f.trns.every((a) => a === 0 || a === 255),
      `colour type ${f.colourType}, depth ${f.depth}, tRNS ${f.trns ? f.trns.join(' ') : 'none'}`,
    );
    const w = f.width - 1, mid = Math.floor(f.width / 2);
    const corners = [[0, 0], [w, 0], [0, w], [w, w]].map(([x, y]) => paletteAlphaAt(buf, x, y));
    check(`christmas/${d.id}: its corners are transparent`, corners.every((a) => a === 0), corners.join(' '));
    // The wreath is a ring: the hole in it is see-through, and every other drawing covers its middle.
    const centre = paletteAlphaAt(buf, mid, mid);
    check(`christmas/${d.id}: its centre pixel is ${d.id === 'wreath' ? 'transparent (the hole in the ring)' : 'drawn'}`,
      centre === (d.id === 'wreath' ? 0 : 255), `alpha ${centre}`);
  }
  check('the Christmas designs together are under 200,000 bytes', total < 200_000, `${total} B`);
}

/* The seasons, and the rule the sample groups follow: in-season pack first and open, every
   other pack folded in declared order. Fixed dates, local time, as `inSeason` reads them. */
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d);
for (const [date, yes] of [
  [on(2026, 11, 15), true], [on(2026, 11, 16), true], [on(2026, 12, 25), true], [on(2027, 1, 2), true], [on(2027, 1, 6), true],
  [on(2026, 11, 14), false], [on(2027, 1, 7), false], [on(2027, 6, 15), false], [on(2026, 11, 3), false], [on(2026, 10, 31), false],
] as [Date, boolean][]) {
  check(`Christmas in season on ${date.toDateString()}: ${yes}`, inSeason(CHRISTMAS, date) === yes, String(inSeason(CHRISTMAS, date)));
}
check('Halloween in season on 2 November', inSeason(HALLOWEEN, on(2026, 11, 2)), '');
check('Halloween out of season on 3 November', !inSeason(HALLOWEEN, on(2026, 11, 3)), '');
{
  let both = 0;
  for (let t = on(2028, 1, 1); t.getFullYear() === 2028; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    if (PACKS.filter((p) => inSeason(p, t)).length > 1) both++;
  }
  check('over every day of 2028, at most one pack is in season', both === 0, `${both} day(s) with two`);
}
for (const [date, order, folds] of [
  [on(2026, 11, 16), 'christmas,halloween', 'open,closed'],
  [on(2026, 11, 3), 'christmas,halloween', 'closed,closed'],
  [on(2026, 12, 25), 'christmas,halloween', 'open,closed'],
  [on(2027, 1, 2), 'christmas,halloween', 'open,closed'],
  [on(2027, 6, 15), 'christmas,halloween', 'closed,closed'],
  [on(2026, 10, 31), 'halloween,christmas', 'open,closed'],
] as [Date, string, string][]) {
  const packs = orderedDesignPacks(date);
  const got = packs.map((p) => p.id).join();
  const gotFolds = packs.map((p) => packFold(p, date)).join();
  check(`${date.toDateString()}: groups in order ${order}`, got === order, got);
  check(`${date.toDateString()}: groups start ${folds}`, gotFolds === folds, gotFolds);
}
check(
  'orderPacks keeps the given order when nothing is in season',
  orderPacks([HALLOWEEN, CHRISTMAS], on(2027, 6, 15)).map((p) => p.id).join() === 'halloween,christmas',
  '',
);

// ---------------------------------------------------------------- the fallback

// A pack file that fails to load leaves no rings. That MUST be a plain clicker, not a crash
// and not an empty build — the app is what people are using, and a missing asset is not their
// problem to debug.
const empty = bodyShape({ ...base, baseShape: 'custom', baseShapeRings: [] });
check(
  'a shape whose rings never arrived falls back to a circle rather than failing',
  empty.w > 10 && Math.abs(empty.w - empty.h) < 0.5,
  `${empty.w.toFixed(1)} × ${empty.h.toFixed(1)} mm`,
);

// A pack shape must work with the fixed size too — a seller wanting pumpkin-shaped SKUs is
// the obvious combination of the two features shipped together.
const sized = bodyShape({
  ...base,
  baseShape: 'custom',
  baseShapeRings: parseSvg(
    readFileSync(join(appDir, 'public/assets/packs/halloween/shapes/pumpkin.svg'), 'utf-8'),
    { removeBg: true, asPainted: true },
  ).outline,
  bodySize: { w: 46, h: 40 },
});
check(
  'a pack shape can be locked to a fixed size like any other base',
  Math.abs(sized.w - 46) < 0.5 && Math.abs(sized.h - 40) < 0.5,
  `asked 46 × 40, got ${sized.w.toFixed(2)} × ${sized.h.toFixed(2)} mm`,
);

console.log(failures ? `\n${failures} FAILED` : '\nthe pack path traces, builds and is not secretly a circle');
process.exit(failures ? 1 : 0);
