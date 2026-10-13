// The outlines, as rings in millimetres (front view, counter-clockwise). Pure: the worker turns
// them into solids, the screen draws the Shape pictures from the same rings.
//
// Every shaped edge is spaced along the WHOLE perimeter, corners included, so a scallop or a wave
// runs round a corner as evenly as along a side.
import { heartRing } from '@vostok/laser/blanks';
import { SCALLOP, SQUIGGLE, clamp, type Box, type FrameLayout, type Radii } from './layout';

export type Pt = [number, number];
export type Ring = Pt[];

/** A box with rounded corners (radii top-left, top-right, bottom-right, bottom-left), counter-clockwise. */
export function roundedBoxR(b: Box, radii: Radii, perCorner = 12): Ring {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const lim = (r: number) => Math.max(0, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3));
  const [tl, tr, br, bl] = radii.map(lim) as Radii;
  const out: Ring = [];
  const arc = (cx: number, cy: number, r: number, a0: number) => {
    if (r < 1e-3) {
      out.push([cx, cy]);
      return;
    }
    const n = Math.max(2, Math.round(perCorner * Math.min(1, r / 6) + 2));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(b.x1 - br, b.y0 + br, br, -Math.PI / 2);
  arc(b.x1 - tr, b.y1 - tr, tr, 0);
  arc(b.x0 + tl, b.y1 - tl, tl, Math.PI / 2);
  arc(b.x0 + bl, b.y0 + bl, bl, Math.PI);
  return out;
}

export function roundedBox(b: Box, r: number, perCorner = 12): Ring {
  return roundedBoxR(b, [r, r, r, r], perCorner);
}

export function circle(cx: number, cy: number, r: number, n = 48): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Signed area: positive for counter-clockwise. */
export function area(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
  return a / 2;
}

export const ccw = (r: Ring): Ring => (area(r) >= 0 ? r : [...r].reverse());
export const cw = (r: Ring): Ring => (area(r) <= 0 ? r : [...r].reverse());

/** Points evenly spaced along a closed path by arc length, each with its outward normal. */
export function along(path: Ring, count: number): { p: Pt; n: Pt; s: number }[] {
  const lens: number[] = [0];
  for (let i = 1; i <= path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i % path.length]!;
    lens.push(lens[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lens[path.length]!;
  const out: { p: Pt; n: Pt; s: number }[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (total * k) / count;
    while (lens[seg + 1]! < s) seg++;
    const a = path[seg]!;
    const b = path[(seg + 1) % path.length]!;
    const t = (s - lens[seg]!) / Math.max(1e-9, lens[seg + 1]! - lens[seg]!);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    out.push({ p: [a[0] + dx * t, a[1] + dy * t], n: [dy / d, -dx / d], s: s / total });
  }
  return out;
}

export function perimeter(path: Ring): number {
  let t = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % path.length]!;
    t += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return t;
}

/**
 * A closed curve that swings `amp` either side of a box with corners of radius `r`: a whole number
 * of waves along each side, about `wavelength` long, and every corner swung out, so the four
 * corners match and each side reads as even waves between them (refs 06, 23, 27). Counter-clockwise.
 */
export function waveRing(b: Box, r: number, amp: number, wavelength: number, perWave = 20): Ring {
  const rr = Math.max(0.5, Math.min(r, (b.x1 - b.x0) / 2 - 0.5, (b.y1 - b.y0) / 2 - 0.5));
  const out: Ring = [];
  // A side from (x0, y0) to (x1, y1), its outward normal (nx, ny): k waves, out at both ends.
  const side = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.round(len / wavelength));
    const n = k * perWave;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const off = amp * Math.cos(2 * Math.PI * k * t);
      out.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
    }
  };
  // A corner: a quarter turn of radius r + amp about (cx, cy), from angle a0.
  const corner = (cx: number, cy: number, a0: number) => {
    const n = Math.max(4, Math.round(perWave / 2));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      out.push([cx + (rr + amp) * Math.cos(a), cy + (rr + amp) * Math.sin(a)]);
    }
  };
  side(b.x0 + rr, b.y0, b.x1 - rr, b.y0, 0, -1);
  corner(b.x1 - rr, b.y0 + rr, -Math.PI / 2);
  side(b.x1, b.y0 + rr, b.x1, b.y1 - rr, 1, 0);
  corner(b.x1 - rr, b.y1 - rr, 0);
  side(b.x1 - rr, b.y1, b.x0 + rr, b.y1, 0, 1);
  corner(b.x0 + rr, b.y1 - rr, Math.PI / 2);
  side(b.x0, b.y1 - rr, b.x0, b.y0 + rr, -1, 0);
  corner(b.x0 + rr, b.y0 + rr, Math.PI);
  return out;
}

/**
 * How the worker makes a frame's outline: the rings to unite, a band to add (ric-rac) or to be the
 * whole frame (squiggle), the close that softens inside cusps, and a flat cut along the bottom
 * where the frame has to stand.
 */
export interface OutlineRecipe {
  rings: Ring[];
  band: { centre: Ring; half: number; only: boolean } | null;
  close: number;
  clipBottom: number | null;
}

export function outlineRecipe(L: FrameLayout): OutlineRecipe {
  const b = L.body;
  const spec = L.spec;
  const rings: Ring[] = [];
  let band: OutlineRecipe['band'] = null;
  let close = 0;
  if (spec.outline === 'squiggle') {
    // A puffy wavy band of even width: its centre line swings round the print, so its inside edge
    // laps the picture and its outside edge leaves the rails a full wall.
    const e = SQUIGGLE.e;
    const c = { x0: L.cx - L.pw / 2 - e, x1: L.cx + L.pw / 2 + e, y0: -L.ph / 2 - e, y1: L.ph / 2 + e };
    band = { centre: waveRing(c, SQUIGGLE.corner, SQUIGGLE.a, SQUIGGLE.wave, 24), half: SQUIGGLE.h, only: true };
  } else {
    rings.push(roundedBoxR(b, L.radii));
    if (spec.outline === 'scallop') {
      rings.push(...scallops(b, L.radii, SCALLOP.depth, SCALLOP.pitch));
      close = 0.35;
    } else if (spec.outline === 'ricrac') {
      // A tight even wave, sewn on just outside the plain edge.
      const c = { x0: b.x0 + 0.6, x1: b.x1 - 0.6, y0: b.y0 + 0.6, y1: b.y1 - 0.6 };
      band = { centre: waveRing(c, Math.max(4, L.radii[2]), 2.2, 7.6, 16), half: 1.9, only: false };
    }
  }
  if (L.crest) rings.push(crestRing(L.crest.box));
  return {
    rings: rings.map(ccw),
    band,
    close,
    clipBottom: L.bottomStraight && spec.outline !== 'rect' && spec.outline !== 'arch' ? b.y0 : null,
  };
}

/**
 * Small round scallops all the way round, `depth` proud of the plain edge and about `pitch` apart:
 * arcs of a circle sized so neighbours meet on the edge itself, a shallow even scallop rather than
 * a row of bubbles (ref 08).
 */
export function scallops(b: Box, radii: Radii, depth: number, pitch: number): Ring[] {
  const rs = (pitch * pitch) / 4 / (2 * depth) + depth / 2;
  const inset = rs - depth;
  const inner = { x0: b.x0 + inset, x1: b.x1 - inset, y0: b.y0 + inset, y1: b.y1 - inset };
  const r = Math.max(1, Math.max(...radii) - inset);
  const path = roundedBox(inner, r, 24);
  const count = Math.max(12, Math.round(perimeter(roundedBoxR(b, radii, 24)) / pitch));
  return along(path, count).map(({ p }) => circle(p[0], p[1], rs, 48));
}

/** The crest the initials sit on: a soft arch rising from the top edge. */
export function crestRing(box: Box): Ring {
  const r = Math.min((box.x1 - box.x0) / 2, (box.y1 - box.y0) * 0.75);
  return roundedBoxR(box, [r, r, 1, 1], 16);
}

/** A holder's plan outline: the bar a rounded box, the pill round-ended, the heart point to the front. */
export function holderPlan(shape: 'bar' | 'pill' | 'heart', L: number, D: number, heart: { w: number; h: number; slotY: number } | null): Ring {
  if (shape === 'heart' && heart) return ccw(heartRing(heart.w, heart.h, 96) as Ring);
  const box = { x0: -L / 2, x1: L / 2, y0: 0, y1: D };
  return roundedBox(box, shape === 'pill' ? D / 2 - 0.01 : 4, 16);
}

/** An SVG path of rings, y flipped for the screen, for a picture tile. */
export function ringsPath(rings: Ring[]): string {
  return rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L')}Z`).join('');
}

export { clamp };
