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
  supportLinks,
  exportPanel,
  offlineDownloadButton,
  presetShareButton,
  readParamsFromHash,
  toggleSwitch,
  sliderRow,
  segmentedControl,
  selectField,
  helpTip,
  dpad,
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
const themeToggle = el('button', {
  className: 'vl-btn vl-btn--ghost',
  text: 'Toggle theme',
  attrs: { type: 'button' },
  on: {
    click: () => {
      const root = document.documentElement;
      root.setAttribute(
        'data-theme',
        root.getAttribute('data-theme') === 'light' ? 'dark' : 'light',
      );
    },
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

app.append(
  group('Foundations'),
  entry('tokens.css', 'Design tokens', 'One palette drives light and dark. Values are read live from the running CSS.', swatches),
  entry(
    '.vl-btn',
    'Buttons',
    'Primary, default, ghost, and disabled, all from the button base. .vl-row keeps a cluster aligned and evenly spaced.',
    row(
      el('button', { className: 'vl-btn vl-btn--primary', text: 'Primary', attrs: { type: 'button' } }),
      el('button', { className: 'vl-btn', text: 'Default', attrs: { type: 'button' } }),
      el('button', { className: 'vl-btn vl-btn--ghost', text: 'Ghost', attrs: { type: 'button' } }),
      (() => {
        const b = el('button', { className: 'vl-btn', text: 'Disabled', attrs: { type: 'button' } });
        b.disabled = true;
        return b;
      })(),
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

app.append(
  group('Controls'),
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

/* ---------- Overlays ---------- */
app.append(
  group('Overlays'),
  entry(
    'toast()',
    'Toasts',
    'Transient status messages, bottom-center, colored by kind. Safe to call from anywhere.',
    row(
      el('button', { className: 'vl-btn', text: 'Info', attrs: { type: 'button' }, on: { click: () => toast('Just so you know') } }),
      el('button', { className: 'vl-btn', text: 'Success', attrs: { type: 'button' }, on: { click: () => toast('Saved', { kind: 'ok' }) } }),
      el('button', { className: 'vl-btn', text: 'Error', attrs: { type: 'button' }, on: { click: () => toast('Something broke', { kind: 'error' }) } }),
    ),
  ),
  entry(
    'dialog()',
    'Dialog',
    'Accessible modal: Esc and backdrop click close it, focus returns where it was. Now with a proper surface behind it.',
    row(
      el('button', {
        className: 'vl-btn',
        text: 'Open dialog',
        attrs: { type: 'button' },
        on: {
          click: () =>
            dialog({
              title: 'Discard changes?',
              content: 'Your current settings will be lost. This cannot be undone.',
              actions: [
                { label: 'Keep editing' },
                { label: 'Discard', primary: true, onClick: () => toast('Discarded', { kind: 'warn' }) },
              ],
            }),
        },
      }),
    ),
  ),
  entry(
    'showWhatsNew()',
    "What's new",
    'A changelog card with a dismiss-forever checkbox, shown once per release.',
    row(
      el('button', {
        className: 'vl-btn',
        text: 'Show card',
        attrs: { type: 'button' },
        on: {
          click: () =>
            showWhatsNew({
              items: [
                { lead: 'Sharper image tracing', text: 'high-quality resampling keeps fine text intact.' },
                { lead: 'Multiple switches', text: 'use up to three MX switches for bigger designs.' },
              ],
            }),
        },
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
      el('button', { className: 'vl-btn', text: 'Commercial modal', attrs: { type: 'button' }, on: { click: () => openCommercialModal() } }),
      el('button', { className: 'vl-btn', text: 'Post-download modal', attrs: { type: 'button' }, on: { click: () => openLicenseModal() } }),
      el('button', { className: 'vl-btn', text: 'Corner reminder', attrs: { type: 'button' }, on: { click: () => licenseReminderToast() } }),
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
    'exportPanel()',
    'Export panel',
    'Format buttons that disable while an export runs and surface failures as toasts. The app owns the real export.',
    exportPanel({
      formats: [
        { id: '3mf', label: '3MF' },
        { id: 'stl', label: 'STL' },
      ],
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
