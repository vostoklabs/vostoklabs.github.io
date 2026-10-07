// Pictures for the picture tiles (the kit's segmentedControl 'tiles'), drawn here because they
// are diagrams, not renders: the joints edge-on and the bottoms seen from the front, in the
// box's own wood and burn colours, on a 120 × 100 frame — the tiles' 6 : 5. The box styles are
// renders of the real thing (src/assets/styles, made by tests/pictures.mjs).
import { windowRing, type WindowShape } from '../engine/decor';

const WOOD = '#c9a978';
const EDGE = '#7a5a35';
const BURN = '#3a2412';

const picture = (inner: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">${inner}</svg>`)}`;

/** An edge of a piece, its tabs up. */
export const JOINT_PICTURES = {
  // Two flex tabs, two slits each, rounded tips — as the engine cuts them.
  flex: picture(`<path d="M6 60H16V33Q16 30 19 30H51Q54 30 54 33V60H66V33Q66 30 69 30H101Q104 30 104 33V60H114V88H6Z" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.5"/><path d="M25.5 30V60M44.5 30V60M75.5 30V60M94.5 30V60" stroke="${BURN}" stroke-width="3"/>`),
  // Plain fingers: more of them, square.
  fingers: picture(`<path d="M6 60H10V34H26V60H38V34H54V60H66V34H82V60H94V34H110V60H114V88H6Z" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.5"/>`),
};

/** A wall from the front, the floor's tab ends showing where the floor sits. */
const tabs = (y: number) => [26, 53, 80].map((x) => `<rect x="${x}" y="${y}" width="14" height="6" fill="${BURN}"/>`).join('');
export const BOTTOM_PICTURES = {
  flush: picture(`<path d="M14 26H106V80H14Z" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.5"/>${tabs(74)}`),
  slots: picture(`<path d="M14 26H106V80H14Z" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.5"/>${tabs(60)}`),
  feet: picture(`<path d="M14 26H106V80H94V72Q94 64 86 64H34Q26 64 26 72V80H14Z" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.5"/>${tabs(50)}`),
};

/** A window shape as a filled silhouette path in a 40 × 40 box, for the shape tiles. */
export function windowPath(shape: WindowShape): string {
  const w = shape === 'oval' ? 34 : shape === 'cloud' ? 36 : shape === 'face' ? 34 : 30;
  const h = shape === 'oval' ? 22 : shape === 'cloud' ? 22 : shape === 'face' ? 26 : shape === 'arch' ? 34 : shape === 'diamond' ? 34 : shape === 'hexagon' ? 26 : 28;
  const ring = shape === 'face' ? null : windowRing(shape, w, h);
  if (!ring) {
    // The whole face: a panel with its pattern room inset — two nested rectangles.
    return 'M3 7h34v26H3z M7 11v18h26V11z';
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return `M${ring.map(([x, y]) => `${(20 + x - cx).toFixed(2)} ${(20 - (y - cy)).toFixed(2)}`).join('L')}Z`;
}
