/*
  The fit controls in BLOCKS mode.

  Ian: "make sure that the updated tolerance controls we have for normal clicker are also
  working for blocks."

  They were not. `stemFitPct` did work — it sizes the keycap's grip on the switch — and was
  visible. `socketFitPct` did nothing at all: the flat clicker's pocket is a subtraction, so
  scaling the cutter scales the pocket, but a block's pocket is authored into its shell and
  there was no cutter to scale. The control was also HIDDEN in blocks mode, which is why the
  gap never surfaced — a switch that was tight in a block could not be fixed at all, and the
  printable fit test that answers "what number do I type" was unreachable from the mode that
  needs it just as much.

  Volume is the probe, for the same reason it is in fit-controls.test.ts: both fits move
  geometry INSIDE the part, where no bounding box and no screenshot can see it.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/blocks-fit.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/clicker-generator/.blocks-fit-test.mjs \
      && node apps/clicker-generator/.blocks-fit-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildBlocks, prepareBlockAssets } from '../src/geometry/buildBlocks.ts';
import type { BuildParams, BuildRegion, ClickerPart } from '../src/types.ts';

const A = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;

const wasm = await Module();
wasm.setup();

/** The socket, normalised as the worker does it: XY-centred, top face at Z 0. */
function normalisedSocket(buf: ArrayBuffer) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  const s = wasm.Manifold.ofMesh(mesh);
  const bb = s.boundingBox();
  const out = s.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.max[2]]);
  s.delete();
  return out;
}

/** A block shell, raw — `prepareBlockAssets` does its own normalisation. */
function rawSolid(buf: ArrayBuffer) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}

const socket = normalisedSocket(A('switch/mx/mx-socket.3mf'));
const blocks = prepareBlockAssets(wasm, socket, {
  noSides: rawSolid(A('blocks/block no sides to connect.3mf')),
  south: rawSolid(A('blocks/block south side to connect.3mf')),
  northSouth: rawSolid(A('blocks/block north and south side to connect.3mf')),
} as never);

const keycapJson = JSON.parse(
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets/keycap.json'), 'utf-8'),
);
const keycapAsset = {
  shell: { positions: keycapJson.positions, indices: keycapJson.indices },
  stem: keycapJson.stem ?? null,
  meta: keycapJson.meta,
};

/* Blocks derive their CELLS from `regions`, one per printed block — not from `blockSlots`,
   which is the main thread's chip list. A block is "filled" when its region has a ring with at
   least three points, so two plain squares stand in for two letters here: this test is about
   the switch pocket, and the legend geometry is fit-controls' business, not this file's. */
const square = (s: number): [number, number][] => [[-s, -s], [s, -s], [s, s], [-s, s]];
const regions: BuildRegion[] = [
  { filamentRgb: [20, 20, 20], coverage: 1, rings: [square(0.3)], partName: 'top-color-0-0' },
  { filamentRgb: [20, 20, 20], coverage: 1, rings: [square(0.3)], partName: 'top-color-1-0' },
];
const base = {
  baseShape: 'square', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2.5,
  borderWidth: 3.5, capProud: 1.2, tolerance: 0.4, stemFitPct: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.05, stepHeight: 0.4, travel: 3.8,
  floorThickness: 1.2, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
  componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
  blockOrientation: 'horizontal', legendScale: 1, legendBold: 0, keychainEnd: 'left',
  blockSlots: [{ kind: 'char', ch: 'A' }, { kind: 'char', ch: 'B' }],
} as unknown as BuildParams;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Signed volume via the divergence theorem, over the parts a predicate selects. */
const volOf = (parts: ClickerPart[], pred: (p: ClickerPart) => boolean): number => {
  let vol = 0;
  for (const p of parts) {
    if (!pred(p)) continue;
    const v = p.vertProperties, t = p.triVerts, n = p.numProp;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
      vol += (
        v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2])
        - v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2])
        + v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])
      ) / 6;
    }
  }
  return vol;
};

const run = (p: Partial<BuildParams>) =>
  buildBlocks(wasm, blocks, keycapAsset as never, regions, { ...base, ...p });

const isBlock = (p: ClickerPart) => p.name.startsWith('block-');
const isCap = (p: ClickerPart) => !p.name.startsWith('block-');

const zero = run({});
check(
  'blocks build at all',
  zero.parts.length > 0 && volOf(zero.parts, isBlock) > 0,
  `${zero.parts.length} parts, ${volOf(zero.parts, isBlock).toFixed(0)} mm³ of block`,
);

// --- the switch pocket: the control that did nothing in blocks mode at all.
const looser = run({ socketFitPct: 6 });
const tighter = run({ socketFitPct: -6 });
check(
  'a wider switch pocket removes material from the block',
  volOf(looser.parts, isBlock) < volOf(zero.parts, isBlock) - 1,
  `${volOf(zero.parts, isBlock).toFixed(1)} -> ${volOf(looser.parts, isBlock).toFixed(1)} mm³`,
);
check(
  'a tighter switch pocket adds material back',
  volOf(tighter.parts, isBlock) > volOf(zero.parts, isBlock) + 1,
  `${volOf(zero.parts, isBlock).toFixed(1)} -> ${volOf(tighter.parts, isBlock).toFixed(1)} mm³`,
);
check(
  'and neither touches the keycaps, which have their own fit',
  Math.abs(volOf(looser.parts, isCap) - volOf(zero.parts, isCap)) < 0.01
    && Math.abs(volOf(tighter.parts, isCap) - volOf(zero.parts, isCap)) < 0.01,
  `caps ${volOf(zero.parts, isCap).toFixed(2)} / ${volOf(looser.parts, isCap).toFixed(2)}`
  + ` / ${volOf(tighter.parts, isCap).toFixed(2)} mm³`,
);

// --- the keycap stem fit already worked here, and has to keep working.
const stemLoose = run({ stemFitPct: 6 });
check(
  'the keycap stem fit still moves the cap and not the block',
  volOf(stemLoose.parts, isCap) < volOf(zero.parts, isCap) - 0.01
    && Math.abs(volOf(stemLoose.parts, isBlock) - volOf(zero.parts, isBlock)) < 0.01,
  `cap ${volOf(zero.parts, isCap).toFixed(2)} -> ${volOf(stemLoose.parts, isCap).toFixed(2)}, `
  + `block unchanged at ${volOf(zero.parts, isBlock).toFixed(1)} mm³`,
);

// --- 0 must be exactly what shipped, or every block set anyone has made moves.
check(
  'a fit of 0 is byte-identical to no fit at all',
  volOf(run({ socketFitPct: 0 }).parts, isBlock) === volOf(zero.parts, isBlock),
  'unchanged',
);

// --- and the result has to stay printable. A shim that failed to weld would show up here.
for (const [label, out] of [['looser', looser], ['tighter', tighter]] as const) {
  const block = out.parts.find(isBlock)!;
  const edges = new Map<string, number>();
  for (let i = 0; i < block.triVerts.length; i += 3) {
    const t = [block.triVerts[i], block.triVerts[i + 1], block.triVerts[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  check(
    `${label}: the block is still one closed solid`,
    [...edges.values()].every((c) => c === 2),
    'every edge shared by exactly two faces',
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nthe fit controls move block geometry the way they move the clicker');
process.exit(failures ? 1 : 0);
