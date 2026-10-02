/*
  manifold-3d's JS glue, less its leaks.

  manifold-3d 3.5.1 wraps its embind classes in a layer of JS (`Module.setup()` in manifold.js),
  and three of its conveniences leave WASM memory behind on every call. The heap never shrinks,
  so a generator that rebuilds on every slider step grows until the tab is reloaded.

  - `new CrossSection(rings, rule)`, and everything that builds one from rings for you
    (`CrossSection.ofPolygons`, `Manifold.extrude(rings, …)`, `cs.add(rings)` and the other
    booleans): `polygons2vec` copies each ring into a vector, pushes that into the list BY COPY,
    and never frees the first copy. 16 bytes a vertex.
  - `cs.toPolygons()`: `vec2polygons` takes a copy of each ring and never frees it. 16 bytes a
    vertex.
  - `cs.extrude(…)`, and `Manifold.extrude(cs, …)`, which calls it: `this._ToPolygons()` is
    handed to `_Extrude` and never freed, 16 bytes a vertex; and with `center` the uncentred
    solid is dropped without a `delete()` — the whole mesh, 864 KB for one 1 000-vertex ring.

  These do what the glue does, through the same embind pieces, and free what it forgets. If a
  later manifold moves those pieces they fall back to the glue: leaking, never wrong. The
  vendored no-eval build (packages/manifold-noeval) carries the identical glue, so they are
  right for both. `slice()`, `project()`, `decompose()`, `offset()` and the booleans between
  two CrossSections or Manifolds are clean already — as long as every result, the ones in the
  middle of a chain included, is deleted.

  `pnpm check:manifold` fails the build when app code calls the leaky three directly.
*/

/** A point as the glue takes one. */
type Pt = readonly number[] | { readonly x: number; readonly y: number };

/** A ring as `toPolygons()` hands one back — structurally @vostok/export's `CutRing`. */
export type Ring = [number, number][];

const FILL_RULE = { EvenOdd: 0, NonZero: 1, Positive: 2, Negative: 3 } as const;
export type FillRule = keyof typeof FILL_RULE;

const isPoint = (p: any): boolean => typeof p?.[0] === 'number' || typeof p?.x === 'number';

/**
 * `new CrossSection(rings, rule)` without the leak. Takes what the glue takes — a list of rings,
 * or one ring on its own — with points as `[x, y]` or `{ x, y }`.
 *
 * The embind class under the glue's wrapper is the constructor of the wrapper's prototype's
 * prototype: `setup()` builds it that way.
 */
export function csOf(wasm: any, rings: readonly (readonly Pt[])[] | readonly Pt[], rule: FillRule = 'Positive'): any {
  const proto = Object.getPrototypeOf(wasm.CrossSection.prototype);
  if (typeof proto?._ToPolygons !== 'function' || typeof wasm.Vector2_vec2 !== 'function') return new wasm.CrossSection(rings, rule);
  const list = new wasm.Vector2_vec2();
  try {
    for (const r of (isPoint(rings[0]) ? [rings] : rings) as readonly (readonly Pt[])[]) {
      const ring = new wasm.Vector_vec2();
      try {
        for (const p of r) ring.push_back(Array.isArray(p) ? { x: p[0], y: p[1] } : p);
        list.push_back(ring);
      } finally {
        ring.delete();
      }
    }
    return new proto.constructor(list, FILL_RULE[rule]);
  } finally {
    list.delete();
  }
}

/** `cs.toPolygons()` without the leak. */
export function ringsOf(cs: any): Ring[] {
  if (typeof cs._ToPolygons !== 'function') return cs.toPolygons();
  const list = cs._ToPolygons();
  try {
    const out: Ring[] = [];
    for (let i = 0, n = list.size(); i < n; i++) {
      const ring = list.get(i);
      try {
        const pts: Ring = [];
        for (let j = 0, m = ring.size(); j < m; j++) {
          const p = ring.get(j);
          pts.push([p.x, p.y]);
        }
        out.push(pts);
      } finally {
        ring.delete();
      }
    }
    return out;
  } finally {
    list.delete();
  }
}

/**
 * `cs.extrude(height, nDivisions, twistDegrees, scaleTop, center)` — and so
 * `Manifold.extrude(cs, …)` — without the leak. The solid is new; `cs` is untouched.
 */
export function extrude(
  wasm: any,
  cs: any,
  height: number,
  nDivisions = 0,
  twistDegrees = 0,
  scaleTop: readonly number[] = [1, 1],
  center = false,
): any {
  if (typeof cs._ToPolygons !== 'function' || typeof wasm._Extrude !== 'function') {
    return cs.extrude(height, nDivisions, twistDegrees, scaleTop, center);
  }
  const polys = cs._ToPolygons();
  let solid: any;
  try {
    solid = wasm._Extrude(polys, height, nDivisions, twistDegrees, { x: scaleTop[0], y: scaleTop[1] });
  } finally {
    polys.delete();
  }
  if (!center) return solid;
  try {
    return solid.translate([0, 0, -height / 2]);
  } finally {
    solid.delete();
  }
}
