// The seven box styles. Each one returns panels; `buildNet` turns those into a
// dieline and a fold rig without the builder ever drawing a silhouette.
//
// Nothing here is transcribed from a standard. Every published carton library that
// was checked against our own parameter range produced negative, zero or colliding
// geometry somewhere inside it — a dust flap that overlaps by 10.5 mm on any square
// box, a 12 mm tuck on an 8 mm-tall box, a 45 degree glue taper that needs 24 mm of
// height before the two tapers stop crossing. So these are derived and clamped, and
// the clamps are the interesting part.

import type { BoxParams, HangHole, HangTab, LoosePart, Panel, Poly, Pt, Slit, StyleParts } from '../types';
import { arcPoints, bboxOf, rect, roundCorners, roundedRect, stadium, translate } from './poly';
import { slotFit } from './fit';
import { machineById } from './solve';
import {
  HALF,
  HANG_EDGE_MM,
  clamp,
  closure,
  dustDepth,
  dustFlap,
  envelopeBottom,
  euroSlot,
  hangHoleAcross,
  flapCover,
  hangHeader,
  hangHeaderHeight,
  hangHoleHeight,
  hangHoleWidth,
  glueTab,
  layerStep,
  relief,
  rollEnd,
  tray,
  tube,
  tuckDepth,
  webbedTray,
} from './primitives';
import type { Tube } from './primitives';

/** How firmly a style's ECMA code is anchored. Stated per style rather than implied,
 *  because "this is B20.04.00.00" and "this is the nearest code to what we built" are
 *  very different claims and only one of them is checkable. */
export type EcmaBasis =
  /** Drawn in the ECMA catalogue at exactly this code. The strongest claim. */
  | 'catalogue'
  /** A combination the group's matrix table marks possible but does not illustrate.
   *  Legitimate — composing codes from the matrix is what the matrix is for. */
  | 'constructed'
  /** Our structure is a derivative and this is the closest listed code. ECMA's own
   *  p.4 covers this case: "some details and some derivatory design styles are not
   *  specified or shown", and verifying the rest is left to the user. */
  | 'nearest';

export interface EcmaRef {
  code: string;
  /** What the code spells out, digit pair by digit pair, in the standard's words. */
  reads: string;
  basis: EcmaBasis;
  /** Page in the revised edition of September 2009, when `basis` is 'catalogue'. */
  page?: number;
  /** What we derived rather than took, where that is worth saying out loud. */
  note?: string;
}

export interface StyleMeta {
  id: BoxParams['style'];
  /** Full name, for the export title and the assembly sheet. */
  name: string;
  /** Card label. The picker is ten tiles in a 280 px sidebar, so a name that
   *  wraps to three lines makes every tile in the row that tall — which is how the
   *  picker came to be 574 px of a 674 px panel. */
  short: string;
  blurb: string;
  /** Assembles with nothing but the board. Badged in the UI and stated in the
   *  assembly sheet, because "no glue" is the only question most people have. */
  glueFree: boolean;
  /** Closes its corners with 45 degree webs folded double.
   *
   *  Card's answer to a closed corner, and the one structure that does not survive
   *  being printed. Two reasons, both measured. The web folds FLAT — 180 degrees,
   *  through two plies — where every other fold in these boxes is a right angle, so
   *  it needs the widest groove in the blank and gets no help from the material.
   *  And its fold runs at 45 degrees across the plate: the slicer lays the sheet's
   *  one solid layer at 45 degrees too, so the extrusions run ALONG the web's hinge
   *  rather than across it, and the fold is a line of bead-to-bead adhesion instead
   *  of continuous filament. On a webbed tray that is 142 mm of hinge printed the
   *  one way a hinge must not be; on the hinged lid, 184 mm. Every other printable
   *  structure here folds only on 0 and 90, which the same 45 degree fill crosses.
   *
   *  So the print-only build does not offer them — see `isPrintStyle` in main.ts. */
  webbedCorners?: boolean;
  /** Where this structure comes from. Shown in the UI and written into the export's
   *  README, so anyone who has to justify the design to a customer can. */
  ecma: EcmaRef;
  /** Options that change the structure enough to change its CODE. The mailer's lid
   *  flaps are the case this exists for: switching them on moves the cover digit from
   *  50 to 53, and reporting B20.01.00.50 for a box with three wings on its lid would
   *  be a false provenance claim — the one kind of wrong this file cannot be. */
  variants?: { when: (p: BoxParams) => boolean; ecma: EcmaRef }[];
  /** How many separate blanks a correct net has. The connectivity check reads this
   *  rather than testing the style id, so adding a style cannot silently skip it. */
  outerPieces: number;
  /** Which hang tabs this style offers, in the order the dropdown lists them.
   *
   *  A list rather than a boolean because the modes are not interchangeable between
   *  structures, and a mode a style cannot build is worse than a missing one: it looks
   *  like a setting, it silently does nothing, and it goes on doing nothing in every
   *  saved preset made while it was there. The builder reads the SAME list, so a mode
   *  can never arrive from a preset or from switching styles either. */
  hangModes?: HangTab[];
  /** Where a window may be cut, first entry being the default. One entry (or none)
   *  means there is no choice to offer and the control stays hidden. */
  windowFaces?: { id: string; label: string }[];
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
    /** A sloped roof, so the pitch is worth a slider. */
    roof?: boolean;
    divider?: boolean;
    window?: boolean;
    hangTab?: boolean;
    /** The style has more than one place to put the tab, so it needs to be asked. */
    hangEnd?: boolean;
    /** Wings on the lid's short edges, on or off. */
    lidWings?: boolean;
  };
}

// Ordered glue-free first, because that is the question people actually arrive with.
// `glueFree` is not decoration — the UI badges it and the export sheet says so, and
// the three styles that are false are false for one specific reason: a tube has to
// close on itself somewhere, and only a lap does that on 300 gsm card.
//
// Every entry carries its ECMA code. Group B is the glue-free family (non-long-seam-
// glued, tray type); Group A is the glued one (long-seam-glued, tube type); the
// divider is Group F, which is where the standard puts things that are not cartons.
// See docs/foldbox-provenance.md for the licence position and the full derivation.
/** The hang tabs each family of structures can actually build. See `StyleMeta.hangModes`.
 *
 *  A mailer offers ONE. Its lid can carry on past a short end and take a slot, and that
 *  is all: a slot punched in the lid puts the peg inside the box, and routing a tab out
 *  under the base — which is the only way to hang a mailer lid-forward — was built, and
 *  folded, and does not hold. The end gives up too much of its own wall to the tab and
 *  splays. So the mailer's tab hangs the box base-forward, the window control is there
 *  to move the artwork to the base, and the honest option list is the short one.
 *
 *  A tuck or snap-lock carton offers the two HEADERS but not the bare slot: a slot in
 *  the back wall leaves the peg inside the carton and one ply around the hole. A sleeve
 *  keeps it, because a sleeve has no closure for a header to displace and nothing much
 *  inside for a peg to foul. */
const MAILER_HANG: HangTab[] = ['none', 'single'];
const CARTON_HANG: HangTab[] = ['none', 'single', 'double'];
const SLEEVE_HANG: HangTab[] = ['none', 'hole', 'single', 'double'];

/** The four walls of a tube, in `tube()`'s own wrap order. */
const tubeFaces = (prefix: string): { id: string; label: string }[] => [
  { id: `${prefix}w0`, label: 'Front' },
  { id: `${prefix}w2`, label: 'Back' },
  { id: `${prefix}w1`, label: 'Right end' },
  { id: `${prefix}w3`, label: 'Left end' },
];

/** Which face a mailer's window may go on.
 *
 *  This exists because of where the hang tab left things. The tab is the lid carrying
 *  on past a short end, so the LID goes against the shop's board and the customer is
 *  looking at the base — and the fix for that is not more geometry, it is being able to
 *  put the window and the artwork on the face that faces out. The two long walls are
 *  offered as well; on a shallow box `applyWindow` will report that they are too small
 *  rather than refusing. The rolled ends are not: an aperture there has to register
 *  through two plies, which is the hand hole's job and a different piece of geometry. */
const MAILER_FACES = [
  { id: 'ml-lid', label: 'Lid (top)' },
  { id: 'ml-base', label: 'Base (bottom) — the face out when it hangs' },
  { id: 'ml-front', label: 'Front wall' },
  { id: 'ml-back', label: 'Back wall' },
];

/** Cover 53 rather than 50: the wings are not a securing feature bolted onto a tuck-in
 *  flap, they change what the cover IS, so they move the fourth digit pair rather than
 *  appending a Group X code the way the tuck lugs do. ECMA's own reading of 53 is a
 *  tuck-in flap cover with dust flaps on the cover — which is exactly a wing on each
 *  short edge of the lid, folding down inside the ends. */
const MAILER_53: EcmaRef = {
  code: 'B20.01.00.53',
  reads:
    'tray with 2 double walls · fold-over ends with nib locks · no dust flaps on the tray · tuck-in flap cover WITH dust flaps',
  basis: 'constructed',
  note:
    'Taken from the group’s matrix table rather than from a drawn plate: ECMA lists cover 53 for Group B trays, and the wing’s depth and its chamfer are ours. Note that turning the wings on also changes the LID: it has to nest inside the rim to carry them, where cover 50’s lid caps over the outside.',
};
const MAILER_FLAPS_53: EcmaRef = {
  ...MAILER_53,
  code: 'B20.01.00.53.32',
  reads: `${MAILER_53.reads} · X32 "tuck in closure with locking lugs"`,
};

/** A mailer with a hang tab is still a B20.01 tray with a tuck-in cover — the tab is a
 *  Group X hanging device appended as a further digit pair, exactly the way the side
 *  flaps' X32 is. What it is NOT is catalogued: ECMA draws X61/X62 as extended panels
 *  standing ABOVE a wall, and these reach out past a short END instead, because that
 *  is the only plane that hangs a mailer lid-forward. The structure is the standard's;
 *  the placement is ours, so both are marked `nearest` and say so.
 *
 *  `hole` gets no variant at all. Punching a slot through the lid adds no panel and
 *  changes no closure, so it changes no code — and claiming X61 for it would be the
 *  kind of quiet false provenance this file exists to prevent. */
const X_TAB_NOTE =
  'ECMA’s Group X hanging devices are drawn as extended panels above a wall (p.88). Here the same panel reaches past a SHORT END of the tray instead, which is the only placement that hangs a mailer long-axis-down. The ply count, the euroslot and the 4 mm keep-out are the standard’s; the placement is ours. Note that the two differ in WHICH face they extend: X62 is routed under the base, so the base goes to the board and the lid faces the shop; X61 is the lid carrying on past the end, which hangs the box the other way up.';
const MAILER_X61: EcmaRef = {
  code: 'B20.01.00.50.61',
  reads:
    'tray with 2 double walls · fold-over ends with nib locks · no dust flaps · tuck-in flap cover · X61 "extended panel single walled with euroslot opening"',
  basis: 'nearest',
  note: X_TAB_NOTE,
};
const MAILER_FLAPS_X61: EcmaRef = {
  ...MAILER_X61,
  code: 'B20.01.00.50.32.61',
  reads: `${MAILER_X61.reads} · X32 "tuck in closure with locking lugs"`,
};

export const STYLES: StyleMeta[] = [
  {
    id: 'mailer',
    name: 'Mailer box',
    short: 'Mailer',
    blurb:
      'The subscription-box shape. Roll each end down, push two tabs through the floor, tuck the lid.',
    glueFree: true,
    ecma: {
      code: 'B20.01.00.50',
      reads:
        'tray with 2 double walls · fold-over ends with nib locks · no dust flaps · tuck-in flap cover',
      basis: 'catalogue',
      page: 39,
    },
    variants: [
      { when: (p) => p.lidWings, ecma: MAILER_53 },
      { when: (p) => hangMode(p) === 'single', ecma: MAILER_X61 },
    ],
    outerPieces: 1,
    hangModes: MAILER_HANG,
    windowFaces: MAILER_FACES,
    // No `tuck` — the tuck is full-depth by construction and reads nothing from the
    // tuck sliders. Showing them here is what "the settings make no sense" means:
    // three controls that move and change nothing.
    uses: { handHoles: true, window: true, hangTab: true, hangEnd: true, lidWings: true },
  },
  {
    id: 'mailer-flaps',
    name: 'Mailer with side flaps',
    short: 'Mailer + flaps',
    blurb:
      'The mailer with a locking tuck: two small lugs on the ends of the tuck flap spring out inside the end walls, so the front cannot pull back open.',
    glueFree: true,
    ecma: {
      code: 'B20.01.00.50.32',
      reads:
        'tray with 2 double walls · fold-over ends with nib locks · no dust flaps · tuck-in flap cover · X32 "tuck in closure with locking lugs"',
      basis: 'nearest',
      note:
        'The COVER is unchanged from the plain mailer — still a tuck-in flap, still digit 50. What is added is a securing feature on the tuck itself, so it takes a fifth digit pair from Group X rather than a different cover digit: X32, "tuck in closure with locking lugs" (p.88). Notation follows the standard’s own rule that an X code is appended to the design code as a fifth pair. Marked nearest rather than catalogue because ECMA lists X32 without drawing it on a Group B tray, so the lug’s shape and reach are ours.',
    },
    variants: [
      { when: (p) => p.lidWings, ecma: MAILER_FLAPS_53 },
      { when: (p) => hangMode(p) === 'single', ecma: MAILER_FLAPS_X61 },
    ],
    outerPieces: 1,
    hangModes: MAILER_HANG,
    windowFaces: MAILER_FACES,
    uses: { handHoles: true, window: true, hangTab: true, hangEnd: true, lidWings: true },
  },
  {
    id: 'tray',
    name: 'Roll-end tray',
    short: 'Tray',
    blurb:
      'The mailer without its lid. Each end rolls over the corner ears and locks into the floor. Raise the sides for a carry basket.',
    glueFree: true,
    ecma: {
      code: 'B20.01.00.00',
      reads: 'tray with 2 double walls · fold-over ends with nib locks · no dust flaps · no cover',
      basis: 'catalogue',
      page: 38,
    },
    outerPieces: 1,
    // A tray is open on top; there is no face to put a window in that is not either
    // the floor or the wall the grip is already cut out of.
    uses: { handle: true },
  },
  {
    id: 'tray-webbed',
    name: 'Webbed-corner tray',
    short: 'Webbed tray',
    blurb:
      'A closed-corner tray. Each corner is a 45° web that folds double and locks itself — no tabs, no slots, no gap.',
    glueFree: true,
    webbedCorners: true,
    ecma: {
      code: 'B20.04.00.00',
      reads:
        'tray with 2 double walls · fold-over ends with WEBBED corners · no dust flaps · no cover',
      basis: 'catalogue',
      page: 39,
    },
    outerPieces: 1,
    uses: {},
  },
  {
    id: 'tray-lid',
    name: 'Tray & telescoping lid',
    short: 'Tray & lid',
    blurb: 'Two of the same locking tray, one nesting over the other.',
    glueFree: true,
    ecma: {
      code: 'B20.01.00.00 ×2',
      reads: 'two roll-end trays used as a telescopic pair, the lid sized off the tray’s outside',
      basis: 'constructed',
      note:
        'The Group B matrix note (p.34) states it directly: "Some designs can be used as a single tray or as a telescopic packaging system, in such cases dimension need to be adjusted between Top and Bottom tray." Adjusting that dimension is our 2t + 2·play term.',
    },
    outerPieces: 2,
    uses: { lid: true, window: true },
  },
  {
    id: 'flap-cover',
    name: 'Hinged lid box',
    short: 'Hinged lid',
    blurb:
      'Webbed tray with a full lid hinged off the back. The lid’s corners are webbed too, so it closes shut all the way round.',
    glueFree: true,
    webbedCorners: true,
    ecma: {
      code: 'B20.04.00.60',
      reads:
        'tray with 2 double walls · fold-over ends with webbed corners · no dust flaps · complete flap cover with CLOSED corners',
      basis: 'constructed',
      note:
        'Both halves are catalogued (B20.04 on p.39, cover 60 in the Group B closure table on p.35); the Group B matrix marks the combination possible rather than drawing it.',
    },
    outerPieces: 1,
    uses: { lid: true, window: true },
  },
  {
    id: 'tuck-top',
    name: 'Reverse tuck end carton',
    short: 'Tuck carton',
    blurb: 'The standard retail carton: dust flaps and a tuck at each end, hinged off opposite walls.',
    glueFree: false,
    ecma: {
      code: 'A20.20.01.03',
      reads:
        'tuck-in flap bottom · tuck-in flap top · bottom tuck on panel 1 · top tuck on panel 3 — opposite panels, which is what makes it REVERSE rather than straight (A20.20.01.01)',
      basis: 'catalogue',
      page: 24,
    },
    variants: [
      {
        when: (p) => hangMode(p) === 'single' || hangMode(p) === 'double',
        ecma: {
          code: 'A20.21.01.03',
          reads:
            'tuck-in flap bottom · tuck-in flap top WITH EXTENDED BACK PANEL · bottom on panel 1 · extended back panel on panel 3',
          basis: 'nearest',
          note:
            'The header moves the top closure digit from 20 to 21 — ECMA’s own name for closure 21 is "tuck in flap closure system with extended back panel", so a header is not a decoration on a 20, it is a different closure. The catalogue draws A20.21.03.03 (p.20); ours differs in the third pair only, because our bottom tuck hangs off panel 1. The euroslot itself is X61/X62 (p.88), reported separately in the hang tab control.',
        },
      },
    ],
    outerPieces: 1,
    hangModes: CARTON_HANG,
    windowFaces: tubeFaces('tt-'),
    uses: { tuck: true, glue: true, window: true, hangTab: true },
  },
  {
    id: 'snap-lock',
    name: 'Self-locking bottom carton',
    short: 'Snap-lock',
    blurb: 'Tuck lid over a base that locks itself — fold three flaps in sequence and it stays shut.',
    glueFree: false,
    ecma: {
      code: 'A55.20.01.03',
      reads: 'self-locking envelope bottom · tuck-in flap top · bottom on panel 1 · top on panel 3',
      basis: 'catalogue',
      page: 27,
      note:
        'ECMA draws the closure generically and says so (p.4: "some details … are not specified or shown"). The tongue-and-slot that does the actual locking here is our derivation, sized in caliper.',
    },
    variants: [
      {
        when: (p) => hangMode(p) === 'single' || hangMode(p) === 'double',
        ecma: {
          code: 'A55.21.01.03',
          reads:
            'self-locking envelope bottom · tuck-in flap top WITH EXTENDED BACK PANEL · bottom on panel 1 · extended back panel on panel 3',
          basis: 'catalogue',
          page: 27,
          note:
            'Drawn in the catalogue with the hang slots in it — the header, the moved top closure and the euroslot through both plies are all on ECMA’s own page, which makes this the best-anchored code in the app.',
        },
      },
    ],
    outerPieces: 1,
    hangModes: CARTON_HANG,
    windowFaces: tubeFaces('sl-'),
    uses: { tuck: true, glue: true, window: true, hangTab: true },
  },
  {
    id: 'gable',
    name: 'Gable carry box',
    short: 'Gable box',
    blurb:
      'The bakery box: a peaked roof, a handle standing at the ridge, and an ear at each end whose slot drops over both blades and locks it shut.',
    glueFree: false,
    ecma: {
      code: 'A55.75.01.03',
      reads:
        'self-locking envelope bottom · GABLE TOP CLOSURE WITH LOCKING FLAP · bottom on panel 1 · top on panel 3',
      basis: 'catalogue',
      page: 27,
      note:
        'The bottom is the same closure 55 the snap-lock carton uses, which is what a four-pair code is for. What ECMA draws generically is the locking flap: the ear’s slot, the seat angle and the arc notched into the blades’ shoulders are all ours, derived in caliper. See docs/foldbox-provenance.md §4.2.',
    },
    outerPieces: 1,
    uses: { handle: true, roof: true, glue: true, window: true },
  },
  {
    id: 'sleeve',
    name: 'Sleeve',
    short: 'Sleeve',
    blurb: 'An open-ended wrap. Slide it over a tray, or use it as a belly band.',
    glueFree: false,
    ecma: {
      code: 'A01.01.00.00',
      reads: 'without flaps bottom · without flaps top · no closing panels either end',
      basis: 'catalogue',
      page: 19,
    },
    variants: [
      {
        when: (p) => p.hangTab === 'single' || p.hangTab === 'double',
        ecma: {
          code: 'A01.01.00.00.61',
          reads:
            'without flaps both ends · X61 "extended panel single walled with euroslot opening" appended as the fifth digit pair',
          basis: 'nearest',
          note:
            'X62 when the header is doubled. The notation follows the standard’s own rule (p.88) that a group X feature is added to the design code as a fifth pair; ECMA does not draw either one on a sleeve.',
        },
      },
    ],
    outerPieces: 1,
    hangModes: SLEEVE_HANG,
    windowFaces: tubeFaces('sv-'),
    uses: { glue: true, window: true, hangTab: true },
  },
  {
    id: 'divider',
    name: 'Divider insert',
    short: 'Dividers',
    blurb: 'Slot-together strips that drop into a box you already have.',
    glueFree: true,
    ecma: {
      code: 'F80.31',
      reads: 'complementary packaging device · inserts/separators · inserted cross partitions',
      basis: 'catalogue',
      page: 67,
    },
    outerPieces: 0,
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

// ──────────────────────────────── hang tab ────────────────────────────────

/** The hang tabs this style offers, and the one it is actually configured with.
 *
 *  Every reader of `p.hangTab` goes through `hangMode` — the builders, the ECMA
 *  variants and the UI alike — so a mode a style does not offer cannot get in from a
 *  preset, a shared link, or simply switching styles with the dropdown set. */
export function hangModes(style: BoxParams['style']): HangTab[] {
  return styleMeta(style).hangModes ?? ['none', 'hole', 'single', 'double'];
}
export function hangMode(p: BoxParams): HangTab {
  return hangModes(p.style).includes(p.hangTab) ? p.hangTab : 'none';
}

/** Put a hang header on a tube's back wall, in place.
 *
 *  Shared rather than written out three times because the part that is easy to get
 *  wrong is not the header — it is that a header OWNS the wall's top edge, so on any
 *  style with a top closure the closure has to move to the opposite wall. Two styles
 *  doing that independently is two chances to forget it, and forgetting it draws a
 *  lid and a header on the same crease: a blank that cuts, folds into nonsense, and
 *  passes every flat check there is. */
function applyHangTab(
  p: BoxParams,
  panels: Panel[],
  body: Tube,
  H: number,
): { panels: Panel[]; movedClosure: boolean } {
  const kind = hangMode(p);
  if (kind === 'none') return { panels, movedClosure: false };
  const back = body.walls[2];
  const span = body.spans[2];
  const header = hangHeader({
    prefix: 'hang-',
    wall: back,
    x: span.x,
    w: span.w,
    h: H,
    y: H,
    t: p.caliperMm,
    kind,
    shape: p.hangHole,
    heightMm: p.hangTabHeightMm,
    fit: slotFit(p, machineById(p.machineId), p.caliperMm),
  });
  const bb = bboxOf([back.outline]);
  const out = panels.map((q) =>
    q.id === back.id
      ? {
          ...q,
          outline: header.wallOutline,
          holes: header.wallHoles,
          // The header is the wall carrying on upward, so it lands in the wall's own
          // bounding box — and a window on this wall would then centre on wall-plus-
          // header and ride up into the hang slot. The FACE is the wall it was.
          windowRect: [bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]] as [number, number, number, number],
        }
      : q,
  );
  return {
    panels: [...out, ...header.panels],
    movedClosure: kind !== 'hole',
  };
}

/** What the header adds to the assembly sheet. Nothing, when there is no header —
 *  a step that says "do nothing" is how an instruction sheet stops being read. */
function hangSteps(p: BoxParams): string[] {
  if (hangMode(p) === 'double') {
    return [
      'Fold the header over on itself at the double crease so the two hang slots line up, and tuck its lip down inside the back wall. It is the two plies together that stop the slot tearing off the peg.',
    ];
  }
  if (hangMode(p) === 'single') {
    return ['The header above the back wall is one ply — hang light contents only, or switch it to the double header.'];
  }
  return [];
}

/** Does this style's top closure have to move off the back wall? */
function headerTakesTop(p: BoxParams): boolean {
  const kind = hangMode(p);
  return kind === 'single' || kind === 'double';
}

// ─────────────────────────── the mailer's lid-borne tabs ───────────────────────────

/** The cheap hang tab: the lid simply carries on past a short end, and the slot goes
 *  in the overhang. One ply, no extra crease, and on a normal mailer it costs NO extra
 *  sheet at all — it nests in the waste beside the rolled end.
 *
 *  It buys that with the one thing the roll-routed tab is careful about. A peg is
 *  horizontal, so the plane the slot is cut in is the plane that ends up against the
 *  shop's board — the box has to project forward out of it, it cannot project backward
 *  into the board. This tab is coplanar with the LID, so the lid goes to the board and
 *  the customer is looking at the base. The roll-routed `double` reaches out past the
 *  BASE instead, which is what turns the box round.
 *
 *  So this is the cheap one and it hangs the other way up. That is a real cost, said
 *  out loud in the assembly sheet and in the control's own label, rather than a bug.
 *
 *  The tab is part of the lid PANEL — one ply, no crease between them — so it is
 *  returned as a replacement outline rather than as a panel, exactly as `hangHeader`
 *  returns a single-ply header. Hanging it as a panel would draw a crease across the
 *  root of the tab, which is the one place a hang tab must not bend.
 *
 *  `windowRect` is the part of the result a window may still use, and it is the whole
 *  reason this returns three things rather than two. */
function lidHangTab(o: {
  kind: HangTab;
  shape: HangHole;
  /** The lid's own rect, before any tab. */
  x: number;
  y: number;
  w: number;
  h: number;
  left: boolean;
  right: boolean;
  heightMm: number;
  t: number;
}): { outline: Poly; holes: Poly[]; windowRect: [number, number, number, number] } {
  const { x, y, w, h, left, right } = o;
  const plain = {
    outline: rect(x, y, w, h),
    holes: [] as Poly[],
    windowRect: [x, y, w, h] as [number, number, number, number],
  };
  const ends = (left ? 1 : 0) + (right ? 1 : 0);
  if (!ends || o.kind !== 'single') return plain;

  const ch = Math.max(relief(o.t), Math.min(4, h * 0.08));
  const tabW = Math.max(4, h - 2 * ch);
  // Too narrow a lid for this hole and there is no tab at all — a tab with nothing
  // through it is board you cut, fold round and cannot hang.
  const holeW = hangHoleWidth(o.shape, tabW);
  if (holeW === null) return plain;
  const hh = hangHeaderHeight(o.heightMm, tabW, o.shape);
  const slotH = hangHoleHeight(o.shape, holeW);
  const drop = Math.max(HANG_EDGE_MM, (hh - slotH) / 2);
  const x0 = left ? x - hh : x;
  const x1 = right ? x + w + hh : x + w;
  const cy = y + h / 2;

  const outline: Poly = [];
  outline.push(left ? [x0 + ch, y] : [x0, y]);
  outline.push(right ? [x1 - ch, y] : [x1, y]);
  if (right) outline.push([x1, y + ch], [x1, y + h - ch], [x1 - ch, y + h]);
  else outline.push([x1, y + h]);
  if (left) outline.push([x0 + ch, y + h], [x0, y + h - ch], [x0, y + ch]);
  else outline.push([x0, y + h]);

  const holes: Poly[] = [];
  const across = (tipX: number, outward: 1 | -1) =>
    hangHoleAcross({ shape: o.shape, tipX, outward, cy, widthMm: holeW, dropMm: drop });
  if (left) holes.push(across(x0, -1));
  if (right) holes.push(across(x1, 1));
  // The overhang is tab, not face. The window stays on the box's top.
  return { outline, holes, windowRect: [x, y, w, h] };
}

/** What a mailer's tab adds to the assembly sheet, and what it costs the person who
 *  prints it.
 *
 *  The two hang the box opposite ways up, and that is the first thing either note
 *  says, because it is not visible anywhere else: both slots are parallel to the lid,
 *  both tabs stick out past a short end, and the dieline looks the same either way. */
function mailerHangSteps(p: BoxParams): string[] {
  const end = p.hangEnd === 'both' ? 'each end' : `the ${p.hangEnd} end`;
  if (hangMode(p) === 'single') {
    return [
      `The lid runs on past ${end} into a one-ply tab. Nothing to fold and, on most sizes, no extra card — it nests in the waste beside the rolled end.`,
      'Two things to know before you use it. It hangs the box the other way up from the double tab: the LID goes against the board and the customer sees the base, so put your artwork there. And the whole weight goes through the lid, which is held on by its tuck flap — keep the contents light, and use the locking-lug mailer, whose lugs are the only thing stopping the tuck pulling back out.',
    ];
  }
  return [];
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

  // The face, which is the panel's bounding box until a panel says otherwise. A
  // mailer's lid says otherwise when it carries a hang tab: the tab is the same ply
  // with no crease between, so the bounding box swallows it and the window centres on
  // lid-plus-tab instead of on the box's top. See `Panel.windowRect`.
  const xs = host.outline.map((v) => v[0]);
  const ys = host.outline.map((v) => v[1]);
  const [x0, y0, pw, ph] = host.windowRect ?? [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  ];

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
    fit: slotFit(p, machineById(p.machineId), p.caliperMm),
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

// ─────────────────────────── webbed-corner tray (B20.04) ───────────────────────────

/** The other glue-free tray, and the one worth understanding.
 *
 *  ECMA gives the two corners their own locking-flap codes: 01 is nib locks, 04 is
 *  webbed corners. The nib-lock tray (`buildTray`) hangs a separate ear beside a
 *  relief gap and pushes tabs through the floor to hold the end down. The webbed one
 *  has no ear, no gap, no tab and no slot — the corner is continuous board, split by a
 *  45 degree crease, and folding that crease double IS the lock.
 *
 *  What you get for it: a closed corner. Nothing falls out of it and nothing catches
 *  on it, which is why this is the tray shape used for anything loose or greasy. What
 *  it costs: a bigger blank, since each corner now needs a full H square of board that
 *  the nib-lock version does not. */
function buildWebbedTray(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const { panels, slits } = webbedTray({
    prefix: 'wt-',
    labelPrefix: '',
    L,
    W,
    H,
    t: p.caliperMm,
    x: H + 2,
    y: H + 2,
    fit: slotFit(p, machineById(p.machineId), p.caliperMm),
  });
  return {
    panels,
    slits,
    rootId: 'wt-base',
    loose: [],
    assembly: [
      'Bring all four walls up together, not one at a time. Each corner web is joined to two walls at once, so it cannot lie flat while they rise — it folds itself on its diagonal crease as they go, and by the time the walls stand up the web is already doubled. Let it.',
      'Now swing each doubled web flat against the end of the tray, and press the diagonal home with a bone folder.',
      'Roll each end up over the webs: the wall up, the narrow strip across the top, the inner panel straight back down inside. The webs are now trapped between the two plies and the tray is locked — there are no tabs on this one and it does not need any.',
    ],
  };
}

// ────────────────────────── hinged lid box (B20.04.00.60) ──────────────────────────

/** A webbed tray with ECMA cover system 60 hinged onto it: a complete flap cover with
 *  closed corners. One blank, no glue, and it shuts all the way round — the gift-box
 *  and hinged-lid shape.
 *
 *  The lid is deliberately built from the same web construction as the tray, hinged
 *  the other way up. That is not economy of code for its own sake: a lid whose corners
 *  are open (cover 53) racks out of square the moment you close it on a full box, and
 *  the closed corner is the entire difference between codes 53 and 60. */
function buildFlapCover(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;

  const body = webbedTray({
    prefix: 'fc-',
    labelPrefix: '',
    L,
    W,
    H,
    t,
    x: H + 2,
    y: H + 2,
    fit: slotFit(p, machineById(p.machineId), t),
  });

  const BL = L + 5 * t;
  const BW = W + 2 * t;
  const wallH = H + t;
  const backRim = H + 2 + BW + wallH;

  // The lid clears the tray's OUTSIDE, so it reaches a caliper past the base on each
  // side, and its skirt is a proportion of the box's height clamped to something a
  // finger can still lift. A skirt as deep as the box is a second tray, not a lid.
  const skirt = clamp(p.lidHeightMm, 5, Math.max(6, H * 0.6));

  const cover = flapCover({
    prefix: 'fc-lid-',
    parent: 'fc-n',
    x: H + 2 - t,
    y: backRim,
    w: BL + 2 * t,
    deep: BW + t + 2 * p.lidPlayMm,
    skirt,
    t,
    order: 5,
  });

  return {
    panels: [...body.panels, ...cover.panels],
    slits: body.slits,
    rootId: 'fc-base',
    loose: [],
    assembly: [
      'Build the tray first: bring all four walls up together — the corner webs fold themselves double on the diagonal as they rise — then swing each doubled web flat against the end.',
      'Roll each end up over the webs and press the inner panel down inside. The tray is now locked.',
      'Fold the lid over the top. Press its two front corner webs flat the same way as the tray’s, then bring the front skirt down — the webs tuck in behind the side skirts and the lid closes square on all four corners.',
    ],
  };
}

// ───────────────────────────────── tray & lid ─────────────────────────────────

function buildTrayLid(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const gap = 8;

  const fit = slotFit(p, machineById(p.machineId), t);
  const base = tray({ prefix: 'tr-', labelPrefix: 'tray ', L, W, H, t, x: 0, y: 0, fit });

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
    fit,
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
  //
  // …unless a hang header has taken the back wall's top edge, in which case the top
  // closure comes off the FRONT instead and the carton stops being a reverse tuck.
  // That is not a compromise, it is what ECMA closure 21 IS.
  const topOnFront = headerTakesTop(p);
  const topWall = topOnFront ? front : back;
  const topSpan = topOnFront ? s[0] : s[2];
  const top = closure({
    prefix: 'tt-top-',
    parent: topWall.id,
    x: topSpan.x,
    y: H,
    w: topSpan.w,
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

  const hung = applyHangTab(p, panels, body, H);

  return {
    panels: hung.panels,
    slits,
    rootId: front.id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall and let it set — this is the only glued joint.',
      'Close the base first: dust flaps in, then the bottom panel down and its tuck inside.',
      'Fill the box, then close the top the same way.',
      ...hangSteps(p),
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

  // A header on the back wall takes the top closure with it — see `applyHangTab`.
  const topOnFront = headerTakesTop(p);
  const topWall = topOnFront ? front : back;
  const topSpan = topOnFront ? s[0] : s[2];
  const top = closure({
    prefix: 'sl-top-',
    parent: topWall.id,
    x: topSpan.x,
    y: H,
    w: topSpan.w,
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

  // The base is the shared self-locking envelope (ECMA closure 55) — the same
  // structure the gable carton stands on, which is why it lives in `primitives`.
  const base = envelopeBottom({ prefix: 'sl-', walls: body.walls, spans: s, L, W, t, y: 0 });
  panels.push(...base.panels);
  slits.push(...base.slits);

  const hung = applyHangTab(p, panels, body, H);

  return {
    panels: hung.panels,
    slits,
    rootId: front.id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall.',
      'Fold the slotted base panel in, then both side flaps in on top of it.',
      'Fold the last base panel down and push its tongue through the slot — the base now holds itself shut.',
      ...hangSteps(p),
    ],
  };
}

// ─────────────────────── mailer — roll end tuck top (RETT) ───────────────────────

/** The e-commerce mailer — a roll end tuck top, the most-made glue-free box there is
 *  and a standard industry structure rather than anyone's design.
 *
 *  The construction was worked out by MEASURING a rendered example at a known size
 *  (315 × 202 × 62 on 1.5 mm board) and then re-deriving every term from scratch as a
 *  formula in L, W, H and caliper, so it survives the jump to cardstock. Nothing was
 *  copied: no file, no path, no coordinate. What measuring bought was knowing WHICH
 *  terms matter — and they are these:
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
  // Which of the two mailers this is. Read off the style rather than a toggle: the
  // side flaps change the lid's whole geometry and its ECMA cover digit, so they are
  // a different box, not a setting on this one.
  const sideFlaps = p.style === 'mailer-flaps';
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);

  const BL = L + 5 * t;
  const BW = W + 2 * t;
  const wallH = H + t;

  // Which short ends carry a hang tab. `left` is the net's −x end: the tab reaches out
  // past it and the box drops below it, long axis vertical. See `HangEnd`.
  //
  // A mailer offers exactly one hang tab, and `MAILER_HANG` is the list the UI reads
  // too, so a mode this style does not have can never arrive here from a preset or from
  // switching styles. A builder that quietly reinterprets a mode it was not given is
  // worse than one that ignores it.
  const hangTab = hangMode(p);
  const hangs = hangTab === 'none' ? [] : p.hangEnd === 'both' ? ['l', 'r'] : [p.hangEnd[0]];
  const hangL = hangs.includes('l');
  const hangR = hangs.includes('r');

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

  const fit = slotFit(p, machineById(p.machineId), t);
  const rolls = [
    rollEnd({ prefix: 'ml-l', parent: base.id, x: 0, y0: 0, y1: BW, dir: -1, H, t, hand, order: 3, fit }),
    rollEnd({ prefix: 'ml-r', parent: base.id, x: BL, y0: 0, y1: BW, dir: 1, H, t, hand, order: 3, fit }),
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
      // Trapped between the outer wall and the inner ply.
      thin: true,
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

  // Lid. The two covers want opposite things here, and getting it wrong is invisible
  // on the dieline:
  //
  //   cover 50  CAPS OVER the walls — one caliper wider than the base, so it drops
  //             over the outside rather than fighting them.
  //   cover 53  NESTS INSIDE them — because its two wings hinge on the lid's own side
  //             edges and have to come down WITHIN the rolled ends. Hinge a wing on an
  //             overhanging edge and it lands outside the box, clamping it instead of
  //             bracing it, which is the one thing the third and fourth wing are for.
  //
  // So with flaps the lid narrows and sits into the rim; without them it keeps the
  // overhang it always had.
  //
  // The wings are what decide the lid's size, and it is the note above that says why:
  // a wing hinges on the lid's own short edge, so that edge has to land INSIDE the
  // rolled end for the wing to come down against it. The rim's clear span is the base
  // less one roll each side, and the wing needs a slot fit on top of that.
  //
  // A hang tab is the lid carrying on past a short end, so it wants the SAME edge the
  // wing hinges on. Whichever ends carry a tab therefore go without a wing, which also
  // means "both ends" is a choice between the two rather than a conflict to diagnose.
  const wings = p.lidWings;
  const wingFit = slotFit(p, machineById(p.machineId), t).widthMm;
  const lidY = BW + wallH;
  const lidD = W + t;
  const lidW = wings ? Math.max(10, BL - 2 * layerStep(t) - 2 * wingFit) : BL + t;
  const lidX = wings ? (BL - lidW) / 2 : -t / 2;
  // Everything below — the tuck's width, its lugs, the window — is measured off the
  // lid's own rect, NOT off whatever the tab leaves behind. A tuck sized from the
  // grown outline is a tuck that cannot go between the end walls.
  const lidTab = lidHangTab({
    kind: hangTab,
    shape: p.hangHole,
    x: lidX,
    y: lidY,
    w: lidW,
    h: lidD,
    left: hangL,
    right: hangR,
    heightMm: p.hangTabHeightMm,
    t,
  });
  const lid: Panel = {
    id: 'ml-lid',
    label: 'lid',
    role: 'lid',
    outline: lidTab.outline,
    windowRect: lidTab.windowRect,
    holes: lidTab.holes,
    parent: back.id,
    foldAngle: HALF,
    order: 6,
  };

  // ── lid wings (ECMA cover 53) ──
  //
  // One on each short edge of the lid, folding down inside the rolled end. They are
  // what turn a tuck-in flap cover into a braced one: with the lid nested rather than
  // capped over, the two wings hold its ends down instead of letting them lift, and the
  // box stops being something you can pull the lid off by a corner.
  //
  // Depth is deliberately short of the floor. A wing that reaches it lands on the inner
  // ply's own nib tabs and stands the lid proud; stopping a couple of calipers up puts
  // it flat against the end and clear of the lock underneath.
  if (wings) {
    const wingD = clamp(H * 0.6, 5, Math.max(5, H - 3 * t));
    const wingY0 = lidY + g;
    const wingY1 = lidY + lidD - g;
    // Chamfered on the leading corner — the one that meets the rim first as the lid
    // comes down — for the same reason the tuck lug is: a square corner catches on the
    // rim and levers the wing back out instead of guiding it in.
    const wingCh = Math.min(wingD * 0.35, (wingY1 - wingY0) * 0.25);
    const wing = (id: string, hx: number, dirX: 1 | -1): Panel => ({
      id,
      label: 'lid wing',
      role: 'flap',
      outline: [
        [hx, wingY0],
        [hx + dirX * wingD, wingY0 + wingCh],
        [hx + dirX * wingD, wingY1 - wingCh],
        [hx, wingY1],
      ],
      holes: [],
      parent: lid.id,
      foldAngle: HALF,
      // With the lid, not after it: by hand the wings are pinched in as it goes down.
      order: 7,
      undershoot: 0.04,
    });
    if (!hangL) panels.push(wing('ml-wing-l', lidX, -1));
    if (!hangR) panels.push(wing('ml-wing-r', lidX + lidW, 1));
  }

  // The tuck goes the full depth of the front wall, inside it. Its far corners carry
  // a radius of nearly half its depth — that is what lets it find the gap between the
  // wall and the two ears instead of catching on them.
  const tuckD = clamp(H - 2 * t, 6, Math.max(6, H));
  const tuckW = Math.max(8, Math.min(L, lidW - 2 * g));
  const tuckX = lidX + lidW / 2 - tuckW / 2;
  // The far corners' radius. On a plain tuck it is nearly half the depth — that big
  // sweep is what lets a bare tuck find the gap between the front wall and the ears.
  // A tuck WITH lugs is guided in by the lugs instead, so it can keep a much smaller
  // radius — and it has to, because the radius eats the straight edge the lugs hinge
  // on. At 0.48 the lug lost half its height to a corner it never touches.
  const tuckR = sideFlaps
    ? Math.min(tuckD * 0.2, tuckW * 0.08)
    : Math.min(tuckD * 0.48, tuckW * 0.14);
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
    order: 8,
  };

  panels.push(lid, tuckPanel);

  // The locking lugs — a flap on each END of the TUCK FLAP, not on the lid.
  //
  // That distinction is the whole style and it is easy to get backwards. The lid folds
  // over the rim and the tuck folds DOWN off it, inside the front wall; so the tuck's
  // two side edges, which run left-right across the blank, stand VERTICAL in the
  // finished box. A lug hinged on one of them swings about a vertical axis and lands
  // flat against the inside of an end wall — which is what pins the tuck in place.
  //
  // Put the same flaps on the LID instead and they hinge about a horizontal axis and
  // hang down the ends: they hold the lid flat but do nothing to stop the tuck pulling
  // back out, which is the joint that actually opens.
  if (sideFlaps) {
    // How far the lug reaches into the box. It has to bite properly — this is the
    // whole lock — but past about a third of the depth it starts fouling the contents.
    const lugD = clamp(W * 0.35, 6, Math.max(6, W * 0.5));
    // The lug runs almost the full depth of the tuck, stopping just clear of the
    // rounded far corner. Anything less and it is gripping the top of the end wall
    // only, which is the part that flexes most.
    const lugNear = tuckY + g;
    const lugFar = tuckY + tuckD - tuckR - g;
    // The chamfer goes on the LEADING corner — the one furthest into the box, which
    // meets the end wall's rim first as the tuck goes down. Putting it on the other
    // end (which is what this did at first) leaves a square corner to catch on the rim
    // and turns the lug into a wedge pointing the wrong way.
    //
    // It is a CORNER cut, and it was not. The far edge used to run from the lug's full
    // reach all the way back to the hinge — not a chamfer at all but a taper across the
    // whole lug, which drew a swept-back pennant that reads as an offcut on the dieline.
    // Cutting `lugCh` off BOTH sides of the corner does the job the note above describes
    // and leaves the far edge square across the rest of its width, so the lug seats flat
    // against the end wall instead of meeting it along a diagonal. The area it grips
    // with goes up by about a seventh; the shape is the point.
    const lugCh = Math.min(lugD * 0.3, (lugFar - lugNear) * 0.3);
    const lug = (id: string, hx: number, dirX: 1 | -1): Panel => ({
      id,
      label: 'tuck lug',
      role: 'flap',
      // Springs out INSIDE the end wall, so it rides in the same one-caliper gap.
      thin: true,
      outline: [
        [hx, lugNear],
        [hx + dirX * lugD, lugNear],
        [hx + dirX * lugD, lugFar - lugCh],
        [hx + dirX * (lugD - lugCh), lugFar],
        [hx, lugFar],
      ],
      holes: [],
      parent: tuckPanel.id,
      foldAngle: HALF,
      // In as the tuck goes down, not after — they are one motion by hand.
      order: 9,
      overshoot: 0.1,
    });
    panels.push(lug('ml-tucklf', tuckX, -1), lug('ml-tucklr', tuckX + tuckW, 1));
  }

  return {
    panels,
    slits: [],
    rootId: base.id,
    loose: [],
    assembly: [
      'Stand the front and back walls up, then fold the four corner ears inward so they lie flat against the ends.',
      'Now roll each end over the ears: the wall up, the narrow strip across the top, the inner panel straight back down inside.',
      'Push the two tabs on each inner panel through the slots in the floor. That is the whole lock — the ends are now double-walled and nothing can spring open.',
      ...(sideFlaps
        ? [
            'Fold the lid over the rim, then fold the two small lugs on the ends of the tuck flap inward to a right angle.',
            'Slide the tuck down inside the front wall. As it goes in, the two lugs pass the end walls and spring out flat against them on the inside — the chamfered corners are what lets them find their way past the rim, so keep the tuck square as it goes down.',
            'That is the lock: the tuck cannot pull back out without both lugs folding again, and they cannot fold while the box is shut.',
          ]
        : ['Fold the lid over and slide its tuck down inside the front wall.']),
      ...(p.lidWings
        ? [
            'The lid nests INSIDE the rim rather than capping over it, so bring it down square and pinch the two wings inward as it goes — the chamfered corners are what lets them find their way past the rolled ends. Once they are in, the lid cannot lift at the ends.',
          ]
        : []),
      ...mailerHangSteps(p),
    ],
  };
}

/** The slope-roof gable carry carton — the bakery/gift box with a peaked roof, two
 *  handle blades meeting face to face at the ridge, and a locking ear standing proud
 *  at each end.
 *
 *  **ECMA A55.75.01.03**, catalogued p.27: self-locking envelope bottom (55) · *gable
 *  top closure with locking flap* (75) · bottom's last flap on panel 1 · top's on
 *  panel 3. The bottom is literally the `envelopeBottom` the snap-lock carton stands
 *  on, which is the point of a four-pair code: the two ends are coded independently,
 *  so they can be built independently too.
 *
 *  What the standard draws generically is how the "locking flap" actually locks, and
 *  that is the whole of this function:
 *
 *      · the two roof panels hinge off the L walls and lean in to a ridge
 *      · a blade stands vertically above each roof panel, and the two meet face to face
 *      · the roof is CUT BACK at both ends, which leaves the gable opening as a flat
 *        triangle leaning inward from the end wall by `lean`
 *      · the ear hinges off the W wall, swings into exactly that plane, and a slot
 *        down its centre line swallows BOTH blades at once. That is the lock: the
 *        blades cannot part, so the roof cannot open.
 *
 *  Two derivations are load-bearing and neither is guessable from the silhouette.
 *
 *  **The notch is drawn on the ear's swing circle.** The ear's slot end travels on a
 *  circle about the ear's own hinge, so the blade has to be relieved on that same
 *  circle or the ear jams on its corner. In the FLAT net that circle is centred `rise`
 *  BELOW the ridge line rather than on it, because above the ridge net-y is height
 *  while along the roof net-y is SLOPE. Centre it on the ridge instead and the notch
 *  comes out on the wrong radius: a blade the ear cannot pass, or a step it slides off.
 *
 *  **The shoulder above the notch is RADIAL.** Past the step the blade's edge runs
 *  back out along the ear's own centre line (plus a few degrees of draft), so the slot
 *  slides up beside it. Any shallower and the shoulder leans back across the slot's
 *  path and the ear cannot seat — which is not visible in the dieline, only in the
 *  fold, which is why `tests/fold.mts` measures where the blade crosses the ear's
 *  plane rather than whether their bounding boxes overlap. See provenance §4.1 for
 *  what that distinction cost the last time. */
function buildGable(p: BoxParams): StyleParts {
  const { L, W, H } = insideDims(p);
  const t = p.caliperMm;
  const g = relief(t);
  // TWO plies go through the ear's slot — both blades at once. Handing this the box's
  // caliper is exactly the mistake `slotFit`'s signature is shaped to prevent.
  const fit = slotFit(p, machineById(p.machineId), 2 * t);

  const body = tube({ prefix: 'gb-', L, W, H, t, glueTabMm: p.glueTabMm, x: 0, y: 0 });
  const s = body.spans;
  const panels: Panel[] = [...body.panels];
  const slits: Slit[] = [];

  // The roof triangle. Everything else falls out of the pitch — and the roof panel in
  // the flat net is as long as the SLOPE, not as tall as the rise; get that wrong and
  // the ridge never meets. Half-span is taken between the two wall PLANES rather than
  // their inside faces, because that is where the creases the roof hinges on are.
  const pitch = clamp((p.roofPitchDeg * Math.PI) / 180, 0.26, 1.05);
  const half = (W + t) / 2;
  const rise = half * Math.tan(pitch);
  const slope = half / Math.cos(pitch);
  const ridgeY = H + slope;
  // Unfolded, the roof carries straight on up from the wall, so it has to lean in by
  // the angle between "straight up" and the line from the wall top to the ridge.
  const roofFold = HALF - pitch;

  // A handle taller than the box it stands on is not a handle, it is a flag. The
  // slider runs to 140 for a basket tray's grip; here it is capped on L as well.
  const blade = clamp(p.handleHeightMm, 20, Math.min(120, Math.max(20, L * 0.9)));
  const topY = ridgeY + blade;
  /** The notch arc's centre in NET coordinates: the ear's hinge, seen from the blade. */
  const arcY = ridgeY - rise;

  // The seat angle. NOT a taste decision: because the shoulder is radial, by the time
  // it reaches the blade's top edge it has already come (rise + blade)·tan(lean) in
  // from the end of the box — and two of those plus a strap between them is the whole
  // wall. So the wall fixes the angle, and 35° is only ever the ceiling. (35° is what
  // the trade draws; below about 15° the ear stands too near vertical for its slot to
  // find a blade standing on the ridge at all.)
  const LEAN_MAX = (35 * Math.PI) / 180;
  const LEAN_MIN = (15 * Math.PI) / 180;
  const DRAFT = (5 * Math.PI) / 180;
  const lean = clamp(Math.atan2(s[0].w * 0.34, rise + blade), LEAN_MIN, LEAN_MAX);
  /** How much comes off each end of the roof, and where the blade's base corner lands
   *  on the ear's swing circle. Both are the same radius — the gable opening's edge is
   *  itself radial, which is why the ear seats flush against the roof. */
  const cut = rise * Math.tan(lean);
  const toRidge = rise / Math.cos(lean);

  // How much blade the ear swallows once it is home. Most of it — floored so a short
  // handle still locks, and capped so the step stays below the blade's top edge.
  const seat = clamp(blade * 0.6, 10, Math.max(10, blade - 4));
  const maxReach = (rise + blade) / Math.cos(lean) - 3;
  const reach = Math.min(toRidge + seat, maxReach);
  const yEdge = arcY + Math.sqrt(Math.max(1, reach * reach - cut * cut));
  const aEdge = Math.asin(clamp(cut / reach, -1, 1));
  const stepIn = reach * Math.sin(lean);
  const stepY = arcY + reach * Math.cos(lean);
  /** Where the radial shoulder has got to by the blade's top edge. */
  const topIn = stepIn + Math.max(0, topY - stepY) * Math.tan(lean + DRAFT);
  /** Is there a lock here at all? Below MIN_SEAT_MM of engagement, or once the two
   *  shoulders have eaten the strap between them, there is not — and then the ear
   *  still closes the gable end but it is a cover, not a catch. Saying so beats
   *  drawing a notch too shallow to hold and letting the box open in someone's hand. */
  const MIN_SEAT_MM = 4;
  const locks = reach >= toRidge + MIN_SEAT_MM && 2 * topIn <= s[0].w * 0.86;
  // Arc segments per notch, at a fixed segment LENGTH rather than a fixed count. A
  // count is what fixes the chord error on a big box and then, on a small one, hands
  // `roundCorners` a 0.17 mm neighbour to clamp the step fillet against — which is
  // under the printed sheet's own weld tolerance, so the fillet collapses to a stack
  // of coincident points and the 3MF comes out with degenerate triangles in it. The
  // dieline looks perfect either way; only the mesh knows.
  const arcLen = reach * Math.max(0, lean - aEdge);
  const AN = Math.max(4, Math.min(16, Math.round(arcLen / 2.5)));
  /** Fillet for the blade's two TOP corners. The step below them is deliberately left
   *  sharp: it is a reflex corner, and `roundCorners` fillets a reflex corner by
   *  bulging it OUTWARD — straight into the arc the ear's slot end has to travel down.
   *  Rounded to 1.2 mm there, the bulge measured 0.74 mm into the ear's path, which is
   *  most of a card thickness of interference in the one place the box has to click
   *  shut. It reads as a nicety in the dieline and is a jam in the hand. */
  const topFillet = Math.min(6, (topY - stepY) / 3);

  // ── roof + handle blade on each L wall ──
  for (const i of [0, 2] as const) {
    const span = s[i];
    const x0 = span.x;
    const x1 = span.x + span.w;
    const roofId = `gb-roof${i}`;
    panels.push({
      id: roofId,
      label: 'gable roof',
      role: 'body',
      // A trapezoid, not a rectangle: the cut-back ends are what leave the gable
      // opening flat, and a flat opening is the only kind an ear can seat in.
      outline: [
        [x0, H],
        [x1, H],
        [x1 - cut, ridgeY],
        [x0 + cut, ridgeY],
      ],
      holes: [],
      parent: (body.walls[i] as Panel).id,
      foldAngle: roofFold,
      order: 2,
    });

    const ring: Poly = locks
      ? [
          [x0 + cut, ridgeY],
          [x1 - cut, ridgeY],
          // Right notch: in along the swing circle from the blade's edge to the step,
          // then back out on the radial shoulder to the top.
          ...arcPoints(x1, arcY, reach, HALF + aEdge, HALF + lean, AN),
          [x1 - topIn, topY],
          [x0 + topIn, topY],
          ...arcPoints(x0, arcY, reach, HALF - lean, HALF - aEdge, AN),
        ]
      : [
          [x0 + cut, ridgeY],
          [x1 - cut, ridgeY],
          [x1 - cut, topY],
          [x0 + cut, topY],
        ];
    // Only the corners that are actually corners get filleted; the notches are already
    // arcs. The two step corners are CONCAVE, which is where card tears.
    const radii = ring.map(() => 0);
    if (locks) {
      radii[3 + AN] = topFillet;
      radii[4 + AN] = topFillet;
    } else {
      radii[2] = Math.min(10, blade / 3);
      radii[3] = Math.min(10, blade / 3);
    }

    // The hand hole lives in the WIDE part of the blade — below the step, where the
    // notches have not reached yet — and clear of the ridge crease under it. Its top
    // stops at the step for the same reason a tray's grip stops short of the rim: a
    // hole that runs into the narrow part tears out the first time it is carried.
    // Stopping a hair below the step rather than exactly on it: level with it, the
    // hole's corner and the blade's shoulder share a y and the hole bridge the
    // triangulator inserts between them comes out as a zero-area sliver.
    const holeTop = Math.min(locks ? stepY - 2 : topY - 8, topY - 8);
    const holeBot = ridgeY + Math.max(6, blade * 0.18);
    const room = holeTop - holeBot;
    // Width at the hole's ceiling: below `yEdge` the blade is full width, above it the
    // notch arc is already eating in. Never clamped UP to a floor — a hand hole wider
    // than the strap it is cut in breaches the outline, and a breached outline derives
    // as a second blank rather than as an error.
    const eaten = holeTop <= yEdge ? cut : Math.sqrt(Math.max(0, reach * reach - (holeTop - arcY) ** 2));
    const holeW = Math.min(span.w * 0.55, span.w - 2 * (locks ? eaten : cut) - 20, 130);
    panels.push({
      id: `gb-blade${i}`,
      label: 'handle',
      role: 'flap',
      outline: roundCorners(ring, radii),
      holes:
        room >= 8 && holeW >= 12
          ? [stadium(x0 + span.w / 2, (holeBot + holeTop) / 2, holeW, clamp(room, 8, 34))]
          : [],
      // The blade rotates back by exactly the roof's own angle, which is what leaves
      // the two blades vertical, parallel and face to face.
      parent: roofId,
      foldAngle: -roofFold,
      order: 3,
    });
  }

  // ── locking ear on each W wall ──
  const slotW = Math.max(fit.widthMm, 2 * t + 2 * fit.clearMm);
  const earLen = reach + Math.max(5, blade * 0.12);
  for (const i of [1, 3] as const) {
    const span = s[i];
    const usable = span.w - 2 * g;
    // A trapezoid rather than a true triangle: a point leaves no material either side
    // of a slot that runs almost the whole way to the tip.
    const tipW = clamp(Math.max(usable * 0.22, slotW + 12), 6, usable);
    const taper = (usable - tipW) / 2;
    const cx = span.x + span.w / 2;
    // The tip is CHAMFERED, not filleted. A fillet here is a five-segment arc running
    // almost tangent to a flat top edge, and the two of them leave the blank's ring
    // with a pair of vertices four ten-thousandths of a millimetre apart in y and ten
    // millimetres apart in x. Nothing downstream of the dieline notices — but the
    // printed sheet's triangulator turns that run into zero-area slivers and the 3MF
    // stops being watertight. A chamfer says the same thing about the corner with
    // four points and no near-collinear anything.
    const tipCh = Math.min(6, earLen * 0.12, tipW * 0.25);
    const ring: Poly = [
      [span.x + g, H],
      [span.x + span.w - g, H],
      [span.x + span.w - g - taper, H + earLen - tipCh],
      [span.x + span.w - g - taper - tipCh, H + earLen],
      [span.x + g + taper + tipCh, H + earLen],
      [span.x + g + taper, H + earLen - tipCh],
    ];
    // The slot starts inboard of where the blade's corner lands, so the ear has a
    // lead-in rather than having to find both blades dead on its first millimetre.
    const slotLo = H + Math.max(3, toRidge - Math.max(5, blade * 0.2));
    const slotHi = H + reach;
    panels.push({
      id: `gb-ear${i}`,
      label: 'locking ear',
      role: 'flap',
      outline: ring,
      holes: locks ? [stadium(cx, (slotLo + slotHi) / 2, slotW, slotHi - slotLo)] : [],
      parent: (body.walls[i] as Panel).id,
      // Into the gable opening's own plane. The roof's cut edges lie in it, so the ear
      // seats flush against them and its corners stand proud above the roofline —
      // which is the detail that makes this box recognisable on a shelf.
      foldAngle: lean,
      order: 4,
    });
  }

  const base = envelopeBottom({ prefix: 'gb-', walls: body.walls, spans: s, L, W, t, y: 0 });
  panels.push(...base.panels);
  slits.push(...base.slits);

  return {
    panels,
    slits,
    rootId: (body.walls[0] as Panel).id,
    loose: [],
    assembly: [
      'Glue the lap behind the far wall and square the tube up.',
      'Fold the slotted base panel in, then both side flaps on top of it, then the last panel down and its tongue through the slot — the base now holds itself shut.',
      'Bring both roof panels up until the two handle blades meet face to face.',
      locks
        ? 'Swing each end ear inward and thread its slot down over BOTH blades at once. It stops in the notch cut into their shoulders — that notch is the lock, and the roof cannot open while the ears are home.'
        : 'Swing each end ear inward to close the gable. At this size there is no room for the slot lock, so the ears cover the ends but do not catch — tape or a sticker holds the roof shut.',
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

  const hung = applyHangTab(p, [...body.panels], body, H);

  return {
    panels: hung.panels,
    slits: [],
    rootId: body.walls[0].id,
    loose: [],
    assembly: ['Glue the lap behind the far wall. Slide it over your tray.', ...hangSteps(p)],
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
  'mailer-flaps': 'ml-lid',
  tray: '',
  // A webbed tray is open on top and its walls are the closed corners' business —
  // there is no face to cut that does not weaken the lock.
  'tray-webbed': '',
  'tray-lid': 'ld-base',
  'flap-cover': 'fc-lid-deck',
  'tuck-top': 'tt-w0',
  'snap-lock': 'sl-w0',
  gable: 'gb-w0',
  sleeve: 'sv-w0',
  divider: '',
};

/** Which panel this configuration's window is cut in.
 *
 *  `WINDOW_PANEL` is the default and `windowFaces` is the menu; a face is only honoured
 *  when the CURRENT style offers it. Trusting the parameter directly would let a face id
 *  survive a style switch — or a shared preset — and cut the aperture into whichever
 *  panel happened to answer to that id, or into none at all. */
export function windowHost(p: BoxParams): string {
  const faces = styleMeta(p.style).windowFaces;
  if (p.windowFace && faces?.some((f) => f.id === p.windowFace)) return p.windowFace;
  return WINDOW_PANEL[p.style];
}

export function buildStyle(p: BoxParams): {
  parts: StyleParts;
  windowFitted: boolean;
  windowInsetMm: number;
} {
  const builders: Record<BoxParams['style'], (p: BoxParams) => StyleParts> = {
    mailer: buildMailer,
    'mailer-flaps': buildMailer,
    tray: buildTray,
    'tray-webbed': buildWebbedTray,
    'tray-lid': buildTrayLid,
    'flap-cover': buildFlapCover,
    'tuck-top': buildTuckTop,
    'snap-lock': buildSnapLock,
    gable: buildGable,
    sleeve: buildSleeve,
    divider: buildDivider,
  };
  const parts = builders[p.style](p);
  const hostId = windowHost(p);
  if (!hostId) return { parts, windowFitted: true, windowInsetMm: TRADE_INSET };
  const { parts: withWindow, fitted, insetMm } = applyWindow(parts, hostId, p);
  return { parts: withWindow, windowFitted: fitted, windowInsetMm: insetMm };
}


export function styleMeta(id: BoxParams['style']): StyleMeta {
  return STYLES.find((s) => s.id === id) ?? (STYLES[0] as StyleMeta);
}

/** The ECMA reference for a style AS CURRENTLY CONFIGURED. Always go through this
 *  rather than reading `meta.ecma` directly: an option that changes the structure
 *  changes the code, and the whole point of carrying a code is that it is true. */
export function styleEcma(p: BoxParams): EcmaRef {
  const meta = styleMeta(p.style);
  return meta.variants?.find((v) => v.when(p))?.ecma ?? meta.ecma;
}

/** Unused import guard — `glueTab` and `Pt` are re-exported for the tests. */
export { glueTab };
export type { Pt };
