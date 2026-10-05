// Snowflake gift tags — an upright tag, a ribbon hole at the top, a name in the middle and a
// snowflake through its bottom edge: cut out of the tag above the edge, hanging off it as wood
// below (drawn from four photos of one tag blank with four flakes; it replaced the swing tag on
// 2026-10-03).
//
// THE TAG. 50 × 80 mm (the photos' 1.6 : 1, measured on all four), square at the bottom, its two
// top corners scooped out by quarter circles 0.19 of the width across, every convex corner soft
// by 1 mm. The ribbon hole is the design's own (`hangHoleFields`, the pet tag's method), on the
// centre line `dia/2 + 3.5` below the top with ≥ 3 mm of wood round it, because a ribbon is
// pulled; 4.5 mm by default, the photos' 0.09 of the width.
//
// THE SNOWFLAKE (`engine/snowflake.ts`, six designs, drawn at 32 mm and scaled to the tag so its
// lines are the photos' bold ones, not lace) is 0.95 of the tag's width across its arm tips, as on
// the photos' tags (0.9–0.95) — the engine decides it, so a wider tag gets a bigger flake and no
// size can run it off the sides. Its centre sits on the middle of the bottom edge (a hair above it
// on some designs, `LIFT`), one arm straight up, so the edge runs between the arms through the
// hub, and the flake turns over there:
//   · the hub is the same both sides — its windows cut through the tag above the edge and
//     through the hub's own wood below it;
//   · the three arms above the edge (30°, 90°, 150°) are CUT OUT of the tag, a stencil of
//     them — round ends, soft points, each spine starting a web clear of the windows;
//   · the three below it (210°, 270°, 330°) hang off as wood, V's and all.
// So the flake reads as a hole in the tag that becomes a silhouette at the edge: the photos'
// whole trick. The arms never cross the edge (the V's nearest it end 0.13 of the reach off the
// flake's centre line), so nothing is cut in two there; what holds the hanging half on is the hub,
// whose wood crosses the edge as a piece. A fillet (`joins`) rounds every inside corner where the
// edge meets it.
//
// THE NAME is fitted between the flake's cut-outs and the ribbon hole, centred on the tag
// (`fitText`, the cut-outs an obstacle, the hole the ring), engraved or scored — never cut
// through: the tag already has its cut-out. A script by default; its caps serif is on the font
// list too. Empty, the tag is the photos' blank one. Batch cuts a run of tags, one per name, and
// "Mix designs" steps through the snowflakes along the run.
//
// Held in `tests/node/snowflake-gift-tag.test.mjs` (one island per tag for every design and size,
// the webs ≥ 1.5 mm and the wood between cut-outs ≥ 1.2 mm, no inside corner under 0.3 mm, the
// flake centred on the edge at 0.95 of the width, the half above it cut out and the half below
// hanging, the cut-outs ≥ 2.5 mm inside the outline, hole wall, the name inside its free area,
// old saves, a batch of 8, zero warnings at the defaults).
import { bboxOf, type Pt, type Shapes } from '@vostok/laser';
import { applyCase, textLayer } from '../engine/text';
import { FLAKES, flakeId, flakeThumb, JOIN, joins, placeFlake, snowflake, type FlakeId } from '../engine/snowflake';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { hangHoleFields, NO_KEYRING } from './keyring';
import { fitText, letteringFields, opOf, stem } from './shared';
import { bool, lines, num, str, type TemplateDef, type Values } from './types';

/** The tag at its defaults, mm — the photos' 1.6 : 1. */
const WIDTH = 50;
const HEIGHT = 80;
/** Each top corner is scooped out by a quarter circle this share of the width in radius. */
const NOTCH = 0.19;
/** A soft corner on every convex corner, mm: crisp to the eye, no knife point to chip. */
const CORNER = 1;
/** The flake across its arm tips, as a share of the tag's width. */
const FLAKE = 0.95;
/** The flake is drawn at this size and scaled to the tag, so its lines grow with it: the photos'
 *  flakes are bold — a 2.3 mm spine on a 50 mm tag, 0.046 of its width — not lace. Drawn at 32 and
 *  scaled to the default 47.5 the spine is 2.2 mm and a branch 1.8; on the narrowest tag (a 38 mm
 *  flake) Star's tightest gap, 0.92 mm where it is drawn, still comes out at 1.09. */
const DRAWN_AT = 32;
/** The arms the edge leaves above it, cut out of the tag, and the ones that hang below it as
 *  wood — `snowflake()`'s k, counted counter-clockwise from the arm pointing straight up. */
const CUT_ARMS = [5, 0, 1];
const WOOD_ARMS = [2, 3, 4];
/** Wood round the ribbon hole, mm, and the extra half-millimetre that keeps it clear of the top
 *  rather than exactly on the limit `holdInside` enforces. */
const HOLE_WALL = 3;
const HOLE_END = HOLE_WALL + 0.5;
/** The name keeps this far from the tag's edge and from the flake's cut-outs, mm. */
const TEXT_INSET = 3;

/** Faces for a name on a gift tag: a flowing script first, then a caps serif. Each was built here
 *  at the default size and its thinnest engraved stroke measured ≥ 0.4 mm. */
const TAG_FONTS = ['sacramento', 'allura', 'great-vibes', 'parisienne', 'cinzel', 'playfair-display'];

/** Points on the circle round `c`, radius `r`, from `a0` to `a1` degrees in that direction. */
function arcPts(c: Pt, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Pt;
  });
}

const deg = (y: number, x: number) => (Math.atan2(y, x) * 180) / Math.PI;

/**
 * The tag: `w` × `h`, its origin the middle of the bottom edge (where the flake's centre sits),
 * the top corners scooped out by quarter circles `NOTCH·w` in radius and every convex corner
 * rounded to `CORNER` — where a straight edge meets a scoop, by the circle that touches the edge
 * from inside the tag and the scoop from outside it. CCW.
 */
export function giftTagRing(w: number, h: number): Pt[] {
  const n = NOTCH * w, c = CORNER, hw = w / 2;
  // How far from a scoop's centre, along the edge it meets, the corner's circle sits.
  const reach = Math.sqrt(n * n + 2 * n * c);
  const a = deg(reach, c), d = deg(c, reach);
  const pts = [
    ...arcPts([-hw + c, c], c, 180, 270),
    ...arcPts([hw - c, c], c, 270, 360),
    ...arcPts([hw - c, h - reach], c, 0, a),
    ...arcPts([hw, h], n, a - 180, -90 - a),
    ...arcPts([hw - reach, h - c], c, d, 90),
    ...arcPts([-hw + reach, h - c], c, 90, 180 - d),
    ...arcPts([-hw, h], n, -d, -a),
    ...arcPts([-hw + c, h - reach], c, 180 - a, 180),
  ];
  // Each arc ends where the next begins: keep that point once.
  return pts.filter((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length]![0], p[1] - pts[(i + 1) % pts.length]![1]) > 1e-9);
}

/** The design this tag carries: the one picked, or — in a batch with "Mix designs" on — the one
 *  `i` steps after it, `i` being this copy's place in the run (`__batchIndex`, which the editor
 *  sets on every copy, so "Mum, Mum, Mum" gets three snowflakes). A caller that builds copies
 *  without it falls back on the name's first line in the list. */
export function flakeFor(v: Values): FlakeId {
  const picked = flakeId(str(v, 'flake'));
  if (v.__batch !== true || !bool(v, 'mixFlakes')) return picked;
  const at = typeof v.__batchIndex === 'number' ? v.__batchIndex : lines(v, '__batchLines').indexOf(str(v, 'name').trim());
  if (at < 0) return picked;
  const start = Math.max(0, FLAKES.findIndex((f) => f.id === picked));
  return FLAKES[(start + at) % FLAKES.length]!.id;
}

/**
 * How far above the bottom edge each design's centre sits, in webs (the flake's own line width).
 * On the edge's line, Classic's and Star's hubs have the very point of a valley and Fern's the
 * middle of a round cap: an edge through a vertex leaves a knife corner the fillet finder cannot
 * see, and one across a cap's short chords leaves a hook. Lifted past them (a cap is half a web in
 * radius) the edge meets the hub on a straight run and the corner rounds — under a millimetre and
 * a half, the photos' "centre on the edge" to the eye. Plate's and Crystal's hubs meet the edge on
 * a straight side and Berry's on a true circle, so they could sit on it; Crystal is lifted a
 * little anyway, because its long branches reach towards the edge from both sides: on it, the
 * cut-out above leaves 2 mm of tag under it on the narrowest tag, and 0.3 of a web up leaves 2.5
 * there while the wood branch below keeps 1.5 mm of air. (Every lift adds to the cut-outs' rim and
 * takes from that air: at 0.6 Crystal's would be 0.7 mm.)
 */
const LIFT: Record<FlakeId, number> = { classic: 0.3, fern: 0.6, star: 0.3, plate: 0, crystal: 0.3, berry: 0 };

/** The flake a `w`-wide tag carries, and where its centre sits: on the middle of the bottom edge,
 *  its design's `LIFT` above it. */
export function placedFlake(id: FlakeId, w: number) {
  const diameter = FLAKE * w;
  const flake = snowflake(id, diameter, Math.min(diameter, DRAWN_AT));
  return { flake, x: 0, y: LIFT[id] * flake.web };
}

export const snowflakeGiftTag: TemplateDef = {
  id: 'snowflake-gift-tag',
  name: 'Snowflake gift tag',
  blurb: 'A gift tag with a snowflake cut through its edge.',
  tags: ['tag', 'engrave + cut'],
  batch: { key: 'name', noun: 'tag' },
  // No size for the flake: it is 0.95 of the width, as in the photos. A project saved with the
  // swing tag's `flakeSize` or `corner` opens here with the keys dropped (`coerceValues` keeps
  // only known keys), and one saved at the swing tag's size opens upright (types.ts).
  fields: [
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'Noelle', placeholder: 'Who it is for', maxLength: 20 },
    {
      kind: 'thumbs', key: 'flake', label: 'Snowflake', section: 'Snowflake', value: 'classic',
      options: FLAKES.map((f) => ({ value: f.id, label: f.label, svgPath: flakeThumb(f.id) })),
    },
    {
      kind: 'toggle', key: 'mixFlakes', label: 'Mix designs', section: 'Snowflake', value: true,
      help: 'Each tag in the run gets the next snowflake.',
      visibleWhen: (v) => v.__batch === true,
    },
    { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'sacramento', recommended: TAG_FONTS, previewFrom: 'name' },
    { kind: 'number', key: 'width', label: 'Width', section: 'Size', value: WIDTH, min: 40, max: 60, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Size', value: HEIGHT, min: 60, max: 100, step: 1, unit: 'mm', help: 'To the bottom edge; the snowflake hangs below it.' },
    { kind: 'number', key: 'size', label: 'Name size', section: 'Lettering', value: 16, min: 8, max: 24, step: 0.5, unit: 'mm', help: 'Long names shrink to fit the tag.' },
    { kind: 'toggle', key: 'fit', label: 'Shrink long names to fit', section: 'Lettering', value: true, help: 'Off cuts the name at the edge instead of shrinking it.' },
    // Engrave or score only (see the header): no "Cut out".
    { kind: 'select', key: 'op', label: 'Letters', section: 'Lettering', value: 'engrave', options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }] },
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Name position', section: 'Lettering', value: 0, valueY: 0, max: 20, step: 0.5, unit: 'mm' },
    ...letteringFields('Lettering'),
    ...hangHoleFields('Hanging', { dia: 4.5, maxDia: 6, label: 'Ribbon hole' }),
  ],
  async build(v) {
    const W = num(v, 'width');
    const H = num(v, 'height');
    const warnings: string[] = [];

    // The flake, its centre on the middle of the bottom edge, one arm straight up.
    const { flake, x, y } = placedFlake(flakeFor(v), W);
    const place = (s: Shapes) => placeFlake(s, x, y, 0);
    const tag = giftTagRing(W, H);
    // Below the edge: the hub and the three arms that hang off, each inside corner rounded —
    // the flake's own, and where the edge runs into the hub.
    const wood = [...place(flake.hubWood), ...WOOD_ARMS.flatMap((k) => place(flake.arms[k]!))].map((island) => island[0]!);
    const fillets = [...joins(wood), ...joins(wood, JOIN, tag)];
    // Through the tag: the hub's windows, and the three arms above the edge, cut out.
    const cut: Shapes = [...place(flake.windows), ...CUT_ARMS.flatMap((k) => place(flake.cutouts[k]!))];

    // The ribbon hole: the design's own, on the centre line near the top.
    const dia = num(v, 'holeDia');
    const holeY = H - dia / 2 - HOLE_END;
    const keyring: KeyringSpec = v.hangHole === false
      ? NO_KEYRING
      : { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: HOLE_WALL, rest: [0, holeY] };

    // Where the name belongs: from the cut-outs' top to the hole's wall, centred between the two.
    // `fitText` then keeps the whole box clear of both and inside the tag.
    const low = bboxOf(cut).maxY;
    const high = v.hangHole === false ? H : holeY - dia / 2 - HOLE_WALL;
    const spec = {
      symbols: readSymbols(v),
      text: applyCase(str(v, 'name'), str(v, 'textCase')),
      font: str(v, 'font'),
      size: num(v, 'size'),
      letterSpacing: num(v, 'letterSpacing') / 100,
      x: num(v, 'offsetX'),
      y: (low + high) / 2 + num(v, 'offsetY'),
    };
    const op = opOf(v);
    const name: DesignLayer[] = bool(v, 'fit')
      ? await fitText(spec, op, [[tag]], keyring, 'design', 'Name', { avoid: cut, inset: TEXT_INSET, minCap: 3, warnings })
      : await textLayer(spec, op, 'design', 'Name');

    // The piece is tag ∪ the hanging half, SOLID; then the windows and the cut-out arms go
    // through. No stencil bridges: every cut-out is framed all round by the tag.
    const through: DesignLayer = { id: 'flake-window', label: 'Snowflake', shapes: cut, op: 'cut', stencil: false };
    return {
      blank: { kind: 'shape', shapes: [[tag], ...wood.map((r) => [r]), ...fillets.map((r) => [r])], solid: true },
      keyring,
      layers: [...name, through],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => stem(str(v, 'name') || 'gift', 'tag'),
  exportNote: (v) => (v.hangHole === false
    ? 'No ribbon hole on this one, glue or tie it on.'
    : `The ribbon hole is cut at ${num(v, 'holeDia')} mm across.`),
};
