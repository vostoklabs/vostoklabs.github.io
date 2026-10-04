// The Islamic, uniform-tiling and living-hinge families, held to the things that make them
// what they claim to be: a tiling really tiles (every vertex sums to 360° and the vertex
// configuration is the named one), a hole pattern really leaves its web, a lines pattern
// refuses to cut, and a hinge stays one piece — rows offset by half a period, slits clear of
// the edge. Plus Fenner's bend radius against the published 3 mm ply row.
//   node tests/islamic-tilings-hinges.test.mjs
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });
const bundle = `${here}.cache/itest-${process.pid}.mjs`;
await esbuild({
  stdin: {
    contents: "export * from '../src/index';\nexport { hingeBendRadius } from '../src/patterns/hinges';\nexport { insetRing, PHI } from '../src/patterns/tilings';\nexport { picStrapwork, starInner } from '../src/patterns/islamic';\n",
    resolveDir: here,
    sourcefile: 'entry-itest.ts',
    loader: 'ts',
  },
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', loader: { '.json': 'json' },
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

const ISLAMIC = ['star-cross-8', 'khatam-6', 'star-polygon', 'zellige-8', 'rosette-12'];
const TILINGS = ['cairo', 'snub-square', 'truncated-square', 'truncated-hex', 'rhombitrihexagonal', 'deltoidal', 'penrose'];
const HINGES = ['living-hinge', 'wave-hinge', 'diamond-hinge', 'cross-hinge', 'honeycomb-hinge', 'spring-hinge'];
const CUTTERS = ['star-cross-8', 'khatam-6', 'star-polygon', 'cairo', 'snub-square', 'truncated-hex', 'rhombitrihexagonal'];
const LINERS = ['zellige-8', 'rosette-12', 'truncated-square', 'deltoidal', 'penrose'];
const MINE = [...ISLAMIC, ...TILINGS, ...HINGES];

const def = (id) => {
  const d = P.patternById(id);
  if (!d) throw new Error(`no pattern ${id}`);
  return d;
};
const disc = (r) => [[P.circle(0, 0, r, 160)]];
const rectRegion = (w, h) => [[P.rect(0, 0, w, h)]];
const defaults = (d) => P.resolveParams(d, {});

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
const bbox = (ring) => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  }
  return b;
};
const apart = (a, b, slack) => a.minX - b.maxX > slack || b.minX - a.maxX > slack || a.minY - b.maxY > slack || b.minY - a.maxY > slack;
function ringDistance(r1, r2) {
  let best = Infinity;
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i];
    const b = r1[(i + 1) % r1.length];
    for (let j = 0; j < r2.length; j++) best = Math.min(best, segDist(a, b, r2[j], r2[(j + 1) % r2.length]));
  }
  return best;
}

// ---- 1. every pattern of mine: finite geometry in every op it claims ----
console.log(`checking ${MINE.length} patterns`);
for (const id of MINE) {
  const d = def(id);
  for (const op of d.ops) {
    const r = P.fillShape(disc(45), d, { op });
    const pts = [...r.shapes.flat(2), ...r.paths.flat()];
    ok(pts.length > 0, `${id}/${op}: draws something in a 90 mm disc (${r.warnings.join('; ')})`);
    ok(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `${id}/${op}: finite coordinates`);
  }
  ok(d.params.every((s) => s.key && s.label && s.kind), `${id}: params well-formed`);
  ok(typeof d.blurb === 'string' && d.blurb.length > 10, `${id}: has a blurb`);
}

// ---- 2. cut: the web the pattern promises is the web it leaves, and nothing crosses the edge ----
for (const id of CUTTERS) {
  const d = def(id);
  const p = defaults(d);
  const web = d.web(p);
  const R = 45;
  const r = P.fillShape(disc(R), d, { op: 'cut', web });
  ok(r.shapes.length > 8, `${id}/cut: ${r.shapes.length} holes in a 90 mm disc`);
  ok(r.warnings.length === 0, `${id}/cut: no warnings (${r.warnings.join('; ')})`);
  // Everything that crossed the edge was clipped to it, as Engrave clips it: what is cut clears the
  // rim by the web.
  const worst = Math.max(...r.shapes.flat(2).map(([x, y]) => Math.hypot(x, y)));
  ok(worst <= R - web + 0.02, `${id}/cut: furthest point ${worst.toFixed(2)} ≤ ${R - web}`);
  ok((r.stats.clipped ?? 0) > 0, `${id}/cut: ${r.stats.clipped ?? 0} shapes clipped at the rim, not dropped`);
  // No two holes closer than the promised web.
  const rings = r.shapes.map((i) => i[0]);
  const boxes = rings.map(bbox);
  let closest = Infinity;
  let pair = '';
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      if (apart(boxes[i], boxes[j], web + 0.5)) continue;
      const dd = ringDistance(rings[i], rings[j]);
      if (dd < closest) { closest = dd; pair = `${i}/${j}`; }
    }
  }
  ok(closest >= web - 0.01, `${id}/cut: closest pair ${closest.toFixed(3)} ≥ ${web} (${pair})`);
}

// ---- 3. a pattern made of lines cuts as a lattice: lines for struts, no holes of its own, no complaint ----
for (const id of LINERS) {
  const r = P.fillShape(disc(40), def(id), { op: 'cut' });
  ok(r.shapes.length === 0 && r.paths.length === 0 && r.lattice?.runs.length > 0, `${id}: cut is a lattice (${r.lattice?.runs.length ?? 0} runs)`);
  ok(r.warnings.length === 0, `${id}: no warning (${r.warnings[0] ?? ''})`);
}

// ---- 4. the tilings really tile: every vertex closes to 360°, at the named configuration ----
/** The polygons of one period, whichever way the tile hands them over. */
function tilePolys(d, params) {
  const p = P.resolveParams(d, params);
  const g = d.tile(p);
  const rings = g.holes.map((i) => i[0]).concat(
    g.lines.filter((l) => l.length > 3 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-9).map((l) => l.slice(0, -1)),
  );
  return { cell: d.cell(p), rings };
}
function patch(d, params, span = 2) {
  const { cell, rings } = tilePolys(d, params);
  const out = [];
  const seen = new Set();
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      for (const r of rings) {
        const moved = r.map(([x, y]) => [x + i * cell.w, y + j * cell.h]);
        let cx = 0;
        let cy = 0;
        for (const q of moved) { cx += q[0]; cy += q[1]; }
        const k = `${Math.round((cx / moved.length) * 1000)},${Math.round((cy / moved.length) * 1000)},${moved.length}`;
        if (seen.has(k)) continue;   // a tile drawn by both of its neighbours
        seen.add(k);
        out.push(moved);
      }
    }
  }
  return { cell, rings, polys: out };
}
/** The INTERIOR angle at vertex i, reflex corners included — a star's notch is 225°, not 135°,
 *  and a vertex only closes when those are counted. Ring must run counter-clockwise. */
const angleAt = (ring, i) => {
  const v = ring[i];
  const a = ring[(i + ring.length - 1) % ring.length];
  const b = ring[(i + 1) % ring.length];
  const t = Math.atan2(a[1] - v[1], a[0] - v[0]) - Math.atan2(b[1] - v[1], b[0] - v[0]);
  return (((t * 180) / Math.PI) % 360 + 360) % 360;
};
function configAt(polys, v) {
  let sum = 0;
  const sides = [];
  for (const r of polys) {
    const ccw = P.signedArea(r) > 0 ? r : [...r].reverse();
    for (let i = 0; i < ccw.length; i++) {
      if (Math.hypot(ccw[i][0] - v[0], ccw[i][1] - v[1]) < 1e-6) {
        sum += angleAt(ccw, i);
        sides.push(ccw.length);
      }
    }
  }
  return { sum, sides: sides.sort((a, b) => a - b).join('.') };
}

// Tiling id → the vertex configuration that must appear, and the params to draw it bare.
const CONFIGS = [
  ['truncated-square', {}, '4.8.8'],
  ['truncated-hex', { gap: 0 }, '3.12.12'],
  ['rhombitrihexagonal', { gap: 0 }, '3.4.4.6'],
  ['snub-square', { gap: 0 }, '3.3.3.4.4'],
  ['cairo', { gap: 0 }, '5.5.5.5'],
  ['deltoidal', {}, '4.4.4.4.4.4'],
  ['star-cross-8', { gap: 0 }, '16.16.16.16'],
  ['khatam-6', { gap: 0 }, '6.6.12.12'],
];
for (const [id, params, want] of CONFIGS) {
  const { rings, polys } = patch(def(id), params);
  // Every vertex of the middle cell's own tiles is completely surrounded.
  let worst = 360;
  let sample = null;
  for (const r of rings) {
    for (const v of r) {
      const c = configAt(polys, v);
      if (Math.abs(c.sum - 360) > Math.abs(worst - 360)) worst = c.sum;
      if (c.sides === want) sample = c;
    }
  }
  ok(Math.abs(worst - 360) < 0.5, `${id}: every vertex closes (worst ${worst.toFixed(2)}°)`);
  ok(sample !== null, `${id}: the ${want} vertex is there`);
  if (sample) ok(Math.abs(sample.sum - 360) < 0.01, `${id}: ${want} sums to ${sample.sum.toFixed(2)}°`);
}

// ---- 5. Hankin's contact angle does what it says: point angle = 180° − 2α ----
{
  const oct = P.regularPolygon(0, 0, 10, 8, Math.PI / 8);
  for (const alpha of [60, 67.5, 75]) {
    const straps = P.picStrapwork(oct, alpha);
    ok(straps.length === 16, `pic: an octagon gives ${straps.length} strap segments at ${alpha}°`);
    // Two straps leave each edge midpoint; the angle between them is the star's point.
    const m = straps[0][0];
    const pairs = straps.filter((s) => Math.hypot(s[0][0] - m[0], s[0][1] - m[1]) < 1e-9);
    ok(pairs.length === 2, `pic: two straps from every midpoint at ${alpha}°`);
    const ang = (s) => Math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0]);
    let d = Math.abs(ang(pairs[0]) - ang(pairs[1])) * (180 / Math.PI);
    if (d > 180) d = 360 - d;
    ok(Math.abs(d - (180 - 2 * alpha)) < 0.01, `pic: point angle ${d.toFixed(2)}° = 180 − 2×${alpha}`);
  }
  // The {8/3} star the 4.8.8 skeleton is famous for: α = 67.5° puts the inner vertices at the
  // star-polygon's own radius.
  const A = 10 * Math.cos(Math.PI / 8);            // the octagon's apothem
  const straps = P.picStrapwork(P.regularPolygon(0, 0, 10, 8, Math.PI / 8), 67.5);
  const rIn = Math.min(...straps.map((s) => Math.hypot(s[1][0], s[1][1])));
  ok(Math.abs(rIn - P.starInner(8, 3, A)) < 1e-6, `pic: α = 67.5° draws the {8/3} star (${rIn.toFixed(4)} vs ${P.starInner(8, 3, A).toFixed(4)})`);
}

// ---- 6. hinges: slits only, half-period stagger, and clear of the edge ----
for (const id of HINGES) {
  const d = def(id);
  const p = defaults(d);
  const g = d.tile(p);
  const cell = d.cell(p);
  ok(g.holes.length === 0 && g.lines.length === 0 && g.slits.length > 1, `${id}: puts everything in slits (${g.slits.length})`);
  // Staggered: the period shifted by half a cell each way is the same set of slits.
  const wrap = (v, period) => {
    const x = Math.round((((v % period) + period) % period) * 1000) / 1000;
    return Math.abs(x - period) < 0.002 ? 0 : x;
  };
  const centres = (dx, dy) => g.slits.map((s) => {
    let cx = 0;
    let cy = 0;
    for (const q of s) { cx += q[0]; cy += q[1]; }
    return `${wrap(cx / s.length + dx, cell.w)},${wrap(cy / s.length + dy, cell.h)}`;
  }).sort().join('|');
  ok(centres(0, 0) === centres(cell.w / 2, cell.h / 2), `${id}: rows offset by half a period`);
  // Every slit keeps the web to the edge, and cutting hands them back as open runs.
  const r = P.fillShape(rectRegion(80, 40), d, { op: 'cut', web: 2 });
  ok(r.paths.length > 4 && r.shapes.length === 0, `${id}/cut: ${r.paths.length} slits as open runs`);
  ok(r.paths.flat().every(([x, y]) => Math.abs(x) <= 40 - 1.98 && Math.abs(y) <= 20 - 1.98), `${id}/cut: slits keep the 2 mm web to the edge`);
  const slotted = P.fillShape(rectRegion(80, 40), d, { op: 'cut', web: 2, slitWidth: 0.3 });
  ok(slotted.shapes.length >= r.paths.length && slotted.paths.length === 0, `${id}/cut: slitWidth turns the slits into slots`);
  ok(d.web(p) > 0.4, `${id}: promises a real web (${d.web(p).toFixed(2)} mm)`);
}

// ---- 7. the bend-radius helper against the published 3 mm ply row ----
{
  // Family 5 of the catalogue: 3 mm birch ply, 15–20 mm slots, 1–1.4 mm webs, 3–4 mm rows →
  // a minimum bend radius of about 10–12 mm.
  const mid = P.hingeBendRadius({ length: 18, gap: 1.2, spacing: 3.5 }, 3);
  ok(mid >= 10 && mid <= 12, `bend radius: the published 3 mm row gives ${mid.toFixed(1)} mm (10–12)`);
  for (const row of [[15, 1, 3], [20, 1.4, 4], [15, 1.4, 4], [20, 1, 3]]) {
    const v = P.hingeBendRadius({ length: row[0], gap: row[1], spacing: row[2] }, 3);
    ok(v > 7 && v < 17, `bend radius: ${row.join('/')} → ${v.toFixed(1)} mm stays in the published family`);
  }
  const tight = P.hingeBendRadius({ length: 18, gap: 1.2, spacing: 2 }, 3);
  const loose = P.hingeBendRadius({ length: 18, gap: 1.2, spacing: 6 }, 3);
  ok(tight < mid && mid < loose, `bend radius: closer rows bend tighter (${tight.toFixed(1)} < ${mid.toFixed(1)} < ${loose.toFixed(1)})`);
  ok(P.hingeBendRadius({ length: 18, gap: 1.2, spacing: 3.5 }, 6) > 2 * mid - 0.01, 'bend radius: twice the thickness, twice the radius');
  ok(P.hingeBendRadius({ length: 30, gap: 1.2, spacing: 3.5 }, 3) < mid, 'bend radius: longer slits bend tighter');
  // The default living hinge is a sane 3 mm ply hinge.
  const lh = defaults(def('living-hinge'));
  const r = P.hingeBendRadius({ length: lh.length, gap: lh.gap, spacing: lh.spacing }, 3);
  ok(r > 4 && r < 12, `bend radius: the living-hinge defaults roll to ${r.toFixed(1)} mm in 3 mm ply`);
}

// ---- 8. the inset that makes every web here ----
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const inner = P.insetRing(sq, 1);
  ok(inner.every(([x, y]) => Math.min(x, y) > 0.99 && Math.max(x, y) < 9.01), 'insetRing: a square shrinks by 1 on every side');
  const tri = P.insetRing([[0, 0], [10, 0], [5, 8.66]], 1);
  ok(Math.abs(P.signedArea(tri)) < Math.abs(P.signedArea([[0, 0], [10, 0], [5, 8.66]])), 'insetRing: a triangle shrinks');
  // A reflex corner is offset too, not scaled: the notch of a plus stays a right angle.
  const plus = [[-1, -3], [1, -3], [1, -1], [3, -1], [3, 1], [1, 1], [1, 3], [-1, 3], [-1, 1], [-3, 1], [-3, -1], [-1, -1]];
  const inset = P.insetRing(plus, 0.5);
  ok(inset.length === 12 && Math.abs(inset[2][0] - 0.5) < 1e-9 && Math.abs(inset[2][1] + 0.5) < 1e-9, 'insetRing: the reflex corner of a plus moves outward, not in');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
