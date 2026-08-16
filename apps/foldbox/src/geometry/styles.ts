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
import { rect, roundedRect, stadium, translate } from './poly';
import {
  HALF,
  clamp,
  closure,
  dustDepth,
  dustFlap,
  glueTab,
  relief,
  tray,
  trayExtent,
  tube,
  tuckDepth,
} from './primitives';

export interface StyleMeta {
  id: BoxParams['style'];
  name: string;
  blurb: string;
  /** Which controls this style actually uses, so the UI can hide the rest rather
   *  than showing dead sliders. */
  uses: {
    lid?: boolean;
    tuck?: boolean;
    glue?: boolean;
    handle?: boolean;
    divider?: boolean;
    window?: boolean;
  };
}

// Two styles are deliberately NOT listed, and their builders below are therefore
// dead code kept on purpose:
//
//   mailer  — the roll-end construction is a 3-segment roll per side, not the plain
//             side walls we built. Its blank formula fits the one dimensioned drawing
//             we have only because it has two free constants and two equations, which
//             cannot fail. It needs a second dimensioned drawing at a different size
//             before it can be trusted; one is enough to collapse the fit.
//   gable   — the leaf-shaped side wing is the panel carrying the only closure this
//             style has, and no source we reached draws its outline. We can compute
//             its blank size and still not draw the panel that makes it a box.
//
// Shipping either would put a blank in front of someone that does not fold.
export const STYLES: StyleMeta[] = [
  {
    id: 'tray-lid',
    name: 'Tray & lid',
    blurb: 'Two nested trays. No glue if you tuck the corners — the classic gift box.',
    uses: { lid: true, window: true },
  },
  {
    id: 'tuck-top',
    name: 'Tuck-top carton',
    blurb: 'The standard reverse tuck carton: four walls, dust flaps, a tuck at each end.',
    uses: { tuck: true, glue: true, window: true },
  },
  {
    id: 'snap-lock',
    name: 'Interlocking base',
    blurb: 'Tuck lid over a snap-lock base: a tongue through a slot, so the bottom holds itself shut. No glue underneath.',
    uses: { tuck: true, glue: true, window: true },
  },
  {
    id: 'sleeve',
    name: 'Sleeve',
    blurb: 'An open-ended wrap. Slide it over a tray, or use it as a belly band.',
    uses: { glue: true, window: true },
  },
  {
    id: 'divider',
    name: 'Divider insert',
    blurb: 'Slot-together strips that drop into a box you already have.',
    uses: { divider: true },
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

// ───────────────────────────────── tray & lid ─────────────────────────────────

function buildTrayLid(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const gap = 8;

  const base = tray({
    prefix: 'tr-',
    labelPrefix: 'tray ',
    L,
    W,
    H,
    t,
    x: H + 2,
    y: H + 2,
  });

  // The lid nests over the tray, so its inside must clear the tray's OUTSIDE. The
  // 2t is pure nesting — it buys no play at all — and the play is added on top of it.
  // A percentage clearance, which is what the incumbent uses, is wrong at both ends:
  // 7% of 30 mm is sloppy and 7% of 300 mm falls off.
  const lidL = L + 2 * t + 2 * p.lidPlayMm;
  const lidW = W + 2 * t + 2 * p.lidPlayMm;
  const lidH = clamp(p.lidHeightMm, 6, Math.max(8, H));

  // Stack the two blanks rather than setting them side by side. Both trays are wider
  // than they are tall, so side by side makes a very long thin blank that fits no
  // sheet in any orientation — stacked, the same two pieces turn 90 degrees onto A4.
  const [, trayH] = trayExtent(L, W, H);
  const lidY = 2 + trayH + gap + lidH;
  const lidX = H + 2 + L / 2 - lidL / 2;

  const lid = tray({
    prefix: 'ld-',
    labelPrefix: 'lid ',
    L: lidL,
    W: lidW,
    H: lidH,
    t,
    x: lidX,
    y: lidY,
    // The lid arrives from above, upside down, and comes to rest lidH above the rim.
    rootPose: { offset: [0, 0, H + 6], flip: true },
  });

  return {
    panels: [...base.panels, ...lid.panels],
    slits: [],
    rootId: 'tr-base',
    loose: [],
    assembly: [
      'Tuck each corner ear inside, then bring the side wall up over it — the ear holds the corner without glue.',
      'A dab of glue on each ear makes it permanent if you would rather it never came apart.',
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

// ──────────────────────────────── roll-end mailer ────────────────────────────────

function buildMailer(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);
  const tuck = tuckDepth(H, W, p.tuckDepthMm);
  const wing = Math.max(6, H - g);

  const panels: Panel[] = [];
  const slits: Slit[] = [];

  const base: Panel = {
    id: 'ml-base',
    label: 'base',
    role: 'base',
    outline: rect(0, 0, L, W),
    holes: [],
    parent: null,
    foldAngle: 0,
  };

  const front: Panel = {
    id: 'ml-front',
    label: 'front wall',
    role: 'body',
    outline: rect(0, -H, L, H),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };
  const backWall: Panel = {
    id: 'ml-back',
    label: 'back wall',
    role: 'body',
    outline: rect(0, W, L, H),
    holes: [],
    parent: base.id,
    foldAngle: HALF,
    order: 1,
  };
  // The lid rolls over from the back wall: lid, then the front flap that drops down
  // the front face, then the tuck that slides inside.
  const lid: Panel = {
    id: 'ml-lid',
    label: 'lid',
    role: 'lid',
    outline: rect(0, W + H, L, W + t),
    holes: [],
    parent: backWall.id,
    foldAngle: HALF,
    order: 4,
  };
  const lidFront: Panel = {
    id: 'ml-lidfront',
    label: 'front flap',
    role: 'body',
    outline: rect(0, W + H + W + t, L, H + t),
    holes: [],
    parent: lid.id,
    foldAngle: HALF,
    order: 5,
  };
  const tuckW = L - 2 * Math.max(t, 0.5);
  const tuckX = (L - tuckW) / 2;
  const ty = W + H + W + t + H + t;
  const r = Math.min(tuck * 0.6, tuckW / 2, 8);
  const lidTuck: Panel = {
    id: 'ml-lidtuck',
    label: 'tuck flap',
    role: 'tuck',
    outline: [
      [tuckX, ty],
      [tuckX + tuckW, ty],
      [tuckX + tuckW - r, ty + tuck],
      [tuckX + r, ty + tuck],
    ],
    holes: [],
    parent: lidFront.id,
    foldAngle: HALF,
    undershoot: 0.03,
    order: 6,
  };

  panels.push(base, front, backWall, lid, lidFront, lidTuck);

  // Side wings on the base's short edges fold in first; the lid's own wings fold in
  // over them, which is what makes the double-thick sides of a real mailer.
  for (const [id, x, dir] of [
    ['l', 0, -1],
    ['r', L, 1],
  ] as const) {
    panels.push({
      id: `ml-side-${id}`,
      label: 'side wall',
      role: 'body',
      outline: rect(dir < 0 ? -H : L, 0, H, W),
      holes: [],
      parent: base.id,
      foldAngle: HALF,
      order: 1,
    });
    panels.push({
      id: `ml-wing-${id}`,
      label: 'lid wing',
      role: 'flap',
      outline: rect(dir < 0 ? -wing : L, W + H, wing, W + t),
      holes: [],
      parent: lid.id,
      foldAngle: HALF,
      order: 3,
      overshoot: 0.2,
    });
    void x;
  }

  // Cherry locks: a nick in each side wall that the front flap's corners catch under.
  const lockY = W - Math.min(12, W / 3);
  for (const dir of [-1, 1] as const) {
    const lx = dir < 0 ? -H : L + H;
    slits.push({
      panelId: dir < 0 ? 'ml-side-l' : 'ml-side-r',
      op: 'cut',
      points: [
        [lx, lockY],
        [lx - dir * Math.min(6, H / 2), lockY],
      ],
    });
  }

  return {
    panels,
    slits,
    rootId: base.id,
    loose: [],
    assembly: [
      'Fold both side walls up, then the front and back walls.',
      'Roll the lid over: lid down, front flap down the face, tuck inside.',
      'The nicks in the side walls catch the lid wings — press them in and the box stays shut without tape.',
    ],
  };
}

// ──────────────────────────────── gable handle box ────────────────────────────────

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
  const slotOK = p.hangHole && H >= 2 * EDGE + 16;
  if (slotOK) {
    const span = body.spans[0];
    const cx = span.x + span.w / 2;
    const headR = 3.25;
    const headCy = H - EDGE - headR;
    const tail = Math.min(16, H - 2 * EDGE - 2 * headR);
    panels[0] = {
      ...(panels[0] as Panel),
      holes: [
        ...(panels[0] as Panel).holes,
        stadium(cx, headCy - tail / 2, 9, tail + 2 * headR),
        stadium(cx, headCy, 20, 2 * headR),
      ],
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

// Kept deliberately: see the note above STYLES.
void buildMailer;
void buildGable;

export function styleMeta(id: BoxParams['style']): StyleMeta {
  return STYLES.find((s) => s.id === id) ?? (STYLES[0] as StyleMeta);
}

/** Unused import guard — `glueTab` and `Pt` are re-exported for the tests. */
export { glueTab };
export type { Pt };
