// The tile library held to its own pictures. The picker's card IS a tile's SVG in a `<pattern>`,
// painted by a browser; the plate is the import (`library/svgtile.ts`). Nothing compared the two,
// and on 2026-09-29 44 of the 223 filled tiles burnt something other than their card: Plus - 5's
// crosses lost a bar to a fingerprint "dedupe", Flower - 3's petals were read as holes, Zebra burnt
// nothing, Scales - 2 laid whole discs where the card shows half ones. So: every tile, pixel for
// pixel, within 1 % of its own SVG — and each rule that made that true, on its own.
//   node tests/library-import.test.mjs          (about a minute; no browser — librsvg via sharp)
import { build as esbuild } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });
const entry = `${here}.cache/li-entry.ts`;
writeFileSync(entry, [
  `export * from '../../src/index';`,
  `export { LIBRARY, PATTERN_MONSTER, LIBRARY_TILES, PICKER_TILES, TILE_TUNING, isHiddenTile, tileById } from '../../src/library/index';`,
].join('\n'));
const bundle = `${here}.cache/li-${process.pid}.mjs`;
await esbuild({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', loader: { '.json': 'json' } });
const P = await import(`file://${bundle}?t=${Date.now()}`);

// sharp is a dependency of the workspace (the studio's rasterizer), not of this package: found in
// the pnpm store of the nearest workspace above, rather than pinned to one version.
let store = '';
for (let dir = here; dir.length > 3 && !store; dir = dir.replace(/[^/]+\/$/, '')) {
  if (existsSync(`${dir}node_modules/.pnpm`) && readdirSync(`${dir}node_modules/.pnpm`).some((d) => /^sharp@\d/.test(d))) store = `${dir}node_modules/.pnpm`;
}
if (!store) {
  console.log('  FAIL no sharp in the workspace: the library cannot be held to its pictures here');
  process.exit(1);
}
const sharpDir = readdirSync(store).filter((d) => /^sharp@\d/.test(d)).sort().pop();
const sharp = createRequire(import.meta.url)(`${store}/${sharpDir}/node_modules/sharp`);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL', msg);
  }
};

// ---- the measure: the card against the import, a few cells of each, one colour ----
const BG = '#000';
const FG = '#fff';
const f = (v) => (Math.round(v * 1000) / 1000).toString();
function frame(tile) {
  const reps = [Math.max(2, Math.ceil(120 / tile.width)), Math.max(2, Math.ceil(120 / tile.height))];
  const cw = tile.width * reps[0];
  const ch = tile.height * reps[1];
  const ppu = Math.max(1.5, Math.min(8, 900 / Math.max(cw, ch)));
  return { reps, px: [Math.round(cw * ppu), Math.round(ch * ppu)] };
}
/** The card: the tile's own paths in a `<pattern>`, as `paintPattern` draws them (stroke 1). */
function cardSvg(tile, { reps, px }) {
  const W = tile.width * reps[0];
  const H = tile.height * reps[1];
  const inner = P.tileLayers(tile, { colours: [BG, FG], stroke: 1 });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px[0]}" height="${px[1]}" viewBox="0 0 ${W} ${H}"><defs><pattern id="p" patternUnits="userSpaceOnUse" width="${tile.width}" height="${tile.height}"><rect x="0" y="0" width="100%" height="100%" fill="${BG}"/>${inner}</pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/></svg>`;
}
/** The import: the tile laid by the real tiler and deduped as the fill does, drawn as Engrave
 *  paints it (each island even-odd, islands unioned) — or, a line tile, its lines at stroke 1. */
function importSvg(tile, def, { reps, px }) {
  const p = P.resolveParams(def, {});
  const k = Number(p.size) / tile.width;
  const cell = def.cell(p);
  const geo = P.tileGeometry(def, p, { minX: 0, maxX: cell.w * reps[0] * 0.999, minY: -(reps[1] - 1) * cell.h, maxY: cell.h * 0.999 }, false).geo;
  const holes = P.dedupeIslands(geo.holes.map((i) => i.filter((r) => r.length >= 3 && Math.abs(P.signedArea(r)) > 1e-6)).filter((i) => i.length));
  const T = ([x, y]) => `${f(x / k)} ${f(tile.height - y / k)}`;
  let body = holes.map((isl) => `<path d="${isl.map((r) => `M ${r.map(T).join(' L ')} Z`).join(' ')}" fill="${FG}" fill-rule="evenodd"/>`).join('');
  if (geo.lines.length) body += `<path d="${geo.lines.map((l) => `M ${l.map(T).join(' L ')}`).join(' ')}" fill="none" stroke="${FG}" stroke-width="${tile.mode === 'fill' ? 0.05 : 1}"${tile.mode === 'stroke-join' ? ' stroke-linecap="square"' : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px[0]}" height="${px[1]}" viewBox="0 0 ${tile.width * reps[0]} ${tile.height * reps[1]}"><rect width="100%" height="100%" fill="${BG}"/>${body}</svg>`;
}
async function mask(svg, [w, h]) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).resize(w, h, { fit: 'fill' }).flatten({ background: BG }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) m[i] = data[i * info.channels] >= 128 ? 1 : 0;
  return { m, w: info.width, h: info.height };
}
function grow(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx;
      const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) o[Y * w + X] = 1;
    }
  }
  return o;
}
/** The card's ink the import lacks plus the import's ink the card lacks, beyond a pixel, as a
 *  share of their union. */
function mismatch(A, B) {
  const gA = grow(A.m, A.w, A.h);
  const gB = grow(B.m, B.w, B.h);
  let missing = 0;
  let extra = 0;
  let union = 0;
  for (let i = 0; i < A.m.length; i++) {
    if (A.m[i] || B.m[i]) union++;
    if (A.m[i] && !gB[i]) missing++;
    if (B.m[i] && !gA[i]) extra++;
  }
  return (missing + extra) / Math.max(1, union);
}
async function measure(tile, def) {
  const fr = frame(tile);
  return mismatch(await mask(cardSvg(tile, fr), fr.px), await mask(importSvg(tile, def, fr), fr.px));
}

// ---- 1. every tile, pixel for pixel ----
{
  const t0 = Date.now();
  const rows = [];
  for (const tile of P.LIBRARY_TILES) {
    const def = P.PATTERN_MONSTER.find((d) => d.id === `pm-${tile.id}`);
    rows.push({ id: tile.id, mode: tile.mode, off: await measure(tile, def) });
  }
  rows.sort((a, b) => b.off - a.off);
  const bad = rows.filter((r) => r.off >= 0.01);
  ok(rows.length === 330, `library: ${rows.length} tiles measured`);
  ok(!bad.length, `library: every tile imports within 1 % of its own SVG — ${bad.length} do not: ${bad.slice(0, 8).map((r) => `${r.id} ${(r.off * 100).toFixed(1)} %`).join(', ')}`);
  console.log(`  ${rows.length} tiles in ${((Date.now() - t0) / 1000).toFixed(0)} s; the furthest from their cards: ${rows.slice(0, 4).map((r) => `${r.id} ${(r.off * 100).toFixed(2)} %`).join(', ')}`);
  // The measure itself sees a fault: Plus - 5 with one colour layer lost is far off its card.
  const plus = P.tileById('plus-5');
  const lame = P.svgTilePattern({ id: 'x', name: 'x', width: plus.width, height: plus.height, paths: plus.paths.slice(0, 1), mode: 'fill', defaultSize: 13 }, P.flattenPathData);
  const off = await measure(plus, lame);
  ok(off > 0.1, `the measure: Plus - 5 missing one of its layers is ${(off * 100).toFixed(0)} % off its card`);
}

// ---- 2. the rules, one by one ----
const tileOf = (d, extra = {}) => P.svgTilePattern({ id: 't', name: 'T', width: 10, height: 10, paths: [d], mode: 'fill', defaultSize: 10, ...extra }, P.flattenPathData);
const holesOf = (def, params = {}) => def.tile(P.resolveParams(def, params)).holes;
const areaOf = (isl) => isl.reduce((s, r, i) => s + (i ? -1 : 1) * Math.abs(P.signedArea(r)), 0);
{
  // A. Plus - 5 draws each cross as two identical bars a quarter-turn apart: same vertex count,
  //    area and vertex centroid. Both are kept, in the tile and in the fill's dedupe.
  const plus = P.PATTERN_MONSTER.find((d) => d.id === 'pm-plus-5');
  const bars = holesOf(plus);
  ok(bars.length === 8, `Plus - 5: all 8 bars imported (${bars.length})`);
  const p = P.resolveParams(plus, {});
  const c = plus.cell(p);
  const block = P.tileGeometry(plus, p, { minX: -c.w, minY: -c.h, maxX: c.w, maxY: c.h }, false).geo.holes;
  ok(P.dedupeIslands(block).length === block.length, `Plus - 5: the fill's dedupe keeps every bar of a block (${P.dedupeIslands(block).length} of ${block.length})`);
  const bar = [[-3, -1], [3, -1], [3, 1], [-3, 1]];
  const turned = bar.map(([x, y]) => [-y, x]);
  const copy = bar.map(([x, y]) => [x + 1e-7, y]);
  ok(P.dedupeIslands([[bar], [turned], [copy]]).length === 2, 'dedupeIslands: a bar and its quarter-turn are two shapes, its exact copy is one');
  ok(P.sameRing(bar, [...bar].reverse(), 1e-6) && !P.sameRing(bar, turned, 1e-3), 'sameRing: the same vertices in any order and direction; not a quarter-turn');
}
{
  // B. Nonzero by winding number: a ring on its own is paint whichever way it runs; a ring inside
  //    one wound the other way is its hole; nested the same way, both are paint.
  const both = tileOf('M1 1h3v3h-3z M6 6v3h3v-3z');
  ok(holesOf(both).length === 2 && holesOf(both).every((i) => i.length === 1), 'winding: two lone squares wound opposite ways are both paint');
  const hole = holesOf(tileOf('M1 1h8v8h-8z M3 3v4h4v-4z'));
  ok(hole.length === 1 && hole[0].length === 2, `winding: a square wound against its outline is its hole (${hole.map((i) => i.length).join(',')})`);
  // Nested the same way the inner square has paint on both sides — no edge of anything — and the
  // painted square is whole: nonzero, not even-odd (which would punch it out).
  const nested = holesOf(tileOf('M1 1h8v8h-8z M3 3h4v4h-4z'));
  ok(nested.length === 1 && nested[0].length === 1 && Math.abs(areaOf(nested[0]) - 64) < 1e-6, `winding: a square nested in one wound the same way is paint, not a hole (${nested.map((i) => i.length)})`);
  // Flower - 3's petals are drawn against its centre's winding, and are its flower.
  const flower = P.PATTERN_MONSTER.find((d) => d.id === 'pm-flower-3');
  ok(holesOf(flower).length >= 20, `Flower - 3: its petals are shapes (${holesOf(flower).length} islands)`);
}
{
  // C. An open subpath in a fill tile is filled as if closed; one of two points paints nothing.
  const open = tileOf('M1 1h6v6h-6');
  ok(holesOf(open).length === 1 && Math.abs(areaOf(holesOf(open)[0]) - 36) < 1e-6, 'open subpath: filled as a 6 × 6 square');
  const dot = tileOf('M1 1h6v6h-6z M8 8h.01');
  ok(holesOf(dot).length === 1 && dot.tile(P.resolveParams(dot, {})).lines.length === 0, 'a two-point subpath in a fill tile draws nothing, not a hairline');
  const zebra = P.PATTERN_MONSTER.find((d) => d.id === 'pm-zebra');
  ok(holesOf(zebra).length > 0, `Zebra: its stripes are shapes (${holesOf(zebra).length})`);
}
{
  // Spikes and slits have no width: the ring runs out and straight back.
  const spike = holesOf(tileOf('M1 1H9V5H6V9.5V5H1Z'));
  const top = Math.max(...spike[0][0].map((q) => 10 - q[1]));
  ok(spike.length === 1 && top < 5 + 1e-6, `a zero-width spike is no part of the shape (it reached y ${top.toFixed(2)})`);
  const frame = holesOf(tileOf('M0 0H10V5H7V3H3V7H7V5H10V10H0Z'));
  ok(frame.length === 1 && frame[0].length === 2 && Math.abs(areaOf(frame[0]) - 84) < 1e-6, `a keyhole ring is a frame and its hole (${frame.map((i) => i.length)}, area ${frame[0] ? areaOf(frame[0]).toFixed(1) : '-'})`);
}
{
  // D. Clipped to the cell as the card is — unless the overhang is the neighbour's paint anyway.
  const disc = tileOf('M5 1a4 4 0 1 0 0.001 0z', { width: 10, height: 6 });
  const cut = holesOf(disc).flatMap((i) => i[0]);
  const k = 1; // size 10 on a 10-wide tile
  ok(cut.every(([x, y]) => x >= -1e-6 && x <= 10 * k + 1e-6 && y >= -1e-6 && y <= 6 * k + 1e-6), 'cell clip: a disc overhanging its cell with nothing to complete it is cut at the cell');
  const wrap = tileOf('M-3 5l3 -3 3 3 -3 3z M7 5l3 -3 3 3 -3 3z');
  const pts = holesOf(wrap).flatMap((i) => i[0]);
  ok(holesOf(wrap).length === 2 && Math.min(...pts.map((q) => q[0])) < -2 && Math.max(...pts.map((q) => q[0])) > 12, 'cell clip: a diamond drawn across the seam with its copy one period over stays whole');
  // The tiles that drew past their cells with nothing to complete them, against their cards.
  for (const id of ['scales-2', 'halloween-5', 'concentric-circles-5', 'eyes-2']) {
    const off = await measure(P.tileById(id), P.PATTERN_MONSTER.find((d) => d.id === `pm-${id}`));
    ok(off < 0.01, `${id}: cut at its cell as its card is (${(off * 100).toFixed(2)} % off)`);
  }
}
{
  // Stroke tiles: a line along the cell's edge, drawn a hair outside it, is the edge's line.
  const edge = P.svgTilePattern({ id: 's', name: 'S', width: 10, height: 10, paths: ['M-0.1 0V10M5 0V10'], mode: 'stroke', defaultSize: 10 }, P.flattenPathData);
  ok(edge.tile(P.resolveParams(edge, {})).lines.length === 2, `stroke tile: a line 0.1 unit outside the cell edge is kept (${edge.tile(P.resolveParams(edge, {})).lines.length} lines)`);
}

// ---- 3. engrave at the zone's edge ----
{
  const coaster = [[P.circle(0, 0, 45, 180)]];
  const zone = 41;
  // Holes the rim clips stay holes (a point ON the ring decides, never the corners' average), and
  // what the rim crosses is cut there, never handed on whole into the border.
  for (const [id, zoom, angle] of [['pm-waves-20', 1.15, 70], ['pm-chinese-14', 1.2, 70], ['pm-scales-7', 0.7, 0], ['pm-triangles-9', 1, 0], ['pm-squares-1', 1, 0], ['pm-geometric-9', 1.5, 45]]) {
    const def = P.PATTERN_MONSTER.find((d) => d.id === id);
    const r = P.fillShape(coaster, def, { op: 'engrave', scale: zoom, angle, inset: 4 });
    const out = r.shapes.flat(2).filter(([x, y]) => Math.hypot(x, y) > zone + 0.02).length;
    ok(r.stats.unclipped === 0 && out === 0, `${id} ${zoom * 100} % ${angle}°: engraved inside the zone (${r.stats.unclipped} left whole, ${out} points in the border)`);
    // Nothing engraved that the tile does not paint: every island's area is at most what its
    // source shapes put inside the zone (checked on pixels, 5 px/mm).
    const px = 5;
    const size = Math.round(2 * zone * px);
    const draw = (islands) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-zone} ${-zone} ${2 * zone} ${2 * zone}"><rect x="${-zone}" y="${-zone}" width="${2 * zone}" height="${2 * zone}" fill="${BG}"/><clipPath id="z"><circle r="${zone}"/></clipPath><g clip-path="url(#z)">${islands.map((isl) => `<path d="${isl.map((q) => `M ${q.map(([x, y]) => `${f(x)} ${f(-y)}`).join(' L ')} Z`).join(' ')}" fill="${FG}" fill-rule="evenodd"/>`).join('')}</g></svg>`;
    const source = P.fillShape(coaster, def, { op: 'engrave', scale: zoom, angle, inset: 4, partial: 'keep' });
    const A = await mask(draw(r.shapes), [size, size]);
    const B = await mask(draw(source.shapes), [size, size]);
    const gB = grow(B.m, size, size);
    let extra = 0;
    for (let i = 0; i < A.m.length; i++) if (A.m[i] && !gB[i]) extra++;
    ok(extra / (px * px) < 0.5, `${id} ${zoom * 100} % ${angle}°: nothing engraved the tile does not paint (${(extra / (px * px)).toFixed(2)} mm² extra)`);
  }
  // An island the clip cannot take is handed on with the zone to trim it to.
  const star = P.patternById('stars');
  const kept = P.fillShape([[P.circle(0, 0, 20, 64)]], star, { op: 'engrave', params: { size: 9, gap: 2 }, partial: 'keep' });
  ok(kept.zone === undefined, 'engrave: a host that keeps partial shapes whole is not handed a zone');
}

// ---- 4. score: the outline of what is painted is the host's to trace ----
{
  const disc = [[P.circle(0, 0, 30, 128)]];
  const plus = P.PATTERN_MONSTER.find((d) => d.id === 'pm-plus-5');
  const own = P.fillShape(disc, plus, { op: 'score', inset: 2 });
  const host = P.fillShape(disc, plus, { op: 'score', inset: 2, hostOutline: true });
  ok(!own.outline && own.paths.length > 0, `score without a host: traced here (${own.paths.length} runs)`);
  ok(!!host.outline && host.outline.shapes.length > 50 && host.paths.length === 0 && host.stats.lineLength === 0, `score with hostOutline: ${host.outline?.shapes.length} shapes handed over whole, nothing traced here`);
  ok(host.outline && host.outline.zone.length === 1 && host.outline.zone[0][0].every(([x, y]) => Math.abs(Math.hypot(x, y) - 28) < 0.05), 'score with hostOutline: the zone is the region less its margin');
  const lines = P.fillShape(disc, P.patternById('asanoha'), { op: 'score', hostOutline: true });
  ok(!lines.outline && lines.paths.length > 10, 'score with hostOutline: a pattern of lines is still lines');
}

// ---- 5. a line drawn twice is burnt once ----
{
  const a = [[0, 0], [10, 0]];
  ok(P.dropNearDuplicates([a, [[0, 0.0003], [10, 0.0003]]]).length === 1, 'dropNearDuplicates: the same line 0.3 µm off itself goes');
  const out = P.dropNearDuplicates([a, [[0, 0.3], [10, 0.3]]]);
  ok(out.length === 2 && out[0] === a, 'dropNearDuplicates: two lines 0.3 mm apart both stay, the first untouched');
  const part = P.dropNearDuplicates([a, [[5, 0.0001], [15, 0.0001]]]);
  const rest = part[1];
  ok(part.length === 2 && rest && Math.abs(Math.min(rest[0][0], rest[rest.length - 1][0]) - 10) < 1e-6 && Math.abs(Math.max(rest[0][0], rest[rest.length - 1][0]) - 15) < 1e-6, 'dropNearDuplicates: of a line half on another, only the half beyond it stays');
  const cross = P.dropNearDuplicates([a, [[5, -5], [5, 5]]]);
  ok(cross.length === 2 && cross[1].length === 2, 'dropNearDuplicates: a line crossing another is not cut there');
  const arc = (n, r0) => Array.from({ length: n + 1 }, (_, i) => [10 * Math.cos((i / n) * Math.PI + r0), 10 * Math.sin((i / n) * Math.PI + r0)]);
  const twice = P.dropNearDuplicates([arc(40, 0), arc(56, 0)]);
  const left = twice.slice(1).reduce((s, l) => s + l.slice(1).reduce((q, p, i) => q + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
  ok(left < 0.5, `dropNearDuplicates: a curve flattened twice at different steps is burnt once (${left.toFixed(2)} mm of the second left)`);
  // The default Asanoha coaster drew 62 mm of it twice (its data writes one diagonal two ways).
  const asanoha = P.PATTERN_MONSTER.find((d) => d.id === 'pm-japanese-pattern-4');
  const r = P.fillShape([[P.circle(0, 0, 45, 180)]], asanoha, { op: 'score', inset: 4 });
  const segs = r.paths.flatMap((l) => l.slice(1).map((q, i) => [l[i], q]));
  let twiceMm = 0;
  for (let i = 0; i < segs.length; i++) {
    const [p, q] = segs[i];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    for (let j = 0; j < segs.length; j++) {
      if (j === i) continue;
      const [u, v] = segs[j];
      const vx = v[0] - u[0];
      const vy = v[1] - u[1];
      const l2 = vx * vx + vy * vy;
      const t = Math.max(0, Math.min(1, ((m[0] - u[0]) * vx + (m[1] - u[1]) * vy) / l2));
      const par = Math.abs((q[0] - p[0]) * vy - (q[1] - p[1]) * vx) / Math.sqrt(l2) / Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (Math.hypot(m[0] - u[0] - vx * t, m[1] - u[1] - vy * t) < 0.005 && par < 0.01 && t > 0 && t < 1) {
        twiceMm += Math.hypot(q[0] - p[0], q[1] - p[1]);
        break;
      }
    }
  }
  ok(twiceMm < 0.5, `Asanoha on a 90 mm coaster: ${twiceMm.toFixed(1)} mm of line burnt twice`);
}

// ---- 6. what the picker offers, and the two tiles with thicker lines ----
{
  ok(P.LIBRARY.length === 330 && P.PICKER_TILES.length === 328, `picker: ${P.PICKER_TILES.length} of ${P.LIBRARY.length} tiles offered`);
  ok(['stars-and-lines-1', 'stripes-2'].every((id) => P.isHiddenTile(`pm-${id}`) && P.isHiddenTile(id) && !P.PICKER_TILES.some((t) => t.id === id)), 'picker: Stars & Lines - 1 and Stripes - 2 are hidden');
  ok(P.PATTERN_MONSTER.some((d) => d.id === 'pm-stripes-2'), 'a hidden tile still builds for a design that names it');
  const coaster = [[P.circle(0, 0, 45, 180)]];
  for (const [id, thicken] of [['japanese-pattern-7', 0.8], ['interlocked-hexagons-3', 1.5]]) {
    const def = P.PATTERN_MONSTER.find((d) => d.id === `pm-${id}`);
    const p = P.resolveParams(def, {});
    const want = (thicken / 2) * (Number(p.size) / P.tileById(id).width);
    ok(Math.abs(def.erode(p) - want) < 1e-9 && P.TILE_TUNING[id].thicken === thicken, `${id}: its lines between shapes drawn ${thicken} units thicker (erode ${want.toFixed(3)} mm)`);
    const e = P.fillShape(coaster, def, { op: 'engrave', scale: 1.5 });
    const s = P.fillShape(coaster, def, { op: 'score', hostOutline: true });
    const c = P.fillShape(coaster, def, { op: 'cut' });
    ok(Math.abs(e.erode - want * 1.5) < 1e-9 && Math.abs(s.erode - want) < 1e-9 && c.erode === undefined, `${id}: Engrave and Score erode what it paints (${e.erode?.toFixed(3)} mm at 150 %), Cut holds its web instead`);
  }
  ok(P.PATTERN_MONSTER.filter((d) => d.erode).length === 2, 'only those two tiles are drawn thicker');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
