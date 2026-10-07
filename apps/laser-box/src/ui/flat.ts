// The two flat views. Neither shows the other's picture:
//
//   Design    every piece in wood, laid out in the box's order with its name and size under it
//             — "which piece is which", the question the 3D view cannot answer. Each piece gets
//             a cell as wide as its label, so a chest's 22 narrow pieces never print their
//             names over each other;
//   Cut file  the sheets exactly as the download writes them: white, red cuts (with the kerf
//             already in), blue scores, black engraves.
import { svgNode } from '@vostok/ui-kit';
import { OPS } from '@vostok/laser/ops';
import { boxOf, placePoint } from '../engine/layout';
import type { BuildResult, BuiltPiece } from '../engine/build';
import type { Pt, Shapes } from '../engine/types';
import { units } from '../units';
import type { Box2 } from './panzoom';

const ORDER = ['lid', 'lip', 'front', 'back', 'left', 'right', 'bottom'];

const n = (v: number) => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(3));

/** Islands as one even-odd path, Y flipped into SVG's frame, through `map`. */
function pathOf(shapes: Shapes, map: (p: Pt) => Pt): string {
  return shapes
    .flat()
    .map((r) => `M${r.map((p) => { const [x, y] = map(p); return `${n(x)} ${n(-y)}`; }).join('L')}Z`)
    .join('');
}

function linesOf(paths: Pt[][], map: (p: Pt) => Pt): string {
  return paths.map((r) => `M${r.map((p) => { const [x, y] = map(p); return `${n(x)} ${n(-y)}`; }).join('L')}`).join('');
}

const sortPieces = (pieces: BuiltPiece[]) =>
  [...pieces].sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

// Lines are drawn a fixed number of screen pixels wide (`non-scaling-stroke`), so they stay
// crisp whatever the zoom; sizes and labels are millimetres and zoom with the drawing.
const HAIR = { 'vector-effect': 'non-scaling-stroke' };

/** The UI font's average glyph width, in ems — enough to keep two labels apart. */
const GLYPH = 0.56;
/** The size line under a piece's name, as a fraction of the name's size. */
const SIZE_LINE = 0.85;

/** Every piece in wood, in the box's order. Returns the drawing's extent, for the camera. */
export function drawDesign(svg: SVGSVGElement, result: BuildResult, wood: string): Box2 {
  svg.replaceChildren();
  const pieces = sortPieces(result.pieces);
  const boxes = pieces.map((p) => boxOf(p.nominal));
  const area = boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0);
  const widest = Math.max(...boxes.map((b) => b.maxX - b.minX), 1);
  const gap = Math.max(10, Math.sqrt(area) * 0.06);
  const label = Math.max(4, Math.sqrt(area) * 0.03);
  const rowWidth = Math.max(widest, Math.sqrt(area) * 1.7);
  // Under each piece: its name, and its size a little smaller under that.
  const under = label * (1.15 + 1.1 * SIZE_LINE);
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxX = 0;
  const g = svgNode('g');
  pieces.forEach((p, i) => {
    const b = boxes[i]!;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const size = units.formatSize(w, h);
    const cell = Math.max(w, Math.max(p.label.length, size.length * SIZE_LINE) * label * GLYPH);
    if (x > 0 && x + cell > rowWidth) {
      x = 0;
      y += rowH + gap + under;
      rowH = 0;
    }
    // Piece frame → layout: its box's top-left at (px, y) in SVG terms, centred in its cell.
    const px = x + (cell - w) / 2;
    const map = (q: Pt): Pt => [px + (q[0] - b.minX), -(y + (b.maxY - q[1]))];
    g.append(svgNode('path', { d: pathOf(p.nominal, map), 'fill-rule': 'evenodd', fill: wood, stroke: 'rgba(0,0,0,0.4)', 'stroke-width': 1, ...HAIR }));
    if (p.engrave.length) g.append(svgNode('path', { d: pathOf(p.engrave, map), 'fill-rule': 'evenodd', fill: '#50321c' }));
    const score = pathOf(p.score.shapes, map) + linesOf(p.score.paths, map);
    if (score) g.append(svgNode('path', { d: score, fill: 'none', stroke: '#50321c', 'stroke-width': 1, ...HAIR }));
    if (p.slits.length) g.append(svgNode('path', { d: linesOf(p.slits, map), fill: 'none', stroke: '#3a2412', 'stroke-width': 1.5, ...HAIR }));
    const t = svgNode('text', { x: n(x + cell / 2), y: n(y + h + label * 1.15), 'text-anchor': 'middle', 'font-size': n(label), class: 'lb-flat__label lb-flat__name' });
    t.textContent = p.label;
    const s = svgNode('text', { x: n(x + cell / 2), y: n(y + h + under), 'text-anchor': 'middle', 'font-size': n(label * SIZE_LINE), class: 'lb-flat__label' });
    s.textContent = size;
    g.append(t, s);
    x += cell + gap;
    rowH = Math.max(rowH, h);
    maxX = Math.max(maxX, x - gap);
  });
  // A millimetre grid under the pieces, 10 mm lines and every fifth stronger, as far round them as
  // a zoomed-out view is likely to reach — the scale you read a zoomed-in piece against.
  const H = y + rowH + under + label * 0.4;
  const reach = Math.max(maxX, H) * 0.6;
  const x0 = Math.floor(-reach / 50) * 50;
  const x1 = Math.ceil((maxX + reach) / 50) * 50;
  const y0 = Math.floor(-reach / 50) * 50;
  const y1 = Math.ceil((H + reach) / 50) * 50;
  const minor: string[] = [];
  const major: string[] = [];
  for (let gx = x0; gx <= x1; gx += 10) (gx % 50 === 0 ? major : minor).push(`M${gx} ${y0}V${y1}`);
  for (let gy = y0; gy <= y1; gy += 10) (gy % 50 === 0 ? major : minor).push(`M${x0} ${gy}H${x1}`);
  svg.append(
    svgNode('path', { d: minor.join(''), fill: 'none', stroke: 'rgba(128,140,160,0.10)', 'stroke-width': 1, ...HAIR }),
    svgNode('path', { d: major.join(''), fill: 'none', stroke: 'rgba(128,140,160,0.22)', 'stroke-width': 1, ...HAIR }),
    g,
  );
  return { x: 0, y: 0, w: maxX, h: H };
}

/** The cut file, sheet by sheet. Returns the drawing's extent, for the camera. */
export function drawCutFile(svg: SVGSVGElement, result: BuildResult): Box2 {
  svg.replaceChildren();
  const { width: W, height: H } = result.sheet;
  const gutter = Math.max(W, H) * 0.08;
  const label = Math.max(5, Math.max(W, H) * 0.03);
  const byId = new Map(result.pieces.map((p) => [p.id, p]));
  for (let s = 0; s < result.sheets; s++) {
    const ox = s * (W + gutter);
    const g = svgNode('g');
    g.append(svgNode('rect', { x: n(ox), y: n(-H), width: n(W), height: n(H), fill: '#ffffff', stroke: '#c4cad3', 'stroke-width': 1, ...HAIR }));
    const caption = svgNode('text', { x: n(ox), y: n(-H - label * 0.6), 'font-size': n(label), class: 'lb-flat__label' });
    caption.textContent = result.sheets > 1 ? `Sheet ${s + 1} of ${result.sheets} · ${units.formatSize(W, H)}` : `Sheet · ${units.formatSize(W, H)}`;
    g.append(caption);
    for (const pl of result.placements) {
      if (pl.sheet !== s) continue;
      const p = byId.get(pl.id);
      if (!p) continue;
      const box = boxOf(p.cut);
      const map = (q: Pt): Pt => {
        const [a, b] = placePoint(q, pl, box);
        return [ox + a, b];
      };
      if (p.engrave.length) g.append(svgNode('path', { d: pathOf(p.engrave, map), 'fill-rule': 'evenodd', fill: OPS.engrave.color }));
      const score = pathOf(p.score.shapes, map) + linesOf(p.score.paths, map);
      if (score) g.append(svgNode('path', { d: score, fill: 'none', stroke: OPS.score.color, 'stroke-width': 1, ...HAIR }));
      g.append(svgNode('path', { d: pathOf(p.cut, map) + linesOf(p.cutSlits, map), fill: 'none', stroke: OPS.cut.color, 'stroke-width': 1, ...HAIR }));
    }
    svg.append(g);
  }
  const total = result.sheets * W + (result.sheets - 1) * gutter;
  return { x: 0, y: -H - label * 1.6, w: total, h: H + label * 1.6 };
}

/** "120 × 80 × 60 mm" — the box's outside, for the status line. */
export function outsideText(r: BuildResult): string {
  const { x, y, z } = r.outside;
  return `${units.formatSize(x, y).replace(/ (mm|in)$/, '')} × ${units.format(z)}`;
}
