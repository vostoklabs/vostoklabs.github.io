// Classic crossword layout: words cross on shared letters, alternate orientation, and never
// run alongside one another. Pure and deterministic for a seed — no DOM, no fonts, no manifold —
// so the family-names ornament and the letter-tile board share one layout engine and every rule
// in here can be asserted headless (tests/node/crossword.test.mjs).
//
// The rules, in the order the solver applies them to a candidate placement:
//   1. every covered cell is empty, or holds the SAME letter (that is a crossing);
//   2. the cell immediately before the first letter and immediately after the last are empty,
//      so a word can never be read as the extension of another;
//   3. every cell beside a NEW letter — the two perpendicular neighbours — is empty, so two
//      parallel words never touch. Crossing cells are exempt: that is what a crossing is.
// Together these are what makes the grid readable: the maximal runs of two or more letters,
// read across and down, are exactly the words that were placed.

type Orientation = 'across' | 'down';
export type CrosswordPrefer = 'compact' | 'wide' | 'tall';

export interface CrosswordCell {
  row: number;
  col: number;
  char: string;
}

export interface CrosswordLayout {
  /** Every filled cell, row 0 at the top, sorted by row then column. */
  cells: CrosswordCell[];
  rows: number;
  cols: number;
  /** The normalised words that found a home, in input order. */
  placed: string[];
  /** The normalised words that never fit, in input order. */
  unplaced: string[];
  /** Cells shared by two words. */
  crossings: number;
  /** Where each placed word starts and which way it runs, normalised like `cells`. */
  placements: { word: string; row: number; col: number; dir: 'across' | 'down' }[];
}

export interface CrosswordOptions {
  /** Seeded shuffles of the word order to attempt. The best result wins. */
  tries?: number;
  prefer?: CrosswordPrefer;
  seed?: number;
}

interface Placement {
  chars: string[];
  row: number;
  col: number;
  dir: Orientation;
}

interface Board {
  grid: Map<string, string>;
  placements: Placement[];
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  crossings: number;
}

interface Candidate {
  row: number;
  col: number;
  dir: Orientation;
  crossings: number;
  rows: number;
  cols: number;
}

const LETTER = /\p{L}/u;
const key = (row: number, col: number): string => `${row},${col}`;
const step = (dir: Orientation): [number, number] => (dir === 'down' ? [1, 0] : [0, 1]);
const across = (dir: Orientation): Orientation => (dir === 'down' ? 'across' : 'down');

/** Uppercase, letters only (spaces, hyphens and punctuation go), no blanks, no duplicates. */
function normalise(words: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const word = Array.from(String(raw ?? '').toUpperCase())
      .filter((ch) => LETTER.test(ch))
      .join('');
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** mulberry32 — small, fast and identical on every platform, which is the whole point. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** Lexicographic compare of two score vectors; negative means `a` is better. */
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Crossings first, then the shape the caller asked for, then a fixed tiebreak so that two
 *  equally good placements always resolve the same way. */
function rank(c: Candidate, prefer: CrosswordPrefer): number[] {
  const area = c.rows * c.cols;
  const shape =
    prefer === 'wide' ? [c.rows, area] : prefer === 'tall' ? [c.cols, area] : [area, Math.abs(c.rows - c.cols)];
  return [-c.crossings, ...shape, c.row, c.col, c.dir === 'across' ? 0 : 1];
}

/** How many crossings this placement would make, or null if it breaks a rule. */
function legal(board: Board, chars: string[], row: number, col: number, dir: Orientation): number | null {
  const [dr, dc] = step(dir);
  // Rule 2: the word must not extend, or be extended by, another.
  if (board.grid.has(key(row - dr, col - dc))) return null;
  if (board.grid.has(key(row + dr * chars.length, col + dc * chars.length))) return null;
  let crossings = 0;
  for (let i = 0; i < chars.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const at = board.grid.get(key(r, c));
    if (at !== undefined) {
      // Rule 1: a shared cell must be the same letter.
      if (at !== chars[i]) return null;
      crossings++;
      continue;
    }
    // Rule 3: a new letter may not sit beside anything. (dc, dr) swapped is the perpendicular.
    if (board.grid.has(key(r - dc, c - dr)) || board.grid.has(key(r + dc, c + dr))) return null;
  }
  return crossings;
}

function commit(board: Board, chars: string[], row: number, col: number, dir: Orientation, crossings: number): void {
  const [dr, dc] = step(dir);
  for (let i = 0; i < chars.length; i++) board.grid.set(key(row + dr * i, col + dc * i), chars[i]!);
  board.placements.push({ chars, row, col, dir });
  board.crossings += crossings;
  board.minRow = Math.min(board.minRow, row);
  board.maxRow = Math.max(board.maxRow, row + dr * (chars.length - 1));
  board.minCol = Math.min(board.minCol, col);
  board.maxCol = Math.max(board.maxCol, col + dc * (chars.length - 1));
}

/** The best legal placement of `chars` crossing something already on the board. */
function bestPlacement(board: Board, chars: string[], prefer: CrosswordPrefer): Candidate | null {
  let best: Candidate | null = null;
  let bestRank: number[] = [];
  for (const p of board.placements) {
    const dir = across(p.dir);
    const [pdr, pdc] = step(p.dir);
    const [dr, dc] = step(dir);
    for (let j = 0; j < p.chars.length; j++) {
      const cellRow = p.row + pdr * j;
      const cellCol = p.col + pdc * j;
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== p.chars[j]) continue;
        const row = cellRow - dr * i;
        const col = cellCol - dc * i;
        const crossings = legal(board, chars, row, col, dir);
        if (crossings === null || crossings === 0) continue;
        const candidate: Candidate = {
          row,
          col,
          dir,
          crossings,
          rows: Math.max(board.maxRow, row + dr * (chars.length - 1)) - Math.min(board.minRow, row) + 1,
          cols: Math.max(board.maxCol, col + dc * (chars.length - 1)) - Math.min(board.minCol, col) + 1,
        };
        const r = rank(candidate, prefer);
        if (!best || cmp(r, bestRank) < 0) {
          best = candidate;
          bestRank = r;
        }
      }
    }
  }
  return best;
}

/** One attempt: seed the grid with `order[0]` across, then cross the rest in. */
function attempt(order: string[], prefer: CrosswordPrefer): { board: Board; placed: Set<string> } {
  const first = order[0]!;
  const board: Board = {
    grid: new Map(),
    placements: [],
    minRow: 0,
    maxRow: 0,
    minCol: 0,
    maxCol: 0,
    crossings: 0,
  };
  commit(board, Array.from(first), 0, 0, 'across', 0);
  const placed = new Set<string>([first]);
  // Two passes: a word that found no crossing early can fit once the grid has grown.
  let pending = order.slice(1);
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const failed: string[] = [];
    for (const word of pending) {
      const chars = Array.from(word);
      const spot = bestPlacement(board, chars, prefer);
      if (!spot) {
        failed.push(word);
        continue;
      }
      commit(board, chars, spot.row, spot.col, spot.dir, spot.crossings);
      placed.add(word);
    }
    if (failed.length === pending.length) break;
    pending = failed;
  }
  return { board, placed };
}

/**
 * Lay `words` out as a crossword. Deterministic: the same words, seed and options always give
 * the same grid.
 *
 * `tries` attempts are made. Try 0 takes the words longest-first; later tries keep the longest
 * word leading — it is the one placed horizontally, and a long spine is what the rest hang off —
 * and shuffle the others with the seed. The best result wins: most words placed, then most
 * crossings, then the smallest grid, then whichever is closest to the shape `prefer` asks for.
 */
export function layoutCrossword(words: string[], opts: CrosswordOptions = {}): CrosswordLayout {
  const list = normalise(words);
  if (!list.length) return { cells: [], rows: 0, cols: 0, placed: [], unplaced: [], crossings: 0, placements: [] };

  const tries = Math.max(1, Math.floor(opts.tries ?? 24));
  const prefer = opts.prefer ?? 'compact';
  const seed = opts.seed ?? 1;

  // The longest word leads every attempt; ties keep input order, so this is stable.
  const byLength = list.map((w, i) => ({ w, i })).sort((a, b) => Array.from(b.w).length - Array.from(a.w).length || a.i - b.i).map((e) => e.w);
  const lead = byLength[0]!;
  const rest = byLength.slice(1);

  let best: { board: Board; placed: Set<string> } | null = null;
  let bestScore: number[] = [];
  for (let t = 0; t < tries; t++) {
    const order = t === 0 ? byLength : [lead, ...shuffled(rest, rng(seed * 0x9e3779b1 + t * 0x85ebca6b))];
    const run = attempt(order, prefer);
    const rows = run.board.maxRow - run.board.minRow + 1;
    const cols = run.board.maxCol - run.board.minCol + 1;
    // Names placed and crossings always come first — a grid that crosses more is a better
    // crossword than a grid that is the right silhouette. After that the asked-for shape
    // outranks AREA, which is what makes Wide and Tall do something: with area first, the
    // smallest grid won every time and a name set with one clearly-best interlock (the
    // shipped five) gave the identical board for all three settings. Compact is unchanged —
    // smallest, then squarest.
    const score = prefer === 'wide'
      ? [-run.placed.size, -run.board.crossings, rows, rows * cols]
      : prefer === 'tall'
        ? [-run.placed.size, -run.board.crossings, cols, rows * cols]
        : [-run.placed.size, -run.board.crossings, rows * cols, Math.abs(rows - cols)];
    if (!best || cmp(score, bestScore) < 0) {
      best = run;
      bestScore = score;
    }
  }

  const { board, placed } = best!;
  const cells: CrosswordCell[] = [...board.grid.entries()]
    .map(([k, char]) => {
      const [r, c] = k.split(',');
      return { row: Number(r) - board.minRow, col: Number(c) - board.minCol, char };
    })
    .sort((a, b) => a.row - b.row || a.col - b.col);

  return {
    cells,
    rows: board.maxRow - board.minRow + 1,
    cols: board.maxCol - board.minCol + 1,
    placed: list.filter((w) => placed.has(w)),
    unplaced: list.filter((w) => !placed.has(w)),
    crossings: board.crossings,
    placements: board.placements.map((p) => ({ word: p.chars.join(''), row: p.row - board.minRow, col: p.col - board.minCol, dir: p.dir === 'across' ? 'across' : 'down' })),
  };
}

/**
 * Grid cells → millimetres for the geometry: row 0 at the TOP (Y up, so y falls as row rises),
 * `pitch` mm between cell centres, the whole grid centred on the origin.
 */
export function crosswordCells(layout: CrosswordLayout, pitch: number): { x: number; y: number; char: string }[] {
  const x0 = -((layout.cols - 1) * pitch) / 2;
  const y0 = ((layout.rows - 1) * pitch) / 2;
  return layout.cells.map((c) => ({ x: x0 + c.col * pitch, y: y0 - c.row * pitch, char: c.char }));
}
