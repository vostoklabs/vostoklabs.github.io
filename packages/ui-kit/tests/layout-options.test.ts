/*
  The layout options on the kit's blocks, in a stand-in document (support/mini-dom.ts).

  Every option is off by default, and off means the block builds exactly what it built before the
  option existed: for each one, the default and the option turned off explicitly serialize the
  same, and turned on the option adds its class and nothing else. None of them writes an inline
  style (a MakerLab host's CSP refuses style attributes): turned on, a block carries exactly the
  styles it carried off.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, type MiniElement } from './support/mini-dom';
import { el } from '../src/dom';
import { ICONS } from '../src/icons';
import { sourceCards } from '../src/components/sources';
import { stagePanel, stageStatus } from '../src/components/stage';
import { segmentedControl, toggleSwitch } from '../src/components/controls';
import { appShell } from '../src/components/app-shell';
import { settingsRail } from '../src/components/settings-rail';
import { studioView } from '../src/components/editor-shell';
import { chip } from '../src/components/elements';
import { generatorHeader } from '../src/components/generator-chrome';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

/** Markup with the counter ids renumbered from the start, so two builds compare. */
function norm(node: unknown): string {
  const seen = new Map<string, string>();
  return html(node as MiniElement).replace(/\b(vl-[a-z]+)-(\d+)\b/g, (m, prefix: string) => {
    if (!seen.has(m)) seen.set(m, `${prefix}-#${seen.size}`);
    return seen.get(m)!;
  });
}
/** The same markup with one class taken out wherever it appears. */
const without = (markup: string, cls: string) => markup.replace(new RegExp(` ${cls}(?=[ "])`, 'g'), '');
const styles = (markup: string) => (markup.match(/ style="/g) ?? []).length;
const has = (node: unknown, cls: string) => (node as MiniElement).classList.contains(cls);

/** Off by default; off when turned off; on, its class and nothing more. */
function option(name: string, cls: string, build: (on: boolean | undefined) => unknown) {
  const byDefault = norm(build(undefined));
  const off = norm(build(false));
  const on = norm(build(true));
  check(`${name}: off by default (no ${cls})`, !byDefault.includes(cls));
  check(`${name}: turned off builds what the default builds`, off === byDefault);
  check(`${name}: on adds ${cls}`, on.includes(cls));
  check(`${name}: on adds nothing but the class`, without(on, cls) === byDefault);
  check(`${name}: on writes no inline style`, styles(on) === styles(byDefault));
}

/* ----------------------- source tiles, a hidden panel title, the status at the top, compact switches */

const SOURCES = [
  { value: 'tuck', label: 'Tuck carton', icon: ICONS.box },
  { value: 'mailer', label: 'Mailer' },
];
option('sourceCards layout', 'vl-source-grid--tiles', (on) =>
  sourceCards({ options: SOURCES, value: 'tuck', onChange() {}, ...(on === undefined ? {} : { layout: on ? 'tiles' : 'row' }) }).root,
);
{
  const tiles = sourceCards({ options: SOURCES, layout: 'tiles', onChange() {} });
  let picked = '';
  const cards = (tiles.root as unknown as MiniElement).querySelectorAll('.vl-source-card');
  const second = sourceCards({ options: SOURCES, layout: 'tiles', onChange: (v) => (picked = v) });
  (second.root as unknown as MiniElement).querySelectorAll('.vl-source-card')[1]!.click();
  check('sourceCards tiles: one card per source, each its own label', cards.length === 2 && cards[1]!.textContent === 'Mailer');
  check('sourceCards tiles: a click still picks', picked === 'mailer' && has((second.root as unknown as MiniElement).querySelectorAll('.vl-source-card')[1], 'is-active'));
}

option('stagePanel titleHidden', 'vl-stage-panel--title-hidden', (on) =>
  stagePanel({ title: 'Fold', body: [el('div', { text: 'scrubber' })], hint: 'Small print.', open: true, ...(on === undefined ? {} : { titleHidden: on }) }).root,
);
{
  const bare = stagePanel({ title: 'Fold', titleHidden: true, open: true });
  const title = (bare.root as unknown as MiniElement).querySelector('.vl-stage-panel__title');
  check('stagePanel titleHidden: the title stays in the panel for screen readers', title?.textContent === 'Fold');
  bare.setOpen(false);
  check('stagePanel titleHidden: setOpen still hides it', bare.root.hidden && has(bare.root, 'vl-stage-panel--title-hidden'));
}

option('stageStatus position', 'vl-stage-status--top', (on) =>
  stageStatus('Building…', on === undefined ? undefined : { position: on ? 'top' : 'bottom' }).root,
);
{
  const top = stageStatus('Building…', { position: 'top' });
  top.set('Letters are thin.', 'warn');
  check('stageStatus top: a warning keeps the position', top.root.className === 'vl-stage-status vl-stage-status--top vl-stage-status--warn');
  top.set('Ready');
  check('stageStatus top: an idle message keeps the position', top.root.className === 'vl-stage-status vl-stage-status--top');
  top.setDiagnostics([{ level: 'error', message: 'Off the sheet.' }], 'ok');
  check('stageStatus top: diagnostics keep the position', top.root.className === 'vl-stage-status vl-stage-status--top vl-stage-status--error' && top.root.textContent === 'Off the sheet.');
  const bottom = stageStatus('x');
  bottom.set('y', 'busy');
  check('stageStatus default: set() writes the classes it always wrote', bottom.root.className === 'vl-stage-status vl-stage-status--busy');
}

option('toggleSwitch compact', 'vl-switch-row--compact', (on) =>
  toggleSwitch({ label: 'Panel names', checked: true, help: 'A tip.', ...(on === undefined ? {} : { compact: on }) }),
);
{
  let seen: boolean | null = null;
  const sw = toggleSwitch({ label: 'Sheet outline', compact: true, onChange: (v) => (seen = v) });
  const input = (sw as unknown as MiniElement).querySelector('input')!;
  input.checked = true;
  input.dispatchEvent({ type: 'change' });
  sw.setValue(false);
  check('toggleSwitch compact: still a switch (change, setValue, getValue)', seen === true && sw.getValue() === false);
}

/* ------------------------- a rail panel's chrome, compact tabs, a centred chip, a compact header */

const leftPanel = (compact: boolean | undefined) => ({
  header: [el('p', { text: 'header' })],
  scroll: [el('p', { text: 'rail' })],
  footer: [el('p', { text: 'reset' })],
  credit: el('div', { className: 'vl-panel-credit' }),
  ...(compact === undefined ? {} : { compact }),
});
option('appShell left PanelOptions.compact', 'vl-panel--compact', (on) =>
  appShell({ topbar: el('header', { className: 'vl-topbar' }), left: leftPanel(on), stage: [], right: { scroll: [] } }).root,
);
option('appShell right PanelOptions.compact', 'vl-panel--compact', (on) =>
  appShell({ right: { scroll: [el('p', { text: 'r' })], ...(on === undefined ? {} : { compact: on }) } }).root,
);
option('studioView PanelOptions.compact', 'vl-panel--compact', (on) => studioView({ left: leftPanel(on), right: { scroll: [] } }).root);
{
  const shell = appShell({ left: leftPanel(true), right: { scroll: [] } });
  const left = (shell.root as unknown as MiniElement).querySelector('.vl-panel--left')!;
  check(
    'PanelOptions.compact: only the panel that asked is compact',
    has(left, 'vl-panel--compact') && !has((shell.root as unknown as MiniElement).querySelector('.vl-panel--right'), 'vl-panel--compact'),
  );
  check(
    'PanelOptions.compact: header, scroll, credit and footer keep their order in the DOM',
    left.children.map((c) => c.className).join(' | ') === 'vl-panel__header | vl-panel__scroll | vl-panel-credit | vl-panel__footer',
  );
}

const RAIL = () => [
  { id: 'shape', label: 'Shape', icon: ICONS.box, body: [el('p', { text: 'a' })] },
  { id: 'text', label: 'Text', icon: ICONS.text, divider: true, body: [el('p', { text: 'b' })] },
];
option('settingsRail flush', 'vl-settings-rail--flush', (on) => settingsRail({ items: RAIL(), ...(on === undefined ? {} : { flush: on }) }));
{
  const opened: string[] = [];
  const rail = settingsRail({ items: RAIL(), flush: true, onChange: (id) => opened.push(id) });
  rail.open('text');
  check('settingsRail flush: still opens a category', rail.getValue() === 'text' && opened[opened.length - 1] === 'text');
}

const VIEWS = [
  { value: 'design', label: '2D Design' },
  { value: 'three', label: '3D Preview' },
  { value: 'file', label: 'Export Preview' },
];
option('segmentedControl fit', 'vl-tabs--fit-content', (on) =>
  segmentedControl({ options: VIEWS, value: 'three', ...(on === undefined ? {} : { fit: on ? 'content' : 'fill' }) }),
);
option('segmentedControl size', 'vl-tabs--compact', (on) =>
  segmentedControl({ options: VIEWS, value: 'three', ...(on ? { size: 'compact' as const } : {}) }),
);
{
  const both = segmentedControl({ options: VIEWS, value: 'design', fit: 'content', size: 'compact' });
  check('segmentedControl: fit and size together', has(both, 'vl-tabs--fit-content') && has(both, 'vl-tabs--compact'));
  const labelled = segmentedControl({ label: 'View', options: VIEWS, fit: 'content', size: 'compact' }) as unknown as MiniElement;
  const tabs = labelled.querySelector('.vl-tabs')!;
  check('segmentedControl: with a caption the classes go on the tabs, not the wrapper', has(tabs, 'vl-tabs--compact') && !has(labelled, 'vl-tabs--compact'));
  const cards = segmentedControl({ variant: 'cards', options: VIEWS, size: 'compact' });
  check('segmentedControl: size is for tabs; cards keep their own size', !has(cards, 'vl-tabs--compact'));
  let picked = '';
  const live = segmentedControl({ options: VIEWS, value: 'design', size: 'compact', fit: 'content', onChange: (v) => (picked = v) }) as unknown as MiniElement;
  live.querySelectorAll('.vl-tab')[2]!.click();
  check('segmentedControl compact: still picks', picked === 'file');
}

option('chip centered', 'vl-chip--centered', (on) => chip({ label: 'Lid', pressed: true, className: 'vl-row', ...(on === undefined ? {} : { centered: on }) }));
option('generatorHeader compact', 'vl-app-header--compact', (on) =>
  generatorHeader({ title: 'Laser Studio', description: 'Pick a design.', ...(on === undefined ? {} : { compact: on }) }),
);

console.log(`\nlayout options: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
