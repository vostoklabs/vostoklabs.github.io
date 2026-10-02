/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button in the credit strip at the foot of the left column — see
  `panelCredit` / `changelogButton` in the kit, which group these by kind and sort by date, so
  an entry can be appended anywhere in this array without inverting the timeline.

  THE HOUSE STYLE LIVES IN THE KIT: packages/ui-kit/src/components/changelog.ts, in the comment
  above `ChangelogEntry`. Read it before adding a line. In short: one short sentence per bullet,
  ending in a full stop, about the print rather than the source, and only what has shipped.

  @type {import('@vostok/ui-kit').ChangelogEntry[]}
*/
export const CHANGELOG = [
  {
    date: '2026-09-15',
    changes: [
      { kind: 'added', text: 'A stem fit test you can print.' },
      { kind: 'added', text: 'Pick Arachne or Classic walls for the print.' },
      { kind: 'changed', text: 'Exports use Arachne walls unless you pick Classic.' },
      { kind: 'added', text: 'Choose the step between fit test pieces.' },
      { kind: 'fixed', text: 'Projects remember the stem fit.' },
      { kind: 'fixed', text: 'Stem fit really changes how tight the stem grips.' },
      { kind: 'fixed', text: 'Stem fit on Choc goes the right way.' },
    ],
  },
  {
    date: '2026-09-05',
    changes: [
      { kind: 'added', text: 'This updates panel.' },
      { kind: 'added', text: 'Any colour you like, not just the shelf.' },
      { kind: 'added', text: 'Drag an SVG straight onto the panel.' },
      { kind: 'added', text: 'Cancel a batch while it runs.' },
      { kind: 'added', text: 'A licence note when you download.' },
      { kind: 'added', text: 'Licence details written into the file.' },
      { kind: 'changed', text: 'Colours are one line each.' },
      { kind: 'changed', text: 'Every export confirms itself.' },
      { kind: 'changed', text: 'Profile and size say what they reset.' },
      { kind: 'fixed', text: 'Gallery icons were invisible in light mode.' },
      { kind: 'fixed', text: 'The legend type buttons keep up with the click.' },
      { kind: 'fixed', text: 'An SVG the tracer cannot read says so.' },
      { kind: 'fixed', text: 'Background rectangles found in more files.' },
      { kind: 'fixed', text: 'The preview background matches the panels.' },
      { kind: 'fixed', text: 'Panels scroll on a phone.' },
      { kind: 'fixed', text: 'Legend buttons stay on one row.' },
      { kind: 'fixed', text: 'The icon gallery takes the keyboard.' },
    ],
  },
  {
    date: '2026-08-12',
    changes: [
      { kind: 'added', text: 'Choc v1 profile. Print them on their side.' },
      { kind: 'added', text: 'Thocky profile.' },
      { kind: 'added', text: 'Stem fit, for a cap that is too tight or too loose.' },
      { kind: 'added', text: 'Pick the build plate you print on.' },
    ],
  },
  {
    date: '2026-08-06',
    changes: [
      { kind: 'fixed', text: 'Two-colour 3MFs open right in Bambu Studio.' },
    ],
  },
];
