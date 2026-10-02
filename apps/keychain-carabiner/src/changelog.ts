import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  The update timeline behind the sidebar's Updates button.

  Say what changed for the person holding the print, not what changed in the source, and
  only what SHIPPED. Newest first is enforced by date when it renders.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-09',
    title: 'Four sets to start from, and a way back',
    changes: [
      { kind: 'added', text: 'Four starter sets beside the colours — a classic clip, a charm dangle, a print-in-place chain and the hook on its own. One click loads the whole set: shape, symbol and colours.' },
      { kind: 'added', text: 'Undo, refresh and redo at the foot of the settings, and on Ctrl+Z / Ctrl+Shift+Z. Every setting is covered, colours included.' },
      { kind: 'added', text: 'Every slider and counter now shows the recommended number the moment you move away from it — press it to put back just that one setting.' },
      { kind: 'fixed', text: 'Small print-in-place links no longer refuse to build: the bar follows the link size down to the widest that still prints, so a 20 mm oval chain just works instead of warning about its tips.' },
      { kind: 'fixed', text: 'The shape you had chosen now actually looks chosen in the picker.' },
      { kind: 'changed', text: 'The five steps start closed, so the whole list fits the panel without scrolling.' },
    ],
  },
  {
    date: '2026-09-07',
    title: 'A chain that prints in place',
    changes: [
      { kind: 'added', text: 'A second way to make the chain: Cuban-style links that come off the bed already linked, grown out of the hook’s own loop. Pick how many and how big; nothing to assemble.' },
      { kind: 'added', text: 'Round, oval, long or Cuban links, as thick as the hook, with a connector ring on the end for whatever you hang there. The plain loop becomes a teardrop the first link hangs through.' },
      { kind: 'added', text: 'The print-in-place chain can grow out of the hook or print as its own part, joined by a connector ring — another colour, another plate. Its thickness is a setting.' },
      { kind: 'changed', text: 'The chain section now starts with the choice — open links in any shape, or print in place — and each keeps its own settings.' },
    ],
  },
  {
    date: '2026-09-06',
    title: 'First release',
    changes: [
      { kind: 'added', text: 'A snap-hook clip, chain links, connector rings and an optional charm, each in any of eight shapes or one of your own, printed flat in one job.' },
      { kind: 'added', text: 'A symbol on the clip — the clean silhouettes first, then 1392 icons — in the clip’s colour or its own. Drag it on the model to place it.' },
      { kind: 'added', text: 'A print-in-place swivel: a barrel in a window, turning on a stem. Or a plain loop, or no loop at all with the chain through the clip itself.' },
      { kind: 'added', text: 'Loop openings size themselves to whatever passes through them.' },
      { kind: 'added', text: 'An assembled view of the whole keychain, hanging as worn and dangling as you move it, beside the print layout.' },
      { kind: 'added', text: 'Flat bevel or rounded edges, your choice, on every part.' },
      { kind: 'added', text: 'Charm symbols cut through, engraved or raised — and nothing left floating.' },
    ],
  },
];
