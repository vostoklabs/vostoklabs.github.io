// Rebuild a broken mesh as a closed solid, by voxels.
//
// For what `Manifold.ofMesh` refuses: holes, non-manifold edges, faces that cross. Every cell of a
// grid is asked "inside or outside?" by casting rays through it along X, Y and Z and counting
// crossings (odd = inside); a column whose count comes out odd has passed through a hole and does
// not vote. Two of three votes decide. The inside/outside field is then turned into a signed
// distance — exact to the nearest triangle next to the surface, clamped further out — and
// Manifold's own marching tetrahedra (`levelSet`) makes a watertight mesh of it.
//
// It is a fallback, not a filter: detail smaller than a cell is lost, and the status says so.
type Wasm = any;
type Solid = any;

export function remeshByVoxels(wasm: Wasm, pos: Float32Array, idx: Uint32Array, maxCells = 150): Solid {
  const nTri = Math.floor(idx.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const longest = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(longest > 0)) throw new Error('This model has no size.');
  const c = longest / maxCells;
  const pad = 3;
  const nx = Math.ceil((maxX - minX) / c) + 2 * pad;
  const ny = Math.ceil((maxY - minY) / c) + 2 * pad;
  const nz = Math.ceil((maxZ - minZ) / c) + 2 * pad;
  const ox = minX - pad * c;
  const oy = minY - pad * c;
  const oz = minZ - pad * c;
  const cell = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const inVotes = new Uint8Array(nx * ny * nz);
  const validVotes = new Uint8Array(nx * ny * nz);

  // Cast one family of axis-parallel rays through every cell centre. `u`/`v` are the two axes
  // across the rays, `w` the axis along them.
  const castAxis = (w: 0 | 1 | 2) => {
    const u = w === 0 ? 1 : 0;
    const v = w === 2 ? 1 : 2;
    const n = [nx, ny, nz];
    const o = [ox, oy, oz];
    const nu = n[u], nv = n[v], nw = n[w];
    // Bin triangles by the columns their shadow covers.
    const bins: number[][] = Array.from({ length: nu * nv }, () => []);
    for (let t = 0; t < nTri; t++) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const p = idx[t * 3 + k] * 3;
        const pu = pos[p + u], pv = pos[p + v];
        if (pu < u0) u0 = pu; if (pu > u1) u1 = pu;
        if (pv < v0) v0 = pv; if (pv > v1) v1 = pv;
      }
      const iu0 = Math.max(0, Math.floor((u0 - o[u]) / c - 0.5));
      const iu1 = Math.min(nu - 1, Math.ceil((u1 - o[u]) / c - 0.5));
      const iv0 = Math.max(0, Math.floor((v0 - o[v]) / c - 0.5));
      const iv1 = Math.min(nv - 1, Math.ceil((v1 - o[v]) / c - 0.5));
      for (let a = iu0; a <= iu1; a++) for (let b = iv0; b <= iv1; b++) bins[b * nu + a].push(t);
    }
    const hits: number[] = [];
    for (let b = 0; b < nv; b++) {
      for (let a = 0; a < nu; a++) {
        const tris = bins[b * nu + a];
        if (!tris.length) {
          // Nothing here: every cell in the column is outside, and that is a valid vote.
          for (let k = 0; k < nw; k++) validVotes[idxOf(w, a, b, k)] += 1;
          continue;
        }
        // A hair off the cell centre, so a ray never runs exactly down a shared edge.
        const pu = o[u] + (a + 0.5) * c + c * 1.3e-4;
        const pv = o[v] + (b + 0.5) * c + c * 0.7e-4;
        hits.length = 0;
        for (const t of tris) {
          const p0 = idx[t * 3] * 3, p1 = idx[t * 3 + 1] * 3, p2 = idx[t * 3 + 2] * 3;
          const au = pos[p0 + u], av = pos[p0 + v];
          const bu = pos[p1 + u], bv = pos[p1 + v];
          const cu = pos[p2 + u], cv = pos[p2 + v];
          const d = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
          if (Math.abs(d) < 1e-18) continue;
          const l0 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / d;
          const l1 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          hits.push(l0 * pos[p0 + w] + l1 * pos[p1 + w] + l2 * pos[p2 + w]);
        }
        const valid = hits.length % 2 === 0;
        hits.sort((x, y) => x - y);
        let h = 0;
        let inside = false;
        for (let k = 0; k < nw; k++) {
          const centre = o[w] + (k + 0.5) * c;
          while (h < hits.length && hits[h] < centre) {
            inside = !inside;
            h++;
          }
          if (!valid) continue;
          const id = idxOf(w, a, b, k);
          validVotes[id] += 1;
          if (inside) inVotes[id] += 1;
        }
      }
    }
  };
  // Map (axis, across-a, across-b, along) back to a cell index.
  function idxOf(w: 0 | 1 | 2, a: number, b: number, k: number): number {
    if (w === 2) return cell(a, b, k); // u = x, v = y
    if (w === 1) return cell(a, k, b); // u = x, v = z
    return cell(k, a, b); // u = y, v = z
  }
  castAxis(2);
  castAxis(0);
  castAxis(1);

  const N = nx * ny * nz;
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = validVotes[i] > 0 && inVotes[i] * 2 > validVotes[i] ? 1 : 0;

  // A signed field in cell units: +1 deep inside, -1 far outside, smoothed across the boundary
  // by averaging each cell with its 26 neighbours twice — enough for levelSet to put the surface
  // between cells rather than on their faces, without melting corners much.
  let field = new Float32Array(N);
  for (let i = 0; i < N; i++) field[i] = inside[i] ? 1 : -1;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(N);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          let s = 0;
          let n = 0;
          for (let dk = -1; dk <= 1; dk++) {
            const kk = k + dk;
            if (kk < 0 || kk >= nz) continue;
            for (let dj = -1; dj <= 1; dj++) {
              const jj = j + dj;
              if (jj < 0 || jj >= ny) continue;
              for (let di = -1; di <= 1; di++) {
                const ii = i + di;
                if (ii < 0 || ii >= nx) continue;
                s += field[cell(ii, jj, kk)];
                n++;
              }
            }
          }
          next[cell(i, j, k)] = s / n;
        }
      }
    }
    field = next;
  }

  const sample = (p: number[]): number => {
    const fx = (p[0] - ox) / c - 0.5;
    const fy = (p[1] - oy) / c - 0.5;
    const fz = (p[2] - oz) / c - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx - 1 || j0 >= ny - 1 || k0 >= nz - 1) return -1;
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const at = (i: number, j: number, k: number) => field[cell(i, j, k)];
    const x00 = at(i0, j0, k0) * (1 - tx) + at(i0 + 1, j0, k0) * tx;
    const x10 = at(i0, j0 + 1, k0) * (1 - tx) + at(i0 + 1, j0 + 1, k0) * tx;
    const x01 = at(i0, j0, k0 + 1) * (1 - tx) + at(i0 + 1, j0, k0 + 1) * tx;
    const x11 = at(i0, j0 + 1, k0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1, k0 + 1) * tx;
    const y0 = x00 * (1 - ty) + x10 * ty;
    const y1 = x01 * (1 - ty) + x11 * ty;
    return y0 * (1 - tz) + y1 * tz;
  };
  const bounds = {
    min: [ox + c, oy + c, oz + c],
    max: [ox + (nx - 1) * c, oy + (ny - 1) * c, oz + (nz - 1) * c],
  };
  const out = wasm.Manifold.levelSet(sample, bounds, c, 0);
  if (out.isEmpty()) {
    out.delete();
    throw new Error('This model could not be repaired — no closed shape could be found in it.');
  }
  return out;
}
