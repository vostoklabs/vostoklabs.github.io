/*
  pnpm --filter @vostok/fonts test

  Which face a text moves to when the chosen one cannot write it (src/fallback.ts). What this
  guards:
   - each alphabet is named for the message, accented Latin as "accented", plain Latin as none;
   - the plain faces come most telling first: kana is Japanese whatever else the text holds,
     Hangul is Korean, Han with neither is Chinese, and the rest of the plain faces follow once;
   - every plain face writes the alphabet it is picked for, as the registry measured its file,
     so a fallback never lands on a face that draws "?" instead;
   - the order an app gets: its own faces first when they write the text, then the plain ones,
     then the rest of its list, each once, and only faces that write the text;
   - a symbol (a private-use character of the symbol font) is not a letter;
   - a face an app parses itself, measured from its own characters (`scriptsFromCmap`), is
     named the alphabets the registry names for the same file.
*/

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, alphabetOf, fallbackFaces, fontScripts, fontSupportsText, lettersOnly, parseFont, plainFacesFor, scriptsFromCmap } from '../src/index';

let checks = 0;
let failed = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// The alphabet, named for the message
for (const [text, name] of [
  ['한글', 'Korean'], ['かな', 'Japanese'], ['カタカナ', 'Japanese'], ['汉字', 'Chinese'], ['Привет', 'Cyrillic'],
  ['Ωμέγα', 'Greek'], ['Ñandú', 'accented'], ['Łódź', 'accented'], ['Hello 123', null], ['', null],
] as const) {
  ok(alphabetOf(text) === name, `alphabetOf(${text}) is ${name}: ${alphabetOf(text)}`);
}

// The plain faces, most telling first
const REST = ['montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc'];
for (const [text, lead] of [
  ['한글', 'gothic-a1'], ['かな', 'm-plus-1p'], ['こんにちは世界', 'm-plus-1p'], ['汉字', 'noto-sans-sc'],
  ['Привет', 'montserrat'], ['Ωμέγα', 'gothic-a1'], ['Łódź', 'montserrat'], ['Ñandú', 'montserrat'],
  ['안녕 Привет', 'gothic-a1'], ['Hello', 'montserrat'],
] as const) {
  const faces = plainFacesFor(text);
  ok(faces[0] === lead, `plainFacesFor(${text}) leads with ${lead}: ${faces.join(', ')}`);
  ok(same([...faces].sort(), [...REST].sort()), `plainFacesFor(${text}) lists each plain face once: ${faces.join(', ')}`);
}

// Every plain face writes what it is picked for
for (const [text, face] of [
  ['한글 안녕하세요', 'gothic-a1'], ['Ωμέγα', 'gothic-a1'], ['かな カタカナ 日本', 'm-plus-1p'], ['汉字 你好', 'noto-sans-sc'],
  ['Привет', 'montserrat'], ['Łódź Ñandú', 'montserrat'],
] as const) {
  ok(fontSupportsText(face, text), `${face} writes ${text}`);
}

// The order an app gets
const faces = ['app-default', 'abril-fatface', 'montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc', 'zeta'];
const latinOnly = new Set(['app-default', 'abril-fatface', 'zeta']);
const writes = (id: string, text: string) => (latinOnly.has(id) ? !alphabetOf(text) || alphabetOf(text) === 'accented' : fontSupportsText(id, text));
ok(same(fallbackFaces('Hello', { faces, writes, first: ['app-default'] }),
  ['app-default', 'montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc', 'abril-fatface', 'zeta']),
  `Latin keeps the app's face first: ${fallbackFaces('Hello', { faces, writes, first: ['app-default'] }).join(', ')}`);
const korean = fallbackFaces('한글', { faces, writes, first: ['app-default'] });
ok(korean[0] === 'gothic-a1' && korean.every((id) => writes(id, '한글')), `Korean lands on gothic-a1, and only faces that write it follow: ${korean.join(', ')}`);
const chinese = fallbackFaces('汉字', { faces, writes });
ok(chinese[0] === 'noto-sans-sc' && chinese.every((id) => writes(id, '汉字')), `Chinese lands on noto-sans-sc with no app faces: ${chinese.join(', ')}`);
const all = fallbackFaces('Hello', { faces, writes: () => true, first: ['app-default'] });
ok(new Set(all).size === all.length && all.length === faces.length, `each face once: ${all.join(', ')}`);

// A face measured from its own characters
// cwd, not `import.meta.url`: esbuild bundles this into node_modules/.cache.
for (const id of ['montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc', 'abril-fatface']) {
  const b = readFileSync(join(process.cwd(), 'src', 'fonts', `${id}.ttf`));
  const cmap: Record<number, number> = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).tables.cmap.glyphIndexMap;
  const measured = scriptsFromCmap((cp) => !!cmap[cp]);
  const listed = fontScripts(FONTS.find((f) => f.id === id)!);
  ok(same(measured, listed), `${id} measured from its cmap writes ${measured.join(', ')}; the registry says ${listed.join(', ')}`);
}

// A symbol is not a letter
const heart = String.fromCodePoint(0xf0003);
ok(lettersOnly(`Hi${heart}!`) === 'Hi!', 'lettersOnly drops a symbol');
ok(alphabetOf(`Hi${heart}`) === null, 'a symbol needs no alphabet');

console.log(failed ? `\n${failed} of ${checks} FAILED` : `fallback: ${checks} checks pass`);
process.exit(failed ? 1 : 0);
