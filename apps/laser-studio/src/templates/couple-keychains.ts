// Matching keychains: two rounded-rectangle tags that sit side by side and carry ONE heart
// between them — half on each — with an initial beside each lobe and the date whole at the
// bottom of both. Since 2026-09-21 there is no jigsaw setting, and the date is never split in
// the middle.
//
// WHAT WENT (2026-09-21). The jigsaw seam, the "Shaped" tag style, the symbol picker and the
// split/repeated date are all gone. One object, one shape, no style control: two tags, a heart,
// two initials, a date. The date is never cut in half again — each tag carries the whole string
// (and its own string, when "Different text on each" is on).
//
// THE RING (2026-09-22). The bespoke "Hanging hole" toggle this shipped with gave way to the
// usual keyring, placed as a hole by default. So the Keyring section is
// the shared one — the same control, the same drag, the same nudge — with the opt-in that put
// "Hole" back in it for this design alone (`keyringFields(…, { hole: true })`), and Hole as the
// default. Whatever it is set to, both tags wear it: the LEFT tag is the primary and the RIGHT
// one carries the same spec resting at the mirror of where the left one settled.
//
// …and on 2026-09-28 the Hole went, as asked the first time: the ring is the usual loop tab,
// RESTING inside the tag where the hole was (`rest: 'inside'`), so the design looks as it did —
// the same plate to the last digit — and drags like any tab, even off the edge. The one place a
// tab can lose its wall here is a drag onto the cut-through heart, which is cut after the ring;
// that says so rather than cutting the border away in silence.
//
// THE ONE FRAME. Both tags are built in the PAIR's frame, seam at x = 0: the left tag spans
// x ∈ [−(g + w), −g] and the right x ∈ [g, g + w], where g = GAP/2. Everything that has to line
// up across the join — the heart's two halves, the two holes — is written once at x = 0 and
// both tags read the same numbers. `layout` lays them on the sheet at the SAME 0.5 mm gap they
// were built at, so the cut sheet already reads as the product photo, and `assembledAt: 'built'`
// puts the right tag back in the build frame for the card and the 3D view.
//
// WHY 0.5 mm AND NOT MORE. The pair is one picture; a 4 mm alley through the middle of a heart
// is not. The sliver between the two outlines is scrap — nothing on either tag depends on it —
// so the §2.5 "keep two cut paths a thickness apart" floor, which is about material that has to
// SURVIVE, does not bind here. What the beam does take is real and is paid for: each half of
// the heart stops kerf/2 short of its own tag's edge, which is exactly the ink that survives
// the cut, so the two halves meet with a hairline reveal rather than a scorched one.
//
// Rules of thumb: two independent pieces, never a jigsaw; ~25 × 55 tags; heart engraved or cut
// through; hole 4–5 mm, ≥ 3 mm of wall, near the top edge; a web that carries load ≥ 3 mm on
// 3 mm stock.
import { bboxOf, heartRing, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { distanceToOutline, finalHoleCentre, insideShapes, keyringCentre } from '../engine/editorGeometry';
import { keyringFields, keyringFrom } from './keyring';
import { stem } from './shared';
import type { DesignLayer, KeyringSpec, OpChoice, PartInput } from '../engine/types';
import { bool, num, str, type TemplateDef } from './types';

type Pt = [number, number];
type Side = -1 | 1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The air between the two tags, mm — the join. Small enough that the pair reads as one
 *  picture on the sheet, the card and the 3D view; the material in it is scrap. */
const TAG_GAP = 0.5;
/** The wall the hanging hole keeps all the way round (§5.2: ≥ 3 mm on something that carries
 *  keys) — the Hole border the Ring control ships at. It is also what decides where the ring
 *  RESTS: the shared control insets it `border + dia/2` from the top edge, so the shipped 4 mm
 *  hole with its 3 mm wall sits 5 mm down, which is §5.2's worked example. A bigger hole or a
 *  wider border moves the hole DOWN rather than eating the wall. */
const HOLE_WALL = 3;
/** Material left beside a cut-through half-heart, and the top margin when there is no hole.
 *  §2.1: a web ≥ the material thickness and never under 1 mm; 3 mm on 3 mm stock. */
const WEB = 3;
const TOP_MARGIN = 4;
/** The band an initial needs beside the heart's lobe — a 3 mm capital plus its air. The heart
 *  is clamped so this band always exists. */
const INITIAL_BAND = 5;
/** Air between the heart and the hole above it / the date below it. */
const HEART_CLEAR = 3;
/** The heart's height as a share of its width — the proportion `@vostok/laser`'s own heart
 *  blank ships at (34 × 30). */
const HEART_RATIO = 0.88;
/** Ink to the bottom edge under the date, and to the side edges beside it. */
const BOTTOM_MARGIN = 5;
const DATE_MARGIN = 3.5;
/** A capital under this stops reading once it is burnt into wood. */
const MIN_CAP = 3;
/** Air between the heart's widest point and the initial beside it. */
const INITIAL_AIR = 1.5;

/** A plain rectangle as an island — the half-planes the heart's engrave is clipped with. */
const rect = (x0: number, y0: number, x1: number, y1: number): Shapes =>
  [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as CutRing]];

/** The ink box of a run of shapes, or null when there is no ink. */
const inkBox = (s: Shapes) => (s.length ? bboxOf(s) : null);

/** The part of a ring left of the line x = `edge` — one half-plane, so Sutherland–Hodgman is
 *  exact. The left tag's half of the heart. */
const leftOf = (ring: CutRing, edge: number): CutRing => {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const inA = a[0] <= edge;
    if (inA) out.push([a[0], a[1]]);
    if (inA !== b[0] <= edge) out.push([edge, a[1] + ((edge - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
  }
  return out as CutRing;
};

// ------------------------------------------------------------------- the vertical stack --

interface Stack {
  heartW: number;
  heartH: number;
  heartY: number;
  /** The heart's lobe centres — where the initial beside it sits. */
  lobeY: number;
  /** Cap height of the initial, mm; its band is exactly this tall. */
  initialCap: number;
  /** Distance from the JOIN to the initial's centre, and how wide its band is. */
  initialX: number;
  initialBand: number;
  dateCap: number;
  dateY: number;
  /** The heart was asked for bigger than the tags can hold. */
  heartTrimmed: boolean;
}

/**
 * Top to bottom, per tag: hole · heart (with the initials beside its lobes) · date.
 *
 * The heart is the one band that gives way. Its ceiling is the hole's own wall and its floor is
 * the date's, so the heart is trimmed to whatever is left between them — never the hole moved,
 * never the date shrunk, because both of those are decided by what the thing IS (§5.2's wall,
 * the 3 mm readable floor). Sideways the same rule: the heart may not eat the web at the tag's
 * outer edge (§2.1, and a cut-through heart is a notch in the inner edge, so that web is all
 * that holds the tag's two ends together) nor the band the initial lives in.
 */
function stackOf(o: {
  width: number; height: number; holeDia: number;
  /** Where the ring RESTS on the tag's centre line when it rests inside the tag — the punched
   *  hole until 2026-09-28, the loop tab resting where it was since — or null when it stands
   *  outside the edge or is off, and the face is the design's, all of it. The drag may then take
   *  it elsewhere; the band stays where the design put it, so the heart does not jump about under
   *  the pointer (the engine warns if the ring lands on the lettering). */
  holeY: number | null;
  heartSize: number; dateCap: number;
}): Stack {
  const w = o.width;
  const h = o.height;
  const ceiling = o.holeY != null ? o.holeY - o.holeDia / 2 - HEART_CLEAR : h / 2 - TOP_MARGIN;
  const dateY = -h / 2 + BOTTOM_MARGIN + o.dateCap / 2;
  const floor = o.dateCap > 0 ? dateY + o.dateCap / 2 + HEART_CLEAR : -h / 2 + BOTTOM_MARGIN;
  const bandH = Math.max(ceiling - floor, 6);

  const room = Math.min(2 * (w - WEB - INITIAL_BAND), bandH / HEART_RATIO);
  const heartW = clamp(Math.min(o.heartSize, room), 8, 200);
  const heartH = heartW * HEART_RATIO;
  const heartY = (ceiling + floor) / 2;
  // The lobes are circles of r = heartW/4 whose centres sit r below the heart's top.
  const lobeY = heartY + heartH / 2 - heartW / 4;

  // The initial's band runs from the heart's widest point out to the tag's own margin, measured
  // from the JOIN (x = 0) so both tags read the same number.
  const inner = heartW / 2 + INITIAL_AIR;
  const outer = TAG_GAP / 2 + w - WEB;
  const bandW = Math.max(outer - inner, 0);
  const initialCap = clamp(0.28 * w, 5, 11);

  return {
    heartW, heartH, heartY, lobeY,
    initialCap, initialX: (inner + outer) / 2, initialBand: bandW,
    dateCap: o.dateCap, dateY,
    heartTrimmed: o.heartSize > heartW + 0.05,
  };
}

// --------------------------------------------------------------------------- the form --

/** Faces for a single engraved capital: a serif or a script, which is what this object wears
 *  (inscriptional caps). Each is built here at the shipped size and
 *  read back before it went on the list (tests/node/couple-keychains.test.mjs, the fonts
 *  section): 5–12 mm of letter, at least 12 % of its own box in ink so the strokes still exist
 *  at that size, and inside the band beside the heart with 3 mm off the outer edge. */
const INITIAL_FACES = ['cinzel', 'playfair-display', 'marcellus', 'lora', 'eb-garamond', 'great-vibes', 'parisienne'];

/** Faces for eight characters of date at a 3.5 mm cap: clean sans only, digits that keep their
 *  counters open when a beam has had its 0.2 mm (§2.6). Verified the same way. */
const DATE_FACES = ['inter', 'montserrat', 'work-sans', 'figtree', 'manrope', 'archivo', 'rubik'];

export const coupleKeychains: TemplateDef = {
  id: 'couple-keychains',
  name: 'Matching keychains',
  blurb: 'Two tags that carry half a heart each, an initial beside it and the date on both.',
  tags: ['couple', 'keychain', 'engrave + cut'],
  fields: [
    // ------------------------------------------------------------------ RIGHT --
    {
      kind: 'text', key: 'initialLeft', label: 'Initial 1', panel: 'right', section: 'Initials',
      value: 'A', maxLength: 2, symbols: false, placeholder: 'One letter',
    },
    {
      kind: 'text', key: 'initialRight', label: 'Initial 2', panel: 'right', section: 'Initials',
      value: 'N', maxLength: 2, symbols: false, placeholder: 'One letter',
    },
    {
      kind: 'text', key: 'date', label: 'Date', panel: 'right', section: 'Date',
      value: '06.14.25', maxLength: 12, symbols: false, placeholder: 'A date, or a short word',
    },
    {
      // Either the same date on both keychains, or different text on each. Off is the same
      // string on both, whole — never half a date per tag.
      kind: 'toggle', key: 'dateDifferent', label: 'Different text on each', panel: 'right', section: 'Date', value: false,
    },
    {
      kind: 'text', key: 'date2', label: 'Date 2', panel: 'right', section: 'Date',
      value: 'Always', maxLength: 12, symbols: false, placeholder: 'What the second tag says',
      visibleWhen: (v) => v.dateDifferent === true,
    },
    { kind: 'font', key: 'font', label: 'Initial font', panel: 'right', section: 'Font', value: 'cinzel', recommended: INITIAL_FACES },
    { kind: 'font', key: 'dateFont', label: 'Date font', panel: 'right', section: 'Font', value: 'inter', recommended: DATE_FACES },

    // ------------------------------------------------------------ LEFT: "Tags" --
    // Both ends build the shipped design with nothing to say (G25): under 24 mm the default
    // date no longer fits between the margins, and under 45 mm tall the default heart no longer
    // fits between the hole's wall and the date's — a slider end that warns is not a range.
    { kind: 'number', key: 'width', label: 'Width', section: 'Tags', value: 28, min: 24, max: 42, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Tags', value: 60, min: 45, max: 85, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'corner', label: 'Corner radius', section: 'Tags', value: 6,
      min: 0, max: 12, step: 0.5, unit: 'mm',
    },
    {
      kind: 'select', key: 'heartOp', label: 'Heart', section: 'Tags', value: 'engrave',
      options: [{ value: 'engrave', label: 'Engraved' }, { value: 'cut', label: 'Cut through' }],
      help: 'Cut through bites the heart out of both inner edges.',
    },
    {
      kind: 'number', key: 'heartSize', label: 'Heart size', section: 'Tags', value: 26, min: 14, max: 40, step: 1, unit: 'mm',
      help: 'Across both tags — each one carries half.',
    },
    {
      // The kerf sets how far each half of the heart stops short of the join, so it is a real
      // setting here even though nothing is jointed — and it belongs to the heart, so it sits
      // under it.
      kind: 'number', key: 'kerf', label: 'Kerf', section: 'Tags', value: 0.18,
      min: 0.05, max: 0.4, step: 0.01, unit: 'mm',
      help: 'The width the laser burns away.',
    },

    // ------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'dateSize', label: 'Date size', section: 'Lettering', value: 3.5,
      min: 3, max: 6, step: 0.5, unit: 'mm',
      help: 'Long text shrinks past this to fit.',
    },

    // --------------------------------------------------------- LEFT: "Keyring" --
    // The usual Keyring section, placed as a hole by default. So this is the control every other
    // design shows, Loop
    // tab | None, and since 2026-09-28 its tab RESTS inside the tag, where the hole was: two tags
    // that hang side by side on one ring is the product.
    //
    // The numbers are the tag's, not the shared defaults (G25). The border is §5.2's 3 mm — which
    // also rests the ring 5 mm below the top edge — and stops at 5: the keep-off disc is
    // `dia + 2 × border` across, so the shared 8 mm would be 20 mm of a 28 mm tag. The nudge is
    // half the tag's own height, so the ring reaches any point ON the tag and nowhere else.
    ...keyringFields('outside', {
      rest: 'inside', dia: 4, ring: HOLE_WALL, side: 'top', along: 50, nudge: 30, maxDia: 6, maxRing: 5,
      ringNote: 'Both tags wear the same ring, mirrored.',
    }),

  ],

  async build(v) {
    const warnings: string[] = [];
    const w = clamp(num(v, 'width'), 12, 120);
    const h = clamp(num(v, 'height'), 24, 160);
    const corner = clamp(num(v, 'corner'), 0, 0.45 * Math.min(w, h));
    const kerf = clamp(num(v, 'kerf'), 0.01, 1);
    const font = str(v, 'font');
    const dateFont = str(v, 'dateFont');
    const heartCut: OpChoice = str(v, 'heartOp') === 'cut' ? 'cut' : 'engrave';
    const dateOf = (side: Side) => (side < 0 || !bool(v, 'dateDifferent') ? str(v, 'date') : str(v, 'date2')).trim();
    const hasDate = !!(dateOf(-1) || dateOf(1));

    const g = TAG_GAP / 2;
    /** The centre of one tag, in the pair's frame. */
    const cx = (side: Side) => side * (g + w / 2);

    // ------------------------------------------------------------- the two bodies --
    const tagRing = (side: Side): Shapes => placeShapes([[roundedRectRing(w, h, corner)]], cx(side), 0, 0);
    const leftBody = tagRing(-1);
    const rightBody = tagRing(1);

    // ------------------------------------------------------------- the two rings --
    // The shared Ring control: a loop tab resting inside the tag, where the hole was (2026-09-28).
    // The LEFT tag is the primary, so the engine places its ring exactly as it does on every
    // other design — the resting point, the drag, the nudge, the neck when it floats clear. The
    // right tag is a part, and a part may carry its own keyring: it gets THIS one, resting at the
    // mirror of wherever the left one settled, so both tags wear the same tab and the pair stays
    // symmetrical. They cannot drift: there is one number and the second tag is the first one
    // negated.
    const keyring: KeyringSpec = keyringFrom(v);
    const inside = keyring.enabled && keyring.restInside === true;
    const holeDia = clamp(keyring.dia, 1.5, 8);
    const leftHole: Pt | null = keyring.enabled ? finalHoleCentre(leftBody, keyring).centre : null;
    /** The same ring, undragged — where this design hangs from before anyone touches it. */
    const atRest: KeyringSpec = { ...keyring, position: -1, dx: 0, dy: 0 };
    const rightRing: PartInput['keyring'] = leftHole
      ? { ...atRest, rest: [-leftHole[0], leftHole[1]] }
      : 'none';

    const s = stackOf({
      width: w, height: h, holeDia,
      // Where the hole RESTS — the design's own hanging point, `side`/`along` and nothing else.
      // Not where it was dragged: a band that follows the pointer would squash the heart the
      // moment the hole was pulled down the tag, and a drag onto the design is what the engine's
      // "the ring sits on the lettering" is for. The layout is the design's; the drag is the
      // customer's.
      holeY: inside ? keyringCentre(leftBody, atRest)[1] : null,
      heartSize: clamp(num(v, 'heartSize'), 6, 120),
      dateCap: hasDate ? clamp(num(v, 'dateSize'), MIN_CAP, 20) : 0,
    });
    if (s.heartTrimmed) warnings.push('Heart trimmed to fit — raise Width or Height for the full size.');

    // -------------------------------------------------------------------- the heart --
    // One heart, centred on the join. Its two halves are the SAME ring clipped to either side,
    // which is what makes them mirror images rather than two drawings that nearly agree.
    const heart: Shapes = placeShapes([[heartRing(s.heartW, s.heartH, 72)]], 0, s.heartY, 0);
    const span = 2 * (w + h);
    /** This tag's side of the join. An ENGRAVE stops kerf/2 inside the tag's own edge — that is
     *  exactly the ink the cut does not burn away, so the two halves meet with a hairline reveal
     *  rather than a scorched one. A CUT stops ON the edge: the notch's flat side is the tag's
     *  own outline and is never cut twice. Either way the layer stays inside its tag's box,
     *  which is what keeps `layout` laying the pair out at the gap it was built at. */
    const half = (side: Side, inset: number): Shapes =>
      side < 0 ? rect(-span, -span, -(g + inset), span) : rect(g + inset, -span, span, span);
    const heartLayer = (side: Side): DesignLayer[] => ([{
      id: 'heart', label: 'Heart', shapes: heart, op: heartCut,
      keep: half(side, heartCut === 'cut' ? 0 : kerf / 2),
      ...(heartCut === 'cut' ? { stencil: false } : {}),
    }]);

    // ---------------------------------------------------------------- the lettering --
    /** One initial, beside its tag's own lobe of the heart. It may only SHRINK: moving it is
     *  what put three initials on the wrong tag in the version this replaces. */
    const initialLayer = async (side: Side): Promise<DesignLayer[]> => {
      const text = str(v, side < 0 ? 'initialLeft' : 'initialRight').trim();
      if (!text) return [];
      const x = side * s.initialX;
      const id = side < 0 ? 'initial-left' : 'initial-right';
      const draw = async (cap: number) =>
        textLayer({ text, font, size: await sizeForCapHeight(font, cap), x, y: s.lobeY }, 'engrave', id, 'Initial');
      let cap = s.initialCap;
      let built = await draw(cap);
      let b = inkBox(built.flatMap((l) => l.shapes));
      if (!b) return [];
      const room = s.initialBand;
      if (b.maxX - b.minX > room) {
        // It shrinks to whatever the band is, with no floor: a letter held at 3 mm while the
        // band is 2 mm wide runs onto the heart and is clipped by the plate, which is a broken
        // file dressed as a warning. The floor is what the sentence is ABOUT, not a clamp.
        cap = (cap * room) / (b.maxX - b.minX);
        built = await draw(cap);
        b = inkBox(built.flatMap((l) => l.shapes));
        if (cap < MIN_CAP - 0.05) warnings.push('The initials only fit under 3 mm — use one letter, or wider tags.');
      }
      return b ? built : [];
    };

    /** The date, WHOLE, centred at the bottom of its own tag — never split in the middle. It
     *  shrinks to the tag's width and stops at the readable floor. */
    const dateLayer = async (side: Side): Promise<DesignLayer[]> => {
      const text = dateOf(side);
      if (!text || s.dateCap <= 0) return [];
      const id = side < 0 ? 'date-left' : 'date-right';
      const draw = async (cap: number) =>
        textLayer({ text, font: dateFont, size: await sizeForCapHeight(dateFont, cap), x: cx(side), y: s.dateY }, 'engrave', id, 'Date');
      let cap = s.dateCap;
      let built = await draw(cap);
      let b = inkBox(built.flatMap((l) => l.shapes));
      if (!b) return [];
      const room = w - 2 * DATE_MARGIN;
      if (b.maxX - b.minX > room) {
        // Same rule as the initial: it always fits, and the sentence says when that cost it its
        // legibility. A date clipped at the tag's edge is worse than a small one.
        cap = (cap * room) / (b.maxX - b.minX);
        built = await draw(cap);
        b = inkBox(built.flatMap((l) => l.shapes));
        if (cap < MIN_CAP - 0.05) warnings.push('The date is too long for these tags — shorten it, or raise Width.');
      }
      return b ? built : [];
    };

    const layersOf = async (side: Side): Promise<DesignLayer[]> => [
      ...heartLayer(side),
      ...(await initialLayer(side)),
      ...(await dateLayer(side)),
    ];

    // ------------------------------------------------------------- the two pieces --
    const rightPart: PartInput = {
      id: 'right',
      label: 'Right',
      blank: { kind: 'shape', shapes: rightBody, oneIsland: true },
      layers: await layersOf(1),
      // Its own ring, at the mirror of the left tag's — the tags match wherever the control puts
      // it, and a tab on the second tag is a tab and not a drawing of one.
      keyring: rightRing,
      // Both tags were built seam to seam; the sheet lays them out at the same gap, so gluing
      // up is a no-op — but saying it keeps the card and the 3D view honest if the gap changes.
      assembledAt: 'built',
      material: 'light',
    };

    if (heartCut === 'cut') {
      // The half-heart is a notch in the tag's INNER edge, so what holds the tag together is
      // the web at its outer edge. `stackOf` clamps the heart so this is ≥ 3 mm; it is stated
      // here so a future change to the clamp trips the warning rather than shipping a snapped
      // tag (§2.1: a loaded web ≥ the material thickness, never under 1 mm).
      const outerWeb = w - s.heartW / 2;
      if (outerWeb < WEB - 1e-6) warnings.push('The cut heart leaves the tags too thin — lower Heart size.');
      // The heart is cut AFTER the ring is welded on, so a tab dragged onto it loses whatever of
      // its border the heart runs through — the one placement on this design that can thin a
      // tab's wall (2026-09-28, `keyring.test.mjs` sweeps it). Measured on the left tag's half,
      // the notch itself; the right tag's is its mirror.
      if (leftHole) {
        const notch: Shapes = [[leftOf(heart[0]![0]!, -g)]];
        const air = insideShapes(notch, leftHole) ? 0 : distanceToOutline(notch, leftHole);
        if (air < holeDia / 2 + keyring.ring - 0.05) warnings.push('The ring runs into the cut heart — drag it clear.');
      }
    }

    return {
      label: 'Left',
      blank: { kind: 'shape', shapes: leftBody, oneIsland: true },
      keyring,
      layers: await layersOf(-1),
      parts: [rightPart],
      // The join, on the sheet as well as in the picture: the cut file IS the product photo.
      layout: { flow: 'row', gap: TAG_GAP },
      material: 'light',
      // Both tags are built by the same code, so a sentence about the date is said twice.
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
    };
  },

  exportNote: (v) => (str(v, 'heartOp') === 'cut'
    ? 'Cut both tags — the heart appears when they sit together.'
    : 'Cut both tags — the heart completes when they sit together.'),

  fileName: (v) => stem(str(v, 'initialLeft').toLowerCase() || 'one', str(v, 'initialRight').toLowerCase() || 'two', 'keychains'),
};
