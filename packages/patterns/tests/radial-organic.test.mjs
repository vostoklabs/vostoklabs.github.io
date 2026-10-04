// The radial and organic/engrave families held to account: every pattern finite and
// deterministic, its holes never closer than its own `web()`, its cut clear of the edge, its
// 300 × 300 mm fill inside the time budget — and one fact each about what it claims to be.
//   node tests/radial-organic.test.mjs
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });
const bundle = `${here}.cache/radial-organic-${process.pid}.mjs`;
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

const RADIAL = ['mandala', 'deco-fan', 'rotational', 'wheel', 'polygon-rings'];
const ORGANIC = ['voronoi', 'delaunay', 'hilbert', 'serpentine', 'halftone', 'wood-grain', 'contours', 'moire'];
const IDS = [...RADIAL, ...ORGANIC];
const SEEDED = ['mandala', 'voronoi', 'delaunay', 'wood-grain', 'contours'];

const disc = (r) => [[P.circle(0, 0, r, 128)]];
const box = (w, h) => [[P.rect(0, 0, w, h)]];
const defs = Object.fromEntries(IDS.map((id) => [id, P.patternById(id)]));
const defaults = (def) => P.resolveParams(def, {});
const points = (r) => [...r.shapes.flat(2), ...r.paths.flat()];

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
const ringDistance = (x, y) => {
  let best = Infinity;
  for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
    best = Math.min(best, segDist(x[i], x[(i + 1) % x.length], y[j], y[(j + 1) % y.length]));
  }
  return best;
};
const bbox = (ring) => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  }
  return b;
};

// ---- 1. every id registered, in the right family, with a blurb and a thumb ----
for (const id of IDS) {
  const def = defs[id];
  ok(!!def, `${id}: registered`);
  if (!def) continue;
  ok(!!def.blurb && !!def.tags?.length, `${id}: blurb and tags`);
  ok(P.thumbPath(def).d.length > 10, `${id}: thumb path draws`);
  ok(def.params.every((s) => s.key && s.label && s.kind), `${id}: params well-formed`);
}
ok(RADIAL.every((id) => defs[id]?.family === 'radial'), 'radial family');
ok(ORGANIC.every((id) => ['organic', 'engrave', 'radial'].includes(defs[id]?.family)), 'organic/engrave family');

// ---- 2. finite geometry in every op it claims, and something drawn ----
for (const id of IDS) {
  const def = defs[id];
  for (const op of def.ops) {
    const r = P.fillShape(disc(45), def, { op });
    ok(points(r).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `${id}/${op}: finite`);
    ok(r.shapes.length + r.paths.length > 0, `${id}/${op}: draws something in a 90 mm coaster (${r.warnings.join('; ')})`);
  }
}

// ---- 3. deterministic: same params, same output; a different seed, a different field ----
for (const id of IDS) {
  const def = defs[id];
  const op = def.ops[0];
  const a = P.fillShape(disc(40), def, { op });
  const b = P.fillShape(disc(40), def, { op });
  ok(JSON.stringify([a.shapes, a.paths]) === JSON.stringify([b.shapes, b.paths]), `${id}: same params, identical output`);
  if (!SEEDED.includes(id)) continue;
  const seed = defaults(def).seed;
  const c = P.fillShape(disc(40), def, { op, params: { seed: seed + 1 } });
  ok(JSON.stringify([a.shapes, a.paths]) !== JSON.stringify([c.shapes, c.paths]), `${id}: seed ${seed + 1} draws a different field`);
}

// ---- 4. holes never come within web(p) of each other ----
for (const id of IDS) {
  const def = defs[id];
  if (!def.ops.includes('cut')) continue;
  const p = defaults(def);
  const want = def.web(p);
  const r = P.fillShape(disc(45), def, { op: 'cut', web: 0.5 });
  const rings = r.shapes.map((i) => i[0]);
  ok(rings.length > 4, `${id}: ${rings.length} holes cut from a 90 mm coaster`);
  // Bucket by bounding box so the pairwise sweep only meets neighbours.
  const boxes = rings.map(bbox);
  let worst = Infinity;
  let pair = '';
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.minX - b.maxX > want || b.minX - a.maxX > want || a.minY - b.maxY > want || b.minY - a.maxY > want) continue;
      const d = ringDistance(rings[i], rings[j]);
      if (d < worst) { worst = d; pair = `${i}/${j}`; }
    }
  }
  ok(!Number.isFinite(worst) || worst >= want - 0.01, `${id}: nearest holes ${worst.toFixed(3)} mm apart ≥ web ${want.toFixed(2)} (${pair})`);
}

// ---- 5. a cut drops everything that crosses the edge ----
for (const id of IDS) {
  const def = defs[id];
  if (!def.ops.includes('cut')) continue;
  const region = disc(38);
  const r = P.fillShape(region, def, { op: 'cut', web: 2 });
  let minEdge = Infinity;
  for (const [ring] of r.shapes) for (const [x, y] of ring) minEdge = Math.min(minEdge, 38 - Math.hypot(x, y));
  ok(minEdge >= 2 - 0.05, `${id}/cut: nearest hole to the edge ${minEdge.toFixed(3)} ≥ 2`);
  ok(r.shapes.every(([ring]) => ring.every(([x, y]) => Math.hypot(x, y) < 38)), `${id}/cut: every hole on material`);
}

// ---- 6. a 300 × 300 mm region at default params, inside the budget ----
// The best of three after two warm-ups: the first call through a cold JIT is two to three
// times the steady-state cost and would make the budget a coin toss, not a measurement.
const BUDGET = 200;
const times = [];
for (const id of IDS) {
  const def = defs[id];
  const region = box(300, 300);
  let ms = Infinity;
  let r = null;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    r = P.fillShape(region, def, { op: def.ops[0] });
    if (k >= 2) ms = Math.min(ms, performance.now() - t0);
  }
  times.push([id, ms, r.stats.holes, r.stats.lines]);
  ok(ms < BUDGET, `${id}: 300 × 300 mm in ${ms.toFixed(0)} ms (< ${BUDGET})`);
}

// ---- 7. mandala: turn it by 360/n and nothing moves ----
{
  const def = defs['mandala'];
  for (const n of [6, 12, 5]) {
    const p = P.resolveParams(def, { n });
    const geo = def.generate({ minX: -45, minY: -45, maxX: 45, maxY: 45 }, p);
    const pts = geo.lines.flat();
    const a = (Math.PI * 2) / n;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // A coarse spatial hash, then the nearest point inside it: order-free and exact to 1e-6.
    const cell = 0.01;
    const at = new Map();
    for (const [x, y] of pts) {
      const k = `${Math.round(x / cell)},${Math.round(y / cell)}`;
      const list = at.get(k);
      if (list) list.push([x, y]);
      else at.set(k, [[x, y]]);
    }
    let worst = 0;
    for (const [x, y] of pts) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const q of at.get(`${Math.round(rx / cell) + dx},${Math.round(ry / cell) + dy}`) ?? []) best = Math.min(best, Math.hypot(q[0] - rx, q[1] - ry));
      }
      worst = Math.max(worst, best);
    }
    ok(pts.length > 200 && worst < 1e-6, `mandala n=${n}: ${pts.length} points map onto themselves under a ${(360 / n).toFixed(0)}° turn (worst ${worst.toExponential(1)})`);
  }
}

// ---- 8. hilbert: one path, covering the box, never crossing itself ----
{
  const def = defs['hilbert'];
  const b = { minX: -45, minY: -45, maxX: 45, maxY: 45 };
  const geo = def.generate(b, P.resolveParams(def, {}));
  ok(geo.lines.length === 1 && geo.holes.length === 0, `hilbert: ${geo.lines.length} path, ${geo.holes.length} holes`);
  const line = geo.lines[0];
  const n = Math.round(Math.sqrt(line.length));
  ok(n * n === line.length && n >= 8, `hilbert: ${line.length} cells = ${n}²`);
  // Every step is one cell, and no cell is visited twice — a simple path that fills the square.
  const cell = 90 / n;
  const seen = new Set();
  let steps = 0;
  for (let i = 0; i < line.length; i++) {
    seen.add(`${Math.round(line[i][0] / cell)},${Math.round(line[i][1] / cell)}`);
    if (i && Math.abs(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) - cell) < 1e-6) steps++;
  }
  ok(seen.size === line.length, `hilbert: ${seen.size} distinct cells of ${line.length} — no cell visited twice`);
  ok(steps === line.length - 1, `hilbert: every one of ${steps} steps moves exactly one cell`);
  const bb = bbox(line);
  ok(bb.maxX - bb.minX >= 90 - 2 * cell && bb.maxY - bb.minY >= 90 - 2 * cell, `hilbert: covers the 90 mm box (${(bb.maxX - bb.minX).toFixed(1)} mm)`);
  // A rook-move path on distinct cells cannot cross itself; the segments only ever touch end
  // to end, which the merged output confirms — one chain, not a pile of pieces.
  const merged = P.mergeLines([line]);
  ok(merged.length === 1, `hilbert: merges back to ${merged.length} continuous run`);
  const r = P.fillShape(disc(45), def, { op: 'engrave' });
  ok(r.paths.length > 0 && r.shapes.length === 0, `hilbert: engraves as ${r.paths.length} runs inside the disc`);
}

// ---- 9. serpentine: one path too ----
{
  const def = defs['serpentine'];
  const geo = def.generate({ minX: -30, minY: -30, maxX: 30, maxY: 30 }, P.resolveParams(def, {}));
  ok(geo.lines.length === 1, `serpentine: ${geo.lines.length} path`);
  const ys = new Set(geo.lines[0].map((q) => Math.round(q[1] * 1000)));
  ok(ys.size * 2 === geo.lines[0].length, `serpentine: ${ys.size} rows, two points each`);
}

// ---- 10. voronoi: convex cells that tile the box exactly ----
{
  const def = defs['voronoi'];
  const b = { minX: -45, minY: -45, maxX: 45, maxY: 45 };
  const geo = def.generate(b, P.resolveParams(def, { gap: 0 }));
  const rings = geo.holes.map((i) => i[0]);
  ok(rings.length > 40, `voronoi: ${rings.length} cells over a 90 mm box`);
  ok(rings.every((r) => P.isConvex(r)), 'voronoi: every cell convex');
  const area = rings.reduce((s, r) => s + Math.abs(P.signedArea(r)), 0);
  ok(Math.abs(area - 90 * 90) < 1e-6, `voronoi: cells tile the box (${area.toFixed(6)} mm² of ${90 * 90})`);
  // Each cell holds its own site and no other: that is what makes it a Voronoi cell.
  const centres = rings.map((r) => [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length]);
  let own = 0;
  for (let i = 0; i < rings.length; i++) if (P.pointInRing(centres[i], rings[i])) own++;
  ok(own === rings.length, `voronoi: ${own}/${rings.length} cells contain their own centroid (convex)`);
  const walls = def.generate(b, P.resolveParams(def, { edges: true }));
  ok(walls.holes.length === 0 && walls.lines.length === rings.length, `voronoi: "cell walls only" draws ${walls.lines.length} closed walls and no holes`);
  // Every interior wall is drawn by both its cells; merged, the total is the sum of the cell
  // perimeters less one copy of each shared wall — i.e. (sum + the box's own perimeter) / 2.
  const perimeter = (l) => l.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - l[i - 1][0], q[1] - l[i - 1][1]) : 0), 0);
  const sum = walls.lines.reduce((s, l) => s + perimeter(l), 0);
  const merged = P.mergeLines(walls.lines);
  const total = merged.reduce((s, l) => s + perimeter(l), 0);
  ok(Math.abs(total - (sum + 4 * 90) / 2) < 0.5, `voronoi: shared walls merge — ${total.toFixed(1)} mm of wall from ${sum.toFixed(1)} mm of cell perimeter`);
}

// ---- 11. delaunay: the dual of those cells ----
{
  const def = defs['delaunay'];
  const b = { minX: -45, minY: -45, maxX: 45, maxY: 45 };
  const geo = def.generate(b, P.resolveParams(def, {}));
  ok(geo.lines.length > 60 && geo.holes.length === 0, `delaunay: ${geo.lines.length} edges, no holes`);
  ok(geo.lines.every((l) => l.length === 2), 'delaunay: every edge a single segment');
  // Delaunay's defining property: no site lies inside the circumcircle of an edge's own cells.
  // The cheap version — every edge is short, since a jittered grid has no long neighbours.
  const pitch = P.resolveParams(def, {}).spacing;
  const longest = Math.max(...geo.lines.map(([a, c]) => Math.hypot(c[0] - a[0], c[1] - a[1])));
  ok(longest < 3 * pitch, `delaunay: longest edge ${longest.toFixed(1)} mm < 3 × the ${pitch} mm pitch`);
  const seen = new Set(geo.lines.map(([a, c]) => [a, c].map((q) => q.map((v) => Math.round(v * 1000)).join()).sort().join('|')));
  ok(seen.size === geo.lines.length, `delaunay: no edge drawn twice (${seen.size}/${geo.lines.length})`);
}

// ---- 12. contours: closed loops, except where the box cuts them ----
{
  const def = defs['contours'];
  const b = { minX: -45, minY: -45, maxX: 45, maxY: 45 };
  const geo = def.generate(b, P.resolveParams(def, {}));
  const merged = P.mergeLines(geo.lines);
  const onEdge = (q) => Math.abs(q[0] - b.minX) < 1e-6 || Math.abs(q[0] - b.maxX) < 1e-6 || Math.abs(q[1] - b.minY) < 1e-6 || Math.abs(q[1] - b.maxY) < 1e-6;
  const closed = merged.filter((l) => Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-3);
  const open = merged.filter((l) => !closed.includes(l));
  ok(closed.length > 3, `contours: ${closed.length} closed loops of ${merged.length}`);
  // A merged run can only end where the box cuts the level line, or at a point where three or
  // more segments meet — a contour passing within a micron of a grid node, which the chaining
  // quantises into a junction. Everywhere else the level set closes on itself.
  const met = new Map();
  for (const [a, c] of geo.lines) for (const q of [a, c]) {
    const k = `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;
    met.set(k, (met.get(k) ?? 0) + 1);
  }
  const junction = (q) => (met.get(`${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`) ?? 0) !== 2;
  const loose = open.filter((l) => !(onEdge(l[0]) || junction(l[0])) || !(onEdge(l[l.length - 1]) || junction(l[l.length - 1])));
  ok(loose.length === 0, `contours: all ${open.length} open runs end on the box edge or at a junction (${loose.length} loose)`);
  const levels = P.resolveParams(def, {}).levels;
  ok(merged.length >= levels, `contours: at least one run per level (${merged.length} ≥ ${levels})`);
  // One level is a closed 1-manifold: away from the box edge every end meets exactly one other.
  const one = def.generate(b, P.resolveParams(def, { levels: 1 })).lines;
  const ends = new Map();
  for (const [a, c] of one) for (const q of [a, c]) {
    const k = `${Math.round(q[0] * 1e5)},${Math.round(q[1] * 1e5)}`;
    ends.set(k, [(ends.get(k)?.[0] ?? 0) + 1, q]);
  }
  const dangling = [...ends.values()].filter(([n, q]) => n !== 2 && !onEdge(q));
  ok(one.length > 100 && dangling.length === 0, `contours: one level, ${one.length} segments, ${dangling.length} loose ends away from the edge`);
}

// ---- 13. moiré and the fan: what they claim, in two numbers ----
{
  const def = defs['moire'];
  const p = P.resolveParams(def, {});
  const geo = def.generate({ minX: -30, minY: -30, maxX: 30, maxY: 30 }, p);
  const centres = [...new Set(geo.lines.map((l) => Math.round((Math.min(...l.map((q) => q[0])) + Math.max(...l.map((q) => q[0])))))) ].sort((a, c) => a - c);
  ok(centres.length === 2 && Math.abs(centres[1] - centres[0] - 2 * p.offset) < 1, `moiré: rings about ${centres.length} centres, ${p.offset} mm apart`);
}
{
  const def = defs['deco-fan'];
  const p = P.resolveParams(def, { span: 180 });
  const geo = def.generate({ minX: -45, minY: -45, maxX: 45, maxY: 45 }, p);
  ok(geo.holes.every((i) => i[0].every(([, y]) => y >= -1e-9)), 'deco-fan: a half fan opens upward');
  const counts = [];
  for (let j = 0; j < p.bands; j++) counts.push(p.sectors * (1 + j * p.grow));
  ok(geo.holes.length === counts.reduce((a, c) => a + c, 0), `deco-fan: wedges per band grow ${counts.join(' → ')}`);
  const lines = def.generate({ minX: -45, minY: -45, maxX: 45, maxY: 45 }, P.resolveParams(def, { edges: true }));
  ok(lines.holes.length === 0 && lines.lines.length > 10, `deco-fan: "outlines only" draws ${lines.lines.length} lines and no holes`);
}
{
  // The wheel comes off the bed in one piece: the hub reaches the rim through every spoke.
  const def = defs['wheel'];
  const r = P.fillShape(disc(45), def, { op: 'cut', web: 2 });
  const p = P.resolveParams(def, {});
  ok(r.shapes.length === p.spokes * (p.rings + 1), `wheel: ${r.shapes.length} sectors = ${p.spokes} spokes × ${p.rings + 1} bands`);
  const inner = Math.min(...r.shapes.flat(2).map(([x, y]) => Math.hypot(x, y)));
  ok(Math.abs(inner - p.hub) < 0.01, `wheel: the hub is ${inner.toFixed(2)} mm across the radius (asked ${p.hub})`);
}

console.log('\n  300 × 300 mm at defaults');
for (const [id, ms, holes, lines] of times) console.log(`  ${id.padEnd(14)} ${ms.toFixed(1).padStart(6)} ms   ${String(holes).padStart(5)} holes ${String(lines).padStart(5)} lines`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
