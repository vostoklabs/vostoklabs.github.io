/**
 * Per-face colour painting in a 3MF, decoded.
 *
 * `colors.ts` answers "which filament does this object print in" by joining the slicer's
 * object-to-slot table to its filament list. A painted model does not answer that question at
 * all: every object can carry the same extruder, the join is correctly empty, and the model is
 * still two colours, because the colour lives on the **triangles**, in an attribute Bambu Studio
 * writes and the 3MF core spec does not define:
 *
 * ```xml
 * <triangle v1="140" v2="169" v3="170" paint_color="0C"/>
 * ```
 *
 * `paint_color` is a serialised subdivision tree: the slicer paints by recursively splitting a
 * triangle until the painted boundary is where it was drawn, then stores that tree rather than
 * the resulting mesh. So reading it means rebuilding the subdivision, not just reading a colour,
 * and one triangle can carry hundreds of nibbles.
 *
 * ## The encoding
 *
 * The string is a bitstream packed four bits at a time, **and the nibbles are written in reverse
 * order**: the last character of the string is the root of the tree. Read forwards, most painted
 * triangles of a real file do not consume their string exactly; read backwards, every one does.
 *
 * Each node is one nibble `v`:
 *
 * - `v & 0b11` is how many of the triangle's sides are split. Zero means a leaf.
 * - a leaf's state is `v >> 2`; the value `0b11` means "extended", and the *next* nibble carries
 *   `state - 3`. So `0C` is state 3 and `4` is state 1.
 * - a split node's `v >> 2` is its **special side**, and `(v & 0b11) + 1` children follow, depth
 *   first.
 *
 * A state is a **1-based filament slot**: `1` is the first filament, `3` the third. Zero means
 * unpainted: the triangle keeps whatever colour its object was assigned.
 *
 * ## How this was checked
 *
 * Painted files decoded with this and rasterised top-down reproduce the slicer's own plate
 * preview with clean edges. A wrong split scheme produces the right silhouette in noise; this
 * produces the picture.
 */

/** A point, as three numbers. Kept as a tuple to avoid an object per subdivision. */
type P3 = readonly [number, number, number];

/** Emitted for every leaf of the tree: a sub-triangle and the filament slot it prints in. */
export type PaintedTriangle = (a: P3, b: P3, c: P3, filament: number) => void;

/** Depth cap: a painted triangle nests about six deep in practice, never sixteen. */
const MAX_DEPTH = 16;

/**
 * Sub-triangles one triangle can produce before it is treated as malformed.
 *
 * A corrupt string cannot be told from a legitimate one until it has been walked, so the walk is
 * bounded rather than trusted. 4096 is far past anything a slicer writes.
 */
const MAX_SUBTRIANGLES = 4096;

const midpoint = (p: P3, q: P3): P3 => [
  (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2,
];

/**
 * Walks one triangle's `paint_color`, calling `emit` for each coloured sub-triangle.
 *
 * Returns false when the string does not decode: it ran out of nibbles, nested too deep, or
 * produced absurdly many pieces. A false return means **nothing was emitted that the caller
 * should keep**: paint that cannot be read is left unpainted, because a model in the wrong
 * colours is worse than one in none.
 */
export function forEachPaintedTriangle(
  code: string,
  a: P3,
  b: P3,
  c: P3,
  emit: PaintedTriangle,
): boolean {
  if (!code) return false;

  // Nibbles are read from the end of the string; see the header.
  let at = code.length - 1;
  let emitted = 0;
  const pending: { a: P3; b: P3; c: P3; filament: number }[] = [];

  const nextNibble = (): number => {
    if (at < 0) return -1;
    const v = parseInt(code[at--] ?? '', 16);
    return Number.isNaN(v) ? -1 : v;
  };

  const walk = (p: P3, q: P3, r: P3, depth: number): boolean => {
    if (depth > MAX_DEPTH || ++emitted > MAX_SUBTRIANGLES) return false;
    const v = nextNibble();
    if (v < 0) return false;

    const splitSides = v & 0b11;
    if (splitSides === 0) {
      let filament = v >> 2;
      if (filament === 0b11) {
        // Extended: the next nibble carries everything above the two bits that fit.
        const extra = nextNibble();
        if (extra < 0) return false;
        filament = 3 + extra;
      }
      pending.push({ a: p, b: q, c: r, filament });
      return true;
    }

    // The special side is the rotation the children are described in: vertex `special` becomes
    // the first vertex, and the split midpoints are taken from there.
    const special = (v >> 2) % 3;
    const verts: [P3, P3, P3] = [p, q, r];
    const v0 = verts[special as 0 | 1 | 2];
    const v1 = verts[((special + 1) % 3) as 0 | 1 | 2];
    const v2 = verts[((special + 2) % 3) as 0 | 1 | 2];

    let children: [P3, P3, P3][];
    if (splitSides === 1) {
      const m = midpoint(v1, v2);
      children = [[v0, v1, m], [m, v2, v0]];
    } else if (splitSides === 2) {
      const m1 = midpoint(v0, v1);
      const m2 = midpoint(v1, v2);
      children = [[v0, m1, v2], [m1, v1, m2], [m2, v2, m1]];
    } else {
      const m1 = midpoint(v0, v1);
      const m2 = midpoint(v1, v2);
      const m3 = midpoint(v2, v0);
      children = [[v0, m1, m3], [m1, v1, m2], [m2, v2, m3], [m1, m2, m3]];
    }

    for (const [ca, cb, cc] of children) {
      if (!walk(ca, cb, cc, depth + 1)) return false;
    }
    return true;
  };

  // Every nibble must be consumed. A string with anything left over was not understood, whatever
  // it decoded into on the way; that is the check that settles the nibble order.
  if (!walk(a, b, c, 0) || at >= 0) return false;

  for (const t of pending) emit(t.a, t.b, t.c, t.filament);
  return true;
}

/**
 * Whether a triangle's paint is a single colour over the whole face.
 *
 * The common case by a wide margin, and worth answering without walking a tree or allocating one
 * sub-triangle. Returns null when the code is anything more than one leaf.
 */
export function flatPaintState(code: string): number | null {
  if (code.length === 0 || code.length > 2) return null;
  const last = parseInt(code[code.length - 1] ?? '', 16);
  if (Number.isNaN(last) || (last & 0b11) !== 0) return null;

  const state = last >> 2;
  if (state !== 0b11) return code.length === 1 ? state : null;
  if (code.length !== 2) return null;

  const extra = parseInt(code[0] ?? '', 16);
  return Number.isNaN(extra) ? null : 3 + extra;
}
