// Bundled sample images, shipped as static assets under public/assets/media.
// Selecting one loads the real PNG through the same path as a user upload.
import { loadUrlToImage, type RgbaImage } from './decode';
import { assetUrl } from '../assets';

const imgDir = () => assetUrl('assets/media/images/');

export interface SampleInfo {
  name: string;
  /** Thumbnail / preview URL (the asset itself). */
  readonly src: string;
  /** Decode the asset into an RgbaImage for the pipeline. */
  load: () => Promise<RgbaImage>;
}

/**
 * `src` is a getter, not a string, and that is load-order rather than style.
 *
 * `SAMPLES` is built when this module is first imported. `mount()` sets the asset base
 * after that — it cannot run earlier, because it is the thing doing the importing. A plain
 * string would therefore capture the web default, and inside a desktop host every sample
 * would point at a path that does not exist there. Reading it at use time is what makes the
 * base the caller sets actually apply.
 */
function imageSample(file: string, name: string): SampleInfo {
  return {
    name,
    get src() { return imgDir() + file; },
    load: () => loadUrlToImage(imgDir() + file),
  };
}

export const SAMPLES: SampleInfo[] = [
  imageSample('Vostok Labs logo.png', 'Vostok Labs'),
  imageSample('heart.png', 'Heart'),
  imageSample('paw.png', 'Paw'),
  imageSample('dog.png', 'Dog'),
  imageSample('cheese.png', 'Cheese'),
  imageSample('radiation.png', 'Radiation'),
];

// Bundled vector samples, surfaced as ready-to-use presets in the SVG panel.
const svgDir = () => assetUrl('assets/media/svg/');

export interface SvgSampleInfo {
  name: string;
  readonly src: string;
}

export const SVG_SAMPLES: SvgSampleInfo[] = [
  // Same getter, same reason as above.
  { name: 'Bambu Lab', get src() { return svgDir() + 'bambulab.svg'; } },
];
