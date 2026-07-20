// Headless geometry harness for the name keychain.
// Bundles the real buildProfiles with esbuild, runs it against real fonts +
// manifold WASM, and dumps an SVG of the 2D plate/halo/text profiles plus
// numeric diagnostics — so the reported bugs can be verified without the WebGL
// preview (which can't screenshot in this environment).
//
// Usage: node scripts/harness.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const esbuildPath = 'C:/Users/ianku/Desktop/cursor projects/vostok-labs-tools/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
const { build } = await import('file://' + esbuildPath);
import opentype from 'opentype.js';
import Module from 'manifold-3d';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const outDir = resolve(process.env.NK_OUT || 'C:/Users/ianku/AppData/Local/Temp/claude/C--Users-ianku-Desktop-cursor-projects-generators-galore/c46bea2c-ba75-4249-befa-5d9111fc2200/scratchpad/nk');
mkdirSync(outDir, { recursive: true });

// --- Bundle the TS geometry to a temp mjs and import it ---
const bundlePath = resolve(outDir, 'geom.mjs');
await build({
  entryPoints: [resolve(appDir, 'src/geometry/harnessEntry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'warning',
});
const geom = await import('file://' + bundlePath.replace(/\\/g, '/'));
const { buildProfiles, buildKeychain, getHorizontalContours, getVerticalContours, noAmsPauses } = geom;

// --- Manifold ---
const wasm = await Module({ wasmBinary: readFileSync(resolve(appDir, 'node_modules/manifold-3d/manifold.wasm')) });
wasm.setup();

// --- Fonts ---
const fontCache = new Map();
function font(id) {
  if (!fontCache.has(id)) fontCache.set(id, opentype.loadSync(resolve(appDir, `src/fonts/${id}.ttf`)));
  return fontCache.get(id);
}

function baseFactor(id) {
  if (id === 'vt323' || id === 'press-start-2p') return 0.44;
  if (id === 'creepster') return 0.55;
  return 0.62;
}

function defaults(over = {}) {
  return {
    name: 'Name', secondLine: '', font: 'luckiest-guy',
    layout: 'horizontal', style: 'raised', size: 18, line2Scale: 1.0,
    baseThickness: 2.0, textThickness: 1.6, outlineWidth: 2.5, smoothing: 2.0,
    ringStyle: 'loop', holeDia: 4.0, ringThickness: 2.2, ringPosX: 0, ringPosY: 0,
    haloWidth: 1.2, haloThickness: 0.8,
    colorScheme: 'plate-halo-text', plateColor: '#1d2027', haloColor: '#5b9dff', textColor: '#f2f4f8',
    plateShape: 'outline', lineSpacing: 1.0, letterSpacing: 0, boldness: 0, chamfer: 0.4,
    printMode: 'ams', layerHeight: 0.2, lines: [],
    line2Align: 'center',
    ...over,
  };
}

function layoutFor(s) {
  const f = font(s.font);
  const gap = 2 * (s.holeDia / 2 + s.ringThickness) + 2;
  const line2Sz = s.size * s.line2Scale;
  if (s.layout === 'vertical') {
    return getVerticalContours(f, s.name, s.size, s.lineSpacing, s.letterSpacing);
  }
  const factor = baseFactor(s.font) * s.lineSpacing;
  return getHorizontalContours(f, s.name, s.secondLine, s.size, line2Sz, gap, s.line2Align, factor, s.letterSpacing);
}

function keepFactory() {
  const created = [];
  const keep = (m) => { created.push(m); return m; };
  keep._dispose = () => { for (const m of created) { try { m.delete(); } catch {} } };
  return keep;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function polysToPath(polys, flipY, minX, maxY) {
  return polys.map((poly) => {
    const d = poly.map((pt, i) => `${i === 0 ? 'M' : 'L'}${(pt[0] - minX).toFixed(2)},${((flipY ? maxY - pt[1] : pt[1])).toFixed(2)}`).join(' ');
    return d + ' Z';
  }).join(' ');
}

function svgFor(name, layers, box) {
  const pad = 6;
  const minX = box.min[0] - pad, maxX = box.max[0] + pad, minY = box.min[1] - pad, maxY = box.max[1] + pad;
  const w = (maxX - minX), h = (maxY - minY);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${(w * 4).toFixed(0)}" height="${(h * 4).toFixed(0)}" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}"><rect width="100%" height="100%" fill="#15171c"/>`];
  for (const L of layers) {
    if (!L.cs) continue;
    const polys = L.cs.toPolygons();
    const d = polysToPath(polys, true, minX, maxY);
    parts.push(`<path d="${d}" fill="${L.fill}" fill-opacity="${L.op}" fill-rule="evenodd" stroke="${L.stroke}" stroke-width="0.3"/>`);
  }
  parts.push('</svg>');
  writeFileSync(resolve(outDir, name + '.svg'), parts.join(''));
}

function pointInPolys(polys, x, y) {
  // even-odd rule across all contours
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function asciiRaster(layers, box, cols = 96) {
  const pad = 3;
  const minX = box.min[0] - pad, maxX = box.max[0] + pad, minY = box.min[1] - pad, maxY = box.max[1] + pad;
  const w = maxX - minX, h = maxY - minY;
  const rows = Math.max(8, Math.round((cols * h) / w / 2)); // /2 for char aspect
  const cache = layers.map((L) => (L.cs ? L.cs.toPolygons() : null));
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    const y = maxY - ((r + 0.5) / rows) * h;
    for (let c = 0; c < cols; c++) {
      const x = minX + ((c + 0.5) / cols) * w;
      let ch = ' ';
      for (let li = 0; li < layers.length; li++) {
        if (cache[li] && pointInPolys(cache[li], x, y)) ch = layers[li].ch;
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function diag(label, s) {
  const lay = layoutFor(s);
  s.lines = lay.lines;
  const keep = keepFactory();
  const p = buildProfiles(wasm, lay.contours, s, keep);

  // Count holes in plate & halo (negative-area loops).
  const platePolys = p.plateNoHole.toPolygons();
  const plateHoles = platePolys.filter((poly) => signedArea(poly) < 0).length;
  const plateOuters = platePolys.filter((poly) => signedArea(poly) > 0).length;
  const haloHoles = p.haloCS ? p.haloCS.toPolygons().filter((poly) => signedArea(poly) < 0).length : 0;

  // Does the keyring hole overlap the text? (bad — hole punched through a letter)
  const holeCircle = keep(wasm.CrossSection.circle(p.holeR, 24).translate([p.holeX, p.holeY]));
  const overlapText = keep(holeCircle.intersect(p.textCS)).area();

  // plate area & whether it's a single connected blob
  const plateArea = p.plateNoHole.area();

  const b = p.plateBounds;
  svgFor(label, [
    { cs: p.plateNoHole, fill: '#8a929e', op: 1, stroke: '#5b6470' },
    { cs: p.haloCS, fill: '#5b9dff', op: 0.9, stroke: '#3b7de0' },
    { cs: p.textCS, fill: '#f2f4f8', op: 1, stroke: '#c9ccd2' },
    { cs: holeCircle, fill: '#15171c', op: 1, stroke: '#ff5a5a' },
  ], b);

  console.log(`\n### ${label}`);
  console.log(`  plate: outers=${plateOuters} holes=${plateHoles} area=${plateArea.toFixed(1)}   ${plateOuters > 1 ? '❌ DISCONNECTED (' + plateOuters + ' pieces)' : 'connected'}`);
  console.log(`  halo:  holes=${haloHoles}`);
  console.log(`  hole@(${p.holeX.toFixed(1)},${p.holeY.toFixed(1)}) overlapsText=${overlapText.toFixed(2)}mm²  ${overlapText > 0.5 ? '❌ HOLE ON LETTER' : 'ok'}`);
  console.log(`  plate bbox: [${b.min[0].toFixed(1)},${b.min[1].toFixed(1)}]..[${b.max[0].toFixed(1)},${b.max[1].toFixed(1)}]`);
  if (plateHoles > 0) console.log('  ⚠️  plate has trapped holes');
  if (process.env.NK_ASCII) {
    console.log(asciiRaster([
      { cs: p.plateNoHole, ch: '·' },
      { cs: p.haloCS, ch: ':' },
      { cs: p.textCS, ch: '#' },
      { cs: holeCircle, ch: 'O' },
    ], b));
  }
  keep._dispose();
}

// --- Montage proof (several cases in one labelled SVG) ---
function cellSvg(label, s, cellW, cellH) {
  const lay = layoutFor(s);
  s.lines = lay.lines;
  const keep = keepFactory();
  const p = buildProfiles(wasm, lay.contours, s, keep);
  const holeCircle = keep(wasm.CrossSection.circle(p.holeR, 24).translate([p.holeX, p.holeY]));
  const layers = [
    { cs: p.plateNoHole, fill: '#8a929e', op: 1, stroke: '#5b6470' },
    { cs: p.haloCS, fill: '#5b9dff', op: 0.9, stroke: '#3b7de0' },
    { cs: p.textCS, fill: '#f2f4f8', op: 1, stroke: '#c9ccd2' },
    { cs: holeCircle, fill: '#15171c', op: 1, stroke: '#ff5a5a' },
  ];
  const b = p.plateBounds;
  const pad = 5;
  const minX = b.min[0] - pad, maxX = b.max[0] + pad, minY = b.min[1] - pad, maxY = b.max[1] + pad;
  const gw = maxX - minX, gh = maxY - minY;
  const scale = Math.min((cellW - 12) / gw, (cellH - 34) / gh);
  const ox = (cellW - gw * scale) / 2;
  const oy = 26 + (cellH - 34 - gh * scale) / 2;
  let g = `<g transform="translate(${ox},${oy}) scale(${scale})">`;
  for (const L of layers) {
    if (!L.cs) continue;
    const d = polysToPath(L.cs.toPolygons(), true, minX, maxY);
    g += `<path d="${d}" fill="${L.fill}" fill-opacity="${L.op}" fill-rule="evenodd" stroke="${L.stroke}" stroke-width="${0.4 / scale}"/>`;
  }
  g += '</g>';
  const cap = `<text x="8" y="16" fill="#cdd3dc" font-family="system-ui,sans-serif" font-size="12" font-weight="600">${label}</text>`;
  keep._dispose();
  return cap + g;
}

function montage() {
  const cases = [
    ['Outline · short 2nd line (hugs, no dead space)', defaults({ name: 'NAme', secondLine: 'Tes' })],
    ['Rectangle · short 2nd line', defaults({ name: 'NAme', secondLine: 'Tes', plateShape: 'rectangle' })],
    ['Outline · 2nd line right-aligned', defaults({ name: 'NAME', secondLine: 'TES', line2Align: 'right' })],
    ['Rectangle · single line', defaults({ name: 'Name', plateShape: 'rectangle' })],
    ['Outline · vertical', defaults({ name: 'NAme', layout: 'vertical' })],
    ['Rectangle · vertical', defaults({ name: 'Max', layout: 'vertical', plateShape: 'rectangle' })],
  ];
  const cols = 3, cw = 300, ch = 220, gap = 8, headH = 40;
  const rows = Math.ceil(cases.length / cols);
  const W = cols * cw + (cols + 1) * gap;
  const H = headH + rows * ch + (rows + 1) * gap;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#0f1115"/>`;
  svg += `<text x="${gap}" y="26" fill="#f2f4f8" font-family="system-ui,sans-serif" font-size="17" font-weight="700">Name Keychain — plate shapes &amp; tighter loop (top-down: plate · halo · text · keyring hole)</text>`;
  cases.forEach(([label, s], i) => {
    const cx = gap + (i % cols) * (cw + gap);
    const cy = headH + gap + Math.floor(i / cols) * (ch + gap);
    svg += `<g transform="translate(${cx},${cy})"><rect width="${cw}" height="${ch}" rx="8" fill="#15171c" stroke="#2b303a"/>${cellSvg(label, s, cw, ch)}</g>`;
  });
  svg += '</svg>';
  writeFileSync(resolve(outDir, 'proof.svg'), svg);
  console.log('Montage → ' + resolve(outDir, 'proof.svg'));
}
montage();

// --- Cases ---
diag('01_single', defaults({ name: 'Name' }));
diag('02_two_lines', defaults({ name: 'Name', secondLine: 'Surname', line2Align: 'center' }));
diag('03_long_second', defaults({ name: 'NAME', secondLine: 'SURNAME', line2Align: 'center' }));
diag('04_short_second', defaults({ name: 'NAme', secondLine: 'Tes', line2Align: 'center' }));
diag('05_right_align', defaults({ name: 'NAME', secondLine: 'TES', line2Align: 'right' }));
diag('06_vertical', defaults({ name: 'NAme', layout: 'vertical' }));
diag('07_corner', defaults({ name: 'Name', secondLine: 'Surname', ringStyle: 'corner' }));
diag('08_thinfont', defaults({ name: 'Amelia', secondLine: 'Jones', font: 'dancing-script' }));
diag('09_bold_track', defaults({ name: 'Name', boldness: 0.4, letterSpacing: 0.15 }));
diag('10_noams', defaults({ name: 'Name', secondLine: 'Tag', printMode: 'noams', baseThickness: 1.9, haloThickness: 0.7 }));
diag('11_rect_1line', defaults({ name: 'Name', plateShape: 'rectangle' }));
diag('12_rect_2line', defaults({ name: 'NAme', secondLine: 'Tes', plateShape: 'rectangle' }));
diag('13_rect_vertical', defaults({ name: 'Max', layout: 'vertical', plateShape: 'rectangle' }));
diag('14_outline_shortcentre', defaults({ name: 'NAme', secondLine: 'Tes', line2Align: 'center' }));

// --- 3D smoke test: chamfer both modes must yield valid, non-empty solids ---
console.log('\n=== 3D build (chamfer on/off) ===');
function build3d(label, s) {
  const lay = layoutFor(s);
  s.lines = lay.lines;
  const t0 = performance.now();
  let out;
  for (let i = 0; i < 5; i++) out = buildKeychain(wasm, lay.contours, s);
  const ms = (performance.now() - t0) / 5;
  const { parts, warnings } = out;
  s.__ms = ms;
  const info = parts.map((pt) => {
    const nv = pt.vertProperties.length / 3;
    const nt = pt.triVerts.length / 3;
    return `${pt.name}(v${nv},t${nt})`;
  }).join(' ');
  const ok = parts.length > 0 && parts.every((pt) => pt.vertProperties.length > 0 && pt.triVerts.length > 0);
  console.log(`  ${label}: ${ok ? '✅' : '❌'} ${ms.toFixed(0)}ms ${parts.length} parts  ${info}${warnings.length ? '  ⚠️ ' + warnings.join('; ') : ''}`);
}
build3d('raised+chamfer', defaults({ name: 'Name', secondLine: 'Tag', chamfer: 0.5 }));
build3d('raised+nochamfer', defaults({ name: 'Name', secondLine: 'Tag', chamfer: 0 }));
build3d('single-line+chamfer', defaults({ name: 'Name', chamfer: 0.5 }));
build3d('single-line+nochamfer', defaults({ name: 'Name', chamfer: 0 }));
build3d('longname+chamfer', defaults({ name: 'Alexander', chamfer: 0.5 }));
build3d('vertical+chamfer', defaults({ name: 'Max', layout: 'vertical', chamfer: 0.5 }));
build3d('engraved+chamfer', defaults({ name: 'Name', style: 'engraved', chamfer: 0.5 }));
build3d('bigchamfer', defaults({ name: 'Name', chamfer: 1.0, textThickness: 1.6 }));
build3d('thin-strokes+chamfer', defaults({ name: 'Amelia', font: 'dancing-script', chamfer: 0.5 }));

const nap = noAmsPauses(defaults({ name: 'Name', secondLine: 'Tag', printMode: 'noams', baseThickness: 1.9, haloThickness: 0.7 }));
console.log('  no-AMS pauses:', nap.map((x) => `Z=${x.z.toFixed(1)}→${x.label}`).join(', '));

console.log('\nSVGs →', outDir);
