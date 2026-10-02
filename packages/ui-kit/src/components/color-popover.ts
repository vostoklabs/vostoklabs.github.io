import { el } from '../dom';
import { FILAMENTS } from './filament';

/**
 * The one colour picker.
 *
 * A floating grid of round chips plus a custom wheel, anchored wherever it was opened from —
 * a chip in a settings panel, or a click on the model itself. It exists because a shelf of
 * fourteen swatches inlined into a settings column is the wrong shape for a sidebar: it takes
 * two rows per colour, the custom chip lands alone on a wrapped third row, and at a 264px
 * panel the far end of it is simply cut off. The clicker hit all three and replaced its inline
 * shelf with exactly this; it was built there and lifted here so the next generator does not
 * have to discover the same thing.
 *
 * One picker, one offered list: whatever opens it passes the same `options`, so the colours a
 * user is offered cannot differ between the panel and the model.
 */

export interface ColorPopoverOption {
  hex: string;
  /** Shown as the chip's tooltip and accessible name. Defaults to the hex. */
  name?: string;
}

export interface ColorPopoverOptions {
  /** Viewport coordinates to anchor at — usually the trigger's `getBoundingClientRect()`. */
  x: number;
  y: number;
  /** The colour currently in force; its chip gets the selected ring. */
  value: string;
  /** What to offer. Defaults to the shared filament shelf. */
  options?: ReadonlyArray<ColorPopoverOption>;
  /** Fires on a chip click AND on every step of a custom-wheel drag, so a preview can track. */
  onSelect: (hex: string) => void;
  /**
   * Fires once on close, and only if the wheel was actually used, with the colour it ended on.
   *
   * Separate from `onSelect` because the wheel fires on every step of a drag: an app that
   * remembers custom colours would otherwise collect a dozen near-identical oranges from one
   * drag. Clicking an existing chip is not a new colour and does not call this.
   */
  onCustom?: (hex: string) => void;
  onClose?: () => void;
}

export interface ColorPopoverHandle {
  close(): void;
}

const norm = (hex: string) => hex.trim().toLowerCase();

/** Close whichever picker is open. One at a time: two would overlap and the lower one could
 *  not be reached. */
export function closeColorPopover(): void {
  document.querySelector('.vl-color-popover')?.remove();
}

export function colorPopover(opts: ColorPopoverOptions): ColorPopoverHandle {
  closeColorPopover();

  /* Restored on close. The trigger is often a click on a 3D canvas rather than a focusable
     control, so this can legitimately be null — then there is nothing to give focus back to. */
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const pop = el('div', {
    className: 'vl-color-popover',
    attrs: { role: 'dialog', 'aria-label': 'Choose a colour' },
  });

  let done = false;
  let wheelUsed = false;
  const wheel = el('input', { attrs: { type: 'color' } }) as HTMLInputElement;

  const close = () => {
    if (done) return;
    done = true;
    pop.remove();
    document.removeEventListener('mousedown', dismiss);
    document.removeEventListener('keydown', onKey, true);
    if (wheelUsed) opts.onCustom?.(wheel.value);
    opts.onClose?.();
    previouslyFocused?.focus();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const dismiss = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) close(); };
  document.addEventListener('keydown', onKey, true);

  const list = opts.options ?? FILAMENTS.map(([name, hex]) => ({ name, hex }));
  for (const option of list) {
    const on = norm(option.hex) === norm(opts.value);
    pop.append(el('button', {
      className: `vl-color-popover__chip${on ? ' is-on' : ''}`,
      attrs: {
        type: 'button',
        title: option.name ?? option.hex,
        'aria-label': option.name ?? option.hex,
        'aria-pressed': String(on),
        style: `--swatch: ${option.hex}`,
      },
      on: { click: () => { opts.onSelect(option.hex); close(); } },
    }));
  }

  /* The custom wheel: live while dragging, and the popover stays open for the whole drag so
     the model behind it tracks the colour. */
  wheel.value = /^#[0-9a-f]{6}$/i.test(opts.value) ? opts.value : '#888888';
  wheel.addEventListener('input', () => { wheelUsed = true; opts.onSelect(wheel.value); });
  pop.append(el('label', {
    className: 'vl-color-popover__custom',
    attrs: { title: 'Custom colour' },
  }, [wheel]));

  document.body.append(pop);

  // Measured after it is populated, then clamped into the viewport so a chip near an edge
  // does not open a picker half off-screen.
  const w = pop.offsetWidth || 178;
  const h = pop.offsetHeight || 190;
  pop.style.left = `${Math.max(8, Math.min(opts.x, window.innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(opts.y, window.innerHeight - h - 8))}px`;

  // A beat before arming the outside-click dismiss, or the click that opened it closes it.
  setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
  (pop.querySelector<HTMLElement>('button, input') ?? pop).focus();

  return { close };
}
