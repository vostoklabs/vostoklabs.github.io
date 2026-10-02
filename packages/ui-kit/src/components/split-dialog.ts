/**
 * The two-pane modal: a working surface on the left, its controls on the right.
 *
 * It existed twice before it existed here, and was about to exist a third time. `openSvgImport`
 * builds it out of the private `.vl-svgprev` grid; the clicker's image wizard builds it out of
 * a hand-written `.wz-overlay` / `.wz-modal` that reproduces the dialog's backdrop, focus and
 * Escape handling as well as the layout; and a third caller needed the same shape. By the
 * kit's rule: a class ladder with no function behind it is
 * how an app re-derives a component under its own name, so the layout is promoted and the
 * callers point at it.
 *
 * What it adds over `dialog()` is only the arrangement — the modal behaviour (Escape, backdrop,
 * focus restore, one-at-a-time teardown) is `dialog()`'s, underneath, unchanged:
 *
 *   - a stage pane that fills its column and keeps its own overflow, so a canvas, a preview or
 *     a pair of pictures never pushes the window off the screen;
 *   - a control column that scrolls INDEPENDENTLY, which is the whole reason this is not a
 *     stacked dialog: a window that scrolls as one hides the thing it exists to show the
 *     moment the controls outgrow the screen (the bug `.vl-svgprev` was written to fix);
 *   - a footer slot inside the action bar, left of the buttons, for the error line or status
 *     that belongs next to the decision rather than above it;
 *   - stacking below 900px, stage first.
 */
import { el } from '../dom';
import { dialog, type DialogAction, type DialogHandle } from './dialog';

export interface SplitDialogOptions {
  title: string;
  /** Left pane. Fills, has its own overflow, and never shrinks below `stageMinHeight`. */
  stage: HTMLElement;
  /** Right column. Fixed width, scrolls on its own. */
  controls: HTMLElement;
  /** Error line or status, left-aligned in the action bar beside the actions. */
  footer?: HTMLElement;
  /** The kit's own action shape — same buttons, same ladder, same close-unless-false rule. */
  actions: DialogAction[];
  /** `dialog()`'s two working-surface sizes. Default `'xl'`. */
  size?: 'wide' | 'xl';
  onClose?: () => void;
  /**
   * Width of the control column in px. Default 300 — the sidebar width every generator's
   * panel already uses, and what a column of `sliderRow`s is designed against.
   *
   * A number rather than a class because the one caller that needs another is `openSvgImport`,
   * whose right pane is a list of per-part decisions ~490px wide: at 300 its three-option
   * picker leaves about sixty pixels for the description beside it. Re-pointing that window at
   * this component must not change what it looks like, so the width comes with it.
   */
  controlsWidth?: number;
  /** Minimum height of the stage pane in px. Default 420. Pass 0 for content that sizes
   *  itself — a pair of fixed-height preview panels has no use for a floor. */
  stageMinHeight?: number;
}

export function splitDialog(opts: SplitDialogOptions): DialogHandle {
  const stage = el('div', { className: 'vl-split__stage' }, [opts.stage]);
  const controls = el('div', { className: 'vl-split__controls' }, [opts.controls]);
  const root = el('div', { className: 'vl-split' }, [stage, controls]);

  // CSSOM, never a `style` attribute: a `style-src` policy without 'unsafe-inline'
  // refuses the attribute and reports it only to the console. Same rule as `el()`.
  if (opts.controlsWidth !== undefined) root.style.setProperty('--split-controls', `${opts.controlsWidth}px`);
  if (opts.stageMinHeight !== undefined) root.style.setProperty('--split-stage-min', `${opts.stageMinHeight}px`);

  const handle = dialog({
    title: opts.title,
    content: root,
    size: opts.size ?? 'xl',
    actions: opts.actions,
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  });

  /* The footer goes INTO the action bar rather than above it. Reaching for the row `dialog()`
     just built is deliberate and is why this lives in the kit beside it: the alternative is
     re-deriving the action loop here, which is the duplication `button()` was added to end. */
  if (opts.footer) {
    const bar = handle.root.querySelector('.vl-dialog__actions');
    const slot = el('div', { className: 'vl-split__footer' }, [opts.footer]);
    if (bar) bar.prepend(slot);
    else root.append(slot);
  }

  return handle;
}
