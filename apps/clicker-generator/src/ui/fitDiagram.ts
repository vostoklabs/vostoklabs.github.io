/*
  The Fit category's drawing: the clicker cut in half, seen from the side, with its three parts
  named (top part, switch, base) and the two places Fit loosens or tightens numbered as the rows
  under it are: 1, the top part's post on the switch's stem; 2, the switch in its hole in the base.
  A picture, not a control. Its colours are the theme's (app stylesheet), so it follows light and
  dark; its words are static. Built element by element, never from a string of markup.
*/

const NS = 'http://www.w3.org/2000/svg';

type Shape = [tag: 'path' | 'rect' | 'circle' | 'text', cls: string, attrs: Record<string, string | number>, text?: string];

const SHAPES: Shape[] = [
  ['path', 'base', { d: 'M18 64 H56 V104 H104 V64 H142 V120 H18 Z' }],
  ['rect', 'switch', { x: 58, y: 58, width: 44, height: 44, rx: 3 }],
  ['rect', 'part', { x: 26, y: 10, width: 108, height: 20, rx: 5 }],
  ['rect', 'part', { x: 69, y: 29, width: 22, height: 22, rx: 2 }],
  ['rect', 'stem', { x: 76, y: 40, width: 8, height: 19 }],
  ['path', 'lead', { d: 'M134 20 H164 M102 62 H164 M142 112 H164 M91 44 H101 M104 86 H112' }],
  ['text', 'name', { x: 168, y: 24 }, 'Top part'],
  ['text', 'name', { x: 168, y: 66 }, 'Switch'],
  ['text', 'name', { x: 168, y: 116 }, 'Base'],
  ['circle', 'mark', { cx: 108, cy: 44, r: 7.5 }],
  ['text', 'num', { x: 108, y: 48 }, '1'],
  ['circle', 'mark', { cx: 120, cy: 86, r: 7.5 }],
  ['text', 'num', { x: 120, y: 90 }, '2'],
];

/** A new copy of the drawing, in a holder the rail can show and hide as a row. */
export function fitDiagram(): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cg-fit-diagram');
  svg.setAttribute('viewBox', '0 0 250 128');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The clicker cut in half: the top part sits on the switch\'s stem (1), and the switch sits in a hole in the base (2).');
  for (const [tag, cls, attrs, text] of SHAPES) {
    const node = document.createElementNS(NS, tag);
    node.setAttribute('class', `cg-fit-diagram__${cls}`);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text) node.textContent = text;
    svg.append(node);
  }
  const holder = document.createElement('div');
  holder.className = 'cg-fit-diagram-row';
  holder.append(svg);
  return holder;
}
