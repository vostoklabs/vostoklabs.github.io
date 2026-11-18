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
import { buttonCount, MAX_BUTTONS, type ModelCutParams } from './types';
import {
  HEAVY_TOP_GRAMS, MIN_WALL, SOCKET_FLOOR, buryIdentityVoidsPlan, gramsOf, movingPocket, place,
  postSolid, socketCutter, socketNeedMm, switchBody, type Scope, type SwitchKit, type SwitchPose,
} from './switchKit';
import { deepestPoint, overhangArea, sectionAt, spreadSpots, squareAt, topSurface } from './section';
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

  // Where: wherever the user clicked, else the deepest point just under the model's top. Several
  // share the top out along its longest side, so the first does not take the middle of it.
  const topSection = sectionAt(sc, model, Math.max(0.5, H - 3));
  const count = buttonCount(p);
  const spread = count > 1 ? spreadSpots(wasm, sc, topSection, count) : [];
  let bx = p.button.x;
  let by = p.button.y;
  if (bx === null || by === null) {
    const d = count > 1 ? spread[0] : deepestPoint(sc, topSection);
    bx = d?.x ?? 0;
    by = d?.y ?? 0;
  }
  const firstAt = { x: bx, y: by, rotation };

  // Centre to centre: two bores, and a wall between them.
  const pitch = D + 2 * tol + 2 * MIN_WALL;
  const centres: { x: number; y: number; rotation: number }[] = [firstAt];
  if (count > 1) {
    // What is left for a centre: inside the model by a button and its wall, clear of the others.
    let room: Section = sc.keep(topSection.offset(-(D / 2 + tol + MIN_WALL), 'Round', 2, 16));
    const keepOut = (c: { x: number; y: number }) => {
      room = sc.keep(room.subtract(sc.keep(sc.keep(wasm.CrossSection.circle(pitch, 48)).translate([c.x, c.y]))));
    };
    const roomAt = (c: { x: number; y: number }) =>
      !sc.keep(room.intersect(squareAt(wasm, sc, 0.2, c.x, c.y, 0))).isEmpty();
    keepOut(firstAt);
    for (let i = 1; i < count; i++) {
      const e = p.more?.[i - 1];
      let at: { x: number; y: number } | null = null;
      if (e && e.x !== null && e.y !== null) at = { x: e.x, y: e.y };
      else if (spread[i] && roomAt(spread[i])) at = spread[i];
      else {
        const d = room.isEmpty() ? null : deepestPoint(sc, room);
        if (d) at = { x: d.x, y: d.y };
      }
      if (!at) {
        warnings.push(`There is only room for ${centres.length} ${centres.length === 1 ? 'button' : 'buttons'} here. Make the model bigger or the buttons smaller.`);
        break;
      }
      centres.push({ ...at, rotation: e?.rotation ?? 0 });
      keepOut(at);
    }
  }
  const warnOnce = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };

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
  const at = (cs: Section, z0: number, z1: number): Solid =>
    sc.keep(sc.keep(extrude(wasm, cs, Math.max(0.01, z1 - z0))).translate([0, 0, z0]));

  const raise = Math.min(Math.max(0, p.button.raiseMm), Math.max(0, p.travel));
  const post = postSolid(wasm, sc, kit, p.stemFitMm, p.stemOuterMm);
  if (!post.applied) warnings.push('Switch stem fit could not be applied. The stem prints as designed.');

  const buttons: Solid[] = [];
  const poses: SwitchPose[] = [];
  const placed: { x: number; y: number }[] = [];
  const cuts: Solid[] = [];
  let voids: Solid[] = [];
  let attempted = 0;

  for (const c of centres) {
    const first = c === firstAt;
    const outline = buttonOutline(wasm, sc, shape, D, c.x, c.y, c.rotation);

    // The model's top under the button: rays from above at the centre and three rings round it.
    const pts: [number, number][] = [[c.x, c.y]];
    for (const f of [0.35, 0.7, 0.96]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push([c.x + Math.cos(a) * f * (D / 2), c.y + Math.sin(a) * f * (D / 2)]);
      }
    }
    const tops = topSurface(model, pts, H + 5, -5);
    const hit = tops.filter((z): z is number => z !== null);
    if (!hit.length) {
      if (first) return failed('The button is off the model. Click the model where it should go.');
      warnOnce('A button is off the model. Click the model where it should go.');
      continue;
    }
    if (hit.length < tops.length) warnOnce('The button hangs over the edge of the model. Move it in.');
    const zMin = Math.min(...hit);

    const roofBottom = zMin - BUTTON_ROOF;
    const pose: SwitchPose = { x: c.x, y: c.y, z: roofBottom + raise - kit.postTop, rotation: c.rotation };

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
      warnOnce('Part of the model above the button is cut away with it. Move the button, or make it smaller.');
    }
    if (core.volume() < 0.4 * outline.area() * Math.max(0.5, zMin - roofBottom)) {
      warnOnce('The model looks hollow under the button, so the button is thin. Use Slice or Stand.');
    }

    const fill = at(outline, roofBottom - (kit.postTop - kit.postBottom), roofBottom + 0.05);
    buttons.push(sc.keep(
      sc.keep(
        sc.keep(sc.keep(core.add(fill)).translate([0, 0, raise]))
          .subtract(place(sc, movingPocket(wasm, sc, kit, p.travel), pose)),
      ).add(place(sc, post.solid, pose)),
    ));

    // ---- What the body loses for it: the bore, the switch's room, the socket ----
    const boreCs = sc.keep(outline.offset(tol, 'Round', 2, 32));
    cuts.push(
      at(boreCs, pose.z - 0.05, H + 2),
      place(sc, switchBody(wasm, sc, kit), pose),
      place(sc, socketCutter(sc, kit, p.socketFitPct), pose),
    );
    // One mark, round the first switch.
    if (first) {
      const marks = buryIdentityVoidsPlan(wasm, sc, model, kit, p.socketFitPct, pose);
      voids = marks.voids;
      attempted = marks.attempted;
    }

    // ---- Checks ----
    const wall = sc.keep(boreCs.offset(MIN_WALL, 'Round', 2, 32));
    const wallShort = Math.max(
      overhangArea(sc, wall, sectionAt(sc, model, pose.z + 0.05)),
      overhangArea(sc, wall, sectionAt(sc, model, (pose.z + zMin) / 2)),
    );
    if (wallShort > 2) {
      warnOnce('The model is too thin round the button — the hole would break through. Move it in or make it smaller.');
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
      warnOnce(
        `The model is not deep enough under the button — the switch needs about ${need.toFixed(0)} mm. `
        + 'Make the model bigger, or use Slice or Stand.',
      );
    }
    poses.push(pose);
    placed.push({ x: c.x, y: c.y });
  }

  // ---- The body: the model less everything each button needs, in one boolean ----
  const body = sc.keep(model.subtract(sc.keep(wasm.Manifold.union([...cuts, ...voids]))));

  if (attempted > 0 && voids.length < attempted) {
    warnings.push(`Provenance: ${voids.length} of ${attempted} identity marks landed.`);
  }
  if (placed.some((a, i) => placed.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < pitch - 0.01))) {
    warnings.push('The buttons are too close together. Move one, or make them smaller.');
  }
  const grams = Math.max(...buttons.map((b) => gramsOf(b)));
  if (grams > HEAVY_TOP_GRAMS) {
    warnings.push(`The button weighs about ${grams.toFixed(0)} g — a light switch may not push it back up.`);
  }

  const bounds = topSection.isEmpty() ? null : topSection.bounds();
  const span = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) : 0;

  return {
    pieces: [
      ...buttons.map((solid, i) => ({
        solid,
        name: i === 0 ? 'top-button' : `top-button-${i + 1}`,
        moving: true,
        color: p.colors.top,
        ...(buttons.length > 1 ? { objectKey: `button-${i + 1}` } : {}),
      })),
      { solid: body, name: 'base-body', moving: false, color: p.colors.body },
    ],
    pose: poses[0],
    poses,
    buttonsAt: placed,
    maxButtons: Math.max(1, Math.min(MAX_BUTTONS, Math.floor(span / pitch))),
    warnings,
    cutHeight: null,
    cutRange: null,
    buttonAt: { x: bx, y: by },
    canHideSeam: false,
    hideSeam: false,
    movingGrams: grams,
  };
}
