// The Japanese wagara and textile families, held to account one pattern at a time: the generic
// rules every pattern must keep (finite, non-overlapping, the web it promises, cut drops what
// crosses the edge, lines refuse to cut, the tile really is one period) plus one fact per
// pattern about the shape it claims to be.
//   node tests/japanese-textile.test.mjs
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });
const bundle = `${here}.cache/jt-${process.pid}.mjs`;
await esbuild({
  entryPoints: [`${here}entry.ts`], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  loader: { '.json': 'json' },
});
const P = await import(`file://${bundle}?t=${Date.now()}`);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL', msg);
  }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const disc = (r) => [[P.circle(0, 0, r, 160)]];
const rectRegion = (w, h) => [[P.rect(0, 0, w, h)]];

const JAPANESE = ['sayagata', 'yagasuri', 'bishamon-kikko', 'kikko-hanabishi', 'tatewaku', 'uroko', 'hishi-yotsu', 'asanoha-in-hex', 'kaku-asa'];
const TEXTILE = ['herringbone', 'basketweave', 'houndstooth', 'argyle', 'gingham', 'ogee', 'quatrefoil', 'scallops', 'chain', 'brick-lines'];
const MINE = [...JAPANESE, ...TEXTILE];

const defOf = (id) => {
  const d = P.patternById(id);
  if (!d) throw new Error(`no pattern "${id}" — did it get registered?`);
  return d;
};
const paramsOf = (id, over) => P.resolveParams(defOf(id), over);
const cellOf = (id, over) => defOf(id).cell(paramsOf(id, over));
const tileOf = (id, over) => defOf(id).tile(paramsOf(id, over));

// ---- helpers --------------------------------------------------------------------------------

function segDist(a, b, c, d) {
  const pd = (p, u, v) => {
    const vx = v[0] - u[0];
    const vy = v[1] - u[1];
    const l2 = vx * vx + vy * vy;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - u[0]) * vx + (p[1] - u[1]) * vy) / l2));
    return Math.hypot(p[0] - (u[0] + vx * t), p[1] - (u[1] + vy * t));
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}
const ringDist = (r1, r2) => {
  let best = Infinity;
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i];
    const b = r1[(i + 1) % r1.length];
    for (let j = 0; j < r2.length; j++) best = Math.min(best, segDist(a, b, r2[j], r2[(j + 1) % r2.length]));
  }
  return best;
};
const distToRing = (p, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segDist(p, p, ring[i], ring[(i + 1) % ring.length]));
  return best;
};
const bbox = (ring) => P.bboxOfShapes([[ring]]);
const boxGap = (a, b) => Math.max(0, a.minX - b.maxX, b.minX - a.maxX, a.minY - b.maxY, b.minY - a.maxY);
const centroid = (ring) => {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
};
const area = (ring) => Math.abs(P.signedArea(ring));
const angleOf = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const runsOf = (r) => [...r.paths, ...r.shapes.flatMap((island) => island.map((ring) => [...ring, ring[0]]))];
/** How far `q` is from the nearest ink. Merge-proof, so it can compare two placements of the
 *  same pattern without caring how the engine chained the segments up. */
function inkDistance(runs, q) {
  let best = Infinity;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const d = segDist(q, q, run[i], run[i + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---- 1. every pattern: finite, and drawn where it was asked ----------------------------------
console.log(`japanese + textile: ${MINE.length} patterns`);
for (const id of MINE) {
  const def = defOf(id);
  ok(def.family === (JAPANESE.includes(id) ? 'japanese' : 'textile'), `${id}: family ${def.family}`);
  ok(def.blurb && def.blurb.length > 20 && def.tags?.length, `${id}: blurb and tags`);
  for (const op of def.ops) {
    const r = P.fillShape(disc(45), def, { op, web: 1.5 });
    const pts = [...r.shapes.flat(2), ...r.paths.flat()];
    ok(pts.length > 0, `${id}/${op}: draws something in a 90 mm disc`);
    ok(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `${id}/${op}: finite coordinates`);
  }
}

// ---- 2. holes never overlap, and they keep the web the pattern promises ----------------------
for (const id of MINE) {
  const def = defOf(id);
  const p = P.resolveParams(def, {});
  const geo = def.tile(p);
  if (!geo.holes.length) continue;
  const want = def.web ? def.web(p) : 0;
  const { w, h } = def.cell(p);
  const box = [Math.min(100, Math.max(46, 5 * w)), Math.min(100, Math.max(46, 5 * h))];
  const r = P.fillShape(rectRegion(box[0], box[1]), def, { op: 'engrave', partial: 'drop', inset: 0 });
  const rings = r.shapes.map((i) => i[0]);
  ok(rings.length > 3, `${id}: ${rings.length} whole motifs in a ${box[0].toFixed(0)} × ${box[1].toFixed(0)} mm box`);
  const boxes = rings.map(bbox);
  let worst = Infinity;
  let overlaps = 0;
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      if (boxGap(boxes[i], boxes[j]) > want + 1.5) continue;
      worst = Math.min(worst, ringDist(rings[i], rings[j]));
      // Touching is legal; a vertex sunk into a neighbour is not.
      for (const q of rings[i]) if (P.pointInRing(q, rings[j]) && distToRing(q, rings[j]) > 0.02) overlaps++;
      for (const q of rings[j]) if (P.pointInRing(q, rings[i]) && distToRing(q, rings[i]) > 0.02) overlaps++;
    }
  }
  ok(overlaps === 0, `${id}: ${overlaps} vertices buried inside a neighbouring motif`);
  if (want > 0) ok(worst >= want - 0.01, `${id}: narrowest gap ${worst.toFixed(3)} ≥ the ${want.toFixed(3)} mm web it promises`);
}

// ---- 3. cut clips what crosses the edge, as Engrave does; lines cut as a lattice --------------
for (const id of MINE) {
  const def = defOf(id);
  const web = 2;
  const R = 40;
  if (def.ops.includes('cut')) {
    const r = P.fillShape(disc(R), def, { op: 'cut', web });
    ok(r.shapes.length > 2, `${id}/cut: ${r.shapes.length} holes survive`);
    ok((r.stats.clipped ?? 0) > 0, `${id}/cut: ${r.stats.clipped ?? 0} holes clipped at the edge, not dropped`);
    const out = r.shapes.flat(2).filter(([x, y]) => Math.hypot(x, y) > R - web + 0.05);
    ok(out.length === 0, `${id}/cut: ${out.length} points closer to the edge than the ${web} mm web`);
  } else if (!def.tile(P.resolveParams(def, {})).holes.length) {
    // A pattern of lines cuts as a lattice: no holes of its own, a recipe of lines for the struts instead.
    const r = P.fillShape(disc(R), def, { op: 'cut', web });
    ok(r.shapes.length === 0 && r.paths.length === 0 && r.lattice?.runs.length > 0, `${id}: a pattern of lines cuts as a lattice (${r.lattice?.runs.length ?? 0} runs)`);
    ok(r.warnings.length === 0, `${id}: and says nothing about it — ${r.warnings[0] ?? 'no warning'}`);
  }
}

// ---- 4. the tile is one period: sliding the pattern by a whole cell changes nothing -----------
// Measured by distance-to-nearest-ink on a grid of probes rather than by comparing segments,
// because the engine merges collinear runs and a merge may chain them up differently at the
// margin without the drawing changing at all.
for (const id of MINE) {
  const def = defOf(id);
  const p = P.resolveParams(def, {});
  const { w, h } = def.cell(p);
  const op = def.ops[0];
  const region = rectRegion(9 * w, 9 * h);
  const runsA = runsOf(P.fillShape(region, def, { op, partial: 'keep', inset: 0, web: 0 }));
  const runsB = runsOf(P.fillShape(region, def, { op, partial: 'keep', inset: 0, web: 0, dx: w, dy: h }));
  ok(runsA.length > 2, `${id}: ${runsA.length} runs of geometry to probe`);
  let worst = 0;
  let touched = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const q = [(-0.5 + (i + 0.317) / 7) * w, (-0.5 + (j + 0.211) / 7) * h];
      const da = inkDistance(runsA, q);
      const db = inkDistance(runsB, [q[0] + w, q[1] + h]);
      worst = Math.max(worst, Math.abs(da - db));
      if (da < Math.max(w, h)) touched++;
    }
  }
  ok(touched > 20, `${id}: ${touched}/49 probes find ink within a cell of themselves`);
  ok(worst < 1e-6, `${id}: sliding by one cell (${w.toFixed(2)} × ${h.toFixed(2)}) redraws the same pattern — worst probe differs by ${worst.toExponential(1)}`);
}

// ---- 5. a three-cell box holds exactly nine cells' worth of motifs ----------------------------
for (const id of MINE) {
  const def = defOf(id);
  const p = P.resolveParams(def, {});
  const perCell = def.tile(p).holes.length;
  if (!perCell) continue;
  const { w, h } = def.cell(p);
  // Nudge the lattice off the box's edges so no motif centre lands on the boundary.
  const dx = 0.137 * w;
  const dy = 0.211 * h;
  const r = P.fillShape(rectRegion(3 * w, 3 * h), def, { op: 'engrave', partial: 'keep', inset: 0, dx, dy });
  const inside = r.shapes.filter(([ring]) => {
    const c = centroid(ring);
    return Math.abs(c[0]) < 1.5 * w && Math.abs(c[1]) < 1.5 * h;
  });
  ok(inside.length === 9 * perCell, `${id}: ${inside.length} motif centres in a 3 × 3 cell box, expected ${9 * perCell}`);
}

// ---- 6. one fact each -------------------------------------------------------------------------
{
  // Sayagata: a manji lattice laid on the diagonal — turn it back 45° and every stroke is square.
  const p = paramsOf('sayagata');
  const a = P.num(p, 'size');
  const t = tileOf('sayagata');
  ok(t.lines.length === 6, `sayagata: ${t.lines.length} strokes per manji, expected 6`);
  const k = Math.SQRT1_2;
  const back = ([x, y]) => [(x + y) * k, (y - x) * k];
  let square = 0;
  for (const l of t.lines) {
    for (let i = 0; i < l.length - 1; i++) {
      const u = back(l[i]);
      const v = back(l[i + 1]);
      if (near(u[0], v[0], 1e-9) || near(u[1], v[1], 1e-9)) square++;
    }
  }
  ok(square === 6, `sayagata: ${square}/6 strokes are axis-aligned once the 45° is taken back out`);
  const lens = t.lines.map((l) => Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]));
  ok(lens.filter((v) => near(v, 2 * a, 1e-9)).length === 2 && lens.filter((v) => near(v, a, 1e-9)).length === 4, `sayagata: two ${2 * a} mm bars and four ${a} mm hooks`);
  const c = cellOf('sayagata');
  ok(near(c.w, 2 * Math.SQRT2 * a) && near(c.h, c.w), `sayagata: square cell of 2√2·arm (${c.w.toFixed(3)})`);
}
{
  // Yagasuri: two barbs a cell, mirror images of each other in y, six corners apiece.
  const p = paramsOf('yagasuri');
  const H = P.num(p, 'height');
  const t = tileOf('yagasuri');
  ok(t.holes.length === 2 && t.holes.every((i) => i[0].length === 6), 'yagasuri: two six-cornered barbs per cell');
  const up = t.holes[0][0];
  const down = t.holes[1][0];
  const apexUp = up.reduce((a, q) => (q[1] > a[1] ? q : a), up[0]);
  const apexDown = down.reduce((a, q) => (q[1] < a[1] ? q : a), down[0]);
  ok(apexUp[1] > up[0][1] && apexDown[1] < down[0][1], 'yagasuri: one column flights up, the next down');
  const mirrored = new Set(down.map(([x, y]) => `${Math.round((x - P.num(p, 'width')) * 1000)},${Math.round((H - y) * 1000)}`));
  ok(up.every(([x, y]) => mirrored.has(`${Math.round(x * 1000)},${Math.round(y * 1000)}`)), 'yagasuri: the second column is the first mirrored about the cell’s mid-height');
}
{
  // Bishamon-kikkō: three hexagons fused, so twelve corners and very nearly three hexagons' area.
  const p = paramsOf('bishamon-kikko');
  const s = P.num(p, 'size');
  const t = tileOf('bishamon-kikko');
  ok(t.holes.length === 2 && t.holes.every((i) => i[0].length === 12), `bishamon-kikko: two twelve-cornered trefoils per cell`);
  // Three hexagons' area, less the inset: A(d) = A₀ − P·d + d²·Σcot(θᵢ/2), with nine 120° corners
  // and three reflex 240° ones, so the corner term is 6·cot 60°.
  const hex = (Math.sqrt(3) / 2) * s * s;
  const d = P.num(p, 'gap') / 2;
  const perim = 12 * (s / Math.sqrt(3));
  const want = 3 * hex - perim * d + 6 / Math.sqrt(3) * d * d;
  const a = area(t.holes[0][0]);
  ok(near(a, want, 0.02), `bishamon-kikko: trefoil area ${a.toFixed(3)} = three hexagons (${(3 * hex).toFixed(1)}) inset by ${d} mm (${want.toFixed(3)})`);
  ok(t.lines.length === 6 && t.lines.every((l) => l.length === 2), 'bishamon-kikko: three swallowed edges per trefoil, drawn as a Y');
  const arms = t.lines.slice(0, 3).map((l) => Math.round(((angleOf(l[0], l[1]) + 360) % 360) * 10) / 10).sort((x, y) => x - y);
  ok(JSON.stringify(arms) === JSON.stringify([30, 150, 270]), `bishamon-kikko: the Y points at 30°, 150°, 270° (${arms.join(', ')})`);
  const c = cellOf('bishamon-kikko');
  ok(near(c.w, 3 * s) && near(c.h, s * Math.sqrt(3)), `bishamon-kikko: 3s × s√3 cell (${c.w.toFixed(2)} × ${c.h.toFixed(2)})`);
}
{
  // Kikkō-hanabishi: a hexagon plus four petals in each of the cell's two hexagons.
  const t = tileOf('kikko-hanabishi');
  ok(t.holes.length === 0, 'kikko-hanabishi: lines only, nothing closed to cut');
  ok(t.lines.length === 10, `kikko-hanabishi: ${t.lines.length} outlines per cell, expected 2 hexagons + 8 petals`);
  const petals = t.lines.filter((l) => l.length === 5);
  ok(petals.length === 8, `kikko-hanabishi: ${petals.length} four-cornered petals`);
  const s = P.num(paramsOf('kikko-hanabishi'), 'size');
  const centres = [[s / 2, (s * Math.sqrt(3)) / 2], [0, 0]];
  ok(petals.every((l) => centres.some((c) => near(l[0][0], c[0], 1e-9) && near(l[0][1], c[1], 1e-9))), 'kikko-hanabishi: every petal has its tail on a hexagon centre');
}
{
  // Tatewaku: two edges, mirror images about the band's axis, widest at the cell's mid-height.
  const p = paramsOf('tatewaku');
  const W = P.num(p, 'width');
  const A = P.num(p, 'amplitude');
  const L = P.num(p, 'wavelength');
  const t = tileOf('tatewaku');
  ok(t.lines.length === 2 && t.holes.length === 0, 'tatewaku: one band of two wavy lines, nothing closed');
  const [left, right] = t.lines;
  ok(left.every((q, i) => near(q[0] + right[i][0], 2 * W, 1e-9) && near(q[1], right[i][1], 1e-9)), 'tatewaku: the two edges mirror about the band’s axis');
  const widthAt = (y) => {
    const i = left.reduce((best, q, k) => (Math.abs(q[1] - y) < Math.abs(left[best][1] - y) ? k : best), 0);
    return right[i][0] - left[i][0];
  };
  ok(near(widthAt(L / 2), W + 2 * A, 1e-6), `tatewaku: widest (${widthAt(L / 2).toFixed(3)} = W + 2A) at the swell`);
  ok(near(widthAt(0), W - 2 * A, 1e-6), `tatewaku: pinched to ${widthAt(0).toFixed(3)} = W − 2A between swells`);
}
{
  // Uroko: only the up-pointing triangles are filled, so every scale points the same way.
  const t = tileOf('uroko');
  ok(t.holes.length === 2 && t.holes.every((i) => i[0].length === 3), 'uroko: two triangles per cell');
  for (const [tri] of t.holes) {
    const ys = tri.map((q) => q[1]).sort((a, b) => a - b);
    ok(near(ys[0], ys[1], 1e-9) && ys[2] > ys[1], `uroko: scale points up (base at ${ys[0].toFixed(2)}, apex at ${ys[2].toFixed(2)})`);
  }
  ok(!defOf('uroko').ops.includes('cut'), 'uroko: never offered as a cut — filled triangles meet only at their corners');
}
{
  // Hishi-yotsu: four quarters to a group, and the groove between groups is the wider one.
  const p = paramsOf('hishi-yotsu');
  const w = P.num(p, 'width');
  const h = w * P.num(p, 'ratio');
  const t = tileOf('hishi-yotsu');
  ok(t.holes.length === 8, `hishi-yotsu: ${t.holes.length} quarters per cell, expected two groups of four`);
  ok(t.holes.every((i) => i[0].length === 4), 'hishi-yotsu: every quarter is a rhombus');
  const group = t.holes.slice(0, 4).map((i) => centroid(i[0]));
  const gc = [group.reduce((s, q) => s + q[0], 0) / 4, group.reduce((s, q) => s + q[1], 0) / 4];
  ok(near(gc[0], w / 2, 1e-9) && near(gc[1], h / 2, 1e-9), 'hishi-yotsu: the first group sits on the cell’s centre');
  const offs = group.map((q) => [Math.abs(q[0] - gc[0]), Math.abs(q[1] - gc[1])]);
  ok(offs.filter(([dx, dy]) => dx > 1e-9 && dy < 1e-9).length === 2 && offs.filter(([dx, dy]) => dy > 1e-9 && dx < 1e-9).length === 2, 'hishi-yotsu: two quarters left/right, two up/down');
  const inner = ringDist(t.holes[0][0], t.holes[2][0]);
  const outer = ringDist(t.holes[0][0], t.holes[5][0]);
  ok(inner < outer, `hishi-yotsu: the gap inside a group (${inner.toFixed(2)}) is tighter than the gap between groups (${outer.toFixed(2)}) — which is what makes the grouping read`);
}
{
  // Asanoha-in-hex: each hexagon holds one whole star — outline, six radii, six centroids × three.
  const t = tileOf('asanoha-in-hex');
  ok(t.lines.length === 2 * 25, `asanoha-in-hex: ${t.lines.length} runs per cell, expected 2 × (1 hexagon + 6 radii + 6 × 3 spokes)`);
  const p = paramsOf('asanoha-in-hex');
  const s = P.num(p, 'size');
  const R = s / Math.sqrt(3);
  const hexes = t.lines.filter((l) => l.length === 7);
  ok(hexes.length === 2, `asanoha-in-hex: ${hexes.length} hexagon outlines`);
  const spokes = t.lines.filter((l) => l.length === 2);
  ok(spokes.every((l) => Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]) <= R + 1e-9), 'asanoha-in-hex: no spoke leaves its own hexagon');
}
{
  // Kaku-asa: a square grid plus both diagonals — nothing else, and nothing at any other angle.
  const t = tileOf('kaku-asa');
  ok(t.lines.length === 4 && t.holes.length === 0, 'kaku-asa: four strokes per square, all lines');
  const angs = t.lines.map((l) => ((angleOf(l[0], l[1]) % 180) + 180) % 180).map((a) => Math.round(a * 10) / 10).sort((a, b) => a - b);
  ok(JSON.stringify(angs) === JSON.stringify([0, 45, 90, 135]), `kaku-asa: one stroke at each of 0°, 45°, 90°, 135° (${angs.join(', ')})`);
}
{
  // Herringbone: two real rectangles, 90° apart, at ±45°, offset half a cell each way.
  const p = paramsOf('herringbone');
  const w = P.num(p, 'width');
  const L = Math.round(P.num(p, 'ratio')) * w;
  const t = tileOf('herringbone');
  ok(t.lines.length === 2 && t.holes.length === 0, 'herringbone: two plank outlines per cell');
  for (const plank of t.lines) {
    ok(plank.length === 5, `herringbone: a plank is a four-cornered rectangle (${plank.length - 1} corners)`);
    const sides = [0, 1, 2, 3].map((i) => Math.hypot(plank[i + 1][0] - plank[i][0], plank[i + 1][1] - plank[i][1])).sort((a, b) => a - b);
    ok(near(sides[0], w, 1e-9) && near(sides[1], w, 1e-9) && near(sides[3], L, 1e-9), `herringbone: plank is ${L} × ${w} (${sides.map((v) => v.toFixed(2)).join('×')})`);
  }
  const axis = (plank) => {
    let best = 0;
    let bestLen = 0;
    for (let i = 0; i < 4; i++) {
      const len = Math.hypot(plank[i + 1][0] - plank[i][0], plank[i + 1][1] - plank[i][1]);
      if (len > bestLen) {
        bestLen = len;
        best = ((angleOf(plank[i], plank[i + 1]) % 180) + 180) % 180;
      }
    }
    return Math.round(best);
  };
  ok(Math.abs(axis(t.lines[0]) - axis(t.lines[1])) === 90, `herringbone: the two planks lie 90° apart (${axis(t.lines[0])}°, ${axis(t.lines[1])}°)`);
  ok([45, 135].includes(axis(t.lines[0])) && [45, 135].includes(axis(t.lines[1])), 'herringbone: both planks run at ±45°');
  const c = cellOf('herringbone');
  ok(near(c.w, w * Math.SQRT2) && near(c.h, L * Math.SQRT2), `herringbone: w√2 × L√2 cell (${c.w.toFixed(2)} × ${c.h.toFixed(2)})`);
}
{
  // Basketweave: eight slats, four lengthways and four upright, all the same size.
  const p = paramsOf('basketweave');
  const s = P.num(p, 'size');
  const g = P.num(p, 'gap');
  const t = tileOf('basketweave');
  ok(t.holes.length === 8, `basketweave: ${t.holes.length} slats per super-cell, expected 8`);
  const shape = t.holes.map(([r]) => {
    const b = bbox(r);
    return [Math.round((b.maxX - b.minX) * 1000), Math.round((b.maxY - b.minY) * 1000)];
  });
  const flat = shape.filter(([a, b]) => a > b).length;
  ok(flat === 4 && shape.length - flat === 4, `basketweave: ${flat} lengthways and ${shape.length - flat} upright`);
  ok(shape.every(([a, b]) => Math.max(a, b) === Math.round((2 * s - g) * 1000) && Math.min(a, b) === Math.round((s - g) * 1000)), `basketweave: every slat is ${(2 * s - g).toFixed(1)} × ${(s - g).toFixed(1)}`);
}
{
  // Houndstooth: the fourteen-cornered dogtooth, and exactly half the cloth is dark.
  const t = tileOf('houndstooth');
  ok(t.holes.length === 1 && t.holes[0][0].length === 14, `houndstooth: one motif of ${t.holes[0][0].length} corners, expected 14`);
  const size = P.num(paramsOf('houndstooth'), 'size');
  ok(near(area(t.holes[0][0]), (size * size) / 2, 1e-6), `houndstooth: the tooth is exactly half the ${size} mm cell (${area(t.holes[0][0]).toFixed(3)} vs ${((size * size) / 2).toFixed(3)})`);
  // Half the cell each, never overlapping (checked above) — so a houndstooth field is exactly
  // half dark, which is the whole point of the weave.
  const r = P.fillShape(rectRegion(60, 60), defOf('houndstooth'), { op: 'engrave', inset: 0 });
  ok(r.stats.holes > 20, `houndstooth: ${r.stats.holes} teeth in a 60 mm square`);
  ok(!defOf('houndstooth').ops.includes('cut'), 'houndstooth: never offered as a cut — the teeth meet point to point');
}
{
  // Argyle: the engraved diamond's corners are the cell's edge midpoints, and each over-line
  // runs through the centres of both diamonds.
  const p = paramsOf('argyle');
  const w = P.num(p, 'width');
  const h = w * P.num(p, 'ratio');
  const t = tileOf('argyle');
  ok(t.holes.length === 1 && t.holes[0][0].length === 4, 'argyle: one diamond engraved per cell, the other left bare');
  const want = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  ok(t.holes[0][0].every((q, i) => near(q[0], want[i][0], 1e-9) && near(q[1], want[i][1], 1e-9)), 'argyle: the diamond’s corners are the cell’s edge midpoints');
  ok(t.lines.length === 2, 'argyle: two over-lines per cell');
  const onLine = ([a, b], q) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) < 1e-9;
  ok(t.lines.every((l) => onLine(l, [w / 2, h / 2])), 'argyle: both over-lines pass through the engraved diamond’s centre');
  ok(onLine(t.lines[0], [0, 0]) || onLine(t.lines[1], [0, 0]), 'argyle: an over-line passes through the bare diamond’s centre too');
}
{
  // Gingham: the crossing is the stripe squared, sitting dead on the cell's centre.
  const p = paramsOf('gingham');
  const s = P.num(p, 'spacing');
  const t = s * P.num(p, 'stripe');
  const n = Math.round(P.num(p, 'rules'));
  const g = tileOf('gingham');
  ok(g.holes.length === 1, 'gingham: one filled crossing per cell');
  const b = bbox(g.holes[0][0]);
  ok(near(b.maxX - b.minX, t, 1e-9) && near(b.maxY - b.minY, t, 1e-9), `gingham: the crossing is ${t.toFixed(2)} square`);
  ok(near((b.minX + b.maxX) / 2, s / 2, 1e-9) && near((b.minY + b.maxY) / 2, s / 2, 1e-9), 'gingham: the crossing is centred on the cell');
  ok(g.lines.length === 2 * n, `gingham: ${g.lines.length} rules per cell, expected ${2 * n}`);
  const span = g.lines.map((l) => Math.max(Math.abs(l[1][0] - l[0][0]), Math.abs(l[1][1] - l[0][1])));
  ok(span.every((v) => near(v, s, 1e-9)), 'gingham: every rule runs the full cell');
}
{
  // Ogee: a spire on top of a bulb — the top vertex is sharp, the bottom blunt, and the two
  // tiles of a cell are the same shape half-dropped.
  const p = paramsOf('ogee');
  const w = P.num(p, 'width');
  const h = w * P.num(p, 'ratio');
  const t = tileOf('ogee');
  ok(t.holes.length === 2, 'ogee: two tiles per cell, half-dropped');
  const ring = t.holes[1][0];
  const b = bbox(ring);
  ok(near((b.minX + b.maxX) / 2, 0, 1e-9), 'ogee: the tile is symmetric about its own axis');
  const H = b.maxY - b.minY;
  const spread = (frac) => {
    const y = b.minY + H * frac;
    const band = ring.filter((q) => Math.abs(q[1] - y) < H * 0.04);
    return band.length ? Math.max(...band.map((q) => Math.abs(q[0]))) : 0;
  };
  const topSpread = spread(0.9);
  const botSpread = spread(0.1);
  ok(topSpread < botSpread, `ogee: the top narrows to a spire (${topSpread.toFixed(2)}) while the foot stays broad (${botSpread.toFixed(2)})`);
  const c0 = centroid(t.holes[0][0]);
  const c1 = centroid(ring);
  ok(near(Math.abs(c0[0] - c1[0]), w / 2, 1e-6) && near(Math.abs(c0[1] - c1[1]), h / 2, 1e-6), 'ogee: the second tile is the first slid half a cell both ways');
}
{
  // Quatrefoil: four lobes out to half the width, notched back to the inner square's corners.
  const size = P.num(paramsOf('quatrefoil'), 'size');
  const t = tileOf('quatrefoil');
  ok(t.holes.length === 1, 'quatrefoil: one foil per cell');
  const ring = t.holes[0][0];
  const c = [cellOf('quatrefoil').w / 2, cellOf('quatrefoil').h / 2];
  const radii = ring.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]));
  ok(near(Math.max(...radii), size / 2, 1e-6), `quatrefoil: the lobes reach ${Math.max(...radii).toFixed(3)} = half the ${size} mm width`);
  ok(near(Math.min(...radii), (size / 4) * Math.SQRT2, 1e-6), `quatrefoil: the notches cut back to the inner square's corner, ${(Math.min(...radii)).toFixed(3)}`);
  const tips = radii.filter((r) => near(r, size / 2, 1e-6)).length;
  ok(tips === 4, `quatrefoil: ${tips} lobe tips, expected 4`);
}
{
  // Scallops: every arc is part of a circle centred on a scale of the half-drop lattice, and the
  // hidden parts are gone — the arcs stop where the row in front takes over.
  const p = paramsOf('scallops');
  const R = P.num(p, 'size') / 2;
  const v = R * P.num(p, 'overlap');
  const t = tileOf('scallops');
  ok(t.holes.length === 0 && t.lines.length >= 2, `scallops: ${t.lines.length} arc runs, no closed shapes`);
  const centres = [[0, 0], [R, v]];
  ok(t.lines.every((l) => l.every((q) => centres.some((cc) => near(Math.hypot(q[0] - cc[0], q[1] - cc[1]), R, 1e-6)))), 'scallops: every point sits exactly R from its own scale centre');
  const runLength = (l) => l.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0);
  const total = t.lines.reduce((s, l) => s + runLength(l), 0);
  ok(total < 2 * (2 * Math.PI * R) - 1e-6, `scallops: ${total.toFixed(1)} mm of arc drawn, less than the ${(2 * 2 * Math.PI * R).toFixed(1)} mm of two whole circles — the hidden halves are dropped`);
}
{
  // Chain: two links a cell, each an outer and an inner stadium a ring-wall apart.
  const p = paramsOf('chain');
  const L = P.num(p, 'size');
  const wd = P.num(p, 'width');
  const th = P.num(p, 'thickness');
  const t = tileOf('chain');
  ok(t.holes.length === 0 && t.lines.length === 4, `chain: ${t.lines.length} outlines per cell, expected 2 links × (outer + inner)`);
  const boxes = t.lines.map((l) => bbox(l));
  const dims = boxes.map((b) => [b.maxX - b.minX, b.maxY - b.minY].sort((a, c) => c - a).map((v2) => Math.round(v2 * 1000) / 1000));
  ok(dims.filter(([a, b]) => near(a, L, 1e-6) && near(b, wd, 1e-6)).length === 2, `chain: two outer links ${L} × ${wd} (${dims.map((d) => d.join('×')).join(', ')})`);
  ok(dims.filter(([a, b]) => near(a, L - 2 * th, 1e-6) && near(b, wd - 2 * th, 1e-6)).length === 2, `chain: two inner links inset by the ${th} mm wall`);
  const lengthways = boxes.filter((b) => b.maxX - b.minX > b.maxY - b.minY).length;
  ok(lengthways === 2, `chain: one link lies lengthways and one upright (${lengthways} of 4 outlines are wide)`);
}
{
  // Brick mortar: two bed joints and two head joints, the second course slid by the bond offset.
  const p = paramsOf('brick-lines');
  const L = P.num(p, 'length');
  const H = P.num(p, 'height');
  const off = P.num(p, 'offset');
  const t = tileOf('brick-lines');
  ok(t.holes.length === 0 && t.lines.length === 4, `brick-lines: ${t.lines.length} joints per cell, expected 2 bed + 2 head`);
  const beds = t.lines.filter((l) => near(l[0][1], l[1][1], 1e-9));
  const heads = t.lines.filter((l) => near(l[0][0], l[1][0], 1e-9));
  ok(beds.length === 2 && heads.length === 2, `brick-lines: ${beds.length} bed joints and ${heads.length} head joints`);
  ok(beds.every((l) => near(Math.abs(l[1][0] - l[0][0]), L, 1e-9)), `brick-lines: a bed joint spans one brick, ${L} mm`);
  ok(heads.every((l) => near(Math.abs(l[1][1] - l[0][1]), H, 1e-9)), `brick-lines: a head joint spans one course, ${H} mm`);
  const xs = heads.map((l) => l[0][0]).sort((a, b) => a - b);
  ok(near(xs[1] - xs[0], off * L, 1e-9), `brick-lines: the upper course is slid ${(off * L).toFixed(2)} mm — a ${off} bond`);
  ok(near(cellOf('brick-lines').h, 2 * H), 'brick-lines: the cell is two courses tall');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
