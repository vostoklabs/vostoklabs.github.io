/**
 * The font picker: a grid of cards showing your own text in each face.
 *
 * A `<select>` of 155 names is the wrong control for choosing a typeface. You cannot judge
 * a face from its name, and the one thing that decides a house sign — is this legible as a
 * number, from the kerb — is invisible until you pick it and watch the model rebuild.
 * name-keychain solved this already with `vl-font-card`; this is the same module, with the
 * same shape and the same markup promoted into the kit, so the two read as one product.
 *
 * A shortlist is shown, not the whole registry: for a door plate most of the catalogue is
 * noise (Creepster, Pacifico, Press Start 2P). The rest stay reachable behind "All fonts",
 * so nothing is taken away.
 *
 * If this earns its place in a third generator it belongs in `@vostok/ui-kit` alongside
 * `sampleGrid`, not copied a third time.
 */
import { el, dialog } from '@vostok/ui-kit';
import { FONTS, type FontChoice, fontFamilyFor, isFontSupported } from '@vostok/fonts';

/**
 * Faces that suit a sign read at a distance: heavy or condensed grotesques, a couple of
 * geometrics, and two serifs for a formal plaque. Ordered as they should be shown.
 *
 * Deliberately not `curatedFonts()` — that list is tuned for keychains and leads with
 * novelty faces. Anton, its first entry, was this generator's silent default.
 */
const SHORTLIST = [
  'bebas-neue', 'anton', 'oswald', 'archivo-black', 'russo-one', 'montserrat',
  'barlow-condensed', 'rajdhani', 'aldrich', 'poppins', 'playfair-display', 'cinzel',
];

export interface FontPickerOptions {
  value: string;
  /** Rendered inside each card, so the choice is made on the user's own text. */
  sampleText: () => string;
  onChange: (fontId: string) => void;
}

export interface FontPicker {
  root: HTMLElement;
  /** Re-render — after the sample text changes, or a project is loaded. */
  refresh(value: string): void;
  /** Adds an uploaded face to the top of the grid and selects it. */
  addCustom(id: string, label: string): void;
}

export function fontPicker(opts: FontPickerOptions): FontPicker {
  const grid = el('div', { className: 'vl-font-grid' });
  let value = opts.value;
  let custom: FontChoice | null = null;

  const byId = (id: string) => FONTS.find((f) => f.id === id);

  /**
   * `123 abc`, always — not the user's own text.
   *
   * Showing your own text sounds better and reads worse. A house sign is usually two or
   * three digits, so every card said "12" and the one thing you actually need to judge —
   * whether this face has letters worth putting a street name in, and whether its digits and
   * letters sit together — was invisible. A fixed specimen with both is what a type
   * specimen has always been.
   */
  const SPECIMEN = '123 abc';
  function sample(): string {
    return SPECIMEN;
  }

  function card(font: { id: string; label: string }): HTMLElement {
    const known = byId(font.id);
    // The flag is about the user's OWN text, not the specimen: the question it answers is
    // "will my sign render in this face", which the specimen cannot tell you. A face that
    // fails is shown and marked rather than hidden — silently shrinking the list every time
    // someone types an accent explains nothing.
    const supported = !known || isFontSupported(known, opts.sampleText() || sample());
    const btn = el('button', {
      className: `vl-font-card${font.id === value ? ' is-on' : ''}${supported ? '' : ' unsupported'}`,
      attrs: { type: 'button', title: font.label },
      on: { click: () => { value = font.id; render(); opts.onChange(font.id); } },
    }, [
      el('span', {
        className: 'vl-font-card__sample',
        text: sample(),
        attrs: { style: `font-family: ${fontFamilyFor(font.id)}` },
      }),
      el('span', { className: 'vl-font-card__name', text: font.label }),
      ...(supported ? [] : [el('span', { className: 'vl-font-card__warn', text: '⚠' })]),
    ]);
    return btn;
  }

  /** The rest of the registry, in a searchable dialog rather than a 155-row dropdown. */
  function openAll() {
    const search = el('input', {
      className: 'vl-val hn-font-search',
      attrs: { type: 'text', placeholder: 'Search fonts…', 'aria-label': 'Search fonts' },
    }) as HTMLInputElement;
    const list = el('div', { className: 'vl-font-grid hn-font-all' });

    const paint = (q: string) => {
      const needle = q.trim().toLowerCase();
      list.replaceChildren(
        ...FONTS
          .filter((f) => !needle || f.label.toLowerCase().includes(needle))
          .map((f) => {
            const c = card(f);
            c.addEventListener('click', () => handle?.close());
            return c;
          }),
      );
    };

    search.addEventListener('input', () => paint(search.value));
    paint('');

    const handle = dialog({
      title: 'All fonts',
      content: el('div', { className: 'hn-font-modal' }, [search, list]),
      actions: [{ label: 'Close' }],
      // A grid needs more than the 440px a help dialog is sized for; without this the cards
      // overflowed the box rather than widening it.
      wide: true,
    });
  }

  const allBtn = el('button', {
    className: 'vl-btn hn-wide',
    text: 'All fonts…',
    attrs: { type: 'button' },
    on: { click: openAll },
  });

  function render() {
    const ids = custom ? [custom.id, ...SHORTLIST] : SHORTLIST;
    // A face chosen from the full list must stay visible in the grid, or selecting it looks
    // like nothing happened.
    if (!ids.includes(value)) ids.unshift(value);
    grid.replaceChildren(
      ...ids.map((id) => card(byId(id) ?? { id, label: custom?.id === id ? custom.label : id })),
    );
  }

  render();

  return {
    root: el('div', { className: 'hn-fontpicker' }, [grid, allBtn]),
    refresh(v: string) { value = v; render(); },
    addCustom(id: string, label: string) {
      custom = { id, label, category: 'custom', curated: false, subsets: [] };
      value = id;
      render();
    },
  };
}
