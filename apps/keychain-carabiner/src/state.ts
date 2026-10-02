// 1. STATE — every setting the generator has, in one plain object.
//    Save / Load serialise exactly this, so keep it JSON-friendly.
export type RGB = [number, number, number];

/** How the gate cut is sized: the strip width of the S-cut, which is also the clearance
 *  the two halves have to slide past each other. */
export type GateFit = 'soft' | 'normal' | 'firm';
export const GATE_GAP_MM: Record<GateFit, number> = { soft: 0.5, normal: 0.45, firm: 0.4 };

/**
 * What the hook hangs things by.
 *
 *  `swivel`  print-in-place swivel: a barrel in a window, and a ring (or the charm) on its stem.
 *  `loop`    a plain ring on the hook. The safe path on any printer.
 *  `none`    nothing: the first chain ring goes straight through the hook's own band.
 */
export type Attach = 'swivel' | 'loop' | 'none';

/** Where the charm goes, when there is one: on the end of the chain, or straight on the
 *  swivel's stem with no chain at all (Ian's render). */
export type CharmMount = 'chain' | 'swivel';

/** A charm is a filled silhouette, or the same silhouette as a band (a frame). */
export type CharmFill = 'solid' | 'frame';

/**
 * What the charm's symbol does to the charm.
 *
 *  `cut`      a hole through, with the glyph's own holes filled — a cat's eyes would be
 *             islands floating in mid-air otherwise.
 *  `engrave`  recessed into the face; islands stay attached to the floor, so eyes survive.
 *  `raise`    stands proud of the face in its own colour.
 */
export type CharmIconStyle = 'cut' | 'engrave' | 'raise';

/** Every top and bottom edge: a flat 45° bevel like the clicker's, or a round-over. */
export type EdgeStyle = 'chamfer' | 'round';

/**
 * A symbol id is either a symbol-font glyph id ("favorite", "pets") or one of the shape
 * library's silhouettes as `shape:<id>` ("shape:heart") — the same clean outlines the parts
 * are made from. The built-ins are the first picks because they are the cleanest.
 */
export const SHAPE_ICON_PREFIX = 'shape:';

/**
 * How the chain is made.
 *
 *  `open`  every link is its own flat part with a slit, closed by hand — any shape.
 *  `pip`   print in place: Cuban-style octagon links come off the bed already interlocked,
 *          grown out of the hook's own loop. Fewer choices (straight facets are what let the
 *          crossings print), no assembly.
 */
export type ChainMode = 'open' | 'pip';

/** The proportions of a print-in-place link: long axis over short axis. */
export type PipAspect = 'round' | 'oval' | 'long' | 'cuban';
/** `cuban` is the chunky look: short, wide links with the fattest bar the crossings allow. */
export const PIP_ASPECT: Record<PipAspect, number> = { round: 1, oval: 1.6, long: 2.2, cuban: 1.35 };

/** The first element of a chain grown out of the hook: one more link, or the small loop. */
export type PipRoot = 'link' | 'loop';

export interface SetSettings {
  mode: ChainMode;

  hookShape: string;
  /** Long axis, mm. */
  hookSize: number;
  /** Band width, mm. */
  hookBar: number;
  hookThick: number;
  gateFit: GateFit;
  attach: Attach;
  /** Diameter of the swivel's stem, mm — the one piece that carries the whole chain. Thicker
   *  holds more; it needs a thicker hook to sit in. */
  swivelStem: number;
  /** Bar of every loop — hook, charm, swivel ring — mm. The openings are not settings: each
   *  one is sized to what passes through it (see `LOOP_CLEARANCE` in the builder). */
  loopBar: number;

  /** Symbol on the hook; '' for none. */
  icon: string;
  /** Paint the symbol in the hook's colour — one filament, no inlay. */
  iconSameColor: boolean;
  iconSize: number;
  /** Where round the hook the symbol sits: degrees from the hook's centre, 0 = right, 90 = top. */
  iconAngle: number;
  /** Push the symbol out (+) or in (−) from the outer edge, mm. */
  iconOffset: number;
  /** Turn the symbol on the face, degrees. */
  iconRotate: number;
  /** Stand the symbol proud of the hook's face by this much, mm. 0 = flush inlay. */
  iconRaise: number;

  linkShape: string;
  linkCount: number;
  linkSize: number;
  linkBar: number;
  linkThick: number;
  /** Plain round split rings at each end of the chain, so any shape hooks on. 0–4. */
  connectorRings: number;
  /** Extra opening in a connector ring beyond what has to pass through it, mm. */
  connectorExtra: number;

  /** The print-in-place chain. Its own numbers, so switching modes changes nothing above. */
  pipLinkCount: number;
  /** Outer long axis of a link, mm. */
  pipLinkSize: number;
  pipLinkAspect: PipAspect;
  pipLinkBar: number;
  /** Height of the chain, mm. The bridge over a crossing and the low top under one each get
   *  half of it less the gap, so this is what makes the overhangs chunkier. */
  pipLinkThick: number;
  /** Plain round split rings on the far end of the chain, for whatever hangs there. 0–2. */
  pipConnectorRings: number;
  /** Grown out of the hook's loop (or its swivel), or printed as its own part and joined to
   *  the hook's ordinary loop with a connector ring — another colour, another plate. */
  pipAttached: boolean;
  /** What the chain grows from: a link like the others (default), or the small teardrop loop. */
  pipRoot: PipRoot;

  /** The charm is an extra. Off, and the chain ends in whatever the user hangs on it. */
  charm: boolean;
  charmMount: CharmMount;
  charmShape: string;
  charmSize: number;
  charmThick: number;
  charmFill: CharmFill;
  charmBar: number;
  /** Symbol on the charm; '' for none. */
  charmIcon: string;
  charmIconSize: number;
  charmIconStyle: CharmIconStyle;

  edge: EdgeStyle;
  /** Bevel / round-over size, mm. */
  edgeSize: number;

  /** Every part in the hook's colour — one filament. */
  oneColor: boolean;
  hookColor: RGB;
  iconColor: RGB;
  linkColor: RGB;
  charmColor: RGB;
}

export const DEFAULT_SETTINGS: SetSettings = {
  mode: 'open',
  hookShape: 'oval',
  hookSize: 32,
  hookBar: 3.2,
  hookThick: 5,
  gateFit: 'normal',
  attach: 'swivel',
  swivelStem: 2.4,
  loopBar: 2,

  icon: 'shape:heart',
  iconSameColor: true,
  iconSize: 11,
  iconAngle: 40,
  iconOffset: 0,
  iconRotate: 0,
  iconRaise: 0,

  linkShape: 'circle',
  linkCount: 3,
  linkSize: 15,
  linkBar: 2.6,
  linkThick: 4,
  connectorRings: 2,
  connectorExtra: 2,

  pipLinkCount: 4,
  pipLinkSize: 22,
  pipLinkAspect: 'oval',
  pipLinkBar: 3.2,
  pipLinkThick: 6,
  pipConnectorRings: 1,
  pipAttached: true,
  pipRoot: 'link',

  charm: false,
  charmMount: 'chain',
  charmShape: 'flower',
  charmSize: 22,
  charmThick: 5,
  charmFill: 'solid',
  charmBar: 3,
  charmIcon: 'shape:star',
  charmIconSize: 11,
  charmIconStyle: 'cut',

  edge: 'chamfer',
  edgeSize: 0.6,

  oneColor: false,
  hookColor: [255, 205, 92],
  iconColor: [255, 140, 170],
  linkColor: [120, 205, 220],
  charmColor: [186, 160, 255],
};

/** Merge a loaded project (or a share URL) over the defaults, dropping anything unrecognised
 *  and anything of the wrong type. A loaded file is input, not truth. */
export function coerceSettings(raw: unknown): SetSettings {
  const out: SetSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const rec = out as unknown as Record<string, unknown>;
  const src = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (!(k in out)) continue;
    const current = rec[k];
    if (typeof current === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
      if (Number.isFinite(n)) rec[k] = n;
    } else if (typeof current === 'boolean') {
      if (typeof v === 'boolean') rec[k] = v;
    } else if (typeof current === 'string') {
      if (typeof v === 'string') rec[k] = v;
    } else if (Array.isArray(current)) {
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) rec[k] = v.slice(0, 3);
      else if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) rec[k] = hexToRgb(v);
    }
  }
  // Earlier saves folded the charm's mounting into the attachment.
  const oldAttach = src.attach;
  if (oldAttach === 'swivel-eye') out.attach = 'swivel';
  if (oldAttach === 'swivel-charm') { out.attach = 'swivel'; out.charm = true; out.charmMount = 'swivel'; }
  if (oldAttach === 'eye') out.attach = 'loop';
  if (!['open', 'pip'].includes(out.mode)) out.mode = DEFAULT_SETTINGS.mode;
  if (!(out.pipLinkAspect in PIP_ASPECT)) out.pipLinkAspect = DEFAULT_SETTINGS.pipLinkAspect;
  if (!['link', 'loop'].includes(out.pipRoot)) out.pipRoot = DEFAULT_SETTINGS.pipRoot;
  if (!(out.gateFit in GATE_GAP_MM)) out.gateFit = DEFAULT_SETTINGS.gateFit;
  if (!['swivel', 'loop', 'none'].includes(out.attach)) out.attach = DEFAULT_SETTINGS.attach;
  if (!['chain', 'swivel'].includes(out.charmMount)) out.charmMount = DEFAULT_SETTINGS.charmMount;
  if (!['solid', 'frame'].includes(out.charmFill)) out.charmFill = DEFAULT_SETTINGS.charmFill;
  if (!['cut', 'engrave', 'raise'].includes(out.charmIconStyle)) out.charmIconStyle = DEFAULT_SETTINGS.charmIconStyle;
  if (!['chamfer', 'round'].includes(out.edge)) out.edge = DEFAULT_SETTINGS.edge;
  return out;
}

export function hexToRgb(hex: string): RGB {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

export function rgbToHex(c: RGB): string {
  return `#${c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}
