import type { LineBox } from './geometry/textLayout';

export interface BuildParams {
  name: string;
  secondLine: string;
  font: string;
  layout: 'horizontal' | 'vertical';
  style: 'raised' | 'engraved';
  size: number; // text_size
  line2Scale: number; // line2_scale
  baseThickness: number; // base_thickness
  textThickness: number; // text_thickness
  outlineWidth: number; // outline_width
  smoothing: number; // smoothing
  /** Plate silhouette: hug the letters ('outline') or a rounded rectangle behind them. */
  plateShape: 'outline' | 'rectangle';
  /** Top-edge bevel in mm on the plate & raised letters (0 = sharp/off). */
  chamfer: number;
  ringStyle: 'loop' | 'corner';
  holeDia: number; // hole_dia
  ringThickness: number; // ring_thickness
  ringPosX: number; // ring_pos_x
  ringPosY: number; // ring_pos_y
  haloWidth: number; // halo_width
  haloThickness: number; // halo_thickness
  colorScheme: 'single' | 'plate-text' | 'plate-halo-text';
  plateColor: string;
  haloColor: string;
  textColor: string;

  // --- Typography ---
  /** Baseline-to-baseline spacing between the two lines (fraction of the summed sizes). */
  lineSpacing: number;
  /** Tracking added between glyphs, as a fraction of the em size (negative = squashed). */
  letterSpacing: number;
  /** Outline dilation applied to the glyphs, in mm (positive = bolder, negative = thinner). */
  boldness: number;

  // --- Print mode ---
  /** 'ams' = auto multi-material; 'noams' = single nozzle, manual filament swap per Z band. */
  printMode: 'ams' | 'noams';
  /** Layer height used to snap the colour bands in no-AMS mode. */
  layerHeight: number;

  /** Per-line bounding boxes (line 1, optional line 2) from the text layout. */
  lines: LineBox[];
}

export type GeometryRequest =
  | { type: 'build'; textContours: number[][][]; params: BuildParams }
  | { type: 'init' };

export interface PartMesh {
  name: string;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  colorRgb: [number, number, number];
}

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: PartMesh[]; warnings: string[] }
  | { type: 'error'; message: string };
