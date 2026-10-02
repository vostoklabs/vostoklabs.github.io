import { el } from '../dom';
import { button } from './button';

/**
 * The little "working on it" pill that floats over a stage.
 *
 * Three things, and the third is the reason this is a component rather than a `<div>` an app
 * writes for itself:
 *
 *  1. It says something is happening. A generator that carves geometry has moments where the
 *     preview is simply the last frame, and a still picture is indistinguishable from a
 *     finished one.
 *  2. It spins. Text alone that appears and disappears with no motion reads as a glitch
 *     rather than as work; the ring is what makes it legible at a glance.
 *  3. It can carry a way out. A batch that runs for minutes — twenty-six caps, sixty-one
 *     keys — needs a cancel, and the only place the user is already looking is the thing
 *     telling them to wait. Every app that grew one of these grew it without the cancel, and
 *     then wrote status copy promising one.
 *
 * Reduced motion stops the spin and the entrance, and keeps the chip: the movement is
 * decoration, the chip itself is the feedback.
 */

export interface BusyChipOptions {
  /** Text shown when `show()` is called without one. Default 'generating…'. */
  defaultText?: string;
  /**
   * Milliseconds the chip waits, invisibly, before it fades in. For a stage that rebuilds on
   * every keystroke: a build that finishes inside the delay never flashes a chip, one that
   * does not gets one. It is a CSS animation delay, not a timer, so it still appears while a
   * long synchronous build has the main thread (a JS timer would not fire until it was over).
   */
  delay?: number;
}

export type BusyChipHandle = HTMLElement & {
  /**
   * Show the chip, or update it.
   *
   * Passing an `onCancel` puts a Cancel button in the chip; pressing it disables the button,
   * says "Cancelling…" and calls back. Calling `show` again WITHOUT a handler while one is
   * already pressed leaves the pressed state alone, so a progress tick ("3/26") arriving a
   * moment later cannot undo the press.
   */
  show(text?: string, onCancel?: () => void): void;
  hide(): void;
  /** Text only, leaving any cancel button as it is. */
  setText(text: string): void;
};

export function busyChip(opts: BusyChipOptions = {}): BusyChipHandle {
  const fallback = opts.defaultText ?? 'generating…';
  const textEl = el('span', { className: 'vl-busy__text', text: fallback });
  const cancelSlot = el('span', { className: 'vl-busy__cancel' });

  const root = el('div', {
    className: 'vl-busy',
    attrs: { hidden: '', role: 'status', 'aria-live': 'polite' },
  }, [
    el('span', { className: 'vl-busy__spinner', attrs: { 'aria-hidden': 'true' } }),
    textEl,
    cancelSlot,
  ]) as unknown as BusyChipHandle;
  if (opts.delay) {
    root.style.animationDelay = `${opts.delay}ms`;
    root.style.animationFillMode = 'both';
  }

  let cancelling = false;

  root.setText = (text: string) => { textEl.textContent = text; };

  root.show = (text, onCancel) => {
    textEl.textContent = text ?? fallback;
    if (onCancel && !cancelling) {
      cancelSlot.replaceChildren();
      const btn = button({
        label: 'Cancel',
        emphasis: 'ghost',
        className: 'vl-busy__cancel-btn',
        onClick: () => {
          cancelling = true;
          btn.disabled = true;
          btn.setLabel('Cancelling…');
          onCancel();
        },
      });
      cancelSlot.append(btn);
    } else if (!onCancel && !cancelling) {
      cancelSlot.replaceChildren();
    }
    root.hidden = false;
  };

  root.hide = () => {
    root.hidden = true;
    cancelling = false;
    cancelSlot.replaceChildren();
  };

  return root;
}
