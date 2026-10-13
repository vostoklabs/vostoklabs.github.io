// A design drawn flat as SVG: the template pictures in the Design category, the side-by-side view
// of both faces, and the review sheet the tests write. It draws what the worker builds, from the
// same shapes: the card, its colour fields, the lettering in its colours, holes as holes, carving
// as a shade of what it cuts into. Thickening is left out: a picture this small cannot show a
// tenth of a millimetre, and a lattice's faces (which take booleans) are shown as its struts.
import type { Ring, Shapes } from '@vostok/shapes';
import { POCKET_WALL } from './layout';
import type { Design, Face, Ink } from './types';

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Rings as one path's data, Y flipped for SVG. */
function pathOf(rings: Ring[]): string {
  let d = '';
  for (const r of rings) {
    if (r.length < 3) continue;
    d += `M${f(r[0]![0])} ${f(-r[0]![1])}`;
    for (let i = 1; i < r.length; i++) d += `L${f(r[i]![0])} ${f(-r[i]![1])}`;
    d += 'Z';
  }
  return d;
}

const flat = (shapes: Shapes): Ring[] => shapes.flat();

const area = (r: Ring) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i]![0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * r[i]![1];
  return a / 2;
};
/** Islands wound for a non-zero fill, as the worker winds them: each outer one way, its holes the
 *  other, so overlapping islands (the two strokes of a "+") add up rather than cancel. `open`
 *  turns the whole lot round: shapes to be left open inside a fill. */
function wound(shapes: Shapes, open = false): Ring[] {
  const out: Ring[] = [];
  for (const island of shapes) island.forEach((r, i) => {
    if (r.length < 3) return;
    const ccw = area(r) > 0;
    out.push(ccw === ((i === 0) !== open) ? r : r.slice().reverse());
  });
  return out;
}
const mirror = (shapes: Shapes): Shapes => shapes.map((i) => i.map((r) => r.map(([x, y]): [number, number] => [-x, y])));

/** A colour a little darker (or, on a dark colour, lighter): carving's shadow. */
function shade(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255;
  const t = lum > 0.5 ? 0.72 : 1.45;
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(lum > 0.5 ? v * t : v * t + 18))).toString(16).padStart(2, '0')).join('')}`;
}

let uid = 0;

export interface SvgOptions {
  /** Pixels across. Default 240. */
  width?: number;
  /** Painted where the card has holes; transparent when absent. */
  background?: string;
  /** A frame of this width ÷ height round the card, the card centred in it. */
  aspect?: number;
  /** Room round the card, mm, before the frame: the template menu's pictures. */
  margin?: number;
  /** A hairline round the card's edges in this colour, so a card the colour of the page around it
   *  still reads as a card. */
  edge?: string;
  /** Draw the NFC tag's place as a dashed circle. */
  pocket?: boolean;
}

/** One side of the card; the back as seen from behind. */
export function designSvg(d: Design, side: 'front' | 'back' = 'front', o: SvgOptions = {}): string {
  const back = side === 'back';
  const view = (s: Shapes) => (back ? mirror(s) : s);
  const pad = 0.6 + (o.margin ?? 0);
  let W = d.w + 2 * pad;
  let H = d.h + 2 * pad;
  if (o.aspect) {
    if (W / H > o.aspect) H = W / o.aspect;
    else W = H * o.aspect;
  }
  const width = o.width ?? 240;
  const id = `bc-clip-${++uid}`;
  // The outline is symmetric left to right, so it is the same from either side.
  const holes: Shapes = view([...d.cutouts, ...(d.front.pattern?.mode === 'cut' ? d.front.pattern.shapes : [])]);
  const out: string[] = [];
  out.push(`<clipPath id="${id}"><path fill-rule="evenodd" d="${pathOf([d.outline, ...flat(holes)])}"/></clipPath>`);
  out.push(`<g clip-path="url(#${id})">`);
  out.push(`<path fill="${d.card}" d="${pathOf([d.outline])}"/>`);

  const face: Face | null = back ? d.back : d.front;
  if (face) {
    if (face.fields.length) out.push(`<path fill="${d.fieldColour}" d="${pathOf(wound(view(face.fields)))}"/>`);
    if (face.gaps.length) out.push(`<path fill="${d.card}" fill-rule="evenodd" d="${pathOf(flat(view(face.gaps)))}"/>`);
    const p = face.pattern;
    // A pattern the engine could not clip itself carries the zone the worker trims it to.
    let keep = '';
    if (p?.keep?.length) {
      const kid = `bc-keep-${++uid}`;
      out.push(`<clipPath id="${kid}"><path d="${pathOf(wound(view(p.keep)))}"/></clipPath>`);
      keep = ` clip-path="url(#${kid})"`;
    }
    if (p?.mode === 'colour' && p.shapes.length) out.push(`<path fill="${p.colour}"${keep} d="${pathOf(wound(view(p.shapes)))}"/>`);
    if (p?.mode === 'cut' && p.lattice && !back) {
      const l = p.lattice;
      const runs = l.runs.filter((r) => r.length > 1).map((r) => `M${r.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')}`).join('');
      out.push(`<path fill="${o.background ?? '#00000055'}" fill-rule="evenodd" d="${pathOf(flat(l.region))}"/>`);
      out.push(`<path fill="none" stroke="${d.card}" stroke-width="${f(2 * l.inset)}" d="${pathOf(flat(l.region))}"/>`);
      out.push(`<path fill="none" stroke="${d.card}" stroke-width="${f(l.web)}" stroke-linecap="round" d="${runs}"/>`);
      // The worker keeps the lattice off an NFC pocket, its wall and the lattice's own frame.
      if (d.pocket) out.push(`<circle cx="${f(d.pocket.at[0])}" cy="${f(-d.pocket.at[1])}" r="${f(d.pocket.r + POCKET_WALL + l.inset)}" fill="${d.card}"/>`);
    }
    // Carving shows the reveal colour where there is one, else a shade of the card.
    if (!back && face.carved.length) out.push(`<path fill="${d.reveal ?? shade(d.card)}" d="${pathOf(wound(view(face.carved)))}"/>`);
    if (!back && p?.mode === 'carved' && p.shapes.length) out.push(`<path fill="${d.reveal ?? shade(d.card)}"${keep} d="${pathOf(wound(view(p.shapes)))}"/>`);
    for (const ink of face.ink as Ink[]) {
      const rings = [...wound(view(ink.shapes)), ...(ink.minus ? wound(view(ink.minus), true) : [])];
      if (ink.onFields && face.fields.length) {
        // The piece in its own colour, then in its colour over the fields, clipped to them.
        const fid = `bc-fields-${++uid}`;
        out.push(`<path fill="${ink.colour}" d="${pathOf(rings)}"/>`);
        out.push(`<clipPath id="${fid}"><path d="${pathOf(wound(view(face.fields)))}"/></clipPath>`);
        out.push(`<path fill="${ink.onFields}" clip-path="url(#${fid})" d="${pathOf(rings)}"/>`);
      } else {
        out.push(`<path fill="${ink.colour}" d="${pathOf(rings)}"/>`);
      }
    }
  }
  if (o.pocket && d.pocket) {
    const [x, y] = back ? [-d.pocket.at[0], d.pocket.at[1]] : d.pocket.at;
    out.push(`<circle cx="${f(x)}" cy="${f(-y)}" r="${f(d.pocket.r)}" fill="none" stroke="#8b93a1" stroke-width="0.45" stroke-dasharray="1.6 1.2"/>`);
  }
  out.push('</g>');
  if (o.background && holes.length) out.push(`<path fill="${o.background}" d="${pathOf(flat(holes))}"/>`);
  if (o.edge) out.push(`<path fill="none" stroke="${o.edge}" stroke-width="0.3" d="${pathOf([d.outline, ...flat(view(d.cutouts))])}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${f((width * H) / W)}" viewBox="${f(-W / 2)} ${f(-H / 2)} ${f(W)} ${f(H)}">${out.join('')}</svg>`;
}

/**
 * Both faces side by side in one picture, the back as seen from behind: what the template menu
 * shows when a card is pointed at. `gap` is the space between them, a share of a card's width; the
 * frame is `aspect` (width ÷ height) round them, the pair centred in it.
 */
export function pairSvg(d: Design, o: { width?: number; aspect?: number; gap?: number; margin?: number; edge?: string } = {}): string {
  const edge = o.edge ? { edge: o.edge } : {};
  const front = designSvg(d, 'front', { width: 600, ...edge });
  const back = d.back ? designSvg(d, 'back', { width: 600, ...edge }) : null;
  if (!back) return designSvg(d, 'front', { width: o.width ?? 240, ...(o.aspect ? { aspect: o.aspect } : {}), ...(o.margin ? { margin: o.margin } : {}), ...edge });
  const pad = 0.6;
  const cw = d.w + 2 * pad;
  const ch = d.h + 2 * pad;
  const gap = (o.gap ?? 0.08) * cw;
  const margin = o.margin ?? 0;
  let W = 2 * cw + gap + 2 * margin;
  let H = ch + 2 * margin;
  if (o.aspect) {
    if (W / H > o.aspect) H = W / o.aspect;
    else W = H * o.aspect;
  }
  const x0 = -(2 * cw + gap) / 2;
  // Each face nested at its place, its own size swapped for the place's (an attribute twice is not XML).
  const inner = (svg: string, x: number) => svg.replace(/ width="[^"]*" height="[^"]*"/, ` x="${f(x)}" y="${f(-ch / 2)}" width="${f(cw)}" height="${f(ch)}"`);
  const width = o.width ?? 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${f((width * H) / W)}" viewBox="${f(-W / 2)} ${f(-H / 2)} ${f(W)} ${f(H)}">${inner(front, x0)}${inner(back, x0 + cw + gap)}</svg>`;
}
