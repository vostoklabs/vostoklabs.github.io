// 1. STATE — every setting the generator has, in one plain object.
//    Save / Load serialise exactly this, so keep it JSON-friendly.

export type Layout = 'horizontal' | 'vertical';
export type LetterStyle = 'raised' | 'engraved';
/** The plate behind the letters: hug their outline, a plain rounded rectangle, or
 *  nothing at all.
 *
 *  `none` is not "outline with the margin at zero". It removes the SPINE — the bar of
 *  solid laid along the pen's axis that guarantees wall around the bore no matter what
 *  the text is — and once that bar is gone the letters have to hold the hole
 *  themselves, so they are grown until they can. That is the shop-bought name topper:
 *  a word with a fat outline round it and a pen through the middle, and no slab.
 *
 *  The decorative templates (star, heart, shield, pennant) are gone — scaling an
 *  outline to a text bounding box gives a shape that fits neither the letters nor
 *  itself, and every one of them came out wrong. */
export type PlateShape = 'outline' | 'rectangle' | 'none';
export type ColorScheme = 'single' | 'plate-text' | 'plate-halo-text';
export type PrintMode = 'ams' | 'noams';
/** `none` is not a degree of fit, it is the absence of one: no ribs at all, and the
 *  pen slides in and out of a plain clearance hole. It lives on the same control
 *  because that is where someone whose pencil is getting marked will look for it —
 *  not two collapsed sections away on a rib-count slider. */
export type FitClass = 'snug' | 'normal' | 'loose' | 'none';

/**
 * The hole's cross-section.
 *
 * `hex` is for a hexagonal barrel, and it is not a cosmetic match — it is the fix for
 * the one case ribs cannot cover. Three ribs at 120 degrees against six corners at 60
 * are all on flats or all on corners together, so a round hole grips a pencil at half
 * its rotations and rattles at the other half. A hex hole has no such rotations: it
 * mates one way, six times over, and every face of the barrel is parallel to a face
 * of the hole at 0.3 mm.
 *
 * It also prints better than the round one. Sat vertex-up, its two roof faces are at
 * 60 degrees, which is inside every overhang limit — so a hex hole needs no teardrop
 * cap and no bridge at all.
 */
export type HoleShape = 'round' | 'hex';

/**
 * Where the pen's hole actually lives — the single biggest decision about what the
 * object is, and the one every shop-bought pencil topper answers differently.
 *
 * `collar`  a socket stuck on the plate's edge. The name stays thin; the pen butts
 *           into a separate tube. Cheapest in plastic, and the only one that works
 *           when the name is too small to swallow a bore.
 * `inset`   the hole is bored INTO the name block itself, which is thickened until
 *           it can hold it. No tube: the letters are the socket. The pen stops
 *           inside.
 * `through` the same, bored all the way through, so the pen slides right past and
 *           the topper becomes a band you can put anywhere on the barrel — which is
 *           also what makes it work on a straw or a drawstring.
 */
export type PenPath = 'collar' | 'inset' | 'through';

/**
 * A pen the socket can be sized for.
 *
 * `barrel` is the REAL outer diameter at the rear/cap end — the surface the socket
 * slides over — and for the hexagonal barrels it is the across-CORNERS figure, not
 * across-flats. That distinction is the whole game: a BIC Cristal measures 8.3 mm
 * across its flats and 9.6 mm across its corners, and a round bore sized to 8.3 mm
 * does not go on the pen at all.
 *
 * The printing clearance is NOT baked in here — `boreFor()` adds it, so the fit
 * control can move it without every preset needing to be re-measured.
 */
export interface PenPreset {
  id: string;
  label: string;
  /** Real barrel OD in mm (across corners for hex barrels). */
  barrel: number;
  note: string;
  /** Hexagonal barrel. Sets the hole shape when the preset is picked; the user can
   *  still override it, because a hex hole on a hex pen is a preference (it grips
   *  better) and not a requirement (a round hole still goes on). */
  hex?: true;
  /** Forced pen path. Only for the things that are not pens: a straw or a drawstring
   *  has no end to perch on, so the only arrangement that works is a band the thing
   *  passes right through, and picking the preset should not leave that to be
   *  discovered. Absent on every real pen, which can take any of the three. */
  path?: PenPath;
  /** A tube, not a barrel. Squeeze it like a pencil and it folds flat, so the fit is
   *  capped at `HOLLOW_MAX_INTERFERENCE_MM` whatever the Fit control says. */
  hollow?: true;
  /** How far in from the end this thing is NOT its barrel, mm.
   *
   *  A pencil is the case that matters: about 5 mm of soft eraser sticks out past a
   *  10 mm metal ferrule, and neither is the wood. The hole grips the ferrule too —
   *  7.9 mm against an 8.1 mm corner circle is close enough that one hole does both —
   *  but a socket shallower than this never reaches the barrel at all, which is a
   *  topper that holds by rubber and falls off the moment the eraser is used up. */
  softEndMm?: number;
}

/*
  Ordered by size, smallest first, and every label carries its own millimetre — the
  list IS the comparison. Someone holding a pen does not know whether it is "a round
  pen" or "a gel pen"; they can see that one hole is 9.6 and the next is 11.5.

  "Gel pen with grip" used to sit between them at 11.0 and was the one entry nobody
  could check: the grip is a soft sleeve that varies by more than the gap to its
  neighbours on either side, so it was a made-up number wearing a brand name. Custom
  is the honest answer for those.
*/
export const PEN_PRESETS: PenPreset[] = [
  {
    id: 'drawstring',
    label: 'Drawstring / cord · 5.0 mm',
    barrel: 5.0,
    note: 'Round backpack drawstring and flat hoodie cord run 4–5 mm. The cord has no end to sit on, so the hole goes straight through and the topper slides along it.',
    path: 'through',
  },
  {
    id: 'straw',
    label: 'Drinking straw · 6.0 mm',
    barrel: 6.0,
    note: 'A standard drinking straw — 6.0 mm across the outside. It threads on over the end, so the hole runs straight through, and the squeeze is held light because a straw folds flat where a barrel would not.',
    path: 'through',
    hollow: true,
  },
  {
    id: 'hex-pencil',
    label: 'Hex pencil · 8.0 mm',
    // Between the two things a pencil actually offers a hole: 8.1 across the hex
    // corners, and about 7.9 for the metal ferrule under the eraser. Sizing to 8.0
    // grips the wood firmly and the ferrule lightly, so one socket does both ends.
    barrel: 8.1,
    hex: true,
    note: 'Standard #2 / Ticonderoga school pencil — 7.0 mm across the flats, 8.1 across the corners. A hex hole matches every face of it, so it grips the same however the pencil is turned. Note it will not pass the 7.9 mm round ferrule under the eraser: put the topper on from the sharpened end, or switch to a round hole.',
    softEndMm: 15,
  },
  {
    id: 'stylus',
    label: 'Stylus / Apple Pencil · 8.9 mm',
    barrel: 8.9,
    note: 'Apple Pencil, every generation — 8.9 mm and round the whole way. Also most generic capacitive styluses.',
  },
  {
    id: 'bic-cristal',
    label: 'BIC Cristal · 9.6 mm',
    barrel: 9.6,
    hex: true,
    note: 'The classic hex ballpoint — 8.3 mm across the flats, 9.6 across the corners.',
  },
  {
    id: 'round-pen',
    label: 'Round pen · 10.0 mm',
    barrel: 10.0,
    note: 'BIC Round Stic, InkJoy 100, hotel and promo click pens — about 10.0 mm round at the cap end.',
  },
  {
    id: 'sharpie',
    label: 'Sharpie fine point · 11.5 mm',
    barrel: 11.5,
    note: 'Sharpie permanent marker, fine point — 11.5 mm round barrel.',
  },
  {
    id: 'boba-straw',
    label: 'Bubble tea straw · 12.0 mm',
    barrel: 12.0,
    note: 'Bubble tea and smoothie straws — 12.0 mm across, twice a drinking straw. Straight through, same as the small one, and squeezed just as lightly.',
    path: 'through',
    hollow: true,
  },
  {
    id: 'marker',
    label: 'Broad marker · 12.7 mm',
    barrel: 12.7,
    note: 'Crayola broad line and other washable kids’ markers — 12.7 mm round.',
  },
  {
    id: 'custom',
    label: 'Custom…',
    barrel: 9.6,
    note: 'Measure the barrel where the topper will sit and type it in. On a hex barrel, measure corner to corner — that is the circle a round hole has to clear.',
  },
];


/**
 * THE HOLE CLEARS. THE RIBS GRIP.
 *
 * There is a 0.3 mm gap ALL ROUND the pen — measured from any point on the barrel
 * to the hole wall opposite it — and three thin ribs 0.3 mm tall stand into that gap
 * and exactly bridge it. So the pen touches the ribs and nothing else, and if the
 * ribs were not there it would rattle in a 0.6 mm-oversize hole.
 *
 * Radial, not diametral. On a 7.0 mm pen that is a 7.6 mm hole, not 7.3 — the
 * clearance counts once on each side, so it counts twice on the diameter. Getting
 * that backwards halves the gap, which is how the first attempt at this ended up a
 * press fit when it was supposed to be a touch fit.
 *
 * Why it has to be this way round, and not the other:
 *
 * A hole cut UNDER the barrel presses on the whole circumference at once. Every
 * error adds in the same direction — a printed hole already comes out 0.1-0.3 mm
 * small — so an 0.2 mm interference lands nearer 0.5, the pen will not start, and
 * forcing it splits the socket down a layer line. That version was printed and the
 * pen would not go in at all. Ribs fail gracefully instead: they are thin, so they
 * scrape and squash on the first insertion and take up the slack themselves, and
 * whatever they do the hole behind them still clears.
 *
 * Known limit, worth saying out loud: three ribs at 120 degrees against a HEX
 * barrel (six corners at 60) are all on flats or all on corners together, so at
 * half the rotations they bear on flats and grip less. Four ribs never line up that
 * way. Raise the rib count for a pencil if it feels loose.
 */

/** The gap between the barrel and the hole wall, mm, measured RADIALLY — the same
 *  0.3 at every point around the pen. It lands on the diameter twice.
 *
 *  Nothing is added for printer shrink: a printed hole runs 0.1-0.3 mm small, and at
 *  the default the ribs bear on the pen with zero nominal squeeze, so that shrink IS
 *  the grip. Padding it here would be paying for the same millimetre twice, which is
 *  what made a socket no pen would enter. */
export const BORE_CLEARANCE_MM = 0.3;

/**
 * What the Fit control does: it moves the RIB, never the hole.
 *
 * Both the gap and the rib are radial, so both count twice on the diameter and the
 * squeeze is just the difference doubled:
 *
 *     squeeze = 2 * (ribHeight - boreClearance)
 *
 * At Normal the rib exactly fills the gap and the squeeze is zero — the pen is
 * located by three points of contact and held by whatever the printer's undersize
 * gives back. Snug stands the rib proud of the gap; Loose stops it short.
 *
 * Because the hole itself never moves, no setting here can stop the pen entering.
 * That is the property worth protecting: the previous scheme let the fit shrink the
 * hole, and its tightest setting produced a socket that would not accept the pen.
 */
export const FIT_RIB_OFFSET_MM: Record<FitClass, number> = {
  snug: 0.12, // rib stands 0.12 proud of the gap -> 0.24 mm squeeze on the diameter
  normal: 0, // rib exactly fills the gap -> it touches, and print shrink does the rest
  // Half the gap, so a 0.30 clearance gives a 0.15 rib. At Normal the rib meets the
  // barrel dead on and the printer's undersize turns that into real pressure — enough
  // to leave marks in soft pencil paint. Here it stops half a gap short, so the shrink
  // is spent closing that instead of digging in.
  loose: -0.15,
  none: 0, // unused: `none` sets the rib COUNT to zero, not its height
};

/** The rib height a fit class asks for, given the gap it has to bridge. */
export function ribHeightForFit(clearance: number, fit: FitClass): number {
  return Math.max(0.05, Number((clearance + FIT_RIB_OFFSET_MM[fit]).toFixed(3)));
}

/** How many ribs a fit class wants. `none` is the only one that answers zero; the
 *  rest keep whatever count is set, so switching away from None and back does not
 *  quietly forget that someone had chosen four for a hex barrel. */
export function ribCountForFit(fit: FitClass, current: number): number {
  return fit === 'none' ? 0 : Math.max(1, current);
}

/** A straw or a cord collapses where a barrel does not, so the ribs never squeeze
 *  anything hollow harder than this however the fit is set. Expressed as squeeze
 *  rather than rib height, because squeeze is what folds the tube. */
export const HOLLOW_MAX_INTERFERENCE_MM = 0.1;

/** How far each rib actually protrudes, after the hollow cap. */
export function ribHeightFor(s: Pick<TopperSettings, 'ribHeight' | 'pen' | 'boreClearance'>): number {
  if (!penPreset(s.pen)?.hollow) return s.ribHeight;
  // Invert `squeeze = 2*(rib - clearance)` for the capped squeeze.
  return Math.min(s.ribHeight, s.boreClearance + HOLLOW_MAX_INTERFERENCE_MM / 2);
}

/** The circle that actually touches the pen, mm: the bore, less both ribs. With no
 *  ribs it IS the bore, and the pen is a plain slip fit. */
export function gripFor(
  s: Pick<TopperSettings, 'barrelDia' | 'boreClearance' | 'pen' | 'ribCount' | 'ribHeight' | 'holeShape'>,
): number {
  if (s.ribCount <= 0) return boreFor(s);
  /*
    A rib is measured from the face it stands on, and on a hexagon the faces are at
    cos(30) of the corner circle this figure is quoted in — so a rib worth `r` off a
    face is worth r/cos(30) off the corner diameter. Subtracting it flat, as if the
    hole were round, made every hex rib 13 percent shorter than asked: 0.26 mm where
    0.30 was set, which is the whole grip on a fit whose nominal squeeze is zero.
  */
  const perRib = s.holeShape === 'hex' ? ribHeightFor(s) * HEX_CORNER_FACTOR : ribHeightFor(s);
  return boreFor(s) - 2 * perRib;
}

/** Interference on the diameter: how much barrel the ribs have to give way for.
 *  Negative means nothing touches. */
export function interferenceFor(
  s: Pick<TopperSettings, 'barrelDia' | 'boreClearance' | 'pen' | 'ribCount' | 'ribHeight' | 'holeShape'>,
): number {
  return s.barrelDia - gripFor(s);
}

/** Rib heights from the schemes that came before. Both meant something different —
 *  0.2 was a relief SLOT's depth, not a rib's — so a saved project carrying one
 *  would grip nothing. */
const LEGACY_RIB_HEIGHTS_MM = [0.35, 0.475, 0.2];

export interface TopperSettings {
  // --- Text ---
  name: string;
  secondLine: string;
  font: string;
  layout: Layout;
  size: number;
  line2Scale: number;
  line2Align: 'left' | 'center' | 'right';
  lineSpacing: number;
  letterSpacing: number;
  boldness: number;

  // --- Plate ---
  style: LetterStyle;
  plateShape: PlateShape;
  /** Plate thickness, mm — "thicker than a keychain" is the point of this tool. */
  plateThickness: number;
  textThickness: number;
  outlineWidth: number;
  smoothing: number;
  chamferOn: boolean;
  chamfer: number;

  // --- Socket ---
  /**
   * Which way the pen leaves the plate, in degrees.
   *
   * 0 = straight down, so the name stands on top of the pen like a totem.
   * -90 = straight out to the left, so a name reading across sits IN LINE with the
   * pen — which is the shape almost every pencil topper on the market actually is.
   * Anything between the two perches the name on the pen's corner.
   */
  socketAngle: number;
  /** Slides the socket along the edge it lands on, -1 … +1. 0 = centred. */
  socketOffset: number;
  pen: string;
  /** Real barrel diameter, mm. Follows the preset unless the preset is `custom`. */
  barrelDia: number;
  fit: FitClass;
  /** How deep the pen goes in, mm. Capped by how much block there is to bore into. */
  socketDepth: number;
  /** Material around the bore, mm. */
  wallThickness: number;
  /** Thin ribs standing into the bore. 0 = a plain clearance hole the pen slides
   *  through and nothing holds it. */
  ribCount: number;
  /** How far each rib stands into the bore, mm — radial, so it counts twice on the
   *  diameter. The Fit control sets it; the slider is the override. */
  ribHeight: number;
  holeShape: HoleShape;
  /** The gap between the barrel and the hole wall, mm, RADIALLY — the same at every
   *  point round the pen, and so twice this on the diameter. The pen has to pass
   *  through it, which is why it is never where grip comes from. */
  boreClearance: number;
  penPath: PenPath;

  // --- Colour ---
  colorScheme: ColorScheme;
  plateColor: string;
  haloColor: string;
  textColor: string;
  haloWidth: number;
  haloThickness: number;

  // --- Print ---
  printMode: PrintMode;
  layerHeight: number;
}

export const DEFAULT_SETTINGS: TopperSettings = {
  name: 'Alex',
  secondLine: '',
  font: 'luckiest-guy',
  layout: 'horizontal',
  size: 13,
  line2Scale: 1.0,
  line2Align: 'center',
  lineSpacing: 1.0,
  letterSpacing: 0,
  boldness: 0,

  style: 'raised',
  plateShape: 'outline',
  plateThickness: 5.0,
  textThickness: 1.4,
  outlineWidth: 2.2,
  smoothing: 1.5,
  chamferOn: true,
  chamfer: 0.4,

  socketAngle: -90,
  socketOffset: 0,
  pen: 'bic-cristal',
  barrelDia: 9.6,
  fit: 'normal',
  socketDepth: 16,
  wallThickness: 1.6,
  ribCount: 3,
  // Both = BORE_CLEARANCE_MM: the rib exactly fills the gap it sits in. Spelled out
  // because DEFAULT_SETTINGS is a plain literal that gets serialised into saved
  // projects and shared links.
  ribHeight: 0.3,
  boreClearance: 0.3,
  holeShape: 'round',
  penPath: 'inset',

  colorScheme: 'plate-text',
  plateColor: '#1d2027',
  haloColor: '#5b9dff',
  textColor: '#f2f4f8',
  haloWidth: 1.2,
  haloThickness: 0.8,

  printMode: 'ams',
  layerHeight: 0.2,
};

/**
 * The least the plate can be for the chosen pen path, in mm.
 *
 * A collar carries its own bore, so the plate can be as thin as you like. An in-body
 * bore cannot: the block has to be tall enough for the hole, one wall under it and
 * one wall plus the roof over it. The UI clamps to this rather than letting someone
 * set 3 mm and get a topper with a slot cut through its face.
 */
export function minPlateThickness(
  s: Pick<TopperSettings, 'penPath' | 'barrelDia' | 'boreClearance' | 'wallThickness' | 'holeShape'>,
): number {
  if (s.penPath === 'collar') return 1.5;
  const r = boreFor(s) / 2;
  // Matches ROOF_CAP in buildTopper: bed -> centre -> truncated roof -> one wall.
  // Matches ROOF_CAP in buildTopper for a round bore; a hex hole tops out at its
  // own vertex, so it needs no cap above the radius.
  return r + s.wallThickness + r * (s.holeShape === 'hex' ? 1 : 1.18) + s.wallThickness;
}

/** The widest the hole gets, in mm: across the relief slots. Everything that has to
 *  clear the hole rather than grip it — the wall, the roof, the block's floor
 *  thickness — is measured from this. The ribs stand inside it.
 *
 *  Twice the clearance, because it is a radius on each side of the barrel.
 *
 *  On a hex hole the clearance is measured perpendicular to a FACE, so growing the
 *  hexagon by 0.3 all round moves its corners out by 0.3/cos(30) — the corners are
 *  further from the centre than the faces are, and the offset is along the face
 *  normal. Ignoring that undersizes every wall and roof that is measured from here. */
export const HEX_CORNER_FACTOR = 1 / Math.cos(Math.PI / 6);

export function boreFor(s: Pick<TopperSettings, 'barrelDia' | 'boreClearance' | 'holeShape'>): number {
  const perSide = s.holeShape === 'hex' ? s.boreClearance * HEX_CORNER_FACTOR : s.boreClearance;
  return s.barrelDia + 2 * perSide;
}

export const penPreset = (id: string): PenPreset | undefined => PEN_PRESETS.find((p) => p.id === id);

/**
 * The three shapes a pen topper actually comes in, as named presets over
 * `socketAngle` / `socketOffset` / `layout`.
 *
 * They exist because the angle is the single control that decides what the object
 * IS, and -90 versus 0 is not a number anyone should have to discover with a slider.
 */
export interface MountPreset {
  id: string;
  label: string;
  angle: number;
  offset: number;
  layout: Layout;
  note: string;
}

export const MOUNT_PRESETS: MountPreset[] = [
  {
    id: 'inline',
    label: 'In line',
    angle: -90,
    offset: 0,
    layout: 'horizontal',
    note: 'The name reads across and the pen runs into its left edge. This is the classic shop-bought pencil topper.',
  },
  {
    id: 'corner',
    label: 'Corner',
    angle: -40,
    offset: 0,
    layout: 'horizontal',
    note: 'The name perches on the pen’s corner at an angle. Reads well from above, on a desk.',
  },
  {
    id: 'totem',
    label: 'Upright',
    angle: 0,
    offset: 0,
    layout: 'vertical',
    note: 'Letters stacked in a column straight above the pen. Tallest, and the most stable to print.',
  },
];

export const mountPreset = (id: string): MountPreset | undefined => MOUNT_PRESETS.find((m) => m.id === id);

/** Which mount preset the current settings match, or undefined for a custom angle. */
export function matchMount(s: Pick<TopperSettings, 'socketAngle' | 'socketOffset' | 'layout'>): string | undefined {
  return MOUNT_PRESETS.find(
    (m) => Math.abs(m.angle - s.socketAngle) < 0.5 && Math.abs(m.offset - s.socketOffset) < 0.01 && m.layout === s.layout,
  )?.id;
}

/** Merge a loaded project over the defaults, dropping anything unrecognised. */
export function coerceSettings(raw: unknown): TopperSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const current = out[k as keyof TopperSettings];
    if (typeof current === typeof v && (typeof v !== 'number' || Number.isFinite(v))) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  // A project saved against a preset that no longer exists keeps its diameter and
  // becomes a custom one. Leaving the dead id in place points the dropdown at nothing
  // and the next thing the user touches silently re-sizes the bore.
  if (!penPreset(out.pen)) out.pen = 'custom';
  if (LEGACY_RIB_HEIGHTS_MM.some((v) => Math.abs(out.ribHeight - v) < 1e-6)) out.ribHeight = out.boreClearance;
  return out;
}
