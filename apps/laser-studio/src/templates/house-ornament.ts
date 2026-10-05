// The house ornament: a house-with-chimney silhouette cut twice — a dark backer and a light rim
// frame that follows the same outline, with the hanging loop at the roof peak.
//
// Three pieces: the
// FRAME is primary, because the loop belongs to the frame; the house
// itself is a `parts[]` backer carrying the door, the windows and the address; the family name
// is a third, light nameplate glued across the wall (or burned onto it instead, when "Light
// pieces" says Engrave).
//
// The year goes on the FRAME's chimney, not the backer's. Measured, not assumed: the chimney is
// 0.14 W wide (11.2 mm at the default) against a frame `rimWidth` wide, so at any legal rim width
// (5–14) it is SOLID frame, not a ring round a sliver — the backer's own chimney is covered by it
// once the two are glued, and a year engraved there would never be seen. On the frame it lands on
// light wood, which is also where §4.5 wants every fine mark. Everything else the design lists as
// an engrave still burns into the dark backer.
//
// Nothing here draws the house: `blankById('house-chimney')` owns the eaves, the welded chimney,
// the peak boss and the door/windows detail. Everything this file adds is lettering — where the
// wall band is, how big the three lines are, which piece each lands on — and the frame's WINDOW.
//
// The window, and why it is not `{ kind: 'rim' }` any more (2026-09-21: a weird shape anomaly).
// `rim` insets the whole silhouette with a true offset, and the chimney is
// part of that silhouette: it interrupts the roof's edge for 11.2 mm and hangs 27 mm down inside
// the house, so the inset has nothing to keep its distance from under the chimney and swings
// round the two re-entrant corners instead. Measured at the default: the window bit 1.7 mm UP
// into the roof on a 6.3 mm arc and then dropped 4.9 mm vertically at the chimney's far wall —
// the bump and the bite. It is the honest constant-width rim
// of that silhouette and it reads as a mistake, because a chimney is a block STANDING on a roof,
// not a hole in one.
//
// So the window is the house's own inner outline — the gable set `rimWidth` in, its corners
// rounded by the same inner-corner smoothing the rim had and its PEAK rounded further, until it
// clears the loop's lug (`houseWindow`) — and the chimney and the peak boss are welded on top of
// it, the chimney clipped back to halfway down the roof band so its buried half cannot hang into
// the window. The frame's OUTER edge is untouched: it is still the blank's own silhouette, so the
// frame and the backer register exactly. `houseWindow` is checked against `buildRimResult`'s true
// offset of the gable in the suite, at both ends of both sliders.
import {
  bboxOf,
  blankById,
  blankDetail,
  buildBlank,
  placeShapes,
  roundedRectRing,
  textBoxOf,
  type BlankParams,
  type Box,
  type Pt,
  type Shapes,
} from '@vostok/laser';
import { rimLoopAnchor } from '../engine/frame';
import { sizeForCapHeight } from '../engine/metrics';
import { applyCase, textLayer, type TextSpec } from '../engine/text';
import { readSymbols } from '../symbols/model';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { keyringFrom } from './keyring';
import { frameFields, letteringFields, lightPieceFields, stem } from './shared';
import { num, str, type Field, type TemplateDef } from './types';

/** How far inside the piece it traces a glue guide is scored, mm — the line has to vanish under
 *  the piece it registers, never show as a halo round it. */
const GUIDE_INSET = 0.3;
/** 80 × 90 is the design's own default (§3.5); the height follows the width at that ratio, so
 *  one slider moves the whole house and every fraction the blank is drawn from. */
const HOUSE_RATIO = 90 / 80;

/** The one face besides the family's own: a CONDENSED sans for the address and the year. Two
 *  typefaces on a piece is the ceiling (§4.4) — the serif or script carries the name, this
 *  carries the data. Condensed is not taste: the chimney's face is 0.14 W wide, and four digits
 *  in a normal-width sans come out 2.7 mm tall there, under the 3 mm engraving floor. The same
 *  year in Oswald is 4.0 mm at the default house. Measured, both of them. */
const DETAIL_FONT = 'oswald';

/** The light nameplate's border round the raised name. A family name long enough to need this
 *  template is set small enough (3.8 mm caps at the default) that welding the LETTERS into the
 *  piece — `layered-keychain`'s trick, where the caps are 14 mm — closes half the gaps and
 *  leaves a ragged blob: rendered, looked at, rejected. So the raised piece is a nameplate with
 *  the name engraved on it, and this much border is what makes it a plate and not a sliver.
 *
 *  A SHARE of the fitted capital, not a millimetre, and for the same reason the framed name
 *  ornament scales its weld: 1.8 mm of light wood round a 5.9 mm cap on a 120 mm house is a neat
 *  border, and the same 1.8 mm round the 3 mm cap a 14 mm rim leaves is 60 % of the letter — it
 *  reads as a slab with writing lost in the middle, and it takes 3.6 mm of the very width the
 *  name was short of. Floored at a millimetre (the isolated-web minimum, which a solid plate
 *  clears comfortably) and capped at the card's own number. */
const plaqueMargin = (cap: number) => Math.max(1, Math.min(1.8, 0.45 * cap));

/** Air between an engraved mark and a cut edge: an engrave that runs into the edge chars it. */
const EDGE_AIR = 1;

/** The size every line is measured at before it is scaled to the room it has. */
const TRIAL_SIZE = 10;

/** Under this, lettering stops being lettering — the fit clamps here and says so. */
const MIN_SIZE = 2;

/** The nameplate's corner, as a share of its own height. A tenth of the short side "looks
 *  designed" and half of it is a pill (`shapeFields`' own note); a quarter is the house-number
 *  plaque this piece is. */
const PLAQUE_CORNER = 0.25;

/**
 * The faces this design is for, in order (G2).
 *
 * What the nameplate asks of a face is not what a keychain asks: the letters are ENGRAVED at
 * around 3.8 mm of capital on a light plate, so the test is whether the counters of a, e and o
 * survive the burn at that size — not whether the outlines weld. Every one of these was built as
 * the card's own family name at the default house and at a 14 mm rim (the narrowest wall the
 * sliders reach), rasterised and looked at; the faces left in "More fonts" are the ones whose
 * counters closed up or whose hairlines vanished. The plate is a rectangle, not a hug, so a
 * connected script is as safe here as a slab — which is why one leads the second half.
 */
const HOUSE_FACES = ['playfair-display', 'cinzel', 'libre-baskerville', 'arvo', 'bitter', 'montserrat', 'oswald', 'dancing-script'];

/** Engraved ink shorter than this stops reading (3–6 mm is the band). The fit still
 *  goes below it rather than refusing to build; the warning is what says so. */
const MIN_INK = 3;

/** The shared frame block — its width beside the house's own, its loop under Hanging — without
 *  "Loop through both layers": the ribbon goes through both, always, so the toggle is a control
 *  with nothing left to decide. */
const FRAME: Field[] = frameFields({ diameter: 90, section: 'House', pieceNoun: 'the house' }).filter((f) => f.key !== 'backerRing');

/** Where a closed ring crosses the line `at`. `axis` 1 reads a horizontal line and returns the
 *  x's it cuts (the wall's real width at the band's height); `axis` 0 reads a vertical line and
 *  returns the y's (the roof's height beside the chimney). Measured off the blank's own outline
 *  so this file never restates a fraction `blanks.ts` owns. */
function crossings(ring: Pt[], at: number, axis: 0 | 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const a0 = a[axis];
    const b0 = b[axis];
    if ((a0 <= at && b0 >= at) || (b0 <= at && a0 >= at)) {
      const t = Math.abs(b0 - a0) < 1e-9 ? 0 : (at - a0) / (b0 - a0);
      const o = (1 - axis) as 0 | 1;
      out.push(a[o] + t * (b[o] - a[o]));
    }
  }
  return out;
}

/** Which island the chimney is. `buildBlank` returns the house first and then one island per
 *  welded extra — a chimney and the peak boss — and the chimney is the one off the centre line. */
function chimneyAt(outer: Shapes): number {
  let best = -1;
  let bestX = 1;
  for (let i = 1; i < outer.length; i++) {
    const b = bboxOf([outer[i]!]);
    const cx = Math.abs((b.minX + b.maxX) / 2);
    if (cx > bestX) {
      bestX = cx;
      best = i;
    }
  }
  return best;
}

/** The chimney's box. */
function chimneyBox(outer: Shapes): Box | null {
  const i = chimneyAt(outer);
  return i < 0 ? null : bboxOf([outer[i]!]);
}

/** The chimney's VISIBLE face: the part standing proud of the roof slope, less the air an
 *  engrave needs off its cut edges. Its lower edge is the roof at the chimney's low side. */
function chimneyFace(house: Pt[], box: Box): Box | null {
  const roof = crossings(house, box.minX + 0.01, 0);
  const floor = roof.length ? Math.max(...roof) : box.minY;
  const face = {
    minX: box.minX + EDGE_AIR,
    maxX: box.maxX - EDGE_AIR,
    minY: floor + EDGE_AIR,
    maxY: box.maxY - EDGE_AIR,
  };
  return face.maxX - face.minX > 1 && face.maxY - face.minY > 1 ? face : null;
}

/** The gable's own two landmarks, read off the blank's ring rather than restated from its
 *  fractions: the eave tip (the widest point of the outline) and the apex (the highest). Both are
 *  real vertices, so a change in `blanks.ts` moves this with it. */
function gable(house: Pt[]): { eave: Pt; apex: Pt; inward: Pt } {
  let eave = house[0]!;
  let apex = house[0]!;
  for (const p of house) {
    if (p[0] > eave[0]) eave = p;
    if (p[1] > apex[1]) apex = p;
  }
  // The unit normal of the right-hand roof slope, pointing INTO the house: the slope's direction
  // (eave → apex, up and left) turned a quarter turn the way a CCW outline puts its interior.
  const dx = apex[0] - eave[0];
  const dy = apex[1] - eave[1];
  const len = Math.hypot(dx, dy) || 1;
  return { eave, apex, inward: [-dy / len, dx / len] };
}

/**
 * The frame's window: the gable set `rim` mm in, with the peak rounded off.
 *
 * Five points and an arc, because that is all the true inward offset of this outline is away from
 * the chimney — verified against `buildRimResult` in the suite. The eaves' own re-entrant corners
 * do not reach it: their 6.3 mm disc stops 0.1 mm short of where the wall's band meets the roof's
 * at the default, and 0.8 mm short at a 14 mm rim, which is why there is no arc there to draw.
 *
 * The peak's round-over is the rim's own inner-corner smoothing (`0.35 × rimWidth`) or as much
 * MORE as it takes to keep the window `clearOf` mm clear of the lug's disc — and that second
 * number is not taste either, in both halves:
 *
 * · Physically, the peak is where the whole ornament hangs. More material under the ribbon than
 *   along the eaves is what a picture frame does, and a sharp internal corner directly beneath a
 *   loaded hole is where plywood splits.
 * · Mechanically, `applyKeyring` welds the lug on AFTER this window is cut and fillets it as the
 *   difference of two closes. Where the lug's disc CROSSES this edge the two closes disagree and
 *   the weld pinches a crescent of window off into an offcut — 0.11 mm² beside the peak at 100 and
 *   120 mm, 26.9 mm² at `holeRing: 8`, on the `rim` build this replaced as well as on this one,
 *   and appearing or not with nothing but floating-point noise between. Keep the edge off the disc
 *   and the crossing never happens. (`ringMode: 'none'` and small lugs never reached it: that is
 *   why they were always clean.)
 *
 * It comes out walked at half a millimetre rather than as its seven real corners, which is the
 * same disagreement one size down: a long chord let the weld land beside the edge instead of on
 * it. The engine's `simplifyRing(0.01)` puts the straights back together at the end, so the plate
 * that reaches the file is the same seven corners either way.
 */
function houseWindow(house: Pt[], rim: number, smoothing: number, lug: { at: Pt; radius: number } | null, clearOf = 0.6): Pt[] {
  const { eave, apex, inward } = gable(house);
  const bottomY = Math.min(...house.map((p) => p[1]));
  // The wall, not the eave: the widest thing at the base. The gable is symmetric about x = 0,
  // as every blank in the library is, so one side is measured and the other mirrored.
  const wallX = Math.max(...house.filter((p) => p[1] < bottomY + 0.01).map((p) => Math.abs(p[0])));
  const e: Pt = [eave[0] + rim * inward[0], eave[1] + rim * inward[1]];
  const slope = (apex[1] - eave[1]) / (apex[0] - eave[0]);
  const roofAt = (x: number) => e[1] + slope * (x - e[0]);
  const wx = wallX - rim;
  const by = bottomY + rim;
  const ay = roofAt(0);
  // Half the angle the two slopes meet at, from the bisector — which is straight down.
  const half = Math.atan2(Math.abs(wx), ay - roofAt(wx));
  // A round-over of radius ρ drops the peak by ρ·(1/sin − 1), so the radius that clears the lug
  // follows from the drop it has to make. Capped where the arc would reach out past 45 % of the
  // window's half-width and stop the window being a house.
  const drop = 1 / Math.sin(half) - 1;
  const under = lug ? lug.at[1] - lug.radius - clearOf : -Infinity;
  const cap = (0.45 * wx) / Math.cos(half);
  const peak = Math.min(cap, Math.max(smoothing, ay > under ? (ay - under) / drop : 0));
  const corners: Pt[] = [[-wx, by], [wx, by], [wx, roofAt(wx)], [0, ay], [-wx, roofAt(wx)]];
  return walk(roundCorners(corners, (i) => (i === 3 ? peak : smoothing)), 0.5);
}

/** Every corner of a CCW polygon replaced by a tangent arc of `radius(i)` — the same round-over
 *  `buildRimResult`'s smoothing gave the inner corners by eroding further and growing back. */
function roundCorners(poly: Pt[], radius: (i: number) => number, steps = 12): Pt[] {
  const n = poly.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const a = poly[(i - 1 + n) % n]!;
    const b = poly[(i + 1) % n]!;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const u: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
    const v: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    // Half an edge each side is the most a corner may take, so two round-overs cannot cross.
    const r = Math.min(radius(i), (Math.min(la, lb) / 2) * Math.tan(theta / 2));
    if (!(r > 0.01) || theta < 0.05 || theta > Math.PI - 0.05) {
      out.push(p);
      continue;
    }
    const back = r / Math.tan(theta / 2);
    const bis: Pt = [u[0] + v[0], u[1] + v[1]];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    const c: Pt = [p[0] + (bis[0] / bl) * (r / Math.sin(theta / 2)), p[1] + (bis[1] / bl) * (r / Math.sin(theta / 2))];
    const t1: Pt = [p[0] + u[0] * back, p[1] + u[1] * back];
    const t2: Pt = [p[0] + v[0] * back, p[1] + v[1] * back];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    const a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= steps; k++) {
      const t = a1 + (sweep * k) / steps;
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
  }
  return out;
}

/** A ring with no chord longer than `step`. */
function walk(ring: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

/** The part of a ring on the far side of a line — Sutherland–Hodgman against one half-plane.
 *  `normal` points at the side that is kept, from the point `on`. */
function clipHalf(ring: Pt[], on: Pt, normal: Pt): Pt[] {
  const side = (p: Pt) => (p[0] - on[0]) * normal[0] + (p[1] - on[1]) * normal[1];
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

interface Fitted {
  layers: DesignLayer[];
  size: number;
  box: Box;
}

/** One line, measured once at `TRIAL_SIZE` and rebuilt at the size that fits `maxW × maxH`.
 *  Measured, never assumed: a serif's real ink box is nothing like its em size, and a name with
 *  no descender is a different height from one with a "y" in it. */
async function fitLine(spec: Omit<TextSpec, 'size'>, op: DesignLayer['op'], maxW: number, maxH: number, id: string, label: string, cap = Infinity): Promise<Fitted | null> {
  if (!spec.text.trim()) return null;
  const trial = await textLayer({ ...spec, size: TRIAL_SIZE }, op, id, label);
  if (!trial[0]) return null;
  const b = bboxOf(trial[0].shapes);
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  const size = Math.max(MIN_SIZE, Math.min(cap, (TRIAL_SIZE * Math.min(maxW / w, maxH / h))));
  if (Math.abs(size - TRIAL_SIZE) < 1e-6) return { layers: trial, size, box: b };
  const layers = await textLayer({ ...spec, size }, op, id, label);
  return layers[0] ? { layers, size, box: bboxOf(layers[0].shapes) } : null;
}

/** The same line at a size somebody else decided — the address is 0.45 × the name, never its
 *  own free fit, or the hierarchy the design asks for stops being a ratio (§4.2).
 *
 *  `floor` is the size it may not be shrunk under. It used to be `MIN_SIZE`, two millimetres of em
 *  — about 1.4 mm of ink, half the engraving floor — and the ratio could ask for less than that
 *  before the line was ever drawn, in which case nothing was drawn at all. A line the customer
 *  typed is either on the part or it is a warning; it is never silently missing. */
async function line(spec: Omit<TextSpec, 'size'>, op: DesignLayer['op'], size: number, maxW: number, id: string, label: string, floor = MIN_SIZE): Promise<Fitted | null> {
  if (!spec.text.trim()) return null;
  const asked = Math.max(floor, size);
  let layers = await textLayer({ ...spec, size: asked }, op, id, label);
  if (!layers[0]) return null;
  let b = bboxOf(layers[0].shapes);
  const w = b.maxX - b.minX;
  if (w > maxW && w > 1e-6) {
    const shrunk = Math.max(floor, (asked * maxW) / w);
    layers = await textLayer({ ...spec, size: shrunk }, op, id, label);
    if (!layers[0]) return null;
    b = bboxOf(layers[0].shapes);
    return { layers, size: shrunk, box: b };
  }
  return { layers, size: asked, box: b };
}

const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

const centreOf = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

export const houseOrnament: TemplateDef = {
  id: 'house-ornament',
  name: 'House ornament',
  blurb: 'A house with a chimney in a light rim frame — your family name across the wall, the year on the chimney.',
  // Not just "engrave + cut": the default build scores its glue guide as well, so the tag names
  // all three — the same miss the framed name ornament had (G29).
  tags: ['ornament', 'engrave + score + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'familyName', label: 'Family name', panel: 'right', section: 'Text',
      value: 'THE MORGAN FAMILY', placeholder: 'THE MORGAN FAMILY', maxLength: 24, symbols: true,
      help: 'A longer name shrinks automatically to fit the wall.',
    },
    {
      kind: 'text', key: 'address', label: 'Address', panel: 'right', section: 'Text',
      value: '123 MAPLE ST', placeholder: '123 MAPLE ST', maxLength: 24, symbols: false,
      help: 'About 45% of the family name’s size.',
    },
    {
      kind: 'text', key: 'year', label: 'Year', panel: 'right', section: 'Text',
      value: '2026', placeholder: '2026', maxLength: 4, symbols: false,
      help: 'Engraved on the chimney, and any four characters work.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'playfair-display', recommended: HOUSE_FACES },

    // ------------------------------------------------------- LEFT: "House" (opens first) --
    // The house's two sizes in one category: how wide it is, and how wide the frame round it.
    {
      // 70 mm, not 60: at 60 the chimney's face is 8.4 mm across and the card's own year engraves
      // at 2.8 mm, under the 3 mm floor, while the wall takes the default family name to 2.7 mm —
      // a slider end that warns twice about text nobody has touched is a broken end, not a size
      // (G25).
      kind: 'number', key: 'houseWidth', label: 'House width', section: 'House',
      value: 80, min: 70, max: 120, step: 1, unit: 'mm',
      help: 'Height follows automatically, keeping the 80×90 proportion.',
    },

    ...FRAME.filter((f) => f.key === 'rimWidth'),

    // ----------------------------------------------------------------- LEFT: "Lettering" --
    ...lightPieceFields('Lettering'),
    // The design is photographed in capitals and the default is typed in them, but nothing made
    // that true of what a customer types — and the fit is WIDTH-bound, so the same family name in
    // lowercase came out nearly twice as tall (7.2 mm against 3.8) for no reason the form ever
    // gave. Capitals by default, and one control to leave them.
    ...letteringFields('Lettering', { textCase: 'upper' }),

    // ------------------------------------------------------------------- LEFT: "Hanging" --
    ...FRAME.filter((f) => f.key !== 'rimWidth'),
  ],

  async build(v) {
    const W = Math.max(70, Math.min(120, num(v, 'houseWidth')));
    const H = W * HOUSE_RATIO;
    const def = blankById('house-chimney')!;
    const p: BlankParams = {
      ...def.defaults,
      width: W,
      height: H,
      // The peak boss is sized off the hole it has to carry, so the loop and the material round
      // it grow together when the customer moves to a thicker ribbon.
      holeDia: num(v, 'holeDia') || def.defaults.holeDia,
      holeSide: 'none',
      pair: false,
    };
    const outer = buildBlank(def, p);
    const house = outer[0]?.[0] ?? [];
    // The slider's own range. It is clamped here for the same reason the width is: a saved file
    // carries whatever it carries, and the window below is drawn from this number.
    const rimWidth = Math.max(5, Math.min(14, num(v, 'rimWidth')));
    // The loop rests on the blank's own hole point — the apex boss, not the bbox's top corner.
    const keyring: KeyringSpec = { ...keyringFrom(v), rest: rimLoopAnchor(def, p) };
    const raised = str(v, 'lightOp') !== 'engrave';
    const guide = str(v, 'glue') !== 'none';
    const font = str(v, 'font') || 'playfair-display';
    const symbols = readSymbols(v);
    // A share of the letter height, as a fraction (`TextSpec.letterSpacing` is `× size`), so the
    // same setting means the same thing on a 70 mm house and a 120 mm one.
    const tracking = num(v, 'letterSpacing') / 100;
    const textCase = str(v, 'textCase') || 'as-typed';
    const warnings: string[] = [];

    // ------------------------------------------------- the year, started first --
    // The chimney's face is known the moment the blank is drawn, and the year depends on nothing
    // else — not the name, not the address, not the squeeze. Run last, its two font passes were a
    // quarter of the build's critical path for no reason; started here they overlap the wall's own
    // chain and cost nothing. Awaited below, where the ink is placed.
    const chimneyIsland = chimneyAt(outer);
    const chimney = chimneyBox(outer);
    const face = chimney ? chimneyFace(house, chimney) : null;
    const yearFit = face
      ? fitLine(
          { text: applyCase(str(v, 'year'), textCase), font: DETAIL_FONT, align: 'center' },
          'engrave',
          face.maxX - face.minX,
          face.maxY - face.minY,
          'year',
          'Year',
          // A year taller than the chimney is wide reads as a mistake, not a date.
          (face.maxX - face.minX) * 0.9,
        )
      : Promise.resolve(null);
    // It is awaited below, but not until several other `await`s have had their chance to throw —
    // and a font this template hard-codes can miss on the harness's first pass. Without this the
    // rejection is nobody's, and node exits 1 on a build that succeeded on the retry.
    yearFit.catch(() => {});

    // -------------------------------------------------------------- the wall band --
    // The blank names the band it can carry text in; the frame then eats `rimWidth` off each
    // side of it, so the band is whichever is narrower. Read off the outline, not a fraction.
    const wall = textBoxOf(def, p) ?? { minX: -W / 4, maxX: W / 4, minY: -H / 8, maxY: H / 8 };
    const [wallCx, wallCy] = centreOf(wall);
    const sides = crossings(house, wallCy, 1);
    const wallSpan = sides.length >= 2 ? Math.max(...sides) - Math.min(...sides) : W;
    const bandW = Math.max(6, Math.min(wall.maxX - wall.minX, wallSpan - 2 * (rimWidth + EDGE_AIR)));
    const bandH = Math.max(4, wall.maxY - wall.minY);

    // -------------------------------------------------------------- the lettering --
    // Name, then address at 0.45 × it (§3.5's hierarchy), then the two stacked and centred in
    // the band as one block. The name's own ceiling is the share of the band the stack leaves
    // it: name + 0.35 × name of air + 0.45 × name is 1.8 name-heights.
    const nameSpec: Omit<TextSpec, 'size'> = { symbols, text: applyCase(str(v, 'familyName'), textCase), font, align: 'center', letterSpacing: tracking };
    // Raised, the nameplate's own border has to fit the band too — the letters get what is left,
    // and the border is a share of what the letters turned out to be (`plaqueMargin`). The two are
    // coupled, so it is fitted at the card's own border and re-fitted once at the border that size
    // actually wants; it converges in one pass because the border gives back more width than it
    // moves by, and it is clamped at both ends.
    let plaque = raised ? plaqueMargin(Infinity) : 0;
    let name = await fitLine(nameSpec, 'engrave', bandW - 2 * plaque, bandH / 1.8, 'name', 'Family name');
    if (raised && name) {
      const want = plaqueMargin(name.box.maxY - name.box.minY);
      if (Math.abs(want - plaque) > 0.05) {
        plaque = want;
        name = await fitLine(nameSpec, 'engrave', bandW - 2 * plaque, bandH / 1.8, 'name', 'Family name');
      }
    }

    const addrSpec: Omit<TextSpec, 'size'> = { text: applyCase(str(v, 'address'), textCase), font: DETAIL_FONT, align: 'center', letterSpacing: tracking };
    // The floor the address is never shrunk past: the size at which its capitals are the 3 mm of
    // ink that is the bottom of legible engraving. Measured off the face, not
    // guessed from the em — a condensed sans's caps are about 0.72 of its size.
    const addrFloor = await sizeForCapHeight(DETAIL_FONT, MIN_INK);
    // With a name above it the address is a RATIO of that name; alone on the wall it gets the
    // band to itself, since 0.45 × nothing is nothing. Either way the ratio may not take it below
    // the floor: 0.45 × a long family name is under 2 mm of em, and `line` used to answer that
    // with nothing at all — the address was deleted, on an in-range name, with no warning.
    const fitAddress = (k = 1) =>
      name
        ? line(addrSpec, 'engrave', 0.45 * name.size * k, bandW, 'address', 'Address', addrFloor)
        : fitLine(addrSpec, 'engrave', bandW, (bandH / 1.8) * k, 'address', 'Address');
    const address = await fitAddress();

    // What the band actually has to hold is the PLATE, not the letters on it: raised, the piece
    // hangs `plaque` below the ink, and an air gap measured off the ink alone put the plate's own
    // edge on top of the address — looked at, the glued nameplate covered the first line of it.
    const nameH = name ? name.box.maxY - name.box.minY + 2 * plaque : 0;
    const addrH = address ? address.box.maxY - address.box.minY : 0;
    const gap = name && address ? 0.35 * nameH : 0;
    const total = nameH + gap + addrH;
    // One shrink if the stack is taller than the band — a name with a descender, or a customer
    // who narrowed the house until the band grew shorter than the ratio assumed.
    const squeeze = total > bandH && total > 1e-6 ? bandH / total : 1;
    const nameFinal = squeeze < 0.999 && name ? await fitLine(nameSpec, 'engrave', bandW - 2 * plaque, (bandH / 1.8) * squeeze, 'name', 'Family name') : name;
    const addrFinal = squeeze < 0.999 && address ? await fitAddress(squeeze) : address;

    const h1 = nameFinal ? nameFinal.box.maxY - nameFinal.box.minY : 0;
    const h2 = addrFinal ? addrFinal.box.maxY - addrFinal.box.minY : 0;
    // The name's item in the stack: the nameplate raised, the bare letters engraved.
    const block = h1 + (nameFinal ? 2 * plaque : 0);
    // Between the two items, never less than the air an engrave wants off a cut edge — and the
    // plate's border IS a cut edge, a millimetre from the address.
    const air = nameFinal && addrFinal ? Math.max(0.35 * h1, EDGE_AIR) : 0;
    const stack = block + air + h2;
    const top = wallCy + stack / 2;
    // The plate is drawn symmetrically about the ink, so the item's centre is the ink's centre.
    const nameAt: Pt = [wallCx, top - block / 2];
    const addrAt: Pt = [wallCx, top - block - air - h2 / 2];

    const nameInk = nameFinal ? move(nameFinal.layers, nameAt[0] - centreOf(nameFinal.box)[0], nameAt[1] - centreOf(nameFinal.box)[1]) : [];
    const addrInk = addrFinal ? move(addrFinal.layers, addrAt[0] - centreOf(addrFinal.box)[0], addrAt[1] - centreOf(addrFinal.box)[1]) : [];

    // ------------------------------------------------------- the year on the chimney --
    // Started before the wall's chain, above; this is only where it lands.
    const year = await yearFit;
    const yearInk = year && face
      ? move(year.layers, centreOf(face)[0] - centreOf(year.box)[0], centreOf(face)[1] - centreOf(year.box)[1])
      : [];

    // --------------------------------------------------------------- the two pieces --
    // The house's own door and windows: the blank draws them, this only says how they are run.
    const detail = blankDetail(def, p).engrave ?? [];
    const windows: DesignLayer[] = detail.length ? [{ id: 'openings', label: 'Door and windows', shapes: detail.map((r) => [r]), op: 'engrave' }] : [];

    // ------------------------------------------------------------- the nameplate --
    // A PLATE, not a hug of the letters.
    //
    // The hug was the piece's whole problem. It offsets every glyph outline by the border and
    // rounds the result, so the plate follows each cap and each gap: at the 3.8 mm capitals this
    // wall sets, the "outline" is a row of small bumps behind every letter — visible at the
    // default in Playfair and unmistakable in a script (review finding 6). Raising `smoothing`
    // does not cure it: rendered at 0.63, 1.26, 1.80, 2.34 and 4.50 mm, the ripple is still there
    // at every one of them, and the offset only gets dearer. Dearer is the other half: hugging
    // 4 347 points of Playfair "THE MORGAN FAMILY" costs about 630 ms in manifold, which was 90 %
    // of this template's 767 ms build and the reason it was the slowest in the library (finding 8).
    //
    // A nameplate is a plate — a house-number plaque is a rectangle, and the file's own note has
    // said "a nameplate with the name engraved on it" since it was written. Drawn as one, it
    // cannot ripple in any face, it costs one ring instead of an offset, and its border is real
    // material rather than a web between letters, which retires the bridge finding 12 is about.
    const inkBox = nameInk.length ? bboxOf(nameInk.flatMap((l) => l.shapes)) : null;
    const plateH = inkBox ? inkBox.maxY - inkBox.minY + 2 * plaque : 0;
    const plate: Shapes = inkBox
      ? placeShapes(
          [[roundedRectRing(inkBox.maxX - inkBox.minX + 2 * plaque, plateH, PLAQUE_CORNER * plateH, 10)]],
          ...(centreOf(inkBox) as [number, number]),
          0,
        )
      : [];

    const backerLayers: DesignLayer[] = [
      ...windows,
      ...addrInk,
      // Raised: the name is its own piece and the backer carries only the trace it glues onto —
      // the PLATE's outline, because that is the edge you line a plate up by. (The framed name
      // ornament traces the glyphs for its script-letters piece and its band's outline for the
      // band; this piece is a band.) Engraved: the same letters, burned into the wall, nothing
      // to glue.
      ...(raised
        // GUIDE_INSET inside the plate's own edge, so the scored line disappears under the piece
        // it registers rather than showing as a halo round it.
        ? (guide && plate.length ? [{ id: 'name-guide', label: 'Glue guide', shapes: plate, op: 'score' as const, grow: -GUIDE_INSET }] : [])
        : nameInk.map((l) => ({ ...l, op: 'engrave' as const }))),
    ];

    const parts: PartInput[] = [
      {
        id: 'backer',
        label: 'House · dark sheet',
        blank: { kind: 'shape', shapes: outer },
        layers: backerLayers,
        // Two layers means two layers: the ribbon goes through BOTH, at the same
        // local point, so the stack cannot hang askew — the build before this one had a hole in
        // the second layer only. It was a toggle,
        // defaulting off, which is the layer option that rule exists to remove.
        keyring: 'shared',
        // The same silhouette about the same origin, so `'built'` — the piece's own box centre
        // before the sheet layout moved it — puts the glue-up back in the build frame. It is the
        // frame's own assembled centre exactly, lug included, because both pieces carry that lug.
        assembledAt: 'built',
        material: 'dark',
      },
    ];
    if (raised && nameInk.length) {
      parts.push({
        id: 'name',
        label: 'Family name · light sheet',
        blank: { kind: 'shape', shapes: plate },
        layers: nameInk.map((l) => ({ ...l, op: 'engrave' as const })),
        keyring: 'none',
        // The plate is drawn on the ink's own centre, so the nameplate's centre IS the ink's —
        // which is exactly where the glue guide is scored on the backer.
        assembledAt: { x: nameAt[0], y: nameAt[1] },
        material: 'light',
      });
    }

    // ------------------------------------------------------------------ what to say --
    // Both floors are the same sourced number: engraved lettering under 3 mm tall stops reading.
    // The fit never throws and never refuses — it shrinks, and says so.
    if (nameFinal && h1 < MIN_INK) warnings.push('Family name is long for this wall — try a shorter one, or a wider house.');
    // The address is held at the floor rather than shrunk under it, so the only way it can fail
    // now is by being WIDER than the wall — which the plate then clips. That is the thing to say:
    // not "it is tiny" (it is not, it is 3 mm), and never nothing at all.
    if (addrFinal && addrFinal.box.maxX - addrFinal.box.minX > bandW + 0.05) {
      warnings.push('The address is too long for this width — shorten it.');
    }
    if (year && year.box.maxY - year.box.minY < MIN_INK) warnings.push('The year is tiny on this chimney — widen the house to give it room.');

    // ------------------------------------------------------------------- the frame --
    // The blank's own silhouette with the gable's window taken out of it, and the chimney cut
    // back to halfway down the roof band so the half of it that is buried in the roof cannot hang
    // into that window. The peak boss keeps its whole circle: it is the material the loop is
    // welded to, and the lug covers the 2 mm of it that reaches past the window's apex.
    const lug = keyring.enabled && keyring.mode === 'outside' && keyring.rest
      ? { at: keyring.rest, radius: keyring.dia / 2 + keyring.ring }
      : null;
    const framed: Shapes = [
      [house, houseWindow(house, rimWidth, 0.35 * rimWidth, lug).reverse()],
      ...outer.slice(1).map((island, i) => {
        if (i + 1 !== chimneyIsland) return island;
        const { eave, inward } = gable(house);
        return [clipHalf(island[0]!, [eave[0] + (rimWidth / 2) * inward[0], eave[1] + (rimWidth / 2) * inward[1]], [-inward[0], -inward[1]])];
      }),
    ];

    const pieces = 2 + (raised && nameInk.length ? 1 : 0);
    return {
      label: 'Frame · light sheet',
      material: 'light',
      blank: { kind: 'shape', shapes: framed },
      keyring,
      // The frame's only mark: the year on its chimney (see the header). It clips to the ring
      // like every other engrave, so a chimney the rim ever failed to fill would simply lose it.
      layers: yearInk,
      parts,
      layout: { flow: 'row', gap: 6 },
      status: pieces === 3 ? '3 pieces · dark house, light frame and name' : '2 pieces · dark house, light frame',
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // A function, not a string (G27): "the light frame and name from another sheet, then glue" is a
  // lie in Engrave mode, where the only light piece is the frame and there is nothing to glue.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the dark house from one sheet and the light frame from another — nothing to glue.'
      : 'Cut the dark house from one sheet and the light frame and nameplate from another, then glue.',

  fileName: (v) => stem(str(v, 'familyName') || 'house', 'ornament'),
};
