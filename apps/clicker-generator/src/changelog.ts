import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button at the bottom of the settings column. See `changelogButton`
  in the kit, which groups these by kind and sorts by date, so an entry can be appended
  anywhere in this array without inverting the timeline.

  This replaced a modal that opened itself on load and said "since your last visit" to people
  who had never visited. Four rules, all of which this file exists to keep:

    1. A few words per bullet. This is scanned, not read. Someone opens it to find out
       whether the thing they reported is fixed, and a paragraph makes them hunt.

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
    date: '2026-08-31',
    changes: [
      { kind: 'fixed', text: 'Sliders and settings now work as soon as the page loads. Before this you had to click an import tab first.' },
      { kind: 'fixed', text: 'The stem fit control now really changes the fit. It used to move the grip by about a seventh of what it said.' },
      { kind: 'added', text: 'Switch pocket fit: how tightly the switch sits in the base.' },
      { kind: 'added', text: 'Button height: how far the button stands above its surround before you press it.' },
      { kind: 'changed', text: 'The three fit controls are named after the parts they move. Top and base gap, switch stem, switch pocket.' },
      { kind: 'added', text: 'A note when the base or the top has to grow to clear the switch. This is the bulge people were asking about.' },
      { kind: 'added', text: 'A warning when a long thin design is scaled up past the size you set.' },
      { kind: 'changed', text: 'No welcome pop-up and no forced tour. This Updates panel replaced the old what is new box.' },
      { kind: 'fixed', text: 'You can now reach the upload box, the samples and the icons with a keyboard.' },
    ],
  },
  {
    date: '2026-08-16',
    changes: [
      { kind: 'added', text: 'Move the keyring anywhere around the edge.' },
      { kind: 'fixed', text: 'Colours now carry into Bambu Studio instead of arriving as one solid part.' },
    ],
  },
  {
    date: '2026-07-21',
    changes: [
      { kind: 'added', text: 'Letter blocks. Turn a word into a row of snap together blocks, each with its own switch and keycap.' },
      { kind: 'added', text: 'Symbols on the caps, with size and boldness.' },
      { kind: 'added', text: 'Use 1 to 3 MX switches, each moved and rotated on its own.' },
      { kind: 'changed', text: 'Sharper image tracing. Fine text and small features survive.' },
    ],
  },
  {
    date: '2026-06-26',
    changes: [
      { kind: 'added', text: 'First release. Any image, icon, SVG or text into a printable multi colour clicker.' },
    ],
  },
];
