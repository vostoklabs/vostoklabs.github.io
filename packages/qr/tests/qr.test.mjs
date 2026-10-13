// @vostok/qr held to the encoder: every style draws the same grid, the finders survive, the
// islands keep the winding contract (outer anticlockwise, holes clockwise), a cleared centre
// costs what it says, and the payloads escape what they must.
//
// Run: node packages/qr/tests/qr.test.mjs   (esbuild bundles the TS source). No browser.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const tmp = `${here}.cache`;
mkdirSync(tmp, { recursive: true });
const outfile = `${tmp}/qr-${process.pid}.mjs`;
await build({ entryPoints: [`${here}../src/index.ts`], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const Q = await import(pathToFileURL(outfile).href);
const qrcode = createRequire(`${here}../package.json`)('qrcode-generator');

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  if (!ok) console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
};

const area = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inked = (shapes, p) => shapes.some((island) => inRing(p, island[0]) && !island.slice(1).some((h) => inRing(p, h)));

const CONTENTS = ['https://example.com', 'HELLO', 'A much longer piece of text that needs a bigger version of the code, 0123456789'];
for (const content of CONTENTS) {
  for (const level of ['L', 'M', 'Q', 'H']) {
    const ref = qrcode(0, level);
    ref.addData(content);
    ref.make();
    const n = ref.getModuleCount();
    check(`modules ${content.slice(0, 12)} ${level}`, Q.qrModules(content, level) === n);
    for (const style of ['square', 'rounded', 'dots', 'finder']) {
      const size = n * 1.0;
      const g = Q.qrShapes(content, size, level, { style });
      const tag = `${style} ${content.slice(0, 12)} ${level}`;
      check(`cell ${tag}`, Math.abs(g.cell - 1) < 1e-9);
      // Every dark module's centre is inked, every light one's is not. Round finders are round
      // by design, so the finder blocks are read by their own check below for that style.
      const finderCell = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
      let wrong = 0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (style === 'finder' && finderCell(r, c)) continue;
          const p = [-size / 2 + (c + 0.5) * g.cell, size / 2 - (r + 0.5) * g.cell];
          if (inked(g.shapes, p) !== ref.isDark(r, c)) wrong++;
        }
      }
      check(`grid ${tag}`, wrong === 0, `${wrong} modules disagree`);
      if (style === 'finder') {
        // Each round finder: its centre inked, the light ring round it empty, the dark ring inked.
        for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
          const cx = -size / 2 + (c0 + 3.5) * g.cell;
          const cy = size / 2 - (r0 + 3.5) * g.cell;
          const at = (d) => inked(g.shapes, [cx + d * g.cell, cy]);
          check(`round finder ${tag} ${r0},${c0}`, at(0) && !at(2) && at(3));
        }
      }
      // Winding: outer anticlockwise, holes clockwise.
      const bad = g.shapes.filter((island) => area(island[0]) <= 0 || island.slice(1).some((h) => area(h) >= 0)).length;
      check(`winding ${tag}`, bad === 0, `${bad} islands`);
      // Inside the module square.
      const out = g.shapes.flat(2).filter(([x, y]) => Math.abs(x) > size / 2 + 1e-9 || Math.abs(y) > size / 2 + 1e-9).length;
      check(`inside ${tag}`, out === 0);
    }
  }
}

// A cleared centre: whole modules, odd, centred, at most 9 % of the code, never a finder.
const big = Q.qrShapes('https://example.com/a/longer/path', 33, 'H', { logo: 0.5 });
check('clear capped', big.lost <= 0.09 + 1e-9, String(big.lost));
check('clear odd', big.clearModules % 2 === big.modules % 2);
check('logo inside clear', big.logoMm > 0 && big.logoMm < big.clearMm);
check('centre empty', !inked(big.shapes, [0, 0]));

// The minimum size keeps the floor.
check('min size', Math.abs(Q.qrMinSize('HELLO', 'M', 0.8) - Q.qrModules('HELLO', 'M') * 0.8) < 1e-9);

// Payloads.
const wifi = Q.qrPayload('wifi', { ssid: "Bob's;Cafe", password: 'a:b' });
check('wifi escape', wifi === "WIFI:T:WPA;S:Bob's\\;Cafe;P:a\\:b;;", wifi);
const vcard = Q.qrPayload('contact', { name: 'Ada Lovelace', phone: '+44 1', email: 'ada@x.org', org: 'Engines, Ltd', title: '', url: 'https://x.org' });
check('vcard', vcard === 'BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada;;;\nFN:Ada Lovelace\nORG:Engines\\, Ltd\nTEL:+44 1\nEMAIL:ada@x.org\nURL:https://x.org\nEND:VCARD', vcard);
check('link trims', Q.qrPayload('link', { text: '  https://x.org ' }) === 'https://x.org');
let threw = false;
try { Q.qrShapes('', 10, 'M'); } catch { threw = true; }
check('empty refuses', threw);

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
