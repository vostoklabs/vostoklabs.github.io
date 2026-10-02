import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  The update timeline behind the sidebar's Updates button. Say what changed for the person
  holding the part, not what changed in the source, and only what SHIPPED.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-29',
    title: 'Clearer categories, and business card lettering you can move',
    changes: [
      { kind: 'changed', text: 'The gallery’s categories make sense now: Couple keychains, Gifts, Business cards, QR codes and Patterns each have their own.' },
      { kind: 'fixed', text: 'The design pictures in the gallery show up straight away instead of drawing one by one.' },
      { kind: 'added', text: 'Business cards: align the text left, centre or right, move it, and set the title’s size, the phone and third line’s own size in mm, and the space between lines.' },
      { kind: 'changed', text: 'Business cards open with John Smith and website.com as the sample text.' },
      { kind: 'changed', text: 'Heart cutout keychains: the small heart over each initial stands upright, and you can swap it for any symbol or remove it.' },
      { kind: 'added', text: 'An optional logo or symbol can be removed again after you pick one.' },
      { kind: 'changed', text: 'Both photo frames are redrawn: fuller hearts, the name set cleanly under the photo, the small hearts cut inside the border, and bolder icon sets for every theme.' },
    ],
  },
  {
    date: '2026-09-29',
    title: 'Patterns cut out the way they look',
    changes: [
      { kind: 'fixed', text: 'Cut out cuts a pattern of shapes as those shapes: stars, dots, snowflakes, waves and the rest, trimmed at the edge of the area instead of dropped.' },
      { kind: 'changed', text: 'The Web setting is the least wood left between any two cuts, on every pattern. Shapes that come closer shrink a little; the rest keep their size.' },
      { kind: 'fixed', text: 'When a pattern can’t be cut out, the message names a zoom that really does cut it.' },
      { kind: 'fixed', text: 'Hinges no longer warn about a gap they do not have.' },
      { kind: 'fixed', text: 'Every library pattern now matches its picture. Zebra, Flower - 3, Plus - 5 and forty more drew parts wrong, or nothing at all.' },
      { kind: 'fixed', text: 'Score draws one clean outline: no line burnt twice, none missing. Engraving no longer fills stray blobs at the edge.' },
      { kind: 'fixed', text: 'Cut out keeps every skull, flake and star; a detail too thin for the laser goes out with its shape.' },
      { kind: 'added', text: 'Thinnest wood, under More: the thinnest strip of wood a cut-out may leave inside one shape.' },
      { kind: 'changed', text: 'When a pattern is cut as the gaps between its shapes, or leaves its smallest shapes as wood, the status says so.' },
    ],
  },
  {
    date: '2026-09-28',
    title: 'A keyring that goes anywhere, a heart puzzle that fits',
    changes: [
      { kind: 'changed', text: 'Every keyring is a loop tab now. Drag it inside the part and it is the hole; drag it past the edge and it grows a tab.' },
      { kind: 'added', text: 'Dragging the ring snaps it to the design’s centre lines, with a guide line while it is snapped.' },
      { kind: 'fixed', text: 'The ring lands exactly where you let go of it.' },
      { kind: 'fixed', text: 'Heart puzzle keychains: each heart’s engraved half runs right to the cut, so both hearts read whole, and the knobs always leave a little play, so the pair slides together.' },
      { kind: 'changed', text: 'Snowflake gift tags: the snowflake sits centred on the end of the tag, half of it hanging off, like the real ones.' },
    ],
  },
  {
    date: '2026-09-27',
    title: 'Business cards, matching keychains and more',
    changes: [
      { kind: 'added', text: 'Five business card layouts with a pattern: a band, half the card, a frame, a tall card and a logo tile.' },
      { kind: 'added', text: 'Patterns can be cut out as a lattice: the lines stay as wood and the spaces between them are cut away.' },
      { kind: 'added', text: 'Matching keychains with one heart cut across the pair, and heart puzzle keychains that lock together.' },
      { kind: 'added', text: 'A song keychain with a play bar, and room for your own music code.' },
      { kind: 'added', text: 'A QR code card, snowflake gift tags, plant stakes, a tie holder, two standing photo frames and a jigsaw blank.' },
    ],
  },
  {
    date: '2026-09-22',
    title: 'A pocket stand, a better desk stand, cleaner patterns',
    changes: [
      { kind: 'added', text: 'Keychain phone stand: one flat bar with a slot your phone drops into, a ring hole and your name on the face.' },
      { kind: 'changed', text: 'The desk phone stand is redrawn — straight-sided pieces, and the front one stands on two legs instead of a solid slab.' },
      { kind: 'fixed', text: 'Scored patterns no longer burn a grid behind the design where the pattern crosses from one tile to the next.' },
      { kind: 'fixed', text: 'Waves and scales patterns came out as a thicket of overlapping circles. They are the pattern the picker shows now.' },
      { kind: 'added', text: 'Pattern fill: an optional rim round the edge, and the clear centre starts switched off.' },
      { kind: 'added', text: 'Family tree: letter spacing, and a branch under each name that holds the rows together.' },
      { kind: 'fixed', text: 'The licence reminder goes away on its own, and several downloads no longer stack several of them up.' },
    ],
  },
  {
    date: '2026-09-22',
    title: 'Laser Studio is live',
    changes: [
      { kind: 'added', text: 'Forty-two designs, on the Vostok Labs site — keychains, pet and luggage tags, ornaments, QR stands, coasters, cake toppers, signs and pattern fills.' },
      { kind: 'added', text: 'A MakerWorld version, where the cut file goes straight to MakerLab instead of your downloads folder.' },
    ],
  },
  {
    date: '2026-09-21',
    title: 'Five QR display stands',
    changes: [
      { kind: 'added', text: 'One QR display stand template with leaning plaque, curved foot, sign-in plaque, double QR and rounded-corner styles.' },
      { kind: 'added', text: 'Personalize the lettering, QR symbols and logo; export matching base parts and separate QR plaques for layered styles.' },
    ],
  },
  {
    date: '2026-09-20',
    title: 'Editable symbols and a quieter workspace',
    changes: [
      { kind: 'added', text: 'A visual symbol library with monochrome emoji, filled icons, search and your own SVG imports.' },
      { kind: 'added', text: 'Drag symbols within your text. Select one to resize, offset, rotate, replace or remove it; project saves keep its geometry.' },
      { kind: 'added', text: '2D Design, an orbitable 3D material preview, and a dedicated Export Preview with operation colors.' },
      { kind: 'changed', text: 'Compact symbol actions and contextual settings keep the text visible and the workspace quieter.' },
    ],
  },
  {
    date: '2026-09-19',
    title: 'First version',
    changes: [
      { kind: 'added', text: 'A gallery of laser designs. Pick one, type your text, download the SVG — red cuts, blue scores, black engraves.' },
      { kind: 'added', text: 'Name keychain, name tag, symbol charm and connected text to start with; every font in the library, every symbol.' },
    ],
  },
];

