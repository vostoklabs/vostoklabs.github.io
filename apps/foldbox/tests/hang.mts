// Does the hang tab hang the box the RIGHT WAY ROUND?
//
// Everything else about a hang tab is easy to check and none of it is the bug worth
// catching. A slot in the wrong plane derives perfectly, folds perfectly, exports
// perfectly and cuts perfectly — and then hangs the box pointing at the customer,
// showing a W×H end instead of the printed lid. Nothing in net.mts or fold.mts can
// see that, because nothing there knows what a peg is.
//
// A peg is horizontal. So the plane the slot is cut in is the plane that ends up
// against the shop's board — the box has to project FORWARD out of it, it cannot
// project backward into the board — and the box's long axis is whatever direction the
// tab sticks out in. Those two facts are the whole test:
//
//     the slot's plane must be a KNOWN one of the two big faces → which face shows
//     the tab must reach past a SHORT end (the long axis)       → hangs long-side-down
//
// "Parallel to the lid" is not enough for the first of those and that is exactly how
// this went wrong once: the lid and the base are parallel to EACH OTHER, so a tab on
// the wrong one of them passes a parallelism check and hangs the box back to front.
// `FACES` pins which face each kind uses, and the window control follows from it.
//
// Plus the three things a tab must not cost: the box's own dimensions, the lid sitting
// flat on both rims, and the window staying centred on the face it is cut in.
//
// Run: pnpm --filter foldbox test:hang

import * as THREE from 'three';
import { solve } from '../src/geometry/solve';
import { buildRig } from '../src/fold/rig';
import { DEFAULT_PARAMS, type BoxParams, type HangEnd, type HangHole, type HangTab } from '../src/types';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${msg}`);
}

type Ring = THREE.Vector3[];

interface Placed {
  id: string;
  /** [outline, ...holes], in the builder's own order, in world space. */
  rings: Ring[];
  box: THREE.Box3;
  normal: THREE.Vector3;
}

function centre(ring: Ring): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const v of ring) c.add(v);
  return c.divideScalar(ring.length);
}

/** Fold to completion and hand back every panel's rings in world space.
 *
 *  The rig already draws each panel's outline and each of its holes as a LineLoop, in
 *  source order — so the slot's own vertices are available exactly as the builder
 *  wrote them, rather than having to be dug back out of a triangulated mesh. */
function fold(p: BoxParams): { placed: Map<string, Placed>; box: THREE.Box3 } {
  const r = solve(p);
  const rig = buildRig(r.net, { color: '#eee', edge: '#333' });
  rig.setProgress(1);
  rig.object.updateMatrixWorld(true);

  const placed = new Map<string, Placed>();
  const box = new THREE.Box3();
  for (const node of rig.nodes) {
    const loops = node.pivot.children.filter(
      (c) => (c as THREE.LineLoop).isLineLoop,
    ) as THREE.LineLoop[];
    if (!loops.length) continue;
    const rings: Ring[] = loops.map((l) => {
      const pos = l.geometry.getAttribute('position');
      const out: Ring = [];
      for (let i = 0; i < pos.count; i++) {
        out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(l.matrixWorld));
      }
      return out;
    });
    const b = new THREE.Box3();
    for (const v of rings[0]!) b.expandByPoint(v);
    const normal = new THREE.Vector3(0, 0, 1)
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(loops[0]!.matrixWorld))
      .normalize();
    placed.set(node.panel.id, { id: node.panel.id, rings, box: b, normal });
    box.union(b);
  }
  return { placed, box };
}

/** The box itself: everything except the parts that only exist to hang it.
 *
 *  The lid is excluded as well as the tab panels, and it has to be: a single-ply tab
 *  IS the lid carrying on past the end, so there is no panel to leave out. What the
 *  assertion is really about is the SHELL — base, walls, ears, rolled ends — which no
 *  kind of tab is allowed to move. */
function shellBox(placed: Map<string, Placed>): THREE.Box3 {
  const b = new THREE.Box3();
  for (const [id, pl] of placed) {
    if (id.includes('hang') || id === 'ml-lid') continue;
    b.union(pl.box);
  }
  return b;
}

/** Where the box actually is, tab and all excluded. Used to say which end is which. */
function bodyBox(placed: Map<string, Placed>): THREE.Box3 {
  return shellBox(placed);
}

const STYLES: BoxParams['style'][] = ['mailer', 'mailer-flaps'];
/** Which face each kind's tab is coplanar with — and therefore which face ends up
 *  against the board, and which one the customer is left looking at.
 *
 *  This is the assertion the first cut of this feature did not have, and the whole
 *  reason the first cut of it was wrong. "Is the slot parallel to the lid?" passes for
 *  BOTH faces: the lid and the base are parallel to each other. The question that
 *  separates them is which face's PLANE the slot sits in, and it decides which face the
 *  customer is left looking at.
 *
 *  The mailer's one tab is the lid carrying on past a short end, so it is coplanar with
 *  the LID — which means the lid goes to the board and the base faces out. That is why
 *  the window can be moved to the base. Pinning it here stops the tab quietly migrating
 *  to the other face and the window advice going stale with it. */
const FACES: Partial<Record<HangTab, 'ml-base' | 'ml-lid'>> = {
  single: 'ml-lid',
};
const KINDS: HangTab[] = ['single'];
/** Both hole shapes go through every check. They differ only in the ring that gets
 *  cut, but that ring is the part a peg has to pass through and the part the 4 mm
 *  keep-out is measured from, so neither is covered by testing the other. */
const HOLES: HangHole[] = ['euro', 'round'];
const ENDS: HangEnd[] = ['left', 'right', 'both'];
const SIZES: [number, number, number][] = [
  [90, 60, 25],
  [120, 45, 18],
  [60, 60, 60],
  [200, 30, 40],
];

for (const style of STYLES) {
  console.log(`\n${style}`);
  for (const kind of KINDS) {
    for (const end of ENDS) {
      for (const [lengthMm, widthMm, heightMm] of SIZES) {
       for (const hangHole of HOLES) {
        const p: BoxParams = {
          ...DEFAULT_PARAMS,
          style,
          lengthMm,
          widthMm,
          heightMm,
          window: true,
          hangTab: kind,
          hangEnd: end,
          hangHole,
        };
        const tag = `${kind}/${end}/${hangHole} ${lengthMm}×${widthMm}×${heightMm}`;
        const { placed } = fold(p);
        const lid = placed.get('ml-lid');
        const base = placed.get('ml-base');
        if (!lid || !base) {
          ok(false, `${tag}: no lid or base`);
          continue;
        }

        // The lid must stay FLAT. A tab spliced into a roll rides over that end's rim,
        // and if it rides 2t proud of the other end the lid rocks on it — which is a
        // tilt of well under a millimetre and invisible in every other test here.
        ok(
          Math.abs(lid.normal.dot(base.normal)) > 0.999,
          `${tag}: the lid is not parallel to the base — it is rocking on the tab`,
        );

        // Where the slots ended up. `double` puts them on their own panels, one per
        // ply; the other two cut them in the lid, where the builder pushes them BEFORE
        // the window — so they are identified by construction rather than by guessing
        // from position, which on a short box cannot tell a window from a slot.
        const body = bodyBox(placed);
        const nEnds = end === 'both' ? 2 : 1;
        const nLidSlots = kind === 'double' ? 0 : nEnds;
        const slots: { ring: Ring; host: Placed }[] = [];
        for (const [id, pl] of placed) {
          if (!id.includes('hang')) continue;
          for (const ring of pl.rings.slice(1)) slots.push({ ring, host: pl });
        }
        for (const ring of lid.rings.slice(1, 1 + nLidSlots)) slots.push({ ring, host: lid });
        ok(
          slots.length === nEnds * (kind === 'double' ? 2 : 1),
          `${tag}: found ${slots.length} hang slot ring(s)`,
        );

        for (const { ring, host } of slots) {
          const c = centre(ring);

          // ── the whole point, part one ──
          // The slot's plane is the plane that ends up against the board. If it is at
          // an angle to the lid at all, the box hangs edge-on and shows a W×H end.
          ok(
            Math.abs(host.normal.dot(lid.normal)) > 0.999,
            `${tag}: the slot is cut in a plane at ${((Math.acos(Math.min(1, Math.abs(host.normal.dot(lid.normal)))) * 180) / Math.PI).toFixed(0)}° to the lid — the box would hang edge-on`,
          );

          // ── the whole point, part two ──
          // Parallel is not enough: the lid and the base are parallel to EACH OTHER,
          // and the tab has to be in the plane of the face that goes to the board.
          // Whichever face that is, the customer sees the other one.
          const wantFace = FACES[kind];
          const face = placed.get(wantFace!);
          if (face) {
            const n = lid.normal;
            const depthOf = (v: THREE.Vector3) => v.dot(n);
            const near = Math.abs(depthOf(c) - depthOf(centre(face.rings[0]!)));
            const far = Math.abs(
              depthOf(c) - depthOf(centre(placed.get(wantFace === 'ml-base' ? 'ml-lid' : 'ml-base')!.rings[0]!)),
            );
            ok(
              near < far && near < 6 * p.caliperMm + 0.1,
              `${tag}: the slot sits ${near.toFixed(1)} mm off the ${wantFace === 'ml-base' ? 'base' : 'lid'} and ${far.toFixed(1)} mm off the other face — it would hang the wrong face out`,
            );
          }

          // ── the other half of the point ──
          // Past a SHORT end, so the box hangs long-axis-down. x is the box's length,
          // y its width: the base panel is the root and keeps its net frame.
          const off = c.clone().sub(body.getCenter(new THREE.Vector3()));
          ok(
            Math.abs(off.x) > Math.abs(off.y),
            `${tag}: the slot is off the long side (Δx ${off.x.toFixed(1)} vs Δy ${off.y.toFixed(1)}) — the box would hang the wrong way up`,
          );
          const wantSide = end === 'left' ? -1 : end === 'right' ? 1 : Math.sign(off.x);
          ok(off.x * wantSide > 0, `${tag}: the slot is on the wrong end`);

          // ISO 15348's one hard number, measured on the folded part rather than
          // assumed from the net: no closer than 4 mm to the edge it hangs from.
          const tip = wantSide > 0 ? host.box.max.x : host.box.min.x;
          const slotEdge = wantSide > 0 ? Math.max(...ring.map((v) => v.x)) : Math.min(...ring.map((v) => v.x));
          ok(
            Math.abs(tip - slotEdge) >= 3.9,
            `${tag}: the slot comes within ${Math.abs(tip - slotEdge).toFixed(1)} mm of the tip — ISO 15348 wants 4`,
          );
        }

        // A tab may not change the box. The roll-spliced one gives its end wall 2t and
        // takes it back on the return ply, and this is the assertion that says so.
        const plain = fold({ ...p, hangTab: 'none' });
        const want = shellBox(plain.placed).getSize(new THREE.Vector3());
        const got = shellBox(placed).getSize(new THREE.Vector3());
        ok(
          Math.abs(want.x - got.x) < 0.2 && Math.abs(want.y - got.y) < 0.2 && Math.abs(want.z - got.z) < 0.2,
          `${tag}: the tab changed the box — ${got.x.toFixed(1)}×${got.y.toFixed(1)}×${got.z.toFixed(1)} vs ${want.x.toFixed(1)}×${want.y.toFixed(1)}×${want.z.toFixed(1)}`,
        );

        // `double` does not touch the lid at all, so the lid must come out identical
        // too — that is what distinguishes "spliced into the roll" from "grew the lid".
        // The window centres on the box's TOP, not on the lid's bounding box. With a
        // single-ply tab those are different rectangles and the difference is half a
        // tab — a window visibly off-centre on the finished box.
        const netLid = solve(p).net.panels.find((x) => x.id === 'ml-lid')!;
        // The window is whatever `applyWindow` appended after the slots — and on a
        // short box with a tab at each end there is no room left and it appends
        // nothing, which the app reports as a diagnostic rather than as an aperture.
        const win = netLid.holes[nLidSlots];
        if (p.window && win) {
          const xs = win.map((v) => v[0]);
          const wc = (Math.min(...xs) + Math.max(...xs)) / 2;
          const [rx, , rw] = netLid.windowRect ?? [0, 0, 0, 0];
          ok(
            Math.abs(wc - (rx + rw / 2)) < 0.6,
            `${tag}: the window sits ${(wc - (rx + rw / 2)).toFixed(1)} mm off the box's top`,
          );
        }
      }
     }
    }
  }
  console.log(`  ok  ${KINDS.length * ENDS.length * SIZES.length * HOLES.length} configurations`);
}

// ── lid wings ──
//
// The comment on the mailer's lid has always said which way this fails: a wing hinged
// on an OVERHANGING edge lands outside the box and clamps it instead of bracing it.
// That folds, looks plausible, and holds nothing — so the assertion is containment,
// not "did a wing appear".
console.log('\nlid wings');
for (const style of STYLES) {
  for (const [lengthMm, widthMm, heightMm] of SIZES) {
    for (const tab of ['none', 'single'] as HangTab[]) {
      const p: BoxParams = {
        ...DEFAULT_PARAMS,
        style,
        lengthMm,
        widthMm,
        heightMm,
        lidWings: true,
        hangTab: tab,
        hangEnd: 'right',
      };
      const tag = `${style} ${lengthMm}×${widthMm}×${heightMm} tab:${tab}`;
      const { placed } = fold(p);
      const shell = shellBox(placed);
      const lid = placed.get('ml-lid')!;
      const wings = [...placed].filter(([id]) => id.startsWith('ml-wing'));
      // One per short end, less any end the hang tab has taken — they want the same
      // edge, so the tab's end simply goes without.
      ok(wings.length === (tab === 'none' ? 2 : 1), `${tag}: ${wings.length} wing(s), expected ${tab === 'none' ? 2 : 1}`);
      for (const [id, w] of wings) {
        ok(
          w.box.min.x > shell.min.x - 0.6 && w.box.max.x < shell.max.x + 0.6,
          `${tag}: ${id} lands outside the box (${w.box.min.x.toFixed(1)}..${w.box.max.x.toFixed(1)} vs shell ${shell.min.x.toFixed(1)}..${shell.max.x.toFixed(1)}) — clamping the ends, not bracing them`,
        );
        // Down inside, not up in the air. A wing folded the wrong way is the same panel
        // with one sign flipped, and nothing else in the net notices.
        ok(
          w.box.min.z < lid.box.min.z - 1,
          `${tag}: ${id} never gets below the lid — it is folded the wrong way`,
        );
        // Clear of the floor, or it lands on the inner ply's nib tabs and stands the
        // lid proud of the rim.
        ok(w.box.min.z > shell.min.z + 0.5, `${tag}: ${id} reaches the floor`);
      }
    }
  }
}
console.log(`  ok  ${STYLES.length * SIZES.length * 2} configurations`);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
