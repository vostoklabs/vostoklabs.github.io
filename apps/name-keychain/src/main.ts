import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  el,
  toast,
  openLicenseModal,
  topbarLinks,
  segmentedControl,
  selectField,
  sliderRow,
  toggleSwitch,
  readParamsFromHash,
  dpad,
  dialog,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
// @ts-ignore
import * as opentype from 'opentype.js';
import { createViewer } from './viewer/viewer';
import { downloadThreeMF } from './export/threemfExport';
import { FONTS, type FontChoice } from './generated-fonts';
import type { GeometryResponse, PartMesh } from './types';
import { getHorizontalContours, getVerticalContours } from './geometry/textLayout';
import { noAmsPauses } from './geometry/noAms';

type Layout = 'horizontal' | 'vertical';
type LetterStyle = 'raised' | 'engraved';

// Eagerly load all font asset URLs from the src/fonts/ folder (for opentype geometry).
const fontUrls = (import.meta as any).glob('./fonts/*.ttf', { eager: true, import: 'default' }) as Record<string, string>;

// The full font registry (id / label / category / curated) is generated from the fonts
// folder — see generated-fonts.ts. Curated fonts show as instant cards; the rest live in
// the "Browse all fonts" modal.
const curatedFonts = FONTS.filter((f) => f.curated);

const state = {
  name: 'Name',
  secondLine: '',
  font: 'luckiest-guy',
  layout: 'horizontal' as Layout,
  style: 'raised' as LetterStyle,
  plateShape: 'outline' as 'outline' | 'rectangle',
  size: 18,
  line2Scale: 1.0,
  line2Align: 'center' as 'left' | 'center' | 'right',
  baseThickness: 2.0,
  textThickness: 1.6,
  outlineWidth: 2.5,
  smoothing: 2.0,
  ringStyle: 'loop' as 'loop' | 'corner',
  holeDia: 4.0,
  ringThickness: 2.2,
  ringPosX: 0,
  ringPosY: 0,
  haloWidth: 1.2,
  haloThickness: 0.8,
  plate: '#1d2027',
  halo: '#5b9dff',
  text: '#f2f4f8',
  haloOn: true,
  colorScheme: 'plate-halo-text' as 'single' | 'plate-text' | 'plate-halo-text',

  // Typography
  lineSpacing: 1.0, // multiplier on the font's default line gap
  letterSpacing: 0, // tracking, fraction of the em
  boldness: 0, // glyph dilation in mm

  // Edge finish
  chamferOn: true,
  chamfer: 0.4, // mm

  // Print mode
  printMode: 'ams' as 'ams' | 'noams',
  layerHeight: 0.2,
};

// Check for shared URL hash parameters
const shared = readParamsFromHash();
if (shared) {
  Object.assign(state, shared);
}

// ---------------------------------------------------------------------------
// Main thread app logic
// ---------------------------------------------------------------------------
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

const nameInput = el('input', { className: 'nk-name-input', attrs: { type: 'text', maxlength: '18', value: state.name, 'aria-label': 'Name' } });
const secondInput = el('input', { className: 'nk-second-input', attrs: { type: 'text', maxlength: '18', placeholder: 'Optional second line', 'aria-label': 'Second line', value: state.secondLine } });
const fontGrid = el('div', { className: 'nk-font-grid' });
const stage = el('section', { className: 'nk-stage' });
const statusEl = el('div', { className: 'nk-status show', text: 'Loading worker...' });

const fontCache = new Map<string, any>();
const fontUrlsClean = Object.entries(fontUrls).reduce((acc, [k, v]) => {
  const cleanKey = k.replace('./fonts/', '').replace('.ttf', '');
  acc[cleanKey] = v;
  return acc;
}, {} as Record<string, string>);

async function loadFont(fontId: string): Promise<any> {
  const url = fontUrlsClean[fontId];
  if (!url) throw new Error(`Font url not resolved for ${fontId}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed for font ${fontId}`);
  return opentype.parse(await r.arrayBuffer());
}

async function getFont(fontId: string): Promise<any> {
  let f = fontCache.get(fontId);
  if (!f) {
    f = await loadFont(fontId);
    fontCache.set(fontId, f);
  }
  return f;
}

function showStatus(txt: string) {
  statusEl.textContent = txt;
  statusEl.classList.add('show');
}

function hideStatus() {
  statusEl.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });

let isWorkerBusy = false;
let needsRebuild = false;
let rebuildTimeout: any = null;
let lastParts: PartMesh[] = [];

// Each font's natural line gap differs; this is the default the user's Line spacing
// slider multiplies. Pixel/condensed faces want a tighter default.
function baseLineFactor(fontId: string): number {
  if (fontId === 'vt323' || fontId === 'press-start-2p') return 0.44;
  if (fontId === 'creepster') return 0.55;
  return 0.62;
}

function triggerRebuild() {
  needsRebuild = true;
  if (isWorkerBusy) return;
  if (rebuildTimeout) clearTimeout(rebuildTimeout);
  rebuildTimeout = setTimeout(runRebuild, 80);
}

async function runRebuild() {
  if (!needsRebuild) return;
  needsRebuild = false;
  isWorkerBusy = true;
  showStatus('Generating 3D model...');

  try {
    const font = await getFont(state.font);
    const gap = 2 * (state.holeDia / 2 + state.ringThickness) + 2;
    const line2Sz = state.size * state.line2Scale;
    // User's Line spacing slider scales the font's natural default.
    const lineFactor = baseLineFactor(state.font) * state.lineSpacing;

    const res = state.layout === 'vertical'
      ? getVerticalContours(font, state.name, state.size, state.lineSpacing, state.letterSpacing)
      : getHorizontalContours(font, state.name, state.secondLine, state.size, line2Sz, gap, state.line2Align, lineFactor, state.letterSpacing);

    worker.postMessage({
      type: 'build',
      textContours: res.contours,
      params: {
        name: state.name,
        secondLine: state.secondLine,
        font: state.font,
        layout: state.layout,
        style: state.style,
        size: state.size,
        line2Scale: state.line2Scale,
        baseThickness: state.baseThickness,
        textThickness: state.textThickness,
        outlineWidth: state.outlineWidth,
        smoothing: state.smoothing,
        ringStyle: state.ringStyle,
        holeDia: state.holeDia,
        ringThickness: state.ringThickness,
        ringPosX: state.ringPosX,
        ringPosY: state.ringPosY,
        haloWidth: state.haloWidth,
        haloThickness: state.haloThickness,
        colorScheme: state.colorScheme,
        plateColor: state.plate,
        haloColor: state.halo,
        textColor: state.text,
        plateShape: state.plateShape,
        lineSpacing: state.lineSpacing,
        letterSpacing: state.letterSpacing,
        boldness: state.boldness,
        chamfer: state.chamferOn ? state.chamfer : 0,
        printMode: state.printMode,
        layerHeight: state.layerHeight,
        lines: res.lines,
      },
    });
  } catch (e) {
    console.error(e);
    isWorkerBusy = false;
    hideStatus();
    toast(e instanceof Error ? e.message : 'Error preparing geometry', { kind: 'error' });
  }
}

// ---------------------------------------------------------------------------
// UI Setup & Rendering
// ---------------------------------------------------------------------------
function colorField(label: string, value: string, onInput: (value: string) => void): HTMLElement {
  const input = el('input', { attrs: { type: 'color', value, 'aria-label': label } });
  input.addEventListener('input', () => onInput(input.value));
  return el('label', { className: 'nk-color' }, [el('span', { text: label }), input]);
}

// ---------------------------------------------------------------------------
// Controls & Dynamic Visibility
// ---------------------------------------------------------------------------
const holeDpad = dpad({
  readout: `X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`,
  onMove: (dir) => {
    const step = 0.5;
    if (dir === 'up') state.ringPosY += step;
    else if (dir === 'down') state.ringPosY -= step;
    else if (dir === 'left') state.ringPosX -= step;
    else if (dir === 'right') state.ringPosX += step;
    holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
    triggerRebuild();
  },
  onReset: () => {
    state.ringPosX = 0;
    state.ringPosY = 0;
    holeDpad.setReadout(`X: 0.0 mm, Y: 0.0 mm`);
    triggerRebuild();
  }
});

const line2ScaleSlider = sliderRow({
  label: 'Subtitle scale',
  min: 0.3,
  max: 1.5,
  step: 0.1,
  value: state.line2Scale,
  onInput: (v) => { state.line2Scale = v; triggerRebuild(); }
});

const line2AlignControl = segmentedControl<'left' | 'center' | 'right'>({
  value: state.line2Align,
  options: [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ],
  onChange: (v) => { state.line2Align = v; triggerRebuild(); }
});

const haloWidthSlider = sliderRow({
  label: 'Halo outline width',
  min: 0.2,
  max: 4.0,
  step: 0.1,
  value: state.haloWidth,
  unit: 'mm',
  help: 'Width of the coloured outline that hugs each letter (3-colour schemes).',
  onInput: (v) => { state.haloWidth = v; triggerRebuild(); }
});

const haloThicknessSlider = sliderRow({
  label: 'Halo thickness',
  min: 0.2,
  max: 2.0,
  step: 0.1,
  value: state.haloThickness,
  unit: 'mm',
  help: 'Height of the coloured halo band (raised style). Also sets the 2nd no-AMS pause layer.',
  onInput: (v) => { state.haloThickness = v; refreshNoAmsReadout(); triggerRebuild(); }
});

// --- Typography ---
const boldnessSlider = sliderRow({
  label: 'Boldness',
  min: -0.3, max: 0.7, step: 0.05, value: state.boldness, unit: 'mm',
  help: 'Fattens (or thins) the letter strokes.',
  onInput: (v) => { state.boldness = v; triggerRebuild(); },
});

const letterSpacingSlider = sliderRow({
  label: 'Letter spacing',
  min: -0.08, max: 0.4, step: 0.02, value: state.letterSpacing,
  format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
  help: 'Squash letters together or spread them apart.',
  onInput: (v) => { state.letterSpacing = v; triggerRebuild(); },
});

const lineSpacingSlider = sliderRow({
  label: 'Line spacing',
  min: 0.5, max: 1.8, step: 0.05, value: state.lineSpacing,
  format: (v) => `${Math.round(v * 100)}%`,
  help: 'Gap between the first and second line.',
  onInput: (v) => { state.lineSpacing = v; triggerRebuild(); },
});

// --- Edge finish ---
const chamferSlider = sliderRow({
  label: 'Chamfer size',
  min: 0.15, max: 1.0, step: 0.05, value: state.chamfer, unit: 'mm',
  help: 'How deep the bevel cuts into the top edges.',
  onInput: (v) => { state.chamfer = v; triggerRebuild(); },
});
const chamferToggle = toggleSwitch({
  label: 'Chamfer edges',
  checked: state.chamferOn,
  help: 'Bevels the top edges of the plate and letters for a softer, more finished look.',
  onChange: (val) => { state.chamferOn = val; updateControlsVisibility(); triggerRebuild(); },
});

// Edge smoothing lives up top (not in Advanced): it's the fix when a font's letters
// come out visually disconnected — raise it to fuse them into one solid plate.
const smoothingSlider = sliderRow({
  label: 'Edge smoothing', min: 0.0, max: 4.0, step: 0.5, value: state.smoothing, unit: 'mm',
  help: 'Fills tight gaps between letters and rounds the plate outline. If your letters look disconnected or the plate breaks into pieces, raise this until it’s one solid shape.',
  onInput: (v) => { state.smoothing = v; triggerRebuild(); },
});

// --- Print mode (AMS vs manual filament swap) ---
const noAmsReadout = el('p', { className: 'nk-hint nk-noams-readout' });
function refreshNoAmsReadout() {
  const pauses = noAmsPauses({
    colorScheme: state.colorScheme,
    style: state.style,
    baseThickness: state.baseThickness,
    haloThickness: state.haloThickness,
    layerHeight: state.layerHeight,
  });
  if (state.printMode !== 'noams') {
    noAmsReadout.textContent = 'Each colour prints on its own extruder automatically.';
  } else if (pauses.length === 0) {
    noAmsReadout.textContent = 'Add a second colour (raised style) to use manual swaps.';
  } else {
    noAmsReadout.textContent =
      'Pause & swap filament at: ' + pauses.map((p) => `${p.z.toFixed(1)} mm → ${p.label}`).join(', ') + '.';
  }
}
const printModeControl = segmentedControl<'ams' | 'noams'>({
  value: state.printMode,
  options: [
    { value: 'ams', label: 'AMS / auto' },
    { value: 'noams', label: 'Manual swap' },
  ],
  onChange: (v) => { state.printMode = v; updateControlsVisibility(); refreshNoAmsReadout(); triggerRebuild(); },
});

const plateColorField = colorField('Plate', state.plate, (value) => {
  state.plate = value;
  if (viewer) viewer.setPartColor('plate', value);
  triggerRebuild();
});
const haloColorField = colorField('Halo', state.halo, (value) => {
  state.halo = value;
  if (viewer) viewer.setPartColor('halo', value);
  triggerRebuild();
});
const textColorField = colorField('Text', state.text, (value) => {
  state.text = value;
  if (viewer) viewer.setPartColor('text', value);
  triggerRebuild();
});

function updateControlsVisibility() {
  const line2Visible = state.secondLine.trim() !== '' && state.layout === 'horizontal';
  line2ScaleSlider.classList.toggle('hidden', !line2Visible);
  line2AlignControl.classList.toggle('hidden', !line2Visible);

  // Line spacing matters when there are two horizontal lines, or a vertical stack.
  const lineSpacingVisible = line2Visible || state.layout === 'vertical';
  lineSpacingSlider.classList.toggle('hidden', !lineSpacingVisible);

  const haloVisible = state.colorScheme === 'plate-halo-text';
  haloWidthSlider.classList.toggle('hidden', !haloVisible);
  haloThicknessSlider.classList.toggle('hidden', !haloVisible);

  haloColorField.classList.toggle('hidden', state.colorScheme !== 'plate-halo-text');
  textColorField.classList.toggle('hidden', state.colorScheme === 'single');

  chamferSlider.classList.toggle('hidden', !state.chamferOn);

  // No-AMS only applies to raised multicolour prints.
  const noAmsApplies = state.style === 'raised' && state.colorScheme !== 'single';
  printModeControl.classList.toggle('hidden', !noAmsApplies);
  noAmsReadout.classList.toggle('hidden', !noAmsApplies);
  refreshNoAmsReadout();
}

function fontSampleText(): string {
  const t = state.name.trim() || 'Aa';
  return t.length > 8 ? t.slice(0, 7) + '…' : t;
}

function makeFontCard(font: FontChoice): HTMLButtonElement {
  const btn = el('button', {
    className: 'nk-font-card',
    attrs: { type: 'button', 'data-font': font.id, title: font.label },
  }, [
    el('span', { className: 'nk-font-card__sample', text: fontSampleText(), attrs: { style: `font-family: NK-${font.id}` } }),
    el('span', { className: 'nk-font-card__name', text: font.label }),
  ]) as HTMLButtonElement;
  btn.addEventListener('click', () => selectFont(font.id));
  return btn;
}

// Curated cards; the active font is pinned first when it isn't one of them
// (e.g. chosen from the Browse-all modal) so the grid always shows the selection.
function renderFontGrid() {
  fontGrid.replaceChildren();
  const active = FONTS.find((f) => f.id === state.font);
  if (active && !active.curated) fontGrid.append(makeFontCard(active));
  for (const font of curatedFonts) fontGrid.append(makeFontCard(font));
  updateActiveFont();
}

function updateActiveFont() {
  const sample = fontSampleText();
  for (const btn of fontGrid.querySelectorAll<HTMLButtonElement>('button')) {
    btn.classList.toggle('active', btn.dataset.font === state.font);
    const s = btn.querySelector('.nk-font-card__sample');
    if (s) s.textContent = sample;
  }
}

function selectFont(id: string) {
  state.font = id;
  renderFontGrid();
  triggerRebuild();
}

// "Browse all fonts" — a searchable, category-filterable modal with a live
// preview rendered in each font (the current name, or "Sample").
function openFontBrowser() {
  let search = '';
  let cat = 'All';
  const categories = ['All', ...Array.from(new Set(FONTS.map((f) => f.category))).sort()];

  const searchInput = el('input', {
    className: 'nk-fb__search',
    attrs: { type: 'search', placeholder: `Search ${FONTS.length} fonts…`, 'aria-label': 'Search fonts' },
  }) as HTMLInputElement;
  const chips = el('div', { className: 'nk-fb__chips' });
  const list = el('div', { className: 'nk-fb__list' });

  // Lazy-load each row's font only as it scrolls into view — avoids fetching
  // all bundled fonts at once when the modal opens.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const row = entry.target as HTMLElement;
      const preview = row.querySelector<HTMLElement>('.nk-fb__preview');
      if (preview) preview.style.fontFamily = `NK-${row.dataset.font}`;
      io.unobserve(row);
    }
  }, { root: list, rootMargin: '250px' });

  const sampleText = () => {
    const t = state.name.trim();
    return t ? (t.length > 14 ? t.slice(0, 14) : t) : 'Sample';
  };

  function render() {
    io.disconnect();
    list.replaceChildren();
    const q = search.trim().toLowerCase();
    const matches = FONTS.filter((f) =>
      (cat === 'All' || f.category === cat) &&
      (!q || f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)),
    );
    if (!matches.length) {
      list.append(el('p', { className: 'nk-fb__empty', text: `No fonts match “${search.trim()}”.` }));
      return;
    }
    const sample = sampleText();
    matches.forEach((f, i) => {
      const preview = el('span', { className: 'nk-fb__preview', text: sample });
      // Eager-load the first screenful; lazy-load the rest as they scroll in.
      if (i < 36) preview.style.fontFamily = `NK-${f.id}`;
      const row = el('button', {
        className: `nk-fb__row${f.id === state.font ? ' active' : ''}`,
        attrs: { type: 'button', 'data-font': f.id, title: f.label },
      }, [
        preview,
        el('span', { className: 'nk-fb__meta' }, [
          el('span', { className: 'nk-fb__name', text: f.label }),
          el('span', { className: 'nk-fb__cat', text: f.category }),
        ]),
      ]);
      row.addEventListener('click', () => { selectFont(f.id); handle.close(); });
      list.append(row);
      if (i >= 36) io.observe(row);
    });
  }

  for (const c of categories) {
    const chip = el('button', { className: `nk-fb__chip${c === cat ? ' active' : ''}`, text: c, attrs: { type: 'button' } });
    chip.addEventListener('click', () => {
      cat = c;
      for (const other of chips.querySelectorAll('button')) other.classList.toggle('active', other === chip);
      render();
    });
    chips.append(chip);
  }
  searchInput.addEventListener('input', () => { search = searchInput.value; render(); });

  const content = el('div', { className: 'nk-fontmodal' }, [searchInput, chips, list]);
  const handle = dialog({ title: 'Choose a font', content });
  render();
  searchInput.focus();
}

async function handleExport(formatId: string) {
  if (formatId === '3mf') {
    if (!lastParts.length) throw new Error('No 3D geometry generated yet.');
    const fn = `${state.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'name'}-keychain.3mf`;
    downloadThreeMF(lastParts, fn);
    openLicenseModal({ badge: '✓ 3MF Export started' });
  } else if (formatId === 'stl') {
    toast('STL multi-part export is zipped in 3MF, download 3MF for Orca/Bambu separate plates.', { kind: 'warn' });
  }
}

nameInput.addEventListener('input', () => {
  state.name = nameInput.value || 'Name';
  updateActiveFont();
  triggerRebuild();
});
secondInput.addEventListener('input', () => {
  state.secondLine = secondInput.value;
  updateControlsVisibility();
  triggerRebuild();
});

const browseFontsBtn = el('button', {
  className: 'nk-browse-fonts',
  text: `Browse all ${FONTS.length} fonts →`,
  attrs: { type: 'button' },
});
browseFontsBtn.addEventListener('click', openFontBrowser);

// Advanced tuning.
const advanced = el('div', { className: 'vl-section nk-advanced' }, [
  el('p', { className: 'vl-label', text: 'Advanced (Fine-tuning)' }),
  el('div', { className: 'nk-advanced__body' }, [
    sliderRow({
      label: 'Text thickness', min: 0.6, max: 4.0, step: 0.2, value: state.textThickness, unit: 'mm',
      onInput: (v) => { state.textThickness = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Border outline width', min: 0.5, max: 6.0, step: 0.1, value: state.outlineWidth, unit: 'mm',
      help: 'How much plate sticks out around the letters (the coloured border of the keychain).',
      onInput: (v) => { state.outlineWidth = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Plate thickness', min: 1.0, max: 4.0, step: 0.2, value: state.baseThickness, unit: 'mm',
      help: 'Overall thickness of the backing plate.',
      onInput: (v) => { state.baseThickness = v; refreshNoAmsReadout(); triggerRebuild(); },
    }),
    sliderRow({
      label: 'Loop thickness', min: 1.0, max: 6.0, step: 0.2, value: state.ringThickness, unit: 'mm',
      help: 'How chunky the keyring loop is (material around the hole).',
      onInput: (v) => { state.ringThickness = v; triggerRebuild(); },
    }),
    haloWidthSlider,
    haloThicknessSlider,
  ]),
]);

// Dismissable "best print quality" callout — returns null once the user has closed it.
const qualityCard = qualityCallout({
  html: 'For the best quality printed keychain, please use the print profile and instructions available on <a href="https://makerworld.com/en/@Vostok_Labs" target="_blank" rel="noopener">MakerWorld</a>.',
  storageKey: 'nk-quality-callout',
});

const controlsScroll = el('div', { className: 'nk-controls__scroll' }, [
  generatorHeader({
    title: 'Name Keychain Generator',
    description: 'Make a personalized plate-style name keychain with live font and colour preview.',
  }),
  ...(qualityCard ? [qualityCard] : []),
  // Text
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Text' }),
    nameInput,
    secondInput,
    line2AlignControl,
  ]),

  // Layout & style
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Layout & style' }),
    segmentedControl<Layout>({
      label: 'Layout',
      help: 'Letters in a row (Horizontal) or stacked in a column under the ring (Vertical).',
      value: state.layout,
      options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }],
      onChange: (value) => { state.layout = value; updateControlsVisibility(); triggerRebuild(); }
    }),
    segmentedControl<LetterStyle>({
      label: 'Letter style',
      help: 'Raised = letters stand up off the plate. Engraved = letters are inlaid flush into the plate.',
      value: state.style,
      options: [{ value: 'raised', label: 'Raised' }, { value: 'engraved', label: 'Engraved' }],
      onChange: (value) => { state.style = value; updateControlsVisibility(); triggerRebuild(); }
    }),
    segmentedControl<'outline' | 'rectangle'>({
      label: 'Plate shape',
      help: 'Outline hugs the letters like a sticker; Rectangle is a plain rounded rectangle behind them.',
      value: state.plateShape,
      options: [{ value: 'outline', label: 'Outline' }, { value: 'rectangle', label: 'Rectangle' }],
      onChange: (value) => { state.plateShape = value; triggerRebuild(); }
    }),
    smoothingSlider,
    chamferToggle,
    chamferSlider,
  ]),

  // Typography
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Typography' }),
    boldnessSlider,
    letterSpacingSlider,
    lineSpacingSlider,
    line2ScaleSlider,
  ]),

  // Colours
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Colours' }),
    selectField({
      label: 'Colour scheme',
      help: 'Single = one filament. 2 colours adds a separate name colour. 3 colours adds a coloured outline (halo) around the name.',
      value: state.colorScheme,
      options: [
        { value: 'single', label: 'Single colour' },
        { value: 'plate-text', label: '2 colours (Plate + Name)' },
        { value: 'plate-halo-text', label: '3 colours (Plate + Name + Outline)' },
      ],
      onChange: (value) => {
        state.colorScheme = value as 'single' | 'plate-text' | 'plate-halo-text';
        state.haloOn = value === 'plate-halo-text';
        updateControlsVisibility();
        triggerRebuild();
      }
    }),
    el('div', { className: 'nk-colors' }, [
      plateColorField,
      haloColorField,
      textColorField,
    ]),
  ]),

  // Size & keyring
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Size & keyring' }),
    sliderRow({
      label: 'Text size', min: 10, max: 28, value: state.size, unit: 'mm',
      onInput: (value) => { state.size = value; triggerRebuild(); }
    }),
    segmentedControl<'loop' | 'corner'>({
      label: 'Keyring',
      help: 'Loop Tab adds a protruding tab with a hole; Corner Hole punches the hole into the top corner of the name.',
      value: state.ringStyle,
      options: [{ value: 'loop', label: 'Loop Tab' }, { value: 'corner', label: 'Corner Hole' }],
      onChange: (val) => { state.ringStyle = val; triggerRebuild(); }
    }),
    sliderRow({
      label: 'Hole diameter', min: 2.0, max: 8.0, step: 0.5, value: state.holeDia, unit: 'mm',
      help: 'Diameter of the keyring hole. Match your split ring or clip.',
      onInput: (v) => { state.holeDia = v; triggerRebuild(); }
    }),
    el('div', { className: 'nk-nudge' }, [
      el('span', { className: 'vl-hint', text: 'Nudge loop position' }),
      holeDpad.root,
    ]),
  ]),

  // Advanced (collapsed)
  advanced,

  // Reset everything to defaults (reloads at the clean URL so every control resets).
  el('div', { className: 'vl-section nk-reset-section' }, [
    el('button', {
      className: 'vl-btn vl-btn--secondary nk-reset-btn',
      text: 'Reset all settings',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (window.confirm('Reset all settings to their defaults? Your current design will be cleared.')) {
            window.location.href = window.location.pathname;
          }
        },
      },
    }),
  ]),
]);

const controls = el('aside', { className: 'nk-controls' }, [
  controlsScroll
]);

// Right column = pick the font (the "source" of the look), then export.
const controlsRightScroll = el('div', { className: 'nk-controls__scroll nk-controls__scroll--font' }, [
  el('div', { className: 'vl-section nk-font-section' }, [
    el('p', { className: 'vl-label', text: 'Font' }),
    fontGrid,
    browseFontsBtn,
  ]),
]);

const controlsRightExport = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF Print-Ready' }],
  onExport: handleExport,
  onSave: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'keychain'}-project.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Project saved', { kind: 'ok' });
  },
  onLoad: (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = JSON.parse(reader.result as string);
        Object.assign(state, loaded);
        nameInput.value = state.name;
        secondInput.value = state.secondLine;
        holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
        updateControlsVisibility();
        renderFontGrid();
        triggerRebuild();
        toast('Project loaded', { kind: 'ok' });
      } catch {
        toast('Invalid project file', { kind: 'error' });
      }
    };
    reader.readAsText(file);
  },
  onHelp: () => {
    dialog({
      title: 'Name Keychain Generator — Help',
      content: el('div', {}, [
        el('p', { text: 'Type a name in the Text section, pick a font from the right panel, and customise the style, colours, and keyring options.' }),
        el('p', { text: 'When you\'re happy with the preview, click Export 3MF to download a print-ready file. Open the 3MF in your slicer (Bambu Studio, Orca, PrusaSlicer) and assign filament colours.' }),
        el('p', { text: 'Use Save / Load project to keep your settings as a JSON file and resume later.' }),
      ]),
      actions: [{ label: 'Got it', primary: true }],
    });
  },
  themeStorageKey: 'name-keychain-theme',
});

const controlsRight = el('aside', { className: 'nk-controls-right' }, [
  controlsRightScroll,
  controlsRightExport
]);

stage.append(
  el('p', { className: 'nk-stage__label', text: 'Live 3D Preview' }),
  statusEl,
  el('p', { className: 'nk-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' })
);

app.append(el('main', { className: 'nk-app', attrs: { style: 'position: relative;' } }, [
  topbarLinks({
    githubUrl: BRAND.urls.github,
    boostUrl: BRAND.urls.makerworld,
    themeToggle: false,
    themeStorageKey: 'name-keychain-theme'
  }),
  controls,
  stage,
  controlsRight
]));

// Update controls on shared preset load
if (shared) {
  nameInput.value = state.name;
  secondInput.value = state.secondLine;
  holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
}

// Initialize 3D Viewer
const viewer = createViewer(stage);
renderFontGrid();
updateControlsVisibility();

// Update theme changes
const observer = new MutationObserver(() => {
  const theme = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
  viewer.setTheme(theme);
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// Setup worker message handling
worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    isWorkerBusy = false;
    triggerRebuild();
    return;
  }
  if (msg.type === 'parts') {
    lastParts = msg.parts;
    viewer.setParts(msg.parts, true);
    hideStatus();
    isWorkerBusy = false;
    if (needsRebuild) runRebuild();
    return;
  }
  if (msg.type === 'error') {
    console.error(msg.message);
    hideStatus();
    isWorkerBusy = false;
    toast(msg.message, { kind: 'error' });
    return;
  }
};

worker.postMessage({ type: 'init' });
