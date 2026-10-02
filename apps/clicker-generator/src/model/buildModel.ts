// Model mode's build: orient and size the cached model, run the chosen cutter, hand back parts.
//
// Runs in the geometry worker, beside buildClicker and buildBlocks, and answers with the same
// `parts` message — so the viewer, the recolour picking, the plate layout and every export path
// take a Model-mode clicker exactly the way they take an image one.
import type { ClickerPart, RGB, SwitchPlacement } from '../types';
import type { ModelCutParams, ModelMeta } from './types';
import { scope, type Scope, type SwitchKit, type SwitchPose } from './switchKit';
import { sectionAt } from './section';
import { cutSlice, type SeamMemo } from './cutSlice';
import { cutStand } from './cutStand';
import { cutButton } from './cutButton';

type Wasm = any;
type Solid = any;

/** One printed piece, before it becomes a mesh. */
export interface Piece {
  solid: Solid;
  name: string;
  /** Rides on the switch (the button side) rather than holding it. */
  moving: boolean;
  color: RGB;
}

/** What every cutter returns. Solids are owned by the build's scope. */
export interface CutOutput {
  pieces: Piece[];
  pose: SwitchPose;
  warnings: string[];
  cutHeight: number | null;
  cutRange: [number, number] | null;
  buttonAt: { x: number; y: number } | null;
  canHideSeam: boolean;
  hideSeam: boolean;
  movingGrams: number;
}

/**
 * The model turned, then scaled so its longest side is `sizeMm`, then set down: X/Y centred on
 * the origin, its bottom on Z 0. Every transform here is lazy in Manifold — nothing is computed
 * until the cutter's first boolean touches it.
 */
export function orientModel(
  sc: Scope,
  base: Solid,
  rotation: [number, number, number],
  sizeMm: number,
): { model: Solid; size: [number, number, number] } {
  let m = base;
  if (rotation.some((r) => Math.abs(r) > 1e-6)) m = sc.keep(m.rotate(rotation));
  const b = m.boundingBox();
  const ext: [number, number, number] = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const longest = Math.max(...ext, 1e-6);
  const k = Math.max(1, sizeMm) / longest;
  m = sc.keep(m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]));
  if (Math.abs(k - 1) > 1e-9) m = sc.keep(m.scale(k));
  return { model: m, size: [ext[0] * k, ext[1] * k, ext[2] * k] };
}

/**
 * How much to shave off a model's bottom so it stands on a flat face.
 *
 * A model made to be printed already has one, and gets nothing. A ball, an egg or a sculpt with a
 * rounded underside touches the bed at a point: its bottom piece would need support to print and
 * would roll once it had. Enough is shaved to leave a flat about 20 mm across (or 60 % of a small
 * model's width), never more than 15 % of its height.
 */
export function autoFlatten(sc: Scope, model: Solid, size: [number, number, number]): number {
  const want = Math.PI * Math.pow(Math.min(10, 0.3 * Math.min(size[0], size[1])), 2);
  const limit = size[2] * 0.15;
  for (let z = 0.2; z <= limit; z += 0.25) {
    if (sectionAt(sc, model, z).area() >= want) return z <= 0.2 ? 0 : Math.round(z * 4) / 4;
  }
  return Math.round(limit * 4) / 4;
}

/** Automatic seam heights, per cached model. A WeakMap on the model's solid, so a new upload
 *  starts empty and the old one's answers go with it. */
const seamMemos = new WeakMap<object, Map<string, number>>();

export function buildModelClicker(
  wasm: Wasm,
  kit: SwitchKit,
  base: Solid,
  p: ModelCutParams,
): { parts: ClickerPart[]; switchPlacements: SwitchPlacement[]; warnings: string[]; meta: ModelMeta } {
  const sc = scope();
  try {
    const oriented = orientModel(sc, base, p.rotation, p.sizeMm);
    const flat = Math.max(0, Math.min(oriented.size[2] * 0.5, p.flattenMm ?? autoFlatten(sc, oriented.model, oriented.size)));
    const model = flat > 0.01
      ? sc.keep(sc.keep(oriented.model.trimByPlane([0, 0, 1], flat)).translate([0, 0, -flat]))
      : oriented.model;
    const size: [number, number, number] = [oriented.size[0], oriented.size[1], oriented.size[2] - flat];
    const cut =
      p.cutter === 'stand' ? cutStand(wasm, sc, kit, model, size, p)
      : p.cutter === 'button' ? cutButton(wasm, sc, kit, model, size, p)
      : cutSlice(wasm, sc, kit, model, size, p, memoFor(base));

    const parts: ClickerPart[] = [];
    for (const piece of cut.pieces) {
      if (piece.solid.isEmpty()) continue;
      parts.push(toPart(piece));
    }
    let minZ = Infinity;
    for (const part of parts) {
      for (let i = 2; i < part.vertProperties.length; i += part.numProp) {
        if (part.vertProperties[i] < minZ) minZ = part.vertProperties[i];
      }
    }
    const { x, y, z, rotation } = cut.pose;
    return {
      parts,
      switchPlacements: parts.length > 1 ? [{ x, y, z, rotation }] : [],
      warnings: cut.warnings,
      meta: {
        sizeMm: size,
        cutHeightMm: cut.cutHeight,
        cutRangeMm: cut.cutRange,
        switchAt: { x, y, z, rotation },
        buttonAt: cut.buttonAt,
        movingGrams: cut.movingGrams,
        flattenMm: flat,
        canHideSeam: cut.canHideSeam,
        hideSeam: cut.hideSeam,
        assemblyMinZ: isFinite(minZ) ? minZ : 0,
      },
    };
  } finally {
    sc.free();
  }
}

function memoFor(base: object): SeamMemo {
  let m = seamMemos.get(base);
  if (!m) {
    m = new Map();
    seamMemos.set(base, m);
  }
  const memo = m;
  return { get: (k) => memo.get(k), set: (k, z) => void memo.set(k, z) };
}

function toPart(piece: Piece): ClickerPart {
  const mesh = piece.solid.getMesh();
  return {
    kind: piece.moving ? 'cap' : 'body',
    group: piece.moving ? 'top' : 'base',
    colorRgb: piece.color,
    name: piece.name,
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    // A model's top is not flat, so nothing here prints face-down: every moving piece stands on
    // the flat face the post's bottom sits on (switchKit rule 1).
    ...(piece.moving ? { printUpright: true } : {}),
  };
}
