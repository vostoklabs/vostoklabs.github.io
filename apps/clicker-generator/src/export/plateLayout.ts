// Where the clicker's pieces sit on the build plate, shared by every exporter.
//
// The model is authored as an assembly: the cap rests on top of the base, image
// face up. That is right for the viewer and wrong for printing — so before
// export every piece is laid out flat, with the tops flipped face-down. This used
// to live inside the 3MF writer only, which meant the OBJ (MakerLab host) route
// shipped the stacked assembly and slicers read it as one merged object. Both
// writers now call through here.
//
// It also used to place exactly two things, side by side, with no idea how wide the
// bed was. That was fine for one clicker and wrong for everything else:
//
//   • Blocks mode already produces N clickers in a row. At six letters the two strips
//     side by side are wider than an A1 bed, and the export said nothing — the file
//     simply arrived with half the model off the plate.
//   • The plate picker was decoration. Every export was written against the A1 preset
//     whichever plate the user had chosen, so an A1 mini owner got a layout that could
//     not print and a H2D owner got one needlessly cramped.
//
// So the arrangement is a real pack now, against the plate the user picked, and it
// reports what did not fit instead of leaving it off the bed.
import { packFits, loadPlateChoice, plateLabel, type PlateChoice } from '@vostok/plates';
import type { ClickerPart, PartGroup } from '../types';

/**
 * How a piece's meshes land on the plate. `flip` rotates 180° around X (a proper
 * rotation, so triangle winding stays valid); the offsets apply after the flip.
 */
export type Placement = { flip: boolean; tx: number; ty: number; tz: number };

export const IDENTITY: Placement = { flip: false, tx: 0, ty: 0, tz: 0 };

/** Apply a placement to one vertex, in mesh coordinates. */
export function place(
  x: number,
  y: number,
  z: number,
  pl: Placement,
): [number, number, number] {
  return pl.flip
    ? [x + pl.tx, -y + pl.ty, -z + pl.tz]
    : [x + pl.tx, y + pl.ty, z + pl.tz];
}

/**
 * Which independently-movable object a part belongs to on the plate.
 *
 * For one clicker this is just its `group` — two objects, "top" and "base", exactly as
 * before. A batch run sets `objectKey` per row (`r03:top`, `r03:base`) so forty clickers
 * are eighty separately-placeable objects rather than two stacks of forty.
 *
 * `group` is left alone and still means what it always meant — which half this is — because
 * that is what decides whether the piece gets flipped face-down. Widening `PartGroup` itself
 * would have rippled through both exporters and `buildBlocks`; a second, optional field does
 * not.
 */
export function objectKeyOf(p: ClickerPart): string {
  return p.objectKey ?? p.group;
}

/** Lowest Z across every part — the shift that drops the assembly onto the bed. */
export function assemblyMinZ(parts: ClickerPart[]): number {
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.vertProperties.length; i += p.numProp) {
      if (p.vertProperties[i] < minZ) minZ = p.vertProperties[i];
    }
  }
  return isFinite(minZ) ? minZ : 0;
}

export interface BBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/** Axis-aligned bounding box for one plate object's parts (after the minZ shift). */
export function groupBBox(parts: ClickerPart[], key: string, minZ: number): BBox {
  let bMinX = Infinity, bMaxX = -Infinity;
  let bMinY = Infinity, bMaxY = -Infinity;
  let bMinZ = Infinity, bMaxZ = -Infinity;
  for (const p of parts) {
    if (objectKeyOf(p) !== key) continue;
    const np = p.numProp;
    const vp = p.vertProperties;
    for (let i = 0; i < vp.length; i += np) {
      const x = vp[i], y = vp[i + 1], z = vp[i + 2] - minZ;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
      if (z < bMinZ) bMinZ = z;
      if (z > bMaxZ) bMaxZ = z;
    }
  }
  return { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY, minZ: bMinZ, maxZ: bMaxZ };
}

/** The plate objects an export contains, in the order their parts first appear. */
export function objectKeys(parts: ClickerPart[]): string[] {
  const seen: string[] = [];
  for (const p of parts) {
    const k = objectKeyOf(p);
    if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

const GAP_MM = 5; // spacing between neighbours on the build plate

export interface PlateLayoutOptions {
  /** Which bed to pack against. Defaults to the picker's shared preference, so the plate
   *  the user is looking at is the plate the file is laid out for. */
  plate?: PlateChoice;
}

export interface PlateLayoutResult {
  /** Placement for one plate object, by its `objectKey`. */
  placementFor(key: string): Placement;
  /** How many plates the arrangement needs. More than one means more than one print. */
  plates: number;
  /** Object keys too big for the usable area at all — these overhang wherever they go. */
  oversized: string[];
  /** The plate it was packed against. */
  plate: PlateChoice;
}

/**
 * Lay every plate object flat on the chosen bed: seated on Z=0, tops flipped face-down,
 * packed left-to-right and front-to-back with a gap.
 *
 * Callers bake the result into vertices rather than emitting a transform. Slicers decide
 * whether a multi-object file is really one multi-part assembly by comparing the objects'
 * *mesh* bounding boxes: with a transform-only split the top's mesh still floats above the
 * base, and Bambu Studio merges the two into a single object with parts — precisely what we
 * don't want.
 */
export function plateLayout(
  parts: ClickerPart[],
  minZ: number,
  opts: PlateLayoutOptions = {},
): PlateLayoutResult {
  const plate = opts.plate ?? loadPlateChoice();
  const keys = objectKeys(parts);
  const boxes = keys.map((k) => groupBBox(parts, k, minZ));

  // What each object takes up on the bed. The flip mirrors Y but does not change the size of
  // the box, so this is the same before and after it.
  const footprints = boxes.map((b) => ({
    w: isFinite(b.minX) ? b.maxX - b.minX : 0,
    d: isFinite(b.minY) ? b.maxY - b.minY : 0,
  }));
  const packed = packFits(footprints, plate, { gap: GAP_MM });

  // Which half this is decides whether it goes face-down. Read off the parts rather than the
  // key, so a batch row's `r03:top` flips for the same reason a lone `top` does.
  const groupOf = new Map<string, PartGroup>();
  for (const p of parts) if (!groupOf.has(objectKeyOf(p))) groupOf.set(objectKeyOf(p), p.group);

  const placements = new Map<string, Placement>();
  keys.forEach((key, i) => {
    const b = boxes[i];
    if (!isFinite(b.minX)) return;
    const slot = packed.placements[i] ?? { plate: 0, x: 0, y: 0 };
    if (groupOf.get(key) === 'top') {
      // Flip 180° around X so the image face is down on the build plate. After the flip a
      // vertex is (x, −y, −z), so landing the object's minimum corner on the slot means
      // undoing the mirror with the box's MAXIMUM: ty from maxY, tz from maxZ.
      placements.set(key, {
        flip: true,
        tx: slot.x - b.minX,
        ty: slot.y + b.maxY,
        tz: b.maxZ,
      });
    } else {
      // Seat the object on the plate in its own right — one left floating above Z=0 is what
      // makes a slicer read the file as a single stacked assembly.
      placements.set(key, {
        flip: false,
        tx: slot.x - b.minX,
        ty: slot.y - b.minY,
        tz: -b.minZ,
      });
    }
  });

  return {
    placementFor: (key: string): Placement => placements.get(key) ?? IDENTITY,
    plates: packed.plates,
    oversized: packed.oversized.map((i) => keys[i]).filter(Boolean),
    plate,
  };
}


/**
 * What the user needs to be told about the plate before they print, in plain words.
 *
 * The layout has always known this and never said it. A blocks chain of six letters is wider
 * than an A1 bed, and the export simply wrote it anyway: the file opened with half the model
 * hanging off the plate, and the first anyone knew was the slicer refusing to slice. Now the
 * pack wraps it onto a second plate — which is a different thing worth saying, because it means
 * two prints rather than one.
 */
export function plateWarnings(parts: ClickerPart[], opts: PlateLayoutOptions = {}): string[] {
  if (!parts.length) return [];
  const layout = plateLayout(parts, assemblyMinZ(parts), opts);
  const out: string[] = [];
  if (layout.oversized.length) {
    out.push(
      `${layout.oversized.length === 1 ? 'One piece is' : `${layout.oversized.length} pieces are`} `
      + `too big for the ${plateLabel(layout.plate)} — it will overhang. `
      + 'Reduce the size, or pick a bigger plate.',
    );
  } else if (layout.plates > 1) {
    out.push(`This needs ${layout.plates} plates on the ${plateLabel(layout.plate)} — that is ${layout.plates} prints.`);
  }
  return out;
}
