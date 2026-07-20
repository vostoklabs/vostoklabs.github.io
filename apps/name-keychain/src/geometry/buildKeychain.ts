import type { BuildParams } from '../types';
import type { LineBox } from './textLayout';
import { snapLayers } from './noAms';

/** Helper to ensure clean Emscripten memory allocation and disposal. */
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

/** Convert a Manifold solid mesh into export-friendly TypedArrays. */
function getMeshData(solid: any): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const m = solid.getMesh();
  return { vertProperties: m.vertProperties, triVerts: m.triVerts };
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
 * Drop every interior hole from a 2D shape, keeping only the outer (positive-area)
 * loops. Manifold winds outer boundaries CCW (positive) and holes CW (negative),
 * so refilling with the Positive rule yields solid blobs. This is what stops the
 * plate outline from trapping air pockets (e.g. between a short 2nd line and the
 * body) that used to show up as a phantom second hole.
 */
function fillHoles(CrossSection: any, cs: any, keep: Keep): any {
  const polys = cs.toPolygons() as number[][][];
  const outers = polys.filter((p) => signedArea(p) > 0);
  if (outers.length === polys.length) return cs; // already hole-free
  if (outers.length === 0) return cs;
  return keep(new CrossSection(outers, 'Positive'));
}

/**
 * Build the 2D cross-sections that make up the keychain. Kept separate from the
 * 3D extrusion so it can be rendered/inspected headless. Everything it allocates
 * is registered with the caller's `keep` scope.
 */
export function buildProfiles(wasm: any, textContours: number[][][], params: BuildParams, keep: Keep) {
  const { CrossSection } = wasm;

  const hasHalo = params.colorScheme === 'plate-halo-text';
  const isRaised = params.style === 'raised';

  // No-AMS mode wants each colour to occupy whole layers, so snap the band heights.
  const snapped = params.printMode === 'noams'
    ? snapLayers(params.baseThickness, params.haloThickness, params.layerHeight)
    : { base: params.baseThickness, halo: params.haloThickness };
  const baseT = snapped.base;
  const haloT = snapped.halo;
  const letterZ = baseT + (hasHalo ? haloT : 0);

  const plateMargin = params.outlineWidth + (hasHalo ? params.haloWidth : 0);
  const lugOuter = params.holeDia / 2 + params.ringThickness;
  const lugPre = Math.max(lugOuter - plateMargin, 0.6);
  const gap = 2 * lugOuter + 2;

  // Raw glyphs, then apply the boldness offset (dilate = bolder, erode = thinner).
  let glyphsCS = keep(new CrossSection(textContours, 'NonZero'));
  if (Math.abs(params.boldness) > 0.02) {
    const bolded = keep(glyphsCS.offset(params.boldness, 'Round', 2.0, 12));
    if (bolded.area() > 0.1) glyphsCS = bolded;
  }
  const emptyText = glyphsCS.area() < 0.1;

  const gBox = bboxOfContours(textContours);
  const blockW = gBox.maxX - gBox.minX;
  const blockH = gBox.maxY - gBox.minY;
  const vertical = params.layout === 'vertical';
  const corner = params.ringStyle === 'corner';
  const rect = params.plateShape === 'rectangle';
  const lines = params.lines ?? [];

  // --- Ring / hole placement + the ramp bar that fuses the lug into the plate ---
  // The bar is anchored to the *plate body* (stable); the lug moves with ringPos.
  let lugCx: number, lugCy: number;
  let bar: { cx: number; cy: number; w: number; h: number };
  if (vertical) {
    if (corner) {
      lugCx = gBox.maxX + lugOuter * 0.15;
      lugCy = gBox.maxY + lugOuter * 0.15;
      bar = { cx: gBox.maxX - 1.0, cy: gBox.maxY - 1.0, w: 2.0, h: 2.0 };
    } else {
      const midX = (gBox.minX + gBox.maxX) / 2;
      lugCx = midX;
      lugCy = gBox.maxY + lugOuter * 0.9;
      bar = { cx: midX, cy: gBox.maxY - 1.0, w: Math.max(blockW * 0.7, lugOuter), h: 2.0 };
    }
  } else if (corner) {
    // Horizontal corner hole: sit in the top-left of LINE 1 (the top line), which is
    // where the letters actually are — the whole block's corner can be empty when a
    // longer/centred 2nd line indents line 1.
    const a = lines.length >= 1 ? lines[0]! : gBox;
    lugCx = a.minX + lugOuter * 0.15;
    lugCy = a.maxY + lugOuter * 0.15;
    bar = { cx: a.minX + 1.0, cy: a.maxY - 1.0, w: 2.0, h: 2.0 };
  } else {
    // Horizontal loop on the left. For a two-line OUTLINE plate, anchor the tab to
    // line 1 (always present, full width) and keep it as short as that line — no giant
    // triangular fin spanning both lines, and the empty area under a short 2nd line
    // simply isn't plate. A rectangle plate (or a single line) has a solid left edge,
    // so a small compact tab attaches cleanly at the block centre.
    lugCx = lugOuter;
    const anchor = !rect && lines.length >= 2
      ? lines[0]!
      : { minX: gBox.minX, maxX: gBox.maxX, minY: gBox.minY, maxY: gBox.maxY };
    lugCy = (anchor.minY + anchor.maxY) / 2;
    const barH = rect ? lugOuter * 1.6 : Math.max((anchor.maxY - anchor.minY) * 0.72, lugOuter);
    bar = { cx: anchor.minX + 1.0, cy: lugCy, w: 2.0, h: barH };
  }
  const holeX = lugCx + params.ringPosX;
  const holeY = lugCy + params.ringPosY;

  const lugDisc = keep(CrossSection.circle(lugPre, 32).translate([holeX, holeY]));
  const barCS = keep(CrossSection.square([bar.w, bar.h], true).translate([bar.cx, bar.cy]));
  const tabCS = keep(CrossSection.hull([lugDisc, barCS]));

  // --- Assemble the plate source ---
  let plateSrc: any;
  if (rect) {
    // Uniform rectangular plate covering the whole text block; the offset below adds
    // the border and rounds the corners into a clean rounded rectangle.
    const rectCS = keep(
      CrossSection.square([Math.max(blockW, 1), Math.max(blockH, 1)], true).translate([
        (gBox.minX + gBox.maxX) / 2,
        (gBox.minY + gBox.maxY) / 2,
      ]),
    );
    plateSrc = keep(rectCS.add(tabCS));
  } else {
    plateSrc = keep(glyphsCS.add(tabCS));
    if (!vertical && lines.length >= 2) {
      // Bridge the two lines only where they OVERLAP horizontally (with a minimum
      // width), so a short/centred 2nd line doesn't leave big empty plate on the sides.
      const l1 = lines[0]!;
      const l2 = lines[1]!;
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
        const band = keep(CrossSection.square([cxR - cxL, yt - yb], true).translate([(cxL + cxR) / 2, (yt + yb) / 2]));
        plateSrc = keep(plateSrc.add(band));
      }
    } else if (!vertical && lines.length === 1 && params.name.includes(' ')) {
      // Single line with a space: a hidden central strip bridges the word gap.
      const l = lines[0]!;
      const strip = keep(
        CrossSection.square([l.maxX - l.minX, (l.maxY - l.minY) * 0.5], true).translate([
          (l.minX + l.maxX) / 2,
          (l.minY + l.maxY) / 2,
        ]),
      );
      plateSrc = keep(plateSrc.add(strip));
    } else if (vertical && blockH > 0) {
      // Vertical: a central spine fuses the stacked characters into one bar.
      const spine = keep(
        CrossSection.square([Math.max(blockW * 0.42, params.size * 0.3), blockH], true).translate([
          (gBox.minX + gBox.maxX) / 2,
          (gBox.minY + gBox.maxY) / 2,
        ]),
      );
      plateSrc = keep(plateSrc.add(spine));
    }
  }

  // --- Offset to final silhouette (round + smoothing close), then drop trapped holes ---
  const smoothR = params.smoothing;
  let plateCS = keep(plateSrc.offset(plateMargin + smoothR, 'Round', 2.0, 24));
  if (smoothR > 0.05) plateCS = keep(plateCS.offset(-smoothR, 'Round', 2.0, 24));
  const plateNoHole = fillHoles(CrossSection, plateCS, keep);

  const holeR = params.holeDia / 2;
  const holeCS = keep(CrossSection.circle(holeR, 32).translate([holeX, holeY]));
  const textCS = keep(glyphsCS.subtract(holeCS));

  let haloCS: any = null;
  if (hasHalo) {
    haloCS = keep(glyphsCS.offset(params.haloWidth, 'Round', 2.0, 16).subtract(holeCS));
  }

  return {
    glyphsCS,
    plateNoHole,
    textCS,
    haloCS,
    holeX,
    holeY,
    holeR,
    baseT,
    haloT,
    letterZ,
    hasHalo,
    isRaised,
    plateBounds: plateNoHole.bounds() as { min: [number, number]; max: [number, number] },
    emptyText,
  };
}

/**
 * Chamfer a blob by extruding it as ONE tapered prism (Manifold's scaleTop draws a
 * straight sloped wall from the full-size base to a top inset by `c` per side). We
 * deliberately taper the *whole* height rather than splitting off a top band: a
 * band would leave a coincident interior face where it meets the straight part, and
 * evaluating that face is ~10× slower in Manifold. A gentle full-height bevel looks
 * clean, prints without sharp vertical walls, and stays cheap. Taper is about the
 * blob's own bbox centre so the inset is ~constant.
 */
function taperExtrude(wasm: any, cs: any, height: number, c: number, keep: Keep): any {
  const b = cs.bounds();
  const W = b.max[0] - b.min[0];
  const H = b.max[1] - b.min[1];
  if (c < 0.06 || W < 2 * c + 0.4 || H < 2 * c + 0.4) return keep(cs.extrude(height));
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const sx = (W - 2 * c) / W;
  const sy = (H - 2 * c) / H;
  const centered = keep(cs.translate([-cx, -cy]));
  return keep(centered.extrude(height, 0, 0, [sx, sy]).translate([cx, cy, 0]));
}

/**
 * Extrude a 2D profile to `height` with an optional chamfered (bevelled) edge.
 *  - `mode: 'scale'` (plate): taper the whole blob once.
 *  - `mode: 'glyphs'` (text): decompose into individual letters and taper each
 *    about its own centre — so letters don't slide toward the word centre — then
 *    `compose` (no boolean union; glyphs don't touch), so cost barely grows with
 *    name length.
 */
function extrudeChamfered(
  wasm: any,
  cs: any,
  height: number,
  chamfer: number,
  mode: 'scale' | 'glyphs',
  keep: Keep,
): any {
  const { Manifold } = wasm;
  const c = Math.min(chamfer, height * (mode === 'glyphs' ? 0.5 : 0.6));
  if (c < 0.06) return keep(cs.extrude(height));

  if (mode === 'scale') return taperExtrude(wasm, cs, height, c, keep);

  const glyphs: any[] = cs.decompose();
  if (glyphs.length <= 1) {
    for (const g of glyphs) keep(g);
    return taperExtrude(wasm, cs, height, c, keep);
  }
  const pieces = glyphs.map((g) => {
    keep(g);
    return taperExtrude(wasm, g, height, c, keep);
  });
  return keep(Manifold.compose(pieces));
}

export function buildKeychain(
  wasm: any,
  textContours: number[][][],
  params: BuildParams,
): {
  parts: { name: string; vertProperties: Float32Array; triVerts: Uint32Array; colorRgb: [number, number, number] }[];
  warnings: string[];
} {
  const { Manifold } = wasm;
  const warnings: string[] = [];

  const parts = withScope((keep) => {
    const p = buildProfiles(wasm, textContours, params, keep);
    if (p.emptyText) warnings.push('Text geometry is empty or degenerate. Check your characters.');

    const colorScheme = params.colorScheme;
    const chamfer = Math.max(0, params.chamfer ?? 0);

    const finalParts: {
      name: string;
      vertProperties: Float32Array;
      triVerts: Uint32Array;
      colorRgb: [number, number, number];
    }[] = [];

    // Straight full-height keyring hole, subtracted from the solids in 3D so its
    // wall stays crisp even when the plate top is chamfered.
    const holeCut = (solid: any, zBottom: number, zTop: number) => {
      const cyl = keep(
        Manifold.cylinder(zTop - zBottom + 2, p.holeR, p.holeR, 32).translate([p.holeX, p.holeY, zBottom - 1]),
      );
      return keep(solid.subtract(cyl));
    };

    if (p.isRaised) {
      // Base plate (chamfered top edge), then hole.
      let baseSolid = extrudeChamfered(wasm, p.plateNoHole, p.baseT, chamfer, 'scale', keep);
      baseSolid = holeCut(baseSolid, 0, p.baseT);
      finalParts.push({ name: 'plate', ...getMeshData(baseSolid), colorRgb: hexToRgb(params.plateColor) });

      // Halo band (no chamfer — thin accent layer).
      if (p.hasHalo && p.haloCS) {
        const haloSolid = keep(p.haloCS.extrude(p.haloT).translate([0, 0, p.baseT]));
        finalParts.push({ name: 'halo', ...getMeshData(haloSolid), colorRgb: hexToRgb(params.haloColor) });
      }

      // Raised text (chamfered top edge per glyph).
      const textSolid = keep(
        extrudeChamfered(wasm, p.textCS, params.textThickness, chamfer, 'glyphs', keep).translate([0, 0, p.letterZ]),
      );
      finalParts.push({
        name: 'text',
        ...getMeshData(textSolid),
        colorRgb: hexToRgb(colorScheme === 'single' ? params.plateColor : params.textColor),
      });
    } else {
      // Engraved: base plate (chamfered top) minus the text groove.
      let baseSolid = extrudeChamfered(wasm, p.plateNoHole, p.baseT, chamfer, 'scale', keep);
      const cutDepth = Math.min(params.textThickness, p.baseT * 0.6);
      const textCut = keep(p.textCS.extrude(params.textThickness + 1).translate([0, 0, p.baseT - cutDepth]));
      let engraved = keep(baseSolid.subtract(textCut));
      engraved = holeCut(engraved, 0, p.baseT);
      finalParts.push({ name: 'plate', ...getMeshData(engraved), colorRgb: hexToRgb(params.plateColor) });

      if (colorScheme !== 'single') {
        const inlaySolid = keep(p.textCS.extrude(cutDepth).translate([0, 0, p.baseT - cutDepth]));
        finalParts.push({ name: 'text', ...getMeshData(inlaySolid), colorRgb: hexToRgb(params.textColor) });
      }
    }

    return finalParts;
  });

  return { parts, warnings };
}
