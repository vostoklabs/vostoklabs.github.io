// The art printed on a music plaque and a social-post frame: a progress bar and player buttons,
// a post's bar and its action icons. Plain geometry in millimetres, drawn for a 0.4 mm nozzle: every
// stroke at least 0.8 wide, every gap at least 0.8. Generic symbols, no service's look or name.
// Rings are counter-clockwise; a hole is clockwise. Filled non-zero, so overlapping pieces unite.
import { heartRing } from '@vostok/laser/blanks';
import type { MusicStrip, SocialLayout } from './layout';
import { ccw, circle, cw, roundedBox, type Pt, type Ring } from './outline';

const STROKE = 0.9;

function tri(a: Pt, b: Pt, c: Pt): Ring {
  return ccw([a, b, c]);
}

/** A straight stroke from a to b, `w` wide. */
function bar(a: Pt, b: Pt, w = STROKE): Ring {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
  const nx = (-dy / d) * (w / 2);
  const ny = (dx / d) * (w / 2);
  return ccw([
    [a[0] + nx, a[1] + ny],
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
  ]);
}

/** An arrowhead with its tip at `tip`, pointing along (dx, dy). */
function head(tip: Pt, dx: number, dy: number, size: number): Ring {
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const bx = tip[0] - ux * size;
  const by = tip[1] - uy * size;
  const h = size * 0.62;
  return tri(tip, [bx - uy * h, by + ux * h], [bx + uy * h, by - ux * h]);
}

/** A ring outline: a disc with a disc taken out. */
function hoop(cx: number, cy: number, r: number, w = STROKE): Ring[] {
  return [ccw(circle(cx, cy, r, 48)), cw(circle(cx, cy, r - w, 48))];
}

/** A filled heart centred on (cx, cy), `size` wide. */
export function heart(cx: number, cy: number, size: number): Ring {
  return ccw(heartRing(size, size * 0.9, 28).map(([x, y]) => [x + cx, y + cy] as Pt));
}

/* ---------------- music ---------------- */

function shuffle(cx: number, cy: number, g: number): Ring[] {
  const h = g * 0.32;
  const x0 = cx - g / 2;
  const x1 = cx + g / 2 - g * 0.3;
  const ah = g * 0.34;
  const out: Ring[] = [];
  for (const s of [1, -1]) {
    const a: Pt = [x0, cy - s * h];
    const b: Pt = [x1, cy + s * h];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    out.push(bar(a, b, 1.0), head([b[0] + (dx / d) * ah * 0.85, b[1] + (dy / d) * ah * 0.85], dx, dy, ah));
  }
  return out;
}

function skip(cx: number, cy: number, g: number, dir: 1 | -1): Ring[] {
  const h = g * 0.42;
  const w = g * 0.62;
  const tipX = cx + (dir * g) / 2 - dir * 1.1;
  const baseX = tipX - dir * w;
  const barX = cx + (dir * g) / 2 - (dir * 1.1) / 2;
  return [tri([tipX, cy], [baseX, cy + h], [baseX, cy - h]), bar([barX, cy - h], [barX, cy + h], 1.1)];
}

/** The play button: a disc with the triangle cut out of it. */
function play(cx: number, cy: number, d: number): Ring[] {
  const r = d / 2;
  const t = r * 0.42;
  return [ccw(circle(cx, cy, r, 64)), cw([[cx - t * 0.6, cy + t], [cx - t * 0.6, cy - t], [cx + t * 0.95, cy]])];
}

function repeat(cx: number, cy: number, g: number): Ring[] {
  const w = g * 0.92;
  const h = g * 0.62;
  const s = 1.0;
  const outer = roundedBox({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }, h * 0.45, 8);
  const inner = roundedBox({ x0: cx - w / 2 + s, x1: cx + w / 2 - s, y0: cy - h / 2 + s, y1: cy + h / 2 - s }, Math.max(0.1, h * 0.45 - s), 8);
  return [ccw(outer), cw(inner), head([cx + w * 0.12, cy + h / 2 - s / 2], 1, 0, g * 0.34)];
}

/** The player: the progress bar with its dot, five buttons, and the like symbol where given. */
export function musicArt(m: MusicStrip, like: Ring[] | null): Ring[] {
  const out: Ring[] = [];
  const { x0, x1, cy, thick, dot, at } = m.bar;
  out.push(roundedBox({ x0, x1, y0: cy - thick / 2, y1: cy + thick / 2 }, thick / 2 - 1e-3, 6));
  out.push(ccw(circle(x0 + (x1 - x0) * at, cy, dot / 2, 40)));
  const [a, b, c, d, e] = m.controls.xs as [number, number, number, number, number];
  const g = m.controls.glyph;
  const y = m.controls.cy;
  out.push(...shuffle(a, y, g), ...skip(b, y, g, -1), ...play(c, y, m.controls.play), ...skip(d, y, g, 1), ...repeat(e, y, g));
  if (like) out.push(...like);
  return out;
}

/* ---------------- a social post ---------------- */

function bubble(cx: number, cy: number, s: number): Ring[] {
  const r = s * 0.42;
  return [
    ccw(circle(cx, cy + s * 0.04, r, 40)),
    cw(circle(cx, cy + s * 0.04, r - STROKE, 40)),
    tri([cx - r * 0.75, cy - r * 0.35], [cx - r * 0.95, cy - r * 1.05], [cx - r * 0.2, cy - r * 0.75]),
  ];
}

function camera(cx: number, cy: number, s: number): Ring[] {
  const w = s * 0.46;
  const h = s * 0.36;
  const body = roundedBox({ x0: cx - w, x1: cx + w, y0: cy - h, y1: cy + h }, h * 0.45, 6);
  const inner = roundedBox({ x0: cx - w + STROKE, x1: cx + w - STROKE, y0: cy - h + STROKE, y1: cy + h - STROKE }, Math.max(0.1, h * 0.45 - STROKE), 6);
  return [ccw(body), cw(inner), ...hoop(cx, cy - s * 0.02, s * 0.2, STROKE), ccw(circle(cx + w * 0.62, cy + h * 0.55, Math.max(0.5, s * 0.06), 12))];
}

function plane(cx: number, cy: number, s: number): Ring[] {
  const h = s * 0.42;
  return [ccw([[cx - h, cy - h * 0.15], [cx + h, cy + h], [cx - h * 0.1, cy - h * 0.95]])];
}

function bookmark(cx: number, cy: number, s: number): Ring[] {
  const w = s * 0.32;
  const h = s * 0.46;
  return [ccw([[cx - w, cy - h], [cx, cy - h * 0.45], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]])];
}

function home(cx: number, cy: number, s: number): Ring[] {
  const w = s * 0.4;
  const h = s * 0.42;
  return [ccw([[cx - w * 0.8, cy - h], [cx + w * 0.8, cy - h], [cx + w * 0.8, cy + h * 0.15], [cx + w * 1.1, cy + h * 0.15], [cx, cy + h], [cx - w * 1.1, cy + h * 0.15], [cx - w * 0.8, cy + h * 0.15]])];
}

function search(cx: number, cy: number, s: number): Ring[] {
  const r = s * 0.28;
  const c: Pt = [cx - s * 0.08, cy + s * 0.08];
  return [...hoop(c[0], c[1], r), bar([c[0] + r * 0.6, c[1] - r * 0.6], [cx + s * 0.42, cy - s * 0.42], 1.1)];
}

function plus(cx: number, cy: number, s: number): Ring[] {
  const h = s * 0.42;
  const outer = roundedBox({ x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h }, h * 0.35, 6);
  const inner = roundedBox({ x0: cx - h + STROKE, x1: cx + h - STROKE, y0: cy - h + STROKE, y1: cy + h - STROKE }, Math.max(0.1, h * 0.35 - STROKE), 6);
  const a = h * 0.5;
  return [ccw(outer), cw(inner), bar([cx - a, cy], [cx + a, cy]), bar([cx, cy - a], [cx, cy + a])];
}

function person(cx: number, cy: number, s: number): Ring[] {
  return [ccw(circle(cx, cy + s * 0.18, s * 0.2, 32)), ccw(roundedBox({ x0: cx - s * 0.38, x1: cx + s * 0.38, y0: cy - s * 0.45, y1: cy - s * 0.05 }, s * 0.18, 8))];
}

/** The post's art: a camera and a paper plane either side of the name up top, the actions under
 *  the picture, and the bar of five icons at the foot. The name, the likes and the caption are
 *  words, set by the screen. */
export function socialArt(p: SocialLayout): Ring[] {
  const out: Ring[] = [];
  out.push(...camera(p.camera.cx, p.camera.cy, p.camera.size), ...plane(p.send.cx, p.send.cy, p.send.size));
  const [a, b, c] = p.actions.xs as [number, number, number];
  const s = p.actions.size;
  out.push(heart(a, p.actions.cy, s * 0.92), ...bubble(b, p.actions.cy, s), ...plane(c, p.actions.cy, s), ...bookmark(p.actions.bookmark, p.actions.cy, s));
  const n = p.nav;
  const [x0, x1, x2, x3, x4] = n.xs as [number, number, number, number, number];
  out.push(...home(x0, n.cy, n.size), ...search(x1, n.cy, n.size), ...plus(x2, n.cy, n.size), heart(x3, n.cy, n.size * 0.85), ...person(x4, n.cy, n.size));
  return out;
}
