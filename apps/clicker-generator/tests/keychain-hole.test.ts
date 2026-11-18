/*
  The keyring hole: a tunnel through the body's side wall, under the well.

   - **The planner** (`keychainHole.ts`, pure): a 40 mm body takes the asked 5.2 mm bore at every
     bearing; the smallest body has no room (the switch pocket); a 30 mm one gets a narrower bore;
     a point in a notch is refused for the edge; and with thirty seeds no accepted tunnel comes
     within 0.4 mm of an internal cavity, measured along the tunnel, not by the planner's formula.
   - **The cut**: one piece, as many solid pieces as without it, the volume of half the ring
     gone; the whole centre line is air, inside the body and out, and 1.2 mm round the tube is
     solid. Above it, the layout: the edge point, the radii, the tunnel's outline.
   - **No room** blocks export with one sentence and cuts nothing; moving it clears it. A bore
     the engine narrowed says so.
   - **Hollow base**: the cavity keeps a solid island round the tunnel, without which the tunnel
     opens into it. **Textured wall**: the crests do not close the openings. **Bevelled
     underside**: the opening is still open and the floor under the tube stays whole.
   - Every hole build keeps all its identity marks (this suite runs with the seeded tier on).
   - A loop build has no `style` and no `tunnel` in its layout: the loop is what it was.
   - **The Design view's handle** (`keyringMark.ts`): on a rect, a circle and a heart, for a hole
     and a loop, the canvas puts a dropped handle where the build puts it, so it never jumps on
     release. **The rail's rows** (`showKeychainStyleRows`): Style and Hole size's range, with
     stand-ins for the rows.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs keychain-hole
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { default: Module } = await import('manifold-3d');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const { planHole, snapToEdge, boresToTry, findHoleBearing, scanBearings, SCAN_STEP_DEG, HOLE } = await import('../src/geometry/keychainHole.ts');
const { markVoids, hardcodedVoids } = await import('../src/geometry/identityMark.ts');
const { bearingOf, centroidOf, keyringMark, loopCentre } = await import('../src/ui/keyringMark.ts');
const { holeAwaitsCut, holeNoRoomShown, keychainMoved, showKeychainStyleRows } = await import('../src/ui/keychainRows.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type ClickerPart = import('../src/types.ts').ClickerPart;
type Ring = import('../src/types.ts').Ring;
type HoleVoid = import('../src/geometry/keychainHole.ts').HoleVoid;
type Pt = [number, number];

const wasm: any = await Module();
wasm.setup();
const { Manifold } = wasm;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ the worker's assets */

const asset = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = readModel(buf, 'asset.3mf');
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const out = solid.translate([
    -(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, dropTopToZero ? -bb.max[2] : 0,
  ]);
  solid.delete();
  return out;
}
const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);
const sbb = socket.boundingBox();
const POCKET_HALF = Math.max(sbb.max[0], sbb.max[1], -sbb.min[0], -sbb.min[1]);

/* ------------------------------------------------------------------ designs */

const DEFAULTS: BuildParams = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [247, 247, 245], bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
};
const square = (w: number): Ring => [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
const FULL = square(1);
const art: BuildRegion = { filamentRgb: [200, 30, 30], coverage: 1, rings: [FULL], partName: 'top-color-0-0' };
const rectBody = (w: number): Partial<BuildParams> => ({ baseShape: 'rect', bodySize: { w, h: w } });
const hole = (angleDeg: number, over: Partial<BuildParams['keychain']> = {}): Partial<BuildParams> =>
  ({ keychain: { enabled: true, style: 'hole', angleDeg, holeDiameterMm: 5.2, offsetMm: 0, ...over } });
const build = (over: Partial<BuildParams>) => buildClicker(wasm, socket, stem, [art], [FULL], { ...DEFAULTS, ...over });

/** Every hole build, for the identity-mark check at the end. */
const holeBuilds: { label: string; warnings: string[] }[] = [];
const buildHole = (label: string, over: Partial<BuildParams>) => {
  const r = build(over);
  holeBuilds.push({ label, warnings: r.warnings });
  return r;
};

/* ------------------------------------------------------------------ measuring */

const bodyPart = (parts: ClickerPart[]) => parts.find((p) => p.group === 'base' && p.name === 'base-body')
  ?? parts.find((p) => p.group === 'base')!;
const solidOf = (p: ClickerPart) => {
  const mesh = new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts });
  return Manifold.ofMesh(mesh);
};
/** Solid pieces: identity voids are tiny negative shells in `decompose()`, so count the big ones. */
const pieces = (m: any) => {
  const list = m.decompose();
  const n = list.filter((c: any) => c.volume() > 50).length;
  for (const c of list) c.delete();
  return n;
};
const PROBE_R = 0.2;
const probeAt = (m: any, x: number, y: number, z: number) => {
  const s = Manifold.sphere(PROBE_R, 12);
  const at = s.translate([x, y, z]);
  const inter = m.intersect(at);
  const share = inter.volume() / at.volume();
  for (const o of [s, at, inter]) o.delete();
  return share;
};
const air = (m: any, x: number, y: number, z: number) => probeAt(m, x, y, z) < 1e-6;
const solid = (m: any, x: number, y: number, z: number) => probeAt(m, x, y, z) > 0.98;

function segDist(q: Pt, a: Pt, b: Pt) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ey * t);
}
const edgeDist = (rings: Ring[], q: Pt) => {
  let d = Infinity;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(q, r[j], r[i]));
  return d;
};
function inside(rings: Ring[], q: Pt) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
const areaOf = (rings: Ring[]) => rings.reduce((s, r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s + a / 2;
}, 0);

/** Where the build puts the edge point for a bearing: a ray from the footprint's centroid. */
function edgePoint(rings: Ring[], angleDeg: number): Pt {
  let area = 0, cx = 0, cy = 0;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cr = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cr; cx += (ring[j][0] + ring[i][0]) * cr; cy += (ring[j][1] + ring[i][1]) * cr;
  }
  area *= 0.5;
  const ox = cx / (6 * area), oy = cy / (6 * area);
  const rad = (angleDeg * Math.PI) / 180, dx = Math.cos(rad), dy = Math.sin(rad);
  let best = -Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const ex = ring[i][0] - ax, ey = ring[i][1] - ay;
    const det = -dx * ey + ex * dy;
    if (Math.abs(det) < 1e-12) continue;
    const rx = ax - ox, ry = ay - oy;
    const t = (-rx * ey + ex * ry) / det, u = (dx * ry - dy * rx) / det;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return [ox + dx * best, oy + dy * best];
}

/** The identity voids for a seed, placed round a switch at the origin as the build places them. */
function voidsFor(seed: string | null): HoleVoid[] {
  const clear = (d: number, th: number) =>
    POCKET_HALF / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)), 1e-6) + d / 2 + 0.15;
  return [...(seed ? markVoids(seed) : []), ...hardcodedVoids()].map((v) => {
    const th = (v.thetaDeg * Math.PI) / 180;
    const vr = Math.max(v.r, clear(v.d, th));
    return { x: vr * Math.cos(th), y: vr * Math.sin(th), z: v.z, r: v.d / 2 };
  });
}

/* ------------------------------------------------------------------ 1. the planner, pure */

// The body's own numbers, from a build: its footprint, its underside, the well floor.
const plain40 = build(rectBody(40));
const bodyBottom40 = solidOf(bodyPart(plain40.parts)).boundingBox().min[2];
/** At travel 4 the well floor is the switch plate's top, z 0. */
const WELL_FLOOR_Z = 0;
const planAt = (rings: Ring[], p: Pt, voids: HoleVoid[], askedBore = 5.2) => planHole({
  rings, p, askedBore, bodyBottomZ: bodyBottom40, wellFloorZ: WELL_FLOOR_Z,
  switches: [{ x: 0, y: 0, rotation: 0 }], pocketHalf: POCKET_HALF, voids,
});
const BEARINGS = Array.from({ length: 24 }, (_, i) => i * 15);
{
  const voids = voidsFor('clicker-pin-seed');
  const body = (w: number) => build(rectBody(w)).layout.body;
  const sweep = (w: number) => {
    const rings = body(w);
    return BEARINGS.map((a) => planAt(rings, edgePoint(rings, a), voids));
  };
  const p40 = sweep(40);
  check('a 40 mm body takes the asked 5.2 mm bore at every bearing',
    p40.every((p) => p.ok && p.bore === 5.2 && !p.narrowed), `${p40.filter((p) => p.ok && p.bore === 5.2).length} of 24`);
  const p26 = sweep(26);
  check('the smallest body has no room: the switch pocket is in the way at every bearing',
    p26.every((p) => !p.ok && p.why === 'pocket'), p26.map((p) => (p.ok ? 'ok' : p.why)).join(' '));
  const p30 = sweep(30);
  const narrowed = p30.filter((p) => p.ok && p.narrowed);
  check('a 30 mm body gets a narrower bore, never under 3.2 mm',
    narrowed.length > 0 && p30.every((p) => !p.ok || (p.bore >= HOLE.BORE_MIN && p.bore <= 5.2)),
    `${p30.filter((p) => p.ok).length} of 24 fit, ${narrowed.length} narrowed: ${narrowed.map((p) => p.ok && p.bore).join(', ')} mm`);
  // A 4 mm notch, 8 deep, in the top of a 40 mm square: its bottom is no clean arc of wall.
  const notched: Ring[] = [[[-20, -20], [20, -20], [20, 20], [2, 20], [0, 12], [-2, 20], [-20, 20]]];
  const inNotch = planAt(notched, [0, 12], []);
  check('a point at the bottom of a notch is refused for the edge', !inNotch.ok && inNotch.why === 'edge', inNotch.ok ? 'it fit' : inNotch.why);
  const big = planAt(body(40), edgePoint(body(40), 90), [], 8);
  check('a bore asked over 6 mm is capped at 6 and said to be narrowed', big.ok && big.bore === 6 && big.narrowed, big.ok ? `${big.bore} mm` : big.why);
  check('the bores tried end on 3.2 mm even when the steps pass it',
    JSON.stringify(boresToTry(5)) === JSON.stringify([5, 4.6, 4.2, 3.8, 3.4, 3.2]) && JSON.stringify(boresToTry(5.2)) === JSON.stringify([5.2, 4.8, 4.4, 4, 3.6, 3.2]),
    `${boresToTry(5).join(' ')} | ${boresToTry(5.2).join(' ')}`);
  const circle: Ring = Array.from({ length: 96 }, (_, i) => [20 * Math.cos((i / 96) * 2 * Math.PI), 20 * Math.sin((i / 96) * 2 * Math.PI)] as Pt);
  const snapped = [[30, 5], [3, 18], [-12, -12]].map((q) => snapToEdge([circle], q as Pt));
  const worst = Math.max(...snapped.map((q) => edgeDist([circle], q)));
  check('a point slid off the edge snaps back onto the outline', worst < 0.001, `${worst.toExponential(1)} mm off at worst`);

  // Thirty seeds, every bearing of a 30 and a 34 mm body (where the cavities and the tunnel share
  // the slab): measured along the tunnel's centre line, no accepted tunnel comes within 0.4 mm.
  let accepted = 0, refusedForVoids = 0, closest = Infinity;
  for (let s = 0; s < 30; s++) {
    const seeded = voidsFor(`seed-${s}`);
    for (const w of [30, 34]) {
      const rings = body(w);
      for (const a of BEARINGS) {
        const p = edgePoint(rings, a);
        const plan = planAt(rings, p, seeded);
        if (!plan.ok) {
          if (plan.why === 'voids') refusedForVoids++;
          continue;
        }
        accepted++;
        for (let k = 0; k < 360; k += 1) {
          const t = (k * Math.PI) / 180;
          const q: Pt = [p[0] + plan.R * Math.cos(t), p[1] + plan.R * Math.sin(t)];
          if (!inside(rings, q)) continue;
          for (const v of seeded) {
            const gap = Math.hypot(q[0] - v.x, q[1] - v.y, plan.zMid - v.z) - plan.r - v.r;
            closest = Math.min(closest, gap);
          }
        }
      }
    }
  }
  check('thirty seeds: no accepted tunnel comes within 0.4 mm of an internal cavity, and the rule bites',
    closest >= HOLE.VOID_GAP - 0.02 && refusedForVoids > 0,
    `${accepted} accepted, ${refusedForVoids} refused for a cavity, closest ${closest.toFixed(2)} mm`);
}

/* ------------------------------------------------------------------ 2-4. the cut, and its layout */

/** The tunnel as built, read back from the layout: centre, radii, height. */
const tunnelOf = (r: ReturnType<typeof build>, bottomZ: number) => {
  const L = r.layout.loop!;
  const rr = L.holeR, R = L.outerR - rr;
  return { x: L.x, y: L.y, r: rr, R, zMid: bottomZ + HOLE.FLOOR + rr };
};
/** Air all round the centre line (inside the body and out), and solid 0.6 mm into the 1.2 mm
 *  wall above, below, inside and outside the tube wherever that wall is inside the body. */
function tunnelProbe(m: any, t: ReturnType<typeof tunnelOf>, rings: Ring[]) {
  let lineAir = 0, lineN = 0, wallSolid = 0, wallN = 0;
  const off = t.r + HOLE.WALL / 2;
  for (let k = 0; k < 360; k += 7.5) {
    const c = Math.cos((k * Math.PI) / 180), s = Math.sin((k * Math.PI) / 180);
    const q: Pt = [t.x + t.R * c, t.y + t.R * s];
    lineN++;
    if (air(m, q[0], q[1], t.zMid)) lineAir++;
    for (const [dx, dz] of [[0, off], [0, -off], [off, 0], [-off, 0]]) {
      const w: Pt = [t.x + (t.R + dx) * c, t.y + (t.R + dx) * s];
      // Only where that point of the wall is inside the body, clear of its outer face.
      if (!inside(rings, w) || edgeDist(rings, w) < 0.5) continue;
      wallN++;
      if (solid(m, w[0], w[1], t.zMid + dz)) wallSolid++;
    }
  }
  return { lineAir, lineN, wallSolid, wallN };
}
{
  const r = buildHole('rect 40 at 90', { ...rectBody(40), ...hole(90) });
  const m = solidOf(bodyPart(r.parts));
  const m0 = solidOf(bodyPart(plain40.parts));
  const bottom = m.boundingBox().min[2];
  const t = tunnelOf(r, bottom);
  const ours = r.warnings.filter((w) => !w.startsWith('Design scaled down'));
  check('rect 40 at 90: nothing said, nothing blocking', ours.length === 0 && r.blocking.length === 0,
    JSON.stringify([...ours, ...r.blocking]));
  check('the cut leaves as many solid pieces as the body without it', pieces(m) === pieces(m0) && pieces(m) === 1,
    `${pieces(m)} with, ${pieces(m0)} without`);
  const halfRing = Math.PI ** 2 * t.R * t.r ** 2;
  const gone = m0.volume() - m.volume();
  check('the volume of half the ring is gone', Math.abs(gone - halfRing) / halfRing < 0.06,
    `${gone.toFixed(1)} mm3 gone, half the ring is ${halfRing.toFixed(1)}`);
  const pr = tunnelProbe(m, t, r.layout.body);
  check('the whole centre line is air: two openings and the bend between', pr.lineAir === pr.lineN, `${pr.lineAir} of ${pr.lineN}`);
  check('1.2 mm of solid all round the tube', pr.wallSolid === pr.wallN && pr.wallN >= 40, `${pr.wallSolid} of ${pr.wallN}`);
  const L = r.layout;
  check('layout: the hole is on the body\'s edge, its radii are the tunnel\'s',
    L.loop?.style === 'hole' && edgeDist(L.body, [L.loop.x, L.loop.y]) < 0.05 && L.loop.holeR === 2.6
      && Math.abs(L.loop.outerR - (2.6 + HOLE.BEND + 2.6)) < 1e-9,
    `at ${L.loop?.x.toFixed(2)}, ${L.loop?.y.toFixed(2)}, r ${L.loop?.holeR}, outer ${L.loop?.outerR}`);
  const want = 2 * Math.PI * t.R * t.r; // half the annulus between R - r and R + r
  const got = L.tunnel ? areaOf(L.tunnel) : 0;
  check('layout: the tunnel\'s outline is half the ring, inside the body; no silhouette',
    !!L.tunnel && Math.abs(got - want) / want < 0.05 && !L.silhouette,
    `${got.toFixed(1)} mm2 against ${want.toFixed(1)}`);
  const tunnelBottom = t.zMid - t.r;
  check('the tube stands one floor above the underside', Math.abs(tunnelBottom - bottom - HOLE.FLOOR) < 1e-9,
    `bottom ${tunnelBottom.toFixed(2)}, underside ${bottom.toFixed(2)}`);
  m.delete();
  m0.delete();

  // Slid along the edge: still on it.
  const slid = buildHole('rect 40 at 90, slid 4 mm', { ...rectBody(40), ...hole(90, { offsetMm: 4 }) });
  check('slid 4 mm along the edge, the hole stays on it', !!slid.layout.loop && edgeDist(slid.layout.body, [slid.layout.loop.x, slid.layout.loop.y]) < 0.05
    && Math.abs(slid.layout.loop.x - 4) < 0.05, `at ${slid.layout.loop?.x.toFixed(2)}, ${slid.layout.loop?.y.toFixed(2)}`);
  const onCircle = buildHole('circle 40 at 60, slid 3 mm', { baseShape: 'circle', capWidthMm: 40, ...hole(60, { offsetMm: 3 }) });
  check('slid along a curved edge, the hole is put back on it', !!onCircle.layout.loop
    && edgeDist(onCircle.layout.body, [onCircle.layout.loop.x, onCircle.layout.loop.y]) < 0.05,
    `${edgeDist(onCircle.layout.body, [onCircle.layout.loop!.x, onCircle.layout.loop!.y]).toFixed(3)} mm off the outline`);

  // A loop build is what it was: no style, no tunnel.
  const looped = build({ ...rectBody(40), keychain: { enabled: true, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 } });
  check('a loop build: no style and no tunnel in its layout, a silhouette as before',
    !!looped.layout.loop && !('style' in looped.layout.loop) && !looped.layout.tunnel && !!looped.layout.silhouette,
    JSON.stringify(looped.layout.loop));
}

/* ------------------------------------------------------------------ 5-6. no room, and narrowed */
{
  const plain26 = build(rectBody(26));
  const r = buildHole('rect 26 at 90', { ...rectBody(26), ...hole(90) });
  const v0 = solidOf(bodyPart(plain26.parts)), v1 = solidOf(bodyPart(r.parts));
  check('no room: one blocking sentence, nothing cut, the asked place still in the layout',
    r.blocking.length === 1 && r.blocking[0] === 'No room for a keyring hole here. Move it, make the clicker larger, or use Loop.'
      && Math.abs(v0.volume() - v1.volume()) < 1e-6 && r.layout.loop?.style === 'hole' && !r.layout.tunnel,
    `${JSON.stringify(r.blocking)}; volume ${v1.volume().toFixed(2)} against ${v0.volume().toFixed(2)}`);
  v0.delete();
  v1.delete();
  const moved = buildHole('rect 40 at 270', { ...rectBody(40), ...hole(270) });
  check('given room, the line goes', moved.blocking.length === 0 && !!moved.layout.tunnel, JSON.stringify(moved.blocking));

  let said: { a: number; warnings: string[]; holeR: number } | null = null;
  for (const a of BEARINGS) {
    const n = buildHole(`rect 30 at ${a}`, { ...rectBody(30), ...hole(a) });
    if (n.layout.tunnel && n.layout.loop!.holeR < 2.6) {
      said = { a, warnings: n.warnings, holeR: n.layout.loop!.holeR };
      break;
    }
  }
  check('a bore the engine narrowed says so, with the size it made',
    !!said && said.warnings.includes(`Hole made ${(2 * said.holeR).toFixed(1)} mm to fit.`),
    said ? `at ${said.a}: ${JSON.stringify(said.warnings)}` : 'no narrowed build on rect 30');
}

/* ------------------------------------------------------------------ 6b. placed, then cut */
{
  /* A hole is placed first and cut on request (`holeCut: false` until Cut hole is pressed). While
     it is only placed, nothing is cut and the layout says where the cutter is and at what height,
     for the preview to draw it; no room is said, not blocking, since nothing is cut yet. */
  const placed = buildHole('rect 40 at 90, placed', { ...rectBody(40), ...hole(90, { holeCut: false }) });
  const cut = buildHole('rect 40 at 90, cut', { ...rectBody(40), ...hole(90, { holeCut: true }) });
  const m0 = solidOf(bodyPart(plain40.parts));
  const mP = solidOf(bodyPart(placed.parts));
  const mC = solidOf(bodyPart(cut.parts));
  const bottom = mP.boundingBox().min[2];
  const P = placed.layout.loop, C = cut.layout.loop;
  check('placed: nothing is cut (the body is the body without a hole), no tunnel in the layout',
    Math.abs(mP.volume() - m0.volume()) < 1e-6 && !placed.layout.tunnel, `volume ${mP.volume().toFixed(2)} against ${m0.volume().toFixed(2)}`);
  const placedOurs = placed.warnings.filter((w) => !w.startsWith('Design scaled down'));
  check('placed with room: nothing said (Cut hole is on screen), nothing blocks, no word of no room',
    placed.blocking.length === 0 && placedOurs.length === 0 && !P?.noRoom, JSON.stringify([...placed.warnings, ...placed.blocking]));
  check('placed: the cutter is where the cut goes, the same ring at the tube height',
    !!P && !!C && P.uncut === true && !C.uncut && P.x === C.x && P.y === C.y && P.outerR === C.outerR && P.holeR === C.holeR
      && P.z === C.z && Math.abs((P.z ?? 0) - (bottom + HOLE.FLOOR + P.holeR)) < 1e-4,
    JSON.stringify([P, C, bottom]));
  check('cut: the same tunnel as a hole saved without the flag',
    Math.abs(mC.volume() - solidOf(bodyPart(buildHole('rect 40 at 90, no flag', { ...rectBody(40), ...hole(90) }).parts)).volume()) < 1e-6
      && !!cut.layout.tunnel && !C?.noRoom,
    `${mC.volume().toFixed(2)} mm3`);
  const tight = buildHole('rect 26 at 90, placed', { ...rectBody(26), ...hole(90, { holeCut: false }) });
  check('placed with no room: said, not blocking, nothing cut, and the layout says no room',
    tight.blocking.length === 0 && tight.warnings.includes('No room for a keyring hole here. Move it, make the clicker larger, or use Loop.')
      && tight.layout.loop?.uncut === true && tight.layout.loop.noRoom === true && !tight.layout.tunnel,
    JSON.stringify([...tight.warnings, ...tight.blocking]));
  const refused = buildHole('rect 26 at 90, cut', { ...rectBody(26), ...hole(90, { holeCut: true }) });
  check('cut with no room: refused, the layout says no room and keeps the tube\'s height for the grip',
    refused.blocking.length === 1 && refused.layout.loop?.noRoom === true && !refused.layout.loop.uncut
      && Math.abs((refused.layout.loop.z ?? NaN) - (bottom + HOLE.FLOOR + refused.layout.loop.holeR)) < 0.5,
    JSON.stringify(refused.layout.loop));
  // The line under Cut hole: on, a hole, and no room; never a loop, a block set or a keyring off.
  const kcRow = (over: object) => ({ enabled: true, style: 'hole' as const, ...over });
  check('the rail: the no-room line shows for a hole the build found no room for, and only then',
    holeNoRoomShown('image', kcRow({}), true) && !holeNoRoomShown('image', kcRow({}), false)
      && !holeNoRoomShown('image', kcRow({ enabled: false }), true) && !holeNoRoomShown('image', kcRow({ style: 'loop' }), true)
      && !holeNoRoomShown('blocks', kcRow({}), true),
    'no room / room / off / loop / blocks');
  for (const m of [m0, mP, mC]) m.delete();
  // Cut hole shows only for a hole that is on, placed and not cut, and never on a block set.
  const kc = (over: object) => ({ enabled: true, style: 'hole' as const, holeCut: false, ...over });
  check('the rail: Cut hole shows for a placed hole only',
    holeAwaitsCut('image', kc({})) && !holeAwaitsCut('image', kc({ holeCut: true })) && !holeAwaitsCut('image', kc({ holeCut: undefined }))
      && !holeAwaitsCut('image', kc({ enabled: false })) && !holeAwaitsCut('image', kc({ style: 'loop' })) && !holeAwaitsCut('blocks', kc({})),
    'placed / cut / no flag / off / loop / blocks');
  // Reset position shows once Position or Fine offset has left a new clicker's 90° and 0 mm.
  check('the rail: Reset position shows only once the keyring has moved',
    !keychainMoved({ angleDeg: 90, offsetMm: 0 }) && keychainMoved({ angleDeg: 95, offsetMm: 0 }) && keychainMoved({ angleDeg: 90, offsetMm: -0.5 }),
    'at start / turned / slid');
}

/* ------------------------------------------------------------------ 6c. finding the place */
{
  /* A hole being placed is put where it fits: `findHoleBearing` tries every 5°, nearest the
     bearing Position points at first, and takes the first where the asked bore fits as asked;
     failing that, the widest bore anywhere; failing that, none. Checked against trying every
     bearing by hand with the planner itself. */
  const voids = voidsFor('clicker-pin-seed');
  const order = scanBearings(90);
  check('the scan tries 72 bearings, 5° apart, 90° first and then a step either side',
    order.length === 72 && new Set(order).size === 72 && order[0] === 90 && order[1] === 95 && order[2] === 85
      && order.every((d) => d % SCAN_STEP_DEG === 0 && d >= 0 && d < 360) && order.at(-1) === 270,
    order.slice(0, 5).join(' ') + ' … ' + order.at(-1));
  const scanIn = (rings: Ring[], nearDeg = 90, askedBore = 5.2) => ({
    rings, askedBore, bodyBottomZ: bodyBottom40, wellFloorZ: WELL_FLOOR_Z,
    switches: [{ x: 0, y: 0, rotation: 0 }], pocketHalf: POCKET_HALF, voids,
    pointAt: (deg: number) => edgePoint(rings, deg), nearDeg,
  });
  /** What the scan should find, worked out the long way: the planner at every bearing in order. */
  const byHand = (rings: Ring[], nearDeg = 90, askedBore = 5.2) => {
    const plans = scanBearings(nearDeg).map((deg) => ({ deg, plan: planAt(rings, edgePoint(rings, deg), voids, askedBore) }));
    const asked = plans.find((p) => p.plan.ok && !p.plan.narrowed);
    if (asked) return { deg: asked.deg, bore: (asked.plan as { bore: number }).bore };
    let best: { deg: number; bore: number } | null = null;
    for (const p of plans) if (p.plan.ok && (!best || p.plan.bore > best.bore)) best = { deg: p.deg, bore: p.plan.bore };
    return best;
  };
  const body = (over: Partial<BuildParams>) => build(over).layout.body;
  const notched: Ring[] = [[[-20, -20], [20, -20], [20, 20], [2, 20], [0, 12], [-2, 20], [-20, 20]]];
  const cases: [string, Ring[], number][] = [
    ['rect 40', body(rectBody(40)), 90],
    ['rect 40, from 270', body(rectBody(40)), 270],
    ['a notch at the top', notched, 90],
    ['rect 30', body(rectBody(30)), 90],
    ['rect 26', body(rectBody(26)), 90],
    ['heart 40', body({ baseShape: 'heart', capWidthMm: 40 }), 90],
    ['star 40', body({ baseShape: 'star', capWidthMm: 40 }), 90],
  ];
  const found: Record<string, { deg: number; bore: number } | null> = {};
  let slowest = 0;
  for (const [name, rings, near] of cases) {
    const t0 = performance.now();
    const got = findHoleBearing(scanIn(rings, near));
    slowest = Math.max(slowest, performance.now() - t0);
    const want = byHand(rings, near);
    found[name] = got;
    check(`${name}: the scan finds what trying every bearing finds`, JSON.stringify(got) === JSON.stringify(want),
      `scan ${JSON.stringify(got)}, by hand ${JSON.stringify(want)}`);
  }
  check('a 40 mm body: the top, at the asked 5.2 mm; from 270°, the bottom',
    found['rect 40']?.deg === 90 && found['rect 40']?.bore === 5.2 && found['rect 40, from 270']?.deg === 270, JSON.stringify([found['rect 40'], found['rect 40, from 270']]));
  const notch = found['a notch at the top'];
  check('a notch at the top: the nearest bearing beside it, at the asked bore',
    !!notch && notch.deg !== 90 && Math.abs(notch.deg - 90) <= 30 && notch.bore === 5.2, JSON.stringify(notch));
  check('the smallest body: no bearing has room, so none is found', found['rect 26'] === null, JSON.stringify(found['rect 26']));
  check('the scan is quick enough to run on the build that places a hole', slowest < 1500, `${slowest.toFixed(0)} ms at worst`);

  /* The build, on an Outline base whose picture has a notch in its top (as a wide logo's outline
     can): at 90° there is no room; asked to find the place, it builds where it fits, says the
     bearing, and says nothing else. */
  const NOTCH: Ring = [[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [0.14, 0.3], [0, 0.08], [-0.14, 0.3], [-0.5, 0.3]];
  const notchArt: BuildRegion = { filamentRgb: [200, 30, 30], coverage: 1, rings: [NOTCH], partName: 'top-color-0-0' };
  const notchHole = (label: string, over: Partial<BuildParams['keychain']>, find = false) => {
    const r = buildClicker(wasm, socket, stem, [notchArt], [NOTCH], { ...DEFAULTS, capWidthMm: 44, ...hole(90, over), ...(find ? { holeFind: true } : {}) });
    holeBuilds.push({ label, warnings: r.warnings });
    return r;
  };
  const notchAt90 = notchHole('notched outline at 90, placed', { holeCut: false });
  const notchFound = notchHole('notched outline, placed, found', { holeCut: false }, true);
  const HF = notchFound.layout.loop;
  const fd = HF?.foundDeg ?? NaN;
  const [ex, ey] = edgePoint(notchFound.layout.body, fd);
  check('a notched outline: no room at 90°; placed with the find, built at the bearing it says, on the edge, with room, and no line',
    notchAt90.layout.loop?.noRoom === true && !!HF && Number.isFinite(fd) && fd !== 90 && Math.hypot(HF.x - ex, HF.y - ey) < 0.05
      && !HF.noRoom && HF.uncut === true && notchFound.warnings.filter((w) => !w.startsWith('Design scaled down')).length === 0,
    `found ${HF?.foundDeg} (at 90 without it: ${notchAt90.layout.loop?.noRoom ? 'no room' : 'room'}); ${JSON.stringify(notchFound.warnings)}`);
  // Built for real: cut there it takes the asked bore, and every bearing the scan tried first does not.
  const cutThere = notchHole(`notched outline at ${fd}`, { angleDeg: fd });
  const tried = scanBearings(90).slice(0, Math.max(0, scanBearings(90).indexOf(fd)));
  const nearer = tried.map((deg) => notchHole(`notched outline at ${deg}`, { angleDeg: deg }));
  check('…cut there, the asked bore fits; every bearing tried before it is refused or narrowed',
    !!cutThere.layout.tunnel && cutThere.layout.loop?.holeR === 2.6 && cutThere.blocking.length === 0
      && nearer.every((r) => r.blocking.length > 0 || (r.layout.loop?.holeR ?? 0) < 2.6),
    `${fd}°; before it ${tried.join(', ') || 'none'}: ${nearer.map((r) => (r.blocking.length ? 'refused' : `${(2 * (r.layout.loop?.holeR ?? 0)).toFixed(1)} mm`)).join(', ')}`);
  const noFind = buildHole('rect 26, placed, found', { ...rectBody(26), ...hole(90, { holeCut: false, offsetMm: 2 }), holeFind: true });
  check('nowhere to find: no bearing in the layout, the asked place kept, no room said',
    noFind.layout.loop?.foundDeg === undefined && noFind.layout.loop?.noRoom === true && Math.abs((noFind.layout.loop?.x ?? 0) - 2) < 0.05,
    JSON.stringify(noFind.layout.loop));
  const sameAsBefore = buildHole('rect 40 at 30, placed', { ...rectBody(40), ...hole(30, { holeCut: false }) });
  check('without the find, a placed hole is where Position puts it and says no bearing',
    sameAsBefore.layout.loop?.foundDeg === undefined && Math.hypot(sameAsBefore.layout.loop!.x - edgePoint(sameAsBefore.layout.body, 30)[0], sameAsBefore.layout.loop!.y - edgePoint(sameAsBefore.layout.body, 30)[1]) < 0.05,
    JSON.stringify(sameAsBefore.layout.loop));

  // The 3D grip's bearing: a point the build puts at a bearing reads that bearing back.
  const heartBody = cases.find(([name]) => name === 'heart 40')![1];
  const worstTurn = Math.max(...[0, 45, 135, 200, 300].map((a) => {
    const [x, y] = loopCentre(heartBody, a, 0);
    const back = bearingOf(heartBody, x, y);
    return Math.abs(((back - a + 540) % 360) - 180);
  }));
  check('the grip: a point on the edge reads back the bearing that put it there', worstTurn < 1e-6, `${worstTurn.toExponential(1)}° off at worst`);
}

/* ------------------------------------------------------------------ 7. hollow base */
{
  const flat: Partial<BuildParams> = { ...rectBody(50), hollowBase: true, edgeSettings: [] };
  const r = buildHole('rect 50 hollow at 90', { ...flat, ...hole(90) });
  const m = solidOf(bodyPart(r.parts));
  const t = tunnelOf(r, m.boundingBox().min[2]);
  const pr = tunnelProbe(m, t, r.layout.body);
  check('hollow base: one piece, the centre line all air, 1.2 mm of solid all round the tube',
    pieces(m) === 1 && pr.lineAir === pr.lineN && pr.wallSolid === pr.wallN && pr.wallN >= 40,
    `${pieces(m)} piece, air ${pr.lineAir} of ${pr.lineN}, wall ${pr.wallSolid} of ${pr.wallN}`);
  // The same tunnel cut into the hollow body with no island left round it opens into the cavity.
  const plain = solidOf(bodyPart(build(flat).parts));
  const tube = wasm.CrossSection.circle(t.r, 32);
  const moved = tube.translate([t.R, 0]);
  const ring = Manifold.revolve(moved, 64);
  const cutter = ring.translate([t.x, t.y, t.zMid]);
  const bare = plain.subtract(cutter);
  const prBare = tunnelProbe(bare, t, r.layout.body);
  check('without the island the tunnel would open into the cavity (why the island is there)',
    prBare.wallSolid < prBare.wallN, `${prBare.wallSolid} of ${prBare.wallN} wall points solid`);
  for (const o of [m, plain, tube, moved, ring, cutter, bare]) o.delete();
}

/* ------------------------------------------------------------------ 8. textured wall */
{
  const r = buildHole('knurled circle 40 at 90', { baseShape: 'circle', capWidthMm: 40, blockTexture: 'knurl', ...hole(90) });
  const m = solidOf(bodyPart(r.parts));
  const t = tunnelOf(r, m.boundingBox().min[2]);
  const pr = tunnelProbe(m, t, r.layout.body);
  // The same knurled body with no hole has crests on the centre line, just outside the plain
  // outline: those are what the finish has to cut the tunnel through again.
  const plain = solidOf(bodyPart(build({ baseShape: 'circle', capWidthMm: 40, blockTexture: 'knurl' }).parts));
  let crests = 0;
  for (let k = 0; k < 360; k += 2) {
    const q: Pt = [t.x + t.R * Math.cos((k * Math.PI) / 180), t.y + t.R * Math.sin((k * Math.PI) / 180)];
    if (!inside(r.layout.body, q) && probeAt(plain, q[0], q[1], t.zMid) > 0) crests++;
  }
  check('knurled wall: the crests do not close the openings', r.layout.textureMm > 0 && crests > 0 && pr.lineAir === pr.lineN && pieces(m) === 1,
    `texture ${r.layout.textureMm.toFixed(2)} mm, ${crests} crest points on the centre line without the hole, air ${pr.lineAir} of ${pr.lineN} with it`);
  m.delete();
  plain.delete();
}

/* ------------------------------------------------------------------ 10. bevelled underside */
{
  const r = buildHole('rect 40 at 90, 2.5 mm underside bevel',
    { ...rectBody(40), edgeSettings: [{ target: 'baseBottom', style: 'chamfer', radius: 2.5 }], ...hole(90) });
  const m = solidOf(bodyPart(r.parts));
  const bottom = m.boundingBox().min[2];
  const t = tunnelOf(r, bottom);
  // Where the centre line crosses the wall, just above the tube's lowest line.
  const crossings: Pt[] = [];
  for (let k = 0; k < 360; k += 0.5) {
    const a = (k * Math.PI) / 180, b = ((k + 0.5) * Math.PI) / 180;
    const p: Pt = [t.x + t.R * Math.cos(a), t.y + t.R * Math.sin(a)];
    const q: Pt = [t.x + t.R * Math.cos(b), t.y + t.R * Math.sin(b)];
    if (inside(r.layout.body, p) !== inside(r.layout.body, q)) crossings.push(p);
  }
  const lowOpen = crossings.every(([x, y]) => air(m, x, y, t.zMid - t.r + PROBE_R + 0.05));
  // The floor under the tube, in the middle of the arc (straight in from the edge point).
  const under: Pt = [t.x, t.y - t.R];
  const floorSolid = solid(m, under[0], under[1], bottom + HOLE.FLOOR / 2);
  check('bevelled underside: the bottom of each opening is open, the floor under the tube is whole',
    crossings.length === 2 && lowOpen && floorSolid && r.blocking.length === 0,
    `${crossings.length} crossings, open ${lowOpen}, floor ${floorSolid}`);
  m.delete();
}

/* ------------------------------------------------------------------ the Design view's handle */
{
  // The canvas puts a dragged handle where `loopCentre` says for the bearing it stands for; the
  // rebuild then draws it where the build put it. Any gap between the two is a jump on release.
  const cases: [string, Partial<BuildParams>, number][] = [
    ['rect 40', rectBody(40), 90],
    ['rect 40', rectBody(40), 30],
    ['circle 40', { baseShape: 'circle', capWidthMm: 40 }, 60],
    ['circle 40', { baseShape: 'circle', capWidthMm: 40 }, 200],
    ['heart 40', { baseShape: 'heart', capWidthMm: 40 }, 0],
    ['heart 40', { baseShape: 'heart', capWidthMm: 40 }, 135],
  ];
  for (const [name, shape, angle] of cases) {
    for (const style of ['hole', 'loop'] as const) {
      const r = style === 'hole'
        ? buildHole(`${name} at ${angle}`, { ...shape, ...hole(angle) })
        : build({ ...shape, keychain: { enabled: true, style, angleDeg: angle, holeDiameterMm: 5.2, offsetMm: 0 } });
      const L = r.layout.loop!;
      const mark = keyringMark(L);
      const [x, y] = loopCentre(r.layout.body, angle, mark.edgeOut);
      const [cx, cy] = centroidOf(r.layout.body);
      const back = ((Math.atan2(L.y - cy, L.x - cx) * 180) / Math.PI + 360) % 360;
      const turn = Math.abs(((back - angle + 540) % 360) - 180);
      check(`${name} at ${angle}, a ${style}: the canvas puts the handle where the build puts it, and reads the same bearing back`,
        Math.hypot(x - L.x, y - L.y) < 0.05 && turn < 0.5,
        `canvas ${x.toFixed(2)}, ${y.toFixed(2)}; build ${L.x.toFixed(2)}, ${L.y.toFixed(2)}; bearing back ${back.toFixed(1)}`);
    }
  }
  const asHole = keyringMark({ x: 0, y: 0, outerR: 6.6, holeR: 2.6, style: 'hole' });
  const asLoop = keyringMark({ x: 0, y: 0, outerR: 4.4, holeR: 2.6 });
  check('a hole\'s handle is a ring on the edge, named a hole, and is not framed; a loop\'s is a tab beyond it',
    asHole.label === 'Keyring hole' && asHole.edgeOut === 0 && asHole.ringOnly && !asHole.framed
      && asLoop.label === 'Keyring loop' && asLoop.edgeOut === 4.4 && !asLoop.ringOnly && asLoop.framed,
    JSON.stringify([asHole, asLoop]));
}

/* ------------------------------------------------------------------ the rail's rows */
{
  // What `update()` does to the Style row and the Hole size row on every render, with stand-ins.
  const rowsFor = (importMode: string, style: 'loop' | 'hole') => {
    const seen = { display: 'unset', bounds: [] as number[] };
    showKeychainStyleRows({
      styleField: { style: seen },
      sizeRow: { setBounds: (min: number, max: number) => { seen.bounds = [min, max]; } },
    }, importMode, style);
    return seen;
  };
  const picHole = rowsFor('image', 'hole');
  const picLoop = rowsFor('svg', 'loop');
  const blocksHole = rowsFor('blocks', 'hole');
  check('the rail: Style shows on a clicker and Hole size follows it; on a block set Style hides and the size is a loop\'s',
    picHole.display === '' && JSON.stringify(picHole.bounds) === '[3.2,6]'
      && picLoop.display === '' && JSON.stringify(picLoop.bounds) === '[3.2,8]'
      && blocksHole.display === 'none' && JSON.stringify(blocksHole.bounds) === '[3.2,8]',
    JSON.stringify([picHole, picLoop, blocksHole]));
}

/* ------------------------------------------------------------------ 9. identity marks */
{
  const lost = holeBuilds.filter((b) => b.warnings.some((w) => w.startsWith('Provenance')));
  check('every hole build keeps all its identity marks', lost.length === 0,
    `${holeBuilds.length} builds${lost.length ? `; lost in ${lost.map((b) => b.label).join(', ')}` : ''}`);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
