// The settings, in Laser Studio's layout (Ian, 2026-10-02), with the templates under the box.
//
//   right   the box itself: which one (pictures), and under the chosen one its READY-MADE
//           boxes (the templates, the kit's sample tiles), its drawers and finger notch; then
//           how big, Outside | Inside straight under the heading.
//   left    Laser Studio's rail, one category open at a time, each holding one kind of thing:
//           Pattern and Inside are the box's (a template sets them), Material and Joints are
//           the customer's (a template never touches them).
//             Pattern   which sides, which pattern, how, in what shape — every knob on show;
//             Material  what it is cut from: material, thickness, sheet;
//             Joints    how it fits together: flex tabs or fingers, Fit, the tab width and
//                       the kerf, each of those two behind an Auto switch;
//             Inside    the compartments, and where the floor sits.
//
// No "More options" fold is left. Every control is a kit component, and each keeps a handle so
// Load, a template and Reset can push values back in (`sync`). Every range comes from the
// settings' own `LIMITS`, the same ones a loaded project is held to.
import {
  chip,
  dialog,
  el,
  helpTip,
  ICONS,
  nudgePad,
  sampleGrid,
  section,
  segmentedControl,
  selectField,
  settingsRail,
  sliderRow,
  stepperRow,
  syncControls,
  thumbGrid,
  thumbTile,
  toggleSwitch,
  type ChipHandle,
  type NudgePadHandle,
  type SampleGridHandle,
  type SliderRowHandle,
  type ThumbTileHandle,
} from '@vostok/ui-kit';
import { patternRow, type PatternRowHandle } from '@vostok/patterns/ui';
import type { Decoration, PatternOp, WindowShape } from '../engine/decor';
import type { Bottom, BoxStyle } from '../engine/spec';
import type { FaceId } from '../engine/types';
import {
  BOX_MATERIALS,
  DEFAULT_DECORATION,
  DEFAULT_SETTINGS,
  FIT_STOPS,
  LIMITS,
  SHEETS,
  STYLES,
  autoKerf,
  boxMaterial,
  defaultBottom,
  fitLabel,
  sheetById,
  type BoxSettings,
  type Joint,
} from '../state';
import { units } from '../units';
import { fingerTarget } from '../engine/fingers';
import { TEMPLATES, fromTemplate } from '../templates';
import { BOTTOM_PICTURES, JOINT_PICTURES, windowPath } from './icons';
import openPicture from '../assets/styles/open.webp';
import lidPicture from '../assets/styles/lid.webp';
import hingePicture from '../assets/styles/hinge.webp';
import drawerPicture from '../assets/styles/drawer.webp';

export type Category = 'Pattern' | 'Material' | 'Joints' | 'Inside';

const STYLE_PICTURES: Record<BoxStyle, string> = { open: openPicture, lid: lidPicture, hinge: hingePicture, drawer: drawerPicture };
/** Each template's picture, rendered by the app's own 3D view (tests/templates.mjs). */
const TEMPLATE_PICTURES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/templates/*.webp', { eager: true, import: 'default' })).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]),
);
/** The heading over a box type's ready-made boxes. */
const READY_MADE: Record<BoxStyle, string> = { open: 'Ready-made open boxes', lid: 'Ready-made lift-off boxes', hinge: 'Ready-made hinged boxes', drawer: 'Ready-made drawers' };

/** What a template replaces — the box, not the customer's stock — as one comparable string: a
 *  box that still matches the one it was opened on (or the last template) takes a new template
 *  at one click; one that has been changed asks first. */
const boxOf = (s: BoxSettings): string =>
  JSON.stringify([s.style, s.length, s.width, s.height, s.measure, s.dividersX, s.dividersY, s.drawers, s.bottom, s.fingerHole, s.decorations]);
/** The names under the pictures: four tiles share a row, and the picture says the rest. */
const STYLE_SHORT: Record<BoxStyle, string> = { open: 'Open', lid: 'Lift-off', hinge: 'Hinged', drawer: 'Drawer' };

export interface PanelEvents {
  /** Something changed that needs a rebuild. */
  change(): void;
  /** Clicking sides on the 3D box began or ended. */
  picking(on: boolean): void;
}

export interface Panel {
  /** The rail and its categories, for the left panel. */
  left: HTMLElement;
  /** The box and its size: the right panel's two sections. */
  right: HTMLElement[];
  /** Push the settings into every control (after Load or Reset). */
  sync(): void;
  open(c: Category): void;
  /** A side was clicked in 3D while picking. */
  toggleFace(face: FaceId): void;
  /** The built box's sizes, for the line under the sliders: the other measure than the one set. */
  showSizes(outside: Dims, inside: Dims): void;
  dispose(): void;
}

interface Dims {
  x: number;
  y: number;
  z: number;
}

const WINDOWS: { id: WindowShape; label: string }[] = [
  { id: 'face', label: 'Whole side' },
  { id: 'circle', label: 'Circle' },
  { id: 'oval', label: 'Oval' },
  { id: 'heart', label: 'Heart' },
  { id: 'star', label: 'Star' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'arch', label: 'Arch' },
  { id: 'cloud', label: 'Cloud' },
];

/** The sides as the box unfolds: the lid over the front, the walls in a row, the bottom under.
 *  A drawer's case has a top, not a lid — the same side under its own name. */
const SIDES: { key: string; face: FaceId; label: string }[] = [
  { key: 'lid', face: 'lid', label: 'Lid' },
  { key: 'top', face: 'lid', label: 'Top' },
  { key: 'left', face: 'left', label: 'Left' },
  { key: 'front', face: 'front', label: 'Front' },
  { key: 'right', face: 'right', label: 'Right' },
  { key: 'back', face: 'back', label: 'Back' },
  { key: 'bottom', face: 'bottom', label: 'Bottom' },
];

/** The pattern being edited: the first decoration, made when the customer first asks. */
const deco = (s: BoxSettings): Decoration | null => s.decorations[0] ?? null;

/** Does this style have a top a pattern can go on? A drawer's case has one, an open box none. */
const hasTop = (style: BoxStyle) => style !== 'open';

export function createPanel(s: BoxSettings, ev: PanelEvents): Panel {
  const changed = () => ev.change();
  const lengths: SliderRowHandle[] = [];
  const length = (label: string, key: 'length' | 'width' | 'height'): SliderRowHandle => {
    const row = sliderRow({
      label, min: LIMITS[key][0], max: LIMITS[key][1], step: 1, value: s[key], format: units.format, parse: units.parse,
      defaultValue: DEFAULT_SETTINGS[key],
      onInput: (v) => { s[key] = v; changed(); },
    });
    lengths.push(row);
    return row;
  };

  // ======================================================================= the right: the box --
  // One row of four, so the size sits under it on the first screen.
  const style = segmentedControl<BoxStyle>({
    variant: 'tiles',
    columns: 4,
    options: STYLES.map((x) => ({ value: x.id, label: STYLE_SHORT[x.id], image: STYLE_PICTURES[x.id] })),
    value: s.style,
    onChange: (v) => {
      // A bottom still at the old type's default takes the new type's: Inset on a hinged or
      // open box, Flush on a lift-off box or a chest. One the customer chose stays.
      if (s.bottom === defaultBottom(s.style)) { s.bottom = defaultBottom(v); bottom.setValue(s.bottom); }
      s.style = v;
      onStyle();
      changed();
    },
  });
  // Under the types, the chosen type's ready-made boxes: one grid per type, only the chosen
  // type's showing, and none where a type has no template (hidden, never an empty heading).
  let picked: string | null = null;
  const readyMade = new Map<BoxStyle, SampleGridHandle>();
  for (const x of STYLES) {
    const items = TEMPLATES.filter((t) => t.settings.style === x.id).map((t) => ({ id: t.id, label: t.name, src: TEMPLATE_PICTURES[t.id] ?? STYLE_PICTURES[x.id] }));
    if (items.length) readyMade.set(x.id, sampleGrid({ heading: READY_MADE[x.id], items, onPick: (item) => useTemplate(item.id!) }));
  }
  const ready = el('div', { className: 'vl-control' }, [...readyMade.values()]);
  let baseline = boxOf(s);
  /** Start from a template: at once on a box still as it was opened, after asking on one the
   *  customer has changed. Their material, fit, joints and sheet stay (`fromTemplate`). */
  function useTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    const go = () => {
      Object.assign(s, fromTemplate(t, s));
      sync();
      picked = t.id;
      paintPicked();
      changed();
    };
    if (boxOf(s) === baseline) return go();
    dialog({
      title: `Start from ${t.name}?`,
      content: 'Its size, drawers and pattern replace your box’s. Your material, fit and sheet stay.',
      actions: [{ label: 'Cancel' }, { label: `Use ${t.name}`, primary: true, onClick: () => { go(); } }],
    });
  }
  const paintPicked = () => { for (const g of readyMade.values()) g.setSelected(picked); };
  const drawers = stepperRow({
    label: 'Drawers', min: LIMITS.drawers[0], max: LIMITS.drawers[1], value: s.drawers,
    help: 'Drawers stacked in the case.',
    onInput: (v) => { s.drawers = v; changed(); },
  });
  const fingerHole = toggleSwitch({
    label: 'Finger notch',
    checked: s.fingerHole,
    help: 'A notch in the top edge to get your fingers in.',
    onChange: (on) => { s.fingerHole = on; changed(); },
  });
  // Straight under the Size heading: "Outside | Inside" says what the three numbers measure.
  const measure = segmentedControl<'outside' | 'inside'>({
    options: [{ value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }],
    value: s.measure,
    onChange: (v) => { s.measure = v; paintSizes(); changed(); },
  });
  const lengthRow = length('Length', 'length');
  const widthRow = length('Width', 'width');
  const heightRow = length('Height', 'height');
  // The other measure, as built: what fits inside when the outside is set, and the other way.
  const otherSize = el('p', { className: 'vl-hint' });
  let sizes: { outside: Dims; inside: Dims } | null = null;
  const paintSizes = () => {
    if (!sizes) return;
    const d = s.measure === 'outside' ? sizes.inside : sizes.outside;
    const text = `${units.format(d.x).replace(/ (mm|in)$/, '')} × ${units.format(d.y).replace(/ (mm|in)$/, '')} × ${units.format(d.z)}`;
    // A chest's inside is a drawer's.
    const inside = s.style !== 'drawer' ? 'Inside' : s.drawers > 1 ? 'Inside each drawer' : 'Inside the drawer';
    otherSize.textContent = `${s.measure === 'outside' ? inside : 'Outside'}: ${text}`;
  };

  // ====================================================================== Material --
  const material = selectField({
    label: 'Material',
    options: BOX_MATERIALS.map((m) => ({ value: m.id, label: m.name })),
    value: s.material,
    onChange: (v) => {
      const was = boxMaterial(s.material);
      s.material = v;
      s.thickness = boxMaterial(v).thicknessMm;
      thickness.setValue(s.thickness);
      if (s.kerfAuto) { s.kerf = autoKerf(s); kerf.setValue(s.kerf); }
      // Acrylic takes plain fingers; back on wood, flex tabs again.
      if (!boxMaterial(v).flex) s.joint = 'fingers';
      else if (!was.flex) s.joint = 'flex';
      joint.setValue(s.joint);
      applyVisibility();
      changed();
    },
  });
  const thickness = sliderRow({
    label: 'Thickness', min: LIMITS.thickness[0], max: LIMITS.thickness[1], step: 0.05, value: s.thickness, unit: 'mm',
    help: 'Measure your sheet: “3 mm” ply is often 2.8–3.2.',
    onInput: (v) => { s.thickness = v; changed(); },
  });
  const sheet = selectField({
    label: 'Sheet',
    options: SHEETS.map((x) => ({ value: x.id, label: x.name })),
    value: s.sheet,
    help: 'The pieces are laid out on sheets this size.',
    onChange: (v) => { s.sheet = v; const x = sheetById(v); if (v !== 'custom') { s.sheetW = x.widthMm; s.sheetH = x.heightMm; } applyVisibility(); changed(); },
  });
  const sheetW = sliderRow({
    label: 'Sheet width', min: LIMITS.sheet[0], max: LIMITS.sheet[1], step: 1, value: s.sheetW, format: units.format, parse: units.parse,
    onInput: (v) => { s.sheetW = v; changed(); },
  });
  const sheetH = sliderRow({
    label: 'Sheet height', min: LIMITS.sheet[0], max: LIMITS.sheet[1], step: 1, value: s.sheetH, format: units.format, parse: units.parse,
    onInput: (v) => { s.sheetH = v; changed(); },
  });
  const fit = sliderRow({
    label: 'Fit', min: LIMITS.fit[0], max: LIMITS.fit[1], step: 1, value: s.fit, format: fitLabel,
    help: 'Loose pieces? Go tighter. Won’t go together? Go looser.',
    parse: (typed, raw) => {
      const i = FIT_STOPS.findIndex((f) => f.label.toLowerCase() === raw.trim().toLowerCase());
      return i >= 0 ? i - 2 : typed;
    },
    defaultValue: 0,
    onInput: (v) => { s.fit = v; changed(); },
  });
  // The kerf: the material's own, or switched off to type the one you measured — like the tab
  // width.
  const autoKerfSwitch = toggleSwitch({
    label: 'Auto kerf',
    checked: s.kerfAuto,
    help: 'Set by the material. Switch off to enter your own.',
    onChange: (on) => {
      s.kerfAuto = on;
      if (on) { s.kerf = autoKerf(s); kerf.setValue(s.kerf); }
      applyVisibility();
      changed();
    },
  });
  const kerf = sliderRow({
    label: 'Kerf', min: LIMITS.kerf[0], max: LIMITS.kerf[1], step: 0.01, value: s.kerf, unit: 'mm',
    help: 'What the beam burns away, 0.15–0.25 mm.',
    onInput: (v) => { s.kerf = v; changed(); },
  });

  // ======================================================================== Joints --
  const joint = segmentedControl<Joint>({
    label: 'Joints',
    variant: 'tiles',
    options: [
      { value: 'flex', label: 'Flex tabs', image: JOINT_PICTURES.flex },
      { value: 'fingers', label: 'Fingers', image: JOINT_PICTURES.fingers },
    ],
    value: s.joint,
    help: 'Flex tabs press into their slots without glue. Fingers are for glue.',
    onChange: (v) => { s.joint = v; changed(); },
  });
  const bottom = segmentedControl<Bottom>({
    label: 'Bottom',
    variant: 'tiles',
    columns: 3,
    options: [
      { value: 'flush', label: 'Flush', image: BOTTOM_PICTURES.flush },
      { value: 'slots', label: 'Inset', image: BOTTOM_PICTURES.slots },
      { value: 'feet', label: 'Feet', image: BOTTOM_PICTURES.feet },
    ],
    value: s.bottom,
    help: 'Inset raises the floor a sheet. Feet lift it clear.',
    onChange: (v) => { s.bottom = v; changed(); },
  });
  // The tab width: automatic (sized for the sheet), or switched off to set your own (Ian,
  // 2026-10-03: "a toggle that is auto by default, instead of dropdown"). Switched off, it starts
  // from the width Auto gives the corners' fingers, and switching back on remembers it.
  const autoWidth = () => Math.round(fingerTarget(s.thickness));
  let ownWidth = s.finger;
  const autoTab = toggleSwitch({
    label: 'Auto tab width',
    checked: s.finger === 0,
    help: 'Sized for your sheet. Switch off to set your own.',
    onChange: (on) => {
      if (on) { ownWidth = s.finger; s.finger = 0; }
      else { s.finger = ownWidth || autoWidth(); finger.setValue(s.finger); }
      applyVisibility();
      changed();
    },
  });
  const finger = sliderRow({
    label: 'Tab width', min: LIMITS.finger[0], max: LIMITS.finger[1], step: 1, value: s.finger || autoWidth(), format: units.format, parse: units.parse,
    onInput: (v) => { s.finger = v; changed(); },
  });

  // ======================================================================== Inside --
  // Counted as compartments, the way people think of a tray; the engine counts the walls.
  const across = stepperRow({
    label: 'Across', min: LIMITS.dividers[0] + 1, max: LIMITS.dividers[1] + 1, value: s.dividersX + 1,
    help: 'Compartments from left to right.',
    onInput: (v) => { s.dividersX = v - 1; changed(); },
  });
  const deep = stepperRow({
    label: 'Front to back', min: LIMITS.dividers[0] + 1, max: LIMITS.dividers[1] + 1, value: s.dividersY + 1,
    help: 'Compartments from front to back.',
    onInput: (v) => { s.dividersY = v - 1; changed(); },
  });

  // ======================================================================= Pattern --
  const ensureDeco = (): Decoration => {
    if (!s.decorations[0]) {
      s.decorations[0] = { ...DEFAULT_DECORATION, on: 'pick', faces: hasTop(s.style) ? ['lid'] : ['front'] };
    }
    return s.decorations[0];
  };
  const patternOn = toggleSwitch({
    label: 'Pattern on the box',
    checked: !!deco(s),
    onChange: (on) => {
      if (on) ensureDeco();
      else s.decorations = [];
      applyVisibility();
      emitPicking();
      changed();
    },
  });
  // One chip per side, laid out as the box unfolds (style.css places them).
  const sideChips = new Map<string, ChipHandle>();
  const sideMap = el('div', { className: 'lb-sides' });
  for (const side of SIDES) {
    const c = chip({
      label: side.label,
      pressed: deco(s)?.faces.includes(side.face) ?? false,
      centered: true,
      onToggle: () => toggleFace(side.face),
    });
    c.dataset.side = side.key;
    sideChips.set(side.key, c);
    sideMap.append(c);
  }
  const sidesLabel = el('span', { className: 'vl-control-label', text: 'Sides' });
  sidesLabel.append(helpTip('Click the sides you want, here or on the box.'));
  // Said when none of the chosen sides is on this box — an open box has no lid. The choice is
  // kept: back on a lidded box the pattern is on the lid again.
  const noSide = el('p', { className: 'vl-hint' });
  const sides = el('div', { className: 'vl-control' }, [sidesLabel, sideMap, noSide]);
  const pattern: PatternRowHandle = patternRow({
    value: deco(s)?.pattern ?? DEFAULT_DECORATION.pattern,
    onPick: (id) => { ensureDeco().pattern = id; changed(); },
    // A surprise's Zoom % and angle, held to what the sliders can show (their range and step), in
    // the settings too.
    onSurprise: (v) => {
      const d = ensureDeco();
      if (typeof v.patternScale === 'number') d.zoom = v.patternScale;
      if (typeof v.patternAngle === 'number') d.angle = v.patternAngle;
      syncControls(d, { zoom, angle });
      changed();
    },
  });
  const op = segmentedControl<PatternOp>({
    label: 'Make it',
    options: [{ value: 'cut', label: 'Cut out' }, { value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
    value: deco(s)?.op ?? DEFAULT_DECORATION.op,
    help: 'Score is a light line; Cut out opens the pattern up.',
    onChange: (v) => { ensureDeco().op = v; applyVisibility(); changed(); },
  });
  const windowTiles = new Map<WindowShape, ThumbTileHandle>();
  const shapes = thumbGrid({
    heading: 'Shape',
    minPx: 40,
    tiles: WINDOWS.map((w) => {
      const tile = thumbTile({
        svgPath: windowPath(w.id),
        label: w.label,
        selected: (deco(s)?.window ?? 'face') === w.id,
        onClick: () => {
          ensureDeco().window = w.id;
          for (const [id, t] of windowTiles) t.setSelected(id === w.id);
          applyVisibility();
          changed();
        },
      });
      windowTiles.set(w.id, tile);
      return tile;
    }),
  });
  const windowSize = sliderRow({
    label: 'Size', min: LIMITS.windowSize[0], max: LIMITS.windowSize[1], step: 1, value: deco(s)?.windowSize ?? 80, unit: '%', defaultValue: 80,
    onInput: (v) => { ensureDeco().windowSize = v; changed(); },
  });
  const windowPos: NudgePadHandle = nudgePad({
    step: 1,
    unit: 'mm',
    x: { label: 'X', value: deco(s)?.windowX ?? 0, max: LIMITS.windowShift[1], step: 1 },
    y: { label: 'Y', value: deco(s)?.windowY ?? 0, max: LIMITS.windowShift[1], step: 1 },
    onChange: (x, y) => { const d = ensureDeco(); d.windowX = x; d.windowY = y; changed(); },
  });
  const frame = toggleSwitch({
    label: 'Outline',
    checked: deco(s)?.frame ?? DEFAULT_DECORATION.frame,
    help: 'Scores a line round the shape.',
    onChange: (on) => { ensureDeco().frame = on; changed(); },
  });
  const zoom = sliderRow({
    label: 'Zoom', min: LIMITS.zoom[0], max: LIMITS.zoom[1], step: 5, value: deco(s)?.zoom ?? 100, unit: '%', defaultValue: 100,
    onInput: (v) => { ensureDeco().zoom = v; changed(); },
  });
  const angle = sliderRow({
    label: 'Angle', min: LIMITS.angle[0], max: LIMITS.angle[1], step: 5, value: deco(s)?.angle ?? 0, unit: '°', defaultValue: 0,
    onInput: (v) => { ensureDeco().angle = v; changed(); },
  });
  const web = sliderRow({
    label: 'Web', min: LIMITS.web[0], max: LIMITS.web[1], step: 0.1, value: deco(s)?.web ?? DEFAULT_DECORATION.web, unit: 'mm', defaultValue: DEFAULT_DECORATION.web,
    help: 'The least wood left between two cut-outs.',
    onInput: (v) => { ensureDeco().web = v; changed(); },
  });
  const margin = sliderRow({
    label: 'Edge margin', min: LIMITS.margin[0], max: LIMITS.margin[1], step: 0.5, value: deco(s)?.margin ?? 4, unit: 'mm', defaultValue: 4,
    help: 'Clear wood kept round the pattern.',
    onInput: (v) => { ensureDeco().margin = v; changed(); },
  });

  // ===================================================================== the rail --
  // The kit's settings rail, filling the left panel: the open category scrolls, the rail stays.
  let openCategory: Category = 'Pattern';
  const rail = settingsRail({
    label: 'Box settings',
    flush: true,
    value: openCategory,
    items: [
      { id: 'Pattern', label: 'Pattern', icon: ICONS.pattern, body: [patternOn, sides, pattern.root, zoom, angle, op, web, margin, shapes, windowSize, windowPos, frame] },
      { id: 'Material', label: 'Material', icon: ICONS.ruler, body: [material, thickness, sheet, sheetW, sheetH] },
      { id: 'Joints', label: 'Joints', icon: ICONS.joint, body: [joint, fit, autoTab, finger, autoKerfSwitch, kerf] },
      { id: 'Inside', label: 'Inside', icon: ICONS.grid, body: [across, deep, bottom] },
    ],
    onChange: (c) => {
      openCategory = c as Category;
      emitPicking();
    },
  });

  // ================================================================== the rules --
  /** A side chosen on, or clicked off — from its chip or on the 3D box. */
  function toggleFace(face: FaceId) {
    const d = ensureDeco();
    d.on = 'pick';
    d.faces = d.faces.includes(face) ? d.faces.filter((x) => x !== face) : [...d.faces, face];
    paintSides();
    emitPicking();
    changed();
  }

  /** A new style. The sides chosen are kept as they are: a pattern on the lid is not drawn on a
   *  box without one, and is on the lid again when the box has one (Ian, 2026-10-03 — moving it
   *  to the front, and leaving it there, was a bug). */
  function onStyle() {
    applyVisibility();
    emitPicking();
  }

  function paintSides() {
    const d = deco(s);
    for (const side of SIDES) sideChips.get(side.key)!.setPressed(!!d && d.faces.includes(side.face));
  }

  /** Hide what does not apply — never grey it (Ian's rule). */
  function applyVisibility() {
    const d = deco(s);
    // A hinged lid always has its pull tab: it is the latch and the lid's front stop.
    fingerHole.hidden = s.style === 'hinge';
    // Acrylic and greyboard take plain fingers only: no choice to offer.
    joint.hidden = !boxMaterial(s.material).flex;
    drawers.hidden = s.style !== 'drawer';
    for (const [type, grid] of readyMade) grid.hidden = type !== s.style;
    ready.hidden = !readyMade.has(s.style);
    kerf.hidden = s.kerfAuto;
    const custom = s.sheet === 'custom';
    sheetW.hidden = !custom;
    sheetH.hidden = !custom;
    // The lid's chip on a lidded box, the top's on a drawer, neither on an open box.
    sideChips.get('lid')!.hidden = s.style === 'open' || s.style === 'drawer';
    sideChips.get('top')!.hidden = s.style !== 'drawer';
    paintSides();
    const on = !!d;
    for (const node of [sides, pattern.root, zoom, angle, op, margin, shapes, frame]) node.hidden = !on;
    const here = d ? d.faces.filter((f) => hasTop(s.style) || f !== 'lid') : [];
    noSide.hidden = !on || here.length > 0;
    noSide.textContent = hasTop(s.style) ? 'Pick a side for the pattern.' : 'An open box has no lid — pick a side.';
    autoTab.setValue(s.finger === 0);
    finger.hidden = s.finger === 0;
    const shaped = on && d!.window !== 'face';
    windowSize.hidden = !shaped;
    windowPos.hidden = !shaped;
    web.hidden = !on || d?.op !== 'cut';
  }

  /** The 3D box takes clicks while the Pattern category is open and a pattern is on. */
  function emitPicking() {
    const d = deco(s);
    ev.picking(!!d && openCategory === 'Pattern');
  }

  /**
   * Push the settings into every control and take back what each one can show, so a value out of
   * a control's range or off its step is put right in the settings too, not only on screen
   * (invariant #12). Load, Reset and a template all end here. The settings with a control of
   * their own go through the kit's `syncControls`; the rest have a line each.
   */
  function sync() {
    syncControls(s, {
      style, measure, length: lengthRow, width: widthRow, height: heightRow,
      material, thickness, sheet, sheetW, sheetH,
      fit, joint, bottom, kerfAuto: autoKerfSwitch, kerf, drawers, fingerHole,
    });
    // Compartments on screen, walls in the settings.
    across.setValue(s.dividersX + 1);
    s.dividersX = across.getValue() - 1;
    deep.setValue(s.dividersY + 1);
    s.dividersY = deep.getValue() - 1;
    // 0 is automatic: the slider shows the automatic width and the setting stays 0.
    finger.setValue(s.finger || autoWidth());
    if (s.finger) s.finger = finger.getValue();
    // The pattern's controls show the first decoration, or the defaults while there is none.
    const d = deco(s);
    patternOn.setValue(!!d);
    const shown = d ?? { ...DEFAULT_DECORATION };
    syncControls(shown, { op, frame, zoom, angle, web, margin, windowSize });
    // The pad shows the shift in the customer's unit, so it is not read back: `coerceSettings`
    // has already held the settings to the pad's range.
    windowPos.setValue({ x: shown.windowX, y: shown.windowY });
    pattern.set(shown.pattern);
    for (const [id, t] of windowTiles) t.setSelected(id === shown.window);
    // Whatever was just pushed in — a project, Reset, a template — is the box as opened.
    baseline = boxOf(s);
    picked = null;
    paintPicked();
    applyVisibility();
    emitPicking();
  }

  // A length reads in the chosen unit everywhere: re-show each through its own formatter.
  const stopUnits = units.onChange(() => {
    paintSizes();
    for (const r of [...lengths, sheetW, sheetH]) r.setValue(r.getValue());
    finger.setValue(finger.getValue());
    if (units.get() === 'in') windowPos.setUnit('in', 1 / 25.4, 2);
    else windowPos.setUnit('mm');
  });

  applyVisibility();
  const right = [
    section({ title: 'Box', body: [style, ready, drawers, fingerHole] }),
    section({ title: 'Size', body: [measure, lengthRow, widthRow, heightRow, otherSize] }),
  ];
  return {
    left: rail, right, sync, toggleFace,
    open: (c) => rail.open(c),
    showSizes(outside, inside) { sizes = { outside, inside }; paintSizes(); },
    dispose: stopUnits,
  };
}
