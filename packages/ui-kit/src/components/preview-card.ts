import { el } from '../dom';

/*
  The stage as a framed card: a bar of switches over the picture, the picture, and strips under it.
  Laser Studio's editor stage is the shape, at its shipped numbers: the view switch and the
  mm | in switch in the bar, the drawing or the 3D view under them, the status line in the
  picture's corner, and under the picture what its colours mean (the export view) or the 3D
  view's own switches.

  Each part has its slot, so the overlays cannot collide: the status line sits in the view's
  bottom-left corner, the zoom tools in the bottom-right one, and the status line leaves them
  room. A view whose picture has to stay clear (the export preview's white sheet) moves the status
  line under the strips with `statusBelow`. The card fills the stage it is placed in, a little in
  from its edges.
*/

export interface PreviewCardOptions {
  /** The bar's leading end: the view switch. */
  start?: (HTMLElement | Node)[];
  /** The bar's trailing end: the unit switch. */
  end?: (HTMLElement | Node)[];
  /** The picture: a canvas host, an SVG. Each fills the view; hide the ones a view does not use. */
  view?: (HTMLElement | Node)[];
  /** The status line, in the view's bottom-left corner: `stageStatus().root`. */
  status?: HTMLElement;
  /** The camera's tools, in the view's bottom-right corner: `zoomControl().root`. */
  zoom?: HTMLElement;
  /** Strips under the picture, each ruled off above: what the colours mean, the 3D view's
   *  switches. Their own layout is the app's; hide the ones a view does not use. */
  footer?: HTMLElement[];
}

export interface PreviewCard {
  root: HTMLElement;
  /** The bar over the picture. */
  bar: HTMLElement;
  /** The picture's box, positioned: whatever is put here sits over the drawing. */
  view: HTMLElement;
  /**
   * Move the status line from over the picture to under the strips, in the card's flow, or back:
   * for a view whose picture has to stay clear, such as the export preview's white sheet. Does
   * nothing when the card has no status line.
   */
  statusBelow(below: boolean): void;
}

export function previewCard(opts: PreviewCardOptions): PreviewCard {
  const bar = el('div', { className: 'vl-preview-card__bar' }, [
    el('div', { className: 'vl-preview-card__start' }, opts.start ?? []),
    el('div', { className: 'vl-preview-card__end' }, opts.end ?? []),
  ]);
  const view = el('div', { className: 'vl-preview-card__view' }, opts.view ?? []);
  if (opts.status) view.append(opts.status);
  if (opts.zoom) view.append(opts.zoom);
  for (const strip of opts.footer ?? []) strip.classList.add('vl-preview-card__foot');
  const root = el('div', { className: 'vl-preview-card' }, [bar, view, ...(opts.footer ?? [])]);
  const statusBelow = (below: boolean) => {
    const status = opts.status;
    if (!status) return;
    if (below) root.append(status);
    // Back where it was built: before the zoom tools, while they are in the view.
    else view.insertBefore(status, opts.zoom?.parentNode === view ? opts.zoom : null);
  };
  return { root, bar, view, statusBelow };
}
