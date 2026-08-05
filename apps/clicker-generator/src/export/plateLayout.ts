// Where the clicker's halves sit on the build plate, shared by every exporter.
//
// The model is authored as an assembly: the cap rests on top of the base, image
// face up. That is right for the viewer and wrong for printing — so before
// export both groups are laid out flat and side by side, with the top flipped
// face-down. This used to live inside the 3MF writer only, which meant the OBJ
// (MakerLab host) route shipped the stacked assembly and slicers read it as one
// merged object. Both writers now call through here.
import type { ClickerPart, PartGroup } from '../types';

/**
 * How a group's meshes land on the plate. `flip` rotates 180° around X (a proper
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

/** Axis-aligned bounding box for one group's parts (after the minZ shift). */
export function groupBBox(
  parts: ClickerPart[],
  groupId: PartGroup,
  minZ: number,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  let bMinX = Infinity, bMaxX = -Infinity;
  let bMinY = Infinity, bMaxY = -Infinity;
  let bMinZ = Infinity, bMaxZ = -Infinity;
  for (const p of parts) {
    if (p.group !== groupId) continue;
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

const GAP_MM = 5; // spacing between base and top on the build plate

/**
 * Plate layout for the whole assembly: every group seated on Z=0, the top
 * flipped face-down and parked beside the base with a gap.
 *
 * Callers bake the result into vertices rather than emitting a transform.
 * Slicers decide whether a multi-object file is really one multi-part assembly
 * by comparing the objects' *mesh* bounding boxes: with a transform-only split
 * the top's mesh still floats above the base, and Bambu Studio merges the two
 * into a single object with parts — precisely what we don't want.
 */
export function plateLayout(
  parts: ClickerPart[],
  minZ: number,
): (group: PartGroup) => Placement {
  const baseBB = groupBBox(parts, 'base', minZ);
  const topBB = groupBBox(parts, 'top', minZ);

  const placements = new Map<PartGroup, Placement>();
  for (const group of ['top', 'base'] as PartGroup[]) {
    if (!parts.some((p) => p.group === group)) continue;
    if (group !== 'top') {
      // Seat the group on the plate in its own right — an object left floating
      // above Z=0 is what makes a slicer read the file as one stacked assembly.
      const bb = groupBBox(parts, group, minZ);
      placements.set(group, { ...IDENTITY, tz: isFinite(bb.minZ) ? -bb.minZ : 0 });
      continue;
    }
    // Flip 180° around X so the image face is down on the build plate, then
    // shift: +maxZ lands the flipped part back on Z=0, 2*centerY undoes the Y
    // inversion, and the X offset parks it beside the base with a gap.
    const baseWidth = isFinite(baseBB.maxX) ? baseBB.maxX - baseBB.minX : 0;
    const topWidth = isFinite(topBB.maxX) ? topBB.maxX - topBB.minX : 0;
    const baseCenterX = isFinite(baseBB.minX) ? (baseBB.minX + baseBB.maxX) / 2 : 0;
    const topCenterX = isFinite(topBB.minX) ? (topBB.minX + topBB.maxX) / 2 : 0;
    const topCenterY = isFinite(topBB.minY) ? (topBB.minY + topBB.maxY) / 2 : 0;
    placements.set(group, {
      flip: true,
      tx: baseCenterX + baseWidth / 2 + GAP_MM + topWidth / 2 - topCenterX,
      ty: 2 * topCenterY,
      tz: isFinite(topBB.maxZ) ? topBB.maxZ : 0,
    });
  }
  return (group: PartGroup): Placement => placements.get(group) ?? IDENTITY;
}
