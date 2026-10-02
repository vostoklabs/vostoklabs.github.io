/**
 * Base-shape outlines, as plain arrays of points.
 *
 * No manifold, no WASM, no `track()`, no `.offset()` — every function here is arithmetic that
 * runs anywhere. That is the whole point of the module, and it buys three things:
 *
 *  1. **One definition per shape** — for the ten shapes whose geometry IS one of these
 *     functions. The picker draws their tiles from the same source, so those cannot drift.
 *
 *     Read the caveat at the bottom of this file before repeating that claim as a general one.
 *     Three shapes (heart, star, egg) are BUILT in buildClicker.ts because they need WASM, and
 *     their rings here are ports. A port can drift, and one did.
 *  2. **Exact homogeneity in `rr`.** `buildClicker` scales these by a radius it BINARY-SEARCHES
 *     for. That search only converges if `shape(k·rr) == k·shape(rr)` exactly, and any absolute
 *     millimetre term inside a generator breaks it. Every ring here spans roughly ±1 and is
 *     scaled afterwards, so the property holds by construction rather than by care.
 *  3. **A bounded vertex count.** The search calls the generator up to 66 times per build. A
 *     generator whose point count grew with `rr` would make a slider drag quadratic.
 *
 * A ring is counter-clockwise and closed implicitly (last point joins the first).
 *
 * Ranges are clamped inside each function rather than trusted from the caller: these values
 * arrive from a slider, from a saved project file written by an older build, and from a URL —
 * and a 900-sided polygon or a 1-sided one is a crash, not a shape.
 */
import type { Ring } from '../types';

/* ---------------------------------------------------------------------------------------
   Where the switch goes.

   The MX switch sits at the ORIGIN of the design frame, and a shape's origin is not
   automatically where a switch has room. Centring on the bounding box — the obvious choice, and
   the one that shipped — puts the origin of a triangle a third of the way up from its base,
   where the shape is already narrowing, so the switch column pokes out through the sloping
   sides and the build has to bulge the base to clear it. Ian caught it on the 3-side polygon,
   the 3-point star, the heart and the shield; it is one bug, not four.

   The right centre is the POLE OF INACCESSIBILITY: the interior point furthest from the
   boundary, which is the centre of the largest circle that fits inside the shape. For a circle
   or a square it is the bbox centre and nothing moves. For a triangle it is the incentre. For a
   heart it is up in the lobes, which is exactly where a switch belongs.

   Computed by grid search and refinement rather than exactly — the exact construction differs
   per shape and this has to work on a ring somebody drew. Cheap enough because every ring here
   is memoised (see `memo`), so a shape's pole is found once per distinct parameter value rather
   than on each of the ~66 calls the fit search makes per build.
   ------------------------------------------------------------------------------------ */

/** Distance from a point to a segment. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Signed clearance: distance to the nearest edge, negative outside the ring. */
export function clearance(ring: Ring, px: number, py: number): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    const d = distToSeg(px, py, xj, yj, xi, yi);
    if (d < best) best = d;
  }
  return inside ? best : -best;
}

/** Area centroid — where the shape's mass balances, and where the eye puts its middle. */
export function centroidOf(ring: Ring): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) return [0, 0];
  return [cx / (6 * a), cy / (6 * a)];
}

/** The interior point furthest from the boundary — the centre of the largest inscribed circle. */
export function poleOfInaccessibility(ring: Ring): [number, number] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  let bx = (minX + maxX) / 2;
  let by = (minY + maxY) / 2;
  let best = clearance(ring, bx, by);

  const N = 16;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + (w * i) / N;
      const y = minY + (h * j) / N;
      const c = clearance(ring, x, y);
      if (c > best) { best = c; bx = x; by = y; }
    }
  }
  // Refine: shrink the search box around the winner a few times.
  let step = Math.max(w, h) / N;
  for (let pass = 0; pass < 6; pass++) {
    step /= 2;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = bx + dx * step;
      const y = by + dy * step;
      const c = clearance(ring, x, y);
      if (c > best) { best = c; bx = x; by = y; }
    }
  }
  return [bx, by];
}

/**
 * Move a ring so the origin sits where the switch belongs: the CENTROID, unless the centroid is
 * a bad place for a switch, in which case slide toward the pole only as far as necessary.
 *
 * Three candidate centres, measured on the shapes Ian actually judged (clearance in ring units,
 * bigger is more room for the switch):
 *
 *              bbox centre   centroid   pole
 *   triangle      0.375        0.500     0.488
 *   3-pt star     0.436        0.559     0.545
 *   5-pt star     0.486        0.560     0.556
 *   heart         0.329        0.143     0.511
 *
 * For a triangle and a star the centroid is best on BOTH counts — it looks right and it has the
 * most room — so there is nothing to trade off. The heart is the exception that makes the rule:
 * its centroid sits in the notch between the lobes, which is the worst spot on the shape.
 *
 * Pure pole-centring was the first attempt and it is what made the heart read low: the pole is
 * 0.18 below the centroid, which on a heart is visibly off. Pure centroid would put the switch
 * in the notch. So: start at the centroid, and walk toward the pole only until there is enough
 * room. A shape whose centroid is already fine never moves.
 */
export function switchSpotOf(ring: Ring): [number, number] {
  const [cx, cy] = centroidOf(ring);
  const [px, py] = poleOfInaccessibility(ring);
  const poleClear = clearance(ring, px, py);
  // 0.6 of the best available. Below this the base has to bulge to clear the switch, which is
  // the thing being avoided; above it, the visual centre wins.
  const target = poleClear * 0.6;

  let x = cx;
  let y = cy;
  if (clearance(ring, cx, cy) < target) {
    // 24 steps is finer than the eye can tell at thumbnail size and stops well short of the
    // pole whenever the centroid is merely mediocre rather than bad.
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      x = cx + (px - cx) * t;
      y = cy + (py - cy) * t;
      if (clearance(ring, x, y) >= target) break;
    }
  }
  return [x, y];
}

/** Move a ring so the origin sits on its switch spot. */
export function centreOnSwitchSpot(ring: Ring): Ring {
  const [x, y] = switchSpotOf(ring);
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return ring;
  return ring.map(([rx, ry]) => [rx - x, ry - y] as [number, number]);
}

/** Memoise a pure ring generator on its arguments.
 *
 *  `genShape` is called up to 66 times per build by the fit search, and pole-finding is a grid
 *  search. Without this the search would be the slowest thing in the app; with it, each distinct
 *  shape+parameter is computed once for the life of the page. */
function memo<A extends (number | undefined)[]>(fn: (...a: A) => Ring): (...a: A) => Ring {
  const cache = new Map<string, Ring>();
  return (...args: A): Ring => {
    const key = args.join(',');
    let hit = cache.get(key);
    if (!hit) { hit = fn(...args); cache.set(key, hit); }
    return hit;
  };
}

/**
 * Round every corner of a ring by `r`, in ring units.
 *
 * Each vertex becomes a circular arc tangent to its two edges, with `r` clamped per corner to
 * whatever the two adjacent edges can actually give (never more than half the shorter one), so
 * a short leg is shortened rather than turned inside out.
 *
 * This exists because `buildClicker`'s `makeStar` finishes with a manifold open-close
 * (`offset(-rr)`, `offset(+2rr)`, `offset(-rr)`) that rounds the tips AND the valleys, and
 * nothing outside WASM could reproduce it — so `starRing`, the ring the PICKER draws, was a
 * sharp-cornered star while the model printed a chubby one. That is the heart bug again, one
 * shape over: a tile showing something the build does not produce. The file's own docstring
 * claimed all three ports matched; for the star it was not true.
 *
 * An arc per corner is not the same operation as an open-close, but it agrees with it to first
 * order — both cut the corner back by `r` and leave the edges where they were — and it is
 * symmetric in convex and concave corners, which is the property the star needs. Homogeneous
 * by construction: every term is a length in the ring's own units, so `roundCorners(k·ring,
 * k·r) == k·roundCorners(ring, r)` and the fit search's contract survives.
 */
export function roundCorners(ring: Ring, r: number, perCorner = 6): Ring {
  const n = ring.length;
  if (n < 3 || r <= 1e-9) return ring;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const ax = prev[0] - cur[0];
    const ay = prev[1] - cur[1];
    const bx = next[0] - cur[0];
    const by = next[1] - cur[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) { out.push(cur); continue; }
    const ux = ax / la;
    const uy = ay / la;
    const vx = bx / lb;
    const vy = by / lb;
    // Half-angle between the two edges. A straight-through vertex (cos → -1) needs no arc;
    // a doubled-back one (cos → 1) cannot have one.
    const cos = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    const half = Math.acos(cos) / 2;
    const tan = Math.tan(half);
    if (!(tan > 1e-6) || !isFinite(tan)) { out.push(cur); continue; }
    // How far back along each edge the arc must start, for radius `r`.
    const back = Math.min(r / tan, la / 2, lb / 2);
    const rr = back * tan;
    const p0: [number, number] = [cur[0] + ux * back, cur[1] + uy * back];
    const p1: [number, number] = [cur[0] + vx * back, cur[1] + vy * back];
    // Arc centre: along the bisector, at distance rr / sin(half).
    let mx = ux + vx;
    let my = uy + vy;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) { out.push(cur); continue; }
    mx /= ml;
    my /= ml;
    const dist = rr / Math.sin(half);
    const cx = cur[0] + mx * dist;
    const cy = cur[1] + my * dist;
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    // Take the short way round; the arc never spans more than half a turn.
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    for (let k = 0; k <= perCorner; k++) {
      const a = a0 + (sweep * k) / perCorner;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** A regular polygon. `sides` 3..8 — triangle to octagon.
 *
 *  Capped at 8 because past that a polygon is a circle with extra vertices: at 12 sides nobody
 *  can tell, at 24 it IS the circle already in the list. Rotated so a flat edge is at the bottom
 *  and a point is at the top, which is how people draw a pentagon.
 *
 *  Pole-centred, which for a triangle is the incentre — the bbox centre sits a third of the way
 *  up, where the sides are already closing in on the switch. */
export const ngonRing = memo((sides?: number): Ring => {
  const n = Math.max(3, Math.min(8, Math.round(sides ?? 6)));
  const pts: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.PI / 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return centreOnSwitchSpot(pts);
});

/** A plus / Greek cross. `arm` 0.15..0.45 is the half-width of each arm. */
export const crossRing = memo((arm?: number): Ring => {
  const a = Math.max(0.15, Math.min(0.45, arm ?? 0.34));
  return [
    [a, 1], [a, a], [1, a], [1, -a], [a, -a], [a, -1],
    [-a, -1], [-a, -a], [-1, -a], [-1, a], [-a, a], [-a, 1],
  ];
});

/** A squircle — the superellipse between a circle (n=2) and a square (n→∞). `n` 2..8. */
export function squircleRing(n = 4, steps = 128): Ring {
  const exp = Math.max(2, Math.min(8, n));
  const pts: Ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (Math.PI * 2 * i) / steps;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      Math.sign(c) * Math.abs(c) ** (2 / exp),
      Math.sign(s) * Math.abs(s) ** (2 / exp),
    ]);
  }
  return pts;
}

/**
 * A stadium: two semicircular caps joined by straight sides. `stretch` is the half-length of
 * the straight section, 0..2.5 (0 is a circle).
 *
 * Sampled as a polygon rather than built from `roundedRect(w, h, min(w,h)/2)`, which is the
 * obvious way and the wrong one: that helper clamps its radius with an ABSOLUTE
 * `- 0.01` mm term, which a capsule hits exactly (its radius IS half the short side). An
 * absolute term inside a generator breaks the exact-homogeneity contract the fit search
 * depends on, and it would break it only for this one shape, only at some sizes.
 */
export function capsuleRing(stretch = 1.2, segsPerCap = 32): Ring {
  const half = Math.max(0, Math.min(2.5, stretch));
  const pts: Ring = [];
  for (let i = 0; i <= segsPerCap; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / segsPerCap;
    pts.push([half + Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i <= segsPerCap; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / segsPerCap;
    pts.push([-half + Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

/**
 * A heraldic shield: flat top, square shoulders, and a point at the bottom.
 *
 * The two lower edges are quadratic Béziers bulging outward rather than straight lines, which
 * is the whole difference between a shield and a paper aeroplane. Sampled rather than offset
 * so the tip stays sharp — a round-offset would blunt exactly the feature that makes it read.
 */
export const shieldRing = memo((steps = 20): Ring => {
  const bezier = (
    p0: [number, number], p1: [number, number], p2: [number, number],
  ): Ring => {
    const out: Ring = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push([
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      ]);
    }
    return out;
  };
  const shoulderL: [number, number] = [-1, 0.95];
  const shoulderR: [number, number] = [1, 0.95];
  const tip: [number, number] = [0, -1.35];
  // Pole-centred: a shield's bbox centre sits below its shoulders, in the taper toward the
  // point, so the switch was pushed down into the narrowing half.
  return centreOnSwitchSpot([
    shoulderL,
    shoulderR,
    ...bezier(shoulderR, [1.02, -0.35], tip),
    ...bezier(tip, [-1.02, -0.35], shoulderL),
  ]);
});

/** A luggage tag: a rectangle with one pointed end. */
export const tagRing = memo((): Ring => {
  const w = 1;
  const h = 0.62;
  const tip = 0.55;
  return centreOnSwitchSpot([[-w, -h], [w - tip, -h], [w, 0], [w - tip, h], [-w, h]]);
});

/** An arch / tombstone: flat bottom and sides, semicircular top. */
export const archRing = memo((steps = 40): Ring => {
  const w = 1;
  const h = 0.9;
  const pts: Ring = [[-w, -h], [w, -h]];
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps;
    pts.push([w * Math.cos(a), h + w * Math.sin(a)]);
  }
  return centreOnSwitchSpot(pts);
});

/* ---------------------------------------------------------------------------------------
   Rings for the shapes whose BUILD lives in buildClicker.ts.

   These exist so the picker can draw a tile for a shape whose real generator needs WASM.
   They must MATCH what builds, not merely resemble it.

   That distinction cost something. The first version of `heartRing` was the parametric
   `16·sin³t` valentine — a perfectly nice heart, and not the one the app builds, which is
   `makeHeart`'s two round lobes over a diamond. The tile showed one shape and the model was
   another, and Ian's report was "heart is wrong shape, the one we had before was better": he
   was comparing the picker to the print. I had claimed in the same breath that thumbnails
   "cannot drift from the geometry" because they share a source — which was true of the ten
   parametric shapes and false of exactly these three, and I did not say so.

   So each of these is now a direct port of the construction in buildClicker.ts, and a test
   compares the ring's aspect ratio against the built body's. An approximation is fine; an
   approximation nobody checks is how a picker starts lying.
   ------------------------------------------------------------------------------------ */

export function circleRing(steps = 64): Ring {
  const pts: Ring = [];
  for (let i = 0; i < steps; i++) {
    const a = (Math.PI * 2 * i) / steps;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

/** Rounded rectangle, as points. `cornerPct` is the radius as a fraction of the short side.
 *
 *  Deliberately WITHOUT `buildClicker`'s `roundedRect` floor of 0.1 mm on the radius. That
 *  floor is an absolute millimetre term, and an absolute term inside a generator breaks the
 *  exact-homogeneity contract the fit search depends on (see this file's header) — for the one
 *  shape people pick because it is plain, at some sizes only. The visible cost of leaving it
 *  out is that a corner set to 0 draws sharp here and prints with a 0.1 mm radius, which at a
 *  40 mm base is a quarter of a screen pixel. */
export function roundedRectRing(w: number, h: number, cornerPct = 0.22, perCorner = 8): Ring {
  const r = Math.max(0, Math.min(0.5, cornerPct)) * Math.min(w, h);
  const ix = w / 2 - r;
  const iy = h / 2 - r;
  const pts: Ring = [];
  const corners: [number, number, number][] = [
    [ix, iy, 0], [-ix, iy, Math.PI / 2], [-ix, -iy, Math.PI], [ix, -iy, -Math.PI / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (Math.PI / 2) * (i / perCorner);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/**
 * The star as buildClicker draws it. `points` 3..8 — past eight the legs are too short to read
 * as points and it turns into a cog, which is not on the menu. `innerFrac` is how far in the
 * valleys come: 0.56 is the shipped chubby star, lower is spikier.
 *
 * **Including the rounding**, which it did not until now. `makeStar` finishes with an
 * open-close at `r · 0.13 · min(1, 5/points)` that rounds the tips and the valleys — a chubby
 * star, deliberately, "not a spiky communist star" in its own words. This ring had none of it,
 * so the picker tile was a sharp star and the print was a round one. Exactly the heart bug,
 * one shape over, in a file whose own header claims these three are ports; for the star it was
 * not true, and nothing checked. `roundCorners` is the pure-JS stand-in, and `shapes.test.ts`
 * now compares this ring's area against the built body's.
 */
export const starRing = memo((points?: number, innerFrac?: number): Ring => {
  const n = Math.max(3, Math.min(8, Math.round(points ?? 5)));
  const inner = Math.max(0.3, Math.min(0.8, innerFrac ?? 0.56));
  const pts: Ring = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI / n) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  /* `makeStar`'s own radius, in the same units — the ring's outer radius is 1 here and `r`
     there — times 1.5.

     The factor is measured, not chosen. `roundCorners` cuts each corner back by at most half
     the shorter adjacent edge, and a star's legs are short, so the clamp bites and an arc of
     nominal radius `rr` removes less than an open-close of radius `rr` does. Fill fraction of
     the bounding box, against what `makeStar` actually builds:

                 sharp    1.0x     1.5x     2.0x     built
       3 points  53.8%    61.8%    65.6%    69.1%    63.9%
       5 points  47.8%    58.7%    63.8%    64.0%    61.9%
       8 points  42.9%    53.6%    58.8%    59.5%    59.6%

     1.5 is the best fit across the range — within 2 points everywhere, against the 10 to 17
     points the unrounded ring was out by. `shapes.test.ts` asserts the agreement, so this
     stays honest if either construction is retuned. */
  const rounded = roundCorners(pts, 0.13 * 1.5 * Math.min(1, 5 / n));
  // A 3-point star is not symmetric about its bbox centre; a 5-point one barely is. Both put
  // the switch off the middle, so both get the same treatment.
  return centreOnSwitchSpot(rounded);
});

/**
 * A heart: two circular lobes sitting on the top edges of a diamond, whose lower edges make the
 * point. The classic construction, and the one that was in the app before any of this.
 *
 * I replaced it once, with proportions found by searching for a shape whose switch spot was also
 * its visual centre. The search succeeded on its own terms — pole within 1% of centre, switch
 * fitting with 29% margin, aspect 1.02 — and produced something Ian described, accurately, as
 * two circles perched on a V. Optimising three measurable things is not the same as drawing a
 * heart, and none of the three could tell me the result was not one.
 *
 * The centring problem it was trying to solve is real and is solved elsewhere now, by
 * `centreOnSwitchSpot` rather than by mangling the shape.
 *
 * Traced as one outline rather than unioned, so this is both the geometry and the thumbnail —
 * `buildClicker` builds the heart from this exact ring. The constants are `makeHeart`'s own.
 */
export const heartRing = memo((steps = 32): Ring => {
  const h = 1 / Math.SQRT2;   // half-diagonal of a unit-side square
  const lobeR = 0.5;          // each top edge of the square is a lobe diameter
  const lobeX = h / 2;        // lobe centres sit on the midpoints of the top edges
  const lobeY = 1.5 * h;
  const k = 1 / Math.max(lobeX + lobeR, (lobeY + lobeR) / 2);
  const pt = (x: number, y: number): [number, number] => [x * k, y * k];

  const pts: Ring = [];
  pts.push(pt(0, 0));      // the bottom point
  pts.push(pt(h, h));      // up the diamond's right edge
  // Right lobe: from the diamond's corner, over the top, in to the notch.
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 4 + (Math.PI * 1.25 * i) / steps;
    pts.push(pt(lobeX + lobeR * Math.cos(a), lobeY + lobeR * Math.sin(a)));
  }
  // Left lobe, mirrored and walked backwards so the ring keeps one direction.
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 4 + (Math.PI * 1.25 * (steps - i)) / steps;
    pts.push(pt(-(lobeX + lobeR * Math.cos(a)), lobeY + lobeR * Math.sin(a)));
  }
  pts.push(pt(-h, h));
  return centreOnSwitchSpot(pts);
});

/** The egg profile from `makeEgg`, which is already pure point maths. */
export const eggRing = memo((steps = 96): Ring => {
  const width = 0.74;
  const taper = 0.26;
  const raw: Ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (Math.PI * 2 * i) / steps;
    raw.push([width * Math.cos(t) * (1 - taper * Math.sin(t)), Math.sin(t)]);
  }
  // Same centroid recentring the builder does, so the thumbnail sits where the part sits.
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = raw.length - 1; i < raw.length; j = i++) {
    const cross = raw[j][0] * raw[i][1] - raw[i][0] * raw[j][1];
    area += cross;
    cx += (raw[j][0] + raw[i][0]) * cross;
    cy += (raw[j][1] + raw[i][1]) * cross;
  }
  area *= 0.5;
  cx /= 6 * area;
  cy /= 6 * area;
  return centreOnSwitchSpot(raw.map(([x, y]) => [x - cx, y - cy] as [number, number]));
});

/** An SVG `d` attribute for a ring, fitted into a `size`×`size` box with Y flipped (SVG's Y
 *  runs down; every ring here is Y-up). Used for the picker's thumbnails. */
export function ringToPath(ring: Ring, size = 40, pad = 3): string {
  if (!ring.length) return '';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const k = (size - pad * 2) / Math.max(w, h);
  const ox = (size - w * k) / 2 - minX * k;
  const oy = (size - h * k) / 2 + maxY * k;
  const pt = ([x, y]: [number, number]) => `${(x * k + ox).toFixed(2)},${(oy - y * k).toFixed(2)}`;
  return `M${ring.map(pt).join('L')}Z`;
}
