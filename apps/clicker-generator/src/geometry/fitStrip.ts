// A printable fit test: a row of small tabs, each with the switch stem standing straight up out
// of it and its own stem fit number debossed into the tab in front of the stem.
//
// Fit is the single most-reported problem with this model and with every competing one. The app
// has the right control — "Switch stem fit (top part)" opens or closes the cross hole in the
// cap's post — but no way to answer the question it asks. People print a whole clicker, find it
// too tight, change a number they cannot evaluate, and print another one. Seventy-nine threads
// across this listing and eight competitors are that loop. The row closes it in one print: press
// each stem onto a real switch, read the number off the one that fits, set the control to it.
//
// This is the keycap generator's fit test (apps/keycap-generator/src/fitTest.js), ported rather
// than re-derived: the same tab, margins, label band, glyph height, stem sink, gaps, ladder and
// labels, so both products print the same test. The clicker's version works on the worker's
// Manifold stem directly instead of a THREE geometry, and uses the built-in bold face for the
// numbers rather than bundling the keycap's Droid Sans Mono for five labels.
//
// Every piece lies flat, tab down, with the stem pointing UP and its socket opening up: a tab
// balanced on top of an unsupported post is an overhang the printer cannot make. They are `base`
// parts, so `plateLayout` seats them as they are and never flips them the way it flips a cap.
//
// The row is shown in the preview and goes out through the normal Export button (mount.ts,
// `enterFitTest`), never as a download of its own: MakerLab's sandbox has no downloads, and the
// export path is also where the provenance and the licence nudge live.
import type { ClickerPart, RGB, Ring } from '../types';
import { applyStemFit, STEM_FIT_MAX_MM, STEM_FIT_MIN_MM } from './stemFit';

type Wasm = any;
type Solid = any;

/** One piece: the setting to test, and the outlines of the number to deboss on it. */
export interface FitStripLabel {
  /** The `stemFitMm` this piece is built at. */
  fitMm: number;
  /** Normalised text outlines (longest side = 1, centred, Y-up), as `parseLetter` returns them. */
  rings: Ring[];
}

export interface FitStripOptions {
  labels: FitStripLabel[];
  /** Cap colour, so the pieces print in whatever the user has loaded. */
  colorRgb: RGB;
}

// ---------------------------------------------------------------- tunables (keycap's values)
// The step between pieces, picked while the fit test is open. The keycap's default came off a
// real print — Ian, 2026-09-15: "0.4 is a bit drammatik, +0.10 and +0.20 mm should be enought,
// but i also want to give user a choice to fine tune it further". The ladder centres on the
// stepper, so 0.05 tunes around a value a first print found.
export const FIT_TEST_STEP_OPTIONS = [0.05, 0.1, 0.2];
export const FIT_TEST_STEP_MM = 0.1;
export const FIT_TEST_RUNG_COUNT = 5;
export const FIT_TEST_MARGIN_MM = 2.0;       // stem-region margin around the stem's bbox, per side
export const FIT_TEST_TAB_THICK_MM = 2.0;
export const FIT_TEST_LABEL_BAND_MM = 7.0;   // -Y band (facing the default camera) for the label
export const FIT_TEST_LABEL_EXTRA_MM = 3.0;  // label-width margin when the label sets tab width
export const FIT_TEST_LABEL_DEPTH_MM = 0.6;
export const FIT_TEST_GLYPH_HEIGHT_MM = 4.0;
export const FIT_TEST_SINK_MM = 0.2;         // how far the stem is sunk into the tab
export const FIT_TEST_GAP_MM = 3.0;          // gap between tabs along the row
/** Built-in, so the labels exist the instant the fit test opens and never depend on the font
 *  the design happens to use. */
export const FIT_TEST_FONT_ID = 'helvetiker-bold';

// ---------------------------------------------------------------- pure helpers

/**
 * Five settings `stepMm` apart, centred on `center`, each clamped to the stepper's range and
 * rounded to 2 decimals. Clamping each rung rather than shifting the ladder means a centre near
 * an end loses pieces off that side instead of bunching them up; the sequence is monotonic, so
 * dropping ADJACENT duplicates afterwards is exact.
 */
export function fitTestLadder(center: number, stepMm: number, count = FIT_TEST_RUNG_COUNT): number[] {
  const half = (count - 1) / 2;
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = Math.min(STEM_FIT_MAX_MM, Math.max(STEM_FIT_MIN_MM, center + (i - half) * stepMm));
    raw.push(Math.round(v * 100) / 100);
  }
  return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
}

/** The number debossed on a piece: '+0.10', '0.00', '-0.05'. A plain ASCII hyphen, not the
 *  stepper's typographic minus, which the built-in face does not carry. */
export function fitTestLabel(fitMm: number): string {
  const v = Math.round(fitMm * 100) / 100;
  if (Math.abs(v) < 1e-9) return '0.00';
  return `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

/**
 * One piece's tab footprint, in the piece's own frame where the stem sits centred at (0, 0).
 * The label band sits on the -Y side, next to the stem region rather than overlapping it, so the
 * two can never collide. Tab width is whichever of the stem region or the label needs more room.
 */
export function computeTabLayout(stemW: number, stemH: number, labelWidthMm: number) {
  const regionW = stemW + 2 * FIT_TEST_MARGIN_MM;
  const regionH = stemH + 2 * FIT_TEST_MARGIN_MM;
  const tabW = Math.max(regionW, labelWidthMm + FIT_TEST_LABEL_EXTRA_MM);
  const yMin = -regionH / 2 - FIT_TEST_LABEL_BAND_MM; // label band's far (-Y) edge
  const yMax = regionH / 2;                            // stem region's far (+Y) edge
  return { tabW, tabH: yMax - yMin, yMin, yMax, labelCenterY: yMin + FIT_TEST_LABEL_BAND_MM / 2 };
}

/** Tab widths, in row order -> each piece's X offset, the whole row centred on X = 0. */
export function computeRowLayout(widths: number[], gapMm = FIT_TEST_GAP_MM): number[] {
  const total = widths.reduce((s, w) => s + w, 0) + gapMm * Math.max(0, widths.length - 1);
  let x = -total / 2;
  const offsets: number[] = [];
  for (const w of widths) {
    offsets.push(x + w / 2);
    x += w + gapMm;
  }
  return offsets;
}

// ---------------------------------------------------------------- geometry

export function buildFitStrip(
  wasm: Wasm,
  stem: Solid,
  opts: FitStripOptions,
): { parts: ClickerPart[]; warnings: string[] } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  // The worker hands the stem over XY-centred with its authored Z: min Z is the open end that
  // takes the switch, max Z the end that joins the cap.
  const bb = stem.boundingBox();
  const stemW = bb.max[0] - bb.min[0];
  const stemH = bb.max[1] - bb.min[1];
  const zMaxOrig: number = bb.max[2];

  const labels = opts.labels.length ? opts.labels : [{ fitMm: 0, rings: [] }];
  const warnings: string[] = [];
  const failed: string[] = [];

  const pieces = labels.map((label) => {
    const text = fitTestLabel(label.fitMm);

    // The stem at this setting, sized by the very function the clicker and the blocks use, then
    // turned 180° about X — (x, y, z) -> (x, -y, -z) — so its socket opens upward, and lifted so
    // the closed end sits FIT_TEST_SINK_MM below the tab's top face for a clean union.
    const fit = applyStemFit(wasm, stem, label.fitMm);
    track(fit.solid);
    if (!fit.applied) failed.push(text);
    const tz = FIT_TEST_TAB_THICK_MM - FIT_TEST_SINK_MM + zMaxOrig;
    const stemM: Solid = track(track(fit.solid.rotate([180, 0, 0])).translate([0, 0, tz]));

    // The label at a fixed glyph height. Every label is digits, so the text's own height IS the
    // digit height — the same number the keycap reads off the font's cap height.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const ring of label.rings) {
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const hasText = label.rings.length > 0 && y1 > y0;
    const glyphScale = hasText ? FIT_TEST_GLYPH_HEIGHT_MM / (y1 - y0) : 0;
    const labelWidthMm = hasText ? (x1 - x0) * glyphScale : 0;
    const layout = computeTabLayout(stemW, stemH, labelWidthMm);

    const tabM: Solid = track(Manifold.cube([layout.tabW, layout.tabH, FIT_TEST_TAB_THICK_MM], false)
      .translate([-layout.tabW / 2, layout.yMin, 0]));
    let bodyM: Solid = tabM;
    if (hasText) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const contours = label.rings
        .filter((ring) => ring.length >= 3)
        .map((ring) => ring.map(([x, y]) => [(x - cx) * glyphScale, (y - cy) * glyphScale + layout.labelCenterY]));
      const cs = track(new CrossSection(contours, 'EvenOdd'));
      const labelPrism = track(track(cs.extrude(FIT_TEST_LABEL_DEPTH_MM + 1))
        // Pokes 1 mm above the tab top so the cut face is not coplanar with it.
        .translate([0, 0, FIT_TEST_TAB_THICK_MM - FIT_TEST_LABEL_DEPTH_MM]));
      bodyM = track(tabM.subtract(labelPrism));
    }
    const unionM: Solid = track(bodyM.add(stemM));
    const bodies = unionM.decompose();
    const watertight = unionM.status() === 'NoError' && bodies.length === 1;
    for (const b of bodies) b.delete();
    return { text, width: layout.tabW, unionM, bodyM, stemM, watertight };
  });

  const offsets = computeRowLayout(pieces.map((p) => p.width));
  const parts: ClickerPart[] = [];
  const emit = (solid: Solid, name: string, objectKey: string, dx: number) => {
    const mesh = track(solid.translate([dx, 0, 0])).getMesh();
    parts.push({
      kind: 'body',
      group: 'base',
      objectKey,
      colorRgb: opts.colorRgb,
      name,
      vertProperties: mesh.vertProperties,
      triVerts: mesh.triVerts,
      numProp: mesh.numProp,
    });
  };
  pieces.forEach((p, i) => {
    // One plate object per piece, so a slicer can still move them one at a time.
    const key = `fit-${i}`;
    if (p.watertight) {
      emit(p.unionM, `fit-${p.text}`, key, offsets[i]);
    } else {
      // Same fallback as the keycap: two bodies of one object rather than a broken union.
      emit(p.bodyM, `fit-${p.text}-tab`, key, offsets[i]);
      emit(p.stemM, `fit-${p.text}-stem`, key, offsets[i]);
      warnings.push(`Fit test piece ${p.text} is two bodies, the tab and the stem.`);
    }
  });

  if (failed.length) warnings.push(`Stem fit could not be applied to piece ${failed.join(', ')}.`);

  for (const o of trash) {
    try { o.delete(); } catch { /* already gone */ }
  }
  return { parts, warnings };
}
