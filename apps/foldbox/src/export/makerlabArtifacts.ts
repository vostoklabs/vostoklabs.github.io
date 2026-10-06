// What the MakerLab build hands the host, as plain data.
//
// The literals that decide whether an export is correct — the layer height enum string, the
// merge flag, the note under the export buttons, the placeholder cover — used to live inside
// `mount.ts`, which needs a DOM and so can only be checked in a browser. They are pure values,
// so they live here instead and `tests/makerlab.mts` asserts them in node.
//
// mount.ts still writes the file names and the descriptions: those are sentences about the box
// on screen, not decisions about the host.

import type {
  MakerlabExportOptions,
  MakerlabLayerHeight,
  MakerlabObjArtifact,
} from 'virtual:makerlab';

// The cut files' zip artifact, its 2D call and the blank cover are the shelf's ("MakerLab
// export"), shared with every laser app that sends a cut file to MakerLab.
export { BLANK_COVER, cutArtifact, cutExport } from '@vostok/export/makerlab';

/** The one layer height the MakerLab build prints at, and the enum string the host takes.
 *
 *  Locked, because the host cannot be told the rest. The printed sheet's FIRST LAYER IS THE
 *  HINGE (`sheetProcess` in printable.ts), so our own 3MF pins `initial_layer_print_height` to
 *  the layer height, zeroes `elefant_foot_compensation` and sets `infill_direction`. MakerLab
 *  builds the 3MF from our OBJ instead, and its `printConfig` can write `layerHeight` and
 *  nothing else of the four: it has no field for the first layer at all, and Bambu's stock
 *  profiles leave that at 0.2 mm. At any layer height but 0.2 the hinge would come out the
 *  wrong thickness, so inside MakerLab the layer height is 0.2 and not a choice. Elephant-foot
 *  compensation and infill direction stay at the printer profile's values; that is a gap to
 *  close on the host side (makerlab/README.md), not something to pre-distort geometry for. */
export const MAKERLAB_LAYER_HEIGHT_MM = 0.2;
export const MAKERLAB_LAYER_HEIGHT: MakerlabLayerHeight = '0.2';

/** The sentence under the export buttons. Follows the make mode the user is on, not the
 *  build: the MakerWorld embed carries both halves.
 *
 *  Cutting gets NOTHING. It used to say "Every file carries a 100 mm rectangle: measure
 *  it before you cut a real sheet" — true, and it is in the README inside every export,
 *  which is where a person reads it: at the machine, not while dragging a size slider.
 *  On screen it was a permanent two-line footer under the one button everybody presses.
 *  `setExportNote` removes the node for an empty string, so this costs no space. */
export function exportNote(mode: 'cut' | 'print'): string {
  return mode === 'cut'
    ? ''
    : 'Prints flat, no supports. The fold lines are grooved in, so fold it by hand off the plate.';
}

/** The printed sheet, as the host's OBJ artifact.
 *
 *  `mergeObj: true` because the blank is one physical part. The sheet, the panel slabs stacked
 *  on it and the logo inlay are separate `o` objects only because that is how an OBJ carries
 *  two colours; they meet on a face and print as one union. The guide's rule is exactly this
 *  case: merge when the meshes belong to one physical part that should be moved, oriented and
 *  sliced as one unit. Without it the host leaves two to four independently draggable objects
 *  on the plate, one drag away from a sheet with its panels somewhere else — the host only
 *  merges by itself above 500 meshes, which this never is. */
export function printArtifact(input: {
  fileName: string;
  buffer: ArrayBuffer;
  mtl: string;
  coverImage: string;
  description: string;
}): MakerlabObjArtifact {
  return {
    fileName: input.fileName,
    format: 'obj',
    buffer: input.buffer,
    mtl: input.mtl,
    coverImage: input.coverImage,
    description: input.description,
    mergeObj: true,
    printConfig: { layerHeight: MAKERLAB_LAYER_HEIGHT },
  };
}

/** The whole `export()` call for the printed sheet.
 *
 *  `printerType` belongs to the call, not the artifact, which is why this wrapper exists
 *  beside the artifact builder (the cut files' twin, `cutExport`, is the shelf's). `'3D'` is the host's default and is written out anyway: the
 *  sheet is a print, and the host has to ask which printer and nozzle before it can turn the
 *  OBJ into a 3MF for it. */
export function printExport(input: Parameters<typeof printArtifact>[0]): MakerlabExportOptions {
  return { printerType: '3D', artifacts: [printArtifact(input)] };
}

