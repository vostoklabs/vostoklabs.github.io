// What the two photo frames share on the form: the photo size and its orientation, the border,
// the assembly numbers, and the one step from those values to the construction. The construction
// itself — the three sheets, the photo slot, the stand — is `engine/photo-frame.ts`; each frame
// template owns only its decoration and its lettering.
import type { CutRing } from '@vostok/export';
import { PHOTO_PRESETS, frameGeometry, presetOf, type FrameGeometry } from '../engine/photo-frame';
import { fitOf, qrAssemblyFields } from './qr-shared';
import { num, str, type Field, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A full, round heart `w` wide and `h` tall, centred on the origin — the reference photos' heart
 * (the blank library's `heartRing` runs straight sides down to a sharp point, and reads as a V):
 * two lobes of radius 0.28·w, each side a circular arc tangent to its lobe 37° below the lobe's
 * middle and bowing outward down to the tip, the tip rounded by 0.045·w. Counter-clockwise, from
 * the bottom of the tip.
 */
export function plumpHeart(w: number, h: number, n = 24): CutRing {
  const R = 0.28;
  const phi = (-37 * Math.PI) / 180;
  const rt = 0.045;
  const H = h / w;
  const L = [0.5 - R, H / 2 - R] as const;
  const P = [0, -H / 2] as const;
  const T = [L[0] + R * Math.cos(phi), L[1] + R * Math.sin(phi)] as const;
  // The side: the circle tangent to the lobe at T (its centre on the line T → lobe centre) that
  // passes through the tip — |T − P|² / (−2 v·(T − P)) with v the lobe's inward normal at T.
  const v = [(L[0] - T[0]) / R, (L[1] - T[1]) / R] as const;
  const tp = [T[0] - P[0], T[1] - P[1]] as const;
  const Rs = (tp[0] * tp[0] + tp[1] * tp[1]) / (-2 * (v[0] * tp[0] + v[1] * tp[1]));
  const S = [T[0] + Rs * v[0], T[1] + Rs * v[1]] as const;
  const aT = Math.atan2(T[1] - S[1], T[0] - S[0]);
  let aP = Math.atan2(P[1] - S[1], P[0] - S[0]);
  while (aP > aT) aP -= 2 * Math.PI;
  // The side sampled tip → T, finely, so the tip's fillet can find where it touches.
  const side: [number, number][] = [];
  const m = 8 * n;
  for (let i = 0; i <= m; i++) {
    const a = aP + ((aT - aP) * i) / m;
    side.push([S[0] + Rs * Math.cos(a), S[1] + Rs * Math.sin(a)]);
  }
  // The tip's fillet: the circle of radius rt on the axis that just touches the side, by
  // bisection on its height; the side carries on from the point it touches.
  const near = (fy: number) => {
    let d = Infinity;
    let k = 0;
    side.forEach(([x, y], i) => { const e = Math.hypot(x, y - fy); if (e < d) { d = e; k = i; } });
    return { d, k };
  };
  let lo = P[1];
  let hi = P[1] + 4 * rt;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (near(mid).d < rt) lo = mid; else hi = mid; }
  const fy = (lo + hi) / 2;
  const { k } = near(fy);
  const a1 = Math.atan2(side[k]![1] - fy, side[k]![0]);
  const right: [number, number][] = [];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + ((a1 + Math.PI / 2) * i) / 5; right.push([rt * Math.cos(a), fy + rt * Math.sin(a)]); }
  for (let i = k + 8; i < m; i += 8) right.push(side[i]!);
  right.push([T[0], T[1]]);
  // Over the lobe from T to the cleft, where the lobe meets the axis.
  const cleft = Math.PI - Math.acos(Math.min(1, L[0] / R));
  for (let i = 1; i <= n; i++) { const a = phi + ((cleft - phi) * i) / n; right.push([L[0] + R * Math.cos(a), L[1] + R * Math.sin(a)]); }
  const ring = [...right, ...right.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return ring.map(([x, y]) => [((x - (x0 + x1) / 2) / (x1 - x0)) * w, ((y - (y0 + y1) / 2) / (y1 - y0)) * h]);
}

/** The Border slider's floor: 18 mm keeps the middle's side walls over 8 mm at every preset
 *  (5 × 7's is the thinnest, at s − 9). */
export const BORDER_MIN = 18;
export const BORDER_MAX = 30;
/** The default: a decoration's inner edge is held 9.8 mm outside the window by the photo slot, so
 *  only the border decides how much of it sits ON the frame — at 26 about half, as in both
 *  reference photos (at 20 a third, and the outline read as a rectangle with ears). */
export const BORDER_DEFAULT = 26;

/** LEFT, "Frame": the print it takes and which way up. The orientation is hidden for a print that
 *  only comes one way (the squares, instant square and wide), never greyed. */
export function photoFields(orientation: 'portrait' | 'landscape'): Field[] {
  return [
    {
      kind: 'select', key: 'photo', label: 'Photo size', section: 'Frame', value: '4x6',
      options: PHOTO_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      kind: 'select', key: 'orientation', label: 'Orientation', section: 'Frame', value: orientation,
      options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
      visibleWhen: (v) => !presetOf(str(v, 'photo')).fixed,
    },
  ];
}

/** How wide the frame is round the photo — in the Frame category, with the photo size. */
export function borderField(): Field {
  return {
    kind: 'number', key: 'border', label: 'Border', section: 'Frame', value: BORDER_DEFAULT,
    min: BORDER_MIN, max: BORDER_MAX, step: 1, unit: 'mm',
    help: 'How wide the frame is round the photo.',
  };
}

/** LEFT, "Assembly", declared last: thickness, kerf, fit — the stand's tabs are cut to them.
 *  Three sheets of 6 mm is an 18 mm frame already; past it the tab no longer fits the rail. */
export const frameAssemblyFields = (): Field[] => qrAssemblyFields({ thickness: { max: 6 } });

/**
 * The construction for these values. `band` turns the border into the bottom band (the name's
 * room), which each design sizes for its own lettering.
 */
export function readFrame(v: Values, o: { band: (border: number) => number; windowCorner: number }): FrameGeometry {
  const border = clamp(num(v, 'border') || BORDER_DEFAULT, BORDER_MIN, BORDER_MAX);
  return frameGeometry({
    photo: str(v, 'photo'),
    orientation: str(v, 'orientation'),
    border,
    band: o.band(border),
    t: clamp(num(v, 'thickness') || 3, 1.5, 6),
    kerf: num(v, 'kerf'),
    clearance: fitOf(v),
    windowCorner: o.windowCorner,
  });
}
