// Closes an STL that is not watertight, so everything after this can rely on every edge having
// two triangles. Triangles that disagree with their neighbours are turned over, and each open
// border gets the smallest skin that spans it, with no new vertices: a flat cut becomes one flat
// face, a curved opening a patch the sheet stage fits like any other.

import { type V3, basis, cross, dist, dot, maxOf, norm, normalize, sub } from './linalg';
import { type Mesh, buildMesh, vtx } from './mesh';

/** Above this many sides a border is cut in two first: the search for its skin grows with the cube. */
const MAX_SEARCH = 800;
/** Added to a skin's cost for each edge it would share with the mesh: more than any real area. */
const REUSED_EDGE = 1e12;
/** How far off the line (mm) a triangle's middle vertex is when the triangle is a crack: float rounding. */
const CRACK = 1e-5;
const MAX_CRACK_PASSES = 12;

type Border = {
  vs: number[];
  /** Its area vector's direction, its centre, and how far it strays from that plane. */
  n: V3;
  at: V3;
  area: number;
  off: number;
};

type Flat = (v: number) => [number, number];

/** The mesh made closed, and how many openings were covered. Throws on a sheet with no inside. */
export function closeMesh(m: Mesh): { mesh: Mesh; holes: number } {
  const P = (v: number) => vtx(m.pos, v);
  const tri = Array.from(m.tri);
  const nV = m.pos.length / 3;
  orient(tri, nV);

  const loops = borderLoops(tri, nV).map((vs) => describe(vs, P));
  const edges = new Set(trianglesOnEdges(tri, nV).keys());
  const openings = withHoles(loops, P);
  for (const vs of openings) skin(vs, m.pos, tri, edges, nV);
  closeCracks(tri, m.pos, nV);

  // Each body the right way out, now each one is closed and has a volume.
  const body = orient(tri, nV);
  const vol = new Map<number, number>();
  const skinArea = new Map<number, number>();
  const triCount = tri.length / 3;
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [P(tri[t * 3]), P(tri[t * 3 + 1]), P(tri[t * 3 + 2])];
    vol.set(body[t], (vol.get(body[t]) ?? 0) + dot(a, cross(b, c)) / 6);
    skinArea.set(body[t], (skinArea.get(body[t]) ?? 0) + norm(cross(sub(b, a), sub(c, a))) / 2);
  }
  for (const [b, v] of vol) if (Math.abs(v) <= 1e-9 * skinArea.get(b)! ** 1.5) throw new Error('it is a flat sheet with no inside, so there is no solid to make');
  for (let t = 0; t < triCount; t++) if (vol.get(body[t])! < 0) turnOver(tri, t);

  const soup = new Float32Array(tri.length * 3);
  tri.forEach((v, i) => soup.set(P(v), i * 3));
  return { mesh: buildMesh(soup), holes: openings.length };
}

const turnOver = (tri: number[], t: number) => { const s = tri[t * 3 + 1]; tri[t * 3 + 1] = tri[t * 3 + 2]; tri[t * 3 + 2] = s; };

/** Whether triangle t runs along a → b. */
function runs(tri: number[], t: number, a: number, b: number): boolean {
  for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === a && tri[t * 3 + ((k + 1) % 3)] === b) return true;
  return false;
}

function trianglesOnEdges(tri: number[], nV: number): Map<number, number[]> {
  const on = new Map<number, number[]>();
  for (let t = 0; t < tri.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
    const key = Math.min(a, b) * nV + Math.max(a, b);
    const list = on.get(key);
    if (list) list.push(t); else on.set(key, [t]);
  }
  return on;
}

/** Turns every triangle to agree with its neighbours. Returns the body each triangle is in. */
function orient(tri: number[], nV: number): Int32Array {
  const on = trianglesOnEdges(tri, nV);
  const nT = tri.length / 3;
  const body = new Int32Array(nT).fill(-1);
  let bodies = 0;
  for (let seed = 0; seed < nT; seed++) {
    if (body[seed] >= 0) continue;
    body[seed] = bodies;
    const stack = [seed];
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
        const list = on.get(Math.min(a, b) * nV + Math.max(a, b))!;
        if (list.length !== 2) continue;
        const w = list[0] === t ? list[1] : list[0];
        if (body[w] >= 0) continue;
        if (runs(tri, w, a, b)) turnOver(tri, w);
        body[w] = bodies;
        stack.push(w);
      }
    }
    bodies++;
  }
  return body;
}

/** The closed loops of edges that have no partner, each running the way its triangles do. */
function borderLoops(tri: number[], nV: number): number[][] {
  const out = new Map<number, number[]>();
  const add = (a: number, b: number, n: number) => {
    if (!out.has(a)) out.set(a, []);
    for (let i = 0; i < n; i++) out.get(a)!.push(b);
  };
  for (const [key, list] of trianglesOnEdges(tri, nV)) {
    const lo = Math.floor(key / nV), hi = key % nV;
    let surplus = 0;
    for (const t of list) surplus += runs(tri, t, lo, hi) ? 1 : -1;
    if (surplus > 0) add(lo, hi, surplus);
    else if (surplus < 0) add(hi, lo, -surplus);
  }
  const loops: number[][] = [];
  for (const start of out.keys()) {
    while (out.get(start)!.length) {
      const path = [start];
      const at = new Map([[start, 0]]);
      let cur = out.get(start)!.pop()!;
      for (;;) {
        // Back on a vertex of this walk: what was walked since is a loop of its own, which also
        // parts two holes that touch at a corner.
        const back = at.get(cur);
        if (back !== undefined) {
          const loop = path.splice(back);
          for (const v of loop) at.delete(v);
          if (loop.length >= 3) loops.push(loop);
          if (back === 0) break;
        }
        at.set(cur, path.length);
        path.push(cur);
        const next = out.get(cur)?.pop();
        if (next === undefined) break;
        cur = next;
      }
    }
  }
  return loops;
}

function describe(vs: number[], P: (v: number) => V3): Border {
  const pts = vs.map(P);
  const at = [0, 1, 2].map((d) => pts.reduce((s, p) => s + p[d], 0) / pts.length) as V3;
  let area: V3 = [0, 0, 0];
  pts.forEach((p, i) => {
    const c = cross(sub(p, at), sub(pts[(i + 1) % pts.length], at));
    area = [area[0] + c[0] / 2, area[1] + c[1] / 2, area[2] + c[2] / 2];
  });
  const n = normalize(area);
  return { vs, n, at, area: norm(area), off: maxOf(pts.map((p) => Math.abs(dot(sub(p, at), n)))) };
}

/**
 * The openings to cover, each one closed loop. A border inside another, about in its plane and
 * running the other way, is a hole in that opening (a cut through a tube is a ring, not a disc
 * with a smaller disc on it), so it is bridged in. Two borders apart along their axis are two
 * openings however they line up: the ends of a tube.
 */
function withHoles(all: Border[], P: (v: number) => V3): number[][] {
  const big = [...all].sort((a, b) => b.area - a.area);
  /** A border's points laid flat in its own plane, where it runs counter-clockwise. */
  const flattener = (b: Border): Flat => {
    const [e1, e2] = basis(b.n);
    return (v) => { const q = sub(P(v), b.at); return [dot(q, e1), dot(q, e2)]; };
  };
  const inside = (outer: Border, inner: Border) => {
    if (dot(outer.n, inner.n) > -0.9) return false;
    const band = Math.max(1e-3, 1.5 * outer.off);
    if (inner.vs.some((v) => Math.abs(dot(sub(P(v), outer.at), outer.n)) > band)) return false;
    const flatten = flattener(outer);
    const [x, y] = flatten(inner.vs[0]);
    let odd = false;
    outer.vs.forEach((v, i) => {
      const [ax, ay] = flatten(v), [bx, by] = flatten(outer.vs[(i + 1) % outer.vs.length]);
      if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) odd = !odd;
    });
    return odd;
  };
  const depth = big.map(() => 0);
  const holesOf = big.map((): number[] => []);
  big.forEach((b, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (!inside(big[j], b)) continue;
      depth[i] = depth[j] + 1;
      if (depth[i] % 2) holesOf[j].push(i);
      break;
    }
  });
  const out: number[][] = [];
  big.forEach((b, i) => {
    if (depth[i] % 2) return;
    let vs = b.vs;
    const flatten = flattener(b);
    holesOf[i].forEach((h, n) => {
      vs = bridge(vs, big[h].vs, holesOf[i].slice(n + 1).map((o) => big[o].vs), P, flatten);
    });
    out.push(vs);
  });
  return out;
}

/**
 * One outline from an outline and a hole, joined by an edge walked both ways: the shortest that
 * crosses nothing, since a bridge through a hole still waiting its turn folds the skin over itself.
 */
function bridge(outer: number[], hole: number[], waiting: number[][], P: (v: number) => V3, flatten: Flat): number[] {
  const side = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const crosses = (a: number, b: number) => [outer, hole, ...waiting].some((vs) => vs.some((c, i) => {
    const d = vs[(i + 1) % vs.length];
    if (c === a || c === b || d === a || d === b) return false;
    const A = flatten(a), B = flatten(b), C = flatten(c), D = flatten(d);
    return side(A, B, C) * side(A, B, D) < 0 && side(C, D, A) * side(C, D, B) < 0;
  }));
  // A vertex a bridge already uses is on the outline twice, and only one copy faces the right way.
  const opensTowards = (vs: number[], i: number, q: number) => {
    const p = flatten(vs[i]), a = flatten(vs[(i + vs.length - 1) % vs.length]), b = flatten(vs[(i + 1) % vs.length]), Q = flatten(q);
    const left = side(a, p, Q) > 0, right = side(p, b, Q) > 0;
    return side(a, p, b) >= 0 ? left && right : left || right;
  };
  const nearest = (ok: (i: number, j: number) => boolean): [number, number] | null => {
    let near = Infinity;
    let at: [number, number] | null = null;
    for (let i = 0; i < outer.length; i++) for (let j = 0; j < hole.length; j++) {
      const d = dist(P(outer[i]), P(hole[j]));
      if (d < near && ok(i, j)) { near = d; at = [i, j]; }
    }
    return at;
  };
  const [bi, bj] = nearest((i, j) => opensTowards(outer, i, hole[j]) && opensTowards(hole, j, outer[i]) && !crosses(outer[i], hole[j])) ?? nearest(() => true)!;
  return [...outer.slice(0, bi + 1), ...hole.slice(bj), ...hole.slice(0, bj + 1), ...outer.slice(bi)];
}

/** Adds the least-area triangulation of a loop to tri, running against the loop so it pairs with the mesh. */
function skin(vs: number[], pos: Float64Array, tri: number[], edges: Set<number>, nV: number): void {
  const edge = (a: number, b: number) => Math.min(a, b) * nV + Math.max(a, b);
  const n = vs.length;
  if (n > MAX_SEARCH) {
    // Cut at the shortest way across the middle.
    let cut = 0, near = Infinity;
    for (let i = 0; i < n / 2; i++) {
      const d = dist(vtx(pos, vs[i]), vtx(pos, vs[i + (n >> 1)]));
      if (d < near) { near = d; cut = i; }
    }
    const far = cut + (n >> 1);
    skin(vs.slice(cut, far + 1), pos, tri, edges, nV);
    skin([...vs.slice(far), ...vs.slice(0, cut + 1)], pos, tri, edges, nV);
    return;
  }
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  vs.forEach((v, i) => { X[i] = pos[v * 3]; Y[i] = pos[v * 3 + 1]; Z[i] = pos[v * 3 + 2]; });
  const cost = new Float64Array(n * n);
  const split = new Int32Array(n * n).fill(-1);
  for (let len = 2; len < n; len++) for (let i = 0; i + len < n; i++) {
    const j = i + len;
    const ux = X[j] - X[i], uy = Y[j] - Y[i], uz = Z[j] - Z[i];
    let best = Infinity, at = -1;
    for (let k = i + 1; k < j; k++) {
      // The two ends of a bridge are the same vertex: never a triangle's two corners.
      if (vs[i] === vs[k] || vs[k] === vs[j] || vs[i] === vs[j]) continue;
      const vx = X[k] - X[i], vy = Y[k] - Y[i], vz = Z[k] - Z[i];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      // Every way to tile a flat loop has the same area: the small second term prefers short edges.
      const c = cost[i * n + k] + cost[k * n + j] + Math.sqrt(cx * cx + cy * cy + cz * cz) / 2 + 1e-6 * (vx * vx + vy * vy + vz * vz + ux * ux + uy * uy + uz * uz);
      if (c < best) { best = c; at = k; }
    }
    // An edge the mesh already has would end up on four triangles: only if there is no other way.
    const across = !(i === 0 && j === n - 1) && edges.has(edge(vs[i], vs[j]));
    cost[i * n + j] = best + (across ? REUSED_EDGE : 0);
    split[i * n + j] = at;
  }
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const k = j - i < 2 ? -1 : split[i * n + j];
    if (k < 0) continue;
    tri.push(vs[i], vs[j], vs[k]);
    edges.add(edge(vs[i], vs[j])).add(edge(vs[j], vs[k])).add(edge(vs[k], vs[i]));
    stack.push([i, k], [k, j]);
  }
}

/**
 * A crack is a hole with no area: a vertex in the middle of the edge opposite, so its skin is a
 * triangle as flat as a line, which no CAD package can use. Split the triangle across that line
 * at the middle vertex instead, in the flat triangle's place.
 */
function closeCracks(tri: number[], pos: Float64Array, nV: number): void {
  for (let pass = 0; pass < MAX_CRACK_PASSES; pass++) {
    const on = trianglesOnEdges(tri, nV);
    const done = new Set<number>();
    for (let t = 0; t < tri.length / 3; t++) {
      if (done.has(t)) continue;
      const vs = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
      const side = (k: number) => dist(vtx(pos, vs[k]), vtx(pos, vs[(k + 1) % 3]));
      const k = [0, 1, 2].reduce((best, i) => (side(i) > side(best) ? i : best), 0);
      const a = vs[k], b = vs[(k + 1) % 3], mid = vs[(k + 2) % 3];
      const height = norm(cross(sub(vtx(pos, b), vtx(pos, a)), sub(vtx(pos, mid), vtx(pos, a)))) / side(k);
      if (height > CRACK) continue;
      const w = on.get(Math.min(a, b) * nV + Math.max(a, b))!.find((x) => x !== t);
      if (w === undefined || done.has(w)) continue;
      const far = [tri[w * 3], tri[w * 3 + 1], tri[w * 3 + 2]].find((v) => v !== a && v !== b)!;
      // Keep w's direction round the shared edge.
      const [p, q] = runs(tri, w, a, b) ? [a, b] : [b, a];
      tri[t * 3] = p; tri[t * 3 + 1] = mid; tri[t * 3 + 2] = far;
      tri[w * 3] = mid; tri[w * 3 + 1] = q; tri[w * 3 + 2] = far;
      done.add(t).add(w);
    }
    if (!done.size) return;
  }
}
