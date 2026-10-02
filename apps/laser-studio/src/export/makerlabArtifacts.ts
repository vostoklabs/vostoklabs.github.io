// What the embedded build hands the host, as plain data.
//
// Laser Studio sends one zip holding the cut file.
//
// The literals that decide whether an export is CORRECT live here rather than in editor.ts,
// which needs a DOM and so can only be checked in a browser. These are pure values; the one
// function that touches the DOM (`coverDataUrl`) is at the bottom and does so only inside its
// own body.

import { buildZip, bytesToArrayBuffer } from '@vostok/export';
import type { MakerlabExportOptions, MakerlabZipArtifact } from 'virtual:makerlab';

/** A 1x1 transparent PNG, for when the cover render fails.
 *
 *  A cover that will not render must not be allowed to throw away an export the app has
 *  already built correctly. A blank thumbnail is cosmetic; the cut file is not. Same
 *  placeholder, same reason, as foldbox's and the keycap generator's. */
export const BLANK_COVER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Longest description the export sends. */
export const MAX_DESCRIPTION = 1000;

export function clampDescription(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}

/** The README that rides in the zip beside the SVG.
 *
 *  A zip with one anonymous file in it is worse than the file, so what goes in the second one
 *  has to earn its place. This does: it is read at the machine, which is exactly where the
 *  colour convention matters. A score line left set to Cut drops the piece out of the sheet in
 *  bits, and that is not recoverable — the sheet is already spoiled. The note the app shows on
 *  screen (`fileNoteFor`) says the same thing; on screen it can be scrolled past. */
export function readmeText(input: {
  design: string;
  fileName: string;
  note: string;
  licence: string;
  buildId?: string;
}): string {
  return [
    `${input.design} — Vostok Labs Laser Studio`,
    '',
    `File: ${input.fileName}`,
    '',
    'The SVG is in millimetres, ready for LightBurn, xTool or Bambu Suite.',
    '',
    'Colours are the operations:',
    '  red   — CUT',
    '  blue  — SCORE (set it to Score, not Cut, in your laser software)',
    '  black — ENGRAVE (filled)',
    ...(input.note ? ['', input.note] : []),
    '',
    input.licence,
    ...(input.buildId ? ['', `Build ${input.buildId}`] : []),
    '',
  ].join('\n');
}

/** The cut file, as the host's zip artifact. */
export function cutArtifact(input: {
  fileName: string;
  buffer: ArrayBuffer;
  coverImage: string;
  description: string;
}): MakerlabZipArtifact {
  return {
    fileName: input.fileName,
    format: 'zip',
    buffer: input.buffer,
    coverImage: input.coverImage,
    description: clampDescription(input.description),
  };
}

/** The whole export call for a cut file. */
export function cutExport(input: Parameters<typeof cutArtifact>[0]): MakerlabExportOptions {
  return { printerType: '2D', artifacts: [cutArtifact(input)] };
}

/** The zip the host receives: the cut file, plus the sheet that explains its colours. */
export function cutZip(input: {
  svg: string;
  svgName: string;
  readme: string;
}): ArrayBuffer {
  return bytesToArrayBuffer(
    buildZip({ [input.svgName]: input.svg, 'README.txt': input.readme }),
  );
}

/** A cover for the artifact: the EXPORT ITSELF, rasterised.
 *
 *  Invariant #7 is a real-render capture, not a screenshot of the viewport — and here the two
 *  would differ, because the stage may be showing the 3D preview, or an orbit the user left it
 *  at, or a piece scrolled half out of frame. Drawing the export SVG is both simpler and more
 *  honest: the thumbnail in MakerWorld's library is a picture of the file that is in the zip.
 *
 *  On a white ground on purpose. The SVG's own cut lines are red-on-nothing and its engraves
 *  are black-on-nothing; over the host's dark library card, black engraving on transparency is
 *  a picture of nothing at all.
 *
 *  Never throws: a cover that will not render falls back to `BLANK_COVER`, because the file is
 *  the deliverable and the thumbnail is not. */
export async function coverDataUrl(svg: string, edge = 512): Promise<string> {
  try {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('the export SVG would not rasterise'));
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = edge;
      canvas.height = edge;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, edge, edge);
      // Fit the artwork inside a small margin, keeping its aspect — a long name tag must not be
      // stretched square, and a square cover is what the host's grid lays out.
      const w = img.naturalWidth || edge;
      const h = img.naturalHeight || edge;
      const pad = edge * 0.06;
      const scale = Math.min((edge - pad * 2) / w, (edge - pad * 2) / h);
      ctx.drawImage(img, (edge - w * scale) / 2, (edge - h * scale) / 2, w * scale, h * scale);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('[laser-studio] the cover render failed; exporting with a blank cover.', err);
    return BLANK_COVER;
  }
}
