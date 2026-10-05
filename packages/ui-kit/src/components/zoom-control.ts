import { el } from '../dom';
import { ICONS } from '../icons';
import { iconButton } from './button';

/*
  The camera's tools for a picture that zooms and pans: zoom out, the zoom it is at, zoom in, and
  fit. A floating cluster in the bottom-right corner of the box it is placed in, a `previewCard()`'s
  view; on a phone it moves to the top-right corner and drops the number, clear of the status line
  along the bottom (a pinch zooms there anyway).

  The view owns the camera. This only asks it to move (`onZoom`, `onFit`) and is told where it went
  (`set`), so a wheel zoom, a pinch and a double-click fit all show here too.
*/

export interface ZoomControlOptions {
  /** Zoom the view by a factor: Zoom in asks for 1.25, Zoom out for 0.8. */
  onZoom(factor: number): void;
  /** Fit the whole picture in the view. */
  onFit(): void;
  /** The zoom shown at first, 1 for 100 %. Default 1. */
  value?: number;
}

export interface ZoomControl {
  root: HTMLElement;
  /** Show the zoom the view is at now, 1 for 100 %. Fires nothing. */
  set(zoom: number): void;
}

export function zoomControl(opts: ZoomControlOptions): ZoomControl {
  // A live region: the number is the one answer a screen reader gets to "Zoom in".
  const value = el('span', { className: 'vl-zoom-control__value', attrs: { 'aria-live': 'polite' } });
  const set = (zoom: number) => {
    value.textContent = `${Math.round(zoom * 100)}%`;
  };
  set(opts.value ?? 1);
  const root = el('div', { className: 'vl-zoom-control', attrs: { role: 'toolbar', 'aria-label': 'Zoom' } }, [
    iconButton({ icon: ICONS.zoomOut, label: 'Zoom out', onClick: () => opts.onZoom(0.8) }),
    value,
    iconButton({ icon: ICONS.zoomIn, label: 'Zoom in', onClick: () => opts.onZoom(1.25) }),
    iconButton({ icon: ICONS.maximize, label: 'Fit it all in view', onClick: () => opts.onFit() }),
  ]);
  return { root, set };
}
