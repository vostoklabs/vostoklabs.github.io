// The clicker's image tracer, verbatim: decode → adjust → matte → quantize → trace, and the
// SVG reader beside it. Everything converges on a `RegionSet` — normalised rings per colour —
// which is the one currency the apps scale into millimetres.
export type { RGB, Ring, RegionSet, CropRatio, PreprocessParams } from './types';
export { DEFAULT_PREPROCESS } from './types';
export { loadFileToImage, loadUrlToImage, drawToImageData, type RgbaImage } from './decode';
export { preprocessImage, adjustImage, cropToRatio } from './adjust';
export { processImage, discoverColours, type ProcessOptions, type ColourCandidate } from './pipeline';
export { describeSvg, parseSvg, type SvgPart, type SvgPartChoice, type SvgOptions } from './logo';
export { srgbToOklab, oklabToSrgb } from './colorspace';
