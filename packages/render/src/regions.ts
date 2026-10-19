import { colorForObject, colorForPart, colorForSlot, type ThreeMfPaint } from './threemf/colors';
import type { ThreeMfMeshObject } from './threemf/mesh';

/**
 * The smallest piece of a model you can point at and say "that bit, in gold".
 *
 * Colouring by *mesh* is the wrong grain for the two files that matter most. A painted 3MF is one
 * mesh with three colours in it; an assembly is one mesh with a differently-coloured cap. Neither
 * can be addressed by a key that stops at the mesh.
 *
 * A region is one run of triangles that prints in one filament, wherever that fact came from: a
 * painted face, a part of an assembly, or a whole object. Deriving them once at load and handing
 * the panel a flat list is what lets one control serve a plain STL and a four-filament painted
 * assembly with no mode switch between them.
 */
export interface PaintRegion {
  /** Stable across reloads of the same file, so overrides can be saved against it. */
  key: string;
  /** What a panel calls it: "Filament 2", "Cap", or the model's own stem. */
  label: string;
  /** Which channel produced it, which is what a panel sorts and explains by. */
  source: 'slot' | 'part' | 'object' | 'whole';
  /** The colour the file itself says, or null where the file said nothing. */
  fileHex: string | null;
  /** Triangles in the region, for the share a panel shows. */
  triangles: number;
}

/** One region's colour, as the user set it. */
export interface RegionOverride {
  hex: string;
  /** `AUTO_FINISH`, or one of `FINISHES`. */
  finishId: string;
}

/**
 * A named set of region colours.
 *
 * This is what a batch multiplies by: three colourways are three images per angle, and a
 * colourway that recolours one region of a one-region model is what a plain filament swatch is.
 */
export interface Colourway {
  id: string;
  name: string;
  /** Region key to override. A region it does not name keeps the file's own colour. */
  colours: Record<string, RegionOverride>;
}

/**
 * The colourway that changes nothing: "keep the colours the 3MF has".
 *
 * It holds no overrides at all rather than a copy of the file's colours, because a copy would go
 * stale the moment the same key meant something else. A painted file nobody touches renders as
 * it prints.
 */
export const AS_PRINTED: Colourway = { id: 'as-printed', name: 'As printed', colours: {} };

/**
 * The placeholder for a region no source coloured: a light lilac that reads as "no colour
 * stated" rather than as a choice.
 */
export const STOCK_HEX = '#b9a8f5';

/**
 * Which region each triangle of one 3MF object belongs to.
 *
 * The precedence is not arbitrary: a painted face beats the part it sits on, because painting is
 * the more specific statement. A face nobody painted keeps *its own part's* colour rather than
 * the whole object's, which is the difference between a two-tone assembly and a one-colour one.
 *
 * Regions accumulate into `into` across every object of the build, so one filament slot is one
 * row in a panel however many objects use it. Part and object regions are scoped by their
 * `.model` entry, because the Production extension only makes ids unique within a part and a
 * bare id lets object 1 of `object_3.model` answer for object 1 of another.
 */
export function assignRegions(
  object: ThreeMfMeshObject,
  paint: ThreeMfPaint | null,
  fallbackLabel: string,
  into: Map<string, PaintRegion>,
): string[] {
  const triangles = object.positions.length / 9;
  const keys = new Array<string>(triangles);

  const objectHex = paint
    ? colorForObject(paint, object.name ?? undefined, object.id, object.entry)
    : null;

  // A part per triangle, so the lookup below is a read rather than a scan. Ranges are in
  // triangles and never overlap, which is what makes one pass enough.
  const partOf = new Array<number>(triangles).fill(-1);
  const ranges = object.partRanges ?? [];
  ranges.forEach((r, i) => {
    for (let t = r.start; t < r.start + r.count && t < triangles; t++) partOf[t] = i;
  });

  const bump = (key: string, make: () => PaintRegion) => {
    const existing = into.get(key);
    if (existing) existing.triangles++;
    else into.set(key, { ...make(), triangles: 1 });
  };

  for (let t = 0; t < triangles; t++) {
    const slot = object.filaments?.[t] ?? 0;
    if (slot > 0) {
      const key = `slot-${slot}`;
      keys[t] = key;
      bump(key, () => ({
        key,
        label: `Filament ${slot}`,
        source: 'slot',
        fileHex: paint ? colorForSlot(paint, slot) : null,
        triangles: 0,
      }));
      continue;
    }

    const r = ranges[partOf[t] ?? -1];
    if (r) {
      const key = `part-${r.entry}::${r.id}`;
      keys[t] = key;
      bump(key, () => ({
        key,
        label: r.name?.trim() || `Part ${(partOf[t] ?? 0) + 1}`,
        source: 'part',
        fileHex: paint
          ? colorForPart(paint, object.id, r.id, r.name, r.entry) ?? objectHex
          : null,
        triangles: 0,
      }));
      continue;
    }

    const key = `object-${object.entry}::${object.id}`;
    keys[t] = key;
    bump(key, () => ({
      key,
      label: object.name?.trim() || fallbackLabel,
      source: 'object',
      fileHex: objectHex,
      triangles: 0,
    }));
  }

  return keys;
}

/** One run of triangles drawn with one material. `start` and `count` are in vertices. */
export interface RegionGroup {
  key: string;
  start: number;
  count: number;
}

/**
 * Sorts a triangle soup so each region is one contiguous run, ready for `addGroup`.
 *
 * A region needs its own **material**, not just its own colour: roughness, metalness and
 * clearcoat are what separate silk gold lettering from a matte black plate, and three.js has no
 * per-vertex channel for any of them. Vertex colours can carry the hue and nothing else.
 *
 * The soup is already non-indexed, three unshared vertices per triangle, so this is a sort and
 * not a rebuild. Order within a region is preserved, so a file whose triangles were already
 * grouped is copied straight through.
 *
 * **This has to run before the normals are computed**, never after: a normal attribute is
 * index-aligned with the positions it was built from, and sorting afterwards would shuffle the
 * positions out from under it.
 */
export function groupByRegion(
  positions: Float32Array,
  keys: readonly string[],
): { positions: Float32Array; groups: RegionGroup[] } {
  const order: string[] = [];
  const buckets = new Map<string, number[]>();
  keys.forEach((key, t) => {
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); order.push(key); }
    bucket.push(t);
  });

  // One region means there is nothing to reorder, which is every STL and most 3MFs.
  const only = order[0];
  if (order.length <= 1) {
    return {
      positions,
      groups: only !== undefined ? [{ key: only, start: 0, count: positions.length / 3 }] : [],
    };
  }

  const sorted = new Float32Array(positions.length);
  const groups: RegionGroup[] = [];
  let at = 0;
  for (const key of order) {
    const bucket = buckets.get(key) ?? [];
    const start = at / 3;
    for (const t of bucket) {
      sorted.set(positions.subarray(t * 9, t * 9 + 9), at);
      at += 9;
    }
    groups.push({ key, start, count: (at / 3) - start });
  }
  return { positions: sorted, groups };
}

/**
 * The colour and finish one region renders in, under one colourway.
 *
 * Three sources in order of who spoke most deliberately: the colourway the user built, the colour
 * the file itself states, and the placeholder for a file that stated nothing. That last one is a
 * placeholder and not a guess about the model.
 */
export function regionColour(
  region: PaintRegion,
  colourway: Colourway,
): { hex: string; finishId: string } {
  const override = colourway.colours[region.key];
  if (override) return override;
  return { hex: region.fileHex ?? STOCK_HEX, finishId: 'auto' };
}
