// Your own SVG, with a pattern in the areas you clicked.
//
// The one thing this design does that no other does: it lets the customer POINT at part of
// their own drawing. An SVG traced by the symbol picker comes back as islands, and an island
// is a face — a surface with an area, which is what the laser cuts out and what a pattern can
// fill. So "click the areas" needs no new geometry at all: it is a set of island indices, and
// `src/areas.ts` holds the picker, the value format and the region it hands back.
//
// The piece IS the artwork: the blank is the traced faces, so an earring blank comes out
// earring-shaped and the outline is the cut. Everything else — the ten pattern knobs, the
// fill's options, the op a pattern will and will not do — is `pattern-shared.ts`, the same
// module the library-shape version (`pattern-fill`) uses, so the two cannot drift apart.
import { centreShapes, circleRing, type Shapes } from '@vostok/laser';
import { iconById } from '@vostok/fonts';
import { fillShape } from '@vostok/patterns';
import { areasOf, areasValue, artworkFaces, filledFaces, pickedAreas, pickedCount, regionOf, scaleFaces, spanOf } from '../areas';
import { distanceToOutline, finalHoleCentre, insideShapes } from '../engine/editorGeometry';
import type { DesignLayer } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { DEFAULT_PATTERN, askedOp, fillCount, fillLayers, fillOptions, patternDefFor, patternFields, resolveOp } from './pattern-shared';
import { stem } from './shared';
import { num, str, type TemplateDef } from './types';

/** The card's artwork: Material Symbols' eight-petal flower. Picked for its FACES — nine of
 *  them — because the card has one job, which is to show that the areas are separate things
 *  you can pattern one at a time. */
const DEFAULT_SYMBOL = iconById('filter_vintage')?.char ?? '';

export const patternSvg: TemplateDef = {
  id: 'pattern-svg',
  name: 'Pattern on your SVG',
  blurb: 'Upload your own shape — an earring blank, a pendant, a logo — click the areas you want patterned, and cut it out.',
  tags: ['pattern', 'score + cut'],
  exportNote: (v) =>
    str(v, 'patternOp') === 'cut'
      ? 'Cut the pattern holes before the outline, so the piece can’t shift.'
      : 'Run the engrave and score before the outline.',
  fields: [
    {
      kind: 'svg', key: 'artwork', sizeKey: 'size', label: 'Your SVG', panel: 'right', section: 'Artwork', value: DEFAULT_SYMBOL,
      help: 'Crop to the shape first, photos are ignored.',
    },
    {
      kind: 'areas', key: 'areas', from: 'artwork', label: 'Pattern areas', panel: 'right', section: 'Artwork', value: '',
      help: 'Click a surface of your SVG to pattern it or leave it plain.',
    },
    {
      // Up to 1000 mm: a dropped cut file sets this to its own size, and it has to FIT. 400 was
      // "a bed is rarely wider", but a sheet is not a bed — a sheet laid out by a typical box
      // tool came in 551 mm tall, was clamped to 400, and every finger joint came out at 73 %.
      kind: 'number', key: 'size', label: 'Size', section: 'Shape & size', value: 60, min: 20, max: 1000, step: 1, unit: 'mm',
      help: 'Longest side of the finished piece. A file that states its own size opens at it.',
    },
    ...patternFields({ section: 'Pattern', value: DEFAULT_PATTERN, op: 'score', margin: 0 }),
    // Off by default. The customer's own SVG may already HAVE the hole it
    // hangs from — an earring blank usually does — and a second one punched through it
    // uninvited is a hole in someone else's drawing. The option stays one click away. Since
    // 2026-09-28 it is the usual loop tab, which can be dragged inside the shape to hang from a
    // hole with its own border; a Hole saved before then opens as the tab, resting where it was.
    ...keyringFields('none', { section: 'Hanging', dia: 2.5, ring: 2, maxDia: 8, maxRing: 5, nudge: 60, ringNote: 'A tab grown off the edge, with a hole for a jump ring.' }),
  ],

  async build(v) {
    // A saved `ringPos` (a fraction round the outline) is not honoured — heart-puzzle-keychains'
    // ruling, for this design's own reason. The editor has never written one here (the drag writes
    // `ringDx`/`ringDy` only, and has since before this design existed), and the fraction is
    // walked on the engine's welded outline, whose vertices come back from manifold in another
    // order than the traced faces below: the reserve that keeps the pattern off the ring landed
    // across the piece from the hole ((−23.1, −13.5) against (23.6, −12.9), 2026-09-28).
    const keyring = { ...keyringFrom(v), position: -1 };
    // The faces are taken ONCE, at the picker's own size, and scaled from there — never
    // re-traced at the size slider's value. Re-tracing is where a face could change index and
    // the customer's click would land on a different petal.
    const traced = await artworkFaces(v, 'artwork');
    if (!traced.length) {
      return {
        blank: { kind: 'shape', shapes: [] }, keyring, layers: [],
        warnings: ['Drop your SVG under “Your SVG” to start.'],
      };
    }
    const faces = centreShapes(scaleFaces(traced, num(v, 'size') / spanOf(traced))).shapes;

    const def = await patternDefFor(str(v, 'pattern'));
    const resolved = resolveOp(def, askedOp(v));
    const op = resolved.op;
    const warnings = [...resolved.warnings];

    // The region: the areas that were clicked, each copied because a reserve is pushed onto it.
    // A clicked HOLE is filled back in — it stops being cut, or the pattern would fall out with
    // it — so the piece is the faces with those holes closed (`areas.ts`, `areasOf`).
    const picked = pickedAreas(str(v, 'areas'), str(v, 'artwork'));
    const areas = areasOf(faces);
    const shapes = filledFaces(areas, picked);
    const region: Shapes = regionOf(areas, picked).map((face) => [...face]);
    if (!region.length) {
      warnings.push('No areas are picked, so nothing is patterned — open “Pattern areas” and click one.');
    }
    // The ring keeps its border of material, wherever it is dragged. A tab whose lug lies wholly
    // inside a patterned face — one resting inside, as a Hole saved before 2026-09-28 does, or one
    // dragged in — gets that disc as a hole in the face, so the fill leaves it alone: exactly the
    // reserve the punched hole had, and what keeps an engraved or scored pattern off the border.
    // `insideShapes` reads one face even-odd, which is "inside this face and outside its own
    // holes" — the exact question. A lug that CROSSES a face's edge cannot be reserved that way (a
    // reserve that crosses the outline stops excluding anything).
    let lug: { centre: [number, number]; r: number } | null = null;
    if (keyring.enabled) {
      const { centre } = finalHoleCentre(shapes, keyring);
      const r = keyring.dia / 2 + keyring.ring;
      const air = (face: Shapes[number]) => Math.min(...face.map((ring) => distanceToOutline([[ring]], centre)));
      const host = region.find((face) => insideShapes([face], centre));
      if (host && air(host) >= r - 0.05) host.push(circleRing(centre[0], centre[1], r - 0.05, 48));
      if (op === 'cut') lug = { centre, r };
    }

    const fill = region.length ? fillShape(region, def, fillOptions(v, op)) : null;
    if (fill) warnings.push(...fill.warnings);
    if (fill && lug) {
      // A CUT never reaches the lug, reserved or not, so the wall round the hole is the border the
      // customer set and no thin wall is possible — nothing to warn about. No hole may come within
      // it (a hole partly inside is dropped whole: clipped, it would leave a sliver no laser cuts
      // cleanly), and a lattice gets it as one more solid its struts land on, which its faces are
      // cut round. The reserve alone did not hold a lattice: measured 2026-09-28 on the default
      // flower, a hole resting inside a petal kept 0.00–0.78 mm of wall at 8 of 12 places round it
      // (the punched hole the same), and 1.99–2.00 with the solid.
      const { centre, r } = lug;
      const clear = (island: Shapes[number]) =>
        !insideShapes([island], centre) && Math.min(...island.map((ring) => distanceToOutline([[ring]], centre))) >= r;
      fill.shapes = fill.shapes.filter(clear);
      fill.lattice?.solids.push([circleRing(centre[0], centre[1], r, 48)]);
    }

    const layers: DesignLayer[] = fill ? fillLayers(fill, def) : [];

    // The same words the control uses, so the panel and the status line never disagree about
    // what is patterned — "Every area" beside "8 of 8 areas" reads as two different answers.
    const count = pickedCount(areas, picked);
    const said = count.all ? (shapes.length === 1 ? 'the whole shape' : `all ${shapes.length} areas`) : count.text;
    return {
      blank: { kind: 'shape', shapes },
      keyring,
      layers,
      warnings,
      status: fill ? `${def.name} · ${fillCount(op, fill)} · ${said}` : `${shapes.length} areas · none patterned`,
    };
  },

  fileName: (v) => stem(str(v, 'pattern') || 'pattern', 'cutout'),
};

/** For tests and scripts: the values that pattern exactly these faces of an artwork. */
export const pickAreas = (char: string, ids: number[]) => ({ artwork: char, areas: areasValue(char, ids) });
