// The keycap's 3MF, written by the shelf's writer (@vostok/export, "3MF export"). This file only
// says what the keycap is to it: one slicer object, "keycap", with a part per body on the
// filament slot each one asks for, centred on the plate the customer picked.
import { buildThreeMF as writeThreeMF } from '@vostok/export';
import { plateSize, loadPlateChoice } from '@vostok/plates';
import { weldPositions } from './meshUtils.js';

/** "#rrggbb" -> [r, g, b]. */
const rgbOf = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

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
export function buildThreeMF(parts, { process } = {}) {
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = import.meta.env ?? {};
  const bytes = writeThreeMF(
    parts.map((p) => {
      // Manifold output is already a clean, indexed, watertight solid — use it as-is.
      // Only weld when handed a non-indexed mesh (don't re-weld and risk false merges).
      const g = p.geom.index ? p.geom : weldPositions(p.geom);
      const idx = g.getIndex().array;
      return {
        name: p.name,
        color: rgbOf(p.color),
        extruder: p.extruder,
        positions: g.getAttribute('position').array,
        // three keeps a small mesh's index as 16-bit; the writer takes 32.
        indices: idx instanceof Uint32Array ? idx : Uint32Array.from(idx),
        group: 'keycap',
      };
    }),
    {
      title: 'Keycap',
      generator: 'keycap-generator',
      buildId: env.VITE_BUILD_ID,
      plateSize: plateSize(loadPlateChoice()),
      process,
    },
  );
  return new Blob([bytes], { type: 'model/3mf' });
}
