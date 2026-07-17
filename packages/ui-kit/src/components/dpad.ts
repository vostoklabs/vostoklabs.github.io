import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/* Directional pad: nudge a placed element up/down/left/right, rotate it from
   the top corners, and reset from the dashed center. Ported from the clicker's
   "switch position" pad so every generator that places something reuses it. */

export interface DpadOptions {
  onMove?: (dir: 'up' | 'down' | 'left' | 'right') => void;
  /** Called with the signed delta in degrees (left is positive, like the app). */
  onRotate?: (deltaDeg: number) => void;
  onReset?: () => void;
  /** Degrees per rotate press. Default 3. */
  rotateStep?: number;
  /** Initial readout text under the pad. Omit to hide the readout. */
  readout?: string;
}

export interface DpadHandle {
  root: HTMLElement;
  /** Update the readout line (creates it if the pad started without one). */
  setReadout(text: string): void;
}

function padBtn(cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', {
    className: `vl-dpad-btn ${cls}`,
    attrs: { type: 'button', 'aria-label': label, title: label },
    on: { click: onClick },
  });
  btn.append(svgEl(icon));
  return btn;
}

export function dpad(opts: DpadOptions = {}): DpadHandle {
  const step = opts.rotateStep ?? 3;

  const grid = el('div', { className: 'vl-dpad' }, [
    padBtn('vl-dpad-rotl vl-dpad-btn--rot', ICONS.rotateLeft, 'Rotate left', () =>
      opts.onRotate?.(step),
    ),
    padBtn('vl-dpad-up', ICONS.arrowUp, 'Move up', () => opts.onMove?.('up')),
    padBtn('vl-dpad-rotr vl-dpad-btn--rot', ICONS.rotateRight, 'Rotate right', () =>
      opts.onRotate?.(-step),
    ),
    padBtn('vl-dpad-left', ICONS.arrowLeft, 'Move left', () => opts.onMove?.('left')),
    padBtn('vl-dpad-center vl-dpad-btn--center', ICONS.target, 'Reset to center', () =>
      opts.onReset?.(),
    ),
    padBtn('vl-dpad-right', ICONS.arrowRight, 'Move right', () => opts.onMove?.('right')),
    padBtn('vl-dpad-down', ICONS.arrowDown, 'Move down', () => opts.onMove?.('down')),
  ]);

  const root = el('div');
  root.append(grid);

  let readout: HTMLElement | null = null;
  const ensureReadout = () => {
    if (!readout) {
      readout = el('div', { className: 'vl-dpad-readout', attrs: { 'aria-live': 'polite' } });
      root.append(readout);
    }
    return readout;
  };
  if (opts.readout !== undefined) ensureReadout().textContent = opts.readout;

  return {
    root,
    setReadout(text: string) {
      ensureReadout().textContent = text;
    },
  };
}
