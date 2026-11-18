/*
  What a press on the Design view takes, as rules node can test (designView.ts hands them to the
  canvas as each object's `hit`).

  The body is taken anywhere on it: inside its own outline, the keyring loop included. The picture
  is taken on its drawing, inside the hull round what it draws, not anywhere in its box: a round
  picture's box covers most of a round body, so a box rule left the body nothing to be pressed on
  but a thin band round a rectangle that only touches a round body at four points. Words and
  switches keep their boxes; they sit higher, so a press on one of them still takes it.
*/
import { convexHull, insideShapes } from '@vostok/shapes';
import type { Ring } from '../types';

type Pt = [number, number];

/** How the picture is placed on the cap: turned by `r` degrees, scaled by `s`, moved by (ox, oy). */
export interface ArtPlacement {
  s: number;
  ox: number;
  oy: number;
  r: number;
}

/** A press at (x, y) mm is on the body: inside its outline, even-odd, so a loop's hole is not. */
export function onBody(body: Ring[]): (x: number, y: number) => boolean {
  return (x, y) => insideShapes([body], [x, y]);
}

/** The hull round everything a picture draws, in the picture's own units. */
export function artHull(regions: readonly { rings: Ring[] }[]): Pt[] {
  function* points() {
    for (const r of regions) for (const ring of r.rings) for (const p of ring) yield p;
  }
  return convexHull(points());
}

/** A point on the cap, mm, in the picture's own units: the placement undone. */
export function toArt(t: ArtPlacement, x: number, y: number): Pt {
  const dx = (x - t.ox) / (t.s || 1);
  const dy = (y - t.oy) / (t.s || 1);
  const a = (-t.r * Math.PI) / 180;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/** A press at (x, y) mm is on the picture: inside the hull round its drawing, placed as `t` says.
 *  A hull with no area (one line, a dot) takes nothing. */
export function onArt(hull: Pt[], t: ArtPlacement): (x: number, y: number) => boolean {
  if (hull.length < 3) return () => false;
  return (x, y) => insideShapes([[hull]], toArt(t, x, y));
}
