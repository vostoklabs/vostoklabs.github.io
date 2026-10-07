// How many fingers an edge gets, and where — decided by the engine, never asked of the
// customer, who should not have to know a finger count.
//
// Fingers (tabs) and the gaps between them are one fixed width, `target`; the two END segments
// take what is left over, so they always come out between one and two widths — the corner, the
// most worked part of every piece, keeps the most wood, and every finger sits a full width or more
// from it. Fed 4.3 t tabs it gives 3 tabs and 17.75 mm ends on a 100 mm edge and
// 4 tabs and 14.85 mm ends on a 120 mm one. The
// piece that owns the corners keeps both ends, so the pattern is symmetric about the middle of the
// edge and two pieces walking it from opposite ends get the same answer.
//
// The width aims at `target` — about 3.3 sheets for a plain finger (10 mm in 3 mm ply), 4.3 for a
// flex tab. An edge too short for one finger that wide gets one narrower finger, never under
// `min` (below which ply fingers snap across the grain); an edge too short even for that gets
// none, and the caller says so.

export interface FingerPlan {
  /** The `b` piece's fingers: [start, end] along the edge, in the range's own coordinates. */
  intervals: [number, number][];
  /** The finger width the edge came out at, mm. */
  width: number;
}

/** The default finger width for a sheet `t` mm thick. */
export const fingerTarget = (t: number): number => Math.max(6, Math.min(24, 3.3 * t));
/** The narrowest finger the engine will draw. */
export const fingerMin = (t: number): number => Math.max(3, 1.6 * t);

/** A flex tab is wider: it carries two slits, each an arm's width (a sheet) in from its side, and
 *  the middle between them: 13 mm tabs in 3 mm ply with the slits 3 mm in. */
export const flexTarget = (t: number): number => Math.max(10, Math.min(32, 4.3 * t));
/** The narrowest flex tab: under it the arms would be thinner than half a sheet. A tab planned
 *  narrower still (a short edge) is a plain finger. */
export const flexMin = (t: number): number => Math.max(5, 2.2 * t);

/**
 * Fingers along `[lo, hi]`, `target` mm wide with `target` mm gaps, the leftover in the two ends.
 * `count` forces the number of fingers, spread evenly (an override; nothing in the app sets it).
 */
export function planFingers(lo: number, hi: number, target: number, min: number, count?: number): FingerPlan {
  const len = hi - lo;
  if (len <= 0) return { intervals: [], width: 0 };
  if (count !== undefined) return even(lo, len, Math.max(1, count), min);
  // As many fingers as fit with an end of at least one width each side.
  const n = Math.floor((len - target) / (2 * target));
  if (n >= 1) {
    const end = (len - (2 * n - 1) * target) / 2;
    const intervals: [number, number][] = [];
    for (let k = 0; k < n; k++) intervals.push([lo + end + 2 * k * target, lo + end + 2 * k * target + target]);
    return { intervals, width: target };
  }
  // Too short for one full-width finger with its ends: one narrower finger in the middle third.
  return even(lo, len, 1, min);
}

/** `n` fingers in `2n + 1` equal segments — the fallback for a short edge (and a forced count). */
function even(lo: number, len: number, count: number, min: number): FingerPlan {
  let n = count;
  while (n > 1 && len / (2 * n + 1) < min) n--;
  const s = len / (2 * n + 1);
  // One finger narrower than the minimum is weaker than no finger: the edge is left plain and
  // the caller warns.
  if (s < min * 0.75) return { intervals: [], width: 0 };
  const intervals: [number, number][] = [];
  for (let k = 0; k < n; k++) intervals.push([lo + (2 * k + 1) * s, lo + (2 * k + 2) * s]);
  return { intervals, width: s };
}

/**
 * Feet along a wall's bottom edge `len` long: how many, so the span between two never runs
 * past `maxSpan` mm. Two at the corners always; one more for every span that would be longer.
 */
export function footCount(len: number, maxSpan: number): number {
  return Math.max(2, Math.ceil(len / maxSpan) + 1);
}
