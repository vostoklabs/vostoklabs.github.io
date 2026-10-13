// A pattern on a frame's border, from the shelf's pattern engine: the face between the outline and
// the window, clear of the words, filled as a flush second colour. Runs on the screen's side (the
// engine is plain arithmetic); the worker clips what crosses the face's edge and inlays the rest.
import { pointInRing } from '@vostok/shapes';
import { fillShape, patternById, type PatternDef } from '@vostok/patterns';
import { FIT, type Box, type FrameLayout } from './geometry/layout';
import { area, ccw, cw, roundedBox, roundedBoxR, type Ring } from './geometry/outline';

let library: Promise<PatternDef[]> | null = null;

/** The pattern by id: one of the engine's own, or a `pm-` tile from the library, which loads only
 *  when a library tile is actually used. */
export async function patternDefFor(id: string): Promise<PatternDef | null> {
  if (id.startsWith('pm-')) {
    library ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
    return (await library).find((d) => d.id === id) ?? null;
  }
  return patternById(id) ?? null;
}

/** Whether this frame has a border a pattern can fill: a flat face round the window. */
export function takesPattern(L: FrameLayout): boolean {
  return L.spec.outline !== 'squiggle' && L.spec.outline !== 'ricrac' && !L.music && !L.social;
}

const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

/** The pattern's pieces, and the face they are clipped to: its outline counter-clockwise, the
 *  window's and the words' holes clockwise. */
export interface PatternInk {
  rings: Ring[];
  region: Ring[];
}

/**
 * The pattern on the face, moved `dx`, `dy` mm. A piece wholly on the face stays as it is. One that
 * crosses the face's edge is dropped when it is a small motif (a star, a dot: half of one looks
 * broken) and kept for the worker to cut along the edge when it is bigger (a row of scales, a wave,
 * a check), so a pattern of long pieces reaches every side rather than only the widest.
 */
export async function patternInk(L: FrameLayout, id: string, scale: number, dx = 0, dy = 0): Promise<PatternInk | null> {
  if (!id || id === 'none' || !takesPattern(L)) return null;
  const def = await patternDefFor(id);
  if (!def) return null;
  // The face: the plain body less a margin at the edge (and its chamfer), with holes where the
  // window opens on the face and where the words go.
  const edge = 1.6 + L.profile.chamfer;
  const outer = ccw(roundedBoxR(grow(L.body, -edge), L.radii.map((r) => Math.max(0.5, r - edge)) as FrameLayout['radii']));
  const w = L.window;
  const open = L.profile.bevel + 1.4;
  const holes: Ring[] = [
    cw(roundedBoxR({ x0: w.cx - w.w / 2 - open, x1: w.cx + w.w / 2 + open, y0: w.cy - w.h / 2 - open, y1: w.cy + w.h / 2 + open }, w.radii.map((r) => r + open) as FrameLayout['radii'])),
    ...L.captions.map((c) => cw(roundedBox(grow(c, 1.4), 1.5))),
  ];
  const opts = { op: 'engrave' as const, scale, dx, dy, strokeWidth: Math.max(0.9, FIT.inlay + 0.3) };
  const fill = fillShape([[outer, ...holes]], def, { ...opts, partial: 'keep' });

  const onFace = (p: [number, number]) => pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
  // A pattern of separate shapes (one the engine could also cut out) has motifs; its small ones
  // are no longer than half the border is wide. A pattern of lines comes as short pieces of stroke
  // that only become lines once united: none of them is a motif, all are clipped.
  const motifs = def.ops.includes('cut');
  const motif = 0.5 * (L.rim - edge - open + FIT.lipOver);
  const rings: Ring[] = [];
  for (const island of fill.shapes) {
    const [o, ...h] = island as Ring[];
    if (!o || o.length < 3 || Math.abs(area(o)) < 1e-3) continue;
    if (motifs && !o.every(onFace)) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (Math.max(x1 - x0, y1 - y0) <= motif) continue;
    }
    rings.push(ccw(o), ...h.filter((r) => r.length >= 3).map(cw));
  }
  return { rings, region: [outer, ...holes] };
}
