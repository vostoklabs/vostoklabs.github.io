// The whole build, in the worker: the box's pieces → patterns on the chosen faces → the kerf →
// the pieces laid out on sheets. One call, one answer, everything the page shows and the file
// holds. Runs in node too (tests/), against manifold's node build.
//
// Two geometries leave here for every piece, and they must never be confused:
//
//   nominal  the piece as it comes off the machine: what the 3D view assembles and the design
//            view draws;
//   cut      the line the laser follows: `nominal` offset out by half the kerf, so the beam
//            takes its half off the outside of every edge and the piece lands on `nominal`.
//            Holes and slots shrink by the same half. Only `cut` goes in the file.
//
// Scores and engraves are not cuts and are never offset. A flex tab's slits are single lines,
// never offset either — but the file's copy (`cutSlits`) runs half a kerf past the edge, or the
// offset outline would no longer meet them and the arm they free would still be held at its tip.
// `slits` stays tip to root, for the views.
import { fillShape, latticeFaces, EdgeIndex, clipRingsAsLines, patternById, type PatternDef, type FillResult } from '@vostok/patterns';
import { withScope, toCS, fromCS, csOf, ringsOf, offsetShapes, subtractShapes, intersectShapes, unionShapes } from '@vostok/laser/csg2d';
import { buildBox, type PieceDraft } from './boxes';
import { facesOf, regionOn, type Decoration } from './decor';
import { packSheets, type Placement, type SheetSize } from './layout';
import type { BoxSpec } from './spec';
import type { FaceId, Motion, Pt, Ring, Shapes, V3 } from './types';

export interface BuildRequest {
  spec: BoxSpec;
  decorations: Decoration[];
  sheet: SheetSize;
  /** Keep pieces the way round they are drawn where the sheet allows: plywood has a grain. */
  upright?: boolean;
}

export interface BuiltPiece {
  id: string;
  label: string;
  face: FaceId | null;
  role: PieceDraft['role'];
  nominal: Shapes;
  cut: Shapes;
  /** A flex tab's slits, tip to root: what the views draw. */
  slits: Pt[][];
  /** The same slits as the laser cuts them, run half a kerf past the tip: what the file holds. */
  cutSlits: Pt[][];
  engrave: Shapes;
  score: { shapes: Shapes; paths: Pt[][] };
  origin: V3;
  u: V3;
  v: V3;
  thickness: number;
  motion?: Motion;
}

export interface BuildResult {
  pieces: BuiltPiece[];
  placements: Placement[];
  sheets: number;
  sheet: SheetSize;
  outside: { x: number; y: number; z: number };
  /** Everything included: a hinge's knuckles and latch tab stand proud of `outside`. */
  overall: { x: number; y: number; z: number };
  inside: { x: number; y: number; z: number };
  warnings: string[];
  /** One clause per decoration for the status line: "Honeycomb · 4 faces · 212 holes". */
  notes: string[];
}

/** Where the pattern definitions come from: procedural ones at once, library tiles lazily. */
export type PatternSource = (id: string) => Promise<PatternDef>;

export const procedural: PatternSource = async (id) => patternById(id) ?? patternById('honeycomb')!;

export async function buildAll(wasm: any, req: BuildRequest, patterns: PatternSource = procedural): Promise<BuildResult> {
  const model = buildBox(req.spec);
  const warnings = [...model.warnings];
  const notes: string[] = [];
  const kerf = Math.max(0, req.spec.kerf);
  const hasLid = model.pieces.some((p) => p.face === 'lid');

  const pieces: BuiltPiece[] = model.pieces.map((p) => {
    // Added first (a hinge's ears), then taken away (its rounds, a slot, feet, a finger notch).
    const grown = p.addOn.length ? unionShapes(wasm, [...p.outline, ...p.addOn.map((r) => [r])]) : p.outline;
    const nominal = p.cutAway.length ? subtractShapes(wasm, grown, p.cutAway.map((r) => [r])) : grown;
    return {
      id: p.id,
      label: p.label,
      face: p.face,
      role: p.role,
      nominal,
      cut: [],
      slits: p.slits,
      cutSlits: [],
      engrave: [],
      score: { shapes: [], paths: [] },
      origin: p.origin,
      u: p.u,
      v: p.v,
      thickness: p.thickness,
      ...(p.motion ? { motion: p.motion } : {}),
    };
  });

  // -- patterns ---------------------------------------------------------------------------
  for (const d of req.decorations) {
    const faces = new Set(facesOf(d, hasLid));
    if (!faces.size) continue;
    const def = await patterns(d.pattern);
    let done = 0;
    let holes = 0;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      const draft = model.pieces[i]!;
      if (!piece.face || !faces.has(piece.face)) continue;
      const room = regionOn(draft, d);
      if (!room) {
        warnings.push(`The ${draft.label.toLowerCase()} is too small for a pattern — lower Edge margin or make the box bigger.`);
        continue;
      }
      // Every cut feature on the piece — a finger notch, a latch's recess, a knuckle, the slots a
      // divider comes through — keeps the pattern AND its outline an Edge margin clear, as the
      // piece's own edges do. The outline was the room's plain rectangle and ran straight over a
      // drawer's finger notch (Ian, 2026-10-03); now it bends round it.
      const keep = draft.keepOut.length && d.margin > 0 ? offsetShapes(wasm, draft.keepOut.map((r) => [r]), d.margin) : draft.keepOut.map((r) => [r]);
      const region = (keep.length ? subtractShapes(wasm, room.region, keep) : room.region).filter((island) => areaOf(island) >= MIN_PANEL);
      if (!region.length) {
        warnings.push(`The ${draft.label.toLowerCase()} is too small for a pattern — lower Edge margin or make the box bigger.`);
        continue;
      }
      const op = d.op === 'cut' || def.ops.includes(d.op) ? d.op : def.ops[0]!;
      const fill = fillShape(region, def, {
        op,
        scale: d.zoom / 100,
        angle: d.angle,
        dx: d.dx,
        dy: d.dy,
        web: d.web,
        inset: op === 'cut' ? d.web : 0,
        ...(op === 'cut' ? { slitWidth: 0.25 } : {}),
        ...(op === 'engrave' ? { strokeWidth: ENGRAVE_LINE } : {}),
        hostOutline: true,
      });
      for (const w of fill.warnings) if (!warnings.includes(w)) warnings.push(w);
      const got = realize(wasm, fill, warnings);
      // A bold engraved line is widened after the lines are clipped, so it would spill half its
      // width into the Edge margin: trim it back to the pattern's room.
      if (got.engrave.length) got.engrave = intersectShapes(wasm, got.engrave, region);
      if (got.cut.length) {
        piece.nominal = subtractShapes(wasm, piece.nominal, got.cut);
        holes += got.cut.length;
      }
      piece.engrave.push(...got.engrave);
      piece.score.shapes.push(...got.score.shapes);
      piece.score.paths.push(...got.score.paths);
      if (room.frame) piece.score.shapes.push(...region);
      done++;
    }
    if (done) notes.push(`${def.name} · ${done} face${done === 1 ? '' : 's'}${holes ? ` · ${holes} cut-outs` : ''}`);
  }

  // -- the kerf -------------------------------------------------------------------------------
  for (const p of pieces) {
    p.cut = kerf > 0 ? grow(wasm, p.nominal, kerf / 2) : p.nominal;
    p.cutSlits = p.slits.map((s) => overshoot(s, kerf / 2 + 0.2));
  }

  // -- the sheets ------------------------------------------------------------------------------
  const { placements, sheets, tooBig } = packSheets(pieces.map((p) => ({ id: p.id, shapes: p.cut })), req.sheet, { upright: req.upright });
  for (const id of tooBig) {
    const p = pieces.find((x) => x.id === id);
    warnings.push(`The ${p?.label.toLowerCase() ?? id} is bigger than the sheet — choose a bigger sheet.`);
  }

  return { pieces, placements, sheets, sheet: req.sheet, outside: model.outside, overall: model.overall, inside: model.inside, warnings, notes };
}

/** How wide Engrave burns a pattern's lines, mm: bold, where Score is a hairline (Ian, 2026-10-03:
 *  "bold lines for engrave, thin lines for score"). One width for every line pattern — a library
 *  tile's own default (one tile unit, ~0.33 mm) reads as a score, and a procedural one has none,
 *  so without this Engrave on a line pattern gave Score's hairlines. */
const ENGRAVE_LINE = 0.8;

/** A patch of pattern smaller than this, mm², is left plain: a sliver between a notch's clearance
 *  and the edge is not worth a frame of its own. */
const MIN_PANEL = 25;

/** An island's area, mm²: its outline less its holes. */
function areaOf(island: Shapes[number]): number {
  const ring = (r: Shapes[number][number]) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
    return Math.abs(a / 2);
  };
  return island.reduce((sum, r, k) => sum + (k === 0 ? ring(r) : -ring(r)), 0);
}

/** Offset every island out by `d` with mitred corners, so a finger keeps its square corners. */
function grow(wasm: any, shapes: Shapes, d: number): Shapes {
  return withScope((keep) => fromCS(keep(toCS(wasm, shapes, keep).offset(d, 'Miter', 2)), keep));
}

/** A slit run `by` mm further out past its first point (the end on the piece's edge). */
function overshoot(s: Pt[], by: number): Pt[] {
  if (s.length < 2 || by <= 0) return s;
  const [a, b] = [s[0]!, s[1]!];
  const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const k = by / len;
  return [[a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k], ...s.slice(1)];
}

/** Hairline gaps a scored pattern's union closes, mm (a tile's two copies of one edge sit a few
 *  microns apart; left open they burn that edge twice). The value Laser Studio uses. */
const SEAL = 0.01;

/**
 * A fill as what the laser does: holes to cut (the lattice's faces when the pattern is lines),
 * regions to engrave, lines to score. The booleans are the same ones Laser Studio's worker runs
 * for a pattern (apps/laser-studio/src/engine/build.ts `latticeLayer` / `outlineLayer`).
 */
function realize(wasm: any, fill: FillResult, warnings: string[]): { cut: Shapes; engrave: Shapes; score: { shapes: Shapes; paths: Pt[][] } } {
  const out = { cut: [] as Shapes, engrave: [] as Shapes, score: { shapes: [] as Shapes, paths: [] as Pt[][] } };
  if (fill.op === 'cut') {
    if (fill.lattice) {
      const r = latticeFaces(fill.lattice, {
        offset: (s, d, coarse) => (coarse && Math.abs(d) > 0.2
          ? withScope((keep) => fromCS(keep(toCS(wasm, s, keep).offset(d, 'Round', 2.0, 8)), keep))
          : offsetShapes(wasm, s, d)),
        subtract: (a, b) => subtractShapes(wasm, a, b),
        outline: (rings) => {
          const cs = csOf(wasm, rings, 'EvenOdd');
          try {
            return ringsOf(cs);
          } finally {
            cs.delete();
          }
        },
      });
      for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
      out.cut = r.faces;
    } else {
      // A hinge's slits come back as thin slots (`slitWidth`): closed shapes, cut like holes.
      out.cut = fill.shapes;
    }
    return out;
  }
  if (fill.op === 'engrave') {
    let shapes = fill.shapes;
    if (fill.zone && shapes.length) shapes = intersectShapes(wasm, shapes, fill.zone);
    if (fill.erode && shapes.length) {
      const e = fill.erode;
      shapes = withScope((keep) => {
        let cs = toCS(wasm, shapes, keep);
        cs = keep(cs.offset(SEAL, 'Miter', 2));
        cs = keep(cs.offset(-(SEAL + e), 'Miter', 2));
        return fromCS(cs, keep);
      });
    }
    out.engrave = shapes;
    out.score.paths = fill.paths;
    return out;
  }
  // Score: the outline of what the shapes paint, clipped as lines to the zone, plus the lines.
  out.score.paths.push(...fill.paths);
  out.score.shapes.push(...fill.shapes);
  if (fill.outline && fill.outline.shapes.length) {
    const erode = fill.erode ?? 0;
    const rings: Ring[] = withScope((keep) => {
      let cs = toCS(wasm, fill.outline!.shapes, keep);
      cs = keep(cs.offset(SEAL, 'Miter', 2));
      cs = keep(cs.offset(-(SEAL + erode), 'Miter', 2));
      return ringsOf(cs) as Ring[];
    });
    const index = new EdgeIndex(fill.outline.zone);
    const clipped = clipRingsAsLines(rings, index);
    out.score.shapes.push(...clipped.closed.map((r) => [r]));
    out.score.paths.push(...clipped.open);
  }
  return out;
}
