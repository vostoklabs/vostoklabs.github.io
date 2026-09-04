// Core clicker construction. Runs in the geometry worker with the Manifold WASM
// kernel. See DEV_PLAN.md §6 and the user's "process explained on my model" refs.
//
// Design (button-in-bezel):
//   BASE (body): a SOLID block. Cut a recessed WELL into the top (leaving a raised
//        border), then cut the MX socket into the well floor. The cap nests INSIDE
//        the well; the body's border surrounds it.
//   TOP (cap): flat image plate + stem underneath, sized to drop into the well with
//        a `tolerance` slip-fit. No skirt — the body border is the bezel.
//
//   plate (cap)  = the image footprint + frame
//   well         = plate + tolerance            (cap slips in)
//   body outer   = plate + tolerance + border   (the bezel wall)
//
// The image occupies only the top `imageDepth` mm over a solid `topThickness`
// backing. Colors are carved as non-overlapping inlays (priority by coverage, so
// small details stay crisp) and removed from the backing — clean even when flat.
//
// Frame: Z = 0 is the switch plate top. socket cuts downward; stem rises to +Z.
import type { BuildParams, BuildRegion, ClickerPart, EdgeSetting, EdgeStyle, PartGroup, Ring, RGB, SwitchPlacement } from '../types';
import { getMarkSeed, markVoids, hardcodedVoids } from './identityMark';
import {
  archRing, capsuleRing, crossRing, eggRing, heartRing, ngonRing, shieldRing,
  squircleRing, switchSpotOf, tagRing,
} from './shapePaths';

type Wasm = any;
type Solid = any;
type Section = any;

/** Half the thinnest feature a drawn or imported silhouette may keep.
 *
 *  A spur narrower than 2 mm on the CAP rides against the well wall and catches when the
 *  clicker is pressed, which is what the placeholder pumpkin's stalk did. `makeCustom` opens
 *  every custom outline by this much, so the defect cannot come back through a different shape.
 *
 *  Module-level and exported rather than a local, because the 2-D shape editor shades the same
 *  material red while you drag it. Two copies of this number would agree today and diverge the
 *  first time somebody decided 1.2 mm prints more reliably — and the editor would go on
 *  promising a shape the build then eats.
 */
export const MIN_FEATURE_MM = 1.0;

/*
  How much of a switch's clear column may stick out past a footprint before it counts.

  A square column against a curved cap always pokes out by a sliver, and a sliver is neither
  visible nor worth moving a switch for. 2 mm² was already the threshold the base-widening
  warning used; it is reused rather than re-chosen so the test that decides to act and the
  message that reports it cannot disagree.
*/
const OVERHANG_OK = 2;

/*
  How many times the outline size search may grow the artwork.

  Six 12% steps reach 1.97x. The worst case measured across the Halloween pack is the bat at
  1.43x (35 mm to 50 mm), so there is headroom; past 2x the design is so much smaller than the
  switch that making it fit is not the answer anyone wants, and the old warning is better than
  a part twice the size that was never asked for.
*/
const SIZE_TRIES = 6;

export function buildClicker(
  wasm: Wasm,
  socket: Solid,
  stem: Solid,
  regions: BuildRegion[],
  outline: Ring[],
  params: BuildParams,
): { parts: ClickerPart[]; switchPlacements: SwitchPlacement[]; warnings: string[] } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  // Traced outlines carry thousands of vertices, and round offsets (esp. the plate
  // closing) balloon that further. Every downstream offset/extrude/boolean scales with
  // vertex count, so collapsing near-collinear points to a print-invisible tolerance
  // (~0.04 mm at 35 mm scale) is the single biggest speed lever in the whole build.
  const simp = (s: Section, eps = 0.04): Section => {
    try {
      return typeof s.simplify === 'function' ? track(s.simplify(eps)) : s;
    } catch {
      return s;
    }
  };

  // --- Switch assets: drive the Z stack AND the minimum cap size ---
  // Pocket fit is applied FIRST, before anything is measured, so everything derived from the
  // socket — its bbox, the clear column over each switch, the minimum cap size — follows the
  // pocket the user actually asked for rather than the authored one.
  //
  // The socket is a pure cutter (subtracted from the body further down), so scaling the cutter
  // IS scaling the pocket. The worker hands it to us already centred on its own XY bbox, so
  // scaling about the origin scales about its own centre. Z is never touched: the socket's top
  // face sits at Z 0 and the whole switch stack is hung off that.
  const socketFit = params.socketFitPct ?? 0;
  const socketSized: Solid =
    Math.abs(socketFit) > 0.01
      ? track(socket.scale([1 + socketFit / 100, 1 + socketFit / 100, 1]))
      : socket;

  const socketBB = socketSized.boundingBox();
  /** Half-extent of the switch pocket in XY — the radius inside which nothing can be buried. */
  const sbbHalf = Math.max(socketBB.max[0], socketBB.max[1], -socketBB.min[0], -socketBB.min[1]);

  /* Smallest radius at which a void of diameter `d` sits entirely outside the switch pocket,
     along the bearing `thetaRad`.
     
     The pocket is a SQUARE, so its boundary is further from the centre off-axis than on it —
     `sbbHalf / max(|cos|, |sin|)`, which is `sbbHalf` on an axis and `sbbHalf * sqrt(2)` at 45°.
     Using the bare half-extent instead (the first attempt at this) under-clears every void that
     is not on an axis: the one at 201.9° needs 9.03 mm and a flat clamp gave it 8.57, so it went
     on failing exactly as before and the fix looked like it had done nothing.
     
     `socketBB` is the real asset's bounds, so this follows the CAD rather than a constant that
     would rot the moment the socket is re-cut. The 0.15 mm is margin, not clearance: the void
     must be BURIED, and a sphere merely tangent to the cavity fails the 0.98 volume test. */
  const voidClearR = (d: number, thetaRad: number): number => {
    const c = Math.abs(Math.cos(thetaRad));
    const sn = Math.abs(Math.sin(thetaRad));
    return sbbHalf / Math.max(c, sn, 1e-6) + d / 2 + 0.15;
  };
  const stemBB = stem.boundingBox();
  const socketDim = Math.max(
    socketBB.max[0] - socketBB.min[0],
    socketBB.max[1] - socketBB.min[1],
  );

  // --- Normalized image bbox (trace centers it; longest side = 1) ---
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of outline) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) {
    minX = -0.5;
    maxX = 0.5;
    minY = -0.5;
    maxY = 0.5;
  }
  const nW = maxX - minX || 1;
  const nH = maxY - minY || 1;

  // --- Sizing. Image fits INSIDE the frame; the cap must be wide enough that the
  //     well (cap + tolerance) contains the switch socket. ---
  /** Past this the base cannot be printed on any plate we ship (the largest is the H2D's
   *  350 × 320), so a shape that only contains the artwork by growing past it is not a shape —
   *  it is a runaway. See the fit search below. */
  const MAX_PLATE_SPAN_MM = 300;
  const border = Math.max(0, params.imageMargin);
  const tol = Math.max(0.05, params.tolerance);
  // The cup must always expose a clear column over the switch — its footprint plus
  // the MX top housing plus clearance — so the switch drops in even when the outline
  // is concave (a notch) or the cap is small. The cap is sized to cover that column.
  const switchClear = socketDim + 3.0;
  const minCap = switchClear + 1.0;
  // The body's bezel wall. Declared up here rather than beside the body block, because a fixed
  // footprint has to work BACK from the outer size through it.
  const borderW = Math.max(0.4, params.borderWidth);
  /** What the body adds around the cap plate on every side: the slip-fit gap the cap rides in
   *  plus the bezel wall. Working back through it is what makes the number on the fixed-size
   *  control the size of the finished PART, which is the only number a seller can put in a
   *  listing or measure with calipers. */
  const plateInset = borderW + tol;

  /* Pin the body to a chosen footprint, and fit the artwork inside it — the inversion of every
     other path here, which sizes the base FROM the design.

     Absent (the default, and what every clicker generated before this did) leaves all of the
     code below exactly as it was. */
  const req = params.bodySize;
  const fixed = req && req.w > 0.1 && req.h > 0.1 ? { w: req.w, h: req.h } : null;
  // A fixed size and an outline base are contradictory: the outline IS the artwork, so it
  // cannot also be a size the user chose. Everything downstream branches on `isOutline`, so
  // resolving it once here is cheaper than a special case in each.
  const isOutline = params.baseShape === 'outline' && !fixed;

  // Declared here rather than beside the first push, because the size clamp immediately below
  // is the earliest thing that has something to say to the user.
  const warnings: string[] = [];
  /* The three switch-fit clamps below (design too narrow, design grown for the column, base
     widened) all say "the model grew so the switch fits" and routinely fire TOGETHER — the
     default two-line text at 35 mm raised all three at once, a five-line wall under the
     viewport on first load. One short line at the end covers them. */
  let grewForSwitchMm = 0;

  if (fixed) {
    // The plate still has to contain the switch's clear column, or the result is a body that
    // cannot hold a switch. Clamp and say so, the same treatment the outline size clamp got.
    const minBody = minCap + 2 * plateInset;
    if (fixed.w < minBody - 0.01 || fixed.h < minBody - 0.01) {
      fixed.w = Math.max(fixed.w, minBody);
      fixed.h = Math.max(fixed.h, minBody);
      warnings.push(
        `Fixed base size raised to ${fixed.w.toFixed(0)} × ${fixed.h.toFixed(0)} mm — `
        + 'anything smaller has no room for an MX switch.',
      );
    }
    if (params.baseShape === 'outline') {
      warnings.push(
        'A fixed base size cannot follow your design’s outline, so the base is a rounded '
        + 'rectangle. Switch Base style to Shape to pick a different one.',
      );
    }
  }

  let imageScale = Math.max(2, params.capWidthMm - 2 * border);
  let imgW = nW * imageScale;
  let imgH = nH * imageScale;
  if (isOutline && Math.min(imgW, imgH) + 2 * border < minCap) {
    // The base follows the artwork, so a design narrower than the switch has to grow until its
    // SHORT side clears it. Scaling is uniform, which means the long side is dragged along and
    // `capWidthMm` — the number on the Size slider — stops being what the user gets.
    //
    // For a 4:1 logo that is not subtle: Size 20, 30, 40, 50 and 60 all produce the same 71 mm
    // part. Five positions of a slider, byte-identical geometry, and nothing said. It reads as a
    // broken slider, and it is behind "it makes the clicker quite large compared to the single
    // switch", "is there a way to scale the picture bigger when using the Base Style", and
    // "even when I size it up".
    //
    // Growing only the BASE instead (the way a preset shape already does, via `wellFp`) is the
    // real fix and it changes the geometry of every outline clicker anyone has printed. Until
    // that is worth doing, the least the build can do is say what size it actually used and
    // which control gets the user out of it.
    imageScale *= (minCap - 2 * border) / Math.min(imgW, imgH);
    imgW = nW * imageScale;
    imgH = nH * imageScale;
    grewForSwitchMm = Math.max(imgW, imgH) + 2 * border;
  }
  /* `let`, and read lazily by the ring helpers below rather than captured by value.
     The fixed-footprint path cannot know the artwork scale until the plate exists, and the
     plate is built ~180 lines down — so it assigns this there and every helper picks it up. */
  let sR = imageScale;

  const scaleRings = (rings: Ring[]): Ring[] =>
    rings.map((r) => r.map(([x, y]) => [x * sR, y * sR] as [number, number]));

  // Nudging the design only means something on a PRESET base — when the base follows the
  // outline, the shape and the artwork are the same thing and moving one moves both.
  const offX = isOutline ? 0 : (params.imageOffset?.x ?? 0);
  const offY = isOutline ? 0 : (params.imageOffset?.y ?? 0);
  /* How much of the available room the artwork takes. 1 = fills it, which is what every
     clicker built before this did.

     `isOutline ? 1` for exactly the reason the nudge above is: when the base follows the
     outline, the shape and the artwork are the same thing. Shrinking one there would print the
     silhouette at full size with a smaller copy of the design floating in a wide blank band of
     base colour — which is not a smaller design, it is a mistake. */
  // Up to 2: past 1 the artwork is larger than the frame and `imageArea` crops it, which is
  // how "zoom in on the middle of the picture" is expressed. The base never grows for it.
  const designScale = isOutline ? 1 : Math.min(2, Math.max(0.3, params.designScale ?? 1));
  /** Scaled rings, moved by the design nudge. Used for the ARTWORK only; the silhouette
   *  that drives an outline base is left where it is. */
  const placeRings = (rings: Ring[]): Ring[] =>
    offX === 0 && offY === 0
      ? scaleRings(rings)
      : rings.map((r) => r.map(([x, y]) => [x * sR + offX, y * sR + offY] as [number, number]));

  const removeHoles = (cs: Section): Section => {
    if (sectionIsEmpty(cs)) return cs;
    
    // Create a giant bounding rectangle that definitely covers the shape
    const rect = track(CrossSection.square([1000, 1000], true));
    
    // Invert the shape. The outer space becomes one giant solid, 
    // and internal holes become smaller separate solid islands.
    const inverted = track(rect.subtract(cs));
    
    // Break the inverted shape into its disconnected islands
    const islands = [...inverted.decompose()];
    
    if (islands.length <= 1) {
      return cs; // No holes found
    }
    
    // The outer space is the island with the largest area (~1,000,000)
    let maxArea = -1;
    let outerSpace = islands[0];
    for (let i = 0; i < islands.length; i++) {
      const area = islands[i].area();
      if (area > maxArea) {
        maxArea = area;
        outerSpace = islands[i];
      }
    }
    
    // Subtract the outer space from the giant rectangle to recover the shape,
    // but now with all internal holes filled!
    return track(rect.subtract(outerSpace));
  };

  const getRingArea = (ring: Ring): number => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  };

  const filledOutline = (): Section => {
    const validRings = scaleRings(outline).filter((r) => r.length >= 3 && getRingArea(r) > 0.001);
    if (validRings.length === 0) {
      return track(CrossSection.square([sR, sR], true));
    }
    // Simplify the raw trace BEFORE any offset/boolean — the densest polygon in the
    // build, so trimming it here cascades a speedup through the entire pipeline.
    return simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
  };

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.1, Math.min(r, Math.min(w, h) / 2 - 0.01));
    const core = track(
      CrossSection.square([Math.max(0.2, w - 2 * rr), Math.max(0.2, h - 2 * rr)], true),
    );
    return track(core.offset(rr, 'Round', 2.0, 32));
  };

  const grow = (sec: Section, d: number): Section =>
    d <= 0.001 ? sec : track(sec.offset(d, 'Round', 2.0, 32));
  const shrink = (sec: Section, d: number, fb: Section): Section => {
    if (d <= 0.01) return sec;
    const r = track(sec.offset(-d, 'Round', 2.0, 32));
    return sectionIsEmpty(r) ? fb : r;
  };

  // --- Shape Generators ---
  const makeHexagon = (r: number): Section => {
    const pts: Ring = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6;
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    return track(new CrossSection([pts], 'NonZero'));
  };

  const makeStar = (r: number, points = 5, innerFrac = 0.56): Section => {
    // Cute chubby star: short legs (high inner radius) with rounded tips AND valleys
    // — not a spiky communist star. `innerFrac` is the editor's "sharpness" handle; its
    // default is the shipped value, so a star built without one is unchanged to the bit.
    const innerR = r * Math.max(0.3, Math.min(0.8, innerFrac));
    const pts: Ring = [];
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : innerR;
      pts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    const sharp = track(new CrossSection([pts], 'NonZero'));
    // Opening-then-closing (−rr, +2rr, −rr nets to zero size) rounds the convex tips
    // and the concave valleys while keeping the star's overall radius.
    // Scaled by the point count: a radius sized for five points eats the short legs of a
    // sixteen-point star entirely. `Math.min(1, 5 / points)` is exactly 1 at points = 5, so
    // the shipped star does not move by a floating-point bit.
    const rr = r * 0.13 * Math.min(1, 5 / points);
    const a = track(sharp.offset(-rr, 'Round', 2.0, 64));
    const b = track(a.offset(2 * rr, 'Round', 2.0, 64));
    return track(b.offset(-rr, 'Round', 2.0, 64));
  };

  /** A silhouette handed in as rings rather than generated here — a seasonal pack's pumpkin,
   *  bat or coffin. Rings arrive normalised (longest side = 1, centred), so scaling by 2·rr
   *  puts the shape on the same footing as a circle of radius rr and every caller below —
   *  the fit search, the fixed-size box — works on it unchanged.
   *
   *  Falls back to a circle when the rings are missing or degenerate. A pack whose asset
   *  failed to load should give the user a plain clicker, not a build error. */
  const makeCustom = (rr: number): Section => {
    const rings = (params.baseShapeRings ?? [])
      .map((r) => r.map(([x, y]) => [x * 2 * rr, y * 2 * rr] as [number, number]))
      .filter((r) => r.length >= 3);
    if (!rings.length) return track(CrossSection.circle(rr, 160));
    // NonZero, not EvenOdd: a traced silhouette's rings may be wound either way, and EvenOdd
    // would punch a hole wherever two same-direction rings overlap.
    let cs = simp(track(new CrossSection(rings, 'NonZero')), 0.02);

    /* Remove anything too thin to print or to press.

       A morphological OPEN — erode by t, dilate by t — deletes every feature narrower than 2t
       and leaves everything else where it was. This is the general fix for a whole class of
       defect Ian found on the pumpkin: its stalk is a couple of millimetres, the CAP follows
       the plate, and a thin spur on the cap rides against the well wall and catches on every
       press. It is not a pumpkin problem. Any drawn, imported or traced outline can have one,
       which is why this sits here rather than in whatever produced the rings.

       Skipped when it would eat the shape whole, so a legitimately small base still builds. */
    const eroded = track(cs.offset(-MIN_FEATURE_MM, 'Round', 2.0, 24));
    if (!sectionIsEmpty(eroded)) {
      const opened = track(eroded.offset(MIN_FEATURE_MM, 'Round', 2.0, 24));
      if (!sectionIsEmpty(opened)) cs = simp(opened, 0.02);
    }
    return sectionIsEmpty(cs) ? track(CrossSection.circle(rr, 160)) : cs;
  };

  // --- Cap plate footprint (the visible top; image + frame) ---
  //
  // A rectangle only makes sense if it has proportions, so it takes them from the artwork:
  // a wide logo gets a wide plate instead of a square one with big empty sides.
  //
  // `genShape` and `rectAspect` used to live inside the preset branch below. They are hoisted
  // because the fixed-footprint path needs the same shapes at a size it chose rather than at a
  // size it searched for, and a second copy of this switch is exactly how the two would drift.
  const rectAspect = Math.min(3, Math.max(0.34, imgH > 0.01 ? imgW / imgH : 1));
  /** A pure ring from shapePaths, scaled to radius `rr`.
   *
   *  `NonZero` rather than `EvenOdd`: every ring there is a single simple closed curve, and
   *  EvenOdd would punch a hole anywhere one grazed itself. */
  const fromRing = (ring: [number, number][], rr: number): Section =>
    track(new CrossSection([ring.map(([x, y]) => [x * rr, y * rr] as [number, number])], 'NonZero'));

  /** The knob shared by every parametric shape, clamped to the range this one accepts. */
  const sides = (fallback: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, Math.round(params.shapeSides ?? fallback)));
  const cornerPct = Math.min(0.4, Math.max(0, params.shapeCornerPct ?? 0.22));
  /** The second knob, shared the way `shapeSides` is shared: one field, clamped by whichever
   *  shape is selected, because the shapes that have a "notch" are mutually exclusive. A star's
   *  valley depth and a cross's arm width are the same question asked of two shapes — how deep
   *  does the shape cut in — and each clamps it to its own range. Absent = each shape's own
   *  shipped default, so nothing anyone has already made moves. */
  const feature = (fallback: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, params.shapeArmPct ?? fallback));

  const genShapeRaw = (rr: number, aspect: number): Section => {
    switch (params.baseShape) {
      case 'square': return roundedRect(2 * rr, 2 * rr, 2 * rr * cornerPct);
      case 'rect': return roundedRect(2 * rr * aspect, 2 * rr, 2 * rr * cornerPct);
      case 'hexagon': return makeHexagon(rr);
      case 'heart': return fromRing(heartRing(), rr);
      // `points` was already a parameter of makeStar and was never passed. Threading it through
      // is what turns one star into fourteen. The rounding fraction now shrinks with the point
      // count, or a 16-point star's short legs get eaten by a radius sized for five — and
      // `Math.min(1, 5 / points)` is exactly 1 at the shipped default, so the 5-point star that
      // has been printing for months is byte-identical.
      case 'star': return makeStar(rr, sides(5, 3, 8), feature(0.56, 0.3, 0.8));
      case 'egg': return fromRing(eggRing(), rr);
      case 'ngon': return fromRing(ngonRing(sides(6, 3, 8)), rr);
      case 'cross': return fromRing(crossRing(feature(0.34, 0.15, 0.45)), rr);
      case 'squircle': return fromRing(squircleRing(), rr);
      case 'capsule': return fromRing(capsuleRing(), rr);
      case 'shield': return fromRing(shieldRing(), rr);
      case 'tag': return fromRing(tagRing(), rr);
      case 'arch': return fromRing(archRing(), rr);
      case 'custom': return makeCustom(rr);
      case 'circle':
      default: return track(CrossSection.circle(rr, 160));
    }
  };

  /* Put the switch where it actually fits.

     The MX switch sits at the ORIGIN, and a shape's origin is not automatically somewhere a
     17 mm column has room. `makeHeart`, `makeStar` and `makeEgg` all centre on their bounding
     box, which for anything that tapers puts the origin in the narrow half: a triangle's origin
     is a third of the way up, a heart's is down in the point, a shield's is in the taper. The
     column then pokes out through the sloping sides and the build bulges the base to clear it.
     Ian saw it on four shapes and it is one bug.

     So every shape is moved so the origin lands on its SWITCH SPOT — the area centroid, slid
     toward the pole of inaccessibility only if the centroid turns out to be a poor place for a
     switch. See `switchSpotOf` in shapePaths.ts for the measurements behind that rule, and for
     why neither candidate alone is right: pure pole-centring made the heart read low, and pure
     centroid puts the heart's switch in the notch between its lobes.

     Computed ONCE at unit scale and scaled, because the fit search calls this up to 66 times per
     build with a different `rr` each time and the pole scales linearly with it. The ring-based
     shapes are already pole-centred in `shapePaths.ts`, so for them this measures ~0 and the
     translate is a no-op — uniform rather than special-cased. */
  let unitPole: [number, number] | null = null;
  const switchSpotOfSection = (cs: Section): [number, number] => {
    let rings: [number, number][][] = [];
    try {
      rings = cs.toPolygons() as [number, number][][];
    } catch {
      return [0, 0];
    }
    let outer: [number, number][] | null = null;
    let bestArea = 0;
    for (const r of rings) {
      if (r.length < 3) continue;
      let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
      }
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); outer = r; }
    }
    return outer ? switchSpotOf(outer) : [0, 0];
  };

  const genShape = (rr: number, aspect: number): Section => {
    const raw = genShapeRaw(rr, aspect);
    if (unitPole === null) {
      const unit = genShapeRaw(1, aspect);
      unitPole = switchSpotOfSection(unit);
    }
    const [px, py] = unitPole;
    if (Math.abs(px) < 1e-6 && Math.abs(py) < 1e-6) return raw;
    return track(raw.translate([-px * rr, -py * rr]));
  };

  /** The chosen base shape, stretched to fill a w × h box exactly.
   *
   *  Square and rect are built as a rounded rectangle directly rather than scaled: scaling a
   *  rounded square to 60 × 20 takes its corner radius with it and leaves visibly elliptical
   *  corners, which on the one shape people pick BECAUSE it is plain is the wrong trade.
   *  `outline` cannot be sized to a box at all — it is the artwork — so it falls back to the
   *  rectangle, having already said so in `warnings`. */
  const shapeInBox = (w: number, h: number): Section => {
    const shape = params.baseShape;
    if (shape === 'square' || shape === 'rect' || shape === 'outline') {
      return roundedRect(w, h, Math.min(w, h) * cornerPct);
    }
    if (shape === 'capsule') {
      // Built straight to the box rather than stretched from the unit ring, so the caps stay
      // circular instead of turning into half-ellipses. Safe to use roundedRect's absolute
      // clamp here: `shapeInBox` is a one-shot build for a size the user typed and is never
      // fed through the fit search, so the exact-homogeneity contract does not apply.
      return roundedRect(w, h, Math.min(w, h) / 2);
    }
    const unit = genShape(1, 1);
    const b = unit.bounds();
    const bw = b.max[0] - b.min[0];
    const bh = b.max[1] - b.min[1];
    if (!(bw > 1e-6 && bh > 1e-6)) return roundedRect(w, h, Math.min(w, h) * 0.22);
    const centred = track(unit.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]));
    return track(centred.scale([w / bw, h / bh]));
  };

  let plate: Section;
  if (fixed) {
    /* The plate is the box the user asked for, less what the body adds around it. The artwork
       is then fitted INSIDE the plate, which is the whole feature: forty names produce one
       size instead of forty. */
    const pw = Math.max(1, fixed.w - 2 * plateInset);
    const ph = Math.max(1, fixed.h - 2 * plateInset);
    plate = shapeInBox(pw, ph);

    /* Largest artwork that still sits inside the frame — a search rather than a division,
       because on a heart, a star or an egg the inscribed rectangle is nowhere near the
       bounding box. Getting it wrong would not spill over the frame (the inlay loop clips
       every colour to `imageArea`); it would silently CROP the design, which is worse. */
    const artFits = (k: number): boolean => {
      // Centred, not at the nudge: a moved design keeps its size and is cropped by the
      // frame, the same rule as the preset branch below. Shrinking it to fit where it was
      // pushed made "move" change the size, which is what was reported as wrong.
      const rect = track(CrossSection.square([nW * k + 2 * border, nH * k + 2 * border], true));
      return sectionIsEmpty(track(rect.subtract(plate)));
    };
    let lo = 0;
    let hi = Math.max(pw, ph) / Math.max(1e-3, Math.min(nW, nH)) + 1;
    if (artFits(hi)) {
      lo = hi; // the whole box fits already; nothing to search for
    } else {
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (artFits(mid)) lo = mid;
        else hi = mid;
      }
    }
    sR = Math.max(0.5, lo);
    imgW = nW * sR;
    imgH = nH * sR;
    if (lo < 0.5) {
      warnings.push(
        `A ${fixed.w.toFixed(0)} × ${fixed.h.toFixed(0)} mm base leaves no room for the design `
        + 'once the frame is taken off it. Increase the fixed size.',
      );
    } else if (sR < imageScale * 0.995) {
      warnings.push(
        `Design scaled down to fit the fixed ${fixed.w.toFixed(0)} × ${fixed.h.toFixed(0)} mm `
        + 'base. Size does nothing while a fixed size is set.',
      );
    }
  } else if (params.baseShape === 'outline') {
    /* Make the artwork big enough to hold the switch, before the plate is built from it.

       The base follows the artwork, so when the artwork is smaller than the switch's clear
       column there is nowhere for the column to go and the build welds a rectangular lobe onto
       the well to make room. That lobe is the box: a slab across the back of a bat, wings
       either side of a potion.

       The check this replaces asked whether the artwork's BOUNDING BOX short side cleared
       `minCap`. For anything that is not a rectangle that says almost nothing — a bat's
       bounding box is mostly wing-tip and air, so it passed at a size where a 18.5 mm square
       could not fit anywhere inside the bat at all.

       So the real question gets asked: does the column fit inside the plate. Measured on the
       Halloween pack at the default 35 mm, four of fifteen designs needed a bigger size — bat
       50, potion 48, witch hat 46, candy corn 36 — and the other eleven were already clear and
       are untouched by this, because the loop exits on its first test.

       At most `SIZE_TRIES` plate builds, and only for a design that fails: the first test is
       the one every well-proportioned design passes. */
    let outlineScale = sR;
    const plateAt = (scale: number): Section => {
      const prev = sR;
      sR = scale;
      const p = track(removeHoles(track(filledOutline().offset(border, 'Round', 2.0, 32)))
        .offset(4, 'Round', 2.0, 8)).offset(-4, 'Round', 2.0, 8);
      sR = prev;
      return simp(track(p), 0.05);
    };
    const columnFitsAt = (scale: number): boolean => {
      const cap = grow(plateAt(scale), tol);
      const col = roundedRect(switchClear, switchClear, 2.5);
      return sectionArea(track(col.subtract(cap))) <= OVERHANG_OK;
    };
    if (!columnFitsAt(outlineScale)) {
      // Geometric steps, not linear: the shortfall is a ratio, and 12% a step reaches double
      // the size in six tries — past the worst case measured (the bat, at 1.43x).
      let found = 0;
      for (let i = 1; i <= SIZE_TRIES; i++) {
        const cand = sR * Math.pow(1.12, i);
        if (columnFitsAt(cand)) { found = cand; break; }
      }
      if (found > 0) {
        sR = found;
        imgW = nW * sR;
        imgH = nH * sR;
        grewForSwitchMm = Math.max(imgW, imgH) + 2 * border;
      }
      outlineScale = sR;
    }
    void outlineScale;
    const rawPlate = track(filledOutline().offset(border, 'Round', 2.0, 32));
    const solidPlate = removeHoles(rawPlate);
    // Apply morphological closing (+offset followed by -offset) to smooth out
    // deep scalloped indentations between letters. This prevents the clicker
    // from binding or sticking due to excessive friction in the sharp valleys.
    // Then simplify: the round closing fills perimeter arcs with hundreds of points
    // that every later op would carry — collapse them to a print-invisible tolerance.
    const smoothingRadius = 4.0;
    plate = simp(track(solidPlate.offset(smoothingRadius, 'Round', 2.0, 24).offset(-smoothingRadius, 'Round', 2.0, 24)), 0.05);
  } else {
    // The geometric shapes scale linearly with their radius, so rather than guessing
    // a circumscribing radius (which clips the image on concave shapes like the star
    // or heart), we scale the shape up just enough that the whole image PLUS the
    // border frame fits inside it.
    // Rectangle (half-extents) that must sit inside the plate: image + border, with a
    // floor so tiny images still produce a sensible cap.
    const halfW = Math.max(imgW / 2 + border, minCap / 2);
    const halfH = Math.max(imgH / 2 + border, minCap / 2);
    const unit = genShape(1, rectAspect); // test the image rect against the r = 1 shape
    const fits = (k: number): boolean => {
      /* The rect sits at the CENTRE, not where the nudged design sits.

         It used to follow the nudge, so the base grew just enough to keep covering the moved
         artwork. That read as a bug — "when we move the design the size increases, this just
         seems wrong" — because nudging is a request to move the picture, not to change the
         part. The base now keeps the size it has, and whatever the nudge pushes past the
         frame is cropped by `imageArea`, the same way Design size above 100% crops. */
      const rect = track(CrossSection.square([(2 * halfW) / k, (2 * halfH) / k], true));
      const outside = track(rect.subtract(unit));
      return sectionIsEmpty(outside);
    };
    /* Bracket an upper bound that fits, then binary-search the smallest radius.

       THE CAP IS NOT DECORATION. `fits(hi)` asks whether the artwork rectangle sits inside the
       shape; for a shape that is thin or open — a glyph, an icon silhouette, a narrow custom
       ring — the answer can be NO at every size, because growing a thin shape grows the gap
       too. Unclamped, `hi *= 2` forty times is a factor of 10^12: a real thin glyph produced a
       plate measured in billions of millimetres, and the failure is not a crash but a build
       that appears to hang and then emits a model no slicer can open.

       Sixty-four doublings' worth of headroom is far more than any solid shape needs (all nine
       that shipped before this converge in a handful), so this can only fire on a genuinely
       unsuitable outline — and when it does, it says so and falls back to something printable
       rather than to nothing. */
    let hi = Math.max(1, Math.hypot(halfW, halfH));
    const hiCap = hi * 64;
    let bracketed = true;
    for (let i = 0; i < 40 && !fits(hi); i++) {
      hi *= 2;
      if (hi > hiCap) { hi = hiCap; bracketed = false; break; }
    }
    if (bracketed && !fits(hi)) bracketed = false;

    let candidate: Section | null = null;
    if (bracketed) {
      let lo = 1e-3;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      candidate = genShape(hi, rectAspect);
      /* The iteration cap alone is not enough, and finding that out is the point of this
         check. A 40 × 1 mm sliver DOES eventually contain a 45 mm square — at about three
         metres across. That converges, stays inside the doubling cap, and emits a perfectly
         valid model nobody can print. So the real bound is physical, not numerical: the
         biggest plate we ship is the H2D at 350 × 320, and anything past 300 mm cannot be
         printed on any of them. */
      const b = candidate.bounds();
      const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
      if (!(span > 0) || span > MAX_PLATE_SPAN_MM) candidate = null;
    }

    if (candidate) {
      plate = candidate;
    } else {
      warnings.push(
        'That shape is too thin or too open to hold your design at a printable size, so a '
        + 'rounded rectangle was used instead. Pick a solider shape, or make the design smaller.',
      );
      plate = roundedRect(2 * halfW, 2 * halfH, Math.min(halfW, halfH) * cornerPct);
    }
  }

  /* Shrink the ARTWORK inside the base, leaving the base exactly the size it already was.

     This is the one point that works, and it has to be here rather than at either assignment
     of `sR`: the fixed-footprint branch above OVERWRITES `sR` outright from its own search, so
     anything multiplied in earlier is discarded and only the fixed path would be honoured.
     Here it is downstream of both, and upstream of `placeRings` — the only consumer that
     matters — while every plate-building consumer (`plate`, `imageArea`, `capFp`,
     `wellFootprint`, `bodyFootprint`, the switch clamp, the fixed-size honesty check) has
     already read the unscaled value. So the base keeps its size and the frame takes up the
     slack, which is what "make the design smaller" has to mean.

     `sR *= 1` is exact identity in IEEE-754, and `params.designScale ?? 1` makes every project
     saved before this control existed take that branch — so the default is byte-identical to
     what the app has always produced. */
  sR *= designScale;

  const imageArea = shrink(plate, border, plate); // flat frame around the image

  // --- Switch placement: 1..3 switches, each nudged/rotated off the design centre so
  //     it sits under solid material (a centred switch under a hollow part of the
  //     design forces the well and skirt to bulge out). Clamp every switch's clear
  //     column inside the cap footprint bbox — the plate is always ≥ `minCap`, so a
  //     valid range exists on both axes — then enforce a minimum centre-to-centre
  //     pitch so multiple sockets never overlap. The applied array is reported back so
  //     the preview switch meshes match the geometry.
  const plateBB = plate.bounds();
  const halfCol = switchClear / 2;
  const loX = plateBB.min[0] + halfCol;
  const hiX = plateBB.max[0] - halfCol;
  const loY = plateBB.min[1] + halfCol;
  const hiY = plateBB.max[1] - halfCol;
  const clampAxis = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  const clampX = (v: number) => clampAxis(v, loX, hiX);
  const clampY = (v: number) => clampAxis(v, loY, hiY);

  const requested = (params.switches?.length ? params.switches : [{ x: 0, y: 0, rotation: 0 }]).slice(0, 3);
  const applied: SwitchPlacement[] = requested.map((sw) => ({
    x: clampX(sw.x ?? 0),
    y: clampY(sw.y ?? 0),
    rotation: sw.rotation ?? 0,
  }));

  /* NOT auto-moved, and the reason is worth keeping.

     The comment above has claimed since it was written that each switch is "nudged off the
     design centre so it sits under solid material". It never was — the code clamps to the
     plate's BOUNDING BOX, which for anything that is not a rectangle says almost nothing, a
     bat's bounding box being mostly wing-tip and air.

     Moving it properly was built and measured, and it worked: walking from the centre toward
     the footprint's pole of inaccessibility cleared the candy corn by 6.8 mm and the witch hat
     by 9.2 mm without touching the size. It was removed anyway, because the identity-mark
     constellation is anchored to switch #0 at a radius of 10.5-12.5 mm (see `identityMark.ts`),
     so sliding the switch toward an edge slides the marks off it: the potion went from four of
     four marks buried to three. Invariant #2 outranks a cosmetic bulge.

     Growing the border below fixes the same four designs, keeps the switch under the middle of
     the artwork where a thumb lands, and leaves every design that was already fine untouched. */
  // Enforce a minimum centre-to-centre pitch (≈16 mm for MX): push the later switch
  // of any too-close pair away along the axis of largest separation, then re-clamp.
  // Two passes settle a 3-switch row; it's a heuristic, not a physics solver.
  const SWITCH_PITCH_MIN = socketDim + 2.0;
  let pinched = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < applied.length; i++) {
      for (let j = i + 1; j < applied.length; j++) {
        const a = applied[i];
        const b = applied[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.hypot(dx, dy) < SWITCH_PITCH_MIN) {
          pinched = true;
          if (Math.abs(dx) >= Math.abs(dy)) {
            b.x = clampX(a.x + (dx < 0 ? -1 : 1) * SWITCH_PITCH_MIN);
          } else {
            b.y = clampY(a.y + (dy < 0 ? -1 : 1) * SWITCH_PITCH_MIN);
          }
        }
      }
    }
  }
  if (pinched && requested.length > 1) {
    warnings.push('Switches were pulled together to fit the cap. Increase Size for more room.');
  }

  // Stem fit: move the cross socket INSIDE the cap's keycap-mount post without moving the
  // post itself.
  //
  // This used to scale the whole stem solid by a factor derived from its 7.9 mm outer bbox,
  // which is wrong twice over: it dragged the outer post along with the hole, and it meant the
  // ~1.2 mm slot that actually grips the switch moved about a seventh of the millimetres shown
  // on the control. A "+0.2 mm" press opened the slot 0.03 mm — under one extrusion width, so
  // every setting printed as the same part.
  //
  // Clipping fixes both. The stem is material (unioned into the cap at `base.add(st)`), so:
  //
  //   looser  (f > 1): the grown copy has a bigger hole — INTERSECT with the original to clip
  //                    the outside back to the post as authored.
  //   tighter (f < 1): the shrunk copy fills part of the hole — UNION with the original to keep
  //                    the outer profile as authored.
  //
  // Either way the outer footprint is exactly `stem`, so `stemBB` — which drives the Z stack at
  // `slabBottomZ` / `skirtBottomZ` — stays valid and the cap's rest height cannot move. Z is
  // never scaled. The worker hands the stem to us XY-centred, so scaling about the origin
  // scales about its own centre. Computed once and reused for every switch placement.
  let stemSized: Solid = stem;
  const stemFit = params.stemFitPct ?? 0;
  if (Math.abs(stemFit) > 0.01) {
    const f = 1 + stemFit / 100;
    const scaled = track(stem.scale([f, f, 1]));
    stemSized = track(f > 1 ? scaled.intersect(stem) : scaled.add(stem));
  }

  // The cached socket/stem solids are owned by the worker — rotate/translate into
  // tracked copies rather than mutating or freeing them. Rotation spins the whole
  // switch assembly (socket + stem + its clear column) about the axis, so the socket
  // cut and the cap's stem stay mutually aligned at any angle.
  const placeSolidAt = (s: Solid, sw: SwitchPlacement): Solid => {
    const r = Math.abs(sw.rotation) > 0.001 ? track(s.rotate([0, 0, sw.rotation])) : s;
    return Math.abs(sw.x) > 0.001 || Math.abs(sw.y) > 0.001 ? track(r.translate([sw.x, sw.y, 0])) : r;
  };
  const socketAts: Solid[] = applied.map((sw) => placeSolidAt(socketSized, sw));
  const stemAts: Solid[] = applied.map((sw) => placeSolidAt(stemSized, sw));

  // Well = cap footprint (slip-fit) UNIONED with a guaranteed clear column over EACH
  // switch, so a concave outline or small cap can never wall off a socket. The body
  // border then wraps whatever shape the well becomes — it bulges out only where a
  // notch would otherwise block a switch. Each column rotates with its switch so its
  // clearance stays aligned even at an angle.
  const socketColumnBase = roundedRect(switchClear, switchClear, 2.5);
  const capFp: Section = grow(plate, tol); // cap slips in with `tol`


  let wellFp: Section = capFp;
  for (const sw of applied) {
    const col = track(
      (Math.abs(sw.rotation) > 0.001 ? track(socketColumnBase.rotate(sw.rotation)) : socketColumnBase)
        .translate([sw.x, sw.y]),
    );
    wellFp = track(wellFp.add(col));
  }
  // If a column reached outside the cap footprint the body border wraps it, and the base grows
  // a rounded lobe that is nowhere in the artwork. That is the "what is this oval, it's there
  // even with the keychain off" report — the keychain loop is gated further down and is not the
  // culprit. This is the only place that knows it happened, so say so rather than leaving people
  // to guess. Threshold rather than "non-empty": a square column against a curved cap always
  // pokes out by a sliver, and a sliver is not what anyone photographs.
  const bulgeArea = sectionArea(track(wellFp.subtract(capFp)));
  // Simplify the well far more finely than anything else in the build. `simplify(eps)`
  // may move a boundary by up to eps in EITHER direction, and this is the one outline
  // that has to stay parallel to another: the cap rides inside it with only `tol` to
  // spare. At the default 0.04 the well drifted independently of the plate it was grown
  // from, so the gap wandered around the perimeter instead of staying at `tol` — the
  // halves read as misaligned and the skirt rubbed on whichever side lost clearance.
  // 0.004 keeps that error under 1% of the gap while still collapsing the collinear runs
  // the offset leaves behind.
  const wellFootprint = simp(wellFp, 0.004);

  /* Growing the BORDER was tried here and thrown away — worth recording so it is not retried.

     The idea was to build the body from the cap footprint thickened until the column was
     buried, rather than from the well, so the outline stayed the design's shape. Measured from
     underneath it looked right, and it was verified from underneath, which was the mistake:
     the box lives on the TOP face. The well still had the column unioned into it, so the
     rectangular lobe was still there in the cavity around the cap — visible in the render as a
     grey rectangle behind the artwork — and the body was now a bloated blob as well. Worse on
     one axis, no better on the other.

     The size search above is the fix, because the box only exists when the artwork is too
     small to contain the column at all. Make it big enough and there is nothing to hide. */
  const bodyFootprint = simp(grow(wellFootprint, borderW));
  if (bulgeArea > OVERHANG_OK && !grewForSwitchMm) grewForSwitchMm = -1;

  /* A fixed footprint is a PROMISE about the finished part, so check it rather than assume it.
     The switch's clear column is unioned into the well after the plate is built, and on a round
     or pointed shape at a tight size it reaches outside — which grows the body past the box the
     user typed. That is the one failure mode that would quietly ship a run of SKUs whose real
     size is not the one in the listing, so name the size actually produced. */
  if (fixed) {
    const bb = bodyFootprint.bounds();
    const gotW = bb.max[0] - bb.min[0];
    const gotH = bb.max[1] - bb.min[1];
    if (gotW > fixed.w + 0.3 || gotH > fixed.h + 0.3) {
      warnings.push(
        `The base came out ${gotW.toFixed(1)} × ${gotH.toFixed(1)} mm rather than the fixed `
        + `${fixed.w.toFixed(0)} × ${fixed.h.toFixed(0)} mm — the switch needs more room than `
        + 'this shape leaves at that size. Increase the fixed size, or use a square base.',
      );
    }
  }

  // --- Z layout (shared assembly frame: Z = 0 is the switch-plate top) ---
  const cavityFloorZ = socketBB.max[2]; // socket top = plate plane (≈ 0); the well opens to it
  const slabBottomZ = stemBB.max[2]; // cap underside = stem top = rest float above the plate
  const backing = Math.max(0.8, params.topThickness);
  const imageDepth = Math.max(0.2, params.imageDepth);
  const slabTopZ = slabBottomZ + backing + imageDepth; // flat image surface (top)
  const imageBottomZ = slabBottomZ + backing; // colors live above this
  const travel = Math.max(0, params.travel);

  // The body border top sits `capProud` below the cap top, so pressing the cap down
  // by `travel` brings its top flush with the border (rest = a proud pressable button;
  // full press = flush). capProud ≈ travel.
  const bodyBottomZ = socketBB.min[2] - params.floorThickness;
  const maxProud = Math.max(0.4, slabTopZ - cavityFloorZ - 1.0); // leave ≥1 mm of border
  const capProud = Math.max(0.4, Math.min(params.capProud, maxProud));
  const bodyTopZ = slabTopZ - capProud;
  const wellFloorZ = Math.min(cavityFloorZ, slabBottomZ - travel);

  // Cap skirt: a thin wall hanging from the cap perimeter down into the well.
  // The bottom of the skirt (the border of the top part) aligns exactly with the bottom
  // of the stem so that the top part can stand completely flat on a table.
  const skirtThickness = 1.4;
  const skirtBottomZ = stemBB.min[2];
  const skirtLen = slabBottomZ - skirtBottomZ;

  // The skirt is deliberately a PLAIN full-height wall: constant outer profile from the
  // cap plate to its bottom face, so the top part has one clean silhouette with no step
  // in it anywhere.
  //
  // Tried and rejected (2026-08-16): relieving the lower skirt by 0.3 mm so only a short
  // band near `bodyTopZ` kept the nominal fit, to stop the wall scraping over the full
  // travel. It works mechanically, but the band's bottom edge reads as a lip around the
  // underside of the cap in the slicer and the exploded view, which is not worth it. A
  // continuous draft (full size at the plate, tapering in toward the bottom) would get
  // the same relief with no step, and is the thing to build if the scraping needs more
  // than the uniform-gap fix above — a stacked loft, since manifold's `scaleTop` pivots
  // about a point and will not hold a constant width on a heart or a star.

  const extrudeAt = (cs: Section, h: number, z: number): Solid => {
    if (sectionIsEmpty(cs)) {
      // Return a tiny cube far away or hidden inside, to avoid typing issues or we can just try to avoid calling it
      // Actually, Manifold handles empty cross sections by returning an empty solid IF we don't crash.
      // Wait, Manifold.extrude DOES crash on empty CrossSection. 
      // Let's create a tiny solid and subtract it from itself to get a true empty solid.
      const dummy = track(track(Manifold.extrude(track(CrossSection.circle(0.1, 3)), 0.1)).translate([0, 0, z]));
      return track(dummy.subtract(dummy));
    }
    return track(track(Manifold.extrude(cs, Math.max(0.01, h))).translate([0, 0, z]));
  };

  // Build the solid to SUBTRACT from a part to bevel (chamfer) one of its horizontal
  // edges, as a single-face true chamfer via scaled extrusion — no stepped staircase,
  // so it stays cheap. `outer` grows the cutter past the wall so it never shares a
  // coplanar face with it (coplanar faces z-fight in the preview).
  //
  // (The old per-step fillet path was removed: only the default fixed chamfers run now,
  // so anything non-'none' is treated as a chamfer.)
  const createEdgeBevelBlock = (footprint: Section, r: number, _style: EdgeStyle, zRef: number, isBottom: boolean): Solid | null => {
      const outer = grow(footprint, 0.6); // extends the cutter just beyond the wall

      const b = footprint.bounds();
      const W = b.max[0] - b.min[0];
      const H = b.max[1] - b.min[1];
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;

      const scaleX = W > 0.01 ? Math.max(0.01, (W - 2 * r) / W) : 1;
      const scaleY = H > 0.01 ? Math.max(0.01, (H - 2 * r) / H) : 1;

      // Center the 2D sections so extrude's scaleTop pivots about the footprint center.
      const centeredOuter = track(outer.translate([-cx, -cy]));
      const centeredFp = track(footprint.translate([-cx, -cy]));

      const boundingVolume = track(Manifold.extrude(centeredOuter, r + 0.02));
      const partVolume = track(Manifold.extrude(centeredFp, r + 0.02, 0, 0, [scaleX, scaleY]));

      let cutter = track(boundingVolume.subtract(partVolume));
      cutter = track(cutter.translate([cx, cy, 0]));

      if (isBottom) {
        // Mirror along Z so the chamfer slopes outwards toward the bottom face.
        cutter = track(
          cutter.translate([0, 0, -(r + 0.02) / 2])
            .scale([1, 1, -1])
            .translate([0, 0, (r + 0.02) / 2]),
        );
      }

      const stepZ = isBottom ? zRef - 0.02 : zRef - r;
      return track(cutter.translate([0, 0, stepZ]));
  };

  const parts: ClickerPart[] = [];

  // --- Cap plate (backing + image layer), flat top, + stem underneath ---
  const cap: Solid = extrudeAt(plate, backing + imageDepth, slabBottomZ);

  // --- Image inlays: carved non-overlapping, smallest coverage first so detail
  //     colors win at shared boundaries. Clean even when all colors are flat.
  //     topSlab is exactly `imageDepth` tall so inlays end flush with the cap's
  //     top face (slabTopZ) — the top reads as ONE flat surface, not raised. ---
  const ordered = regions
    .map((r) => ({ r }))
    .sort((a, b) => (a.r.coverage ?? 1) - (b.r.coverage ?? 1));
    
  let placed2D: Section | null = null; // 2D union of inlays already carved (no overlap)
  const holesByLevel = new Map<number, Section>();

  for (const { r } of ordered) {
    const validRings = placeRings(r.rings).filter(ring => ring.length >= 3 && getRingArea(ring) > 0.001);
    if (validRings.length === 0) continue;
    let cs: Section = simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
    // Text boldness: fatten (or thin) the glyph in the plane, the same way a block legend
    // is. Thinning can erase a hairline stroke entirely; the empty check below drops it.
    const textBold = params.textBold ?? 0;
    if (Math.abs(textBold) > 0.005) cs = track(cs.offset(textBold, 'Round', 2.0, 24));
    if (params.colorBleed > 0.001) cs = grow(cs, params.colorBleed);
    const clipped = track(cs.intersect(imageArea));
    if (sectionIsEmpty(clipped)) continue;
    
    // Prevent overlapping with smaller parts processed earlier
    let fp = clipped;
    if (placed2D) fp = track(fp.subtract(placed2D));
    if (sectionIsEmpty(fp)) continue;
    
    placed2D = placed2D ? track(placed2D.add(fp)) : fp;

    const level = params.componentHeights?.[r.partName] ?? 0;
    const heightShift = level * params.stepHeight;
    const topZ = slabTopZ + Math.max(0, heightShift);
    const bottomZ = imageBottomZ + Math.min(0, heightShift);
    
    let inlay: Solid = extrudeAt(fp, topZ - bottomZ, bottomZ);
    if (inlay.isEmpty()) continue;

    // Round (fillet) or bevel (chamfer) the TOP edge of this color part. Two sources:
    //   1. An explicit per-part entry configured in Edges mode (takes priority).
    //   2. The global "Chamfer edges" toggle from Extrude mode — a fixed chamfer on
    //      EVERY raised part, not tied to any selection.
    // Default (neither): no rounding on inlays — only the outer cap frame + body edges.
    const es = params.edgeSettings?.find(s => s.target === r.partName);
    let edgeStyle: EdgeStyle | null = null;
    let edgeRadius = 0;
    if (es && es.style !== 'none' && es.radius >= 0.05) {
      edgeStyle = es.style;
      edgeRadius = es.radius;
    } else if (params.extrudeChamfer && heightShift > 0) {
      // Global toggle: bevel the top edge of every RAISED color part only. Parts you
      // haven't touched (level 0, flush with the cap top) are left sharp — the chamfer
      // is meant for the relief you extrude up in Extrude mode.
      edgeStyle = 'chamfer';
      edgeRadius = 0.5;
    }
    if (edgeStyle) {
      // The bevel can't exceed roughly half the part's height, so on a flat color
      // layer it stays subtle; extrude the part first for a bigger fillet.
      const radius = Math.min(edgeRadius, (topZ - bottomZ) * 0.49, 3.0);
      if (radius >= 0.05) {
        const modBlock = createEdgeBevelBlock(fp, radius, edgeStyle, topZ, false);
        if (modBlock) inlay = track(inlay.subtract(modBlock));
      }
    }

    parts.push(toPart(inlay, 'cap', 'top', r.filamentRgb, r.partName));
    
    // Group the 2D footprint by its level to carve a single hole per height level
    const existing = holesByLevel.get(level);
    holesByLevel.set(level, existing ? track(existing.add(fp)) : fp);
  }

  // Base-color cap = plate − holes, then ∪ stem ∪ perimeter skirt.
  let base: Solid = cap;
  for (const [level, hole2D] of holesByLevel.entries()) {
    const heightShift = level * params.stepHeight;
    const bottomZ = imageBottomZ + Math.min(0, heightShift);
    const holePrism = extrudeAt(hole2D, slabTopZ - bottomZ + 0.02, bottomZ - 0.01);
    base = track(base.subtract(holePrism));
  }
  for (const st of stemAts) base = track(base.add(st));
  if (skirtLen > 0.4) {
    // Root issue: any 2-D ring-minus-stemZone is algebraically identical to
    // punching a notch in the border. The only notch-free approach is to ensure
    // the skirt base plate's outer edge is already OUTSIDE the stem zone, so no
    // material ever needs to be removed.
    //
    // Strategy: expand the skirt plate outward by unioning it with a rounded rect
    // that is (12 + 2×skirtThickness) wide — guaranteeing the ring's INNER edge
    // sits exactly at the 12 mm stem-clear boundary. The ring outer edge is wherever
    // the original plate or this guard square is larger (whichever is further out).
    // No subtraction → no notch → continuous border.
    //
    // Z flush: where skirtBasePlate exceeds the original cap plate we add a thin
    // backing fill so the skirt top has something solid above it (no ledge/gap).
    const stemGuard = 12 + 2 * skirtThickness; // inner edge lands exactly at ±6 mm around each stem
    let skirtBasePlate: Section = plate;
    for (const sw of applied) {
      const stemGuardCs = track(track(CrossSection.square([stemGuard, stemGuard], true)).translate([sw.x, sw.y]));
      skirtBasePlate = track(skirtBasePlate.add(stemGuardCs));
    }
    const skirtInner = track(skirtBasePlate.offset(-skirtThickness, 'Miter', 2.0));
    if (!sectionIsEmpty(skirtInner)) {
      const skirtRing = track(skirtBasePlate.subtract(skirtInner));
      // +0.3 overlaps up into the plate so the union is volumetric (no coplanar seam).
      const skirt = extrudeAt(skirtRing, skirtLen + 0.3, skirtBottomZ);
      base = track(base.add(skirt));
      // Fill any area where skirtBasePlate extends beyond the original cap plate,
      // at the cap-underside level, so the skirt top is flush (no Z gap or step).
      const skirtExtension = track(skirtBasePlate.subtract(plate));
      if (!sectionIsEmpty(skirtExtension)) {
        // Extend the fill all the way from the skirt bottom to the cap top face
        // so the expanded area is level with the top surface — no step, no ledge.
        const capFill = extrudeAt(skirtExtension, slabTopZ - skirtBottomZ, skirtBottomZ);
        base = track(base.add(capFill));
        // Running the fill to `slabTopZ` puts it on the PRINTED FACE: a blank base-colour lobe
        // appended to the user's artwork. It is load-bearing (the skirt needs something solid
        // above it) so it is not simply removable here, but it is the thing people screenshot,
        // and silently altering someone's picture is worse than explaining it.
        if (sectionArea(skirtExtension) > 2) {
          warnings.push(
            'The top was widened around the switch, so a plain patch shows on the design. Increase Size, or move the switch, to clear it.',
          );
        }
      }
    }
  }
  parts.unshift(toPart(base, 'cap', 'top', params.baseFilamentRgb, 'top-base'));

  // --- Body: solid block − well − socket. The well is the cup the cap presses into;
  //     the border ring around it frames the proud cap (and the cap's skirt hides the
  //     gap). The socket is cut into the well floor (= plate plane) to grip the switch. ---
  const bodyBlock = extrudeAt(bodyFootprint, bodyTopZ - bodyBottomZ, bodyBottomZ);
  const well = extrudeAt(wellFootprint, bodyTopZ - wellFloorZ + 1, wellFloorZ);
  let body: Solid = bodyBlock;

  // Apply edge modifications (fillet / chamfer) to the body block first,
  // before adding the keychain loop and bridge, so that the bevel block
  // subtraction does not cut a groove through the keychain loop/bridge.
  body = applyEdges(body, params.edgeSettings, bodyFootprint, bodyBottomZ, bodyTopZ, wellFloorZ);

  // Optional keychain attachment: a loop tab or an inside hole, placed anywhere around
  // the body edge. Built and cut BEFORE the well/socket subtraction so a loop rotated
  // near the well never leaves floating material.
  const kc = params.keychain;
  if (kc && kc.enabled) {
    const holeR = Math.max(1.5, (kc.holeDiameterMm ?? 5.2) / 2);
    const th = Math.max(2.5, Math.min(4.0, (bodyTopZ - bodyBottomZ) * 0.35));
    const zb = bodyBottomZ;
    const { p, dir } = edgePointAt(bodyFootprint, kc.angleDeg ?? 90);

    // Apply offsetMm by shifting the base point p along the tangent vector (perpendicular to
    // dir). Sign chosen so that at the default bearing (90°, the top of the body) a POSITIVE
    // offset moves the loop to the viewer's right — the arrow stepper in the sidebar says
    // "right", and the first version of this moved it left.
    const tangent: [number, number] = [dir[1], -dir[0]];
    const px = p[0] + tangent[0] * (kc.offsetMm ?? 0);
    const py = p[1] + tangent[1] * (kc.offsetMm ?? 0);

    // Apply the body's own edge ('clickerBase') bevel to a keychain add-on footprint
    // so it reads as one piece with the body, not a bolt-on.
    const bodyEdge = params.edgeSettings?.find(
      (s) => (s.target === 'clickerBase' || s.target === 'baseTop') && s.style !== 'none' && s.radius >= 0.05,
    );
    const bevelAddon = (solid: Solid, fp: Section, top: number, bottom: number): Solid => {
      if (!bodyEdge) return solid;
      const r = Math.min(bodyEdge.radius, (top - bottom) * 0.45, 2.5);
      if (r < 0.05) return solid;
      let out = solid;
      const topBlock = createEdgeBevelBlock(fp, r, bodyEdge.style, top, false);
      if (topBlock) out = track(out.subtract(topBlock));
      const botBlock = createEdgeBevelBlock(fp, r, bodyEdge.style, bottom, true);
      if (botBlock) out = track(out.subtract(botBlock));
      return out;
    };

    // Loop style: a disc tab with a ring hole, built in a local frame (+Y outward)
    // then rotated to the requested angle and moved onto the body edge point.
    // The loop center is placed a full radius beyond the edge so the ENTIRE circle
    // sits outside the body outline — no overhang wall. The bridge rectangle
    // connects the loop back into the body, extending deep to avoid gaps on concave curves.
    const loopR = Math.max(3.2, holeR + 1.8);
    const outward = loopR; // full radius → circle just touches the body edge
    // `track()` on the outside only frees what `translate` RETURNED; the circle it was
    // translated from is its own WASM object and nothing deleted it. Same shape of leak at
    // every constructor-then-transform below — small each time, and this runs on every
    // keystroke in a worker that never restarts.
    const localLoop = track(track(CrossSection.circle(loopR, 64)).translate([0, outward]));
    // Bridge from the body edge into the back of the loop circle, going deep
    const bridgeH = outward + loopR * 3.5;
    const localBridge = track(
      track(CrossSection.square([loopR * 2, bridgeH], true)).translate([0, outward - bridgeH / 2]),
    );
    let localFp: Section = track(localLoop.add(localBridge));
    const rotDeg = (kc.angleDeg ?? 90) - 90;
    if (Math.abs(rotDeg) > 0.001) localFp = track(localFp.rotate(rotDeg));
    const loopFootprint = track(localFp.translate([px, py]));

    let loop = extrudeAt(loopFootprint, th, zb);
    loop = bevelAddon(loop, loopFootprint, zb + th, zb);
    body = track(body.add(loop));

    // Ring hole at the transformed loop centre (local [0, outward] → world).
    const rr = (rotDeg * Math.PI) / 180;
    const hcx = -outward * Math.sin(rr) + px;
    const hcy = outward * Math.cos(rr) + py;
    const hole = extrudeAt(track(track(CrossSection.circle(holeR, 48)).translate([hcx, hcy])), th + 2, zb - 1);
    body = track(body.subtract(hole));
  }

  // Subtract the well and every socket afterwards to ensure the interior cavity is clean
  body = track(body.subtract(well));
  for (const sk of socketAts) body = track(body.subtract(sk));

  /* Hollow the underside.

     Most of a 60-70 mm body is solid plastic doing nothing, which a user measured, fixed by hand
     in Fusion 360, and posted screenshots of. What is left is a shell: a floor, a wall, and the
     switch pillar.

     THE CAVITY IS OPEN INTO THE WELL, and that is the whole point of the current shape. The
     first version of this was a sealed box — a floor under it, a 1.6 mm lid over it, walls all
     round, and nothing connecting it to the outside. The base prints underside-down (plateLayout
     seats the base group on Z=0 by its own minimum and never flips it), so that lid was a
     1.6 mm BRIDGE OVER OPEN AIR across most of the footprint, on a part that gets clicked
     thousands of times. It also trapped whatever sparse infill the slicer left in a void nothing
     could reach. Ian reported it as "it's still leaving the top face, which is creating failure
     points", and he was right.

     Opening it DOWNWARD would not have fixed it — the lid still has to bridge. Opening it upward
     into the well does: the well is already a large open cup cut from `wellFloorZ` to `bodyTopZ`,
     so merging the two leaves one continuous void from the bottom floor straight out of the top
     and nothing spans air at any layer.

     Two edits make that happen and they are NOT independent — raising the ceiling alone leaves a
     0.4 mm-wide, zero-height undercut ring where the old cavity poked outboard of the well, and
     narrowing the footprint alone just makes the shell heavier:
       • `cavityTopZ` = `wellFloorZ` exactly, so there is no lid.
       • `cavityFp` ⊆ `wellFootprint`, so the ceiling plane and the boundary both coincide with
         the well's and the two removed volumes merge into one.
     Measured on a 60 mm base: 100 mesh vertices on the old lid plane become 0, and the material
     removed goes from 48.5% to 60.3%.

     Three things stay solid, and each is load-bearing rather than cautious:

      - A ring around every switch. The socket is cut into the well floor and the switch bottoms
        out against it on every click; that column is the load path and hollowing it is how a
        clicker fails after a week rather than in the slicer.
      - The keychain lobe, which is welded on further down and needs material to weld to.
      - The band the identity voids occupy. `voidClearR` already pushes them outboard of the
        pocket, so the inset alone does not protect them - the cavity's OUTER edge has to stay
        inboard of them too, which is what `voidBandInner` below is for.

     Done BEFORE the void loops so their buried test sees the final shape: a cavity that would
     swallow a void makes the counter report it instead of erasing it silently. */
  if (params.hollowBase) {
    // 1.6 mm of wall and floor. CLAUDE.md's printability numbers put the minimum at 1.2 mm and
    // 1.5 mm for parts that get handled; a clicker is handled constantly, so this is the floor
    // of the range and not the middle of it.
    const WALL = 1.6;
    const FLOOR = 1.6;
    /* Keep the cavity OUTBOARD of the identity voids.
       
       The first cut of this had it the other way round — cavity inside the void band, switch
       column punched out — and removed exactly nothing, because the two regions do not overlap:
       the voids sit just outside the pocket (r about 9-11), and the pocket keep-out reaches
       8.97, so "inside the voids AND outside the pocket" is an empty annulus. The solid part of
       a clicker is its CENTRE — the switch column and the void ring around it — and the material
       worth removing is the plate outside all of that. */
    const voidBandOuter = Math.max(
      ...[...markVoids(getMarkSeed() || 'x'), ...hardcodedVoids()].map(
        (v) => Math.max(v.r, voidClearR(v.d, (v.thetaDeg * Math.PI) / 180)) + v.d / 2 + 0.3,
      ),
    );
    // No lid: the ceiling IS the well floor, so the two voids are one.
    const cavityTopZ = wellFloorZ;
    const cavityBottomZ = bodyBottomZ + FLOOR;
    if (cavityTopZ - cavityBottomZ > 0.6) {
      /* The well's own footprint, clamped to leave at least WALL of shell.

         `wellFootprint` alone would hand the wall thickness to `borderW`, and
         `borderW = Math.max(0.4, params.borderWidth)` permits 0.4 mm — a single extrusion
         width, against this block's own comment citing a 1.2/1.5 mm floor. The shipped app
         passes 2.6 and 3.5 so it would never bite today, but nothing enforces that and a
         future caller would get a shell wall it never asked for. Intersecting keeps the
         guarantee `shrink(bodyFootprint, WALL)` used to provide.

         Measured rim-to-rim at cap 60: without the clamp, borderWidth 0.4 gives a 0.4 mm
         wall; with it, never below 1.6. */
      let cavityFp: Section = track(
        wellFootprint.intersect(shrink(bodyFootprint, WALL, bodyFootprint)),
      );
      // One solid column per switch, wide enough to carry the socket, the load path under it and
      // the whole void ring. Whichever of those reaches furthest sets the radius.
      const columnR = Math.max(sbbHalf + 1.2, voidBandOuter);
      for (const sw of applied) {
        const keepOut = track(track(CrossSection.circle(columnR, 64)).translate([sw.x, sw.y]));
        cavityFp = track(cavityFp.subtract(keepOut));
      }
      if (!sectionIsEmpty(cavityFp)) {
        /* 0.004, not the default 0.04 — the same number and the same reason as `wellFootprint`
           itself. `simplify(eps)` may move a boundary by up to eps in EITHER direction, and
           this cavity now SHARES its outer boundary with the well. At the default, a 0.04 mm
           outward drift becomes a visible undercut ledge in the bezel's inner face. It did not
           matter while the cavity sat 1.6 mm below the well and 0.4 mm outboard of it. */
        const cavity = extrudeAt(simp(cavityFp, 0.004), cavityTopZ - cavityBottomZ, cavityBottomZ);
        body = track(body.subtract(cavity));
      } else {
        warnings.push('This clicker is too small to hollow — the base stayed solid.');
      }
    } else {
      warnings.push('This clicker is too thin to hollow — the base stayed solid.');
    }
  }

  /* How many identity voids were attempted, and how many actually landed.
     Both loops below skip a sphere that is not fully buried, which is right — a void
     breaking the surface would be visible on a print, and invariant #2 says the mark is
     never visible. What was wrong was the SILENCE: any change that removes the material
     the voids sit in erases the watermark with nothing anywhere to say so. Hollowing the
     base and the underside brand mark both do exactly that, so this counts. */
  let marksAttempted = 0;
  let marksLanded = 0;


  // Covert identity mark: subtract a seeded void constellation anchored to switch #0's
  // socket, buried in the always-solid ring (invisible on prints, visible in a slicer
  // section view). Only active when VITE_MARK_SEED is set (deployed build); dev builds
  // skip this tier. Each void is subtracted only if fully buried, so it can never pierce
  // a surface regardless of design/size/switch offset.
  const markSeed = getMarkSeed();
  if (markSeed && applied.length > 0) {
    const sw0 = applied[0];
    const rot0 = ((sw0.rotation ?? 0) * Math.PI) / 180;
    for (const v of markVoids(markSeed)) {
      const ang = (v.thetaDeg * Math.PI) / 180 + rot0;
      // Push out only if the authored radius could not clear the pocket. A void that already
      // clears keeps its exact position, so models generated before this still match.
      const vr = Math.max(v.r, voidClearR(v.d, (v.thetaDeg * Math.PI) / 180));
      const cx = sw0.x + vr * Math.cos(ang);
      const cy = sw0.y + vr * Math.sin(ang);
      const sphere = track(track(Manifold.sphere(v.d / 2, 16)).translate([cx, cy, v.z]));
      let buried = false;
      try {
        const inter = track(body.intersect(sphere));
        buried = inter.volume() >= sphere.volume() * 0.98;
      } catch {
        buried = false;
      }
      marksAttempted += 1;
      if (buried) {
        body = track(body.subtract(sphere));
        marksLanded += 1;
      }
    }
  }

  // Hardcoded watermark — always active, no secret needed. A second tier of identity
  // voids at a different radius/depth band (r 8–10, z -3.5...-1.5) so they never
  // overlap with the secret constellation above. Even if someone copies the source
  // and runs it without VITE_MARK_SEED, every model still carries these voids as
  // proof that it was generated by this codebase.
  if (applied.length > 0) {
    const sw0 = applied[0];
    const rot0 = ((sw0.rotation ?? 0) * Math.PI) / 180;
    for (const v of hardcodedVoids()) {
      const ang = (v.thetaDeg * Math.PI) / 180 + rot0;
      // Push out only if the authored radius could not clear the pocket. A void that already
      // clears keeps its exact position, so models generated before this still match.
      const vr = Math.max(v.r, voidClearR(v.d, (v.thetaDeg * Math.PI) / 180));
      const cx = sw0.x + vr * Math.cos(ang);
      const cy = sw0.y + vr * Math.sin(ang);
      const sphere = track(track(Manifold.sphere(v.d / 2, 16)).translate([cx, cy, v.z]));
      let buried = false;
      try {
        const inter = track(body.intersect(sphere));
        buried = inter.volume() >= sphere.volume() * 0.98;
      } catch {
        buried = false;
      }
      marksAttempted += 1;
      if (buried) {
        body = track(body.subtract(sphere));
        marksLanded += 1;
      }
    }
  }

  /* Maker's mark, debossed into the body's underside.

     WHERE, and why there. The underside is the one large, flat, unbroken, support-free face
     the geometry has: a solid plane at `bodyBottomZ` spanning the whole footprint. The well is
     only cut from `wellFloorZ` upward and the socket cut stops `floorThickness` above the
     underside, so nothing else breaks it.

     Three things bite here, and all three have already been paid for once:

      - DEBOSS, never emboss. `plateLayout` seats the base group on Z=0 by its own minimum, so
        anything protruding below the underside BECOMES the seating plane and tips a 41 mm part
        onto its logo. A recess is also the first layer, which is the sharpest surface FDM
        makes, and it needs no support.
      - MIRROR IN X. `plateLayout` flips only the `top` group; the base gets identity plus a Z
        seat. The underside is read from below, so an unmirrored mark prints backwards — found
        on a print and not before it.
      - CUT AFTER BOTH VOID LOOPS. Same buried-test hazard as the hollow cavity: a subtraction
        that takes the material a void sits in makes that void fail its 0.98 buried test, and
        before the counter above existed it did so silently. Cutting here means the counter
        sees the final shape and reports the loss.

     Single colour on purpose. A second would mean a filament change on layer one — the worst
     layer to change on — for a mark that is hidden by design. */
  if (params.brandMark && params.brandMark.rings.length > 0) {
    const MARK_DEPTH = 0.6;
    const bb = bodyFootprint.bounds();
    const cx = (bb.min[0] + bb.max[0]) / 2;
    const cy = (bb.min[1] + bb.max[1]) / 2;
    // Keep it clear of the wall, and of the rounded corners a 22% radius takes out.
    const maxSide = Math.min(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) * 0.6;
    const asked = Math.max(3, params.brandMark.sizeMm);
    const size = Math.min(asked, maxSide);
    if (size < asked - 0.05) {
      warnings.push(
        `Brand mark shrunk to ${size.toFixed(0)} mm to stay inside the base. `
        + 'Increase the base size for a bigger mark.',
      );
    }
    let mark: Section | null = null;
    for (const ring of params.brandMark.rings) {
      if (ring.length < 3) continue;
      // Negated X is the mirror. Doing it in the ring rather than with `.mirror()` keeps it
      // to one multiplication and puts it next to the reason it is here.
      const poly = track(
        CrossSection.ofPolygons(
          [ring.map(([x, y]) => [-x * size + cx, y * size + cy] as [number, number])],
          'EvenOdd',
        ),
      );
      mark = mark ? track(mark.add(poly)) : poly;
    }
    if (mark && !sectionIsEmpty(mark)) {
      // From just below the underside up to MARK_DEPTH above it: the overshoot guarantees a
      // clean cut through the face rather than a coplanar one, which renders as z-fighting.
      const cut = extrudeAt(mark, MARK_DEPTH + 0.3, bodyBottomZ - 0.3);
      body = track(body.subtract(cut));
    }
  }

  // Invariant #2: the provenance mark is never removed. It is forensic evidence, so a build
  // that quietly ships without it is worse than one that fails — the file looks fine and proves
  // nothing. This does not block the export (a legitimately thin body may genuinely have no room)
  // but it stops the loss being invisible.
  if (marksAttempted > 0 && marksLanded < marksAttempted) {
    warnings.push(
      `Provenance: ${marksLanded} of ${marksAttempted} identity marks landed. `
      + 'The body may be too thin, or a cavity has taken the material they sit in.',
    );
  }

  if (grewForSwitchMm > 0) {
    warnings.push(`Grown to ${grewForSwitchMm.toFixed(0)} mm so the switch fits.`);
  } else if (grewForSwitchMm < 0) {
    warnings.push('Base widened so the switch fits.');
  }

  if (!body.isEmpty()) {
    parts.push(toPart(body, 'body', 'base', params.bodyColorRgb, 'base-body'));
  }

  // --- Cap edge modifications. 'capTop' is the global cap-top edge; 'top-base' is
  //     the cap frame selected directly in Edges mode. Both round the cap's top rim. ---
  if (parts.length > 0) {
    const basePartIdx = parts.findIndex(p => p.name === 'top-base');
    if (basePartIdx >= 0) {
      for (const es of params.edgeSettings) {
        if ((es.target === 'capTop' || es.target === 'top-base') && es.style !== 'none') {
          const r = Math.min(es.radius, (backing + imageDepth) * 0.4, 2.5);
          if (r > 0.05) {
            const modBlock = createEdgeBevelBlock(plate, r, es.style, slabTopZ, false);
            if (modBlock) {
              base = track(base.subtract(modBlock));
              parts[basePartIdx] = toPart(base, 'cap', 'top', params.baseFilamentRgb, 'top-base');
            }
          }
        }
      }
    }
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return { parts, switchPlacements: applied, warnings };

  /** Apply fillet/chamfer edge modifications to the body solid.
   *  Targets: 'clickerBase' is the merged global control that bevels the body's top
   *  AND bottom edges together; 'baseTop'/'baseBottom' remain for older saved projects;
   *  'base-body' is the body part selected directly in Edges mode (rounds its top rim).
   *  Cap and inlay targets are handled elsewhere. */
  function applyEdges(
    bodyIn: Solid,
    edgeSettings: EdgeSetting[],
    footprint: Section,
    bottomZ: number,
    topZ: number,
    _wellFloorZ: number,
  ): Solid {
    let result = bodyIn;
    for (const es of edgeSettings) {
      if (es.style === 'none' || es.radius < 0.05) continue;
      const doBodyTop = es.target === 'baseTop' || es.target === 'base-body' || es.target === 'clickerBase';
      const doBodyBottom = es.target === 'baseBottom' || es.target === 'clickerBase';
      if (!doBodyTop && !doBodyBottom) continue; // cap / inlay targets handled elsewhere
      const r = Math.min(es.radius, (topZ - bottomZ) * 0.3, 2.5);
      if (r < 0.05) continue;

      if (doBodyTop) {
        const modBlock = createEdgeBevelBlock(footprint, r, es.style, topZ, false);
        if (modBlock) result = track(result.subtract(modBlock));
      }
      if (doBodyBottom) {
        const modBlock = createEdgeBevelBlock(footprint, r, es.style, bottomZ, true);
        if (modBlock) result = track(result.subtract(modBlock));
      }
    }
    return result;
  }

  function toPart(
    solid: Solid,
    kind: 'cap' | 'body',
    group: PartGroup,
    colorRgb: RGB,
    name: string,
  ): ClickerPart {
    const mesh = solid.getMesh();
    return {
      kind,
      group,
      colorRgb,
      name,
      numProp: mesh.numProp,
      vertProperties: new Float32Array(mesh.vertProperties),
      triVerts: new Uint32Array(mesh.triVerts),
    };
  }
}

/** Area of a section in mm², or 0 if the build doesn't expose `area()`. Used for
 *  "is this big enough for a person to notice" tests, never for geometry. */
function sectionArea(cs: Section): number {
  try {
    return typeof cs.area === 'function' ? cs.area() : 0;
  } catch {
    return 0;
  }
}

function sectionIsEmpty(cs: Section): boolean {
  try {
    if (typeof cs.isEmpty === 'function') return cs.isEmpty();
    const b = cs.bounds();
    return !(b.max[0] > b.min[0] && b.max[1] > b.min[1]);
  } catch {
    return false;
  }
}

/** Parametric distance t ≥ 0 along ray O + t·D at which it crosses segment A→B
 *  (u ∈ [0,1]), or null if it doesn't. */
function raySegT(
  ox: number, oy: number, dx: number, dy: number,
  a: [number, number], b: [number, number],
): number | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const det = -dx * ey + ex * dy;
  if (Math.abs(det) < 1e-12) return null; // parallel
  const r0x = a[0] - ox;
  const r0y = a[1] - oy;
  const t = (-r0x * ey + ex * r0y) / det;
  const u = (dx * r0y - dy * r0x) / det;
  if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

/** Point where a ray from the footprint centroid at `angleDeg` (0 = +X, CCW) exits the
 *  OUTERMOST boundary, plus the outward ray direction. Robust to holes/concavities. */
function edgePointAt(footprint: Section, angleDeg: number): { p: [number, number]; dir: [number, number] } {
  const rad = (angleDeg * Math.PI) / 180;
  const dir: [number, number] = [Math.cos(rad), Math.sin(rad)];
  let rings: [number, number][][] = [];
  try {
    rings = footprint.toPolygons() as [number, number][][];
  } catch {
    rings = [];
  }
  // Area-weighted centroid over all rings.
  let area = 0, cx = 0, cy = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
  }
  let ox: number, oy: number;
  if (Math.abs(area) > 1e-6) {
    area *= 0.5;
    ox = cx / (6 * area);
    oy = cy / (6 * area);
  } else {
    const b = footprint.bounds();
    ox = (b.min[0] + b.max[0]) / 2;
    oy = (b.min[1] + b.max[1]) / 2;
  }
  // Largest crossing t = the outermost boundary point along the ray.
  let bestT = -Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const t = raySegT(ox, oy, dir[0], dir[1], ring[j], ring[i]);
      if (t !== null && t > bestT) bestT = t;
    }
  }
  if (!isFinite(bestT) || bestT <= 0) {
    const b = footprint.bounds();
    bestT = Math.max((b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2);
  }
  return { p: [ox + dir[0] * bestT, oy + dir[1] * bestT], dir };
}
