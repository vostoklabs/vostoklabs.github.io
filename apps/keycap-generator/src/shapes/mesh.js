/**
 * Between Manifold solids and the three geometries a cap is carried in, for the shape engine.
 * No DOM; takes the initialised Manifold module, so a node test runs it.
 */
import * as THREE from 'three';
import { weldPositions } from '../meshUtils.js';

/** A solid as three geometry, indexed, with normals and bounds, the way `loadKeycap` hands a
 *  cap over. Copied out of WASM memory, so it outlives the solid. */
export function geometryOf(man) {
  const m = man.getMesh();
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = m.vertProperties[i * m.numProp + k];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** A loaded cap's geometry as a solid. The STEP tessellation keeps split vertices, so it is
 *  welded first, as the carve does (manifold.js `geomToManifold`). The caller owns the result. */
export function solidOf(api, geom) {
  const g = weldPositions(geom);
  return api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: Uint32Array.from(g.getIndex().array),
  }));
}
