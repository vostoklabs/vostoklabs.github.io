// The pattern engine's node suite: bundle src with esbuild, then hold every rule to account.
//   node tests/run.mjs
import { build as esbuild } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });
const bundle = `${here}.cache/bundle-${process.pid}.mjs`;
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

const disc = (r) => [[P.circle(0, 0, r, 128)]];
const rectRegion = (w, h) => [[P.rect(0, 0, w, h)]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const minEdgeDistance = (ring, region) => {
  let best = Infinity;
  for (const island of region) for (const boundary of island) for (let i = 0; i < boundary.length; i++) {
    const c = boundary[i];
    const d = boundary[(i + 1) % boundary.length];
    for (let j = 0; j < ring.length; j++) best = Math.min(best, segDist(ring[j], ring[(j + 1) % ring.length], c, d));
  }
  return best;
};
function segDist(a, b, c, d) {
  const pd = (p, u, v) => {
    const vx = v[0] - u[0], vy = v[1] - u[1];
    const l2 = vx * vx + vy * vy;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - u[0]) * vx + (p[1] - u[1]) * vy) / l2));
    return Math.hypot(p[0] - (u[0] + vx * t), p[1] - (u[1] + vy * t));
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}

// ---- 1. every pattern builds at its defaults, in every op it claims ----
console.log(`patterns: ${P.PATTERNS.length}`);
for (const def of P.PATTERNS) {
  const region = disc(40);
  for (const op of def.ops) {
    const r = P.fillShape(region, def, { op });
    const finite = [...r.shapes.flat(2), ...r.paths.flat()].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    ok(finite, `${def.id}/${op}: finite coordinates`);
    // A cut punches its holes as drawn, or cuts its lines (or shapes that meet) as a lattice for
    // the host, or — nothing left above the floors — says so in one sentence.
    const said = op === 'cut' && r.warnings.some((w) => /too (?:small|fine) to cut|Nothing of/.test(w));
    ok(r.shapes.length + r.paths.length > 0 || (op === 'cut' && !!r.lattice) || said, `${def.id}/${op}: draws something in an 80 mm disc, or says why not (${r.warnings.join('; ')})`);
    // Everything stays on the disc (a hair of slack for the chords of the clip) — unless a
    // concave engrave crossed the edge and was left whole for the host's boolean, which the
    // stats say.
    const far = [...r.shapes.flat(2), ...r.paths.flat()].filter(([x, y]) => Math.hypot(x, y) > 40 + 0.05);
    ok(far.length === 0 || r.stats.unclipped > 0, `${def.id}/${op}: ${far.length} points outside the disc`);
  }
  const t = P.thumbPath(def);
  ok(t.d.length > 10, `${def.id}: thumb path`);
  ok(def.params.every((s) => s.key && s.label && s.kind), `${def.id}: params well-formed`);
}

// ---- 2. cut holes respect the web against the edge and each other ----
{
  const region = disc(30);
  const r = P.fillShape(region, P.patternById('dots'), { op: 'cut', params: { size: 4, gap: 2 }, web: 2 });
  ok(r.shapes.length > 30, `dots: ${r.shapes.length} holes in a 60 mm disc`);
  let minEdge = Infinity;
  for (const [ring] of r.shapes) minEdge = Math.min(minEdge, minEdgeDistance(ring, region));
  ok(minEdge >= 2 - 0.02, `dots: nearest hole to the edge ${minEdge.toFixed(3)} ≥ 2`);
  // The wall between two holes, measured ring to ring: a dot the rim clipped is no whole circle,
  // and its box's centre is not its dot's.
  let minPair = Infinity;
  for (let i = 0; i < r.shapes.length; i++) for (let j = i + 1; j < r.shapes.length; j++) {
    const a = P.bboxOfShapes([r.shapes[i]]);
    const b = P.bboxOfShapes([r.shapes[j]]);
    if (Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY) > 3) continue;
    minPair = Math.min(minPair, ringGap(r.shapes[i][0], r.shapes[j][0]));
  }
  ok(minPair >= 2 - 0.01, `dots: nearest pair web ${minPair.toFixed(3)} ≥ 2`);
  ok(r.shapes.every(([ring]) => ring.every((p) => Math.hypot(p[0], p[1]) < 30)), 'dots: all holes inside');
  // A hole dead on the centre.
  ok(r.shapes.some(([ring]) => { const b = P.bboxOfShapes([[ring]]); return Math.abs(b.minX + b.maxX) < 1e-6 && Math.abs(b.minY + b.maxY) < 1e-6; }), 'dots: a hole centred on the region');
}

// ---- 3. an annulus keeps its inner edge clear too ----
{
  const region = [[P.circle(0, 0, 30, 96), P.circle(0, 0, 12, 48)]];
  const r = P.fillShape(region, P.patternById('honeycomb'), { op: 'cut', params: { size: 5, gap: 1.5 }, web: 1.5 });
  ok(r.shapes.length > 20, `annulus: ${r.shapes.length} hex holes`);
  ok(r.shapes.every(([ring]) => ring.every((p) => Math.hypot(p[0], p[1]) > 12 + 1.4 && Math.hypot(p[0], p[1]) < 30 - 1.4)), 'annulus: every hole clear of both edges');
}

// ---- 4. lines are clipped and merged ----
{
  const region = disc(25);
  const r = P.fillShape(region, P.patternById('kikko'), { op: 'score', params: { size: 8 } });
  ok(r.paths.length + r.shapes.length > 10, `kikko: ${r.paths.length} runs + ${r.shapes.length} whole hexagons`);
  ok(r.paths.flat().every((p) => Math.hypot(p[0], p[1]) <= 25 + 0.01), 'kikko: runs inside the disc');
  // No segment drawn twice: merge every path back and count.
  const segs = new Set();
  let dup = 0;
  for (const path of [...r.paths, ...r.shapes.map(([ring]) => [...ring, ring[0]])]) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i].map((v) => Math.round(v * 1000)).join(',');
      const b = path[i + 1].map((v) => Math.round(v * 1000)).join(',');
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (segs.has(k)) dup++;
      segs.add(k);
    }
  }
  ok(dup === 0, `kikko: ${dup} duplicate segments`);
}
{
  // Four half-lines from four cells become one line; two overlapping collinear pieces become one.
  const merged = P.mergeLines([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]], [[1.5, 0], [2.5, 0]], [[0, 0], [0, 1]]]);
  ok(merged.length === 1 && merged[0].length === 3, `mergeLines: ${merged.length} polylines (${merged[0]?.length} points) from 5 overlapping segments`);
  const square = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]], [[0, 0], [1, 0]]];
  const loop = P.mergeLines(square);
  ok(loop.length === 1 && loop[0].length === 5, `mergeLines: a square drawn with a duplicate edge → one closed chain of 5 points (${loop.length}/${loop[0]?.length})`);
}

// ---- 5. engrave clips convex shapes to the edge ----
{
  const region = rectRegion(40, 40);
  const r = P.fillShape(region, P.patternById('checkerboard'), { op: 'engrave', params: { size: 6 } });
  const inside = r.shapes.flat(2).every(([x, y]) => x >= -20 - 1e-6 && x <= 20 + 1e-6 && y >= -20 - 1e-6 && y <= 20 + 1e-6);
  ok(inside, 'checkerboard: clipped squares stay inside the square');
  ok(near(r.stats.area, 800, 40), `checkerboard: half the area filled (${r.stats.area.toFixed(1)} ≈ 800)`);
  ok(r.stats.unclipped === 0, 'checkerboard: nothing left unclipped');
}
{
  // Concave shapes crossing the edge go through the general intersection: clipped exactly,
  // nothing left for the host.
  const r = P.fillShape(disc(20), P.patternById('crosses'), { op: 'engrave', params: { size: 8, arm: 2.5, gap: 2 } });
  ok(r.stats.unclipped === 0 && r.shapes.length > 10, `crosses: ${r.stats.unclipped} left unclipped, ${r.shapes.length} shapes`);
  const far = r.shapes.flat(2).filter(([x, y]) => Math.hypot(x, y) > 20 + 0.02);
  ok(far.length === 0, `crosses: clipped crosses stay inside the disc (${far.length} points out)`);
  // A star crossing the edge (concave, one ring) and a ring-with-hole crossing it both clip.
  const s = P.fillShape(disc(20), P.patternById('stars'), { op: 'engrave', params: { size: 9, gap: 2 } });
  ok(s.stats.unclipped === 0 && s.shapes.flat(2).every(([x, y]) => Math.hypot(x, y) <= 20 + 0.02), 'stars: concave stars clipped exactly at the edge');
  const annulusTile = P.svgTilePattern({ id: 'ann', name: 'Ann', width: 10, height: 10, paths: ['M1 1h8v8h-8z M3 3h4v4h-4z'], mode: 'fill' }, P.flattenPathData);
  const a = P.fillShape(disc(14), annulusTile, { op: 'engrave', params: { size: 10 } });
  const crossing = a.shapes.filter((i) => i.length > 1 && i[0].some(([x, y]) => Math.hypot(x, y) > 13.9));
  ok(a.stats.unclipped === 0 && a.shapes.flat(2).every(([x, y]) => Math.hypot(x, y) <= 14 + 0.02), `frames with holes clip at the edge and keep their holes (${crossing.length} clipped frames still holey)`);
}

// ---- 6. the inset ----
{
  const shrunk = P.insetShapes(disc(20), 2);
  ok(shrunk && shrunk[0][0].every((p) => near(Math.hypot(p[0], p[1]), 18, 0.02)), 'insetShapes: a disc shrinks to R − 2');
  const box = P.insetShapes(rectRegion(20, 10), 2);
  const b = P.bboxOfShapes(box);
  ok(near(b.maxX - b.minX, 16) && near(b.maxY - b.minY, 6), `insetShapes: a 20×10 box → ${(b.maxX - b.minX).toFixed(2)}×${(b.maxY - b.minY).toFixed(2)}`);
  ok(P.insetShapes(rectRegion(20, 3), 2) === null, 'insetShapes: a 3 mm strip cannot take a 2 mm margin');
  const ann = P.insetShapes([[P.circle(0, 0, 20, 64), P.circle(0, 0, 5, 32)]], 1);
  ok(ann && ann[0].length === 2 && ann[0][1].every((p) => near(Math.hypot(p[0], p[1]), 6, 0.02)), 'insetShapes: a hole grows by the margin');
}

// ---- 7. the SVG path parser ----
{
  const sq = P.flattenPathData('M0 0h10v10h-10z');
  ok(sq.rings.length === 1 && sq.rings[0].length === 4, `svgpath: rect → ${sq.rings.length} ring of ${sq.rings[0]?.length}`);
  const a = P.flattenPathData('M0 0A5 5 0 0 1 10 0', 0.01);
  const last = a.polylines[0][a.polylines[0].length - 1];
  const maxR = Math.max(...a.polylines[0].map((p) => Math.hypot(p[0] - 5, p[1])));
  ok(near(last[0], 10) && near(last[1], 0) && near(maxR, 5, 0.02), `svgpath: arc ends at (10,0) with radius 5 (${maxR.toFixed(3)})`);
  const c = P.flattenPathData('M0 0c5 0 5 10 10 10s5-10 10-10', 0.05);
  const end = c.polylines[0][c.polylines[0].length - 1];
  ok(near(end[0], 20) && near(end[1], 0) && c.polylines[0].length > 8, `svgpath: cubic + smooth end at (20,0), ${c.polylines[0].length} points`);
  const m = P.flattenPathData('M1 1 2 2 3 1z M5 5l1 0 0 1z');
  ok(m.rings.length === 2, `svgpath: implicit line-tos after M and two subpaths (${m.rings.length})`);
  const flags = P.flattenPathData('M0 0a5 5 0 0110 0a5 5 0 0110 0');
  const e = flags.polylines[0][flags.polylines[0].length - 1];
  ok(near(e[0], 20) && near(e[1], 0), 'svgpath: glued arc flags');
}

// ---- 8. living hinge slits ----
{
  const region = rectRegion(80, 40);
  const r = P.fillShape(region, P.patternById('living-hinge'), { op: 'cut', web: 2 });
  ok(r.paths.length > 20 && r.shapes.length === 0, `hinge: ${r.paths.length} slits as open paths`);
  ok(r.paths.flat().every(([x, y]) => Math.abs(x) <= 40 - 1.95 && Math.abs(y) <= 20 - 1.95), 'hinge: slits keep the 2 mm web to the edge');
  const s = P.fillShape(region, P.patternById('living-hinge'), { op: 'cut', web: 2, slitWidth: 0.3 });
  ok(s.shapes.length === r.paths.length && s.paths.length === 0, `hinge: slitWidth turns ${r.paths.length} slits into ${s.shapes.length} slots`);
  const lines = P.fillShape(region, P.patternById('living-hinge'), { op: 'score' });
  ok(lines.paths.length > 20, 'hinge: scores as lines');
}

// ---- 9. rotation, scale, offset, determinism ----
{
  const a = P.fillShape(disc(30), P.patternById('hatch'), { op: 'engrave', params: { spacing: 2 }, angle: 45 });
  const dirs = a.paths.map((p) => Math.atan2(p[p.length - 1][1] - p[0][1], p[p.length - 1][0] - p[0][0]));
  ok(dirs.every((d) => near(Math.abs(Math.tan(d)), 1, 1e-6)), 'hatch: lines run at 45°');
  const s1 = P.fillShape(disc(30), P.patternById('stipple'), { op: 'engrave', params: { seed: 11 } });
  const s2 = P.fillShape(disc(30), P.patternById('stipple'), { op: 'engrave', params: { seed: 11 } });
  ok(JSON.stringify(s1.shapes) === JSON.stringify(s2.shapes), 'stipple: same seed, same field');
  const s3 = P.fillShape(disc(30), P.patternById('stipple'), { op: 'engrave', params: { seed: 12 } });
  ok(JSON.stringify(s1.shapes) !== JSON.stringify(s3.shapes), 'stipple: different seed, different field');
  const big = P.fillShape(disc(30), P.patternById('dots'), { op: 'cut', scale: 2, params: { size: 4, gap: 2 } });
  const small = P.fillShape(disc(30), P.patternById('dots'), { op: 'cut', scale: 1, params: { size: 4, gap: 2 } });
  ok(big.shapes.length < small.shapes.length / 2, `scale 2 → fewer holes (${big.shapes.length} vs ${small.shapes.length})`);
  const moved = P.fillShape(disc(30), P.patternById('dots'), { op: 'cut', dx: 3, params: { size: 4, gap: 2 } });
  ok(moved.shapes.some(([ring]) => { const b = P.bboxOfShapes([[ring]]); return near((b.minX + b.maxX) / 2, 3, 1e-6) && near((b.minY + b.maxY) / 2, 0, 1e-6); }), 'dx moves the centred hole');
}

// ---- 10. warnings say what went wrong ----
{
  // A pattern of lines no longer refuses a cut: it hands back a lattice, and says nothing.
  const r = P.fillShape(disc(30), P.patternById('kikko'), { op: 'cut' });
  ok(r.shapes.length === 0 && r.paths.length === 0 && r.lattice && r.warnings.length === 0, `lines-only pattern cuts as a lattice, quietly (${r.warnings[0] ?? 'no warning'})`);
  // Holes closer than the web asked for give way by half the shortfall each (round 5: the Web
  // governs every cut): the walls come out at the web, and there is nothing to say.
  const tight = P.fillShape(disc(30), P.patternById('dots'), { op: 'cut', params: { size: 4, gap: 0.8 }, web: 1.5 });
  const wall = (() => {
    let best = Infinity;
    const rings = tight.shapes.map((i) => i[0]);
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) best = Math.min(best, ringGap(rings[i], rings[j]));
    return best;
  })();
  ok(tight.shapes.length > 20 && wall >= 1.5 - 0.02 && wall < 1.5 + 0.05 && tight.warnings.length === 0 && (tight.stats.gaveWay ?? 0) > 20, `web short: 0.8 mm gaps give way to ${wall.toFixed(3)} mm walls, nothing said (${tight.shapes.length} holes, ${tight.stats.gaveWay ?? 0} gave way, ${tight.warnings[0] ?? 'no warning'})`);
  // Holes crossing the edge are clipped to it, not dropped: a disc of dots is dots to its rim.
  const rim = P.fillShape(disc(30), P.patternById('dots'), { op: 'cut', params: { size: 4, gap: 2 }, web: 1.5 });
  ok((rim.stats.clipped ?? 0) > 0 && rim.shapes.flat(2).every(([x, y]) => Math.hypot(x, y) <= 30 - 1.5 + 0.02), `clipped at the rim: ${rim.stats.clipped ?? 0} pieces, all within the web of the edge`);
  // Nothing left above the floors (a 2 mm disc under an 8 mm honeycomb): a cut that must say why
  // is the host's (round 6: the zoom it names is tried by building the pattern again, which is the
  // worker's work, never the editor's thread) — handed over with its holes, nothing said here. The
  // host's one short sentence is checked with manifold, in 13.
  const tiny = P.fillShape(disc(2), P.patternById('honeycomb'), { op: 'cut', params: { size: 8, gap: 2 } });
  ok(tiny.shapes.length === 0 && tiny.warnings.length === 0 && !!tiny.lattice?.shapes?.length && !tiny.lattice.runs.length, `nothing fits: handed to the host with its holes (${tiny.lattice?.shapes?.length ?? 0} shapes, ${tiny.warnings[0] ?? 'nothing said here'})`);
}

// ---- 11. the library adapter ----
{
  const tile = P.svgTilePattern({ id: 't', name: 'T', width: 10, height: 10, paths: ['M0 0h10v10h-10z', 'M2 2h6v6h-6z'], mode: 'fill' }, P.flattenPathData);
  // Cells centred on the region: 3 × 3 whole squares, 12 halves along the edges, 4 quarters
  // in the corners — 25 shapes, the background rectangle dropped from every one.
  const r = P.fillShape(rectRegion(40, 40), tile, { op: 'engrave', params: { size: 10 } });
  ok(r.shapes.length === 25 && r.shapes.every((i) => i.length === 1), `svg tile: background dropped, ${r.shapes.length} squares of 1 ring each`);
  ok(r.shapes.flat(2).every(([x, y]) => Math.abs(x) <= 20 + 1e-6 && Math.abs(y) <= 20 + 1e-6), 'svg tile: clipped to the region');
  ok(near(r.stats.area, 36 * 16, 1e-3), `svg tile: area ${r.stats.area.toFixed(1)} = 16 whole squares' worth`);
  const stroke = P.svgTilePattern({ id: 's', name: 'S', width: 10, height: 10, paths: ['M0 5h10'], mode: 'stroke' }, P.flattenPathData);
  const l = P.fillShape(rectRegion(40, 40), stroke, { op: 'score', params: { size: 10 } });
  ok(l.paths.length === 4 && l.paths.every((p) => near(p[0][0], -20, 1e-6) && near(p[p.length - 1][0], 20, 1e-6)), `svg tile: stroke rows merge into ${l.paths.length} full-width lines`);
  const LIB = await import(`file://${bundle}?lib=${Date.now()}`);
  ok(LIB.LIBRARY.length === 330, `library: ${LIB.LIBRARY.length} Pattern Monster tiles (all 330 free ones)`);
  const pm = LIB.LIBRARY.find((d) => d.id === 'pm-japanese-pattern-4');
  const j = pm ? P.fillShape(disc(30), pm, { op: 'score' }) : null;
  ok(j && j.paths.length + j.shapes.length > 10, `library: japanese-pattern-4 scores ${j?.paths.length} runs`);
  ok(LIB.LIBRARY.every((d) => d.source?.licence === 'MIT'), 'library: every tile carries its MIT source');
  // Every tile builds at its default op in a disc, and every tile's card renders as a <pattern>.
  let broken = [];
  for (const d of LIB.LIBRARY) {
    const r = P.fillShape(disc(30), d, { op: d.ops[0] });
    if (r.shapes.length + r.paths.length === 0) broken.push(d.id);
  }
  ok(broken.length === 0, `library: every tile draws at its default op (${broken.slice(0, 8).join(', ')})`);
  const scales = LIB.tileById('scales-3');
  const card = P.tileSvg(scales, { colours: P.MONSTER_DARK, scale: 1, stroke: 1 }, 300, 200);
  ok(/<pattern [^>]*width="25"[^>]*height="13"/.test(card) && /stroke-width="1"/.test(card) && /fill="url\(#pm\d+\)"/.test(card), 'tileSvg: scales-3 card is a 25×13 pattern with stroke 1');
  const spaced = P.tileSvg(LIB.tileById('japanese-pattern-3'), { colours: P.MONSTER_DARK, spacing: [10, 10], scale: 2, angle: 30 }, 300, 200);
  ok(/width="79.141"[^>]*height="50"/.test(spaced) && /translate\(5,0\)/.test(spaced) && /scale\(2\) rotate\(30\)/.test(spaced), 'tileSvg: spacing widens the cell and nudges the layers, zoom and angle go on the pattern');
  const jp3 = LIB.LIBRARY.find((d) => d.id === 'pm-japanese-pattern-3');
  const c0 = jp3.cell(P.resolveParams(jp3, {}));
  const c1 = jp3.cell(P.resolveParams(jp3, { spacingX: 10, spacingY: 10 }));
  ok(c1.w > c0.w && c1.h > c0.h, `svg tile: spacing params grow the cell (${c0.w.toFixed(1)}→${c1.w.toFixed(1)})`);
  const banded = P.fillShape(disc(30), jp3, { op: 'engrave', params: { stroke: 2 } });
  ok(banded.shapes.length > 50 && banded.paths.length === 0, `svg tile: engrave with a stroke gives bands, not hairlines (${banded.shapes.length} islands)`);
  const hair = P.fillShape(disc(30), jp3, { op: 'score', params: { stroke: 2 } });
  ok(hair.paths.length + hair.shapes.length > 10 && hair.shapes.every((i) => i.length === 1), 'svg tile: a score stays hairlines whatever the stroke');
  const plaid = LIB.LIBRARY.find((d) => d.id === 'pm-plaid-pattern-5');
  // Shapes that touch cannot be punched (the material between them would go); they cut as a
  // lattice on their outlines instead — the drawing a Score of them burns, which the host traces
  // (section 13 holds the two to the same length).
  const cutPlaid = P.fillShape(disc(30), plaid, { op: 'cut' });
  ok(cutPlaid.shapes.length === 0 && cutPlaid.lattice?.outlines.length > 0 && cutPlaid.lattice.runs.length === 0 && cutPlaid.warnings.length === 0, `svg tile: touching fill shapes cut as a lattice on their outlines (${cutPlaid.lattice?.outlines.length ?? 0} shapes; ${cutPlaid.warnings[0] ?? 'no warning'})`);
  const hex4 = LIB.LIBRARY.find((d) => d.id === 'pm-hexagon-4');
  ok(hex4.web(P.resolveParams(hex4, {})) <= 1e-6, 'svg tile: hexagon-4 measures a zero web (its hexagons touch at the corners)');
  // The general clipper holds for the library: a handful of the 223 fill tiles (triangles-9,
  // halloween-4, scales-7 — a ring crossing the edge at a vertex) are left whole for a host
  // boolean, never the 38 the even-odd days had.
  let spilling = [];
  for (const d of LIB.LIBRARY) {
    if (d.ops[0] !== 'engrave') continue;
    const r = P.fillShape(disc(30), d, { op: 'engrave' });
    if (r.stats.unclipped) spilling.push(`${d.id}:${r.stats.unclipped}`);
  }
  ok(spilling.length <= 4, `library: fill tiles left unclipped at the edge — ${spilling.length} (${spilling.slice(0, 6).join(' ')})`);
  const inspired = P.inspireLook(LIB.tileById('scales-3'), 7, P.MONSTER_DARK);
  const again = P.inspireLook(LIB.tileById('scales-3'), 7, P.MONSTER_DARK);
  ok(JSON.stringify(inspired) === JSON.stringify(again) && inspired.stroke >= 0.5 && inspired.stroke <= 7.5 && inspired.scale >= 2, 'inspireLook: deterministic and inside the tile ranges');
}

// ---- 12. cut as a lattice: the recipe (pure) ----
{
  // Rule 4 at the band level: a strut covers everything within web/2 of its run — across a
  // hairpin, a right angle, shallow bends, a smooth curve (one mitred ribbon) and a curl tighter
  // than the strut is wide (a ribbon would fold: quads and fans) — and nothing past a 30° mitre.
  const curve = Array.from({ length: 40 }, (_, i) => [14 + i * 0.25, 9.4 + 1.5 * Math.sin(i * 0.1)]);
  const curl = Array.from({ length: 30 }, (_, i) => [24 + 0.5 * Math.cos(i * 0.4), 6 + 0.5 * Math.sin(i * 0.4)]);
  const run = [[0, 0], [10, 0], [10, 6], [2, 6.5], [9, 9], ...curve, ...curl];
  const h = 0.75;
  const bands = P.strutBands(run, 2 * h);
  ok(bands.every((r) => P.signedArea(r) > 0), `strutBands: ${bands.length} rings, all counter-clockwise`);
  const boxes = bands.map((r) => P.bboxOfShapes([[r]]));
  const covered = (p) => bands.some((r, i) => p[0] >= boxes[i].minX && p[0] <= boxes[i].maxX && p[1] >= boxes[i].minY && p[1] <= boxes[i].maxY && P.pointInRing(p, r));
  const toRun = (p) => { let d = Infinity; for (let i = 0; i < run.length - 1; i++) d = Math.min(d, segDist(p, p, run[i], run[i + 1])); return d; };
  let thin = 0;
  let fat = 0;
  for (let x = -2; x <= 26; x += 0.07) for (let y = -2; y <= 12.5; y += 0.07) {
    const d = toRun([x, y]);
    const c = covered([x, y]);
    if (d < h - 0.01 && !c) thin++;
    if (c && d > h / Math.cos(Math.PI / 12) + 1e-6) fat++;
  }
  ok(thin === 0, `strutBands: every point within web/2 of the run is strut (${thin} missed)`);
  ok(fat === 0, `strutBands: nothing past a 30° mitre's reach (${fat} points)`);
  const smooth = P.strutBands(curve, 2 * h);
  ok(smooth.length === 3, `strutBands: a smooth curve is one ribbon and two caps (${smooth.length} rings for ${curve.length} points)`);

  // Every lattice pattern hands back a recipe on a card, with the inset held at least the web.
  const card = [[P.roundedRect(0, 0, 85, 55, 4)]];
  for (const id of ['asanoha', 'kikko', 'cubes', 'diamond-lattice', 'hex-weave', 'rays', 'grid', 'sayagata', 'penrose', 'hatch', 'checkerboard', 'uroko']) {
    const r = P.fillShape(card, P.patternById(id), { op: 'cut', web: 1.5, inset: 0.5 });
    const c = r.lattice;
    ok(!!c && c.runs.length + c.outlines.length > 10 && r.shapes.length === 0 && r.warnings.length === 0, `${id}/cut: a lattice of ${c?.runs.length} runs and ${c?.outlines.length} outlined shapes, no warnings (${r.warnings.join('; ')})`);
    ok(c && c.inset === 1.5 && c.web === 1.5 && c.minWidth === P.LATTICE_MIN_WIDTH && c.minArea === P.LATTICE_MIN_AREA, `${id}/cut: inset raised to the web (${c?.inset}), floors ${c?.minWidth} mm / ${c?.minArea} mm²`);
  }
  // A pattern that punches its own holes keeps doing so.
  const honey = P.fillShape(card, P.patternById('honeycomb'), { op: 'cut', web: 1.5 });
  ok(!honey.lattice && honey.shapes.length > 20, `honeycomb/cut: still holes (${honey.shapes.length}), no lattice`);
  // A slit is still a slit.
  const hinge = P.fillShape(card, P.patternById('living-hinge'), { op: 'cut', web: 2 });
  ok(!hinge.lattice && hinge.paths.length > 20, 'living-hinge/cut: still slits, no lattice');
}

// ---- 13. cut as a lattice: the faces, with manifold as the host ----
// The boolean half needs a polygon library; the studio's worker has manifold, and so does its
// node_modules. Skipped (and said) when that install is not there.
{
  const { existsSync } = await import('node:fs');
  const manifoldJs = `${here}../../../apps/laser-studio/node_modules/manifold-3d/manifold.js`;
  if (!existsSync(manifoldJs)) console.log('  (skipping lattice faces: no manifold-3d under apps/laser-studio)');
  else {
    const wasm = await (await import(`file://${manifoldJs}`)).default();
    wasm.setup();
    wasm.setMinCircularEdgeLength(0.15);
    wasm.setMinCircularAngle(3);
    // The same bridge @vostok/laser's csg2d uses: each island's largest ring CCW, the rest CW.
    const toCS = (shapes) => {
      const rings = [];
      for (const island of shapes) {
        const live = island.filter((r) => r.length >= 3);
        if (!live.length) continue;
        const areas = live.map(P.signedArea);
        let o = 0;
        for (let i = 1; i < live.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[o])) o = i;
        live.forEach((r, i) => rings.push(areas[i] > 0 === (i === o) ? r : [...r].reverse()));
      }
      return rings.length ? new wasm.CrossSection(rings, 'Positive') : null;
    };
    const fromCS = (cs) => cs.decompose().filter((c) => c.area() > 0.01).map((c) => c.toPolygons());
    // (Nothing in, nothing out: manifold's constructor wants a ring.)
    const host = {
      offset: (s, d) => { const cs = toCS(s); return cs ? fromCS(cs.offset(d, 'Round', 2.0).simplify(1e-3)) : []; },
      subtract: (a, b) => { const A = toCS(a); if (!A) return []; const B = toCS(b); return fromCS(B ? A.subtract(B) : A); },
      outline: (rings) => (rings.length ? new wasm.CrossSection(rings, 'EvenOdd').toPolygons() : []),
    };
    const lattice = (region, lines, web = 1.5, inset = 3) => P.latticeOf(lines, region, { name: 'Test', web, inset }).cut;
    const square = (cx, cy, s) => [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2], [cx - s / 2, cy - s / 2]];
    const gridLines = (half, step) => {
      const out = [];
      for (let v = -half; v <= half + 1e-9; v += step) out.push([[v, -half - 5], [v, half + 5]], [[-half - 5, v], [half + 5, v]]);
      return out;
    };
    const ringsOf = (faces) => faces.map((i) => i[0]);
    const closest = (rings) => {
      let best = Infinity;
      for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) best = Math.min(best, ringGap(rings[i], rings[j]));
      return best;
    };
    // The 40 mm test square's grid, 8 mm cells: lines at ±4, ±12, ±20; the zone is ±17.
    const grid = gridLines(20, 8);
    const plain = P.latticeFaces(lattice(rectRegion(40, 40), grid), host);
    const without = (x) => grid.filter((l) => !(l[0][0] === x && l[1][0] === x));

    // A plain grid: every cell cut, struts exactly the web, the frame at least the inset.
    {
      const region = rectRegion(40, 40);
      const rings = ringsOf(plain.faces);
      ok(plain.stats.faces === rings.length && rings.length >= 16 && plain.warnings.length === 0 && plain.stats.coverage === 1, `grid lattice: ${rings.length} faces cut, ${plain.stats.tooSmall} too small, every cell (${plain.stats.cells}), no warnings`);
      ok(closest(rings) >= 1.5 - 0.05, `grid lattice: struts ${closest(rings).toFixed(3)} ≥ web 1.5`);
      // A hole cut handed over to say why (10): the host says it in one short sentence.
      const tiny = P.fillShape(disc(2), P.patternById('honeycomb'), { op: 'cut', params: { size: 8, gap: 2 } });
      const said = P.latticeFaces(tiny.lattice, host);
      ok(said.faces.length === 0 && said.warnings.length === 1 && /too (?:small|fine) to cut|Nothing of/.test(said.warnings[0]) && said.warnings[0].split(/\s+/).length <= 12, `nothing fits: the host says so — ${said.warnings[0]}`);
      const edge = Math.min(...rings.map((ring) => minEdgeDistance(ring, region)));
      ok(edge >= 3 - 0.05, `grid lattice: nearest face to the edge ${edge.toFixed(3)} ≥ the 3 mm inset`);
    }
    // A little ring of strut floating in one cell: that cell is cut whole, and nothing inside it
    // is cut twice.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...gridLines(20, 10), square(5, 5, 3)]), host);
      const bare = P.latticeFaces(lattice(rectRegion(40, 40), gridLines(20, 10)), host);
      ok(r.stats.loose === 1 && r.stats.faces === bare.stats.faces, `loose strut: its cell cut whole (${r.stats.loose} loose), ${r.stats.faces} faces as without it (${bare.stats.faces})`);
    }
    // A near miss: the line x = 4 broken by a 1.4 mm gap. Its two ends are joined before any
    // strut is built, so there is no waist to bite round — the same lattice as the whole line.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...without(4), [[4, -25], [4, -0.7]], [[4, 0.7], [4, 25]]]), host);
      const gap = closest(ringsOf(r.faces));
      ok(r.stats.snapped >= 1 && r.stats.tight === 0 && r.stats.faces === plain.stats.faces && gap >= 1.5 - 0.05, `near miss: joined (${r.stats.snapped} snapped, ${r.stats.tight} tight), ${r.stats.faces} faces as the whole grid, struts ${gap.toFixed(3)}`);
    }
    // A line that stops 2.5 mm short of the next one carries straight on to it (two webs' reach)
    // rather than being taken away as a cantilever.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...without(4), [[4, -25], [4, 9.5]]]), host);
      ok(r.stats.snapped >= 1 && r.stats.pruned === 0 && r.stats.tight === 0 && closest(ringsOf(r.faces)) >= 1.5 - 0.05, `carry: the short line runs on to the next (${r.stats.snapped} snapped, ${r.stats.pruned} pruned)`);
    }
    // A dead end: a 3 mm stub off the line x = -4, ending 5 mm from anything. Taken away — a
    // cantilever is not a lattice — and the cell it poked into is cut as if it never was.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...grid, [[-4, 0], [-1, 0]]]), host);
      ok(r.stats.pruned === 1 && r.stats.faces === plain.stats.faces, `dead end: the stub pruned (${r.stats.pruned}), ${r.stats.faces} faces as the plain grid`);
    }
    // A stick: a thin bar's outline hanging off the line x = -4 — a loop to the graph, a solid
    // finger once it has struts. Taken away too.
    {
      const bar = [[-4, 1], [1, 1], [1, 1.4], [-4, 1.4], [-4, 1]];
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...grid, bar]), host);
      ok(r.stats.pruned >= 1 && r.stats.faces === plain.stats.faces, `stick: the bar pruned (${r.stats.pruned}), ${r.stats.faces} faces as the plain grid`);
    }
    // Rays land on the solid hub the pattern draws for them: every wedge is a cell held at both
    // ends, nothing is pruned, and no wedge is the background of the disc.
    {
      const coaster = disc(45);
      const fill = P.fillShape(coaster, P.patternById('rays'), { op: 'cut', web: 2, inset: 4 });
      const r = P.latticeFaces(fill.lattice, host);
      const zoneArea = Math.PI * 41 * 41;
      const biggest = Math.max(...ringsOf(r.faces).map((ring) => Math.abs(P.signedArea(ring))));
      ok(fill.lattice.solids.length === 1 && r.stats.faces === 24 && r.stats.pruned === 0 && biggest < 0.25 * zoneArea && r.warnings.length === 0, `rays: ${r.stats.faces} wedges on a hub, ${r.stats.pruned} pruned, the biggest ${(100 * biggest / zoneArea).toFixed(1)} % of the coaster`);
    }
    // A spiral is one line held at one end, however many turns it makes: nothing to cut, and it
    // says so.
    {
      const fill = P.fillShape(disc(45), P.patternById('spiral'), { op: 'cut', web: 2, inset: 4 });
      const r = P.latticeFaces(fill.lattice, host);
      ok(r.faces.length === 0 && r.warnings.some((w) => /never close|join into a lattice/.test(w)), `spiral: nothing cut (${r.warnings[0]})`);
    }
    // Concentric rings, which no lattice can hold: nothing cut, and the sentence says the lines
    // do not join — no zoom would help.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [6, 12, 18, 24].map((s) => square(0, 0, s))), host);
      ok(r.faces.length === 0 && r.warnings.some((w) => /join into a lattice/.test(w)), `concentric rings: nothing cut (${r.warnings[0]})`);
    }
    // Motifs that never touch: the background stays material, the insides of the motifs are cut.
    {
      const motifs = [];
      for (let x = -18; x <= 18; x += 12) for (let y = -18; y <= 18; y += 12) motifs.push(square(x, y, 8));
      const r = P.latticeFaces(lattice(rectRegion(52, 52), motifs), host);
      ok(r.stats.solid === 1 && r.stats.faces === 16 && r.stats.loose === 0, `isolated motifs: background kept (${r.stats.solid} solid), ${r.stats.faces} motif faces cut`);
    }
    // A reserve alone inside one lattice face: that face is left, so the reserve is not dropped.
    {
      // Lines at ±10 and ±30: the 4 mm reserve sits alone in the middle cell, a tenth of the region.
      const region = [[P.rect(0, 0, 60, 60), P.rect(0, 0, 4, 4)]];
      const r = P.latticeFaces(lattice(region, gridLines(30, 20), 1.5, 1.5), host);
      const holding = ringsOf(r.faces).filter((ring) => P.pointInRing([0, 0], ring));
      ok(r.stats.solid === 1 && holding.length === 0, `reserve: the face round it left whole (${r.stats.solid} solid, ${holding.length} faces over it)`);
    }
    // Confetti: a row of 0.7 mm slivers under the width floor stays material, the rest cuts.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 40), [...grid, [[-25, -1.8], [25, -1.8]]]), host);
      const smallest = Math.min(...ringsOf(r.faces).map((ring) => Math.abs(P.signedArea(ring))));
      ok(r.stats.tooSmall >= 4 && r.stats.faces >= 16 && smallest >= 2, `confetti: ${r.stats.tooSmall} slivers stay, ${r.stats.faces} faces cut, the smallest ${smallest.toFixed(2)} mm²`);
      const speck = P.latticeFaces(lattice(rectRegion(20, 20), [square(0, 0, 2.9)], 1.5, 2), host);
      ok(speck.faces.length === 0 && speck.warnings.some((w) => /too fine/.test(w)), `confetti: a 1.96 mm² speck is not cut, and it says so (${speck.warnings[0]})`);
    }
    // Two lines across a region are not a lattice: three strips, each most of the piece.
    {
      const r = P.latticeFaces(lattice(rectRegion(40, 20), [[[-30, -2], [30, -2]], [[-30, 2], [30, 2]]], 1.5, 2), host);
      ok(r.faces.length === 0 && r.warnings.some((w) => /zoom out/.test(w)), `coarse: nothing cut (${r.warnings[0]})`);
    }
    // Too fine: the sentence names the zoom it cuts from, and at that zoom it does.
    {
      const card = [[P.roundedRect(0, 0, 85, 55, 3)]];
      const at = (scale) => P.latticeFaces(P.fillShape(card, P.patternById('asanoha'), { op: 'cut', web: 1.5, inset: 4, scale }).lattice, host);
      const fine = at(0.6);
      const zoom = fine.zoom;
      const then = zoom ? at(zoom / 100) : null;
      ok(fine.faces.length === 0 && zoom && fine.warnings.some((w) => w.includes(`${zoom} % zoom`)) && then.stats.faces > 0 && then.warnings.length === 0, `too fine at 60 %: "${fine.warnings[0]}" — and at ${zoom} % it cuts ${then?.stats.faces} faces`);
    }
    // The inset on a rounded card — where a vertex offset folds — comes from the host, exactly.
    {
      const card = [[P.roundedRect(0, 0, 85, 55, 3)]];
      const fill = P.fillShape(card, P.patternById('cubes'), { op: 'cut', web: 1.5, inset: 4, params: { size: 6 } });
      const r = P.latticeFaces(fill.lattice, host);
      const rings = ringsOf(r.faces);
      const edge = Math.min(...rings.map((ring) => minEdgeDistance(ring, card)));
      ok(rings.length > 40 && edge >= 4 - 0.05 && closest(rings) >= 1.5 - 0.05, `cubes on a card: ${rings.length} faces, edge ${edge.toFixed(2)} ≥ 4, struts ${closest(rings).toFixed(2)} ≥ 1.5`);
    }
    // A ring round a panel (a business card's frame): vertical lines cross it above and below the
    // panel but stop short of its sides, leaving a 12 mm window at each end — under a quarter of
    // the ring, so not "a quarter of its island". A window is the space the pattern leaves, not a
    // cell: nothing is cut, and it says the pattern is too large here.
    {
      const region = [[P.rect(0, 0, 90, 50), P.rect(0, 0, 40, 20)]];
      const lines = [];
      for (let x = -30; x <= 30 + 1e-9; x += 5) lines.push([[x, -30], [x, 30]]);
      const r = P.latticeFaces(lattice(region, lines, 1.5, 3), host);
      ok(r.faces.length === 0 && r.warnings.some((w) => /too large/.test(w)), `window round a panel: nothing cut (${r.warnings[0]})`);
    }
    // A face whose point tapers under a millimetre for longer than two — a 16 mm cell cut from
    // corner to side at 20° — has the point trimmed off: no hairline running into the corner.
    {
      const lines = [...gridLines(32, 16), [[0, 0], [16, 6]]];
      const r = P.latticeFaces(lattice(rectRegion(64, 64), lines, 1.5, 3), host);
      const narrow = ringsOf(r.faces).map((ring) => {
        const cs = new wasm.CrossSection([ring], 'Positive');
        const opened = cs.offset(-0.3, 'Round', 2, 24).offset(0.3, 'Round', 2, 24);
        const rest = cs.subtract(opened).offset(-0.02, 'Round', 2, 8).offset(0.02, 'Round', 2, 8);
        let worst = 0;
        for (const q of rest.toPolygons()) {
          const xs = q.map((p) => p[0]);
          const ys = q.map((p) => p[1]);
          const d = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
          if (Math.abs(P.signedArea(q)) / d > 0.08) worst = Math.max(worst, d);
        }
        return worst;
      });
      ok(r.stats.trimmed >= 1 && Math.max(...narrow) <= 2, `hairline point: ${r.stats.trimmed} trimmed, the longest part under 0.6 mm wide ${Math.max(...narrow).toFixed(2)} mm`);
    }
    // Shapes that touch, cut: their outline, traced by the host's even-odd fill, is the drawing a
    // Score of them burns — shared edges gone, every other edge there.
    for (const id of ['checkerboard', 'uroko']) {
      const cutFill = P.fillShape(disc(30), P.patternById(id), { op: 'cut' });
      const scoreFill = P.fillShape(disc(30), P.patternById(id), { op: 'score' });
      const traced = host.outline(cutFill.lattice.outlines).map((r) => [...r, r[0]]);
      const inDisc = P.clipPolylines(traced, new P.EdgeIndex(disc(30)));
      const length = inDisc.reduce((s, run) => s + run.slice(1).reduce((q, p, i) => q + Math.hypot(p[0] - run[i][0], p[1] - run[i][1]), 0), 0);
      ok(Math.abs(length - scoreFill.stats.lineLength) < 0.02 * scoreFill.stats.lineLength + 1, `${id}: the host's even-odd trace is the scored drawing (${length.toFixed(0)} vs ${scoreFill.stats.lineLength.toFixed(0)} mm)`);
    }
  }
}

// ---- 14. clipping lines: a region given as shapes, and steps of no length ----
{
  const plate = [[P.circle(0, 0, 30, 96), P.circle(12, 0, 5, 40).reverse()]];
  const index = new P.EdgeIndex(plate);
  const lines = [[[-40, 0], [40, 0]], [[-20, -20], [20, 20], [20, -10]], [[0, 0], [5, 5]]];
  const rings = [P.circle(-8, 4, 6, 24), P.circle(12, 0, 9, 32), P.circle(0, 0, 50, 40)];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(same(P.clipPolylines(lines, plate), P.clipPolylines(lines, index)), 'clipPolylines: a region given as shapes clips as its edge index does');
  ok(same(P.clipRingsAsLines(rings, plate), P.clipRingsAsLines(rings, index)), 'clipRingsAsLines: a region given as shapes clips as its edge index does');
  ok(same(P.clipPolylines(lines, index, {}), P.clipPolylines(lines, index)), 'no options is the clip as it was');
  // A ring wholly on the plate, drawn the way a font's rounding leaves it: one point twice, and
  // its first point again at the end. Walked as given, the repeat reads as a gap and the ring
  // comes back as an open run; compacted, it is still the one closed ring it is.
  const ring = P.circle(-8, 4, 6, 24);
  const rounded = [...ring.slice(0, 5), ring[4], ...ring.slice(5), ring[0]];
  const loose = P.clipRingsAsLines([rounded], plate);
  const tight = P.clipRingsAsLines([rounded], plate, { compact: true });
  ok(loose.closed.length === 0 && loose.open.length >= 1, `walked as given, the repeated point splits the ring (${loose.closed.length} closed, ${loose.open.length} open)`);
  ok(tight.closed.length === 1 && tight.open.length === 0 && tight.closed[0].length === ring.length, `compact: one closed ring of ${ring.length} points (${tight.closed.length} closed, ${tight.open.length} open)`);
  const line = [[-10, 2], [-5, 2], [-5, 2], [5, 2]];
  const asGiven = P.clipPolylines([line], plate);
  ok(asGiven.length === 2 && same(asGiven, [[[-10, 2], [-5, 2]], [[-5, 2], [5, 2]]]), `no options: the step of no length still splits the line, as it always did (${asGiven.length} runs)`);
  ok(P.clipPolylines([line], plate, { compact: true }).length === 1, 'compact: a line with a step of no length stays one run');
}

// ---- 15. the engine's own order of summing an area ----
// The engine sums a ring's area starting from its closing edge, as it always has; the shape core's
// own signedArea starts from the first point. Floating point is not associative, so the two can
// differ in the last bit, and a fill sorts and filters by area: on these six fills the order
// shows. They are pinned as the engine drew them before its geometry moved into @vostok/shapes.
{
  const closingFirst = (r) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    return a / 2;
  };
  const closingLast = (r) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const q = r[(i + 1) % r.length];
      a += r[i][0] * q[1] - q[0] * r[i][1];
    }
    return a / 2;
  };
  // Jittered polygons at several sizes and offsets, kept when the two orders sum them differently.
  let seed = 20261005;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const rings = [];
  for (let k = 0; k < 400 && rings.length < 40; k++) {
    const n = 3 + Math.floor(rnd() * 30);
    const s = [0.3, 4, 37, 210][k % 4];
    const ring = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI;
      const r = s * (0.4 + 0.6 * rnd());
      return [s * (k % 7) + r * Math.cos(t), -s * (k % 5) + r * Math.sin(t)];
    });
    if (!Object.is(closingFirst(ring), closingLast(ring))) rings.push(ring);
  }
  ok(rings.length === 40, `rings the two orders sum differently: ${rings.length}`);
  ok(rings.every((r) => Object.is(P.signedArea(r), closingFirst(r))), 'signedArea sums from the closing edge, bit for bit, on every one of them');
  const digest = (r) => createHash('sha256').update(JSON.stringify([r.shapes, r.paths, r.stats, r.warnings])).digest('hex').slice(0, 16);
  const disc = [[P.circle(0, 0, 40, 128)]];
  const plate = [[P.roundedRect(0, 0, 90, 60, 8), P.circle(10, 5, 12, 64).reverse()]];
  const PINNED = [
    ['slots', 'engrave', plate, '477ff462fcfa934f'],
    ['star-cross-8', 'cut', disc, 'e390334d9a4dba88'],
    ['hishi-yotsu', 'engrave', plate, 'afcd14f3d3f2251b'],
    ['basketweave', 'cut', disc, '05baf4f7d987cde0'],
    ['radial-slots', 'cut', disc, '4fe2d22479b48496'],
    ['voronoi', 'engrave', plate, 'b9ba24901e98d0fe'],
  ];
  for (const [id, op, region, want] of PINNED) {
    const got = digest(P.fillShape(region, P.patternById(id), { op }));
    ok(got === want, `${id}, ${op}, on the ${region === disc ? 'disc' : 'plate'}: ${got} (pinned ${want})`);
  }
}

/** Least distance between two closed rings, mm. */
function ringGap(a, b) {
  let best = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) best = Math.min(best, segDist(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
  return best;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
