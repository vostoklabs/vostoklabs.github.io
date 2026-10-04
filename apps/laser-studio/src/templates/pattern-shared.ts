// The pattern picker and its knobs, shared by every template that fills something with a
// repeating pattern. Lifted out of `pattern-fill.ts` unchanged when `pattern-svg.ts` wanted
// the same ten controls: two copies of a field list is how the two of them drift apart, and
// the repo's rule is that a second caller means it belongs in the shared place.
//
// The engine is `@vostok/patterns` (packages/patterns/README.md). What lives here is the FORM's
// half — which knobs a given tile has, what the site calls them, turning the answers back into
// one `fillShape` options object — and the step after it: the fill turned into layers, for any
// op, in ONE place (`fillLayers`, and `patternLayers` for a template that wants the whole
// thing in one call). A cut of a line pattern is a lattice (the lines kept as struts, the faces
// between them cut out); its faces are booleans the worker does, so the layer carries the
// region, the pattern's lines and solids, and the rules (`DesignLayer.lattice`) rather than
// holes — and a template that built its layers by hand would silently cut nothing. Hence one
// function, used by all.
import { LATTICE_STATUS, THINNEST_WOOD, fillShape, patternById, type FillResult, type PatternDef, type PatternOp, type Shapes } from '@vostok/patterns';
import libraryIndex from '@vostok/patterns/library-index';
import { OUTLINE_STATUS, type DesignLayer } from '../engine/types';
import { num, str, type Field, type Values } from './types';

/** What a pattern falls back to when an id names nothing the engine knows. */
export const FALLBACK_PATTERN = 'honeycomb';
/** Asanoha — the hemp leaf. A scored one is what the gallery cards show. */
export const DEFAULT_PATTERN = 'pm-japanese-pattern-4';

export const OP_WORD: Record<PatternOp, string> = { cut: 'cut out', engrave: 'engraved', score: 'scored' };

/* What each library tile is and what it allows, without its geometry: the package keeps a
   small index (ids, names, modes, ranges, tags) beside the data for exactly this, so the form
   knows whether to show a Stroke or a Spacing slider before a byte of path data has loaded. */
interface TileMeta {
  mode: 'stroke' | 'stroke-join' | 'fill';
  maxSpacing: [number, number];
}
const TILE_META = new Map<string, TileMeta>(
  (libraryIndex as unknown as { tiles: { id: string; mode: string; maxSpacing: number[] }[] }).tiles.map((t) => [
    `pm-${t.id}`,
    { mode: t.mode === 'fill' ? 'fill' : t.mode === 'stroke-join' ? 'stroke-join' : 'stroke', maxSpacing: [t.maxSpacing[0] ?? 0, t.maxSpacing[1] ?? 0] },
  ] as const),
);
/** The widest spacing any tile in the library allows — the slider's end stop. What a given
 *  tile allows is narrower, and the fill clamps to it. */
const MAX_SPACING = Math.max(...[...TILE_META.values()].flatMap((t) => t.maxSpacing));
/** 0 for a procedural pattern, which has no spacing of its own. */
export const spacingRoom = (id: string, axis: 0 | 1): number => TILE_META.get(id)?.maxSpacing[axis] ?? 0;
/** A tile drawn as lines: the only kind with a stroke to set. */
export const isStrokeTile = (id: string): boolean => (TILE_META.get(id)?.mode ?? 'fill') !== 'fill';

let libraryLoaded: Promise<PatternDef[]> | null = null;
async function libraryPattern(id: string): Promise<PatternDef | undefined> {
  libraryLoaded ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
  const lib = await libraryLoaded;
  return lib.find((d) => d.id === id) ?? lib[0];
}

/** The chosen pattern, whichever half of the library it came from. The tile geometry loads
 *  only when a `pm-` tile is actually built, so a customer who stays with the procedural
 *  patterns never pays for it. */
export async function patternDefFor(id: string): Promise<PatternDef> {
  const def = id.startsWith('pm-') ? await libraryPattern(id) : patternById(id);
  return def ?? patternById(FALLBACK_PATTERN)!;
}

/** The op the customer asked for, or the nearest one this pattern can do, saying so. Every
 *  pattern cuts: holes where it has its own to punch, a lattice where it is lines. */
export function resolveOp(def: PatternDef, asked: PatternOp): { op: PatternOp; warnings: string[] } {
  if (def.ops.includes(asked) || asked === 'cut') return { op: asked, warnings: [] };
  const fallback = def.ops[0]!;
  return { op: fallback, warnings: [`${def.name} cannot be ${OP_WORD[asked]} — it is ${OP_WORD[fallback]} instead.`] };
}

export interface PatternFieldOpts {
  section?: string;
  /** The pattern the design opens on. */
  value?: string;
  /** What "Make it" starts at — a coaster scores, a cut-out earring cuts. */
  op?: PatternOp;
  /** How far in from the edge the fill starts, mm. 4 on a design whose OUTLINE we drew — a
   *  coaster wants a border. 0 on one drawn by the customer: "keep 4 mm off your own artwork"
   *  is an opinion about a shape we have not seen, and on a petal or a thin arm it is the
   *  whole petal. A cut still gets its safety either way (`inset` is `max(margin, web)`). */
  margin?: number;
}

/** The picker is the gallery (`@vostok/patterns/ui`) — one `pattern` field, one card of the
 *  chosen pattern, and Pattern Monster's own wall of cards behind "Choose pattern…". The knobs
 *  beside it are the site's, in the site's words: Zoom, Stroke, Horizontal/Vertical spacing. */
export function patternFields(o: PatternFieldOpts = {}): Field[] {
  const section = o.section ?? 'Pattern';
  return [
    // No help: it only ever said which patterns could not be cut, and now every one can.
    { kind: 'pattern', key: 'pattern', label: 'Pattern', section, value: o.value ?? DEFAULT_PATTERN },
    { kind: 'number', key: 'patternScale', label: 'Zoom', section, value: 100, min: 40, max: 300, step: 5, unit: '%' },
    {
      kind: 'number', key: 'patternStroke', label: 'Stroke', section, value: 1, min: 0.5, max: 6, step: 0.5,
      help: 'How wide the line is burnt into the material.',
      visibleWhen: (v) => isStrokeTile(str(v, 'pattern')) && str(v, 'patternOp') === 'engrave',
    },
    {
      kind: 'number', key: 'patternSpacingX', label: 'Horizontal spacing', section, value: 0, min: 0, max: MAX_SPACING, step: 0.5,
      visibleWhen: (v) => spacingRoom(str(v, 'pattern'), 0) > 0,
    },
    {
      kind: 'number', key: 'patternSpacingY', label: 'Vertical spacing', section, value: 0, min: 0, max: MAX_SPACING, step: 0.5,
      visibleWhen: (v) => spacingRoom(str(v, 'pattern'), 1) > 0,
    },
    { kind: 'number', key: 'patternAngle', label: 'Angle', section, value: 0, min: 0, max: 180, step: 5, unit: '°' },
    // NOT advanced. It was, and it was the only advanced field either pattern design had — so
    // "More options" existed as a whole rail category holding one nudge pad, stripped of the
    // "Pattern" heading that said what it moved — a stray d-pad. Under the Pattern heading,
    // "Position" needs no more words.
    { kind: 'position', key: 'patternX', keyY: 'patternY', label: 'Position', section, value: 0, valueY: 0, max: 30, step: 0.5, unit: 'mm' },
    {
      kind: 'select', key: 'patternOp', label: 'Make it', section, value: o.op ?? 'score',
      options: [{ value: 'cut', label: 'Cut out' }, { value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'Line patterns cut as a lattice: the lines stay, the gaps go.',
    },
    // 1 mm by default (Ian, 2026-10-03, with Laser Box: "make web of laser cut to be default to
    // 1 mm"); raise it for a sturdier piece.
    {
      kind: 'number', key: 'web', label: 'Web', section, value: 1, min: 1, max: 8, step: 0.1, unit: 'mm',
      help: 'Strut width, and the least material between cuts.',
      visibleWhen: (v) => str(v, 'patternOp') === 'cut',
    },
    // Round 7 (2026-09-29): a strip of wood inside one cut-out, between two arms of one shape,
    // is held to this. Two kerf walls by default; raise it for a sturdier piece.
    {
      kind: 'number', key: 'thinnestWood', label: 'Thinnest wood', section, value: THINNEST_WOOD, min: THINNEST_WOOD, max: 2, step: 0.1, unit: 'mm',
      help: 'The narrowest strip of wood left inside one cut-out.',
      advanced: true,
      visibleWhen: (v) => str(v, 'patternOp') === 'cut',
    },
    { kind: 'number', key: 'margin', label: 'Edge margin', section, value: o.margin ?? 4, min: 0, max: 30, step: 0.5, unit: 'mm' },
  ];
}

/** What the form asked for, before the pattern gets a say. */
export const askedOp = (v: Values): PatternOp => (str(v, 'patternOp') || 'score') as PatternOp;

/** The form's answers as `fillShape` options — everything but the region. */
export function fillOptions(v: Values, op: PatternOp) {
  const chosen = str(v, 'pattern');
  const margin = num(v, 'margin');
  const web = num(v, 'web');
  return {
    op,
    // The library's own three knobs, in the site's words. A procedural pattern declares none
    // of these keys, so `resolveParams` drops them — one params object serves both halves.
    params: {
      stroke: num(v, 'patternStroke'),
      spacingX: Math.min(num(v, 'patternSpacingX'), spacingRoom(chosen, 0)),
      spacingY: Math.min(num(v, 'patternSpacingY'), spacingRoom(chosen, 1)),
    },
    scale: num(v, 'patternScale') / 100,
    angle: num(v, 'patternAngle'),
    dx: num(v, 'patternX'),
    dy: num(v, 'patternY'),
    web,
    inset: op === 'cut' ? Math.max(margin, web) : margin,
    // The engine's cut layer takes closed shapes, so a hinge's slits come back as 0.25 mm
    // slots — one kerf wide, which the laser cuts as a single pass either side.
    ...(op === 'cut' ? { slitWidth: 0.25 } : {}),
    // A form without the knob (a design that fixes its own fields) leaves the engine's own 0.4.
    ...(op === 'cut' && num(v, 'thinnestWood') > 0 ? { thinnest: num(v, 'thinnestWood') } : {}),
    // A score of shapes is the outline of what they paint, which is a union: the worker's.
    hostOutline: true,
  };
}

/** The fill turned into layers, in the words of whatever the op did. A pattern of lines has
 *  nothing to fill: its lines are scored, in the score colour, and the export note says so. A
 *  lattice's openings are counted in the worker, after this is written: it is named here, and the
 *  worker swaps the name for the count — or for "nothing cut out" when the rules refused it. */
export const fillCount = (op: PatternOp, fill: { shapes: unknown[]; paths: unknown[]; stats: { lineLength: number }; lattice?: unknown; outline?: unknown }): string =>
  op === 'cut' ? (fill.lattice ? LATTICE_STATUS : `${fill.shapes.length + fill.paths.length} holes`)
    : op === 'score' ? (fill.outline ? OUTLINE_STATUS : `${Math.round(fill.stats.lineLength)} mm of line`)
      : `${fill.shapes.length} shapes`;

/** Gaps a scored pattern's union closes, mm: ten microns — a tile's two copies of one edge are
 *  written a last decimal (a third of a micron to a few microns) apart, and left open they burn
 *  that edge twice. */
const SEAL = 0.01;

export interface FillLayerOpts {
  /** The layer's id; an engraved line pattern's lines get `<id>-lines`. Default `pattern`. */
  id?: string;
  /** Default: the pattern's name. */
  label?: string;
  /** `fill` where the pattern is MEANT to reach the edge, so the engine never reports its
   *  trimming as "ran past the edge". */
  kind?: 'fill';
  /** `patternLayers` only: the pattern's own parameters, over the form's — what a design fixes
   *  that the form has no knob for, e.g. `{ count: 48 }` for Rays on a card (cards-F's sunburst
   *  is 48 thin rays; the pattern's own 24 are fat wedges there). A key the chosen pattern does
   *  not declare is dropped, so it is safe to pass whatever the pattern turns out to be. */
  params?: Record<string, number>;
}

/**
 * A fill as layers, for whatever op made it — the one place this is decided:
 *   cut      holes punched through, or — a pattern of lines — the lattice: the region, the
 *            pattern's lines and its solids, which the worker turns into faces
 *            (`DesignLayer.lattice`);
 *   engrave  the regions engraved, and any lines scored beside them;
 *   score    everything scored.
 */
export function fillLayers(fill: FillResult, def: PatternDef, o: FillLayerOpts = {}): DesignLayer[] {
  const id = o.id ?? 'pattern';
  const label = o.label ?? def.name;
  const kind = o.kind ? { kind: o.kind } : {};
  if (fill.op === 'cut') {
    if (fill.lattice) {
      const { region, solids, ...spec } = fill.lattice;
      return [{ id, label, op: 'cut', stencil: false, ...kind, shapes: region, ...(solids.length ? { minus: solids } : {}), lattice: spec }];
    }
    return fill.shapes.length ? [{ id, label, op: 'cut', stencil: false, ...kind, shapes: fill.shapes }] : [];
  }
  if (fill.op === 'engrave') {
    const out: DesignLayer[] = [];
    // An island the fill could not clip is trimmed to the zone here, by the worker (`keep`) — never
    // engraved whole into the border.
    if (fill.shapes.length) out.push({ id, label, op: 'engrave', ...kind, shapes: fill.shapes, ...(fill.zone ? { keep: fill.zone } : {}), ...(fill.erode ? { erode: { seal: SEAL, by: fill.erode } } : {}) });
    if (fill.paths.length) out.push({ id: `${id}-lines`, label: `${label} lines`, op: 'score', ...kind, shapes: [], paths: fill.paths });
    return out;
  }
  // A score of shapes: the outline of what they paint, traced by the worker (`PatternOutline`).
  const outline = fill.outline ? { outline: { ...fill.outline, seal: SEAL, erode: fill.erode ?? 0 } } : {};
  return [{ id, label, op: 'score', ...kind, shapes: fill.shapes, paths: fill.paths, ...outline }];
}

export interface PatternLayers {
  def: PatternDef;
  /** The op it was made with — what the customer asked, unless the pattern could not. */
  op: PatternOp;
  fill: FillResult;
  layers: DesignLayer[];
  /** The op's fallback and the fill's own sentences, in that order. */
  warnings: string[];
  /** "Honeycomb · 96 holes", "Asanoha · cut as a lattice" — a status clause. */
  status: string;
}

/**
 * The whole pattern step in one call: `region` (islands of rings, holes = reserves, the fill
 * reads it even-odd) filled with the form's pattern, for the form's op, as layers.
 * `v` is the form's values — override `margin` / `web` in it to fix them for a design.
 */
export async function patternLayers(region: Shapes, v: Values, o: FillLayerOpts = {}): Promise<PatternLayers> {
  const def = await patternDefFor(str(v, 'pattern'));
  const resolved = resolveOp(def, askedOp(v));
  const options = fillOptions(v, resolved.op);
  const fill = fillShape(region, def, o.params ? { ...options, params: { ...options.params, ...o.params } } : options);
  return {
    def,
    op: resolved.op,
    fill,
    layers: fillLayers(fill, def, o),
    warnings: [...resolved.warnings, ...fill.warnings],
    status: `${def.name} · ${fillCount(resolved.op, fill)}`,
  };
}
