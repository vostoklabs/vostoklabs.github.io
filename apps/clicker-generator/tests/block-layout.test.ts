/*
  Letter blocks: the arrangement and what is printed on each key (src/geometry/blockLayout.ts).

  The Layout category picks Row, Column, Grid, WASD, Arrows or Custom; the right panel has one
  line of text per row of keys; the key map adds and removes keys. What has to hold:
   - every layout gives the build one slot per cell, with the holes where the layout has them;
   - a key with nothing printed on it is still a key (it gets a switch and a cap);
   - text follows its keys through every edit: switching layout, tapping the map, resizing;
   - a saved project is read back exactly, and a malformed one cannot inject garbage.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/block-layout.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.block-layout-test.mjs \
      && node apps/clicker-generator/.block-layout-test.mjs
*/
import {
  arrangeBlocks, arrangementOf, blockBuildParams, changeLayout, clampBlockCap, gridFor, keysPerRow, lineSymbols, loadedBlocks,
  loadedSymbols, pruneSymbols,
  presetText, resizeCells, RIM_RAISE_MAX_MM, toggleKey, type BlockState,
} from '../src/geometry/blockLayout.ts';
import { CAP_LOWER_MAX_MM, capLowerMax, rimRaiseMax } from '../src/geometry/blockKeycaps.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const kinds = (s: BlockState) => arrangementOf(s).slots.map((x) => (x.kind === 'char' ? x.ch : x.kind === 'empty' ? '_' : x.kind === 'blank' ? '.' : x.kind === 'icon' ? `<${x.name}>` : '*')).join('');
/** A layout's starting keys, as state fields. */
const preset = (layout: BlockState['blockLayout'], rows: number, cols: number): Partial<BlockState> => {
  const p = presetText(layout, rows, cols);
  return { blockLines: p.lines, blockSymbols: p.symbols };
};
const state = (over: Partial<BlockState>): BlockState => ({
  blockLayout: 'row', blockGridRows: 3, blockGridCols: 3, blockCells: null,
  blockLines: ['Name'], blockSymbols: {}, ...over,
});

// --- the arrangements --------------------------------------------------------------------------
{
  const row = state({ blockLines: ['I L U'] });
  check('a row is one key per visible character, spaces dropped as before', kinds(row) === 'ILU' && arrangementOf(row).orientation === 'horizontal', kinds(row));
  const col = state({ blockLayout: 'column', blockLines: ['ABC'] });
  check('a column is the same keys reading down', kinds(col) === 'ABC' && arrangementOf(col).orientation === 'vertical' && arrangementOf(col).columns === 1, kinds(col));
  const empty = state({ blockLines: [''] });
  check('an empty row still has one (blank) key, so there is always a body', kinds(empty) === '.' && arrangementOf(empty).keys[0] === true, kinds(empty));

  const wasd = state({ blockLayout: 'wasd', blockLines: ['W', 'ASD'] });
  check('WASD is W over A S D, with the two top corners empty', kinds(wasd) === '_W_ASD', kinds(wasd));
  check('...and the build is told the corners have no key', JSON.stringify(arrangementOf(wasd).keys) === JSON.stringify([false, true, false, true, true, true]), String(arrangementOf(wasd).keys));

  const arrows = state({ blockLayout: 'arrows', ...preset('arrows', 3, 3) });
  check('Arrows starts on four arrow symbols', kinds(arrows) === '_<arrow-up>_<arrow-left><arrow-down><arrow-right>', kinds(arrows));

  const grid = state({ blockLayout: 'grid', ...preset('grid', 3, 3) });
  check('a 3×3 grid starts as a number pad', kinds(grid) === '123456789' && arrangementOf(grid).columns === 3, kinds(grid));
  const big = presetText('grid', 4, 4).lines.join('');
  check('a 4×4 still has a legend on every key', big === '123456789ABCDEFG', big);
  const spaced = state({ blockLayout: 'grid', blockGridRows: 1, blockGridCols: 3, blockLines: ['A D'] });
  check('in a grid a space is a key with nothing on it', kinds(spaced) === 'A.D', kinds(spaced));
  const short = state({ blockLayout: 'grid', blockGridRows: 2, blockGridCols: 2, blockLines: ['A'] });
  check('keys past the end of a line are blank, not missing', kinds(short) === 'A...' && arrangementOf(short).keys.every(Boolean), kinds(short));
  const long = state({ blockLayout: 'grid', blockGridRows: 1, blockGridCols: 2, blockLines: ['ABCD'] });
  check('characters past a row\'s last key are not printed', kinds(long) === 'AB', kinds(long));
}

// --- switching layouts ---------------------------------------------------------------------------
{
  const name = state({ blockLines: ['ALEX'] });
  const asCol = { ...name, ...changeLayout(name, 'column') } as BlockState;
  check('row → column keeps the text', kinds(asCol) === 'ALEX', kinds(asCol));
  const asWasd = { ...name, ...changeLayout(name, 'wasd') } as BlockState;
  check('row → WASD brings WASD\'s own keys', kinds(asWasd) === '_W_ASD', kinds(asWasd));
  const asCustom = { ...asWasd, ...changeLayout(asWasd, 'custom') } as BlockState;
  check('WASD → Custom starts as the WASD on screen', kinds(asCustom) === '_W_ASD' && asCustom.blockCells?.join() === 'false,true,false,true,true,true', kinds(asCustom));
  const backToRow = { ...asCustom, ...changeLayout(asCustom, 'row') } as BlockState;
  check('a grid → row runs its rows together into one line', kinds(backToRow) === 'WASD', kinds(backToRow));
  const grid = state({ blockLayout: 'grid', ...preset('grid', 2, 3), blockGridRows: 2, blockGridCols: 3 });
  const custom = { ...grid, ...changeLayout(grid, 'custom') } as BlockState;
  const off = { ...custom, ...toggleKey(custom, 0) } as BlockState;
  const asGrid = { ...off, ...changeLayout(off, 'grid') } as BlockState;
  // The key that was taken away comes back blank at the end of its row: the row's text keeps
  // its order, it does not remember which cell it once sat in.
  check('Custom → Grid keeps the keys\' text and fills every cell again', kinds(asGrid) === '23.456' && asGrid.blockCells === null, kinds(asGrid));
}

// --- the key map ----------------------------------------------------------------------------------
{
  const pad = state({ blockLayout: 'grid', blockGridRows: 3, blockGridCols: 3, ...preset('grid', 3, 3) });
  const noFive = { ...pad, ...toggleKey(pad, 4) } as BlockState;
  check('taking a key away leaves every other key\'s text where it was', kinds(noFive) === '1234_6789' && noFive.blockLayout === 'custom', kinds(noFive));
  const back = { ...noFive, ...toggleKey(noFive, 4) } as BlockState;
  check('putting it back gives a blank key, not the old letter', kinds(back) === '1234.6789', kinds(back));
  const one = state({ blockLayout: 'custom', blockGridRows: 1, blockGridCols: 1, blockCells: [true], blockLines: ['X'] });
  const still = { ...one, ...toggleKey(one, 0) } as BlockState;
  check('the last key cannot be taken away', arrangementOf(still).keys.filter(Boolean).length === 1, kinds(still));
  const row = state({ blockLines: ['ABC'] });
  const rowOff = { ...row, ...toggleKey(row, 1) } as BlockState;
  check('a tap on a row\'s map makes it a custom one-row grid', kinds(rowOff) === 'A_C' && rowOff.blockGridCols === 3, kinds(rowOff));
}

// --- resizing -----------------------------------------------------------------------------------
{
  const g = gridFor('custom', 0, 2, 2, [true, false, false, true]);
  const grown = resizeCells(g, 3, 3);
  check('growing a custom grid keeps its cells where they were, new ones on',
    grown.join() === 'true,false,true,false,true,true,true,true,true', grown.join());
  const shrunk = resizeCells(g, 1, 1);
  check('shrinking never leaves a grid with no key', shrunk.join() === 'true', shrunk.join());
  check('keys per row counts the on cells', keysPerRow(gridFor('wasd', 0, 0, 0, null)).join() === '1,3', keysPerRow(gridFor('wasd', 0, 0, 0, null)).join());
}

// --- the build's view ---------------------------------------------------------------------------
{
  const s = {
    ...state({ blockLayout: 'wasd', blockLines: ['W', 'ASD'] }), blockStyle: 'open' as const, blockTexture: 'knurl' as const, blockRimRaiseMm: 2.4,
    blockKeycap: 'standard' as const, blockCapLowerMm: 1.5,
  };
  const p = blockBuildParams(s);
  check('the build gets the grid, its width, where the keys are and which keycap',
    p.blockOrientation === 'grid' && p.blockColumns === 3 && p.blockKeys.length === 6 && p.blockStyle === 'open' && p.blockTexture === 'knurl'
      && p.blockRimRaiseMm === 2.4 && p.blockKeycap === 'standard' && p.blockCapLowerMm === 1.5,
    JSON.stringify(p));
  const thocky = blockBuildParams({ ...s, blockKeycap: 'thocky', blockCapLowerMm: 0 });
  check('…Thocky too', thocky.blockKeycap === 'thocky' && thocky.blockCapLowerMm === 0, JSON.stringify(thocky));
  const a = arrangeBlocks('grid', 2, 2, null, ['AB', 'CD'], {});
  check('slots, keys and characters stay the same length', a.slots.length === 4 && a.keys.length === 4 && a.chars.length === 4, `${a.slots.length}/${a.keys.length}/${a.chars.length}`);
}

// --- loading a project ---------------------------------------------------------------------------
{
  const sym = String.fromCodePoint(0xf0010);
  const good = loadedBlocks({
    blockLayout: 'custom', blockGridRows: 2, blockGridCols: 3, blockCells: [true, false, true, true, true, true],
    blockLines: ['A' + sym, 'BCD'], blockSymbols: { [sym]: { kind: 'rings', label: 'Heart', rings: [[[0, 0], [1, 0], [0, 1]]] } },
    blockStyle: 'open', blockTexture: 'ribs', blockRimRaiseMm: 2.4, legendScale: 1.2, legendBold: 0.2,
  });
  check('a saved block design reads back field for field',
    good.blockLayout === 'custom' && good.blockGridCols === 3 && good.blockCells?.length === 6 && good.blockLines?.[0] === 'A' + sym
      && good.blockSymbols?.[sym]?.kind === 'rings' && good.blockStyle === 'open' && good.blockTexture === 'ribs'
      && good.blockRimRaiseMm === 2.4 && good.legendScale === 1.2,
    JSON.stringify(Object.keys(good)));
  const bad = loadedBlocks({
    blockLayout: 'hexagon', blockGridRows: 99, blockCells: ['x'], blockLines: [3], blockStyle: 'glass',
    blockSymbols: { a: { kind: 'rings', label: 'x', rings: [] }, [sym]: { kind: 'rings', label: 'x', rings: [[[0, 'y']]] } },
    blockRimRaiseMm: 'tall', legendScale: 'big',
  });
  check('a malformed one changes nothing it cannot back up',
    !('blockLayout' in bad) && bad.blockGridRows === 6 && !('blockCells' in bad) && !('blockLines' in bad)
      && !('blockStyle' in bad) && !('blockRimRaiseMm' in bad) && !('legendScale' in bad) && Object.keys(bad.blockSymbols ?? {}).length === 0,
    JSON.stringify(bad));
  check('a rim saved higher than the slider goes loads at the slider\'s top',
    loadedBlocks({ blockRimRaiseMm: 40 }).blockRimRaiseMm === RIM_RAISE_MAX_MM && loadedBlocks({ blockRimRaiseMm: -3 }).blockRimRaiseMm === 0,
    `${loadedBlocks({ blockRimRaiseMm: 40 }).blockRimRaiseMm}`);
  check('a project from before blocks were saved sets nothing', Object.keys(loadedBlocks({ importMode: 'image' })).length === 0, '{}');
  const rimOnly = loadedBlocks({ blockStyle: 'walls', blockRimRaiseMm: 2.4 });
  check('…and one from before the keycap could be picked sets no keycap and no cut', !('blockKeycap' in rimOnly) && !('blockCapLowerMm' in rimOnly)
    && rimOnly.blockRimRaiseMm === 2.4, JSON.stringify(rimOnly));
}

// --- the keycap, its height and the rim ---------------------------------------------------------
{
  check('Standard can be cut 4.5 mm shorter; Low profile and Thocky cannot be cut at all',
    capLowerMax('standard') === CAP_LOWER_MAX_MM && capLowerMax('low') === 0 && capLowerMax('thocky') === 0,
    `${capLowerMax('standard')}, ${capLowerMax('low')}, ${capLowerMax('thocky')}`);
  const max = { standard: rimRaiseMax('standard'), cut: rimRaiseMax('standard', CAP_LOWER_MAX_MM), low: rimRaiseMax('low'), thocky: rimRaiseMax('thocky') };
  check('the rim rises as far as each cap allows: 6, 1.6 on the shortest Standard, 2.3 on Low profile, 5.7 on Thocky',
    max.standard === RIM_RAISE_MAX_MM && max.cut === 1.6 && max.low === 2.3 && max.thocky === 5.7, JSON.stringify(max));

  const saved = loadedBlocks({ blockKeycap: 'thocky', blockCapLowerMm: 0, blockRimRaiseMm: 2.4 });
  check('a saved keycap reads back', saved.blockKeycap === 'thocky' && saved.blockCapLowerMm === 0 && saved.blockRimRaiseMm === 2.4, JSON.stringify(saved));
  const unknown = loadedBlocks({ blockKeycap: 'sa-profile', blockCapLowerMm: 2, blockRimRaiseMm: 2.4 });
  check('a keycap this build does not have is left out, so the cap is Standard and its cut stands',
    !('blockKeycap' in unknown) && unknown.blockCapLowerMm === 2 && unknown.blockRimRaiseMm === 2.4, JSON.stringify(unknown));
  const proto = loadedBlocks({ blockKeycap: 'toString' });
  check('…a name every object answers to included', !('blockKeycap' in proto), JSON.stringify(proto));
  const lowCut = loadedBlocks({ blockKeycap: 'low', blockCapLowerMm: 3 });
  check('a cut on a cap that cannot be cut loads as none', lowCut.blockKeycap === 'low' && lowCut.blockCapLowerMm === 0, JSON.stringify(lowCut));
  const deep = loadedBlocks({ blockCapLowerMm: 9, blockRimRaiseMm: -2 });
  check('a cut past the limit loads at it, and a rim below the body at the body',
    deep.blockCapLowerMm === CAP_LOWER_MAX_MM && deep.blockRimRaiseMm === 0, JSON.stringify(deep));
  const lowRim = loadedBlocks({ blockKeycap: 'low', blockRimRaiseMm: 5 });
  const cutRim = loadedBlocks({ blockCapLowerMm: 4.5, blockRimRaiseMm: 5 });
  check('then the rim is held below the cap it has: Low profile\'s 2.3, the shortest Standard\'s 1.6',
    lowRim.blockRimRaiseMm === 2.3 && cutRim.blockRimRaiseMm === 1.6, `${lowRim.blockRimRaiseMm}, ${cutRim.blockRimRaiseMm}`);
  const junk = loadedBlocks({ blockKeycap: 3, blockCapLowerMm: 'short', blockRimRaiseMm: null });
  check('nothing malformed gets in', Object.keys(junk).length === 0, JSON.stringify(junk));

  // What every control, an undo and a load set through: one rule.
  const toLow = clampBlockCap({ blockKeycap: 'low', blockCapLowerMm: 3, blockRimRaiseMm: 5 });
  check('picking Low profile on a cut Standard with a high rim: no cut, and the rim comes down to 2.3',
    toLow.blockKeycap === 'low' && toLow.blockCapLowerMm === 0 && toLow.blockRimRaiseMm === 2.3, JSON.stringify(toLow));
  const shorter = clampBlockCap({ blockKeycap: 'standard', blockCapLowerMm: 4.5, blockRimRaiseMm: 6 });
  check('cutting Standard shorter brings a high rim down with it', shorter.blockCapLowerMm === 4.5 && shorter.blockRimRaiseMm === 1.6, JSON.stringify(shorter));
  const back = clampBlockCap({ blockKeycap: 'standard', blockCapLowerMm: 0, blockRimRaiseMm: 6 });
  check('…and back at full height the rim goes all the way up again', back.blockRimRaiseMm === RIM_RAISE_MAX_MM, JSON.stringify(back));
  const nothing = clampBlockCap({});
  check('no fields at all: Standard as drawn, the standard body', nothing.blockKeycap === 'standard' && nothing.blockCapLowerMm === 0 && nothing.blockRimRaiseMm === 0,
    JSON.stringify(nothing));
}

// --- symbols in the text: what the lines still hold, and what a project brings back ----------------
{
  const [a, b] = [0xf0010, 0xf0011].map((cp) => String.fromCodePoint(cp)) as [string, string];
  const ring: [number, number][][] = [[[0, 0], [1, 0], [0, 1]]];
  const map = { [a]: { kind: 'rings' as const, label: 'Heart', rings: ring }, [b]: { kind: 'rings' as const, label: 'Star', rings: ring, pair: a } };
  check('a symbol still in a line is kept, and the map is the same object when nothing went',
    pruneSymbols(map, ['x' + a, b]) === map, 'same map');
  const pruned = pruneSymbols(map, ['x' + a]);
  check('a symbol typed out of every line is dropped', Object.keys(pruned).join() === a, JSON.stringify(Object.keys(pruned)));
  const loaded = loadedSymbols({ [a]: { kind: 'rings', label: 'Heart', rings: ring, scale: 9, pair: b }, x: { kind: 'rings', label: 'x', rings: ring } }) ?? {};
  check('a saved symbol comes back with its look held in range and its twin link',
    loaded[a]?.scale === 2 && loaded[a]?.pair === b && !('x' in loaded), JSON.stringify(loaded));
  check('no map at all is not an empty one', loadedSymbols(undefined) === undefined && loadedSymbols([]) === undefined, 'undefined');
  const forText = lineSymbols({ ...map, [String.fromCodePoint(0xf0001)]: { kind: 'lucide', name: 'arrow-up' } });
  check('Text mode gets every traced symbol with a full look, and no Lucide names',
    Object.keys(forText).length === 2 && forText[a]!.look.scale === 1 && forText[a]!.look.flip === false, JSON.stringify(Object.keys(forText)));

  // Which saved keys are symbols is the kit's rule (@vostok/ui-kit/symbol-rules): exactly one code
  // point from U+F0000 to U+10FFFD. Two kinds of key the app's own rule once let through are left
  // out: U+10FFFE and U+10FFFF, which Unicode keeps as noncharacters, and a symbol with more text
  // after it. A twin's link is held to the same rule.
  const cp = (s: string) => Array.from(s, (c) => c.codePointAt(0)!.toString(16)).join('+');
  const keys = [0xf0000, 0x10fffd, 0x10fffe, 0x10ffff].map((n) => String.fromCodePoint(n));
  const raw = Object.fromEntries([...keys, `${a}x`, 'A'].map((k) => [k, { kind: 'rings', label: 'k', rings: ring }]));
  const kept = Object.keys(loadedSymbols(raw) ?? {});
  check('a saved key is a symbol only when it is one code point from U+F0000 to U+10FFFD',
    kept.join() === `${keys[0]},${keys[1]}`, kept.map(cp).join(' '));
  const linked = loadedSymbols({ [a]: { kind: 'rings', label: 'Heart', rings: ring, pair: `${b}x` }, [b]: { kind: 'rings', label: 'Star', rings: ring, pair: String.fromCodePoint(0x10fffe) } }) ?? {};
  check('a twin link to anything but one symbol is dropped', !('pair' in linked[a]!) && !('pair' in linked[b]!), Object.keys(linked).map(cp).join(' '));
}

console.log(failures ? `\n${failures} FAILED` : '\nblock layouts hold');
process.exit(failures ? 1 : 0);
