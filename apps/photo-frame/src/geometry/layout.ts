// Where everything goes, in millimetres, before any solid is made. Pure arithmetic: the screen
// reads it to fit the words and draw the art, the worker reads it to build, the node test reads
// it to check.
//
// Front view: x to the right as the customer looks at the front, y up, the print centred on the
// origin. `z` is depth from the front face toward the back (the frame prints face down, so z is
// also the print height).
import { pointInRing } from '@vostok/shapes';
import { heartRing } from '@vostok/laser/blanks';
import type { Print } from '../sizes';

/* ---------------- what a frame is made of ---------------- */

/** The frame's edge: a rectangle, an arch (round top corners), even scallops all round, a ric-rac
 *  band round a plain inner frame, or a puffy wavy ring. */
export type Outline = 'rect' | 'arch' | 'scallop' | 'ricrac' | 'squiggle';
export type Corners = 'square' | 'rounded' | 'round';
export type Border = 'thin' | 'regular' | 'thick';
/** The face: flat, a bevelled picture-frame moulding, or a deep box. */
export type Profile = 'flat' | 'bevel' | 'deep';
/** What sits round the window: an even border, a wide chin for words (instant-film look), a
 *  music player, or a social post. */
export type FaceLayout = 'plain' | 'chin' | 'music' | 'social';
export type StandKind = 'block' | 'base' | 'foot' | 'kickstand' | 'magnets' | 'keychain' | 'none';
export type HolderKind = 'bar' | 'pill' | 'heart';

export interface FrameSpec {
  outline: Outline;
  corners: Corners;
  border: Border;
  profile: Profile;
  layout: FaceLayout;
  /** A crest above the top edge for initials (the wedding magnets). */
  crest: boolean;
  /** Lines of words in the chin: 0, 1 or 2 (a name and a date). */
  lines: number;
  /** Where a chin is: under the photo (the default) or over it. */
  chinAt?: 'top' | 'bottom';
  /** On a kickstand: one in the middle (the default) or two near the sides. */
  kickstands?: 1 | 2;
  stand: StandKind;
  /** Music: an artist line under the song, and the times under the bar (each only when typed). */
  artist?: boolean;
  times?: boolean;
  /** On magnets: their size and how many. Default the engine's own pick, two of them. */
  magnets?: { d: number; h: number; count: 2 | 4 };
  /** On a keychain: the hole, the wall round it, and where along the top edge the loop sits
   *  (0 left, 0.5 middle, 1 right). */
  keyring?: { dia: number; ring: number; along: number };
}

/* ---------------- the numbers every builder shares ---------------- */

/** Every fit number lives here, so a builder never carries a literal. Until the test prints are
 *  read, these are the planned values (Ian's first print of the foot frame fitted). */
export const FIT = {
  /** Lean of a standing frame or print from vertical, degrees. */
  lean: 15,
  /** Clear round the print in its pocket, per side. */
  pocketClear: 0.3,
  pocketCorner: 1.0,
  /** The rim's overlap over the print's edge (a plain window). */
  lipOver: 1.5,
  /** An instant print's picture-only window sits this far inside the picture. */
  filmInset: 0.75,
  gapFilm: 1.4,
  gapPaper: 0.6,
  plate: 1.0,
  /** Play above the back plate, under the groove's ceiling. */
  plateClear: 0.2,
  /** The wall over each groove. */
  ceiling: 0.8,
  groove: 1.0,
  wingClear: 0.25,
  plateEnd: 0.2,
  plateTail: 7.0,
  damLength: 3.0,
  damBelowPlate: 0.2,
  scoop: 4.0,
  /** Flush second colour on the face, and the floors that print with a 0.4 nozzle. */
  inlay: 0.6,
  inlayFront: 0.9,
  minEm: 3.5,
  captionToWindow: 2.2,
  captionToEdge: 2.0,
  /** Holder slots: film and paper. A base's slot is the frame's stack plus this. */
  slotFilm: 1.4,
  slotPaper: 0.6,
  baseSlotClear: 0.4,
  heel: 0.3,
  backLip: 3,
  magnetFit: 0.2,
  magnetWall: 2.0,
  keyHole: 5.2,
  keyWall: 2.2,
  keyLug: 2.4,
} as const;

/** Border width: the frame round the print, print edge to outline. */
export const RIM: Record<Border, number> = { thin: 5, regular: 8, thick: 13 };

/** The face's profile: how thick the front is, how far the window opens toward the face, where
 *  that opening starts, and the chamfer on the outer edge. Every slope is 45 degrees or steeper,
 *  so it prints face down with no support. */
export const PROFILES: Record<Profile, { front: number; bevel: number; straight: number; chamfer: number }> = {
  flat: { front: 1.2, bevel: 0.8, straight: 0, chamfer: 0 },
  bevel: { front: 2.8, bevel: 2.4, straight: 0, chamfer: 1.2 },
  deep: { front: 7.0, bevel: 2.4, straight: 4.6, chamfer: 1.2 },
};

/** A squiggle's face: thick in front of the photo, so its round-over has room to look puffy. */
const PUFFY = { front: 3.0, bevel: 0, straight: 0, chamfer: 0 };

/**
 * The squiggle (refs 06, 27): a band of even width, `2 h` across, swinging `a` either side of a
 * rounded box drawn `e` outside the print, so its inner edge laps the print by the usual lip where
 * it swings out and its outer edge leaves the plate's grooves a wall where it swings in.
 */
export const SQUIGGLE = { e: 2.0, a: 3.0, h: 6.5, wave: 22, corner: 7 } as const;

/** Scallops (ref 08): small and shallow, all the way round, the window plain. */
export const SCALLOP = { depth: 1.6, pitch: 8.2 } as const;

const RAD = Math.PI / 180;
export const SIN = Math.sin(FIT.lean * RAD);
export const COS = Math.cos(FIT.lean * RAD);
export const TAN = Math.tan(FIT.lean * RAD);

/* ---------------- the stack ---------------- */

export interface Stack {
  gap: number;
  /** Pocket floor (the back of the front). */
  zPocket: number;
  zPlate0: number;
  zPlate1: number;
  /** The groove's ceiling. */
  zCeil: number;
  /** The whole frame. */
  T: number;
}

export function stackOf(film: boolean, front = PROFILES.flat.front): Stack {
  const gap = film ? FIT.gapFilm : FIT.gapPaper;
  const zPocket = front;
  const zPlate0 = zPocket + gap;
  const zPlate1 = zPlate0 + FIT.plate;
  const zCeil = zPlate1 + FIT.plateClear;
  return { gap, zPocket, zPlate0: r2(zPlate0), zPlate1: r2(zPlate1), zCeil: r2(zCeil), T: r2(zCeil + FIT.ceiling) };
}

/* ---------------- the groove block: a holder, or the base a frame stands in ---------------- */

export interface GrooveBlock {
  /** Slot width across the lean. */
  s: number;
  /** Block height; the back lip stands `lipTop`. */
  hb: number;
  lipTop: number;
  /** Slot depth along the lean, at its back wall. */
  dk: number;
  /** Floor height at the slot's back and front corners. */
  vfb: number;
  vff: number;
  /** How much of what stands in it the front lip hides, along the lean. */
  frontWall: number;
  /** In front of what stands in it. */
  toe: number;
  /** Plan: depth front to back, length end to end, and the slot's length. */
  D: number;
  L: number;
  slotLength: number;
  /** The slot runs out through both ends: the block is exactly as wide as what stands in it. */
  flush: boolean;
  /** A back lip taller than the block, or a plain block. */
  lip: boolean;
}

export interface GrooveOptions {
  /** As wide as what stands in it, the slot open at both ends. Default false: closed ends. */
  flush?: boolean;
  /** A tall block the frame stands deep in (refs 22, 24), not a low base with a lip. */
  block?: boolean;
  /** Extra height, for words on the front. */
  tall?: boolean;
}

/** `H` is the height of what stands in it (the print, or the whole frame), `width` its width. */
export function grooveBlock(H: number, width: number, s: number, o: GrooveOptions = {}): GrooveBlock {
  const block = !!o.block;
  const hb = block ? clamp(Math.round(10 + H / 18), 13, 22) : o.tall ? clamp(Math.round(8 + H / 22), 11, 16) : clamp(Math.round(6 + H / 30), 8, 14);
  const dk = block ? Math.max(8, H / 11) : Math.max(6, H / 15);
  const lip = !block;
  const lipTop = lip ? hb + FIT.backLip * COS : hb;
  const vfb = Math.max(1.2, lipTop - dk * COS);
  const vff = vfb + s * SIN;
  const frontWall = (hb - vff) / COS;
  const toe = block ? 5 : 8;
  const D = toe + s / COS + (block ? 0.24 : FIT.heel) * H;
  const flush = !!o.flush;
  const slotLength = flush ? width + 20 : width + 0.6;
  const L = flush ? width : width + 0.6 + 10;
  return { s, hb, lipTop, dk, vfb, vff, frontWall, toe, D, L, slotLength, flush, lip };
}

/* ---------------- the frame ---------------- */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Corner radii: top-left, top-right, bottom-right, bottom-left. */
export type Radii = [number, number, number, number];

export interface MusicStrip {
  u: number;
  title: Box;
  /** Where the like symbol goes, when there is one: the right end of the song's line. */
  like: Box;
  artist: Box | null;
  bar: { x0: number; x1: number; cy: number; thick: number; dot: number; at: number };
  /** The elapsed time under the bar's left end and the length under its right end. */
  times: { left: Box; right: Box } | null;
  controls: { cy: number; xs: number[]; glyph: number; play: number };
}

export interface SocialLayout {
  u: number;
  /** The top bar: a camera at its left end, the name in its middle, a paper plane at its right. */
  camera: { cx: number; cy: number; size: number };
  name: Box;
  send: { cx: number; cy: number; size: number };
  actions: { cy: number; size: number; xs: number[]; bookmark: number };
  likes: Box;
  caption: Box;
  nav: { cy: number; size: number; xs: number[] };
}

export interface FrameLayout {
  spec: FrameSpec;
  pw: number;
  ph: number;
  film: boolean;
  /** The pocket the print lies in. */
  Pw: number;
  Ph: number;
  rim: number;
  stack: Stack;
  profile: (typeof PROFILES)[Profile];
  /** The plain body's box (Plain's edge, the valley line of the shaped outlines), chin, strip
   *  and tab included, crest and bumps not. */
  body: Box;
  /** Its corner radii. */
  radii: Radii;
  /** How far the shaped outlines reach past `body`. */
  bumps: number;
  /** The whole outline's box. */
  outline: Box;
  /** The bottom side is straight (a stand needs a flat edge to sit on). */
  bottomStraight: boolean;
  /** A plain tab under the body that a base swallows, mm (0 when there is none). */
  tab: number;
  /** How much of the frame's bottom a base hides, mm. */
  hidden: number;
  /** The frame's centre line across: the picture's, which on an instant print turned on its side
   *  is not the print's. The base, the foot, the crest and the strips are centred on it. */
  cx: number;
  /** The window at the back (narrow end), its centre and corner radii. On the face it is
   *  `profile.bevel` bigger per side. */
  window: { cx: number; cy: number; w: number; h: number; radii: Radii };
  /** Where words may go, one box per line, or none. */
  captions: Box[];
  crest: { box: Box; text: Box } | null;
  music: MusicStrip | null;
  social: SocialLayout | null;
  /** The base the frame stands in, or null. */
  base: GrooveBlock | null;
  /** The frame's height and width, tab, strip and crest included. */
  H: number;
  W: number;
}

const CORNER: Record<Corners, number> = { square: 0.8, rounded: 3.5, round: 10 };
/** An instant print's own wide bottom margin, mm: the chin a frame for one has without adding any. */
const CHIN_FILM = 16;

export function frameLayout(spec: FrameSpec, print: Print): FrameLayout {
  const { pw, ph } = print;
  const film = !!print.film;
  const profile = spec.outline === 'squiggle' ? PUFFY : PROFILES[spec.profile];
  const stack = stackOf(film, profile.front);
  const Pw = pw + 2 * FIT.pocketClear;
  const Ph = ph + 2 * FIT.pocketClear;
  // A squiggle's plain body is the line its outer edge swings in to: the band reaches past it by
  // the swing, twice over.
  const rim = spec.outline === 'squiggle' ? SQUIGGLE.e - SQUIGGLE.a + SQUIGGLE.h : RIM[spec.border];

  // The window, narrow end. A chin, a player or a post frames the picture alone on an instant
  // print and hides its white border; an even border shows the whole print less the rim's overlap.
  const f = print.film;
  const pictureOnly = spec.layout !== 'plain' && !!f;
  const win = pictureOnly
    ? { cx: (f!.left - f!.right) / 2, cy: (f!.bottom - f!.top) / 2, w: f!.iw - 2 * FIT.filmInset, h: f!.ih - 2 * FIT.filmInset }
    : { cx: 0, cy: 0, w: pw - 2 * FIT.lipOver, h: ph - 2 * FIT.lipOver };
  const winTop = win.cy + win.h / 2;
  const winBottom = win.cy - win.h / 2;
  // The frame is centred on the picture: an instant print on its side has its wide margin at one
  // end, and the frame grows on the other so the borders either side of the picture match.
  const c0 = win.cx;

  let top = ph / 2 + rim;
  let bottom = -ph / 2 - rim;
  // A chin: under the photo, or over it. On an instant print the margin on that side is part of
  // it already (an instant mini's wide bottom margin is all of a bottom chin); the rest is added.
  const chinTop = spec.layout === 'chin' && spec.chinAt === 'top';
  if (spec.layout === 'chin') {
    if (chinTop) top += f ? Math.max(0, CHIN_FILM - f.top) : 14;
    else bottom -= f ? Math.max(0, CHIN_FILM - f.bottom) : 14;
  }

  // Music: a plaque about twice as wide as its picture, the player across its whole width under
  // the picture (ref 02): the song with its like symbol at the line's end, the artist, the bar with
  // its times, five buttons.
  let music: MusicStrip | null = null;
  let plaqueHalf = pw / 2 + rim + Math.abs(c0);
  if (spec.layout === 'music') {
    plaqueHalf = Math.max(plaqueHalf, 0.95 * win.w);
    const x0 = c0 - plaqueHalf + 7;
    const x1 = c0 + plaqueHalf - 7;
    const sw = x1 - x0;
    const u = clamp(sw / 13, 3.8, 6.5);
    const dot = Math.max(3.2, 0.8 * u);
    const titleTop = winBottom - 0.9 * u;
    const titleBottom = titleTop - 1.5 * u;
    let y = titleBottom;
    let artist: Box | null = null;
    if (spec.artist) {
      artist = { x0, x1, y0: y - 0.3 * u - 1.0 * u, y1: y - 0.3 * u };
      y = artist.y0;
    }
    const barCy = y - 0.7 * u - dot / 2;
    y = barCy - dot / 2;
    let times: MusicStrip['times'] = null;
    if (spec.times) {
      const tTop = y - 0.25 * u;
      const tBottom = tTop - 0.85 * u;
      times = { left: { x0, x1: x0 + sw * 0.3, y0: tBottom, y1: tTop }, right: { x0: x1 - sw * 0.3, x1, y0: tBottom, y1: tTop } };
      y = tBottom;
    }
    const ctrlCy = y - 0.7 * u - 1.05 * u;
    bottom = ctrlCy - 1.05 * u - 0.9 * u;
    const like = 1.3 * u;
    const mid = (titleTop + titleBottom) / 2;
    music = {
      u,
      title: { x0, x1: x1 - like - 2, y0: titleBottom, y1: titleTop },
      like: { x0: x1 - like, x1, y0: mid - like / 2, y1: mid + like / 2 },
      artist,
      bar: { x0, x1, cy: barCy, thick: Math.max(1.2, 0.24 * u), dot, at: 0.38 },
      times,
      controls: { cy: ctrlCy, xs: [-0.4, -0.2, 0, 0.2, 0.4].map((k) => c0 + k * sw), glyph: Math.max(4.4, 1.15 * u), play: 2.0 * u },
    };
  }

  // A social post: a top bar over the picture, actions, likes and a caption under it (ref 25).
  let social: SocialLayout | null = null;
  if (spec.layout === 'social') {
    const u = clamp(win.w / 10, 3.6, 5.5);
    const barCy = winTop + 0.6 * u + 0.75 * u;
    top = barCy + 0.75 * u + 0.6 * u;
    const actCy = winBottom - 0.6 * u - 0.7 * u;
    const likesTop = actCy - 0.7 * u - 0.5 * u;
    const capTop = likesTop - 1.1 * u - 0.4 * u;
    const navCy = capTop - 1.1 * u - 0.6 * u - 0.7 * u;
    bottom = navCy - 0.7 * u - 0.6 * u;
    const size = 1.4 * u;
    const x0 = win.cx - win.w / 2;
    const x1 = win.cx + win.w / 2;
    social = {
      u,
      camera: { cx: x0 + 0.8 * u, cy: barCy, size: 1.5 * u },
      name: { x0: x0 + 2.2 * u, x1: x1 - 2.2 * u, y0: barCy - 0.65 * u, y1: barCy + 0.65 * u },
      send: { cx: x1 - 0.8 * u, cy: barCy, size: 1.4 * u },
      actions: { cy: actCy, size, xs: [x0 + 0.7 * u, x0 + 2.5 * u, x0 + 4.3 * u], bookmark: x1 - 0.7 * u },
      likes: { x0, x1, y0: likesTop - 1.1 * u, y1: likesTop },
      caption: { x0, x1, y0: capTop - 1.1 * u, y1: capTop },
      nav: { cy: navCy, size, xs: [-0.4, -0.2, 0, 0.2, 0.4].map((k) => win.cx + k * win.w) },
    };
  }

  // The outline's corners. An arch rounds its top corners a little more than its border is wide
  // (ref 24). The back plate slides in through the right side, so that side has to stay straight
  // over the plate's whole height: a rounded corner takes a deeper border above or below it.
  const rc = spec.corners === 'round' ? Math.min(CORNER.round, rim + 4) : CORNER[spec.corners];
  const rTop = spec.outline === 'arch' ? clamp(rim + 1.5, 8, 0.22 * (pw + 2 * rim)) : rc;
  if (spec.outline !== 'squiggle') {
    const clearOf = (r: number) => r + FIT.pocketClear + FIT.groove + 1.2;
    top = Math.max(top, ph / 2 + clearOf(rTop));
    bottom = Math.min(bottom, -ph / 2 - clearOf(rc));
  }
  const shaped = spec.outline === 'scallop' || spec.outline === 'ricrac' || spec.outline === 'squiggle';
  const bumps = spec.outline === 'scallop' ? SCALLOP.depth : spec.outline === 'ricrac' ? 4.1 : spec.outline === 'squiggle' ? 2 * SQUIGGLE.a : 0;
  const stands = spec.stand === 'base' || spec.stand === 'block' || spec.stand === 'foot' || spec.stand === 'kickstand';
  const bottomStraight = stands;

  // A base hides the bottom of the frame: a chin moves its words up, a player grows its strip,
  // and an even border gets a plain tab the base swallows. The base is sized by the frame it
  // holds, so the two are solved together; three passes settle it.
  let hidden = 0;
  let tab = 0;
  let base: GrooveBlock | null = null;
  const W0 = 2 * plaqueHalf + 2 * bumps;
  const heightWith = (extra: number) => top + (shaped ? bumps : 0) - (bottom - extra);
  if (spec.stand === 'base' || spec.stand === 'block') {
    const s = r2(stack.T + FIT.baseSlotClear);
    const opts = { flush: true, block: spec.stand === 'block' };
    // Below the photo an even border (no chin there) gets a tab the base swallows.
    const tabbed = spec.layout === 'plain' || chinTop;
    const extraOf = (h: number) => (spec.layout === 'music' || spec.layout === 'social' || tabbed ? h : 0);
    for (let i = 0; i < 3; i++) {
      base = grooveBlock(heightWith(extraOf(hidden)), W0, s, opts);
      hidden = base.frontWall + 1.0;
    }
    if (tabbed) tab = hidden;
    if (spec.layout === 'music' || spec.layout === 'social') bottom -= hidden;
    base = grooveBlock(heightWith(tab), W0, s, opts);
  }

  const body: Box = { x0: c0 - plaqueHalf, x1: c0 + plaqueHalf, y0: bottom - tab, y1: top };
  const W = W0;
  const radii: Radii = [rTop, rTop, tab > 0 ? 0.8 : rc, tab > 0 ? 0.8 : rc];
  // The window's corners follow the outline's, so the border is even all round.
  const wr = (r: number) => Math.max(spec.corners === 'square' && spec.outline !== 'arch' ? 0.8 : 1.5, Math.min(r - rim, Math.min(win.w, win.h) / 2 - 0.5));
  const window = { ...win, radii: [wr(rTop), wr(rTop), wr(rc), wr(rc)] as Radii };

  // The crest above the top edge, for initials.
  let crest: FrameLayout['crest'] = null;
  let outlineTop = top + (shaped ? bumps : 0);
  if (spec.crest) {
    const cw = clamp(0.56 * W, 30, 0.8 * W);
    const ch = clamp(0.24 * W, 13, 24);
    const box = { x0: c0 - cw / 2, x1: c0 + cw / 2, y0: top - 2, y1: top + ch };
    crest = { box, text: { x0: box.x0 + 3, x1: box.x1 - 3, y0: top + 1.5, y1: box.y1 - 2.5 } };
    outlineTop = Math.max(outlineTop, box.y1);
  }

  const outline: Box = {
    x0: body.x0 - bumps,
    x1: body.x1 + bumps,
    y1: outlineTop,
    y0: body.y0 - (shaped && !bottomStraight ? bumps : 0),
  };

  // Words in the chin: one box, or two (a name and a smaller date under it).
  const captions: Box[] = [];
  if (spec.layout === 'chin' && spec.lines > 0) {
    // A ric-rac band reaches about 4.7 mm in from the edge: the words keep clear of it.
    const trim = spec.outline === 'ricrac' ? 3.5 : 0;
    const y0 = chinTop ? winTop + profile.bevel + FIT.captionToWindow : bottom + hidden + FIT.captionToEdge + trim;
    const y1 = chinTop ? top - FIT.captionToEdge - trim : winBottom - profile.bevel - FIT.captionToWindow;
    // The chin's whole width, short of its edges and any chamfer.
    const x0 = body.x0 + FIT.captionToEdge + profile.chamfer + trim;
    const x1 = body.x1 - FIT.captionToEdge - profile.chamfer - trim;
    if (spec.lines === 1) captions.push({ x0, x1, y0, y1 });
    else {
      const split = y0 + (y1 - y0) * 0.36;
      captions.push({ x0, x1, y0: split + 0.6, y1 }, { x0, x1, y0, y1: split - 0.6 });
    }
  }

  return {
    spec,
    pw,
    ph,
    film,
    Pw,
    Ph,
    rim,
    stack,
    profile,
    body,
    radii,
    bumps,
    outline,
    bottomStraight,
    tab,
    hidden,
    cx: c0,
    window,
    captions,
    crest,
    music,
    social,
    base,
    H: outline.y1 - outline.y0,
    W,
  };
}

/** The tallest letters a caption box takes, mm (the em the Text size slider may reach). */
export function captionMax(box: Box): number {
  return Math.max(FIT.minEm, Math.floor(((box.y1 - box.y0) / 0.95) * 2) / 2);
}

/* ---------------- the holder ---------------- */

export interface HolderLayout {
  shape: HolderKind;
  pw: number;
  ph: number;
  film: boolean;
  block: GrooveBlock;
  /** The plan outline's ends: a bar's corners, a pill's round ends. */
  heart: { w: number; h: number; slotY: number } | null;
  /** The words on the front face (x across, y up the face), or null. */
  textBox: Box | null;
}

export function holderLayout(shape: HolderKind, print: Print, withText = true): HolderLayout {
  const { pw, ph } = print;
  const film = !!print.film;
  const s = film ? FIT.slotFilm : FIT.slotPaper;
  if (shape === 'heart') {
    const block = grooveBlock(ph, pw, s);
    return { shape, pw, ph, film, block, heart: heartSize(pw, ph, block), textBox: null };
  }
  const tall = withText;
  const block = grooveBlock(ph, pw, s, { tall });
  if (shape === 'pill') {
    // Round ends need room past the slot.
    const L = block.slotLength + block.D * 0.8;
    const b = { ...block, L };
    return { shape, pw, ph, film, block: b, heart: null, textBox: withText ? frontText(b, L - b.D) : null };
  }
  return { shape, pw, ph, film, block, heart: null, textBox: withText ? frontText(block, block.L - 8) : null };
}

/** The words go on the front face, 2 mm in from its top and bottom edges. */
function frontText(b: GrooveBlock, run: number): Box {
  return { x0: -run / 2, x1: run / 2, y0: 2, y1: b.hb - 2 };
}

/**
 * The smallest heart that holds the slot with 3 mm of heart all round it, reaches 0.30 of the
 * print's height behind it and leaves 8 mm in front: grown in half-millimetre steps.
 */
export function heartSize(pw: number, ph: number, block: GrooveBlock): { w: number; h: number; slotY: number } {
  const depth = block.s / COS + (block.dk + 3) * SIN;
  const half = block.slotLength / 2 + 3;
  for (let w = pw + 8; w < 300; w += 0.5) {
    const h = 0.9 * w;
    const ring = heartRing(w, h, 96);
    const cleftY = h / 2 - w / 4;
    for (let y = -h / 2 + 8; y < h / 2; y += 0.5) {
      const y0 = y - 3;
      const y1 = y + depth + 3;
      if (y1 >= cleftY) break;
      if (h / 2 - y < FIT.heel * ph) break;
      if (rectInside(ring, -half, y0, half, y1)) return { w, h, slotY: y };
    }
  }
  return { w: pw + 40, h: 0.9 * (pw + 40), slotY: 0 };
}

function rectInside(ring: [number, number][], x0: number, y0: number, x1: number, y1: number): boolean {
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pts: [number, number][] = [
      [x0 + (x1 - x0) * t, y0],
      [x0 + (x1 - x0) * t, y1],
      [x0, y0 + (y1 - y0) * t],
      [x1, y0 + (y1 - y0) * t],
    ];
    for (const p of pts) if (!pointInRing(p, ring)) return false;
  }
  return true;
}

/* ---------------- small helpers ---------------- */

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

const r2 = (v: number) => Math.round(v * 100) / 100;
