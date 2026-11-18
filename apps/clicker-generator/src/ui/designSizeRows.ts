/*
  The Shape category's Design size slider and the "Picture follows size" switch under it: when
  each shows and what the slider reads. Pure: no DOM, no kit. `update()` in ui.ts applies it.
*/
import type { UiState } from './ui';
import { DESIGN_SCALE_MAX } from '../geometry/sizeLimits';
import { holdScale } from '../geometry/pictureHold';

/** Whether the base reads as an outline. Icon line-art makes a broken outline body, so
 *  an icon design is always a solid shape whatever `baseShape` says. */
export const isOutlineBase = (s: Pick<UiState, 'baseShape' | 'importMode'>) =>
  s.baseShape === 'outline' && s.importMode !== 'icon';

/** The three sources a picture comes from. */
export const isPictureMode = (mode: UiState['importMode']) => mode === 'image' || mode === 'svg' || mode === 'icon';

export interface DesignSizeRows {
  /** Design size is hidden: Text mode has Text size for it, an Outline base ignores it, a blank
   *  has no picture to size. */
  designSizeHidden: boolean;
  /** The slider's value, in %. */
  designSizePct: number;
  /** "Picture follows size" is hidden: wherever Design size is, and outside the picture sources. */
  followHidden: boolean;
  /** The switch is on: the picture follows the shape (no size held). */
  follows: boolean;
}

/** `blank`: the clicker prints without its picture (`isBlank`). */
export function designSizeRows(
  s: Pick<UiState, 'importMode' | 'baseShape' | 'designScale' | 'artMm' | 'artFitMm'>,
  blank: boolean,
): DesignSizeRows {
  const picture = isPictureMode(s.importMode);
  const designSizeHidden = s.importMode === 'text' || isOutlineBase(s) || blank;
  // A picture that keeps its size shows the share of the shape it fills now; past the slider's
  // top the slider sits at its end (the Design view's pill shows the true number).
  const held = s.artMm != null && s.artFitMm != null && picture;
  const share = held ? holdScale(s.artMm!, s.artFitMm!) : s.designScale ?? 1;
  return {
    designSizeHidden,
    designSizePct: Math.min(Math.round(DESIGN_SCALE_MAX * 100), Math.round(share * 100)),
    followHidden: designSizeHidden || !picture,
    follows: s.artMm == null,
  };
}
