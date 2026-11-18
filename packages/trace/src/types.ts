// The tracer's contract, as the clicker defined it. Normalised geometry: the silhouette fits a
// unit box (longest side = 1), centred on the origin, Y up. The app decides the millimetres.
export type RGB = [number, number, number];

/** A closed 2D ring (list of [x,y]); EvenOdd fill handles outer/hole nesting. A region's `lines`
 *  use the same type for an open polyline. */
export type Ring = [number, number][];

/** One run of a drawing in one colour. `paint` is its place in the order the file paints things,
 *  higher on top; numbers are shared across a set's regions. */
export interface PaintLayer {
  rings: Ring[];
  paint: number;
}

export interface RegionSet {
  /** One entry per palette colour actually used. */
  regions: {
    quantRgb: RGB;
    /** `layers`: the SVG reader's `asPainted` only, on a drawing of more than one colour. The same
     *  rings as `rings`, split by when they were painted, so a caller can show what the file
     *  shows where colours overlap. `rings` alone cannot say which colour is on top. */
    components: { rings: Ring[]; coverage: number; layers?: PaintLayer[] }[];
    coverage: number;
    /** The SVG reader's `outlinesAsLines` only: this colour's outlines as the lines they follow,
     *  open polylines in the same frame as the rings, never filled. A colour drawn only in lines
     *  has no rings and no coverage. The image tracer never sets it. */
    lines?: Ring[];
  }[];
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

/** A change the customer made to what gets traced, kept as a place in the picture rather than a
 *  traced shape, so it survives every retrace (another colour count, smoothing, size). `x` and
 *  `y` are fractions 0..1 of the picture's width and height, `x = (px + 0.5) / width`.
 *   - `remove`: the area under (x, y), same colour and connected, is taken out;
 *   - `restore`: the area taken out under (x, y), by an edit or by the background remover, comes back;
 *   - `dropColour`: every pixel of this colour, anywhere, is taken out. */
export type PictureEdit =
  | { op: 'remove'; x: number; y: number }
  | { op: 'restore'; x: number; y: number }
  | { op: 'dropColour'; rgb: RGB };

/** A crop, as fractions 0..1 of the picture: left, top, width, height. Applied as a mask after
 *  the background removal and the edits, never by cutting the pixels (the background remover
 *  needs the whole picture to find the background). */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
