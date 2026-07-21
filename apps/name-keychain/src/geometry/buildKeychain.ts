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

/**
 * Extrude a 2D cross-section with an optional bevelled TOP edge. A straight body
 * up to (height - chamfer), then a few inward-inset slices approximating a 45°
 * chamfer. offset(-inset) shrinks each glyph about its OWN outline, so letters
 * bevel in place instead of sliding toward the word centre. chamfer ≤ 0 = plain
 * extrude (identical to before, so it's free when the toggle is off).
 */
function bevelExtrude(cs: any, height: number, chamfer: number, keep: Keep): any {
  if (chamfer <= 0.05) return keep(cs.extrude(height));
  const baseH = Math.max(0.01, height - chamfer);
  let solid = keep(cs.extrude(baseH));

  const components = (cs.decompose() as any[]) ?? [cs];
  for (const comp of components) {
    const compCS = keep(comp);
    const b = compCS.bounds() as { min: [number, number]; max: [number, number] };
    const W = b.max[0] - b.min[0];
    const H = b.max[1] - b.min[1];
    if (W <= 0.01 || H <= 0.01) continue;

    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;

    const scaleX = Math.max(0.01, (W - 2 * chamfer) / W);
    const scaleY = Math.max(0.01, (H - 2 * chamfer) / H);

    const centered = keep(compCS.translate([-cx, -cy]));
    const topCap = keep(
      centered.extrude(chamfer + 0.01, 0, 0, [scaleX, scaleY]).translate([cx, cy, baseH - 0.005]),
    );
    solid = keep(solid.add(topCap));
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
  const lines = params.lines ?? [];

  // --- Ring / hole placement + tab neck that fuses the lug into the plate ---
  let lugCx: number, lugCy: number;
  let defaultAngle: number;

  if (vertical) {
    if (corner) {
      lugCx = gBox.maxX + lugOuter * 0.15;
      lugCy = gBox.maxY + lugOuter * 0.15;
      defaultAngle = 45;
    } else {
      const midX = (gBox.minX + gBox.maxX) / 2;
      lugCx = midX;
      lugCy = gBox.maxY + lugOuter * 0.9;
      defaultAngle = 90;
    }
  } else if (corner) {
    // Horizontal corner hole: sit in the top-left of LINE 1 (the top line)
    const a = lines.length >= 1 ? lines[0]! : gBox;
    lugCx = a.minX + lugOuter * 0.15;
    lugCy = a.maxY + lugOuter * 0.15;
    defaultAngle = 135;
  } else {
    // Horizontal loop on the left
    const anchor = lines.length >= 2 ? gBox : (lines.length >= 1 ? lines[0]! : gBox);
    lugCx = lugOuter;
    lugCy = (anchor.minY + anchor.maxY) / 2;
    defaultAngle = params.ringPosY > 4 ? 90 : 180;
  }
  const holeX = lugCx + params.ringPosX;
  const holeY = lugCy + params.ringPosY;

  const angle = params.ringAngle ?? defaultAngle;
  const rad = (angle * Math.PI) / 180;
  const neckLen = Math.max(lugOuter * 2.2, 10.0);
  const anchorX = holeX - neckLen * Math.cos(rad);
  const anchorY = holeY - neckLen * Math.sin(rad);

  const lugDisc = keep(CrossSection.circle(lugPre, 32).translate([holeX, holeY]));
  const anchorR = Math.min(lugPre * 0.85, 2.0);
  const anchorDisc = keep(CrossSection.circle(anchorR, 16).translate([anchorX, anchorY]));
  const tabCS = keep(CrossSection.hull([lugDisc, anchorDisc]));

  // --- Assemble the plate source (glyphs + tab + connectors) ---
  // Rectangle plate: a plain box over the glyph bbox + the tab; the offset below
  // rounds its corners into a rounded-rect. Skips the glyph-hugging connectors.
  const isRect = params.plateShape === 'rectangle';
  let plateSrc: any;
  if (isRect) {
    const rectCS = keep(
      CrossSection.square([Math.max(blockW, 0.1), Math.max(blockH, 0.1)], true).translate([
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
  } // end outline (non-rectangle) plate source

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

    const finalParts: {
      name: string;
      vertProperties: Float32Array;
      triVerts: Uint32Array;
      colorRgb: [number, number, number];
    }[] = [];

    // Straight full-height keyring hole, subtracted from the solids in 3D.
    const holeCut = (solid: any, zBottom: number, zTop: number) => {
      const cyl = keep(
        Manifold.cylinder(zTop - zBottom + 2, p.holeR, p.holeR, 32).translate([p.holeX, p.holeY, zBottom - 1]),
      );
      return keep(solid.subtract(cyl));
    };

    // Bevel amounts, clamped so they never eat more than the layer can spare.
    const chamBase = Math.min(params.chamfer, p.baseT * 0.6);
    const chamText = Math.min(params.chamfer, params.textThickness * 0.5);

    if (p.isRaised) {
      // Base plate (bevelled top edge), then hole.
      let baseSolid = bevelExtrude(p.plateNoHole, p.baseT, chamBase, keep);
      baseSolid = holeCut(baseSolid, 0, p.baseT);
      finalParts.push({ name: 'plate', ...getMeshData(baseSolid), colorRgb: hexToRgb(params.plateColor) });

      // Halo band.
      if (p.hasHalo && p.haloCS) {
        const haloSolid = keep(p.haloCS.extrude(p.haloT).translate([0, 0, p.baseT]));
        finalParts.push({ name: 'halo', ...getMeshData(haloSolid), colorRgb: hexToRgb(params.haloColor) });
      }

      // Raised text (bevelled top edge).
      const textBev = bevelExtrude(p.textCS, params.textThickness, chamText, keep);
      const textSolid = keep(textBev.translate([0, 0, p.letterZ]));
      finalParts.push({
        name: 'text',
        ...getMeshData(textSolid),
        colorRgb: hexToRgb(colorScheme === 'single' ? params.plateColor : params.textColor),
      });
    } else {
      // Engraved: base plate with a recess, flush-filled with coloured inlays.
      // 3-colour engraved recesses the halo outline (letters ⊕ haloWidth) and inlays
      // an outline-coloured ring + the letters; 1/2-colour just recesses the letters.
      let baseSolid = bevelExtrude(p.plateNoHole, p.baseT, chamBase, keep);
      const cutDepth = Math.min(params.textThickness, p.baseT * 0.6);
      const recessCS = p.hasHalo && p.haloCS ? keep(p.haloCS.add(p.textCS)) : p.textCS;
      const recessCut = keep(recessCS.extrude(cutDepth + 1).translate([0, 0, p.baseT - cutDepth]));
      let engraved = keep(baseSolid.subtract(recessCut));
      engraved = holeCut(engraved, 0, p.baseT);
      finalParts.push({ name: 'plate', ...getMeshData(engraved), colorRgb: hexToRgb(params.plateColor) });

      if (colorScheme !== 'single') {
        // Outline ring inlay (3-colour only), then the letter inlay on top.
        if (p.hasHalo && p.haloCS) {
          const ringCS = keep(p.haloCS.subtract(p.textCS));
          if (ringCS.area() > 0.02) {
            const ringSolid = keep(ringCS.extrude(cutDepth).translate([0, 0, p.baseT - cutDepth]));
            finalParts.push({ name: 'halo', ...getMeshData(ringSolid), colorRgb: hexToRgb(params.haloColor) });
          }
        }
        const inlaySolid = keep(p.textCS.extrude(cutDepth).translate([0, 0, p.baseT - cutDepth]));
        finalParts.push({ name: 'text', ...getMeshData(inlaySolid), colorRgb: hexToRgb(params.textColor) });
      }
    }

    return finalParts;
  });

  return { parts, warnings };
}
