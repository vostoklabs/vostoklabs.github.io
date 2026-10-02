// The table tent: two panels leaning against each other, two braces holding them apart, and
// nothing else. The facility a table sign, a Wi-Fi card or a QR tent is cut from — the caller
// brings the panel size and what goes on each face, and everything that decides whether the
// thing STANDS lives here.
//
// Construction: two identical panels (rounded corners, a grip slot at the top, two small slots
// on EACH side edge at two heights, two feet) and two stepped brace bars. The old `aFrame` in
// ./stands.ts put both its slats on ONE edge of the panel, so the other end of the tent was
// braced by nothing and the pair scissored shut.
//
// ------------------------------------------------------------------------ the geometry --
//
// Work in the tent's CROSS SECTION: x runs front-to-back, y is up, the table is y = 0, and the
// tent's centre line is x = 0. A panel is a straight line in this picture, `t` thick.
//
//   `angle` (θ) is the panel's angle from the TABLE; φ = 90 − θ is its lean from vertical.
//   `u` is the distance DOWN a panel from the apex, measured along the panel's INNER face;
//   `w` is the distance OUT from that face, so w = 0 is the inner face and w = t the outer one.
//
//       left(u, w) = ( −(u·sinφ + w·cosφ),  (panelH − u)·cosφ + w·sinφ )      right = mirror in x
//
//   left(0, 0) is the apex — the two panels' inner faces MEET there, which is the tent's only
//   other contact; left(panelH, 0) is the panel's bottom inner corner, on the table at y = 0.
//
// THE ONE FORMULA THE JOINT TURNS ON. At a slot `u` down the panel the two panels' OUTER faces
// stand
//
//                        d(u) = 2·( u·sin φ + t·cos φ )
//
// apart, and their inner faces 2·u·sin φ apart. A brace's pair of notches at that level is
// exactly `d(u)` across, outer edge to outer edge, and the notch is `t` deep measured
// perpendicular to the panel — so the notch's root bears on the panel's INNER face and its tip
// sits flush with the OUTER one. Cut the pair any other width and the brace either cannot reach
// both panels or sits loose and the tent racks ("its two notches spaced exactly as far apart as
// the panels are at that height — not at the base, not at the top").
//
// Two levels × two sides = four notches on each brace and four slots on each panel, and two
// braces (one near each end of the tent) make the pair rigid instead of a pair of scissors.
//
// WHY IT STANDS. The panels lean on each other at the apex, so each one carries W/2 of the pair's
// weight and pushes its partner outward: the classic two-ladder problem gives a horizontal thrust
// of W·cot θ / 2 against a normal force of W, so the table has to supply
//
//                        μ ≥ cot θ / 2      ( 0.162 at the default 72° )
//
// which any wood, laminate or cloth table beats (μ ≈ 0.3–0.5). μ stays under 0.3 while θ > 59°,
// so 60° is the floor. Steeper is better for sliding and worse for tipping — the footprint is
// 2·(panelH·cos θ + t·sin θ) — so the form is held to 60–82°, and the facility warns outside
// that whatever a loaded file says. The braces do not carry that thrust: their job is to fix the
// spacing (so the tent cannot fold shut or rack along its length) and the through-slots stop the
// panels sliding relative to each other in their own planes.
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = tentGeometry({ panelW, panelH, t, kerf, angle });   // rings, poses, numbers
//   ...build your layers inside `g.content`, avoiding `g.panelCuts`...
//   const { blank, layers, pose, parts, status } = tentPieces(g, { front, back });
//
// Two calls because the content box has to exist before a caller can fit type or a QR into it,
// and the pieces cannot be built before the content exists. Nothing here touches manifold: every
// ring is closed-form, so a node test can hold the whole construction to the formula above.
import { bboxOf, roundedRectRing, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { FIT, slotHoleRing, slotWidth, tabWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const shift = (ring: CutRing, dx: number, dy: number): CutRing => ring.map(([x, y]) => [x + dx, y + dy]);

/** The two slot levels, as a fraction of the panel's height down from its top edge. Far apart on
 *  purpose: two braces a third of the panel apart brace the angle, not just the spacing. */
const SLOT_U: [number, number] = [0.36, 0.78];
/** How far the brace's bottom edge stays clear of the table, mm — the panels' feet carry the
 *  tent, and a brace a hair too tall would lift them off it. */
const FOOT_CLEAR = 1.5;
/** Air above the upper notch before the brace's top edge, and every other web in the piece. */
const webMinFor = (t: number) => Math.max(4, 1.5 * t);
/** The grip: a true stadium, the one place a 50 % radius is right. */
const HANDLE: { w: number; h: number } = { w: 40, h: 10 };

const ODD_WIDTH = 'The slot comes out an odd width — check the thickness and the kerf.';

export interface TentInput {
  /** The panel's width — the tent's length along the table. */
  panelW: number;
  /** The panel's height, measured along its own lean. */
  panelH: number;
  t: number;
  kerf: number;
  /** Degrees from the TABLE. 90 would be two panels standing flat against each other. */
  angle?: number;
  clearance?: number;
  corner?: number;
  /** The grip slot at the top. `false` leaves it out; an object sizes it. */
  handle?: boolean | { w: number; h: number };
}

/** Every number the construction is proved on — the test reads these and re-derives them. */
export interface TentMetrics {
  /** Degrees from the table, and the lean from vertical that is its complement. */
  angle: number;
  phi: number;
  /** How high the two panels' top inner corners meet, mm. */
  apexH: number;
  /** Front-to-back, outer corner to outer corner, on the table. */
  footprint: number;
  /** The two slot levels, measured down the panel from its top edge. */
  slotU: [number, number];
  /** The same two, as the panel's own local y. */
  slotY: [number, number];
  /** d(u) at each level: the notch pair's span, outer edge to outer edge. */
  spacing: [number, number];
  /** How high above the table each level sits, on the panels' inner faces. */
  slotHeight: [number, number];
  /** The panel's slot, as drawn: `t − kerf + clearance` across the bar's thickness. */
  slot: { w: number; h: number };
  /** The brace's notch: its height along the panel as drawn, and its depth perpendicular. */
  notch: { h: number; depth: number };
  /** The coefficient of friction the table has to supply: cot θ / 2. */
  friction: number;
  /** The flat part of one foot, mm. */
  footWidth: number;
  /** Where the braces stand, as the panel's own local x. */
  braceX: number;
}

export interface TentGeometry {
  panelW: number;
  panelH: number;
  t: number;
  /** The panel's outline. Symmetric in x, so BOTH panels are cut from this one ring — the
   *  mirror the old A-frame needed was only ever hiding notches on a single edge. */
  panel: CutRing;
  /** The grip, the feet notch and the four slots — give them to an `op: 'cut'` layer. */
  panelCuts: Shapes;
  /** The clear rectangle a caller may fill: inside the margins, under the grip, above the feet
   *  notch and clear of the slots. */
  content: Box;
  /** The two braces, each centred on its own box, with where it is cut and where it stands. */
  braces: { ring: CutRing; at: { x: number; y: number }; assembledAt: { x: number; y: number }; pose: Pose }[];
  panelPoseA: Pose;
  panelPoseB: Pose;
  metrics: TentMetrics;
  warnings: string[];
}

/**
 * The tent, in rings and poses. Pure: no CSG, no fonts, no values object.
 */
export function tentGeometry(i: TentInput): TentGeometry {
  const { panelW, panelH, t, kerf } = i;
  const angle = clamp(i.angle ?? 72, 30, 88);
  const clearance = i.clearance ?? FIT.snug!;
  const corner = clamp(i.corner ?? 8, 0, Math.min(panelW, panelH) / 2);
  const grip = i.handle === false ? null : typeof i.handle === 'object' ? i.handle : HANDLE;
  const warnings: string[] = [];

  const phi = 90 - angle;
  const sp = Math.sin(rad(phi));
  const cp = Math.cos(rad(phi));
  const webMin = webMinFor(t);

  // --------------------------------------------------------------------- the joint --
  // The brace's thickness passes through the panel: a void, so it is drawn a kerf narrow. The
  // notch's height and the slot's height are BOTH cut faces, so they split the compensation —
  // `tabWidth` on the notch, `slotWidth` on the slot, and the pair lands `clearance` apart.
  const notchNominal = clamp(0.1 * panelH, 7, 14);
  const notchH = tabWidth(notchNominal, kerf);
  const slot = { w: slotWidth(t, kerf, clearance), h: slotWidth(notchNominal, kerf, clearance) };

  const slotU: [number, number] = [SLOT_U[0] * panelH, SLOT_U[1] * panelH];
  /** THE formula: the panels' outer faces, `u` down the panel, are this far apart. */
  const spanAt = (u: number) => 2 * (u * sp + t * cp);
  const spacing: [number, number] = [spanAt(slotU[0]), spanAt(slotU[1])];
  const slotHeight: [number, number] = [(panelH - slotU[0]) * cp, (panelH - slotU[1]) * cp];

  // ---------------------------------------------------------------------- the panel --
  const panel = roundedRectRing(panelW, panelH, corner);
  const cuts: Shapes = [];

  const gripCy = panelH / 2 - (grip ? grip.h / 2 + Math.max(6, webMin) : 0);
  if (grip) cuts.push([shift(roundedRectRing(grip.w, grip.h, grip.h / 2), 0, gripCy)]);

  // Two feet, not one rocking edge: a notch out of the middle of the bottom leaves a flat foot
  // at each end. The flat is what touches, so the corner radius is added on top of the minimum.
  const footFlat = Math.max(12, 0.13 * panelW);
  const footW = corner + footFlat;
  const footH = clamp(0.1 * panelH, 8, 14);
  const notchW = Math.max(0, panelW - 2 * footW);
  if (notchW > 0) {
    // Tall enough to run off the bottom edge, so only its two inner corners are in the panel.
    const r = Math.min(3, notchW / 2, footH / 2);
    cuts.push([shift(roundedRectRing(notchW, footH + 4, r), 0, -panelH / 2 + footH / 2 - 2)]);
  }

  // The four slots: two on each side edge, at the two levels, a web in from the edge.
  const braceX = panelW / 2 - webMin - slot.w / 2;
  for (const side of [-1, 1]) {
    for (const u of slotU) cuts.push([slotHoleRing(side * braceX, panelH / 2 - u, slot.w, slot.h, 'y')]);
  }

  // ------------------------------------------------------------------- the content box --
  const marginX = Math.max(4, 0.06 * panelW);
  const halfW = Math.min(panelW / 2 - marginX, braceX - slot.w / 2 - 2.5);
  const content: Box = {
    minX: -halfW,
    maxX: halfW,
    minY: -panelH / 2 + (notchW > 0 ? footH : 0) + 3,
    maxY: grip ? gripCy - grip.h / 2 - 3 : panelH / 2 - marginX,
  };

  // ---------------------------------------------------------------------- the braces --
  // The brace IS the tent's inner cross-section: its edges run down the panels' inner faces, so
  // it cannot be pushed further closed, and at each level it steps out by `t` (perpendicular)
  // through the panel's slot, flush with the far face.
  const left = (u: number, w: number): [number, number] => [-(u * sp + w * cp), (panelH - u) * cp + w * sp];
  const uTopWanted = slotU[0] - notchH / 2 - Math.max(6, webMin);
  const uTop = Math.max(2, uTopWanted);
  const uBot = panelH - FOOT_CLEAR / cp;

  const edge: [number, number][] = [];
  edge.push(left(uTop, 0));
  for (const u of slotU) {
    edge.push(left(u - notchH / 2, 0), left(u - notchH / 2, t), left(u + notchH / 2, t), left(u + notchH / 2, 0));
  }
  edge.push(left(uBot, 0));
  // Down the left edge, across the bottom, back up the mirrored right edge, and the top closes it.
  const braceRing: CutRing = [...edge, ...[...edge].reverse().map(([x, y]) => [-x, y] as [number, number])];
  const braceBox = bboxOf([[braceRing]]);
  const braceC = { x: (braceBox.minX + braceBox.maxX) / 2, y: (braceBox.minY + braceBox.maxY) / 2 };
  const brace = shift(braceRing, -braceC.x, -braceC.y);
  const braceW = braceBox.maxX - braceBox.minX;
  const braceH = braceBox.maxY - braceBox.minY;

  // --------------------------------------------------------------------- standing up --
  // A panel's box centre is the middle of its own thickness, half way down its lean: `u = panelH/2`
  // on the mid-plane, `w = t/2`. Panel A leans back off the reader (`rx: 90 − φ`, the house
  // convention); panel B is the same lean turned about (`rz: 180`), which faces its engraved side
  // outward and puts its slots at the same place along the tent as A's.
  const panelY = (panelH / 2) * sp + (t / 2) * cp;
  const panelZ = (panelH / 2) * cp + (t / 2) * sp;
  const panelPoseA: Pose = { x: 0, y: -panelY, z: panelZ, rx: angle };
  const panelPoseB: Pose = { x: 0, y: panelY, z: panelZ, rx: angle, rz: 180 };

  // A brace stands on edge (`rx: 90`) turned to run front-to-back (`rz: 90`), so its own x is the
  // tent's front-to-back axis and its own y is up — exactly the frame it was drawn in.
  // The flat card draws the same piece where it lies behind panel A: panel-local y from the world
  // height the pose gives it, which is the inverse of `panelZ` above.
  const localY = (z: number) => (z - (t / 2) * sp) / cp - panelH / 2;
  const braces = ([-1, 1] as const).map((side) => ({
    ring: brace,
    at: { x: (panelW + 10) / 2 + side * (braceW / 2 + 5), y: -(panelH / 2 + 8 + braceH / 2) },
    assembledAt: { x: 0, y: localY(braceC.y) },
    pose: { x: side * braceX, y: braceC.x, z: braceC.y, rx: 90, rz: 90 } as Pose,
  }));

  // ------------------------------------------------------------------- what to say --
  if (angle < 60) warnings.push('Under 60° the panels push hard outward and the feet can slide — 65 to 78° stands best.');
  if (angle > 82) warnings.push('Over 82° the tent stands on a very narrow base and tips easily.');
  if (grip && gripCy - grip.h / 2 < content.minY) warnings.push('The panel is too short for a grip — make it taller, or leave the handle off.');
  // The clamp firing is the panel saying it has no room above its upper slot for a brace.
  if (uTopWanted < 2) warnings.push('The panel is too short for two braces — make it taller.');
  if (notchW <= 0) warnings.push('The panel is too narrow for two feet — make it wider.');
  // The brace's narrowest section is its top edge, where the tent has closed to `2·uTop·sin φ`.
  // A steep tent in thick stock can leave less there than the sheet is thick, and the web above
  // the upper notch is already as generous as the notch allows — so this one is a sentence.
  if (2 * uTop * sp < Math.max(3, t)) warnings.push('The tent closes to almost nothing at the top brace — a lower angle or thinner stock is stronger.');
  if (halfW < 8) warnings.push('The panel is too narrow for anything to go on it — make it wider.');
  if (slot.w <= 0.5 || slot.w >= 1.8 * t) warnings.push(ODD_WIDTH);

  return {
    panelW, panelH, t,
    panel,
    panelCuts: cuts,
    content,
    braces: braces.map(({ ring, at, assembledAt, pose }) => ({ ring, at, assembledAt, pose })),
    panelPoseA,
    panelPoseB,
    metrics: {
      angle,
      phi,
      apexH: panelH * cp,
      footprint: 2 * (panelH * sp + t * cp),
      slotU,
      slotY: [panelH / 2 - slotU[0], panelH / 2 - slotU[1]],
      spacing,
      slotHeight,
      slot,
      notch: { h: notchH, depth: t },
      friction: Math.cos(rad(angle)) / (2 * Math.sin(rad(angle))),
      footWidth: footFlat,
      braceX,
    },
    warnings,
  };
}

export interface TentContent {
  /** What panel A carries, in the panel's own frame. */
  front: DesignLayer[];
  /** What panel B carries. Absent, the back is the front again. */
  back?: DesignLayer[];
  /** In a run the sheet nests every copy, so the explicit placements come off. */
  batched?: boolean;
}

export interface TentPieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
}

/**
 * The four pieces, ready to spread into a `BuildInput`: panel A is the primary, panel B and the
 * two braces are parts. The caller adds its own keyring (a tent hangs from nothing), warnings and
 * file name.
 */
export function tentPieces(g: TentGeometry, content: TentContent): TentPieces {
  const cutLayer = (): DesignLayer => ({ id: 'panel-cuts', label: 'Grip, feet & slots', op: 'cut', shapes: g.panelCuts });
  const place = (at: { x: number; y: number }) => (content.batched ? {} : { at });

  const parts: PartInput[] = [{
    id: 'panel-b',
    label: 'Panel B',
    blank: { kind: 'shape', shapes: [[g.panel]] },
    layers: [...(content.back ?? content.front), cutLayer()],
    keyring: 'none',
    material: 'light',
    ...place({ x: g.panelW + 10, y: 0 }),
    // Directly behind panel A on the flat card: a table tent seen from the front IS its front
    // panel, and the old (14, 10) offset drew a second sign standing beside the first.
    assembledAt: { x: 0, y: 0 },
    previewStyle: 'dashed',
    z: 0,
    pose: g.panelPoseB,
  }];

  for (const [n, b] of g.braces.entries()) {
    const name = n === 0 ? 'A' : 'B';
    parts.push({
      id: `brace-${name.toLowerCase()}`,
      label: `Brace ${name}`,
      blank: { kind: 'shape', shapes: [[b.ring]] },
      layers: [],
      keyring: 'none',
      material: 'light',
      ...place(b.at),
      assembledAt: b.assembledAt,
      previewStyle: 'dashed',
      z: 0,
      pose: b.pose,
    });
  }

  return {
    label: 'Panel A',
    blank: { kind: 'shape', shapes: [[g.panel]] },
    layers: [...content.front, cutLayer()],
    material: 'light',
    pose: g.panelPoseA,
    parts,
    status: `${parts.length + 1} pieces`,
  };
}
