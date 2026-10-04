// The laser export (invariant #8): the keychain as a flat SVG, drawn from the same 2D profiles
// the 3D parts are extruded from, so what the laser cuts is what the preview shows.
//
// Layers are operations, in the colours laser software sorts a file by, and in the order a job
// should run: engrave first, while the sheet still holds the piece, then cut it free.
import { buildCutSvg, downloadFile } from '@vostok/export';
import type { Outline } from '../types';

export function buildKeychainSvg(outline: Outline): string {
  return buildCutSvg(
    [
      // Filled rather than stroked, so each can be engraved OR cut (layered acrylic): an
      // unfilled shape can only be cut or scored.
      { name: 'HALO', color: '#0000FF', mode: 'fill', shapes: outline.halo },
      { name: 'ENGRAVE', color: '#000000', mode: 'fill', shapes: outline.text },
      { name: 'CUT', color: '#FF0000', mode: 'line', shapes: outline.plate },
    ],
    { title: 'Name Keychain', generator: 'name-keychain-generator' },
  );
}

export function downloadKeychainSvg(outline: Outline, fileName: string): void {
  downloadFile(buildKeychainSvg(outline), fileName, 'image/svg+xml');
}
