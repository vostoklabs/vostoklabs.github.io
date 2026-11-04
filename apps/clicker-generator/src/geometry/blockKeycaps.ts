// Letter blocks' keycaps: the three MX 1u caps a block set can wear, where each one sits on its
// switch, how far a cap can be cut shorter, and how high that lets the rim rise. Numbers only, so
// the build, the rail and a loaded project read one rule (tests/block-layout.test.ts runs it with
// no geometry).
//
// The caps are the Keycap generator's own 1u files, copied into public/assets.
// tests/keycap-profiles.test.ts holds each copy to its source byte for byte, and the numbers
// below to the files' own metadata.
//
// The frame is buildBlocks': Z = 0 is the switch-plate plane, and the well floor, where the
// underside of the switch's flange rests, is BODY_DIMS.floorZ above it. A cap file is drawn with
// the bottom of its stem on z = 0.
import { capTrimLimits, clampCapTrim, type CapTrimMeta } from '@vostok/keycaps';
import type { BlockKeycap } from '../types';
import { BODY_DIMS } from './keyBody';

export type { BlockKeycap };

export interface BlockKeycapProfile {
  /** Its file, from the app's base. */
  file: string;
  /** Its top, mm above the bottom of its stem. */
  topZ: number;
  /** How far the switch's cross can go into its stem, mm: the stem's height, the socket being a
   *  hole through it up to the cap's ceiling. */
  socketMm: number;
  /** Added to Stem fit, mm, so one setting is one grip on every cap. Thocky's cross hole is drawn
   *  4.2 mm across where Standard's is 4.04, so as drawn it barely holds the switch's cross;
   *  0.2 mm tighter, it holds it as Standard's does. */
  stemFitMm: number;
}

/** The profiles, in the order the rail offers them. */
export const BLOCK_KEYCAPS: Readonly<Record<BlockKeycap, BlockKeycapProfile>> = {
  standard: { file: 'assets/keycap.json', topZ: 11.832, socketMm: 9.995, stemFitMm: 0 },
  low: { file: 'assets/keycaps/low.json', topZ: 5.242, socketMm: 3.208, stemFitMm: 0 },
  thocky: { file: 'assets/keycaps/thocky.json', topZ: 9.042, socketMm: 4.308, stemFitMm: -0.2 },
};

export const BLOCK_KEYCAP_IDS = Object.keys(BLOCK_KEYCAPS) as BlockKeycap[];

/** Whether a saved value names a profile. */
export const isBlockKeycap = (v: unknown): v is BlockKeycap => BLOCK_KEYCAP_IDS.includes(v as BlockKeycap);

// ---------------------------------------------------------------------------------------------
// Where a cap sits
// ---------------------------------------------------------------------------------------------

/** A switch as a cap meets it, mm above the underside of its flange: the shoulder of the slider,
 *  which a cap's stem stands on, and the tip of the cross. */
export interface SwitchSeat {
  slider: number;
  tip: number;
}

/** The MX switch the blocks hold. The worker measures both off the switch mesh it shows
 *  (switchKit `measurePostSeat`, and the mesh's top) and builds with what it measured; these are
 *  the same readings, for the rail and a loaded project, which run before the mesh is read.
 *  tests/blocks-body.test.ts holds them to the mesh. */
export const MX_SEAT: Readonly<SwitchSeat> = { slider: 6.3, tip: 10 };

/** The switch travel mount.ts sends with every block set, mm: what the Standard cap's seat is. */
export const BLOCK_TRAVEL_MM = 4;

/**
 * Where a cap's stem stands, mm above the well floor.
 *
 * The app's seat is one switch travel above the floor (buildBlocks says why), and a Standard
 * cap's socket is deep enough that the cross stays clear of its ceiling there. A shallower socket
 * would have the cross up through the cap's top plate, so that cap sits where a real switch holds
 * it: on the slider's shoulder, or on the cross when its socket is too shallow to reach down to
 * the shoulder (Low profile). `socketMm` is the socket as drawn, so a cap cut shorter keeps the
 * seat of the cap it was cut from and only its top comes down.
 */
export function capSeat(socketMm: number, travel: number, sw: SwitchSeat = MX_SEAT): number {
  const atTravel = Math.max(0, travel);
  if (atTravel + socketMm >= sw.tip) return atTravel;
  return Math.max(sw.slider, sw.tip - socketMm);
}

// ---------------------------------------------------------------------------------------------
// How far a cap can be cut shorter, and how high the rim can then rise
// ---------------------------------------------------------------------------------------------

/** The most a cap is cut shorter, mm. Uncut, a Standard cap can be pressed 5.6 mm before it meets
 *  anything; 4.5 mm shorter (7.3 mm tall instead of 11.8) it still has 4.55, and past that the
 *  room left over the switch's own 4 mm is too thin to trust to a print. */
export const CAP_LOWER_MAX_MM = 4.5;

/** How far a cap may be cut shorter, mm: as far as its socket allows (the shelf's Keycap trim,
 *  nothing for a cap that already rests on the cross), and never past CAP_LOWER_MAX_MM. */
export function capLowerLimit(meta: CapTrimMeta): number {
  return Math.min(CAP_LOWER_MAX_MM, capTrimLimits(meta).maxLower);
}

/** A cut held to what the cap allows; anything that is not a number is no cut. */
export function clampCapLower(meta: CapTrimMeta, lowerMm: unknown): number {
  const asked = typeof lowerMm === 'number' && Number.isFinite(lowerMm) ? lowerMm : 0;
  return clampCapTrim({ lowerMM: asked }, { ...capTrimLimits(meta), maxLower: capLowerLimit(meta) }).lowerMM;
}

/** A profile's numbers as the shelf's trim limits read a cap's metadata. */
export function profileMeta(p: BlockKeycapProfile): CapTrimMeta {
  return { hasStem: true, topZ: p.topZ, stemBbox: { min: [0, 0, 0], max: [0, 0, p.socketMm] } };
}

/** The keycap always stands at least this far above the rim at rest: the 2 mm an MX switch
 *  travels before it clicks, so a key clicks without the finger going into the well. */
export const MIN_CAP_PROUD_MM = 2;

/** How far Body rim height can raise the rim above the standard body, mm, whatever the cap. */
export const RIM_RAISE_MAX_MM = 6;

/** How high a profile's cap, cut `lowerMm` shorter, lets the rim rise above the standard body, mm:
 *  up to MIN_CAP_PROUD_MM below its top, as the build stops it, to the 0.1 mm below that, and
 *  never past RIM_RAISE_MAX_MM. */
export function rimRaiseMax(profile: BlockKeycap, lowerMm = 0): number {
  const p = BLOCK_KEYCAPS[profile];
  const capTop = BODY_DIMS.floorZ + capSeat(p.socketMm, BLOCK_TRAVEL_MM) + p.topZ - lowerMm;
  const room = Math.floor((capTop - MIN_CAP_PROUD_MM - BODY_DIMS.rimZ) * 10 + 1e-6) / 10;
  return Math.max(0, Math.min(RIM_RAISE_MAX_MM, room));
}

/** How far a profile's cap can be cut shorter, mm; 0 when it cannot be. */
export function capLowerMax(profile: BlockKeycap): number {
  return capLowerLimit(profileMeta(BLOCK_KEYCAPS[profile]));
}
