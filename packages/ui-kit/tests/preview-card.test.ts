/*
  previewCard(), zoomControl() and lengthUnits() in a stand-in document (support/mini-dom.ts):
  where each part lands, what the buttons ask for, and how a length reads and is typed.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniStorage, type MiniElement } from './support/mini-dom';
import { el } from '../src/dom';
import { previewCard } from '../src/components/preview-card';
import { zoomControl } from '../src/components/zoom-control';
import { lengthUnits } from '../src/components/length-units';
import { stageStatus } from '../src/components/stage';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};
const mini = (n: unknown) => n as MiniElement;

/* -------------------------------------------------------------------- zoomControl */

{
  const asked: number[] = [];
  let fits = 0;
  const zoom = zoomControl({ onZoom: (f) => asked.push(f), onFit: () => fits++ });
  const root = mini(zoom.root);
  const buttons = root.querySelectorAll('button');
  const value = root.querySelector('.vl-zoom-control__value')!;
  check('zoomControl: a toolbar named Zoom', root.getAttribute('role') === 'toolbar' && root.getAttribute('aria-label') === 'Zoom');
  check(
    'zoomControl: zoom out, the number, zoom in, fit, in that order',
    root.children.map((c) => c.getAttribute('aria-label') ?? c.className).join(' | ') === 'Zoom out | vl-zoom-control__value | Zoom in | Fit it all in view',
  );
  check('zoomControl: starts at 100%', value.textContent === '100%');
  buttons[1]!.click();
  buttons[0]!.click();
  buttons[2]!.click();
  check('zoomControl: in asks for 1.25, out for 0.8, fit for a fit', asked.join() === '1.25,0.8' && fits === 1);
  check('zoomControl: a button does not move the number by itself (the view says where it went)', value.textContent === '100%');
  zoom.set(1.5625);
  check('zoomControl: set() shows the view’s zoom, rounded', value.textContent === '156%');
  check('zoomControl: the number is a live region', value.getAttribute('aria-live') === 'polite');
  check('zoomControl: no inline style', !html(root).includes(' style="'));
  check('zoomControl: value starts where it is told', mini(zoomControl({ onZoom() {}, onFit() {}, value: 0.5 }).root).querySelector('.vl-zoom-control__value')!.textContent === '50%');
}

/* -------------------------------------------------------------------- previewCard */

{
  const views = el('div', { className: 'vl-tabs' });
  const units = el('div', { className: 'vl-tabs' });
  const svg = el('div', { text: 'drawing' });
  const status = stageStatus('48.7 × 14.4 mm');
  const zoom = zoomControl({ onZoom() {}, onFit() {} });
  const legend = el('div', { text: 'Cut · Score' });
  const tools = el('div');
  const card = previewCard({ start: [views], end: [units], view: [svg], status: status.root, zoom: zoom.root, footer: [legend, tools] });
  const root = mini(card.root);
  check('previewCard: bar, view, then the footer strips', root.children.map((c) => c.className).join(' | ') === 'vl-preview-card__bar | vl-preview-card__view | vl-preview-card__foot | vl-preview-card__foot');
  check('previewCard: the view switch at the bar’s start, the unit switch at its end', mini(card.bar).children[0]!.firstElementChild === mini(views) && mini(card.bar).children[1]!.firstElementChild === mini(units));
  check('previewCard: the picture, the status line and the zoom tools are in the view, in that order', mini(card.view).children.map((c) => c.className.split(' ')[0]).join() === ',vl-stage-status,vl-zoom-control');
  check('previewCard: view is the positioned box it returns', root.querySelector('.vl-preview-card__view') === mini(card.view));
  check('previewCard: no inline style', !html(root).includes(' style="'));

  card.statusBelow(true);
  check('previewCard statusBelow: the status line moves under the strips, last in the card', root.lastElementChild === mini(status.root) && root.children.length === 5);
  check('previewCard statusBelow: the view keeps its picture and the zoom tools', mini(card.view).children.map((c) => c.className.split(' ')[0]).join() === ',vl-zoom-control');
  status.set('Off the sheet.', 'warn');
  check('previewCard statusBelow: still the same status line, still set', root.lastElementChild!.textContent === 'Off the sheet.');
  card.statusBelow(true);
  check('previewCard statusBelow: asking twice moves nothing', root.lastElementChild === mini(status.root) && root.children.length === 5);
  card.statusBelow(false);
  check('previewCard statusBelow(false): back in the view, before the zoom tools', mini(card.view).children.map((c) => c.className.split(' ')[0]).join() === ',vl-stage-status,vl-zoom-control' && root.children.length === 4);
  check('previewCard statusBelow(false): the card is as it was built', root.children.map((c) => c.className).join(' | ') === 'vl-preview-card__bar | vl-preview-card__view | vl-preview-card__foot | vl-preview-card__foot');

  const noZoom = previewCard({ view: [el('div')], status: stageStatus('x').root });
  noZoom.statusBelow(true);
  noZoom.statusBelow(false);
  check('previewCard statusBelow(false) with no zoom tools: last in the view', mini(noZoom.view).lastElementChild?.className === 'vl-stage-status');
  const bare = previewCard({});
  bare.statusBelow(true);
  check('previewCard: with nothing given, still a bar and a view, nothing else', mini(bare.root).children.length === 2 && mini(bare.root).querySelectorAll('.vl-preview-card__start, .vl-preview-card__end').length === 2);
}

/* -------------------------------------------------------------------- lengthUnits */

{
  miniStorage.clear();
  const studio = lengthUnits({ storageKey: 'test-unit' });
  check('lengthUnits: millimetres by default', studio.get() === 'mm');
  check('lengthUnits: no trailing zero by default, whole millimetres stay whole', studio.format(120) === '120 mm' && studio.format(119.96) === '120 mm');
  check('lengthUnits: anything else to one decimal', studio.format(48.66) === '48.7 mm' && studio.format(0.04) === '0 mm');
  check('lengthUnits: a size in one unit', studio.formatSize(48.66, 14.4) === '48.7 × 14.4 mm' && studio.formatSize(120, 14.44) === '120 × 14.4 mm');
  const box = lengthUnits({ storageKey: 'test-unit-2', trimZeros: true });
  check('lengthUnits trimZeros: true is the default', box.format(120) === studio.format(120) && box.formatSize(48.66, 14.4) === studio.formatSize(48.66, 14.4));
  const fixed = lengthUnits({ storageKey: 'test-unit-3', trimZeros: false });
  check('lengthUnits trimZeros false: always one decimal', fixed.format(120) === '120.0 mm' && fixed.format(48.66) === '48.7 mm');
  check('lengthUnits trimZeros false: a size the same way', fixed.formatSize(120, 14.4) === '120.0 × 14.4 mm');
  check('lengthUnits: a half rounds away from zero both ways, as toFixed does', studio.format(-1.25) === '-1.3 mm' && fixed.format(-1.25) === '-1.3 mm' && studio.format(1.25) === '1.3 mm');
  check('lengthUnits: 0.35, stored a hair under, reads 0.3 both ways', studio.format(0.35) === '0.3 mm' && fixed.format(0.35) === '0.3 mm');
  {
    // Every 0.005 mm from -50 to 50, so every half on the way: trimming drops a zero and nothing else.
    const moved: number[] = [];
    for (let k = -10000; k <= 10000; k++) {
      const v = k / 200;
      if (studio.format(v) !== fixed.format(v).replace(/\.0 mm$/, ' mm').replace(/^-0 mm$/, '0 mm')) moved.push(v);
    }
    check('lengthUnits trimZeros: only ever drops a zero, never moves a number', moved.length === 0);
  }
  check('lengthUnits parse: in millimetres, a unit written after the number is read as written', studio.parse(2, '2 in') === 50.8 && studio.parse(2, '2"') === 50.8 && studio.parse(2, '2”') === 50.8 && studio.parse(2, '2 inches') === 50.8 && studio.parse(1.2, '1.2 cm') === 12);

  const heard: string[] = [];
  const stop = studio.onChange((u) => heard.push(u));
  const control = studio.unitSwitch({ fit: 'content' });
  studio.set('in');
  check('lengthUnits: set() tells the listeners', heard.join() === 'in');
  check('lengthUnits: inches to two decimals', studio.format(48.768) === '1.92 in' && studio.formatSize(48.768, 14.478) === '1.92 × 0.57 in');
  check('lengthUnits: the switch follows a change made elsewhere', control.getValue() === 'in');
  check('lengthUnits: the choice is remembered under the app’s key', miniStorage.getItem('test-unit') === 'in' && miniStorage.getItem('test-unit-2') === null);
  check('lengthUnits: a second app reads its own key', box.get() === 'mm');
  check('lengthUnits: a new one starts from what was remembered', lengthUnits({ storageKey: 'test-unit' }).get() === 'in');

  check('lengthUnits parse: in inches a typed number is inches', studio.parse(2, '2') === 50.8);
  check('lengthUnits parse: "12 mm" typed in inches is 12 mm', studio.parse(12, '12 mm') === 12);
  check('lengthUnits parse: no text, the number is in the unit showing', studio.parse(1) === 25.4);
  check('lengthUnits parse: in inches, centimetres and millimetres are read as written', studio.parse(1.2, '1.2 cm') === 12 && studio.parse(12, '12MM') === 12 && studio.parse(2, '2 in ') === 50.8);

  const tabs = mini(control).querySelectorAll('.vl-tab');
  tabs[0]!.click();
  check('lengthUnits: picking mm on the switch sets the unit', studio.get() === 'mm' && heard.join() === 'in,mm');
  check('lengthUnits parse: in millimetres a typed number is millimetres', studio.parse(12, '12') === 12);
  check('lengthUnits: the switch takes its options', mini(control).classList.contains('vl-tabs--fit-content'));
  check('lengthUnits: a screen reader calls the switch "Units"', mini(control).getAttribute('aria-label') === 'Units');
  check('lengthUnits: the switch takes another name', mini(studio.unitSwitch({ ariaLabel: 'Ruler units' })).getAttribute('aria-label') === 'Ruler units');
  const captioned = mini(studio.unitSwitch({ label: 'Units' })).querySelector('.vl-tabs')!;
  check('lengthUnits: with a caption the caption names it', captioned.getAttribute('aria-label') === null && !!captioned.getAttribute('aria-labelledby'));
  stop();
  studio.set('in');
  check('lengthUnits: an unsubscribed listener hears nothing more', heard.join() === 'in,mm');

  // Storage that throws (a private window): the choice still works for the visit.
  const g = globalThis as unknown as { localStorage: unknown };
  const kept = g.localStorage;
  g.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const priv = lengthUnits({ storageKey: 'test-unit' });
  priv.set('in');
  check('lengthUnits: refused storage still switches for the visit', priv.get() === 'in' && priv.format(25.4) === '1.00 in');
  g.localStorage = kept;
}

console.log(`\npreview card: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
