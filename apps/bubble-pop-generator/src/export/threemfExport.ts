// The 3MF, written by the shelf's writer (@vostok/export, "3MF export"). This file only says
// what the model is to it.
//
//  - The slab (body + colour inlays) is one slicer object and every button is its own. The
//    buttons print in place and never move, but they still have to be separate objects: fused
//    into the slab, the slicer could not give them their own filament, and nobody could
//    re-print a single lost button.
//  - The assembly is built flat-back-down (Z = 0 is the back face), so it prints as it is,
//    centred on the plate the customer picked.
import { buildThreeMF as writeThreeMF, downloadFile, exportPartOf } from '@vostok/export';
import { plateSize, loadPlateChoice } from '@vostok/plates';
import type { PopPart } from '../types';

export function buildThreeMF(parts: PopPart[]): Uint8Array {
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return writeThreeMF(
    parts.map((p) =>
      exportPartOf(p, {
        name: p.name,
        color: p.colorRgb,
        group: p.group === 'body' ? 'pop-fidget' : p.group,
        extruder: p.extruder,
      }),
    ),
    {
      title: 'Bubble Pop Fidget',
      generator: 'bubble-pop-generator',
      application: 'Vostok Labs Bubble Pop Generator',
      buildId: env.VITE_BUILD_ID,
      plateSize: plateSize(loadPlateChoice()),
    },
  );
}

export function downloadThreeMF(parts: PopPart[], fileName = 'bubble-pop.3mf'): void {
  downloadFile(buildThreeMF(parts), fileName, 'model/3mf');
}
