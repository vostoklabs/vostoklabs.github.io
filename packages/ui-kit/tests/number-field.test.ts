/*
  numberField() under syncControls(), without a browser: a stand-in document with a focus and
  events. Leaving the field fires `change` whenever it was typed in since it took the focus, the
  way a browser does even when a script has since rewritten the text.

    pnpm --filter @vostok/ui-kit test
*/
import { numberField } from '../src/components/elements';
import { syncControls } from '../src/components/controls';

interface FakeInput {
  value: string;
  disabled: boolean;
  listeners: Record<string, ((e?: unknown) => void)[]>;
}

const doc = {
  activeElement: null as unknown,
  createElement: (tag: string) => {
    const classes = new Set<string>();
    return {
      tag,
      className: '',
      textContent: '',
      value: '',
      disabled: false,
      id: '',
      style: { cssText: '' },
      attrs: {} as Record<string, string>,
      kids: [] as unknown[],
      listeners: {} as Record<string, ((e?: unknown) => void)[]>,
      classList: {
        toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c: string) => classes.has(c),
      },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      getAttribute(k: string) { return this.attrs[k] ?? null; },
      addEventListener(type: string, fn: (e?: unknown) => void) { (this.listeners[type] ??= []).push(fn); },
      append(...c: unknown[]) { this.kids.push(...c); },
      blur() { if (doc.activeElement === this) leave(this as unknown as FakeInput); },
    };
  },
  createTextNode: (text: string) => ({ text }),
};
(globalThis as unknown as { document: unknown }).document = doc;

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const fire = (n: FakeInput, type: string, e?: unknown) => { for (const fn of n.listeners[type] ?? []) fn(e); };
/** Click into the field and type: what the browser does, minus the keys. */
const type = (n: FakeInput, text: string) => {
  doc.activeElement = n;
  n.value = text;
  fire(n, 'input');
};
/** Click away. `change` fires because the field was typed in since it took the focus. */
function leave(n: FakeInput) {
  doc.activeElement = null;
  fire(n, 'change');
}
const pressEnter = (n: FakeInput) => fire(n, 'keydown', { key: 'Enter', preventDefault() {} });

const typed: number[] = [];
const width = numberField({ label: 'Width', value: 60, min: 20, max: 200, unit: 'mm', onInput: (v) => typed.push(v) });
const input = width.field as unknown as FakeInput;

/* ---- what every caller already had ---- */

check('getValue reads the starting value', width.getValue() === 60 && width.value === 60);
width.setValue(70);
check('setValue writes the field when nobody is typing in it', input.value === '70' && width.getValue() === 70 && typed.length === 0);
width.setValue(500);
check('setValue clamps to the range', input.value === '200' && width.getValue() === 200);
width.setValue(80, true);
check('setValue with notify reports the clamped value', typed.join() === '80');
typed.length = 0;

type(input, '45');
leave(input);
check('leaving the field after typing commits it', width.getValue() === 45 && typed.join() === '45' && input.value === '45');
typed.length = 0;

type(input, '900');
leave(input);
check('a typed number is clamped on commit', width.getValue() === 200 && typed.join() === '200' && input.value === '200');
typed.length = 0;

type(input, '');
leave(input);
check('rubbish is put back, not stored', width.getValue() === 200 && typed.length === 0 && input.value === '200');

type(input, '1');
width.setValue(70);
check('a plain setValue (a rebuild echoing the state) leaves the typed number alone', input.value === '1' && width.getValue() === 200);
leave(input);
check('and leaving then commits what was typed', width.getValue() === 20 && typed.join() === '20');
typed.length = 0;

/* ---- a load ---- */

type(input, '12');
const loaded = { width: 120 };
const changed = syncControls(loaded, { width });
check('a load replaces the typed number in the field', input.value === '120');
check('and the field and the state keep the loaded value', width.getValue() === 120 && loaded.width === 120 && changed.length === 0);
leave(input);
check('leaving the field then commits nothing, so the load stands', width.getValue() === 120 && typed.length === 0);

type(input, '33');
width.setValue(90);
check('after the load, the typist guard holds again', input.value === '33');
leave(input);
check('and leaving the field commits what was typed', width.getValue() === 33 && typed.join() === '33');
typed.length = 0;

type(input, '7');
const tooBig = { width: 999 };
const fitted = syncControls(tooBig, { width });
check('a loaded value out of range is clamped in the field and in the state', input.value === '200' && tooBig.width === 200 && fitted.join() === 'width');
leave(input);
check('and leaving the field leaves it there', width.getValue() === 200 && typed.length === 0);

/* ---- Enter ---- */

type(input, '150');
pressEnter(input);
check('Enter commits what was typed, once', width.getValue() === 150 && typed.join() === '150' && doc.activeElement === null);
typed.length = 0;

/* ---- disabling ---- */

width.setDisabled(true);
check('setDisabled greys the field and stops it taking input', input.disabled && width.classList.contains('vl-control--disabled') && width.getAttribute('aria-disabled') === 'true');
width.setDisabled(false);
check('and gives it back', !input.disabled && !width.classList.contains('vl-control--disabled') && width.getAttribute('aria-disabled') === 'false');

/* ---- live: every keystroke that reads as a number ---- */

const said: number[] = [];
const grams = numberField({ label: 'Filament used', value: 0, min: 0, max: 5000, unit: 'g', live: true, emptyValue: 0, placeholder: '0', onInput: (v) => said.push(v) });
const gramsBox = grams.field as unknown as FakeInput;

check('emptyValue: the starting value shows as an empty box', gramsBox.value === '' && grams.getValue() === 0);
check('the placeholder is on the box', (grams.field as unknown as { attrs: Record<string, string> }).attrs.placeholder === '0');
type(gramsBox, '1');
type(gramsBox, '12');
check('live: each keystroke that reads as a number reports, before any commit', said.join() === '1,12' && grams.getValue() === 12);
type(gramsBox, '12.');
check('a keystroke that changes nothing reports nothing', said.join() === '1,12');
leave(gramsBox);
check('and the commit after it reports nothing more', said.join() === '1,12' && gramsBox.value === '12');
said.length = 0;

type(gramsBox, '9000');
check('live reports the clamped value and leaves the box as typed', said.join() === '5000' && gramsBox.value === '9000');
leave(gramsBox);
check('the commit then writes the clamped value into the box', gramsBox.value === '5000' && said.join() === '5000');
said.length = 0;

type(gramsBox, '');
check('emptying a live box reports the empty value', said.join() === '0' && grams.getValue() === 0);
leave(gramsBox);
check('and it stays empty after the commit, not "0"', gramsBox.value === '' && said.join() === '0');
said.length = 0;

grams.setValue(250);
check('setValue shows a number that is not the empty value', gramsBox.value === '250');
grams.setValue(0);
check('and shows the empty value as an empty box', gramsBox.value === '' && grams.getValue() === 0);

const rate = numberField({ label: 'Your rate', value: 20, min: 0, emptyValue: 0, onInput: (v) => said.push(v) });
const rateBox = rate.field as unknown as FakeInput;
type(rateBox, '');
check('without live, emptying reports nothing until the commit', said.length === 0);
leave(rateBox);
check('and the commit takes the empty value', said.join() === '0' && rate.getValue() === 0 && rateBox.value === '');

/* ---- setUnit ---- */

type Kid = { className: string; textContent: string; kids: Kid[] };
const unitOf = (field: unknown) =>
  ((field as Kid).kids.find((k) => k.className === 'vl-number-row')?.kids ?? []).filter((k) => k.className === 'vl-number-unit');
const price = numberField({ label: 'Price per roll', value: 25, unit: '$' });
price.setUnit('Kč');
check('setUnit changes the unit in place', unitOf(price).length === 1 && unitOf(price)[0]!.textContent === 'Kč');
rate.setUnit('€/h');
check('setUnit gives a field built without a unit one', unitOf(rate).length === 1 && unitOf(rate)[0]!.textContent === '€/h');
check('a field with a unit is built as before', unitOf(width).length === 1 && unitOf(width)[0]!.textContent === 'mm');

const rowOf = (field: unknown) => (field as Kid).kids.find((k) => k.className.startsWith('vl-number-row'))!;
check('alignUnit marks the row', rowOf(numberField({ label: 'Power', value: 0, unit: 'W', alignUnit: true })).className === 'vl-number-row vl-number-row--align-unit');
check('and without it the row is as before', rowOf(width).className === 'vl-number-row');

console.log(`\nnumber field: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
