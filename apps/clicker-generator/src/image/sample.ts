// Bundled sample images, shipped as static assets under public/assets/media.
// Selecting one loads the real PNG through the same path as a user upload.
import { loadUrlToImage, type RgbaImage } from './decode';

const BASE = import.meta.env.BASE_URL;
const IMG_DIR = BASE + 'assets/media/images/';

export interface SampleInfo {
  name: string;
  /** Thumbnail / preview URL (the asset itself). */
  src: string;
  /** Decode the asset into an RgbaImage for the pipeline. */
  load: () => Promise<RgbaImage>;
}

function imageSample(file: string, name: string): SampleInfo {
  const src = IMG_DIR + file;
  return { name, src, load: () => loadUrlToImage(src) };
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
const SVG_DIR = BASE + 'assets/media/svg/';

export interface SvgSampleInfo {
  name: string;
  src: string;
}

export const SVG_SAMPLES: SvgSampleInfo[] = [
  { name: 'Bambu Lab', src: SVG_DIR + 'bambulab.svg' },
  { name: 'YouTube', src: SVG_DIR + 'youtube.svg' },
  { name: 'Instagram', src: SVG_DIR + 'instagram.svg' },
];
