// A music player's controls as laser geometry: shuffle, previous, play, next, repeat, a heart
// and a progress bar with its knob. Drawn here from strokes, triangles and discs — generic media
// glyphs that every player shares, not any app's icon set — for `song-keychain.ts`.
//
// Every glyph is centred on the origin, Y up, sized by its HEIGHT, and handed back as islands the
// engine unions (its cross-sections are built with the Positive fill rule, so a stroke made of
// overlapping segments comes out as one clean outline in the export).
//
// The numbers that hold them together at a keychain's scale (a 3 mm glyph):
//   · a stroke is 0.14 × the glyph's height and never under STROKE_MIN — 0.4 mm, a third over the
//     0.3 mm the house calls the thinnest line that survives a burn;
//   · an arrowhead is 0.4 × the height tall, so it reads as a head and not as a thicker stroke;
//   · two strokes that must stay apart (the repeat's arrow and the side it points past) keep 0.6
//     of a stroke of bare wood between them, which at 0.4 mm is still above the burn floor.
import { circleRing, heartRing, mirrorX, roundPolygonRing, roundedRectRing, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';

/** The thinnest engraved stroke a glyph is drawn with, mm. */
export const STROKE_MIN = 0.4;

/** A glyph's stroke for its height: proportional, floored so a small glyph never burns away. */
export const strokeFor = (h: number) => Math.max(STROKE_MIN, 0.14 * h);

/**
 * One straight stroke from `a` to `b`, `w` wide, with round caps — a capsule. A polyline drawn as
 * one capsule per segment unions into a line with ROUND joins: the cap at every corner fills
 * exactly the wedge the two segments leave open. Counter-clockwise.
 */
export function capsule(a: Pt, b: Pt, w: number, seg = 8): CutRing {
  const r = w / 2;
  const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const out: CutRing = [];
  for (let i = 0; i <= seg; i++) {
    const q = t - Math.PI / 2 + (i / seg) * Math.PI;
    out.push([b[0] + r * Math.cos(q), b[1] + r * Math.sin(q)]);
  }
  for (let i = 0; i <= seg; i++) {
    const q = t + Math.PI / 2 + (i / seg) * Math.PI;
    out.push([a[0] + r * Math.cos(q), a[1] + r * Math.sin(q)]);
  }
  return out;
}

/** A polyline as capsules, one island per segment. */
export function stroke(pts: Pt[], w: number): Shapes {
  if (pts.length === 1) return [[circleRing(pts[0]![0], pts[0]![1], w / 2, 16)]];
  const out: Shapes = [];
  for (let i = 1; i < pts.length; i++) out.push([capsule(pts[i - 1]!, pts[i]!, w)]);
  return out;
}

/** A cubic Bézier sampled into `n` segments, both ends included. */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

/** A filled arrowhead: its tip at `tip`, pointing along `angle` (radians), `len` long and
 *  `half` wide either side of its axis. */
export function arrowhead(tip: Pt, angle: number, len: number, half: number): CutRing {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const bx = tip[0] - dx * len, by = tip[1] - dy * len;
  return [[tip[0], tip[1]], [bx - dy * half, by + dx * half], [bx + dy * half, by - dx * half]];
}

const rot180 = (shapes: Shapes): Shapes => shapes.map((isl) => isl.map((r) => r.map(([x, y]): Pt => [-x, -y])));

// ------------------------------------------------------------------ the five controls --

/**
 * Previous: a bar and a triangle pointing left into it, the pair `h` tall and 0.9 h wide. The
 * triangle's tip touches the bar, so the glyph is ONE engraved shape rather than two marks a
 * beam has to register against each other.
 */
export function previousGlyph(h: number): Shapes {
  const bar = roundedRectRing(0.2 * h, h, 0.05 * h, 4).map(([x, y]): Pt => [x - 0.35 * h, y]);
  const tri = roundPolygonRing([[-0.27 * h, 0], [0.45 * h, -0.5 * h], [0.45 * h, 0.5 * h]], 0.06 * h, 4);
  return [[bar], [tri]];
}

/** Next: previous, mirrored. */
export const nextGlyph = (h: number): Shapes => mirrorX(previousGlyph(h));

/**
 * Play: a disc `d` across with a right-pointing triangle KNOCKED OUT of it — the one control
 * that reads at arm's length, as it does on every player. The triangle is 0.42 d tall and sits
 * with its centroid on the disc's centre (the optical middle of a triangle is its centroid, not
 * its box), which leaves at least 0.27 d of engraved ring round it on every side.
 */
export function playGlyph(d: number): Shapes {
  const t = 0.42 * d;
  const w = (t * Math.sqrt(3)) / 2;
  const tri = roundPolygonRing([[-w / 3, -t / 2], [(2 * w) / 3, 0], [-w / 3, t / 2]], 0.045 * d, 4);
  return [[circleRing(0, 0, d / 2, 72), tri]];
}

/**
 * Shuffle: two strokes that leave the left side level, cross in an S-curve and arrive at the
 * right side level again, each ending in an arrowhead pointing right. 1.2 h wide.
 */
export function shuffleGlyph(h: number): Shapes {
  const s = strokeFor(h);
  const sw = 1.2 * h;
  const hl = 0.34 * h;
  const hh = 0.2 * h;
  const y = h / 2 - hh;
  const x0 = -sw / 2 + s / 2;
  const xa = -0.22 * sw;
  const xb = 0.22 * sw;
  // The stroke stops inside the head's base, so its round cap is buried in the head.
  const xEnd = sw / 2 - 0.8 * hl;
  const rising = [[x0, -y] as Pt, ...cubic([xa, -y], [0, -y], [0, y], [xb, y]), [xEnd, y] as Pt];
  const one: Shapes = [...stroke(rising, s), [arrowhead([sw / 2, y], 0, hl, hh)]];
  const two: Shapes = one.map((isl) => isl.map((r) => r.map(([px, py]): Pt => [px, -py]).reverse()));
  return [...one, ...two];
}

/**
 * Repeat: a rectangular loop drawn as two arrows chasing each other round it — the top one
 * pointing right, the bottom one (the same arrow turned half a turn) pointing left. Each side
 * stops a gap short of the other arrow's head, so the two arrows stay two. 1.3 h wide.
 */
export function repeatGlyph(h: number): Shapes {
  const s = strokeFor(h);
  const hl = 0.3 * h;
  const hh = 0.2 * h;
  const gap = 0.6 * s;
  const b = h / 2 - hh;
  const a = 0.65 * h - s / 2;
  const tipX = a + s / 2;
  const y0 = -b + hh + gap + s / 2;
  const path: Pt[] = [[-a, y0], [-a, b], [tipX - 0.8 * hl, b]];
  const top: Shapes = [...stroke(path, s), [arrowhead([tipX, b], 0, hl, hh)]];
  return [...top, ...rot180(top)];
}

/** A filled heart `w` wide, at the proportion the house heart blank ships at. */
export const heartGlyph = (w: number): Shapes => [[heartRing(w, 0.88 * w, 48)]];

// ------------------------------------------------------------------ the progress bar --

export interface TimelineBar {
  shapes: Shapes;
  /** Where the knob's centre landed, mm from the bar's centre. */
  knobX: number;
}

/**
 * The timeline: a bar `len` long, the played part `thick` and the rest `thin`, and a knob `knob`
 * across at `progress` (0..1). The knob travels between the bar's two ends, never past them, so
 * at 0 % and 100 % it still sits inside the margin the bar was measured to.
 */
export function timelineBar(len: number, progress: number, o: { knob: number; thick: number; thin: number }): TimelineBar {
  const p = Math.max(0, Math.min(1, progress));
  const kx = -len / 2 + o.knob / 2 + p * (len - o.knob);
  const left = -len / 2 + o.thick / 2;
  const right = len / 2 - o.thin / 2;
  const shapes: Shapes = [[circleRing(kx, 0, o.knob / 2, 40)]];
  if (kx > left) shapes.push([capsule([left, 0], [kx, 0], o.thick)]);
  if (right > kx) shapes.push([capsule([kx, 0], [right, 0], o.thin)]);
  return { shapes, knobX: kx };
}
