import { symbolTextField } from './symbols/text-field';
import { importSvgFile, openIconLibrary, retraceSvg, svgParts, traceSvgFile } from './symbols/library';
import { readSymbols, insertAsset, symbolSvg, updateSymbol } from './symbols/model';
import { areaStage, areasOf, areasValue, artworkFaces, openAreaPicker, pickedAreas, pickedCount } from './areas';
// The form: a template's fields → kit controls, in two homes. The RIGHT panel holds what the
// customer TYPES (text lines, a list, a symbol, a link) and nothing else; the LEFT panel holds
// every setting, in named categories on a rail — the font among them, as its own category —
// each setting in the category it belongs to. Every control is a kit component, and every control
// that needs a word of explanation carries it as a "?" tooltip, never as a paragraph
// (2026-09-21: no paragraph under each slider).
import {
  BLANKS,
  CATEGORY_LABELS,
  blankById,
  blankSilhouette,
  type BlankCategory,
  type BlankDef,
  type Shapes,
} from '@vostok/laser';
import {
  FONTS,
  fontFamilyFor,
  curatedFonts,
  importFontFiles,
  toPickerFont,
  isFontSupported,
  iconByChar,
  FALLBACK_FONT_ID,
  type FontChoice,
} from '@vostok/fonts';
import {
  button,
  buttonRow,
  toolRail,
  ICONS as UI_ICONS,
  dialog,
  el,
  fontChooser,
  inlineDisclosure,
  nudgePad,
  section,
  helpTip,
  segmentedControl,
  selectField,
  sliderRow,
  stepperRow,
  svgPathEl,
  textField,
  textareaField,
  thumbGrid,
  thumbTile,
  toast,
  toggleSwitch,
  dropZone,
} from '@vostok/ui-kit';
import { BATCH_SHEETS } from './engine/batch';
import { fieldHome, fontSampleOf, railIconKeys, railOrder, surpriseValues, useSegmented } from './form-rules';
import { loadPatternLibrary, openPatternGallery, paintPattern, patternTitle } from '@vostok/patterns/ui';
import { units } from './units';
import { lines, type Field, type Values } from './templates/types';

const SYMBOL_FAMILY = fontFamilyFor(FALLBACK_FONT_ID);

/** A face for the font block, with the icon font behind it so a symbol in the sample draws. */
const pickerFont = (x: FontChoice) => {
  const p = toPickerFont(x);
  return { ...p, family: `${p.family}, ${SYMBOL_FAMILY}` };
};

export interface FormOptions {
  fields: Field[];
  values: Values;
  /** Every change, live. The form has already written `values[key]`. */
  onChange(key: string): void;
  /** The template's `batch` opt-in: `key` is the text field that becomes a list in Batch mode.
   *  Given, the form grows the Single | Batch switch, the list, the Sheet select and the
   *  Colours switch. */
  batch?: { key: string; noun: string };
}

export interface Form {
  /** The settings, sectioned — the left panel. */
  left: HTMLElement;
  /** The inputs — the right panel. */
  right: HTMLElement;
  /** Push values back into every control — after Load or Reset. */
  sync(): void;
  /** How many materials the built design is cut from. The editor reports it after every build:
   *  Batch's Colours switch is only there for a design of two colours or more. */
  setColourCount(n: number): void;
  /** Drop the form's subscriptions. The editor calls it on the way out; a form left
   *  subscribed to the unit switch goes on re-formatting controls nobody can see. */
  dispose(): void;
}

/**
 * How a length reads, and how a typed length is read back.
 *
 * A `unit: 'mm'` field is a LENGTH, and the customer chose their unit on the preview — so the
 * readout follows the switch and so does the box: typing `3` in inch mode means 76.2 mm. The
 * MODEL is millimetres throughout; only these two functions know about inches. Percentages,
 * degrees and counts are untouched, and a template that wrote its own `format` keeps it.
 */
function lengthReadout(f: { unit?: string; format?: (v: number) => string }) {
  if (f.format) return { format: f.format };
  if (f.unit !== 'mm') return {};
  return {
    format: (v: number) => units.format(v),
    // A unit typed after the number is read as written ("2 in" in millimetres is 50.8 mm).
    parse: (typed: number, raw: string) => units.parse(typed, raw),
  };
}

/** A field's label in the section-header voice, with its "?" when the field has one. */
function labelOf(f: { label: string; help?: string }): HTMLElement {
  const label = el('p', { className: 'vl-label', text: f.label });
  if (f.help) label.append(helpTip(f.help));
  return label;
}

type Control = { node: HTMLElement; set(v: string | number | boolean): void };

export function renderForm(opts: FormOptions): Form {
  const { fields, values } = opts;
  const controls = new Map<string, Control>();
  // What the font cards preview: the customer's own word — the rule is in `form-rules.ts`,
  // where a node test can hold it to "a name, not the year and not a hidden field's default".
  // Per PICKER, not per form (2026-09-22): a design with two font fields sets each in different
  // words — a place card's name and its "Table 4", a date keychain's month and its initials — and
  // one shared sample lettered both lists with the first. `forKey` asks for that field's own.
  const fontSample = (forKey?: string) => fontSampleOf(fields, values, (c) => !!readSymbols(values)[c], forKey);
  const fontHandles: { key: string; setSample(s: string): void }[] = [];
  /** The millimetre nudge pads, so the mm | in switch can re-letter them. */
  const pads: { setUnit(unit: string, scale?: number, decimals?: number): void }[] = [];
  const showUnit = (pad: { setUnit(unit: string, scale?: number, decimals?: number): void }) =>
    (units.get() === 'in' ? pad.setUnit('in', 1 / 25.4, 3) : pad.setUnit('mm', 1, 1));

  /** Controls that draw ANOTHER field's value — the areas card draws its symbol's artwork —
   *  and so cannot wait for their own `set` to be called. Repainted on every change. */
  const repaints: (() => void)[] = [];
  /** An `areas` control's own "open the picker", registered under the field it picks FOR — so
   *  a drop on the `svg` control can go straight into it. The window IS the wizard now, and a
   *  wizard you have to go and find afterwards is not one. */
  const areaPickers = new Map<string, () => void>();

  const change = (key: string, v: string | number | boolean) => {
    values[key] = v;
    // Any control can move a sample now, not just a text field: a `previewText` may follow a
    // select (the calendar's month), so the pickers are re-lettered on every change.
    for (const h of fontHandles) h.setSample(fontSample(h.key));
    for (const repaint of repaints) repaint();
    applyVisibility();
    opts.onChange(key);
  };

  function make(f: Field): Control {
    const c = makeControl(f);
    const node = c.node;
    if (!foldsWhenEmpty(f, values)) return { node, set: c.set };
    // An optional line nobody has typed into costs a label, a field and its note — about 90 px of
    // a right panel that is 950 px tall on a laptop, spent on a control most orders never use,
    // and it was coming straight out of the font list's height. It folds behind its own name
    // until there is something in it.
    const fold = inlineDisclosure({
      openLabel: `+ ${f.label}`,
      closeLabel: `Hide ${f.label.toLowerCase()}`,
      body: [node],
    });
    return {
      node: fold,
      // Load and Reset push values back through here, and a saved project WITH a second line has
      // to open showing it. Opened through the summary's own click, which is what knows how to
      // release the collapse the kit animates — setting `open` alone leaves it latched shut.
      set: (v) => {
        c.set(v);
        if (String(v ?? '').trim() && !fold.open) fold.querySelector('summary')?.click();
      },
    };
  }

  function makeControl(f: Field): Control {
    switch (f.kind) {
      case 'text': {
        if (f.symbols !== false) return symbolTextField(f, values, change);
        const field = textField({ label: f.label, value: String(values[f.key]), ...(f.help ? { help: f.help } : {}), onInput: (v) => change(f.key, v) });
        return { node: field, set: (v) => field.setValue(String(v)) };
      }
      case 'font': {
        // The kit's font block, the one the clicker has: style chips over this design's faces as
        // cards in the customer's own word, "Browse all" for the whole library, and the import.
        // It fills the tab: the cards scroll, Browse all and Import stay put under them.
        const recommended = f.recommended ?? [];
        // The cards under "All": a face imported this session first (the import lists it first in
        // FONTS, as Custom), then this design's recommended faces, then the popular ones — about
        // thirty, as in the clicker. Eight recommended faces alone was a short, unscrolling grid.
        const imported = FONTS.filter((x) => x.category === 'Custom').map((x) => x.id);
        const chooser = fontChooser({
          fonts: FONTS.map(pickerFont),
          curated: [...new Set([...imported, ...recommended, ...curatedFonts().map((x) => x.id)])],
          value: String(values[f.key]),
          sample: fontSample(f.key),
          featuredLabel: recommended.length ? 'Recommended and popular' : 'Popular',
          fill: true,
          styleChips: true,
          onChange: (id) => change(f.key, id),
          onImport: async (file) => {
            const { fonts, failed } = await importFontFiles(file);
            return { fonts: fonts.map(pickerFont), failed };
          },
        });
        fontHandles.push({ key: f.key, setSample: (s: string) => chooser.setSample(s) });
        // A picker named for its ROLE ("Calendar font", "Initial font") prints that name above
        // the cards, the way the rulebook wants two card blocks each labelled with their role
        // (§3.5). The generic "Font" stays silent — the category it sits in already says so.
        // Two pickers under one heading were two identical, unnamed lists (2026-09-22).
        const node = el('div', { className: 'ls-font-block' }, [
          ...(f.label && f.label !== 'Font' ? [labelOf(f)] : []),
          chooser,
        ]);
        return { node, set: (v) => chooser.setValue(String(v)) };
      }
      case 'number': {
        const row = sliderRow({
          label: f.label, min: f.min, max: f.max, step: f.step, value: Number(values[f.key]),
          ...(f.unit ? { unit: f.unit } : {}), ...(f.help ? { help: f.help } : {}), ...lengthReadout(f),
          onInput: (v) => change(f.key, v),
        });
        return { node: row, set: (v) => row.setValue(Number(v)) };
      }
      case 'select': {
        // Tabs while the labels fit the panel, a dropdown the moment they would be truncated.
        if (useSegmented(f.options.map((o) => o.label))) {
          const seg = segmentedControl<string>({ label: f.label, ...(f.help ? { help: f.help } : {}), columns: f.options.length as 2 | 3 | 4, options: f.options, value: String(values[f.key]), onChange: (v) => change(f.key, v) });
          return { node: seg, set: (v) => seg.setValue(String(v)) };
        }
        const sel = selectField({ label: f.label, ...(f.help ? { help: f.help } : {}), options: f.options, value: String(values[f.key]), onChange: (v) => change(f.key, v) });
        return { node: sel, set: (v) => sel.setValue(String(v)) };
      }
      case 'toggle': {
        const t = toggleSwitch({ label: f.label, ...(f.help ? { help: f.help } : {}), checked: values[f.key] === true, onChange: (on) => change(f.key, on) });
        return { node: t, set: (v) => t.setValue(v === true) };
      }
      case 'lines': {
        // A list, one item per line: the kit's textarea, capped at `maxLines` rows of text.
        const area = textareaField({
          label: f.label, value: String(values[f.key] ?? ''), rows: f.rows ?? 6,
          ...(f.placeholder ? { placeholder: f.placeholder } : {}), ...(f.help ? { help: f.help } : {}),
          onInput: (v) => {
            const max = f.maxLines ?? 0;
            const clipped = max > 0 ? v.split(/\r?\n/).slice(0, max).join('\n') : v;
            if (clipped !== v) { area.setValue(clipped); toast(`Up to ${max} lines here.`, { kind: 'warn' }); }
            change(f.key, clipped);
          },
        });
        area.classList.add('ls-lines');
        return { node: area, set: (v) => area.setValue(String(v)) };
      }
      case 'stepper': {
        const row = stepperRow({
          label: f.label, min: f.min, max: f.max, step: f.step ?? 1, value: Number(values[f.key]),
          ...(f.unit ? { unit: f.unit } : {}), ...(f.help ? { help: f.help } : {}), ...lengthReadout(f),
          onInput: (v) => change(f.key, v),
        });
        return { node: row, set: (v) => row.setValue(Number(v)) };
      }
      case 'thumbs': {
        // A handful of visual choices on the first screen: silhouette tiles, the chosen one marked.
        const tiles = f.options.map((o) => thumbTile({
          ...(o.svgPath ? { svgPath: o.svgPath } : {}), label: o.label, selected: o.value === String(values[f.key]),
          onClick: () => { for (const [val, t] of tileByValue) t.setSelected(val === o.value); change(f.key, o.value); },
        }));
        const tileByValue = new Map(f.options.map((o, i) => [o.value, tiles[i]!] as const));
        // The panel is ~240 px wide: the minimum tile width must let `columns` tiles sit side by
        // side, and never grow past ~110 px — a style pick is a row of tiles, not a poster.
        const grid = thumbGrid({ tiles, minPx: f.columns ? Math.max(f.columns >= 5 ? 42 : 52, Math.min(110, Math.floor(236 / f.columns))) : 64 });
        const node = el('div', { className: 'ls-thumbs' }, [labelOf(f), grid]);
        return { node, set: (v) => { for (const [val, t] of tileByValue) t.setSelected(val === String(v)); } };
      }
      case 'position': {
        // A nudge pad: arrows and two numbers, the way the keychain moves its plate.
        const pad = nudgePad({
          unit: f.unit ?? 'mm', step: f.step,
          x: { label: 'X', value: Number(values[f.key]), max: f.max, step: f.step },
          y: { label: 'Y', value: Number(values[f.keyY]), max: f.max, step: f.step },
          onChange: (x, y) => { values[f.keyY] = y; change(f.key, x); },
          onReset: () => { pad.setValue({ x: 0, y: 0 }); values[f.keyY] = 0; change(f.key, 0); },
        });
        // Two millimetres on the pad and "24.0 mm" on the slider above it would be one panel
        // speaking two languages, so the pad reads in the same unit as everything else.
        if ((f.unit ?? 'mm') === 'mm') { pads.push(pad); showUnit(pad); }
        const node = el('div', { className: 'ls-position' }, [labelOf(f), pad]);
        return { node, set: (v) => pad.setValue({ x: Number(v), y: Number(values[f.keyY] ?? 0) }) };
      }
      case 'symbol': {
        const current = el('span', { className: 'ls-symbol-current', text: String(values[f.key]) });
        current.style.fontFamily = SYMBOL_FAMILY;
        const name = el('span', { className: 'vl-hint', text: iconByChar(String(values[f.key]))?.label ?? '' });
        const pick = button({
          label: 'Choose a symbol…', emphasis: 'secondary',
          onClick: () => openIconLibrary((asset) => { const item = insertAsset(values, asset); set(item.char); change(f.key, item.char); }),
        });
        // An optional symbol can be taken off again (the heart keychains' small hearts had no
        // option to change or remove them). Optional = the field says
        // so, or it opens empty — a card's logo, a stand's symbol — which had the same trap: once
        // picked, nothing took it away. Hidden while there is nothing to remove.
        const clear = (f.clearable ?? f.value === '')
          ? button({ label: 'Remove', icon: UI_ICONS.trash, emphasis: 'ghost', onClick: () => { set(''); change(f.key, ''); } })
          : null;
        const set = (v: string | number | boolean) => {
          const item = readSymbols(values)[String(v)];
          current.replaceChildren(...(item ? [symbolSvg(item)] : [document.createTextNode(String(v))]));
          name.textContent = item?.label ?? iconByChar(String(v))?.label ?? (String(v) ? '' : 'None');
          clear?.classList.toggle('hidden', !String(v));
        };
        set(String(values[f.key]));
        // Remove goes UNDER the choose button: side by side the two overflow the right panel.
        const node = el('div', {}, [labelOf(f), el('div', { className: 'ls-symbol-row' }, [current, el('div', { className: 'ls-symbol-row__body' }, [name, pick, ...(clear ? [clear] : [])])])]);
        return { node, set };
      }
      case 'blank': {
        const cats: BlankCategory[] = f.categories ?? ['keychains', 'tags', 'shapes'];
        // The current shape as its own silhouette, on the row that changes it.
        const icon = el('span', { className: 'ls-shape-current' });
        const nameEl = el('span', { className: 'ls-shape-current__name' });
        const show = (def: BlankDef | undefined) => {
          icon.replaceChildren(svgPathEl(def ? blankSilhouette(def) : ''));
          nameEl.textContent = def?.label ?? 'Shape';
        };
        show(blankById(String(values[f.key])));
        const b = button({ label: 'Change shape…', emphasis: 'secondary', onClick: () => openShapePicker(cats, String(values[f.key]), (def) => {
          show(def);
          // The shape brings its own size along: a star is not 60 × 24, a tag is not square.
          for (const [what, key] of Object.entries(f.linked ?? {})) {
            const v = def.defaults[what as 'width' | 'height' | 'corner'];
            if (key && typeof v === 'number') { values[key] = v; controls.get(key)?.set(v); }
          }
          change(f.key, def.id);
        }) });
        const node = el('div', {}, [labelOf(f), el('div', { className: 'ls-shape-row' }, [icon, el('div', { className: 'ls-shape-row__body' }, [nameEl, b])])]);
        return { node, set: (v) => show(blankById(String(v))) };
      }
      case 'pattern': {
        // The chosen pattern drawn as a card of itself — the gallery's own card at the width
        // the panel allows — over the two buttons that change it. You pick a pattern by
        // looking at it, so the control has to be a picture, not a name in a dropdown.
        const art = el('div', { className: 'ls-pattern-preview' });
        const nameEl = el('span', { className: 'ls-pattern-row__name' });
        const show = (id: string) => { nameEl.textContent = patternTitle(id); paintPattern(art, id); };
        show(String(values[f.key]));
        const choose = button({
          label: 'Choose pattern…', emphasis: 'secondary',
          onClick: () => openPatternGallery(String(values[f.key]), (id) => { show(id); change(f.key, id); }),
        });
        const surprise = button({
          label: 'Surprise me', icon: UI_ICONS.zap, emphasis: 'ghost', title: 'A random tile, wearing a random look — the site calls it Inspire me',
          onClick: async () => {
            const lib = await loadPatternLibrary();
            // (Never a tile the picker hides.)
            const tile = lib.PICKER_TILES[Math.floor(Math.random() * lib.PICKER_TILES.length)];
            if (!tile) return;
            // The colours belong to the card, not to the cut file: the look is read for its
            // numbers only, which is why an empty palette is the honest thing to pass.
            const look = lib.inspireLook(tile, Math.floor(Math.random() * 2 ** 31), []);
            // Written straight into `values` and pushed into each control, then ONE `change`
            // at the end — so the preview rebuilds once with every knob already moved.
            for (const [key, v] of Object.entries(surpriseValues(look, tile))) {
              if (!(key in values)) continue;
              const d = fields.find((x) => x.key === key);
              const clamped = d && (d.kind === 'number' || d.kind === 'stepper') ? Math.min(d.max, Math.max(d.min, v)) : v;
              values[key] = clamped;
              controls.get(key)?.set(clamped);
            }
            const id = `pm-${tile.id}`;
            show(id);
            change(f.key, id);
          },
        });
        const node = el('div', {}, [
          labelOf(f),
          el('div', { className: 'ls-pattern-row' }, [art, nameEl, buttonRow(choose, surprise)]),
        ]);
        return { node, set: (v) => show(String(v)) };
      }
      case 'svg': {
        // The whole control is the drop target: this design's artwork is the customer's file,
        // so there is no library to open first. The artwork itself is not repeated here — the
        // Pattern areas card underneath draws it, large, with its surfaces lit.
        const name = el('p', { className: 'vl-hint' });
        const drop = dropZone({
          title: 'Drop your SVG', text: 'or click to browse',
          note: 'Filled shapes; outline any text first.',
          accept: '.svg,image/svg+xml',
          onFiles: async ([file]) => {
            if (!file) return;
            try {
              // No window in front of this: the file is traced on the choices the import wizard
              // would have opened with, and the questions it used to ask are asked in the area
              // picker instead, beside the artwork they change.
              const traced = await traceSvgFile(file);
              // `set` first, then `change`: a control's own setter is not called by `change`
              // (that is for Load and Reset), so the name line kept saying "Example shape"
              // while the artwork underneath had already become the customer's.
              const { char } = insertAsset(values, traced.asset, { svgText: traced.svgText, svgChoices: traced.choices });
              set(char);
              // A file that states a REAL size opens at it. A cut file does — a box generator's
              // sheet is 142.36 mm — and squashing one to a design's default is how the finger
              // joints stop matching the material. Clamped to the slider — and SAID, because a
              // clamp nobody hears about is a rescaled cut file that no longer fits together.
              const sizeKey = f.sizeKey;
              if (sizeKey && traced.mm && sizeKey in values) {
                const def = fields.find((x) => x.key === sizeKey);
                const mm = def && def.kind === 'number' ? Math.min(def.max, Math.max(def.min, traced.mm)) : traced.mm;
                values[sizeKey] = Math.round(mm * 10) / 10;
                controls.get(sizeKey)?.set(values[sizeKey]);
                if (Math.abs(mm - traced.mm) > 0.05) {
                  toast(`Your file is ${Math.round(traced.mm)} mm, so it was scaled to ${Math.round(mm)} mm. Slots and joints will not fit their material at this size.`, { kind: 'warn' });
                }
              }
              change(f.key, char);
              // The faces are traced off the new value, so the picker opens on the next frame.
              setTimeout(() => areaPickers.get(f.key)?.(), 0);
            } catch (err) { toast(`Could not read that SVG: ${(err as Error).message}`, { kind: 'error' }); }
          },
        });
        // A template opens on an EXAMPLE shape, so the gallery card has something to show and
        // the editor is never an empty stage. Saying so is the difference between "here is a
        // flower" and "here is your file" (the name is the customer's own once they drop one).
        const set = (v: string | number | boolean) => {
          const item = readSymbols(values)[String(v)];
          // An empty value has no example behind it (song-keychain's code): nothing is drawn yet.
          name.textContent = item ? item.label : String(v) ? 'Example shape — drop your own SVG to replace it' : 'No file yet';
        };
        set(String(values[f.key]));
        const node = el('div', { className: 'ls-svg-drop' }, [labelOf(f), drop, name]);
        return { node, set };
      }
      case 'areas': {
        // The artwork with its areas lit, over the button that changes them. A card, not a
        // count: you pick an area by looking at the drawing, which is the whole reason this is
        // a click and not a list of numbers.
        const art = el('div', { className: 'ls-areas-preview' });
        const nameEl = el('span', { className: 'ls-areas-row__name' });
        let faces: Shapes = [];
        const open = () => {
          if (!faces.length) { toast('Drop your SVG first, then you can click its areas.', { kind: 'warn' }); return; }
          const char = String(values[f.from] ?? '');
          const item = readSymbols(values)[char];
          const svgText = item?.svgText;
          openAreaPicker({
            faces,
            picked: pickedAreas(String(values[f.key] ?? ''), char),
            // A library icon has no file behind it, so the window simply does not grow the rows.
            ...(svgText ? {
              file: {
                name: item?.label ?? 'Your file',
                svgText,
                ...svgParts(svgText),
                choices: (item?.svgChoices ?? {}) as Parameters<typeof retraceSvg>[1],
                retrace: (c) => retraceSvg(svgText, c),
              },
            } : {}),
            onDone: ({ picked, shapes, choices }) => {
              // A changed trace is a changed ARTWORK: it is written back under the same
              // character, so the symbol field, the card and the build all follow it.
              if (shapes) updateSymbol(values, char, { shapes, ...(choices ? { svgChoices: choices } : {}) });
              change(f.key, areasValue(char, picked));
            },
          });
        };
        areaPickers.set(f.from, open);
        const choose = button({ label: 'Choose areas…', emphasis: 'secondary', onClick: open });
        // Async: tracing the artwork is the symbol layer's own work. The guard is the artwork
        // it started on — a second import while the first is still tracing must not repaint
        // the card with the drawing that has just been replaced.
        const show = () => {
          const char = String(values[f.from] ?? '');
          void artworkFaces(values, f.from).then((next) => {
            if (String(values[f.from] ?? '') !== char) return;
            faces = next;
            const picked = pickedAreas(String(values[f.key] ?? ''), char);
            const areas = areasOf(faces);
            const count = pickedCount(areas, picked);
            art.replaceChildren(...(faces.length ? [areaStage(areas.areas, picked, undefined, areas.solid).svg] : []));
            nameEl.textContent = !faces.length
              ? 'Import an SVG to start'
              : count.all
                ? faces.length === 1 ? 'The whole shape' : `Every area — all ${faces.length}`
                : count.n === 0
                  ? 'No areas — nothing to pattern'
                  : count.text;
          });
        };
        show();
        repaints.push(show);
        const node = el('div', {}, [
          labelOf(f),
          el('div', { className: 'ls-areas-row' }, [art, nameEl, choose]),
        ]);
        return { node, set: () => show() };
      }
    }
  }

  // Two homes. Sections appear in first-use order, and every setting sits in the section it
  // names — the rule is `fieldHome` in form-rules.ts, where a node test holds every template to
  // it.
  const rightSections = new Map<string, HTMLElement[]>();
  const leftSections = new Map<string, HTMLElement[]>();
  const fontSection = fields.find((f) => f.kind === 'font')?.section ?? 'Font';
  for (const f of fields) {
    if (f.hidden) continue;
    const c = make(f);
    controls.set(f.key, c);
    const { right: onRight, title } = fieldHome(f, fontSection);
    const home = onRight ? rightSections : leftSections;
    if (!home.has(title)) home.set(title, []);
    home.get(title)!.push(c.node);
  }

  // -- Single | Batch -----------------------------------------------------------------------
  // A design that cuts in runs gets its controls at the TOP of the section its text field
  // lives in: the switch, the list of names, the sheet the run is laid out on, and — for a
  // design cut from two colours — whether the colours share a sheet. They are not template
  // fields — `__batch`, `__batchLines`, `__sheet` and `__colours` mean the same thing for every
  // batch design, so no template should have to declare them — but they are ordinary kit
  // components registered in `controls`, so Load and Reset push values back into them like
  // everything else.
  const batch = opts.batch;
  /** The materials the last build was cut from (`setColourCount`); one until a build says. */
  let colourCount = 1;
  if (batch) {
    const keyField = fields.find((f) => f.key === batch.key);
    const list = textareaField({
      label: 'Names — one per line', value: String(values.__batchLines ?? ''), rows: 6,
      placeholder: 'One name per line', help: 'One piece per line; every setting applies to all of them.',
      onInput: (v) => change('__batchLines', v),
    });
    list.classList.add('ls-lines');
    const sheet = selectField({
      label: 'Sheet', options: BATCH_SHEETS.map((s) => ({ value: s.id, label: s.label })),
      value: String(values.__sheet ?? ''), help: 'The sheet the pieces are laid out on.',
      onChange: (v) => change('__sheet', v),
    });
    // A sheet IS one material: a backer and the name glued on it laid side by side put half of
    // every page in the wrong colour. So Separate is the default and Together the choice.
    const colours = segmentedControl<'separate' | 'together'>({
      label: 'Colours', help: 'Separate lays each colour’s pieces on sheets of their own.',
      options: [{ value: 'separate', label: 'Separate' }, { value: 'together', label: 'Together' }],
      value: values.__colours === 'together' ? 'together' : 'separate',
      onChange: (v) => change('__colours', v),
    });
    const seg = segmentedControl<'single' | 'batch'>({
      options: [{ value: 'single', label: 'Single' }, { value: 'batch', label: 'Batch' }],
      value: values.__batch === true ? 'batch' : 'single',
      onChange: (v) => {
        const on = v === 'batch';
        // Switching to Batch with an empty list starts the run from what is already typed, so
        // the first line of the list is the name that was on the stage a moment ago.
        if (on && !lines(values, '__batchLines').length) {
          values.__batchLines = String(values[batch.key] ?? '');
          list.setValue(String(values.__batchLines));
        }
        change('__batch', on);
      },
    });
    controls.set('__batch', { node: seg, set: (v) => seg.setValue(v === true ? 'batch' : 'single') });
    controls.set('__batchLines', { node: list, set: (v) => list.setValue(String(v)) });
    controls.set('__sheet', { node: sheet, set: (v) => sheet.setValue(String(v)) });
    controls.set('__colours', { node: colours, set: (v) => colours.setValue(v === 'together' ? 'together' : 'separate') });
    const home = keyField?.panel === 'right' ? rightSections : leftSections;
    const title = keyField?.section ?? (keyField?.panel === 'right' ? '' : 'Settings');
    if (!home.has(title)) home.set(title, []);
    home.get(title)!.unshift(seg, list, sheet, colours);
  }

  const right = el('div', { className: 'ls-form ls-form--right' }, [...rightSections].map(([title, body]) => section({ title: title || 'Design', body })));
  // The rail opens on the knob that makes this design this design — Size on a keychain, Code
  // on a QR stand — so the Font category, which most templates declare before their first
  // setting, goes second, never first (`railOrder`).
  const ordered = railOrder([...leftSections.keys()], fontSection).map((title) => [title, leftSections.get(title)!] as const);
  const panels = el('div', { className: 'ls-settings-panels' });
  const entries = ordered.map(([title, body], i) => {
    // The Font category fills its tab: the cards scroll inside it and Browse all / Import stay
    // put underneath.
    const isFont = body.some((node) => node.classList.contains('ls-font-block'));
    const panel = section({ title, body, ...(isFont ? { fill: true } : {}) });
    if (isFont) panel.classList.add('ls-font-panel');
    panel.id = 'ls-settings-' + i;
    panel.hidden = i !== 0;
    panels.append(panel);
    return { title, panel, body };
  });
  // One icon per category, decided across the whole form so no two buttons wear the same one.
  const icons = railIconKeys(entries.map((e) => e.title));
  const rail = toolRail({
    items: entries.map(({ title }, i) => ({
      value: title, title,
      label: railLabel(title),
      icon: UI_ICONS[icons[i] ?? 'sliders'],
    })),
    value: entries[0]?.title ?? null,
    onChange: (title) => open(entries.find((e) => e.title === title)!.panel.hidden ? title : null),
  });
  /** Show one category (or none), and say so on the rail. */
  function open(title: string | null) {
    for (const entry of entries) {
      entry.panel.hidden = entry.title !== title;
      rail.button(entry.title)?.setAttribute('aria-expanded', String(!entry.panel.hidden));
    }
    rail.setValue(title);
  }
  rail.root.classList.add('ls-settings-rail');
  rail.root.setAttribute('aria-label', 'Design settings');
  for (const entry of entries) {
    rail.button(entry.title)?.setAttribute('aria-controls', entry.panel.id);
    rail.button(entry.title)?.setAttribute('aria-expanded', String(!entry.panel.hidden));
  }
  const left = el('div', { className: 'ls-form ls-form--left' }, [rail.root, panels]);

  function applyVisibility() {
    for (const f of fields) {
      const c = controls.get(f.key);
      if (c && f.visibleWhen) c.node.classList.toggle('hidden', !f.visibleWhen(values));
    }
    // In Batch the single text field is the list; in Single the list and its sheet are not there.
    if (batch) {
      const on = values.__batch === true;
      const keyField = fields.find((f) => f.key === batch.key);
      controls.get(batch.key)?.node.classList.toggle('hidden', on || (keyField?.visibleWhen ? !keyField.visibleWhen(values) : false));
      controls.get('__batchLines')?.node.classList.toggle('hidden', !on);
      controls.get('__sheet')?.node.classList.toggle('hidden', !on);
      // One colour has nothing to separate: hidden, never greyed.
      controls.get('__colours')?.node.classList.toggle('hidden', !on || colourCount < 2);
    }
    // Every control in a category can be hidden at once — "Keyring" on a design whose ring is
    // off, "Stand" on a style with no stand. A category with nothing to set is not on the rail,
    // and if it was the open one, the first category that has something takes its place.
    let openTitle: string | null = null;
    for (const entry of entries) {
      const empty = entry.body.every((node) => node.classList.contains('hidden'));
      const b = rail.button(entry.title);
      if (b) b.hidden = empty;
      if (empty) entry.panel.hidden = true;
      else if (!entry.panel.hidden) openTitle = entry.title;
    }
    if (openTitle === null) {
      const first = entries.find((e) => !rail.button(e.title)?.hidden);
      if (first) open(first.title);
    }
  }
  applyVisibility();

  // The switch on the preview changes what every length READS, never what it is. Re-showing a
  // value through the control's own setter is the whole of it: `format` reads the unit in use.
  const lengthKeys = fields
    .filter((f) => (f.kind === 'number' || f.kind === 'stepper') && f.unit === 'mm' && !f.format)
    .map((f) => f.key);
  const stopUnits = units.onChange(() => {
    for (const k of lengthKeys) controls.get(k)?.set(values[k] ?? 0);
    for (const pad of pads) showUnit(pad);
  });

  return {
    left,
    right,
    sync() {
      for (const f of fields) controls.get(f.key)?.set(values[f.key] ?? f.value);
      if (batch) for (const k of ['__batch', '__batchLines', '__sheet', '__colours']) controls.get(k)?.set(values[k] ?? '');
      for (const h of fontHandles) h.setSample(fontSample(h.key));
      applyVisibility();
    },
    setColourCount(n) {
      if (n === colourCount) return;
      colourCount = n;
      applyVisibility();
    },
    dispose: stopUnits,
  };
}

/**
 * May this field be folded away until it is used?
 *
 * An OPTIONAL text line with nothing in it — a second line on a keychain, a tagline under a
 * shop's name. `placeholder: 'Optional'` is how a template already says "this one is spare", in
 * the customer's own words, so it is what the rule reads; a template opts in by writing it. The
 * decision is taken once, when the panel is built: a field that has something in it is rendered
 * as it always was, and one the customer opens and then empties stays open.
 *
 * A field with a `visibleWhen` is never folded: it already has a control deciding whether it is
 * there at all, and a second gate behind the first is one click too many.
 */
const foldsWhenEmpty = (f: Field, values: Values): boolean =>
  f.kind === 'text' && f.placeholder === 'Optional' && !f.visibleWhen && !String(values[f.key] ?? '').trim();

/** The rail shows one word per category: "Shape & size" → "Shape". */
function railLabel(title: string): string {
  const first = title.split(/[\s&·,/]+/)[0] ?? title;
  return first.length > 9 ? first.slice(0, 8) + '…' : first;
}

/** The shape library: category tabs over a grid of clean silhouettes — no hole, no keyring,
 *  just the blank — with the chosen one marked. */
function openShapePicker(cats: BlankCategory[], current: string, onPick: (def: BlankDef) => void) {
  const grid = el('div', { className: 'ls-shape-grid' });
  const showCategory = (cat: BlankCategory) => {
    grid.replaceChildren(thumbGrid({
      minPx: 104,
      tiles: BLANKS.filter((d) => d.category === cat).map((def) => thumbTile({
        svgPath: blankSilhouette(def), label: def.label, selected: def.id === current,
        onClick: () => { handle.close(); onPick(def); },
      })),
    }));
  };
  const first = cats.find((c) => BLANKS.some((d) => d.category === c && d.id === current)) ?? cats[0]!;
  const tabs = segmentedControl<BlankCategory>({
    options: cats.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    value: first,
    onChange: showCategory,
  });
  showCategory(first);
  const content = el('div', { className: 'ls-shape-picker' }, [tabs, grid]);
  const handle = dialog({ title: 'Choose a shape', content, size: 'wide', actions: [{ label: 'Cancel' }] });
}
