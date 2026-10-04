/*
  pnpm --filter @vostok/fonts test

  What a face covers is measured from its file, never copied from a description of the family
  (src/coverage.ts). What this guards:
   - registry.ts says what each file on disk holds: `subsets` measured again from every cmap,
     and `bytes`. A registry that over-claims keeps the missing-glyph mark quiet while the model
     comes out with "?" in it;
   - the common CJK sets decode to their published sizes. A runtime that decoded them
     differently would move every Korean, Japanese and Chinese answer at once;
   - what a string needs, and each face's answer, for every alphabet the package carries:
     Hangul, kana, kanji and hanzi (either set will do for a character both hold), Cyrillic,
     Greek, and what no face is picked for (Armenian, Georgian, a rare syllable, loose jamo);
   - the alphabet names a picker filters by, which never include Armenian or Georgian;
   - an imported font answers from its own cmap.
*/

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, getRequiredSubsets, isFontSupported, fontScripts, parseFont, UNCOVERED } from '../src/index';
import { coverageOf, coverageTests } from '../src/coverage';
import { importFontBuffer, toPickerFont } from '../src/import';

// cwd, not `import.meta.url`: esbuild bundles this into node_modules/.cache.
const PKG = process.cwd();
const DIR = join(PKG, 'src', 'fonts');
let checks = 0;
let failed = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(join(DIR, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const face = (id: string) => {
  const f = FONTS.find((x) => x.id === id);
  if (!f) throw new Error(`${id} is not in the registry`);
  return f;
};

// The sets
const tests = coverageTests();
ok(tests.korean.length === 2350 + 51, `KS X 1001 Hangul and the modern jamo: ${tests.korean.length}`);
ok(tests.kana.length === 170, `JIS X 0208 kana and the long-vowel mark: ${tests.kana.length}`);
ok(tests.japanese.length === 170 + 2965, `kana and JIS level 1 kanji: ${tests.japanese.length}`);
ok(tests['chinese-simplified'].length === 3755, `GB2312 level 1 hanzi: ${tests['chinese-simplified'].length}`);
ok(tests.cyrillic.length === 66 && tests.greek.length === 69, 'the Russian and monotonic Greek alphabets');
ok(tests.armenian.length === 76 && tests.georgian.length === 33, 'the Armenian and Georgian alphabets');

// The registry agrees with the files beside it
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.ttf') && f !== 'icon-fallback.ttf').map((f) => f.replace(/\.ttf$/, ''));
ok(onDisk.length === FONTS.length && onDisk.every((id) => FONTS.some((f) => f.id === id)), `one registry entry per file (${onDisk.length} files, ${FONTS.length} entries)`);
const wrong: string[] = [];
for (const f of FONTS) {
  const buf = bytes(`${f.id}.ttf`);
  const map: Record<number, number> = parseFont(buf).tables.cmap.glyphIndexMap;
  const measured = coverageOf((cp) => !!map[cp]);
  if (!same(measured, f.subsets)) wrong.push(`${f.id} says ${f.subsets.join(',')} but holds ${measured.join(',')}`);
  if (f.bytes !== buf.byteLength) wrong.push(`${f.id} says ${f.bytes} bytes but is ${buf.byteLength}`);
}
ok(!wrong.length, `registry.ts matches the files (run fetch-fonts): ${wrong.slice(0, 5).join('; ')}`);

// What a string needs
const needs = (text: string, want: string[]) => {
  const got = getRequiredSubsets(text);
  ok(same(got, want), `${text} needs ${want.join(' + ') || 'nothing'} (got ${got.join(' + ') || 'nothing'})`);
};
needs('Hello, Café!', []);
needs('Привет Ёё', ['cyrillic']);
needs('Қазақ', ['cyrillic-ext', 'cyrillic']);
needs('Żółć', ['latin-ext']);
needs('Γειά', ['greek']);
needs('Բարեւ', ['armenian']);
needs('გამარჯობა', ['georgian']);
needs('안녕하세요 한글 ㅋㅋ', ['korean']);
needs('こんにちは コーヒー', ['kana']);
needs('日本 月 一', ['japanese|chinese-simplified']);
needs('駅', ['japanese']);
needs('你们', ['chinese-simplified']);
needs('똠', [UNCOVERED]);
needs('가', [UNCOVERED]);
needs('國', [UNCOVERED]);

// Each face's answer
const answers = (id: string, yes: string[], no: string[]) => {
  const f = face(id);
  for (const t of yes) ok(isFontSupported(f, t), `${id} sets ${t}`);
  for (const t of no) ok(!isFontSupported(f, t), `${id} is flagged for ${t}`);
};
answers('anton', ['Hello'], ['Привет', '안녕']);
answers('black-han-sans', ['안녕하세요 한글', 'ㅋㅋ'], ['こんにちは', 'Привет', '똠']);
answers('gasoek-one', ['안녕하세요 한글'], ['日本']);
answers('gothic-a1', ['안녕하세요 한글', 'Привет Ёё', 'こんにちは', 'Γειά'], ['日本']);
answers('m-plus-1p', ['こんにちは 日本 月 一', 'Привет Ёё', 'Γειά', '駅'], ['你好', '안녕']);
answers('dela-gothic-one-jp', ['こんにちは 日本 月 一', 'Привет Ёё', 'Γειά'], ['你们']);
answers('dela-gothic-one', ['Hello'], ['こんにちは', 'Привет']);
answers('cherry-bomb-one', ['こんにちは コーヒー'], ['日本']);
answers('zcool-kuaile', ['你好 中国', '日本'], ['こんにちは', '駅']);
answers('noto-sans-sc', ['你好 中国', 'Привет'], ['こんにちは']);
const setting = (text: string) => FONTS.filter((f) => isFontSupported(f, text)).map((f) => f.id).join(', ');
ok(setting('Բարեւ') === 'handjet', `Armenian is flagged on every face but the one that has it (${setting('Բարեւ')})`);
ok(setting('გამარჯობა') === '', `Georgian is flagged on every face (${setting('გამარჯობა')})`);
answers('rubik-one', ['Привет Ёё'], ['Γειά']);
answers('comic-relief', ['Привет Ёё', 'Γειά'], ['안녕']);

// The alphabets a picker filters by, in their fixed order
const scripts = (id: string, want: string[]) => {
  const got = fontScripts(face(id));
  ok(same(got, want), `${id} writes ${want.join(', ')} (got ${got.join(', ')})`);
};
scripts('anton', ['Latin']);
scripts('gothic-a1', ['Latin', 'Cyrillic', 'Greek', 'Korean', 'Japanese']);
scripts('cherry-bomb-one', ['Latin', 'Japanese']);
scripts('noto-sans-sc', ['Latin', 'Cyrillic', 'Chinese']);
scripts('handjet', ['Latin', 'Cyrillic', 'Greek']);
ok(FONTS.every((f) => !fontScripts(f).some((s) => s === 'Armenian' || s === 'Georgian')), 'no face is offered for Armenian or Georgian');
ok(same(toPickerFont(face('gasoek-one')).scripts, ['Latin', 'Korean']), 'toPickerFont carries the alphabets to the kit');

// An imported font answers from its own cmap: this cut has no Latin-1 letters, which a bundled
// face is never asked about.
const imported = await importFontBuffer('Korean.ttf', bytes('black-han-sans.ttf'));
ok(same(imported.subsets, ['korean', 'latin']), `an imported font is measured like a bundled one (${imported.subsets.join(',')})`);
ok(isFontSupported(imported, '안녕 ABC') && !isFontSupported(imported, 'Привет'), 'and flagged by what it holds');
ok(!isFontSupported(imported, 'Ø'), 'letter by letter, past what the coverage names test');
ok(isFontSupported(imported, '안녕!? 123\n'), 'punctuation, digits it has and spaces pass');

console.log(`\nfont coverage: ${checks - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
