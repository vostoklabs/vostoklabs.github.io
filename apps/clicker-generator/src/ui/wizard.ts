// Bambu-style image → model wizard. A single modal step:
//   Preprocessing — crop ratio, thickness, tone/color sliders.
// Background removal is toggled in the main sidebar (not here), so the wizard just
// tones/crops the image. On confirm it hands the adjusted image (background intact) +
// params back; the caller runs the trace/build pipeline (background removal is
// re-derived there, defaulting to keepBackground = false).
// Color extraction and recoloring now happen live in the 3D preview, so the
// wizard no longer asks for a color mode or a filament-customization pass.
import type { RgbaImage } from '../image/decode';
import { preprocessImage } from '../image/adjust';
import { removeBackground } from '../image/matte';
import { DEFAULT_PREPROCESS, type CropRatio, type PreprocessParams, type RGB } from '../types';

export interface WizardResult {
  adjusted: RgbaImage; // cropped + tone-adjusted, background still present
  preprocess: PreprocessParams;
  colorCount: number;
  colorMode: 'normal' | 'limited';
  limitedColors?: RGB[];
  paletteOverrides?: RGB[];
}

interface WizardOpts {
  baseImage: RgbaImage;
  initialColorCount: number;
  onComplete(result: WizardResult): void;
  onCancel?(): void;
}

const SLIDERS: [keyof PreprocessParams, string][] = [
  ['exposure', 'Exposure'],
  ['contrast', 'Contrast'],
  ['saturation', 'Saturation'],
  ['brightness', 'Brightness'],
  ['whiteBalance', 'White Balance'],
  ['highlights', 'Highlights'],
  ['shadows', 'Shadows'],
];

const RATIOS: [CropRatio, string][] = [
  ['free', 'Free'],
  ['1:1', '1:1'],
  ['4:3', '4:3'],
  ['3:2', '3:2'],
  ['16:9', '16:9'],
];

const ALPHA_THRESHOLD = 128;

/** True if the image would still have foreground after background removal, i.e.
 *  the build pipeline would find an outline to trace. Keeping the background
 *  means every pixel is foreground, so an outline always exists. */
function hasOutline(img: RgbaImage, keepBackground: boolean): boolean {
  if (keepBackground) return true;
  const clone: RgbaImage = {
    data: new Uint8ClampedArray(img.data),
    width: img.width,
    height: img.height,
  };
  removeBackground(clone); // mutates the clone, never the live preview image
  let fg = 0;
  for (let p = 3; p < clone.data.length; p += 4) if (clone.data[p] >= ALPHA_THRESHOLD) fg++;
  return fg > 8; // a few stray pixels won't trace into a usable region
}

function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export function runWizard(opts: WizardOpts) {
  const params: PreprocessParams = { ...DEFAULT_PREPROCESS };
  const colorCount = [4, 8, 12].includes(opts.initialColorCount) ? opts.initialColorCount : 4;

  const overlay = document.createElement('div');
  overlay.className = 'wz-overlay';
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const cancel = () => {
    close();
    opts.onCancel?.();
  };

  // Adjusted image (background intact) for the current params.
  const adjusted = () => preprocessImage(opts.baseImage, params);

  // ---------- Preprocessing ----------
  function stepPreprocess() {
    overlay.innerHTML = `
      <div class="wz-modal lg">
        <div class="wz-head">Image Preprocessing</div>
        <div class="wz-body">
          <div class="wz-left">
            <div class="wz-canvas checker" id="wzPrev"></div>
            <div class="wz-info">
              <div class="wz-info-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
                What kind of image works best
              </div>
              <ul>
                <li><strong>Simple, flat colors</strong> with bold, clearly separated shapes.</li>
                <li><strong>2D illustrations</strong>, logos, icons or clipart convert best.</li>
              </ul>
              <p class="wz-info-warn"><strong>Don't work well:</strong> photos of real objects with shadows, gradients or texture usually won't convert.</p>
              <p>Missing details after processing? Turn up <strong>Contrast</strong> and <strong>Exposure</strong> to make the image bolder and bring them back.</p>
            </div>
          </div>
          <div class="wz-controls">
            <div class="wz-label">Crop Ratio</div>
            <div class="seg" id="wzRatio">${RATIOS.map(
              ([k, l]) => `<button data-r="${k}">${l}</button>`,
            ).join('')}</div>

            <div class="wz-row spread">
              <span class="wz-label">Image Thickness</span>
              <span class="wz-num"><input type="number" id="wzThick" min="0.2" max="10" step="0.2" /> mm</span>
            </div>

            <div class="wz-label">Image Adjustment</div>
            ${SLIDERS.map(
              ([k, l]) => `
              <div class="wz-adj">
                <span>${l}</span>
                <input type="range" data-k="${k}" min="0" max="2" step="0.05" />
                <span class="wz-num"><input type="number" data-n="${k}" min="0" max="2" step="0.05" /></span>
              </div>`,
            ).join('')}
          </div>
        </div>
        <div class="wz-foot">
          <span class="wz-error" id="wzErr" hidden>No outline found. Adjust the image and try again.</span>
          <button id="wzCancel">Cancel</button>
          <button class="primary" id="wzDone">Confirm</button>
        </div>
      </div>`;

    const prev = overlay.querySelector<HTMLElement>('#wzPrev')!;
    const done = overlay.querySelector<HTMLButtonElement>('#wzDone')!;
    const err = overlay.querySelector<HTMLElement>('#wzErr')!;
    // Mirror the build pipeline's foreground check so the user can't confirm an
    // image (e.g. one darkened until it's all background) that would silently
    // trace into nothing.
    const redraw = () => {
      const a = adjusted();
      prev.innerHTML = '';
      prev.appendChild(imageToCanvas(a));
      const ok = hasOutline(a, params.keepBackground);
      done.disabled = !ok;
      err.hidden = ok;
    };
    redraw();

    for (const b of overlay.querySelectorAll<HTMLElement>('#wzRatio button')) {
      b.classList.toggle('active', b.dataset.r === params.cropRatio);
      b.addEventListener('click', () => {
        params.cropRatio = b.dataset.r as CropRatio;
        for (const x of overlay.querySelectorAll('#wzRatio button')) x.classList.remove('active');
        b.classList.add('active');
        redraw();
      });
    }

    const thick = overlay.querySelector<HTMLInputElement>('#wzThick')!;
    thick.value = String(params.thicknessMm);
    thick.addEventListener('input', () => (params.thicknessMm = +thick.value || 1));

    let raf = 0;
    const scheduleRedraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(redraw);
    };
    for (const [k] of SLIDERS) {
      const range = overlay.querySelector<HTMLInputElement>(`input[data-k="${k}"]`)!;
      const num = overlay.querySelector<HTMLInputElement>(`input[data-n="${k}"]`)!;
      range.value = num.value = String(params[k]);
      const apply = (v: number) => {
        (params[k] as number) = v;
        range.value = num.value = String(v);
        scheduleRedraw();
      };
      range.addEventListener('input', () => apply(+range.value));
      num.addEventListener('input', () => apply(+num.value));
    }

    overlay.querySelector('#wzCancel')!.addEventListener('click', cancel);
    done.addEventListener('click', () => {
      if (done.disabled) return;
      close();
      opts.onComplete({
        adjusted: adjusted(),
        preprocess: { ...params },
        colorCount,
        colorMode: 'normal',
      });
    });
  }

  stepPreprocess();
}
