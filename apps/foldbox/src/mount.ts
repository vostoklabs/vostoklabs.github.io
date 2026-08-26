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
  button,
  slider,
  sliderRow,
  toggleSwitch,
  segmentedControl,
  selectField,
  setFieldOptions,
  toast,
  dialog,
  closeAllDialogs,
  openLicenseModal,
  licenseReminderToast,
  bindExternalLinks,
  el,
  type DesktopHost,
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
import { STYLES, styleEcma, styleMeta, insideDims, hangModes } from './geometry/styles';
import { buildRig, type FoldRig } from './fold/rig';
import { createFlatView, styleIcon } from './ui/flatView';
import { downloadCutFiles } from 'virtual:cut-pack';
import { downloadFile } from '@vostok/export';
import {
  buildPrintable,
  buildPrintableFile,
  downloadPrintable,
  minHingeWidthMm,
  sandwichThicknessMm,
  sheetThicknessMm,
} from './export/printable';

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
   *  cutting a box from card is finished, but it does not launch until there is a laser
   *  here to test real sheets on, so the default build is print-only and every `if (CUT)`
   *  below is compiled out of it. `pnpm dev` and `pnpm build:full` run `--mode full`. */
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

  function printOnly(p: BoxParams): BoxParams {
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
  const styleBlurb = el('p', { className: 'fb-blurb' });

  /** "Does it need glue" is the only question most people arrive with, so it is a
   *  badge on the style rather than a sentence three lines into the blurb. */
  function describeStyle(p: BoxParams): void {
    const meta = styleMeta(p.style);
    styleBlurb.textContent = meta.blurb;
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

  /** The words for each mode, per family. Which panel a tab hangs off is the whole
   *  difference between them and it is invisible on the dieline, so it goes in the label
   *  rather than buried in the help. Which modes a style actually offers comes from
   *  `hangModes` — this only supplies the wording. */
  const HANG_LABEL: Record<string, Record<string, string>> = {
    mailer: {
      none: 'None',
      single: 'Lid tab — the lid runs on past one end',
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
      help: 'On a tray this raises the two long walls into grips you can pick it up by. On the carry box it currently does nothing — that style is known broken and being redesigned.',
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
    // Cut-only: `buildPrintable` skips the film part, and `printOnly` turns it off. A
    // conditional spread rather than a hidden row, so the print-only build does not
    // carry two controls it never shows and the help text that goes with them.
    ...(CUT
      ? {
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
      help: 'The keyhole that hangs a package on a shop peg (ISO 15348), kept 4 mm clear of every edge so the card does not tear off it. A header is an extra panel above the box — doubled, the slot goes through two plies, which is what stops it tearing under any real weight. A header takes over the back wall’s top edge, so the lid moves to the front.',
      onChange: (v) => setParam('hangTab', v as BoxParams['hangTab']),
    }),
    windowFace: selectField({
      label: 'Window on',
      options: [{ value: '', label: 'Default' }],
      value: params.windowFace,
      help: 'Which panel the aperture is cut in. On a mailer this is how you follow the hang tab: the tab is the lid carrying on past an end, so the LID goes against the shop’s board and the base is what faces out — put the window and the artwork there.',
      onChange: (v) => setParam('windowFace', v),
    }),
    lidWings: toggleSwitch({
      label: 'Wings on the lid',
      checked: params.lidWings,
      help: 'A flap on each short edge of the lid, folding down inside the rolled ends so the lid cannot lift at the corners. It changes the lid itself: with wings it NESTS inside the rim instead of capping over it, which is ECMA cover 53 rather than 50. An end carrying a hang tab goes without a wing — they want the same edge.',
      onChange: (v) => setParam('lidWings', v),
    }),
    hangHole: selectField({
      label: 'Hole shape',
      options: [
        { value: 'euro', label: 'Euro slot — wide, with a round crown' },
        { value: 'round', label: 'Round hole' },
      ],
      value: params.hangHole,
      help: 'The two a shop actually has. The euro slot is the wide low slot with a round crown on top that most European retail packaging uses. A plain round hole is what a bare peg or a J-hook wants, and it still fits panels too narrow for a slot. Both stay 4 mm clear of every edge — that is the number that stops the sheet tearing off the peg.',
      onChange: (v) => setParam('hangHole', v as BoxParams['hangHole']),
    }),
    hangEnd: selectField({
      label: 'Hangs from',
      options: [
        { value: 'left', label: 'The left end' },
        { value: 'right', label: 'The right end' },
        { value: 'both', label: 'Both ends' },
      ],
      value: params.hangEnd,
      help: 'Which short end the tab reaches past. Either way the box hangs long-side-down rather than jutting out at the customer — that is the point of putting the tab on an end rather than on a wall. Both ends keeps the blank symmetric and lets you hang it from whichever end suits the shelf.',
      onChange: (v) => setParam('hangEnd', v as BoxParams['hangEnd']),
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
      help: 'The gable’s slope from horizontal. Everything about the roof follows from it — the rise, how long the roof panel is in the flat, and how far the ears have to lean in to catch the handle blades.',
      onInput: (v) => setParam('roofPitchDeg', v),
    }),
  };

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

  /** Everything the cut half of the app puts on screen, in one place and built only
   *  when that half is in the build. A function rather than a run of top-level consts
   *  for one reason: a `selectField({ label: 'Machine' })` at module scope RUNS, so its
   *  labels and help text are in the bundle however the mount site treats them.
   *  Unreferenced, the whole declaration goes, and every string in it with it. */
  function buildCutUI() {
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

    const sheetField = sheetOf('sheet', 'Sheet of card');

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
      perfAuto: toggleSwitch({
        label: 'Size dashes automatically',
        checked: params.perfAuto,
        help: 'Each fold gets a dash size worked out from its own length and how thick the card is. A short tuck tab needs finer dashes than a long body fold — one setting for both leaves the short folds hinging on two big slots.',
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
      title: 'Card and machine',
      body: [stockField, controls2.caliper, stockNote, machineField, sheetField],
    });

    const cutAdvancedSection = collapsibleSection({
      title: 'Cutting detail',
      open: false,
      body: [
        controls2.foldMode,
        controls2.perfAuto,
        controls2.perfCut,
        controls2.perfGap,
        controls2.kerf,
        machineNote,
      ],
    });

    return { ...controls2, sheetField, cutSection, cutAdvancedSection };
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
      format: (v: number) => {
        const floor = minHingeWidthMm(params);
        return v < floor - 1e-6 ? `${floor.toFixed(1)} mm (floor)` : `${v.toFixed(1)} mm`;
      },
      help: 'A 90 degree fold needs roughly pi × thickness ÷ 2 of band before the outer face has to stretch, and folding flat needs pi × thickness — about 1.3 mm on a 0.4 mm sheet. That figure is a floor, not a suggestion: below it the two halves meet before the fold does, so it is enforced and rises with the sheet. Wider folds easier and stands up less straight.',
      onInput: (v) => setParam('hingeWidthMm', v),
    }),
  };

  // ---------------------------------------------------------------------------
  // 5. RESULTS
  // ---------------------------------------------------------------------------
  const readout = el('div', { className: 'fb-readout' });
  const diagnostics = el('div', { className: 'fb-diagnostics' });

  // Boxes eat far more paper than anyone predicts — a mailer's blank is L + 4H wide
  // before it is anything else — so "does not fit" is the normal state, not the edge
  // case. Telling someone to go smaller and leaving them to find the number by
  // dragging three sliders is the unfriendly half of this tool.
  const fitBtn = button({
    label: 'Resize to fit',
    className: 'fb-fit',
    onClick: () => {
      const dims = fitToSheet(params);
      params = { ...params, ...dims };
      syncControls();
      triggerRebuild(true);
      toast(`Resized to ${dims.lengthMm} × ${dims.widthMm} × ${dims.heightMm} mm`, { kind: 'ok' });
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
        'ECMA A × B × H',
        `${r.ecmaDimsMm[0].toFixed(1)} × ${r.ecmaDimsMm[1].toFixed(1)} × ${r.ecmaDimsMm[2].toFixed(1)} mm`,
        undefined,
        'The industry convention: measured centre to centre of the crease lines, per the ECMA Code of Folding Carton Design Styles. Quote these to a trade printer — they are the numbers a die is cut to.',
      ),
      stat('Panels · folds', `${r.net.panels.length} · ${r.net.creases.length}`),
      cutting
        ? stat(
            'Cut · fold line',
            `${(r.net.lengthByOp.cut / 1000).toFixed(2)} · ` +
              `${((r.net.lengthByOp.crease + r.net.lengthByOp.perf) / 1000).toFixed(2)} m`,
          )
        : stat(
            'Sheet · flaps',
            `${sheetThicknessMm(r.params).toFixed(2)} mm · ${sandwichThicknessMm(r.params).toFixed(2)} mm`,
            undefined,
            'The sheet is what a wall is built from. Anything that tucks INSIDE one — a dust flap, a tuck lug, a corner ear — is built thinner, because the gap it drops into is one sheet wide and PLA does not crush the way card does. It follows the sheet: one clearance under it, rounded down to whole layers.',
          ),
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

  const dielineLegend = el(
    'div',
    { className: 'fb-legend' },
    CUT
      ? [legendChip('Cut', '#FF0000'), legendChip('Fold', '#0000FF'), legendChip('Film', '#00C0C0')]
      : [legendChip('Outline', '#FF0000'), legendChip('Fold', '#0000FF')],
  );
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
    // A section with every row hidden is an empty box with a heading on it.
    show(
      optionsSection,
      anyHandle ||
        !!uses.lid ||
        !!uses.divider ||
        !!uses.window ||
        !!uses.handHoles ||
        !!uses.roof ||
        !!uses.hangTab,
    );
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
  let downloads = 0;

  /** Full modal on the first download of a session, corner reminder after. */
  function nudgeLicense(): void {
    downloads += 1;
    if (downloads === 1) openLicenseModal();
    else licenseReminderToast();
  }

  const EXPORT_FORMATS = CUT
    ? [
        { id: 'zip', label: 'Cut files' },
        { id: '3mf', label: 'Printable 3MF' },
        { id: 'stl', label: 'Printable STL' },
      ]
    : [{ id: '3mf', label: '3MF' }];

  const footer = sidebarFooter({
    formats: EXPORT_FORMATS,
    exportNote: CUT
      ? 'Every file carries a 100 mm rectangle — measure it before you cut a real sheet.'
      : 'Prints flat, no supports. The fold lines are grooved in — fold it by hand off the plate.',
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
        const meta = { title: name, baseName, buildId: import.meta.env.VITE_BUILD_ID };
        const built = buildPrintableFile(result.net, params, meta, format);
        const stats = built.stats;

        // With a host the file does not land in Downloads for the user to go and find —
        // it lands in their library and shows up in the grid, which is the whole reason
        // the desktop bundle exists. `downloadPrintable` would build the same bytes a
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

        const mountains = stats.mountains
          ? ` ${stats.mountains} fold${stats.mountains === 1 ? '' : 's'} go the other way — press those from the underside.`
          : '';
        toast(
          `${headline} — ${stats.sheetMm.toFixed(2)} mm sheet, ${stats.hingeMm.toFixed(2)} mm hinges.${mountains}`,
          { kind: 'ok' },
        );
        nudgeLicense();
        return;
      }

      if (CUT && format === 'zip') {
        const files = downloadCutFiles(result, {
          title: name,
          params,
          buildId: import.meta.env.VITE_BUILD_ID,
        });
        toast(`${files.baseName}.zip — SVG, DXF and an assembly sheet.`, { kind: 'ok' });
        nudgeLicense();
        return;
      }

      throw new Error('Unknown format: ' + format);
    },
    // The host draws Save and Open itself once it owns projects; two Save buttons that do
    // different things is worse than either one alone. `Boolean(...)` and not `isDesktop()`:
    // a desktop host that does not offer the capability still needs these.
    hostOwnsProjects: Boolean(host?.registerProject),
    onSave: () => downloadJSON(`${params.style}-box.json`, params),
    onLoad: (file?: File) =>
      file &&
      loadJSON(file, (data) => {
        applyParams(data);
        toast('Project loaded', { kind: 'ok' });
      }),
    onHelp: () =>
      dialog({
        title: 'Fold-up boxes',
        // Everything both builds share stays one entry. The paragraphs about cutting are
        // spread in only when the cut half is in the build: an app that talks about
        // lasers it cannot export for promises something it does not do.
        content: [
          CUT
            ? 'Pick a box, set the size, then say how you are making it — cut from card, or printed ' +
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
          'over BOTH blades at once — that notch in the blades\u2019 shoulders is the lock. It needs ' +
          'the one glued lap every tube box needs, and nothing else.',
          'To hang a box on a shop peg, the hang tab adds a euro slot (ISO 15348). A header above ' +
          'the back wall doubled over on itself puts the slot through two plies, which is what stops ' +
          'it tearing off the peg — and it moves the lid to the front, because the header now owns ' +
          'the back wall\u2019s top edge.',
          ...(CUT
            ? [
                'CUTTING IT. The one number that matters is how thick your card actually is: every ' +
                  'tab, slot and lid clearance is built from it. The number on the packet is not it ' +
                  '— 300 gsm runs anywhere from 0.30 to 0.46 mm. Stack ten sheets, measure, divide ' +
                  'by ten.',
              ]
            : []),
          'PRINTING IT. The thickness is worked out for you: layers times layer height. Two layers ' +
            'of 0.2 mm is 0.40 mm, which is exactly what 300 gsm card measures — so it folds like ' +
            'card. Fold lines come out as grooves down to one layer.',
          CUT
            ? 'Boxes eat a lot of paper — far more than anyone expects. If the blank does not fit, ' +
              'press "Resize to fit" rather than hunting for the number by hand. On A4 or a Cricut ' +
              'mat this is a small-box tool.'
            : 'A blank is much wider than the box it makes — a mailer\u2019s is L + 4H across before ' +
              'it is anything else. If it does not fit the plate, press "Resize to fit" rather than ' +
              'hunting for the number by hand.',
          ...(CUT
            ? [
                'No cutter can crease, so fold lines come out as a laser score, a perforation, or a ' +
                  'pen line you fold by hand. The machine preset picks the right one.',
                'Every export carries a 100 mm rectangle. Measure it in your cutting software ' +
                  'before you cut a real sheet — if it reads 133 mm your importer guessed the wrong ' +
                  'DPI, and the DXF will fix it.',
              ]
            : []),
        ].join('\n\n'),
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
      printControls.layerHeight,
      printControls.sheetLayers,
      printControls.hingeLayers,
      printControls.hingeWidth,
    ],
  });

  const shell = appShell({
    topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
    left: {
      scroll: [
        generatorHeader({
          title: 'Fold-Up Box Generator',
          description: CUT
            ? 'Glue-free boxes from real dielines. Cut them from card, or print them flat.'
            : 'Glue-free boxes from real dielines, printed flat as a sheet that folds itself up.',
        }),
        section({
          title: '1 · Box',
          body: [
            styleCards.root,
            el('div', { className: 'fb-style-meta' }, [styleBadge, styleCode, styleBlurb]),
          ],
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
        // One decision at the top in the full app. In the print-only build there is
        // no decision left to make, so the question and the whole cut half of the
        // panel are not built at all — `printSection` becomes the top of the column.
        ...(CUT
          ? [
              section({ title: 'Making it', body: [cutUI!.makeMode] }),
              cutUI!.cutSection,
              cutUI!.cutAdvancedSection,
            ]
          : []),
        printSection,
        section({ title: 'Does it fit?', body: [readout, fitBtn, diagnostics] }),
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
   * on screen has to be a host that owns projects — and Opal is.
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
    if (CUT) controls.glueTab!.setValue(params.glueTabMm);
    controls.handle.setValue(params.handle);
    controls.handHoles.setValue(params.handHoles);
    controls.handleHeight.setValue(params.handleHeightMm);
    controls.window.setValue(params.window);
    controls.windowScale.setValue(params.windowScale);
    controls.windowRadius.setValue(params.windowRadiusMm);
    if (CUT) {
      controls.filmInsert!.setValue(params.filmInsert);
      controls.filmMargin!.setValue(params.filmMarginMm);
    }
    controls.dividerCols.setValue(params.dividerCols || 2);
    controls.dividerRows.setValue(params.dividerRows || 2);
    const htSel = controls.hangTab.querySelector('select');
    if (htSel) htSel.value = params.hangTab;
    const heSel = controls.hangEnd.querySelector('select');
    if (heSel) heSel.value = params.hangEnd;
    const hhSel = controls.hangHole.querySelector('select');
    if (hhSel) hhSel.value = params.hangHole;
    const wfSel = controls.windowFace.querySelector('select');
    if (wfSel) wfSel.value = params.windowFace;
    controls.lidWings.setValue(params.lidWings);
    controls.hangTabHeight.setValue(params.hangTabHeightMm);
    controls.roofPitch.setValue(params.roofPitchDeg);
    if (CUT) {
      const ui = cutUI!;
      ui.caliper.setValue(params.caliperMm);
      const fmSel = ui.foldMode.querySelector('select');
      if (fmSel) fmSel.value = params.foldMode;
      ui.kerf.setValue(params.kerfMm);
      ui.perfCut.setValue(params.perfCutMm);
      ui.perfGap.setValue(params.perfGapMm);
      ui.makeMode.setValue(params.makeMode);
    }
    for (const f of [...(cutUI ? [cutUI.sheetField] : []), plateField]) {
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
  /** Put a saved parameter blob back on screen. Both load paths — the web's file picker
   *  and the host's project browser — come through here, so they cannot drift apart. */
  function applyParams(data: unknown): void {
    params = printOnly({ ...DEFAULT_PARAMS, ...(data as Partial<BoxParams>) });
    syncControls();
    styleCards.setValue(params.style);
    describeStyle(params);
    triggerRebuild(true);
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

  return () => {
    // Dialogs and toasts render on <body>, outside the container the host clears, so a
    // stranded one would outlive the generator that opened it.
    closeAllDialogs();
    stop();
    clearTimeout(rebuildQueued);
    rig?.dispose();
    // The viewer holds the WebGL context. Mounting four generators and leaving without
    // this is four contexts the browser keeps until it starts dropping the oldest — see
    // the note on `onBeforeUnmount` in Opal's host.ts.
    viewer.dispose();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.replaceChildren();
  };
}
