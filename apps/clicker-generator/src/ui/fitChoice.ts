/*
  The Fit category's simple choices: Looser, Standard or Snugger, for the cap's cross and for the
  switch's pocket in the base. Each is a view of a number the steppers under "By hand" already
  set, so a choice holds no value of its own: pressing one writes the number, and the number
  decides which choice shows. A number that is none of the three shows as Custom.

  Up is looser for both. 0.20 mm opens the cross hole by a fifth of a millimetre, a step a print
  can be felt to change by; 2 % widens the switch pocket by about 0.3 mm across (0.16 mm a wall). Both are on the
  steppers' own grids, so a stepper shows them exactly.
*/

export type FitChoice = 'looser' | 'standard' | 'snugger' | 'custom';
export type FitTable = Readonly<Record<Exclude<FitChoice, 'custom'>, number>>;

/** Switch stem fit (`stemFitMm`), in millimetres. */
export const TOP_FIT_MM: FitTable = { looser: 0.2, standard: 0, snugger: -0.2 };

/** Switch pocket fit (`socketFitPct`), in percent. */
export const POCKET_FIT_PCT: FitTable = { looser: 2, standard: 0, snugger: -2 };

/** The rows that stay live while the fit test shows, by the id they are found by: what the test
 *  tiles answer to (the top part's choice, Switch stem fit, Stem thickness), the "By hand" caption
 *  over those steppers, and the test's own block. Every other row of every category is locked,
 *  the switch cut-out's choice, Top / base gap and Switch pocket fit among them. */
export const FIT_TEST_LIVE = ['topFitMount', 'fitHandLabel', 'stemFitMount', 'stemOuterMount', 'fitTestBlock'] as const;

/** The choice a number is, or `'custom'` when it is none of them. */
export function fitChoiceOf(value: number, table: FitTable): FitChoice {
  for (const key of ['looser', 'standard', 'snugger'] as const) {
    if (Math.abs(value - table[key]) < 0.001) return key;
  }
  return 'custom';
}
