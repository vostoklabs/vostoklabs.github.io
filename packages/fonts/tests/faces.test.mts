/*
  pnpm --filter @vostok/fonts test

  The faces an app shows and draws, past the library's own list:
   - installFontFaces declares faces to the page from the files getFont reads, and its disposer
     takes them away again (a fake document.fonts and FontFace stand in for the browser's);
   - preloadFonts, then loadedFont hands a face over without waiting;
   - the other weights are in no picker's list, and getFont finds them once the weights module
     is imported, not before;
   - the symbol font through its own door is the one the text engine falls back to, parsed once;
   - `segments` changes how finely a curve is drawn, and leaving it out changes nothing.
  The font files are read from disk (tests/vite-glob-files.mts answers the globs).
*/
import { FONTS, FALLBACK_FONT_ID, getFont, getFontUrl, installFontFaces, loadedFont, preloadFonts, getHorizontalContours, getVerticalContours, pathCommandsToPolygons } from '../src/index';
import { getIconFont, iconFontUrl, ICONS } from '../src/iconFont';

let checks = 0;
let failed = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

// ---- installFontFaces, against a stand-in for the page's font set

class FakeFace {
  constructor(readonly family: string, readonly source: string, readonly descriptors: { display?: string }) {}
}
const added = new Set<FakeFace>();
(globalThis as any).FontFace = FakeFace;
(globalThis as any).document = { fonts: { add: (f: FakeFace) => added.add(f), delete: (f: FakeFace) => added.delete(f) } };

const remove = installFontFaces(['anton', 'roboto', 'no-such-face']);
const faces = [...added];
ok(faces.length === 2, `two faces declared, the unknown one skipped (${faces.length})`);
ok(faces[0]?.family === 'VL-anton' && faces[1]?.family === 'VL-roboto', `named by fontFamilyFor: ${faces.map((f) => f.family).join(', ')}`);
ok(faces[0]?.source === `url("${getFontUrl('anton')}")`, 'from the same file getFont reads');
ok(faces.every((f) => f.descriptors.display === 'block'), 'display block by default');
remove();
ok(added.size === 0, 'the disposer takes every one of them away');
const removeSwap = installFontFaces(['anton'], { display: 'swap' });
ok([...added][0]?.descriptors.display === 'swap', 'display as asked');
removeSwap();
ok(installFontFaces([])() === undefined && added.size === 0, 'no faces, nothing declared, a disposer all the same');

// ---- preload, then read without waiting

ok(loadedFont('anton') === undefined, 'nothing loaded before anything asks');
await preloadFonts(['anton', 'pacifico']);
const anton = loadedFont('anton');
ok(anton && typeof anton.getPath === 'function', 'loadedFont hands over a preloaded face');
ok(anton === (await getFont('anton')), 'the very face getFont gives');
ok(loadedFont('bebas-neue') === undefined, 'and never fetches one nobody asked for');

// ---- the other weights

ok(!FONTS.some((f) => f.id === 'roboto-bold'), 'Roboto Bold is in no picker list');
ok(getFontUrl('roboto-bold') === undefined, 'nor can the library find it before the weights module is imported');
const { WEIGHTS } = await import('../src/weights');
ok(WEIGHTS.some((f) => f.id === 'roboto-bold' && f.label === 'Roboto Bold'), 'listed as a weight');
ok(typeof getFontUrl('roboto-bold') === 'string', 'imported, getFontUrl finds it');
const bold = await getFont('roboto-bold');
const regular = await getFont('roboto');
ok(bold.tables.os2.usWeightClass === 700 && regular.tables.os2.usWeightClass === 400, `a bold face beside the regular (${bold.tables.os2.usWeightClass} / ${regular.tables.os2.usWeightClass})`);
ok(bold.charToGlyph('A').advanceWidth > regular.charToGlyph('A').advanceWidth, 'and its letters are wider');

// ---- the symbol font through its own door

ok(typeof iconFontUrl === 'string' && ICONS.length > 1000, 'the icon-font door has the file and the symbol list');
const viaDoor = await getIconFont();
const viaLibrary = await getFont(FALLBACK_FONT_ID);
ok(viaDoor && viaDoor === viaLibrary, 'one parse of the symbol font, whichever door asked first');

// ---- how finely a curve is drawn

const commands = regular.charToGlyph('S').getPath(0, 0, 100).commands;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
ok(same(pathCommandsToPolygons(commands), pathCommandsToPolygons(commands, 3, 8)), 'pathCommandsToPolygons: 8 steps per curve is the default');
const fine = pathCommandsToPolygons(commands, 3, 16);
const coarse = pathCommandsToPolygons(commands);
const count = (c: number[][][]) => c.reduce((n, r) => n + r.length, 0);
ok(count(fine) > count(coarse), `16 steps draw more points (${count(fine)} against ${count(coarse)})`);
const layout = (opts: object) => getHorizontalContours(regular, null, 'Sog', 'two', 20, 12, 0, 'center', 0.4, 0.05, opts);
ok(same(layout({}), layout({ segments: 8 })), 'getHorizontalContours: no option is 8 steps');
const fineLayout = layout({ segments: 16 });
ok(count(fineLayout.contours) > count(layout({}).contours), 'and 16 draws more points');
ok(Math.abs(fineLayout.box.maxX - layout({}).box.maxX) < 0.2 && Math.abs(fineLayout.box.minY - layout({}).box.minY) < 0.2, 'round the same letters');
const vertical = (opts?: { segments?: number }) => getVerticalContours(regular, null, 'Sog', 20, 1, 0, opts);
ok(same(vertical(), vertical({ segments: 8 })) && count(vertical({ segments: 16 }).contours) > count(vertical().contours), 'getVerticalContours takes it too');

console.log(`faces: ${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
