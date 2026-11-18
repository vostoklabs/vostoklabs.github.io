/**
 * The keyring on the Design view, as pure rules node can test: where its handle sits for a
 * bearing, the bearing a dropped handle stands for, and how a loop and a hole differ on the
 * canvas. designView.ts draws with these; the keychain-hole suite checks them against builds,
 * so a handle dropped on the canvas lands where the rebuild puts it.
 */
import type { DesignLayout, Ring } from '../types';

/** The rings' bounding box. */
export function ringsBounds(rings: Ring[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Where the keyring loop sits for a bearing: the ray from the body's area centroid at `angleDeg`
 * leaves the outermost boundary at `p`, and the loop's centre is one loop radius further out.
 * The same construction `edgePointAt` makes in the build, so the loop on the canvas lands where
 * the printed one will.
 */
export function loopCentre(body: Ring[], angleDeg: number, loopR: number): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
  }
  const b = ringsBounds(body);
  const ox = Math.abs(area) > 1e-6 ? cx / (3 * area) : (b.minX + b.maxX) / 2;
  const oy = Math.abs(area) > 1e-6 ? cy / (3 * area) : (b.minY + b.maxY) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  let best = -Infinity;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const ex = ring[i][0] - ax, ey = ring[i][1] - ay;
      const det = -dx * ey + ex * dy;
      if (Math.abs(det) < 1e-12) continue;
      const rx = ax - ox, ry = ay - oy;
      const t = (-rx * ey + ex * ry) / det;
      const u = (dx * ry - dy * rx) / det;
      if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
    }
  }
  if (!Number.isFinite(best)) best = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  return [ox + dx * (best + loopR), oy + dy * (best + loopR)];
}

/** The body's area centroid, for turning a dragged loop back into a bearing. */
export function centroidOf(body: Ring[]): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
  }
  if (Math.abs(area) > 1e-6) return [cx / (3 * area), cy / (3 * area)];
  const b = ringsBounds(body);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** The bearing of a point seen from the body's area centroid, degrees 0-360: what a keyring
 *  dragged to that point stands for (Position, with no Fine offset). */
export function bearingOf(body: Ring[], x: number, y: number): number {
  const [cx, cy] = centroidOf(body);
  const deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** How the built keyring shows on the canvas: a loop is a filled tab beyond the edge, a hole is
 *  the ring it is cut with, centred on the edge. */
export function keyringMark(loop: NonNullable<DesignLayout['loop']>): {
  label: string;
  /** How far the handle's centre sits out from the edge: a loop radius, or 0 for a hole. */
  edgeOut: number;
  /** Drawn as an outline only, with no tab to fill and no hole inside it. */
  ringOnly: boolean;
  /** Framed with the body: a hole's ring is half air past the edge, which needs no room. */
  framed: boolean;
} {
  const hole = loop.style === 'hole';
  return { label: hole ? 'Keyring hole' : 'Keyring loop', edgeOut: hole ? 0 : loop.outerR, ringOnly: hole, framed: !hole };
}
