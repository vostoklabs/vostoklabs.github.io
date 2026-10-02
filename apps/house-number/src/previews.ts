/**
 * Thumbnails for the example cards, drawn from the code that builds the model.
 *
 * `sampleGrid` takes an `<img src>`, so the obvious move is four PNGs in `public/`. Four
 * PNGs is how a thumbnail comes to promise a shape the generator no longer makes: change a
 * corner radius or a preset and the picture keeps showing the old one, silently.
 *
 * The first version here dodged that for the outline but not for the text — it estimated the
 * text box at 0.62 em per character and set the number as an SVG `<text>`. That put the card
 * and the model visibly out of step: the plate came out the wrong proportion, and the glyphs
 * were the browser's idea of the face rather than the outlines that get extruded.
 *
 * So this takes the parsed font and runs the real thing: `getHorizontalContours` /
 * `getVerticalContours` for the layout, `plateSizeFor` and `plateOutline` for the plate,
 * `screwHolePositions` and `keyhole` for the mounting. Every path in the card is a path the
 * model is built from, so the two cannot disagree. Cheap enough for four cards — it is the
 * same arithmetic the worker does, minus manifold.
 */
import { getHorizontalContours, getVerticalContours } from '@vostok/fonts';
import {
  bboxOf, circle, keyhole, keyholePositions, plateOutline, plateSizeFor,
  lineContour, labelBarContour, glyphReach, bandContour, screwHolePositions, screwHolePositions4,
} from './geometry/outlines';
import { atScale, isSideBySide, SCREW_HOLE_ROOM_MM, type SignParams } from './types';

const path = (loop: number[][]) =>
  `M${loop.map((pt) => `${pt[0]!.toFixed(2)},${(-pt[1]!).toFixed(2)}`).join('L')}Z`;

/**
 * Where a bridging bar must reach to catch every glyph, measured the same way the model does.
 *
 * Guessing this with a fraction of the block height is what turned the Street card's bar into
 * a slab across the number: a 70 mm row of digits has no descender, so a quarter of its height
 * was 17.5 mm of bite it did not need.
 */
function reachOf(layout: { contours: number[][][]; lines: Array<{ minX: number; maxX: number; minY: number; maxY: number }> }) {
  const [a, b] = layout.lines;
  if (!a || !b) return {};
  const upper = a.minY < b.minY ? b : a;
  const lower = a.minY < b.minY ? a : b;
  return {
    reachUp: glyphReach(layout.contours, upper).highestBottom,
    reachDown: glyphReach(layout.contours, lower).lowestTop,
  };
}

/**
 * Card colours, deliberately not the user's filaments — but following the app's theme.
 *
 * Painting the cards in the chosen filaments meant they changed every time a colour did, and
 * on the default black plate half the templates were a dark rectangle on a dark panel —
 * *Name in a band*, *Inset panel*, *Apartment* and *Office door* were all invisible. A card
 * is a diagram of a shape, not a preview of a print; it has one job, which is to be legible
 * at 100 px against the panel it sits on. The stage shows the real colours.
 *
 * One fixed palette could not do that job in both themes, though, and it was tuned for
 * neither. The card sits on `--panel-2`, which flips with the theme while the ink did not:
 * in light mode the plate (`#e8e9eb`) landed on a `#edf0f5` card and vanished, and in dark
 * mode a light plate under dark type inverted the model it is a picture of — the *Edge band*
 * card drew a dark stripe where the sign prints a white one. *Street, no plate* was the worst
 * of it: with no plate to carry them the glyphs were dark ink straight onto a dark card.
 *
 * So the diagram flips with the page. In dark mode it also lands where the shipped filaments
 * already are — black plate, white legend — so the card and the stage agree by default.
 */
export type PreviewTheme = 'dark' | 'light';

interface Ink {
  plate: string; text: string; frame: string; band: string; panel: string; hole: string;
  /** Hairline round the plate. See below — a same-key plate cannot show its own silhouette. */
  edge: string;
  /**
   * What shows through a cut that goes all the way out — `--panel-2`, which is exactly what
   * the card the picture sits on is painted in, so it reads as a hole rather than as a fill.
   */
  void: string;
}

/*
 * The plate carries a drawn edge because in a themed palette it cannot carry its own.
 *
 * The card sits on `--panel-2`, and once the plate matches the theme it is by definition
 * close in key to the surface behind it: `#0e1014` on `#252932` is a contrast ratio of 1.31,
 * and even pure black only reaches 1.44 — there is nowhere darker to go. Light mode is the
 * same problem mirrored, at 1.20. The silhouette is the entire difference between *House*,
 * *Mailbox* and *Apartment* at 100 px, so it cannot rest on the fill.
 */
const INK: Record<PreviewTheme, Ink> = {
  dark: {
    plate: '#0e1014',
    edge: '#5c6472',
    text: '#f2f4f8',
    frame: '#f2f4f8',
    band: '#f2f4f8',
    panel: '#767c88',
    hole: '#4b5160',
    void: '#252932',
  },
  light: {
    plate: '#d7dbe2',
    edge: '#98a0ad',
    text: '#15171c',
    frame: '#15171c',
    band: '#15171c',
    panel: '#9aa0ab',
    hole: '#767c88',
    void: '#edf0f5',
  },
};

/**
 * An SVG data URI of this preset's sign, at the size and shape the model will be.
 *
 * `font` is the parsed opentype face. Without it the card cannot be faithful, so the caller
 * renders a placeholder until the font resolves and then repaints — see `main.ts`.
 */
export function platePreviewSvg(raw: SignParams, font: any, theme: PreviewTheme = 'dark'): string {
  // The same fold the build does. A card is normalised to its own viewBox, so a uniform scale
  // is invisible in it — but not everything scales, so at 3x the screw holes really are
  // proportionally smaller and the card has to show that or it stops being a picture of the
  // model. Cheap, and it keeps the two on the same input.
  const params = atScale(raw);
  const ink = INK[theme];
  const text = params.text.trim() || '12';
  const text2 = params.text2.trim();

  const layout = params.orientation === 'vertical'
    ? getVerticalContours(font, font, text, params.textSize, params.stackSpacing, 0)
    : getHorizontalContours(
        font, font, text, text2,
        params.textSize, params.line2Size, 0, params.align,
        params.lineSpacing, params.letterSpacing,
        { alignMode: 'block', placement: params.linePlacement, vAlign: params.vAlign },
      );

  /*
   * The plateless case moves the TEXT to the line, so the card has to move it too.
   *
   * The model stopped stretching the bar and started sliding the two blocks in to meet it —
   * and the card kept stretching, so it drew a filled slab where the model has a thin rule.
   * The same arithmetic, in the same order, or the picture lies about the thing it is a
   * picture of.
   */
  const beside = isSideBySide(params.linePlacement);
  const bridge = params.shape === 'none';
  const reach = reachOf(layout);
  let glyphContours = layout.contours;

  if (params.divider === 'line' && bridge && !beside && layout.lines.length >= 2
      && reach.reachUp !== undefined && reach.reachDown !== undefined) {
    const [a, b] = layout.lines;
    const upper = a!.minY < b!.minY ? b! : a!;
    const lower = a!.minY < b!.minY ? a! : b!;
    const t = Math.max(0.2, params.lineThickness) / 2;
    const mid = (lower.maxY + upper.minY) / 2 + params.lineOffset;
    const OVERLAP = 0.4;
    const up = (mid + t - OVERLAP) - reach.reachUp;
    const down = (mid - t + OVERLAP) - reach.reachDown;
    glyphContours = layout.contours.map((loop) => {
      const ys = loop.map((q) => q[1]!);
      const dy = (Math.min(...ys) + Math.max(...ys)) / 2 > mid ? up : down;
      return loop.map((q) => [q[0]!, q[1]! + dy] as number[]);
    });
  }

  const bar = params.divider !== 'none' && !(params.divider === 'band' && layout.lines.length >= 2)
    ? lineContour(layout.lines, bboxOf(glyphContours), {
        thickness: params.lineThickness,
        overhang: params.lineOverhang,
        length: params.lineLength,
        offset: params.lineOffset,
        beside,
        bridge: bridge && beside,
        ...reach,
      })
    : null;

  const label = params.divider === 'band' && layout.lines.length >= 2
    ? labelBarContour(layout.lines[1]!, Math.max(1, params.lineThickness),
                      Math.max(1, params.lineThickness) * 0.6, params.lineOverhang)
    : null;

  const extra = [...(bar ? [bar] : []), ...(label ? [label] : [])];
  const box = extra.length ? bboxOf([...glyphContours, ...extra]) : bboxOf(glyphContours);
  const frameOn = params.frameOn && params.shape !== 'none';
  const panelOn = params.panelOn && params.shape !== 'none';
  const frameW = frameOn ? params.frameWidth : 0;
  // The panel is paid for in the plate's size, exactly as the model does it.
  const clearance = params.padding + frameW + (panelOn ? params.panelInset : 0);
  // The same constant strip the model reserves, and for the same reason — see
  // `SCREW_HOLE_ROOM_MM`. A card that sized itself from the screw diameter would draw a
  // different plate from the one the build makes.
  const holeRoom = params.mount === 'screws' && params.shape !== 'none' ? SCREW_HOLE_ROOM_MM : 0;

  const { width } = plateSizeFor(box, clearance + holeRoom, params.shape, params.cornerRadius);
  const { height } = plateSizeFor(box, clearance, params.shape, params.cornerRadius);

  // buildSign centres the text on the origin; the card has to do the same or the two drift.
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const shift = (loop: number[][]) => path(loop.map((pt) => [pt[0]! - cx, pt[1]! - cy]));
  // `evenodd` below, so the label bar and the glyphs sitting inside it knock out rather than
  // merge — that is what makes the second line read as reversed-out type.
  const glyphs = [...glyphContours, ...extra].map(shift).join('');

  const outline = params.shape === 'none' ? [] : plateOutline(params.shape, width, height, params.cornerRadius);
  const plate = outline.map(path).join('');

  // Mounting is part of what distinguishes one example from another — the apartment plate is
  // the screw-mounted one — so the holes belong in the picture.
  let mounting = '';
  if (params.shape !== 'none' && params.mount === 'screws') {
    const inset = Math.max(params.mountInset, frameOn ? params.frameWidth + params.mountHoleDia : 0);
    mounting = (params.mountFourHoles
      ? screwHolePositions4(width, height, params.mountHoleDia, inset)
      : screwHolePositions(width, height, params.mountHoleDia, inset, params.mountOffsetY))
      .map(([hx, hy]) => path(circle(hx, hy, params.mountHoleDia / 2)))
      .join('');
  } else if (params.shape !== 'none' && params.mount === 'keyhole') {
    // Only the mouth is drawn: the chamber is behind it and would read as a blob.
    const headDia = params.mountHoleDia * 2.2;
    const travel = Math.max(headDia, params.mountHoleDia * 2);
    const wall = Math.max(1.5, headDia * 0.5);
    const topRoom = height / 2 - travel - headDia / 2 - wall;
    const lowRoom = -(height / 2 - headDia / 2 - wall);
    const wantedY = height / 2 - clearance - travel + params.mountOffsetY;
    const ky = Math.min(Math.max(wantedY, lowRoom), Math.max(lowRoom, topRoom));
    mounting = keyholePositions(width, headDia, params.mountInset)
      .flatMap((kx) => keyhole(kx, ky, headDia, params.mountHoleDia, travel).mouth)
      .map(path)
      .join('');
  }

  const span = Math.max(width, height, 1) * 1.1;
  const view = `${-span / 2} ${-span / 2} ${span} ${span}`;

  // The frame reads as a band inset from the edge: the outline again, drawn as a stroke of
  // the frame's own width, centred on a path offset inward by half of it. Close enough at
  // thumbnail scale, and it uses the real outline rather than a second guess at the shape.
  const frame = frameOn
    ? `<path d="${plate}" fill="none" stroke="${ink.frame}" stroke-width="${frameW}" transform="scale(${(width - frameW) / width} ${(height - frameW) / height})"/>`
    : '';

  // The inset panel and the edge band are what distinguish two of the templates, and the card
  // showed neither — so those two read as blank rectangles.
  const panel = panelOn
    ? `<path d="${plate}" fill="${ink.panel}" transform="scale(${(width - 2 * params.panelInset) / width} ${(height - 2 * params.panelInset) / height})"/>`
    : '';

  const band = params.band !== 'none' && params.shape !== 'none'
    ? `<clipPath id="p"><path d="${plate}"/></clipPath>`
      + `<path d="${path(bandContour(params.band, width, height, params.bandWidth))}" `
      + `fill="${ink.band}" clip-path="url(#p)"/>`
    : '';

  // Drawn in mm and rendered at 240 px, so the hairline is scaled to land at roughly a pixel
  // and a half whatever size the sign is.
  const hair = Math.max(0.3, span * 0.007);

  /*
   * An engraved legend is a hole, not type — which the card drew as white letters.
   *
   * The *Inset panel* template is exactly this: the numeral is cut clean THROUGH the board so
   * the plate behind shows in it, and the card was setting it in the text ink instead. Two
   * different pictures of the same sign, on the one template whose whole idea is the cut. On
   * a bare plate the cut goes all the way out, so the backdrop shows — `void` is the card's
   * own colour, which reads as the hole it is. Inlay keeps the text ink: it fills the recess
   * flush in the second filament, which is the point of it.
   */
  const glyphInk = params.relief === 'recessed' && params.shape !== 'none'
    ? (panelOn ? ink.plate : ink.void)
    : ink.text;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="240" height="240">`
    + (plate ? `<path d="${plate}" fill="${ink.plate}" stroke="${ink.edge}" stroke-width="${hair.toFixed(2)}"/>` : '')
    + panel
    + band
    + frame
    + (mounting ? `<path d="${mounting}" fill="${ink.hole}"/>` : '')
    + `<path d="${glyphs}" fill="${glyphInk}" fill-rule="${label ? 'evenodd' : 'nonzero'}"/>`
    + '</svg>';

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
