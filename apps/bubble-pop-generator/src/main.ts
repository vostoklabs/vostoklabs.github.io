import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  el,
  sliderRow,
  segmentedControl,
  toggleSwitch,
  toast,
  dialog,
  openLicenseModal,
  licenseReminderToast,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';

import { createStore } from './store/store';
import { loadFileToImage, loadUrlToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { SAMPLES } from './image/sample';
import { createViewer, type Viewer, type ViewPreset } from './viewer/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { downloadThreeMF } from './export/threemfExport';
import { runImportWizard } from './ui/import-wizard';
import {
  DEFAULT_PREPROCESS,
  FILAMENTS,
  POP,
  SHAPE_LIBRARY,
  SOCKET_WALL_MM,
  type BuildRegion,
  type ButtonEntry,
  type ButtonLayout,
  type GeometryRequest,
  type GeometryResponse,
  type PaletteEntry,
  type PopBuildParams,
  type PopPart,
  type PopReport,
  type PreprocessParams,
  type RegionSet,
  type RGB,
  type Ring,
  type ShapeKind,
} from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
type Source = 'library' | 'image';
type EditMode = 'color' | 'buttons';

interface Settings {
  source: Source;
  shape: ShapeKind;
  fitSizeMm: number;
  cornerRadius: number;
  holeRatio: number;
  starPoints: number;
  bevelEdge: boolean;
  bevelSize: number;

  colorCount: number;
  smoothing: number;
  removeBg: boolean;
  imageMargin: number;
  imageDepth: number;
  sourceName: string;

  buttonCount: number;
  buttonLayout: ButtonLayout;
  buttonSpacing: number;
  buttons: ButtonEntry[];
  buttonClearance: number;

  bodyRgb: RGB;
  buttonRgb: RGB;
}

const DEFAULTS: Settings = {
  source: 'library',
  shape: 'circle',
  fitSizeMm: 90,
  cornerRadius: 8,
  holeRatio: 0.35,
  starPoints: 5,
  bevelEdge: true,
  bevelSize: 1.5,

  colorCount: 4,
  smoothing: 0.5,
  removeBg: true,
  imageMargin: 2,
  imageDepth: 1,
  sourceName: '',

  buttonCount: 5,
  buttonLayout: 'auto',
  buttonSpacing: 3,
  buttons: [],
  buttonClearance: 0,

  bodyRgb: [232, 232, 235],
  buttonRgb: [10, 92, 213],
};

interface AppState {
  settings: Settings;
  palette: PaletteEntry[];
  status: string;
  busy: boolean;
  warnings: string[];
  report: PopReport | null;
  editMode: EditMode;
  view: ViewPreset;
  hasParts: boolean;
}

const store = createStore<AppState>({
  settings: { ...DEFAULTS, buttons: [] },
  palette: [],
  status: 'Booting…',
  busy: true,
  warnings: [],
  report: null,
  editMode: 'color',
  view: 'iso',
  hasParts: false,
});

const s = () => store.get().settings;
const patch = (p: Partial<Settings>) => store.set({ settings: { ...s(), ...p } });

// Only meaningful when the source is an image.
let regionSet: RegionSet | null = null;
let originalImage: RgbaImage | null = null;
let preprocess: PreprocessParams = { ...DEFAULT_PREPROCESS };
let latestParts: PopPart[] = [];
let shapePreviews = new Map<ShapeKind, Ring[]>();
let downloads = 0;

/** A unit square: the silhouette used when no image is loaded. The plate comes
 *  from the shape library then, and the outline only seeds the image aspect. */
const UNIT_SQUARE: Ring[] = [
  [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ],
];

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });
let workerReady = false;
let modulePromise: Promise<ArrayBuffer> | null = null;
let moduleSent = false;
let pendingRebuild = false;
let building = false;
let rebuildTimer: number | undefined;

function popModuleBuffer(): Promise<ArrayBuffer> {
  if (!modulePromise) {
    modulePromise = fetch(`${import.meta.env.BASE_URL}assets/pop-socket/pop-socket-module.3mf`).then((r) => {
      if (!r.ok) throw new Error(`pop module: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
  }
  return modulePromise;
}

async function send(msg: GeometryRequest) {
  // The module is a few hundred KB; ship it once and let the worker cache it.
  if (!moduleSent) {
    msg.moduleBuffer = await popModuleBuffer();
    moduleSent = true;
  }
  worker.postMessage(msg);
}

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    workerReady = true;
    void send({ type: 'shapePreviews' });
    scheduleRebuild(0);
    return;
  }
  if (msg.type === 'previews') {
    shapePreviews = new Map(msg.previews.map((p) => [p.id, p.rings]));
    renderShapeGallery();
    return;
  }
  if (msg.type === 'error') {
    building = false;
    store.set({ busy: false, status: 'Build failed.' });
    console.error(msg.message);
    toast('Could not build the model. See the console.', { kind: 'error' });
    return;
  }
  // parts
  building = false;
  latestParts = msg.parts;
  viewer.setParts(msg.parts, !store.get().hasParts);
  store.set({
    busy: false,
    hasParts: true,
    warnings: msg.warnings,
    report: msg.report,
    status: msg.report.placed
      ? `${msg.report.placed} button${msg.report.placed === 1 ? '' : 's'} · ${msg.report.thickness} mm thick`
      : 'No button fits. Increase Size.',
  });
  // Manual placement always starts from what was actually built, so grabbing a
  // button never makes it jump somewhere else first.
  if (s().buttons.length !== msg.report.positions.length) {
    patch({ buttons: msg.report.positions.map(([x, y]) => ({ x, y })) });
  }
  drawHandles();
  if (pendingRebuild) {
    pendingRebuild = false;
    rebuild();
  }
};

function scheduleRebuild(delay = 140) {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuild, delay);
}

function rebuild() {
  if (!workerReady) return;
  if (building) {
    pendingRebuild = true;
    return;
  }
  building = true;
  store.set({ busy: true, status: 'Building…' });

  const v = s();
  const regions: BuildRegion[] = [];
  if (v.source === 'image' && regionSet) {
    regionSet.regions.forEach((r, i) => {
      const color = store.get().palette[i]?.filamentRgb ?? r.quantRgb;
      r.components.forEach((comp, j) => {
        regions.push({ filamentRgb: color, coverage: r.coverage, rings: comp.rings, partName: `inlay-${i}-${j}` });
      });
    });
  }

  const params: PopBuildParams = {
    baseShape: v.source === 'image' ? 'outline' : v.shape,
    fitSizeMm: v.fitSizeMm,
    cornerRadius: v.cornerRadius,
    holeRatio: v.holeRatio,
    starPoints: v.starPoints,
    edgeStyle: v.bevelEdge ? 'bevel' : 'flat',
    edgeRadius: v.bevelSize,
    bodyRgb: v.bodyRgb,
    buttonRgb: v.buttonRgb,
    imageMargin: v.imageMargin,
    imageDepth: v.imageDepth,
    colorBleed: 0.12,
    buttonCount: v.buttonCount,
    buttonLayout: v.buttonLayout,
    buttonSpacing: v.buttonSpacing,
    buttons: v.buttons,
    buttonClearance: v.buttonClearance,
    includeButtons: true,
  };

  void send({
    type: 'buildPop',
    regions,
    outline: regionSet?.outline ?? UNIT_SQUARE,
    params,
  });
}

// ---------------------------------------------------------------------------
// Image path
// ---------------------------------------------------------------------------
/** processImage MUTATES its input — the clicker clones first and the magnet
 *  generator shipped grayscale for a week because it didn't. Always clone. */
function cloneImage(img: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

function reprocess(newSource: boolean) {
  if (!originalImage) return;
  const v = s();
  regionSet = processImage(cloneImage(originalImage), v.colorCount, {
    removeBg: v.removeBg,
    smoothing: v.smoothing,
  });
  // A NEW image must reset the palette. Carrying `filamentRgb` across by index
  // is what made every image come out in the first one's colours.
  const next: PaletteEntry[] = regionSet.regions.map((r, i) => ({
    quantRgb: r.quantRgb,
    filamentRgb: newSource ? r.quantRgb : (store.get().palette[i]?.filamentRgb ?? r.quantRgb),
    coverage: r.coverage,
  }));
  store.set({ palette: next });
  renderPalette();
  scheduleRebuild(0);
}

function importImage(load: () => Promise<RgbaImage>, name: string) {
  store.set({ status: 'Loading image…', busy: true });
  load()
    .then((img) => {
      runImportWizard({
        baseImage: img,
        initial: preprocess,
        onCancel: () => store.set({ busy: false, status: store.get().hasParts ? 'Ready.' : '' }),
        onComplete: ({ adjusted, preprocess: p }) => {
          preprocess = p;
          originalImage = adjusted;
          patch({ source: 'image', sourceName: name, removeBg: !p.keepBackground });
          reprocess(true);
          renderSourcePanel();
        },
      });
    })
    .catch((err) => {
      console.error(err);
      store.set({ busy: false, status: 'Could not load that image.' });
      toast('Could not load that image.', { kind: 'error' });
    });
}

// ---------------------------------------------------------------------------
// Left panel — Shape
// ---------------------------------------------------------------------------
const shapeGallery = el('div', { className: 'bp-shape-grid' });
const sourcePanel = el('div');
const shapeExtras = el('div');

function ringsToSvg(rings: Ring[], size = 40): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-55 -55 110 110');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // Y is flipped: the geometry is Y-up, SVG is Y-down.
  path.setAttribute(
    'd',
    rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join('L')}Z`).join(' '),
  );
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  return svg;
}

function renderShapeGallery() {
  shapeGallery.replaceChildren();
  let group = '';
  for (const def of SHAPE_LIBRARY) {
    if (def.group !== group) {
      group = def.group;
      shapeGallery.appendChild(el('p', { className: 'bp-shape-group', text: group }));
    }
    const rings = shapePreviews.get(def.id);
    const btn = el('button', {
      className: `bp-shape${s().shape === def.id && s().source === 'library' ? ' is-active' : ''}`,
      attrs: { type: 'button', title: def.label, 'aria-pressed': String(s().shape === def.id) },
    });
    btn.appendChild(
      rings ? ringsToSvg(rings) : el('span', { className: 'bp-shape__pending' }),
    );
    btn.appendChild(el('span', { className: 'bp-shape__label', text: def.label }));
    btn.addEventListener('click', () => {
      const suggested = SHAPE_LIBRARY.find((d) => d.id === def.id)?.suggestedSize ?? 90;
      patch({
        source: 'library',
        shape: def.id,
        // Jumping to the suggested size only when the current one can't work
        // avoids stomping a size the user deliberately set.
        fitSizeMm: s().fitSizeMm < POP.outerDiameter + 2 * SOCKET_WALL_MM ? suggested : s().fitSizeMm,
        buttonLayout: s().buttonLayout === 'manual' ? 'auto' : s().buttonLayout,
      });
      renderShapeGallery();
      renderSourcePanel();
      scheduleRebuild(0);
    });
    shapeGallery.appendChild(btn);
  }
}

function renderShapeExtras() {
  const v = s();
  const kids: HTMLElement[] = [];
  if (v.source === 'library') {
    if (v.shape === 'roundedSquare' || v.shape === 'rectangle' || v.shape === 'speech') {
      kids.push(
        sliderRow({
          label: 'Corner radius',
          min: 0,
          max: 30,
          value: v.cornerRadius,
          unit: 'mm',
          onInput: (n) => {
            patch({ cornerRadius: n });
            scheduleRebuild();
          },
        }),
      );
    }
    if (v.shape === 'donut') {
      kids.push(
        sliderRow({
          label: 'Hole size',
          min: 15,
          max: 70,
          value: Math.round(v.holeRatio * 100),
          unit: '%',
          help: 'Hole diameter as a share of the body. A bigger hole leaves less room for buttons.',
          onInput: (n) => {
            patch({ holeRatio: n / 100 });
            scheduleRebuild();
          },
        }),
      );
    }
    if (v.shape === 'star') {
      kids.push(
        sliderRow({
          label: 'Points',
          min: 4,
          max: 10,
          value: v.starPoints,
          step: 1,
          onInput: (n) => {
            patch({ starPoints: n });
            scheduleRebuild();
          },
        }),
      );
    }
  }
  shapeExtras.replaceChildren(...kids);
}

function renderSourcePanel() {
  const v = s();
  const kids: HTMLElement[] = [];

  if (v.source === 'image') {
    kids.push(
      el('div', { className: 'mg-report' }, [
        el('div', { className: 'mg-report__row' }, [
          el('span', { className: 'mg-report__label', text: 'Image' }),
          el('span', { className: 'mg-report__value', text: v.sourceName || 'Loaded' }),
        ]),
      ]),
    );
    const adjust = el('button', { className: 'vl-btn', text: 'Adjust image…', attrs: { type: 'button' } });
    adjust.addEventListener('click', () => {
      if (!originalImage) return;
      runImportWizard({
        baseImage: originalImage,
        initial: preprocess,
        onComplete: ({ adjusted, preprocess: p }) => {
          preprocess = p;
          originalImage = adjusted;
          patch({ removeBg: !p.keepBackground });
          reprocess(false);
        },
      });
    });
    kids.push(adjust);
    kids.push(
      sliderRow({
        label: 'Colours',
        min: 1,
        max: 8,
        value: v.colorCount,
        step: 1,
        help: 'How many filament colours the image is reduced to.',
        onInput: (n) => {
          patch({ colorCount: n });
          reprocess(false);
        },
      }),
      sliderRow({
        label: 'Smoothing',
        min: 0,
        max: 100,
        value: Math.round(v.smoothing * 100),
        unit: '%',
        onInput: (n) => {
          patch({ smoothing: n / 100 });
          reprocess(false);
        },
      }),
      sliderRow({
        label: 'Border',
        min: 0.5,
        max: 8,
        value: v.imageMargin,
        step: 0.5,
        unit: 'mm',
        help: 'Flat frame between the image edge and the body edge.',
        onInput: (n) => {
          patch({ imageMargin: n });
          scheduleRebuild();
        },
      }),
      sliderRow({
        label: 'Image depth',
        min: 0.4,
        max: 3,
        value: v.imageDepth,
        step: 0.1,
        unit: 'mm',
        help: 'How deep the colours are inlaid into the flat face.',
        onInput: (n) => {
          patch({ imageDepth: n });
          scheduleRebuild();
        },
      }),
    );
    const back = el('button', { className: 'vl-btn', text: 'Use a library shape instead', attrs: { type: 'button' } });
    back.addEventListener('click', () => {
      patch({ source: 'library' });
      renderSourcePanel();
      renderShapeGallery();
      scheduleRebuild(0);
    });
    kids.push(back);
  } else {
    const upload = el('button', { className: 'import-card', attrs: { type: 'button' } }, [
      el('span', { className: 'drop-title', text: 'Upload an image' }),
      el('span', { className: 'drop-note', text: 'PNG or JPG. The outline becomes the shape.' }),
    ]);
    const file = el('input', { attrs: { type: 'file', accept: 'image/*' }, className: 'hidden' }) as HTMLInputElement;
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) importImage(() => loadFileToImage(f), f.name.replace(/\.[^.]+$/, ''));
      file.value = '';
    });
    kids.push(upload, file);

    const grid = el('div', { className: 'sample-inline-grid' });
    for (const sample of SAMPLES) {
      const b = el('button', { className: 'sample-inline-item', attrs: { type: 'button', title: sample.name } });
      b.appendChild(el('img', { attrs: { src: sample.src, alt: sample.name, loading: 'lazy' } }));
      b.addEventListener('click', () => importImage(sample.load, sample.name));
      grid.appendChild(b);
    }
    kids.push(el('p', { className: 'sample-heading', text: 'Or try a sample' }), grid);
  }

  sourcePanel.replaceChildren(...kids);
  renderShapeExtras();
}

const sizeSlider = sliderRow({
  label: 'Size',
  min: 30,
  max: 200,
  value: DEFAULTS.fitSizeMm,
  unit: 'mm',
  help: 'Longest side of the fidget. Each button needs a 19.55 mm circle with a 2 mm wall around it.',
  onInput: (n) => {
    patch({ fitSizeMm: n });
    scheduleRebuild();
  },
});

const shapeSection = collapsible('Shape', true, [
  segmentedControl<Source>({
    label: 'Start from',
    value: DEFAULTS.source,
    options: [
      { value: 'library', label: 'A shape' },
      { value: 'image', label: 'An image' },
    ],
    onChange: (val) => {
      if (val === 'image' && !originalImage) {
        // Nothing to show yet — the panel's upload card is the next step.
        patch({ source: 'image' });
        renderSourcePanel();
        return;
      }
      patch({ source: val });
      renderSourcePanel();
      renderShapeGallery();
      scheduleRebuild(0);
    },
  }),
  shapeGallery,
  sourcePanel,
  sizeSlider,
  shapeExtras,
]);

// ---------------------------------------------------------------------------
// Left panel — Buttons
// ---------------------------------------------------------------------------
const buttonChips = el('div', { className: 'mg-chips' });

function renderButtonChips() {
  const report = store.get().report;
  const n = report?.placed ?? 0;
  const kids: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const chip = el('span', { className: 'mg-chip', text: `Button ${i + 1}` });
    if (n > 1) {
      const x = el('button', { className: 'mg-chip__x', text: '×', attrs: { type: 'button', title: 'Remove' } });
      x.addEventListener('click', () => {
        const next = s().buttons.slice();
        next.splice(i, 1);
        patch({ buttonCount: Math.max(1, s().buttonCount - 1), buttons: next });
        scheduleRebuild(0);
      });
      chip.appendChild(x);
    }
    kids.push(chip);
  }
  const add = el('button', { className: 'mg-chip mg-chip--add', text: '+ Add', attrs: { type: 'button' } });
  add.addEventListener('click', () => {
    patch({ buttonCount: Math.min(24, s().buttonCount + 1) });
    scheduleRebuild(0);
  });
  kids.push(add);
  buttonChips.replaceChildren(...kids);
}

const countSlider = sliderRow({
  label: 'Buttons',
  min: 1,
  max: 24,
  value: DEFAULTS.buttonCount,
  step: 1,
  onInput: (n) => {
    patch({ buttonCount: n });
    scheduleRebuild();
  },
});

const buttonSection = collapsible('Pop buttons', true, [
  countSlider,
  segmentedControl<ButtonLayout>({
    label: 'Layout',
    value: DEFAULTS.buttonLayout,
    options: [
      { value: 'auto', label: 'Spread' },
      { value: 'grid', label: 'Grid' },
      { value: 'manual', label: 'By hand' },
    ],
    onChange: (val) => {
      patch({ buttonLayout: val });
      store.set({ editMode: val === 'manual' ? 'buttons' : store.get().editMode });
      renderEditBar();
      applyEditMode();
      scheduleRebuild(0);
    },
  }),
  sliderRow({
    label: 'Spacing',
    min: 0,
    max: 20,
    value: DEFAULTS.buttonSpacing,
    unit: 'mm',
    help: `Extra plastic between buttons, on top of the ${SOCKET_WALL_MM} mm minimum wall.`,
    onInput: (n) => {
      patch({ buttonSpacing: n });
      scheduleRebuild();
    },
  }),
  buttonChips,
  (() => {
    const b = el('button', { className: 'vl-btn', text: 'Reset to automatic layout', attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      patch({ buttonLayout: 'auto', buttons: [] });
      store.set({ editMode: 'color' });
      renderEditBar();
      applyEditMode();
      scheduleRebuild(0);
    });
    return b;
  })(),
]);

// ---------------------------------------------------------------------------
// Left panel — Style + Fit
// ---------------------------------------------------------------------------
function swatchRow(label: string, get: () => RGB, set: (rgb: RGB) => void): HTMLElement {
  const row = el('div', { className: 'fil-row' });
  const render = () => {
    row.replaceChildren(el('span', { className: 'vl-label', text: label }));
    for (const [name, hex] of FILAMENTS) {
      const rgb: RGB = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      const active = get().join(',') === rgb.join(',');
      const chip = el('button', {
        className: `fil-chip${active ? ' is-active' : ''}`,
        attrs: { type: 'button', title: name, style: `background:${hex}` },
      });
      chip.addEventListener('click', () => {
        set(rgb);
        render();
        scheduleRebuild(0);
      });
      row.appendChild(chip);
    }
  };
  render();
  return row;
}

const styleSection = collapsible('Style', false, [
  swatchRow('Body colour', () => s().bodyRgb, (rgb) => patch({ bodyRgb: rgb })),
  swatchRow('Button colour', () => s().buttonRgb, (rgb) => patch({ buttonRgb: rgb })),
  toggleSwitch({
    label: 'Bevelled top edge',
    checked: DEFAULTS.bevelEdge,
    onChange: (on) => {
      patch({ bevelEdge: on });
      scheduleRebuild(0);
    },
  }),
  sliderRow({
    label: 'Bevel size',
    min: 0.2,
    max: 4,
    value: DEFAULTS.bevelSize,
    step: 0.1,
    unit: 'mm',
    help: 'Only the top edge is bevelled. The bottom face prints against the plate and must stay square.',
    onInput: (n) => {
      patch({ bevelSize: n });
      scheduleRebuild();
    },
  }),
]);

const fitSection = collapsible('Fit', false, [
  el('p', { className: 'hint-text', text:
    `The socket is a fixed snap fit: ⌀${POP.outerDiameter} housing, ⌀${POP.boreDiameter} bore, ` +
    `${POP.height} mm deep. Only the bore is adjustable. The spring beams and the snap bead are ` +
    `part of the mechanism and are never scaled.` }),
  sliderRow({
    label: 'Button clearance',
    min: -0.1,
    max: 0.3,
    value: DEFAULTS.buttonClearance,
    step: 0.05,
    unit: 'mm',
    help: 'Extra bore DIAMETER for the press fit. Buttons print in place: raise this if they fuse to the socket, lower it if they rattle.',
    onInput: (n) => {
      patch({ buttonClearance: n });
      scheduleRebuild(260);
    },
  }),
]);

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------
const stageCanvas = el('div', { className: 'mg-stage-canvas' });
const viewBar = el('div', { className: 'mg-view-bar' });
const editBar = el('div', { className: 'edit-mode-bar' });
const statusEl = el('p', { className: 'mg-status' });
const hintEl = el('p', { className: 'vl-stage__hint' });

function renderViewBar() {
  const cur = store.get().view;
  viewBar.replaceChildren(
    ...(
      [
        ['front', 'Image side'],
        ['back', 'Button side'],
        ['iso', '3D'],
      ] as [ViewPreset, string][]
    ).map(([id, label]) => {
      const b = el('button', {
        className: `mg-view-btn${cur === id ? ' is-active' : ''}`,
        text: label,
        attrs: { type: 'button' },
      });
      b.addEventListener('click', () => {
        store.set({ view: id });
        viewer.setView(id);
        renderViewBar();
      });
      return b;
    }),
  );
}

function renderEditBar() {
  const cur = store.get().editMode;
  editBar.replaceChildren(
    ...(
      [
        ['color', 'Colours'],
        ['buttons', 'Place buttons'],
      ] as [EditMode, string][]
    ).map(([id, label]) => {
      const b = el('button', {
        className: `edit-mode-btn${cur === id ? ' is-active' : ''}`,
        text: label,
        attrs: { type: 'button' },
      });
      b.addEventListener('click', () => {
        store.set({ editMode: id });
        if (id === 'buttons') patch({ buttonLayout: 'manual' });
        renderEditBar();
        applyEditMode();
        if (id === 'buttons') scheduleRebuild(0);
      });
      return b;
    }),
  );
}

// ---------------------------------------------------------------------------
// Right panel
// ---------------------------------------------------------------------------
const paletteEl = el('div', { className: 'palette' });
const reportEl = el('div', { className: 'mg-report' });
const warnEl = el('div', { className: 'mg-warnings' });

function renderPalette() {
  const pal = store.get().palette;
  if (s().source !== 'image' || pal.length === 0) {
    paletteEl.replaceChildren(
      el('p', { className: 'hint-text', text: 'Colours appear here once you import an image.' }),
    );
    return;
  }
  const kids: HTMLElement[] = [];
  pal.forEach((entry, i) => {
    const row = el('div', { className: 'fil-row' });
    row.appendChild(
      el('span', {
        className: 'swatch',
        attrs: { style: `background:rgb(${entry.filamentRgb.join(',')})`, title: `Colour ${i + 1}` },
      }),
    );
    for (const [name, hex] of FILAMENTS) {
      const rgb: RGB = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      const chip = el('button', {
        className: `fil-chip${entry.filamentRgb.join(',') === rgb.join(',') ? ' is-active' : ''}`,
        attrs: { type: 'button', title: name, style: `background:${hex}` },
      });
      chip.addEventListener('click', () => {
        const next = store.get().palette.slice();
        next[i] = { ...next[i], filamentRgb: rgb };
        store.set({ palette: next });
        renderPalette();
        scheduleRebuild(0);
      });
      row.appendChild(chip);
    }
    kids.push(row);
  });
  const slots = new Set(pal.map((p) => p.filamentRgb.join(',')));
  slots.add(s().bodyRgb.join(','));
  slots.add(s().buttonRgb.join(','));
  kids.push(
    el('p', {
      className: slots.size > 4 ? 'mg-warn' : 'hint-text',
      text:
        slots.size > 4
          ? `${slots.size} filaments, more than a 4-slot AMS can load without a swap.`
          : `${slots.size} filament${slots.size === 1 ? '' : 's'}.`,
    }),
  );
  paletteEl.replaceChildren(...kids);
}

function renderReport() {
  const r = store.get().report;
  if (!r) {
    reportEl.replaceChildren();
    return;
  }
  const rows: [string, string][] = [
    ['Buttons', r.placed === r.requested ? `${r.placed}` : `${r.placed} of ${r.requested}`],
    ['Body', `${r.bodyWidth.toFixed(0)} × ${r.bodyHeight.toFixed(0)} × ${r.thickness} mm`],
    ['Bore', `⌀${r.boreDiameter.toFixed(2)} mm`],
    ['Smallest size for 1 button', `${Math.ceil(r.minBodySize)} mm`],
  ];
  reportEl.replaceChildren(
    ...rows.map(([k, val]) =>
      el('div', { className: 'mg-report__row' }, [
        el('span', { className: 'mg-report__label', text: k }),
        el('span', { className: 'mg-report__value', text: val }),
      ]),
    ),
  );
}

function renderWarnings() {
  const w = store.get().warnings;
  warnEl.replaceChildren(...w.map((t) => el('p', { className: 'mg-warn', text: t })));
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html:
    'Print it as it comes out: <b>image face down, no supports</b>. The buttons print inside their ' +
    'sockets. Free them with a gentle press once the part is cool. Profiles and settings on ' +
    `<a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
  storageKey: 'bubblepop-quality-callout',
});

const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async () => {
    if (!latestParts.length) {
      toast('Nothing to export yet.', { kind: 'error' });
      return;
    }
    const stem = s().source === 'image' ? s().sourceName || 'image' : s().shape;
    downloadThreeMF(latestParts, `bubble-pop-${stem}-${Math.round(s().fitSizeMm)}mm.3mf`);
    // First download gets the full modal, every later one a toast — the same
    // flow as the clicker and magnet generators.
    downloads += 1;
    if (downloads === 1) openLicenseModal();
    else licenseReminderToast();
  },
  onSave: () => {
    const blob = new Blob([JSON.stringify({ settings: s(), palette: store.get().palette }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bubble-pop-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  },
  onLoad: (file?: File) => {
    // The kit's Load button hands a desktop host nothing, expecting the host's own picker.
    // This generator is web-only, so there is nothing to fall back to — just don't read undefined.
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result as string);
        if (data.settings) patch(data.settings);
        if (data.palette) store.set({ palette: data.palette });
        renderShapeGallery();
        renderSourcePanel();
        renderPalette();
        scheduleRebuild(0);
        toast('Project loaded.', { kind: 'ok' });
      } catch {
        toast('Invalid project file', { kind: 'error' });
      }
    };
    r.readAsText(file);
  },
  onHelp: () =>
    dialog({
      title: 'Bubble Pop Fidget Generator',
      content:
        'Pick a shape (or upload an image), choose how many pop buttons you want, and download the 3MF.\n\n' +
        'How it prints: the flat image face goes down on the plate, the buttons stand proud of the back, ' +
        'and everything prints in one go with no supports. The buttons are already sitting in their ' +
        'sockets. Press one after the print cools and it pops free.\n\n' +
        `Why the body is always ${POP.height} mm thick: that is the height of the snap-fit sleeve. ` +
        'Thinner and there is nothing for the button to click into.\n\n' +
        'If the buttons come out fused to the socket, raise Fit → Button clearance and re-print. ' +
        'If they rattle, lower it.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'bubblepop-theme',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Bubble Pop Fidget Generator',
        description: 'Pick a shape or an image, choose how many pop buttons, print the fidget.',
      }),
      ...(quality ? [quality] : []),
      shapeSection,
      buttonSection,
      styleSection,
      fitSection,
    ],
  },
  stage: [viewBar, editBar, stageCanvas, statusEl, hintEl],
  right: {
    scroll: [
      el('div', { className: 'vl-section' }, [el('p', { className: 'vl-label', text: 'Colours' }), paletteEl]),
      el('div', { className: 'vl-section' }, [el('p', { className: 'vl-label', text: 'Result' }), reportEl, warnEl]),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------
const viewer: Viewer = createViewer(stageCanvas);

// Build plate picker (top-right of the stage); the plate is shared across generators.
mountPlatePicker(shell.stage, viewer);

function drawHandles() {
  const r = store.get().report;
  if (!r) return;
  viewer.setButtonHandles({
    positions: r.positions,
    innerRadius: r.boreDiameter / 2,
    size: [r.keepoutRadius * 2, r.keepoutRadius * 2],
    outline: 'circle',
    active: activeButton,
    interactive: store.get().editMode === 'buttons',
    rotations: r.positions.map(() => 0),
  });
}

let activeButton = 0;

function applyEditMode() {
  const placing = store.get().editMode === 'buttons';
  // Set this UP FRONT, not reactively: OrbitControls sees pointerdown on the
  // canvas before our stage handler does, so disabling orbit inside the handler
  // races and the model spins instead of placing.
  viewer.setPlacementMode(placing);
  hintEl.textContent = placing
    ? 'Click the model to move the selected button, or click a button to select it.'
    : 'Hold left click to rotate, right click to pan, scroll to zoom.';
  drawHandles();
}

stageCanvas.addEventListener('pointerdown', (e) => {
  if (store.get().editMode !== 'buttons') return;
  const hit = viewer.handleAt(e.clientX, e.clientY);
  if (hit !== null) {
    activeButton = hit;
    drawHandles();
    return;
  }
  const pt = viewer.pickBodyPoint(e.clientX, e.clientY);
  if (!pt) return;
  const next = s().buttons.slice();
  while (next.length <= activeButton) next.push({ x: 0, y: 0 });
  next[activeButton] = { x: pt[0], y: pt[1] };
  patch({ buttons: next, buttonLayout: 'manual' });
  scheduleRebuild(0);
});

new MutationObserver(() => {
  viewer.setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------------------------------------------------------------------------
// Reactive glue
// ---------------------------------------------------------------------------
store.subscribe((st) => {
  statusEl.textContent = st.status;
  statusEl.className = `mg-status${st.busy ? ' mg-status--busy' : ''}${st.warnings.length ? ' mg-status--warn' : ''}`;
  renderReport();
  renderWarnings();
  renderButtonChips();
});

renderViewBar();
renderEditBar();
renderShapeGallery();
renderSourcePanel();
renderPalette();
applyEditMode();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function collapsible(title: string, open: boolean, children: (HTMLElement | null)[]): HTMLElement {
  const d = el('details', { className: 'vl-section' }) as HTMLDetailsElement;
  d.open = open;
  const summary = el('summary', { text: title });
  d.appendChild(summary);
  d.appendChild(el('div', { className: 'collapsible-body' }, children.filter(Boolean) as HTMLElement[]));
  return d;
}
