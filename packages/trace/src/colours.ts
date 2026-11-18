// The colour finder: every colour a picture is drawn in, for the list a person picks filaments
// from. Pure: no DOM, nothing but the pixels.
//
// `discoverColours` asks the quantiser for twelve clusters and folds what is close. The quantiser
// seeds by median cut, which splits by how many pixels a colour has, not by how different it is,
// so a small colour that sits inside a big colour's box is never its own cluster: a cat's two
// green eyes (2.9 % of it) were missing from the list at every cluster count. This finder reads
// the picture's own histogram instead, so a colour is found because it is different, whatever
// its size.
import type { RgbaImage } from './decode';
import { prepareArtwork } from './edits';
import { closestPairMapping, type ColourCandidate, type PictureChanges } from './pipeline';
import { srgbToOklab } from './colorspace';
import type { RGB } from './types';

/** The most colours a picture opens with when each is its own filament: flat art up to this
 *  many opens with every colour it has. */
export const FLAT_ART_MAX = 5;
/** What a picture with more colours than `FLAT_ART_MAX` opens at: most AMS units hold four. */
export const AMS_FILAMENTS = 4;
/** The longest colour list, and the most filaments a picture can be split into. */
export const LIST_MAX = 12;

/*
  The leader tolerance at each detail, in Oklab. Detail 0 is the quantiser's own merge distance
  (MERGE_TOL, 0.04): what is closer than that is one colour to anyone looking at a print. Each
  step up splits finer, for a picture whose colours are shaded; past the last step there is
  nothing finer to ask for, so a higher detail gives what the last one gives.
*/
const DETAIL_TOL = [0.04, 0.03, 0.022, 0.016];
/** The highest detail that can split finer than the one below it. */
export const DETAIL_MAX = DETAIL_TOL.length - 1;
/* Eight sRGB steps on every channel is one colour at every detail. Oklab's lightness is a cube
   root, so near black a step of five is already 0.11 apart; no filament pair can show that
   difference (the quantiser's MERGE_RGB, for the same reason). */
const SAME_RGB = 8;
/* A pixel is flat when all four neighbours are within this of it (the quantiser's EDGE_GRAD).
   Only flat pixels are counted, so an anti-aliased edge between two colours, which is a run of
   blends one or two pixels wide, never lists its blends. */
const FLAT_STEP = 0.04;
/* Under this share of flat pixels the picture is a photograph, edges everywhere, and every pixel
   is counted (the quantiser's MIN_FLAT_FRACTION). */
const MIN_FLAT = 0.25;
/* Opaque enough to be part of the artwork. */
const OPAQUE = 128;
/* Below this share a colour found at detail 0 is debris: measured on a heart's anti-aliased
   edge, 0.0 to 0.1 %, while its smallest real colour (the cheeks) was 1.7 %. */
const MIN_SHARE = 0.001;
/* A colour this small that lies within BLEND_NEAR of the line between two bigger ones is a blend
   of the two (a JPEG's soft edge), not a colour: its share goes to the nearest one kept. */
const BLEND_SHARE = 0.01;
const BLEND_NEAR = 0.05;
/* A colour a finer detail splits off counts only from this share of the picture, so noise in a
   flat colour never becomes a filament. */
const FINER_MIN_SHARE = 0.005;

/** How many filaments a picture opens with: flat art every colour it has, up to `FLAT_ART_MAX`;
 *  more than that, `AMS_FILAMENTS`, the closest merged first. */
export function defaultFilaments(colours: readonly ColourCandidate[]): number {
  return colours.length <= FLAT_ART_MAX ? Math.max(1, colours.length) : AMS_FILAMENTS;
}

type Lab = [number, number, number];
const labDist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sameRgb = (a: RGB, b: RGB) =>
  Math.abs(a[0] - b[0]) <= SAME_RGB && Math.abs(a[1] - b[1]) <= SAME_RGB && Math.abs(a[2] - b[2]) <= SAME_RGB;
/** The centre of a 5-bit-per-channel bin. */
const binRgb = (k: number): RGB => [((k >> 10) << 3) + 4, (((k >> 5) & 31) << 3) + 4, ((k & 31) << 3) + 4];

interface Found { rgb: RGB; lab: Lab; n: number }

/**
 * Every colour the picture is drawn in, biggest first, at most `LIST_MAX`.
 *
 * The same preparation as `processImage` (the background removed, then `picture`'s edits and
 * crop, then the soft edges and specks cleaned), so a colour the customer took out or cropped
 * away is not listed. Then the flat pixels are binned and grouped round the most common colours:
 * each bin, most common first, joins the nearest colour already found if it is the same colour,
 * and is a new colour if not. Debris and the blends of a soft edge are dropped.
 *
 * `detail` 0 is the list a picture opens with. Each step up splits finer (a tighter tolerance),
 * and a finer colour counts only from 0.5 % of the picture. The colours at a higher detail always
 * contain those at a lower one, so a choice made for a colour still has its colour; when a step
 * finds nothing more, the picture has no finer colour. `coverage` is the share of the pixels
 * counted. `img` is not changed.
 */
export function findColours(img: RgbaImage, removeBg = true, picture: PictureChanges = {}, detail = 0): ColourCandidate[] {
  const work: RgbaImage = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  prepareArtwork(work, { removeBg, edits: picture.edits, crop: picture.crop });
  const { data, width: W, height: H } = work;
  const n = W * H;

  // The bin of every opaque pixel, and the Oklab of each bin's centre.
  const key = new Int32Array(n).fill(-1);
  const binLab = new Map<number, Lab>();
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] < OPAQUE) continue;
    const k = ((data[p * 4] >> 3) << 10) | ((data[p * 4 + 1] >> 3) << 5) | (data[p * 4 + 2] >> 3);
    key[p] = k;
    if (!binLab.has(k)) binLab.set(k, srgbToOklab(binRgb(k)));
  }

  // Count flat pixels only, unless the picture is too little flat to be drawn art.
  const flat = new Uint8Array(n);
  let fg = 0, flatCount = 0;
  for (let p = 0; p < n; p++) {
    if (key[p] < 0) continue;
    fg++;
    const x = p % W, y = (p / W) | 0;
    const l = binLab.get(key[p])!;
    let ok = true;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (q < 0) continue;
      if (key[q] < 0 || (key[q] !== key[p] && labDist(l, binLab.get(key[q])!) > FLAT_STEP)) { ok = false; break; }
    }
    if (ok) { flat[p] = 1; flatCount++; }
  }
  if (fg === 0) return [];
  const flatOnly = flatCount >= fg * MIN_FLAT;

  // Each bin's pixel count and colour sum, over the pixels counted.
  const count = new Map<number, { n: number; r: number; g: number; b: number }>();
  let used = 0;
  for (let p = 0; p < n; p++) {
    if (key[p] < 0 || (flatOnly && !flat[p])) continue;
    used++;
    let e = count.get(key[p]);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; count.set(key[p], e); }
    e.n++; e.r += data[p * 4]; e.g += data[p * 4 + 1]; e.b += data[p * 4 + 2];
  }
  // Most common first; on a tie the lower bin, so the order never depends on the Map.
  const bins = [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);

  /** The colours found at one tolerance: each a leader bin's own mean colour, and the pixels
   *  that joined it. */
  const leaders = (tol: number): Found[] => {
    const out: (Found & { centre: RGB })[] = [];
    for (const [k, e] of bins) {
      const l = binLab.get(k)!, c = binRgb(k);
      let best = -1, bd = Infinity;
      out.forEach((f, i) => {
        const d = labDist(f.lab, l);
        if ((d <= tol || sameRgb(f.centre, c)) && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) out[best].n += e.n;
      else out.push({ rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)], lab: l, centre: c, n: e.n });
    }
    // The lab of a found colour is its own, not its bin's centre.
    return out.map((f) => ({ rgb: f.rgb, lab: srgbToOklab(f.rgb), n: f.n }));
  };

  // Detail 0: debris dropped, blends dropped, folded to the list's length.
  let list: ColourCandidate[] = leaders(DETAIL_TOL[0])
    .filter((f) => f.n >= used * MIN_SHARE)
    .sort((a, b) => b.n - a.n)
    .map((f) => ({ rgb: f.rgb, coverage: f.n / used }));
  list = dropBlends(list);
  if (list.length > LIST_MAX) list = fold(list, LIST_MAX);
  list.sort((a, b) => b.coverage - a.coverage);

  const steps = Math.min(Math.max(0, Math.floor(detail)), DETAIL_MAX);
  if (steps === 0) return list;

  // Each finer step adds the colours it finds that are not already listed, biggest first.
  const have: Found[] = list.map((c) => ({ rgb: c.rgb, lab: srgbToOklab(c.rgb), n: 0 }));
  for (let s = 1; s <= steps && have.length < LIST_MAX; s++) {
    const tol = DETAIL_TOL[s];
    const finer = leaders(tol).filter((f) => f.n >= used * FINER_MIN_SHARE).sort((a, b) => b.n - a.n);
    for (const f of finer) {
      if (have.length >= LIST_MAX) break;
      if (have.some((h) => labDist(h.lab, f.lab) <= tol || sameRgb(h.rgb, f.rgb))) continue;
      have.push({ rgb: f.rgb, lab: f.lab, n: 0 });
    }
  }
  if (have.length === list.length) return list;

  // Shares again, now that some pixels belong to a finer colour: each bin goes to the nearest.
  for (const [k, e] of bins) {
    const l = binLab.get(k)!;
    let best = 0, bd = Infinity;
    have.forEach((h, i) => { const d = labDist(h.lab, l); if (d < bd) { bd = d; best = i; } });
    have[best].n += e.n;
  }
  return have
    .map((h) => ({ rgb: h.rgb, coverage: h.n / used }))
    .sort((a, b) => b.coverage - a.coverage);
}

/** How far a colour is from the segment between two others, in Oklab. */
function toSegment(p: Lab, a: Lab, b: Lab): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / len));
  return labDist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

/** A small colour on the line between two bigger ones is their blend: it is dropped and its
 *  share goes to the nearest colour kept. `list` biggest first. */
function dropBlends(list: ColourCandidate[]): ColourCandidate[] {
  const L = list.map((c) => srgbToOklab(c.rgb));
  const drop = new Set<number>();
  list.forEach((c, i) => {
    if (c.coverage >= BLEND_SHARE) return;
    for (let a = 0; a < list.length && !drop.has(i); a++) {
      for (let b = a + 1; b < list.length; b++) {
        if (a === i || b === i || drop.has(a) || drop.has(b)) continue;
        if (list[a].coverage <= c.coverage || list[b].coverage <= c.coverage) continue;
        if (toSegment(L[i], L[a], L[b]) < BLEND_NEAR) { drop.add(i); break; }
      }
    }
  });
  if (drop.size === 0) return list;
  const kept = list.map((c, i) => ({ c: { ...c }, lab: L[i], i })).filter((k) => !drop.has(k.i));
  for (const i of drop) {
    let best = kept[0], bd = Infinity;
    for (const k of kept) { const d = labDist(k.lab, L[i]); if (d < bd) { bd = d; best = k; } }
    best.c.coverage += list[i].coverage;
  }
  return kept.map((k) => k.c);
}

/** The list folded to `max` colours, the most alike first: each group keeps its biggest colour
 *  and the shares add. `list` biggest first. */
function fold(list: ColourCandidate[], max: number): ColourCandidate[] {
  const into = closestPairMapping(list, max);
  const out: ColourCandidate[] = [];
  // Biggest first, so a group's first member is its biggest.
  list.forEach((c, i) => {
    const g = into[i];
    if (!out[g]) out[g] = { rgb: c.rgb, coverage: 0 };
    out[g].coverage += c.coverage;
  });
  return out;
}
