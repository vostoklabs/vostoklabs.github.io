// The two outlines the QR stand needs and nothing else in the library does: the arched sign
// plate the code is engraved on, and the wedge foot it half-laps into. Closed-form ring math —
// ellipses and a raised cosine — in millimetres, Y up, outer rings CCW. No CSG, so `build()`
// calls these on the main thread.
import { roundedRectRing } from '@vostok/laser';
import type { CutRing } from '@vostok/export';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A quarter circle from `fromDeg` to `fromDeg + 90`, both ends included. */
function quarter(cx: number, cy: number, r: number, fromDeg: number, seg = 8): CutRing {
  const out: CutRing = [];
  for (let i = 0; i <= seg; i++) {
    const t = ((fromDeg + (i / seg) * 90) * Math.PI) / 180;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/**
 * The face plate: a flat bottom on two filleted corners, straight sides up to the spring line
 * at `h/2 − arch`, and a half-ellipse of semi-axes `(w/2, arch)` over the top.
 *
 * A half-ellipse's tangent at t = 0 and t = π is vertical, so the arch leaves the straight
 * sides tangent-continuously at any `arch` — no kink at the spring line. `arch = 0` degenerates
 * to a plain rounded rectangle, which is what the "Arched top: 0" end of the slider means.
 */
export function signPlateRing(w: number, h: number, corner: number, arch: number): CutRing {
  const hw = w / 2;
  const a = clamp(arch, 0, h - 2);
  if (a < 0.05) return roundedRectRing(w, h, clamp(corner, 0, Math.min(hw, h / 2)));
  const c = clamp(corner, 0, Math.min(hw, (h - a) / 2));
  const spring = h / 2 - a;
  const ring: CutRing = [];
  if (c > 0.01) {
    ring.push(...quarter(-hw + c, -h / 2 + c, c, 180));
    ring.push(...quarter(hw - c, -h / 2 + c, c, 270));
  } else {
    ring.push([-hw, -h / 2], [hw, -h / 2]);
  }
  ring.push([hw, spring]);
  for (let deg = 2; deg < 180; deg += 2) {
    const t = (deg * Math.PI) / 180;
    ring.push([hw * Math.cos(t), spring + a * Math.sin(t)]);
  }
  ring.push([-hw, spring]);
  return ring;
}

/**
 * Half the width of such a plate at height `y`: the straight side below the spring line, the
 * arch's chord above it. What a line of text at that height actually has to fit inside — the
 * reason a title under a deep arch is measured where its caps are, not at the plate's waist.
 *
 * @param crownY the top of the ellipse, `h/2` for the plate itself
 */
export function signPlateHalfWidthAt(y: number, w: number, crownY: number, arch: number): number {
  const hw = w / 2;
  const a = Math.max(0, arch);
  const spring = crownY - a;
  if (a < 0.05 || y <= spring) return hw;
  const t = clamp((y - spring) / a, 0, 1);
  return hw * Math.sqrt(Math.max(0, 1 - t * t));
}

/**
 * Half the width of an ARBITRARY outline at height `y`, measured from `cx` to the innermost
 * crossing on each side. `signPlateHalfWidthAt`'s companion for the shapes the library draws
 * rather than this file: a swing tag whose top corners are clipped at 45°, a heart with a cleft,
 * a star with a point.
 *
 * The innermost crossing, not the outermost, is what a line of text has to fit inside — on a
 * shape that re-opens above a notch, the text still has to pass the notch.
 */
export function ringHalfWidthAt(ring: CutRing, cx: number, y: number): number {
  let left = -Infinity;
  let right = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    if ((y1 > y) === (y2 > y)) continue;
    const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
    if (x <= cx) left = Math.max(left, x);
    else right = Math.min(right, x);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return Math.max(0, Math.min(cx - left, right - cx));
}

/**
 * A ring scaled about a box's centre so it lies `inset` mm inside it on every side — the frame
 * a silhouette gets when there is no offsetter on the main thread. Exact on a rectangle, an
 * ellipse and a clipped-corner swing tag; a fraction of a millimetre off on a deep concave
 * curve, which at a 1 mm engraved stroke is invisible.
 */
export function insetRing(ring: CutRing, w: number, h: number, cx: number, cy: number, inset: number): CutRing {
  const sx = w > 2 * inset ? (w - 2 * inset) / w : 0.01;
  const sy = h > 2 * inset ? (h - 2 * inset) / h : 0.01;
  return ring.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}
