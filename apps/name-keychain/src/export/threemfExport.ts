// The keychain's 3MF, written by the shelf's writer (@vostok/export, "3MF export"): one slicer
// object, "name_keychain", with a part per colour, centred on the plate the customer picked.
import { buildThreeMF as writeThreeMF, downloadFile } from '@vostok/export';
import { plateSize, loadPlateChoice } from '@vostok/plates';
import type { PartMesh } from '../types';

export function buildThreeMF(parts: PartMesh[]): Uint8Array {
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return writeThreeMF(
    // The worker sends xyz only, three floats a vertex, so the arrays go over as they are.
    parts.map((p) => ({
      name: p.name,
      color: p.colorRgb,
      positions: p.vertProperties,
      indices: p.triVerts,
      group: 'name_keychain',
    })),
    {
      title: 'Name Keychain',
      generator: 'name-keychain-generator',
      application: 'Vostok Labs Name Keychain Generator',
      buildId: env.VITE_BUILD_ID,
      plateSize: plateSize(loadPlateChoice()),
    },
  );
}

export function downloadThreeMF(parts: PartMesh[], fileName = 'keychain.3mf'): void {
  downloadFile(buildThreeMF(parts), fileName, 'model/3mf');
}
