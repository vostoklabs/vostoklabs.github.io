// QR card: a bank-card-sized piece — the code engraved on one half, a thin rule, and an icon on
// the other: a Wi-Fi card.
//
// One piece and no joint, like the QR tag, so everything about the CODE comes from
// `qr-shared.ts` — the payload fields and their samples, `readQr`, `qrLayers`, the four styles,
// Toughness and Invert, `QUIET` — and the module floors from `engine/qr.ts`. This file owns only
// the card and how the two halves share it:
//
//   · The card is ISO/IEC 7810 ID-1, 85.6 × 54 mm: every bank card, so it fits a wallet, a card
//     sleeve and a frame made for one. No size control — a bigger Wi-Fi sign is the QR table
//     tent or the QR stand, and a size that only exists to rescue a long payload is a knob the
//     customer should never have to find.
//   · The code takes the full height. Its quiet zone (4 modules) is bare card, and the zone
//     itself stops EDGE short of the cut, so a charred edge never has to pass for a blank
//     module. At the default Wi-Fi payload (version 4, 33 modules) that is a 50 mm block, a
//     40.2 mm code and a 1.22 mm module: twice the 0.6 mm burn floor, and inside the ~1–3.5 mm
//     band for a code a phone reads off wood.
//   · The rule runs the code's own height, RULE_GAP outside the quiet zone — the reference's
//     line sits just clear of the modules, and a scanner needs the zone empty, not the card.
//     Inverted, the zone is an engraved panel and the rule stands EDGE off it instead.
//   · The icon (the payload's own mark by default — Wi-Fi, a chain link, a speech bubble, a
//     person; any symbol or the customer's own SVG) is sized to the space beside the FULL-height
//     code, so it never outgrows the code, and centred in what is left. "Details" engraves what
//     the code opens under it — the network name and the password for Wi-Fi — for the phone
//     that will not scan. Those lines are set at 3.5 mm of capital in a condensed face, as ONE
//     two-line block so both share a size and a baseline pitch, and the CODE gives way sideways
//     first (never under GIVE_FLOOR of block, never under its style's module floor, and only
//     when that brings the lines to 3 mm); then the lines shrink, and under 3 mm of capital the
//     status line says so.
//   · The corner stops at 5 mm. The block's corner sits EDGE in from both cut edges, which is
//     (r − EDGE)·√2 from the centre of a corner of radius r: at 5 mm that leaves 0.76 mm of card
//     outside the quiet zone's far corner (4 mm: 1.17), more than the burn takes, so no radius
//     the slider offers bites the zone. At the draft's 10 mm the corner cut 1.3 mm into it.
//     (5 mm is 9 % of the short side; ISO's own card corner is 3.18.)
//
// Defaults are the photo: the code on the left, the rule, the Wi-Fi mark, no lettering.
import { bboxOf, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import { iconById } from '@vostok/fonts';
import { QR_MIN_CELL, qrMinSize } from '../engine/qr';
import { sizeForCapHeight } from '../engine/metrics';
import { symbolLayer, textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { readSymbols, type SymbolMap } from '../symbols/model';
import { NO_KEYRING } from './keyring';
import { QUIET, clamp, qrCodeFields, qrContentFields, qrLayers, readQr, type QrRead } from './qr-shared';
import { stem } from './shared';
import { bool, num, str, type Field, type TemplateDef, type Values } from './types';

/** ISO/IEC 7810 ID-1, mm. */
const CARD_W = 85.6;
const CARD_H = 54;
/** Bare card between the cut and the code's quiet zone, mm. The zone is already bare, so this is
 *  only the burn at the edge plus the corner radius's bite at the block's corners. */
const EDGE = 2;
/** Ink — the icon, the lettering — from the cut, mm: `business-card.ts`'s safe zone. */
const MARGIN = 4;
/** The rule: a 0.6 mm engraved line reads as a hairline and still survives the burn (0.3 floor). */
const RULE = 0.6;
/** Between the quiet zone and the rule, mm — so the rule can never touch a blank module. */
const RULE_GAP = 0.5;
/** Between the rule and the icon side's content, mm. */
const PAD = 3;
/** The least block the code gives up to the lettering, mm: 72 % of the full height. There the
 *  default version-4 code is down to a 0.88 mm module; past it the card is a caption with a
 *  code on it. */
const GIVE_FLOOR = 36;
/** No engraved line is set under this cap height without a warning. */
const MIN_CAP = 3;
/** The roundest corner whose bite stays out of the code's quiet zone (see the header). */
const MAX_CORNER = 5;

/**
 * The mark each payload opens on, as Material Symbols ids — its own field per kind, the way the
 * payload has its own fields per kind. One shared field kept the Wi-Fi mark on a contact card
 * ("Alex Rivera" under a Wi-Fi symbol) unless the customer went looking; a single field that
 * followed the kind would have shown the Wi-Fi mark on the right while the card drew a chain.
 */
const KIND_ICONS: { kind: QrRead['kind']; key: string; id: string }[] = [
  { kind: 'wifi', key: 'wifiIcon', id: 'wifi' },
  { kind: 'link', key: 'linkIcon', id: 'link' },
  { kind: 'text', key: 'textIcon', id: 'chat' },
  // 'person', not 'contact_phone': that one, 'account_box' and 'contact_mail' trace without the
  // head, leaving a slab with a half-disc in it.
  { kind: 'contact', key: 'contactIcon', id: 'person' },
];
const iconKey = (kind: QrRead['kind']) => KIND_ICONS.find((i) => i.kind === kind)!.key;

/**
 * Faces for the lettering. Condensed first: "CoffeeHouse-Guest" is 25 mm of Oswald at 3 mm of
 * capital and 41 mm of Montserrat, and every millimetre the line needs is a millimetre the code
 * gives up. A monospace face is on the list for passwords, where an l and a 1 must not look
 * alike — Share Tech Mono, the one narrow enough: JetBrains, Roboto, Fira, DM and IBM Plex Mono
 * all push the sample network name under 3 mm of capital, and so does Montserrat. Every face
 * below letters the sample details with nothing said (`qr-card.test.mjs` builds each).
 */
const FACES = ['oswald', 'barlow-condensed', 'saira-condensed', 'fjalla-one', 'inter', 'share-tech-mono'];

const detailsOn = (v: Values) => bool(v, 'details');

// ------------------------------------------------------------------ the form --

/** The shared payload fields, opening on Wi-Fi: this card's photo is a Wi-Fi card. */
const contentFields = (): Field[] =>
  qrContentFields().map((f) => (f.key === 'kind' ? { ...f, value: 'wifi' } as Field : f));

/** The shared Code category without its two sizes: the card sizes the code itself, and there is
 *  no symbol in THIS code — the icon beside it is the symbol. The Style tooltip's "bigger code"
 *  is a knob this card does not have; what the customer can change here is the payload. */
const codeFields = (): Field[] =>
  qrCodeFields({ key: 'codeSize', value: 40, min: 20, max: 50 })
    .filter((f) => f.key !== 'codeSize' && f.key !== 'symbolSize')
    .map((f) => (f.key === 'codeStyle' ? { ...f, help: 'Dots and rounded need a shorter payload to stay readable.' } : f));

const FIELDS: Field[] = [
  // ------------------------------------------------------------ RIGHT: what you type --
  ...contentFields(),
  ...KIND_ICONS.map(({ kind, key, id }): Field => ({
    kind: 'symbol', key, label: 'Icon', panel: 'right', section: 'Icon', value: iconById(id)?.char ?? '',
    visibleWhen: (v) => str(v, 'kind') === kind,
  })),

  // ------------------------------------------------ LEFT: "Card" (opens first) --
  {
    kind: 'toggle', key: 'details', label: 'Details', section: 'Card', value: false,
    help: 'Engraves the network and password, or the link, under the icon.',
  },
  {
    kind: 'number', key: 'textSize', label: 'Text size', section: 'Card', value: 3.5, min: 3, max: 6, step: 0.5, unit: 'mm',
    help: 'Capital height; the code narrows to make room.',
    visibleWhen: detailsOn,
  },
  {
    kind: 'number', key: 'iconSize', label: 'Icon size', section: 'Card', value: 85, min: 40, max: 100, step: 5, unit: '%',
    help: 'Share of the space beside the code.',
  },
  {
    kind: 'select', key: 'codeSide', label: 'Code side', section: 'Card', value: 'left',
    options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
  },
  { kind: 'toggle', key: 'rule', label: 'Divider', section: 'Card', value: true },
  { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Card', value: 4, min: 0, max: MAX_CORNER, step: 0.5, unit: 'mm' },

  // ------------------------------------------------------------------ LEFT: "Code" --
  ...codeFields(),

  // ------------------------------------------ LEFT: "Font" — only while there is lettering --
  // The cards are lettered with the first line the card will actually carry — the network name —
  // rather than whichever text field comes first (a link, which the picker refuses to letter).
  {
    kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'oswald', recommended: FACES,
    previewText: (v) => detailLines(v, readQr(v))[0] ?? '',
    visibleWhen: detailsOn,
  },
];

// ------------------------------------------------------------------ the pieces --

/**
 * What the code opens, as the lines under the icon.
 *
 * The password is printed as typed — a Wi-Fi card is made to be left out for guests, and the
 * payload already carries it in the clear. An open network prints its name alone. A link drops
 * its scheme and a trailing slash: nobody types the scheme, and the line is what gets typed.
 */
function detailLines(v: Values, q: QrRead): string[] {
  const t = (k: string) => str(v, k).trim();
  const keep = (xs: string[]) => xs.filter((s) => s.trim() !== '');
  if (q.kind === 'wifi') return keep([t('ssid'), str(v, 'security') === 'nopass' ? '' : str(v, 'password')]);
  if (q.kind === 'contact') return keep([t('cName'), t('cPhone') || t('cEmail')]);
  if (q.kind === 'link') return keep([t('link').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '')]);
  return keep([t('plain')]);
}

const widthOf = (layers: DesignLayer[]) => {
  const shapes = layers.flatMap((l) => l.shapes);
  if (!shapes.length) return 0;
  const b = bboxOf(shapes);
  return b.maxX - b.minX;
};

/**
 * The lines at one cap height, as one block centred on the origin.
 *
 * One `textLayer` with a second line at the same scale, not a layer per line: the layout then
 * stacks them at a fixed baseline pitch, so "gypsy" under a network name sits exactly where
 * "latte2026" would. Stacking ink boxes instead moved the second line by its descenders.
 */
async function setDetails(lines: string[], font: string, cap: number, symbols: SymbolMap): Promise<DesignLayer[]> {
  if (!lines.length) return [];
  const size = await sizeForCapHeight(font, cap);
  return textLayer({ text: lines[0]!, line2: lines[1] ?? '', line2Scale: 1, font, size, symbols }, 'engrave', 'details', 'Details');
}

/** Scale islands to fit a w × h box, centred on the origin. */
function fitBox(shapes: Shapes, w: number, h: number): Shapes {
  const b = bboxOf(shapes);
  const k = Math.min(w / Math.max(b.maxX - b.minX, 1e-6), h / Math.max(b.maxY - b.minY, 1e-6));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return shapes.map((isl) => isl.map((r) => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as [number, number])));
}

/** What the status line says while the payload is still empty. */
const EMPTY: Record<QrRead['kind'], string> = {
  wifi: 'Type the network name and the code appears.',
  link: 'Type a link and the code appears.',
  text: 'Type some text and the code appears.',
  contact: 'Type a name or a number and the code appears.',
};

// ------------------------------------------------------------------ the template --

export const qrCard: TemplateDef = {
  id: 'qr-card',
  name: 'QR card',
  blurb: 'Your Wi-Fi code on one half, an icon on the other.',
  tags: ['qr', 'card', 'engrave + cut'],
  exportNote: 'Scan the code off the screen with your phone before cutting.',
  fields: FIELDS,

  async build(v) {
    const q = readQr(v);
    const symbols = readSymbols(v);
    const warnings: string[] = [];
    // Everything is laid out with the code on the LEFT; `s` mirrors the placements, never the
    // artwork, so a code on the right still reads and the icon is not turned round.
    const s = str(v, 'codeSide') === 'right' ? -1 : 1;
    const corner = clamp(num(v, 'corner'), 0, MAX_CORNER);
    const full = CARD_H - 2 * EDGE;

    // The payload's module count decides how far the code may give way: never under the block
    // at which its modules hit the style's burn floor.
    let modules = 0;
    if (q.typed) {
      try { modules = qrMinSize(q.content, q.level, 1); } catch { modules = 0; }
    }
    const span = modules + 2 * QUIET;
    const floorCell = QR_MIN_CELL[q.style];
    const least = modules ? Math.min(full, Math.max(GIVE_FLOOR, span * floorCell)) : full;

    // ------------------------------------------------------------ the lettering --
    // Width is linear in the size (to a hair, see below), so both fits are one step, not a search.
    const lines = detailsOn(v) ? detailLines(v, q) : [];
    const font = str(v, 'font') || 'oswald';
    const asked = clamp(num(v, 'textSize'), 1, 20);
    // Inverted, the quiet zone is an engraved panel; the rule then stands EDGE off it, as the
    // panel stands EDGE off the cut, rather than merging with the panel's edge in the burn.
    const gap = bool(v, 'invert') ? EDGE : RULE_GAP;
    const room = (block: number) => CARD_W - EDGE - block - gap - RULE - PAD - MARGIN;
    let cap = asked;
    let set = await setDetails(lines, font, cap, symbols);
    const need = widthOf(set);
    let block = full;
    // The code gives way only to lettering it rescues. When the lines would still be under
    // MIN_CAP at the narrowest block, the code keeps its full height and the status line speaks:
    // a 36 mm code beside a 1.4 mm link is worse on both counts than a 50 mm one.
    const rescued = (asked * room(least)) / need >= MIN_CAP - 1e-6;
    if (need > room(full) && rescued) block = Math.max(least, full - (need - room(full)));
    // Aimed a hundredth under the room: flattened curves make the ink's width only nearly linear
    // in its size, and "nearly" put a 32-character name 0.0005 mm over the margin.
    if (need > room(block) + 1e-6) {
      cap = (asked * (room(block) - 0.01)) / need;
      set = await setDetails(lines, font, cap, symbols);
    }
    if (set.length && cap < MIN_CAP - 1e-6) warnings.push('Details too long to read — shorten them or turn Details off.');

    // ------------------------------------------------------------ the code --
    // `qrLayers` hands back the code centred on the origin and the block it needs with its quiet
    // zone; asking for `block × modules / span` makes that block exactly the one planned here.
    const codeSize = modules ? (block * modules) / span : 0;
    let code: Awaited<ReturnType<typeof qrLayers>> | null = null;
    if (modules) {
      try { code = await qrLayers(q, codeSize, bool(v, 'invert'), symbols); } catch { code = null; }
    }
    const blockX = s * (-CARD_W / 2 + EDGE + block / 2);
    const layers: DesignLayer[] = [];

    // ------------------------------------------------------------ the rule --
    // The code's own height, so the line starts and stops level with the finder patterns.
    const ruleX = s * (-CARD_W / 2 + EDGE + block + gap + RULE / 2);
    if (bool(v, 'rule')) {
      const len = code ? codeSize : 0.8 * full;
      layers.push({ id: 'rule', label: 'Divider', kind: 'rule', shapes: placeShapes([[roundedRectRing(RULE, len, RULE / 2, 4)]], ruleX, 0, 0), op: 'engrave' });
    }
    if (code) {
      for (const l of code.layers) {
        layers.push({ ...l, shapes: placeShapes(l.shapes, blockX, 0, 0), ...(l.minus ? { minus: placeShapes(l.minus, blockX, 0, 0) } : {}) });
      }
    }

    // ------------------------------------------------------------ the icon side --
    // The free box beside the rule, MARGIN clear of the three cut edges round it. The icon is
    // SIZED against the box beside the full-height code and only centred in the one the code
    // actually leaves: the width the code gives up is the lettering's. Sized to the wider box,
    // the icon grew as the code shrank and at Text size 6 was bigger than the code.
    const beside = (b: number) => -CARD_W / 2 + EDGE + b + gap + RULE + PAD;
    const inner = beside(block);
    const outer = CARD_W / 2 - MARGIN;
    const iconW = outer - beside(full);
    const boxH = CARD_H - 2 * MARGIN;
    const cx = s * (inner + outer) / 2;
    const textShapes = set.flatMap((l) => l.shapes);
    const textBox = textShapes.length ? bboxOf(textShapes) : null;
    const textH = textBox ? textBox.maxY - textBox.minY : 0;
    const iconGap = textH > 0 ? Math.max(2.5, 0.9 * cap) : 0;
    const k = clamp(num(v, 'iconSize'), 10, 100) / 100;
    const iconChar = str(v, iconKey(q.kind));
    const raw = iconChar ? await symbolLayer(iconChar, 10, 'engrave', { symbols }, 'icon') : [];
    const iconShapes = raw[0]?.shapes.length ? fitBox(raw[0].shapes, k * iconW, Math.max(0, k * (boxH - textH - iconGap))) : [];
    const iconH = iconShapes.length ? bboxOf(iconShapes).maxY - bboxOf(iconShapes).minY : 0;

    // One stack — icon, then the lines — centred on the card's mid-height, which is also the
    // code's: the icon sits level with the code the way the photo has it.
    const total = iconH + (iconH > 0 ? iconGap : 0) + textH;
    let top = total / 2;
    if (iconShapes.length) {
      layers.push({ ...raw[0]!, label: 'Icon', shapes: placeShapes(iconShapes, cx, top - iconH / 2, 0) });
      top -= iconH + iconGap;
    }
    if (textBox) {
      const dx = cx - (textBox.minX + textBox.maxX) / 2;
      const dy = top - textH / 2 - (textBox.minY + textBox.maxY) / 2;
      layers.push({ ...set[0]!, shapes: placeShapes(textShapes, dx, dy, 0) });
    }

    // ------------------------------------------------------------ what to say --
    if (!q.typed) warnings.unshift(EMPTY[q.kind]);
    else if (!code) warnings.unshift('Too much text for one QR code — shorten it or lower the toughness.');
    else if (code.geometry.cell < floorCell - 1e-9) {
      const fix = q.style === 'square' ? 'lower the toughness or shorten it' : 'pick the Square style or lower the toughness';
      warnings.unshift(`Modules are ${code.geometry.cell.toFixed(2)} mm — too fine to engrave; ${fix}.`);
    }
    if (q.kind === 'wifi' && q.typed && q.ssid.trim() === '') warnings.push('The network name is empty.');

    return {
      blank: { kind: 'shape', shapes: [[roundedRectRing(CARD_W, CARD_H, corner, 12)]] },
      // A card lies on a table or in a wallet; it hangs from nothing.
      keyring: NO_KEYRING,
      layers,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // The payload never goes in the file name: a Wi-Fi password in a forwarded file is a leak.
  fileName: (v) => stem('qr-card', readQr(v).kind),
};
