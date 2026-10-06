/*
  pnpm --filter @vostok/ui-kit test

  `@vostok/ui-kit/symbol-rules` loads in plain node, by the package's own name, with no DOM and
  none of the rest of the kit: what code outside a browser needs to ask which characters are
  symbols (the letters on a row of keys, a node test of the text a model carries). rules.ts is
  TypeScript that node strips by itself, and it imports nothing, so nothing further has to
  resolve.
*/
import { readFileSync } from 'node:fs';

const rules = await import('@vostok/ui-kit/symbol-rules');

let failed = 0;
let passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};

ok(typeof document === 'undefined' && typeof window === 'undefined', 'this process has no DOM, so a module that needed one could not have loaded');

const source = readFileSync(new URL('../src/symbols/rules.ts', import.meta.url), 'utf8');
ok(!/^\s*(import|export\s+[^;]*\sfrom)\s/m.test(source), 'rules.ts imports nothing, so the subpath carries no other kit module');

// Everything the kit's front door hands out from the rules, the subpath hands out too.
const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const block = index.match(/export\s*\{([^}]*)\}\s*from\s*'\.\/symbols\/rules'/);
const names = (block?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type '));
ok(names.length >= 8, `the front door's rules were found (${names.join(', ')})`);
for (const n of names) ok(n in rules, `${n} through @vostok/ui-kit/symbol-rules`);

const sym = String.fromCodePoint(0xf0001);
ok(rules.isSymbolChar(sym), 'a private-use code point is a symbol');
ok(!rules.isSymbolChar('A') && !rules.isSymbolChar('\u{1F600}'), 'a letter and an emoji are not');
ok(rules.hasSymbol(`A${sym}B`) && !rules.hasSymbol('AB'), 'hasSymbol');
ok(rules.codePointCount(`A${sym}B`) === 3, 'a symbol counts once');
ok(rules.insertText('AB', 1, 1, `${sym}C`, 3)?.value === `A${sym}B`, 'an insert is held to the limit in code points');

console.log(failed ? `symbol rules subpath: ${failed} FAILED, ${passed} passed` : `symbol rules subpath: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
