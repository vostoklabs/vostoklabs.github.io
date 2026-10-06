// One template, one screen, in the house three columns: the settings on the left in named
// categories (the font among them), the part in the middle, what you TYPE on the right with the
// download under it — the shape every shipped generator has, so nothing here has to be learnt
// twice. The header is the template's name and nothing else; nothing is printed under the
// Download button.
import {
  appShell,
  ICONS,
  topbarLinks,
  generatorHeader,
  sidebarFooter,
  busyChip,
  stageStatus,
  button,
  panelCredit,
  toast,
  dialog,
  licenseAfterExport,
  el,
  buildLoop,
  markProject,
  readProjectFile,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { downloadFile } from '@vostok/export';
import {
  MAKERLAB,
  initMakerlab,
  isEmbedded,
  isReady,
  can,
  sdkExport,
  isExportCancelled,
  sdkToast,
} from 'virtual:makerlab';
import { HOST_LICENCE_NOTE, exportToHost, type HostLink } from '@vostok/export/makerlab';
import { coverDataUrl, cutExport, cutFileStem, cutZip, readmeText } from './export/makerlabArtifacts';
import { build } from './engine/engine';
import { mergeBatch, sheetOf, sheetsClause } from './engine/batch';
import type { BuildInput, BuildOutput, KeyringSpec } from './engine/types';
import { coerceValues, defaultsOf, type TemplateDef, type Values } from './templates';
import { lines, str } from './templates/types';
import { keyringFrom } from './templates/keyring';
import { renderForm } from './form';
import { createPreview } from './preview';
import { buildLaserStudioSvg, downloadCutFiles } from './export/laserSvg';
import { units } from './units';
import { CHANGELOG } from './changelog';

export interface EditorOptions {
  template: TemplateDef;
  values?: Values;
  onBack(): void;
  /** Open another template (a loaded project names one). */
  onSwitch(id: string, carry: Values): void;
}

/** The glue, as the shelf's `exportToHost` takes it. In every build but the embedded one these
 *  are the stub's no-ops, and `MAKERLAB` keeps the call from ever being made. */
const HOST: HostLink = {
  isEmbedded, isReady, can, isCancelled: isExportCancelled, hostToast: sdkToast,
  connect: () => initMakerlab(),
  send: (options) => sdkExport(options),
};

/** A Laser Studio project file: the template it was made with and its values, with `app` in
 *  front. A file saved before `app` was written carries both keys, so it still opens; another
 *  generator's file, or `{}`, is refused. */
const PROJECT = { app: 'laser-studio', keys: ['template', 'values'] } as const;

/** One build as the screen shows it: what the template asked for, and what the worker made of it. */
interface Built { input: BuildInput; output: BuildOutput }

/** The next painted frame, or a quarter of a second, whichever comes first: a page that is not
 *  painting (a tab in the background) gets no frame at all, and must not stop building for it. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 250);
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(fallback); resolve(); }, 0));
  });

export function createEditor(opts: EditorOptions): HTMLElement {
  const t = opts.template;
  const values: Values = opts.values ? coerceValues(t, opts.values) : defaultsOf(t);
  const hasKeyring = t.fields.some((f) => f.key === 'ringMode');
  const keyring = (): KeyringSpec | null => (hasKeyring ? keyringFrom(values) : null);

  const status = stageStatus('Starting the geometry engine…');
  const stageHost = el('div', { className: 'ls-stage' });
  const preview = createPreview(stageHost, {
    onHoleLive: (text) => status.set(text, 'idle'),
    onHoleCommit: (hole) => {
      values.ringDx = +hole.dx.toFixed(2);
      values.ringDy = +hole.dy.toFixed(2);
      form.sync();
      rebuild(true);
    },
  });
  preview.root.append(status.root);
  // The rebuild indicator. The status line's "Building…" was the only sign of work, and a heavy
  // template (the family crossword) builds on the main thread — the text never got a frame to
  // paint in before the work started, so the preview just froze with no loading indicator.
  // The chip waits 180 ms so a fast build never flashes it.
  const busy = busyChip({ defaultText: 'Building…', delay: 180 });
  preview.root.append(busy);

  // -- the file's one line ------------------------------------------------------------------
  // Shown in the Export Preview's legend and nowhere else. Blue is the one colour a beginner
  // gets wrong — a score left set to Cut drops the piece out of the sheet in bits — so a build
  // that scores says so there, after the template's own sentence when it has one. A template
  // whose sentence depends on its settings gives a function; it is resolved on every describe.
  const SCORE_NOTE = 'Set the blue lines to Score, not Cut, in your laser software.';
  const ownNote = () => (typeof t.exportNote === 'function' ? t.exportNote(values) : t.exportNote) ?? '';
  const fileNoteFor = (scores: boolean) => [ownNote(), scores ? SCORE_NOTE : ''].filter(Boolean).join(' ');

  function describe(out: BuildOutput) {
    const ops = Array.from(new Set(out.objects.map((o) => o.op)));
    preview.setNote(fileNoteFor(ops.includes('score')));
    if (!out.objects.length) { status.set('Nothing to cut yet — type something.', 'warn'); return; }
    const warn = out.warnings[0] ?? '';
    // The template's own clause ("24 cards · 2 sheets") beats the generic piece count; a run laid
    // on sheets says how many unless the clause already did.
    const pieces = out.status ? ` · ${out.status}` : out.parts.length > 1 ? ` · ${out.parts.length} pieces` : '';
    status.set(`${units.formatSize(out.bbox.maxX - out.bbox.minX, out.bbox.maxY - out.bbox.minY)}${pieces}${sheetsClause(out)} · ${ops.join(' + ')}${warn ? ` · ${warn}` : ''}`, warn ? 'warn' : 'idle');
  }
  // -- rebuild: the kit's build loop -------------------------------------------------------
  /**
   * What to build: the design once, or — in Batch — once per name, merged into one run laid out
   * on the chosen sheet. Every setting reaches every copy because every copy is built from the
   * same values with one text field swapped; that includes the keyring drag, which writes
   * `ringDx`/`ringDy`.
   */
  async function buildInput(): Promise<BuildInput> {
    const b = t.batch;
    if (!b || values.__batch !== true) return t.build(values);
    const names = lines(values, '__batchLines');
    if (!names.length) return t.build(values);
    // `__batchIndex` is the copy's place in the run — the only thing that tells two copies of the
    // same name apart (the gift tag steps its snowflake along it).
    const inputs = await Promise.all(names.map((n, i) => t.build({ ...values, [b.key]: n, __batchIndex: i })));
    return mergeBatch(inputs, names, sheetOf(str(values, '__sheet')), b.noun, values.__colours === 'together' ? 'together' : 'separate');
  }

  // One build at a time, at most one more waiting behind it, always from the values as they are
  // when it starts; a burst of edits within 120 ms is one build. `settled()` is the design on
  // screen, for the export.
  // A worker that never answers is the engine's to give up on (`build`'s deadline grows with the
  // run), so the loop itself sets no time limit.
  const loop = buildLoop<Built>({
    debounceMs: 120,
    run: async () => {
      // One painted frame before the build starts, so the chip is on screen before any
      // synchronous template work can hold the main thread.
      await nextFrame();
      const input = await buildInput();
      return { input, output: await build(input) };
    },
    onStart: () => {
      status.set('Building…', 'busy');
      busy.show();
    },
    onResult: ({ input, output }) => {
      try {
        // How many colours the design is cut from: Batch offers to separate them when it is more than one.
        form.setColourCount(new Set([input.material ?? 'light', ...(input.parts ?? []).map((p) => p.material ?? 'light')]).size);
        // No Ring control (a design with its own fixed hole — pet tag, matching keychains) →
        // no drag handle: a drag would write ringDx/ringDy the form does not declare and snap
        // back.
        preview.render(output, hasKeyring ? keyring() : null);
        describe(output);
      } catch (err) {
        // Drawing what was built failed: said as a failed build is, not left on "Building…".
        failed(err as Error);
      }
    },
    onError: (err) => failed(err),
    onIdle: () => busy.hide(),
  });
  function failed(err: Error) {
    status.set(`Could not build it: ${err.message}`, 'error');
    console.error(err);
  }
  /** The values changed: build them, now or after the quiet time. */
  function rebuild(immediate = false) {
    loop.request();
    if (immediate) loop.flush();
  }
  // The design's size in the new unit; after a build that failed, its message stays on the line.
  const stopUnits = units.onChange(() => {
    const shown = loop.latest;
    if (shown && !loop.error) describe(shown.output);
  });

  // -- the form ---------------------------------------------------------------------------
  const form = renderForm({
    fields: t.fields,
    values,
    ...(t.batch ? { batch: t.batch } : {}),
    onChange: (key) => {
      // A new ring mode or size changes the track the hole sits on: let the side/along echo
      // place it again rather than an exact fraction of the old outline.
      if (key === 'ringMode' || key === 'holeDia' || key === 'holeRing') values.ringPos = -1;
      rebuild();
    },
  });
  /** Everything this editor subscribed to, dropped in one place — a form still listening to the
   *  unit switch after the gallery is back re-formats controls nobody can see, and a build still
   *  queued would draw into a stage nobody can see. */
  const leave = () => { stopUnits(); form.dispose(); loop.dispose(); };
  const back = button({ label: 'All templates', icon: ICONS.arrowLeft, emphasis: 'ghost', title: 'Back to the gallery', onClick: () => { leave(); opts.onBack(); } });
  const reset = button({
    label: 'Reset this design', icon: ICONS.rotateLeft, emphasis: 'ghost',
    onClick: () => { Object.assign(values, defaultsOf(t)); form.sync(); rebuild(true); },
  });

  // -- export / save / load / help / theme, the standard footer ---------------------------

  const footer = sidebarFooter({
    // Inside the host the label starts with "Export", which the kit passes through untouched:
    // the embedded build has no download path, the file goes to MakerLab.
    formats: [{ id: 'svg', label: MAKERLAB ? 'Export cut file' : 'SVG' }],
    onExport: async (format) => {
      if (format !== 'svg') throw new Error('Unknown format: ' + format);
      // The design on screen: a click inside the quiet time waits for the build that matches the
      // values, and a build that failed refuses the export in its own words (the panel shows the
      // message) rather than sending the design before it.
      let output: BuildOutput;
      try {
        ({ output } = await loop.settled());
      } catch (err) {
        throw new Error(`Could not build it: ${(err as Error).message}`);
      }
      if (!output.objects.length) return toast('Nothing to export yet — type something first.', { kind: 'warn' });
      const stem = (t.fileName?.(values) ?? t.id).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || t.id;

      if (MAKERLAB) {
        /* The embedded build has no download path and no outbound links, so there is no
           download fallback and no licence modal: the licence rides in the artifact's
           description, in the README inside the zip, and in the toast below, in words. */
        const svg = buildLaserStudioSvg(output, import.meta.env.VITE_BUILD_ID);
        const scores = output.objects.some((o) => o.op === 'score');
        // One stem for the zip and the SVG in it (the stem can be the customer's own text).
        const fileStem = cutFileStem(stem, t.id);
        const sent = await exportToHost(
          HOST,
          { status: (text, kind) => status.set(text, kind), toast: (text, kind) => toast(text, { kind }) },
          async () => cutExport({
            fileName: `${fileStem}.zip`,
            buffer: cutZip({
              svg,
              svgName: `${fileStem}.svg`,
              readme: readmeText({
                design: t.name,
                fileName: `${fileStem}.svg`,
                note: fileNoteFor(scores),
                licence: HOST_LICENCE_NOTE,
                buildId: import.meta.env.VITE_BUILD_ID,
              }),
            }),
            coverImage: await coverDataUrl(svg),
            description: `${t.name}: the cut file as an SVG in millimetres, with a README of what each colour does. ${HOST_LICENCE_NOTE}`,
          }),
        );
        if (sent) {
          toast(
            `Sent ${fileStem}.zip to MakerLab: the SVG and a sheet explaining its colours. `
              + 'Free for personal use; selling what you cut needs a commercial licence.',
            { kind: 'ok' },
          );
        }
        return;
      }

      // One SVG, or — a run on more than one sheet — a zip of one per sheet with a README.
      downloadCutFiles(output, stem, { design: t.name, note: fileNoteFor(output.objects.some((o) => o.op === 'score')), buildId: import.meta.env.VITE_BUILD_ID });
      licenseAfterExport();
    },
    // The embedded build has no download path, so the kit hides Save and Open there.
    hostOwnsProjects: MAKERLAB,
    onSave: () => downloadFile(JSON.stringify(markProject(PROJECT, { template: t.id, values }), null, 2), `${t.id}.laser-studio.json`, 'application/json'),
    onLoad: (file?: File) => {
      if (!file) return;
      void readProjectFile(file, (data) => {
        const d = data as { template?: string; values?: Values };
        if (d.template && d.template !== t.id) { leave(); opts.onSwitch(d.template, d.values ?? {}); return; }
        Object.assign(values, coerceValues(t, d.values));
        form.sync();
        rebuild(true);
        toast('Project loaded', { kind: 'ok' });
      }, PROJECT);
    },
    onHelp: () =>
      dialog({
        title: 'Laser Studio help',
        content: el('div', {}, [
          el('p', { text: 'Type on the right. The categories on the left hold every setting, the font included; hover a "?" for what a control decides.' }),
          el('p', { text: '3D Preview shows the piece put together; drag to orbit. Export Preview is the file itself: red lines cut, blue lines score, black fills engrave.' }),
          el('p', {
            text: MAKERLAB
              // No Save/Open and no download path in the embedded build — so the sentence
              // that describes them would be describing buttons that are not on screen.
              ? 'Drag the dashed ring on the preview to move the hole; arrow keys nudge it. Export cut file sends the SVG to MakerLab, in millimetres, zipped with a sheet saying what each colour does.'
              : 'Drag the dashed ring on the preview to move the hole; arrow keys nudge it. Download SVG saves millimetres, ready for Bambu Suite or any laser software that reads SVG. Save keeps your settings as a small file you can load again.',
          }),
        ]),
        actions: [{ label: 'Got it', primary: true }],
      }),
    themeStorageKey: 'laser-studio-theme',
  });

  // The name alone. The blurb is on the gallery card, where it helps choose; here it was one
  // of three lines of copy above the first control.
  const header = generatorHeader({ title: t.name, hideCredit: true });

  const shell = appShell({
    // The embedded build has no outbound links; the host owns navigation and draws its own
    // chrome (invariant #7).
    topbar: MAKERLAB ? undefined : topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
    left: {
      header: [back, header],
      scroll: [form.left],
      footer: [reset],
      // In the embedded build the byline is text, not a link: the embedded build has no
      // outbound links; the host owns navigation.
      credit: panelCredit({ title: 'Laser Studio', hostOwnsLinks: MAKERLAB, updates: { entries: CHANGELOG, title: 'Updates' } }),
    },
    stage: [stageHost],
    right: {
      scroll: [form.right],
      footer: [footer],
    },
  });
  shell.root.classList.add('ls-editor');
  rebuild(true);
  return shell.root;
}
