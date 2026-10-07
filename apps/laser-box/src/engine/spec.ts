// What the engine is asked for: the customer's settings, resolved into millimetres.
//
// `state.ts` holds what the form shows (sizes as typed, inside or outside, a fit stop, a
// material id); `toSpec` there turns that into the one thing the engine reads, so nothing below
// this line knows about units, presets or stops.

// The sliding lid was taken out on 2026-10-02; it may come back as its own style.
export type BoxStyle = 'open' | 'lid' | 'hinge' | 'drawer';
export type Bottom = 'flush' | 'slots' | 'feet';

export interface BoxSpec {
  style: BoxStyle;
  /** Dimensions, mm: X across the front, Y front to back, Z up — of the OUTSIDE (a lidded box's
   *  height includes the lid, a hinged one's its ears), or of the space INSIDE, which
   *  `buildBox` turns into an outside by building and measuring. */
  length: number;
  width: number;
  height: number;
  measure: 'outside' | 'inside';
  /** Measured sheet thickness, mm. */
  t: number;
  /** Full kerf width, mm: the cut file is offset by half of it. */
  kerf: number;
  /** Interference on every friction joint, mm: + grips, − slides. */
  fit: number;
  bottom: Bottom;
  /** Flex tabs: wider tabs with two slits each, pressed home without glue. Off = plain fingers. */
  flex: boolean;
  /** Finger width to aim at, mm; 0 = the engine's own choice. */
  finger: number;
  /** Somewhere to get a finger in to open it (lift-off lid, hinged lid, drawer). */
  fingerHole: boolean;
  /** Dividers: how many walls across the length and across the width. */
  dividersX: number;
  dividersY: number;
  /** Drawers stacked in a drawer box, 1–3. */
  drawers: number;
}
