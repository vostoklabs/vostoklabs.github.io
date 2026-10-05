// @vostok/trace — the image tracer: decode → adjust → matte → quantize → trace, and the SVG
// reader beside it. Everything converges on a `RegionSet` — normalised rings per colour —
// which is the one currency the apps scale into millimetres.
export type { RGB, Ring, RegionSet, CropRatio, PreprocessParams } from './types';
export { DEFAULT_PREPROCESS } from './types';
export { loadFileToImage, loadUrlToImage, drawToImageData, type RgbaImage } from './decode';
export { preprocessImage, adjustImage, cropToRatio } from './adjust';
export { processImage, discoverColours, type ProcessOptions, type ColourCandidate } from './pipeline';
export { describeSvg, parseSvg, parseSvgLegend, type SvgPart, type SvgPartChoice, type SvgOptions, type SvgLegend } from './logo';
export { srgbToOklab, oklabToSrgb } from './colorspace';
// The pipeline's stages one at a time, for the tests and benches that measure each. Background
// removal is `stripBackground` out here: the shelf has another `removeBackground`, a picture
// edit that does a different job, and one name must not mean two functions.
export { removeBackground as stripBackground, compositeOverMatte, cleanMask } from './matte';
export { quantize } from './quantize';
export { traceRegions } from './trace';
