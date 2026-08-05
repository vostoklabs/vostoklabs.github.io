// Covert model-identity mark for the bubble pop generator. A deterministic
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

export interface MarkVoid {
  /** Polar radius from the design centre, mm. */
  r: number;
  /** Polar angle, degrees. */
  thetaDeg: number;
  /** Z depth in the build frame, mm (inside the back-face wall). */
  z: number;
  /** Void sphere diameter, mm. */
  d: number;
}

/** Read the build-time secret. Empty (dev / node test) → marking disabled. */
export function getMarkSeed(): string {
  try {
    return (((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MARK_SEED) as string) ?? '';
  } catch {
    return '';
  }
}

// xmur3 string hash → 32-bit seeds for a deterministic PRNG.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// sfc32: small, fast, well-distributed PRNG → floats in [0, 1).
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function makePrng(seed: string): () => number {
  const s = xmur3(seed);
  return sfc32(s(), s(), s(), s());
}

function angularGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Deterministic 5-void constellation for a seed. Same seed → same voids forever.
 *  Radius band scales with the magnet size; angles ≥ 25° apart. The worker only
 *  subtracts voids that are fully buried, so placement is safe for any shape. */
export function markVoids(seed: string, sizeMm: number): MarkVoid[] {
  if (!seed) return [];
  const rng = makePrng(seed);
  const rBand = Math.max(4, Math.min(14, sizeMm * 0.24)); // ±band around the anchor radius
  const rAnchor = Math.max(6, sizeMm * 0.32);
  const voids: MarkVoid[] = [];
  const angles: number[] = [];
  let guard = 0;
  while (voids.length < 5 && guard++ < 1000) {
    const theta = rng() * 360;
    if (angles.some((a) => angularGap(a, theta) < 25)) continue;
    angles.push(theta);
    voids.push({
      r: rAnchor + rng() * rBand,
      thetaDeg: theta,
      z: 0.4 + rng() * 1.2, // 0.4..1.6 mm above the flat back
      d: 1.2 + rng() * 0.4, // 1.2..1.6 mm
    });
  }
  return voids;
}

// ---------------------------------------------------------------------------
// Hardcoded watermark — always active, no secret required.
// Uses a DIFFERENT radius/depth band (r 0.34..0.48 of size, z 1.7..2.9) so the
// two tiers never overlap. Even if someone copies the source and runs it without
// VITE_MARK_SEED, every model still carries these identity voids.
// ---------------------------------------------------------------------------
const HARDCODED_SEED = 'vostok-labs-bubble-pop-generator-2026';

/** 4 hardcoded voids that are ALWAYS subtracted from the body — no build-time
 *  secret needed. Proves the model was built by this generator's code. */
export function hardcodedVoids(sizeMm: number): MarkVoid[] {
  const rng = makePrng(HARDCODED_SEED);
  const rAnchor = Math.max(6, sizeMm * 0.42);
  const rBand = Math.max(4, Math.min(12, sizeMm * 0.2));
  const voids: MarkVoid[] = [];
  const angles: number[] = [];
  let guard = 0;
  while (voids.length < 4 && guard++ < 1000) {
    const theta = rng() * 360;
    if (angles.some((a) => angularGap(a, theta) < 30)) continue;
    angles.push(theta);
    voids.push({
      r: rAnchor + rng() * rBand,
      thetaDeg: theta,
      z: 1.7 + rng() * 1.2, // 1.7..2.9 mm — deeper than the secret band
      d: 1.0 + rng() * 0.4, // 1.0..1.4 mm — slightly smaller
    });
  }
  return voids;
}
