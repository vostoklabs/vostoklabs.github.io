import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  el,
  toast,
  openLicenseModal,
  topbarLinks,
  exportPanel,
  presetShareButton,
  segmentedControl,
  sliderRow,
  toggleSwitch,
  readParamsFromHash,
  dpad,
  dialog,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
// @ts-ignore
import * as opentype from 'opentype.js';
import { createViewer } from './viewer/viewer';
import { downloadThreeMF } from './export/threemfExport';
import { FONTS, type FontChoice } from './generated-fonts';
import type { GeometryResponse, PartMesh } from './types';

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
  uniformHeight: false,
  colorScheme: 'plate-halo-text' as 'single' | 'plate-text' | 'plate-halo-text',
};

// Check for shared URL hash parameters
const shared = readParamsFromHash();
if (shared) {
  Object.assign(state, shared);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]!));
}

// Convert opentype.js path commands into polygon contours
function pathCommandsToPolygons(commands: any[], decimalPlaces = 3): number[][][] {
  const polygons: number[][][] = [];
  let currentPolygon: number[][] = [];

  for (const cmd of commands) {
    const c = cmd as any;
    if (c.type === 'M') {
      if (currentPolygon.length > 2) {
        polygons.push(currentPolygon);
      }
      currentPolygon = [[c.x, -c.y]]; // Flip Y for Z-up 3D space
    } else if (c.type === 'L') {
      currentPolygon.push([c.x, -c.y]);
    } else if (c.type === 'Q') {
      const p0 = currentPolygon[currentPolygon.length - 1];
      if (p0) {
        const segments = 8;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const x = (1 - t) * (1 - t) * p0[0]! + 2 * (1 - t) * t * c.x1 + t * t * c.x;
          const y = (1 - t) * (1 - t) * p0[1]! + 2 * (1 - t) * t * (-c.y1) + t * t * (-c.y);
          currentPolygon.push([x, y]);
        }
      }
    } else if (c.type === 'C') {
      const p0 = currentPolygon[currentPolygon.length - 1];
      if (p0) {
        const segments = 8;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const x = Math.pow(1 - t, 3) * p0[0]! + 3 * Math.pow(1 - t, 2) * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + Math.pow(t, 3) * c.x;
          const y = Math.pow(1 - t, 3) * p0[1]! + 3 * Math.pow(1 - t, 2) * t * (-c.y1) + 3 * (1 - t) * t * t * (-c.y2) + Math.pow(t, 3) * (-c.y);
          currentPolygon.push([x, y]);
        }
      }
    } else if (c.type === 'Z') {
      if (currentPolygon.length > 2) {
        polygons.push(currentPolygon);
      }
      currentPolygon = [];
    }
  }
  if (currentPolygon.length > 2) {
    polygons.push(currentPolygon);
  }

  const factor = Math.pow(10, decimalPlaces);
  return polygons.map((poly) =>
    poly.map((pt) => [
      Math.round(pt[0]! * factor) / factor,
      Math.round(pt[1]! * factor) / factor,
    ]),
  );
}

function getHorizontalContours(
  font: any,
  text: string,
  text2: string,
  text_size: number,
  line2_sz: number,
  gap: number,
  align: 'left' | 'center' | 'right',
  spacingFactor: number,
): { contours: number[][][]; box: { minX: number; maxX: number; minY: number; maxY: number } } {
  const contours: number[][][] = [];
  const line2_on = text2 !== '';
  const dy = (text_size + line2_sz) * spacingFactor;

  // Line 1
  const y1 = line2_on ? -dy / 2 : 0;
  const p1 = font.getPath(text, gap, y1, text_size);
  contours.push(...pathCommandsToPolygons(p1.commands));

  // Line 2
  if (line2_on) {
    const y2 = dy / 2;
    let x2 = gap;
    if (align !== 'left') {
      const w1 = font.getAdvanceWidth(text, text_size);
      const w2 = font.getAdvanceWidth(text2, line2_sz);
      if (align === 'center') {
        x2 = gap + (w1 - w2) / 2;
      } else if (align === 'right') {
        x2 = gap + (w1 - w2);
      }
    }
    const p2 = font.getPath(text2, x2, y2, line2_sz);
    contours.push(...pathCommandsToPolygons(p2.commands));
  }

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of contours) {
    for (const pt of poly) {
      const x = pt[0]!;
      const y = pt[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Vertically center text around Y=0
  const cy = (minY + maxY) / 2;
  for (const poly of contours) {
    for (const pt of poly) {
      pt[1] = pt[1]! - cy;
    }
  }

  return { contours, box: { minX, maxX, minY: minY - cy, maxY: maxY - cy } };
}

function getVerticalContours(
  font: any,
  text: string,
  text_size: number,
  vstep: number,
): { contours: number[][][]; box: { minX: number; maxX: number; minY: number; maxY: number } } {
  const contours: number[][][] = [];
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const path = font.getPath(char, 0, 0, text_size);
    const poly = pathCommandsToPolygons(path.commands);

    // Center character horizontally
    let cMinX = Infinity, cMaxX = -Infinity;
    for (const p of poly) {
      for (const pt of p) {
        const x = pt[0]!;
        if (x < cMinX) cMinX = x;
        if (x > cMaxX) cMaxX = x;
      }
    }
    const cx = isFinite(cMinX) ? (cMinX + cMaxX) / 2 : 0;
    const cy = -i * vstep;

    for (const p of poly) {
      for (const pt of p) {
        pt[0] = pt[0]! - cx;
        pt[1] = pt[1]! + cy;
      }
    }
    contours.push(...poly);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of contours) {
    for (const pt of poly) {
      const x = pt[0]!;
      const y = pt[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const cy = (minY + maxY) / 2;
  for (const poly of contours) {
    for (const pt of poly) {
      pt[1] = pt[1]! - cy;
    }
  }

  return { contours, box: { minX, maxX, minY: minY - cy, maxY: maxY - cy } };
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

function getLineSpacingFactor(fontId: string): number {
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
    const lineSpacingFactor = getLineSpacingFactor(state.font);
    
    let res: { contours: number[][][]; box: any };
    let line2XOffset = 0;
    if (state.layout === 'vertical') {
      const vstep = state.size * 1.06;
      res = getVerticalContours(font, state.name, state.size, vstep);
    } else {
      res = getHorizontalContours(font, state.name, state.secondLine, state.size, line2Sz, gap, state.line2Align, lineSpacingFactor);
      if (state.secondLine !== '') {
        const w1 = font.getAdvanceWidth(state.name, state.size);
        const w2 = font.getAdvanceWidth(state.secondLine, line2Sz);
        if (state.line2Align === 'center') {
          line2XOffset = (w1 - w2) / 2;
        } else if (state.line2Align === 'right') {
          line2XOffset = w1 - w2;
        }
      }
    }

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
        uniformHeight: state.uniformHeight,
        line2XOffset,
        lineSpacingFactor,
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
  onInput: (v) => { state.haloWidth = v; triggerRebuild(); }
});

const haloThicknessSlider = sliderRow({
  label: 'Halo thickness',
  min: 0.2,
  max: 2.0,
  step: 0.1,
  value: state.haloThickness,
  unit: 'mm',
  onInput: (v) => { state.haloThickness = v; triggerRebuild(); }
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
  
  const haloVisible = state.colorScheme === 'plate-halo-text';
  haloWidthSlider.classList.toggle('hidden', !haloVisible);
  haloThicknessSlider.classList.toggle('hidden', !haloVisible);

  haloColorField.classList.toggle('hidden', state.colorScheme !== 'plate-halo-text');
  textColorField.classList.toggle('hidden', state.colorScheme === 'single');
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

// Advanced tuning — always visible for now.
const advanced = el('div', { className: 'vl-section nk-advanced' }, [
  el('p', { className: 'vl-label', text: 'Advanced (Fine-tuning)' }),
  el('div', { className: 'nk-advanced__body' }, [
    sliderRow({
      label: 'Text thickness', min: 0.6, max: 4.0, step: 0.2, value: state.textThickness, unit: 'mm',
      onInput: (v) => { state.textThickness = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Border outline width', min: 0.5, max: 6.0, step: 0.1, value: state.outlineWidth, unit: 'mm',
      onInput: (v) => { state.outlineWidth = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Plate thickness', min: 1.0, max: 4.0, step: 0.2, value: state.baseThickness, unit: 'mm',
      onInput: (v) => { state.baseThickness = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Loop thickness', min: 1.0, max: 6.0, step: 0.2, value: state.ringThickness, unit: 'mm',
      onInput: (v) => { state.ringThickness = v; triggerRebuild(); },
    }),
    sliderRow({
      label: 'Edge smoothing', min: 0.0, max: 4.0, step: 0.5, value: state.smoothing, unit: 'mm',
      onInput: (v) => { state.smoothing = v; triggerRebuild(); },
    }),
    line2ScaleSlider,
    haloWidthSlider,
    haloThicknessSlider,
    el('div', { attrs: { style: 'height: 4px;' } }),
    toggleSwitch({
      label: 'Uniform height (rack fit)',
      checked: state.uniformHeight,
      onChange: (val) => { state.uniformHeight = val; triggerRebuild(); },
    }),
    el('div', { attrs: { style: 'height: 8px;' } }),
    el('div', { className: 'nk-nudge' }, [
      el('span', { className: 'vl-hint', text: 'Nudge loop position' }),
      holeDpad.root,
    ]),
  ]),
]);

const controlsScroll = el('div', { className: 'nk-controls__scroll' }, [
  // Text
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Text' }),
    nameInput,
    el('div', { attrs: { style: 'height: 10px;' } }),
    secondInput,
    el('div', { attrs: { style: 'height: 10px;' } }),
    line2AlignControl,
  ]),

  // Layout & style
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Layout & style' }),
    segmentedControl<Layout>({
      value: state.layout,
      options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }],
      onChange: (value) => { state.layout = value; updateControlsVisibility(); triggerRebuild(); }
    }),
    el('div', { attrs: { style: 'height: 12px;' } }),
    segmentedControl<LetterStyle>({
      value: state.style,
      options: [{ value: 'raised', label: 'Raised' }, { value: 'engraved', label: 'Engraved' }],
      onChange: (value) => { state.style = value; triggerRebuild(); }
    }),
  ]),

  // Colours
  el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: 'Colours' }),
    segmentedControl<'single' | 'plate-text' | 'plate-halo-text'>({
      value: state.colorScheme,
      options: [
        { value: 'single', label: '1 Color' },
        { value: 'plate-text', label: '2 Colors' },
        { value: 'plate-halo-text', label: '3 Colors' },
      ],
      onChange: (value) => {
        state.colorScheme = value;
        state.haloOn = value === 'plate-halo-text';
        updateControlsVisibility();
        triggerRebuild();
      }
    }),
    el('div', { attrs: { style: 'height: 14px;' } }),
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
    el('div', { attrs: { style: 'height: 10px;' } }),
    segmentedControl<'loop' | 'corner'>({
      value: state.ringStyle,
      options: [{ value: 'loop', label: 'Loop Tab' }, { value: 'corner', label: 'Corner Hole' }],
      onChange: (val) => { state.ringStyle = val; triggerRebuild(); }
    }),
    sliderRow({
      label: 'Hole diameter', min: 2.0, max: 8.0, step: 0.5, value: state.holeDia, unit: 'mm',
      onInput: (v) => { state.holeDia = v; triggerRebuild(); }
    }),
  ]),

  // Advanced (collapsed)
  advanced,
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

const controlsRightExport = el('div', { className: 'nk-export-sticky' }, [
  exportPanel({
    formats: [
      { id: '3mf', label: '3MF Print-Ready' }
    ],
    onExport: handleExport
  }),
  presetShareButton({ getParams: () => state, label: '' }),
]);

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
    boostUrl: BRAND.urls.makerworld
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
