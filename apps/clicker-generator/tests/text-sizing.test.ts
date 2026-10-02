/*
  Text-mode sizing, measured on the built geometry rather than on the slider value.

  The rule the UI promises is one sentence: spacing and Text size grow the CLICKER, they never
  shrink the letters. That is easy to write and easy to lose — the natural implementation of
  "wider word, same footprint" is exactly the bug the user reported, letters quietly getting
  smaller to fit a fixed base. A slider readout cannot tell those apart, so this measures the
  printed letter height and the printed base width separately.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/text-sizing.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/clicker-generator/.text-size-test.mjs \
      && node apps/clicker-generator/.text-size-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import { parseLetter } from '../src/image/letter.ts';
import type { BuildParams, BuildRegion } from '../src/types.ts';

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
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  const out = solid.translate([-cx, -cy, dropTopToZero ? -bb.max[2] : 0]);
  solid.delete();
  return out;
}

const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

const SIZE_MM = 45; // clear of the switch-fit clamp, so the numbers are the ones asked for

/** Build one text clicker the way mount.ts does, and report what actually got printed. */
function measure(opts: { lineSpacing?: number; letterSpacing?: number; textScale?: number } = {}) {
  const rs = parseLetter('Custom\nText', 'helvetiker-regular', 15, false, {
    lineSpacing: opts.lineSpacing,
    letterSpacing: opts.letterSpacing,
  });
  const regions: BuildRegion[] = rs.regions.map((r, i) => ({
    filamentRgb: r.quantRgb,
    coverage: r.coverage,
    rings: r.components[0].rings,
    partName: `top-color-${i}-0`,
  }));
  // The two multipliers under test, exactly as `buildParamsFor` composes them on an
  // outline base — where the letters ARE the shape.
  const capWidthMm = SIZE_MM * (rs.sizeMul ?? 1) * (opts.textScale ?? 1);
  const params: BuildParams = {
    baseShape: 'outline', capWidthMm, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2.5,
    borderWidth: 3.5, capProud: 1.2, tolerance: 0.4, stemFitPct: 0, socketFitPct: 0,
    imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
    floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
    keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
    componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
  };
  const { parts } = buildClicker(wasm, socket, stem, regions, rs.outline, params);

  const ext = (pred: (name: string) => boolean) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of parts) {
      if (!pred(p.name)) continue;
      const v = p.vertProperties, n = p.numProp;
      for (let i = 0; i < v.length; i += n) {
        if (v[i] < minX) minX = v[i];
        if (v[i] > maxX) maxX = v[i];
        if (v[i + 1] < minY) minY = v[i + 1];
        if (v[i + 1] > maxY) maxY = v[i + 1];
      }
    }
    return { w: maxX - minX, h: maxY - minY };
  };
  // The letter inlay is the printed text; the body is the whole clicker.
  return { text: ext((n) => n.startsWith('top-color-')), body: ext((n) => n === 'base-body') };
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const base = measure();

// --- Letter spacing: the word gets wider, the letters keep their height.
const tracked = measure({ letterSpacing: 0.3 });
check(
  'letter spacing widens the clicker',
  tracked.body.w > base.body.w * 1.05,
  `body ${base.body.w.toFixed(1)} -> ${tracked.body.w.toFixed(1)} mm`,
);
check(
  'letter spacing does not shrink the letters',
  tracked.text.h > base.text.h * 0.97,
  `letter height ${base.text.h.toFixed(2)} -> ${tracked.text.h.toFixed(2)} mm`,
);

// --- Line spacing: the same promise on the other axis.
const leaded = measure({ lineSpacing: 1.6 });
check(
  'line spacing makes the clicker taller',
  leaded.body.h > base.body.h * 1.05,
  `body ${base.body.h.toFixed(1)} -> ${leaded.body.h.toFixed(1)} mm`,
);
check(
  'line spacing does not shrink the letters',
  leaded.text.w > base.text.w * 0.97,
  `text width ${base.text.w.toFixed(2)} -> ${leaded.text.w.toFixed(2)} mm`,
);

// --- Text size: bigger letters AND a bigger clicker, which is the whole point of the knob.
const bigger = measure({ textScale: 1.5 });
check(
  'text size 150% prints bigger letters',
  bigger.text.h > base.text.h * 1.4,
  `letter height ${base.text.h.toFixed(2)} -> ${bigger.text.h.toFixed(2)} mm`,
);
check(
  'text size 150% grows the clicker with them',
  bigger.body.w > base.body.w * 1.35,
  `body ${base.body.w.toFixed(1)} -> ${bigger.body.w.toFixed(1)} mm`,
);

console.log(failures === 0 ? '\nAll text sizing checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
