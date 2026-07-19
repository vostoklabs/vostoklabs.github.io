import type { BuildParams } from '../types';

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
  return {
    vertProperties: m.vertProperties,
    triVerts: m.triVerts,
  };
}

export function buildKeychain(
  wasm: any,
  textContours: number[][][],
  params: BuildParams,
): {
  parts: {
    name: string;
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    colorRgb: [number, number, number];
  }[];
  warnings: string[];
} {
  const { Manifold, CrossSection } = wasm;
  const warnings: string[] = [];

  const parts = withScope((keep) => {
    // 1. Setup dimensions & styles
    const hasHalo = params.colorScheme === 'plate-halo-text';
    const isRaised = params.style === 'raised';
    const letterZ = params.baseThickness + (hasHalo ? params.haloThickness : 0);

    const lugOuter = params.holeDia / 2 + params.ringThickness;
    const plateMargin = params.outlineWidth + (hasHalo ? params.haloWidth : 0);
    const lugPre = Math.max(lugOuter - plateMargin, 0.6);

    const gap = 2 * lugOuter + 2;

    const corner = params.ringStyle === 'corner';
    const ringCx = params.layout === 'vertical'
      ? (corner ? params.size * 0.28 : 0)
      : (corner ? gap + lugOuter * 0.6 : lugOuter);
    const ringCy = params.layout === 'vertical'
      ? (corner ? -params.size * 0.1 : params.size * 0.55 + lugOuter * 0.5)
      : (corner ? params.size * 0.30 : 0);

    const holeX = ringCx + params.ringPosX;
    const holeY = ringCy + params.ringPosY;
    const bridgeX = params.layout === 'vertical' ? 0 : gap + 0.5;
    const bridgeY = params.layout === 'vertical' ? params.size * 0.30 : 0;

    // 2. Build 2D shapes
    const glyphsCS = keep(new CrossSection(textContours, 'NonZero'));
    if (glyphsCS.area() < 0.1) {
      warnings.push('Text geometry is empty or degenerate. Check your characters.');
    }

    // Build the ring lug and its bridge to the plate body.
    // circle1 = the ring lug (moves with the hole via ringPosX/Y).
    const circle1 = keep(CrossSection.circle(lugPre, 32).translate([holeX, holeY]));

    // Bridge: for the protruding "loop" style, connect the lug to the plate with a
    // tangent wedge (hull the lug to a bar that spans the text block). This ramps the
    // lug up to the plate's full height so the junction has no re-entrant "notch".
    // The corner style keeps the original small bridge dot (its hole sits in the plate).
    let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
    for (const poly of textContours) {
      for (const pt of poly) {
        if (pt[0]! < gMinX) gMinX = pt[0]!;
        if (pt[0]! > gMaxX) gMaxX = pt[0]!;
        if (pt[1]! < gMinY) gMinY = pt[1]!;
        if (pt[1]! > gMaxY) gMaxY = pt[1]!;
      }
    }
    const gW = gMaxX - gMinX;
    const gH = gMaxY - gMinY;

    let bridgeCS: any;
    if (corner || !Number.isFinite(gW)) {
      bridgeCS = keep(CrossSection.circle(0.8, 16).translate([bridgeX, bridgeY]));
    } else if (params.layout === 'vertical') {
      // stacked text: ramp across the plate width at the top edge
      const barW = Math.max(gW * 0.86, lugOuter);
      bridgeCS = keep(CrossSection.square([barW, 1.6], true).translate([(gMinX + gMaxX) / 2, gMaxY - 0.8]));
    } else {
      // single/dual line: ramp up the plate height at the left edge
      const barH = Math.max(gH * 0.86, lugOuter);
      bridgeCS = keep(CrossSection.square([1.6, barH], true).translate([gMinX + 0.8, (gMinY + gMaxY) / 2]));
    }
    const tabCS = keep(CrossSection.hull([circle1, bridgeCS]));

    // Start assembly
    let plateSrc = keep(glyphsCS.add(tabCS));

    // Optional uniform height pad (forces consistent vertical bounds for display racks)
    if (params.uniformHeight && params.layout === 'horizontal') {
      // Estimate width based on character count (best effort matching scad)
      const nchars = params.name.length;
      const estW = Math.max(nchars, 1) * params.size * 0.62;
      const pad = keep(CrossSection.square([estW, params.size * 1.24], true).translate([gap + estW / 2, 0]));
      plateSrc = keep(plateSrc.add(pad));
    }

    // Optional vertical connector or multi-word spaces connector
    const nchars = params.name.length;
    const vstep = params.size * 1.06;
    const estW = Math.max(nchars, 1) * params.size * 0.62;
    const isMultiWord = params.name.includes(' ');
    if (params.layout === 'vertical') {
      const connector = keep(
        CrossSection.square([params.size * 0.35, nchars * vstep], true).translate([0, (-(nchars - 1) * vstep) / 2]),
      );
      plateSrc = keep(plateSrc.add(connector));
    } else if (isMultiWord) {
      const connector = keep(
        CrossSection.square([estW, params.size * 0.42], true).translate([gap + estW / 2, 0]),
      );
      plateSrc = keep(plateSrc.add(connector));
    }

    // Optional line linker for second line
    const line2On = params.secondLine !== '' && params.layout === 'horizontal';
    if (line2On) {
      const line2Sz = params.size * params.line2Scale;
      const dy = (params.size + line2Sz) * (params.lineSpacingFactor ?? 0.62);
      const linkX = gap + (params.line2XOffset ?? 0);
      const link = keep(CrossSection.square([3, dy + params.size * 0.4], true).translate([linkX, 0]));
      plateSrc = keep(plateSrc.add(link));
    }

    // Offset the plate to final size with rounding + smoothing
    const smoothR = params.smoothing;
    let plateCS = keep(plateSrc.offset(plateMargin + smoothR, 'Round', 2.0, 24));
    if (smoothR > 0.05) {
      plateCS = keep(plateCS.offset(-smoothR, 'Round', 2.0, 24));
    }

    // Keyring hole 2D
    const holeCS = keep(CrossSection.circle(params.holeDia / 2, 32).translate([holeX, holeY]));

    // Subtract the hole from the base plate in 2D before extruding
    plateCS = keep(plateCS.subtract(holeCS));

    // Subtract the hole from the text curves in 2D so text doesn't fill the hole
    const textCS = keep(glyphsCS.subtract(holeCS));

    // 3. Extrude to 3D
    let baseSolid = keep(plateCS.extrude(params.baseThickness));

    // Voids watermark (sub-1.4mm spheres buried inside the solid plate)
    // Placed in the solid region between the loop hole and the text
    const watermarkX = (ringCx + gap) / 2;
    const watermarkY = (ringCy + 0) / 2;
    const midZ = params.baseThickness / 2;
    
    // We add 3 tiny sphere voids inside the base plate (1.0mm dia)
    const voids: any[] = [];
    const offsets: [number, number][] = [[-1.5, 0], [0, 0.8], [1.5, -0.4]];
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i]!;
      const sphere = keep(
        Manifold.sphere(0.5, 12).translate([watermarkX + off[0], watermarkY + off[1], midZ]),
      );
      voids.push(sphere);
    }
    
    // Subtract voids from the base solid
    for (const v of voids) {
      const sub = keep(baseSolid.subtract(v));
      baseSolid = keep(sub);
    }

    const colorScheme = params.colorScheme;
    const finalParts: {
      name: string;
      vertProperties: Float32Array;
      triVerts: Uint32Array;
      colorRgb: [number, number, number];
    }[] = [];

    if (isRaised) {
      // Base plate part
      const baseMesh = getMeshData(baseSolid);
      finalParts.push({
        name: 'plate',
        ...baseMesh,
        colorRgb: hexToRgb(params.plateColor),
      });

      // Halo outline part
      if (hasHalo) {
        const haloCS = keep(glyphsCS.offset(params.haloWidth, 'Round', 2.0, 16).subtract(holeCS));
        const haloSolid = keep(
          haloCS.extrude(params.haloThickness).translate([0, 0, params.baseThickness]),
        );
        finalParts.push({
          name: 'halo',
          ...getMeshData(haloSolid),
          colorRgb: hexToRgb(params.haloColor),
        });
      }

      // Text part
      const textSolid = keep(
        textCS.extrude(params.textThickness).translate([0, 0, letterZ]),
      );
      finalParts.push({
        name: 'text',
        ...getMeshData(textSolid),
        colorRgb: hexToRgb(colorScheme === 'single' ? params.plateColor : params.textColor),
      });
    } else {
      // Engraved style: Subtract text from base plate
      const cutDepth = Math.min(params.textThickness, params.baseThickness * 0.6);
      const textCut = keep(
        textCS.extrude(params.textThickness + 1).translate([0, 0, params.baseThickness - cutDepth]),
      );
      
      const engravedPlate = keep(baseSolid.subtract(textCut));
      finalParts.push({
        name: 'plate',
        ...getMeshData(engravedPlate),
        colorRgb: hexToRgb(params.plateColor),
      });

      // If multicolor and engraved, the text is an inlay (fills the engraved slots)
      if (colorScheme !== 'single') {
        const inlaySolid = keep(
          textCS.extrude(cutDepth).translate([0, 0, params.baseThickness - cutDepth]),
        );
        finalParts.push({
          name: 'text',
          ...getMeshData(inlaySolid),
          colorRgb: hexToRgb(params.textColor),
        });
      }
    }

    return finalParts;
  });

  return { parts, warnings };
}
