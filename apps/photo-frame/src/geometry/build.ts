// Every part, as solids, in two poses: standing as the customer uses it, and laid flat as the
// printer makes it. Runs in the worker with manifold-3d; takes no font and no DOM (the words and
// the art arrive as rings), so a node test runs it as it is.
//
// A frame is drawn in FRONT VIEW (x right as the customer sees the face, y up, z = depth from the
// face). That frame of reference is left-handed, so a solid built in it is the print's mirror
// image: mirroring x gives the frame face down on the bed, reading the right way from the front.
import { csOf, extrude, withScope, ringsOf, type Keep } from '@vostok/manifold';
import { applyKeyring } from '@vostok/laser/csg2d';
import { holeCentre } from '@vostok/laser/keyring';
import { prng } from '@vostok/watermark';
import { MAGNETS, printOf, type Orientation, type PhotoId } from '../sizes';
import { FIT, COS, SIN, TAN, frameLayout, holderLayout, type FrameLayout, type FrameSpec, type HolderKind, type HolderLayout } from './layout';
import { ccw, circle, holderPlan, outlineRecipe, roundedBox, roundedBoxR, type Ring } from './outline';

type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export interface BuildSettings {
  kind: 'frame' | 'holder';
  photo: PhotoId;
  orientation: Orientation;
  customWidth: number;
  customHeight: number;
  frame: FrameSpec;
  holder: HolderKind;
  bodyColor: string;
  inkColor: string;
  baseColor: string;
  /** The mat inside a deep box. */
  matColor: string;
}

export interface BuildRequest {
  s: BuildSettings;
  /** Everything printed in the second colour, as rings (outlines counter-clockwise, holes
   *  clockwise, filled by winding): on a frame in front view, on a holder on its front face
   *  (x across, y up the face). */
  ink: Ring[];
  /** A pattern for the frame's face: its pieces, and the face they are cut to (outline
   *  counter-clockwise, holes clockwise). Front view, as `ink`. */
  pattern?: { rings: Ring[]; region: Ring[] } | null;
  /** The covert mark's seed. */
  seed: string;
}

export interface MeshOut {
  name: string;
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  color: RGB;
  group: string;
}

export interface BuildReport {
  /** The main part, width × height × depth as it stands, mm. */
  size: [number, number, number];
  print: [number, number];
  /** The opening on the face, mm. */
  window: [number, number] | null;
  parts: number;
  colours: number;
  /** The magnets to buy, and whether that many hold this frame's weight with room to spare. */
  magnets: { count: number; d: number; h: number; weak: boolean } | null;
  /** Colour changes the second colour costs on one extruder, about. */
  swaps: number;
  grams: number;
}

export interface BuildResult {
  assembled: MeshOut[];
  print: MeshOut[];
  report: BuildReport;
  /** For the preview only, never a file: a plain card where the print goes, and the corners of
   *  its picture as the customer looks at it (bottom-left, bottom-right, top-right, top-left). */
  preview: { card: MeshOut; photo: [Vec3, Vec3, Vec3, Vec3] };
}

const BIG = 2000;
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
/** PLA, g/mm³. */
const PLA = 1.24e-3;
/** The stand-in card's colour. */
const CARD: RGB = [240, 240, 236];
/** How far the preview's picture stands in front of its card, mm. */
const PREVIEW_GAP = 0.2;

interface Part {
  name: string;
  solid: any;
  color: RGB;
  group: string;
}

export function buildModel(w: any, req: BuildRequest): BuildResult {
  return withScope((keep) => (req.s.kind === 'holder' ? buildHolder(w, req, keep) : buildFrame(w, req, keep)));
}

/* ---------------- shared bits ---------------- */

const box = (w: any, keep: Keep, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  keep(keep(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));

const prism = (w: any, keep: Keep, rings: Ring[] | Ring, z0: number, z1: number) => {
  const cs = keep(csOf(w, rings as Ring[], 'Positive'));
  return keep(keep(extrude(w, cs, z1 - z0)).translate([0, 0, z0]));
};

const slab = (w: any, keep: Keep, cs: any, z0: number, z1: number) => keep(keep(extrude(w, cs, z1 - z0)).translate([0, 0, z0]));
const sub = (keep: Keep, a: any, b: any) => keep(a.subtract(b));
const add = (keep: Keep, a: any, b: any) => keep(a.add(b));
const halfPlaneAbove = (w: any, keep: Keep, y: number) => keep(keep(w.CrossSection.square([BIG, BIG])).translate([-BIG / 2, y]));

function meshOf(name: string, solid: any, color: RGB, group: string): MeshOut {
  const m = solid.getMesh();
  return { name, numProp: m.numProp, vertProperties: m.vertProperties, triVerts: m.triVerts, color, group };
}

/** Each print-pose group (a slicer object) centred on the origin. Where they go on the plate is
 *  the screen's job: it knows the plate, and it packs them with the shelf's plate packing. */
function centreEach(keep: Keep, groups: Part[][]): Part[] {
  const out: Part[] = [];
  for (const g of groups) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of g) {
      const b = p.solid.boundingBox();
      x0 = Math.min(x0, b.min[0]); x1 = Math.max(x1, b.max[0]);
      y0 = Math.min(y0, b.min[1]); y1 = Math.max(y1, b.max[1]);
    }
    for (const p of g) out.push({ ...p, solid: keep(p.solid.translate([-(x0 + x1) / 2, -(y0 + y1) / 2, 0])) });
  }
  return out;
}

/** Spheres buried in a solid box of the part, drawn from the seed: the covert provenance mark. */
function voids(w: any, keep: Keep, seed: string, b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }) {
  if (!seed || b.x1 <= b.x0 || b.y1 <= b.y0 || b.z1 <= b.z0) return null;
  const rnd = prng(seed);
  let all: any = null;
  for (let i = 0; i < 7; i++) {
    const d = 0.5 + rnd() * 0.2;
    const sphere = keep(keep(w.Manifold.sphere(d / 2, 10)).translate([b.x0 + rnd() * (b.x1 - b.x0), b.y0 + rnd() * (b.y1 - b.y0), b.z0 + rnd() * (b.z1 - b.z0)]));
    all = all ? add(keep, all, sphere) : sphere;
  }
  return all;
}

/**
 * How far each 0.2 mm layer of the face is drawn in from the outline, the face's own layer first:
 * a 45-degree chamfer of `size`, or a round-over of radius `size`. A round-over meets the face
 * flat, which no printer bridges, so where it does it is held to 60 degrees from upright: a soft
 * shoulder that prints face down with no support.
 */
function faceInsets(kind: 'chamfer' | 'round', size: number): number[] {
  const n = Math.round(size / 0.2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = 0.2 * i + 0.1;
    out.push(kind === 'chamfer' ? size - 0.2 * i : size - Math.sqrt(Math.max(0, size * size - (size - z) ** 2)));
  }
  if (kind === 'round') for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i]!, out[i + 1]! + 0.35);
  return out;
}

/** Half the narrowest piece of the second colour kept as a flush inlay, mm: a piece with nowhere
 *  0.3 mm wide is a sliver (a pattern cut at the edge) the nozzle cannot lay. A letter's stroke, a
 *  dot on an i or a full stop is small but wider than that, and stays. */
const INK_HALF_WIDTH = 0.15;

/** The second colour's shapes, united, less any sliver too thin to print; or null. */
export function inkSection(w: any, keep: Keep, rings: Ring[]) {
  if (!rings.length) return null;
  return printable(w, keep, keep(csOf(w, rings, 'Positive')));
}

/** A cross-section less any piece with nowhere `2 × INK_HALF_WIDTH` wide; or null. */
function printable(w: any, keep: Keep, cs: any) {
  if (cs.isEmpty()) return null;
  const pieces: any[] = cs.decompose();
  const kept: any[] = [];
  for (const p of pieces) {
    const piece = keep(p);
    if (!keep(piece.offset(-INK_HALF_WIDTH, 'Round', 2, 12)).isEmpty()) kept.push(piece);
  }
  if (kept.length === pieces.length) return cs;
  if (!kept.length) return null;
  return keep(w.CrossSection.compose(kept));
}

/* ---------------- the groove block ---------------- */

/** A Bar, a Pill or a Base: the side profile extruded along x, the slot cut leaning 15 degrees,
 *  the plan's outline applied. Front edge at y = 0, standing on z = 0. */
function grooveBar(w: any, keep: Keep, g: HolderLayout['block'], plan: Ring) {
  const s = g.s;
  const bx = g.toe + s * COS;
  const lineAt = (y0: number, z0: number, z: number) => y0 + (z - z0) * TAN;
  let profile: Ring;
  if (g.lip) {
    const backY = bx + FIT.backLip * COS;
    const backZ = g.vfb - FIT.backLip * SIN;
    const frontY = bx - 0.5 * COS;
    const frontZ = g.vfb + 0.5 * SIN;
    profile = [
      [0, 0],
      [g.D, 0],
      [g.D, g.hb],
      [lineAt(backY, backZ, g.hb), g.hb],
      [lineAt(backY, backZ, g.lipTop), g.lipTop],
      [lineAt(frontY, frontZ, g.lipTop), g.lipTop],
      [lineAt(frontY, frontZ, g.hb), g.hb],
      [0, g.hb],
    ];
  } else {
    profile = [[0, 0], [g.D, 0], [g.D, g.hb], [0, g.hb]];
  }
  const long = g.L + 40;
  const body = keep(keep(keep(extrude(w, keep(csOf(w, ccw(profile), 'Positive')), long)).rotate([90, 0, 90])).translate([-long / 2, 0, 0]));
  const shaped = keep(body.intersect(prism(w, keep, plan, -1, g.lipTop + 1)));
  return sub(keep, shaped, slotCutter(w, keep, g, g.toe, g.vff));
}

function slotCutter(w: any, keep: Keep, g: { s: number; slotLength: number }, y: number, z: number) {
  const c = keep(keep(w.Manifold.cube([g.slotLength, g.s, 60])).translate([-g.slotLength / 2, 0, 0]));
  return keep(keep(c.rotate([-FIT.lean, 0, 0])).translate([0, y, z]));
}

/* ---------------- the frame ---------------- */

function buildFrame(w: any, req: BuildRequest, keep: Keep): BuildResult {
  const s = req.s;
  const spec = s.frame;
  const print = printOf(s);
  const L = frameLayout(spec, print);
  const { Pw, Ph, stack, profile } = L;
  const { zPocket, zPlate0, zPlate1, zCeil, T } = stack;
  const squiggle = spec.outline === 'squiggle';

  // The outline: the plain body with its corners, scallops or crest, a band added (ric-rac) or the
  // band alone (squiggle), the inside cusps softened, the bottom cut flat where it stands.
  const recipe = outlineRecipe(L);
  let outline: any = recipe.rings.length ? keep(csOf(w, recipe.rings, 'Positive')) : null;
  let band: any = null;
  if (recipe.band) {
    const centre = keep(csOf(w, ccw(recipe.band.centre), 'Positive'));
    band = keep(keep(centre.offset(recipe.band.half, 'Round', 2, 12)).subtract(keep(centre.offset(-recipe.band.half, 'Round', 2, 12))));
    outline = recipe.band.only || !outline ? band : keep(outline.add(band));
  }
  if (recipe.close > 0) outline = keep(keep(outline.offset(recipe.close, 'Round', 2, 12)).offset(-recipe.close, 'Round', 2, 12));
  if (recipe.clipBottom !== null) outline = keep(outline.intersect(halfPlaneAbove(w, keep, recipe.clipBottom)));

  // The body, its face edge eased in 0.2 mm steps (each step one layer of the print, so the slicer
  // sees exactly this): a squiggle rounded over to look puffy, a scallop softened, a bevelled or
  // deep profile chamfered at 45 degrees.
  const insets = squiggle ? faceInsets('round', 2.6) : spec.outline === 'scallop' ? faceInsets('round', 1.0) : profile.chamfer > 0 ? faceInsets('chamfer', profile.chamfer) : [];
  let front: any;
  if (insets.length) {
    const eased = 0.2 * insets.length;
    front = slab(w, keep, outline, eased, T);
    insets.forEach((d, i) => {
      const layer = keep(outline.offset(-d, 'Round', 2, 12));
      if (!layer.isEmpty()) front = add(keep, front, slab(w, keep, layer, 0.2 * i, Math.min(eased, 0.2 * (i + 1)) + 0.01));
    });
  } else {
    front = slab(w, keep, outline, 0, T);
  }

  // The window, wider on the face, narrowing toward the back at 45 degrees or steeper. A deep box
  // goes straight in first.
  let mat: any = null;
  if (!squiggle) {
    const win = L.window;
    const face = { w: win.w + 2 * profile.bevel, h: win.h + 2 * profile.bevel };
    const faceRadii = win.radii.map((r) => r + profile.bevel) as typeof win.radii;
    const ringAt = (ww: number, hh: number, grow: number) =>
      roundedBoxR({ x0: -ww / 2, x1: ww / 2, y0: -hh / 2, y1: hh / 2 }, faceRadii.map((r) => Math.max(0.5, r + grow)) as typeof win.radii);
    let cut: any;
    const taperFrom = profile.straight;
    const run = profile.front - taperFrom;
    const k = profile.bevel / run;
    if (taperFrom > 0) cut = keep(keep(extrude(w, keep(csOf(w, ringAt(face.w, face.h, 0), 'Positive')), taperFrom + 0.2)).translate([0, 0, -0.2]));
    const z0 = taperFrom > 0 ? taperFrom : -0.2;
    const g0 = taperFrom > 0 ? 0 : k * 0.2;
    const w0 = face.w + 2 * g0;
    const h0 = face.h + 2 * g0;
    const z1 = profile.front + 0.2;
    const w1 = face.w - 2 * k * (z1 - taperFrom);
    const h1 = face.h - 2 * k * (z1 - taperFrom);
    const taper = keep(keep(extrude(w, keep(csOf(w, ringAt(w0, h0, g0), 'Positive')), z1 - z0, 0, 0, [w1 / w0, h1 / h0])).translate([0, 0, z0]));
    cut = cut ? add(keep, cut, taper) : taper;
    const placed = keep(cut.translate([win.cx, win.cy, 0]));
    front = sub(keep, front, placed);
    // A deep box's mat: the sloped ring round the print, below its straight walls, in a colour of
    // its own (ref 28).
    if (taperFrom > 0) {
      const ring = keep(keep(extrude(w, keep(csOf(w, ringAt(face.w, face.h, 0), 'Positive')), profile.front - taperFrom)).translate([win.cx, win.cy, taperFrom]));
      mat = keep(ring.subtract(placed));
      front = sub(keep, front, mat);
    }
  }

  // The pocket the photo lies in, walled on all four sides at its own level: the left wall, the
  // rails and the dam on the open (right) side; then the grooves the back plate slides in.
  front = sub(keep, front, prism(w, keep, roundedBox({ x0: -Pw / 2, x1: Pw / 2, y0: -Ph / 2, y1: Ph / 2 }, FIT.pocketCorner), zPocket, T + 1));
  const damTop = zPlate0 - FIT.damBelowPlate;
  front = sub(keep, front, box(w, keep, Pw / 2 - 0.5, -Ph / 2, damTop, BIG, Ph / 2, T + 1));
  front = sub(keep, front, box(w, keep, Pw / 2 + FIT.damLength, -Ph / 2, zPocket, BIG, Ph / 2, damTop + 0.5));
  front = sub(keep, front, box(w, keep, -Pw / 2, -Ph / 2 - FIT.groove, zPlate0, BIG, Ph / 2 + FIT.groove, zCeil));

  // The second colour, flush in the face: the words and art from the screen, and on a ric-rac
  // frame the wavy band round it (ref 23: a white frame with a coloured trim). The band's sides
  // stay the frame's colour under the inlay, so it costs three layers of colour changes, not all.
  let inkCs = inkSection(w, keep, req.ink);
  if (req.pattern?.rings.length) {
    // The pattern's pieces cut exactly along the face's edge: a long one that crosses it is kept
    // up to it, never dropped, so a row of scales reaches every side.
    const pieces = keep(csOf(w, req.pattern.rings, 'Positive'));
    const face = keep(csOf(w, req.pattern.region, 'Positive'));
    // Cut first, then the slivers the cut leaves along the edge go.
    const onFace = printable(w, keep, keep(pieces.intersect(face)));
    if (onFace) inkCs = inkCs ? keep(inkCs.add(onFace)) : onFace;
  }
  if (spec.outline === 'ricrac' && band) inkCs = inkCs ? keep(inkCs.add(band)) : band;
  let ink: any = null;
  if (inkCs && !inkCs.isEmpty()) {
    // Never past the outline, whatever the screen sent.
    const inside = keep(inkCs.intersect(outline));
    if (!inside.isEmpty()) {
      front = sub(keep, front, slab(w, keep, inside, -0.1, FIT.inlay));
      ink = slab(w, keep, inside, 0, FIT.inlay);
    }
  }

  // The covert mark, buried in the left wall.
  const marks = voids(w, keep, req.seed, {
    x0: -L.pw / 2 - L.rim + 1.4,
    x1: -Pw / 2 - 1.4,
    y0: -Ph / 2 + 3,
    y1: Ph / 2 - 3,
    z0: zPocket + 0.9,
    z1: T - 0.9,
  });
  if (marks) front = sub(keep, front, marks);

  // Standing on a foot or a kickstand: the bottom edge cut along the table, so it sits flat.
  const yBottom = L.outline.y0;
  const H = L.H;
  const leaning = spec.stand === 'base' || spec.stand === 'block' || spec.stand === 'foot' || spec.stand === 'kickstand';
  const R = FIT.heel * H;
  // A side profile run across the frame, centred on its centre line.
  const across = (ring: Ring, width: number) =>
    keep(keep(keep(extrude(w, keep(csOf(w, ccw(ring), 'Positive')), width)).rotate([90, 0, 90])).translate([L.cx - width / 2, yBottom, 0]));
  if (spec.stand === 'foot' || spec.stand === 'kickstand') {
    const wedge = across([[-5, -1], [-TAN, -1], [(T + 1) * TAN, T + 1], [-5, T + 1]], L.outline.x1 - L.outline.x0 + 10);
    front = sub(keep, front, wedge);
    // The inlay too, where it reaches the bottom edge (a ric-rac frame's inner frame does).
    if (ink) ink = sub(keep, ink, wedge);
  }
  if (spec.stand === 'foot') {
    // A fin from the back of the bottom rail, its sole on the table 0.30 of the height behind.
    const t = H <= 130 ? 3 : 4;
    const fin: Ring = [[0, 0], [R * SIN, R * COS], [R * SIN + t * COS, R * COS - t * SIN], [t * COS, -t * SIN]];
    const finCs = keep(keep(csOf(w, ccw(fin), 'Positive')).intersect(halfPlaneAbove(w, keep, 0)));
    const fw = L.body.x1 - L.body.x0 - 8;
    front = add(keep, front, keep(keep(keep(extrude(w, finCs, fw)).rotate([90, 0, 90])).translate([L.cx - fw / 2, yBottom, 0])));
  }
  if (spec.stand === 'keychain') {
    const shapes = ringsOf(outline).map((r: Ring) => [r]);
    const kr = spec.keyring ?? { dia: FIT.keyHole, ring: FIT.keyWall, along: 0.5 };
    const k = { mode: 'outside' as const, side: 'top' as const, along: kr.along, dia: kr.dia, ring: kr.ring };
    const withLug = applyKeyring(w, shapes, holeCentre(shapes, k) as [number, number], k);
    const lugCs = keep(keep(csOf(w, withLug.flat(), 'EvenOdd')).intersect(halfPlaneAbove(w, keep, L.outline.y1 - 2)));
    front = add(keep, front, slab(w, keep, lugCs, 0, FIT.keyLug));
  }

  // The back plate: slides in from the right in the grooves, a nail scoop at its tail.
  const px0 = -Pw / 2 + FIT.plateEnd;
  // The tail stays inside the outline however thin the border: 1 mm short of the edge at most.
  const tail = Math.min(FIT.plateTail, L.body.x1 - Pw / 2 - 0.7);
  const px1 = Pw / 2 + tail;
  const py = Ph / 2 + FIT.groove - FIT.wingClear;
  let plate = prism(w, keep, roundedBox({ x0: px0, x1: px1, y0: -py, y1: py }, 1.0), zPlate0, zPlate1);
  plate = sub(keep, plate, prism(w, keep, circle(px1, 0, Math.min(FIT.scoop, tail - 1), 40), zPlate0 - 1, zPlate1 + 1));

  // A kickstand on the plate, as on a shop-bought frame: a strut from low on the back to high on
  // it, its foot on the table behind. It prints standing up from the plate with no overhang.
  if (spec.stand === 'kickstand') {
    const yLow = Math.max(-py + 3, yBottom + 9);
    const yHigh = Math.min(py - 4, yBottom + 0.55 * H);
    // Its foot is a short flat along the table line, 0.30 of the height behind the bottom edge.
    const foot: [number, number] = [yBottom + R * SIN, R * COS];
    const toe: [number, number] = [foot[0] - 4 * SIN, foot[1] - 4 * COS];
    const strut: Ring = [[yLow, zPlate1 - 0.2], [yHigh, zPlate1 - 0.2], foot, toe];
    const t = H <= 130 ? 3.2 : 4.4;
    const cs = keep(csOf(w, ccw(strut), 'Positive'));
    // One in the middle, or two near the sides of the plate (a frame lying wide stands steadier on
    // two): 8 mm in from the print's edges, never closer together than 24 mm.
    const spread = Math.max(12, Pw / 2 - 8);
    const xs = spec.kickstands === 2 ? [-spread, spread] : [L.cx];
    for (const x of xs) plate = add(keep, plate, keep(keep(keep(extrude(w, cs, t)).rotate([90, 0, 90])).translate([x - t / 2, 0, 0])));
  }

  // Magnets: glue-on pockets in round pucks on the plate's back, near the two held edges, each
  // magnet's face standing proud of the rails so it touches the fridge.
  let magnets: BuildReport['magnets'] = null;
  if (spec.stand === 'magnets') {
    const pick = spec.magnets ? magnetOf(spec.magnets.d, spec.magnets.h) : magnetFor(Pw, Ph);
    const Dp = pick.d + FIT.magnetFit + 2 * FIT.magnetWall;
    // The plate's back is 1.0 under the frame's back on every profile, so this stands the magnet's
    // face 0.8 proud of the rails whatever the frame's thickness.
    const puckTop = zPlate1 + pick.h - 0.6;
    const pocketFloor = puckTop - (pick.h - 0.4);
    const grams = front.volume() * PLA * 0.55 + plate.volume() * PLA + (L.film ? 3.5 : 0.00012 * L.pw * L.ph);
    const count = spec.magnets?.count ?? magnetCount(grams, pick);
    const yc = Ph / 2 - 0.5 - Dp / 2;
    const xc = Math.max(Dp / 2 + 1, (Pw - 4.2) / 2 - Dp / 2);
    const spots: [number, number][] =
      count === 2 ? [[0, yc], [0, -yc]] : count === 3 ? [[xc, yc], [-xc, yc], [0, -yc]] : [[xc, yc], [-xc, yc], [xc, -yc], [-xc, -yc]];
    for (const [x, y] of spots) {
      plate = add(keep, plate, prism(w, keep, circle(x, y, Dp / 2, 64), zPlate1 - 0.01, puckTop));
      plate = sub(keep, plate, prism(w, keep, circle(x, y, (pick.d + FIT.magnetFit) / 2, 64), pocketFloor, puckTop + 1));
    }
    magnets = { count, d: pick.d, h: pick.h, weak: (grams + count * pick.grams) / count > pick.cap };
  }

  // The base: flush with the frame's sides, low with a back lip or a tall block.
  let base: any = null;
  if (L.base) {
    const plan = roundedBox({ x0: -L.base.L / 2, x1: L.base.L / 2, y0: 0, y1: L.base.D }, 1.2, 6);
    base = grooveBar(w, keep, L.base, plan);
    const m = voids(w, keep, req.seed + '/base', { x0: -L.base.L / 2 + 5, x1: L.base.L / 2 - 5, y0: L.base.D - 0.18 * H, y1: L.base.D - 2.5, z0: 1.2, z1: L.base.hb - 1.2 });
    if (m) base = sub(keep, base, m);
    // Flush with the frame's sides: under its centre line.
    if (L.cx !== 0) base = keep(base.translate([L.cx, 0, 0]));
  }

  const body = rgb(s.bodyColor);
  const inkRgb = rgb(s.inkColor);
  const baseRgb = rgb(s.baseColor);

  // Print pose: everything face down, mirrored into the right hand.
  const toPrint = (m: any) => keep(m.mirror([1, 0, 0]));
  const matRgb = rgb(s.matColor);
  const printFront: Part[] = [{ name: 'Frame', solid: toPrint(front), color: body, group: 'frame' }];
  if (ink) printFront.push({ name: 'Inlay', solid: toPrint(ink), color: inkRgb, group: 'frame' });
  if (mat) printFront.push({ name: 'Mat', solid: toPrint(mat), color: matRgb, group: 'frame' });
  const groups: Part[][] = [printFront, [{ name: 'Back plate', solid: toPrint(keep(plate.translate([0, 0, -zPlate0]))), color: body, group: 'plate' }]];
  if (base) groups.push([{ name: 'Base', solid: base, color: baseRgb, group: 'base' }]);
  const printParts = centreEach(keep, groups);

  // Standing: face to the front (-y), up the face is +z; leaning back on a stand.
  const standM = (m: any) => {
    let a = keep(keep(m.mirror([1, 0, 0])).rotate([90, 0, 180]));
    a = keep(a.translate([0, 0, -yBottom]));
    if (leaning) a = keep(a.rotate([-FIT.lean, 0, 0]));
    if (L.base) a = keep(a.translate([0, L.base.toe, L.base.vff]));
    return a;
  };
  const standP = (p: Vec3): Vec3 => {
    // The same moves as `standM`, for a point.
    let X = p[0];
    let Y = p[2];
    let Z = p[1] - yBottom;
    if (leaning) {
      const y2 = Y * COS + Z * SIN;
      Z = -Y * SIN + Z * COS;
      Y = y2;
    }
    if (L.base) {
      Y += L.base.toe;
      Z += L.base.vff;
    }
    return [X, Y, Z];
  };
  const assembled: Part[] = [{ name: 'Frame', solid: standM(front), color: body, group: 'frame' }];
  if (ink) assembled.push({ name: 'Inlay', solid: standM(ink), color: inkRgb, group: 'frame' });
  if (mat) assembled.push({ name: 'Mat', solid: standM(mat), color: matRgb, group: 'frame' });
  assembled.push({ name: 'Back plate', solid: standM(plate), color: body, group: 'plate' });
  if (base) assembled.push({ name: 'Base', solid: base, color: baseRgb, group: 'base' });

  // The preview's card and its picture, just behind the window: the picture far enough in front of
  // the card (PREVIEW_GAP) that the two never fight for the same pixels at any zoom.
  const card = standM(box(w, keep, -L.pw / 2, -L.ph / 2, zPocket + 0.05 + PREVIEW_GAP, L.pw / 2, L.ph / 2, zPocket + 0.3 + PREVIEW_GAP));
  const pic = pictureArea(print.film, L.pw, L.ph);
  const zp = zPocket + 0.05;
  const photo: [Vec3, Vec3, Vec3, Vec3] = [
    standP([pic.x0, pic.y0, zp]),
    standP([pic.x1, pic.y0, zp]),
    standP([pic.x1, pic.y1, zp]),
    standP([pic.x0, pic.y1, zp]),
  ];

  const colours = new Set(printParts.map((p) => p.color.join(','))).size;
  const grams = printParts.reduce((g, p) => g + p.solid.volume() * PLA * (p.group === 'plate' ? 1 : 0.55), 0);
  return {
    assembled: assembled.map((p) => meshOf(p.name, p.solid, p.color, p.group)),
    print: printParts.map((p) => meshOf(p.name, p.solid, p.color, p.group)),
    report: {
      size: [L.outline.x1 - L.outline.x0, L.H, T],
      print: [L.pw, L.ph],
      window: [L.window.w + 2 * profile.bevel, L.window.h + 2 * profile.bevel],
      parts: 2 + (base ? 1 : 0),
      colours,
      magnets,
      swaps: ink ? Math.round(FIT.inlay / 0.2) : 0,
      grams,
    },
    preview: { card: meshOf('Card', card, CARD, 'preview'), photo },
  };
}

/** Where the picture is on a print: an instant print's picture inside its white border, or the
 *  whole of a paper print. Front view, print centred on the origin. */
function pictureArea(film: ReturnType<typeof printOf>['film'], pw: number, ph: number) {
  if (!film) return { x0: -pw / 2, x1: pw / 2, y0: -ph / 2, y1: ph / 2 };
  return { x0: -pw / 2 + film.left, x1: pw / 2 - film.right, y0: -ph / 2 + film.bottom, y1: ph / 2 - film.top };
}

/** The magnet the engine plans for: 10 × 2 discs, or 6 × 2 where two of those do not fit. */
export function magnetFor(Pw: number, Ph: number): { d: number; h: number; cap: number; grams: number } {
  const big = { d: 10, h: 2, cap: 12.9, grams: 1.18 };
  const small = { d: 6, h: 2, cap: 6.5, grams: 0.42 };
  const Dp = big.d + FIT.magnetFit + 2 * FIT.magnetWall;
  return Ph >= 2 * Dp + 3 && Pw >= Dp + 4.2 ? big : small;
}

/** The fewest magnets, two to four, that hold the frame with their own weight added. */
/** A magnet of the shelf's sizes by its dimensions, as the count rule reads it. */
function magnetOf(d: number, h: number): { d: number; h: number; cap: number; grams: number } {
  const m = MAGNETS.find((x) => x.d === d && x.h === h);
  return m ? { d, h, cap: m.holds, grams: m.grams } : { d, h, cap: 1.3 * d, grams: 0.0075 * Math.PI * (d / 2) ** 2 * h };
}

export function magnetCount(grams: number, m: { cap: number; grams: number }): number {
  for (let n = 2; n <= 4; n++) if ((grams + n * m.grams) / m.cap <= n) return n;
  return 4;
}

/* ---------------- the holder ---------------- */

function buildHolder(w: any, req: BuildRequest, keep: Keep): BuildResult {
  const s = req.s;
  const print = printOf(s);
  const H: HolderLayout = holderLayout(s.holder, print, req.ink.length > 0);
  const g = H.block;
  let block: any;
  let slotY = g.toe;
  let slotZ = g.vff;
  if (H.shape === 'heart') {
    const heart = H.heart!;
    const plan = keep(csOf(w, holderPlan('heart', g.L, g.D, heart), 'Positive'));
    const soft = 2.4;
    let slab0 = slab(w, keep, plan, 0, g.hb - soft);
    for (let z = g.hb - soft; z < g.hb - 1e-6; z += 0.2) {
      const t = (z + 0.2 - (g.hb - soft)) / soft;
      const inset = soft * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
      const layer = keep(plan.offset(-inset, 'Round', 2, 16));
      if (!layer.isEmpty()) slab0 = add(keep, slab0, slab(w, keep, layer, z - 0.01, Math.min(g.hb, z + 0.2)));
    }
    const vfb = Math.max(1.2, g.hb - g.dk * COS);
    slotY = heart.slotY;
    slotZ = vfb + g.s * SIN;
    block = sub(keep, slab0, slotCutter(w, keep, g, slotY, slotZ));
  } else {
    block = grooveBar(w, keep, g, holderPlan(H.shape, g.L, g.D, null));
    const m = voids(w, keep, req.seed + '/holder', { x0: -g.L / 2 + 8, x1: g.L / 2 - 8, y0: g.D - 0.2 * print.ph, y1: g.D - 3, z0: 1.2, z1: g.hb - 1.2 });
    if (m) block = sub(keep, block, m);
  }

  // The words on the front face, flush in a second colour: drawn on the face's own plane (x across,
  // y up), sunk 0.9 mm into it.
  let ink: any = null;
  if (H.textBox && req.ink.length) {
    const cs = inkSection(w, keep, req.ink);
    if (cs) {
      const onFace = (depth: number, extra: number) => keep(keep(keep(extrude(w, cs, depth + extra)).translate([0, 0, -depth])).rotate([90, 0, 0]));
      block = sub(keep, block, onFace(FIT.inlayFront, 0.1));
      ink = onFace(FIT.inlayFront, 0);
    }
  }
  const body = rgb(s.bodyColor);
  const parts: Part[] = [{ name: 'Holder', solid: block, color: body, group: 'holder' }];
  if (ink) parts.push({ name: 'Text', solid: ink, color: rgb(s.inkColor), group: 'holder' });
  const printParts = centreEach(keep, [parts]);

  // The preview's card standing in the slot, and its picture on the front.
  const cardSolid = keep(keep(keep(keep(w.Manifold.cube([print.pw, 0.25, print.ph])).translate([-print.pw / 2, 0.05 + PREVIEW_GAP, 0.05])).rotate([-FIT.lean, 0, 0])).translate([0, slotY, slotZ]));
  const pic = pictureArea(print.film, print.pw, print.ph);
  const onCard = (x: number, up: number): Vec3 => {
    const Y = 0.05;
    const Z = 0.05 + up;
    return [x, Y * COS + Z * SIN + slotY, -Y * SIN + Z * COS + slotZ];
  };
  const up0 = pic.y0 + print.ph / 2;
  const up1 = pic.y1 + print.ph / 2;
  const photo: [Vec3, Vec3, Vec3, Vec3] = [onCard(pic.x0, up0), onCard(pic.x1, up0), onCard(pic.x1, up1), onCard(pic.x0, up1)];

  const bb = block.boundingBox();
  return {
    assembled: parts.map((p) => meshOf(p.name, p.solid, p.color, p.group)),
    print: printParts.map((p) => meshOf(p.name, p.solid, p.color, p.group)),
    report: {
      size: [bb.max[0] - bb.min[0], bb.max[2] - bb.min[2], bb.max[1] - bb.min[1]],
      print: [print.pw, print.ph],
      window: null,
      parts: 1,
      colours: ink ? 2 : 1,
      magnets: null,
      swaps: ink && H.textBox ? Math.round((H.textBox.y1 - H.textBox.y0) / 0.2) : 0,
      grams: block.volume() * PLA * 0.35,
    },
    preview: { card: meshOf('Card', cardSolid, CARD, 'preview'), photo },
  };
}

export type { FrameLayout };
