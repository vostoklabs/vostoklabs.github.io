// @vostok/patterns/ui — the DOM half: the pattern gallery (Pattern Monster's picker in the
// house chrome), the card painter, and the preview row an app puts in its settings panel.
// Built on @vostok/ui-kit; the engine itself (`@vostok/patterns`) stays DOM-free.
export {
  openPatternGallery,
  paintPattern,
  patternTitle,
  loadPatternLibrary,
  tileMeta,
  TILE_INDEX,
  type TileMeta,
} from './gallery';
export { patternRow, type PatternRowOptions, type PatternRowHandle } from './row';
