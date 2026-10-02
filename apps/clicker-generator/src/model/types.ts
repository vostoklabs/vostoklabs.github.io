// Model mode: cut an uploaded 3D model into a clicker.
import type { RGB } from '../types';

/**
 * The three ways a model becomes a clicker.
 *
 *  - `slice`:  one horizontal cut. Everything above it is the button.
 *  - `stand`:  the model is not cut; it rides on a pressable plate in a generated base.
 *  - `button`: a round or square button is cut down into the top of the model.
 */
export type CutterKind = 'slice' | 'stand' | 'button';
export type ButtonShape = 'round' | 'square';
export type PlateShape = 'circle' | 'square' | 'outline';

/** Everything the worker needs to cut the cached model. Millimetres and degrees. */
export interface ModelCutParams {
  cutter: CutterKind;
  /** Rotation of the imported model about X, then Y, then Z, in degrees. The UI only ever
   *  offers quarter turns; the geometry takes any angle. */
  rotation: [number, number, number];
  /** Longest side of the oriented model, mm. */
  sizeMm: number;
  /** Shaved off the model's bottom so it stands — and prints — on a flat face, mm. `null` =
   *  let the build choose: nothing for a model that already has a base, just enough for a
   *  ball or an egg. */
  flattenMm: number | null;
  slice: {
    /** Height of the cut above the model's bottom, mm. `null` = let the build choose. */
    heightMm: number | null;
    /** Grow a pillar on the top into a walled well in the bottom, so the seam is a groove
     *  rather than a gap and the top cannot wobble ("Hide the gap"). On by default, and a
     *  preference rather than an order: built wherever the switch still fits inside the collar,
     *  a plain gap elsewhere — `ModelMeta.hideSeam` says which this build is. */
    hideSeam: boolean;
  };
  stand: {
    shape: PlateShape;
    /** Plate edge beyond the model's footprint, mm. */
    marginMm: number;
  };
  button: {
    shape: ButtonShape;
    /** Diameter (round) or side (square), mm. */
    sizeMm: number;
    /** How far the button stands proud of the surface at rest, mm. 0 = flush. */
    raiseMm: number;
    /** Centre, mm, in the oriented model's frame. `null` = let the build choose. */
    x: number | null;
    y: number | null;
  };
  /** Nudge of the switch from where the build put it (slice), and its turn. */
  switchNudge: { x: number; y: number; rotation: number };
  /** Slip fit between a sliding piece and its bore, mm. The image clicker's "Top / base gap". */
  tolerance: number;
  stemFitMm: number;
  socketFitPct: number;
  /** Switch press travel, mm. */
  travel: number;
  colors: { top: RGB; body: RGB; model: RGB };
}

/** What the import made of the file. Shown on the file line and in the status. */
export interface ModelInfo {
  name: string;
  /** Triangles in the file. */
  fileTriangles: number;
  /** Triangles in the solid the cutters work on. */
  triangles: number;
  /** Size of the model as imported (after any unit fix), mm. */
  sizeMm: [number, number, number];
  /** What had to be done to make it a closed solid, in plain words. Empty = nothing. */
  notes: string[];
}

/** What a build tells the UI beyond the parts: slider ranges and where things landed. */
export interface ModelMeta {
  /** Oriented, scaled model size, mm. */
  sizeMm: [number, number, number];
  /** Cut height actually used (slice), mm above the model's bottom. */
  cutHeightMm: number | null;
  /** Heights a slice can go at all (the switch needs room under and over the cut), mm. Null when
   *  the model is too short for any. */
  cutRangeMm: [number, number] | null;
  /** Where the switch axis landed, in the model frame. */
  switchAt: { x: number; y: number; z: number; rotation: number };
  /** Button centre actually used (button). */
  buttonAt: { x: number; y: number } | null;
  /** Estimated weight of the piece that moves, grams. */
  movingGrams: number;
  /** How much was shaved off the bottom, mm — the automatic amount when `flattenMm` is null. */
  flattenMm: number;
  /** Whether Hide the seam can be built at this cut, and whether this build did. */
  canHideSeam: boolean;
  hideSeam: boolean;
  /** Bottom of the parts in the assembly frame, so the viewer's overlays can follow the model
   *  the viewer re-seats on its plate. */
  assemblyMinZ: number;
}

export const DEFAULT_MODEL_CUT: ModelCutParams = {
  cutter: 'slice',
  rotation: [0, 0, 0],
  // The popular clickers are small and light; 45 mm is about the smallest a slice or a button
  // still has room for a switch in.
  sizeMm: 45,
  flattenMm: null,
  slice: { heightMm: null, hideSeam: true },
  stand: { shape: 'circle', marginMm: 2.5 },
  button: { shape: 'round', sizeMm: 24, raiseMm: 0, x: null, y: null },
  switchNudge: { x: 0, y: 0, rotation: 0 },
  tolerance: 0.4,
  stemFitMm: 0,
  socketFitPct: 0,
  travel: 4.0,
  colors: { top: [255, 106, 19], body: [240, 240, 240], model: [240, 240, 240] },
};
