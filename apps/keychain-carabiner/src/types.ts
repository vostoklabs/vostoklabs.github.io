import type { SetSettings } from './state';
import type { ShapeGeom, Ring } from './shapes';

/**
 * What the worker needs to build a set: the settings, the three silhouettes already
 * resolved to rings, and the icon glyphs already traced to contours.
 *
 * Resolution happens on the main thread because the shape registry, the SVG parser and
 * the font all live there; the worker only ever sees arrays of numbers. That is also what
 * makes `buildSet` portable — a host that already has its own shapes and glyphs can call it
 * with no registry at all.
 */
export interface BuildParams extends SetSettings {
  hookGeom: ShapeGeom;
  linkGeom: ShapeGeom;
  charmGeom: ShapeGeom;
  /** Glyph contours in font units (any scale; the builder fits them to `iconSize`). Empty = none. */
  iconContours: number[][][];
  charmIconContours: number[][][];
  /** Usable plate, mm — where the parts are laid out. */
  plate: [number, number];
}

export type GeometryRequest =
  | { type: 'init' }
  | { type: 'build'; params: BuildParams };

/** The one part shape the viewer and the exporter both speak. */
export interface PartMesh {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: [number, number, number];
}

/**
 * Where the hook ended up, so the main thread can turn a point on the screen into an icon
 * position: the hook's outline in millimetres as built (before any layout shift), and the
 * shift each layout applied to it.
 */
export interface HookFrame {
  ring: Ring;
  thick: number;
  /** Where the icon's centre ended up, hook-local; null when there is no icon. */
  iconCentre: [number, number] | null;
  /** Print layout: hook-local (x, y) → world (x + dx, y + dy), top face at z = thick. */
  printOffset: [number, number];
  /** Assembled layout hangs vertically: hook-local (x, y) → world (x + dx, −thick…0, y + dz),
   *  top face at y = −thick. */
  assembledOffset: [number, number];
}

/** How the chain hangs in the assembled layout: the fixed point it hangs from, then each
 *  element top to bottom with the assembled part indices it owns, where it hangs by (top)
 *  and where the next one hangs from (bottom). What the dangle animates. */
export interface ChainInfo {
  pivot: [number, number, number];
  elements: { parts: number[]; top: [number, number, number]; bottom: [number, number, number] }[];
}

export interface BuildStats {
  /** Overall bounding box of the laid-out set, mm. */
  size: [number, number, number];
  /** How many provenance voids landed in the hook. Dev information; never shown as a number. */
  marks: number;
  ms: number;
}

export type GeometryResponse =
  | { type: 'ready' }
  | {
      type: 'parts';
      /** As printed: every part flat on the plate. This is what exports. */
      parts: PartMesh[];
      /** As worn: chain interlinked, charm hanging. Preview only. */
      assembled: PartMesh[];
      chain: ChainInfo | null;
      hookFrame: HookFrame;
      warnings: string[];
      stats: BuildStats;
    }
  | { type: 'error'; message: string };
