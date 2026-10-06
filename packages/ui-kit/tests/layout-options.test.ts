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
import { html, miniDocument, type MiniElement } from './support/mini-dom';
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
import { sidebarFooter } from '../src/components/sidebar-footer';
import { drawer } from '../src/components/drawer';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
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
const has = (node: unknown, cls: string) => !!node && (node as MiniElement).classList.contains(cls);
const mini = (node: unknown) => node as MiniElement;

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

  const plain = mini(segmentedControl({ options: VIEWS, value: 'three', fit: 'content', size: 'compact' }));
  const named = mini(segmentedControl({ options: VIEWS, value: 'three', fit: 'content', size: 'compact', ariaLabel: 'View' }));
  check('segmentedControl ariaLabel: no name by default, as before', plain.getAttribute('aria-label') === null);
  check('segmentedControl ariaLabel: names the radio group', named.getAttribute('role') === 'radiogroup' && named.getAttribute('aria-label') === 'View');
  check('segmentedControl ariaLabel: adds the name and nothing else', norm(named).replace(' aria-label="View"', '') === norm(plain));
  const captioned = mini(segmentedControl({ label: 'View', ariaLabel: 'Views', options: VIEWS })).querySelector('.vl-tabs')!;
  check('segmentedControl ariaLabel: a caption names the group instead', captioned.getAttribute('aria-label') === null && !!captioned.getAttribute('aria-labelledby'));
}

option('chip centered', 'vl-chip--centered', (on) => chip({ label: 'Lid', pressed: true, className: 'vl-row', ...(on === undefined ? {} : { centered: on }) }));
option('generatorHeader compact', 'vl-app-header--compact', (on) =>
  generatorHeader({ title: 'Laser Studio', description: 'Pick a design.', ...(on === undefined ? {} : { compact: on }) }),
);

/* ------------------------------------------------------------- the phone layout */

{
  const shellWith = (phone: boolean | undefined, withFooter = true) => {
    const left = { header: [el('p', { text: 'name' })], scroll: [el('p', { text: 'rail' }), el('p', { text: 'more' })], footer: [el('p', { text: 'reset' })] };
    const footer = sidebarFooter({ formats: [{ id: 'svg', label: 'SVG' }], onExport() {}, onSave() {}, onLoad() {}, theme: false });
    return appShell({
      left,
      stage: [],
      right: { scroll: [el('p', { text: 'size' })], ...(withFooter ? { footer: [footer] } : {}) },
      ...(phone === undefined ? {} : { phone }),
    });
  };
  const byDefault = norm(shellWith(undefined).root);
  check('appShell phone: off by default (no vl-app--phone, no phone bar)', !byDefault.includes('vl-app--phone') && !byDefault.includes('vl-app__phone-bar'));
  check('appShell phone: turned off builds what the default builds', norm(shellWith(false).root) === byDefault);

  const narrow = window.matchMedia('(max-width: 900px)') as unknown as { set(m: boolean): void };
  narrow.set(false);
  const shell = shellWith(true);
  const root = mini(shell.root);
  const leftScroll = mini(shell.leftScroll);
  const rightScroll = mini(shell.rightScroll);
  const footer = root.querySelector('.vl-panel--right > .vl-panel__footer')!;
  const bar = footer.querySelector('.vl-app__phone-bar')!;
  const projectFooter = root.querySelector('.vl-sidebar-footer')!;
  const exportBlock = root.querySelector('.vl-export')!;
  check('appShell phone: the class is on the frame', has(root, 'vl-app--phone'));
  check('appShell phone: Settings in a bar at the start of the right footer', footer.firstElementChild === bar && bar.textContent.includes('Settings'));
  check('appShell phone: on a wide screen the footer and its export stay where they were', projectFooter.parentNode === footer && exportBlock.parentNode === projectFooter && projectFooter.firstElementChild === exportBlock);
  check('appShell phone: no inline style', styles(html(root)) === styles(byDefault));

  narrow.set(true);
  check('appShell phone: narrow, the export buttons go beside Settings', bar.firstElementChild === exportBlock && bar.children.length === 2);
  const tail = root.querySelector('.vl-app__phone-tail');
  check('appShell phone: narrow, Save and Load follow the panel’s content, just after its scroll', !!tail && projectFooter.parentNode === tail && rightScroll.nextElementSibling === tail);
  rightScroll.append(el('p', { text: 'added later' }));
  const order = root.querySelector('.vl-panel--right')!.textContent;
  check('appShell phone: narrow, content added to the scroll later still comes before them', order.indexOf('added later') < order.indexOf('Save'));

  const settingsButton = bar.querySelectorAll('button').find((b) => b.textContent.includes('Settings'))!;
  settingsButton.click();
  const sheet = mini(document.body).querySelector('.vl-drawer');
  const sheetBody = sheet?.querySelector('.vl-app__phone-sheet');
  check('appShell phone: Settings opens a drawer titled Settings', !!sheet && sheet.getAttribute('aria-label') === 'Settings');
  check('appShell phone: the drawer holds the left panel’s settings, then its footer', sheetBody?.textContent === 'railmorereset' && leftScroll.childNodes.length === 0);
  check('appShell phone: the sheet takes the focus as it opens', !!sheet && sheet.contains(miniDocument.activeElement));
  const drawers = () => mini(document.body).querySelectorAll('.vl-drawer').map((d) => d.getAttribute('aria-label')).join();
  const picker = drawer({ title: 'Symbols', content: 'A grid' });
  check('appShell phone: a picker opened from the sheet goes over it, and the sheet stays', drawers() === 'Settings,Symbols' && sheetBody?.textContent === 'railmorereset');
  picker.close();
  check('appShell phone: the sheet is still there when the picker closes', drawers() === 'Settings' && leftScroll.childNodes.length === 0);
  settingsButton.click();
  check('appShell phone: a second press opens no second drawer', mini(document.body).querySelectorAll('.vl-drawer').length === 1);
  sheet!.querySelector('.vl-drawer__close')!.click();
  const leftFooter = root.querySelector('.vl-panel--left > .vl-panel__footer')!;
  check('appShell phone: closing puts the settings back, in order', leftScroll.textContent === 'railmore' && leftFooter.textContent === 'reset' && !mini(document.body).querySelector('.vl-drawer'));

  settingsButton.click();
  narrow.set(false);
  check('appShell phone: going wide closes the drawer and puts the settings back', !mini(document.body).querySelector('.vl-drawer') && leftScroll.textContent === 'railmore');
  check('appShell phone: going wide puts the export and the footer back', footer.lastElementChild === projectFooter && projectFooter.firstElementChild === exportBlock && bar.children.length === 1);
  check('appShell phone: going wide leaves the holder empty', !!tail && tail.childNodes.length === 0);

  // A footer with more in it than the sidebar footer: on a wide screen nothing moves, at the
  // start or after a trip to a narrow screen and back.
  const note = el('p', { className: 'vl-hint', text: 'note' });
  const busy = sidebarFooter({ formats: [{ id: 'svg', label: 'SVG' }], onExport() {}, onSave() {}, onLoad() {}, theme: false });
  const withNote = appShell({ phone: true, left: { scroll: [el('p')] }, right: { scroll: [], footer: [busy, note] } });
  const noteFooter = mini(withNote.root).querySelector('.vl-panel--right > .vl-panel__footer')!;
  const roles = () => noteFooter.children.map((c) => c.className.split(' ')[0]).join();
  check('appShell phone, wide at the start: the footer keeps its order, the bar in front', roles() === 'vl-app__phone-bar,vl-sidebar-footer,vl-hint', roles());
  narrow.set(true);
  narrow.set(false);
  check('appShell phone: after narrow and back, the same order', roles() === 'vl-app__phone-bar,vl-sidebar-footer,vl-hint' && mini(busy).firstElementChild!.classList.contains('vl-export'), roles());

  const bare = shellWith(true, false);
  const made = mini(bare.root).querySelector('.vl-panel--right > .vl-panel__footer');
  check('appShell phone: with no right footer, one is made for the bar alone', !!made && made.children.length === 1 && has(made.firstElementChild, 'vl-app__phone-bar'));
  const twoCol = appShell({ right: { scroll: [] }, phone: true });
  check('appShell phone: needs a left panel; without one it does nothing', !has(twoCol.root, 'vl-app--phone') && !mini(twoCol.root).querySelector('.vl-app__phone-bar'));
}

console.log(`\nlayout options: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
