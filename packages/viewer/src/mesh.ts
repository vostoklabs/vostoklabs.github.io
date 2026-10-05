// A part's triangles as a three.js geometry: the one place the viewer turns a mesh it is handed
// into something it draws. Apart from the renderer, so node can test it (tests/).
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/** xyz alone from vertices that carry `stride` floats each, xyz first (a manifold mesh's
 *  `numProp`). At 3 the array itself comes back, not a copy. */
export function stridedPositions(positions: Float32Array, stride = 3): Float32Array {
  if (stride === 3) return positions;
  const count = Math.floor(positions.length / stride);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = positions[i * stride]!;
    out[i * 3 + 1] = positions[i * stride + 1]!;
    out[i * 3 + 2] = positions[i * stride + 2]!;
  }
  return out;
}

/** The geometry for a part's triangles, with crease-split normals: domes and round walls stay
 *  smooth, hard edges (35 degrees and more) stay crisp. */
export function partGeometry(part: { positions: Float32Array; indices: Uint32Array; stride?: number }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(stridedPositions(part.positions, part.stride), 3));
  geo.setIndex(new THREE.BufferAttribute(part.indices, 1));
  const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
  geo.dispose();
  return creased;
}
