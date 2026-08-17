// The seven box styles. Each one returns panels; `buildNet` turns those into a
// dieline and a fold rig without the builder ever drawing a silhouette.
//
// Nothing here is transcribed from a standard. Every published carton library that
// was checked against our own parameter range produced negative, zero or colliding
// geometry somewhere inside it — a dust flap that overlaps by 10.5 mm on any square
// box, a 12 mm tuck on an 8 mm-tall box, a 45 degree glue taper that needs 24 mm of
// height before the two tapers stop crossing. So these are derived and clamped, and
// the clamps are the interesting part.

import type { BoxParams, LoosePart, Panel, Poly, Pt, Slit, StyleParts } from '../types';
import { bboxOf, rect, roundCorners, roundedRect, stadium, translate } from './poly';
import {
  HALF,
  bladeShoulder,
  clamp,
  closure,
  dustDepth,
  dustFlap,
  euroSlot,
  glueTab,
  handleBlade,
  relief,
  rollEnd,
  tray,
  tube,
  tuckDepth,
} from './primitives';

export interface StyleMeta {
  id: BoxParams['style'];
  /** Full name, for the export title and the assembly sheet. */
  name: string;
  /** Card label. The picker is eight tiles in a 280 px sidebar, so a name that
   *  wraps to three lines makes every tile in the row that tall — which is how the
   *  picker came to be 574 px of a 674 px panel. */
  short: string;
  blurb: string;
  /** Assembles with nothing but the board. Badged in the UI and stated in the
   *  assembly sheet, because "no glue" is the only question most people have. */
  glueFree: boolean;
  /** Which controls this style actually uses, so the UI can hide the rest rather
   *  than showing dead sliders. */
  uses: {
    lid?: boolean;
    tuck?: boolean;
    glue?: boolean;
    /** A handle whose height is worth a slider. */
    handle?: boolean;
    /** Hand holes cut through a wall, on or off. */
    handHoles?: boolean;
    divider?: boolean;
    window?: boolean;
  };
}

// Ordered glue-free first, because that is the question people actually arrive with.
// `glueFree` is not decoration — the UI badges it and the export sheet says so, and
// the three styles that are false are false for one specific reason: a tube has to
// close on itself somewhere, and only a lap does that on 300 gsm card.
export const STYLES: StyleMeta[] = [
  {
    id: 'mailer',
    name: 'Mailer box',
    short: 'Mailer',
    blurb:
      'The subscription-box shape. Roll each end down, push two tabs through the floor, tuck the lid.',
    glueFree: true,
    // No `tuck` — the RETT's tuck is full-depth by construction and reads nothing
    // from the tuck sliders. Showing them here is what "the settings make no sense"
    // means: three controls that move and change nothing.
    uses: { handHoles: true, window: true },
  },
  {
    id: 'handle-box',
    name: 'Carry box with handle',
    short: 'Carry box',
    blurb:
      'Two lids meet in the middle and their handles lock up through the side wings. Big blank.',
    glueFree: true,
    uses: { handle: true, window: true },
  },
  {
    id: 'tray',
    name: 'Tray',
    short: 'Tray',
    blurb:
      'Open tray. Each end rolls over the corner ears and locks into the floor. Raise the sides for a carry basket.',
    glueFree: true,
    // A tray is open on top; there is no face to put a window in that is not either
    // the floor or the wall the grip is already cut out of.
    uses: { handle: true },
  },
  {
    id: 'tray-lid',
    name: 'Tray & lid',
    short: 'Tray & lid',
    blurb: 'Two of the same locking tray, one nesting over the other.',
    glueFree: true,
    uses: { lid: true, window: true },
  },
  {
    id: 'divider',
    name: 'Divider insert',
    short: 'Dividers',
    blurb: 'Slot-together strips that drop into a box you already have.',
    glueFree: true,
    uses: { divider: true },
  },
  {
    id: 'tuck-top',
    name: 'Tuck-top carton',
    short: 'Tuck carton',
    blurb: 'The standard reverse tuck carton: dust flaps and a tuck at each end.',
    glueFree: false,
    uses: { tuck: true, glue: true, window: true },
  },
  {
    id: 'snap-lock',
    name: 'Interlocking base',
    short: 'Snap-lock',
    blurb: 'Tuck lid over a base that locks itself with a tongue through a slot.',
    glueFree: false,
    uses: { tuck: true, glue: true, window: true },
  },
  {
    id: 'sleeve',
    name: 'Sleeve',
    short: 'Sleeve',
    blurb: 'An open-ended wrap. Slide it over a tray, or use it as a belly band.',
    glueFree: false,
    uses: { glue: true, window: true },
  },
];

/** Inside dimensions, whatever basis the user typed in. Everything downstream works
 *  in inside dimensions, because that is the number that has to fit the product. */
export function insideDims(p: BoxParams): { L: number; W: number; H: number } {
  const t = p.caliperMm;
  if (p.dimBasis === 'outside') {
    return {
      L: Math.max(10, p.lengthMm - 2 * t),
      W: Math.max(10, p.widthMm - 2 * t),
      H: Math.max(5, p.heightMm - 2 * t),
    };
  }
  return { L: p.lengthMm, W: p.widthMm, H: p.heightMm };
}

// ────────────────────────────────── window ──────────────────────────────────

/** The converter rule: a window sits at least this far from every fold and cut, or
 *  the panel loses the stiffness that keeps it from creasing where it should not. */
export const TRADE_INSET = 15;

/** Cut an aperture in a named panel and, if asked, emit the film insert that goes
 *  behind it.
 *
 *  The 15 mm rule is the one hard geometric constraint in folding-carton design:
 *  a window closer than that to a fold or a cut takes the panel's stiffness with it
 *  and the box creases where it should not. It is enforced by shrinking the aperture
 *  rather than by refusing, and the caller raises the diagnostic. */
export function applyWindow(
  parts: StyleParts,
  panelId: string,
  p: BoxParams,
): { parts: StyleParts; fitted: boolean; insetMm: number } {
  if (!p.window) return { parts, fitted: true, insetMm: TRADE_INSET };
  const host = parts.panels.find((x) => x.id === panelId);
  if (!host) return { parts, fitted: true, insetMm: TRADE_INSET };

  const xs = host.outline.map((v) => v[0]);
  const ys = host.outline.map((v) => v[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const pw = Math.max(...xs) - x0;
  const ph = Math.max(...ys) - y0;

  // The trade rule is 15 mm clear of every fold and cut. It comes from rotary dies
  // and high-speed folder-gluers, and on a hand-folded box this small it is simply
  // unachievable: 15 mm either side of a 35 mm panel leaves 5 mm of window. So the
  // border scales down with the panel and the caller says so when it does — a real
  // constraint reported honestly beats a rule that refuses to make anything.
  const inset = clamp(Math.min(TRADE_INSET, Math.min(pw, ph) * 0.25), 4, TRADE_INSET);
  const w = Math.min(pw * p.windowScale, pw - 2 * inset);
  const h = Math.min(ph * p.windowScale, ph - 2 * inset);
  const fitted = w >= 8 && h >= 8;
  if (!fitted) return { parts, fitted: false, insetMm: inset };

  const r = Math.min(p.windowRadiusMm, w / 2, h / 2);
  const aperture = roundedRect(x0 + (pw - w) / 2, y0 + (ph - h) / 2, w, h, r);

  const panels = parts.panels.map((x) =>
    x.id === panelId ? { ...x, holes: [...x.holes, aperture] } : x,
  );

  const loose = [...parts.loose];
  if (p.filmInsert) {
    const m = p.filmMarginMm;
    // The film is cut as its own part and glued behind the aperture; the margin is
    // the glue land. Under 3 mm the bond gaps, which is why the slider floors there.
    loose.push({
      id: 'film',
      label: 'Window film (acetate / PET)',
      op: 'film',
      outline: roundedRect(
        x0 + (pw - w) / 2 - m,
        y0 + (ph - h) / 2 - m,
        w + 2 * m,
        h + 2 * m,
        r > 0 ? r + m : 0,
      ),
      holes: [],
    });
  }

  return {
    parts: {
      ...parts,
      panels,
      loose,
      assembly: [
        ...parts.assembly,
        p.filmInsert
          ? 'Glue the film panel behind the window from the inside, then let it dry flat before folding.'
          : 'Leave the window open, or tape a piece of acetate behind it.',
      ],
    },
    fitted: true,
    insetMm: inset,
  };
}

// ────────────────────────────────── plain tray ──────────────────────────────────

/** One tray on its own — the everyday glue-free box. With the handle turned on, the
 *  two long walls grow a raised grip and it becomes a carry basket, which is by a
 *  wide margin the most compact handled box here: no lid, no wings, no blades, so
 *  the blank is barely bigger than the tray itself. */
function buildTray(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const rise = p.handle ? clamp(p.handleHeightMm, 12, 140) : 0;
  const { panels, slits } = tray({
    prefix: 'tr-',
    labelPrefix: '',
    L,
    W,
    H,
    t: p.caliperMm,
    x: H + 2,
    y: H + rise + 2,
    handleRiseMm: rise,
  });
  return {
    panels,
    slits,
    rootId: 'tr-base',
    loose: [],
    assembly: [
      'Fold the two long walls up, then fold the ear at each of their four corners inward.',
      'Roll each end over the ears: the wall up, the narrow strip across the top, the inner panel straight back down inside.',
      'Push the two tabs on each inner panel through the slots in the floor. The ears are now trapped between the two plies of the end and the tray holds itself square — nothing is glued and nothing needs to be.',
      ...(rise > 0
        ? ['Carry it by the two raised grips. Under 300 gsm, fold a spare strip over the top edge of each grip before you load it up.']
        : []),
    ],
  };
}

// ───────────────────────────────── tray & lid ─────────────────────────────────

function buildTrayLid(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const gap = 8;

  const base = tray({ prefix: 'tr-', labelPrefix: 'tray ', L, W, H, t, x: 0, y: 0 });

  // The lid nests over the tray, so its inside must clear the tray's OUTSIDE — and
  // the tray's outside is now its FLOOR, because the rolled ends fold up from the
  // floor's edge and the long walls from theirs. Play goes on top of that. A
  // percentage clearance, which is what the incumbent uses, is wrong at both ends:
  // 7% of 30 mm is sloppy and 7% of 300 mm falls off.
  const lidL = L + 5 * t + 2 * p.lidPlayMm;
  const lidW = W + 2 * t + 2 * p.lidPlayMm;
  const lidH = clamp(p.lidHeightMm, 6, Math.max(8, H));

  const lid = tray({
    prefix: 'ld-',
    labelPrefix: 'lid ',
    L: lidL,
    W: lidW,
    H: lidH,
    t,
    x: 0,
    y: 0,
    // The lid arrives from above, upside down, and comes to rest lidH above the rim.
    rootPose: { offset: [0, 0, H + 6], flip: true },
  });

  // Stack the two blanks rather than setting them side by side. Both trays are wider
  // than they are tall, so side by side makes a very long thin blank that fits no
  // sheet in any orientation — stacked, the same two pieces turn 90 degrees onto A4.
  //
  // Measured off the built panels rather than predicted from L/W/H: a tray's blank
  // now reaches out by a roll's worth at each end and a wall's at each side, and a
  // formula that has to be kept in step with the builder is a formula that will not be.
  const bb = (parts: { panels: Panel[] }) => bboxOf(parts.panels.map((q) => q.outline));
  const [tx0, , , ty1] = bb(base);
  const [lx0, ly0, lx1] = bb(lid);
  const dx = tx0 + (L + 5 * t) / 2 - (lx0 + lx1) / 2;
  const dy = ty1 + gap - ly0;
  const moved = lid.panels.map((q) => ({
    ...q,
    outline: translate(q.outline, dx, dy),
    holes: q.holes.map((h) => translate(h, dx, dy)),
  }));

  return {
    panels: [...base.panels, ...moved],
    slits: [],
    rootId: 'tr-base',
    loose: [],
    assembly: [
      'Fold the two long walls up, then fold the ear at each of their four corners inward.',
      'Roll each end over the ears: the wall up, the narrow strip across the top, the inner panel straight back down inside.',
      'Push the two tabs on each inner panel through the slots in the floor. That is what holds the tray square — nothing is glued and nothing needs to be.',
      'Build the lid exactly the same way, then drop it over the tray.',
    ],
  };
}

// ─────────────────────────────── tuck-top carton ───────────────────────────────

function buildTuckTop(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const tuck = tuckDepth(W, H, p.tuckDepthMm);
  const dust = dustDepth(L, W, tuck, t);

  const body = tube({ prefix: 'tt-', L, W, H, t, glueTabMm: p.glueTabMm, x: 0, y: 0 });
  const [front, right, back, left] = body.walls;
  const s = body.spans;

  const panels: Panel[] = [...body.panels];
  const slits: Slit[] = [];

  // Reverse tuck: the two closures hinge from OPPOSITE walls, which nests the blanks
  // and saves board. The alternative — both from the same panel — needs H >= 2*tuck
  // before it fits at all, and nothing in the standards encodes that.
  const top = closure({
    prefix: 'tt-top-',
    parent: back.id,
    x: s[2].x,
    y: H,
    w: s[2].w,
    depth: W,
    tuck,
    t,
    up: true,
    lock: p.tuckLock,
    thumbNotch: p.thumbNotch,
    label: 'top',
  });
  const bottom = closure({
    prefix: 'tt-bot-',
    parent: front.id,
    x: s[0].x,
    y: 0,
    w: s[0].w,
    depth: W,
    tuck,
    t,
    up: false,
    // A friction lock on top and a slit lock underneath is the converter's own
    // combination: the base is the one that must never pop open.
    lock: p.tuckLock === 'none' ? 'none' : 'slit',
    thumbNotch: false,
    label: 'bottom',
  });
  panels.push(...top.panels, ...bottom.panels);
  slits.push(...top.slits, ...bottom.slits);

  for (const [wall, span] of [
    [right, s[1]],
    [left, s[3]],
  ] as const) {
    panels.push(
      dustFlap(`${wall.id}-dt`, 'dust flap', wall.id, span.x, H, span.w, dust, t, true),
      dustFlap(`${wall.id}-db`, 'dust flap', wall.id, span.x, 0, span.w, dust, t, false),
    );
  }

  return {
    panels,
    slits,
    rootId: front.id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall and let it set — this is the only glued joint.',
      'Close the base first: dust flaps in, then the bottom panel down and its tuck inside.',
      'Fill the box, then close the top the same way.',
    ],
  };
}

// ──────────────────────────── interlocking (pinwheel) base ────────────────────────────

function buildSnapLock(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const tuck = tuckDepth(W, H, p.tuckDepthMm);
  const dust = dustDepth(L, W, tuck, t);

  const body = tube({ prefix: 'sl-', L, W, H, t, glueTabMm: p.glueTabMm, x: 0, y: 0 });
  const [front, right, back, left] = body.walls;
  const s = body.spans;

  const panels: Panel[] = [...body.panels];
  const slits: Slit[] = [];

  const top = closure({
    prefix: 'sl-top-',
    parent: back.id,
    x: s[2].x,
    y: H,
    w: s[2].w,
    depth: W,
    tuck,
    t,
    up: true,
    lock: p.tuckLock,
    thumbNotch: p.thumbNotch,
    label: 'top',
  });
  panels.push(...top.panels);
  slits.push(...top.slits);

  for (const [wall, span] of [
    [right, s[1]],
    [left, s[3]],
  ] as const) {
    panels.push(dustFlap(`${wall.id}-dt`, 'dust flap', wall.id, span.x, H, span.w, dust, t, true));
  }

  // The snap-lock base, after Federal Specification PPP-B-566E fig. 10 (Style X,
  // "snap lock bottom with tuck top"). Four flaps, and — this is the part that makes
  // it a lock rather than a pile — all four are DIFFERENT:
  //
  //   back  : the main bottom panel, spanning the full depth, with a slot in it
  //   front : the closing panel, spanning the full depth, with a tongue on its edge
  //   sides : shallow angled flaps that fold in first and get trapped underneath
  //
  // That is the 1-2-3 sequence the style is named for: big panel down, two sides in,
  // last panel down and its tongue through the slot. An earlier version of this used
  // four identical chamfered flaps in a pinwheel — a real closure, but a different and
  // much more common one, and it needs a near-square footprint whereas this does not.
  const g = relief(t);
  const deep = Math.max(6, W - t);
  const shallow = Math.max(5, Math.min(W * 0.55, L / 2 - g));

  // Sides first: plain flaps with the outer corners taken off at 45 degrees so the
  // closing panel slides over them instead of catching.
  for (const [i, wall] of [
    [1, right],
    [3, left],
  ] as const) {
    const span = s[i];
    const ch = Math.min(shallow * 0.5, span.w * 0.3);
    panels.push({
      id: `sl-b${i}`,
      label: 'base side flap',
      role: 'flap',
      outline: [
        [span.x + g, -shallow + ch],
        [span.x + g + ch, -shallow],
        [span.x + span.w - g - ch, -shallow],
        [span.x + span.w - g, -shallow + ch],
        [span.x + span.w - g, 0],
        [span.x + g, 0],
      ],
      holes: [],
      parent: wall.id,
      foldAngle: HALF,
      overshoot: 0.25,
      order: 3,
    });
  }

  // The slotted panel and the tongued panel. The tongue is a shallow trapezoid so it
  // feeds into the slot; the slot is cut a caliper wider than the tongue is thick.
  const tongueW = Math.min(s[0].w * 0.35, 26);
  const tongueD = Math.max(3, Math.min(6, deep * 0.2));
  const slotW = tongueW + 2 * g;

  panels.push({
    id: 'sl-bback',
    label: 'base panel (slotted)',
    role: 'flap',
    outline: [
      [s[2].x + g, -deep],
      [s[2].x + s[2].w - g, -deep],
      [s[2].x + s[2].w - g, 0],
      [s[2].x + g, 0],
    ],
    holes: [],
    parent: back.id,
    foldAngle: HALF,
    order: 2,
  });
  // The slot itself is an interior cut, not part of the outline — it has no area to
  // remove, it is a slit the tongue passes through.
  slits.push({
    panelId: 'sl-bback',
    op: 'cut',
    points: [
      [s[2].x + s[2].w / 2 - slotW / 2, -deep + tongueD + g],
      [s[2].x + s[2].w / 2 + slotW / 2, -deep + tongueD + g],
    ],
  });

  // The tongue is part of this panel's REACH, not extra on top of it: panel + tongue
  // together span the same depth as the slotted panel opposite. Sized the other way,
  // the tongue hangs a finger's width out past the side of the finished box.
  const tongueBody = Math.max(4, deep - tongueD);
  const fx = s[0].x + s[0].w / 2;
  panels.push({
    id: 'sl-bfront',
    label: 'base panel (tongue)',
    role: 'flap',
    outline: [
      [s[0].x + g, -tongueBody],
      [fx - tongueW / 2, -tongueBody],
      [fx - tongueW / 2 + tongueD * 0.4, -tongueBody - tongueD],
      [fx + tongueW / 2 - tongueD * 0.4, -tongueBody - tongueD],
      [fx + tongueW / 2, -tongueBody],
      [s[0].x + s[0].w - g, -tongueBody],
      [s[0].x + s[0].w - g, 0],
      [s[0].x + g, 0],
    ],
    holes: [],
    parent: front.id,
    foldAngle: HALF,
    // Last down, and stopping a hair short so it visibly rests on the panel below.
    undershoot: 0.04,
    order: 4,
  });

  return {
    panels,
    slits,
    rootId: front.id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall.',
      'Fold the slotted base panel in, then both side flaps in on top of it.',
      'Fold the last base panel down and push its tongue through the slot — the base now holds itself shut.',
    ],
  };
}

// ─────────────────────── mailer — roll end tuck top (RETT) ───────────────────────

/** The e-commerce mailer, transcribed from a production dieline (315 × 202 × 62 on
 *  1.5 mm board) rather than derived, then re-expressed in caliper so it survives
 *  cardstock. It is the most-made glue-free box there is, and every term below was
 *  measured off that drawing:
 *
 *    base            (L + 5t) × (W + 2t)   — 2.5t per end is the double-ply roll
 *    front/back wall  H + t, inset g from the base's ends
 *    ear              W/2 long, hinged VERTICALLY off each wall end
 *    roll end         wall H │ roll 2t │ inner ply H − t │ tabs
 *    lid              (L + 5t + t) × (W + t), off the back wall
 *    tuck             L wide × H deep, big radii
 *
 *  The assembly order is the whole point: walls up, ears in, then the roll comes
 *  over and DOWN on top of the ears and its tabs drop through the floor. Nothing is
 *  holding the ears but the roll, and nothing is holding the roll but the tabs. */
function buildMailer(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);

  const BL = L + 5 * t;
  const BW = W + 2 * t;
  const wallH = H + t;

  const base: Panel = {
    id: 'ml-base',
    label: 'base',
    role: 'base',
    outline: rect(0, 0, BL, BW),
    holes: [],
    parent: null,
    foldAngle: 0,
  };

  // One hand hole per end, cut through BOTH plies of the roll at the same distance
  // from the fold, so they line up into a single lined hole once it is rolled.
  const hand = p.handHoles
    ? { w: clamp(BW * 0.42, 40, 95), h: clamp(H * 0.3, 14, 26) }
    : null;

  const rolls = [
    rollEnd({ prefix: 'ml-l', parent: base.id, x: 0, y0: 0, y1: BW, dir: -1, H, t, hand, order: 3 }),
    rollEnd({ prefix: 'ml-r', parent: base.id, x: BL, y0: 0, y1: BW, dir: 1, H, t, hand, order: 3 }),
  ];
  base.holes = rolls.flatMap((r) => r.slots);

  const front: Panel = {
    id: 'ml-front',
    label: 'front wall',
    role: 'body',
    outline: rect(g, -wallH, BL - 2 * g, wallH),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };
  const back: Panel = {
    id: 'ml-back',
    label: 'back wall',
    role: 'body',
    outline: rect(g, BW, BL - 2 * g, wallH),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };

  // Ears: half the box's depth each, so the front ear and the back ear very nearly
  // meet inside the end wall. They hinge on a VERTICAL crease one relief in from the
  // base's end, which is what lands them flat against the end wall's inner face.
  const earLen = Math.max(5, BW / 2 - g);
  const chamfer = Math.min(earLen * 0.35, (wallH - 2 * g) * 0.35);
  const ear = (
    id: string,
    parent: string,
    hx: number,
    dirX: 1 | -1,
    yBase: number,
    yRim: number,
  ): Panel => {
    const d = Math.sign(yRim - yBase);
    return {
      id,
      label: 'corner ear',
      role: 'flap',
      outline: [
        [hx, yBase],
        [hx + dirX * earLen, yBase],
        [hx + dirX * earLen, yRim - d * chamfer],
        [hx + dirX * (earLen - chamfer), yRim],
        [hx, yRim],
      ],
      holes: [],
      parent,
      foldAngle: HALF,
      order: 2,
    };
  };

  const panels: Panel[] = [
    base,
    front,
    back,
    ...rolls.flatMap((r) => r.panels),
    ear('ml-ear-fl', front.id, g, -1, -g, -wallH + g),
    ear('ml-ear-fr', front.id, BL - g, 1, -g, -wallH + g),
    ear('ml-ear-bl', back.id, g, -1, BW + g, BW + wallH - g),
    ear('ml-ear-br', back.id, BL - g, 1, BW + g, BW + wallH - g),
  ];

  // Lid: one caliper wider than the base so it drops over the outside of the walls
  // rather than fighting them, and W + t deep so its far crease lands on the front
  // wall's outer face.
  const lidY = BW + wallH;
  const lidD = W + t;
  const lid: Panel = {
    id: 'ml-lid',
    label: 'lid',
    role: 'lid',
    outline: rect(-t / 2, lidY, BL + t, lidD),
    holes: [],
    parent: back.id,
    foldAngle: HALF,
    order: 6,
  };

  // The tuck goes the full depth of the front wall, inside it. Its far corners carry
  // a radius of nearly half its depth — that is what lets it find the gap between the
  // wall and the two ears instead of catching on them.
  const tuckD = clamp(H - 2 * t, 6, Math.max(6, H));
  const tuckW = Math.max(8, L);
  const tuckX = BL / 2 - tuckW / 2;
  const tuckR = Math.min(tuckD * 0.48, tuckW * 0.14);
  const tuckY = lidY + lidD;
  const tuckPanel: Panel = {
    id: 'ml-tuck',
    label: 'tuck flap',
    role: 'tuck',
    outline: roundCorners(rect(tuckX, tuckY, tuckW, tuckD), [0, 0, tuckR, tuckR]),
    holes: [],
    parent: lid.id,
    foldAngle: HALF,
    undershoot: 0.05,
    order: 7,
  };

  panels.push(lid, tuckPanel);

  return {
    panels,
    slits: [],
    rootId: base.id,
    loose: [],
    assembly: [
      'Stand the front and back walls up, then fold the four corner ears inward so they lie flat against the ends.',
      'Now roll each end over the ears: the wall up, the narrow strip across the top, the inner panel straight back down inside.',
      'Push the two tabs on each inner panel through the slots in the floor. That is the whole lock — the ends are now double-walled and nothing can spring open.',
      'Fold the lid over and slide its tuck down inside the front wall.',
    ],
  };
}

// ───────────────────────── carry box with a folded handle ─────────────────────────

/** The glue-free bakery box, transcribed from a production dieline (250 × 202 × 95
 *  on 0.46 mm board). Four things happen in order and each one traps the last:
 *
 *    1. front and back walls up, their ears folded in against the ends
 *    2. side walls up over the ears
 *    3. the two top flaps fold in — each is HALF the depth, so they meet on the
 *       centre line — and their handle straps stand up off that meeting line
 *    4. the side wings fold over the top and the two straps come UP THROUGH a slot
 *       cut along each wing
 *
 *  Step 4 is the lock, and it is mutual: the wings cannot lift because the straps
 *  are through them, and the top flaps cannot lift because the wings are on them.
 *  The strap's shoulders are wider than the slot, which is what takes the weight. */
function buildHandleBox(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);

  const BL = L + 2 * t;
  const BW = W + 2 * t;
  const wallH = H + t;
  // The side walls stand one caliper proud of the front and back, so their wings
  // fold over the TOP of the two lid flaps instead of fighting them for the rim.
  const sideH = H + 2 * t;
  const topD = BW / 2;

  const base: Panel = {
    id: 'hb-base',
    label: 'base',
    role: 'base',
    outline: rect(0, 0, BL, BW),
    holes: [],
    parent: null,
    foldAngle: 0,
  };

  const front: Panel = {
    id: 'hb-front',
    label: 'front wall',
    role: 'body',
    outline: rect(g, -wallH, BL - 2 * g, wallH),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };
  const back: Panel = {
    id: 'hb-back',
    label: 'back wall',
    role: 'body',
    outline: rect(g, BW, BL - 2 * g, wallH),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };

  const earLen = Math.max(5, BW / 2 - g);
  const earChamfer = Math.min(earLen * 0.35, (wallH - 2 * g) * 0.35);
  const ear = (
    id: string,
    parent: string,
    hx: number,
    dirX: 1 | -1,
    yBase: number,
    yRim: number,
  ): Panel => {
    const d = Math.sign(yRim - yBase);
    return {
      id,
      label: 'corner ear',
      role: 'flap',
      outline: [
        [hx, yBase],
        [hx + dirX * earLen, yBase],
        [hx + dirX * earLen, yRim - d * earChamfer],
        [hx + dirX * (earLen - earChamfer), yRim],
        [hx, yRim],
      ],
      holes: [],
      parent,
      foldAngle: HALF,
      order: 2,
    };
  };

  const leftWall: Panel = {
    id: 'hb-left',
    label: 'left side',
    role: 'body',
    outline: rect(-sideH, g, sideH, BW - 2 * g),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 3,
  };
  const rightWall: Panel = {
    id: 'hb-right',
    label: 'right side',
    role: 'body',
    outline: rect(BL, g, sideH, BW - 2 * g),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 3,
  };

  const topFront: Panel = {
    id: 'hb-topf',
    label: 'lid (front half)',
    role: 'lid',
    outline: rect(g, -wallH - topD, BL - 2 * g, topD),
    holes: [],
    parent: front.id,
    foldAngle: HALF,
    order: 4,
  };
  const topBack: Panel = {
    id: 'hb-topb',
    label: 'lid (back half)',
    role: 'lid',
    outline: rect(g, BW + wallH, BL - 2 * g, topD),
    holes: [],
    parent: back.id,
    foldAngle: HALF,
    order: 4,
  };

  // Width first, and it has to be a MINIMUM against the blank, not a clamp between
  // two bounds — on a 20 mm box the "at least 40 mm" floor wins over the "at most
  // BL − 4g" ceiling and hands back a blade wider than the box it stands on.
  const bladeW = Math.min(BL - 4 * g, Math.max(30, BL * 0.72));
  // A blade much taller than it is wide is a spire, not a handle — and one much
  // taller than the box it stands on is a suitcase handle on a pizza box, which is
  // what 45 mm looked like on a 25 mm carton.
  const bladeH = Math.min(clamp(p.handleHeightMm, 22, 140), bladeW * 1.6, H * 0.9 + 18);
  const blades = [
    handleBlade({
      id: 'hb-bladef',
      label: 'handle',
      parent: topFront.id,
      cx: BL / 2,
      yc: -wallH - topD,
      dir: -1,
      width: bladeW,
      height: bladeH,
      // Mountain: the lid it hangs off is already 180 degrees from the base.
      foldAngle: -HALF,
      order: 5,
    }),
    handleBlade({
      id: 'hb-bladeb',
      label: 'handle',
      parent: topBack.id,
      cx: BL / 2,
      yc: BW + wallH + topD,
      dir: 1,
      width: bladeW,
      height: bladeH,
      foldAngle: -HALF,
      order: 5,
    }),
  ];

  // The locking wing. Folded over, its distance from the side wall's rim maps one
  // for one onto the box's own x, so the slot can be placed against the blade in
  // base coordinates and simply read off as a distance.
  const shoulder = bladeShoulder(bladeW);
  // Two plies of board go through this slot, because both blades do.
  const slotW = Math.max(2.5 * t + 0.8, 2);
  const inset = Math.min(shoulder * 0.4, 4);
  const tipMargin = Math.max(5, BL * 0.03);

  // Each wing takes HALF the blade, and they meet over the middle.
  //
  // The reference dieline runs each wing 91% of the way across, so the two overlap
  // over four fifths of the lid — two big tapering tongues crossing, which is most
  // of what made the closed box read as a mess. The lock does not need that: a wing
  // whose slot spans its own half of the blade traps that half, and the blade's
  // shoulders are wider than the slot on both. Half the wing, half the board, and
  // the top of the box reads as two panels meeting rather than an X.
  const wingLen = Math.min(BL - 2 * g, BL / 2 + Math.max(6, BL * 0.05));
  const slotTo = Math.min(BL / 2 + bladeW / 2 - inset, wingLen - tipMargin);
  const slotFrom = Math.min(BL / 2 - bladeW / 2 + inset, slotTo - 6);
  const tipH = Math.min(BW - 2 * g, slotW + 2 * Math.max(5, BW * 0.055));

  const wing = (id: string, xRoot: number, dirX: 1 | -1): Panel => ({
    id,
    label: 'locking wing',
    role: 'flap',
    outline: [
      [xRoot, g],
      [xRoot + dirX * wingLen, BW / 2 - tipH / 2],
      [xRoot + dirX * wingLen, BW / 2 + tipH / 2],
      [xRoot, BW - g],
    ],
    holes: [
      stadium(
        xRoot + dirX * ((slotFrom + slotTo) / 2),
        BW / 2,
        Math.max(6, slotTo - slotFrom),
        slotW,
      ),
    ],
    parent: dirX < 0 ? leftWall.id : rightWall.id,
    foldAngle: HALF,
    order: 6,
  });

  return {
    panels: [
      base,
      front,
      back,
      leftWall,
      rightWall,
      ear('hb-ear-fl', front.id, g, -1, -g, -wallH + g),
      ear('hb-ear-fr', front.id, BL - g, 1, -g, -wallH + g),
      ear('hb-ear-bl', back.id, g, -1, BW + g, BW + wallH - g),
      ear('hb-ear-br', back.id, BL - g, 1, BW + g, BW + wallH - g),
      topFront,
      topBack,
      ...blades,
      wing('hb-wingl', -sideH, -1),
      wing('hb-wingr', BL + sideH, 1),
    ],
    slits: [],
    rootId: base.id,
    loose: [],
    assembly: [
      'Front and back walls up first, then fold the four ears in flat against the ends.',
      'Bring both side walls up over the ears.',
      'Fold the two lid flaps in until they meet down the middle, and stand both handle straps upright.',
      'Fold each side wing over the top and feed the straps up through the slot in it. The two wings meet over the middle, each holding its own half of the handle. Press down until the strap shoulders sit under the wing — that is the lock, and the box will now carry.',
    ],
  };
}

function buildGable(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);

  const body = tube({ prefix: 'gb-', L, W, H, t, glueTabMm: p.glueTabMm, x: 0, y: 0 });
  const [front, right, back, left] = body.walls;
  const s = body.spans;
  const panels: Panel[] = [...body.panels];
  const slits: Slit[] = [];

  // The roof rises to a ridge over the middle of the box. Its panel in the flat net
  // is as long as the SLOPE, not as tall as the rise — get that wrong and the ridge
  // never meets.
  const rise = clamp(W * 0.45, 8, W);
  const slope = Math.hypot(rise, W / 2);
  const blade = clamp(p.handleHeightMm, 20, 120);

  // Both fold angles fall straight out of that triangle rather than being guessed.
  // Unfolded, the roof carries on straight up from the wall; it has to lean inward
  // by the angle between "straight up" and the line from the wall top to the ridge.
  // The handle blade then rotates back by exactly the same angle, which is what
  // leaves the two blades vertical, parallel and face to face.
  const roofFold = Math.atan2(W / 2, rise);
  const bladeFold = -roofFold;

  // Roof + handle blade on each long wall.
  for (const [i, wall] of [
    [0, front],
    [2, back],
  ] as const) {
    const span = s[i];
    const roofId = `gb-roof${i}`;
    panels.push({
      id: roofId,
      label: 'gable roof',
      role: 'body',
      outline: rect(span.x, H, span.w, slope),
      holes: [],
      parent: wall.id,
      foldAngle: roofFold,
      order: 2,
    });

    // The blade: a rounded fin above the ridge with a hand hole. Both blades come
    // together face to face and one locks into the other.
    const bw = Math.min(span.w - 2 * g, span.w * 0.9);
    const bx = span.x + (span.w - bw) / 2;
    const by = H + slope;
    const holeW = Math.min(bw * 0.62, 90);
    const holeH = Math.min(blade * 0.45, 26);
    panels.push({
      id: `gb-blade${i}`,
      label: 'handle',
      role: 'flap',
      outline: roundedRect(bx, by, bw, blade, Math.min(10, bw / 4)),
      // The hand hole sits well clear of the blade's top edge and its sides — a hole
      // any nearer tears out the first time the box is carried.
      holes: [stadium(bx + bw / 2, by + blade * 0.45, holeW, holeH)],
      parent: roofId,
      foldAngle: bladeFold,
      order: 3,
    });
  }

  // Gussets on the short walls collapse inward between the two roof panels. A real
  // gusset is a two-bar linkage folding on a diagonal; as a single triangular panel
  // it cuts correctly and reads correctly, and the diagonal is drawn as a crease the
  // user folds by hand.
  for (const [i, wall] of [
    [1, right],
    [3, left],
  ] as const) {
    const span = s[i];
    const id = `gb-gus${i}`;
    const apexX = span.x + span.w / 2;
    panels.push({
      id,
      label: 'gusset',
      role: 'flap',
      outline: [
        [span.x + g, H],
        [span.x + span.w - g, H],
        [apexX, H + slope],
      ],
      holes: [],
      // A real gusset is a two-bar linkage collapsing on its diagonals, and no
      // single rigid panel reproduces that. Folding it square tucks it inside the
      // rim, which is where it ends up anyway — and the two diagonals it really
      // folds on are drawn as creases below for the user to press in by hand.
      parent: wall.id,
      foldAngle: HALF + 0.15,
      order: 2,
      overshoot: 0.2,
    });
    // The diagonal the gusset actually folds on, marked so the user creases it.
    slits.push({
      panelId: id,
      op: 'crease',
      points: [
        [span.x + g, H],
        [apexX, H + slope],
      ],
    });
    slits.push({
      panelId: id,
      op: 'crease',
      points: [
        [span.x + span.w - g, H],
        [apexX, H + slope],
      ],
    });
  }

  // Handle interlock: a tongue on one blade, a matching slit on the other.
  const tongueW = Math.min(18, s[0].w / 4);
  const bladeTop = H + slope + blade;
  slits.push({
    panelId: 'gb-blade2',
    op: 'cut',
    points: [
      [s[2].x + s[2].w / 2 - tongueW / 2, bladeTop - 8],
      [s[2].x + s[2].w / 2 + tongueW / 2, bladeTop - 8],
    ],
  });

  return {
    panels,
    slits,
    rootId: front.id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall and close the base (tape or a glued flap).',
      'Fold the two gussets inward on their diagonals, then bring both roof panels up until the handles meet.',
      'Push the tongue on one handle through the slit in the other.',
    ],
  };
}

// ─────────────────────────────────── sleeve ───────────────────────────────────

function buildSleeve(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  // A sleeve slides OVER something, so it needs clearance on the outside of the
  // object rather than the inside of itself — one caliper on every wall it wraps.
  const body = tube({
    prefix: 'sv-',
    L: L + 2 * t,
    W: W + 2 * t,
    H,
    t,
    glueTabMm: p.glueTabMm,
    x: 0,
    y: 0,
  });

  const panels = [...body.panels];
  // ISO 15348 euro slot: a 9 mm slot under a wider round head, never closer than
  // 4 mm to any edge or the card tears off the peg.
  //
  // The slot is sized to the panel rather than pinned 12 mm from the top. A fixed
  // offset put the head 0.75 mm from the top edge at every height — breaking the
  // 4 mm rule stated right here — and pushed the tail clean off the bottom of the
  // blank on any sleeve under 20 mm tall, leaving a closed cut ring floating outside
  // the outline that no connectivity check looks for.
  const EDGE = 4;
  const slotH = Math.min(20, H - 2 * EDGE);
  if (p.hangHole && slotH >= 12) {
    const span = body.spans[0];
    panels[0] = {
      ...(panels[0] as Panel),
      holes: [...(panels[0] as Panel).holes, euroSlot(span.x + span.w / 2, H - EDGE, slotH)],
    };
  }

  return {
    panels,
    slits: [],
    rootId: body.walls[0].id,
    loose: [],
    assembly: ['Glue the lap behind the far wall. Slide it over your tray.'],
  };
}

// ─────────────────────────────── divider insert ───────────────────────────────

function buildDivider(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const cols = clamp(Math.round(p.dividerCols) || 2, 1, 10);
  const rows = clamp(Math.round(p.dividerRows) || 2, 1, 10);
  const h = clamp(H - 2, 8, H);
  // Slots run from opposite edges and meet halfway, so the two families cross.
  const half = h / 2;
  // Card is compressible enough that a slot cut to exactly one caliper binds; a
  // tenth of clearance is the difference between assembling it and creasing it.
  const slotW = t + 0.1;

  const loose: LoosePart[] = [];
  let y = 0;
  const gap = 6;

  const strip = (
    id: string,
    label: string,
    length: number,
    slotAt: number[],
    fromTop: boolean,
  ): LoosePart => {
    const pts: Poly = [];
    pts.push([0, 0]);
    if (!fromTop) {
      for (const c of slotAt) {
        pts.push([c - slotW / 2, 0], [c - slotW / 2, half], [c + slotW / 2, half], [c + slotW / 2, 0]);
      }
    }
    pts.push([length, 0], [length, h]);
    if (fromTop) {
      for (const c of [...slotAt].reverse()) {
        pts.push([c + slotW / 2, h], [c + slotW / 2, h - half], [c - slotW / 2, h - half], [c - slotW / 2, h]);
      }
    }
    pts.push([0, h]);
    return { id, label, op: 'cut', outline: translate(pts, 0, y), holes: [] };
  };

  // Slot centres. The (k - 1/2)*t term is the accumulated thickness of the crossing
  // strips, and it is the term a naive generator forgets — without it the cells drift
  // wider and wider across the box and the last one does not fit.
  const cellW = (L - (cols - 1) * t) / cols;
  const cellD = (W - (rows - 1) * t) / rows;
  const colCentres = Array.from({ length: cols - 1 }, (_, k) => (k + 1) * cellW + (k + 0.5) * t);
  const rowCentres = Array.from({ length: rows - 1 }, (_, k) => (k + 1) * cellD + (k + 0.5) * t);

  for (let i = 0; i < rows - 1; i++) {
    loose.push(strip(`div-long${i}`, `divider (long) ${i + 1}`, L - 0.5, colCentres, false));
    y += h + gap;
  }
  for (let i = 0; i < cols - 1; i++) {
    loose.push(strip(`div-cross${i}`, `divider (cross) ${i + 1}`, W - 0.5, rowCentres, true));
    y += h + gap;
  }

  return {
    panels: [],
    slits: [],
    rootId: '',
    loose,
    assembly: [
      'Slide the slotted edges together so the strips cross at half height.',
      'Drop the finished grid into the box — it holds itself square without glue.',
    ],
  };
}

// ─────────────────────────────────── dispatch ───────────────────────────────────

/** Which panel a window goes in, per style. Always the face a buyer looks at. */
export const WINDOW_PANEL: Record<BoxParams['style'], string> = {
  mailer: 'ml-lid',
  'handle-box': 'hb-front',
  tray: '',
  'tray-lid': 'ld-base',
  'tuck-top': 'tt-w0',
  'snap-lock': 'sl-w0',
  sleeve: 'sv-w0',
  divider: '',
};

export function buildStyle(p: BoxParams): {
  parts: StyleParts;
  windowFitted: boolean;
  windowInsetMm: number;
} {
  const builders: Record<BoxParams['style'], (p: BoxParams) => StyleParts> = {
    mailer: buildMailer,
    'handle-box': buildHandleBox,
    tray: buildTray,
    'tray-lid': buildTrayLid,
    'tuck-top': buildTuckTop,
    'snap-lock': buildSnapLock,
    sleeve: buildSleeve,
    divider: buildDivider,
  };
  const parts = builders[p.style](p);
  const hostId = WINDOW_PANEL[p.style];
  if (!hostId) return { parts, windowFitted: true, windowInsetMm: TRADE_INSET };
  const { parts: withWindow, fitted, insetMm } = applyWindow(parts, hostId, p);
  return { parts: withWindow, windowFitted: fitted, windowInsetMm: insetMm };
}

// The gable roof/gusset construction never got a source that draws its side wing, so
// it stays unlisted. `handle-box` covers the same job with a dieline we could check.
void buildGable;

export function styleMeta(id: BoxParams['style']): StyleMeta {
  return STYLES.find((s) => s.id === id) ?? (STYLES[0] as StyleMeta);
}

/** Unused import guard — `glueTab` and `Pt` are re-exported for the tests. */
export { glueTab };
export type { Pt };
