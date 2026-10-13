// Font metrics measured from real faces: the cap ratio agrees with the face's own table, and the
// thinnest stroke lands where a scanline by hand puts it (a text face near a tenth of its cap, a
// black face about half again, a hairline serif far thinner).
//
// Run from packages/fonts: see package.json "test". Reads the .ttf files from src/fonts directly; no
// registry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { faceMetrics } from '../src/metrics';

// Bundled into node_modules/.cache first, so the faces are found from the package folder, where
// the test script runs.
const dir = join(process.cwd(), 'src/fonts') + '/';
const face = (id: string) => opentype.parse(readFileSync(`${dir}${id}.ttf`).buffer as ArrayBuffer);

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else { fails.push(name); console.log(`FAIL ${name} ${detail}`); }
};

const expect: [string, number, number][] = [
  // id, stroke ÷ cap lower and upper bounds. Horizontal strokes count: a bar or the top of an o is
  // as hard for a nozzle as a stem, and in most faces it is the thinner of the two.
  ['montserrat', 0.06, 0.1],
  ['inter', 0.08, 0.13],
  ['roboto', 0.08, 0.13],
  ['archivo-black', 0.11, 0.17],
  ['russo-one', 0.15, 0.22],
  ['playfair-display', 0.01, 0.07],
];
for (const [id, lo, hi] of expect) {
  const m = faceMetrics(face(id));
  check(`${id} stroke`, m.stroke >= lo && m.stroke <= hi, m.stroke.toFixed(3));
  check(`${id} cap`, m.cap > 0.6 && m.cap < 0.9, m.cap.toFixed(3));
  check(`${id} x below cap`, m.xHeight > 0.3 && m.xHeight < m.cap, m.xHeight.toFixed(3));
}
const f = face('montserrat');
check('cached', faceMetrics(f) === faceMetrics(f));

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
