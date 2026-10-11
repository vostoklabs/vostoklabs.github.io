/**
 * The caps the app makes rather than loads: the three shapes, as profiles beside the owner's in
 * `public/keycaps/index.json`, and any size with the low-profile stem.
 *
 * Both are ordinary `file`s that `loadKeycap` (src/keycap.js) knows how to make instead of fetch:
 * `shape:<shape>/<size>` builds a shape, and `lpstem:<file>` loads that file and swaps its stems.
 * So the single cap and the keyboard set, which both load caps by an entry's `file`, take them
 * with no code of their own.
 */
import { SHAPES, shapeSizes } from './index.js';

export const SHAPE_URL = 'shape:';
export const LP_STEM_URL = 'lpstem:';

/** The top plate of a generated cap is 1.5 mm (TOP_THICKNESS_MM): a legend deeper than this
 *  would carve through it. */
const SHAPE_MAX_DEPTH_MM = 1.2;

/**
 * The file that loads this size as the cap's settings say: a shape at its size (when given), with
 * the low-profile stem when `stem` is `mx-lp`. Without settings, the file as it is. (A shape's
 * sides always come down flush with its stem, so there is no side height to say.)
 *
 * @param {string} file  a size's `file`
 * @param {{ stem?: string, sizeMM?: number }} [cap]
 */
export function capFile(file, { stem = 'mx', sizeMM } = {}) {
  let out = file;
  if (file.startsWith(SHAPE_URL) && sizeMM != null) out = `${file}?${new URLSearchParams({ size: String(sizeMM) })}`;
  return stem === 'mx-lp' ? `${LP_STEM_URL}${out}` : out;
}

/** The profile with every size loading as `capFile` says, for code that loads caps by `file`
 *  (the keyboard set). The same object when there is nothing to change. */
export function withCapSettings(profile, cap = {}) {
  if (!profile) return profile;
  const keycaps = profile.keycaps.map((k) => ({ ...k, file: capFile(k.file, cap) }));
  return keycaps.every((k, i) => k.file === profile.keycaps[i].file) ? profile : { ...profile, keycaps };
}

/** Is this one of the shapes (its size can be set), rather than a loaded profile? */
export const isShapeProfile = (profile) => !!profile?.shape;

/** The shapes as profiles, in the order the picker lists them after the loaded ones. */
export function extraProfiles() {
  const out = [];
  for (const s of SHAPES) {
    out.push({
      id: s.id,
      label: s.label,
      shape: s.id,
      default: '1u',
      maxDepth: SHAPE_MAX_DEPTH_MM,
      keycaps: shapeSizes(s.id).map((z) => ({ id: z.id, label: z.label, unit: z.unit, file: `${SHAPE_URL}${s.id}/${z.id}` })),
    });
  }
  return out;
}
