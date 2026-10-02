// QR codes as laser geometry: what the code says → merged module outlines in millimetres.
//
// `qrContent` and `buildQr`: the payload formats spelled out and the module grid grouped into
// real islands. The encoder is
// qrcode-generator (MIT), bundled — nothing in here touches the network.
//
// The caller owns the quiet zone: a scannable code needs 4 clear modules on every side, and
// only the template knows whether that is a margin inside a blank or empty sheet.
//
// 2026-09-21: four module styles and an optional cleared centre for a symbol. Both
// are decided HERE rather than in a template, because both are scanning questions — what a style
// may do to a finder pattern, and how much of the code a symbol may cost — and there are four QR
// templates that would otherwise each answer them their own way.
import qrcode from 'qrcode-generator';
import { mapShapes, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';

// Byte mode as UTF-8. The encoder's default keeps only the low 8 bits of each UTF-16 unit, so a
// network called "Café-Гость" went into the code as Latin-1 and garbage while the card lettered
// it correctly (QR card review, 2026-09-27). Phone readers detect a byte segment that is valid
// UTF-8 and read it as such, and ASCII is the same bytes either way, so no ASCII code changes.
// Set once, here: this is the app's only encoder.
const UTF8 = new TextEncoder();
qrcode.stringToBytes = (s: string) => Array.from(UTF8.encode(s));

export type QrLevel = 'L' | 'M' | 'Q' | 'H';
export type QrKind = 'link' | 'text' | 'wifi' | 'contact';

/**
 * How the modules are drawn. The grid never changes — every style encodes the same code and
 * reads back the same modules (`qr.test.mjs` asserts it) — only the ink's shape does.
 *
 *   square  the merged rectilinear blobs, exact and cheapest to burn.
 *   rounded the same blobs with every corner filleted, inside and out.
 *   dots    each data module its own disc; the three finder patterns stay SOLID, because a
 *           finder broken into discs is the one part of a code a scanner cannot recover.
 *   finder  square data, round finder patterns — the accent on the corners.
 */
export type QrStyle = 'square' | 'rounded' | 'dots' | 'finder';

/**
 * The smallest module each style survives at, in millimetres on wood.
 *
 * `square` is the burn floor: under 0.6 mm the light squares between modules close up. Rounding
 * spends 0.3 of a module on each corner, so the light channel between two diagonal modules is
 * narrower than the module — 0.7 mm keeps that channel at the burn floor. A dot is an ISLAND:
 * it has no neighbour to hold it, and under a 1.0 mm module the 0.92 mm disc is inside the char
 * width of a diode laser. Round finders carry a one-module wall in the annulus, so they take
 * `rounded`'s floor.
 */
export const QR_MIN_CELL: Record<QrStyle, number> = { square: 0.6, rounded: 0.7, dots: 1.0, finder: 0.7 };

/** Diameter of a `dots` disc, in modules. Below 1 the discs never touch, so they never weld
 *  shut; at 0.92 the code still reads as a solid mass at arm's length. */
const DOT = 0.92;
/** Corner fillet of the `rounded` style, in modules. */
const FILLET = 0.3;

export interface QrOptions {
  style?: QrStyle;
  /** A symbol in the middle: its side as a fraction of the code's own side, 0 = none. Clamped
   *  to `MAX_LOGO`; the cleared square adds a one-module quiet ring around it. */
  logo?: number;
}

/**
 * The biggest symbol allowed, as a fraction of the code's side.
 *
 * With its quiet ring the cleared square reaches 0.30 of the side, so at most 9 % of the
 * modules are gone (0.30² = 0.09). Error correction H recovers 30 % of the codewords, which
 * leaves the whole rest of that budget for dirt, burn variance and a bad angle — which is why
 * the template forces H whenever a symbol is set rather than trusting the Toughness slider.
 */
export const MAX_LOGO = 0.2;
/** The cleared square, including its quiet ring, never exceeds this fraction of the side. */
const MAX_CLEAR = 0.3;

export interface QrGeometry {
  shapes: Shapes;
  modules: number;
  cell: number;
  /** The cleared centre square: modules on a side, and what that is in mm. 0 when no symbol. */
  clearModules: number;
  clearMm: number;
  /** The symbol's own side, mm — the cleared square less its one-module quiet ring. */
  logoMm: number;
  /** Cleared cells ÷ all cells. The number the "does it still scan" budget is spent from. */
  lost: number;
}

export interface QrFields {
  text?: string;
  ssid?: string;
  password?: string;
  security?: 'WPA' | 'WEP' | 'nopass';
  name?: string;
  phone?: string;
  email?: string;
}

// ------------------------------------------------------------------ payloads --

/** Inside a `WIFI:` payload these five characters are structure, so a network called
 *  "Bob's Cafe; Bar" only survives backslash-escaped. (The de-facto ZXing format.) */
const escapeWifi = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1');

/** vCard 3.0 text escaping: backslash, semicolon, comma, newline. */
const escapeVcard = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * The string a phone will read. Empty fields are left out rather than encoded blank — a
 * `TEL:` with nothing after it makes some scanners offer to dial an empty number.
 */
export function qrPayload(kind: QrKind, f: QrFields): string {
  switch (kind) {
    case 'wifi': {
      const security = f.security ?? 'WPA';
      const ssid = escapeWifi((f.ssid ?? '').trim());
      const pass = escapeWifi(f.password ?? '');
      // `T:` then `S:` then `P:`, each terminated, then the payload's own closing `;`.
      const p = security === 'nopass' ? '' : `P:${pass};`;
      return `WIFI:T:${security};S:${ssid};${p};`;
    }
    case 'contact': {
      const name = (f.name ?? '').trim();
      const phone = (f.phone ?? '').trim();
      const email = (f.email ?? '').trim();
      const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      if (name) {
        // N is structured (family;given;…). Everything before the last word is the given name,
        // which is wrong for some cultures but right for the "Ada Lovelace" a user types; FN
        // carries the name exactly as typed and is what a phone actually shows.
        const parts = name.split(/\s+/);
        const family = parts.length > 1 ? parts[parts.length - 1]! : '';
        const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
        lines.push(`N:${escapeVcard(family)};${escapeVcard(given)};;;`);
        lines.push(`FN:${escapeVcard(name)}`);
      }
      if (phone) lines.push(`TEL:${escapeVcard(phone)}`);
      if (email) lines.push(`EMAIL:${escapeVcard(email)}`);
      lines.push('END:VCARD');
      // The spec wants CRLF; every phone scanner takes LF, and LF is two bytes per line cheaper
      // — which on a vCard is a whole QR version.
      return lines.join('\n');
    }
    default:
      return (f.text ?? '').trim();
  }
}

// ------------------------------------------------------------------ encoding --

function encode(content: string, level: QrLevel) {
  if (!content) throw new Error('Nothing to encode');
  const qr = qrcode(0, level);
  try {
    qr.addData(content);
    qr.make();
  } catch {
    // qrcode-generator throws a bare string once the data will not fit version 40. A template
    // catches this and puts it on the status line.
    throw new Error('Too much text for one QR code');
  }
  return qr;
}

/**
 * The code as outlines, `sizeMm` square and centred on the origin, Y up.
 *
 * Centred on the MODULE SQUARE, not on the ink's bounding box — the two agree for every real
 * QR (the finder patterns touch three of the four edges) but the square is the frame the
 * caller's quiet zone is measured from, so it has to be exact.
 */
export function qrShapes(content: string, sizeMm: number, level: QrLevel, opts: QrOptions = {}): QrGeometry {
  const qr = encode(content, level);
  const modules = qr.getModuleCount();
  const cell = sizeMm / modules;
  const style = opts.style ?? 'square';

  // ------------------------------------------------------------- the cleared centre --
  // The symbol's side, plus one module of quiet ring on each side, rounded UP to whole modules
  // and then to the same parity as the grid — every QR has an odd module count, so an odd
  // cleared square is exactly centred and the symbol never sits half a module off.
  const want = Math.min(Math.max(opts.logo ?? 0, 0), MAX_LOGO);
  let clearModules = 0;
  if (want > 0) {
    clearModules = Math.ceil(want * modules) + 2;
    if ((clearModules - modules) % 2 !== 0) clearModules += 1;
    const cap = Math.floor(MAX_CLEAR * modules);
    while (clearModules > cap) clearModules -= 2;
    if (clearModules < 3) clearModules = 0;
  }
  const lo = (modules - clearModules) / 2;
  const hi = lo + clearModules;
  const isDark = clearModules === 0
    ? (r: number, c: number) => qr.isDark(r, c)
    : (r: number, c: number) => (r >= lo && r < hi && c >= lo && c < hi ? false : qr.isDark(r, c));

  // gridToRings puts the grid's top-left at the origin with Y up, so row 0 lands at the TOP and
  // the code reads the right way round rather than mirrored.
  const islands = styleIslands(isDark, modules, cell, style);
  return {
    shapes: mapShapes(islands, ([x, y]) => [x - sizeMm / 2, y + sizeMm / 2]),
    modules,
    cell,
    clearModules,
    clearMm: clearModules * cell,
    logoMm: clearModules > 0 ? (clearModules - 2) * cell : 0,
    lost: (clearModules * clearModules) / (modules * modules),
  };
}

// ------------------------------------------------------------------ the four styles --

/** The 7 × 7 corner blocks. A scanner finds the code by these three alone, so no style is ever
 *  allowed to break one into pieces. */
const isFinder = (r: number, c: number, n: number) =>
  (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

function styleIslands(isDark: (r: number, c: number) => boolean, n: number, cell: number, style: QrStyle): Shapes {
  if (style === 'square') return qrIslands(isDark, n, cell);
  if (style === 'rounded') return qrIslands(isDark, n, cell).map((isl) => isl.map((ring) => roundRing(ring, FILLET * cell)));

  // The data modules, with the three finder blocks held back for their own treatment.
  const data = (r: number, c: number) => !isFinder(r, c, n) && isDark(r, c);
  const body: Shapes = style === 'dots'
    ? dotCells(data, n, cell)
    : qrIslands(data, n, cell);
  // Round finders for `finder`; for `dots` the finders stay solid, merely filleted, so the
  // corners read as part of the same drawing without ever going to pieces.
  const corners: Shapes = [];
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    // A cleared centre never reaches a corner (the cap is 0.30 of the side), so a finder is
    // either wholly there or — impossibly — wholly gone; test one module and trust it.
    if (!isDark(r0 + 3, c0 + 3)) continue;
    const cx = (c0 + 3.5) * cell;
    const cy = -(r0 + 3.5) * cell;
    if (style === 'finder') {
      corners.push([circle(cx, cy, 3.5 * cell, 48), circle(cx, cy, 2.5 * cell, 40)]);
      corners.push([circle(cx, cy, 1.5 * cell, 32)]);
    } else {
      corners.push([roundRing(square(cx, cy, 3.5 * cell), FILLET * cell), roundRing(square(cx, cy, 2.5 * cell), FILLET * cell)]);
      corners.push([roundRing(square(cx, cy, 1.5 * cell), FILLET * cell)]);
    }
  }
  return [...body, ...corners];
}

/** One disc per dark cell, `DOT` modules across — never 1.0, so two neighbours touch at a point
 *  at most and no two outlines ever overlap (an overlap would cancel under the even-odd fill
 *  the preview and the export both use). */
function dotCells(isDark: (r: number, c: number) => boolean, n: number, cell: number): Shapes {
  const out: Shapes = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (isDark(r, c)) out.push([circle((c + 0.5) * cell, -(r + 0.5) * cell, (DOT * cell) / 2, 16)]);
    }
  }
  return out;
}

const circle = (cx: number, cy: number, r: number, seg: number): CutRing =>
  Array.from({ length: seg }, (_, i): [number, number] => {
    const t = (2 * Math.PI * i) / seg;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });

const square = (cx: number, cy: number, half: number): CutRing =>
  [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];

/**
 * Every corner of a rectilinear ring replaced by a fillet of radius `r` — convex corners and
 * concave ones alike, so a merged blob keeps its silhouette and only loses its hard edges.
 *
 * The fillet is a quadratic Bézier whose control point is the corner itself and whose legs are
 * equal, which for a right angle is within 0.6 % of a true arc — well inside the kerf. The
 * radius is capped at half the shorter leg, so two corners of a one-module run never eat each
 * other and the ring can never self-intersect.
 */
export function roundRing(ring: CutRing, r: number, seg = 4): CutRing {
  const n = ring.length;
  if (n < 3 || r <= 0) return ring;
  const out: CutRing = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n]!;
    const c = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const d1 = [c[0] - p[0], c[1] - p[1]];
    const d2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(d1[0]!, d1[1]!);
    const l2 = Math.hypot(d2[0]!, d2[1]!);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    // Collinear: nothing to round.
    if (Math.abs(d1[0]! * d2[1]! - d1[1]! * d2[0]!) < 1e-12) { out.push(c); continue; }
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a: [number, number] = [c[0] - (d1[0]! / l1) * rr, c[1] - (d1[1]! / l1) * rr];
    const b: [number, number] = [c[0] + (d2[0]! / l2) * rr, c[1] + (d2[1]! / l2) * rr];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return out;
}

/** The smallest overall size at which no module is finer than `cellMm` — what the material can hold. */
export function qrMinSize(content: string, level: QrLevel, cellMm: number): number {
  return encode(content, level).getModuleCount() * cellMm;
}

// ------------------------------------------------------------------ grid → islands --

/**
 * Connected blobs of dark modules → islands: each blob's outline first, then the pockets of
 * light modules it encloses, which is the `Shapes` contract the engine takes.
 *
 * Why not one ring per module: a finder pattern alone is 24 squares, a version-4 code a
 * thousand, and at laser scale every shared edge would be burnt twice. Welding them first
 * makes the finder ONE closed path with one hole.
 */
function qrIslands(isDark: (r: number, c: number) => boolean, n: number, cell: number): Shapes {
  // 4-connected labelling: blobs that meet only at a corner stay separate, which is also how
  // gridToRings chains its loops, so the two never disagree about what is one piece.
  const label = new Int32Array(n * n).fill(-1);
  const stack: number[] = [];
  let blobs = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (label[r * n + c] !== -1 || !isDark(r, c)) continue;
      const id = blobs++;
      label[r * n + c] = id;
      stack.push(r * n + c);
      while (stack.length) {
        const j = stack.pop()!;
        const jr = (j / n) | 0;
        const jc = j % n;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const rr = jr + dr;
          const cc = jc + dc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          if (label[rr * n + cc] !== -1 || !isDark(rr, cc)) continue;
          label[rr * n + cc] = id;
          stack.push(rr * n + cc);
        }
      }
    }
  }

  const out: Shapes = [];
  for (let id = 0; id < blobs; id++) {
    const mine = (r: number, c: number) => label[r * n + c] === id;
    const rings = gridToRings(mine, n, n, cell);
    // A loop's topmost-then-leftmost vertex is the top-left corner of the top-left cell of the
    // region it bounds. Dark cell → the blob's own outline; light cell → a hole in it.
    const outer: CutRing[] = [];
    const holes: CutRing[] = [];
    for (const ring of rings) {
      const [r, c] = topLeftCell(ring, cell);
      (r >= 0 && c >= 0 && r < n && c < n && mine(r, c) ? outer : holes).push(ring);
    }
    if (outer.length) out.push([...outer, ...holes]);
  }
  return out;
}

/** The grid cell tucked inside a rectilinear loop's topmost-then-leftmost corner. */
function topLeftCell(ring: CutRing, cell: number): [number, number] {
  let maxY = -Infinity;
  for (const [, y] of ring) if (y > maxY) maxY = y;
  let minX = Infinity;
  for (const [x, y] of ring) if (y === maxY && x < minX) minX = x;
  return [Math.round(-maxY / cell), Math.round(minX / cell)];
}

// ------------------------------------------------------------------ gridToRings --

// Ported from an internal tool. Its original note:
//
//   Marching squares would chamfer every corner, and a QR module is a square; emitting one path
//   per module is what the styled QR libraries do, and at laser scale that is thousands of
//   overlapping hairlines and a finder pattern that burns twice along every shared edge. So:
//   collect the boundary edges (a filled cell next to an empty one), chain them into loops.
//   Holes come out as their own loops.

type Pt = [number, number];

/**
 * @param filled  cell test, row-major, y down
 * @param rows    grid height in cells; `cols` its width
 * @param cell    cell size in mm
 * @returns rings in mm, Y UP, with the grid's top-left at the origin
 */
function gridToRings(filled: (row: number, col: number) => boolean, rows: number, cols: number, cell: number): CutRing[] {
  const is = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && filled(r, c);
  // Directed edges with the filled cell on the RIGHT when walking, keyed by start vertex.
  const out = new Map<string, Pt[]>();
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const add = (a: Pt, b: Pt) => {
    const k = key(a);
    const list = out.get(k);
    if (list) list.push(b);
    else out.set(k, [b]);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!filled(r, c)) continue;
      if (!is(r - 1, c)) add([c, r], [c + 1, r]); // top edge, walking right
      if (!is(r, c + 1)) add([c + 1, r], [c + 1, r + 1]); // right edge, walking down
      if (!is(r + 1, c)) add([c + 1, r + 1], [c, r + 1]); // bottom edge, walking left
      if (!is(r, c - 1)) add([c, r + 1], [c, r]); // left edge, walking up
    }
  }

  const rings: CutRing[] = [];
  const takeNext = (from: Pt, dir: Pt | null): Pt | null => {
    const list = out.get(key(from));
    if (!list || list.length === 0) return null;
    if (list.length === 1 || !dir) return list.pop()!;
    // Two ways out (cells touching at a corner): turn right, so the loops stay separate.
    let bestI = 0;
    let bestScore = -Infinity;
    list.forEach((to, i) => {
      const d: Pt = [to[0] - from[0], to[1] - from[1]];
      const cross = dir[0] * d[1] - dir[1] * d[0]; // >0 = right turn in y-down
      const dot = dir[0] * d[0] + dir[1] * d[1];
      const score = cross * 2 + dot;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    });
    return list.splice(bestI, 1)[0]!;
  };

  for (const [k, list] of out) {
    while (list.length > 0) {
      const start: Pt = k.split(',').map(Number) as Pt;
      const ring: Pt[] = [start];
      let cur = start;
      let dir: Pt | null = null;
      for (;;) {
        const next = takeNext(cur, dir);
        if (!next) break;
        dir = [next[0] - cur[0], next[1] - cur[1]];
        if (next[0] === start[0] && next[1] === start[1]) break;
        ring.push(next);
        cur = next;
      }
      if (ring.length >= 4) rings.push(collapse(ring).map(([x, y]): Pt => [x * cell, -y * cell]));
    }
  }
  return rings;
}

/** Drop the points along straight runs. */
function collapse(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % n]!;
    const straight = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) === 0;
    if (!straight) out.push(b);
  }
  return out;
}
