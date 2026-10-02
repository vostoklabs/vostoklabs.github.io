/** The 2-D shape editor (private). Resolves to a stub in a public clone (see vite.config.ts). */
declare module 'virtual:shape-editor' {
  import type { BaseShapeKind, Ring } from './types';
  import type { ShapeEntry } from './shapes/directory';

  export type ShapeEditorResult =
    | {
      kind: 'preset';
      baseShape: BaseShapeKind;
      shapeSides: number;
      shapeCornerPct: number;
      shapeArmPct: number;
      fixedSize: { w: number; h: number } | null;
    }
    | {
      kind: 'drawn';
      rings: Ring[];
      fixedSize: { w: number; h: number } | null;
      packShapeToken?: string | null;
    };

  export interface ShapeEditorOptions {
    shapes: ShapeEntry[];
    current: {
      baseShape: BaseShapeKind;
      packShapeToken: string | null;
      shapeSides: number;
      shapeCornerPct: number;
      shapeArmPct: number;
      fixedSize: { w: number; h: number } | null;
      rings: Ring[] | null;
    };
    spanMm: number;
    switchColumnMm: number;
    switches: { x: number; y: number }[];
  }

  export function openShapeEditor(opts: ShapeEditorOptions): Promise<ShapeEditorResult | null>;
}
