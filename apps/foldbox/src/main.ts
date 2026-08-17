import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  sidebarFooter,
  section,
  collapsibleSection,
  sourceCards,
  modeBar,
  stagePanel,
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
import { solve, fitToSheet, machineById, sheetById, stockById } from './geometry/solve';
import { STYLES, styleMeta, insideDims } from './geometry/styles';
import { buildRig, type FoldRig } from './fold/rig';
import { createFlatView, styleIcon } from './ui/flatView';
import { downloadCutFiles } from './export/cutFiles';
import {
  buildPrintable,
  downloadPrintable,
  hingeThicknessMm,
  sheetThicknessMm,
} from './export/printable';

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
  options: STYLES.map((s) => ({ value: s.id, label: s.short, icon: styleIcon(s.id) })),
  value: params.style,
  onChange: (id) => {
    params = { ...params, style: id };
    describeStyle(id);
    // A different box is a different shape, so this is the one edit that is allowed
    // to move the camera.
    triggerRebuild(true);
  },
});
const styleBadge = el('span', { className: 'fb-badge' });
const styleBlurb = el('p', { className: 'fb-blurb' });

/** "Does it need glue" is the only question most people arrive with, so it is a
 *  badge on the style rather than a sentence three lines into the blurb. */
function describeStyle(id: StyleId): void {
  const meta = styleMeta(id);
  styleBlurb.textContent = meta.blurb;
  styleBadge.textContent = meta.glueFree ? 'No glue' : 'One glued lap';
  styleBadge.className = `fb-badge fb-badge--${meta.glueFree ? 'ok' : 'warn'}`;
}
describeStyle(params.style);

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
    label: 'Your size is the',
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
  handle: toggleSwitch({
    label: 'Carry handle',
    checked: params.handle,
    help: 'On a tray this raises the two long walls into grips you can pick it up by. On the carry box it is the pair of straps that stand up through the side wings and lock the whole thing shut.',
    onChange: (v) => setParam('handle', v),
  }),
  handHoles: toggleSwitch({
    label: 'Hand holes in the ends',
    checked: params.handHoles,
    help: 'One hole through BOTH plies of each rolled end, at the same distance from the fold, so they line up into a single lined hole you can get a finger through.',
    onChange: (v) => setParam('handHoles', v),
  }),
  handleHeight: sliderRow({
    label: 'Handle height',
    min: 20,
    max: 120,
    step: 1,
    value: params.handleHeightMm,
    format: lenFormat,
    help: 'How far the handle rises above the rim. The hand hole is placed well clear of the top edge — any nearer and it tears out the first time the box is carried.',
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
    label: 'Hanging slot',
    checked: params.hangHole,
    help: 'The keyhole that hangs a package on a shop peg (ISO 15348), kept clear of the edge so the card does not tear off it.',
    onChange: (v) => setParam('hangHole', v),
  }),
};

// ---------------------------------------------------------------------------
// 4. MATERIAL & MACHINE (right panel)
// ---------------------------------------------------------------------------
const stockField = selectField({
  label: 'What card are you using?',
  options: STOCKS.map((s) => ({ value: s.id, label: s.name })),
  value: params.stockId,
  help: 'Picking one only fills in a starting thickness. Two packs both marked 300 gsm can differ by half again, so measure the sheet you are actually going to cut.',
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
    // made, what the beam width is, and which sheet of card is even possible.
    const sheet = SHEETS.find(
      (s) => s.kind === 'sheet' && s.widthMm <= m.areaMm[0] && s.heightMm <= m.areaMm[1],
    );
    params = {
      ...params,
      machineId: id,
      foldMode: m.foldMode,
      kerfMm: m.kerfMm,
      sheetId: sheet?.id ?? params.sheetId,
    };
    const fm = controls2.foldMode.querySelector('select');
    if (fm) fm.value = m.foldMode;
    controls2.kerf.setValue(m.kerfMm);
    const sel = sheetField.querySelector('select');
    if (sel) sel.value = params.sheetId;
    machineNote.textContent = m.note;
    triggerRebuild();
  },
});
const machineNote = el('p', { className: 'fb-note', text: machineById(params.machineId).note });

// Two selectors, not one with everything in it. A sheet of A4 and a 256 mm build
// plate answer the same question — "what am I laying this out on" — but only one of
// them is ever the right answer, and a dropdown that offers both is a dropdown that
// makes you work out which half applies to you.
const sheetOf = (kind: 'sheet' | 'plate', label: string) =>
  selectField({
    label,
    options: SHEETS.filter((s) => s.kind === kind).map((s) => ({ value: s.id, label: s.name })),
    value: SHEETS.find((s) => s.kind === kind && s.id === params.sheetId)?.id
      ?? (SHEETS.find((s) => s.kind === kind) as { id: string }).id,
    onChange: (id) => setParam('sheetId', id),
  });
const sheetField = sheetOf('sheet', 'Sheet of card');
const plateField = sheetOf('plate', 'Build plate');

/** The sheet the app should be on for a given mode, so switching modes never leaves
 *  a paper size selected for a printer or the other way round. */
function defaultSheetFor(kind: 'sheet' | 'plate'): string {
  const current = SHEETS.find((s) => s.id === params.sheetId);
  if (current?.kind === kind) return current.id;
  const picked = (kind === 'sheet' ? sheetField : plateField).querySelector('select');
  return picked?.value ?? (SHEETS.find((s) => s.kind === kind) as { id: string }).id;
}

const controls2 = {
  makeMode: segmentedControl<'cut' | 'print'>({
    label: 'How are you making it?',
    options: [
      { value: 'cut', label: 'Cut from card' },
      { value: 'print', label: '3D print it' },
    ],
    value: params.makeMode,
    help: 'Cutting gives you an SVG and a DXF for a laser, a blade cutter or a pair of scissors. Printing gives you a 3MF of the same net as a thin sheet — about as thick as card — with the fold lines already grooved into it.',
    onChange: (m) => {
      params = { ...params, makeMode: m, sheetId: defaultSheetFor(m === 'print' ? 'plate' : 'sheet') };
      triggerRebuild(true);
    },
  }),
  caliper: sliderRow({
    label: 'Card thickness',
    min: 0.1,
    max: 2,
    step: 0.01,
    value: params.caliperMm,
    format: (v) => `${v.toFixed(2)} mm`,
    help: 'The one number everything is built from — every tab, slot and lid clearance comes from it. The figure on the packet is not it: 300 gsm card is anywhere from 0.30 to 0.46 mm. Stack ten sheets, measure, divide by ten.',
    onInput: (v) => setParam('caliperMm', v),
  }),
  // A four-way segmented control in a 280 px column gives each option 70 px, and
  // the kit ellipsises what will not fit — so "Perforate" rendered as "Perfor…".
  // Four options with real names want a select, not tabs.
  foldMode: selectField({
    label: 'How to mark the folds',
    options: [
      { value: 'score', label: 'Laser score' },
      { value: 'perf', label: 'Perforate — a dashed cut' },
      { value: 'draw', label: 'Draw a pen line' },
      { value: 'none', label: 'Do not mark them' },
    ],
    value: params.foldMode,
    help: 'No machine here can actually crease. A laser scores and browns the outside, a blade perforates, a pen draws a line you fold by hand. Pick the one your machine can do.',
    onChange: (m) => setParam('foldMode', m as FoldMode),
  }) as HTMLElement & { setValue?(v: FoldMode): void },
  kerf: sliderRow({
    label: 'Beam width',
    min: 0,
    max: 0.4,
    step: 0.01,
    value: params.kerfMm,
    format: (v) => (v === 0 ? 'none — blade' : `${v.toFixed(2)} mm`),
    help: 'How much material the laser burns away. Every cut is grown by half of it so the finished part measures what it was drawn as. A blade removes nothing, so leave it at zero.',
    onInput: (v) => setParam('kerfMm', v),
  }),
  perfCut: sliderRow({
    label: 'Cut length',
    min: 0.5,
    max: 20,
    step: 0.5,
    value: params.perfCutMm,
    unit: 'mm',
    onInput: (v) => setParam('perfCutMm', v),
  }),
  perfGap: sliderRow({
    label: 'Gap between cuts',
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
// 4b. PRINT IT FLAT — the same net as a thin printed sheet you fold once
// ---------------------------------------------------------------------------
const printControls = {
  layerHeight: selectField({
    label: 'Layer height',
    options: [0.08, 0.1, 0.12, 0.15, 0.16, 0.2, 0.24, 0.28, 0.3].map((v) => ({
      value: String(v),
      label: `${v.toFixed(2)} mm`,
    })),
    value: String(params.layerHeightMm),
    onChange: (v) => setParam('layerHeightMm', Number(v)),
  }),
  sheetLayers: sliderRow({
    label: 'Sheet thickness',
    min: 1,
    max: 8,
    step: 1,
    value: params.sheetLayers,
    format: (v) => `${v} layer${v === 1 ? '' : 's'} · ${(v * params.layerHeightMm).toFixed(2)} mm`,
    help: 'Two layers of 0.2 is 0.40 mm, and 300 gsm card measures 0.38 — which is the whole idea. Thicker is stiffer and folds worse.',
    onInput: (v) => setParam('sheetLayers', v),
  }),
  hingeLayers: sliderRow({
    label: 'Hinge thickness',
    min: 1,
    max: 8,
    step: 1,
    value: params.hingeLayers,
    format: (v) =>
      v >= params.sheetLayers
        ? 'no groove — fold on the line'
        : `${v} layer${v === 1 ? '' : 's'} · ${(v * params.layerHeightMm).toFixed(2)} mm`,
    help: 'What is left under a fold line. One layer folds beautifully and is the reason a printed net folds at all; set it equal to the sheet and you get a plain slab with no fold marks on it.',
    onInput: (v) => setParam('hingeLayers', v),
  }),
  hingeWidth: sliderRow({
    label: 'Groove width',
    min: 0.4,
    max: 4,
    step: 0.1,
    value: params.hingeWidthMm,
    unit: 'mm',
    help: 'A 90 degree fold needs roughly pi × thickness ÷ 2 of band before the outer face has to stretch — about 0.6 mm on a 0.4 mm sheet. Wider folds easier and stands up less straight.',
    onInput: (v) => setParam('hingeWidthMm', v),
  }),
};

// No drift warning and no reconcile button any more: in print mode the thickness
// the box is built for IS layers times layer height, derived in `solve`, so the two
// cannot disagree. This just says what it worked out to.
const printNote = el('p', { className: 'fb-note' });

// ---------------------------------------------------------------------------
// 5. RESULTS
// ---------------------------------------------------------------------------
const readout = el('div', { className: 'fb-readout' });
const diagnostics = el('div', { className: 'fb-diagnostics' });

// Boxes eat far more paper than anyone predicts — a mailer's blank is L + 4H wide
// before it is anything else — so "does not fit" is the normal state, not the edge
// case. Telling someone to go smaller and leaving them to find the number by
// dragging three sliders is the unfriendly half of this tool.
const fitBtn = el('button', {
  className: 'vl-btn fb-fit',
  attrs: { type: 'button' },
  text: 'Resize to fit',
  on: {
    click: () => {
      const dims = fitToSheet(params);
      params = { ...params, ...dims };
      syncControls();
      triggerRebuild(true);
      toast(`Resized to ${dims.lengthMm} × ${dims.widthMm} × ${dims.heightMm} mm`, { kind: 'ok' });
    },
  },
}) as HTMLButtonElement;

function stat(label: string, value: string, tone?: string): HTMLElement {
  return el('div', { className: `fb-stat${tone ? ` fb-stat--${tone}` : ''}` }, [
    el('span', { className: 'fb-stat__label', text: label }),
    el('span', { className: 'fb-stat__value', text: value }),
  ]);
}

function renderResults(r: SolveResult): void {
  const { L, W, H } = insideDims(r.params);
  const fits = !r.overflow;
  fitBtn.textContent = fits ? 'Make it as big as it will go' : 'Resize to fit';

  // The printed sheet is only the right box if the geometry was built for its
  // thickness — caliper drives every tab, slot and clearance in the blank. Say so
  // when the two have drifted apart, rather than exporting a box sized for card.
  const printT = sheetThicknessMm(r.params);
  printNote.textContent =
    `${printT.toFixed(2)} mm sheet, ${hingeThicknessMm(r.params).toFixed(2)} mm under each fold. ` +
    `The box is built for exactly that, so it needs no card settings at all.`;
  // Five rows, not eight. "Largest cube on this sheet" answered a question the
  // Resize button now answers by doing it, and "Work area" restated the machine you
  // just picked — between them a third of the panel, spent on nothing you act on.
  const cutting = r.params.makeMode === 'cut';
  readout.replaceChildren(
    stat('Blank', `${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm`),
    stat(
      fits ? 'Fits' : 'Does not fit',
      fits
        ? r.rotated
          ? 'yes, turned 90°'
          : 'yes'
        : `needs ${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)}`,
      fits ? 'ok' : 'bad',
    ),
    stat('Inside', `${L.toFixed(0)} × ${W.toFixed(0)} × ${H.toFixed(0)} mm`),
    stat('Panels · folds', `${r.net.panels.length} · ${r.net.creases.length}`),
    cutting
      ? stat(
          'Cut · fold line',
          `${(r.net.lengthByOp.cut / 1000).toFixed(2)} · ` +
            `${((r.net.lengthByOp.crease + r.net.lengthByOp.perf) / 1000).toFixed(2)} m`,
        )
      : stat('Sheet', `${sheetThicknessMm(r.params).toFixed(2)} mm, ${r.params.sheetLayers} layers`),
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
      `${r.rotated ? 'fits turned 90°' : 'fits'} ${sheetById(r.params.sheetId).name.replace(/\s*\(.*\)$/, '')}`,
    warn ? 'warn' : 'idle',
  );
  void ms;
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

// The fold control belongs ON THE STAGE, in the kit's bottom-centre slot, next to
// the thing it moves.
//
// It used to live at the bottom of the left sidebar, under five other sections, on
// the reasoning that a 380 px scrubber parked over the stage covers the box. That
// reasoning was wrong twice: it costs a scroll to the end of the panel to press the
// one button the whole app is built around, and nobody looks in a settings column
// for a playback control. The kit's own slot map has said so all along — bottom
// centre is "whatever the current mode is editing" — so this is a compact row in
// that slot, and the viewer already frames the model with padding above it.
const foldRow = el('div', { className: 'fb-scrub-row' }, [playBtn, scrub, scrubReadout]);

const dielineLegend = el('div', { className: 'fb-legend' }, [
  legendChip('Cut', '#FF0000'),
  legendChip('Fold', '#0000FF'),
  legendChip('Film', '#00C0C0'),
]);
const dielineToggles = el('div', { className: 'fb-dieline-body' }, [
  dielineLegend,
  toggleSwitch({
    label: 'Panel names',
    checked: showLabels,
    onChange: (v) => {
      showLabels = v;
      if (result) flat.render(result, { showLabels, showSheet });
    },
  }),
  toggleSwitch({
    label: 'Sheet outline',
    checked: showSheet,
    onChange: (v) => {
      showSheet = v;
      if (result) flat.render(result, { showLabels, showSheet });
    },
  }),
]);

// One panel, two faces: the fold scrubber while you are watching it fold, the
// dieline's own switches while you are looking at the flat file. Never both — the
// kit's slot map allows exactly one thing down there.
const foldPanel = stagePanel({
  title: 'Fold',
  body: [foldRow],
  open: true,
});
// A title reading "Fold" over a button reading "Fold it", plus a line explaining
// that a slider is draggable, made the panel 147 px — a fifth of the stage, sitting
// on the box. The heading stays in the DOM for screen readers and comes off the
// screen; the control labels itself.
foldPanel.root.classList.add('fb-panel--bare');
const dielinePanel = stagePanel({
  title: 'Dieline',
  body: [dielineToggles],
  open: false,
});

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
  foldPanel.setOpen(!isFlat);
  dielinePanel.setOpen(isFlat);
  if (isFlat) stop();
}

/** Hide the controls a style does not use, rather than leaving dead sliders on
 *  screen. A sleeve has no tuck and a divider has no window. */
function syncVisibility(): void {
  const uses = styleMeta(params.style).uses;
  const show = (node: HTMLElement, on: boolean) => node.classList.toggle('hidden', !on);
  const anyHandle = !!uses.handle;

  show(controls.handle, anyHandle);
  show(controls.handHoles, !!uses.handHoles);
  // The handle slider only means anything once there IS a handle. A tray's grip and
  // a carry box's strap are both driven by it; the mailer's hand holes are sized off
  // the box instead, so it stays hidden there.
  show(controls.handleHeight, anyHandle && params.handle);
  show(controls.lidHeight, !!uses.lid);
  show(controls.lidPlay, !!uses.lid);
  show(controls.tuckDepth, !!uses.tuck);
  show(controls.tuckLock as HTMLElement, !!uses.tuck);
  show(controls.thumbNotch, !!uses.tuck);
  show(controls.glueTab, !!uses.glue);
  show(controls.window, !!uses.window);
  show(controls.windowScale, !!uses.window && params.window);
  show(controls.windowRadius, !!uses.window && params.window);
  show(controls.filmInsert, !!uses.window && params.window);
  show(controls.filmMargin, !!uses.window && params.window && params.filmInsert);
  show(controls.dividerCols, !!uses.divider);
  show(controls.dividerRows, !!uses.divider);
  show(controls.hangHole, params.style === 'sleeve');
  // A section with every row hidden is an empty box with a heading on it.
  show(
    optionsSection,
    anyHandle || !!uses.lid || !!uses.divider || !!uses.window || !!uses.handHoles,
  );
  show(controls2.perfCut, params.foldMode === 'perf');
  show(controls2.perfGap, params.foldMode === 'perf');

  // The whole right column follows the one decision at the top of it.
  const printing = params.makeMode === 'print';
  show(cutSection, !printing);
  show(cutAdvancedSection, !printing);
  show(printSection, printing);
  for (const [id, btn] of exportButtons) {
    show(btn, id === 'zip' ? !printing : printing);
  }
}

// ---------------------------------------------------------------------------
// 7. CHROME
// ---------------------------------------------------------------------------
// No standing callout. It said "measure your card", which is now the help tip on the
// one field it applies to — and it was flatly wrong in print mode, where there is no
// card. A banner every visitor dismisses is 139 px of the panel that the style picker
// needed more.

const footer = sidebarFooter({
  formats: [
    { id: 'zip', label: 'Cut files' },
    { id: '3mf', label: 'Printable 3MF' },
    { id: 'stl', label: 'Printable STL' },
  ],
  exportNote: 'Every file carries a 100 mm rectangle — measure it before you cut a real sheet.',
  onExport: async (format) => {
    if (!result) return toast('Nothing to export yet', { kind: 'warn' });
    if (result.diagnostics.some((d) => d.level === 'error')) {
      return toast('Fix the problems in Results first — this box would not fold.', {
        kind: 'error',
      });
    }
    const name = `${styleMeta(params.style).name} ${params.lengthMm}x${params.widthMm}x${params.heightMm}`;

    if (format === '3mf' || format === 'stl') {
      const baseName = `${params.style}-${params.lengthMm}x${params.widthMm}x${params.heightMm}-printable`;
      const stats = downloadPrintable(
        result.net,
        params,
        { title: name, baseName, buildId: import.meta.env.VITE_BUILD_ID },
        format,
      );
      const mountains = stats.mountains
        ? ` ${stats.mountains} fold${stats.mountains === 1 ? '' : 's'} go the other way — press those from the underside.`
        : '';
      toast(
        `${baseName}.${format} — ${stats.sheetMm.toFixed(2)} mm sheet, ${stats.hingeMm.toFixed(2)} mm hinges.${mountains}`,
        { kind: 'ok' },
      );
      return;
    }

    if (format !== 'zip') throw new Error('Unknown format: ' + format);
    const files = downloadCutFiles(result, {
      title: name,
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
      describeStyle(params.style);
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }),
  onHelp: () =>
    dialog({
      title: 'Fold-up boxes',
      content:
        'Pick a box, set the size, then say how you are making it — cut from card, or printed ' +
        'flat on a 3D printer. Press play under the model to watch it fold before you commit.\n\n' +
        'The first five styles need no glue at all. The mailer and the carry box are transcribed ' +
        'from production dielines: the mailer locks itself by rolling each end down over the ' +
        'corner ears and pushing two tabs through the floor, and the carry box locks by standing ' +
        'its two handle straps up through slots in the side wings. Neither has a glue lap.\n\n' +
        'CUTTING IT. The one number that matters is how thick your card actually is: every tab, ' +
        'slot and lid clearance is built from it. The number on the packet is not it — 300 gsm ' +
        'runs anywhere from 0.30 to 0.46 mm. Stack ten sheets, measure, divide by ten.\n\n' +
        'PRINTING IT. The thickness is worked out for you: layers times layer height. Two layers ' +
        'of 0.2 mm is 0.40 mm, which is exactly what 300 gsm card measures — so it folds like ' +
        'card. Fold lines come out as grooves down to one layer.\n\n' +
        'Boxes eat a lot of paper — far more than anyone expects. If the blank does not fit, ' +
        'press "Resize to fit" rather than hunting for the number by hand. On A4 or a Cricut mat ' +
        'this is a small-box tool.\n\n' +
        'No cutter can crease, so fold lines come out as a laser score, a perforation, or a pen ' +
        'line you fold by hand. The machine preset picks the right one.\n\n' +
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
// Three sections, not six. The old layout put twenty-five controls in front of
// someone who wanted a box: a "closure" section that meant nothing until you knew
// which style you had picked, a window section open by default on a style with no
// window, and the two numbers that actually matter — the card thickness and the
// sheet — on the far side of the screen. What is left on top is the handful a style
// genuinely uses; everything that has a defensible default is one click down.
const optionsSection = section({
  title: '3 · Options',
  body: [
    controls.handle,
    controls.handHoles,
    controls.handleHeight,
    controls.lidHeight,
    controls.dividerCols,
    controls.dividerRows,
    controls.window,
    controls.windowScale,
  ],
});

const advancedSection = collapsibleSection({
  title: 'Fine tuning',
  open: false,
  body: [
    controls.basis,
    controls.lidPlay,
    controls.tuckDepth,
    controls.tuckLock,
    controls.thumbNotch,
    controls.glueTab,
    controls.hangHole,
    controls.windowRadius,
    controls.filmInsert,
    controls.filmMargin,
  ],
});

const cutSection = section({
  title: 'Card and machine',
  body: [stockField, controls2.caliper, stockNote, machineField, sheetField],
});

const cutAdvancedSection = collapsibleSection({
  title: 'Cutting detail',
  open: false,
  body: [controls2.foldMode, controls2.perfCut, controls2.perfGap, controls2.kerf, machineNote],
});

// Phase 2. Collapsed, because it is a second way to make the same box rather than a
// step in making it — but its own section rather than buried in "fine tuning",
// because the thickness it produces has to agree with the caliper the blank was
// built for, and that is worth a sentence on screen.
const printSection = section({
  title: 'Sheet and printer',
  body: [
    plateField,
    printControls.layerHeight,
    printControls.sheetLayers,
    printControls.hingeLayers,
    printControls.hingeWidth,
    printNote,
  ],
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Fold-Up Box Generator',
        description: 'Glue-free boxes from real dielines. Cut them from card, or print them flat.',
      }),
      section({
        title: '1 · Box',
        body: [styleCards.root, el('div', { className: 'fb-style-meta' }, [styleBadge, styleBlurb])],
      }),
      section({
        title: '2 · Size',
        body: [controls.units, controls.length, controls.width, controls.height],
      }),
      optionsSection,
      advancedSection,
    ],
  },
  stage: [
    stageCanvas,
    flat.root,
    modes.root,
    el('p', { className: 'vl-stage__label', text: 'Live preview' }),
    status.root,
    foldPanel.root,
    dielinePanel.root,
  ],
  right: {
    scroll: [
      // One decision at the top, and everything under it follows from it. Cutting
      // and printing want different materials, different sheets and different
      // files, and the panel only made sense once it stopped offering both at once.
      section({ title: 'Making it', body: [controls2.makeMode] }),
      cutSection,
      cutAdvancedSection,
      printSection,
      section({ title: 'Does it fit?', body: [readout, fitBtn, diagnostics] }),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// `exportPanel` renders one button per format, in the order they were declared, and
// has no API for showing a subset. Pairing them back up by that order lets the
// download row follow the make-mode switch instead of offering a 3MF next to a
// laser-cutter setting — which is the same "both halves at once" problem the sheet
// dropdown had.
const EXPORT_ORDER = ['zip', '3mf', 'stl'] as const;
const exportButtons: [string, HTMLElement][] = [
  ...shell.root.querySelectorAll<HTMLElement>('.vl-export__buttons button'),
].map((btn, i) => [EXPORT_ORDER[i] ?? '', btn]);

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
    /** The printable solid, without writing a file — so the mesh can be inspected
     *  from the console and from a browser check without triggering a download. */
    printable: () => (result ? buildPrintable(result.net, params) : null),
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
  controls.handle.setValue(params.handle);
  controls.handHoles.setValue(params.handHoles);
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
  const fmSel = controls2.foldMode.querySelector('select');
  if (fmSel) fmSel.value = params.foldMode;
  controls2.kerf.setValue(params.kerfMm);
  controls2.perfCut.setValue(params.perfCutMm);
  controls2.perfGap.setValue(params.perfGapMm);
  controls2.makeMode.setValue(params.makeMode);
  for (const f of [sheetField, plateField]) {
    const sel = f.querySelector('select');
    if (sel && [...sel.options].some((o) => o.value === params.sheetId)) sel.value = params.sheetId;
  }
  printControls.sheetLayers.setValue(params.sheetLayers);
  printControls.hingeLayers.setValue(params.hingeLayers);
  printControls.hingeWidth.setValue(params.hingeWidthMm);
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
