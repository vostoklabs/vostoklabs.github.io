import { el } from '../dom';
import type { DesktopHost } from '../desktop-host';
import { chooseFile } from '../host-assets';
import { button } from './button';
import { dialog } from './dialog';
import { fontCards, type FontCardsHandle } from './font-cards';
import { fontPicker, fontStyleChips, type FontPickerFont, type FontStyleChipsHandle } from './font-picker';
import { uploadCta } from './sources';
import { toast } from './toast';

/*
  The whole font block a generator puts in its panel, as one component: the curated cards in
  the user's own text, "Browse all N fonts" opening the full library, and, when the app wants
  them, style chips over the cards and "Import a font". With the chips, "All" shows the curated
  cards and a style shows every face in it, the curated ones first.

  The kit had the two halves (`fontCards`, `fontPicker`) and nothing that put them together,
  so each generator put them together itself. Four did, and by October 2026 they had drifted
  into four different looks: one browse dialog a 3-column grid with categories, one a 5-column
  grid with none, one a narrow list whose names were cut off with a sideways scrollbar. Only
  one of them accepted the .zip that font sites hand out. This is the one block.

  Fonts arrive as plain `FontPickerFont`s, so the kit stays free of any font engine. In an app
  on `@vostok/fonts`, that is `FONTS.map(toPickerFont)`, with `fontSupportsText` for `supports`
  and `importFontFiles` inside `onImport`.
*/

export interface FontChooserOptions {
  /** The whole library, for "Browse all". */
  fonts: FontPickerFont[];
  /** The ids shown as cards in the panel: a curated handful, not the library. */
  curated: string[];
  value: string;
  /** What the cards show in every face: usually the user's text, often shortened to fit. */
  sample: string;
  /**
   * The text the missing-glyph check reads, when it is not the sample: both lines of a sign, a
   * name longer than a card. Default: the sample. The apps that shorten their sample all need
   * this, or a letter past the cut is never checked.
   */
  checkText?: string;
  onChange(id: string): void;
  /** Flags a face that lacks a glyph for `checkText` (or the sample). Shown and marked, never hidden. */
  supports?: (font: FontPickerFont, text: string) => boolean;
  /**
   * Shows "Import a font". Receives the file the user picked and returns the fonts it
   * brought (a .zip can bring several), or those plus the names of any that would not load. The
   * chooser lists them first, selects the last, and says how it went, failures included. Throw,
   * or return none, for a file that is not a font. Keeping the file for next time (a host's
   * project assets) is the app's job, here.
   */
  onImport?: (file: File) => Promise<FontPickerFont[] | { fonts: FontPickerFont[]; failed?: string[] }>;
  /** Default ".ttf,.otf,.woff,.zip": what the import in `@vostok/fonts` reads. */
  importAccept?: string;
  /**
   * The desktop host, when there is one. If it offers its own file picker, the import row opens
   * that instead of the browser's, for the same extensions as `importAccept`. Every app used to
   * write this hand-over itself.
   */
  host?: DesktopHost;
  /** A heading over the cards, in the section-header voice. */
  caption?: string;
  /** The heading over the curated faces in "Browse all". Default "Popular"; an app whose short
   *  list is chosen for what it makes says so ("Good on a sign"). */
  featuredLabel?: string;
  /** Grow the card grid into the height the block is given, inside a `section({ fill: true })`,
   *  instead of the panel's usual short scrolling grid. For a panel that is only the font. */
  fill?: boolean;
  /** Style chips (Clean, Comic, Script…) over the cards, the row the library has. Default off. */
  styleChips?: boolean;
}

export type FontChooserHandle = HTMLElement & {
  /** Show a font chosen elsewhere (Load project, undo). Fires `onChange` only with `notify`. */
  setValue(id: string, notify?: boolean): void;
  getValue(): string;
  /** The user's text changed: every card shows `sample`, and the missing-glyph marks follow
   *  `checkText` (the sample, when it is left out). */
  setSample(sample: string, checkText?: string): void;
  /** The library changed outside the chooser (fonts restored with a project): show this one. */
  setFonts(fonts: FontPickerFont[], curated?: string[]): void;
};

export function fontChooser(opts: FontChooserOptions): FontChooserHandle {
  let fonts = [...opts.fonts];
  let curated = [...opts.curated];
  let value = opts.value;
  let sample = opts.sample;
  let checkText = opts.checkText;

  const byId = () => new Map(fonts.map((f) => [f.id, f]));
  // The cards and the library ask about the sample they draw; the answer is about the text the
  // app wants checked, which can be longer.
  const supports = opts.supports
    ? (f: FontPickerFont, shown: string) => opts.supports!(f, checkText ?? shown)
    : undefined;

  const root = el('div', {
    className: `vl-font-chooser${opts.fill ? ' vl-font-chooser--fill' : ''}`,
  }) as unknown as FontChooserHandle;

  /** The style chip pressed: "All" (the curated cards) or one category of the library. */
  let style = 'All';

  let cards: FontCardsHandle;
  function buildCards(): FontCardsHandle {
    const lookup = byId();
    const picks = curated.map((id) => lookup.get(id)).filter((f): f is FontPickerFont => !!f);
    const all = style === 'All';
    const shown = all
      ? picks
      : [
          ...picks.filter((f) => f.category === style),
          ...fonts
            .filter((f) => f.category === style && !curated.includes(f.id))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ];
    return fontCards({
      fonts: shown,
      value,
      sample,
      onChange: (id) => {
        value = id;
        opts.onChange(id);
      },
      // Under "All" a face chosen from the library is pinned first, so the choice is always on
      // screen. Under a style it is not: a Script face pinned over the Spooky ones reads as a bug.
      ...(all ? { lookup: (id: string) => byId().get(id) } : {}),
      ...(supports ? { supports } : {}),
      ...(opts.caption ? { caption: opts.caption } : {}),
    });
  }
  cards = buildCards();

  let chips: FontStyleChipsHandle;
  function buildChips(): FontStyleChipsHandle {
    const row = fontStyleChips(fonts, style, (next) => {
      style = next;
      const fresh = buildCards();
      cards.replaceWith(fresh);
      cards = fresh;
    });
    // Off, the row is never shown, so the style stays "All": the plain curated cards. A library
    // with one style, or none, has nothing to filter.
    row.hidden = !opts.styleChips || row.styles.length < 2;
    return row;
  }
  chips = buildChips();

  /** Back to "All" when the choice is a face the pressed style does not show. */
  function showChoice(id: string): boolean {
    if (style === 'All' || byId().get(id)?.category === style) return false;
    style = 'All';
    chips.setActive(style);
    return true;
  }

  const browse = button({
    label: `Browse all ${fonts.length} fonts`,
    emphasis: 'secondary',
    block: true,
    onClick: openLibrary,
  });

  /** The full library in a wide dialog. Picking a font closes it: the choice is the point. */
  function openLibrary() {
    let handle: { close(): void } | null = null;
    const picker = fontPicker({
      fonts,
      value,
      sample,
      layout: 'cards',
      featured: curated,
      ...(opts.featuredLabel ? { featuredLabel: opts.featuredLabel } : {}),
      ...(supports ? { supports } : {}),
      onChange: (id) => {
        handle?.close();
        choose(id, true);
      },
    });
    handle = dialog({ title: 'Choose a font', content: picker, wide: true, actions: [{ label: 'Close' }] });
    picker.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** The one way the value changes from inside: the cards follow, the app hears about it. */
  function choose(id: string, notify: boolean) {
    value = id;
    if (showChoice(id)) rebuildCards();
    else cards.setValue(id);
    if (notify) opts.onChange(id);
  }

  function rebuildCards() {
    const next = buildCards();
    cards.replaceWith(next);
    cards = next;
  }

  /** The library changed: its styles may have too (an import brings "Custom"). */
  function refresh() {
    const nextChips = buildChips();
    if (style !== 'All' && !nextChips.styles.includes(style)) {
      style = 'All';
      nextChips.setActive(style);
    }
    chips.replaceWith(nextChips);
    chips = nextChips;
    rebuildCards();
    browse.setLabel(`Browse all ${fonts.length} fonts`);
  }

  async function importFile(file: File) {
    if (!opts.onImport) return;
    try {
      const result = await opts.onImport(file);
      const added = Array.isArray(result) ? result : result.fonts;
      const failed = Array.isArray(result) ? [] : (result.failed ?? []);
      // A zip with a broken face in it says so, rather than leaving the face to vanish.
      if (failed.length) toast(`Could not read ${failed.join(', ')}.`, { kind: 'warn' });
      if (!added.length) {
        if (!failed.length) toast(`No font found in ${file.name}.`, { kind: 'error' });
        return;
      }
      const ids = new Set(added.map((f) => f.id));
      fonts = [...added, ...fonts.filter((f) => !ids.has(f.id))];
      curated = [...added.map((f) => f.id), ...curated.filter((id) => !ids.has(id))];
      // Select before rebuilding the cards. Rebuilt first, they pinned the PREVIOUS choice
      // (when it was not a curated face) above the font that was just imported.
      value = added[added.length - 1]!.id;
      // The imported faces lead the curated cards, so that is where to show them.
      style = 'All';
      refresh();
      opts.onChange(value);
      toast(added.length === 1 ? `Imported ${added[0]!.label}` : `Imported ${added.length} fonts`, { kind: 'ok' });
    } catch (err) {
      toast(`Could not read ${file.name}: ${(err as Error).message}`, { kind: 'error' });
    }
  }

  const parts: HTMLElement[] = [chips, cards, browse];
  if (opts.onImport) {
    const accept = opts.importAccept ?? '.ttf,.otf,.woff,.zip';
    const importRow = uploadCta({
      // One line in a 290 px panel: the formats are the useful half, so they stay.
      label: 'Import a font (.ttf/.otf/.woff/.zip)',
      accept,
      onFiles: ([file]) => {
        if (file) void importFile(file);
      },
    });
    // The host's own picker when it has one, else the browser's file input behind the label.
    const host = opts.host;
    const pick = host?.pickMedia
      ? () => chooseFile(host, { kind: 'font', extensions: accept.split(',').map((x) => x.trim().replace(/^\./, '')) }, () => {})
      : undefined;
    if (pick) {
      // Stop the label from opening its own input, and ask the host's picker instead.
      importRow.addEventListener('click', (e) => {
        e.preventDefault();
        void pick().then((file) => {
          if (file) void importFile(file);
        });
      });
    }
    parts.push(importRow);
  }
  root.append(...parts);

  root.setValue = (id, notify = false) => choose(id, notify);
  root.getValue = () => value;
  root.setSample = (text, check) => {
    sample = text;
    checkText = check;
    // Re-marks every card, so a new `checkText` with an unchanged sample still takes effect.
    cards.setSample(text);
  };
  root.setFonts = (next, nextCurated) => {
    fonts = [...next];
    if (nextCurated) curated = [...nextCurated];
    refresh();
  };
  return root;
}
