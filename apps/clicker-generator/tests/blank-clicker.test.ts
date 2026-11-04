/*
  A clicker printed blank: built without its picture, on the outline the picture gives it.

  mount.ts sends a blank the outline as it is and no colour regions, only the words placed on it
  (`BuildRegion.mm`), with `blank: true`; a blank block set sends every key with no rings. So:

   - an irregular outline (as a trace gives one) and a preset shape each build exactly the top and
     the body, and with a word on them the word's own part too, every one a closed solid;
   - the top and the body are the size of the same design built with its picture, to 0.01 mm:
     leaving the picture off does not move the base;
   - a blank says nothing about a picture that is not there: no notes and nothing refusing the
     export, not even where the same design with its picture is told it was scaled down to a
     locked size, or that a plain patch shows on it;
   - a blank block set builds every key's cap, none with a letter in it, and no note.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs blank-clicker
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { readModel } from '@vostok/export/read';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import { buildBlocks } from '../src/geometry/buildBlocks.ts';
import type { BuildParams, BuildRegion, ClickerPart, Ring } from '../src/types.ts';

const wasm: any = await Module();
wasm.setup();

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ the worker's assets */

const asset = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = readModel(buf, 'asset.3mf');
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
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
const keycapJson = JSON.parse(readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets/keycap.json'), 'utf-8'));
const keycap = { shell: { positions: keycapJson.positions, indices: keycapJson.indices }, stem: keycapJson.stem ?? null, meta: keycapJson.meta };

/* ------------------------------------------------------------------ designs */

/** The app's own defaults, from mount.ts's store and buildParamsFor, for a picture. */
const DEFAULTS: BuildParams = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [20, 40, 110], bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
};

/** An irregular silhouette, centred with its longest side 1, as the tracer hands one back: a
 *  round body with a lobe and a dent, nothing a preset shape would make. */
const BLOB: Ring = (() => {
  const n = 96;
  const pts: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = 1 + 0.18 * Math.cos(2 * a) + 0.08 * Math.sin(3 * a) - 0.06 * Math.cos(5 * a);
    pts.push([r * Math.cos(a), r * Math.sin(a) * 0.9]);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = 1 / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return pts.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as [number, number]);
})();
const rect = (cx: number, cy: number, w: number, h: number): Ring =>
  [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
/** The picture on it: the whole silhouette in one colour, a spot in another. */
const PICTURE: BuildRegion[] = [
  { filamentRgb: [20, 40, 110], coverage: 0.9, rings: [BLOB], partName: 'top-color-0-0' },
  { filamentRgb: [240, 120, 20], coverage: 0.1, rings: [rect(0.1, 0.1, 0.2, 0.2)], partName: 'top-color-1-0' },
];
/** A word as the main thread sends one: an H in cap millimetres, 1.2 mm strokes, under the middle. */
const WORD: BuildRegion = {
  filamentRgb: [240, 240, 240], coverage: 0, partName: 'text-a', mm: true,
  rings: [rect(-1.8, -9, 1.2, 6), rect(1.8, -9, 1.2, 6), rect(0, -9, 3.6, 1.2)],
};

const build = (regions: BuildRegion[], over: Partial<BuildParams> = {}) =>
  buildClicker(wasm, socket, stem, regions, [BLOB], { ...DEFAULTS, ...over });

/* ------------------------------------------------------------------ measuring */

const partNamed = (parts: ClickerPart[], name: string) => parts.find((p) => p.name === name);
const boxOf = (p: ClickerPart | undefined) => {
  if (!p) return null;
  const v = p.vertProperties;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < v.length; i += p.numProp) {
    minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
    minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
  }
  return { minX, minY, maxX, maxY };
};
/** The two boxes agree on every side to `tol` mm. */
const sameBox = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>, tol = 0.01) =>
  !!a && !!b && (['minX', 'minY', 'maxX', 'maxY'] as const).every((k) => Math.abs(a[k] - b[k]) <= tol);
const showBox = (b: ReturnType<typeof boxOf>) =>
  (b ? `${(b.maxX - b.minX).toFixed(3)} × ${(b.maxY - b.minY).toFixed(3)} mm` : 'none');
/** Every edge shared by exactly two triangles, and manifold takes it as one solid. */
const closedSolid = (p: ClickerPart): boolean => {
  const edges = new Map<string, number>();
  const t = p.triVerts;
  for (let i = 0; i < t.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t[i + e], b = t[i + ((e + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  if (![...edges.values()].every((c) => c === 2)) return false;
  const mesh = new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts });
  mesh.merge();
  try {
    const s = wasm.Manifold.ofMesh(mesh);
    const ok = s.status() === 'NoError' && !s.isEmpty();
    s.delete();
    return ok;
  } catch {
    return false;
  }
};
const names = (parts: ClickerPart[]) => parts.map((p) => p.name).join(', ');
const said = (out: { warnings: string[]; blocking?: string[] }) =>
  [...(out.blocking ?? []), ...out.warnings].join(' · ') || 'nothing';

/* ------------------------------------------------------------------ the two bases */

for (const baseShape of ['outline', 'circle'] as const) {
  const what = baseShape === 'outline' ? 'a traced outline' : 'a circle';
  const withPicture = build([...PICTURE], { baseShape });
  const blank = build([], { baseShape, blank: true });
  check(`${what}, blank: exactly the top and the body`, names(blank.parts) === 'top-base, base-body', names(blank.parts));
  check('…both closed solids', blank.parts.every(closedSolid), names(blank.parts.filter((p) => !closedSolid(p))) || 'all closed');
  const capP = boxOf(partNamed(withPicture.parts, 'top-base'));
  const capB = boxOf(partNamed(blank.parts, 'top-base'));
  check('…the top the size of the same design with its picture, to 0.01 mm', sameBox(capP, capB), `${showBox(capB)}, with the picture ${showBox(capP)}`);
  const bodyP = boxOf(partNamed(withPicture.parts, 'base-body'));
  const bodyB = boxOf(partNamed(blank.parts, 'base-body'));
  check('…and the body too', sameBox(bodyP, bodyB), `${showBox(bodyB)}, with the picture ${showBox(bodyP)}`);
  check('…and nothing said, nothing refused', blank.warnings.length === 0 && blank.blocking.length === 0, said(blank));

  const worded = build([WORD], { baseShape, blank: true });
  check(`${what}, blank with a word: the top, the word and the body`, names(worded.parts) === 'top-base, text-a, base-body', names(worded.parts));
  check('…all closed solids, nothing said', worded.parts.every(closedSolid) && worded.warnings.length === 0 && worded.blocking.length === 0,
    `${worded.parts.filter(closedSolid).length} of ${worded.parts.length} closed; ${said(worded)}`);
  const pictured = build([...PICTURE, WORD], { baseShape });
  check('…the size the same design with its picture and the word is', sameBox(boxOf(partNamed(worded.parts, 'top-base')), boxOf(partNamed(pictured.parts, 'top-base'))),
    `${showBox(boxOf(partNamed(worded.parts, 'top-base')))}, with the picture ${showBox(boxOf(partNamed(pictured.parts, 'top-base')))}`);
}

/* ------------------------------------------------------------------ notes about a picture */

{
  // A locked size smaller than the design asks for: the picture is scaled down to fit, and told.
  const over = { baseShape: 'circle' as const, capWidthMm: 60, bodySize: { w: 34, h: 34 } };
  const withPicture = build([...PICTURE], over);
  const blank = build([], { ...over, blank: true });
  check('a locked base size: the design with its picture is told it was scaled down',
    withPicture.warnings.some((w) => w.startsWith('Design scaled down')), said(withPicture));
  check('…a blank is not, having no design', blank.warnings.length === 0, said(blank));
  check('…and is the same size', sameBox(boxOf(partNamed(blank.parts, 'top-base')), boxOf(partNamed(withPicture.parts, 'top-base'))),
    showBox(boxOf(partNamed(blank.parts, 'top-base'))));
}

{
  // A switch pushed to the edge of a circle: the top is widened round it, a patch of the base colour.
  const over = { baseShape: 'circle' as const, switches: [{ x: 40, y: 40, rotation: 0 }] };
  const withPicture = build([...PICTURE], over);
  const blank = build([], { ...over, blank: true });
  const patch = (out: { warnings: string[] }) => out.warnings.some((w) => w.includes('plain patch'));
  check('a switch at the edge: the design with its picture is told a plain patch shows on it', patch(withPicture), said(withPicture));
  check('…a blank, plain all over, is not', !patch(blank) && blank.blocking.length === 0, said(blank));
  check('…and its parts are still closed solids', blank.parts.every(closedSolid), names(blank.parts));
}

/* ------------------------------------------------------------------ letter blocks */

{
  const square = (s: number): Ring => [[-s, -s], [s, -s], [s, s], [-s, s]];
  const letters: BuildRegion[] = [0, 1, 2].map((k) => ({ filamentRgb: [22, 22, 22], coverage: 1, rings: [square(0.3)], partName: `top-color-${k}-0` }));
  const blankKeys: BuildRegion[] = letters.map((r) => ({ ...r, rings: [] }));
  const over = {
    imageMargin: 2.5, borderWidth: 3.5, blockOrientation: 'horizontal', blockKeys: [true, true, true],
    legendScale: 1, legendBold: 0, keychainEnd: 'left', baseFilamentRgb: [22, 22, 22], bodyColorRgb: [240, 240, 240],
  } as Partial<BuildParams>;
  const lettered = buildBlocks(wasm, socket, keycap as never, letters, { ...DEFAULTS, ...over });
  const blank = buildBlocks(wasm, socket, keycap as never, blankKeys, { ...DEFAULTS, ...over, blank: true });
  const caps = (parts: ClickerPart[]) => parts.filter((p) => /^cap-\d+$/.test(p.name));
  check('blocks with their letters: a cap and a letter per key', caps(lettered.parts).length === 3 && lettered.parts.some((p) => p.name.startsWith('top-color-')), names(lettered.parts));
  check('blank blocks: every key\'s cap, none with a letter', caps(blank.parts).length === 3 && !blank.parts.some((p) => p.name.startsWith('top-color-')), names(blank.parts));
  check('…the caps where the lettered set has them, closed solids', caps(blank.parts).every((p, i) => closedSolid(p) && sameBox(boxOf(p), boxOf(caps(lettered.parts)[i]), 0.01)),
    caps(blank.parts).map((p) => showBox(boxOf(p))).join(', '));
  check('…and nothing said', blank.warnings.length === 0, said(blank));
}

socket.delete();
stem.delete();
console.log(failures ? `\n${failures} FAILED` : '\na blank keeps its shape and size, and says nothing about a picture');
process.exit(failures ? 1 : 0);
