// The flat view is the dieline itself, drawn from the same paths the exporter
// writes. That is the whole point of it: if it looks wrong here it IS wrong in the
// file, so there is no class of bug that can hide between the preview and the export.

import { el } from '@vostok/ui-kit';
import type { Pt, SolveResult } from '../types';
import { OP_COLOR, collectPaths } from '../export/paths';
import { sheetById } from '../geometry/solve';
import { bboxOf } from '../geometry/poly';

export interface FlatView {
  root: HTMLElement;
  render(result: SolveResult, opts: { showLabels: boolean; showSheet: boolean }): void;
}

export function createFlatView(): FlatView {
  const root = el('div', { className: 'fb-flat' });

  function render(result: SolveResult, opts: { showLabels: boolean; showSheet: boolean }): void {
    const { net, params } = result;
    const sheet = sheetById(params.sheetId);
    const paths = collectPaths(result);

    // Frame whichever is bigger: the sheet when it is shown, or the blank when the
    // blank has outgrown it. A net that overflows must stay visible — hiding the
    // overflow is how a user ends up cutting a part that was never on the sheet.
    const netBox = bboxOf([...net.cutRings, ...net.loose.map((l) => l.outline)]);
    const view: [number, number, number, number] = opts.showSheet
      ? [
          Math.min(0, netBox[0] - 4),
          Math.min(0, netBox[1] - 4),
          Math.max(sheet.widthMm, netBox[2] + 4),
          Math.max(sheet.heightMm, netBox[3] + 4),
        ]
      : [netBox[0] - 6, netBox[1] - 6, netBox[2] + 6, netBox[3] + 6];
    const vw = Math.max(1, view[2] - view[0]);
    const vh = Math.max(1, view[3] - view[1]);

    // Flip Y in the numbers so the drawing matches the exported file exactly.
    const fy = (y: number) => view[3] - (y - view[1]) + view[1];
    const d = (pts: [number, number][], closed: boolean) =>
      `M ${(pts[0] as Pt)[0].toFixed(2)} ${fy((pts[0] as Pt)[1]).toFixed(2)} ` +
      pts
        .slice(1)
        .map(([x, y]) => `L ${x.toFixed(2)} ${fy(y).toFixed(2)}`)
        .join(' ') +
      (closed ? ' Z' : '');

    const out: string[] = [];

    if (opts.showSheet) {
      out.push(
        `<rect x="0" y="${fy(sheet.heightMm).toFixed(2)}" width="${sheet.widthMm}" height="${sheet.heightMm}" ` +
          `class="fb-flat__sheet"/>`,
      );
    }

    // Panels get a soft wash so the blank reads as a solid piece of card rather than
    // as a tangle of lines. Drawn under everything.
    for (const p of net.panels) {
      const holes = p.holes.map((h) => d(h, true)).join(' ');
      out.push(
        `<path d="${d(p.outline, true)} ${holes}" fill-rule="evenodd" class="fb-flat__panel"/>`,
      );
    }

    for (const path of paths) {
      if (path.points.length < 2) continue;
      const colour = OP_COLOR[path.op];
      const w = path.op === 'cut' ? 0.9 : 0.7;
      out.push(
        `<path d="${d(path.points, path.closed)}" fill="none" stroke="${colour}" ` +
          `stroke-width="${w}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
      );
    }

    if (opts.showLabels) {
      const size = Math.max(2.2, Math.min(vw, vh) / 55);
      for (const p of net.panels) {
        if (p.role === 'flap' && p.label === 'dust flap') continue;
        const b = bboxOf([p.outline]);
        const cx = (b[0] + b[2]) / 2;
        const cy = (b[1] + b[3]) / 2;
        if (b[2] - b[0] < size * 3 || b[3] - b[1] < size * 1.6) continue;
        out.push(
          `<text x="${cx.toFixed(2)}" y="${(fy(cy) + size * 0.35).toFixed(2)}" ` +
            `font-size="${size.toFixed(2)}" class="fb-flat__label">${escape(p.label)}</text>`,
        );
      }
      for (const l of net.loose) {
        const b = bboxOf([l.outline]);
        out.push(
          `<text x="${((b[0] + b[2]) / 2).toFixed(2)}" y="${(fy((b[1] + b[3]) / 2) + size * 0.35).toFixed(2)}" ` +
            `font-size="${size.toFixed(2)}" class="fb-flat__label">${escape(l.label)}</text>`,
        );
      }
    }

    root.innerHTML =
      `<svg viewBox="${view[0]} ${view[1]} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" ` +
      `role="img" aria-label="Flat dieline, ${result.netSizeMm[0].toFixed(0)} by ${result.netSizeMm[1].toFixed(0)} millimetres">` +
      out.join('') +
      '</svg>';
  }

  return { root, render };
}

function escape(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string);
}

/** A little drawn icon per style for the picker. Cheaper and sharper than shipping
 *  seven PNGs, and it recolours with the theme. */
export function styleIcon(id: string): string {
  const s = (body: string) =>
    `<svg viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="1.6" ` +
    `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const dash = 'stroke-dasharray="2 2" opacity="0.55"';
  switch (id) {
    case 'tray-lid':
      return s(
        `<rect x="4" y="14" width="22" height="18" rx="1"/><rect x="22" y="6" width="22" height="14" rx="1"/>` +
          `<line x1="26" y1="10" x2="40" y2="10" ${dash}/><rect x="27" y="11" width="12" height="6" rx="1" opacity="0.5"/>`,
      );
    case 'tuck-top':
      return s(
        `<rect x="6" y="10" width="36" height="18" rx="1"/><path d="M14 10V4h10v6M14 28v6h10v-6"/>` +
          `<line x1="14" y1="10" x2="14" y2="28" ${dash}/><line x1="24" y1="10" x2="24" y2="28" ${dash}/>` +
          `<line x1="33" y1="10" x2="33" y2="28" ${dash}/>`,
      );
    case 'snap-lock':
      return s(
        `<rect x="6" y="8" width="36" height="16" rx="1"/><path d="M14 8V3h10v5"/>` +
          `<path d="M8 24v6h8v-6M18 24v6h8v-6M28 24v6h8v-6"/><line x1="14" y1="8" x2="14" y2="24" ${dash}/>`,
      );
    case 'mailer':
      return s(
        `<rect x="12" y="6" width="24" height="10" rx="1"/><rect x="12" y="16" width="24" height="14" rx="1"/>` +
          `<path d="M12 16H4v14h8M36 16h8v14h-8"/><line x1="12" y1="16" x2="36" y2="16" ${dash}/>`,
      );
    // The mailer's sibling: same box, but the lid closes on three wings. Drawn as the
    // lid seen from above with a flap folding away at each end as well as the front.
    case 'mailer-flaps':
      return s(
        `<rect x="12" y="6" width="24" height="10" rx="1"/><rect x="12" y="16" width="24" height="14" rx="1"/>` +
          `<path d="M12 16H4v14h8M36 16h8v14h-8"/><line x1="12" y1="16" x2="36" y2="16" ${dash}/>` +
          `<path d="M12 6H6v8h6M36 6h6v8h-6"/><line x1="12" y1="6" x2="12" y2="16" ${dash}/>` +
          `<line x1="36" y1="6" x2="36" y2="16" ${dash}/>`,
      );
    case 'tray':
      return s(
        `<path d="M6 30V14h36v16z"/><path d="M6 14l6-6h24l6 6"/>` +
          `<line x1="12" y1="8" x2="12" y2="30" ${dash}/><line x1="36" y1="8" x2="36" y2="30" ${dash}/>`,
      );
    // The webbed tray's whole identity is the 45 degree corner, so the icon is the
    // corner rather than the tray: a box with the diagonal drawn in at each end.
    case 'tray-webbed':
      return s(
        `<path d="M6 30V14h36v16z"/><path d="M6 14l6-6h24l6 6"/>` +
          `<path d="M6 14l6-6M42 14l-6-6" ${dash}/>` +
          `<line x1="12" y1="8" x2="12" y2="30" ${dash}/><line x1="36" y1="8" x2="36" y2="30" ${dash}/>`,
      );
    case 'flap-cover':
      return s(
        `<path d="M6 32V20h36v12z"/><path d="M6 20l5-5h26l5 5"/>` +
          `<path d="M8 15l4-11h24l4 11"/><path d="M12 4l-4 11" ${dash}/>` +
          `<line x1="12" y1="15" x2="12" y2="32" ${dash}/>`,
      );
    case 'sleeve':
      return s(
        `<rect x="6" y="10" width="36" height="16" rx="1"/><line x1="16" y1="10" x2="16" y2="26" ${dash}/>` +
          `<line x1="32" y1="10" x2="32" y2="26" ${dash}/>`,
      );
    case 'divider':
      return s(
        `<rect x="6" y="8" width="36" height="20" rx="1"/><line x1="18" y1="8" x2="18" y2="28"/>` +
          `<line x1="30" y1="8" x2="30" y2="28"/><line x1="6" y1="18" x2="42" y2="18"/>`,
      );
    default:
      return s('<rect x="8" y="8" width="32" height="20" rx="1"/>');
  }
}
