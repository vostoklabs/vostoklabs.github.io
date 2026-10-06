import '@vostok/ui-kit/styles.css';
import {
  el,
  toast,
  dialog,
  splitDialog,
  section,
  licenseNudge,
  openCommercialModal,
  openLicenseModal,
  licenseReminderToast,
  topbarLinks,
  showWhatsNew,
  changelogButton,
  nudgePad,
  panelCredit,
  paletteRow,
  supportLinks,
  exportPanel,
  sidebarFooter,
  captureCover,
  offlineDownloadButton,
  presetShareButton,
  readParamsFromHash,
  toggleSwitch,
  slider,
  sliderRow,
  stepperRow,
  segmentedControl,
  selectField,
  helpTip,
  dpad,
  button,
  iconButton,
  buttonRow,
  motionToggleButton,
  effectiveMotion,
  chip,
  emptyState,
  progressBar,
  skeleton,
  checkbox,
  textareaField,
  openMenu,
  searchField,
  sideNav,
  galleryCard,
  galleryGrid,
  fontCards,
  ICONS,
  UI_KIT_VERSION,
  generatorHeader,
  colorSwatch,
  colorPopover,
  historyControls,
  keyMap,
  listRow,
  drawer,
  popover,
  textField,
  numberField,
  sourceCards,
  dropZone,
  uploadCta,
  sampleGrid,
  thumbGrid,
  thumbTile,
  openSvgImport,
  fontChooser,
  symbolPickerButton,
  symbolTextField,
  openSymbolLibrary,
  symbolInspector,
  SYMBOL_CATALOG,
  POPULAR_SYMBOL_IDS,
  modeBar,
  stageTools,
  previewBar,
  stagePanel,
  stepper,
  stageHandle,
  stageStatus,
  previewCard,
  zoomControl,
  lengthUnits,
  diagnosticsList,
  buildLoop,
  settingsRail,
  appShell,
  designShell,
  designBody,
  studioView,
  toolRail,
  suiteBar,
  toolbar,
  statusBar,
  floatingPanel,
  svgEl,
  svgNode,
  themeColor,
  type CatalogSymbol,
  type Diagnostic,
  type FontPickerFont,
  type ListRowHandle,
  type SvgImportChoice,
  type SvgImportPart,
  type SymbolTransform,
} from '@vostok/ui-kit';
import { openSymbolChooser, symbolDrawing } from '@vostok/ui-kit/symbols';
// The symbol rules on their own, as code with no DOM takes them.
import { nextSymbolChar, shiftSymbol } from '@vostok/ui-kit/symbol-rules';
import './demo.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app');

/* An entry = one component, shown as a spec row: its real export name (mono),
   a human title, a one-line description, and the live component beside it. */
function entry(name: string, title: string, desc: string, ...demo: (Node | string)[]): HTMLElement {
  return el('section', { className: 'kit-entry' }, [
    el('div', { className: 'kit-entry__meta' }, [
      el('code', { className: 'kit-entry__name', text: name }),
      el('h2', { className: 'kit-entry__title', text: title }),
      el('p', { className: 'kit-entry__desc', text: desc }),
    ]),
    el('div', { className: 'kit-entry__demo' }, demo),
  ]);
}

function group(label: string): HTMLElement {
  return el('div', { className: 'kit-group' }, [
    el('span', { className: 'kit-group__label', text: label }),
    el('div', { className: 'kit-group__rule' }),
  ]);
}

const row = (...kids: (Node | string)[]) => el('div', { className: 'vl-row' }, kids);
const panel = (...kids: (Node | string)[]) => el('div', { className: 'kit-panel' }, kids);

/* ---------- Sample data for the demos ---------- */
/* Outlines in the 40x40 box the pickers and tiles draw in. Generated rather than stored as image
   files, the way the clicker's base shapes are, so a block that takes a path draws them in
   currentColor. `cx`/`cy` move the centre, for the SVG wizard's 100-unit file. */
type Pt = [number, number];
function polyPoints(points: number, outer: number, inner = outer, turn = -Math.PI / 2, cx = 20, cy = 20): Pt[] {
  const n = inner === outer ? points : points * 2;
  return Array.from({ length: n }, (_, i): Pt => {
    const r = i % 2 && inner !== outer ? inner : outer;
    const a = turn + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}
const ringPath = (pts: Pt[]) => `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
const DEMO_SHAPES = [
  { id: 'circle', label: 'Circle', cat: 'basic', d: 'M20 3a17 17 0 1 1 0 34a17 17 0 1 1 0-34Z' },
  { id: 'square', label: 'Rounded square', cat: 'basic', d: 'M9 5h22a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4Z' },
  { id: 'heart', label: 'Heart', cat: 'basic', d: 'M20 35C11 28.5 4 22.6 4 14.8A8.3 8.3 0 0 1 20 10.6A8.3 8.3 0 0 1 36 14.8C36 22.6 29 28.5 20 35Z' },
  { id: 'triangle', label: 'Triangle', cat: 'polygons', d: ringPath(polyPoints(3, 19)) },
  { id: 'hexagon', label: 'Hexagon', cat: 'polygons', d: ringPath(polyPoints(6, 18)) },
  { id: 'octagon', label: 'Octagon', cat: 'polygons', d: ringPath(polyPoints(8, 18, 18, -Math.PI / 8)) },
  { id: 'star', label: 'Star', cat: 'stars', d: ringPath(polyPoints(5, 19, 8)) },
  { id: 'burst', label: 'Burst', cat: 'stars', d: ringPath(polyPoints(12, 18, 13)) },
  { id: 'spark', label: 'Spark', cat: 'stars', d: ringPath(polyPoints(4, 19, 5)) },
];
const shapeOf = (id: string) => DEMO_SHAPES.find((s) => s.id === id) ?? DEMO_SHAPES[0]!;
/** An outline as a picture, for the blocks that take an image URL. Painted in the live accent
 *  token, read through the kit rather than copied as a hex. */
const shapePicture = (d: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="${d}" fill="${themeColor('--accent', 'currentColor')}"/></svg>`,
  )}`;

/* ---------- Masthead ---------- */
const themeToggle = button({
  label: 'Toggle theme',
  emphasis: 'ghost',
  onClick: () => {
    const root = document.documentElement;
    root.setAttribute(
      'data-theme',
      root.getAttribute('data-theme') === 'light' ? 'dark' : 'light',
    );
  },
});

app.append(
  el('header', { className: 'kit-masthead' }, [
    el('div', {}, [
      el('div', { className: 'kit-brand' }, [
        el('span', { className: 'kit-brand__mark', text: 'Vostok Labs' }),
        el('h1', { className: 'kit-brand__title', text: 'UI Kit' }),
        el('span', { className: 'kit-chip', text: `v${UI_KIT_VERSION}` }),
      ]),
      el('p', {
        className: 'kit-lede',
        text: 'Framework-free components shared by every generator. Each one below renders live from the same source the apps import, so this page is the visual contract.',
      }),
    ]),
    el('div', { className: 'kit-masthead__tools' }, [themeToggle]),
  ]),
);

/* ---------- Chrome ---------- */
/* The topbar and the support row are full-width components: in a real app they span the
   window, and squeezed into this page's 1fr demo column they wrap onto two lines and read as
   cramped — which is a fault of the gallery, not of the component. `kit-entry--full` stacks
   the description above the demo so these two get the whole content width. */
const fullWidth = (e: HTMLElement) => { e.classList.add('kit-entry--full'); return e; };

app.append(
  group('Chrome'),
  fullWidth(entry('topbarLinks()', 'Topbar', 'The standard generator header: GitHub and commercial license on the left, donate actions on the right.', topbarLinks())),
  fullWidth(entry('supportLinks()', 'Support links', 'Ko-fi, MakerWorld, and GitHub as one styled row. Placeholder URLs are hidden automatically.', supportLinks())),
  entry(
    'panelCredit()',
    'Panel credit',
    'The strip pinned at the foot of a settings panel: who made this, and what changed. It is ' +
      'the byline moved out of the way of the first control, and the Updates button lives here ' +
      'rather than competing with Export for the sticky footer. Pin it OUTSIDE .vl-panel__scroll ' +
      'or it scrolls away with the controls.',
    el('div', { className: 'kit-sidebar-frame' }, [
      panelCredit({
        title: 'Keycap Legend Generator',
        updates: {
          title: 'Keycap updates',
          entries: [
            {
              date: '2026-09-05',
              changes: [
                { kind: 'added', text: 'A colour picker beside every palette row' },
                { kind: 'fixed', text: 'The legend buttons no longer lag behind the click' },
              ],
            },
            {
              date: '2026-08-12',
              changes: [{ kind: 'added', text: 'Choc v1 profile, in 1u, 1.5u and 2u' }],
            },
          ],
        },
      }),
    ]),
  ),
  entry(
    'generatorHeader()',
    'Generator header',
    'The top of every settings panel: the generator’s name, one line on what it makes, and ' +
      '"Made by Vostok Labs". Inside the desktop host the credit drops out by itself; pass ' +
      'hideCredit when a panelCredit() strip at the foot of the panel carries the byline instead.',
    el('div', { className: 'kit-sidebar-frame' }, [
      generatorHeader({
        title: 'Name Keychain Generator',
        description: 'A name with an outline that follows the letters, printed in two colours.',
      }),
    ]),
  ),
  entry(
    'generatorHeader({ compact: true })',
    'Page header',
    'The same header heading a page rather than a panel, on one row with the search box: tighter ' +
      'lines, the description and the byline a size down, the mark at the credit strip’s size. ' +
      'Laser Studio’s gallery.',
    el('div', { className: 'kit-page-head' }, [
      generatorHeader({
        title: 'Laser Studio',
        description: 'Pick a design, type your text, download the cut file.',
        compact: true,
      }),
      searchField({ label: 'Search designs', placeholder: 'Search 44 designs', className: 'kit-page-head__search', onInput: () => {} }),
    ]),
  ),
);

/* ---------- Foundations ---------- */
const swatches = el('div', { className: 'kit-swatches' });
const cs = getComputedStyle(document.documentElement);
for (const name of ['--bg', '--panel', '--panel-2', '--line', '--text', '--muted', '--accent', '--accent-2']) {
  swatches.append(
    el('div', { className: 'kit-swatch' }, [
      el('div', { className: 'kit-swatch__chip', attrs: { style: `background: var(${name})` } }),
      el('div', { className: 'kit-swatch__meta' }, [
        el('span', { className: 'kit-swatch__name', text: name }),
        el('span', { className: 'kit-swatch__val', text: cs.getPropertyValue(name).trim() || '-' }),
      ]),
    ]),
  );
}

/* Reads the live tier values back out of the running CSS, so the demo proves the switch
   reached the stylesheet rather than just claiming it did. */
const motionReadout = el('div', { className: 'vl-hint' });
const paintMotion = () => {
  const cs = getComputedStyle(document.documentElement);
  const t = (n: string) => cs.getPropertyValue(n).trim();
  motionReadout.textContent =
    `now: ${effectiveMotion()} · hover ${t('--dur-hover')} · panel ${t('--dur-in-md')} ` +
    `· press scale ${t('--press-scale')}`;
};
new MutationObserver(paintMotion).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-motion'],
});
paintMotion();

app.append(
  group('Foundations'),
  entry('tokens.css', 'Design tokens', 'One palette drives light and dark. Values are read live from the running CSS.', swatches),
  entry(
    'motion.css · motionToggleButton()',
    'Motion',
    'Every duration and easing in the kit is a tier, not a number — so one switch reaches all of ' +
      'them. Follows the OS by default; this button forces it on or off. Watch the tab pill and ' +
      'the button presses below change speed.',
    panel(motionReadout, row(motionToggleButton())),
  ),
  entry(
    '.vl-btn',
    'Buttons',
    'Primary, default, ghost, and disabled, all from the button base. .vl-row keeps a cluster aligned and evenly spaced.',
    row(
      button({ label: 'Primary', emphasis: 'primary' }),
      button({ label: 'Default' }),
      button({ label: 'Ghost', emphasis: 'ghost' }),
      button({ label: 'Disabled', disabled: true }),
    ),
  ),
);

/* ---------- Controls ---------- */
const padReadout = dpad({
  readout: 'Centered',
  onMove: (dir) => padReadout.setReadout(`moved ${dir}`),
  onRotate: (deg) => padReadout.setReadout(`rotated ${deg > 0 ? '+' : ''}${deg} deg`),
  onReset: () => padReadout.setReadout('Centered'),
});

const cornerRadius = sliderRow({
  label: 'Corner radius',
  min: 0,
  max: 10,
  value: 3,
  unit: 'mm',
  help: 'Rounds the outer edge of the generated part.',
  onInput: (v) => padReadout.setReadout(`radius ${v} mm`),
});

/* The emphasis ladder, live. One primary per view is the rule; the rest carry the
   secondary and ghost weights so a panel has somewhere to put a lesser action other
   than inventing a class for it. */
const busyDemo = button({
  label: 'Run something slow',
  emphasis: 'secondary',
  icon: ICONS.zap,
  onClick: () => {
    busyDemo.setBusy(true);
    setTimeout(() => {
      busyDemo.setBusy(false);
      toast('Finished', { kind: 'ok' });
    }, 1800);
  },
});

/* A colour well per part, and the shared picker opened from a button: the well is the platform's
   own wheel, the popover is the filament shelf every generator offers. */
const bodyWell = colorSwatch({ value: '#2f6fde', label: 'Body colour', onChange: (h) => toast(`Body: ${h}`) });
const textWell = colorSwatch({ value: '#f7f7f5', label: 'Text colour', onChange: (h) => toast(`Text: ${h}`) });
const shelfButton = button({
  label: 'Body from the shelf',
  emphasis: 'secondary',
  icon: ICONS.droplet,
  onClick: () => {
    const r = shelfButton.getBoundingClientRect();
    colorPopover({ x: r.left, y: r.bottom + 6, value: bodyWell.getValue(), onSelect: (hex) => bodyWell.setValue(hex), onClose: () => toast(`Body: ${bodyWell.getValue()}`) });
  },
});

/* Undo and redo over one counted value. The history is the page's own, a few lines of it; the
   row of buttons only shows what can be done. */
const keysStart = 3;
let keysNow = keysStart;
const keysPast: number[] = [];
const keysFuture: number[] = [];
const keysRow = stepperRow({
  label: 'Keys',
  min: 1,
  max: 6,
  value: keysStart,
  onInput: (v) => {
    keysPast.push(keysNow);
    keysFuture.length = 0;
    keysNow = v;
    syncHistory();
  },
});
/** One step from one stack to the other: undo moves past -> future, redo the reverse. */
function walkHistory(from: number[], to: number[]): void {
  const v = from.pop();
  if (v === undefined) return;
  to.push(keysNow);
  keysNow = v;
  keysRow.setValue(v);
  syncHistory();
}
const historyRow = historyControls({
  onUndo: () => walkHistory(keysPast, keysFuture),
  onRedo: () => walkHistory(keysFuture, keysPast),
  onRefresh: () => {
    keysPast.push(keysNow);
    keysFuture.length = 0;
    keysNow = keysStart;
    keysRow.setValue(keysNow);
    syncHistory();
  },
});
function syncHistory(): void {
  historyRow.setState({ canUndo: keysPast.length > 0, canRedo: keysFuture.length > 0, canRefresh: keysNow !== keysStart });
}

/* A layout of keys, drawn the way they will sit. A tap asks the app; the app answers with set(). */
const keyOn = [true, true, true, false, true, true, true, true];
const keyLegends = () => {
  let n = 0;
  return keyOn.map((on) => (on ? String(++n) : null));
};
const keyCount = el('p', { className: 'vl-hint' });
const paintKeyCount = () => {
  keyCount.textContent = `${keyOn.filter(Boolean).length} keys on a 2 × 4 grid`;
};
const keyLayout = keyMap({
  label: 'Keys',
  help: 'Tap a square to add a key there, or a key to take it away.',
  rows: 2,
  cols: 4,
  on: keyOn,
  legends: keyLegends(),
  onToggle: (i) => {
    keyOn[i] = !keyOn[i];
    keyLayout.set(2, 4, keyOn, keyLegends());
    paintKeyCount();
  },
});
paintKeyCount();

app.append(
  group('Controls'),
  entry(
    'button() · iconButton() · buttonRow()',
    'Buttons',
    'The emphasis ladder — primary, secondary, ghost, plain — plus block, icon-only and the ' +
      'busy state. Never hand-write a button element: the class ladder existed long before ' +
      'the component did, and every app that had to remember it got it wrong.',
    panel(
      buttonRow(
        button({ label: 'Export', emphasis: 'primary', icon: ICONS.download, onClick: () => toast('Primary') }),
        button({ label: 'Save', emphasis: 'secondary', onClick: () => toast('Secondary') }),
        button({ label: 'Cancel', emphasis: 'ghost', onClick: () => toast('Ghost') }),
      ),
      row(
        busyDemo,
        iconButton({ icon: ICONS.rotateLeft, label: 'Reset view', onClick: () => toast('Icon button') }),
        button({ label: 'Disabled', disabled: true }),
      ),
      button({ label: 'Full-width action', emphasis: 'primary', block: true, onClick: () => toast('Block') }),
    ),
  ),
  entry(
    'toggleSwitch() · segmentedControl()',
    'Toggle & segmented',
    'The two pickers every generator reaches for: an on/off switch and a one-of-many segmented control. ' +
      "`variant: 'cards'` swaps the centred pill for a left-aligned, icon-first row — for a source " +
      'picker where a plain tab would either truncate the labels or have nowhere for the icon.',
    panel(
      toggleSwitch({ label: 'Add mounting holes', checked: true, onChange: (on) => toast(on ? 'Holes on' : 'Holes off') }),
      toggleSwitch({ label: 'Emboss logo', onChange: (on) => toast(on ? 'Logo on' : 'Logo off') }),
      segmentedControl({
        options: [
          { value: 'low', label: 'Draft' },
          { value: 'med', label: 'Standard' },
          { value: 'high', label: 'Fine' },
        ],
        value: 'med',
        onChange: (v) => toast(`Quality: ${v}`),
      }),
      segmentedControl({
        variant: 'cards',
        columns: 2,
        options: [
          { value: 'image', label: 'Image', icon: ICONS.download },
          { value: 'svg', label: 'SVG', icon: ICONS.link },
          { value: 'text', label: 'Text', icon: ICONS.target },
        ],
        value: 'image',
        onChange: (v) => toast(`Source: ${v}`),
      }),
    ),
  ),
  entry(
    "segmentedControl({ fit: 'content', size: 'compact' })",
    'Tabs in a bar',
    'A switch in a bar beside other controls, as over a preview: as wide as its options rather than ' +
      'the bar, so the switch beside it keeps its place, and a size down from the panel’s tabs, a ' +
      'step smaller again on a phone. The unit switch on the right is fit to its content only. No caption ' +
      'names a switch in a bar, so each takes an ariaLabel for a screen reader.',
    el('div', { className: 'kit-bar' }, [
      segmentedControl({
        options: [
          { value: 'design', label: '2D Design' },
          { value: 'three', label: '3D Preview' },
          { value: 'file', label: 'Export Preview' },
        ],
        value: 'three',
        fit: 'content',
        size: 'compact',
        ariaLabel: 'View',
        onChange: (v) => toast(`View: ${v}`),
      }),
      segmentedControl({ options: [{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }], value: 'mm', fit: 'content', ariaLabel: 'Units' }),
    ]),
  ),
  entry(
    'stepperRow()',
    'Stepper row',
    "sliderRow()'s sibling, for a value that is COUNTED rather than swept. A printed sheet is " +
      'two layers or three; there is no 2.4, and dragging a thumb across a range of eight to move ' +
      'by one is both harder to land and easy to land wrongly. Same contract as sliderRow — a ' +
      'ValueRow<number> with the same format and parse — so swapping one for the other is a ' +
      'one-word change at the call site.',
    panel(
      stepperRow({
        label: 'Sheet layers',
        min: 1,
        max: 8,
        value: 2,
        format: (v) => `${v} layer${v === 1 ? '' : 's'} · ${(v * 0.2).toFixed(2)} mm`,
        help: 'The ends disable themselves, so a button that does nothing never looks pressable.',
        onInput: (v) => toast(`${v} layers`),
      }),
      stepperRow({
        label: 'Nudge position',
        min: -15,
        max: 15,
        step: 0.5,
        value: 0,
        unit: 'mm',
        arrows: 'horizontal',
        help: "arrows: 'horizontal' swaps −/+ for left/right, for a value that IS a direction rather than a count (the clicker's keychain offset).",
        onInput: (v) => toast(`${v} mm`),
      }),
    ),
  ),
  entry(
    'sliderRow() · selectField() · helpTip()',
    'Slider, field & help',
    'A labelled slider with an editable value box, a select field, and an inline help tip that explains a parameter on hover.',
    panel(
      cornerRadius,
      sliderRow({ label: 'Wall thickness', min: 0.4, max: 4, step: 0.2, value: 1.6, unit: 'mm' }),
      selectField({
        label: 'Base shape',
        options: [
          { value: 'square', label: 'Square' },
          { value: 'round', label: 'Round' },
          { value: 'hex', label: 'Hexagon' },
        ],
        value: 'round',
        onChange: (v) => toast(`Shape: ${v}`),
      }),
      (() => {
        const p = el('p', { className: 'vl-hint' });
        p.append('Help tips attach to any label', helpTip('This bubble is fixed-positioned, so it escapes narrow sidebars and modal clipping.'));
        return p;
      })(),
    ),
  ),
  entry(
    'dpad()',
    'Directional pad',
    'Nudge a placed element with the arrows, rotate from the top corners, reset from the dashed center. The readout updates live.',
    padReadout.root,
  ),
  entry(
    'nudgePad()',
    'Nudge pad',
    'The same pad at settings-column size, with the two numbers it drives beside it — one ' +
      'control, not two that happen to sit together. Chevrons rather than arrows, because these ' +
      'are repeated small adjustments; the centre puts it back to zero. Press and hold to ' +
      'repeat. An app that clamps against its own limits passes onNudge and stays the writer.',
    nudgePad({
      step: 0.5,
      x: { label: 'X', max: 12 },
      y: { label: 'Y', max: 12 },
      onChange: (x, y) => toast(`Nudge: ${x} / ${y} mm`),
    }),
  ),
  entry(
    'paletteRow()',
    'Palette row',
    'One colour, one line: a name and the chip holding it, which opens the shared picker. The ' +
      'compact counterpart to filamentRow()\u2019s shelf — a sidebar has room for one 30px line ' +
      'per colour, not for fourteen swatches and a wrapped custom chip.',
    el('div', { className: 'kit-sidebar-frame' }, [
      paletteRow({ label: 'Keycap', value: '#161616', onChange: (h) => toast(`Keycap: ${h}`) }),
      paletteRow({ label: 'Legend', value: '#f7f7f5', onChange: (h) => toast(`Legend: ${h}`) }),
    ]),
  ),
  entry(
    'colorSwatch() · colorPopover()',
    'Colour well & picker',
    'colorSwatch() is the bare well for a dense list of parts or layers. It has no visible label, ' +
      'so its label is the accessible name. colorPopover() is the one floating picker: the ' +
      'filament shelf plus a custom wheel, anchored where it was opened, live while the wheel is ' +
      'dragged. paletteRow() above is the two of them together.',
    panel(
      row(bodyWell, el('span', { text: 'Body' }), textWell, el('span', { text: 'Text' })),
      row(shelfButton),
    ),
  ),
  entry(
    'historyControls()',
    'Undo / redo',
    'Undo, back to the start, and redo: three icon buttons, each disabled until it has something ' +
      'to do. The row keeps no history; the app does, and calls setState() whenever it moves. ' +
      'Press the stepper a few times, then walk back.',
    panel(keysRow, historyRow),
  ),
  entry(
    'keyMap()',
    'Key map',
    'A grid of keys laid out exactly as they will sit: a key shows its legend, an empty cell is a ' +
      'dashed square with a plus, and a tap on either switches it. The tap goes to the app, which ' +
      'decides and redraws with set(). It is how the clicker draws a custom block, one key at a time.',
    panel(keyLayout, keyCount),
  ),
);

/* ---------- Elements (shared primitives) ---------- */
const prog = progressBar({ value: 0.35, label: 'Carving keycaps' });
let progVal = 0.35;

const menuAnchor = button({
  label: 'Open menu',
  emphasis: 'secondary',
  icon: ICONS.help,
  onClick: () =>
    openMenu({
      anchor: menuAnchor,
      entries: [
        { label: 'Duplicate', icon: ICONS.save, onSelect: () => toast('Duplicate') },
        { label: 'Rename', icon: ICONS.text, onSelect: () => toast('Rename') },
        { separator: true },
        { label: 'Delete', icon: ICONS.undo, onSelect: () => toast('Delete', { kind: 'warn' }) },
        { label: 'Unavailable', disabled: true },
      ],
    }),
});

/* Recent projects: the row four apps had each written for themselves. */
const recent = [
  { label: 'Max, name keychain', meta: 'Today', shape: 'square' },
  { label: 'Bakery sign, two layers', meta: 'Yesterday', shape: 'hexagon' },
  { label: 'Snowflake ornament for the tree', meta: '12 Sep', shape: 'burst' },
];
const recentRows: ListRowHandle[] = recent.map((p, i) =>
  listRow({
    label: p.label,
    meta: p.meta,
    thumb: shapePicture(shapeOf(p.shape).d),
    active: i === 0,
    onClick: () => {
      recentRows.forEach((r, j) => r.setActive(j === i));
      toast(`Open: ${p.label}`);
    },
  }),
);

app.append(
  group('Elements'),
  entry(
    'chip()',
    'Chips',
    'A small filter/tag toggle. State lives in aria-pressed, which is also what the stylesheet ' +
      'keys the filled look off, so the two cannot disagree.',
    panel(
      row(
        chip({ label: 'PLA', pressed: true, onToggle: (p) => toast('PLA ' + (p ? 'on' : 'off')) }),
        chip({ label: 'PETG', onToggle: (p) => toast('PETG ' + (p ? 'on' : 'off')) }),
        chip({ label: 'TPU', onToggle: () => {} }),
        chip({ label: 'Discontinued', disabled: true }),
      ),
    ),
  ),
  entry(
    'chip({ centered: true })',
    'Chips as grid cells',
    'A chip stretched to fill a cell of a grid keeps its label in the middle. A map of a box’s ' +
      'sides as it unfolds: the lid over the front, the four walls in a row, the bottom under the ' +
      'front. Press a side to cut a pattern into it.',
    panel(
      el(
        'div',
        { className: 'kit-sides' },
        ['lid', 'left', 'front', 'right', 'back', 'bottom'].map((side) =>
          chip({
            label: side[0]!.toUpperCase() + side.slice(1),
            centered: true,
            className: `kit-side--${side}`,
            pressed: side === 'front',
            onToggle: (on) => toast(`${side}: ${on ? 'patterned' : 'plain'}`),
          }),
        ),
      ),
    ),
  ),
  entry(
    'checkbox() · textareaField()',
    'Checkbox & textarea',
    'A checkbox is not a toggle switch: a switch means "on now", a checkbox means "include ' +
      'this when I commit". Both wrap the native control, so keyboard and form semantics survive.',
    panel(
      checkbox({ label: 'Include a hanging hole', checked: true, onChange: (v) => toast('Hole ' + v) }),
      checkbox({ label: 'Emboss the logo', onChange: (v) => toast('Logo ' + v) }),
      checkbox({ label: 'Not available yet', disabled: true }),
      textareaField({
        label: 'Engraving text',
        placeholder: 'Up to three lines…',
        rows: 3,
        onInput: () => {},
      }),
    ),
  ),
  entry(
    'progressBar() · skeleton()',
    'Progress & skeleton',
    'Indeterminate is the honest default for work of unknown length — a bar parked at a guessed ' +
      'percentage is worse than one that admits it does not know.',
    panel(
      prog,
      row(
        button({ label: '-10%', onClick: () => { progVal = Math.max(0, progVal - 0.1); prog.setValue(progVal); } }),
        button({ label: '+10%', onClick: () => { progVal = Math.min(1, progVal + 0.1); prog.setValue(progVal); } }),
        button({ label: 'Indeterminate', emphasis: 'ghost', onClick: () => prog.setValue(null) }),
      ),
      skeleton({ height: '14px', width: '70%' }),
      skeleton({ height: '14px', width: '45%' }),
    ),
  ),
  entry(
    'emptyState()',
    'Empty state',
    'Always says what to do next, never just "no results".',
    panel(
      emptyState({
        icon: ICONS.image,
        title: 'No design yet',
        body: 'Drop an image or pick a sample to start. Everything else is already set up.',
        action: button({ label: 'Browse samples', emphasis: 'primary', onClick: () => toast('Browse') }),
      }),
    ),
  ),
  entry(
    'openMenu()',
    'Menu',
    'An anchored popover for commands. Positioned fixed so a scrolling sidebar cannot clip it; ' +
      'closes on select, Escape, outside click, scroll and resize. Arrow keys move between items.',
    panel(row(menuAnchor)),
  ),
  entry(
    'listRow()',
    'List row',
    'A full-width row: thumbnail, a label that ellipsises rather than wraps, and a trailing ' +
      'detail. Square-cornered and left-aligned, so not a step on the button ladder, but still a ' +
      'real button: keyboard and focus come free, and data-active marks the current one.',
    el('div', { className: 'kit-list' }, [
      ...recentRows,
      listRow({ label: 'Archived projects', meta: 'None yet', disabled: true }),
    ]),
  ),
);

/* ---------- Catalogue ---------- */
/* The pieces of a browsable catalogue (Laser Studio's gallery is the first): a live search, a
   rail of sections with counts, and the compact card. */
const demoThumb = () => skeleton({ width: '100%', height: '100%' });
app.append(
  group('Catalogue'),
  entry(
    'searchField()',
    'Search',
    'A live filter: magnifier, input, and a clear cross only while there is something to clear; ' +
      'Escape clears too. No visible label — the placeholder says what can be found.',
    panel(
      searchField({ label: 'Search designs', placeholder: 'Search 44 designs — keychain, wedding, QR', onInput: () => {} }),
    ),
  ),
  entry(
    'sideNav()',
    'Section rail',
    'Sections with their counts, a hairline, then shortcuts. Items are list rows; a count of 0 ' +
      'is muted rather than removed. Below 760 px it becomes one scrolling row of chips.',
    panel(
      sideNav({
        label: 'Categories',
        value: 'all',
        sections: [
          { id: 'cats', items: [{ id: 'all', label: 'All', count: 44 }, { id: 'keychain', label: 'Keychains & charms', count: 11 }, { id: 'tag', label: 'Tags', count: 0 }] },
          { id: 'recent', title: 'Recently opened', items: [{ id: 'bag-charm', label: 'Bag charm' }], selectable: false },
        ],
        onSelect: (id) => toast(id),
      }),
    ),
  ),
  entry(
    'galleryCard({ compact: true })',
    'Compact card',
    'For a gallery of dozens: the picture is the tile, name and one line beneath, each held to ' +
      'one line with the full blurb as the tooltip. Pair with galleryGrid({ dense: true }).',
    panel(
      galleryGrid({
        minPx: 150,
        dense: true,
        cards: [
          galleryCard({ name: 'Name keychain', blurb: 'A name with an outline that follows the letters.', thumb: demoThumb(), compact: true, onClick: () => toast('Name keychain') }),
          galleryCard({ name: 'Bag charm', blurb: 'A monogram, a name or a symbol on a small shape.', thumb: demoThumb(), compact: true, onClick: () => toast('Bag charm') }),
        ],
      }),
    ),
  ),
);

/* ---------- Inputs ---------- */
/* The input side every generator repeats: pick a source, drop a file, start from a sample, or bring
   an SVG and decide what of it prints. */
const SOURCE_HINTS: Record<string, string> = {
  image: 'A photo or a drawing, traced into an outline.',
  svg: 'A vector file, kept as its own shapes.',
  text: 'Letters in any of the fonts, set as outlines.',
};
const sourceHint = el('p', { className: 'vl-hint', text: SOURCE_HINTS.image ?? '' });
/* Eight sources in a settings column: the tiles layout. */
const BOX_STYLES = [
  { value: 'tuck', label: 'Tuck carton', icon: ICONS.box },
  { value: 'mailer', label: 'Mailer', icon: ICONS.layers },
  { value: 'tray', label: 'Tray', icon: ICONS.grid },
  { value: 'sleeve', label: 'Sleeve', icon: ICONS.list },
  { value: 'pillow', label: 'Pillow', icon: ICONS.heart },
  { value: 'gable', label: 'Gable bag', icon: ICONS.stand },
  { value: 'divided', label: 'Divided tray', icon: ICONS.joint },
  { value: 'lid', label: 'Lid and base', icon: ICONS.ruler },
];
const boxStyleHint = el('p', { className: 'vl-hint', text: 'Tuck carton: picked.' });
const boxStyles = sourceCards({
  layout: 'tiles',
  options: BOX_STYLES,
  value: 'tuck',
  onChange: (v) => {
    boxStyleHint.textContent = `${BOX_STYLES.find((s) => s.value === v)?.label ?? v}: picked.`;
  },
});
const sources = sourceCards({
  options: [
    { value: 'image', label: 'Image', icon: ICONS.image },
    { value: 'svg', label: 'SVG', icon: ICONS.svg },
    { value: 'text', label: 'Text', icon: ICONS.text },
  ],
  value: 'image',
  onChange: (v) => {
    sourceHint.textContent = SOURCE_HINTS[v] ?? '';
  },
});

const dropSlot = el('div', { className: 'kit-stack' });
function showDropZone(): void {
  dropSlot.replaceChildren(
    dropZone({ title: 'Drop an image', text: 'or click to browse', note: 'PNG, JPG or SVG', accept: 'image/*', onFiles: ([file]) => file && showLoaded(file) }),
  );
}
function showLoaded(file: File): void {
  dropSlot.replaceChildren(
    el('p', { className: 'vl-hint', text: `${file.name}, ${Math.max(1, Math.round(file.size / 1024))} KB. It stays on this page.` }),
    uploadCta({ label: 'Replace the image', icon: ICONS.upload, accept: 'image/*', onFiles: ([next]) => next && showLoaded(next) }),
    button({ label: 'Start again', emphasis: 'ghost', onClick: showDropZone }),
  );
}
showDropZone();

const samples = sampleGrid({
  heading: 'Or try a sample',
  items: ['heart', 'star', 'hexagon', 'burst'].map((id) => ({ id, label: shapeOf(id).label, src: shapePicture(shapeOf(id).d) })),
  onPick: (item) => {
    samples.setSelected(item.id ?? null);
    toast(`Sample: ${item.label}`);
  },
});
const shapeTiles = DEMO_SHAPES.map((s) =>
  thumbTile({ svgPath: s.d, label: s.label, selected: s.id === 'circle', onClick: (tile) => shapeTiles.forEach((t) => t.setSelected(t === tile)) }),
);

/* A file the way icon sites export one: an invisible artboard round the art, a filled shape, a
   shape drawn only as an outline, and a white one. The page describes the parts and "traces"
   them; an app passes its own tracer here. `at(grow)` is a part's outline grown by `grow`. */
const squareAt = (cx: number, cy: number, half: number) =>
  polyPoints(4, half * Math.SQRT2, half * Math.SQRT2, -Math.PI / 4, cx, cy);
const SVG_PARTS: { part: SvgImportPart; at: (grow: number) => Pt[] }[] = [
  { part: { index: 0, kind: 'none', why: 'artboard' }, at: (g) => squareAt(50, 50, 50 + g) },
  { part: { index: 1, kind: 'fill', hex: '#2f6fde' }, at: (g) => polyPoints(48, 26 + g, 26 + g, 0, 40, 42) },
  { part: { index: 2, kind: 'stroke', strokeWidth: 3, hex: '#e4572e' }, at: (g) => squareAt(71, 67, 17 + g) },
  { part: { index: 3, kind: 'fill', hex: '#ffffff', why: 'white' }, at: (g) => polyPoints(5, 15 + g, 6.5 + g / 2, -Math.PI / 2, 25, 76) },
];
const paintOf = (p: SvgImportPart) =>
  p.kind === 'stroke' ? `fill="none" stroke="${p.hex}" stroke-width="${p.strokeWidth}"` : `fill="${p.kind === 'fill' ? p.hex : 'none'}"`;
const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  SVG_PARTS.map(({ part, at }) => `<path d="${ringPath(at(0))}" ${paintOf(part)}/>`).join('') +
  '</svg>';
function traceSample(choices: Record<number, SvgImportChoice>) {
  const paths = SVG_PARTS.flatMap(({ part, at }) => {
    const choice = choices[part.index];
    if (!choice || choice.mode === 'off') return [];
    // An outline prints as a band as wide as the stroke: the outer ring and its hole in one path.
    const d = choice.mode === 'fill' ? ringPath(at(0)) : ringPath(at(1.5)) + ringPath(at(-1.5).reverse());
    return [{ d, fill: choice.hex ?? 'currentColor' }];
  });
  return paths.length ? { viewBox: '0 0 100 100', paths } : null;
}
const svgImportButton = button({
  label: 'Import badge.svg',
  icon: ICONS.svg,
  onClick: async () => {
    const choices = await openSvgImport({
      svgText: SAMPLE_SVG,
      name: 'badge.svg',
      parts: SVG_PARTS.map(({ part }) => part),
      issues: [],
      thinAt: 'keychain size',
      trace: traceSample,
    });
    if (!choices) {
      toast('Import cancelled');
      return;
    }
    const printing = Object.values(choices).filter((c) => c.mode !== 'off').length;
    toast(`${printing} of ${SVG_PARTS.length} parts will print`, { kind: 'ok' });
  },
});

app.append(
  group('Inputs'),
  entry(
    'sourceCards()',
    'Source cards',
    'The Image / SVG / Text cards at the top of an input panel. Pressing one says where the design ' +
      'comes from, and the app swaps the panel underneath to match.',
    panel(sources.root, sourceHint),
  ),
  entry(
    "sourceCards({ layout: 'tiles' })",
    'Source tiles',
    'More sources than a row of cards has room for: small tiles, the icon over a centred name that ' +
      'may take two lines and is never hyphenated or clipped. Fold-Up Box’s box styles, at the ' +
      'width of a settings panel.',
    el('div', { className: 'kit-sidebar-frame' }, [boxStyles.root, boxStyleHint]),
  ),
  entry(
    'dropZone() · uploadCta()',
    'File drop zone',
    'Click or drag a file in. The zone owns the hidden file input, the drag highlight and the drop, ' +
      'and keeps the drop to itself so a page-wide drop handler never takes the same file twice. ' +
      'Once a file is in, uploadCta() is the slim row that replaces it. Try any image.',
    panel(dropSlot),
  ),
  entry(
    'sampleGrid() · thumbGrid()',
    'Sample tiles',
    'sampleGrid() is the handful of pictures to start from. thumbGrid() lays out any number of ' +
      'thumbTile()s, each an image, a path drawn in currentColor, or a word in a face, with the ' +
      'column count set by a number (minPx) rather than a class.',
    panel(samples, thumbGrid({ heading: 'Base shape', tiles: shapeTiles, minPx: 52 })),
  ),
  entry(
    'openSvgImport()',
    'SVG wizard',
    'Shows the file beside what the tracer made of it, with one decision per part: Fill, Outline or ' +
      'Off, plus a colour where the app has colours. The parts a tracer used to drop without a word ' +
      '(an invisible artboard, a white shape) arrive as Off rows to flip, and an outline-only part ' +
      'says it will print thin. The app describes and traces; the window lays out the choice.',
    row(svgImportButton),
  ),
);

/* ---------- Type & symbols ---------- */
/* System faces, so this page loads no font. An app on @vostok/fonts passes its library instead. */
const DEMO_FACES: FontPickerFont[] = [
  { id: 'sans', label: 'System sans', family: 'system-ui, sans-serif', category: 'Clean' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana, sans-serif', category: 'Clean' },
  { id: 'trebuchet', label: 'Trebuchet', family: '"Trebuchet MS", sans-serif', category: 'Clean' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia, serif', category: 'Serif' },
  { id: 'times', label: 'Times', family: '"Times New Roman", serif', category: 'Serif' },
  { id: 'palatino', label: 'Palatino', family: '"Palatino Linotype", Palatino, serif', category: 'Serif' },
  { id: 'mono', label: 'Monospace', family: 'ui-monospace, Consolas, monospace', category: 'Mono' },
  { id: 'courier', label: 'Courier', family: '"Courier New", monospace', category: 'Mono' },
  { id: 'script', label: 'Script', family: '"Segoe Script", "Brush Script MT", cursive', category: 'Script' },
  { id: 'comic', label: 'Comic', family: '"Comic Sans MS", cursive', category: 'Comic' },
  { id: 'impact', label: 'Impact', family: 'Impact, "Arial Black", sans-serif', category: 'Display' },
];
const fontWord = textField({ label: 'Your text', value: 'Vostok', onInput: (v) => fontBlock.setSample(v.trim() || 'Aa') });
const fontBlock = fontChooser({
  fonts: DEMO_FACES,
  curated: ['sans', 'georgia', 'script', 'impact'],
  value: 'sans',
  sample: 'Vostok',
  styleChips: true,
  onChange: (id) => toast(`Font: ${id}`),
});

const shapeChoice = el('p', { className: 'vl-hint', text: 'Base shape: Circle' });
const shapePickerButton = symbolPickerButton({
  label: 'Choose a base shape',
  title: 'Base shape',
  hint: 'Each item is an outline the generator draws, not a glyph from a font.',
  items: DEMO_SHAPES.map((s) => ({ id: s.id, label: s.label, char: '', cats: [s.cat], svgPath: s.d })),
  categories: [
    { id: '', label: 'All shapes' },
    { id: 'basic', label: 'Basic', count: 3 },
    { id: 'polygons', label: 'Polygons', count: 3 },
    { id: 'stars', label: 'Stars', count: 3 },
  ],
  onPick: (item) => {
    shapeChoice.textContent = `Base shape: ${item.label}`;
  },
});

/* The symbol picker over the whole library. It hands back the symbol as shapes; the page draws
   the pick from the same library, as an app's preview would. */
const chosenArt = el('span', { className: 'kit-chosen-symbol', attrs: { 'aria-hidden': 'true' } });
const chosenText = el('p', { className: 'vl-hint', text: 'Nothing picked yet.' });
const chooseSymbolButton = button({
  label: 'Choose a symbol',
  icon: ICONS.plus,
  emphasis: 'secondary',
  onClick: () =>
    openSymbolChooser({
      anchor: chooseSymbolButton,
      onPick: async (choice) => {
        chosenArt.replaceChildren(await symbolDrawing(choice.id));
        const holes = choice.shapes.reduce((n, island) => n + island.length - 1, 0);
        chosenText.textContent = `${choice.label} (${choice.id}): ${choice.shapes.length} piece${choice.shapes.length === 1 ? '' : 's'}, ${holes} hole${holes === 1 ? '' : 's'}`;
      },
    }),
});

/* Symbols in a line of text: the field, the library and the inspector together. The page keeps
   which drawing each symbol character stands for and how it is placed; the three blocks own none
   of it. */
const SYMBOLS_BY_ID = new Map(SYMBOL_CATALOG.map((s) => [s.id, s]));
/** A catalogue drawing, inline. The Fluent set is drawn in a fixed dark grey; mapped to
 *  currentColor it follows the theme the way the Tabler set already does. */
const symbolArt = (s: CatalogSymbol) => svgEl(s.svg.replace(/#212121/gi, 'currentColor'));
const symbolCategories = [
  { id: 'popular', label: 'Popular' },
  ...[...new Set(SYMBOL_CATALOG.map((s) => s.category))].map((c) => ({ id: c, label: c })),
];
function chooseSymbol(onPick: (s: CatalogSymbol) => void, anchor?: HTMLElement): void {
  openSymbolLibrary({
    anchor,
    categories: symbolCategories,
    list: (id) =>
      id === 'popular'
        ? POPULAR_SYMBOL_IDS.map((x) => SYMBOLS_BY_ID.get(x)).filter((s): s is CatalogSymbol => !!s)
        : SYMBOL_CATALOG.filter((s) => s.category === id),
    search: (q) => SYMBOL_CATALOG.filter((s) => s.label.toLowerCase().includes(q.toLowerCase())),
    renderTile: (entry) => {
      const s = SYMBOLS_BY_ID.get(entry.id);
      return s ? symbolArt(s) : null;
    },
    onPick: (entry) => {
      const s = SYMBOLS_BY_ID.get(entry.id);
      if (s) onPick(s);
    },
  });
}
const placed = new Map<string, { art: CatalogSymbol; look: SymbolTransform }>();
/** Give a drawing a free symbol character, and remember both. */
function holdSymbol(art: CatalogSymbol): string {
  const ch = nextSymbolChar((c) => placed.has(c));
  placed.set(ch, { art, look: { scale: 1, dx: 0, dy: 0, rotation: 0, flip: false } });
  return ch;
}
const symbolLine = el('p', { className: 'kit-symbol-preview', attrs: { 'aria-hidden': 'true' } });
const inspectorSlot = el('div');
const addSymbol = button({
  label: 'Add symbol',
  icon: ICONS.plus,
  emphasis: 'secondary',
  onClick: () => chooseSymbol((s) => engraving.insertAtCaret(holdSymbol(s)), addSymbol),
});
const firstHeart = SYMBOLS_BY_ID.get('tabler-heart');
const engraving = symbolTextField({
  label: 'Engraving',
  value: firstHeart ? `Best friends ${holdSymbol(firstHeart)}` : 'Best friends',
  maxLength: 24,
  action: addSymbol,
  renderSymbol: (ch) => {
    const p = placed.get(ch);
    return p ? symbolArt(p.art) : null;
  },
  symbolLabel: (ch) => placed.get(ch)?.art.label ?? 'Symbol',
  onInput: () => drawLine(),
  onSelectSymbol: (ch) => inspectSymbol(ch),
});
/** The app's own drawing of the line: letters as text, each symbol at its size, offset and turn. */
function drawLine(): void {
  symbolLine.replaceChildren(
    ...Array.from(engraving.getValue(), (ch) => {
      const p = placed.get(ch);
      if (!p) return ch;
      const art = symbolArt(p.art);
      const { scale, dx, dy, rotation, flip } = p.look;
      art.style.transform = `translate(${dx * 100}%, ${-dy * 100}%) rotate(${-rotation}deg) scale(${flip ? -scale : scale}, ${scale})`;
      return art;
    }),
  );
}
function inspectSymbol(ch: string | null): void {
  const p = ch ? placed.get(ch) : undefined;
  if (!ch || !p) {
    inspectorSlot.replaceChildren();
    return;
  }
  const inspector = symbolInspector({
    label: p.art.label,
    values: p.look,
    onChange: (patch) => {
      Object.assign(p.look, patch);
      drawLine();
    },
    onShift: (dir) => {
      engraving.setValue(shiftSymbol(engraving.getValue(), ch, dir));
      drawLine();
    },
    onReplace: () =>
      chooseSymbol((s) => {
        p.art = s;
        engraving.repaint();
        inspector.setLabel(s.label);
        drawLine();
      }),
    onRemove: () => {
      engraving.setValue(engraving.getValue().replace(ch, ''));
      inspectorSlot.replaceChildren();
      drawLine();
    },
  });
  inspectorSlot.replaceChildren(inspector);
}
drawLine();

app.append(
  group('Type & symbols'),
  entry(
    'fontChooser()',
    'Font chooser',
    'The whole font block: curated cards in the user’s own text, style chips over them, and ' +
      '"Browse all" opening the library in a dialog. Fonts arrive as plain objects (id, label, CSS ' +
      'family, style), so the kit carries no font engine; an app on @vostok/fonts maps its library ' +
      'in and adds onImport for "Import a font". These are system faces, so nothing is downloaded.',
    el('div', { className: 'kit-sidebar-frame' }, [fontWord, fontBlock]),
  ),
  entry(
    'symbolPickerButton()',
    'Symbol picker',
    'A button that opens a searchable, paged grid of small pictures in an edge drawer, so whatever ' +
      'the pick goes on stays in view. It takes its items rather than importing them: glyphs from a ' +
      'symbol font, or, as here and in the clicker’s base shapes, one SVG path per item, drawn ' +
      'in currentColor so it follows the theme.',
    panel(row(shapePickerButton), shapeChoice),
  ),
  entry(
    'openSymbolChooser()',
    'Symbol chooser',
    'THE symbol picker: Material Symbols, Tabler Icons and Fluent Emoji in one window, with one set ' +
      'of categories and one search. The pick comes back as closed shapes, centred and one unit ' +
      'across, ready to scale, cut or extrude, and the tiles are drawn from those same shapes.',
    panel(row(chooseSymbolButton), el('div', { className: 'kit-chosen' }, [chosenArt, chosenText])),
  ),
  entry(
    'symbolTextField() · openSymbolLibrary() · symbolInspector()',
    'Symbols in text',
    'Three blocks that work as one. The field holds each symbol as a single character drawn as a ' +
      'token: click to select it, drag to move it, Backspace to remove it. "Add symbol" opens the ' +
      'library over the bundled Tabler and Fluent sets, hanging under the button. A selected token ' +
      'opens its inspector: size, offset, turn, flip, move, swap, remove. The large line is the ' +
      'page’s own drawing of the result, the part an app owns. The rules under all three (which ' +
      'characters are symbols, lengths in code points, every edit) load alone from ' +
      '@vostok/ui-kit/symbol-rules, with no DOM, as this page takes them.',
    panel(engraving, symbolLine, inspectorSlot),
  ),
);

/* ---------- Stage ---------- */
/* The overlays in their slots on a stage. Two blocks on a plate stand in for the viewer's canvas;
   everything floating over them is the kit. */
const CUT_RANGE = 40; // mm across the base block, which is 100 px tall in demo.css
let cutMm = 24;
let stageMode = 'orbit';
const cutLine = el('div', { className: 'kit-model__cut' });
cutLine.hidden = true;
const cutGrip = stageHandle({ label: `${cutMm} mm`, title: 'Drag to move the cut, or use the arrow keys', onStep: (d) => setCut(cutMm + d) });
const modelBase = el('div', { className: 'kit-model__base' }, [cutLine, cutGrip]);
const modelPlate = el('div', { className: 'kit-model__plate' });
const demoModel = el('div', { className: 'kit-model' }, [el('div', { className: 'kit-model__lid' }), modelBase, modelPlate]);
const cutStepper = stepper({ readout: `${cutMm} mm`, onStep: (d) => setCut(cutMm + d) });
const cutPanel = stagePanel({ title: 'Cut height', body: [cutStepper.root], hint: 'Drag the grip on the model, or step it here.' });
const stageLine = stageStatus('Ready · 2 parts');
function setCut(mm: number): void {
  cutMm = Math.max(2, Math.min(CUT_RANGE - 2, Math.round(mm)));
  const y = 100 - (cutMm / CUT_RANGE) * 100;
  cutLine.style.top = `${y}px`;
  cutGrip.setLabel(`${cutMm} mm`);
  // Hung off the base block's right edge (200 px wide), on the cut line.
  cutGrip.place(stageMode === 'cut' ? { x: 200, y } : null);
  cutStepper.setReadout(`${cutMm} mm`);
  cutStepper.setEnabled(cutMm > 2, cutMm < CUT_RANGE - 2);
  if (stageMode === 'cut') stageLine.set(`Cut at ${cutMm} mm · 2 parts`);
}
// Dragging is the app's job: the grip only shows where the cut is.
cutGrip.addEventListener('pointerdown', (e) => {
  cutGrip.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const r = modelBase.getBoundingClientRect();
    setCut((1 - (ev.clientY - r.top) / r.height) * CUT_RANGE);
  };
  const stop = () => {
    cutGrip.removeEventListener('pointermove', move);
    cutGrip.removeEventListener('pointerup', stop);
    cutGrip.removeEventListener('pointercancel', stop);
  };
  cutGrip.addEventListener('pointermove', move);
  cutGrip.addEventListener('pointerup', stop);
  cutGrip.addEventListener('pointercancel', stop);
});
const stageModes = modeBar({
  modes: [
    { value: 'orbit', label: 'Orbit', icon: ICONS.rotateLeft },
    { value: 'cut', label: 'Cut', icon: ICONS.ruler },
  ],
  value: 'orbit',
  onChange: (m) => {
    stageMode = m;
    cutLine.hidden = m !== 'cut';
    cutPanel.setOpen(m === 'cut');
    if (m === 'cut') setCut(cutMm);
    else {
      cutGrip.place(null);
      stageLine.set('Ready · 2 parts');
    }
  },
});
const stageView = previewBar({
  label: 'Preview',
  modes: {
    options: [{ value: 'assembled', label: 'Assembled' }, { value: 'exploded', label: 'Exploded' }],
    value: 'assembled',
    onChange: (v) => demoModel.classList.toggle('is-exploded', v === 'exploded'),
  },
  toggles: [{ id: 'plate', label: 'Build plate', pressed: true, title: 'Show the plate under the model.', onToggle: (on) => (modelPlate.hidden = !on) }],
});
const demoStage = el('div', { className: 'kit-stage' }, [demoModel, stageTools([stageView.root]), stageModes.root, cutPanel.root, stageLine.root]);
setCut(cutMm);

app.append(
  group('Stage'),
  fullWidth(
    entry(
      'modeBar() · stageTools() · previewBar() · stagePanel() · stageHandle() · stageStatus()',
      'Stage overlays & status line',
      'What floats on the 3D stage, each in its own slot so none collide: how the preview is shown ' +
        'at top left, what a click on the model does at top centre, the panel for the active mode at ' +
        'bottom centre, and the status line at bottom left, a live region so a warning is read out ' +
        'when it appears. Switch to Cut: the grip on the model carries its value and moves by drag ' +
        'or arrow keys. The buttons under the stage drive the status line.',
      demoStage,
      buttonRow(
        button({
          label: 'Build',
          onClick: () => {
            stageLine.set('Building…', 'busy');
            setTimeout(() => stageLine.set('Ready · built in 0.9 s'), 900);
          },
        }),
        button({ label: 'Warning', onClick: () => stageLine.set('Letters are thinner than the nozzle.', 'warn') }),
        button({ label: 'Error', onClick: () => stageLine.set('The outline crosses itself.', 'error') }),
      ),
    ),
  ),
);

/* Fold-Up Box's stage: a panel holds the bottom centre for good, so the status line sits at the top;
   the fold panel's one control names itself; the flat view's switches are the compact kind. */
const FOLD_READY = 'Ready · 212 × 148 mm blank · fits A4';
const foldLine = stageStatus(FOLD_READY, { position: 'top' });
const foldScrub = slider({ min: 0, max: 100, value: 100, ariaLabel: 'Fold progress', className: 'kit-scrub', onInput: (v) => foldLine.set(`Folded ${v} %`) });
const foldPanel = stagePanel({
  title: 'Fold',
  titleHidden: true,
  open: true,
  body: [
    el('div', { className: 'kit-scrub-row' }, [
      button({
        label: 'Fold it',
        emphasis: 'primary',
        onClick: () => {
          foldScrub.setValue(0);
          foldLine.set('Folding…', 'busy');
          setTimeout(() => {
            foldScrub.setValue(100);
            foldLine.set(FOLD_READY);
          }, 700);
        },
      }),
      foldScrub,
    ]),
  ],
});
const flatPanel = stagePanel({
  title: 'Dieline',
  body: [
    el('div', { className: 'kit-switch-stack' }, [
      toggleSwitch({ label: 'Panel names', checked: true, compact: true }),
      toggleSwitch({ label: 'Sheet outline', checked: true, compact: true }),
    ]),
  ],
});
const foldModes = modeBar({
  modes: [{ value: 'fold', label: 'Fold' }, { value: 'flat', label: 'Flat' }],
  value: 'fold',
  onChange: (m) => {
    foldPanel.setOpen(m === 'fold');
    flatPanel.setOpen(m === 'flat');
  },
});
const foldStage = el('div', { className: 'kit-stage' }, [
  el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
  el('div', { className: 'kit-model' }, [el('div', { className: 'kit-model__lid' }), el('div', { className: 'kit-model__base' }), el('div', { className: 'kit-model__plate' })]),
  foldModes.root,
  foldPanel.root,
  flatPanel.root,
  foldLine.root,
]);

app.append(
  fullWidth(
    entry(
      "stageStatus(text, { position: 'top' }) · stagePanel({ titleHidden }) · toggleSwitch({ compact })",
      'A stage with a panel for good',
      'Fold-Up Box’s stage. Its fold panel never leaves the bottom centre, so the status line sits at ' +
        'the top left, under the label, where nothing covers it. The panel’s one control names ' +
        'itself, so its title is read out and not drawn. Switch to Flat: the dieline’s switches are ' +
        'the compact kind, a smaller label close to its switch.',
      foldStage,
      buttonRow(
        button({ label: 'Warning', onClick: () => foldLine.set('The lid tab is narrower than the glue flap.', 'warn') }),
        button({ label: 'Ready', onClick: () => foldLine.set(FOLD_READY) }),
      ),
    ),
  ),
);

/* A preview card: the view switch and the unit switch over a drawing that zooms, the status line
   and the zoom tools in its corners, and under it the strip the view needs. The drawing is the
   page's own, where an app's SVG or 3D canvas would be. */
const cardUnits = lengthUnits({ storageKey: 'kit-demo-unit' });
const PLATE_MM = { w: 120, h: 80 };
let cardZoomAt = 1;
const plateLabel = svgNode('text', { x: 100, y: 128, 'text-anchor': 'middle', 'font-size': 8, fill: 'currentColor' });
const plateSvg = svgNode('svg', { class: 'kit-plate', viewBox: '0 0 200 140', preserveAspectRatio: 'xMidYMid meet' }, [
  svgNode('rect', { x: 40, y: 30, width: 120, height: 80, rx: 8, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
  svgNode('circle', { cx: 52, cy: 42, r: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
  plateLabel,
]);
const cardStatus = stageStatus('');
const cardZoom = zoomControl({ onZoom: (factor) => showCardZoom(cardZoomAt * factor), onFit: () => showCardZoom(1) });
function showCardZoom(zoom: number): void {
  cardZoomAt = Math.min(8, Math.max(0.25, zoom));
  const w = 200 / cardZoomAt;
  const h = 140 / cardZoomAt;
  plateSvg.setAttribute('viewBox', `${100 - w / 2} ${70 - h / 2} ${w} ${h}`);
  cardZoom.set(cardZoomAt);
}
function showCardSizes(): void {
  plateLabel.textContent = cardUnits.format(PLATE_MM.w);
  cardStatus.set(`${cardUnits.formatSize(PLATE_MM.w, PLATE_MM.h)} · cut + engrave`);
}
cardUnits.onChange(showCardSizes);
showCardSizes();
const cardTools = el('div', { className: 'kit-card-strip kit-card-strip--tools' }, [
  toggleSwitch({ label: 'Open', compact: true }),
  toggleSwitch({ label: 'Pull apart', compact: true }),
]);
const cardLegend = el('div', { className: 'kit-card-strip', text: 'Red cuts · blue scores · black engraves.' });
cardLegend.hidden = true;
const cardViews = segmentedControl({
  options: [
    { value: 'three', label: '3D Preview' },
    { value: 'file', label: 'Export Preview' },
  ],
  value: 'three',
  fit: 'content',
  size: 'compact',
  ariaLabel: 'View',
  onChange: (v) => {
    cardTools.hidden = v !== 'three';
    cardLegend.hidden = v !== 'file';
    // The export is a white sheet that has to stay clear: the status line goes under the strip.
    plateSvg.classList.toggle('kit-plate--sheet', v === 'file');
    demoCard.statusBelow(v === 'file');
  },
});
const demoCard = previewCard({
  start: [cardViews],
  end: [cardUnits.unitSwitch({ fit: 'content' })],
  view: [plateSvg],
  status: cardStatus.root,
  zoom: cardZoom.root,
  footer: [cardTools, cardLegend],
});

app.append(
  fullWidth(
    entry(
      'previewCard() · zoomControl() · lengthUnits()',
      'Preview card',
      'The stage as a framed card, at Laser Studio’s numbers: the view switch and the mm | in switch ' +
        'in a bar over the picture, the status line and the zoom tools in its bottom corners, and ' +
        'under it the strip the view needs: the 3D view’s switches, or what the export’s colours ' +
        'mean. In Export Preview the status line moves under that strip, clear of the white sheet. ' +
        'The unit switch is lengthUnits(): every length on the card follows it, with no trailing ' +
        'zero, and the choice is remembered. On a phone the zoom tools go to the top corner without ' +
        'the number.',
      el('div', { className: 'kit-stage' }, [demoCard.root]),
    ),
  ),
);

/* ---------- Diagnostics ---------- */
/* What a build found, three ways. The "build" is a real buildLoop whose result is the list, so
   Download is refused through settled() exactly as it is in an app. */
const ONE_OF_EACH: Diagnostic[] = [
  {
    level: 'warning',
    message: 'The letters are 0.6 mm wide in places, thinner than two lines of a 0.4 mm nozzle.',
    fix: 'Pick a bolder font, or make the text bigger.',
  },
  {
    level: 'error',
    message: 'The text runs off the plate: it is 268 mm long and the A1 mini plate is 180 mm.',
    fix: 'Make the text smaller, or pick a bigger plate.',
  },
  { level: 'info', message: 'The letters print in a second colour.', fix: 'Pause at layer 12 to swap filament, or print with an AMS.' },
];
let demoFound = ONE_OF_EACH;
const diagLine = stageStatus('Building…');
const diagList = diagnosticsList();
const diagLoop = buildLoop({
  run: () => demoFound,
  diagnose: (found) => found,
  onResult: (found) => {
    diagLine.setDiagnostics(found, 'Ready · 2 parts');
    diagList.set(found);
  },
});
function showFound(found: Diagnostic[]): void {
  demoFound = found;
  diagLoop.request();
}
showFound(ONE_OF_EACH);

app.append(
  entry(
    'diagnosticsList() · stageStatus().setDiagnostics() · buildLoop({ diagnose })',
    'Diagnostics',
    'What a build found about the model. The status line carries the worst problem and how many ' +
      'there are; the list carries every one, with what to do about it; and Download refuses while ' +
      'an error stands, in that error’s own words, because settled() refuses it. Notes stay in the ' +
      'list. The buttons change what the build found.',
    el('div', { className: 'kit-stage kit-stage--short' }, [diagLine.root]),
    el('div', { className: 'kit-sidebar-frame' }, [
      section({ title: 'Checks', body: [diagList.root] }),
      exportPanel({
        formats: [{ id: '3mf', label: '3MF' }],
        onExport: async (id) => {
          await diagLoop.settled();
          toast(`Exported demo.${id}`, { kind: 'ok' });
        },
      }),
    ]),
    buttonRow(
      button({ label: 'One of each', onClick: () => showFound(ONE_OF_EACH) }),
      button({ label: 'Fix the error', onClick: () => showFound(ONE_OF_EACH.filter((d) => d.level !== 'error')) }),
      button({ label: 'All clear', onClick: () => showFound([]) }),
    ),
  ),
);

/* The build loop's two ways in from outside it: a seed, a design shipped prebuilt and on screen
   before anything is built, and a hold, a batch run of the app's own that no rebuild may
   interrupt. A build here takes a second, so an export pressed during one, or during the batch,
   can be seen to wait. */
let loopDesign = 0;
const loopLine = el('p', { className: 'vl-hint' });
const designLoop = buildLoop({
  run: () => new Promise<number>((done) => setTimeout(() => done(loopDesign), 1000)),
  onStart: () => (loopLine.textContent = `Building design ${loopDesign}…`),
  onResult: (n) => (loopLine.textContent = `Showing design ${n}.`),
});
designLoop.seed(0);
loopLine.textContent = 'Showing design 0, shipped prebuilt: nothing was built.';
async function runLoopBatch(): Promise<void> {
  const release = designLoop.hold();
  if (!release) {
    toast('A build is running. Try again when it lands.', { kind: 'warn' });
    return;
  }
  try {
    for (let i = 0; i < 26; i++) {
      loopLine.textContent = `Batch: ${String.fromCharCode(65 + i)} (${i + 1}/26). Nothing rebuilds, and Export waits.`;
      await new Promise((done) => setTimeout(done, 120));
    }
    loopLine.textContent = `Batch done. Showing design ${designLoop.latest}.`;
  } finally {
    release();
  }
}

app.append(
  entry(
    'buildLoop().seed() · buildLoop().hold()',
    'Build loop: a prebuilt start, a batch run',
    'seed() starts the loop from a design built elsewhere, so the first screen and an export of it ' +
      'need no build. hold() lets a batch of the app’s own (an alphabet, a set) run with no rebuild ' +
      'starting under it: Export waits until the batch lets go, and a change made meanwhile builds ' +
      'once, after it.',
    loopLine,
    buttonRow(
      button({
        label: 'Change the design',
        emphasis: 'secondary',
        onClick: () => {
          loopDesign += 1;
          designLoop.request();
        },
      }),
      button({ label: 'Run a batch', emphasis: 'secondary', onClick: () => void runLoopBatch() }),
      button({
        label: 'Export',
        onClick: async () => {
          const n = await designLoop.settled();
          toast(`Exported design ${n}`, { kind: 'ok' });
        },
      }),
    ),
  ),
);

/* ---------- Overlays ---------- */
/* A small form hanging off the button that opened it; pressing the button again closes it. */
const SHEET_SIZES: Record<string, string> = { small: '300 × 200 mm', medium: '400 × 300 mm', large: '600 × 400 mm' };
let sheetSize = 'small';
let sheetMargin = 5;
let sheetPopover: { close(): void } | null = null;
const sheetForm = () =>
  section({
    title: '',
    body: [
      selectField({
        label: 'Sheet size',
        options: Object.entries(SHEET_SIZES).map(([value, label]) => ({ value, label })),
        value: sheetSize,
        onChange: (v) => {
          sheetSize = v;
          sheetButton.setLabel(`Sheet: ${SHEET_SIZES[v]}`);
        },
      }),
      numberField({ label: 'Margin', value: sheetMargin, min: 0, max: 20, unit: 'mm', onInput: (v) => (sheetMargin = v) }),
    ],
  });
const sheetButton = button({
  label: `Sheet: ${SHEET_SIZES[sheetSize]}`,
  emphasis: 'secondary',
  onClick: () => {
    if (sheetPopover) sheetPopover.close();
    else sheetPopover = popover({ anchor: sheetButton, align: 'start', width: 280, content: sheetForm(), onClose: () => (sheetPopover = null) });
  },
});

app.append(
  group('Overlays'),
  entry(
    'toast()',
    'Toasts',
    'Transient status messages, bottom-center, colored by kind. Safe to call from anywhere.',
    row(
      button({ label: 'Info', onClick: () => toast('Just so you know') }),
      button({ label: 'Success', onClick: () => toast('Saved', { kind: 'ok' }) }),
      button({ label: 'Error', onClick: () => toast('Something broke', { kind: 'error' }) }),
    ),
  ),
  entry(
    'dialog()',
    'Dialog',
    'Accessible modal: Esc and backdrop click close it, focus returns where it was. Now with a proper surface behind it.',
    row(
      button({
        label: 'Open dialog',
        onClick: () =>
          dialog({
            title: 'Discard changes?',
            content: 'Your current settings will be lost. This cannot be undone.',
            actions: [
              { label: 'Keep editing' },
              { label: 'Discard', primary: true, onClick: () => toast('Discarded', { kind: 'warn' }) },
            ],
          }),
      }),
    ),
  ),
  entry(
    'splitDialog()',
    'Split dialog',
    'The two-pane modal: a working surface on the left, its controls on the right, and a footer ' +
      'that shares the action bar. The stage keeps its own overflow and the control column scrolls ' +
      'independently, so a long list of settings never scrolls the thing it is settings for off the ' +
      'screen. Below 900px the panes stack, stage first. openSvgImport() is built on it.',
    row(
      button({
        label: 'Open split dialog',
        onClick: () =>
          splitDialog({
            title: 'Prepare picture',
            stage: emptyState({
              title: 'The stage pane',
              body: 'A canvas, a preview, a pair of pictures — whatever the window exists to show.',
              icon: ICONS.image,
            }),
            controls: section({
              title: 'PICTURE',
              body: [
              segmentedControl({
                label: 'Mode',
                options: [
                  { value: 'photo', label: 'Photo' },
                  { value: 'lineart', label: 'Line art' },
                ],
                value: 'photo',
              }),
              sliderRow({ label: 'Brightness', min: -100, max: 100, value: 0 }),
              sliderRow({ label: 'Contrast', min: -100, max: 100, value: 0 }),
              toggleSwitch({ label: 'Invert', help: 'For dark material where the burn goes lighter.' }),
              ],
            }),
            footer: el('span', { className: 'vl-hint', text: 'The footer sits left of the actions.' }),
            actions: [
              { label: 'Cancel' },
              { label: 'Confirm', primary: true, onClick: () => toast('Confirmed', { kind: 'ok' }) },
            ],
          }),
      }),
    ),
  ),
  entry(
    'showWhatsNew()',
    "What's new",
    'A changelog card with a dismiss-forever checkbox, shown once per release.',
    row(
      button({
        label: 'Show card',
        onClick: () =>
          showWhatsNew({
            items: [
              { lead: 'Sharper image tracing', text: 'high-quality resampling keeps fine text intact.' },
              { lead: 'Multiple switches', text: 'use up to three MX switches for bigger designs.' },
            ],
          }),
      }),
    ),
  ),
  entry(
    'changelogButton() · openChangelog()',
    'Update timeline',
    'The other half of the release story, and the one people ask for by name: a dated list of ' +
      'what was fixed and added, in an edge drawer so the model stays on screen while they read. ' +
      'Where showWhatsNew() is pushed at someone on load, this is pressed. Bullets are grouped ' +
      'by kind and entries sorted by date, so an app just keeps appending to its own ' +
      'src/changelog.ts. Keep each line to a few words — it is scanned, not read.',
    row(
      changelogButton({
        block: false,
        label: 'Open updates',
        title: 'Kit updates',
        entries: [
          {
            date: '2026-08-27',
            changes: [
              { kind: 'added', text: 'Flap thickness setting' },
              { kind: 'fixed', text: 'Typing a size in inches' },
              { kind: 'fixed', text: 'Long readouts cut off in the value boxes' },
              { kind: 'changed', text: 'Locking lugs sized from the tuck, not the box width' },
            ],
          },
          {
            date: '2026-08-26',
            changes: [{ kind: 'added', text: 'Everything' }],
          },
        ],
      }),
    ),
  ),
  entry(
    'drawer()',
    'Drawer',
    'A panel that slides in at the edge instead of over the middle. There is no backdrop and ' +
      'nothing goes inert, so the stage behind keeps working while you choose. One at a time; ' +
      'Escape or the cross closes it and focus goes back where it was. On a phone it is a bottom sheet.',
    row(
      button({
        label: 'Open drawer',
        onClick: () =>
          drawer({
            title: 'Engraving',
            content: section({
              title: '',
              body: [
                sliderRow({ label: 'Depth', min: 0.2, max: 2, step: 0.1, value: 0.6, unit: 'mm' }),
                toggleSwitch({ label: 'Mirror for the back face' }),
                el('p', { className: 'vl-hint', text: 'Nothing behind this drawer is dimmed or blocked.' }),
              ],
            }),
            onClose: () => toast('Drawer closed'),
          }),
      }),
    ),
  ),
  entry(
    'popover()',
    'Popover',
    'The third shape of floating content: openMenu() is a list of commands, helpTip() a sentence, ' +
      'and this is a small form hanging off the control that opened it. Fixed-positioned, so a ' +
      'panel’s overflow cannot clip it; it closes on a press outside, Escape, or a resize.',
    row(sheetButton),
  ),
);

/* ---------- Licensing ---------- */
app.append(
  group('Licensing'),
  entry(
    'licenseNudge()',
    'Inline nudge',
    'The quiet line on every export path: free for personal use, with a link to the full commercial terms.',
    licenseNudge({ generatorName: 'The Clicker Generator' }),
  ),
  entry(
    'openLicenseModal() · licenseReminderToast()',
    'License modals',
    'The post-download modal and the lighter corner reminder for repeat downloads.',
    row(
      button({ label: 'Commercial modal', onClick: () => openCommercialModal() }),
      button({ label: 'Post-download modal', onClick: () => openLicenseModal() }),
      button({ label: 'Corner reminder', onClick: () => licenseReminderToast() }),
    ),
  ),
);

/* ---------- Sharing & export ---------- */
const fakeParams = { size: 42, style: 'rounded', text: 'VOSTOK' };
app.append(
  group('Sharing & export'),
  entry(
    'fontCards()',
    'Font cards',
    'The curated font grid: the user\'s own word set in each face, two to a row, the chosen one ' +
      'outlined. The short list that sits in a panel; "Browse all" opens fontPicker() for the rest. ' +
      'The name keychain hand-rolled this as .nk-font-card; the classes moved into the kit, the function did not — until now.',
    el('div', { className: 'kit-sidebar-frame' }, [
      fontCards({
        fonts: [
          { id: 'serif', label: 'Serif', family: 'Georgia, serif' },
          { id: 'sans', label: 'Sans', family: 'system-ui, sans-serif' },
          { id: 'mono', label: 'Mono', family: 'ui-monospace, monospace' },
          { id: 'cursive', label: 'Cursive', family: 'cursive' },
        ],
        value: 'sans',
        sample: 'Name',
        onChange: (id) => toast(`Font: ${id}`),
      }),
    ]),
  ),
  entry(
    'presetShareButton() · offlineDownloadButton()',
    'Share & offline',
    'Copy a link that reopens the exact settings, or download the single-file offline build. Same button base, so they match.',
    row(presetShareButton({ getParams: () => fakeParams }), offlineDownloadButton({ href: '#', sizeHint: '~4 MB' })),
    el('p', {
      className: 'vl-hint',
      text: `Params read back from this URL's hash: ${JSON.stringify(readParamsFromHash()) ?? 'none'}`,
    }),
  ),
  entry(
    'sidebarFooter()',
    'Export module',
    'The whole block every generator pins to the bottom of its right sidebar: the 3MF ' +
      'export on top, then Save / Load / Help / theme. This is what to reach for, ' +
      'exportPanel() below is only the format-button strip inside it.',
    // Pinned to a real sidebar's width — at the demo column's full width the
    // action grid stops wrapping to 2x2 and stops looking like what ships.
    el('div', { className: 'kit-sidebar-frame' }, [
      sidebarFooter({
        // 3MF only, as shipped. STL carries neither the colours nor the part
        // split, so offering it beside the real export is a downgrade, not a choice.
        formats: [{ id: '3mf', label: '3MF' }],
        onExport: async (id) => {
          await new Promise((r) => setTimeout(r, 800));
          toast(`Exported demo.${id}`, { kind: 'ok' });
        },
        onSave: () => toast('Project saved', { kind: 'ok' }),
        onLoad: () => toast('Project loaded', { kind: 'ok' }),
        onHelp: () => toast('Help dialog opens here'),
        themeStorageKey: 'kit-demo-theme',
      }),
    ]),
  ),
  entry(
    'exportPanel()',
    'Export panel (the strip inside it)',
    'Just the format buttons: they disable while an export runs and surface failures as ' +
      'toasts. Use it directly only when you are building custom footer chrome.',
    exportPanel({
      formats: [{ id: '3mf', label: '3MF' }],
      onExport: async (id) => {
        await new Promise((r) => setTimeout(r, 800));
        toast(`Exported demo.${id}`, { kind: 'ok' });
      },
      note: 'Buttons disable while an export runs; errors surface as toasts.',
    }),
  ),
);

/* A cover from the stage. The "stage" is a 2D canvas the page draws a star on, standing in for
   an app's three.js renderer; the one that cannot be read has no size, so it reads back as
   `data:,`, the way a lost WebGL context gives nothing back. */
const coverStage = el('canvas', { className: 'kit-cover', attrs: { width: '96', height: '96', 'aria-label': 'The stage' } });
const stageRenderer = (canvas: HTMLCanvasElement) => ({
  domElement: canvas,
  render: () => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = themeColor('--bg', 'transparent');
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = themeColor('--accent', 'gray');
    g.fill(new Path2D(ringPath(polyPoints(5, 40, 17, -Math.PI / 2, 48, 50))));
  },
});
const coverShot = el('img', { className: 'kit-cover', attrs: { alt: 'The captured cover' } });
const coverNote = el('p', { className: 'vl-hint' });
/** The picture handed back when the canvas cannot be read: here, the plain square. */
const coverFallback = shapePicture(shapeOf('square').d);
function takeCover(canvas: HTMLCanvasElement): void {
  const url = captureCover(stageRenderer(canvas), null, null, { fallback: coverFallback });
  coverShot.src = url;
  coverNote.textContent =
    url === coverFallback ? 'The canvas could not be read, so the fallback came back.' : `A ${canvas.width} × ${canvas.height} px PNG from the stage.`;
}
takeCover(coverStage);

app.append(
  entry(
    'captureCover(renderer, scene, camera, { fallback })',
    'Cover image capture',
    'Draws one fresh frame of the stage and reads it back in the same task, as the picture for a ' +
      'listing cover. With fallback, a canvas that cannot be read (a lost context, a tainted canvas, ' +
      'one with no size) hands back the picture given instead of failing the export, and says why ' +
      'in the console.',
    el('div', { className: 'kit-chosen' }, [coverStage, coverShot, coverNote]),
    row(
      button({ label: 'Capture the stage', onClick: () => takeCover(coverStage) }),
      button({ label: 'Capture a canvas that cannot be read', emphasis: 'secondary', onClick: () => takeCover(el('canvas', { attrs: { width: '0', height: '0' } })) }),
    ),
  ),
);

/* ---------- Layouts ---------- */
/* appShell() and designShell() are each a whole page. Built with `contained: true` they fill the
   fixed-height box below instead of the window. The box spans the window because their columns
   are sized in vw: in this page's 1000 px column the stage would get almost nothing. */
const inWindow = (root: HTMLElement): HTMLElement => el('div', { className: 'kit-window' }, [root]);

/* Rows the three layouts below share. */
const mmSlider = (label: string, min: number, max: number, value: number) => sliderRow({ label, min, max, value, unit: 'mm' });
const outlineTabs = (label?: string) =>
  segmentedControl({ label, options: [{ value: 'follow', label: 'Follow' }, { value: 'pill', label: 'Pill' }, { value: 'box', label: 'Box' }], value: 'follow' });
/** A placeholder where a stage's canvas would be. */
const stagePlaceholder = (icon: string, title: string, body: string) => el('div', { className: 'kit-stage-fill' }, [emptyState({ icon, title, body })]);

const rail = settingsRail({
  label: 'Keychain settings',
  items: [
    { id: 'shape', label: 'Shape', icon: ICONS.box, body: [outlineTabs('Outline'), mmSlider('Width', 30, 90, 56), mmSlider('Corner radius', 0, 10, 3)] },
    { id: 'text', label: 'Text', icon: ICONS.text, body: [textField({ label: 'Name', value: 'Max' }), mmSlider('Letter size', 6, 20, 12)] },
    { id: 'colour', label: 'Colour', icon: ICONS.droplet, body: [paletteRow({ label: 'Body', value: '#2f6fde' }), paletteRow({ label: 'Letters', value: '#f7f7f5' })] },
    { id: 'hole', label: 'Hole', icon: ICONS.target, divider: true, body: [toggleSwitch({ label: 'Hanging hole', checked: true }), mmSlider('Hole size', 3, 8, 5)] },
  ],
});

const appFrame = appShell({
  contained: true,
  topbar: topbarLinks({ themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({ title: 'Name Keychain Generator', description: 'A name with an outline that follows the letters.', hideCredit: true }),
      section({ title: 'Text', body: [textField({ label: 'Name', value: 'Max' }), mmSlider('Letter size', 6, 20, 12)] }),
      section({ title: 'Outline', body: [outlineTabs(), mmSlider('Thickness', 1, 6, 3)] }),
    ],
    credit: panelCredit({ title: 'Name Keychain Generator' }),
  },
  stage: [
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    stagePlaceholder(ICONS.box, 'The viewer mounts here', 'An app puts its 3D canvas in shell.stage, under the stage overlays.'),
    stageStatus('Ready · 2 parts').root,
  ],
  right: {
    scroll: [
      section({ title: 'Colours', body: [paletteRow({ label: 'Body', value: '#161616' }), paletteRow({ label: 'Letters', value: '#f7f7f5' })] }),
      section({ title: 'Hole', body: [toggleSwitch({ label: 'Hanging hole', checked: true })] }),
    ],
    footer: [
      sidebarFooter({
        formats: [{ id: '3mf', label: '3MF' }],
        onExport: async (id) => {
          await new Promise((r) => setTimeout(r, 600));
          toast(`Exported demo.${id}`, { kind: 'ok' });
        },
        onSave: () => toast('Project saved', { kind: 'ok' }),
        onLoad: () => toast('Project loaded', { kind: 'ok' }),
        onHelp: () => toast('Help dialog opens here'),
        themeStorageKey: 'kit-demo-theme',
      }),
    ],
  },
});

/* A left panel that is a rail and nothing else: the name over the rail, Reset at the foot, the
   credit under it. The panel is compact and the rail flush, so the open category scrolls and the
   rail stays put. */
const flushRail = settingsRail({
  label: 'Keychain settings',
  flush: true,
  items: [
    { id: 'shape', label: 'Shape', icon: ICONS.box, body: [outlineTabs('Outline'), mmSlider('Width', 30, 90, 56), mmSlider('Height', 20, 60, 32), mmSlider('Corner radius', 0, 10, 3)] },
    { id: 'text', label: 'Text', icon: ICONS.text, body: [mmSlider('Letter size', 6, 20, 12), mmSlider('Letter spacing', 0, 4, 0.6)] },
    { id: 'hole', label: 'Hole', icon: ICONS.target, divider: true, body: [toggleSwitch({ label: 'Hanging hole', checked: true }), mmSlider('Hole size', 3, 8, 5)] },
  ],
});
const railShell = appShell({
  contained: true,
  topbar: topbarLinks({ themeToggle: false }),
  left: {
    compact: true,
    header: [
      button({ label: 'All designs', icon: ICONS.chevronLeft, emphasis: 'ghost', onClick: () => toast('Back to the gallery') }),
      generatorHeader({ title: 'Name Keychain', hideCredit: true }),
    ],
    scroll: [flushRail],
    footer: [button({ label: 'Reset', icon: ICONS.rotateLeft, emphasis: 'ghost', onClick: () => toast('Reset') })],
    credit: panelCredit({ title: 'Laser Studio' }),
  },
  stage: [stagePlaceholder(ICONS.box, 'The preview mounts here', 'The left panel is the rail: pick a category, and only that category scrolls.')],
  right: {
    scroll: [section({ title: 'Text', body: [textField({ label: 'Name', value: 'Max' })] })],
    footer: [button({ label: 'Download SVG', emphasis: 'primary', block: true, icon: ICONS.download, onClick: () => toast('Download') })],
  },
});

/* The same kind of frame with the phone layout on: below 900 px the left panel's settings move
   behind a Settings button pinned at the foot, beside Download. */
const phoneShell = appShell({
  contained: true,
  phone: true,
  topbar: topbarLinks({ themeToggle: false }),
  left: {
    compact: true,
    header: [generatorHeader({ title: 'Name Keychain', hideCredit: true })],
    scroll: [
      settingsRail({
        label: 'Keychain settings',
        flush: true,
        items: [
          { id: 'shape', label: 'Shape', icon: ICONS.box, body: [outlineTabs('Outline'), mmSlider('Width', 30, 90, 56), mmSlider('Corner radius', 0, 10, 3)] },
          { id: 'hole', label: 'Hole', icon: ICONS.target, body: [toggleSwitch({ label: 'Hanging hole', checked: true }), mmSlider('Hole size', 3, 8, 5)] },
        ],
      }),
    ],
    footer: [buttonRow(button({ label: 'Reset', icon: ICONS.rotateLeft, emphasis: 'ghost', onClick: () => toast('Reset') }))],
    credit: panelCredit({ title: 'Name Keychain' }),
  },
  stage: [stagePlaceholder(ICONS.box, 'The preview comes first', 'Narrow the window below 900 px: one column, this picture, then the panel on the right.')],
  right: {
    scroll: [section({ title: 'Text', body: [textField({ label: 'Name', value: 'Max' }), mmSlider('Letter size', 6, 20, 12)] })],
    footer: [
      sidebarFooter({
        formats: [{ id: 'svg', label: 'SVG' }],
        onExport: async (id) => {
          await new Promise((r) => setTimeout(r, 600));
          toast(`Exported demo.${id}`, { kind: 'ok' });
        },
        onSave: () => toast('Project saved', { kind: 'ok' }),
        onLoad: () => toast('Project loaded', { kind: 'ok' }),
        onHelp: () => toast('Help dialog opens here'),
        themeStorageKey: 'kit-demo-theme',
      }),
    ],
  },
});

/* The editor frame: a Design body (tool rail, panel slot, canvas, Objects) and a studio, swapped
   by the suite bar's tabs. */
const EDITOR_TOOLS = [
  { value: 'text', label: 'Text', icon: ICONS.text },
  { value: 'shape', label: 'Shape', icon: ICONS.box },
  { value: 'image', label: 'Image', icon: ICONS.image },
  { value: 'qr', label: 'QR', icon: ICONS.qr },
  { value: 'pattern', label: 'Pattern', icon: ICONS.pattern, divider: true },
];
const EDITOR_TRAILING = [{ value: 'layers', label: 'Layers', icon: ICONS.layers }];
let editorTool: string | null = null;
const editorStatus = statusBar({ items: ['tool', 'spacer', 'sheet', 'zoom'] });
editorStatus.set('tool', 'Select');
editorStatus.set('sheet', `Sheet ${SHEET_SIZES.small}`);
editorStatus.set('zoom', 'Zoom 100%');
const selection = floatingPanel({
  title: 'Selection',
  subtitle: 'Max',
  body: [mmSlider('Size', 6, 40, 18), segmentedControl({ options: [{ value: 'cut', label: 'Cut' }, { value: 'engrave', label: 'Engrave' }], value: 'engrave' })],
  onClose: () => {
    selection.root.hidden = true;
  },
});
const objectRows: ListRowHandle[] = [
  { label: 'Max', meta: 'Text' },
  { label: 'Heart', meta: 'Shape' },
  { label: 'Hanging hole', meta: 'Hole' },
].map((o, i) =>
  listRow({
    ...o,
    active: i === 0,
    onClick: () => {
      objectRows.forEach((r, j) => r.setActive(j === i));
      selection.setSubtitle(o.label);
      selection.root.hidden = false;
    },
  }),
);
const editorRail = toolRail({
  items: EDITOR_TOOLS,
  trailing: EDITOR_TRAILING,
  value: null,
  onChange: (tool) => {
    editorTool = editorTool === tool ? null : tool;
    editorRail.setValue(editorTool);
    const label = [...EDITOR_TOOLS, ...EDITOR_TRAILING].find((t) => t.value === editorTool)?.label;
    design.setPanel(
      label
        ? el('div', { className: 'kit-stack kit-stack--pad' }, [
            el('p', { className: 'vl-label', text: label }),
            el('p', { className: 'vl-hint', text: `The ${label.toLowerCase()} library opens in this slot, beside the rail. Press ${label} again to close it.` }),
          ])
        : null,
    );
    editorStatus.set('tool', label ?? 'Select');
  },
});
const contextAction = (icon: string, label: string) => iconButton({ icon, label, onClick: () => toast(label) });
const design = designBody({
  contextbar: toolbar({
    variant: 'context',
    groups: [
      [contextAction(ICONS.alignLeft, 'Align left'), contextAction(ICONS.alignCenter, 'Align centre'), contextAction(ICONS.alignRight, 'Align right')],
      [contextAction(ICONS.flipH, 'Flip horizontally'), contextAction(ICONS.flipV, 'Flip vertically')],
    ],
    trailing: [button({ label: 'Duplicate', emphasis: 'ghost', onClick: () => toast('Duplicate') })],
  }).root,
  rail: editorRail.root,
  canvas: [selection.root],
  objects: { header: [el('p', { className: 'vl-label', text: 'Objects' })], scroll: objectRows },
});
const studio = studioView({
  left: { scroll: [section({ title: 'Size', body: [mmSlider('Width', 40, 200, 120), mmSlider('Height', 40, 200, 80)] })] },
  stage: [stagePlaceholder(ICONS.layers, 'A studio', 'A generator’s settings, stage and output, under the suite bar instead of a top bar of its own.')],
  right: {
    scroll: [
      section({
        title: 'Material',
        body: [selectField({ label: 'Thickness', options: [{ value: '3', label: '3 mm plywood' }, { value: '4', label: '4 mm plywood' }], value: '3' })],
      }),
    ],
  },
});
const editorFrame = designShell({
  contained: true,
  topbar: suiteBar({
    title: 'Editor',
    tabs: [{ value: 'design', label: 'Design' }, { value: 'studio', label: 'Studio' }],
    value: 'design',
    name: 'Untitled design',
    onRename: (name) => toast(`Renamed to ${name}`),
    onChange: (tab) => editorFrame.setBody(tab === 'design' ? design.root : studio.root),
    trailing: [button({ label: 'Export', emphasis: 'primary', icon: ICONS.download, onClick: () => toast('Export') })],
  }).root,
  statusbar: editorStatus.root,
});
editorFrame.setBody(design.root);

app.append(
  group('Layouts'),
  entry(
    'settingsRail()',
    'Settings rail',
    'Settings in categories, one open at a time: a rail of icons down the panel’s edge and the ' +
      'open category beside it, scrolling on its own so the rail stays put. A category whose rows ' +
      'the app has all hidden takes its button off the rail. Framed here at a panel’s size.',
    el('div', { className: 'kit-rail-frame' }, [rail]),
  ),
  fullWidth(
    entry(
      'appShell()',
      'App frame',
      'The standard generator layout: the top bar, settings on the left, the stage in the middle and ' +
        'the product panel on the right, with the phone layout built in. Each panel takes a pinned ' +
        'header, a scrolling body, a credit strip and a sticky footer; an app fills the slots and ' +
        'mounts its viewer in shell.stage. In an app it is the whole window; here it is a fixed-height box.',
      inWindow(appFrame.root),
    ),
  ),
  fullWidth(
    entry(
      'appShell({ left: { compact: true } }) · settingsRail({ flush: true })',
      'Rail panel',
      'A left panel that is the rail and nothing else, as Laser Studio’s is. The rail is flush: it ' +
        'fills the panel edge to edge and only the open category scrolls, so the rail stays put. The ' +
        'panel is compact: the header follows the rail’s rhythm with the back button at its own ' +
        'width, the footer is one slim row, and the credit strip sits at the very foot.',
      inWindow(railShell.root),
    ),
  ),
  fullWidth(
    entry(
      'appShell({ phone: true })',
      'Phone layout',
      'Narrow the window below 900 px to see it. One column: the picture first, then the panel on ' +
        'the right, with Download pinned to the bottom of the screen beside a Settings button. ' +
        'Settings opens the left panel’s rail and Reset in a drawer (a bottom sheet on a phone) and ' +
        'puts them back when it closes; Save, Load and Help follow the panel’s content. On a wider ' +
        'screen nothing moves.',
      inWindow(phoneShell.root),
    ),
  ),
  fullWidth(
    entry(
      'designShell() · studioView() · toolRail()',
      'Editor frame',
      'The second house layout, for a tool you compose on rather than parametrise: the suite bar, a ' +
        'body that swaps, and the status strip. The Design body is the context bar over the tool rail, ' +
        'a panel slot, the canvas with the selection’s floating panel, and the Objects column. A ' +
        'studio is a generator’s three columns without its top bar. Switch the tabs, press a tool, ' +
        'pick an object.',
      inWindow(editorFrame.root),
    ),
  ),
);

app.append(
  el('footer', { className: 'kit-footer', text: `vostok-labs-tools · packages/ui-kit · v${UI_KIT_VERSION}` }),
);
