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
      { kind: 'added', text: 'Eighteen templates: pick one, type your details and download a card in two or more colours for your Bambu Lab printer.' },
      { kind: 'added', text: 'The templates open from a menu of pictures drawn with your own details and colours; point at one to see its front and back.' },
      { kind: 'added', text: 'A back printed in the same go. Choose whether your logo and the QR code go on the front or the back, and whether the back carries your company, your name or nothing.' },
      { kind: 'added', text: 'Your own logo from an SVG file, or your initials, and a QR code that opens your website, saves your contact card or opens any link.' },
      { kind: 'added', text: 'Text is never set smaller than a 0.4 mm nozzle prints readably; a card that cannot hold its lines says so. Lettering lies flat in the face, or stands up as far as you like.' },
      { kind: 'added', text: 'An NFC tag pocket: drag the dotted circle to where the tag goes, and the print pauses so you can drop it in.' },
    ],
  },
];
