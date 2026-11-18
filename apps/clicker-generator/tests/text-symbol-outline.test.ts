/*
  A symbol in a line of Text mode prints as the library draws it.

  Real library drawings are traced the way the symbol picker traces them (`traceSvgSymbol` in
  src/ui/symbols.ts, the same reader call), laid out at the end of a line (src/image/letter.ts) and
  built into a clicker on the outline base Text mode starts on, with the build parameters
  `buildParamsFor` sends for Text mode. The symbol's printed outline is then cut from the built
  part half way up and laid over the drawing as the library has it, flattened finely and grown by
  the colour bleed and the boldness, at the printed size. The largest distance between the two
  must stay under a small share of the symbol's size, and a heart must still be a mirror image of
  itself.

  The frame used to cut the artwork to the outline it is grown round. A symbol at the end of a
  line then lost its bleed and boldness on its outer side only, so one lobe of a heart printed
  thinner than the other (by 0.15 mm, and by half a millimetre with some boldness), and that edge
  followed the frame's coarser outline instead of the drawing.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs text-symbol-outline
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { readModel } from '@vostok/export/read';
import { csOf, ringsOf } from '@vostok/manifold';
import { parseSvg } from '@vostok/trace';
import catalog from '../../../packages/ui-kit/src/symbols/catalog.json';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import { parseLetter } from '../src/image/letter.ts';
import { normaliseRings, PLAIN_LOOK } from '../src/image/symbolRings.ts';
import type { BuildParams, BuildRegion, Ring } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const ROOT = process.cwd();
const APP = join(ROOT, 'apps/clicker-generator');

const wasm: any = await Module();
wasm.setup();

/** An MX asset as a solid, centred the way the geometry worker centres it. */
function assetSolid(path: string, dropTopToZero: boolean) {
  const b = readFileSync(join(APP, 'public/assets', path));
  const raw = readModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, path);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const out = solid.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, dropTopToZero ? -bb.max[2] : 0]);
  solid.delete();
  return out;
}
const socket = assetSolid('switch/mx/mx-socket.3mf', true);
const stem = assetSolid('switch/mx/mx-stem.3mf', false);

/* ------------------------------------------------------------------------------ the drawings */

/** A library drawing as the symbol picker traces it: `traceSvgSymbol`'s reader call. */
function traced(svg: string): Ring[] {
  return normaliseRings(parseSvg(svg.replace(/currentColor/gi, '#000000'), { removeBg: false, asPainted: true }).outline as Ring[]);
}

/** A library SVG's filled shapes, every curve in 128 pieces or more, Y up. */
function svgDrawing(svg: string): Ring[] {
  const data = new SVGLoader().parse(svg.replace(/currentColor/gi, '#000000'));
  const rings: Ring[] = [];
  for (const path of data.paths as any[]) {
    for (const shape of SVGLoader.createShapes(path)) {
      rings.push(shape.getPoints(128).map((p: any) => [p.x, -p.y] as [number, number]));
      for (const hole of shape.holes) rings.push(hole.getPoints(128).map((p: any) => [p.x, -p.y] as [number, number]));
    }
  }
  return rings;
}

/* ------------------------------------------------------------------------------ distances */

const box = (rings: Ring[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};

/** The largest distance from a point on `a`'s outline (walked in steps of `step`) to `b`'s. */
function farthest(a: Ring[], b: Ring[], step: number): number {
  let worst = 0;
  for (const r of a) for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i]!, [bx, by] = r[(i + 1) % r.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) {
      const px = ax + ((bx - ax) * k) / n, py = ay + ((by - ay) * k) / n;
      let best = Infinity;
      for (const s of b) for (let j = 0; j < s.length && best > worst; j++) {
        const [qx, qy] = s[j]!, [sx, sy] = s[(j + 1) % s.length]!;
        const dx = sx - qx, dy = sy - qy, len = dx * dx + dy * dy;
        const t = len > 0 ? Math.max(0, Math.min(1, ((px - qx) * dx + (py - qy) * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(px - qx - t * dx, py - qy - t * dy));
      }
      if (best > worst) worst = best;
    }
  }
  return worst;
}
/** Both ways round: how far the two outlines are apart at their worst. */
const apart = (a: Ring[], b: Ring[], step: number) => Math.max(farthest(a, b, step), farthest(b, a, step));

/* ------------------------------------------------------------------------------ the builds */

const SYMBOL = '\u{F0001}';
const LINE = 'Love you Emma';
const BLEED = 0.12;

/** What `buildParamsFor` sends for Text mode on its outline base. */
function textParams(textBold: number): BuildParams {
  return {
    baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2.5,
    borderWidth: 3.5, capProud: 4.0, hollowBase: false, designScale: 1, tolerance: 0.4, stemFitMm: 0,
    socketFitPct: 0, imageOffset: { x: 0, y: 0 }, colorBleed: BLEED, stepHeight: 0.6, travel: 4.0,
    floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
    keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    baseFilamentRgb: [120, 124, 130], bodyColorRgb: [240, 240, 240], componentHeights: {},
    edgeSettings: [
      { target: 'capTop', style: 'chamfer', radius: 0.5 },
      { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
    ],
    extrudeChamfer: false, textBold, artCutNote: 'Letters past the edge are cut off.', outlineUncut: true,
  };
}

/**
 * The symbol at the end of a line, built: its printed outline half way up its inlay, and the
 * library's drawing placed where the line put the symbol and grown by the bleed and boldness,
 * both in millimetres on the cap. `size` is the symbol's longest side as printed.
 */
function printed(svg: string, textBold: number) {
  const rings = traced(svg);
  const rs = parseLetter(`${LINE}${SYMBOL}`, 'helvetiker-regular', 15, false, {}, { [SYMBOL]: { rings, look: PLAIN_LOOK } });
  // The symbol is the last glyph of the line, so its rings are the outline's last.
  const placed = rs.outline.slice(-rings.length) as Ring[];
  // The line moves and scales the traced rings, nothing else: find that from two of their points.
  const a0 = rings[0]![0]!, a1 = rings[0]![Math.floor(rings[0]!.length / 2)]!;
  const b0 = placed[0]![0]!, b1 = placed[0]![Math.floor(placed[0]!.length / 2)]!;
  const k = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) / Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
  const regions: BuildRegion[] = rs.regions.map((r, i) => ({
    filamentRgb: [247, 247, 245], coverage: r.coverage, rings: r.components[0]!.rings, partName: `top-color-${i}-0`,
  }));
  const built = buildClicker(wasm, socket, stem, regions, rs.outline, textParams(textBold));
  const { scale, offX, offY, rotation } = built.layout.art;
  const turn = (rotation * Math.PI) / 180;
  const onCap = ([x, y]: [number, number]): [number, number] => {
    const lx = x * k + b0[0] - a0[0] * k, ly = y * k + b0[1] - a0[1] * k;
    return [(lx * Math.cos(turn) - ly * Math.sin(turn)) * scale + offX, (lx * Math.sin(turn) + ly * Math.cos(turn)) * scale + offY];
  };
  const drawn = normaliseRings(svgDrawing(svg)).map((r) => r.map(onCap));
  const db = box(drawn);
  const size = Math.max(db.x1 - db.x0, db.y1 - db.y0);
  const shape = csOf(wasm, drawn, 'NonZero');
  const grownCs = shape.offset(BLEED + textBold, 'Round', 2.0, 360);
  const expected = ringsOf(grownCs);
  shape.delete();
  grownCs.delete();

  // The letters' part, cut half way up its inlay; the symbol's rings are the ones in its box.
  const part = built.parts.find((p) => p.name === 'top-color-0-0')!;
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 2; i < part.vertProperties.length; i += part.numProp) {
    z0 = Math.min(z0, part.vertProperties[i]!);
    z1 = Math.max(z1, part.vertProperties[i]!);
  }
  const mesh = new wasm.Mesh({ numProp: part.numProp, vertProperties: part.vertProperties, triVerts: part.triVerts });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const cut = solid.slice((z0 + z1) / 2);
  const eb = box(expected);
  const margin = 0.3;
  const got = (ringsOf(cut) as Ring[]).filter((r) => {
    const b = box([r]);
    return b.x0 > eb.x0 - margin && b.x1 < eb.x1 + margin && b.y0 > eb.y0 - margin && b.y1 < eb.y1 + margin;
  });
  cut.delete();
  solid.delete();
  return { size, got, expected, mid: (db.x0 + db.x1) / 2 };
}

/** The largest distance allowed between the library's outline and the printed one, as a share of
 *  the symbol's size: 1 %, 0.08 mm on an 8 mm symbol, a fifth of a nozzle. What is left is the
 *  build's 0.03 mm simplification of every outline. */
const MAX_SHARE = 0.01;

const svgOf = (id: string): string => {
  const item = (catalog as { id: string; svg: string }[]).find((c) => c.id === id);
  if (!item) throw new Error(`no library symbol ${id}`);
  return item.svg;
};
const CASES: { name: string; id: string; mirror?: boolean; bold?: number }[] = [
  { name: 'heart', id: 'tabler-heart', mirror: true },
  { name: 'gift', id: 'tabler-gift' },
  { name: 'star', id: 'tabler-star' },
  { name: 'butterfly', id: 'tabler-butterfly' },
  { name: 'heart, made bolder', id: 'tabler-heart', mirror: true, bold: 0.3 },
];

for (const c of CASES) {
  const p = printed(svgOf(c.id), c.bold ?? 0);
  const step = p.size / 1000;
  check(`${c.name}: printed where the line puts it`, p.got.length > 0, `${p.got.length} outline${p.got.length === 1 ? '' : 's'}`);
  const d = apart(p.got, p.expected, step);
  check(
    `${c.name}: the printed outline is the library's drawing`,
    d <= MAX_SHARE * p.size,
    `${d.toFixed(3)} mm apart at most, ${((d / p.size) * 100).toFixed(2)} % of its ${p.size.toFixed(1)} mm`,
  );
  if (c.mirror) {
    const flip = (rings: Ring[]) => rings.map((r) => r.map(([x, y]) => [2 * p.mid - x, y] as [number, number]));
    const own = apart(p.expected, flip(p.expected), step);
    const built = apart(p.got, flip(p.got), step);
    check(
      `${c.name}: its two sides alike, as drawn`,
      built <= own + 0.005 * p.size,
      `mirrored onto itself ${built.toFixed(3)} mm apart, the drawing ${own.toFixed(3)} mm`,
    );
  }
}

if (failures) {
  console.error(`\ntext-symbol-outline: ${failures} failed`);
  process.exit(1);
}
console.log('\ntext-symbol-outline: all passed');
