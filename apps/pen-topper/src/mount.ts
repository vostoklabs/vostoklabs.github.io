import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  section,
  collapsibleSection,
  segmentedControl,
  selectField,
  sliderRow,
  toggleSwitch,
  symbolPickerButton,
  presetShareButton,
  stageStatus,
  toast,
  dialog,
  closeAllDialogs,
  drawer,
  closeAllDrawers,
  openLicenseModal,
  licenseReminderToast,
  readParamsFromHash,
  bindExternalLinks,
  chooseFile,
  button,
  chip,
  textField,
  textareaField,
  filamentRow,
  uploadCta,
  el,
  type DesktopHost,
  type HostAsset,
} from '@vostok/ui-kit';
import { zipSync } from 'fflate';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice } from '@vostok/plates';
import { buildThreeMF, type ExportPart } from '@vostok/export';
import {
  FONTS,
  type FontChoice,
  ICONS,
  getFont,
  getFontUrl,
  parseFont,
  registerCustomFont,
  isFontSupported,
  fontFamilyFor,
  curatedFonts as curatedFontsOf,
  getHorizontalContours,
  getVerticalContours,
  FALLBACK_FONT_ID,
} from '@vostok/fonts';
import {
  DEFAULT_SETTINGS,
  coerceSettings,
  boreFor,
  penPreset,
  interferenceFor,
  ribHeightForFit,
  ribCountForFit,
  type HoleShape,
  PEN_PRESETS,
  MOUNT_PRESETS,
  mountPreset,
  matchMount,
  minPlateThickness,
  type FitClass,
  type TopperSettings,
  type PlateShape,
  type PenPath,
} from './state';
import { QUICK_PICKS, SYMBOL_GROUPS, searchGroup } from './symbols';
import { MAX_NAMES, parseNames, setFileName, batchToParts, platesOf, batchWarnings } from './batch';
import { noAmsPauses } from './geometry/noAms';
import type { BatchResult, GeometryResponse, PartMesh } from './types';

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

  /** Everything the teardown has to undo beyond the worker and the viewer. */
  const cleanups: (() => void)[] = [];

  /*
    Pen Topper Generator.

    Layout, chrome and export are the house pattern (see apps/generator-template).
    What is specific here:

      - the text is laid out on THIS thread, because opentype and any font the user
        imported live here, and the worker only ever sees arrays of numbers;
      - the socket is described by a pen, not by a diameter. "BIC Cristal" is a
        question a person can answer; "9.6 mm" is a question about a pen they are
        holding but have never measured.
  */

  const curatedFonts = curatedFontsOf();

  let settings: TopperSettings = { ...DEFAULT_SETTINGS };
  const shared = readParamsFromHash();
  if (shared) settings = coerceSettings({ ...settings, ...shared });

  let parts: ExportPart[] = [];
  let downloads = 0;

  // ---------------------------------------------------------------------------
  // 1. WORKER — every boolean happens over there.
  // ---------------------------------------------------------------------------
  const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });

  let workerBusy = false;
  let dirty = false;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

  function triggerRebuild() {
    dirty = true;
    // A batch owns the worker until it is done, and its results own the stage until the
    // user asks for the single topper back.
    if (workerBusy || batchRunning || setResults) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(runRebuild, 90);
  }

  /** Each font's natural line gap differs; this is the default the Line spacing
   *  slider multiplies. Pixel and condensed faces want a tighter one. */
  function baseLineFactor(fontId: string): number {
    if (fontId === 'vt323' || fontId === 'press-start-2p') return 0.44;
    if (fontId === 'creepster') return 0.55;
    return 0.62;
  }

  async function runRebuild() {
    if (!dirty) return;
    dirty = false;
    workerBusy = true;
    status.set('Building…');

    try {
      const [font, fallbackFont] = await Promise.all([
        getFont(settings.font),
        getFont(FALLBACK_FONT_ID).catch(() => null),
      ]);

      const line2Size = settings.size * settings.line2Scale;
      const lineFactor = baseLineFactor(settings.font) * settings.lineSpacing;

      const laid =
        settings.layout === 'vertical'
          ? getVerticalContours(font, fallbackFont, settings.name, settings.size, settings.lineSpacing, settings.letterSpacing)
          : getHorizontalContours(
              font,
              fallbackFont,
              settings.name,
              settings.secondLine,
              settings.size,
              line2Size,
              0,
              settings.line2Align,
              lineFactor,
              settings.letterSpacing,
              { alignMode: 'block' },
            );

      worker.postMessage({
        type: 'build',
        textContours: laid.contours,
        params: { ...settings, lines: laid.lines },
      });
    } catch (err) {
      workerBusy = false;
      status.set(err instanceof Error ? err.message : 'Could not lay out the text', 'error');
    }
  }

  worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
    const msg = e.data;
    if (msg.type === 'ready') {
      workerBusy = false;
      triggerRebuild();
      return;
    }
    if (msg.type === 'batchProgress') {
      batchProgress.textContent = `Building ${msg.label} — ${msg.done + 1} of ${msg.total}…`;
      return;
    }
    if (msg.type === 'batchDone') {
      batchRunning = false;
      buildSetBtn.setDisabled(false);
      batchProgress.classList.add('hidden');
      setResults = msg.results;
      shownPlate = 0;
      showPlate(0);
      const warn = batchWarnings(msg.results);
      status.set(
        `Set: ${msg.results.length} topper${msg.results.length === 1 ? '' : 's'} on ` +
          `${msg.plates} plate${msg.plates === 1 ? '' : 's'} · ${msg.ms} ms` +
          (warn.length ? ` · ${warn[0]}` : ''),
        warn.length ? 'warn' : 'idle',
      );
      if (msg.plates > 1) {
        toast(`${msg.results.length} toppers need ${msg.plates} plates — Download gives you a zip, one 3MF each.`, { kind: 'warn' });
      }
      refreshNamesCount();
      return;
    }
    if (msg.type === 'parts') {
      workerBusy = false;
      // A queued preview rebuild must not replace a set that is already on the stage.
      // The set took a minute to build; the single topper is one keystroke away.
      if (setResults) return;
      parts = msg.parts as PartMesh[] as ExportPart[];
      viewer.setParts(parts, firstBuild);
      firstBuild = false;
      lastSize = [msg.stats.size[0], msg.stats.size[1]];

      refreshShape(msg.stats.letterScale);
      builtDepth = msg.stats.depth;
      refreshSocket();
      const [w, d, h] = msg.stats.size;
      const tris = parts.reduce((n, p) => n + p.indices.length / 3, 0);
      const warn = msg.warnings[0];
      status.set(
        warn ??
          `${w.toFixed(1)} × ${d.toFixed(1)} × ${h.toFixed(1)} mm · ${msg.stats.bore.toFixed(1)} mm bore · ` +
            `${parts.length} part${parts.length === 1 ? '' : 's'} · ${tris} triangles · ${msg.stats.ms} ms`,
        warn ? 'warn' : 'idle',
      );
      if (dirty) runRebuild();
      return;
    }
    if (msg.type === 'error') {
      workerBusy = false;
      if (batchRunning) {
        batchRunning = false;
        buildSetBtn.setDisabled(false);
        batchProgress.classList.add('hidden');
      }
      console.error(msg.message);
      status.set('Could not build the model — see the console.', 'error');
    }
  };

  let firstBuild = true;
  /** Footprint of the last single build, mm — what the set's fit estimate is drawn from. */
  let lastSize: [number, number] | null = null;

  // ---------------------------------------------------------------------------
  // 2. TEXT + SYMBOLS
  // ---------------------------------------------------------------------------
  const nameField = textField({
    label: 'Text',
    value: settings.name,
    placeholder: 'Name or initial',
    onInput: (v) => {
      settings.name = v;
      refreshFontCards();
      triggerRebuild();
    },
  });
  nameField.field.className = 'pt-text-input';
  nameField.field.maxLength = 16;
  const nameInput = nameField.field;

  const secondField = textField({
    label: 'Second line',
    value: settings.secondLine,
    placeholder: 'Optional second line',
    onInput: (v) => {
      settings.secondLine = v;
      syncVisibility();
      triggerRebuild();
    },
  });
  secondField.field.className = 'pt-text-input';
  secondField.field.maxLength = 16;
  const secondInput = secondField.field;

  /*
    Inserting a symbol has to land at the caret, and the caret is gone by the time the
    click fires — focus has already moved to the button and the selection offsets with
    it. So the field and the offsets are captured on pointerdown, before the blur.
  */
  let symbolTarget: HTMLInputElement = nameInput;
  let symbolCaret = { start: 0, end: 0 };

  function rememberCaret() {
    const active = document.activeElement === secondInput ? secondInput : nameInput;
    symbolTarget = active;
    symbolCaret = {
      start: active.selectionStart ?? active.value.length,
      end: active.selectionEnd ?? active.value.length,
    };
  }
  for (const input of [nameInput, secondInput]) {
    input.addEventListener('blur', rememberCaret);
    input.addEventListener('keyup', rememberCaret);
    input.addEventListener('click', rememberCaret);
  }
  symbolCaret = { start: settings.name.length, end: settings.name.length };

  /*
    A click on a symbol ADDS it. Always, including the click straight after the last
    one.

    This used to REPLACE the previous pick, on the theory that you would want to flip
    through cat, dog, dragon and watch the topper become each one. It does do that —
    and it also makes "Alex ★ ❤" impossible, because the heart silently eats the star.
    One click cannot tell "try another" from "add another", and guessing wrong cost a
    capability rather than a convenience. Every emoji picker ever written appends;
    browsing is what backspace is for.
  */
  function insertSymbol(char: string) {
    const { value } = symbolTarget;
    symbolTarget.value = value.slice(0, symbolCaret.start) + char + value.slice(symbolCaret.end);
    const next = symbolCaret.start + char.length;
    symbolCaret = { start: next, end: next };
    symbolTarget.dispatchEvent(new Event('input'));
    symbolTarget.focus();
    symbolTarget.setSelectionRange(next, next);
  }

  /*
    Symbols come in two doses. The dozen people actually want are right here as
    buttons — one click, no dialog, no search box. The other 1380 are one more click
    away, opening on a curated shelf instead of on the digits.
  */
  const quickRow = el('div', { className: 'pt-quick' });
  for (const icon of QUICK_PICKS) {
    const btn = button({
      label: icon.char,
      className: 'pt-quick__btn',
      title: icon.label,
      onClick: () => insertSymbol(icon.char),
    });
    btn.setAttribute('aria-label', `Insert ${icon.label}`);
    btn.style.fontFamily = fontFamilyFor(FALLBACK_FONT_ID);
    btn.addEventListener('pointerdown', rememberCaret);
    quickRow.append(btn);
  }

  const symbolBtn = symbolPickerButton({
    items: ICONS,
    categories: SYMBOL_GROUPS.map((g) => ({ id: g.id, label: g.label })),
    defaultCategory: 'popular',
    fontFamily: fontFamilyFor(FALLBACK_FONT_ID),
    search: (q, cat) => searchGroup(q, cat),
    onPick: (item) => insertSymbol(item.char),
    stayOpen: true,
    label: 'More symbols…',
    className: 'vl-btn vl-btn--secondary pt-symbol-btn',
    title: 'Insert a symbol',
    hint: 'Click one to drop it into the text. The picker stays open, so you can add a few.',
  });
  symbolBtn.addEventListener('pointerdown', rememberCaret);

  // ---------------------------------------------------------------------------
  // 3. CONTROLS
  // ---------------------------------------------------------------------------
  const controls = {
    size: sliderRow({
      label: 'Text size', min: 6, max: 26, step: 0.5, value: settings.size, unit: 'mm',
      onInput: (v) => { settings.size = v; triggerRebuild(); },
    }),
    plateThickness: sliderRow({
      label: 'Plate thickness', min: 1.5, max: 10, step: 0.2, value: settings.plateThickness, unit: 'mm',
      help: 'A topper takes more handling than a keychain, so it wants more plate. With the hole inside the name, this cannot go below what the hole needs.',
      onInput: (v) => { settings.plateThickness = v; refreshPath(); refreshPauses(); triggerRebuild(); },
    }),
    textThickness: sliderRow({
      label: 'Letter height', min: 0.4, max: 3, step: 0.1, value: settings.textThickness, unit: 'mm',
      onInput: (v) => { settings.textThickness = v; triggerRebuild(); },
    }),
    outlineWidth: sliderRow({
      label: 'Border width', min: 0.5, max: 6, step: 0.1, value: settings.outlineWidth, unit: 'mm',
      help: 'How much plate stands out around the letters.',
      onInput: (v) => { settings.outlineWidth = v; triggerRebuild(); },
    }),
    smoothing: sliderRow({
      label: 'Edge smoothing', min: 0, max: 4, step: 0.5, value: settings.smoothing, unit: 'mm',
      help: 'Fills tight gaps between letters. If the plate breaks into pieces, raise this until it is one shape again.',
      onInput: (v) => { settings.smoothing = v; triggerRebuild(); },
    }),
    chamfer: toggleSwitch({
      label: 'Chamfer edges', checked: settings.chamferOn,
      help: 'Bevels the top edges of the plate and letters.',
      onChange: (on) => { settings.chamferOn = on; syncVisibility(); triggerRebuild(); },
    }),
    chamferSize: sliderRow({
      label: 'Chamfer size', min: 0.15, max: 1, step: 0.05, value: settings.chamfer, unit: 'mm',
      onInput: (v) => { settings.chamfer = v; triggerRebuild(); },
    }),

    // --- Socket ---
    socketAngle: sliderRow({
      label: 'Pen angle', min: -90, max: 90, step: 5, value: settings.socketAngle, unit: '°',
      help: '0° puts the pen straight below the name; -90° puts it out to the left, in line with it.',
      onInput: (v) => { settings.socketAngle = v; refreshMount(); triggerRebuild(); },
    }),
    socketOffset: sliderRow({
      label: 'Pen position', min: -1, max: 1, step: 0.05, value: settings.socketOffset,
      format: (v) => (Math.abs(v) < 0.03 ? 'centred' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
      help: 'Slides the pen along the edge it enters, so the name can hang off one end instead of balancing in the middle.',
      onInput: (v) => { settings.socketOffset = v; refreshMount(); triggerRebuild(); },
    }),
    barrelDia: sliderRow({
      // Down to 4 for the things that are not pens — a hoodie cord is 4 to 5 mm, and a
      // floor of 6 put the one preset that needs typing outside the range.
      label: 'Barrel diameter', min: 4, max: 16, step: 0.1, value: settings.barrelDia, unit: 'mm',
      help: 'The pen’s own outside diameter where the topper sits. On a hex pen or pencil, measure corner to corner.',
      onInput: (v) => {
        settings.barrelDia = v;
        // Typing a diameter IS choosing "custom" — leaving the preset showing
        // "BIC Cristal" next to a number that is not a BIC is how a fit gets blamed
        // on the wrong thing.
        if (settings.pen !== 'custom') { settings.pen = 'custom'; penSelect.setValue('custom'); }
        refreshSocket();
        refreshPath();
        triggerRebuild();
      },
    }),
    socketDepth: sliderRow({
      label: 'Socket depth', min: 5, max: 35, step: 0.5, value: settings.socketDepth, unit: 'mm',
      help:
        'How far the pen goes in. Under about twice the barrel it pivots on the mouth and wobbles. It is ' +
        'capped by how much block there is to bore into, and the readout says so when that happens.',
      onInput: (v) => { settings.socketDepth = v; refreshSocket(); triggerRebuild(); },
    }),
    wallThickness: sliderRow({
      label: 'Socket wall', min: 1, max: 4, step: 0.1, value: settings.wallThickness, unit: 'mm',
      help: 'Material around the bore. Thinner is lighter; under 1.2 mm it splits.',
      onInput: (v) => { settings.wallThickness = v; refreshSocket(); refreshPath(); triggerRebuild(); },
    }),
    ribCount: sliderRow({
      label: 'Grip ribs', min: 0, max: 6, step: 1, value: settings.ribCount,
      format: (v) => (v === 0 ? 'none' : String(v)),
      help:
        'Thin ribs standing into the hole — the only thing that touches the pen. Three suits a round ' +
        'barrel. On a HEX barrel with a ROUND hole use four: three sit at 120° against six corners at 60°, ' +
        'so they land on flats together and grip at half the rotations. A hex hole has no such problem.',
      onInput: (v) => {
        settings.ribCount = v;
        // Dropping to zero here IS choosing None; leaving the Fit row on Normal would
        // have it describing ribs that are not in the model.
        if (v > 0) lastRibCount = v;
        fitControl.setValue(v <= 0 ? 'none' : settings.fit);
        syncVisibility();
        refreshSocket();
        refreshPath();
        triggerRebuild();
      },
    }),
    ribHeight: sliderRow({
      label: 'Rib height', min: 0.1, max: 0.6, step: 0.01, value: settings.ribHeight, unit: 'mm',
      help:
        'How far each rib stands into the hole. It counts twice on the diameter, so a 0.3 mm rib in a hole ' +
        '0.3 mm over the barrel squeezes the pen by 0.3 mm. The Fit buttons set this; the slider is the ' +
        'override for a printer that runs tight or loose.',
      onInput: (v) => {
        settings.ribHeight = v;
        refreshSocket();
        refreshPath();
        triggerRebuild();
      },
    }),

    // --- Colour ---
    haloWidth: sliderRow({
      label: 'Outline width', min: 0.2, max: 4, step: 0.1, value: settings.haloWidth, unit: 'mm',
      onInput: (v) => { settings.haloWidth = v; triggerRebuild(); },
    }),
    haloThickness: sliderRow({
      label: 'Outline height', min: 0.2, max: 2, step: 0.1, value: settings.haloThickness, unit: 'mm',
      onInput: (v) => { settings.haloThickness = v; refreshPauses(); triggerRebuild(); },
    }),

    // --- Typography ---
    boldness: sliderRow({
      label: 'Boldness', min: -0.3, max: 0.7, step: 0.05, value: settings.boldness, unit: 'mm',
      help: 'Fattens or thins the letter strokes.',
      onInput: (v) => { settings.boldness = v; triggerRebuild(); },
    }),
    letterSpacing: sliderRow({
      label: 'Letter spacing', min: -0.08, max: 0.4, step: 0.02, value: settings.letterSpacing,
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
      onInput: (v) => { settings.letterSpacing = v; triggerRebuild(); },
    }),
    lineSpacing: sliderRow({
      label: 'Line spacing', min: 0.5, max: 1.8, step: 0.05, value: settings.lineSpacing,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { settings.lineSpacing = v; triggerRebuild(); },
    }),
    line2Scale: sliderRow({
      label: 'Second line scale', min: 0.3, max: 1.5, step: 0.05, value: settings.line2Scale,
      onInput: (v) => { settings.line2Scale = v; triggerRebuild(); },
    }),
    layerHeight: sliderRow({
      label: 'Layer height', min: 0.08, max: 0.32, step: 0.02, value: settings.layerHeight, unit: 'mm',
      help: 'Used to snap the colour bands onto whole layers so the swap lands cleanly.',
      onInput: (v) => { settings.layerHeight = v; refreshPauses(); triggerRebuild(); },
    }),
  };

  const penSelect = selectField({
    label: 'Fits which pen',
    value: settings.pen,
    help: 'Sets the barrel diameter. Hex barrels are measured corner to corner, which is what a round socket has to clear.',
    options: PEN_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    onChange: (id) => {
      settings.pen = id;
      const preset = penPreset(id);
      if (preset && id !== 'custom') {
        settings.barrelDia = preset.barrel;
        controls.barrelDia.setValue(preset.barrel);
        // A hex preset brings its hole shape with it. Still a preference, not a lock —
        // the control is right there and a round hole goes on a hex pen perfectly well.
        settings.holeShape = preset.hex ? 'hex' : 'round';
        holeShapeControl.setValue(settings.holeShape);
      }
      // A straw and a drawstring have no end to perch on, so the only arrangement that
      // works on them is a band the thing passes right through. Picking one and being
      // left with a blind socket is a model that cannot go on the thing it was named
      // after, so the preset carries the path and sets it.
      if (preset?.path && preset.path !== settings.penPath) {
        settings.penPath = preset.path;
        pathControl.setValue(preset.path);
        refreshPath();
      }
      // Without this the diameter row stays hidden after picking "Custom…", which
      // leaves the one option that exists to be typed into with nothing to type into.
      syncVisibility();
      refreshSocket();
      refreshPath();
      triggerRebuild();
    },
  });

  const holeShapeControl = segmentedControl<HoleShape>({
    label: 'Hole shape',
    value: settings.holeShape,
    help:
      'A hex hole matches a hexagonal pencil face for face, so it grips the same however the pencil is ' +
      'turned — where a round hole with three ribs grips at half the rotations and rattles at the rest. ' +
      'It also prints cleaner: sat point-up it needs no bridge over the top.',
    options: [
      { value: 'round', label: 'Round' },
      { value: 'hex', label: 'Hex' },
    ],
    onChange: (v) => {
      settings.holeShape = v;
      refreshSocket();
      refreshPath();
      triggerRebuild();
    },
  });

  /** The rib count to return to when leaving None. */
  let lastRibCount = Math.max(1, DEFAULT_SETTINGS.ribCount);

  const fitControl = segmentedControl<FitClass>({
    label: 'Fit',
    // One per row. Four across a 280 px panel gives each about six characters, which
    // turned "Normal" into "No..." and "Loose" into "Loo..." — a control whose options
    // cannot be read is not a control.
    columns: 1,
    value: settings.ribCount <= 0 ? 'none' : settings.fit,
    help:
      'How hard the ribs press. The hole itself never changes — it always clears the barrel — so nothing ' +
      'here can stop the pen going in. Snug if it falls off. Loose halves the ribs, for a barrel whose ' +
      'paint is getting marked. None removes them: the topper then slides on and off freely.',
    options: [
      { value: 'snug', label: 'Snug' },
      { value: 'normal', label: 'Normal' },
      { value: 'loose', label: 'Loose' },
      { value: 'none', label: 'No ribs' },
    ],
    onChange: (v) => {
      settings.fit = v;
      // The fit IS the ribs — their height, and for None whether there are any. A fit
      // preset that only re-tints a readout is not a control.
      if (v !== 'none') settings.ribHeight = ribHeightForFit(settings.boreClearance, v);
      settings.ribCount = ribCountForFit(v, lastRibCount);
      if (settings.ribCount > 0) lastRibCount = settings.ribCount;
      controls.ribHeight.setValue(settings.ribHeight);
      controls.ribCount.setValue(settings.ribCount);
      syncVisibility();
      refreshSocket();
      refreshPath();
      triggerRebuild();
    },
  });

  const layoutControl = segmentedControl<'horizontal' | 'vertical'>({
    label: 'Layout',
    value: settings.layout,
    help: 'Across reads left to right; stacked runs the letters up the topper in a column.',
    options: [
      { value: 'horizontal', label: 'Across' },
      { value: 'vertical', label: 'Stacked' },
    ],
    onChange: (v) => { settings.layout = v; refreshMount(); syncVisibility(); triggerRebuild(); },
  });

  const mountNote = el('p', { className: 'vl-hint pt-pen-note' });
  const pathNote = el('p', { className: 'vl-hint pt-pen-note' });


  const pathControl = segmentedControl<PenPath>({
    label: 'Pen hole placement',
    value: settings.penPath,
    // One per row. Three across a 280 px panel leaves eight characters each, which is
    // not enough to say what any of them do — stacked, the label can be the
    // explanation and the tooltip stops being load-bearing.
    columns: 1,
    // The long version lives in the tooltip. Three buttons across a 300 px panel get
    // about eight characters each before the label turns into "Right …", and a
    // control you cannot read is worse than one you have to hover.
    help:
      'Inside — bored into the name block, which thickens to fit; the pen stops in it. ' +
      'Through — carries on out the far side, so it slides anywhere along the barrel, a straw or a drawstring. ' +
      'Collar — a separate tube on the plate edge, so the name can stay thin.',
    options: [
      { value: 'inset', label: 'Inside the name' },
      { value: 'through', label: 'Straight through' },
      { value: 'collar', label: 'Separate collar' },
    ],
    onChange: (v) => {
      settings.penPath = v;
      refreshPath();
      syncVisibility();
      triggerRebuild();
    },
  });

  /** One line, and only when it says something the preview cannot: that the block is
   *  being held thicker than the slider asks for. Everything else the buttons and
   *  their tooltip already say, and repeating it in a paragraph under every control
   *  is how a panel ends up more prose than product. */
  function refreshPath() {
    const floor = minPlateThickness(settings);
    const clamped = floor > settings.plateThickness + 0.01;
    pathNote.textContent = clamped
      ? `Block held at ${floor.toFixed(1)} mm — the least that fits a ${boreFor(settings).toFixed(1)} mm hole with ${settings.wallThickness.toFixed(1)} mm walls.`
      : '';
    pathNote.classList.toggle('hidden', !clamped);
  }

  const mountControl = segmentedControl<string>({
    label: 'Which way it faces',
    value: matchMount(settings) ?? MOUNT_PRESETS[0]!.id,
    help: MOUNT_PRESETS.map((m) => `${m.label} — ${m.note}`).join(' '),
    options: MOUNT_PRESETS.map((m) => ({ value: m.id, label: m.label })),
    onChange: (id) => {
      const preset = mountPreset(id);
      if (!preset) return;
      settings.socketAngle = preset.angle;
      settings.socketOffset = preset.offset;
      settings.layout = preset.layout;
      controls.socketAngle.setValue(preset.angle);
      controls.socketOffset.setValue(preset.offset);
      layoutControl.setValue(preset.layout);
      refreshMount();
      syncVisibility();
      triggerRebuild();
    },
  });

  /** Keep the preset row honest: nudging the angle by hand is a custom mount, and a
   *  segmented control still showing "In line" would be lying about the model. */
  function refreshMount() {
    const id = matchMount(settings);
    if (id) mountControl.setValue(id);
    // Only speaks up when the angle has been hand-tuned away from a preset, because
    // then the buttons genuinely do not describe the model any more.
    mountNote.textContent = id ? '' : `Custom angle: ${settings.socketAngle.toFixed(0)}°`;
    mountNote.classList.toggle('hidden', !!id);
  }

  const styleControl = segmentedControl<'raised' | 'engraved'>({
    label: 'Letter style',
    value: settings.style,
    help: 'Raised letters stand off the plate. Engraved sets them flush into it.',
    options: [
      { value: 'raised', label: 'Raised' },
      { value: 'engraved', label: 'Engraved' },
    ],
    onChange: (v) => { settings.style = v; syncVisibility(); triggerRebuild(); },
  });

  const shapeControl = segmentedControl<PlateShape>({
    label: 'Plate behind the letters',
    value: settings.plateShape,
    help:
      'Outline follows the letters like a sticker. Block is a plain rounded rectangle behind them. ' +
      'None takes the plate away altogether: the letters themselves are the body, and they are grown ' +
      'until the pen hole fits inside them.',
    options: [
      { value: 'outline', label: 'Outline' },
      { value: 'rectangle', label: 'Block' },
      { value: 'none', label: 'None' },
    ],
    onChange: (v) => { settings.plateShape = v; syncVisibility(); triggerRebuild(); },
  });

  /** What the auto-grow did, and only when it did something. The size slider still
   *  moves; with no plate it is the size BEFORE the letters are grown to hold the
   *  hole, and a number that quietly stops meaning what it says is worse than a line
   *  of text saying so. */
  const shapeNote = el('p', { className: 'vl-hint pt-pen-note hidden' });
  function refreshShape(letterScale: number) {
    const grown = settings.plateShape === 'none' && letterScale > 1.01;
    shapeNote.textContent = grown
      ? `Letters grown ${letterScale.toFixed(2)}× — to ${(settings.size * letterScale).toFixed(0)} mm — so a ` +
        `${boreFor(settings).toFixed(1)} mm hole fits inside them with ${settings.wallThickness.toFixed(1)} mm walls.`
      : '';
    shapeNote.classList.toggle('hidden', !grown);
  }

  const colorSchemeField = selectField({
    label: 'Colours',
    value: settings.colorScheme,
    help: 'Each colour becomes its own part on its own filament slot in the exported 3MF.',
    options: [
      { value: 'single', label: '1 colour' },
      { value: 'plate-text', label: '2 colours — plate + text' },
      { value: 'plate-halo-text', label: '3 colours — plate + outline + text' },
    ],
    onChange: (v) => {
      settings.colorScheme = v as TopperSettings['colorScheme'];
      syncVisibility();
      refreshPauses();
      triggerRebuild();
    },
  });

  const plateColorRow = filamentRow({
    label: 'Plate',
    value: settings.plateColor,
    onChange: (hex) => { settings.plateColor = hex; triggerRebuild(); },
  });
  const haloColorRow = filamentRow({
    label: 'Outline',
    value: settings.haloColor,
    onChange: (hex) => { settings.haloColor = hex; triggerRebuild(); },
  });
  const textColorRow = filamentRow({
    label: 'Text',
    value: settings.textColor,
    onChange: (hex) => { settings.textColor = hex; triggerRebuild(); },
  });

  const printModeControl = segmentedControl<'ams' | 'noams'>({
    label: 'How will you print it?',
    value: settings.printMode,
    options: [
      { value: 'ams', label: 'AMS / auto' },
      { value: 'noams', label: 'Manual swap' },
    ],
    onChange: (v) => { settings.printMode = v; syncVisibility(); refreshPauses(); triggerRebuild(); },
  });

  const pauseReadout = el('p', { className: 'vl-hint pt-pauses' });
  function refreshPauses() {
    const pauses = noAmsPauses(settings);
    if (settings.printMode !== 'noams') {
      pauseReadout.textContent = 'Each colour lands on its own filament slot automatically.';
    } else if (pauses.length === 0) {
      pauseReadout.textContent = 'Add a second colour with raised letters to use manual swaps.';
    } else {
      pauseReadout.textContent =
        'Pause and swap filament at: ' + pauses.map((p) => `${p.z.toFixed(1)} mm → ${p.label}`).join(', ') + '.';
    }
  }

  const socketReadout = el('p', { className: 'vl-hint pt-socket-readout' });
  /** How deep the last build actually got, which is not always what was asked for. */
  let builtDepth = 0;
  function refreshSocket() {
    const preset = penPreset(settings.pen);
    const bore = boreFor(settings);
    const bite = interferenceFor(settings); // how much barrel the ribs have to give way for
    const outer = (bore / 2 + settings.wallThickness) * 2;
    const body = settings.penPath === 'collar' ? `collar ⌀${outer.toFixed(1)} mm` : `block ${outer.toFixed(1)} mm thick`;
    // Said the way the pen is measured: a gap all round, and what fills it. The
    // diameters are there too, because that is what a caliper reads off the print.
    socketReadout.textContent =
      `${settings.boreClearance.toFixed(2)} mm gap all round a ${settings.barrelDia.toFixed(1)} mm barrel — ` +
      (settings.holeShape === 'hex'
        ? `a hex hole, ${(bore / 1.1547).toFixed(1)} mm across the flats`
        : `a ${bore.toFixed(1)} mm round hole`) +
      (settings.ribCount > 0
        ? ` · ${settings.ribCount} ribs ${settings.ribHeight.toFixed(2)} mm tall ${
            bite > 0.005 ? `stand ${(bite / 2).toFixed(2)} mm proud of it` : bite < -0.005 ? 'stop short of it' : 'fill it exactly'
          }`
        : ' · no ribs — it slides on and off freely') +
      (settings.ribCount <= 0
        ? ''
        : ` · ${
            bite > 0.005
              ? `they squeeze the pen ${bite.toFixed(2)} mm`
              : bite < -0.005
                ? `a light touch, ${(-bite / 2).toFixed(2)} mm short of the barrel`
                : 'contact on the ribs only, no squeeze'
          }`) +
      ` · ${body}` +
      (preset?.hollow && settings.ribHeight > 0.15 + 0.005
        ? ` · held light: a tube folds flat where a barrel would not`
        : '') +
      // The depth earns a place in this line only when the block could not give the
      // slider what it asked for — the answer to "why is the hole so shallow?" and the
      // one thing about the socket the preview cannot show.
      (settings.penPath !== 'through' && builtDepth > 0 && builtDepth < settings.socketDepth - 0.5
        ? ` · only ${builtDepth.toFixed(1)} mm deep — that is as far as the block goes. Make the text bigger, or turn the pen to enter the long way.`
        : '') +
      // A pencil's first 15 mm is eraser and ferrule, not wood. Worth saying when the
      // socket stops inside it.
      (preset?.softEndMm && settings.penPath !== 'through' && builtDepth > 0 && builtDepth < preset.softEndMm
        ? ` · the first ${preset.softEndMm} mm of a pencil is eraser and ferrule, so this one never reaches the wood — go deeper if you want it to hold once the eraser is gone`
        : '') +
      '.';
    penNote.textContent = preset && settings.pen !== 'custom' ? preset.note : '';
    penNote.classList.toggle('hidden', !penNote.textContent);
  }
  const penNote = el('p', { className: 'vl-hint pt-pen-note' });

  // ---------------------------------------------------------------------------
  // 4. FONTS
  // ---------------------------------------------------------------------------
  const fontGrid = el('div', { className: 'pt-font-grid' });

  function fontSample(): string {
    const t = settings.name.trim() || 'Aa';
    return t.length > 6 ? t.slice(0, 5) + '…' : t;
  }

  function makeFontCard(font: FontChoice): HTMLButtonElement {
    const text = settings.name + settings.secondLine;
    const supported = isFontSupported(font, text);
    const btn = button({
      label: '',
      className: `pt-font-card${supported ? '' : ' unsupported'}${font.id === settings.font ? ' active' : ''}`,
      title: supported ? font.label : `${font.label} (characters missing)`,
      onClick: () => selectFont(font.id),
    });
    btn.dataset.font = font.id;
    btn.append(
      el('span', { className: 'pt-font-card__sample', text: fontSample(), attrs: { style: `font-family: ${fontFamilyFor(font.id)}` } }),
      el('span', { className: 'pt-font-card__name', text: font.label }),
    );
    return btn;
  }

  function renderFontGrid() {
    fontGrid.replaceChildren();
    const active = FONTS.find((f) => f.id === settings.font);
    if (active && !active.curated) fontGrid.append(makeFontCard(active));
    for (const font of curatedFonts) fontGrid.append(makeFontCard(font));
  }

  function refreshFontCards() {
    const sample = fontSample();
    const text = settings.name + settings.secondLine;
    for (const btn of fontGrid.querySelectorAll<HTMLButtonElement>('button')) {
      const font = FONTS.find((f) => f.id === btn.dataset.font);
      if (font) btn.classList.toggle('unsupported', !isFontSupported(font, text));
      btn.classList.toggle('active', btn.dataset.font === settings.font);
      const s = btn.querySelector('.pt-font-card__sample');
      if (s) s.textContent = sample;
    }
  }

  function selectFont(id: string) {
    settings.font = id;
    renderFontGrid();
    triggerRebuild();
  }

  function openFontBrowser() {
    let query = '';
    let cat = 'All';
    const categories = ['All', ...Array.from(new Set(FONTS.map((f) => f.category))).sort()];

    const searchField = textField({
      label: 'Search fonts',
      type: 'search',
      placeholder: `Search ${FONTS.length} fonts…`,
      onInput: (v) => { query = v; render(); },
    });
    searchField.field.className = 'pt-fb__search';
    const searchInput = searchField.field;
    const chips = el('div', { className: 'pt-fb__chips' });
    const list = el('div', { className: 'pt-fb__list' });

    // Load each row's face only when it scrolls in; fetching 152 TTFs on open is a
    // second of network for a list nobody has scrolled yet.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const row = entry.target as HTMLElement;
          const preview = row.querySelector<HTMLElement>('.pt-fb__preview');
          if (preview) preview.style.fontFamily = fontFamilyFor(row.dataset.font!);
          io.unobserve(row);
        }
      },
      { root: list, rootMargin: '250px' },
    );

    function render() {
      io.disconnect();
      list.replaceChildren();
      const q = query.trim().toLowerCase();
      const matches = FONTS.filter(
        (f) => (cat === 'All' || f.category === cat) && (!q || f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)),
      );
      if (!matches.length) {
        list.append(el('p', { className: 'pt-fb__empty', text: `No font matches “${query.trim()}”.` }));
        return;
      }
      const sample = settings.name.trim() || 'Sample';
      matches.forEach((f, i) => {
        const preview = el('span', { className: 'pt-fb__preview', text: sample.slice(0, 14) });
        if (i < 30) preview.style.fontFamily = fontFamilyFor(f.id);
        const row = button({
          label: '',
          className: `pt-fb__row${f.id === settings.font ? ' active' : ''}`,
          onClick: () => { selectFont(f.id); handle.close(); },
        });
        row.dataset.font = f.id;
        row.append(preview, el('span', { className: 'pt-fb__meta' }, [
          el('span', { className: 'pt-fb__name', text: f.label }),
          el('span', { className: 'pt-fb__cat', text: f.category }),
        ]));
        list.append(row);
        if (i >= 30) io.observe(row);
      });
    }

    const categoryChips = new Map<string, ReturnType<typeof chip>>();
    for (const c of categories) {
      const catChip = chip({
        label: c,
        pressed: c === cat,
        onToggle: () => {
          cat = c;
          for (const [name, other] of categoryChips) other.setPressed(name === c);
          render();
        },
      });
      categoryChips.set(c, catChip);
      chips.append(catChip);
    }

    const handle = dialog({
      title: 'Choose a font',
      content: el('div', { className: 'pt-fontmodal' }, [searchField, chips, list]),
      wide: true,
    });
    render();
    searchInput.focus();
  }

  const browseFontsBtn = button({
    label: `Browse all ${FONTS.length} fonts →`,
    emphasis: 'secondary',
    className: 'pt-browse',
    onClick: openFontBrowser,
  });

  /**
   * Makes an imported font usable: parsed for the mesh builder, injected as an @font-face
   * for the preview cards, and pushed to the front of the font list.
   *
   * Split out of the import handler because a font now arrives two ways — the user picks a
   * file, or a saved project is opened and its faces come back off disk — and the two have
   * to produce an identical result. Where they drift, opening a project restores every
   * parameter perfectly and silently renders the name in the wrong typeface.
   */
  function registerImportedFont(label: string, buffer: ArrayBuffer): string {
    const id = `custom-${Date.now()}-${importedFontCounter++}`;
    registerCustomFont(id, parseFont(buffer));
    const url = URL.createObjectURL(new Blob([buffer]));
    objectUrls.push(url);
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: '${fontFamilyFor(id)}'; src: url('${url}'); }`;
    document.head.append(style);
    injectedStyles.push(style);
    const choice: FontChoice = {
      id,
      label,
      category: 'Custom',
      curated: true,
      subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'],
    };
    FONTS.unshift(choice);
    curatedFonts.unshift(choice);
    return id;
  }

  /** One typeface, from the file input or from the host's media library. Both hand over a
   *  `File`, so both end up here and neither has to know about the other. */
  async function handleFontFile(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      const label = file.name.replace(/\.[^/.]+$/, '');
      const id = registerImportedFont(label, buffer);

      // Keep the file, not just the parsed font. Without this the import lasts until the
      // app closes, which is the exact behaviour the desktop build exists to fix.
      if (host) {
        try {
          importedFontAssets.push(
            await host.importAsset('font', { name: file.name, bytes: new Uint8Array(buffer) }),
          );
        } catch {
          toast(`"${file.name}" is usable now but could not be kept for next time`, { kind: 'warn' });
        }
      }

      selectFont(id);
      toast(`Imported ${label}`, { kind: 'ok' });
    } catch {
      toast('That file is not a font this reader understands', { kind: 'error' });
    }
  }

  const importFontCta = uploadCta({
    label: 'Import a .ttf / .otf',
    accept: '.ttf,.otf',
    onFiles: (files) => {
      const file = files[0];
      if (file) void handleFontFile(file);
    },
  });
  // The host's library goes first when there is one: a typeface imported for one topper is
  // the most likely answer for the next. The click is intercepted before the label opens
  // the hidden input, and `onFiles` alone still serves the no-host path.
  importFontCta.addEventListener('click', (e) => {
    if (!host?.pickMedia) return;
    e.preventDefault();
    void chooseFile(host, { kind: 'font', extensions: ['ttf', 'otf'] }, () => {}).then((f) => {
      if (f) void handleFontFile(f);
    });
  });

  const objectUrls: string[] = [];
  const injectedStyles: HTMLStyleElement[] = [];
  /** Imported typefaces as the host stored them, so a saved project travels with the faces
   *  it was built in rather than coming back in the fallback one. */
  const importedFontAssets: HostAsset[] = [];
  let importedFontCounter = 0;

  // The symbol picker renders its glyphs in the fallback face, so it needs the rule.
  const fallbackUrl = getFontUrl(FALLBACK_FONT_ID);
  if (fallbackUrl) {
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: '${fontFamilyFor(FALLBACK_FONT_ID)}'; src: url(${fallbackUrl}); }`;
    document.head.append(style);
    injectedStyles.push(style);
  }

  // ---------------------------------------------------------------------------
  // 5. VISIBILITY — controls that do not apply are hidden, not disabled.
  // ---------------------------------------------------------------------------
  function syncVisibility() {
    const twoLines = settings.layout === 'horizontal' && settings.secondLine.trim() !== '';
    secondField.classList.toggle('hidden', settings.layout === 'vertical');
    controls.line2Scale.classList.toggle('hidden', !twoLines);
    controls.lineSpacing.classList.toggle('hidden', !twoLines && settings.layout !== 'vertical');

    controls.chamferSize.classList.toggle('hidden', !settings.chamferOn);
    controls.ribHeight.classList.toggle('hidden', settings.ribCount === 0);
    // A bore that goes right through has no depth to set.
    controls.socketDepth.classList.toggle('hidden', settings.penPath === 'through');
    // With no plate the hole does not go where a slider says; it goes down the middle
    // of the band of material the letters actually offer, which is the only place it
    // fits. A control that has stopped doing anything is worse than one that is gone.
    controls.socketOffset.classList.toggle(
      'hidden',
      settings.plateShape === 'none' && settings.penPath !== 'collar',
    );
    // The barrel measurement belongs to the pen, not to the design. It appears only
    // when there is no preset to speak for it — otherwise it sits there inviting a
    // drag that silently contradicts the dropdown right above it.
    controls.barrelDia.classList.toggle('hidden', settings.pen !== 'custom');

    const hasHalo = settings.colorScheme === 'plate-halo-text';
    controls.haloWidth.classList.toggle('hidden', !hasHalo);
    controls.haloThickness.classList.toggle('hidden', !hasHalo || settings.style !== 'raised');
    haloColorRow.classList.toggle('hidden', !hasHalo);
    textColorRow.classList.toggle('hidden', settings.colorScheme === 'single');

    const swappable = settings.style === 'raised' && settings.colorScheme !== 'single';
    printModeControl.classList.toggle('hidden', !swappable);
    pauseReadout.classList.toggle('hidden', !swappable);
    controls.layerHeight.classList.toggle('hidden', !swappable || settings.printMode !== 'noams');
  }

  /** Push `settings` back into every control — after Load, or a shared link. */
  function syncControls() {
    controls.size.setValue(settings.size);
    controls.plateThickness.setValue(settings.plateThickness);
    controls.textThickness.setValue(settings.textThickness);
    controls.outlineWidth.setValue(settings.outlineWidth);
    controls.smoothing.setValue(settings.smoothing);
    controls.chamfer.setValue(settings.chamferOn);
    controls.chamferSize.setValue(settings.chamfer);
    controls.socketAngle.setValue(settings.socketAngle);
    controls.socketOffset.setValue(settings.socketOffset);
    controls.barrelDia.setValue(settings.barrelDia);
    controls.socketDepth.setValue(settings.socketDepth);
    controls.wallThickness.setValue(settings.wallThickness);
    controls.ribCount.setValue(settings.ribCount);
    controls.ribHeight.setValue(settings.ribHeight);
    controls.ribCount.setValue(settings.ribCount);
    fitControl.setValue(settings.ribCount <= 0 ? 'none' : settings.fit);
    pathControl.setValue(settings.penPath);
    controls.haloWidth.setValue(settings.haloWidth);
    controls.haloThickness.setValue(settings.haloThickness);
    controls.boldness.setValue(settings.boldness);
    controls.letterSpacing.setValue(settings.letterSpacing);
    controls.lineSpacing.setValue(settings.lineSpacing);
    controls.line2Scale.setValue(settings.line2Scale);
    controls.layerHeight.setValue(settings.layerHeight);
    nameField.setValue(settings.name);
    secondField.setValue(settings.secondLine);
    penSelect.setValue(settings.pen);
    holeShapeControl.setValue(settings.holeShape);
    plateColorRow.setValue(settings.plateColor);
    haloColorRow.setValue(settings.haloColor);
    textColorRow.setValue(settings.textColor);
    shapeControl.setValue(settings.plateShape);
    refreshShape(1);
    layoutControl.setValue(settings.layout);
    renderFontGrid();
    refreshPath();
    refreshMount();
    syncVisibility();
    refreshSocket();
    refreshPauses();
  }

  // ---------------------------------------------------------------------------
  // 6. CHROME
  // ---------------------------------------------------------------------------
  const quality = qualityCallout({
    html: `For the best result, use the print profile on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
    storageKey: 'pen-topper-quality-callout',
  });

  const footer = sidebarFooter({
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: async (format) => {
      if (parts.length === 0) return toast('Nothing to export yet', { kind: 'warn' });
      if (format !== '3mf') throw new Error('Unknown format: ' + format);

      const meta = {
        title: setResults ? 'Pen Topper set' : 'Pen Topper',
        generator: 'pen-topper',
        application: 'Vostok Labs Pen Topper Generator',
        buildId: import.meta.env.VITE_BUILD_ID,
      };

      /**
       * One file out, wherever this generator is running.
       *
       * With a host it does not land in Downloads for the user to go and find — it lands
       * in their library and shows up in the grid, which is the whole reason the desktop
       * bundle exists. Without one it is the download it always was.
       */
      const deliver = async (bytes: Uint8Array, fileName: string, mime: string) => {
        if (host) {
          const { indexed } = await host.exportToLibrary(
            { name: fileName, bytes },
            { designer: 'Pen Topper Generator' },
          );
          toast(indexed ? 'Exported to your library' : `Exported as ${fileName}`, { kind: 'ok' });
          return;
        }
        // The cast is the TS 5.7 `Uint8Array<ArrayBufferLike>` vs `BlobPart` mismatch, not a
        // real one: nothing here ever produces a SharedArrayBuffer-backed view.
        downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
      };

      if (setResults) {
        const plates = platesOf(setResults);
        const stem = setFileName(setResults.map((r) => r.label));
        if (plates.length === 1) {
          await deliver(buildThreeMF(batchToParts(setResults, plates[0]!), meta), `${stem}.3mf`, 'model/3mf');
        } else {
          /*
            One file per plate, zipped. A plate is a print, and a print is a file —
            merging two plates into one 3MF would put a second plate's worth of toppers
            inside the first one's bed, overlapping.

            Stored, not deflated: a 3MF is already a deflated zip, so compressing it
            again costs seconds and saves nothing.
          */
          const files: Record<string, Uint8Array> = {};
          for (const n of plates) files[`${stem}-plate-${n + 1}.3mf`] = buildThreeMF(batchToParts(setResults, n), meta);
          await deliver(zipSync(files, { level: 0 }), `${stem}.zip`, 'application/zip');
        }
      } else {
        const slug = settings.name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'pen';
        await deliver(buildThreeMF(parts, meta), `${slug}-pen-topper.3mf`, 'model/3mf');
      }

      downloads += 1;
      if (downloads === 1) openLicenseModal({ badge: '✓ 3MF export started' });
      else licenseReminderToast();
    },
    // The host draws Save and Open itself once it owns projects; two Save buttons that do
    // different things is worse than either one alone. `Boolean(...)` and not `isDesktop()`:
    // a desktop host that does not offer the capability still needs these.
    hostOwnsProjects: Boolean(host?.registerProject),
    onSave: () => downloadJSON(`${settings.name.trim() || 'pen'}-topper.json`, settings),
    onLoad: (file?: File) =>
      file &&
      loadJSON(file, (data) => {
        applySettings(data);
        toast('Project loaded', { kind: 'ok' });
      }),
    onHelp: () =>
      dialog({
        title: 'Pen Topper help',
        content: el('div', {}, [
          el('p', { text: 'Type a name or drop in a symbol, pick a font, then tell it which pen you own — that sets the socket.' }),
          el('p', { text: 'Where the hole goes is the big decision. “In the name” bores it into the name block itself, which thickens to fit — the solid pencil topper you see in shops. “Right through” carries on out the far side, so it slides anywhere along the barrel, or onto a straw. “Collar” hangs a separate tube off the edge and leaves the name thin.' }),
          el('p', { text: 'It prints flat, face up, with no supports. The bore is horizontal and capped with a 45° roof so it holds itself up, and the little ribs inside are what actually grip the pen.' }),
          el('p', { text: 'If the topper will not go on, set Fit to Loose or lower the rib height. If it falls off, go Snug or raise the ribs. Do not chase it with the barrel diameter — that is the pen’s measurement, not a tuning knob.' }),
          el('p', { text: 'Export 3MF, open it in Bambu Studio or Orca, and each colour is already on its own filament slot.' }),
        ]),
        actions: [{ label: 'Got it', primary: true }],
      }),
    themeStorageKey: 'pen-topper-theme',
  });

  // ---------------------------------------------------------------------------
  // 5b. THE SET — one design, many names, laid out on the plate.
  //
  // A set is a MODE, not a second application. The shell does not move: the same
  // stage shows the plate instead of one topper, and the same Download button sends
  // the plate instead of the one. The alternative — a set builder in its own window
  // with its own preview and its own export — is a thing you leave the generator to
  // use, and everything you tuned on the way in has to be reachable from inside it.
  // (The keycap generator learned this the expensive way; see the note at the top of
  // its `pro/setMode.js`.)
  // ---------------------------------------------------------------------------

  /** Non-null while the stage is showing a set rather than the single topper. */
  let setResults: BatchResult[] | null = null;
  /** Which plate of a multi-plate set is on screen. */
  let shownPlate = 0;
  /** True from the moment a batch is posted until `batchDone`. */
  let batchRunning = false;

  const namesField = textareaField({
    label: 'Names, one per line',
    rows: 8,
    placeholder: 'One name per line\n\nAlex\nSam\nMaya\nJordan',
    onInput: () => refreshNamesCount(),
  });
  const namesInput = namesField.field;
  // The icon face has to be in the stack, or a symbol pasted into the list renders as a
  // tofu box — the same trap the single-name field had, and for the same reason: a
  // generic family at the end of a stack never falls through.
  namesInput.style.fontFamily = `'Chakra Petch', '${fontFamilyFor(FALLBACK_FONT_ID)}', system-ui, sans-serif`;

  const namesCount = el('p', { className: 'vl-hint pt-names-count' });
  const namesWarn = el('p', { className: 'vl-hint pt-names-warn' });
  const batchProgress = el('p', { className: 'vl-hint pt-batch-progress hidden' });

  const buildSetBtn = button({
    label: 'Build the set',
    emphasis: 'primary',
    className: 'pt-batch-go',
    onClick: () => void buildSet(),
  });

  const backToOneBtn = button({
    label: 'Back to one topper',
    emphasis: 'secondary',
    className: 'pt-batch-go hidden',
    onClick: () => {
      setResults = null;
      shownPlate = 0;
      refreshSetUi();
      firstBuild = true;
      triggerRebuild();
    },
  });

  const plateNav = el('div', { className: 'pt-plate-nav hidden' });

  /** What the list currently says, capped. */
  function currentNames(): string[] {
    return parseNames(namesInput.value).slice(0, MAX_NAMES);
  }

  /**
   * The count line, and the one number that decides whether this is one print.
   *
   * The footprint is estimated from the LAST single build, not measured — every name is
   * a different width and nothing is built yet. It is honest about that: the real plate
   * count comes back from the build and replaces this.
   */
  function refreshNamesCount() {
    const names = currentNames();
    const over = parseNames(namesInput.value).length - names.length;
    const size = plateSize(loadPlateChoice());
    const last = lastSize;
    let fit = '';
    if (names.length && last) {
      const perRow = Math.max(1, Math.floor((size[0] - 12) / (last[0] + 3)));
      const rows = Math.ceil(names.length / perRow);
      const needed = rows * (last[1] + 3);
      fit = ` · about ${rows} row${rows === 1 ? '' : 's'}, ${
        needed <= size[1] - 12 ? 'one plate' : 'more than one plate'
      }`;
    }
    namesCount.textContent = names.length
      ? `${names.length} name${names.length === 1 ? '' : 's'}${fit}`
      : 'Nothing in the list yet.';
    namesWarn.textContent = over > 0 ? `Only the first ${MAX_NAMES} are used — ${over} ignored.` : '';
    namesWarn.classList.toggle('hidden', over <= 0);
    buildSetBtn.setDisabled(names.length === 0 || batchRunning);
  }

  /** Lay every name out on this thread, then hand the whole list to the worker. */
  async function buildSet() {
    const names = currentNames();
    if (!names.length || batchRunning) return;

    batchRunning = true;
    buildSetBtn.setDisabled(true);
    buildSetBtn.setLabel('Building…');
    batchProgress.classList.remove('hidden');
    batchProgress.textContent = `Laying out ${names.length} names…`;

    try {
      const [font, fallbackFont] = await Promise.all([
        getFont(settings.font),
        getFont(FALLBACK_FONT_ID).catch(() => null),
      ]);
      const line2Size = settings.size * settings.line2Scale;
      const lineFactor = baseLineFactor(settings.font) * settings.lineSpacing;

      const items = names.map((name) => {
        // Every setting except the text comes from the panel as it stands. That IS the
        // feature: the set is the topper you approved, repeated.
        const laid =
          settings.layout === 'vertical'
            ? getVerticalContours(font, fallbackFont, name, settings.size, settings.lineSpacing, settings.letterSpacing)
            : getHorizontalContours(
                font, fallbackFont, name, settings.secondLine, settings.size, line2Size, 0,
                settings.line2Align, lineFactor, settings.letterSpacing, { alignMode: 'block' },
              );
        return { label: name, textContours: laid.contours, params: { ...settings, name, lines: laid.lines } };
      });

      worker.postMessage({ type: 'batch', items, plate: plateSize(loadPlateChoice()) });
    } catch (err) {
      batchRunning = false;
      buildSetBtn.setDisabled(false);
      buildSetBtn.setLabel('Build the set');
      batchProgress.classList.add('hidden');
      toast(err instanceof Error ? err.message : 'Could not lay out the names', { kind: 'error' });
    }
  }

  /** Show one plate of the set in the viewer. */
  function showPlate(n: number) {
    if (!setResults) return;
    shownPlate = n;
    parts = batchToParts(setResults, n);
    viewer.setParts(parts, true);
    refreshSetUi();
  }

  /** Point the drawer's controls at whichever mode is live. */
  function refreshSetUi() {
    const on = !!setResults;
    backToOneBtn.classList.toggle('hidden', !on);
    buildSetBtn.setLabel(on ? 'Rebuild the set' : 'Build the set');
    plateNav.replaceChildren();
    const plates = setResults ? platesOf(setResults) : [];
    plateNav.classList.toggle('hidden', plates.length < 2);
    if (plates.length >= 2) {
      const nav = segmentedControl<string>({
        label: 'Plate',
        value: String(shownPlate),
        options: plates.map((n) => ({ value: String(n), label: String(n + 1) })),
        onChange: (v) => showPlate(Number(v)),
      });
      plateNav.append(nav);
    }
  }

  const batchBtn = button({
    label: 'Make a set of names…',
    emphasis: 'secondary',
    className: 'pt-batch-open',
    onClick: () => {
      if (!namesInput.value.trim()) namesInput.value = settings.name.trim();
      refreshNamesCount();
      drawer({
        title: 'Make a set',
        content: el('div', { className: 'pt-batch' }, [
          el('p', {
            className: 'vl-hint',
            text: 'Every topper gets the design you have set up — font, colours, pen, all of it. Only the text changes.',
          }),
          namesField,
          namesCount,
          namesWarn,
          batchProgress,
          buildSetBtn,
          plateNav,
          backToOneBtn,
        ]),
      });
      namesInput.focus();
    },
  });

  const status = stageStatus('Starting the geometry worker…');
  const stageCanvas = el('div', { className: 'pt-stage-canvas' });

  const shell = appShell({
    topbar: topbarLinks({ githubUrl: BRAND.urls.github, boostUrl: BRAND.urls.makerworld, themeToggle: false }),
    left: {
      scroll: [
        generatorHeader({
          title: 'Pen Topper Generator',
          description: 'Name it, cap it, print it. A topper that actually stays on the pen.',
        }),
        ...(quality ? [quality] : []),
        /*
          Every group on this panel is a `collapsibleSection`, and that uniformity is the
          point. It used to be five plain sections followed by three collapsible ones, so
          half the headings could be folded away and half could not, with nothing on
          screen to say which was which. The numbered ones open by default because they
          are the job; the last one does not because it is the exceptions.
        */
        collapsibleSection({
          title: '1 · What it says',
          body: [nameField, secondField, quickRow, symbolBtn, layoutControl, batchBtn],
        }),
        collapsibleSection({
          title: '2 · Which pen',
          body: [penSelect, penNote, controls.barrelDia, holeShapeControl, fitControl, socketReadout],
        }),
        collapsibleSection({
          title: '3 · How it sits on the pen',
          body: [pathControl, pathNote, mountControl, mountNote],
        }),
        collapsibleSection({
          title: '4 · Look',
          body: [shapeControl, shapeNote, styleControl, controls.size, controls.plateThickness],
        }),
        // Colour lives here, with the rest of the design decisions. It sat in the right
        // panel next to the printing settings, which put "what it looks like" on one side
        // of the screen and "how many filaments" on the other.
        collapsibleSection({
          title: '5 · Colours',
          body: [
            colorSchemeField,
            el('div', { className: 'pt-colors' }, [plateColorRow, haloColorRow, textColorRow]),
          ],
        }),
        /*
          One drawer for everything you only open when something is wrong, sub-headed
          rather than split. Three separate collapsibles put three-quarters of the panel's
          headings into the part of it nobody needs — and made "which of these three holds
          the wall thickness?" a question you had to answer by opening all of them.

          `open: false` is explicit: the kit's collapsible defaults to OPEN, so leaving it
          off would put fifteen sliders back on screen and make the folding decorative.
        */
        collapsibleSection({
          open: false,
          title: 'Fine tuning',
          body: [
            el('p', { className: 'vl-label pt-subhead', text: 'Socket' }),
            controls.socketAngle,
            controls.socketOffset,
            controls.socketDepth,
            controls.wallThickness,
            controls.ribCount,
            controls.ribHeight,
            el('p', { className: 'vl-label pt-subhead', text: 'Text' }),
            controls.boldness,
            controls.letterSpacing,
            controls.lineSpacing,
            controls.line2Scale,
            controls.smoothing,
            el('p', { className: 'vl-label pt-subhead', text: 'Plate' }),
            controls.textThickness,
            controls.outlineWidth,
            controls.chamfer,
            controls.chamferSize,
            controls.haloWidth,
            controls.haloThickness,
          ],
        }),
      ],
    },
    stage: [
      stageCanvas,
      el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
      status.root,
      el('p', { className: 'vl-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' }),
    ],
    right: {
      scroll: [
        section({ title: 'Font', body: [fontGrid, browseFontsBtn, importFontCta] }),
        section({
          title: 'Printing',
          body: [
            printModeControl,
            controls.layerHeight,
            pauseReadout,
            presetShareButton({ getParams: () => ({ ...settings }), label: 'Copy a link to this design' }),
          ],
        }),
      ],
      footer: [footer],
    },
  });

  container.append(shell.root);

  const viewer = createViewer(stageCanvas);
  mountPlatePicker(shell.stage, viewer);

  syncControls();
  worker.postMessage({ type: 'init' });

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
    getState: () => settings,
    applyState: async (loaded, assets) => {
      // Fonts first. Applying the parameters before the typeface they name is registered
      // lays the name out in the fallback face and then never rebuilds it.
      if (assets) await restoreFonts(assets);
      applySettings(loaded);
    },
    assets: () => importedFontAssets,
    capturePreview,
    suggestName: () => settings.name.trim() || 'Pen topper',
  });

  /**
   * Everything this generator has to give back.
   *
   * It used to be a `beforeunload` listener, which is the right hook for a browser tab:
   * there is only ever one generator in it and the page is going away regardless. Inside a
   * host it never fires — the user moves from one generator to the next without the
   * document ever unloading — so the worker, the WebGL context, the object URLs and the
   * injected @font-face rules would all survive, one more set of them per visit.
   */
  const teardown = () => {
    // Dialogs and drawers render on <body>, outside the container the host clears.
    closeAllDialogs();
    closeAllDrawers();
    clearTimeout(rebuildTimer);
    worker.terminate();
    viewer.dispose();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    for (const style of injectedStyles) style.remove();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.replaceChildren();
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function downloadBlob(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadJSON(name: string, data: unknown) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadJSON(file: File, apply: (data: unknown) => void) {
    const r = new FileReader();
    r.onload = () => {
      try {
        apply(JSON.parse(r.result as string));
      } catch {
        toast('Invalid project file', { kind: 'error' });
      }
    };
    r.readAsText(file);
  }

  /** Put a saved parameter blob back on screen. Both load paths — the web's file picker
   *  and the host's project browser — come through here, so they cannot drift apart. */
  function applySettings(data: unknown): void {
    settings = coerceSettings(data);
    syncControls();
    firstBuild = true;
    triggerRebuild();
  }

  /**
   * Re-registers the typefaces a saved project was built with.
   *
   * Without this, opening a project that used an imported font falls back to a different
   * face: every parameter restores perfectly, the topper is wrong, and nothing on screen
   * says so — which is worse than an error.
   */
  async function restoreFonts(assets: HostAsset[]): Promise<void> {
    if (!host) return;
    for (const asset of assets) {
      if (asset.role !== 'font') continue;
      if (importedFontAssets.some((a) => a.path === asset.path)) continue;
      try {
        const bytes = await host.readAsset(asset.path);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        registerImportedFont(asset.originalName.replace(/\.[^/.]+$/, ''), buffer);
        importedFontAssets.push(asset);
      } catch {
        toast(`Could not load the font "${asset.originalName}"`, { kind: 'warn' });
      }
    }
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

  return teardown;
}
