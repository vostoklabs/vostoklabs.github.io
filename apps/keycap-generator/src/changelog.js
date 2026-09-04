/*
  What has changed in this generator, in the user's language.

  Rendered by the Updates button at the foot of the left column — see `changelogButton` in the
  kit, which groups these by kind and sorts by date, so an entry can be appended anywhere in
  this array without inverting the timeline.

  This replaced a "What's new" modal that opened itself on load and said "since you were last
  here" to people who had never been here. Same three rules the clicker and foldbox files keep:

    · A few words per bullet. This is scanned, not read: someone opens it to find out whether
      the thing they reported is fixed, and a paragraph makes them hunt.

    · Say what changed for the person holding the print, not what changed in the source.
      "themeColorHex replaces the hardcoded clear colour" is a commit message. "The preview
      background matches the panels again" is an update note.

    · Only what SHIPPED. This is the answer to "has my bug been fixed", and an entry for work
      that has not reached the deployed app turns that answer into a lie.

  @type {import('@vostok/ui-kit').ChangelogEntry[]}
*/
export const CHANGELOG = [
  {
    date: '2026-09-04',
    changes: [
      { kind: 'added', text: 'This updates panel, in place of the popup that opened itself every visit' },
      { kind: 'added', text: 'Drag an SVG straight onto the SVG panel. The panel said you could before, and nothing happened' },
      { kind: 'added', text: 'A note about what the licence covers when you download, and the licence details are written into the file itself' },
      { kind: 'added', text: 'Every export says so, with a message you cannot miss' },
      { kind: 'added', text: 'Cancel a batch while it runs. The alphabet set and the keyboard set both had to be waited out or the tab closed' },
      { kind: 'fixed', text: 'Icons in the gallery were white on white in light mode' },
      { kind: 'fixed', text: 'An SVG the tracer cannot read now says so instead of doing nothing' },
      { kind: 'fixed', text: 'A background rectangle is recognised in more files, so it stops being carved as a slab over your icon' },
      { kind: 'fixed', text: 'The preview background matches the panels around it again' },
      { kind: 'fixed', text: 'On a phone the panels scroll instead of squeezing into a strip' },
      { kind: 'fixed', text: 'On a small laptop the legend buttons stay on one row' },
      { kind: 'fixed', text: 'The icon gallery can be reached with the keyboard' },
      { kind: 'changed', text: 'Changing profile or size says so when it resets the legend size' },
    ],
  },
  {
    date: '2026-08-12',
    changes: [
      { kind: 'added', text: 'Choc v1 profile: low-profile caps for Kailh Choc v1 switches, in 1u, 1.5u and 2u. Print them on their side, as modelled, with supports for the stems' },
      { kind: 'added', text: 'Thocky profile, alongside Standard and Low' },
      { kind: 'added', text: 'Stem fit: loosen or tighten how the stem grips the switch. Nudge it up if the cap is too tight, down if it is loose' },
      { kind: 'added', text: 'Pick the build plate you print on, under the preview' },
    ],
  },
  {
    date: '2026-08-06',
    changes: [
      { kind: 'fixed', text: 'Exported 3MFs open in Bambu Studio with the cap and the legend already on separate filaments' },
    ],
  },
];
