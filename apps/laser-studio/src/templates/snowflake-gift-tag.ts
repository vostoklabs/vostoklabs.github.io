// Snowflake gift tags — a swing tag with a name engraved along it and a snowflake on its square
// end, half of it hanging off (moved from the corner to the end on 2026-09-28).
//
// THE TAG. 90 × 35 mm (the photo's 2.6 : 1), the hole end's two corners clipped at 45° by 30 % of
// the height each, so the end is a flat 40 % of it — the chamfered point a swing tag hangs from.
// The ribbon hole is the product, so it is the design's own (`hangHoleFields`, the pet tag's
// method), never the loop tab: 4 mm, its centre `dia/2 + 3.5` in from the flat end and held with
// ≥ 3 mm of wood all round, because a ribbon is pulled.
//
// THE SNOWFLAKE (`engine/snowflake.ts`, six designs drawn in 1.2–1.5 mm lines, 40 mm by default
// — about the tag's height across its tips, as in the photo). It sits where the photo's does: on
// the tag's square END, its centre on the tag's centre line and the end running all but through
// it, so half of it hangs off. It is turned 30° from how it is drawn, so one arm points straight
// out along the tag and the arms run at 0°, ±60°, ±120°, 180°: the three that point away hang off
// whole, V's and all, and the three that point in are buried in the wood — the slanting ones end
// level with the top and bottom edges at the default size. (The first version put the flake on
// the top corner, one arm up; now it is a flake on the end, the tag's end passing 0.04·R from
// its centre.)
//
// THE CUT is the photo's, zoomed: (tag ∪ flake) − windows. The flake is a hub drawn round a star
// of windows, plus its arms, and the tag is simply unioned with it: inside the tag the arms vanish
// into the wood and the windows are cut through plain tag — the ring of dark windows the photo
// shows in the tag; outside it, the whole silhouette shows. The union is SOLID (every hole filled
// before the windows go through), so a pocket a branch closes against the tag becomes wood. The
// end crosses the hub, so nothing of the tag is left among the arms and it needs no notch: its
// corners stand clear above and below the flake. `SEAT` puts each design where the end crosses
// its hub on a straight run of the outline and every V clears the end by ≥ 1 mm; there a fillet
// (`joins`) rounds the inside corner to 0.3 mm, as inside the flake itself. The arms that point
// into the tag are clipped to its top and bottom edges (`trimToTag`), so a big flake on a short
// tag keeps those edges straight. The hanging arms hold on through spines and hub lines all
// ≥ 1.5 mm.
//
// THE NAME is fitted between the hole and the windows' disc (`fitText`, the disc an obstacle, the
// hole the ring), engraved or scored — never cut through: a name cut out of a gift tag is not the
// photo's product, and the shared stencil holds a script's counters on bridges under 1 mm. A
// script by default, the photo's; its caps serif is on the font list too. Batch cuts a run of
// tags, one per name, and "Mix designs" steps through the snowflakes along the run.
//
// Held in `tests/node/snowflake-gift-tag.test.mjs` (one island per tag for every design and size,
// the webs that carry the arms ≥ 1.5 mm, no inside corner under 0.3 mm — where the tag meets the
// flake included — the flake centred on the end with one arm along the tag, the top and bottom
// edges straight, hole wall, the name inside its free area, old saves, a batch of 8, zero
// warnings at the defaults).
import { circleRing, type Pt, type Shapes } from '@vostok/laser';
import { applyCase, textLayer } from '../engine/text';
import { FLAKES, flakeId, flakeThumb, JOIN, joins, placeFlake, snowflake, type FlakeId } from '../engine/snowflake';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { hangHoleFields, NO_KEYRING } from './keyring';
import { fitText, letteringFields, opOf, stem } from './shared';
import { bool, lines, num, str, type TemplateDef, type Values } from './types';

/** The tag at its defaults, mm — the photo's 2.6 : 1. */
const WIDTH = 90;
const HEIGHT = 35;
/** Each clipped corner takes this share of the height, so the hanging end is a flat 40 % of it. */
const CLIP = 0.3;
/** A soft corner on every vertex, mm: crisp to the eye, no knife point to chip. */
const CORNER = 1;
/** Wood round the ribbon hole, mm, and the extra half-millimetre that keeps it clear of the
 *  flat end rather than exactly on the limit `holdInside` enforces. */
const HOLE_WALL = 3;
const HOLE_END = HOLE_WALL + 0.5;
/** The flake is drawn one arm straight up (arms at 90° + k·60°); turned this far, one arm points
 *  straight out along the tag, as in the photo, and the arms run at 0°, ±60°, ±120°, 180°. */
const TURN = 30;
/**
 * How far inside the square end each design's centre sits, mm (the photo's: 0.04·R, 0.8 mm at
 * 40). The end must cross the hub where its outline runs straight: down Classic's or Star's
 * valley, or round Fern's point (within 0.6 mm of it), the join cannot be rounded. Past 0.6,
 * Crystal's V's come back within a millimetre of the end at 35 mm, so it sits at 0.3. Berry's
 * windows are exactly one web inside its round outline, and at 0.5 the join leaves that web whole
 * at every size (at 0.8 the build's 0.01 mm simplify took it under 1.49 mm at three). All swept
 * over 35–46 mm flakes on 75–120 × 30–45 mm tags.
 */
const SEAT: Record<FlakeId, number> = { classic: 0.8, fern: 0.8, star: 0.8, plate: 0.8, crystal: 0.3, berry: 0.5 };
/** The name keeps this far from the tag's edge and from the windows' disc, mm. */
const TEXT_INSET = 3;

/** Faces for a name on a gift tag: the photo's flowing script first, then its caps serif. Each
 *  was built here at the default size and its thinnest engraved stroke measured ≥ 0.4 mm. */
const TAG_FONTS = ['sacramento', 'allura', 'great-vibes', 'parisienne', 'cinzel', 'playfair-display'];

/** The swing tag: a rectangle, hole end on the left with both corners clipped, every vertex
 *  rounded by `CORNER`. Centred on the origin, CCW. */
export function giftTagRing(w: number, h: number): Pt[] {
  const c = CLIP * h;
  const hw = w / 2, hh = h / 2;
  return filleted([[-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw, -hh], [hw, hh]], CORNER);
}

/** A closed polygon with every corner replaced by a circular arc of radius `r`. */
function filleted(pts: Pt[], r: number, seg = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, a = pts[(i + pts.length - 1) % pts.length]!, b = pts[(i + 1) % pts.length]!;
    const u1 = unit(a[0] - p[0], a[1] - p[1]), u2 = unit(b[0] - p[0], b[1] - p[1]);
    const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2;
    const t = r / Math.tan(half);
    const bis = unit(u1[0] + u2[0], u1[1] + u2[1]);
    const k = r / Math.sin(half);
    const c: Pt = [p[0] + bis[0] * k, p[1] + bis[1] * k];
    const t1: Pt = [p[0] + u1[0] * t, p[1] + u1[1] * t], t2: Pt = [p[0] + u2[0] * t, p[1] + u2[1] * t];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    // The short way round: a convex corner's arc never turns more than half a circle.
    while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
    while (a1 - a2 > Math.PI) a2 += 2 * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const ang = a1 + ((a2 - a1) * s) / seg;
      out.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
  }
  return out;
}

const unit = (x: number, y: number): Pt => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/**
 * The flake's wood with every piece that lies over the tag clipped to its top and bottom edges.
 * Those pieces are the arms that point into the tag: buried in its wood they show nothing, but a
 * big flake on a short tag runs their tips out through the edges — a tooth, or a jog in the cut a
 * hair high with inside corners too tight to round. Clipped, they end on the edge and it stays
 * straight. Whatever reaches past the end is the flake's own and is left whole.
 */
function trimToTag(rings: Pt[][], w: number, h: number): Pt[][] {
  const flip = (r: Pt[]) => r.map(([x, y]): Pt => [x, -y]);
  return rings.map((ring) => {
    if (ring.some(([x]) => x > w / 2)) return ring;
    let r = ring;
    if (r.some(([, y]) => y > h / 2)) r = keepBelow(r, 1, h / 2);
    if (r.some(([, y]) => y < -h / 2)) r = flip(keepBelow(flip(r), 1, h / 2));
    return r;
  }).filter((r) => r.length >= 3);
}

/** The ring clipped to `p[k] ≤ v` (Sutherland–Hodgman against one line). */
function keepBelow(ring: Pt[], k: 0 | 1, v: number): Pt[] {
  const out: Pt[] = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    if (p[k] <= v) out.push(p);
    if ((p[k] <= v) !== (q[k] <= v)) {
      const t = (v - p[k]) / (q[k] - p[k]);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
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

export const snowflakeGiftTag: TemplateDef = {
  id: 'snowflake-gift-tag',
  name: 'Snowflake gift tag',
  blurb: 'A name on a swing tag, a snowflake on its end.',
  tags: ['tag', 'engrave + cut'],
  batch: { key: 'name', noun: 'tag' },
  // No Corner control: the photo has one placement, centred on the end. A project saved with the
  // old Top / Bottom `corner` opens here, the key dropped (`coerceValues` keeps only known keys).
  fields: [
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'Noelle', placeholder: 'Who it is for', maxLength: 20 },
    {
      kind: 'thumbs', key: 'flake', label: 'Snowflake', section: 'Snowflake', value: 'classic',
      options: FLAKES.map((f) => ({ value: f.id, label: f.label, svgPath: flakeThumb(f.id) })),
    },
    // 40 by default: drawn in 1.2–1.5 mm lines the flake reads as lace, and at 40 it is the photo's
    // size beside its tag, its slanting arms' tips level with the top and bottom edges. 35 is the
    // smallest whose arms still hold two V's and a tip with 1 mm of air between them all. Up to 46
    // on any tag: the arms that run into the tag end at its edges, and the rest hang off the end.
    { kind: 'number', key: 'flakeSize', label: 'Snowflake size', section: 'Snowflake', value: 40, min: 35, max: 46, step: 0.5, unit: 'mm', help: 'Across the arm tips.' },
    {
      kind: 'toggle', key: 'mixFlakes', label: 'Mix designs', section: 'Snowflake', value: true,
      help: 'Each tag in the run gets the next snowflake.',
      visibleWhen: (v) => v.__batch === true,
    },
    { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'sacramento', recommended: TAG_FONTS, previewFrom: 'name' },
    // 21: "Noelle" in the default script at the photo's proportion, and unshrunk — the fit leaves
    // it alone up to 26 between the hole and the snowflake: a default the fit quietly shrinks is a
    // slider that lies about the part.
    { kind: 'number', key: 'size', label: 'Name size', section: 'Lettering', value: 21, min: 8, max: 30, step: 0.5, unit: 'mm', help: 'Long names shrink to fit beside the snowflake.' },
    { kind: 'toggle', key: 'fit', label: 'Shrink long names to fit', section: 'Lettering', value: true, help: 'Off cuts the name at the edge instead of shrinking it.' },
    // Engrave or score only (see the header): no "Cut out".
    { kind: 'select', key: 'op', label: 'Letters', section: 'Lettering', value: 'engrave', options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }] },
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Name position', section: 'Lettering', value: 0, valueY: 0, max: 20, step: 0.5, unit: 'mm', advanced: true },
    ...letteringFields('Lettering'),
    { kind: 'number', key: 'width', label: 'Width', section: 'Size', value: WIDTH, min: 75, max: 120, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Size', value: HEIGHT, min: 30, max: 45, step: 0.5, unit: 'mm' },
    ...hangHoleFields('Size', { dia: 4, maxDia: 6, label: 'Ribbon hole' }),
  ],
  async build(v) {
    const W = num(v, 'width');
    const H = num(v, 'height');
    const warnings: string[] = [];

    // The snowflake, on the square end opposite the hanging one: its centre on the tag's centre
    // line, `SEAT` inside the end, turned so one arm points straight out along the tag.
    const id = flakeFor(v);
    const flake = snowflake(id, num(v, 'flakeSize'));
    const cx = W / 2 - SEAT[id];
    const wood = placeFlake(flake.islands, cx, 0, TURN);
    const windows = placeFlake(flake.windows, cx, 0, TURN);
    // What of the flake shows inside the tag: its windows. The name keeps clear of their disc.
    const hub: Shapes = [[circleRing(cx, 0, flake.hub, 120)]];
    // The arms that run into the tag end at its top and bottom edges; where the end meets the
    // hub, a fillet rounds the inside corner to the flake's JOIN.
    const tag = giftTagRing(W, H);
    const flush = trimToTag(wood.map((island) => island[0]!), W, H);
    const welds = joins(flush, JOIN, tag).map((r) => [r]);

    // The ribbon hole: the design's own, on the centre line of the hanging end.
    const dia = num(v, 'holeDia');
    const holeX = -W / 2 + dia / 2 + HOLE_END;
    const keyring: KeyringSpec = v.hangHole === false
      ? NO_KEYRING
      : { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: HOLE_WALL, rest: [holeX, 0] };

    // Where the name belongs: from the hole's wall to the windows' disc, centred between the two.
    // `fitText` then keeps the whole box clear of both. With no hole the name may start halfway
    // into the clipped end: a name's own height keeps its box clear of the chamfers there, and
    // `fitText` holds it off them if it does not.
    const left = v.hangHole === false ? -W / 2 + (CLIP * H) / 2 : holeX + dia / 2 + HOLE_WALL;
    const right = cx - flake.hub;
    const spec = {
      symbols: readSymbols(v),
      text: applyCase(str(v, 'name'), str(v, 'textCase')),
      font: str(v, 'font'),
      size: num(v, 'size'),
      letterSpacing: num(v, 'letterSpacing') / 100,
      x: (left + right) / 2 + num(v, 'offsetX'),
      y: num(v, 'offsetY'),
    };
    const op = opOf(v);
    const name: DesignLayer[] = bool(v, 'fit')
      ? await fitText(spec, op, [[tag]], keyring, 'design', 'Name', { avoid: hub, inset: TEXT_INSET, minCap: 3, warnings })
      : await textLayer(spec, op, 'design', 'Name');

    // The piece is tag ∪ flake, SOLID: where a branch runs back into the tag it would close a
    // sliver of air against the edge, a pocket too small to cut clean, and filling every hole of
    // the union makes it wood instead — the branch simply joins the tag there, as in the photo.
    // Then the windows go through both. No stencil bridges: each window is framed all round.
    const window: DesignLayer = { id: 'flake-window', label: 'Snowflake', shapes: windows, op: 'cut', stencil: false };
    return {
      blank: { kind: 'shape', shapes: [[tag], ...flush.map((r) => [r]), ...welds], solid: true },
      keyring,
      layers: [...name, window],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => stem(str(v, 'name') || 'gift', 'tag'),
  exportNote: (v) => (v.hangHole === false
    ? 'No ribbon hole on this one, glue or tie it on.'
    : `The ribbon hole is cut at ${num(v, 'holeDia')} mm across.`),
};
