import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { RegionSet, Ring, RGB } from '../types';

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
}

/** What the import preview decided for one path: how to draw it, and in what colour. */
export interface SvgPartChoice {
  /** `fill` closes the subpaths into solid shapes; `outline` traces the stroke as a ribbon
   *  (`strokeWidth` wide, or 1 unit if the file gave none); `off` drops the path. */
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
  const parts: SvgPart[] = [];
  data.paths.forEach((path: any, index: number) => {
    const style = path.userData?.style || {};
    const hasFill = style.fill && style.fill !== 'none';
    const hasStroke = style.stroke && style.stroke !== 'none';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sub of path.subPaths) {
      for (const p of sub.getPoints(8)) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
    }
    const area = isFinite(x0) ? Math.max(0, (x1 - x0) * (y1 - y0)) : 0;
    const rgb = parseColor(hasFill ? style.fill : hasStroke ? style.stroke : '');
    parts.push({
      index,
      kind: hasFill ? 'fill' : hasStroke ? 'stroke' : 'none',
      hex: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      area,
      ...(hasStroke && !hasFill ? { strokeWidth: Number(style.strokeWidth) || 1 } : {}),
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

  const groups = new Map<string, { rgb: RGB; rings: Ring[] }>();

  function addRings(rgb: RGB, rings: Ring[]) {
    const hex = rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    let g = groups.get(hex);
    if (!g) {
      g = { rgb, rings: [] };
      groups.set(hex, g);
    }
    g.rings.push(...rings);
  }

  data.paths.forEach((path: any, pathIndex: number) => {
    const style = path.userData?.style || {};
    const choice = opts.overrides?.[pathIndex];
    if (choice?.mode === 'off') return;

    const authoredFill = style.fill && style.fill !== 'none';
    const authoredStroke = style.stroke && style.stroke !== 'none';
    /* A choice from the preview wins over what the file said. Otherwise "fill the outlines"
       promotes every stroke-only path (never an unpainted one — that is usually the invisible
       artboard rectangle icon sites wrap their art in, and filling it is a solid square over
       everything). `createShapes` works from the subpaths and does not care how the file
       painted them, so a stroke or an unpainted path becomes a solid shape with no new
       geometry code. */
    const hasFill = choice ? choice.mode === 'fill' : authoredFill || (!!opts.fillStrokes && authoredStroke && !authoredFill);
    const hasStroke = choice ? choice.mode === 'outline' : authoredStroke && !hasFill;
    const authored = style.fill && style.fill !== 'none' ? style.fill : style.stroke || '';
    const rgb = parseColor(choice?.hex ?? authored);

    // Filled paths
    if (hasFill) {
      const shapes = SVGLoader.createShapes(path);
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

    // Outlines
    if (hasStroke && !hasFill) {
      const strokeStyle = SVGLoader.getStrokeStyle(
        Number(style.strokeWidth) || 1,
        style.stroke || '#000',
        style.strokeLineCap || 'butt',
        style.strokeLineJoin || 'miter',
        style.strokeMiterLimit || 4
      );
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
        const strokeRings = strokeGeomToContours(geom);
        addRings(rgb, strokeRings);
        geom.dispose();
      }
    }
  });

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
    if (bgHex) groups.delete(bgHex);
  }

  const allRings: Ring[] = [];
  groups.forEach(g => allRings.push(...g.rings));

  if (allRings.length === 0) {
    throw new Error('No drawable paths found in this SVG.');
  }

  // Bbox over the (possibly background-stripped) rings, so the remaining art is
  // recentered and normalized to fill the cap and drives the outline silhouette.
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const r of allRings) for (const [x, y] of r) {
    if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
  }
  const cx = (bMinX + bMaxX) / 2;
  const cy = (bMinY + bMaxY) / 2;
  const dx = bMaxX - bMinX;
  const dy = bMaxY - bMinY;
  const maxSide = Math.max(dx, dy) || 1;
  const aspect = dy !== 0 ? dx / dy : 1;

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
      coverage: cov
    };
  });

  const outline = allRings.map(normalizeRing);

  return { regions, outline, aspect };
}
