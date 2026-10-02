// What the four QR templates have in common: the payload you type, the code itself, and the
// composition of title / code / caption inside whatever outline the construction cuts.
//
// Until 2026-09-21 this was one factory in `qr-stand.ts` exporting four templates, and a
// construction was picked by a `style` string threaded through six hundred lines. The four are
// four products (one template, one object), so each now has its own file and its own
// geometry; everything that is genuinely the same for all four lives here:
//
//   · `qrContentFields` — what the code opens, with sample defaults that ENCODE, so a code
//     shows from the start.
//   · `qrCodeFields` — the Code category: size, the four module styles, the symbol in the middle,
//     toughness and invert.
//   · `qrAssemblyFields` — the Assembly category every INTERLOCKING design gets: material
//     thickness, kerf and fit, together, directly above "More options".
//   · `qrTextFields` / `qrFontField` / `qrLetteringFields` — the two lines and the face they are
//     set in. The font card previews the TITLE, never the link (`previewFrom`).
//   · `qrLayers` — the payload → the engraved code (+ its symbol), ready to place.
//   · `composeFace` — the frame rule, the title / code / caption stack on the optical centre,
//     the shrink-to-fit and every warning that is about the CODE rather than about a joint.
//   · `qrTemplate` — the `TemplateDef` a construction file wraps around all of that.
//
// A construction file (`qr-stand.ts`, `qr-slot-stand.ts`, `qr-table-tent.ts`, `qr-tag.ts`) owns
// exactly its own outline, its own extra pieces and its own assembly warnings. Three of those
// four geometries are built on the shared stand facilities, which touch nothing in this file.
import { bboxOf, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import {
  MAX_LOGO, QR_MIN_CELL, qrMinSize, qrPayload, qrShapes,
  type QrGeometry, type QrKind, type QrLevel, type QrStyle,
} from '../engine/qr';
import { insetRing, ringHalfWidthAt, signPlateHalfWidthAt, signPlateRing } from '../engine/qr-stand-geometry';
import { FIT, fitClearance, slotWidth } from '../engine/slots';
import { fitShapes, symbolLayer, textLayer } from '../engine/text';
import type { BuildInput, DesignLayer, KeyringSpec, PartInput, Pose } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { SAMPLE_SITE, stem } from './shared';
import { bool, num, str, type Field, type TemplateDef, type Values } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Clearance between two plates, mm — the one table lives in ../engine/slots.ts now, with the
 *  crush nodes that make it grip — without them even Tight was loose. */
export { FIT };
/** Quiet zone, in modules, on every side. The spec minimum; a scanner needs all four. */
export const QUIET = 4;
/** Engraved caps this small break up in a thin face — the house floor, for BOTH lines. */
const MIN_CAP = 4.5;
/** No line is ever shrunk below this, whatever the plate: under 3 mm nothing survives a burn. */
const FIT_FLOOR = 3;

const kindIs = (k: QrKind) => (v: Values) => str(v, 'kind') === k;

// ------------------------------------------------------------------ the form --

/**
 * RIGHT panel: what the code opens, and the two lines of type.
 *
 * Every payload's default ENCODES. Before 2026-09-21 only the link had one, so picking Text,
 * Wi-Fi or Contact emptied the preview and the template looked broken. The samples are
 * plainly samples — a café guest network, a card for a person who does not exist, and a menu on
 * nobody's site (`SAMPLE_SITE`, shared.ts).
 */
export function qrContentFields(): Field[] {
  return [
    {
      kind: 'select', key: 'kind', label: 'What it opens', panel: 'right', section: 'Content', value: 'link',
      options: [{ value: 'link', label: 'Link' }, { value: 'text', label: 'Text' }, { value: 'wifi', label: 'Wi-Fi' }, { value: 'contact', label: 'Contact' }],
      help: 'What a phone opens when it scans the code.',
    },
    { kind: 'text', key: 'link', label: 'Link', panel: 'right', section: 'Content', value: `${SAMPLE_SITE}/menu`, placeholder: 'Your page or menu', symbols: false, visibleWhen: kindIs('link') },
    { kind: 'text', key: 'plain', label: 'Text', panel: 'right', section: 'Content', value: 'Thanks for visiting!', placeholder: 'Anything you want to encode', maxLength: 200, symbols: false, visibleWhen: kindIs('text') },
    { kind: 'text', key: 'ssid', label: 'Network name', panel: 'right', section: 'Content', value: 'CoffeeHouse-Guest', placeholder: 'Network name', maxLength: 32, symbols: false, visibleWhen: kindIs('wifi') },
    { kind: 'text', key: 'password', label: 'Password', panel: 'right', section: 'Content', value: 'latte2026', placeholder: 'Password', maxLength: 63, symbols: false, visibleWhen: kindIs('wifi') },
    {
      kind: 'select', key: 'security', label: 'Security', panel: 'right', section: 'Content', value: 'WPA',
      options: [{ value: 'WPA', label: 'WPA/WPA2' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'Open' }],
      help: 'Guest networks are often Open.',
      visibleWhen: kindIs('wifi'),
    },
    { kind: 'text', key: 'cName', label: 'Name', panel: 'right', section: 'Content', value: 'Alex Rivera', placeholder: 'Full name', maxLength: 60, symbols: false, visibleWhen: kindIs('contact') },
    { kind: 'text', key: 'cPhone', label: 'Phone', panel: 'right', section: 'Content', value: '+1 555 0100', placeholder: 'Phone number', maxLength: 24, symbols: false, visibleWhen: kindIs('contact') },
    { kind: 'text', key: 'cEmail', label: 'Email', panel: 'right', section: 'Content', value: 'alex@example.com', placeholder: 'Email address', maxLength: 60, symbols: false, visibleWhen: kindIs('contact') },
  ];
}

/** RIGHT panel: the two lines, and the optional symbol that sits in the middle of the code. */
export function qrTextFields(title = 'SCAN THE MENU', caption = 'Drinks · Food · Allergens'): Field[] {
  return [
    { kind: 'text', key: 'title', label: 'Title', panel: 'right', section: 'Text', value: title, placeholder: 'A short line above the code', maxLength: 28, symbols: true },
    { kind: 'text', key: 'caption', label: 'Caption', panel: 'right', section: 'Text', value: caption, placeholder: 'A short line below the code', maxLength: 40, symbols: true },
    {
      kind: 'symbol', key: 'symbol', label: 'Symbol in the code', panel: 'right', section: 'Text', value: '',
      help: 'Optional. The code switches to maximum error correction.',
    },
  ];
}

/**
 * The font cards, previewing the TITLE.
 *
 * The cards used to preview the link, not the text on the tag. They walk the text fields in
 * declaration order, and on a QR template the first
 * one is the payload — so 241 faces all read "https://vostoklabs.git…". `previewFrom` names the
 * field that is actually set in this font.
 */
export function qrFontField(): Field {
  return {
    kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'montserrat', previewFrom: 'title',
    // A code's own title is read at a glance, small, and often at an angle: the faces that
    // survive that are clean sans with open counters and even weight. Every one below was
    // built at the default title and caption and looked at before it was listed.
    // (Archivo Black was tried and dropped: its caps are large for its em, so the caption
    // fits smaller and trips the 4.5 mm legibility floor on the tag's own default.)
    recommended: ['montserrat', 'oswald', 'bebas-neue', 'anton', 'fjalla-one', 'figtree', 'poppins', 'barlow-condensed'],
  };
}

export function qrLetteringFields(): Field[] {
  return [
    { kind: 'number', key: 'titleSize', label: 'Title size', section: 'Lettering', value: 8, min: 3, max: 20, step: 0.5, unit: 'mm', help: 'Shrinks to fit the plate.' },
    { kind: 'number', key: 'captionSize', label: 'Caption size', section: 'Lettering', value: 5, min: 3, max: 12, step: 0.5, unit: 'mm', help: 'Shrinks to fit the plate.' },
  ];
}

export function qrBorderField(): Field {
  return {
    kind: 'select', key: 'border', label: 'Border', section: 'Shape & size', value: 'rule',
    // "Double rule" is 11 characters, which the segmented control truncates to "Double …"
    // (G22); "Two rules" fits, so the choice stays three tabs rather than a dropdown.
    options: [{ value: 'none', label: 'None' }, { value: 'rule', label: 'Rule' }, { value: 'double', label: 'Two rules' }],
    help: 'Two rules adds a finer line inside the first.',
  };
}

/** LEFT: the "Code" category — the one that opens first on every QR template. */
export function qrCodeFields(size: { key: string; value: number; min: number; max: number }): Field[] {
  return [
    { kind: 'number', key: size.key, label: 'Code size', section: 'Code', value: size.value, min: size.min, max: size.max, step: 1, unit: 'mm', help: 'Edge to edge, not counting the clear border added around it.' },
    {
      kind: 'thumbs', key: 'codeStyle', label: 'Style', section: 'Code', value: 'square', columns: 4,
      options: [
        { value: 'square', label: 'Square', svgPath: styleThumb('square') },
        { value: 'rounded', label: 'Rounded', svgPath: styleThumb('rounded') },
        { value: 'dots', label: 'Dots', svgPath: styleThumb('dots') },
        { value: 'finder', label: 'Finder', svgPath: styleThumb('finder') },
      ],
      help: 'Dots and rounded need a bigger code to stay readable.',
    },
    {
      kind: 'number', key: 'symbolSize', label: 'Symbol size', section: 'Code',
      value: 16, min: 8, max: 100 * MAX_LOGO, step: 1, unit: '%',
      help: 'Share of the code the symbol covers.',
      visibleWhen: (v) => str(v, 'symbol') !== '',
    },
    // Toughness is the CODE's, and it stays with the code. It used to be `advanced: true`, which
    // in this form means "not in your section at all" — the field was pulled out of Code and
    // filed under More options beside the kerf. Toughness belongs in the Code section.
    {
      kind: 'select', key: 'level', label: 'Toughness', section: 'Code', value: 'Q',
      options: [{ value: 'L', label: 'L · 7%' }, { value: 'M', label: 'M · 15%' }, { value: 'Q', label: 'Q · 25%' }, { value: 'H', label: 'H · 30%' }],
      help: 'How much damage the code survives, at the cost of more modules.',
    },
    { kind: 'toggle', key: 'invert', label: 'Invert', section: 'Code', value: false, advanced: true, help: 'For dark material: burns the light squares instead.' },
  ];
}

/**
 * LEFT: "Assembly" — the three numbers a JOINT is cut to, in one category of their own, directly
 * above "More options".
 *
 * Every design with interlocking parts gets a separate Assembly section with material
 * thickness, kerf and fit. They were scattered — two
 * of them marked `advanced`, which files a control under More options whatever section it names,
 * and Fit missing altogether on the stands that hardcoded a 0.05 mm clearance.
 *
 * Declare these LAST among a template's left-hand fields: sections appear in first-use order and
 * "More options" is appended after them, so last is what puts Assembly directly above it.
 * A design with no joint (the QR tag) does not call this at all.
 */
export function qrAssemblyFields(o: { thickness?: Partial<Field>; help?: string } = {}): Field[] {
  return [
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Assembly',
      value: 3, min: 1.5, max: 9, step: 0.1, unit: 'mm',
      help: o.help ?? 'Measure your sheet: 3 mm ply is often 2.8.',
      ...o.thickness,
    } as Field,
    {
      kind: 'number', key: 'kerf', label: 'Kerf', section: 'Assembly',
      value: 0.18, min: 0, max: 0.5, step: 0.01, unit: 'mm',
      help: 'The width your laser burns away per pass.',
    },
    {
      kind: 'select', key: 'fit', label: 'Fit', section: 'Assembly', value: 'snug',
      options: [{ value: 'tight', label: 'Tight' }, { value: 'snug', label: 'Snug' }, { value: 'easy', label: 'Easy' }],
      help: 'Tight knocks home, Snug takes a thumb, Easy pulls apart.',
    },
  ];
}

/** The clearance an Assembly section's Fit asks for, mm. */
export const fitOf = (v: Values): number => fitClearance(str(v, 'fit'));

/**
 * LEFT: "Shape & size" for a construction that cuts a PLATE, plus its Assembly category.
 *
 * `assembly: false` leaves the three joint numbers where they were before 2026-09-22 — inside
 * "Shape & size" and marked `advanced`, so they show under More options. Nothing passes it
 * today; the flag exists so a caller that is NOT an interlocking design can opt out.
 */
export function qrPlateFields(o: { arch: boolean; leanHelp: string; assembly?: boolean }): Field[] {
  const joint = o.assembly === false
    ? [
      // 6 mm is the thickest sheet the material library offers and the thickest these joints are
      // drawn for: past it the half-lap is wider than the foot's own crown and the tent's tabs are
      // barely longer than the sheet is thick.
      { kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Shape & size', value: 3, min: 1.5, max: 6, step: 0.1, unit: 'mm', advanced: true, help: 'Measure your sheet with calipers: "3 mm" ply is often 2.8, and every slot is cut to this number.' } as Field,
      { kind: 'number', key: 'kerf', label: 'Kerf', section: 'Shape & size', value: 0.18, min: 0, max: 0.5, step: 0.01, unit: 'mm', advanced: true, help: 'The width your laser burns away per pass.' } as Field,
      {
        kind: 'select', key: 'fit', label: 'Fit', section: 'Shape & size', value: 'snug', advanced: true,
        options: [{ value: 'tight', label: 'Tight' }, { value: 'snug', label: 'Snug' }, { value: 'easy', label: 'Easy' }],
        help: 'Tight knocks home, Snug takes a thumb, Easy pulls apart.',
      } as Field,
    ]
    : qrAssemblyFields({ thickness: { max: 6 } });
  return [
    { kind: 'number', key: 'faceW', label: 'Plate width', section: 'Shape & size', value: 84, min: 50, max: 300, step: 1, unit: 'mm' },
    { kind: 'number', key: 'faceH', label: 'Plate height', section: 'Shape & size', value: 119, min: 75, max: 400, step: 1, unit: 'mm' },
    { kind: 'number', key: 'faceCorner', label: 'Corner radius', section: 'Shape & size', value: 9, min: 0, max: 20, step: 0.5, unit: 'mm' },
    ...(o.arch ? [{ kind: 'number', key: 'arch', label: 'Arched top', section: 'Shape & size', value: 9, min: 0, max: 30, step: 0.5, unit: 'mm', help: '0 flattens the top.' } as Field] : []),
    { kind: 'number', key: 'lean', label: 'Lean', section: 'Shape & size', value: 12, min: 0, max: 25, step: 1, unit: '°', help: o.leanHelp },
    ...joint,
  ];
}

/** What every plate construction reads back out of those fields. */
export interface PlateRead {
  w: number; h: number; corner: number; arch: number;
  thickness: number; kerf: number; lean: number; theta: number;
  /** The slot as DRAWN (narrow, so the beam leaves the opening at t + clearance) and as clamped
   *  to something the machine can actually cut. */
  drawnSlot: number; slot: number;
  clearance: number;
  ring: CutRing;
  inset: number; margin: number;
}

export function readPlate(v: Values, o: { arch: boolean; insetMin?: number }): PlateRead {
  const w = Math.max(20, num(v, 'faceW'));
  const h = Math.max(30, num(v, 'faceH'));
  const arch = o.arch ? clamp(num(v, 'arch'), 0, h / 3) : 0;
  const corner = clamp(num(v, 'faceCorner'), 0, Math.min(w, h) / 2);
  const thickness = clamp(num(v, 'thickness'), 0.5, 20);
  const kerf = clamp(num(v, 'kerf'), 0, 2);
  const lean = clamp(num(v, 'lean'), 0, 45);
  const clearance = fitClearance(str(v, 'fit'));
  // A saved file with a kerf wider than the sheet would ask for a slot of no width at all:
  // clamp it to something cuttable and let the warning say what happened.
  const drawnSlot = slotWidth(thickness, kerf, clearance);
  return {
    w, h, corner, arch, thickness, kerf, lean, clearance,
    theta: (lean * Math.PI) / 180,
    drawnSlot,
    slot: clamp(drawnSlot, 0.2, 2 * thickness),
    ring: signPlateRing(w, h, corner, arch),
    inset: faceInset(w, h, o.insetMin ?? 0),
    margin: faceMargin(w),
  };
}

/** The warnings every plate construction raises about its own joint, in the shipped order. */
export function plateWarnings(p: PlateRead, o: { lean?: boolean } = {}): string[] {
  const out: string[] = [];
  if (o.lean !== false && p.lean < 6) out.push('Under 6° the sign is held by the joint alone. 10–15° is the angle a seated person reads.');
  if (p.drawnSlot <= 0.5 || p.drawnSlot >= 1.8 * p.thickness) out.push(`The slot comes out ${round1(p.drawnSlot)} mm wide. Check the thickness and the kerf.`);
  if (p.h > 250 && p.thickness <= 3) out.push('A plate this tall bows in 3 mm. Use 6 mm.');
  return out;
}

// ------------------------------------------------------------------ the style thumbs --

/**
 * A 5 × 5 scrap of code drawn in each style, 40 × 40, for the `thumbs` grid.
 *
 * Drawn here rather than encoded: a real code at 40 px is grey mush, and the point of the tile
 * is to show what a MODULE looks like. The kit fills a thumb path with the non-zero rule, so a
 * hole has to be wound the other way — which is why the rings below name their sweep.
 */
const THUMB: boolean[][] = [
  [true, true, true, false, true],
  [true, false, true, true, false],
  [true, true, true, false, true],
  [false, true, false, true, true],
  [true, false, true, true, false],
];

function styleThumb(style: QrStyle): string {
  const s = 7;
  const o = 2.5;
  const at = (r: number, c: number) => [o + c * s, o + r * s] as const;
  const parts: string[] = [];
  const finderBlock = (r: number, c: number) => r < 3 && c < 3;
  // The top-left 3 × 3 stands in for a finder pattern: a ring with a light middle.
  if (style === 'finder') {
    const cx = o + 1.5 * s;
    const cy = o + 1.5 * s;
    const ring = (rad: number, sweep: number) =>
      `M ${cx - rad} ${cy} A ${rad} ${rad} 0 1 ${sweep} ${cx + rad} ${cy} A ${rad} ${rad} 0 1 ${sweep} ${cx - rad} ${cy} Z`;
    parts.push(ring(1.5 * s, 1), ring(0.5 * s, 0));
  }
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!THUMB[r]![c]) continue;
      if (style === 'finder' && finderBlock(r, c)) continue;
      const [x, y] = at(r, c);
      if (style === 'dots' && !finderBlock(r, c)) {
        const rad = (0.92 * s) / 2;
        const px = x + s / 2;
        const py = y + s / 2;
        parts.push(`M ${px - rad} ${py} A ${rad} ${rad} 0 1 1 ${px + rad} ${py} A ${rad} ${rad} 0 1 1 ${px - rad} ${py} Z`);
      } else if (style === 'square' || style === 'finder') {
        parts.push(`M ${x} ${y} h ${s} v ${s} h ${-s} Z`);
      } else {
        const k = 0.3 * s;
        parts.push(`M ${x + k} ${y} h ${s - 2 * k} a ${k} ${k} 0 0 1 ${k} ${k} v ${s - 2 * k} a ${k} ${k} 0 0 1 ${-k} ${k} h ${-(s - 2 * k)} a ${k} ${k} 0 0 1 ${-k} ${-k} v ${-(s - 2 * k)} a ${k} ${k} 0 0 1 ${k} ${-k} Z`);
      }
    }
  }
  return parts.join(' ');
}

// ------------------------------------------------------------------ the payload --

export interface QrRead {
  kind: QrKind;
  content: string;
  /** Did the customer type anything? A vCard is never an empty string, so this asks the FIELDS. */
  typed: boolean;
  level: QrLevel;
  style: QrStyle;
  symbol: string;
  /** The symbol's side as a fraction of the code's side, 0 when there is no symbol. */
  logo: number;
  ssid: string;
}

export function readQr(v: Values): QrRead {
  const kind = (['link', 'text', 'wifi', 'contact'].includes(str(v, 'kind')) ? str(v, 'kind') : 'link') as QrKind;
  const security = (['WPA', 'WEP', 'nopass'].includes(str(v, 'security')) ? str(v, 'security') : 'WPA') as 'WPA' | 'WEP' | 'nopass';
  const ssid = str(v, 'ssid');
  const symbol = str(v, 'symbol');
  const content = qrPayload(kind, {
    text: kind === 'link' ? str(v, 'link') : str(v, 'plain'),
    ssid, password: str(v, 'password'), security,
    name: str(v, 'cName'), phone: str(v, 'cPhone'), email: str(v, 'cEmail'),
  });
  const typed =
    kind === 'wifi' ? ssid.trim() !== '' || str(v, 'password') !== ''
      : kind === 'contact' ? [str(v, 'cName'), str(v, 'cPhone'), str(v, 'cEmail')].some((s) => s.trim() !== '')
        : (kind === 'link' ? str(v, 'link') : str(v, 'plain')).trim() !== '';
  const asked = (['L', 'M', 'Q', 'H'].includes(str(v, 'level')) ? str(v, 'level') : 'Q') as QrLevel;
  return {
    kind, content, typed, ssid, symbol,
    // A symbol costs modules, so it is only ever cut out of a code that can spare them: with a
    // symbol the level is H whatever the Toughness slider says, and the symbol's own tooltip
    // says so. H recovers 30 % of the codewords; the biggest symbol costs 9 % of the modules.
    level: symbol ? 'H' : asked,
    style: (['square', 'rounded', 'dots', 'finder'].includes(str(v, 'codeStyle')) ? str(v, 'codeStyle') : 'square') as QrStyle,
    logo: symbol ? clamp(num(v, 'symbolSize') / 100, 0, MAX_LOGO) : 0,
  };
}

// ------------------------------------------------------------------ the code as layers --

export interface QrLayerResult {
  /** The code (and its symbol) as engrave layers, centred on the origin. */
  layers: DesignLayer[];
  geometry: QrGeometry;
  /** The code plus its 4-module quiet zone, mm — what the composition has to find room for. */
  block: number;
}

/**
 * The code, its symbol and — in Invert — the panel they are cut out of, centred on the origin.
 *
 * The code is always an ENGRAVE: every real code is 10–60 separate islands with holed finder
 * patterns, so "cut it out" would post a bag of small squares. On dark stock the burn is PALE,
 * so Invert engraves the quiet-zone panel with the code (and the symbol) subtracted from it.
 */
export async function qrLayers(
  q: QrRead,
  sizeMm: number,
  invert: boolean,
  symbols: ReturnType<typeof readSymbols>,
): Promise<QrLayerResult> {
  const geometry = qrShapes(q.content, sizeMm, q.level, { style: q.style, logo: q.logo });
  const block = sizeMm + 2 * QUIET * geometry.cell;
  // The symbol is fitted to the cleared square less its quiet ring, so it can never touch a
  // module however tall or wide the icon happens to be drawn.
  let mark: Shapes = [];
  if (q.symbol && geometry.logoMm > 0.5) {
    const built = await symbolLayer(q.symbol, geometry.logoMm, 'engrave', { symbols }, 'code-symbol');
    if (built[0]) mark = fitShapes(built[0].shapes, geometry.logoMm);
  }
  if (invert) {
    // The panel's corner is capped at two cells, so rounding can never eat into the quiet zone.
    const panel: Shapes = [[roundedRectRing(block, block, Math.min(2 * geometry.cell, 3))]];
    return { layers: [{ id: 'code', label: 'QR code', shapes: panel, op: 'engrave', minus: [...geometry.shapes, ...mark] }], geometry, block };
  }
  const layers: DesignLayer[] = [{ id: 'code', label: 'QR code', shapes: geometry.shapes, op: 'engrave' }];
  if (mark.length) layers.push({ id: 'code-symbol', label: 'Symbol', kind: 'symbol', shapes: mark, op: 'engrave' });
  return { layers, geometry, block };
}

// ------------------------------------------------------------------ the face --

/**
 * Everything a construction has to tell the composer about the piece it cuts.
 *
 * The three stands hand over an arched plate they know in closed form; the tag hands over a
 * library blank and its real outline. Both are measured the same way from here on.
 */
export interface FaceSpec {
  /** The outline the content is composed inside, in the piece's own frame. */
  ring: CutRing;
  /** The key of this construction's "Code size" field. The tag keeps its own (`tagQrSize`) so
   *  that a saved tag still opens at the size it was saved at. */
  sizeKey: string;
  /** Present for a plate: the composer can then measure its half-width exactly rather than by
   *  crossing the ring, which matters under a deep arch. */
  plate?: { w: number; h: number; corner: number; arch: number };
  /** The frame rule: how far in it sits and where it stops (a stand's plinth, a tent's handle). */
  inset: number;
  frameTop: number;
  frameBottom: number;
  /** The content box when the Border is off. */
  bareTop: number;
  bareBottom: number;
  bareMargin: number;
  /** A ceiling on the content whatever the border says — a punched hole's keep-out. */
  hardTop?: number;
}

export interface FaceContent {
  /** Border, title, code, symbol, caption — in job order. */
  layers: DesignLayer[];
  warnings: string[];
  /** The code as it came out, after any shrink to fit; null when nothing was typed. */
  qr: QrGeometry | null;
  qrSize: number;
}

export const faceMargin = (bodyW: number) => Math.max(4, 0.06 * bodyW);
/** Inset 6.5 % of the short side (the 6–10 % band, 3 mm floor); `min` is the construction's own
 *  floor, where a notch or a slot would otherwise cut the rule into pieces. */
export const faceInset = (w: number, h: number, min = 0) => Math.max(3, 0.065 * Math.min(w, h), min);
/** A 1.2 mm stroke on a stand, deliberately under the 2–4 % the rule suggests, because the code
 *  is already a black mass and a fat frame competes with it; a tag scales its own. */
export const faceStroke = (bodyW: number, bodyH: number, isTag: boolean) =>
  (isTag ? clamp(0.02 * Math.min(bodyW, bodyH), 0.6, 1.6) : 1.2);

/**
 * Title, code and caption as one stack inside `spec`, with the frame rule around them.
 *
 * The stack's centre sits on the box's 46 % line — the optical centre, which is where a
 * composition looks middled rather than measures middled. The CODE gives way first when the
 * piece is too small for it, then each line of type is shrunk against the width the shape
 * actually has at its own height (an arch narrows as it rises, a swing tag clips its corners).
 */
export async function composeFace(v: Values, spec: FaceSpec): Promise<FaceContent> {
  const q = readQr(v);
  const symbols = readSymbols(v);
  const font = str(v, 'font');
  const title = str(v, 'title');
  const caption = str(v, 'caption');
  const border = str(v, 'border');
  const invert = bool(v, 'invert');
  const askedQr = Math.max(5, num(v, spec.sizeKey));
  let qrSize = askedQr;

  const box = bboxOf([[spec.ring]]);
  const bodyW = box.maxX - box.minX;
  const bodyH = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const isTag = !spec.plate;
  const margin = spec.bareMargin;
  const stroke = faceStroke(bodyW, bodyH, isTag);
  const inset = spec.inset;

  let built = q.typed ? await tryLayers(q, qrSize, invert, symbols) : null;
  let block = built ? built.block : 0;

  // ------------------------------------------------------------------ the frame --
  const frameRing = (k: number): CutRing => {
    if (!spec.plate) return insetRing(spec.ring, bodyW, bodyH, cx, cy, k);
    const bottomY = spec.frameBottom + (k - inset);
    const topY = spec.frameTop - (k - inset);
    const mid = (topY + bottomY) / 2;
    // The inner arch is the SCALED ellipse (w/2 − k, arch − k), not a true normal offset: the
    // offset of a shallow ellipse cusps at the flanks, the scaled one is exact at the crown and
    // the flanks and half a millimetre off in between.
    return signPlateRing(spec.plate.w - 2 * k, topY - bottomY, Math.max(0, spec.plate.corner - k), Math.max(0, spec.plate.arch - k))
      .map(([x, y]) => [x, y + mid]);
  };
  const frames: Shapes = [];
  if (border !== 'none' && spec.ring.length > 2) {
    frames.push([frameRing(inset), frameRing(inset + stroke)]);
    // The certificate convention: gap 3 × the stroke, the inner rule half its weight.
    if (border === 'double') {
      const g = inset + stroke + 3 * stroke;
      frames.push([frameRing(g), frameRing(g + stroke / 2)]);
    }
  }

  // ------------------------------------------------------------------ the content box --
  // Air between the frame and the lettering. 3.5 % of the short side keeps the house's "3–5 mm
  // inside an outline" at plate size and stays proportional on a small tag.
  const gutter = border === 'none' ? 0 : Math.max(2, 0.035 * Math.min(bodyW, bodyH));
  const k = inset + stroke + gutter;
  let boxTop: number;
  let boxBottom: number;
  let boxW: number;
  let boxCrown: number;
  let boxArch: number;
  if (border !== 'none') {
    boxTop = Math.min(spec.hardTop ?? Infinity, spec.frameTop - stroke - gutter);
    boxBottom = spec.frameBottom + stroke + gutter;
    boxW = bodyW - 2 * k;
    boxCrown = boxTop;
    boxArch = spec.plate ? Math.max(0, spec.plate.arch - k) : 0;
  } else {
    boxTop = Math.min(spec.hardTop ?? Infinity, spec.bareTop);
    boxBottom = spec.bareBottom;
    boxW = bodyW - 2 * margin;
    boxCrown = spec.plate ? spec.plate.h / 2 - margin : boxTop;
    boxArch = spec.plate ? Math.max(0, spec.plate.arch - margin) : 0;
  }
  // The tag's box is the real blank inset, sampled — not a rectangle. A swing tag's top two
  // corners are clipped at 45° and a shield narrows to a point; measuring the width as if the
  // box ran full-width to the very top is what put `SCAN THE MENU` across the frame's chamfer.
  const boxRing = isTag && spec.ring.length > 2 ? insetRing(spec.ring, bodyW, bodyH, cx, cy, Math.max(margin, border !== 'none' ? k : 0)) : [];
  const halfAt = (y: number) => (boxRing.length > 2
    ? ringHalfWidthAt(boxRing, cx, y)
    : signPlateHalfWidthAt(y, boxW, boxCrown, boxArch));

  // The box's TOP follows the shape. A clipped corner or a deep arch will take a line of type
  // that is pushed up into it and shrink it to nothing to make it fit; walk the top down to
  // where the shape is still four fifths of its width.
  for (let i = 0; i < 400 && boxTop > boxBottom + 1; i++) {
    if (halfAt(boxTop) >= 0.4 * boxW - 0.2) break;
    boxTop -= 0.25;
  }

  // ------------------------------------------------------------------ the stack --
  let titleSize = clamp(num(v, 'titleSize'), 1, 200);
  let captionSize = clamp(num(v, 'captionSize'), 1, 200);
  const askedTitle = titleSize;
  const askedCaption = captionSize;
  const textSpec = (text: string, size: number) => ({ symbols, text, font, size });
  let titleLayers = await textLayer(textSpec(title, titleSize), 'engrave', 'title', 'Title');
  let capLayers = await textLayer(textSpec(caption, captionSize), 'engrave', 'caption', 'Caption');
  const boxOf = (layers: DesignLayer[]) => (layers.length ? bboxOf(layers.flatMap((l) => l.shapes)) : null);

  const solve = () => {
    const tb = boxOf(titleLayers);
    const cb = boxOf(capLayers);
    const th = tb ? tb.maxY - tb.minY : 0;
    const ch = cb ? cb.maxY - cb.minY : 0;
    const gapAbove = th > 0 && (block > 0 || ch > 0) ? Math.max(3, 0.9 * titleSize) : 0;
    const gapBelow = block > 0 && ch > 0 ? Math.max(3, 1.35 * captionSize) : 0;
    const total = th + gapAbove + block + gapBelow + ch;
    // 46 % down the box, not 50 %. That puts the stack's own centre above the box's, so a stack
    // that nearly fills the box would push its title out of the top: never leave the box while
    // the stack still fits inside it, and hang it from the top when it does not.
    const wanted = boxTop - 0.46 * (boxTop - boxBottom) + total / 2;
    const top = total <= boxTop - boxBottom ? clamp(wanted, boxBottom + total, boxTop) : boxTop;
    const blockTop = top - th - gapAbove;
    const capTop = blockTop - block - gapBelow;
    return { tb, cb, th, ch, total, titleTop: top, blockTop, capTop, codeY: blockTop - block / 2, titleY: top - th / 2, capY: capTop - ch / 2 };
  };
  let s = solve();

  // The CODE gives way first. `block` is linear in the code's own size, so the answer is exact
  // rather than iterative, and the type is fitted afterwards against the new box.
  if (built && block > 0) {
    const room = boxTop - boxBottom - (s.total - block);
    const wanted = Math.min(boxW, room);
    if (block > wanted + 0.01) {
      const next = Math.max(5, (qrSize * Math.max(0.05, wanted)) / block);
      if (next < qrSize - 0.01) {
        qrSize = next;
        const again = await tryLayers(q, qrSize, invert, symbols);
        if (again) { built = again; block = again.block; }
        s = solve();
      }
    }
  }

  // Shrink to fit: a line is measured where its own caps are, because an arch narrows the box as
  // it rises. One corrective pass is enough — the second solve moves a line by a hair.
  for (let pass = 0; pass < 2; pass++) {
    let again = false;
    const fit = async (b: { minX: number; maxX: number } | null, top: number, bottom: number, size: number, text: string, id: string, label: string) => {
      if (!b) return null;
      const avail = 2 * Math.min(halfAt(top), halfAt(bottom));
      const wide = b.maxX - b.minX;
      if (wide <= avail + 0.01 || avail < 1 || wide < 0.01) return null;
      again = true;
      // Never below the floor: under 3 mm an engraved cap is a smudge whatever the face.
      const next = Math.max(FIT_FLOOR, (size * avail) / wide);
      return { next, layers: await textLayer(textSpec(text, next), 'engrave', id, label) };
    };
    const t = await fit(s.tb, s.titleTop, s.titleTop - s.th, titleSize, title, 'title', 'Title');
    if (t) { titleSize = t.next; titleLayers = t.layers; }
    const c = await fit(s.cb, s.capTop, s.capTop - s.ch, captionSize, caption, 'caption', 'Caption');
    if (c) { captionSize = c.next; capLayers = c.layers; }
    s = solve();
    if (!again) break;
  }

  // ------------------------------------------------------------------ the layers --
  const layers: DesignLayer[] = [];
  if (frames.length) layers.push({ id: 'border', label: 'Border', shapes: frames, op: 'engrave' });
  if (s.tb) layers.push({ ...titleLayers[0]!, shapes: placeShapes(titleLayers[0]!.shapes, 0, s.titleY, 0) });
  if (built) {
    for (const l of built.layers) {
      layers.push({ ...l, shapes: placeShapes(l.shapes, 0, s.codeY, 0), ...(l.minus ? { minus: placeShapes(l.minus, 0, s.codeY, 0) } : {}) });
    }
  }
  if (s.cb) layers.push({ ...capLayers[0]!, shapes: placeShapes(capLayers[0]!.shapes, 0, s.capY, 0) });

  // ------------------------------------------------------------------ what to say --
  // In the order the UI doc sets: most actionable first.
  const warnings: string[] = [];
  const geometry = built ? built.geometry : null;
  if (!q.typed) warnings.push('Type a link and the code appears.');
  if (q.typed && !built) warnings.push('Too much text for one QR code — shorten it or lower the toughness.');
  if (geometry && geometry.cell < QR_MIN_CELL[q.style]) {
    const floor = QR_MIN_CELL[q.style];
    const least = round1(Math.ceil(qrMinSize(q.content, q.level, floor) * 10) / 10);
    warnings.push(`Modules are ${geometry.cell.toFixed(2)} mm — too fine to engrave. Make the code at least ${least} mm, or lower the toughness.`);
  }
  // The fish: a silhouette with no usable interior took the code,
  // shrank it to nothing and ran the title off the body, and said not one word about it. When
  // the stack does not fit, `solve` hangs it from the top of the box and it overflows the
  // bottom — which is exactly this test, and it is checked before anything cosmetic.
  if (s.total > boxTop - boxBottom + 0.01) {
    warnings.push(`The title, the code and the caption need ${round1(s.total)} mm; the shape gives ${round1(Math.max(0, boxTop - boxBottom))}. Make it taller or drop a line.`);
  }
  if (block > 0 && block > boxW + 0.01) {
    warnings.push(`The code and its clear space need ${round1(block)} mm; the plate gives ${round1(boxW)}. Widen the plate or shrink the code.`);
  } else if (askedQr - qrSize > Math.max(1, 0.03 * askedQr)) {
    // Only a shrink worth acting on. The fit is exact, so a payload one version smaller than the
    // last one widens its modules, widens its quiet zone and costs the code a few tenths of a
    // millimetre — which is not news, and a warning line that appears when you switch from Link
    // to Text is just noise on the status line.
    warnings.push(`The code was shrunk to ${round1(qrSize)} mm to fit the plate — make the plate bigger to keep it at ${round1(askedQr)}.`);
  }
  if (border !== 'none' && block > 0) {
    // Against the frame's own inner edge, not the content box: the lettering's gutter is not a
    // scanning rule and must not raise a scanning warning.
    const fTop = spec.plate ? spec.frameTop - stroke : box.maxY - inset - stroke;
    const fBottom = spec.plate ? spec.frameBottom + stroke : box.minY + inset + stroke;
    const fW = bodyW - 2 * (inset + stroke);
    const fArch = spec.plate ? Math.max(0, spec.plate.arch - inset - stroke) : 0;
    const half = Math.min(signPlateHalfWidthAt(s.blockTop, fW, fTop, fArch), signPlateHalfWidthAt(s.blockTop - block, fW, fTop, fArch));
    const inside = block / 2 <= half + 0.01 && s.blockTop <= fTop + 0.01 && s.blockTop - block >= fBottom - 0.01;
    if (!inside) warnings.push("The frame is inside the code's clear space — a scanner needs 4 blank modules all round.");
  }
  if (titleSize < askedTitle * 0.75) warnings.push(`The title was shrunk to ${round1(titleSize)} mm.`);
  if (captionSize < askedCaption * 0.75) warnings.push(`The caption was shrunk to ${round1(captionSize)} mm.`);
  if (s.tb && titleSize < MIN_CAP) warnings.push('Below about 5 mm, thin and script fonts break up when engraved. Pick a bolder face or shorten the title.');
  if (s.cb && captionSize < MIN_CAP) warnings.push('Below about 5 mm, thin and script fonts break up when engraved. Pick a bolder face or raise the size.');
  if (q.kind === 'wifi' && q.ssid.trim() === '') warnings.push('The network name is empty.');

  return { layers, warnings, qr: geometry, qrSize };
}

/** The code, or null when the payload will not fit in one. */
async function tryLayers(q: QrRead, sizeMm: number, invert: boolean, symbols: ReturnType<typeof readSymbols>): Promise<QrLayerResult | null> {
  try {
    return await qrLayers(q, sizeMm, invert, symbols);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the template --

export interface QrConstruction {
  id: string;
  name: string;
  blurb: string;
  tags: string[];
  /** ONE sentence: the assembly step, or for the tag the check that matters more. */
  exportNote: string;
  /** The construction's own controls — its shape, its joint, its keyring. */
  fields: Field[];
  /** The piece the content is composed on. */
  face(v: Values): FaceSpec;
  /** Everything beyond the content: the blank, the extra pieces, the pose, the joint's cuts and
   *  whatever this construction has to warn about. Called with the face and the composed code. */
  assemble(v: Values, face: FaceSpec, content: FaceContent): {
    blank: BuildInput['blank'];
    label?: string;
    keyring: KeyringSpec;
    cuts?: DesignLayer[];
    parts?: PartInput[];
    pose?: Pose;
    warnings?: string[];
  };
  /** The file name's middle part: `qr-<slug>-<title>`. */
  slug: string;
}

export function qrTemplate(c: QrConstruction): TemplateDef {
  return {
    id: c.id,
    name: c.name,
    blurb: c.blurb,
    tags: c.tags,
    fields: c.fields,
    async build(v) {
      const face = c.face(v);
      const content = await composeFace(v, face);
      const rest = c.assemble(v, face, content);
      const layers = [...content.layers, ...(rest.cuts ?? [])];
      const warnings = [...content.warnings, ...(rest.warnings ?? [])];
      const parts = rest.parts ?? [];
      return {
        ...(rest.label ? { label: rest.label } : {}),
        blank: rest.blank,
        keyring: rest.keyring,
        layers,
        ...(rest.pose ? { pose: rest.pose } : {}),
        ...(parts.length ? { parts, status: `${parts.length + 1} pieces` } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    },
    // The payload never goes in the file name: a Wi-Fi password or a private review link inside
    // a file someone forwards is a real leak, and the title is both safer and more useful.
    fileName: (v) => stem('qr', c.slug, (str(v, 'title') || str(v, 'kind')).toLowerCase()),
    exportNote: c.exportNote,
  };
}
