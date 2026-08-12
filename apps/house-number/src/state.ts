/**
 * Save/load and URL presets.
 *
 * `coerceSettings` is the gate between anything outside the app and `SignParams`: a saved
 * project from an older build, a shared URL someone edited by hand, or a file that is not
 * ours at all. It never throws — an unreadable field falls back to its default, because a
 * project that opens with one wrong number is recoverable and one that refuses to open is
 * not.
 */
import {
  DEFAULTS, type SignParams, type PlateShape, type MountKind, type Align,
  type Orientation, type LinePlacement, type Divider, type Relief, type BandEdge,
} from './types';

const SHAPES: PlateShape[] = ['rounded', 'rect', 'pill', 'plaque', 'none'];
const MOUNTS: MountKind[] = ['tape', 'screws', 'keyhole'];
const ALIGNS: Align[] = ['left', 'center', 'right'];
const ORIENTATIONS: Orientation[] = ['horizontal', 'vertical'];
const PLACEMENTS: LinePlacement[] = ['below', 'beside'];
const DIVIDERS: Divider[] = ['none', 'line', 'band'];
const RELIEFS: Relief[] = ['raised', 'recessed', 'inlay'];
const BAND_EDGES: BandEdge[] = ['none', 'top', 'bottom', 'left', 'right'];

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v: unknown, fallback: string, maxLen = 64): string =>
  typeof v === 'string' ? v.slice(0, maxLen) : fallback;

const oneOf = <T extends string>(v: unknown, options: T[], fallback: T): T =>
  typeof v === 'string' && (options as string[]).includes(v) ? (v as T) : fallback;

const colour = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;

export function coerceSettings(raw: unknown): SignParams {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    // Line 1 was capped at 8 characters on the assumption it was always a house number. It
    // is not — people put names, unit codes and short words on it — so it takes the same
    // length as line 2. The cap that remains is a sanity bound on a file from outside, not a
    // UI limit; the plate auto-sizes and the size warning handles anything genuinely too big.
    text: str(o.text, DEFAULTS.text, 24),
    text2: str(o.text2, DEFAULTS.text2, 24),
    textSize: num(o.textSize, DEFAULTS.textSize, 10, 200),
    line2Size: num(o.line2Size, DEFAULTS.line2Size, 6, 80),
    linePlacement: oneOf(o.linePlacement, PLACEMENTS, DEFAULTS.linePlacement),
    align: oneOf(o.align, ALIGNS, DEFAULTS.align),
    lineSpacing: num(o.lineSpacing, DEFAULTS.lineSpacing, 0.3, 1.2),
    stackSpacing: num(o.stackSpacing, DEFAULTS.stackSpacing, 0.8, 2),
    letterSpacing: num(o.letterSpacing, DEFAULTS.letterSpacing, -0.1, 0.5),
    orientation: oneOf(o.orientation, ORIENTATIONS, DEFAULTS.orientation),
    fontId: str(o.fontId, DEFAULTS.fontId, 64),

    /*
     * Three generations of this setting still have to load.
     *
     * `ruleOn` (first), then `lineOn` + `lineStyle` (second), now one `divider` enum. The
     * middle pair is what made "Text inside" read as a property of the line; collapsing it
     * into one choice is the fix, and reading the old fields is the whole migration.
     */
    divider: oneOf(o.divider, DIVIDERS, (() => {
      const on = typeof o.lineOn === 'boolean' ? o.lineOn
        : typeof o.ruleOn === 'boolean' ? o.ruleOn : false;
      if (!on) return DEFAULTS.divider;
      return o.lineStyle === 'label' ? 'band' : 'line';
    })()),
    lineThickness: num(o.lineThickness ?? o.ruleThickness, DEFAULTS.lineThickness, 0.5, 20),
    lineOverhang: num(o.lineOverhang ?? o.ruleOverhang, DEFAULTS.lineOverhang, 0, 80),
    lineLength: num(o.lineLength, DEFAULTS.lineLength, 0, 250),
    lineOffset: num(o.lineOffset, DEFAULTS.lineOffset, -60, 60),
    // `textStyle` was the earlier name, and had no `inlay`.
    relief: oneOf(o.relief ?? o.textStyle, RELIEFS, DEFAULTS.relief),
    bridgeWidth: num(o.bridgeWidth, DEFAULTS.bridgeWidth, 0.4, 6),

    band: oneOf(o.band, BAND_EDGES, DEFAULTS.band),
    bandWidth: num(o.bandWidth, DEFAULTS.bandWidth, 2, 80),
    bandColor: colour(o.bandColor, DEFAULTS.bandColor),
    panelOn: typeof o.panelOn === 'boolean' ? o.panelOn : DEFAULTS.panelOn,
    panelInset: num(o.panelInset, DEFAULTS.panelInset, 2, 60),
    panelHeight: num(o.panelHeight, DEFAULTS.panelHeight, 0.4, 10),
    panelColor: colour(o.panelColor, DEFAULTS.panelColor),

    shape: oneOf(o.shape, SHAPES, DEFAULTS.shape),
    cornerRadius: num(o.cornerRadius, DEFAULTS.cornerRadius, 0, 40),
    padding: num(o.padding, DEFAULTS.padding, 0, 60),
    plateWidth: num(o.plateWidth, DEFAULTS.plateWidth, 0, 250),
    plateHeight: num(o.plateHeight, DEFAULTS.plateHeight, 0, 250),
    plateThickness: num(o.plateThickness, DEFAULTS.plateThickness, 2, 12),
    textThickness: num(o.textThickness, DEFAULTS.textThickness, 0.6, 10),
    // `frame` was one 0-8 mm slider that doubled as its own on/off switch. Projects saved
    // under that shape still load: a stored width of 0 means the frame was off, and any
    // width above 0 means it was on, at that width. Reading the legacy field first is the
    // whole of the migration — a saved sign must never open looking different.
    frameOn: typeof o.frameOn === 'boolean'
      ? o.frameOn
      : typeof o.frame === 'number' ? o.frame > 0.05 : DEFAULTS.frameOn,
    frameWidth: num(
      o.frameWidth ?? (typeof o.frame === 'number' && o.frame > 0.05 ? o.frame : undefined),
      DEFAULTS.frameWidth, 0.5, 8,
    ),
    // The old build extruded the frame to `textThickness`, so a legacy project that has no
    // `frameHeight` must keep following the text or it would open with a different frame.
    frameHeight: num(o.frameHeight, DEFAULTS.frameHeight, 0.4, 10),
    frameFollowsText: typeof o.frameFollowsText === 'boolean'
      ? o.frameFollowsText
      : DEFAULTS.frameFollowsText,
    chamfer: num(o.chamfer, DEFAULTS.chamfer, 0, 2),

    mount: oneOf(o.mount, MOUNTS, DEFAULTS.mount),
    mountHoleDia: num(o.mountHoleDia, DEFAULTS.mountHoleDia, 2, 8),
    mountFourHoles: typeof o.mountFourHoles === 'boolean' ? o.mountFourHoles : DEFAULTS.mountFourHoles,
    mountInset: num(o.mountInset, DEFAULTS.mountInset, 3, 60),
    countersink: typeof o.countersink === 'boolean' ? o.countersink : DEFAULTS.countersink,

    plateColor: colour(o.plateColor, DEFAULTS.plateColor),
    textColor: colour(o.textColor, DEFAULTS.textColor),
    // Projects saved before the frame had its own filament follow the text, which is what
    // they printed as when the frame shared the plate body.
    frameColor: colour(o.frameColor, colour(o.textColor, DEFAULTS.frameColor)),
  };
}

/**
 * Presets, which are the fastest route from "open the page" to "that is my sign".
 *
 * Applied through `applyPreset` over `DEFAULTS`, never over the current settings. Patching
 * `params` meant every preset silently inherited whatever the last one left behind: clicking
 * *Office door* then *Apartment* kept Office door's corner radius and second-line size, and
 * turning on a frame or Stacked first meant *Office door* did not produce an office door.
 * A preset that depends on what you clicked before it is not a preset.
 */
export const PRESETS: Array<{ id: string; label: string; patch: Partial<SignParams> }> = [
  {
    id: 'house',
    label: 'House',
    // A big number on a soft-cornered plate, hung on keyholes so no fixings show.
    //
    // 6 mm, not the 4 mm default: a keyhole has to swallow a screw head, which needs about
    // 3 mm behind the face plus a face left to read. At 4 mm this preset tripped the
    // generator's own thin-plate warning — a template that warns about itself is a bug in
    // the template, not advice.
    patch: {
      textSize: 70, padding: 14, shape: 'rounded', cornerRadius: 10,
      mount: 'keyhole', plateThickness: 6, text2: '',
    },
  },
  {
    id: 'mailbox',
    label: 'Mailbox',
    // Deliberately a different silhouette from House, not just a smaller one: a squared
    // plate with a frame, at a size that fits a mailbox flap. The two used to read as the
    // same card at thumbnail scale because both were a plain dark rounded rectangle.
    patch: {
      textSize: 30, padding: 7, shape: 'rect', cornerRadius: 0, mount: 'tape', text2: '',
      frameOn: true, frameWidth: 2, letterSpacing: 0.08,
    },
  },
  {
    id: 'office',
    label: 'Office door',
    // Number and room name on ONE row at their own sizes — the case `linePlacement: beside`
    // exists for, and what an office plate actually looks like.
    patch: {
      textSize: 30, line2Size: 15, padding: 9, shape: 'plaque', cornerRadius: 6,
      mount: 'tape', text2: 'STREET NAME', linePlacement: 'beside', frameOn: true, frameWidth: 2,
    },
  },
  {
    id: 'apartment',
    label: 'Apartment',
    // Screw-mounted, so the plate carries visible holes at each end. An explicit width, so
    // the pill is a proportioned capsule rather than whatever its own cap radius dictates.
    patch: {
      textSize: 45, padding: 10, shape: 'pill', cornerRadius: 0, mount: 'screws',
      mountHoleDia: 4.5, mountInset: 12, plateWidth: 120, text2: '',
    },
  },

  /* ── The three reference designs ──────────────────────────────────────────── */

  {
    id: 'street',
    label: 'Street, no plate',
    // Big number, a bar under it, the street name below, and no plate at all. The bar is what
    // makes it one printable piece instead of a bag of loose glyphs — see `lineContour`.
    // Line spacing is wide enough that the bar sits in a real gap rather than across the type.
    patch: {
      shape: 'none', divider: 'line', lineThickness: 6, lineOverhang: 8,
      textSize: 70, line2Size: 16, lineSpacing: 0.62, letterSpacing: 0.08,
      text2: 'STREET NAME', mount: 'tape', align: 'center',
    },
  },
  {
    id: 'band',
    label: 'Name in a band',
    // The "300" / "DRYFESDALE VIEW" idea: the street name reversed out of a filled bar sitting
    // under the number, so the two read as one label rather than two stacked things.
    patch: {
      shape: 'rect', cornerRadius: 0, divider: 'band', lineThickness: 5, lineOverhang: 8,
      textSize: 52, line2Size: 13, padding: 11, lineSpacing: 0.52,
      text2: 'STREET NAME', mount: 'tape', letterSpacing: 0.05,
    },
  },
  {
    id: 'edgeband',
    label: 'Edge band',
    // The "300" reference: a bar standing proud along the bottom of the plate in the same
    // filament and at the same height as the numerals — the plateless "bar under the number"
    // look, put on a plate, with no street name.
    patch: {
      shape: 'rect', cornerRadius: 0, padding: 12, plateThickness: 4, text2: '',
      band: 'bottom', bandWidth: 14,
      textSize: 46, textThickness: 2, mount: 'tape', letterSpacing: 0.04,
    },
  },
  {
    id: 'panel',
    label: 'Inset panel',
    // The "6" reference: a dark plate, a wood board raised on it, and the numeral cut clean
    // THROUGH the board so the dark plate shows in it. No frame — the plate's own margin is
    // the surround, exactly as the photo has it. Engraved rather than inlaid, because the
    // numeral is a void with the backing colour behind, not a filled inlay.
    patch: {
      shape: 'rounded', cornerRadius: 4, padding: 14, plateThickness: 5, text2: '',
      panelOn: true, panelInset: 8, panelHeight: 2.5, panelColor: '#7a5230',
      relief: 'recessed', textSize: 70, mount: 'tape',
    },
  },
];

/**
 * A preset, resolved against a clean slate but keeping what the user has made their own.
 *
 * The number, the font and the two colours survive — those are the user's, and having them
 * reset would make the examples feel like they throw work away. Everything else comes from
 * `DEFAULTS` plus the patch, so the result is the same whatever was set before.
 */
export function applyPreset(current: SignParams, patch: Partial<SignParams>): SignParams {
  return coerceSettings({
    ...DEFAULTS,
    text: current.text,
    fontId: current.fontId,
    plateColor: current.plateColor,
    textColor: current.textColor,
    ...patch,
  });
}
