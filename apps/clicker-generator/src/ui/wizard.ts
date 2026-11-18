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
// The crop is back, as a free box on the Original view, but as a mask rather than a cut: what
// lies outside the box is left out of the trace after the background was taken off the whole
// picture. Cutting the pixels first starved the background remover (it reads the picture's
// border to find the background, and a box through the art has the art for a border), and it
// would have kept a saved project from ever widening the crop again.
//
// Parts of the picture can be taken out: a tap on the Result view marks the area of one colour
// under it (what Remove would take), and a tap where something was taken, by an earlier Remove
// or by the background removal, marks what Bring back would return. A whole colour can be
// dropped from its filament's picker. Each is kept as a place in the picture (`PictureEdit`),
// never as a traced shape, so it holds through every retrace, and the build applies the same
// list. Undo takes back the last one; "Put everything back" all of them.
//
// The preview has two views. "Original" is the tone-adjusted picture, with the crop box over
// it. "Result" is the real
// thing: the same pipeline the build runs (background removal -> quantise -> trace), drawn
// from the traced polygons, so what you confirm is what the cap gets. It supports wheel-zoom
// and drag-pan plus a "fit" reset, because thin lines and small text are exactly what someone
// needs to check before committing to a print.
//
// On confirm it hands the adjusted image (background intact) + every setting back; the caller
// writes them to the store and runs the trace/build pipeline. It can be reopened on the same
// picture from the sidebar, with the settings it was last confirmed with.
import {
  button, collapsibleSection, colorChip, colorPopover, cropBox, el, helpTip, ICONS, iconButton, section,
  segmentedControl, sliderRow, stepperRow, themeColorHex, toggleSwitch, type SliderRowHandle,
} from '@vostok/ui-kit';
import {
  cleanCropBox, findColours, LIST_MAX, pictureAreaAt, prepareArtwork, preprocessImage, processImage,
  type CropBox, type PictureArea, type PictureBase, type PictureEdit, type RgbaImage, type TraceFrame,
} from '@vostok/trace';
import { clientToPixel, pictureRect, pictureToCanvas, resultScale, toFraction } from './wizardMath';
import { DEFAULT_PREPROCESS, FILAMENTS, type PreprocessParams, type RegionSet, type RGB } from '../types';
import { filamentName } from './filamentName';
import type { MappedColour } from './colourSplit';
import { colourChoices } from './colourChoices';
import { canRemoveColour, editList, nextCrop, tapAction, toolsRow } from './wizardTools';

export type { MappedColour } from './colourSplit';

export interface WizardResult {
  adjusted: RgbaImage; // tone-adjusted, background still present, never cut by the crop
  preprocess: PreprocessParams;
  colorCount: number;
  smoothing: number;
  colorMode: 'mapped';
  /** Every colour of the picture, and the group it prints in. */
  mappedColors: MappedColour[];
  /** Each group's filament, by group. */
  mappedFilaments: RGB[];
  /** What was taken out of the picture or brought back, in order, in the space of `adjusted`. */
  pictureEdits: PictureEdit[];
  /** The crop, in the space of `adjusted`; null = the whole picture. */
  pictureCrop: CropBox | null;
}

interface WizardOpts {
  /** The window's heading. Default "Prepare Image". */
  title?: string;
  baseImage: RgbaImage;
  initialColorCount: number;
  initialSmoothing: number;
  initialRemoveBg: boolean;
  /** Reopening on the same picture: start from what was confirmed last time. */
  initialPreprocess?: PreprocessParams;
  /** The mapping confirmed last time, so reopening shows the same choices. */
  initialMapping?: { colors: MappedColour[]; filaments: RGB[] };
  /** The edits confirmed last time on this picture. A new picture has none. */
  initialEdits?: PictureEdit[];
  /** The crop confirmed last time on this picture. A new picture has none. */
  initialCrop?: CropBox | null;
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

const hexOf = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

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
function regionsToCanvas(
  set: RegionSet,
  width: number,
  height: number,
  paint: (rgb: RGB) => RGB,
  /** A marked area, drawn over the result where it lies in the picture. */
  mark?: { canvas: HTMLCanvasElement; frame: TraceFrame } | null,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  // Rings are normalised (longest side = 1, centred, Y-up); undo that into pixels of the
  // artwork's bounding box, which is drawn to fit the canvas with a small margin.
  const scale = resultScale(set, width, height);
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
    // In the filament it prints in, not the picture's colour: what you confirm is what prints.
    const [cr, cg, cb] = paint(r.quantRgb);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    for (const comp of r.components) ctx.fill(toPath(comp.rings), 'evenodd');
  }
  if (mark) {
    // The mark is in the picture's own pixels; the frame puts them under the rings exactly.
    const t = pictureToCanvas(mark.frame, scale, width, height);
    ctx.setTransform(t.k, 0, 0, t.k, t.dx, t.dy);
    ctx.drawImage(mark.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return c;
}

/** A marked area as a picture-size canvas: the accent, see-through, over what Remove would take;
 *  the picture's own colours, nearly solid, where Bring back would return something. */
function markCanvas(area: PictureArea, picture: RgbaImage, accent: RGB): HTMLCanvasElement {
  const { width: W, height: H } = picture;
  const px = new Uint8ClampedArray(W * H * 4);
  const src = picture.data;
  for (let p = 0; p < area.mask.length; p++) {
    if (!area.mask[p]) continue;
    const o = p * 4;
    if (area.op === 'remove') {
      px[o] = accent[0]; px[o + 1] = accent[1]; px[o + 2] = accent[2]; px[o + 3] = 115;
    } else {
      px[o] = src[o]; px[o + 1] = src[o + 1]; px[o + 2] = src[o + 2]; px[o + 3] = 190;
    }
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  return c;
}

export function runWizard(opts: WizardOpts) {
  const params: PreprocessParams = { ...DEFAULT_PREPROCESS, ...(opts.initialPreprocess ?? {}) };
  params.keepBackground = !opts.initialRemoveBg;
  let smoothing = opts.initialSmoothing;
  let view: 'original' | 'result' = 'result';

  const overlay = document.createElement('div');
  overlay.className = 'wz-overlay';
  document.body.appendChild(overlay);

  // Esc clears a mark (and only a mark: it never closes the window with work in it).
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selection) {
      e.stopPropagation();
      clearSelection();
    }
  };
  document.addEventListener('keydown', onKey);
  // The crop box sits over the picture as drawn, which moves when the window is resized.
  const onResize = () => placeCrop();
  window.addEventListener('resize', onResize);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    overlay.remove();
  };
  const cancel = () => {
    close();
    opts.onCancel?.();
  };

  // Adjusted image (background intact) for the current params.
  const adjusted = () => preprocessImage(opts.baseImage, params);

  overlay.innerHTML = `
    <div class="wz-modal lg">
      <div class="wz-head"></div>
      <div class="wz-body">
        <div class="wz-left">
          <div class="wz-preview-bar">
            <div id="wzViewMount"></div>
            <div id="wzZoomMount"></div>
            <span class="wz-stats" id="wzStats"></span>
            <span id="wzHelpMount"></span>
          </div>
          <div class="wz-canvas checker" id="wzPrev"><div class="wz-stage"></div></div>
          <div class="wz-tools" id="wzTools"></div>
          <div class="wz-palette" id="wzPalette"></div>
        </div>
        <div class="wz-controls" id="wzControls"></div>
      </div>
      <div class="wz-foot">
        <span class="wz-error" id="wzErr" hidden>No outline found — try more colours, more contrast, or turn off background removal.</span>
      </div>
    </div>`;

  overlay.querySelector<HTMLElement>('.wz-head')!.textContent = opts.title ?? 'Prepare Image';
  overlay.querySelector('#wzHelpMount')!.replaceWith(
    helpTip('Works best on flat, high-contrast art: photos with shadows, gradients or texture trace poorly.'),
  );
  const prev = overlay.querySelector<HTMLElement>('#wzPrev')!;
  // The zoom and pan move the stage, and everything drawn on the picture moves with it.
  const stage = prev.querySelector<HTMLElement>('.wz-stage')!;
  const tools = overlay.querySelector<HTMLElement>('#wzTools')!;
  const err = overlay.querySelector<HTMLElement>('#wzErr')!;
  const stats = overlay.querySelector<HTMLElement>('#wzStats')!;
  const palette = overlay.querySelector<HTMLElement>('#wzPalette')!;
  const controlsEl = overlay.querySelector<HTMLElement>('#wzControls')!;
  const foot = overlay.querySelector<HTMLElement>('.wz-foot')!;

  const cancelBtn = button({ label: 'Cancel', emphasis: 'secondary', onClick: cancel });
  const doneBtn = button({
    label: 'Use these colours',
    emphasis: 'primary',
    onClick: () => {
      if (doneBtn.disabled) return;
      close();
      // Always the mapping, even when nobody touched it: the Result view was drawn from exactly
      // it, and confirming must give the cap what was shown.
      const m = mapping();
      opts.onComplete({
        adjusted: adjusted(),
        preprocess: { ...params },
        colorCount: m.filaments.length,
        smoothing,
        colorMode: 'mapped',
        mappedColors: m.colors,
        mappedFilaments: m.filaments,
        pictureEdits: edits().slice(),
        pictureCrop: crop ? { ...crop } : null,
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
    stage.style.transform = `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`;
    // The crop box's grips divide by this, so they stay one size on screen at any zoom.
    stage.style.setProperty('--vl-zoom', String(viewScale));
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

  /* A press is a tap until it moves more than TAP_PX or lasts longer than TAP_MS; then it is a
     pan. The view does not move before that, so a tap never nudges the picture. */
  const TAP_PX = 4;
  const TAP_MS = 500;
  let pressed = false;
  let panning = false;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let panLastX = 0;
  let panLastY = 0;
  prev.addEventListener('pointerdown', (e) => {
    pressed = true;
    panning = false;
    downX = panLastX = e.clientX;
    downY = panLastY = e.clientY;
    downT = performance.now();
    prev.setPointerCapture(e.pointerId);
  });
  prev.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    if (!panning) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) <= TAP_PX) return;
      panning = true;
      prev.classList.add('is-panning');
    }
    viewTx += e.clientX - panLastX;
    viewTy += e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    applyView();
  });
  const stopPan = () => {
    pressed = false;
    panning = false;
    prev.classList.remove('is-panning');
  };
  prev.addEventListener('pointerup', (e) => {
    const tap = pressed && !panning && performance.now() - downT <= TAP_MS;
    stopPan();
    if (tap) onTap(e.clientX, e.clientY);
  });
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
  let lastResult: { set: RegionSet; frame: TraceFrame | null } | null = null;
  let resultStale = true;
  let resultTimer = 0;

  /* ---------------- Parts taken out, and brought back ----------------
     `edits` are places in the adjusted picture (the one the build traces), applied in order on
     every trace. A tap only marks; the tools row's button does it. `prepared` is the picture as
     the edits see it (background removed, the edits so far applied), which is what a tap reads,
     so the mark is exactly what the button will take or bring back. */
  const editsList = editList(opts.initialEdits ?? []);
  const edits = (): readonly PictureEdit[] => editsList.edits;
  /** Bumped on every change to `edits`: the `prepared` copy is good for one version. */
  let editsVersion = 0;
  let selection: { area: PictureArea; px: number; py: number; canvas: HTMLCanvasElement } | null = null;
  let prepared: { from: RgbaImage; removeBg: boolean; version: number; crop: CropBox | null; img: RgbaImage; base: PictureBase } | null = null;
  /** The crop, in the same space as the edits; null = the whole picture. A new object on every
   *  change, so the `prepared` copy can tell. Widening it again brings back what it hid, edits
   *  included. */
  let crop: CropBox | null = cleanCropBox(opts.initialCrop ?? null);

  const preparedPicture = () => {
    if (!lastAdjusted) lastAdjusted = adjusted();
    const removeBg = !params.keepBackground;
    if (!prepared || prepared.from !== lastAdjusted || prepared.removeBg !== removeBg || prepared.version !== editsVersion || prepared.crop !== crop) {
      const img: RgbaImage = { data: new Uint8ClampedArray(lastAdjusted.data), width: lastAdjusted.width, height: lastAdjusted.height };
      const { base } = prepareArtwork(img, { removeBg, edits: edits(), crop, forPicking: true });
      prepared = { from: lastAdjusted, removeBg, version: editsVersion, crop, img, base: base! };
    }
    return prepared;
  };

  const clearSelection = () => {
    if (!selection) return;
    selection = null;
    renderTools();
    if (view === 'result') show();
  };

  /** A tap on the preview: mark what Remove would take or Bring back would return there. */
  const onTap = (clientX: number, clientY: number) => {
    const canvas = stage.querySelector('canvas');
    const frame = lastResult?.frame;
    if (view !== 'result' || resultStale || !lastResult || !frame || !canvas) return;
    if (!lastAdjusted) return;
    const at = clientToPixel(clientX, clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height,
      frame, resultScale(lastResult.set, canvas.width, canvas.height), lastAdjusted);
    // Off the picture, or the same place again, takes the mark off; at the limit nothing is marked.
    if (!at || tapAction(selection?.area.mask ?? null, at, lastAdjusted.width, editsList.full) === 'clear') {
      clearSelection();
      return;
    }
    const pic = preparedPicture();
    // Outside the crop there is nothing to mark: it is not traced.
    const area = pictureAreaAt(pic.img, pic.base, at.px, at.py, crop);
    if (!area || !area.count) {
      clearSelection();
      return;
    }
    const a = themeColorHex('--accent', 0x2563eb);
    selection = { area, px: at.px, py: at.py, canvas: markCanvas(area, lastAdjusted, [(a >> 16) & 255, (a >> 8) & 255, a & 255]) };
    renderTools();
    show();
  };

  /** A change to the edits: the mark goes, the colours are found again (a part taken out may take
   *  a colour with it), and the picture is traced again. */
  const editsChanged = () => {
    editsVersion++;
    selection = null;
    candidatesStale = true;
    renderTools();
    traceChanged();
  };
  const pushEdit = (e: PictureEdit) => {
    if (editsList.push(e)) editsChanged();
  };
  /** The Remove or Bring back button: the marked area, kept as the place that was tapped. */
  const applySelection = () => {
    if (!selection || !lastAdjusted) return;
    const { x, y } = toFraction(selection.px, selection.py, lastAdjusted.width, lastAdjusted.height);
    pushEdit({ op: selection.area.op, x, y });
  };
  /** Every pixel of one of the picture's colours, anywhere in it. */
  const removeColour = (rgb: RGB) => pushEdit({ op: 'dropColour', rgb: [rgb[0], rgb[1], rgb[2]] });

  /* The row under the preview: one short line, or the button for what is marked; Undo and
     "Put everything back" once something was changed. */
  const toolsHint = el('p', { className: 'vl-hint' });
  const markBtn = button({ label: 'Remove', emphasis: 'secondary', onClick: applySelection });
  const undoBtn = iconButton({
    icon: ICONS.undo,
    label: 'Undo',
    onClick: () => {
      if (editsList.undo()) editsChanged();
    },
  });
  const resetEditsBtn = iconButton({
    icon: ICONS.rotateRight,
    label: 'Put everything back',
    onClick: () => {
      if (editsList.reset()) editsChanged();
    },
  });
  const toolsHistory = el('div', { className: 'wz-tools-history' }, [undoBtn, resetEditsBtn]);

  /* ---------------- The crop ----------------
     A box on the Original view, always there, at the picture's edges until it is pulled in.
     Dragging only redraws the box; letting go traces again. The picture itself is unchanged by
     a crop, so the colours are found again but the adjusted picture is kept. */
  const setCrop = (box: CropBox | null) => {
    // Within a hair of the whole picture is no crop: one value for "none".
    const next = nextCrop(crop, box);
    if (next.showWhole) cropEl.setValue(null);
    if (!next.changed) return;
    crop = next.crop;
    selection = null;
    candidatesStale = true;
    renderTools();
    traceChanged();
  };
  const cropEl = cropBox({
    label: 'Crop',
    value: crop,
    // Until it is pulled in, a drag over the picture pans it, as on the Result view.
    passWhenFull: true,
    onChange: (box, phase) => {
      if (phase === 'end') setCrop(box);
    },
  });
  const cropHost = el('div', { className: 'wz-crop-host' }, [cropEl]);
  /** Lay the crop box exactly over the picture as the Original view draws it. */
  const placeCrop = () => {
    const canvas = stage.querySelector('canvas');
    if (view !== 'original' || !canvas || !cropHost.isConnected || !lastAdjusted) return;
    const r = pictureRect(
      { left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.clientWidth, height: canvas.clientHeight },
      lastAdjusted.width, lastAdjusted.height,
    );
    cropHost.style.left = `${r.x}px`;
    cropHost.style.top = `${r.y}px`;
    cropHost.style.width = `${r.w}px`;
    cropHost.style.height = `${r.h}px`;
  };
  const resetCropBtn = button({
    label: 'Reset crop',
    emphasis: 'secondary',
    onClick: () => setCrop(null),
  });

  tools.append(toolsHint, markBtn, resetCropBtn, toolsHistory);
  const renderTools = () => {
    // One line for the view on screen (the crop on the Original, the tap on the Result), or the
    // button for what is marked.
    const row = toolsRow({
      view,
      marked: selection?.area.op ?? null,
      edits: editsList.edits.length,
      full: editsList.full,
      cropped: crop !== null,
    });
    markBtn.hidden = row.mark === null;
    if (row.mark) markBtn.setLabel(row.mark);
    toolsHint.hidden = row.hint === null;
    if (row.hint) toolsHint.textContent = row.hint;
    resetCropBtn.hidden = !row.resetCrop;
    toolsHistory.hidden = !row.history;
  };

  /* ---------------- The colours the picture has, and the filament each prints in ----------------

     One list, one idea: every colour the picture is made of, biggest first, pointing at the
     filament it prints in. Two colours pointed at one filament merge (they trace as one region,
     no seam); a colour with a filament of its own is its own part. Picking a colour that is
     already in the design merges into it; picking any other filament recolours.

     The engine decides first. Flat art opens with every colour it has, up to five, each its own
     filament (`defaultFilaments`); more than that opens at four, the two closest merged first
     (`closestPairMapping`), so a colour that looks different survives even when it is small: the
     green eyes on an orange cat. Keeping the four biggest painted them orange, with nothing in
     the window able to say so.

     The Colours stepper re-merges the same list: "-" merges the closest pair, "+" takes the last
     merge apart. Past the colours found, "+" asks the finder for a finer split (`finerColours`);
     when even the finest has nothing more, the stepper ends there and says so. A merge or a
     filament picked by hand is kept across a stepper press (`colourChoices`).

     The list is rebuilt whenever the PICTURE changes (tone, background), because that changes
     what colours exist. A choice survives the rebuild by colour, not by position: after a tone
     nudge every colour moves a little, so each new colour takes the group of the old one nearest
     it, and a colour near none of them is a part of its own. */
  /** The colours, their groups and filaments, and the stepper: the rules live in
   *  `colourChoices`; the window draws them. The finder reads the picture as it stands, with
   *  the parts taken out and the crop. */
  const choices = colourChoices((d) => {
    if (!lastAdjusted) lastAdjusted = adjusted();
    return findColours(lastAdjusted, !params.keepBackground, { edits: edits(), crop }, d);
  }, opts.initialMapping);
  let candidatesStale = true;
  const mapping = () => choices.mapping();
  const filamentFor = (rgb: RGB): RGB => choices.filamentFor(rgb);

  /** The picture's colours, found again: the picture changed (tone, background, a part taken out
   *  or brought back, the crop). A colour taken out of the picture leaves the list. */
  const refreshCandidates = () => {
    candidatesStale = false;
    choices.refresh();
    renderColourList();
  };

  /** "+" past the colours found: a finer split, mapped to the count asked for (or to every colour
   *  there is, when the finest split has fewer). */
  const splitFiner = () => {
    choices.splitFiner();
    renderColourList();
  };

  const colourList = el('div', { className: 'wz-colour-list' });
  const colourCount = el('span', { className: 'wz-colour-count' });
  // A new count re-merges the list the picture already has: nothing is found again, unless "+"
  // goes past it, which asks for a finer split on the next trace.
  const colourRow = stepperRow({
    label: 'Colours',
    help: 'How many filaments the picture prints in. The closest colours merge first.',
    min: 1, max: LIST_MAX, step: 1, value: 1,
    onInput: (n) => {
      choices.setCount(n);
      if (!choices.wantFiner) renderColourList();
      traceChanged();
    },
  });

  /** Merge (`into` a group already in the design) or recolour one colour of the picture. The
   *  first colour of a group carries the whole group with it; any other goes alone. */
  const choose = (k: number, hex: string, into?: number) => {
    if (into !== undefined) {
      if (choices.merge(k, into)) changed(true);
      return;
    }
    changed(choices.recolour(k, rgbOf(hex)));
  };
  /** After a choice: the list, and either a fresh trace (the groups changed) or only a repaint
   *  (a filament changed, which the trace does not depend on). */
  const changed = (retrace: boolean) => {
    renderColourList();
    if (retrace) {
      traceChanged();
    } else {
      renderPalette(lastResult?.set ?? null);
      if (view === 'result') show();
    }
  };

  const openPicker = (e: MouseEvent, k: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const order = choices.groupsInOrder();
    const design = order.map((g) => ({ hex: hexOf(choices.filamentOf(g)), name: filamentName(choices.filamentOf(g)) }));
    // Taking the colour out of the picture, while it is not the last one: it then leaves the
    // list, and Undo under the preview brings it back.
    const rgb = choices.candidates[k].rgb;
    const removeBtn = canRemoveColour(choices.candidates.length, editsList.full)
      ? button({ label: 'Remove this colour', emphasis: 'secondary', block: true, onClick: () => { picker.close(); removeColour(rgb); } })
      : undefined;
    const picker = colorPopover({
      x: r.left,
      y: r.bottom + 6,
      value: hexOf(choices.filamentOf(choices.groupOf(k))),
      groups: [
        { label: 'In this design', options: design },
        { label: 'Filaments', options: FILAMENTS.map(([name, hex]) => ({ name, hex })) },
      ],
      onSelect: (hex, from) => {
        if (from?.group === 0) choose(k, hex, order[design.findIndex((d) => d.hex === hex.toLowerCase() || d.hex === hex)]);
        else choose(k, hex);
      },
      ...(removeBtn ? { footer: removeBtn } : {}),
    });
  };

  const renderColourList = () => {
    colourList.replaceChildren();
    const order = choices.groupsInOrder();
    colourCount.textContent = choices.countText();
    // "+" always tries one more, up to the list's end, until the finest split has nothing more:
    // then it ends at the colours there are. The value is the count as it stands: picking a
    // colour already in the design merges two, and that changes it too.
    colourRow.setBounds(1, choices.stepperTop());
    colourRow.setValue(Math.max(1, order.length));
    for (const g of order) {
      const fil = choices.filamentOf(g);
      const name = filamentName(fil);
      choices.candidates.forEach((c, k) => {
        if (choices.groupOf(k) !== g) return;
        const first = choices.isLead(k);
        const pct = c.coverage >= 0.01 ? `${Math.round(c.coverage * 100)}%` : '<1%';
        colourList.append(el('div', { className: first ? 'wz-map-row' : 'wz-map-row wz-map-row--with' }, [
          el('span', {
            className: 'wz-map-dot',
            attrs: { style: `--swatch: ${hexOf(c.rgb)}`, title: `rgb(${c.rgb.join(', ')})`, 'aria-hidden': 'true' },
          }),
          el('span', { className: 'wz-map-pct', text: pct }),
          el('span', { className: 'wz-map-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }),
          colorChip({
            hex: hexOf(fil),
            label: `${pct} of the picture prints in ${name}`,
            menu: true,
            onClick: (e) => openPicker(e, k),
          }),
          el('span', { className: 'wz-map-name', text: first ? name : `with ${name.toLowerCase()}` }),
        ]));
      });
    }
  };

  const renderPalette = (set: RegionSet | null) => {
    palette.replaceChildren();
    if (!set) return;
    const ordered = set.regions.slice().sort((a, b) => b.coverage - a.coverage);
    for (const r of ordered) {
      const pct = Math.round(r.coverage * 100);
      palette.append(
        el('span', { className: 'wz-swatch', attrs: { title: `${pct}% of the design` } }, [
          el('span', { className: 'wz-swatch-dot', attrs: { style: `--swatch: ${hexOf(filamentFor(r.quantRgb))}` } }),
          `${pct}%`,
        ]),
      );
    }
  };

  /** The picture the Original view is drawing: kept while it is unchanged, so a crop's retrace
   *  never rebuilds the box under the pointer or takes the keyboard's focus off it. */
  let shownOriginal: RgbaImage | null = null;
  const show = () => {
    if (view === 'original') {
      if (!lastAdjusted) lastAdjusted = adjusted();
      if (shownOriginal !== lastAdjusted || !cropHost.isConnected) {
        stage.replaceChildren(imageToCanvas(lastAdjusted), cropHost);
        shownOriginal = lastAdjusted;
      }
      cropEl.setValue(crop);
      placeCrop();
      prev.classList.remove('is-stale');
    } else {
      stage.replaceChildren();
      shownOriginal = null;
      if (lastResult) {
        const mark = selection && lastResult.frame ? { canvas: selection.canvas, frame: lastResult.frame } : null;
        stage.appendChild(regionsToCanvas(lastResult.set, RESULT_PX, RESULT_PX, filamentFor, mark));
      }
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
    if (choices.wantFiner) splitFiner();
    // Every colour the picture has, each relabelled to the group it prints in: the trace is the
    // groups' outlines, merged colours as one region with no seam between them.
    const m = mapping();
    let frame: TraceFrame | null = null;
    const set = processImage(img, Math.max(1, m.filaments.length), {
      removeBg: !params.keepBackground,
      smoothing,
      designMm: opts.designMm,
      ...(choices.candidates.length ? { customColors: m.colors.map((c) => c.rgb), mergeInto: m.colors.map((c) => c.group) } : {}),
      edits: edits(),
      // Outside the box is left out of the trace (and of the colours, above).
      crop,
      // Where the artwork sits in the picture: what turns a tap on the result into a pixel.
      onFrame: (f) => { frame = f; },
    });
    lastResult = { set, frame };
    resultStale = false;
    const ok = set.outline.length > 0;
    doneBtn.setDisabled(!ok);
    err.hidden = ok;
    const shapes = set.regions.reduce((n, r) => n + r.components.length, 0);
    stats.classList.remove('is-busy');
    stats.textContent = ok
      ? `${m.filaments.length} ${m.filaments.length === 1 ? 'filament' : 'filaments'} · ${shapes} ${shapes === 1 ? 'shape' : 'shapes'}`
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
    selection = null;
    renderTools();
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
    // The mark was worked out on the picture as it was: any change takes it off.
    if (selection) {
      selection = null;
      renderTools();
    }
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
      selection = null;
      renderTools();
      show();
    },
  });
  overlay.querySelector('#wzViewMount')!.replaceWith(viewRow);

  /* ---------------- Controls: grouped by the decision they make, in the order a
     user makes them. Tracing (colours, background, smoothing) is what decides the
     Result and is always visible; tone is a fix-up most pictures never need, so it
     starts collapsed. */

  const coloursBlock = el('div', { className: 'wz-colours' }, [
    colourRow,
    el('div', { className: 'wz-colours-head' }, [
      el('span', { className: 'vl-switch-label', text: 'Colours in your picture' }),
      el('span', { className: 'wz-colour-count-line' }, [
        colourCount,
        helpTip("Tap a colour's filament to change it, or to merge it into another. Most AMS units hold 4."),
      ]),
    ]),
    colourList,
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
  renderTools();
  show();
  computeResult();
}
