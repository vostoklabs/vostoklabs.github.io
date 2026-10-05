/*
  Parts the viewer's tests draw: tetrahedra, small enough to read in a failure message.
*/
import type { ViewerPart } from '../../src/index';

/** A tetrahedron with its corner at (x, y, z) and edge `s`. */
export const tetra = (x: number, y: number, z: number, s: number, color: [number, number, number], extra: Partial<ViewerPart> = {}): ViewerPart => ({
  name: `t${x}`,
  color,
  positions: new Float32Array([x, y, z, x + s, y, z, x, y + s, z, x, y, z + s]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
  ...extra,
});

export const RED: [number, number, number] = [200, 10, 10];

/** Three parts of three colours, one inside another's reach: what the tests pick and frame. */
export const PARTS = [tetra(-10, -5, 0, 20, RED), tetra(-2, -2, 1, 6.5, [20, 200, 30]), tetra(4, 4, 2, 3, [250, 250, 250])];
