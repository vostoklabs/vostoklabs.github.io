// The three operations, and the colours a cut file tags them with.
//
// LightBurn sorts an imported SVG into layers by EXACT colour match against its palette, so
// the colours are palette entries and nothing near them: pure red, pure blue, black. xTool
// and Bambu Suite read colour as decoration and ask the user to assign a process per group,
// so each op is also its own `<g id>` — the one arrangement every importer copes with.
import type { Op } from './types';

export interface OpSpec {
  label: string;
  /** The file colour. */
  color: string;
  /** How the file draws it: a hairline or a filled compound path. */
  mode: 'line' | 'fill';
  /** One line for the control's tooltip. */
  hint: string;
}

export const OPS: Record<Op, OpSpec> = {
  engrave: {
    label: 'Engrave',
    color: '#000000',
    mode: 'fill',
    hint: 'Fills the shape. Runs first, while the sheet still holds the piece.',
  },
  score: {
    label: 'Score',
    color: '#0000FF',
    mode: 'line',
    hint: 'A light line that marks the surface without cutting through.',
  },
  cut: {
    label: 'Cut',
    color: '#FF0000',
    mode: 'line',
    hint: 'Cuts through. Runs last so nothing moves before it is engraved.',
  },
};

/** Job order: engrave, score, then cut. Also the file's group order. */
export const OP_ORDER: Op[] = ['engrave', 'score', 'cut'];
