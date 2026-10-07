import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  applyTheme,
  buildLoop,
  busyChip,
  button,
  buttonRow,
  dialog,
  el,
  generatorHeader,
  ICONS,
  licenseAfterExport,
  markProject,
  panelCredit,
  readParamsFromHash,
  readProjectFile,
  resolveTheme,
  segmentedControl,
  sidebarFooter,
  stageStatus,
  toast,
  toggleSwitch,
  topbarLinks,
  zoomControl,
  type ProjectShape,
} from '@vostok/ui-kit';
import { downloadCut, downloadFile } from '@vostok/export';
import { HOST_LICENCE_NOTE, coverDataUrl, cutExport, cutFileStem, cutZip, exportToHost, type HostLink } from '@vostok/export/makerlab';
import { MAKERLAB, initMakerlab, isEmbedded, isReady, can, sdkExport, isExportCancelled, sdkToast } from 'virtual:makerlab';
import { OP_ORDER } from '@vostok/laser/ops';
import { build } from './engine/engine';
import type { BuildResult } from './engine/build';
import { DEFAULT_SETTINGS, boxMaterial, coerceSettings, toRequest, type BoxSettings } from './state';
import { createPanel } from './ui/panel';
import { createBoxView } from './ui/view3d';
import { drawCutFile, drawDesign, outsideText } from './ui/flat';
import { panZoom } from './ui/panzoom';
import { buildSheetSvgs, readme } from './export/svg';
import { units } from './units';
import { CHANGELOG } from './changelog';
import { assemblySteps } from './assembly';

/*
  Laser Box — pick a box, size it, choose the material, add a pattern, download the cut file.

  Laser Studio's layout, the house's three columns (Ian, 2026-10-02, after a two-column first
  build: "i do want our left and right setting as usual"): on the right the box itself — which
  one and how big — over Download; on the left Laser Studio's rail of categories (Pattern ·
  Material · Joints · Inside); between them its three views (2D Design · 3D Preview · Export
  Preview), opening on 3D because a box is pieces.

  Every number becomes geometry in the worker (src/engine/worker.ts): the pieces, the
  patterns, the kerf and the sheets come back as one result, and the views only draw it. The
  kit's build loop runs it: one build at a time, always of the settings as they are when it
  starts, and Download waits for the build of what is on screen (`loop.settled()`).
*/

/* The MakerLab connection, once, as early as it can go. `MAKERLAB` is the literal `false` in
   every other build, so the bundler drops this and the host glue with it. Not awaited: the box
   builds while it is in flight, and an export waits for it only if it has not finished. */
if (MAKERLAB) {
  void initMakerlab({
    onDisconnect: () => console.warn('[laser-box] MakerLab disconnected; the next export will try to reconnect.'),
  });
}

/** The glue, as the shelf's `exportToHost` takes it (the stub's no-ops outside MakerLab). */
const HOST: HostLink = {
  isEmbedded, isReady, can, isCancelled: isExportCancelled, hostToast: sdkToast,
  connect: () => initMakerlab(),
  send: (options) => sdkExport(options),
};

const LEGACY_THEME_KEY = 'laser-box-theme';
applyTheme(resolveTheme(LEGACY_THEME_KEY), LEGACY_THEME_KEY);

const settings: BoxSettings = coerceSettings(readParamsFromHash() ?? structuredClone(DEFAULT_SETTINGS));

/** A project file is the settings with the app's id: Load refuses one another app saved, or one
 *  without settings. Every file this app has saved carries `settings`. */
const PROJECT_FILE: ProjectShape = { app: 'laser-box', keys: ['settings'] };

/** A build, with the settings it was built from: what the views draw and Download writes. */
interface Built {
  result: BuildResult;
  settings: BoxSettings;
}

// --------------------------------------------------------------------------- the stage --
type View = 'design' | 'three' | 'file';
let view: View = 'three';
const status = stageStatus('Starting the geometry engine…');
const busy = busyChip({ defaultText: 'Building…', delay: 180 });
const threeHost = el('div', { className: 'lb-three' });
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.classList.add('lb-flat');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

const box3d = createBoxView(threeHost, {
  onPick: (face) => panel.toggleFace(face),
  onZoom: (z) => { if (view === 'three') showZoom(z); },
});
// 2D Design and Export Preview move like the 3D view: wheel or pinch to zoom, drag to pan,
// double-click to fit. Room is kept under the drawing for the status line and these tools.
const flatView = panZoom(svg, {
  padding: { top: 24, right: 24, bottom: 76, left: 24 },
  onChange: (z) => { if (view !== 'three') showZoom(z); },
});

// The view switch and the mm | in switch in the bar over the picture: as wide as their options.
const viewSwitch = segmentedControl<View>({
  options: [{ value: 'design', label: '2D Design' }, { value: 'three', label: '3D Preview' }, { value: 'file', label: 'Export Preview' }],
  value: view,
  fit: 'content',
  size: 'compact',
  ariaLabel: 'View',
  onChange: (v) => showView(v),
});
const unitSwitch = units.unitSwitch({ fit: 'content' });

const openLid = toggleSwitch({ label: 'Open', checked: false, compact: true, onChange: (on) => box3d.setOpen(on ? 1 : 0) });
const explode = toggleSwitch({ label: 'Pull apart', checked: false, compact: true, onChange: (on) => box3d.setExplode(on) });
const tools = el('div', { className: 'lb-tools' }, [openLid, explode]);

// The camera's tools, bottom right of the picture, the same in all three views.
const zoomTools = zoomControl({ onZoom: (factor) => zoomBy(factor), onFit: () => fitView() });
function showZoom(z: number) {
  zoomTools.set(z);
}
function zoomBy(factor: number) {
  if (view === 'three') box3d.zoomBy(factor);
  else flatView.zoomBy(factor);
}
function fitView() {
  if (view === 'three') box3d.resetView();
  else flatView.fit();
}

const note = el('p', { className: 'lb-legend__note' });
const legend = el('div', { className: 'lb-legend' }, [
  el('span', { text: 'Cut', attrs: { 'data-op': 'cut' } }),
  el('span', { text: 'Score', attrs: { 'data-op': 'score' } }),
  el('span', { text: 'Engrave', attrs: { 'data-op': 'engrave' } }),
  note,
]);

const bar = el('div', { className: 'lb-bar' }, [viewSwitch, unitSwitch]);
const canvas = el('div', { className: 'lb-canvas' }, [threeHost, svg, status.root, busy, zoomTools.root]);
const stageCard = el('div', { className: 'lb-preview' }, [bar, canvas, tools, legend]);
const stageHost = el('div', { className: 'lb-stage' }, [stageCard]);

/** A flat view is fitted when it is first shown; after that the customer's zoom is kept. */
let fitNext = true;

function showView(v: View) {
  if (v !== view) fitNext = true;
  view = v;
  stageCard.dataset.view = v;
  threeHost.hidden = v !== 'three';
  svg.style.display = v === 'three' ? 'none' : '';
  tools.hidden = v !== 'three';
  legend.hidden = v !== 'file';
  drawFlat();
  if (v === 'three') showZoom(box3d.zoom());
}

function drawFlat() {
  const shown = loop.latest;
  if (!shown || view === 'three') return;
  const box = view === 'design' ? drawDesign(svg, shown.result, boxMaterial(shown.settings.material).hex) : drawCutFile(svg, shown.result);
  flatView.setContent(box, { fit: fitNext });
  fitNext = false;
}

// --------------------------------------------------------------------------- the panels --
const panel = createPanel(settings, {
  change: () => rebuild(),
  picking: (on) => box3d.setPicking(on),
});

// ------------------------------------------------------------------------------ rebuild --
// A change waits 90 ms for the next one, then builds the settings as they are; a change during
// a build is built straight after it. Download does not wait the 90 ms out (`settled()`).
const loop = buildLoop<Built>({
  run: async () => {
    const built = structuredClone(settings);
    return { result: await build(toRequest(built)), settings: built };
  },
  debounceMs: 90,
  onStart: () => busy.show(),
  onResult: (built) => show(built),
  onError: (err) => {
    status.set(`Could not build it: ${err.message}`, 'error');
    console.error(err);
  },
  onIdle: () => busy.hide(),
});

/** Build the settings now (`now`: without waiting out the 90 ms, after a Load or a Reset). */
function rebuild(now = false) {
  loop.request();
  if (now) loop.flush();
}

function show(built: Built) {
  const r = built.result;
  box3d.render(r, boxMaterial(built.settings.material).hex);
  box3d.setDimensions({ x: units.format(r.outside.x), y: units.format(r.outside.y), z: units.format(r.outside.z) });
  panel.showSizes(r.outside, r.inside);
  openLid.hidden = !r.pieces.some((p) => p.motion);
  drawFlat();
  describe(built);
  // Counted on the stage, for the headless drives: a fast build never shows "Building…", so
  // a status line cannot say whether it is from before a change or after it. Only a build of the
  // settings as they are now counts: one with a change already waiting behind it is shown, but
  // the box on screen is about to move on.
  if (!loop.busy) stageCard.dataset.builds = String(Number(stageCard.dataset.builds ?? 0) + 1);
}

function describe({ result: r, settings: s }: Built) {
  const ops = new Set<(typeof OP_ORDER)[number]>(['cut']);
  for (const p of r.pieces) {
    if (p.engrave.length) ops.add('engrave');
    if (p.score.shapes.length || p.score.paths.length) ops.add('score');
  }
  const order = OP_ORDER.filter((o) => ops.has(o));
  const warn = r.warnings[0];
  const sheets = `${r.sheets} sheet${r.sheets === 1 ? '' : 's'}`;
  status.set(`${outsideText(r)} outside · ${r.pieces.length} pieces · ${sheets} · ${order.join(' + ')}${warn ? ` · ${warn}` : ''}`, warn ? 'warn' : 'idle');
  note.textContent = `The ${s.kerf.toFixed(2)} mm kerf is built into the red lines — set your laser software’s offset to 0.${ops.has('score') ? ' Set blue to Score, not Cut.' : ''}`;
}

units.onChange(() => {
  const shown = loop.latest;
  if (shown) {
    const r = shown.result;
    box3d.setDimensions({ x: units.format(r.outside.x), y: units.format(r.outside.y), z: units.format(r.outside.z) });
    drawFlat();
    describe(shown);
  }
});

// ------------------------------------------------------------------- export and project --
/** "laser-box-hinge-120x80x60": the box's type and its outside size, when it has been built. */
function fileStem(style: string, r: BuildResult | undefined): string {
  const o = r?.outside;
  const size = o ? `${Math.round(o.x)}x${Math.round(o.y)}x${Math.round(o.z)}` : '';
  return ['laser-box', style, size].filter(Boolean).join('-');
}

/** Inside MakerLab the box goes to the host as one zip — every sheet's SVG and the README — and
 *  never as a download: the embed has no download path and opens no links, so the licence is
 *  said in the artifact's description, in the README and in the toast, in words. */
async function sendToMakerlab({ result: r, settings: s }: Built) {
  const buildId = import.meta.env.VITE_BUILD_ID;
  const stem = cutFileStem(fileStem(s.style, r), 'laser-box');
  const sheets = buildSheetSvgs(r, stem, buildId);
  const count = `${r.sheets} sheet${r.sheets === 1 ? '' : 's'}`;
  const sent = await exportToHost(
    HOST,
    { status: (text, kind) => status.set(text, kind), toast: (text, kind) => toast(text, { kind }) },
    async () => cutExport({
      fileName: `${stem}.zip`,
      buffer: cutZip({
        files: Object.fromEntries(sheets.map((f) => [f.name, f.text])),
        readme: [readme(r, s.kerf, r.notes), '', HOST_LICENCE_NOTE, ...(buildId ? ['', `Build ${buildId}`] : []), ''].join('\n'),
      }),
      // Hairlines thickened in the cover only: a box is nothing but cuts, and at 512 px a whole
      // sheet of 0.025 mm lines is a blank square.
      coverImage: await coverDataUrl(sheets[0]!.text, 512, { strokePx: 1.5 }),
      description: `Laser Box, ${outsideText(r)} outside: the cut file as ${sheets.length === 1 ? 'an SVG' : `${sheets.length} SVGs, one a sheet,`} in millimetres, with a README of what each colour does. ${HOST_LICENCE_NOTE}`,
    }),
    { what: 'the cut file' },
  );
  if (sent) {
    toast(
      `Sent ${stem}.zip to MakerLab: ${count} and a sheet explaining the colours. `
        + 'Free for personal use; selling what you cut needs a commercial licence.',
      { kind: 'ok' },
    );
  }
}

const footer = sidebarFooter({
  // Inside MakerLab the label starts with "Export", which the kit passes through untouched: the
  // file goes to MakerLab, not to Downloads.
  formats: [{ id: 'svg', label: MAKERLAB ? 'Export cut file' : 'SVG' }],
  onExport: async () => {
    // The build of the box on screen: one still running is waited for, and one that failed is
    // refused (the export panel says why) rather than replaced by the box before it (#11).
    const built = await loop.settled();
    if (MAKERLAB) return sendToMakerlab(built);
    const { result: r, settings: s } = built;
    const stem = fileStem(s.style, r);
    const name = downloadCut(buildSheetSvgs(r, stem, import.meta.env.VITE_BUILD_ID), stem, readme(r, s.kerf, r.notes));
    status.set(`Downloaded ${name}`, 'idle');
    // Full window on the first download of the visit, the corner reminder after (invariant #3).
    licenseAfterExport();
  },
  // The embedded build has no download path, so the kit hides Save and Open there.
  hostOwnsProjects: MAKERLAB,
  onSave: () =>
    downloadFile(
      JSON.stringify(markProject(PROJECT_FILE, { version: 1, settings }), null, 2),
      `${fileStem(settings.style, loop.latest?.result)}.laser-box.json`,
      'application/json',
    ),
  onLoad: (file?: File) =>
    file &&
    readProjectFile(file, (data) => {
      Object.assign(settings, coerceSettings((data as { settings: unknown }).settings));
      panel.sync();
      rebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }, PROJECT_FILE),
  onHelp: () =>
    dialog({
      title: 'Laser Box help',
      content: el('div', { className: 'lb-help' }, [
        el('p', { text: `Pick a box and its size on the right — or start from a ready-made one under the box types — then ${MAKERLAB ? 'export it to MakerLab' : 'download'}. `
          + 'Every tab and slot is sized for the sheet you name — measure it with calipers and type the thickness in under Material.' }),
        el('p', { text: 'Cut one corner first. If it falls apart, move Fit one step tighter; if it will not go together, one step looser. The kerf is already in the file, so set your laser software’s own offset to 0.' }),
        el('p', { text: 'Red lines cut, blue lines score, black areas engrave. Run engrave and score before the cut.' }),
        el('p', { text: 'Scroll or pinch to zoom. Drag turns the 3D box and moves the flat views; the fit button puts any view back.' }),
        el('p', { text: 'Under Pattern, choose the sides: click them in the list or on the 3D box. A shape puts the pattern inside a heart, a circle or a star.' }),
        el('p', { className: 'lb-help__title', text: 'How to put this box together' }),
        el('ol', { className: 'lb-help__steps' }, assemblySteps(settings).map((step) => el('li', { text: step }))),
      ]),
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: LEGACY_THEME_KEY,
});

const reset = button({
  label: 'Reset', icon: ICONS.rotateLeft, emphasis: 'ghost',
  onClick: () => { Object.assign(settings, structuredClone(DEFAULT_SETTINGS)); panel.sync(); rebuild(true); },
});
const resetRow = buttonRow(reset);

// The left panel is the rail and nothing else: compact chrome round a flush rail. A narrow screen
// is the kit's phone layout: the preview, then the box, with Download
// pinned at the foot beside a Settings button that opens the rail, its open category and Reset in
// the kit's drawer; Save, Load, Help and Light mode follow the box. On a desktop nothing moves.
const shell = appShell({
  // Inside MakerLab the host draws the chrome and the embed opens no links: no top bar.
  topbar: MAKERLAB ? undefined : topbarLinks({ themeToggle: false }),
  phone: true,
  left: {
    compact: true,
    header: [generatorHeader({ title: 'Laser Box', hideCredit: true })],
    scroll: [panel.left],
    footer: [resetRow],
    credit: panelCredit({ title: 'Laser Box', hostOwnsLinks: MAKERLAB, updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [stageHost],
  right: {
    scroll: panel.right,
    footer: [footer],
  },
});
document.getElementById('app')!.append(shell.root);

// A share link's settings, like a loaded project's, end on what the controls can show.
panel.sync();
showView('three');
rebuild(true);

// Dev only: what headless captures drive — the
// dimensions off and the lid part-open, which no control does. Not in the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__laserBox = { view: box3d, settings };
}
