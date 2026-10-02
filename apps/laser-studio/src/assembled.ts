// Where the pieces of a design sit once it is put together — no DOM in it, so a node test can
// hold it to the rule. Two readers: the gallery card draws the flat stack (`assembledLayout`),
// and the 3D view stands the product up (`assembledPieces`).
import { bboxOf, type Box, type Shapes } from '@vostok/laser';
import type { BuildObject, BuildOutput, PartPlacement, Pose } from './engine/types';

export interface Assembled {
  pieces: { part: PartPlacement; dx: number; dy: number }[];
  box: Box;
  /** How many copies a batch made: the stack shown is the first one's. */
  total: number;
}

/** Which tier a piece is drawn on: its own `z` when it has one, else the tone it used to be
 *  inferred from. Lower draws first, and so ends up behind. */
export const zOf = (part: PartPlacement): number => part.z ?? (part.material !== 'light' ? 0 : 1);

/** The pieces a design owns, batch copies set aside: a batch is the same design over again, so
 *  the stack to show is the FIRST name's pieces. A copy's parts carry positions in their own
 *  frame, so drawing them would pile every name onto the first. */
function ownParts(out: BuildOutput): { own: PartPlacement[]; copies: number } {
  const copies = out.parts.filter((p) => /^copy-\d+$/.test(p.id)).length;
  return { own: copies ? out.parts.filter((p) => !p.id.startsWith('copy-')) : out.parts, copies };
}

const centreOf = (b: Box) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** Where every piece sits once the design is glued up — when the template said. Back tier
 *  first, so a frame lands over its backer. Null for a design that is already one piece. */
export function assembledLayout(out: BuildOutput): Assembled | null {
  const { own, copies } = ownParts(out);
  if (!copies && !own.some((p) => p.assembledAt)) return null;
  const pieces = own.map((part) => {
    const c = centreOf(part.box);
    const at = part.assembledAt ?? c;
    return { part, dx: at.x - c.x, dy: at.y - c.y };
  });
  // A piece says where it goes with `z`; absent, the sheet decides as it always did — `dark` (a
  // backer) and `card` (the kraft holder) sit UNDER the light pieces. The sort is stable, so
  // pieces on the same tier keep their order and the primary is still first among equals.
  pieces.sort((a, b) => zOf(a.part) - zOf(b.part));
  let box: Box | null = null;
  for (const { part, dx, dy } of pieces) {
    const b = { minX: part.box.minX + dx, minY: part.box.minY + dy, maxX: part.box.maxX + dx, maxY: part.box.maxY + dy };
    box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b;
  }
  return { pieces, box: box!, total: copies + 1 };
}

export interface Piece3D {
  id: string;
  /** The piece's outline islands and marks, in its own frame: box centre at the origin. */
  plate: Shapes;
  objects: BuildObject[];
  pose: Pose;
  material: NonNullable<PartPlacement['material']>;
  /** How thick this piece really is, mm. The sheet's own thickness for a wooden piece; a card
   *  piece is CARD, not plywood, so it is 0.6 mm whatever the sheet slider says. */
  thickness: number;
  /** The face colour, when the piece is not cut from the plain sheet. Absent = the sheet's. */
  hex?: string;
}

/** A sheet of card, mm: 300–350 gsm kraft, the stock a jewellery display card is really cut
 *  from. In the bracelet set's 3D view the holder that should be craft paper looked like the
 *  same 3 mm plywood — it was, because every piece was extruded through the
 *  one thickness the slider named. */
export const CARD_THICKNESS = 0.6;

/** The face tones the 3D view paints a piece that is not the plain sheet. The same two colours
 *  the flat Assembled view uses (`DARK` / `CARD` in preview.ts) — repeated rather than imported
 *  because that file owns a DOM and this one has to stay node-testable. */
const TONE: Partial<Record<NonNullable<PartPlacement['material']>, string>> = {
  dark: '#8a5a2b',
  card: '#b58e63',
};

/** How thick a piece cut from this material is, given the sheet the customer named. */
export const thicknessOf = (part: Pick<PartPlacement, 'material'>, sheet: number): number =>
  part.material === 'card' ? CARD_THICKNESS : sheet;

const within = (b: Box, box: Box) => b.minX >= box.minX - 0.05 && b.maxX <= box.maxX + 0.05 && b.minY >= box.minY - 0.05 && b.maxY <= box.maxY + 0.05;
const shift = (shapes: Shapes, dx: number, dy: number): Shapes => shapes.map((island) => island.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as [number, number])));

/**
 * The product standing on the table, piece by piece, for the 3D view.
 *
 * A piece with a `pose` goes exactly where it says. One without goes where its `assembledAt`
 * put it on the flat stack, lying on its tier: the lowest tier on the table and each one above
 * resting on the one below — so a two-layer keychain really is two sheets glued together, and a
 * bracelet bar lying on a 0.6 mm kraft card sits 0.6 mm up rather than a whole sheet up. Null
 * for a design that is one flat piece with nothing to assemble: the plain sheet render is right.
 */
export function assembledPieces(out: BuildOutput, thickness: number): Piece3D[] | null {
  const { own, copies } = ownParts(out);
  // A lone flat piece normally needs no assembly — the 3D view can extrude the sheet itself. The
  // exception is a piece cut from something OTHER than the sheet: a place card is 0.6 mm of kraft,
  // and left to the sheet it rendered as a 3 mm plank. Its material is reason
  // enough to build the stack, so the thickness and the tone are its own.
  if (!copies && !own.some((p) => p.assembledAt || p.pose || (p.material && p.material !== 'light'))) return null;
  // Each tier rests on the one under it, so a tier's base is the sum of the tiers below — and a
  // tier is only as tall as its thickest piece. With one material throughout this is exactly
  // what it always was (tier k at k × thickness); it only differs where the tiers differ.
  const tiers = [...new Set(own.map(zOf))].sort((a, b) => a - b);
  const base = new Map<number, number>();
  let floor = 0;
  for (const tier of tiers) {
    base.set(tier, floor);
    floor += Math.max(...own.filter((p) => zOf(p) === tier).map((p) => thicknessOf(p, thickness)));
  }
  return own.map((part) => {
    const c = centreOf(part.box);
    const islands = out.plate.filter((isl) => within(bboxOf([isl]), part.box));
    // A part's objects carry its id as a prefix; the primary's carry none.
    const prefix = part.id === 'main' ? null : `${part.id}:`;
    const objects = out.objects
      .filter((o) => o.id !== 'plate' && !o.image && (prefix ? o.id.startsWith(prefix) : !o.id.includes(':')))
      .map((o) => ({ ...o, shapes: shift(o.shapes, -c.x, -c.y), ...(o.paths ? { paths: o.paths.map((p) => p.map(([x, y]) => [x - c.x, y - c.y] as [number, number])) } : {}) }));
    const at = part.assembledAt ?? c;
    const material = part.material ?? 'light';
    const t = thicknessOf(part, thickness);
    const pose: Pose = part.pose ?? { x: at.x, y: at.y, z: base.get(zOf(part))! + t / 2 };
    return { id: part.id, plate: shift(islands, -c.x, -c.y), objects, pose, material, thickness: t, ...(TONE[material] ? { hex: TONE[material] } : {}) };
  });
}
