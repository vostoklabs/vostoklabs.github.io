// Tall: Laser Studio's tall card, for a print. A portrait card: a strip of pattern across the top, a
// solid band with the name, its rule and the title, then the pattern again down to the card's foot
// with a solid panel let into it for the contact lines. The pattern is in colour by default.
//
// The pattern's two areas are filled in one go, so it runs on across the band unbroken, as if the
// band were laid over it. Every edge where it meets solid card inside the card carries a keyline: on
// the laser card the struts end on the solid wood, where a print's lines would stop in the air
// wherever an edge cut them. The template's pattern is Japanese Pattern 1 at a zoom that makes the
// band, the pattern over the panel and the panel each a whole number of its rows, set on the band's
// foot: every edge then runs where the pattern's hexagons meet, and the motifs beside it are whole.
//
// The panel's lines are plain lines (`plainLines`): a card 50 to 55 mm across holds no email beside an
// icon at the floor, and a long one is broken before its "@". The walls of pattern beside the panel
// are as wide as the lines leave them, up to WALL; where they would be under WALL_MIN the panel runs
// out to the card's edges. A logo on the front, and the tap mark over an NFC tag, stand in a tile that
// joins the band to the panel. A QR needs more than the front leaves, and says so.
//
// The back is the same card turned over: the pattern where it lies on the front (cut through the card,
// the back's lies on its struts), the QR in the panel and the mark over the back's line in the band;
// with no QR the mark takes the panel. A band or a panel the back has nothing for is left to the
// pattern, which runs on through it, so the back never shows an empty frame.
import type { Box, Pt, Shapes } from '@vostok/shapes';
import { QR_LARGE, type Ctx, type Template } from '../build';
import { boxAt, boxH, boxW, clipY, GUTTER } from '../layout';
import type { Ink } from '../types';
import { front, NAME_GROUP } from './common';
import { KEY, keyline, keylineOn, plainLines, plainNeed } from './laser-cards';
import { pocketAt } from './print-cards';

/** Japanese Pattern 1 at its own size is 23 mm across its tile of 69.283 units, and its hexagons meet
 *  along level lines every 20 units: a row. The template's zoom makes a row ROW mm. */
const ZOOM = 86;
const ROW = ((20 * 23) / 69.283) * (ZOOM / 100);
/** Rows: the band (16 mm of lettering for the name, its rule and the title, and one row more when
 *  the front sets the company), the pattern between the band and the panel, and the panel (four
 *  lines at the raised floor, or the back's QR at its floor). */
const BAND_ROWS = 4;
const FIELD_ROWS = 2;
const PANEL_ROWS = 6;
/** The pattern's edge to the lettering: the gutter, and the keyline's half on the solid side. */
const GAP = GUTTER + KEY / 2;
/** The band's lettering stands this far in from the card's sides, mm. */
const SIDE = 4.5;
/** The panel's corners, and the corners where a tile meets the band and the panel, mm. */
const PANEL_R = 2.5;
const JOIN_R = 1.5;
/** The walls of pattern beside the panel, mm: their width, and the least kept before the panel runs
 *  out to the card's edges instead. */
const WALL = 4.5;
const WALL_MIN = 2.5;
/** The tile's width for the tap mark: the engine's 9 mm mark and its clear space each side, mm. */
const TAP_W = 14;
/** Clear modules round the back's QR: two, as the panel's card round it, clear of its keyline,
 *  carries the standard's other two. */
const BACK_QUIET = 2;
/** The back's mark over its line in the band, at its largest, and the line's room, mm. */
const BAND_MARK = 11;
const LABEL_H = 4.5;

/** The contact lines, as the panel sets them. */
const contacts = (ctx: Ctx) => [
  { role: 'phone', text: ctx.text.phone },
  { role: 'email', text: ctx.text.email },
  { role: 'web', text: ctx.text.web },
];

/** Whether the front sets the company: its band is a row taller then, and so is the back's, as the
 *  two lie on each other. */
const frontCompany = (ctx: Ctx) => (ctx.side === 'front' ? !!ctx.text.company.trim() : !!ctx.s.company.trim() && ctx.s.backText !== 'company');

/** The walls beside the panel: WALL where the front's lines fit between them at the front's floor,
 *  narrower where they need it, and none under WALL_MIN. A line too long for the card's whole width
 *  is refused whatever the walls, so it does not move them. */
function wallOf(ctx: Ctx): number {
  const room = ctx.w - 2 * (WALL + GAP);
  const need = Math.max(0, ...contacts(ctx).map((l) => plainNeed(ctx, [l], room, 'front')).filter((n) => n <= ctx.w - 2 * GUTTER + 1e-6));
  const wall = Math.min(WALL, (ctx.w - need) / 2 - GAP);
  return wall >= WALL_MIN ? wall : 0;
}

interface Rows {
  bandTop: number;
  bandFoot: number;
  panel: Box;
}

/** Where the band and the panel lie, the same on both faces. The strip across the top and the
 *  pattern under the panel share what is left. */
function rowsOf(ctx: Ctx): Rows {
  const { w, h } = ctx;
  const band = (BAND_ROWS + (frontCompany(ctx) ? 1 : 0)) * ROW;
  const field = FIELD_ROWS * ROW;
  const panel = PANEL_ROWS * ROW;
  const bandTop = h / 2 - (h - band - field - panel) / 2;
  const bandFoot = bandTop - band;
  const wall = wallOf(ctx);
  return { bandTop, bandFoot, panel: { minX: -w / 2 + wall, maxX: w / 2 - wall, minY: bandFoot - field - panel, maxY: bandFoot - field } };
}

const dir = (a: Pt, b: Pt): Pt => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};

/** The quarter circle that rounds corner `b` of a → b → c (square, both edges level or upright):
 *  from `r` back along a → b to `r` along b → c. */
function corner(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  if (r <= 0) return [b];
  const u = dir(a, b);
  const v = dir(b, c);
  const s: Pt = [b[0] - u[0] * r, b[1] - u[1] * r];
  const o: Pt = [s[0] + v[0] * r, s[1] + v[1] * r];
  const a0 = Math.atan2(s[1] - o[1], s[0] - o[0]);
  let a1 = Math.atan2(b[1] + v[1] * r - o[1], b[0] + v[0] * r - o[0]);
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  if (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  return Array.from({ length: 9 }, (_, i): Pt => [o[0] + r * Math.cos(a0 + ((a1 - a0) * i) / 8), o[1] + r * Math.sin(a0 + ((a1 - a0) * i) / 8)]);
}

/** Each corner of a path through `pts`, rounded by its radius (an open path's ends kept). */
function corners(pts: Pt[], radii: number[], closed: boolean): Pt[][] {
  const n = pts.length;
  return pts.map((p, i) => ((!closed && (i === 0 || i === n - 1)) ? [p] : corner(pts[(i + n - 1) % n]!, p, pts[(i + 1) % n]!, radii[i] ?? 0)));
}

/** The path itself. */
const rounded = (pts: Pt[], radii: number[], closed: boolean): Pt[] => corners(pts, radii, closed).flat();

/** The same path in keyline runs: each straight edge and each rounded corner a run of its own, so
 *  a tap mark beside one is measured to it rather than to the box of the whole path. */
function runsOf(pts: Pt[], radii: number[], closed: boolean): Pt[][] {
  const ends = corners(pts, radii, closed);
  const runs: Pt[][] = [];
  for (let i = 0; i < (closed ? ends.length : ends.length - 1); i++) runs.push([ends[i]![ends[i]!.length - 1]!, ends[(i + 1) % ends.length]![0]!]);
  return [...runs, ...ends.filter((e) => e.length > 1)];
}

interface Layout extends Rows {
  /** The pattern's region, and the keyline along every edge of it inside the card. */
  region: Shapes;
  keys: Pt[][];
  /** The slide that sets the pattern's rows on the band's foot. */
  dy: number;
  /** The name's lettering, and the panel's. */
  name: Box;
  lines: Box;
}

/**
 * The pattern's region and its keyline: the strip across the top, and the card under the band less
 * the panel and the tile (`tile`, its left and right) that joins it to the band. The tile and the
 * panel are one notch in the region's top edge; without a tile the panel is a hole in it. A panel out
 * to the card's edges cuts the pattern under the band in two, and the tile cuts the upper piece. A
 * back leaves out the band or the panel when it has nothing to put there (`keep`), and the pattern
 * runs on through it.
 */
function layout(ctx: Ctx, tile: [number, number] | null, keep = { band: true, panel: true }): Layout {
  const { w } = ctx;
  const r = rowsOf(ctx);
  const { bandTop, bandFoot, panel } = r;
  const P = PANEL_R;
  const J = JOIN_R;
  const region: Shapes = [];
  const keys: Pt[][] = [];
  const across = (y: number) => keys.push([[-w / 2 - 1, y], [w / 2 + 1, y]]);
  const walled = panel.minX > -w / 2 + 1e-6;
  // The panel's corners, clockwise from its top right: the order the region's edge passes them.
  const box: Pt[] = [[panel.maxX, panel.maxY], [panel.maxX, panel.minY], [panel.minX, panel.minY], [panel.minX, panel.maxY]];
  if (keep.band) {
    region.push([clipY(ctx.outline, bandTop, 'above')]);
    across(bandTop);
  }
  // The card under the band, or all of it when there is no band.
  const under = keep.band ? clipY(ctx.outline, bandFoot, 'below') : ctx.outline;
  if (!keep.panel) {
    region.push([under]);
    if (keep.band) across(bandFoot);
  } else if (walled && !tile) {
    // Its corners run clockwise, as a hole's do.
    region.push([under, rounded(box, [P, P, P, P], true)]);
    if (keep.band) across(bandFoot);
    keys.push(...runsOf(box, [P, P, P, P], true));
  } else if (walled && tile) {
    // The region's top edge runs right to left; where it passes the tile it goes down the tile,
    // round the panel and back up.
    const [a, b] = tile;
    const top = under.findIndex((p, i) => {
      const q = under[(i + 1) % under.length]!;
      return Math.abs(p[1] - bandFoot) < 1e-9 && Math.abs(q[1] - bandFoot) < 1e-9 && p[0] > q[0];
    });
    // The ring from the top edge's left end round to its right end, then the notch back.
    const ring = [...under.slice(top + 1), ...under.slice(0, top + 1)];
    const notch: Pt[] = [ring[ring.length - 1]!, [b, bandFoot], [b, panel.maxY], ...box, [a, panel.maxY], [a, bandFoot], ring[0]!];
    const radii = [0, J, J, P, P, P, P, J, J, 0];
    region.push([[...ring, ...rounded(notch, radii, false).slice(1, -1)]]);
    keys.push(...runsOf(notch, radii, false));
  } else {
    // Out to the card's edges: the pattern under the panel, and over it a strip (the tile may cut
    // it), or with no band all the card above the panel.
    region.push([clipY(ctx.outline, panel.minY, 'below')]);
    across(panel.minY);
    const y0 = panel.maxY;
    const y1 = bandFoot;
    if (!keep.band) {
      region.push([clipY(ctx.outline, y0, 'above')]);
      across(y0);
    } else if (!tile) {
      region.push([[[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1]]]);
      across(y0);
      across(y1);
    } else {
      const [a, b] = tile;
      const leftPart: Pt[] = [[-w / 2, y1], [a, y1], [a, y0], [-w / 2, y0]];
      const rightPart: Pt[] = [[w / 2, y0], [b, y0], [b, y1], [w / 2, y1]];
      for (const part of [leftPart, rightPart]) {
        const radii = [0, J, J, 0];
        // Each part closes along the card's edge, which carries no keyline.
        region.push([rounded(part, radii, false).reverse()]);
        keys.push(...runsOf(part, radii, false));
      }
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const island of region) for (const [, y] of island[0]!) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return {
    ...r,
    region,
    keys,
    dy: bandFoot - (minY + maxY) / 2,
    name: { minX: -w / 2 + SIDE, maxX: w / 2 - SIDE, minY: bandFoot + GAP, maxY: bandTop - GAP },
    lines: { minX: walled ? panel.minX + GAP : -w / 2 + GUTTER, maxX: walled ? panel.maxX - GAP : w / 2 - GUTTER, minY: panel.minY + GAP, maxY: panel.maxY - GAP },
  };
}

/**
 * The front's tile between the band and the panel, when the logo is on the front or the tap mark is
 * printed: the logo's square (the tile's height) with the gap to its keylines, and to its right the
 * tap mark with its clear space. The tap mark stands over the tag, so it goes where the tag's pocket
 * keeps its border of card and the tile follows it.
 */
function tileOf(ctx: Ctx, r: Rows): { span: [number, number]; logo: Box | null; tap: Pt | null } | null {
  const logo = ctx.markHere;
  const tap = ctx.s.nfc && ctx.s.nfcMark;
  if (!logo && !tap) return null;
  const top = r.bandFoot;
  const foot = r.panel.maxY;
  const mid = (top + foot) / 2;
  const side = top - foot;
  const logoW = logo ? GAP + side + (tap ? 0 : GAP) : 0;
  const width = logoW + (tap ? TAP_W : 0);
  if (!tap) return { span: [-width / 2, width / 2], logo: boxAt(0, mid, side, side), tap: null };
  const at = pocketAt(ctx, [width / 2 - TAP_W / 2, mid]);
  const b = at[0] + TAP_W / 2;
  const a = b - width;
  return { span: [a, b], logo: logo ? { minX: a + GAP, maxX: a + GAP + side, minY: foot, maxY: top } : null, tap: at };
}

export const tall: Template = {
  id: 'tall',
  name: 'Tall',
  group: 'patterns',
  line: 'Upright, with pattern from top to bottom.',
  portrait: true,
  pattern: { value: 'pm-japanese-pattern-1', zoom: ZOOM },
  async front(ctx) {
    const t = tileOf(ctx, rowsOf(ctx));
    const l = layout(ctx, t?.span ?? null);
    const pattern = await ctx.pattern(l.region, { inset: 0, dy: l.dy });
    const key = keylineOn(ctx, pattern, keyline(l.keys));
    const lettering = ctx.lettering([{ box: l.name, roles: front(ctx, NAME_GROUP), align: 'centre' }]);
    const ink: Ink[] = [...lettering.ink, ...plainLines(ctx, l.lines, contacts(ctx)), ...key.ink];
    // The QR needs a square as wide as the panel: there is nowhere on this face for it.
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    const mark = t?.logo ? ctx.mark(t.logo) : null;
    if (mark) ink.push(mark);
    // A hidden tag lies under the panel's middle, solid card whatever the pattern.
    const pocket: Pt = t?.tap ?? [0, (l.panel.minY + l.panel.maxY) / 2];
    return { pattern, ink, pocket, ...(key.carved.length ? { carved: key.carved } : {}) };
  },
  async back(ctx) {
    // The region is symmetric left to right, so turned over it is where it is. The band holds the
    // back's line (and the mark over it, beside a QR), the panel the QR or else the mark; one with
    // nothing to hold is left to the pattern.
    const line = ctx.text.company.trim();
    const keep = { band: !!line || (ctx.qrHere && ctx.markHere), panel: ctx.qrHere || ctx.markHere };
    const l = layout(ctx, null, keep);
    const pattern = await ctx.pattern(l.region, { inset: 0, dy: l.dy });
    const ink: Ink[] = [...keylineOn(ctx, pattern, keyline(l.keys)).ink];
    const mid: Pt = [(l.panel.minX + l.panel.maxX) / 2, (l.panel.minY + l.panel.maxY) / 2];
    if (ctx.qrHere) {
      // The QR in the panel, two millimetres clear of its keyline, or as near it as a code that
      // needs more modules must come (a Large one only asks for more, so keeps its air); the mark
      // over the line in the band.
      const side = Math.min(boxW(l.panel), boxH(l.panel)) - KEY;
      const need = ctx.qrNeed(BACK_QUIET);
      const needs = need / (ctx.s.qrSize === 'large' ? QR_LARGE : 1);
      const s = needs <= side - 4 ? Math.min(need * 1.08, side - 4) : Math.min(need, side - 0.4);
      const q = ctx.qr(boxAt(mid[0], mid[1], s, s), 'card', BACK_QUIET);
      if (q) ink.push(q.ink);
      ink.push(...markOver(ctx, l.name, line, ctx.markHere));
    } else {
      // No QR: the mark large in the panel, the line in the band.
      const s = Math.min(24, boxW(l.lines), boxH(l.lines));
      const m = ctx.markHere ? ctx.mark(boxAt(mid[0], mid[1], s, s)) : null;
      if (m) ink.push(m);
      ink.push(...markOver(ctx, l.name, line, false));
    }
    return { pattern, ink };
  },
};

/** The mark (when `mark`) over the line, centred in `box`, the mark as big as BAND_MARK and the room
 *  allow. */
function markOver(ctx: Ctx, box: Box, line: string, mark: boolean): Ink[] {
  const out: Ink[] = [];
  const labelH = line ? LABEL_H + 1.5 : 0;
  const size = mark ? Math.min(BAND_MARK, boxH(box) - labelH) : 0;
  const top = (box.minY + box.maxY) / 2 + (size + labelH) / 2;
  const m = size > 0 ? ctx.mark(boxAt(0, top - size / 2, size, size)) : null;
  if (m) out.push(m);
  if (line) {
    const label = ctx.label(line, { minX: box.minX, maxX: box.maxX, minY: top - size - labelH, maxY: top - size - 1.5 }, { cap: 3.4, upper: true });
    if (label) out.push(label);
  }
  return out;
}
