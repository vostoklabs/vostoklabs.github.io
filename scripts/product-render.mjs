/*
  A small software renderer for gallery pictures â€” no browser, no WebGL.

  The render-*.mjs scripts build a model with the app's own geometry code and hand the parts here.
  What comes back looks like a product shot rather than a debug view: a perspective camera,
  smooth normals with hard creases kept, a key light that casts a soft shadow (PCSS-style
  penumbra), a straight-down sky light whose wide shadow grounds the model on the floor, a cool
  fill, a little plastic specular and a sky reflection on the edges, on a light seamless floor in
  the viewer's own background colour. Supersampled, then box-filtered down.

    import { renderScene, writePng, frameFor } from './product-render.mjs';
    const rgb = renderScene(parts, { width: 1200, height: 900, azimuth: 30, elevation: 28 });
    writePng('out.png', rgb, 1200, 900);

  A part is { positions: Float32Array|number[], indices: Uint32Array|number[], color: '#rrggbb' or
  [r,g,b] 0..255 }. The world is Z-up, in millimetres; the floor sits at the lowest Z unless
  `groundZ` says otherwise.
*/
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const toLin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c) => {
  c = Math.max(0, Math.min(1, c));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
};
const hexRgb = (c) => {
  if (Array.isArray(c)) return c;
  const h = String(c).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Per-corner normals: each corner averages the faces round its welded vertex that turn less
 *  than `creaseDeg` from its own face, so a fillet is smooth and a box edge stays sharp. */
function cornerNormals(P, I, creaseDeg) {
  const nt = I.length / 3;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    // Area-weighted: the cross product is left unnormalised for the sum, normalised for the test.
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  // Weld by position so seams in the index buffer do not split the smoothing.
  const key = new Map();
  const nv = P.length / 3;
  const rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
    let r = key.get(k);
    if (r === undefined) key.set(k, (r = v));
    rep[v] = r;
  }
  const faces = new Map();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const r = rep[I[t * 3 + k]];
      let l = faces.get(r);
      if (!l) faces.set(r, (l = []));
      l.push(t);
    }
  }
  const unit = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const l = Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1;
    unit[t * 3] = fn[t * 3] / l;
    unit[t * 3 + 1] = fn[t * 3 + 1] / l;
    unit[t * 3 + 2] = fn[t * 3 + 2] / l;
  }
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const l = faces.get(rep[I[t * 3 + k]]);
      let x = 0, y = 0, z = 0;
      for (const f of l) {
        if (unit[t * 3] * unit[f * 3] + unit[t * 3 + 1] * unit[f * 3 + 1] + unit[t * 3 + 2] * unit[f * 3 + 2] < cosC) continue;
        x += fn[f * 3]; y += fn[f * 3 + 1]; z += fn[f * 3 + 2];
      }
      const ln = Math.hypot(x, y, z) || 1;
      out[t * 9 + k * 3] = x / ln;
      out[t * 9 + k * 3 + 1] = y / ln;
      out[t * 9 + k * 3 + 2] = z / ln;
    }
  }
  return out;
}

function boundsOf(parts) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (P[i + k] < b[k]) b[k] = P[i + k];
        if (P[i + k] > b[k + 3]) b[k + 3] = P[i + k];
      }
    }
  }
  return b;
}

/** The camera for a set of parts: looking at their middle from `azimuth`/`elevation` (degrees;
 *  azimuth 0 looks from -Y toward +Y, positive swings round to +X), zoomed so they fill the frame
 *  less `margin`. Pass the result as `frame` to render other models with exactly this camera. */
export function frameFor(parts, { width, height, azimuth = 30, elevation = 28, fov = 24, margin = 0.1, target, offsetY = 0 } = {}) {
  const b = boundsOf(parts);
  const tgt = target ?? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const R = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 1;
  const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  const d = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const dist = R / Math.sin((fov * Math.PI) / 360) * 1.1;
  const eye = [tgt[0] + d[0] * dist, tgt[1] + d[1] * dist, tgt[2] + d[2] * dist];
  const f = [-d[0], -d[1], -d[2]];
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  // Fit: project every vertex at focal 1, then scale and centre the projected box.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) {
      const q = [P[i] - eye[0], P[i + 1] - eye[1], P[i + 2] - eye[2]];
      const z = dot3(q, f);
      const x = dot3(q, r) / z, y = dot3(q, u) / z;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const focal = Math.min((width * (1 - 2 * margin)) / (x1 - x0), (height * (1 - 2 * margin)) / (y1 - y0));
  return { eye, f, r, u, focal, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + offsetY, width, height };
}

/**
 * Render parts to an sRGB byte buffer (width*height*3).
 * Options: width, height, ss (supersampling, default 3), azimuth, elevation, fov, margin, frame
 * (from frameFor, at the OUTPUT size), groundZ, bg ('#f3f4f6'), light ({ azimuth, elevation }
 * of the key light), shadow (0..1 strength), grid (mm spacing of a faint floor grid, or 0).
 */
export function renderScene(parts, o = {}) {
  const W0 = o.width ?? 1200, H0 = o.height ?? 900, ss = o.ss ?? 3;
  const W = W0 * ss, H = H0 * ss;
  const fr0 = o.frame ?? frameFor(parts, { width: W0, height: H0, azimuth: o.azimuth, elevation: o.elevation, fov: o.fov, margin: o.margin, offsetY: o.offsetY });
  const fr = { ...fr0, focal: fr0.focal * ss };
  const bounds = boundsOf(parts);
  const groundZ = o.groundZ ?? bounds[2];
  const bg = hexRgb(o.bg ?? '#f3f4f6').map(toLin);

  // ------------------------------------------------------------------ prepared triangles
  const tris = [];
  for (const p of parts) {
    const P = p.positions, I = p.indices;
    const N = cornerNormals(P, I, o.crease ?? 34);
    const alb = hexRgb(p.color).map(toLin);
    const mat = { alb, spec: p.spec ?? 0.35, gloss: p.gloss ?? 60, twoSided: !!p.twoSided };
    tris.push({ P, I, N, mat });
  }

  // ------------------------------------------------------------------ lights
  const lAz = ((o.light?.azimuth ?? -40) * Math.PI) / 180, lEl = ((o.light?.elevation ?? 52) * Math.PI) / 180;
  const L = norm([Math.cos(lEl) * Math.sin(lAz), -Math.cos(lEl) * Math.cos(lAz), Math.sin(lEl)]);
  const F = norm([-L[0] * 0.8, -L[1] * 0.8, 0.35]); // fill from the other side
  const keyMap = shadowMap(tris, L, bounds, groundZ, 1400);
  const skyMap = shadowMap(tris, [0, 0, 1], bounds, groundZ, 700);
  const sizeMM = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);

  // ------------------------------------------------------------------ G-buffer
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const nbuf = new Float32Array(W * H * 3);
  const pbuf = new Float32Array(W * H * 3);
  const mbuf = new Int32Array(W * H).fill(-1);
  const mats = tris.map((t) => t.mat);
  const proj = (x, y, z) => {
    const qx = x - fr.eye[0], qy = y - fr.eye[1], qz = z - fr.eye[2];
    const d = qx * fr.f[0] + qy * fr.f[1] + qz * fr.f[2];
    const sx = W / 2 + ((qx * fr.r[0] + qy * fr.r[1] + qz * fr.r[2]) / d - fr.cx) * fr.focal;
    const sy = H / 2 - ((qx * fr.u[0] + qy * fr.u[1] + qz * fr.u[2]) / d - fr.cy) * fr.focal;
    return [sx, sy, d];
  };
  tris.forEach(({ P, I, N, mat: tm }, mi) => {
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const s = v.map((a) => proj(P[a], P[a + 1], P[a + 2]));
      if (s[0][2] <= 0 || s[1][2] <= 0 || s[2][2] <= 0) continue;
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      // Back face (screen y is down, so front faces wind negative). A two-sided part — a sheet
      // whose winding is not to be trusted — keeps both, and shading turns the normal round.
      if (area >= 0 && !tm.twoSided) continue;
      if (Math.abs(area) < 1e-12) continue;
      const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      // Perspective-correct: interpolate attr/d and 1/d.
      const iz = [1 / s[0][2], 1 / s[1][2], 1 / s[2][2]];
      for (let y = minY; y <= maxY; y++) {
        const cy = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const cx = x + 0.5;
          const w0 = ((s[1][0] - cx) * (s[2][1] - cy) - (s[2][0] - cx) * (s[1][1] - cy)) / area;
          const w1 = ((s[2][0] - cx) * (s[0][1] - cy) - (s[0][0] - cx) * (s[2][1] - cy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const izp = w0 * iz[0] + w1 * iz[1] + w2 * iz[2];
          const depth = 1 / izp;
          const idx = y * W + x;
          if (depth >= zbuf[idx]) continue;
          zbuf[idx] = depth;
          mbuf[idx] = mi;
          const a0 = (w0 * iz[0]) / izp, a1 = (w1 * iz[1]) / izp, a2 = (w2 * iz[2]) / izp;
          const nb = (t / 3) * 9;
          for (let k = 0; k < 3; k++) {
            nbuf[idx * 3 + k] = a0 * N[nb + k] + a1 * N[nb + 3 + k] + a2 * N[nb + 6 + k];
            pbuf[idx * 3 + k] = a0 * P[v[0] + k] + a1 * P[v[1] + k] + a2 * P[v[2] + k];
          }
        }
      }
    }
  });

  // ------------------------------------------------------------------ shade
  const out = new Float32Array(W * H * 3);
  const sky = [1.0, 1.0, 1.02], ground = [0.42, 0.42, 0.44];
  const keyI = o.keyIntensity ?? 1.05, fillI = o.fillIntensity ?? 0.25, ambI = o.ambientIntensity ?? 0.42;
  const specI = o.specIntensity ?? 2.1;
  const shadowK = o.shadow ?? 0.85;
  const grid = o.grid ?? 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      // view ray
      const rx = (x + 0.5 - W / 2) / fr.focal + fr.cx;
      const ry = -(y + 0.5 - H / 2) / fr.focal + fr.cy;
      const dir = norm([
        fr.f[0] + rx * fr.r[0] + ry * fr.u[0],
        fr.f[1] + rx * fr.r[1] + ry * fr.u[1],
        fr.f[2] + rx * fr.r[2] + ry * fr.u[2],
      ]);
      const mi = mbuf[idx];
      let c;
      if (mi < 0) {
        // Floor: the background colour, darkened where the key light and the sky are blocked.
        c = bg.slice();
        if (dir[2] < 0) {
          const t = (groundZ - fr.eye[2]) / dir[2];
          const p = [fr.eye[0] + dir[0] * t, fr.eye[1] + dir[1] * t, fr.eye[2] + dir[2] * t];
          const ks = keyMap.soft(p, sizeMM * 0.018, sizeMM * 0.06);
          const as = skyMap.floorAo(p, sizeMM * 0.35, groundZ);
          const lit = (1 - shadowK * 0.45 * (1 - ks)) * (1 - shadowK * 0.8 * (1 - as) ** 0.8);
          if (grid > 0) {
            const g = (v) => {
              const f = Math.abs(((v / grid) % 1 + 1) % 1 - 0.5) * 2; // 1 at a line
              const w = Math.min(1, (t / fr.focal) / grid * 3); // line width in cells, for AA
              return Math.max(0, (f - (1 - w)) / w);
            };
            const line = Math.max(g(p[0]), g(p[1]));
            const fade = Math.exp(-((p[0] - (bounds[0] + bounds[3]) / 2) ** 2 + (p[1] - (bounds[1] + bounds[4]) / 2) ** 2) / (sizeMM * 1.6) ** 2);
            const k = 1 - 0.09 * line * fade;
            c = c.map((v) => v * k);
          }
          c = c.map((v) => v * lit);
        }
      } else {
        const m = mats[mi];
        let n = norm([nbuf[idx * 3], nbuf[idx * 3 + 1], nbuf[idx * 3 + 2]]);
        if (m.twoSided && dot3(n, dir) > 0) n = [-n[0], -n[1], -n[2]];
        const p = [pbuf[idx * 3], pbuf[idx * 3 + 1], pbuf[idx * 3 + 2]];
        const V = [-dir[0], -dir[1], -dir[2]];
        const nl = Math.max(0, dot3(n, L));
        const ksh = nl > 0 ? keyMap.soft(p, sizeMM * 0.006, sizeMM * 0.02, n) : 0;
        const ash = skyMap.soft(p, sizeMM * 0.03, sizeMM * 0.1, n);
        const hemi = 0.5 + 0.5 * n[2];
        const amb = [0, 1, 2].map((k) => ground[k] + (sky[k] - ground[k]) * hemi);
        const ao = 0.55 + 0.45 * ash;
        const nf = Math.max(0, dot3(n, F));
        const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
        const spec = m.spec * Math.max(0, dot3(n, H)) ** m.gloss * ksh * specI;
        const nv = Math.max(0, dot3(n, V));
        const fres = 0.04 + 0.96 * (1 - nv) ** 5;
        const R = [2 * dot3(n, V) * n[0] - V[0], 2 * dot3(n, V) * n[1] - V[1], 2 * dot3(n, V) * n[2] - V[2]];
        const env = (0.35 + 0.65 * Math.max(0, R[2])) * fres * (o.env ?? 0.35) * ao;
        c = [0, 1, 2].map((k) => m.alb[k] * (amb[k] * ambI * ao + keyI * nl * ksh + fillI * nf * [0.85, 0.9, 1.05][k]) + spec + env);
      }
      // A gentle vignette, so the floor falls off toward the corners.
      const vx = (x / W - 0.5) * 2, vy = (y / H - 0.5) * 2;
      const vig = 1 - 0.07 * (vx * vx + vy * vy);
      out[idx * 3] = c[0] * vig;
      out[idx * 3 + 1] = c[1] * vig;
      out[idx * 3 + 2] = c[2] * vig;
    }
  }

  // ------------------------------------------------------------------ downsample
  const rgb = new Uint8Array(W0 * H0 * 3);
  for (let y = 0; y < H0; y++) {
    for (let x = 0; x < W0; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) s += Math.min(1, out[((y * ss + j) * W + x * ss + i) * 3 + k]);
        rgb[(y * W0 + x) * 3 + k] = toSrgb(s / (ss * ss));
      }
    }
  }
  return rgb;
}

/** An orthographic depth map along light direction `L`, with a soft lookup: blocker search, then
 *  percentage-closer filtering over a penumbra that grows with the gap to the blocker. */
function shadowMap(tris, L, bounds, groundZ, res) {
  const a = norm(Math.abs(L[2]) > 0.9 ? cross(L, [1, 0, 0]) : cross(L, [0, 0, 1]));
  const b = cross(L, a);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const { P } of tris) {
    for (let i = 0; i < P.length; i += 3) {
      const p = [P[i], P[i + 1], P[i + 2]];
      const u = dot3(p, a), v = dot3(p, b);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
  }
  const pad = Math.max(u1 - u0, v1 - v0) * 0.6;
  u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;
  const sc = res / Math.max(u1 - u0, v1 - v0);
  const D = new Float32Array(res * res).fill(-Infinity);
  for (const { P, I } of tris) {
    for (let t = 0; t < I.length; t += 3) {
      const s = [];
      for (let k = 0; k < 3; k++) {
        const o = I[t + k] * 3;
        const p = [P[o], P[o + 1], P[o + 2]];
        s.push([(dot3(p, a) - u0) * sc, (dot3(p, b) - v0) * sc, dot3(p, L)]);
      }
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      if (Math.abs(area) < 1e-12) continue;
      const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
      const maxX = Math.min(res - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
      const maxY = Math.min(res - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const w0 = ((s[1][0] - x - 0.5) * (s[2][1] - y - 0.5) - (s[2][0] - x - 0.5) * (s[1][1] - y - 0.5)) / area;
          const w1 = ((s[2][0] - x - 0.5) * (s[0][1] - y - 0.5) - (s[0][0] - x - 0.5) * (s[2][1] - y - 0.5)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const d = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
          const i = y * res + x;
          if (d > D[i]) D[i] = d;
        }
      }
    }
  }
  // Poisson-ish disk, fixed so every frame dithers the same.
  const K = 24;
  const disk = [];
  for (let i = 0; i < K; i++) {
    const r = Math.sqrt((i + 0.5) / K), th = i * 2.39996;
    disk.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  const at = (u, v) => {
    const x = Math.floor((u - u0) * sc), y = Math.floor((v - v0) * sc);
    if (x < 0 || y < 0 || x >= res || y >= res) return -Infinity;
    return D[y * res + x];
  };
  return {
    /** Horizon ambient occlusion for a point on the floor, read off a straight-down map: how
     *  much of the sky the model's heights round it hide, within `R` mm. 1 = open sky. */
    floorAo(p, R, groundZ) {
      let occ = 0;
      for (let i = 0; i < 48; i++) {
        const r = R * ((i + 0.5) / 48) ** 1.5, th = i * 2.39996;
        const q = [p[0] + r * Math.cos(th), p[1] + r * Math.sin(th), p[2]];
        const h = at(dot3(q, a), dot3(q, b)) - groundZ;
        if (h > 0) occ += Math.atan2(h, r + 0.3) / (Math.PI / 2);
      }
      return 1 - occ / 48;
    },
    /** 1 = fully lit. `minR`/`maxR` bound the filter radius in mm. */
    soft(p, minR, maxR, n) {
      let q = p;
      // Normal offset against acne on the model itself.
      if (n) q = [p[0] + n[0] * 0.08, p[1] + n[1] * 0.08, p[2] + n[2] * 0.08];
      const u = dot3(q, a), v = dot3(q, b), d = dot3(q, L);
      const bias = 0.05 + 1.5 / sc;
      // blocker search
      let sum = 0, cnt = 0;
      for (const [dx, dy] of disk) {
        const z = at(u + dx * maxR, v + dy * maxR);
        if (z > d + bias) { sum += z; cnt++; }
      }
      if (!cnt) return 1;
      const gap = sum / cnt - d;
      const r = Math.min(maxR, Math.max(minR, gap * 0.12));
      let lit = 0;
      for (const [dx, dy] of disk) if (!(at(u + dx * r, v + dy * r) > d + bias)) lit++;
      return lit / K;
    },
  };
}

/** Minimal PNG writer (RGB, 8-bit). */
export function writePng(file, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Translate and rotate (about Z, degrees) a part's positions, returning a new part. */
export function placed(part, { dx = 0, dy = 0, dz = 0, rotZ = 0 } = {}) {
  const c = Math.cos((rotZ * Math.PI) / 180), s = Math.sin((rotZ * Math.PI) / 180);
  const P = part.positions;
  const Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    Q[i] = P[i] * c - P[i + 1] * s + dx;
    Q[i + 1] = P[i] * s + P[i + 1] * c + dy;
    Q[i + 2] = P[i + 2] + dz;
  }
  return { ...part, positions: Q };
}
