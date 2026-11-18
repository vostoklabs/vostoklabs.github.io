/*
  pnpm --filter @vostok/fonts test

  keepOnlyFonts (vite.js) narrows a build to the faces an app names, by rewriting the package's
  own glob and its fonts.css. What this guards:
   - TrueType faces come out exactly as they always did: the glob becomes the list of their
     .ttf files, and fonts.css keeps only their rules;
   - an OpenType face (one shipped as its maker released it) is kept by its .otf, and it needs no
     rule in fonts.css, because it has none: it is declared once its file has loaded;
   - a misspelt face, and a glob that moved, still fail the build.
*/
import { readFileSync } from 'node:fs';
import { keepOnlyFonts, leaveOutFonts } from '../vite.js';

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};
const throws = (fn, re, msg) => {
  try {
    fn();
    ok(false, `${msg}: did not throw`);
  } catch (e) {
    ok(re.test(e.message), `${msg}: ${e.message}`);
  }
};

const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/fonts.css', import.meta.url), 'utf8');
const INDEX = '/repo/packages/fonts/src/index.ts';
const CSS = '/repo/packages/fonts/src/fonts.css';
const rules = (code) => (code.match(/@font-face/g) ?? []).length;

const ttf = keepOnlyFonts(['anton', 'pacifico']);
const ttfIndex = ttf.transform(index, INDEX);
ok(ttfIndex.includes('["./fonts/anton.ttf","./fonts/pacifico.ttf"]') && !ttfIndex.includes("'./fonts/*.ttf'"), 'TrueType faces: the glob becomes their files');
const ttfCss = ttf.transform(css, CSS);
ok(rules(ttfCss) === 2 && ttfCss.includes('VL-anton') && ttfCss.includes('VL-pacifico'), `and fonts.css keeps their two rules (${rules(ttfCss)})`);
ok((() => { ttf.buildEnd(); return true; })(), 'and the build ends cleanly');

const otf = keepOnlyFonts(['anton', 'source-han-sans-cn-light']);
ok(otf.transform(index, INDEX).includes('["./fonts/anton.ttf","./fonts/source-han-sans-cn-light.otf"]'), 'an OpenType face is kept by its .otf');
const otfCss = otf.transform(css, CSS);
ok(rules(otfCss) === 1 && otfCss.includes('VL-anton'), `and needs no rule in fonts.css (${rules(otfCss)} kept)`);

throws(() => keepOnlyFonts(['antonn']).transform(css, CSS), /no @font-face for antonn/, 'a misspelt face fails');
throws(() => keepOnlyFonts(['anton']).transform(index.replace("'./fonts/*.otf'", "'./fonts/*.woff2'"), INDEX), /the glob moved/, 'a glob that moved fails');

// leaveOutFonts: everything but the named faces, and the index told which are gone.
const leave = leaveOutFonts(['source-han-sans-cn-light']);
const leftIndex = leave.transform(index, INDEX);
ok(leftIndex.includes('["./fonts/*.ttf","./fonts/*.otf","!./fonts/source-han-sans-cn-light.otf"]'), 'leaveOutFonts: the glob keeps every face but the one named');
ok(leftIndex.includes('const LEFT_OUT: readonly string[] = ["source-han-sans-cn-light"];'), 'leaveOutFonts: and the index knows it is gone');
ok(rules(leave.transform(css, CSS)) === rules(css), 'leaveOutFonts: a face with no rule in fonts.css leaves the rules as they were');
ok(rules(leaveOutFonts(['anton']).transform(css, CSS)) === rules(css) - 1, 'leaveOutFonts: a face with a rule loses it');
ok((() => { leave.buildEnd(); return true; })(), 'leaveOutFonts: the build ends cleanly');
throws(() => leaveOutFonts(['antonn']), /not in the library: antonn/, 'leaveOutFonts: a misspelt face fails');
throws(() => leaveOutFonts(['anton']).transform(index.replace('const LEFT_OUT: readonly string[] = [];', ''), INDEX), /is not in fonts.src.index.ts/, 'leaveOutFonts: an index without the line fails');
throws(() => leaveOutFonts(['anton']).buildEnd(), /never transformed/, 'leaveOutFonts: a rewrite that never fired fails the build');

console.log(failed ? `keep only fonts: ${failed} FAILED` : 'keep only fonts: .ttf faces as before, an .otf face by its own file');
process.exit(failed ? 1 : 0);
