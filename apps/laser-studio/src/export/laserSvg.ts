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
//
// A design on one sheet downloads as one SVG. A batch run laid on more than one sheet downloads
// as one zip: an SVG per sheet, holding that sheet's pieces and nothing else, and a README saying
// which is which (`cutFiles`). A sheet IS one material, so a run laid out a colour at a time
// names each file's material: `<stem>-sheet-2-dark.svg`.
import { buildCutSvg, buildZip, downloadFile, type CutLayer } from '@vostok/export';
import { OPS, OP_ORDER, bboxOf, type Box, type Shapes } from '@vostok/laser';
import type { BuildObject, BuildOutput } from '../engine/types';

/** The two outline objects the engine emits: every piece's own outline, and the card's. */
const PLATE_IDS = new Set(['plate', 'plate:card']);

/** `b` lies inside `box`, give or take the 0.05 mm a placed outline can round by. */
const inBox = (b: Box, box: Box) => b.minX >= box.minX - 0.05 && b.maxX <= box.maxX + 0.05 && b.minY >= box.minY - 0.05 && b.maxY <= box.maxY + 0.05;

/** The islands of `plate` that belong to one piece — the same box test the Assembled view uses
 *  to pull a stack apart, because the layout has already put every piece in its own box. */
function plateOf(out: BuildOutput, box: { minX: number; minY: number; maxX: number; maxY: number }): Shapes {
  return out.plate.filter((island) => inBox(bboxOf([island]), box));
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

/**
 * A run on more than one sheet, a sheet at a time: each page's pieces and nothing else. A piece
 * is on the page its left edge is on — the layout starts every piece inside its own page's
 * margin, so that holds even for a piece too big for its sheet, which no box test would place.
 * Its marks go with it by id, the way the cut groups are split, and each outline island with the
 * piece whose box it lies in. One page, or none, is the output as it is.
 */
export function sheetOutputs(out: BuildOutput): BuildOutput[] {
  const pages = out.sheets?.pages ?? [];
  if (pages.length < 2) return [out];
  // The pages run left to right, so a box's page is the last one that starts left of it.
  const pageAt = (b: Box) => pages.reduce((k, pg, i) => (pg.minX <= b.minX + 0.05 ? i : k), 0);
  const pageOf = new Map(out.parts.map((p) => [p.id, pageAt(p.box)]));
  const islandPage = (island: Shapes[number]) => {
    const b = bboxOf([island]);
    const part = out.parts.find((p) => inBox(b, p.box));
    return part ? pageOf.get(part.id)! : pageAt(b);
  };
  return pages.map((_, k) => {
    const objects: BuildObject[] = [];
    for (const o of out.objects) {
      const owner = pageOf.get(ownerOf(o.id));
      if (owner !== undefined) {
        if (owner === k) objects.push(o);
        continue;
      }
      // The outlines — one object for every piece — and anything no piece owns: island by island.
      const { paths, image, ...rest } = o;
      const kept: BuildObject = { ...rest, shapes: o.shapes.filter((island) => islandPage(island) === k) };
      const own = (paths ?? []).filter((path) => pageAt(bboxOf([[path]])) === k);
      if (own.length) kept.paths = own;
      if (image && pageAt({ minX: image.x, minY: image.y, maxX: image.x + image.width, maxY: image.y + image.height }) === k) kept.image = image;
      if (kept.shapes.length || kept.paths || kept.image) objects.push(kept);
    }
    return {
      ...out,
      objects,
      plate: out.plate.filter((island) => islandPage(island) === k),
      parts: out.parts.filter((p) => pageOf.get(p.id) === k),
    };
  });
}

/**
 * The download, as files. A design on one sheet, or on none, is one SVG, `<stem>.svg`, exactly
 * as it always was. A run on more than one is an SVG per sheet, `<stem>-sheet-<n>.svg` — with the
 * sheet's material after it when the run was laid out a colour at a time — and a README.
 */
export function cutFiles(out: BuildOutput, stem: string, opts: { design: string; note?: string; buildId?: string }): { name: string; text: string }[] {
  const pages = sheetOutputs(out);
  if (pages.length < 2) return [{ name: `${stem}.svg`, text: buildLaserStudioSvg(out, opts.buildId) }];
  const materials = out.sheets?.materials;
  const svgs = pages.map((page, i) => ({
    name: `${stem}-sheet-${i + 1}${materials?.[i] ? `-${materials[i]}` : ''}.svg`,
    text: buildLaserStudioSvg(page, opts.buildId),
  }));
  const material = (i: number) => (materials?.[i] === 'card' ? 'card stock' : materials?.[i] ? `${materials[i]} material` : '');
  const width = Math.max(...svgs.map((f) => f.name.length));
  // Read at the machine: which file goes on which sheet, and the order a sheet is run in.
  const readme = [
    `${opts.design} — Vostok Labs Laser Studio`,
    '',
    `${svgs.length} sheets of ${out.sheets?.width} × ${out.sheets?.height} mm, one SVG each, in millimetres${materials ? '. Each sheet is one material:' : ':'}`,
    ...svgs.map((f, i) => `  ${material(i) ? `${f.name.padEnd(width)}   ${material(i)}` : f.name}`),
    '',
    'Line colours are operations: red cuts, blue scores (set it to Score, not Cut), black engraves.',
    'On each sheet, run the engrave and the score before the cut: a piece cut free can shift.',
    ...(opts.note ? ['', opts.note] : []),
    ...(opts.buildId ? ['', `Build ${opts.buildId}`] : []),
    '',
  ].join('\n');
  return [...svgs, { name: 'README.txt', text: readme }];
}

/** Save the cut file: the one SVG, or a zip of the sheets and their README. */
export function downloadCutFiles(out: BuildOutput, stem: string, opts: Parameters<typeof cutFiles>[2]): void {
  const files = cutFiles(out, stem, opts);
  if (files.length === 1) downloadFile(files[0]!.text, files[0]!.name, 'image/svg+xml');
  else downloadFile(buildZip(Object.fromEntries(files.map((f) => [f.name, f.text]))), `${stem}.zip`, 'application/zip');
}
