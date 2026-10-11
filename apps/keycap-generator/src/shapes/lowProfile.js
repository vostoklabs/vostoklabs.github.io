/**
 * Any MX cap on low-profile MX-cross switches (Gateron KS-33 Low Profile 2.0, Kailh Choc v2): the
 * cap with its round stems swapped for `mx-lp` plus stems. It is the "Low-profile MX" stem choice,
 * so it works on every MX profile and shape; a tall cap simply loses more of its walls.
 *
 * Those switches put their cross in a round cup a round stem does not enter (see stems.js), and
 * their cross is short, so the socket is shortened too: the shell is cut from below until the
 * inner ceiling is `LP_SOCKET_DEPTH_MM` above the rim, then moved down so the rim keeps its
 * place, the way capHeight.js lowers a cap. Each new stem goes where an old one stood, found from
 * the stem mesh itself, so a 2u or a spacebar keeps its stabiliser stems wherever the CAD put them.
 */
import { withScope } from '@vostok/manifold';
import { buildStems, STEM_FUSE_MM } from './stems.js';
import { geometryOf, solidOf } from './mesh.js';

/** Socket depth of the low-profile stem, rim to inner ceiling. */
export const LP_SOCKET_DEPTH_MM = 2.5;

/**
 * @param {object} api  the initialised Manifold module
 * @param {{ shellGeometry: THREE.BufferGeometry, stemGeometry: THREE.BufferGeometry, meta: object }} cap
 *   as `loadKeycap` returns it; not changed
 * @returns {{ shellGeometry: THREE.BufferGeometry, stemGeometry: THREE.BufferGeometry, meta: object }}
 */
export function swapToLowProfileStems(api, cap) {
  const m = cap.meta;
  if (!cap.stemGeometry || !m.stemBbox) throw new Error('swapToLowProfileStems: this cap has no stems to swap');
  const rimZ = m.bbox.min[2];
  // The socket is a through-hole up to the inner ceiling, so the ceiling is the top of the stems'
  // box, or their bottom plus the socket depth on a generated cap whose stems run on into the top
  // plate (it says so). The new stems start on the rim. A cap already shallower than the new
  // socket is left its height.
  const ceilAt = m.socketDepthMM != null ? m.stemBbox.min[2] + m.socketDepthMM : m.stemBbox.max[2];
  const drop = Math.max(0, ceilAt - rimZ - LP_SOCKET_DEPTH_MM);
  const ceilZ = ceilAt - drop;
  // A cap whose sides end less than a socket below the ceiling gets its stems hanging below the
  // rim instead, so the socket is still the full depth.
  const stemZ = Math.min(rimZ, ceilZ - LP_SOCKET_DEPTH_MM);

  return withScope((keep) => {
    const whole = keep(solidOf(api, cap.shellGeometry));
    const shell = drop ? keep(keep(whole.trimByPlane([0, 0, 1], rimZ + drop)).translate([0, 0, -drop])) : whole;
    const centres = keep(solidOf(api, cap.stemGeometry)).decompose().map((piece) => {
      const b = keep(piece).boundingBox();
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    });
    const stems = keep(buildStems(api, 'mx-lp', centres, stemZ, ceilZ - stemZ + STEM_FUSE_MM));
    const sb = shell.boundingBox();
    const tb = stems.boundingBox();
    const meta = {
      ...m,
      triangles: shell.numTri() + stems.numTri(),
      vertices: shell.numVert() + stems.numVert(),
      bbox: { min: [...sb.min], max: [...sb.max] },
      topZ: m.topZ - drop,
      dishBottomZ: m.dishBottomZ - drop,
      stemBbox: { min: [...tb.min], max: [...tb.max] },
      socketDepthMM: LP_SOCKET_DEPTH_MM,
      // Nothing is measured yet for how far a low-profile switch lets the rim come down, so
      // no recess is called safe.
      safeRecessMM: 0,
    };
    // A generated shape's own width and travel no longer describe it once it is cut, and Cap
    // height must not rebuild it as the MX cap it was made as.
    delete meta.sizeMM;
    delete meta.travelMM;
    delete meta.shapeCap;
    return { shellGeometry: geometryOf(shell), stemGeometry: geometryOf(stems), meta };
  });
}
