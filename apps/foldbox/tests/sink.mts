// Does the box ever fall through the build plate?
//
// The viewer seats a fold rig by measuring its bounding box ONCE, when the rig is
// handed over, and dropping the group so that measurement rests on z = 0. The fold
// then moves every panel, and the measurement stops being true: six of the nine
// styles swing a panel below that floor as they assemble — 16 mm on the hinged lid —
// which over a build plate reads as the box sinking into the bed.
//
// `viewer.settleFoldRig()` re-seats it after every progress change. This asserts the
// rule that call implements: whatever is currently lowest rests ON the floor, never
// under it. A box folding on a table does not pass through the table.
//
// Run: pnpm --filter foldbox test:sink

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
  'flap-cover', 'cake-box', 'tuck-top', 'snap-lock', 'gable', 'sleeve',
];
const SIZES: [number, number, number][] = [[90, 60, 25], [120, 80, 50], [150, 40, 30]];

console.log('\ndoes anything dip below the build plate while it folds?');

for (const style of STYLES) {
  for (const [L, W, H] of SIZES) {
    const p: BoxParams = { ...DEFAULT_PARAMS, style, lengthMm: L, widthMm: W, heightMm: H };
    const r = solve(p);
    if (!r.net.panels.length) continue;
    const rig = buildRig(r.net, { color: '#eee', edge: '#333' });
    const group = new THREE.Group();
    group.add(rig.object);
    const tag = `${style} ${L}x${W}x${H}`;

    // What settleFoldRig does: measure from a zeroed offset so the last frame's lift
    // cannot compound, then rest the current lowest point on the floor.
    const settle = () => {
      group.position.z = 0;
      group.updateMatrixWorld(true);
      const min = new THREE.Box3().setFromObject(group).min.z;
      if (Number.isFinite(min)) group.position.z = -min;
      group.updateMatrixWorld(true);
    };

    let worst = Infinity;
    let worstAt = 0;
    let drift = 0;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      rig.setProgress(t);
      settle();
      const min = new THREE.Box3().setFromObject(group).min.z;
      if (min < worst) { worst = min; worstAt = t; }
      drift = Math.max(drift, Math.abs(min));
    }
    ok(
      worst >= -0.01,
      `${tag}: fell ${(-worst).toFixed(2)} mm through the plate at t=${worstAt.toFixed(2)}`,
    );
    // And it must genuinely REST on the floor, not hover above it.
    ok(drift <= 0.01, `${tag}: floated ${drift.toFixed(2)} mm above the plate`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
