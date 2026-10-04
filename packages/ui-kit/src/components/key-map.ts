import { el, uid } from '../dom';
import { helpTip } from './controls';

/*
  A small map of a grid of keys, one square per cell: a key shows what is printed on it, an
  empty cell is a dashed square with a plus. A tap on either switches it — that is how a custom
  shape is drawn, one key at a time, without a second editor.

  It is a picture of the arrangement as much as a control, so it lays the cells out exactly as
  the keys will sit: same rows, same columns, same holes.
*/

export interface KeyMapOptions {
  rows: number;
  cols: number;
  /** Which cells hold a key, row by row. */
  on: boolean[];
  /** What each key shows — its legend, a drawing of its symbol, or nothing. Row by row. */
  legends?: (string | Element | null)[];
  /** Caption over the map. */
  label?: string;
  help?: string;
  /** A cell was tapped. The app decides what that means and calls `set()` with the result. */
  onToggle(index: number): void;
}

export type KeyMapHandle = HTMLElement & {
  set(rows: number, cols: number, on: boolean[], legends?: (string | Element | null)[]): void;
};

export function keyMap(opts: KeyMapOptions): KeyMapHandle {
  const grid = el('div', { className: 'vl-keymap', attrs: { role: 'group' } });
  const root = el('div', { className: 'vl-control' }) as unknown as KeyMapHandle;
  if (opts.label || opts.help) {
    const text = el('span', { text: opts.label ?? '', attrs: { id: uid('vl-cap') } });
    const lab = el('span', { className: 'vl-control-label' }, [text]);
    if (opts.help) lab.append(helpTip(opts.help));
    if (opts.label) grid.setAttribute('aria-labelledby', text.id);
    root.append(lab);
  }
  root.append(grid);

  root.set = (rows, cols, on, legends) => {
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, cols)}, var(--keymap-cell))`;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < rows * cols; i++) {
      const isKey = !!on[i];
      const legend = legends?.[i] ?? null;
      const name = isKey
        ? `Key ${i + 1}${typeof legend === 'string' && legend.trim() ? `, ${legend}` : ''}. Remove it`
        : `Add a key at row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}`;
      const b = el('button', {
        className: `vl-keymap__cell${isKey ? ' is-key' : ''}`,
        attrs: { type: 'button', 'aria-label': name, title: isKey ? 'Remove this key' : 'Add a key here' },
        on: { click: () => opts.onToggle(i) },
      });
      if (!isKey) b.textContent = '+';
      else if (typeof legend === 'string') b.textContent = legend;
      else if (legend) b.append(legend);
      cells.push(b);
    }
    grid.replaceChildren(...cells);
  };
  root.set(opts.rows, opts.cols, opts.on, opts.legends);
  return root;
}
