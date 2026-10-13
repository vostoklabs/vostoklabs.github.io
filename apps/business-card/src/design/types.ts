// The flat design every template draws: what the card's faces look like, in millimetres, centred on
// the origin, Y up, seen from the front. Nothing here knows how it will be printed: the worker
// (geometry/solid.ts) turns it into raised or flush parts, one per colour.
import type { Box, Pt, Ring, Shapes } from '@vostok/shapes';
import type { LatticeCut } from '@vostok/patterns';

/** What a piece of the card is, which decides its colour (Colors lets each be set on its own). */
export type Role = 'card' | 'shapes' | 'name' | 'details' | 'icons' | 'rule' | 'logo' | 'qr' | 'pattern';

/** Part of a face in one colour: lettering, a rule, a QR code, a logo, an icon. In the card's own
 *  colour it is a relief: raised in the card's filament, or on a flush card simply card. */
export interface Ink {
  role: Role;
  /** Its colour, `#rrggbb`. */
  colour: string;
  shapes: Shapes;
  /** How far the outline is pushed out, mm, so its thinnest stroke still prints with the nozzle.
   *  Set on lettering from the face's own stroke and the size it was set at. */
  grow?: number;
  /** Left open inside `shapes` (a QR tile's modules, a badge's glyph). */
  minus?: Shapes;
  /** Where it crosses the colour fields it takes this colour instead (a name running across a
   *  split, light on the dark half and dark on the light). */
  onFields?: string;
}

/** A template's pattern area, filled by the pattern engine. */
export interface PatternPart {
  /** In a colour of its own, carved into the face, or cut right through the card. */
  mode: 'colour' | 'carved' | 'cut';
  colour: string;
  /** Colour or carved: the regions. Cut: the holes to punch (empty when cut as a lattice). */
  shapes: Shapes;
  /** Trim the regions to this zone (an island the engine could not clip itself). */
  keep?: Shapes;
  /** Shrink what the pattern paints by this, mm (a tile's own thicken setting). */
  erode?: number;
  /** Cut as a lattice: the recipe whose faces take booleans, worked out in the worker. */
  lattice?: LatticeCut;
}

/** One face of the card, in the front's frame (a back is turned over before it gets here). */
export interface Face {
  /** The colour fields of the face: a swoosh, a band, a disc. One colour: `Design.fieldColour`. */
  fields: Shapes;
  /** Thin lines of card left open inside the fields (an echo of a curve). */
  gaps: Shapes;
  ink: Ink[];
  pattern: PatternPart | null;
  /** Carved into the face, the card's own colour (or the reveal colour showing at the bottom). */
  carved: Shapes;
}

export interface Design {
  /** The card, mm, in the orientation it reads in. */
  w: number;
  h: number;
  outline: Ring;
  /** The card's colour and the colour fields' colour. */
  card: string;
  fieldColour: string;
  /** Holes through the card that the template drew (a window, a notch). */
  cutouts: Shapes;
  front: Face;
  /** The back, already turned into the front's frame. Null on a one-sided card. */
  back: Face | null;
  /** The card under the front's top layers prints in this colour, so whatever is carved into
   *  the front shows it (a monogram cut through a dark skin into gold). Null: one colour. */
  reveal: string | null;
  /** Where an NFC tag sits, with solid card all round it, and the tag's radius. */
  pocket: { at: Pt; r: number } | null;
  /** Each QR code as placed: its square with the quiet zone, and the face it is on (a back's in
   *  the front's frame, as the back's ink is). */
  qrs: { side: 'front' | 'back'; box: Box }[];
  /** What will not print or will not scan. Shown, and it stops the export. */
  warnings: string[];
  /** Status clauses that are fine to print. */
  notes: string[];
}

export const emptyFace = (): Face => ({ fields: [], gaps: [], ink: [], pattern: null, carved: [] });
