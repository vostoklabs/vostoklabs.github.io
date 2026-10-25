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
  button, collapsibleSection, colorChip, colorPopover, el, helpTip, ICONS, iconButton, section,
  segmentedControl, sliderRow, toggleSwitch, type SliderRowHandle,
} from '@vostok/ui-kit';
import {
  closestPairMapping, discoverColours, preprocessImage, processImage, srgbToOklab,
  type ColourCandidate, type RgbaImage,
} from '@vostok/trace';
import { DEFAULT_PREPROCESS, FILAMENTS, type PreprocessParams, type RegionSet, type RGB } from '../types';

/** A colour found in the picture, and the filament group it prints in (groups numbered biggest
 *  first, the way `processImage`'s `mergeInto` takes them). */
export interface MappedColour {
  rgb: RGB;
  group: number;
}

export interface WizardResult {
  adjusted: RgbaImage; // cropped + tone-adjusted, background still present
  preprocess: PreprocessParams;
  colorCount: number;
  smoothing: number;
  colorMode: 'mapped';
  /** Every colour of the picture, and the group it prints in. */
  mappedColors: MappedColour[];
  /** Each group's filament, by group. */
  mappedFilaments: RGB[];
}

interface WizardOpts {
  baseImage: RgbaImage;
  initialColorCount: number;
  initialSmoothing: number;
  initialRemoveBg: boolean;
  /** Reopening on the same picture: start from what was confirmed last time. */
  initialPreprocess?: PreprocessParams;
  /** The mapping confirmed last time, so reopening shows the same choices. */
  initialMapping?: { colors: MappedColour[]; filaments: RGB[] };
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
/** Two colours this close in Oklab are "the same colour" when the list is rebuilt after a tone
 *  change nudges every candidate a little. */
const SAME_COLOUR = 0.12;
/** How many filaments the engine fits a picture into before anyone has said otherwise: what
 *  most AMS units hold. Not a limit: five prints, with a filament swap. */
const FILAMENT_BUDGET = 4;

const hexOf = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const sameRgb = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** The shelf filament nearest a colour as a person sees it (Oklab), by name: what the picker
 *  calls it. By plain RGB distance a leaf green came out nearer Brown than Green. */
function filamentName(rgb: RGB): string {
  let best = 'Custom';
  let bestD = Infinity;
  const [l, a, b] = srgbToOklab(rgb);
  for (const [name, hex] of FILAMENTS) {
    const [fl, fa, fb] = srgbToOklab(rgbOf(hex));
    const d = (l - fl) ** 2 + (a - fa) ** 2 + (b - fb) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

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
function regionsToCanvas(set: RegionSet, width: number, height: number, paint: (rgb: RGB) => RGB): HTMLCanvasElement {
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
    // In the filament it prints in, not the picture's colour: what you confirm is what prints.
    const [cr, cg, cb] = paint(r.quantRgb);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    for (const comp of r.components) ctx.fill(toPath(comp.rings), 'evenodd');
  }
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

  /* ---------------- The colours the picture has, and the filament each prints in ----------------

     One list, one idea: every colour the picture is made of, biggest first, pointing at the
     filament it prints in. Two colours pointed at one filament merge (they trace as one region,
     no seam); a colour with a filament of its own is its own part. Picking a colour that is
     already in the design merges into it; picking any other filament recolours.

     The engine decides first: the two closest colours merge until the design fits four filaments
     (`closestPairMapping`), so a colour that looks different survives even when it is small: the
     green eyes on an orange cat. Keeping the four biggest painted them orange, with nothing in
     the window able to say so.

     The list is rebuilt whenever the PICTURE changes (tone, background), because that changes
     what colours exist. A choice survives the rebuild by colour, not by position: after a tone
     nudge every colour moves a little, so each new colour takes the group of the old one nearest
     it, and a colour near none of them is a part of its own. */
  let candidates: ColourCandidate[] = [];
  /** The group each candidate prints in: any integers, one per group. */
  let groupOf: number[] = [];
  /** Each group's filament. */
  const filamentOf = new Map<number, RGB>();
  let nextGroup = 0;
  let candidatesStale = true;
  /** The mapping as it stands, by colour, to carry across a rebuild. Seeded from a reopen. */
  let remembered: { lab: [number, number, number]; group: number; filament: RGB }[] = opts.initialMapping
    ? opts.initialMapping.colors.map((c) => ({
        lab: srgbToOklab(c.rgb),
        group: c.group,
        filament: opts.initialMapping!.filaments[c.group] ?? c.rgb,
      }))
    : [];

  const labDist = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** The groups, biggest first by the share of the picture they print. */
  const groupsInOrder = (): number[] => {
    const cover = new Map<number, number>();
    candidates.forEach((c, k) => cover.set(groupOf[k], (cover.get(groupOf[k]) ?? 0) + c.coverage));
    return [...cover.keys()].sort((p, q) => cover.get(q)! - cover.get(p)!);
  };
  /** The mapping as `processImage` and the build take it: groups numbered biggest first. */
  const mapping = (): { colors: MappedColour[]; filaments: RGB[] } => {
    const order = groupsInOrder();
    const rank = new Map(order.map((g, i) => [g, i] as const));
    return {
      colors: candidates.map((c, k) => ({ rgb: c.rgb, group: rank.get(groupOf[k])! })),
      filaments: order.map((g) => filamentOf.get(g)!),
    };
  };
  /** The filament a traced region prints in: its colour is one of the candidates (its group's
   *  biggest), so its group is that candidate's. */
  const filamentFor = (rgb: RGB): RGB => {
    const k = candidates.findIndex((c) => sameRgb(c.rgb, rgb));
    return k >= 0 ? filamentOf.get(groupOf[k]) ?? rgb : rgb;
  };
  const remember = () => {
    remembered = candidates.map((c, k) => ({ lab: srgbToOklab(c.rgb), group: groupOf[k], filament: filamentOf.get(groupOf[k])! }));
  };

  const colourList = el('div', { className: 'wz-colour-list' });
  const colourCount = el('span', { className: 'wz-colour-count' });

  /** Merge (`into` a group already in the design) or recolour one colour of the picture. The
   *  first colour of a group carries the whole group with it; any other goes alone. */
  const choose = (k: number, hex: string, into?: number) => {
    const g = groupOf[k];
    const first = groupOf.indexOf(g) === k;
    if (into !== undefined) {
      if (into === g || !filamentOf.has(into)) return;
      if (first) {
        for (let i = 0; i < groupOf.length; i++) if (groupOf[i] === g) groupOf[i] = into;
        filamentOf.delete(g);
      } else {
        groupOf[k] = into;
      }
      changed(true);
      return;
    }
    const rgb = rgbOf(hex);
    if (first || groupOf.filter((x) => x === g).length === 1) {
      filamentOf.set(g, rgb);
      changed(false);
    } else {
      const ng = nextGroup++;
      groupOf[k] = ng;
      filamentOf.set(ng, rgb);
      changed(true);
    }
  };
  /** After a choice: the list, and either a fresh trace (the groups changed) or only a repaint
   *  (a filament changed, which the trace does not depend on). */
  const changed = (retrace: boolean) => {
    remember();
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
    const order = groupsInOrder();
    const design = order.map((g) => ({ hex: hexOf(filamentOf.get(g)!), name: filamentName(filamentOf.get(g)!) }));
    colorPopover({
      x: r.left,
      y: r.bottom + 6,
      value: hexOf(filamentOf.get(groupOf[k])!),
      groups: [
        { label: 'In this design', options: design },
        { label: 'Filaments', options: FILAMENTS.map(([name, hex]) => ({ name, hex })) },
      ],
      onSelect: (hex, from) => {
        if (from?.group === 0) choose(k, hex, order[design.findIndex((d) => d.hex === hex.toLowerCase() || d.hex === hex)]);
        else choose(k, hex);
      },
    });
  };

  const renderColourList = () => {
    colourList.replaceChildren();
    const order = groupsInOrder();
    colourCount.textContent = candidates.length
      ? `${order.length} ${order.length === 1 ? 'filament' : 'filaments'}`
      : 'no colours found';
    for (const g of order) {
      const fil = filamentOf.get(g)!;
      const name = filamentName(fil);
      candidates.forEach((c, k) => {
        if (groupOf[k] !== g) return;
        const first = groupOf.indexOf(g) === k;
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
            onClick: (e) => openPicker(e, k),
          }),
          el('span', { className: 'wz-map-name', text: first ? name : `with ${name.toLowerCase()}` }),
        ]));
      });
    }
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
    filamentOf.clear();
    groupOf = [];
    if (remembered.length) {
      const fromOld = new Map<number, number>();
      candidates.forEach((c, k) => {
        const lab = srgbToOklab(c.rgb);
        let best = -1;
        let bestD = SAME_COLOUR;
        remembered.forEach((m, i) => {
          const d = labDist(m.lab, lab);
          if (d <= bestD) { bestD = d; best = i; }
        });
        if (best < 0) {
          const g = nextGroup++;
          groupOf[k] = g;
          filamentOf.set(g, c.rgb);
          return;
        }
        let g = fromOld.get(remembered[best].group);
        if (g === undefined) {
          g = nextGroup++;
          fromOld.set(remembered[best].group, g);
          filamentOf.set(g, remembered[best].filament);
        }
        groupOf[k] = g;
      });
    } else {
      // Candidates come biggest first, so a group's first member is its biggest: its colour is
      // the group's filament until someone picks another.
      const merge = closestPairMapping(candidates, FILAMENT_BUDGET);
      const ids = new Map<number, number>();
      candidates.forEach((c, k) => {
        let g = ids.get(merge[k]);
        if (g === undefined) {
          g = nextGroup++;
          ids.set(merge[k], g);
          filamentOf.set(g, c.rgb);
        }
        groupOf[k] = g;
      });
    }
    remember();
    renderColourList();
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

  const show = () => {
    prev.replaceChildren();
    if (view === 'original') {
      if (!lastAdjusted) lastAdjusted = adjusted();
      prev.appendChild(imageToCanvas(lastAdjusted));
      prev.classList.remove('is-stale');
    } else {
      if (lastResult) prev.appendChild(regionsToCanvas(lastResult.set, RESULT_PX, RESULT_PX, filamentFor));
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
    // Every colour the picture has, each relabelled to the group it prints in: the trace is the
    // groups' outlines, merged colours as one region with no seam between them.
    const m = mapping();
    const set = processImage(img, Math.max(1, m.filaments.length), {
      removeBg: !params.keepBackground,
      smoothing,
      designMm: opts.designMm,
      ...(candidates.length ? { customColors: m.colors.map((c) => c.rgb), mergeInto: m.colors.map((c) => c.group) } : {}),
    });
    lastResult = { set };
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
      el('span', { className: 'vl-switch-label', text: 'Colours in your picture' }),
      el('span', { className: 'wz-colour-count-line' }, [
        colourCount,
        helpTip('Each colour prints in the filament beside it. Pick a colour already in the design to merge two. Most AMS units hold 4.'),
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
  show();
  computeResult();
}
