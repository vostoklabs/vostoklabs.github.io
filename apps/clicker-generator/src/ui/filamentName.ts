// The shelf filament a colour is called by: one function for the picture window and the rail, so
// a colour has one name wherever it is shown. Pure: no DOM.
import { srgbToOklab } from '@vostok/trace';
import { FILAMENTS, type RGB } from '../types';

/* A colour this close to the grey axis (Oklab chroma) has no hue worth naming. Measured: the
   greys 60 to 110 sit nearer Brown than Gray by lightness alone, and a grey of 180 nearer Beige,
   so a nearest-colour pick named a grey after a brown filament. */
const NEUTRAL_CHROMA = 0.03;
/** The filaments a near-grey colour may be called. */
const NEUTRALS = new Set(['Black', 'Gray', 'Silver', 'White']);

const rgbOfHex = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const SHELF = FILAMENTS.map(([name, hex]) => ({ name, hex, lab: srgbToOklab(rgbOfHex(hex)) }));

/** The shelf filament nearest a colour as a person sees it (Oklab), as `[name, hex]`. A grey is
 *  only ever Black, Gray, Silver or White. By plain RGB distance a leaf green came out nearer
 *  Brown than Green, which is why this is Oklab. */
export function nearestFilament(rgb: RGB): [string, string] {
  const [l, a, b] = srgbToOklab(rgb);
  const neutral = Math.hypot(a, b) < NEUTRAL_CHROMA;
  let best = SHELF[0];
  let bestD = Infinity;
  for (const f of SHELF) {
    if (neutral && !NEUTRALS.has(f.name)) continue;
    const d = (l - f.lab[0]) ** 2 + (a - f.lab[1]) ** 2 + (b - f.lab[2]) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  return [best.name, best.hex];
}

/** The name of the shelf filament nearest a colour. */
export function filamentName(rgb: RGB): string {
  return nearestFilament(rgb)[0];
}
