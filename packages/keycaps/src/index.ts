/**
 * Keycap trim: how far an MX keycap can be cut shorter from below, and the cut itself.
 *
 * A cap rests on its switch by the bottom of its stem, which stands on the switch's slider. Cut
 * the stem shorter from below and the cap sits that much lower. Three settings do it:
 *
 *   lowerMM   "Cap height": the stem AND the walls are cut by the same amount, so their bottoms
 *             stay flush. The whole cap sits lower and the rim keeps its place relative to the
 *             slider, so it cannot reach the plate any sooner than before.
 *   recessMM  "Stem recess": only the stem is cut, so its bottom sits that far above the rim.
 *             The cap sits lower and the rim drops with it, towards the switch: at full travel
 *             the slider's shoulder is 2.6 mm above the plate and the switch's flange (15.6 mm
 *             square, 15.9 with its ears) stands 1.0 mm above it. A Standard skirt is 15.67 mm
 *             inside, so it barely clears the flange, and the rim can come down about 1.1 mm
 *             with a 0.5 mm margin (`SAFE_RECESS_MM`).
 *   wallMM    "Wall height": how far the walls come down from the top (null: all the way). Only
 *             the walls are cut, and never above the ceiling.
 *
 * Both lowering and recessing only work while the switch's cross still fits in the socket: once
 * the cross reaches the socket's floor, the cap rests on the cross instead and goes no lower. So
 * the limit is the socket's depth (the stem's own height, the socket being a through-hole up to
 * the ceiling) less the cross and a margin. On Standard that is about 6 mm; Low profile and Thocky
 * already rest on the cross, so `capTrimLimits` gives them nothing.
 *
 * Millimetres, Z up, the rim on z = 0. No DOM and no mesh library: `cutFromBelow` takes any solid
 * with Manifold's three methods, so the caller keeps its own geometry types.
 */

/** The switch's cross plus a margin, in mm: a socket shallower than this would rest on the cross.
 *  Cherry MX's cross stands about 3.6 mm above the slider's shoulder. */
export const MIN_SOCKET_MM = 4.0;
/** How far the stem alone may be recessed above the rim. */
export const MAX_RECESS_MM = 3.0;
/** How far it may be recessed before the rim can touch the switch at full travel, for a cap that
 *  does not say (`meta.safeRecessMM`): the MX profiles' 15.67 mm skirt over the 15.6 mm flange. */
export const SAFE_RECESS_MM = 1.1;
/** Below this a trim range is not worth a control. */
const MIN_RANGE_MM = 0.5;

/** What `capTrimLimits` reads of a cap's metadata. */
export interface CapTrimMeta {
  hasStem?: boolean;
  /** The stem's bounds, mm. */
  stemBbox?: { min: number[]; max: number[] };
  /** The cap's top, mm above the rim. */
  topZ: number;
  /** A socket that does not run the stem's full height (a generated cap whose stems run on into
   *  the top plate). Absent: the stem's height. */
  socketDepthMM?: number;
  safeRecessMM?: number;
}

export interface CapTrimLimits {
  /** How far the cap may be lowered; 0 means no control. */
  maxLower: number;
  /** How far the stem alone may be recessed; 0 means no control. */
  maxRecess: number;
  /** Past this recess the rim may touch the switch when pressed: a warning, not a limit. */
  safeRecess: number;
  /** The shortest wall: the top plate alone. */
  minWall: number;
}

export interface CapTrim {
  lowerMM?: number;
  recessMM?: number;
  wallMM?: number | null;
}

/**
 * How far this cap can be lowered and its stem recessed.
 *
 * Only a female socket counts (the MX stems). Choc's male stubs go INTO the switch, which is a
 * different thing to shorten, so a profile with stubs says so and gets no control.
 */
export function capTrimLimits(meta: CapTrimMeta | null | undefined, { stubs = false }: { stubs?: boolean } = {}): CapTrimLimits {
  const sb = meta?.stemBbox;
  if (!meta?.hasStem || !sb) return { maxLower: 0, maxRecess: 0, safeRecess: 0, minWall: 0 };
  // The walls can come up as far as the ceiling, the stem's top, wherever the stem is a socket
  // or a stub: the top plate is what is left.
  const ceilingZ = sb.min[2]! + (meta.socketDepthMM ?? sb.max[2]! - sb.min[2]!);
  const minWall = Math.ceil(Math.max(0, meta.topZ - Math.min(ceilingZ, sb.max[2]!)) * 10) / 10;
  if (stubs) return { maxLower: 0, maxRecess: 0, safeRecess: 0, minWall };
  // The socket is a through-hole up the stem to the ceiling, so its depth is the stem's height;
  // a generated cap whose stems run on into the top plate says its own.
  const room = (meta.socketDepthMM ?? sb.max[2]! - sb.min[2]!) - MIN_SOCKET_MM;
  const maxLower = room >= MIN_RANGE_MM ? Math.floor(room * 10) / 10 : 0;
  const maxRecess = maxLower ? Math.min(MAX_RECESS_MM, maxLower) : 0;
  const safeRecess = Math.min(maxRecess, meta.safeRecessMM ?? SAFE_RECESS_MM);
  return { maxLower, maxRecess, safeRecess, minWall };
}

/** Clamp the settings to a cap's limits: lower and recess together may not use more than the
 *  socket, and a wall is no shorter than the top plate (`top`: the cap's height before lowering;
 *  a wall that reaches it is no cut, null). */
export function clampCapTrim(
  { lowerMM = 0, recessMM = 0, wallMM = null }: CapTrim,
  limits: CapTrimLimits,
  top = Infinity,
): { lowerMM: number; recessMM: number; wallMM: number | null } {
  const lower = Math.min(Math.max(0, lowerMM), limits.maxLower);
  const recess = Math.min(Math.max(0, recessMM), limits.maxRecess, Math.max(0, limits.maxLower - lower));
  const full = top - lower;
  const wall = wallMM == null || !limits.minWall || wallMM >= full - 0.05 ? null : Math.max(limits.minWall, wallMM);
  return { lowerMM: lower, recessMM: recess, wallMM: wall };
}

/** What `cutFromBelow` needs of a solid: Manifold's own methods. */
export interface Cuttable<T> {
  trimByPlane(normal: [number, number, number], originOffset: number): T;
  translate(v: [number, number, number]): T;
  delete(): void;
}

/** Keep what is above `cutZ`, then move it down by `dropZ`: one part of a cap shortened from
 *  below. A new solid; `solid` is the caller's to free, and the cut in between is freed here. */
export function cutFromBelow<T extends Cuttable<T>>(solid: T, cutZ: number, dropZ: number): T {
  const kept = solid.trimByPlane([0, 0, 1], cutZ);
  const moved = kept.translate([0, 0, -dropZ]);
  kept.delete();
  return moved;
}
