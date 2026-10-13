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
    date: '2026-10-13',
    title: 'First release',
    changes: [
      { kind: 'added', text: 'Twenty-seven designs to start from: simple and fun frames, love and wedding frames, a song plaque with a player, a photo as a post, holders and keychains. Each one is drawn with a sample photo in it.' },
      { kind: 'added', text: 'Help me choose: say where it goes and which photo, and see the six designs that suit it.' },
      { kind: 'added', text: 'Every print size from Instant mini, square and wide to 4 × 6 in, A6 and A5, or your own, standing up or lying down.' },
      { kind: 'added', text: 'Stand it on a base, a foot or a kickstand, stick it to the fridge with magnets, or hang it from your keys.' },
      { kind: 'added', text: 'Words above or below the photo, sized to fill the room they have, with symbols; patterns from the library, in a second colour.' },
    ],
  },
];
