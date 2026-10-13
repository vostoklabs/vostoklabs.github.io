// Band: Laser Studio's first card, for a print. A pattern band runs down the left side, raised in
// the accent or cut right through the card, and the lettering stands in the column beside it. On a
// one-sided card the QR is a tile set into the band. On the back the band runs down the right.
import type { Box, Ring, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { BORDER, clipX, clipY, GUTTER, mirrorBox } from '../layout';
import { ALL, FRONT_QUIET, front, frontExtras, standardBack } from './common';

const MARGIN = 5.5;
/** The band's width, as a share of the card's, its border included. */
const WIDTH = 0.25;
/** Between the pattern's foot and a tile under it, mm. */
const TILE_AIR = 2;

/** The band's region on the left, stopping short of `foot` (a tile at the band's foot). */
function bandRegion(ctx: Ctx, foot: Box | null): { region: Shapes; edge: number } {
  const edge = -ctx.w / 2 + WIDTH * ctx.w;
  const outer: Ring = clipX(ctx.outline, edge + BORDER, 'left');
  // The tile is nearly the band's width, so the band ends above it rather than ringing it: the fill
  // keeps its border off the region's foot, which leaves TILE_AIR between the pattern and the tile.
  return { region: [[foot ? clipY(outer, foot.maxY + TILE_AIR - BORDER, 'above') : outer]], edge };
}

export const band: Template = {
  id: 'band',
  name: 'Band',
  group: 'patterns',
  line: 'A strip of pattern down the side.',
  pattern: { value: 'cubes', zoom: 70 },
  async front(ctx) {
    const { w, h } = ctx;
    const edge0 = -w / 2 + WIDTH * w;
    // A one-sided card's QR (or else its logo) is a tile at the foot of the band.
    const tileSide = Math.min(ctx.qrNeed(FRONT_QUIET) || 20, edge0 + w / 2 - 2 * 0.8);
    const tile: Box = { minX: -w / 2 + (edge0 + w / 2 - tileSide) / 2, maxX: -w / 2 + (edge0 + w / 2 + tileSide) / 2, minY: -h / 2 + MARGIN - 1.5, maxY: -h / 2 + MARGIN - 1.5 + tileSide };
    const qrTile = ctx.qrHere;
    const logoTile = !ctx.qrHere && ctx.markHere;
    const { region, edge } = bandRegion(ctx, qrTile || logoTile ? tile : null);
    const pattern = await ctx.pattern(region, { inset: BORDER });
    const lettering = ctx.lettering([{ box: { minX: edge + GUTTER, maxX: w / 2 - MARGIN, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN }, roles: front(ctx, ALL), align: 'left' }]);
    return {
      pattern,
      ink: [...lettering.ink, ...frontExtras(ctx, { qr: qrTile ? tile : null, logo: logoTile ? tile : null })],
      // Beside the band, never under a pattern that may be cut through.
      pocket: [(edge + w / 2) / 2, 0],
    };
  },
  async back(ctx) {
    const { w, h } = ctx;
    // As seen from behind, the band is on the right.
    const { region, edge } = bandRegion(ctx, null);
    const mirrored: Shapes = region.map((island) => island.map((r) => r.map(([x, y]): [number, number] => [-x, y]).reverse()));
    const pattern = await ctx.pattern(mirrored, { inset: BORDER });
    const area = mirrorBox({ minX: edge + GUTTER, maxX: w / 2 - 6, minY: -h / 2 + 4.5, maxY: h / 2 - 4.5 });
    return { ...standardBack(ctx, { area }), pattern };
  },
};
