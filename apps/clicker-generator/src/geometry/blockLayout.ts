// Letter blocks: where the keys are, and what is printed on each.
//
// The Layout category picks an arrangement; the right panel says what goes on the keys, one line
// of text per row of keys. This turns the two into what the build reads: one slot per cell of the
// grid in reading order — a letter, a symbol, a key with nothing printed on it, or no key at all —
// plus the grid's width. Pure, so it is tested without a browser (tests/block-layout.test.ts).
import { isSymbolChar } from '@vostok/ui-kit/symbol-rules';
import type { BlockOrientation, BlockSlot, BlockStyle, BlockTexture } from '../types';
import { lookOf, lookRings, type SymbolLook } from '../image/symbolRings';

export type BlockLayout = 'row' | 'column' | 'grid' | 'wasd' | 'arrows' | 'custom';

/** The largest grid the Rows and Columns steppers offer. */
export const GRID_MAX = 6;

/* A symbol stands in the text as one private-use character (plane 15/16), the way the rest of
   the house's symbol fields carry them, so a row of keys is still just a string. Which character
   is one is the kit's rule, from the subpath that loads no DOM; handed on for the page. */
export { isSymbolChar };

/** What a symbol character prints: a Lucide icon by name, or rings already traced (a library
 *  symbol, or an SVG of your own), normalised like `parseSvg`'s: centred, longest side 1.
 *  Text mode keeps its symbols the same way. `pair` links the two copies "Both sides" puts at
 *  either end of a line, so an edit to one is an edit to both. */
export type BlockSymbol = (
  | { kind: 'lucide'; name: string; label?: string }
  | { kind: 'rings'; label: string; rings: [number, number][][] }
) & Partial<SymbolLook> & { pair?: string };

/** Which cells of a rows × cols grid have a key, row by row. */
export interface BlockGrid {
  rows: number;
  cols: number;
  on: boolean[];
}

/** WASD and Arrows: one key over the middle of a row of three. */
const INVERTED_T = [false, true, false, true, true, true];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n) || lo));

/**
 * The cells a layout has. A row and a column are as long as their text; WASD and Arrows are the
 * inverted T; Grid is every cell; Custom is the map as it was switched.
 */
export function gridFor(
  layout: BlockLayout,
  keyCount: number,
  rows: number,
  cols: number,
  cells: readonly boolean[] | null,
): BlockGrid {
  const n = Math.max(1, keyCount);
  switch (layout) {
    case 'row':
      return { rows: 1, cols: n, on: Array(n).fill(true) };
    case 'column':
      return { rows: n, cols: 1, on: Array(n).fill(true) };
    case 'wasd':
    case 'arrows':
      return { rows: 2, cols: 3, on: [...INVERTED_T] };
    case 'grid':
    case 'custom': {
      const r = clamp(rows, 1, GRID_MAX);
      const c = clamp(cols, 1, GRID_MAX);
      const on = layout === 'custom' && cells && cells.length === r * c ? [...cells] : Array(r * c).fill(true);
      return { rows: r, cols: c, on };
    }
  }
}

/** How many keys each row of a grid has. */
export function keysPerRow(grid: BlockGrid): number[] {
  const out: number[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let k = 0;
    for (let c = 0; c < grid.cols; c++) if (grid.on[r * grid.cols + c]) k++;
    out.push(k);
  }
  return out;
}

/** A row or a column reads its text as one line of keys; the other layouts have a line per row. */
export function isLineLayout(layout: BlockLayout): boolean {
  return layout === 'row' || layout === 'column';
}

/** The keys of a line of text: one per character. In a row or a column every key is a visible
 *  character, so spaces are dropped (as they always were); in a grid a space is a key with
 *  nothing printed on it, which is how "A D" leaves the middle key blank. */
export function lineKeys(text: string, spacesAreBlank: boolean): string[] {
  const chars = Array.from(text);
  return spacesAreBlank ? chars.map((ch) => (/\s/.test(ch) ? ' ' : ch)) : chars.filter((ch) => !/\s/.test(ch));
}

function slotFor(ch: string | undefined, symbols: Readonly<Record<string, BlockSymbol>>): BlockSlot {
  if (ch === undefined || ch === ' ') return { kind: 'blank' };
  if (isSymbolChar(ch)) {
    const sym = symbols[ch];
    if (!sym) return { kind: 'blank' };
    return sym.kind === 'lucide' ? { kind: 'icon', name: sym.name, look: lookOf(sym) } : { kind: 'symbol', char: ch };
  }
  return { kind: 'char', ch };
}

export interface BlockArrangement {
  grid: BlockGrid;
  /** One per cell, reading order. */
  slots: BlockSlot[];
  /** The character each cell took from its line: ' ' for a blank key, null for no key. */
  chars: (string | null)[];
  /** Is there a key in this cell? A blank key is a key; an empty cell is not. */
  keys: boolean[];
  orientation: BlockOrientation;
  columns: number;
}

/**
 * Lay the text onto the layout.
 *
 * `lines` is one string per row of keys (a row or a column uses the first). Each on-cell of a
 * row takes the next character of that row's line; a cell with no character left gets a blank
 * key, and characters past the row's last key are not printed.
 */
export function arrangeBlocks(
  layout: BlockLayout,
  rows: number,
  cols: number,
  cells: readonly boolean[] | null,
  lines: readonly string[],
  symbols: Readonly<Record<string, BlockSymbol>>,
): BlockArrangement {
  if (isLineLayout(layout)) {
    const keys = lineKeys(lines[0] ?? '', false);
    const grid = gridFor(layout, keys.length, rows, cols, cells);
    const slots = keys.length ? keys.map((ch) => slotFor(ch, symbols)) : [{ kind: 'blank' } as BlockSlot];
    return {
      grid,
      slots,
      chars: keys.length ? keys : [' '],
      keys: slots.map(() => true),
      orientation: layout === 'row' ? 'horizontal' : 'vertical',
      columns: grid.cols,
    };
  }
  const grid = gridFor(layout, 0, rows, cols, cells);
  const slots: BlockSlot[] = [];
  const keys: boolean[] = [];
  const used: (string | null)[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const chars = lineKeys(lines[r] ?? '', true);
    let next = 0;
    for (let c = 0; c < grid.cols; c++) {
      if (!grid.on[r * grid.cols + c]) {
        slots.push({ kind: 'empty' });
        keys.push(false);
        used.push(null);
        continue;
      }
      const ch = chars[next++];
      slots.push(slotFor(ch, symbols));
      keys.push(true);
      used.push(ch ?? ' ');
    }
  }
  return { grid, slots, chars: used, keys, orientation: 'grid', columns: grid.cols };
}

/** The text a layout starts with: the keys someone picking it most likely wants. Arrows are
 *  symbols, so the preset brings the four it uses. */
export function presetText(
  layout: BlockLayout,
  rows: number,
  cols: number,
): { lines: string[]; symbols: Record<string, BlockSymbol> } {
  if (layout === 'arrows') {
    const [up, left, down, right] = [0xf0001, 0xf0002, 0xf0003, 0xf0004].map((cp) => String.fromCodePoint(cp));
    return {
      lines: [up, left + down + right],
      symbols: {
        [up]: { kind: 'lucide', name: 'arrow-up', label: 'Arrow up' },
        [left]: { kind: 'lucide', name: 'arrow-left', label: 'Arrow left' },
        [down]: { kind: 'lucide', name: 'arrow-down', label: 'Arrow down' },
        [right]: { kind: 'lucide', name: 'arrow-right', label: 'Arrow right' },
      },
    };
  }
  return { lines: presetLines(layout, rows, cols), symbols: {} };
}

function presetLines(layout: BlockLayout, rows: number, cols: number): string[] {
  switch (layout) {
    case 'row':
    case 'column':
      return ['Name'];
    case 'wasd':
      return ['W', 'ASD'];
    case 'arrows':
      return ['', ''];
    case 'grid':
    case 'custom': {
      // 1, 2, 3… then letters past 9, so a 3×3 is a number pad and a 4×4 still has a legend
      // on every key.
      const out: string[] = [];
      let k = 0;
      const label = (i: number) => (i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9));
      for (let r = 0; r < clamp(rows, 1, GRID_MAX); r++) {
        let line = '';
        for (let c = 0; c < clamp(cols, 1, GRID_MAX); c++) line += label(k++);
        out.push(line);
      }
      return out;
    }
  }
}

/** Switch one cell of a grid on or off — what a tap on the key map does. Returns the new map. */
export function toggleCell(grid: BlockGrid, index: number): boolean[] {
  const on = [...grid.on];
  if (index >= 0 && index < on.length) on[index] = !on[index];
  // A body needs at least one key; the last one cannot be switched off.
  if (!on.some(Boolean)) on[index] = true;
  return on;
}

/**
 * Resize a grid, keeping every cell that is still inside it where it was. New cells come in on.
 */
export function resizeCells(grid: BlockGrid, rows: number, cols: number): boolean[] {
  const r = clamp(rows, 1, GRID_MAX);
  const c = clamp(cols, 1, GRID_MAX);
  const on: boolean[] = [];
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) on.push(i < grid.rows && j < grid.cols ? grid.on[i * grid.cols + j] : true);
  }
  if (!on.some(Boolean)) on[0] = true;
  return on;
}

// ---------------------------------------------------------------------------------------------
// The state the app keeps, and what each edit does to it
// ---------------------------------------------------------------------------------------------

/** The blocks fields of the app's state. */
export interface BlockState {
  blockLayout: BlockLayout;
  blockGridRows: number;
  blockGridCols: number;
  blockCells: boolean[] | null;
  blockLines: string[];
  blockSymbols: Record<string, BlockSymbol>;
}

export function arrangementOf(s: BlockState): BlockArrangement {
  return arrangeBlocks(s.blockLayout, s.blockGridRows, s.blockGridCols, s.blockCells, s.blockLines, s.blockSymbols);
}

/** The lines a grid arrangement prints, one per row: each key's character, a blank key as a
 *  space, trailing blanks dropped (a missing character IS a blank key). */
function linesOf(a: BlockArrangement): string[] {
  const out: string[] = [];
  for (let r = 0; r < a.grid.rows; r++) {
    let line = '';
    for (let c = 0; c < a.grid.cols; c++) {
      const ch = a.chars[r * a.grid.cols + c];
      if (ch !== null && ch !== undefined) line += ch;
    }
    out.push(line.replace(/\s+$/u, ''));
  }
  return out;
}

/**
 * Pick another arrangement. What is on the keys follows sensibly: a row and a column trade their
 * line, and a grid's rows run together into one; Custom starts as whatever is on screen, so taking
 * keys away starts from it; Grid keeps a Custom map's keys; WASD and Arrows bring their own keys.
 */
export function changeLayout(s: BlockState, layout: BlockLayout): Partial<BlockState> {
  const from = arrangementOf(s);
  if (isLineLayout(layout)) {
    const line = isLineLayout(s.blockLayout) ? (s.blockLines[0] ?? '') : linesOf(from).join('').replace(/\s+/gu, '');
    return { blockLayout: layout, blockLines: [line], blockCells: null };
  }
  if (layout === 'custom') {
    return {
      blockLayout: 'custom',
      blockGridRows: from.grid.rows,
      blockGridCols: from.grid.cols,
      blockCells: [...from.grid.on],
      blockLines: linesOf(from),
    };
  }
  if (layout === 'grid' && s.blockLayout === 'custom') {
    return { blockLayout: 'grid', blockCells: null };
  }
  const p = presetText(layout, s.blockGridRows, s.blockGridCols);
  return { blockLayout: layout, blockLines: p.lines, blockSymbols: { ...s.blockSymbols, ...p.symbols }, blockCells: null };
}

/**
 * A tap on the key map: add a key to an empty cell, or take a key away. Any arrangement becomes
 * Custom. Every key keeps what is printed on it, and a new key starts blank.
 */
export function toggleKey(s: BlockState, index: number): Partial<BlockState> {
  const from = arrangementOf(s);
  const on = toggleCell(from.grid, index);
  const lines: string[] = [];
  for (let r = 0; r < from.grid.rows; r++) {
    let line = '';
    for (let c = 0; c < from.grid.cols; c++) {
      const i = r * from.grid.cols + c;
      if (on[i]) line += from.keys[i] ? (from.chars[i] ?? ' ') : ' ';
    }
    lines.push(line.replace(/\s+$/u, ''));
  }
  return {
    blockLayout: 'custom',
    blockGridRows: from.grid.rows,
    blockGridCols: from.grid.cols,
    blockCells: on,
    blockLines: lines,
  };
}

/** The build's view of the blocks: where the keys are and how the body looks. */
export function blockBuildParams(s: BlockState & { blockStyle: BlockStyle; blockTexture: BlockTexture }) {
  const a = arrangementOf(s);
  return {
    blockOrientation: a.orientation,
    blockColumns: a.columns,
    blockKeys: a.keys,
    blockStyle: s.blockStyle,
    blockTexture: s.blockTexture,
  };
}

/** The traced symbols, by character, for `parseBlockChain`: their rings turned and mirrored
 *  as their inspector says, and the size and offset the build applies on the cap. */
export function tracedSymbols(
  symbols: Readonly<Record<string, BlockSymbol>>,
): Record<string, { rings: [number, number][][]; legend: { scale: number; dx: number; dy: number } }> {
  const out: Record<string, { rings: [number, number][][]; legend: { scale: number; dx: number; dy: number } }> = {};
  for (const [ch, sym] of Object.entries(symbols)) {
    if (sym.kind !== 'rings') continue;
    const look = lookOf(sym);
    out[ch] = { rings: lookRings(sym.rings, look), legend: { scale: look.scale, dx: look.dx, dy: look.dy } };
  }
  return out;
}

/** The symbols a line of Text mode carries, for `parseLetter`: their rings and their look. */
export function lineSymbols(
  symbols: Readonly<Record<string, BlockSymbol>>,
): Record<string, { rings: [number, number][][]; look: SymbolLook }> {
  const out: Record<string, { rings: [number, number][][]; look: SymbolLook }> = {};
  for (const [ch, sym] of Object.entries(symbols)) if (sym.kind === 'rings') out[ch] = { rings: sym.rings, look: lookOf(sym) };
  return out;
}

/** The symbols the lines still hold: one whose character was typed away goes. The same map
 *  back when none did, so a keystroke with no symbol in it changes nothing in the store. */
export function pruneSymbols(
  symbols: Readonly<Record<string, BlockSymbol>>,
  lines: readonly string[],
): Record<string, BlockSymbol> {
  const text = lines.join('');
  const keep = Object.keys(symbols).filter((ch) => text.includes(ch));
  if (keep.length === Object.keys(symbols).length) return symbols as Record<string, BlockSymbol>;
  return Object.fromEntries(keep.map((ch) => [ch, symbols[ch]!]));
}

/** A saved map of symbols, checked: a character that is not a symbol, or an entry that is not
 *  a Lucide name or a list of rings, is left out. Undefined when there is no map at all. */
export function loadedSymbols(raw: unknown): Record<string, BlockSymbol> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const syms: Record<string, BlockSymbol> = {};
  for (const [ch, v] of Object.entries(raw as Record<string, any>)) {
    if (!isSymbolChar(ch) || !v || typeof v !== 'object') continue;
    const look = lookOf(v);
    const pair = typeof v.pair === 'string' && isSymbolChar(v.pair) ? { pair: v.pair as string } : {};
    if (v.kind === 'lucide' && typeof v.name === 'string') {
      syms[ch] = { kind: 'lucide', name: v.name, ...(typeof v.label === 'string' ? { label: v.label } : {}), ...look, ...pair };
    } else if (
      v.kind === 'rings' && typeof v.label === 'string' && Array.isArray(v.rings)
      && v.rings.every((r: unknown) => Array.isArray(r)
        && r.every((pt: unknown) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite)))
    ) {
      syms[ch] = { kind: 'rings', label: v.label, rings: v.rings, ...look, ...pair };
    }
  }
  return syms;
}

const LAYOUTS: readonly BlockLayout[] = ['row', 'column', 'grid', 'wasd', 'arrows', 'custom'];
const STYLES: readonly BlockStyle[] = ['walls', 'open'];
const TEXTURES: readonly BlockTexture[] = ['smooth', 'knurl', 'ribs', 'flutes', 'dots', 'chevron'];

/** What a saved project may set for blocks. */
export type LoadedBlocks = Partial<BlockState & {
  blockStyle: BlockStyle;
  blockTexture: BlockTexture;
  legendScale: number;
  legendBold: number;
}>;

/** The blocks fields of a saved project, checked; anything missing or malformed is left out so
 *  the app's own default stands. A project from before blocks were saved has none of them. */
export function loadedBlocks(set: Record<string, unknown>): LoadedBlocks {
  const out: LoadedBlocks = {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (LAYOUTS.includes(set.blockLayout as BlockLayout)) out.blockLayout = set.blockLayout as BlockLayout;
  const rows = num(set.blockGridRows);
  const cols = num(set.blockGridCols);
  if (rows) out.blockGridRows = Math.max(1, Math.min(GRID_MAX, Math.round(rows)));
  if (cols) out.blockGridCols = Math.max(1, Math.min(GRID_MAX, Math.round(cols)));
  if (Array.isArray(set.blockCells) && set.blockCells.every((v) => typeof v === 'boolean')) {
    out.blockCells = set.blockCells as boolean[];
  }
  if (Array.isArray(set.blockLines) && set.blockLines.every((v) => typeof v === 'string')) {
    out.blockLines = set.blockLines as string[];
  }
  const syms = loadedSymbols(set.blockSymbols);
  if (syms) out.blockSymbols = syms;
  if (STYLES.includes(set.blockStyle as BlockStyle)) out.blockStyle = set.blockStyle as BlockStyle;
  if (TEXTURES.includes(set.blockTexture as BlockTexture)) out.blockTexture = set.blockTexture as BlockTexture;
  const scale = num(set.legendScale);
  const bold = num(set.legendBold);
  if (scale !== undefined) out.legendScale = Math.max(0.4, Math.min(1.6, scale));
  if (bold !== undefined) out.legendBold = Math.max(-0.35, Math.min(0.9, bold));
  return out;
}
