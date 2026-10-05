/*
  A part as the viewer draws it (src/mesh.ts): xyz picked out of wider vertices, and normals
  creased at hard edges.

    pnpm --filter @vostok/viewer test
*/
import { partGeometry, stridedPositions } from '../src/mesh';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};

/** A unit cube: 8 corners, 12 triangles. */
const CUBE = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
};

{
  const xyz = new Float32Array([1, 2, 3, 4, 5, 6]);
  check('stride 3: the array itself, not a copy', stridedPositions(xyz, 3) === xyz && stridedPositions(xyz) === xyz);
  const wide = new Float32Array([1, 2, 3, 90, 91, 4, 5, 6, 92, 93]);
  check('stride 5: xyz picked out, the rest dropped', stridedPositions(wide, 5).join() === '1,2,3,4,5,6');
}
{
  const g = partGeometry(CUBE);
  const n = g.getAttribute('normal');
  const axisAligned = Array.from({ length: n.count }, (_, i) => [n.getX(i), n.getY(i), n.getZ(i)])
    .every((v) => v.filter((c) => Math.abs(c) > 0.999).length === 1 && v.filter((c) => Math.abs(c) < 1e-6).length === 2);
  check('a cube\'s corners are split, a normal per face', g.getAttribute('position').count === 36 && axisAligned, `${g.getAttribute('position').count} vertices`);
  const wide = new Float32Array(CUBE.positions.length / 3 * 4);
  for (let i = 0; i < CUBE.positions.length / 3; i++) wide.set([CUBE.positions[i * 3]!, CUBE.positions[i * 3 + 1]!, CUBE.positions[i * 3 + 2]!, 7], i * 4);
  const g4 = partGeometry({ positions: wide, indices: CUBE.indices, stride: 4 });
  check('the same cube with a fourth float per vertex draws the same',
    g4.getAttribute('position').array.join() === g.getAttribute('position').array.join()
      && g4.getAttribute('normal').array.join() === g.getAttribute('normal').array.join());
}
{
  // A shallow dome: neighbouring faces meet at a few degrees, so its normals stay smooth.
  const ring = 12;
  const pos: number[] = [0, 0, 1];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 0.9);
  }
  const idx: number[] = [];
  for (let i = 0; i < ring; i++) idx.push(0, 1 + i, 1 + ((i + 1) % ring));
  const g = partGeometry({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  const n = g.getAttribute('normal');
  let smooth = true;
  for (let i = 0; i < n.count; i++) if (g.getAttribute('position').getZ(i) === 1 && Math.abs(n.getZ(i) - 1) > 1e-6) smooth = false;
  check('a dome keeps one smooth normal at its top', smooth);
}

console.log(`\nmesh: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
