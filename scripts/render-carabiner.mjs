#!/usr/bin/env node
/*
  node scripts/render-carabiner.mjs [out-dir] [--case=name]

  Renders the keychain carabiner set headless — no browser, no WebGL — and writes
  orthographic PNGs you can look at, plus a one-line report per case: size, part count,
  shells per part, provenance marks landed, warnings.

  Same code path as the app: it bundles src/geometry/harnessEntry.ts, so what is drawn here
  is what the worker builds. The rasteriser is shared with render-topper.mjs by copy; if it
  changes there, change it here.
*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'keychain-carabiner');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const MANIFOLD_JS = join(APP, 'node_modules', 'manifold-3d', 'manifold.js');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-carabiner');
const only = args.find((a) => a.startsWith('--case='))?.slice(7);
/** `--parts=<regex>`: render only the parts whose name matches, filling the frame — a
 *  close-up of two chain links, say, instead of the whole set at 640 px. */
const partsRe = args.find((a) => a.startsWith('--parts='))?.slice(8);
const pick = (parts) => (partsRe ? parts.filter((p) => new RegExp(partsRe).test(p.name)) : parts);

const W = 640;
const H = 640;

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

const font = opentype.loadSync(join(ROOT, 'packages', 'fonts', 'src', 'fonts', 'icon-fallback.ttf'));
// Font Awesome codepoints, so the harness does not depend on the registry.
const GLYPH = { heart: 0xf004, star: 0xf005, paw: 0xf1b0, 'face-smile': 0xf118, bolt: 0xf0e7, crown: 0xf521, cat: 0xf6be };
const contours = (id) => {
  if (!id) return [];
  if (id.startsWith('shape:')) {
    const sh = harness.BUILTIN_SHAPES.find((x) => x.id === id.slice(6));
    return sh ? [sh.ring.map(([x, y]) => [x * 100, y * 100])] : [];
  }
  const glyph = font.charToGlyph(String.fromCodePoint(GLYPH[id] ?? GLYPH.heart));
  return harness.pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands);
};
const shape = (id) => {
  const s = harness.BUILTIN_SHAPES.find((x) => x.id === id);
  if (!s) throw new Error(`no shape ${id}`);
  return { ring: s.ring, gate: s.gate, eye: s.eye, top: s.top };
};

const D = harness.DEFAULT_SETTINGS;
const CASES = [
  { name: 'default', s: {} },
  { name: 'round-edge', s: { edge: 'round' } },
  { name: 'plain-loop', s: { attach: 'loop' } },
  { name: 'no-loop', s: { attach: 'none' } },
  { name: 'no-loop-heart', s: { attach: 'none', hookShape: 'heart' } },
  { name: 'with-charm', s: { charm: true } },
  { name: 'swivel-charm', s: { charm: true, charmMount: 'swivel' } },
  { name: 'engraved-cat', s: { charm: true, charmShape: 'star', charmIcon: 'cat', charmIconStyle: 'engrave', linkCount: 1 } },
  { name: 'raised-cat', s: { charm: true, charmShape: 'star', charmIcon: 'cat', charmIconStyle: 'raise', linkCount: 1 } },
  { name: 'cut-cat', s: { charm: true, charmShape: 'star', charmIcon: 'cat', charmIconStyle: 'cut', linkCount: 1 } },
  { name: 'star-links', s: { linkShape: 'star', linkCount: 2, linkSize: 24, linkBar: 2.4 } },
  { name: 'star-links-small', s: { linkShape: 'star', linkCount: 2 } },
  { name: 'heart-links', s: { linkShape: 'heart', linkCount: 2, linkSize: 22, linkBar: 2.6 } },
  { name: 'heart-hook', s: { hookShape: 'heart', icon: '' } },
  { name: 'heart-star', s: { charm: true, hookShape: 'heart', linkShape: 'star', charmShape: 'heart', icon: 'star', charmIcon: 'heart' } },
  { name: 'teardrop', s: { charm: true, charmMount: 'swivel', hookShape: 'teardrop', charmShape: 'flower', icon: '', linkCount: 0 } },
  { name: 'star-hook', s: { charm: true, hookShape: 'star', linkShape: 'heart', charmShape: 'star', charmFill: 'frame' } },
  { name: 'no-icon', s: { icon: '', charmIcon: '' } },
  { name: 'thin', s: { hookThick: 3, charmThick: 3, linkThick: 3, hookBar: 2.5, linkBar: 2 } },
  { name: 'tiny', s: { hookSize: 25, linkSize: 10, charmSize: 12, iconSize: 4 } },
  { name: 'huge', s: { hookSize: 70, linkSize: 40, charmSize: 50, iconSize: 20, hookBar: 6, linkBar: 5, linkCount: 12 } },
  { name: 'fat-bar', s: { hookBar: 6, hookSize: 25, linkBar: 5, linkSize: 10 } },
  { name: 'icon-out', s: { iconOffset: 5 } },
  { name: 'icon-in', s: { iconOffset: -5 } },
  { name: 'icon-top', s: { iconAngle: 90 } },
  { name: 'icon-raised', s: { iconRaise: 2, iconRotate: 30 } },
  { name: 'swivel-stem-4', s: { swivelStem: 4, hookThick: 7, mode: 'pip' } },
  { name: 'swivel-stem-clamped', s: { swivelStem: 5 } },
  // Print in place: the links come out interlocked, so each case also runs the clearance
  // probe below — consecutive links must not touch, even shifted by half a millimetre.
  { name: 'pip-default', s: { mode: 'pip' } },
  { name: 'pip-round', s: { mode: 'pip', pipLinkAspect: 'round', pipLinkSize: 20 } },
  { name: 'pip-long', s: { mode: 'pip', pipLinkAspect: 'long', pipLinkSize: 32 } },
  { name: 'pip-round-edge', s: { mode: 'pip', edge: 'round' } },
  { name: 'pip-swivel-loop', s: { mode: 'pip', attach: 'loop' } },
  { name: 'pip-none', s: { mode: 'pip', attach: 'none' } },
  { name: 'pip-charm', s: { mode: 'pip', charm: true } },
  { name: 'pip-charm-direct', s: { mode: 'pip', charm: true, pipConnectorRings: 0 } },
  { name: 'pip-loop-only', s: { mode: 'pip', pipLinkCount: 0 } },
  { name: 'pip-many', s: { mode: 'pip', pipLinkCount: 12 } },
  { name: 'pip-thin-hook', s: { mode: 'pip', hookThick: 4 } },
  { name: 'pip-thick-hook', s: { mode: 'pip', hookThick: 7 } },
  { name: 'pip-thick-links', s: { mode: 'pip', pipLinkThick: 8, pipLinkSize: 26, attach: 'loop' } },
  { name: 'pip-thin-links', s: { mode: 'pip', pipLinkThick: 4, attach: 'loop' } },
  { name: 'pip-separate', s: { mode: 'pip', pipAttached: false } },
  { name: 'pip-cuban', s: { mode: 'pip', pipLinkAspect: 'cuban', pipLinkBar: 3.9 } },
  { name: 'pip-root-loop', s: { mode: 'pip', pipRoot: 'loop' } },
  { name: 'pip-root-loop-plain', s: { mode: 'pip', pipRoot: 'loop', attach: 'loop' } },
  { name: 'pip-separate-none', s: { mode: 'pip', pipAttached: false, attach: 'none', charm: true } },
  { name: 'pip-fat-bar', s: { mode: 'pip', pipLinkBar: 4, pipLinkSize: 20 } },
  { name: 'pip-tiny', s: { mode: 'pip', pipLinkSize: 10 } },
  { name: 'pip-heart-hook', s: { mode: 'pip', hookShape: 'heart' } },
  { name: 'pip-star-hook', s: { mode: 'pip', hookShape: 'star' } },
  { name: 'every-shape-hook', s: { linkCount: 0 }, sweep: 'hookShape' },
  { name: 'every-shape-link', s: { linkCount: 1 }, sweep: 'linkShape' },
  { name: 'every-shape-charm', s: { charm: true, linkCount: 0 }, sweep: 'charmShape' },
];

const PLATE = [256, 256];
const report = [];
for (const c of CASES) {
  if (only && c.name !== only) continue;
  const variants = c.sweep ? harness.BUILTIN_SHAPES.map((s) => ({ name: `${c.name}-${s.id}`, s: { ...c.s, [c.sweep]: s.id } })) : [c];
  for (const v of variants) {
    const settings = { ...D, ...v.s };
    const params = {
      ...settings,
      hookGeom: shape(settings.hookShape),
      linkGeom: shape(settings.linkShape),
      charmGeom: shape(settings.charmShape),
      iconContours: contours(settings.icon),
      charmIconContours: contours(settings.charmIcon),
      plate: PLATE,
    };
    const t0 = Date.now();
    let built;
    try {
      built = harness.buildSet(wasm, params);
    } catch (err) {
      report.push(`${v.name.padEnd(28)} !! THREW ${err.message}`);
      continue;
    }
    const ms = Date.now() - t0;
    const tris = built.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    // The icon is an inlay: it replaces band material, so where it crosses the band the hook
    // is two arcs held together by the icon — real two-colour behaviour, reported but not a
    // failure. Everything else, the icon included, must be exactly one piece.
    const hasIcon = built.parts.some((p) => p.name === 'Symbol');
    const counted = built.parts.map((p) => ({ name: p.name, part: p, n: countShells(p) }));
    const shells = counted.map((c) => `${c.name.replace(/ \d+$/, '')}:${c.n}`);
    const bad = counted.filter((c) => c.n !== 1 && !(c.name === 'Hook' && hasIcon && c.n <= 3)).map((c) => c.name);
    void mergeParts;
    const clearance = settings.mode === 'pip' ? pipClearance(built.parts) : [];
    report.push(
      `${v.name.padEnd(28)} ${built.size.map((n) => n.toFixed(0).padStart(4)).join(' x ')} mm  ` +
        `${String(built.parts.length).padStart(2)} parts  marks ${built.marks}  ${String(tris).padStart(6)} tris  ${String(ms).padStart(4)} ms` +
        (bad.length ? `\n${' '.repeat(30)}! not one shell: ${[...new Set(shells)].join(' ')}` : '') +
        (clearance.length ? `\n${' '.repeat(30)}! ${clearance.join('; ')}` : '') +
        (built.warnings.length ? `\n${' '.repeat(30)}! ${built.warnings.join('; ')}` : ''),
    );
    if (process.env.ASM) for (const q of built.assembled) { let b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]; for (let i=0;i<q.positions.length;i+=3) for (let k=0;k<3;k++){ const t=q.positions[i+k]; if(t<b[k])b[k]=t; if(t>b[k+3])b[k+3]=t; } console.log(v.name, q.name.padEnd(12), b.map((n)=>n.toFixed(1).padStart(6)).join(' ')); }
    if (!c.sweep || only) {
      writeFileSync(join(outDir, `${v.name}-assembled.png`), renderPng(pick(built.assembled), { id: 'iso', ...isoAxes() }));
      for (const view of [{ id: 'top', u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, { id: 'iso', ...isoAxes() }]) {
        writeFileSync(join(outDir, `${v.name}-${view.id}.png`), renderPng(pick(built.parts), view));
      }
    } else {
      writeFileSync(join(outDir, `${v.name}-top.png`), renderPng(built.parts, { id: 'top', u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }));
    }
  }
}

rmSync(bundle, { force: true });
console.log(`\n${report.join('\n')}\n\nWrote ${outDir}`);

/**
 * The print-in-place chain's one real question: do the interlocked pieces touch? Each pair
 * that should be free of each other — the hook (with its loop, or the swivel ring) and link 1,
 * then every link and the next — is loaded back into Manifold and intersected as printed and
 * shifted 0.5 mm along each axis, both ways. A non-zero volume anywhere is a fuse.
 */
function pipClearance(parts) {
  const solidOf = (p) => {
    const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(p.positions), triVerts: new Uint32Array(p.indices) });
    mesh.merge();
    return wasm.Manifold.ofMesh(mesh);
  };
  const links = parts.filter((p) => /^Link \d+$/.test(p.name)).sort((a, b) => parseInt(a.name.slice(5)) - parseInt(b.name.slice(5)));
  const first = parts.find((p) => p.name === 'Swivel ring') ?? parts.find((p) => p.name === 'Hook');
  const chain = [first, ...links].filter(Boolean);
  const problems = [];
  const solids = chain.map(solidOf);
  for (let i = 0; i < solids.length; i++) {
    if (solids[i].status() !== 'NoError' || solids[i].volume() <= 0) problems.push(`${chain[i].name}: not a solid (${solids[i].status()})`);
  }
  // The shift is a first-layer squish budget: 0.2 mm a side is the worst the guides report,
  // so 0.45 of room in every direction means a fused pair takes more than that to happen.
  // (The chain's own slack when pulled is a different number — the bridge wall's corner
  // meets the neighbour's hole edge after ~0.5 mm — and is by design.)
  const SHIFT = 0.45;
  const moves = [[0, 0, 0], [SHIFT, 0, 0], [-SHIFT, 0, 0], [0, SHIFT, 0], [0, -SHIFT, 0], [0, 0, SHIFT], [0, 0, -SHIFT]];
  for (let i = 0; i + 1 < solids.length; i++) {
    for (const mv of moves) {
      const moved = solids[i + 1].translate(mv);
      const inter = solids[i].intersect(moved);
      const vol = inter.volume();
      moved.delete();
      if (vol > 1e-6) {
        const bb = inter.boundingBox();
        const where = process.env.WHERE ? ` at [${bb.min.map((n) => n.toFixed(2))}]..[${bb.max.map((n) => n.toFixed(2))}]` : '';
        problems.push(`${chain[i].name} ∩ ${chain[i + 1].name} shifted [${mv.join(',')}] = ${vol.toFixed(2)} mm³${where}`);
        inter.delete();
        break;
      }
      inter.delete();
    }
  }
  // Links two apart must not touch either — a long link reaching past its neighbour would.
  for (let i = 0; i + 2 < solids.length; i++) {
    const vol = solids[i].intersect(solids[i + 2]).volume();
    if (vol > 1e-6) problems.push(`${chain[i].name} ∩ ${chain[i + 2].name} = ${vol.toFixed(2)} mm³`);
  }
  for (const s of solids) s.delete();
  return problems;
}

/** Several parts as one, so shared faces weld and the pieces count as one body. */
function mergeParts(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.positions.length; ni += p.indices.length; }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    positions.set(p.positions, ov);
    for (let i = 0; i < p.indices.length; i++) indices[oi + i] = p.indices[i] + ov / 3;
    ov += p.positions.length;
    oi += p.indices.length;
  }
  return { name: 'merged', positions, indices, color: [0, 0, 0] };
}

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
  const big = [];
  for (const b of box.values()) {
    if (Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) > 4) { n++; big.push(b.map((v) => v.toFixed(1)).join(',')); }
  }
  if (n > 1 && process.env.SHELLS) console.log(part.name, big);
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
