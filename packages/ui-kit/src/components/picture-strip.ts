import { el } from '../dom';
import { ICONS } from '../icons';
import { bareIconButton } from './elements';
import { thumbTile, type ThumbTileHandle } from './sources';

/* A row of picture tiles, one selected, each removable, with an add tile at the end: the photos a
   batch will make, the colourways a product comes in. Not `thumbGrid`: that one wraps, so adding a
   tile could push whatever sits above it, and its tiles cannot carry a remove button (a button
   inside a button is not allowed). Here each tile and its remove button are siblings in a cell. */

export interface PictureStripItem {
  id: string;
  /** The tooltip and the accessible name. */
  label: string;
  /** The picture. Missing, the tile pulses until `setImage` gives it one. */
  src?: string;
}

export interface PictureStripOptions {
  items: PictureStripItem[];
  /** The selected id. */
  value: string;
  onSelect: (id: string) => void;
  /** No `onAdd`, no add tile. */
  onAdd?: () => void;
  addLabel?: string;
  /** No `onRemove`, no remove buttons. Never offered while one item is left. */
  onRemove?: (id: string) => void;
  removeLabel?: (item: PictureStripItem) => string;
  /** A caption over the strip, in the case of a control's caption. */
  heading?: string;
  /** Picture width over height. Default 1. */
  aspect?: number;
  /** Tile height in px. Default 64. */
  size?: number;
  /** Wrap onto more rows. Default false: one row that scrolls sideways, so the strip's height
   *  never changes and nothing around it moves. */
  wrap?: boolean;
  /** The add tile hides at this many items. */
  max?: number;
}

export interface PictureStripHandle {
  root: HTMLElement;
  setItems(items: PictureStripItem[]): void;
  setValue(id: string): void;
  /** Give one tile its picture, or take it away (`null`: the tile pulses again). */
  setImage(id: string, src: string | null): void;
  setAspect(aspect: number): void;
}

/** A plus in the 40 x 40 box `thumbTile({ svgPath })` draws in. */
const PLUS = 'M18.5 11h3v7.5H29v3h-7.5V29h-3v-7.5H11v-3h7.5z';

export function pictureStrip(opts: PictureStripOptions): PictureStripHandle {
  let items = opts.items.slice();
  let value = opts.value;
  const row = el('div', { className: 'vl-picture-strip__row' });
  const root = el('div', { className: `vl-picture-strip${opts.wrap ? ' vl-picture-strip--wrap' : ''}` });
  if (opts.heading) root.append(el('span', { className: 'vl-picture-strip__heading', text: opts.heading }));
  root.append(row);
  // Through the CSSOM, never a style attribute, which a strict host policy refuses.
  if (opts.size) root.style.setProperty('--strip-size', `${opts.size}px`);
  if (opts.aspect) root.style.setProperty('--strip-aspect', String(opts.aspect));

  const tiles = new Map<string, ThumbTileHandle>();
  const cells = new Map<string, HTMLElement>();

  const picture = (tile: ThumbTileHandle, src: string | null | undefined) => {
    tile.replaceChildren(src
      ? el('img', { attrs: { src, alt: '', decoding: 'async' } })
      // The kit's pulse, sized by the stylesheet rather than by `skeleton()`'s inline height.
      : el('span', { className: 'vl-skeleton vl-picture-strip__wait', attrs: { 'aria-hidden': 'true' } }));
  };

  const draw = () => {
    tiles.clear();
    cells.clear();
    const removable = !!opts.onRemove && items.length > 1;
    const made = items.map((item) => {
      const tile = thumbTile({
        label: item.label,
        selected: item.id === value,
        className: 'vl-picture-strip__tile',
        onClick: () => opts.onSelect(item.id),
      });
      picture(tile, item.src);
      tiles.set(item.id, tile);
      const cell = el('div', { className: 'vl-picture-strip__cell' }, [tile]);
      if (item.id === value) cell.setAttribute('data-selected', '');
      if (removable) {
        const label = opts.removeLabel?.(item) ?? `Remove ${item.label}`;
        cell.append(bareIconButton({
          icon: ICONS.close,
          label,
          className: 'vl-picture-strip__remove',
          onClick: () => opts.onRemove!(item.id),
        }));
      }
      cells.set(item.id, cell);
      return cell;
    });
    if (opts.onAdd && (opts.max === undefined || items.length < opts.max)) {
      made.push(el('div', { className: 'vl-picture-strip__cell' }, [
        thumbTile({ label: opts.addLabel ?? 'Add', svgPath: PLUS, className: 'vl-picture-strip__add', onClick: () => opts.onAdd!() }),
      ]));
    }
    row.replaceChildren(...made);
  };
  draw();

  return {
    root,
    setItems(next) {
      items = next.slice();
      draw();
    },
    setValue(id) {
      value = id;
      for (const [itemId, tile] of tiles) tile.setSelected(itemId === id);
      for (const [itemId, cell] of cells) {
        if (itemId === id) cell.setAttribute('data-selected', '');
        else cell.removeAttribute('data-selected');
      }
    },
    setImage(id, src) {
      const item = items.find((i) => i.id === id);
      if (item) item.src = src ?? undefined;
      const tile = tiles.get(id);
      if (tile) picture(tile, src);
    },
    setAspect(aspect) {
      root.style.setProperty('--strip-aspect', String(aspect));
    },
  };
}
