// The keycap's 3MF, written by the shelf's writer (@vostok/export, "3MF export"). This file only
// says what the keycap is to it: one slicer object, "keycap", with a part per body on the
// filament slot each one asks for, centred on the plate the customer picked.
import { buildThreeMF as writeThreeMF } from '@vostok/export';
import { plateSize, loadPlateChoice } from '@vostok/plates';
import { keycapMark, shelfPart } from './exportParts.js';

/**
 * Build the keycap's 3MF.
 *
 * @param {Array<{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}>} parts
 *        One entry per body. Order is preserved. `extruder` is the 1-based filament slot
 *        (1 = keycap colour, 2 = legend colour); the stem rides on slot 2 in shine-through.
 * @param {{ process?: Record<string, string | string[]> }} [opts] `process`: slicer settings
 *        applied over the system process (the Print settings wall choice), written into
 *        project_settings.config.
 * @returns {Blob} the file, typed `model/3mf`.
 */
export function keycapThreeMF(parts, { process } = {}) {
  const bytes = writeThreeMF(
    parts.map((p) => ({ ...shelfPart(p), group: 'keycap' })),
    {
      ...keycapMark(),
      plateSize: plateSize(loadPlateChoice()),
      process,
    },
  );
  return new Blob([bytes], { type: 'model/3mf' });
}
