import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  section,
  collapsibleSection,
  sourceCards,
  modeBar,
  stageStatus,
  sliderRow,
  toggleSwitch,
  segmentedControl,
  selectField,
  toast,
  dialog,
  el,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import {
  DEFAULT_PARAMS,
  MACHINES,
  SHEETS,
  STOCKS,
  type BoxParams,
  type FoldMode,
  type SolveResult,
  type StyleId,
} from './types';
import { solve, machineById, stockById } from './geometry/solve';
import { STYLES, styleMeta, insideDims } from './geometry/styles';
import { buildRig, type FoldRig } from './fold/rig';
import { createFlatView, styleIcon } from './ui/flatView';
import { downloadCutFiles } from './export/cutFiles';

/*
  Fold-up box generator.

  A style builder emits panels; `buildNet` derives the cut outline AND the fold tree
  from the same panels, so the dieline and the animation can never disagree. Nothing
  runs in a worker — the whole solve is straight-line 2D polygon work on a few dozen
  panels, and keeping it synchronous means a slider drag has no async flicker in it.

  Layout is the house three-column shell (apps/generator-template/README.md):
    LEFT    what you are making   — style, size, closure, window
    STAGE   the dieline, or the box folding itself
    RIGHT   what goes in and out  — stock, machine, results, export
*/

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------
let params: BoxParams = { ...DEFAULT_PARAMS };
let result: SolveResult | null = null;
let rig: FoldRig | null = null;
/** Master fold scrub, 0 = flat blank, 1 = closed box. */
let progress = 1;
let playing = false;
let mode: 'flat' | 'fold' = 'fold';

const CARD_COLORS: Record<string, { color: string; edge: string }> = {
  kraft300: { color: '#c8a273', edge: '#6d4f2c' },
  default: { color: '#eae6df', edge: '#8d867c' },
};

// ---------------------------------------------------------------------------
// 2. REBUILD
// ---------------------------------------------------------------------------
let rebuildQueued = 0;

function triggerRebuild(refit = false): void {
  clearTimeout(rebuildQueued);
  // setTimeout rather than rAF: rAF never fires in a background tab, which would
  // leave a model that silently never builds.
  rebuildQueued = setTimeout(() => rebuild(refit), 90);
}

function rebuild(refit: boolean): void {
  const started = performance.now();
  try {
    result = solve(params);
  } catch (err) {
    status.set(`Could not build that box: ${(err as Error).message}`, 'error');
    return;
  }

  flat.render(result, { showLabels: showLabels, showSheet: showSheet });

  rig?.dispose();
  const skin = CARD_COLORS[params.stockId] ?? (CARD_COLORS.default as { color: string; edge: string });
  rig = buildRig(result.net, skin);
  rig.setProgress(progress);
  viewer.setFoldRig(rig.object, refit);

  renderResults(result);
  updateStatus(result, Math.round(performance.now() - started));
  syncVisibility();

  // A style with no folding panels — the divider is just slotted strips — has nothing
  // to show in the 3D view, so it would open on an empty stage. Send it to the
  // dieline, which is the only view that means anything for it.
  const foldable = result.net.panels.length > 0;
  modes.root.classList.toggle('hidden', !foldable);
  if (!foldable && mode !== 'flat') showMode('flat');
}

function setParam<K extends keyof BoxParams>(key: K, value: BoxParams[K], refit = false): void {
  params = { ...params, [key]: value };
  triggerRebuild(refit);
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel)
// ---------------------------------------------------------------------------
const styleCards = sourceCards<StyleId>({
  options: STYLES.map((s) => ({ value: s.id, label: s.name, icon: styleIcon(s.id) })),
  value: params.style,
  onChange: (id) => {
    params = { ...params, style: id };
    styleBlurb.textContent = styleMeta(id).blurb;
    // A different box is a different shape, so this is the one edit that is allowed
    // to move the camera.
    triggerRebuild(true);
  },
});
const styleBlurb = el('p', { className: 'fb-blurb', text: styleMeta(params.style).blurb });

/** Millimetres in, whatever the user reads out. Inches are not decoration here —
 *  Cricut's user base is American and thinks in fractions. */
function lenFormat(v: number): string {
  if (params.units === 'mm') return `${v} mm`;
  const inches = v / 25.4;
  const sixteenths = Math.round(inches * 16);
  const whole = Math.floor(sixteenths / 16);
  const frac = sixteenths % 16;
  if (!frac) return `${whole}"`;
  let num = frac;
  let den = 16;
  while (num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return `${whole ? `${whole} ` : ''}${num}/${den}"`;
}

const controls = {
  units: segmentedControl<'mm' | 'in'>({
    label: 'Units',
    options: [
      { value: 'mm', label: 'mm' },
      { value: 'in', label: 'inches' },
    ],
    value: params.units,
    onChange: (u) => {
      params = { ...params, units: u };
      syncControls();
    },
  }),
  basis: segmentedControl<'inside' | 'outside'>({
    label: 'Measurements are',
    options: [
      { value: 'inside', label: 'Inside' },
      { value: 'outside', label: 'Outside' },
    ],
    value: params.dimBasis,
    help: 'Inside is what has to fit your product — the blank is grown by the card thickness on every wall it wraps. Outside is the finished box. Two free generators disagree about this, which is why it says so on screen.',
    onChange: (b) => setParam('dimBasis', b),
  }),
  length: sliderRow({
    label: 'Length',
    min: 20,
    max: 260,
    step: 1,
    value: params.lengthMm,
    format: lenFormat,
    onInput: (v) => setParam('lengthMm', v),
  }),
  width: sliderRow({
    label: 'Width',
    min: 20,
    max: 260,
    step: 1,
    value: params.widthMm,
    format: lenFormat,
    onInput: (v) => setParam('widthMm', v),
  }),
  height: sliderRow({
    label: 'Height',
    min: 8,
    max: 200,
    step: 1,
    value: params.heightMm,
    format: lenFormat,
    onInput: (v) => setParam('heightMm', v),
  }),

  lidHeight: sliderRow({
    label: 'Lid depth',
    min: 6,
    max: 120,
    step: 1,
    value: params.lidHeightMm,
    format: lenFormat,
    help: 'How far the lid comes down over the tray. A third of the box height looks right; the whole height gives you a shoe box.',
    onInput: (v) => setParam('lidHeightMm', v),
  }),
  lidPlay: sliderRow({
    label: 'Lid fit',
    min: 0.1,
    max: 1.5,
    step: 0.05,
    value: params.lidPlayMm,
    format: (v) => `${v.toFixed(2)} mm${v < 0.3 ? ' — snug' : v > 0.8 ? ' — loose' : ''}`,
    help: 'Play per side, on TOP of the two card thicknesses the lid already has to clear. A percentage would be wrong at both ends: 7% of 30 mm is sloppy and 7% of 300 mm falls off.',
    onInput: (v) => setParam('lidPlayMm', v),
  }),
  tuckDepth: sliderRow({
    label: 'Tuck depth',
    min: 0,
    max: 40,
    step: 1,
    value: params.tuckDepthMm,
    format: (v) => (v === 0 ? 'auto' : lenFormat(v)),
    help: 'Auto sizes it against both the width and the height. A fixed depth — which is what the carton standards use — hangs off the end of a short box.',
    onInput: (v) => setParam('tuckDepthMm', v),
  }),
  tuckLock: selectField({
    label: 'Tuck lock',
    options: [
      { value: 'slit', label: 'Slit lock — nicks that catch' },
      { value: 'friction', label: 'Friction — plain squeeze' },
      { value: 'none', label: 'None' },
    ],
    value: params.tuckLock,
    help: 'A slit lock cuts two small nicks at the tuck shoulders that catch under the dust flaps. Without one a card box springs open on the shelf.',
    onChange: (v) => setParam('tuckLock', v as BoxParams['tuckLock']),
  }),
  glueTab: sliderRow({
    label: 'Glue lap',
    min: 6,
    max: 22,
    step: 1,
    value: params.glueTabMm,
    unit: 'mm',
    help: 'The only glued joint in most of these boxes. Tapered at both ends so it slides behind the far wall without catching.',
    onInput: (v) => setParam('glueTabMm', v),
  }),
  thumbNotch: toggleSwitch({
    label: 'Thumb notch',
    checked: params.thumbNotch,
    help: 'A half-circle bitten out of the tuck so a fingernail can get under it.',
    onChange: (v) => setParam('thumbNotch', v),
  }),
  handleHeight: sliderRow({
    label: 'Handle height',
    min: 20,
    max: 120,
    step: 1,
    value: params.handleHeightMm,
    format: lenFormat,
    help: 'How far the two handle blades rise above the ridge. The hand hole is placed well clear of the top edge — any nearer and it tears out the first time the box is carried.',
    onInput: (v) => setParam('handleHeightMm', v),
  }),

  window: toggleSwitch({
    label: 'Window',
    checked: params.window,
    help: 'An aperture in the front face. It is kept at least 15 mm clear of every fold and cut — closer than that and the panel loses its stiffness and creases where it should not.',
    onChange: (v) => setParam('window', v),
  }),
  windowScale: sliderRow({
    label: 'Window size',
    min: 0.2,
    max: 0.95,
    step: 0.01,
    value: params.windowScale,
    format: (v) => `${Math.round(v * 100)}% of the panel`,
    onInput: (v) => setParam('windowScale', v),
  }),
  windowRadius: sliderRow({
    label: 'Corner radius',
    min: 0,
    max: 24,
    step: 1,
    value: params.windowRadiusMm,
    unit: 'mm',
    onInput: (v) => setParam('windowRadiusMm', v),
  }),
  filmInsert: toggleSwitch({
    label: 'Cut a film insert too',
    checked: params.filmInsert,
    help: 'Adds a matching outline on its own layer, to cut from acetate or PET. Never cut PVC on a laser — it releases hydrogen chloride.',
    onChange: (v) => setParam('filmInsert', v),
  }),
  filmMargin: sliderRow({
    label: 'Film glue margin',
    min: 3,
    max: 12,
    step: 0.5,
    value: params.filmMarginMm,
    unit: 'mm',
    help: 'How far the film oversails the aperture. Under 3 mm the bond gaps.',
    onInput: (v) => setParam('filmMarginMm', v),
  }),

  dividerCols: sliderRow({
    label: 'Columns',
    min: 1,
    max: 8,
    step: 1,
    value: params.dividerCols || 2,
    onInput: (v) => setParam('dividerCols', v),
  }),
  dividerRows: sliderRow({
    label: 'Rows',
    min: 1,
    max: 8,
    step: 1,
    value: params.dividerRows || 2,
    onInput: (v) => setParam('dividerRows', v),
  }),
  hangHole: toggleSwitch({
    label: 'Euro hang slot',
    checked: params.hangHole,
    help: 'The standard ISO 15348 keyhole for a retail peg, kept clear of the edge so the card does not tear off it.',
    onChange: (v) => setParam('hangHole', v),
  }),
};

// ---------------------------------------------------------------------------
// 4. MATERIAL & MACHINE (right panel)
// ---------------------------------------------------------------------------
const stockField = selectField({
  label: 'Card stock',
  options: STOCKS.map((s) => ({ value: s.id, label: s.name })),
  value: params.stockId,
  help: 'A preset only seeds the thickness. Caliper is grammage times bulk, and the spread at a given gsm is about 50% — so measure the sheet you are actually going to cut.',
  onChange: (id) => {
    const s = stockById(id);
    params = { ...params, stockId: id, caliperMm: s.caliperMm };
    controls2.caliper.setValue(s.caliperMm);
    stockNote.textContent = s.note ?? '';
    triggerRebuild();
  },
});
const stockNote = el('p', { className: 'fb-note', text: stockById(params.stockId).note ?? '' });

const machineField = selectField({
  label: 'Machine',
  options: MACHINES.map((m) => ({ value: m.id, label: m.name })),
  value: params.machineId,
  onChange: (id) => {
    const m = machineById(id);
    // A machine preset is the whole recipe, not a label: it sets how a fold line is
    // made, what the kerf is, and which sheet is even possible.
    const sheet = SHEETS.find((s) => s.widthMm <= m.areaMm[0] && s.heightMm <= m.areaMm[1]);
    params = {
      ...params,
      machineId: id,
      foldMode: m.foldMode,
      kerfMm: m.kerfMm,
      sheetId: sheet?.id ?? params.sheetId,
    };
    controls2.foldMode.setValue(m.foldMode);
    controls2.kerf.setValue(m.kerfMm);
    sheetField.setValue?.(params.sheetId);
    machineNote.textContent = m.note;
    triggerRebuild();
  },
});
const machineNote = el('p', { className: 'fb-note', text: machineById(params.machineId).note });

const sheetField = selectField({
  label: 'Sheet',
  options: SHEETS.map((s) => ({ value: s.id, label: s.name })),
  value: params.sheetId,
  onChange: (id) => setParam('sheetId', id),
}) as HTMLElement & { setValue?(v: string): void };

const controls2 = {
  caliper: sliderRow({
    label: 'Measured caliper',
    min: 0.1,
    max: 2,
    step: 0.01,
    value: params.caliperMm,
    format: (v) => `${v.toFixed(2)} mm`,
    help: 'Measure ten sheets with calipers and divide by ten. Every panel, every tuck and every lid clearance in the file comes from this one number.',
    onInput: (v) => setParam('caliperMm', v),
  }),
  foldMode: segmentedControl<FoldMode>({
    label: 'Fold lines',
    options: [
      { value: 'score', label: 'Score' },
      { value: 'perf', label: 'Perforate' },
      { value: 'draw', label: 'Draw' },
      { value: 'none', label: 'None' },
    ],
    value: params.foldMode,
    help: 'No machine here can actually crease. A laser scores and browns the outside, a blade perforates, a pen draws a line you fold by hand. Pick the one your machine can do.',
    onChange: (m) => setParam('foldMode', m),
  }),
  kerf: sliderRow({
    label: 'Kerf',
    min: 0,
    max: 0.4,
    step: 0.01,
    value: params.kerfMm,
    format: (v) => (v === 0 ? 'none (blade)' : `${v.toFixed(2)} mm`),
    help: 'How much width the beam burns away; every cut is grown by half of it. A drag knife removes nothing, so leave it at zero on a blade cutter.',
    onInput: (v) => setParam('kerfMm', v),
  }),
  perfCut: sliderRow({
    label: 'Dash',
    min: 0.5,
    max: 20,
    step: 0.5,
    value: params.perfCutMm,
    unit: 'mm',
    onInput: (v) => setParam('perfCutMm', v),
  }),
  perfGap: sliderRow({
    label: 'Bridge',
    min: 0.5,
    max: 20,
    step: 0.5,
    value: params.perfGapMm,
    unit: 'mm',
    help: 'Equal dash and bridge is the only published figure that works on card. Longer bridges hold better and fold worse.',
    onInput: (v) => setParam('perfGapMm', v),
  }),
};

// ---------------------------------------------------------------------------
// 5. RESULTS
// ---------------------------------------------------------------------------
const readout = el('div', { className: 'fb-readout' });
const diagnostics = el('div', { className: 'fb-diagnostics' });

function stat(label: string, value: string, tone?: string): HTMLElement {
  return el('div', { className: `fb-stat${tone ? ` fb-stat--${tone}` : ''}` }, [
    el('span', { className: 'fb-stat__label', text: label }),
    el('span', { className: 'fb-stat__value', text: value }),
  ]);
}

function renderResults(r: SolveResult): void {
  const { L, W, H } = insideDims(r.params);
  const machine = machineById(r.params.machineId);
  const fits = !r.overflow;
  readout.replaceChildren(
    stat('Blank', `${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm`),
    stat(
      'Fits the sheet',
      fits ? (r.rotated ? 'yes, turned 90°' : 'yes') : 'no',
      fits ? 'ok' : 'bad',
    ),
    stat('Largest cube on this sheet', `${r.largestCubeMm} mm`),
    stat('Inside', `${L.toFixed(0)} × ${W.toFixed(0)} × ${H.toFixed(0)} mm`),
    stat('Panels · folds', `${r.net.panels.length} · ${r.net.creases.length}`),
    stat('Cut path', `${(r.net.lengthByOp.cut / 1000).toFixed(2)} m`),
    stat(
      'Fold line',
      `${((r.net.lengthByOp.crease + r.net.lengthByOp.perf) / 1000).toFixed(2)} m`,
    ),
    stat('Work area', `${machine.areaMm[0]} × ${machine.areaMm[1]} mm`),
  );

  diagnostics.replaceChildren(
    ...r.diagnostics.map((d) =>
      el('div', { className: `fb-diag fb-diag--${d.level}` }, [
        el('div', { className: 'fb-diag__msg', text: d.message }),
        ...(d.fix ? [el('div', { className: 'fb-diag__fix', text: d.fix })] : []),
      ]),
    ),
  );
}

function updateStatus(r: SolveResult, ms: number): void {
  const worst = r.diagnostics.find((d) => d.level === 'error');
  if (worst) {
    status.set(worst.message, 'error');
    return;
  }
  const warn = r.diagnostics.find((d) => d.level === 'warning');
  status.set(
    `${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm blank · ` +
      `${r.rotated ? 'fits turned 90°' : 'fits'} · largest cube here ${r.largestCubeMm} mm · ${ms} ms`,
    warn ? 'warn' : 'idle',
  );
}

// ---------------------------------------------------------------------------
// 6. STAGE — flat dieline, or the box folding itself
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');
const stageCanvas = el('div', { className: 'fb-stage-canvas' });
const flat = createFlatView();

let showLabels = true;
let showSheet = true;

const scrub = el('input', {
  className: 'fb-scrub',
  attrs: { type: 'range', min: '0', max: '1000', value: '1000', 'aria-label': 'Fold progress' },
}) as HTMLInputElement;

const playBtn = el('button', {
  className: 'vl-btn fb-play',
  attrs: { type: 'button' },
  text: 'Fold it',
  on: { click: () => (playing ? stop() : play()) },
}) as HTMLButtonElement;

const scrubReadout = el('span', { className: 'fb-scrub__value', text: 'closed' });

function setProgress(t: number, fromScrub = false): void {
  progress = Math.max(0, Math.min(1, t));
  rig?.setProgress(progress);
  if (!fromScrub) scrub.value = String(Math.round(progress * 1000));
  scrubReadout.textContent =
    progress <= 0.001 ? 'flat' : progress >= 0.999 ? 'closed' : `${Math.round(progress * 100)}%`;
}

scrub.addEventListener('input', () => {
  stop();
  setProgress(Number(scrub.value) / 1000, true);
});

let playRaf = 0;
let playStart = 0;
const PLAY_MS = 2600;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {
  matches: false,
};

function play(): void {
  // Someone who asked their system for less motion gets the finished box, not a
  // performance. The scrubber is still there if they want to watch it.
  if (reducedMotion.matches) {
    setProgress(1);
    return;
  }
  // requestAnimationFrame does not fire in a hidden tab, so a play started there
  // would leave the button reading "Pause" forever and the box stuck flat.
  if (document.hidden) {
    setProgress(1);
    return;
  }
  // Always from flat, because the point of the animation is the process. Replaying
  // from 98% would show nothing.
  playing = true;
  playBtn.textContent = 'Pause';
  playStart = performance.now() - (progress >= 0.999 ? 0 : progress * PLAY_MS);
  if (progress >= 0.999) setProgress(0);
  const step = () => {
    if (!playing) return;
    const t = (performance.now() - playStart) / PLAY_MS;
    setProgress(Math.min(1, t));
    if (t >= 1) {
      stop();
      return;
    }
    playRaf = requestAnimationFrame(step);
  };
  playRaf = requestAnimationFrame(step);
}

function stop(): void {
  playing = false;
  cancelAnimationFrame(playRaf);
  playBtn.textContent = 'Fold it';
}

// Switching away mid-fold freezes rAF. Without this the loop never resumes and the
// button sits on "Pause" for the rest of the session.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});

// The fold scrubber lives in the sidebar, NOT floating over the stage. The kit's
// bottom-centre panel is for the one small setting you nudge while watching the
// model — a stepper, a nudge pair. A persistent 380 px scrubber parked there sits
// squarely on top of the box you are trying to look at, which is the whole product.
// The laser generator puts its exploded-view slider in a sidebar "View" section for
// the same reason; this follows it.
const foldRow = el('div', { className: 'fb-scrub-row' }, [playBtn, scrub, scrubReadout]);

const dielineToggles = [
  el('div', { className: 'fb-legend' }, [
    legendChip('Cut', '#FF0000'),
    legendChip('Fold', '#0000FF'),
    legendChip('Film', '#00C0C0'),
  ]),
  toggleSwitch({
    label: 'Panel names',
    checked: showLabels,
    onChange: (v) => {
      showLabels = v;
      if (result) flat.render(result, { showLabels, showSheet });
    },
  }),
  toggleSwitch({
    label: 'Show the sheet',
    checked: showSheet,
    onChange: (v) => {
      showSheet = v;
      if (result) flat.render(result, { showLabels, showSheet });
    },
  }),
];

function legendChip(label: string, colour: string): HTMLElement {
  return el('span', { className: 'fb-legend__chip' }, [
    el('span', { className: 'fb-legend__swatch', attrs: { style: `background:${colour}` } }),
    el('span', { text: label }),
  ]);
}

const modes = modeBar<'flat' | 'fold'>({
  modes: [
    { value: 'fold', label: 'Fold' },
    { value: 'flat', label: 'Dieline' },
  ],
  value: 'fold',
  onChange: (m) => showMode(m),
});

function showMode(m: 'flat' | 'fold'): void {
  mode = m;
  const isFlat = m === 'flat';
  flat.root.classList.toggle('hidden', !isFlat);
  stageCanvas.classList.toggle('hidden', isFlat);
  // The orbit hint only means anything over the 3D stage.
  hint.classList.toggle('hidden', isFlat);
  foldRow.classList.toggle('hidden', isFlat);
  for (const node of dielineToggles) node.classList.toggle('hidden', !isFlat);
  if (isFlat) stop();
}

const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

/** Hide the controls a style does not use, rather than leaving dead sliders on
 *  screen. A sleeve has no tuck and a divider has no window. */
function syncVisibility(): void {
  const uses = styleMeta(params.style).uses;
  const show = (node: HTMLElement, on: boolean) => node.classList.toggle('hidden', !on);
  show(closureSection, !!(uses.lid || uses.tuck || uses.glue || uses.handle));
  show(controls.lidHeight, !!uses.lid);
  show(controls.lidPlay, !!uses.lid);
  show(controls.tuckDepth, !!uses.tuck);
  show(controls.tuckLock as HTMLElement, !!uses.tuck);
  show(controls.thumbNotch, !!uses.tuck);
  show(controls.glueTab, !!uses.glue);
  show(controls.handleHeight, !!uses.handle);
  show(windowSection, !!uses.window);
  show(controls.windowScale, params.window);
  show(controls.windowRadius, params.window);
  show(controls.filmInsert, params.window);
  show(controls.filmMargin, params.window && params.filmInsert);
  show(controls.dividerCols, !!uses.divider);
  show(controls.dividerRows, !!uses.divider);
  show(controls.hangHole, params.style === 'sleeve');
  show(extrasSection, !!uses.divider || params.style === 'sleeve');
  show(controls2.perfCut, params.foldMode === 'perf');
  show(controls2.perfGap, params.foldMode === 'perf');
}

// ---------------------------------------------------------------------------
// 7. CHROME
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html:
    'Measure your card before you cut. Every panel, tuck and lid clearance comes from the ' +
    'caliper you type, and "300 gsm" is anywhere from 0.30 to 0.46 mm.',
  storageKey: 'foldbox-quality-callout',
});

const footer = sidebarFooter({
  formats: [{ id: 'zip', label: 'Cut files' }],
  exportNote: 'SVG + DXF + assembly sheet, with a 100 mm scale check.',
  onExport: async (format) => {
    if (!result) return toast('Nothing to export yet', { kind: 'warn' });
    if (format !== 'zip') throw new Error('Unknown format: ' + format);
    if (result.diagnostics.some((d) => d.level === 'error')) {
      return toast('Fix the problems in Results first — this box would not fold.', {
        kind: 'error',
      });
    }
    const files = downloadCutFiles(result, {
      title: `${styleMeta(params.style).name} ${params.lengthMm}x${params.widthMm}x${params.heightMm}`,
      params,
      buildId: import.meta.env.VITE_BUILD_ID,
    });
    toast(`${files.baseName}.zip — SVG, DXF and an assembly sheet.`, { kind: 'ok' });
  },
  onSave: () => downloadJSON(`${params.style}-box.json`, params),
  onLoad: (file?: File) =>
    file &&
    loadJSON(file, (data) => {
      params = { ...DEFAULT_PARAMS, ...(data as Partial<BoxParams>) };
      syncControls();
      styleCards.setValue(params.style);
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }),
  onHelp: () =>
    dialog({
      title: 'Fold-up boxes',
      content:
        'Pick a style, set the size, then type the MEASURED thickness of your card — that one ' +
        'number sets every panel, every tuck and the lid fit. Watch it fold to check it before ' +
        'you cut.\n\n' +
        'Boxes eat a lot of paper. The status line always shows the largest cube your sheet can ' +
        'hold, and on a Cricut mat or an H2D that is around 70 mm — so this is a small-box tool.\n\n' +
        'None of these machines can crease, so fold lines come out as a laser score, a ' +
        'perforation, or a pen line you fold by hand. The machine preset picks the right one.\n\n' +
        'Every export carries a 100 mm rectangle. Measure it in your cutting software before you ' +
        'cut a real sheet — if it reads 133 mm your importer guessed the wrong DPI, and the DXF ' +
        'will fix it.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'foldbox-theme',
});

// ---------------------------------------------------------------------------
// 8. ASSEMBLE
// ---------------------------------------------------------------------------
const closureSection = collapsibleSection({
  title: '3 · Closure',
  body: [
    controls.lidHeight,
    controls.lidPlay,
    controls.tuckDepth,
    controls.tuckLock,
    controls.thumbNotch,
    controls.handleHeight,
    controls.glueTab,
  ],
});

const windowSection = collapsibleSection({
  title: '4 · Window',
  body: [
    controls.window,
    controls.windowScale,
    controls.windowRadius,
    controls.filmInsert,
    controls.filmMargin,
  ],
});

const extrasSection = collapsibleSection({
  title: '5 · Extras',
  body: [controls.dividerCols, controls.dividerRows, controls.hangHole],
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Fold-Up Box Generator',
        description:
          'Pick a box, set the size, get a cut-ready dieline — and watch it fold before you cut it.',
      }),
      ...(quality ? [quality] : []),
      section({ title: '1 · Box', body: [styleCards.root, styleBlurb] }),
      collapsibleSection({
        title: '2 · Size',
        body: [
          controls.units,
          controls.basis,
          controls.length,
          controls.width,
          controls.height,
        ],
      }),
      closureSection,
      windowSection,
      extrasSection,
      section({ title: 'View', body: [foldRow, ...dielineToggles] }),
    ],
  },
  stage: [
    stageCanvas,
    flat.root,
    modes.root,
    el('p', { className: 'vl-stage__label', text: 'Live preview' }),
    status.root,
    hint,
  ],
  right: {
    scroll: [
      section({ title: '6 · Card', body: [stockField, controls2.caliper, stockNote] }),
      section({
        title: '7 · Machine',
        body: [
          machineField,
          sheetField,
          controls2.foldMode,
          controls2.perfCut,
          controls2.perfGap,
          controls2.kerf,
          machineNote,
        ],
      }),
      section({ title: 'Results', body: [readout, diagnostics] }),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

const viewer = createViewer(stageCanvas, { frameMul: 1.9, framePad: 20 });
// A Bambu build plate under a paper box would be a lie about the process.
viewer.setPlate('grid');

showMode('fold');
// Open on the finished box: that is what the user came to make. The scrubber and
// the play button are right there to take it apart.
setProgress(1);

rebuild(true);

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__foldbox = {
    get result() {
      return result;
    },
    get params() {
      return params;
    },
    setProgress,
    viewer,
  };
}

function syncControls(): void {
  controls.units.setValue(params.units);
  controls.basis.setValue(params.dimBasis);
  controls.length.setValue(params.lengthMm);
  controls.width.setValue(params.widthMm);
  controls.height.setValue(params.heightMm);
  controls.lidHeight.setValue(params.lidHeightMm);
  controls.lidPlay.setValue(params.lidPlayMm);
  controls.tuckDepth.setValue(params.tuckDepthMm);
  controls.thumbNotch.setValue(params.thumbNotch);
  controls.glueTab.setValue(params.glueTabMm);
  controls.handleHeight.setValue(params.handleHeightMm);
  controls.window.setValue(params.window);
  controls.windowScale.setValue(params.windowScale);
  controls.windowRadius.setValue(params.windowRadiusMm);
  controls.filmInsert.setValue(params.filmInsert);
  controls.filmMargin.setValue(params.filmMarginMm);
  controls.dividerCols.setValue(params.dividerCols || 2);
  controls.dividerRows.setValue(params.dividerRows || 2);
  controls.hangHole.setValue(params.hangHole);
  controls2.caliper.setValue(params.caliperMm);
  controls2.foldMode.setValue(params.foldMode);
  controls2.kerf.setValue(params.kerfMm);
  controls2.perfCut.setValue(params.perfCutMm);
  controls2.perfGap.setValue(params.perfGapMm);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function downloadJSON(name: string, data: unknown): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadJSON(file: File, apply: (data: unknown) => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      apply(JSON.parse(reader.result as string));
    } catch {
      toast('Invalid project file', { kind: 'error' });
    }
  };
  reader.readAsText(file);
}

void mode;
