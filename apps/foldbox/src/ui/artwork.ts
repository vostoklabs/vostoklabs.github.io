// Text and SVG in, `Artwork` out.
//
// This is the only asynchronous thing in the app, and it is deliberately fenced off
// here rather than pushed into the solve. A font is a fetch; the solve is straight-line
// 2D work that a slider drag runs sixty times a second. So the UI resolves the artwork
// ONCE, when the text or the face changes, and hands the result to `solve` as plain
// polygons — which is why a size slider still has no async flicker in it.
//
// What comes out is normalised: centred on the origin, longest side exactly 1, Y-up,
// outer rings CCW and holes CW. `placeMarks` scales it onto a face from there.

import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { FALLBACK_FONT_ID, getFont, getHorizontalContours } from '@vostok/fonts';
import { flattenSvgStyles } from '@vostok/ui-kit';
import { normalizeArtwork } from '../geometry/marks';
import type { Artwork, Poly, Pt } from '../types';

/** Em the glyphs are laid out at. Arbitrary: everything is normalised afterwards and
 *  the face's own size decides the millimetres. */
const LAYOUT_EM = 100;

/** One line of type, as outlines.
 *
 *  The fallback font is the symbol set (Material Symbols, filled), which is what makes a symbol dropped
 *  into the text field work: `getHorizontalContours` already reaches for the fallback
 *  for any glyph the chosen face does not carry, so there is no second code path for
 *  "text with a heart in it". */
export async function textArtwork(text: string, fontId: string): Promise<Artwork> {
  const line = text.trim();
  if (!line) throw new Error('Type something to put on the box.');
  const [font, fallbackFont] = await Promise.all([
    getFont(fontId),
    getFont(FALLBACK_FONT_ID).catch(() => null),
  ]);
  const layout = getHorizontalContours(
    font,
    fallbackFont,
    line,
    '',
    LAYOUT_EM,
    LAYOUT_EM,
    0,
    'left',
    1,
    0,
  );
  const rings = (layout.contours as Poly[]).filter((r) => r.length >= 3);
  if (!rings.length) {
    throw new Error('That face has no outlines for those characters. Try another one.');
  }
  // No Y flip: `pathCommandsToPolygons` already negates the font's Y-down coordinates,
  // so these arrive Y-up like the net. (The SVG side below DOES flip — raw SVG is
  // Y-down. Do not copy one line into the other.)
  return normalizeArtwork(rings, []);
}

// ──────────────────────────────────── SVG ────────────────────────────────────
//
// Two functions over the same file, and they MUST agree about what is in it: one
// describes the parts for the import window, the other traces the parts the user kept.
// They agree by both going through `read`, and by keying everything on the path's
// position in the file — which is what the window hands back a choice against.

/** How a part may be drawn. The same three the kit's import window offers. */
export type SvgMode = 'fill' | 'outline' | 'off';
/** Choices by path index, as a saved project carries them. */
export type SvgModes = Record<string, SvgMode>;

export interface SvgPart {
  index: number;
  /** How the FILE paints it. `none` is the one that surprises people. */
  kind: 'fill' | 'stroke' | 'none';
  strokeWidth?: number;
  /** Why a tracer would drop this on its own, so the window can show it as a flippable
   *  "Off" rather than as art that silently went missing. */
  why?: 'white' | 'artboard';
}

interface Read {
  index: number;
  kind: 'fill' | 'stroke' | 'none';
  strokeWidth: number;
  /** Closed rings, as the file's own filled shapes. Y already flipped. */
  rings: Poly[];
  /** Open polylines, one per subpath. Y already flipped. */
  lines: Poly[];
  white: boolean;
}

/** SVG's origin is top-left and the net's is bottom-left. */
const flip = (p: { x: number; y: number }): Pt => [p.x, -p.y];

function ringArea(ring: Poly): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j] as Pt)[0] * (ring[i] as Pt)[1] - (ring[i] as Pt)[0] * (ring[j] as Pt)[1];
  }
  return Math.abs(a / 2);
}

function boxOf(polys: Poly[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys) {
    for (const [x, y] of p) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/** Read the file once: every drawable path, both as rings and as polylines, so either
 *  reading is available to whichever mode the user picks. */
function read(svgText: string): Read[] {
  // Flattened first: a `<style>` block or a `style=""` attribute is read through the CSSOM, and
  // under the MakerLab host's `style-src 'self'` that read comes back empty, so an Illustrator
  // outline drawing would trace as a solid blob. Attributes are the one thing no policy blocks.
  // Every build, one code path: on the public site the result is the same paint either way.
  const data = new SVGLoader().parse(flattenSvgStyles(svgText));
  return data.paths.map((path, index) => {
    const style = (path.userData?.style ?? {}) as { fill?: string; stroke?: string; strokeWidth?: number };
    const filled = style.fill !== undefined && style.fill !== 'none';
    const stroked = style.stroke !== undefined && style.stroke !== 'none';

    const rings: Poly[] = [];
    for (const shape of SVGLoader.createShapes(path)) {
      const outer = shape.getPoints(16);
      if (outer.length >= 3) rings.push(outer.map(flip));
      for (const hole of shape.holes) {
        const hp = hole.getPoints(16);
        if (hp.length >= 3) rings.push(hp.map(flip));
      }
    }
    const lines: Poly[] = [];
    for (const sub of path.subPaths) {
      const pts = sub.getPoints(24);
      if (pts.length >= 2) lines.push(pts.map(flip));
    }

    const paint = (filled ? style.fill : style.stroke) ?? '';
    return {
      index,
      kind: filled ? 'fill' : stroked ? 'stroke' : 'none',
      strokeWidth: style.strokeWidth ?? 1,
      rings,
      lines,
      // A white shape on white card engraves nothing anyone can see, and it is nearly
      // always a background. Judged on the authored colour, which is all we have.
      white: /^#?(f{3}|f{6}|fff{3}f{3})$/i.test(paint.replace(/\s/g, '')) || /^white$/i.test(paint),
    };
  });
}

/** The parts, biggest first, with the reason a tracer would have dropped each one. */
export function describeSvg(svgText: string): { parts: SvgPart[]; issues: string[] } {
  const items = read(svgText);
  const issues: string[] = [];
  if (!items.length) issues.push('There are no paths in this file at all.');
  if (items.every((i) => i.kind === 'none')) {
    issues.push('No path in this file has a fill or a stroke, so nothing would be drawn.');
  }

  const whole = boxOf(items.flatMap((i) => [...i.rings, ...i.lines]));
  const fw = whole[2] - whole[0] || 1;
  const fh = whole[3] - whole[1] || 1;

  const parts: (SvgPart & { area: number })[] = items.map((i) => {
    const area = i.rings.reduce((n, r) => n + ringArea(r), 0);
    let why: SvgPart['why'];
    if (i.kind === 'fill') {
      const [x0, y0, x1, y1] = boxOf(i.rings);
      const gw = x1 - x0;
      const gh = y1 - y0;
      // The background heuristic, same as the magnet generator's: it has to span the
      // artboard AND fill its own box, so a big round logo is not mistaken for a backdrop.
      if (gw >= 0.92 * fw && gh >= 0.92 * fh && area >= 0.85 * (gw * gh || Infinity)) why = 'artboard';
      else if (i.white) why = 'white';
    }
    return { index: i.index, kind: i.kind, strokeWidth: i.kind === 'stroke' ? i.strokeWidth : undefined, why, area };
  });

  // Biggest first: the window lists them in this order, and the part someone wants to
  // switch off is almost always the biggest one.
  parts.sort((a, b) => b.area - a.area);
  return { parts: parts.map(({ area: _area, ...rest }) => rest), issues };
}

/** How a part starts out when nobody has chosen: as the file paints it, minus the two a
 *  tracer always dropped on its own — and a file with no fills anywhere is an outline
 *  drawing, whose useful reading is the outline. The import window applies the same rule,
 *  so a project saved before the window existed traces the same way. */
export function defaultSvgModes(parts: SvgPart[]): SvgModes {
  const modes: SvgModes = {};
  for (const p of parts) {
    modes[String(p.index)] = p.kind === 'none' || p.why ? 'off' : p.kind === 'fill' ? 'fill' : 'outline';
  }
  return modes;
}

/**
 * The artwork, as the chosen modes describe it.
 *
 * `fill` takes the path's closed shapes; on a stroke-only path it closes the subpaths
 * instead, which is what makes an outline drawing usable as a solid. `outline` takes the
 * subpaths as open polylines — the right answer for every machine here, because a laser
 * line and a pen both follow a path, so a 1 pt stroke should be one drawn line and not a
 * sausage traced round it. It is also why an outline has nothing to print as a second
 * colour, which the diagnostics say out loud.
 */
export function svgArtwork(svgText: string, modes?: SvgModes): Artwork {
  const items = read(svgText);
  const chosen = modes ?? defaultSvgModes(describeSvg(svgText).parts);
  const rings: Poly[] = [];
  const lines: Poly[] = [];

  for (const item of items) {
    const mode = chosen[String(item.index)] ?? 'off';
    if (mode === 'off') continue;
    if (mode === 'fill') {
      if (item.rings.length) rings.push(...item.rings);
      else rings.push(...item.lines.filter((l) => l.length >= 3));
    } else {
      lines.push(...(item.lines.length ? item.lines : item.rings));
    }
  }

  if (!rings.length && !lines.length) {
    throw new Error('Nothing is switched on, so there is no logo to put on the box.');
  }
  return normalizeArtwork(rings, lines);
}

/** Read a dropped file as text, so the caller keeps one `await`. */
export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
