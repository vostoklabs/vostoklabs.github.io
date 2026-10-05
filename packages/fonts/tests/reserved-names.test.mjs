/*
  pnpm --filter @vostok/fonts test

  The Reserved Font Name reader (scripts/reserved-names.mjs) that the font fetch and the font
  credits both use. OFL 3: no Modified Version may use a Reserved Font Name, and a face from the
  font API is Google's own build of its family, a Modified Version. What this guards:
   - every way a licence writes the name is read: unquoted (`with Reserved Font Name Aldrich.`),
     quoted, curly-quoted, after a colon or a comma, and lists with or without "and". It reads a
     font's own name table, and Google's API builds carry no declaration there: a face taken from
     the API still needs its family's OFL.txt read, which is how five shipped faces were found;
   - the OFL's own text uses the term without declaring a name, and reads as none;
   - a name matches however it is spaced or cased: NovaMono is Nova Mono, and a PostScript name
     (LibreBaskerville-Regular) matches its family;
   - on every face here, a name table that declares a reserved name gives at least one, and every
     name the quoted-only reader found is still found.
*/

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reservedFontNames, reservedNameIn } from '../scripts/reserved-names.mjs';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${PKG}src/fonts`;
const opentype = createRequire(`${PKG}package.json`)('opentype.js');
let checks = 0;
let failed = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}
const reads = (text, want) => {
  const got = reservedFontNames(text);
  ok(JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(text.slice(0, 90))} reserves ${JSON.stringify(want)} (read ${JSON.stringify(got)})`);
};

// Every way a licence writes the name
reads('Copyright (c) 2011, Matthew Desmond,with Reserved Font Name Aldrich.', ['Aldrich']);
reads('(https://github.com/impallari/Libre-Baskerville) with Reserved Font Name Libre Baskerville.', ['Libre Baskerville']);
reads('Copyright (c) 2011, wmk69,\nwith Reserved Font Name NovaMono.\n\nThis Font Software is licensed', ['NovaMono']);
reads("with Reserved Font Name 'Arvo'.", ['Arvo']);
reads('with Reserved Font Names "Abril" and "Abril Fatface"', ['Abril', 'Abril Fatface']);
reads('with Reserved Font Names "Bowlby" "Bowlby One" and "Bowlby One SC". This Font Software', ['Bowlby', 'Bowlby One', 'Bowlby One SC']);
reads("with Reserved Font Names, 'Passion'", ['Passion']);
reads('with Reserved Font Name: "Orbitron".', ['Orbitron']);
reads('with reserved font name "Saira".', ['Saira']);
reads('with Reserved Font Name ‘Source’.', ['Source']);
reads('with Reserved Font Name “Quicksand”.', ['Quicksand']);
reads('with Reserved Font Name Rye. This Font Software is licensed under the SIL Open Font License, Version 1.1.', ['Rye']);
reads('with Reserved Font Name Lilita This Font Software is licensed under the SIL Open Font License, Version 1.1.', ['Lilita']);
reads('with Reserved Font Names Foo, Bar and Baz.', ['Foo', 'Bar', 'Baz']);

// Uses of the term that declare nothing, the licence's own full text among them
reads('with no Reserved Font Name.', []);
reads('Copyright (c) 2011 by Lars Berggren. All rights reserved.', []);
reads('"Reserved Font Name" refers to any names specified as such after the\ncopyright statement(s).', []);
reads('3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder.', []);
reads(readFileSync(`${DIR}/OFL.txt`, 'utf8'), []);

// The five families that shipped as the API build, against the names that build carried
for (const [licence, names] of [
  ['with Reserved Font Name Aldrich.', ['Aldrich', 'Aldrich Regular', 'Aldrich-Regular']],
  ['with Reserved Font Name Domine.', ['Domine', 'Domine Regular', 'Domine-Regular']],
  ['with Reserved Font Name Libre Baskerville.', ['Libre Baskerville', 'Libre Baskerville Regular', 'LibreBaskerville-Regular']],
  ['with Reserved Font Name NovaMono.', ['NovaMono']],
  ['with Reserved Font Name Wallpoet.', ['Wallpoet']],
]) ok(reservedNameIn(names, reservedFontNames(licence)), `${names[0]} carries the name "${licence}" reserves`);
ok(reservedNameIn(['NovaMono'], ['Nova Mono']) === 'Nova Mono', 'spacing and case do not hide a name');
ok(reservedNameIn(['Noto Sans SC Black', 'NotoSansSC-Black'], ['Source']) === null, 'a name the face does not carry is no clash');

// Every face here, read from its own name table
const QUOTED = /Reserved Font Names?\s*:?\s*['"“]([^'"”]+)['"”]/i;
const name = (font, key) => (font.names[key]?.en ?? '').replace(/\s+/g, ' ').trim();
const silent = [];
const lost = [];
let declared = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.ttf'))) {
  const b = readFileSync(`${DIR}/${f}`);
  const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const text = `${name(font, 'copyright')}\n${name(font, 'license')}`;
  const got = reservedFontNames(text);
  if (/\bwith\s+Reserved\s+Font\s+Names?\b/i.test(text)) {
    declared++;
    if (!got.length) silent.push(f);
  }
  const quoted = name(font, 'copyright').match(QUOTED)?.[1].trim();
  if (quoted && !got.includes(quoted)) lost.push(`${f} (${quoted})`);
}
ok(declared > 50, `the faces' own name tables declare reserved names (${declared})`);
ok(!silent.length, `every declaration gives a name: ${silent.join(', ')}`);
ok(!lost.length, `every quoted name is still read: ${lost.join(', ')}`);

console.log(`\nreserved names: ${checks - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
