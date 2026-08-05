// Core magnet construction. Runs in the geometry worker with the Manifold WASM
// kernel. Mirrors the clicker generator's buildClicker patterns.
//
// Frame: Z = 0 is the flat BACK face (the magnet side); the front (image) face
// is at Z = thickness. The image colors are carved as non-overlapping inlays
// into the top (flush at level 0, raised by componentHeights × stepHeight).
//
// Magnet pockets (negative volumes cut from the back):
//   glue-on   — pocket open at the back face, depth = magnetDepth. Glue the
//               magnet in after printing; nothing prints over it.
//   embedded  — the cavity floats above a backWall-thick floor. Printing back
//               face down, the floor prints first, then the cavity walls; the
//               print pauses once the cavity is complete (Z = backWall +
//               magnetDepth), the magnet drops in, and the rest of the body
//               closes over it, fully enclosing the magnet.
// Either way at least WALL_MIN of solid body is left above the magnet.
//
// Slider mode builds the same body twice, side by side on the plate. The two
// halves are IDENTICAL rigid copies, both printed image-up / pockets-down: you
// assemble by flipping one over, and a flip is a rotation, so the image on the
// underside still reads correctly. Reflecting the second half instead would
// print a mirror-image copy that no longer matches its partner.
import type {
  BuildRegion,
  MagnetBuildParams,
  MagnetPart,
  MagnetReport,
  PartGroup,
  Ring,
  RGB,
  SliderLayout,
} from '../types';
import {
  sliderGridSpec,
  sliderMinBodySizeFor,
  effectivePocketFit,
  POCKET_WALL_MM,
  SLIDER_PIECE_GAP,
} from '../types';
import { getMarkSeed, markVoids, hardcodedVoids } from './identityMark';

type Wasm = any;
type Solid = any;
type Section = any;

const IMAGE_DEPTH = 0.8; // how deep the colored inlays sit in the top face
const WALL_MIN = 0.8; // solid body always left above a pocket (toward the image face)
const POCKET_WALL = POCKET_WALL_MM; // min solid wall around each pocket (edge + neighbour safety)
const COS30 = Math.cos(Math.PI / 6); // hex inradius / circumradius

export function buildMagnet(
  wasm: Wasm,
  regions: BuildRegion[],
  outline: Ring[],
  params: MagnetBuildParams,
): { parts: MagnetPart[]; warnings: string[]; magnet: MagnetReport } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  // Traced outlines carry thousands of vertices; collapse near-collinear points
  // to a print-invisible tolerance — the single biggest speed lever.
  const simp = (s: Section, eps = 0.04): Section => {
    try {
      return typeof s.simplify === 'function' ? track(s.simplify(eps)) : s;
    } catch {
      return s;
    }
  };

  const sectionIsEmpty = (cs: Section): boolean => {
    try {
      if (typeof cs.isEmpty === 'function') return cs.isEmpty();
      const b = cs.bounds();
      return !(b.max[0] > b.min[0] && b.max[1] > b.min[1]);
    } catch {
      return false;
    }
  };

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

  const warnings: string[] = [];

  // --- Scale: image fills the body minus the frame margin. ---
  const margin = Math.max(0.5, params.imageMargin);
  const fit = Math.max(8, params.fitSizeMm);
  const scaleRings = (rings: Ring[], s: number): Ring[] =>
    rings.map((r) => r.map(([x, y]) => [x * s, y * s] as [number, number]));

  const getRingArea = (ring: Ring): number => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  };

  const removeHoles = (cs: Section): Section => {
    if (sectionIsEmpty(cs)) return cs;
    const rect = track(CrossSection.square([1000, 1000], true));
    const inverted = track(rect.subtract(cs));
    const islands = [...inverted.decompose()];
    if (islands.length <= 1) return cs;
    let maxArea = -1;
    let outerSpace = islands[0];
    for (const isl of islands) {
      const area = isl.area();
      if (area > maxArea) {
        maxArea = area;
        outerSpace = isl;
      }
    }
    return track(rect.subtract(outerSpace));
  };

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.1, Math.min(r, Math.min(w, h) / 2 - 0.01));
    const core = track(
      CrossSection.square([Math.max(0.2, w - 2 * rr), Math.max(0.2, h - 2 * rr)], true),
    );
    return track(core.offset(rr, 'Round', 2.0, 32));
  };

  const makeHexagon = (r: number): Section => {
    const pts: Ring = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6;
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    return track(new CrossSection([pts], 'NonZero'));
  };

  const grow = (sec: Section, d: number): Section =>
    d <= 0.001 ? sec : track(sec.offset(d, 'Round', 2.0, 32));
  const shrink = (sec: Section, d: number, fb: Section): Section => {
    if (d <= 0.01) return sec;
    const r = track(sec.offset(-d, 'Round', 2.0, 32));
    return sectionIsEmpty(r) ? fb : r;
  };

  const filledOutline = (s: number): Section => {
    const validRings = scaleRings(outline, s).filter((r) => r.length >= 3 && getRingArea(r) > 0.001);
    if (validRings.length === 0) return track(CrossSection.square([s, s], true));
    return simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
  };

  // --- Body footprint (plate) + the image area that inlays are clipped to. ---
  let plate: Section;
  let imageArea: Section;
  let imageScale: number;

  if (params.baseShape === 'outline') {
    // The image IS the shape: body = outline + frame margin; longest side ≈ fit.
    imageScale = Math.max(5, fit - 2 * margin);
    const raw = track(filledOutline(imageScale).offset(margin, 'Round', 2.0, 32));
    const solidPlate = removeHoles(raw);
    // Light morphological closing merges deep scallops between letters, then the
    // perimeter arcs collapse to a print-invisible tolerance.
    plate = simp(track(solidPlate.offset(2.0, 'Round', 2.0, 24).offset(-2.0, 'Round', 2.0, 24)), 0.05);
    imageArea = shrink(plate, margin, plate);
  } else {
    const genShape = (half: number): Section => {
      switch (params.baseShape) {
        // A true square (a hair of rounding only, so the corners survive slicing).
        case 'square': return roundedRect(2 * half, 2 * half, 0.4);
        case 'roundedRect': return roundedRect(2 * half, 2 * half, params.cornerRadius);
        case 'rectangle': {
          const w = nW >= nH ? 2 * half : 2 * half * (nW / nH);
          const h = nH >= nW ? 2 * half : 2 * half * (nH / nW);
          return roundedRect(w, h, params.cornerRadius);
        }
        case 'hexagon': return makeHexagon(half);
        case 'circle':
        default: return track(CrossSection.circle(half, 160));
      }
    };
    // Shape is exactly `fit` across; the image scales to fit inside with margin,
    // preserving aspect — the frame (body color) fills the rest.
    plate = genShape(fit / 2);
    const halfW = nW / 2;
    const halfH = nH / 2;
    // Bisect the largest scale s (mm per normalized unit) whose image rect plus
    // margin fits inside the plate. rectAt() grows with s; fits() is true for
    // small s — so lo is a fitting scale, hi a failing one.
    const rectAt = (s: number): Section =>
      track(
        CrossSection.square(
          [Math.max(0.2, 2 * halfW * s + 2 * margin), Math.max(0.2, 2 * halfH * s + 2 * margin)],
          true,
        ),
      );
    const fits = (s: number): boolean => {
      const outside = track(rectAt(s).subtract(plate));
      return sectionIsEmpty(outside);
    };
    let lo = 0.1;
    let hi = 2 * fit;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    imageScale = Math.max(1, lo * 0.98);
    imageArea = track(CrossSection.square([nW * imageScale, nH * imageScale], true));
  }

  const plateBB = plate.bounds();
  const pW = plateBB.max[0] - plateBB.min[0];
  const pH = plateBB.max[1] - plateBB.min[1];

  // --- Slider grid. One source of truth, shared with the UI's size floor. ---
  const gridFor = (layout: SliderLayout) =>
    sliderGridSpec({
      layout,
      magnetShape: params.magnetShape,
      magnetDiameter: params.magnetDiameter,
      magnetX: params.magnetX,
      magnetY: params.magnetY,
      pocketFit: params.pocketFit,
      pocketProfile: params.pocketProfile,
      gap: params.sliderGap,
    });
  const computeSliderMinSize = (layout = params.sliderLayout): number =>
    params.productType !== 'slider'
      ? 0
      : sliderMinBodySizeFor(params.baseShape, params.cornerRadius, gridFor(layout));

  const extrudeAt = (cs: Section, h: number, z: number): Solid => {
    if (sectionIsEmpty(cs)) {
      const dummy = track(track(Manifold.extrude(track(CrossSection.circle(0.1, 3)), 0.1)).translate([0, 0, z]));
      return track(dummy.subtract(dummy));
    }
    return track(track(Manifold.extrude(cs, Math.max(0.01, h))).translate([0, 0, z]));
  };

  const topZFor = (level: number): number =>
    params.thickness + Math.max(0, level * params.stepHeight);

  // --- Inlays: carved non-overlapping, smallest coverage first so detail colors
  //     win at shared boundaries. Flush with the top face at level 0. ---
  const ordered = regions.slice().sort((a, b) => (a.coverage ?? 1) - (b.coverage ?? 1));
  const holesByLevel = new Map<number, Section>();
  const inlayParts: { partName: string; rgb: RGB; solid: Solid }[] = [];
  let placed2D: Section | null = null;

  for (const r of ordered) {
    const validRings = scaleRings(r.rings, imageScale).filter(
      (ring) => ring.length >= 3 && getRingArea(ring) > 0.001,
    );
    if (validRings.length === 0) continue;
    let cs: Section = simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
    if (params.colorBleed > 0.001) cs = grow(cs, params.colorBleed);
    let clipped = track(cs.intersect(imageArea));
    // Preset shapes: clip inlays to the plate too, so colors never float outside
    // the silhouette (e.g. square image corners in a circle body).
    if (params.baseShape !== 'outline') clipped = track(clipped.intersect(plate));
    if (sectionIsEmpty(clipped)) continue;
    let fp = clipped;
    if (placed2D) {
      fp = track(fp.subtract(placed2D));
    }
    if (sectionIsEmpty(fp)) continue;
    placed2D = placed2D ? track(placed2D.add(fp)) : fp;

    const level = params.componentHeights?.[r.partName] ?? 0;
    const shift = level * params.stepHeight;
    const topZ = topZFor(level);
    const bottomZ = params.thickness - IMAGE_DEPTH + Math.min(0, shift);

    let inlay: Solid = extrudeAt(fp, topZ - bottomZ, bottomZ);
    if (inlay.isEmpty()) continue;

    // Global "chamfer raised parts" toggle: bevel the top edge of every RAISED
    // inlay (level > 0). Flush parts stay sharp — the chamfer is for the relief.
    if (params.extrudeChamfer && shift > 0) {
      const radius = Math.min(0.5, (topZ - bottomZ) * 0.49, 3.0);
      if (radius >= 0.05) {
        const modBlock = createEdgeBevelBlock(fp, radius, topZ);
        if (modBlock) inlay = track(inlay.subtract(modBlock));
      }
    }

    inlayParts.push({ partName: r.partName, rgb: r.filamentRgb, solid: inlay });

    const existing = holesByLevel.get(level);
    holesByLevel.set(level, existing ? track(existing.add(fp)) : fp);
  }

  // --- Body slab, then remove the inlay holes so parts sit flush. ---
  let body: Solid = extrudeAt(plate, params.thickness, 0);
  // A blank second slider piece has to be its OWN slab. Copying the carved body
  // and dropping the inlays would leave the image behind as an empty recess.
  const wantBlankTwin = params.productType === 'slider' && params.sliderMirrorBlank;
  let blankBody: Solid | null = wantBlankTwin ? extrudeAt(plate, params.thickness, 0) : null;
  for (const [level, hole2D] of holesByLevel.entries()) {
    const shift = level * params.stepHeight;
    const bottomZ = params.thickness - IMAGE_DEPTH + Math.min(0, shift);
    const holePrism = extrudeAt(hole2D, topZFor(level) - bottomZ + 0.02, bottomZ - 0.01);
    body = track(body.subtract(holePrism));
  }

  // --- Edge treatment on the FRONT (top) rim only — the back must stay flat so
  //     the magnet (or a magnetic sheet) sits against the fridge. ---
  if (params.edgeStyle !== 'flat' && params.edgeRadius >= 0.05) {
    const radius = Math.min(params.edgeRadius, params.thickness * 0.4, 2.5);
    if (radius >= 0.05) {
      const modBlock = createEdgeBevelBlock(plate, radius, params.thickness);
      if (modBlock) body = track(body.subtract(modBlock));
      if (blankBody && modBlock) blankBody = track(blankBody.subtract(modBlock));
    }
  }

  // --- Magnet pockets (negative volumes from the back face). ---
  const pockets = placePockets();
  for (const cut of pockets.cuts) {
    body = track(body.subtract(cut));
    if (blankBody) blankBody = track(blankBody.subtract(cut));
  }

  // --- Covert identity mark: voids buried in the back-face wall. Pockets are
  //     already subtracted, and each void is only cut when ≥98% buried, so a
  //     void can never pierce a pocket or the silhouette. ---
  body = applyWatermark(body, fit);
  if (blankBody) blankBody = applyWatermark(blankBody, fit);

  // --- Parts ---
  const parts: MagnetPart[] = [];
  if (!body.isEmpty()) {
    parts.push(toPart(body, 'body', 'magnet', params.bodyRgb, 'magnet-body'));
  }
  for (const ip of inlayParts) {
    if (!ip.solid.isEmpty()) {
      parts.push(toPart(ip.solid, 'inlay', 'magnet', ip.rgb, ip.partName));
    }
  }

  // --- Slider second piece ---
  //
  //  You assemble by turning one piece over, and a flip about an in-plane axis
  //  maps a footprint to its MIRROR. So for the two silhouettes to stack flush,
  //  the second piece has to be built as the mirror of the first — otherwise an
  //  asymmetric outline overhangs its partner all the way round.
  //
  //  Mirroring is only needed when the silhouette is asymmetric, i.e. when the
  //  body follows the image. Every preset shape (circle, square, rounded rect,
  //  rectangle, pointy-top hexagon) is symmetric about both axes, so a flip
  //  already lands it on itself — and there we keep the rigid copy, because
  //  mirroring would needlessly reverse the artwork inlaid on the plate.
  //
  //  This is a genuine trade-off, not an oversight: for an image-outline slider
  //  the mirrored half also carries mirrored artwork. There is no way to have
  //  both a flush profile and un-reversed art on an asymmetric shape — the two
  //  requirements are opposite handednesses of the same part.
  //
  //  Either way BOTH pieces still print image-up / pockets-down. This is a
  //  mirror in X, not the Z-flip that used to put the art face down.
  if (params.productType === 'slider') {
    const xOffset = pW + SLIDER_PIECE_GAP;
    const mirrored = params.baseShape === 'outline';
    const twinParts: MagnetPart[] = [];
    const shift = (p: MagnetPart, name: string): MagnetPart => {
      const verts = new Float32Array(p.vertProperties);
      const np = p.numProp;
      // The body is built centred on the origin, so negating X mirrors it about
      // its own centre; then translate the whole piece clear of the first.
      for (let vi = 0; vi < verts.length; vi += np) {
        verts[vi] = (mirrored ? -verts[vi] : verts[vi]) + xOffset;
      }
      // Reflection reverses winding; a plain translation does not.
      const tris = new Uint32Array(p.triVerts);
      if (mirrored) {
        for (let ti = 0; ti < tris.length; ti += 3) {
          const b = tris[ti + 1];
          tris[ti + 1] = tris[ti + 2];
          tris[ti + 2] = b;
        }
      }
      return {
        kind: p.kind,
        group: 'slider-mirror' as PartGroup,
        colorRgb: p.colorRgb,
        name,
        numProp: np,
        vertProperties: verts,
        triVerts: tris,
      };
    };
    if (blankBody && !blankBody.isEmpty()) {
      // Plain slab twin: same body, same pockets, no image at all.
      twinParts.push(
        shift(toPart(blankBody, 'body', 'magnet', params.bodyRgb, ''), 'piece2-magnet-body'),
      );
    } else {
      for (const p of parts) twinParts.push(shift(p, `piece2-${p.name}`));
    }
    parts.push(...twinParts);
    pockets.report.sliderOffsetX = xOffset;
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return { parts, warnings, magnet: pockets.report };

  // ---------------------------------------------------------------------------
  function createEdgeBevelBlock(footprint: Section, r: number, zRef: number): Solid | null {
    const outer = grow(footprint, 0.6);
    const b = footprint.bounds();
    const W = b.max[0] - b.min[0];
    const H = b.max[1] - b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const scaleX = W > 0.01 ? Math.max(0.01, (W - 2 * r) / W) : 1;
    const scaleY = H > 0.01 ? Math.max(0.01, (H - 2 * r) / H) : 1;
    const centeredOuter = track(outer.translate([-cx, -cy]));
    const centeredFp = track(footprint.translate([-cx, -cy]));
    const boundingVolume = track(Manifold.extrude(centeredOuter, r + 0.02));
    const partVolume = track(Manifold.extrude(centeredFp, r + 0.02, 0, 0, [scaleX, scaleY]));
    const cutter = track(track(boundingVolume.subtract(partVolume)).translate([cx, cy, 0]));
    return track(cutter.translate([0, 0, zRef - r]));
  }

  function placePockets(): { cuts: Solid[]; report: MagnetReport } {
    const maxCount = params.productType === 'slider' ? 8 : 4;
    const requested = Math.max(1, Math.min(maxCount, Math.round(params.magnetCount)));
    const empty: MagnetReport = {
      requested,
      placed: 0,
      pocketDepth: 0,
      coverThickness: params.thickness,
      backWall: 0,
      scaled: false,
      positions: [],
      pocketRadius: 0,
      magnetRadius: 0,
      rotations: [],
      sliderMinSize: computeSliderMinSize(),
    };
    if (params.magnetMode === 'none') return { cuts: [], report: { ...empty, requested: 0 } };

    // Round pockets print undersize and need the clearance; hex walls print
    // true, so they take only what the user asked for above that allowance.
    const fitD = effectivePocketFit(params.pocketFit, params.pocketProfile);
    const minExtent = Math.min(pW, pH);
    // Hard cap: a pocket never spans more than ~62% of the smaller extent, so the
    // watermark's back-face safe zone can never be squeezed out.
    const cap = Math.max(4, minExtent * 0.62 - fitD);
    const rawDim =
      params.magnetShape === 'disc' ? params.magnetDiameter : Math.max(params.magnetX, params.magnetY);
    const scale = Math.min(1, cap / Math.max(2, rawDim));
    const dDia = Math.max(1, params.magnetDiameter * scale);
    const dX = Math.max(1, params.magnetX * scale);
    const dY = Math.max(1, params.magnetY * scale);
    // Worst-case footprint width, used for spacing the auto layout.
    const dim = params.magnetShape === 'disc' ? dDia : Math.hypot(dX, dY);
    if (scale < 1) {
      warnings.push(
        `The magnet is too big for this design — the pocket was shrunk to ${dim.toFixed(1)} mm. Increase Size to fit the real magnet.`,
      );
    }

    // Embedded leaves a floor between the back face and the magnet; glue-on opens
    // straight through the back (floor = 0).
    const backWall =
      params.magnetMode === 'embedded' ? Math.min(1.5, Math.max(0.5, params.backWall)) : 0;
    const depthMax = params.thickness - WALL_MIN - backWall;
    let depth = Math.max(0.4, params.magnetDepth);
    // Epsilon matters: the UI sets thickness to exactly magnet+wall+cover, and
    // 3.6 - 0.8 - 0.8 is 1.9999999999999996 in binary — without slack a magnet
    // that fits perfectly reports itself as too tall.
    if (depth > depthMax + 1e-6) {
      depth = Math.max(0.4, depthMax);
      const needed = params.magnetDepth + backWall + WALL_MIN;
      warnings.push(
        `The body is too thin for a ${params.magnetDepth.toFixed(1)} mm magnet — the pocket is only ${depth.toFixed(1)} mm deep and the magnet will stand proud. Set Thickness to at least ${needed.toFixed(1)} mm.`,
      );
    }

    const pocketShape = (): Section => {
      if (params.magnetShape === 'disc') {
        const radius = (dDia + fitD) / 2;
        // A hexagon through CrossSection.circle(r, 6) is INSCRIBED in r, so its
        // flats sit at r·cos30 — divide by cos30 to keep the magnet's clearance.
        return params.pocketProfile === 'hex'
          ? track(CrossSection.circle(radius / COS30, 6))
          : track(CrossSection.circle(radius, 64));
      }
      return roundedRect(dX + fitD, dY + fitD, Math.min(1.2, Math.min(dX, dY) / 4));
    };

    const placedAt = (pos: [number, number], rotDeg: number): Section => {
      let fp = pocketShape();
      if (rotDeg !== 0 && params.magnetShape === 'block') fp = track(fp.rotate(rotDeg));
      return Math.abs(pos[0]) > 1e-3 || Math.abs(pos[1]) > 1e-3 ? track(fp.translate(pos)) : fp;
    };

    /** A pocket is legal when its ≥POCKET_WALL guard band stays inside the plate
     *  and clear of every pocket already placed. */
    const legal = (pos: [number, number], rotDeg: number, taken: Section | null): boolean => {
      const guard = track(placedAt(pos, rotDeg).offset(POCKET_WALL, 'Round', 2.0, 32));
      if (!sectionIsEmpty(track(guard.subtract(plate)))) return false;
      if (taken && !sectionIsEmpty(track(guard.intersect(taken)))) return false;
      return true;
    };

    // Where a pocket CENTRE may legally sit: the plate eroded by the pocket's
    // circumscribed radius plus the wall. Deriving positions from this instead of
    // from the bounding box is what lets odd silhouettes (a V, a heart, a paw)
    // take the magnets they obviously have room for.
    const circumR = params.magnetShape === 'disc'
      ? (params.pocketProfile === 'hex' ? (dDia + fitD) / 2 / COS30 : (dDia + fitD) / 2)
      : Math.hypot(dX + fitD, dY + fitD) / 2;
    const safe = track(plate.offset(-(circumR + POCKET_WALL), 'Round', 2.0, 32));
    const safeRings: Ring[] = sectionIsEmpty(safe) ? [] : (safe.toPolygons() as Ring[]);

    /** Even-odd test across every ring, so holes in the safe region count. */
    const inSafe = (x: number, y: number): boolean => {
      let inside = false;
      for (const ring of safeRings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      return inside;
    };

    /** Candidate centres on a grid inside the safe region. */
    const candidates = (): [number, number][] => {
      if (safeRings.length === 0) return [];
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      for (const ring of safeRings) {
        for (const [x, y] of ring) {
          lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
          hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
        }
      }
      const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
      const stepSize = Math.max(0.75, span / 48);
      const out: [number, number][] = [];
      for (let y = lo[1]; y <= hi[1] + 1e-6; y += stepSize) {
        for (let x = lo[0]; x <= hi[0] + 1e-6; x += stepSize) {
          if (inSafe(x, y)) out.push([x, y]);
        }
      }
      // A very thin safe region can miss every grid node — fall back to its own
      // vertices pulled slightly inward.
      if (out.length === 0) {
        for (const ring of safeRings) for (const p of ring) out.push([p[0], p[1]]);
      }
      return out;
    };

    const pool = candidates();
    const dist2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

    /** The slider's magnet array: `cols` columns across X, `rows` rows up the
     *  slide axis (Y), centred on the body. The row pitch is the click distance,
     *  so it is measured from the POCKET footprint — spacing it by the bare
     *  magnet leaves the pockets' 2 mm guard bands overlapping and every layout
     *  gets rejected. */
    //  The pocket's own worst-case width, so the grid and the pockets actually
    //  cut can never disagree about how much room a magnet needs — which is what
    //  `sliderGridSpec` computes for the untouched magnet. A hex pocket spans
    //  its corners, 15.5% wider than the disc it holds.
    const sliderPocketDim =
      params.magnetShape === 'disc' && params.pocketProfile === 'hex'
        ? (dim + fitD) / COS30
        : dim + fitD;
    const sliderPitch = sliderPocketDim + POCKET_WALL + Math.max(0, params.sliderGap) + 0.05;
    const sliderPositions = (layout: SliderLayout, ox = 0, oy = 0): [number, number][] => {
      const cols = 2;
      const rows = layout / 2;
      const out: [number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          out.push([
            (c - (cols - 1) / 2) * sliderPitch + ox,
            (r - (rows - 1) / 2) * sliderPitch + oy,
          ]);
        }
      }
      return out;
    };

    /** The user's array offset, pulled back toward the centre until every pocket
     *  is legal again. Dragging the matrix must never be able to push a pocket
     *  through the body wall, and silently dropping to a smaller layout (what the
     *  row ladder would otherwise do) would change the click count mid-drag. */
    const fitSliderOffset = (layout: SliderLayout): [number, number] => {
      const want = params.sliderArrayOffset ?? { x: 0, y: 0 };
      if (!want.x && !want.y) return [0, 0];
      const allLegal = (ox: number, oy: number): boolean => {
        let taken: Section | null = null;
        for (const pos of sliderPositions(layout, ox, oy)) {
          if (!legal(pos, 0, taken)) return false;
          const fp = placedAt(pos, 0);
          taken = taken ? track(taken.add(fp)) : fp;
        }
        return true;
      };
      // Bisect on the fraction of the requested offset — one rule for every shape,
      // and it lands the array against the wall instead of snapping back to centre.
      if (allLegal(want.x, want.y)) return [want.x, want.y];
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (allLegal(want.x * mid, want.y * mid)) lo = mid;
        else hi = mid;
      }
      return [want.x * lo, want.y * lo];
    };

    /** Farthest-point sampling: magnet 1 goes to the most "central" spot, then
     *  each next magnet to the candidate furthest from the ones already placed.
     *  Centres must clear each other by the pocket width plus a wall. */
    const autoLayout = (count: number): [number, number][] | null => {
      if (pool.length === 0) return null;
      let sumX = 0;
      let sumY = 0;
      for (const p of pool) {
        sumX += p[0];
        sumY += p[1];
      }
      const centre: [number, number] = [sumX / pool.length, sumY / pool.length];

      const chosen: [number, number][] = [];
      // Seed: the legal point closest to the centre of the legal region.
      let seed = pool[0];
      let best = Infinity;
      for (const p of pool) {
        const d = dist2(p, centre);
        if (d < best) {
          best = d;
          seed = p;
        }
      }
      chosen.push(seed);

      const minGap2 = (2 * circumR + POCKET_WALL) ** 2;
      while (chosen.length < count) {
        let pick: [number, number] | null = null;
        let pickScore = -1;
        for (const p of pool) {
          let nearest = Infinity;
          for (const c of chosen) nearest = Math.min(nearest, dist2(p, c));
          if (nearest < minGap2) continue;
          if (nearest > pickScore) {
            pickScore = nearest;
            pick = p;
          }
        }
        if (!pick) return null;
        chosen.push(pick);
      }

      // Two magnets read better mirrored than clustered on one side, so re-centre
      // the whole set on the region's middle without breaking the spacing.
      if (chosen.length > 1) {
        let cx = 0;
        let cy = 0;
        for (const c of chosen) {
          cx += c[0];
          cy += c[1];
        }
        cx = centre[0] - cx / chosen.length;
        cy = centre[1] - cy / chosen.length;
        const shifted = chosen.map((c) => [c[0] + cx, c[1] + cy] as [number, number]);
        if (shifted.every((p) => inSafe(p[0], p[1]))) return shifted;
      }
      return chosen;
    };

    // The user's own positions are honoured as far as they stay legal: walk back
    // toward the auto position until the pocket fits (never past it).
    const resolve = (
      base: [number, number],
      target: [number, number] | null,
      rot: number,
      taken: Section | null,
    ): { pos: [number, number]; clamped: boolean } | null => {
      if (!target || (target[0] === base[0] && target[1] === base[1])) {
        return legal(base, rot, taken) ? { pos: base, clamped: false } : null;
      }
      const dx = target[0] - base[0];
      const dy = target[1] - base[1];
      // 0.125 steps are exact in binary, so t lands on 0 (the auto position).
      for (let t = 1; t >= 0; t -= 0.125) {
        const pos: [number, number] = [base[0] + dx * t, base[1] + dy * t];
        if (legal(pos, rot, taken)) return { pos, clamped: t < 1 };
      }
      return null;
    };

    const manual = params.magnetPlacement === 'manual';

    // --- Slider mode: a fixed magnet array, not farthest-point sampling. The
    //     whole point is that both halves share one pitch, so the positions are
    //     derived, never sampled. ---
    if (params.productType === 'slider') {
      const wanted = params.sliderLayout;
      // Drop a row at a time rather than hand back a slider with no pockets at
      // all — a 2×2 array still clicks, it just clicks once.
      const ladder: SliderLayout[] = ([8, 6, 4] as SliderLayout[]).filter((n) => n <= wanted);
      for (const layout of ladder) {
        const [offX, offY] = fitSliderOffset(layout);
        const positions = sliderPositions(layout, offX, offY);
        let taken: Section | null = null;
        let allLegal = true;
        for (const pos of positions) {
          if (!legal(pos, 0, taken)) {
            allLegal = false;
            break;
          }
          const fp = placedAt(pos, 0);
          taken = taken ? track(taken.add(fp)) : fp;
        }
        if (!allLegal) continue;

        if (layout < wanted) {
          warnings.push(
            `Only ${layout} of ${wanted} magnets per half fit — the body is too short along the slide axis. ` +
              `Increase Size to at least ${computeSliderMinSize(wanted).toFixed(1)} mm, or use a smaller magnet.`,
          );
        }
        const rows = layout / 2;
        const cutZ = backWall > 0 ? backWall : -0.02;
        const cutH = depth + (backWall > 0 ? 0 : 0.02);
        return {
          cuts: positions.map((pos) => extrudeAt(placedAt(pos, 0), cutH, cutZ)),
          report: {
            requested: wanted,
            placed: layout,
            pocketDepth: depth,
            coverThickness: Math.max(0, params.thickness - backWall - depth),
            backWall,
            scaled: scale < 1,
            positions,
            pocketRadius: circumR,
            magnetRadius: params.magnetShape === 'disc' ? dDia / 2 : Math.hypot(dX, dY) / 2,
            rotations: positions.map(() => 0),
            sliderMinSize: computeSliderMinSize(),
            sliderPerHalf: layout,
            sliderPitch,
            sliderTravel: (rows - 1) * sliderPitch,
            sliderClicks: rows - 1,
            sliderArrayOffset: { x: offX, y: offY },
          },
        };
      }
      const shapeHint =
        params.baseShape === 'outline'
          ? ' Try Base shape → Rounded rect, which gives the array a clean run.'
          : '';
      warnings.push(
        `No magnet array fits this shape — a ${(2 * circumR).toFixed(1)} mm pocket needs at least ` +
          `${computeSliderMinSize(4).toFixed(1)} mm of body. Increase Size or use a smaller magnet.${shapeHint}`,
      );
      return {
        cuts: [],
        report: { ...empty, backWall, pocketRadius: circumR, sliderMinSize: computeSliderMinSize() },
      };
    }

    for (let count = requested; count >= 1; count--) {
      const base = autoLayout(count);
      if (!base) continue;

      const positions: [number, number][] = [];
      const rotations: number[] = [];
      const clamped: number[] = [];
      let taken: Section | null = null;
      let ok = true;
      for (let i = 0; i < base.length; i++) {
        const entry = params.magnets?.[i];
        const target: [number, number] | null =
          manual && entry ? [entry.x, entry.y] : null;
        const rot = entry?.rotation ?? 0;
        const resolved = resolve(base[i], target, rot, taken);
        if (!resolved) {
          ok = false;
          break;
        }
        positions.push(resolved.pos);
        rotations.push(rot);
        if (resolved.clamped) clamped.push(i + 1);
        const fp = placedAt(resolved.pos, rot);
        taken = taken ? track(taken.add(fp)) : fp;
      }
      if (!ok) continue;

      if (clamped.length) {
        warnings.push(
          clamped.length === 1
            ? `Magnet ${clamped[0]} was pulled back from where you put it — every pocket needs a 2 mm wall to the edge and to its neighbours.`
            : `Magnets ${clamped.join(', ')} were pulled back from where you put them — every pocket needs a 2 mm wall to the edge and to its neighbours.`,
        );
      }

      if (count < requested) {
        warnings.push(
          `Only ${count} of ${requested} magnets fit — this shape has no room for more at ${(2 * circumR).toFixed(1)} mm each. Increase Size, use a smaller magnet, or lower the count.`,
        );
      }
      // Glue-on opens at z = 0: start the cutter just below the back face so the
      // boolean never has to resolve coplanar bottom faces.
      const cutZ = backWall > 0 ? backWall : -0.02;
      const cutH = depth + (backWall > 0 ? 0 : 0.02);
      return {
        cuts: positions.map((pos, i) => extrudeAt(placedAt(pos, rotations[i]), cutH, cutZ)),
        report: {
          requested,
          placed: count,
          pocketDepth: depth,
          coverThickness: Math.max(0, params.thickness - backWall - depth),
          backWall,
          scaled: scale < 1,
          positions,
          pocketRadius: circumR,
          // The magnet itself, without the press-fit gap.
          magnetRadius: params.magnetShape === 'disc' ? dDia / 2 : Math.hypot(dX, dY) / 2,
          rotations,
          sliderMinSize: computeSliderMinSize(),
        },
      };
    }

    warnings.push(
      `No magnet pocket fits this design — a ${(2 * circumR).toFixed(1)} mm pocket needs more solid area than this shape has. Increase Size or use a smaller magnet.`,
    );
    return { cuts: [], report: { ...empty, backWall, pocketRadius: circumR } };
  }

  function applyWatermark(current: Solid, markSize: number): Solid {
    const markSeed = getMarkSeed();
    const tiers: { voids: ReturnType<typeof markVoids> }[] = [];
    if (markSeed) tiers.push({ voids: markVoids(markSeed, markSize) });
    tiers.push({ voids: hardcodedVoids(markSize) });
    let result = current;
    for (const tier of tiers) {
      for (const v of tier.voids) {
        const ang = (v.thetaDeg * Math.PI) / 180;
        const cx = v.r * Math.cos(ang);
        const cy = v.r * Math.sin(ang);
        const sphere = track(Manifold.sphere(v.d / 2, 16).translate([cx, cy, v.z]));
        let buried = false;
        try {
          const inter = track(result.intersect(sphere));
          buried = inter.volume() >= sphere.volume() * 0.98;
        } catch {
          buried = false;
        }
        if (buried) result = track(result.subtract(sphere));
      }
    }
    return result;
  }

  function toPart(
    solid: Solid,
    kind: 'body' | 'inlay',
    group: PartGroup,
    colorRgb: RGB,
    name: string,
  ): MagnetPart {
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
