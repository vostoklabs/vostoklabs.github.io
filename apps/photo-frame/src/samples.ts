/*
  Sample pictures for the preview: four scenes, so a frame, a holder or a plaque on screen
  holds a picture instead of a blank card and the customer sees how theirs will look. They are
  shown in the preview only, never put in an export.

  Drawn here, in code, as SVG (gradients, layered silhouettes, a sun or a moon, reflections), not
  photographs: nothing is downloaded and nothing carries a licence. Each is 1200 x 900 with its
  subject in the middle third and sky, water or ground at the edges, because it is shown cropped
  to the photo's shape, often portrait (46 x 62, 54 x 86).
*/

export interface SamplePhoto {
  id: string;
  name: string;
  svg: string;
}

const W = 1200;
const H = 900;

type Pt = [number, number];
/** A circle: centre and radius. */
type Puff = [number, number, number];
/** A gradient stop: offset, colour and opacity. */
type Stop = [number, string, number?];

/** A number for an attribute: a tenth of a pixel is plenty. */
const n = (v: number) => String(Math.round(v * 10) / 10);

/** A small seeded generator (mulberry32), so a scene is drawn the same on every load. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ paint */

const stops = (list: Stop[]) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');

/** A gradient from (x1, y1) to (x2, y2), in the picture's own pixels. */
const linear = (id: string, list: Stop[], x1: number, y1: number, x2: number, y2: number) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops(list)}</linearGradient>`;

/** Top to bottom across whatever it fills, each shape on its own: a puff lit from above. */
const down = (id: string, list: Stop[]) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops(list)}</linearGradient>`;

/** A round gradient about (cx, cy), squashed to `sy` of its height. */
const radial = (id: string, list: Stop[], cx: number, cy: number, r: number, sy = 1) =>
  `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${sy === 1 ? '' : ` gradientTransform="translate(0 ${n(cy * (1 - sy))}) scale(1 ${sy})"`}>${stops(list)}</radialGradient>`;

/** A soft blur, wider one way than the other. */
const blur = (id: string, sx: number, sy = sx) =>
  `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sx} ${sy}"/></filter>`;

/** Water's ripple: what it reflects pushed sideways in thin bands, then smeared downwards. */
const ripple = (id: string, seed: number, strength: number, smear: number) =>
  `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">`
  + `<feTurbulence type="fractalNoise" baseFrequency="0.004 0.07" numOctaves="2" seed="${seed}" result="noise"/>`
  // Only the red channel moves anything, and only sideways: green is held at the middle.
  + '<feColorMatrix in="noise" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="sideways"/>'
  + `<feDisplacementMap in="SourceGraphic" in2="sideways" scale="${strength}" xChannelSelector="R" yChannelSelector="G"/>`
  + `<feGaussianBlur stdDeviation="0.8 ${smear}"/></filter>`;

/** Broad patches of light and shade over everything it is put on, so a field or a slope is not
 *  one flat colour. `freq` is the patches' size (smaller is bigger), as "x y". */
const mottle = (id: string, seed: number, freq: string, dark: number, light: number) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%">`
  + `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="noise"/>`
  + `<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${dark * 2} 0 0 0 ${-dark * 0.9}" result="shade"/>`
  + `<feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 0.85  ${-light * 2} 0 0 0 ${light * 1.1}" result="sun"/>`
  + '<feComposite in="shade" in2="SourceGraphic" operator="in" result="shadeIn"/>'
  + '<feComposite in="sun" in2="SourceGraphic" operator="in" result="sunIn"/>'
  + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shadeIn"/><feMergeNode in="sunIn"/></feMerge></filter>';

/* ------------------------------------------------------------------ shapes */

/** A smooth curve through the points. */
function smooth(pts: Pt[]): string {
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(i + 2, pts.length - 1)]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

const poly = (pts: Pt[]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}`;

/** A shape whose top edge is `edge` (drawn through `pts`) and which reaches down to `bottom`. */
const below = (edge: string, pts: Pt[], bottom = H) => `${edge}L${n(pts[pts.length - 1]![0])} ${bottom}L${n(pts[0]![0])} ${bottom}Z`;

/** A ridge through the key points, made rough by halving each span and nudging its middle. */
function ridge(rand: () => number, keys: Pt[], rough: number, levels = 6): Pt[] {
  let pts = keys;
  let amp = rough;
  for (let l = 0; l < levels; l++) {
    const next: Pt[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      next.push([(x0 + x1) / 2, (y0 + y1) / 2 + (rand() - 0.5) * amp * (x1 - x0)], [x1, y1]);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}

/** The height of an eased curve through the keys at `x`: where to stand something on a hill. */
function heightAt(keys: Pt[], x: number): number {
  for (let i = 1; i < keys.length; i++) {
    const [x0, y0] = keys[i - 1]!;
    const [x1, y1] = keys[i]!;
    if (x <= x1) return y0 + (y1 - y0) * (0.5 - Math.cos(((x - x0) / (x1 - x0)) * Math.PI) / 2);
  }
  return keys[keys.length - 1]![1];
}

/** The curve through the keys as many points, for `below` with a curve `heightAt` agrees with. */
const eased = (keys: Pt[], step = 20): Pt[] => {
  const pts: Pt[] = [];
  for (let x = keys[0]![0]; x < keys[keys.length - 1]![0]; x += step) pts.push([x, heightAt(keys, x)]);
  pts.push(keys[keys.length - 1]!);
  return pts;
};

interface Drawn {
  defs: string;
  body: string;
}

/** A soft edge that is also ragged: the outline pushed about by fractal noise of `freq`, by up to
 *  about a fifth of `scale` pixels, then blurred. What makes a cloud fluffy and a crown leafy. */
const ragged = (id: string, soft: number, scale: number, freq: number, seed: number) =>
  `<filter id="${id}" x="-15%" y="-25%" width="130%" height="150%">`
  + `<feTurbulence type="fractalNoise" baseFrequency="${freq.toFixed(4)}" numOctaves="2" seed="${seed}" result="noise"/>`
  + `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${n(scale)}" xChannelSelector="R" yChannelSelector="G" result="moved"/>`
  + `<feGaussianBlur in="moved" stdDeviation="${soft}"/></filter>`;

/**
 * Something soft and round, lit from one side: a cloud, a tree's crown. The puffs are filled
 * with `shade`, then again with `lit` moved `toLight` towards the light, so shade is left only on
 * the far rims and between the puffs; all of it clipped to the puffs, and above `floor` when
 * there is one (a cumulus's flat base). `rag` (scale, frequency) roughens the outline.
 */
function lumpy(id: string, puffs: Puff[], o: { lit: string; shade: string; toLight: Pt; soft: number; rag?: [number, number]; floor?: number; opacity?: number }): Drawn {
  const circles = puffs.map(([x, y, r]) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`).join('');
  const left = Math.min(...puffs.map(([x, , r]) => x - r));
  const right = Math.max(...puffs.map(([x, , r]) => x + r));
  const top = Math.min(...puffs.map(([, y, r]) => y - r));
  const bottom = Math.max(...puffs.map(([, y, r]) => y + r));
  const floor = o.floor === undefined ? '' : `<clipPath id="${id}-floor"><rect x="${n(left - 9)}" y="${n(top - 9)}" width="${n(right - left + 18)}" height="${n(o.floor - top + 9)}"/></clipPath>`;
  const inner = `<g clip-path="url(#${id}-in)"><rect x="${n(left)}" y="${n(top)}" width="${n(right - left)}" height="${n(bottom - top)}" fill="${o.shade}"/>`
    + `<g fill="${o.lit}" transform="translate(${n(o.toLight[0])} ${n(o.toLight[1])})">${circles}</g></g>`;
  return {
    defs: `<clipPath id="${id}-in">${circles}</clipPath>${floor}`
      + (o.rag ? ragged(`${id}-soft`, o.soft, o.rag[0], o.rag[1], puffs.length) : blur(`${id}-soft`, o.soft)),
    body: `<g filter="url(#${id}-soft)"${o.opacity === undefined ? '' : ` opacity="${o.opacity}"`}>${floor ? `<g clip-path="url(#${id}-floor)">${inner}</g>` : inner}</g>`,
  };
}

/** The puffs of a cumulus `w` wide and `h` tall on a flat base at `base`, about `cx`. */
function cumulus(rand: () => number, cx: number, base: number, w: number, h: number): Puff[] {
  const puffs: Puff[] = [];
  const row = Math.max(4, Math.round(w / (h * 0.5)));
  for (let i = 0; i < row; i++) {
    const t = (i + 0.5) / row;
    const r = h * (0.2 + 0.1 * rand()) * (0.7 + 0.6 * Math.sin(t * Math.PI));
    puffs.push([cx - w / 2 + w * t, base - r * 0.5, r]);
  }
  const peak = cx + (rand() - 0.5) * w * 0.3;
  const heap = Math.max(5, Math.round(w / (h * 0.2)));
  for (let i = 0; i < heap; i++) {
    const x = cx - w * 0.42 + (w * 0.84 * (i + rand())) / heap;
    const d = Math.max(0, 1 - Math.abs(x - peak) / (w * 0.5));
    const r = h * (0.12 + 0.22 * d) * (0.8 + rand() * 0.4);
    puffs.push([x, base - h * 0.26 - d * d * h * 0.5 - r * 0.1 + (rand() - 0.5) * h * 0.12, r]);
  }
  return puffs;
}

/** A cloud, white above and grey-blue beneath, lit from the upper left. */
const cloud = (rand: () => number, id: string, cx: number, base: number, w: number, h: number, soft: number, opacity = 1) =>
  lumpy(id, cumulus(rand, cx, base, w, h), { lit: 'url(#puffLit)', shade: '#bfcbd9', toLight: [-h * 0.025, -h * 0.05], soft, rag: [Math.max(14, h * 0.28), 2.4 / h], floor: base, opacity });

/** A conifer's outline, `h` tall, standing at (x, y). */
function pine(rand: () => number, x: number, y: number, h: number): string {
  const tiers = 5 + Math.floor(rand() * 3);
  const w = h * (0.24 + rand() * 0.08);
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let t = 1; t <= tiers; t++) {
    const ty = y - h + h * 0.92 * (t / tiers);
    const tw = w * (t / tiers);
    right.push([x + tw * (0.85 + rand() * 0.3), ty], [x + tw * 0.3, ty - h * 0.035]);
    left.push([x - tw * (0.85 + rand() * 0.3), ty], [x - tw * 0.3, ty - h * 0.035]);
  }
  return `${poly([[x, y - h], ...right, [x + w * 0.1, y], [x - w * 0.1, y], ...left.reverse()])}Z`;
}

function svg(defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>${down('puffLit', [[0, '#ffffff'], [0.6, '#f9fbfd'], [1, '#e2e9f1']])}${defs}</defs>${body}</svg>`;
}

/* ------------------------------------------------------------------ a lake at sunset */

function lake(): string {
  const rand = random(7);
  const WATER = 590;
  const SUN: Pt = [600, 534];

  const far = ridge(rand, [[-20, 512], [180, 470], [380, 508], [520, 538], [690, 530], [860, 486], [1040, 462], [1220, 498]], 0.3);
  const peaks = ridge(rand, [[-20, 318], [100, 262], [228, 196], [300, 238], [372, 318], [452, 402], [530, 488], [586, 560], [626, 592], [668, 552], [742, 470], [828, 382], [918, 302], [1012, 252], [1090, 286], [1220, 318]], 0.5);
  const footLeft = ridge(rand, [[-20, 430], [110, 404], [250, 446], [380, 520], [470, 592]], 0.28);
  const footRight = ridge(rand, [[742, 592], [840, 526], [960, 470], [1080, 446], [1220, 456]], 0.28);
  const shoreLeft: Pt[] = [[-20, 488], [110, 512], [220, 552], [300, 580], [350, WATER + 1]];
  const shoreRight: Pt[] = [[862, WATER + 1], [930, 574], [1020, 540], [1120, 506], [1220, 490]];
  let trees = '';
  for (let x = -10; x < 340; x += 10 + rand() * 12) trees += pine(rand, x, heightAt(shoreLeft, x) + 5, (28 + rand() * 44) * (1.15 - x / 420));
  for (let x = 1210; x > 870; x -= 10 + rand() * 12) trees += pine(rand, x, heightAt(shoreRight, x) + 5, (28 + rand() * 44) * (1.15 - (1200 - x) / 420));

  // Thin clouds, dark above and lit pink from below by the sun.
  const streaks: [number, number, number, number, number][] = [
    [340, 238, 270, 10, 0.75], [830, 202, 250, 9, 0.65], [560, 318, 210, 8, 0.7], [990, 350, 230, 10, 0.6],
    [200, 380, 220, 8, 0.65], [720, 414, 190, 6, 0.6], [470, 146, 190, 7, 0.45], [1050, 120, 160, 6, 0.4], [120, 270, 150, 6, 0.5],
  ];
  const clouds = streaks.map(([x, y, rx, ry, a]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" opacity="${a}" transform="rotate(${n((rand() - 0.5) * 2.5)} ${x} ${y})"/>`).join('');

  // The sun's path on the water: thin bright strokes, wider and further apart nearer the viewer.
  const glitter = ['', '', ''];
  for (let i = 0; i < 300; i++) {
    const t = Math.pow(rand(), 1.7);
    const y = WATER + 2 + t * 306;
    const spread = 8 + t * 120;
    const x = SUN[0] + (rand() + rand() - 1) * spread;
    const w = 4 + t * 22 * (0.4 + rand());
    glitter[Math.min(2, Math.floor(rand() * 3 + t))] += `M${n(x - w / 2)} ${n(y)}h${n(w)}v${n(0.8 + t * 1.8)}h${n(-w)}Z`;
  }

  const defs = linear('sky', [[0, '#17244b'], [0.2, '#2d3d70'], [0.4, '#5a588a'], [0.58, '#a06d8b'], [0.72, '#d98e7c'], [0.85, '#f3b87b'], [0.95, '#fbd898'], [1, '#fde6b2']], 0, 0, 0, WATER)
    + radial('glow', [[0, '#fff6d8'], [0.04, '#ffe2a6', 0.85], [0.16, '#ffc283', 0.45], [0.42, '#f49c82', 0.15], [1, '#e08482', 0]], SUN[0], SUN[1], 640, 0.7)
    + radial('disc', [[0, '#fffdf2'], [0.5, '#fff6d6'], [1, '#ffe7a8', 0]], SUN[0], SUN[1], 44)
    + linear('streak', [[0, '#4f4878'], [0.5, '#9a6d8c'], [1, '#f0a184']], 0, 130, 0, 430)
    + linear('far', [[0, '#b38aa0'], [1, '#a0839f']], 0, 460, 0, WATER)
    + linear('peaks', [[0, '#4b406c'], [0.55, '#3a3359'], [1, '#2e2a4b']], 0, 200, 0, WATER)
    + radial('backlight', [[0, '#ffc99c', 0.55], [0.35, '#f2a48e', 0.18], [1, '#e0948e', 0]], SUN[0], SUN[1], 430, 0.8)
    + linear('mist', [[0, '#c99aa5', 0], [0.6, '#d6a3a3', 0.28], [1, '#f2c1a0', 0.6]], 0, 400, 0, WATER)
    + linear('foot', [[0, '#2c2747'], [1, '#3a3150']], 0, 400, 0, WATER)
    + linear('tint', [[0, '#2a2448', 0.05], [0.3, '#1b183c', 0.35], [1, '#0d0c24', 0.72]], 0, WATER, 0, H)
    + radial('path', [[0, '#ffd69c', 0.55], [0.5, '#f8b585', 0.2], [1, '#f0a080', 0]], SUN[0], WATER + 40, 220, 1.8)
    + linear('haze', [[0, '#ffd8b8', 0], [0.55, '#ffd8b8', 0.22], [1, '#ffd8b8', 0]], 0, WATER - 22, 0, WATER + 14)
    + radial('vignette', [[0, '#000', 0], [0.7, '#000', 0], [1, '#000', 0.28]], 600, 450, 760, 0.8)
    + blur('far-soft', 1.4) + blur('wisp', 12, 2.5) + blur('rim', 1.6) + blur('gleam', 1, 0.5) + blur('mist-soft', 5)
    + ripple('ripple', 4, 20, 2.2) + mottle('rock', 5, '0.007 0.02', 0.24, 0.06)
    + `<clipPath id="water"><rect x="0" y="${WATER}" width="${W}" height="${H - WATER}"/></clipPath>`
    + `<clipPath id="peaks-clip"><path d="${below(poly(peaks), peaks, WATER + 2)}"/></clipPath>`
    + '<g id="land">'
    + `<rect width="${W}" height="${WATER + 2}" fill="url(#sky)"/>`
    + `<rect width="${W}" height="${WATER + 2}" fill="url(#glow)"/>`
    + `<g fill="url(#streak)" filter="url(#wisp)">${clouds}</g>`
    + `<circle cx="${SUN[0]}" cy="${SUN[1]}" r="44" fill="url(#disc)"/>`
    + `<circle cx="${SUN[0]}" cy="${SUN[1]}" r="21" fill="#fff9e8"/>`
    + `<path d="${below(poly(far), far, WATER + 2)}" fill="url(#far)" filter="url(#far-soft)"/>`
    + `<path d="${below(poly(peaks), peaks, WATER + 2)}" fill="url(#peaks)" filter="url(#rock)"/>`
    + `<rect width="${W}" height="${WATER}" fill="url(#backlight)" clip-path="url(#peaks-clip)"/>`
    + `<rect y="380" width="${W}" height="${WATER - 378}" fill="url(#mist)" clip-path="url(#peaks-clip)"/>`
    + `<path d="${poly(peaks)}" fill="none" stroke="#f6b08a" stroke-width="2.2" opacity="0.32" filter="url(#rim)"/>`
    + `<path d="${below(poly(footLeft), footLeft, WATER + 2)}" fill="url(#foot)"/>`
    + `<path d="${below(poly(footRight), footRight, WATER + 2)}" fill="url(#foot)"/>`
    + `<path d="${below(smooth(shoreLeft), shoreLeft, WATER + 2)}" fill="#1a172d"/>`
    + `<path d="${below(smooth(shoreRight), shoreRight, WATER + 2)}" fill="#1a172d"/>`
    + `<path d="${trees}" fill="#16132a"/>`
    + '</g>';

  const body = '<use xlink:href="#land"/>'
    + `<g clip-path="url(#water)"><use xlink:href="#land" transform="translate(0 ${2 * WATER}) scale(1 -1)" filter="url(#ripple)"/></g>`
    + `<rect y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#tint)"/>`
    + `<rect y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#path)"/>`
    + `<g filter="url(#gleam)"><path d="${glitter[0]}" fill="#fff4d6" opacity="0.9"/><path d="${glitter[1]}" fill="#ffdca0" opacity="0.6"/><path d="${glitter[2]}" fill="#ffc08a" opacity="0.4"/></g>`
    + `<rect y="${WATER - 22}" width="${W}" height="36" fill="url(#haze)" filter="url(#mist-soft)"/>`
    + `<rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
  return svg(defs, body);
}

/* ------------------------------------------------------------------ a beach with a palm */

/** A coconut palm from `base` to `crown`: a ringed trunk and drooping, feathered fronds. */
function palm(rand: () => number, base: Pt, crown: Pt): string {
  const ctrl: Pt[] = [base, [base[0] - 16, base[1] - 230], [crown[0] - 120, crown[1] + 160], crown];
  const at = (t: number): Pt => {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [k.reduce((s, c, i) => s + c * ctrl[i]![0], 0), k.reduce((s, c, i) => s + c * ctrl[i]![1], 0)];
  };
  /** The trunk's half-width at `t`, flaring at the foot. */
  const half = (t: number) => 12 + 10 * (1 - t) + 9 * Math.max(0, 1 - t * 9);
  /** The line `s` of the half-width across from the trunk's middle: -1 is its left edge, 1 its right. */
  const across = (s: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const [x, y] = at(t);
      const [x1, y1] = at(Math.max(t - 0.005, 0));
      const [x2, y2] = at(Math.min(t + 0.005, 1));
      const l = Math.hypot(x2 - x1, y2 - y1) || 1;
      pts.push([x - ((y2 - y1) / l) * half(t) * s, y + ((x2 - x1) / l) * half(t) * s]);
    }
    return pts;
  };
  const band = (a: number, b: number) => `${poly([...across(a), ...across(b).reverse()])}Z`;
  let rings = '';
  for (let i = 1; i < 46; i++) {
    const t = i / 46 + (rand() - 0.5) * 0.006;
    const [x, y] = at(t);
    const [x2, y2] = at(t + 0.005);
    const l = Math.hypot(x2 - x, y2 - y) || 1;
    const w = half(t);
    const nx = -(y2 - y) / l;
    const ny = (x2 - x) / l;
    rings += `M${n(x - nx * w)} ${n(y - ny * w)}Q${n(x + ((x2 - x) / l) * 6)} ${n(y + ((y2 - y) / l) * 6)} ${n(x + nx * w)} ${n(y + ny * w)}`;
  }
  const trunk = `<path d="${band(-1, 1)}" fill="#7a5d3e"/>`
    + `<path d="${band(0.15, 0.9)}" fill="#a88760" opacity="0.75"/>`
    + `<path d="${band(-1, -0.45)}" fill="#4d3926" opacity="0.65"/>`
    + `<path d="${rings}" fill="none" stroke="#3e2d1e" stroke-width="1.6" opacity="0.32"/>`;

  // Fronds: an arching stem with tapered leaflets hanging from both sides; the far ones darker,
  // the upper leaflets catching the light.
  const fronds: { angle: number; len: number; droop: number; light: string; dark: string; back: boolean }[] = [
    { angle: -158, len: 230, droop: 0.42, light: '#2f6533', dark: '#22502a', back: true },
    { angle: -122, len: 190, droop: 0.32, light: '#30683a', dark: '#23512c', back: true },
    { angle: -58, len: 200, droop: 0.34, light: '#336b37', dark: '#24532b', back: true },
    { angle: -22, len: 240, droop: 0.45, light: '#326a36', dark: '#23522a', back: true },
    { angle: -176, len: 280, droop: 0.72, light: '#4a8f45', dark: '#2f6a33', back: false },
    { angle: 4, len: 290, droop: 0.7, light: '#4d9347', dark: '#306c34', back: false },
    { angle: -140, len: 240, droop: 0.55, light: '#56a04e', dark: '#357439', back: false },
    { angle: -44, len: 250, droop: 0.55, light: '#58a250', dark: '#36763a', back: false },
    { angle: -96, len: 180, droop: 0.42, light: '#5fa955', dark: '#3a7c3d', back: false },
    { angle: -118, len: 200, droop: 0.5, light: '#5aa451', dark: '#37783b', back: false },
    { angle: -72, len: 205, droop: 0.5, light: '#5ba652', dark: '#38793b', back: false },
    { angle: 152, len: 220, droop: 1.05, light: '#468a42', dark: '#2c6531', back: false },
    { angle: 30, len: 230, droop: 1.0, light: '#488c43', dark: '#2d6632', back: false },
  ];
  const draw = (f: (typeof fronds)[number]) => {
    const a = (f.angle * Math.PI) / 180;
    const end: Pt = [crown[0] + Math.cos(a) * f.len, crown[1] + Math.sin(a) * f.len * 0.6 + f.len * f.droop];
    const mid: Pt = [crown[0] + Math.cos(a) * f.len * 0.6, crown[1] + Math.sin(a) * f.len * 0.6 - f.len * 0.16];
    const pt = (t: number): Pt => [
      (1 - t) * (1 - t) * crown[0] + 2 * (1 - t) * t * mid[0] + t * t * end[0],
      (1 - t) * (1 - t) * crown[1] + 2 * (1 - t) * t * mid[1] + t * t * end[1],
    ];
    const leaves = ['', ''];
    for (let i = 4; i <= 40; i++) {
      const t = (i + (rand() - 0.5) * 0.6) / 40;
      const [x, y] = pt(t);
      const [x2, y2] = pt(Math.min(t + 0.01, 1));
      const l = Math.hypot(x2 - x, y2 - y) || 1;
      const tx = (x2 - x) / l;
      const ty = (y2 - y) / l;
      for (const side of [-1, 1]) {
        const len = (12 + 56 * Math.sin(Math.PI * Math.min(1, 0.08 + t))) * (0.75 + rand() * 0.45);
        const turn = (rand() - 0.5) * 0.35;
        let dx = -ty * side * 0.62 + tx * 0.62;
        let dy = tx * side * 0.62 + ty * 0.62 + 0.9;
        const dl = Math.hypot(dx, dy);
        [dx, dy] = [(dx * Math.cos(turn) - dy * Math.sin(turn)) / dl, (dx * Math.sin(turn) + dy * Math.cos(turn)) / dl];
        // A leaflet: wide where it leaves the stem, arching, and coming to a point.
        const px = -dy * 2.5;
        const py = dx * 2.5;
        const cx = x + dx * len * 0.5;
        const cy = y + dy * len * 0.5 - len * 0.2;
        // The side whose normal points up is lit (0), the side underneath is in shade (1).
        leaves[tx * side < 0 ? 0 : 1] += `M${n(x + px)} ${n(y + py)}Q${n(cx + px * 0.6)} ${n(cy + py * 0.6)} ${n(x + dx * len)} ${n(y + dy * len)}Q${n(cx - px * 0.6)} ${n(cy - py * 0.6)} ${n(x - px)} ${n(y - py)}Z`;
      }
    }
    return `<path d="${leaves[1]}" fill="${f.dark}"/><path d="${leaves[0]}" fill="${f.light}"/>`
      + `<path d="M${n(crown[0])} ${n(crown[1])}Q${n(mid[0])} ${n(mid[1])} ${n(end[0])} ${n(end[1])}" fill="none" stroke="#5f7d3f" stroke-width="2.6" stroke-linecap="round"/>`;
  };
  const nuts = ([[-14, 16], [4, 20], [-4, 31], [15, 10], [-23, 6]] as Pt[]).map(([dx, dy]) => `<circle cx="${n(crown[0] + dx)}" cy="${n(crown[1] + dy)}" r="10.5" fill="url(#nut)"/>`).join('');
  const heart = `<ellipse cx="${n(crown[0])}" cy="${n(crown[1] + 2)}" rx="22" ry="12" fill="#3d5a2a"/>`;
  return fronds.filter((f) => f.back).map(draw).join('') + trunk + nuts + heart + fronds.filter((f) => !f.back).map(draw).join('');
}

function beach(): string {
  const rand = random(11);
  const HORIZON = 440;
  const shore: Pt[] = [[-20, 698], [280, 676], [600, 700], [900, 684], [1220, 668]];

  const clouds = [
    cloud(rand, 'c1', 200, 434, 300, 92, 2.2, 0.97), cloud(rand, 'c2', 560, 438, 150, 46, 1.8, 0.9),
    cloud(rand, 'c3', 1010, 430, 340, 112, 2.4, 0.97), cloud(rand, 'c4', 790, 236, 190, 54, 3, 0.55),
  ];
  const wisps = [[360, 122, 220, 7], [840, 168, 260, 8], [140, 210, 160, 5]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('');
  const island: Pt[] = [[70, HORIZON + 1], [150, 424], [230, 409], [300, 414], [390, HORIZON + 1]];

  // The sea's texture: long thin wave lines, closer together towards the horizon.
  let swellLight = '';
  let swellDark = '';
  for (let i = 0; i < 160; i++) {
    const t = Math.pow(rand(), 1.3);
    const y = HORIZON + 3 + t * 230;
    const x = rand() * W;
    const w = 20 + t * 220 * rand();
    const h = 0.8 + t * 1.6;
    if (rand() < 0.5) swellLight += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
    else swellDark += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  }
  // Two breaking waves, and the foam where the last one runs up the sand.
  const wave = (y: number, amp: number, phase: number): Pt[] => {
    const pts: Pt[] = [];
    for (let x = -20; x <= 1220; x += 40) pts.push([x, y + Math.sin(x / 110 + phase) * amp + (heightAt(shore, x) - 690) * 0.6]);
    return pts;
  };
  const crest1 = wave(628, 3, 1);
  const crest2 = wave(662, 4, 2.4);
  const foam = wave(686, 5, 0.6).map(([x, y]): Pt => [x, Math.min(y, heightAt(shore, x) - 2)]);
  let lace = '';
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = heightAt(shore, x) - 4 + rand() * 10;
    lace += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(8 + rand() * 26)}" ry="${n(1 + rand() * 2)}"/>`;
  }

  const defs = linear('sky', [[0, '#2b76bd'], [0.5, '#5fa6db'], [0.85, '#a6d4ed'], [1, '#d7eef5']], 0, 0, 0, HORIZON)
    + linear('sunside', [[0, '#fffbe8', 0], [1, '#fffbe8', 0.3]], 300, 0, W, 0)
    + linear('sea', [[0, '#195889'], [0.16, '#1e6b9d'], [0.45, '#2790b3'], [0.75, '#3db6c0'], [1, '#7ad4cc']], 0, HORIZON, 0, 690)
    + linear('sand', [[0, '#efd8ab'], [0.35, '#ebd09f'], [1, '#d8b47f']], 0, 660, 0, H)
    + linear('wet', [[0, '#bfa47a', 0.95], [0.5, '#c9ad83', 0.5], [1, '#d9bd8e', 0]], 0, 668, 0, 740)
    + linear('sheen', [[0, '#cfeef0', 0.45], [1, '#cfeef0', 0]], 0, 670, 0, 712)
    + `<radialGradient id="nut" cx="0.35" cy="0.3" r="0.8">${stops([[0, '#8a7536'], [0.7, '#5a4822'], [1, '#3f3218']])}</radialGradient>`
    + blur('far-soft', 1.5) + blur('wisp', 14, 3) + blur('line', 0.6) + blur('foam-soft', 1.6) + blur('lace-soft', 1.2)
    + mottle('grain', 3, '0.006 0.03', 0.12, 0.08)
    + clouds.map((c) => c.defs).join('');

  const body = `<rect width="${W}" height="${HORIZON + 1}" fill="url(#sky)"/>`
    + `<rect width="${W}" height="${HORIZON + 1}" fill="url(#sunside)"/>`
    + `<g fill="#ffffff" opacity="0.45" filter="url(#wisp)">${wisps}</g>`
    + clouds.map((c) => c.body).join('')
    + `<path d="${below(smooth(island), island, HORIZON + 2)}" fill="#729ca2" filter="url(#far-soft)"/>`
    + `<rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#sea)"/>`
    + `<g filter="url(#line)"><path d="${swellLight}" fill="#e8fbff" opacity="0.22"/><path d="${swellDark}" fill="#0c4370" opacity="0.18"/></g>`
    + `<path d="${smooth(crest1)}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.45" filter="url(#foam-soft)"/>`
    + `<path d="${smooth(crest2)}" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.6" filter="url(#foam-soft)"/>`
    + `<path d="${below(smooth(foam), foam)}" fill="#f4fbfb" opacity="0.85" filter="url(#foam-soft)"/>`
    + `<path d="${below(smooth(shore), shore)}" fill="url(#sand)" filter="url(#grain)"/>`
    + `<path d="${below(smooth(shore), shore)}" fill="url(#wet)"/>`
    + `<path d="${below(smooth(shore), shore)}" fill="url(#sheen)"/>`
    + `<g fill="#ffffff" opacity="0.7" filter="url(#lace-soft)">${lace}</g>`
    + palm(rand, [452, 915], [632, 236]);
  return svg(defs, body);
}

/* ------------------------------------------------------------------ green hills */

function hills(): string {
  const rand = random(23);
  const clouds = [
    cloud(rand, 'c1', 280, 300, 430, 172, 3.4, 0.97), cloud(rand, 'c2', 915, 246, 470, 190, 3.6, 0.97),
    cloud(rand, 'c3', 420, 394, 230, 62, 2.4, 0.9), cloud(rand, 'c4', 80, 458, 170, 40, 2, 0.85), cloud(rand, 'c5', 1122, 452, 190, 46, 2, 0.85),
  ];
  // From the far blue hills to the meadow at the viewer's feet.
  const l0 = ridge(rand, [[-20, 474], [240, 452], [520, 468], [800, 446], [1220, 462]], 0.12, 5);
  const l1: Pt[] = [[-20, 492], [200, 470], [420, 486], [650, 464], [900, 482], [1220, 466]];
  const l2: Pt[] = [[-20, 530], [240, 494], [520, 520], [760, 498], [1000, 516], [1220, 500]];
  const l3: Pt[] = [[-20, 614], [200, 574], [420, 562], [612, 534], [810, 558], [1010, 588], [1220, 570]];
  const l4: Pt[] = [[-20, 702], [300, 658], [640, 708], [1000, 732], [1220, 714]];
  const l5: Pt[] = [[-20, 832], [480, 800], [880, 840], [1220, 812]];
  const hill = (keys: Pt[]) => below(smooth(eased(keys)), eased(keys));
  /** A line `dy` below a hill's crest, from `x0` to `x1`: a hedge, the edge of a field. */
  const along = (keys: Pt[], dy: number, x0: number, x1: number): Pt[] =>
    eased(keys, 24).filter(([x]) => x >= x0 && x <= x1).map(([x, y]): Pt => [x, y + dy + Math.sin(x / 70) * 3]);

  // Fields of another green on the meadows, and hedges and copses between them.
  const field = (keys: Pt[], x0: number, x1: number, d0: number, d1: number) =>
    `${poly([...along(keys, d0, x0, x1), ...along(keys, d1, x0 - 40, x1 + 40).reverse()])}Z`;
  const farFields = `<path d="${field(l2, 650, 1010, 12, 50)}" fill="#cdd27a" opacity="0.34"/>`
    + `<path d="${field(l2, 110, 390, 14, 44)}" fill="#5b8c3c" opacity="0.3"/>`;
  const nearField = `<path d="${field(l3, 770, 1140, 24, 84)}" fill="#b0cc62" opacity="0.28"/>`;
  // Hedgerows: bushes and the odd tree in a row along the fields' edges, each lit from above.
  const bushes: Puff[] = [];
  for (const [keys, dy, x0, x1, size] of [[l2, 9, 60, 520, 1], [l2, 50, 660, 1160, 1], [l3, 24, -20, 430, 1.3], [l3, 88, 760, 1220, 1.5]] as const) {
    for (let x = x0; x < x1; x += (1.4 + rand() * 2.2) * size) {
      const tree = rand() < 0.08 ? 2.4 : 1;
      const r = (2 + rand() * 1.6) * size * tree;
      bushes.push([x, heightAt(keys, x) + dy + Math.sin(x / 70) * 3 - r * 0.6, r]);
    }
  }
  for (let i = 0; i < 14; i++) {
    const keys = rand() < 0.5 ? l2 : l3;
    const x = rand() * W;
    if (Math.abs(x - 612) < 140) continue;
    const r = 4 + rand() * 4;
    const y = heightAt(keys, x) + 14 + rand() * 40;
    for (let k = 0; k < 6; k++) bushes.push([x + (rand() - 0.5) * r * 2.4, y - rand() * r * 1.2, r * (0.5 + rand() * 0.5)]);
  }
  const hedges = lumpy('hedges', bushes, { lit: 'url(#bushLit)', shade: '#2b4f22', toLight: [-1, -1.4], soft: 0.5, rag: [5, 0.18] });

  // The lone tree on the crest of the middle hill, its shadow falling to the right.
  const tx = 612;
  const ty = heightAt(l3, tx) + 4;
  const crownPuffs: Puff[] = [];
  // Clumps of leaves about a few lobes, so the crown's outline is uneven.
  const lobes: Pt[] = [[0, 0], [-32, 8], [30, 6], [-14, -18], [16, -20], [-40, -6], [42, -4]];
  for (let i = 0; i < 160; i++) {
    const [lx, ly] = lobes[i % lobes.length]!;
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    crownPuffs.push([tx + lx + Math.cos(a) * d * 26, ty - 106 + ly + Math.sin(a) * d * 18, 4 + rand() * 5]);
  }
  const crown = lumpy('crown', crownPuffs, { lit: 'url(#leafLit)', shade: '#294a1f', toLight: [-2, -2.6], soft: 0.6, rag: [9, 0.1] });
  const tree = `<ellipse cx="${tx + 58}" cy="${n(ty + 3)}" rx="76" ry="9" fill="#2a4e1e" opacity="0.45" filter="url(#tree-shadow)"/>`
    + `<path d="M${tx - 6} ${n(ty)}C${tx - 4} ${n(ty - 30)} ${tx - 5} ${n(ty - 60)} ${tx - 3} ${n(ty - 86)}L${tx + 3} ${n(ty - 86)}C${tx + 4} ${n(ty - 60)} ${tx + 4} ${n(ty - 30)} ${tx + 7} ${n(ty)}Z" fill="#4a3826"/>`
    + `<path d="M${tx} ${n(ty - 62)}L${tx - 26} ${n(ty - 94)}M${tx + 1} ${n(ty - 70)}L${tx + 24} ${n(ty - 100)}" stroke="#4a3826" stroke-width="3" stroke-linecap="round"/>`
    + crown.body;

  const defs = linear('sky', [[0, '#3878c0'], [0.45, '#69a8dc'], [0.8, '#aed4ee'], [1, '#d6eaf3']], 0, 0, 0, 490)
    + radial('sunlight', [[0, '#fffbe6', 0.35], [1, '#fffbe6', 0]], 60, 30, 600)
    + linear('l0', [[0, '#a6bfcb'], [1, '#9fb9bf']], 0, 440, 0, 520)
    + linear('l1', [[0, '#94b7a0'], [1, '#86aa8e']], 0, 460, 0, 560)
    + linear('l2', [[0, '#8fbb72'], [1, '#76a25e']], 0, 490, 0, 640)
    + linear('l3', [[0, '#88bc56'], [0.5, '#70a746'], [1, '#5c923b']], 0, 530, 0, 740)
    + linear('l4', [[0, '#7ab846'], [1, '#4f8d2d']], 0, 656, 0, 840)
    + linear('l5', [[0, '#5fa236'], [1, '#376e21']], 0, 798, 0, H)
    + down('leafLit', [[0, '#7aae50'], [0.55, '#5a913b'], [1, '#41722d']])
    + down('bushLit', [[0, '#5c8f3c'], [1, '#3a6a2a']])
    + blur('far-soft', 1.6) + blur('near-soft', 0.9) + blur('tree-shadow', 6, 2) + blur('field-soft', 3)
    + mottle('meadow', 9, '0.004 0.018', 0.16, 0.1)
    + crown.defs + hedges.defs + clouds.map((c) => c.defs).join('');

  const body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
    + `<rect width="${W}" height="${H}" fill="url(#sunlight)"/>`
    + clouds.map((c) => c.body).join('')
    + `<path d="${below(poly(l0), l0)}" fill="url(#l0)" filter="url(#far-soft)"/>`
    + `<path d="${hill(l1)}" fill="url(#l1)" filter="url(#near-soft)"/>`
    + '<g filter="url(#meadow)">'
    + `<path d="${hill(l2)}" fill="url(#l2)"/>`
    + `<g filter="url(#field-soft)">${farFields}</g>`
    + `<path d="${hill(l3)}" fill="url(#l3)"/>`
    + `<g filter="url(#field-soft)">${nearField}</g>`
    + hedges.body
    + `<path d="${hill(l4)}" fill="url(#l4)"/>`
    + `<path d="${hill(l5)}" fill="url(#l5)"/>`
    + '</g>'
    + tree;
  return svg(defs, body);
}

/* ------------------------------------------------------------------ a city at dusk */

function city(): string {
  const rand = random(31);
  const WATER = 650;
  const MOON: Pt = [858, 138];

  let stars = '';
  for (let i = 0; i < 55; i++) stars += `<circle cx="${n(rand() * W)}" cy="${n(Math.pow(rand(), 1.5) * 280)}" r="${n(0.5 + rand() * 1)}" opacity="${n(0.25 + rand() * 0.55)}"/>`;

  /** A building: its left edge, width and roof; how its windows are laid (`kind`: a grid, office
   *  floors, glass); and how far down its top steps in (`step`, 0 for a flat top). */
  interface Block {
    x: number;
    w: number;
    top: number;
    kind: number;
    step: number;
  }
  const row = (low: number, high: number, minW: number, maxW: number): Block[] => {
    const list: Block[] = [];
    for (let x = -12; x < W + 10;) {
      const w = minW + rand() * (maxW - minW);
      list.push({ x, w, top: low - Math.pow(rand(), 1.3) * (low - high), kind: Math.floor(rand() * 3), step: rand() < 0.35 ? 18 + rand() * 30 : 0 });
      x += w - 3;
    }
    return list;
  };
  const far = row(574, 470, 28, 74);
  const near = row(572, 330, 46, 112).filter((b) => b.x + b.w < 540 || b.x > 668);
  // The landmark in the middle third: a slender tower on a wider base, stepping in at the top,
  // and a spire.
  near.push({ x: 548, w: 104, top: 412, kind: 0, step: 0 }, { x: 566, w: 68, top: 196, kind: 1, step: 26 });
  near.sort((a, b) => a.x - b.x);
  const outline = (b: Block) => {
    const s = b.step ? Math.min(b.w * 0.2, 14) : 0;
    return `M${n(b.x)} ${WATER + 2}V${n(b.top + b.step)}H${n(b.x + s)}V${n(b.top)}H${n(b.x + b.w - s)}V${n(b.top + b.step)}H${n(b.x + b.w)}V${WATER + 2}Z`;
  };

  const lit = ['', '', '', ''];
  for (const b of near) {
    const glass = b.kind === 2 && b.w > 70;
    const cols = Math.max(2, Math.floor((b.w - 10) / (b.kind === 1 ? 9 : 12)));
    const pitch = (b.w - 10) / cols;
    for (let y = b.top + b.step + 10; y < WATER - 12; y += b.kind === 1 ? 11 : 15) {
      if (b.kind === 1 && rand() < 0.5) {
        // An office floor: lit right across, or not at all.
        const on = rand();
        lit[on < 0.35 ? 1 : on < 0.5 ? 2 : 3] += `M${n(b.x + 5)} ${n(y)}h${n(b.w - 10)}v4h${n(-(b.w - 10))}Z`;
        continue;
      }
      for (let c = 0; c < cols; c++) {
        const on = rand();
        const kind = glass ? (on < 0.12 ? 2 : 3) : on < 0.24 ? 0 : on < 0.34 ? 1 : on < 0.4 ? 2 : 3;
        lit[kind] += `M${n(b.x + 5 + c * pitch)} ${n(y)}h${n(pitch * 0.56)}v${b.kind === 1 ? 4 : 7}h${n(-pitch * 0.56)}Z`;
      }
    }
  }
  let farLit = '';
  for (const b of far) {
    for (let y = b.top + 8; y < WATER - 10; y += 12) {
      for (let x = b.x + 4; x < b.x + b.w - 6; x += 9) if (rand() < 0.16) farLit += `M${n(x)} ${n(y)}h4v5h-4Z`;
    }
  }
  const roofs = near.filter((b) => b.top < 400 && rand() < 0.6).map((b) => `M${n(b.x + b.w * 0.3)} ${n(b.top)}v${n(-10 - rand() * 18)}`).join('');
  let lamps = '';
  for (let x = 12; x < W; x += 30 + rand() * 12) lamps += `<circle cx="${n(x)}" cy="${WATER - 7}" r="1.7"/>`;

  // Light on the water under the windows: broken vertical streaks.
  let streaks = '';
  for (let i = 0; i < 150; i++) {
    const b = near[Math.floor(rand() * near.length)]!;
    const x = b.x + 4 + rand() * (b.w - 8);
    const y = WATER + 3 + Math.pow(rand(), 1.3) * 210;
    streaks += `M${n(x)} ${n(y)}h${n(1.4 + rand() * 2.6)}v${n(5 + rand() * 22)}h${n(-2)}Z`;
  }

  const defs = linear('sky', [[0, '#0f1736'], [0.28, '#232c64'], [0.5, '#4c3a78'], [0.68, '#98507f'], [0.82, '#dc7a6e'], [0.94, '#f3a876'], [1, '#f7c48c']], 0, 0, 0, WATER)
    + radial('horizon', [[0, '#ffb27c', 0.6], [0.45, '#ff9c7c', 0.2], [1, '#ff8a7a', 0]], 600, WATER, 660, 0.45)
    + radial('moonGlow', [[0, '#fff2d6', 0.22], [1, '#fff2d6', 0]], MOON[0], MOON[1], 70)
    + linear('far', [[0, '#7d5c8e'], [1, '#634b7c']], 0, 470, 0, WATER)
    + linear('near', [[0, '#2c2853'], [0.6, '#1d1b3a'], [1, '#141329']], 0, 196, 0, WATER)
    + linear('edge', [[0, '#e88a76', 0.5], [1, '#e88a76', 0]], 0, 196, 0, 460)
    + linear('tint', [[0, '#1a153a', 0.25], [0.4, '#110e2c', 0.55], [1, '#08071a', 0.8]], 0, WATER, 0, H)
    + `<mask id="crescent"><rect width="${W}" height="${H}" fill="#000"/><circle cx="${MOON[0]}" cy="${MOON[1]}" r="17" fill="#fff"/><circle cx="${MOON[0] + 8}" cy="${MOON[1] - 5}" r="15.5" fill="#000"/></mask>`
    + `<clipPath id="water"><rect x="0" y="${WATER}" width="${W}" height="${H - WATER}"/></clipPath>`
    + blur('haze', 1.3) + blur('streak', 1.4, 3.5) + blur('glint', 0.4) + ripple('ripple', 9, 16, 4)
    + '<g id="skyline">'
    + `<rect width="${W}" height="${WATER + 2}" fill="url(#sky)"/>`
    + `<rect width="${W}" height="${WATER + 2}" fill="url(#horizon)"/>`
    + `<g filter="url(#haze)"><path d="${far.map(outline).join('')}" fill="url(#far)"/><path d="${farLit}" fill="#f6c98a" opacity="0.35"/></g>`
    + `<path d="${roofs}" stroke="#1d1b3a" stroke-width="2.2"/>`
    + `<path d="${near.map(outline).join('')}M597 196L600 112L603 196Z" fill="url(#near)"/>`
    + `<path d="M566 330V222H579.6V196H620.4" fill="none" stroke="url(#edge)" stroke-width="1.6"/>`
    + `<g filter="url(#glint)"><path d="${lit[0]}" fill="#ffd27c" opacity="0.92"/><path d="${lit[1]}" fill="#ffe9b8" opacity="0.7"/><path d="${lit[2]}" fill="#bcd6ff" opacity="0.6"/><path d="${lit[3]}" fill="#3b3662" opacity="0.55"/></g>`
    + '<circle cx="600" cy="114" r="2.6" fill="#ff5a4a"/>'
    + '</g>';

  const body = '<use xlink:href="#skyline"/>'
    + `<g fill="#ffffff">${stars}</g>`
    + `<circle cx="${MOON[0]}" cy="${MOON[1]}" r="70" fill="url(#moonGlow)"/>`
    + `<rect width="${W}" height="${H}" fill="#fff4dc" mask="url(#crescent)"/>`
    + `<g clip-path="url(#water)"><use xlink:href="#skyline" transform="translate(0 ${2 * WATER}) scale(1 -1)" filter="url(#ripple)"/></g>`
    + `<rect y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#tint)"/>`
    + `<path d="${streaks}" fill="#ffcf86" opacity="0.38" filter="url(#streak)"/>`
    + `<rect y="${WATER - 7}" width="${W}" height="9" fill="#13122a"/>`
    + `<g fill="#ffd89a">${lamps}</g>`;
  return svg(defs, body);
}

/** A picture drawn the first time it is asked for, not when the app loads: up to 15 ms each. */
function photo(id: string, name: string, draw: () => string): SamplePhoto {
  let svg: string | undefined;
  return {
    id,
    name,
    get svg() {
      return (svg ??= draw());
    },
  };
}

export const SAMPLE_PHOTOS: readonly SamplePhoto[] = [
  photo('lake', 'Lake at sunset', lake),
  photo('beach', 'Beach', beach),
  photo('hills', 'Green hills', hills),
  photo('city', 'City at dusk', city),
];

const images = new Map<string, Promise<HTMLImageElement>>();

/** The picture as an image element, decoded and ready (browser only). Cached per id. */
export function samplePhotoImage(id: string): Promise<HTMLImageElement> {
  let image = images.get(id);
  if (!image) {
    const photo = SAMPLE_PHOTOS.find((p) => p.id === id);
    if (!photo) return Promise.reject(new Error(`No sample photo "${id}"`));
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(photo.svg)}`;
    // A picture that failed to decode is not kept, so asking again tries again.
    image = img.decode().then(() => img, (err: unknown) => {
      images.delete(id);
      throw err;
    });
    images.set(id, image);
  }
  return image;
}
