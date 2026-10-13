// Logo tile: Laser Studio's logo-tile card, for a print. A block of pattern, in colour by default,
// with a solid tile let into its inner edge that carries the mark (the logo, its
// placeholder, or the initials), and the name beside the tile.
//
// The laser card runs the pattern down 42 % of the card and sets four short lines in the column
// left; a print's contact lines need 60 mm at the floor, so here the pattern takes the top-left of
// the card, bleeding off its edges, the name stands beside the tile and the contact lines run the
// card's width beneath. The tile is a notch in the pattern's region: the pattern stops on three of
// its sides and the fourth opens into the card beside it, so it reads as set into the pattern, not
// laid on it. The pattern is centred on the tile, so its cells round the tile stay whole or halved.
//
// On the back the block lies where it lies on the front, in colour: a pattern cut through the card
// is cut through the back too, so the back's lies on its struts. Its tile carries the mark again,
// and the QR and the company take the rest.
import type { Box, Pt, Ring, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { boxAt, clipX, clipY, GUTTER, mirrorBox, mirrorShapes } from '../layout';
import type { Ink } from '../types';
import { CONTACTS, front, frontExtras, frontQrBox, NAME_GROUP, standardBack } from './common';
import { keyline, keylineOn } from './laser-cards';

const MARGIN = 5.5;
const TOP = 5;
const FOOT = 4.5;
/** The room kept for the name's line beside the tile, and the contact block's height, mm. */
const NAME_ROOM = 44;
const CONTACTS_H = 19;
/** Between the tile and the name, mm. */
const TEXT_GAP = 5;
/** How far a printed line of the pattern reaches past its region's edge, mm. */
const EDGE = 0.4;
/** The tile at its largest, the least pattern kept under it, and its corners, mm. */
const TILE = 18;
const STRIP = 2.5;
const TILE_R = 2.5;
/** The template's zoom on its default pattern. The laser card's 175 % suits a pattern side twice
 *  this block's size; here it leaves a few loose arcs, where Shippō's own size shows its overlapping
 *  rings round the tile. */
const ZOOM = 100;
/** The mark's share of the tile; it keeps the gutter off the pattern whatever the share. */
const MARK = 0.62;

interface Layout {
  /** The pattern's region and the slide that centres the pattern on the tile, in the front's frame. */
  region: Shapes;
  dx: number;
  dy: number;
  tile: Box | null;
  mark: Box | null;
  name: Box;
  contacts: Box;
  /** The block's inner edge and its foot. */
  edge: number;
  foot: number;
}

/** The notch's edge from where it leaves the block's inner edge to where it rejoins it: left along
 *  the tile's foot, up its rounded left side, back along its top. */
function notchPath(edge: number, tile: Box): Pt[] {
  const out: Pt[] = [[edge, tile.minY]];
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let i = 0; i <= 8; i++) {
      const t = from + ((to - from) * i) / 8;
      out.push([cx + TILE_R * Math.cos(t), cy + TILE_R * Math.sin(t)]);
    }
  };
  arc(tile.minX + TILE_R, tile.minY + TILE_R, -Math.PI / 2, -Math.PI);
  arc(tile.minX + TILE_R, tile.maxY - TILE_R, Math.PI, Math.PI / 2);
  out.push([edge, tile.maxY]);
  return out;
}

/**
 * The card left of `edge` and above `foot`, with the tile's notch let into its right-hand edge: an
 * anticlockwise ring climbs that edge, so where it passes the tile it goes round it instead.
 */
function notched(ctx: Ctx, edge: number, foot: number, tile: Box | null): Ring {
  const side = clipY(clipX(ctx.outline, edge, 'left'), foot, 'above');
  if (!tile) return side;
  const out: Ring = [];
  for (let i = 0; i < side.length; i++) {
    const a = side[i]!;
    const b = side[(i + 1) % side.length]!;
    out.push(a);
    const climbs = Math.abs(a[0] - edge) < 1e-9 && Math.abs(b[0] - edge) < 1e-9 && a[1] < tile.minY && b[1] > tile.maxY;
    if (climbs) out.push(...notchPath(edge, tile));
  }
  return out;
}

/** The keyline's runs along the block's inner edges and round the tile's notch, so the tile reads
 *  as a tile rather than a clearing (`keyline`). */
function keylineRuns(ctx: Ctx, l: Layout): Pt[][] {
  const { w, h } = ctx;
  const { edge, foot, tile } = l;
  const runs: Pt[][] = [[[-w / 2 - 1, foot], [edge, foot]]];
  if (tile) runs.push([[edge, foot], [edge, tile.minY]], notchPath(edge, tile), [[edge, tile.maxY], [edge, h / 2 + 1]]);
  else runs.push([[edge, foot], [edge, h / 2 + 1]]);
  return runs;
}

/** The front's layout; the back draws the same block turned over. */
function layout(ctx: Ctx): Layout {
  const { w, h } = ctx;
  const contactsTop = -h / 2 + FOOT + CONTACTS_H;
  const foot = contactsTop + GUTTER + EDGE;
  const nameLeft = w / 2 - MARGIN - NAME_ROOM;
  const edge = nameLeft - TEXT_GAP;
  const top = h / 2 - TOP;
  // The tile hangs from the name's top line, as big as leaves a strip of pattern under it.
  const side = Math.min(TILE, top - foot - STRIP);
  const tile = ctx.hasMark ? { minX: edge - side, maxX: edge, minY: top - side, maxY: top } : null;
  const ring = notched(ctx, edge, foot, tile);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  // The pattern centred on the tile, or with no tile on the block.
  const at: Pt = tile ? [(tile.minX + tile.maxX) / 2, (tile.minY + tile.maxY) / 2] : [(minX + maxX) / 2, (minY + maxY) / 2];
  const markSide = Math.min(MARK * side, side - 2 * (GUTTER + EDGE));
  return {
    region: [[ring]],
    dx: at[0] - (minX + maxX) / 2,
    dy: at[1] - (minY + maxY) / 2,
    tile,
    mark: tile ? boxAt(at[0], at[1], markSide, markSide) : null,
    name: { minX: nameLeft, maxX: w / 2 - MARGIN, minY: foot, maxY: top },
    contacts: { minX: -w / 2 + MARGIN, maxX: w / 2 - MARGIN, minY: -h / 2 + FOOT, maxY: contactsTop },
    edge,
    foot,
  };
}

export const logoTile: Template = {
  id: 'logo-tile',
  name: 'Logo tile',
  group: 'patterns',
  line: 'Your logo on a tile set into a pattern.',
  markFixed: true,
  pattern: { value: 'shippo', zoom: ZOOM },
  async front(ctx) {
    const l = layout(ctx);
    const pattern = await ctx.pattern(l.region, { inset: 0, dx: l.dx, dy: l.dy });
    // A one-sided card's QR takes the bottom-right corner; the lettering gives it room, and says so
    // when it cannot.
    const qr = frontQrBox(ctx, MARGIN);
    const name = qr ? { ...l.name, minY: Math.max(l.name.minY, qr.maxY + GUTTER) } : l.name;
    const contacts = qr ? { ...l.contacts, maxX: qr.minX - GUTTER + 1.5 } : l.contacts;
    const lettering = ctx.lettering([
      { box: name, roles: front(ctx, NAME_GROUP), align: 'left', valign: 'top' },
      { box: contacts, roles: CONTACTS, align: 'left', valign: 'bottom' },
    ]);
    const ink: Ink[] = [...lettering.ink, ...frontExtras(ctx, { qr })];
    const mark = l.mark ? ctx.mark(l.mark) : null;
    if (mark) ink.push(mark);
    // The keyline is made as the pattern is: carved with it, or in its colour. Cut through, the
    // block's own solid edge is the line.
    const key = keylineOn(ctx, pattern, keyline(keylineRuns(ctx, l)));
    ink.push(...key.ink);
    return { pattern, ink, ...(key.carved.length ? { carved: key.carved } : {}) };
  },
  async back(ctx) {
    const { w, h } = ctx;
    const l = layout(ctx);
    // The front's block turned over: from behind it is at the top-right. Its region goes to the
    // pattern in the back's frame and comes back in the front's, so the front's slide is the one.
    const pattern = await ctx.pattern(mirrorShapes(l.region), { inset: 0, dx: l.dx, dy: l.dy });
    const ink: Ink[] = [...keylineOn(ctx, pattern, mirrorShapes(keyline(keylineRuns(ctx, l)))).ink];
    const mark = l.mark ? ctx.mark(mirrorBox(l.mark)) : null;
    if (mark) ink.push(mark);
    // The QR and the company in the card the block leaves, left of it.
    const area: Box = { minX: -w / 2 + 5, maxX: -l.edge - GUTTER - EDGE, minY: -h / 2 + 5, maxY: h / 2 - 5 };
    const rest = standardBack(ctx, { area, mark: false });
    ink.push(...(rest.ink ?? []));
    return { pattern, ink };
  },
};
