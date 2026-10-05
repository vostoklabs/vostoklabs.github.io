/*
  The fit steppers' readout: an offset from a baseline, written with its sign, and the way back.

  A negative is written with the typographic minus, which the kit's value box does not read as a
  sign, so the box hands a stepper's `parse` the magnitude and the raw text, and the sign has to
  be found in the text. Kept out of ui.ts so a node test can hold the pair without the rest of the
  interface (tests/signed-readout.test.ts).
*/

/** Signed millimetre offset, for a control whose 0 is a baseline rather than zero. */
export const fmtSignedMm = (v: number, dec: number) =>
  (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(dec) + ' mm';

/** The way back from `fmtSignedMm` and ui.ts's `pct`, as a stepper's `parse`. Both write a
 *  negative with the typographic minus, and the box reads only "-" as a sign, so "−0.10 mm"
 *  typed back would otherwise land as +0.10. */
export const readSigned = (typed: number, raw: string) => (raw.includes('−') ? -Math.abs(typed) : typed);
