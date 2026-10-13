// The card's lettering: name, rule, title, company and the contact lines (an icon in front of each
// where the template wants one), fitted into the template's slots at ONE scale, then placed.
//
// Adapted from Laser Studio's card lockup: its hierarchy (the title a share of the name, the
// details at a size of their own), its slots (a template sets the lines over one box or several,
// with one scale across all of them so the hierarchy holds), and its optical centre. What changed
// for a 0.4 mm nozzle:
//
//   · NO TEXT UNDER THE FLOOR. The details never go under their finish's floor (`FLOORS`), nor the
//     name under its own. Lettering that cannot fit at the floors is not shrunk into something
//     unreadable: the overflow is reported, and the export says what to shorten.
//   · THICKENED, NOT THIN. Every line carries the growth its face needs at its size (text.ts), so
//     a regular-weight face prints at the detail size.
//   · ARITHMETIC, NOT RE-LAYOUT. Lines are laid out once at a 1 mm cap and scaled (text.ts); the
//     fit is a search over two scales on their boxes.
import { bboxOf, roundedRectRing, type Box, type Shapes } from '@vostok/shapes';
import type { Ink, Role as Paint } from './types';
import { applyCase, growFor, scaleMove, unitLine, type Faces, type TextCase, type UnitLine } from './text';

export type Role = 'logo' | 'name' | 'rule' | 'title' | 'company' | 'phone' | 'email' | 'web';
export type Align = 'left' | 'centre' | 'right';
/** The contact lines, in the order they appear. */
export const CONTACT_ROLES = ['phone', 'email', 'web'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * The smallest capitals each finish sets, mm. A printed feature narrower than the nozzle's line
 * smears or vanishes, and that holds for the GAPS as much as the strokes: thickening (text.ts)
 * rescues a thin stroke but narrows the counters and the space between letters, so the floor
 * still has to keep those open. A flush face is printed against the plate, flat and crisp; raised
 * lettering stands as little walls whose gaps ooze shut first, so it gets more room.
 *
 * Measured on the shelf's faces, the narrowest 3 % of strokes and gaps put the floors higher
 * still (4.0 flush, 5.5 raised); these sit between that worst case and what printed cards
 * commonly carry, until a type-ladder print settles them.
 */
export const FLOORS = {
  flush: { detail: 3.2, name: 4.8 },
  raised: { detail: 3.6, name: 5.2 },
} as const;
/** The lowest of them: the sliders' end stops. */
export const DETAIL_FLOOR = FLOORS.flush.detail;
export const NAME_FLOOR = FLOORS.flush.name;
/** The title (and the company) against the name, as on the laser card. */
export const TITLE_RATIO = 0.6;
/** A logo above or beside the lines, its height against the name's cap. */
const LOGO_RATIO = 2.6;
/** A contact icon's height against the line's cap, and the air between it and the text. */
export const ICON_RATIO = 1.3;
export const ICON_GAP = 0.75;
/** The rule under the name: its thinnest a nozzle prints cleanly, mm. */
const RULE_MIN = 0.6;
/** The air between lines, as a share of the lower line's cap: between two lines of a group, where
 *  the name's group gives way to the contact lines, and either side of the rule (of the title's). A
 *  line's box already holds its ascenders and descenders, so these read as ordinary leading. */
export const LINE_GAP = 0.55;
export const GROUP_GAP = 1.2;
const RULE_GAP = 0.6;
/** How far above true centre a block sits, as a share of its box: the optical centre. */
const OPTICAL_LIFT = 0.04;
/** A Material symbol's stroke against its size, for thickening an icon like a line of text. */
const SYMBOL_STROKE = 0.085;

export interface LockupText {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  web: string;
}

export interface LockupStyle {
  /** The name's cap height asked for, mm. */
  nameCap: number;
  /** The details' cap height asked for, mm (held at the floor or above). */
  detailCap: number;
  /** How the name is set; the other lines are set as typed. */
  nameCase: TextCase;
  /** Letter spacing, a share of the letter size. */
  tracking: number;
  /** The narrowest stroke the ink may have, mm (`MIN_STROKE` for the card's finish). */
  minStroke: number;
  /** The smallest capitals of the details and of the name, mm (`FLOORS` for the card's finish). */
  floors: { detail: number; name: number };
  /** A rule between the name and the details. */
  rule: boolean;
  /** An icon in front of each contact line, keyed by role (null: plain lines). */
  icons: Partial<Record<ContactRole, Shapes>> | null;
  /** The logo in its own frame (centred, longest side 1), or null. */
  logo: Shapes | null;
  /** The colour of each kind of piece, by what it sits on (a slot on the colour fields reads in
   *  whatever contrasts with them). */
  colourOf: (paint: Paint, on: 'card' | 'shapes') => string;
  /** Icons drawn knocked out of a disc or a rounded square, or plain. */
  badge?: 'circle' | 'square' | null;
}

/** The colour role of a line of the lockup. */
const paintOf = (line: Role | 'icon'): Paint =>
  line === 'name' ? 'name' : line === 'rule' ? 'rule' : line === 'logo' ? 'logo' : line === 'icon' ? 'icons' : 'details';

export interface LockupSlot {
  /** The box the lines stay inside, already clear of everything else on the card. */
  box: Box;
  /** Which lines go here, in order. */
  roles: Role[];
  align: Align;
  /** Where the block sits up and down its box. Default: the optical centre. */
  valign?: 'centre' | 'top' | 'bottom';
  /** A logo on top of the lines (default) or beside them, centred on them. */
  logo?: 'above' | 'beside';
  /** What the slot sits on: the plain card (default) or the colour fields. */
  on?: 'card' | 'shapes';
}

export interface Overflow {
  slot: number;
  axis: 'width' | 'height';
  /** The line that set the width, when the width ran out. */
  role?: Role;
}

export interface Lettering {
  ink: Ink[];
  /** The name's and the details' cap heights as built, mm (0 when there are none). */
  nameCap: number;
  detailCap: number;
  /** The lines did not fit even at the floors: where they ran out. */
  overflow: Overflow | null;
  /** Each slot's block as placed (empty boxes for an empty slot). */
  blocks: Box[];
  /** The text and slots it was fitted from. */
  text: LockupText;
  slots: LockupSlot[];
}

// ------------------------------------------------------------------------------------ rows --

interface Unit {
  role: Role;
  line: UnitLine;
  icon?: UnitLine;
}

/** The text of a role as it is drawn. */
const textOf = (role: Role, t: LockupText, style: LockupStyle): string =>
  role === 'name' ? applyCase(t.name, style.nameCase) : role === 'logo' || role === 'rule' ? '' : t[role];

/** A row at its size: where its ink is relative to its own origin, and how to draw it there. */
interface Row {
  role: Role;
  box: Box;
  gap: number;
  draw(dx: number, dy: number): Ink[];
}

const kindOf = (role: Role): 'name' | 'title' | 'detail' | 'other' =>
  role === 'name' ? 'name' : role === 'title' || role === 'company' ? 'title' : role === 'logo' || role === 'rule' ? 'other' : 'detail';

const unitBox = (shapes: Shapes): UnitLine => ({ shapes, box: bboxOf(shapes) });

/**
 * Everything the lockup needs at 1 mm, built once: each line's islands, each contact line's icon,
 * the logo. Rows at any size are scaled from these.
 */
function units(faces: Faces, text: LockupText, style: LockupStyle): Map<Role, Unit> {
  const out = new Map<Role, Unit>();
  for (const role of ['name', 'title', 'company', ...CONTACT_ROLES] as Role[]) {
    const line = unitLine(faces, textOf(role, text, style), style.tracking);
    if (!line) continue;
    const icon = (CONTACT_ROLES as readonly Role[]).includes(role) ? style.icons?.[role as ContactRole] : undefined;
    out.set(role, { role, line, ...(icon?.length ? { icon: unitBox(icon) } : {}) });
  }
  if (style.logo?.length) out.set('logo', { role: 'logo', line: unitBox(style.logo) });
  return out;
}

interface Caps {
  name: number;
  title: number;
  detail: number;
}

/** The rows of one slot at these caps, in order, each with the air above it. */
function rowsAt(slot: LockupSlot, u: Map<Role, Unit>, caps: Caps, faces: Faces, style: LockupStyle): Row[] {
  const colour = (line: Role | 'icon'): string => style.colourOf(paintOf(line), slot.on ?? 'card');
  const rows: Row[] = [];
  let prev: Role | null = null;
  const capOf = (role: Role) => (kindOf(role) === 'name' ? caps.name : kindOf(role) === 'title' ? caps.title : caps.detail);

  for (const role of slot.roles) {
    if (role === 'rule') {
      // The rule is measured off the name it divides: 45 % of the name's width but never under
      // three of its capitals, as on the laser card; its stroke never under what prints.
      const name = u.get('name');
      if (!style.rule || !name || !rows.length) continue;
      const nameW = (name.line.box.maxX - name.line.box.minX) * caps.name;
      const width = Math.max(0.45 * nameW, 3 * caps.name);
      const stroke = Math.max(RULE_MIN, 0.12 * caps.title);
      const ring = roundedRectRing(width, stroke, stroke / 2, 4).map(([x, y]): [number, number] => [x + width / 2, y]);
      rows.push({
        role,
        box: { minX: 0, maxX: width, minY: -stroke / 2, maxY: stroke / 2 },
        gap: RULE_GAP * caps.title,
        draw: (dx, dy) => [{ role: 'rule', colour: colour('rule'), shapes: scaleMove([[ring]], 1, dx, dy) }],
      });
      prev = role;
      continue;
    }
    const unit = u.get(role);
    if (!unit) continue;

    if (role === 'logo') {
      if (slot.logo === 'beside') continue; // arranged beside the block, not in it
      const h = LOGO_RATIO * caps.name;
      const b = unit.line.box;
      const k = h / Math.max(1e-9, b.maxY - b.minY);
      rows.push({
        role,
        box: { minX: b.minX * k, maxX: b.maxX * k, minY: b.minY * k, maxY: b.maxY * k },
        gap: 0,
        draw: (dx, dy) => [{ role: 'logo', colour: colour('logo'), shapes: scaleMove(unit.line.shapes, k, dx, dy), grow: symbolGrow(h, style.minStroke) }],
      });
      prev = role;
      continue;
    }

    const cap = capOf(role);
    const lb = unit.line.box;
    const kind = kindOf(role);
    // The air above a line, a share of its own cap: wider where one group gives way to the next
    // (the name's group to the contact lines), as the eye reads them as two things.
    const gap = !prev ? 0
      : prev === 'rule' ? RULE_GAP * caps.title
        : kind === 'detail' && kindOf(prev) !== 'detail' ? GROUP_GAP * cap
          : prev === 'logo' ? 0.9 * caps.name
            : LINE_GAP * cap;
    const grow = growFor(faces.main, cap, style.minStroke);
    const textColour = colour(role);
    const textPaint = paintOf(role);

    if (unit.icon) {
      // The icon stands centred on the middle of the capitals, ICON_RATIO of the cap tall.
      const ih = ICON_RATIO * cap;
      const ib = unit.icon.box;
      const ik = ih / Math.max(1e-9, ib.maxY - ib.minY, ib.maxX - ib.minX);
      const iw = (ib.maxX - ib.minX) * ik;
      const icx = -ib.minX * ik;
      const icy = cap / 2 - ((ib.minY + ib.maxY) / 2) * ik;
      const tx = iw + ICON_GAP * cap - lb.minX * cap;
      const icon = unit.icon;
      rows.push({
        role,
        box: {
          minX: 0,
          maxX: tx + lb.maxX * cap,
          minY: Math.min(lb.minY * cap, cap / 2 - ih / 2),
          maxY: Math.max(lb.maxY * cap, cap / 2 + ih / 2),
        },
        gap,
        draw: (dx, dy) => [
          iconInk(icon, ik, ih, dx + icx, dy + icy, colour('icon'), style),
          { role: textPaint, colour: textColour, shapes: scaleMove(unit.line.shapes, cap, dx + tx, dy), grow },
        ],
      });
    } else {
      rows.push({
        role,
        box: { minX: lb.minX * cap, maxX: lb.maxX * cap, minY: lb.minY * cap, maxY: lb.maxY * cap },
        gap,
        draw: (dx, dy) => [{ role: textPaint, colour: textColour, shapes: scaleMove(unit.line.shapes, cap, dx, dy), grow }],
      });
    }
    prev = role;
  }
  return rows;
}

/** A symbol's growth: thickened like lettering, its stroke a known share of its size. */
const symbolGrow = (size: number, minStroke: number) => Math.max(0, Math.min(0.15, (minStroke - SYMBOL_STROKE * size) / 2));

/** The glyph's share of its badge, and the badge's corner on a square. */
const BADGE_GLYPH = 0.62;

/**
 * A contact icon, placed: the glyph itself, or a disc or rounded square in the icon colour with the
 * glyph left open in it. `k` scales the unit glyph, (x, y) puts its unit origin; `size` is the icon's
 * height on the card.
 */
function iconInk(icon: UnitLine, k: number, size: number, x: number, y: number, colour: string, style: LockupStyle): Ink {
  const glyph = scaleMove(icon.shapes, k, x, y);
  if (!style.badge) return { role: 'icons', colour, shapes: glyph, grow: symbolGrow(size, style.minStroke) };
  const b = icon.box;
  const cx = x + ((b.minX + b.maxX) / 2) * k;
  const cy = y + ((b.minY + b.maxY) / 2) * k;
  const d = size;
  const badge = style.badge === 'circle'
    ? Array.from({ length: 48 }, (_, i): [number, number] => [cx + (d / 2) * Math.cos((2 * Math.PI * i) / 48), cy + (d / 2) * Math.sin((2 * Math.PI * i) / 48)])
    : roundedRectRing(d, d, d * 0.22, 6, [cx, cy]);
  // The glyph shrinks into the badge about its own middle, and is what stays open.
  const inner = scaleMove(icon.shapes, k * BADGE_GLYPH, cx - ((b.minX + b.maxX) / 2) * k * BADGE_GLYPH, cy - ((b.minY + b.maxY) / 2) * k * BADGE_GLYPH);
  return { role: 'icons', colour, shapes: [[badge]], minus: inner };
}

// ----------------------------------------------------------------------------------- blocks --

interface Block {
  width: number;
  height: number;
  widest?: Role;
  /** Draw with the block's top-left at (x, top). */
  draw(x: number, top: number): Ink[];
}

const EMPTY: Block = { width: 0, height: 0, draw: () => [] };

/** Rows stacked top to bottom, each lined up by `align` within the widest. */
function stack(rows: Row[], align: Align): Block {
  if (!rows.length) return EMPTY;
  const widths = rows.map((r) => r.box.maxX - r.box.minX);
  const width = Math.max(...widths);
  const height = rows.reduce((s, r, i) => s + (r.box.maxY - r.box.minY) + (i ? r.gap : 0), 0);
  return {
    width,
    height,
    widest: rows[widths.indexOf(width)]!.role,
    draw: (x, top) => {
      const out: Ink[] = [];
      let y = top;
      rows.forEach((r, i) => {
        if (i) y -= r.gap;
        const w = r.box.maxX - r.box.minX;
        const left = align === 'left' ? x : align === 'right' ? x + width - w : x + (width - w) / 2;
        out.push(...r.draw(left - r.box.minX, y - r.box.maxY));
        y -= r.box.maxY - r.box.minY;
      });
      return out;
    },
  };
}

/** A slot's block: its rows stacked, and the logo beside them when the slot says so (never taller
 *  than the lines it stands by, and on the outside: left of left-aligned lines, right of right). */
function arrange(slot: LockupSlot, u: Map<Role, Unit>, caps: Caps, faces: Faces, style: LockupStyle): Block {
  const rows = rowsAt(slot, u, caps, faces, style);
  const logo = u.get('logo');
  const text = stack(rows, slot.align);
  if (slot.logo !== 'beside' || !logo || !slot.roles.includes('logo') || !rows.length) return text;
  const b = logo.line.box;
  const k = Math.min(LOGO_RATIO * caps.name, text.height) / Math.max(1e-9, b.maxY - b.minY);
  const lw = (b.maxX - b.minX) * k;
  const lh = (b.maxY - b.minY) * k;
  const gap = Math.max(3, 0.3 * lh);
  const right = slot.align === 'right';
  const colour = style.colourOf('logo', slot.on ?? 'card');
  return {
    width: lw + gap + text.width,
    height: Math.max(lh, text.height),
    widest: text.widest,
    draw: (x, top) => {
      const h = Math.max(lh, text.height);
      const mid = top - h / 2;
      const lx = right ? x + text.width + gap : x;
      const tx = right ? x : x + lw + gap;
      return [
        { role: 'logo', colour, shapes: scaleMove(logo.line.shapes, k, lx - b.minX * k, mid - ((b.minY + b.maxY) / 2) * k), grow: symbolGrow(lh, style.minStroke) },
        ...text.draw(tx, mid + text.height / 2),
      ];
    },
  };
}

// -------------------------------------------------------------------------------------- fit --

/** A ratio within this of 1 fits: a block a hair over its box is a rounding, not an overflow. */
const FITS = 1.001;

/**
 * The lettering fitted to its slots and placed.
 *
 * Two scales, searched in turn. First the name, title, company and logo give way, together, down to
 * the name's floor (or the details' size, if that is bigger: the name never reads smaller than a
 * phone number), while the details keep the size asked. Then the details give way, down to their
 * floor, with the name following them down to its own. Each stage only ever shrinks, so the
 * overflow falls monotonically and a bisection finds the biggest size that fits. Past both floors
 * nothing shrinks further: the lines are set at the floors, and `overflow` says where they spill.
 */
export function fitLockup(faces: Faces, text: LockupText, style: LockupStyle, slots: LockupSlot[]): Lettering {
  const u = units(faces, text, style);
  const N = style.nameCap;
  const D = Math.max(style.floors.detail, style.detailCap);

  // The name never reads smaller than the details unless it was asked to; the title sits between.
  const capsAt = (k: number, j: number): Caps => {
    const detail = D * j;
    const name = Math.max(N * k, Math.min(N, detail));
    return { name, title: Math.min(name, Math.max(detail, TITLE_RATIO * name)), detail };
  };
  const measure = (k: number, j: number) => {
    const caps = capsAt(k, j);
    const blocks = slots.map((s) => arrange(s, u, caps, faces, style));
    let over = 0;
    let bound: Overflow | null = null;
    blocks.forEach((b, i) => {
      const box = slots[i]!.box;
      if (!(b.width > 0 && b.height > 0)) return;
      const rw = b.width / Math.max(1e-9, box.maxX - box.minX);
      const rh = b.height / Math.max(1e-9, box.maxY - box.minY);
      if (rw > over) [over, bound] = [rw, { slot: i, axis: 'width', ...(b.widest ? { role: b.widest } : {}) }];
      if (rh > over) [over, bound] = [rh, { slot: i, axis: 'height' }];
    });
    return { caps, blocks, over, bound };
  };
  /** The biggest s in [lo, 1] for which `at(s)` fits; `lo` itself when nothing does. */
  const bisect = (lo: number, at: (s: number) => ReturnType<typeof measure>) => {
    if (at(1).over <= FITS) return 1;
    if (at(lo).over > FITS) return lo;
    let a = lo;
    let b = 1;
    for (let i = 0; i < 18; i++) {
      const m = (a + b) / 2;
      if (at(m).over <= FITS) a = m;
      else b = m;
    }
    return a;
  };

  // The name's own floor for a given details size: its finish's floor, or the details if bigger.
  const nameK = (detail: number) => Math.min(1, Math.max(style.floors.name, detail) / Math.max(1e-9, N));
  const stageB = (s: number) => measure(nameK(D * s), s);
  let made = measure(1, 1);
  if (made.over > FITS) {
    const k = bisect(nameK(D), (s) => measure(s, 1));
    made = measure(k, 1);
    if (made.over > FITS) made = stageB(bisect(style.floors.detail / D, stageB));
  }

  // Placed: lined up by the slot's align, at its optical centre (or its top or bottom), never out
  // of the box where the block fits it.
  const ink: Ink[] = [];
  const placed: Box[] = [];
  made.blocks.forEach((b, i) => {
    const slot = slots[i]!;
    const box = slot.box;
    if (!(b.width > 0 && b.height > 0)) {
      placed.push({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
      return;
    }
    const x = slot.align === 'centre' ? (box.minX + box.maxX - b.width) / 2 : slot.align === 'right' ? box.maxX - b.width : box.minX;
    const boxH = box.maxY - box.minY;
    const valign = slot.valign ?? 'centre';
    let top: number;
    if (valign === 'top') top = box.maxY;
    else if (valign === 'bottom') top = box.minY + b.height;
    else {
      const mid = (box.minY + box.maxY) / 2 + OPTICAL_LIFT * boxH;
      top = Math.min(box.maxY, Math.max(box.minY + b.height, mid + b.height / 2));
    }
    ink.push(...b.draw(x, top));
    placed.push({ minX: x, maxX: x + b.width, minY: top - b.height, maxY: top });
  });

  const has = (roles: Role[]) => roles.some((r) => u.has(r));
  return {
    ink,
    nameCap: u.has('name') ? made.caps.name : 0,
    detailCap: has([...CONTACT_ROLES]) ? made.caps.detail : 0,
    overflow: made.over > FITS ? made.bound : null,
    blocks: placed,
    text,
    slots,
  };
}

const ROLE_WORDS: Record<Role, string> = {
  logo: 'logo', name: 'name', rule: 'rule', title: 'title', company: 'company name', phone: 'phone number', email: 'email', web: 'website',
};

/** What the lettering says about itself: a sentence when it spills, naming what to shorten. */
export function letteringWarnings(l: Lettering): string[] {
  const o = l.overflow;
  if (!o) return [];
  if (o.axis === 'width' && o.role && o.role !== 'logo' && o.role !== 'rule') {
    return [`The ${ROLE_WORDS[o.role]} is too long to print readably here. Shorten it, or try another template.`];
  }
  return ['Too many lines to print readably here. Leave one out, or try another template.'];
}
