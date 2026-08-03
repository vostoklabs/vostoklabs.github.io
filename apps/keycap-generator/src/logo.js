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
export function parseSvg(svgText) {
  const data = new SVGLoader().parse(svgText);
  const contours = [];
  const strokeGeoms = [];
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  const isWhite = (color) => {
    if (!color) return false;
    const c = color.toLowerCase().replace(/\s/g, '');
    return c === '#ffffff' || c === '#fff' || c === 'white' || c.startsWith('rgb(255,255,255)') || c.startsWith('rgba(255,255,255,');
  };

  let viewW = 0, viewH = 0;
  if (data.xml) {
    const vb = data.xml.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      if (p.length === 4) { viewW = p[2]; viewH = p[3]; }
    } else {
      viewW = parseFloat(data.xml.getAttribute('width')) || 0;
      viewH = parseFloat(data.xml.getAttribute('height')) || 0;
    }
  }

  for (const path of data.paths) {
    const style = path.userData.style;
    let hasFill   = style.fill   && style.fill   !== 'none';
    let hasStroke = style.stroke && style.stroke !== 'none';

    // Ignore white fills/strokes (often used as background or negative space in black-and-white SVGs).
    // If extruded along with dark paths, they form a solid block.
    if (hasFill && isWhite(style.fill)) hasFill = false;
    if (hasStroke && isWhite(style.stroke)) hasStroke = false;

    // Ignore rects that span the entire viewBox (background artboards)
    const node = path.userData.node;
    if (node && node.nodeName === 'rect') {
      const wStr = node.getAttribute('width');
      const hStr = node.getAttribute('height');
      if (wStr === '100%' && hStr === '100%') {
        hasFill = false;
        hasStroke = false;
      } else if (viewW && viewH) {
        const w = parseFloat(wStr);
        const h = parseFloat(hStr);
        if (Math.abs(w - viewW) < 1 && Math.abs(h - viewH) < 1) {
          hasFill = false;
          hasStroke = false;
        }
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
  return { contours, strokeGeoms, box };
}

// Footprint (mm) the logo will occupy, for default sizing / overflow warnings.
export function logoFootprint(box, widthMM) {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const span = Math.max(dx, dy) || 1;
  const s = widthMM / span;
  return { w: dx * s, h: dy * s };
}
