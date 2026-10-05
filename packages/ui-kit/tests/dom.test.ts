/*
  el(), without a browser: a stand-in document records what was made.

    pnpm --filter @vostok/ui-kit test
*/
import { el } from '../src/dom';

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  attrs: Record<string, string>;
  kids: unknown[];
  listeners: number;
  style: { cssText: string };
  setAttribute(k: string, v: string): void;
  addEventListener(): void;
  append(...c: unknown[]): void;
}

(globalThis as unknown as { document: unknown }).document = {
  createElement(tag: string): FakeNode {
    return {
      tag,
      className: '',
      textContent: '',
      attrs: {},
      kids: [],
      listeners: 0,
      style: { cssText: '' },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener() { this.listeners++; },
      // As in the DOM: a string handed to append() becomes text.
      append(...c) { for (const x of c) { if (typeof x === 'string') this.textContent += x; else this.kids.push(x); } },
    };
  },
  createTextNode: (text: string) => ({ text }),
};

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};
const made = (n: unknown) => n as unknown as FakeNode;

const long = made(el('div', { className: 'vl-btn', text: 'Hi', attrs: { 'aria-label': 'Row', style: 'color: red' } }, ['a']));
check('props form: class, text, attributes', long.className === 'vl-btn' && long.textContent === 'Hi' && long.attrs['aria-label'] === 'Row');
check('props form: style goes through the CSSOM, not an attribute', long.style.cssText === 'color: red' && !('style' in long.attrs));
check('props form: a string child becomes a text node', JSON.stringify(long.kids) === '[{"text":"a"}]');
check('bare tag: nothing set', (() => { const n = made(el('span')); return n.className === '' && n.textContent === '' && n.kids.length === 0; })());

const short = made(el('span', 'vl-btn', 'New'));
check('short form: class and text', short.tag === 'span' && short.className === 'vl-btn' && short.textContent === 'New');
check('short form: class only', (() => { const n = made(el('span', 'vl-btn')); return n.className === 'vl-btn' && n.textContent === ''; })());
check('short form: text with no class', (() => { const n = made(el('span', undefined, 'x')); return n.className === '' && n.textContent === 'x'; })());
check('short form: null and empty class set nothing', made(el('span', null, 'x')).className === '' && made(el('span', '', 'x')).className === '');
check('short form: null text sets nothing', made(el('span', 'vl-btn', null)).textContent === '');
check('short form: a number is written as text', made(el('span', 'vl-btn', 0)).textContent === '0');

// Calls the types refuse, reached from untyped code: each argument still counts for what it is.
const loose = el as unknown as (tag: string, props?: unknown, children?: unknown) => unknown;
const mixed = made(loose('div', { className: 'vl-btn', attrs: { id: 'x' }, on: { click: () => {} } }, 'text'));
check('props with a text child keep their class, attributes and listeners', mixed.className === 'vl-btn' && mixed.attrs.id === 'x' && mixed.listeners === 1 && mixed.textContent === 'text');
check('a class name with a list of children keeps the children', (() => { const n = made(loose('div', 'vl-btn', ['kid'])); return n.className === 'vl-btn' && JSON.stringify(n.kids) === '[{"text":"kid"}]'; })());
check('no props with a list of children keeps the children', JSON.stringify(made(loose('div', null, ['kid'])).kids) === '[{"text":"kid"}]');

console.log(`\ndom: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
