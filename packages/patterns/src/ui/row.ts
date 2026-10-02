// The chosen pattern in a settings panel: a card of it, its name, "Choose pattern…" and
// "Surprise me". The studio's form draws this row itself (it is a field kind there); an app
// that composes its own panel takes it ready-made, so the two look alike.
import { button, buttonRow, el } from '@vostok/ui-kit';
import { inspireLook, surpriseValues, MONSTER_DARK } from '../library/tile-svg';
import { loadPatternLibrary, openPatternGallery, paintPattern, patternTitle, tileMeta } from './gallery';
import './gallery.css';

export interface PatternRowOptions {
  /** The pattern shown first, `pm-<slug>` or a procedural id. */
  value: string;
  /** Called with the new id when a card is picked or a surprise lands. */
  onPick: (id: string) => void;
  /** Called with the sliders' values for a surprise — Zoom %, angle, stroke, spacing —
   *  after `onPick`; absent, the surprise only changes the pattern. */
  onSurprise?: (values: Record<string, number>) => void;
  /** A seed for the surprise; absent, the clock. */
  seed?: () => number;
}

export interface PatternRowHandle {
  root: HTMLElement;
  /** Show another pattern (the caller's own state changed). */
  set(id: string): void;
  get(): string;
}

export function patternRow(opts: PatternRowOptions): PatternRowHandle {
  let current = opts.value;
  const art = el('div', { className: 'vp-pattern-preview' });
  const name = el('span', { className: 'vp-pattern-row__name', text: patternTitle(current) });
  paintPattern(art, current);

  const show = (id: string) => {
    current = id;
    name.textContent = patternTitle(id);
    paintPattern(art, id);
  };

  const choose = button({
    label: 'Choose pattern…',
    emphasis: 'secondary',
    onClick: () => openPatternGallery(current, (id) => { show(id); opts.onPick(id); }),
  });
  const surprise = button({
    label: 'Surprise me',
    emphasis: 'secondary',
    onClick: () => {
      void loadPatternLibrary().then((lib) => {
        const tiles = lib.PICKER_TILES;
        if (!tiles.length) return;
        const seed = Math.floor((opts.seed?.() ?? Date.now()) % 2147483647) || 1;
        const tile = tiles[seed % tiles.length]!;
        const id = `pm-${tile.id}`;
        show(id);
        opts.onPick(id);
        const meta = tileMeta(id);
        opts.onSurprise?.(surpriseValues(inspireLook(tile, seed, MONSTER_DARK), { maxSpacing: meta?.maxSpacing ?? [0, 0] }));
      });
    },
  });

  const root = el('div', { className: 'vp-pattern-row' }, [art, name, buttonRow(choose, surprise)]);
  return { root, set: show, get: () => current };
}
