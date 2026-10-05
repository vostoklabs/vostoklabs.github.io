// Covert model-identity mark. A deterministic constellation of tiny voids buried in
// the always-solid ring around switch #0's socket — invisible on prints and normal
// previews, but demonstrable in any slicer's section/layer view. The constellation is
// derived from a build-time secret (VITE_MARK_SEED, a GitHub Actions secret), so the
// mechanism can be public while the actual signature stays private and provable.
//
// Dev builds (no seed) add NO voids, so local geometry is identical to pre-feature
// builds; the deployed site always marks.
//
// The seed, the generator and the polar sampler are the shelf's (@vostok/watermark);
// the bands below are this generator's own.

import { markSeed, polarVoids, type PolarVoid } from '@vostok/watermark';

/** One void: r from the socket centre, z in the build frame (inside the body wall
 *  below the well floor), d the sphere's diameter, all mm; thetaDeg in degrees,
 *  rotated with the switch at build time. */
export type MarkVoid = PolarVoid;

/** Read the build-time secret. Empty (dev / node test) → marking disabled. */
export const getMarkSeed = markSeed;

/** Deterministic 5-void constellation for a seed. Same seed → same voids forever, so
 *  every model from the public site shares one fingerprint ("made by my generator").
 *  Radii/angles/depths stay inside the always-solid socket ring; angles ≥ 25° apart. */
export function markVoids(seed: string): MarkVoid[] {
  return polarVoids(seed, {
    count: 5,
    minGapDeg: 25,
    r: [10.5, 2.0], // 10.5..12.5 mm (outside the 14 mm socket + wall)
    z: [-4.5, 2.0], // -4.5..-2.5 mm (below the well floor, above the body bottom)
    d: [1.2, 0.4], // 1.2..1.6 mm
  });
}

// ---------------------------------------------------------------------------
// Hardcoded watermark — always active, no secret required.
// Uses a DIFFERENT radius/depth band (r 8.0–10.0, z -3.5...-1.5, d 1.0–1.4)
// so the two tiers never overlap. Even if someone copies the source and runs it
// without VITE_MARK_SEED, every model still carries these identity voids.
// ---------------------------------------------------------------------------
const HARDCODED_SEED = 'vostok-labs-clicker-generator-2026';

/** 4 hardcoded voids that are ALWAYS subtracted from the body — no build-time
 *  secret needed. Proves the model was built by this generator's code. */
export function hardcodedVoids(): MarkVoid[] {
  return polarVoids(HARDCODED_SEED, {
    count: 4,
    minGapDeg: 30,
    r: [8.0, 2.0], // 8.0..10.0 mm — inside the secret mark's 10.5+ band
    z: [-3.5, 2.0], // -3.5..-1.5 mm — shallower than the secret band
    d: [1.0, 0.4], // 1.0..1.4 mm — slightly smaller
  });
}
