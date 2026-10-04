import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button under the settings column — see `changelogButton` in the
  kit, which groups these by kind and sorts by date, so an entry can be appended anywhere in
  this array without inverting the timeline.

  Three rules, all of which this file exists to keep:

    · A few words per bullet. This is scanned, not read: someone opens it to find out
      whether the thing they reported is fixed, and a paragraph makes them hunt.

    · Say what changed for the person holding the print, not what changed in the source.
      "Lug reach derives from tuck depth" is a commit message; "lug length follows the box
      height, not its width" is an update note.

    · Only what SHIPPED. This is the answer to "has my bug been fixed", and an entry for
      work that has not reached the deployed app turns that answer into a lie.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-18',
    changes: [
      { kind: 'changed', text: 'The machine list is Bambu H2D plus the two generic profiles — pick those if your cutter is not here' },
      { kind: 'changed', text: '"Print & cut by hand" is now "Plain SVG": the same file, with nothing machine-specific in it' },
      { kind: 'changed', text: 'New symbol set — solid shapes that engrave and cut cleanly, and nothing you export owes anyone a credit' },
      { kind: 'added', text: 'A blank that will not fit now says so next to Machine and Sheet of card, not only over the preview' },
      { kind: 'fixed', text: 'Clicking into Words no longer crowds the Symbol button beside it' },
      { kind: 'added', text: 'Every download carries a third-party notices file listing the fonts and their licences' },
      { kind: 'changed', text: 'Hand holes in the ends have been removed: they never cut a hole worth carrying a box by' },
      { kind: 'added', text: '185 fonts for the logo instead of eight, with search and a filter by style — every row shows your own word' },
      { kind: 'changed', text: 'Smaller locking nibs on the rolled ends — about half as long and a fifth less proud — so the ends thread into their slots instead of fighting them' },
      { kind: 'changed', text: 'A blank that will not fit says so in one line, right above the button that fixes it' },
      { kind: 'changed', text: 'Settings column tightened: the fit readout is visible without scrolling, and "Cutting detail" is always open' },
      { kind: 'changed', text: 'Fewer standing notes and headings, and no coloured bars down the side of every message' },
    ],
  },
  {
    date: '2026-09-17',
    changes: [
      { kind: 'added', text: 'Cake box: the shallow bakery box, with a lid that hinges off the back' },
      { kind: 'added', text: 'Its corners lock with a claw — no glue, and nothing sticking out under the floor' },
      { kind: 'added', text: 'Half the card of a mailer for the same inside size, and it prints flat too' },
      { kind: 'changed', text: 'The preview draws the card at its real thickness, so 1.6 mm board looks like board' },
      { kind: 'changed', text: 'Printed flaps are the full sheet thickness by default, so they grip' },
      { kind: 'changed', text: 'Gable box: the handle strip, its hook and the end flaps follow a commercial template' },
      { kind: 'fixed', text: 'Tuck cartons and the gable box fold closed on the table, then stand up' },
      { kind: 'fixed', text: 'A glue lap or a tuck no longer swings through the table mid-fold' },
      { kind: 'fixed', text: 'The telescoping lid lifts off before it turns over' },
    ],
  },
  {
    date: '2026-09-12',
    changes: [
      { kind: 'added', text: 'Put a logo on the box: text, a symbol, or an SVG you drop in' },
      { kind: 'added', text: 'Printed boxes inlay the logo into the first layer as a second colour' },
      { kind: 'added', text: 'Two machine-agnostic profiles: any laser, any cutting machine' },
      { kind: 'changed', text: 'Folds say what they are in your software: Laser Cut, dashed, or Laser Line' },
      { kind: 'fixed', text: 'A Laser Line fold is one whole line, and both lines at a double-ply end' },
      { kind: 'fixed', text: 'Switching machine no longer resets a sheet that still fits' },
      { kind: 'fixed', text: 'A logo can go on any face of the box, not only the ones a window can use' },
      { kind: 'fixed', text: 'Two faces listed under the same name in "Logo on"' },
      { kind: 'fixed', text: 'A step went missing from the settings panel on boxes with no options' },
      { kind: 'changed', text: 'The dieline legend lists what is actually in the drawing, logo included' },
      { kind: 'changed', text: 'When a box will not fit, the message names the button that fixes it' },
      { kind: 'fixed', text: 'Webbed corners were missing a fold line where the web meets the wall' },
      { kind: 'added', text: 'Dropping an SVG opens the import window: see what came in, switch parts off' },
      { kind: 'changed', text: 'Less standing text: the detail moved into the ? tips it belongs in' },
      { kind: 'changed', text: 'The dieline panel puts the colour key and the switches side by side' },
    ],
  },
  {
    date: '2026-08-27',
    changes: [
      { kind: 'added', text: 'Flap thickness setting, up to the full sheet' },
      { kind: 'added', text: 'This updates panel' },
      { kind: 'fixed', text: 'Mailer + flaps: lug length follows the box height, not its width' },
      { kind: 'fixed', text: 'Typing a size in inches' },
      { kind: 'fixed', text: 'Long readouts cut off in the value boxes' },
      { kind: 'fixed', text: 'Stale figures after changing layer height' },
    ],
  },
  {
    date: '2026-08-26',
    changes: [{ kind: 'added', text: 'First release: four glue-free boxes, printed flat' }],
  },
];
