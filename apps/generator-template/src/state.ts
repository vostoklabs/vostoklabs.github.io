// 1. STATE — every setting the generator has, in one plain object.
//    Save / Load serialise exactly this, so keep it JSON-friendly.
import { FONTS } from '@vostok/fonts/registry';

export interface TagSettings {
  /** What the tag says. Typed in the right panel; everything else is set on the left. */
  text: string;
  /** A face of @vostok/fonts, by id. */
  font: string;
  /** The tag, mm. */
  width: number;
  height: number;
  thickness: number;
  radius: number;
  /** Letter size (the font's em), mm. Long text is made smaller to fit the tag. */
  textSize: number;
  /** How far the letters stand up from the tag, mm. */
  raise: number;
  /** Extra space between letters, % of the letter size. */
  letterSpacing: number;
  /** A keyring hole at the tag's left end. */
  hole: boolean;
  /** Its diameter, mm. */
  holeSize: number;
  /** Filament colours, as hex: the colour rows hold the same strings. */
  tagColor: string;
  textColor: string;
}

export const DEFAULT_SETTINGS: TagSettings = {
  text: 'Hello',
  font: 'russo-one',
  width: 60,
  height: 25,
  thickness: 3,
  radius: 5,
  textSize: 12,
  raise: 1,
  letterSpacing: 0,
  hole: true,
  holeSize: 5,
  tagColor: '#0a5cd5',
  textColor: '#f7f7f5',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Merge a loaded project over the defaults, dropping anything unrecognised or of the wrong
 *  type. Ranges are not checked here: the controls own them, and `showSettings()` in main.ts
 *  clamps every loaded value to its control before anything is built from it. A setting with
 *  no control must be range-checked here instead. */
export function coerceSettings(raw: unknown): TagSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const set = out as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const current = set[k];
    if (typeof current === 'number' && typeof v === 'number' && isFinite(v)) set[k] = v;
    else if (typeof current === 'boolean' && typeof v === 'boolean') set[k] = v;
    else if (typeof current === 'string' && typeof v === 'string') set[k] = v;
  }
  // Colours and the font have no range to clamp to, so they are checked here. A font someone
  // imported is not inside the project file, so a project naming one opens in the default face.
  if (!HEX.test(out.tagColor)) out.tagColor = DEFAULT_SETTINGS.tagColor;
  if (!HEX.test(out.textColor)) out.textColor = DEFAULT_SETTINGS.textColor;
  if (!FONTS.some((f) => f.id === out.font)) out.font = DEFAULT_SETTINGS.font;
  return out;
}
