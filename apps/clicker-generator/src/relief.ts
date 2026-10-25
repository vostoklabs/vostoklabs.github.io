/**
 * Relief: how far a colour stands above the cap's top, counted in the geometry's height steps
 * (`stepHeight` in buildParamsFor) and shown in the millimetres it prints. Shared by the rail's
 * rows (ui.ts) and the picker a click on the model opens (mount.ts), so the two cannot offer
 * different ranges or round a typed number differently.
 */

/** One height step, mm. */
export const RELIEF_STEP_MM = 0.6;
/** The range in steps: one step down (a colour sunk into the top, which the minimum Top
 *  thickness of 1 mm always leaves room for, so it can never print as a hole) to five up. */
export const RELIEF_MIN = -1;
export const RELIEF_MAX = 5;

/** A height in steps as the millimetres it prints: "0 mm", "+1.2 mm", "−0.6 mm". */
export const reliefMm = (level: number): string =>
  level === 0 ? '0 mm' : `${level > 0 ? '+' : '−'}${Math.abs(level * RELIEF_STEP_MM).toFixed(1)} mm`;

/** A typed height (millimetres, any sign spelling) back to steps: "1.2" is two up. `signed` is
 *  the typed number with its sign read the way the readouts write it. */
export const reliefLevelOf = (signedMm: number): number => Math.round(signedMm / RELIEF_STEP_MM);

/** A height in steps, held to the range. */
export const clampLevel = (level: number): number =>
  Math.max(RELIEF_MIN, Math.min(RELIEF_MAX, Math.round(level)));
