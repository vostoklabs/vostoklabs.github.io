import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button in the credit strip pinned at the foot of the settings
  column. See `panelCredit` in the kit, which groups these by kind and sorts by date, so an
  entry can be appended anywhere in this array without inverting the timeline.

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
    date: '2026-11-18',
    changes: [
      { kind: 'added', text: 'Remove parts or a whole color from a picture.' },
      { kind: 'added', text: 'Crop a picture before it is traced.' },
      { kind: 'added', text: 'Up to 12 colors in a picture.' },
      { kind: 'added', text: 'A picture on the bottom of the clicker.' },
      { kind: 'added', text: 'Keychain: a hole through the base, placed for you.' },
      { kind: 'added', text: 'Arrow and turn buttons to move the switch.' },
      { kind: 'added', text: 'Recolor with the colors already in your design.' },
      { kind: 'added', text: 'Fit: Stem thickness for the top part.' },
      { kind: 'added', text: '3D model: several buttons on one model.' },
      { kind: 'added', text: 'Save and Load on MakerLab.' },
      { kind: 'added', text: 'A Chinese font with many more characters.' },
      { kind: 'added', text: 'Christmas samples.' },
      { kind: 'changed', text: 'Fit: plain choices with a drawing.' },
      { kind: 'changed', text: 'The Switch settings are now called Clicker.' },
      { kind: 'changed', text: 'On a phone, the preview comes first.' },
      { kind: 'changed', text: 'A saved project is named after your design.' },
      { kind: 'fixed', text: 'The top part fits the switch without cracking.' },
      { kind: 'fixed', text: 'Pictures open with their own colors.' },
      { kind: 'fixed', text: 'The app works on small windows.' },
      { kind: 'fixed', text: 'Symbols in text print the shape they show.' },
      { kind: 'fixed', text: 'SVG shapes stay in their drawn order.' },
      { kind: 'fixed', text: 'A saved project keeps every setting.' },
    ],
  },
  {
    date: '2026-11-04',
    changes: [
      { kind: 'added', text: 'Blank: print any clicker without its picture.' },
      { kind: 'added', text: 'Blocks: Keycap height, for a shorter key.' },
      { kind: 'added', text: 'Blocks: Low profile and Thocky keycaps.' },
      { kind: 'changed', text: 'Design size goes down to 10%.' },
      { kind: 'changed', text: 'On MakerLab the top and the body are separate objects.' },
    ],
  },
  {
    date: '2026-10-11',
    changes: [
      { kind: 'added', text: 'Blocks: Body rim height, to hide more of each keycap.' },
    ],
  },
  {
    date: '2026-10-04',
    changes: [
      { kind: 'fixed', text: 'Switch stem fit now changes the print, in millimetres.' },
      { kind: 'changed', text: 'The fit test opens in the preview before you export it.' },
      { kind: 'added', text: 'Choose the step between fit test tiles.' },
    ],
  },
  {
    date: '2026-10-01',
    changes: [
      { kind: 'added', text: 'Make a clicker from any 3D model: STL, 3MF or OBJ.' },
      { kind: 'added', text: 'Three ways to make it click, pictured on your own model.' },
      { kind: 'added', text: 'Drag the cut on the model to move it.' },
      { kind: 'added', text: 'Five sample models to start from.' },
    ],
  },
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
