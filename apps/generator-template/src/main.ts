import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  panelCredit,
  sidebarFooter,
  settingsRail,
  section,
  sliderRow,
  toggleSwitch,
  textField,
  fontChooser,
  filamentRow,
  button,
  buttonRow,
  previewBar,
  stageTools,
  stageRow,
  stageStatus,
  toast,
  dialog,
  licenseAfterExport,
  buildLoop,
  syncControls,
  readProjectFile,
  markProject,
  ICONS,
  el,
  type ProjectShape,
} from '@vostok/ui-kit';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice } from '@vostok/plates';
import { downloadThreeMF, downloadFile } from '@vostok/export';
import { FONTS, getFont, toPickerFont, fontSupportsText, importFontFiles } from '@vostok/fonts';
import { DEFAULT_SETTINGS, coerceSettings, type TagSettings } from './state';
import { buildTag, type TagBuild } from './geometry';
import { CHANGELOG } from './changelog';

/*
  Vostok Labs generator template — a small but COMPLETE generator, in the house look.

  It runs as-is: type on the right, change a setting on the left, watch the model rebuild,
  export a real two-colour 3MF. The demo is a name tag; replace it with your product. Every
  piece of the screen is a block from the shelf (`pnpm catalogue`), which is why it already
  looks like the clicker, the keycap generator and Laser Studio.

  WHERE THINGS GO (the house layout; keep it, or the generators drift apart):

    topbar        all generators · commercial licence · MakerWorld · Buy me a coffee   (ui-kit)
    LEFT panel    the name, then the SETTINGS RAIL: an icon per category, one category open
                  at a time. Reset at its foot, the credit strip under that.
    STAGE         the 3D preview, plus its overlays:
                    top-left      how the preview is shown (3D · Top)
                    top-right     build-plate picker
                    bottom-left   status line
                    bottom-right  "hold left click to rotate" hint
    RIGHT panel   what the customer types or brings in (here, the text), and nothing else
                  ...and its FOOTER holds Download / Save / Load / Help / Theme

  THE RULE THE RAIL EXISTS FOR (README, "Categories and settings that make sense"): a category
  is one thing the customer would name, with an icon that pictures it and a one-word label.
  Every setting sits in the category it changes, labelled with what it changes.

  Read the numbered sections below in order.
*/

// ---------------------------------------------------------------------------
// 1. STATE — see state.ts. Save/Load serialise this object.
// ---------------------------------------------------------------------------
let settings: TagSettings = { ...DEFAULT_SETTINGS };

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
//    is quick, so it builds inline.
// ---------------------------------------------------------------------------
let refitNext = false;
const loop = buildLoop<TagBuild>({
  // The face loads here, where the font chooser lives, and only the first build in a face waits
  // for it. A copy of the settings, so a change while it loads is the next build's, not half of this one.
  run: async () => {
    const s = { ...settings };
    return buildTag(s, await getFont(s.font));
  },
  onResult: (built) => {
    viewer.setParts(built.parts, refitNext);
    refitNext = false;
    status.set(describe(built));
  },
  onError: (err) => status.set(`Could not build the model: ${err.message}`, 'error'),
});

function triggerRebuild(refit = false) {
  if (refit) refitNext = true;
  loop.request();
}

/** The status line: the size of what will print, and anything the build had to change. */
function describe(built: TagBuild): string {
  const letters = built.parts.length > 1;
  const size = `${settings.width} × ${settings.height} × ${(settings.thickness + (letters ? settings.raise : 0)).toFixed(1)} mm`;
  if (!settings.text.trim()) return `${size} · Type on the right to put text on the tag.`;
  if (built.shrunk) return `${size} · Text made smaller to fit: ${built.textSize.toFixed(1)} mm`;
  return size;
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel) — the controls, then the rail that sorts them into categories.
//
//    Every control is kept in a named handle so Load-project can push the loaded values
//    straight back into the UI — a generator whose sliders don't follow a loaded project
//    always feels broken. Never build a control inline inside a category's body: a control
//    nobody holds a handle to can never be synced.
// ---------------------------------------------------------------------------
const controls = {
  // Size
  width: sliderRow({
    label: 'Width', min: 20, max: 150, step: 1, value: settings.width, unit: 'mm',
    onInput: (v) => { settings.width = v; triggerRebuild(); },
  }),
  height: sliderRow({
    label: 'Height', min: 10, max: 80, step: 1, value: settings.height, unit: 'mm',
    onInput: (v) => { settings.height = v; triggerRebuild(); },
  }),
  thickness: sliderRow({
    label: 'Thickness', min: 1, max: 8, step: 0.2, value: settings.thickness, unit: 'mm',
    onInput: (v) => { settings.thickness = v; triggerRebuild(); },
  }),
  radius: sliderRow({
    label: 'Corner radius', min: 0, max: 40, step: 0.5, value: settings.radius, unit: 'mm',
    onInput: (v) => { settings.radius = v; triggerRebuild(); },
  }),
  // Lettering. A "?" tooltip only where the label cannot carry it on its own: one short
  // sentence, never a paragraph under the control.
  textSize: sliderRow({
    label: 'Text size', min: 4, max: 40, step: 0.5, value: settings.textSize, unit: 'mm',
    help: 'Long text is made smaller to fit the tag.',
    onInput: (v) => { settings.textSize = v; triggerRebuild(); },
  }),
  raise: sliderRow({
    label: 'Raised by', min: 0.4, max: 5, step: 0.2, value: settings.raise, unit: 'mm',
    help: 'How far the letters stand up from the tag.',
    onInput: (v) => { settings.raise = v; triggerRebuild(); },
  }),
  letterSpacing: sliderRow({
    label: 'Letter spacing', min: -10, max: 50, step: 1, value: settings.letterSpacing, unit: '%',
    onInput: (v) => { settings.letterSpacing = v; triggerRebuild(); },
  }),
  // Keyring. Hole size only means something while there is a hole, so it is hidden, never
  // greyed, while the switch is off.
  hole: toggleSwitch({
    label: 'Keyring hole', checked: settings.hole,
    onChange: (on) => { settings.hole = on; applyVisibility(); triggerRebuild(); },
  }),
  holeSize: sliderRow({
    label: 'Hole size', min: 2, max: 10, step: 0.5, value: settings.holeSize, unit: 'mm',
    onInput: (v) => { settings.holeSize = v; triggerRebuild(); },
  }),
  // Colors: one row per part, in the shelf's filament colours. Each part prints on its own
  // filament slot in the 3MF. A colour change rebuilds like any other setting: it costs a few
  // milliseconds here and keeps the parts on screen and the parts exported the same.
  tagColor: filamentRow({
    label: 'Tag', value: settings.tagColor,
    onChange: (hex) => { settings.tagColor = hex; triggerRebuild(); },
  }),
  textColor: filamentRow({
    label: 'Letters', value: settings.textColor,
    onChange: (hex) => { settings.textColor = hex; triggerRebuild(); },
  }),
  // The right panel's control (section 4), held here with the rest so it syncs with them.
  text: textField({
    label: 'What the tag says', value: settings.text, placeholder: 'Type a name',
    onInput: (v) => { settings.text = v; showSample(); triggerRebuild(); },
  }),
};

/** The font cards show the customer's own text, cut short to fit a card. */
const sampleOf = (text: string) => text.trim().slice(0, 12) || 'Abc';

/** The faces shown as cards: a handful that suit the product, the default first. The rest of
 *  the library is one click away, behind "Browse all". */
const FONT_CARDS = ['russo-one', 'anton', 'bebas-neue', 'bungee', 'luckiest-guy', 'righteous', 'pacifico', 'permanent-marker'];

/** THE font block: the cards, "Browse all" for the rest, a font of your own, and a mark on any
 *  face that cannot write the text. Not in `controls`: nothing greys it, so it is not a
 *  ValueRow, and `showSettings()` syncs it by hand. */
const fonts = fontChooser({
  fonts: FONTS.map(toPickerFont),
  curated: FONT_CARDS,
  // "Browse all" lists these first.
  featuredLabel: 'Good on a tag',
  value: settings.font,
  sample: sampleOf(settings.text),
  checkText: settings.text,
  // The cards fill the open category and scroll on their own.
  fill: true,
  supports: (f, text) => fontSupportsText(f.id, text),
  onChange: (id) => { settings.font = id; triggerRebuild(); },
  onImport: async (file) => {
    const { fonts: imported, failed } = await importFontFiles(file);
    return { fonts: imported.map(toPickerFont), failed };
  },
});

function showSample() {
  fonts.setSample(sampleOf(settings.text), settings.text);
}

/*
  The rail. Each category is one thing the customer would name, in the order they think about
  the product: how big, which letters and how they look, the keyring, the colours.

    · The label is one word under the icon; `title` is the heading over the open category when
      it needs more ("Size & shape").
    · The icon pictures the thing the category sets, and no two categories share one. If the
      kit has no clear glyph, add it to the kit's ICONS, as `lettering` was for this template;
      never borrow a near one, and never fall back to `sliders`.
    · Every setting sits in the category it changes. One with no obvious home means the
      categories are wrong; there is no "More" category.

  A category whose rows are all hidden leaves the rail on its own; `rail.refresh()` re-reads that
  after rows are shown or hidden.
*/
const rail = settingsRail({
  label: 'Tag settings',
  // The rail is the whole left panel: it runs edge to edge and the open category scrolls.
  flush: true,
  items: [
    {
      id: 'size', label: 'Size', title: 'Size & shape', icon: ICONS.dimensions,
      body: [controls.width, controls.height, controls.thickness, controls.radius],
    },
    { id: 'font', label: 'Font', icon: ICONS.text, fill: true, body: [fonts] },
    {
      id: 'lettering', label: 'Lettering', icon: ICONS.lettering,
      body: [controls.textSize, controls.raise, controls.letterSpacing],
    },
    { id: 'keyring', label: 'Keyring', icon: ICONS.link, body: [controls.hole, controls.holeSize] },
    { id: 'colors', label: 'Colors', icon: ICONS.droplet, body: [controls.tagColor, controls.textColor] },
  ],
});

/** Hide what does not apply, never grey it. */
function applyVisibility() {
  controls.holeSize.hidden = !settings.hole;
  rail.refresh();
}

/**
 * Put `settings` into every control, and keep only what the controls can show. Run it after
 * anything that changes settings without the user touching a control: Load, Reset, a share
 * link, undo.
 *
 * The kit's `syncControls` does every control in `controls`, and writes each one's clamped
 * value back. That is what stops a loaded project with `width: 400` building 400 mm behind a
 * slider that shows 150. The font chooser is done by hand below, with the same two halves.
 */
function showSettings() {
  syncControls(settings, controls);
  fonts.setValue(settings.font);
  settings.font = fonts.getValue();
  showSample();
  applyVisibility();
}

// ---------------------------------------------------------------------------
// 4. WHAT THE CUSTOMER TYPES (right panel) — the text, and nothing else. A setting never goes
//    here: the right panel is for what the customer types or brings in (text, a list, an
//    image, a symbol), and Download at its foot.
// ---------------------------------------------------------------------------
const textSection = section({ title: 'Text', body: [controls.text] });

// ---------------------------------------------------------------------------
// 5. CHROME — the header, Reset, the credit strip, and the export/save/load/help footer.
// ---------------------------------------------------------------------------
// The name alone: the rail under it says what the tool does, and every line up here pushes the
// rail's last categories off a laptop screen.
const header = generatorHeader({
  title: 'My Generator',
  hideCredit: true,
});

// Resets the settings and keeps what was typed: the text is the customer's, not a setting.
const reset = button({
  label: 'Reset all settings',
  icon: ICONS.rotateLeft,
  emphasis: 'ghost',
  onClick: () => {
    settings = { ...DEFAULT_SETTINGS, text: settings.text };
    showSettings();
    triggerRebuild(true);
    toast('Settings reset', { kind: 'ok' });
  },
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
    // export a variable holding the last build: that is whichever build finished last.
    const built = await loop.settled();
    downloadThreeMF(built.parts, {
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
  // with nothing chosen. The kit runs the loader inside its own guard: a file another app
  // saved, or one this app cannot use, gets one message instead of opening as defaults.
  onLoad: (file?: File) =>
    file &&
    readProjectFile(file, (data) => {
      settings = coerceSettings(data);
      showSettings();
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }, PROJECT_FILE),
  onHelp: () =>
    dialog({
      title: 'Generator Template help',
      content: 'Type your text on the right. Every setting is on the left, one category at a time; hover a "?" for what a control does. Download 3MF gives a file for your slicer, with the tag and the letters on their own filaments.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'template-theme',
});

// ---------------------------------------------------------------------------
// 6. STAGE — the 3D preview and its overlays (the slot map is at the top of the kit's
//    components/stage.ts).
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');
const stageCanvas = el('div', { className: 'tpl-stage-canvas' });

// How the preview is shown. It changes what you see, never the model.
const viewBar = previewBar<'3d' | 'top'>({
  label: 'View',
  modes: {
    label: 'View',
    options: [{ value: '3d', label: '3D' }, { value: 'top', label: 'Top' }],
    value: '3d',
    onChange: (v) => viewer.setView(v === 'top' ? 'top' : 'iso'),
  },
});

const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

// ---------------------------------------------------------------------------
// 7. ASSEMBLE — the shell wires it into the standard three-column layout.
// ---------------------------------------------------------------------------
const shell = appShell({
  topbar: topbarLinks({ themeToggle: false }),
  // On a narrow screen: the preview, then the right panel, with Download pinned at the foot
  // beside a Settings button that opens the rail in a drawer.
  phone: true,
  left: {
    // Slim chrome round a panel that is the rail and nothing else.
    compact: true,
    header: [header],
    scroll: [rail],
    footer: [buttonRow(reset)],
    // Pinned under the rail: "Made by Vostok Labs" in small type with the Updates drawer beside
    // it. Keep `src/changelog.ts` current as you ship: it is how someone who wrote in about a
    // bug finds out that the fix landed.
    credit: panelCredit({ title: 'My Generator', updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [stageCanvas, stageTools([stageRow([viewBar.root])]), status.root, hint],
  right: {
    scroll: [textSection],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// The viewer mounts into the stage, follows <html data-theme> on its own, and
// brings the build plate with it. The picker goes top-right of the stage. `frame` keeps the
// model at the same share of the stage whatever its size, so a small part is not lost on the plate.
const viewer = createViewer(stageCanvas, { frame: { fill: 0.6 } });
mountPlatePicker(shell.stage, viewer);

// Everything is built — put the settings into the controls, then draw.
showSettings();
triggerRebuild(true);
