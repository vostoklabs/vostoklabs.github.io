// Patterns on the box: which faces, and where on each face.
//
// A decoration is ONE pattern, on a set of faces, filling either the whole face or a window of
// a shape (a heart, a circle…) centred on it. Each face is filled on its own — the pattern is
// centred on that face's window — so a lattice reads the same on every side instead of being
// cut wherever one long strip of it happened to fall.
//
// The room a face has is its CLEAR rectangle (slabs.ts `clearRect`: the face minus every joint
// strip, the floor's slot band, a hinge's rounds) less a margin, so a cut-out can never reach a
// finger, a slot or the edge. A window shape is fitted inside that room and can be made smaller
// and slid about; it is never allowed out of it. Everything here is pure — the worker turns
// the regions into cuts, scores and engraves.
import type { FaceId, Ring, Shapes } from './types';
import type { PieceDraft } from './boxes';
import { archRing, cloudRing, ellipseRing, heartRing, polygonRing, starRing } from '@vostok/laser/blanks';
import type { OPS } from '@vostok/laser/ops';
import { circleRing } from '@vostok/laser/rings';
import { rectRing } from '@vostok/shapes';

/** What a pattern is made with: one of the laser's three operations. */
export type PatternOp = keyof typeof OPS;

export type WindowShape = 'face' | 'circle' | 'oval' | 'heart' | 'star' | 'hexagon' | 'diamond' | 'arch' | 'cloud';

/** Which faces a decoration goes on: a preset, or the customer's own pick. */
export type FacePreset = 'lid' | 'sides' | 'front' | 'all' | 'pick';

export interface Decoration {
  on: FacePreset;
  /** The faces when `on` is 'pick'. */
  faces: FaceId[];
  pattern: string;
  op: PatternOp;
  /** Pattern zoom, % (100 = the pattern's own size). */
  zoom: number;
  angle: number;
  /** Slide the pattern, mm. */
  dx: number;
  dy: number;
  /** Least wood between two cut-outs, and between a cut-out and the edge, mm. */
  web: number;
  /** Clear border kept round the decoration's room on every face, mm. */
  margin: number;
  window: WindowShape;
  /** Window size, % of the biggest that fits the face's room. */
  windowSize: number;
  /** Slide the window, mm (it stays inside the room). */
  windowX: number;
  windowY: number;
  /** Score the window's outline as a frame. */
  frame: boolean;
}

/** The faces a preset means on a box that has (or has no) lid. */
export function facesOf(d: Decoration, hasLid: boolean): FaceId[] {
  switch (d.on) {
    case 'lid':
      return hasLid ? ['lid'] : [];
    case 'front':
      return ['front'];
    case 'sides':
      return ['front', 'back', 'left', 'right'];
    case 'all':
      return hasLid ? ['lid', 'front', 'back', 'left', 'right'] : ['front', 'back', 'left', 'right'];
    case 'pick':
      return d.faces.filter((f) => hasLid || f !== 'lid');
  }
}

/** A piece's room for a decoration: its clear rectangle less the margin. Null when too small. */
export function roomOf(p: PieceDraft, margin: number): { u0: number; v0: number; u1: number; v1: number } | null {
  if (!p.safe) return null;
  const r = { u0: p.safe.u0 + margin, v0: p.safe.v0 + margin, u1: p.safe.u1 - margin, v1: p.safe.v1 - margin };
  return r.u1 - r.u0 >= 8 && r.v1 - r.v0 >= 8 ? r : null;
}

/** A shape's outline, `w` × `h`, centred on the origin, counter-clockwise — the house shapes
 *  from @vostok/laser, so a heart here is the heart on every other Vostok tool. */
export function windowRing(shape: WindowShape, w: number, h: number): Ring {
  switch (shape) {
    case 'circle':
      return circleRing(0, 0, Math.min(w, h) / 2, 96);
    case 'oval':
      return ellipseRing(w, h, 96);
    case 'heart':
      return heartRing(w, h);
    case 'star':
      return starRing(w, h);
    case 'hexagon':
      return polygonRing(w, h, 6, 0);
    case 'diamond':
      return polygonRing(w, h, 4);
    case 'arch':
      return archRing(w, h);
    case 'cloud':
      return cloudRing(w, h);
    default:
      return rectRing(-w / 2, -h / 2, w / 2, h / 2);
  }
}

/** How tall a shape of width w wants to be — its natural proportion, so "Size" grows it
 *  without squashing. 0 = it takes whatever the room gives (the whole face, an oval). */
function aspectOf(shape: WindowShape): number {
  switch (shape) {
    case 'circle':
    case 'star':
      return 1;
    case 'heart':
      return 0.9;
    case 'hexagon':
      return 0.866;
    case 'diamond':
      return 1.25;
    case 'arch':
      return 1.3;
    case 'cloud':
      return 0.62;
    default:
      return 0;
  }
}

export interface FaceRegion {
  /** The region the pattern fills, in the piece's frame. */
  region: Shapes;
  /** The window's outline when it is framed (scored). */
  frame: Ring | null;
  /** The room the region sits in. */
  room: { u0: number; v0: number; u1: number; v1: number };
}

/**
 * Where the decoration goes on one piece: the window, sized and slid inside the room. The whole
 * face is the room itself; a shape is the largest of its proportion that fits, scaled by Size,
 * then moved by X/Y — held inside the room.
 */
export function regionOn(p: PieceDraft, d: Decoration): FaceRegion | null {
  const room = roomOf(p, d.margin);
  if (!room) return null;
  const rw = room.u1 - room.u0;
  const rh = room.v1 - room.v0;
  const cx = (room.u0 + room.u1) / 2;
  const cy = (room.v0 + room.v1) / 2;
  if (d.window === 'face') {
    const ring = rectRing(room.u0, room.v0, room.u1, room.v1);
    return { region: [[ring]], frame: d.frame ? ring : null, room };
  }
  const k = Math.max(0.15, Math.min(1, d.windowSize / 100));
  const aspect = aspectOf(d.window);
  let w = rw;
  let h = rh;
  if (aspect > 0) {
    // The biggest w × (w·aspect) inside rw × rh.
    w = Math.min(rw, rh / aspect);
    h = w * aspect;
  }
  w *= k;
  h *= k;
  const slackX = (rw - w) / 2;
  const slackY = (rh - h) / 2;
  const x = cx + Math.max(-slackX, Math.min(slackX, d.windowX));
  const y = cy + Math.max(-slackY, Math.min(slackY, d.windowY));
  const ring = windowRing(d.window, w, h).map(([a, b]) => [a + x, b + y] as [number, number]);
  return { region: [[ring]], frame: d.frame ? ring : null, room };
}
