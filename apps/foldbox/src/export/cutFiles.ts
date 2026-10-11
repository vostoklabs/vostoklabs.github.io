// The one export function. Everything that leaves this app for a machine goes
// through `buildCutFiles`.
//
// Five rules, about how a file is read rather than what the spec allows:
//
//   1. ONE CLOSED RING PER OBJECT. Never `M…Z M…Z` in a single element. Where a
//      machine has no explicit pen lift, the boundary between objects is the only
//      lift it has, so a second subpath inside one object gets drawn as a travel
//      line straight across the part.
//   2. HOLES BEFORE THEIR OUTER RING. Document order IS cut order and SVG carries no
//      other ordering semantics. Cut the perimeter first and the blank comes loose
//      on the mat, and every inner cut after it misregisters.
//   3. RINGS CLOSE EXACTLY. First point identical to the last, not within an epsilon.
//   4. OPERATION IS A FILL COLOUR, not only a stroke, so selecting one colour selects
//      every line that gets that operation. A stroke-only file makes the user do it path
//      by path — fourteen fold lines by hand.
//   5. A 100 mm CALIBRATION RECTANGLE in every file. SVG software disagrees about how
//      many pixels make an inch (72 or 96), which is the "my box came out 4% small" bug.
//      One rectangle the user can measure settles it before they waste a sheet.

import { BRAND } from '@vostok/brand';
import { buildZip } from '@vostok/export';
import type { BoxParams, Machine, Net, Op, SolveResult } from '../types';
import { assemblySteps } from '../geometry/net';
import { buildLac, isLacMachine } from './lac';
import { machineById, sheetFor, stockById } from '../geometry/solve';
import { styleEcma, styleMeta } from '../geometry/styles';
import { OP_COLOR, collectPaths, explodeDashes, type Path } from './paths';

const OP_LAYER: Record<Op, string> = {
  cut: 'CUT',
  crease: 'CREASE',
  perf: 'PERF',
  film: 'FILM',
  engrave: 'ENGRAVE',
};

/** DXF ACI colour indices, so a file opened in laser software arrives already sorted. */
const OP_ACI: Record<Op, number> = { cut: 1, crease: 5, perf: 4, film: 3, engrave: 7 };

/** Hairline: the stroke laser drivers read as "vector, not raster". */
const HAIRLINE_MM = 0.05;

export interface CutMeta {
  title: string;
  params: BoxParams;
  buildId?: string;
}

function n(v: number): string {
  // 3 dp is finer than any of these machines positions to, and -0 reads as a bug.
  return (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
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
  const sheet = sheetFor(result.params);
  const H = sheet.heightMm;
  const W = sheet.widthMm;
  // The check rectangle is dropped where the importer reads SHAPE ONLY, which is the same
  // test the transport dash uses and the same field. There it would arrive as a closed ring
  // on the cut: a 100 x 10 mm hole in the user's sheet. It sits on the ENGRAVE layer so
  // that cannot happen elsewhere; the profiles whose importer ignores layers get a `.lac`
  // that states its scale outright, so nothing is lost.
  //
  // Keyed off `svgFold` rather than "does this machine get a .lac", which is a different
  // question: the machine-agnostic profiles get a `.lac` too, and their SVG goes to other
  // software, where the rectangle is the whole answer to "did my importer guess the DPI right".
  const paths = explodeDashes([
    ...collectPaths(result),
    ...(machineById(result.params.machineId).svgFold === 'dashed' ? [] : [calibrationBox(result.net)]),
  ]);

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
    `  <desc>${esc(creditLine(meta))}</desc>`,
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
  // The check rectangle is dropped where the importer reads SHAPE ONLY, which is the same
  // test the transport dash uses and the same field. There it would arrive as a closed ring
  // on the cut: a 100 x 10 mm hole in the user's sheet. It sits on the ENGRAVE layer so
  // that cannot happen elsewhere; the profiles whose importer ignores layers get a `.lac`
  // that states its scale outright, so nothing is lost.
  //
  // Keyed off `svgFold` rather than "does this machine get a .lac", which is a different
  // question: the machine-agnostic profiles get a `.lac` too, and their SVG goes to other
  // software, where the rectangle is the whole answer to "did my importer guess the DPI right".
  const paths = explodeDashes([
    ...collectPaths(result),
    ...(machineById(result.params.machineId).svgFold === 'dashed' ? [] : [calibrationBox(result.net)]),
  ]);
  const sheet = sheetFor(result.params);
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

/** The dash the file actually carries, in the numbers a user can measure. Auto sizing
 *  gives one pitch to every fold past ~32 mm, so there is a single sayable number almost
 *  always — and having to unzip an export to discover it was how the dash being wrong got
 *  noticed in the first place. */
function perfWords(result: SolveResult): string {
  const specs = collectPaths(result)
    .filter((p) => p.dash)
    .map((p) => `${(p.dash as { cutMm: number }).cutMm} mm on, ${(p.dash as { gapMm: number }).gapMm} mm off`);
  const common = [...new Set(specs)];
  return common.length === 1
    ? (common[0] as string)
    : `${common.length} sizes, each fold from its own length and the card`;
}

/** Said out loud because the line is ABSENT from the dieline, and comes back if the fold
 *  mode changes. Nothing else in the file would explain it. */
function hemWords(result: SolveResult): string | null {
  const n = result.net.panels.filter((p) => p.hem).length;
  if (n === 0) return null;
  const gap = (2 * result.params.caliperMm).toFixed(2);
  if (result.params.foldMode !== 'perf') {
    return (
      `  The ${n} double-ply ends show ONE fold line each in the SVG and the DXF, and TWO in
` +
      `  the .lac. Their creases sit ${gap} mm apart — one card thickness — so an importer
` +
      '  that reads shape alone would cut that strip out. The .lac names the operation, so\n' +
      '  it carries both and nothing is cut. Open that one.'
    );
  }
  return (
    `  The ${n} double-ply ends carry ONE perforated line each, not two. Their two creases
` +
    `  sit ${gap} mm apart — one card thickness — and cutting both would take that
` +
    '  strip out. Fold the second one against the first; it folds wherever it is weakened.'
  );
}

/** What the logo becomes on this machine. Worth saying, because the ENGRAVE layer is
 *  the one a user has not met before — and in a `.lac` it is the one layer that can land
 *  on a different process from everything else in the file. */
function logoWords(machine: Machine): string {
  if (!isLacMachine(machine.id)) return 'score or engrave it, never cut through';
  return machine.laser
    ? 'a Laser Line: a low-power pass that marks the face without cutting it'
    : 'a pen line (Drawing) — the machine pauses for the pen swap';
}

/** Every line in the `.lac`, named as Suite names it. Three processes at most, and the
 *  fold's is the one the user chose. */
function lacWords(machine: Machine, foldMode: BoxParams['foldMode'], hasMarks: boolean): string {
  const cut = machine.laser ? 'Laser Cut' : 'Basic Cut';
  const fold = machine.laser
    ? { perf: 'a dashed Laser Cut', score: 'Laser Line', draw: 'Laser Line', none: null }[foldMode]
    : { perf: 'a dashed Basic Cut', score: 'Drawing', draw: 'Drawing', none: null }[foldMode];
  const mark = machine.laser ? 'Laser Line' : 'Drawing';
  return (
    `outline on ${cut}${fold ? `, folds on ${fold}` : ', folds not marked'}` +
    (hasMarks ? `, logo on ${mark}` : '')
  );
}

function creditLine(meta: CutMeta): string {
  return `${meta.title}, generated by ${BRAND.name} (${BRAND.urls.hub})`;
}

const FOLD_WORDS: Record<BoxParams['foldMode'], string> = {
  score: 'scored (a light laser pass that does not cut through)',
  perf: 'perforated (a dashed cut you fold along)',
  draw: 'drawn (a pen line you fold by hand)',
  none: 'not marked at all',
};

function buildReadme(result: SolveResult, meta: CutMeta): string {
  const p = result.params;
  const machine = machineById(p.machineId);
  const stock = stockById(p.stockId);
  const sheet = sheetFor(p);
  const style = styleMeta(p.style);
  // Variant-aware: an option that changes the structure changes the code, so the file
  // must not carry the base style's code when the box in it is a different one.
  const ecma = styleEcma(p);
  const steps = assemblySteps(result.net);

  const lines: (string | null)[] = [
    meta.title,
    '='.repeat(Math.max(4, meta.title.length)),
    '',
    `${style.name}: ${result.net.panels.length} panels, ${result.net.creases.length} folds` +
      `, ${style.glueFree ? 'no glue' : 'one glued lap'}`,
    `Generated by ${BRAND.name}, ${BRAND.urls.hub}`,
    meta.buildId ? `Build: ${meta.buildId}` : null,
    '',
    // The structure's industry designation. Worth carrying into the file rather than
    // leaving on screen: it is what lets whoever ends up holding this file describe
    // the box to a printer, or satisfy themselves the shape is a standard one.
    'WHAT THIS STRUCTURE IS',
    `  ECMA code          ${ecma.code}`,
    `  Reads as           ${ecma.reads}`,
    `  Basis              ${
      ecma.basis === 'catalogue'
        ? `illustrated in the ECMA Code of Folding Carton Design Styles${ecma.page ? ` (p.${ecma.page})` : ''}`
        : ecma.basis === 'constructed'
          ? "composed from the group's matrix table of possible combinations"
          : 'nearest listed code; this structure is a derivative of it'
    }`,
    ecma.note ? `  Note               ${ecma.note}` : null,
    '  ECMA state that the designs in their Code, in the basic configurations',
    '  illustrated there, can be considered to be in the public domain. The',
    '  dimensions in this file are not theirs: every one is re-derived from your',
    '  measured caliper and clamped to fit. See the licence for the full position.',
    '',
    'CUT THIS',
    `  Stock              ${stock.name}`,
    `  Measured caliper   ${p.caliperMm.toFixed(2)} mm   <- every panel was built for THIS number`,
    `  Sheet              ${sheet.name}`,
    `  Blank size         ${result.netSizeMm[0].toFixed(0)} x ${result.netSizeMm[1].toFixed(0)} mm`,
    // Inside is what fits the product; ECMA A x B x H is what a printer quotes
    // against. Giving only one of them makes the file hard to hand on.
    `  Inside size        ${result.params.lengthMm.toFixed(0)} x ${result.params.widthMm.toFixed(0)} x ${result.params.heightMm.toFixed(0)} mm (${result.params.dimBasis})`,
    `  ECMA A x B x H     ${result.ecmaDimsMm[0].toFixed(1)} x ${result.ecmaDimsMm[1].toFixed(1)} x ${result.ecmaDimsMm[2].toFixed(1)} mm` +
      `   <- centre to centre of the creases, the trade's "manufacture dimensions"`,
    `  Machine            ${machine.name}`,
    `  Fold lines         ${FOLD_WORDS[p.foldMode]}`,
    // What the .lac will SAY, in the words the user sees in Suite. Worth spelling out:
    // every line in the file is on a named process, they are not all the same one, and
    // which one a fold gets is a setting they may well want to change.
    isLacMachine(p.machineId)
      ? `  In the .lac        ${lacWords(machine, p.foldMode, result.net.marks.length > 0)}`
      : null,
    // The SVG and the .lac genuinely differ for these machines, and a user who opens
    // the wrong one loses their sheet. Say so rather than letting them find out.
    machine.svgFold === 'dashed' && p.foldMode !== 'none' && p.foldMode !== 'perf'
      ? `  In the SVG         broken into dashes instead, because Suite cannot be told from an
                     SVG that a line is a fold. Open the .lac to get ${p.foldMode === 'draw' ? 'pen lines' : 'laser scores'}.`
      : null,
    p.kerfMm > 0 ? `  Kerf               ${p.kerfMm.toFixed(2)} mm, already compensated` : null,
    '',
    'THE FILE',
    machine.svgFold === 'dashed'
      ? `  Open the .lac. It names the operation for every line, so nothing has to be
  assigned by hand. The SVG and DXF say the same shapes in colours and layers,
  but Bambu Suite discards both on import and puts everything on the blade —
  which is why the fold lines in them are broken into dashes:`
      : '  Colours and layers are the operation. Nothing relies on line style:',
    `    ${OP_COLOR.cut}  CUT      cut all the way through`,
    p.foldMode === 'perf'
      ? p.perfAuto
        ? `    ${OP_COLOR.perf}  PERF     dashed cut, ${perfWords(result)}`
        : `    ${OP_COLOR.perf}  PERF     dashed cut, ${p.perfCutMm} mm on, ${p.perfGapMm} mm off`
      : p.foldMode !== 'none'
        ? machine.svgFold === 'dashed'
          ? `    ${OP_COLOR.crease}  CREASE   fold line. Dashed in this SVG so Suite cannot cut it through;
                     the .lac carries it whole, on the ${p.foldMode === 'draw' ? 'pen' : 'laser score'}`
          : `    ${OP_COLOR.crease}  CREASE   fold line, score or draw, never cut through`
        : null,
    result.net.loose.some((l) => l.op === 'film')
      ? `    ${OP_COLOR.film}  FILM     the window insert, cut from acetate or PET, not card`
      : null,
    result.net.marks.length ? `    ${OP_COLOR.engrave}  ENGRAVE  your logo, ${logoWords(machine)}` : null,
    machine.svgFold === 'dashed'
      ? null
      : `    ${OP_COLOR.engrave}  ENGRAVE  the 100 mm check rectangle (see below)`,
    '',
    machine.svgFold === 'dashed'
      ? `  There is no check rectangle in these files. It would arrive in Suite as a
  100 x 10 mm hole cut out of your sheet — Suite throws away the layer that is
  meant to keep it off the blade. The .lac is millimetres with no DPI to guess.`
      : `  CHECK THE SCALE BEFORE YOU CUT. The rectangle on the ENGRAVE layer is exactly
  100 mm wide. Measure it in your cutting software. If it reads 133 mm or 75 mm,
  your importer has guessed the wrong DPI: use the DXF instead, which carries
  its units inside the file.`,
    '',
    hemWords(result),
    result.net.panels.some((x) => x.hem) ? '' : null,
      isLacMachine(p.machineId) && machine.svgFold !== 'dashed'
      ? `  A .lac is in the zip as well. If you are on a Bambu H2D, open THAT one: it names
  the operation for every line, so nothing has to be assigned by hand. The SVG and
  the DXF are for everything else.`
      : null,
    isLacMachine(p.machineId) && machine.svgFold !== 'dashed' ? '' : null,
    'IN YOUR SOFTWARE',
    `  ${machine.note}`,
    machine.id.startsWith('h2d')
      ? `  The .lac already holds the blank together as one group, so it arrives arranged
  and there is nothing to ATTACH. If you import the SVG or DXF instead, select
  everything and use ATTACH before assigning processes — unattached objects get
  arranged one at a time and the folds lose their registration.`
      : null,
    machine.mirror
      ? '  This machine folds INTO the score, so the sheet goes on the mat pretty side down.\n  Mirror any artwork you add. The dieline itself is symmetric.' +
        (result.net.marks.length
          ? '\n  The logo on the ENGRAVE layer is drawn on the face that ends up INSIDE the box.\n  To put it outside, run it as a second job with the sheet the other way up.'
          : '')
      : null,
    p.foldMode === 'score' && machine.foldMode === 'score' && machine.id.startsWith('h2d')
      ? '  A laser score on paper is controlled charring: expect a brown line down every\n  fold. On white card that shows. Bambu also say not to leave paper jobs unattended.'
      : null,
    '',
    'ASSEMBLY',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    'ABOUT THE FIT',
    '  Caliper is the number everything here depends on, and the number on the packet',
    '  is not it: 300 gsm card is anywhere from 0.30 to 0.46 mm depending on its bulk.',
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
  // The Bambu-native project, when the chosen machine is one that can open it. It is
  // the only file here that carries the OPERATION and not just the shape, so the fold
  // lines arrive on the pen or the laser-score rather than on the blade.
  const lac = buildLac(result, meta);
  const zip = buildZip(
    {
      [`${baseName}.svg`]: svg,
      [`${baseName}.dxf`]: dxf,
      ...(lac ? { [`${baseName}.lac`]: lac } : {}),
      'README.txt': readme,
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
