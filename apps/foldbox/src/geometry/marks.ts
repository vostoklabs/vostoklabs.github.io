// Where the logo goes.
//
// A mark is the one thing on a dieline that is neither cut nor folded. It arrives as
// an `Artwork` — rings and lines in a unit box, made by the UI from text or an SVG —
// and leaves as a `Mark`: the same shapes scaled onto one face of the box, in net
// coordinates, wound so an exporter can tell a letter from the hole in it.
//
// Two rules do all the work here, and both are the window's:
//
//   · A face is the panel's `windowRect` when it has one and its bounding box when it
//     does not. The rect exists because a mailer's lid carries its hang tab as the same
//     ply with no crease between, so the bounding box swallows the tab and centres
//     everything on lid-plus-tab rather than on the box's top.
//   · The mark stays clear of every fold and cut by an inset. On card a couple of
//     millimetres is plenty for a line a laser draws. On a printed sheet it is the
//     groove's own half-opening plus a margin, because the logo is inlaid into the
//     FIRST layer and the first layer near a fold IS the hinge — an inlay there would
//     cut the hinge in two.
//
// A logo that does not fit is dropped and said so, never squeezed onto a tab or drawn
// across a window: the diagnostics carry the reason and the dieline simply has no
// logo on it.

import type { Artwork, BoxParams, Mark, Net, Panel, Poly, Pt, StyleId } from '../types';
import { at, bboxOf, pointInRing, signedArea } from './poly';
import { WINDOW_PANEL, styleMeta } from './styles';
import { grooveHalfOpeningMm } from './fit';

/** How close a mark may come to a fold or a cut on card, mm. */
const CUT_INSET_MM = 2.5;
/** Extra clearance past the groove's opening on a printed sheet, mm. */
const PRINT_MARGIN_MM = 1.5;
/** A face this small has no room for anything readable. */
const MIN_FACE_MM = 10;

/** Consecutive duplicate points, and a closing point that repeats the first. */
function dedupe(poly: Poly): Poly {
  const out: Poly = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    out.pop();
  }
  return out;
}

/** Outer rings CCW, holes CW, decided by NESTING rather than by whatever the source
 *  wound them: a TrueType outline is clockwise-outside, a CFF one is the opposite, an
 *  SVG is whatever the artist drew, and a mirror flips all three. Depth is how many
 *  other rings contain this one; even is an outer, odd is a hole. Rings that cross —
 *  two letters of a script face that touch — are left as they are: they tessellate
 *  even-odd either way, which is the same thing every SVG renderer would do. */
export function windByNesting(rings: Poly[]): Poly[] {
  return rings.map((r) => {
    const probe = at(r, 0);
    let depth = 0;
    for (const other of rings) {
      if (other !== r && pointInRing(probe, other)) depth++;
    }
    const ccw = signedArea(r) > 0;
    return depth % 2 === 0 ? (ccw ? r : [...r].reverse()) : ccw ? [...r].reverse() : r;
  });
}

/** Centre the art on the origin and scale it so its longest side is 1. The face
 *  decides the millimetres later; this just makes "50% of the face" mean the same
 *  thing for a word and for a badge. Rings that are not shapes — the odd two-point
 *  contour a font emits, the slivers a stroke tessellation leaves — are dropped here. */
export function normalizeArtwork(rings: Poly[], lines: Poly[]): Artwork {
  const box = bboxOf([...rings, ...lines]);
  const side = Math.max(box[2] - box[0], box[3] - box[1]) || 1;
  const cleanRings = rings
    .map(dedupe)
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > side * side * 1e-8);
  const cleanLines = lines.map(dedupe).filter((l) => l.length >= 2);
  const all = bboxOf([...cleanRings, ...cleanLines]);
  const cx = (all[0] + all[2]) / 2;
  const cy = (all[1] + all[3]) / 2;
  const maxSide = Math.max(all[2] - all[0], all[3] - all[1]) || 1;
  const norm = (p: Poly): Poly => p.map(([x, y]) => [(x - cx) / maxSide, (y - cy) / maxSide] as Pt);
  return { rings: windByNesting(cleanRings.map(norm)), lines: cleanLines.map(norm) };
}

/** The clear rectangle of a face, [x, y, w, h]. */
function faceRect(panel: Panel): [number, number, number, number] {
  if (panel.windowRect) return panel.windowRect;
  const [x0, y0, x1, y1] = bboxOf([panel.outline]);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Which panels a logo may go on, first entry being the default.
 *
 *  The window's own list when the style has one — its labels say which face is the
 *  front — and otherwise every lid, base and wall big enough to carry anything, the
 *  style's front face first. Read off the built net rather than a static table, so a
 *  panel that a size or an option has squeezed away is never offered. */
export function logoFaces(net: Net, style: StyleId): { id: string; label: string }[] {
  const byId = new Map(net.panels.map((p) => [p.id, p]));
  const usable = (p: Panel): boolean => {
    const [, , w, h] = faceRect(p);
    return w >= MIN_FACE_MM && h >= MIN_FACE_MM;
  };
  const listed = styleMeta(style).windowFaces;
  if (listed) {
    return listed.filter((f) => {
      const p = byId.get(f.id);
      return p !== undefined && usable(p);
    });
  }
  const front = WINDOW_PANEL[style];
  const rank = (p: Panel): number =>
    p.id === front ? 0 : p.role === 'lid' ? 1 : p.role === 'base' ? 2 : 3;
  return numbered(
    net.panels
      .filter((p) => (p.role === 'lid' || p.role === 'base' || p.role === 'body') && usable(p))
      .sort((a, b) => rank(a) - rank(b))
      .map((p) => ({ id: p.id, label: p.label.charAt(0).toUpperCase() + p.label.slice(1) })),
  );
}

/** Number the labels that repeat, and leave the rest alone.
 *
 *  A panel's label describes its JOB, not its position, so a tray has two of everything
 *  that comes in pairs: its face list came out as "Base, Front, Back, End wall, End wall",
 *  and the last two are a choice between two identical words. Numbering only the
 *  duplicates keeps "Base" as "Base" — suffixing everything would make a one-of-a-kind
 *  face look like one of a set. */
function numbered(faces: { id: string; label: string }[]): { id: string; label: string }[] {
  const total = new Map<string, number>();
  for (const f of faces) total.set(f.label, (total.get(f.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return faces.map((f) => {
    if ((total.get(f.label) ?? 0) < 2) return f;
    const n = (seen.get(f.label) ?? 0) + 1;
    seen.set(f.label, n);
    return { id: f.id, label: `${f.label} ${n}` };
  });
}

/** The panel this configuration's logo goes on, or '' when the style has no face for
 *  one. Like `windowHost`: a remembered face is honoured only when the current net
 *  offers it, so a preset cannot put a logo on a panel that is not there. */
export function logoHost(net: Net, p: BoxParams): string {
  const faces = logoFaces(net, p.style);
  if (p.logoFace && faces.some((f) => f.id === p.logoFace)) return p.logoFace;
  return faces[0]?.id ?? '';
}

export type MarkProblem = 'none' | 'no-face' | 'no-room' | 'conflict';

/** Which face of the sheet the marks live on — see `Net.markFace`. */
export function markFaceFor(p: BoxParams): 'top' | 'bottom' {
  return p.makeMode === 'print' ? 'bottom' : 'top';
}

/** How far the mark keeps from every fold and cut on this face. */
export function markInsetMm(p: BoxParams): number {
  return p.makeMode === 'print' ? grooveHalfOpeningMm(p) + PRINT_MARGIN_MM : CUT_INSET_MM;
}

function rotateQuarter(poly: Poly, turns: number): Poly {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return poly.map(([x, y]) => [-y, x] as Pt);
    case 2:
      return poly.map(([x, y]) => [-x, -y] as Pt);
    case 3:
      return poly.map(([x, y]) => [y, -x] as Pt);
    default:
      return poly;
  }
}

/** Every vertex and every edge midpoint. A ring can sit with all its corners inside
 *  a notched panel and still cross the notch, so the midpoints are checked too. */
function samples(poly: Poly, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const a = at(poly, i);
    out.push(a);
    if (i < n) {
      const b = at(poly, i + 1);
      out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return out;
}

/** Place the artwork on the box. Returns no marks — and says why — rather than a
 *  logo that would run across a fold, off a tab, or into the window. */
export function placeMarks(
  net: Net,
  p: BoxParams,
  art: Artwork | null,
): { marks: Mark[]; problem: MarkProblem } {
  if (!art || (!art.rings.length && !art.lines.length)) return { marks: [], problem: 'none' };
  const hostId = logoHost(net, p);
  const panel = net.panels.find((x) => x.id === hostId);
  if (!panel) return { marks: [], problem: 'no-face' };

  const [rx, ry, rw, rh] = faceRect(panel);
  const inset = markInsetMm(p);
  const availW = rw - 2 * inset;
  const availH = rh - 2 * inset;
  if (availW < 4 || availH < 4) return { marks: [], problem: 'no-room' };

  const turns = p.logoRotation / 90;
  const rings = art.rings.map((r) => rotateQuarter(r, turns));
  const lines = art.lines.map((l) => rotateQuarter(l, turns));
  const [ax0, ay0, ax1, ay1] = bboxOf([...rings, ...lines]);
  const aw = Math.max(ax1 - ax0, 1e-9);
  const ah = Math.max(ay1 - ay0, 1e-9);
  const acx = (ax0 + ax1) / 2;
  const acy = (ay0 + ay1) / 2;
  const scale = Math.max(0.02, Math.min(1, p.logoScale));
  const s = Math.min((availW * scale) / aw, (availH * scale) / ah);

  // The face's centre, and — for a printed sheet — a mirror about it, so the inlay
  // in the underside reads the right way round from outside the box.
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const flip = markFaceFor(p) === 'bottom' ? -1 : 1;
  const place = (poly: Poly): Poly =>
    poly.map(([x, y]) => [cx + flip * s * (x - acx), cy + s * (y - acy)] as Pt);

  const placedRings = windByNesting(rings.map(place));
  const placedLines = lines.map(place);

  // It has to lie on the panel — all of it — and clear of everything already cut in
  // the panel. A logo over the window is not a logo, and a slot inside a letter would
  // print the letter as a ring.
  const probes = [
    ...placedRings.map((r) => samples(r, true)),
    ...placedLines.map((l) => samples(l, false)),
  ];
  for (const poly of probes) {
    for (const pt of poly) {
      if (!pointInRing(pt, panel.outline)) return { marks: [], problem: 'no-room' };
      if (panel.holes.some((h) => pointInRing(pt, h))) return { marks: [], problem: 'conflict' };
    }
  }
  for (const h of panel.holes) {
    for (const pt of h) {
      if (placedRings.some((r) => signedArea(r) > 0 && pointInRing(pt, r))) {
        return { marks: [], problem: 'conflict' };
      }
    }
  }

  return { marks: [{ panelId: panel.id, rings: placedRings, lines: placedLines }], problem: 'none' };
}
