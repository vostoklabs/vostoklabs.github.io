// A template turned into a design: the context every template draws with (lettering, the QR code,
// the logo or the initials, the pattern, the tap mark, the colours), and the one function that runs
// a template's front and back and hands the worker a design.
import { roundedRectRing, type Box, type Pt, type Ring, type Shapes } from '@vostok/shapes';
import { qrPayload, type QrFields } from '@vostok/qr';
import { contrastRatio, luminance } from '@vostok/ui-kit';
import { raiseOf, type CardSettings, type IconStyle, type Place, type QrStyleChoice } from '../state';
import { BORDER, POCKET_WALL, boxH, boxW, cardRing, cardSize, mirrorPt, mirrorShapes } from './layout';
import { fitLockup, letteringWarnings, FLOORS, type ContactRole, type Lettering, type LockupSlot, type LockupText } from './lockup';
import { fillPattern, type PatternOpts } from './pattern';
import { placeQr, qrContent, qrFloor, qrNeed, type PlacedQr, type QrMiss } from './qr';
import { MIN_STROKE, applyCase, growFor, scaleMove, unitLine, type Faces, type TextCase } from './text';
import { emptyFace, type Design, type Face, type Ink, type PatternPart, type Role } from './types';
import { qrBack } from './templates/common';

/** The two families of contact icons: the plain glyphs, and a more modern set (a smartphone, an @
 *  and a link). Each can stand alone or sit knocked out of a badge. */
export type IconFamily = 'classic' | 'modern';
export const ICON_IDS: Record<IconFamily, Record<ContactRole, string>> = {
  classic: { phone: 'material:call', email: 'material:mail', web: 'material:globe' },
  modern: { phone: 'material:smartphone', email: 'material:alternate_email', web: 'material:link' },
};

/** What the build needs that is loaded rather than computed: the faces, the contact icons of both
 *  families, and the tap mark. All in the symbol frame (centred, longest side 1). */
export interface Assets {
  faces: Faces;
  icons: Record<IconFamily, Partial<Record<ContactRole, Shapes>>>;
  tap?: Shapes;
}

/** What one side of a card draws. */
export interface Side {
  fields?: Shapes;
  /** Thin lines of card left open inside the fields. */
  gaps?: Shapes;
  ink?: Ink[];
  pattern?: PatternPart | null;
  /** Carved into the face. */
  carved?: Shapes;
  /** Front only: holes through the card, in the front's frame. */
  cutouts?: Shapes;
  /** Front only: where an NFC tag fits, in the front's frame (default: the middle). */
  pocket?: Pt;
  /** Front only: the card under the face's top layers prints in the shapes' colour, so what is
   *  carved into the front shows it. */
  reveal?: boolean;
}

/** What a piece sits on, for the colours that read best there. */
export type On = 'card' | 'shapes';

export interface Ctx {
  s: CardSettings;
  /** The card as this side reads, mm. */
  w: number;
  h: number;
  outline: Ring;
  side: 'front' | 'back';
  /** The card has a back, printed in the same go. */
  twoSided: boolean;
  /** The card has a QR code: one is wanted and has something to say. */
  qrOn: boolean;
  /** The card has a mark: the logo (or its placeholder) or the initials. */
  hasMark: boolean;
  /** This face carries the QR code: a one-sided card's front, else the face the customer chose
   *  (or the template's own, when its design fixes it). */
  qrHere: boolean;
  /** This face carries the mark: a one-sided card's front, else the face the customer chose. A
   *  template whose design is the mark (a logo tile) draws it from `hasMark` instead. */
  markHere: boolean;
  /** The lines this face sets: on a front the company is left out when the back says it, and a
   *  back's company line is what the back says (the company, the customer's name, or nothing). */
  text: LockupText;
  /** A piece's colour, by what it sits on. */
  colour(paint: Role, on?: On): string;
  /** The lettering fitted into slots; its warnings join the card's. */
  lettering(slots: LockupSlot[], o?: { rule?: boolean; icons?: boolean; nameCase?: TextCase }): Lettering;
  /** The QR code, as big as the box allows; null (and a warning when it cannot scan) otherwise.
   *  `quiet` is the clear modules round it inside the box (default `QR_QUIET`). */
  qr(box: Box, on?: On, quiet?: number): PlacedQr | null;
  /** The square this side's QR needs at its floor, mm (0 when there is none). */
  qrNeed(quiet?: number): number;
  /** The mark (the logo, its placeholder, or the initials) fitted and centred in `box`. */
  mark(box: Box, o?: { on?: On }): Ink | null;
  /** One line (the company on a back) set as large as `cap` and fitted to the box's width, never
   *  under the details' floor; null when blank or when it cannot fit at the floor. */
  label(text: string, box: Box, o: { cap: number; on?: On; align?: 'left' | 'centre' | 'right'; upper?: boolean; paint?: Role }): Ink | null;
  /** How wide a line is per millimetre of its cap height (0 when blank). */
  measure(text: string, upper?: boolean): number;
  /** The template's pattern area filled with the chosen pattern. */
  pattern(region: Shapes, o: PatternOpts & { on?: On }): Promise<PatternPart | null>;
  /** The contactless tap mark, fitted and centred in `box`. */
  tap(box: Box, on?: On): Ink | null;
  /** The name's initials. */
  initials(): string;
  warn(message: string): void;
  note(message: string): void;
}

/** The groups the template menu shows, in the customer's words. */
export type TemplateGroup = 'clean' | 'shapes' | 'patterns' | 'qr';

export interface Template {
  id: string;
  name: string;
  /** Its group in the template menu, and the line under its picture there. */
  group: TemplateGroup;
  line: string;
  /** Reads upright: the card's long side runs up the page. */
  portrait?: boolean;
  /** The pattern the template opens with, when it has a pattern area. */
  pattern?: { value: string; zoom?: number; mode?: 'colour' | 'carved' | 'cut' };
  /** The NFC pocket is part of the design (a tap card): built whether or not the NFC switch is on. */
  nfc?: boolean;
  /** The face the QR code is on whatever the customer chose, when the design is built round it. */
  qrSide?: Place;
  /** The mark is part of the design on both faces, so where the logo goes is not the customer's. */
  markFixed?: boolean;
  front(ctx: Ctx): Promise<Side>;
  /** Drawn as seen from behind (x to the right when the back faces you). */
  back(ctx: Ctx): Promise<Side>;
}

/** NFC tags a pocket is made for: diameter and the pocket's depth, mm. */
export const NFC_TAGS: Record<string, { dia: number; depth: number; label: string }> = {
  '25': { dia: 25, depth: 0.4, label: '25 mm sticker' },
  '30': { dia: 30, depth: 0.4, label: '30 mm sticker' },
  '25c': { dia: 25, depth: 1.0, label: '25 mm coin' },
};
/** Air round a tag in its pocket, mm. */
const TAG_CLEARANCE = 0.3;
/** The extra letter spacing a label set in capitals gets, a share of its size. */
const LABEL_TRACK = 0.06;
/** The least contrast a QR code is printed with: under this, phones struggle to tell the modules. */
const QR_CONTRAST = 3;
/** How much bigger a Large code is asked for than the smallest that scans well. */
export const QR_LARGE = 1.3;
/** A Large code whose modules come out under this many times the floor has not grown to speak of. */
const LARGE_SEEN = 1.1;

/** The printed tap mark's size, mm, and the clear space kept round it. */
const TAP_SIZE = 9;
const TAP_CLEAR = 1.5;

/** The spacing of the places a pocket is tried at when the template's own will not do, mm. */
const SPOT_STEP = 2.5;
/** Room round a tap mark past its clear space beyond which more does not look any better, mm. */
const ROOM_ENOUGH = 4;

/** Every place a pocket of radius `r` can take on the card, its border kept, nearest `from` first. */
function gridSpots(w: number, h: number, r: number, from: Pt): Pt[] {
  const mx = w / 2 - r - BORDER / 2;
  const my = h / 2 - r - BORDER / 2;
  if (mx < 0 || my < 0) return [];
  const spots: Pt[] = [];
  const nx = Math.ceil(mx / SPOT_STEP);
  const ny = Math.ceil(my / SPOT_STEP);
  for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) spots.push([(mx * i) / nx || 0, (my * j) / ny || 0]);
  return spots.sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1]));
}

/** A code's content and, for a contact card, the details it saves beyond the name, phone and email. */
interface QrText {
  text: string;
  saves: string[];
  /** The email left out too: only the name and the phone. */
  noEmail?: boolean;
}

/**
 * The contact cards a QR code can carry, the richest first: the name, phone and email always,
 * then the company, the website and the title while the room allows (a vCard is three times a
 * link's size, and each detail left out can be a whole QR version). The phone keeps its digits
 * and the website loses its scheme: a phone reads both, and every byte counts here.
 */
function contactCards(s: CardSettings): QrText[] {
  const extras: [keyof QrFields, string, string][] = [
    ['org', s.company.trim(), 'company'],
    ['url', s.website.trim().replace(/^https?:\/\//i, ''), 'website'],
    ['title', s.title.trim(), 'title'],
  ];
  const base: QrFields = { name: s.name, phone: s.phone.replace(/[^\d+]/g, ''), email: s.email };
  const cards: QrText[] = [];
  for (let k = extras.length; k >= 0; k--) {
    const kept = extras.slice(0, k).filter(([, v]) => v);
    const text = qrPayload('contact', { ...base, ...Object.fromEntries(kept.map(([key, v]) => [key, v])) });
    if (!cards.some((c) => c.text === text)) cards.push({ text, saves: kept.map(([, , word]) => word) });
  }
  // Last, the name and the phone alone (the email gives way when there is a phone to call).
  if (base.phone && base.email?.trim()) {
    const text = qrPayload('contact', { name: s.name, phone: base.phone });
    if (!cards.some((c) => c.text === text)) cards.push({ text, saves: [], noEmail: true });
  }
  return cards;
}

/** "a, b and c". */
const listed = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** What a contact card's code saves to a phone, and what the room left out. */
function contactSentence(said: QrText, most: QrText): string {
  const saves = listed(['name', 'phone', ...(said.noEmail ? [] : ['email']), ...said.saves]);
  const left = [...(said.noEmail ? ['email'] : []), ...most.saves.filter((w) => !said.saves.includes(w))];
  return `QR saves your ${saves}${left.length ? `; no room for your ${listed(left)}` : ''}`;
}

/** Why a code could not be placed, in words that fit the card it is on. */
function qrMissSentence(miss: QrMiss, s: CardSettings): string {
  if (miss === 'room') return s.twoSided ? 'There is no room for a QR code that scans here. Try another template.' : 'There is no room for a QR code that scans on this side. Print the back too, or try another template.';
  if (s.qrKind === 'contact') return 'Your contact card needs more room than this template gives the QR code. Try Scan back, or let the code open your website.';
  return s.twoSided ? 'The QR link is too long for the room the template gives it. Shorten it.' : 'The QR link is too long for the room on this side. Shorten it, or print the back too.';
}

/** The filaments' names, in palette order (card, lettering, accent), for what the QR panel says. */
const FILAMENT_NAMES = ['card', 'lettering', 'accent'] as const;
/** What the QR panel says when the code moved or was left out, or took the back. */
export const QR_MOVED = 'The QR code moved to the back: no room for it on the front of this template';
export const QR_LEFT_OUT = 'No QR code: no room for it';
export const QR_TAKES_BACK = 'The QR code takes the back: the template\'s own back has no room for it';

/**
 * The tile under a code whose colour would not scan on the face, in the filament that reads best
 * against it, so the code reads dark on light either way: under dark modules a light tile round
 * them; under a light code (a tile in the code's colour with its modules open) the dark modules
 * themselves. Never over the code: the two never share a point.
 */
function backingOf(q: PlacedQr, hex: string, lighter: boolean): Ink {
  if (lighter) return { role: 'qr', colour: hex, shapes: q.ink.minus ?? [] };
  const full = q.box.maxX - q.box.minX;
  const ring = roundedRectRing(full, full, q.module, 6, [(q.box.minX + q.box.maxX) / 2, (q.box.minY + q.box.maxY) / 2]);
  return { role: 'qr', colour: hex, shapes: [[ring]], minus: q.ink.shapes };
}

/** What a QR in a colour too close to its background says. */
const QR_COLOUR_WARNING = 'The QR code\'s colour is too close to what it sits on to scan.';

/**
 * Whether a QR code's square (quiet zone included) is not clean on its face: another piece of ink,
 * a pattern or carving reaches into it, or it lies across the edge of the colour fields, part on
 * them and part off, where a phone would not read it.
 */
function qrClash(face: Side, box: Box): boolean {
  const e = 0.05;
  const into = (b: Box) => b.maxX > box.minX + e && b.minX < box.maxX - e && b.maxY > box.minY + e && b.minY < box.maxY - e;
  const inner: Box = { minX: box.minX + e, maxX: box.maxX - e, minY: box.minY + e, maxY: box.maxY - e };
  const samples: Pt[] = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) samples.push([box.minX + ((box.maxX - box.minX) * i) / 4, box.minY + ((box.maxY - box.minY) * j) / 4]);
  // Lettering, icons, the mark, a pattern, carving or a hole: none of what they cover inside the
  // square (measured as area, as a frame's or a lattice's box spans whatever it rings, and a cell
  // the engine clipped is a whole cell less a hole).
  const p = face.pattern;
  const areas: Shapes = [
    ...(face.ink ?? []).filter((i) => i.role !== 'qr').flatMap((i) => i.shapes),
    ...(face.carved ?? []),
    ...(face.cutouts ?? []),
    ...(p ? (p.mode === 'cut' && p.lattice ? p.lattice.region : p.shapes) : []),
  ];
  if (areas.some((island) => into(boundsOf([island])) && areaInBox(island, inner) > 0.01)) return true;
  // The colour fields: the square all on them or all off them.
  const fields = face.fields ?? [];
  if (!fields.length) return false;
  const gaps = face.gaps ?? [];
  const on = (q: Pt) => distanceTo(q, fields) === 0 && !(gaps.length && distanceTo(q, gaps) === 0);
  const first = on(samples[0]!);
  return samples.some((q) => on(q) !== first);
}

/** The area of a ring inside an upright box (the ring clipped to it, Sutherland-Hodgman), mm². */
function ringAreaInBox(ring: Ring, b: Box): number {
  let pts: Pt[] = ring;
  const sides: [(p: Pt) => boolean, (p: Pt, q: Pt) => Pt][] = [
    [(p) => p[0] >= b.minX, (p, q) => [b.minX, p[1] + ((q[1] - p[1]) * (b.minX - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= b.maxX, (p, q) => [b.maxX, p[1] + ((q[1] - p[1]) * (b.maxX - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= b.minY, (p, q) => [p[0] + ((q[0] - p[0]) * (b.minY - p[1])) / (q[1] - p[1]), b.minY]],
    [(p) => p[1] <= b.maxY, (p, q) => [p[0] + ((q[0] - p[0]) * (b.maxY - p[1])) / (q[1] - p[1]), b.maxY]],
  ];
  for (const [keep, cut] of sides) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      if (keep(p)) out.push(p);
      if (keep(p) !== keep(q)) out.push(cut(p, q));
    }
    pts = out;
    if (!pts.length) return 0;
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i]![0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * pts[i]![1];
  return Math.abs(a / 2);
}

/** What an island (its biggest ring the outline, the others holes) covers inside a box, mm². */
function areaInBox(island: Ring[], b: Box): number {
  const whole = island.map((r) => ringAreaInBox(r, { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 }));
  const outer = whole.indexOf(Math.max(...whole));
  return island.reduce((sum, r, i) => sum + (i === outer ? 1 : -1) * ringAreaInBox(r, b), 0);
}

/** How far `p` lies from `shapes`, mm: 0 inside them. */
function distanceTo([x, y]: Pt, shapes: Shapes): number {
  let d2 = Infinity;
  for (const island of shapes) {
    let inside = false;
    for (const ring of island) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        const dx = xi - xj;
        const dy = yi - yj;
        const t = Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / (dx * dx + dy * dy || 1)));
        d2 = Math.min(d2, (xj + t * dx - x) ** 2 + (yj + t * dy - y) ** 2);
      }
    }
    if (inside) return 0;
  }
  return Math.sqrt(d2);
}

/**
 * Where a mark `size` across clears every ink island's box on the face and keeps off `areas` (the
 * fields, carving and pattern it would be lost on), and a pocket of radius `r` under it stays clear
 * of every hole through the card: the first spot when it is clear (the template's own, or where
 * the customer dragged the tag), else of the rest the one with the most room round the mark, up to
 * `ROOM_ENOUGH`, nearest the first on a tie; or with `nearest`, simply the nearest clear one.
 * Without ink or areas only the holes count.
 */
function clearSpot(ink: Ink[], areas: Shapes, holes: Shapes, spots: Pt[], size: number, r: number, nearest = false): Pt | null {
  const boxes = ink.flatMap((i) => i.shapes.map((island) => boundsOf([island])));
  const half = size / 2 + TAP_CLEAR;
  const reach = r + POCKET_WALL;
  // How far the mark's square at a spot stands off the nearest ink box, and the mark off the
  // nearest area: clear at 0 or more.
  const room = (p: Pt) => {
    const free = boxes.reduce((m, b) => Math.min(m, Math.max(b.minX - p[0], p[0] - b.maxX, b.minY - p[1], p[1] - b.maxY) - half), Infinity);
    return free < 0 || !areas.length ? free : Math.min(free, distanceTo(p, areas) - size / 2 - TAP_CLEAR / 2);
  };
  const [first, ...rest] = spots;
  if (!first) return null;
  if (room(first) >= 0 && distanceTo(first, holes) >= reach) return first;
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (const p of rest) {
    const free = room(p);
    if (free < 0) continue;
    // Dragged there, the nearest clear place wins; placed by the template, the roomiest.
    const score = nearest ? -Math.hypot(p[0] - first[0], p[1] - first[1]) : Math.min(free, ROOM_ENOUGH) - 0.02 * Math.hypot(p[0] - first[0], p[1] - first[1]);
    if (score > bestScore && distanceTo(p, holes) >= reach) [best, bestScore] = [p, score];
  }
  return best;
}

/** The name's initials: the first letter of the first and of the last word. */
export function initialsOf(name: string): string {
  const firsts = name.trim().split(/\s+/).map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '').filter(Boolean);
  return (firsts.length > 1 ? firsts[0]! + firsts[firsts.length - 1]! : firsts[0] ?? '').toLocaleUpperCase();
}

function boundsOf(shapes: Shapes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of shapes.flat(2)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, maxX, minY, maxY };
}

/** Shapes scaled to fit `box`, keeping their proportions, centred in it. */
export function fitInto(shapes: Shapes, box: Box): Shapes {
  if (!shapes.length) return [];
  const b = boundsOf(shapes);
  const k = Math.min(boxW(box) / Math.max(1e-9, b.maxX - b.minX), boxH(box) / Math.max(1e-9, b.maxY - b.minY));
  return scaleMove(shapes, k, (box.minX + box.maxX) / 2 - ((b.minX + b.maxX) / 2) * k, (box.minY + box.maxY) / 2 - ((b.minY + b.maxY) / 2) * k);
}

/** A circle, anticlockwise. */
const circle = (r: number, seg = 96): Ring => Array.from({ length: seg }, (_, i): [number, number] => [r * Math.cos((2 * Math.PI * i) / seg), r * Math.sin((2 * Math.PI * i) / seg)]);

/**
 * The placeholder a template shows where the logo goes until one is brought in: the word LOGO in
 * a ring, in the symbol frame. Plainly a placeholder, so nobody prints it by mistake for long.
 */
function placeholderLogo(faces: Faces): Shapes {
  const word = unitLine(faces, 'LOGO', 0.12);
  const ring: Shapes = [[circle(0.5), circle(0.44).reverse()]];
  if (!word) return ring;
  const w = word.box.maxX - word.box.minX;
  const k = 0.56 / Math.max(1e-9, w);
  const cx = (word.box.minX + word.box.maxX) / 2;
  const cy = (word.box.minY + word.box.maxY) / 2;
  return [...ring, ...scaleMove(word.shapes, k, -cx * k, -cy * k)];
}

const iconFamily = (style: IconStyle): IconFamily => (style.startsWith('modern') ? 'modern' : 'classic');
const iconBadge = (style: IconStyle): 'circle' | 'square' | null => (style.endsWith('-circle') ? 'circle' : style.endsWith('-square') ? 'square' : null);

/** The design of the card the settings describe, drawn by the chosen template. */
export async function buildDesign(asked: CardSettings, assets: Assets, template: Template): Promise<Design> {
  // The raise as built: none when the lettering lies flat, whatever the slider says.
  const s: CardSettings = { ...asked, raise: raiseOf(asked) };
  const { w, h } = cardSize(s.size, template.portrait);
  const outline = cardRing(w, h, s.corner);
  const warnings: string[] = [];
  const notes: string[] = [];
  const finish = s.raise > 1e-6 ? 'raised' : 'flush';
  const text: LockupText = { name: s.name, title: s.title, company: s.company, phone: s.phone, email: s.email, web: s.website };
  // What the code can say, the most first: a link is one; a contact card is the richest that fits
  // the room (see `contactCards`).
  const qrTexts: QrText[] = s.qrKind === 'contact' ? contactCards(s) : [{ text: qrContent(s.qrKind === 'link' ? s.qrLink : s.website), saves: [] }];
  const qrText = qrTexts[0]!.text;

  // The colours: the three filaments, each piece in one of them unless it was given its own.
  const palette = [s.cardColor, s.inkColor, s.accentColor];
  const cardColour = s.colors.card ?? s.cardColor;
  const fieldColour = s.colors.shapes ?? s.accentColor;
  const base: Record<Role, string> = {
    card: cardColour, shapes: fieldColour, name: s.inkColor, details: s.inkColor, icons: s.accentColor,
    rule: s.accentColor, logo: s.accentColor, qr: s.inkColor, pattern: s.accentColor,
  };
  /** Of the filaments, the one that reads best on `bg`. */
  const bestOn = (bg: string) => palette.reduce((best, c) => (contrastRatio(c, bg) > contrastRatio(best, bg) ? c : best));
  const colour = (paint: Role, on: On = 'card'): string => {
    const set = s.colors[paint];
    if (set) return set;
    const bg = on === 'shapes' ? fieldColour : cardColour;
    // A QR code, and anything set on the colour fields, takes the filament that reads best there
    // unless its own does well enough.
    if (paint === 'qr') return bestOn(bg);
    if (on === 'shapes' && paint !== 'shapes' && paint !== 'card' && contrastRatio(base[paint], bg) < 3) return bestOn(bg);
    return base[paint];
  };

  /** Every QR code placed, as the side's own drawing has it, and what it says; and the tiles laid
   *  under codes whose colour would not scan on the face. */
  const placed: { side: 'front' | 'back'; box: Box; said?: QrText }[] = [];
  const backings: { side: 'front' | 'back'; ink: Ink }[] = [];
  const qrFace: Place = template.qrSide ?? s.qrPlace;
  const markFace: Place = template.markFixed ? 'back' : s.logoPlace;
  const ctxFor = (side: 'front' | 'back', o: { qrHere?: boolean; qrPlain?: boolean } = {}): Ctx => {
    // A plain code: no dots (a dot needs a bigger module than a square) and no logo in its middle,
    // the smallest code that says the same, for a face that could not lay out the one asked for.
    const qrStyle: QrStyleChoice = o.qrPlain && s.qrStyle === 'dots' ? 'square' : s.qrStyle;
    const qrLogo = !o.qrPlain && s.qrLogo;
    const sideText: LockupText = side === 'front'
      ? { ...text, company: s.twoSided && s.backText === 'company' ? '' : text.company }
      : { ...text, company: s.backText === 'company' ? text.company : s.backText === 'name' ? text.name : '' };
    const here = (face: Place) => (side === 'front' ? !s.twoSided || face === 'front' : s.twoSided && face === 'back');
    // How this side's ink is made: raised only on a raised card's front; a back is always laid
    // into the face, so it keeps the flat face's floors whatever the finish.
    const made = side === 'front' && finish === 'raised' ? 'raised' : 'flat';
    const floors = FLOORS[made === 'raised' ? 'raised' : 'flush'];
    const minStroke = MIN_STROKE[made === 'raised' ? 'raised' : 'flush'];
    const markShapes = (): Shapes | null => {
      if (s.logoMode === 'none') return null;
      if (s.logoMode === 'logo') return s.logo?.shapes.length ? s.logo.shapes : placeholderLogo(assets.faces);
      const initials = initialsOf(s.name);
      return initials ? unitLine(assets.faces, initials, 0.04)?.shapes ?? null : null;
    };
    const ctx: Ctx = {
      s,
      w,
      h,
      outline,
      side,
      twoSided: s.twoSided,
      qrOn: s.qr && !!qrText,
      hasMark: s.logoMode !== 'none',
      qrHere: s.qr && !!qrText && (o.qrHere ?? here(qrFace)),
      markHere: s.logoMode !== 'none' && here(markFace),
      text: sideText,
      colour,
      lettering(slots, o = {}) {
        const fit = (icons: boolean, t: LockupText = sideText, s2: LockupSlot[] = slots) => fitLockup(assets.faces, t, {
          nameCap: s.nameSize,
          detailCap: s.detailSize,
          nameCase: o.nameCase ?? s.nameCase,
          tracking: s.letterSpacing / 100,
          minStroke,
          floors,
          rule: o.rule ?? true,
          icons: icons && s.iconStyle !== 'none' ? assets.icons[iconFamily(s.iconStyle)] : null,
          badge: iconBadge(s.iconStyle),
          logo: null,
          colourOf: colour,
        }, s2);
        let l = fit(o.icons !== false);
        // Out of height with a title and a company: one line of the two, "Designer · Studio".
        if (l.overflow?.axis === 'height' && sideText.title.trim() && sideText.company.trim() && slots.some((sl) => sl.roles.includes('company') && sl.roles.includes('title'))) {
          const merged: LockupText = { ...sideText, title: `${sideText.title.trim()} · ${sideText.company.trim()}`, company: '' };
          const one = fit(o.icons !== false, merged, slots.map((sl) => ({ ...sl, roles: sl.roles.filter((r) => r !== 'company') })));
          if (!one.overflow) l = one;
        }
        // The icons go before a contact line is refused: they cost a line its width of seven
        // millimetres, and the line itself is what the card is for.
        const role = l.overflow?.role;
        if (o.icons !== false && l.overflow?.axis === 'width' && (role === 'phone' || role === 'email' || role === 'web')) {
          const plain = fit(false, l.text, l.slots);
          if (!plain.overflow) l = plain;
        }
        warnings.push(...letteringWarnings(l));
        return l;
      },
      qr(box, on = 'card', quiet) {
        const c = colour('qr', on);
        const bg = on === 'shapes' ? fieldColour : cardColour;
        // A code in a colour too close to what it sits on stands on a tile of the filament that
        // reads best against it: the colour chosen is kept, and the code still scans.
        const tile = contrastRatio(c, bg) >= QR_CONTRAST ? null : FILAMENT_NAMES.map((name, i) => ({ name, hex: palette[i]! })).sort((a, b) => contrastRatio(b.hex, c) - contrastRatio(a.hex, c))[0]!;
        if (tile && contrastRatio(tile.hex, c) < QR_CONTRAST) {
          warnings.push(`${QR_COLOUR_WARNING} Pick a darker or lighter one in Colors.`);
          return null;
        }
        const lighter = luminance(c) > luminance(tile?.hex ?? bg);
        const logo = qrLogo ? markShapes() : null;
        // The richest the room holds, what the code says before how it looks: for each contact
        // card, from the whole to the name and phone alone, dots give way to square modules (a dot
        // needs a bigger module) and a logo in the middle to none.
        const styles: QrStyleChoice[] = qrStyle === 'dots' ? ['dots', 'square'] : [qrStyle];
        const logos = logo?.length ? [logo, null] : [null];
        let r: ReturnType<typeof placeQr> = { qr: null };
        let said = qrTexts[0]!;
        let style = styles[0]!;
        let withLogo = false;
        search: for (const t of qrTexts) {
          for (const st of styles) {
            for (const lg of logos) {
              r = placeQr({ content: t.text, box, style: st, face: made, lighter, colour: c, ...(lg ? { logo: lg } : {}), ...(quiet !== undefined ? { quiet } : {}) });
              [said, style, withLogo] = [t, st, !!lg];
              if (r.qr) break search;
            }
          }
        }
        if (!r.qr) {
          if (r.miss) warnings.push(qrMissSentence(r.miss, s));
          else if (r.warning) warnings.push(r.warning);
          return null;
        }
        notes.push(`QR ${r.qr.module.toFixed(2)} mm modules`);
        if (s.qrKind === 'contact') notes.push(contactSentence(said, qrTexts[0]!));
        if (style !== s.qrStyle) notes.push('The code is in square modules: dots need more room than this template gives it');
        if (s.qrLogo && s.logoMode !== 'none' && !withLogo) notes.push('The code has no logo in its middle: no room for it here');
        if (tile) notes.push(`The code stands on a tile in your ${tile.name} colour, so it scans`);
        placed.push({ side, box: r.qr.box, said });
        if (tile) backings.push({ side, ink: backingOf(r.qr, tile.hex, lighter) });
        // Large asked for, and the template's room held the code at its smallest: said, so the
        // setting is not taken for doing nothing.
        if (s.qrSize === 'large' && r.qr.module < qrFloor(made, style) * LARGE_SEEN) notes.push('No room for a larger QR code on this template');
        return r.qr;
      },
      qrNeed(quiet) {
        // Large asks for modules a third bigger; the template still holds the code to its room.
        const k = s.qrSize === 'large' ? QR_LARGE : 1;
        return ctx.qrOn ? qrNeed(qrText, made, qrStyle, quiet, qrLogo && s.logoMode !== 'none') * k : 0;
      },
      mark(box, o = {}) {
        const shapes = markShapes();
        if (!shapes?.length) return null;
        const fitted = fitInto(shapes, box);
        // A placeholder or an imported logo keeps its own drawing; initials are lettering, so they
        // are thickened like it.
        const grow = s.logoMode === 'initials' ? growFor(assets.faces.main, boxH(box) * 0.9, minStroke) : 0;
        return { role: 'logo', colour: colour('logo', o.on ?? 'card'), shapes: fitted, grow };
      },
      measure(raw, upper = false) {
        const line = unitLine(assets.faces, upper ? applyCase(raw, 'upper') : raw, s.letterSpacing / 100 + (upper ? LABEL_TRACK : 0));
        return line ? line.box.maxX - line.box.minX : 0;
      },
      label(raw, box, o) {
        // In capitals where they fit at the details' floor, else as typed: capitals are a fifth
        // wider, and a company name is often long.
        const tries = o.upper ? [true, false] : [false];
        for (const upper of tries) {
          const t = upper ? applyCase(raw, 'upper') : raw;
          const line = unitLine(assets.faces, t, s.letterSpacing / 100 + (upper ? LABEL_TRACK : 0));
          if (!line) return null;
          const width = line.box.maxX - line.box.minX;
          const cap = Math.min(o.cap, boxW(box) / Math.max(1e-9, width));
          if (cap < floors.detail - 1e-6) continue;
          const w0 = width * cap;
          const align = o.align ?? 'centre';
          const x = align === 'left' ? box.minX : align === 'right' ? box.maxX - w0 : (box.minX + box.maxX - w0) / 2;
          const y = (box.minY + box.maxY) / 2 - cap / 2;
          return { role: o.paint ?? 'details', colour: colour(o.paint ?? 'details', o.on ?? 'card'), shapes: scaleMove(line.shapes, cap, x - line.box.minX * cap, y), grow: growFor(assets.faces.main, cap, minStroke) };
        }
        warnings.push(`"${raw.trim()}" is too long to print readably here. Shorten it, or try another template.`);
        return null;
      },
      async pattern(region, o) {
        // A back's pattern is filled where it lies on the card (its region turned into the front's
        // frame), so the worker takes it as it is; a back is never cut through or carved.
        const where = side === 'back' ? mirrorShapes(region) : region;
        const mode = side === 'back' ? 'colour' : s.patternMode;
        const r = await fillPattern(where, { id: s.pattern, scale: (s.patternZoom / 100) * ((template.pattern?.zoom ?? 100) / 100), angle: s.patternAngle, mode, colour: colour('pattern', o.on ?? 'card') }, o);
        notes.push(...r.notes);
        return r.part;
      },
      tap(box, on = 'card') {
        if (!assets.tap?.length) return null;
        return { role: 'icons', colour: colour('icons', on), shapes: fitInto(assets.tap, box), grow: 0 };
      },
      initials: () => initialsOf(s.name),
      warn: (m) => warnings.push(m),
      note: (m) => notes.push(m),
    };
    return ctx;
  };

  const before = { warnings: warnings.length, notes: notes.length };
  const restart = () => {
    warnings.length = before.warnings;
    notes.length = before.notes;
    placed.length = 0;
    backings.length = 0;
  };
  let frontCtx = ctxFor('front');
  let front = await template.front(frontCtx);
  // A front that cannot hold its QR cleanly (a line that no longer fits beside it, or the code over
  // other pieces or across the edge of a colour field, where it would not scan) is laid out again
  // with a plain code (square modules, no logo in it: the template sizes the code from them), and
  // failing that without one. A QR in a colour too close to the card is said as it is.
  const fails = () => frontCtx.qrHere
    && (warnings.slice(before.warnings).some((m) => !m.startsWith(QR_COLOUR_WARNING)) || placed.some((q) => q.side === 'front' && qrClash(front, q.box)));
  if (fails() && (s.qrStyle === 'dots' || (s.qrLogo && s.logoMode !== 'none'))) {
    restart();
    frontCtx = ctxFor('front', { qrPlain: true });
    front = await template.front(frontCtx);
  }
  // Without the code, the front is laid out again; on a card with a back the code goes there (a
  // template that keeps its code on the front by design has none to give it), else it is left out
  // and the QR panel says why. The card still prints: a code that does not fit never stops it.
  let qrToBack = false;
  if (fails()) {
    restart();
    front = await template.front(ctxFor('front', { qrHere: false }));
    qrToBack = s.twoSided && template.qrSide !== 'front';
    notes.push(qrToBack ? QR_MOVED : s.twoSided ? `${QR_LEFT_OUT} on this template's front. ${s.qrKind === 'contact' ? 'Try Scan back, or let the code open your website.' : 'Try another template.'}` : `${QR_LEFT_OUT} on one side of this template. Print the back too, or try Corner QR.`);
  }
  // A one-sided card out of room has one fix that keeps every line: the back.
  if (!s.twoSided && warnings.some((m) => !m.startsWith(QR_COLOUR_WARNING))) {
    const kept = warnings.filter((m) => m.startsWith(QR_COLOUR_WARNING));
    warnings.length = 0;
    warnings.push(...kept, 'One side cannot hold all these lines at a size that prints. Print the back too (the company moves there), or leave a line out.');
  }
  front.ink = [...(front.ink ?? []), ...backings.filter((b) => b.side === 'front').map((b) => b.ink)];
  const faceOf = (side: Side): Face => ({ ...emptyFace(), fields: side.fields ?? [], gaps: side.gaps ?? [], ink: side.ink ?? [], pattern: side.pattern ?? null, carved: side.carved ?? [] });
  let back: Face | null = null;
  if (s.twoSided) {
    const backCtx = ctxFor('back', qrToBack ? { qrHere: true } : {});
    const asked = { warnings: warnings.length, notes: notes.length, placed: placed.length, backings: backings.length };
    let b = await template.back(backCtx);
    // A code the template's back cannot hold (or, for a contact card, cannot hold whole) takes the
    // back to itself: a vCard needs nearly the card's height, and a card that will not export, or
    // a code that leaves out the company and the website, is worse than a plainer back.
    const onBack = placed.slice(asked.placed).find((q) => q.side === 'back');
    if (backCtx.qrHere && (!onBack || (s.qrKind === 'contact' && onBack.said !== qrTexts[0]))) {
      warnings.length = asked.warnings;
      notes.length = asked.notes;
      placed.length = asked.placed;
      backings.length = asked.backings;
      // What goes through the card, in the back's frame: the template's holes and a pattern cut through.
      const cut = front.pattern?.mode === 'cut' ? front.pattern : null;
      b = qrBack(ctxFor('back', qrToBack ? { qrHere: true } : {}), mirrorShapes([...(front.cutouts ?? []), ...(cut ? (cut.lattice ? cut.lattice.region : cut.shapes) : [])]));
      notes.push(QR_TAKES_BACK);
    }
    b = { ...b, ink: [...(b.ink ?? []), ...backings.filter((x) => x.side === 'back').map((x) => x.ink)] };
    const mirrorInk = (i: Ink): Ink => ({ ...i, shapes: mirrorShapes(i.shapes), ...(i.minus ? { minus: mirrorShapes(i.minus) } : {}) });
    back = { fields: mirrorShapes(b.fields ?? []), gaps: mirrorShapes(b.gaps ?? []), ink: (b.ink ?? []).map(mirrorInk), pattern: b.pattern ?? null, carved: [] };
  }

  let pocket: Design['pocket'] = null;
  if (s.nfc || template.nfc) {
    const tag = NFC_TAGS[s.nfcTag] ?? NFC_TAGS['25']!;
    const r = tag.dia / 2 + TAG_CLEARANCE;
    // Where the customer dragged the tag, else where the template puts it.
    const dragged = !!s.nfcAt && !template.nfc;
    let at: Pt = dragged ? s.nfcAt! : front.pocket ?? [0, 0];
    // The pocket keeps a border of solid card to the edge: a spot too near it comes in, as far as
    // the card allows (a card too small for the tag says so below).
    const mx = w / 2 - r - BORDER / 2;
    const my = h / 2 - r - BORDER / 2;
    if (mx >= 0 && my >= 0) at = [Math.max(-mx, Math.min(mx, at[0])), Math.max(-my, Math.min(my, at[1]))];
    // What goes right through the card: the template's cut-outs, and a pattern cut through (a
    // lattice's whole region, as its holes are only worked out in the worker).
    const cut = front.pattern?.mode === 'cut' ? front.pattern : null;
    const holes: Shapes = [...(front.cutouts ?? []), ...(cut ? (cut.lattice ? cut.lattice.region : cut.shapes) : [])];
    const spots = [at, ...gridSpots(w, h, r, at)];
    // The tag itself can lie under lettering (it is inside the card), but a printed tap mark
    // cannot: with the mark on, the pocket stays at the template's place when the mark clears
    // every piece on the face there, else goes where the mark has the most room. Without the mark
    // it only has to keep off the holes.
    const areas: Shapes = s.nfcMark ? [...(front.fields ?? []), ...(front.carved ?? []), ...(front.pattern && front.pattern.mode !== 'cut' ? front.pattern.shapes : [])] : [];
    if (!template.nfc) at = clearSpot(s.nfcMark ? front.ink ?? [] : [], areas, holes, spots, TAP_SIZE, r, dragged) ?? at;
    if (mx < 0 || my < 0) warnings.push(`A ${tag.label} does not fit inside this card.`);
    pocket = { at, r };
    // Where nowhere was clear (a tap mark with no free card but over a pattern cut through), the
    // pattern keeps off the pocket instead: its holes there are left uncut, so the tag is sealed in
    // and the solid disc shows where to tap. A lattice is kept off it in the worker.
    if (cut && !cut.lattice) front.pattern = { ...cut, shapes: cut.shapes.filter((island) => distanceTo(at, [island]) >= r + POCKET_WALL) };
    // A small tap mark over the tag, on the face, so whoever holds the card knows where to tap (a
    // tap template draws its own, bigger).
    if (s.nfcMark && !template.nfc && assets.tap?.length) {
      const half = TAP_SIZE / 2;
      front.ink = [...(front.ink ?? []), { role: 'icons', colour: colour('icons'), shapes: fitInto(assets.tap, { minX: at[0] - half, maxX: at[0] + half, minY: at[1] - half, maxY: at[1] + half }) }];
    }
  }

  return {
    w,
    h,
    outline,
    card: cardColour,
    fieldColour,
    cutouts: front.cutouts ?? [],
    front: faceOf(front),
    back,
    reveal: front.reveal ? fieldColour : null,
    pocket,
    qrs: placed.map((q) => (q.side === 'back' ? { side: q.side, box: { minX: -q.box.maxX, maxX: -q.box.minX, minY: q.box.minY, maxY: q.box.maxY } } : q)),
    warnings: [...new Set(warnings)],
    notes: [...new Set(notes)],
  };
}

export { mirrorPt };
