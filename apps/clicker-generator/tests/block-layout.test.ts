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
  arrangeBlocks, arrangementOf, blockBuildParams, changeLayout, gridFor, keysPerRow, lineSymbols, loadedBlocks,
  loadedSymbols, pruneSymbols,
  presetText, resizeCells, toggleKey, type BlockState,
} from '../src/geometry/blockLayout.ts';

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
  const s = { ...state({ blockLayout: 'wasd', blockLines: ['W', 'ASD'] }), blockStyle: 'open' as const, blockTexture: 'knurl' as const };
  const p = blockBuildParams(s);
  check('the build gets the grid, its width and where the keys are',
    p.blockOrientation === 'grid' && p.blockColumns === 3 && p.blockKeys.length === 6 && p.blockStyle === 'open' && p.blockTexture === 'knurl',
    JSON.stringify(p));
  const a = arrangeBlocks('grid', 2, 2, null, ['AB', 'CD'], {});
  check('slots, keys and characters stay the same length', a.slots.length === 4 && a.keys.length === 4 && a.chars.length === 4, `${a.slots.length}/${a.keys.length}/${a.chars.length}`);
}

// --- loading a project ---------------------------------------------------------------------------
{
  const sym = String.fromCodePoint(0xf0010);
  const good = loadedBlocks({
    blockLayout: 'custom', blockGridRows: 2, blockGridCols: 3, blockCells: [true, false, true, true, true, true],
    blockLines: ['A' + sym, 'BCD'], blockSymbols: { [sym]: { kind: 'rings', label: 'Heart', rings: [[[0, 0], [1, 0], [0, 1]]] } },
    blockStyle: 'open', blockTexture: 'ribs', legendScale: 1.2, legendBold: 0.2,
  });
  check('a saved block design reads back field for field',
    good.blockLayout === 'custom' && good.blockGridCols === 3 && good.blockCells?.length === 6 && good.blockLines?.[0] === 'A' + sym
      && good.blockSymbols?.[sym]?.kind === 'rings' && good.blockStyle === 'open' && good.blockTexture === 'ribs' && good.legendScale === 1.2,
    JSON.stringify(Object.keys(good)));
  const bad = loadedBlocks({
    blockLayout: 'hexagon', blockGridRows: 99, blockCells: ['x'], blockLines: [3], blockStyle: 'glass',
    blockSymbols: { a: { kind: 'rings', label: 'x', rings: [] }, [sym]: { kind: 'rings', label: 'x', rings: [[[0, 'y']]] } },
    legendScale: 'big',
  });
  check('a malformed one changes nothing it cannot back up',
    !('blockLayout' in bad) && bad.blockGridRows === 6 && !('blockCells' in bad) && !('blockLines' in bad)
      && !('blockStyle' in bad) && !('legendScale' in bad) && Object.keys(bad.blockSymbols ?? {}).length === 0,
    JSON.stringify(bad));
  check('a project from before blocks were saved sets nothing', Object.keys(loadedBlocks({ importMode: 'image' })).length === 0, '{}');
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
}

console.log(failures ? `\n${failures} FAILED` : '\nblock layouts hold');
process.exit(failures ? 1 : 0);
