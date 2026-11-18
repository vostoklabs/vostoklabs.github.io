// The clicker's OBJ and MTL, for the embedded export path, written by the shelf's writer
// (@vostok/export, "OBJ export"). This file only says what the clicker is to it.
//
//  - The same plate the 3MF is written for: plateLayout() drops the assembly to the bed and packs
//    the pieces, tops face down, and the placement is baked into the vertices, so the OBJ and the
//    .3mf describe one print-ready plate.
//  - One `o` object per part, named by its group and name (`top_…`, `base_…`), so the top/base
//    grouping the 3MF writes as objects is still readable downstream: OBJ has no grouping of its
//    own, which is why the halves must already be apart in the coordinates handed over.
//  - One material per colour, numbered as the 3MF numbers its filament slots.
//  - The provenance mark in the header comment, the same mark the 3MF carries.
//  - Sent to MakerLab, a clicker's top and body go as two plates (`clickerObjPlates`), so each
//    is an object of its own there.
import { buildObjMtl, buildObjMtlPlates, type ObjMtl } from '@vostok/export';
import type { PlateChoice } from '@vostok/plates';
import type { ClickerPart } from '../types';
import { assemblyMinZ, objectKeyOf, placed, plateLayout } from './plateLayout';
import { FIRST_LAYER_INFILL_SPEED, FIRST_LAYER_SPEED, clickerMark } from './threemfExport';

/** `CLICKER_PROCESS` in the terms MakerLab's export takes: the host writes these into the 3MF it
 *  assembles. Every value a string, by the host's rule; a key it has no field for goes in as is. */
export const CLICKER_HOST_PRINT: Record<string, string> = {
  wallGenerator: 'arachne',
  only_one_wall_first_layer: '1',
  initial_layer_speed: FIRST_LAYER_SPEED,
  initial_layer_infill_speed: FIRST_LAYER_INFILL_SPEED,
};

export interface ClickerObjOptions {
  /** The bed to lay the plate out on. Defaults to the plate picker's shared preference, as the
   *  3MF's does. */
  plate?: PlateChoice;
  /** What the OBJ's `mtllib` line names. Default `clicker.mtl`. */
  mtlFileName?: string;
  /** The file a Model-mode clicker was cut from, so the mark does not claim its shape. */
  sourceModel?: string;
}

/** The parts as the shelf's OBJ writer takes them, laid out on one plate. */
function objParts(parts: ClickerPart[], opts: ClickerObjOptions) {
  const minZ = assemblyMinZ(parts);
  const layout = plateLayout(parts, minZ, { plate: opts.plate });
  return parts.map((p) => ({
    name: p.name,
    group: p.group,
    color: p.colorRgb,
    positions: placed(p, minZ, layout.placementFor(objectKeyOf(p))),
    indices: p.triVerts,
  }));
}

const objOptions = (opts: ClickerObjOptions) =>
  ({ mtlFileName: opts.mtlFileName ?? 'clicker.mtl', provenance: clickerMark(opts.sourceModel) });

/** One print plate as an OBJ and its MTL, from the parts the 3MF is written from. */
export function clickerObjMtl(parts: ClickerPart[], opts: ClickerObjOptions = {}): ObjMtl {
  return buildObjMtl(objParts(parts, opts), objOptions(opts));
}

/** Whether a set of parts is one clicker with both a top and a body: a flat clicker, a set of
 *  letter blocks or a cut model, however many buttons it has. The fit test's tiles and a batch
 *  run name their own objects (`objectKey`) and are not. */
export function splitsTopAndBody(parts: ClickerPart[]): boolean {
  return parts.every((p) => !p.objectKey || p.objectKey.startsWith('button-'))
    && parts.some((p) => p.group === 'top')
    && parts.some((p) => p.group === 'base');
}

/** The print as the embedded export sends it: one OBJ per plate and one MTL for all of them.
 *  A clicker with a top and a body goes as two plates, the top on plate 1 and the body on
 *  plate 2, so each arrives as an object of its own; every part of the top stays in the top's
 *  OBJ, so its colours stay registered. Anything else is the one plate `clickerObjMtl` writes,
 *  text for text. */
export function clickerObjPlates(parts: ClickerPart[], opts: ClickerObjOptions = {}): { objs: string[]; mtl: string } {
  if (!splitsTopAndBody(parts)) {
    const { obj, mtl } = clickerObjMtl(parts, opts);
    return { objs: [obj], mtl };
  }
  const plated = objParts(parts, opts).map((p) => ({ ...p, plate: p.group === 'top' ? 1 : 2 }));
  const { objs, mtl } = buildObjMtlPlates(plated, objOptions(opts));
  return { objs, mtl };
}
