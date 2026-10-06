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
import { buildObjMtl, type ObjMtl } from '@vostok/export';
import type { PlateChoice } from '@vostok/plates';
import type { ClickerPart } from '../types';
import { assemblyMinZ, objectKeyOf, placed, plateLayout } from './plateLayout';
import { clickerMark } from './threemfExport';

export interface ClickerObjOptions {
  /** The bed to lay the plate out on. Defaults to the plate picker's shared preference, as the
   *  3MF's does. */
  plate?: PlateChoice;
  /** What the OBJ's `mtllib` line names. Default `clicker.mtl`. */
  mtlFileName?: string;
  /** The file a Model-mode clicker was cut from, so the mark does not claim its shape. */
  sourceModel?: string;
}

/** One print plate as an OBJ and its MTL, from the parts the 3MF is written from. */
export function clickerObjMtl(parts: ClickerPart[], opts: ClickerObjOptions = {}): ObjMtl {
  const minZ = assemblyMinZ(parts);
  const layout = plateLayout(parts, minZ, { plate: opts.plate });
  return buildObjMtl(
    parts.map((p) => ({
      name: p.name,
      group: p.group,
      color: p.colorRgb,
      positions: placed(p, minZ, layout.placementFor(objectKeyOf(p))),
      indices: p.triVerts,
    })),
    { mtlFileName: opts.mtlFileName ?? 'clicker.mtl', provenance: clickerMark(opts.sourceModel) },
  );
}
