/*
  textField() under syncControls(), without a browser: a stand-in document with a focus.

    pnpm --filter @vostok/ui-kit test
*/
import { textField } from '../src/components/elements';
import { syncControls } from '../src/components/controls';

interface FakeNode {
  value: string;
}

const doc = {
  activeElement: null as unknown,
  createElement: (tag: string) => ({
    tag,
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    id: '',
    style: { cssText: '' },
    attrs: {} as Record<string, string>,
    kids: [] as unknown[],
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener() {},
    append(...c: unknown[]) { this.kids.push(...c); },
  }),
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

const field = textField({ label: 'Text', value: 'Old' });
const input = field.field as unknown as FakeNode;

field.setValue('Saved');
check('setValue writes the field when nobody is typing in it', input.value === 'Saved');

// Someone clicks in and starts typing.
doc.activeElement = input;
input.value = 'Half-typ';
field.setValue('Saved');
check('a plain setValue (a rebuild echoing the state) leaves the typed text alone', input.value === 'Half-typ');

// A project loads while they are still in the field.
const state = { text: 'Loaded', size: 3 };
const changed = syncControls(state, { text: field });
check('a load replaces the typed text in the field', input.value === 'Loaded');
check('and the state keeps the loaded value rather than reading the typed text back', state.text === 'Loaded' && changed.length === 0);

input.value = 'typing again';
field.setValue('Echo');
check('after the load, the typist guard holds again', input.value === 'typing again');

doc.activeElement = null;
console.log(`\ntext field: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
