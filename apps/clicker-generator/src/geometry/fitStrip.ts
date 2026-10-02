// A printable fit test: one small tile per stem-fit setting, each debossed with its own number.
//
// Fit is the single most-reported problem with this model and with every competing one. Today
// the app has the right control — "Switch stem fit (top part)" moves the cross socket in the
// cap's post — but no way to answer the question it asks. People print a whole clicker, find it
// too tight, change a number they cannot evaluate, and print another one. Seventy-nine threads
// across this listing and eight competitors are that loop.
//
// The strip closes it in one print: five tiles, five settings, the number on each. Push each one
// onto a real switch, read the number off the one that fits, type it into the control. No brand
// table, no guessing, and it answers for whatever switch is actually in the user's hand.
//
// The tiles are built in the SAME Z frame as a real cap, and emitted in the `top` group, so
// `plateLayout` flips them exactly as it flips a cap. That matters more than it looks: a socket
// printed the other way up has different overhangs and comes out a different size, so a test
// printed in a different orientation from the part would be worse than no test at all.
import type { ClickerPart, RGB, Ring } from '../types';

type Wasm = any;
type Solid = any;
type Section = any;

/** One tile: the setting to test, and the outlines of the number to deboss on it. */
export interface FitStripLabel {
  /** The `stemFitPct` this tile is built at. */
  pct: number;
  /** Normalised text outlines (longest side = 1, centred, Y-up), as `parseLetter` returns. */
  rings: Ring[];
}

export interface FitStripOptions {
  labels: FitStripLabel[];
  /** Cap colour, so the strip prints in whatever the user has loaded. */
  colorRgb: RGB;
}

const TILE_W = 20;
const TILE_H = 24;
const TILE_GAP = 2.5;
const PAD_THICK = 2.4;
// Width of the label across the tile. `parseLetter` normalises to a unit box on its LONGEST
// side, and these labels are always wider than they are tall ('+2%'), so this is the width
// and the glyph height follows the aspect — about 5 mm, which deboss legibly at 0.6 mm.
const LABEL_MM = 14;
const LABEL_DEPTH = 0.6;

export function buildFitStrip(
  wasm: Wasm,
  stem: Solid,
  opts: FitStripOptions,
): { parts: ClickerPart[]; warnings: string[] } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.1, Math.min(r, Math.min(w, h) / 2 - 0.01));
    const core = track(CrossSection.square([w - 2 * rr, h - 2 * rr], true));
    return track(core.offset(rr, 'Round', 2.0, 32));
  };
  const extrudeAt = (cs: Section, h: number, z: number): Solid =>
    track(track(Manifold.extrude(cs, Math.max(0.01, h))).translate([0, 0, z]));

  const stemBB = stem.boundingBox();
  // The cap's underside sits at the stem's top, and the stem hangs below it. Copying that here
  // is what makes a tile print like a cap rather than like a peg.
  const padBottomZ = stemBB.max[2];

  const labels = opts.labels.length ? opts.labels : [{ pct: 0, rings: [] }];
  const totalW = labels.length * TILE_W + (labels.length - 1) * TILE_GAP;
  const parts: ClickerPart[] = [];
  const warnings: string[] = [];

  labels.forEach((label, i) => {
    const cx = -totalW / 2 + TILE_W / 2 + i * (TILE_W + TILE_GAP);

    // Pad.
    let tile: Solid = extrudeAt(track(roundedRect(TILE_W, TILE_H, 3).translate([cx, 0])), PAD_THICK, padBottomZ);

    // The stem, sized exactly as buildClicker sizes it: grow or shrink a copy and clip it back
    // against the original so only the hole moves and the outer post stays where it was. If the
    // two drifted apart the strip would be testing something the app cannot produce.
    let sized: Solid = stem;
    if (Math.abs(label.pct) > 0.01) {
      const f = 1 + label.pct / 100;
      const scaled = track(stem.scale([f, f, 1]));
      sized = track(f > 1 ? scaled.intersect(stem) : scaled.add(stem));
    }
    tile = track(tile.add(track(sized.translate([cx, 0, 0]))));

    // Deboss the number. Cut rather than raise: a recess needs no support and survives the flip.
    if (label.rings.length) {
      let text: Section | null = null;
      for (const ring of label.rings) {
        if (ring.length < 3) continue;
        const poly = track(CrossSection.ofPolygons([ring.map(([x, y]) => [x * LABEL_MM + cx, y * LABEL_MM - TILE_H / 2 + 4.5])], 'EvenOdd'));
        text = text ? track(text.add(poly)) : poly;
      }
      if (text) {
        const cut = extrudeAt(text, LABEL_DEPTH + 0.2, padBottomZ + PAD_THICK - LABEL_DEPTH);
        tile = track(tile.subtract(cut));
      }
    }

    const mesh = tile.getMesh();
    parts.push({
      kind: 'cap',
      group: 'top',
      colorRgb: opts.colorRgb,
      name: `fit-${label.pct}`,
      vertProperties: mesh.vertProperties,
      triVerts: mesh.triVerts,
      numProp: mesh.numProp,
    });
  });

  warnings.push(
    'Fit test: print this, push each tile onto a switch, then set Switch stem fit to the number on the one that fits.',
  );

  for (const o of trash) {
    try { o.delete(); } catch { /* already gone */ }
  }
  return { parts, warnings };
}
