// Covert model-identity mark. A deterministic constellation of tiny voids buried in
// the always-solid ring around switch #0's socket — invisible on prints and normal
// previews, but demonstrable in any slicer's section/layer view. The constellation is
// derived from a build-time secret (VITE_MARK_SEED, a GitHub Actions secret), so the
// mechanism can be public while the actual signature stays private and provable.
//
// Dev builds (no seed) add NO voids, so local geometry is identical to pre-feature
// builds; the deployed site always marks. See "New features dev plan" §3.3.

export interface MarkVoid {
  /** Polar radius from the socket centre, mm. */
  r: number;
  /** Polar angle, degrees (rotated with the switch at build time). */
  thetaDeg: number;
  /** Z depth in the build frame, mm (inside the body wall below the well floor). */
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

/** Deterministic 5-void constellation for a seed. Same seed → same voids forever, so
 *  every model from the public site shares one fingerprint ("made by my generator").
 *  Radii/angles/depths stay inside the always-solid socket ring; angles ≥ 25° apart. */
export function markVoids(seed: string): MarkVoid[] {
  if (!seed) return [];
  const rng = makePrng(seed);
  const voids: MarkVoid[] = [];
  const angles: number[] = [];
  let guard = 0;
  while (voids.length < 5 && guard++ < 1000) {
    const theta = rng() * 360;
    if (angles.some((a) => angularGap(a, theta) < 25)) continue;
    angles.push(theta);
    voids.push({
      r: 10.5 + rng() * 2.0, // 10.5..12.5 mm (outside the 14 mm socket + wall)
      thetaDeg: theta,
      z: -4.5 + rng() * 2.0, // -4.5..-2.5 mm (below the well floor, above the body bottom)
      d: 1.2 + rng() * 0.4, // 1.2..1.6 mm
    });
  }
  return voids;
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
  const rng = makePrng(HARDCODED_SEED);
  const voids: MarkVoid[] = [];
  const angles: number[] = [];
  let guard = 0;
  while (voids.length < 4 && guard++ < 1000) {
    const theta = rng() * 360;
    if (angles.some((a) => angularGap(a, theta) < 30)) continue;
    angles.push(theta);
    voids.push({
      r: 8.0 + rng() * 2.0,  // 8.0..10.0 mm — inside the secret mark's 10.5+ band
      thetaDeg: theta,
      z: -3.5 + rng() * 2.0,  // -3.5..-1.5 mm — shallower than the secret band
      d: 1.0 + rng() * 0.4,   // 1.0..1.4 mm — slightly smaller
    });
  }
  return voids;
}
