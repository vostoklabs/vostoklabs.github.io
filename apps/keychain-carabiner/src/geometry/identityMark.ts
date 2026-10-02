/*
  Covert provenance mark (invariant #2).

  A deterministic constellation of sub-millimetre voids buried in the hook's band. Invisible
  on a print and in the preview, demonstrable in any slicer's section view. Forensic evidence
  for file-level piracy — never a feature lock, never on the surface, disclosed in the licence.

  THE SAFE ZONE. The band is the one region of the hook that is solid at every setting: `bar`
  wide, `thick` tall, all the way round. A void sits on the band's mid-line at mid-height,
  so its cover is `bar/2` sideways and `thick/2` up and down — and the diameter is derived
  from that cover, so a thin band gets a smaller mark rather than a hole through its wall.

  Three things break the band and are avoided by perimeter distance: the gate cut, the eye
  (or swivel housing), and the icon's footprint. Positions are fractions measured FROM THE
  GATE, so the constellation keeps its shape relative to the one feature every hook has.

  Two tiers, as in the clicker and the pen topper: a hardcoded one that survives someone
  copying the source, and a secret one keyed to a build-time seed only the deployed site has.
*/
import { frameAt, tDistance, type Ring } from '../shapes/ring';

export interface MarkVoid {
  x: number;
  y: number;
  z: number;
  /** Sphere diameter, mm. */
  d: number;
}

export interface MarkZone {
  /** The hook's outline in millimetres, as built (scaled and rotated). */
  ring: Ring;
  bar: number;
  thick: number;
  /** Perimeter fractions of the features that break the band. */
  gateT: number;
  eyeT: number;
  /** Icon footprint to stay out of, mm. `r` 0 = no icon. */
  icon: { x: number; y: number; r: number };
}

/** Read the build-time secret. Empty (dev, or a node run) → tier 2 is off. */
export function getMarkSeed(): string {
  try {
    return ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MARK_SEED as string) ?? '';
  } catch {
    return '';
  }
}

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

const HARDCODED_SEED = 'vostok-labs-keychain-carabiner-2026';

/** Where along the band each tier lives, as a fraction of the perimeter away from the gate.
 *  Disjoint bands, so a file carrying both never has one constellation read as the other. */
const BANDS = {
  hardcoded: [0.12, 0.46] as const,
  secret: [0.54, 0.88] as const,
};

/** Keep this far (mm, along the perimeter) from a cut or a fused feature. */
const KEEP_OUT_MM = 6;

function constellation(seed: string, zone: MarkZone, count: number, band: readonly [number, number]): MarkVoid[] {
  if (!seed) return [];
  const rng = makePrng(seed);
  // Cover is half the band sideways and half the thickness vertically; the void takes half
  // of the smaller one and leaves the rest as wall.
  const cover = Math.min(zone.bar / 2, zone.thick / 2);
  if (cover < 0.9) return [];
  const d = Math.min(1.0, Math.max(0.6, cover * 0.55));

  const out: MarkVoid[] = [];
  const span = band[1] - band[0];
  for (let i = 0; i < count; i++) {
    // One void per slot across the band, jittered inside its slot — never rejection
    // sampled, so the count is the count.
    const slot = span / count;
    const f = band[0] + i * slot + slot * (0.2 + rng() * 0.6);
    const t = (zone.gateT + f) % 1;
    const side = 0.35 + rng() * 0.3; // where across the bar, 0 = outer edge, 1 = inner

    if (tDistance(zone.ring, t, zone.gateT) < KEEP_OUT_MM) continue;
    if (tDistance(zone.ring, t, zone.eyeT) < KEEP_OUT_MM) continue;

    const fr = frameAt(zone.ring, t);
    const x = fr.p[0] - fr.n[0] * zone.bar * side;
    const y = fr.p[1] - fr.n[1] * zone.bar * side;
    if (zone.icon.r > 0 && Math.hypot(x - zone.icon.x, y - zone.icon.y) < zone.icon.r + 1.5) continue;

    out.push({ x, y, z: zone.thick / 2, d });
  }
  return out;
}

/** Every void to subtract from the hook: the always-on tier, plus the deployed site's tier
 *  when a build seed is present. */
export function identityVoids(zone: MarkZone): MarkVoid[] {
  return [
    ...constellation(HARDCODED_SEED, zone, 4, BANDS.hardcoded),
    ...constellation(getMarkSeed(), zone, 5, BANDS.secret),
  ];
}
