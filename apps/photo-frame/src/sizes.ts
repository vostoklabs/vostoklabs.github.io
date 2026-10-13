// The prints a frame, holder or plaque can take, and the limits each product and stand puts on
// them. Pure data and arithmetic: the screen, the worker and the node test all read it.
//
// The pocket of every stock size is made for its LARGER variant, so both the inch and the
// centimetre print fit: 4 × 6 in is 101.6 × 152.4 and 10 × 15 cm is 100 × 150, so the pocket is
// made for 101.6 × 152.4. Film sizes are the card itself.

export type Product = 'frame' | 'holder' | 'music';
export type Stand = 'base' | 'foot' | 'magnets' | 'keychain';
export type PhotoId = 'mini' | 'isq' | 'iwide' | '2x3' | '3.5x5' | '4x6' | 'a6' | '5x7' | 'a5' | 'custom';
export type Orientation = 'portrait' | 'landscape';

/** Where the picture sits on an instant print: its size and the white margins round it. */
export interface FilmImage {
  iw: number;
  ih: number;
  side: number;
  top: number;
  bottom: number;
}

export interface PhotoSize {
  id: PhotoId;
  /** The dropdown's words. All the size names live here, so renaming one is a one-line change. */
  label: string;
  /** What the status line calls it: "Holds an Instant mini print". */
  name: string;
  /** The print, portrait (short side first), mm. Custom has none. */
  size: [number, number] | null;
  /** Film has one way up and a picture inside a white border. */
  film: FilmImage | null;
}

export const PHOTO_SIZES: readonly PhotoSize[] = [
  { id: 'mini', label: 'Instant mini · 54 × 86 mm', name: 'Instant mini', size: [54, 86], film: { iw: 46, ih: 62, side: 4, top: 8, bottom: 16 } },
  { id: 'isq', label: 'Instant square · 72 × 86 mm', name: 'Instant square', size: [72, 86], film: { iw: 62, ih: 62, side: 5, top: 8, bottom: 16 } },
  // Wide is landscape by nature: 108 across, 86 up.
  { id: 'iwide', label: 'Instant wide · 108 × 86 mm', name: 'Instant wide', size: [108, 86], film: { iw: 99, ih: 62, side: 4.5, top: 8, bottom: 16 } },
  { id: '2x3', label: '2 × 3 in', name: '2 × 3 in', size: [50.8, 76.2], film: null },
  { id: '3.5x5', label: '3.5 × 5 in · 9 × 13 cm', name: '3.5 × 5 in', size: [90, 130], film: null },
  { id: '4x6', label: '4 × 6 in · 10 × 15 cm', name: '4 × 6 in', size: [101.6, 152.4], film: null },
  { id: 'a6', label: 'A6 · 105 × 148 mm', name: 'A6', size: [105, 148], film: null },
  { id: '5x7', label: '5 × 7 in · 13 × 18 cm', name: '5 × 7 in', size: [130, 180], film: null },
  { id: 'a5', label: 'A5 · 148 × 210 mm', name: 'A5', size: [148, 210], film: null },
  { id: 'custom', label: 'Custom size', name: 'Custom', size: null, film: null },
];

export const photoById = (id: string): PhotoSize => PHOTO_SIZES.find((p) => p.id === id) ?? PHOTO_SIZES[0]!;

/** The sizes each product offers, in the dropdown's order. */
export const SIZES_FOR: Record<Product, readonly PhotoId[]> = {
  frame: ['mini', 'isq', 'iwide', '2x3', '3.5x5', '4x6', 'a6', '5x7', 'a5', 'custom'],
  music: ['mini', 'isq', 'iwide', '2x3', '3.5x5', '4x6', 'a6', 'custom'],
  holder: ['mini', 'isq', 'iwide', '2x3', '3.5x5', 'custom'],
};

/** The biggest print a product takes, short side then long side, mm: the Custom sliders' ends. */
export const CUSTOM_CAP: Record<Product, [number, number]> = {
  frame: [148, 210],
  music: [105, 152.4],
  holder: [90, 130],
};

/** The smallest print anything is made for, mm. */
export const CUSTOM_MIN = 30;

/** Magnets hold a frame up to a 4 × 6 in or A6 print; above it the frame passes about 60 g. */
export const MAGNET_CAP: [number, number] = [105, 152.4];
/** A frame hangs from a key ring only while the print's long side is at most this, mm. */
export const KEYCHAIN_LONG_SIDE = 90;

export interface PrintSettings {
  photo: PhotoId;
  orientation: Orientation;
  customWidth: number;
  customHeight: number;
}

/** Where the picture sits on an instant print as it stands in the frame: its size and the white
 *  margin on each side, mm. Turned on its side, the wide margin is at the right. */
export interface StandingFilm {
  iw: number;
  ih: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The print as it stands in the frame: width across, height up, mm, and whether it is film. */
export interface Print {
  pw: number;
  ph: number;
  film: StandingFilm | null;
}

/** The way a stock print comes: an instant mini or square stands up, an instant wide lies down,
 *  and a paper size is listed standing up. */
export function naturalOrientation(id: PhotoId): Orientation {
  const size = photoById(id).size;
  return size && size[0] > size[1] ? 'landscape' : 'portrait';
}

export function printOf(s: PrintSettings): Print {
  const p = photoById(s.photo);
  if (!p.size) return { pw: s.customWidth, ph: s.customHeight, film: null };
  const [a, b] = p.size;
  const turned = s.orientation !== naturalOrientation(s.photo);
  if (p.film) {
    const f = p.film;
    // Turned a quarter, the picture is on its side and the print's top and bottom margins are its
    // left and right.
    return turned
      ? { pw: b, ph: a, film: { iw: f.ih, ih: f.iw, left: f.top, right: f.bottom, top: f.side, bottom: f.side } }
      : { pw: a, ph: b, film: { iw: f.iw, ih: f.ih, left: f.side, right: f.side, top: f.top, bottom: f.bottom } };
  }
  return turned ? { pw: b, ph: a, film: null } : { pw: a, ph: b, film: null };
}

/* ---------------- magnets ---------------- */

export type MagnetId =
  | '5x2' | '6x2' | '6x3' | '8x2' | '8x3' | '10x2' | '10x3' | '12x2' | '12x3'
  | '15x2' | '15x3' | '20x2' | '20x3' | '25x2' | '25x3';

export interface MagnetSize {
  id: MagnetId;
  label: string;
  /** Diameter and thickness, mm. */
  d: number;
  h: number;
  /** What one holds on a painted fridge door before it slides, g: about 15 % of its rated pull. */
  holds: number;
  /** What it weighs, g. */
  grams: number;
}

/** Round N35 neodymium magnets, across × thick: Bambu Lab's own range from 5 mm up (the smaller
 *  ones do not hold a frame). Pull is the usual rating for N35 at each size. */
const magnet = (d: number, h: number, pullKg: number): MagnetSize => ({
  id: `${d}x${h}` as MagnetId,
  label: `${d} × ${h} mm`,
  d,
  h,
  holds: Math.round(150 * pullKg),
  grams: Math.round(7.5e-3 * Math.PI * (d / 2) ** 2 * h * 100) / 100,
});

export const MAGNETS: readonly MagnetSize[] = [
  magnet(5, 2, 0.55),
  magnet(6, 2, 0.75),
  magnet(6, 3, 1.0),
  magnet(8, 2, 1.15),
  magnet(8, 3, 1.6),
  magnet(10, 2, 1.6),
  magnet(10, 3, 2.3),
  magnet(12, 2, 2.1),
  magnet(12, 3, 3.0),
  magnet(15, 2, 3.0),
  magnet(15, 3, 4.3),
  magnet(20, 2, 4.5),
  magnet(20, 3, 6.4),
  magnet(25, 2, 6.3),
  magnet(25, 3, 9.0),
];

/** The size most fridge designs are made for, and a default that holds any frame here. */
export const DEFAULT_MAGNET: MagnetId = '10x3';

export const magnetById = (id: string): MagnetSize => MAGNETS.find((m) => m.id === id) ?? MAGNETS.find((m) => m.id === DEFAULT_MAGNET)!;

/** Whether a print of this size is inside a short-side / long-side cap. */
export function withinCap(pw: number, ph: number, [short, long]: readonly [number, number]): boolean {
  return Math.min(pw, ph) <= short + 1e-6 && Math.max(pw, ph) <= long + 1e-6;
}

/** The stands a product offers for a print of this size. A Holder is its own stand. */
export function standsFor(type: Product, pw: number, ph: number): Stand[] {
  if (type === 'holder') return [];
  const out: Stand[] = ['base', 'foot'];
  if (withinCap(pw, ph, MAGNET_CAP)) out.push('magnets');
  if (type === 'frame' && Math.max(pw, ph) <= KEYCHAIN_LONG_SIDE + 1e-6) out.push('keychain');
  return out;
}

/** "an" before a name said with a vowel sound: Instant, A5, A6. */
export function article(name: string): string {
  return /^(Instant|A\d)/.test(name) ? 'an' : 'a';
}
