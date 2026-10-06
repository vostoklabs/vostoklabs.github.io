// Does the box stay in one piece WHILE it folds?
//
// tests/fold.mts drives every style to t = 1 and measures the finished box, which is
// necessary and not sufficient: a corner can arrive in exactly the right place having
// taken an absurd route to get there. That is what a webbed corner did — the web left
// the tray, swung 46 mm out through the middle of it, and came back in time to pass
// every closing check we had.
//
// The fold graph is a tree, so a parent/child hinge is exact by construction and can
// never come apart. What CAN come apart is a join the tree had to drop: two panels
// that are one piece of card in the blank — they share an edge — but are not parent
// and child, because the corner they form is a closed kinematic loop. This walks the
// whole scrub and asserts every one of those joins stays shut.
//
// Run: pnpm --filter foldbox test:corners

import * as THREE from 'three';
import { solve } from '../src/geometry/solve';
import { buildRig } from '../src/fold/rig';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${msg}`);
}

const STYLES: StyleId[] = [
  'mailer', 'mailer-flaps', 'tray', 'tray-webbed', 'tray-lid',
  'flap-cover', 'cake-box', 'tuck-top', 'snap-lock', 'gable', 'sleeve', 'divider',
];
const SIZES: [number, number, number][] = [[90, 60, 25], [120, 80, 50], [60, 60, 60], [150, 40, 30]];

// The two plies of a doubled web are deliberately held a hair apart so they do not
// z-fight (`undershoot`, 0.06 rad), and that shows up here as a small standing gap.
// It is an ANGLE held over the web's reach, which is about the box height, so the
// tolerance has to scale with the box or it only fits the size it was written at.
// The bug this test exists for measured 1.8x the box height, so this stays far below
// anything that would let it back in.
const toleranceFor = (H: number) => Math.max(1, 0.12 * H);

console.log('\ndoes every style hold together through the whole fold?');

for (const style of STYLES) {
  for (const [L, W, H] of SIZES) {
    const p: BoxParams = { ...DEFAULT_PARAMS, style, lengthMm: L, widthMm: W, heightMm: H };
    const r = solve(p);
    const tag = `${style} ${L}x${W}x${H}`;
    if (!r.net.panels.length) continue; // divider: nothing folds
    const rig = buildRig(r.net, { color: '#eee', edge: '#333' });
    const parentOf = new Map(r.net.panels.map((q) => [q.id, q.parent]));

    const key = (v: readonly [number, number]) => `${v[0].toFixed(2)},${v[1].toFixed(2)}`;
    const owners = new Map<string, string[]>();
    for (const pan of r.net.panels)
      for (const v of pan.outline) {
        const k = key(v);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k)!.push(pan.id);
      }

    rig.setProgress(0);
    rig.object.updateMatrixWorld(true);
    const meshOf = (id: string) => {
      const n = rig.nodes.find((q) => q.panel.id === id);
      return n ? (n.pivot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh) : null;
    };
    // At t = 0 the rig IS the flat blank, so world space is net space and a shared
    // blank vertex can be matched to a vertex index on each panel's mesh.
    const indexAt = (m: THREE.Mesh, target: THREE.Vector3) => {
      const pos = m.geometry.getAttribute('position');
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).distanceTo(target);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD < 0.01 ? best : -1;
    };

    const joins: { a: string; b: string; ma: THREE.Mesh; mb: THREE.Mesh; ia: number; ib: number }[] = [];
    for (const [k, ids] of owners) {
      const list = [...new Set(ids)];
      if (list.length < 2) continue;
      const [vx, vy] = k.split(',').map(Number);
      const target = new THREE.Vector3(vx, vy, 0);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!, b = list[j]!;
          if (parentOf.get(a) === b || parentOf.get(b) === a) continue; // tree hinge: exact
          const ma = meshOf(a), mb = meshOf(b);
          if (!ma || !mb) continue;
          const ia = indexAt(ma, target), ib = indexAt(mb, target);
          if (ia < 0 || ib < 0) continue;
          joins.push({ a, b, ma, mb, ia, ib });
        }
    }

    let worst = 0;
    let worstAt = 0;
    let worstId = '';
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      rig.setProgress(t);
      rig.object.updateMatrixWorld(true);
      for (const j of joins) {
        const va = new THREE.Vector3().fromBufferAttribute(j.ma.geometry.getAttribute('position'), j.ia).applyMatrix4(j.ma.matrixWorld);
        const vb = new THREE.Vector3().fromBufferAttribute(j.mb.geometry.getAttribute('position'), j.ib).applyMatrix4(j.mb.matrixWorld);
        const gap = va.distanceTo(vb);
        if (gap > worst) { worst = gap; worstAt = t; worstId = `${j.a} | ${j.b}`; }
      }
    }
    const tol = toleranceFor(H);
    ok(
      worst <= tol,
      `${tag}: a join the fold tree cannot hold came open — ${worst.toFixed(1)} mm at t=${worstAt.toFixed(2)} (${worstId}), tolerance ${tol.toFixed(1)} mm`,
    );
    if (worst <= tol)
      console.log(`  ok  ${tag.padEnd(26)} ${joins.length} loose joins, worst ${worst.toFixed(2)} mm`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
