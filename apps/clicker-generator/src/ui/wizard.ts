// Image -> model wizard. One modal step: prepare the image and SEE what the tracer makes of it.
//
// Design goal: get from a picture to a clean traced design, and see it before committing.
// The user makes three decisions here, in this order — how many colours to split the art
// into, whether to strip the background, and how smooth the outlines should be — and the
// Result view is the only honest feedback for all three, because tracing is what the build
// actually cuts the cap from. Everything else (tone) is secondary: most pictures need none of
// it, so it lives collapsed rather than competing with the three decisions that matter.
//
// Removed from here on purpose: Crop Ratio (tracing normalises to the artwork's own bounding
// box, so cropping the canvas around it changed nothing anyone could see) and Image Thickness
// (a geometry setting, not an image one — it already lives in the sidebar, and having two
// controls write the same store value was how confirming this dialog silently clobbered
// whatever the sidebar had just been set to).
//
// The preview has two views. "Original" is the tone-adjusted picture. "Result" is the real
// thing: the same pipeline the build runs (background removal -> quantise -> trace), drawn
// from the traced polygons, so what you confirm is what the cap gets. It supports wheel-zoom
// and drag-pan plus a "fit" reset, because thin lines and small text are exactly what someone
// needs to check before committing to a print.
//
// On confirm it hands the adjusted image (background intact) + every setting back; the caller
// writes them to the store and runs the trace/build pipeline. It can be reopened on the same
// picture from the sidebar, with the settings it was last confirmed with.
import {
  button, collapsibleSection, el, ICONS, iconButton, section, segmentedControl,
  sliderRow, toggleSwitch, type SliderRowHandle,
} from '@vostok/ui-kit';
import type { RgbaImage } from '../image/decode';
import { preprocessImage } from '../image/adjust';
import { discoverColours, processImage, type ColourCandidate } from '../image/pipeline';
import { srgbToOklab } from '../image/colorspace';
import { DEFAULT_PREPROCESS, type PreprocessParams, type RegionSet, type RGB } from '../types';

export interface WizardResult {
  adjusted: RgbaImage; // cropped + tone-adjusted, background still present
  preprocess: PreprocessParams;
  colorCount: number;
  smoothing: number;
  colorMode: 'normal' | 'limited';
  limitedColors?: RGB[];
  paletteOverrides?: RGB[];
}

interface WizardOpts {
  baseImage: RgbaImage;
  initialColorCount: number;
  initialSmoothing: number;
  initialRemoveBg: boolean;
  /** Reopening on the same picture: start from what was confirmed last time. */
  initialPreprocess?: PreprocessParams;
  /** The colours kept last time, so reopening shows the same ticks. */
  initialLimitedColors?: RGB[];
  /** The finished part's longest side, mm — sets the tracer's smallest feature. */
  designMm: number;
  onComplete(result: WizardResult): void;
  onCancel?(): void;
}

// Contrast and Exposure first: they are the two adjustments that actually rescue a bad trace
// (see the hint text beside them), so they should not be waiting at the bottom of a list of
// seven equally-weighted sliders.
const SLIDERS: [keyof PreprocessParams, string][] = [
  ['contrast', 'Contrast'],
  ['exposure', 'Exposure'],
  ['saturation', 'Saturation'],
  ['brightness', 'Brightness'],
  ['whiteBalance', 'White Balance'],
  ['highlights', 'Highlights'],
  ['shadows', 'Shadows'],
];

const MAX_COLOURS = 12;
/** Two colours this close in Oklab are "the same tick" when the list is rebuilt after a tone
 *  change nudges every candidate a little. */
const SAME_COLOUR = 0.12;

// The traced result is drawn from vector rings, so rendering it larger costs nothing but a
// bigger canvas — unlike the source photo, it never gets blurrier for it. A fixed, generous
// size means zooming in on a thin outline or small text stays crisp instead of hitting the
// resolution of whatever the visitor happened to upload.
const RESULT_PX = 1200;

function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

/**
 * The traced regions, drawn as the polygons they are.
 *
 * Not a re-rasterised label map: the whole point of the result view is to show the shapes the
 * cap will be cut from, at sub-pixel accuracy, so the canvas fills the actual rings. Regions go
 * down biggest-first and the smallest-coverage colour lands on top, which is the carve order
 * `buildClicker` uses, so a boundary between two colours shows the side that wins there.
 */
function regionsToCanvas(set: RegionSet, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  // Rings are normalised (longest side = 1, centred, Y-up); undo that into pixels of the
  // artwork's bounding box, which is drawn to fit the canvas with a small margin.
  const aspect = set.aspect || 1;
  const bw = aspect >= 1 ? 1 : aspect;
  const bh = aspect >= 1 ? 1 / aspect : 1;
  const scale = 0.94 * Math.min(width / bw, height / bh);
  const cx = width / 2;
  const cy = height / 2;
  const toPath = (rings: RegionSet['outline']): Path2D => {
    const path = new Path2D();
    for (const ring of rings) {
      ring.forEach(([x, y], i) => {
        const px = cx + x * scale;
        const py = cy - y * scale;
        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      });
      path.closePath();
    }
    return path;
  };
  const ordered = set.regions.slice().sort((a, b) => b.coverage - a.coverage);
  for (const r of ordered) {
    ctx.fillStyle = `rgb(${r.quantRgb[0]},${r.quantRgb[1]},${r.quantRgb[2]})`;
    for (const comp of r.components) ctx.fill(toPath(comp.rings), 'evenodd');
  }
  return c;
}

export function runWizard(opts: WizardOpts) {
  const params: PreprocessParams = { ...DEFAULT_PREPROCESS, ...(opts.initialPreprocess ?? {}) };
  params.keepBackground = !opts.initialRemoveBg;
  /* How many colours to keep when nothing has been ticked yet — biggest first. */
  const defaultKeep = Math.max(1, Math.min(MAX_COLOURS, opts.initialColorCount || 4));
  let smoothing = opts.initialSmoothing;
  let view: 'original' | 'result' = 'result';

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

  overlay.innerHTML = `
    <div class="wz-modal lg">
      <div class="wz-head">Prepare Image</div>
      <div class="wz-body">
        <div class="wz-left">
          <div class="wz-preview-bar">
            <div id="wzViewMount"></div>
            <div id="wzZoomMount"></div>
            <span class="wz-stats" id="wzStats"></span>
          </div>
          <div class="wz-canvas checker" id="wzPrev"></div>
          <div class="wz-palette" id="wzPalette"></div>
          <p class="vl-hint">Works best on flat, high-contrast art — photos with shadows, gradients or texture trace poorly.</p>
        </div>
        <div class="wz-controls" id="wzControls"></div>
      </div>
      <div class="wz-foot">
        <span class="wz-error" id="wzErr" hidden>No outline found — try more colours, more contrast, or turn off background removal.</span>
      </div>
    </div>`;

  const prev = overlay.querySelector<HTMLElement>('#wzPrev')!;
  const err = overlay.querySelector<HTMLElement>('#wzErr')!;
  const stats = overlay.querySelector<HTMLElement>('#wzStats')!;
  const palette = overlay.querySelector<HTMLElement>('#wzPalette')!;
  const controlsEl = overlay.querySelector<HTMLElement>('#wzControls')!;
  const foot = overlay.querySelector<HTMLElement>('.wz-foot')!;

  const cancelBtn = button({ label: 'Cancel', emphasis: 'secondary', onClick: cancel });
  const doneBtn = button({
    label: 'Confirm',
    emphasis: 'primary',
    onClick: () => {
      if (doneBtn.disabled) return;
      close();
      const kept = keptColours();
      opts.onComplete({
        adjusted: adjusted(),
        preprocess: { ...params },
        colorCount: kept.length,
        smoothing,
        // Always the ticked list, even when nobody touched it: the Result view was drawn from
        // exactly these colours, and confirming must give the cap what was shown.
        colorMode: 'limited',
        limitedColors: kept,
      });
    },
  });
  foot.append(cancelBtn, doneBtn);

  /* ---------------- Preview zoom / pan ----------------
     Independent of the trace on purpose: someone zoomed in on a thin line wants to watch
     that line react while they drag a tone slider, not lose their place on every tick. Only
     the explicit "fit" button resets it. */
  let viewScale = 1;
  let viewTx = 0;
  let viewTy = 0;
  const MIN_SCALE = 1;
  const MAX_SCALE = 8;

  const applyView = () => {
    const canvas = prev.querySelector('canvas');
    if (canvas) (canvas as HTMLCanvasElement).style.transform = `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`;
  };
  const zoomAt = (factor: number, originX: number, originY: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewScale * factor));
    const ratio = next / viewScale;
    // Keep the point under `origin` (container-centre-relative) stationary while the scale
    // changes, so scrolling over a corner zooms into that corner rather than the middle.
    viewTx = originX - (originX - viewTx) * ratio;
    viewTy = originY - (originY - viewTy) * ratio;
    viewScale = next;
    applyView();
  };
  const resetView = () => {
    viewScale = 1;
    viewTx = 0;
    viewTy = 0;
    applyView();
  };

  prev.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = prev.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
    },
    { passive: false },
  );

  let panning = false;
  let panLastX = 0;
  let panLastY = 0;
  prev.addEventListener('pointerdown', (e) => {
    panning = true;
    panLastX = e.clientX;
    panLastY = e.clientY;
    prev.setPointerCapture(e.pointerId);
    prev.classList.add('is-panning');
  });
  prev.addEventListener('pointermove', (e) => {
    if (!panning) return;
    viewTx += e.clientX - panLastX;
    viewTy += e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    applyView();
  });
  const stopPan = () => {
    panning = false;
    prev.classList.remove('is-panning');
  };
  prev.addEventListener('pointerup', stopPan);
  prev.addEventListener('pointercancel', stopPan);

  const zoomControls = el('div', { className: 'wz-zoom-controls' }, [
    iconButton({ icon: ICONS.zoomOut, label: 'Zoom out', onClick: () => zoomAt(1 / 1.4, 0, 0) }),
    iconButton({ icon: ICONS.maximize, label: 'Fit to view', onClick: resetView }),
    iconButton({ icon: ICONS.zoomIn, label: 'Zoom in', onClick: () => zoomAt(1.4, 0, 0) }),
  ]);
  overlay.querySelector('#wzZoomMount')!.replaceWith(zoomControls);

  /*
    Two caches, because the two views cost very differently. The adjusted image is a per-pixel
    pass and is redrawn on every slider tick. The traced result runs the whole pipeline — up to
    a second on a big upload — so it is recomputed only after the input goes quiet, and the
    stale result stays on screen (dimmed) until the fresh one lands, rather than flashing
    empty. It is also what decides whether Confirm is allowed: an image adjusted until nothing
    is left traces to no outline, and that used to be discovered after the dialog closed.
  */
  let lastAdjusted: RgbaImage | null = null;
  let lastResult: { set: RegionSet } | null = null;
  let resultStale = true;
  let resultTimer = 0;

  /* ---------------- The colours the picture has, and which to keep ----------------

     This is the handle that was missing. An automatic split into N colours has no way to
     know that the 1.7% of pink on a heart's cheeks matters more than the difference between
     two reds, and when it got that wrong there was nothing to pull: Ian's words were "the
     wizard removed the pink cheeks and there is nothing I can do to fix or adjust it". So the
     picture's colours are listed, biggest first, each with a Keep switch. What is not kept
     merges into the nearest kept colour, and the Result view is drawn from the ticked set —
     never from a count.

     The list is rebuilt whenever the PICTURE changes (tone, background), because those change
     what colours exist. A tick survives the rebuild by colour, not by position: after a tone
     nudge every candidate moves a little, so "the pink one" is matched by nearest colour. */
  let candidates: ColourCandidate[] = [];
  let keep: boolean[] = [];
  let candidatesStale = true;
  /** Ticks a person set by hand, remembered by colour so they outlive a rebuild. */
  const ticks: { lab: [number, number, number]; keep: boolean }[] = (opts.initialLimitedColors ?? [])
    .map((rgb) => ({ lab: srgbToOklab(rgb), keep: true }));
  // Reopening with a remembered list: everything NOT on it was unticked last time.
  let untickedByDefault = ticks.length > 0;

  const labDist = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const keptColours = (): RGB[] => candidates.filter((_, i) => keep[i]).map((c) => c.rgb);

  const colourList = el('div', { className: 'wz-colour-list' });
  const colourCount = el('span', { className: 'wz-colour-count' });

  const renderColourList = () => {
    colourList.innerHTML = '';
    const n = keep.filter(Boolean).length;
    colourCount.textContent = candidates.length
      ? `${n} of ${candidates.length} kept`
      : 'no colours found';
    candidates.forEach((c, i) => {
      const [r, g, b] = c.rgb;
      const pct = c.coverage >= 0.01 ? `${Math.round(c.coverage * 100)}%` : '<1%';
      const row = toggleSwitch({
        label: pct,
        checked: keep[i],
        onChange: (on) => {
          // The last kept colour cannot go: a design with no colours is not a design.
          if (!on && keep.filter(Boolean).length <= 1) { row.setValue(true); return; }
          keep[i] = on;
          ticks.push({ lab: srgbToOklab(c.rgb), keep: on });
          renderColourList();
          traceChanged();
        },
      });
      row.classList.add('wz-colour-row');
      row.prepend(el('span', {
        className: 'wz-colour-dot',
        attrs: { style: `background:rgb(${r},${g},${b})`, title: `rgb(${r}, ${g}, ${b})` },
      }));
      colourList.append(row);
    });
  };

  const refreshCandidates = () => {
    candidatesStale = false;
    if (!lastAdjusted) lastAdjusted = adjusted();
    const img: RgbaImage = {
      data: new Uint8ClampedArray(lastAdjusted.data),
      width: lastAdjusted.width,
      height: lastAdjusted.height,
    };
    candidates = discoverColours(img, !params.keepBackground).slice(0, MAX_COLOURS);
    keep = candidates.map((_, i) => (untickedByDefault ? false : i < defaultKeep));
    candidates.forEach((c, i) => {
      const lab = srgbToOklab(c.rgb);
      // The LAST decision about this colour wins, so a tick that was flipped twice reads right.
      for (const t of ticks) if (labDist(t.lab, lab) <= SAME_COLOUR) keep[i] = t.keep;
    });
    if (candidates.length && !keep.some(Boolean)) {
      // A remembered list that matched nothing (a different picture): fall back to the default.
      for (let i = 0; i < keep.length; i++) keep[i] = i < defaultKeep;
      untickedByDefault = false;
    }
    renderColourList();
  };

  const renderPalette = (set: RegionSet | null) => {
    palette.innerHTML = '';
    if (!set) return;
    const ordered = set.regions.slice().sort((a, b) => b.coverage - a.coverage);
    for (const r of ordered) {
      const [rr, gg, bb] = r.quantRgb;
      const pct = Math.round(r.coverage * 100);
      palette.append(
        el('span', { className: 'wz-swatch', attrs: { title: `${pct}% of the design` } }, [
          el('span', { className: 'wz-swatch-dot', attrs: { style: `background:rgb(${rr},${gg},${bb})` } }),
          `${pct}%`,
        ]),
      );
    }
  };

  const show = () => {
    prev.innerHTML = '';
    if (view === 'original') {
      if (!lastAdjusted) lastAdjusted = adjusted();
      prev.appendChild(imageToCanvas(lastAdjusted));
      prev.classList.remove('is-stale');
    } else {
      if (lastResult) prev.appendChild(regionsToCanvas(lastResult.set, RESULT_PX, RESULT_PX));
      prev.classList.toggle('is-stale', resultStale);
    }
    applyView();
  };

  const computeResult = () => {
    resultTimer = 0;
    if (!lastAdjusted) lastAdjusted = adjusted();
    const img: RgbaImage = {
      data: new Uint8ClampedArray(lastAdjusted.data),
      width: lastAdjusted.width,
      height: lastAdjusted.height,
    };
    if (candidatesStale) refreshCandidates();
    const kept = keptColours();
    const set = processImage(img, Math.max(1, kept.length), {
      removeBg: !params.keepBackground,
      smoothing,
      designMm: opts.designMm,
      customColors: kept.length ? kept : undefined,
    });
    lastResult = { set };
    resultStale = false;
    const ok = set.outline.length > 0;
    doneBtn.setDisabled(!ok);
    err.hidden = ok;
    const shapes = set.regions.reduce((n, r) => n + r.components.length, 0);
    stats.classList.remove('is-busy');
    stats.textContent = ok
      ? `${set.regions.length} ${set.regions.length === 1 ? 'colour' : 'colours'} · ${shapes} ${shapes === 1 ? 'shape' : 'shapes'}`
      : '';
    renderPalette(ok ? set : null);
    if (view === 'result') show();
  };

  /** The debounce window is also the only moment there is time to paint a status before the
   *  (synchronous, up-to-a-second) trace blocks the main thread — so it has to be set here,
   *  not inside `computeResult`, or it would never get a frame to appear in. */
  const setBusy = () => {
    stats.classList.add('is-busy');
    stats.textContent = 'Tracing…';
  };

  /** Something that changes the picture itself: redraw it now, retrace it shortly. */
  const imageChanged = () => {
    lastAdjusted = null;
    candidatesStale = true;
    resultStale = true;
    doneBtn.setDisabled(true);
    setBusy();
    show();
    clearTimeout(resultTimer);
    resultTimer = window.setTimeout(computeResult, 180);
  };
  /** Something that changes only the tracing: the picture is fine, retrace it shortly. */
  const traceChanged = () => {
    resultStale = true;
    doneBtn.setDisabled(true);
    setBusy();
    show();
    clearTimeout(resultTimer);
    resultTimer = window.setTimeout(computeResult, 120);
  };

  const viewRow = segmentedControl<'original' | 'result'>({
    options: [
      { value: 'original', label: 'Original' },
      { value: 'result', label: 'Result' },
    ],
    value: view,
    onChange: (v) => {
      view = v;
      show();
    },
  });
  overlay.querySelector('#wzViewMount')!.replaceWith(viewRow);

  /* ---------------- Controls: grouped by the decision they make, in the order a
     user makes them. Tracing (colours, background, smoothing) is what decides the
     Result and is always visible; tone is a fix-up most pictures never need, so it
     starts collapsed. */

  const coloursBlock = el('div', { className: 'wz-colours' }, [
    el('div', { className: 'wz-colours-head' }, [
      el('span', { className: 'vl-switch-label', text: 'Colours in this picture' }),
      colourCount,
    ]),
    colourList,
    el('p', { className: 'vl-hint', text: 'Each kept colour becomes a filament. Anything unticked merges into the nearest kept colour.' }),
  ]);

  const bgRow = toggleSwitch({
    label: 'Remove background',
    help: 'Strip a flat background so only the artwork is traced. Off keeps the whole picture as the design.',
    checked: !params.keepBackground,
    onChange: (on) => {
      params.keepBackground = !on;
      // The background is a colour too, so the list changes with it.
      candidatesStale = true;
      traceChanged();
    },
  });

  const smoothRow = sliderRow({
    label: 'Smoothing',
    help: 'Rounds off the traced outlines. Lower keeps corners and fine detail; higher gives fewer, cleaner edges.',
    min: 0, max: 1, step: 0.05, value: smoothing,
    format: (v) => `${Math.round(v * 100)}%`,
    parse: (typed) => typed / 100,
    onInput: (v) => {
      smoothing = v;
      traceChanged();
    },
  });

  const sliderByKey = new Map<keyof PreprocessParams, SliderRowHandle>();
  const toneRows = SLIDERS.map(([k, l]) => {
    const row = sliderRow({
      label: l,
      min: 0,
      max: 2,
      step: 0.05,
      value: params[k] as number,
      onInput: (v) => {
        (params[k] as number) = v;
        imageChanged();
      },
    });
    sliderByKey.set(k, row);
    return row;
  });

  const resetToneBtn = button({
    label: 'Reset adjustments',
    emphasis: 'secondary',
    block: true,
    onClick: () => {
      for (const [k] of SLIDERS) {
        (params[k] as number) = 1;
        sliderByKey.get(k)!.setValue(1);
      }
      imageChanged();
    },
  });

  controlsEl.append(
    section({ title: 'Tracing', body: [coloursBlock, bgRow, smoothRow] }),
    collapsibleSection({
      title: 'Fix the picture',
      open: false,
      body: [
        el('p', { className: 'vl-hint', text: 'Contrast and Exposure matter most for a clean trace — turn them up to pull back faint lines or small text.' }),
        ...toneRows,
        resetToneBtn,
      ],
    }),
  );

  // First paint: the picture at once, the trace right behind it.
  show();
  computeResult();
}
