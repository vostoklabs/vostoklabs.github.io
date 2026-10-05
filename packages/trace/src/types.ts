// The tracer's contract, as the clicker defined it. Normalised geometry: the silhouette fits a
// unit box (longest side = 1), centred on the origin, Y up. The app decides the millimetres.
export type RGB = [number, number, number];

/** A closed 2D ring (list of [x,y]); EvenOdd fill handles outer/hole nesting. */
export type Ring = [number, number][];

export interface RegionSet {
  /** One entry per palette colour actually used. */
  regions: { quantRgb: RGB; components: { rings: Ring[]; coverage: number }[]; coverage: number }[];
  /** Union silhouette of all foreground pixels. */
  outline: Ring[];
  /** Aspect (width/height) of the source silhouette, for reference. */
  aspect: number;
  /** Text only: longest side relative to the same text laid out with default typography. */
  sizeMul?: number;
  /** The traced artwork's longest side in MILLIMETRES, when the file declared a real size
   *  (`width="142.36mm"` and a viewBox). Absent for clip art, which has no true size — and for
   *  anything measured in px. A caller that must not rescale the drawing reads this. */
  mm?: number;
}

export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9';

/** Bambu-style image preprocessing. Adjustment values are multipliers, 1 = neutral. */
export interface PreprocessParams {
  cropRatio: CropRatio;
  keepBackground: boolean;
  thicknessMm: number;
  exposure: number;
  contrast: number;
  saturation: number;
  brightness: number;
  whiteBalance: number;
  highlights: number;
  shadows: number;
}

export const DEFAULT_PREPROCESS: PreprocessParams = {
  cropRatio: 'free',
  keepBackground: false,
  thicknessMm: 1,
  exposure: 1,
  contrast: 1,
  saturation: 1,
  brightness: 1,
  whiteBalance: 1,
  highlights: 1,
  shadows: 1,
};
