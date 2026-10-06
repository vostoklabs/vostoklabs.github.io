import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  sidebarFooter,
  setExportNote,
  section,
  collapsibleSection,
  sourceCards,
  modeBar,
  stagePanel,
  stageStatus,
  diagnosticsList,
  assertExportable,
  button,
  slider,
  sliderRow,
  stepperRow,
  toggleSwitch,
  segmentedControl,
  selectField,
  setFieldOptions,
  syncControls,
  textField,
  fontPicker as kitFontPicker,
  dropZone,
  symbolPickerButton,
  toast,
  dialog,
  readProjectFile,
  markProject,
  changelogButton,
  closeAllDialogs,
  closeAllDrawers,
  licenseAfterExport,
  bindExternalLinks,
  el,
  type DesktopHost,
  type ProjectShape,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { FALLBACK_FONT_ID, FONTS, SYMBOL_GROUPS, fontFamilyFor, getFontUrl, searchGroup } from '@vostok/fonts';
import { LOGO_FEATURED, LOGO_FONTS, LOGO_TEXT_FONTS } from './logoFonts';
import {
  DEFAULT_PARAMS,
  MACHINES,
  SHEETS,
  STOCKS,
  type Artwork,
  type BoxParams,
  type FoldMode,
  type LogoKind,
  type Op,
  type Panel,
  type SolveResult,
  type StyleId,
} from './types';
import { OP_COLOR } from './export/paths';
import { solve, fitToSheet, machineById, sheetById, stockById, type SizeLimits } from './geometry/solve';
import { logoFaces } from './geometry/marks';
import { readText, svgArtwork, textArtwork } from './ui/artwork';
import { openSvgWizard } from './ui/svgWizard';
import { STYLES, styleEcma, styleMeta, insideDims, hangModes } from './geometry/styles';
import { buildRig, type FoldRig } from './fold/rig';
import { createFlatView, styleIcon } from './ui/flatView';
import { CHANGELOG } from './changelog';
import { buildCutFiles, downloadCutFiles } from 'virtual:cut-pack';
import {
  MAKERLAB,
  initMakerlab,
  isEmbedded as mlEmbedded,
  isReady as mlReady,
  can as mlCan,
  sdkExport,
  sdkToast,
} from 'virtual:makerlab';
import {
  BLANK_COVER,
  MAKERLAB_LAYER_HEIGHT_MM,
  cutExport,
  exportNote,
  printExport,
} from './export/makerlabArtifacts';
import { buildObjMtl, bytesToArrayBuffer, downloadFile, textToArrayBuffer } from '@vostok/export';
// How long to wait for the host before the UI admits it does not know: the shelf's, one figure
// for every MakerLab app.
import { EXPORT_TIMEOUT_MS } from '@vostok/export/makerlab';
import {
  buildPrintable,
  buildPrintableFile,
  minHingeWidthMm,
  sandwichThicknessMm,
  sheetThicknessMm,
  tucksInside,
} from './export/printable';

/** What the Length, Width and Height sliders offer, mm; "Resize to fit" keeps to it too. */
const SIZE_LIMITS: SizeLimits = { min: [20, 20, 8], max: [260, 260, 200] };

/** A project file is the box's `params`: every one saved carries its style and its three sizes,
 *  so a file without them, or one another app saved, is refused on Load. */
const PROJECT_FILE: ProjectShape = { app: 'foldbox', keys: ['style', 'lengthMm', 'widthMm', 'heightMm'] };

/**
 * Builds the generator into `container` and returns its teardown.
 *
 * `host` is absent on the web, and every capability it carries has a browser fallback this
 * generator already implements — Save becomes a JSON download, Load a file picker, Export a
 * download. That is what keeps one source building for both.
 */
export function mount(container: HTMLElement, host?: DesktopHost): () => void {
  // Outbound links go to the user's real browser rather than to this window, which has no
  // address bar and so no way back. One delegated listener, and a no-op on the web.
  bindExternalLinks(host);

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups: (() => void)[] = [];

  /* The `@font-face` rules for the faces the logo offers, built from the SAME asset URLs
     `getFont` fetches the outlines from.
     `@vostok/fonts/fonts.css` would have done this in one import, and that is what the
     magnet generator and the keychain do — but it declares all 153 faces, and the offline
     build inlines every asset it can see. Narrowing the stylesheet as well as the glob
     still left two independent copies of every face in the page: 2.8 MB of base64 for
     1.1 MB of fonts. One source, both jobs.

     Registered through the FontFace API rather than written into a <style> element. The
     MakerLab host's CSP is `style-src 'self'`, and under it Chromium refuses an inline
     <style> outright: every tile would have fallen back to the system face while the glyph
     outlines, which are fetched, still came out right. A FontFace added to `document.fonts`
     is not a stylesheet, so no policy on styles applies, and it still loads lazily, the first
     time something renders in that family. One code path in every build.
     `document.fonts` outlives the container a host clears, so the faces are tracked. */
  const fontFaces: FontFace[] = [];
  for (const id of LOGO_FONTS) {
    const url = getFontUrl(id);
    if (!url) continue;
    const face = new FontFace(fontFamilyFor(id), `url("${url}")`, { display: 'block' });
    document.fonts.add(face);
    fontFaces.push(face);
  }
  cleanups.push(() => {
    for (const face of fontFaces) document.fonts.delete(face);
  });

  /** Named, and not an inline closure, because the export path hands the same hook to a second
   *  `initMakerlab` when it finds the connection down. */
  function makerlabDisconnected(): void {
    const msg = 'Disconnected from MakerLab. Reload the MakerWorld page to export again.';
    status.set(msg, 'warn');
    toast(msg, { kind: 'warn' });
  }

  /* MakerLab handshake, as early as it can go (MakerWorld build only; the stub's `MAKERLAB` is
     the literal `false` everywhere else, so this is dead code there).

     First, not last, for the reason the clicker learned: the host gives the app a short window
     to say hello, and a mount that builds the whole UI before it starts can miss it. Nothing
     here needs the UI. Every export re-checks `mlReady()` at the moment it acts, and the
     disconnect callback only runs long after `status` below exists. */
  if (MAKERLAB) {
    void initMakerlab({ onDisconnect: makerlabDisconnected }).then((ctx) => {
      if (ctx) console.log('[MakerLab] connected, capabilities:', (ctx as { capabilities?: string[] }).capabilities);
    });
  }

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

  /** Is the cut half of the app in this build? See `cutPackPlugin` in vite.config.ts:
   *  the default build is print-only and every `if (CUT)` below is compiled out of it.
   *  `pnpm dev` and `pnpm build:full` run `--mode full`. */
  const CUT = __FOLDBOX_CUT__;

  // ---------------------------------------------------------------------------
  // 1. STATE
  // ---------------------------------------------------------------------------
  // `DEFAULT_PARAMS` is written for the full app, which opens on cutting. The
  // print-only build has no cut mode to open on, and starting it on `makeMode: 'cut'`
  // with an A4 sheet selected would put a paper size under a build plate. `printOnly`
  // is the one place that correction lives — everything downstream reads `params`.
  /** Which structures the print-only build offers.
   *
   *  Three exclusions, for three different reasons. A GLUED LAP is a joint a printed
   *  sheet cannot make well — glue does not take to PLA the way it takes to board —
   *  which rules out the tuck carton, the snap-lock, the gable and the sleeve. The
   *  DIVIDER is ruled out from the other end: it is not a box at all but a set of
   *  slotted strips that hold each other up by friction, and at 0.4 mm of plastic they
   *  have neither the stiffness nor the grip that card gives them. WEBBED CORNERS are
   *  ruled out by how the sheet slices — see `StyleMeta.webbedCorners`; their hinges
   *  run at 45 degrees, which is the one direction the solid layer's own extrusions
   *  also run, so the fold comes out as bead-to-bead adhesion and splits.
   *
   *  Read off the style rather than listed by id, so a structure added later cannot
   *  quietly arrive in the print build carrying a fold the sheet cannot make. */
  function isPrintStyle(id: StyleId): boolean {
    const meta = styleMeta(id);
    return meta.glueFree && !meta.webbedCorners && id !== 'divider';
  }

  // The layer height the MakerLab build prints at, the merge flag, the placeholder cover and
  // the export note all live in `export/makerlabArtifacts.ts`, with the reasoning: they are
  // pure values, and there they are checked by `tests/makerlab.mts` rather than by eye.

  function printOnly(p: BoxParams): BoxParams {
    // Every way params arrive — defaults, a loaded project, the host's project list — comes
    // through here, so this is the one place the MakerLab lock has to live.
    if (MAKERLAB) p = { ...p, layerHeightMm: MAKERLAB_LAYER_HEIGHT_MM };
    if (CUT) return p;
    return {
      ...p,
      // A project saved with a structure this build does not offer lands on the default.
      style: isPrintStyle(p.style) ? p.style : DEFAULT_PARAMS.style,
      makeMode: 'print',
      sheetId: 'plate-256',
      filmInsert: false,
    };
  }

  let params: BoxParams = printOnly({ ...DEFAULT_PARAMS });
  let result: SolveResult | null = null;
  /** The logo as polygons, resolved once per edit rather than per solve.
   *
   *  Everything else here is synchronous — that is the whole design of this app — and a
   *  font is a fetch. So the artwork is built when the TEXT or the FACE changes, and the
   *  solve takes it as plain rings. A size slider then costs no await and no flicker. */
  let artwork: Artwork | null = null;
  /** Which artwork request is the current one. A slow font arriving after the user has
   *  typed on must not overwrite what they can see. */
  let artworkJob = 0;
  let rig: FoldRig | null = null;
  /** Master fold scrub, 0 = flat blank, 1 = closed box. */
  let progress = 1;
  let playing = false;
  let mode: 'flat' | 'fold' = 'fold';
  /** The mode the USER last asked for. A style with nothing to fold — a divider, whose
   *  parts are just slotted strips — is forced to the dieline, and without remembering
   *  the choice separately that force was permanent: picking a real box afterwards left
   *  the stage on the dieline while the pill claimed to be on Fold. */
  let wantedMode: 'flat' | 'fold' = 'fold';

  const CARD_COLORS: Record<string, { color: string; edge: string }> = {
    kraft300: { color: '#c8a273', edge: '#6d4f2c' },
    default: { color: '#eae6df', edge: '#8d867c' },
  };

  // ---------------------------------------------------------------------------
  // 2. REBUILD
  // ---------------------------------------------------------------------------
  // `ReturnType<typeof setTimeout>` rather than `number`, which is what this was: under a
  // DOM-only lib the two agree, and under a config that also has Node's types in scope —
  // which is every host that embeds this generator — `setTimeout` returns a `Timeout` and
  // the assignment does not compile. The pen topper's `rebuildTimer` has always been
  // written this way; this is the same fix, one file later.
  let rebuildQueued: ReturnType<typeof setTimeout> | undefined;

  function triggerRebuild(refit = false): void {
    clearTimeout(rebuildQueued);
    // setTimeout rather than rAF: rAF never fires in a background tab, which would
    // leave a model that silently never builds.
    rebuildQueued = setTimeout(() => rebuild(refit), 90);
  }

  function rebuild(refit: boolean): void {
    const started = performance.now();
    try {
      result = solve(params, artwork);
    } catch (err) {
      status.set(`Could not build that box: ${(err as Error).message}`, 'error');
      return;
    }

    renderLegend(flat.render(result, { showLabels, showSheet }));

    rig?.dispose();
    const skin = CARD_COLORS[params.stockId] ?? (CARD_COLORS.default as { color: string; edge: string });
    // Drawn at the thickness the net was dimensioned for. Card is one caliper
    // throughout; a printed sheet is thinner wherever a part tucks between two plies,
    // and the exporter's rule for which parts those are is the one used here, so what
    // the preview shows is what the 3MF builds.
    const p = params;
    const thickness =
      p.makeMode === 'print'
        ? (panel: Panel) => (tucksInside(panel) ? sandwichThicknessMm(p) : sheetThicknessMm(p))
        : () => p.caliperMm;
    rig = buildRig(result.net, { ...skin, thickness });
    rig.setProgress(progress);
    viewer.setFoldRig(rig.object, refit);

    renderResults(result);
    updateStatus(result, Math.round(performance.now() - started));
    syncVisibility();
    syncPlate();

    // A style with no folding panels — the divider is just slotted strips — has nothing
    // to show in the 3D view, so it would open on an empty stage. Send it to the
    // dieline, which is the only view that means anything for it.
    const foldable = result.net.panels.length > 0;
    modes.root.classList.toggle('hidden', !foldable);
    // Forced to the dieline while there is nothing to fold, and put back the moment
    // there is — otherwise one look at the dividers leaves every later style flat.
    showMode(foldable ? wantedMode : 'flat');
  }

  function setParam<K extends keyof BoxParams>(key: K, value: BoxParams[K], refit = false): void {
    params = { ...params, [key]: value };
    triggerRebuild(refit);
  }

  // ---------------------------------------------------------------------------
  // 3. SETTINGS (left panel)
  // ---------------------------------------------------------------------------
  const STYLE_OPTIONS = CUT ? STYLES : STYLES.filter((s) => isPrintStyle(s.id));

  const styleCards = sourceCards<StyleId>({
    options: STYLE_OPTIONS.map((s) => ({ value: s.id, label: s.short, icon: styleIcon(s.id) })),
    value: params.style,
    onChange: (id) => {
      params = { ...params, style: id };
      describeStyle(params);
      // A different box is a different shape, so this is the one edit that is allowed
      // to move the camera.
      triggerRebuild(true);
    },
  });
  const styleBadge = el('span', { className: 'fb-badge' });
  // The ECMA designation, shown next to the glue badge. It earns the space: it is the
  // difference between "a box shape we drew" and "the industry's own reference number
  // for this structure", and anyone selling what they cut can quote it.
  const styleCode = el('span', { className: 'fb-badge fb-badge--muted' });

  /** "Does it need glue" is the only question most people arrive with, so it is a
   *  badge on the style rather than a sentence three lines into the blurb. */
  function describeStyle(p: BoxParams): void {
    const meta = styleMeta(p.style);
    styleBadge.textContent = meta.glueFree ? 'No glue' : 'One glued lap';
    styleBadge.className = `fb-badge fb-badge--${meta.glueFree ? 'ok' : 'warn'}`;
    // Variant-aware: an option that changes the structure changes the code, and the
    // badge has to follow it or it is quietly lying.
    const ecma = styleEcma(p);
    styleCode.textContent = `ECMA ${ecma.code}`;
    // The basis matters as much as the code — "drawn in the catalogue at this code" and
    // "the nearest code to what we built" are different claims, and only the tooltip has
    // room to say which this is.
    styleCode.title =
      `${ecma.reads}\n\n` +
      (ecma.basis === 'catalogue'
        ? `Drawn in the ECMA Code of Folding Carton Design Styles at exactly this code${ecma.page ? ` (p.${ecma.page})` : ''}.`
        : ecma.basis === 'constructed'
          ? "Composed from the group's matrix table, which marks this combination possible."
          : 'The closest listed code; our structure is a derivative of it.') +
      (ecma.note ? `\n\n${ecma.note}` : '');
  }
  describeStyle(params);

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

  /** The inverse of `lenFormat`, and the reason typing a size used to be broken.
   *
   *  Every length row stores MILLIMETRES and displays whatever `lenFormat` makes of them.
   *  With no parse the two only agreed in mm: in inches the box showed `3 9/16"`, typing
   *  `4` for four inches set four MILLIMETRES (which then clamped to the slider's floor of
   *  20), and simply blurring the field re-read its own `3 9/16` as three-hundred-and-
   *  twelve. The slider worked, so it looked like the number box specifically.
   *
   *  Fractions are read, not just tolerated — Cricut's user base types "3 1/2", not 3.5,
   *  and it is what the field prints back at them. */
  function lenParse(typed: number, raw: string): number {
    if (params.units === 'mm') return typed;
    // "3 1/2", "1/2", "3 1/2\"" — a whole part is optional, and so is the fraction.
    const frac = /(-?\d+(?:\.\d+)?)?\s*(\d+)\s*\/\s*(\d+)/.exec(raw);
    if (frac) {
      const den = Number(frac[3]);
      if (den > 0) {
        const whole = frac[1] ? Number(frac[1]) : 0;
        const inches = Math.abs(whole) + Number(frac[2]) / den;
        return (whole < 0 ? -inches : inches) * 25.4;
      }
    }
    return typed * 25.4;
  }

  /** The words for each mode, per family. Which panel a tab hangs off is the whole
   *  difference between them and it is invisible on the dieline, so it goes in the label
   *  rather than buried in the help. Which modes a style actually offers comes from
   *  `hangModes` — this only supplies the wording. */
  const HANG_LABEL: Record<string, Record<string, string>> = {
    mailer: {
      none: 'None',
      single: 'Lid tab: the lid runs on past one end',
    },
    tube: {
      none: 'None',
      hole: 'Slot in the back wall',
      single: 'Header, single ply (X61)',
      double: 'Header, double ply (X62)',
    },
  };
  function hangOptions(style: StyleId): { value: string; label: string }[] {
    const words = style.startsWith('mailer') ? HANG_LABEL.mailer! : HANG_LABEL.tube!;
    return hangModes(style).map((m) => ({ value: m, label: words[m] ?? m }));
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
        showParams();
      },
    }),
    basis: segmentedControl<'inside' | 'outside'>({
      label: 'Your size is the',
      options: [
        { value: 'inside', label: 'Inside' },
        { value: 'outside', label: 'Outside' },
      ],
      value: params.dimBasis,
      help: 'Inside is what has to fit your product: the blank is grown by the card thickness on every wall it wraps. Outside is the finished box. Two free generators disagree about this, which is why it says so on screen.',
      onChange: (b) => setParam('dimBasis', b),
    }),
    length: sliderRow({
      label: 'Length',
      min: SIZE_LIMITS.min[0],
      max: SIZE_LIMITS.max[0],
      step: 1,
      value: params.lengthMm,
      format: lenFormat,
      parse: lenParse,
      onInput: (v) => setParam('lengthMm', v),
    }),
    width: sliderRow({
      label: 'Width',
      min: SIZE_LIMITS.min[1],
      max: SIZE_LIMITS.max[1],
      step: 1,
      value: params.widthMm,
      format: lenFormat,
      parse: lenParse,
      onInput: (v) => setParam('widthMm', v),
    }),
    height: sliderRow({
      label: 'Height',
      min: SIZE_LIMITS.min[2],
      max: SIZE_LIMITS.max[2],
      step: 1,
      value: params.heightMm,
      format: lenFormat,
      parse: lenParse,
      onInput: (v) => setParam('heightMm', v),
    }),

    lidHeight: sliderRow({
      label: 'Lid depth',
      min: 6,
      max: 120,
      step: 1,
      value: params.lidHeightMm,
      format: lenFormat,
      parse: lenParse,
      help: 'How far the lid comes down over the tray. A third of the box height looks right; the whole height gives you a shoe box.',
      onInput: (v) => setParam('lidHeightMm', v),
    }),
    lidPlay: sliderRow({
      label: 'Lid fit',
      min: 0.1,
      max: 1.5,
      step: 0.05,
      value: params.lidPlayMm,
      format: (v) => `${v.toFixed(2)} mm${v < 0.3 ? ' (snug)' : v > 0.8 ? ' (loose)' : ''}`,
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
      parse: lenParse,
      help: 'Auto sizes it against both the width and the height. A fixed depth, which is what the carton standards use, hangs off the end of a short box.',
      onInput: (v) => setParam('tuckDepthMm', v),
    }),
    tuckLock: selectField({
      label: 'Tuck lock',
      options: [
        { value: 'slit', label: 'Slit lock: nicks that catch' },
        { value: 'friction', label: 'Friction: plain squeeze' },
        { value: 'none', label: 'None' },
      ],
      value: params.tuckLock,
      help: 'A slit lock cuts two small nicks at the tuck shoulders that catch under the dust flaps. Without one a card box springs open on the shelf.',
      onChange: (v) => setParam('tuckLock', v),
    }),
    // Cut-only, like the four structures that need it.
    ...(CUT
      ? {
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
        }
      : {}),
    thumbNotch: toggleSwitch({
      label: 'Thumb notch',
      checked: params.thumbNotch,
      help: 'A half-circle bitten out of the tuck so a fingernail can get under it.',
      onChange: (v) => setParam('thumbNotch', v),
    }),
    handle: toggleSwitch({
      label: 'Carry handle',
      checked: params.handle,
      help: 'On a tray it raises the two long walls into grips you can pick the box up by. On the gable box it is the pair of blades that meet above the ridge, which the end ears lock over.',
      onChange: (v) => setParam('handle', v),
    }),
    handleHeight: sliderRow({
      label: 'Handle height',
      min: 20,
      max: 120,
      step: 1,
      value: params.handleHeightMm,
      format: lenFormat,
      parse: lenParse,
      help: 'How far the handle rises above the rim. The hand hole is placed well clear of the top edge; any nearer and it tears out the first time the box is carried.',
      onInput: (v) => setParam('handleHeightMm', v),
    }),

    window: toggleSwitch({
      label: 'Window',
      checked: params.window,
      help: 'An aperture in the front face. It is kept at least 15 mm clear of every fold and cut; closer than that and the panel loses its stiffness and creases where it should not.',
      onChange: (v) => setParam('window', v),
    }),
    windowScale: sliderRow({
      label: 'Window size',
      min: 0.2,
      max: 0.95,
      step: 0.01,
      value: params.windowScale,
      format: (v) => `${Math.round(v * 100)}% of the panel`,
      parse: (typed) => typed / 100,
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
    // Cut-only: `buildPrintable` skips the film part, and `printOnly` turns it off. A
    // conditional spread rather than a hidden row, so the print-only build does not
    // carry two controls it never shows and the help text that goes with them.
    ...(CUT
      ? {
          filmInsert: toggleSwitch({
            label: 'Cut a film insert too',
            checked: params.filmInsert,
            help: 'Adds a matching outline on its own layer, to cut from acetate or PET. Never cut PVC on a laser: it releases hydrogen chloride.',
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
        }
      : {}),

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
    hangTab: selectField({
      label: 'Hang tab',
      options: hangOptions(params.style),
      value: params.hangTab,
      help: 'The keyhole that hangs a package on a shop peg (ISO 15348), kept 4 mm clear of every edge so the card does not tear off it. A header is an extra panel above the box; doubled, the slot goes through two plies, which is what stops it tearing under any real weight. A header takes over the back wall’s top edge, so the lid moves to the front.',
      onChange: (v) => setParam('hangTab', v as BoxParams['hangTab']),
    }),
    windowFace: selectField({
      label: 'Window on',
      options: [{ value: '', label: 'Default' }],
      value: params.windowFace,
      help: 'Which panel the aperture is cut in. On a mailer this is how you follow the hang tab: the tab is the lid carrying on past an end, so the LID goes against the shop’s board and the base is what faces out, so put the window and the artwork there.',
      onChange: (v) => setParam('windowFace', v),
    }),
    lidWings: toggleSwitch({
      label: 'Wings on the lid',
      checked: params.lidWings,
      help: 'A flap on each short edge of the lid, folding down inside the rolled ends so the lid cannot lift at the corners. It changes the lid itself: with wings it NESTS inside the rim instead of capping over it, which is ECMA cover 53 rather than 50. An end carrying a hang tab goes without a wing, because they want the same edge.',
      onChange: (v) => setParam('lidWings', v),
    }),
    hangHole: selectField({
      label: 'Hole shape',
      options: [
        { value: 'euro', label: 'Euro slot (wide, with a round crown)' },
        { value: 'round', label: 'Round hole' },
      ],
      value: params.hangHole,
      help: 'The two a shop actually has. The euro slot is the wide low slot with a round crown on top that most European retail packaging uses. A plain round hole is what a bare peg or a J-hook wants, and it still fits panels too narrow for a slot. Both stay 4 mm clear of every edge, which is the number that stops the sheet tearing off the peg.',
      onChange: (v) => setParam('hangHole', v),
    }),
    hangEnd: selectField({
      label: 'Hangs from',
      options: [
        { value: 'left', label: 'The left end' },
        { value: 'right', label: 'The right end' },
        { value: 'both', label: 'Both ends' },
      ],
      value: params.hangEnd,
      help: 'Which short end the tab reaches past. Either way the box hangs long-side-down rather than jutting out at the customer; that is the point of putting the tab on an end rather than on a wall. Both ends keeps the blank symmetric and lets you hang it from whichever end suits the shelf.',
      onChange: (v) => setParam('hangEnd', v),
    }),
    hangTabHeight: sliderRow({
      label: 'Tab length',
      min: 0,
      max: 90,
      step: 1,
      value: params.hangTabHeightMm,
      unit: 'mm',
      help: 'How far the tab stands proud of the box. 0 derives the shortest one the slot and its keep-out actually fit in.',
      onInput: (v) => setParam('hangTabHeightMm', v),
    }),
    roofPitch: sliderRow({
      label: 'Roof pitch',
      min: 15,
      max: 60,
      step: 1,
      value: params.roofPitchDeg,
      unit: '°',
      help: 'The gable’s slope from horizontal. Everything about the roof follows from it: the rise, how long the roof panel is in the flat, and how far the ears have to lean in to catch the handle blades.',
      onInput: (v) => setParam('roofPitchDeg', v),
    }),
  };

  // ---------------------------------------------------------------------------
  // 3b. LOGO — text, a symbol, or an SVG, on one face
  // ---------------------------------------------------------------------------
  // One pipeline, three ways in. Text and symbols are both glyph outlines (the symbol
  // font is the FALLBACK face, so a heart in the text field needs no separate path), and
  // an SVG is parsed to the same rings. From there nothing downstream knows which it was:
  // `solve` places it on a face, the dieline draws it, the `.lac` engraves it and the 3MF
  // inlays it into the first layer as a second colour.

  /** Rebuild the artwork from the current settings, then the box.
   *
   *  Every failure is the user's to see — an empty field, a face with no glyphs, an SVG
   *  with nothing drawable — so it clears the logo and says why, rather than leaving the
   *  last one on screen under new settings. */
  async function refreshArtwork(): Promise<void> {
    const job = ++artworkJob;
    // Nothing to build yet is not a failure. Both of these are the state the panel OPENS
    // in when a source is picked — an empty field, an empty drop zone — and the control
    // itself is the prompt. Complaining here put "No drawable shapes in that SVG" on
    // screen the instant someone clicked SVG, before they had a chance to drop one.
    const nothingYet =
      params.logo === 'none' ||
      (params.logo === 'text' && !params.logoText.trim()) ||
      (params.logo === 'svg' && !params.logoSvg);
    if (nothingYet) {
      artwork = null;
      triggerRebuild();
      return;
    }
    try {
      const built =
        params.logo === 'text'
          ? await textArtwork(params.logoText, params.logoFont)
          : svgArtwork(params.logoSvg, params.logoSvgModes);
      if (job !== artworkJob) return;
      artwork = built;
    } catch (err) {
      if (job !== artworkJob) return;
      artwork = null;
      // Anything that gets here is a real failure with something in hand: a face with no
      // glyph for what was typed, an SVG with no drawable path in it. "Nothing yet" was
      // dealt with above and never reaches this.
      toast((err as Error).message, { kind: 'error' });
    }
    triggerRebuild();
  }

  const logoText = textField({
    label: 'Words',
    value: params.logoText,
    placeholder: 'A word or a name',
    title: 'One line. Anything the face has a glyph for, plus any symbol from the picker.',
    onInput: (v) => {
      params = { ...params, logoText: v };
      fontPicker.setSample(v.trim() || 'Your word');
      queueArtwork();
    },
  });

  /** Debounced, because every keystroke otherwise re-lays the glyphs and re-solves the
   *  box. 180 ms is under the threshold where typing feels laggy and over the gap between
   *  two keys of the same word. */
  let artworkQueued: ReturnType<typeof setTimeout> | undefined;
  function queueArtwork(): void {
    clearTimeout(artworkQueued);
    artworkQueued = setTimeout(() => void refreshArtwork(), 180);
  }
  cleanups.push(() => clearTimeout(artworkQueued));

  const logoSymbols = symbolPickerButton({
    items: searchGroup('', 'popular').map((i) => ({ id: i.id, label: i.label, char: i.char, cats: i.cats })),
    categories: SYMBOL_GROUPS.map((g) => ({ id: g.id, label: g.id === 'all' ? 'Everything' : g.label })),
    defaultCategory: 'popular',
    fontFamily: fontFamilyFor(FALLBACK_FONT_ID),
    search: (q, cat) => searchGroup(q, cat).map((i) => ({ id: i.id, label: i.label, char: i.char, cats: i.cats })),
    label: 'Symbol',
    className: 'vl-btn vl-btn--secondary fb-logo-sym',
    title: 'Add a symbol to the words',
    // A modal rather than the default drawer: teardown closes dialogs, and a stray
    // drawer would outlive the generator — the keychain's note, same reason.
    placement: 'modal',
    hint: 'Every symbol is one solid shape, so it engraves and prints like a letter.',
    onPick: (item) => {
      // Appended rather than inserted at a caret: the field is one line and the symbol
      // almost always goes at one end, and tracking a caret through a modal is what the
      // keychain needed a pointerdown capture for.
      const next = params.logoText + item.char;
      params = { ...params, logoText: next };
      logoText.setValue(next);
      fontPicker.setSample(next.trim() || 'Your word');
      void refreshArtwork();
    },
  });

  /** The faces, each previewing the user's own word.
   *
   *  The kit's picker, not a grid of square tiles. A square works for a handful of
   *  curated faces and not for a library: a word needs WIDTH to read, and this app
   *  offers 185 of them. Search and category chips come with it, and the rows render
   *  in chunks as you scroll, so the list costs nothing up front. */
  const fontLibrary = LOGO_TEXT_FONTS.map((id) => {
    const f = FONTS.find((x) => x.id === id);
    return { id, label: f?.label ?? id, family: fontFamilyFor(id), category: f?.category };
  });
  const fontPicker = kitFontPicker({
    fonts: fontLibrary,
    value: params.logoFont,
    sample: params.logoText.trim() || 'Your word',
    featured: LOGO_FEATURED,
    // No caption: the placeholder reads "Search 185 fonts…" directly under it.
    label: '',
    onChange: (id) => {
      params = { ...params, logoFont: id };
      void refreshArtwork();
    },
  });

  const logoDrop = dropZone({
    title: 'Drop an SVG',
    text: 'or click to browse',
    note: CUT
      ? 'Filled shapes come out as shapes; a stroke comes out as a drawn line.'
      : 'Filled shapes only — a printer has nothing to fill a stroke with.',
    accept: '.svg,image/svg+xml',
    onFiles: (files) => {
      const file = files[0];
      if (!file) return;
      // The import window, the same one the clicker and the keycap generator open. It is
      // not optional politeness: an SVG with a white backdrop traces as a solid block over
      // the whole face, and before the window the only symptom was a logo that came out
      // wrong with nothing on screen to explain it.
      void readText(file)
        .then(async (text) => {
          const modes = await openSvgWizard(text, file.name);
          if (!modes) return;
          params = { ...params, logoSvg: text, logoSvgModes: modes };
          logoName.textContent = file.name;
          await refreshArtwork();
        })
        .catch((err) => toast((err as Error).message, { kind: 'error' }));
    },
  });
  const logoName = el('p', { className: 'fb-note' });

  /** One line saying what the logo will BE and where it will GO.
   *
   *  Both halves were previously only in a help tip, which is the wrong place for the one
   *  fact a person needs before they type anything — and the face is the more important
   *  half, because "Logo on" only appears when a box has more than one face to choose
   *  between, so on every other box nothing said where it was going. */
  const logoNote = el('p', { className: 'fb-note' });

  function describeLogo(): void {
    if (params.logo === 'none') {
      logoNote.textContent = '';
      return;
    }
    const faces = result ? logoFaces(result.net, params.style) : [];
    const chosen = faces.find((f) => f.id === params.logoFace) ?? faces[0];
    const where = chosen ? `On the ${chosen.label.toLowerCase().replace(/:.*$/, '').trim()}` : '';
    // In the print-only build there is no cutting to describe, and describing it anyway
    // would advertise a half of the app that is not launched — the same rule the <head>
    // follows. See `cutPackPlugin` in vite.config.ts.
    // SHORT. The face is the one fact a person needs before they type, and how the logo
    // is made is a sentence they read once and then never again — so that half moved into
    // the help tip on the control above, and what is left is a label.
    logoNote.textContent = where
      ? `${where}${params.makeMode === 'print' ? ', printed as a second colour' : ', engraved'}.`
      : '';
  }

  const logoControls = {
    kind: segmentedControl<LogoKind>({
      options: [
        // "Nothing" over-ran its own tab by 6 px in a 1100 px window — three options in a
        // 300 px column give each about 90 px, and the kit ellipsises what will not fit.
        { value: 'none', label: 'None' },
        { value: 'text', label: 'Text' },
        { value: 'svg', label: 'SVG' },
      ],
      value: params.logo,
      help: CUT
        ? 'One line of text in any bundled face, plus any symbol from the picker — or drop an SVG in. It is marked on its own ENGRAVE layer: a Laser Line on a laser, a pen line on a blade, never a cut. It keeps clear of every fold and is dropped rather than squeezed if it cannot fit.'
        : 'One line of text in any bundled face, plus any symbol from the picker — or drop an SVG in. It is inlaid into the first layer as a second colour, on the face that ends up outside the box. It keeps clear of every groove and is dropped rather than squeezed if it cannot fit.',
      onChange: (k) => {
        params = { ...params, logo: k };
        syncVisibility();
        void refreshArtwork();
      },
    }),
    face: selectField({
      label: 'Logo on',
      options: [{ value: '', label: 'Default' }],
      value: params.logoFace,
      help: 'Which panel it goes on. Only the faces this box actually has at this size are listed.',
      onChange: (v) => setParam('logoFace', v),
    }),
    scale: sliderRow({
      label: 'Logo size',
      min: 0.1,
      max: 1,
      step: 0.01,
      value: params.logoScale,
      format: (v) => `${Math.round(v * 100)}% of the face`,
      parse: (typed) => typed / 100,
      help: 'Of the clear area of the face — what is left once the margin every fold and cut needs is taken off.',
      onInput: (v) => setParam('logoScale', v),
    }),
    rotation: segmentedControl<'0' | '90' | '180' | '270'>({
      label: 'Turn it',
      options: [
        { value: '0', label: '0°' },
        { value: '90', label: '90°' },
        { value: '180', label: '180°' },
        { value: '270', label: '270°' },
      ],
      value: String(params.logoRotation) as '0' | '90' | '180' | '270',
      help: 'A panel\u2019s "up" is not always up in the flat blank — a mailer\u2019s lid lies across it — so this is how a logo ends up reading the right way on the finished box.',
      onChange: (v) => setParam('logoRotation', Number(v) as BoxParams['logoRotation']),
    }),
  };

  const logoSection = collapsibleSection({
    // Open, unlike "Fine tuning": with the logo off this is one row of tabs, and a feature
    // nobody can see is a feature nobody uses.
    title: 'Logo',
    open: true,
    body: [
      logoControls.kind,
      logoNote,
      el('div', { className: 'fb-logo-row' }, [logoText, logoSymbols]),
      fontPicker,
      logoDrop,
      logoName,
      logoControls.face,
      logoControls.scale,
      logoControls.rotation,
    ],
  });

  // ---------------------------------------------------------------------------
  // 4. MATERIAL & MACHINE (right panel)
  // ---------------------------------------------------------------------------
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
  const plateField = sheetOf('plate', 'Build plate');

  /** "It does not fit", said where the controls that fix it are, with the button that
   *  fixes it directly underneath.
   *
   *  `solve` already raises this as an error, but that error renders in the results
   *  section at the bottom of the column — a reviewer read it and still had to work
   *  out for himself which controls to change. It is also the NORMAL state on A4
   *  rather than an edge case, so it is the one thing in this app allowed to shout.
   *
   *  Two lines, not a paragraph: what is wrong, then the two numbers. The previous
   *  wording spent a sentence naming the controls it already sits between. */
  function fitAlert(): { root: HTMLElement; set(title: string, detail: string): void } {
    const title = el('p', { className: 'fb-alert__title' });
    const detail = el('p', { className: 'fb-alert__detail' });
    return {
      root: el('div', { className: 'fb-alert hidden' }, [title, detail]),
      set: (t, d) => { title.textContent = t; detail.textContent = d; },
    };
  }

  const plateAlert = fitAlert();
  /** Where `fitBtn` lives while the print half is on screen. The button works in both
   *  directions and is useful whether or not the blank fits, so it is NOT inside the
   *  alert — it sits under it, and moves between the two hosts with the make mode. */
  const fitHostPrint = el('div', { className: 'fb-fitbtn' });

  /** Panel and cut-length counts. They answer "what will this job be like", not "does
   *  it fit", and they were two of the six rows in the readout — which is the block a
   *  person actually watches while dragging a size slider. Down here with the rest of
   *  the cut-file detail, and below the fold, where a number nobody acts on belongs. */
  const cutStats = el('div', { className: 'fb-readout' });

  /** What the fold control offers on a given machine, and what it CALLS each option.
   *
   *  Two reasons this is not one fixed list of four:
   *
   *   · The words. Bambu Suite names a laser's two choices "Laser Cut" and "Laser Line",
   *     and those are the words the user will see in their own software when they open the
   *     file — so those are the words the control uses. "Perforate" and "Laser score" are
   *     our names for the same two things and they cost a round trip every time.
   *   · What is even possible. A mode a machine cannot do is worse than a missing one: it
   *     looks like a setting, it silently does something else, and it survives into every
   *     saved preset made while it was there. A drag knife cannot score, a laser has no
   *     pen, and of the machines offered here only a laser can score at all.
   *
   *  `Machine.foldModes` owns the list; this owns the wording. */
  function foldModeOptions(machineId: string): { value: string; label: string }[] {
    const m = machineById(machineId);
    const words: Record<FoldMode, string> = m.laser
      ? {
          perf: 'Laser Cut, dashed (a perforation)',
          score: 'Laser Line (one light pass)',
          draw: 'Draw the line',
          none: 'Do not mark them',
        }
      : {
          perf: 'Perforate (a dashed cut)',
          score: 'Score it (a scoring tool)',
          draw: 'Draw a pen line',
          none: 'Do not mark them',
        };
    return m.foldModes.map((v) => ({ value: v, label: words[v] }));
  }

  /** Everything the cut half of the app puts on screen, in one place and built only
   *  when that half is in the build. A function rather than a run of top-level consts
   *  for one reason: a `selectField({ label: 'Machine' })` at module scope RUNS, so its
   *  labels and help text are in the bundle however the mount site treats them.
   *  Unreferenced, the whole declaration goes, and every string in it with it. */
  function buildCutUI() {
    const stockField = selectField({
      label: 'What card are you using',
      options: STOCKS.map((s) => ({ value: s.id, label: s.name })),
      value: params.stockId,
      help: 'Picking one only fills in a starting thickness. Two packs both marked 300 gsm can differ by half again, so measure the sheet you are actually going to cut.',
      onChange: (id) => {
        const s = stockById(id);
        params = { ...params, stockId: id, caliperMm: s.caliperMm };
        controls2.caliper.setValue(s.caliperMm);
        triggerRebuild();
      },
    });

    const machineField = selectField({
      label: 'Machine',
      options: MACHINES.map((m) => ({ value: m.id, label: m.name })),
      value: params.machineId,
      onChange: (id) => {
        const m = machineById(id);
        // A machine preset is the whole recipe, not a label: it sets how a fold line is
        // made, what the beam width is, and which sheet of card is even possible.
        //
        // The sheet the user already chose WINS when it still fits. Picking the first
        // sheet that fits regardless meant switching machine could silently shrink an A3
        // choice to A4 — and on the machine-agnostic profiles, whose work area is
        // deliberately not a constraint, it would have reset the sheet for no reason at all.
        const fits = (s: { widthMm: number; heightMm: number }) =>
          s.widthMm <= m.areaMm[0] && s.heightMm <= m.areaMm[1];
        const current = SHEETS.find((s) => s.id === params.sheetId && s.kind === 'sheet');
        const sheet =
          current && fits(current)
            ? current
            : SHEETS.find((s) => s.kind === 'sheet' && fits(s));
        params = {
          ...params,
          machineId: id,
          foldMode: m.foldMode,
          kerfMm: m.kerfMm,
          sheetId: sheet?.id ?? params.sheetId,
        };
        // Relabelled rather than rebuilt, so the field keeps its place and its listener.
        // `setFieldOptions` also drops a mode the new machine cannot do, which is how a
        // laser's Laser Line cannot survive a switch to the blade as a dead setting.
        setFieldOptions(controls2.foldMode, foldModeOptions(id), m.foldMode);
        controls2.kerf.setValue(m.kerfMm);
        const sel = sheetField.querySelector('select');
        if (sel) sel.value = params.sheetId;
        triggerRebuild();
      },
    });

    const sheetField = sheetOf('sheet', 'Sheet of card');
    /** The cut half's copy of `plateAlert` — see it for why this exists. */
    const sheetAlert = fitAlert();
    const fitHostCut = el('div', { className: 'fb-fitbtn' });

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
        options: [
          { value: 'cut', label: 'Cut from card' },
          { value: 'print', label: '3D print it' },
        ],
        value: params.makeMode,
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
        help: 'The one number everything is built from: every tab, slot and lid clearance comes from it. The figure on the packet is not it: 300 gsm card is anywhere from 0.30 to 0.46 mm. Stack ten sheets, measure, divide by ten.',
        onInput: (v) => setParam('caliperMm', v),
      }),
      // A four-way segmented control in a 280 px column gives each option 70 px, and
      // the kit ellipsises what will not fit — so "Perforate" rendered as "Perfor…".
      // Four options with real names want a select, not tabs.
      foldMode: selectField({
        label: 'How to mark the folds',
        options: foldModeOptions(params.machineId),
        value: params.foldMode,
        help: 'No machine here can crease, so a fold is marked one of two ways and both work. A dashed cut — a perforation, which Suite calls a Laser Cut — is the default: it is one process for the whole sheet, it behaves the same on any material, and it is what has been cut on cardstock here. A single light pass — Suite calls it a Laser Line — leaves the panel whole and looks tidier, but its margin depends on the stock, and on paper it is controlled charring, so expect a brown line down every fold.',
        onChange: (m) => setParam('foldMode', m as FoldMode),
      }) as HTMLElement & { setValue?(v: FoldMode): void },
      kerf: sliderRow({
        label: 'Beam width',
        min: 0,
        max: 0.4,
        step: 0.01,
        value: params.kerfMm,
        format: (v) => (v === 0 ? 'none (blade)' : `${v.toFixed(2)} mm`),
        help: 'How much material the laser burns away. Every cut is grown by half of it so the finished part measures what it was drawn as. A blade removes nothing, so leave it at zero.',
        onInput: (v) => setParam('kerfMm', v),
      }),
      perfAuto: toggleSwitch({
        label: 'Size dashes automatically',
        checked: params.perfAuto,
        help: 'Each fold gets a dash size worked out from its own length and how thick the card is. A short tuck tab needs finer dashes than a long body fold; one setting for both leaves the short folds hinging on two big slots.',
        onChange: (v) => setParam('perfAuto', v),
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

    const cutSection = section({
      title: '',
      body: [stockField, controls2.caliper, machineField, sheetField, sheetAlert.root, fitHostCut],
    });

    const cutAdvancedSection = section({
      title: 'Cutting detail',
      body: [
        controls2.foldMode,
        controls2.perfAuto,
        controls2.perfCut,
        controls2.perfGap,
        controls2.kerf,
        cutStats,
      ],
    });

    return { ...controls2, stockField, machineField, sheetField, sheetAlert, fitHostCut, cutSection, cutAdvancedSection };
  }

  const cutUI = CUT ? buildCutUI() : null;



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
      onChange: (v) => {
        setParam('layerHeightMm', Number(v));
        refreshSheetRows();
      },
    }),
    sheetLayers: stepperRow({
      label: 'Sheet layers',
      min: 1,
      max: 8,
      step: 1,
      value: params.sheetLayers,
      format: (v) => `${v} layer${v === 1 ? '' : 's'} · ${(v * params.layerHeightMm).toFixed(2)} mm`,
      help: 'Two layers of 0.2 is 0.40 mm, and 300 gsm card measures 0.38, which is the whole idea. Thicker is stiffer and folds worse.',
      onInput: (v) => {
        setParam('sheetLayers', v);
        refreshSheetRows();
      },
    }),
    hingeLayers: stepperRow({
      label: 'Hinge layers',
      min: 1,
      max: 8,
      step: 1,
      value: params.hingeLayers,
      format: (v) =>
        v >= params.sheetLayers
          ? 'no groove'
          : `${v} layer${v === 1 ? '' : 's'} · ${(v * params.layerHeightMm).toFixed(2)} mm`,
      help: 'What is left under a fold line. One layer folds beautifully and is the reason a printed net folds at all; set it equal to the sheet and you get a plain slab with no fold marks on it.',
      onInput: (v) => {
        setParam('hingeLayers', v);
        refreshSheetRows();
      },
    }),
    /* Flaps. Everything that ends up SANDWICHED between two plies of the finished box —
       a dust flap, a corner ear, a tuck lug — is built thinner than the wall, because the
       gap it drops into is one sheet wide and PLA does not crush the way card does.

       Derived, that lands on a single layer at the default 2-layer sheet, which is the
       first thing people printing this box wrote in about: a one-layer flap on a two-layer
       wall is floppy, and at three layers it is floppier still. So the derivation is now a
       default rather than the only answer. */
    flapLayers: stepperRow({
      label: 'Flap layers',
      min: 0,
      max: 8,
      step: 1,
      value: params.flapLayers,
      format: (v) => {
        if (v === 0) {
          return `auto · ${sandwichThicknessMm({ ...params, flapLayers: 0 }).toFixed(2)} mm`;
        }
        // What the exporter will actually build, not what the slider says: a flap can be
        // neither thinner than the crease it folds on nor thicker than the sheet.
        const mm = sandwichThicknessMm({ ...params, flapLayers: v });
        const layers = Math.round(mm / params.layerHeightMm);
        return `${layers} layer${layers === 1 ? '' : 's'} · ${mm.toFixed(2)} mm`;
      },
      help: 'How thick the flaps that tuck INSIDE the box are built: the corner ears, the dust flaps, the tuck lugs. Auto leaves them one clearance under the gap they drop into, so they slide. Raise it for a flap that grips, up to the full thickness of the sheet, though that one has to be pushed home and on a box you plan to open and close a lot it is worth staying a layer under.',
      onInput: (v) => setParam('flapLayers', v),
    }),
    hingeWidth: sliderRow({
      label: 'Groove width',
      min: 0.4,
      max: 4,
      step: 0.1,
      value: params.hingeWidthMm,
      format: (v: number) => {
        const floor = minHingeWidthMm(params);
        return v < floor - 1e-6 ? `${floor.toFixed(1)} mm (floor)` : `${v.toFixed(1)} mm`;
      },
      help: 'A 90 degree fold needs roughly pi × thickness ÷ 2 of band before the outer face has to stretch, and folding flat needs pi × thickness, about 1.3 mm on a 0.4 mm sheet. That figure is a floor, not a suggestion: below it the two halves meet before the fold does, so it is enforced and rises with the sheet. Wider folds easier and stands up less straight.',
      onInput: (v) => setParam('hingeWidthMm', v),
    }),
  };

  /** Restate the four sheet rows from the current params.
   *
   *  They are not four independent numbers: every one of them prints a millimetre figure
   *  derived from the other three, so moving any one leaves the rest lying. Raising the
   *  sheet to three layers left "Flap thickness · auto · 0.20 mm" on screen while the
   *  flaps were being built at 0.40, and the groove kept claiming a floor computed for the
   *  old sheet. `setValue` re-runs each row's own `format`, and it will not touch a box
   *  someone is typing in. */
  function refreshSheetRows(): void {
    printControls.sheetLayers.setValue(params.sheetLayers);
    printControls.hingeLayers.setValue(params.hingeLayers);
    printControls.flapLayers.setValue(params.flapLayers);
    printControls.hingeWidth.setValue(params.hingeWidthMm);
  }

  // ---------------------------------------------------------------------------
  // 5. RESULTS
  // ---------------------------------------------------------------------------
  const readout = el('div', { className: 'fb-readout' });
  const diagnostics = diagnosticsList();

  // Boxes eat far more paper than anyone predicts — a mailer's blank is L + 4H wide
  // before it is anything else — so "does not fit" is the normal state, not the edge
  // case. Telling someone to go smaller and leaving them to find the number by
  // dragging three sliders is the unfriendly half of this tool.
  const fitBtn = button({
    label: 'Resize to fit',
    className: 'fb-fit',
    onClick: () => {
      // Searched inside the sliders' own range, so the size that fits is one they can show.
      const dims = fitToSheet(params, SIZE_LIMITS);
      params = { ...params, ...dims };
      showParams();
      triggerRebuild(true);
      toast(`Resized to ${params.lengthMm} × ${params.widthMm} × ${params.heightMm} mm`, { kind: 'ok' });
    },
  });

  function stat(label: string, value: string, tone?: string, title?: string): HTMLElement {
    const row = el('div', { className: `fb-stat${tone ? ` fb-stat--${tone}` : ''}` }, [
      el('span', { className: 'fb-stat__label', text: label }),
      el('span', { className: 'fb-stat__value', text: value }),
    ]);
    if (title) row.title = title;
    return row;
  }

  function renderResults(r: SolveResult): void {
    const { L, W, H } = insideDims(r.params);
    const fits = !r.overflow;
    // Re-read the style line every rebuild, not just on a style change: the lid-flaps
    // toggle moves the ECMA code without touching the style.
    describeStyle(r.params);
    fitBtn.setLabel(fits ? 'Make it as big as it will go' : 'Resize to fit');

    // The numbers come from the diagnostic rather than being recomputed here: the
    // margin the fit is measured against lives in `solve`, and a second copy of that
    // sum in the UI is a second copy that can disagree.
    const cutting = r.params.makeMode === 'cut';
    const tooBig = !!r.diagnostics.find((d) => d.code === 'sheet');
    const alert = cutting ? cutUI?.sheetAlert : plateAlert;
    for (const a of [cutUI?.sheetAlert, plateAlert]) a?.root.classList.toggle('hidden', !tooBig);
    if (alert && tooBig) {
      const surface = sheetById(r.params.sheetId).name.replace(/\s*\(.*\)$/, '');
      alert.set(
        cutting ? 'Too big for this sheet' : 'Too big for this plate',
        `Blank ${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm
` +
          `${cutting ? 'Sheet' : 'Plate'} ${r.usableMm[0].toFixed(0)} × ${r.usableMm[1].toFixed(0)} mm`,
      );
    }
    // Moving a node re-parents it; the listener rides along. One button, because
    // `fitToSheet` is ONE operation — it grows a box that fits and shrinks one that
    // does not, and both land on the same answer.
    (cutting ? cutUI?.fitHostCut : fitHostPrint)?.append(fitBtn);

    // Five rows, not eight. "Largest cube on this sheet" answered a question the
    // Resize button now answers by doing it, and "Work area" restated the machine you
    // just picked — between them a third of the panel, spent on nothing you act on.
    readout.replaceChildren(
      stat(
        cutting ? 'Blank' : 'Flat size',
        `${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm`,
        undefined,
        'The whole thing laid out flat, before it is folded. It is always much bigger than the finished box.',
      ),
      stat(
        fits ? 'Fits' : 'Does not fit',
        fits
          ? r.rotated
            ? 'yes, turned 90°'
            : 'yes'
          : `needs ${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)}`,
        fits ? 'ok' : 'bad',
      ),
      stat(
        'Inside',
        `${L.toFixed(0)} × ${W.toFixed(0)} × ${H.toFixed(0)} mm`,
        undefined,
        'What has to fit your product. Every panel in the blank is built from this.',
      ),
      // The trade does not work in inside dimensions. ECMA measures A x B x H centre to
      // centre of the crease lines, which is what a dieline vendor labels "manufacture
      // dimensions" and what a printer quotes against — so quoting it too is the
      // difference between an output someone can compare and one they have to convert.
      stat(
        'ECMA',
        `${r.ecmaDimsMm[0].toFixed(1)} × ${r.ecmaDimsMm[1].toFixed(1)} × ${r.ecmaDimsMm[2].toFixed(1)}`,
        undefined,
        'The industry convention: measured centre to centre of the crease lines, per the ECMA Code of Folding Carton Design Styles. Quote these to a trade printer: they are the numbers a die is cut to.',
      ),
      // Printing keeps its sheet/flap thicknesses here: there is no "Cutting detail"
      // section in print mode to move them to, and the number IS the thing a printed
      // box turns on.
      ...(cutting
        ? []
        : [
            stat('Panels · folds', `${r.net.panels.length} · ${r.net.creases.length}`),
            stat(
              'Sheet · flaps',
              `${sheetThicknessMm(r.params).toFixed(2)} mm · ${sandwichThicknessMm(r.params).toFixed(2)} mm`,
              undefined,
              'The sheet is what a wall is built from. Anything that tucks INSIDE one, such as a dust flap, a tuck lug or a corner ear, is built thinner, because the gap it drops into is one sheet wide and PLA does not crush the way card does. It follows the sheet: one clearance under it, rounded down to whole layers.',
            ),
          ]),
    );

    cutStats.replaceChildren(
      stat('Panels · folds', `${r.net.panels.length} · ${r.net.creases.length}`),
      stat(
        'Cut · fold line',
        `${(r.net.lengthByOp.cut / 1000).toFixed(2)} · ` +
          `${((r.net.lengthByOp.crease + r.net.lengthByOp.perf) / 1000).toFixed(2)} m`,
      ),
    );

    diagnostics.set(r.diagnostics);
  }

  function updateStatus(r: SolveResult, ms: number): void {
    // The worst problem and how many there are; the blank and the sheet when there is none.
    status.setDiagnostics(
      r.diagnostics,
      `${r.netSizeMm[0].toFixed(0)} × ${r.netSizeMm[1].toFixed(0)} mm blank · ` +
        `${r.rotated ? 'fits turned 90°' : 'fits'} ${sheetById(r.params.sheetId).name.replace(/\s*\(.*\)$/, '')}`,
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

  const scrub = slider({
    min: 0,
    max: 1000,
    value: 1000,
    ariaLabel: 'Fold progress',
    className: 'fb-scrub',
    onInput: (v) => {
      stop();
      const t = v / 1000;
      // A drag is a fresh intention rather than a paused run, so re-aim at the end they
      // are furthest from. Set before `setProgress`, which reads it to label the button.
      heading = t > 0.5 ? -1 : 1;
      setProgress(t, true);
    },
  });

  const playBtn = button({
    label: 'Fold it',
    className: 'fb-play',
    onClick: () => (playing ? stop() : play()),
  });

  const scrubReadout = el('span', { className: 'fb-scrub__value', text: 'closed' });

  /** Which way the next press runs. Opens at -1 because the app opens on a finished
   *  box, so the first thing on offer is taking it apart. */
  let heading: 1 | -1 = -1;

  /** Which end the button runs to. At either end there is only one way to go — and on
   *  a closed box that means offering the way back, rather than silently snapping to
   *  flat and folding it again, which is what it used to do.
   *
   *  In between, keep going the way we were already headed. Deciding purely on which
   *  half you are in reads fine until you pause at 60% on the way UP, whereupon the
   *  button flips to "Unfold it" and there is no way to resume folding without
   *  dragging back below the middle. */
  function playTarget(): 0 | 1 {
    if (progress >= 0.999) return 0;
    if (progress <= 0.001) return 1;
    return heading > 0 ? 1 : 0;
  }

  /** The button says what pressing it will DO. Anything else is a button that lies —
   *  and it has to be re-read after a scrub, not only after a play, because dragging
   *  past half way is what changes the answer. */
  function syncPlayLabel(): void {
    if (playing) return;
    playBtn.setLabel(playTarget() === 1 ? 'Fold it' : 'Unfold it');
  }

  function setProgress(t: number, fromScrub = false): void {
    progress = Math.max(0, Math.min(1, t));
    rig?.setProgress(progress);
    // The fold just moved every panel, so where the model sits on the floor is no
    // longer what it was measured as. Without this the box sinks into the build plate
    // partway through — 16 mm on the hinged lid.
    viewer.settleFoldRig();
    if (!fromScrub) scrub.setValue(Math.round(progress * 1000));
    scrubReadout.textContent =
      progress <= 0.001 ? 'flat' : progress >= 0.999 ? 'closed' : `${Math.round(progress * 100)}%`;
    syncPlayLabel();
  }

  let playRaf = 0;
  /** Time for the FULL travel. A part-way run is scaled off this, so the box folds at
   *  one speed whether it starts flat, closed or half way through. */
  const PLAY_MS = 2600;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {
    matches: false,
  };

  function play(): void {
    const to = playTarget();
    const from = progress;
    const span = Math.abs(to - from);

    // Someone who asked their system for less motion gets the destination, not a
    // performance. The scrubber is still there if they want to watch it.
    //
    // requestAnimationFrame also does not fire in a hidden tab, so a play started
    // there would leave the button reading "Pause" for the rest of the session.
    if (reducedMotion.matches || document.hidden) {
      setProgress(to);
      return;
    }

    heading = to === 1 ? 1 : -1;
    playing = true;
    playBtn.setLabel('Pause');
    const ms = Math.max(1, PLAY_MS * span);
    const started = performance.now();
    const step = () => {
      if (!playing) return;
      const u = Math.min(1, (performance.now() - started) / ms);
      setProgress(from + (to - from) * u);
      if (u >= 1) {
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
    syncPlayLabel();
  }

  // Switching away mid-fold freezes rAF. Without this the loop never resumes and the
  // button sits on "Pause" for the rest of the session.
  //
  // It goes on `document`, which outlives the container a host clears — so it is the one
  // listener here that has to be taken off by hand. Left on, every visit to this generator
  // would strand another copy calling `stop()` on a rig that no longer exists.
  const onVisibilityChange = () => {
    if (document.hidden) stop();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));

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

  // Filled in by every rebuild — see `renderLegend`.
  const dielineLegend = el('div', { className: 'fb-legend' });
  const dielineSwitches = el('div', { className: 'fb-dieline-switches' }, [
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
  const dielineToggles = el('div', { className: 'fb-dieline-body' }, [dielineLegend, dielineSwitches]);

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

  /** What each operation is CALLED in the legend. The colours come from `OP_COLOR`, which
   *  is the same table the dieline and the exported SVG paint from — they used to be three
   *  hex literals written out here, which is a copy that can only ever drift. */
  function opLabel(op: Op): string {
    switch (op) {
      case 'cut':
        return CUT ? 'Cut' : 'Outline';
      // One word for both, because only one of them is ever in a drawing and they are
      // different COLOURS — the legend's job is to name the colour on screen, and how the
      // fold is made is already named by the control that decides it. "Fold (perforated)"
      // also made the key too wide to sit beside the switches, which is the shape this
      // panel wants: what the colours mean on one side, the two switches on the other.
      case 'crease':
      case 'perf':
        return 'Fold';
      case 'film':
        return 'Film';
      case 'engrave':
        return 'Logo';
    }
  }

  /** One chip per operation the drawing actually contains, in cut order. */
  function renderLegend(ops: Set<Op>): void {
    const order: Op[] = ['cut', 'crease', 'perf', 'engrave', 'film'];
    dielineLegend.replaceChildren(
      ...order.filter((op) => ops.has(op)).map((op) => legendChip(opLabel(op), OP_COLOR[op])),
    );
  }

  const modes = modeBar<'flat' | 'fold'>({
    modes: [
      { value: 'fold', label: 'Fold' },
      { value: 'flat', label: 'Dieline' },
    ],
    value: 'fold',
    onChange: (m) => {
      wantedMode = m;
      showMode(m);
    },
  });

  /** What the model is standing on. Printing it flat is a print like any other, so the
   *  stage shows the bed chosen in "Sheet and printer" — at t = 0 that is literally the
   *  print, blank on the plate, which is the one view that answers "will it fit". Cutting
   *  from card gets the plain grid instead: a Bambu plate under a paper box would be a
   *  lie about the process. */
  function syncPlate(): void {
    const sheet = sheetById(params.sheetId);
    viewer.setPlate(params.makeMode === 'print' ? (sheet?.plate ?? 'grid') : 'grid');
  }

  function showMode(m: 'flat' | 'fold'): void {
    mode = m;
    // The bar is not the source of truth — this is — and a rebuild can move the mode
    // without anyone having clicked. Reflect it, or the pill lies about what is on
    // screen. `setValue` does not re-enter `onChange`.
    modes.setValue(m);
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
    // The handle slider only means anything once there IS a handle. A tray's grip and
    // a carry box's strap are both driven by it.
    show(controls.handleHeight, anyHandle && params.handle);
    show(controls.lidHeight, !!uses.lid);
    show(controls.lidPlay, !!uses.lid);
    show(controls.tuckDepth, !!uses.tuck);
    show(controls.tuckLock as HTMLElement, !!uses.tuck);
    show(controls.thumbNotch, !!uses.tuck);
    if (CUT) show(controls.glueTab!, !!uses.glue);
    show(controls.window, !!uses.window);
    show(controls.windowScale, !!uses.window && params.window);
    show(controls.windowRadius, !!uses.window && params.window);
    // The film insert is a second outline on its own layer, to be cut from acetate.
    // `buildPrintable` skips it — there is nothing to print — so it is a control with
    // no effect whenever the box is being printed.
    if (CUT) {
      const shown = !!uses.window && params.window && params.makeMode === 'cut';
      show(controls.filmInsert!, shown);
      show(controls.filmMargin!, shown && params.filmInsert);
    }
    show(controls.dividerCols, !!uses.divider);
    show(controls.dividerRows, !!uses.divider);
    show(controls.hangTab as HTMLElement, !!uses.hangTab);
    // Relabelled rather than rebuilt, so the field keeps its place in the section and its
    // listener. `setFieldOptions` keeps the current mode when the new list still has it
    // and falls back to the first when it does not — which is what stops a carton-only
    // mode surviving a switch to a mailer as a setting that silently does nothing.
    setFieldOptions(controls.hangTab as HTMLElement, hangOptions(params.style), params.hangTab);
    const faces = styleMeta(params.style).windowFaces ?? [];
    setFieldOptions(
      controls.windowFace as HTMLElement,
      faces.map((f) => ({ value: f.id, label: f.label })),
      params.windowFace,
    );
    // Only worth asking when there is more than one answer.
    show(controls.windowFace as HTMLElement, !!uses.window && params.window && faces.length > 1);
    show(controls.lidWings, !!uses.lidWings);
    show(controls.hangHole as HTMLElement, !!uses.hangTab && params.hangTab !== 'none');
    show(controls.hangEnd as HTMLElement, !!uses.hangEnd && params.hangTab !== 'none');
    show(controls.hangTabHeight, !!uses.hangTab && (params.hangTab === 'single' || params.hangTab === 'double'));
    show(controls.roofPitch, !!uses.roof);

    // The logo. Which rows are live follows the one choice at the top of the section —
    // and the whole section goes when the style has no face to put one on. A divider is a
    // set of slotted strips with no panels at all: the control would have looked live,
    // done nothing, and raised a warning about a box the user had not asked to change.
    const logoFaceList = result ? logoFaces(result.net, params.style) : [];
    show(logoSection, logoFaceList.length > 0);
    const logoOn = params.logo !== 'none';
    const typing = params.logo === 'text';
    show(logoText, typing);
    show(logoSymbols, typing);
    show(fontPicker, typing);
    show(logoDrop, params.logo === 'svg');
    show(logoName, params.logo === 'svg' && params.logoSvg !== '');
    show(logoControls.scale, logoOn);
    show(logoControls.rotation, logoOn);
    // Faces come off the BUILT net, so a panel a size has squeezed away is never offered
    // — and a face carried in from another style falls back to the first rather than
    // putting the logo on a panel that is not there. `logoHost` applies the same rule.
    // `logoFaceList`, and NOT the `faces` a few lines up, which is the WINDOW's list. They
    // are the same array on a mailer and nothing alike on a tray — whose window list is
    // empty, because a webbed tray has no face a window may weaken — so "Logo on" was
    // being offered the wrong set, and on every style without a window list it was offered
    // none at all and hid itself. Two lists in one function with one of them named `faces`:
    // the same trap as reaching into a migrated control's container by its old name.
    if (logoFaceList.length) {
      setFieldOptions(
        logoControls.face as HTMLElement,
        logoFaceList.map((f) => ({ value: f.id, label: f.label })),
        logoFaceList.some((f) => f.id === params.logoFace) ? params.logoFace : logoFaceList[0]?.id,
      );
    }
    show(logoControls.face as HTMLElement, logoOn && logoFaceList.length > 1);
    // Last, because it reads the face the two lines above may just have changed.
    describeLogo();
    // A section with every row hidden is an empty box with a heading on it.
    show(
      optionsSection,
      anyHandle ||
        !!uses.lid ||
        !!uses.divider ||
        !!uses.window ||
        !!uses.roof ||
        !!uses.hangTab,
    );
    // The sentence under the export buttons says what THIS mode's file is, not what this
    // build can do. The 100 mm check rectangle only exists in the cut files, and the embed
    // carries both halves — so a MakerWorld user on "3D print it" was being told to find a
    // rectangle in a file that has never contained one.
    setExportNote(footer, exportNote(params.makeMode));

    // The whole right column follows the one decision at the top of it. Nothing to
    // follow in the print-only build: `printing` is always true and those sections were
    // never built, so all of this is dead code the bundler drops with the rest.
    if (CUT) {
      const ui = cutUI!;
      const perf = params.foldMode === 'perf';
      show(ui.perfAuto, perf);
      // Dead sliders while the dash size is being worked out per fold.
      show(ui.perfCut, perf && !params.perfAuto);
      show(ui.perfGap, perf && !params.perfAuto);
      const printing = params.makeMode === 'print';
      show(ui.cutSection, !printing);
      show(ui.cutAdvancedSection, !printing);
      show(printSection, printing);
      for (const [id, btn] of exportButtons) {
        show(btn, id === 'zip' ? !printing : printing);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. CHROME
  // ---------------------------------------------------------------------------
  // No standing callout. It said "measure your card", which is now the help tip on the
  // one field it applies to — and it was flatly wrong in print mode, where there is no
  // card. A banner every visitor dismisses is 139 px of the panel that the style picker
  // needed more.

  // Declared once and used twice: `sidebarFooter` renders one button per entry and has
  // no API for showing a subset, so the buttons are paired back up by position further
  // down. Two literals that had to agree by hand is how the print-only build would have
  // shipped a 3MF button wired to the zip exporter.
  // MakerLab takes exactly two things from this app, a zip of cut files and an OBJ it turns
  // into a 3MF, so the embed offers exactly those two and no STL. Labels start with "Export",
  // which the kit passes through untouched: nothing is downloaded inside the host.
  const EXPORT_FORMATS = MAKERLAB
    ? [
        { id: 'zip', label: 'Export cut files' },
        { id: '3mf', label: 'Export 3MF' },
      ]
    : CUT
      ? [
          { id: 'zip', label: 'Cut files' },
          { id: '3mf', label: 'Printable 3MF' },
          { id: 'stl', label: 'Printable STL' },
        ]
      : [{ id: '3mf', label: '3MF' }];

  /* The licence line for the MakerLab artifacts.

     Not the kit's modal or its reminder toast, which is what every other build shows. Both
     pitch `BRAND.pricing.subscription` through a `target="_blank"` link, and the host's sandbox
     has `allowPopups: false`, so inside MakerLab they are a price with a dead button under it:
     the clicker suppresses them for exactly that. The licence still travels on every export,
     in the one place that survives the host's OBJ -> 3MF conversion and reaches the model page:
     the artifact's description (the keycap generator's approach). The in-app toast after an
     export says it too, in words, with no link to go dead. */
  const LICENSE_NOTE = `Free for personal use; selling what you make from it requires a commercial license: ${BRAND.urls.mwCommercial}`;

  /** The cover the host shows for the artifact. 512 px a side, the same as the clicker's:
   *  big enough to read on a model page, small enough that the data URL stays tens of
   *  kilobytes rather than megabytes. */
  const COVER_EDGE_PX = 512;
  const TIMED_OUT = Symbol('makerlab export timeout');

  /** A real render of the box for the host's cover image, as a PNG data URL.
   *
   *  `renderCoverPng` frames the whole model square at a fixed angle and draws a fresh frame
   *  before it reads the canvas back, so this is never a blank, stale or half-framed buffer —
   *  and it is 512 px a side rather than the pane's size, which on a wide screen was a 1704 px
   *  PNG and about 3 MB of base64 on an artifact the host caps at 10 MB. On the dieline view
   *  the 3D canvas is `display: none` and measures 0 × 0, which would render nothing, so it is
   *  shown for the one synchronous render and hidden again before anything can paint.
   *
   *  Never throws. A cover that will not render is cosmetic; the zip or the OBJ underneath it
   *  is the thing the user asked for, and it is already built by the time this runs. So a
   *  failure falls back to a valid 1 × 1 PNG and the export still goes. */
  async function renderCoverDataUrl(): Promise<string> {
    try {
      const hidden = stageCanvas.classList.contains('hidden');
      stageCanvas.classList.remove('hidden');
      const pending = viewer.renderCoverPng(COVER_EDGE_PX);
      if (hidden) stageCanvas.classList.add('hidden');
      const blob = await pending;
      if (!blob) {
        console.warn('[foldbox] the cover render produced no image; exporting with a blank cover.');
        return BLANK_COVER;
      }
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the cover image.'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[foldbox] the cover render failed; exporting with a blank cover.', err);
      return BLANK_COVER;
    }
  }

  /** Hand artifacts to MakerLab and say what happened. Resolves true on success.
   *
   *  `sdk.export` has no timeout of its own — the developer guide says so outright: it waits
   *  for the host for ever. The kit's export panel re-enables its buttons in a `finally`, so a
   *  host that never answers leaves BOTH buttons greyed with a spinner on them and nothing but
   *  a reload to fix it. Hence the race: at a minute the UI comes back and says honestly that
   *  it does not know. The original promise is still listened to, because the host may simply
   *  be slow and a late success should still be reported rather than contradicted. */
  async function sendToMakerlab(
    options: Parameters<typeof sdkExport>[0],
    what: string,
  ): Promise<boolean> {
    status.set('Sending to MakerLab…', 'idle');
    const pending = sdkExport(options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), EXPORT_TIMEOUT_MS);
    });
    const res = await Promise.race([pending, timedOut]);
    clearTimeout(timer);

    if (res === TIMED_OUT) {
      void pending.then(
        (late) => {
          if (late.success) {
            status.set(`Exported ${what} to MakerLab`, 'idle');
            toast(`MakerLab answered after all: exported ${what}.`, { kind: 'ok' });
          } else {
            status.set(`Export failed: ${late.errorMessage ?? late.errorCode}`, 'error');
          }
        },
        (err: unknown) => status.set(`Export failed: ${(err as Error).message}`, 'error'),
      );
      const msg =
        'MakerLab has not answered. Check MakerLab’s own export window, or reload the MakerWorld page and try again.';
      status.set(msg, 'error');
      toast(msg, { kind: 'error' });
      return false;
    }

    if (res.success) {
      status.set(`Exported ${what} to MakerLab`, 'idle');
      void sdkToast({ message: `Exported ${what}`, type: 'success' });
      return true;
    }
    const why = res.errorMessage ?? res.errorCode;
    status.set(`Export failed: ${why}`, 'error');
    void sdkToast({ message: 'Export failed', type: 'error' });
    toast(`Export failed: ${why}`, { kind: 'error' });
    return false;
  }

  const footer = sidebarFooter({
    formats: EXPORT_FORMATS,
    // The note follows the make mode from here on: `syncVisibility` sets it on every
    // rebuild. This is only its opening value.
    exportNote: exportNote(params.makeMode),
    onExport: async (format) => {
      if (!result) return toast('Nothing to export yet', { kind: 'warn' });
      // A box with an error would not fold: refused in that error's own words, which the
      // export panel shows.
      assertExportable(result.diagnostics);
      const name = `${styleMeta(params.style).name} ${params.lengthMm}x${params.widthMm}x${params.heightMm}`;

      if (MAKERLAB) {
        /* Embedded, but the host is not answering.

           No download attempt: the sandbox has `allowDownloads: false`, so it would vanish with
           no error. No licence modal either, which is the other half of what the clicker found
           this path doing: a subscription pitch through a dead link, on top of an export that
           silently never happened.

           One reconnect first. `initMakerlab` tears down the old SDK and runs the handshake
           again, which costs a moment and can only help — the handshake is the thing that was
           lost. Whether the host answers a second one has not been confirmed with MakerLab
           (makerlab/README.md), so the message it falls back to names the whole MakerWorld
           page: reloading only this panel re-runs the app inside a frame the host is no longer
           talking to, which is a loop the old wording sent people round. */
        if (!(mlReady() && mlCan('export'))) {
          if (mlEmbedded()) {
            status.set('Reconnecting to MakerLab…', 'idle');
            await initMakerlab({ onDisconnect: makerlabDisconnected });
          }
          if (!(mlReady() && mlCan('export'))) {
            const msg =
              'Not connected to MakerLab, so the file cannot be sent. Reload the whole MakerWorld page, not just this panel, and try again.';
            status.set(msg, 'error');
            toast(msg, { kind: 'error' });
            return;
          }
        }

        if (format === '3mf') {
          // The OBJ route: the host builds the 3MF from an OBJ and an MTL of colours. Never a
          // .3mf of our own inside a zip, which the SDK guide forbids and MakerWorld's review
          // made the clicker and the keycap generator stop doing.
          const baseName = `${params.style}-${params.lengthMm}x${params.widthMm}x${params.heightMm}-printable`;
          const { parts, stats } = buildPrintable(result.net, params);
          if (!parts.length) throw new Error('There is no geometry to print at this size.');
          const { obj, mtl } = buildObjMtl(parts, {
            mtlFileName: `${baseName}.mtl`,
            provenance: {
              title: name,
              generator: 'foldbox',
              application: `${BRAND.name} Fold-Up Box Generator`,
              buildId: import.meta.env.VITE_BUILD_ID,
            },
          });
          const sent = await sendToMakerlab(
            printExport({
              fileName: `${baseName}.obj`,
              buffer: textToArrayBuffer(obj),
              mtl,
              coverImage: await renderCoverDataUrl(),
              description:
                `${name}, printed flat as a ${stats.sheetMm.toFixed(2)} mm sheet with ` +
                `${stats.hingeMm.toFixed(2)} mm fold grooves. Print at 0.2 mm layers, no supports. ` +
                LICENSE_NOTE,
            }),
            'the 3MF',
          );
          if (sent) {
            const logo = stats.logoRings ? ' The logo is a second colour in the first layer.' : '';
            toast(
              `Exported to MakerLab: ${stats.sheetMm.toFixed(2)} mm sheet, ${stats.hingeMm.toFixed(2)} mm hinges.${logo} ` +
                'Free for personal use; selling prints needs a commercial licence.',
              { kind: 'ok' },
            );
          }
          return;
        }

        if (format === 'zip') {
          const files = buildCutFiles(result, {
            title: name,
            params,
            buildId: import.meta.env.VITE_BUILD_ID,
          });
          // A 2D export: the host goes straight to its download dialog instead of asking
          // which FDM printer a laser cut is for (see `cutExport`).
          const sent = await sendToMakerlab(
            cutExport({
              fileName: `${files.baseName}.zip`,
              buffer: bytesToArrayBuffer(files.zip),
              coverImage: await renderCoverDataUrl(),
              description: `${name}: cut files (SVG, DXF and a README with the settings). ${LICENSE_NOTE}`,
            }),
            'the cut files',
          );
          if (sent) {
            toast(
              `Exported ${files.baseName}.zip to MakerLab: SVG, DXF and an assembly sheet. ` +
                'Free for personal use; selling boxes needs a commercial licence.',
              { kind: 'ok' },
            );
          }
          return;
        }

        throw new Error('Unknown format: ' + format);
      }

      if (format === '3mf' || format === 'stl') {
        const baseName = `${params.style}-${params.lengthMm}x${params.widthMm}x${params.heightMm}-printable`;
        const meta = { title: name, baseName, buildId: import.meta.env.VITE_BUILD_ID };
        const built = buildPrintableFile(result.net, params, meta, format);
        const stats = built.stats;

        // With a host the file goes to the host's own export path rather than the browser's
        // download bar. `downloadPrintable` would build the same bytes a
        // second time, so both paths share the one `buildPrintableFile` above.
        let headline = built.fileName;
        if (host) {
          const { indexed } = await host.exportToLibrary(
            { name: built.fileName, bytes: built.data },
            { designer: 'Fold-Up Box Generator' },
          );
          headline = indexed ? 'Exported to your library' : `Exported as ${built.fileName}`;
        } else {
          downloadFile(built.data, built.fileName, built.mime);
        }

        const logo = stats.logoRings
          ? ' The logo is inlaid into the first layer: print it in two colours, or pause and swap.'
          : '';
        const mountains = stats.mountains
          ? ` ${stats.mountains} fold${stats.mountains === 1 ? '' : 's'} go the other way; press those from the underside.`
          : '';
        toast(
          `${headline}: ${stats.sheetMm.toFixed(2)} mm sheet, ${stats.hingeMm.toFixed(2)} mm hinges.${logo}${mountains}`,
          { kind: 'ok' },
        );
        licenseAfterExport();
        return;
      }

      if (CUT && format === 'zip') {
        const files = downloadCutFiles(result, {
          title: name,
          params,
          buildId: import.meta.env.VITE_BUILD_ID,
        });
        toast(`${files.baseName}.zip: SVG, DXF and an assembly sheet.`, { kind: 'ok' });
        licenseAfterExport();
        return;
      }

      throw new Error('Unknown format: ' + format);
    },
    // The host draws Save and Open itself once it owns projects; two Save buttons that do
    // different things is worse than either one alone. `Boolean(...)` and not `isDesktop()`:
    // a desktop host that does not offer the capability still needs these.
    //
    // Also true in the MakerLab embed, where nobody owns them: the sandbox has downloads off,
    // so Save would produce nothing. The kit then draws Help and the theme toggle only.
    hostOwnsProjects: MAKERLAB || Boolean(host?.registerProject),
    onSave: () =>
      downloadFile(JSON.stringify(markProject(PROJECT_FILE, params), null, 2), `${params.style}-box.json`, 'application/json'),
    onLoad: (file?: File) =>
      file &&
      readProjectFile(file, (data) => {
        applyParams(data);
        toast('Project loaded', { kind: 'ok' });
      }, PROJECT_FILE),
    onHelp: () => {
      // The dialog is built when it opens, so the paragraphs that describe ONE mode follow
      // the mode the user is on rather than the build. `CUT &&` keeps them foldable: in the
      // print-only build the flag is the literal false, so the strings go with the branch.
      const cutting = CUT && params.makeMode === 'cut';
      return dialog({
        title: 'Fold-up boxes',
        // Everything both builds share stays one entry. The paragraphs about cutting are
        // spread in only when the cut half is in the build: an app that talks about
        // lasers it cannot export for promises something it does not do.
        content: [
          CUT
            ? 'Pick a box, set the size, then say how you are making it: cut from card, or printed ' +
              'flat on a 3D printer. The button under the model runs the fold both ways: it folds a ' +
              'flat blank up, and unfolds a finished box back to the sheet, so you can watch it ' +
              'either way.'
            : 'Pick a box, set the size, and print it flat as a thin sheet you fold once. The button ' +
              'under the model runs the fold both ways: it folds a flat blank up, and unfolds a ' +
              'finished box back to the sheet, so you can watch it either way.',
          'Six styles need no glue at all, and each carries the ECMA code of the trade structure ' +
          'it is built from. The mailer (ECMA B20.01.00.50) locks itself by rolling each end down ' +
          'over the corner ears and pushing two tabs through the floor; the webbed tray ' +
          '(B20.04.00.00) locks by folding each corner double on a 45° crease instead.',
          'The gable box (A55.75.01.03) is the handled one: two roof panels lean in to a ridge, ' +
          'the two handle blades meet face to face above it, and an ear at each end drops its slot ' +
          'over BOTH blades at once, and that notch in the blades\u2019 shoulders is the lock. It needs ' +
          'the one glued lap every tube box needs, and nothing else.',
          'To hang a box on a shop peg, the hang tab adds a euro slot (ISO 15348). A header above ' +
          'the back wall doubled over on itself puts the slot through two plies, which is what stops ' +
          'it tearing off the peg, and it moves the lid to the front, because the header now owns ' +
          'the back wall\u2019s top edge.',
          ...(cutting
            ? [
                'CUTTING IT. The one number that matters is how thick your card actually is: every ' +
                  'tab, slot and lid clearance is built from it. The number on the packet is not it: ' +
                  '300 gsm runs anywhere from 0.30 to 0.46 mm. Stack ten sheets, measure, divide ' +
                  'by ten.',
              ]
            : []),
          'PRINTING IT. The thickness is worked out for you: layers times layer height. Two layers ' +
            'of 0.2 mm is 0.40 mm, which is exactly what 300 gsm card measures, so it folds like ' +
            'card. Fold lines come out as grooves down to one layer.',
          cutting
            ? 'Boxes eat a lot of paper, far more than anyone expects. If the blank does not fit, ' +
              'press "Resize to fit" rather than hunting for the number by hand. On A4 or a 12 in ' +
              'mat this is a small-box tool.'
            : 'A blank is much wider than the box it makes: a mailer\u2019s is L + 4H across before ' +
              'it is anything else. If it does not fit the plate, press "Resize to fit" rather than ' +
              'hunting for the number by hand.',
          ...(cutting
            ? [
                'No cutter can crease, so fold lines come out as a laser score, a perforation, or a ' +
                  'pen line you fold by hand. The machine preset picks the right one.',
                'Every export carries a 100 mm rectangle. Measure it in your cutting software ' +
                  'before you cut a real sheet: if it reads 133 mm your importer guessed the wrong ' +
                  'DPI, and the DXF will fix it.',
              ]
            : []),
          // Inside MakerLab nothing is downloaded, and the one setting that is not a choice
          // there deserves its reason on the page that explains the rest.
          ...(MAKERLAB
            ? [
                'EXPORTING. The export button sends the file to MakerLab rather than downloading ' +
                  'it: cutting gives a zip of cut files, printing gives a 3MF that MakerLab builds ' +
                  'for your printer. The layer height is fixed at 0.20 mm here. MakerLab does not ' +
                  'let an app set the first layer height, and Bambu’s stock profiles leave it at ' +
                  '0.20 mm, so the sheet is built at 0.20 mm to match.',
              ]
            : []),
        ].join('\n\n'),
        actions: [{ label: 'Got it', primary: true }],
      });
    },
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
  // NOT numbered, and that is the fix rather than the omission: this section hides itself
  // when a style has no options at all — a webbed tray has none — and the panel then read
  // "1 · Box, 2 · Size, 4 · Logo", which is a missing step the user goes looking for.
  const optionsSection = section({
    title: 'Options',
    body: [
      controls.handle,
      controls.handleHeight,
      controls.lidHeight,
      controls.dividerCols,
      controls.dividerRows,
      controls.window,
      controls.windowFace,
      controls.windowScale,
      controls.lidWings,
      controls.hangTab,
      controls.hangHole,
      controls.hangEnd,
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
      ...(CUT ? [controls.glueTab!] : []),
      controls.hangTabHeight,
      controls.roofPitch,
      controls.windowRadius,
      ...(CUT ? [controls.filmInsert!, controls.filmMargin!] : []),
    ],
  });


  // Phase 2. Collapsed, because it is a second way to make the same box rather than a
  // step in making it — but its own section rather than buried in "fine tuning",
  // because the thickness it produces has to agree with the caliper the blank was
  // built for, and that is worth a sentence on screen.
  const printSection = section({
    title: 'Sheet and printer',
    body: [
      plateField,
      plateAlert.root,
      fitHostPrint,
      // Inside MakerLab the layer height is fixed (see `MAKERLAB_LAYER_HEIGHT_MM`), so it is
      // said rather than offered: a dropdown with one live answer is a control that lies.
      //
      // The note says nothing about the hinge. Raising "Hinge layers" to meet "Sheet layers"
      // is one click away and leaves a plain slab with no groove in it, and a fixed note that
      // justifies itself by a hinge the box does not have is a note that has to be read
      // against the state beside it. This reason holds in every state.
      MAKERLAB
        ? el('p', {
            className: 'fb-note',
            text: 'Layer height is fixed at 0.20 mm here. MakerLab does not let an app set the first layer height, and Bambu’s stock profiles leave it at 0.20 mm, so the sheet is built at 0.20 mm to match.',
          })
        : printControls.layerHeight,
      printControls.sheetLayers,
      printControls.hingeLayers,
      printControls.flapLayers,
      printControls.hingeWidth,
    ],
  });

  const shell = appShell({
    // No topbar and no intro header inside MakerLab, as in the clicker and the keycap
    // generator: the host draws its own chrome and shows the app's name, MakerWorld's review
    // (2026-07-27) asked for the intro block to go, and both carry `target="_blank"` links that
    // the sandbox (`allowPopups: false`) would kill.
    topbar: MAKERLAB ? undefined : topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
    left: {
      scroll: [
        ...(MAKERLAB
          ? []
          : [
              generatorHeader({
                title: 'Fold-Up Box Generator',
                description: CUT
                  ? 'Glue-free boxes from real dielines. Cut them from card, or print them flat.'
                  : 'Glue-free boxes from real dielines, printed flat as a sheet that folds itself up.',
              }),
            ]),
        section({
          title: 'Box',
          body: [
            styleCards.root,
            el('div', { className: 'fb-style-meta' }, [styleBadge, styleCode]),
          ],
        }),
        section({
          title: 'Size',
          body: [controls.units, controls.length, controls.width, controls.height],
        }),
        optionsSection,
        logoSection,
        advancedSection,
        // The Updates drawer. Under the last section rather than in the sticky footer:
        // most of what is in it arrived as an email about a box someone had already
        // printed, so it earns a button — but not one competing with Export for the block
        // that is on screen the whole time.
        changelogButton({ entries: CHANGELOG, title: 'Fold-Up Box updates' }),
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
        // One decision at the top in the full app. In the print-only build there is
        // no decision left to make, so the question and the whole cut half of the
        // panel are not built at all — `printSection` becomes the top of the column.
        ...(CUT ? [cutUI!.makeMode, cutUI!.cutSection] : []),
        printSection,
        section({ title: 'Does it fit?', body: [readout, diagnostics.root] }),
        // LAST, under the answer rather than over it. "Cutting detail" is dash size,
        // kerf and fold mode — set once and rarely touched — and it is now always
        // expanded, so leaving it above "Does it fit?" pushed the one readout people
        // actually watch a full section further down the scroll.
        ...(CUT ? [cutUI!.cutAdvancedSection] : []),
      ],
      footer: [footer],
    },
  });

  container.append(shell.root);

  // `exportPanel` renders one button per format, in the order they were declared, and
  // has no API for showing a subset. Pairing them back up by that order lets the
  // download row follow the make-mode switch instead of offering a 3MF next to a
  // laser-cutter setting — which is the same "both halves at once" problem the sheet
  // dropdown had.
  const exportButtons: [string, HTMLElement][] = [
    ...shell.root.querySelectorAll<HTMLElement>('.vl-export__buttons button'),
  ].map((btn, i) => [EXPORT_FORMATS[i]?.id ?? '', btn]);

  const viewer = createViewer(stageCanvas, { frameMul: 1.9, framePad: 20 });

  showMode('fold');
  // Open on the finished box: that is what the user came to make. The scrubber and
  // the play button are right there to take it apart.
  setProgress(1);

  rebuild(true);

  /**
   * Hand the host the three things it needs to own projects for this generator.
   *
   * Autosave, the unsaved dot, Save, Open, Rename, Delete and Start fresh then belong to
   * the host, drawn once in its own chrome for every generator it hosts, rather than a
   * sixth copy of that machinery living in here. Absent on the web, where every path in
   * this file keeps working exactly as it did.
   *
   * There is deliberately no `initialProjectId` branch to go with it. A generator that
   * does not own projects has nothing to open one *with*, so a host that wants a project
   * on screen has to be a host that owns projects.
   */
  host?.registerProject?.({
    getState: () => params,
    applyState: (loaded) => applyParams(loaded),
    capturePreview,
    suggestName: () => styleMeta(params.style).name,
  });

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
    cleanups.push(() => {
      delete (window as unknown as Record<string, unknown>).__foldbox;
    });
  }

  /**
   * Put `params` on every control and keep only what the controls can show. Load project, the
   * host's project list, the units switch and "Resize to fit" all end here.
   *
   * The kit's `syncControls` does the one-to-one fields and writes each control's clamped,
   * stepped value back into `params` (each caller has just made a new one), so a file saying
   * `lengthMm: 400` builds the 260 mm the slider shows rather than 400 behind it. The rest is
   * by hand below, and clamps the same way where its control can.
   */
  function showParams(): void {
    syncControls(params, {
      units: controls.units,
      dimBasis: controls.basis,
      lengthMm: controls.length,
      widthMm: controls.width,
      heightMm: controls.height,
      lidHeightMm: controls.lidHeight,
      lidPlayMm: controls.lidPlay,
      tuckDepthMm: controls.tuckDepth,
      tuckLock: controls.tuckLock,
      thumbNotch: controls.thumbNotch,
      handle: controls.handle,
      handleHeightMm: controls.handleHeight,
      window: controls.window,
      windowScale: controls.windowScale,
      windowRadiusMm: controls.windowRadius,
      hangEnd: controls.hangEnd,
      hangHole: controls.hangHole,
      lidWings: controls.lidWings,
      logo: logoControls.kind,
      logoScale: logoControls.scale,
      logoText,
      hangTabHeightMm: controls.hangTabHeight,
      roofPitchDeg: controls.roofPitch,
      sheetLayers: printControls.sheetLayers,
      hingeLayers: printControls.hingeLayers,
      flapLayers: printControls.flapLayers,
      hingeWidthMm: printControls.hingeWidth,
    });
    if (CUT) {
      const ui = cutUI!;
      syncControls(params, {
        glueTabMm: controls.glueTab!,
        filmInsert: controls.filmInsert!,
        filmMarginMm: controls.filmMargin!,
        // Without their side effects: a project carries its own thickness, beam width, fold
        // marks and sheet, which picking a card or a machine by hand would overwrite.
        stockId: ui.stockField,
        caliperMm: ui.caliper,
        machineId: ui.machineField,
        kerfMm: ui.kerf,
        perfAuto: ui.perfAuto,
        perfCutMm: ui.perfCut,
        perfGapMm: ui.perfGap,
        makeMode: ui.makeMode,
      });
    }
    // 0 means the default of two, which the slider shows; only a real count is the slider's to clamp.
    controls.dividerCols.setValue(params.dividerCols || 2);
    if (params.dividerCols) params.dividerCols = controls.dividerCols.getValue();
    controls.dividerRows.setValue(params.dividerRows || 2);
    if (params.dividerRows) params.dividerRows = controls.dividerRows.getValue();
    // Both pickers hold strings.
    logoControls.rotation.setValue(String(params.logoRotation) as '0' | '90' | '180' | '270');
    params.logoRotation = Number(logoControls.rotation.getValue()) as BoxParams['logoRotation'];
    printControls.layerHeight.setValue(String(params.layerHeightMm));
    params.layerHeightMm = Number(printControls.layerHeight.getValue());
    // Not read back: their lists follow the style and still hold the last style's here, so a
    // value the new style offers could be lost. `syncVisibility` re-lists them on the rebuild
    // that follows, and the solver ignores a value the style does not offer.
    controls.hangTab.setValue(params.hangTab);
    controls.windowFace.setValue(params.windowFace);
    // One setting, two lists: sheets of card and build plates. `setValue` ignores an id its
    // list does not have.
    for (const f of [...(cutUI ? [cutUI.sheetField] : []), plateField]) f.setValue(params.sheetId);
    // `false`: this is reflecting state that already changed, not making a choice.
    fontPicker.setValue(params.logoFont, false);
    fontPicker.setSample(params.logoText.trim() || 'Your word');
    logoName.textContent = params.logoSvg ? 'Logo from the saved project' : '';
    // Last: re-listing the fold modes for the machine can settle `foldMode` through the
    // field's own change handler, which replaces `params`.
    if (CUT) setFieldOptions(cutUI!.foldMode, foldModeOptions(params.machineId), params.foldMode);
    refreshSheetRows();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  /** Put a saved parameter blob back on screen. Both load paths — the web's file picker
   *  and the host's project browser — come through here, so they cannot drift apart. */
  function applyParams(data: unknown): void {
    params = printOnly({ ...DEFAULT_PARAMS, ...(data as Partial<BoxParams>) });
    showParams();
    styleCards.setValue(params.style);
    describeStyle(params);
    // A project carries its logo with it — the words and the face id, or the SVG source
    // verbatim — so it has to be re-resolved before the box is built. `refreshArtwork`
    // ends in a rebuild, so this is the one path that does not call `triggerRebuild`
    // itself; calling both would build the box twice, once without the logo.
    void refreshArtwork();
  }

  /** A still of the stage for the host's project list. Undefined rather than a throw: a
   *  missing thumbnail is not worth failing a save over. */
  function capturePreview(): string | undefined {
    const canvas = stageCanvas.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return undefined;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  void mode;

  return () => {
    // Dialogs, drawers and toasts render on <body>, outside the container the host clears,
    // so a stranded one would outlive the generator that opened it. The Updates panel is a
    // drawer, which is why the second line arrived with it.
    closeAllDialogs();
    closeAllDrawers();
    stop();
    clearTimeout(rebuildQueued);
    rig?.dispose();
    // The viewer holds the WebGL context. Mounting four generators and leaving without
    // this is four contexts the browser keeps until it starts dropping the oldest.
    viewer.dispose();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.replaceChildren();
  };
}
