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
  sourceCards,
  dropZone,
  sampleGrid,
  modeBar,
  stagePanel,
  stepper,
  stageStatus,
  sliderRow,
  toggleSwitch,
  button,
  panelCredit,
  toast,
  dialog,
  licenseAfterExport,
  buildLoop,
  syncControls,
  readProjectFile,
  markProject,
  colorSwatch,
  ICONS,
  el,
  type ProjectShape,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice } from '@vostok/plates';
import { downloadThreeMF, downloadFile, type ExportPart } from '@vostok/export';
import { DEFAULT_SETTINGS, coerceSettings, type TagSettings, type RGB } from './state';
import { buildTag } from './geometry';
import { CHANGELOG } from './changelog';

/*
  Vostok Labs generator template — a small but COMPLETE generator.

  It runs as-is: change a slider, watch the model rebuild, export a real 3MF.
  Copy this app, then replace the demo geometry with yours. Everything else —
  layout, panels, stage overlays, the build plate, export — already matches the
  rest of the catalogue.

  WHERE THINGS GO (the house layout; keep it, or the generators drift apart):

    topbar        GitHub · commercial licence · MakerWorld · Ko-fi   (ui-kit)
    LEFT panel    header -> quality callout -> YOUR SETTINGS
    STAGE         the 3D preview, plus its overlays:
                    top-left      "Live 3D Preview" label
                    top-centre    mode bar (what a click on the model does)
                    top-right     build-plate picker
                    bottom-left   status line
                    bottom-centre the active mode's panel
                    bottom-right  "hold left click to rotate" hint
    RIGHT panel   inputs (upload / samples), colours, results
                  ...and its FOOTER holds Export / Save / Load / Help / Theme

  Read the numbered sections below in order.
*/

// ---------------------------------------------------------------------------
// 1. STATE — see state.ts. Save/Load serialise this object.
// ---------------------------------------------------------------------------
let settings: TagSettings = { ...DEFAULT_SETTINGS };
let parts: ExportPart[] = [];

/** A project file is these settings with the app's id: Save writes the id, and Load refuses a
 *  file another app saved, or one without these keys. Keep to settings every saved file has had
 *  (one added later would refuse the files saved before it); `satisfies` stops the build when
 *  they are no longer settings. */
const PROJECT_FILE: ProjectShape = {
  app: 'generator-template',
  keys: ['width', 'height'] satisfies (keyof TagSettings)[],
};

// ---------------------------------------------------------------------------
// 2. REBUILD — the kit's build loop. It runs one build at a time, always from the
//    newest settings, and a burst of slider moves costs one build. Download waits on
//    it (`loop.settled()` in section 5), so a click a beat after a slider can never
//    export the model from before the slider moved, and a failed build is refused
//    rather than replaced by the last good one.
//    Heavy generators build in a worker: `run` returns the worker's answer, from
//    `workerClient()` in the kit, with `answerRequests()` inside the worker. This one
//    is instant, so it builds inline.
// ---------------------------------------------------------------------------
let refitNext = false;
let started = 0;
const loop = buildLoop<ExportPart[]>({
  run: () => {
    started = performance.now();
    return buildTag(settings);
  },
  onResult: (built) => {
    parts = built;
    viewer.setParts(parts, refitNext);
    refitNext = false;
    const tris = parts.reduce((n, p) => n + p.indices.length / 3, 0);
    status.set(
      `${settings.width} × ${settings.height} × ${(settings.thickness + (settings.rim > 0 ? settings.rimHeight : 0)).toFixed(1)} mm` +
        ` · ${parts.length} part${parts.length === 1 ? '' : 's'} · ${tris} triangles · ${Math.round(performance.now() - started)} ms`,
    );
  },
  onError: (err) => status.set(`Could not build the model: ${err.message}`, 'error'),
});

function triggerRebuild(refit = false) {
  if (refit) refitNext = true;
  loop.request();
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel) — your controls. Delete the ones you don't need.
// ---------------------------------------------------------------------------
const rimEnabled = () => settings.rim > 0;
let lastRim = DEFAULT_SETTINGS.rim || 2;

// Every control is kept in a named handle so Load-project can push the loaded
// values straight back into the UI — a generator whose sliders don't follow a
// loaded project always feels broken. Never build a control inline inside a
// section's body: a control nobody holds a handle to can never be synced.
const controls = {
  width: sliderRow({
    label: 'Width', min: 20, max: 120, step: 1, value: settings.width, unit: 'mm',
    onInput: (v) => { settings.width = v; triggerRebuild(); },
  }),
  height: sliderRow({
    label: 'Height', min: 15, max: 120, step: 1, value: settings.height, unit: 'mm',
    onInput: (v) => { settings.height = v; triggerRebuild(); },
  }),
  thickness: sliderRow({
    label: 'Thickness', min: 1, max: 10, step: 0.2, value: settings.thickness, unit: 'mm',
    help: 'Every control takes an optional "?" tooltip. Use it instead of a paragraph of hint text.',
    onInput: (v) => { settings.thickness = v; syncThickness(); triggerRebuild(); },
  }),
  radius: sliderRow({
    label: 'Corner radius', min: 0, max: 15, step: 0.5, value: settings.radius, unit: 'mm',
    onInput: (v) => { settings.radius = v; triggerRebuild(); },
  }),
  hole: sliderRow({
    label: 'Hanging hole', min: 0, max: 10, step: 0.5, value: settings.hole, unit: 'mm',
    help: 'Set to 0 for no hole.',
    onInput: (v) => { settings.hole = v; triggerRebuild(); },
  }),
  rim: toggleSwitch({
    label: 'Raised rim',
    checked: rimEnabled(),
    onChange: (on) => {
      settings.rim = on ? lastRim : 0;
      controls.rimWidth.classList.toggle('hidden', !on);
      triggerRebuild();
    },
  }),
  rimWidth: sliderRow({
    label: 'Rim width', min: 0.8, max: 8, step: 0.2, value: settings.rim || lastRim, unit: 'mm',
    onInput: (v) => { lastRim = v; if (rimEnabled()) { settings.rim = v; triggerRebuild(); } },
  }),
};

/**
 * Put `settings` into every control, and keep only what the controls can show. Run it after
 * anything that changes settings without the user touching a control: Load, Reset, a share
 * link, undo.
 *
 * The kit's `syncControls` does the one-to-one fields, and writes each control's clamped value
 * back. That is what stops a loaded project with `width: 400` building 400 mm behind a slider
 * that shows 120. Settings that are not one-to-one (the rim switch stands for `rim > 0`) are
 * done by hand below, and must clamp the same way.
 */
function showSettings() {
  syncControls(settings, {
    width: controls.width,
    height: controls.height,
    thickness: controls.thickness,
    radius: controls.radius,
    hole: controls.hole,
  });
  controls.rim.setValue(rimEnabled());
  if (rimEnabled()) lastRim = settings.rim;
  controls.rimWidth.setValue(lastRim);
  lastRim = controls.rimWidth.getValue();
  if (rimEnabled()) settings.rim = lastRim;
  controls.rimWidth.classList.toggle('hidden', !rimEnabled());
  syncThickness();
}

const shapeSection = collapsibleSection({
  title: '1 · Shape',
  body: [controls.width, controls.height, controls.thickness, controls.radius],
});

/*
  A button — and the single most important line in this file to copy.

  It comes from the kit. `.vl-btn` and its whole ladder (primary, secondary, ghost, icon,
  block, busy) have been in the kit's base.css since it shipped, but for a long time there
  was no `button()`, so every app wrote its own `<button>` and tried to remember the class
  by hand. Mostly they did not: the catalogue is full of `class="tab"`, `class="primary"`
  and `class="switch-pad-btn"`, none of which the kit defines, which is why fixing one
  button never once fixed the others.

  So: never hand-write a control. `button`, `iconButton`, `buttonRow`, `toggleSwitch`,
  `sliderRow`, `segmentedControl`, `selectField`, `dpad`, `dropZone`, `dialog`, `toast`.
  If the kit cannot express what you need, widen the kit — do not style your way around
  it here. `pnpm check:ui` fails the build the moment a hand-built one appears.
*/
const resetButton = button({
  label: 'Reset to defaults',
  emphasis: 'secondary',
  icon: ICONS.rotateLeft,
  block: true,
  onClick: () => {
    settings = { ...DEFAULT_SETTINGS };
    showSettings();
    syncColorInputs();
    triggerRebuild(true);
    toast('Settings reset', { kind: 'ok' });
  },
});

const detailSection = collapsibleSection({
  title: '2 · Details',
  body: [controls.hole, controls.rim, controls.rimWidth, resetButton],
});

// ---------------------------------------------------------------------------
// 4. INPUTS & OUTPUT (right panel) — the upload / sample patterns, and colours.
//    The demo tag has nothing to import, so this section reports what it was
//    given rather than driving geometry: it's here as the correctly-styled
//    markup to wire your own importer into. Delete it if you don't import.
// ---------------------------------------------------------------------------
const preview = el('img', { className: 'tpl-preview', attrs: { alt: '' } }) as HTMLImageElement;
const previewWrap = el('div', { className: 'tpl-preview-wrap hidden' }, [preview]);

function acceptImage(src: string, label: string) {
  preview.src = src;
  previewWrap.classList.remove('hidden');
  preview.onload = () => status.set(`Loaded ${label} · ${preview.naturalWidth} × ${preview.naturalHeight} px`);
  preview.onerror = () => status.set(`Could not read ${label}`, 'error');
}

const SAMPLES = ['#5b9dff', '#36c08a', '#fbbf24', '#ef4444'].map((c, i) => ({
  id: `sample-${i}`,
  label: `Sample ${i + 1}`,
  // Inline SVG data URIs so the template has no binary assets to carry around.
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${c}"/>` +
        `<text x="32" y="42" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`,
    ),
}));

const drop = dropZone({
  title: 'Drop an image',
  text: 'or click to browse',
  note: 'PNG, JPG or SVG',
  accept: 'image/*',
  onFiles: ([file]) => {
    if (!file) return;
    acceptImage(URL.createObjectURL(file), file.name);
  },
});

const textNote = el('p', {
  className: 'vl-hint',
  text: 'The Text source would go here. Sources swap what this panel shows — one card per input your generator accepts.',
});
textNote.classList.add('hidden');

const sources = sourceCards({
  options: [
    { value: 'image', label: 'Image', icon: ICONS.image },
    { value: 'text', label: 'Text', icon: ICONS.text },
  ],
  value: 'image',
  onChange: (v) => {
    drop.classList.toggle('hidden', v !== 'image');
    previewWrap.classList.toggle('hidden', v !== 'image' || !preview.src);
    textNote.classList.toggle('hidden', v !== 'text');
  },
});

const inputSection = section({
  title: 'Input',
  body: [
    sources.root,
    drop,
    textNote,
    previewWrap,
    sampleGrid({
      heading: 'Or start from a sample',
      items: SAMPLES,
      onPick: (item) => acceptImage(item.src, item.label),
    }),
  ],
});

// Colours: one swatch per part, which is also what drives the filament slots
// in the exported 3MF.
const toHex = (c: RGB) => `#${c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

function colorRow(label: string, get: () => RGB, set: (rgb: RGB) => void, partIndex: number) {
  const swatch = colorSwatch({
    value: toHex(get()),
    label,
    onChange: (hex) => {
      const rgb: RGB = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      set(rgb);
      // Recolour in place — a colour change needs no geometry rebuild. It does
      // need to reach `parts`, which is what the exporter reads.
      const part = parts[partIndex];
      if (part) part.color = rgb;
      viewer.setPartColor(partIndex, rgb);
    },
  });
  return { row: el('div', { className: 'vl-switch-row' }, [el('span', { text: label }), swatch]), swatch, get };
}

const colorRows = [
  colorRow('Tag', () => settings.bodyColor, (c) => (settings.bodyColor = c), 0),
  colorRow('Rim', () => settings.rimColor, (c) => (settings.rimColor = c), 1),
];

function syncColorInputs() {
  for (const r of colorRows) r.swatch.setValue(toHex(r.get()));
}

const colourSection = section({
  title: 'Colours',
  body: colorRows.map((r) => r.row),
});

// ---------------------------------------------------------------------------
// 5. CHROME — callout + the export/save/load/help footer.
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html: `For the best print, use the profile on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
  storageKey: 'template-quality-callout',
});

const footer = sidebarFooter({
  // 3MF only, exactly as every shipped generator does it. A separate STL button
  // is a downgrade offered at the moment of success: STL carries no colours and
  // no part split, so anyone who takes it loses the whole point of the model.
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async (format) => {
    if (format !== '3mf') throw new Error('Unknown format: ' + format);
    // The build that matches the screen. Waits for one still running; refuses, with the
    // reason as a toast from the export panel, if it failed or nothing is built yet. Never
    // export `parts` directly: that is whichever build finished last.
    const built = await loop.settled();
    downloadThreeMF(built, {
      title: 'Tag',
      generator: 'generator-template',
      application: 'Vostok Labs Generator Template',
      buildId: import.meta.env.VITE_BUILD_ID,
      // Centred on the plate the user picked, not on the profile's A1.
      plateSize: plateSize(loadPlateChoice()),
    }, 'tag.3mf');

    // Full modal on the first download, corner reminder after (invariant #3).
    licenseAfterExport();
  },
  onSave: () =>
    downloadFile(JSON.stringify(markProject(PROJECT_FILE, settings), null, 2), 'tag-project.json', 'application/json'),
  // `sidebarFooter`'s onLoad hands back `File | undefined` — the picker can be dismissed
  // with nothing chosen. Guarding is what every shipped generator does, and without it the
  // template does not typecheck, which is a poor start for the thing everything is copied
  // from. The kit runs the loader inside its own guard: a file another app saved, or one this
  // app cannot use, gets one message instead of opening as defaults.
  onLoad: (file?: File) =>
    file &&
    readProjectFile(file, (data) => {
      settings = coerceSettings(data);
      showSettings();
      syncColorInputs();
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }, PROJECT_FILE),
  onHelp: () =>
    dialog({
      title: 'Generator Template help',
      content: 'Explain how to use your generator here. Keep it to the two or three things people get stuck on.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'template-theme',
});

// ---------------------------------------------------------------------------
// 6. ASSEMBLE — the shell wires it into the standard three-column layout.
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');

const modes = modeBar({
  modes: [
    { value: 'orbit', label: 'Orbit' },
    { value: 'tune', label: 'Tune' },
  ],
  value: 'orbit',
  onChange: (m) => {
    tunePanel.setOpen(m === 'tune');
    // The hint lives bottom-right and the panel bottom-centre, so they no longer
    // collide — but a mode panel is the thing to read while it is open, and two
    // competing overlays is one too many. Keep hiding it.
    hint.classList.toggle('hidden', m === 'tune');
  },
});

const thicknessStepper = stepper({
  readout: `${settings.thickness.toFixed(1)} mm`,
  onStep: (d) => {
    // Drive the sidebar control, not the state directly, so the two never
    // disagree — `setValue(v, true)` fires its onInput, which rebuilds.
    controls.thickness.setValue(+(settings.thickness + d * 0.2).toFixed(1), true);
  },
});

/** Keep the stage stepper's readout in step with the sidebar slider. */
function syncThickness() {
  thicknessStepper.setReadout(`${settings.thickness.toFixed(1)} mm`);
}

const tunePanel = stagePanel({
  title: 'Thickness',
  body: [thicknessStepper.root],
  hint: 'A stage panel is for the one setting you tweak while looking at the model.',
});

const stageCanvas = el('div', { className: 'tpl-stage-canvas' });
const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'My Generator',
        description: 'One line on what it makes and who it is for.',
        // The byline lives in the credit strip pinned at the foot of this panel (below), so
        // the panel opens on the controls.
        hideCredit: true,
      }),
      ...(quality ? [quality] : []),
      shapeSection,
      detailSection,
    ],
    // Pinned under the scroll, not in it: "Made by Vostok Labs" in small type with the
    // Updates drawer beside it — a signature, not a step in the workflow. Keep
    // `src/changelog.ts` current as you ship: it is how someone who wrote in about a bug
    // finds out that the fix landed.
    credit: panelCredit({ title: 'My Generator', updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [
    stageCanvas,
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    modes.root,
    tunePanel.root,
    status.root,
    hint,
  ],
  right: {
    scroll: [inputSection, colourSection],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// The viewer mounts into the stage, follows <html data-theme> on its own, and
// brings the build plate with it. The picker goes top-right of the stage.
const viewer = createViewer(stageCanvas);
mountPlatePicker(shell.stage, viewer);

// Clicking a part selects it; use this to drive per-part UI.
viewer.onPartPick((index) => {
  if (index === null) return;
  status.set(`Selected: ${parts[index]?.name ?? 'part'}`);
});

// Everything is built — put the settings into the controls, then draw.
showSettings();
triggerRebuild(true);
