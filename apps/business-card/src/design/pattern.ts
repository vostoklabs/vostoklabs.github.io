// A template's pattern area, filled by the shelf's pattern engine for a print.
//
// The same engine and picker Laser Studio uses; what is this product's own is how a print makes the
// fill: IN COLOUR (raised or inlaid with the lettering) or CARVED into the face, the pattern's
// regions and its lines, the lines widened into bands a nozzle prints; or CUT right through the card,
// where a hole pattern punches its holes and a line pattern becomes a lattice whose faces the worker
// works out with its booleans.
import { fillShape, patternById, resolveParams, type PatternDef } from '@vostok/patterns';
import type { Shapes } from '@vostok/shapes';
import type { PatternPart } from './types';

/** What a pattern falls back to when an id names nothing the engine knows. */
const FALLBACK = 'honeycomb';

let library: Promise<PatternDef[]> | null = null;

/** The chosen pattern, whichever half of the library it is from. The tile data loads only when a
 *  library tile is actually used. */
export async function patternDefFor(id: string): Promise<PatternDef> {
  if (id.startsWith('pm-')) {
    library ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
    const lib = await library;
    const found = lib.find((d) => d.id === id);
    if (found) return found;
  }
  return patternById(id) ?? patternById(FALLBACK)!;
}

/** The narrowest band a raised pattern line is printed as, mm: two lines of a 0.4 mm nozzle less
 *  their overlap, the width a band holds its shape at. */
export const PRINT_BAND = 0.7;
/** The strut a lattice cut through the card keeps, mm, and the least card between two holes. */
export const PRINT_WEB = 1.4;
/** The narrowest finger of card a cut may leave inside one opening, mm. */
const PRINT_THINNEST = 0.8;

export interface PatternAsk {
  id: string;
  /** Zoom, 1 = the pattern's own size. */
  scale: number;
  angle: number;
  /** In colour (raised or inlaid with the lettering), carved into the face, or cut through. */
  mode: 'colour' | 'carved' | 'cut';
  colour: string;
}

export interface PatternOpts {
  /** Air between the pattern and the region's edge, mm. */
  inset: number;
  /** Slide the pattern, mm. */
  dx?: number;
  dy?: number;
  /** The pattern's own parameters a template fixes (Rays' count on a card). */
  params?: Record<string, number>;
}

/**
 * `region` (islands of rings; holes are reserves the pattern keeps clear of) filled with the chosen
 * pattern, for a print. The engine's sentences come back as notes: a fill that cuts nothing is not
 * a broken card, the card simply has no pattern there.
 */
export async function fillPattern(region: Shapes, ask: PatternAsk, o: PatternOpts): Promise<{ part: PatternPart | null; notes: string[] }> {
  if (!region.length) return { part: null, notes: [] };
  const def = await patternDefFor(ask.id);
  const params = { ...(o.params ?? {}) };
  const placed = { scale: ask.scale, angle: ask.angle, dx: o.dx ?? 0, dy: o.dy ?? 0 };

  if (ask.mode === 'cut') {
    const fill = fillShape(region, def, { op: 'cut', params, ...placed, web: PRINT_WEB, inset: Math.max(o.inset, PRINT_WEB), thinnest: PRINT_THINNEST, slitWidth: PRINT_BAND });
    if (fill.lattice) return { part: { mode: 'cut', colour: ask.colour, shapes: [], lattice: fill.lattice }, notes: fill.warnings };
    return { part: fill.shapes.length ? { mode: 'cut', colour: ask.colour, shapes: fill.shapes } : null, notes: fill.warnings };
  }

  // In colour or carved: every line a band at least PRINT_BAND wide (a stroke tile's own stroke where
  // it is wider), and the regions as drawn.
  const own = def.strokeWidth ? def.strokeWidth(resolveParams(def, params)) : 0;
  const fill = fillShape(region, def, { op: 'engrave', params, ...placed, inset: o.inset, strokeWidth: Math.max(PRINT_BAND, own) });
  if (!fill.shapes.length) return { part: null, notes: fill.warnings };
  return {
    part: {
      mode: ask.mode,
      colour: ask.colour,
      shapes: fill.shapes,
      ...(fill.zone ? { keep: fill.zone } : {}),
      ...(fill.erode ? { erode: fill.erode } : {}),
    },
    notes: fill.warnings,
  };
}
