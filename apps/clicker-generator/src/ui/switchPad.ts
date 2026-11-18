/*
  Where a switch may sit, and the Switch category's d-pad. Pure: no DOM, no kit.

  The build clamps every switch centre into a box (`DesignLayout.switchBox`). `holdInBox` is that
  rule on one axis (the build's own is `clampAxis` in geometry/buildClicker.ts), and the one copy
  the screen has: the 2D view draws a switch through it, a 2D drag is held by it, and the pad
  starts every press from it. An axis with no room (low above high) holds the switch at its
  middle, as the build does.
*/

/** One press of the pad, mm: the same as a 2D arrow key and the slider step. */
export const SWITCH_PAD_STEP_MM = 0.5;

/** One press of a rotate corner, degrees: three presses make the 45° a switch is most often
 *  turned by. */
export const SWITCH_PAD_TURN_DEG = 15;

/** A switch's turn after one press of a rotate corner: `delta` added, kept inside the Turn
 *  slider's -180..180 (a full turn round wraps rather than stopping at the end). */
export function turnSwitch(rotation: number, delta: number): number {
  const next = (((rotation + delta + 180) % 360) + 360) % 360 - 180;
  // -180 and 180 are one place; the slider shows the end the turn came from.
  return next === -180 && rotation + delta > 0 ? 180 : next;
}

export type SwitchReach = { loX: number; hiX: number; loY: number; hiY: number };
export type PadDir = 'up' | 'down' | 'left' | 'right';

/** `v` held inside `[lo, hi]`; the middle when the axis has no room. */
export function holdInBox(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

/** The box the last build clamped the switches into; before a first build, the base: plus or
 *  minus half the cap's width. */
export function switchReach(box: SwitchReach | null, capWidthMm: number): SwitchReach {
  if (box) return box;
  const h = capWidthMm / 2;
  return { loX: -h, hiX: h, loY: -h, hiY: h };
}

/** False only when neither axis has room: then the pad has nothing to move. */
export function switchPadHasRoom(r: SwitchReach): boolean {
  return r.loX < r.hiX || r.loY < r.hiY;
}

/** The Left / right and Up / down sliders' range: the box with its ends pulled in onto their
 *  0.5 mm step. The pad shows exactly while one of those sliders does:
 *  `switchPadHasRoom(sliderReach(..))`. */
export function sliderReach(r: SwitchReach): SwitchReach {
  const lo = (v: number) => Math.ceil(v * 2) / 2;
  const hi = (v: number) => Math.floor(v * 2) / 2;
  return { loX: lo(r.loX), hiX: hi(r.hiX), loY: lo(r.loY), hiY: hi(r.hiY) };
}

/** The switch the Switch category has lit: `activeSwitchIndex` held to the switches there are. */
export const litSwitch = (s: { activeSwitchIndex: number; switches: readonly unknown[] }): number =>
  Math.max(0, Math.min(s.activeSwitchIndex, s.switches.length - 1));

/** One press of the pad on the state as it is: the lit switch and where it goes, or null when
 *  there is no switch. The app writes it through the sliders' own path. */
export function padPress(
  s: { activeSwitchIndex: number; switches: readonly { x: number; y: number }[]; switchBox: SwitchReach | null; capWidthMm: number },
  dir: PadDir,
): { index: number; x: number; y: number } | null {
  const index = litSwitch(s);
  const sw = s.switches[index];
  return sw ? { index, ...nudgeSwitch(sw, switchReach(s.switchBox, s.capWidthMm), dir) } : null;
}

/** One press: from where the switch is drawn, one step on the named axis, onto the 0.1 mm grid,
 *  held inside the box with its ends pulled onto that grid too. The other axis is held, not
 *  moved, so a switch saved outside the box comes into view on its first press. */
export function nudgeSwitch(
  sw: { x: number; y: number },
  r: SwitchReach,
  dir: PadDir,
  step = SWITCH_PAD_STEP_MM,
): { x: number; y: number } {
  const axis = (v: number, lo: number, hi: number, delta: number) => {
    const held = holdInBox(v, lo, hi);
    if (delta === 0 || lo > hi) return held;
    const next = Math.round((held + delta) * 10) / 10;
    const lo10 = Math.ceil(lo * 10 - 1e-9) / 10;
    const hi10 = Math.floor(hi * 10 + 1e-9) / 10;
    return lo10 > hi10 ? held : holdInBox(next, lo10, hi10);
  };
  const dx = dir === 'right' ? step : dir === 'left' ? -step : 0;
  const dy = dir === 'up' ? step : dir === 'down' ? -step : 0;
  return { x: axis(sw.x, r.loX, r.hiX, dx), y: axis(sw.y, r.loY, r.hiY, dy) };
}
