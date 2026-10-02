// Millimetres or inches, one choice for the whole app: the rulers, the status readout, the
// gallery never (a card has no numbers). The choice is remembered per browser.
export type Unit = 'mm' | 'in';

const KEY = 'laser-studio-unit';
let unit: Unit = 'mm';
try { if (localStorage.getItem(KEY) === 'in') unit = 'in'; } catch { /* private mode */ }

const listeners = new Set<(u: Unit) => void>();

export const getUnit = (): Unit => unit;

export function setUnit(u: Unit) {
  unit = u;
  try { localStorage.setItem(KEY, u); } catch { /* private mode */ }
  for (const l of listeners) l(u);
}

export function onUnitChange(fn: (u: Unit) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A length in the current unit, with its unit: "48.7 mm" or "1.92 in". */
export function fmtLength(mm: number): string {
  return unit === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

/** "48.7 × 14.4 mm" / "1.92 × 0.57 in". */
export function fmtSize(wMm: number, hMm: number): string {
  return unit === 'in' ? `${(wMm / 25.4).toFixed(2)} × ${(hMm / 25.4).toFixed(2)} in` : `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm`;
}
