import { readSymbols } from '../symbols/model';
// The family tree: ONE shape, and the shape is the names.
//
// `ref/REF-cuttle-family-tree-names.png` is the bar — names stacked shortest-first in a bold
// sans, each row biting into the row under it so the stack welds into a single body, the year
// welded under the last name, a topper welded on top carrying the ribbon hole. No plate, no hug
// margin, no engraving: the OUTLINE IS THE LETTERS, and the only red in the export is that one
// outline. What shipped before (`ref/family-tree-ours.png`) was the opposite — a light plate with
// every row hugged into its own blob and the names burnt onto it — so this is a rewrite, not a
// fix, and the four other silhouettes went with it ("only one shape of ornament done well").
//
// How it is built:
//   · Every name is measured once at a probe em, WITH the weld (G33) so the measurement is the
//     width the row really comes out at, then sorted narrowest-first. Row i is set at
//     `base × (1 + i × TAPER)`, so the widths rise even when five names are the same length —
//     the taper is what makes a pyramid out of Ava / Leo / Mia / Zoe / Sam.
//   · Rows are stacked by their INK, not their line box, each one overlapping the row above by
//     `Row overlap` mm of real penetration. Within a row the letters are welded and the seams
//     scored by the engine (G33) — `connectSpec` + one scored copy of the same islands.
//   · The topper (star / snowflake / angel) is drawn from primitives and sunk into the top row.
//     It carries the hanging hole, which is the design's own: no Ring control, nothing to drag.
//
// Design + form: docs/briefs/laser-studio-templates/family-tree-names.design.md (the pre-rewrite
// design; the packet is docs/briefs/laser-studio-feedback-2026-09-21-templates/00-packets.md §T).
import { bboxOf, blankById, circleRing, mapShapes, placeShapes, snowflakeArms, snowflakeHubRing, starRing, type BlankParams, type Pt, type Shapes } from '@vostok/laser';
import { MIN_COUNTER, textLayer } from '../engine/text';
import type { BuildInput, DesignLayer, KeyringSpec } from '../engine/types';
import { hangHoleFields, NO_KEYRING } from './keyring';
import { connectSpec, countersTooTight, letterScoreField, stem } from './shared';
import { bool, lines, num, str, type Field, type TemplateDef } from './types';

/** The em every name is measured at. Big enough that the weld's overlap is already the 3 %-of-
 *  size branch of `weldOverlap`, so a measured width scales linearly with the size — which is
 *  what lets the taper be arithmetic instead of a convergence loop. */
const PROBE = 24;
/** The most rows the piece holds. `maxLines` stops the typing; this stops a pasted list. */
const MAX_NAMES = 12;
/** How much wider each row is set than the one above it, before the names' own widths are
 *  counted. 5 % per row: over five rows the bottom name is 1.2 × the top one, which reads as a
 *  taper without the top of the tree turning into a label. It is also what guarantees the
 *  silhouette when every name is the same length. */
const TAPER = 0.05;
/** Faces that hold up as a slab of wood 10–20 mm tall and weld cleanly: bold, closed, condensed
 *  or square. Every one of them is built in the default five names by the node suite (§7) and
 *  has to come out as one island with nothing to warn about. */
const BOLD_SANS = ['anton', 'archivo-black', 'bebas-neue', 'oswald', 'fjalla-one', 'staatliches'];
/** Material round the ribbon hole, mm — the topper is sized from this, never the other way. */
const HOLE_WALL = 3.2;
/** The tallest a row's capitals may be, as a share of the piece's width. An ornament is 75–100 mm
 *  across (laser-cutting-knowledge §9.1) and its lettering is a tenth to a quarter of that; this
 *  is the ceiling, not the aim, and it only binds when every name is short. */
const CAP_MAX_SHARE = 0.36;
/** How fat the star's waist is. 0.5 rather than the golden 0.382 because the hole lives in the
 *  star's core: at 0.382 a five-point star has to be 34 mm across before a 3 mm hole keeps its
 *  wall, and at 0.5 it is 22 — still unmistakably a star, and the size the reference draws. */
const STAR_INNER = 0.5;
/** The snowflake's spines are 5.5 % of its width; below 1.8 mm they are hairs, not a crystal. */
const FLAKE_MIN = 1.8 / 0.055;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const mm = (v: number) => (Math.round(v * 10) / 10).toString();
const scaleShapes = (shapes: Shapes, k: number): Shapes => mapShapes(shapes, ([x, y]) => [x * k, y * k]);

/** A row as it was drawn: the layer, its ink box grown by the engine's own `grow`, and the name. */
interface Row {
  layer: DesignLayer;
  name: string;
  /** Ink extents INCLUDING the thicken the engine will add — what actually touches the next row. */
  top: number;
  bottom: number;
  width: number;
}

/** The x-intervals where `shapes` has material on the horizontal line `y`.
 *
 *  Even–odd WITHIN an island, so the hole in an "A" is a hole; unioned ACROSS islands, so two
 *  glyphs that overlap read as one run rather than cancelling each other out. That second half is
 *  the whole reason this is not one even-odd pass over everything: after the weld walk the letters
 *  of a row DO overlap, and an even-odd pass would report a gap at every junction. */
function inkSpans(shapes: Shapes, y: number, grow = 0): [number, number][] {
  const runs: [number, number][] = [];
  for (const island of shapes) {
    const xs: number[] = [];
    for (const ring of island) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        if (y1 === y2 || (y1 <= y) === (y2 <= y)) continue;
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) runs.push([xs[i]! - grow, xs[i + 1]! + grow]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Whether these two bodies actually share material — not whether their boxes overlap.
 *
 * `a` sits above `b`; the band they share is `[a.bottom, b.top]`, and on five scanlines across it
 * the two have to have ink at the same x. A pair that fails this is not welded, whatever their
 * bounding boxes say: "AVA" over "ALEXANDER" can overlap by 2 mm of box and still only have the
 * point of a V above the gap between two letters. The engine bridges those, and the build says so.
 */
function welded(a: Shapes, aGrow: number, aBottom: number, b: Shapes, bGrow: number, bTop: number): boolean {
  if (bTop <= aBottom) return false;
  for (let i = 1; i <= 5; i++) {
    const y = aBottom + ((bTop - aBottom) * i) / 6;
    const sa = inkSpans(a, y, aGrow);
    const sb = inkSpans(b, y, bGrow);
    for (const [a0, a1] of sa) {
      for (const [b0, b1] of sb) {
        if (Math.min(a1, b1) - Math.max(a0, b0) > 0.05) return true;
      }
    }
  }
  return false;
}

export const familyTreeNames: TemplateDef = {
  id: 'family-tree-names',
  name: 'Family tree ornament',
  blurb: 'Every family name stacked into one tree — the letters are the outline, welded and cut in one piece.',
  tags: ['ornament', 'score + cut'],
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'lines', key: 'names', label: 'Names', panel: 'right', section: 'Names',
      // 3 / 4 / 6 / 9 / 5 letters: the ladder is what makes the card read as a pyramid rather
      // than a column, and the names are not people we know (§0).
      value: 'Ava\nNoah\nHarper\nAlexander\nElsie',
      placeholder: 'One family member per line',
      rows: 8, maxLines: MAX_NAMES,
      help: 'The shortest name goes to the top — order does not matter.',
    },
    {
      kind: 'text', key: 'year', label: 'Year', panel: 'right', section: 'Names',
      value: '2026', placeholder: 'Optional', maxLength: 12,
      help: 'Welded under the last name, smaller.',
    },

    // --------------------------------------------------- LEFT: "Tree" (opens first) --
    {
      kind: 'thumbs', key: 'topper', label: 'Topper', section: 'Tree',
      value: 'star', columns: 3,
      options: [
        { value: 'star', label: 'Star', svgPath: topperThumb('star') },
        { value: 'snowflake', label: 'Snowflake', svgPath: topperThumb('snowflake') },
        { value: 'angel', label: 'Angel', svgPath: topperThumb('angel') },
      ],
      help: 'The ribbon hole is cut in the topper.',
    },
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Tree',
      value: 90, min: 50, max: 200, step: 1, unit: 'mm',
      help: 'The widest name sets it; the height follows from your names.',
    },

    // ------------------------------------------------------------------ LEFT: Font --
    { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'anton', recommended: BOLD_SANS },

    // How far apart the rows sit — and the whole shape of this design.
    //
    // It used to be "Row overlap", 1.5 mm, and 1.5 mm of BOX overlap means the cap line of one
    // name sits inside the baseline of the one above: no air anywhere, and the tree reads as a
    // slab with the letters cut out of it (Ian, 2026-09-23: "letters are all close together").
    // Positive now, and a gap: the branch under each name is what holds the piece together, so
    // the names no longer have to touch to survive the cut. Negative still bites, for anyone
    // who wants the old welded stack.
    {
      kind: 'number', key: 'rowGap', label: 'Row spacing', section: 'Tree',
      value: 3, min: -2, max: 12, step: 0.5, unit: 'mm',
      format: (n) => (n > 0 ? `${n} mm apart` : n < 0 ? `${-n} mm overlap` : 'touching'),
      help: 'Air between the names. The branch joins them.',
    },
    {
      kind: 'number', key: 'rowLine', label: 'Branch thickness', section: 'Tree',
      value: 2.5, min: 1, max: 6, step: 0.5, unit: 'mm',
      help: 'Thin lines snap; keep it near the material thickness.',
    },

    // ----------------------------------------------------- long tail → More options --
    // The same control, the same units, as every other design that sets type: a share of the
    // letter height, so it survives a size change.
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', value: 0, min: -0.1, max: 0.3, step: 0.02,
      advanced: true,
      format: (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`,
      help: 'Air between the letters, as a share of their height.',
    },
    // Not advanced: it is the difference between a name you can read and a silhouette you
    // cannot, which is not a long-tail decision.
    { ...letterScoreField('Tree', 'score'), label: 'Outline the letters' },
    {
      kind: 'number', key: 'yearSize', label: 'Year size', value: 65, min: 30, max: 90, step: 1, unit: '%',
      advanced: true,
      help: 'A share of the last name’s letters.',
      visibleWhen: (v) => str(v, 'year').trim() !== '',
    },
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', value: 3, min: 1.5, max: 12, step: 0.5, unit: 'mm',
      advanced: true,
      help: 'Sets the floor for any bridge the engine has to add.',
    },
    // The hole is the DESIGN's: it goes in the topper, it is never dragged, and there is no Ring
    // control on this template at all (packet K — the loop tab is for keychains, an ornament
    // hangs from a hole in its own crown).
    ...hangHoleFields('More options', { dia: 3, maxDia: 6, label: 'Ribbon hole' }).map((f): Field => ({ ...f, advanced: true })),
  ],

  async build(v): Promise<BuildInput> {
    const symbols = readSymbols(v);
    const font = str(v, 'font');
    const width = Math.max(20, num(v, 'width'));
    // The stack's step, as the geometry has always wanted it: how far the next row's TOP sits
    // below this row's BOTTOM. A gap is simply a negative bite, so nothing downstream changes.
    const gap = clamp(num(v, 'rowGap'), -4, 12);
    const pen = -gap;
    /** Rows that do not touch are held by the branches, so the branches are not optional. */
    const branches = gap > 0.01;
    const thickness = Math.max(0.5, num(v, 'thickness'));
    const bridge = Math.max(2, thickness);
    const scoreSeams = str(v, 'letterLines') === 'score';
    const warnings: string[] = [];

    const typed = lines(v, 'names');
    const names = typed.slice(0, MAX_NAMES);
    if (typed.length > MAX_NAMES) warnings.push(`Only the first ${MAX_NAMES} names are used.`);

    /** One welded line of type, centred on the origin: the letters overlapped a little and the
     *  junctions left for the engine to score (G33). The `op: 'off'` + `hugOnly` comes later —
     *  the same islands are also the seam layer's, so they are built once. */
    // CAPITALS, always. Not a style: a row of capitals has a flat cap line and a flat baseline,
    // so the 1.5 mm a row is sunk into the next one is 1.5 mm of weld ALL the way across. Set
    // "Harper" over "Alexander" in mixed case and the only ink in that band is the tail of the p
    // — one stem over a gap between two letters — and the engine has to invent a joining bar.
    // Measured on the default names before this line existed: 3 bars, and a warning.
    const draw = async (text: string, size: number, id: string, label: string): Promise<DesignLayer | null> => {
      // NOT welded. The letters used to be overlapped into each other so the row cut as one
      // piece, and at these sizes that weld is millimetres deep: "NOAH" came out with the O
      // buried in the N and the seams scored across both (Ian, 2026-09-23: "letters are all
      // close together, scoring of letters doesn't work properly"). The branch under each name
      // is what holds its letters together now, so they can simply stand at their own spacing.
      const connect = branches ? { thicken: connectSpec(font, size).thicken, overlap: 0 } : connectSpec(font, size);
      const [layer] = await textLayer({ symbols, text: text.toUpperCase(), font, size, letterSpacing: num(v, 'letterSpacing'), connect }, 'off', id, label);
      return layer ?? null;
    };
    /** A drawn line with the extents that MATTER: the ink plus the thicken the engine will add. */
    const rowOf = (layer: DesignLayer, name: string): Row => {
      const b = bboxOf(layer.shapes);
      const g = layer.grow ?? 0;
      return { layer, name, top: b.maxY + g, bottom: b.minY - g, width: b.maxX - b.minX + 2 * g };
    };
    const moved = (r: Row, dy: number): Row => ({
      ...r,
      layer: { ...r.layer, shapes: placeShapes(r.layer.shapes, 0, dy, 0) },
      top: r.top + dy, bottom: r.bottom + dy,
    });
    const scaled = (r: Row, k: number): Row => ({
      ...r,
      layer: { ...r.layer, shapes: scaleShapes(r.layer.shapes, k), ...(r.layer.grow ? { grow: r.layer.grow * k } : {}) },
      top: r.top * k, bottom: r.bottom * k, width: r.width * k,
    });

    // ---- measure once, sort narrowest-first, size the rows ---------------------------
    // The row order is the names' own WIDTHS, not their letter counts (laser-cutting-knowledge
    // §9.2): "Ill" is narrower than "Wam" in every face there is. Measured at one probe em with
    // the weld already applied, because that is the width the row really comes out at — and at
    // PROBE the overlap is already `0.03 × size`, so the measurement scales linearly and the
    // whole fit is arithmetic.
    const probes = await Promise.all(names.map((n, i) => draw(n, PROBE, `probe-${i}`, n)));
    const unit = probes.map((l) => (l ? (bboxOf(l.shapes).maxX - bboxOf(l.shapes).minX + 2 * (l.grow ?? 0)) / PROBE : 0));
    const order = names.map((_, i) => i).filter((i) => probes[i] && unit[i]! > 0.01).sort((a, b) => unit[a]! - unit[b]! || a - b);
    const R = order.length;

    // The rule, in one line: row i is set at `base × (1 + i × TAPER)` and the names are sorted
    // narrowest-first, so the widths rise twice over — once because the name is longer, once
    // because the type is bigger. Either half alone leaves a column when the other one is flat
    // (five three-letter names; one long name among four short ones), and the product of two
    // non-decreasing sequences is non-decreasing, which is the silhouette's guarantee.
    const base = R ? width / Math.max(0.05, unit[order[R - 1]!]! * (1 + (R - 1) * TAPER)) : PROBE;
    const sizeAt = (i: number) => base * (1 + i * TAPER);
    const drawn = await Promise.all(order.map((idx, i) => draw(names[idx]!, sizeAt(i), `name-${i}`, names[idx]!)));
    let rows = drawn.flatMap((l, i) => (l ? [rowOf(l, names[order[i]!]!)] : []));

    // The weld eats a little of every measured width, and not quite the share the probe saw, so
    // one uniform correction lands "Width" on the millimetre. It scales the type with it, which
    // is the honest trade: Width is the promise, the letter height is what the names allow.
    //
    // Unless the names are so short that filling the width means 60 mm capitals on a 90 mm
    // ornament — five three-letter names at the default did exactly that, and the piece came out
    // 319 mm tall. The letters stop at 30 % of the width, the piece comes out narrower than asked,
    // and the warning says so in millimetres and names the one thing that fixes it.
    const widest = rows.reduce((a, r) => Math.max(a, r.width), 0);
    const tallest = rows.reduce((a, r) => Math.max(a, r.top - r.bottom), 0);
    const kWidth = widest > 1e-6 ? width / widest : 1;
    const k = Math.min(kWidth, tallest > 1e-6 ? (CAP_MAX_SHARE * width) / tallest : kWidth);
    if (Math.abs(k - 1) > 1e-4) rows = rows.map((r) => scaled(r, k));
    // Only when the shortfall is one a person would notice. Three names hit the ceiling by a
    // hair and come out 83 % of the width asked for, which is a good-looking ornament and not
    // news; two three-letter names come out at half, which is.
    if (R >= 2 && widest * k < width * 0.8) {
      warnings.push(`These names only fill ${mm(widest * k)} mm of the ${mm(width)} mm asked for — add a longer name, or a surname.`);
    }

    // ---- stack them, each biting into the one above --------------------------------
    let cursor = 0;
    const stack: Row[] = [];
    for (const r of rows) {
      stack.push(moved(r, cursor - r.top));
      cursor += pen - (r.top - r.bottom);
    }

    // ---- the year, welded under the last name, smaller -----------------------------
    const yearText = str(v, 'year').trim();
    if (yearText) {
      const em = Math.max(2, (R ? sizeAt(R - 1) * k : PROBE) * clamp(num(v, 'yearSize'), 10, 100) / 100);
      let layer = await draw(yearText, em, 'year', yearText);
      // A year is meant to sit UNDER the tree, not to widen it: a long one (the field takes
      // twelve characters) is dropped to whatever fits the bottom name's width, silently —
      // there is nothing for the customer to decide here.
      const last = stack[stack.length - 1];
      if (layer && last) {
        const w = bboxOf(layer.shapes).maxX - bboxOf(layer.shapes).minX + 2 * (layer.grow ?? 0);
        if (w > last.width) layer = await draw(yearText, (em * last.width * 0.98) / w, 'year', yearText);
      }
      if (layer) {
        const y = rowOf(layer, yearText);
        stack.push(moved(y, cursor - y.top));
        cursor += pen - (y.top - y.bottom);
      }
    }

    // ---- the topper, and the hole it carries ---------------------------------------
    // Sized from the HOLE, never the other way round: whatever the piece's width, the topper is
    // at least big enough that a 3 mm ribbon hole keeps 3.2 mm of wood all round it. On a 90 mm
    // tree it is 25 mm across, which is the reference's proportion.
    const holeDia = clamp(num(v, 'holeDia') || 3, 2, 8);
    const holeR = holeDia / 2 + HOLE_WALL;
    const kind = str(v, 'topper') || 'star';
    const top = stack[0];
    const topperW = topperWidth(kind, clamp(0.28 * width, 18, 44), holeR);
    const built = topperAt(kind, topperW, holeR);
    // How deep it sits in the top name. A star ends in two narrow points and a name is mostly
    // air at its cap line, so a fixed bite welds on some names and floats on others: the sink
    // grows until the two bodies really share material, capped at a third of the topper — past
    // that the star is wearing the name rather than standing on it.
    const builtBox = bboxOf(built.shapes);
    const placedAt = (s: number) => (top ? top.top : 0) - builtBox.minY - s;
    let sink = Math.max(0.5, 0.08 * topperW);
    if (top) {
      const ceiling = 0.34 * (builtBox.maxY - builtBox.minY);
      for (; sink < ceiling; sink += 0.75) {
        const at = placeShapes(built.shapes, 0, placedAt(sink), 0);
        if (welded(at, 0, top.top - sink, top.layer.shapes, top.layer.grow ?? 0, top.top)) break;
      }
    }
    const dy = placedAt(sink);
    const topper: DesignLayer = { id: 'topper', label: 'Topper', op: 'off', hugOnly: true, shapes: placeShapes(built.shapes, 0, dy, 0) };
    const holeAt: Pt = [built.hole[0], built.hole[1] + dy];

    // ---- what is not welded gets bridged, and is said ------------------------------
    const loose: string[] = [];
    // Only when the rows are meant to touch. Spaced rows are joined by their branches by
    // construction, so checking whether the LETTERS reach each other reports every row as
    // loose and says nothing true.
    if (!branches) {
      for (let i = 1; i < stack.length; i++) {
        const a = stack[i - 1]!, b = stack[i]!;
        if (!welded(a.layer.shapes, a.layer.grow ?? 0, a.bottom, b.layer.shapes, b.layer.grow ?? 0, b.top)) loose.push(b.name);
      }
    }
    if (top && !welded(topper.shapes, 0, bboxOf(topper.shapes).minY, top.layer.shapes, top.layer.grow ?? 0, top.top)) loose.push('the topper');
    if (loose.length) {
      warnings.push(`${loose[0] === 'the topper' ? 'The topper' : loose[0]} does not reach the row above — it will be joined by a ${mm(bridge)} mm bridge.`);
    }

    // ---- what the customer needs to hear ------------------------------------------
    if (!R) warnings.push('Type one name per line.');
    else if (R === 1) warnings.push('One name — this design is made for two or more.');
    warnings.push(...countersTooTight(stack.flatMap((r) => r.layer.shapes)));
    const smallest = stack.length ? Math.min(...stack.map((r) => r.top - r.bottom)) : 0;
    if (R >= 2 && smallest < 6) {
      warnings.push(`The smallest letters are ${mm(smallest)} mm — raise Tree → Width, or use fewer names.`);
    }

    /* The branch under each name.
     *
     * A bar as wide as the row, sitting on its baseline and reaching down into the row below.
     * It spans the WHOLE width, so wherever the two rows have ink it has ink too — which is the
     * point: the weld between two names depends on where their letters happen to line up, and
     * this does not depend on anything. `welded` is measured after these are in, so a tree with
     * bars stops reporting bridges it no longer needs.
     *
     * Not under the LAST row: there is nothing below it to reach, and a bar hanging off the
     * bottom of the piece is a tab, not a branch. */
    const bars: DesignLayer[] = [];
    if (stack.length > 1) {
      const t = Math.max(0.6, num(v, 'rowLine'));
      /** How far a branch buries itself in the row at each end. Enough that the join survives
       *  the kerf; it is the only thing holding a spaced tree together. */
      const bite = Math.max(1, t / 2);
      for (let i = 0; i < stack.length - 1; i++) {
        const r = stack[i]!;
        const below = stack[i + 1]!;
        // The row's own width, so the branch reads as a branch of THAT name.
        const w = r.width / 2;
        // Spaced rows: the branch runs from inside this name to inside the next, which is what
        // now carries the piece. Overlapping rows: the old thin bar in the closed band, where
        // it only ever had to help the weld along.
        const topY = branches ? r.bottom + bite : r.bottom + pen / 2;
        const botY = branches ? below.top - bite : r.bottom - t;
        bars.push({
          id: `bar-${i}`, label: 'Branch', op: 'off', hugOnly: true,
          shapes: [[[[-w, botY], [w, botY], [w, topY], [-w, topY]]]],
        });
      }
    }

    const material: DesignLayer[] = [...stack.map((r) => ({ ...r.layer, op: 'off' as const, hugOnly: true })), ...bars];
    // The seams are a second copy of the SAME islands, scored: the engine burns the run of each
    // letter's edge that the next letter covers, and nothing else (G33). One layer per row, so
    // each keeps its own row's thicken — a shared layer could only carry one.
    /* What gets scored, and why it is two different things.
     *
     * WELDED rows (spacing 0 or less) bury one letter in the next, so what needs a line is the
     * junction — `seams: true`, the run of each letter's edge that a later letter covers.
     *
     * SPACED rows do not bury anything in each other, but every letter stands ON its branch,
     * and where it meets that bar its foot simply stops existing: the N, the R and the I lose
     * their bottoms into the band and the name stops reading (Ian, 2026-09-23: "the letter
     * itself is blended with the rest of the thing, but it still has to have scoring to be
     * easily read, like we have in name keychain"). The line that fixes that is the letter's
     * WHOLE outline, not a junction — so the letters read as letters wherever they touch. The
     * runs that fall on the piece's own cut edge are dropped by the engine's clip, so the only
     * ink left is the part crossing material. */
    const seams: DesignLayer[] = !scoreSeams
      ? []
      : branches
        // `kind: 'fill'` is the engine's own word for "this is MEANT to reach the edge": a
        // letter outline lies ON the piece's cut line by definition, and without it the build
        // reports every row as a name that ran off the part.
        ? stack.map((r) => ({ ...r.layer, id: `${r.layer.id}-outline`, label: 'Letter outlines', op: 'score' as const, kind: 'fill' as const }))
        : stack.map((r) => ({ ...r.layer, id: `${r.layer.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }));

    const keyring: KeyringSpec = v.hangHole === false
      ? NO_KEYRING
      : { ...NO_KEYRING, enabled: true, mode: 'inside', dia: holeDia, ring: HOLE_WALL, rest: holeAt };

    return {
      blank: {
        kind: 'hug',
        // Zero, and zero. The piece IS the letters (G31): a margin here is the jacket that made
        // the shipped version a plate with names on it, and a smoothing pass on top of that is
        // what melted each row into a blob.
        margin: 0,
        smoothing: 0,
        bridge,
        counters: 'open',
        minHole: MIN_COUNTER,
      },
      keyring,
      layers: [...material, topper, ...seams],
      ...(warnings.length ? { warnings } : {}),
      ...(R ? { status: `${R} name${R === 1 ? '' : 's'}` } : {}),
    };
  },

  exportNote: (v) => (v.hangHole === false
    ? 'One piece, cut on the letters — the blue lines are scores, not cuts.'
    : `One piece, cut on the letters — thread a ribbon through the ${mm(clamp(num(v, 'holeDia') || 3, 2, 8))} mm hole.`),

  fileName: (v) => stem(...lines(v, 'names').slice(0, 3), 'tree'),
};

// ------------------------------------------------------------------ the topper --

/** The closest this ring comes to a point — how much solid material a hole there would keep. */
function ringClearance(ring: Pt[], [cx, cy]: Pt): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    const dx = x2 - x1, dy = y2 - y1;
    const t = clamp(((cx - x1) * dx + (cy - y1) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)));
  }
  return best;
}

/** The finished width of the topper: what the piece's own width asks for, held up to what the
 *  ribbon hole and the thinnest feature need. A topper is never allowed to be the part that
 *  breaks. */
function topperWidth(kind: string, want: number, holeR: number): number {
  if (kind === 'snowflake') return Math.max(want * 1.25, FLAKE_MIN);
  if (kind === 'angel') return Math.max(want * 1.15, 30);
  // The largest circle that fits in the star's core, as a fraction of its width — measured off
  // the ring the build actually uses, so the two cannot drift apart.
  const core = ringClearance(starRing(1, 1, 5, STAR_INNER), [0, 0]);
  return Math.max(want, holeR / core + 0.3);
}

/**
 * The topper, drawn centred on x = 0 with its lowest point on y = 0, and the point its ribbon
 * hole goes through. Three parametric shapes — nothing here is traced from anyone's drawing.
 */
function topperAt(kind: string, w: number, holeR: number): { shapes: Shapes; hole: Pt } {
  if (kind === 'snowflake') {
    // The library's crystal (six spines, two pairs of branches each) with a round boss on the
    // top spine: a hole in the hub would leave the ribbon inside the flake, and the hub of a
    // stellar plate is only a quarter of its diameter anyway.
    const def = blankById('snowflake')!;
    const p: BlankParams = { ...def.defaults, width: w, height: w };
    const tip = 0.92 * (w / 2);
    const rings: Pt[][] = [snowflakeHubRing(w, w), ...snowflakeArms(p), circleRing(0, tip - holeR, holeR, 40)];
    return place(rings.map((r) => [r]), [0, tip - holeR]);
  }
  if (kind === 'angel') {
    // Hem, shoulders, head, two swept wings and the halo — and the halo is also the hanging loop,
    // which is why it is a disc the size of the hole's own collar rather than a bead: punched, it
    // comes out as the ring the reference hangs its angel from.
    //
    // The body is drawn in a unit frame and scaled to the wingspan, because the halo is the one
    // part that CANNOT scale — it is whatever the ribbon hole needs plus its wall — and a design
    // where one part is fixed and the rest is not has to be built in that order.
    const WING_A = 0.4, WING_B = 0.095, WING_X = 0.2, WING_DEG = 35;
    const span = 2 * (WING_X + WING_A * Math.cos((WING_DEG * Math.PI) / 180));
    const k = w / span;
    const hem = 0.21 * k, neck = 0.075 * k, shoulder = 0.5 * k;
    const headR = 0.125 * k;
    const headY = shoulder + 0.7 * headR;
    const wing = vesicaRing(WING_A * k, WING_B * k);
    // 1 mm of bite into the head, so the loop is welded rather than balanced on it.
    const halo: Pt = [0, headY + headR + holeR - 1];
    return place([
      [[[-hem, 0], [hem, 0], [neck, shoulder], [-neck, shoulder]] as Pt[]],
      [circleRing(0, headY, headR, 40)],
      ...placeShapes([[wing]], WING_X * k, 0.38 * k, WING_DEG),
      ...placeShapes([[wing]], -WING_X * k, 0.38 * k, -WING_DEG),
      [circleRing(halo[0], halo[1], holeR, 40)],
    ], halo);
  }
  // A five-point star, point up, hole in the middle of its core.
  return place([[starRing(w, w, 5, STAR_INNER)]], [0, 0]);
}

/** Shift a topper so it is centred on x = 0 with its lowest point on y = 0, taking its hole with
 *  it. Every topper is drawn in whatever frame suits its own maths; this is the one they share. */
function place(shapes: Shapes, hole: Pt): { shapes: Shapes; hole: Pt } {
  const b = bboxOf(shapes);
  const dx = -(b.minX + b.maxX) / 2;
  const dy = -b.minY;
  return { shapes: placeShapes(shapes, dx, dy, 0), hole: [hole[0] + dx, hole[1] + dy] };
}

/** A leaf: two circular arcs of equal radius meeting at the tips. Half-length `a`, half-width `b`.
 *  The angel's wings, and the one shape in the set that is not in the blank library. */
function vesicaRing(a: number, b: number, seg = 18): Pt[] {
  const r = (a * a + b * b) / (2 * b);
  const cy = b - r;
  const from = Math.atan2(-cy, a);
  const to = Math.PI - from;
  const upper: Pt[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = from + ((to - from) * i) / seg;
    upper.push([r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return [...upper, ...upper.slice(1, -1).reverse().map(([x, y]) => [x, -y] as Pt)];
}

/** The picker tile: the same three functions the build uses, in a 40 × 40 box. */
function topperThumb(kind: string): string {
  const { shapes } = topperAt(kind, 30, 4.7);
  const b = bboxOf(shapes);
  const k = 34 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const n = (value: number) => value.toFixed(2);
  return shapes
    .map((island) => island[0]!)
    .map((ring) => `M ${ring.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`)
    .join(' ');
}
