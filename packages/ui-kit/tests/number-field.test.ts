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

console.log(`\nnumber field: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
