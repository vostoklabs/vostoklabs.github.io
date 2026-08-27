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
