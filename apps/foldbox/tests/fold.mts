// Does the box actually CLOSE?
//
// The net tests prove the dieline is self-consistent — one blank, every panel
// touching its parent. They say nothing about whether folding it produces a box,
// and that is the thing that was wrong before: a net can derive perfectly and still
// fold into a shape that is not the shape on the card.
//
// So this drives the real fold rig to t = 1 and measures where the panels ended up
// in world space, against what the assembled box is supposed to measure.
//
// Run: pnpm --filter foldbox test:fold

import * as THREE from 'three';
import { solve } from '../src/geometry/solve';
import { buildRig } from '../src/fold/rig';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';
import { insideDims } from '../src/geometry/styles';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${msg}`);
}
function near(a: number, b: number, tol: number, msg: string): void {
  ok(Math.abs(a - b) <= tol, `${msg} — got ${a.toFixed(2)}, want ${b.toFixed(2)} ±${tol}`);
}

interface Placed {
  id: string;
  pts: THREE.Vector3[];
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Unit normal of the panel's plane in world space. */
  normal: THREE.Vector3;
}

/** Fold a style to completion and report every panel's world-space footprint. */
function fold(p: BoxParams): {
  placed: Map<string, Placed>;
  box: THREE.Box3;
  net: ReturnType<typeof solve>['net'];
  rig: ReturnType<typeof buildRig>;
} {
  const r = solve(p);
  const rig = buildRig(r.net, { color: '#eee', edge: '#333' });
  rig.setProgress(1);
  rig.object.updateMatrixWorld(true);

  const placed = new Map<string, Placed>();
  const box = new THREE.Box3();
  for (const node of rig.nodes) {
    const mesh = node.pivot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    if (!mesh) continue;
    const pos = mesh.geometry.getAttribute('position');
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
    if (!pts.length) continue;
    const min = pts[0]!.clone();
    const max = pts[0]!.clone();
    for (const v of pts) {
      min.min(v);
      max.max(v);
      box.expandByPoint(v);
    }
    const normal = new THREE.Vector3(0, 0, 1)
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
      .normalize();
    placed.set(node.panel.id, { id: node.panel.id, pts, min, max, normal });
  }
  return { placed, box, net: r.net, rig };
}

/** Every point at which a panel's folded surface crosses a given plane, expressed in
 *  that plane's own frame.
 *
 *  This exists because a handle box once passed its test by asserting that a slot
 *  OVERLAPPED the blade it was supposed to swallow, and any overlap at all passed.
 *  The assertion that finds the bug is CONTAINMENT — every part of the blade inside
 *  the ear's plane has to be inside the ear's SLOT — and containment needs the
 *  crossing itself, not a bbox. */
function crossings(mesh: THREE.Mesh, frame: THREE.Object3D): THREE.Vector3[] {
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getIndex();
  const n = idx ? idx.count : pos.count;
  const at = (i: number): THREE.Vector3 => {
    const j = idx ? idx.getX(i) : i;
    const v = new THREE.Vector3().fromBufferAttribute(pos, j).applyMatrix4(mesh.matrixWorld);
    return frame.worldToLocal(v);
  };
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const tri = [at(i), at(i + 1), at(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      if (a.z === b.z || a.z * b.z > 0) continue;
      const k = a.z / (a.z - b.z);
      out.push(new THREE.Vector3().lerpVectors(a, b, k));
    }
  }
  return out;
}

/** Net coordinates -> a panel's own pivot frame, by the same rule `buildRig` uses:
 *  origin at the hinge's start, +x along the hinge, the panel's body at +y.
 *
 *  Rebuilt here rather than reached for, because the rig keeps its frames to itself —
 *  and the part that has to match exactly is the ORDER of the hinge's two ends, since
 *  that is what decides which way +x runs along the wall, and so which end of the wall
 *  a slit's two endpoints land at. */
function panelLocal(
  net: ReturnType<typeof solve>['net'],
  panelId: string,
): (q: readonly [number, number]) => [number, number] {
  const panel = net.panels.find((q) => q.id === panelId)!;
  const crease = net.creases.find((c) => c.panelId === panelId)!;
  const rot = (
    q: readonly [number, number],
    o: readonly [number, number],
    th: number,
  ): [number, number] => [
    (q[0] - o[0]) * Math.cos(th) + (q[1] - o[1]) * Math.sin(th),
    -(q[0] - o[0]) * Math.sin(th) + (q[1] - o[1]) * Math.cos(th),
  ];
  const ring = panel.outline as readonly (readonly [number, number])[];
  const [xa, xb] = extent(ring, 0);
  const [ya, yb] = extent(ring, 1);
  const mid: [number, number] = [(xa + xb) / 2, (ya + yb) / 2];
  let a = crease.a;
  let b = crease.b;
  if (rot(mid, a, Math.atan2(b[1] - a[1], b[0] - a[0]))[1] < 0) [a, b] = [b, a];
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (q) => rot(q, a, th);
}

/** Where a folded panel's surface crosses a LINE lying in another panel's plane, given
 *  in that panel's own frame.
 *
 *  `crossings` above does the same job against the plane z = 0, and that is the right
 *  measurement when the two panels meet at an angle — a gable blade passing through an
 *  ear. It is no measurement at all when they end up PARALLEL: a claw lying flat on the
 *  inside of the wall it locks never crosses that wall's plane. What it has to cross is
 *  the SLIT cut in it, so the line is the thing to measure against. */
function crossingsAtY(mesh: THREE.Mesh, frame: THREE.Object3D, y: number): number[] {
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getIndex();
  const n = idx ? idx.count : pos.count;
  const at = (i: number): THREE.Vector3 => {
    const j = idx ? idx.getX(i) : i;
    const v = new THREE.Vector3().fromBufferAttribute(pos, j).applyMatrix4(mesh.matrixWorld);
    return frame.worldToLocal(v);
  };
  const out: number[] = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const tri = [at(i), at(i + 1), at(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const da = a.y - y;
      const db = b.y - y;
      if (da === db || da * db > 0) continue;
      out.push(a.x + ((b.x - a.x) * da) / (da - db));
    }
  }
  return out;
}

/** Axis extent of a ring. */
function extent(ring: readonly (readonly [number, number])[], axis: 0 | 1): [number, number] {
  const v = ring.map((q) => q[axis]);
  return [Math.min(...v), Math.max(...v)];
}

/** How thin the panel is along an axis: 0 means it lies exactly in that plane. */
function thickness(pl: Placed, axis: 'x' | 'y' | 'z'): number {
  return pl.max[axis] - pl.min[axis];
}

const SIZES: [number, number, number][] = [
  [90, 60, 25],
  [120, 80, 50],
  [60, 60, 60],
  [150, 40, 30],
];

// ───────────────────────────── mailer: roll end tuck top ─────────────────────────────

console.log('\nmailer — does the roll close over the ears and reach the floor?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'mailer', lengthMm: L, widthMm: W, heightMm: H };
  const t = p.caliperMm;
  const { placed, box, net } = fold(p);
  const tag = `${L}x${W}x${H}`;

  // THE LOCK. Everything else about a mailer is a wall; this is the only thing
  // stopping it springing open, and it is four slots that a tab has to actually
  // find. Checked in net space, where "the tab is at 2t out from the crease" and
  // "the slot spans this run of the floor" are both directly readable.
  const netBase = net.panels.find((q) => q.id === 'ml-base')!;
  ok(netBase.holes.length === 4, `${tag}: four slots in the floor (got ${netBase.holes.length})`);
  const innerNet = net.panels.find((q) => q.id === 'ml-linner')!;
  // Tab tips are the vertices furthest from the base — the extreme x on this end.
  const tabX = Math.min(...innerNet.outline.map((q) => q[0]));
  // Sorted, not in outline order: `ensureCCW` may have reversed the ring, so the
  // traversal order of the two tabs is not something to depend on.
  const tabYs = innerNet.outline
    .filter((q) => Math.abs(q[0] - tabX) < 1e-6)
    .map((q) => q[1])
    .sort((a, b) => a - b);
  const leftSlots = netBase.holes
    .map((h) => ({ x: extent(h, 0), y: extent(h, 1) }))
    .filter((s) => s.x[0] < (netBase.outline[0]![0] + netBase.outline[1]![0]) / 2)
    .sort((a, b) => a.y[0] - b.y[0]);
  ok(leftSlots.length === 2, `${tag}: two slots on the rolled end`);
  const plyX = Math.min(...netBase.outline.map((q) => q[0])) + 2 * t;
  for (const [i, s] of leftSlots.entries()) {
    ok(
      s.x[0]! <= plyX && plyX <= s.x[1]!,
      `${tag}: slot ${i} straddles where the inner ply stands` +
        ` (ply at ${plyX.toFixed(2)}, slot ${s.x[0]!.toFixed(2)}..${s.x[1]!.toFixed(2)})`,
    );
  }
  const tabPairs = [tabYs.slice(0, 2), tabYs.slice(2, 4)];
  for (const [i, pair] of tabPairs.entries()) {
    const s = leftSlots[i]!;
    const lo = Math.min(...pair);
    const hi = Math.max(...pair);
    ok(
      s.y[0]! < lo && hi < s.y[1]!,
      `${tag}: tab ${i} fits inside its slot with clearance` +
        ` (tab ${lo.toFixed(2)}..${hi.toFixed(2)}, slot ${s.y[0]!.toFixed(2)}..${s.y[1]!.toFixed(2)})`,
    );
  }

  // And it has to CLEAR THE FLOOR before it catches anything. The inner ply stops a
  // caliper above the floor and the floor is a caliper thick, so 2t of the tab's
  // length is dead travel and only what is left over does the locking.
  //
  // Nothing above tests this. A tab shortened to nothing still "fits inside its slot
  // with clearance", still straddles the ply, still gives four slots — and the box
  // springs open in the user's hands. The tab length was cut on 2026-09-19 to stop it
  // protruding so far; this is the floor it may not be cut through.
  const innerXs = [...new Set(innerNet.outline.map((q) => +q[0].toFixed(4)))].sort((a, b) => a - b);
  const protrusion = innerXs[1]! - innerXs[0]!;
  const deadTravel = 2 * t;
  ok(
    protrusion >= deadTravel + 0.4,
    `${tag}: the lock tab does not clear the floor` +
      ` (${protrusion.toFixed(2)} mm proud, ${deadTravel.toFixed(2)} of it dead travel)`,
  );

  const base = placed.get('ml-base')!;
  const wall = placed.get('ml-lwall')!;
  const inner = placed.get('ml-linner')!;
  const ear = placed.get('ml-ear-fl')!;
  const lid = placed.get('ml-lid')!;
  const tuck = placed.get('ml-tuck')!;
  ok(!!(base && wall && inner && ear && lid && tuck), `${tag}: every named panel exists`);

  // The base stays flat on the floor and the box stands H tall on it.
  near(thickness(base, 'z'), 0, 0.01, `${tag}: base stays flat`);
  // Rim, not overall extent: the locking tabs stick out under the floor, which is
  // where they are supposed to be.
  near(box.max.z, H + t, 1.5, `${tag}: assembled height at the rim`);

  // Outer wall vertical, inner ply vertical, and the two a roll's width apart.
  near(thickness(wall, 'x'), 0, 0.01, `${tag}: end wall is vertical`);
  near(thickness(inner, 'x'), 0, 0.01, `${tag}: inner ply is vertical`);
  near(inner.min.x - wall.min.x, 2 * t, 0.05, `${tag}: inner ply sits 2t inside the wall`);
  near(wall.max.z, H, 0.6, `${tag}: end wall reaches the rim`);
  // The inner ply hangs from the rim back DOWN to just above the floor, and the tabs
  // carry on past it — which is the only reason the roll stays shut.
  ok(inner.min.z < 0, `${tag}: the roll's tabs pass through the floor (z=${inner.min.z.toFixed(2)})`);

  // Ears end up as vertical planes inside the end wall, not flapping in the wind.
  near(thickness(ear, 'x'), 0, 0.01, `${tag}: corner ear is vertical`);
  ok(
    ear.min.x > wall.min.x - 0.01 && ear.max.x < inner.min.x + 0.5,
    `${tag}: the ear is caught between the two plies of the roll` +
      ` (ear x=${ear.min.x.toFixed(2)}, wall x=${wall.min.x.toFixed(2)}, inner x=${inner.min.x.toFixed(2)})`,
  );

  // The lid ends up horizontal at the rim and the tuck hangs down inside the front.
  near(thickness(lid, 'z'), 0, 0.05, `${tag}: lid closes flat`);
  near(lid.min.z, H + t, 1.0, `${tag}: lid sits on the rim`);
  ok(tuck.min.z < lid.min.z - H * 0.5, `${tag}: the tuck runs down inside the front wall`);

  console.log(
    `  ok  ${tag}  closed box ${(box.max.x - box.min.x).toFixed(0)} × ` +
      `${(box.max.y - box.min.y).toFixed(0)} × ${(box.max.z - box.min.z).toFixed(0)} mm`,
  );
}

// ───────────────────────────── tray: ears inside the walls ─────────────────────────────

console.log('\ntray — do the ears end up behind the side walls?');
for (const [L, W, H] of SIZES) {
  for (const handle of [false, true]) {
    const p: BoxParams = {
      ...DEFAULT_PARAMS,
      style: 'tray',
      lengthMm: L,
      widthMm: W,
      heightMm: H,
      handle,
    };
    const { placed, box } = fold(p);
    const tag = `${L}x${W}x${H} ${handle ? 'with grips' : 'plain'}`;
    const t = p.caliperMm;
    const wall = placed.get('tr-lwall')!;
    const inner = placed.get('tr-linner')!;
    const earSW = placed.get('tr-sw')!;
    near(thickness(wall, 'x'), 0, 0.01, `${tag}: end wall is vertical`);
    near(thickness(earSW, 'x'), 0, 0.01, `${tag}: ear is vertical`);
    // THE LOCK. An ear folded in with nothing over it springs straight back and the
    // tray falls flat — which is what "no glue" used to mean here. It has to end up
    // between the end wall and the ply rolled down inside it.
    ok(
      earSW.min.x > wall.min.x - 0.01 && earSW.max.x < inner.min.x + 0.5,
      `${tag}: the ear is trapped in the roll` +
        ` (ear ${earSW.min.x.toFixed(2)}, wall ${wall.min.x.toFixed(2)}, inner ${inner.min.x.toFixed(2)})`,
    );
    ok(inner.min.z < 0, `${tag}: the roll's tabs pass through the floor`);
    near(inner.min.x - wall.min.x, 2 * t, 0.05, `${tag}: inner ply sits 2t inside the wall`);
    near(box.max.z, H + t + (handle ? p.handleHeightMm : 0), 2, `${tag}: rim height`);
    console.log(`  ok  ${tag}  rim at ${box.max.z.toFixed(0)} mm`);
  }
}

// ───────────────────── tray & lid: two locked trays, one nesting ─────────────────────

console.log('\ntray-lid — does the lid clear the tray, and does each half lock itself?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'tray-lid', lengthMm: L, widthMm: W, heightMm: H };
  const t = p.caliperMm;
  const { placed } = fold(p);
  const tag = `${L}x${W}x${H}`;
  for (const half of ['tr', 'ld']) {
    const wall = placed.get(`${half}-lwall`)!;
    const inner = placed.get(`${half}-linner`)!;
    const ear = placed.get(`${half}-sw`)!;
    ok(!!(wall && inner && ear), `${tag} [${half}]: rolled end and ear exist`);
    near(Math.abs(inner.min.x - wall.min.x), 2 * t, 0.05, `${tag} [${half}]: roll is 2t deep`);
    ok(
      ear.min.x > Math.min(wall.min.x, inner.min.x) - 0.01 &&
        ear.max.x < Math.max(wall.max.x, inner.max.x) + 0.5,
      `${tag} [${half}]: the ear is trapped in the roll`,
    );
  }
  // The lid has to come down OVER the tray, not into it.
  const trayBase = placed.get('tr-base')!;
  const lidBase = placed.get('ld-base')!;
  ok(lidBase.min.z > trayBase.max.z, `${tag}: the lid sits above the tray`);
  ok(
    lidBase.min.x <= trayBase.min.x + 0.01 && lidBase.max.x >= trayBase.max.x - 0.01,
    `${tag}: the lid is at least as long as the tray` +
      ` (lid ${lidBase.min.x.toFixed(1)}..${lidBase.max.x.toFixed(1)},` +
      ` tray ${trayBase.min.x.toFixed(1)}..${trayBase.max.x.toFixed(1)})`,
  );
  console.log(`  ok  ${tag}  lid ${(lidBase.max.x - lidBase.min.x).toFixed(1)} over tray ${(trayBase.max.x - trayBase.min.x).toFixed(1)} mm`);
}

// ─────────────── mailer-flaps: does the TUCK lock itself in? ───────────────

// The lugs are on the TUCK, not on the lid, and that is the whole style. Get it
// backwards and the flaps hinge horizontally instead of vertically: they drape down
// the ends, the blank looks near enough identical, and nothing holds the front shut.
console.log('\nmailer-flaps — do the tuck lugs swing in against the end walls?');
// 100 x 100 x 20 is the size it showed at, and the reason it was not caught: the
// shared matrix has no WIDE and SHALLOW box in it, which is the one shape where sizing
// the lug off W rather than off the tuck goes visibly wrong.
for (const [L, W, H] of [...SIZES, [100, 100, 20] as [number, number, number]]) {
  const p: BoxParams = {
    ...DEFAULT_PARAMS,
    style: 'mailer-flaps',
    lengthMm: L,
    widthMm: W,
    heightMm: H,
  };
  const { placed, net } = fold(p);
  const tag = `${L}x${W}x${H}`;

  const lid = placed.get('ml-lid')!;
  const tuck = placed.get('ml-tuck')!;
  const lf = placed.get('ml-tucklf')!;
  const lr = placed.get('ml-tucklr')!;
  ok(!!(lf && lr), `${tag}: both tuck lugs exist`);
  if (!lf || !lr) continue;

  // Adding the lugs must not disturb the tray or the lid they hang off.
  ok(net.panels.find((q) => q.id === 'ml-base')!.holes.length === 4, `${tag}: the four nib slots survive`);
  near(thickness(lid, 'z'), 0, 0.05, `${tag}: lid still closes flat`);
  ok(tuck.min.z < lid.min.z - H * 0.5, `${tag}: the tuck still runs down inside the front wall`);

  // THE LOCK. The lugs hang off the TUCK, whose side edges stand VERTICAL once it is
  // down, so each lug swings about a vertical axis and must end up as a plane of
  // constant x — flat against an end wall. Hang the same flaps off the LID instead and
  // they hinge horizontally and drape down the ends: the dieline looks much the same,
  // the animation looks fine, and nothing holds the tuck in.
  near(thickness(lf, 'x'), 0, 0.05, `${tag}: left lug swung in flat (a plane of constant x)`);
  near(thickness(lr, 'x'), 0, 0.05, `${tag}: right lug swung in flat`);

  // INSIDE the box, past each rolled end's inner ply.
  const li = placed.get('ml-linner')!;
  const ri = placed.get('ml-rinner')!;
  ok(
    lf.min.x >= li.min.x - 0.01 && lr.max.x <= ri.max.x + 0.01,
    `${tag}: both lugs are inside the box, clear of the inner plies` +
      ` (lugs ${lf.min.x.toFixed(2)}..${lr.max.x.toFixed(2)}, cavity ${li.min.x.toFixed(2)}..${ri.max.x.toFixed(2)})`,
  );

  // At the TUCK's depth, not the lid's — a lug up at the rim is holding nothing.
  ok(
    lf.max.z <= tuck.max.z + 0.01 && lf.min.z >= tuck.min.z - 0.01,
    `${tag}: the left lug sits within the tuck's own depth` +
      ` (lug z ${lf.min.z.toFixed(1)}..${lf.max.z.toFixed(1)}, tuck ${tuck.min.z.toFixed(1)}..${tuck.max.z.toFixed(1)})`,
  );

  // HOW FAR IN, and this is the one that was missing.
  //
  // The reach goes into the box's DEPTH, and it used to be taken from that depth —
  // `W * 0.35` — which is the wrong axis entirely: the lug hangs off the TUCK, and the
  // tuck is as deep as the box is tall. On a square box the two happen to agree, which is
  // why every size in the shared matrix passed. On a wide shallow one they do not, and a
  // 100 x 100 x 20 mailer grew a 35 mm paddle to fold across a 20 mm-deep floor.
  //
  // So: never further in than the tuck it hangs off is deep. Measured in world space, so
  // it is the built panel rather than the number the builder wrote down.
  const reach = lf.max.y - lf.min.y;
  const tuckDeep = tuck.max.z - tuck.min.z;
  ok(
    reach <= tuckDeep + 0.01,
    `${tag}: the lug reaches ${reach.toFixed(1)} mm in, past the ${tuckDeep.toFixed(1)} mm tuck it hangs off`,
  );

  console.log(
    `  ok  ${tag}  lugs reach ${reach.toFixed(1)} mm into the box (tuck is ${tuckDeep.toFixed(1)} deep), flat on both ends`,
  );
}

// ──────────────────── webbed tray: does each corner fold itself double? ────────────────────

// ECMA B20.04.00.00. The whole style stands or falls on one thing the flat dieline
// cannot show: the corner web has to collapse on its 45 degree crease and end up
// DOUBLED, flat against the end of the tray. Fold it the wrong way and the two halves
// end up edge to edge instead of face to face — the blank still cuts, the dieline
// still passes every net check, and the tray has a hole at every corner.
console.log('\ntray-webbed — does each corner web fold double and get trapped?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = {
    ...DEFAULT_PARAMS,
    style: 'tray-webbed',
    lengthMm: L,
    widthMm: W,
    heightMm: H,
  };
  const t = p.caliperMm;
  const { placed, box, net } = fold(p);
  const tag = `${L}x${W}x${H}`;

  const wall = placed.get('wt-lwall')!;
  const inner = placed.get('wt-linner')!;
  ok(!!(wall && inner), `${tag}: the rolled end exists`);
  near(thickness(wall, 'x'), 0, 0.01, `${tag}: end wall is vertical`);
  near(inner.min.x - wall.min.x, 2 * t, 0.05, `${tag}: inner ply sits 2t inside the wall`);

  // A webbed corner locks itself, so this style has NO nib tabs and therefore must
  // have no slots either — a slot with nothing through it is a hole in the floor.
  const netBase = net.panels.find((q) => q.id === 'wt-base')!;
  ok(netBase.holes.length === 0, `${tag}: no tab slots in the floor (got ${netBase.holes.length})`);
  ok(inner.min.z > -0.01, `${tag}: nothing hangs through the floor (z=${inner.min.z.toFixed(2)})`);

  // THE LOCK. Each corner is two triangles hinged on the diagonal; folded, they come
  // face to face, so their centroids land on top of each other. Edge to edge instead
  // and they sit a web's reach apart, which is what this catches.
  for (const corner of ['sw', 'se', 'nw', 'ne']) {
    const a = placed.get(`wt-${corner}a`)!;
    const b = placed.get(`wt-${corner}b`)!;
    ok(!!(a && b), `${tag} [${corner}]: both halves of the web exist`);
    if (!a || !b) continue;
    const ca = a.pts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(a.pts.length);
    const cb = b.pts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(b.pts.length);
    ok(
      ca.distanceTo(cb) <= Math.max(2.5, H * 0.25),
      `${tag} [${corner}]: the web folded double` +
        ` (halves ${ca.distanceTo(cb).toFixed(2)} mm apart, limit ${Math.max(2.5, H * 0.25).toFixed(1)})`,
    );
    // And the doubled web has to end up inside the roll, exactly where the nib-lock
    // tray puts its ear — that is what stops it springing back out. Against ITS OWN
    // end: the east corners belong to the east roll, and the east roll's inner ply
    // is mirrored, so the band is min..max of the pair rather than wall..inner.
    const end = corner.endsWith('w') ? 'l' : 'r';
    const ew = placed.get(`wt-${end}wall`)!;
    const ei = placed.get(`wt-${end}inner`)!;
    const lo = Math.min(ew.min.x, ei.min.x) - 0.6;
    const hi = Math.max(ew.max.x, ei.max.x) + 0.6;
    ok(
      a.min.x > lo && a.max.x < hi,
      `${tag} [${corner}]: the web is trapped in the ${end === 'l' ? 'west' : 'east'} roll` +
        ` (web ${a.min.x.toFixed(2)}..${a.max.x.toFixed(2)}, roll ${lo.toFixed(2)}..${hi.toFixed(2)})`,
    );
  }

  near(box.max.z, H + t, 1.5, `${tag}: rim height`);
  console.log(`  ok  ${tag}  rim at ${box.max.z.toFixed(0)} mm, four webs closed`);
}

// ────────────────── hinged lid: does the cover close with shut corners? ──────────────────

console.log('\nflap-cover — does the lid come over the tray and close its corners?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = {
    ...DEFAULT_PARAMS,
    style: 'flap-cover',
    lengthMm: L,
    widthMm: W,
    heightMm: H,
  };
  const { placed } = fold(p);
  const tag = `${L}x${W}x${H}`;

  const base = placed.get('fc-base')!;
  const deck = placed.get('fc-lid-deck')!;
  const front = placed.get('fc-lid-front')!;
  ok(!!(base && deck && front), `${tag}: tray and lid both built`);

  // The lid lands horizontally above the tray and covers it end to end.
  near(thickness(deck, 'z'), 0, 0.06, `${tag}: the lid closes flat`);
  ok(deck.min.z > base.max.z + H * 0.4, `${tag}: the lid sits above the tray, not in it`);
  ok(
    deck.min.x <= base.min.x + 0.01 && deck.max.x >= base.max.x - 0.01,
    `${tag}: the lid covers the tray's full length` +
      ` (lid ${deck.min.x.toFixed(1)}..${deck.max.x.toFixed(1)}, tray ${base.min.x.toFixed(1)}..${base.max.x.toFixed(1)})`,
  );
  // The front skirt hangs DOWN off the lid, which is what makes it a cover rather
  // than a flat card lying on top.
  ok(front.min.z < deck.min.z - 1, `${tag}: the front skirt hangs down the front`);

  // Cover system 60 is "complete flap cover with CLOSED corners", and the closed
  // corner is the only thing separating it from 53. Same face-to-face test as the
  // tray's webs.
  for (const corner of ['cl', 'cr']) {
    const a = placed.get(`fc-lid-${corner}a`)!;
    const b = placed.get(`fc-lid-${corner}b`)!;
    ok(!!(a && b), `${tag} [${corner}]: both halves of the lid corner exist`);
    if (!a || !b) continue;
    const ca = a.pts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(a.pts.length);
    const cb = b.pts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(b.pts.length);
    const limit = Math.max(2.5, H * 0.25);
    ok(
      ca.distanceTo(cb) <= limit,
      `${tag} [${corner}]: the lid corner folded shut` +
        ` (halves ${ca.distanceTo(cb).toFixed(2)} mm apart, limit ${limit.toFixed(1)})`,
    );
  }
  console.log(`  ok  ${tag}  lid closed at z=${deck.min.z.toFixed(0)} mm, both corners shut`);
}

// ──────────────── cake box: does each claw hook through its slit? ────────────────

// ECMA B15.06.00.53, and the claim under test is the one the `06` makes: the corner is
// held by a CLAW. A tab folded in flat against the end wall with nothing through the
// slit is not a claw lock — it is an ear that springs straight back out, and the two
// are indistinguishable in the dieline, in the animation, and in any test that asks
// whether two bounding boxes overlap. So the crossing itself is measured, in the END
// WALL's own frame, for the reason given at `crossings` above.
//
// The claw is PARALLEL to the wall it locks, not through it, so the line to measure
// against is the slit rather than the wall's plane — see `crossingsAtY`.
console.log('\ncake-box — does each claw hook through its slit, and does the cover close?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'cake-box', lengthMm: L, widthMm: W, heightMm: H };
  const t = p.caliperMm;
  /** One relief: how far inside the end wall the claw's own ply stands. */
  const g = Math.max(0.4, t);
  const { placed, box, rig, net } = fold(p);
  const tag = `cake ${L}x${W}x${H}`;

  const base = placed.get('cb-base')!;
  const front = placed.get('cb-front')!;
  const deck = placed.get('cb-lid-lid')!;
  const tuck = placed.get('cb-lid-tuck')!;
  ok(!!(base && front && deck && tuck), `${tag}: base, walls and cover all built`);
  near(thickness(base, 'z'), 0, 0.01, `${tag}: base stays flat`);

  const meshOf = (id: string): THREE.Mesh | null => {
    const node = rig.nodes.find((q) => q.panel.id === id);
    return node ? ((node.pivot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh) ?? null) : null;
  };

  let hooked = 0;
  for (const [clawId, wallId] of [
    ['cb-claw-fl', 'cb-left'],
    ['cb-claw-bl', 'cb-left'],
    ['cb-claw-fr', 'cb-right'],
    ['cb-claw-br', 'cb-right'],
  ] as const) {
    const cl = placed.get(clawId)!;
    const wall = placed.get(wallId)!;
    if (!cl || !wall) {
      ok(false, `${tag}: ${clawId} and ${wallId} are both in the rig`);
      continue;
    }

    // (a) THE CLAW LANDS ON THE WALL. Flat, one relief inside it, and nowhere past its
    //     edges: a claw that finishes outside the end wall's own rectangle is a flap
    //     hanging off the end of the box rather than a corner lock.
    near(thickness(cl, 'x'), 0, 0.02, `${tag}: ${clawId} folded flat into the end wall's plane`);
    const off = Math.abs(cl.min.x - wall.min.x);
    ok(
      off <= g + 0.05,
      `${tag}: ${clawId} lies on the inside face of ${wallId} — ${off.toFixed(2)} mm off, one relief is ${g.toFixed(2)}`,
    );
    ok(
      cl.min.y >= wall.min.y - 0.01 &&
        cl.max.y <= wall.max.y + 0.01 &&
        cl.min.z >= wall.min.z - 0.01 &&
        cl.max.z <= wall.max.z + 0.01,
      `${tag}: ${clawId} sits inside ${wallId}'s rectangle` +
        ` (claw y ${cl.min.y.toFixed(1)}..${cl.max.y.toFixed(1)} z ${cl.min.z.toFixed(1)}..${cl.max.z.toFixed(1)},` +
        ` wall y ${wall.min.y.toFixed(1)}..${wall.max.y.toFixed(1)} z ${wall.min.z.toFixed(1)}..${wall.max.z.toFixed(1)})`,
    );

    // (b) THE LOCK. Every crossing of the claw with the slit's line has to be INSIDE
    //     the slit. Not "the prong and the slit overlap" — every crossing, contained,
    //     which is the assertion that catches a prong half on the board.
    const wallNode = rig.nodes.find((q) => q.panel.id === wallId)!;
    const toLocal = panelLocal(net, wallId);
    const slits = net.slits
      .filter((s) => s.panelId === wallId)
      .map((s) => {
        const a = toLocal(s.points[0] as [number, number]);
        const b = toLocal(s.points[s.points.length - 1] as [number, number]);
        return { y: (a[1] + b[1]) / 2, lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) };
      });
    if (!slits.length) {
      // No slit at this size is a legitimate outcome — see MIN_HOOK_MM — but then the
      // claw must be a plain tab, and (a) above has already said it lands flat.
      ok(true, `${tag}: ${wallId} has no slit at this size (the corner closes, it does not catch)`);
      continue;
    }
    ok(slits.length === 2, `${tag}: ${wallId} carries one slit per claw (got ${slits.length})`);

    const mesh = meshOf(clawId);
    if (!mesh) {
      ok(false, `${tag}: ${clawId} has a mesh`);
      continue;
    }
    const xs = crossingsAtY(mesh, wallNode.pivot, slits[0]!.y);
    ok(xs.length >= 2, `${tag}: ${clawId}'s prong reaches the slit's height (${xs.length} crossings)`);
    if (xs.length < 2) continue;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const home = slits.find((s) => lo >= s.lo - 0.05 && hi <= s.hi + 0.05);
    ok(
      !!home,
      `${tag}: ${clawId}'s prong crosses inside a slit — prong ${lo.toFixed(2)}..${hi.toFixed(2)},` +
        ` slits ${slits.map((s) => `${s.lo.toFixed(2)}..${s.hi.toFixed(2)}`).join(' / ')}`,
    );
    // …and no two claws may claim the same slit, which is what a prong that has drifted
    // to the middle of the wall would do.
    if (home) hooked++;
  }
  ok(hooked === 0 || hooked === 4, `${tag}: all four corners lock, or none does (got ${hooked})`);

  // Every closing flap here rests a hair short of square on purpose, so two plies that
  // land on each other do not z-fight — `undershoot`, 0.03 rad on a tuck and 0.04 on a
  // wing. That is an ANGLE, so it shows up as a lean proportional to how far the flap
  // reaches, and "vertical" has to be measured against the flap's own drop rather than
  // against a millimetre. Anything past this is a flap that did not fold.
  const LEAN = 0.06;

  // (c) The front tuck runs down INSIDE the front wall, one `closure` caliper term in
  //     from its plane — over its edge instead and the lid has nothing holding it shut.
  const tuckDrop = deck.min.z - tuck.min.z;
  ok(
    thickness(tuck, 'y') <= LEAN * tuckDrop + 0.05,
    `${tag}: the front tuck hangs vertically (${thickness(tuck, 'y').toFixed(2)} mm of lean over a ${tuckDrop.toFixed(1)} mm drop)`,
  );
  // Measured at the deck's own far crease, which is where `closure` puts it; the tuck
  // below it is allowed its lean toward the wall it presses against.
  const tuckIn = deck.min.y - front.min.y;
  near(tuckIn, Math.max(1.5, 2 * t), 0.1, `${tag}: the lid's far crease lands on the front wall's inner face`);
  ok(tuck.min.y >= front.min.y - 0.01, `${tag}: the tuck stays inside the front wall, not over its edge`);
  ok(tuck.min.z < deck.min.z - 1, `${tag}: the tuck runs down behind the front wall`);

  // (d) The side wings come down INSIDE the end walls. Outside them and they clamp the
  //     box instead of bracing it, which is the one thing a cover 53 wing is for — the
  //     mailer's lid learned this first.
  for (const [wingId, wallId, dir] of [
    ['cb-wing-l', 'cb-left', -1],
    ['cb-wing-r', 'cb-right', 1],
  ] as const) {
    const wg = placed.get(wingId);
    const wall = placed.get(wallId)!;
    if (!wg) {
      ok(false, `${tag}: ${wingId} exists at this size`);
      continue;
    }
    const drop = deck.min.z - wg.min.z;
    ok(
      thickness(wg, 'x') <= LEAN * drop + 0.05,
      `${tag}: ${wingId} hangs vertically (${thickness(wg, 'x').toFixed(2)} mm of lean over a ${drop.toFixed(1)} mm drop)`,
    );
    // At the hinge, which is the deck's own short edge: that is the edge that has to
    // clear the wall AND the claw lying against it, and `layerStep(t)` is both of them.
    // The end wall is a PLANE of constant x once it is up, so `dir` is which side of
    // the box it is and inboard is the other way.
    const wallX = wall.min.x;
    const hinge = dir < 0 ? deck.min.x : deck.max.x;
    const inset = dir * (wallX - hinge);
    ok(
      inset >= 2 * t - 0.05 && inset <= 3,
      `${tag}: ${wingId} hinges ${inset.toFixed(2)} mm inside ${wallId}` +
        ` (it has to clear the wall and the claw, which is ${(2 * t).toFixed(2)})`,
    );
    // Never past the wall: a wing that ends up on the far side of it is clamping the
    // box rather than bracing it.
    const far = dir < 0 ? wg.min.x : wg.max.x;
    ok(
      dir * (wallX - far) >= -0.01,
      `${tag}: ${wingId} stays on the INSIDE of ${wallId} (wing edge ${far.toFixed(2)}, wall ${wallX.toFixed(2)})`,
    );
    ok(
      wg.min.y >= wall.min.y - 0.01 &&
        wg.max.y <= wall.max.y + 0.01 &&
        wg.min.z >= wall.min.z - 0.01 &&
        wg.max.z <= wall.max.z + 0.01,
      `${tag}: ${wingId} stays within ${wallId}'s own rectangle`,
    );
  }

  // (e) And the lid closes flat, on the rim.
  near(thickness(deck, 'z'), 0, 0.05, `${tag}: the lid closes flat`);
  near(deck.min.z, H + t, Math.max(0.5, t), `${tag}: the lid sits on the rim`);
  near(box.max.z, H + t, 0.6, `${tag}: nothing stands above the closed lid`);

  console.log(
    `  ok  ${tag.padEnd(20)} lid at ${deck.min.z.toFixed(0)} mm · ${hooked}/4 corners locked · ` +
      `closed box ${(box.max.x - box.min.x).toFixed(0)} × ${(box.max.y - box.min.y).toFixed(0)} × ${(box.max.z - box.min.z).toFixed(0)} mm`,
  );
}

// ─────────────────────────────── the styles that were already here ───────────────────────────────

// ───────────────────────────────────── gable ─────────────────────────────────────

// The claim under test is the one the ECMA code makes: "gable top closure WITH LOCKING
// FLAP". So it is not enough that the roof closes — the ear has to actually catch, and
// catching means both blades pass through its slot and neither one misses it.
console.log('\ngable — do the blades meet, and does each ear swallow both of them?');
for (const [L, W, H] of SIZES) {
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'gable', lengthMm: L, widthMm: W, heightMm: H };
  const { placed, box, rig, net } = fold(p);
  const tag = `gable ${L}x${W}x${H}`;
  const t = p.caliperMm;

  const roof0 = placed.get('gb-roof0')!;
  const roof2 = placed.get('gb-roof2')!;
  ok(!!(roof0 && roof2), `${tag}: both roof panels exist`);
  const b0 = placed.get('gb-blade0');
  const b2 = placed.get('gb-blade2');
  if (!b0 || !b2) {
    // A box too short for a 20 mm strip gets no handle at all rather than a crossed
    // one: the roof still closes and the ears cover the ends, so that is what to check.
    ok(!b0 && !b2, `${tag}: no handle at this size means no strip on either roof`);
    near(roof0.max.z, roof2.max.z, 0.05, `${tag}: both roof panels reach one ridge`);
    for (const ear of ['gb-ear1', 'gb-ear3']) {
      const node = rig.nodes.find((n) => n.panel.id === ear);
      ok(!!node && node.panel.holes.length === 0, `${tag}: ${ear} is a plain cover, no slot to nothing`);
    }
    console.log(`  ok  ${tag.padEnd(20)} ridge at ${roof0.max.z.toFixed(0)} mm · too short for a handle, ears cover the ends`);
    continue;
  }

  // Both roofs rise to the SAME ridge height, or the two halves never meet.
  near(roof0.max.z, roof2.max.z, 0.05, `${tag}: both roof panels reach one ridge`);
  // …and the blades stand vertically above it, face to face. A blade is a plane of
  // constant y once the box is shut; the pair is at most two plies thick.
  const pair = Math.max(b0.max.y, b2.max.y) - Math.min(b0.min.y, b2.min.y);
  ok(pair <= 2 * t + 0.35, `${tag}: the two blades meet face to face (${pair.toFixed(2)} mm across)`);
  near(b0.min.z, roof0.max.z, 0.6, `${tag}: the blades stand on the ridge`);

  // The lock. In each ear's own pivot frame the ear IS the plane z = 0, its hinge is
  // the line y = 0, and its slot is the hole this asserts against — so a blade the ear
  // cannot swallow shows up as a crossing outside the slot, which is exactly the
  // failure mode that a bounding-box overlap test cannot see.
  for (const ear of ['gb-ear1', 'gb-ear3']) {
    const node = rig.nodes.find((n) => n.panel.id === ear);
    if (!node) {
      ok(false, `${tag}: ${ear} is in the rig`);
      continue;
    }
    const hole = node.panel.holes[0];
    if (!hole) {
      // No slot at this size is a legitimate outcome — see MIN_SEAT_MM — but then the
      // blades must not foul the ear either, or it cannot swing home at all.
      ok(true, `${tag}: ${ear} has no slot at this size (cover, not catch)`);
      continue;
    }
    // The pivot's frame is the NET rotated onto its own hinge: origin at the hinge's
    // start point, +x along the hinge, +y into the panel. Taking net coordinates as
    // local ones instead is off by the panel's position in the blank, which is tens of
    // millimetres and looks exactly like a lock that misses.
    const crease = net.creases.find((c) => c.panelId === ear)!;
    const th = Math.atan2(crease.b[1] - crease.a[1], crease.b[0] - crease.a[0]);
    const toLocal2 = (q: readonly [number, number]): [number, number] => {
      const vx = q[0] - crease.a[0];
      const vy = q[1] - crease.a[1];
      return [vx * Math.cos(th) + vy * Math.sin(th), -vx * Math.sin(th) + vy * Math.cos(th)];
    };
    const local = hole.map((q) => toLocal2(q as readonly [number, number]));
    const hx = local.map((q) => q[0]);
    const hy = local.map((q) => q[1]);
    const xa = Math.min(...hx);
    const xb = Math.max(...hx);
    const lo = Math.min(...hy);
    const hi = Math.max(...hy);

    let worst = 0;
    let worstDx = 0;
    let worstDy = 0;
    let hits = 0;
    for (const blade of ['gb-blade0', 'gb-blade2']) {
      const bnode = rig.nodes.find((n) => n.panel.id === blade)!;
      const mesh = bnode.pivot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
      const pts = crossings(mesh, node.pivot);
      ok(pts.length > 0, `${tag}: ${blade} actually reaches ${ear}'s plane`);
      for (const q of pts) {
        hits++;
        // How far outside the slot this crossing lands, in mm. Zero is contained.
        const dx = Math.max(0, xa - q.x, q.x - xb);
        const dy = Math.max(0, lo - q.y, q.y - hi);
        if (Math.hypot(dx, dy) > worst) {
          worst = Math.hypot(dx, dy);
          worstDx = dx;
          worstDy = dy;
        }
      }
    }
    // One kerf of slack: the slot is cut 2t + clearance wide and the crossing is
    // measured on the blade's mid-surface, so a few tenths is the mesh, not a miss.
    ok(
      worst <= 0.6,
      `${tag}: ${ear} swallows both blades — worst crossing ${worst.toFixed(2)} mm outside its slot (across ${worstDx.toFixed(2)}, along ${worstDy.toFixed(2)}; ${hits} crossings)`,
    );
  }

  console.log(
    `  ok  ${tag.padEnd(20)} ridge at ${roof0.max.z.toFixed(0)} mm · blades ${pair.toFixed(2)} mm thick · box ${box.max.z.toFixed(0)} mm tall`,
  );
}

// ──────────────────────────────── hang header ────────────────────────────────

// X62's whole claim is that the slot goes through TWO plies. That is only true if the
// inner ply lands back ON the header instead of somewhere else, so this measures where
// it ended up rather than trusting the two 90° folds to add up.
console.log('\nhang header — does the second ply fold back onto the first?');
for (const style of ['snap-lock', 'tuck-top'] as StyleId[]) {
  for (const [L, W, H] of [
    [90, 60, 25],
    [60, 40, 120],
  ] as [number, number, number][]) {
    const p: BoxParams = {
      ...DEFAULT_PARAMS,
      style,
      lengthMm: L,
      widthMm: W,
      heightMm: H,
      hangTab: 'double',
      window: false,
    };
    const { placed } = fold(p);
    const tag = `${style} ${L}x${W}x${H} + X62`;
    const wall = placed.get(`${style === 'snap-lock' ? 'sl' : 'tt'}-w2`)!;
    const inner = placed.get('hang-inner')!;
    const tab = placed.get('hang-tab')!;
    if (!wall || !inner || !tab) {
      ok(false, `${tag}: header panels exist`);
      continue;
    }
    const t = p.caliperMm;
    // The back wall is a plane of constant y; the inner ply has to come back to it.
    near(thickness(inner, 'y'), 0, 0.05, `${tag}: inner ply is parallel to the back wall`);
    ok(
      Math.abs(inner.min.y - wall.min.y) <= 3 * t + 0.4,
      `${tag}: inner ply lands back on the header (${Math.abs(inner.min.y - wall.min.y).toFixed(2)} mm off, one roll is ${(2 * t).toFixed(2)})`,
    );
    // Registration: the header stands above the box, and both plies have to occupy the
    // same band of it or the two slots cannot line up on a peg.
    ok(inner.min.z > H - 1, `${tag}: inner ply sits above the box, not down its back`);
    near(inner.max.z, wall.max.z, 2 * t + 0.5, `${tag}: both plies reach the same top edge`);
    // And the lip has to end up INSIDE, or there is nothing holding the fold shut.
    ok(
      tab.max.z < inner.max.z,
      `${tag}: the header's lip tucks back down rather than standing proud`,
    );
    console.log(
      `  ok  ${tag.padEnd(28)} header ${(wall.max.z - H).toFixed(0)} mm tall · plies ${Math.abs(inner.min.y - wall.min.y).toFixed(2)} mm apart`,
    );
  }
}

console.log('\nevery style still folds to something with volume');
const ALL: StyleId[] = [
  'mailer',
  'mailer-flaps',
  'tray',
  'tray-webbed',
  'tray-lid',
  'flap-cover',
  'cake-box',
  'tuck-top',
  'snap-lock',
  'gable',
  'sleeve',
];
for (const style of ALL) {
  const { box } = fold({ ...DEFAULT_PARAMS, style });
  const d = box.getSize(new THREE.Vector3());
  ok(d.x > 5 && d.y > 5 && d.z > 3, `${style}: folds to a solid (${d.x.toFixed(0)}×${d.y.toFixed(0)}×${d.z.toFixed(0)})`);
}

// The plate is a floor, not a suggestion. Every check above measures t = 1; this one
// walks the scrub, because that is where the tube family was wrong: a glue lap and a
// tuck that folded a stage after the panel they hang off pointed straight through the
// table for the length of that stage, and the telescoping lid turned over about its own
// middle and put half of itself under the tray. Nothing in the finished box showed it.
// The allowance is the roll-end's nib tabs, which really do sit 1.6 mm through the floor.
console.log('\nnothing goes through the plate at any point of the scrub');
const PLATE_TOLERANCE_MM = 2;
for (const style of ALL) {
  const r = solve({ ...DEFAULT_PARAMS, style });
  const rig = buildRig(r.net, { color: '#eee', edge: '#333' });
  let worst = 0;
  let worstT = 0;
  let worstPanel = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    rig.setProgress(t);
    rig.object.updateMatrixWorld(true);
    for (const node of rig.nodes) {
      const mesh = node.pivot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        const z = new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld).z;
        if (z < worst) {
          worst = z;
          worstT = t;
          worstPanel = node.panel.id;
        }
      }
    }
  }
  ok(
    worst >= -PLATE_TOLERANCE_MM,
    `${style}: ${worstPanel} goes ${(-worst).toFixed(1)} mm through the plate at t=${worstT.toFixed(2)}`,
  );
  rig.dispose();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
