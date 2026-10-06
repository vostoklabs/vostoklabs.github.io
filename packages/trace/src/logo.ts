import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { RegionSet, Ring, RGB } from './types';

// Default ink for paths whose color we can't resolve (e.g. Lucide icons use
// `stroke="currentColor"`, which isn't a real color). Dark so the design is
// visible as an inlay on the light cap — white-on-white made icons disappear.
const DEFAULT_INK: RGB = [22, 22, 22];

/**
 * An SVG colour string to the RGB bytes the file actually specified.
 *
 * `.r/.g/.b` is the obvious read and it is wrong. Since three r152 `ColorManagement` is on by
 * default, so `new THREE.Color('#c8102e')` stores the colour converted into the LINEAR working
 * space, and reading the components back gives (147, 1, 7) — a brand red arriving as a dark
 * maroon. Measured across the palette: #c8102e → #930107, #00ae42 → #006c0e, #0a5cd5 → #011baa.
 * Only pure black and pure white survive, which is why the sample SVG never showed it.
 *
 * Every SVG import has been doing this. The colours are what get matched to filaments, so an
 * imported logo came out in the wrong ones — a large part of what "SVG import doesn't work"
 * has meant on the listing.
 *
 * `getHex(SRGBColorSpace)` converts back, which is the documented way to ask "what did the
 * author write".
 */
function parseColor(colorStr: string): RGB {
  if (!colorStr || colorStr === 'currentColor' || colorStr === 'none') return DEFAULT_INK;
  try {
    const hex = new THREE.Color(colorStr).getHex(THREE.SRGBColorSpace);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  } catch {
    return DEFAULT_INK; // fallback
  }
}

/**
 * Does this path actually PAINT a fill / a stroke?
 *
 * Not just "is the property set". A laser cut file — the export from every box generator and
 * from LightBurn — draws each panel as a coloured stroke over
 * `fill: rgb(255,255,255); fill-opacity: 0`: a fill that is declared, is white, and is
 * completely invisible. Read as a real fill it was a white shape, so `isWhite` flagged every
 * path as a background, the import defaulted all of them to Off, and the file came back "No
 * drawable paths found in this SVG" — a cut file, rejected by a cut-file tool (Ian, 2026-09-23).
 *
 * `opacity` multiplies both, the way the spec says, so `opacity: 0` hides a path outright.
 */
const paints = (color: string | undefined, own: unknown, group: unknown): boolean => {
  if (!color || color === 'none') return false;
  const alpha = (own === undefined ? 1 : Number(own)) * (group === undefined ? 1 : Number(group));
  return !(Number.isFinite(alpha) && alpha <= 0);
};

const isWhite = (color: string | undefined): boolean => {
  if (!color) return false;
  const c = color.toLowerCase().replace(/\s/g, '');
  return c === '#ffffff' || c === '#fff' || c === 'white'
    || c.startsWith('rgb(255,255,255)') || c.startsWith('rgba(255,255,255,');
};

/** CSS absolute length units, in millimetres. `px` and a bare number are deliberately absent:
 *  they are screen units and say nothing about how big the thing really is. */
const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

function lengthMm(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const t = String(raw).trim().toLowerCase();
  for (const [unit, k] of Object.entries(UNIT_MM)) {
    if (!t.endsWith(unit)) continue;
    const n = Number(t.slice(0, -unit.length));
    return Number.isFinite(n) && n > 0 ? n * k : undefined;
  }
  return undefined;
}

/**
 * How big the traced artwork REALLY is, in millimetres — when the file says.
 *
 * A cut file has a true size, and scaling one is how a box stops fitting together: a box
 * generator's 142 mm sheet opened at a 60 mm default came out at 42 %, finger joints and all.
 * Clip art has no true size and gets `undefined`, so a design can keep its own default.
 */
function mmSpan(xml: any, viewW: number, viewH: number, maxSide: number): number | undefined {
  if (!xml || !(maxSide > 0)) return undefined;
  const w = lengthMm(xml.getAttribute('width'));
  const h = lengthMm(xml.getAttribute('height'));
  const perUnit = w && viewW > 0 ? w / viewW : h && viewH > 0 ? h / viewH : undefined;
  return perUnit ? maxSide * perUnit : undefined;
}

/** The artboard size, from the viewBox or the width/height attributes. */
function viewSize(xml: any): { viewW: number; viewH: number } {
  let viewW = 0, viewH = 0;
  if (xml) {
    const vb = xml.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      if (p.length === 4) { viewW = p[2]; viewH = p[3]; }
    } else {
      viewW = parseFloat(xml.getAttribute('width')) || 0;
      viewH = parseFloat(xml.getAttribute('height')) || 0;
    }
  }
  return { viewW, viewH };
}

/**
 * A rect that spans the whole artboard: the background icon sites paint behind their art.
 *
 * Judged on the rect as DRAWN, not on its width/height attributes. Reading the attributes
 * ignores every transform between the rect and the root, and wrapping the artboard in a
 * `<g transform="matrix(...)">` is what Figma and Illustrator do on the way out — so a
 * background rect in a perfectly ordinary export was not recognised, the import wizard offered
 * it as "Fill", and it was carved as a slab over the design.
 *
 * Still rect-only. Any full-bleed SHAPE covering the artboard would catch a solid square logo,
 * which is a design someone might actually want.
 */
function isArtboardRect(
  node: any,
  viewW: number,
  viewH: number,
  bounds: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  if (!node || node.nodeName !== 'rect') return false;
  const wStr = node.getAttribute('width');
  const hStr = node.getAttribute('height');
  if (wStr === '100%' && hStr === '100%') return true;
  if (!viewW || !viewH) return false;
  if (Number.isFinite(bounds.x0) && Number.isFinite(bounds.x1)) {
    // 98%: a background rect is often drawn a hair inside the artboard, or a hair outside it.
    if ((bounds.x1 - bounds.x0) >= viewW * 0.98 && (bounds.y1 - bounds.y0) >= viewH * 0.98) return true;
  }
  // The original attribute test, kept as the fallback for a path with no usable geometry.
  return Math.abs(parseFloat(wStr) - viewW) < 1 && Math.abs(parseFloat(hStr) - viewH) < 1;
}

/** A path's bounds as drawn, in the file's own user space: every transform on the element and
 *  its ancestors is already applied, because that is what SVGLoader hands back. */
function drawnBounds(path: any): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sub of path.subPaths) {
    for (const p of sub.getPoints(8)) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * The style three's `pointsToStroke` draws a path's line in, from the path's own style.
 *
 * `getStrokeStyle` takes the join before the cap, and they reach it the other way round, as they
 * always reached it in the clicker and the keycap: a file that sets the two to different values
 * gets its cap style on the joins and its join style on the ends (one that sets neither, or both
 * round, draws as it should). Kept, so the outlines both apps carve stay exactly what they were.
 */
function meshStrokeStyle(style: any) {
  return SVGLoader.getStrokeStyle(
    Number(style.strokeWidth) || 1,
    style.stroke || '#000',
    style.strokeLineCap || 'butt',
    style.strokeLineJoin || 'miter',
    style.strokeMiterLimit || 4
  );
}

/** A run of points the file drew as a line, and whether it comes back to where it started. */
interface Chain { pts: THREE.Vector2[]; closed: boolean }

/**
 * Open lines joined end to end into the loops they draw.
 *
 * A cut file does not have to draw a panel as one closed path, and the ones that don't are
 * common: MyLaserTools writes every edge of every panel as its own `<path>` — each finger, each
 * side of each slot, each arc — 784 of them for a six-panel box, only 4 closed. Filled one at a
 * time, each is closed by the straight line back to its own start, so an arc edge became a "D",
 * a finger became a speck, a rectangle drawn as two L-halves became two triangles, and the gap
 * in a C-ring was sealed. The panels themselves never existed (Ian, 2026-09-27). Joined first,
 * they are the six panels the file draws, and a line that is filled is filled as the loop it is
 * part of — which is what LightBurn's auto-join does with the same file.
 *
 * Greedy walk, endpoints matched within `eps` through a grid, so a file of thousands of
 * segments stays linear. A chain that never comes back to its start stays open; the caller
 * decides what that means.
 */
function joinOpenLines(lines: THREE.Vector2[][], eps: number): Chain[] {
  const cell = (v: number) => Math.round(v / eps);
  const grid = new Map<string, number[]>();
  lines.forEach((l, i) => {
    for (const [end, p] of [[0, l[0]], [1, l[l.length - 1]]] as const) {
      const k = `${cell(p.x)},${cell(p.y)}`;
      const list = grid.get(k);
      if (list) list.push(i * 2 + end); else grid.set(k, [i * 2 + end]);
    }
  });
  const used = new Uint8Array(lines.length);
  /** An unused line with an end at `p`, turned so that end comes first. */
  const next = (p: THREE.Vector2): THREE.Vector2[] | null => {
    const cx = cell(p.x), cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const i = id >> 1;
        if (used[i]) continue;
        const l = lines[i];
        const end = id & 1 ? l[l.length - 1] : l[0];
        if (end.distanceTo(p) > eps) continue;
        used[i] = 1;
        return id & 1 ? [...l].reverse() : l;
      }
    }
    return null;
  };
  const chains: Chain[] = [];
  lines.forEach((line, i) => {
    if (used[i]) return;
    used[i] = 1;
    let pts = [...line];
    const loops = () => pts.length > 2 && pts[pts.length - 1].distanceTo(pts[0]) <= eps;
    const grow = () => {
      for (let l; !loops() && (l = next(pts[pts.length - 1]));) pts.push(...l.slice(1));
    };
    grow();
    if (!loops()) { pts.reverse(); grow(); }
    const closed = loops();
    if (closed) pts = pts.slice(0, -1);
    chains.push({ pts, closed });
  });
  return chains;
}

/**
 * A pool of lines as the chains they draw: the closed ones as they are, the open ones joined.
 * The tolerance is a ten-thousandth of the drawing (0.05 mm on a 460 mm sheet) — MyLaserTools'
 * shared corners differ in the fifth decimal, and a real feature is far bigger than that.
 */
function chainsOf(lines: Chain[]): Chain[] {
  const b = new THREE.Box2();
  for (const l of lines) for (const p of l.pts) b.expandByPoint(p);
  const eps = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 1e-6) * 1e-4;
  const shut = (l: Chain) => l.closed || (l.pts.length > 2 && l.pts[0].distanceTo(l.pts[l.pts.length - 1]) <= eps);
  return [
    ...lines.filter(shut).map((l) => ({ pts: l.pts, closed: true })),
    ...joinOpenLines(lines.filter((l) => !shut(l)).map((l) => l.pts), eps),
  ];
}

/**
 * Three's stroke mesh as rings, one per triangle, each wound the way a filled shape is, so
 * under a non-zero fill they add up into the stroke. Slivers of no area are dropped.
 */
function strokeGeomToContours(geom: THREE.BufferGeometry): Ring[] {
  const pos = geom.getAttribute('position');
  if (!pos) return [];
  const idx = geom.getIndex();
  const contours: Ring[] = [];

  const getTri = idx
    ? (t: number) => [idx.array[t * 3], idx.array[t * 3 + 1], idx.array[t * 3 + 2]]
    : (t: number) => [t * 3, t * 3 + 1, t * 3 + 2];

  const nTris = (idx ? idx.array.length : pos.count) / 3;
  for (let t = 0; t < nTris; t++) {
    const [ia, ib, ic] = getTri(t);
    const ax = pos.getX(ia), ay = pos.getY(ia);
    const bx = pos.getX(ib), by = pos.getY(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic);

    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;

    if (area > 0) {
      contours.push([[ax, ay], [bx, by], [cx, cy]]);
    } else {
      contours.push([[ax, ay], [cx, cy], [bx, by]]);
    }
  }
  return contours;
}

/** Signed shoelace area: anticlockwise positive. */
const shoelace = (r: Ring): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};

/**
 * A line as the strip its stroke covers, as OUTLINES: one ring for an open line, an outer and an
 * inner ring for a closed one.
 *
 * Replaces three's `pointsToStroke` here, which answers with a triangle mesh — and every
 * triangle came back as its own shape. Ian's box read as lines was 7,698 shapes in the area
 * picker (2026-09-27). Miter joins up to the file's limit and bevels past it; butt, square or
 * round caps as the file asks. A stroke thicker than a curve is tight can fold on the inside of
 * the bend, which even-odd reads as a notch — a far smaller wrong than a mesh.
 */
function ribbonRings(line: THREE.Vector2[], closed: boolean, width: number, cap: string, miterLimit: number): Ring[] {
  const h = width / 2;
  const p = line.filter((q, i) => i === 0 || q.distanceTo(line[i - 1]) > 1e-9);
  if (closed && p.length > 1 && p[0].distanceTo(p[p.length - 1]) <= 1e-9) p.pop();
  const n = p.length;
  if (n < 2 || !(h > 0)) return [];
  const dir = (i: number) => p[(i + 1) % n].clone().sub(p[i]).normalize();
  const left = (d: THREE.Vector2) => new THREE.Vector2(-d.y, d.x);
  const at = (q: THREE.Vector2, v: THREE.Vector2, k: number): [number, number] => [q.x + v.x * k, q.y + v.y * k];
  /** One side of the strip, `s` = +1 left, −1 right. */
  const side = (s: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const before = closed || i > 0 ? left(dir((i - 1 + n) % n)) : null;
      const after = closed || i < n - 1 ? left(dir(i)) : null;
      if (!before || !after) { out.push(at(p[i], (before ?? after)!, h * s)); continue; }
      const m = before.clone().add(after);
      const cos = m.length() / 2; // of half the turn
      if (cos > 1e-6 && 1 / cos <= miterLimit) out.push(at(p[i], m.normalize(), (h / cos) * s));
      else out.push(at(p[i], before, h * s), at(p[i], after, h * s));
    }
    return out;
  };
  const l = side(1);
  const r = side(-1);
  if (closed) return [l, r];
  /** Half a turn round an end, from the left side's end to the right's (or back). */
  const capAt = (q: THREE.Vector2, d: THREE.Vector2): [number, number][] => {
    if (cap === 'round') {
      const a0 = Math.atan2(d.x, -d.y); // the angle of left(d)
      return Array.from({ length: 7 }, (_, k) => at(q, new THREE.Vector2(Math.cos(a0 - ((k + 1) * Math.PI) / 8), Math.sin(a0 - ((k + 1) * Math.PI) / 8)), h));
    }
    if (cap === 'square') return [at(q, left(d).add(d), h), at(q, d.clone().sub(left(d)), h)];
    return [];
  };
  const endDir = dir(n - 2);
  const startDir = dir(0).negate();
  return [[...l, ...capAt(p[n - 1], endDir), ...r.reverse(), ...capAt(p[0], startDir)]];
}

/** One drawable path in the file, as the import preview shows it. */
export interface SvgPart {
  /** Position in `data.paths` — the handle an override is keyed on. Stable for a given file. */
  index: number;
  /** How the file paints it. `none` is the one that surprises people: a path with neither a
   *  fill nor a stroke contributes nothing and the app used to say nothing about it. */
  kind: 'fill' | 'stroke' | 'none';
  /** Colour as authored, `#rrggbb`. */
  hex: string;
  /** Bounding-box area, for ordering the list biggest-first. */
  area: number;
  /** Stroke width in the file's own units, when `kind === 'stroke'`. */
  strokeWidth?: number;
  /**
   * Why this part would be dropped, or would print as something nobody asked for, if the
   * tracer were left to decide on its own — the invisible artboard rectangle icon sites wrap
   * their art in, or a white shape that is still a shape. Reported so the wizard can show it
   * as an "Off" the user can flip, rather than a model that came out wrong for no visible
   * reason.
   */
  why?: 'white' | 'artboard';
}

/** What the import preview decided for one path: how to draw it, and in what colour. */
export interface SvgPartChoice {
  /** `fill` closes the subpaths into solid shapes; `outline` traces the stroke as a ribbon
   *  (`strokeWidth` wide, or 1 unit if the file gave none), or follows it as a line under
   *  `outlinesAsLines`; `off` drops the path. */
  mode: 'fill' | 'outline' | 'off';
  /** `#rrggbb`. Defaults to the colour the file gave the path. */
  hex?: string;
}

export interface SvgOptions {
  removeBg?: boolean;
  /** Per-path choice, keyed on `SvgPart.index`. A path with no entry is drawn as the file
   *  painted it. This is what the import preview writes. */
  overrides?: Record<number, SvgPartChoice>;
  /** Treat stroke-only paths as filled outlines.
   *
   *  The single most useful switch in the preview. A stroke-only drawing — the common export
   *  from Illustrator and from most icon sites — currently comes through as ribbon geometry:
   *  each line becomes a long thin sliver a fraction of a millimetre wide, which at print scale
   *  is a hairline that either vanishes into the base colour or prints as fuzz. It looks like
   *  "SVG import is broken" and it is really "your SVG has no fills". Closing the subpaths and
   *  filling them turns the same file into solid shapes. */
  fillStrokes?: boolean;
  /** Read every path on its own, the way a browser paints it, for a caller that fills the rings
   *  non-zero and wants the drawing as it looks, like the clicker. A filled path is filled by
   *  itself: a line that does not close is closed by a straight edge, and shapes drawn by
   *  separate paths add up instead of cutting holes in each other, so a check mark drawn inside
   *  a filled circle leaves a solid disc. An outline is three's stroke mesh, one ring per
   *  triangle, which follows a line that crosses itself (an infinity sign) exactly.
   *
   *  Off, a stroke drawing is read as a cut file is: lines that meet end to end are joined
   *  across paths first, the loops they make are filled even-odd, so a slot drawn inside a
   *  panel is a hole in it, and each line drawn as an outline is one strip. A caller that
   *  re-nests the rings by containment wants that reading. */
  asPainted?: boolean;
  /** Read every outline as the line it follows, for a caller whose machine follows lines: a
   *  laser or a pen draws a 1 pt stroke as one pass along it, not round the edge of a strip a
   *  fraction of a millimetre wide. A path read as an outline (stroke-only, or `outline` in
   *  `overrides`) comes back on its colour's region as `lines`, one open polyline per subpath,
   *  as drawn: no width, nothing filled, nothing joined across paths. It wins over both readings
   *  of an outline above. Fills are read as they always are.
   *
   *  The lines share the rings' frame and count towards its size, so a drawing that is all lines
   *  still reads, and `aspect` and `mm` measure the lines too. A line has no width of its own, so
   *  for `aspect` each side is taken as at least the widest line's stroke, the width the line is
   *  drawn at: a lone straight line has the aspect the strip reading of the same file gives it,
   *  not 1. They are never part of `outline` or `coverage`, and `removeBg` never takes them away:
   *  a background is a filled shape. */
  outlinesAsLines?: boolean;
}

/**
 * What is in an SVG, before committing to a trace.
 *
 * The import preview needs to tell the user WHY a file will not come out as they expect, and
 * the honest answer is almost always in here: no fills, or a stroke width that is a hairline at
 * print scale, or forty separate colours. Reported rather than guessed at.
 */
export function describeSvg(svgText: string): { parts: SvgPart[]; issues: string[] } {
  let data;
  try {
    data = new SVGLoader().parse(svgText);
  } catch {
    return { parts: [], issues: ['This file could not be read as an SVG.'] };
  }
  const { viewW, viewH } = viewSize(data.xml);
  const parts: SvgPart[] = [];
  data.paths.forEach((path: any, index: number) => {
    const style = path.userData?.style || {};
    const hasFill = paints(style.fill, style.fillOpacity, style.opacity);
    const hasStroke = paints(style.stroke, style.strokeOpacity, style.opacity);
    const { x0, y0, x1, y1 } = drawnBounds(path);
    const area = isFinite(x0) ? Math.max(0, (x1 - x0) * (y1 - y0)) : 0;
    const rgb = parseColor(hasFill ? style.fill : hasStroke ? style.stroke : '');
    const why = isArtboardRect(path.userData?.node, viewW, viewH, { x0, y0, x1, y1 })
      ? 'artboard' as const
      : (hasFill && isWhite(style.fill)) || (!hasFill && hasStroke && isWhite(style.stroke))
        ? 'white' as const
        : undefined;
    parts.push({
      index,
      kind: hasFill ? 'fill' : hasStroke ? 'stroke' : 'none',
      hex: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      area,
      ...(hasStroke && !hasFill ? { strokeWidth: Number(style.strokeWidth) || 1 } : {}),
      ...(why ? { why } : {}),
    });
  });

  /* Only what the per-part list cannot say for itself. An outline or an unpainted path is
     reported by its own row (and the preview decides what to do with it), not repeated here. */
  const issues: string[] = [];
  if (!parts.length) issues.push('There are no drawable shapes in this file.');
  const colours = new Set(parts.filter((p) => p.kind !== 'none').map((p) => p.hex));
  if (colours.size > 8) {
    issues.push(`${colours.size} different colours. A printer holds 16 filaments; give some of these the same colour.`);
  }
  return { parts: parts.sort((a, b) => b.area - a.area), issues };
}

export function parseSvg(svgText: string, opts: SvgOptions = {}): RegionSet {
  const data = new SVGLoader().parse(svgText);
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  const groups = new Map<string, { rgb: RGB; rings: Ring[]; lines: Ring[] }>();

  /** The colour's entry, made the first time something is drawn in it. */
  function groupOf(rgb: RGB) {
    const hex = rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    let g = groups.get(hex);
    if (!g) {
      g = { rgb, rings: [], lines: [] };
      groups.set(hex, g);
    }
    return g;
  }

  function addRings(rgb: RGB, rings: Ring[]) {
    groupOf(rgb).rings.push(...rings);
  }

  /** Filled shapes as rings: outlines anticlockwise, holes clockwise. */
  function addShapes(rgb: RGB, shapes: THREE.Shape[]) {
    for (const shape of shapes) {
      const points = shape.getPoints(16);
      if (points.length >= 3) {
        if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
        const ring: Ring = [];
        for (const p of points) {
          box.expandByPoint(p);
          ring.push([p.x, p.y]);
        }
        addRings(rgb, [ring]);
      }
      for (const hole of shape.holes) {
        const hp = hole.getPoints(16);
        if (hp.length >= 3) {
          if (!THREE.ShapeUtils.isClockWise(hp)) hp.reverse();
          const ring: Ring = [];
          for (const p of hp) {
            box.expandByPoint(p);
            ring.push([p.x, p.y]);
          }
          addRings(rgb, [ring]);
        }
      }
    }
  }

  /** Lines the file drew as STROKES that are being filled, per colour, held back until every
   *  path is read — a panel's edges are spread across many paths (`joinOpenLines`). */
  const loose = new Map<string, { rgb: RGB; lines: Chain[] }>();
  /** Lines drawn as strips, per colour AND stroke — two widths are two different strips. */
  const ribbons = new Map<string, { rgb: RGB; width: number; cap: string; limit: number; lines: Chain[] }>();
  /** The widest stroke among the outlines read as lines: 0 when there are none. */
  let lineWidth = 0;

  data.paths.forEach((path: any, pathIndex: number) => {
    const style = path.userData?.style || {};
    const choice = opts.overrides?.[pathIndex];
    if (choice?.mode === 'off') return;

    const authoredFill = paints(style.fill, style.fillOpacity, style.opacity);
    const authoredStroke = paints(style.stroke, style.strokeOpacity, style.opacity);
    /* A choice from the preview wins over what the file said. Otherwise "fill the outlines"
       promotes every stroke-only path (never an unpainted one — that is usually the invisible
       artboard rectangle icon sites wrap their art in, and filling it is a solid square over
       everything). `createShapes` works from the subpaths and does not care how the file
       painted them, so a stroke or an unpainted path becomes a solid shape with no new
       geometry code. */
    const hasFill = choice ? choice.mode === 'fill' : authoredFill || (!!opts.fillStrokes && authoredStroke && !authoredFill);
    const hasStroke = choice ? choice.mode === 'outline' : authoredStroke && !hasFill;
    const authored = authoredFill ? style.fill : authoredStroke ? style.stroke : style.fill || style.stroke || '';
    const rgb = parseColor(choice?.hex ?? authored);

    // Filled paths. A FILL closes every subpath by itself, so an authored fill — or a stroke
    // drawing whose lines are all closed already — is taken as it stands. A stroke drawing
    // with open lines is pooled and joined first, because closing one of those on its own is
    // inventing an edge the file never drew; `asPainted` takes it as it stands too.
    if (hasFill) {
      const open = !authoredFill && path.subPaths.some((sub: any) => !sub.autoClose);
      if (!open || opts.asPainted) {
        addShapes(rgb, SVGLoader.createShapes(path));
      } else {
        const hex = rgb.map(v => v.toString(16).padStart(2, '0')).join('');
        let pool = loose.get(hex);
        if (!pool) loose.set(hex, (pool = { rgb, lines: [] }));
        for (const sub of path.subPaths) {
          const pts = sub.getPoints(16);
          if (pts.length >= 2) pool.lines.push({ pts, closed: !!sub.autoClose });
        }
      }
    }

    // Outlines as the lines they follow: each subpath once, as drawn, at the density a strip is
    // drawn at. Not joined across paths, so every line goes exactly where the file put it, and a
    // closed subpath ends where it began.
    if (hasStroke && !hasFill && opts.outlinesAsLines) {
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(32);
        if (pts.length < 2) continue;
        const line: Ring = [];
        for (const p of pts) {
          box.expandByPoint(p);
          line.push([p.x, p.y]);
        }
        groupOf(rgb).lines.push(line);
        lineWidth = Math.max(lineWidth, Number(style.strokeWidth) || 1);
      }
      return;
    }

    // Outlines, as painted: three's stroke mesh for each line, one ring per triangle, in the
    // style `meshStrokeStyle` reads off the path.
    if (hasStroke && !hasFill && opts.asPainted) {
      const strokeStyle = meshStrokeStyle(style);
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(32);
        if (pts.length < 2) continue;
        const geom = SVGLoader.pointsToStroke(pts, strokeStyle);
        if (!geom) continue;
        const pos = geom.getAttribute('position');
        if (!pos || pos.count === 0) continue;
        for (let i = 0; i < pos.count; i++) {
          box.expandByPoint(new THREE.Vector2(pos.getX(i), pos.getY(i)));
        }
        addRings(rgb, strokeGeomToContours(geom));
        geom.dispose();
      }
    }

    // Outlines: pooled by colour and stroke, joined, and drawn as strips once every path is read.
    // A round join is bevelled past a right angle rather than drawn round — close enough for a
    // strip that is cut, and one fewer shape to get wrong.
    if (hasStroke && !hasFill && !opts.asPainted) {
      const width = Number(style.strokeWidth) || 1;
      const cap = style.strokeLineCap || 'butt';
      const join = style.strokeLineJoin || 'miter';
      const limit = join === 'miter' || join === 'miter-clip' ? Number(style.strokeMiterLimit) || 4 : 1.5;
      const key = `${rgb.join(',')}|${width}|${cap}|${limit}`;
      let pool = ribbons.get(key);
      if (!pool) ribbons.set(key, (pool = { rgb, width, cap, limit, lines: [] }));
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(32);
        if (pts.length >= 2) pool.lines.push({ pts, closed: !!sub.autoClose });
      }
    }
  });

  // The pooled line drawings, joined into loops and filled even-odd: a slot drawn inside a
  // panel is a hole in it whichever way round the file happened to draw either. A line that
  // joins nothing is closed on itself as before, which is still right for an icon's
  // stroke-drawn mouth or eyebrow.
  for (const { rgb, lines } of loose.values()) {
    const joined = new THREE.ShapePath();
    joined.subPaths = chainsOf(lines).filter((c) => c.pts.length >= 3).map((c) => new THREE.Path(c.pts));
    (joined as any).userData = { style: { fillRule: 'evenodd' } };
    addShapes(rgb, SVGLoader.createShapes(joined));
  }

  // The pooled strokes, joined the same way and drawn as strips: a panel's forty edges are one
  // closed strip — an outline and the hole inside it — not forty overlapping ones.
  for (const { rgb, width, cap, limit, lines } of ribbons.values()) {
    for (const c of chainsOf(lines)) {
      const rings = ribbonRings(c.pts, c.closed, width, cap, limit)
        .sort((a, b) => Math.abs(shoelace(b)) - Math.abs(shoelace(a)));
      rings.forEach((r, k) => {
        // The outline anticlockwise, the hole inside a closed strip clockwise.
        if ((shoelace(r) > 0) !== (k === 0)) r.reverse();
        for (const [x, y] of r) box.expandByPoint(new THREE.Vector2(x, y));
      });
      if (rings.length) addRings(rgb, rings);
    }
  }

  // Signed shoelace area of a ring (outer +, holes −); a region's area is the magnitude
  // of its rings' sum. Drives both background detection and carve-priority coverage.
  const ringArea = (r: Ring): number => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    }
    return a / 2;
  };
  const regionArea = (rings: Ring[]): number =>
    Math.abs(rings.reduce((sum, r) => sum + ringArea(r), 0));

  // "Remove background" for SVG — the vector parallel to the raster edge-flood-fill: a
  // filled colour that spans the whole artboard AND fills its own bbox (a rectangle
  // painted behind the art) is the background. Drop it so only the logo remains.
  // Guards: keep at least one colour, and require a rectangle-like fill so a big round
  // logo that merely spans the canvas is not mistaken for a backdrop.
  if (opts.removeBg && groups.size > 1) {
    const fw = (box.max.x - box.min.x) || 1;
    const fh = (box.max.y - box.min.y) || 1;
    const SPAN = 0.92; // must cover ≥92% of the artboard on each axis
    const RECT = 0.85; // must fill ≥85% of its own bbox (i.e. is rectangle-like)
    let bgHex: string | null = null;
    let bgArea = -1;
    for (const [hex, g] of groups) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of g.rings) for (const [x, y] of r) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const gw = x1 - x0, gh = y1 - y0;
      const area = regionArea(g.rings);
      const spans = gw >= SPAN * fw && gh >= SPAN * fh;
      const rectLike = area >= RECT * (gw * gh || Infinity);
      if (spans && rectLike && area > bgArea) { bgArea = area; bgHex = hex; }
    }
    if (bgHex) {
      // The background is the filled shape. A line drawn in the same colour is still drawn.
      const bg = groups.get(bgHex)!;
      if (bg.lines.length) bg.rings = [];
      else groups.delete(bgHex);
    }
  }

  const allRings: Ring[] = [];
  const allLines: Ring[] = [];
  groups.forEach(g => {
    allRings.push(...g.rings);
    allLines.push(...g.lines);
  });

  if (allRings.length === 0 && allLines.length === 0) {
    throw new Error('No drawable paths found in this SVG.');
  }

  // Bbox over the (possibly background-stripped) rings and lines, so the remaining art is
  // recentered and normalized to fill the cap and drives the outline silhouette.
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const list of [allRings, allLines]) for (const r of list) for (const [x, y] of r) {
    if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
  }
  const cx = (bMinX + bMaxX) / 2;
  const cy = (bMinY + bMaxY) / 2;
  const dx = bMaxX - bMinX;
  const dy = bMaxY - bMinY;
  const maxSide = Math.max(dx, dy) || 1;
  // A line has no width of its own, so lines alone can make a drawing with no height (a single
  // horizontal line) or no width. Read as lines, each side is taken as at least the widest line's
  // stroke, the width the line is drawn at: 80 along by a 2-wide stroke is 40, as the strip
  // reading of the same file says, where 80 by 0 was read as 1. A side the drawing spans by more
  // than that is measured as it lies, so this changes only a drawing thinner than its stroke.
  const aspect = lineWidth > 0
    ? Math.max(dx, lineWidth) / Math.max(dy, lineWidth)
    : dy !== 0 ? dx / dy : 1;

  const normalizeRing = (r: Ring): Ring =>
    r.map(([x, y]) => [
      (x - cx) / maxSide,
      -(y - cy) / maxSide // flip Y to match image tracer (Y-up)
    ]);

  // Coverage drives carve priority in buildClicker (smallest-AREA colour is placed
  // first so fine detail wins over big fills). It MUST be an area fraction to match
  // the image pipeline (types.ts: "fraction of foreground pixels"); measuring it by
  // point count instead let a low-poly background rectangle rank as the "smallest"
  // colour, claim the whole cap, and subtract every real colour to nothing.
  const totalArea =
    Array.from(groups.values()).reduce((sum, g) => sum + regionArea(g.rings), 0) || 1;

  const regions = Array.from(groups.values()).map(g => {
    const normRings = g.rings.map(normalizeRing);
    const cov = regionArea(g.rings) / totalArea;
    return {
      quantRgb: g.rgb,
      components: [{ rings: normRings, coverage: cov }],
      coverage: cov,
      // In the same frame as the rings; only a colour that has some carries the field.
      ...(g.lines.length ? { lines: g.lines.map(normalizeRing) } : {}),
    };
  });

  const outline = allRings.map(normalizeRing);

  // What the file says it really is, for a caller that must not rescale it (a cut file).
  const { viewW: vw, viewH: vh } = viewSize(data.xml);
  const mm = mmSpan(data.xml, vw, vh, maxSide);
  return { regions, outline, aspect, ...(mm ? { mm } : {}) };
}

/** The root attribute the keycap's import window stamps on a file it has been through: every
 *  part's fate is written into the file as its paint, so the guesses below stand down. */
const CHOSEN_ATTR = 'data-vl-chosen';

/** An SVG as one colour, in the file's own units: what a legend is carved from. */
export interface SvgLegend {
  /** The filled shapes, every colour in one list, in the file's units and axes (Y down, not
   *  normalised). Outlines are wound one way and holes the other (an outline is not clockwise to
   *  `THREE.ShapeUtils.isClockWise`), so a non-zero fill cuts the holes. */
  contours: Ring[];
  /** Each stroke-only line as three's stroke mesh, one array per subpath: x, y, z for each
   *  corner, three corners to a triangle, in the same units. Plain arrays, so the result holds
   *  no three.js object. */
  strokes: Float32Array[];
  /** The bounds of every contour point and every stroke corner, in the file's units. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** The view box's size, or the width and height, when the file gives one: an icon's em. An
   *  icon family draws every symbol on one grid, so a set scaled by it keeps a small symbol
   *  small, where scaling each by its own box would make them all one size. */
  view: { w: number; h: number } | null;
}

/**
 * An SVG read as a one-colour legend, the way the keycap carves one: each filled path as its
 * shapes, each stroke-only path as three's stroke mesh, both left in the file's own units for the
 * caller to place.
 *
 * Unless the file has been chosen already, two guesses stand in for the import window: white is
 * the background or the negative space of a black-and-white drawing (carved, it would fill the
 * design in solid), so a white fill is not filled and a white stroke not stroked; and a rect over
 * the whole artboard is the backdrop icon sites draw behind their art, so it is neither.
 * `chosen` says the file has been through the window. Left out, a root carrying
 * `data-vl-chosen` says so, which is how a saved file keeps its choices.
 *
 * A path that paints nothing is skipped, and a zero opacity paints nothing. SVGLoader reads a
 * `<style>` block and a `style=""` attribute through the browser's CSSOM, which a strict
 * style-src policy leaves empty; a caller that may run under one flattens them into attributes
 * first.
 */
export function parseSvgLegend(svgText: string, opts: { chosen?: boolean } = {}): SvgLegend {
  const data = new SVGLoader().parse(svgText);
  const { viewW, viewH } = viewSize(data.xml);
  const chosen = opts.chosen ?? !!(data.xml as any)?.hasAttribute?.(CHOSEN_ATTR);
  const contours: Ring[] = [];
  const strokes: Float32Array[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  /** A ring of a filled shape, turned to its winding: an `outer` one not clockwise, a hole clockwise. */
  const take = (points: THREE.Vector2[], outer: boolean) => {
    if (points.length < 3) return;
    if (THREE.ShapeUtils.isClockWise(points) === outer) points.reverse();
    const ring: Ring = [];
    for (const p of points) {
      grow(p.x, p.y);
      ring.push([p.x, p.y]);
    }
    contours.push(ring);
  };

  for (const path of data.paths as any[]) {
    const style = path.userData?.style || {};
    let hasFill = paints(style.fill, style.fillOpacity, style.opacity);
    let hasStroke = paints(style.stroke, style.strokeOpacity, style.opacity);
    if (!chosen) {
      if (hasFill && isWhite(style.fill)) hasFill = false;
      if (hasStroke && isWhite(style.stroke)) hasStroke = false;
      if (isArtboardRect(path.userData?.node, viewW, viewH, drawnBounds(path))) hasFill = hasStroke = false;
    }

    if (hasFill) {
      for (const shape of SVGLoader.createShapes(path)) {
        take(shape.getPoints(16), true);
        for (const hole of shape.holes) take(hole.getPoints(16), false);
      }
    }

    // A path that is filled is drawn by its fill alone; its stroke is not added on top.
    if (hasStroke && !hasFill) {
      const strokeStyle = meshStrokeStyle(style);
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(32);
        if (pts.length < 2) continue;
        const geom = SVGLoader.pointsToStroke(pts, strokeStyle);
        if (!geom) continue;
        const pos = geom.getAttribute('position');
        if (pos && pos.count > 0) {
          for (let i = 0; i < pos.count; i++) grow(pos.getX(i), pos.getY(i));
          strokes.push((pos.array as Float32Array).slice());
        }
        geom.dispose();
      }
    }
  }

  if (!contours.length && !strokes.length) {
    throw new Error('No drawable paths found in this SVG.');
  }
  return {
    contours,
    strokes,
    box: { minX, minY, maxX, maxY },
    view: viewW > 0 && viewH > 0 ? { w: viewW, h: viewH } : null,
  };
}
