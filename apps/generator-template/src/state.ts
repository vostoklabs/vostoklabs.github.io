// 1. STATE — every setting the generator has, in one plain object.
//    Save / Load serialise exactly this, so keep it JSON-friendly.
export type RGB = [number, number, number];

export interface TagSettings {
  width: number;
  height: number;
  thickness: number;
  /** Corner radius, mm. */
  radius: number;
  /** Hanging hole diameter, mm. 0 removes it. */
  hole: number;
  /** Raised rim width, mm. 0 removes the rim (and the second part). */
  rim: number;
  rimHeight: number;
  bodyColor: RGB;
  rimColor: RGB;
}

export const DEFAULT_SETTINGS: TagSettings = {
  width: 60,
  height: 30,
  thickness: 3,
  radius: 6,
  hole: 4,
  rim: 2,
  rimHeight: 0.8,
  bodyColor: [40, 44, 52],
  rimColor: [91, 157, 255],
};

/** Merge a loaded project over the defaults, dropping anything unrecognised. */
export function coerceSettings(raw: unknown): TagSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const current = out[k as keyof TagSettings];
    if (typeof current === 'number' && typeof v === 'number' && isFinite(v)) {
      (out as Record<string, unknown>)[k] = v;
    } else if (Array.isArray(current) && Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) {
      (out as Record<string, unknown>)[k] = v.slice(0, 3);
    }
  }
  return out;
}
