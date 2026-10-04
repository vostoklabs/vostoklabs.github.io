/*
  Model mode: cut an uploaded model into a clicker (src/model/).

  What is asserted, and why each one:

   1. The switch envelope is measured off the display mesh, not typed — three bands, the flange
      the widest. If the asset is re-cut this is what moves, so it is what is checked first. And
      the keycap post rests where the real switch holds it — on the slider, 1.95 mm above where
      the post asset was drawn (Ian's pumpkin, 2026-10-01: a Flush button printed proud).
   2. Every reader lands the same solid: binary and ASCII STL, OBJ with quads and negative indices,
      and a 3MF whose part lives in a separate file behind a component transform, in centimetres
      (the Bambu production-extension layout). Inside-out files are turned, overlapping shells are
      joined, a mesh with holes is rebuilt — each with the note that says so.
   3. For every cutter on every fixture (a ball, a mushroom, a cat's head — shapes known exactly):
        - every piece is a valid closed solid;
        - NOTHING touches anywhere in the press: the moving pieces, pushed down through the whole
          travel, never intersect the piece that holds the switch;
        - the moving pieces' lowest plane is the post's bottom and the post is standing on it —
          the rule that lets a model's top print upright with no support under the mechanism;
        - a sample the switch plainly fits in builds without a single warning.
   4. The checks that say "too thin" fire on a model that is too thin.
   5. Every shipped sample (public/assets/samples/) builds clean at the preset its tile opens
      with — a sample that opened on a warning would be the mode's first impression.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/model-cut.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --define:import.meta.env='{"BASE_URL":"/"}' \
      --outfile=apps/clicker-generator/.model-cut-test.mjs \
      && node apps/clicker-generator/.model-cut-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import Module from 'manifold-3d';

const { parse3MF } = await import('../src/geometry/threemfImport.ts');
const { parseModel } = await import('../src/model/parse.ts');
const { prepareModel } = await import('../src/model/prepare.ts');
const { MODEL_SAMPLES } = await import('../src/model/samples.ts');
const { makeSwitchKit, measureSwitchBands, measurePostSeat, seatPost, switchBody, place, scope, FALLBACK_POST_SEAT } = await import('../src/model/switchKit.ts');
const { buildModelClicker } = await import('../src/model/buildModel.ts');
const { DEFAULT_MODEL_CUT } = await import('../src/model/types.ts');
type ModelCutParams = import('../src/model/types.ts').ModelCutParams;
type ClickerPart = import('../src/types.ts').ClickerPart;

const appDir = join(process.cwd(), 'apps/clicker-generator');
const asset = (p: string) => readFileSync(join(appDir, 'public/assets', p)).buffer as ArrayBuffer;
const wasm: any = await Module();
wasm.setup();

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---- The switch, normalised the way the worker's `init` does it ----
function solidOf(buf: ArrayBuffer) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}
const socketRaw = solidOf(asset('switch/mx/mx-socket.3mf'));
const stemRaw = solidOf(asset('switch/mx/mx-stem.3mf'));
const sbb = socketRaw.boundingBox();
const tbb = stemRaw.boundingBox();
const socket = socketRaw.translate([-(sbb.min[0] + sbb.max[0]) / 2, -(sbb.min[1] + sbb.max[1]) / 2, -sbb.max[2]]);
const tcx = (tbb.min[0] + tbb.max[0]) / 2;
const tcy = (tbb.min[1] + tbb.max[1]) / 2;
const stem = stemRaw.translate([-tcx, -tcy, 0]);
const sw = parse3MF(asset('switch/mx/mx-switch.3mf'));
{
  const v = sw.vertProperties;
  let maxE = 0;
  for (let i = 0; i < v.length; i += 3) {
    v[i] -= tcx;
    v[i + 1] -= tcy;
    maxE = Math.max(maxE, Math.abs(v[i]), Math.abs(v[i + 1]));
  }
  let seatZ = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (Math.max(Math.abs(v[i]), Math.abs(v[i + 1])) >= maxE * 0.96 && v[i + 2] < seatZ) seatZ = v[i + 2];
  }
  for (let i = 0; i < v.length; i += 3) v[i + 2] -= seatZ;
}
const bands = measureSwitchBands(sw.vertProperties, sw.triVerts);
const seat = measurePostSeat(sw.vertProperties, sw.triVerts);
const kit = makeSwitchKit(socket, seatPost(stem, seat ?? FALLBACK_POST_SEAT), bands);

// 1. The envelope
{
  const widest = Math.max(...bands.map((b) => b.half));
  const top = Math.max(...bands.map((b) => b.z1));
  check(
    'switch envelope measured',
    bands.length >= 2 && widest > 7.5 && widest < 8.2 && top > 5.5 && top < 7,
    bands.map((b) => `${b.z0.toFixed(1)}–${b.z1.toFixed(1)}:${(2 * b.half).toFixed(2)}`).join('  '),
  );
  // Cherry: 4.0 mm travel, a 3.7 mm cross on a slider, the stem tip ~10.2 mm over the plate. The
  // post's cross hole is 5.6 mm deep, so the post stops on the slider, not on the tip.
  const drawn = stem.boundingBox().min[2];
  check(
    'post rests on the slider, not inside it',
    seat !== null && seat > 6.0 && seat < 6.6 && Math.abs(kit.postBottom - seat) < 0.01
      && Math.abs(kit.postTop - kit.postBottom - 5.64) < 0.1,
    `slider top ${seat?.toFixed(2)} mm (the asset drew the post at ${drawn.toFixed(2)}), post ${kit.postBottom.toFixed(2)} → ${kit.postTop.toFixed(2)}, socket to ${kit.socketBottom.toFixed(2)}`,
  );
}

// ---- 2. Readers and the import pipeline ----
function meshOf(solid: any): { pos: Float32Array; tri: Uint32Array } {
  const m = solid.getMesh();
  return { pos: m.vertProperties, tri: m.triVerts };
}
function binarySTL(pos: Float32Array, tri: Uint32Array, flip = false): ArrayBuffer {
  const n = tri.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    for (const k of order) {
      const v = tri[t * 3 + k] * 3;
      dv.setFloat32(o, pos[v], true);
      dv.setFloat32(o + 4, pos[v + 1], true);
      dv.setFloat32(o + 8, pos[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return buf;
}
function asciiSTL(pos: Float32Array, tri: Uint32Array): ArrayBuffer {
  const lines = ['solid test'];
  for (let t = 0; t < tri.length; t += 3) {
    lines.push(' facet normal 0 0 0', '  outer loop');
    for (let k = 0; k < 3; k++) {
      const v = tri[t + k] * 3;
      lines.push(`   vertex ${pos[v]} ${pos[v + 1]} ${pos[v + 2]}`);
    }
    lines.push('  endloop', ' endfacet');
  }
  lines.push('endsolid test');
  return strToU8(lines.join('\n')).buffer as ArrayBuffer;
}
const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= Math.abs(b) * rel;

{
  const sphere = wasm.Manifold.sphere(20, 64);
  const vol = sphere.volume();
  const { pos, tri } = meshOf(sphere);

  const bin = prepareModel(wasm, parseModel(binarySTL(pos, tri), 'ball.stl'), 'ball.stl');
  check('binary STL', near(bin.solid.volume(), vol, 0.001) && bin.info.notes.length === 0,
    `${bin.solid.volume().toFixed(0)} vs ${vol.toFixed(0)} mm³, notes: ${bin.info.notes.join(' / ') || 'none'}`);
  bin.solid.delete();

  const asc = prepareModel(wasm, parseModel(asciiSTL(pos, tri), 'ball.stl'), 'ball.stl');
  check('ASCII STL', near(asc.solid.volume(), vol, 0.001), `${asc.solid.volume().toFixed(0)} mm³`);
  asc.solid.delete();

  const inv = prepareModel(wasm, parseModel(binarySTL(pos, tri, true), 'inv.stl'), 'inv.stl');
  check('inside-out STL turned', near(inv.solid.volume(), vol, 0.001) && inv.info.notes.some((n) => /inside-out/.test(n)),
    `${inv.solid.volume().toFixed(0)} mm³, ${inv.info.notes.join(' / ')}`);
  inv.solid.delete();

  // Holes: six triangles gone, so ofMesh refuses it and the voxel rebuild has to run.
  const holed = tri.slice(18);
  const rep = prepareModel(wasm, parseModel(binarySTL(pos, holed), 'holed.stl'), 'holed.stl');
  check('holed mesh rebuilt', near(rep.solid.volume(), vol, 0.04) && rep.solid.status() === 'NoError'
    && rep.info.notes.some((n) => /rebuilt/.test(n)),
    `${rep.solid.volume().toFixed(0)} vs ${vol.toFixed(0)} mm³, ${rep.info.triangles} tris, ${rep.info.notes.join(' / ')}`);
  rep.solid.delete();

  // Two cubes pushed into each other, exported as one file: the overlap must count once.
  const a = wasm.Manifold.cube([10, 10, 10]);
  const b = wasm.Manifold.cube([10, 10, 10]).translate([5, 5, 5]);
  const ma = meshOf(a);
  const mb = meshOf(b);
  const pos2 = new Float32Array([...ma.pos, ...mb.pos]);
  const off = ma.pos.length / 3;
  const tri2 = new Uint32Array([...ma.tri, ...Array.from(mb.tri, (i) => i + off)]);
  const ov = prepareModel(wasm, parseModel(binarySTL(pos2, tri2), 'two.stl'), 'two.stl');
  check('overlapping shells joined', near(ov.solid.volume(), 1875, 0.001) && ov.info.notes.some((n) => /joined/.test(n)),
    `${ov.solid.volume().toFixed(0)} mm³ (1875 expected), ${ov.info.notes.join(' / ')}`);
  ov.solid.delete();
  a.delete();
  b.delete();

  // OBJ: a 10 mm cube as quads, the second half addressed with negative indices.
  const obj = [
    'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0',
    'v 0 0 10', 'v 10 0 10', 'v 10 10 10', 'v 0 10 10',
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
    'f -6/1/1 -5/2/2 -1/3/3 -2/4/4', 'f -5 -8 -4 -1', 'f -7 -6 -2 -3',
  ].join('\n');
  const o = prepareModel(wasm, parseModel(strToU8(obj).buffer as ArrayBuffer, 'cube.obj'), 'cube.obj');
  check('OBJ quads + negative indices', near(o.solid.volume(), 1000, 0.001), `${o.solid.volume().toFixed(1)} mm³`);
  o.solid.delete();

  // 3MF: the Bambu layout — the mesh in its own file, pulled in by a component with a transform,
  // in centimetres. A 1 cm cube moved 2 cm must come out as a 10 mm cube, 1000 mm³.
  const cubeXml = (verts: number[][], tris: number[][]) =>
    `<mesh><vertices>${verts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices>`
    + `<triangles>${tris.map(([p, q, r]) => `<triangle v1="${p}" v2="${q}" v3="${r}"/>`).join('')}</triangles></mesh>`;
  const cm = meshOf(wasm.Manifold.cube([1, 1, 1]));
  const verts: number[][] = [];
  for (let i = 0; i < cm.pos.length; i += 3) verts.push([cm.pos[i], cm.pos[i + 1], cm.pos[i + 2]]);
  const tris: number[][] = [];
  for (let i = 0; i < cm.tri.length; i += 3) tris.push([cm.tri[i], cm.tri[i + 1], cm.tri[i + 2]]);
  const part = `<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`
    + `<resources><object id="1" type="model">${cubeXml(verts, tris)}</object></resources><build/></model>`;
  const root = `<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" `
    + `xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">`
    + `<resources><object id="2" type="model"><components>`
    + `<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/>`
    + `</components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 3 0"/></build></model>`;
  const zip = zipSync({ '3D/3dmodel.model': strToU8(root), '3D/Objects/object_1.model': strToU8(part) });
  const raw = parseModel(zip.buffer as ArrayBuffer, 'part.3mf');
  let mx = -Infinity;
  let my = -Infinity;
  for (let i = 0; i < raw.positions.length; i += 3) {
    mx = Math.max(mx, raw.positions[i]);
    my = Math.max(my, raw.positions[i + 1]);
  }
  const t3 = prepareModel(wasm, raw, 'part.3mf');
  check('3MF component in a separate file, centimetres',
    near(t3.solid.volume(), 1000, 0.001) && Math.abs(mx - 30) < 1e-4 && Math.abs(my - 40) < 1e-4,
    `${t3.solid.volume().toFixed(1)} mm³, max x ${mx.toFixed(2)} (30), max y ${my.toFixed(2)} (40)`);
  t3.solid.delete();
  sphere.delete();
}

// ---- 3. Every cutter on every fixture ----
// The mode's first samples, kept as fixtures because their shapes are known exactly: a ball (the
// Pokeball cut), a mushroom (a cap on a stem — Slice at the joint, Button on the cap) and a
// cat's head (ears a cut must not orphan). The caller owns the result.
type FixtureId = 'ball' | 'mushroom' | 'cat';
function fixture(id: FixtureId): any {
  const { Manifold } = wasm;
  const made: { delete(): void }[] = [];
  const k = <T extends { delete(): void }>(o: T): T => {
    made.push(o);
    return o;
  };
  try {
    if (id === 'ball') return k(Manifold.sphere(22, 128)).translate([0, 0, 22]);
    if (id === 'mushroom') {
      const stem = k(Manifold.cylinder(24, 10.5, 8.5, 96));
      const dome = k(k(k(Manifold.sphere(25, 128)).scale([1, 1, 0.62])).translate([0, 0, 22]));
      const cap = k(dome.trimByPlane([0, 0, 1], 19));
      return Manifold.union([stem, cap]);
    }
    const head = k(k(k(Manifold.sphere(22, 128)).scale([1.1, 0.95, 0.9])).translate([0, 0, 19.8]));
    const ear = (side: 1 | -1): any => {
      const cone = k(Manifold.cylinder(15, 8.5, 1.2, 48));
      const tipped = k(cone.rotate([0, side * 26, 0]));
      return k(tipped.translate([side * 11, 1.5, 27]));
    };
    const whole = k(Manifold.union([head, ear(1), ear(-1)]));
    // A flat bottom to stand on, dropped back onto Z 0.
    const flat = k(whole.trimByPlane([0, 0, 1], 1.5));
    return flat.translate([0, 0, -1.5]);
  } finally {
    for (const o of made) {
      try {
        o.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

function solidFromPart(p: ClickerPart): any {
  const mesh = new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}

interface Case { sample: FixtureId; label: string; params: Partial<ModelCutParams>; clean: boolean }
const CASES: Case[] = [];
for (const sample of ['ball', 'mushroom', 'cat'] as const) {
  CASES.push({ sample, label: 'slice plain', params: { cutter: 'slice', slice: { heightMm: null, hideSeam: false } }, clean: true });
  // Hidden is the default. Where the collar would leave the walls too thin (the mushroom's thin
  // stem) the build makes a plain gap instead, so every one of these builds clean.
  CASES.push({ sample, label: 'slice hidden', params: { cutter: 'slice', slice: { heightMm: null, hideSeam: true } }, clean: true });
  CASES.push({ sample, label: 'stand circle', params: { cutter: 'stand' }, clean: true });
  CASES.push({ sample, label: 'stand outline', params: { cutter: 'stand', stand: { shape: 'outline', marginMm: 2.5 } }, clean: sample !== 'ball' });
  // The round button sits lower than the square one (its outline reaches further down the
  // mushroom's dome), and its socket then reaches the thin stem — a true warning, not a bug.
  CASES.push({ sample, label: 'button round', params: { cutter: 'button' }, clean: sample !== 'mushroom' });
  // On its real seat the switch sits 1.95 mm deeper than the post asset was drawn, and the
  // mushroom's 60 mm cap is no longer deep enough for either button: a true warning again.
  CASES.push({ sample, label: 'button square', params: { cutter: 'button', button: { shape: 'square', sizeMm: 22, raiseMm: 1, x: null, y: null } }, clean: sample !== 'mushroom' });
}

const TRAVEL_CHECK = 3.75; // the pocket ceiling lands on the housing top at ~3.79
for (const c of CASES) {
  const base = fixture(c.sample);
  // The mushroom's stem is thin: at the 45 mm default neither a slice nor a button has room for
  // the socket in it (and says so). At 60 mm it does, which is what a clean build is asked of.
  const sizeMm = c.sample === 'mushroom' ? 60 : DEFAULT_MODEL_CUT.sizeMm;
  const params: ModelCutParams = { ...DEFAULT_MODEL_CUT, sizeMm, ...c.params } as ModelCutParams;
  const t0 = performance.now();
  const out = buildModelClicker(wasm, kit, base, params);
  const ms = performance.now() - t0;
  const name = `${c.sample} / ${c.label}`;

  const solids = out.parts.map((p) => ({ part: p, solid: solidFromPart(p) }));
  const allClosed = solids.every((s) => s.solid.status() === 'NoError' && !s.solid.isEmpty());
  const moving = solids.filter((s) => s.part.group === 'top').map((s) => s.solid);
  const fixed = solids.filter((s) => s.part.group === 'base').map((s) => s.solid);
  let worst = 0;
  if (moving.length && fixed.length) {
    const mov = wasm.Manifold.union(moving);
    const fix = wasm.Manifold.union(fixed);
    for (let t = 0; t <= TRAVEL_CHECK + 1e-9; t += 0.25) {
      const down = mov.translate([0, 0, -t]);
      const hit = down.intersect(fix);
      worst = Math.max(worst, hit.volume());
      hit.delete();
      down.delete();
    }
    // Lowest plane and the post on it.
    const bb = mov.boundingBox();
    const at = out.meta.switchAt;
    const plane = bb.min[2];
    const expect = at.z + kit.postBottom;
    const cs = mov.slice(plane + 0.1);
    const ring = wasm.CrossSection.circle(2.4, 32).translate([at.x, at.y]);
    const postArea = cs.intersect(ring).area();
    check(`${name}: prints upright on the post's plane`, Math.abs(plane - expect) < 0.02 && postArea > 4,
      `lowest ${plane.toFixed(2)} vs ${expect.toFixed(2)}, post area there ${postArea.toFixed(1)} mm²`);
    // At rest, where the real switch holds it: a slice floats the travel and a hair over its cut,
    // a stand's plate is proud of its rim by the travel, a flush button is level with the model.
    const fbb = fix.boundingBox();
    if (c.label === 'slice plain') {
      const gap = plane - fbb.max[2];
      check(`${name}: rests 4.35 mm over the cut (closes to 0.35 pressed)`, Math.abs(gap - 4.35) < 0.02, `gap ${gap.toFixed(2)} mm`);
    }
    if (c.params.cutter === 'stand') {
      const capTop = solids.find((q) => q.part.name === 'top-base')!.solid.boundingBox().max[2];
      const proud = capTop - fbb.max[2];
      check(`${name}: plate proud by the travel, flush pressed`, Math.abs(proud - 4) < 0.02, `proud ${proud.toFixed(2)} mm`);
    }
    // Where the button is the model's highest point (not the cat, whose ears are).
    if (c.label === 'button round' && c.sample !== 'cat') {
      const top = bb.max[2];
      const modelTop = out.meta.sizeMm[2] + out.meta.assemblyMinZ;
      check(`${name}: flush with the model at rest`, Math.abs(top - modelTop) < 0.05, `button top ${top.toFixed(2)}, model top ${modelTop.toFixed(2)}`);
    }
    // The static pieces leave the switch its own room above the plate (a slice's bottom holds its
    // flange now): the switch's envelope, without the clearance, meets nothing there.
    {
      const sc = scope();
      const bare = { ...kit, bands: kit.bands.map((b: any) => ({ ...b, half: b.half - 0.39 })) };
      const room = place(sc, switchBody(wasm, sc, bare), { x: at.x, y: at.y, z: at.z + 0.1, rotation: at.rotation });
      const hit = room.intersect(fix);
      const v = hit.volume();
      hit.delete();
      sc.free();
      check(`${name}: the switch has its room`, v < 0.5, `${v.toFixed(3)} mm³ of base inside the switch`);
    }
    // The base prints the way it stands, so it must stand on a face, not a point: a ball's
    // bottom half would otherwise need support to print and roll off the desk once it had.
    const fb = fix.boundingBox();
    const foot = fix.slice(fb.min[2] + 0.2).area();
    check(`${name}: base stands on a flat face`, foot > 60, `${foot.toFixed(0)} mm² on the bed (flattened ${out.meta.flattenMm.toFixed(2)} mm)`);
    mov.delete();
    fix.delete();
  }
  check(`${name}: pieces closed`, allClosed && out.parts.length >= 2, `${out.parts.map((p) => p.name).join(', ')}`);
  check(`${name}: nothing touches in the press`, worst < 0.5, `worst overlap ${worst.toFixed(3)} mm³ over 0–${TRAVEL_CHECK} mm`);
  const warn = out.warnings.join(' | ');
  if (c.clean) check(`${name}: builds clean`, out.warnings.length === 0, warn || 'no warnings');
  else console.log(`INFO  ${name}: ${warn || 'no warnings'}`);
  console.log(`      ${ms.toFixed(0)} ms, ${out.parts.reduce((n, p) => n + p.triVerts.length / 3, 0)} tris, `
    + `cut ${out.meta.cutHeightMm?.toFixed(1) ?? '-'} mm, switch at (${out.meta.switchAt.x.toFixed(1)}, ${out.meta.switchAt.y.toFixed(1)}, ${out.meta.switchAt.z.toFixed(1)}), `
    + `moving ≈ ${out.meta.movingGrams.toFixed(1)} g`);
  for (const s of solids) s.solid.delete();
  base.delete();
}

// ---- 3a. Hide the gap is on by default, and never at the price of a print that breaks ----
{
  const ball = fixture('ball');
  const out = buildModelClicker(wasm, kit, ball, { ...DEFAULT_MODEL_CUT, cutter: 'slice' } as ModelCutParams);
  check('ball: the gap is hidden by default', out.meta.hideSeam && out.meta.canHideSeam && out.warnings.length === 0,
    `hidden ${out.meta.hideSeam}, cut ${out.meta.cutHeightMm?.toFixed(1)} mm, ${out.warnings.join(' | ') || 'no warnings'}`);
  ball.delete();
  const mush = fixture('mushroom');
  const hidden = buildModelClicker(wasm, kit, mush, {
    ...DEFAULT_MODEL_CUT, sizeMm: 60, cutter: 'slice', slice: { heightMm: null, hideSeam: true },
  } as ModelCutParams);
  check('mushroom: where the collar would be too thin, the gap shows instead — quietly',
    !hidden.meta.hideSeam && !hidden.meta.canHideSeam && hidden.warnings.length === 0,
    `hidden ${hidden.meta.hideSeam}, can ${hidden.meta.canHideSeam}, cut ${hidden.meta.cutHeightMm?.toFixed(1)} mm, ${hidden.warnings.join(' | ') || 'no warnings'}`);
  mush.delete();
}

// ---- 3b. A figure with its arms out, exported the way a sculpt is: overlapping shells ----
// The automatic cut must go through the body only. At 55 % of the height it went through the
// arms as well, and the arms' ends were left above the cut, joined to nothing.
{
  const { Manifold } = wasm;
  const shells = [
    Manifold.sphere(20, 96).scale([1, 0.9, 1.1]).translate([0, 0, 22]),
    Manifold.sphere(14, 96).translate([0, 0, 52]),
    Manifold.cylinder(26, 5, 4, 48).rotate([0, 70, 0]).translate([8, 0, 28]),
    Manifold.cylinder(26, 5, 4, 48).rotate([0, -70, 0]).translate([-8, 0, 28]),
  ];
  const soup: number[] = [];
  for (const q of shells) {
    const m = q.getMesh();
    for (let t = 0; t < m.triVerts.length; t++) {
      const v = m.triVerts[t] * m.numProp;
      soup.push(m.vertProperties[v], m.vertProperties[v + 1], m.vertProperties[v + 2]);
    }
    q.delete();
  }
  const positions = Float32Array.from(soup);
  const indices = new Uint32Array(positions.length / 3).map((_, i) => i);
  const fig = prepareModel(wasm, { positions, indices }, 'figure.stl');
  check('figure: overlapping shells joined on import', fig.info.notes.some((n) => /joined/.test(n)), fig.info.notes.join(' / '));
  for (const hideSeam of [false, true]) {
    const out = buildModelClicker(wasm, kit, fig.solid, {
      ...DEFAULT_MODEL_CUT, sizeMm: 70, cutter: 'slice', slice: { heightMm: null, hideSeam },
    } as ModelCutParams);
    check(`figure: automatic ${hideSeam ? 'hidden ' : ''}slice leaves nothing loose`,
      !out.warnings.some((w) => /not joined/.test(w)),
      `cut at ${out.meta.cutHeightMm?.toFixed(1)} mm; ${out.warnings.join(' | ') || 'no warnings'}`);
  }
  fig.solid.delete();
}

// ---- 4. The thin-model checks fire ----
{
  const disc = wasm.Manifold.cylinder(6, 25, 25, 96);
  const params = { ...DEFAULT_MODEL_CUT, cutter: 'button', sizeMm: 50 } as ModelCutParams;
  const out = buildModelClicker(wasm, kit, disc, params);
  check('thin disc: button says it is too shallow', out.warnings.some((w) => /not deep enough/.test(w)), out.warnings.join(' | '));
  const sliced = buildModelClicker(wasm, kit, disc, { ...params, cutter: 'slice' });
  check('thin disc: slice says it cannot', sliced.warnings.some((w) => /too short|too thin/.test(w)), sliced.warnings.join(' | '));
  const stood = buildModelClicker(wasm, kit, disc, { ...params, cutter: 'stand' });
  check('thin disc: stand works', stood.warnings.length === 0 && stood.parts.length === 3, stood.warnings.join(' | ') || 'no warnings');
  disc.delete();
}

// ---- 5. Every shipped sample opens clean ----
// Read the way the app reads it — the 3MF through the upload path — sized by the same rule
// (as imported when 25–150 mm), and cut at the preset its tile opens with.
for (const sample of MODEL_SAMPLES) {
  const bytes = readFileSync(join(appDir, 'public/assets/samples', `${sample.id}.3mf`));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const prep = prepareModel(wasm, parseModel(buf, `${sample.id}.3mf`), `${sample.id}.3mf`);
  const longest = Math.max(...prep.info.sizeMm);
  const sizeMm = longest >= 25 && longest <= 150 ? Math.round(longest) : 45;
  const out = buildModelClicker(wasm, kit, prep.solid, { ...DEFAULT_MODEL_CUT, sizeMm, ...sample.preset } as ModelCutParams);
  const solids = out.parts.map((p) => solidFromPart(p));
  const closed = solids.every((q) => q.status() === 'NoError' && !q.isEmpty());
  const hiddenOk = sample.preset.cutter !== 'slice' || out.meta.hideSeam;
  check(`sample ${sample.id}: opens clean as ${sample.preset.cutter}${sample.preset.cutter === 'slice' ? ', gap hidden' : ''}`,
    out.warnings.length === 0 && closed && out.parts.length >= 2 && hiddenOk,
    out.warnings.join(' | ') || `${out.parts.length} closed pieces at ${sizeMm} mm, cut ${out.meta.cutHeightMm?.toFixed(1) ?? '-'} mm, hidden ${out.meta.hideSeam}`);
  for (const q of solids) q.delete();
  prep.solid.delete();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
