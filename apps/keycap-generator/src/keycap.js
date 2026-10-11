import * as THREE from 'three';
import { assetUrl } from './assets.js';
import { initManifold } from './manifold.js';
import { buildShapeCap, swapToLowProfileStems } from './shapes/index.js';
import { SHAPE_URL, LP_STEM_URL } from './shapes/profiles.js';

// Load a pre-converted keycap's meshes + metadata (see scripts/convert-keycap.mjs).
// The shell (walls + dished top) lives in the top-level positions/indices; the switch
// stem(s), when present, are merged into one separate body the app can recolour on its own.
// `url` selects which size to load; it defaults to the single-cap file for back-compat.
//
// Two kinds of `url` are made rather than fetched (shapes/profiles.js):
// `shape:<shape>/<size>[?size=<mm>]` builds a round or square cap, and `lpstem:<file>` loads that
// file with low-profile stems. Any other parameter (an old `skirt=`) is ignored.
export async function loadKeycap(url = 'keycap.json') {
  if (url.startsWith(SHAPE_URL)) {
    const [path, query = ''] = url.slice(SHAPE_URL.length).split('?');
    const [shape, sizeId] = path.split('/');
    const params = new URLSearchParams(query);
    const num = (k) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : undefined);
    return buildShapeCap(await initManifold(), { shape, sizeId, sizeMM: num('size') });
  }
  if (url.startsWith(LP_STEM_URL)) {
    const kc = await loadKeycap(url.slice(LP_STEM_URL.length));
    const swapped = swapToLowProfileStems(await initManifold(), kc);
    kc.shellGeometry.dispose();
    kc.stemGeometry?.dispose();
    return swapped;
  }
  const res = await fetch(assetUrl(url));
  if (!res.ok) {
    throw new Error(`${url} not found. Run \`npm run convert\` first.`);
  }
  const data = await res.json();

  const makeGeom = (body) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
    geometry.setIndex(body.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
  };

  const shellGeometry = makeGeom({ positions: data.positions, indices: data.indices });
  const stemGeometry = data.stem ? makeGeom(data.stem) : null;

  return { shellGeometry, stemGeometry, meta: data.meta };
}
