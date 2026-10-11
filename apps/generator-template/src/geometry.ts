// The demo generator's geometry: a rounded tag with a keyring hole, and the customer's text
// standing on it in a second colour. Built with plain three.js extrusion so the template runs
// with no wasm.
//
// A real generator usually swaps this file for a manifold-3d worker (see the
// magnet or clicker generator). What matters is the shape of the output: an
// array of `{ name, positions, indices, color }` parts, which is exactly what
// both @vostok/viewer and @vostok/export take.
//
// The text comes off the shelf: "Text to outlines" lays it out in the chosen face, and "Shape
// maths" groups the outlines into letters with their holes. Only the fitting is this app's own.
// The face arrives parsed: main.ts loads it with `getFont()`, so this file never loads the font
// library, and a worker or a node test can run it as it is.
import * as THREE from 'three';
import type { ExportPart } from '@vostok/export';
import { getHorizontalContours } from '@vostok/fonts/textLayout';
import { islandsFromContours } from '@vostok/shapes';
import type { TagSettings } from './state';

/** A parsed face, as `getFont()` in @vostok/fonts hands it over. */
export type Face = Parameters<typeof getHorizontalContours>[0];

/** Segments per curve of the tag's corners and hole. */
const CURVE_SEGMENTS = 24;

/** Shortest edge an outline is allowed to carry, mm. Anything below this is a
 *  duplicate point as far as the extruder is concerned. */
const WELD = 1e-3;

/** Tag left round the keyring hole, mm. */
const HOLE_WALL = 2.5;
/** Clear tag between the letters and the tag's edge, mm. */
const EDGE = 3;
/** Clear tag between the hole and the first letter, mm. */
const GAP = 3;

type RGB = [number, number, number];
type Pt = [number, number];

/** Drop points that repeat their neighbour, including around the wrap.
 *
 *  Loops are closed implicitly by the extruder, so a repeated point is not
 *  harmless: it becomes a zero-area sliver in the wall, and enough of them
 *  make the cap triangulation disagree with the walls and tear the mesh open.
 *  A font's outlines repeat their first point at the end, so the letters need this too. */
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

/** Circle as an explicit loop, with no repeated closing point. */
function circleLoop(cx: number, cy: number, radius: number, segments: number): THREE.Path {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
  }
  return new THREE.Path(weldLoop(pts));
}

/** Extruded shape -> a welded, indexed part. */
function toPart(shape: THREE.Shape | THREE.Shape[], depth: number, z: number, name: string, color: RGB): ExportPart {
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

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Clamp the settings to a shape that can actually be built.
 *
 *  A generator has to do this somewhere: sliders let people ask for a 10 mm
 *  hole in a 12 mm tag, and the honest answer is to shrink the hole, not to
 *  emit a torn mesh. Doing it here means the geometry is always sound, whatever
 *  the UI sends. */
export function fitSettings(s: TagSettings): TagSettings {
  // The sliders' own minimums. With them, and the hole held to half the tag below, there is
  // always room for the text beside the hole.
  const width = Math.max(20, s.width);
  const height = Math.max(10, s.height);
  // The hole keeps its wall above and below it, and leaves at least half the tag for the text.
  const holeSize = clamp(s.holeSize, 0, Math.min(height - 2 * HOLE_WALL, width / 2 - HOLE_WALL));
  return {
    ...s,
    width,
    height,
    radius: clamp(s.radius, 0, Math.min(width, height) / 2),
    thickness: Math.max(0.4, s.thickness),
    raise: Math.max(0.2, s.raise),
    textSize: Math.max(1, s.textSize),
    hole: s.hole && holeSize >= 1,
    holeSize,
  };
}

/** The keyring hole's centre: on the middle line, one wall in from the left end. Against a
 *  rounded end the wall is at least as thick, because the hole sits on the arc's own axis. */
const holeCentreX = (s: TagSettings) => -s.width / 2 + HOLE_WALL + s.holeSize / 2;

/** How far the letters may reach to the right, at a given half-height, while staying `EDGE`
 *  inside the tag's rounded outline: a tall line of text has less room in a round-ended tag. */
function rightLimit(s: TagSettings, halfHeight: number): number {
  const a = s.width / 2 - EDGE;
  const b = s.height / 2 - EDGE;
  const r = clamp(s.radius - EDGE, 0, Math.min(a, b));
  const intoCorner = halfHeight - (b - r);
  if (intoCorner <= 0) return a;
  return a - r + Math.sqrt(Math.max(0, r * r - intoCorner * intoCorner));
}

/** Where the text may go at a given half-height: right of the hole, inside the outline. */
function room(s: TagSettings, halfHeight: number): { left: number; right: number } {
  const right = rightLimit(s, halfHeight);
  const left = s.hole ? Math.max(-right, holeCentreX(s) + s.holeSize / 2 + GAP) : -right;
  return { left, right };
}

export interface TagBuild {
  parts: ExportPart[];
  /** The letter size the text was drawn at, mm: smaller than asked when it had to fit. */
  textSize: number;
  /** The text was made smaller to fit the tag. */
  shrunk: boolean;
}

/** The text as islands (each letter's outline first, then its holes), fitted to the tag. */
function placeText(s: TagSettings, font: Face): { islands: Pt[][][]; scale: number } | null {
  const layout = getHorizontalContours(font, null, s.text, '', s.textSize, 0, 0, 'center', 0, s.letterSpacing / 100);
  const { box } = layout;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (!(w > 0 && h > 0)) return null;

  // As big as asked, or smaller when the text is too long or too tall for the tag. The room
  // narrows as the text grows taller, so the scale settles over a few rounds; it only ever falls.
  let scale = Math.min(1, (s.height - 2 * EDGE) / h);
  for (let i = 0; i < 4; i++) {
    const { left, right } = room(s, (h * scale) / 2);
    scale = Math.min(scale, (right - left) / w);
  }

  const { left, right } = room(s, (h * scale) / 2);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const mid = (left + right) / 2;
  const placed = layout.contours.map((ring) => ring.map(([x, y]) => [mid + (x! - cx) * scale, (y! - cy) * scale]));
  return { islands: islandsFromContours(placed), scale };
}

/** One letter outline (with its holes) -> a three.js shape. */
function islandShape(island: Pt[][]): THREE.Shape | null {
  const [outer, ...holes] = island.map((ring) => weldLoop(ring.map(([x, y]) => new THREE.Vector2(x, y))));
  if (!outer || outer.length < 3) return null;
  const shape = new THREE.Shape(outer);
  for (const hole of holes) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole));
  return shape;
}

/** Build every part of the tag, sitting on z = 0, with its text in `font`. Settings are fitted first. */
export function buildTag(raw: TagSettings, font: Face): TagBuild {
  const s = fitSettings(raw);
  const body = new THREE.Shape(roundedRectPoints(s.width, s.height, s.radius));
  if (s.hole) body.holes.push(circleLoop(holeCentreX(s), 0, s.holeSize / 2, CURVE_SEGMENTS * 2));
  const parts: ExportPart[] = [toPart(body, s.thickness, 0, 'Tag', rgb(s.tagColor))];

  const result: TagBuild = { parts, textSize: s.textSize, shrunk: false };
  if (!s.text.trim()) return result;

  const text = placeText(s, font);
  if (!text) return result;
  const letters = text.islands.map(islandShape).filter((x): x is THREE.Shape => !!x);
  // The letters stand on the tag's top face as a part of their own, which is what puts them on
  // a second filament in the 3MF.
  if (letters.length) parts.push(toPart(letters, s.raise, s.thickness, 'Letters', rgb(s.textColor)));
  return { ...result, textSize: s.textSize * text.scale, shrunk: text.scale < 0.999 };
}
