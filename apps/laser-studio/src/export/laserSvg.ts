// The one export (invariant #8): the built part → a laser SVG, one group per operation in job
// order, via @vostok/export's cut-file writer — which already carries the provenance mark in
// <desc> (invariant #2), the hairline rule, holes-before-outline and the Y flip. A Photo rides
// along as an <image> in the engrave group, sized in millimetres. The bed offset is a stage
// convenience: the file is always fitted to the artwork.
//
// A design cut from more than one sheet splits its CUT group by piece — `CUT-main`,
// `CUT-middle`, `CUT-name` — because the three outlines of a layered keychain are three
// different colours of acrylic, and one flat `<g id="CUT">` of thirteen anonymous paths makes
// the operator guess which is which. Engraves and scores stay in one group each: they run on
// whichever sheet their outline is on, and the id says whose they are anyway.
//
// A piece cut from a different MATERIAL is the one exception to that last sentence. When a part
// says `material: 'card'` — the kraft holder card of a bracelet set — its outline AND its scores
// go into their own groups (`CUT-card-<id>`, `SCORE-card-<id>`), each carrying the part's label as
// a `<desc>`, because paper is a sheet change and a different power: an operator runs the wood,
// swaps the sheet and then runs only these.
import { buildCutSvg, downloadFile, type CutLayer } from '@vostok/export';
import { OPS, OP_ORDER, bboxOf, type Shapes } from '@vostok/laser';
import type { BuildOutput } from '../engine/types';

/** The two outline objects the engine emits: every piece's own outline, and the card's. */
const PLATE_IDS = new Set(['plate', 'plate:card']);

/** The islands of `plate` that belong to one piece — the same box test the Assembled view uses
 *  to pull a stack apart, because the layout has already put every piece in its own box. */
function plateOf(out: BuildOutput, box: { minX: number; minY: number; maxX: number; maxY: number }): Shapes {
  return out.plate.filter((island) => {
    const b = bboxOf([island]);
    return b.minX >= box.minX - 0.05 && b.maxX <= box.maxX + 0.05 && b.minY >= box.minY - 0.05 && b.maxY <= box.maxY + 0.05;
  });
}

/** Which piece's marks an object is: a part's objects carry its id as a prefix, the primary's
 *  carry none, and the outline objects belong to no single piece. */
function ownerOf(id: string): string {
  if (PLATE_IDS.has(id)) return '';
  const i = id.indexOf(':');
  return i < 0 ? 'main' : id.slice(0, i);
}

export function buildLaserStudioSvg(out: BuildOutput, buildId?: string): string {
  const layers: CutLayer[] = [];
  const card = out.parts.filter((p) => p.material === 'card');
  const cardIds = new Set(card.map((p) => p.id));
  for (const op of OP_ORDER) {
    const mine = out.objects.filter((o) => o.op === op);
    const named = (name: string, objects: typeof mine, plate: Shapes = [], desc?: string): CutLayer => ({
      name,
      ...(desc ? { desc } : {}),
      color: OPS[op].color,
      mode: OPS[op].mode,
      shapes: [...plate, ...objects.filter((o) => !o.image).flatMap((o) => o.shapes)],
      // Open runs — a score the outline cut into arcs, the seams of a welded word — go in the
      // same group, written without a closing Z (invariant: the file is the truth of what was
      // built).
      paths: objects.filter((o) => !o.image).flatMap((o) => o.paths ?? []),
      images: objects.filter((o) => o.image).map((o) => o.image!),
    });
    if (op !== 'cut') {
      // The kraft pieces' marks come out of the shared group: they are scored on paper, at paper
      // power, after a sheet change. A design with no card piece is unaffected.
      const kraft = cardIds.size ? mine.filter((o) => cardIds.has(ownerOf(o.id))) : [];
      layers.push(named(op.toUpperCase(), kraft.length ? mine.filter((o) => !kraft.includes(o)) : mine));
      for (const part of card) {
        const own = kraft.filter((o) => ownerOf(o.id) === part.id);
        if (own.length) layers.push(named(`${op.toUpperCase()}-card-${part.id}`, own, [], part.label));
      }
      continue;
    }
    if (out.parts.length < 2) {
      layers.push(named('CUT', mine));
      continue;
    }
    // One group per piece. The engine merges every piece's outline into the single `plate`
    // object, so the outlines are split back out by their piece's own box; a cut layer of its
    // own (a letter hole, a slot) carries its piece's id as a prefix, and the primary's carries
    // none.
    const whole = mine.filter((o) => PLATE_IDS.has(o.id));
    for (const part of out.parts) {
      const prefix = `${part.id}:`;
      const own = mine.filter((o) => !PLATE_IDS.has(o.id) && (part.id === 'main' ? !o.id.includes(':') : o.id.startsWith(prefix)));
      const plate = whole.length ? plateOf(out, part.box) : [];
      if (!own.length && !plate.length) continue;
      const kraft = cardIds.has(part.id);
      layers.push(named(kraft ? `CUT-card-${part.id}` : `CUT-${part.id}`, own, plate, kraft ? part.label : undefined));
    }
  }
  return buildCutSvg(layers, {
    title: 'Laser Studio',
    generator: 'laser-studio',
    application: 'Vostok Labs Laser Studio',
    ...(buildId ? { buildId } : {}),
  });
}

export function downloadLaserStudioSvg(out: BuildOutput, fileName: string, buildId?: string): void {
  downloadFile(buildLaserStudioSvg(out, buildId), fileName, 'image/svg+xml');
}
