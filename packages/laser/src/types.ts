// The engine's own vocabulary. Nothing here knows about a document, a store or a sheet —
// those belong to whichever app is composing on top of it.
import type { CutRing } from '@vostok/export';

/** What the laser does to a shape. Colour and job order live in `ops.ts`. */
export type Op = 'cut' | 'score' | 'engrave';

/** Islands of rings in millimetres, Y up: one entry per island, its outer ring first. */
export type Shapes = CutRing[][];

/**
 * A keyring hole described as a property of the shape it sits on, so it can be dragged along
 * the edge and re-baked, rather than a hole punched once and lost.
 *
 *  inside   the hole is cut through the body, `ring` mm in from the edge.
 *  outside  a round lug is welded onto the edge and the hole goes through the lug.
 */
export interface Keyring {
  mode: 'inside' | 'outside';
  side: 'left' | 'top' | 'right' | 'bottom';
  /** 0..1 along that edge. */
  along: number;
  /** Hole diameter, mm. */
  dia: number;
  /** Material left between the hole and the edge, mm. */
  ring: number;
}

export const DEFAULT_KEYRING: Keyring = { mode: 'outside', side: 'left', along: 0.5, dia: 4, ring: 2.5 };

/** The name-keychain style plate: an outline hugging the letters, with a lug. */
export interface KeychainParams {
  outlineWidth: number;
  holeDia: number;
  ringThickness: number;
  plateShape: 'outline' | 'rectangle';
  holeSide: 'left' | 'top' | 'none';
  smoothing: number;
}
