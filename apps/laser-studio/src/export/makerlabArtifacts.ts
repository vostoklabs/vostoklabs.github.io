// What the embedded build hands the host, as plain data.
//
// Laser Studio sends one zip holding the cut file. The zip, its cover, its name and the call
// that sends it are the shelf's ("MakerLab export", `@vostok/export/makerlab`); what is Laser
// Studio's own is the README that rides in the zip. tests/node/makerlab-artifacts.test.mjs holds
// both, through this file.

export {
  BLANK_COVER,
  MAX_DESCRIPTION,
  MAX_FILE_NAME,
  MAX_STEM,
  clampDescription,
  coverDataUrl,
  cutArtifact,
  cutExport,
  cutFileStem,
  cutZip,
  settleExport,
  type ExportOutcome,
} from '@vostok/export/makerlab';

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
    'The SVG is in millimetres, ready for Bambu Suite or any laser software that reads SVG.',
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
