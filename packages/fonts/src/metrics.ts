// A face's proportions, measured from the face itself: cap height, x-height, ascender, descender,
// and the THINNEST stroke the letters are drawn with. All of them as a share of the em, so a
// caller multiplies by its letter size: `capMm / m.cap` is the size that gives capitals capMm
// tall, and `m.stroke * capMm` is how thin the thinnest stroke comes out at that cap height.
//
// The stroke is what a maker needs to know before it sets small text: a nozzle cannot lay a line
// narrower than itself, and most regular-weight faces draw strokes of a tenth of their cap height
// or less. It is measured, not read from the weight class, because weight classes lie (a "400"
// display face can be heavier than a "700" text face): scanlines across the stems of H and n, the
// sides and the top and bottom of o, and the bar of H, the thinnest run of ink any of them crosses.
//
// Registry-free: takes a parsed face (getFont / loadedFont), so a worker or a node test can use it.

/** A parsed opentype.js face; only what is read here. */
interface Face {
  unitsPerEm?: number;
  ascender?: number;
  descender?: number;
  tables?: { os2?: { sCapHeight?: number; sxHeight?: number } };
  charToGlyph(ch: string): { index: number; advanceWidth?: number; getPath(x: number, y: number, size: number): { commands: Command[] } };
}
type Command =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export interface FaceMetrics {
  /** Cap height ÷ em. */
  cap: number;
  /** x-height ÷ em. */
  xHeight: number;
  /** Ascender and descender ÷ em (the descender positive, below the baseline). */
  ascender: number;
  descender: number;
  /** The thinnest stroke ÷ CAP HEIGHT (not em): a stroke `stroke * capMm` wide at capitals capMm tall. */
  stroke: number;
}

const cache = new WeakMap<object, FaceMetrics>();

/** The face's proportions, measured once per face. */
export function faceMetrics(face: Face): FaceMetrics {
  const hit = cache.get(face);
  if (hit) return hit;
  const upm = face.unitsPerEm || 1000;
  const os2 = face.tables?.os2 ?? {};
  const H = glyphRings(face, 'H', upm);
  const x = glyphRings(face, 'x', upm);
  const capUnits = os2.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : H ? top(H) : upm * 0.7;
  const xUnits = os2.sxHeight && os2.sxHeight > 0 ? os2.sxHeight : x ? top(x) : capUnits * 0.5;
  const asc = face.ascender && face.ascender > 0 ? face.ascender : capUnits;
  const desc = face.descender ? Math.abs(face.descender) : upm * 0.2;

  // Rows across the stems, columns across the bars and bowls. A glyph the face does not have is
  // skipped; a face with none of them (a symbol font) reports a stroke of one cap: no claim.
  const runs: number[] = [];
  const across = (ch: string, at: number) => {
    const r = glyphRings(face, ch, upm);
    if (r) runs.push(...inkRuns(r, at, 'row'));
  };
  const down = (ch: string) => {
    const r = glyphRings(face, ch, upm);
    if (!r) return;
    const b = box(r);
    runs.push(...inkRuns(r, (b.minX + b.maxX) / 2, 'column'));
  };
  across('H', capUnits * 0.25);
  across('H', capUnits * 0.75);
  across('n', xUnits * 0.4);
  across('o', xUnits * 0.5);
  down('H');
  down('o');
  down('e');
  const thinnest = runs.filter((w) => w > upm * 0.002).reduce((a, b) => Math.min(a, b), Infinity);
  const m: FaceMetrics = {
    cap: capUnits / upm,
    xHeight: xUnits / upm,
    ascender: asc / upm,
    descender: desc / upm,
    stroke: Number.isFinite(thinnest) ? thinnest / capUnits : 1,
  };
  cache.set(face, m);
  return m;
}

type P = [number, number];

/** The glyph's outline as closed polylines in font units, Y up; null when the face lacks it. */
function glyphRings(face: Face, ch: string, upm: number): P[][] | null {
  const g = face.charToGlyph(ch);
  if (!g || g.index === 0) return null;
  const rings: P[][] = [];
  let cur: P[] | null = null;
  let px = 0;
  let py = 0;
  // opentype's path is y-down at this origin; flip to the font's y-up.
  for (const c of g.getPath(0, 0, upm).commands) {
    if (c.type === 'M') {
      if (cur && cur.length > 2) rings.push(cur);
      cur = [[c.x, -c.y]];
    } else if (c.type === 'L') {
      cur?.push([c.x, -c.y]);
    } else if (c.type === 'Q') {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur?.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, -(u * u * py + 2 * u * t * c.y1 + t * t * c.y)]);
      }
    } else if (c.type === 'C') {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur?.push([
          u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          -(u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y),
        ]);
      }
    } else if (c.type === 'Z') {
      if (cur && cur.length > 2) rings.push(cur);
      cur = null;
    }
    if (c.type !== 'Z') {
      px = c.x;
      py = c.y;
    }
  }
  if (cur && cur.length > 2) rings.push(cur);
  return rings.length ? rings : null;
}

const top = (rings: P[][]) => rings.reduce((m, r) => r.reduce((mm, p) => Math.max(mm, p[1]), m), -Infinity);

function box(rings: P[][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const r of rings) for (const [x] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  return { minX, maxX };
}

/**
 * The runs of ink a line crosses: a row at height `at`, or a column at `at`. Crossings are read
 * by the non-zero rule a font fills with, so an overlapping contour (a crossbar drawn over a stem)
 * does not split one run of ink into two.
 */
function inkRuns(rings: P[][], at: number, along: 'row' | 'column'): number[] {
  const hits: { t: number; dir: number }[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const [a0, a1, b0, b1] = along === 'row' ? [a[0], a[1], b[0], b[1]] : [a[1], a[0], b[1], b[0]];
      if (a1 > at !== b1 > at) hits.push({ t: a0 + ((at - a1) * (b0 - a0)) / (b1 - a1), dir: b1 > a1 ? 1 : -1 });
    }
  }
  hits.sort((p, q) => p.t - q.t);
  const runs: number[] = [];
  let wind = 0;
  let start = 0;
  for (const h of hits) {
    const was = wind;
    wind += h.dir;
    if (was === 0 && wind !== 0) start = h.t;
    else if (was !== 0 && wind === 0) runs.push(h.t - start);
  }
  return runs;
}
