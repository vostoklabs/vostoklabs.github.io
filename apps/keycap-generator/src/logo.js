import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/**
 * Parse SVG markup into:
 *   contours   – 2D polylines for filled paths (holes already identified + winding corrected)
 *   strokeGeoms – flat THREE.BufferGeometry ribbons for stroke-only paths
 *   box        – combined axis-aligned bounding box in SVG coordinates
 *
 * Strategy:
 *  • fill path  → SVGLoader.createShapes (respects even-odd/nonzero, detects holes)
 *  • stroke-only path (fill="none") → SVGLoader.pointsToStroke (thick 2-D ribbon)
 *  • paths with neither fill nor visible stroke are skipped
 */
const isWhite = (color) => {
  if (!color) return false;
  const c = color.toLowerCase().replace(/\s/g, '');
  return c === '#ffffff' || c === '#fff' || c === 'white' || c.startsWith('rgb(255,255,255)') || c.startsWith('rgba(255,255,255,');
};

/** The artboard size, from the viewBox or the width/height attributes. */
function viewSize(xml) {
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

/** The drawn bounds of one path, in the file's own user space — every transform on the
 *  element and its ancestors already applied, because that is what SVGLoader hands back. */
function pathBounds(path) {
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
 * A rect that spans the whole artboard: the background icon sites paint behind their art.
 *
 * Judged on the rect as DRAWN, not on its width/height attributes. Reading the attributes
 * ignores every transform between the rect and the root, and wrapping the artboard in a
 * `<g transform="matrix(...)">` is what Figma and Illustrator do on the way out — so a
 * background rect in a perfectly ordinary export was not recognised, the import preview
 * offered it as "Fill", and it was carved as a slab over the icon.
 *
 * Still rect-only. Any full-bleed SHAPE covering the artboard would catch a solid square
 * logo, which is a legend someone might actually want.
 */
function isArtboardRect(node, viewW, viewH, bounds) {
  if (!node || node.nodeName !== 'rect') return false;
  const wStr = node.getAttribute('width');
  const hStr = node.getAttribute('height');
  if (wStr === '100%' && hStr === '100%') return true;
  if (!viewW || !viewH) return false;
  if (bounds && Number.isFinite(bounds.x0) && Number.isFinite(bounds.x1)) {
    // 98%: a background rect is often drawn a hair inside the artboard, or a hair outside it.
    if ((bounds.x1 - bounds.x0) >= viewW * 0.98 && (bounds.y1 - bounds.y0) >= viewH * 0.98) return true;
  }
  // The original attribute test, kept as the fallback for a path with no usable geometry.
  return Math.abs(parseFloat(wStr) - viewW) < 1 && Math.abs(parseFloat(hStr) - viewH) < 1;
}

/**
 * The root attribute `applySvgChoices` stamps on a file the user has been through the import
 * preview with. It means "every part's fate is written in as fill/stroke; do not second-guess
 * it" — so the white-shape and artboard-rect heuristics stand down and a user who set a white
 * shape or the artboard to Fill actually gets it.
 */
const CHOSEN_ATTR = 'data-vl-chosen';

/**
 * What is in an SVG, before committing to it.
 *
 * One entry per drawable element, in file order (`index` is the position in
 * `SVGLoader.parse().paths`, which is what `applySvgChoices` keys on). `kind` is how the file
 * paints it; `why`, when set, is the reason `parseSvg` would have silently dropped it —
 * reported here so the import preview can show that as an "Off" the user can flip, rather
 * than a legend that came out blank for no visible reason.
 *
 * @param {string} svgText
 * @returns {{ parts: Array<{index:number, kind:'fill'|'stroke'|'none', area:number, strokeWidth?:number, why?:'white'|'artboard'}>, issues: string[] }}
 */
export function describeSvg(svgText) {
  let data;
  try {
    data = new SVGLoader().parse(svgText);
  } catch {
    return { parts: [], issues: ['This file could not be read as an SVG.'] };
  }
  const { viewW, viewH } = viewSize(data.xml);
  const parts = data.paths.map((path, index) => {
    const style = path.userData.style || {};
    const hasFill = style.fill && style.fill !== 'none';
    const hasStroke = style.stroke && style.stroke !== 'none';
    const { x0, y0, x1, y1 } = pathBounds(path);
    const part = {
      index,
      kind: hasFill ? 'fill' : hasStroke ? 'stroke' : 'none',
      area: isFinite(x0) ? Math.max(0, (x1 - x0) * (y1 - y0)) : 0,
    };
    if (hasStroke && !hasFill) part.strokeWidth = Number(style.strokeWidth) || 1;
    if (isArtboardRect(path.userData.node, viewW, viewH, { x0, y0, x1, y1 })) part.why = 'artboard';
    else if ((hasFill && isWhite(style.fill)) || (!hasFill && hasStroke && isWhite(style.stroke))) part.why = 'white';
    return part;
  });
  const issues = [];
  if (!parts.length) issues.push('There are no drawable shapes in this file.');
  // Biggest first, so the list starts with what matters.
  return { parts: parts.sort((a, b) => b.area - a.area), issues };
}

/**
 * Write the import preview's decisions INTO the file, and return the new markup.
 *
 * `choices` is `{ [index]: 'fill' | 'outline' | 'off' }` keyed like `describeSvg`'s parts. Each
 * chosen element gets both the presentation attributes and an inline `style` — the attribute
 * is what a DOM without CSSOM (the headless test) reads, the inline style is what beats a
 * `<style>` block or a class in a real browser — and the root is stamped with
 * `data-vl-chosen` so `parseSvg` takes the file at its word. An `off` part is left in place
 * but unpainted and hidden: removing the node would renumber every index behind it.
 *
 * The legend is one colour, so `#000` is only "ink"; the carve does not read the value.
 *
 * @param {string} svgText
 * @param {Record<number, 'fill'|'outline'|'off'>} choices
 * @returns {string}
 */
export function applySvgChoices(svgText, choices) {
  const data = new SVGLoader().parse(svgText);
  if (!data.xml) return svgText;
  const own = (node) => (node.getAttribute('style') || '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(fill|stroke|stroke-width|visibility)\s*:/i.test(d));
  data.paths.forEach((path, index) => {
    const mode = choices[index];
    const node = path.userData.node;
    if (!mode || !node) return;
    const style = path.userData.style || {};
    const width = Number(style.strokeWidth) || 1;
    const set = mode === 'fill'
      ? { fill: '#000', stroke: 'none', visibility: 'visible' }
      : mode === 'outline'
        ? { fill: 'none', stroke: '#000', 'stroke-width': String(width), visibility: 'visible' }
        : { fill: 'none', stroke: 'none', visibility: 'hidden' };
    const decls = own(node);
    for (const [k, v] of Object.entries(set)) {
      node.setAttribute(k, v);
      decls.push(`${k}:${v}`);
    }
    node.setAttribute('style', decls.join(';'));
  });
  data.xml.setAttribute(CHOSEN_ATTR, '1');
  return new XMLSerializer().serializeToString(data.xml);
}

export function parseSvg(svgText) {
  const data = new SVGLoader().parse(svgText);
  const contours = [];
  const strokeGeoms = [];
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  const { viewW, viewH } = viewSize(data.xml);
  // A file the import preview has been through says exactly what to draw. The two guesses
  // below exist for files that have NOT — the same guesses the preview shows as "Off" rows.
  const chosen = !!data.xml?.hasAttribute?.(CHOSEN_ATTR);

  for (const path of data.paths) {
    const style = path.userData.style;
    let hasFill   = style.fill   && style.fill   !== 'none';
    let hasStroke = style.stroke && style.stroke !== 'none';

    if (!chosen) {
      // Ignore white fills/strokes (often used as background or negative space in black-and-white SVGs).
      // If extruded along with dark paths, they form a solid block.
      if (hasFill && isWhite(style.fill)) hasFill = false;
      if (hasStroke && isWhite(style.stroke)) hasStroke = false;

      // Ignore rects that span the entire viewBox (background artboards)
      if (isArtboardRect(path.userData.node, viewW, viewH, pathBounds(path))) {
        hasFill = false;
        hasStroke = false;
      }
    }

    // ── Filled paths ──────────────────────────────────────────────────────────
    if (hasFill) {
      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        // Outer contour – ensure CCW so Manifold NonZero treats it as solid
        const points = shape.getPoints(16);
        if (points.length >= 3) {
          if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
          const c = [];
          for (const p of points) { box.expandByPoint(p); c.push([p.x, p.y]); }
          contours.push(c);
        }
        // Holes – ensure CW so they cancel the solid interior
        for (const hole of shape.holes) {
          const hp = hole.getPoints(16);
          if (hp.length >= 3) {
            if (!THREE.ShapeUtils.isClockWise(hp)) hp.reverse();
            const c = [];
            for (const p of hp) { box.expandByPoint(p); c.push([p.x, p.y]); }
            contours.push(c);
          }
        }
      }
    }

    // ── Stroke-only paths ─────────────────────────────────────────────────────
    // When fill="none" the shape is drawn purely by its stroke.
    // Convert each sub-path to a thick 2-D ribbon via pointsToStroke.
    if (hasStroke && !hasFill) {
      const strokeStyle = SVGLoader.getStrokeStyle(
        style.strokeWidth      || 1,
        style.stroke,
        style.strokeLineCap    || 'butt',
        style.strokeLineJoin   || 'miter',
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
        strokeGeoms.push(geom);
      }
    }
  }

  if (!contours.length && !strokeGeoms.length) {
    throw new Error('No drawable paths found in this SVG.');
  }
  // The viewBox is the icon's em. A curated icon family (lucide) draws every symbol optically
  // sized on one grid, so a chevron is DELIBERATELY smaller than an arrow — normalising each
  // one by its own ink box throws that away and makes them all the same height. Kept here so
  // the keyboard set can scale by the grid; single-cap placement still uses the ink box, which
  // is what direct manipulation of an arbitrary uploaded SVG should do.
  const view = viewW > 0 && viewH > 0 ? { w: viewW, h: viewH } : null;
  return { contours, strokeGeoms, box, view };
}

// Footprint (mm) the logo will occupy, for default sizing / overflow warnings.
export function logoFootprint(box, widthMM) {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const span = Math.max(dx, dy) || 1;
  const s = widthMM / span;
  return { w: dx * s, h: dy * s };
}
