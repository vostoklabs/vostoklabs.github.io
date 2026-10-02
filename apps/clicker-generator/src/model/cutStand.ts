// Stand: the model is not cut. It stands on a pressable plate, and the plate rides in a generated
// base — the image clicker's body: a well with the same slip fit, the same bezel, the plate 4 mm
// proud at rest and flush when pressed.
//
// This is the cutter that always works, whatever the model: too small, too thin, hollow, a logo,
// a figure on two ankles. It is PrintPal's "In a Box" and the "clicker adapter" genre that people
// glue figures onto today, made in one piece.
//
// The plate is filled solid down to the post's bottom (switchKit rule 1), unlike the image
// clicker's cap, which is a thin plate and a skirt printed face-down. A cap with a model on it
// prints upright, and a solid underside is a flat face on the bed instead of a long bridge.
import { csOf, extrude, ringsOf } from '@vostok/manifold';
import type { ModelCutParams } from './types';
import {
  HEAVY_TOP_GRAMS, MIN_WALL, SOCKET_FLOOR, SWITCH_CLEARANCE, buryIdentityVoidsPlan, gramsOf,
  movingPocket, place, postSolid, socketCutter, switchBody, type Scope, type SwitchKit, type SwitchPose,
} from './switchKit';
import { deepestPoint, sectionAt } from './section';
import type { CutOutput } from './buildModel';

type Wasm = any;
type Solid = any;
type Section = any;

/** Plate thickness over the pocket, mm: the image clicker's backing + image depth defaults. */
const PLATE = 2.3;
/** The base's wall round the well, mm: the image clicker's bezel. */
const BEZEL = 2.6;

export function cutStand(
  wasm: Wasm,
  sc: Scope,
  kit: SwitchKit,
  model: Solid,
  _size: [number, number, number],
  p: ModelCutParams,
): CutOutput {
  const warnings: string[] = [];
  const { CrossSection } = wasm;
  const tol = Math.max(0.1, p.tolerance);
  const margin = Math.max(0, p.stand.marginMm);

  // ---- The model, standing on its bottom (flattened, if it needed it, before it got here) ----
  const standing = model;

  // What touches the plate: the model's section just above its (trimmed) bottom. Two heights,
  // so a base that is not quite flat still reads as the base it is.
  let foot: Section = sc.keep(sectionAt(sc, standing, 0.3).add(sectionAt(sc, standing, 1.2)));
  if (foot.area() < 12) {
    const shadow = sc.keep(standing.project());
    warnings.push('The model barely touches the plate. Raise Flatten bottom so it stands on a flat face.');
    foot = shadow;
  }

  // ---- The plate ----
  // Smallest plate the switch can live under: the well must pass the switch's flange (it goes in
  // from above), and the plate's solid top must hold the pocket's upper band with a wall.
  const bands = kit.bands;
  const flange = Math.max(...bands.map((b) => b.half));
  const upper = Math.min(...bands.map((b) => b.half));
  const minRadius = Math.max(flange * Math.SQRT2 + 0.2 - tol, (upper + SWITCH_CLEARANCE) * Math.SQRT2 + MIN_WALL);
  const minSide = 2 * Math.max(flange + 0.1 - tol, upper + SWITCH_CLEARANCE + MIN_WALL);

  const fb = foot.bounds();
  const cx0 = (fb.min[0] + fb.max[0]) / 2;
  const cy0 = (fb.min[1] + fb.max[1]) / 2;
  let plate: Section;
  let cx = cx0;
  let cy = cy0;
  if (p.stand.shape === 'circle') {
    let reach = 0;
    for (const ring of ringsOf(foot)) {
      for (const [x, y] of ring) reach = Math.max(reach, Math.hypot(x - cx0, y - cy0));
    }
    const r = Math.max(minRadius, reach + margin);
    plate = sc.keep(sc.keep(CrossSection.circle(r, 128)).translate([cx0, cy0]));
  } else if (p.stand.shape === 'square') {
    const w = Math.max(minSide, fb.max[0] - fb.min[0] + 2 * margin);
    const h = Math.max(minSide, fb.max[1] - fb.min[1] + 2 * margin);
    const rr = Math.min(w, h) * 0.2;
    const core = sc.keep(CrossSection.square([Math.max(0.2, w - 2 * rr), Math.max(0.2, h - 2 * rr)], true));
    plate = sc.keep(sc.keep(core.offset(rr, 'Round', 2, 32)).translate([cx0, cy0]));
  } else {
    // Outline: the footprint grown by the margin, its notches closed and its holes filled — a
    // plate with a hole in it is not a plate — plus room for the switch at its deepest point.
    const grown = sc.keep(sc.keep(foot.offset(margin + 3, 'Round', 2, 32)).offset(-3, 'Round', 2, 32));
    const outers = ringsOf(grown).filter((r) => ringArea(r) > 0);
    let shape: Section = outers.length ? sc.keep(csOf(wasm, outers, 'NonZero')) : grown;
    const deep = deepestPoint(sc, shape) ?? { x: cx0, y: cy0, clearance: 0 };
    cx = deep.x;
    cy = deep.y;
    if (deep.clearance < minRadius) {
      shape = sc.keep(shape.add(sc.keep(sc.keep(CrossSection.circle(minRadius, 96)).translate([cx, cy]))));
    }
    plate = sc.keep(shape.simplify(0.02));
  }

  // ---- Heights, in S (plate plane 0) ----
  const plateTop = kit.postTop + PLATE; // the model stands here
  const rim = plateTop - Math.max(0, p.travel); // proud by the travel: flush when pressed
  const bottomS = kit.socketBottom - SOCKET_FLOOR;
  const pose: SwitchPose = {
    x: cx + p.switchNudge.x,
    y: cy + p.switchNudge.y,
    z: -plateTop,
    rotation: p.switchNudge.rotation,
  };
  const at = (cs: Section, z0: number, z1: number): Solid =>
    sc.keep(sc.keep(extrude(wasm, cs, Math.max(0.01, z1 - z0))).translate([0, 0, pose.z + z0]));

  // ---- The cap: solid plate down to the post's bottom, pocket cut, post added ----
  const post = postSolid(wasm, sc, kit, p.stemFitMm);
  if (!post.applied) warnings.push('Switch stem fit could not be applied. The stem prints as designed.');
  const cap = sc.keep(
    sc.keep(at(plate, kit.postBottom, plateTop).subtract(place(sc, movingPocket(wasm, sc, kit, p.travel), pose)))
      .add(place(sc, post.solid, pose)),
  );

  // ---- The base: bezel round a well, socket, identity voids ----
  const wellCs = sc.keep(plate.offset(tol, 'Round', 2, 32));
  const outerCs = sc.keep(wellCs.offset(BEZEL, 'Round', 2, 32));
  const block = at(outerCs, bottomS, rim);
  const well = at(wellCs, 0, rim + 1);
  const socket = place(sc, socketCutter(sc, kit, p.socketFitPct), pose);
  const clearance = place(sc, switchBody(wasm, sc, kit), pose);
  const marks = buryIdentityVoidsPlan(wasm, sc, block, kit, p.socketFitPct, pose);
  const body = sc.keep(block.subtract(sc.keep(wasm.Manifold.union([well, clearance, socket, ...marks.voids]))));
  if (marks.attempted > 0 && marks.voids.length < marks.attempted) {
    warnings.push(`Provenance: ${marks.voids.length} of ${marks.attempted} identity marks landed.`);
  }

  const grams = gramsOf(cap) + gramsOf(standing);
  if (grams > HEAVY_TOP_GRAMS) {
    warnings.push(
      `The model and plate weigh about ${grams.toFixed(0)} g — a light switch may not push them back up. `
      + 'Use a heavier switch, or make the model smaller.',
    );
  }

  return {
    pieces: [
      { solid: cap, name: 'top-base', moving: true, color: p.colors.top },
      { solid: standing, name: 'top-model', moving: true, color: p.colors.model },
      { solid: body, name: 'base-body', moving: false, color: p.colors.body },
    ],
    pose,
    warnings,
    cutHeight: null,
    cutRange: null,
    buttonAt: null,
    canHideSeam: false,
    hideSeam: false,
    movingGrams: grams,
  };
}

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
