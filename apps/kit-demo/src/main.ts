import '@vostok/ui-kit/styles.css';
import {
  el,
  toast,
  dialog,
  licenseNudge,
  openCommercialModal,
  openLicenseModal,
  licenseReminderToast,
  topbarLinks,
  showWhatsNew,
  changelogButton,
  supportLinks,
  exportPanel,
  sidebarFooter,
  offlineDownloadButton,
  presetShareButton,
  readParamsFromHash,
  toggleSwitch,
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
  ICONS,
  UI_KIT_VERSION,
} from '@vostok/ui-kit';
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
app.append(
  group('Chrome'),
  entry('topbarLinks()', 'Topbar', 'The standard generator header: GitHub and commercial license on the left, donate actions on the right.', topbarLinks()),
  entry('supportLinks()', 'Support links', 'Ko-fi, MakerWorld, and GitHub as one styled row. Placeholder URLs are hidden automatically.', supportLinks()),
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
    'The two pickers every generator reaches for: an on/off switch and a one-of-many segmented control.',
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
    ),
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
);

/* ---------- Elements (the primitives adopted from Opal) ---------- */
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
);

/* ---------- Overlays ---------- */
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

app.append(
  el('footer', { className: 'kit-footer', text: `vostok-labs-tools · packages/ui-kit · v${UI_KIT_VERSION}` }),
);
