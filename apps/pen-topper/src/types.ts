import type { LineBox } from '@vostok/fonts/textLayout';
import type { TopperSettings } from './state';

/**
 * What the worker needs to build a topper: the settings, plus the text already
 * laid out into 2D contours.
 *
 * The layout happens on the main thread because it needs opentype and the parsed
 * font, and a font the user imported lives in main-thread memory. The worker gets
 * plain arrays of numbers and never has to know what a glyph is.
 */
export interface BuildParams extends TopperSettings {
  /** Per-line bounding boxes from the text layout (1 or 2 entries). */
  lines: LineBox[];
}

/** One topper in a batch: its own text, and where its min corner goes on the plate. */
export interface BatchItem {
  label: string;
  textContours: number[][][];
  params: BuildParams;
}

export type GeometryRequest =
  | { type: 'init' }
  | { type: 'build'; textContours: number[][][]; params: BuildParams }
  /* A set runs as ONE message rather than N build messages. Not for the round-trips —
     they are cheap — but because a batch has to be a unit: it reports progress against
     a known total, it can be cancelled as a whole, and a preview rebuild that lands in
     the middle of it must not interleave with the CSG. */
  | { type: 'batch'; items: BatchItem[]; plate: [number, number] }
  | { type: 'cancelBatch' };

/** The one part shape the viewer and the exporter both speak. */
export interface PartMesh {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: [number, number, number];
}

/** A built topper, positioned on the plate. */
export interface BatchResult {
  label: string;
  parts: PartMesh[];
  /** Which plate it landed on. 0 is the first. */
  plate: number;
  warnings: string[];
}

export interface BuildStats {
  /** Overall bounding box of the finished topper, mm. */
  size: [number, number, number];
  /** Modelled bore diameter, mm. */
  bore: number;
  /** What the letters were grown by to hold the bore with no plate. 1 = untouched. */
  letterScale: number;
  /** How deep the hole actually came out, mm. */
  depth: number;
  ms: number;
}

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: PartMesh[]; warnings: string[]; stats: BuildStats }
  | { type: 'batchProgress'; done: number; total: number; label: string }
  | { type: 'batchDone'; results: BatchResult[]; plates: number; cancelled: boolean; ms: number }
  | { type: 'error'; message: string };
