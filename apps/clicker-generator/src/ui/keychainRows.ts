/*
  The Keychain category's two choices that depend on the style: whether Style (Loop | Hole) shows,
  and the range of Hole size.

  A block set welds its loop to one block's outer face, which has no slab for a tunnel, so a block
  set always makes a loop and the Style row is hidden there (the state keeps the style, so it
  comes back when the clicker does).

  Hole size is the loop's hole, 3.2 to 8 mm, or the tunnel's bore, 3.2 to 6 mm: a round tunnel
  prints standing up and a roof wider than 6 mm would sag. The row's range follows the style, so
  the stepper never offers a size the engine would quietly make smaller. 3.2 rather than 3.0 for
  the loop: the stepper snaps to a 0.4 mm grid from its low end, and the 5.2 mm default is on the
  grid that starts at 3.2.
*/
import { HOLE } from '../geometry/keychainHole';
import { DEFAULT_KEYCHAIN } from '../settings';
import type { KeychainParams } from '../types';

export type KeychainStyle = KeychainParams['style'];

/** The loop's hole, mm. */
export const LOOP_HOLE_MM: readonly [number, number] = [3.2, 8];
/** The tunnel's bore, mm: what the engine will make. */
export const TUNNEL_BORE_MM: readonly [number, number] = [HOLE.BORE_MIN, HOLE.BORE_MAX];

/** Whether the Style row shows: everywhere a keyring goes round the edge, not on a block set. */
export function keychainStyleShown(importMode: string): boolean {
  return importMode !== 'blocks';
}

/** The style that is built: a block set always makes a loop. */
export function builtKeychainStyle(importMode: string, style: KeychainStyle | undefined): KeychainStyle {
  return keychainStyleShown(importMode) && style === 'hole' ? 'hole' : 'loop';
}

/** Hole size's range, mm, for what is built. */
export function holeSizeRange(importMode: string, style: KeychainStyle | undefined): readonly [number, number] {
  return builtKeychainStyle(importMode, style) === 'hole' ? TUNNEL_BORE_MM : LOOP_HOLE_MM;
}

/** The rail's two rows that follow the style, as `update()` sets them on every render: Style
 *  shows where a keyring can be a hole, and Hole size's range is the built style's. */
export function showKeychainStyleRows(
  rows: { styleField: { style: { display: string } }; sizeRow: { setBounds(min: number, max: number): void } },
  importMode: string,
  style: KeychainStyle | undefined,
): void {
  rows.styleField.style.display = keychainStyleShown(importMode) ? '' : 'none';
  const [min, max] = holeSizeRange(importMode, style);
  rows.sizeRow.setBounds(min, max);
}

/** Whether the keyring has moved off where a new clicker has it: what "Reset position" shows
 *  for, and what it undoes (`DEFAULT_KEYCHAIN`'s Position and Fine offset). */
export function keychainMoved(kc: Pick<KeychainParams, 'angleDeg' | 'offsetMm'>): boolean {
  return (kc.angleDeg ?? DEFAULT_KEYCHAIN.angleDeg) !== DEFAULT_KEYCHAIN.angleDeg || (kc.offsetMm ?? 0) !== DEFAULT_KEYCHAIN.offsetMm;
}

/** Whether Cut hole shows: a keyring that is on, built as a hole, placed and not cut yet. A hole
 *  with no `holeCut` was saved before holes were placed first, and is cut. */
export function holeAwaitsCut(importMode: string, kc: Pick<KeychainParams, 'enabled' | 'style' | 'holeCut'>): boolean {
  return kc.enabled && builtKeychainStyle(importMode, kc.style) === 'hole' && kc.holeCut === false;
}

/** Whether the line under Cut hole says there is no room: a keyring that is on, built as a hole,
 *  where the last build found no room for the tunnel (placed, or cut and refused). */
export function holeNoRoomShown(importMode: string, kc: Pick<KeychainParams, 'enabled' | 'style'>, noRoom: boolean): boolean {
  return noRoom && kc.enabled && builtKeychainStyle(importMode, kc.style) === 'hole';
}
