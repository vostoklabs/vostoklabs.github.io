// The demo generator's geometry: a rounded tag with a hanging hole and a raised
// rim, built with plain three.js extrusion so the template runs with no wasm.
//
// A real generator usually swaps this file for a manifold-3d worker (see the
// magnet or clicker generator). What matters is the shape of the output: an
// array of `{ name, positions, indices, color }` parts, which is exactly what
// both @vostok/viewer and @vostok/export take.
import * as THREE from 'three';
import type { ExportPart } from '@vostok/export';
import type { TagSettings } from './state';

/** Segments per curve. The rim's inner loop is pre-sampled at the same rate as
 *  the outer one, so both loops share a vertex cadence. */
const CURVE_SEGMENTS = 24;

/** Shortest edge an outline is allowed to carry, mm. Anything below this is a
 *  duplicate point as far as the extruder is concerned. */
const WELD = 1e-3;

/** Drop points that repeat their neighbour, including around the wrap.
 *
 *  Loops are closed implicitly by the extruder, so a repeated point is not
 *  harmless: it becomes a zero-area sliver in the wall, and enough of them
 *  make the cap triangulation disagree with the walls and tear the mesh open. */
function weldLoop(points: THREE.Vector2[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < WELD && Math.abs(prev.y - p.y) < WELD) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < WELD && Math.abs(first.y - last.y) < WELD) {
    out.pop();
  }
  return out;
}

/** Rounded-rectangle outline as an explicit polygon, centred on the origin.
 *
 *  Built point by point rather than with Shape's curve helpers: at the extremes
 *  the helpers emit zero-length straights (radius == half the short side turns
 *  the shape into a stadium) and those are what tear the mesh. Generating the
 *  points here means one weld pass cleans up every case. */
function roundedRectPoints(width: number, height: number, radius: number): THREE.Vector2[] {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  if (r < WELD) {
    return weldLoop([
      new THREE.Vector2(-hw, -hh),
      new THREE.Vector2(hw, -hh),
      new THREE.Vector2(hw, hh),
      new THREE.Vector2(-hw, hh),
    ]);
  }
  const per = Math.max(2, Math.round(CURVE_SEGMENTS / 4));
  const HALF_PI = Math.PI / 2;
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -HALF_PI], // bottom-right
    [hw - r, hh - r, 0], //         top-right
    [-hw + r, hh - r, HALF_PI], //  top-left
    [-hw + r, -hh + r, Math.PI], // bottom-left
  ];
  const pts: THREE.Vector2[] = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = start + (HALF_PI * i) / per;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return weldLoop(pts);
}

function roundedRect(width: number, height: number, radius: number): THREE.Shape {
  return new THREE.Shape(roundedRectPoints(width, height, radius));
}

/** Circle as an explicit loop, with no repeated closing point. */
function circleLoop(cx: number, cy: number, radius: number, segments: number): THREE.Path {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
  }
  return new THREE.Path(weldLoop(pts));
}

/** Centre of the hanging hole.
 *
 *  It is pushed far enough down that the hole always clears the rim band. A
 *  hole that merely *touches* the rim's inner edge makes the extruder's cap
 *  triangulation disagree with its walls, and the part comes out with open
 *  edges — so keep them strictly apart rather than relying on a CSG cleanup. */
function holeCentreY(height: number, hole: number, rim: number): number {
  const clearance = Math.max(hole, rim + hole / 2 + 1);
  return height / 2 - clearance;
}

/** Extruded shape -> a welded, indexed part. */
function toPart(shape: THREE.Shape | THREE.Shape[], depth: number, z: number, name: string, color: [number, number, number]): ExportPart {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
  geo.translate(0, 0, z);
  const src = geo.getAttribute('position');

  // ExtrudeGeometry is non-indexed, so every triangle carries its own copies of
  // shared corners. Weld by quantised position: the exported mesh has to be
  // watertight for slicers, and the viewer's crease-normal pass needs shared
  // vertices to tell a smooth curve from a hard edge.
  const positions: number[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < src.count; i++) {
    const x = src.getX(i);
    const y = src.getY(i);
    const zz = src.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(zz * 1e4)}`;
    let idx = seen.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      seen.set(key, idx);
      positions.push(x, y, zz);
    }
    indices.push(idx);
  }
  geo.dispose();

  return {
    name,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    color,
  };
}

/** Wall left between any two features, mm. */
const MARGIN = 1;

/** Clamp the settings to a shape that can actually be built.
 *
 *  A generator has to do this somewhere: sliders let people ask for a 10 mm
 *  hole in a 15 mm tag, and the honest answer is to shrink the hole, not to
 *  emit a torn mesh. Doing it here means the geometry is always sound, whatever
 *  the UI sends — and `buildTag` can report back what it had to change. */
export function fitSettings(s: TagSettings): TagSettings {
  const width = Math.max(5, s.width);
  const height = Math.max(5, s.height);
  const shortSide = Math.min(width, height);

  const radius = clamp(s.radius, 0, shortSide / 2);
  // The rim has to leave an inside.
  const rim = clamp(s.rim, 0, shortSide / 2 - MARGIN);

  // The hole must fit under the top edge with its clearance, and between the
  // rim bands left and right.
  const hole = clamp(
    s.hole,
    0,
    Math.min(
      (height - MARGIN) / 1.5, // clearance == hole
      height - rim - 1 - MARGIN, // clearance == rim + hole/2 + 1
      width - 2 * rim - 2 * MARGIN,
    ),
  );

  return {
    ...s,
    width,
    height,
    radius,
    rim: rim < MARGIN ? 0 : rim,
    hole: hole < 0.4 ? 0 : hole,
    thickness: Math.max(0.4, s.thickness),
    rimHeight: Math.max(0.2, s.rimHeight),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Build every part of the tag, sitting on z = 0. Settings are fitted first. */
export function buildTag(raw: TagSettings): ExportPart[] {
  const s = fitSettings(raw);
  const body = roundedRect(s.width, s.height, s.radius);
  if (s.hole > 0) {
    body.holes.push(circleLoop(0, holeCentreY(s.height, s.hole, s.rim), s.hole / 2, CURVE_SEGMENTS * 2));
  }
  const parts: ExportPart[] = [toPart(body, s.thickness, 0, 'Tag', s.bodyColor)];

  if (s.rim > 0) {
    // The rim is the outline minus an inset copy of itself — a raised ring that
    // prints on its own filament slot, which is what makes this a two-part model.
    // The hanging hole is not cut from it: `holeCentreY` already keeps the hole
    // clear of the band, so the ring stays a clean two-loop shape.
    const outer = roundedRect(s.width, s.height, s.radius);
    outer.holes.push(new THREE.Path(roundedRectPoints(s.width - s.rim * 2, s.height - s.rim * 2, Math.max(0, s.radius - s.rim))));
    parts.push(toPart(outer, s.rimHeight, s.thickness, 'Rim', s.rimColor));
  }

  return parts;
}
