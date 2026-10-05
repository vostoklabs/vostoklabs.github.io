// Covert model-identity mark for the magnet generator. A deterministic
// constellation of tiny voids buried in the always-solid back region of the
// magnet body — invisible on prints and normal previews, but demonstrable in any
// slicer's section/layer view. The constellation is derived from a build-time
// secret (VITE_MARK_SEED, a GitHub Actions secret), so the mechanism can be
// public while the actual signature stays private and provable.
//
// Dev builds (no seed) add only the always-on hardcoded tier; the deployed site
// marks with the secret constellation too.
//
// Safe zone: voids live in the back-face band (z = 0.4..1.6 mm above the flat
// back) at a radius proportional to the silhouette. Pockets are subtracted from
// the body BEFORE marking, and every void is only subtracted when ≥98% buried in
// the resulting solid — so a void can never pierce a pocket or the silhouette.
//
// The seed, the generator and the polar sampler are the shelf's (@vostok/watermark);
// the bands below are this generator's own.

import { markSeed, polarVoids, type PolarVoid } from '@vostok/watermark';

/** One void: r from the design centre, z in the build frame (inside the back-face
 *  wall), d the sphere's diameter, all mm; thetaDeg in degrees. */
export type MarkVoid = PolarVoid;

/** Read the build-time secret. Empty (dev / node test) → marking disabled. */
export const getMarkSeed = markSeed;

/** Deterministic 5-void constellation for a seed. Same seed → same voids forever.
 *  Radius band scales with the magnet size; angles ≥ 25° apart. The worker only
 *  subtracts voids that are fully buried, so placement is safe for any shape. */
export function markVoids(seed: string, sizeMm: number): MarkVoid[] {
  return polarVoids(seed, {
    count: 5,
    minGapDeg: 25,
    r: [Math.max(6, sizeMm * 0.32), Math.max(4, Math.min(14, sizeMm * 0.24))], // anchor radius, band
    z: [0.4, 1.2], // 0.4..1.6 mm above the flat back
    d: [1.2, 0.4], // 1.2..1.6 mm
  });
}

// ---------------------------------------------------------------------------
// Hardcoded watermark — always active, no secret required.
// Uses a DIFFERENT radius/depth band (r 0.34..0.48 of size, z 1.7..2.9) so the
// two tiers never overlap. Even if someone copies the source and runs it without
// VITE_MARK_SEED, every model still carries these identity voids.
// ---------------------------------------------------------------------------
const HARDCODED_SEED = 'vostok-labs-magnet-generator-2026';

/** 4 hardcoded voids that are ALWAYS subtracted from the body — no build-time
 *  secret needed. Proves the model was built by this generator's code. */
export function hardcodedVoids(sizeMm: number): MarkVoid[] {
  return polarVoids(HARDCODED_SEED, {
    count: 4,
    minGapDeg: 30,
    r: [Math.max(6, sizeMm * 0.42), Math.max(4, Math.min(12, sizeMm * 0.2))], // anchor radius, band
    z: [1.7, 1.2], // 1.7..2.9 mm — deeper than the secret band
    d: [1.0, 0.4], // 1.0..1.4 mm — slightly smaller
  });
}
