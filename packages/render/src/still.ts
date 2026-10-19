/**
 * Stills: the studio scene accumulated over many passes into one PNG.
 */

import * as THREE from 'three';
import type { LoadedModel } from './load';
import { buildEnvironment, buildStudioScene } from './scene';
import { STUDIO_FILAMENTS, clamp, type RenderOptions, type SceneOptions } from './studio';

/** How a still is run, as opposed to what it shows. */
export interface StillRun {
  /** Called after each accumulated pass, `pass` counting from 1 to `total`. */
  onProgress?(pass: number, total: number): void;
  /**
   * Stops the render at the next pass, rejecting with the signal's reason (an `AbortError` by
   * default). A still waiting its turn behind another is stopped before it starts.
   */
  signal?: AbortSignal;
}

/* ------------------------------------------------------------------ engine */

/**
 * One renderer for every still, for the life of the page.
 *
 * A browser allows roughly 16 live WebGL contexts and force-loses the oldest past that, so a
 * batch that built a renderer per image would start failing partway through, and its failures
 * would be blank PNGs.
 *
 * The preview owns a *second* context, deliberately. Sharing this one would mean resizing the
 * visible canvas to 6000 px and back on every still, in view of the user.
 */
let pooled: { renderer: THREE.WebGLRenderer; env: THREE.Texture } | null = null;

function getRenderer(): { renderer: THREE.WebGLRenderer; env: THREE.Texture } {
  if (pooled) return pooled;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    // Read back in the same tick as the draw, but a lost buffer here costs a whole batch rather
    // than one frame, so this is not the place to be clever about it.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  pooled = { renderer, env: buildEnvironment(renderer) };
  return pooled;
}

/**
 * Stills run one at a time, in the order they were asked for.
 *
 * They share one renderer, and a still yields between passes, so two left to run together would
 * resize each other's drawing buffer mid-accumulation. A queue makes any number of callers safe,
 * a grid of picture tiles asking at once included.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Frees the still renderer's WebGL context and environment map, once every still already asked
 * for has finished. Call when the studio is closed; a still asked for afterwards makes a new one.
 */
export function disposeStillRenderer(): Promise<void> {
  return enqueue(async () => {
    if (!pooled) return;
    pooled.env.dispose();
    pooled.renderer.dispose();
    pooled.renderer.forceContextLoss();
    pooled = null;
  });
}

/* ------------------------------------------------------------------ stills */

/** The drawing buffer's longest edge, whatever the size and supersample ask for. */
const MAX_EDGE = 6000;

/**
 * Renders one still and hands back a PNG.
 *
 * **The accumulation loop is the whole trick.** Each pass nudges the camera by a fraction of a
 * pixel and moves the key light a little way around a disc, then composites onto a 2D canvas at
 * `globalAlpha = 1 / (i + 1)`. Source-over at that alpha is exactly a running mean, so N passes
 * give the average of N slightly different renders. Averaging the camera jitter is antialiasing;
 * averaging the light jitter is an area light, which is what a soft contact shadow actually is.
 * One loop, both problems, no post-processing dependency.
 *
 * A single pass with a hard directional light is the CAD-screenshot look this exists to avoid,
 * which is why `samples` is a count rather than a "quality". It is also the one thing the live
 * preview does not do, and therefore the one way the preview and the output differ.
 *
 * Stills are queued (see `enqueue`), and the loop yields to the event loop every few passes with
 * `setTimeout`, so the page stays responsive and a hidden tab keeps rendering.
 */
export function renderStill(model: LoadedModel, opts: RenderOptions, run: StillRun = {}): Promise<Blob> {
  return enqueue(() => accumulate(model, opts, run));
}

async function accumulate(model: LoadedModel, opts: RenderOptions, run: StillRun): Promise<Blob> {
  const { signal, onProgress } = run;
  stopIfAborted(signal);
  const { renderer, env } = getRenderer();

  const width = Math.max(1, Math.round(clamp(opts.width, 1, MAX_EDGE)));
  const height = Math.max(1, Math.round(clamp(opts.height, 1, MAX_EDGE)));
  const ss = clamp(opts.supersample, 1, 4);
  // Cap the drawing buffer. A 2000 px output at 4x is 8000 px square, which is 256 MB of colour
  // buffer before depth and is where an integrated GPU gives up mid-batch.
  const scale = Math.min(ss, MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  renderer.setSize(w, h, false);
  renderer.setClearAlpha(opts.backdrop.sky ? 1 : 0);
  renderer.toneMappingExposure = opts.lighting.exposure;

  const studio = buildStudioScene(model, opts, env, w / h);
  const { scene, camera } = studio;

  try {
    const acc = document.createElement('canvas');
    acc.width = w;
    acc.height = h;
    const ctx = acc.getContext('2d');
    if (!ctx) throw new Error('This browser could not open a 2D canvas to build the image.');

    const samples = clamp(Math.round(opts.samples), 1, 128);
    for (let i = 0; i < samples; i++) {
      const [jx, jy] = haltonPair(i + 1);
      camera.setViewOffset(w, h, jx - 0.5, jy - 0.5, w, h);
      camera.updateProjectionMatrix();
      studio.jitter(i, samples);

      renderer.render(scene, camera);
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
      onProgress?.(i + 1, samples);
      // A long batch on one thread makes the page unresponsive, and an unresponsive page during a
      // 48-image render is indistinguishable from a hang.
      if ((i & 3) === 3) await nextTick();
      stopIfAborted(signal);
    }
    ctx.globalAlpha = 1;
    return await toPng(downscale(acc, width, height));
  } finally {
    camera.clearViewOffset();
    studio.dispose();
  }
}

/** Passes for a picture tile: enough to soften the shadow and the edges at tile size. */
const THUMB_SAMPLES = 8;

/**
 * A small square still for a picture tile: a backdrop, a light rig, a finish or a shot shown on
 * the loaded model, or on a plain sphere when `model` is null.
 *
 * The same scene as every still, at `edge` pixels, with a few passes and no supersampling. The
 * sphere is one region, `whole`, grey and matte unless the colourway says otherwise; it sits on
 * the floor, so the tile shows the shadow too.
 */
export function renderThumb(
  model: LoadedModel | null,
  look: SceneOptions,
  edge = 160,
  run: StillRun = {},
): Promise<Blob> {
  return renderStill(model ?? sampleModel(), {
    ...look, width: edge, height: edge, samples: THUMB_SAMPLES, supersample: 1,
  }, run);
}

/** The sample sphere, made on first use. */
let sample: LoadedModel | null = null;

/**
 * A plain sphere as a loaded model: what `renderThumb` shows when there is no model, and what a
 * preview can show before one is loaded. Made once and shared; never pass it to `disposeModel`.
 */
export function sampleModel(): LoadedModel {
  if (sample) return sample;
  // Smooth normals, unlike a loaded file: a sphere is the one model known to be curved everywhere.
  const geometry = new THREE.SphereGeometry(10, 64, 32);
  const mesh = new THREE.Mesh(geometry);
  mesh.name = 'sample';
  mesh.userData.regionKeys = ['whole'];
  const grey = STUDIO_FILAMENTS.find((f) => f.name === 'Grey')?.hex ?? '#8a8d93';
  const triangles = (geometry.index?.count ?? 0) / 3;
  sample = {
    object: mesh,
    regions: [{ key: 'whole', label: 'Sample', source: 'whole', fileHex: grey, triangles }],
    stem: 'sample',
  };
  return sample;
}

/**
 * Box-filters the supersampled frame down to the requested size.
 *
 * Halving each time, because a single large `drawImage` reduction is a nearest-ish sample in
 * several browsers and throws away most of what supersampling just paid for.
 */
function downscale(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let current = source;
  while (current.width > width * 2 && current.height > height * 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(width, Math.round(current.width / 2));
    half.height = Math.max(height, Math.round(current.height / 2));
    const hctx = half.getContext('2d');
    if (!hctx) break;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  if (current.width === width && current.height === height) return current;

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d');
  if (!octx) return current;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(current, 0, 0, width, height);
  return out;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The image could not be encoded as a PNG.'));
    }, 'image/png');
  });
}

/**
 * Low-discrepancy pairs, so the camera jitter covers the pixel evenly.
 *
 * `Math.random()` clumps, and clumped jitter over 24 passes leaves the residual aliasing that
 * makes an accumulated render look merely blurry rather than smooth.
 */
export function haltonPair(index: number): [number, number] {
  return [halton(index, 2), halton(index, 3)];
}

function halton(index: number, base: number): number {
  let result = 0;
  let f = 1;
  let i = index;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
}

/**
 * Yields to the event loop, and keeps yielding when the page is not visible.
 *
 * Not `requestAnimationFrame`, which is the obvious choice and the wrong one: a hidden or
 * minimised page stops firing frames entirely, so a batch left running while the user went to
 * do something else would stop partway through the first image and never resume.
 * `renderer.render` itself does not need a frame callback, so nothing is gained by waiting for one.
 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('The render was stopped.', 'AbortError');
}
