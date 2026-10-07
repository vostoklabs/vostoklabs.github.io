// The one export (invariant #8): a built box → one laser SVG per sheet, via @vostok/export's
// cut-file writer — which carries the provenance mark in <desc> (invariant #2), the hairline
// rule, holes-before-outline and the Y flip.
//
// Each sheet's file has one ENGRAVE group, one SCORE group, then one CUT group per piece
// (`CUT-front`, `CUT-lid`…): engrave and score run first while the sheet still holds every
// piece, and a piece's own slots and flex-tab slits are written before its outline, so nothing
// drops out before it is finished. The kerf is already in the red lines — the README and the
// Export Preview's legend both say to set the software's own offset to zero.
//
// The download is the shelf's cut download (`downloadCut`): one sheet as its `.svg`, more as one
// `.zip` of a file per sheet and the README.
import { buildCutSvg, type CutFile, type CutLayer } from '@vostok/export';
import { OPS } from '@vostok/laser/ops';
import { boxOf, placePoint } from '../engine/layout';
import type { BuildResult } from '../engine/build';
import type { Pt, Shapes } from '../engine/types';

export function buildSheetSvgs(r: BuildResult, stem: string, buildId?: string): CutFile[] {
  const files: CutFile[] = [];
  const byId = new Map(r.pieces.map((p) => [p.id, p]));
  for (let s = 0; s < r.sheets; s++) {
    const engrave: Shapes = [];
    const scoreShapes: Shapes = [];
    const scorePaths: Pt[][] = [];
    const cuts: CutLayer[] = [];
    for (const pl of r.placements) {
      if (pl.sheet !== s) continue;
      const p = byId.get(pl.id);
      if (!p) continue;
      const box = boxOf(p.cut);
      const at = (q: Pt): Pt => placePoint(q, pl, box);
      const place = (shapes: Shapes): Shapes => shapes.map((island) => island.map((ring) => ring.map(at)));
      engrave.push(...place(p.engrave));
      scoreShapes.push(...place(p.score.shapes));
      scorePaths.push(...p.score.paths.map((path) => path.map(at)));
      cuts.push({ name: `CUT-${p.id}`, desc: p.label, color: OPS.cut.color, mode: 'line', shapes: place(p.cut), paths: p.cutSlits.map((path) => path.map(at)) });
    }
    const layers: CutLayer[] = [
      { name: 'ENGRAVE', color: OPS.engrave.color, mode: 'fill', shapes: engrave },
      { name: 'SCORE', color: OPS.score.color, mode: 'line', shapes: scoreShapes, paths: scorePaths },
      ...cuts,
    ];
    const svg = buildCutSvg(layers, {
      title: r.sheets > 1 ? `Laser Box — sheet ${s + 1} of ${r.sheets}` : 'Laser Box',
      generator: 'laser-box',
      application: 'Vostok Labs Laser Box',
      ...(buildId ? { buildId } : {}),
    });
    files.push({ name: r.sheets > 1 ? `${stem}-sheet-${s + 1}.svg` : `${stem}.svg`, text: svg });
  }
  return files;
}

/** What the colours mean and how the kerf was handled, for the zip. */
export function readme(r: BuildResult, kerf: number, notes: string[]): string {
  return [
    'Laser Box — cut files',
    '',
    `${r.sheets} sheet${r.sheets === 1 ? '' : 's'}, ${r.sheet.width} × ${r.sheet.height} mm, one SVG each, in millimetres.`,
    '',
    'Red lines CUT. Blue lines SCORE (a light pass that does not cut through). Black fills ENGRAVE.',
    'Run engrave and score first, then cut.',
    '',
    `The kerf (${kerf.toFixed(2)} mm) is already built into the red lines: set your laser software's`,
    'kerf or offset to 0, or the joints will come out loose.',
    '',
    ...notes,
  ].join('\n');
}
