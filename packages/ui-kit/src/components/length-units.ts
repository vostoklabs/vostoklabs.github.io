import { segmentedControl, type SegmentedOptions, type SegmentedRow } from './controls';

/*
  Millimetres or inches, one choice for a whole app: every length it shows (rulers, dimensions,
  the status line, a slider's value box), every length typed into it, and the mm | in switch that
  sets it. Remembered per browser, under the app's own key.

  Laser Studio had this as a module of its own. An app that wants the same choice imports this
  rather than copying that. Millimetres read the way the house writes numbers, with no trailing
  zero the step does not need ("120 mm", not "120.0 mm"); one fixed decimal is an option.

  Make one per app, in one module, and import it wherever a length is shown: the choice lives in
  the object, so two of them would be two choices.
*/

export type LengthUnit = 'mm' | 'in';

export interface LengthUnitsOptions {
  /** Where the choice is remembered in this browser: one key per app ('laser-studio-unit'). */
  storageKey: string;
  /** Millimetres without a trailing zero: "120 mm" and "48.5 mm". Default true; false keeps one
   *  decimal always, "120.0 mm". Inches always show two. */
  trimZeros?: boolean;
}

export interface LengthUnits {
  /** The unit in use. */
  get(): LengthUnit;
  /** Change it, remember it, and tell every listener (and every switch). */
  set(unit: LengthUnit): void;
  /** Called with the unit after every `set`. Returns the unsubscribe. */
  onChange(fn: (unit: LengthUnit) => void): () => void;
  /** A length in the unit in use: "48.7 mm" or "1.92 in". */
  format(mm: number): string;
  /** Two lengths, one unit: "48.7 × 14.4 mm" or "1.92 × 0.57 in". */
  formatSize(widthMm: number, heightMm: number): string;
  /** A number typed into a length box, in millimetres. In inches the number is converted, unless
   *  the text typed says mm: "12 mm" is 12 mm whichever unit is showing. */
  parse(typed: number, raw?: string): number;
  /** The mm | in switch, kept in step with the unit however it is changed. For a switch that
   *  lives as long as the app: it is never unsubscribed. A screen reader calls it "Units" unless
   *  it is given a caption or another `ariaLabel`. */
  unitSwitch(opts?: Pick<SegmentedOptions<LengthUnit>, 'fit' | 'size' | 'label' | 'help' | 'ariaLabel'>): SegmentedRow<LengthUnit>;
}

const MM_PER_IN = 25.4;

export function lengthUnits(opts: LengthUnitsOptions): LengthUnits {
  let unit: LengthUnit = 'mm';
  try {
    if (localStorage.getItem(opts.storageKey) === 'in') unit = 'in';
  } catch {
    /* storage refused (private mode): the choice lasts the visit */
  }
  const listeners = new Set<(unit: LengthUnit) => void>();

  const trimZeros = opts.trimZeros ?? true;
  const mm = (v: number): string => {
    if (!trimZeros) return v.toFixed(1);
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  const inches = (v: number): string => (v / MM_PER_IN).toFixed(2);

  const units: LengthUnits = {
    get: () => unit,
    set(next) {
      unit = next;
      try {
        localStorage.setItem(opts.storageKey, next);
      } catch {
        /* storage refused */
      }
      for (const fn of [...listeners]) fn(next);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    format: (v) => (unit === 'in' ? `${inches(v)} in` : `${mm(v)} mm`),
    formatSize: (w, h) => (unit === 'in' ? `${inches(w)} × ${inches(h)} in` : `${mm(w)} × ${mm(h)} mm`),
    parse: (typed, raw = '') => (unit === 'in' && !/mm/i.test(raw) ? typed * MM_PER_IN : typed),
    unitSwitch(o = {}) {
      const control = segmentedControl<LengthUnit>({
        ariaLabel: 'Units',
        ...o,
        options: [
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
        ],
        value: unit,
        onChange: (next) => units.set(next),
      });
      listeners.add((next) => control.setValue(next));
      return control;
    },
  };
  return units;
}
