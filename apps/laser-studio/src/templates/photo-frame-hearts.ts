// A photo frame full of hearts — the Mother's Day and Valentine's frame. Portrait by default: three
// big heart pockets break out of the outline (both top corners and the left side), a cascade of
// small hearts is cut through the right border, and the name sits in a script in the bottom band,
// with a line of message under it.
//
// The three sheets, the photo slot and the stand are `engine/photo-frame.ts`. What is this
// template's own is where the hearts go and how the lettering sits.
//
// THE HEARTS are `plumpHeart` — full round lobes, sides that bow outward, a soft tip — the
// photo's heart, where the blank library's reads as a V. A pocket is cut through the FRONT only
// and has to sit over solid MIDDLE, or the dark floor it is meant to show becomes the edge of the
// print or the empty slot above it. So a heart cannot overlap the window the way the reference's
// left heart does: its inner edge is kept GAP (1.5 mm) clear of the photo slot and it hangs
// OUTWARD instead, and RIM = 4 mm of front round it is what bulges the outline (the same bump on
// all three sheets). Sizes follow the frame's short side: 25 %, 30 % and 23 % for the top-left,
// left and top-right hearts — the reference's big, bigger, smaller — each tipped a little towards
// the photo, as the photo's are.
//
// THE CASCADE. Only the big hearts break the outline. The small ones are cut INSIDE the right
// border, in the strip between the photo slot's keep-out and RIM off the frame's edge (12 mm at
// 4 × 6 with the default border), so the frame's right edge runs straight under the top-right
// heart. A frame whose strip is narrower than the least heart (a border near 18 mm) lets a heart
// poke out rather than drop it.
//
// THE LETTERING sits wholly in the bottom band: the window is a clean rectangle, the name in a
// script sized to the frame's width and fitted to the band, the message under it at a fifth of its
// height, the two centred between the window and the table.
import { bboxOf, placeShapes, type Box, type Shapes } from '@vostok/laser';
import { BED, FRAME_NOTE, GAP, framePieces, holeClear, type FrameGeometry } from '../engine/photo-frame';
import { sizeForCapHeight } from '../engine/metrics';
import { textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { NO_KEYRING } from './keyring';
import { borderField, frameAssemblyFields, photoFields, plumpHeart, readFrame } from './photo-frame-shared';
import { stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Front left standing round every pocket, mm: ≥ 1.3 t. */
const RIM = 4;
/** A heart's height over its width — the reference's plump heart. */
const HEART_H = 0.9;
/** Front between two hearts, at the least, mm: the house's 3 mm between cut-throughs, and a half
 *  for the arcs the pockets are cut with. */
const WEB = 3.5;
/** The least a small heart is, mm: its cleft and tip still cut cleanly in 3 mm stock. */
const MIN_SMALL = 6;
/** Engraved lettering keeps this far inside the frame's sides, mm. */
const SIDE = 12;
/** The band round the lettering, mm: under the window's edge, over the table, between the lines. */
const UNDER = 5;
const FOOT = 6;
const BETWEEN = 3.5;
/** The house floor for engraved lettering, mm of cap height. */
const CAP_FLOOR = 3;

/** Scripts that engrave cleanly at 12–24 mm, and plain faces that hold a 4 mm line. */
const NAME_FACES = ['dancing-script', 'sacramento', 'great-vibes', 'pacifico', 'allura', 'satisfy', 'kaushan-script', 'parisienne'];
const MESSAGE_FACES = ['quicksand', 'poppins', 'montserrat', 'josefin-sans', 'nunito', 'raleway'];

/** The big hearts: each one's width as a share of the frame's short side, and its tilt in degrees
 *  (positive turns the tip right, towards the photo from the left side). */
const BIG = { topLeft: { share: 0.25, tilt: 12 }, left: { share: 0.3, tilt: 8 }, topRight: { share: 0.23, tilt: -10 } };

/**
 * The small hearts' hand, top to bottom: each one's size (× the strip it sits in), where it sits
 * across the strip (0 against the photo's side, 1 against the frame's edge), its tilt in degrees,
 * and how many mm wider than WEB the web under it may open. The photo's run down the side is loose
 * and uneven, so no property keeps a beat — a strict big-small, in-out alternation reads as a
 * zipper, not a hand — and the webs open out down the side, so the cascade thins as it falls.
 */
const TRAIL = [
  { size: 1, across: 0.35, tilt: -10, widen: 1 },
  { size: 0.7, across: 0.85, tilt: 9, widen: 3 },
  { size: 0.55, across: 0.5, tilt: -4, widen: 5 },
  { size: 0.92, across: 0.2, tilt: 12, widen: 7 },
  { size: 0.74, across: 0.65, tilt: -7, widen: 9 },
  { size: 0.58, across: 0.3, tilt: 6, widen: 10 },
  { size: 0.86, across: 0.75, tilt: -12, widen: 11 },
  { size: 0.64, across: 0.45, tilt: 8, widen: 12 },
  { size: 0.8, across: 0.2, tilt: -5, widen: 0 },
];
/** How much of the side's spare height the cascade's widening may take. */
const LOOSE = 0.3;

/** A heart pocket `w` wide, centred on (x, y), turned `rot` degrees. */
const heart = (w: number, x: number, y: number, rot = 0): Shapes => placeShapes([[plumpHeart(w, HEART_H * w)]], x, y, rot);

/** A heart hung on one side of the photo slot: its inner edge on the slot's keep-out, then pushed
 *  outward until it clears — `holeClear` is the rule, the box only its first guess. */
function hang(g: FrameGeometry, w: number, side: -1 | 1, y: number, rot: number): Shapes {
  const inner = g.pocket.w / 2 + GAP;
  const b = bboxOf(heart(w, 0, 0, rot));
  // A hair outside the keep-out, so the float of placing it does not read as a touch.
  let x = side > 0 ? inner + 1e-6 - b.minX : -inner - 1e-6 - b.maxX;
  let h = heart(w, x, y, rot);
  for (let k = 0; k < 200 && !holeClear(g, h); k++) h = heart(w, (x += side * 0.25), y, rot);
  return h;
}

/** The big hearts and the cascade, in frame coordinates. `text` is the lettering's ink, which a
 *  cascade run on down a short frame's band stays 3 mm above. */
function hearts(g: FrameGeometry, count: number, text: Box[]): { holes: Shapes; placed: number } {
  const base = Math.min(g.W, g.H);
  const inner = g.pocket.w / 2 + GAP;
  // A heart hangs outward from the slot, so its width is what the frame grows by on that side:
  // capped so the outline stays on the bed (A5 landscape would otherwise reach 327 mm).
  const reach = BED / 2 - inner - RIM - 2;
  const size = (share: number) => Math.min(share * base, reach);
  const w1 = size(BIG.topLeft.share);
  const w2 = size(BIG.left.share);
  const w3 = size(BIG.topRight.share);
  // The two corner hearts sit a little down from the top edge, so each reads as hung ON the corner —
  // and lower on the biggest frames, where riding over the edge would take the outline off the bed.
  const corner = (w: number, ride: number, tilt: number) => Math.min(g.H - ride * HEART_H * w, BED - 1 - RIM - bboxOf(heart(w, 0, 0, tilt)).maxY);
  const tl = hang(g, w1, -1, corner(w1, 0.12, BIG.topLeft.tilt), BIG.topLeft.tilt);
  // The left heart below it, clear of the corner heart's point by two rims, and never down in the
  // band the lettering holds.
  const h2 = HEART_H * w2;
  const y2 = Math.max(g.band + 3 + h2 / 2, Math.min(0.56 * g.H, bboxOf(tl).minY - 2 * RIM - h2 / 2));
  const left = hang(g, w2, -1, y2, BIG.left.tilt);
  const tr = hang(g, w3, 1, corner(w3, 0.08, BIG.topRight.tilt), BIG.topRight.tilt);
  const out: Shapes = [...tl, ...left, ...tr];

  // The cascade, in the strip between the slot's keep-out and RIM off the edge. Each heart is sized
  // to the strip and fitted to it as turned; where the strip is narrower than the least heart, it
  // hugs the slot and pokes out of the edge instead.
  const sw = g.W / 2 - RIM - inner;
  const trail = TRAIL.slice(0, count).map((t) => {
    let w = Math.max(MIN_SMALL, t.size * sw);
    let b = bboxOf(heart(w, 0, 0, t.tilt));
    if (b.maxX - b.minX > sw) {
      w = Math.max(MIN_SMALL, (w * sw) / (b.maxX - b.minX));
      b = bboxOf(heart(w, 0, 0, t.tilt));
    }
    const x = inner - b.minX + t.across * Math.max(0, sw - (b.maxX - b.minX));
    return { ...t, w, x, up: b.maxY, down: -b.minY };
  });
  // From under the top-right heart down the side; the webs open out as far as LOOSE of the spare
  // height allows. A short frame's cascade may run on down the band, 3 mm above any lettering that
  // reaches the strip.
  const top = bboxOf(tr).minY - WEB;
  const low = Math.max(RIM + 1, ...text.filter((b) => b.maxX > inner - 3).map((b) => b.maxY + 3));
  const tight = trail.reduce((s, t, i) => s + t.up + t.down + (i ? WEB : 0), 0);
  const wide = trail.reduce((s, t, i) => s + (i < trail.length - 1 ? t.widen : 0), 0);
  const ease = wide > 0 ? clamp((LOOSE * (top - low - tight)) / wide, 0, 1) : 0;
  let placed = 0;
  let y = top - (trail[0]?.up ?? 0);
  for (const [i, t] of trail.entries()) {
    if (y - t.down < low - 1e-6) break;
    let x = t.x;
    let h = heart(t.w, x, y, t.tilt);
    // The strip is clear of the slot by construction; this only ever moves a heart that pokes out.
    for (let k = 0; k < 200 && !holeClear(g, h); k++) h = heart(t.w, (x += 0.25), y, t.tilt);
    out.push(...h);
    placed++;
    const next = trail[i + 1];
    if (next) y -= t.down + WEB + ease * t.widen + next.up;
  }
  return { holes: out, placed };
}

// ------------------------------------------------------------------------ the lettering --

interface Lettering { layers: DesignLayer[]; boxes: Box[]; warnings: string[] }
interface Line { layer: DesignLayer | null; box: Box | null; cap: number }

/** One line of text at caps `cap` tall, shrunk until its ink is no wider than `maxW` and no taller
 *  than `maxH`. Where textLayer left it; `place` moves it. */
async function line(v: Values, key: string, fontKey: string, cap: number, maxW: number, maxH: number, id: string, label: string): Promise<Line> {
  const text = str(v, key).trim();
  if (!text) return { layer: null, box: null, cap };
  const font = str(v, fontKey);
  const spec = { text, font, symbols: readSymbols(v) };
  let [l] = await textLayer({ ...spec, size: await sizeForCapHeight(font, cap) }, 'engrave', id, label);
  if (!l) return { layer: null, box: null, cap };
  let b = bboxOf(l.shapes);
  const k = Math.min(1, maxW / Math.max(1e-6, b.maxX - b.minX), maxH / Math.max(1e-6, b.maxY - b.minY));
  if (k < 0.999) {
    [l] = await textLayer({ ...spec, size: await sizeForCapHeight(font, cap * k) }, 'engrave', id, label);
    if (!l) return { layer: null, box: null, cap };
    b = bboxOf(l.shapes);
  }
  return { layer: l, box: b, cap: cap * k };
}

/** The line's ink centred on x = 0 with its top at `top`. */
function place(l: Line, top: number): Line {
  if (!l.layer || !l.box) return l;
  const dx = -(l.box.minX + l.box.maxX) / 2;
  const dy = top - l.box.maxY;
  return { ...l, layer: { ...l.layer, shapes: placeShapes(l.layer.shapes, dx, dy, 0) }, box: { minX: l.box.minX + dx, maxX: l.box.maxX + dx, minY: l.box.minY + dy, maxY: top } };
}

const heightOf = (b: Box | null) => (b ? b.maxY - b.minY : 0);

async function lettering(g: FrameGeometry, v: Values): Promise<Lettering> {
  const warnings: string[] = [];
  const maxW = g.W - 2 * SIDE;
  const room = g.band - UNDER - FOOT;
  // The name as big as the photo's: its caps 17 % of the frame's width (12–26 mm). The message is
  // sized from the name as set, never from the frame — about a fifth of it, 3.5 to 6 mm — so the
  // name stays the hero at every preset.
  const cap = clamp(0.17 * g.W, 12, 26);
  const msgCap = (name: Line) => clamp(0.19 * name.cap, 3.5, 6);
  let name = await line(v, 'name', 'font', cap, maxW, Infinity, 'name', 'Name');
  let msg = await line(v, 'message', 'messageFont', msgCap(name), maxW, Infinity, 'message', 'Message');
  // The band holds both, ink and all: the name takes what the message leaves of it. The message
  // follows the name down, which gives a little back — twice round settles it.
  for (let i = 0; i < 3 && name.box; i++) {
    const fit = room - (msg.box ? heightOf(msg.box) + BETWEEN : 0);
    if (heightOf(name.box) <= fit + 0.02 && (name.cap >= cap - 1e-9 || heightOf(name.box) >= fit - 0.05)) break;
    name = await line(v, 'name', 'font', cap, maxW, fit, 'name', 'Name');
    msg = await line(v, 'message', 'messageFont', msgCap(name), maxW, Infinity, 'message', 'Message');
  }
  // Centred between the window and the table.
  const total = heightOf(name.box) + (name.box && msg.box ? BETWEEN : 0) + heightOf(msg.box);
  const top = FOOT + (room + total) / 2;
  name = place(name, top);
  msg = place(msg, name.box ? name.box.minY - BETWEEN : top);
  if (name.layer && name.cap < CAP_FLOOR) warnings.push('The name is engraved under 3 mm tall to fit — a shorter one reads better.');
  if (msg.layer && msg.cap < CAP_FLOOR) warnings.push('The message is engraved under 3 mm tall to fit — a shorter one reads better.');
  return {
    layers: [name.layer, msg.layer].filter((l): l is DesignLayer => !!l),
    boxes: [name.box, msg.box].filter((b): b is Box => !!b),
    warnings,
  };
}

// ------------------------------------------------------------------------ the template --

export const photoFrameHearts: TemplateDef = {
  id: 'photo-frame-hearts',
  name: 'Heart photo frame',
  blurb: 'A standing frame with heart pockets and a name.',
  tags: ['gift', 'home', 'engrave + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'Mama', placeholder: 'Mama, Nan, Anna & Ben…', maxLength: 18 },
    { kind: 'text', key: 'message', label: 'Message', panel: 'right', section: 'Text', value: 'Thank you for being you', placeholder: 'A line under the name', maxLength: 40 },
    // ---------------------------------------------------------- LEFT --
    ...photoFields('portrait'),
    { kind: 'font', key: 'font', label: 'Name font', section: 'Font', value: 'dancing-script', recommended: NAME_FACES, previewFrom: 'name' },
    { kind: 'font', key: 'messageFont', label: 'Message font', section: 'Font', value: 'quicksand', recommended: MESSAGE_FACES, previewFrom: 'message' },
    ...frameAssemblyFields(),
    {
      kind: 'stepper', key: 'hearts', label: 'Small hearts', section: 'Frame', value: 5, min: 0, max: 9,
      help: 'The little hearts down the right side.',
    },
    borderField(),
  ],

  async build(v) {
    // The bottom band holds a script name and a line under it: the border plus 20 mm.
    const g = readFrame(v, { band: (s) => s + 20, windowCorner: 2 });
    const asked = clamp(Math.round(num(v, 'hearts')), 0, 9);
    const text = await lettering(g, v);
    const { holes, placed } = hearts(g, asked, text.boxes);
    const pieces = framePieces(g, { holes, rim: RIM, front: text.layers });
    const warnings = [...pieces.warnings, ...text.warnings];
    if (placed < asked) warnings.push(`${placed} of the ${asked} small hearts fit on a frame this size.`);
    const { box: _box, warnings: _w, ...rest } = pieces;
    return { ...rest, keyring: NO_KEYRING, ...(warnings.length ? { warnings } : {}) };
  },

  fileName: (v) => stem('heart-frame', str(v, 'name') || 'frame'),

  exportNote: FRAME_NOTE,
};
