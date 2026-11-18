/*
  Symbols in a line of Text mode stand apart from their neighbours the way a capital letter does
  (src/image/letter.ts, parseLetter).

  A symbol has no side bearings of its own, so it used to start exactly where the letter before
  it ended its advance and be followed by a fixed sliver. A letter whose ink runs past its
  advance (an "f"'s crossbar) then touched the symbol, and two symbols side by side were close
  enough that the boldness setting bridged them. This lays out real library drawings after an
  "f" and next to each other, and holds every gap to the font's own gap between two capitals.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs text-symbols
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
import { parseSvg } from '@vostok/trace';
import catalog from '../../../packages/ui-kit/src/symbols/catalog.json';
import { parseLetter } from '../src/image/letter.ts';
import { normaliseRings, PLAIN_LOOK } from '../src/image/symbolRings.ts';
import type { Ring } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** A library drawing's rings, as the symbol picker traces them (src/ui/symbols.ts). */
function libraryRings(id: string): Ring[] {
  const entry = (catalog as { id: string; svg: string }[]).find((c) => c.id === id);
  if (!entry) throw new Error(`no library symbol ${id}`);
  return normaliseRings(parseSvg(entry.svg.replace(/currentColor/gi, '#000000'), { removeBg: false, asPainted: true }).outline as Ring[]);
}

/** The shortest distance between two sets of rings' outlines (0 when they cross). */
function gap(a: Ring[], b: Ring[]): number {
  const segDist = (p: [number, number], q: [number, number], r: [number, number]) => {
    const dx = r[0] - q[0], dy = r[1] - q[1];
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy);
  };
  let best = Infinity;
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const ring of from) for (const p of ring) for (const other of to) {
      for (let i = 0; i < other.length; i++) best = Math.min(best, segDist(p, other[i]!, other[(i + 1) % other.length]!));
    }
  }
  return best;
}

const STAR = '', BUTTERFLY = '', HEART = '';
const symbols = {
  [STAR]: { rings: libraryRings('tabler-star'), look: PLAIN_LOOK },
  [BUTTERFLY]: { rings: libraryRings('tabler-butterfly'), look: PLAIN_LOOK },
  [HEART]: { rings: libraryRings('tabler-heart'), look: PLAIN_LOOK },
};

// One line, each glyph its own region: H H f star butterfly heart H.
const rs = parseLetter(`HHf${STAR}${BUTTERFLY}${HEART}H`, 'helvetiker-regular', 30, true, {}, symbols);
const glyphs = rs.regions.map((r) => r.components[0]!.rings as Ring[]);
check('seven glyphs laid out', glyphs.length === 7, String(glyphs.length));

const capitals = gap(glyphs[0]!, glyphs[1]!);
const names = ['H', 'H', 'f', 'star', 'butterfly', 'heart', 'H'];
for (let i = 2; i < glyphs.length - 1; i++) {
  const g = gap(glyphs[i]!, glyphs[i + 1]!);
  const ratio = g / capitals;
  check(
    `${names[i]} to ${names[i + 1]}: at least the gap between two capitals, and not a word space`,
    ratio >= 0.9 && ratio <= 2,
    `${(ratio * 100).toFixed(0)} % of the capitals' gap`,
  );
}

// A symbol at the start of a line and at its end still lays out (nothing before or after it).
{
  const alone = parseLetter(`${HEART}`, 'helvetiker-regular', 30, true, {}, symbols);
  check('a symbol alone on a line', alone.regions.length === 1, String(alone.regions.length));
}

if (failures) {
  console.error(`\ntext-symbols: ${failures} failed`);
  process.exit(1);
}
console.log('\ntext-symbols: all passed');
