/**
 * Plate outlines and mounting cut-outs, as plain polygons.
 *
 * Deliberately free of manifold and of the DOM: everything here is arithmetic on
 * `[x, y]` pairs, so it can be checked headless in Node the way `@vostok/fonts`
 * `textLayout` is. The manifold step in `buildSign.ts` only unions and subtracts what
 * this file hands it, which keeps the part that is easy to get subtly wrong — corner
 * radii, hole placement, keyhole geometry — in the part that is easy to test.
 *
 * Convention: a contour is `number[][]` of `[x, y]`, and a shape is `number[][][]`.
 * Outer loops are wound **counter-clockwise** (positive signed area), matching what
 * manifold's `Positive` fill rule expects. Holes are returned separately rather than as
 * negative loops — the caller subtracts them, which is explicit and survives a shape
 * being reused as a pocket rather than a through-hole.
 */




/** Points per 90° of arc. 8 is smooth at sign scale and cheap in the boolean. */
const ARC_STEPS = 8;

/** Anything below this is a duplicate point as far as an extruder is concerned. */
const WELD = 1e-4;

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drops points that repeat their neighbour, including around the wrap. */
export function weld(poly) {
  const out = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < WELD && Math.abs(prev[1] - p[1]) < WELD) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last
      && Math.abs(first[0] - last[0]) < WELD && Math.abs(first[1] - last[1]) < WELD) {
    out.pop();
  }
  return out;
}

/** Ensures a loop is wound counter-clockwise. */
export function ccw(poly) {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** A circle, centred, counter-clockwise. */
export function circle(cx, cy, radius, steps = ARC_STEPS * 4) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
  }
  return out;
}

/**
 * A rectangle with rounded corners, centred on the origin.
 *
 * `radius` is clamped to half the shorter side rather than rejected: the UI lets someone
 * drag corner radius up while the plate auto-shrinks around short text, and a slider that
 * throws when the two cross is worse than one that quietly becomes a pill.
 */
export function roundedRect(width, height, radius) {
  const w = Math.max(WELD, width);
  const h = Math.max(WELD, height);
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= WELD) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }

  const x = w / 2 - r;
  const y = h / 2 - r;
  const corners: Array<[number, number, number]> = [
    [x, y, 0],           // top-right,    sweeping 0° → 90°
    [-x, y, Math.PI / 2],
    [-x, -y, Math.PI],
    [x, -y, Math.PI * 1.5],
  ];

  const out = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = start + (i / ARC_STEPS) * (Math.PI / 2);
      out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  }
  return weld(out);
}

/** A rectangle with its corners cut off at 45° — the classic engraved-plaque outline. */
export function plaque(width, height, cut) {
  const w = Math.max(WELD, width);
  const h = Math.max(WELD, height);
  const c = Math.max(0, Math.min(cut, Math.min(w, h) / 2));
  if (c <= WELD) return roundedRect(w, h, 0);
  const x = w / 2;
  const y = h / 2;
  return weld([
    [x - c, -y], [x, -y + c],
    [x, y - c], [x - c, y],
    [-x + c, y], [-x, y - c],
    [-x, -y + c], [-x + c, -y],
  ]);
}

/** The plate outline for a shape, sized to `width` × `height`. `none` has no plate. */
export function plateOutline(
  shape: ,
  width,
  height,
  cornerRadius,
) {
  switch (shape) {
    case 'none': return [];
    case 'rect': return [ccw(roundedRect(width, height, 0))];
    case 'pill': return [ccw(roundedRect(width, height, Math.min(width, height) / 2))];
    case 'plaque': return [ccw(plaque(width, height, Math.max(cornerRadius, 2)))];
    case 'rounded':
    default: return [ccw(roundedRect(width, height, cornerRadius))];
  }
}

/**
 * Where the screws go: one near each end, on the horizontal centreline.
 *
 * Inset by `inset` from the plate edge, and never closer to the edge than the hole's own
 * radius plus a wall — a hole that breaks the outline is the failure people photograph.
 */
export function screwHolePositions(
  plateWidth,
  plateHeight,
  holeDia,
  inset,
) {
  const minWall = holeDia * 0.75;
  const maxInset = plateWidth / 2 - holeDia / 2 - minWall;
  const x = Math.max(0, Math.min(inset, maxInset));
  if (x <= WELD) return [];
  // Vertically centred: on a tall two-line sign the centreline is still the strongest
  // place to hang it from, and it keeps the pair symmetric about both axes.
  void plateHeight;
  return [[-(plateWidth / 2 - x - holeDia / 2), 0], [plateWidth / 2 - x - holeDia / 2, 0]];
}

export function screwHoles(
  plateWidth,
  plateHeight,
  holeDia,
  inset,
) {
  return screwHolePositions(plateWidth, plateHeight, holeDia, inset)
    .map(([x, y]) => ccw(circle(x, y, holeDia / 2)));
}

/**
 * A keyhole slot: a round head clearance with a narrower neck running **downwards**.
 *
 * The sign drops onto a screw already in the wall, so the neck must run down from the
 * hole — hang it the other way up and the sign lifts off itself. This is a pocket in the
 * back face, never a through-hole, which is why it is returned as its own shape for the
 * caller to extrude to a depth rather than through the plate.
 *
 * `headDia` is the screw *head*, not the shank: the head has to pass through.
 */
export function keyhole(
  cx,
  cy,
  headDia,
  neckDia,
  travel,
) {
  const hr = Math.max(WELD, headDia / 2);
  const nr = Math.max(WELD, Math.min(neckDia / 2, hr * 0.9));
  const drop = Math.max(nr, travel);

  // Two loops the caller unions, rather than one blended outline: the union is cheap and
  // the pieces stay independently checkable.
  const head = ccw(circle(cx, cy, hr));

  // The neck runs from the head's centre down to the travel limit, capped by a half-round
  // so the shank never sits in a square corner.
  const neck = ccw(weld([
    [cx - nr, cy],
    [cx + nr, cy],
    [cx + nr, cy - drop],
    ...Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const t = (i / ARC_STEPS) * Math.PI;
      return [cx + Math.cos(t) * nr, cy - drop - Math.sin(t) * nr];
    }),
    [cx - nr, cy - drop],
  ]));

  return [head, neck];
}

/** Bounding box of a set of contours. */
export function bboxOf(shape) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of shape) {
    for (const pt of poly) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }
  if (Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/**
 * The plate size for a block of text.
 *
 * Auto-sized from the text's own bounding box plus padding, which is what every tool in
 * the category does and what none of their users complain about. Returned rather than
 * exposed as parameters so the two can never disagree.
 */
export function plateSizeFor(
  textBox,
  padding,
) {
  return {
    width: Math.max(WELD, textBox.maxX - textBox.minX + padding * 2),
    height: Math.max(WELD, textBox.maxY - textBox.minY + padding * 2),
  };
}
