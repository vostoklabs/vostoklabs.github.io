// The switch, as every Model-mode cutter needs it.
//
// All three cutters build their switch parts in one frame, S: origin on the switch axis at the
// plate plane (the socket's top face), +Z up. The MX assets already live there — the worker's
// `init` normalises them into it — so the socket's and the post's numbers are MEASURED off those
// assets rather than written down. The image clicker's buildClicker reads the same bounding boxes;
// a second copy of "9.99" or "15.54" typed in here would agree today and drift the first time the
// socket or the stem is re-cut. The switch itself is the other way round: nothing is cut from it,
// so its sizes are written down (`MX_BANDS`, and `MX_SEAT` in geometry/blockKeycaps), and the
// switch model the preview draws is a picture only.
//
// Three rules follow from the frame, and every cutter keeps them:
//  1. The moving piece's lowest plane is the post's bottom, so the moving piece prints upright
//     on a flat face with the post standing on the bed — no support under the mechanism.
//  2. The moving piece carries the switch pocket: the switch's own envelope, swept up by the
//     travel, so nothing can touch the switch anywhere in the press.
//  3. The static piece carries the socket and the identity voids around it.
import { getMarkSeed, hardcodedVoids, markVoids } from '../geometry/identityMark';
import { applyStemFit } from '../geometry/stemFit';
import { sphereBuried } from './section';

type Wasm = any;
type Solid = any;

/** One height band of the switch's outer envelope: a square of half-side `half`, from `z0`
 *  to `z1` in S. No clearance added. */
export interface EnvelopeBand {
  z0: number;
  z1: number;
  half: number;
}

export interface SwitchKit {
  /** The cached socket cutter and keycap post, in S. Owned by the worker: never freed here. */
  socket: Solid;
  stem: Solid;
  /** Pocket floor (negative) and footprint of the socket as authored. */
  socketBottom: number;
  socketDim: number;
  /** Post bottom (the moving piece's lowest plane) and top, where the post really rests on the
   *  switch at rest — on the slider, `seatPost` — not where the asset was drawn. */
  postBottom: number;
  postTop: number;
  /** The switch above the plate (`MX_BANDS`). */
  bands: readonly EnvelopeBand[];
}

/** Clearance between the switch and anything the moving piece carries, per side, mm. */
export const SWITCH_CLEARANCE = 0.4;
/** Thinnest wall the checks accept around a pocket or bore, mm. CLAUDE.md's printability floor
 *  for handled parts is 1.2–1.5; a pocket wall is the thing that splits, so the checks use the
 *  top of the range for a warning and never go below the bottom of it for geometry. */
export const MIN_WALL = 1.2;
/** Solid floor under the socket, mm — the image clicker's `floorThickness`. */
export const SOCKET_FLOOR = 1.6;

/**
 * The MX switch above the plate, in S: the flange, its chamfered edge, the housing step and the
 * upper housing, each a square of half-side `half`. Written down, not read off the switch model
 * the preview draws, so that model can be anything (a lighter one changes nothing that prints).
 * Noted from the detailed MX model on 2026-11-17, to the thousandth of a millimetre.
 */
export const MX_BANDS: readonly EnvelopeBand[] = [
  { z0: 0, z1: 1.1, half: 7.834 },
  { z0: 1.1, z1: 1.2, half: 7.713 },
  { z0: 1.2, z1: 2.6, half: 7.384 },
  { z0: 2.6, z1: 6.2, half: 6.764 },
];

/** The keycap post raised onto its real seat — a new solid, which the caller owns. Never lowered:
 *  a post already clear of the slider stays where it was drawn. */
export function seatPost(stem: Solid, seat: number): Solid {
  const lift = Math.max(0, seat - stem.boundingBox().min[2]);
  return stem.translate([0, 0, lift]);
}

export function makeSwitchKit(socket: Solid, stem: Solid): SwitchKit {
  const sbb = socket.boundingBox();
  const tbb = stem.boundingBox();
  return {
    socket,
    stem,
    socketBottom: sbb.min[2],
    socketDim: Math.max(sbb.max[0] - sbb.min[0], sbb.max[1] - sbb.min[1]),
    postBottom: tbb.min[2],
    postTop: tbb.max[2],
    bands: MX_BANDS,
  };
}

/** A tracker: everything built in a build goes through `keep`, and `free` releases it all,
 *  even after a throw. Manifold's heap never shrinks; a missed delete is a slow leak that lasts
 *  until the tab is closed. */
export interface Scope {
  keep<T extends { delete(): void }>(o: T): T;
  free(): void;
}

export function scope(): Scope {
  const made: { delete(): void }[] = [];
  return {
    keep(o) {
      made.push(o);
      return o;
    },
    free() {
      for (const o of made) {
        try {
          o.delete();
        } catch {
          /* already freed */
        }
      }
      made.length = 0;
    },
  };
}

/** Where the switch sits: its axis at (x, y), the plate plane at z, turned `rotation` degrees
 *  about Z. Every S-frame solid goes through `place` to land in the model. */
export interface SwitchPose {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export function place(sc: Scope, solid: Solid, pose: SwitchPose): Solid {
  const turned = Math.abs(pose.rotation) > 1e-6 ? sc.keep(solid.rotate([0, 0, pose.rotation])) : solid;
  return sc.keep(turned.translate([pose.x, pose.y, pose.z]));
}

/** An axis-aligned square prism in S, `side` wide, from `z0` to `z1`. */
export function squarePrism(wasm: Wasm, sc: Scope, side: number, z0: number, z1: number): Solid {
  const cube = sc.keep(wasm.Manifold.cube([side, side, Math.max(0.01, z1 - z0)], true));
  return sc.keep(cube.translate([0, 0, (z0 + z1) / 2]));
}

/** The socket cutter with the pocket fit applied, in S. Scaling the cutter IS scaling the
 *  pocket; Z is never touched — the same rule as buildClicker. */
export function socketCutter(sc: Scope, kit: SwitchKit, fitPct: number): Solid {
  if (!(Math.abs(fitPct) > 0.01)) return kit.socket;
  const k = 1 + fitPct / 100;
  return sc.keep(kit.socket.scale([k, k, 1]));
}

/** The keycap post with the stem fit applied, in S. */
export function postSolid(wasm: Wasm, sc: Scope, kit: SwitchKit, stemFitMm: number, stemOuterMm = 0): { solid: Solid; applied: boolean } {
  const fit = applyStemFit(wasm, kit.stem, stemFitMm, stemOuterMm);
  return { solid: sc.keep(fit.solid), applied: fit.applied };
}

/**
 * The room the moving piece must leave the switch, at rest, in S: every band of the switch's
 * envelope grown by the clearance and swept UP by the travel (the piece moves down onto the
 * switch; relative to the piece, the switch moves up). Stops at the end of the travel, or at the
 * post's top if that comes first — with the post on its real seat, the travel does.
 *
 * Starts `below` under the moving piece's lowest plane so the cut is clean, never coplanar.
 */
export function movingPocket(wasm: Wasm, sc: Scope, kit: SwitchKit, travel: number, below = 1): Solid {
  const floor = kit.postBottom - below;
  const parts: Solid[] = [];
  for (const b of kit.bands) {
    const top = Math.min(kit.postTop, b.z1 + travel);
    if (top <= floor) continue;
    parts.push(squarePrism(wasm, sc, 2 * (b.half + SWITCH_CLEARANCE), floor, top));
  }
  return parts.length ? sc.keep(wasm.Manifold.union(parts)) : squarePrism(wasm, sc, 16, floor, kit.postTop);
}

/** The switch body above the plate, grown by the clearance, in S — what a static piece with a
 *  bore or a well must not have material in. Starts just under the plate so it cuts cleanly. */
export function switchBody(wasm: Wasm, sc: Scope, kit: SwitchKit): Solid {
  const parts = kit.bands.map((b) =>
    squarePrism(wasm, sc, 2 * (b.half + SWITCH_CLEARANCE), b.z0 === 0 ? -0.05 : b.z0, b.z1),
  );
  return sc.keep(wasm.Manifold.union(parts));
}

/** Side of the square the moving piece needs at its lowest plane: the widest band of the
 *  pocket plus a wall each side. */
export function pocketNeedMm(kit: SwitchKit): number {
  const widest = Math.max(...kit.bands.map((b) => b.half));
  return 2 * (widest + SWITCH_CLEARANCE + MIN_WALL);
}

/** Side of the square the static piece needs round the socket. */
export function socketNeedMm(kit: SwitchKit, fitPct: number): number {
  return kit.socketDim * (1 + fitPct / 100) + 2 * MIN_WALL;
}

/**
 * The identity voids round the socket that the static piece can bury — the image clicker's two
 * tiers (a secret constellation when the build has a seed, and the hardcoded one always), at the
 * same radii and depths relative to the switch, turned with it. A void is only kept if the piece
 * contains all of it: one breaking a surface would show on a print, and invariant #2 says the
 * mark never does. What did not land is counted, never silent.
 *
 * Returned rather than subtracted, so the caller cuts them in the same boolean as the socket —
 * against an uploaded model every separate boolean is a full copy of it. The buried test is the
 * ray test in section.ts for the same reason, asked of `body` BEFORE the socket is cut: the socket
 * is the one cavity near the voids, and `clearR` already keeps every void clear of it.
 *
 * `clearR` is buildClicker's `voidClearR`, not a new rule: the pocket is a square, so its boundary
 * is further out off-axis, and a void is pushed out only as far as that bearing needs.
 */
export function buryIdentityVoidsPlan(
  wasm: Wasm,
  sc: Scope,
  body: Solid,
  kit: SwitchKit,
  fitPct: number,
  pose: SwitchPose,
): { voids: Solid[]; attempted: number } {
  const half = (kit.socketDim * (1 + fitPct / 100)) / 2;
  const clearR = (d: number, theta: number): number =>
    half / Math.max(Math.abs(Math.cos(theta)), Math.abs(Math.sin(theta)), 1e-6) + d / 2 + 0.15;
  const seed = getMarkSeed();
  const marks = [...(seed ? markVoids(seed) : []), ...hardcodedVoids()];
  const rot = (pose.rotation * Math.PI) / 180;
  const voids: Solid[] = [];
  for (const v of marks) {
    const theta = (v.thetaDeg * Math.PI) / 180;
    const r = Math.max(v.r, clearR(v.d, theta));
    const a = theta + rot;
    const cx = pose.x + r * Math.cos(a);
    const cy = pose.y + r * Math.sin(a);
    const cz = pose.z + v.z;
    if (!sphereBuried(body, cx, cy, cz, v.d / 2)) continue;
    voids.push(sc.keep(sc.keep(wasm.Manifold.sphere(v.d / 2, 16)).translate([cx, cy, cz])));
  }
  return { voids, attempted: marks.length };
}

/** Rough print weight of a solid, grams, the way a slicer's defaults would print it: PLA at
 *  1.24 g/cm³, a millimetre of solid skin all round (two walls plus top and bottom layers) and
 *  15 % infill inside it. Only ever compared with a threshold, so it needs to be the right size,
 *  not exact — a flat "half full" guess called a 60 mm ball 70 g when it prints at about 33. */
export function gramsOf(solid: Solid): number {
  const v = solid.volume();
  const skin = Math.min(v, solid.surfaceArea() * 1.0);
  return ((skin + (v - skin) * 0.15) / 1000) * 1.24;
}

/** Past this the moving piece is heavy enough that a light MX spring (about 35 g of force at
 *  rest) may not lift it back — the popular clickers are 5–20 g all in, base included. */
export const HEAVY_TOP_GRAMS = 25;
