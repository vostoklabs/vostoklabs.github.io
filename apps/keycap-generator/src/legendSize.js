/**
 * How big a legend is drawn: the Size slider's ceiling, how text keeps its size, and text set as
 * type at one size across a set of caps (the end of the file).
 *
 * The Size slider is the legend's LONGER side. That is right for an icon, which is about as wide as
 * it is tall, and wrong for a word: "Shift" at the 7.6 mm a single letter gets is 7.6 mm WIDE, so
 * its letters come out a third of the height of an "A". And every cap swap reset the size to half
 * the top's short side, which is the same 7.6 mm on a 1u and on a 2u, so a 2u's "Shift" was exactly
 * as small as a 1u's.
 *
 * So for text the app remembers the letter HEIGHT that was asked for (by the Size slider, read
 * through the text's own proportions) and keeps it when the text, the font or the cap changes.
 * A word grows wide on a wide cap; on a cap it would not fit, it shrinks just enough to fit, and
 * comes back to the height asked for on the next cap that has the room. Icons are unchanged.
 *
 * No DOM, no app state: boxes in, millimetres out.
 */

/** A share of the top's extent a legend may use: the same allowance the app always had. */
const FILL = 0.95;

/** The legend's own proportions: its longer side and its height, in its own units. */
function sides(box) {
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  return { long: Math.max(w, h), short: Math.min(w, h), h };
}

/**
 * The Size slider's ceiling for this legend on this cap.
 *
 * A wide legend may use the cap's length, as long as its height still fits the short side; a
 * square one only the short side.
 *
 * @param {{min:{x:number,y:number}, max:{x:number,y:number}}|null} box  the legend's box, or none yet
 * @param {[number, number]} topExtent  the cap's usable top, width and depth (meta.topExtent)
 */
export function legendSizeMax(box, topExtent) {
  const capLong = Math.max(topExtent[0], topExtent[1]);
  const capShort = Math.min(topExtent[0], topExtent[1]);
  let maxW = capShort;
  if (box) {
    const { long, short } = sides(box);
    const aspect = short > 1e-6 ? long / short : 1;
    maxW = Math.min(capLong, capShort * aspect);
  }
  return maxW * FILL;
}

/** The height a text legend's letters come out at when its longer side is `size` mm. */
export function textHeightOf(box, size) {
  const { long, h } = sides(box);
  return long > 1e-6 ? (size * h) / long : size;
}

/**
 * The Size (longer side) that draws this text `heightMM` tall, or as tall as fits under `maxSize`.
 * Rounded to the slider's 0.1 mm step, down, so it never lands past the ceiling.
 */
export function sizeForTextHeight(box, heightMM, maxSize) {
  const { long, h } = sides(box);
  const wanted = h > 1e-6 ? (heightMM * long) / h : heightMM;
  return Math.floor(Math.min(wanted, maxSize) * 10 + 1e-6) / 10;
}

// -------------------------------------------------------------------------- text set as type

/**
 * Text set as type: the scale a letter legend is drawn at when several legends have to read as
 * one typeface at one size (a set of caps), and the point of it that lands on the cap's middle.
 *
 * THE RULE: the scale comes from the FONT, its cap height (`legend.metrics.capHeight`, which
 * parseLetter carries), never from the legend's own box. Sizing each legend by its own box is
 * right for one cap, where you drag one symbol to the size you want; across a set it gives every
 * legend the same ink height whatever it is, so "a" comes out as tall as "b", "W" shorter than
 * "I", and a period a 7 mm square. One factor per font: every capital is `capHeightMM` tall.
 *
 * THE ANCHOR:
 *  - `band` centres the cap-height band, so every legend sits on one line of type: a small
 *    letter on the same baseline as a capital, a descender hanging below it.
 *  - `ink` centres the glyph itself, for a legend that has the cap to itself and no line of type
 *    to sit on.
 *
 * @param {{ box: {min:{y:number}, max:{y:number}}, metrics: { capHeight: number } }} legend
 *        a parsed letter legend; its box has the baseline at y = 0 and the cap line at -capHeight
 * @param {number} capHeightMM  how tall a capital is drawn
 * @param {'band'|'ink'} [anchor]
 * @returns {{ unit: number, anchorY: number }}  millimetres per font unit, and the y (in the
 *          legend's own box) placed on the cap's middle
 */
export function typeScale(legend, capHeightMM, anchor = 'band') {
  return {
    unit: capHeightMM / legend.metrics.capHeight,
    anchorY: anchor === 'ink'
      ? (legend.box.min.y + legend.box.max.y) / 2 // its own middle
      : -legend.metrics.capHeight / 2, // box coords: baseline 0, cap line -capHeight
  };
}

/**
 * Where a legend drawn at `unit` millimetres a unit sits on a cap, and how big, with `anchorY` on
 * the cap's middle: what buildBodies takes, as `widthMM` and a nudge (`dx`, `dy`) to add to the
 * centre.
 *
 * The carve's only size handle is `widthMM`, which transformContours turns back into a scale as
 * `widthMM / max(width, height)` of this same box; so an exact scale is handed over as
 * `longer side * scale`. And transformContours centres the ink box, so the anchor is the nudge
 * from the ink's middle to `anchorY`, turned by the legend's rotation because the carve turns
 * before it moves.
 *
 * Shrunk to fit `fill` of the cap's top, and `fit` says by how much (1 when it fits). The height
 * is measured about the ANCHOR, since that is what lands on the middle: a descender genuinely
 * hangs below it, and without this a "y" could run off the flat top onto the chamfer.
 *
 * @param {object} legend  a parsed legend: its `box`
 * @param {{ topExtent: [number, number] }} meta  the cap
 * @param {number} unit  millimetres per legend unit
 * @param {number} anchorY  the y of the legend's box that goes on the cap's middle
 * @param {number} [rotationDeg]
 * @param {number} [fill]  the share of the top the legend may use; the Size slider's own by default
 * @returns {{widthMM: number, w: number, h: number, dx: number, dy: number, fit: number}|null}
 *          null for a legend with no extent
 */
export function placeLegend(legend, meta, unit, anchorY, rotationDeg = 0, fill = FILL) {
  const bw = legend.box.max.x - legend.box.min.x;
  const bh = legend.box.max.y - legend.box.min.y;
  const span = Math.max(bw, bh);
  if (!(span > 1e-6)) return null;

  const needH = 2 * Math.max(Math.abs(anchorY - legend.box.min.y), Math.abs(anchorY - legend.box.max.y));
  const fit = Math.min(
    1,
    (meta.topExtent[0] * fill) / (bw * unit),
    (meta.topExtent[1] * fill) / (needH * unit),
  );
  const s = unit * fit;

  const cy = (legend.box.min.y + legend.box.max.y) / 2;
  const dY = s * (anchorY - cy);
  const a = (rotationDeg * Math.PI) / 180;
  return {
    widthMM: span * s,
    w: bw * s,
    h: bh * s,
    dx: -dY * Math.sin(a),
    dy: dY * Math.cos(a),
    fit,
  };
}
