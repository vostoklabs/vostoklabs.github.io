import type { BuildParams, ChainInfo, HookFrame, PartMesh } from '../types';
import { GATE_GAP_MM, PIP_ASPECT } from '../state';
import { bestCutT, centroid, frameAt, hookGateT, radialAt, rotateRing, scaleRing, tAtAngle, tDistance, tNearest, turnNear, type Pt, type Ring } from '../shapes/ring';
import type { ShapeGeom } from '../shapes';
import { identityVoids } from './identityMark';
import { pipGeometry, pipLevels, pipLayout, pipMesh, PIP_MIN_BAND, PIP_Z_GAP, PIP_TIP_MIN, type PipGeom, type PipLevels, type PipElement } from './pipChain';

/** Room between the swivel's housing and the loop hanging under it, mm. The loop's rounded
 *  top meets the housing's flat underside at a point, like the round ring it replaces, but a
 *  loop that spins wants more than a sliding fit. */
const PIP_SWIVEL_GAP = 1.0;
import { packShelf } from '@vostok/plates';

/*
  The set, and how one construction makes all of it.

  Every part in the reference photo is a SILHOUETTE turned into a BAND (the outline minus
  itself inset by the bar width) with features cut or fused at marked points on the outline:

    hook        band → S-cut gate at `gate` → filled icon inlaid where the user put it → at
                `eye`, a gusset, then a plain loop or the print-in-place swivel housing
    link        band → one angled slit where the outline is straightest; closed by hand
    connector   a plain round split ring, so any link shape hooks onto anything
    charm       filled outline (or band) → icon cut / engraved / raised → a loop at `top`,
                or the swivel's captive stem when it hangs straight off the hook

  ORIENTATION. Everything is authored the way it PRINTS: flat on the bed in XY, face up. The
  hook is turned so its eye's radial points straight down (−Y) and the charm so its top's
  radial points straight up (+Y) — radial from the centroid, because that is the axis a
  hanging thing actually hangs on, and because at a star's tip the local edge normal is
  whichever edge the marker landed on while the radial is the tip's own axis.

  THE GATE is Ian's design, not the print-in-place cantilever arm the popular carabiners use:
  a wavy cut through the band, and the whole ring is the spring. Its width is the only
  clearance in the part, and `gateFit` is that width.

  THE SWIVEL is Ian's render: a window straight through the neck with a barrel lying in it,
  axis along the hang direction, and the barrel's stem out through a round tunnel in the
  floor. The barrel needs no lid — the round stem in the round tunnel is what holds it in
  every direction but down, and the barrel is what stops "down". Radii step down from the
  thickness by fixed clearances and walls; nothing is scaled to fit, because a clearance
  that scales is a clearance that fuses.

  EDGES are rounded by warping the extrusion, not by stacking slices: a quarter-circle
  profile is applied to every vertex of the top and bottom rings, inset along its own
  bisector and limited by the local thickness so a thin stroke rounds less rather than
  crossing itself.

  Two layouts come out: the PRINT layout (everything flat, shelf-packed — this is what
  exports) and the ASSEMBLED layout (chain interlinked, charm hanging — preview only).

  THE PRINT-IN-PLACE CHAIN (`mode: 'pip'`) replaces the open links with oval links that come
  off the bed interlocked, grown out of the hook: the hook's loop (or the swivel's captive
  ring) is the first link, every link after it hangs in the print layout exactly where it
  hangs when worn, and only the connector ring(s) and the charm are separate parts. The
  links themselves are `./pipChain.ts`; here they are placed, fused and hung.

  Portable on purpose: this file and `../shapes/ring.ts` are the whole geometry, and neither
  imports anything from the app. A host that has its own shapes and glyphs calls `buildSet`
  with rings and contours and gets meshes.
*/

type Keep = <M extends { delete(): void }>(m: M) => M;

/** Registers every WASM object so a throw cannot leak the heap. */
function withScope<T>(fn: (keep: Keep) => T): T {
  const created: { delete(): void }[] = [];
  const keep: Keep = (m) => {
    created.push(m);
    return m;
  };
  try {
    return fn(keep);
  } finally {
    for (const m of created) {
      try {
        m.delete();
      } catch (e) {
        console.warn('Error deleting manifold object:', e);
      }
    }
  }
}

export interface BuildResult {
  parts: PartMesh[];
  assembled: PartMesh[];
  /** How the chain hangs in the assembled layout, for the dangle. Null when nothing hangs. */
  chain: ChainInfo | null;
  hookFrame: HookFrame;
  warnings: string[];
  size: [number, number, number];
  /** Provenance voids that landed. */
  marks: number;
}

// --- Fixed hardware numbers (mm). These are clearances and walls; they never scale. -------

/** How far a fused feature reaches INTO the band, so the union is a solid joint. */
const FUSE = 1.5;

/**
 * Room left round whatever passes through a loop, mm — Ian's number after printing one. A
 * loop's opening is never a setting: the hook's loop and the swivel's ring pass the first
 * chain ring, which is as thick as a link; a connector passes a link or the hook's loop bar,
 * whichever is fatter; the charm's loop passes the last chain element. Size them from that
 * and they cannot be wrong by a slider.
 */
const LOOP_CLEARANCE = 2.5;
/** Opening of the hook's loop and of the swivel's ring: the next chain element passes. */
const hookLoopId = (p: BuildParams) => p.linkThick + LOOP_CLEARANCE;
/** Opening of a connector ring. It threads a link, but also the hook's loop (or the swivel's
 *  ring, or the hook itself), and those are as thick as the HOOK — and the charm's loop, as
 *  thick as the charm. The fattest of them, plus room. */
const connectorId = (p: BuildParams, also = 0) => Math.max(p.linkThick, p.hookThick, p.charm ? p.charmThick : 0, also) + LOOP_CLEARANCE + Math.max(0, p.connectorExtra);
/** Opening of the charm's loop: the last chain element passes — a link, or in the
 *  print-in-place chain a connector ring or the terminal link itself. */
const charmLoopId = (p: BuildParams, lastThick = p.linkThick) => lastThick + LOOP_CLEARANCE;

/** Connector rings on a print-in-place chain are printed this thick (or as thick as the hook,
 *  whichever is less): a 5 mm split ring is a chore to open. */
const PIP_CONNECTOR_THICK = 4;

/** Swivel. */
const SW_GAP = 0.4;
const SW_WALL = 1.6;
/** The default stem, and the thinnest allowed. Ian's first chain print broke here: a 2.4 mm
 *  stem holding a chain of 6 mm links. It is a setting now (`swivelStem`). */
const SW_STEM_D = 2.4;
const SW_STEM_R = SW_STEM_D / 2;
const SW_TUNNEL_R = SW_STEM_R + SW_GAP;
/** Solid left between the tunnel and the faces. */
const SW_SKIN = 0.9;
/** The barrel is a little fatter than the part is thick, then flattened top and bottom, so
 *  it rests on the bed and clears the housing's top. */
const SW_BARREL_OVER = 0.2;
const SW_BARREL_TOP_CLEAR = 0.4;

/** The thinnest part a swivel can live in. Exposed so the UI can say so before the build does. */
export const SWIVEL_MIN_THICK = Math.round((SW_TUNNEL_R + SW_SKIN) * 2 * 10) / 10;

/** Every top and bottom edge gets an edge treatment: a flat 45° bevel like the clicker's, or a
 *  round-over. Either way the bottom one is the elephant's-foot compensation every flat part
 *  wants. */
export interface EdgeSpec {
  style: 'chamfer' | 'round';
  /** Bevel leg / round-over radius, mm. */
  size: number;
}
/** Rings the extrusion is subdivided into for the edge: half for the bottom profile, half for
 *  the top. A chamfer only needs two, a round-over uses all of them. */
const FILLET_DIV = 10;

/** Engraved icons go this deep; raised ones stand this proud. */
const ENGRAVE_MAX = 1.2;
const RAISE_H = 0.8;

const SEG = 32;

// --- 2D helpers -----------------------------------------------------------------------------

function cs(wasm: any, rings: Ring[], keep: Keep, rule: 'NonZero' | 'Positive' = 'NonZero'): any {
  return keep(new wasm.CrossSection(rings, rule));
}

function add(a: Pt, b: Pt, k = 1): Pt {
  return [a[0] + b[0] * k, a[1] + b[1] * k];
}

function rot(v: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/** A polyline swept as a strip of constant width, with round joints. What a cut is made of. */
function strip(wasm: any, pts: Pt[], width: number, keep: Keep): any {
  const { CrossSection } = wasm;
  let out: any = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const rect = keep(
      CrossSection.square([len, width], true)
        .rotate(ang)
        .translate([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
    );
    out = out ? keep(out.add(rect)) : rect;
    if (i > 0) out = keep(out.add(keep(CrossSection.circle(width / 2, 16).translate(a))));
  }
  return out ?? keep(CrossSection.circle(0.01, 3));
}

/** A plain ring: inside radius `r`, bar `bar`. */
function ringCS(wasm: any, r: number, bar: number, keep: Keep): any {
  return keep(wasm.CrossSection.circle(r + bar, SEG).subtract(keep(wasm.CrossSection.circle(r, SEG))));
}

/** Rounded rectangle centred on the origin. */
function roundedRect(wasm: any, w: number, h: number, r: number, keep: Keep): any {
  const rr = Math.min(r, w / 2 - 0.05, h / 2 - 0.05);
  const sq = keep(wasm.CrossSection.square([w, h], true));
  if (rr <= 0.05) return sq;
  return keep(keep(sq.offset(-rr, 'Round', 2.0, 16)).offset(rr, 'Round', 2.0, 16));
}

/** The band: the outline minus itself inset by `bar`. `solid` = the bar swallowed the whole
 *  shape, and the caller decides what that means. */
/** Shortest line from the hole to the outer edge: [point on the edge, point on the hole].
 *  Ties go to the point facing left, so a plain ring's slit is where every plain ring's is. */
function thinnestCut(outer: Ring, holes: number[][][]): [Pt, Pt] {
  const c = centroid(outer);
  let best: [Pt, Pt] = [outer[0]!, outer[0]!];
  let bestScore = Infinity;
  for (const hole of holes) {
    for (const q of hole) {
      const t = tNearest(outer, [q[0]!, q[1]!]);
      const p = frameAt(outer, t).p;
      const d = Math.hypot(p[0] - q[0]!, p[1] - q[1]!);
      let da = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.PI;
      da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
      const score = d + da * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = [p, [q[0]!, q[1]!]];
      }
    }
  }
  return best;
}

function band(wasm: any, outline: any, bar: number, keep: Keep): { cs: any; solid: boolean; cutRegion: any; inner: any } {
  const inner = keep(outline.offset(-bar, 'Round', 2.0, SEG));
  if (inner.area() < 2) return { cs: outline, solid: true, cutRegion: outline, inner };
  // Where a cut is allowed to remove material: the band, grown a little outward and a little
  // into the hole. A cut that ran on across the hole used to nick the far side of a small
  // star link and leave the tip of an arm as a loose sliver.
  const cutRegion = keep(keep(outline.offset(1.0, 'Round', 2.0, 8)).subtract(keep(inner.offset(-0.5, 'Round', 2.0, 8))));
  return { cs: keep(outline.subtract(inner)), solid: false, cutRegion, inner };
}

function polyArea(poly: number[][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0]! * poly[i]![1]! - poly[i]![0]! * poly[j]![1]!;
  return a / 2;
}

/** Keep only the outer loops. A glyph's counters (a cat's eyes) would otherwise be islands. */
function fillHoles(wasm: any, section: any, keep: Keep): any {
  const polys = section.toPolygons() as number[][][];
  const outers = polys.filter((p) => polyArea(p) > 0);
  if (outers.length === polys.length || outers.length === 0) return section;
  return keep(new wasm.CrossSection(outers, 'Positive'));
}

/** Glyph contours fitted so their bounding box's long side is `size`, centred on the origin. */
function fitContours(contours: number[][][], size: number): { rings: Ring[]; w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of contours) for (const [x, y] of poly) {
    if (x! < minX) minX = x!;
    if (x! > maxX) maxX = x!;
    if (y! < minY) minY = y!;
    if (y! > maxY) maxY = y!;
  }
  if (!Number.isFinite(minX)) return { rings: [], w: 0, h: 0 };
  const w = maxX - minX, h = maxY - minY;
  const s = size / Math.max(w, h, 1e-9);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return {
    rings: contours.map((poly) => poly.map(([x, y]) => [(x! - cx) * s, (y! - cy) * s] as Pt)),
    w: w * s,
    h: h * s,
  };
}

/** Turn a shape so the radial at marker `t` points along `dir`, scaled to `size`. */
function orient(geom: ShapeGeom, t: number, dir: Pt, size: number): Ring {
  const rad = radialAt(geom.ring, t);
  const have = Math.atan2(rad[1], rad[0]);
  const want = Math.atan2(dir[1], dir[0]);
  return scaleRing(rotateRing(geom.ring, want - have), size);
}

// --- 3D helpers -----------------------------------------------------------------------------

/**
 * Extrude with a real round-over top and bottom.
 *
 * The section is extruded with `FILLET_DIV` intermediate rings, then every vertex is moved:
 * its height is remapped so the rings crowd into the two fillet bands, and within a band it
 * is inset along its own bisector by the quarter-circle profile. The inset is capped at
 * just under half the local thickness — measured by casting a ray inward until it meets the
 * outline again — so a 0.4 mm glyph stroke rounds by 0.18 rather than folding through itself.
 */
function edgeExtrude(cs2: any, height: number, keep: Keep, edge: EdgeSpec): any {
  const rr = Math.min(edge.size, height * 0.3);
  if (rr < 0.1) return keep(cs2.extrude(height));
  const round = edge.style === 'round';

  const polys = cs2.toPolygons() as number[][][];
  type Seg = { ax: number; ay: number; bx: number; by: number };
  const segs: Seg[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      segs.push({ ax: a[0]!, ay: a[1]!, bx: b[0]!, by: b[1]! });
    }
  }
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const info = new Map<string, { dx: number; dy: number; lim: number }>();

  /** Distance along the ray (o + s·d, s > 0) to the nearest outline segment, skipping the
   *  two that meet at the ray's origin. */
  const castInward = (ox: number, oy: number, dx: number, dy: number, skipA: number, skipB: number): number => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      if (i === skipA || i === skipB) continue;
      const s = segs[i]!;
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = s.ax - ox, wy = s.ay - oy;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
    }
    return best;
  };

  let segIndex = 0;
  for (const poly of polys) {
    const n = poly.length;
    const first = segIndex;
    for (let i = 0; i < n; i++) {
      const p = poly[i]!, a = poly[(i - 1 + n) % n]!, b = poly[(i + 1) % n]!;
      const e1x = p[0]! - a[0]!, e1y = p[1]! - a[1]!;
      const e2x = b[0]! - p[0]!, e2y = b[1]! - p[1]!;
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      // Left normals: the solid is on the left for outer loops (ccw) and holes (cw) alike.
      const n1x = -e1y / l1, n1y = e1x / l1;
      const n2x = -e2y / l2, n2y = e2x / l2;
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-9) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
      // Miter: keep the offset edges parallel to the originals, but never more than twice.
      const cosHalf = Math.max(0.5, mx * n1x + my * n1y);
      const scale = 1 / cosHalf;
      const segPrev = first + ((i - 1 + n) % n);
      const segNext = first + i;
      const thickness = castInward(p[0]!, p[1]!, mx, my, segPrev, segNext);
      const lim = Math.max(0, Math.min(rr, thickness * 0.45));
      info.set(key(p[0]!, p[1]!), { dx: mx * scale, dy: my * scale, lim });
    }
    segIndex += n;
  }

  const solid = keep(cs2.extrude(height, FILLET_DIV));
  const levels = FILLET_DIV + 1;
  const half = Math.floor((FILLET_DIV + 1) / 2);
  const warped = solid.warp((v: number[]) => {
    const k = Math.round((v[2]! / height) * levels);
    const bottom = k <= half;
    const j = bottom ? k : levels - k;
    const f = Math.min(j, half) / half;
    const phi = f * (Math.PI / 2);
    // Round: a quarter circle. Chamfer: a straight 45° line between the same two points.
    const z = round ? rr * (1 - Math.cos(phi)) : rr * f;
    const inset = round ? rr * (1 - Math.sin(phi)) : rr * (1 - f);
    v[2] = bottom ? z : height - z;
    if (inset < 1e-6) return;
    const it = info.get(key(v[0]!, v[1]!));
    if (!it) return;
    const d = Math.min(inset, it.lim);
    v[0] = v[0]! + it.dx * d;
    v[1] = v[1]! + it.dy * d;
  });
  return keep(warped);
}

/** Cylinder of radius `r` from `from` to `to` in the plane, at height `z`. */
function cylinderAlong(wasm: any, from: Pt, to: Pt, z: number, r: number, keep: Keep): any {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const ang = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  return keep(
    wasm.Manifold.cylinder(len, r, r, SEG)
      .rotate([0, 90, 0])
      .rotate([0, 0, ang])
      .translate([from[0], from[1], z]),
  );
}

function meshOf(solid: any, name: string, color: [number, number, number]): PartMesh {
  const m = solid.getMesh();
  return { name, positions: m.vertProperties, indices: m.triVerts, color };
}

function clonePart(p: PartMesh, name = p.name): PartMesh {
  return { name, positions: new Float32Array(p.positions), indices: new Uint32Array(p.indices), color: p.color };
}

interface Box {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

function bboxOf(parts: PartMesh[]): Box {
  const b: Box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i]!, y = p.positions[i + 1]!, z = p.positions[i + 2]!;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z;
      if (z > b.maxZ) b.maxZ = z;
    }
  }
  return b;
}

function translateParts(parts: PartMesh[], dx: number, dy: number, dz = 0): void {
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      p.positions[i] = p.positions[i]! + dx;
      p.positions[i + 1] = p.positions[i + 1]! + dy;
      p.positions[i + 2] = p.positions[i + 2]! + dz;
    }
  }
}

/** Rotate about the vertical line x = `cx`, z = `cz` (the Y axis through that point). */
function rotateAboutY(parts: PartMesh[], deg: number, cx: number, cz: number): void {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i]! - cx, z = p.positions[i + 2]! - cz;
      p.positions[i] = cx + x * c + z * s;
      p.positions[i + 2] = cz - x * s + z * c;
    }
  }
}

// --- The swivel's numbers ------------------------------------------------------------------

interface Swivel {
  barrelR: number;
  windowW: number;
  housingW: number;
  housingL: number;
  /** The stem's radius, the tunnel's, and how long the barrel (and its window) are. */
  stemR: number;
  tunnelR: number;
  barrelLen: number;
  windowLen: number;
  /** The stem the user asked for did not fit this hook and was thinned to what does. */
  stemClamped: boolean;
}

/** The swivel's numbers for a hook `t` thick and a stem `stemD` across. The stem is what the
 *  chain hangs from, so it is the setting; the tunnel it turns in and the skin over that
 *  tunnel are fixed clearances, so a thick stem needs a thick hook: the stem is thinned to
 *  what the hook can hold, and refused only below the default. */
function swivelFor(t: number, stemD = SW_STEM_D): Swivel | null {
  const maxStemR = t / 2 - SW_SKIN - SW_GAP;
  if (maxStemR < SW_STEM_R - 1e-6) return null;
  const stemR = Math.min(stemD / 2, maxStemR);
  const barrelLen = Math.max(3, stemR * 2.5);
  const windowLen = barrelLen + 2 * SW_GAP;
  const barrelR = t / 2 + SW_BARREL_OVER;
  const windowW = 2 * barrelR + 2 * SW_GAP;
  return {
    barrelR,
    windowW,
    housingW: windowW + 2 * SW_WALL,
    housingL: FUSE + SW_WALL + windowLen + SW_WALL,
    stemR,
    tunnelR: stemR + SW_GAP,
    barrelLen,
    windowLen,
    stemClamped: stemR < stemD / 2 - 1e-6,
  };
}

/** The user's edge choice, clamped to what a part can carry. */
function edgeOf(p: BuildParams): EdgeSpec {
  return { style: p.edge, size: Math.max(0.2, Math.min(1.5, p.edgeSize)) };
}
/** A raised symbol is only RAISE_H tall; its edge is scaled down to match. */
function raiseEdge(p: BuildParams): EdgeSpec {
  return { style: p.edge, size: Math.min(0.3, edgeOf(p).size) };
}

// --- The print-in-place chain's plan --------------------------------------------------------

/** Everything the print-in-place chain needs, decided once: the link geometry, the two
 *  levels, and every element laid out along the chain's axis in the hook's frame. */
interface PipPlan {
  geom: PipGeom;
  levels: PipLevels;
  /** Links after the loop. The last one is the terminal; 0 = the loop alone. */
  count: number;
  /** The chain's axis, hook-frame x. */
  x: number;
  /** Element 0 is the loop (or the swivel's captive ring); k ≥ 1 are the links. When the
   *  chain is its own part, element 0 is the first link and the hook keeps its own loop. */
  elements: PipElement[];
  separate: boolean;
  connThick: number;
}

function pipPlanFor(p: BuildParams, attach: Attach, E: Pt, sw: Swivel | null, warn: (s: string) => void): PipPlan {
  const T = p.hookThick;
  // The chain has its own height: the bridge and the low top each get half of it less the
  // gap. Under the swivel it hangs from a stem at the hook's mid-height, so it only has to be
  // tall enough to wrap that stem; taller than the hook is fine — it hangs below the housing,
  // not beside it. (Pinning it to the hook's thickness, as the first cut did, made the
  // thickness setting do nothing with the swivel on.)
  let H = p.pipLinkThick;
  if (p.pipAttached && attach === 'swivel' && sw) {
    const minH = Math.ceil((T / 2 + sw.stemR + SW_SKIN) * 2) / 2;
    if (H < minH) { warn(`The links were thickened to ${minH} mm so the swivel's stem stays inside its loop.`); H = minH; }
  }
  const levels = pipLevels(H);
  if (levels.h < PIP_MIN_BAND) {
    const minT = Math.ceil((2 * PIP_MIN_BAND + PIP_Z_GAP) * 2) / 2;
    warn(`The print-in-place chain wants its links at least ${minT} mm thick — the bridges are only ${levels.h.toFixed(1)} mm here.`);
  }
  const length = Math.max(8, p.pipLinkSize);
  const width = length / PIP_ASPECT[p.pipLinkAspect];
  const geom = pipGeometry({ length, width, bar: p.pipLinkBar }, levels);
  if (geom.bar < p.pipLinkBar - 1e-6) warn('The link bar was thinned to leave a hole in the link.');
  if (!geom.feasible) {
    const f = geom.flags;
    const why = !f.tip
      ? `the tips of neighbouring links would sit closer than ${PIP_TIP_MIN} mm and weld on the first layer`
      : !f.facet || !f.scan
        ? 'the crossings do not fit on the links’ straight facets'
        : 'the 45° slopes do not fit between the crossings';
    warn(`The print-in-place links are too small for this bar${!f.tip || !f.facet ? '' : ' and hook thickness'} — ${why}, so links would fuse. Make the links bigger${f.tip && f.facet ? ', the bar thinner or the hook thinner' : ' or the bar thinner'}.`);
  }
  const count = Math.max(0, Math.min(16, Math.round(p.pipLinkCount)));
  if (!p.pipAttached) {
    // Its own part: the first link is the root, a connector ring joins it to the hook's loop.
    const n = Math.max(1, count);
    return { geom, levels, count: n - 1, x: 0, elements: pipLayout(geom, n - 1, 'link', 0), connThick: Math.min(PIP_CONNECTOR_THICK, T), separate: true };
  }
  // The root is the teardrop loop either way: its near tip FUSE into the hook's band, or its
  // rounded top a point-contact `PIP_SWIVEL_GAP` under the housing, hanging off the stem —
  // an octagon's flat tip facing the housing's flat underside was going to weld.
  // `pipLayout` places the CENTRELINE tip; the band's outer edge is half a bar beyond it, and
  // that edge is what has to clear the housing (round 14 put the centreline at the gap and the
  // outer edge 1 mm inside the housing — the "it will merge" Ian saw) or reach FUSE into the band.
  const topY = (attach === 'swivel' && sw ? E[1] - (sw.housingL - FUSE + PIP_SWIVEL_GAP) : E[1] + FUSE) - geom.bar / 2;
  const elements = pipLayout(geom, count, p.pipRoot, topY);
  return { geom, levels, count, x: E[0], elements, connThick: Math.min(PIP_CONNECTOR_THICK, T), separate: false };
}

/** Where the connector ring (or the charm) hangs: the terminal element's hole-bottom. */
function pipCarry(plan: PipPlan): Pt {
  return [plan.x, plan.elements[plan.count]!.holeBottomY];
}

/** Element `k` of the chain as a solid in the hook's frame. 0 is the loop. */
function pipLinkSolid(wasm: any, plan: PipPlan, k: number, edge: EdgeSpec, keep: Keep): any {
  const e = plan.elements[k]!;
  const m = pipMesh(e.outline, plan.levels, e.features, plan.geom.ramp, edge);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices });
  mesh.merge();
  const solid = keep(wasm.Manifold.ofMesh(mesh));
  if (solid.isEmpty()) throw new Error(`print-in-place element ${k} did not make a solid`);
  return keep(solid.translate([plan.x, e.cy, 0]));
}

// --- The parts ------------------------------------------------------------------------------

interface HookOut {
  parts: PartMesh[];
  marks: number;
  ring: Ring;
  /** Where the chain's first element rests, in the hook's frame: the bottom of the loop's
   *  hole, the bottom of the swivel ring's hole, or the bottom of the hook's own hole when
   *  there is no loop at all. Null when the charm itself is captive. */
  carry: Pt | null;
  iconCentre: Pt | null;
}

type Attach = BuildParams['attach'];

function buildHook(wasm: any, p: BuildParams, attach: Attach, captiveCharm: boolean, sw: Swivel | null, pip: PipPlan | null, warn: (s: string) => void, keep: Keep): HookOut {
  const { Manifold } = wasm;
  const T = p.hookThick;
  const ring = orient(p.hookGeom, p.hookGeom.eye, [0, -1], p.hookSize);
  const outline = cs(wasm, [ring], keep);
  const bar = Math.min(p.hookBar, p.hookSize * 0.45);
  const b = band(wasm, outline, bar, keep);
  if (b.solid) warn('The hook bar is too wide for its size — the hook came out solid.');
  let body = b.cs;

  const fe = frameAt(ring, p.hookGeom.eye);
  const E: Pt = [fe.p[0], fe.p[1]];
  const down: Pt = [0, -1];
  // The gate goes on the outline as it HANGS: left side, mid-height, on the straightest run
  // there, clear of corners for the width of the cut. The shape library guessed it on the
  // shape as authored, and a star or a cross turned to hang from a tip took its gate round
  // to the right arm, into a corner. An SVG's own marker is kept.
  const gateT = p.hookGeom.gateFixed ? p.hookGeom.gate : hookGateT(ring, bar + 4);

  // The gusset: fill the shape's own interior round the eye, so a loop hung off a heart's
  // point or a star's valley is hung off a solid corner, not off two thin arms meeting. With
  // no loop the chain threads the hook's own hole there, so the corner stays open.
  // Only where the eye sits in a corner. On an oval or a circle the band is already as
  // strong as it gets, and the fill was a visible shelf inside the hole for nothing.
  const gussetR = bar * 1.2 + 1.5;
  const gateNearEye = tDistance(ring, gateT, p.hookGeom.eye) < gussetR + 2;
  const eyeInCorner = turnNear(ring, p.hookGeom.eye, bar + 1) > Math.PI / 4;
  if (!b.solid && !gateNearEye && attach !== 'none' && eyeInCorner) {
    const gusset = keep(keep(wasm.CrossSection.circle(gussetR, SEG).translate(E)).intersect(outline));
    body = keep(body.add(gusset));
  }

  // The gate: three strokes, in / across / in, so the two halves key into each other. A
  // solid hook gets no gate: a cut into a disc is a notch, and it would only split the disc.
  const gap = GATE_GAP_MM[p.gateFit];
  const fg = frameAt(ring, gateT);
  const jog = Math.min(3.5, Math.max(1.2, bar * 0.7));
  const A = add(fg.p, fg.n, 0.8);
  const B = add(fg.p, fg.n, -bar * 0.36);
  const C = add(add(B, fg.u, jog), fg.n, -bar * 0.28);
  const D = add(add(fg.p, fg.n, -(bar + 1.5)), fg.u, jog);
  const gate = b.solid ? null : keep(strip(wasm, [A, B, C, D], gap, keep).intersect(b.cutRegion));
  if (gate) body = keep(body.subtract(gate));

  // The icon: a filled glyph inlaid on the band, its own part so it can be its own colour.
  // The hook and the icon are bevelled as ONE body and split by colour afterwards, so the
  // edge runs seamlessly across both — bevelled separately, the icon sat on the band like a
  // chunky sticker with a groove round it. The gate is cut out of it as well — an icon
  // dropped on the gate must not weld it shut.
  let iconCS: any = null;
  let iconZone = { x: 0, y: 0, r: 0 };
  if (p.iconContours.length && p.iconSize > 0) {
    const t = tAtAngle(ring, p.iconAngle);
    const P = frameAt(ring, t).p;
    const rad = radialAt(ring, t);
    const fit = fitContours(p.iconContours, p.iconSize);
    const centre = add(P, rad, p.iconOffset);
    const rings = fit.rings.map((poly) => poly.map(([x, y]) => add(centre, rot([x, y], p.iconRotate)) as Pt));
    // Fully filled: a glyph's counters would be band-coloured islands in a one-colour print
    // and floating ones in a two-colour one.
    let icon = fillHoles(wasm, cs(wasm, rings, keep), keep);
    if (gate) icon = keep(icon.subtract(gate));
    const overlap = keep(icon.intersect(body)).area();
    if (overlap < icon.area() * 0.12) warn('The icon barely touches the hook — drag it onto the band.');
    iconCS = icon;
    body = keep(body.add(icon));
    iconZone = { x: centre[0], y: centre[1], r: Math.max(fit.w, fit.h) / 2 };
  }

  // The loop or the swivel housing, straight below the shape.
  let carry: Pt | null = null;
  let solid: any;
  if (attach === 'none') {
    // The chain's first ring goes through the hook's own hole at the eye: it rests on the
    // band there, so the carry point is the hole's bottom on the centre line.
    const wall = b.solid ? bar : wallThickness(E, [0, 1], b.inner.toPolygons() as number[][][]);
    carry = [E[0], E[1] + (Number.isFinite(wall) ? wall : bar)];
    solid = edgeExtrude(body, T, keep, edgeOf(p));
  } else if (attach === 'loop' || !sw) {
    if (pip) {
      // The loop IS the chain's first link: full height where it fuses into the band, twisted
      // at its far end so the next link is already through it.
      solid = edgeExtrude(body, T, keep, edgeOf(p));
      solid = keep(solid.add(pipLinkSolid(wasm, pip, 0, edgeOf(p), keep)));
      carry = pipCarry(pip);
    } else {
      const r = hookLoopId(p) / 2;
      const c = add(E, down, r + p.loopBar - FUSE);
      body = keep(body.add(keep(ringCS(wasm, r, p.loopBar, keep).translate(c))));
      carry = [c[0], c[1] - r];
      solid = edgeExtrude(body, T, keep, edgeOf(p));
    }
  } else {
    const housing = keep(roundedRect(wasm, sw.housingW, sw.housingL, 2.5, keep).translate(add(E, down, sw.housingL / 2 - FUSE)));
    body = keep(body.add(housing));
    // The window goes straight through, so it is part of the section and its edges round.
    const window = keep(roundedRect(wasm, sw.windowW, sw.windowLen, 0.8, keep).translate(add(E, down, SW_WALL + sw.windowLen / 2)));
    body = keep(body.subtract(window));
    solid = edgeExtrude(body, T, keep, edgeOf(p));
    // The tunnel: out through the floor, along the hang axis.
    const tunnelFrom = add(E, down, SW_WALL + sw.windowLen - 0.2);
    const tunnelTo = add(E, down, sw.housingL - FUSE + 1);
    solid = keep(solid.subtract(cylinderAlong(wasm, tunnelFrom, tunnelTo, T / 2, sw.tunnelR, keep)));
    if (pip) {
      carry = pipCarry(pip);
    } else if (!captiveCharm) {
      const captiveTop = add(E, down, sw.housingL - FUSE + SW_GAP);
      const ringCentre = add(captiveTop, down, hookLoopId(p) / 2 + p.loopBar);
      carry = [ringCentre[0], ringCentre[1] - hookLoopId(p) / 2];
    }
  }

  // Provenance voids, buried in the band. Each one is checked to be fully inside before it
  // is cut: a void that breaks a surface is worse than no void at all.
  let marks = 0;
  const voids = identityVoids({ ring, bar, thick: T, gateT, eyeT: p.hookGeom.eye, icon: iconZone });
  for (const v of voids) {
    const sphere = keep(Manifold.sphere(v.d / 2, 12).translate([v.x, v.y, v.z]));
    const inter = keep(solid.intersect(sphere));
    if (inter.volume() >= sphere.volume() * 0.98) {
      solid = keep(solid.subtract(sphere));
      marks += 1;
    }
  }

  const parts: PartMesh[] = [];
  if (iconCS && !iconCS.isEmpty()) {
    // Split the bevelled body along the icon's outline: a straight vertical cut, so the two
    // colours meet on a plane and the bevel is continuous across it.
    const prism = keep(iconCS.extrude(T + 2).translate([0, 0, -1]));
    parts.push(meshOf(keep(solid.subtract(prism)), 'Hook', p.hookColor));
    let symbol = keep(solid.intersect(prism));
    // Raised: the same outline continues above the face, with the small bevel a raised part
    // gets. Still one part, so it is one colour and one object in the slicer.
    const raise = Math.max(0, Math.min(4, p.iconRaise));
    if (raise >= 0.2) symbol = keep(symbol.add(keep(edgeExtrude(iconCS, raise, keep, raiseEdge(p)).translate([0, 0, T - 0.01]))));
    parts.push(meshOf(symbol, 'Symbol', p.iconColor));
  } else {
    parts.push(meshOf(solid, 'Hook', p.hookColor));
  }
  return { parts, marks, ring, carry, iconCentre: iconZone.r > 0 ? ([iconZone.x, iconZone.y] as Pt) : null };
}

/** The piece the swivel holds: barrel in the window, stem through the tunnel, and below the
 *  housing either the charm itself or a plain ring. Built in the hook's frame. */
function buildCaptive(wasm: any, p: BuildParams, sw: Swivel, captiveCharm: boolean, hookRing: Ring, pip: PipPlan | null, warn: (s: string) => void, keep: Keep): PartMesh[] {
  const { Manifold } = wasm;
  const T = p.hookThick;
  const fe = frameAt(hookRing, p.hookGeom.eye);
  const E: Pt = [fe.p[0], fe.p[1]];
  const down: Pt = [0, -1];
  const windowTop = add(E, down, SW_WALL);
  const barrelFrom = add(windowTop, down, SW_GAP);
  const barrelTo = add(barrelFrom, down, sw.barrelLen);
  const housingBottom = add(E, down, sw.housingL - FUSE);
  const captiveTop = add(housingBottom, down, SW_GAP);

  const parts: PartMesh[] = [];
  let bodyCS: any = null;
  let engrave: any = null;
  let color: [number, number, number];
  let name: string;
  /** The print-in-place loop arrives as a solid of its own, not a section. */
  let pipSolid: any = null;
  if (pip && !captiveCharm) {
    pipSolid = pipLinkSolid(wasm, pip, 0, edgeOf(p), keep);
    color = p.hookColor;
    name = 'Swivel ring';
  } else if (captiveCharm) {
    const charm = charmSection(wasm, p, warn, keep);
    const shift: Pt = [captiveTop[0] - charm.top[0], captiveTop[1] - charm.top[1]];
    bodyCS = keep(charm.cs.translate(shift));
    color = p.charmColor;
    name = 'Charm';
    if (charm.raise) {
      const raised = keep(charm.raise.translate(shift));
      parts.push(meshOf(keep(edgeExtrude(raised, RAISE_H, keep, raiseEdge(p)).translate([0, 0, T - 0.01])), 'Charm symbol', p.iconColor));
    }
    if (charm.engrave) engrave = keep(charm.engrave.translate(shift));
  } else {
    const r = hookLoopId(p) / 2;
    bodyCS = keep(ringCS(wasm, r, p.loopBar, keep).translate(add(captiveTop, down, r + p.loopBar)));
    color = p.hookColor;
    name = 'Swivel ring';
  }

  // The captive body is as thick as the hook: the stem sits at the hook's mid-height and the
  // barrel is sized from the same thickness.
  let solid = pipSolid ?? edgeExtrude(bodyCS, T, keep, edgeOf(p));
  if (engrave) solid = keep(solid.subtract(keep(engrave.extrude(ENGRAVE_MAX + 1).translate([0, 0, T - Math.min(ENGRAVE_MAX, T * 0.3)]))));
  const stemTo = add(captiveTop, down, FUSE);
  solid = keep(solid.add(cylinderAlong(wasm, barrelFrom, stemTo, T / 2, sw.stemR, keep)));
  // The barrel: a cylinder along the hang axis, flattened so it sits on the bed and clears the top.
  let barrel = cylinderAlong(wasm, barrelFrom, barrelTo, T / 2, sw.barrelR, keep);
  const clip = keep(Manifold.cube([sw.barrelR * 4, sw.barrelLen + 2, T - SW_BARREL_TOP_CLEAR], false)
    .translate([E[0] - sw.barrelR * 2, barrelTo[1] - 1, 0]));
  barrel = keep(barrel.intersect(clip));
  solid = keep(solid.add(barrel));
  parts.unshift(meshOf(solid, name, color));
  return parts;
}

interface CharmSection {
  cs: any;
  top: Pt;
  /** Icon to stand proud, in the charm's frame. */
  raise: any | null;
  /** Icon to sink into the face, in the charm's frame. */
  engrave: any | null;
}

/** The charm's section, top pointing +Y, with its top point reported so a caller can hang it. */
function charmSection(wasm: any, p: BuildParams, warn: (s: string) => void, keep: Keep): CharmSection {
  const ring = orient(p.charmGeom, p.charmGeom.top, [0, 1], p.charmSize);
  const outline = cs(wasm, [ring], keep);
  let body = outline;
  let raise: any = null;
  let engrave: any = null;
  const frame = p.charmFill === 'frame';
  if (frame) {
    const b = band(wasm, outline, Math.min(p.charmBar, p.charmSize * 0.45), keep);
    if (b.solid) warn('The charm bar is too wide for its size — the charm came out solid.');
    body = b.cs;
  }
  if (!frame && p.charmIconContours.length && p.charmIconSize > 0) {
    // Keep a wall round the icon: shrink it until it sits inside the outline inset by that
    // wall, rather than trimming it to a fragment.
    const inner = keep(outline.offset(-1.6, 'Round', 2.0, 16));
    const wanted = Math.min(p.charmIconSize, p.charmSize * 0.8);
    let size = wanted;
    let icon: any = null;
    for (let i = 0; i < 8; i++) {
      const fit = fitContours(p.charmIconContours, size);
      const candidate = cs(wasm, fit.rings, keep);
      const inside = keep(candidate.intersect(inner)).area();
      if (inside >= candidate.area() * 0.995) { icon = candidate; break; }
      size *= 0.88;
    }
    if (!icon) warn('The charm is too small for its icon at this size — no icon was made.');
    else {
      if (size < wanted - 0.01) warn('The charm icon was shrunk to keep a wall round it.');
      if (p.charmIconStyle === 'cut') body = keep(body.subtract(fillHoles(wasm, icon, keep)));
      else if (p.charmIconStyle === 'engrave') engrave = icon;
      else raise = icon;
    }
  }
  const ft = frameAt(ring, p.charmGeom.top);
  return { cs: body, top: [ft.p[0], ft.p[1]], raise, engrave };
}

interface CharmOut {
  parts: PartMesh[];
  /** The loop's centre, in the charm's own frame. */
  eye: Pt;
}

function buildCharm(wasm: any, p: BuildParams, lastThick: number, warn: (s: string) => void, keep: Keep): CharmOut {
  const T = p.charmThick;
  const { cs: body, top, raise, engrave } = charmSection(wasm, p, warn, keep);
  const r = charmLoopId(p, lastThick) / 2;
  const c = add(top, [0, 1], r + p.loopBar - FUSE);
  const withLoop = keep(body.add(keep(ringCS(wasm, r, p.loopBar, keep).translate(c))));
  let solid = edgeExtrude(withLoop, T, keep, edgeOf(p));
  if (engrave) solid = keep(solid.subtract(keep(engrave.extrude(ENGRAVE_MAX + 1).translate([0, 0, T - Math.min(ENGRAVE_MAX, T * 0.3)]))));
  const parts = [meshOf(solid, 'Charm', p.charmColor)];
  if (raise) parts.push(meshOf(keep(edgeExtrude(raise, RAISE_H, keep, raiseEdge(p)).translate([0, 0, T - 0.01])), 'Charm symbol', p.iconColor));
  return { parts, eye: c };
}

/** A link or a connector: a band with one slit, leaning 25° off square so the closed link
 *  cannot pull straight open. Centred on the origin. */
function splitRing(wasm: any, ring: Ring, bar: number, thick: number, name: string, color: [number, number, number], edge: EdgeSpec, warn: (s: string) => void, keep: Keep): { part: PartMesh; hole: HoleBox | null; ring: Ring; holePolys: number[][][] } {
  const outline = cs(wasm, [ring], keep);
  const b = band(wasm, outline, bar, keep);
  if (b.solid) warn(`The ${name.toLowerCase()} bar is too wide for its size — it came out solid.`);
  let body = b.cs;
  const holePolys = b.solid ? [] : (b.inner.toPolygons() as number[][][]);
  if (!b.solid) {
    // The slit goes straight across the band on its straightest convex run — a heart's lower
    // flank, a star's arm flank, anywhere on a circle. That only works where the band IS a
    // band: on a small star the hole is a pentagon in the middle and the arms are solid, and
    // a cut across an arm would sever its tip. There the slit falls back to the thinnest
    // wall between the hole and the edge, and the link is reported as too small to be one.
    // A shape with recesses — a star, a flower — is cut AT a recess, straight in toward the
    // centre: that is where the band is a band and where a cut looks meant. Ian's call. A
    // heart has one recess, its cleft, and keeps the flank cut.
    const recess = recessCut(ring);
    const fg = recess ?? frameAt(ring, bestCutT(ring, bar + 3));
    const width = wallThickness(fg.p, [-fg.n[0], -fg.n[1]], holePolys);
    if (width <= bar * 1.6 + 0.3) {
      const A = add(fg.p, fg.n, 1.2);
      const B = add(fg.p, fg.n, -(width + 0.8));
      body = keep(body.subtract(keep(strip(wasm, [A, B], 0.5, keep).intersect(b.cutRegion))));
    } else {
      warn(`The ${name.toLowerCase()} is too small for its shape — the bar swallows the hole. Make it bigger or the bar thinner.`);
      const [outer, hole] = thinnestCut(ring, holePolys);
      const dir: Pt = [outer[0] - hole[0], outer[1] - hole[1]];
      const len = Math.hypot(dir[0], dir[1]) || 1;
      const u: Pt = [dir[0] / len, dir[1] / len];
      const A = add(outer, u, 1.2);
      const B = add(hole, u, -0.8);
      body = keep(body.subtract(keep(strip(wasm, [A, B], 0.5, keep).intersect(b.cutRegion))));
    }
  }
  // The hole's extent, for the assembled view to thread the next element through.
  let hole: HoleBox | null = null;
  if (holePolys.length) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of holePolys) for (const [x, y] of poly) {
      if (x! < minX) minX = x!;
      if (x! > maxX) maxX = x!;
      if (y! < minY) minY = y!;
      if (y! > maxY) maxY = y!;
    }
    hole = { minX, maxX, minY, maxY };
  }
  return { part: meshOf(edgeExtrude(body, thick, keep, edge), name, color), hole, ring, holePolys };
}

/** How far from the origin, along `dir`, the polygons are last crossed — the extent of the
 *  shape along that line through its centre. Null when the line misses. */
function spanAt(polys: (Ring | number[][])[], dir: Pt): number | null {
  let best: number | null = null;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const ex = b[0]! - a[0]!, ey = b[1]! - a[1]!;
      const den = dir[0] * ey - dir[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a[0]!, wy = a[1]!;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dir[1] - wy * dir[0]) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && (best === null || t > best)) best = t;
    }
  }
  return best;
}

interface HoleBox {
  minX: number; maxX: number; minY: number; maxY: number;
}

/**
 * The recess to cut at, for outlines with at least two of them: the concave corner nearest
 * the left, with the cut aimed at the centroid so it runs down the middle of the notch. Null
 * for outlines with fewer than two recesses (a heart's single cleft is not a cut).
 */
export function recessCut(ring: Ring): { p: Pt; n: Pt } | null {
  const n = ring.length;
  const c = centroid(ring);
  // Signed turn at every vertex; negative is concave on a counter-clockwise ring.
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!, q = ring[i]!, b = ring[(i + 1) % n]!;
    const a1 = Math.atan2(q[1] - a[1], q[0] - a[0]);
    const a2 = Math.atan2(b[1] - q[1], b[0] - q[0]);
    let d = a2 - a1;
    turn.push(Math.atan2(Math.sin(d), Math.cos(d)));
  }
  // A filleted notch is a RUN of small concave turns, none of which is a notch on its own —
  // a star's valleys turn about 7° per vertex over nine vertices. So gather each run of
  // concave turns, keep the ones that add up to a real notch, and take the run's middle.
  const start = turn.findIndex((t) => t >= 0);
  if (start < 0) return null;
  const recesses: { p: Pt; score: number }[] = [];
  let runFrom = -1, runSum = 0;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (turn[i]! < 0) {
      if (runFrom < 0) { runFrom = k; runSum = 0; }
      runSum += turn[i]!;
    } else if (runFrom >= 0) {
      if (runSum <= -0.5) {
        const mid = ring[(start + Math.round((runFrom + k - 1) / 2)) % n]!;
        let ang = Math.atan2(mid[1] - c[1], mid[0] - c[0]) - Math.PI;
        ang = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
        recesses.push({ p: mid, score: ang });
      }
      runFrom = -1;
    }
  }
  if (recesses.length < 2) return null;
  const best = recesses.reduce((m, r) => (r.score < m.score ? r : m));
  const dx = c[0] - best.p[0], dy = c[1] - best.p[1];
  const len = Math.hypot(dx, dy) || 1;
  // Outward normal, the way frameAt reports it: away from the centroid.
  return { p: best.p, n: [-dx / len, -dy / len] };
}

/** Distance from 'from' along 'dir' to the first hole boundary it meets. Infinity = solid. */
function wallThickness(from: Pt, dir: Pt, holes: number[][][]): number {
  let best = Infinity;
  for (const poly of holes) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const ex = b[0]! - a[0]!, ey = b[1]! - a[1]!;
      const den = dir[0] * ey - dir[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a[0]! - from[0], wy = a[1]! - from[1];
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dir[1] - wy * dir[0]) / den;
      if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
    }
  }
  return best;
}

// --- The set --------------------------------------------------------------------------------

/** One thing in the chain, for the assembled view. */
interface ChainElement {
  parts: PartMesh[];
  /** Extent along the hang axis and across it, in its own frame. */
  h: number;
  w: number;
  thick: number;
  /** Where it hangs BY and where the next one hangs FROM, in its own frame: the top and the
   *  bottom of its HOLE on the centre line. In a hanging chain the lower link's hole-top rests
   *  on the upper link's hole-bottom — the two holes touch and the bars sit side by side.
   *  Lining the BARS up on one point, as the first version did, puts one bar straight through
   *  the other. */
  holeTop: number;
  holeBottom: number;
  /** The narrowest opening of its hole, for the "can the next one pass" check. */
  holeMin: number;
}

export function buildSet(wasm: any, p: BuildParams): BuildResult {
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };

  return withScope((keep) => {
    // Swivel feasibility is decided once, from the hook's thickness — the captive piece is
    // built as thick as the hook whatever the charm slider says.
    let attach = p.attach;
    let sw: Swivel | null = null;
    if (attach === 'swivel') {
      sw = swivelFor(p.hookThick, p.swivelStem);
      if (!sw) {
        warn(`The swivel needs the hook at least ${SWIVEL_MIN_THICK} mm thick — printed with a plain loop instead.`);
        attach = 'loop';
      } else if (sw.stemClamped) {
        warn(`A ${p.swivelStem} mm stem needs a hook ${Math.ceil((p.swivelStem / 2 + SW_GAP + SW_SKIN) * 2 * 2) / 2} mm thick — it was thinned to ${(sw.stemR * 2).toFixed(1)} mm to fit this one.`);
      }
    }
    // The charm rides the swivel's stem only when there is a charm and a swivel to ride.
    const captiveCharm = p.charm && p.charmMount === 'swivel' && attach === 'swivel';

    // The print-in-place chain has no "nothing" attachment — its first link has to be grown
    // from something — and no chain at all when the charm rides the swivel.
    let pip: PipPlan | null = null;
    if (p.mode === 'pip' && !captiveCharm) {
      if (attach === 'none' && p.pipAttached) attach = 'loop';
      const ringForEye = orient(p.hookGeom, p.hookGeom.eye, [0, -1], p.hookSize);
      const fe = frameAt(ringForEye, p.hookGeom.eye);
      pip = pipPlanFor(p, attach, [fe.p[0], fe.p[1]], sw, warn);
    }
    // A chain printed as its own part leaves the hook exactly as the open chain does.
    const grown = pip && !pip.separate ? pip : null;

    const hook = buildHook(wasm, p, attach, captiveCharm, sw, grown, warn, keep);
    const hookGroup = [...hook.parts];
    if (attach === 'swivel' && sw) hookGroup.push(...buildCaptive(wasm, p, sw, captiveCharm, hook.ring, grown, warn, keep));

    // The print-in-place links, already through one another, in the hook's frame. They are
    // printed as part of the hook's group and hang in the assembled view exactly as printed;
    // the connector ring(s) and the charm are the only things that hang loose.
    const pipLinks: { part: number; top: Pt; bottom: Pt }[] = [];
    if (grown) {
      const pip = grown;
      for (let k = 1; k <= pip.count; k++) {
        const e = pip.elements[k]!;
        hookGroup.push(meshOf(pipLinkSolid(wasm, pip, k, edgeOf(p), keep), `Link ${k}`, p.linkColor));
        pipLinks.push({
          part: hookGroup.length - 1,
          // It turns about the lens it shares with the element above — midway between that
          // one's far tip and its own near tip; the next one turns about the lens below. The
          // terminal link hands over at its hole-bottom instead.
          top: [pip.x, e.nearY - pip.geom.step / 2],
          bottom: k < pip.count ? [pip.x, e.farY + pip.geom.step / 2] : pipCarry(pip),
        });
      }
    }

    // The chain, top to bottom: connector, links, connector. None at all when the charm hangs
    // straight off the swivel. With the print-in-place chain only the far connector(s) remain.
    const chain: ChainElement[] = [];
    if (!captiveCharm) {
      const connectors = pip ? Math.max(0, Math.min(2, Math.round(p.pipConnectorRings))) : Math.max(0, Math.min(4, Math.round(p.connectorRings)));
      const linkCount = pip ? 0 : Math.max(0, Math.min(24, Math.round(p.linkCount)));
      const connThick = pip ? pip.connThick : p.linkThick;
      const cBar = Math.min(pip ? pip.geom.bar : p.linkBar, connectorId(p, pip ? pip.levels.H : 0) * 0.45 + 1);
      const circle: Ring = [];
      for (let i = 0; i < 48; i++) circle.push([Math.cos((Math.PI * 2 * i) / 48), Math.sin((Math.PI * 2 * i) / 48)]);
      const connOuter = connectorId(p, pip ? pip.levels.H : 0) / 2 + cBar;
      const connRing = scaleRing(circle, connOuter);
      const linkRing = scaleRing(p.linkGeom.ring, p.linkSize);
      const linkBar = Math.min(p.linkBar, p.linkSize * 0.45);
      let connector: ReturnType<typeof splitRing> | null = null;
      let link: ReturnType<typeof splitRing> | null = null;
      const elementOf = (proto: { part: PartMesh; hole: HoleBox | null; ring: Ring; holePolys: number[][][] }, name: string, thick: number): ChainElement => {
        const b = bboxOf([proto.part]);
        const hole = proto.hole ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        // Where the outline and the hole cross the centre line, top and bottom. The bar the
        // element hangs by is centred between the two on that line — a heart's centre-line
        // top is its cleft, not its lobes, and the bbox would put the bar in the solid notch.
        const outerTop = spanAt([proto.ring], [0, 1]) ?? b.maxY;
        const outerBottom = -(spanAt([proto.ring], [0, -1]) ?? -b.minY);
        const holeTop = spanAt(proto.holePolys, [0, 1]) ?? hole.maxY;
        const holeBottom = -(spanAt(proto.holePolys, [0, -1]) ?? -hole.minY);
        void outerTop;
        void outerBottom;
        return {
          parts: [clonePart(proto.part, name)],
          h: b.maxY - b.minY,
          w: b.maxX - b.minX,
          thick,
          holeTop,
          holeBottom,
          holeMin: Math.min(hole.maxX - hole.minX, hole.maxY - hole.minY),
        };
      };
      const pushConnector = (i: number) => {
        connector ??= splitRing(wasm, connRing, cBar, connThick, 'Connector', p.linkColor, edgeOf(p), warn, keep);
        chain.push(elementOf(connector, `Connector ${i}`, connThick));
      };
      // A print-in-place chain printed apart always has a ring at its top: that is the join.
      if (pip?.separate || (connectors >= 1 && !pip)) pushConnector(1);
      for (let i = 0; i < linkCount; i++) {
        link ??= splitRing(wasm, linkRing, linkBar, p.linkThick, 'Link', p.linkColor, edgeOf(p), warn, keep);
        chain.push(elementOf(link, `Link ${i + 1}`, p.linkThick));
      }
      if (pip?.separate) {
        // The whole interlocked chain is ONE element of the hanging chain: it hangs by the first
        // link's hole and hands over at the last link's, and it is rigid in the preview.
        const parts = pip.elements.map((e, k) => meshOf(pipLinkSolid(wasm, pip, k, edgeOf(p), keep), `Link ${k + 1}`, p.linkColor));
        const b = bboxOf(parts);
        const first = pip.elements[0]!, last = pip.elements[pip.elements.length - 1]!;
        const innerW = 2 * Math.max(...pip.geom.link.poly.map((q) => q[0])) - pip.geom.bar;
        chain.push({
          parts, h: b.maxY - b.minY, w: b.maxX - b.minX, thick: pip.levels.H,
          holeTop: first.nearY - first.outline.holeDepth, holeBottom: last.holeBottomY, holeMin: innerW,
        });
      }
      // Every element must be able to pass its neighbour's bar: the hole's narrowest opening
      // against the neighbour's thickness, with a little room.
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i]!, c = chain[i + 1]!;
        if (a.holeMin < c.thick + 0.2 || c.holeMin < a.thick + 0.2) {
          warn('A chain part cannot pass through its neighbour — make the links bigger or the bar thinner.');
          break;
        }
      }
      for (let i = pip && !pip.separate ? 1 : 2; i <= connectors + (pip?.separate ? 1 : 0); i++) pushConnector(i);
    }

    // What the charm's loop has to pass: the last loose chain element, or with a print-in-place
    // chain and no connector, the terminal link — as thick as the hook.
    const lastThick = chain.length ? chain[chain.length - 1]!.thick : pip ? pip.levels.H : p.linkThick;
    const charm = p.charm && !captiveCharm ? buildCharm(wasm, p, lastThick, warn, keep) : null;

    // ---- PRINT layout: hook first, then the charm, then the chain — the order the set is
    // assembled in. Shelf-packed on the plate, then centred on the origin.
    const printGroups: PartMesh[][] = [hookGroup.map((q) => clonePart(q))];
    if (charm) printGroups.push(charm.parts.map((q) => clonePart(q)));
    for (const e of chain) printGroups.push(e.parts.map((q) => clonePart(q)));
    const boxes = printGroups.map((g) => bboxOf(g));
    const places = packShelf(boxes.map((b) => ({ w: b.maxX - b.minX, d: b.maxY - b.minY })), { plate: p.plate, margin: 6, gap: 4 });
    if (places.some((pl) => pl.plate > 0)) warn('The set does not fit on one plate at this size — shrink something or drop a few links.');
    const printOffset: [number, number] = [0, 0];
    printGroups.forEach((g, i) => {
      const b = boxes[i]!, at = places[i]!;
      translateParts(g, at.x - b.minX, at.y - b.minY);
      if (i === 0) { printOffset[0] = at.x - b.minX; printOffset[1] = at.y - b.minY; }
    });
    const parts = printGroups.flat();
    const all = bboxOf(parts);
    const cx = (all.minX + all.maxX) / 2, cy = (all.minY + all.maxY) / 2;
    translateParts(parts, -cx, -cy);
    printOffset[0] -= cx;
    printOffset[1] -= cy;

    // ---- ASSEMBLED layout: the chain hangs from the pivot, every element turned 90° to the
    // one before it, and the charm hangs off the last one.
    const asmHook = hookGroup.map((q) => clonePart(q));
    const assembled: PartMesh[] = [...asmHook];
    // What hangs where, in the flat assembled frame; turned into world coordinates below.
    const hangs: { parts: number[]; top: Pt; bottom: Pt }[] = [];
    let pivotFlat: Pt | null = hook.carry;
    // The print-in-place links are already in place — they were built hanging. They join the
    // dangle as elements so the preview can swing them; the loop (link 0) is the hook's.
    if (pipLinks.length) {
      pivotFlat = pipLinks[0]!.top;
      for (const l of pipLinks) hangs.push({ parts: [l.part], top: l.top, bottom: l.bottom });
    }
    if (hook.carry && (chain.length || charm)) {
      const px = hook.carry[0];
      // One axis plane for the whole chain: the hook's mid-thickness. A flat element is
      // centred on it and a turned one is turned about it, so a turned link's bar really does
      // pass through the flat link's hole in 3D — centred on its own width, as it was, the two
      // only met in the drawing.
      const zMid = p.hookThick / 2;
      // `carry` is where the next element hangs from: the bottom of the previous hole. The
      // first one hangs where the hook says — its loop's hole-bottom, the swivel ring's, or
      // the hook's own hole when there is no loop.
      let carry = hook.carry[1];
      let lastTurned = false; // the hook's loop lies flat
      chain.forEach((e, i) => {
        const turned = i % 2 === 0;
        const g = e.parts.map((q) => clonePart(q));
        // Its hole-top rests on the previous hole-bottom.
        const yc = carry - e.holeTop;
        if (turned) rotateAboutY(g, 90, 0, e.thick / 2);
        translateParts(g, px, yc, zMid - e.thick / 2);
        const first = assembled.length;
        assembled.push(...g);
        hangs.push({ parts: g.map((_, k) => first + k), top: [px, carry], bottom: [px, yc + e.holeBottom] });
        carry = yc + e.holeBottom;
        lastTurned = turned;
      });
      if (charm) {
        const g = charm.parts.map((q) => clonePart(q));
        const eye = charm.eye;
        const cb = bboxOf(g);
        if (!lastTurned) rotateAboutY(g, 90, eye[0], p.charmThick / 2);
        // The charm hangs by its loop: the loop's hole-top rests on the last hole-bottom.
        const dy = carry - (eye[1] + charmLoopId(p, lastThick) / 2);
        translateParts(g, px - eye[0], dy, zMid - p.charmThick / 2);
        const first = assembled.length;
        assembled.push(...g);
        hangs.push({ parts: g.map((_, k) => first + k), top: [px, carry], bottom: [px, dy + cb.minY] });
      }
    } else if (charm) {
      // No pivot to hang from (a solid hook, say): lay the charm beside the hook.
      const g = charm.parts.map((q) => clonePart(q));
      const hb = bboxOf(asmHook), cb = bboxOf(g);
      translateParts(g, hb.maxX + 6 - cb.minX, hb.minY - cb.minY, 0);
      assembled.push(...g);
    }
    // Stand it up: the set hangs, it does not lie on a plate. Print (x, y, z) → world
    // (x, −z, y): the hang axis becomes −Z, faces look along −Y, and the whole thing is
    // centred on X with its lowest point at z = 0.
    const ab = bboxOf(assembled);
    const acx = (ab.minX + ab.maxX) / 2;
    for (const q of assembled) {
      for (let i = 0; i < q.positions.length; i += 3) {
        const x = q.positions[i]!, y = q.positions[i + 1]!, z = q.positions[i + 2]!;
        q.positions[i] = x - acx;
        q.positions[i + 1] = -z;
        q.positions[i + 2] = y - ab.minY;
      }
    }

    const toWorld = (q: Pt): [number, number, number] => [q[0] - acx, -p.hookThick / 2, q[1] - ab.minY];
    const chainInfo: ChainInfo | null = pivotFlat && hangs.length
      ? { pivot: toWorld(pivotFlat), elements: hangs.map((h) => ({ parts: h.parts, top: toWorld(h.top), bottom: toWorld(h.bottom) })) }
      : null;

    return {
      parts,
      assembled,
      chain: chainInfo,
      hookFrame: { ring: hook.ring, thick: p.hookThick, iconCentre: hook.iconCentre, printOffset, assembledOffset: [-acx, -ab.minY] },
      warnings,
      size: [all.maxX - all.minX, all.maxY - all.minY, all.maxZ],
      marks: hook.marks,
    };
  });
}

// `centroid` is re-exported for the main thread's drag mapping via harnessEntry; keep the
// import live here so the module surface stays one place.
export { centroid };
