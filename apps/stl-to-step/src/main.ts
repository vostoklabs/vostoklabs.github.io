import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  section,
  dropZone,
  exportPanel,
  stageStatus,
  stageTools,
  stageRow,
  previewBar,
  buildLoop,
  workerClient,
  FILAMENTS,
  el,
} from '@vostok/ui-kit';
import { createViewer, type RGB } from '@vostok/viewer';
import { downloadFile } from '@vostok/export';
import type { ConvertProgress, PreviewMesh } from '@vostok/mesh-to-cad';
import type { ConvertRequest, ConvertResult, MadeResult, ReadResult } from './worker';

/*
  STL to STEP: an STL exported from a CAD program, back into a STEP with real faces and edges.

  Drop the STL on the right. The middle shows the STL beside the STEP made from it: grey with
  its edges in black, or each kind of surface in its own colour. Download STEP is at the foot of
  the right panel.
*/

const SAMPLE = 'plate-holes.stl';

/** Each kind of surface in one shelf filament colour, with its name in the list. */
const KINDS = [
  { kind: 'plane', name: 'Flat', filament: 'Silver' },
  { kind: 'cylinder', name: 'Cylinder', filament: 'Cyan' },
  { kind: 'cone', name: 'Cone', filament: 'Orange' },
  { kind: 'sphere', name: 'Sphere', filament: 'Green' },
  { kind: 'torus', name: 'Torus', filament: 'Purple' },
  { kind: 'revolution', name: 'Revolved', filament: 'Pink' },
  { kind: 'extrusion', name: 'Extruded', filament: 'Yellow' },
  { kind: 'bspline', name: 'Free-form', filament: 'Red' },
];
const hexOf = (kind: string) => {
  const filament = KINDS.find((k) => k.kind === kind)?.filament ?? 'Gray';
  return FILAMENTS.find(([name]) => name === filament)![1];
};
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

/** Neighbouring faces of one kind in slightly different shades, so a face found in two pieces shows. */
function shade(c: RGB, i: number): RGB {
  const f = 0.86 + 0.28 * ((i * 0.618034) % 1);
  return c.map((x) => Math.min(255, Math.round(x * f))) as RGB;
}

/** The Edges view: the whole part in one neutral shelf colour, the way a CAD program shows it. */
const PART_COLOUR = rgb(FILAMENTS.find(([name]) => name === 'Gray')![1]);

type View = 'edges' | 'colors';
let view: View = 'edges';

const stem = (name: string) => name.replace(/\.stl$/i, '') || 'part';

// ---------------------------------------------------------------------------
// READ the opened file, then MAKE the STEP from it, one build at a time; Download waits on it.
// ---------------------------------------------------------------------------
let file: { bytes: ArrayBuffer; name: string } | null = null;
/** Bumped by every file opened, so a slow read of the last one cannot replace it. */
let reads = 0;

const worker = workerClient<ConvertRequest, ConvertResult>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  {
    // The only messages the worker sends besides its reply.
    onEvent: (data) => {
      const p = data as ConvertProgress;
      status.setProgress(p.done);
      status.set(p.text);
    },
  },
);

type Made = MadeResult & { fileName: string };

const loop = buildLoop<Made>({
  run: async () => {
    const f = file;
    if (!f) throw new Error('Drop an STL on the right.');
    const r = (await worker.call({ op: 'make', name: stem(f.name) })) as MadeResult;
    return { ...r, fileName: f.name };
  },
  onStart: () => {
    status.setProgress(0);
    status.set('Making the STEP…');
  },
  onIdle: () => status.setProgress(null),
  onResult: (r) => showStep(r),
  onError: (err) => {
    viewer.setParts([]);
    checkSection.hidden = true;
    status.set(`Could not make the STEP: ${err.message}`, 'error');
  },
});

/** The middle of the STL's box: both views hold it at their centre, so they show the same place. */
function middle(positions: Float32Array): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}
let centre: [number, number, number] = [0, 0, 0];

/** The kinds of surface in the STEP and how many of each, each with its colour: the key to Colors. */
function listKinds(counts: Record<string, number>) {
  kindList.replaceChildren(
    ...KINDS.filter((k) => counts[k.kind]).map((k) =>
      el('div', { className: 'sts-kind' }, [
        el('span', { className: 'sts-kind__dot', attrs: { style: `background: ${hexOf(k.kind)}` } }),
        el('span', { text: k.name }),
        el('span', { className: 'sts-kind__count', text: String(counts[k.kind]) }),
      ]),
    ),
  );
}

function drawStep(r: Made, refit: boolean) {
  viewer.setParts(
    r.faces.map((f, i) => ({
      name: `Face ${i + 1}`,
      positions: f.positions,
      indices: f.indices,
      ...(view === 'edges' ? { color: PART_COLOUR, edges: f.edges } : { color: shade(rgb(hexOf(f.kind)), i) }),
    })),
    refit,
    centre,
  );
  kindSection.hidden = view !== 'colors';
}

function showStep(r: Made) {
  drawStep(r, false);
  listKinds(r.report.faces);
  const c = r.report.check;
  checkList.replaceChildren(
    ...(c.notes.length ? c.notes : ['Every edge meets both of its faces.']).map((note) => el('p', { className: 'vl-hint', text: note })),
  );
  checkSection.hidden = false;
  const n = r.faces.length;
  status.set(`${r.fileName} · ${n} ${n === 1 ? 'face' : 'faces'} · ${(r.report.ms / 1000).toFixed(1)} s`);
}

// ---- opening a file ----

async function open(bytes: ArrayBuffer, name: string) {
  const read = ++reads;
  file = { bytes, name };
  loop.invalidate();
  viewer.setParts([]);
  kindSection.hidden = true;
  checkSection.hidden = true;
  status.setProgress(0);
  status.set(`Reading ${name}…`);
  try {
    // A copy goes to the worker; the page keeps its own.
    const r = (await worker.call({ op: 'read', bytes })) as ReadResult;
    if (read !== reads) return;
    const stl: PreviewMesh = r.stl;
    centre = middle(stl.positions);
    stlViewer.setParts([{ name: 'STL', positions: stl.positions, indices: stl.indices, color: PART_COLOUR }], true, centre);
    loop.request();
  } catch (err) {
    if (read !== reads) return;
    status.setProgress(null);
    stlViewer.setParts([]);
    status.set(`Could not read this STL: ${(err as Error).message}`, 'error');
  }
}

async function openFiles(files: File[]) {
  const f = files[0];
  if (!f) return;
  if (!/\.stl$/i.test(f.name)) {
    status.set('Open an STL file.', 'error');
    return;
  }
  void open(await f.arrayBuffer(), f.name);
}

// ---------------------------------------------------------------------------
// RIGHT PANEL: the STL, the surfaces found, the file check, and Download.
// ---------------------------------------------------------------------------
const fileSection = section({
  title: 'Your STL',
  body: [
    dropZone({
      title: 'Drop an STL',
      text: 'or click to choose a file',
      note: 'Exported from a CAD program. It stays on your computer.',
      accept: '.stl',
      onFiles: (files) => void openFiles(files),
    }),
  ],
});

const kindList = el('div', { className: 'sts-kinds' });
const kindSection = section({ title: 'Surfaces', body: [kindList] });
kindSection.hidden = true;

const checkList = el('div', { className: 'sts-kinds' });
const checkSection = section({ title: 'File check', body: [checkList] });
checkSection.hidden = true;

const exporter = exportPanel({
  formats: [{ id: 'step', label: 'STEP' }],
  // The STEP is the person's own model, not a design of ours: no licence window.
  onExport: async () => {
    const r = await loop.settled();
    downloadFile(r.step, `${stem(r.fileName)}.step`, 'model/step');
  },
});

// ---------------------------------------------------------------------------
// STAGE and ASSEMBLE
// ---------------------------------------------------------------------------
const status = stageStatus('Loading the sample…');
const viewBar = previewBar<View>({
  label: 'Preview',
  modes: {
    options: [{ value: 'edges', label: 'Edges' }, { value: 'colors', label: 'Colors' }],
    value: view,
    onChange: (v) => {
      view = v;
      if (loop.latest) drawStep(loop.latest, false);
    },
  },
});
// The two views, side by side: the STL as it came, and the STEP made from it.
const stlCanvas = el('div', { className: 'sts-view' });
const stepCanvas = el('div', { className: 'sts-view' });
const stageCanvas = el('div', { className: 'sts-stage-canvas' }, [
  el('div', { className: 'sts-pane' }, [stlCanvas, el('span', { className: 'sts-pane__name', text: 'STL' })]),
  el('div', { className: 'sts-pane' }, [stepCanvas, el('span', { className: 'sts-pane__name', text: 'STEP' })]),
]);
const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

const shell = appShell({
  topbar: topbarLinks({ themeToggle: true, themeStorageKey: 'stl-to-step-theme' }),
  stage: [stageCanvas, stageTools([stageRow([viewBar.root])]), status.root, hint],
  right: {
    header: [generatorHeader({ title: 'STL to STEP', hideCredit: true })],
    scroll: [fileSection, kindSection, checkSection],
    footer: [exporter],
  },
});
document.getElementById('app')!.append(shell.root);

// Each view is half the stage, so the part fills more of it than it would of a whole one.
const stlViewer = createViewer(stlCanvas, { frame: { fill: 0.8 } });
const viewer = createViewer(stepCanvas, { frame: { fill: 0.8 } });
stlViewer.setPlate('grid');
viewer.setPlate('grid');

// Turning, panning or zooming one view does the same to the other.
let following = false;
for (const [from, to] of [[stlViewer, viewer], [viewer, stlViewer]]) {
  from.controls.addEventListener('change', () => {
    if (following) return;
    following = true;
    to.camera.position.copy(from.camera.position);
    to.camera.quaternion.copy(from.camera.quaternion);
    to.controls.target.copy(from.controls.target);
    to.controls.update();
    following = false;
  });
}

// The first screen already shows a part made into a STEP: a plate with holes and a countersink.
void (async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${SAMPLE}`);
    if (!res.ok) throw new Error(String(res.status));
    void open(await res.arrayBuffer(), SAMPLE);
  } catch {
    status.set('Drop an STL on the right.');
  }
})();
