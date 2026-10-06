import { segmentedControl, type SegmentedOptions, type SegmentedRow } from './controls';

/*
  Millimetres or inches, one choice for a whole app: every length it shows (rulers, dimensions,
  the status line, a slider's value box), every length typed into it, and the mm | in switch that
  sets it. Remembered per browser, under the app's own key.

  Laser Studio still has its own units module, written before this block; it moves onto this one
  when Studio adopts the block. An app that wants the same choice imports this rather than copying
  that. Millimetres read the way the house writes numbers, with no trailing zero the step does not
  need ("120 mm", not "120.0 mm"); one fixed decimal, the way Studio's module writes them, is an
  option. Both round the same way, so the option only ever drops a zero, never moves a number.

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
  /** A number typed into a length box, in millimetres. A unit written after it is read as
   *  written, whichever unit is showing: "12 mm", "1.2 cm", "2 in" and 2" are 12, 12, 50.8 and
   *  50.8 mm. With none, the number is in the unit in use. */
  parse(typed: number, raw?: string): number;
  /** The mm | in switch, kept in step with the unit however it is changed. For a switch that
   *  lives as long as the app: it is never unsubscribed. A screen reader calls it "Units" unless
   *  it is given a caption or another `ariaLabel`. */
  unitSwitch(opts?: Pick<SegmentedOptions<LengthUnit>, 'fit' | 'size' | 'label' | 'help' | 'ariaLabel'>): SegmentedRow<LengthUnit>;
}

const MM_PER_IN = 25.4;
/** The unit written after a typed number. The quote can come curled from a phone's keyboard. */
const WRITTEN_UNIT = /[\d.\s](mm|cm|in(?:ch(?:es)?)?|"|″|”)\s*$/i;

export function lengthUnits(opts: LengthUnitsOptions): LengthUnits {
  let unit: LengthUnit = 'mm';
  try {
    if (localStorage.getItem(opts.storageKey) === 'in') unit = 'in';
  } catch {
    /* storage refused (private mode): the choice lasts the visit */
  }
  const listeners = new Set<(unit: LengthUnit) => void>();

  const trimZeros = opts.trimZeros ?? true;
  // Both ways round with toFixed, so they agree on every number: -1.25 is -1.3 either way.
  // Number() then drops the zero, and turns a "-0.0" into a plain 0.
  const mm = (v: number): string => {
    if (!trimZeros) return v.toFixed(1);
    const r = Number(v.toFixed(1));
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
    parse(typed, raw = '') {
      const written = WRITTEN_UNIT.exec(raw)?.[1]?.toLowerCase() ?? unit;
      return written === 'mm' ? typed : written === 'cm' ? typed * 10 : typed * MM_PER_IN;
    },
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
