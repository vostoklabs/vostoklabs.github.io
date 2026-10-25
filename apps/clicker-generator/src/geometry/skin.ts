// The outer wall a body is built from, with or without a texture on it: the letter blocks'
// (keyBody.ts) and, when one is asked for, the flat clicker's (buildClicker.ts).
//
// The wall is its own mesh (`skinMesh`): the outline is sampled by arc length and every sample is
// pushed out along its normal by the texture's height at that point, ring by ring up the wall.
// Chamfers come from the same push, inward, at the top and bottom. Every corner of the outline has
// to be rounder than the push, or the surface folds over itself. The letter blocks round their own
// outline before it gets here; `texturedWall` takes any outline and closes it until it is round
// enough, or says it cannot.
import { csOf, extrude, ringsOf } from '@vostok/manifold';
import { signedArea } from '@vostok/shapes';
import { ShapeUtils, Vector2 } from 'three';
import type { BlockTexture, Ring } from '../types';

type Wasm = any;
type Solid = any;
type Section = any;

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

const TEXTURES: Record<Exclude<BlockTexture, 'smooth'>, TextureSpec> = {
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

/** How far a texture's crests stand out from the wall it is put on, mm: 0 for smooth, and for a
 *  name this build does not know (an old or hand-edited project), which then builds smooth. */
export function texturePeakMm(texture: BlockTexture | undefined): number {
  if (!texture || texture === 'smooth') return 0;
  return TEXTURES[texture]?.depth ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The outer wall
// ---------------------------------------------------------------------------------------------

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
  texture: BlockTexture;
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

  // Top and bottom faces: the end rings, triangulated, and turned to face out (down for the
  // bottom, up for the top). Earcut winds every triangle of a face the same way but does not
  // promise which, so the face is turned as a whole, by the sign of its total area. Turning each
  // triangle by its own sign was the first version, and it is wrong on a long, nearly straight
  // run of outline: Earcut leaves slivers there whose winding, in float32, is noise, and a sliver
  // turned on its own pairs its edges the wrong way round, so manifold refuses the wall as not
  // closed (a traced witch hat's flank did it). The fans `triangulateRing` adds keep their
  // triangle's winding, so one turn is right for all of them.
  const cap = (k: number, up: boolean) => {
    const xy = (j: number): [number, number] => [vert[(k * N + j) * 3], vert[(k * N + j) * 3 + 1]];
    const faces = triangulateRing(N, xy);
    let area = 0;
    for (const [i0, i1, i2] of faces) {
      const p0 = xy(i0), p1 = xy(i1), p2 = xy(i2);
      area += (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    }
    const asWound = area > 0 === up;
    for (const [i0, i1, i2] of faces) {
      if (asWound) tris.push(k * N + i0, k * N + i1, k * N + i2);
      else tris.push(k * N + i0, k * N + i2, k * N + i1);
    }
  };
  cap(0, false);
  cap(M - 1, true);

  return { vert, tri: Uint32Array.from(tris) };
}

/**
 * `skinMesh` as a solid the caller owns and must `delete()`, or a throw saying why the wall did
 * not close.
 *
 * Made through manifold's own constructor rather than `Manifold.ofMesh`. The glue's `ofMesh`
 * throws on a mesh that is not manifold WITHOUT freeing the solid it has just made, and the
 * heap never gives memory back — a whole wall's worth every time, and `texturedWall` below meets
 * a wall that does not close as a normal step on its way up the closing ladder. The embind class
 * under the glue's wrapper is the constructor of the wrapper's prototype's prototype, the same
 * route `csOf` takes; if a later manifold moves it, this falls back to the glue: leaking on a
 * failure, never wrong.
 */
export function skinShell(wasm: Wasm, ring: Ring, o: SkinOptions): Solid {
  const m = skinMesh(ring, o);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.vert, triVerts: m.tri });
  const proto = Object.getPrototypeOf(wasm.Manifold.prototype);
  if (typeof proto?._GetMeshJS !== 'function') return wasm.Manifold.ofMesh(mesh);
  const shell = new proto.constructor(mesh);
  const status = typeof shell.status === 'function' ? shell.status() : 'NoError';
  if (status !== 'NoError') {
    shell.delete();
    throw new Error(`Body wall did not close (${status}).`);
  }
  return shell;
}

/*
  How far `texturedWall` may close an outline, mm, smallest first.

  A traced outline has corners far tighter than any texture: a cat's ears, a frog's toes, and the
  crook where the switch's clear column meets the cap. Closing (offset out by R, then back in by
  R) rounds every inside corner to R and touches nothing else, so it only ever ADDS plastic, and
  only in a concave corner: the wall is never thinner and the well is never touched. The texture
  pushes out, so an inside corner folds once its radius is under the push; 1.3 mm is rounder
  than the deepest texture (0.75 mm). Measured on the fifteen traced Halloween designs and five
  traced pictures, every texture builds at 1.3. The steps after it are for an outline that
  really is tighter than that; past 5.2 a closing fills features people would miss, so the
  ladder stops and the wall stays smooth.
*/
const CLOSE_STEPS_MM = [1.3, 2.6, 5.2];
/** A piece of outline smaller than this is a sliver of the closing, not a body, mm². */
const MIN_PIECE_MM2 = 1;

/**
 * The textured wall round any footprint, from `o.bottomZ` to `o.rimZ`, as one solid; the outline
 * it stands on (the footprint closed); and the radius it was closed by. The caller owns `solid`
 * and `outline` and must `delete()` both. Null when no step of the closing ladder gives a wall
 * that holds: the caller builds its smooth wall instead and says so.
 *
 * A hole through the footprint stays a hole, cut straight through the wall: closing fills only
 * holes narrower than 2R, and the texture is for the outside.
 */
export function texturedWall(
  wasm: Wasm,
  footprint: Section,
  o: SkinOptions,
): { solid: Solid; outline: Section; closeMm: number } | null {
  for (const r of CLOSE_STEPS_MM) {
    const trash: { delete(): void }[] = [];
    const keep = <T extends { delete(): void }>(x: T): T => {
      trash.push(x);
      return x;
    };
    try {
      const closed = keep(keep(footprint.offset(r, 'Round', 2.0, 32)).offset(-r, 'Round', 2.0, 32));
      const rings = ringsOf(closed);
      const outer = rings.filter((ring) => signedArea(ring) > MIN_PIECE_MM2);
      if (!outer.length) continue;
      const shells = outer.map((ring) => keep(skinShell(wasm, ring, o)));
      let wall: Solid = shells.length === 1 ? shells[0] : keep(wasm.Manifold.union(shells));
      if (rings.some((ring) => signedArea(ring) < -MIN_PIECE_MM2)) {
        const holes = keep(keep(csOf(wasm, outer, 'Positive')).subtract(closed));
        const cut = keep(keep(extrude(wasm, holes, o.rimZ - o.bottomZ + 2)).translate([0, 0, o.bottomZ - 1]));
        wall = keep(wall.subtract(cut));
      }
      // Hand the wall and its outline out of the trash: everything else made on the way is
      // freed below.
      trash.splice(trash.indexOf(wall), 1);
      trash.splice(trash.indexOf(closed), 1);
      return { solid: wall, outline: closed, closeMm: r };
    } catch {
      // It folded, or did not close: try a rounder outline.
    } finally {
      for (const x of trash) {
        try {
          x.delete();
        } catch {
          /* already freed */
        }
      }
    }
  }
  return null;
}
