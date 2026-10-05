/*
  The void watermark: the shared half of the covert provenance mark (invariant #2).

  A 3D generator buries a constellation of small spherical voids in a region of its model that
  is solid at every setting. They are invisible on a print and in the preview, and show in any
  slicer's section view: forensic evidence of where a file came from, never a feature lock.
  WHERE the voids may sit is each app's own geometry. What lives here is how a constellation is
  drawn from a seed, so a seed and an app's spec give the same voids forever.

  Two tiers, by convention: one keyed to a seed string written in the app, which survives a
  copy of the source, and one keyed to the build-time seed `markSeed()` reads, which is empty
  unless the build sets one.

  Every number drawn here is already in files people hold. The hash, the generator and the
  order of the draws must never change: a different constellation needs a different seed, never
  different code. Pure: no WASM, no DOM; the app subtracts the voids with its own Manifold.
*/

/** Read the build-time seed (`VITE_MARK_SEED`). Empty when the build sets none, and in node,
 *  so the seeded tier is off there. Vite and esbuild's `--define` both replace
 *  `import.meta.env` here, inside this package as in an app. */
export function markSeed(): string {
  try {
    return (((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MARK_SEED) as string) ?? '';
  } catch {
    return '';
  }
}

/** A seeded source of floats in [0, 1): the same seed gives the same sequence everywhere. */
export function prng(seed: string): () => number {
  const s = xmur3(seed);
  return sfc32(s(), s(), s(), s());
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

/** One void, in polar coordinates around the point the app anchors its mark to. */
export interface PolarVoid {
  /** Polar radius, mm. */
  r: number;
  /** Polar angle, degrees. */
  thetaDeg: number;
  /** Height in the app's build frame, mm. */
  z: number;
  /** Sphere diameter, mm. */
  d: number;
}

/** A field drawn as `base + rng() * span`. */
export type Band = readonly [base: number, span: number];

export interface PolarSpec {
  /** Voids to place. Fewer come back only when 1000 draws cannot space the angles. */
  count: number;
  /** The least angle between two voids, degrees. */
  minGapDeg: number;
  r: Band;
  z: Band;
  d: Band;
}

/**
 * A constellation around a centre: the same seed and spec give the same voids forever, and an
 * empty seed gives none (that tier is off). Angles are drawn and rejected until they sit
 * `minGapDeg` apart; each kept angle then draws its r, z and d, in that order.
 */
export function polarVoids(seed: string, spec: PolarSpec): PolarVoid[] {
  if (!seed) return [];
  const rng = prng(seed);
  const voids: PolarVoid[] = [];
  const angles: number[] = [];
  let guard = 0;
  while (voids.length < spec.count && guard++ < 1000) {
    const theta = rng() * 360;
    if (angles.some((a) => angularGap(a, theta) < spec.minGapDeg)) continue;
    angles.push(theta);
    voids.push({
      r: spec.r[0] + rng() * spec.r[1],
      thetaDeg: theta,
      z: spec.z[0] + rng() * spec.z[1],
      d: spec.d[0] + rng() * spec.d[1],
    });
  }
  return voids;
}

function angularGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}
