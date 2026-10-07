// Every setting the box has, in one plain object: Save / Load serialise exactly this.
// `toRequest` is the one place it becomes millimetres for the engine.
import type { Bottom, BoxSpec, BoxStyle } from './engine/spec';
import { facesOf, type Decoration, type FacePreset, type WindowShape } from './engine/decor';
import type { FaceId } from './engine/types';
import type { BuildRequest } from './engine/build';
import { OP_ORDER } from '@vostok/laser/ops';
import { MATERIALS, presetById, type Material, type SheetPreset } from '@vostok/laser/sheets';

export type Joint = 'flex' | 'fingers';

export interface BoxSettings {
  style: BoxStyle;
  length: number;
  width: number;
  height: number;
  /** Whether the three sizes are the box's outside or the space inside. */
  measure: 'outside' | 'inside';
  material: string;
  /** The sheet as measured, mm. */
  thickness: number;
  /** Full kerf width, mm. Follows the material until it is typed over. */
  kerf: number;
  kerfAuto: boolean;
  /** −2 … 2: Looser, Loose, Standard, Tight, Tighter. */
  fit: number;
  joint: Joint;
  bottom: Bottom;
  /** Walls across the length and across the width. */
  dividersX: number;
  dividersY: number;
  /** Drawers stacked in a drawer box, 1–3. */
  drawers: number;
  fingerHole: boolean;
  /** Finger width to aim at, mm; 0 = automatic. */
  finger: number;
  sheet: string;
  sheetW: number;
  sheetH: number;
  decorations: Decoration[];
}

// ------------------------------------------------------------------ materials --

/** What the Box needs of a sheet beyond what the shelf says of it. */
interface BoxStock {
  /** How much the fit stops shift for this material, mm of interference: acrylic does not
   *  give like wood, and cracks where ply would crush (joints.md §5.3). */
  fitShift: number;
  /** Takes flex tabs. Acrylic does not (its arms would crack) and 2 mm greyboard does not (its
   *  paper layers part under a slit, and even plain fingers are marginal that thin — 06 §3.3):
   *  either gets plain fingers whenever it is chosen. */
  flex: boolean;
  /** Has a face grain (plywood): its pieces are laid out the same way round on the sheet. */
  grain: boolean;
}

/** A material the Box offers: the shelf's (its name, thickness, kerf and colour) and the Box's own. */
export type BoxMaterial = Material & BoxStock;

/**
 * The materials the Box offers, in this order, by the shelf's id: one acrylic, and none that
 * only engraves. Name, thickness, kerf and the 3D colour are the shelf's (@vostok/laser/sheets),
 * so the Box cuts every sheet with the same kerf as Laser Studio. A customer who cuts a test and
 * finds it loose or tight moves Fit, not the kerf.
 */
const STOCK: Record<string, BoxStock> = {
  ply3: { fitShift: 0, flex: true, grain: true },
  ply4: { fitShift: 0, flex: true, grain: true },
  ply6: { fitShift: 0.02, flex: true, grain: true },
  mdf3: { fitShift: 0.03, flex: true, grain: false },
  mdf6: { fitShift: 0.03, flex: true, grain: false },
  'acr-clear3': { fitShift: -0.1, flex: false, grain: false },
  card2: { fitShift: 0.05, flex: false, grain: false },
};

export const BOX_MATERIALS: BoxMaterial[] = Object.entries(STOCK).map(([id, own]) => {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`The shelf has no material ${id}`);
  return { ...m, ...own };
});

export const boxMaterial = (id: string): BoxMaterial => BOX_MATERIALS.find((m) => m.id === id) ?? BOX_MATERIALS[0]!;

/** The first ids of a material whose id is the shelf's now: a project saved with one opens on it. */
const OLD_MATERIAL_IDS: Record<string, string> = { acrylic3: 'acr-clear3' };

/** The five fit stops, as interference across a finger, mm (+ grips, − slides). Standard is a
 *  firm hand press in ply; Tighter wants a mallet. */
export const FIT_STOPS: { label: string; interference: number }[] = [
  { label: 'Looser', interference: -0.15 },
  { label: 'Loose', interference: -0.05 },
  { label: 'Standard', interference: 0.05 },
  { label: 'Tight', interference: 0.12 },
  { label: 'Tighter', interference: 0.2 },
];

export const fitLabel = (stop: number): string => FIT_STOPS[Math.round(stop) + 2]?.label ?? 'Standard';

// ------------------------------------------------------------------ sheets --

/** The sheets people buy — sizes only, no machines (Ian, 2026-10-03) — as the shelf lists them
 *  (@vostok/laser/sheets). If a machine's bed is ever listed again, it is a Bambu Lab machine:
 *  no other maker's name appears in this product. */
export const SHEETS: SheetPreset[] = ['sheet-300x300', 'sheet-12x12', 'sheet-300x200', 'sheet-400x400', 'sheet-a3', 'sheet-12x20', 'custom'].map((id) => {
  const p = presetById(id);
  if (!p) throw new Error(`The shelf has no sheet ${id}`);
  return p;
});

export const sheetById = (id: string): SheetPreset => SHEETS.find((s) => s.id === id) ?? SHEETS[0]!;

/** The sheets' first ids, from before they were the shelf's: a project saved with one opens on it. */
const OLD_SHEET_IDS: Record<string, string> = {
  '300x300': 'sheet-300x300',
  '12x12': 'sheet-12x12',
  '300x200': 'sheet-300x200',
  '400x400': 'sheet-400x400',
  a3: 'sheet-a3',
  '12x20': 'sheet-12x20',
};

// ------------------------------------------------------------------ styles --

export interface StyleInfo {
  id: BoxStyle;
  name: string;
  /** Has a lid a pattern can go on. */
  lid: boolean;
}

export const STYLES: StyleInfo[] = [
  { id: 'open', name: 'Open', lid: false },
  { id: 'lid', name: 'Lift-off lid', lid: true },
  { id: 'hinge', name: 'Hinged lid', lid: true },
  { id: 'drawer', name: 'Drawer', lid: false },
];

export const styleInfo = (id: BoxStyle): StyleInfo => STYLES.find((s) => s.id === id) ?? STYLES[0]!;

/** The bottom a box starts with: Inset — the floor a sheet up, its flex tabs in slots — on the
 *  hinged and the open box (Ian, 2026-10-03); Flush on the lift-off box and the chest. */
export const defaultBottom = (style: BoxStyle): Bottom => (style === 'hinge' || style === 'open' ? 'slots' : 'flush');

// ------------------------------------------------------------------ defaults --

export const DEFAULT_DECORATION: Decoration = {
  // The sides are chosen one by one (the Pattern category's side chips, or clicks on the box).
  on: 'pick',
  faces: ['lid'],
  pattern: 'pm-japanese-pattern-4',
  op: 'score',
  zoom: 100,
  angle: 0,
  dx: 0,
  dy: 0,
  // The least wood between two cut-outs: 1 mm (Ian, 2026-10-03 — "make web of laser cut to be
  // default to 1 mm").
  web: 1,
  margin: 4,
  window: 'face',
  windowSize: 80,
  windowX: 0,
  windowY: 0,
  // A scored line round the window: a heart cut as a lattice reads as a heart only with it.
  frame: true,
};

export const DEFAULT_SETTINGS: BoxSettings = {
  style: 'hinge',
  length: 120,
  width: 80,
  height: 60,
  measure: 'outside',
  material: 'ply3',
  thickness: 3,
  kerf: boxMaterial('ply3').kerfMm,
  kerfAuto: true,
  fit: 0,
  joint: 'flex',
  bottom: 'slots',
  dividersX: 0,
  dividersY: 0,
  drawers: 1,
  fingerHole: true,
  finger: 0,
  sheet: 'sheet-300x300',
  sheetW: 300,
  sheetH: 300,
  decorations: [],
};

// ------------------------------------------------------------------ ranges --

/**
 * Every number's range, in one place: the panel builds its controls from it, and a loaded project
 * is held to it (`coerceSettings`), so the engine never builds a value the panel cannot show and
 * Load, Reset and a template all end on what the controls say (invariant #12). Millimetres.
 */
export const LIMITS = {
  length: [30, 600],
  width: [30, 600],
  height: [15, 400],
  thickness: [1, 12],
  kerf: [0, 0.5],
  fit: [-2, 2],
  /** A tab width set by hand. 0, outside it, is "automatic". */
  finger: [3, 40],
  sheet: [100, 1200],
  /** Walls across the length, or across the width. */
  dividers: [0, 6],
  drawers: [1, 3],
  zoom: [30, 300],
  angle: [0, 180],
  web: [1, 8],
  margin: [0, 20],
  windowSize: [15, 100],
  /** How far a shaped window slides from the middle, either way. */
  windowShift: [-150, 150],
} as const satisfies Record<string, readonly [number, number]>;

/** The kerf the material implies. */
export const autoKerf = (s: BoxSettings): number => boxMaterial(s.material).kerfMm;

// ------------------------------------------------------------------ the engine's view --

export function toSpec(s: BoxSettings): BoxSpec {
  const m = boxMaterial(s.material);
  return {
    style: s.style,
    length: s.length,
    width: s.width,
    height: s.height,
    measure: s.measure,
    t: s.thickness,
    kerf: s.kerf,
    fit: (FIT_STOPS[Math.round(s.fit) + 2]?.interference ?? 0.05) + m.fitShift,
    bottom: s.bottom,
    // Never flex tabs in a sheet that cannot take them (acrylic cracks, greyboard parts),
    // whatever a loaded project or a stale choice says.
    flex: s.joint === 'flex' && m.flex,
    finger: s.finger,
    fingerHole: s.fingerHole,
    dividersX: s.dividersX,
    dividersY: s.dividersY,
    drawers: s.drawers,
  };
}

export function toRequest(s: BoxSettings): BuildRequest {
  const sheet = s.sheet === 'custom' ? { width: s.sheetW, height: s.sheetH } : (({ widthMm, heightMm }) => ({ width: widthMm, height: heightMm }))(sheetById(s.sheet));
  return { spec: toSpec(s), decorations: s.decorations, sheet, upright: boxMaterial(s.material).grain };
}

// ------------------------------------------------------------------ load / share --

const STYLE_IDS: BoxStyle[] = STYLES.map((x) => x.id);
const PRESETS: FacePreset[] = ['lid', 'sides', 'front', 'all', 'pick'];
const WINDOWS: WindowShape[] = ['face', 'circle', 'oval', 'heart', 'star', 'hexagon', 'diamond', 'arch', 'cloud'];
const FACES: FaceId[] = ['lid', 'front', 'back', 'left', 'right', 'bottom'];

const num = (v: unknown, [lo, hi]: readonly [number, number], d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
/** An id from a project, under the shelf's name if it had another: one of `ids`, or `d`. */
const shelfId = (v: unknown, old: Record<string, string>, ids: { id: string }[], d: string): string => {
  const id = typeof v === 'string' ? (old[v] ?? v) : '';
  return ids.some((x) => x.id === id) ? id : d;
};
/** A tab width: 0 (automatic), or one the Tab width slider can show. */
const tabWidth = (v: unknown, d: number): number => {
  const w = num(v, [0, LIMITS.finger[1]], d);
  return w > 0 ? Math.max(LIMITS.finger[0], w) : 0;
};

export function coerceDecoration(raw: unknown): Decoration {
  const d = DEFAULT_DECORATION;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Sides are a list now; a project saved with a preset ("all", "sides") opens on its sides.
  const preset = pick(r.on, PRESETS, d.on);
  const listed = Array.isArray(r.faces) ? (r.faces.filter((f) => FACES.includes(f as FaceId)) as FaceId[]) : [...d.faces];
  return {
    on: 'pick',
    faces: preset === 'pick' ? listed : facesOf({ ...d, on: preset }, true),
    pattern: typeof r.pattern === 'string' && r.pattern ? r.pattern : d.pattern,
    op: pick(r.op, OP_ORDER, d.op),
    zoom: num(r.zoom, LIMITS.zoom, d.zoom),
    angle: num(r.angle, LIMITS.angle, d.angle),
    // No control slides the pattern itself; these keep their own range.
    dx: num(r.dx, [-100, 100], d.dx),
    dy: num(r.dy, [-100, 100], d.dy),
    web: num(r.web, LIMITS.web, d.web),
    margin: num(r.margin, LIMITS.margin, d.margin),
    window: pick(r.window, WINDOWS, d.window),
    windowSize: num(r.windowSize, LIMITS.windowSize, d.windowSize),
    windowX: num(r.windowX, LIMITS.windowShift, d.windowX),
    windowY: num(r.windowY, LIMITS.windowShift, d.windowY),
    frame: typeof r.frame === 'boolean' ? r.frame : d.frame,
  };
}

/** A loaded project over the defaults, every value checked. */
export function coerceSettings(raw: unknown): BoxSettings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const style = pick(r.style, STYLE_IDS, d.style);
  const s: BoxSettings = {
    style,
    length: num(r.length, LIMITS.length, d.length),
    width: num(r.width, LIMITS.width, d.width),
    height: num(r.height, LIMITS.height, d.height),
    measure: pick(r.measure, ['outside', 'inside'] as const, d.measure),
    material: shelfId(r.material, OLD_MATERIAL_IDS, BOX_MATERIALS, d.material),
    thickness: num(r.thickness, LIMITS.thickness, d.thickness),
    kerf: num(r.kerf, LIMITS.kerf, d.kerf),
    kerfAuto: typeof r.kerfAuto === 'boolean' ? r.kerfAuto : d.kerfAuto,
    fit: Math.round(num(r.fit, LIMITS.fit, d.fit)),
    // 'springs' was the first name for flex tabs.
    joint: r.joint === 'springs' ? 'flex' : pick(r.joint, ['flex', 'fingers'] as const, d.joint),
    bottom: pick(r.bottom, ['flush', 'slots', 'feet'] as const, defaultBottom(style)),
    dividersX: Math.round(num(r.dividersX, LIMITS.dividers, d.dividersX)),
    dividersY: Math.round(num(r.dividersY, LIMITS.dividers, d.dividersY)),
    drawers: Math.round(num(r.drawers, LIMITS.drawers, d.drawers)),
    fingerHole: typeof r.fingerHole === 'boolean' ? r.fingerHole : d.fingerHole,
    finger: tabWidth(r.finger, d.finger),
    sheet: shelfId(r.sheet, OLD_SHEET_IDS, SHEETS, d.sheet),
    sheetW: num(r.sheetW, LIMITS.sheet, d.sheetW),
    sheetH: num(r.sheetH, LIMITS.sheet, d.sheetH),
    decorations: Array.isArray(r.decorations) ? r.decorations.slice(0, 3).map(coerceDecoration) : [],
  };
  if (s.kerfAuto) s.kerf = autoKerf(s);
  return s;
}
