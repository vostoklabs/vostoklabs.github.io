import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell, topbarLinks, generatorHeader, qualityCallout, section, collapsibleSection, sampleGrid,
  sliderRow, toggleSwitch, segmentedControl, sidebarFooter, stageStatus,
  filamentRow, contrastRatio,
  toast, dialog, openLicenseModal, licenseReminderToast, el,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { downloadThreeMF, type ExportPart } from '@vostok/export';
import {
  FONTS, curatedFonts, getFont, parseFont, registerCustomFont, isFontSupported,
  getHorizontalContours, getVerticalContours,
} from '@vostok/fonts';
import {
  DEFAULTS, atScale, isSideBySide, type SignParams, type PlateShape, type MountKind,
  type Align, type VAlign, type Orientation, type LinePlacement,
} from './types';
import type { GeometryRequest, GeometryResponse, PartMesh } from './types';
import { applyPreset, coerceSettings, PRESETS } from './state';
import { textRow, selectRow } from './controls';
import { fontPicker } from './fontPicker';
import { platePreviewSvg, type PreviewTheme } from './previews';

/* ── 1 · State ──────────────────────────────────────────────────────────────── */

let params: SignParams = { ...DEFAULTS, fontId: curatedFonts()[0]?.id ?? FONTS[0]!.id };
let parts: ExportPart[] = [];
/** A font the user uploaded this session, so a rebuild does not re-parse it. */
let customFontId = '';

/* ── 2 · Geometry, off the main thread ──────────────────────────────────────── */

const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });
let workerReady = false;
/** Set while a build is in flight, so a slider drag coalesces instead of queueing. */
let building = false;
let pending = false;
let refitNext = false;

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    workerReady = true;
    void rebuild(true);
    return;
  }
  if (msg.type === 'error') {
    building = false;
    status.set(msg.message, 'error');
    return;
  }
  if (msg.type === 'parts') {
    building = false;
    parts = msg.parts.map((p: PartMesh) => ({
      name: p.name,
      positions: p.vertProperties,
      indices: p.triVerts,
      color: p.colorRgb,
    }));
    viewer.setParts(parts, refitNext);
    refitNext = false;

    renderReport(msg.size, parts.length);
    warnLowContrast();
    // The cards show your own text in your own font, so they follow the build rather than
    // being painted once at startup with a guess.
    void paintExamples();

    const tris = parts.reduce((n, p) => n + p.indices.length / 3, 0);
    // With no plate there is no plate to be thick, and no plate footprint to quote — the
    // readout used to claim both, describing a model that was not on screen.
    const loose = params.shape === 'none';
    const depth = (loose ? 0 : params.plateThickness) + params.textThickness;
    const line = loose
      ? `${parts.length} loose piece${parts.length === 1 ? '' : 's'} · ${depth.toFixed(1)} mm deep`
        + ` · ${tris.toLocaleString()} triangles`
      : `${Math.round(msg.size.width)} × ${Math.round(msg.size.height)} × ${depth.toFixed(1)} mm`
        + ` · ${parts.length} part${parts.length === 1 ? '' : 's'} · ${tris.toLocaleString()} triangles`;
    status.set(msg.warnings.length > 0 ? `${line} — ${msg.warnings[0]}` : line,
               msg.warnings.length > 0 ? 'warn' : undefined);

    if (pending) { pending = false; void rebuild(); }
  }
};

/**
 * Lay the text out on the main thread, then hand the contours to the worker.
 *
 * The layout needs the parsed font, which lives here because the font picker and the
 * upload both live here; the geometry needs WASM, which lives there. Contours are the
 * natural seam — they are small, plain arrays, and they are exactly what
 * `@vostok/fonts` already produces for the keychain.
 */
async function rebuild(refit = false) {
  if (!workerReady) return;
  if (refit) refitNext = true;
  if (building) { pending = true; return; }

  const text = params.text.trim();
  if (text === '') {
    parts = [];
    viewer.setParts([], false);
    status.set('Type a number to see it.');
    renderReport(null, 0);
    return;
  }

  building = true;
  try {
    const font = await getFont(params.fontId);
    const fallback = font;
    // The overall size is folded in here and nowhere else: the layout, the worker and the
    // cards all take real millimetres, so nothing downstream has to know the control exists.
    const p = atScale(params);
    // `stackSpacing`, not `lineSpacing`. The two functions read the number differently —
    // horizontally it is a fraction of the two sizes summed, vertically a multiplier on one
    // character's step — so the horizontal 0.55 came out as a 28.6 mm step under a 52.8 mm
    // glyph and the digits overlapped by 46% of their height. Letter spacing is deliberately
    // no longer fed in either: it is horizontal tracking, and adding it to the vertical step
    // made the one control that says "Letter spacing" the only escape from that overlap.
    const contours = p.orientation === 'vertical'
      ? getVerticalContours(font, fallback, text, p.textSize, p.stackSpacing, 0)
      : getHorizontalContours(
          font, fallback, text, p.text2.trim(),
          p.textSize, p.line2Size, 0, p.align,
          p.lineSpacing, p.letterSpacing,
          // `block`, so alignment moves whichever line is shorter. Under the keychain's
          // `line2` default the short line is usually the number, which stayed pinned while
          // the street name slid — so the control looked like it did nothing.
          { alignMode: 'block', placement: p.linePlacement, vAlign: p.vAlign },
        );

    const req: GeometryRequest = {
      type: 'build',
      textContours: contours.contours,
      // The line is placed between the laid-out lines, and only this side has the font.
      textLines: contours.lines,
      params: { ...p },
    };
    worker.postMessage(req);
  } catch (err) {
    building = false;
    status.set(`Could not lay the text out: ${(err as Error).message}`, 'error');
  }
}

/**
 * Coalesced so dragging a slider rebuilds once per tick, not once per pixel.
 *
 * `refit` means *"show the user a fresh look at a model they did not have before"*, not
 * *"the model changed"*. It reaches `viewer.setParts`, where it calls `setView('iso')` — a
 * hard teleport to a preset angle that throws away whatever orbit, zoom and pan the user
 * had set. Every parameter control here used to pass `true`, including the Number field's
 * `onInput`, so the camera reset on every keystroke. That is the exact thing the template
 * README's "Nothing may jump" section forbids.
 *
 * Only three callers pass `true`, and each replaces the model rather than editing it: the
 * first build once the worker is up, a preset click, and loading a saved project. A
 * parameter edit passes nothing — the plate auto-sizes from the text, and a model that
 * outgrows its frame is already handled inside the viewer by easing the distance outward
 * without touching the angle.
 */
let queued = 0;
function triggerRebuild(refit = false) {
  clearTimeout(queued);
  queued = setTimeout(() => void rebuild(refit), 16) as unknown as number;
}

/* ── 3 · Controls ───────────────────────────────────────────────────────────── */

/** Cards showing your own text in each face — see `fontPicker.ts` for why, not a dropdown. */
const fonts = fontPicker({
  value: params.fontId,
  sampleText: () => params.text,
  onChange: (id) => {
    params.fontId = id;
    const f = FONTS.find((x) => x.id === id);
    if (f && !isFontSupported(f, params.text + params.text2)) {
      toast('This font has no glyph for some of those characters', { kind: 'warn' });
    }
    triggerRebuild();
  },
});

const controls = {
  // Not "Number": people put names, unit codes and words on line 1, and the 8-character cap
  // that assumption justified was the first thing they hit.
  text: textRow({
    label: 'First line', value: params.text, placeholder: '12', maxLength: 24,
    // The font cards render this text, so they follow along as it is typed.
    onInput: (v) => { params.text = v; fonts.refresh(params.fontId); triggerRebuild(); },
  }),
  text2: textRow({
    label: 'Second line', value: params.text2, placeholder: 'Street or name (optional)', maxLength: 24,
    // Alignment and line spacing only mean anything once there is a second line to place.
    onInput: (v) => { params.text2 = v; syncVisibility(); triggerRebuild(); },
  }),
  /*
   * One handle on how big the sign is, above the controls that decide its proportions.
   *
   * Everything that sets the footprint was individually adjustable and nothing moved them
   * together, so "the same sign, but bigger" meant dragging the type size, the margin, the
   * corner radius, the rule and the hole inset by hand and hoping the proportions survived.
   * A template is a set of proportions; this is what they are drawn at. Shown as a percentage
   * because a bare "1.40" invites the question "1.40 what".
   */
  scale: sliderRow({
    label: 'Overall size', min: 0.25, max: 4, step: 0.05, value: params.scale,
    format: (v) => `${Math.round(v * 100)}%`,
    help: 'Scales the whole sign — type, plate, margins and fixing positions together. '
        + 'Thickness, text depth and screw size are printing decisions and keep their own '
        + 'millimetres.',
    onInput: (v) => { params.scale = v; triggerRebuild(); },
  }),
  // "Number height" read as how far the number stands off the plate. It is the cap height
  // of the type — a size. The depth control below is the one that is a height, and it used
  // to be called "Text height", so the two labels were the wrong way round.
  textSize: sliderRow({
    label: 'First line size', min: 10, max: 200, step: 1, value: params.textSize, unit: 'mm',
    help: 'Cap height of line 1. The plate sizes itself around it.',
    onInput: (v) => { params.textSize = v; triggerRebuild(); },
  }),
  line2Size: sliderRow({
    label: 'Second line size', min: 6, max: 80, step: 1, value: params.line2Size, unit: 'mm',
    help: 'Sized independently of the number — the thing every free generator makes you accept as a ratio.',
    onInput: (v) => { params.line2Size = v; triggerRebuild(); },
  }),
  orientation: segmentedControl<Orientation>({
    label: 'Layout',
    options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }],
    value: params.orientation,
    onChange: (v) => { params.orientation = v; syncVisibility(); triggerRebuild(); },
  }),
  // All four sides. Two of them — above, and to the left — simply could not be typed before,
  // so a street name over the number or a unit letter in front of it was not a sign this
  // generator could make.
  linePlacement: segmentedControl<LinePlacement>({
    label: 'Second line',
    options: [
      { value: 'above', label: 'Above' }, { value: 'below', label: 'Below' },
      { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
    ],
    value: params.linePlacement,
    help: 'Left and right put both on one row — "12 MEETING ROOM" — each at its own size.',
    onChange: (v) => { params.linePlacement = v; syncVisibility(); triggerRebuild(); },
  }),
  // Aligns both lines within the block, so whichever is shorter is the one that moves.
  // Still needs two lines of different width to have anything to do.
  align: segmentedControl<Align>({
    label: 'Align',
    options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
    value: params.align,
    onChange: (v) => { params.align = v; triggerRebuild(); },
  }),
  /*
   * The other axis, and the one that had no control at all.
   *
   * Stacked, "Align" is left/centre/right and there is nothing vertical to decide — the line
   * spacing places them. On one row it is the reverse: both lines are placed by their own
   * advance widths, so "Align" has nothing to move, and the live question is whether the small
   * line sits on the big one's baseline, against its cap height, or halfway up. Two controls
   * rather than one with four options, because only ever one of them can bite.
   */
  vAlign: segmentedControl<VAlign>({
    label: 'Align',
    options: [
      { value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' },
      { value: 'bottom', label: 'Bottom' },
    ],
    value: params.vAlign,
    help: 'Bottom sits the second line on the first one\'s baseline.',
    onChange: (v) => { params.vAlign = v; triggerRebuild(); },
  }),
  letterSpacing: sliderRow({
    label: 'Letter spacing', min: -0.1, max: 0.5, step: 0.01, value: params.letterSpacing,
    format: (v) => v.toFixed(2),
    onInput: (v) => { params.letterSpacing = v; triggerRebuild(); },
  }),
  lineSpacing: sliderRow({
    label: 'Line spacing', min: 0.3, max: 1.2, step: 0.01, value: params.lineSpacing,
    format: (v) => v.toFixed(2),
    help: 'Gap between the number and the second line.',
    onInput: (v) => { params.lineSpacing = v; triggerRebuild(); },
  }),
  // Stacked had no spacing control at all, and inherited the horizontal 0.55 — which in the
  // vertical formula stepped 28.6 mm for a 52.8 mm glyph, so the digits overlapped by 46%
  // of their height and fused into one blob.
  stackSpacing: sliderRow({
    label: 'Stack spacing', min: 0.8, max: 2, step: 0.01, value: params.stackSpacing,
    format: (v) => v.toFixed(2),
    help: 'Gap between stacked characters, as a multiple of their height.',
    onInput: (v) => { params.stackSpacing = v; triggerRebuild(); },
  }),

  /*
   * One choice instead of a toggle plus a style.
   *
   * "Text inside" used to be `lineStyle`, sitting under the line's own settings — where it
   * read as a property of the line rather than as a decision about how the second line is
   * presented. Nobody would look for it there, and it was reported as exactly that.
   */
  divider: segmentedControl<SignParams['divider']>({
    label: 'Divider',
    options: [
      { value: 'none', label: 'None' },
      { value: 'line', label: 'Line' },
      { value: 'band', label: 'Band' },
    ],
    value: params.divider,
    help: 'Band sets the second line inside a filled bar, reversed out of it.',
    onChange: (v) => { params.divider = v; syncVisibility(); triggerRebuild(); },
  }),
  lineThickness: sliderRow({
    label: 'Line thickness', min: 0.5, max: 20, step: 0.5, value: params.lineThickness, unit: 'mm',
    onInput: (v) => { params.lineThickness = v; triggerRebuild(); },
  }),
  lineLength: sliderRow({
    label: 'Line length', min: 0, max: 250, step: 1, value: params.lineLength, unit: 'mm',
    help: '0 sizes it from the text.',
    onInput: (v) => { params.lineLength = v; triggerRebuild(); },
  }),
  lineOverhang: sliderRow({
    label: 'Line overhang', min: 0, max: 80, step: 1, value: params.lineOverhang, unit: 'mm',
    help: 'How far it runs past the text at each end. Ignored when a length is set.',
    onInput: (v) => { params.lineOverhang = v; triggerRebuild(); },
  }),
  lineOffset: sliderRow({
    label: 'Line position', min: -60, max: 60, step: 0.5, value: params.lineOffset, unit: 'mm',
    help: 'Moves it off the centre of the gap, toward one line or the other.',
    onInput: (v) => { params.lineOffset = v; triggerRebuild(); },
  }),

  shape: selectRow<PlateShape>({
    label: 'Plate', value: params.shape,
    options: [
      // "Square" was the label on a shape that produces a rectangle.
      { value: 'rounded', label: 'Rounded' }, { value: 'rect', label: 'Rectangle' },
      { value: 'pill', label: 'Pill' }, { value: 'plaque', label: 'Plaque (cut corners)' },
      { value: 'none', label: 'No plate — loose numbers' },
    ],
    onChange: (v) => { params.shape = v; syncVisibility(); triggerRebuild(); },
  }),
  // Means nothing on a rectangle, a pill (radius is always half the short side) or with no
  // plate, and means "corner cut" on a plaque. Hidden or relabelled rather than left inert.
  cornerRadius: sliderRow({
    label: 'Corner radius', min: 0, max: 40, step: 0.5, value: params.cornerRadius, unit: 'mm',
    onInput: (v) => { params.cornerRadius = v; triggerRebuild(); },
  }),
  // The escape hatch from auto-sizing. A pill takes its cap radius from half the short side,
  // so its width follows its height and no margin could ever bring it in.
  plateWidth: sliderRow({
    label: 'Plate width', min: 0, max: 250, step: 1, value: params.plateWidth, unit: 'mm',
    help: '0 sizes it from the text.',
    onInput: (v) => { params.plateWidth = v; triggerRebuild(); },
  }),
  plateHeight: sliderRow({
    label: 'Plate height', min: 0, max: 250, step: 1, value: params.plateHeight, unit: 'mm',
    help: '0 sizes it from the text.',
    onInput: (v) => { params.plateHeight = v; triggerRebuild(); },
  }),
  padding: sliderRow({
    label: 'Margin', min: 0, max: 60, step: 1, value: params.padding, unit: 'mm',
    help: 'Space between the text and the plate edge. The plate sizes itself from this.',
    onInput: (v) => { params.padding = v; triggerRebuild(); },
  }),
  plateThickness: sliderRow({
    label: 'Plate thickness', min: 2, max: 12, step: 0.2, value: params.plateThickness, unit: 'mm',
    onInput: (v) => { params.plateThickness = v; triggerRebuild(); },
  }),
  /*
   * Its own decision, in its own section — it changes what the sign IS, not how deep
   * something is, and sitting next to "Text depth" made it read as a depth option.
   *
   * `Inlay` is the answer to "recessed makes it single colour, who would want that": the
   * same recess, filled flush with a second body in the second filament.
   */
  relief: segmentedControl<SignParams['relief']>({
    label: 'Relief',
    options: [
      { value: 'raised', label: 'Raised' },
      { value: 'inlay', label: 'Inlay' },
      { value: 'recessed', label: 'Engraved' },
    ],
    value: params.relief,
    help: 'Inlay sinks the text and fills it flush in the second colour. Engraved leaves it '
        + 'as a cut, in one colour.',
    onChange: (v) => { params.relief = v; syncVisibility(); triggerRebuild(); },
  }),
  // Engraving cuts clean through the face, so the middle of an 0 or an 8 is attached to
  // nothing. The ties were unconditional, which is right on a bare plate and wrong on a
  // panel — there the plate behind catches the island, and the ties are two scars across
  // the numeral paying for a problem that does not exist.
  bridgesOn: toggleSwitch({
    label: 'Stencil ties', checked: params.bridgesOn,
    help: 'Narrow bridges that stop the middle of an 0 or an 8 dropping out. Needed when the '
        + 'text is cut right through the plate; not when it is cut into a panel, because the '
        + 'plate behind holds it.',
    onChange: (v) => { params.bridgesOn = v; syncVisibility(); triggerRebuild(); },
  }),
  // `bridgeWidth` has existed since the ties did and has never had a control, so the one
  // number that decides whether a tie is a hairline that snaps or a bar across the numeral
  // was reachable only by hand-editing a saved project.
  bridgeWidth: sliderRow({
    label: 'Tie width', min: 0.4, max: 6, step: 0.1, value: params.bridgeWidth, unit: 'mm',
    format: (v) => v.toFixed(1),
    help: 'Two extrusion widths (about 0.8 mm) is the least that prints reliably.',
    onInput: (v) => { params.bridgeWidth = v; triggerRebuild(); },
  }),
  band: selectRow<SignParams['band']>({
    label: 'Edge band', value: params.band,
    options: [
      { value: 'none', label: 'None' }, { value: 'bottom', label: 'Along the bottom' },
      { value: 'top', label: 'Along the top' }, { value: 'left', label: 'Down the left' },
      { value: 'right', label: 'Down the right' },
    ],
    onChange: (v) => { params.band = v; syncVisibility(); triggerRebuild(); },
  }),
  bandWidth: sliderRow({
    label: 'Band width', min: 2, max: 80, step: 1, value: params.bandWidth, unit: 'mm',
    onInput: (v) => { params.bandWidth = v; triggerRebuild(); },
  }),
  panelOn: toggleSwitch({
    label: 'Inset panel', checked: params.panelOn,
    help: 'A smaller board raised on the plate, in its own colour. The text sits on it.',
    onChange: (v) => { params.panelOn = v; syncVisibility(); triggerRebuild(); },
  }),
  panelInset: sliderRow({
    label: 'Panel inset', min: 2, max: 60, step: 0.5, value: params.panelInset, unit: 'mm',
    onInput: (v) => { params.panelInset = v; triggerRebuild(); },
  }),
  panelHeight: sliderRow({
    label: 'Panel height', min: 0.4, max: 10, step: 0.2, value: params.panelHeight, unit: 'mm',
    onInput: (v) => { params.panelHeight = v; triggerRebuild(); },
  }),
  textThickness: sliderRow({
    label: 'Text depth', min: 0.6, max: 10, step: 0.2, value: params.textThickness, unit: 'mm',
    help: 'How far the text stands proud of the plate, or how deep it is cut into it.',
    onInput: (v) => { params.textThickness = v; triggerRebuild(); },
  }),
  frameOn: toggleSwitch({
    label: 'Frame', checked: params.frameOn,
    help: 'A raised border around the edge.',
    onChange: (v) => { params.frameOn = v; syncVisibility(); triggerRebuild(); },
  }),
  frameWidth: sliderRow({
    label: 'Frame width', min: 0.5, max: 8, step: 0.5, value: params.frameWidth, unit: 'mm',
    onInput: (v) => { params.frameWidth = v; triggerRebuild(); },
  }),
  // The frame used to be extruded to `textThickness` with no way to say otherwise, so
  // dragging the text depth moved the frame. It still follows by default — an existing
  // sign must not change shape — but the link can now be broken.
  frameFollowsText: toggleSwitch({
    label: 'Frame same height as text', checked: params.frameFollowsText,
    onChange: (v) => { params.frameFollowsText = v; syncVisibility(); triggerRebuild(); },
  }),
  frameHeight: sliderRow({
    label: 'Frame height', min: 0.4, max: 10, step: 0.2, value: params.frameHeight, unit: 'mm',
    onInput: (v) => { params.frameHeight = v; triggerRebuild(); },
  }),
  chamfer: sliderRow({
    label: 'Bevel', min: 0, max: 2, step: 0.1, value: params.chamfer, unit: 'mm',
    help: 'Softens the top edge. A little also helps the first layer hold.',
    onInput: (v) => { params.chamfer = v; triggerRebuild(); },
  }),

  mount: selectRow<MountKind>({
    label: 'Mounting', value: params.mount,
    // `none` is gone: it and `tape` built byte-identical models and read as two choices.
    // A sign with no fixings IS a flat back for tape.
    options: [
      { value: 'tape', label: 'Flat back for tape' },
      { value: 'screws', label: 'Screw holes' },
      { value: 'keyhole', label: 'Keyhole slots (hidden fixings)' },
    ],
    onChange: (v) => { params.mount = v; syncVisibility(); triggerRebuild(); },
  }),
  mountHoleDia: sliderRow({
    label: 'Screw diameter', min: 2, max: 8, step: 0.5, value: params.mountHoleDia, unit: 'mm',
    help: 'The screw shank, not the head. Keyhole heads are sized from this automatically.',
    onInput: (v) => { params.mountHoleDia = v; triggerRebuild(); },
  }),
  // The inset used to be derived from the margin, so on a pill — where the plate is much
  // wider than the text needs — the holes sat pinned at the far ends with nothing to move them.
  mountInset: sliderRow({
    label: 'Hole inset', min: 3, max: 60, step: 0.5, value: params.mountInset, unit: 'mm',
    help: 'How far each hole sits in from the edge of the plate.',
    onInput: (v) => { params.mountInset = v; triggerRebuild(); },
  }),
  // The pair was pinned to the horizontal centreline and the keyhole row to a fixed height,
  // so a tall sign could only ever be hung from its middle — and a slot cutting into the back
  // of the numeral could not be moved off it at all.
  mountOffsetY: sliderRow({
    label: 'Hole height', min: -120, max: 120, step: 0.5, value: params.mountOffsetY, unit: 'mm',
    help: 'Moves the fixings up or down. 0 is the middle for screws, and the usual hanging '
        + 'height for keyholes. Clamped to the plate.',
    onInput: (v) => { params.mountOffsetY = v; triggerRebuild(); },
  }),
  mountFourHoles: toggleSwitch({
    label: 'Four holes', checked: params.mountFourHoles,
    help: 'One near each corner, instead of two on the centreline. Worth it on a wide plate.',
    onChange: (v) => { params.mountFourHoles = v; triggerRebuild(); },
  }),
};

/**
 * Hides every control that cannot affect the model as things currently stand.
 *
 * One place, called from every control that changes what else matters, rather than each
 * handler remembering to toggle its own neighbours. The generator shipped with only
 * `mountHoleDia` doing this, so the rest sat there looking live while doing nothing:
 * corner radius on a pill, the second-line controls under Stacked (which discards line 2
 * outright), alignment with one line, line spacing with one line.
 */
function syncVisibility() {
  const show = (row: HTMLElement, on: boolean) => row.classList.toggle('hidden', !on);
  const stacked = params.orientation === 'vertical';
  const hasPlate = params.shape !== 'none';
  const twoLines = params.text2.trim() !== '' && !stacked;

  // Stacked lays out one column of characters — `getVerticalContours` has no second line.
  show(controls.text2, !stacked);
  show(controls.line2Size, twoLines);
  show(controls.linePlacement, twoLines);
  // Exactly one of the two alignment controls is live at a time — see `vAlign` above.
  const sideBySide = isSideBySide(params.linePlacement);
  show(controls.align, twoLines && !sideBySide);
  show(controls.vAlign, twoLines && sideBySide);
  show(controls.lineSpacing, twoLines);
  show(controls.stackSpacing, stacked);
  // A band is sized by the text it holds, so length, overhang and position do not apply.
  const band = params.divider === 'band' && twoLines;
  const anyDivider = params.divider !== 'none';
  show(controls.divider, twoLines || params.divider !== 'none');
  show(controls.lineThickness, anyDivider);
  show(controls.lineLength, anyDivider && !band);
  show(controls.lineOverhang, anyDivider && params.lineLength === 0);
  show(controls.lineOffset, anyDivider && !band);

  // Corner radius is the plate's own radius only for `rounded`; a pill derives its own and
  // a rectangle has none. On a plaque the same number is the size of the 45-degree cut.
  show(controls.cornerRadius, hasPlate && (params.shape === 'rounded' || params.shape === 'plaque'));
  show(controls.padding, hasPlate);
  show(controls.plateWidth, hasPlate);
  show(controls.plateHeight, hasPlate);
  show(controls.plateThickness, hasPlate);
  show(controls.frameOn, hasPlate);
  show(controls.frameWidth, hasPlate && params.frameOn);
  show(controls.frameFollowsText, hasPlate && params.frameOn);
  show(controls.frameHeight, hasPlate && params.frameOn && !params.frameFollowsText);
  show(controls.band, hasPlate);
  show(controls.bandWidth, hasPlate && params.band !== 'none');
  show(controls.panelOn, hasPlate);
  show(controls.panelInset, hasPlate && params.panelOn);
  show(controls.panelHeight, hasPlate && params.panelOn);

  // Relief needs a face to cut into.
  show(controls.relief, hasPlate);
  // Ties only exist inside an engraved cut; raised and inlaid text is held by the face it
  // stands on or fills.
  show(controls.bridgesOn, hasPlate && params.relief === 'recessed');
  show(controls.bridgeWidth, hasPlate && params.relief === 'recessed' && params.bridgesOn);

  // Every mounting option needs a plate to cut.
  show(controls.mount, hasPlate);
  show(controls.mountHoleDia, hasPlate && (params.mount === 'screws' || params.mount === 'keyhole'));
  // The inset drives the keyhole spread too now, so it is live for both mountings.
  show(controls.mountInset, hasPlate && (params.mount === 'screws' || params.mount === 'keyhole'));
  // Four holes go to the corners; there is no row to raise.
  show(controls.mountOffsetY, hasPlate
    && (params.mount === 'keyhole' || (params.mount === 'screws' && !params.mountFourHoles)));
  show(controls.mountFourHoles, hasPlate && params.mount === 'screws');

  // A swatch for a part that does not exist is a live control with nothing to do.
  show(colourRows[0]!.row, hasPlate);
  show(colourRows[1]!.row, params.relief !== 'recessed' || !hasPlate);
  show(colourRows[2]!.row, hasPlate && params.frameOn);
  show(colourRows[3]!.row, hasPlate && params.band !== 'none');
  show(colourRows[4]!.row, hasPlate && params.panelOn);
}

/** Pushes `params` back into every control, after a preset or a loaded project. */
function syncControls() {
  controls.text.setValue(params.text);
  controls.text2.setValue(params.text2);
  fonts.refresh(params.fontId);
  controls.scale.setValue(params.scale);
  controls.textSize.setValue(params.textSize);
  controls.line2Size.setValue(params.line2Size);
  controls.align.setValue(params.align);
  controls.vAlign.setValue(params.vAlign);
  controls.linePlacement.setValue(params.linePlacement);
  controls.orientation.setValue(params.orientation);
  controls.letterSpacing.setValue(params.letterSpacing);
  controls.lineSpacing.setValue(params.lineSpacing);
  controls.stackSpacing.setValue(params.stackSpacing);
  controls.divider.setValue(params.divider);
  controls.lineThickness.setValue(params.lineThickness);
  controls.lineLength.setValue(params.lineLength);
  controls.lineOverhang.setValue(params.lineOverhang);
  controls.lineOffset.setValue(params.lineOffset);
  controls.relief.setValue(params.relief);
  controls.bridgesOn.setValue(params.bridgesOn);
  controls.bridgeWidth.setValue(params.bridgeWidth);
  controls.band.setValue(params.band);
  controls.bandWidth.setValue(params.bandWidth);
  controls.panelOn.setValue(params.panelOn);
  controls.panelInset.setValue(params.panelInset);
  controls.panelHeight.setValue(params.panelHeight);
  controls.shape.setValue(params.shape);
  controls.cornerRadius.setValue(params.cornerRadius);
  controls.padding.setValue(params.padding);
  controls.plateWidth.setValue(params.plateWidth);
  controls.plateHeight.setValue(params.plateHeight);
  controls.plateThickness.setValue(params.plateThickness);
  controls.textThickness.setValue(params.textThickness);
  controls.frameOn.setValue(params.frameOn);
  controls.frameWidth.setValue(params.frameWidth);
  controls.frameFollowsText.setValue(params.frameFollowsText);
  controls.frameHeight.setValue(params.frameHeight);
  controls.chamfer.setValue(params.chamfer);
  controls.mount.setValue(params.mount);
  controls.mountHoleDia.setValue(params.mountHoleDia);
  controls.mountInset.setValue(params.mountInset);
  controls.mountOffsetY.setValue(params.mountOffsetY);
  controls.mountFourHoles.setValue(params.mountFourHoles);
  syncVisibility();
  syncColourInputs();
}

/* ── 4 · Fonts you bring yourself ───────────────────────────────────────────── */

const fontUpload = el('input', {
  attrs: { type: 'file', accept: '.ttf,.otf,.woff', hidden: 'hidden' },
}) as HTMLInputElement;

fontUpload.addEventListener('change', async () => {
  const file = fontUpload.files?.[0];
  if (!file) return;
  try {
    const parsed = parseFont(await file.arrayBuffer());
    customFontId = 'custom-upload';
    registerCustomFont(customFontId, parsed);
    params.fontId = customFontId;
    // The upload joins the grid at the top and stays selected. Its card renders in the
    // uploaded face like any other, because `registerCustomFont` has already added the
    // matching `@font-face` under the same `VL-` name the cards use.
    fonts.addCustom(customFontId, file.name.replace(/\.(ttf|otf|woff2?)$/i, ''));
    toast(`Using ${file.name}`, { kind: 'ok' });
    triggerRebuild();
  } catch (err) {
    toast(`That font would not load: ${(err as Error).message}`, { kind: 'error' });
  } finally {
    fontUpload.value = '';
  }
});

const fontUploadBtn = el('button', {
  className: 'vl-btn hn-wide',
  text: 'Use a font from your computer',
  attrs: { type: 'button' },
  on: { click: () => fontUpload.click() },
});

/* ── 5 · Examples ───────────────────────────────────────────────────────────── */

/**
 * The four presets, as a 2x2 of pictures of the plate they make.
 *
 * These were a row of text buttons halfway down the left panel, under a numbered heading,
 * which is a place nobody looks for a starting point. `sampleGrid` is the kit's own pattern
 * for "here is something to start from" and the right panel is where the template puts it —
 * which also fills a panel that was one Colours section and a lot of nothing.
 *
 * The thumbnails come from the real outline code, so they cannot drift. See `previews.ts`.
 */
const examplesGrid = el('div', { className: 'hn-examples' });

/**
 * Repaints the cards for the current font, text and theme.
 *
 * Needs the parsed face, which is async, so this is called after every successful build
 * rather than once at startup — that is also what keeps a card showing *your* number in
 * *your* font instead of a generic stand-in.
 */
async function paintExamples() {
  let font;
  try {
    font = await getFont(params.fontId);
  } catch {
    return; // The build path reports font failures; a blank card is not worth a second toast.
  }

  // The cards are baked SVG data URIs behind `<img src>`, so a CSS variable cannot reach
  // inside them the way it reaches the card they sit on. The theme has to be read here and
  // painted in — see the observer at the foot of this file for the repaint.
  const theme: PreviewTheme =
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

  const grid = sampleGrid({
    items: PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      src: platePreviewSvg(applyPreset(params, p.patch), font, theme),
    })),
    onPick: (item) => {
      const preset = PRESETS.find((p) => p.id === item.id);
      if (!preset) return;
      params = applyPreset(params, preset.patch);
      syncControls();
      triggerRebuild(true);
    },
  });

  /*
   * Keep the reader where they were.
   *
   * The grid scrolls now, and every build repaints it by throwing the old one away — so
   * picking *Inset panel* from the second row rebuilt the model, repainted the cards, and
   * snapped the list back to *House*, leaving the user looking at a template they did not
   * choose. The cards are pictures of the current text and font, so they have to be repainted;
   * where the list is scrolled to is the user's, not the repaint's.
   */
  const before = examplesGrid.querySelector('.vl-samples')?.scrollTop ?? 0;
  examplesGrid.replaceChildren(grid);
  const after = examplesGrid.querySelector('.vl-samples');
  if (after && before > 0) after.scrollTop = before;
}

/* ── 6 · Colours ────────────────────────────────────────────────────────────── */

/**
 * Filament swatches, not a colour wheel.
 *
 * These parts are printed, so the choice is a spool on a shelf rather than a point in a
 * 16.7-million-colour space. `filamentRow` lives in the kit — the same list was already
 * copied verbatim into three other generators — and keeps a custom-hex escape hatch so a
 * saved project or a shared link carrying an off-palette colour still opens showing it.
 *
 * Colour never changes the geometry, so these do NOT rebuild. Recolouring through the
 * worker meant a full manifold round-trip per frame of a drag; `viewer.setParts` with the
 * existing meshes is instant and is all a material change needs.
 */
function colourRow(label: string, get: () => string, set: (hex: string) => void) {
  const row = filamentRow({
    label, value: get(),
    onChange: (hex) => { set(hex); recolour(); },
  });
  return { row, get, set };
}

const colourRows = [
  colourRow('Plate', () => params.plateColor, (c) => (params.plateColor = c)),
  colourRow('Text', () => params.textColor, (c) => (params.textColor = c)),
  colourRow('Frame', () => params.frameColor, (c) => (params.frameColor = c)),
  colourRow('Edge band', () => params.bandColor, (c) => (params.bandColor = c)),
  colourRow('Panel', () => params.panelColor, (c) => (params.panelColor = c)),
];
function syncColourInputs() { for (const r of colourRows) r.row.setValue(r.get()); }

/** Repaints the existing meshes in place — no rebuild, because colour is not geometry. */
function recolour() {
  const of = (name: string) =>
    name === 'plate' ? params.plateColor
      : name === 'frame' ? params.frameColor
        : name === 'band' ? params.bandColor
          : name === 'panel' ? params.panelColor
            : params.textColor;
  parts = parts.map((p) => ({ ...p, color: hexToRgb(of(p.name)) }));
  viewer.setParts(parts, false);
  warnLowContrast();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * A plate and text in near-identical filament is a legal model and a useless sign.
 *
 * Warned rather than blocked — someone may genuinely want a monochrome sign — but silence
 * was wrong: the export honestly reports two parts while the print comes out as one flat
 * slab, and the status line said nothing.
 */
let contrastWarned = '';
function warnLowContrast() {
  const key = `${params.plateColor}/${params.textColor}`;
  if (key === contrastWarned) return;
  if (contrastRatio(params.plateColor, params.textColor) < 1.6) {
    contrastWarned = key;
    toast('Plate and text are nearly the same colour — the sign will print as one slab', { kind: 'warn' });
  } else if (contrastRatio(params.plateColor, params.textColor) > 2.2) {
    contrastWarned = '';
  }
}

/* ── 7 · Chrome ─────────────────────────────────────────────────────────────── */

const quality = qualityCallout({
  html: 'Outdoors, print in <strong>ASA</strong>. PETG goes brittle in UV without a blocker, '
      + 'and dark colours fade and soften fastest in direct sun.',
  storageKey: 'house-number-quality',
});

let downloads = 0;

const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async (format) => {
    if (parts.length === 0) return toast('Nothing to export yet', { kind: 'warn' });
    if (format !== '3mf') throw new Error('Unknown format: ' + format);
    const name = (params.text.trim() || 'sign').replace(/[^\w-]+/g, '_');
    downloadThreeMF(parts, {
      title: `House number ${params.text}`,
      generator: 'house-number',
      application: 'Vostok Labs House Number Generator',
      buildId: import.meta.env.VITE_BUILD_ID,
    }, `${name}.3mf`);

    downloads += 1;
    if (downloads === 1) openLicenseModal();
    else licenseReminderToast();
  },
  onSave: () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    const a = el('a', { attrs: { href: URL.createObjectURL(blob), download: 'house-number.json' } }) as HTMLAnchorElement;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  onLoad: (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        params = coerceSettings(JSON.parse(String(reader.result)));
        syncControls();
        triggerRebuild(true);
        toast('Project loaded', { kind: 'ok' });
      } catch {
        toast('That file is not a saved sign', { kind: 'error' });
      }
    };
    reader.readAsText(file);
  },
  onHelp: () => dialog({
    title: 'House & office numbers',
    content:
      'Type the number, pick a plate, and it sizes itself around your text.\n\n'
      + 'Mounting: keyhole slots are pockets in the back, so the sign drops onto screws '
      + 'already in the wall and no fixings show. Screw holes go straight through. '
      + '"Flat back" leaves it clean for adhesive tape.\n\n'
      + 'A wide flat plate can lift at a corner mid-print. Clean the build plate, and keep '
      + 'a little edge softening on — it helps the first layer hold.',
    actions: [{ label: 'Got it', primary: true }],
  }),
  themeStorageKey: 'house-number-theme',
});

/* ── 8 · Assemble ───────────────────────────────────────────────────────────── */

/**
 * The right panel's results block.
 *
 * The stage's status line is one sentence that has to fit under a 3D view; this is where the
 * numbers a buyer actually needs can be laid out. It is also the home the spec's flat-back
 * area was written for — §4's mounting table promises that "tape" states the area in cm² so
 * a buyer can size the tape, which is the entire difference between "Nothing" and "Flat back
 * for tape". Without it the two options built byte-identical models and said nothing
 * different, which is exactly how they were reported.
 */
const report = el('div', { className: 'hn-report' });

function renderReport(size: { width: number; height: number } | null, partCount: number) {
  report.replaceChildren();
  if (!size) {
    report.append(el('p', { className: 'vl-hint', text: 'Type a number to see it.' }));
    return;
  }

  const depth = (params.shape === 'none' ? 0 : params.plateThickness)
    + Math.max(
        params.textThickness,
        params.frameOn && params.shape !== 'none'
          ? (params.frameFollowsText ? params.textThickness : params.frameHeight)
          : 0,
      );

  const rows: Array<[string, string]> = [
    ['Plate', params.shape === 'none' ? '— loose numbers —' : `${size.width.toFixed(0)} × ${size.height.toFixed(0)} mm`],
    ['Total depth', `${depth.toFixed(1)} mm`],
    ['Parts', `${partCount}`],
  ];

  if (params.mount === 'tape' && params.shape !== 'none') {
    // The back is the plate's own footprint — the frame stands on the front, and screw
    // holes are not cut in this mode — so the area is the outline's, in cm².
    const area = (size.width * size.height) / 100;
    rows.push(['Flat back', `about ${area.toFixed(0)} cm² for tape`]);
  }

  for (const [k, v] of rows) {
    report.append(el('div', { className: 'hn-report__row' }, [
      el('span', { text: k }),
      el('strong', { text: v }),
    ]));
  }
}

const status = stageStatus('Starting the geometry engine…');
const stageCanvas = el('div', { className: 'hn-stage-canvas' });
const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Hold left click to rotate, right click to pan, scroll to zoom.',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'House & Office Numbers',
        description: 'Type a number, pick a plate, print a sign that fits your door.',
      }),
      ...(quality ? [quality] : []),
      // `section`, not `collapsibleSection`: base.css calls the flat hairline-separated
      // section with a small uppercase `.vl-label` "the real sidebar pattern", and it is
      // what magnet, name-keychain and the clicker all render. The 18px bold summaries with
      // chevrons were this generator on its own.
      /*
       * Six sections, ordered the way a sign is actually made, none longer than six rows.
       *
       * The three it replaces — "What it says" / "The plate" / "Mounting" — were the ones
       * this generator shipped with when it had eleven controls. Every feature since was
       * appended to whichever looked closest, so at twenty-two controls "Text inside" sat
       * under the line's settings and "Recessed" next to "Text depth", both filed where
       * nobody would look. Grouping by the decision being made, not by what was nearby.
       *
       * The first three stay open — that is the common path. The last three collapse: they
       * are the ones you go looking for, and below the fold they cost a scroll either way.
       */
      section({
        title: '1 · Text',
        body: [controls.text, controls.text2, controls.scale, controls.textSize,
               controls.line2Size, controls.letterSpacing],
      }),
      section({
        title: '2 · Layout',
        body: [controls.orientation, controls.linePlacement, controls.align, controls.vAlign,
               controls.lineSpacing, controls.stackSpacing,
               controls.divider, controls.lineThickness, controls.lineLength,
               controls.lineOverhang, controls.lineOffset],
      }),
      section({
        title: '3 · Plate shape and size',
        body: [controls.shape, controls.cornerRadius, controls.plateWidth, controls.plateHeight, controls.padding,
               controls.plateThickness, controls.chamfer,
               controls.frameOn, controls.frameWidth, controls.frameFollowsText,
               controls.frameHeight,
               controls.band, controls.bandWidth,
               controls.panelOn, controls.panelInset, controls.panelHeight],
      }),
      collapsibleSection({
        title: '4 · Relief',
        open: false,
        body: [controls.relief, controls.textThickness, controls.bridgesOn, controls.bridgeWidth],
      }),
      collapsibleSection({
        title: '5 · Mounting',
        open: false,
        body: [controls.mount, controls.mountHoleDia, controls.mountInset, controls.mountOffsetY,
               controls.mountFourHoles],
      }),
      // Colour sits with the parameters, not with the inputs. It is something the user is
      // *making* — and it is where magnet and name-keychain both put it.
      collapsibleSection({ title: '6 · Colours', open: false, body: colourRows.map((r) => r.row) }),
      section({ title: 'Your sign', body: [report] }),
    ],
  },
  stage: [
    stageCanvas,
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    status.root,
    hint,
  ],
  // Right is what the user brings in and what comes out: a design to start from, the face
  // it is set in, and the export footer. Nothing else — the parameters all live on the left,
  // which is the split the template's layout map describes.
  right: {
    scroll: [
      section({ title: 'Start from an example', body: [examplesGrid] }),
      section({ title: 'Font', body: [fonts.root, fontUploadBtn, fontUpload] }),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// First pass, before anything is drawn: hide the controls that cannot bite yet — the
// second-line group with no second line, the frame's width and height with no frame.
syncVisibility();
renderReport(null, 0);

const viewer = createViewer(stageCanvas, {});
mountPlatePicker(stageCanvas, viewer);

/*
 * The example cards follow the theme toggle.
 *
 * They are data-URI SVGs, so the `--panel-2` they sit on flips underneath them while the ink
 * baked into the picture does not — which is how *Street, no plate* ended up as dark glyphs
 * on a dark card with no plate behind them to be seen against. The viewer keeps its own
 * observer for the same reason (`observeTheme` in @vostok/viewer); this is the cards' one.
 */
new MutationObserver(() => void paintExamples())
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
