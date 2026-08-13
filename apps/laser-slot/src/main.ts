import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  section,
  collapsibleSection,
  dropZone,
  sampleGrid,
  modeBar,
  stageStatus,
  sliderRow,
  toggleSwitch,
  selectField,
  toast,
  dialog,
  el,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { loadFileToImage, type RgbaImage } from './image/decode';
import { traceSilhouette, DEFAULT_SILHOUETTE, type SilhouetteParams } from './image/silhouette';
import { createShapeEditor } from './ui/shapeEditor';
import { SAMPLES } from './samples.generated';
import { sampleThumb } from './sampleThumb';
import { downloadCutFiles } from './export/laserExport';
import {
  DEFAULT_PARAMS,
  MATERIALS,
  SHEETS,
  type GeometryRequest,
  type GeometryResponse,
  type Ring,
  type SlotParams,
  type SolveResult,
} from './types';

/*
  Slot-together laser cut generator.

  Two copies of one silhouette cross at right angles on a shared vertical axis,
  each giving up half the material where they meet, and a disc with a `+` slot
  holds their feet. Everything is cut flat; nothing is glued.

  Layout is the house three-column shell (see apps/generator-template/README.md):
    LEFT    what you are making      — shape, size
    STAGE   the assembled preview    — label, status, nav hint
    RIGHT   what goes in and out     — material, sheet, results, export footer
*/

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------
let params: SlotParams = { ...DEFAULT_PARAMS };
let outline: Ring[] = SAMPLES[0].rings;
let designName = SAMPLES[0].name;
let result: SolveResult | null = null;

/** The uploaded image, kept decoded so re-thresholding is instant. Null when the
 *  current shape came from a baked sample. */
let sourceImage: RgbaImage | null = null;
let sourceCanvas: HTMLCanvasElement | null = null;
let imageParams: SilhouetteParams = { ...DEFAULT_SILHOUETTE };
let dropped: Ring[] = [];
let sourceTransform: { scale: number; cx: number; cy: number } | null = null;

// ---------------------------------------------------------------------------
// 2. REBUILD — all CSG runs in the worker; the main thread never blocks.
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), {
  type: 'module',
});

let workerReady = false;
let refitNext = true;
let rebuildQueued = 0;
let startedAt = 0;

function triggerRebuild(refit = false): void {
  refitNext = refitNext || refit;
  if (!workerReady) return;
  clearTimeout(rebuildQueued);
  // setTimeout, not requestAnimationFrame: rAF is frozen in a background tab,
  // which would leave a model that never builds.
  rebuildQueued = setTimeout(() => {
    startedAt = performance.now();
    worker.postMessage({ type: 'build', outline, params } as GeometryRequest);
  }, 130);
}

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    workerReady = true;
    triggerRebuild(true);
    return;
  }
  if (msg.type === 'error') {
    status.set(`Could not build the model: ${msg.message}`, 'error');
    return;
  }
  result = msg.result;
  viewer.setParts(
    result.preview.map((p) => ({
      name: p.label,
      positions: p.positions,
      indices: p.indices,
      color: p.color,
    })),
    refitNext,
  );
  refitNext = false;
  applyExplode();
  // While the solver is choosing, the slider mirrors its choice — so the
  // control always reads as the truth rather than a stale 50%.
  if (params.axisFrac === null) controls.axis.setValue(result.axisFrac * 100);
  syncEditor();
  renderResult(result);
  const worst = result.diagnostics.find((d) => d.level === 'error');
  status.set(
    worst
      ? worst.message
      : `${result.assembledHeightMm.toFixed(0)} mm tall · ${result.parts.length} parts · ` +
          `${(result.cutLengthMm / 1000).toFixed(2)} m of cut · ${Math.round(performance.now() - startedAt)} ms`,
    worst ? 'error' : 'idle',
  );
};

worker.onerror = (e) => status.set(`Geometry worker failed: ${e.message}`, 'error');

/** Re-run the trace with the current image settings. Cheap enough at working
 *  resolution to sit directly on a slider's input event. */
function retrace(refit = false): void {
  if (!sourceImage) return;
  const out = traceSilhouette(sourceImage, imageParams);
  if (!out.rings.length) {
    status.set('Nothing left at this threshold — try moving it, or invert.', 'error');
    return;
  }
  outline = out.rings;
  dropped = out.dropped;
  sourceTransform = out.transform;
  syncEditor();
  triggerRebuild(refit);
}

/** Push the current shape and joint into the 2D editor. */
function syncEditor(): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of outline) for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const unitHeight = maxY - minY || 1;
  const t = params.thicknessMm;
  editor.setState({
    rings: outline,
    dropped,
    source: sourceCanvas,
    transform: sourceTransform,
    axisFrac: result?.axisFrac ?? params.axisFrac ?? 0.5,
    jointFrac: params.jointFrac,
    // The rings are normalised; the solver scales them so the bbox height is
    // heightMm. That ratio is what turns the web rule into something drawable.
    mmPerUnit: params.heightMm / unitHeight,
    needMm: t + params.clearanceMm + 3 * t,
    slotMm: t + params.clearanceMm - params.kerfMm,
  });
}

function setParam<K extends keyof SlotParams>(key: K, value: SlotParams[K]): void {
  params = { ...params, [key]: value };
  triggerRebuild();
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel)
// ---------------------------------------------------------------------------
/** Clear the active ring on every sample tile — an uploaded image is not one
 *  of them, so nothing should stay highlighted. */
function clearSampleSelection(): void {
  for (const b of samples.querySelectorAll('.vl-sample')) b.classList.remove('is-active');
}

const samples = sampleGrid({
  items: SAMPLES.map((s) => ({ id: s.id, label: s.name, src: sampleThumb(s.rings) })),
  onPick: (item, i) => {
    const picked = SAMPLES[i];
    outline = picked.rings;
    dropped = [];
    sourceImage = null;
    sourceCanvas = null;
    sourceTransform = null;
    imageSection.classList.add('hidden');
    designName = picked.name;
    clearSampleSelection();
    samples.querySelectorAll('.vl-sample')[i]?.classList.add('is-active');
    triggerRebuild(true);
  },
});

const drop = dropZone({
  title: 'Drop an image',
  text: 'or click to browse',
  note: 'PNG, JPG or SVG — one bold, connected silhouette works best',
  accept: 'image/*',
  onFiles: async ([file]) => {
    if (!file) return;
    try {
      status.set('Tracing…');
      const img = await loadFileToImage(file);
      sourceImage = img;
      // Keep a drawable copy so the editor can lay the original under the
      // outline without re-decoding on every redraw.
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      // Copy through a fresh ImageData: the decoder's buffer may be backed by
      // a SharedArrayBuffer, which ImageData will not take.
      const id = c.getContext('2d')!.createImageData(img.width, img.height);
      id.data.set(img.data);
      c.getContext('2d')!.putImageData(id, 0, 0);
      sourceCanvas = c;
      imageParams = { ...DEFAULT_SILHOUETTE };
      syncImageControls();
      imageSection.classList.remove('hidden');
      designName = file.name.replace(/\.[^.]+$/, '') || 'Design';
      clearSampleSelection();
      modes.setValue?.('shape');
      showMode('shape');
      retrace(true);
    } catch (err) {
      status.set((err as Error).message || 'Could not read that image.', 'error');
    }
  },
});

const controls = {
  height: sliderRow({
    label: 'Height',
    min: 40,
    max: 400,
    step: 5,
    value: params.heightMm,
    unit: 'mm',
    help: 'Overall height of the assembled object. Taller carries a joint more easily: a slot needs its own width plus 1.5x the material thickness either side, so 3 mm stock eats 12 mm of trunk.',
    onInput: (v: number) => setParam('heightMm', v),
  }),
  base: toggleSwitch({
    label: 'Base disc',
    checked: params.base,
    help: 'A disc with a + slot that both profiles tab through. Without it they stand on their own four feet, but tip easily.',
    onChange: (v: boolean) => setParam('base', v),
  }),
  baseDia: sliderRow({
    label: 'Base diameter',
    min: 0,
    max: 300,
    step: 5,
    value: params.baseDiaMm,
    format: (v: number) => (v === 0 ? 'auto' : `${v} mm`),
    help: 'Auto sizes the disc so the assembled centre of mass sits inside a 20 degree tip cone.',
    onInput: (v: number) => setParam('baseDiaMm', v),
  }),
  thickness: sliderRow({
    label: 'Measured thickness',
    min: 1,
    max: 8,
    step: 0.05,
    value: params.thicknessMm,
    unit: 'mm',
    help: 'Measure it with calipers. "3 mm" cast acrylic is legally anything from 2.3 to 3.7 mm and extruded 3 mm never reaches 3.00 — this number sets every slot in the file.',
    onInput: (v: number) => setParam('thicknessMm', v),
  }),
  kerf: sliderRow({
    label: 'Kerf',
    min: 0,
    max: 0.6,
    step: 0.01,
    value: params.kerfMm,
    unit: 'mm',
    help: 'How much width the beam burns away. Every path is offset by half of it. If your laser software also applies a cut offset, set that to zero or the compensation lands twice.',
    onInput: (v: number) => setParam('kerfMm', v),
  }),
  clearance: sliderRow({
    label: 'Fit clearance',
    min: -0.1,
    max: 0.3,
    step: 0.01,
    value: params.clearanceMm,
    unit: 'mm',
    help: 'Positive is a slip fit. Keep it positive on acrylic: an interference fit plus the stress a laser leaves in the edge is how a joint crazes weeks after assembly.',
    onInput: (v: number) => setParam('clearanceMm', v),
  }),
  gap: sliderRow({
    label: 'Part spacing',
    min: 1,
    max: 10,
    step: 0.5,
    value: params.partGapMm,
    unit: 'mm',
    help: 'Parts never share an edge — a shared line gets cut twice, which burns. On acrylic this doubles as thermal spacing, since a dense layout re-heats its neighbours.',
    onInput: (v: number) => setParam('partGapMm', v),
  }),
  relief: toggleSwitch({
    label: 'Relieve slot corners',
    checked: params.filletSlotEnds,
    help: 'A square internal corner is where acrylic starts a crack. Small round reliefs in the two corners of each slot cost nothing and keep the joint seating flush.',
    onChange: (v: boolean) => setParam('filletSlotEnds', v),
  }),
  autoAxis: toggleSwitch({
    label: 'Place the joint automatically',
    checked: params.axisFrac === null,
    help: 'On, the solver looks for the strongest vertical line that reaches the base. Turn it off to put the crossing line exactly where you want it — which is what you need on a symmetric shape, where "strongest" and "where it should obviously go" are not the same answer.',
    onChange: (on: boolean) => {
      // Hand the user the line the solver last chose, so switching to manual
      // starts from what they are already looking at instead of jumping.
      setParam('axisFrac', on ? null : (result?.axisFrac ?? 0.5));
      controls.axis.classList.toggle('hidden', on);
    },
  }),
  axis: sliderRow({
    label: 'Crossing line',
    min: 0,
    max: 100,
    step: 0.5,
    value: 50,
    format: (v: number) => `${v.toFixed(1)}% across`,
    help: 'Where the two profiles cross, measured across the silhouette. 50% is dead centre.',
    onInput: (v: number) => setParam('axisFrac', v / 100),
  }),
  joint: sliderRow({
    label: 'Joint height',
    min: 20,
    max: 80,
    step: 1,
    value: params.jointFrac * 100,
    format: (v: number) => `${v}% up the spine`,
    help: 'How far up the shared run the two slots meet. 50% is a true half-lap; lower puts the joint nearer the feet, which reads better on a shape that is widest at the bottom.',
    onInput: (v: number) => setParam('jointFrac', v / 100),
  }),
  tab: sliderRow({
    label: 'Tab width',
    min: 0,
    max: 80,
    step: 1,
    value: params.tabWidthMm,
    format: (v: number) => (v === 0 ? 'auto' : `${v} mm`),
    help: 'The tabs that pass through the base. Auto takes it from how wide the silhouette is at the ground, which is almost nothing on a shape that ends in a point — set it by hand there or the base barely holds.',
    onInput: (v: number) => setParam('tabWidthMm', v),
  }),
  explode: sliderRow({
    label: 'Exploded view',
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    format: (v: number) => (v === 0 ? 'assembled' : `${v}%`),
    help: 'Slides the parts apart along the directions they actually assemble in.',
    onInput: (v: number) => {
      explode = v / 100;
      applyExplode();
    },
  }),
};

// --- Image: how the picture becomes a silhouette -----------------------------
// Only meaningful when a picture is loaded; the baked samples are already
// outlines. The section hides itself rather than showing dead controls.

const imageControls = {
  threshold: sliderRow({
    label: 'Threshold',
    min: 0.05,
    max: 0.95,
    step: 0.01,
    value: imageParams.threshold,
    format: (v: number) => `${Math.round(v * 100)}%`,
    help: 'Where the cut between subject and background falls. Drag it and watch the outline in the Shape view — this is the control that fixes a bad trace.',
    onInput: (v: number) => { imageParams = { ...imageParams, threshold: v }; retrace(); },
  }),
  invert: toggleSwitch({
    label: 'Subject is lighter',
    checked: imageParams.invert,
    help: 'Flip it when your shape is pale on a dark background. Images with real transparency ignore both this and the threshold — the alpha channel has already answered.',
    onChange: (v: boolean) => { imageParams = { ...imageParams, invert: v }; retrace(); },
  }),
  dropEdge: toggleSwitch({
    label: 'Ignore the background',
    checked: imageParams.dropEdgeBlobs,
    help: 'Discards anything touching the edge of the picture. Turn it off if your subject runs off the frame.',
    onChange: (v: boolean) => { imageParams = { ...imageParams, dropEdgeBlobs: v }; retrace(); },
  }),
  cleanup: sliderRow({
    label: 'Clean up',
    min: 0,
    max: 8,
    step: 1,
    value: imageParams.cleanup,
    format: (v: number) => (v === 0 ? 'off' : `${v} px`),
    help: 'Seals pinholes and the speckle a JPEG leaves along an edge. Too much rounds off real detail.',
    onInput: (v: number) => { imageParams = { ...imageParams, cleanup: v }; retrace(); },
  }),
  smoothing: sliderRow({
    label: 'Smoothing',
    min: 0,
    max: 1,
    step: 0.05,
    value: imageParams.smoothing,
    format: (v: number) => `${Math.round(v * 100)}%`,
    help: 'Softens the traced edge. A jagged outline makes a laser stutter; an over-smoothed one loses the shape.',
    onInput: (v: number) => { imageParams = { ...imageParams, smoothing: v }; retrace(); },
  }),
  despeckle: sliderRow({
    label: 'Drop small pieces',
    min: 0,
    max: 0.25,
    step: 0.005,
    value: imageParams.despeckle,
    format: (v: number) => (v === 0 ? 'keep all' : `under ${(v * 100).toFixed(1)}%`),
    help: 'Islands smaller than this share of the biggest are discarded. Whatever goes is drawn in red in the Shape view, so you can tell a speck from a limb.',
    onInput: (v: number) => { imageParams = { ...imageParams, despeckle: v }; retrace(); },
  }),
  fillHoles: toggleSwitch({
    label: 'Fill holes',
    checked: imageParams.fillHoles,
    help: 'Cut the shape solid, ignoring any enclosed gaps.',
    onChange: (v: boolean) => { imageParams = { ...imageParams, fillHoles: v }; retrace(); },
  }),
};

function syncImageControls(): void {
  imageControls.threshold.setValue(imageParams.threshold);
  imageControls.invert.setValue(imageParams.invert);
  imageControls.dropEdge.setValue(imageParams.dropEdgeBlobs);
  imageControls.cleanup.setValue(imageParams.cleanup);
  imageControls.smoothing.setValue(imageParams.smoothing);
  imageControls.despeckle.setValue(imageParams.despeckle);
  imageControls.fillHoles.setValue(imageParams.fillHoles);
}

const imageSection = section({
  title: '2 · Image',
  body: [
    imageControls.threshold,
    imageControls.invert,
    imageControls.dropEdge,
    imageControls.cleanup,
    imageControls.smoothing,
    imageControls.despeckle,
    imageControls.fillHoles,
  ],
});
imageSection.classList.add('hidden');

// ---------------------------------------------------------------------------
// 4. MATERIAL & SHEET (right panel)
// ---------------------------------------------------------------------------
const materialField = selectField({
  label: 'Material',
  options: MATERIALS.map((m) => ({ value: m.id, label: m.name })),
  value: params.materialId,
  help: 'Presets only seed the thickness and kerf — always measure the sheet you are actually going to cut.',
  onChange: (id) => {
    const m = MATERIALS.find((x) => x.id === id);
    params = { ...params, materialId: id, ...(m ? { thicknessMm: m.thicknessMm, kerfMm: m.kerfMm } : {}) };
    controls.thickness.setValue(params.thicknessMm);
    controls.kerf.setValue(params.kerfMm);
    triggerRebuild();
  },
});

const sheetField = selectField({
  label: 'Sheet',
  options: SHEETS.map((s) => ({ value: s.id, label: s.name })),
  value: params.sheetId,
  onChange: (id) => setParam('sheetId', id),
});

const sheetPreview = el('div', { className: 'ls-sheet' });
const readout = el('div', { className: 'ls-readout' });
const diagnostics = el('div', { className: 'ls-diagnostics' });

function stat(label: string, value: string): HTMLElement {
  return el('div', { className: 'ls-stat' }, [
    el('span', { className: 'ls-stat__label', text: label }),
    el('span', { className: 'ls-stat__value', text: value }),
  ]);
}

function renderResult(r: SolveResult): void {
  const material = MATERIALS.find((m) => m.id === params.materialId);
  readout.replaceChildren(
    stat('Assembled height', `${r.assembledHeightMm.toFixed(0)} mm`),
    stat('Parts', String(r.parts.length)),
    stat('Cut path', `${(r.cutLengthMm / 1000).toFixed(2)} m`),
    stat('Sheets', r.layout.overflow ? '2 or more' : '1'),
    stat('Slot width', `${(params.thicknessMm + params.clearanceMm - params.kerfMm).toFixed(2)} mm`),
    stat('Material', material?.name ?? params.materialId),
    stat('Crossing line', `${(r.axisFrac * 100).toFixed(1)}%${params.axisFrac === null ? ' (auto)' : ''}`),
    stat('Joint height', `${r.jointHeightMm.toFixed(0)} mm`),
    stat('Tab width', `${r.tabWidthMm.toFixed(1)} mm${params.tabWidthMm > 0 ? '' : ' (auto)'}`),
  );

  diagnostics.replaceChildren(
    ...r.diagnostics.map((d) =>
      el('div', { className: `ls-diag ls-diag--${d.level}` }, [
        el('div', { className: 'ls-diag__msg', text: d.message }),
        ...(d.fix ? [el('div', { className: 'ls-diag__fix', text: d.fix })] : []),
      ]),
    ),
  );

  renderSheet(r);
}

/** The nested plate, drawn from the same rings the DXF carries. If it looks
 *  wrong here it is wrong in the file. */
function renderSheet(r: SolveResult): void {
  const { widthMm: W, heightMm: H } = r.layout.sheet;
  const byId = new Map(r.parts.map((p) => [p.id, p]));
  const paths: string[] = [];
  for (const placement of r.layout.placements) {
    const part = byId.get(placement.partId);
    if (!part) continue;
    for (const ring of part.rings) {
      if (ring.length < 3) continue;
      const pt = (i: number) =>
        `${(ring[i][0] + placement.dx).toFixed(2)} ${(H - (ring[i][1] + placement.dy)).toFixed(2)}`;
      const d = `M ${pt(0)} ` + ring.slice(1).map((_, i) => `L ${pt(i + 1)}`).join(' ') + ' Z';
      paths.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="0.7"/>`);
    }
  }
  sheetPreview.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Nested sheet layout">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="currentColor" stroke-width="0.9" opacity="0.3"/>` +
    paths.join('') +
    `</svg><p class="ls-sheet__caption">${r.layout.sheet.name}${r.layout.overflow ? ' — does not fit' : ''}</p>`;
}

// ---------------------------------------------------------------------------
// 5. CHROME
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html:
    'Measure your sheet before you cut. Slot widths come from the thickness you type, ' +
    'and nominal thickness is a lie on almost every material.',
  storageKey: 'laser-slot-quality-callout',
});

const footer = sidebarFooter({
  formats: [{ id: 'zip', label: 'Cut files' }],
  exportNote: 'DXF + SVG + assembly sheet, kerf already compensated.',
  onExport: async (format) => {
    if (!result) return toast('Nothing to export yet', { kind: 'warn' });
    if (format !== 'zip') throw new Error('Unknown format: ' + format);
    if (result.diagnostics.some((d) => d.level === 'error')) {
      return toast('Fix the errors in Results first — these parts would not assemble.', {
        kind: 'error',
      });
    }
    const files = downloadCutFiles(result, {
      title: designName,
      params,
      buildId: import.meta.env.VITE_BUILD_ID,
    });
    toast(`${files.baseName}.zip — DXF, SVG and an assembly sheet.`, { kind: 'ok' });
  },
  onSave: () => downloadJSON(`${designName || 'slot-model'}-project.json`, params),
  onLoad: (file?: File) =>
    file &&
    loadJSON(file, (data) => {
      params = { ...DEFAULT_PARAMS, ...(data as Partial<SlotParams>) };
      syncControls();
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }),
  onHelp: () =>
    dialog({
      title: 'Slot-together laser cut',
      content:
        'Pick a shape or drop an image, set the height, then type the MEASURED thickness of ' +
        'the sheet you are going to cut — that one number sets every slot width. ' +
        'Kerf is how much the beam burns away; every path is offset by half of it, so if your ' +
        'laser software applies its own cut offset, set that to zero. ' +
        'Export gives you DXF (the dimensional master), SVG, and an assembly sheet.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'laser-slot-theme',
});

// ---------------------------------------------------------------------------
// 6. ASSEMBLE
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');
const stageCanvas = el('div', { className: 'ls-stage-canvas' });
const editor = createShapeEditor();

const modes = modeBar({
  modes: [
    { value: 'shape', label: 'Shape' },
    { value: 'model', label: 'Model' },
  ],
  value: 'model',
  onChange: (m: string) => showMode(m),
});

function showMode(m: string): void {
  const shape = m === 'shape';
  editor.root.classList.toggle('hidden', !shape);
  stageCanvas.classList.toggle('hidden', shape);
  hint.classList.toggle('hidden', shape);
  if (shape) editor.resize();
}

editor.onAxisChange((frac) => {
  // Dragging the line IS taking manual control; making the user find a toggle
  // first would be the same mistake twice.
  if (params.axisFrac === null) controls.autoAxis.setValue(false);
  controls.axis.classList.remove('hidden');
  controls.axis.setValue(frac * 100);
  editor.setState({ axisFrac: frac });
  setParam('axisFrac', frac);
});

editor.onJointChange((frac) => {
  controls.joint.setValue(frac * 100);
  editor.setState({ jointFrac: frac });
  setParam('jointFrac', frac);
});
const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Slot-Together Laser Cut',
        description: 'Any silhouette, crossed and slotted into a standing object. No glue.',
      }),
      ...(quality ? [quality] : []),
      collapsibleSection({ title: '1 · Shape', body: [samples, drop] }),
      imageSection,
      collapsibleSection({
        title: '2 · Size',
        body: [controls.height, controls.base, controls.baseDia],
      }),
      collapsibleSection({
        title: '3 · Joint',
        body: [controls.autoAxis, controls.axis, controls.joint, controls.tab],
      }),
      section({ title: 'View', body: [controls.explode] }),
    ],
  },
  stage: [
    stageCanvas,
    editor.root,
    modes.root,
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    status.root,
    hint,
  ],
  right: {
    scroll: [
      section({
        title: '3 · Material',
        body: [materialField, controls.thickness, controls.kerf, controls.clearance],
      }),
      section({ title: '5 · Sheet', body: [sheetField, controls.gap, sheetPreview] }),
      collapsibleSection({ title: 'Advanced', body: [controls.relief] }),
      section({ title: 'Results', body: [readout, diagnostics] }),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// The first sample is what the app boots with, so show it as chosen.
samples.querySelector('.vl-sample')?.classList.add('is-active');
controls.axis.classList.toggle('hidden', params.axisFrac === null);

showMode('model');
const viewer = createViewer(stageCanvas);
// A Bambu build plate under a laser-cut object would be a lie about the process.
viewer.setPlate('grid');

// Dev-only handle. The render loop runs on requestAnimationFrame, which a
// headless or backgrounded tab never fires, so an automated check has no way to
// force a frame and read the canvas back without one.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__viewer = viewer;
}

/** Slide the parts apart along the directions they actually assemble in: A lifts
 *  out of the joint, B drops away, the base sinks. Uses the viewer's documented
 *  `root` escape hatch rather than rebuilding geometry, so the slider is free. */
let explode = 0;
const EXPLODE_DIR: Record<string, number> = { 'profile-a': 0.55, 'profile-b': -0.18, base: -0.7 };

function applyExplode(): void {
  if (!result) return;
  const spread = result.assembledHeightMm * explode;
  viewer.root.children.forEach((child, i) => {
    const id = result!.preview[i]?.id ?? '';
    child.position.set(0, 0, (EXPLODE_DIR[id] ?? 0) * spread);
  });
}

function syncControls(): void {
  controls.height.setValue(params.heightMm);
  controls.base.setValue(params.base);
  controls.baseDia.setValue(params.baseDiaMm);
  controls.thickness.setValue(params.thicknessMm);
  controls.kerf.setValue(params.kerfMm);
  controls.clearance.setValue(params.clearanceMm);
  controls.gap.setValue(params.partGapMm);
  controls.relief.setValue(params.filletSlotEnds);
  controls.autoAxis.setValue(params.axisFrac === null);
  controls.axis.setValue((params.axisFrac ?? 0.5) * 100);
  controls.axis.classList.toggle('hidden', params.axisFrac === null);
  controls.joint.setValue(params.jointFrac * 100);
  controls.tab.setValue(params.tabWidthMm);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function downloadJSON(name: string, data: unknown): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
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
