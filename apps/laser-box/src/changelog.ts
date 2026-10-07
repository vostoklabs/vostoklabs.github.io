import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  The update timeline behind the panel's Updates button. Say what changed for the person holding
  the box, not what changed in the source; only what SHIPPED. Newest first is enforced by date.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-02',
    title: 'First release',
    changes: [
      { kind: 'added', text: 'Four boxes — an open tray, a lift-off lid, a hinged lid that latches shut, and a chest of one to three drawers — sized inside or out, in millimetres or inches, with compartments if you want them.' },
      { kind: 'added', text: 'Ready-made boxes to start from, under each box type: a jewellery box, a card box, a keepsake box, a photo box, a coaster box, a chest of drawers, a trinket drawer and a tealight lantern.' },
      { kind: 'added', text: 'Flex tabs that press together without glue (or plain fingers), sized for the sheet you measure, the kerf built in, and a Fit setting from Looser to Tighter.' },
      { kind: 'added', text: 'Patterns on the lid, the sides, every face or the ones you click, whole or inside a heart, a circle or a star — scored as fine lines, engraved as bold ones, or cut out.' },
      { kind: 'added', text: 'Zoom into the 2D design and the cut file, drag them around, and read sizes off a millimetre grid.' },
    ],
  },
];
