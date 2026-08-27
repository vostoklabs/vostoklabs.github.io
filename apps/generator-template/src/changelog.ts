import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  The update timeline behind the sidebar's Updates button.

  Every generator gets one, because the question it answers arrives by email for every
  generator: "I reported X — has it been fixed?" Without this, the only honest answer lives
  in a commit log the person asking cannot see.

  Two rules:

    · Say what changed for the person holding the print, not what changed in the source.
      "Lug reach now derives from tuck depth" is a commit message; "a wide shallow box no
      longer gets flaps longer than it is tall" is an update note.

    · Only what SHIPPED. An entry for work that has not reached the deployed app turns the
      one thing this panel is for into a lie.

  Newest first is enforced by date when it renders, so append wherever you like.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-01-01',
    title: 'First release',
    changes: [
      { kind: 'added', text: 'Replace this with what your generator does, in one sentence.' },
    ],
  },
];
