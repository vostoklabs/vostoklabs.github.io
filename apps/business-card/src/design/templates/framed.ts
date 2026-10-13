// Framed: Laser Studio's framed card, for a print. The pattern runs everywhere round a solid centre
// panel, in colour by default, and the lettering stands in the panel.
//
// The laser card's panel is two thirds of the card and its lines are a laser's size; a print's six
// lines at the nozzle's floor fill most of the card on their own, so the frame here is the card's
// edge itself: the pattern bleeds off it (a cut keeps the engine's own web there), wider at the sides
// than above and below, and the panel is whatever it leaves. The rule under the name stays where the
// lines keep their size with it, and gives its line to the frame where they would not. On the back
// the same frame, in colour, holds the mark, the company and the QR, and it lies on the front's: a
// frame cut through the card is cut through the back as well.
import { num, patternById, resolveParams } from '@vostok/patterns';
import type { Box, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { boxH, boxRing, boxW, GUTTER, mirrorBox, shrinkBox } from '../layout';
import type { LockupSlot, Role } from '../lockup';
import { ALL, CONTACTS, cornerLogoBox, cornerQrBox, front, frontExtras, NAME_GROUP, qrOnFront, standardBack } from './common';
import { heightOf } from './print-cards';

/** The frame: at the sides and above and below, mm. */
const SIDE = 8.5;
const TOP = 4;
/** The panel's corners, and the air between its edge and the lettering (the gutter, and half a
 *  printed line of the pattern reaching past the panel's edge), mm. */
const PANEL_R = 2;
const PAD = GUTTER + 0.4;
/** A one-sided card's logo in the panel's top-right corner, mm. */
const LOGO = 10;

/** The panel, on the front. */
const panelOf = (ctx: Ctx): Box => ({ minX: -ctx.w / 2 + SIDE, maxX: ctx.w / 2 - SIDE, minY: -ctx.h / 2 + TOP, maxY: ctx.h / 2 - TOP });

/** The frame's region: the card less the panel. */
const frameOf = (ctx: Ctx, panel: Box): Shapes => [[ctx.outline, boxRing(panel, PANEL_R).reverse()]];

/** The template's own zoom on its default pattern. */
const ZOOM = 85;

/**
 * How far to slide the frame's pattern up the card. The diamond lattice's crossings run in rows
 * every half a cell; a band of the frame thinner than that with a row through it shows a line of
 * little crosses, one lying between two rows a clean zigzag. The lattice is symmetric about its rows
 * and about the lines halfway between them, so of the two slides that keep the top band the bottom
 * band's mirror, this is the one that keeps the bands' middles furthest from a row. Any other
 * pattern is left where the engine puts it.
 */
function frameSlide(ctx: Ctx): number {
  if (ctx.s.pattern !== 'diamond-lattice') return 0;
  const def = patternById('diamond-lattice');
  if (!def) return 0;
  const half = (num(resolveParams(def, {}), 'height') / 2) * (ctx.s.patternZoom / 100) * (ZOOM / 100);
  const mid = ctx.h / 2 - TOP / 2;
  const clearOf = (offset: number) => {
    const t = (((mid - offset) % half) + half) % half;
    return Math.min(t, half - t);
  };
  return clearOf(half / 2) > clearOf(0) ? half / 2 : 0;
}

export const framed: Template = {
  id: 'framed',
  name: 'Framed',
  group: 'patterns',
  line: 'A pattern frame round your details.',
  pattern: { value: 'diamond-lattice', zoom: ZOOM },
  async front(ctx) {
    const panel = panelOf(ctx);
    let inner = shrinkBox(panel, PAD);
    const pattern = await ctx.pattern(frameOf(ctx, panel), { inset: 0, dy: frameSlide(ctx) });
    // A one-sided card's logo takes the panel's top-right corner, beside the name, and its QR the
    // bottom-right, where the lettering gives it room (and says so when it cannot).
    const logo = ctx.markHere ? cornerLogoBox(ctx, ctx.w / 2 - inner.maxX, LOGO) : null;
    const qr = qrOnFront(ctx) ? cornerQrBox(ctx, ctx.w / 2 - inner.maxX + 1.5) : null;
    if (qr) inner = { ...inner, maxX: qr.minX - GUTTER + 1.5 };
    // The rule under the name, as on the laser card, where the lines keep the size they are set at
    // with it: it costs a line's height, and in a panel this full the lines come first.
    const tall = (roles: Role[], box: Box) => heightOf(ctx, roles, boxW(box), { rule: true });
    if (logo) {
      // Beside a logo the name's lines keep to its left, the contact lines run under both.
      const name = { ...inner, maxX: logo.minX - GUTTER };
      const rule = tall(front(ctx, NAME_GROUP), name) + GUTTER + tall(CONTACTS, inner) <= boxH(inner) + 1e-6;
      const lettering = ctx.lettering([
        { box: name, roles: front(ctx, NAME_GROUP), align: 'left', valign: 'top' },
        { box: inner, roles: CONTACTS, align: 'left', valign: 'bottom' },
      ], { rule });
      return { pattern, ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo })] };
    }
    // The block is fitted once to learn its width, then set again in a box that wide, so it stands
    // centred in the panel with its lines aligned on the left.
    const slot = (box: Box): LockupSlot => ({ box, roles: front(ctx, ALL), align: 'left' });
    const rule = tall(front(ctx, ALL), inner) <= boxH(inner) + 1e-6;
    const first = ctx.lettering([slot(inner)], { rule });
    const placed = first.blocks[0]!;
    const bw = placed.maxX - placed.minX;
    let lettering = first;
    if (!first.overflow && bw > 0 && bw < boxW(inner) - 0.5) {
      const cx = (inner.minX + inner.maxX) / 2;
      lettering = ctx.lettering([slot({ ...inner, minX: cx - bw / 2 - 0.05, maxX: cx + bw / 2 + 0.05 })], { rule });
    }
    return { pattern, ink: [...lettering.ink, ...frontExtras(ctx, { qr })] };
  },
  async back(ctx) {
    // From behind, the panel is the same box turned over.
    const panel = mirrorBox(panelOf(ctx));
    const pattern = await ctx.pattern(frameOf(ctx, panel), { inset: 0, dy: frameSlide(ctx) });
    const area = shrinkBox(panel, PAD);
    return { ...standardBack(ctx, { area }), pattern };
  },
};
