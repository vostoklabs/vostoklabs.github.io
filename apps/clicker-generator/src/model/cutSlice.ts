// Slice: one horizontal cut. Everything above it is the button.
//
// This is what nearly every popular MX clicker is when it is made by hand — the Pokeball, the
// Skull/Brain, the Cheese — so it is the default cutter.
//
// Pressed, the model is whole again: the top is LIFTED by the post's bottom height rather than
// having a slab cut out of the model, so no part of the design is lost to the mechanism. At rest
// the gap is that lift (4.35 mm); the press closes it to 0.35.
//
// Hide the gap ("Hide the seam" until 2026-10-01) is the same cut routed through a
// collar: the bottom keeps its own skin for COLLAR mm above the switch, and the top grows a pillar
// that slides inside it. The seam moves up to the collar's rim, and at rest it is a groove showing
// the pillar instead of a gap showing the switch. The collar also guides the top, so it cannot
// wobble on the stem. On by default (Ian, 2026-10-01), so it is built wherever it fits and the cut
// is a plain gap where it does not.
import { extrude } from '@vostok/manifold';
import type { ModelCutParams } from './types';
import {
  HEAVY_TOP_GRAMS, MIN_WALL, SOCKET_FLOOR, SWITCH_CLEARANCE, buryIdentityVoidsPlan, gramsOf,
  movingPocket, place, pocketNeedMm, postSolid, socketCutter, socketNeedMm,
  type Scope, type SwitchKit, type SwitchPose,
} from './switchKit';
import { commonSection, deepestPoint, overhangArea, sectionAt, squareAt } from './section';
import type { CutOutput } from './buildModel';

type Wasm = any;
type Solid = any;
type Section = any;

/** How far the bottom's skin rises round the pillar when the seam is hidden, mm. The pillar
 *  rides 4.35 mm up at rest, so 8 keeps 3.65 mm of it inside the collar even then. */
export const COLLAR = 8;
/** The collar's wall, mm. The model's own surface is its outside, so this is the thinnest it
 *  gets — 1.6 is the image clicker's floor and bezel minimum, for the same reason. */
export const SKIN = 1.6;

/** What a seam height implies: where the plate plane is, and — for a hidden seam — the collar's
 *  inside and the pillar that slides in it. */
interface SliceGeometry {
  plate: number;
  /** Where the switch axis may go: the model has material round it at every height it needs. */
  region: Section;
  inner: Section | null;
  pillar: Section | null;
}

function sliceGeometry(sc: Scope, model: Solid, kit: SwitchKit, seam: number, hide: boolean, tol: number): SliceGeometry {
  const pocketTop = kit.postTop - kit.postBottom;
  const below = -kit.socketBottom + SOCKET_FLOOR;
  if (!hide) {
    const region = commonSection(sc, model, [
      seam - below + 0.05, seam - 0.05, seam + 0.05, seam + pocketTop - 0.05,
    ]);
    return { plate: seam, region, inner: null, pillar: null };
  }
  const plate = seam - COLLAR;
  // The collar's outside is the model's surface, which can lean in or out across the band; the
  // smallest section over it is what the wall is measured from, so it is never thinner than SKIN.
  const band = commonSection(sc, model, [plate + 0.05, plate + COLLAR / 2, seam - 0.05]);
  const inner = band.isEmpty() ? band : sc.keep(band.offset(-SKIN, 'Round', 2, 16));
  const pillar = inner.isEmpty() ? inner : sc.keep(inner.offset(-tol, 'Round', 2, 16));
  const socketRegion = commonSection(sc, model, [plate - below + 0.05, plate - 0.05]);
  const region = pillar.isEmpty() ? pillar : sc.keep(pillar.intersect(socketRegion));
  return { plate, region, inner, pillar };
}

/**
 * How badly the switch fails to fit with its axis at (x, y), mm² of square outside the material
 * it needs, worst height first reported. 0 = it fits with a wall everywhere.
 *
 * The one test behind both the automatic cut height and the warnings, so the build can never
 * pick a height it will then complain about. Squares, not circles: the socket and pocket are
 * square, and a round test passes a square whose corners break out (the mushroom's stem did).
 */
function misfit(
  wasm: Wasm, sc: Scope, model: Solid, kit: SwitchKit, seam: number, g: SliceGeometry,
  x: number, y: number, rotation: number, fitPct: number,
): { socket: number; pocket: number } {
  const below = -kit.socketBottom + SOCKET_FLOOR;
  const sq = (side: number) => squareAt(wasm, sc, side, x, y, rotation);
  const socketSq = sq(socketNeedMm(kit, fitPct));
  const socket = Math.max(
    overhangArea(sc, socketSq, sectionAt(sc, model, g.plate - 0.05)),
    overhangArea(sc, socketSq, sectionAt(sc, model, g.plate + kit.socketBottom / 2)),
    overhangArea(sc, socketSq, sectionAt(sc, model, g.plate - below + 0.05)),
  );
  const widest = sq(pocketNeedMm(kit));
  let pocket: number;
  if (g.pillar) {
    pocket = overhangArea(sc, widest, g.pillar);
  } else {
    const pocketTop = kit.postTop - kit.postBottom;
    const upperSide = 2 * (Math.min(...kit.bands.map((b) => b.half)) + SWITCH_CLEARANCE + MIN_WALL);
    pocket = Math.max(
      overhangArea(sc, widest, sectionAt(sc, model, seam + 0.05)),
      overhangArea(sc, sq(upperSide), sectionAt(sc, model, seam + pocketTop - 0.05)),
    );
  }
  return { socket, pocket };
}

/** A misfit smaller than this is curvature, not a hole — a square against a curved wall always
 *  grazes it by a sliver. */
const MISFIT_OK = 2;

/** Pick a seam, in this order of importance: the switch fits; the cut goes through the model in
 *  ONE place (a cut through a figure's two raised arms as well as its body leaves the arms' ends
 *  loose above it); it is nearest 55 % of the height. Failing the first, the least-bad fit. */
function autoSeam(
  wasm: Wasm, sc: Scope, model: Solid, kit: SwitchKit, H: number, lo: number, hi: number,
  hide: boolean, tol: number, p: ModelCutParams,
): number {
  if (!(hi > lo)) return (lo + hi) / 2;
  const target = 0.55 * H;
  type Score = { z: number; bad: number; islands: number; dist: number };
  const better = (a: Score, b: Score) =>
    a.bad !== b.bad ? a.bad < b.bad : a.islands !== b.islands ? a.islands < b.islands : a.dist < b.dist;
  let best: Score | null = null;
  for (let f = 0.3; f <= 0.8001; f += 0.05) {
    const z = Math.min(hi, Math.max(lo, f * H));
    const g = sliceGeometry(sc, model, kit, z, hide, tol);
    const d = deepestPoint(sc, g.region, 9);
    if (!d) continue;
    const m = misfit(wasm, sc, model, kit, z, g, d.x, d.y, p.switchNudge.rotation, p.socketFitPct);
    const pieces: Section[] = sectionAt(sc, model, z).decompose();
    const islands = pieces.length;
    for (const q of pieces) q.delete();
    const score: Score = { z, bad: Math.max(0, m.socket + m.pocket - MISFIT_OK), islands, dist: Math.abs(z - target) };
    if (!best || better(score, best)) best = score;
  }
  return best?.z ?? (lo + hi) / 2;
}

/** Remembers automatic seam heights between builds: see `buildModelClicker`. */
export interface SeamMemo {
  get(key: string): number | undefined;
  set(key: string, z: number): void;
}

export function cutSlice(
  wasm: Wasm,
  sc: Scope,
  kit: SwitchKit,
  model: Solid,
  size: [number, number, number],
  p: ModelCutParams,
  memo?: SeamMemo,
): CutOutput {
  const warnings: string[] = [];
  const H = size[2];
  const tol = Math.max(0.1, p.tolerance);
  const lift = kit.postBottom;
  const pocketTop = kit.postTop - lift;
  const below = -kit.socketBottom + SOCKET_FLOOR;

  // A seam the switch can physically have: the socket needs `below` under the plate, the pocket
  // needs `pocketTop` (+ a millimetre of roof) over the seam. A hidden seam also needs the collar
  // under it — but only the automatic search keeps to that: the slider spans every height a
  // plain cut fits at, and the gap is hidden wherever the collar fits too (below).
  const range = (hide: boolean) => ({ lo: below + (hide ? COLLAR : 0), hi: H - pocketTop - 1 });
  const { lo, hi } = range(false);
  if (lo > hi) {
    warnings.push(
      `This model is only ${H.toFixed(0)} mm tall — too short to split round a switch. `
      + 'Make it bigger under Model, or use Stand.',
    );
  }

  /* Whether the gap can be hidden at a seam: room for the collar under it, and the switch still
     fitting inside it. Hide the gap is on by default, so it is a preference, not an order: where
     the collar would leave the walls round the switch too thin and a plain cut would not, the
     cut is plain — quietly, because the toggle hides with it (hidden, not greyed). Where a plain
     cut would not fit either, the collar is no worse, and the warnings say what is wrong. */
  const fitsAt = (z: number, geo: SliceGeometry, at: { x: number; y: number }) => {
    const m = misfit(wasm, sc, model, kit, z, geo, at.x + p.switchNudge.x, at.y + p.switchNudge.y, p.switchNudge.rotation, p.socketFitPct);
    return m.socket <= MISFIT_OK && m.pocket <= MISFIT_OK;
  };
  let collarMemo: { z: number; ok: boolean; geo: SliceGeometry; spot: ReturnType<typeof deepestPoint> } | null = null;
  const collarAt = (z: number) => {
    if (collarMemo?.z === z) return collarMemo;
    const geo = sliceGeometry(sc, model, kit, z, true, tol);
    const spot = deepestPoint(sc, geo.region, 9);
    let ok = z - COLLAR >= below && !!spot && spot.clearance >= pocketNeedMm(kit) / 2;
    if (ok && !fitsAt(z, geo, spot!)) {
      const plain = sliceGeometry(sc, model, kit, z, false, tol);
      const plainSpot = deepestPoint(sc, plain.region);
      if (plainSpot && fitsAt(z, plain, plainSpot)) ok = false;
    }
    collarMemo = { z, ok, geo, spot };
    return collarMemo;
  };

  // The search is a dozen sections and squares at eleven heights — half a second on a big model
  // — and nothing it depends on changes when a colour or a nudge does, so it is remembered.
  const autoAt = (hide: boolean) => {
    const r = range(hide);
    const key = JSON.stringify([p.rotation, p.sizeMm, p.flattenMm, hide, tol, p.socketFitPct, p.switchNudge.rotation]);
    const known = memo?.get(key);
    const z = known ?? autoSeam(wasm, sc, model, kit, H, r.lo, r.hi, hide, tol, p);
    if (known === undefined) memo?.set(key, z);
    return z;
  };
  let seam: number;
  if (p.slice.heightMm !== null) {
    seam = Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), p.slice.heightMm));
  } else if (p.slice.hideSeam && range(true).lo <= range(true).hi) {
    // The best height for a hidden gap — unless the collar fits nowhere, when the best plain one.
    seam = autoAt(true);
    if (!collarAt(seam).ok) seam = autoAt(false);
  } else {
    seam = autoAt(false);
  }

  const collar = collarAt(seam);
  const canHideSeam = collar.ok;
  const hide = p.slice.hideSeam && canHideSeam;
  const hideSpot = collar.spot;
  const g = hide ? collar.geo : sliceGeometry(sc, model, kit, seam, false, tol);

  // The switch goes where the model is deepest round the cut, then wherever the user nudged it.
  const spot = (hide ? hideSpot : deepestPoint(sc, g.region)) ?? { x: 0, y: 0, clearance: 0 };
  const pose: SwitchPose = {
    x: spot.x + p.switchNudge.x,
    y: spot.y + p.switchNudge.y,
    z: g.plate,
    rotation: p.switchNudge.rotation,
  };

  // ---- The cut ----
  const [upper, lower] = model.splitByPlane([0, 0, 1], seam).map((m: Solid) => sc.keep(m));
  if (upper.isEmpty() || lower.isEmpty()) warnings.push('The cut is outside the model. Move it back inside.');

  let topRaw: Solid = upper;
  let bottomRaw: Solid = lower;
  if (hide && g.inner && g.pillar && !g.pillar.isEmpty()) {
    // Pillar: from the plate plane up into the top, a hair past the seam so the union is solid.
    const pillar = sc.keep(sc.keep(extrude(wasm, g.pillar, COLLAR + 0.3)).translate([0, 0, g.plate]));
    topRaw = sc.keep(upper.add(pillar));
    // Collar: the band above the plate loses everything inside its skin.
    const hollow = sc.keep(sc.keep(extrude(wasm, g.inner, COLLAR + 1)).translate([0, 0, g.plate]));
    bottomRaw = sc.keep(lower.subtract(hollow));
  }

  // ---- The top: lifted onto the post, pocket cut, post added ----
  const post = postSolid(wasm, sc, kit, p.stemFitMm);
  if (!post.applied) warnings.push('Switch stem fit could not be applied. The stem prints as designed.');
  const top = sc.keep(
    sc.keep(
      sc.keep(topRaw.translate([0, 0, lift])).subtract(place(sc, movingPocket(wasm, sc, kit, p.travel), pose)),
    ).add(place(sc, post.solid, pose)),
  );

  // ---- The bottom: socket and identity voids, one boolean ----
  const socket = place(sc, socketCutter(sc, kit, p.socketFitPct), pose);
  const marks = buryIdentityVoidsPlan(wasm, sc, bottomRaw, kit, p.socketFitPct, pose);
  const bottom = sc.keep(bottomRaw.subtract(sc.keep(wasm.Manifold.union([socket, ...marks.voids]))));

  // ---- Checks ----
  const m = misfit(wasm, sc, model, kit, seam, g, pose.x, pose.y, pose.rotation, p.socketFitPct);
  if (m.socket > MISFIT_OK) {
    warnings.push(
      'The bottom is too thin round the switch here — it would break through. '
      + 'Move the cut or the switch, make the model bigger, or use Stand.',
    );
  }
  if (m.pocket > MISFIT_OK) {
    warnings.push(
      'The top is too thin round the switch here — the pocket would show through its side. '
      + 'Move the cut or the switch, or make the model bigger.',
    );
  }
  if (marks.attempted > 0 && marks.voids.length < marks.attempted) {
    warnings.push(
      `Provenance: ${marks.voids.length} of ${marks.attempted} identity marks landed. `
      + 'The bottom is thin round the switch.',
    );
  }
  // Loose bits: only possible when the seam cuts the model in more than one place.
  if (sectionAt(sc, model, seam).numContour() > 1) {
    const loose = looseCount(sc, top);
    if (loose > 0) {
      warnings.push(
        `The cut leaves ${loose === 1 ? 'a piece' : `${loose} pieces`} above it that ${loose === 1 ? 'is' : 'are'} `
        + 'not joined to the button. Move the cut.',
      );
    }
  }
  const grams = gramsOf(top);
  if (grams > HEAVY_TOP_GRAMS) {
    warnings.push(
      `The top weighs about ${grams.toFixed(0)} g — a light switch may not push it back up. `
      + 'Use a heavier switch, or make the model smaller.',
    );
  }

  return {
    pieces: [
      { solid: top, name: 'top-model', moving: true, color: p.colors.top },
      { solid: bottom, name: 'base-body', moving: false, color: p.colors.body },
    ],
    pose,
    warnings,
    cutHeight: seam,
    cutRange: lo <= hi ? [lo, hi] : null,
    buttonAt: null,
    canHideSeam,
    hideSeam: hide,
    movingGrams: grams,
  };
}

/** Pieces of a solid beyond the largest that are big enough to matter. */
export function looseCount(sc: Scope, solid: Solid): number {
  const parts: Solid[] = solid.decompose();
  let n = 0;
  let biggest = 0;
  const vols = parts.map((q) => {
    sc.keep(q);
    const v = q.volume();
    if (v > biggest) biggest = v;
    return v;
  });
  for (const v of vols) if (v > 20 && v < biggest) n++;
  return n;
}
