import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
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
  isDesktop,
  closeAllDialogs,
  promptDialog,
  hostAssetUrl,
  bindExternalLinks,
  chooseFile,
  button,
  chip,
  listRow,
  section,
  filamentRow,
  symbolPickerButton,
  uploadCta,
  textField,
  type SymbolItem,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { unzipSync } from 'fflate';
import { createViewer } from './viewer/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { buildThreeMF, downloadThreeMF } from './export/threemfExport';
// Fonts, the opentype loader and the text-to-contours layout all live in
// @vostok/fonts so every generator that puts type on a model shares one set.
import {
  FONTS,
  type FontChoice,
  getFont,
  registerCustomFont,
  parseFont,
  isFontSupported,
  fontFamilyFor,
  curatedFonts as curatedFontsOf,
  getHorizontalContours,
  getVerticalContours,
  getFontUrl,
  FALLBACK_FONT_ID,
} from '@vostok/fonts';
import type { GeometryResponse, PartMesh } from './types';
import { noAmsPauses } from './geometry/noAms';
import type { DesktopHost } from '@vostok/ui-kit';

type Layout = 'horizontal' | 'vertical';
type LetterStyle = 'raised' | 'engraved';

/**
 * The generator, as something that can be started and stopped.
 *
 * This file used to be `main.ts` and ran the moment it was imported: it reached for
 * `#app`, started a geometry worker, and held its state in module-level constants. That is
 * fine for a browser tab, which loads one tool and never unloads it — and impossible for a
 * desktop app that has to start this when you open it and stop it when you leave.
 *
 * So the body moved inside `mount()`, unchanged apart from where it gets its container,
 * and `main.ts` is now three lines that call it. Nothing about the web build changes.
 *
 * The returned function tears down. That is not politeness: the viewer holds a WebGL
 * context and an animation frame, and the worker holds a thread. Mount four generators
 * without unmounting them and the browser starts dropping the oldest context on the floor.
 */
export function mount(container: HTMLElement, host?: DesktopHost): () => void {
  // Outbound links go to the user's real browser rather than to this window, which has no
  // address bar and so no way back. One delegated listener, and a no-op on the web.
  bindExternalLinks(host);

  // Curated fonts show as instant cards; the rest live in the "Browse all" modal.
  const curatedFonts = curatedFontsOf();

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
    ringAngle: 180,
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
  // The container is given to us. On the web it is still #app; inside a host app it is
  // whatever element the host mounted us into.
  const app = container;

  const nameInput = el('input', { className: 'nk-name-input', attrs: { type: 'text', maxlength: '18', value: state.name, 'aria-label': 'Name' } });
  const secondInput = el('input', { className: 'nk-second-input', attrs: { type: 'text', maxlength: '18', placeholder: 'Optional second line', 'aria-label': 'Second line', value: state.secondLine } });

  const FA_ICONS = [
    { name: 'Smile', char: '\uf118' },
    { name: 'Laugh', char: '\uf599' },
    { name: 'Heart', char: '\uf004' },
    { name: 'Star', char: '\uf005' },
    { name: 'Cat', char: '\uf6be' },
    { name: 'Dog', char: '\uf6d3' },
    { name: 'Paw', char: '\uf1b0' },
    { name: 'Horse', char: '\uf6f0' },
    { name: 'Frog', char: '\uf52e' },
    { name: 'Dragon', char: '\uf6d5' },
    { name: 'Fish', char: '\uf578' },
    { name: 'Spider', char: '\uf717' },
    { name: 'Rocket', char: '\uf135' },
    { name: 'Space Shuttle', char: '\uf197' },
    { name: 'Meteor', char: '\uf753' },
    { name: 'Lightning', char: '\uf0e7' },
    { name: 'Fire', char: '\uf06d' },
    { name: 'Sun', char: '\uf185' },
    { name: 'Moon', char: '\uf186' },
    { name: 'Cloud', char: '\uf0c2' },
    { name: 'Snowflake', char: '\uf2dc' },
    { name: 'Tree', char: '\uf1bb' },
    { name: 'Leaf', char: '\uf06c' },
    { name: 'Seedling', char: '\uf4d8' },
    { name: 'Flower', char: '\uf5bb' },
    { name: 'Skull', char: '\uf187' },
    { name: 'Ghost', char: '\uf6e2' },
    { name: 'Gamepad', char: '\uf11b' },
    { name: 'Dice', char: '\uf522' },
    { name: 'Chess Knight', char: '\uf439' },
    { name: 'Crown', char: '\uf521' },
    { name: 'Gem', char: '\uf3a5' },
    { name: 'Ring', char: '\uf70b' },
    { name: 'Music', char: '\uf001' },
    { name: 'Guitar', char: '\uf7a6' },
    { name: 'Coffee', char: '\uf0f4' },
    { name: 'Pizza', char: '\uf818' },
    { name: 'Ice Cream', char: '\uf810' },
    { name: 'Apple', char: '\uf3d1' },
    { name: 'Car', char: '\uf1b9' },
    { name: 'Motorcycle', char: '\uf21c' },
    { name: 'Bicycle', char: '\uf206' },
    { name: 'Plane', char: '\uf072' },
    { name: 'Anchor', char: '\uf13d' },
    { name: 'Trophy', char: '\uf091' },
    { name: 'Camera', char: '\uf030' },
    { name: 'Palette', char: '\uf53f' },
    { name: 'Magic', char: '\uf0d0' },
    { name: 'Bomb', char: '\uf1e2' },
    { name: 'Poo', char: '\uf2fe' },
    { name: 'Yin Yang', char: '\uf6ad' },
    { name: 'Peace', char: '\uf67c' },
  ];

  const SYMBOL_ITEMS: SymbolItem[] = FA_ICONS.map((icon) => ({
    id: icon.name.toLowerCase().replace(/\s+/g, '-'),
    label: icon.name,
    char: icon.char,
  }));

  // Clicking the trigger blurs the text field, so the caret has to be captured on
  // pointerdown — by click time document.activeElement is the button and the
  // selection offsets are gone. Without this the symbol could only ever land at
  // the very end of the line.
  let symbolTarget = nameInput;
  let symbolCaret = { start: nameInput.value.length, end: nameInput.value.length };
  function captureSymbolCaret() {
    const active = document.activeElement === secondInput ? secondInput : nameInput;
    symbolTarget = active;
    symbolCaret = {
      start: active.selectionStart ?? active.value.length,
      end: active.selectionEnd ?? active.value.length,
    };
  }

  const emojiToggle = symbolPickerButton({
    items: SYMBOL_ITEMS,
    fontFamily: fontFamilyFor(FALLBACK_FONT_ID),
    label: 'Insert Symbol',
    className: 'vl-btn vl-btn--secondary nk-emoji-toggle',
    title: 'Insert a symbol',
    // A modal, not the default drawer: unmount only closes dialogs opened through
    // `dialog()` (see the teardown at the bottom), and a stray drawer would leak.
    placement: 'modal',
    stayOpen: true,
    onPick: (item) => {
      const { value } = symbolTarget;
      symbolTarget.value = value.slice(0, symbolCaret.start) + item.char + value.slice(symbolCaret.end);
      // Leave the caret after what was just inserted so symbols can be typed in a
      // row, and keep focus in the field the user was editing.
      const next = symbolCaret.start + item.char.length;
      symbolTarget.focus();
      symbolTarget.setSelectionRange(next, next);
      symbolCaret = { start: next, end: next };
      symbolTarget.dispatchEvent(new Event('input'));
    },
  });
  emojiToggle.addEventListener('pointerdown', captureSymbolCaret);

  const fontGrid = el('div', { className: 'nk-font-grid' });
  const stage = el('section', { className: 'nk-stage' });
  const statusEl = el('div', { className: 'nk-status show', text: 'Loading worker...' });

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
      const [font, fallbackFont] = await Promise.all([
        getFont(state.font),
        getFont('icon-fallback').catch(() => null)
      ]);

      const gap = 2 * (state.holeDia / 2 + state.ringThickness) + 2;
      const line2Sz = state.size * state.line2Scale;
      // User's Line spacing slider scales the font's natural default.
      const lineFactor = baseLineFactor(state.font) * state.lineSpacing;

      const res = state.layout === 'vertical'
        ? getVerticalContours(font, fallbackFont, state.name, state.size, state.lineSpacing, state.letterSpacing)
        : getHorizontalContours(font, fallbackFont, state.name, state.secondLine, state.size, line2Sz, gap, state.line2Align, lineFactor, state.letterSpacing);

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
          ringAngle: state.ringAngle,
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
  // Controls & Dynamic Visibility
  // ---------------------------------------------------------------------------
  const ringAngleSlider = sliderRow({
    label: 'Tab rotation', min: 0, max: 360, step: 5, value: state.ringAngle, unit: '°',
    help: 'Rotate the direction of the loop tab (90° = perpendicular top, 180° = left).',
    onInput: (v) => { state.ringAngle = v; triggerRebuild(); }
  });

  const holeDpad = dpad({
    readout: `X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`,
    rotateStep: 5,
    onMove: (dir) => {
      const step = 0.5;
      if (dir === 'up') state.ringPosY += step;
      else if (dir === 'down') state.ringPosY -= step;
      else if (dir === 'left') state.ringPosX -= step;
      else if (dir === 'right') state.ringPosX += step;
      holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
      triggerRebuild();
    },
    onRotate: (deltaDeg) => {
      let next = ((state.ringAngle ?? 180) + deltaDeg) % 360;
      if (next < 0) next += 360;
      state.ringAngle = next;
      holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
      triggerRebuild();
    },
    onReset: () => {
      state.ringPosX = 0;
      state.ringPosY = 0;
      state.ringAngle = 180;
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

  const plateColorField = filamentRow({
    label: 'Plate',
    value: state.plate,
    onChange: (value) => {
      state.plate = value;
      if (viewer) viewer.setPartColor('plate', value);
      triggerRebuild();
    },
  });
  const haloColorField = filamentRow({
    label: 'Halo',
    value: state.halo,
    onChange: (value) => {
      state.halo = value;
      if (viewer) viewer.setPartColor('halo', value);
      triggerRebuild();
    },
  });
  const textColorField = filamentRow({
    label: 'Text',
    value: state.text,
    onChange: (value) => {
      state.text = value;
      if (viewer) viewer.setPartColor('text', value);
      triggerRebuild();
    },
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
    const text = state.name + (state.secondLine || '');
    const supported = isFontSupported(font, text);

    const btn = el('button', {
      className: `nk-font-card${supported ? '' : ' unsupported'}`,
      attrs: { type: 'button', 'data-font': font.id, title: supported ? font.label : `${font.label} (Characters missing)` },
    }, [
      el('span', { className: 'nk-font-card__sample', text: fontSampleText(), attrs: { style: `font-family: ${fontFamilyFor(font.id)}` } }),
      el('span', { className: 'nk-font-card__name', text: font.label }),
      ...(!supported ? [el('span', { className: 'nk-font-card__warn', text: '⚠' })] : [])
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
    const text = state.name + (state.secondLine || '');
    for (const btn of fontGrid.querySelectorAll<HTMLButtonElement>('button')) {
      const fontId = btn.dataset.font!;
      const font = FONTS.find(f => f.id === fontId);
      if (font) {
        const supported = isFontSupported(font, text);
        btn.classList.toggle('unsupported', !supported);
        btn.title = supported ? font.label : `${font.label} (Characters missing)`;
        const warn = btn.querySelector('.nk-font-card__warn');
        if (!supported && !warn) {
          btn.append(el('span', { className: 'nk-font-card__warn', text: '⚠' }));
        } else if (supported && warn) {
          warn.remove();
        }
      }

      btn.classList.toggle('active', fontId === state.font);
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

    const searchField = textField({
      label: 'Search',
      type: 'search',
      placeholder: `Search ${FONTS.length} fonts…`,
      onInput: (value) => { search = value; render(); },
    });
    const chips = el('div', { className: 'nk-fb__chips' });
    const list = el('div', { className: 'nk-fb__list' });

    // Lazy-load each row's font only as it scrolls into view — avoids fetching
    // all bundled fonts at once when the modal opens.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const row = entry.target as HTMLElement;
        const preview = row.querySelector<HTMLElement>('.nk-fb__preview');
        if (preview) preview.style.fontFamily = `${fontFamilyFor(row.dataset.font!)}`;
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
        if (i < 36) preview.style.fontFamily = `${fontFamilyFor(f.id)}`;
        const supported = isFontSupported(f, state.name + (state.secondLine || ''));
        const row = el('button', {
          className: `nk-fb__row${f.id === state.font ? ' active' : ''}${supported ? '' : ' unsupported'}`,
          attrs: { type: 'button', 'data-font': f.id, title: supported ? f.label : `${f.label} (Characters missing)` },
        }, [
          preview,
          el('span', { className: 'nk-fb__meta' }, [
            el('span', { className: 'nk-fb__name', text: f.label }),
            el('span', { className: 'nk-fb__cat', text: f.category }),
            ...(!supported ? [el('span', { className: 'nk-fb__warn', text: '⚠' })] : [])
          ]),
        ]);
        row.addEventListener('click', () => { selectFont(f.id); handle.close(); });
        list.append(row);
        if (i >= 36) io.observe(row);
      });
    }

    const catChips: ReturnType<typeof chip>[] = [];
    for (const c of categories) {
      const catChip = chip({
        label: c,
        pressed: c === cat,
        onToggle: () => {
          cat = c;
          for (const other of catChips) other.setPressed(other === catChip);
          render();
        },
      });
      catChips.push(catChip);
      chips.append(catChip);
    }
    const content = el('div', { className: 'nk-fontmodal' }, [searchField, chips, list]);
    const handle = dialog({ title: 'Choose a font', content });
    render();
    searchField.field.focus();
  }

  /**
   * Makes an imported font usable: parsed for the mesh builder, injected as an @font-face
   * for the preview cards, and pushed to the front of the font list.
   *
   * Extracted because a font arrives two ways — the user picks a file, or a saved project
   * is opened and its fonts come back off disk — and the two must produce an identical
   * result. When they drifted, opening a project restored every parameter perfectly and
   * silently rendered it in the wrong typeface.
   */
  function registerImportedFont(label: string, buffer: ArrayBuffer): string {
    const font = parseFont(buffer);
    const fontId = `custom-${Date.now()}-${importedFontCounter++}`;
    registerCustomFont(fontId, font);

    const fontUrl = URL.createObjectURL(new Blob([buffer]));
    objectUrls.push(fontUrl);
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: '${fontFamilyFor(fontId)}'; src: url('${fontUrl}'); }`;
    document.head.appendChild(style);
    injectedStyles.push(style);

    const fontChoice = {
      id: fontId,
      label,
      category: 'Custom',
      curated: true,
      subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'],
    };
    FONTS.unshift(fontChoice);
    curatedFonts.unshift(fontChoice);
    return fontId;
  }

  let importedFontCounter = 0;
  /** Object URLs and <style> tags leak past unmount unless they are tracked and revoked. */
  const objectUrls: string[] = [];
  const injectedStyles: HTMLStyleElement[] = [];

  const fallbackUrl = getFontUrl(FALLBACK_FONT_ID);
  if (fallbackUrl) {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: '${fontFamilyFor(FALLBACK_FONT_ID)}'; src: url(${fallbackUrl}); }`;
    document.head.append(style);
    injectedStyles.push(style);
  }

  // ---------------------------------------------------------------------------
  // Desktop persistence
  //
  // On the web, Save writes a JSON file to Downloads and an imported font lives until you
  // close the tab. Inside a host app both of those become real: a project keeps its
  // parameters, its preview and its fonts, and is still there next week.
  //
  // Every one of these is a no-op without a host, so the browser build behaves exactly as
  // it always did.
  // ---------------------------------------------------------------------------

  /** The id of the project currently open, so Save overwrites rather than piling up copies. */
  let currentProjectId: string | undefined;

  /** Fonts the user imported, tracked so they can be re-registered on the next mount. */
  const importedFontAssets: { role: string; path: string; originalName: string }[] = [];

  /** A still of the viewer, for the Open list. `preserveDrawingBuffer` is already on. */
  function capturePreview(): string | undefined {
    const canvas = stage.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return undefined;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      // A tainted canvas would throw. Nothing here draws cross-origin images, but a
      // missing preview is not worth failing a save over.
      return undefined;
    }
  }

  async function saveToHost() {
    if (!host) return;
    const suggested = state.name.trim() || 'Keychain';
    const name = await promptDialog({
      title: currentProjectId ? 'Rename and save' : 'Save project',
      label: 'Project name',
      value: suggested,
    });
    if (name === null) return;
    try {
      const saved = await host.saveProject({
        id: currentProjectId,
        name: name.trim() || suggested,
        params: state,
        assets: importedFontAssets,
        previewDataUrl: capturePreview(),
      });
      currentProjectId = saved.id;
      toast(`Saved "${saved.name}"`, { kind: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the project', { kind: 'error' });
    }
  }

  /** Applies a loaded parameter blob to the live UI. Shared by both load paths. */
  function applyLoadedState(loaded: Record<string, unknown>) {
    Object.assign(state, loaded);
    nameInput.value = state.name;
    secondInput.value = state.secondLine;
    holeDpad.setReadout(`X: ${state.ringPosX.toFixed(1)} mm, Y: ${state.ringPosY.toFixed(1)} mm`);
    updateControlsVisibility();
    renderFontGrid();
    triggerRebuild();
  }

  async function openFromHost() {
    if (!host) return;
    const projects = await host.listProjects();
    if (!projects.length) {
      toast('No saved projects yet', { kind: 'warn' });
      return;
    }

    const list = el('div', { className: 'nk-project-list' });
    const handle = dialog({ title: 'Open a project', content: list });

    for (const p of projects) {
      list.append(listRow({
        label: p.name,
        thumb: p.preview ? convertPreviewSrc(p.preview) : undefined,
        onClick: () => {
          handle.close();
          void openProject(p.id);
        },
      }));
    }
  }

  /**
   * Loads one saved project into the live UI.
   *
   * Shared by the Open list and by the host handing us a project on arrival — the user
   * clicked a saved keychain in Opal's picker rather than the generator's own tile, and
   * making them find it again in a dialog would be a strange way to honour that click.
   */
  async function openProject(projectId: string) {
    if (!host) return;
    try {
      const project = await host.loadProject(projectId);
      await restoreFonts(project.assets);
      applyLoadedState(project.params as Record<string, unknown>);
      currentProjectId = project.id;
      toast(`Opened "${project.name}"`, { kind: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open the project', { kind: 'error' });
    }
  }

  /**
   * Hand the host the three things it needs to own projects for this generator.
   *
   * Everything built on them — autosave, the unsaved dot, Save, Open, Rename, Delete,
   * Start fresh — is then the host's, drawn once in its own chrome for every generator it
   * hosts, instead of a fourth copy of that machinery living in here. Optional and absent
   * on the web, where the block below keeps working exactly as it always has.
   */
  host?.registerProject?.({
    getState: () => state,
    applyState: async (loaded, assets) => {
      // Fonts first. Applying the parameters before the typeface they name is registered
      // would lay the name out in the fallback face and then never rebuild it.
      if (assets) await restoreFonts(assets);
      applyLoadedState(loaded as Record<string, unknown>);
    },
    assets: () => importedFontAssets,
    capturePreview,
    suggestName: () => state.name.trim() || 'Keychain',
  });

  // Only when the host is *not* owning projects: with `registerProject` the host opens the
  // arriving project itself, and doing it here as well would open it twice.
  if (!host?.registerProject) {
    const arrivingWith = host?.initialProjectId?.();
    if (arrivingWith) void openProject(arrivingWith);
  }

  /**
   * Re-registers the fonts a saved project was built with.
   *
   * Without this, opening a project that used an imported font silently falls back to a
   * different typeface — the parameters would restore perfectly and the keychain would be
   * wrong, which is worse than an error.
   */
  async function restoreFonts(assets: { role: string; path: string; originalName: string }[]) {
    if (!host) return;
    for (const asset of assets) {
      if (asset.role !== 'font') continue;
      if (importedFontAssets.some((a) => a.path === asset.path)) continue;
      try {
        const bytes = await host.readAsset(asset.path);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        registerImportedFont(asset.originalName.replace(/\.[^/.]+$/, ''), buffer);
        importedFontAssets.push(asset);
      } catch {
        toast(`Could not load the font "${asset.originalName}"`, { kind: 'warn' });
      }
    }
  }

  /**
   * A stored preview path, as something an `<img>` can load.
   *
   * This used to write `asset://localhost/…` out by hand, which is the macOS and Linux
   * form: on Windows the same webview serves `http://asset.localhost/…`, so every
   * thumbnail in this list was a broken image there and nothing said so. The host knows
   * which platform it is; the generator has no business guessing.
   */
  function convertPreviewSrc(path: string): string {
    return hostAssetUrl(host, path);
  }

  async function handleExport(formatId: string) {
    if (formatId === '3mf') {
      if (!lastParts.length) throw new Error('No 3D geometry generated yet.');
      const fn = `${state.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'name'}-keychain.3mf`;
      if (host) {
        // The whole reason the desktop bundle exists: the file does not land in Downloads
        // for you to find later, it lands in the library and shows up in the grid.
        const { indexed } = await host.exportToLibrary(
          { name: fn, bytes: buildThreeMF(lastParts) },
          { designer: 'Name Keychain Generator' },
        );
        toast(indexed ? 'Exported to your library' : `Exported as ${fn}`, { kind: 'ok' });
      } else {
        downloadThreeMF(lastParts, fn);
        openLicenseModal({ badge: '✓ 3MF Export started' });
      }
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

  const browseFontsBtn = button({
    label: `Browse all ${FONTS.length} fonts →`,
    className: 'nk-browse-fonts',
    onClick: openFontBrowser,
  });

  // `uploadCta()` owns its own hidden file input. The host's library goes first when
  // there is one: a typeface imported for one keychain is the most likely answer for
  // the next. Its click is intercepted before the label opens the hidden input — the
  // same interception the magnet generator's font import uses — and `onFiles` alone
  // serves the no-host path.
  const importFontCta = uploadCta({
    label: `Import custom font (.ttf/.otf/.zip)`,
    accept: '.ttf,.otf,.zip',
    onFiles: (files) => {
      const f = files[0];
      if (f) void handleFontFiles(f);
    },
  });
  importFontCta.addEventListener('click', (e) => {
    if (!host?.pickMedia) return;
    e.preventDefault();
    void chooseFile(host, { kind: 'font', extensions: ['ttf', 'otf', 'zip'] }, () => {})
      .then((f) => { if (f) void handleFontFiles(f); });
  });

  /**
   * One typeface, or a zip of them, from wherever it came.
   *
   * Named rather than inline on the input's `change`, because there are two ways in now:
   * the file input, and the host's media library. Both hand over a `File`, so both end up
   * here and neither has to know about the other.
   */
  async function handleFontFiles(file: File) {
    try {
      const rawBuffer = await file.arrayBuffer();
      const isZip = file.name.toLowerCase().endsWith('.zip');
    
      const filesToProcess: { name: string; buffer: ArrayBuffer }[] = [];

      if (isZip) {
        const unzipped = unzipSync(new Uint8Array(rawBuffer));
        for (const [name, data] of Object.entries(unzipped)) {
          if (!name.endsWith('/') && (name.toLowerCase().endsWith('.ttf') || name.toLowerCase().endsWith('.otf'))) {
            const cleanName = name.split('/').pop() || name;
            const arrayBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            filesToProcess.push({ name: cleanName, buffer: arrayBuf });
          }
        }
        if (filesToProcess.length === 0) {
          toast('No .ttf or .otf files found in the zip.', { kind: 'error' });
          return;
        }
      } else {
        filesToProcess.push({ name: file.name, buffer: rawBuffer });
      }

      let lastFontId = '';
      let count = 0;

      for (const f of filesToProcess) {
        try {
          const fontName = f.name.replace(/\.[^/.]+$/, "");
          const fontId = registerImportedFont(fontName, f.buffer);
          count++;

          // Keep the file, not just the parsed font. Without this the import survives
          // until the app closes, which is exactly the behaviour the desktop build exists
          // to fix.
          if (host) {
            try {
              const asset = await host.importAsset('font', { name: f.name, bytes: new Uint8Array(f.buffer) });
              importedFontAssets.push(asset);
            } catch {
              toast(`"${f.name}" is usable now but could not be saved for next time`, { kind: 'warn' });
            }
          }

          lastFontId = fontId;
        } catch (err) {
          console.error(`Failed to load font ${f.name}:`, err);
        }
      }

      if (count > 0) {
        selectFont(lastFontId);
        toast(`Imported ${count} font${count !== 1 ? 's' : ''}`, { kind: 'ok' });
      } else {
        toast('Failed to load any fonts from the file.', { kind: 'error' });
      }
    } catch (err) {
      console.error(err);
      toast('Failed to process file. Make sure it is a valid TTF, OTF or ZIP file.', { kind: 'error' });
    }
  }

  // Advanced tuning. The inner `nk-advanced__body` div keeps its own indented,
  // bordered look (see style.css) as the one child of the kit's section body.
  const advanced = section({
    title: 'Advanced (Fine-tuning)',
    body: [
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
    ],
  });
  advanced.classList.add('nk-advanced');

  // Dismissable "best print quality" callout — returns null once the user has closed it.
  const qualityCard = qualityCallout({
    html: `For the best quality printed keychain, please use the print profile and instructions available on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
    storageKey: 'nk-quality-callout',
  });

  const controlsScroll = el('div', { className: 'vl-panel__scroll' }, [
    generatorHeader({
      title: 'Name Keychain Generator',
      description: 'Make a personalized plate-style name keychain with live font and colour preview.',
    }),
    ...(qualityCard ? [qualityCard] : []),
    // Text
    section({
      title: 'Text',
      body: [
        nameInput,
        secondInput,
        emojiToggle,
        line2AlignControl,
      ],
    }),

    // Layout & style
    section({
      title: 'Layout & style',
      body: [
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
      ],
    }),

    // Typography
    section({
      title: 'Typography',
      body: [boldnessSlider, letterSpacingSlider, lineSpacingSlider, line2ScaleSlider],
    }),

    // Colours
    section({
      title: 'Colours',
      body: [
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
        plateColorField,
        haloColorField,
        textColorField,
      ],
    }),

    // Size & keyring
    section({
      title: 'Size & keyring',
      body: [
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
        ringAngleSlider,
        el('div', { className: 'nk-nudge' }, [
          el('span', { className: 'vl-hint', text: 'Nudge loop position' }),
          holeDpad.root,
        ]),
      ],
    }),

    // Advanced (collapsed)
    advanced,

    // Reset everything to defaults (reloads at the clean URL so every control resets).
    el('div', { className: 'vl-section nk-reset-section' }, [
      button({
        label: 'Reset all settings',
        emphasis: 'secondary',
        className: 'nk-reset-btn',
        onClick: () => {
          if (window.confirm('Reset all settings to their defaults? Your current design will be cleared.')) {
            window.location.href = window.location.pathname;
          }
        },
      }),
    ]),
  ]);

  const controls = el('aside', { className: 'vl-panel vl-panel--left' }, [
    controlsScroll
  ]);

  // Right column = pick the font (the "source" of the look), then export.
  const controlsRightScroll = el('div', { className: 'vl-panel__scroll nk-font-section-scroll' }, [
    el('div', { className: 'vl-section nk-font-section' }, [
      el('p', { className: 'vl-label', text: 'Font' }),
      fontGrid,
      browseFontsBtn,
      importFontCta,
    ]),
  ]);

  const controlsRightExport = sidebarFooter({
    // The host draws Save and Open itself when it owns projects; two Save buttons that
    // do different things is worse than either one alone. `Boolean(...)`, not `isDesktop()`:
    // a desktop host without the capability still needs these.
    hostOwnsProjects: Boolean(host?.registerProject),
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: handleExport,
    onSave: () => {
      if (host) { void saveToHost(); return; }
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'keychain'}-project.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Project saved', { kind: 'ok' });
    },
    onLoad: (file?: File) => {
      if (host) { void openFromHost(); return; }
      if (!file) return;
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
        title: 'Name Keychain Generator help',
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

  const controlsRight = el('aside', { className: 'vl-panel vl-panel--right' }, [
    controlsRightScroll,
    controlsRightExport
  ]);

  stage.className = 'vl-stage nk-stage';
  stage.append(
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    statusEl,
    el('p', { className: 'vl-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' })
  );

  app.append(el('main', { className: 'vl-app', attrs: { style: 'position: relative;' } }, [
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

  // Build plate picker (top-right of the stage); the plate is shared across generators.
  mountPlatePicker(stage, viewer);
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

  // Show What's New dialog once.
  //
  // Not on the desktop. This one is a hand-rolled `dialog()` rather than the kit's
  // `showWhatsNew`, so `setHostEnv('desktop')` does not reach it — it would pop over Opal
  // on first open, announcing features against a version number the desktop build does not
  // have. A release-notes popup belongs to the app that was released, and here that is Opal.
  if (!isDesktop() && !localStorage.getItem('nk_whats_new_v3')) {
    localStorage.setItem('nk_whats_new_v3', '1');
    dialog({
      title: 'What\'s New!',
      content: el('div', { attrs: { style: 'display: flex; flex-direction: column; gap: 16px; margin-top: 8px;' } }, [
        el('div', {}, [
          el('strong', { text: 'Custom Font Import' }),
          el('p', { text: 'You can now import your own .ttf or .otf files directly into the generator using the new "Import custom font" button.', attrs: { style: 'margin-top: 4px; line-height: 1.4;' } })
        ]),
        el('div', {}, [
          el('strong', { text: 'Cyrillic & Non-English Support' }),
          el('p', { text: 'Fonts with non-English characters are now fully supported. Unsupported fonts are automatically dimmed in the preview panel so you know exactly what works.', attrs: { style: 'margin-top: 4px; line-height: 1.4;' } })
        ]),
        el('div', {}, [
          el('strong', { text: 'Solid Icon Symbols' }),
          el('p', { text: 'You can now insert dozens of solid FontAwesome symbols directly into your keychains using the "Insert Symbol" button! They scale perfectly and extrude into solid 3D plastic.', attrs: { style: 'margin-top: 4px; line-height: 1.4;' } })
        ]),
      ]),
      actions: [{ label: 'Awesome!', primary: true }],
    });
  }

  return () => {
    // The Open-a-project list is a dialog, and dialogs live on <body> — outside the
    // container the host clears. Unmounting with one open would strand it.
    closeAllDialogs();
    observer.disconnect();
    worker.terminate();
    viewer.dispose();
    if (rebuildTimeout) clearTimeout(rebuildTimeout);
    // Imported fonts add an <style> tag to <head> and hold a blob URL. Both live outside
    // the container, so replaceChildren() would not touch them and every mount would
    // leave another pair behind.
    for (const url of objectUrls) URL.revokeObjectURL(url);
    for (const style of injectedStyles) style.remove();
    container.replaceChildren();
  };
}
