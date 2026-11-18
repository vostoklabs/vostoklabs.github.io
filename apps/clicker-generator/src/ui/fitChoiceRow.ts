/*
  One of the Fit category's simple choices as a kit control: three full-width choices that each
  say what they do ("Make top part looser"), and a fourth, Custom, that shows only while the
  number is none of the three (fitChoice.ts). One per line, because a choice that names its part
  is too long for a tab.
*/
import { segmentedControl, type SegmentedRow } from '@vostok/ui-kit';
import { fitChoiceOf, type FitChoice, type FitTable } from './fitChoice';

export type FitChoiceRow = SegmentedRow<FitChoice> & {
  /** Select the choice the number is, showing Custom only when it is none of the three. */
  show(value: number): void;
};

/** What each of the three choices says. */
export type FitWords = Readonly<Record<Exclude<FitChoice, 'custom'>, string>>;

/** A press writes its stepper's number through `write` (the stepper's own callback), and
 *  `show()` picks the choice from the number, so the two can never disagree. Custom is the one
 *  selected whenever it shows, so pressing it does nothing. */
export function fitChoiceRow(label: string, help: string, table: FitTable, words: FitWords, write: (v: number) => void): FitChoiceRow {
  const row = segmentedControl<FitChoice>({
    label,
    help,
    variant: 'cards',
    columns: 1,
    options: [
      { value: 'looser', label: words.looser },
      { value: 'standard', label: words.standard },
      { value: 'snugger', label: words.snugger },
      { value: 'custom', label: 'Custom' },
    ],
    value: 'standard',
    onChange: (v) => { if (v !== 'custom') write(table[v]); },
  }) as FitChoiceRow;
  row.setOptionVisible('custom', false);
  // The order keeps the selection on a choice that is showing.
  row.show = (value) => {
    const choice = fitChoiceOf(value, table);
    if (choice === 'custom') {
      row.setOptionVisible('custom', true);
      row.setValue('custom');
    } else {
      row.setValue(choice);
      row.setOptionVisible('custom', false);
    }
  };
  return row;
}
