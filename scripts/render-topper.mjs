#!/usr/bin/env node
/*
  node scripts/render-topper.mjs [out-dir] [--case=name]

  Renders the pen topper headless — no browser, no WebGL — and writes orthographic
  PNGs you can actually look at.

  It exists because the geometry lives in a worker behind a WebGL canvas, and a
  canvas readback is the one thing in this stack that will lie to you: with the
  preview pane hidden the page stops compositing and the buffer you get back is
  whatever was there before. "The status line says 15.8 mm" is not the same claim as
  "the socket is where I think it is", and only one of them catches a bore that
  ended up outside the collar.

  Same code path as the app: it bundles src/geometry/harnessEntry.ts, so what is
  drawn here is what the worker builds.
*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'pen-topper');
// pnpm does not hoist, so each dependency is resolved from the workspace that
// actually declares it. manifold-3d is import-only in its exports map, which
// `require.resolve` cannot follow at all — hence the direct path for that one.
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const MANIFOLD_JS = join(APP, 'node_modules', 'manifold-3d', 'manifold.js');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(ROOT, '.render');
const only = args.find((a) => a.startsWith('--case='))?.slice(7);

const W = 520;
const H = 520;

// ---------------------------------------------------------------------------
// Bundle the real geometry, then load it
// ---------------------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
execFileSync(
  process.execPath,
  [
    rootRequire.resolve('esbuild/bin/esbuild'),
    join(APP, 'src', 'geometry', 'harnessEntry.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${bundle}`,
    '--log-level=warning',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const harness = await import(pathToFileURL(bundle).href);
const opentype = fontsRequire('opentype.js');
const Module = (await import(pathToFileURL(MANIFOLD_JS).href)).default;

const wasm = await Module();
wasm.setup();

const fontDir = join(ROOT, 'packages', 'fonts', 'src', 'fonts');
const fontCache = new Map();
const loadFont = (id) => {
  if (!fontCache.has(id)) fontCache.set(id, opentype.loadSync(join(fontDir, `${id}.ttf`)));
  return fontCache.get(id);
};

// ---------------------------------------------------------------------------
// Cases — one per thing that can go wrong
// ---------------------------------------------------------------------------
const D = harness.DEFAULT_SETTINGS;
const CASES = [
  { name: 'inset', s: {} },
  { name: 'inset-long', s: { name: 'Alexander', size: 10 } },
  { name: 'through', s: { penPath: 'through' } },
  { name: 'through-pencil', s: { penPath: 'through', pen: 'hex-pencil', barrelDia: 8.1, name: 'Maya' } },
  { name: 'collar', s: { penPath: 'collar' } },
  { name: 'collar-corner', s: { penPath: 'collar', socketAngle: -40 } },
  { name: 'inset-corner', s: { socketAngle: -40 } },
  { name: 'totem', s: { penPath: 'collar', socketAngle: 0, layout: 'vertical' } },
  { name: 'inset-totem', s: { socketAngle: 0, layout: 'vertical' } },
  { name: 'hex-loose', s: { socketAngle: 0, layout: 'vertical', pen: 'hex-pencil', barrelDia: 8.1, holeShape: 'hex', name: 'Sam', fit: 'loose', ribHeight: 0.15 } },
  { name: 'hex-none', s: { socketAngle: 0, layout: 'vertical', pen: 'hex-pencil', barrelDia: 8.1, holeShape: 'hex', name: 'Sam', ribCount: 0 } },
  { name: 'hex-totem', s: { socketAngle: 0, layout: 'vertical', pen: 'hex-pencil', barrelDia: 8.1, holeShape: 'hex', name: 'Sam' } },
  { name: 'offset-left', s: { socketOffset: -0.8 } },
  { name: 'marker-loose', s: { pen: 'marker', barrelDia: 12.7, fit: 'loose', name: 'Mo', socketDepth: 18 } },
  { name: 'two-lines', s: { name: 'MISS', secondLine: 'LEE', size: 9 } },
  { name: 'alex-done', s: { name: 'Alex', secondLine: 'Done', size: 10, socketAngle: -40 } },
  { name: 'block-plate', s: { plateShape: 'rectangle', name: 'Kim' } },
  { name: 'symbol', s: { name: '', size: 18 } },
  { name: 'engraved-3col', s: { style: 'engraved', colorScheme: 'plate-halo-text', name: 'Rio' } },
  { name: 'no-ribs', s: { ribCount: 0, name: 'Jo' } },
  // No plate: the letters are the body, grown until they can hold the bore.
  { name: 'bare-inset', s: { plateShape: 'none' } },
  { name: 'bare-through', s: { plateShape: 'none', penPath: 'through' } },
  { name: 'bare-mickey', s: { plateShape: 'none', penPath: 'through', name: 'Mickey' } },
  { name: 'bare-straw', s: { plateShape: 'none', penPath: 'through', pen: 'straw', barrelDia: 6.0, name: 'Mike' } },
  { name: 'bare-cord', s: { plateShape: 'none', penPath: 'through', pen: 'drawstring', barrelDia: 5.0, name: 'Maya' } },
  { name: 'bare-pencil', s: { plateShape: 'none', penPath: 'through', pen: 'hex-pencil', barrelDia: 8.1, name: 'Stitch' } },
  { name: 'bare-totem', s: { plateShape: 'none', socketAngle: 0, layout: 'vertical', name: 'Ivy' } },
  { name: 'bare-collar', s: { plateShape: 'none', penPath: 'collar', name: 'Kim' } },
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const report = [];
for (const c of CASES) {
  if (only && c.name !== only) continue;
  const settings = { ...D, ...c.s };
  const font = loadFont(settings.font);
  const fallback = loadFont('icon-fallback');

  const laid =
    settings.layout === 'vertical'
      ? harness.getVerticalContours(font, fallback, settings.name, settings.size, settings.lineSpacing, settings.letterSpacing)
      : harness.getHorizontalContours(
          font, fallback, settings.name, settings.secondLine, settings.size,
          settings.size * settings.line2Scale, 0, settings.line2Align,
          0.62 * settings.lineSpacing, settings.letterSpacing, { alignMode: 'block' },
        );

  const t0 = Date.now();
  const built = harness.buildTopper(wasm, laid.contours, { ...settings, lines: laid.lines });
  const ms = Date.now() - t0;

  const tris = built.parts.reduce((n, p) => n + p.indices.length / 3, 0);
  // A topper that arrives in two pieces is the failure mode with no picture: the
  // preview still looks like a name, and the bore has quietly cut it in half between
  // two letters. Count the shells in the body and say so.
  const body = built.parts.find((q) => q.name === 'plate');
  const shells = body ? countShells(body) : 0;
  report.push(
    `${c.name.padEnd(18)} ${built.size.map((v) => v.toFixed(1).padStart(5)).join(' x ')} mm  ` +
      `bore ${built.bore.toFixed(1)}  x${(built.letterScale ?? 1).toFixed(2)}  ` +
      `${String(built.parts.length)} parts  ${shells} shell${shells === 1 ? ' ' : 's'}  ` +
      `${String(tris).padStart(6)} tris  ${ms} ms` +
      (shells > 1 ? `\n${' '.repeat(20)}! body is in ${shells} pieces` : '') +
      (built.warnings.length ? `\n${' '.repeat(20)}! ${built.warnings.join('; ')}` : ''),
  );

  const views = [
    // u, v, depth: which model axis maps to screen right / up / toward the eye.
    { id: 'front', u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] },
    { id: 'side', u: [0, 0, -1], v: [0, 1, 0], w: [1, 0, 0] },
    { id: 'mouth', u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] },
    { id: 'iso', ...isoAxes() },
  ];
  for (const view of views) {
    writeFileSync(join(outDir, `${c.name}-${view.id}.png`), renderPng(built.parts, view));
  }
}

rmSync(bundle, { force: true });
console.log(`\n${report.join('\n')}\n\nWrote ${outDir}`);

/** How many separate solids a part is, by welding vertices at the same position and
 *  union-finding the triangles onto them. Manifold emits shared vertices already, but
 *  welding by coordinate is what makes this independent of that. */
function countShells(part) {
  const P = part.positions;
  const I = part.indices;
  const key = new Map();
  const rep = new Int32Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) {
    const k = `${P[v * 3].toFixed(4)},${P[v * 3 + 1].toFixed(4)},${P[v * 3 + 2].toFixed(4)}`;
    if (!key.has(k)) key.set(k, v);
    rep[v] = key.get(k);
  }
  const parent = new Int32Array(P.length / 3);
  for (let v = 0; v < parent.length; v++) parent[v] = v;
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < I.length; i += 3) {
    join(rep[I[i]], rep[I[i + 1]]);
    join(rep[I[i + 1]], rep[I[i + 2]]);
  }
  // Bounds per component, so the provenance mark's four little spherical cavities —
  // separate closed surfaces, same solid — do not read as four extra pieces.
  const box = new Map();
  for (let i = 0; i < I.length; i++) {
    const v = I[i];
    const r = find(rep[v]);
    const b = box.get(r) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const q = P[v * 3 + k];
      if (q < b[k]) b[k] = q;
      if (q > b[k + 3]) b[k + 3] = q;
    }
    box.set(r, b);
  }
  let n = 0;
  for (const b of box.values()) {
    if (Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) > 4) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// A very small orthographic rasteriser: flat-shaded, z-buffered, per-part colour.
// ---------------------------------------------------------------------------
function isoAxes() {
  // Looking down from the front-right-above, the angle a person would turn the
  // model to before saying whether it looks right.
  const a = (35 * Math.PI) / 180;
  const b = (28 * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  return {
    u: [ca, 0, -sa],
    v: [-sa * sb, cb, -ca * sb],
    w: [sa * cb, sb, ca * cb],
  };
}

function dot(a, x, y, z) {
  return a[0] * x + a[1] * y + a[2] * z;
}

function renderPng(parts, view) {
  // Bounds in view space, so every case frames itself.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i], y = p.positions[i + 1], z = p.positions[i + 2];
      const u = dot(view.u, x, y, z);
      const v = dot(view.v, x, y, z);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const pad = 24;
  const scale = Math.min((W - 2 * pad) / Math.max(maxU - minU, 0.001), (H - 2 * pad) / Math.max(maxV - minV, 0.001));
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const px = (u) => W / 2 + (u - cu) * scale;
  const py = (v) => H / 2 - (v - cv) * scale;

  const rgb = new Uint8Array(W * H * 3).fill(24);
  const zbuf = new Float64Array(W * H).fill(-Infinity);

  // Light roughly over the viewer's shoulder, so a flat face reads brighter than a
  // face turning away and the silhouette is not the only cue.
  const L = [0.35, 0.45, 0.82];
  const Ln = Math.hypot(...L);

  for (const part of parts) {
    const col = part.color;
    const P = part.positions;
    const I = part.indices;
    for (let t = 0; t < I.length; t += 3) {
      const p = [];
      for (let k = 0; k < 3; k++) {
        const o = I[t + k] * 3;
        p.push([P[o], P[o + 1], P[o + 2]]);
      }
      // Face normal in MODEL space, then lit in VIEW space.
      const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
      const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      const nu = dot(view.u, nx, ny, nz);
      const nv = dot(view.v, nx, ny, nz);
      const nw = dot(view.w, nx, ny, nz);
      if (nw <= 0) continue; // back face
      const lam = Math.max(0, (nu * L[0] + nv * L[1] + nw * L[2]) / Ln);
      const shade = 0.28 + 0.72 * lam;

      const s = p.map(([x, y, z]) => [px(dot(view.u, x, y, z)), py(dot(view.v, x, y, z)), dot(view.w, x, y, z)]);
      fillTriangle(rgb, zbuf, s, col, shade);
    }
  }
  return encodePng(rgb, W, H);
}

function fillTriangle(rgb, zbuf, s, col, shade) {
  const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
  const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
  if (Math.abs(area) < 1e-9) return;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const w0 = ((s[1][0] - cx) * (s[2][1] - cy) - (s[2][0] - cx) * (s[1][1] - cy)) / area;
      const w1 = ((s[2][0] - cx) * (s[0][1] - cy) - (s[0][0] - cx) * (s[2][1] - cy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const depth = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
      const idx = y * W + x;
      if (depth <= zbuf[idx]) continue;
      zbuf[idx] = depth;
      const o = idx * 3;
      rgb[o] = Math.min(255, col[0] * shade);
      rgb[o + 1] = Math.min(255, col[1] * shade);
      rgb[o + 2] = Math.min(255, col[2] * shade);
    }
  }
}

function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

var CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
