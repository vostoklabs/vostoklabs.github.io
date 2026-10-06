/*
  The clicker's export, pinned: sixteen fixed designs, every file they export, byte for byte.

    node apps/clicker-generator/tests/suites.mjs golden/export-matrix      (part of pnpm test)

  Every design is built the way the geometry worker builds it (the same assets, normalised the
  same way at init, the same builder), from the inputs mount.ts would send for it, and exported
  through the app's own writers. Per design this pins:

    - every part: its name, group, colour and slot, and a hash of its vertex and triangle arrays;
    - the 3MF, entry by entry (never the zip bytes: an entry's timestamp is local time);
    - the OBJ and the MTL, as text;
    - the warnings, the triangle count, the bounding box and the volume, so a failure says how
      much moved as well as what.

  The clock is frozen, so the dates the provenance mark writes are fixed too.

  A change that is meant to leave the files as they are has to leave this table exactly as it
  is. A deliberate change to the files fails here, says which designs and which entries moved,
  and writes what it got to
  node_modules/.cache/export-matrix.actual.json. Once the change is meant, rewrite the table:

    GOLDEN_UPDATE=1 node apps/clicker-generator/tests/suites.mjs golden/export-matrix

  and say in the commit what changed in the files and why.
*/
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { unzipSync } from 'fflate';
import Module from 'manifold-3d';

// GOLDEN_UPDATE=1 rewrites the table; unset (or empty), the table is compared. Any other value
// ("0", "true") is not guessed at: the run stops here, before anything is built.
const UPDATE = process.env.GOLDEN_UPDATE ?? '';
if (UPDATE !== '' && UPDATE !== '1') {
  console.error(`GOLDEN_UPDATE is "${UPDATE}": set GOLDEN_UPDATE=1 to rewrite the table, or leave it unset to compare against it.`);
  process.exit(1);
}

// The SVG reader is handed a DOMParser under node, before anything that reads SVG loads.
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

/* ------------------------------------------------------------------ a frozen clock */

const FROZEN = Date.UTC(2026, 0, 2, 12);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length ? args : [FROZEN]) as [number]));
  }
  static now(): number {
    return FROZEN;
  }
}
globalThis.Date = FrozenDate as DateConstructor;

const { processImage, parseSvg } = await import('@vostok/trace');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../../src/geometry/buildClicker.ts');
const { buildBlocks } = await import('../../src/geometry/buildBlocks.ts');
const { buildFitStrip, FIT_TEST_FONT_ID, FIT_TEST_STEP_MM, fitTestLabel, fitTestLadder } = await import('../../src/geometry/fitStrip.ts');
const { arrangeBlocks, blockBuildParams, tracedSymbols } = await import('../../src/geometry/blockLayout.ts');
const { parseLetter, parseBlockChain } = await import('../../src/image/letter.ts');
const { LUCIDE_ICONS, buildSvg } = await import('../../src/image/lucideIcons.ts');
const { prepareModel } = await import('../../src/model/prepare.ts');
const { MODEL_SAMPLES } = await import('../../src/model/samples.ts');
const { FALLBACK_POST_SEAT, makeSwitchKit, measurePostSeat, measureSwitchBands, seatPost } = await import('../../src/model/switchKit.ts');
const { buildModelClicker } = await import('../../src/model/buildModel.ts');
const { DEFAULT_MODEL_CUT } = await import('../../src/model/types.ts');
const { clickerThreeMF } = await import('../../src/export/threemfExport.ts');
const { clickerObjMtl } = await import('../../src/export/objExport.ts');

type BuildParams = import('../../src/types.ts').BuildParams;
type BuildRegion = import('../../src/types.ts').BuildRegion;
type ClickerPart = import('../../src/types.ts').ClickerPart;
type RegionSet = import('../../src/types.ts').RegionSet;
type RGB = import('../../src/types.ts').RGB;
type Ring = import('../../src/types.ts').Ring;
type PlateChoice = import('@vostok/plates').PlateChoice;
type RgbaImage = import('@vostok/trace').RgbaImage;
type BlockSymbol = import('../../src/geometry/blockLayout.ts').BlockSymbol;
type ModelCutParams = import('../../src/model/types.ts').ModelCutParams;

const APP = join(process.cwd(), 'apps/clicker-generator');
const GOLDEN_FILE = join(APP, 'tests/golden/export-matrix.json');
const file = (p: string): Buffer => readFileSync(join(APP, 'public/assets', p));
const bytesOf = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/* ------------------------------------------------------------------ the worker's init */

const wasm: any = await Module();
wasm.setup();

/** An MX asset as a solid, the way the worker's `assetToSolid` makes it. */
function assetSolid(path: string) {
  const raw = readModel(bytesOf(file(path)), path);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}
// Socket centred with its top at Z 0; stem centred, its authored Z kept.
const socketRaw = assetSolid('switch/mx/mx-socket.3mf');
const stemRaw = assetSolid('switch/mx/mx-stem.3mf');
const sbb = socketRaw.boundingBox();
const tbb = stemRaw.boundingBox();
const socket = socketRaw.translate([-(sbb.min[0] + sbb.max[0]) / 2, -(sbb.min[1] + sbb.max[1]) / 2, -sbb.max[2]]);
const tcx = (tbb.min[0] + tbb.max[0]) / 2;
const tcy = (tbb.min[1] + tbb.max[1]) / 2;
const stem = stemRaw.translate([-tcx, -tcy, 0]);
socketRaw.delete();
stemRaw.delete();

// The display switch, seated on its shoulder: Model mode measures its envelope and the slider
// the keycap post rests on.
const sw = readModel(bytesOf(file('switch/mx/mx-switch.3mf')), 'mx-switch.3mf');
{
  const v = sw.positions;
  let widest = 0;
  for (let i = 0; i < v.length; i += 3) {
    v[i] -= tcx;
    v[i + 1] -= tcy;
    widest = Math.max(widest, Math.abs(v[i]), Math.abs(v[i + 1]));
  }
  let seatZ = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (Math.max(Math.abs(v[i]), Math.abs(v[i + 1])) >= widest * 0.96 && v[i + 2] < seatZ) seatZ = v[i + 2];
  }
  for (let i = 0; i < v.length; i += 3) v[i + 2] -= seatZ;
}
const kit = makeSwitchKit(
  socket,
  seatPost(stem, measurePostSeat(sw.positions, sw.indices) ?? FALLBACK_POST_SEAT),
  measureSwitchBands(sw.positions, sw.indices),
);

const keycapJson = JSON.parse(file('keycap.json').toString('utf-8'));
const keycapAsset = { shell: { positions: keycapJson.positions, indices: keycapJson.indices }, stem: keycapJson.stem ?? null, meta: keycapJson.meta };

/* ------------------------------------------------------------------ inputs, as mount.ts makes them */

const BLACK: RGB = [22, 22, 22];
const WHITE: RGB = [247, 247, 245];
const ORANGE: RGB = [255, 106, 19];

/** The store's defaults through `buildParamsFor`, for the image and SVG tabs. */
const DEFAULTS: BuildParams = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: WHITE, bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
  legendScale: 1, legendBold: 0, textBold: 0, keychainEnd: 'left', keychainSlideMm: 0, partOverrides: {},
};
/** Text and blocks: the wider frame `buildParamsFor` gives lettering. */
const LETTERING = { imageMargin: 2.5, borderWidth: 3.5 };

/** The worker's regions for a traced set, as `rebuild()` lays them out: a part per component. */
function regionsOf(set: RegionSet, colours: (RGB | undefined)[] = []): BuildRegion[] {
  const out: BuildRegion[] = [];
  set.regions.forEach((r, i) => {
    r.components.forEach((comp, j) => {
      out.push({ filamentRgb: colours[i] ?? r.quantRgb, coverage: r.coverage, rings: comp.rings, partName: `top-color-${i}-${j}` });
    });
  });
  return out;
}

/** Text mode: the letters, and the size multipliers `buildParamsFor` applies to them. */
function text(lines: string, fontId: string, typo: { lineSpacing?: number; letterSpacing?: number }, params: Partial<BuildParams> = {}) {
  const set = parseLetter(lines, fontId, 15, false, typo);
  return {
    regions: regionsOf(set, [BLACK]),
    outline: set.outline,
    params: { ...DEFAULTS, ...LETTERING, ...params, capWidthMm: (params.capWidthMm ?? 35) * (set.sizeMul ?? 1) },
  };
}

/** Letter blocks: the arrangement, the legends on one filament, and the block fields. */
function blocks(state: { blockLayout: 'row' | 'wasd'; blockLines: string[]; blockSymbols?: Record<string, BlockSymbol> }, look: { blockStyle: 'walls' | 'open'; blockTexture: 'smooth' | 'knurl' }) {
  const s = { blockGridRows: 3, blockGridCols: 3, blockCells: null, blockSymbols: {}, ...state };
  const arr = arrangeBlocks(s.blockLayout, s.blockGridRows, s.blockGridCols, s.blockCells, s.blockLines, s.blockSymbols);
  const set = parseBlockChain(arr.slots, 'helvetiker-regular', tracedSymbols(s.blockSymbols));
  return {
    regions: regionsOf(set, set.regions.map(() => BLACK)),
    params: { ...DEFAULTS, ...LETTERING, baseShape: 'square' as const, baseFilamentRgb: WHITE, ...blockBuildParams({ ...s, ...look }) },
  };
}

/** A 5-point star, centred, longest side 1: a symbol traced from the library. */
function starRing(): Ring {
  const ring: Ring = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.2 : 0.5;
    ring.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return ring;
}

/** Two colours of our own: a disc with a heart cut into it, and a dot. */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#0a5cd5"/>
  <path d="M50 78 C20 58 16 36 32 28 C42 23 48 30 50 36 C52 30 58 23 68 28 C84 36 80 58 50 78 Z" fill="#f7f7f5"/>
  <circle cx="50" cy="16" r="5" fill="#c8102e"/>
</svg>`;

function icon(name: string) {
  const info = LUCIDE_ICONS.find((ic) => ic.name === name);
  if (!info) throw new Error(`no Lucide icon "${name}"`);
  return parseSvg(buildSvg(info.node), { asPainted: true });
}

/** An 8-bit RGBA or indexed PNG, the two kinds the bundled pictures come in. */
function decodePng(buf: Buffer): RgbaImage {
  let p = 8;
  let w = 0, h = 0, bd = 0, ct = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 3)) throw new Error(`unsupported PNG: depth ${bd}, type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride);
    o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  if (ct === 6) return { data: new Uint8ClampedArray(out), width: w, height: h };
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const idx = out[i];
    rgba[i * 4] = plte ? plte[idx * 3] : 0;
    rgba[i * 4 + 1] = plte ? plte[idx * 3 + 1] : 0;
    rgba[i * 4 + 2] = plte ? plte[idx * 3 + 2] : 0;
    rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
  }
  return { data: rgba, width: w, height: h };
}

/** A picture traced the way the Image tab traces it at the default Size. */
function picture(path: string, colours: number) {
  return processImage(decodePng(file(path)), colours, { removeBg: true, smoothing: 0.1, designMm: 35 });
}

/** A Model-mode sample, read like an upload and cut at the preset its tile opens with. */
function sampleCut(id: string, over: Partial<ModelCutParams> = {}) {
  const sample = MODEL_SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`no sample "${id}"`);
  const name = `${id}.3mf`;
  const prep = prepareModel(wasm, readModel(bytesOf(file(`samples/${name}`)), name), name);
  const longest = Math.max(...prep.info.sizeMm);
  const sizeMm = longest >= 25 && longest <= 150 ? Math.round(longest) : 45;
  const out = buildModelClicker(wasm, kit, prep.solid, { ...DEFAULT_MODEL_CUT, sizeMm, ...sample.preset, ...over } as ModelCutParams);
  prep.solid.delete();
  return { ...out, sourceModel: name };
}

/* ------------------------------------------------------------------ the designs */

interface Built {
  parts: ClickerPart[];
  warnings: string[];
  sourceModel?: string;
  plate?: PlateChoice;
}

const DESIGNS: Record<string, () => Built> = {
  'text: two lines': () => {
    const t = text('Custom\nText', 'helvetiker-regular', {});
    return buildClicker(wasm, socket, stem, t.regions, t.outline, t.params);
  },
  'text: three lines, tracked and leaded, keychain': () => {
    const t = text('Vostok\nLabs\nClicker', 'helvetiker-regular', { letterSpacing: 0.3, lineSpacing: 1.4 }, {
      keychain: { enabled: true, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    });
    return buildClicker(wasm, socket, stem, t.regions, t.outline, t.params);
  },
  'text: Standard Bold, made bolder': () => {
    const t = text('Bold', 'helvetiker-bold', {}, { textBold: 0.2 });
    return buildClicker(wasm, socket, stem, t.regions, t.outline, t.params);
  },
  'blocks: ABCD in a row': () => {
    const b = blocks({ blockLayout: 'row', blockLines: ['ABCD'] }, { blockStyle: 'walls', blockTexture: 'smooth' });
    return buildBlocks(wasm, socket, keycapAsset as never, b.regions, b.params);
  },
  'blocks: WASD, a symbol on W, open, knurled': () => {
    const star = '\u{F0000}';
    const b = blocks(
      { blockLayout: 'wasd', blockLines: [star, 'ASD'], blockSymbols: { [star]: { kind: 'rings', label: 'Star', rings: [starRing()] } } },
      { blockStyle: 'open', blockTexture: 'knurl' },
    );
    return buildBlocks(wasm, socket, keycapAsset as never, b.regions, b.params);
  },
  'SVG on a circle': () => {
    const set = parseSvg(SVG, { removeBg: true, asPainted: true });
    return buildClicker(wasm, socket, stem, regionsOf(set), set.outline, { ...DEFAULTS, baseShape: 'circle' });
  },
  'SVG on a star, keychain, on the A1 mini': () => {
    const set = parseSvg(SVG, { removeBg: true, asPainted: true });
    const built = buildClicker(wasm, socket, stem, regionsOf(set), set.outline, {
      ...DEFAULTS, baseShape: 'star', shapeSides: 5, shapeArmPct: 0.56,
      keychain: { enabled: true, style: 'loop', angleDeg: 135, holeDiameterMm: 5.2, offsetMm: 0 },
    });
    return { ...built, plate: 'a1mini' };
  },
  'image: heart, four colours': () => {
    const set = picture('media/images/heart.png', 4);
    return buildClicker(wasm, socket, stem, regionsOf(set), set.outline, { ...DEFAULTS, baseFilamentRgb: set.regions[0]?.quantRgb ?? WHITE });
  },
  'icon: Lucide heart': () => {
    // An icon on the default outline base gets a circle (buildParamsFor's `effectiveBaseShape`).
    const set = icon('heart');
    return buildClicker(wasm, socket, stem, regionsOf(set, [BLACK]), set.outline, { ...DEFAULTS, baseShape: 'circle' });
  },
  'icon on a rounded square, smaller design, offset': () => {
    const set = icon('star');
    return buildClicker(wasm, socket, stem, regionsOf(set, [ORANGE]), set.outline, {
      ...DEFAULTS, baseShape: 'square', shapeCornerPct: 0.22, designScale: 0.8, imageOffset: { x: 0, y: 1.5 },
    });
  },
  'text: two switches': () => {
    const t = text('Press\nBoth', 'helvetiker-regular', {}, {
      capWidthMm: 60,
      switches: [{ x: -15, y: 0, rotation: 0 }, { x: 15, y: 0, rotation: 0 }],
    });
    return buildClicker(wasm, socket, stem, t.regions, t.outline, t.params);
  },
  'fit test strip': () => {
    const labels = fitTestLadder(0, FIT_TEST_STEP_MM).map((fitMm) => {
      const rs = parseLetter(fitTestLabel(fitMm), FIT_TEST_FONT_ID, 6, false);
      return { fitMm, rings: rs.regions.flatMap((r) => r.components.flatMap((c) => c.rings)) };
    });
    return buildFitStrip(wasm, stem, { labels, colorRgb: WHITE });
  },
  'Model mode: skull, sliced': () => sampleCut('skull'),
  'Model mode: pumpkin, button': () => sampleCut('pumpkin', { cutter: 'button' }),
  'Model mode: duck, on a stand': () => sampleCut('duck'),
  'Halloween pack: pumpkin shape round a traced design': () => {
    const shape = parseSvg(readFileSync(join(APP, 'public/assets/packs/halloween/shapes/pumpkin.svg'), 'utf-8'), { removeBg: true, asPainted: true });
    const set = picture('packs/halloween/designs/pumpkin-happy.png', 3);
    return buildClicker(wasm, socket, stem, regionsOf(set), set.outline, {
      ...DEFAULTS, baseShape: 'custom', baseShapeRings: shape.outline, baseFilamentRgb: ORANGE,
    });
  },
};

/* ------------------------------------------------------------------ measuring and hashing */

/** Each design's OBJ as text, for the check on its header at the end. */
const objTexts = new Map<Built, string>();

const hash = (...chunks: (string | Uint8Array)[]): string => {
  const h = createHash('sha256');
  for (const c of chunks) h.update(c);
  return h.digest('hex').slice(0, 16);
};
const bytes = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function record(built: Built) {
  let tris = 0;
  let volume = 0;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const parts = built.parts.map((p) => {
    const v = p.vertProperties;
    const t = p.triVerts;
    const n = p.numProp;
    for (let i = 0; i < v.length; i += n) {
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k]!, v[i + k]!);
        box[k + 3] = Math.max(box[k + 3]!, v[i + k]!);
      }
    }
    // Signed volume, by the divergence theorem: a closed solid's triangles summed against the origin.
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i]! * n, b = t[i + 1]! * n, c = t[i + 2]! * n;
      volume += (v[a]! * (v[b + 1]! * v[c + 2]! - v[b + 2]! * v[c + 1]!)
        - v[a + 1]! * (v[b]! * v[c + 2]! - v[b + 2]! * v[c]!)
        + v[a + 2]! * (v[b]! * v[c + 1]! - v[b + 1]! * v[c]!)) / 6;
    }
    tris += t.length / 3;
    return {
      name: p.name,
      group: p.objectKey ?? p.group,
      colour: p.colorRgb.join(','),
      ...(p.extruder !== undefined ? { slot: p.extruder } : {}),
      verts: v.length / n,
      tris: t.length / 3,
      mesh: hash(String(n), bytes(v), bytes(t)),
    };
  });

  const plate = built.plate ?? 'a1';
  const threeMF = unzipSync(clickerThreeMF(built.parts, { plate, ...(built.sourceModel ? { sourceModel: built.sourceModel } : {}) }));
  const { obj, mtl } = clickerObjMtl(built.parts, { plate, ...(built.sourceModel ? { sourceModel: built.sourceModel } : {}) });
  objTexts.set(built, obj);
  return {
    warnings: built.warnings,
    parts,
    tris,
    bbox: box.map(r3),
    volume: Math.round(volume * 100) / 100,
    '3mf': Object.fromEntries(Object.entries(threeMF).map(([name, data]) => [name, hash(data)])),
    obj: hash(obj),
    mtl: hash(mtl),
  };
}

/* ------------------------------------------------------------------ comparing */

type Record_ = ReturnType<typeof record>;
const actual: Record<string, Record_> = {};
const objs: Record<string, { obj: string; sourceModel?: string }> = {};
for (const [name, build] of Object.entries(DESIGNS)) {
  const started = performance.now();
  const built = build();
  actual[name] = record(built);
  objs[name] = { obj: objTexts.get(built)!, sourceModel: built.sourceModel };
  console.log(`built  ${name}  (${actual[name]!.parts.length} parts, ${actual[name]!.tris} triangles, ${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

if (UPDATE === '1') {
  writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, 2) + '\n');
  console.log(`\nwrote ${GOLDEN_FILE}`);
  process.exit(0);
}

const golden: Record<string, Record_> = JSON.parse(readFileSync(GOLDEN_FILE, 'utf-8'));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
};

check('the same designs, in the same order', same(Object.keys(actual), Object.keys(golden)), Object.keys(actual).join(' | '));
for (const [name, got] of Object.entries(actual)) {
  const want = golden[name];
  if (!want) continue;
  check(`${name}: the same warnings`, same(got.warnings, want.warnings), got.warnings.join(' | ') || 'none');
  const moved = got.parts.filter((p, i) => !same(p, want.parts[i]));
  check(
    `${name}: every part unchanged`,
    got.parts.length === want.parts.length && moved.length === 0,
    moved.length || got.parts.length !== want.parts.length
      ? `${got.parts.length} parts (was ${want.parts.length}); changed: ${moved.map((p) => p.name).join(', ')}; ${got.tris} triangles (was ${want.tris}), volume ${got.volume} (was ${want.volume}) mm³, box ${got.bbox.join(' ')} (was ${want.bbox.join(' ')})`
      : `${got.parts.length} parts`,
  );
  const entries = Object.keys(got['3mf']);
  const changed = entries.filter((e) => got['3mf'][e] !== want['3mf'][e]);
  check(
    `${name}: the 3MF unchanged, entry by entry`,
    same(entries, Object.keys(want['3mf'])) && changed.length === 0,
    changed.length ? `changed: ${changed.join(', ')}` : `${entries.length} entries`,
  );
  check(`${name}: the OBJ and the MTL unchanged`, got.obj === want.obj && got.mtl === want.mtl, got.obj === want.obj ? (got.mtl === want.mtl ? '' : 'the MTL changed') : 'the OBJ changed');
}

// The OBJ's header is the provenance mark the 3MF carries (invariant #2), and a model cut from
// someone's file says so rather than claiming the shape.
for (const [name, o] of Object.entries(objs)) {
  const header = o.obj.slice(0, o.obj.indexOf('\nmtllib '));
  check(
    `${name}: the OBJ carries the provenance mark${o.sourceModel ? ', crediting the model' : ''}`,
    header.startsWith('# Vostok Labs - Clicker\n') && header.includes('# Created: 2026-01-02')
      && (o.sourceModel ? header.includes(`made from an uploaded model: ${o.sourceModel}.`) : header.includes('generated by the Vostok Labs Clicker Generator')),
    `${header.split('\n').length} header lines`,
  );
}

console.log(`\nexport matrix: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  const cache = join(APP, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'export-matrix.actual.json'), JSON.stringify(actual, null, 2) + '\n');
  console.log('What the build gives now is in node_modules/.cache/export-matrix.actual.json; if the change is meant, rewrite the table with GOLDEN_UPDATE=1 (see the header).');
  process.exit(1);
}
