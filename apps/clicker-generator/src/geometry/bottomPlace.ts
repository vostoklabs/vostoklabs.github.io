/*
  Where the bottom picture sits on the underside: the customer's move, turn and size on top of the
  place the engine picks. Pure, no manifold and no DOM, so the build, the rail and the 2D view
  share one copy of the arithmetic and node can test it.

  Everything is seen from below, the way the underside is looked at: Left / right is left and right
  with the clicker turned over, Turn is counter-clockwise as seen from there. The engine still picks
  the size (the largest that fits the flat of the underside) and the middle of that area; `scale`
  multiplies the size and (x, y) moves the picture from that middle. Past the area it is cut off,
  as the top picture is by the cap's frame.
*/

export interface BottomPlace {
  /** mm from the middle of the area the picture may print in, seen from below; +x right, +y up. */
  x: number;
  y: number;
  /** Degrees, counter-clockwise seen from below. */
  rotation: number;
  /** Times the size the engine picks: 1 is that size. */
  scale: number;
}

export const DEFAULT_BOTTOM_PLACE: Readonly<BottomPlace> = Object.freeze({ x: 0, y: 0, rotation: 0, scale: 1 });

/** The ranges the rail's rows offer and a saved project is held to. The move matches the top
 *  picture's rows; the size goes from a little under a third to twice what the engine picks. */
export const BOTTOM_PLACE_LIMITS = {
  x: [-25, 25],
  y: [-25, 25],
  rotation: [-180, 180],
  scale: [0.3, 2],
} as const satisfies Record<keyof BottomPlace, readonly [number, number]>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turn degrees into (-180, 180]. */
export function wrapTurn(d: number): number {
  const r = ((d % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

/** Whether a place is the engine's own: then the build is the one it was before places existed. */
export function isDefaultPlace(p: BottomPlace | null | undefined): boolean {
  return !p || (p.x === 0 && p.y === 0 && p.rotation === 0 && p.scale === 1);
}

/** A place held to its ranges; a broken or missing value takes the default. Turns wrap. */
export function cleanBottomPlace(raw: unknown): BottomPlace {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (k: keyof BottomPlace) => {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_BOTTOM_PLACE[k];
    const [lo, hi] = BOTTOM_PLACE_LIMITS[k];
    return k === 'rotation' ? clamp(wrapTurn(v), lo, hi) : clamp(v, lo, hi);
  };
  return { x: num('x'), y: num('y'), rotation: num('rotation'), scale: num('scale') };
}

/**
 * A normalised picture point (longest side 1, centred, Y-up) on the underside, in the build's
 * frame (seen from above): turned and sized and moved as seen from below, then mirrored in X,
 * since what is on the right seen from below is on the left seen from above. `sizeMm` is the
 * engine's size; (cx, cy) the middle of the area, seen from above.
 *
 * With the default place this is exactly `[-x * sizeMm + cx, y * sizeMm + cy]`, the placement the
 * build made before places existed, to the bit.
 */
export function bottomPoint(x: number, y: number, sizeMm: number, cx: number, cy: number, p: BottomPlace = DEFAULT_BOTTOM_PLACE): [number, number] {
  if (isDefaultPlace(p)) return [-x * sizeMm + cx, y * sizeMm + cy];
  let u = x;
  let v = y;
  if (p.rotation !== 0) {
    const a = (p.rotation * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    u = x * c - y * s;
    v = x * s + y * c;
  }
  const size = sizeMm * p.scale;
  return [-(u * size + p.x) + cx, v * size + p.y + cy];
}

/** Where the picture's middle is in the 2D view of the underside (seen from below: the build's X
 *  mirrored), for a place, given the middle of the area seen from above. */
export function undersideCentre(cx: number, cy: number, p: BottomPlace): [number, number] {
  return [-cx + p.x, cy + p.y];
}

/** A finished drag on the underside view, as the place it makes: the box's middle and turn, and its
 *  width against the picture's width at the engine's size. Rounded as the rail's rows are (0.1 mm,
 *  1°, 1 %), and held to the ranges. */
export function placeFromBox(
  box: { cx: number; cy: number; w: number; rotation: number },
  area: { cx: number; cy: number; autoMm: number },
  artW: number,
): BottomPlace {
  const w0 = artW * area.autoMm;
  return cleanBottomPlace({
    x: Math.round((box.cx + area.cx) * 10) / 10,
    y: Math.round((box.cy - area.cy) * 10) / 10,
    rotation: Math.round(wrapTurn(box.rotation)),
    scale: w0 > 0 ? Math.round((box.w / w0) * 100) / 100 : 1,
  });
}

/** The Bottom category's pad: 0.5 mm a press, and 5° a press of a turn corner (a picture wants a
 *  finer turn than a switch). */
export const BOTTOM_PAD = { stepMm: 0.5, turnDeg: 5 } as const;

/** One press of the pad's arrows, seen from below: the place moved one step, onto the 0.1 mm grid
 *  and held to its range. Size and turn are kept. */
export function nudgeBottomPlace(p: BottomPlace, dir: 'up' | 'down' | 'left' | 'right'): BottomPlace {
  const dx = dir === 'right' ? BOTTOM_PAD.stepMm : dir === 'left' ? -BOTTOM_PAD.stepMm : 0;
  const dy = dir === 'up' ? BOTTOM_PAD.stepMm : dir === 'down' ? -BOTTOM_PAD.stepMm : 0;
  const grid = (v: number) => Math.round(v * 10) / 10;
  return cleanBottomPlace({ ...p, x: grid(p.x + dx), y: grid(p.y + dy) });
}

/** One press of a turn corner: `delta` degrees added (left is positive, the pad's way), wrapped. */
export function turnBottomPlace(p: BottomPlace, delta: number): BottomPlace {
  return cleanBottomPlace({ ...p, rotation: Math.round(p.rotation + delta) });
}

/** The pad's readout: where the picture is from the middle, in words, and its turn. */
export function bottomPlaceReadout(p: BottomPlace): string {
  const mm = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)} mm ${v > 0 ? pos : neg}`;
  const parts = [
    ...(Math.abs(p.x) >= 0.05 ? [mm(p.x, 'right', 'left')] : []),
    ...(Math.abs(p.y) >= 0.05 ? [mm(p.y, 'up', 'down')] : []),
    ...(Math.round(p.rotation) !== 0 ? [`turned ${Math.round(p.rotation)}°`] : []),
  ];
  return parts.length ? parts.join(' · ') : 'In the middle';
}
