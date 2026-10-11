import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/*
  The level a value comes from, as a small tag on a control's caption line.

  Where settings are layered (one value for every key, another for a group of keys, a third
  for one key), a slider shows a number and says nothing of where it came from: whether moving
  it changes this key alone or every key on the board. The tag names the level ("Board",
  "Numbers", "Key"). When the value is set at the level being edited it turns accent, with a
  small reset beside it that hands the value back to the level above.

  It is an element the app places, usually with a control's `setTag()`, which puts it at the
  end of the control's caption line.
*/

export interface SourceTagOptions {
  /** The level the value comes from: "Board", a group's name, "Key". */
  label: string;
  /** The value is set at this level: the tag is drawn in the accent, with a reset button.
   *  Default false. */
  local?: boolean;
  /** The reset was pressed: clear the value set here, so it comes from the level above, and
   *  call `set()` with the level it now comes from. */
  onReset?: () => void;
}

export type SourceTagHandle = HTMLElement & {
  /** Show another level, or the same one set here or not. Fires nothing. */
  set(state: { label: string; local?: boolean }): void;
};

/** A small tag naming the level a value comes from, with a reset while it is set at this one. */
export function sourceTag(opts: SourceTagOptions): SourceTagHandle {
  const text = el('span', { className: 'vl-source-tag__label', text: opts.label });
  const reset = el('button', {
    className: 'vl-source-tag__reset',
    attrs: { type: 'button', title: 'Back to the level above', 'aria-label': 'Back to the level above' },
    on: { click: () => opts.onReset?.() },
  }, [svgEl(ICONS.rotateLeft)]) as HTMLButtonElement;
  const root = el('span', { className: 'vl-source-tag' }, [text, reset]) as unknown as SourceTagHandle;

  root.set = ({ label, local = false }) => {
    text.textContent = label;
    root.classList.toggle('vl-source-tag--local', local);
    // An inherited value has nothing to reset.
    reset.hidden = !local;
  };
  root.set({ label: opts.label, local: opts.local });
  return root;
}
