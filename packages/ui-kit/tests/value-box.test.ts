/*
  The number box of sliderRow() and stepperRow() under syncControls(), without a browser: a
  stand-in document with a focus and events.

    pnpm --filter @vostok/ui-kit test
*/
import { sliderRow, stepperRow, syncControls } from '../src/components/controls';

interface FakeNode {
  className: string;
  value: string;
  kids: unknown[];
  listeners: Record<string, (() => void)[]>;
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
    style: { cssText: '', setProperty() {} },
    dataset: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    kids: [] as unknown[],
    listeners: {} as Record<string, (() => void)[]>,
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); },
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

/** The row's number box, wherever the row put it. */
const boxOf = (row: unknown): FakeNode => {
  const find = (n: FakeNode): FakeNode | null => {
    if (n.className === 'vl-val') return n;
    for (const kid of n.kids ?? []) {
      const hit = find(kid as FakeNode);
      if (hit) return hit;
    }
    return null;
  };
  return find(row as FakeNode)!;
};
const fire = (n: FakeNode, type: string) => { for (const fn of n.listeners[type] ?? []) fn(); };
/** Click into the box and type: what the browser does, minus the keys. */
const type = (box: FakeNode, text: string) => {
  doc.activeElement = box;
  box.value = text;
  fire(box, 'input');
};
/** Click away. The browser fires `change` because the box was typed in since it took the focus. */
const leave = (box: FakeNode) => {
  doc.activeElement = null;
  fire(box, 'change');
};

/* ---- sliderRow ---- */

const typedWidth: number[] = [];
const width = sliderRow({ label: 'Width', min: 20, max: 120, step: 1, value: 60, unit: 'mm', onInput: (v) => typedWidth.push(v) });
const widthBox = boxOf(width);

width.setValue(70);
check('slider: setValue writes the box when nobody is typing in it', widthBox.value === '70 mm');

type(widthBox, '45');
width.setValue(75);
check('slider: a plain setValue (a rebuild echoing the state) leaves the typed number alone', widthBox.value === '45' && width.getValue() === 75);

// A project loads while they are still in the box.
const loaded = { width: 80 };
const changed = syncControls(loaded, { width });
check('slider: a load replaces the typed number in the box', widthBox.value === '80 mm');
check('slider: and the row and the state keep the loaded value', width.getValue() === 80 && loaded.width === 80 && changed.length === 0);

leave(widthBox);
check('slider: leaving the box then commits nothing, so the load stands', width.getValue() === 80 && typedWidth.length === 0);

type(widthBox, '33');
width.setValue(90);
check('slider: after the load, the typist guard holds again', widthBox.value === '33');
leave(widthBox);
check('slider: and leaving the box commits what was typed', width.getValue() === 33 && typedWidth.join() === '33' && widthBox.value === '33 mm');

// A format that does not read back as its value: "110%" is 110 to a row with no `parse`.
const typedSpacing: number[] = [];
const spacing = sliderRow({
  label: 'Line spacing', min: 0.5, max: 1.8, step: 0.05, value: 1,
  format: (v) => `${Math.round(v * 100)}%`,
  onInput: (v) => typedSpacing.push(v),
});
const spacingBox = boxOf(spacing);
type(spacingBox, '1.2');
syncControls({ spacing: 1.1 }, { spacing });
leave(spacingBox);
check('slider: the box\'s own text is never read back over a load ("110%" stays 1.1)', spacing.getValue() === 1.1 && typedSpacing.length === 0);

/* ---- stepperRow ---- */

const typedLayers: number[] = [];
const layers = stepperRow({ label: 'Layers', min: 1, max: 8, value: 2, onInput: (v) => typedLayers.push(v) });
const layersBox = boxOf(layers);

type(layersBox, '7');
layers.setValue(3);
check('stepper: a plain setValue leaves the typed number alone', layersBox.value === '7' && layers.getValue() === 3);

const sheet = { layers: 5 };
syncControls(sheet, { layers });
check('stepper: a load replaces the typed number in the box', layersBox.value === '5' && layers.getValue() === 5 && sheet.layers === 5);
leave(layersBox);
check('stepper: leaving the box then commits nothing, so the load stands', layers.getValue() === 5 && typedLayers.length === 0);

type(layersBox, '6');
leave(layersBox);
check('stepper: leaving the box after typing commits it', layers.getValue() === 6 && typedLayers.join() === '6');

// A signed format with a typographic minus, which the box reads back as a positive number.
const typedFit: number[] = [];
const fit = stepperRow({
  label: 'Fit', min: -5, max: 5, step: 0.5, value: 0,
  format: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%',
  onInput: (v) => typedFit.push(v),
});
const fitBox = boxOf(fit);
type(fitBox, '2');
syncControls({ fit: -1.5 }, { fit });
leave(fitBox);
check('stepper: the box\'s own text is never read back over a load ("−1.5%" stays -1.5)', fit.getValue() === -1.5 && typedFit.length === 0);

console.log(`\nvalue box: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
