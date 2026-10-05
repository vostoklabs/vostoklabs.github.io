/*
  The 3D viewer's arithmetic (src/framing.ts): the floor's gap below the model, where each view
  puts the camera, where the model is seated, when a rebuild may move the camera, how far back
  a cover is shot from.

    pnpm --filter @vostok/viewer test

  The numbers are the ones the viewer has always used, written out: a change here is a change
  to every generator's stage.
*/
import * as THREE from 'three';
import {
  COVER_DIR, COVER_PAD, FAR, FLOOR_GAP, NEAR, coverDistance, depthResolution, fillDistance, floorGapFor, followOutDistance,
  frameDistance, presetDirection, presetPosition, seatOf, type ViewPreset,
} from '../src/framing';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const vec = (v: THREE.Vector3) => `(${v.x}, ${v.y}, ${v.z})`;

/* ------------------------------------------------------------------ the floor */

check('the camera range is 0.1 to 5000 mm', NEAR === 0.1 && FAR === 5000);
check('the depth buffer resolves about 0.001 mm at 40 mm', near(depthResolution(40), 0.000954, 1e-6), String(depthResolution(40)));
check('and about 0.095 mm at 400 mm: a hundred times worse at ten times the distance', near(depthResolution(400), 0.0954, 1e-4) && near(depthResolution(400) / depthResolution(40), 100, 1e-9));
check('the floor gap is never less than 0.06 mm', floorGapFor(1) === FLOOR_GAP && floorGapFor(90) === FLOOR_GAP && FLOOR_GAP === 0.06);
check('far off, the gap is twelve depth buckets', floorGapFor(1000) === depthResolution(1000) * 12 && floorGapFor(1000) > FLOOR_GAP, String(floorGapFor(1000)));
{
  // The handover: the gap leaves 0.06 mm where twelve buckets first exceed it.
  let d = 1;
  while (depthResolution(d) * 12 <= FLOOR_GAP) d += 1;
  check('the gap starts to grow past about 92 mm', d > 90 && d < 94, `${d} mm`);
}

/* ------------------------------------------------------------------ the views */

check('a model is framed at its extent times the multiplier, plus the pad', frameDistance(40, 2.2, 15) === 103 && frameDistance(0, 1.9, 20) === 20);
{
  const c = new THREE.Vector3(1, -2, 5);
  const size = new THREE.Vector3(30, 20, 10);
  const want: Record<ViewPreset, [number, number, number]> = {
    iso: [101, -102, 75 + 5 - 5],
    front: [1, -102, 13],
    back: [1, 98, 13],
    left: [-99, -2, 13],
    right: [101, -2, 13],
    top: [1, -10, 105],
    bottom: [1, 6, -95],
  };
  for (const [preset, xyz] of Object.entries(want) as [ViewPreset, [number, number, number]][]) {
    const p = presetPosition(preset, c, size, 100);
    check(`${preset}: the camera at ${xyz.join(', ')}`, near(p.x, xyz[0]) && near(p.y, xyz[1]) && near(p.z, xyz[2]), vec(p));
  }
  const out = new THREE.Vector3();
  check('a preset writes into the vector it is given', presetPosition('front', c, size, 100, out) === out);
  check('an unknown preset is the three-quarter view', presetPosition('sideways' as ViewPreset, c, size, 100).equals(presetPosition('iso', c, size, 100)));
}

/* ------------------------------------------------------------------ seating */

{
  const box = new THREE.Box3(new THREE.Vector3(-3, 4, 2), new THREE.Vector3(7, 10, 12));
  const seat = seatOf(box);
  check('seated: centred in X and Y, bottom on the plate', seat.offset.equals(new THREE.Vector3(-2, -7, -2)), vec(seat.offset));
  check('seated: the centre ends up over the origin, half its height up', seat.centre.equals(new THREE.Vector3(0, 0, 5)), vec(seat.centre));
  const anchored = seatOf(box, [1, 2, 3]);
  check('anchored: the anchor point is held at the origin', anchored.offset.equals(new THREE.Vector3(-1, -2, -3)), vec(anchored.offset));
  check('anchored: the centre ends up where the anchor puts it', anchored.centre.equals(new THREE.Vector3(1, 5, 4)), vec(anchored.centre));
}

/* ------------------------------------------------------------------ a rebuild and the camera */

check('a model that did not grow never moves the camera', followOutDistance(50, 103, 200, false) === null);
check('a camera at the framing distance follows the model out', followOutDistance(103, 103, 140, true) === 140);
check('within 15% of it, still framed: it follows', followOutDistance(103 * 0.85, 103, 140, true) === 140);
check('a camera zoomed in closer than that stays where the user put it', followOutDistance(103 * 0.84, 103, 140, true) === null);
check('a camera already far enough back stays', followOutDistance(150, 103, 140, true) === null);
check('nothing framed yet: it follows', followOutDistance(10, null, 140, true) === 140);

/* ------------------------------------------------------------------ covers */

check('the cover direction is the three-quarter view, as a unit vector', near(COVER_DIR.length(), 1) && COVER_DIR.x > 0 && COVER_DIR.y < 0 && near(COVER_DIR.z / COVER_DIR.x, 0.75));
check('a cover is shot from where the bounding sphere just fills the frame, plus 15%', COVER_PAD === 1.15
  && near(coverDistance(10, 45), (10 / Math.sin(Math.PI / 8)) * 1.15) && near(coverDistance(10, 45, 1), 26.131259297527535));

/* ------------------------------------------------------------------ framing by fill */

{
  // A sphere of radius 10 seen through 45 degrees fills 55% of a square stage at:
  const square = fillDistance(10, 45, 1, 0.55);
  check('fill: the sphere covers that share of a square view', near(square, 10 / (0.55 * Math.tan(Math.PI / 8))), String(square));
  check('fill: a wide stage is framed by its height, the same as square', near(fillDistance(10, 45, 2, 0.55), square));
  const tall = fillDistance(10, 45, 0.5, 0.55);
  check('fill: a tall stage is framed by its narrower width, so further back', tall > square * 1.9, `${tall.toFixed(2)} vs ${square.toFixed(2)}`);
  check('fill: a stage not laid out yet counts as square', near(fillDistance(10, 45, 0, 0.55), square) && near(fillDistance(10, 45, Number.NaN, 0.55), square));
}
{
  const dirs = (['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] as ViewPreset[]).map((p) => [p, presetDirection(p)] as const);
  check('every preset direction is a unit vector', dirs.every(([, d]) => near(d.length(), 1)));
  check('the three-quarter direction is the cover\'s, as a copy', presetDirection('iso').equals(COVER_DIR) && presetDirection('iso') !== COVER_DIR);
  const c = new THREE.Vector3(0, 0, 0);
  const size = new THREE.Vector3(0, 0, 0);
  check('each face-on direction points the way its preset puts the camera',
    dirs.filter(([p]) => p !== 'iso').every(([p, d]) => presetPosition(p, c, size, 1).normalize().distanceTo(d) < 1e-12));
}

/* ------------------------------------------------------------------ report */

console.log(`\nframing: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
