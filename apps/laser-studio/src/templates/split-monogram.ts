// Split monogram: one big Roman capital cut through by a horizontal slot, a name running along
// the slot in script, and the whole thing welded into a single piece. A pair of rules runs
// through the slot above and below the name and out to the frame — they are the detail that
// makes the split read as designed rather than broken, and in a cut piece they are also what
// physically holds the three parts together. The frame is optional: nothing, a ring, a disc, a
// scalloped disc or a laurel wreath.
//
// Sold today as a 26-file static alphabet set with the name baked in; here it is one form.
//
// HOW IT IS BUILT, in two modes:
//
//  * no body (`none` / `ring` / `laurel`) — the lettering IS the piece. The body is
//    frame ∪ letter ∪ name ∪ rails handed to `blank: { kind: 'shape' }`, which the engine
//    unions; the split is then ONE cut layer, the slot rectangle with the name and the rails
//    held out of it by `minus`, so `plate − (band − name − rails)` = everything outside the
//    band, plus the name and the rails. That identity is the whole trick: a cut can only
//    remove, so the name has to be body, and the band has to spare it.
//    `DesignLayer.grow` is a LAYER property and here the lettering is body, so `nameWeld` and
//    a positive `letterWeld` are applied by `dilate()` in split-monogram-frames.ts instead.
//
//  * solid body (`disc` / `scallop`) — the frame is the plate and the lettering is layers, so
//    the initial is a plain `keep: [topBand, bottomBand]` layer and `grow` does the welds.
import { bboxOf, blankById, blankSilhouette, circleRing, mapShapes, placeShapes, roundedRectRing, scallopDiscRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { readSymbols } from '../symbols/model';
import { textLayer } from '../engine/text';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { dilate, discShapes, laurelWreathShapes, ringFrameShapes, scallopHinge, strokeRun } from './split-monogram-frames';
import { keyringFields, keyringFrom } from './keyring';
import { inscribedPoint } from '../engine/inscribe';
import { insideUnion, nearestBridge } from '../engine/editorGeometry';
import { stem } from './shared';
import { bool, num, str, type Field, type TemplateDef } from './types';

type Pt = [number, number];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** One decimal, no trailing zero. */
const fmt = (n: number) => Number(n.toFixed(1)).toString();
/** Every glyph is built at this em and scaled afterwards: outlines scale linearly, so one font
 *  call per run is enough and the ink box lands exactly where the arithmetic says. */
const NOMINAL = 100;

const scale = (s: Shapes, k: number): Shapes => (Math.abs(k - 1) < 1e-9 ? s : mapShapes(s, ([x, y]) => [x * k, y * k]));
const rectRing = (x0: number, y0: number, x1: number, y1: number): CutRing => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ------------------------------------------------------------------- the frame thumbs --

// A serif capital "I" — stem and two serifs — reading as "just the letter, no frame".
const NO_FRAME_THUMB = 'M12 5 h16 v4 h-5 v22 h5 v4 h-16 v-4 h5 v-22 h-5 Z';

/** A plain annulus from the formula the ring frame itself uses — two arcs of opposite sweep. */
function ringFrameThumb(widthPct: number): string {
  const R = 17;
  const r = R * (1 - widthPct / 100);
  const arc = (rad: number, sweep: 0 | 1) => `M${20 + rad} 20 A${rad} ${rad} 0 1 ${sweep} ${20 - rad} 20 A${rad} ${rad} 0 1 ${sweep} ${20 + rad} 20 Z`;
  return `${arc(R, 0)} ${arc(r, 1)}`;
}

/** Islands → a 40 × 40 path, the way `blankSilhouette` does it, for shapes with no blank. */
function shapesThumbPath(shapes: Shapes): string {
  const b = bboxOf(shapes);
  const k = 34 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const n = (val: number) => val.toFixed(2);
  return shapes.flat().map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`).join(' ');
}

const silhouetteOf = (id: string): string | undefined => {
  const def = blankById(id);
  return def ? blankSilhouette(def) : undefined;
};

// ---------------------------------------------------------------------- the lettering --

interface Composed {
  /** Centred on the origin, at the nominal em. */
  shapes: Shapes;
  /** The ink height the split is measured against — the centre letter's, in a trio. */
  refH: number;
  width: number;
  height: number;
}

/**
 * The initials as one block, at the nominal em.
 *
 * Three initials get the First · LAST · Middle convention: the
 * surname in the middle at full size, the given names either side at 0.62 of it, and all three
 * MIDLINE-aligned — ink-box centres on one horizontal, never baselines, which is what stops an
 * "A" beside a "J" reading as a stumble. Two, or four and up, are set at one size.
 */
async function composeInitials(text: string, font: string, trackPct: number): Promise<Composed | null> {
  const chars = Array.from(text).filter((c) => c.trim() !== '');
  if (!chars.length) return null;
  const trio = chars.length === 3;
  const order = trio ? [0, 2, 1] : chars.map((_, i) => i);
  const ems = order.map((_, j) => (trio && j !== 1 ? 0.62 : 1));
  const built = await Promise.all(order.map((i) => textLayer({ text: chars[i]!, font, size: NOMINAL }, 'off')));

  const runs = built.map((layers, j) => {
    const s = scale(layers.flatMap((l) => l.shapes), ems[j]!);
    return { shapes: s, box: bboxOf(s) };
  }).filter((run) => run.shapes.length > 0);
  if (!runs.length) return null;

  const refH = trio && runs.length === 3 ? runs[1]!.box.maxY - runs[1]!.box.minY : Math.max(...runs.map((run) => run.box.maxY - run.box.minY));
  const track = (Math.max(0, trackPct) / 100) * refH;

  const out: Shapes = [];
  let cursor = 0;
  for (const run of runs) {
    const b = run.box;
    out.push(...placeShapes(run.shapes, cursor - b.minX, -(b.minY + b.maxY) / 2, 0));
    cursor += b.maxX - b.minX + track;
  }
  const box = bboxOf(out);
  const centred = placeShapes(out, -(box.minX + box.maxX) / 2, -(box.minY + box.maxY) / 2, 0);
  return { shapes: centred, refH, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

// --------------------------------------------------------------------------- the rails --

/** A rail: a full-width bar through the slot, ended either on a circle (it crosses the frame
 *  and welds to it) or radiused in free air. */
function railShape(yLo: number, yHi: number, bound: { circle: number } | { halfW: number }, steps = 28): Shapes {
  if (yHi - yLo < 1e-4) return [];
  if ('halfW' in bound) {
    const w = Math.max(1, bound.halfW * 2);
    const h = yHi - yLo;
    // Free ends, so a rail hanging in air is radiused rather than a sharp thin corner (§4).
    return placeShapes([[roundedRectRing(w, h, Math.max(0, Math.min(0.6, h / 2 - 0.01)))]], 0, (yLo + yHi) / 2, 0);
  }
  const R = bound.circle;
  const half = (y: number) => Math.sqrt(Math.max(0, R * R - y * y));
  const ring: CutRing = [];
  for (let i = 0; i <= steps; i++) {
    const y = yLo + (i / steps) * (yHi - yLo);
    ring.push([half(y), y]);
  }
  for (let i = steps; i >= 0; i--) {
    const y = yLo + (i / steps) * (yHi - yLo);
    ring.push([-half(y), y]);
  }
  return [[ring]];
}

// ------------------------------------------------------------------------ the template --

/** The closest two islands' outlines come, mm — every vertex of each against every edge of the
 *  other. Only ever run on a dot and its near neighbours, so the cost is a few thousand tests. */
function gapBetween(a: Shapes[number], b: Shapes[number]): number {
  const toEdges = (p: readonly number[], island: Shapes[number]) => {
    let d = Infinity;
    for (const r of island) {
      for (let k = 0; k < r.length; k++) {
        const u = r[k]!, w = r[(k + 1) % r.length]!;
        const vx = w[0] - u[0], vy = w[1] - u[1];
        const t = Math.max(0, Math.min(1, ((p[0]! - u[0]) * vx + (p[1]! - u[1]) * vy) / (vx * vx + vy * vy || 1e-12)));
        d = Math.min(d, Math.hypot(p[0]! - u[0] - t * vx, p[1]! - u[1] - t * vy));
      }
    }
    return d;
  };
  let best = Infinity;
  for (const r of a) for (const p of r) best = Math.min(best, toEdges(p, b));
  for (const r of b) for (const p of r) best = Math.min(best, toEdges(p, a));
  return best;
}

/** How wide a bar tying a loose part of the name on is drawn, mm, before the name's border grows
 *  it. `nearestBridge` narrows it to the smaller piece's own size, so it never swallows a dot. */
const NAME_BAR = 1.5;

/**
 * Bars that tie every loose part of the name — an i's or j's dot, a whole short word — to the
 * rest of the piece.
 *
 * The rails come down to the name's INK box, which its tallest capital and lowest descender set,
 * so whatever sits inside that box without touching a neighbour floats: the dot of the i in
 * "Jiggy", and in "the Garcias" the whole word "the", which the G's swash is taller and deeper
 * than on both sides. Both came off the bed as a second piece on an ordinary surname.
 *
 * The islands are grouped by what already TOUCHES (outline to outline, not box to box — a slanted
 * script i's dot sits inside its own stem's box), and every group that does not reach a rail is
 * joined to the nearest island or rail with the short bar the engine's hug uses for the same job:
 * a dot to its own stem, a word along the baseline gap to the next. "Within what the border
 * closes" is deliberately not counted as touching: the Garcias dot is 1.1 mm off its stem, which
 * the 0.7 mm border closes on paper to a neck a quarter of a millimetre wide, and a join that thin
 * is what the kerf takes.
 */
function nameBars(name: Shapes, rails: Shapes): Shapes {
  if (!name.length || !rails.length) return [];
  const n = name.length;
  const boxes = [...name, ...rails].map((isl) => bboxOf([isl]));
  const all: Shapes = [...name, ...rails];
  type B = (typeof boxes)[number];
  const meets = (a: B, b: B) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
  // Overlapping counts as touching too: two crossing outlines need not have a vertex of one within
  // 0.05 mm of an edge of the other, but one of them has a vertex inside the other.
  const inside = (a: Shapes[number], b: Shapes[number]) => a.some((r) => r.some((p) => insideUnion([b], p)));
  const touching = (i: number, j: number) =>
    meets(boxes[i]!, boxes[j]!) && (gapBetween(all[i]!, all[j]!) < 0.05 || inside(all[i]!, all[j]!) || inside(all[j]!, all[i]!));
  // Union-find over name islands AND rails; every rail is one node already holding the piece.
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (i: number, j: number) => { parent[find(i)] = find(j); };
  for (let r = n + 1; r < all.length; r++) join(r, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < all.length; j++) if (find(i) !== find(j) && touching(i, j)) join(i, j);
  }
  const out: Shapes = [];
  for (let guard = 0; guard < n; guard++) {
    const loose = [...Array(n).keys()].find((i) => find(i) !== find(n));
    if (loose === undefined) break;
    const group = [...Array(n).keys()].filter((i) => find(i) === find(loose));
    const others = [...Array(all.length).keys()].filter((i) => find(i) !== find(loose));
    // The one the bar will land on: the nearest island outside the group.
    let to = others[0]!, best = Infinity;
    for (const o of others) {
      for (const g of group) {
        const d = gapBetween(all[g]!, all[o]!);
        if (d < best) { best = d; to = o; }
      }
    }
    out.push(...nearestBridge(group.map((i) => all[i]!), [all[to]!], NAME_BAR));
    join(loose, to);
  }
  return out;
}

export const splitMonogram: TemplateDef = {
  id: 'split-monogram',
  name: 'Split monogram',
  blurb: 'One big initial, split by a name in script, welded into a single piece — with an optional ring, disc or wreath frame.',
  tags: ['sign', 'cut'],
  fields: [
    // -------------------------------------------------- RIGHT: the initial and its font --
    {
      kind: 'text', key: 'initials', label: 'Initial(s)', panel: 'right', section: 'Initial',
      value: 'M', placeholder: 'A letter or two', maxLength: 3, symbols: false,
    },
    // Both pickers sit in ONE Font category, each named for its role: two categories called
    // "Initial" and "Name" that each held a bare font list put a font list where the rail opens.
    {
      kind: 'font', key: 'letterFont', label: 'Initial font', panel: 'right', section: 'Font',
      value: 'cinzel',
      // Roman capitals with a stem thick enough to survive a 3 mm sheet at this size, each built
      // and measured with the harness (tests/node/split-monogram.test.mjs §6).
      recommended: ['cinzel', 'cinzel-decorative', 'marcellus', 'playfair-display', 'libre-baskerville', 'eb-garamond', 'abril-fatface', 'spectral'],
      help: 'Any face works, thin strokes are thickened automatically to suit your sheet.',
    },

    // ------------------------------------------------------ RIGHT: the name and its font --
    {
      kind: 'text', key: 'name', label: 'Name across the split', panel: 'right', section: 'Name',
      value: 'the Marshalls', placeholder: 'A name', maxLength: 28, symbols: true,
    },
    {
      kind: 'font', key: 'nameFont', label: 'Name font', panel: 'right', section: 'Font',
      value: 'parisienne',
      // Scripts whose joined letters survive being cut at this size; Great Vibes is here for the
      // look, and its hairlines are the reason Name border exists.
      recommended: ['parisienne', 'allura', 'dancing-script', 'sacramento', 'great-vibes', 'alex-brush', 'pinyon-script'],
      help: 'The finer the script, the more Name border it needs.',
    },

    // ----------------------------------------------------- LEFT: "Split" (opens first) --
    {
      kind: 'number', key: 'splitPct', label: 'Split', section: 'Split',
      value: 21, min: 14, max: 32, step: 1, unit: '%',
      help: 'Wider reads as a banner, narrower as a plain letter.',
    },
    {
      kind: 'number', key: 'splitRise', label: 'Raise the split', section: 'Split',
      value: 4, min: 0, max: 12, step: 1, unit: '%',
      help: 'A small lift reads as centred, since serif feet sit low.',
    },
    {
      kind: 'toggle', key: 'rules', label: 'Rules through the split', section: 'Split',
      value: true,
      help: 'They physically hold the letter, name and frame together.',
    },
    {
      kind: 'number', key: 'ruleWeight', label: 'Rule weight', section: 'Split',
      value: 10, min: 4, max: 25, step: 1, unit: '%',
      visibleWhen: (v) => bool(v, 'rules'),
      help: 'Floored at your material’s thickness, however low you set it.',
    },

    // ---------------------------------------------------------- LEFT: "Frame & size" --
    {
      kind: 'thumbs', key: 'frame', label: 'Frame', section: 'Frame & size',
      value: 'ring', columns: 3,
      options: [
        { value: 'none', label: 'None', svgPath: NO_FRAME_THUMB },
        { value: 'ring', label: 'Ring', svgPath: ringFrameThumb(9) },
        { value: 'disc', label: 'Disc', svgPath: silhouetteOf('circle') ?? shapesThumbPath(discShapes(20)) },
        { value: 'scallop', label: 'Scallop', svgPath: silhouetteOf('scallop-disc') ?? shapesThumbPath([[scallopDiscRing(6, 16)]]) },
        // Fatter leaves than the real wreath cuts: at icon scale a 0.16 R leaf is two pixels and
        // the tile is a plain ring, which is exactly what Ring's tile already shows.
        { value: 'laurel', label: 'Laurel', svgPath: shapesThumbPath(laurelWreathShapes({ R: 100, pairs: 7, openDeg: 28, ribW: 6, leafMax: 0.3, leafRatio: 0.45 }).shapes) },
      ],
      help: 'A disc or scallop adds an Engrave or Cut choice.',
    },
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Frame & size',
      value: 200, min: 60, max: 400, step: 1, unit: 'mm',
      help: 'With no frame, the width can end up wider than this.',
    },
    {
      kind: 'number', key: 'ringWidth', label: 'Ring width', section: 'Frame & size',
      value: 9, min: 5, max: 18, step: 0.5, unit: '%',
      visibleWhen: (v) => str(v, 'frame') === 'ring',
      help: 'Never comes out below twice your material’s thickness.',
    },
    {
      kind: 'stepper', key: 'scallops', label: 'Scallops', section: 'Frame & size',
      value: 16, min: 10, max: 28,
      visibleWhen: (v) => str(v, 'frame') === 'scallop',
      help: 'How many scalloped bumps run around the edge.',
    },
    {
      kind: 'stepper', key: 'leafPairs', label: 'Leaf pairs', section: 'Frame & size',
      value: 7, min: 4, max: 10,
      visibleWhen: (v) => str(v, 'frame') === 'laurel',
      help: 'How many pairs of leaves run up the wreath.',
    },
    {
      kind: 'number', key: 'wreathOpen', label: 'Wreath opening', section: 'Frame & size',
      value: 28, min: 10, max: 60, step: 1, unit: '°',
      visibleWhen: (v) => str(v, 'frame') === 'laurel',
      help: 'How wide the gap is at the top of the wreath.',
    },
    // What the disc or scallop does with the letter — a frame's question, asked only of the two
    // frames that are solid behind it.
    {
      kind: 'select', key: 'op', label: 'Letters', section: 'Frame & size',
      value: 'engrave',
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'cut', label: 'Cut out' }],
      visibleWhen: (v) => ['disc', 'scallop'].includes(str(v, 'frame')),
      help: 'Cut out shows whatever is behind the disc through it.',
    },
    {
      kind: 'toggle', key: 'innerRule', label: 'Inner rule', section: 'Frame & size',
      value: true,
      visibleWhen: (v) => ['disc', 'scallop'].includes(str(v, 'frame')),
      help: 'A scored double line just inside the edge.',
    },
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Frame & size',
      value: 3, min: 2, max: 8, step: 0.5, unit: 'mm',
      help: 'Sets the ring’s minimum width and the rails’ floor.',
    },

    // -------------------------------------------------------------- LEFT: "Lettering" --
    // The initial's knobs, then the name's: both sets of type in one category.
    {
      kind: 'number', key: 'letterScale', label: 'Letter size', section: 'Lettering',
      value: 100, min: 70, max: 115, step: 1, unit: '%',
      help: 'Most letters read best at 100% of the frame.',
    },
    {
      kind: 'number', key: 'letterWeld', label: 'Letter weight', section: 'Lettering',
      value: 0, min: -0.4, max: 1.5, step: 0.1, unit: 'mm',
      help: "Thickens or thins the letter's own strokes without changing its size.",
    },
    {
      kind: 'number', key: 'letterTracking', label: 'Initial spacing', section: 'Lettering',
      value: 6, min: 0, max: 25, step: 1, unit: '%',
      visibleWhen: (v) => str(v, 'initials').length >= 2,
      help: 'Space between the initials, as a share of their height.',
    },
    {
      kind: 'number', key: 'nameSizePct', label: 'Name size', section: 'Lettering',
      value: 85, min: 40, max: 120, step: 1, unit: '%',
      help: 'Past about 110% the name starts to touch the letter.',
    },
    {
      kind: 'number', key: 'nameWeld', label: 'Name border', section: 'Lettering',
      value: 0.7, min: 0, max: 2.5, step: 0.1, unit: 'mm',
      help: 'Thickens the name’s thin strokes so it survives the cut.',
    },
    {
      kind: 'number', key: 'nameTracking', label: 'Name spacing', section: 'Lettering',
      // +0.08 em is as far as a script can be opened before its letters stop touching each
      // other: at +0.12 the default name came off the bed in five pieces (G25).
      value: 0, min: -0.06, max: 0.08, step: 0.02,
      format: (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`,
      help: 'Past about +0.08 the letters stop touching each other.',
    },

    // ---------------------------------------------------------------- LEFT: "Hanging" --
    {
      kind: 'select', key: 'hang', label: 'Hanging', section: 'Hanging',
      value: 'wall',
      // Short enough to stay a segmented control: the section is already called Hanging, so
      // "Hanging hole" only repeated the word and then truncated to "Hangin…" (G22).
      options: [{ value: 'none', label: 'None' }, { value: 'hole', label: 'Hole' }, { value: 'wall', label: 'Wall' }],
      help: 'Wall needs a frame, or this builds a Hole instead.',
    },
    // The keyring block, gated on "Hanging hole". `ringMode` is dropped here and re-added hidden
    // below: this template's real hanging control is `hang`, whose third option is not a keyring
    // at all, but `editor.ts` looks up a field named `ringMode` by hand to decide whether the
    // stage gets a draggable hole — so the field has to exist under that name, and `build()`
    // writes it from `hang`.
    //
    // The nudge pad goes with the Hole option (2026-09-21): this hole is the DESIGN's — the
    // frame's top band, or the highest place in the letter that holds its border — and a hole
    // the design decides is not one you drag.
    ...(keyringFields('outside', { section: 'Hanging', dia: 3, ring: 2.5, side: 'top' })
      .filter((f) => f.key !== 'ringMode' && f.key !== 'ringDx')
      .map((f): Field => {
        if (f.key === 'holeDia' || f.key === 'holeRing') return { ...f, visibleWhen: (v) => str(v, 'hang') === 'hole' };
        return f;
      })),
    {
      kind: 'select', key: 'ringMode', label: 'Ring', section: 'Hanging',
      value: 'none', hidden: true,
      options: [{ value: 'outside', label: 'Loop tab' }, { value: 'none', label: 'None' }],
    },
    {
      kind: 'number', key: 'wallDia', label: 'Wall hole', section: 'Hanging',
      value: 4, min: 2.5, max: 6, step: 0.5, unit: 'mm',
      visibleWhen: (v) => str(v, 'hang') === 'wall' && str(v, 'frame') !== 'none',
      help: 'The two screw or nail holes, mirrored either side of the top.',
    },
    {
      kind: 'number', key: 'wallAngle', label: 'Hole spread', section: 'Hanging',
      value: 35, min: 0, max: 70, step: 1, unit: '°',
      visibleWhen: (v) => str(v, 'hang') === 'wall' && str(v, 'frame') !== 'none',
      help: 'How far round the ring the two holes sit.',
    },
  ],

  async build(v) {
    // Warnings, in priority order: structure, then what will not
    // cut or engrave, then sizing, then the informational ones.
    const wStructure: string[] = [];
    const wPhysical: string[] = [];
    const wSizing: string[] = [];
    const wInfo: string[] = [];

    const thickness = clamp(num(v, 'thickness'), 1, 20);
    const frame = str(v, 'frame');
    const solid = frame === 'disc' || frame === 'scallop';
    const hasFrame = frame !== 'none';
    const D = clamp(num(v, 'size'), 20, 600);
    const R = D / 2;
    // The badge safe margin: 0.125 in absolute floor, 3.5 % of the piece above it (§4).
    const margin = Math.max(3.2, 0.035 * D);

    // ------------------------------------------------------------------ 2.1 the frame --
    let frameShapes: Shapes = [];
    let workR = R - margin;     // the circle the lettering is inscribed in
    let edgeR = R;              // the circle the inner rule and the wall holes follow
    let ringBand = 0;
    let ribRadius = 0;
    if (frame === 'ring') {
      ringBand = clamp(Math.max(2 * thickness, (clamp(num(v, 'ringWidth'), 1, 40) / 100) * R), 3, 0.2 * R);
      frameShapes = ringFrameShapes(R, ringBand);
      workR = R - ringBand - margin;
    } else if (frame === 'disc') {
      frameShapes = discShapes(R);
    } else if (frame === 'scallop') {
      // The shared `scallop-disc` BLANK takes its size from `corner` and fixes the count at 16,
      // so the ring generator under it is what this template drives: the crest lands on R for
      // any count (§2.1), and the hinge circle is what the lettering has to live inside.
      const n = clamp(Math.round(num(v, 'scallops')), 4, 40);
      const { rho, hinge } = scallopHinge(R, n);
      frameShapes = [[scallopDiscRing(rho, n, 12)]];
      edgeR = hinge;
      workR = hinge - margin;
    } else if (frame === 'laurel') {
      const wreath = laurelWreathShapes({
        R,
        pairs: clamp(Math.round(num(v, 'leafPairs')), 1, 20),
        openDeg: clamp(num(v, 'wreathOpen'), 0, 120),
        ribW: Math.max(2.5, 2 * thickness),
      });
      frameShapes = wreath.shapes;
      ribRadius = wreath.ribRadius;
      workR = Math.min(0.82 * R, wreath.innerRadius) - margin;
    }
    workR = Math.max(4, workR);

    // --------------------------------------------------------------- 2.2 the initials --
    const initials = str(v, 'initials');
    const letterFont = str(v, 'letterFont');
    const composed = await composeInitials(initials, letterFont, num(v, 'letterTracking'));
    let letterShapes: Shapes = [];
    let letterBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    // With no initial there is still a piece to build, and the slot still has to be somewhere:
    // the height a square-ish Roman capital would have had.
    let letterH = hasFrame ? 1.26 * workR : D;
    let letterW = 0;
    if (composed) {
      const k = hasFrame
        ? (workR / Math.max(1e-6, 0.5 * Math.hypot(composed.width, composed.height))) * (clamp(num(v, 'letterScale'), 40, 150) / 100)
        : D / Math.max(1e-6, composed.refH);
      letterShapes = scale(composed.shapes, k);
      letterBox = bboxOf(letterShapes);
      letterH = composed.refH * k;
      letterW = composed.width * k;
    } else {
      wStructure.push('Type an initial.');
    }

    // ------------------------------------------------------------------- 2.3 the split --
    const splitPct = clamp(num(v, 'splitPct'), 5, 60);
    const gap = (splitPct / 100) * letterH;
    const rise = (clamp(num(v, 'splitRise'), 0, 30) / 100) * letterH;
    const gapTop = rise + gap / 2;
    const gapBot = rise - gap / 2;

    // --------------------------------------------------------------------- 2.5 the name --
    const nameText = str(v, 'name');
    const nameFont = str(v, 'nameFont');
    const nameWeld = clamp(num(v, 'nameWeld'), 0, 4);
    const symbols = readSymbols(v);
    const nameEm = (clamp(num(v, 'nameSizePct'), 10, 200) / 100) * gap;
    let tracking = num(v, 'nameTracking');
    const runName = async (track: number) => {
      const layers = await textLayer({ symbols, text: nameText, font: nameFont, size: NOMINAL, letterSpacing: track }, 'off');
      const s = layers.flatMap((l) => l.shapes);
      return { shapes: s, box: bboxOf(s) };
    };
    let name = nameText.trim() ? await runName(tracking) : { shapes: [] as Shapes, box: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const hasName = name.shapes.length > 0;
    const unit = nameEm / NOMINAL;
    let inkW = (name.box.maxX - name.box.minX) * unit;
    let inkH = (name.box.maxY - name.box.minY) * unit;

    // Width fit (§2.5): shrink, and condense a little below 0.80× — never wrap, there is no
    // second line in a slot.
    let fit = 1;
    if (hasName && inkW > 0) {
      const yEdge = Math.max(Math.abs(gapTop), Math.abs(gapBot), Math.abs(rise) + inkH / 2);
      const budget = frame === 'ring' || frame === 'laurel'
        ? 2 * Math.sqrt(Math.max(0, workR * workR - yEdge * yEdge)) - 4
        : solid ? D - 2 * margin : 1.6 * (letterW || D);
      if (budget > 1 && inkW > budget) {
        fit = Math.max(0.55, budget / inkW);
        if (fit < 0.8 && tracking > -0.06) {
          tracking = Math.max(-0.06, tracking - 0.04);
          name = await runName(tracking);
          inkW = (name.box.maxX - name.box.minX) * unit;
          inkH = (name.box.maxY - name.box.minY) * unit;
          fit = inkW > budget ? Math.max(0.55, budget / inkW) : 1;
        }
      }
    }
    const nameScale = unit * fit;
    inkW *= fit;
    inkH *= fit;
    const nameShapes = hasName ? placeShapes(scale(name.shapes, nameScale), 0, rise, 0) : [];
    if (fit < 0.999) wSizing.push(`Long name set at ${Math.round(fit * 100)}% of the size you chose.`);

    // ------------------------------------------------------ 2.4 the rules, and the weld --
    const rulesOn = bool(v, 'rules');
    const railT = Math.max(thickness, (clamp(num(v, 'ruleWeight'), 1, 50) / 100) * gap);
    const overlap = solid ? 0 : Math.max(1.5, 0.6 * thickness);
    const shoulder = solid ? 1.5 : 0;
    // With no name the rails stay at their nominal thickness; with one they come down to meet
    // its ink box, so the weld is guaranteed whatever the script's ink run turns out to be.
    const nTop = hasName ? rise + inkH / 2 : gapTop;
    const nBot = hasName ? rise - inkH / 2 : gapBot;
    // A rail ends ON the frame it welds to. For a ring that is the outer circle; for a wreath it
    // is the rib's own outer edge — running the rails out to R left 15 mm of bar hanging in the
    // air past each rib.
    const railBound: { circle: number } | { halfW: number } = frame === 'laurel'
      ? { circle: ribRadius + Math.max(2.5, 2 * thickness) / 2 }
      : frame === 'ring'
      ? { circle: R }
      : solid ? { circle: workR }
      : { halfW: Math.max(letterW, inkW) / 2 + Math.max(4, 0.05 * letterH) };
    let rails: Shapes = [];
    if (rulesOn) {
      const upHi = solid ? gapTop - shoulder : gapTop + overlap;
      const upLo = solid ? gapTop - shoulder - railT : Math.min(gapTop - railT, nTop - overlap);
      const loLo = solid ? gapBot + shoulder : gapBot - overlap;
      const loHi = solid ? gapBot + shoulder + railT : Math.max(gapBot + railT, nBot + overlap);
      rails = [...railShape(upLo, upHi, railBound), ...railShape(loLo, loHi, railBound)];
    }

    // ----------------------------------------------------------------- 2.6 the hanging --
    let hang = str(v, 'hang');
    if (hang === 'wall' && !hasFrame) hang = 'hole';
    const holeDia = num(v, 'holeDia');
    const holeBand = frame === 'ring' ? ringBand : frame === 'laurel' ? Math.max(2.5, 2 * thickness) : Infinity;
    const ringWideEnough = holeBand >= holeDia + 4;
    if (hang === 'hole' && !ringWideEnough) wStructure.push('The ring is too narrow for a hole; a loop tab was added.');
    // The one place a template writes back into its own values: `editor.ts` reads `ringMode`
    // after the build to decide whether the preview gets a drag handle. A hole here
    // is the DESIGN's, so it gets no handle — `ringMode` stays 'none' and the spec is built by
    // hand. Only the fallback, where the frame's band is too narrow to take a hole, is a real
    // loop tab, and that one is the shared control's.
    v.ringMode = hang === 'hole' && !ringWideEnough ? 'outside' : 'none';
    let keyring: KeyringSpec = hang === 'hole' && ringWideEnough
      ? { enabled: true, mode: 'inside', side: 'top', along: 0.5, dia: holeDia, ring: num(v, 'holeRing'), position: -1, dx: 0, dy: 0 }
      : keyringFrom(v);
    // With no frame, "top centre of the outline" is the RAIL — the split sits near the letter's
    // middle by construction, so the generic resting point lands on the one member holding the
    // letter's two halves together, with about 2.4 mm of material on the load-bearing side of a
    // hole that carries the whole piece. So the ring rests at the letter's own top edge instead,
    // at the highest place that holds the hole with its full border.
    if (!hasFrame && hang === 'hole' && letterShapes.length) {
      const need = holeDia / 2 + num(v, 'holeRing');
      const band = Math.max(5 * need, 0.25 * (letterBox.maxY - letterBox.minY));
      const spot = inscribedPoint(letterShapes, {
        want: need + 0.5,
        region: { minX: letterBox.minX, maxX: letterBox.maxX, minY: letterBox.maxY - band, maxY: letterBox.maxY - need },
        prefer: [0, letterBox.maxY],
        step: Math.max(1, need / 2),
      });
      if (spot) keyring = { ...keyring, rest: [spot[0], spot[1]] };
      else wPhysical.push('There is nowhere in this letter to hang it from — raise Size, shrink the hole, or add a frame.');
    }

    const cutLayers: DesignLayer[] = [];
    if (hang === 'wall' && hasFrame) {
      const a = (clamp(num(v, 'wallAngle'), 0, 85) * Math.PI) / 180;
      const wallR = frame === 'ring' ? R - ringBand / 2
        : frame === 'laurel' ? ribRadius
        : edgeR - margin / 2;
      const room = frame === 'ring' ? ringBand : frame === 'laurel' ? Math.max(2.5, 2 * thickness) : Infinity;
      const dia = clamp(num(v, 'wallDia'), 1.5, Math.max(1.5, room - 4));
      const at: Pt[] = [[-wallR * Math.sin(a), wallR * Math.cos(a)], [wallR * Math.sin(a), wallR * Math.cos(a)]];
      cutLayers.push({ id: 'wall-holes', label: 'Wall holes', op: 'cut', shapes: at.map((c) => [circleRing(c[0], c[1], dia / 2, 40)]) });
    }

    // --------------------------------------------------------------------- 2.7 the ops --
    const letterOp = solid ? (str(v, 'op') === 'cut' ? 'cut' : 'engrave') : 'cut';
    // A cut letter's thinnest stroke has to survive the sheet, and which letter you type decides
    // it: at the 200 mm default Cinzel's T runs 1.9 mm and its L 2.9 against 3 mm ply, where the
    // M this card was designed around runs 4.6. The customer changed the one field the card
    // invites them to change and walked from a warning-free picture into an unsellable file. So
    // the letter is thickened to the sheet automatically — never past doubling its own thin
    // stroke, which is as far as a Roman capital can be fattened before it stops being one — and
    // the warning is left for what that cannot reach.
    const askedWeld = num(v, 'letterWeld');
    const thinNow = strokeRun(letterShapes);
    const autoWeld = letterOp === 'cut' && thinNow > 0 && thinNow + 2 * Math.max(0, askedWeld) < thickness
      ? Math.min((thickness - thinNow - 2 * Math.max(0, askedWeld)) / 2, thinNow / 2)
      : 0;
    const letterWeld = askedWeld + autoWeld;
    // The slot spans the letter's box plus 10 mm (§2.3) — but the CUT band is also clamped to the
    // working circle, so a slot can never reach the frame and open the ring. The `keep` bands on
    // a solid body take no such clamp: they are a mask on the letter, not a cut on the piece, and
    // clipping them would lop the ends off a letter pushed past 100 % by `letterScale`.
    const keepHalf = Math.max(letterW, inkW) / 2 + 10;
    const bandHalf = Math.min(keepHalf, hasFrame ? workR : Infinity);

    const layers: DesignLayer[] = [];
    let blankShapes: Shapes;

    if (solid) {
      // The frame is the plate; everything else is a layer, so `keep` and `grow` are the
      // engine's job and this template only has to say where the bands are.
      blankShapes = frameShapes;
      const keep: Shapes = [
        [rectRing(-keepHalf, gapTop, keepHalf, Math.max(letterBox.maxY, gapTop) + 10)],
        [rectRing(-keepHalf, Math.min(letterBox.minY, gapBot) - 10, keepHalf, gapBot)],
      ];
      if (letterShapes.length) {
        layers.push({ id: 'initial', label: 'Initial', shapes: letterShapes, op: letterOp, keep, ...(Math.abs(letterWeld) > 1e-3 ? { grow: letterWeld } : {}) });
      }
      if (hasName) {
        // The weld is what makes a fine script survive a CUT; an engrave does not need it, and
        // adding it would hide the 0.3 mm stroke floor the warnings below are measured against.
        layers.push({ id: 'name', label: 'Name', shapes: nameShapes, op: letterOp, ...(letterOp === 'cut' && nameWeld > 1e-3 ? { grow: nameWeld } : {}) });
      }
      // The rules are DRAWN on a solid body, never cut through it. Cutting them was what
      // shattered a Cut-out disc into confetti: two full-width slots across the disc leave the
      // band between them hanging on its ends, and the script then chops that band into a piece
      // per letter — 16 of them at the default, none of it visible in a flat preview. The body
      // is what holds a solid frame together, so on a disc the rules are a scored line.
      if (rails.length) layers.push({ id: 'rules', label: 'Rules', shapes: rails, op: letterOp === 'cut' ? 'score' : letterOp });
      if (bool(v, 'innerRule')) {
        // A scalloped edge is not a circle: its valleys sit ON the hinge circle `edgeR` names,
        // and the polygon that approximates the bumps cuts a hair inside that. Half a margin was
        // enough on a disc and left the rule crossing the valleys on a 160 mm scallop.
        const r1 = edgeR - (frame === 'scallop' ? margin : margin / 2);
        const r2 = r1 - Math.max(1.2, 0.006 * D);
        if (r2 > 2) layers.push({ id: 'inner-rule', label: 'Inner rule', shapes: [[circleRing(0, 0, r1, 192), circleRing(0, 0, r2, 192)]], op: 'score' });
      }
    } else {
      // The lettering IS the piece. Grow by hand (see the note at the top), union in the engine,
      // then take the slot out with one cut layer that spares the name and the rails.
      if (letterWeld < -1e-3) wSizing.push('Letter weight only adds material on a cut piece.');
      const letterFull = dilate(letterShapes, Math.max(0, letterWeld));
      // Whatever part of the name reaches neither a neighbour nor a rail — an i's dot, a short
      // word the capital outreaches — is tied on before the border grows, so the bar gets the
      // border too and reads as part of the lettering (`nameBars`).
      const nameFull = dilate([...nameShapes, ...nameBars(nameShapes, rails)], nameWeld);
      blankShapes = [...frameShapes, ...letterFull, ...nameFull, ...rails];
      if (letterShapes.length) {
        layers.push({
          id: 'split', label: 'Split', op: 'cut',
          shapes: [[rectRing(-bandHalf, gapBot, bandHalf, gapTop)]],
          minus: [...nameFull, ...rails],
        });
      }
    }
    layers.push(...cutLayers);

    // -------------------------------------------------------------------- §5 warnings --
    const letterThin = thinNow + 2 * Math.max(0, autoWeld);
    const nameThin = strokeRun(nameShapes);
    const cutBuild = letterOp === 'cut';

    // How many pieces it really is comes from the engine, which has just unioned them
    // (`blank.oneIsland`): this used to be estimated here as "upper half + lower half", which
    // said three where manifold found nine — an M's two halves are each several contours before
    // the split ever touches them. What is left here is the advice, which the engine cannot
    // know, and it claims no number.
    if (!rulesOn && !solid && (letterShapes.length > 0 || hasFrame)) {
      wStructure.push('Without the rules through the split, the letter, the name and the frame are not welded to each other — turn Rules on, or raise Name size.');
    }
    if (solid && letterOp === 'cut' && letterShapes.length) {
      // Whether a counter SURVIVES the band is a question about the union of the glyph's
      // contours, which only the worker can answer — Cinzel's "B" arrives as four overlapping
      // strokes, not an outline with two holes, so counting holes here proves nothing. The
      // cheap sound proxy: a letter drawn with more than one contour is a letter with counters,
      // and a band that no longer crosses the letter's waist is what closes one.
      const contours = letterShapes.reduce((n, isl) => n + isl.length, 0);
      if (contours > 1 && (gapBot > 0 || gapTop < 0)) {
        wStructure.push("A letter's counter will fall out — widen the split or lower Raise the split.");
      }
    }
    if (cutBuild && thinNow > 0 && letterThin + 2 * Math.max(0, askedWeld) < thickness) {
      // "Make it bigger" is not a number anyone can type. The stroke scales with the piece, so
      // the size at which it just clears the sheet is arithmetic, and that is what it says.
      const need = Math.ceil((D * thickness) / Math.max(0.1, letterThin + 2 * Math.max(0, askedWeld)) / 5) * 5;
      wPhysical.push(`At this size the letter's thin strokes are under the material thickness, even thickened — try Size ${need} mm or more, or switch to Engrave.`);
    } else if (autoWeld > 0.02) {
      wSizing.push(`This letter's thinnest strokes were finer than your ${fmt(thickness)} mm sheet, so it was thickened by ${fmt(Math.round(autoWeld * 20) / 20)} mm.`);
    }
    if (hasName && cutBuild) {
      if (inkH < 15) wPhysical.push('The script is finer than 3 mm ply cuts cleanly. Raise Name border, raise Name size, or engrave.');
      const welded = nameThin + 2 * nameWeld;
      if (nameThin > 0 && welded < 1.5) wPhysical.push(`Raise Name border to at least ${fmt(Math.ceil(((1.5 - nameThin) / 2) * 10) / 10)} mm for this font.`);
    }
    if (hasName && !cutBuild) {
      if (nameThin > 0 && nameThin < 0.3) wPhysical.push("The name's strokes are thinner than 0.3 mm — pick a heavier script or a bigger piece.");
      if (inkH < 4) wSizing.push('Engraved text under 4 mm rarely reads.');
    }
    if (num(v, 'nameSizePct') > 110) wSizing.push('The name overlaps the letter.');
    if (hasName) {
      const letters = Array.from(nameText).filter((c) => /\p{L}/u.test(c));
      if (letters.length >= 2 && letters.every((c) => c === c.toLocaleUpperCase() && c !== c.toLocaleLowerCase())) {
        wSizing.push('An all-caps name sits tight against the rules. Lower Name size, or pick a script.');
      }
    }
    if (composed && (initials.trim().length === 2 || initials.trim().length >= 4)) {
      wInfo.push('Three initials use the First · LAST · Middle convention; two are set the same size.');
    }

    return {
      // One piece is the whole promise of this design (§2.4), so the engine reports the real
      // island count whenever the weld fails.
      blank: { kind: 'shape', shapes: blankShapes, oneIsland: true },
      keyring,
      layers,
      warnings: [...wStructure, ...wPhysical, ...wSizing, ...wInfo],
    };
  },

  fileName: (v) => stem(str(v, 'initials') || 'M', str(v, 'name') || 'monogram'),
};
