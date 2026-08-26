/*
  Covert provenance mark (invariant #2).

  A deterministic constellation of sub-1.5 mm voids buried in the collar wall.
  Invisible on a print and in the preview, demonstrable in any slicer's section
  view. It is forensic evidence for file-level piracy — a resold export, a "I
  modelled this" claim — and explicitly NOT DRM: it never gates a feature, never
  shows on a printed part, and it is disclosed in the licence.

  THE SAFE ZONE. The voids go in the two bottom corners of the collar's
  cross-section, and getting that right is the whole of this file. The collar is a
  flat-bottomed block of half-width R = boreR + wall, topped by the bore's teardrop
  grown by `wall`, and the bore's centre sits at exactly boreZ = R. Walk in from a
  bottom corner by `a` — the point (R - a, a) — and the three clearances are:

      to the flank   a
      to the floor   a
      to the bore    (R - a) * sqrt(2) - boreR

  The first two rise with `a` and the third falls, so the best spot is where they
  meet:

      a* = (R * sqrt(2) - boreR) / (1 + sqrt(2))

  and at that point all three equal a*. On a BIC-sized socket that is 1.8 mm of
  clearance in every direction — room for a 1.2 mm void with 0.6 mm of cover all
  round. It scales with the bore, so one formula covers a 6 mm mechanical pencil and
  a 16 mm marker, and the void diameter is derived from the clearance actually
  available rather than assumed, so a small socket gets a smaller constellation
  instead of a hole through its wall.

  (The obvious parameterisation — walk out along the diagonal from the origin,
  (kR, kR) — is wrong, and quietly so: for k between 0.31 and 0.70 that ray passes
  straight THROUGH the bore, so the "voids" are carved out of thin air and the mark
  silently does not exist. Only a volume check catches that.)

  Two tiers, as in the clicker: a hardcoded one that survives someone copying the
  source, and a secret one keyed to a build-time seed that only the deployed site
  has. They occupy different fraction bands so they never collide.
*/

export interface MarkVoid {
  x: number;
  y: number;
  z: number;
  /** Sphere diameter, mm. */
  d: number;
}

export interface MarkZone {
  boreR: number;
  wall: number;
  boreZ: number;
  /** The stretch of the collar, along the pen axis, the voids may sit in. */
  yFrom: number;
  yTo: number;
}

/** Read the build-time secret. Empty (dev, or a test run in node) → tier 2 is off. */
export function getMarkSeed(): string {
  try {
    return ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MARK_SEED as string) ?? '';
  } catch {
    return '';
  }
}

// xmur3 string hash -> 32-bit seeds for a deterministic PRNG.
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

// sfc32: small, fast, well-distributed PRNG -> floats in [0, 1).
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

const HARDCODED_SEED = 'vostok-labs-pen-topper-2026';

/** Where each tier sits along the corner diagonal, as a multiple of a*. Tier 1
 *  hugs the corner, tier 2 stands off it, so a file carrying both never has one
 *  constellation mistaken for the other. */
const BANDS = {
  hardcoded: [0.72, 0.90] as const,
  secret: [1.05, 1.25] as const,
};

function constellation(seed: string, zone: MarkZone, count: number, band: readonly [number, number]): MarkVoid[] {
  if (!seed) return [];
  const rng = makePrng(seed);
  const R = zone.boreR + zone.wall;
  const ySpan = zone.yTo - zone.yFrom;
  // The clearance at the best spot in the corner. Everything below is a fraction
  // of it, so a thin-walled socket simply produces a smaller mark.
  const aStar = (R * Math.SQRT2 - zone.boreR) / (1 + Math.SQRT2);
  // Nothing to hide in: a very short socket has no wall length to work with, and a
  // void that breaks a surface is worse than no void at all.
  if (ySpan < 4 || aStar < 0.6) return [];

  const out: MarkVoid[] = [];
  // One void per slot along the socket, jittered inside its slot. Rejection
  // sampling on a minimum spacing was the obvious way to do this and it silently
  // returned three voids out of four whenever the draws clustered — a mark that is
  // sometimes four dots and sometimes three is not a signature.
  for (let i = 0; i < count; i++) {
    const slot = ySpan / count;
    const a = aStar * (band[0] + rng() * (band[1] - band[0]));
    const y = zone.yFrom + i * slot + slot * (0.25 + rng() * 0.5);

    const x = R - a;
    const z = a;
    const room = Math.min(a, Math.hypot(x, z - zone.boreZ) - zone.boreR);
    if (room <= 0.5) continue;
    // Half the clearance as a radius leaves the other half as cover on the
    // thinnest side.
    const d = Math.min(1.5, Math.max(0.7, room));
    if (room < d * 0.5 + 0.3) continue;

    out.push({ x: rng() < 0.5 ? x : -x, y, z, d });
  }
  return out;
}

/** Every void to subtract from the body: the always-on tier, plus the deployed
 *  site's tier when a build seed is present. */
export function identityVoids(zone: MarkZone): MarkVoid[] {
  return [
    ...constellation(HARDCODED_SEED, zone, 4, BANDS.hardcoded),
    ...constellation(getMarkSeed(), zone, 5, BANDS.secret),
  ];
}
