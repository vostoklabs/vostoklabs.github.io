// A placed symbol's outline: its rings, turned and mirrored the way its inspector says, still
// centred and still about a unit across. Pure, so Text and Blocks share it and the tests reach it.
import type { Ring } from '../types';

/** How one placed symbol looks, as its inspector sets it (the kit's `SymbolTransform`). */
export interface SymbolLook {
  /** 1 = the size a symbol is drawn at by default. */
  scale: number;
  /** Offsets as a fraction of the symbol's size; +y is up. */
  dx: number;
  dy: number;
  /** Degrees, anticlockwise. */
  rotation: number;
  /** Mirrored left to right, before it is turned. */
  flip: boolean;
}

export const PLAIN_LOOK: SymbolLook = { scale: 1, dx: 0, dy: 0, rotation: 0, flip: false };

/** The look a stored symbol has, with anything missing or not a number at its plain value. */
export function lookOf(v: Partial<SymbolLook> | undefined): SymbolLook {
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    scale: Math.max(0.25, Math.min(2, num(v?.scale, 1))),
    dx: Math.max(-1, Math.min(1, num(v?.dx, 0))),
    dy: Math.max(-1, Math.min(1, num(v?.dy, 0))),
    rotation: num(v?.rotation, 0),
    flip: v?.flip === true,
  };
}

/** Rings centred on the origin with the longest side 1 — the frame `parseSvg` hands back. */
export function normaliseRings(rings: Ring[]): Ring[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const side = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(side) || side <= 0) return [];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return rings.map((r) => r.map(([x, y]) => [(x - cx) / side, (y - cy) / side] as [number, number]));
}

/**
 * The rings mirrored (when flipped) and turned about their centre. Scale and offset are left to
 * the caller: a text line and a keycap measure them against different things.
 */
export function lookRings(rings: Ring[], look: Pick<SymbolLook, 'rotation' | 'flip'>): Ring[] {
  const a = (look.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const flip = look.flip ? -1 : 1;
  const turned = rings.map((r) => {
    const out = r.map(([x, y]) => {
      const fx = x * flip;
      return [fx * c - y * s, fx * s + y * c] as [number, number];
    });
    // A mirror reverses every ring's winding; put it back so outlines and holes still fill
    // the way the source drew them under either fill rule.
    return look.flip ? out.reverse() : out;
  });
  return turned;
}
