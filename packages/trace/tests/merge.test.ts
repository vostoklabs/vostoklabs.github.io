/*
  Colours that print as one: `processImage`'s `mergeInto`, and `closestPairMapping`, the mapping
  it is given by default.

  A picture often has more colours than there are filaments, so some of them have to share one.
  Keeping the biggest colours and folding the rest into the nearest prints a small colour that
  looks different, green eyes on an orange cat, in the wrong colour. So every colour found points
  at a group instead, the colours of one group trace as ONE region, and by default the two most
  alike colours merge until the design fits.

  Pinned here:
   - with no `mergeInto`, every reading is what it was, to the bit (the hashes were recorded from
     the tracer as it stood before `mergeInto` existed);
   - two merged colours trace as one shape whose area is theirs together, and the seam between
     them leaves nothing behind: no sliver, no crack;
   - a soft edge between two merged colours is flat, and every other soft edge is kept;
   - a merged region takes its biggest member's colour, and the regions come in group order;
     one group per colour is no mapping at all, and a malformed mapping is refused;
   - `closestPairMapping` folds a cat's brown stripes and pink nose into its orange and keeps its
     green eyes; with no more colours than the budget it changes nothing; groups are numbered by
     what they cover.

  The pictures are drawn here, the way a browser draws flat art: shapes painted in order, every
  pixel the mean of 4 × 4 samples, so every edge is anti-aliased.

    pnpm --filter @vostok/trace test
*/
import { createHash } from 'node:crypto';
import type { RgbaImage } from '../src/decode';
import type { RegionSet, Ring } from '../src/types';
const trace = await import('../src/index');
const { processImage, discoverColours, quantize, stripBackground, compositeOverMatte, cleanMask, srgbToOklab } = trace;

type RGB = [number, number, number];
type Pt = [number, number];

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- drawing

/** A shape to paint: its colour, a box it lies wholly within (x0, y0, x1, y1), and its test. */
interface Shape { rgb: RGB; box: [number, number, number, number]; inside: (x: number, y: number) => boolean }

const disc = (rgb: RGB, cx: number, cy: number, r: number): Shape =>
  ({ rgb, box: [cx - r, cy - r, cx + r, cy + r], inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r });
const ellipse = (rgb: RGB, cx: number, cy: number, rx: number, ry: number): Shape =>
  ({ rgb, box: [cx - rx, cy - ry, cx + rx, cy + ry], inside: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 });
/** The box round some points, grown by `by`. */
const around = (pts: Pt[], by: number): Shape['box'] => [
  Math.min(...pts.map((p) => p[0])) - by, Math.min(...pts.map((p) => p[1])) - by,
  Math.max(...pts.map((p) => p[0])) + by, Math.max(...pts.map((p) => p[1])) + by,
];
/** How far (x, y) is from the segment a-b. */
const toSegment = (x: number, y: number, [ax, ay]: Pt, [bx, by]: Pt): number => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(x - ax - t * vx, y - ay - t * vy);
};
/** A straight stroke `w` wide with round ends. */
const stroke = (rgb: RGB, a: Pt, b: Pt, w: number): Shape =>
  ({ rgb, box: around([a, b], w / 2), inside: (x, y) => toSegment(x, y, a, b) <= w / 2 });
const inPolygon = (pts: Pt[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** A polygon, grown by `grow` all round with round corners: a filled shape's outline stroke. */
const polygon = (rgb: RGB, pts: Pt[], grow = 0): Shape => ({
  rgb,
  box: around(pts, grow),
  inside: (x, y) => inPolygon(pts, x, y) || (grow > 0 && pts.some((p, i) => toSegment(x, y, p, pts[(i + 1) % pts.length]) <= grow)),
});
/** A slice of a disc, from angle a0 to a1 in turns (0..1, clockwise from +x on screen). */
const wedge = (rgb: RGB, cx: number, cy: number, r: number, a0: number, a1: number): Shape => ({
  rgb,
  box: [cx - r, cy - r, cx + r, cy + r],
  inside: (x, y) => {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return false;
    const a = (Math.atan2(y - cy, x - cx) / (2 * Math.PI) + 1) % 1;
    return a >= a0 && a < a1;
  },
});

/** The picture: `shapes` painted in order over `bg` (null = transparent, a cut-out whose edges
 *  are in its alpha), each pixel the mean of 4 × 4 samples. */
function draw(width: number, height: number, bg: RGB | null, shapes: Shape[]): RgbaImage {
  const S = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          // The last shape painted over the point is the one seen, so look from the top down.
          let c = bg;
          for (let k = shapes.length - 1; k >= 0; k--) {
            const s = shapes[k];
            if (px < s.box[0] || px > s.box[2] || py < s.box[1] || py > s.box[3] || !s.inside(px, py)) continue;
            c = s.rgb;
            break;
          }
          if (c) { r += c[0]; g += c[1]; b += c[2]; hits++; }
        }
      }
      const i = (y * width + x) * 4;
      if (hits) { data[i] = Math.round(r / hits); data[i + 1] = Math.round(g / hits); data[i + 2] = Math.round(b / hits); }
      data[i + 3] = Math.round((hits / (S * S)) * 255);
    }
  }
  return { data, width, height };
}

const ORANGE: RGB = [242, 140, 40];
const BLACK: RGB = [17, 17, 17];
const WHITE: RGB = [255, 255, 255];
const BROWN: RGB = [180, 81, 10];
const PINK: RGB = [246, 165, 185];
const GREEN: RGB = [58, 166, 85];
const MATTE: RGB = [239, 239, 239];
const WHEEL: RGB[] = [[200, 30, 45], [242, 140, 40], [250, 210, 40], [58, 166, 85], [30, 90, 200], [120, 60, 170]];

/** Three colours on a matte that background removal takes away: a black-rimmed orange disc
 *  with a white centre. */
const badge = () => draw(240, 240, MATTE, [disc(BLACK, 120, 120, 100), disc(ORANGE, 120, 120, 90), disc(WHITE, 120, 120, 40)]);

/** Six colours, cut out: an orange cat with a black outline, brown stripes, green eyes, a white
 *  muzzle, a pink nose, ears and cheeks. `stripes` null paints the stripes in the head's orange,
 *  which is the same cat with nothing where the stripes were. */
function cat(stripes: RGB | null): RgbaImage {
  const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [320 - x, y]);
  const ear: Pt[] = [[60, 132], [70, 34], [154, 76]];
  const innerEar: Pt[] = [[82, 110], [85.6, 66], [128.8, 85.6]];
  const nose: Pt[] = [[148, 204.8], [172, 204.8], [160, 220]];
  const s = stripes ?? ORANGE;
  const eye = (cx: number): Shape[] => [
    disc(BLACK, cx, 170, 25.6), disc(GREEN, cx, 170, 20.8),
    ellipse(BLACK, cx, 170, 6.8, 15.2), disc(WHITE, cx - 5.6, 162.4, 3.6),
  ];
  return draw(320, 300, null, [
    polygon(BLACK, ear, 3.6), polygon(ORANGE, ear), polygon(PINK, innerEar),
    polygon(BLACK, mirror(ear), 3.6), polygon(ORANGE, mirror(ear)), polygon(PINK, mirror(innerEar)),
    ellipse(BLACK, 160, 182, 117.6, 103.6), ellipse(ORANGE, 160, 182, 114, 100),
    stroke(s, [160, 88.8], [160, 122], 10.4), stroke(s, [132, 94.4], [141.2, 119.2], 8.8), stroke(s, [188, 94.4], [178.8, 119.2], 8.8),
    stroke(s, [54, 176], [82, 180.8], 8), stroke(s, [56.8, 202], [84, 200], 8),
    stroke(s, [266, 176], [238, 180.8], 8), stroke(s, [263.2, 202], [236, 200], 8),
    ...eye(118), ...eye(202),
    ellipse(BLACK, 139.2, 227.2, 34.8, 27.6), ellipse(WHITE, 139.2, 227.2, 30.8, 23.6),
    ellipse(BLACK, 180.8, 227.2, 34.8, 27.6), ellipse(WHITE, 180.8, 227.2, 30.8, 23.6),
    polygon(BLACK, nose, 2), polygon(PINK, nose),
    stroke(BLACK, [160, 220], [160, 234], 4),
    disc(PINK, 84.8, 224, 10.4), disc(PINK, 235.2, 224, 10.4),
  ]);
}

/** Seven colours on white: a black-rimmed wheel of six slices that all meet in the middle. */
const wheel = () => draw(280, 280, WHITE, [
  disc(BLACK, 140, 140, 120),
  ...WHEEL.map((rgb, i) => wedge(rgb, 140, 140, 108, i / 6, (i + 1) / 6)),
]);

const clone = (img: RgbaImage): RgbaImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });
const digest = (set: RegionSet): string => createHash('sha256').update(JSON.stringify(set)).digest('hex');

// ---------------------------------------------------------------- absent: what it always was

/* Filament colours none of the pictures is drawn in, so a pixel is read against colours that
   are not there: the nearest-colour mapping and the edge rule both have work to do. */
const FILAMENTS: RGB[] = [[255, 255, 255], [0, 0, 0], [255, 106, 19], [0, 174, 66], [10, 41, 137], [245, 171, 190], [161, 164, 169]];

const PICTURES: [string, RgbaImage, RGB[]][] = [
  ['badge', badge(), [BLACK, ORANGE, WHITE]],
  ['cat', cat(BROWN), [ORANGE, BLACK, WHITE, BROWN, PINK, GREEN]],
  ['wheel', wheel(), [BLACK, ...WHEEL]],
];
/** Each reading is handed a fresh copy: `processImage` and `discoverColours` change theirs. */
const READINGS: [string, (img: RgbaImage, drawn: RGB[]) => RegionSet][] = [
  ['automatic', (img, drawn) => processImage(img, drawn.length)],
  ['the colours it was drawn in', (img, drawn) => processImage(img, drawn.length, { customColors: drawn })],
  ['the colours found in it, as the import window traces them', (img, drawn) =>
    processImage(img, drawn.length, { customColors: discoverColours(clone(img)).map((c) => c.rgb), smoothing: 0.1, designMm: 40 })],
  ['filaments it was not drawn in', (img) => processImage(img, 4, { customColors: FILAMENTS })],
];
const EXTRA: [string, string, (img: RgbaImage, drawn: RGB[]) => RegionSet][] = [
  ['badge', 'background kept', (img, drawn) => processImage(img, drawn.length + 1, { removeBg: false })],
  ['cat', 'detail not protected, unsmoothed', (img, drawn) => processImage(img, drawn.length, { customColors: drawn, preserveDetail: false, smoothing: 0 })],
];

/** Recorded from the tracer before `mergeInto` existed. The badge's first two are one hash
 *  because its automatic palette IS the three colours it was drawn in. */
const PINNED: Record<string, string> = {
  'badge · automatic': 'ba602601ac5a69c307a3ab2eff802638b5bc81b9d7e418e6aac74710a38ca70b',
  'badge · the colours it was drawn in': 'ba602601ac5a69c307a3ab2eff802638b5bc81b9d7e418e6aac74710a38ca70b',
  'badge · the colours found in it, as the import window traces them': '9d23a172971141630c48c2a9e2b8383e1f5f50d0e400640c75ebac70b66ee6bb',
  'badge · filaments it was not drawn in': '23ace53fd5cfc64405e952cb40c7dea1762e647fe3b6574d84b24a8d4316f261',
  'badge · background kept': '96c6eb264badf931a3e4b879d09aaca36daa93c9d66146ab869d5a430a7eb9ab',
  'cat · automatic': 'df14ca243e7992840983aa48867f07dbc1798303f820e0465f5689fde423a81c',
  'cat · the colours it was drawn in': '64ac9a2ae074eec65c6d27f5cfd7801cd5b9ec3595ba8e3c3f46434dbbedfa33',
  'cat · the colours found in it, as the import window traces them': '8b5f68636342039e046aaffcf5906a72bc2f551820a15df7afcf5a23dd3431e5',
  'cat · filaments it was not drawn in': 'e8a71a8ec2d6e231cb8651cabc19df7dc00006b200dca54c9b495566e2111bcc',
  'cat · detail not protected, unsmoothed': 'd79ae7da5d620953167ff2876cff82e32c207410ab33681355394a9e3bbb1ac6',
  'wheel · automatic': '7639ff1a65198dc471c1e9e2ddc072937fab199c651fd002f58c91d87d8c8e1b',
  'wheel · the colours it was drawn in': '66951d517a552f5df8df21f6a39a44f5601d6f2adfaaf09796b79558e15087e3',
  'wheel · the colours found in it, as the import window traces them': 'c4bd941d4fb495a8ed3bde1c53cebd514cc115e4a102e4d47939ef29e95f85a0',
  'wheel · filaments it was not drawn in': 'b7554e6cc8dc91271cfe9283f005922496bd228bfc83d7659b9051660b655368',
};

for (const [picture, img, drawn] of PICTURES) {
  const runs: [string, (img: RgbaImage, drawn: RGB[]) => RegionSet][] = [
    ...READINGS,
    ...EXTRA.filter(([p]) => p === picture).map(([, name, read]): [string, (img: RgbaImage, drawn: RGB[]) => RegionSet] => [name, read]),
  ];
  for (const [reading, read] of runs) {
    const key = `${picture} · ${reading}`;
    const t0 = performance.now();
    const set = read(clone(img), drawn);
    const ms = Math.round(performance.now() - t0);
    const got = digest(set);
    const want = PINNED[key];
    check(`no mapping, unchanged: ${key}`, got === want,
      `${got === want ? got.slice(0, 16) : `${got}, pinned ${want ?? 'nothing'}`}  (${set.regions.length} regions, ${ms} ms)`);
  }
}

// ---------------------------------------------------------------- merging two colours

type Region = RegionSet['regions'][number];
const signed = (r: Ring): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
/** A region's area: each shape's rings are wound against each other, so a hole counts against. */
const area = (r: Region | undefined): number =>
  r ? r.components.reduce((s, c) => s + Math.abs(c.rings.reduce((t, ring) => t + signed(ring), 0)), 0) : 0;
const lab = (c: RGB) => srgbToOklab(c);
const apartIn = (a: RGB, b: RGB) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

const CAT = cat(BROWN);
const PLAIN = cat(null);
const found = discoverColours(clone(CAT));
const colours = found.map((c) => c.rgb);
/** Which found colour a drawn one became. */
const at = (want: RGB): number => colours.reduce((best, c, i) => (apartIn(c, want) < apartIn(colours[best], want) ? i : best), 0);
check(
  'the cat: the six colours it was drawn in are the six found',
  found.length === 6 && [ORANGE, BLACK, WHITE, BROWN, PINK, GREEN].every((c) => apartIn(colours[at(c)], c) < 0.03)
    && new Set([ORANGE, BLACK, WHITE, BROWN, PINK, GREEN].map(at)).size === 6,
  found.map((c) => `${hex(c.rgb)} ${(c.coverage * 100).toFixed(1)}%`).join(', '),
);

/** A `mergeInto` from "colour k joins colour j's group": groups numbered in the list's order. */
function joining(n: number, joins: [number, number][]): number[] {
  const into = new Map(joins);
  const root = (k: number): number => (into.has(k) ? root(into.get(k)!) : k);
  const ids = new Map<number, number>();
  return Array.from({ length: n }, (_, k) => {
    const r = root(k);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

/** The import window's settings. */
const SET = { smoothing: 0.1, designMm: 40 };
const apart = processImage(clone(CAT), 6, { ...SET, customColors: colours });
const brownIn = joining(6, [[at(BROWN), at(ORANGE)]]);
const t0 = performance.now();
const together = processImage(clone(CAT), 5, { ...SET, customColors: colours, mergeInto: brownIn });
const mergedMs = Math.round(performance.now() - t0);
const regionOf = (set: RegionSet, c: RGB) => set.regions.find((r) => same(r.quantRgb, c));

{
  const orange = area(regionOf(apart, colours[at(ORANGE)]));
  const brown = area(regionOf(apart, colours[at(BROWN)]));
  const merged = regionOf(together, colours[at(ORANGE)]);
  check(
    'brown merged into orange: one region, whose area is the two together',
    together.regions.length === apart.regions.length - 1 && !regionOf(together, colours[at(BROWN)]) && near(area(merged), orange + brown, 0.003),
    `${apart.regions.length} regions -> ${together.regions.length}; orange ${orange.toFixed(5)} + brown ${brown.toFixed(5)} = ${(orange + brown).toFixed(5)}, merged ${area(merged).toFixed(5)}  (${mergedMs} ms)`,
  );
  const others = [BLACK, WHITE, PINK, GREEN].map((c) => {
    const was = regionOf(apart, colours[at(c)]);
    const now = regionOf(together, colours[at(c)]);
    return { c, ok: !!was && !!now && was.components.length === now.components.length && near(area(now), area(was), 0.003), was, now };
  });
  check(
    '…and every other colour is left as it was',
    others.every((o) => o.ok),
    others.map((o) => `${hex(o.c)} ${o.was?.components.length}->${o.now?.components.length} shapes, ${area(o.was).toFixed(5)}->${area(o.now).toFixed(5)}`).join('; '),
  );
}

/* The seam test. Traced apart, two colours meet along a soft edge each side of which is
   contoured on its own; merged, nothing may be left of that edge, neither a sliver of some third
   colour the blend looked like nor a crack between the two. So the striped cat with its brown
   merged into the orange has to trace as the cat drawn with no stripes at all: the same regions,
   the same shapes, the same rings, the same areas. */
{
  const plain = processImage(clone(PLAIN), 5, { ...SET, customColors: colours, mergeInto: brownIn });
  const rings = (set: RegionSet) => set.regions.map((r) => r.components.map((c) => c.rings.length).join('+')).join(' | ');
  const sameShapes = plain.regions.length === together.regions.length && rings(plain) === rings(together)
    && plain.regions.every((r, i) => same(r.quantRgb, together.regions[i].quantRgb) && near(area(together.regions[i]), area(r), 0.003));
  check(
    'no sliver and no crack where the merged colours met: the striped cat merged traces as the cat drawn without stripes',
    sameShapes,
    `rings per shape: striped ${rings(together)}; plain ${rings(plain)}; areas ${together.regions.map((r) => area(r).toFixed(4)).join(' ')} vs ${plain.regions.map((r) => area(r).toFixed(4)).join(' ')}`,
  );
}

/* The same where the seam runs out to the edge of a cut-out and through a third colour: a disc,
   orange on one side of a slanted line and brown on the other, a black bar across the line and a
   white dot. Merged, it must trace as the one-colour disc: the same shapes and rings, and the
   same silhouette. A seam pixel at the rim is a blend of the two colours AND of the outside; made
   whole instead of flat (its two shares summed), it bulges the silhouette at both ends of the
   seam, which only shows here, never in the cat, whose seams all end inside it. */
{
  const halves = (other: RGB) => draw(260, 260, null, [
    disc(ORANGE, 130, 130, 120),
    { rgb: other, box: [10, 10, 250, 250], inside: (x, y) => (x - 130) ** 2 + (y - 130) ** 2 <= 120 * 120 && (x - 130) * 0.8 + (y - 130) * 0.6 > 0 },
    stroke(BLACK, [40, 180], [220, 80], 14),
    disc(WHITE, 90, 100, 18),
  ]);
  // Handed the colours it was drawn in: the automatic split folds this black bar into the brown.
  const list = [BROWN, ORANGE, BLACK, WHITE];
  const into = [0, 0, 1, 2];
  const merged = processImage(halves(BROWN), 3, { ...SET, customColors: list, mergeInto: into });
  const one = processImage(halves(ORANGE), 3, { ...SET, customColors: list, mergeInto: into });
  const silhouette = (set: RegionSet) => Math.abs(set.outline.reduce((t, r) => t + signed(r), 0));
  const rings = (set: RegionSet) => set.regions.map((r) => r.components.map((c) => c.rings.length).join('+')).join(' | ');
  const px = 240 * 240; // the disc's longest side is the unit; areas in square pixels
  const edge = (silhouette(merged) - silhouette(one)) * px;
  check(
    '…and where the seam runs out to the edge of a cut-out: the one-colour disc\'s shapes and its silhouette',
    merged.regions.length === 3 && rings(merged) === rings(one) && Math.abs(edge) < 0.5
      && merged.regions.every((r, i) => near(area(r), area(one.regions[i]), 0.003)),
    `rings per shape ${rings(merged)} (one colour ${rings(one)}); silhouette ${edge >= 0 ? '+' : ''}${edge.toFixed(2)} px² against the one-colour disc`,
  );
}

/* The quantiser itself. Every pixel is read against all six colours exactly as without a mapping,
   then relabelled: a pixel that was a blend of two colours of one group becomes a flat pixel of
   that group (no other side, its alpha for its share), and a blend across two groups keeps its
   share and its other side. */
{
  const prepared = (img: RgbaImage) => { const outside = stripBackground(img); compositeOverMatte(img); cleanMask(img); return outside; };
  const a = clone(CAT);
  const q0 = quantize(a, 6, colours, prepared(a));
  const b = clone(CAT);
  const q1 = quantize(b, 6, colours, prepared(b), brownIn);
  let seam = 0, kept = 0, wrong = 0;
  for (let p = 0; p < q0.indices.length; p++) {
    const k = q0.indices[p];
    if (k < 0) { if (q1.indices[p] !== -1 || q1.soft[p] !== q0.soft[p] || q1.other[p] !== -1) wrong++; continue; }
    const g = brownIn[k];
    const o = q0.other[p];
    const og = o >= 0 ? brownIn[o] : -1;
    if (q1.indices[p] !== g) { wrong++; continue; }
    if (og === g) {
      seam++;
      if (q1.other[p] !== -1 || q1.soft[p] !== Math.fround(b.data[p * 4 + 3] / 255)) wrong++;
    } else {
      if (og >= 0) kept++;
      if (q1.other[p] !== og || q1.soft[p] !== q0.soft[p]) wrong++;
    }
  }
  check(
    'a soft edge between two merged colours is flat, and every other soft edge is kept',
    q0.palette.length === 6 && seam > 0 && kept > 0 && wrong === 0,
    `${seam} blended pixels on the seam made whole, ${kept} soft pixels between groups kept, ${wrong} wrong`,
  );
  const groups = q1.palette.map((p) => `${hex(p.rgb)} ${(p.coverage * 100).toFixed(1)}%`).join(', ');
  const orange = q0.palette[at(ORANGE)].coverage + q0.palette[at(BROWN)].coverage;
  check(
    'the quantiser answers one colour per group, in group order',
    q1.palette.length === 5 && q1.palette.every((p, g) => same(p.rgb, colours[brownIn.indexOf(g)]))
      && near(q1.palette[brownIn[at(ORANGE)]].coverage, orange, 1e-9),
    groups,
  );
}

{
  // Brown listed before orange: the group still prints orange, its biggest member by pixels.
  const order = [at(BROWN), ...colours.map((_, i) => i).filter((i) => i !== at(BROWN))];
  const listed = order.map((k) => colours[k]);
  const into = joining(listed.length, [[0, order.indexOf(at(ORANGE))]]);
  const set = processImage(clone(CAT), 5, { ...SET, customColors: listed, mergeInto: into });
  const first = set.regions[0];
  check(
    'a merged region takes its biggest member\'s colour, whatever order the colours were listed in',
    !!first && same(first.quantRgb, colours[at(ORANGE)]) && into[0] === 0,
    first ? `group 0 (brown listed first, then orange) is ${hex(first.quantRgb)}, ${(first.coverage * 100).toFixed(1)}%` : 'no region',
  );
}

{
  // Groups numbered backwards: green first, the orange group last.
  const rank = [at(GREEN), at(PINK), at(WHITE), at(BLACK), at(ORANGE)];
  const into = colours.map((_, k) => rank.indexOf(k === at(BROWN) ? at(ORANGE) : k));
  const set = processImage(clone(CAT), 5, { ...SET, customColors: colours, mergeInto: into });
  const got = set.regions.map((r) => hex(r.quantRgb)).join(' ');
  const want = rank.map((k) => hex(colours[k])).join(' ');
  check('the regions come in group order', got === want, `${got} (groups ${want})`);
}

{
  const identity = colours.map((_, k) => k);
  const set = processImage(clone(CAT), 6, { ...SET, customColors: colours, mergeInto: identity });
  check(
    'one group per colour traces exactly as no mapping at all',
    digest(set) === digest(apart),
    `${digest(set).slice(0, 16)} vs ${digest(apart).slice(0, 16)}`,
  );
}

{
  const refused = (into: number[]) => {
    try { processImage(clone(CAT), 4, { ...SET, customColors: colours, mergeInto: into }); return ''; }
    catch (err) { return (err as Error).message; }
  };
  const said = [refused([0, 1, 2]), refused([0, 0, 2, 2, 3, 4]), refused([0, 1, 2, 3, 0, -1])];
  check(
    'a mapping of the wrong length, with a group left out or with a group that is no number, is refused',
    said.every(Boolean),
    said.map((s) => s || 'traced').join('; '),
  );
}

// ---------------------------------------------------------------- closestPairMapping

const { closestPairMapping } = trace;
const candidates = (list: [RGB, number][]) => list.map(([rgb, coverage]) => ({ rgb, coverage }));

/* A cartoon cat's colours, biggest first, as the import window lists them. With four filaments
   two colours have to go: brown and pink, which are orange darker and orange lighter, not the
   green of the eyes, which is 4.4% of the picture and looks like nothing else in it. */
const CAT_COLOURS = candidates([
  [[240, 140, 40], 0.535], [[20, 20, 20], 0.254], [[250, 250, 245], 0.076],
  [[140, 80, 40], 0.047], [[245, 150, 160], 0.044], [[40, 160, 60], 0.044],
]);
{
  const got = closestPairMapping(CAT_COLOURS, 4);
  check(
    'a cat, four filaments: brown and pink fold into orange; green, black and white stay',
    JSON.stringify(got) === '[0,1,2,0,0,3]',
    `orange, black, white, brown, pink, green -> ${JSON.stringify(got)}`,
  );
}
{
  // The same cat's colours exactly as `discoverColours` found them in the drawing it was drawn from.
  const exact = candidates([
    [[242, 140, 40], 0.535], [[17, 17, 17], 0.254], [[255, 255, 255], 0.076],
    [[182, 81, 19], 0.047], [[246, 165, 185], 0.044], [[58, 166, 85], 0.044],
  ]);
  const got = closestPairMapping(exact, 4);
  check('…and the same with the colours found in the drawing', JSON.stringify(got) === '[0,1,2,0,0,3]', JSON.stringify(got));
}
{
  // The cat drawn here, end to end: found, mapped, traced.
  const into = closestPairMapping(found, 4);
  const set = processImage(clone(CAT), 4, { ...SET, customColors: colours, mergeInto: into });
  const green = regionOf(set, colours[at(GREEN)]);
  const shared = (c: RGB) => into[at(c)];
  check(
    'the cat drawn here, mapped by default and traced: four colours, and the green eyes are two green shapes',
    set.regions.length === 4 && shared(BROWN) === shared(ORANGE) && shared(PINK) === shared(ORANGE)
      && new Set([ORANGE, BLACK, WHITE, GREEN].map(shared)).size === 4 && !!green && green.components.length === 2,
    `mapping ${JSON.stringify(into)} for ${found.map((c) => hex(c.rgb)).join(' ')}; ${set.regions.map((r) => `${hex(r.quantRgb)} ${r.components.length} shapes`).join(', ')}`,
  );
}
{
  const n6 = closestPairMapping(CAT_COLOURS, 6);
  const n10 = closestPairMapping(CAT_COLOURS, 10);
  const n3 = closestPairMapping(CAT_COLOURS.slice(0, 3), 4);
  const n0 = closestPairMapping([], 4);
  check(
    'no more colours than the budget: nothing merges, each colour its own group',
    JSON.stringify(n6) === '[0,1,2,3,4,5]' && JSON.stringify(n10) === '[0,1,2,3,4,5]' && JSON.stringify(n3) === '[0,1,2]' && JSON.stringify(n0) === '[]',
    `6 in 6: ${JSON.stringify(n6)}, 6 in 10: ${JSON.stringify(n10)}, 3 in 4: ${JSON.stringify(n3)}, none: ${JSON.stringify(n0)}`,
  );
}
{
  /* Three blues that together cover more than the red, which is the biggest colour on its own:
     merged, the blues are group 0. */
  const list = candidates([[[200, 30, 45], 0.4], [[30, 90, 200], 0.25], [[90, 150, 230], 0.2], [[150, 200, 245], 0.15]]);
  const got = closestPairMapping(list, 2);
  const one = closestPairMapping(list, 1);
  check(
    'groups are numbered by what they cover, biggest first',
    JSON.stringify(got) === '[1,0,0,0]' && JSON.stringify(one) === '[0,0,0,0]',
    `red 40%, blue 25%, light blue 20%, pale blue 15% in 2 -> ${JSON.stringify(got)}; in 1 -> ${JSON.stringify(one)}`,
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nmerged colours trace as one, and with no mapping nothing changed');
process.exit(failures ? 1 : 0);
