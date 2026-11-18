// The picture window's tools as rules, with no DOM: the list of parts taken out and brought back,
// what the row under the preview shows, what a tap does, and what a crop drag leaves. The window
// only draws what these say, so they are tested in node.
import { cleanCropBox, MAX_PICTURE_EDITS, type CropBox, type PictureEdit } from '@vostok/trace';

/** The parts taken out of the picture or brought back, in order. Undo takes back the last one,
 *  Put everything back all of them; at `MAX_PICTURE_EDITS` nothing more is added. */
export interface EditList {
  readonly edits: readonly PictureEdit[];
  /** As many as a picture keeps: nothing more can be added until one is undone. */
  readonly full: boolean;
  /** Whether it was added. */
  push(e: PictureEdit): boolean;
  /** Whether there was one to take back. */
  undo(): boolean;
  /** Whether there was anything to put back. */
  reset(): boolean;
}

export function editList(initial: readonly PictureEdit[] = []): EditList {
  let edits: PictureEdit[] = initial.slice(0, MAX_PICTURE_EDITS);
  return {
    get edits() { return edits; },
    get full() { return edits.length >= MAX_PICTURE_EDITS; },
    push(e) {
      if (edits.length >= MAX_PICTURE_EDITS) return false;
      edits = [...edits, e];
      return true;
    },
    undo() {
      if (!edits.length) return false;
      edits = edits.slice(0, -1);
      return true;
    },
    reset() {
      if (!edits.length) return false;
      edits = [];
      return true;
    },
  };
}

/** The one line the row shows at the edit limit, in place of the tap line. */
export const FULL_HINT = `${MAX_PICTURE_EDITS} changes is the most a picture keeps: undo one to make another.`;
export const CROP_HINT = 'Drag the corners to crop.';
export const TAP_HINT = 'Tap a part to remove it, or an empty spot to bring it back.';

export interface ToolsRow {
  /** The one line, or null when a button stands in its place. */
  hint: string | null;
  /** The button for what is marked: "Remove" or "Bring back"; null when nothing is. */
  mark: 'Remove' | 'Bring back' | null;
  /** "Reset crop": only on the Original view, only once there is a crop. */
  resetCrop: boolean;
  /** Undo and "Put everything back": only on the Result view, only once something was changed. */
  history: boolean;
}

/** What the row under the preview shows. Each view shows only its own tools. */
export function toolsRow(s: {
  view: 'original' | 'result';
  marked: 'remove' | 'restore' | null;
  edits: number;
  full: boolean;
  cropped: boolean;
}): ToolsRow {
  if (s.view === 'original') return { hint: CROP_HINT, mark: null, resetCrop: s.cropped, history: false };
  const history = s.edits > 0;
  if (s.full) return { hint: FULL_HINT, mark: null, resetCrop: false, history };
  if (s.marked) return { hint: null, mark: s.marked === 'remove' ? 'Remove' : 'Bring back', resetCrop: false, history };
  return { hint: TAP_HINT, mark: null, resetCrop: false, history };
}

/** "Remove this colour" in a colour's picker: while another colour would be left, and while there
 *  is room for one more change. */
export function canRemoveColour(colours: number, full: boolean): boolean {
  return colours > 1 && !full;
}

/** A tap on the Result view at picture pixel `at` (null: off the picture), with `mark` the area
 *  marked now (null: none): take the mark off, or mark what is there. Off the picture, or on the
 *  mark again, takes it off; at the edit limit nothing is marked. */
export function tapAction(
  mark: Uint8Array | null,
  at: { px: number; py: number } | null,
  width: number,
  full: boolean,
): 'clear' | 'mark' {
  if (!at || full) return 'clear';
  if (mark && mark[at.py * width + at.px]) return 'clear';
  return 'mark';
}

/** What a crop drag that ended at `box` leaves: the crop (null within a hair of the whole picture,
 *  one value for "none"), whether it changed, and whether the box on screen must go back to the
 *  whole picture so the box and "Reset crop" agree. */
export function nextCrop(current: CropBox | null, box: CropBox | null): { crop: CropBox | null; changed: boolean; showWhole: boolean } {
  const crop = cleanCropBox(box);
  const same = crop === current
    || (!!crop && !!current && crop.x === current.x && crop.y === current.y && crop.w === current.w && crop.h === current.h)
    || (!crop && !current);
  return { crop: same ? current : crop, changed: !same, showWhole: crop === null };
}
