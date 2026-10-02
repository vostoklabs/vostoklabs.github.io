import type { BuildParams, PartMesh } from '../types';
import type { LineBox } from '@vostok/fonts/textLayout';
import { boreFor, gripFor, HEX_CORNER_FACTOR } from '../state';
import { snapLayers } from './noAms';
import { identityVoids } from './identityMark';

/*
  The topper, and why it is shaped the way it is.

  ORIENTATION. Everything is authored the way it PRINTS: the decorated plate lies
  flat on the bed in XY with its face up (+Z), the pen axis runs along Y, and the
  pen slides in from -Y. That is not an arbitrary choice — it is the only one of
  the three candidates that needs no support:

    - plate flat, pen axis along Y   <- this. Raised text prints straight up off
      the plate, the bore is horizontal (fixed by the teardrop below), and the
      decorated face gets the best surface on the machine.
    - plate flat, pen axis along Z   would put the pen sticking out of the FACE of
      the plate. Prints beautifully, wrong object.
    - plate upright, pen axis along Z   gives a perfect round bore, and turns every
      raised letter into a 90-degree overhang. It costs the whole product.

  THE TEARDROP. A horizontal bore sags into an oval and its roof is an unsupported
  ledge. The fix is as old as FDM: cap the circle with a 45-degree peak, so the
  roof closes itself layer by layer. The extra material sits above the pen where
  nothing needs it, so the fit is unaffected.

  THE HOLE CLEARS, THE RIBS GRIP. The bore is cut OVER the barrel — 7.3 mm for a
  7.0 mm pen — so the pen goes in at all. Three thin ribs stand into it and are the
  only thing that touches, closing it to 0.3 mm under the barrel.

  It was the other way round for one version — the hole itself cut under the barrel,
  with relief slots to let the wall open. The argument was hex pencils: three ribs at
  120 degrees against six corners at 60 land on flats together, so they grip less at
  half the rotations. That is true. It is also beaten by the thing that got printed:
  a hole under the barrel presses on the whole circumference, every tolerance stacks
  the same way, and the pen would not enter at all. A rib that misses is a loose
  topper; a hole that does not admit the pen is not a topper. Raise the rib count to
  four for a hexagonal barrel — four never lines up with six.
*/

/** Registers every WASM object so a throw cannot leak the heap. */
function withScope<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const created: { delete(): void }[] = [];
  const keep = <M extends { delete(): void }>(m: M) => {
    created.push(m);
    return m;
  };
  try {
    return fn(keep);
  } finally {
    for (const m of created) {
      try {
        m.delete();
      } catch (e) {
        console.warn('Error deleting manifold object:', e);
      }
    }
  }
}

type Keep = <M extends { delete(): void }>(m: M) => M;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 255, Number.isFinite(g) ? g : 255, Number.isFinite(b) ? b : 255];
}

function meshOf(solid: any): { positions: Float32Array; indices: Uint32Array } {
  const m = solid.getMesh();
  return { positions: m.vertProperties, indices: m.triVerts };
}

/**
 * Extrude with a bevelled edge on the top face, and optionally on the bottom too.
 *
 * The bottom one is not symmetry for its own sake. The plate's underside IS the
 * first layer, and a first layer squashes 0.1-0.3 mm wider than the model for about
 * half a millimetre up — the elephant's foot. On a topper that lip is the edge you
 * run a thumb along, and on the socket end it is the edge the pen has to clear. A
 * chamfer there is the standard answer and costs nothing.
 *
 * Each connected component is shrunk about ITS OWN centre, so letters bevel in
 * place instead of sliding toward the middle of the word.
 */
function bevelExtrude(cs: any, height: number, chamfer: number, keep: Keep, bottom = false): any {
  // Both bevels have to fit with a body left between them.
  const cham = Math.min(chamfer, bottom ? (height - 0.2) / 2 : height * 0.6);
  if (cham <= 0.05) return keep(cs.extrude(height));

  const z0 = bottom ? cham : 0;
  const z1 = height - cham;
  let solid = keep(cs.extrude(z1 - z0).translate([0, 0, z0]));

  const components = (cs.decompose() as any[]) ?? [cs];
  for (const comp of components) {
    const compCS = keep(comp);
    const b = compCS.bounds() as { min: [number, number]; max: [number, number] };
    const W = b.max[0] - b.min[0];
    const H = b.max[1] - b.min[1];
    if (W <= 0.01 || H <= 0.01) continue;

    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const scaleX = Math.max(0.01, (W - 2 * cham) / W);
    const scaleY = Math.max(0.01, (H - 2 * cham) / H);

    const centered = keep(compCS.translate([-cx, -cy]));
    // One wedge: full section at its base, inset at its tip. Used as-is on top and
    // mirrored underneath, so the two bevels cannot drift apart.
    const wedge = keep(centered.extrude(cham + 0.01, 0, 0, [scaleX, scaleY]));
    solid = keep(solid.add(keep(wedge.translate([cx, cy, z1 - 0.005]))));
    if (bottom) {
      solid = keep(solid.add(keep(wedge.mirror([0, 0, 1]).translate([cx, cy, cham + 0.005]))));
    }
  }
  return solid;
}

function bboxOfContours(contours: number[][][]): LineBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of contours) {
    for (const pt of poly) {
      if (pt[0]! < minX) minX = pt[0]!;
      if (pt[0]! > maxX) maxX = pt[0]!;
      if (pt[1]! < minY) minY = pt[1]!;
      if (pt[1]! > maxY) maxY = pt[1]!;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

function signedArea(poly: number[][]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p[0]! * q[1]! - q[0]! * p[1]!;
  }
  return a / 2;
}

/**
 * Drop every interior hole, keeping only the outer loops. Manifold winds outer
 * boundaries CCW and holes CW, so refilling with the Positive rule yields solid
 * blobs. Without it the plate outline traps air pockets — the gap between a short
 * second line and the socket stem shows up as a phantom hole through the plate.
 */
function fillHoles(CrossSection: any, cs: any, keep: Keep): any {
  const polys = cs.toPolygons() as number[][][];
  const outers = polys.filter((p) => signedArea(p) > 0);
  if (outers.length === polys.length) return cs;
  if (outers.length === 0) return cs;
  return keep(new CrossSection(outers, 'Positive'));
}

/** Where the truncated peak is cut off, as a multiple of the bore radius. The full
 *  point would be at sqrt(2); stopping at 1.18 leaves a bridge of 0.47r — about
 *  2.4 mm on a ballpoint — which any printer spans without thinking, and costs
 *  1.2 mm off the collar's height plus the knife edge that would otherwise sit on
 *  top of it. */
const ROOF_CAP = 1.18;

/**
 * The bore's cross-section: a circle capped with a 45-degree roof, truncated.
 *
 * The tangent points sit at +/-45 degrees, so the roof lines leave the circle
 * exactly where its own overhang reaches 45 and would meet at r*sqrt(2) above
 * centre. Below the centre line it stays a plain circle — that half is held up by
 * the material under it and wants to be round for the fit.
 */
function teardrop(CrossSection: any, r: number, keep: Keep): any {
  const disc = keep(CrossSection.circle(r, 48));
  const k = r / Math.SQRT2;
  const h = ROOF_CAP * r;
  const flat = r * Math.SQRT2 - h; // half-width of the bridge at the top
  const roof = keep(new CrossSection([[[-k, k], [k, k], [flat, h], [-flat, h]]], 'NonZero'));
  return keep(disc.add(roof));
}

/** How wide each rib is, in mm of chord.
 *
 *  Thin on purpose, and that is the whole mechanism: a rib this size scrapes and
 *  squashes on the first insertion and takes up the slack itself, where a wide one
 *  would be a solid lug that either fits or does not. Held in mm rather than degrees
 *  so it stays the same rib on a 5 mm cord and a 13 mm marker. */
const RIB_WIDTH_MM = 1.3;

/**
 * The hole, as ONE closed profile: the clearance bore, roofed, with N ribs standing
 * into it to `gripR`.
 *
 * One profile, not a bore plus rib solids added back afterwards. The ribs were
 * separate solids once, trimmed against the collar's own section, and they went
 * silently missing whenever that trim ran the wrong way down the axis — a bug that
 * only a volume check caught. A rib cut as part of the bore's own outline cannot
 * disappear without the bore disappearing with it.
 *
 * Ribs are spread across the lower 270 degrees. The arc from 45 to 135 is the printed
 * roof rather than a true circle, so a rib there would bear on the peak instead of on
 * the pen — the one part of the bore that is not the size the fit maths thinks it is.
 */
/** A regular hexagon, VERTEX UP, given the distance from centre to a vertex.
 *
 *  Vertex up is the whole reason a hex hole needs no roof trick: the two upper faces
 *  lie at 60 degrees to the horizontal, well inside any overhang limit, so the hole
 *  closes itself. Flat up would put a bridge the full width of the barrel across the
 *  top, which is the one thing the teardrop exists to avoid on the round bore. */
function hexagon(CrossSection: any, cornerR: number, keep: Keep): any {
  const pts: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((90 + i * 60) * Math.PI) / 180;
    pts.push([Math.cos(a) * cornerR, Math.sin(a) * cornerR]);
  }
  return keep(new CrossSection([pts], 'NonZero'));
}

/** Which faces of a vertex-up hexagon get a rib, best first.
 *
 *  Faces sit at 120/180/240/300/0/60. The bottom four carry the pen's weight and are
 *  the ones a rib can bear on; the two at 60 and 120 are the printed roof, where a
 *  rib would hang off an overhang and touch the pen only after it had already
 *  bottomed out. Ordered for spread, so two ribs oppose and three make a tripod. */
const HEX_RIB_FACES_DEG = [180, 300, 240, 0, 120, 60];

function boreProfile(
  CrossSection: any,
  boreR: number,
  gripR: number,
  ribs: number,
  hex: boolean,
  keep: Keep,
): any {
  if (hex) return hexBoreProfile(CrossSection, boreR, gripR, ribs, keep);
  let cs = teardrop(CrossSection, boreR, keep);
  if (ribs <= 0 || gripR >= boreR - 0.02) return cs;

  // Chord -> half-angle at the rib's crest, clamped so a wide rib on a small bore
  // cannot wrap round and meet itself.
  const half = Math.min(Math.asin(Math.min(RIB_WIDTH_MM / 2 / gripR, 0.95)), Math.PI / (ribs * 2.2));
  const STEPS = 5;
  for (let i = 0; i < ribs; i++) {
    const a = ((135 + ((i + 0.5) / ribs) * 270) * Math.PI) / 180;
    // An annular wedge from the rib crest out past the bore wall. Subtracting it from
    // the void leaves solid standing in to `gripR` across that arc.
    const pts: number[][] = [];
    for (let k = 0; k <= STEPS; k++) {
      const t = a - half + (2 * half * k) / STEPS;
      pts.push([Math.cos(t) * gripR, Math.sin(t) * gripR]);
    }
    for (let k = STEPS; k >= 0; k--) {
      const t = a - half + (2 * half * k) / STEPS;
      pts.push([Math.cos(t) * (boreR + 1), Math.sin(t) * (boreR + 1)]);
    }
    cs = keep(cs.subtract(keep(new CrossSection([pts], 'NonZero'))));
  }
  return cs;
}

/**
 * The hex hole, with N ribs standing off its faces.
 *
 * `boreR` and `gripR` arrive as CIRCUMradii — the corner circles — because that is
 * what everything outside the hole is sized from. A hexagon's faces sit at
 * cos(30) of that, and the rib has to be measured from the face it stands on, not
 * from the corner circle, or it would be 15 percent short of the pen.
 */
function hexBoreProfile(
  CrossSection: any,
  boreR: number,
  gripR: number,
  ribs: number,
  keep: Keep,
): any {
  let cs = hexagon(CrossSection, boreR, keep);
  if (ribs <= 0 || gripR >= boreR - 0.02) return cs;

  const faceR = boreR / HEX_CORNER_FACTOR; // centre -> face of the hole
  const ribCrest = gripR / HEX_CORNER_FACTOR; // centre -> face of the pen it grips
  const depth = boreR + 1 - ribCrest;
  if (depth <= 0.05) return cs;

  for (let i = 0; i < Math.min(ribs, HEX_RIB_FACES_DEG.length); i++) {
    const a = HEX_RIB_FACES_DEG[i]! * (Math.PI / 180);
    // A bar lying on the face, its inner edge at the rib crest and its outer edge
    // safely past the hole wall, then rotated onto that face's normal.
    const bar = keep(
      CrossSection.square([RIB_WIDTH_MM, depth], true)
        .rotate((HEX_RIB_FACES_DEG[i]! - 90))
        .translate([Math.cos(a) * (ribCrest + depth / 2), Math.sin(a) * (ribCrest + depth / 2)]),
    );
    cs = keep(cs.subtract(bar));
    void faceR;
  }
  return cs;
}

/*
  How much material the letters themselves offer along the pen's path.

  The plate normally guarantees this with a SPINE — a bar laid down the pen's axis,
  folded into the silhouette before the outline offset, wide enough that the bore
  always has a wall around it whatever the text is. Take the spine away and the
  guarantee has to come from the letters, which do not give it for free: "Alex" is
  13 mm tall at the A and 7 at the e, and a 10 mm hole down the middle of it comes
  out through the top of the e.

  So measure it. Walk the bore's run, and at each step ask how far the silhouette
  reaches either side of the axis. The narrowest step over the whole run is what the
  hole has to live inside, and the band's own centre — not the text's — is where it
  should sit.

  The scale that comes out of this is exact rather than iterated, because offsetting
  commutes with uniform scaling: scaling the glyphs, the outline width and the
  smoothing radius all by k gives EXACTLY k times the silhouette. So one measurement
  answers it, and there is no search loop in the worker.
*/
interface BareFit {
  /** Scale the whole profile by this so the bore fits inside the letters. >= 1. */
  scale: number;
  /** Where the bore should sit across the band, in the socket's local frame, mm. */
  offset: number;
  /** Local y of the first and last material along the run, pre-scale. */
  faceY: number;
  backY: number;
  /** True when even the cap could not open the band wide enough. */
  clamped: boolean;
}

/** Hard ceiling on the auto-scale. Past this the answer is not a bigger topper, it
 *  is a smaller hole or a heavier font, and quietly printing a 250 mm name is worse
 *  than saying so. */
const MAX_BARE_SCALE = 4;

function bareFit(
  polys: number[][][],
  anchor: [number, number],
  dir: [number, number],
  perp: [number, number],
  yFrom: number,
  yTo: number,
  need: number,
  noseR: number,
): BareFit | null {
  // Everything into the socket's own frame: y runs along the pen into the block,
  // v runs across it. Local +y is world -dir (see `place` in buildTopper).
  const local = polys.map((poly) =>
    poly.map((pt) => {
      const dx = pt[0]! - anchor[0];
      const dy = pt[1]! - anchor[1];
      return [-(dx * dir[0] + dy * dir[1]), dx * perp[0] + dy * perp[1]] as [number, number];
    }),
  );

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const poly of local) {
    for (const pt of poly) {
      if (pt[0] < yMin) yMin = pt[0];
      if (pt[0] > yMax) yMax = pt[0];
    }
  }
  if (!Number.isFinite(yMin)) return null;

  /*
    Where the measured stretch starts, and this is the one number the whole thing
    turns on.

    Not at the silhouette's nose. The nose is a ROUND CAP — the outline offset put it
    there — so its cross-section goes to zero at the tip by construction, and a scan
    that starts a fixed tenth of a millimetre inside it measures the tip rather than
    the letters. Worse, that tenth is the only thing in this calculation that does not
    scale, so the answer ran away: "Mike" on a 6 mm straw came out 82 mm long, sized
    entirely by a sliver of rounded corner.

    One nose radius in — which IS the outline width — is where the cap has opened out
    to its full section, and it scales with everything else. The material before it is
    notched open by the bore, which is what the mouth of a socket looks like anyway.
  */
  const y0 = Math.max(yFrom, yMin + noseR);
  const y1 = Math.min(yTo, yMax - noseR);
  if (y1 <= y0) return null;

  const STEPS = 64;
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const y = y0 + ((y1 - y0) * i) / STEPS;

    // Every crossing of the scan line, then even-odd into inside intervals. The
    // rings are disjoint and correctly wound, so parity is exact here.
    const xs: number[] = [];
    for (const poly of local) {
      for (let k = 0, n = poly.length; k < n; k++) {
        const a = poly[k]!;
        const b = poly[(k + 1) % n]!;
        if (a[0] > y === b[0] > y) continue;
        xs.push(a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]));
      }
    }
    if (xs.length < 2) return null;
    xs.sort((m, n) => m - n);

    // The interval that keeps the running band alive. On the first step there is no
    // band yet, so the one straddling the axis wins.
    let best: [number, number] | null = null;
    let bestOverlap = -Infinity;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = xs[k]!;
      const b = xs[k + 1]!;
      const overlap = Math.min(hi, b) - Math.max(lo, a);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = [a, b];
      }
    }
    if (!best || bestOverlap <= 0) return null;
    lo = Math.max(lo, best[0]);
    hi = Math.min(hi, best[1]);
  }

  const half = (hi - lo) / 2;
  if (half <= 0.05) return null;
  const wanted = need / half;
  const scale = Math.min(Math.max(1, wanted), MAX_BARE_SCALE);
  return {
    scale,
    offset: ((lo + hi) / 2) * scale,
    faceY: Math.max(yFrom, yMin),
    backY: Math.min(yTo, yMax),
    clamped: wanted > MAX_BARE_SCALE + 1e-6,
  };
}

export interface TopperProfiles {
  plateCS: any;
  textCS: any;
  haloCS: any;
  collarCS: any;
  boreCS: any;
  /** Radius of the circle the pen actually bears on, mm. */
  gripR: number;
  /** Bore centre height above the bed, mm. */
  boreZ: number;
  /** Where the collar's top face meets the plate. */
  anchorX: number;
  anchorY: number;
  /** Direction the socket points, degrees. 0 = straight down (-Y). */
  angleDeg: number;
  collarLen: number;
  /** True when the bore is inside the plate body rather than in its own tube. */
  inBody: boolean;
  /** How far the block reaches back along the pen axis from the entry point. */
  reach: number;
  /** How far the outline offset grows the plate past the spine. */
  plateMargin: number;
  /** Where the bore's mouth is, in the socket's local frame. */
  mouthY: number;
  /** The face the bore would come out of, same frame. */
  farFace: number;
  /** What the letters were grown by so they could hold the bore. 1 = untouched. */
  letterScale: number;
  penPath: 'collar' | 'inset' | 'through';
  boreR: number;
  plateT: number;
  haloT: number;
  letterZ: number;
  hasHalo: boolean;
  isRaised: boolean;
  collarH: number;
  emptyText: boolean;
  /** Anything the user has to act on that only the profile pass can see. */
  notes: string[];
}

/**
 * Every 2D section the topper is made of. Split out from the extrusion so it can be
 * exercised headless — the plate silhouette is where the surprises live.
 */
export function buildProfiles(
  wasm: any,
  textContours: number[][][],
  params: BuildParams,
  keep: Keep,
): TopperProfiles {
  const { CrossSection } = wasm;

  const hasHalo = params.colorScheme === 'plate-halo-text';
  const isRaised = params.style === 'raised';

  // --- Socket sizing (first: it can force the plate thicker) --------------
  // `boreR` is the widest the hole gets — across the relief slots — because that is
  // what the wall, the roof and the block's floor all have to clear. What the pen
  // meets is `gripR`, which is smaller than the barrel on purpose.
  const gripR = gripFor(params) / 2;
  const boreR = boreFor(params) / 2;
  const wall = params.wallThickness;
  const boreZ = boreR + wall;
  // Bed -> bore centre -> truncated roof -> one wall over it. The height a body has
  // to be to hold this bore at all.
  // A hex hole's top is its own vertex, already at `boreR`; only the round bore
  // carries a roof cap above its radius.
  const collarH = boreZ + boreR * (params.holeShape === 'hex' ? 1 : ROOF_CAP) + wall;
  const collarW = 2 * (boreR + wall);
  const inBody = params.penPath !== 'collar';
  // No plate at all: the letters ARE the body, so they have to hold the bore.
  const bare = params.plateShape === 'none';

  /*
    In-body paths thicken the plate until it can actually contain the bore. That is
    not a nicety — it is what the shape IS. A name block bored through at its own
    thickness is the pencil topper people recognise, and asking someone to discover
    "set plate thickness to 13.3" first would be asking them to find the object by
    accident. The slider still moves; it just cannot go under the floor.
  */
  const requestedT = params.plateThickness;
  const snapped = params.printMode === 'noams'
    ? snapLayers(inBody ? Math.max(requestedT, collarH) : requestedT, params.haloThickness, params.layerHeight)
    : { base: inBody ? Math.max(requestedT, collarH) : requestedT, halo: params.haloThickness };
  const plateT = snapped.base;
  const haloT = snapped.halo;
  const letterZ = plateT + (hasHalo ? haloT : 0);

  // --- Glyphs -------------------------------------------------------------
  let glyphsCS: any;
  if (textContours.length === 0 || textContours.every((c) => c.length === 0)) {
    glyphsCS = keep(CrossSection.circle(0.01, 3));
  } else {
    glyphsCS = keep(new CrossSection(textContours, 'NonZero'));
  }
  if (Math.abs(params.boldness) > 0.02) {
    const bolded = keep(glyphsCS.offset(params.boldness, 'Round', 2.0, 12));
    if (bolded.area() > 0.1) glyphsCS = bolded;
  }
  const emptyText = glyphsCS.area() < 0.1;

  const gBox = bboxOfContours(textContours);
  const blockW = Math.max(gBox.maxX - gBox.minX, 0.1);
  const blockH = Math.max(gBox.maxY - gBox.minY, 0.1);
  const gcx = (gBox.minX + gBox.maxX) / 2;
  const gcy = (gBox.minY + gBox.maxY) / 2;

  let plateMargin = params.outlineWidth + (hasHalo ? params.haloWidth : 0);

  // --- Where the pen goes in ----------------------------------------------
  /*
    The pen leaves along a direction the user picks, and where it MEETS the model is
    where that direction crosses the text block's boundary:

      0 degrees   straight down          a name stacked on top of the pen
      -90         out to the left        a name reading across, in line with the pen
      -40         down and to the left   the name perched on the pen's corner

    For a collar that boundary point is where the tube starts, and the tube hangs
    outside the glyph box — which is not cosmetic: the collar stands `collarH` tall
    while the letters sit at `letterZ`, so a collar overlapping a glyph does not look
    like an overlap, it swallows the letter and the plate comes out with a bite
    missing.

    For the in-body paths the bore runs the other way, INTO the block, and the danger
    is the opposite one: a bore threading between two letters breaks out of the side.
    That is what the spine below is for.
  */
  const angleDeg = params.socketAngle;
  const rad = (angleDeg * Math.PI) / 180;
  // 0 = straight down; positive tilts toward +X.
  const dir: [number, number] = [Math.sin(rad), -Math.cos(rad)];
  const perp: [number, number] = [-dir[1], dir[0]];

  const m = plateMargin + 0.5;
  const halfW = blockW / 2 + m;
  const halfH = blockH / 2 + m;
  const tX = Math.abs(dir[0]) > 1e-6 ? halfW / Math.abs(dir[0]) : Infinity;
  const tY = Math.abs(dir[1]) > 1e-6 ? halfH / Math.abs(dir[1]) : Infinity;
  const t = Math.min(tX, tY);
  // `socketOffset` slides the entry along the edge it landed on, so a name can hang
  // off the pen's corner rather than balance on its middle.
  const slide = params.socketOffset * (t === tX ? halfH : halfW) * 0.85;
  let anchorX = gcx + dir[0] * t + perp[0] * slide;
  let anchorY = gcy + dir[1] * t + perp[1] * slide;

  // How far the block reaches back along the pen's axis from that entry point.
  let reach = 2 * t;
  /*
    How far the spine runs.

    A through bore needs the whole block — it comes out the far side. A blind one
    does NOT, and making it run the whole length anyway was wrong in a way that is
    obvious the moment you look at the model: the bar keeps going past the end of
    the hole and squares off the far end of the name into a rectangle sticking out
    behind the letters. The spine exists to guarantee wall around the bore; past the
    bore there is nothing to guarantee.
  */
  const roofT = Math.max(1.6, wall);
  let collarLen = !inBody
    ? params.socketDepth + roofT
    : params.penPath === 'through'
      ? reach
      : Math.min(params.socketDepth + roofT, reach);

  /*
    The spine: a bar of solid, one collar wide, laid along the pen's axis and folded
    into the plate BEFORE the outline offset, so the smoothing pass blends it in
    rather than welding a rectangle on.

    For a collar it is short — just the lap joint that fuses the tube to the plate.
    For an in-body bore it runs the block's whole length, and it is the thing that
    makes the bore legal: "Alex" is four separate letters with air between them, and
    a hole drilled along that line exits through the side of the L. The spine
    guarantees `wall` of material all the way round the bore no matter what the text
    is. It is pre-shrunk by the margin the offset adds back, so the plate does not
    end up with a flange standing proud of the socket.
  */
  const stemW = Math.max(collarW - 2 * plateMargin, collarW * 0.4);
  const stemLen = inBody ? collarLen : Math.max(collarLen * 0.55, 4);
  // A collar grows outward from the entry; an in-body bore runs back into the block.
  const stemDir = inBody ? -1 : 1;
  /** A rectangle of the spine's width, spanning local y = [a, b] along the pen. */
  const stemPiece = (a: number, b: number, w: number) => {
    const mid = ((a + b) / 2) * stemDir;
    return keep(
      CrossSection.square([w, Math.max(b - a, 0.05)], true)
        .rotate(angleDeg)
        .translate([anchorX + dir[0] * mid, anchorY + dir[1] * mid]),
    );
  };

  // Past the bore, the spine tapers away instead of stopping square, so the plate
  // goes back to hugging the letters without a visible step where the bar ends.
  const taper = inBody && params.penPath !== 'through' ? Math.min(9, Math.max(0, reach - collarLen)) : 0;
  const stemCS = taper > 0.5
    ? keep(CrossSection.hull([stemPiece(0, stemLen, stemW), stemPiece(stemLen + taper - 0.05, stemLen + taper, stemW * 0.55)]))
    : stemPiece(0, stemLen, stemW);

  let shapeCS: any;
  if (params.plateShape !== 'rectangle') {
    /*
      `none` drops the spine and nothing else. The welds below stay: a stacked name is
      a column of loose letters and a two-line one is two loose rows, and a topper that
      arrives in pieces is not a topper. The spine is the part that turns the model
      into a brick, because it is one collar wide — 13 mm for a ballpoint — which is
      taller than the letters it was meant to support.
    */
    shapeCS = bare && inBody ? glyphsCS : keep(glyphsCS.add(stemCS));
    if (params.layout === 'vertical' && blockH > 0) {
      // A stacked name is a column of separate letters; a central spine fuses them
      // into one body before the offset rounds it.
      const spine = keep(
        CrossSection.square([Math.max(blockW * 0.42, params.size * 0.3), blockH], true).translate([gcx, gcy]),
      );
      shapeCS = keep(shapeCS.add(spine));
    } else if ((params.lines ?? []).length >= 2) {
      const l1 = params.lines[0]!;
      const l2 = params.lines[1]!;
      const yt = l1.minY + (l1.maxY - l1.minY) * 0.45;
      const yb = l2.maxY - (l2.maxY - l2.minY) * 0.45;
      let cxL = Math.max(l1.minX, l2.minX);
      let cxR = Math.min(l1.maxX, l2.maxX);
      const minW = params.size * 0.6;
      if (cxR - cxL < minW) {
        const mid = cxR > cxL ? (cxL + cxR) / 2 : (Math.min(l1.minX, l2.minX) + Math.max(l1.maxX, l2.maxX)) / 2;
        cxL = mid - minW / 2;
        cxR = mid + minW / 2;
      }
      if (yt > yb) {
        const band = keep(
          CrossSection.square([cxR - cxL, yt - yb], true).translate([(cxL + cxR) / 2, (yt + yb) / 2]),
        );
        shapeCS = keep(shapeCS.add(band));
      }
    } else if (params.name.includes(' ')) {
      const strip = keep(CrossSection.square([blockW, blockH * 0.5], true).translate([gcx, gcy]));
      shapeCS = keep(shapeCS.add(strip));
    }
  } else {
    const rect = keep(CrossSection.square([blockW, blockH], true).translate([gcx, gcy]));
    shapeCS = keep(rect.add(stemCS));
  }

  // Grow to the final silhouette, then close tight gaps between letters.
  const smoothR = params.smoothing;
  let plateCS = keep(shapeCS.offset(plateMargin + smoothR, 'Round', 2.0, 24));
  if (smoothR > 0.05) plateCS = keep(plateCS.offset(-smoothR, 'Round', 2.0, 24));
  plateCS = fillHoles(CrossSection, plateCS, keep);

  let textCS = glyphsCS;
  let haloCS = hasHalo ? keep(glyphsCS.offset(params.haloWidth, 'Round', 2.0, 16)) : null;

  /*
    Without a spine the bore's mouth is the letters' own face, and the plate's face is
    no longer one margin outside the anchor — the offset has nothing to grow past. So
    the two ends of the bore come from the measurement rather than from the margin.
  */
  let mouthY = inBody ? -plateMargin : -collarLen;
  let farFace = inBody ? reach + plateMargin : collarLen;
  let letterScale = 1;
  const notes: string[] = [];

  if (bare && inBody && !emptyText) {
    const blindTo = Math.min(params.socketDepth, reach + plateMargin);
    const fit = bareFit(
      plateCS.toPolygons() as number[][][],
      [anchorX, anchorY],
      dir,
      perp,
      mouthY,
      params.penPath === 'through' ? Infinity : blindTo,
      boreR + wall,
      plateMargin,
    );
    if (!fit) {
      notes.push(
        'With no plate the letters have to hold the hole themselves, and these do not join up along the pen’s path. Widen the outline, pick a heavier font, or put the plate back.',
      );
    } else {
      letterScale = fit.scale;
      if (fit.clamped) {
        notes.push(
          `Even grown ${MAX_BARE_SCALE}× the letters cannot hold a ${(2 * boreR).toFixed(1)} mm hole. Use a thinner pen, a heavier font, or put the plate back.`,
        );
      }
      if (letterScale > 1.001) {
        plateCS = keep(plateCS.scale([letterScale, letterScale]));
        textCS = keep(textCS.scale([letterScale, letterScale]));
        if (haloCS) haloCS = keep(haloCS.scale([letterScale, letterScale]));
        plateMargin *= letterScale;
        reach *= letterScale;
      }
      // The whole profile scaled about the origin, so the anchor goes with it — and
      // then across, onto the middle of the band the letters actually offer.
      anchorX = anchorX * letterScale + perp[0] * fit.offset;
      anchorY = anchorY * letterScale + perp[1] * fit.offset;
      mouthY = fit.faceY * letterScale - 0.2;
      farFace = fit.backY * letterScale + 0.2;
      collarLen = params.penPath === 'through' ? farFace - mouthY : collarLen;
    }
  }

  // --- Socket sections ----------------------------------------------------
  // Outer profile: a flat-bottomed block up to the bore's centre line, capped by the
  // bore's own teardrop grown by one wall. They meet at exactly the same width, so
  // the join is seamless — flat foot, straight flanks, self-supporting dome.
  const isHex = params.holeShape === 'hex';
  const boreCS = boreProfile(CrossSection, boreR, gripR, params.ribCount, isHex, keep);
  // The collar is grown from the bore, which is the widest the void ever gets — the
  // ribs only ever stand inside it.
  const holeOuter = isHex ? hexagon(CrossSection, boreR, keep) : teardrop(CrossSection, boreR, keep);
  const dome = keep(holeOuter.offset(wall, 'Round', 2.0, 32).translate([0, boreZ]));
  const foot = keep(CrossSection.square([collarW, boreZ], true).translate([0, boreZ / 2]));
  let collarCS = keep(dome.add(foot));
  // Take the sharpness off the two bottom corners; the first layer spreads there
  // anyway and a square corner is what catches on the way off the plate.
  collarCS = keep(collarCS.offset(-0.6, 'Round', 2.0, 12).offset(0.6, 'Round', 2.0, 12));

  return {
    plateCS,
    textCS,
    haloCS,
    collarCS,
    boreCS,
    boreZ,
    anchorX,
    anchorY,
    angleDeg,
    collarLen,
    inBody,
    reach,
    plateMargin,
    mouthY,
    farFace,
    letterScale,
    penPath: params.penPath,
    gripR,
    boreR,
    plateT,
    haloT,
    letterZ,
    hasHalo,
    isRaised,
    collarH,
    emptyText,
    notes,
  };
}

export function buildTopper(
  wasm: any,
  textContours: number[][][],
  params: BuildParams,
): {
  parts: PartMesh[];
  warnings: string[];
  size: [number, number, number];
  bore: number;
  letterScale: number;
  /** How far a pen can actually go in, mm — the slider, or less if the block ran out. */
  depth: number;
} {
  const { Manifold, CrossSection } = wasm;
  const warnings: string[] = [];

  let letterScale = 1;
  let depth = 0;
  const result = withScope((keep) => {
    const p = buildProfiles(wasm, textContours, params, keep);
    if (p.emptyText) warnings.push('The text is empty or the glyphs are missing from this font.');
    warnings.push(...p.notes);
    letterScale = p.letterScale;

    const parts: PartMesh[] = [];

    /*
      Every socket feature is authored in one local frame — the prism runs along -Y
      from the origin, so "3 mm in from the mouth" is just y = -(collarLen - 3) —
      and then `place` swings the whole lot to the socket's angle and drops it on
      the anchor. Doing it the other way round, transforming each feature where it
      is built, is what left the collar sitting at x = 0 while the plate's stem was
      out at the text's centre: the two agreed on the angle and disagreed on where.
    */
    const place = (solid: any) => keep(solid.rotate([0, 0, p.angleDeg]).translate([p.anchorX, p.anchorY, 0]));
    /** A profile in XY -> a prism running along local -Y, top face at local y = 0. */
    const prism = (cs: any, len: number, topY = 0) =>
      keep(cs.extrude(len).rotate([90, 0, 0]).translate([0, topY, 0]));

    // --- Body: plate + collar ---------------------------------------------
    const chamPlate = Math.min(params.chamferOn ? params.chamfer : 0, p.plateT * 0.6);
    const chamText = Math.min(params.chamferOn ? params.chamfer : 0, params.textThickness * 0.5);

    // Bottom chamfer on the plate only: the letters sit on top of it, so their
    // underside is buried and a bevel there would just undercut them.
    let body = bevelExtrude(p.plateCS, p.plateT, chamPlate, keep, true);
    // A collar is its own tube welded to the plate. An in-body bore has no tube: the
    // plate was thickened to hold it, and the spine guarantees the wall.
    if (!p.inBody) body = keep(body.add(place(prism(p.collarCS, p.collarLen))));

    /*
      Bore extents in the local frame, where the pen axis is Y and the entry face is
      at y = 0 for an in-body bore or y = -collarLen for a collar. Written as an
      explicit from/to pair rather than a length plus an offset, because the three
      paths differ only in these two numbers and everything downstream — the ribs,
      the lead-ins, the mark's safe stretch — reads them.
    */
    /*
      `mouthY` is where the SPINE starts; the plate's real face is one outline
      margin further out, because the offset that grows the silhouette grows it
      past the spine's end too. Cutting from the spine's end leaves that margin as
      a lid over the hole — a socket that looks right in every view except the one
      where somebody tries to put a pen in it.

      Both faces are worked out in `buildProfiles`, because with no plate there is no
      spine for the margin to be measured from and the answer comes off the letters.
    */
    const mouthY = p.mouthY;
    const boreFrom = mouthY - 1; // start outside the face so the cut is clean
    const farFace = p.farFace;
    const boreTo =
      p.penPath === 'through'
        ? farFace + 1 // straight out the far side
        : p.inBody
          ? Math.min(params.socketDepth, farFace - Math.max(1.6, params.wallThickness))
          : mouthY + params.socketDepth;

    // `boreCS` is centred on the origin; the collar profile already carries the lift
    // to the bore's centre line, so the bore has to be lifted to match it.
    const boreLifted = keep(p.boreCS.translate([0, p.boreZ]));
    body = keep(body.subtract(place(prism(boreLifted, boreTo - boreFrom, boreTo))));
    // What the socket ended up being, measured from its own mouth. A blind bore is
    // clamped by `farFace`, so on a short name this is less than the slider asked
    // for, and that gap is the difference between a topper that holds and one that
    // pivots off. Reported rather than silently accepted.
    depth = boreTo - mouthY;

    // Lead-in chamfers so the barrel finds the hole instead of catching its edge —
    // one at the entry, and for a through bore one at the exit too, since either end
    // is a place someone will push a pen in.
    //
    // Longer than it used to be, and it has to be: the hole is now UNDER the barrel,
    // so the pen does not slide in and meet a rib, it has to be started. A cone that
    // opens from the gripping circle out past the barrel is what starts it.
    const lead = 1.6;
    const cone = (atY: number, towardPlus: boolean) =>
      place(
        keep(
          Manifold.cylinder(lead + 0.02, p.boreR + lead * 0.6, p.gripR, 48)
            .rotate([towardPlus ? -90 : 90, 0, 0])
            .translate([0, atY + (towardPlus ? -0.01 : 0.01), p.boreZ]),
        ),
      );
    body = keep(body.subtract(cone(mouthY, true)));
    if (p.penPath === 'through') body = keep(body.subtract(cone(farFace, false)));

    // --- Provenance mark (invariant #2) -------------------------------------
    // The voids go in the collar wall beside the bore: the one region that is solid
    // for every parameter combination this generator can produce, because the wall
    // is what makes it a socket at all. Placed in the same local frame as everything
    // else, then swung onto the anchor with the rest of the socket.
    const voids = identityVoids({
      boreR: p.boreR,
      wall: params.wallThickness,
      boreZ: p.boreZ,
      yFrom: mouthY + 2,
      yTo: (p.inBody ? p.collarLen : 0) - 2,
    });
    for (const v of voids) {
      body = keep(body.subtract(place(keep(Manifold.sphere(v.d / 2, 12).translate([v.x, v.y, v.z])))));
    }

    // --- Engraved variant ---------------------------------------------------
    if (!p.isRaised) {
      const cutDepth = Math.min(params.textThickness, p.plateT * 0.6);
      const recessCS = p.hasHalo && p.haloCS ? keep(p.haloCS.add(p.textCS)) : p.textCS;
      const recess = keep(recessCS.extrude(cutDepth + 1).translate([0, 0, p.plateT - cutDepth]));
      body = keep(body.subtract(recess));
      parts.push({ name: 'plate', ...meshOf(body), color: hexToRgb(params.plateColor) });

      if (params.colorScheme !== 'single') {
        if (p.hasHalo && p.haloCS) {
          const ringCS = keep(p.haloCS.subtract(p.textCS));
          if (ringCS.area() > 0.02) {
            const ring = keep(ringCS.extrude(cutDepth).translate([0, 0, p.plateT - cutDepth]));
            parts.push({ name: 'halo', ...meshOf(ring), color: hexToRgb(params.haloColor) });
          }
        }
        const inlay = keep(p.textCS.extrude(cutDepth).translate([0, 0, p.plateT - cutDepth]));
        parts.push({ name: 'text', ...meshOf(inlay), color: hexToRgb(params.textColor) });
      }
    } else {
      parts.push({ name: 'plate', ...meshOf(body), color: hexToRgb(params.plateColor) });

      if (p.hasHalo && p.haloCS) {
        const halo = keep(p.haloCS.extrude(p.haloT).translate([0, 0, p.plateT]));
        parts.push({ name: 'halo', ...meshOf(halo), color: hexToRgb(params.haloColor) });
      }

      const text = keep(bevelExtrude(p.textCS, params.textThickness, chamText, keep).translate([0, 0, p.letterZ]));
      parts.push({
        name: 'text',
        ...meshOf(text),
        color: hexToRgb(params.colorScheme === 'single' ? params.plateColor : params.textColor),
      });
    }

    // --- Sanity checks the user can act on ----------------------------------
    if (params.wallThickness < 1.2) {
      warnings.push('A wall under 1.2 mm will crack when the pen goes in. 1.6 mm or more is safer.');
    }

    if (p.penPath !== 'through' && depth < p.boreR * 3) {
      warnings.push(
        `The hole is only ${depth.toFixed(1)} mm deep against a ${(2 * p.boreR).toFixed(1)} mm barrel, so the topper ` +
          'will pivot on its mouth. Make the text bigger or longer, or turn the pen to enter the long way.',
      );
    }

    return parts;
  });

  // Overall size, measured off the emitted meshes so it is what the user gets.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const part of result) {
    const v = part.positions;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i]! < minX) minX = v[i]!;
      if (v[i]! > maxX) maxX = v[i]!;
      if (v[i + 1]! < minY) minY = v[i + 1]!;
      if (v[i + 1]! > maxY) maxY = v[i + 1]!;
      if (v[i + 2]! < minZ) minZ = v[i + 2]!;
      if (v[i + 2]! > maxZ) maxZ = v[i + 2]!;
    }
  }
  const size: [number, number, number] = Number.isFinite(minX)
    ? [maxX - minX, maxY - minY, maxZ - minZ]
    : [0, 0, 0];

  return { parts: result, warnings, size, bore: boreFor(params), letterScale, depth };
}
