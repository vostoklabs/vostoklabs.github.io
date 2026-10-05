/*
  The state store, without a browser.

    pnpm --filter @vostok/ui-kit test
*/
import { createStore } from '../src/store';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const s = createStore({ width: 40, label: 'A' });
check('get() returns the initial state', s.get().width === 40 && s.get().label === 'A');

const before = s.get();
s.set({ width: 50 });
check('set() with an object merges the patch', s.get().width === 50 && s.get().label === 'A');
check('set() makes a new state object, never mutates the old one', before !== s.get() && before.width === 40);

s.set((st) => ({ width: st.width + 5 }));
check('set() with a function patches from the current state', s.get().width === 55);

const seen: number[] = [];
const off = s.subscribe((st) => seen.push(st.width));
s.set({ width: 60 });
check('subscribe() hears every set, with the new state', seen.length === 1 && seen[0] === 60);

off();
s.set({ width: 70 });
check('the returned function unsubscribes', seen.length === 1);

console.log(`\nstore: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
