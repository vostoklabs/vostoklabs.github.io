// The keycap's OBJ and MTL, the files the MakerLab export hands the host, written by the shelf's
// writer (@vostok/export, "OBJ export"). This file only says what the keycap is to it: the parts
// keycapThreeMF takes (exportParts.js converts them for both), one material per filament slot,
// and the provenance mark in the header (invariant #2).
//
// A material per SLOT rather than per colour: a cap and a legend set to the same colour are
// still two filaments in the 3MF, someone may have asked for that on purpose, and the OBJ keeps
// them as two materials too.
import { buildObjMtl, objWriter, objMaterials } from '@vostok/export';
import { keycapMark, shelfPart } from './exportParts.js';

/**
 * The OBJ (+ matching MTL) of one print plate.
 *
 * @param {Array<{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}>} parts
 *        Same shape keycapThreeMF() takes. `extruder` is the 1-based filament slot; parts
 *        sharing a slot share one material (cap + stem are both slot 1 normally).
 * @param {{ mtlFileName?: string }} [opts]
 * @returns {{ obj: string, mtl: string }}
 */
export function keycapObjMtl(parts, { mtlFileName = 'model.mtl' } = {}) {
  const { obj, mtl } = buildObjMtl(parts.map(shelfPart), { mtlFileName, materialBy: 'extruder', provenance: keycapMark() });
  return { obj, mtl };
}

/**
 * An OBJ plate written one part at a time.
 *
 * A keyboard set carves 61–87 caps one after another, and holding every finished body until the
 * end would keep tens of megabytes of geometry alive for no reason. A writer lets the set builder
 * add each cap the moment it is carved and dispose of the geometry at once.
 *
 * `materials` (`objMaterials()` from @vostok/export) is shared by every plate of one export, so
 * each names a filament slot the same way; `buildMtl(materials)` is the export's one MTL.
 *
 * @param {{ mtlFileName?: string, materials?: import('@vostok/export').ObjMaterials }} [opts]
 */
export function keycapObjWriter({ mtlFileName = 'model.mtl', materials = objMaterials() } = {}) {
  const writer = objWriter({ mtlFileName, materials, materialBy: 'extruder', provenance: keycapMark() });
  return {
    /** @param {{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}} p */
    add: (p) => writer.add(shelfPart(p)),
    /** Nothing written yet: an empty plate must never be handed to the host. */
    get isEmpty() { return writer.isEmpty; },
    get text() { return writer.text; },
  };
}
