/**
 * Product photographs of a 3D model, in the browser.
 *
 *   loadRenderModel(bytes, name)            an STL, OBJ or 3MF, with the 3MF's own colours as regions
 *   createStudioPreview(host)               the studio scene, live, orbited by hand
 *   renderStill(model, options)             one accumulated PNG of the same scene
 *   renderThumb(model | null, look, edge)   a small square of it, for picture tiles
 *   planRenders(stem, shots, colourways)    which stills a batch makes, and their file names
 *
 * Everything else is the data those take: filaments, finishes, shots, backdrops, light rigs,
 * orientations, output sizes and colourways.
 */

export {
  STUDIO_FILAMENTS, FINISHES, AUTO_FINISH, finishById, effectiveFinish,
  PRESET_SHOTS, defaultShots, shotById, nextShotId, nextColourwayId,
  BACKDROPS, CUSTOM_BACKDROP, DEFAULT_CUSTOM, backdropById, resolveBackdrop,
  LIGHT_PRESETS, DEFAULT_LIGHTING, lightPresetById, applyLightPreset,
  FLAT, isStood,
  STILL_SIZES, stillSizeById, DEFAULT_SAMPLES,
  planRenders, renderFileName, safeSlug,
  type Filament, type Finish, type FinishSpec, type Shot, type Backdrop, type CustomBackdrop,
  type Lighting, type LightPreset, type Orientation, type SceneOptions, type RenderOptions,
  type StillSize, type RenderJob,
} from './studio';
export {
  AS_PRINTED, STOCK_HEX, regionColour,
  type PaintRegion, type RegionOverride, type Colourway,
} from './regions';
export { loadRenderModel, disposeModel, canRender, RENDERABLE, type LoadedModel } from './load';
export {
  renderStill, renderThumb, sampleModel, disposeStillRenderer, type StillRun,
} from './still';
export {
  createStudioPreview, type StudioPreview, type StudioPreviewOptions, type ViewSnapshot,
} from './preview';
