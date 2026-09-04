import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button at the bottom of the settings column. See `changelogButton`
  in the kit, which groups these by kind and sorts by date, so an entry can be appended
  anywhere in this array without inverting the timeline.

  This replaced a modal that opened itself on load and said "since your last visit" to people
  who had never visited. Four rules, all of which this file exists to keep:

    1. A few words per bullet, and nothing beyond them. "A shape editor." is the format, not
       an unusually short example of it. One line, one change; two changes are two bullets.
       This is scanned, not read: someone opens it to find out whether the thing they
       reported is fixed, and every clause they have to read first is in their way. The
       explanation of HOW a feature works belongs on the control, in its help tip, where
       somebody is looking at the thing being explained.

    2. Say what changed for the person holding the print, not what changed in the source.
       "stemFitPct clips against the authored post" is a commit message. "The stem fit
       control now actually changes the fit" is an update note.

    3. Only what SHIPPED. This is the answer to "has my bug been fixed", and an entry for
       work that has not reached the deployed app turns that answer into a lie.

    4. No em dashes, and no dashes standing in for a comma or a full stop. A large share of
       the people reading this are not reading in their first language, and a bullet that
       leans on punctuation to carry a clause is harder work than two short sentences.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-04',
    changes: [
      { kind: 'changed', text: 'Much better image processing.' },
      { kind: 'fixed', text: 'Thin lines and small text keep their color.' },
      { kind: 'fixed', text: 'No colored fringe along an outline.' },
      { kind: 'fixed', text: 'Smooth edges instead of stair steps.' },
      { kind: 'added', text: 'A preview of the traced result.' },
      { kind: 'added', text: 'Choose which colors to keep.' },
      { kind: 'added', text: 'Custom colors join the palette.' },
      { kind: 'changed', text: 'Design size now goes above 100 per cent.' },
      { kind: 'fixed', text: 'Moving the design no longer resizes the base.' },
      { kind: 'changed', text: 'Simpler keychain controls.' },
      { kind: 'changed', text: 'The Raise panel no longer covers the model.' },
      { kind: 'changed', text: 'Small UI improvements throughout.' },
      { kind: 'fixed', text: 'Undo, redo and refresh work again.' },
    ],
  },
  {
    date: '2026-09-03',
    changes: [
      { kind: 'added', text: 'A shape editor.' },
      { kind: 'added', text: 'Star sharpness and cross arm width.' },
      { kind: 'fixed', text: 'The star preview matches the print.' },
    ],
  },
  {
    date: '2026-09-02',
    changes: [
      { kind: 'added', text: 'A shape browser, several hundred shapes.' },
      { kind: 'added', text: 'Adjustable shapes. Sides, points, petals, teeth.' },
      { kind: 'added', text: 'A letter or symbol as the base.' },
      { kind: 'added', text: 'Design size.' },
      { kind: 'fixed', text: 'Hollow base is open underneath. It prints.' },
      { kind: 'added', text: 'Move the keyring loop on letter blocks.' },
      { kind: 'fixed', text: 'Exports laid out for the plate you picked.' },
      { kind: 'added', text: 'A note when a set needs two plates.' },
    ],
  },
  {
    date: '2026-08-31',
    changes: [
      { kind: 'fixed', text: 'Settings work as soon as the page loads.' },
      { kind: 'fixed', text: 'The stem fit control really changes the fit.' },
      { kind: 'added', text: 'Switch pocket fit.' },
      { kind: 'added', text: 'Button height.' },
      { kind: 'changed', text: 'Fit controls named after the parts they move.' },
      { kind: 'added', text: 'A note when the base grows for the switch.' },
      { kind: 'added', text: 'A warning when a thin design is scaled.' },
      { kind: 'changed', text: 'No welcome pop-up. This panel replaced it.' },
      { kind: 'fixed', text: 'Keyboard access to upload, samples and icons.' },
    ],
  },
  {
    date: '2026-08-16',
    changes: [
      { kind: 'added', text: 'Move the keyring anywhere around the edge.' },
      { kind: 'fixed', text: 'Colors carry into Bambu Studio.' },
    ],
  },
  {
    date: '2026-07-21',
    changes: [
      { kind: 'added', text: 'Letter blocks. A word as snap together blocks.' },
      { kind: 'added', text: 'Symbols on the caps.' },
      { kind: 'added', text: '1 to 3 MX switches.' },
      { kind: 'changed', text: 'Sharper image tracing.' },
    ],
  },
  {
    date: '2026-06-26',
    changes: [
      { kind: 'added', text: 'First release. Any image into a printable clicker.' },
    ],
  },
];
