// 1. STATE — every setting and every typed detail, in one plain object.
//    Save / Load serialise exactly this, so keep it JSON-friendly.
import { FONTS } from '@vostok/fonts/registry';
import type { Role } from './design/types';

export type TextCaseChoice = 'as-typed' | 'upper' | 'lower' | 'title';
export type PatternMode = 'colour' | 'carved' | 'cut';
export type QrStyleChoice = 'square' | 'rounded' | 'dots' | 'finder';
export type QrKind = 'website' | 'contact' | 'link';
export type QrSize = 'standard' | 'large';
export type LogoMode = 'logo' | 'initials' | 'none';
export type IconStyle = 'none' | 'classic' | 'classic-circle' | 'modern' | 'modern-square';
/** Which face carries a thing on a card with a back. */
export type Place = 'back' | 'front';
/** What the back says under the logo: the company, the customer's own name, or nothing. */
export type BackText = 'company' | 'name' | 'none';

/** A logo the customer brought in (an SVG, through the import window): its shapes in the symbol
 *  frame (centred, longest side 1, Y up), so the project file carries it whole. */
export interface Logo {
  id: string;
  label: string;
  shapes: [number, number][][][];
}

export interface CardSettings {
  // What the customer types or brings in (the right panel).
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  /** A QR code on the card, what it opens, and the link when that is its own. */
  qr: boolean;
  qrKind: QrKind;
  qrLink: string;
  /** The logo: theirs (a placeholder until one is brought in), their initials, or none. */
  logoMode: LogoMode;
  logo: Logo | null;
  /** On a card with a back: the face the logo and the QR go on, and what the back says. */
  logoPlace: Place;
  qrPlace: Place;
  backText: BackText;

  // Design: which template.
  template: string;

  // Card.
  /** The logo and the QR on a back of their own, printed into the other face. */
  twoSided: boolean;
  size: string;
  corner: number;
  /** The card's thickness, mm, raised lettering not included. */
  thickness: number;

  // Font and lettering.
  font: string;
  /** Lettering that stands up from the card; off, it lies flat in a face printed against the plate. */
  raised: boolean;
  /** How far raised lettering stands up, mm. */
  raise: number;
  /** Cap heights, mm. */
  nameSize: number;
  detailSize: number;
  nameCase: TextCaseChoice;
  /** Letter spacing, % of the letter size. */
  letterSpacing: number;

  // Icons in front of the contact lines.
  iconStyle: IconStyle;

  // Pattern (on the templates that have one).
  pattern: string;
  /** Zoom, %. */
  patternZoom: number;
  patternAngle: number;
  patternMode: PatternMode;

  // QR code.
  qrStyle: QrStyleChoice;
  /** The logo (or the initials) in the middle of the code. */
  qrLogo: boolean;
  /** Standard: as small as scans well. Large: bigger modules, read from further away. */
  qrSize: QrSize;

  // NFC.
  nfc: boolean;
  nfcTag: string;
  /** A small tap mark printed over the tag, so whoever holds the card knows where to tap. */
  nfcMark: boolean;
  /** Where the customer dragged the tag to, mm from the card's middle; null: where the template puts it. */
  nfcAt: [number, number] | null;

  // Colours: the three filaments, and any part set to a colour of its own.
  cardColor: string;
  inkColor: string;
  accentColor: string;
  colors: Partial<Record<Role, string>>;
  /** Colours the customer mixed on the wheel, newest first: every colour picker offers them. */
  customColors: string[];
}

export const DEFAULT_SETTINGS: CardSettings = {
  name: 'John Smith',
  title: 'Senior Designer',
  company: 'Smith Studio',
  phone: '+1 555 0142',
  email: 'john@smithstudio.com',
  website: 'smithstudio.com',
  qr: true,
  qrKind: 'website',
  qrLink: '',
  logoMode: 'logo',
  logo: null,
  logoPlace: 'back',
  qrPlace: 'back',
  backText: 'company',

  template: 'minimal',

  twoSided: true,
  size: '85x55',
  corner: 3,
  // Both faces carry three layers of colour and a layer of card between them.
  thickness: 1.4,

  font: 'inter',
  raised: false,
  raise: 0.6,
  nameSize: 6,
  detailSize: 3.6,
  nameCase: 'as-typed',
  letterSpacing: 0,

  iconStyle: 'classic',

  pattern: 'pm-japanese-pattern-4',
  patternZoom: 100,
  patternAngle: 0,
  patternMode: 'colour',

  qrStyle: 'square',
  qrLogo: false,
  qrSize: 'standard',

  nfc: false,
  nfcTag: '25',
  nfcMark: false,
  nfcAt: null,

  cardColor: '#1c1d21',
  inkColor: '#f7f7f5',
  accentColor: '#d9a441',
  colors: {},
  customColors: [],
};

const HEX = /^#[0-9a-f]{6}$/i;
/** How many of the customer's own colours are kept. */
export const CUSTOM_COLOURS = 8;
const ONE_OF = {
  nameCase: ['as-typed', 'upper', 'lower', 'title'],
  patternMode: ['colour', 'carved', 'cut'],
  qrStyle: ['square', 'rounded', 'dots', 'finder'],
  qrKind: ['website', 'contact', 'link'],
  qrSize: ['standard', 'large'],
  logoMode: ['logo', 'initials', 'none'],
  iconStyle: ['none', 'classic', 'classic-circle', 'modern', 'modern-square'],
  logoPlace: ['back', 'front'],
  qrPlace: ['back', 'front'],
  backText: ['company', 'name', 'none'],
} as const;
const ROLES: Role[] = ['card', 'shapes', 'name', 'details', 'icons', 'rule', 'logo', 'qr', 'pattern'];

/** A logo as the project file has it, or null when it is anything else. */
function readLogo(v: unknown): Logo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.label !== 'string' || !Array.isArray(o.shapes)) return null;
  const ok = o.shapes.every((island) => Array.isArray(island) && island.every((ring) => Array.isArray(ring) && ring.length >= 3
    && ring.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && isFinite(n)))));
  return ok ? { id: o.id, label: o.label, shapes: o.shapes as Logo['shapes'] } : null;
}

/** Merge a loaded project over the defaults, dropping anything unrecognised or of the wrong type.
 *  Ranges are not checked here: the controls own them, and `showSettings()` in main.ts clamps every
 *  loaded value to its control before anything is built from it. A setting with no control is
 *  checked here instead. */
export function coerceSettings(raw: unknown): CardSettings {
  const out: CardSettings = { ...DEFAULT_SETTINGS, colors: {}, customColors: [] };
  if (!raw || typeof raw !== 'object') return out;
  const given = raw as Record<string, unknown>;
  const set = out as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(given)) {
    if (!(k in out) || k === 'logo' || k === 'colors' || k === 'nfcAt' || k === 'customColors') continue;
    const current = set[k];
    if (typeof current === 'number' && typeof v === 'number' && isFinite(v)) set[k] = v;
    else if (typeof current === 'boolean' && typeof v === 'boolean') set[k] = v;
    else if (typeof current === 'string' && typeof v === 'string') set[k] = v;
  }
  out.logo = readLogo(given.logo);
  if (Array.isArray(given.customColors)) {
    out.customColors = [...new Set(given.customColors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()))].slice(0, CUSTOM_COLOURS);
  }
  const at = given.nfcAt;
  out.nfcAt = Array.isArray(at) && at.length === 2 && at.every((n) => typeof n === 'number' && isFinite(n)) ? [at[0], at[1]] : null;
  // The first projects chose a finish; a flush one had no raise. Then a raise of 0 was flush and any
  // other raised, before the switch. And "raised" was the pattern's word for in colour.
  if (typeof given.raised !== 'boolean') {
    if (given.finish === 'flush') out.raised = false;
    else if (typeof given.raise === 'number') out.raised = given.raise > 0;
  }
  if (out.raise <= 0) out.raise = DEFAULT_SETTINGS.raise;
  if (given.patternMode === 'raised') out.patternMode = 'colour';
  if (given.colors && typeof given.colors === 'object') {
    for (const role of ROLES) {
      const c = (given.colors as Record<string, unknown>)[role];
      if (typeof c === 'string' && HEX.test(c)) out.colors[role] = c;
    }
  }
  for (const key of ['cardColor', 'inkColor', 'accentColor'] as const) if (!HEX.test(out[key])) out[key] = DEFAULT_SETTINGS[key];
  for (const [key, allowed] of Object.entries(ONE_OF)) {
    if (!(allowed as readonly string[]).includes(set[key] as string)) set[key] = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
  }
  // An imported font is not inside the project file, so a project naming one opens in the default.
  if (!FONTS.some((f) => f.id === out.font)) out.font = DEFAULT_SETTINGS.font;
  return out;
}

/** How far the lettering stands up as built, mm: 0 when it lies flat. */
export const raiseOf = (s: CardSettings): number => (s.raised ? s.raise : 0);
