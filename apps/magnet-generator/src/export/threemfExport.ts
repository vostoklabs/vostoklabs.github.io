// The magnet's 3MF, written by the shelf's writer (@vostok/export, "3MF export"). This file only
// says what the magnet is to it.
//
//  - A fridge magnet is one slicer object, "magnet". A slider is two separate physical pieces,
//    "slider-piece-1" and "slider-piece-2": fused into one object, the slicer could not move or
//    duplicate either half on its own.
//  - The assembly is built flat-back-down (Z = 0 is the back face), so it prints as it is,
//    centred on the plate the customer picked.
import { buildThreeMF as writeThreeMF, downloadFile, exportPartOf } from '@vostok/export';
import { plateSize, loadPlateChoice } from '@vostok/plates';
import type { MagnetPart } from '../types';

export function buildThreeMF(parts: MagnetPart[]): Uint8Array {
  // The pieces in the order the worker sends them: the magnet, then the slider's twin.
  const pieces = [...new Set(parts.map((p) => p.group))];
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return writeThreeMF(
    parts.map((p) =>
      exportPartOf(p, {
        name: p.name,
        color: p.colorRgb,
        group: pieces.length > 1 ? `slider-piece-${pieces.indexOf(p.group) + 1}` : 'magnet',
        extruder: p.extruder,
      }),
    ),
    {
      title: 'Magnet',
      generator: 'magnet-generator',
      application: 'Vostok Labs Magnet Generator',
      buildId: env.VITE_BUILD_ID,
      plateSize: plateSize(loadPlateChoice()),
    },
  );
}

export function downloadThreeMF(parts: MagnetPart[], fileName = 'magnet.3mf'): void {
  downloadFile(buildThreeMF(parts), fileName, 'model/3mf');
}
