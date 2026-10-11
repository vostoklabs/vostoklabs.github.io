// The full alphabet set: its one type size, the 26 caps laid out in a grid on one plate, each cap
// its own slicer object, and the carver that fills it a letter at a time. No DOM and no app state:
// the window that shows the plate is alphabetDialog.js, and the export that writes it is exports.js.
import { packShelf } from '@vostok/plates';
import { xyBounds } from '@vostok/export';
import { typeScale, placeLegend } from './legendSize.js';

/** Kept clear at the plate's edges, and between two caps: the shelf packer's own defaults. */
export const SET_MARGIN_MM = 6;
export const SET_GAP_MM = 3;

/** How many caps a row: about square, and of the two nearest counts the one whose last row is
 *  fuller (26 is four rows of seven, A–G to V–Z, rather than five of six with two left over). */
export function setColumns(count) {
  const c = Math.max(1, Math.ceil(Math.sqrt(count)));
  const empty = (k) => Math.ceil(count / k) * k - count;
  return empty(c + 1) < empty(c) ? c + 1 : c;
}

/**
 * The set's one type size: every letter set as type (legendSize.js `typeScale`), so every capital
 * is `capHeightMM` tall and every letter sits on one baseline, its cap-height band on the middle
 * of its cap; a small letter comes out at the capitals' scale, an x-height letter smaller than an
 * ascender, a descender hanging below the line. A letter that would not fit its cap at that size
 * (the widest capital, a long descender) shrinks the whole set with it, never itself alone, or
 * the set would read as letters cut from different typefaces.
 *
 * @param {Iterable<[string, object]>} legends  each letter and its parsed legend (parseLetter):
 *        every letter the set may carve, both cases, so the two share one size
 * @param {{ topExtent: [number, number] }} meta  the cap
 * @param {number} capHeightMM  how tall a capital is asked to be
 * @param {number} [rotationDeg]  the legend's rotation, which turns the baseline nudge
 * @returns {{ capHeightMM: number, fit: number, limit: string|null,
 *            places: Map<string, {widthMM: number, dx: number, dy: number}> }}
 *          the size the capitals come out at, the share of the asked size that is (1 when it all
 *          fits), the letter that set it, and each letter's size and nudge for the carve
 */
export function setTypeSize(legends, meta, capHeightMM, rotationDeg = 0) {
  const all = [...legends];
  let fit = 1;
  let limit = null;
  for (const [letter, legend] of all) {
    const { unit, anchorY } = typeScale(legend, capHeightMM);
    const place = placeLegend(legend, meta, unit, anchorY, rotationDeg);
    if (place && place.fit < fit) {
      fit = place.fit;
      limit = letter;
    }
  }
  const size = capHeightMM * fit;
  const places = new Map();
  for (const [letter, legend] of all) {
    const { unit, anchorY } = typeScale(legend, size);
    // Measured above: the set's fit is the only shrink, so no letter is clamped again on its own.
    const place = placeLegend(legend, meta, unit, anchorY, rotationDeg, Infinity);
    if (place) places.set(letter, place);
  }
  return { capHeightMM: size, fit, limit, places };
}

/**
 * Both cases' type sizes. The capitals are as tall as asked, or as the widest of them allows; the
 * small letters are set at the capitals' scale, so they read as the same typeface, and only shrink
 * below it (all together) when a descender or an ascender would not fit at that scale. A case
 * the font cannot write is left out (null).
 *
 * @param {{ upper?: Iterable<[string, object]>|null, lower?: Iterable<[string, object]>|null }} legends
 * @returns {{ upper: ReturnType<typeof setTypeSize>|null, lower: ReturnType<typeof setTypeSize>|null }}
 */
export function setTypeSizes(legends, meta, capHeightMM, rotationDeg = 0) {
  const upper = legends.upper ? setTypeSize(legends.upper, meta, capHeightMM, rotationDeg) : null;
  const lower = legends.lower ? setTypeSize(legends.lower, meta, upper?.capHeightMM ?? capHeightMM, rotationDeg) : null;
  return { upper, lower };
}

/** The footprint the parts take on the plate, as they lie: their XY box and its size. */
export function footprintOf(parts) {
  const box = xyBounds(parts.map((p) => p.geom.getAttribute('position').array));
  return { ...box, w: box.maxX - box.minX, d: box.maxY - box.minY };
}

/**
 * Where each of `count` caps of one footprint goes: a block `setColumns` wide, packed row by row
 * by the shelf's plate packer into a rectangle the block's own width (so the rows stay a grid
 * instead of running the width of a big plate), then centred on the origin, which is where the
 * 3MF writer and the MakerLab plate both put the middle of the bed. A block too wide for the plate
 * takes as many caps a row as the plate holds; `plates` above 1 means even that does not fit.
 *
 * @param {number} count
 * @param {{w: number, d: number}} footprint  one cap, in mm
 * @param {[number, number]} plate  the bed, in mm
 * @returns {{ slots: {x: number, y: number}[], columns: number, rows: number, plates: number,
 *            size: [number, number] }}  `slots`: each cap's min corner, in order
 */
export function setLayout(count, footprint, plate) {
  const { w, d } = footprint;
  const fit = Math.max(1, Math.floor((plate[0] - 2 * SET_MARGIN_MM + SET_GAP_MM) / (w + SET_GAP_MM)));
  const tries = [Math.min(setColumns(count), fit), fit];
  let placed = null;
  let columns = 0;
  for (const cols of tries) {
    columns = cols;
    const blockW = cols * w + (cols - 1) * SET_GAP_MM;
    placed = packShelf(Array.from({ length: count }, () => ({ w, d })), {
      // A hair over the block, so a rounding error never wraps the last cap of a row.
      plate: [blockW + 2 * SET_MARGIN_MM + 1e-6, plate[1]],
      margin: SET_MARGIN_MM,
      gap: SET_GAP_MM,
    });
    if (placed.every((p) => p.plate === 0)) break;
  }
  const plates = Math.max(1, ...placed.map((p) => p.plate + 1));
  const minX = Math.min(...placed.map((p) => p.x));
  const maxX = Math.max(...placed.map((p) => p.x + w));
  const minY = Math.min(...placed.map((p) => p.y));
  const maxY = Math.max(...placed.map((p) => p.y + d));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    slots: placed.map((p) => ({ x: p.x - cx, y: p.y - cy })),
    columns,
    rows: Math.ceil(count / columns),
    plates,
    size: [maxX - minX, maxY - minY],
  };
}

/**
 * One cap moved to its slot, as the set's file takes it. Each part is a copy (the parts handed in
 * can be the live preview's stem), named for its letter ("Keycap A"), and grouped by it, so the
 * cap is one slicer object, "A", with its parts on the filament slots the single cap uses.
 *
 * @param {Array<{name: string, geom: THREE.BufferGeometry}>} parts  one cap, laid out to print
 * @param {{x: number, y: number}} slot  where the footprint's min corner goes
 * @param {{minX: number, minY: number}} origin  the footprint's min corner as the cap lies: every
 *        cap is moved by the same amount, so the caps line up whatever their legends
 */
export function placeCap(parts, letter, slot, origin) {
  const dx = slot.x - origin.minX;
  const dy = slot.y - origin.minY;
  return parts.map((p) => ({ ...p, name: `${p.name} ${letter}`, group: letter, geom: p.geom.clone().translate(dx, dy, 0) }));
}

/**
 * Carves a set a letter at a time, for whichever case is wanted, and keeps what it carved:
 * changing the case while one is carving parks it where it got to, and changing back carries on
 * from there. It yields to the page between letters, so a window showing it keeps painting.
 *
 * @param {object} deps
 * @param {(letterCase: string) => string} deps.letters  the letters of a case, in order
 * @param {(letter: string, index: number) => Promise<object[]>} deps.carve  one placed cap's parts
 * @param {() => void} [deps.onChange]  after every letter carved, every case change, an error and
 *        the stop
 */
export function createSetCarver({ letters, carve, onChange }) {
  /** @type {Map<string, {letters: string, caps: {letter: string, parts: object[]}[], error: unknown}>} */
  const jobs = new Map();
  const waiters = new Set();
  let wanted = null;
  let running = null;
  let stopped = false;

  const jobOf = (c) => {
    if (!jobs.has(c)) jobs.set(c, { letters: letters(c), caps: [], error: null });
    return jobs.get(c);
  };
  const finished = (job) => !!job.error || job.caps.length === job.letters.length;
  const changed = () => {
    for (const w of [...waiters]) w();
    // What a window or a status line does with the news is never a reason to stop carving.
    try {
      onChange?.();
    } catch (err) {
      console.error(err);
    }
  };

  async function pump() {
    while (!stopped && wanted !== null && !finished(jobOf(wanted))) {
      const c = wanted;
      // A frame for the page, and the moment a case change or a stop is seen.
      await new Promise((r) => setTimeout(r, 0));
      if (stopped || c !== wanted) continue;
      const job = jobOf(c);
      const i = job.caps.length;
      try {
        job.caps.push({ letter: job.letters[i], parts: await carve(job.letters[i], i) });
      } catch (err) {
        job.error = err;
      }
      changed();
    }
  }
  function kick() {
    if (running || stopped || wanted === null || finished(jobOf(wanted))) return;
    running = pump().finally(() => {
      running = null;
      kick(); // the case may have changed as the last letter landed
    });
  }

  return {
    /** Carve this case next (and keep the other where it got to). */
    want(letterCase) {
      wanted = letterCase;
      changed();
      kick();
    },
    /** Is a letter being carved, or about to be? */
    get busy() { return running !== null; },
    /** What one case has: the caps carved so far, how many it needs, and what stopped it. */
    progress(letterCase) {
      const job = jobOf(letterCase);
      return { caps: job.caps, done: job.caps.length, total: job.letters.length, error: job.error, next: job.letters[job.caps.length] ?? null };
    },
    /** The case's caps once every letter is carved; null if the carver is stopped first. Rejects
     *  with the error a letter could not be carved for. */
    whenReady(letterCase) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const job = jobOf(letterCase);
          if (!job.error && job.caps.length < job.letters.length && !stopped) return;
          waiters.delete(check);
          if (job.error) reject(job.error);
          else resolve(job.caps.length === job.letters.length ? job.caps : null);
        };
        waiters.add(check);
        check();
      });
    },
    /** Stop after the letter being carved, and hand back every cap carved, of either case. */
    async stop() {
      stopped = true;
      changed();
      await running;
      const caps = [...jobs.values()].flatMap((job) => job.caps);
      jobs.clear();
      return caps;
    },
  };
}
