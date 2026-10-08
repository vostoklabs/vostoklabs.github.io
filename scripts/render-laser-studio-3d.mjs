#!/usr/bin/env node
/*
  node scripts/render-laser-studio-3d.mjs [out-dir] [--ids=a,b,...] [--shots]

  The hub card for Laser Studio in 3D: six designs built for real, put together the way the
  app's 3D Preview puts them together (assembledPieces: the stands standing, the layers stacked),
  in the preview's wood tones, on the preview's 10 mm grid. Writes <out-dir>/cover.png
  (800x600, 3 x 2). --shots also writes each design alone at 1200x900.

  No browser: the designs come from the studio's node harness (apps/laser-studio/tests/node/
  harness.mjs, which .gitignore fences out, so it is only in a checkout that has the studio's
  tests), the pieces are extruded and posed with manifold as tests/node/assembly-check.mjs does,
  and the pictures come from scripts/product-render.mjs.
*/
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-laser-studio-3d');
mkdirSync(outDir, { recursive: true });
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const { loadHarness } = await import(pathToFileURL(join(ROOT, 'apps', 'laser-studio', 'tests', 'node', 'harness.mjs')).href);
const h = await loadHarness();
const { CrossSection } = h.wasm;

// The 3D Preview's own tones (packages/laser/src/material-preview.ts; DARK in src/preview.ts).
const TONES = {
  light: { face: '#c6a676', edge: '#70502f' },
  dark: { face: '#8a5a2b', edge: '#4e3115' },
  card: { face: '#b58e63', edge: '#7a5f3d' },
};
const BURN = '#50321c';
const T = 3;

/** Each design and how to look at it: flat pieces from above, stands from lower down. */
const DESIGNS = [
  { id: 'layered-keychain', elevation: 52, azimuth: 18 },
  { id: 'pet-id-tag', elevation: 55, azimuth: 16 },
  { id: 'qr-slot-stand', elevation: 20, azimuth: 30 },
  { id: 'christmas-ornament', elevation: 52, azimuth: 18 },
  { id: 'arc-coaster', elevation: 55, azimuth: 16 },
  { id: 'table-sign', elevation: 20, azimuth: 32 },
];
const ids = arg('ids')?.split(',');
const designs = ids ? ids.map((id) => DESIGNS.find((d) => d.id === id) ?? { id, elevation: 40, azimuth: 24 }) : DESIGNS;

const rad = (d) => (d * Math.PI) / 180;
/** World axes, X first, then Y, then Z: the pose contract of the 3D view. */
function rotation(p) {
  const [a, b, c] = [rad(p.rx ?? 0), rad(p.ry ?? 0), rad(p.rz ?? 0)];
  const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul(Rz, mul(Ry, Rx));
}

/** A solid in the piece's own frame, posed, split into the parts the renderer draws: faces in
 *  `face`, the cut edges (anything not facing along the piece's normal) in `edge`. */
function posed(solid, pose, face, edge, out) {
  const R = rotation(pose);
  const m = solid.getMesh();
  const P = m.vertProperties, np = m.numProp, I = m.triVerts;
  const Q = new Float32Array((P.length / np) * 3);
  for (let v = 0; v < P.length / np; v++) {
    const x = P[v * np], y = P[v * np + 1], z = P[v * np + 2];
    for (let k = 0; k < 3; k++) Q[v * 3 + k] = R[k][0] * x + R[k][1] * y + R[k][2] * z + [pose.x, pose.y, pose.z][k];
  }
  const faces = [], edges = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * np, b = I[t + 1] * np, c = I[t + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2], vz = P[c + 2] - P[a + 2];
    const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
    (Math.abs(nz / nl) > 0.9 ? faces : edges).push(I[t], I[t + 1], I[t + 2]);
  }
  if (faces.length) out.push({ positions: Q, indices: Uint32Array.from(faces), color: face, spec: 0.08, gloss: 12 });
  if (edges.length && edge) out.push({ positions: Q, indices: Uint32Array.from(edges), color: edge, spec: 0.05, gloss: 10 });
  solid.delete?.();
}

/** A line drawn on the face, as the beam leaves it: a strip a quarter of a millimetre wide. */
function strips(paths, closed) {
  const rects = [];
  const w = 0.13;
  for (const path of paths) {
    const pts = closed ? [...path, path[0]] : path;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 1e-6) continue;
      const nx = (-(y1 - y0) / L) * w, ny = ((x1 - x0) / L) * w;
      const ex = ((x1 - x0) / L) * w * 0.5, ey = ((y1 - y0) / L) * w * 0.5;
      rects.push([[x0 - ex + nx, y0 - ey + ny], [x0 - ex - nx, y0 - ey - ny], [x1 + ex - nx, y1 + ey - ny], [x1 + ex + nx, y1 + ey + ny]]);
    }
  }
  return rects;
}

async function scene(id) {
  const r = await h.buildTemplate(id);
  const t = typeof r.values.thickness === 'number' ? r.values.thickness : T;
  const pieces = h.mod.assembledPieces(r.output, t) ?? [{
    plate: r.output.plate,
    objects: r.output.objects.filter((o) => o.id !== 'plate' && !o.image),
    pose: { x: 0, y: 0, z: t / 2 },
    thickness: t,
    material: 'light',
  }];
  const parts = [];
  for (const p of pieces) {
    const tone = TONES[p.material] ?? TONES.light;
    const th = p.thickness ?? t;
    const rings = p.plate.flat().filter((ring) => ring.length >= 3);
    posed(new CrossSection(rings, 'EvenOdd').extrude(th).translate([0, 0, -th / 2]), p.pose, tone.face, tone.edge, parts);
    // Engraves and scores: a hair-thin dark skin on the show face.
    const marks = [];
    for (const o of p.objects) {
      if (o.op === 'engrave' && o.shapes?.length) {
        const cs = new CrossSection(o.shapes.flat().filter((q) => q.length >= 3), 'EvenOdd');
        marks.push(cs);
      } else if (o.op === 'score' || (o.op === 'cut' && o.paths?.length)) {
        const rects = [...(o.op === 'score' ? strips(o.shapes.flat(), true) : []), ...strips(o.paths ?? [], false)];
        if (rects.length) marks.push(new CrossSection(rects, 'Positive'));
      }
    }
    for (const cs of marks) {
      // Kept inside the plate, so a score round the outline does not hang over the edge.
      const inside = cs.intersect(new CrossSection(rings, 'EvenOdd'));
      if (!inside.isEmpty()) posed(inside.extrude(0.04).translate([0, 0, th / 2 + 0.01]), p.pose, BURN, BURN, parts);
    }
  }
  return parts;
}

function shot(parts, d, w, hgt, extra = {}) {
  return renderScene(parts, {
    width: w, height: hgt, azimuth: d.azimuth, elevation: d.elevation, fov: 24, margin: 0.08,
    groundZ: 0, grid: 10, light: { azimuth: -35, elevation: 55 }, crease: 20,
    keyIntensity: 1.15, ambientIntensity: 0.5, env: 0.15, ...extra,
  });
}

const built = [];
for (const d of designs) {
  const parts = await scene(d.id);
  built.push({ d, parts });
  console.log(`${d.id}: ${parts.length} parts`);
  if (args.includes('--shots')) {
    writePng(join(outDir, `${d.id}.png`), shot(parts, d, 1200, 900), 1200, 900);
    console.log(`  wrote ${d.id}.png`);
  }
}

// The card: 3 x 2 with a 2 px gutter, each tile rendered at twice its size and halved.
const CW = 800, CH = 600, G = 2;
const out = new Uint8Array(CW * CH * 3).fill(255);
const colW = [265, 266, 265], rowH = [299, 299];
built.slice(0, 6).forEach(({ d, parts }, k) => {
  const c = k % 3, r = Math.floor(k / 3);
  const tw = colW[c], th = rowH[r];
  const img = shot(parts, d, tw * 2, th * 2, { margin: 0.07 });
  const x0 = colW.slice(0, c).reduce((a, b) => a + b + G, 0), y0 = r * (rowH[0] + G);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) sum += img[((y * 2 + j) * tw * 2 + x * 2 + i) * 3 + ch];
        out[((y0 + y) * CW + x0 + x) * 3 + ch] = Math.round(sum / 4);
      }
    }
  }
});
writePng(join(outDir, 'cover.png'), out, CW, CH);
console.log('wrote cover.png');
