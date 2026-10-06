// Model mode, wired: the controller between the store, the worker, the viewer and the panel.
//
// Kept out of mount.ts on purpose. mount.ts owns every mode's plumbing and is already the
// largest file in the app; the Model-mode half is one object with a handful of entry points that
// mount.ts calls at the places it already has (rebuild, the worker's replies, the part click, the
// window drop), so a reader can see the whole mode in one file.
//
// The three ways a model becomes a clicker are shown as pictures of the user's own model cut each
// way. The one on screen draws its own card after every build; the other two are built in the
// background — the same worker, a correlated request, never the viewport — whenever what they
// would show has changed. A fresh upload tries Split first and, if the switch does not fit that
// way, moves itself to Button, then to Stand, which always works.
import { stageHandle } from '@vostok/ui-kit';
import { FILAMENTS, type ClickerPart, type GeometryRequest, type RGB } from '../types';
import type { UiState } from './ui';
import type { CutterOverlay, Viewer } from '../viewer/viewer';
import { createModelPanel, type ModelPanel } from './modelPanel';
import type { CutterKind, ModelCutParams, ModelInfo, ModelMeta } from '../model/types';
import { FIRST_SAMPLE, sampleById, sampleFile, type SampleId } from '../model/samples';
import { modelFormatOf } from '@vostok/export/read';
import { assetUrl } from '../assets';

interface Store {
  get(): UiState;
  set(patch: Partial<UiState>): void;
}

export interface ModelModeDeps {
  store: Store;
  /** Send to the geometry worker. A function rather than the Worker, because mount.ts creates
   *  this controller before it creates the worker. */
  post(msg: GeometryRequest, transfer?: Transferable[]): void;
  /** A build that answers the caller instead of the viewport: a result card's picture. Rejects
   *  when the build fails. */
  buildDetached(params: ModelCutParams): Promise<{ parts: ClickerPart[]; warnings: string[] }>;
  viewer: Viewer;
  /** The stage (`.vl-stage`): the cut's grip floats on it. The preview's switches are the bar
   *  under the title, the same in every mode. */
  stage: HTMLElement;
  /** mount.ts's own debounced rebuild; `live` for a slider still moving. */
  rebuildSoon(live: boolean): void;
  /** The next build is a new subject: frame the camera on it. */
  reframeNext(): void;
  /** Start a fresh undo baseline at the next build (a new model is a new document). */
  resetHistoryNext(): void;
  /** The shared colour popover the rest of the app opens on a part click. */
  showColorPopoverAt(x: number, y: number, currentHex: string, options: RGB[], h: { onSelect: (hex: string) => void; onClose?: () => void }): void;
}

/** How far apart Exploded pulls a model's pieces, mm: enough to see the switch between them.
 *  The image clicker's gap grows with its height, and a 45 mm model's top then leaves the frame. */
const EXPLODE_GAP = 16;

/** Largest file the mode will read, bytes. A 100 MB STL is two million triangles — well past
 *  anything a clicker needs, and past what a phone's tab will survive parsing. */
const MAX_BYTES = 100 * 1024 * 1024;

/** A result card's picture, px square: its 76 px slot at twice the resolution, and big enough
 *  for a sample tile too — those pictures are made by this same render. */
const PICTURE_PX = 192;

/** The order a fresh upload tries the results in, and the order the cards are drawn in. */
const CUTTERS: CutterKind[] = ['slice', 'button', 'stand'];

const mm = (v: number) => v.toFixed(1).replace(/\.0$/, '');

export function createModelMode(deps: ModelModeDeps) {
  const { store, viewer } = deps;
  type Loaded = { name: string; bytes: ArrayBuffer | null; sample: SampleId | null };
  /** What the worker currently has cached; null until the first model or sample lands. */
  let loaded: Loaded | null = null;
  /** A load in flight, so a build is not posted against the previous model meanwhile. */
  let loading = false;
  /** What the load in flight replaces: the model the worker still holds, the tab it was on, and
   *  what the panel said of it. A load that fails puts them back, so the design on screen stays
   *  the loaded one through the next edit, and Export names and credits it. Null when no load is
   *  in flight. */
  let before: (Pick<UiState, 'importMode' | 'modelInfo' | 'modelMeta'> & { loaded: Loaded | null }) | null = null;
  /** Set when a saved project is reopened: its cut settings are the point, so the model that
   *  arrives for it must not reset them the way a fresh upload does. */
  let keepCutOnce = false;
  /** Bumped per model, so a card built for the last one never lands on this one. */
  let modelToken = 0;
  /** A fresh upload's cutter is still being chosen for it (Split, else Button, else Stand). */
  let autoPick = false;
  /** Said once, on the next clean build, when the choosing moved off Split. */
  let autoPickNote: string | null = null;
  let lastBuildQuiet = false;
  let previewTimer = 0;
  /** Per card: what its picture was drawn from, what is being built for it, and what that build
   *  had to say (the choosing reads it). The pictures themselves live on the cards. */
  const pictureKeys: Record<CutterKind, string | null> = { slice: null, stand: null, button: null };
  const inflight: Record<CutterKind, string | null> = { slice: null, stand: null, button: null };
  const results: Record<CutterKind, { key: string; warnings: string[] } | null> = { slice: null, stand: null, button: null };
  let lastOverlayKey = '';
  let lastPickMode: 'part' | 'surface' | '' = '';
  let wasActive: boolean | null = null;

  const panel: ModelPanel = createModelPanel({
    initial: store.get(),
    onFile: (file) => void loadFile(file),
    onSample: (id) => void loadSample(id),
    setCut: (next, live) => {
      // A card picked by hand ends the choosing: the user's pick wins.
      if (next.cutter !== store.get().modelCut.cutter) autoPick = false;
      store.set({ modelCut: next });
      deps.rebuildSoon(!!live);
    },
  });

  // ---- The stage: the cut's grip, on the model ----
  const grip = stageHandle({ label: '', title: 'Drag to move the cut', onStep: (d) => stepHeight(d) });
  deps.stage.append(grip);
  viewer.setPlaneHandle(grip);

  /** The parameters the worker cuts with: the mode's own settings plus the three fit controls
   *  it shares with every other mode (Body & fit), so "Switch stem fit" means one thing. */
  function params(s: UiState): ModelCutParams {
    return { ...s.modelCut, tolerance: s.tolerance, stemFitMm: s.stemFitMm, socketFitPct: s.socketFitPct, travel: 4.0 };
  }

  /** Everything a card's picture depends on: the model, how it is sized and turned, the fits,
   *  the colours, and that result's own settings — never another result's. */
  function pictureKey(cutter: CutterKind, s: UiState): string {
    const c = s.modelCut;
    const own = cutter === 'slice' ? [c.slice, c.switchNudge] : cutter === 'stand' ? [c.stand] : [c.button, c.switchNudge.rotation];
    return JSON.stringify([modelToken, c.sizeMm, c.rotation, c.flattenMm, c.colors, s.tolerance, s.stemFitMm, s.socketFitPct, own]);
  }

  /** A new model: every card goes back to being made, and nothing built for the last one counts. */
  function resetCards() {
    modelToken++;
    clearTimeout(previewTimer);
    for (const c of CUTTERS) {
      panel.setPicture(c, null);
      pictureKeys[c] = null;
      inflight[c] = null;
      results[c] = null;
    }
  }

  /** A load starts: keep what it replaces, unless a load already in flight kept it first. */
  function keepBefore(): void {
    if (loading) return;
    const s = store.get();
    before = { loaded, importMode: s.importMode, modelInfo: s.modelInfo, modelMeta: s.modelMeta };
  }

  /** A load failed: what it was to replace is the loaded model again, on its tab. Returns the
   *  state to put back. */
  function putBack(): Partial<UiState> {
    const back = before;
    before = null;
    loaded = back ? back.loaded : null;
    return back ? { importMode: back.importMode, modelInfo: back.modelInfo, modelMeta: back.modelMeta } : { modelInfo: null };
  }

  async function loadFile(file: File): Promise<void> {
    if (!modelFormatOf(file.name)) {
      store.set({ status: 'That is not a 3D model. Use an STL, 3MF or OBJ file.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      store.set({ status: `That file is ${(file.size / 1048576).toFixed(0)} MB — the limit is 100 MB. Simplify it first.` });
      return;
    }
    const bytes = await file.arrayBuffer();
    keepBefore();
    // A copy stays here for the project file; the worker gets its own, transferred.
    loaded = { name: file.name, bytes, sample: null };
    loading = true;
    store.set({ importMode: 'model', building: true, status: `Reading ${file.name}…`, modelMeta: null });
    const copy = bytes.slice(0);
    deps.post({ type: 'importModel', bytes: copy, name: file.name }, [copy]);
  }

  /** A sample is a file too: fetched from the app's own assets and read like an upload. */
  async function loadSample(id: SampleId): Promise<void> {
    const sample = sampleById(id) ?? sampleById(FIRST_SAMPLE)!;
    const mine = { name: sample.label, bytes: null, sample: sample.id };
    keepBefore();
    loaded = mine;
    loading = true;
    store.set({ importMode: 'model', building: true, status: 'Loading sample…', modelMeta: null });
    try {
      const res = await fetch(assetUrl(sampleFile(sample.id)));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (loaded !== mine) return; // another model was asked for while this one came
      // Named by its file for the reader, which goes by the extension; shown by its label.
      deps.post({ type: 'importModel', bytes, name: `${sample.id}.3mf` }, [bytes]);
    } catch (err) {
      if (loaded !== mine) return;
      console.error('[model] sample', err);
      loading = false;
      store.set({ ...putBack(), building: false, status: 'Could not load that sample.' });
    }
  }

  /** On entering the mode: build what is loaded, or open on a sample rather than on nothing. */
  function enter(): void {
    if (!loaded) void loadSample(FIRST_SAMPLE);
    else build();
  }

  /** Post a build. `quiet` for a control still moving: the status says so, but the viewport's
   *  loading overlay stays down, the same as the image clicker's live edits. */
  function build(quiet = false): void {
    if (loading) return; // the load's reply triggers the build
    if (!loaded) {
      enter();
      return;
    }
    // The cards wait for the viewport: their builds would queue in front of this one.
    clearTimeout(previewTimer);
    lastBuildQuiet = quiet;
    const s = store.get();
    store.set(quiet ? { status: 'Cutting the model…' } : { building: true, status: 'Cutting the model…' });
    deps.post({ type: 'buildModel', params: params(s) });
  }

  /** The worker has the model. Positions picked on a previous model mean nothing on this one;
   *  a sample opens the way its tile shows it; an upload starts on Split and is chosen for. */
  function onModelInfo(raw: ModelInfo): void {
    loading = false;
    before = null;
    // The cards go with the model they were built for: only now, so a load that fails leaves
    // those of the model still loaded.
    resetCards();
    const sample = loaded?.sample ? sampleById(loaded.sample) : undefined;
    const info = sample ? { ...raw, name: sample.label } : raw;
    const c = store.get().modelCut;
    const longest = Math.max(...info.sizeMm);
    // As imported when that is a clicker-sized thing; otherwise the mode's default size, and
    // the status says so. No units dialog: Size is one slider, and it is the answer either way.
    const sizeMm = longest >= 25 && longest <= 150 ? Math.round(longest) : 45;
    const notes = [...info.notes];
    autoPickNote = null;
    if (keepCutOnce) {
      keepCutOnce = false;
      autoPick = false;
      store.set({ modelInfo: { ...info, notes } });
      deps.reframeNext();
      build();
      return;
    }
    if (sizeMm !== Math.round(longest)) notes.push(`Scaled to ${sizeMm} mm — change it under Model.`);
    const preset = sample?.preset;
    autoPick = !preset;
    store.set({
      modelInfo: { ...info, notes },
      modelCut: {
        ...c,
        sizeMm,
        rotation: [0, 0, 0],
        flattenMm: null,
        cutter: preset?.cutter ?? 'slice',
        slice: preset?.slice ?? { heightMm: null, hideSeam: true },
        stand: preset?.stand ?? c.stand,
        button: { ...c.button, x: null, y: null },
        switchNudge: { x: 0, y: 0, rotation: 0 },
      },
    });
    deps.reframeNext();
    deps.resetHistoryNext();
    build();
  }

  /** A worker error while a model was loading is an import failure: say it plainly and forget
   *  the file, so the next build does not run against a model that never arrived. What it was
   *  to replace is loaded again, on its tab: the worker still holds that model and the screen
   *  still shows its design, so the next edit cuts it, and Export names and credits it as before.
   *  The status says so, so the design on screen is not taken for the file that failed. */
  function onError(message: string): boolean {
    if (!loading) return false;
    loading = false;
    const reason = message.split('\n')[0].replace(/^\w*Error:\s*/, '').replace(/[.\s]+$/, '');
    store.set({ ...putBack(), building: false, status: `Could not open that model: ${reason}. The design on screen is unchanged.` });
    return true;
  }

  /** The viewport's build is back. `warnings` are what it had to say. */
  function onParts(meta: ModelMeta, warnings: string[]): void {
    const s = store.get();
    const want = s.modelCut.slice.heightMm;
    // A cut asked for where the switch cannot go was built at the nearest height it can. Say so
    // with the slider and the plane rather than leave them showing a cut that was not made.
    if (s.modelCut.cutter === 'slice' && want !== null && meta.cutHeightMm !== null
      && Math.abs(meta.cutHeightMm - want) > 0.25) {
      store.set({
        modelMeta: meta,
        modelCut: { ...s.modelCut, slice: { ...s.modelCut.slice, heightMm: Math.round(meta.cutHeightMm * 2) / 2 } },
      });
    } else {
      store.set({ modelMeta: meta });
    }
    if (warnings.length) autoPickNote = null;

    const now = store.get();
    const cutter = now.modelCut.cutter;
    const key = pictureKey(cutter, now);
    results[cutter] = { key, warnings };
    // The card of the result on screen, drawn from the screen once mount.ts has seated these
    // parts there — which it does straight after this returns, in the same task.
    queueMicrotask(() => {
      const after = store.get();
      if (after.importMode !== 'model' || after.fitTestActive || after.modelCut.cutter !== cutter) return;
      const src = viewer.renderThumbnail(PICTURE_PX);
      if (src) {
        panel.setPicture(cutter, src);
        pictureKeys[cutter] = key;
      }
    });
    // Split fits, or the user has already chosen: nothing left to choose.
    if (autoPick && (cutter !== 'slice' || warnings.length === 0)) autoPick = false;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(buildCards, lastBuildQuiet ? 700 : 120);
  }

  /** Build the two results not on screen, where what they would show has changed. */
  function buildCards(): void {
    const s = store.get();
    if (s.importMode !== 'model' || loading || !loaded) return;
    const token = modelToken;
    for (const cutter of CUTTERS) {
      if (cutter === s.modelCut.cutter) continue;
      const key = pictureKey(cutter, s);
      if (pictureKeys[cutter] === key || inflight[cutter] === key) continue;
      inflight[cutter] = key;
      void deps.buildDetached({ ...params(s), cutter }).then(
        (r) => {
          if (inflight[cutter] === key) inflight[cutter] = null;
          if (token !== modelToken || store.get().importMode !== 'model') return;
          results[cutter] = { key, warnings: r.warnings };
          const src = viewer.renderThumbnail(PICTURE_PX, r.parts);
          if (src) {
            panel.setPicture(cutter, src);
            pictureKeys[cutter] = key;
          }
          choose();
        },
        // The card keeps no picture. It stays marked as asked for, so these settings, which
        // would fail the same way, are not built again until what the card shows changes.
        () => {},
      );
    }
  }

  /** Split did not fit this upload (or the choosing would have stopped). Button if it builds
   *  clean, else Stand, which always does. Waits for Button's result to come back. */
  function choose(): void {
    if (!autoPick) return;
    const s = store.get();
    if (s.modelCut.cutter !== 'slice') {
      autoPick = false;
      return;
    }
    const b = results.button;
    if (!b || b.key !== pictureKey('button', s)) return;
    autoPick = false;
    const next: CutterKind = b.warnings.length === 0 ? 'button' : 'stand';
    autoPickNote = next === 'button'
      ? 'The switch does not fit a split through this model, so it has a button on top.'
      : 'The switch does not fit inside this model, so it stands on a clicker base.';
    store.set({ modelCut: { ...s.modelCut, cutter: next } });
    deps.rebuildSoon(false);
  }

  /** The status line for a build with nothing to warn about: what it is, and that it works. */
  function cleanStatus(meta: ModelMeta): string {
    const [w, d, h] = meta.sizeMm;
    const line = `${w.toFixed(0)} × ${d.toFixed(0)} × ${h.toFixed(0)} mm · button ${Math.max(1, Math.round(meta.movingGrams))} g · ✓ fits an MX switch`;
    const note = autoPickNote;
    autoPickNote = null;
    return note ? `${note} ${line}` : line;
  }

  /** The grip's arrow keys: half a millimetre a press, inside the heights the switch fits at. */
  function stepHeight(d: 1 | -1): void {
    const s = store.get();
    if (s.importMode !== 'model' || s.modelCut.cutter !== 'slice') return;
    const now = s.modelCut.slice.heightMm ?? s.modelMeta?.cutHeightMm;
    if (now === null || now === undefined) return;
    const [lo, hi] = s.modelMeta?.cutRangeMm ?? [0, s.modelMeta?.sizeMm[2] ?? now];
    const z = Math.round(Math.min(hi, Math.max(lo, now + d * 0.5)) * 2) / 2;
    store.set({ modelCut: { ...s.modelCut, slice: { ...s.modelCut.slice, heightMm: z } } });
    deps.rebuildSoon(true);
  }

  /** Keep the viewer's cutter and tap behaviour in step with the state. Called on every store
   *  change, so it only touches the viewer when something it draws has actually moved. */
  function sync(s: UiState): void {
    const active = s.importMode === 'model';
    // Here rather than at each way in (the tab, a dropped file, a project, an undo): this is the
    // one place every one of them passes through.
    if (active !== wasActive) {
      viewer.setExplodeGap(active ? EXPLODE_GAP : null);
      wasActive = active;
    }
    const mode = active && s.modelCut.cutter === 'button' ? 'surface' : 'part';
    if (mode !== lastPickMode) {
      viewer.setPickMode(mode);
      lastPickMode = mode;
    }
    const overlay = active ? overlayFor(s) : null;
    const key = JSON.stringify(overlay);
    if (key !== lastOverlayKey) {
      viewer.setCutterOverlay(overlay);
      lastOverlayKey = key;
    }
    if (active && overlay?.kind === 'plane') grip.setLabel(`${mm(overlay.z)} mm`);
    panel.update(s, loaded?.sample ?? null);
  }

  function overlayFor(s: UiState): CutterOverlay | null {
    const meta = s.modelMeta;
    if (!meta) return null;
    const [w, d, h] = meta.sizeMm;
    const c = s.modelCut;
    if (c.cutter === 'slice') {
      const z = c.slice.heightMm ?? meta.cutHeightMm;
      if (z === null) return null;
      return { kind: 'plane', z, minX: -w / 2, maxX: w / 2, minY: -d / 2, maxY: d / 2 };
    }
    if (c.cutter === 'button' && meta.buttonAt) {
      return {
        kind: 'column',
        x: c.button.x ?? meta.buttonAt.x,
        y: c.button.y ?? meta.buttonAt.y,
        shape: c.button.shape,
        size: c.button.sizeMm,
        rotation: c.switchNudge.rotation,
        z0: meta.switchAt.z - 8,
        z1: h + 2,
      };
    }
    return null;
  }

  // The cut plane dragged in the viewport, by the sheet or by its grip: follow it live, cut when
  // it is let go.
  viewer.onPlaneDrag((z, done) => {
    const s = store.get();
    if (s.importMode !== 'model') return;
    const [lo, hi] = s.modelMeta?.cutRangeMm ?? [0, s.modelMeta?.sizeMm[2] ?? z];
    const clamped = Math.round(Math.min(hi, Math.max(lo, z)) * 2) / 2;
    store.set({ modelCut: { ...s.modelCut, slice: { ...s.modelCut.slice, heightMm: clamped } } });
    if (done) deps.rebuildSoon(false);
  });

  // A tap on the model, with the Button cutter: the button goes there.
  viewer.onSurfacePick((x, y) => {
    const s = store.get();
    if (s.importMode !== 'model' || s.modelCut.cutter !== 'button') return;
    store.set({ modelCut: { ...s.modelCut, button: { ...s.modelCut.button, x, y } } });
    deps.rebuildSoon(false);
  });

  /** A part clicked in the viewport, in Model mode: recolour that piece. The image clicker's
   *  palette machinery does not apply — these parts are named by role, not by colour region. */
  function pickPart(part: ClickerPart | undefined, clientX: number, clientY: number): void {
    if (!part) return;
    const which: keyof ModelCutParams['colors'] =
      part.name === 'base-body' ? 'body' : part.name === 'top-model' && store.get().modelCut.cutter === 'stand' ? 'model' : 'top';
    const toHex = (rgb: RGB) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    deps.showColorPopoverAt(clientX, clientY, toHex(part.colorRgb), FILAMENTS.map(([, h]) => fromHex(h)), {
      onSelect: (hex) => {
        const s = store.get();
        store.set({ modelCut: { ...s.modelCut, colors: { ...s.modelCut.colors, [which]: fromHex(hex) } } });
        deps.rebuildSoon(false);
      },
    });
  }

  /** What the export is called: the model's own file name. */
  function fileLabel(): string {
    return (loaded?.name ?? 'model').replace(/\.(stl|3mf|obj)$/i, '');
  }

  /** The loaded model, for a project file: the upload's bytes, or which sample it was. */
  function snapshot(): { name: string; bytes: ArrayBuffer | null; sample: SampleId | null } | null {
    return loaded;
  }

  /** Bring a saved model back: re-import its bytes, or reload its sample. Settles once it is on
   *  its way to the worker (or failed to get there). */
  function restore(saved: { name: string; bytes: ArrayBuffer | null; sample: SampleId | null }): Promise<void> {
    keepCutOnce = true;
    if (saved.sample) return loadSample(saved.sample);
    if (saved.bytes) return loadFile(new File([saved.bytes], saved.name));
    return Promise.resolve();
  }

  return {
    panel,
    enter,
    build,
    loadFile,
    onModelInfo,
    onError,
    onParts,
    cleanStatus,
    sync,
    pickPart,
    fileLabel,
    snapshot,
    restore,
    isLoaded: () => loaded !== null,
    /** A model or sample is on its way in; its build follows it. */
    isLoading: () => loading,
  };
}

export type ModelMode = ReturnType<typeof createModelMode>;
