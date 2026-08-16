// The one export function. Everything that leaves this app for a machine goes
// through `buildCutFiles`.
//
// Carried over from the laser generator, because they were learned the hard way and
// they are about how importers behave rather than what the spec says:
//
//   1. ONE CLOSED RING PER OBJECT. Never `M…Z M…Z` in a single element. Where a
//      machine has no explicit pen lift, the boundary between objects is the only
//      lift it has, so a second subpath inside one object gets drawn as a travel
//      line straight across the part.
//   2. HOLES BEFORE THEIR OUTER RING. Document order IS cut order and SVG carries no
//      other ordering semantics. Cut the perimeter first and the blank comes loose
//      on the mat, and every inner cut after it misregisters.
//   3. RINGS CLOSE EXACTLY. First point identical to the last, not within an epsilon.
//
// And two this app adds:
//
//   4. OPERATION IS A FILL COLOUR, not only a stroke. Bambu Suite assigns a process
//      by fill and only falls back to stroke; its colour-selection tool then picks
//      every object of one colour in a single click. Silhouette can select by fill
//      OR line. A stroke-only file makes the user do it path by path — fourteen fold
//      lines by hand.
//   5. A 100 mm CALIBRATION RECTANGLE in every file. Illustrator's legacy is 72 dpi,
//      Inkscape 0.92+ and most cutter front-ends are 96, and the incumbent's own
//      output is 72 — which is the "my box came out 4% small" bug. One rectangle the
//      user can measure settles it before they waste a sheet.

import { zipSync, strToU8 } from 'fflate';
import { BRAND } from '@vostok/brand';
import type { BoxParams, Net, Op, Poly, SolveResult } from '../types';
import { dashSegment, signedArea } from '../geometry/poly';
import { assemblySteps } from '../geometry/net';
import { machineById, sheetById, stockById } from '../geometry/solve';
import { styleMeta } from '../geometry/styles';

/** Operation -> colour. These are the conventions the machines actually recognise:
 *  red cuts on every laser front-end since the 1990s, and the rest simply have to be
 *  distinct from it and from each other. */
export const OP_COLOR: Record<Op, string> = {
  cut: '#FF0000',
  crease: '#0000FF',
  perf: '#00A0FF',
  film: '#00C0C0',
  engrave: '#000000',
};

const OP_LAYER: Record<Op, string> = {
  cut: 'CUT',
  crease: 'CREASE',
  perf: 'PERF',
  film: 'FILM',
  engrave: 'ENGRAVE',
};

/** DXF ACI colour indices, so a file opened in LightBurn arrives already sorted. */
const OP_ACI: Record<Op, number> = { cut: 1, crease: 5, perf: 4, film: 3, engrave: 7 };

/** Hairline: what Epilog and Trotec drivers read as "vector, not raster". */
const HAIRLINE_MM = 0.05;

export interface CutMeta {
  title: string;
  params: BoxParams;
  buildId?: string;
}

interface Path {
  op: Op;
  points: Poly;
  closed: boolean;
}

function n(v: number): string {
  // 3 dp is finer than any of these machines positions to, and -0 reads as a bug.
  return (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
}

/** Every path in the file, in cut order. */
export function collectPaths(result: SolveResult): Path[] {
  const { net, params } = result;
  const holes: Path[] = [];
  const outers: Path[] = [];
  const inner: Path[] = [];

  for (const ring of net.cutRings) {
    (signedArea(ring) < 0 ? holes : outers).push({ op: 'cut', points: ring, closed: true });
  }

  // Fold lines. What they become is the single decision this whole file turns on,
  // because no target machine has a crease operation: a laser scores (and browns the
  // outside of the box), a blade perforates, a pen draws a line you fold by hand.
  if (params.foldMode !== 'none') {
    for (const c of net.creases) {
      if (params.foldMode === 'perf') {
        for (const seg of dashSegment(c.a, c.b, params.perfCutMm, params.perfGapMm)) {
          inner.push({ op: 'perf', points: seg, closed: false });
        }
      } else {
        inner.push({ op: 'crease', points: [c.a, c.b], closed: false });
      }
    }
  }

  for (const s of net.slits) {
    if (s.op === 'crease' && params.foldMode === 'none') continue;
    inner.push({ op: s.op, points: s.points, closed: false });
  }

  for (const l of net.loose) {
    for (const h of l.holes) holes.push({ op: l.op, points: h, closed: true });
    outers.push({ op: l.op, points: l.outline, closed: true });
  }

  // Holes and interior features first, perimeters last. Rule 2.
  return [...holes, ...inner, ...outers];
}

/** The measurable square. Placed just outside the blank so it never fouls a part,
 *  and drawn on the engrave layer so a user who forgets to delete it does not cut it
 *  out of their sheet. */
function calibrationBox(net: Net): Path {
  const x = net.bbox[0];
  const y = net.bbox[3] + 6;
  return {
    op: 'engrave',
    points: [
      [x, y],
      [x + 100, y],
      [x + 100, y + 10],
      [x, y + 10],
    ],
    closed: true,
  };
}

// ───────────────────────────────── SVG ─────────────────────────────────

export function buildSvg(result: SolveResult, meta: CutMeta): string {
  const sheet = sheetById(result.params.sheetId);
  const H = sheet.heightMm;
  const W = sheet.widthMm;
  const paths = [...collectPaths(result), calibrationBox(result.net)];

  // Grouped by operation so a human opening the file sees four layers, but emitted
  // in cut order within each group — the order that matters is document order, and
  // grouping preserves it.
  const byOp = new Map<Op, Path[]>();
  for (const p of paths) {
    const list = byOp.get(p.op);
    if (list) list.push(p);
    else byOp.set(p.op, [p]);
  }

  const body: string[] = [];
  for (const [op, list] of byOp) {
    const colour = OP_COLOR[op];
    body.push(`  <g id="${OP_LAYER[op]}" inkscape:groupmode="layer" inkscape:label="${OP_LAYER[op]}">`);
    for (const p of list) {
      if (p.points.length < 2) continue;
      // Y flipped into the numbers, not into a transform: SVG's origin is top-left
      // and the sheet's is bottom-left, and a `transform` is exactly the kind of
      // thing an importer silently drops.
      const start = p.points[0] as [number, number];
      const d =
        `M ${n(start[0])} ${n(H - start[1])} ` +
        p.points
          .slice(1)
          .map(([x, y]) => `L ${n(x)} ${n(H - y)}`)
          .join(' ') +
        (p.closed ? ' Z' : '');
      // Fill AND stroke. Rule 4. Closed rings get the fill that machines read the
      // process from; open lines cannot carry one, so they lean on the stroke, which
      // is the documented fallback.
      const fill = p.closed ? `fill="${colour}" fill-opacity="0.06"` : 'fill="none"';
      body.push(`    <path d="${d}" ${fill} stroke="${colour}" stroke-width="${HAIRLINE_MM}"/>`);
    }
    body.push('  </g>');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
    `     version="1.1" width="${n(W)}mm" height="${n(H)}mm" viewBox="0 0 ${n(W)} ${n(H)}">`,
    `  <title>${esc(meta.title)}</title>`,
    `  <desc>${esc(provenance(meta))}</desc>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] as string);
}

// ───────────────────────────────── DXF ─────────────────────────────────

export function buildDxf(result: SolveResult, meta: CutMeta): string {
  const paths = [...collectPaths(result), calibrationBox(result.net)];
  const sheet = sheetById(result.params.sheetId);
  const g: string[] = [];
  const p = (code: number | string, value: string | number) => {
    g.push(String(code), String(value));
  };

  p(0, 'SECTION');
  p(2, 'HEADER');
  p(9, '$ACADVER');
  p(1, 'AC1009');
  // The difference between 150 mm and 150 inches. $INSUNITS is strictly R2000+ but
  // every importer worth having reads it; $MEASUREMENT is the R12-era equivalent, so
  // write both and let the reader take its pick.
  p(9, '$INSUNITS');
  p(70, 4);
  p(9, '$MEASUREMENT');
  p(70, 1);
  p(9, '$EXTMIN');
  p(10, n(0));
  p(20, n(0));
  p(30, n(0));
  p(9, '$EXTMAX');
  p(10, n(sheet.widthMm));
  p(20, n(sheet.heightMm));
  p(30, n(0));
  p(0, 'ENDSEC');

  // DXF carries the operation on a LAYER; there is no colour convention the way
  // there is in SVG.
  p(0, 'SECTION');
  p(2, 'TABLES');
  p(0, 'TABLE');
  p(2, 'LAYER');
  p(70, Object.keys(OP_LAYER).length);
  for (const op of Object.keys(OP_LAYER) as Op[]) {
    p(0, 'LAYER');
    p(2, OP_LAYER[op]);
    p(70, 0);
    p(62, OP_ACI[op]);
    p(6, 'CONTINUOUS');
  }
  p(0, 'ENDTAB');
  p(0, 'ENDSEC');

  p(0, 'SECTION');
  p(2, 'ENTITIES');
  for (const path of paths) {
    if (path.points.length < 2) continue;
    const layer = OP_LAYER[path.op];
    p(0, 'POLYLINE');
    p(8, layer);
    p(66, 1);
    p(70, path.closed ? 1 : 0);
    p(10, n(0));
    p(20, n(0));
    p(30, n(0));
    for (const [x, y] of path.points) {
      p(0, 'VERTEX');
      p(8, layer);
      p(10, n(x));
      p(20, n(y));
      p(30, n(0));
    }
    p(0, 'SEQEND');
    p(8, layer);
  }
  p(0, 'ENDSEC');
  p(0, 'EOF');

  return g.join('\r\n') + '\r\n';
}

// ──────────────────────────────── README ────────────────────────────────

function provenance(meta: CutMeta): string {
  return `${meta.title} — generated by ${BRAND.name} (${BRAND.urls.hub})`;
}

const FOLD_WORDS: Record<BoxParams['foldMode'], string> = {
  score: 'scored (a light laser pass that does not cut through)',
  perf: 'perforated (a dashed cut you fold along)',
  draw: 'drawn (a pen line you fold by hand)',
  none: 'not marked at all',
};

function buildReadme(result: SolveResult, meta: CutMeta): string {
  const p = meta.params;
  const machine = machineById(p.machineId);
  const stock = stockById(p.stockId);
  const sheet = sheetById(p.sheetId);
  const style = styleMeta(p.style);
  const steps = assemblySteps(result.net);

  const lines: (string | null)[] = [
    meta.title,
    '='.repeat(Math.max(4, meta.title.length)),
    '',
    `${style.name} — ${result.net.panels.length} panels, ${result.net.creases.length} folds`,
    `Generated by ${BRAND.name} — ${BRAND.urls.hub}`,
    meta.buildId ? `Build: ${meta.buildId}` : null,
    '',
    'CUT THIS',
    `  Stock              ${stock.name}`,
    `  Measured caliper   ${p.caliperMm.toFixed(2)} mm   <- every panel was built for THIS number`,
    `  Sheet              ${sheet.name}`,
    `  Blank size         ${result.netSizeMm[0].toFixed(0)} x ${result.netSizeMm[1].toFixed(0)} mm`,
    `  Machine            ${machine.name}`,
    `  Fold lines         ${FOLD_WORDS[p.foldMode]}`,
    p.kerfMm > 0 ? `  Kerf               ${p.kerfMm.toFixed(2)} mm, already compensated` : null,
    '',
    'THE FILE',
    '  Colours and layers are the operation. Nothing relies on line style:',
    `    ${OP_COLOR.cut}  CUT      cut all the way through`,
    p.foldMode === 'perf'
      ? `    ${OP_COLOR.perf}  PERF     dashed cut — ${p.perfCutMm} mm on, ${p.perfGapMm} mm off`
      : p.foldMode !== 'none'
        ? `    ${OP_COLOR.crease}  CREASE   fold line — score or draw, never cut through`
        : null,
    result.net.loose.some((l) => l.op === 'film')
      ? `    ${OP_COLOR.film}  FILM     the window insert — cut this from acetate or PET, not card`
      : null,
    `    ${OP_COLOR.engrave}  ENGRAVE  the 100 mm check rectangle (see below)`,
    '',
    '  CHECK THE SCALE BEFORE YOU CUT. The rectangle on the ENGRAVE layer is exactly',
    '  100 mm wide. Measure it in your cutting software. If it reads 133 mm or 75 mm,',
    '  your importer has guessed the wrong DPI — use the DXF instead, which carries',
    '  its units inside the file.',
    '',
    'IN YOUR SOFTWARE',
    `  ${machine.note}`,
    machine.id.startsWith('h2d')
      ? '  Select everything and use ATTACH before assigning processes. Unattached objects\n  get sorted onto different plates and the folds lose their registration.'
      : null,
    machine.id.startsWith('cricut')
      ? '  Everything imports as Cut. Select the blue fold layer, set Operation to Score,\n  then select all and ATTACH — without Attach the fold lines move.'
      : null,
    machine.id === 'silhouette'
      ? '  Use the DXF: the free edition of Silhouette Studio cannot open SVG, and DXF\n  import drops the size, so set it back to the blank size printed above.'
      : null,
    machine.mirror
      ? '  This machine folds INTO the score, so the sheet goes on the mat pretty side down.\n  Mirror any artwork you add. The dieline itself is symmetric.'
      : null,
    p.foldMode === 'score' && machine.foldMode === 'score' && machine.id.startsWith('h2d')
      ? '  A laser score on paper is controlled charring — expect a brown line down every\n  fold. On white card that shows. Bambu also say not to leave paper jobs unattended.'
      : null,
    '',
    'ASSEMBLY',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    'ABOUT THE FIT',
    '  Caliper is the number everything here depends on, and the number on the packet',
    '  is not it — 300 gsm card is anywhere from 0.30 to 0.46 mm depending on its bulk.',
    '  If your box is tight or loose, measure a stack of ten sheets with calipers,',
    '  divide by ten, type that in and re-export.',
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// ──────────────────────────── the one function ────────────────────────────

export interface CutFiles {
  svg: string;
  dxf: string;
  readme: string;
  zip: Uint8Array;
  baseName: string;
}

export function buildCutFiles(result: SolveResult, meta: CutMeta): CutFiles {
  const svg = buildSvg(result, meta);
  const dxf = buildDxf(result, meta);
  const readme = buildReadme(result, meta);
  const baseName = safeName(meta.title);
  const zip = zipSync(
    {
      [`${baseName}.svg`]: strToU8(svg),
      [`${baseName}.dxf`]: strToU8(dxf),
      'README.txt': strToU8(readme),
    },
    { level: 6 },
  );
  return { svg, dxf, readme, zip, baseName };
}

function safeName(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'box';
}

export function downloadCutFiles(result: SolveResult, meta: CutMeta): CutFiles {
  const files = buildCutFiles(result, meta);
  triggerDownload(
    new Blob([files.zip as unknown as BlobPart], { type: 'application/zip' }),
    `${files.baseName}.zip`,
  );
  return files;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
