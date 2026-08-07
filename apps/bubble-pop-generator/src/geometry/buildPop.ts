// Core bubble-pop construction. Runs in the geometry worker with the Manifold
// WASM kernel. Follows the magnet generator's patterns; see
// docs/briefs/bubble-pop-generator-spec.md.
//
// Frame: Z = 0 is the flat IMAGE face AND the build plate. The slab runs
// 0 → 13 mm (POP.height — the sleeve needs all of it) and every button stands
// 3.4 mm proud of the top at rest. Colour inlays are carved flush into the
// z = 0 face; nothing is ever embossed, because embossing would grow into the
// plate.
//
// Buttons ship PRE-INSERTED in their bores (Ian's call, 2026-08-04): one print,
// no assembly. Each is still its own part group so the slicer can arrange it and
// give it a filament of its own.
import type { BuildRegion, PopBuildParams, PopPart, PopReport, PartGroup, Ring, RGB } from '../types';
import { POP, BODY_THICKNESS, SOCKET_WALL_MM } from '../types';
import { buildShape } from './shapes';
import { loadPopModule, type PopModule } from './popModule';
import { getMarkSeed, markVoids, hardcodedVoids } from './identityMark';

type Wasm = any;
type Solid = any;
type Section = any;

/** Keep-out radius per socket: the housing OD. */
const KEEPOUT_R = POP.outerDiameter / 2;
/** Watermark voids sit above the inlays and below the sleeve pockets. */
const MARK_Z_BASE = 2.2;

export function buildPop(
  wasm: Wasm,
  regions: BuildRegion[],
  outline: Ring[],
  params: PopBuildParams,
  popModule: PopModule,
): { parts: PopPart[]; warnings: string[]; report: PopReport } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  const warnings: string[] = [];
  const H = BODY_THICKNESS;

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

  const fit = Math.max(24, params.fitSizeMm);
  const margin = Math.max(0.5, params.imageMargin);

  const scaleRings = (rings: Ring[], s: number): Ring[] =>
    rings.map((r) => r.map(([x, y]) => [x * s, y * s] as [number, number]));

  const ringArea = (ring: Ring): number => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  };

  const removeHoles = (cs: Section): Section => {
    if (sectionIsEmpty(cs)) return cs;
    const rect = track(CrossSection.square([2000, 2000], true));
    const inverted = track(rect.subtract(cs));
    const islands = [...inverted.decompose()];
    if (islands.length <= 1) return cs;
    let maxArea = -1;
    let outerSpace = islands[0];
    for (const isl of islands) {
      const a = isl.area();
      if (a > maxArea) {
        maxArea = a;
        outerSpace = isl;
      }
    }
    return track(rect.subtract(outerSpace));
  };

  const filledOutline = (s: number): Section => {
    const valid = scaleRings(outline, s).filter((r) => r.length >= 3 && ringArea(r) > 0.001);
    if (valid.length === 0) return track(CrossSection.square([s, s], true));
    return simp(track(new CrossSection(valid, 'NonZero')), 0.03);
  };

  const shrink = (sec: Section, d: number, fb: Section): Section => {
    if (d <= 0.01) return sec;
    const r = track(sec.offset(-d, 'Round', 2.0, 32));
    return sectionIsEmpty(r) ? fb : r;
  };

  // --- Body footprint + the area image colours are clipped to ---
  let plate: Section;
  let imageArea: Section;
  let imageScale: number;

  if (params.baseShape === 'outline') {
    imageScale = Math.max(5, fit - 2 * margin);
    const raw = track(filledOutline(imageScale).offset(margin, 'Round', 2.0, 32));
    const solid = removeHoles(raw);
    // Morphological closing merges deep scallops (between letters, between a
    // figure's limbs) so the silhouette has continuous meat for the sockets.
    plate = simp(track(solid.offset(2.0, 'Round', 2.0, 24).offset(-2.0, 'Round', 2.0, 24)), 0.05);
    imageArea = shrink(plate, margin, plate);
  } else {
    plate = buildShape(wasm, track, params.baseShape, fit, {
      cornerRadius: params.cornerRadius,
      holeRatio: params.holeRatio,
      starPoints: params.starPoints,
      aspect: nW / nH,
    });
    // Fit the image inside the shape, preserving aspect: bisect the largest
    // scale whose bounding rect (plus margin) is still fully inside the plate.
    const halfW = nW / 2;
    const halfH = nH / 2;
    const fits = (s: number): boolean => {
      const rect = track(
        CrossSection.square(
          [Math.max(0.2, 2 * halfW * s + 2 * margin), Math.max(0.2, 2 * halfH * s + 2 * margin)],
          true,
        ),
      );
      return sectionIsEmpty(track(rect.subtract(plate)));
    };
    let lo = 0.1;
    let hi = 2 * fit;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    imageScale = Math.max(1, lo * 0.98);
    imageArea = track(CrossSection.square([nW * imageScale, nH * imageScale], true));
  }

  const plateBB = plate.bounds();
  const bodyWidth = plateBB.max[0] - plateBB.min[0];
  const bodyHeight = plateBB.max[1] - plateBB.min[1];

  // ---------------------------------------------------------------------------
  // Socket placement
  // ---------------------------------------------------------------------------
  const spacing = Math.max(0, params.buttonSpacing);
  /** Centre-to-centre minimum: two housings plus a wall plus the user's spacing. */
  const minPitch = POP.outerDiameter + SOCKET_WALL_MM + spacing;

  // Where a socket CENTRE may legally sit: the plate eroded by the housing radius
  // plus the wall. Sampling this instead of the bounding box is what lets a
  // heart, a person or a paw take the buttons they obviously have room for — a
  // bounding-box layout drops candidates into the notches and then rejects them.
  const safe = track(plate.offset(-(KEEPOUT_R + SOCKET_WALL_MM), 'Round', 2.0, 32));
  const safeRings: Ring[] = sectionIsEmpty(safe) ? [] : (safe.toPolygons() as Ring[]);

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
    const step = Math.max(0.7, span / 56);
    const out: [number, number][] = [];
    for (let y = lo[1]; y <= hi[1] + 1e-6; y += step) {
      for (let x = lo[0]; x <= hi[0] + 1e-6; x += step) {
        if (inSafe(x, y)) out.push([x, y]);
      }
    }
    if (out.length === 0) for (const ring of safeRings) for (const p of ring) out.push([p[0], p[1]]);
    return out;
  };

  const pool = candidates();
  const dist2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const clearsAll = (p: [number, number], taken: [number, number][]): boolean =>
    taken.every((t) => dist2(p, t) >= minPitch * minPitch - 1e-6);
  const legal = (p: [number, number], taken: [number, number][]): boolean =>
    inSafe(p[0], p[1]) && clearsAll(p, taken);

  /** Farthest-point sampling, then re-centre so two buttons read as a pair
   *  rather than as one button and an afterthought. */
  const autoLayout = (count: number): [number, number][] | null => {
    if (pool.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of pool) {
      sx += p[0];
      sy += p[1];
    }
    const centre: [number, number] = [sx / pool.length, sy / pool.length];

    let seed = pool[0];
    let best = Infinity;
    for (const p of pool) {
      const d = dist2(p, centre);
      if (d < best) {
        best = d;
        seed = p;
      }
    }
    const chosen: [number, number][] = [seed];
    while (chosen.length < count) {
      let pick: [number, number] | null = null;
      let score = -1;
      for (const p of pool) {
        let nearest = Infinity;
        for (const c of chosen) nearest = Math.min(nearest, dist2(p, c));
        if (nearest < minPitch * minPitch) continue;
        if (nearest > score) {
          score = nearest;
          pick = p;
        }
      }
      if (!pick) return null;
      chosen.push(pick);
    }
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

  /** A real grid — the classic pop-it. Rows and columns are chosen to be as
   *  square as the body allows, then every cell is filtered for legality, so a
   *  grid over a heart simply loses its corners instead of failing outright. */
  const gridLayout = (count: number): [number, number][] | null => {
    if (safeRings.length === 0) return null;
    let bestSet: [number, number][] | null = null;
    // Try the SQUAREST arrangement first. Walking cols 1,2,3… instead returns
    // whichever narrow column happens to fit — a 9-button grid came out 2×5.
    const order = Array.from({ length: count }, (_, i) => i + 1).sort(
      (a, b) => Math.abs(a - Math.sqrt(count)) - Math.abs(b - Math.sqrt(count)) || a - b,
    );
    for (const cols of order) {
      const rows = Math.ceil(count / cols);
      const cells: [number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells.push([(c - (cols - 1) / 2) * minPitch, ((rows - 1) / 2 - r) * minPitch]);
        }
      }
      const keep = cells.filter((p) => inSafe(p[0], p[1]));
      if (keep.length >= count) return keep.slice(0, count);
      if (!bestSet || keep.length > bestSet.length) bestSet = keep;
    }
    return bestSet && bestSet.length > 0 ? bestSet : null;
  };

  /** Honour a manual position as far as it stays legal: walk it back toward the
   *  auto position until it fits, never past it. */
  const resolve = (
    base: [number, number],
    target: [number, number] | null,
    taken: [number, number][],
  ): { pos: [number, number]; clamped: boolean } | null => {
    if (!target || (target[0] === base[0] && target[1] === base[1])) {
      return legal(base, taken) ? { pos: base, clamped: false } : null;
    }
    const dx = target[0] - base[0];
    const dy = target[1] - base[1];
    // 0.125 steps are exact in binary, so t lands on 0 (the auto position).
    for (let t = 1; t >= 0; t -= 0.125) {
      const pos: [number, number] = [base[0] + dx * t, base[1] + dy * t];
      if (legal(pos, taken)) return { pos, clamped: t < 1 };
    }
    return null;
  };

  const requested = Math.max(1, Math.min(24, Math.round(params.buttonCount)));
  const clampedIdx: number[] = [];
  let positions: [number, number][] = [];

  for (let count = requested; count >= 1; count--) {
    const base = params.buttonLayout === 'grid' ? gridLayout(count) : autoLayout(count);
    if (!base || base.length < count) continue;

    const taken: [number, number][] = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const entry = params.buttonLayout === 'manual' ? params.buttons?.[i] : undefined;
      const target: [number, number] | null = entry ? [entry.x, entry.y] : null;
      const res = resolve(base[i], target, taken);
      if (!res) {
        ok = false;
        break;
      }
      taken.push(res.pos);
      if (res.clamped) clampedIdx.push(i + 1);
    }
    if (!ok) {
      clampedIdx.length = 0;
      continue;
    }
    positions = taken;
    break;
  }

  /** Smallest body this shape needs for one button. The shapes scale linearly,
   *  so we measure the largest circle the unit shape can swallow once and divide
   *  — far cheaper than rebuilding the shape inside a bisection. */
  const minBodySize = ((): number => {
    const probe = plate;
    let lo = 0;
    let hi = Math.max(bodyWidth, bodyHeight) / 2 + 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (sectionIsEmpty(track(probe.offset(-mid, 'Round', 2.0, 16)))) hi = mid;
      else lo = mid;
    }
    if (lo <= 1e-3) return fit * 4;
    // lo is the inscribed radius at the CURRENT size; scale to the radius one
    // socket needs.
    return (fit * (KEEPOUT_R + SOCKET_WALL_MM)) / lo;
  })();

  if (positions.length === 0) {
    warnings.push(
      `No pop button fits this shape. A button needs a ${POP.outerDiameter} mm circle with a ` +
        `${SOCKET_WALL_MM} mm wall around it. Increase Size to about ${Math.ceil(minBodySize)} mm.`,
    );
  } else if (positions.length < requested) {
    warnings.push(
      `Only ${positions.length} of ${requested} buttons fit. Each one needs a ` +
        `${POP.outerDiameter} mm circle plus a ${SOCKET_WALL_MM} mm wall. Increase Size, lower the ` +
        `count, or reduce Button spacing.`,
    );
  }
  if (clampedIdx.length) {
    warnings.push(
      clampedIdx.length === 1
        ? `Button ${clampedIdx[0]} was pulled back from where you put it. Every socket needs a ${SOCKET_WALL_MM} mm wall to the edge and to its neighbours.`
        : `Buttons ${clampedIdx.join(', ')} were pulled back from where you put them. Every socket needs a ${SOCKET_WALL_MM} mm wall to the edge and to its neighbours.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Solids
  // ---------------------------------------------------------------------------
  const extrudeAt = (cs: Section, h: number, z: number): Solid => {
    if (sectionIsEmpty(cs)) {
      const dummy = track(track(Manifold.extrude(track(CrossSection.circle(0.1, 3)), 0.1)).translate([0, 0, z]));
      return track(dummy.subtract(dummy));
    }
    return track(track(Manifold.extrude(cs, Math.max(0.01, h))).translate([0, 0, z]));
  };

  let body: Solid = extrudeAt(plate, H, 0);

  // Bevel the TOP rim only. The bottom rim is the image face and prints against
  // the plate — bevelling it would put a 45° overhang on layer one.
  if (params.edgeStyle !== 'flat' && params.edgeRadius >= 0.05) {
    const r = Math.min(params.edgeRadius, 4);
    const cutter = createEdgeBevelBlock(plate, r, H);
    if (cutter) body = track(body.subtract(cutter));
  }

  // --- Image inlays, flush in the z = 0 face. Sockets are masked out first so a
  //     colour can never intrude into a bore and jam the button. ---
  const imageDepth = Math.max(0.2, Math.min(params.imageDepth, 3));
  let usable = imageArea;
  if (positions.length) {
    const holes = positions.map((p) =>
      track(track(CrossSection.circle(POP.boreChamferDiameter / 2 + 0.4, 64)).translate(p)),
    );
    usable = track(usable.subtract(track(CrossSection.union(holes))));
  }

  const ordered = regions.slice().sort((a, b) => (a.coverage ?? 1) - (b.coverage ?? 1));
  const inlayParts: { partName: string; rgb: RGB; solid: Solid }[] = [];
  let placed2D: Section | null = null;

  for (const r of ordered) {
    const valid = scaleRings(r.rings, imageScale).filter((ring) => ring.length >= 3 && ringArea(ring) > 0.001);
    if (valid.length === 0) continue;
    let cs: Section = simp(track(new CrossSection(valid, 'NonZero')), 0.03);
    if (params.colorBleed > 0.001) cs = track(cs.offset(params.colorBleed, 'Round', 2.0, 32));
    let fp = track(cs.intersect(usable));
    if (params.baseShape !== 'outline') fp = track(fp.intersect(plate));
    if (sectionIsEmpty(fp)) continue;
    if (placed2D) fp = track(fp.subtract(placed2D));
    if (sectionIsEmpty(fp)) continue;
    placed2D = placed2D ? track(placed2D.add(fp)) : fp;

    const inlay = extrudeAt(fp, imageDepth, 0);
    if (inlay.isEmpty()) continue;
    inlayParts.push({ partName: r.partName, rgb: r.filamentRgb, solid: inlay });
  }

  if (placed2D) {
    body = track(body.subtract(extrudeAt(placed2D, imageDepth + 0.02, -0.01)));
  }

  // --- Sockets: cut the negative, then add the spring beams back. ---
  for (const p of positions) {
    body = track(body.subtract(track(popModule.negative.translate([p[0], p[1], 0]))));
  }
  for (const p of positions) {
    body = track(body.add(track(popModule.beams.translate([p[0], p[1], 0]))));
  }

  // --- Covert identity mark. Voids sit above the inlays and are only cut when
  //     ≥98% buried, so one can never pierce a bore, an inlay or the silhouette. ---
  body = applyWatermark(body, fit);

  // ---------------------------------------------------------------------------
  // Parts
  // ---------------------------------------------------------------------------
  const parts: PopPart[] = [];
  if (!body.isEmpty()) parts.push(toPart(body, 'body', 'body', params.bodyRgb, 'pop-body'));
  for (const ip of inlayParts) {
    if (!ip.solid.isEmpty()) parts.push(toPart(ip.solid, 'inlay', 'body', ip.rgb, ip.partName));
  }
  if (params.includeButtons) {
    positions.forEach((p, i) => {
      const b = track(popModule.button.translate([p[0], p[1], 0]));
      if (!b.isEmpty()) {
        parts.push(toPart(b, 'button', `button-${i}` as PartGroup, params.buttonRgb, `button-${i + 1}`));
      }
    });
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return {
    parts,
    warnings,
    report: {
      requested,
      placed: positions.length,
      positions,
      keepoutRadius: KEEPOUT_R,
      boreDiameter: POP.boreDiameter + params.buttonClearance,
      thickness: H,
      minBodySize,
      clamped: clampedIdx,
      bodyWidth,
      bodyHeight,
    },
  };

  // ---------------------------------------------------------------------------
  function createEdgeBevelBlock(footprint: Section, r: number, zRef: number): Solid | null {
    const outer = track(footprint.offset(0.6, 'Round', 2.0, 32));
    const b = footprint.bounds();
    const W = b.max[0] - b.min[0];
    const Hh = b.max[1] - b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const sx = W > 0.01 ? Math.max(0.01, (W - 2 * r) / W) : 1;
    const sy = Hh > 0.01 ? Math.max(0.01, (Hh - 2 * r) / Hh) : 1;
    const centeredOuter = track(outer.translate([-cx, -cy]));
    const centeredFp = track(footprint.translate([-cx, -cy]));
    const bounding = track(Manifold.extrude(centeredOuter, r + 0.02));
    const partVol = track(Manifold.extrude(centeredFp, r + 0.02, 0, 0, [sx, sy]));
    const cutter = track(track(bounding.subtract(partVol)).translate([cx, cy, 0]));
    return track(cutter.translate([0, 0, zRef - r]));
  }

  function applyWatermark(current: Solid, markSize: number): Solid {
    const seed = getMarkSeed();
    const tiers: ReturnType<typeof markVoids>[] = [];
    if (seed) tiers.push(markVoids(seed, markSize));
    tiers.push(hardcodedVoids(markSize));
    let result = current;
    for (const voids of tiers) {
      for (const v of voids) {
        const ang = (v.thetaDeg * Math.PI) / 180;
        const sphere = track(
          Manifold.sphere(v.d / 2, 16).translate([
            v.r * Math.cos(ang),
            v.r * Math.sin(ang),
            MARK_Z_BASE + v.z,
          ]),
        );
        let buried = false;
        try {
          buried = track(result.intersect(sphere)).volume() >= sphere.volume() * 0.98;
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
    kind: 'body' | 'inlay' | 'button',
    group: PartGroup,
    colorRgb: RGB,
    name: string,
  ): PopPart {
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

export { loadPopModule };
export type { PopModule };
