// A loaded project, checked before it is used: it opens as the design it names, with every value
// it carries that is of the right kind. Ranges the controls own are clamped by the editor's one
// state path; what no control can clamp (the design, the words, the colours) is checked here.
import { FONTS } from '@vostok/fonts/registry';
import { designById, kickstandsFor, settingsOf } from './designs';
import { MAGNETS, PHOTO_SIZES } from './sizes';
import { WORD_ROLES, type FrameSettings } from './settings';

export * from './settings';

const HEX = /^#[0-9a-f]{6}$/i;

const CHOICES: Partial<Record<keyof FrameSettings, readonly string[]>> = {
  photo: PHOTO_SIZES.map((p) => p.id),
  orientation: ['portrait', 'landscape'],
  outline: ['rect', 'arch', 'scallop', 'ricrac', 'squiggle'],
  corners: ['square', 'rounded', 'round'],
  border: ['thin', 'regular', 'thick'],
  profile: ['flat', 'bevel', 'deep'],
  holder: ['bar', 'pill', 'heart'],
  stand: ['block', 'base', 'foot', 'kickstand', 'magnets', 'keychain', 'none'],
  magnet: MAGNETS.map((m) => m.id),
  magnetCount: ['2', '4'],
  loopAt: ['left', 'middle', 'right'],
  wordsAt: ['none', 'top', 'bottom'],
  kickstands: ['1', '2'],
};
const FLAGS = ['crest', 'patternOn', 'textAuto'] as const;
const NUMBERS = ['customWidth', 'customHeight', 'patternSize', 'patternDx', 'patternDy', 'textSize', 'holeDia', 'holeRing'] as const;
const COLOURS = ['bodyColor', 'inkColor', 'matColor', 'baseColor'] as const;

/** The settings a project file holds, or null when it names no design this app has. */
export function coerceSettings(raw: unknown): FrameSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const design = typeof r.design === 'string' ? designById(r.design) : undefined;
  if (!design) return null;
  const out = settingsOf(design);
  const set = out as unknown as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(CHOICES)) {
    const v = r[key];
    if (typeof v === 'string' && allowed!.includes(v)) set[key] = v;
  }
  for (const k of FLAGS) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  for (const k of NUMBERS) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  for (const k of COLOURS) {
    const v = r[k];
    if (typeof v === 'string' && HEX.test(v)) out[k] = v.toLowerCase();
  }
  if (typeof r.pattern === 'string' && /^[\w-]{1,64}$/.test(r.pattern)) out.pattern = r.pattern;
  // A font someone imported is not inside the project file, so a project naming one keeps the
  // design's own face.
  if (typeof r.font === 'string' && FONTS.some((f) => f.id === r.font)) out.font = r.font;
  // A file from before there was a choice stands on what its print's way round asks for.
  if (typeof r.kickstands !== 'string') out.kickstands = kickstandsFor(out);
  const words = r.words;
  if (words && typeof words === 'object') {
    for (const role of WORD_ROLES) {
      const v = (words as Record<string, unknown>)[role];
      if (typeof v === 'string') out.words[role] = v.slice(0, 80);
    }
  }
  return out;
}
