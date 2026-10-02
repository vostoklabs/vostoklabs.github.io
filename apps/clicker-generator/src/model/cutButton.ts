// Button: a round or square button cut down into the top of the model. The rest of the model is
// the body, and it stays whole.
//
// Nobody ships this one (we found no example), so its rules come from the mechanism rather than
// from precedent:
//
//  - The switch goes in THROUGH THE BORE: the body is one piece, so the hole the button rides in
//    is the only way in. The bore has to pass the switch's flange, which is what sets the
//    smallest button — about 22 mm round, 19 mm square.
//  - Flush at rest by default. A figure with a button on its head should look like the figure,
//    not like a keycap glued to it; Raise lifts it for anyone who wants the other thing.
//  - Under the model's surface the button is solid down to the post's bottom, the same as every
//    moving piece here (switchKit rule 1), so it prints upright with the post on the bed.
import { extrude } from '@vostok/manifold';
import type { ModelCutParams } from './types';
import {
  HEAVY_TOP_GRAMS, MIN_WALL, SOCKET_FLOOR, buryIdentityVoidsPlan, gramsOf, movingPocket, place,
  postSolid, socketCutter, socketNeedMm, switchBody, type Scope, type SwitchKit, type SwitchPose,
} from './switchKit';
import { deepestPoint, overhangArea, sectionAt, squareAt, topSurface } from './section';
import type { CutOutput } from './buildModel';

type Wasm = any;
type Solid = any;
type Section = any;

/** Solid thickness of the button under the lowest point of its top, mm. */
export const BUTTON_ROOF = 2.5;
/** Smallest button that passes the switch through its bore, by shape, mm. Worked out from the MX
 *  flange (15.66 mm square) and the default 0.4 mm fit; `buttonMinMm` recomputes it from the
 *  asset for the build, and the UI's slider floor is this. */
export const BUTTON_MIN = { round: 22, square: 19 } as const;

/** The button's outline, centred at (x, y), turned with the switch. */
export function buttonOutline(wasm: Wasm, sc: Scope, shape: 'round' | 'square', size: number, x: number, y: number, rotation: number): Section {
  const { CrossSection } = wasm;
  let cs: Section;
  if (shape === 'round') {
    cs = sc.keep(CrossSection.circle(size / 2, 96));
  } else {
    const rr = size * 0.18;
    const core = sc.keep(CrossSection.square([size - 2 * rr, size - 2 * rr], true));
    cs = sc.keep(core.offset(rr, 'Round', 2, 32));
    if (Math.abs(rotation) > 1e-6) cs = sc.keep(cs.rotate(rotation));
  }
  return sc.keep(cs.translate([x, y]));
}

/** The smallest button of this shape whose bore passes the switch's flange. */
export function buttonMinMm(wasm: Wasm, sc: Scope, kit: SwitchKit, shape: 'round' | 'square', tol: number): number {
  const flange = Math.max(...kit.bands.map((b) => b.half));
  const sq = squareAt(wasm, sc, 2 * flange + 0.2, 0, 0, 0);
  let lo = 8;
  let hi = 40;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const bore = sc.keep(buttonOutline(wasm, sc, shape, mid, 0, 0, 0).offset(tol, 'Round', 2, 32));
    if (overhangArea(sc, sq, bore) < 0.01) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

export function cutButton(
  wasm: Wasm,
  sc: Scope,
  kit: SwitchKit,
  model: Solid,
  size: [number, number, number],
  p: ModelCutParams,
): CutOutput {
  const warnings: string[] = [];
  const H = size[2];
  const tol = Math.max(0.1, p.tolerance);
  const shape = p.button.shape;
  const rotation = p.switchNudge.rotation;

  const minD = buttonMinMm(wasm, sc, kit, shape, tol);
  let D = p.button.sizeMm;
  if (D < minD) {
    D = minD;
    warnings.push(`A ${shape} button starts at ${minD} mm — the switch goes in through its hole.`);
  }

  // Where: wherever the user clicked, else the deepest point just under the model's top.
  let bx = p.button.x;
  let by = p.button.y;
  if (bx === null || by === null) {
    const d = deepestPoint(sc, sectionAt(sc, model, Math.max(0.5, H - 3)));
    bx = d?.x ?? 0;
    by = d?.y ?? 0;
  }
  const outline = buttonOutline(wasm, sc, shape, D, bx, by, rotation);

  // The model's top under the button: rays from above at the centre and three rings round it.
  const pts: [number, number][] = [[bx, by]];
  for (const f of [0.35, 0.7, 0.96]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push([bx + Math.cos(a) * f * (D / 2), by + Math.sin(a) * f * (D / 2)]);
    }
  }
  const tops = topSurface(model, pts, H + 5, -5);
  const hit = tops.filter((z): z is number => z !== null);
  const failed = (text: string): CutOutput => {
    warnings.push(text);
    return {
      pieces: [{ solid: model, name: 'base-body', moving: false, color: p.colors.body }],
      pose: { x: bx!, y: by!, z: 0, rotation },
      warnings,
      cutHeight: null,
      cutRange: null,
      buttonAt: { x: bx!, y: by! },
      canHideSeam: false,
      hideSeam: false,
      movingGrams: 0,
    };
  };
  if (!hit.length) return failed('The button is off the model. Click the model where it should go.');
  if (hit.length < tops.length) warnings.push('The button hangs over the edge of the model. Move it in.');
  const zMin = Math.min(...hit);

  const raise = Math.min(Math.max(0, p.button.raiseMm), Math.max(0, p.travel));
  const roofBottom = zMin - BUTTON_ROOF;
  const pose: SwitchPose = { x: bx, y: by, z: roofBottom + raise - kit.postTop, rotation };
  const at = (cs: Section, z0: number, z1: number): Solid =>
    sc.keep(sc.keep(extrude(wasm, cs, Math.max(0.01, z1 - z0))).translate([0, 0, z0]));

  // ---- The button: the model's own material inside the outline, from the roof's underside up ----
  const column: Solid = sc.keep(model.intersect(at(outline, roofBottom, H + 2)));
  // Keep the piece that starts at the roof; anything else inside the outline is model that sits
  // ABOVE the button without touching it (a hat brim over a face) — it cannot ride on the button,
  // and the bore takes it away.
  const parts: Solid[] = column.decompose().map((q: Solid) => sc.keep(q));
  let core: Solid = column;
  let dropped = 0;
  if (parts.length > 1) {
    let best = -1;
    for (const q of parts) {
      if (q.boundingBox().min[2] > roofBottom + 0.3) continue;
      const v = q.volume();
      if (v > best) {
        best = v;
        core = q;
      }
    }
    for (const q of parts) if (q !== core) dropped += q.volume();
  }
  if (dropped > 0.05 * core.volume() + 5) {
    warnings.push('Part of the model above the button is cut away with it. Move the button, or make it smaller.');
  }
  if (core.volume() < 0.4 * outline.area() * Math.max(0.5, zMin - roofBottom)) {
    warnings.push('The model looks hollow under the button, so the button is thin. Use Slice or Stand.');
  }

  const post = postSolid(wasm, sc, kit, p.stemFitMm);
  if (!post.applied) warnings.push('Switch stem fit could not be applied. The stem prints as designed.');
  const fill = at(outline, roofBottom - (kit.postTop - kit.postBottom), roofBottom + 0.05);
  const button = sc.keep(
    sc.keep(
      sc.keep(sc.keep(core.add(fill)).translate([0, 0, raise]))
        .subtract(place(sc, movingPocket(wasm, sc, kit, p.travel), pose)),
    ).add(place(sc, post.solid, pose)),
  );

  // ---- The body: the model less the bore, the switch's room, the socket and the voids ----
  const boreCs = sc.keep(outline.offset(tol, 'Round', 2, 32));
  const bore = at(boreCs, pose.z - 0.05, H + 2);
  const clearance = place(sc, switchBody(wasm, sc, kit), pose);
  const socket = place(sc, socketCutter(sc, kit, p.socketFitPct), pose);
  const marks = buryIdentityVoidsPlan(wasm, sc, model, kit, p.socketFitPct, pose);
  const body = sc.keep(model.subtract(sc.keep(wasm.Manifold.union([bore, clearance, socket, ...marks.voids]))));

  // ---- Checks ----
  const wall = sc.keep(boreCs.offset(MIN_WALL, 'Round', 2, 32));
  const wallShort = Math.max(
    overhangArea(sc, wall, sectionAt(sc, model, pose.z + 0.05)),
    overhangArea(sc, wall, sectionAt(sc, model, (pose.z + zMin) / 2)),
  );
  if (wallShort > 2) {
    warnings.push('The model is too thin round the button — the hole would break through. Move it in or make it smaller.');
  }
  const below = -kit.socketBottom + SOCKET_FLOOR;
  const socketSq = squareAt(wasm, sc, socketNeedMm(kit, p.socketFitPct), pose.x, pose.y, pose.rotation);
  const socketShort = Math.max(
    overhangArea(sc, socketSq, sectionAt(sc, model, pose.z - 0.05)),
    overhangArea(sc, socketSq, sectionAt(sc, model, pose.z + kit.socketBottom / 2)),
    overhangArea(sc, socketSq, sectionAt(sc, model, pose.z - below + 0.05)),
  );
  if (socketShort > 2) {
    const need = zMin - (pose.z - below);
    warnings.push(
      `The model is not deep enough under the button — the switch needs about ${need.toFixed(0)} mm. `
      + 'Make the model bigger, or use Slice or Stand.',
    );
  }
  if (marks.attempted > 0 && marks.voids.length < marks.attempted) {
    warnings.push(`Provenance: ${marks.voids.length} of ${marks.attempted} identity marks landed.`);
  }
  const grams = gramsOf(button);
  if (grams > HEAVY_TOP_GRAMS) {
    warnings.push(`The button weighs about ${grams.toFixed(0)} g — a light switch may not push it back up.`);
  }

  return {
    pieces: [
      { solid: button, name: 'top-button', moving: true, color: p.colors.top },
      { solid: body, name: 'base-body', moving: false, color: p.colors.body },
    ],
    pose,
    warnings,
    cutHeight: null,
    cutRange: null,
    buttonAt: { x: bx, y: by },
    canHideSeam: false,
    hideSeam: false,
    movingGrams: grams,
  };
}
