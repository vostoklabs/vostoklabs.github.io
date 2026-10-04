/*
  Text in an alphabet the chosen face cannot draw (src/image/letter.ts).

  Standard is the clicker's default and writes Latin only, so a Russian, Greek, Korean, Japanese
  or Chinese name typed into a new clicker used to print a "?" per letter. Typing such a text now
  moves it to the plainest face that writes all of it, and the font cards lead with those faces.
  What has to hold:
   - Standard is first for Latin (and Greek, which it has), and is judged from its own glyphs:
     no Cyrillic and no accented Latin;
   - each alphabet lands on its plain face, and a mix lands on one face that writes all of it;
   - a symbol in the text (a private-use character) is never counted as a missing letter.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/font-fallback.test.ts \
      --bundle --platform=node --format=esm \
      --define:import.meta.glob=globalThis.__viteGlob --inject:packages/fonts/tests/vite-glob-shim.mts \
      --outfile=apps/clicker-generator/.font-fallback-test.mjs \
      && node apps/clicker-generator/.font-fallback-test.mjs
*/
import { alphabetOf, facesThatWrite, fontWritesText } from '../src/image/letter.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const first = (text: string) => facesThatWrite(text)[0] ?? '(none)';
check('Latin stays on Standard', first('Custom Text') === 'helvetiker-regular', first('Custom Text'));
check('Standard cannot write Cyrillic', !fontWritesText('helvetiker-regular', 'Привет'), 'judged from its glyphs');
for (const [alphabet, text, face] of [
  ['Cyrillic', 'Привет', 'montserrat'],
  ['Greek (Standard has it)', 'Γειά σου', 'helvetiker-regular'],
  ['accented Latin', 'Señor Müller', 'montserrat'],
  ['Korean', '안녕하세요', 'gothic-a1'],
  ['Japanese kana', 'こんにちは', 'm-plus-1p'],
  ['Japanese with kanji', 'こんにちは世界', 'm-plus-1p'],
  ['Chinese', '你好', 'noto-sans-sc'],
  ['Korean with Cyrillic', '안녕 Привет', 'gothic-a1'],
] as const) {
  check(`${alphabet} lands on ${face}`, first(text) === face, first(text));
}
check('every face offered writes the text', facesThatWrite('Привет').every((id) => fontWritesText(id, 'Привет')),
  `${facesThatWrite('Привет').length} faces`);
const heart = String.fromCodePoint(0xf0003);
check('a symbol is not a missing letter', fontWritesText('helvetiker-regular', `Hi${heart}`), 'Hi + a symbol');
check('the alphabet is named for the message',
  alphabetOf('Привет') === 'Cyrillic' && alphabetOf('Señor') === 'accented' && alphabetOf('Hello') === null,
  `${alphabetOf('Привет')} / ${alphabetOf('Señor')} / ${alphabetOf('Hello')}`);

console.log(failures ? `\n${failures} FAILED` : '\ntext in any alphabet lands on a face that writes it');
process.exit(failures ? 1 : 0);
