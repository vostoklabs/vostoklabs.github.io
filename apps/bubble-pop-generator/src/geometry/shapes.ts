// The shape library, built parametrically in the worker.
//
// The spec proposed bundling SVG silhouettes and tracing them. Code turned out
// to be the better answer: no third-party assets to licence, no tracing error,
// exact smooth curves at any size, and a "shape" is ~6 lines. Everything here is
// composed from circles, rounded rectangles and polygons, so every silhouette is
// a valid, self-intersection-free CrossSection by construction.
//
// Each shape is drawn in whatever units are convenient and then normalised so
// its longest side is exactly `size`, centred on the origin.
import type { ShapeKind } from '../types';

type Wasm = any;
type Section = any;
type Track = <T extends { delete(): void }>(o: T) => T;

export interface ShapeOptions {
  cornerRadius: number;
  holeRatio: number;
  starPoints: number;
  /** Width/height of the traced image, used by the `rectangle` shape. */
  aspect: number;
}

export function buildShape(
  wasm: Wasm,
  track: Track,
  kind: ShapeKind,
  size: number,
  o: ShapeOptions,
): Section {
  const { CrossSection } = wasm;
  const T = track;

  const circle = (r: number, seg = 128): Section => T(CrossSection.circle(r, seg));
  const ellipse = (a: number, b: number): Section => T(circle(1, 128).scale([a, b]));
  const poly = (pts: [number, number][]): Section => T(new CrossSection([pts], 'NonZero'));
  const at = (s: Section, x: number, y: number): Section => T(s.translate([x, y]));
  const union = (list: Section[]): Section => T(CrossSection.union(list));

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.01, Math.min(r, Math.min(w, h) / 2 - 0.001));
    const core = T(CrossSection.square([Math.max(0.02, w - 2 * rr), Math.max(0.02, h - 2 * rr)], true));
    return T(core.offset(rr, 'Round', 2.0, 32));
  };
  const capsule = (w: number, h: number): Section => roundedRect(w, h, Math.min(w, h) / 2);

  /** Round convex corners: shrink then grow. */
  const roundCorners = (s: Section, r: number): Section =>
    r <= 0.001 ? s : T(T(s.offset(-r, 'Round', 2.0, 32)).offset(r, 'Round', 2.0, 32));
  /** Fillet concave corners: grow then shrink. Used to blend unions. */
  const blend = (s: Section, r: number): Section =>
    r <= 0.001 ? s : T(T(s.offset(r, 'Round', 2.0, 32)).offset(-r, 'Round', 2.0, 32));

  const regular = (n: number, r: number, rotDeg: number): Section => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + (rotDeg * Math.PI) / 180;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return poly(pts);
  };

  const param = (n: number, f: (t: number) => [number, number]): Section => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push(f((2 * Math.PI * i) / n));
    return poly(pts);
  };

  /** Scale + centre so the longest side is exactly `size`. */
  const normalize = (s: Section): Section => {
    const b = s.bounds();
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const k = size / Math.max(w, h, 1e-6);
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    return T(T(s.translate([-cx, -cy])).scale([k, k]));
  };

  const cr = Math.max(0, o.cornerRadius);

  switch (kind) {
    case 'square':
      // A hair of rounding only, so the corners survive slicing.
      return normalize(roundedRect(100, 100, 0.4));

    case 'roundedSquare':
      return normalize(roundedRect(100, 100, (cr / size) * 100));

    case 'rectangle': {
      const a = Math.max(0.35, Math.min(2.8, o.aspect || 1.4));
      const w = a >= 1 ? 100 : 100 * a;
      const h = a >= 1 ? 100 / a : 100;
      return normalize(roundedRect(w, h, (cr / size) * 100));
    }

    case 'hexagon':
      return normalize(regular(6, 50, 90));

    case 'octagon':
      return normalize(regular(8, 50, 22.5));

    case 'triangle':
      return normalize(roundCorners(regular(3, 55, 90), 6));

    case 'donut': {
      const ratio = Math.max(0.15, Math.min(0.72, o.holeRatio));
      return normalize(T(circle(50, 160).subtract(circle(50 * ratio, 128))));
    }

    case 'heart':
      // The classic cardioid-ish curve. Drawn upright, then normalised.
      return normalize(
        param(220, (t) => [
          16 * Math.sin(t) ** 3,
          13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
        ]),
      );

    case 'star': {
      const n = Math.max(4, Math.min(12, Math.round(o.starPoints) || 5));
      const pts: [number, number][] = [];
      for (let i = 0; i < 2 * n; i++) {
        const r = i % 2 === 0 ? 50 : 50 * 0.46;
        const a = (Math.PI * i) / n + Math.PI / 2;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      // Round the points a little; a needle-sharp star tip is unprintable and
      // has no room for material anyway.
      return normalize(blend(roundCorners(poly(pts), 3.5), 1.5));
    }

    case 'flower': {
      const petals = 6;
      const list: Section[] = [circle(24, 96)];
      for (let i = 0; i < petals; i++) {
        const a = (2 * Math.PI * i) / petals;
        list.push(at(circle(20, 96), Math.cos(a) * 30, Math.sin(a) * 30));
      }
      return normalize(blend(union(list), 5));
    }

    case 'egg':
      // Narrower at the top (sin t > 0) — an egg, not an ellipse.
      return normalize(param(160, (t) => [40 * Math.cos(t) * (1 - 0.2 * Math.sin(t)), 52 * Math.sin(t)]));

    case 'cloud': {
      const list = [
        at(circle(22, 96), -30, 0),
        at(circle(30, 96), -4, 8),
        at(circle(24, 96), 24, 2),
        at(circle(18, 96), 44, -6),
        at(roundedRect(96, 26, 12), 6, -14),
      ];
      return normalize(blend(union(list), 7));
    }

    case 'moon': {
      const outer = circle(50, 160);
      const bite = at(circle(44, 160), 26, 6);
      // Round the horns: a crescent's tips taper to nothing, and nothing is not
      // printable.
      return normalize(blend(roundCorners(T(outer.subtract(bite)), 2), 3));
    }

    case 'lightning':
      return normalize(
        roundCorners(
          poly([
            [10, 50],
            [-26, -2],
            [-2, -2],
            [-14, -50],
            [26, 8],
            [2, 8],
          ]),
          3,
        ),
      );

    case 'speech': {
      const body = roundedRect(100, 72, Math.max(6, (cr / size) * 100));
      const tail = at(poly([[-16, 0], [10, 0], [-4, -26]]), -14, -34);
      return normalize(blend(union([body, tail]), 3));
    }

    case 'human': {
      const head = at(circle(17, 96), 0, 46);
      const torso = at(capsule(34, 46), 0, 12);
      const armL = at(T(capsule(46, 16).rotate(28)), -22, 18);
      const armR = at(T(capsule(46, 16).rotate(-28)), 22, 18);
      const legL = at(T(capsule(48, 17).rotate(74)), -13, -32);
      const legR = at(T(capsule(48, 17).rotate(-74)), 13, -32);
      return normalize(blend(union([head, torso, armL, armR, legL, legR]), 6));
    }

    case 'cat': {
      const head = circle(46, 128);
      const earL = at(roundCorners(poly([[-22, 0], [10, 0], [-8, 34]]), 4), -26, 32);
      const earR = at(roundCorners(poly([[-10, 0], [22, 0], [8, 34]]), 4), 26, 32);
      return normalize(blend(union([head, earL, earR]), 4));
    }

    case 'paw': {
      const pad = at(T(circle(30, 128).scale([1.15, 1])), 0, -16);
      const toes: Section[] = [];
      const spec: [number, number, number][] = [
        [-34, 22, 13],
        [-12, 36, 14],
        [13, 36, 14],
        [34, 21, 13],
      ];
      for (const [x, y, r] of spec) toes.push(at(circle(r, 96), x, y));
      return normalize(blend(union([pad, ...toes]), 3));
    }

    case 'fish': {
      const body = T(circle(34, 128).scale([1.5, 1]));
      const tail = at(roundCorners(poly([[0, 0], [30, 22], [30, -22]]), 4), 44, 0);
      return normalize(blend(union([body, tail]), 5));
    }

    case 'butterfly': {
      const upL = at(T(circle(26, 96).scale([1, 1.25])), -26, 16);
      const upR = at(T(circle(26, 96).scale([1, 1.25])), 26, 16);
      const loL = at(circle(20, 96), -21, -22);
      const loR = at(circle(20, 96), 21, -22);
      const body = capsule(13, 74);
      return normalize(blend(union([upL, upR, loL, loR, body]), 6));
    }

    case 'circle':
    default:
      return normalize(circle(50, 160));
  }
}
