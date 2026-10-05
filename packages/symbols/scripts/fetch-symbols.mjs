#!/usr/bin/env node
/*
  pnpm --filter @vostok/symbols fetch-symbols              the two drawn sets, then Material's flags
  pnpm --filter @vostok/symbols fetch-symbols --material   Material's flags only (no network)

  Writes the library's data:

    data/tabler-icons-filled.json             the Tabler names, labels, groups, search words
    data/tabler-icons-filled.outlines.json    their outlines (loaded only when one is drawn)
    data/fluent-emoji-high-contrast.json      the same for Fluent Emoji, High Contrast style
    data/fluent-emoji-high-contrast.outlines.json
    data/tabler-icons.LICENSE.txt, data/fluent-emoji.LICENSE.txt   read from upstream at the pin
    src/material-solid.ts                     which Material glyphs print as one solid blob

  Every file comes from a pinned commit, so a re-run gives the same bytes, and the lists below
  are hand-picked and append-only: a symbol a saved design names never disappears. `pnpm
  gen:assets` then describes the data files, and `pnpm check:assets` holds them to that row.

  An outline is stored clean. Each SVG's paths are filled by their own rule and then unioned
  (a white path painted on top is cut out), in manifold, so what is stored is the drawing's real
  silhouette: islands that never overlap, holes inside their island. The 3D apps extrude it and
  the laser apps cut it as it is, with no fill rule left to guess.

  Material Symbols stays in @vostok/fonts, the font the text engine already reads; this only
  measures its glyphs. `src/material-solid.ts` records the font's sha256 and the test fails when
  the font changes until this runs again.
*/

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const pkg = `${here}..`;
const MATERIAL_ONLY = process.argv.includes('--material');

const TABLER = { repo: 'tabler/tabler-icons', commit: 'bbed884d15354b5cebf2493371f20dc2d5e83eaf', tag: 'v3.49.0' };
const FLUENT = { repo: 'microsoft/fluentui-emoji', commit: '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc' };

/*
  The picks, each with the picker group it goes in (the group ids of @vostok/fonts'
  SYMBOL_GROUPS). Append only. The first 52 Fluent and first 23 Tabler entries are the set the
  kit's catalog has carried since 2026-09-19, byte for byte the same files.
*/
const FLUENT_PICKS = [
  ['Grinning face', 'smileys'], ['Beaming face with smiling eyes', 'smileys'], ['Face with tears of joy', 'smileys'],
  ['Smiling face with heart-eyes', 'smileys'], ['Smiling face with sunglasses', 'smileys'], ['Winking face', 'smileys'],
  ['Thinking face', 'smileys'], ['Face blowing a kiss', 'smileys'], ['Sleeping face', 'smileys'], ['Nerd face', 'smileys'],
  ['Partying face', 'smileys'], ['Star-struck', 'smileys'], ['Face savoring food', 'smileys'], ['Zany face', 'smileys'],
  ['Upside-down face', 'smileys'], ['Pleading face', 'smileys'], ['Smiling face with smiling eyes', 'smileys'],
  ['Grinning cat', 'smileys'], ['Cat face', 'animals'], ['Dog face', 'animals'], ['Fox', 'animals'], ['Bear', 'animals'],
  ['Panda', 'animals'], ['Koala', 'animals'], ['Tiger face', 'animals'], ['Lion', 'animals'], ['Rabbit face', 'animals'],
  ['Unicorn', 'animals'], ['Butterfly', 'animals'], ['Owl', 'animals'], ['Penguin', 'animals'], ['Frog', 'animals'],
  ['Octopus', 'animals'], ['Dolphin', 'animals'], ['Turtle', 'animals'], ['Paw prints', 'animals'], ['Rose', 'nature'],
  ['Sunflower', 'nature'], ['Christmas tree', 'holidays'], ['Jack-o-lantern', 'holidays'], ['Snowman', 'holidays'],
  ['Birthday cake', 'holidays'], ['Pizza', 'food'], ['Strawberry', 'food'], ['Cherries', 'food'], ['Rocket', 'travel'],
  ['Rainbow', 'nature'], ['Fire', 'nature'], ['Sparkles', 'shapes'], ['Crown', 'shapes'], ['Skull', 'shapes'],
  ['Red heart', 'shapes'],
  // 2026-10-05: what Name Keychain's old symbol list asked for and no other set has.
  ['Slightly smiling face', 'smileys'], ['Grinning squinting face', 'smileys'], ['Pile of poo', 'smileys'],
  ['Black cat', 'animals'], ['Dog', 'animals'], ['Horse', 'animals'], ['Dragon', 'animals'], ['Fish', 'animals'],
  ['Spider', 'animals'], ['Honeybee', 'animals'], ['Seedling', 'nature'], ['Comet', 'nature'], ['Guitar', 'music'],
  ['Ring', 'shapes'], ['Bomb', 'shapes'], ['Victory hand', 'people'],
];

const TABLER_PICKS = [
  ['heart', 'shapes'], ['star', 'shapes'], ['paw', 'animals'], ['butterfly', 'animals'], ['flower', 'nature'],
  ['moon', 'nature'], ['sun', 'nature'], ['bolt', 'shapes'], ['diamond', 'shapes'], ['crown', 'shapes'],
  ['cherry', 'food'], ['clover', 'nature'], ['christmas-tree', 'holidays'], ['gift', 'holidays'], ['guitar-pick', 'music'],
  ['mickey', 'shapes'], ['ghost', 'holidays'], ['mood-happy', 'smileys'], ['mood-smile', 'smileys'], ['rosette', 'shapes'],
  ['puzzle', 'sport'], ['leaf', 'nature'], ['flame', 'nature'],
  // 2026-10-05: twins for the clicker's and keycap's Lucide shortlists the Material set lacks.
  ['arrow-big-up', 'shapes'], ['arrow-big-down', 'shapes'], ['arrow-big-left', 'shapes'], ['arrow-big-right', 'shapes'],
  ['caret-up', 'shapes'], ['caret-down', 'shapes'], ['player-play', 'music'], ['player-pause', 'music'],
  ['player-skip-back', 'music'], ['player-skip-forward', 'music'], ['keyboard', 'tech'], ['battery-4', 'tech'],
  // Fluent draws Yin yang inside a square frame; this one stands on its own.
  ['yin-yang', 'shapes'],
];

const raw = (repo, commit, path) => `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
async function get(url, asJson = false) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url);
    if (r.ok) return asJson ? r.json() : r.text();
    if (attempt >= 2 || r.status === 404) throw new Error(`${r.status} ${url}`);
  }
}

// The library's own code does the encoding and the measuring, so the data and the runtime agree.
const tmp = `${pkg}/node_modules/.cache`;
mkdirSync(tmp, { recursive: true });
const entry = `${tmp}/fetch-entry.ts`;
writeFileSync(entry, `export { encodeOutline, decodeOutline, toSymbolFrame } from '${pkg}/src/outline.ts';\nexport { isSolidShape } from '${pkg}/src/solid.ts';\nexport { glyphShapes } from '${pkg}/src/glyph.ts';\n`);
await build({ entryPoints: [entry], outfile: `${tmp}/fetch-lib.mjs`, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(`${pathToFileURL(`${tmp}/fetch-lib.mjs`).href}?t=${Date.now()}`);

/** The index file: its head as ordinary JSON, then one symbol to a line, so a pick added later
 *  is a one-line diff. */
function indexJson(head, fields, rows) {
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  return `${top},\n  "fields": ${JSON.stringify(fields)},\n  "symbols": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`;
}

if (!MATERIAL_ONLY) await drawnSets();
await materialFlags();

// ───────────────────────────── Tabler and Fluent ─────────────────────────────

async function drawnSets() {
  const requireLaser = createRequire(`${pkg}/../laser/package.json`);
  const Module = (await import(pathToFileURL(requireLaser.resolve('manifold-3d/manifold.js')).href)).default;
  const wasm = await Module();
  wasm.setup();

  const tree = await get(`https://api.github.com/repos/${FLUENT.repo}/git/trees/${FLUENT.commit}?recursive=1`, true);
  if (tree.truncated) throw new Error('the Fluent tree came back truncated');
  const fluentSvg = (folder) => tree.tree.find((x) => x.path.startsWith(`assets/${folder}/`) && x.path.includes('/High Contrast/') && x.path.endsWith('.svg'))?.path;

  const sets = [
    {
      file: 'fluent-emoji-high-contrast', set: 'fluent', label: 'Fluent Emoji', source: FLUENT, licenceFile: 'fluent-emoji.LICENSE.txt',
      picks: FLUENT_PICKS,
      async read([folder]) {
        const path = fluentSvg(folder);
        if (!path) throw new Error(`Fluent has no High Contrast drawing for "${folder}"`);
        const meta = await get(raw(FLUENT.repo, FLUENT.commit, `assets/${folder}/metadata.json`), true);
        return { name: slug(folder), label: folder, svg: await get(raw(FLUENT.repo, FLUENT.commit, path)), words: [meta.cldr, ...(meta.keywords ?? [])] };
      },
    },
    {
      file: 'tabler-icons-filled', set: 'tabler', label: 'Tabler Icons', source: TABLER, licenceFile: 'tabler-icons.LICENSE.txt',
      picks: TABLER_PICKS,
      async read([name]) {
        const svg = await get(raw(TABLER.repo, TABLER.commit, `icons/filled/${name}.svg`));
        // Search words live on the outline drawing of the same name.
        const outline = await get(raw(TABLER.repo, TABLER.commit, `icons/outline/${name}.svg`)).catch(() => '');
        const tags = outline.match(/^tags:\s*\[([^\]]*)\]/m)?.[1].split(',').map((t) => t.trim()) ?? [];
        const category = outline.match(/^category:\s*(.+)$/m)?.[1].trim();
        return { name, label: name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), svg, words: [...tags, category] };
      },
    },
  ];

  for (const s of sets) {
    const rows = [];
    const outlines = {};
    for (const pick of s.picks) {
      const it = await s.read(pick);
      const shapes = lib.toSymbolFrame(silhouette(wasm, it.svg, it.label));
      const d = lib.encodeOutline(simplify(shapes, 0.0005));
      if (!d) throw new Error(`${s.set}:${it.name} has nothing to draw`);
      const back = lib.decodeOutline(d);
      outlines[it.name] = d;
      rows.push([it.name, it.label, pick[1], terms(it.label, it.words), lib.isSolidShape(back) ? 1 : 0]);
    }
    const licence = await get(raw(s.source.repo, s.source.commit, 'LICENSE'));
    writeFileSync(`${pkg}/data/${s.licenceFile}`, licence);
    const head = {
      $comment: 'Written by packages/symbols/scripts/fetch-symbols.mjs from the pinned commit below; do not edit by hand.',
      licence: 'MIT',
      set: s.set,
      label: s.label,
      source: { repo: s.source.repo, commit: s.source.commit, ...(s.source.tag ? { tag: s.source.tag } : {}) },
    };
    writeFileSync(`${pkg}/data/${s.file}.json`, indexJson(head, ['name', 'label', 'group', 'terms', 'solid'], rows));
    writeFileSync(`${pkg}/data/${s.file}.outlines.json`, `${JSON.stringify({ licence: 'MIT', box: 1000, outlines }, null, 0)}\n`);
    console.log(`${s.file}: ${rows.length} symbols, ${rows.filter((r) => r[4]).length} solid, outlines ${JSON.stringify(outlines).length} bytes`);
  }
}

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Search words beyond the label: lower case, each once. */
function terms(label, words) {
  const own = new Set(label.toLowerCase().split(/[^a-z0-9]+/));
  const out = [];
  for (const w of words.filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9-]+/)) {
    if (w && !own.has(w) && !out.includes(w)) out.push(w);
  }
  return out.join(' ');
}

/** An SVG's filled silhouette, in its own units with Y up: each element filled by its rule,
 *  dark paint unioned and white paint cut out, in document order. */
function silhouette(wasm, svg, what) {
  const view = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!view) throw new Error(`${what}: no viewBox`);
  const tol = 0.00035 * Math.max(view[2], view[3]);
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*>/, '');
  const rootFill = body.match(/<svg\b[^>]*\sfill="([^"]+)"/)?.[1];
  let acc = null;
  for (const m of body.matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
    const [, tag, attrs] = m;
    if (tag === 'svg' || tag === 'title' || tag === 'desc') continue;
    if (!['path', 'circle', 'ellipse', 'rect'].includes(tag)) throw new Error(`${what}: unhandled <${tag}>`);
    if (/\btransform=|\bclip-path=|\bmask=|\bopacity=/.test(attrs)) throw new Error(`${what}: unhandled attribute on <${tag}>`);
    const a = (n) => attrs.match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];
    const fill = (a('fill') ?? (rootFill === 'none' ? undefined : rootFill) ?? 'black').toLowerCase();
    if (fill === 'none') continue;
    const white = /^(#fff(fff)?|white)$/.test(fill);
    if (!white && !/^(#212121|currentcolor|black|#000(000)?)$/.test(fill)) throw new Error(`${what}: unexpected fill ${fill}`);
    let rings;
    if (tag === 'path') rings = pathRings(a('d') ?? '', tol);
    else if (tag === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(a(k) ?? 0));
      if (a('rx') || a('ry')) throw new Error(`${what}: rounded <rect>`);
      rings = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
    } else {
      const cx = Number(a('cx') ?? 0), cy = Number(a('cy') ?? 0);
      const rx = Number(a('rx') ?? a('r')), ry = Number(a('ry') ?? a('r'));
      const n = Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / Math.max(rx, ry)))));
      rings = [Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)])];
    }
    const up = rings.map((r) => r.map(([x, y]) => [x, -y]));
    // One-shot node process: the glue's per-call leak (see @vostok/manifold) dies with it.
    const cs = new wasm.CrossSection(up, a('fill-rule') === 'evenodd' ? 'EvenOdd' : 'NonZero');
    acc = acc ? (white ? acc.subtract(cs) : acc.add(cs)) : white ? null : cs;
  }
  if (!acc) return [];
  return acc.decompose().map((part) => {
    const rings = part.toPolygons().map((r) => r.map((p) => [p[0], p[1]]));
    const areas = rings.map((r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)));
    const outer = areas.indexOf(Math.max(...areas));
    return [rings[outer], ...rings.filter((_, i) => i !== outer)];
  });
}

/** Ramer–Douglas–Peucker on every ring of the shapes, `tol` in the symbol frame. */
function simplify(shapes, tol) {
  const ring = (r) => {
    if (r.length < 5) return r;
    let far = 0, fd = -1;
    for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(r.length);
    keep[0] = keep[far] = 1;
    const pts = [...r, r[0]];
    const stack = [[0, far], [far, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const [ax, ay] = pts[s], [bx, by] = pts[e];
      const L = Math.hypot(bx - ax, by - ay) || 1e-12;
      let best = -1, bd = tol;
      for (let i = s + 1; i < e; i++) {
        const dist = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        if (dist > bd) { bd = dist; best = i; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
    }
    return r.filter((_, i) => keep[i]);
  };
  return shapes.map((island) => island.map(ring));
}

// SVG path data → rings, curves flattened to within `tol`.
function pathRings(d, tol) {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings = [];
  let i = 0, cmd = '', prev = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, cur = null;
  const num = () => Number(toks[i++]);
  const close = () => { if (cur && cur.length > 2) rings.push(cur); cur = null; };
  const flag = () => { // arc flags may be written without separators ("a1 1 0 01 2 2")
    const t = toks[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) { toks[i] = t.slice(1); return Number(t[0]); }
    return num();
  };
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C !== 'M' && C !== 'Z' && !cur) cur = [[x, y]];
    if (C === 'M') { close(); x = num() + ox; y = num() + oy; sx = x; sy = y; cur = [[x, y]]; cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { x = num() + ox; y = num() + oy; cur.push([x, y]); }
    else if (C === 'H') { x = num() + ox; cur.push([x, y]); }
    else if (C === 'V') { y = num() + oy; cur.push([x, y]); }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = num() + ox; y1 = num() + oy; } else if (/[CcSs]/.test(prev)) { x1 = 2 * x - cx; y1 = 2 * y - cy; } else { x1 = x; y1 = y; }
      const x2 = num() + ox, y2 = num() + oy, ex = num() + ox, ey = num() + oy;
      cubic(cur, [x, y], [x1, y1], [x2, y2], [ex, ey], tol);
      cx = x2; cy = y2; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      if (C === 'Q') { x1 = num() + ox; y1 = num() + oy; } else if (/[QqTt]/.test(prev)) { x1 = 2 * x - qx; y1 = 2 * y - qy; } else { x1 = x; y1 = y; }
      const ex = num() + ox, ey = num() + oy;
      quad(cur, [x, y], [x1, y1], [ex, ey], tol);
      qx = x1; qy = y1; x = ex; y = ey;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
      const ex = num() + ox, ey = num() + oy;
      arc(cur, x, y, rx, ry, rot, large, sweep, ex, ey, tol);
      x = ex; y = ey;
    } else if (C === 'Z') { x = sx; y = sy; close(); }
    else throw new Error(`path command ${cmd}`);
    prev = cmd;
  }
  close();
  return rings;
}
function quad(out, p0, p1, p2, tol) {
  const dd = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
  const n = Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol))));
  for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
}
function cubic(out, p0, p1, p2, p3, tol) {
  const dd = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
  const n = Math.max(1, Math.ceil(Math.sqrt((3 * dd) / (4 * tol))));
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
}
function arc(out, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, tol) {
  if (!rx || !ry) { out.push([x2, y2]); return; }
  const phi = (phiDeg * Math.PI) / 180, c = Math.cos(phi), s = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const ccx = c * cxp - s * cyp + (x1 + x2) / 2, ccy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(rx, ry))) || 0.1;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / step));
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n, px = rx * Math.cos(t), py = ry * Math.sin(t);
    out.push([c * px - s * py + ccx, s * px + c * py + ccy]);
  }
}

// ───────────────────────────── Material's flags ─────────────────────────────

async function materialFlags() {
  const requireFonts = createRequire(`${pkg}/../fonts/package.json`);
  const opentype = requireFonts('opentype.js');
  const ttfPath = `${pkg}/../fonts/src/fonts/icon-fallback.ttf`;
  const ttf = readFileSync(ttfPath);
  const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
  const icons = readFileSync(`${pkg}/../fonts/src/icons.ts`, 'utf8');
  const rows = [...icons.matchAll(/^ {2}\["([^"]+)","[^"]*","\\u\{([0-9a-f]+)\}"/gm)];
  if (rows.length < 1000) throw new Error(`only ${rows.length} rows read from @vostok/fonts' icons.ts: its shape changed`);
  const solid = rows.filter(([, , cp]) => lib.isSolidShape(lib.glyphShapes(font, String.fromCodePoint(parseInt(cp, 16))))).map(([, id]) => id);
  const sha = createHash('sha256').update(ttf).digest('hex');
  const lines = [];
  for (let k = 0; k < solid.length; k += 6) lines.push(`  ${solid.slice(k, k + 6).map((id) => `'${id}'`).join(', ')},`);
  writeFileSync(`${pkg}/src/material-solid.ts`, `// Written by scripts/fetch-symbols.mjs; do not edit by hand.
//
// The Material Symbols glyphs that print as one solid blob (isSolidShape), measured on the icon
// font of @vostok/fonts whose sha256 is below. The test measures every glyph again and fails
// when the font or the rule has changed until the script runs again.

export const MATERIAL_FONT_SHA256 = '${sha}';

export const MATERIAL_SOLID: readonly string[] = [
${lines.join('\n')}
];
`);
  console.log(`material: ${solid.length} of ${rows.length} glyphs are one solid blob`);
}
