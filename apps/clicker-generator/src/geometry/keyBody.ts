// Letter-block bodies, generated from the layout instead of loaded from CAD.
//
// The blocks were six CAD shells, one per neighbour pattern, rotated into place so that two
// half-walls met at every joint. That shape of solution cannot make a 3×3 or a WASD cluster
// cleanly: the shells were 0.34 mm wider than deep, so a grid paired wide faces with narrow
// ones, and a wall with no neighbour stayed full, so two diagonal blocks ran their walls into
// each other's corner. It also had no way to leave the walls out, or to put anything on the
// outside.
//
// So the body is built here, in one piece, from the list of key cells:
//
//   - 'walls': one well per key and a wall between neighbours — the look the CAD shells had.
//   - 'open':  one well round every key at keyboard pitch, no wall between them.
//
// The outer wall can carry a texture. It is built as its own mesh (`skinMesh`): the outline is
// sampled by arc length and every sample is pushed out along its normal by the texture's
// height at that point, ring by ring up the wall. Chamfers come from the same push, inward,
// at the top and bottom. Every corner of the outline is rounded before this runs, and every
// push is smaller than the tightest corner radius, so the surface cannot fold over itself.
//
// Frame (shared with buildBlocks): Z = 0 is the plate plane — the switch latches there and it
// is the floor of the keycap well. Key (0, 0) sits wherever the layout puts it; the whole
// arrangement is centred on the origin.
import { csOf, extrude, ringsOf } from '@vostok/manifold';
import { ShapeUtils, Vector2 } from 'three';
import type { BlockStyle, BlockTexture } from '../types';

type Wasm = any;
type Solid = any;
type Section = any;
export type Ring = [number, number][];

/** One key on the layout grid. Row 0 is the top row, column 0 the left one. */
export interface KeyCell {
  row: number;
  col: number;
}

export type BodyStyle = BlockStyle;
export type BodyTexture = BlockTexture;

/**
 * Body dimensions, mm. The defaults are measured off the CAD block shells they replace, in
 * the assembly frame: 1.75 mm walls, a 7.9 mm deep keycap well whose floor is 0.27 mm above the
 * plate plane, an underside 9.73 mm below it, ~3 mm corners, a 1 mm top and a 2 mm bottom
 * chamfer. Only the well is square now (the shells were 0.34 mm wider than deep).
 */
export interface KeyBodyDims {
  /** The keycap's footprint, square. */
  cap: number;
  /** Gap between the cap and the wall, per side. */
  clearance: number;
  /** Outer wall, and the wall between two keys. */
  wall: number;
  /** Key spacing with no wall between keys — standard keyboard pitch. */
  openPitch: number;
  /** Top of the body (the rim) above the plate plane. */
  rimZ: number;
  /** Floor of the keycap well. The shells kept a little plate above the socket's top face. */
  floorZ: number;
  /** The underside, below the plate plane. */
  bottomZ: number;
  chamferTop: number;
  chamferBottom: number;
  /** Radius of the outer corners. */
  cornerR: number;
  /** Radius of the inside corners of the outline (a WASD cluster has four). */
  concaveR: number;
}

export const BODY_DIMS: KeyBodyDims = {
  cap: 18.14,
  clearance: 1.08,
  wall: 1.75,
  openPitch: 19.05,
  rimZ: 7.909,
  floorZ: 0.27,
  bottomZ: -9.73,
  chamferTop: 1.0,
  chamferBottom: 2.0,
  cornerR: 3.0,
  concaveR: 2.0,
};

/** Width of one key's well. */
export function wellSize(d: KeyBodyDims): number {
  return d.cap + 2 * d.clearance;
}

/** Centre-to-centre spacing of two neighbouring keys. */
export function keyPitch(style: BodyStyle, d: KeyBodyDims = BODY_DIMS): number {
  return style === 'open' ? d.openPitch : wellSize(d) + d.wall;
}

/** Where each cell's key sits, the arrangement centred on the origin. Rows run down (−Y). */
export function keyCentres(cells: KeyCell[], pitch: number): [number, number][] {
  if (!cells.length) return [];
  const rows = cells.map((c) => c.row);
  const cols = cells.map((c) => c.col);
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2;
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2;
  return cells.map((c) => [(c.col - midCol) * pitch, -(c.row - midRow) * pitch]);
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

interface TextureSpec {
  /** Nominal period, mm. Stretched so a whole number of periods goes round the outline. */
  period: number;
  /** Peak height, mm, pushed OUT from the wall: the wall is never thinned by a texture. */
  depth: number;
  /** Does the pattern change along the outline / up the wall? Decides the mesh density. */
  alongS: boolean;
  alongZ: boolean;
  /** Fade to nothing at the top and bottom of the band, for patterns that do not end flush. */
  fade: boolean;
  /** Height in [0, 1] at arc length `s` and height `z` above the band's foot, in periods. */
  height(s: number, z: number): number;
  /** Mesh samples per period. A pattern of planar facets needs few; a curved one more. */
  samples: number;
  /** A pattern with its own period up the wall (chevron); without one, a pattern that runs
   *  both ways keeps the period it has round the outline, so its cells stay square. */
  zPeriod?: number;
}

const frac = (t: number) => t - Math.floor(t);
/** 0 at whole numbers, 1 half way between. */
const tri = (t: number) => 1 - Math.abs(2 * frac(t) - 1);

/** A round bump of radius `r` (in periods) centred on 0, flat at its edge: raised cosine, so the
 *  steepest flank under the bump is ~50°, printable on a vertical wall. */
const bump = (d: number, r: number) => (d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r));

const TEXTURES: Record<Exclude<BodyTexture, 'smooth'>, TextureSpec> = {
  // Diamond knurl: two sets of 45° grooves crossing, leaving square pyramids. The flanks are
  // 27° off vertical, so the downward-facing ones print without support.
  knurl: {
    period: 2.4, depth: 0.6, alongS: true, alongZ: true, fade: false, samples: 4,
    height: (s, z) => Math.min(tri(s + z), tri(s - z)),
  },
  // Horizontal ribs, like a stack of rounded rings. A whole number of ribs fills the band, so
  // it starts and ends on a groove and meets both chamfers flush. Raised cosine: steepest flank
  // ~50° over a 0.2 mm layer, printable.
  ribs: {
    period: 2.0, depth: 0.75, alongS: false, alongZ: true, fade: false, samples: 6,
    height: (_s, z) => 0.5 - 0.5 * Math.cos(2 * Math.PI * z),
  },
  // Vertical flutes round the outline. Vertical, so the profile can be as round as it likes.
  flutes: {
    period: 2.6, depth: 0.6, alongS: true, alongZ: false, fade: false, samples: 8,
    height: (s) => Math.sqrt(Math.max(0, 1 - (2 * frac(s) - 1) ** 2)),
  },
  // Round dots on a staggered grid: one at every corner of a period cell and one in its middle.
  dots: {
    period: 2.4, depth: 0.55, alongS: true, alongZ: true, fade: true, samples: 6,
    height: (s, z) => {
      const fs = frac(s);
      const fz = frac(z);
      const corner = Math.hypot(Math.min(fs, 1 - fs), Math.min(fz, 1 - fz));
      const middle = Math.hypot(fs - 0.5, fz - 0.5);
      return Math.max(bump(corner, 0.3), bump(middle, 0.3));
    },
  },
  // Chevron: ribs that zig-zag round the outline. The ribs' raised-cosine profile, shifted up
  // and down the wall by a triangle wave along it.
  chevron: {
    period: 4.0, depth: 0.7, alongS: true, alongZ: true, fade: true, samples: 8, zPeriod: 2.2,
    height: (s, z) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (z + 0.5 * tri(s))),
  },
};

// ---------------------------------------------------------------------------------------------
// The outer wall
// ---------------------------------------------------------------------------------------------

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/** `n` points evenly spaced by arc length round a closed ring, starting at its first vertex. */
function resample(ring: Ring, n: number): { pts: Ring; length: number } {
  const m = ring.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = cum[m];
  const pts: Ring = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * length;
    while (seg < m - 1 && cum[seg + 1] < s) seg++;
    const a = ring[seg];
    const b = ring[(seg + 1) % m];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = (s - cum[seg]) / segLen;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts, length };
}

/**
 * Triangulate a simple closed ring using EVERY one of its vertices.
 *
 * Earcut drops a vertex that sits exactly on the line between its neighbours — and a straight
 * run of outline is exactly that — so the face it returns would not share those vertices with
 * the wall beside it, and the solid would not close. So the straight runs are triangulated
 * without their middle points, and each run's points are then fanned back into the one
 * triangle that holds that edge.
 */
function triangulateRing(n: number, xy: (j: number) => [number, number]): [number, number, number][] {
  const collinear = (a: number, b: number, c: number) => {
    const [ax, ay] = xy(a), [bx, by] = xy(b), [cx, cy] = xy(c);
    return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) <= 1e-9 * (1 + Math.abs(ax) + Math.abs(ay));
  };
  const kept: number[] = [];
  for (let j = 0; j < n; j++) if (!collinear((j - 1 + n) % n, j, (j + 1) % n)) kept.push(j);
  if (kept.length < 3) return [];
  const contour = kept.map((j) => new Vector2(...xy(j)));
  const faces = ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => [kept[a], kept[b], kept[c]] as [number, number, number]);
  // Every kept vertex must have survived Earcut, or this is not the face we need.
  const used = new Set(faces.flat());
  if (kept.some((j) => !used.has(j))) throw new Error('Body face did not triangulate.');

  for (let i = 0; i < kept.length; i++) {
    const a = kept[i];
    const b = kept[(i + 1) % kept.length];
    const between: number[] = [];
    for (let j = (a + 1) % n; j !== b; j = (j + 1) % n) between.push(j);
    if (!between.length) continue;
    const t = faces.findIndex((f) => f.includes(a) && f.includes(b));
    if (t < 0) throw new Error('Body face lost an edge.');
    const [f0, f1, f2] = faces[t];
    const other = [f0, f1, f2].find((v) => v !== a && v !== b)!;
    // Keep the triangle's own winding: walk the edge in the direction the triangle walks it.
    const forward = (f0 === a && f1 === b) || (f1 === a && f2 === b) || (f2 === a && f0 === b);
    const chain = forward ? [a, ...between, b] : [b, ...between.reverse(), a];
    const fan: [number, number, number][] = [];
    for (let q = 0; q < chain.length - 1; q++) fan.push([chain[q], chain[q + 1], other]);
    faces.splice(t, 1, ...fan);
  }
  return faces;
}

export interface SkinOptions {
  bottomZ: number;
  rimZ: number;
  chamferTop: number;
  chamferBottom: number;
  texture: BodyTexture;
}

/**
 * The closed outer wall of one body outline as a triangle mesh: textured sides, chamfered top
 * and bottom edges, flat top and bottom faces. `ring` must be counter-clockwise, with every
 * corner rounded to a radius larger than the texture depth and the bottom chamfer.
 */
export function skinMesh(ring: Ring, o: SkinOptions): { vert: Float32Array; tri: Uint32Array } {
  const spec = o.texture === 'smooth' ? null : TEXTURES[o.texture];
  const z0 = o.bottomZ;
  const z1 = o.rimZ;
  const bandLo = z0 + o.chamferBottom;
  const bandHi = z1 - o.chamferTop;
  const band = Math.max(0.01, bandHi - bandLo);

  // Samples round the outline. Along-S textures get a whole number of periods and the
  // texture's own samples per period; everything else samples the outline finely enough to
  // keep its corners round.
  let length = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const periodsS = spec?.alongS ? Math.max(3, Math.round(length / spec.period)) : 0;
  const per = spec?.samples ?? 8;
  // Evenly spaced, always: an offset outline carries some very short edges where a straight
  // run meets a corner, and a 2 mm chamfer pushed inward collapses those to nothing.
  const pts = resample(ring, spec?.alongS ? periodsS * per : Math.max(48, Math.ceil(length / 0.6))).pts;
  const N = pts.length;
  const periodS = spec?.alongS ? length / periodsS : 1;

  // How each point moves: along the bisector of its two edges' outward normals (the ring is
  // counter-clockwise), stretched by the miter factor so both edges move by exactly the push.
  // That is an exact polygon offset, which a normal estimated from the neighbours is not: where
  // a long straight edge meets a finely divided corner it tilts, and a 2 mm chamfer pushed
  // along it folds the outline back on itself.
  const edgeNormal = (a: [number, number], b: [number, number]): [number, number] => {
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  };
  const nrm: Ring = pts.map((p, j) => {
    const n1 = edgeNormal(pts[(j - 1 + N) % N], p);
    const n2 = edgeNormal(p, pts[(j + 1) % N]);
    const bx = n1[0] + n2[0];
    const by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1;
    const cosHalf = Math.max(0.5, (bx / bl) * n1[0] + (by / bl) * n1[1]);
    return [bx / bl / cosHalf, by / bl / cosHalf];
  });

  // Heights. A whole number of rib periods fills the band; along-Z patterns get eight rings
  // per period; a pattern that only fades needs rings where the fade starts and ends.
  const FADE = 0.7;
  const zs: number[] = [z0, bandLo];
  let periodZ = 1;
  if (spec?.alongZ) {
    // A pattern that runs both ways (knurl) keeps the same period up the wall as round it, so
    // its diamonds stay square; one that runs only up the wall (ribs) fits the band exactly.
    const zp = spec.zPeriod ?? (spec.alongS ? 0 : spec.period);
    periodZ = zp ? band / Math.max(1, Math.round(band / zp)) : periodS;
    // On the pattern's own grid, so every ring lands on a crest, a groove or a crease.
    const dz = periodZ / per;
    for (let z = bandLo + dz; z < bandHi - dz * 0.25; z += dz) zs.push(z);
  } else if (spec?.fade && band > 2 * FADE) {
    zs.push(bandLo + FADE, bandHi - FADE);
  }
  zs.push(bandHi, z1);

  /** How far a point is pushed along its normal: out by the texture, in by a chamfer. */
  const push = (j: number, z: number): number => {
    if (z < bandLo - 1e-9) return -(bandLo - z);
    if (z > bandHi + 1e-9) return -(z - bandHi);
    if (!spec) return 0;
    const zz = z - bandLo;
    let h = spec.height(spec.alongS ? j / per : 0, spec.alongZ ? zz / periodZ : 0);
    if (spec.fade) {
      const edge = Math.min(zz, band - zz);
      const t = Math.max(0, Math.min(1, edge / FADE));
      h *= t * t * (3 - 2 * t);
    }
    return h * spec.depth;
  };

  const M = zs.length;
  const vert = new Float32Array(M * N * 3);
  const heightAt = new Float32Array(M * N);
  for (let k = 0; k < M; k++) {
    for (let j = 0; j < N; j++) {
      const d = push(j, zs[k]);
      heightAt[k * N + j] = d;
      const o3 = (k * N + j) * 3;
      vert[o3] = pts[j][0] + nrm[j][0] * d;
      vert[o3 + 1] = pts[j][1] + nrm[j][1] * d;
      vert[o3 + 2] = zs[k];
    }
  }

  // No ring may fold: every edge has to keep pointing the way it did before it was pushed.
  for (let k = 0; k < M; k++) {
    for (let j = 0; j < N; j++) {
      const jn = (j + 1) % N;
      const ex = vert[(k * N + jn) * 3] - vert[(k * N + j) * 3];
      const ey = vert[(k * N + jn) * 3 + 1] - vert[(k * N + j) * 3 + 1];
      if (ex * (pts[jn][0] - pts[j][0]) + ey * (pts[jn][1] - pts[j][1]) <= 0) {
        throw new Error('Body wall folded at a corner; its radius is too small for the chamfer.');
      }
    }
  }

  // Sides: two triangles a quad, split along whichever diagonal follows the surface better
  // (the knurl's grooves run both ways; a fixed split would saw-tooth half of them).
  const tris: number[] = [];
  for (let k = 0; k < M - 1; k++) {
    for (let j = 0; j < N; j++) {
      const jn = (j + 1) % N;
      const a = k * N + j;
      const b = k * N + jn;
      const c = (k + 1) * N + jn;
      const d = (k + 1) * N + j;
      let splitAC = true;
      if (spec) {
        const mid = push(j + 0.5, (zs[k] + zs[k + 1]) / 2);
        const ac = (heightAt[a] + heightAt[c]) / 2;
        const bd = (heightAt[b] + heightAt[d]) / 2;
        splitAC = Math.abs(ac - mid) <= Math.abs(bd - mid);
      }
      if (splitAC) tris.push(a, b, c, a, c, d);
      else tris.push(a, b, d, b, c, d);
    }
  }

  // Top and bottom faces: the end rings, triangulated. Earcut's winding is not promised, so
  // each triangle is turned to face out (down for the bottom, up for the top).
  const cap = (k: number, up: boolean) => {
    const xy = (j: number): [number, number] => [vert[(k * N + j) * 3], vert[(k * N + j) * 3 + 1]];
    for (const [i0, i1, i2] of triangulateRing(N, xy)) {
      const p0 = xy(i0), p1 = xy(i1), p2 = xy(i2);
      const ccw = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]) > 0;
      if (ccw === up) tris.push(k * N + i0, k * N + i1, k * N + i2);
      else tris.push(k * N + i0, k * N + i2, k * N + i1);
    }
  };
  cap(0, false);
  cap(M - 1, true);

  return { vert, tri: Uint32Array.from(tris) };
}

// ---------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------

export interface KeyBodyOptions {
  style: BodyStyle;
  texture: BodyTexture;
  dims?: Partial<KeyBodyDims>;
  /** The switch pocket, centred on the origin, reaching up to the well floor. Cut once under
   *  every key. */
  pocket?: Solid | null;
}

export interface KeyBody {
  /** The finished body. The caller owns it and must `delete()` it. */
  solid: Solid;
  /** Key centres, in the order of `cells`. */
  centres: [number, number][];
  pitch: number;
  /** The body's outline at full size (before chamfers and texture). */
  outline: Ring[];
}

/**
 * Build the body for a set of key cells.
 *
 * Throws on an empty layout; the caller says so in words before it gets here.
 */
export function buildKeyBody(wasm: Wasm, cells: KeyCell[], opts: KeyBodyOptions): KeyBody {
  if (!cells.length) throw new Error('No keys to build a body for.');
  const d: KeyBodyDims = { ...BODY_DIMS, ...opts.dims };
  const { CrossSection, Manifold } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  try {
    const pitch = keyPitch(opts.style, d);
    const centres = keyCentres(cells, pitch);
    const well = wellSize(d);
    const wellR = Math.max(0.3, d.cornerR - d.wall);

    // The wells: sharp squares unioned, THEN rounded, so two overlapping wells in the open
    // style merge into one clean pocket instead of leaving a notch where their corners met.
    const squares = centres.map(([x, y]) => track(track(CrossSection.square([well, well], true)).translate([x, y])));
    const merged = track(CrossSection.union(squares));
    const wells = track(track(merged.offset(-wellR, 'Miter', 2)).offset(wellR, 'Round', 2, 48));

    // The outline: the wells grown by the wall (which carries their rounding out to the outer
    // corners), then closed so every inside corner is round too, with any enclosed hole
    // filled — a ring of keys round an empty middle is a solid top there, not a hole through.
    const grown = track(wells.offset(d.wall, 'Round', 2, 64));
    const closed = track(track(grown.offset(d.concaveR, 'Round', 2, 64)).offset(-d.concaveR, 'Round', 2, 64));
    const outline = ringsOf(closed).filter((r) => signedArea(r) > 0);

    // The outer wall, one closed mesh per separate piece of outline.
    const shells: Solid[] = [];
    for (const ring of outline) {
      const m = skinMesh(ring, {
        bottomZ: d.bottomZ,
        rimZ: d.rimZ,
        chamferTop: d.chamferTop,
        chamferBottom: d.chamferBottom,
        texture: opts.texture,
      });
      const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.vert, triVerts: m.tri });
      const shell = track(Manifold.ofMesh(mesh));
      const status = typeof shell.status === 'function' ? shell.status() : 'NoError';
      if (status !== 'NoError') throw new Error(`Body wall did not close (${status}).`);
      shells.push(shell);
    }
    let body: Solid = shells.length === 1 ? shells[0] : track(Manifold.union(shells));

    // The keycap wells, from their floor up through the rim.
    const wellCut = track(track(extrude(wasm, wells, d.rimZ + 2 - d.floorZ)).translate([0, 0, d.floorZ]));
    body = track(body.subtract(wellCut));

    // The switch pockets.
    if (opts.pocket) {
      const pockets = centres.map(([x, y]) => track(opts.pocket.translate([x, y, 0])));
      const all = pockets.length === 1 ? pockets[0] : track(Manifold.union(pockets));
      body = track(body.subtract(all));
    }

    // Hand the result out of the trash.
    const i = trash.indexOf(body);
    if (i >= 0) trash.splice(i, 1);
    return { solid: body, centres, pitch, outline };
  } finally {
    for (const o of trash) {
      try {
        o.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

/** Cells in reading order for a row/column/grid layout, holes skipped. Mirrors buildBlocks. */
export function cellsInReadingOrder(count: number, cols: number, filled: (i: number) => boolean): KeyCell[] {
  const out: KeyCell[] = [];
  for (let i = 0; i < count; i++) if (filled(i)) out.push({ row: Math.floor(i / cols), col: i % cols });
  return out;
}

// Re-exported for tests: a quick way to make a ring into a section.
export function sectionOf(wasm: Wasm, rings: Ring[]): Section {
  return csOf(wasm, rings, 'Positive');
}
