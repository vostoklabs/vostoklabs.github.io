// The one export function (invariant #8). Everything that leaves this app for a
// laser goes through `buildCutFiles`.
//
// THREE RULES, all learned the hard way rather than derived, and all of them
// about how importers and machines read a file rather than what the file says:
//
// 1. ONE CLOSED RING PER OBJECT. Never `M…Z M…Z` in a single element. Where a
//    machine has no explicit pen-lift, the boundary between objects is the only
//    lift it has — so a second subpath inside one object becomes a travel line
//    drawn (or cut) straight across the part. Holes are separate objects.
//
// 2. HOLES BEFORE THEIR OUTER RING. Anything cutting in document order should
//    drop the waste out of a part before it frees the part itself; otherwise
//    the part is already loose when the inner cut starts.
//
// 3. RINGS CLOSE EXACTLY. First point identical to the last, not within an
//    epsilon — a near-miss leaves an uncut tag holding the part in the sheet.
//
// And one that follows from the same mechanism: parts never share an edge. A
// coincident edge is traversed twice, which on acrylic is a burn line and a
// crack starter, and Bambu's own troubleshooting warns that a dense layout
// re-heats neighbouring cuts. The nester's gap is not only about clearance.
//
// FORMATS. DXF is the dimensional master: it carries its units in the file, and
// it is what MakerWorld accepts as a raw upload. SVG is the readable second
// copy and the only one that can carry operation-as-colour. Bambu Suite reads
// both (PNG/JPG/BMP/SVG/DXF/AI, DXF up to AC1027); we emit R12, which every
// laser front-end since 1990 can open.

import { zipSync, strToU8 } from 'fflate';
import { BRAND } from '@vostok/brand';
import type { Layout, Part, Ring, SlotParams, SolveResult } from '../types';
import { MATERIALS } from '../types';
import { signedArea } from '../geometry/polygon';

/** Cut colour. The convention every laser front-end recognises. */
const CUT_RGB = '#FF0000';
/** Hairline: what Epilog/Trotec drivers treat as "vector, not raster". */
const HAIRLINE_MM = 0.025;

export interface CutFileMeta {
  /** Design name, used in filenames and file metadata. */
  title: string;
  params: SlotParams;
  buildId?: string;
}

/** A part with its sheet placement already applied, rings ordered for cutting. */
interface PlacedPart {
  label: string;
  rings: Ring[];
}

function n(v: number): string {
  // 3 dp is finer than any laser's positioning accuracy (the H2D quotes < 0.3 mm)
  // and keeps the file small. -0 would be legal and looks like a bug; kill it.
  const s = (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
  return s;
}

/** Apply the layout and put every part's rings in cut order: holes first
 *  (smallest to largest), then the outer boundary last. Manifold hands back
 *  outer contours wound positive and holes wound negative, so the sign is an
 *  exact test, not a heuristic. */
function place(parts: Part[], layout: Layout): PlacedPart[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out: PlacedPart[] = [];
  for (const pl of layout.placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    const flip = pl.rot === 180;
    const cx = (part.bbox[0] + part.bbox[2]) / 2;
    const cy = (part.bbox[1] + part.bbox[3]) / 2;
    const moved = part.rings.map((ring) =>
      ring.map(([x, y]) => {
        const rx = flip ? 2 * cx - x : x;
        const ry = flip ? 2 * cy - y : y;
        return [rx + pl.dx, ry + pl.dy] as [number, number];
      }),
    );
    const holes = moved.filter((r) => signedArea(r) < 0);
    const outers = moved.filter((r) => signedArea(r) >= 0);
    holes.sort((a, b) => Math.abs(signedArea(a)) - Math.abs(signedArea(b)));
    out.push({ label: part.label, rings: [...holes, ...outers] });
  }
  return out;
}

/** Strip any duplicate closing point. Both writers close the ring themselves —
 *  DXF with the closed flag, SVG with `Z` — and a repeated vertex would make
 *  the machine stop and restart on the same spot, which scorches. */
function open(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 ? ring.slice(0, -1) : ring;
}

// ───────────────────────────────── DXF ─────────────────────────────────

export function buildDxf(parts: Part[], layout: Layout, meta: CutFileMeta): string {
  const placed = place(parts, layout);
  const g: string[] = [];
  const p = (code: number | string, value: string | number) => {
    g.push(String(code), String(value));
  };

  // HEADER. $INSUNITS is strictly R2000+, but every importer worth having reads
  // it and it is the difference between 150 mm and 150 inches; $MEASUREMENT is
  // the R12-era equivalent, so emit both and let the reader take its pick.
  p(0, 'SECTION');
  p(2, 'HEADER');
  p(9, '$ACADVER');
  p(1, 'AC1009');
  p(9, '$INSUNITS');
  p(70, 4); // 4 = millimetres
  p(9, '$MEASUREMENT');
  p(70, 1); // 1 = metric
  p(9, '$EXTMIN');
  p(10, n(0));
  p(20, n(0));
  p(30, n(0));
  p(9, '$EXTMAX');
  p(10, n(layout.sheet.widthMm));
  p(20, n(layout.sheet.heightMm));
  p(30, n(0));
  p(0, 'ENDSEC');

  // TABLES — layers carry the operation in DXF; there is no colour convention
  // the way there is in SVG.
  p(0, 'SECTION');
  p(2, 'TABLES');
  p(0, 'TABLE');
  p(2, 'LAYER');
  p(70, 2);
  for (const [name, colour] of [
    ['CUT', 1],
    ['ENGRAVE', 5],
  ] as [string, number][]) {
    p(0, 'LAYER');
    p(2, name);
    p(70, 0);
    p(62, colour);
    p(6, 'CONTINUOUS');
  }
  p(0, 'ENDTAB');
  p(0, 'ENDSEC');

  // ENTITIES — one closed POLYLINE per ring. R12 has no LWPOLYLINE.
  p(0, 'SECTION');
  p(2, 'ENTITIES');
  for (const part of placed) {
    for (const ring of part.rings) {
      const pts = open(ring);
      if (pts.length < 3) continue;
      p(0, 'POLYLINE');
      p(8, 'CUT');
      p(66, 1); // vertices follow
      p(70, 1); // closed
      p(10, n(0));
      p(20, n(0));
      p(30, n(0));
      for (const [x, y] of pts) {
        p(0, 'VERTEX');
        p(8, 'CUT');
        p(10, n(x));
        p(20, n(y));
        p(30, n(0));
      }
      p(0, 'SEQEND');
      p(8, 'CUT');
    }
  }
  p(0, 'ENDSEC');
  p(0, 'EOF');

  // DXF wants CRLF; some parsers are strict about it.
  return g.join('\r\n') + '\r\n';
}

// ───────────────────────────────── SVG ─────────────────────────────────

export function buildSvg(parts: Part[], layout: Layout, meta: CutFileMeta): string {
  const placed = place(parts, layout);
  const { widthMm: W, heightMm: H } = layout.sheet;

  const body: string[] = [];
  for (const part of placed) {
    for (const ring of part.rings) {
      const pts = open(ring);
      if (pts.length < 3) continue;
      // Absolute commands only, no transforms anywhere in the document, and the
      // Y flip baked into the numbers — SVG's origin is top-left, the sheet's is
      // bottom-left, and a `transform` is exactly the kind of thing importers
      // silently drop.
      const d =
        `M ${n(pts[0][0])} ${n(H - pts[0][1])} ` +
        pts
          .slice(1)
          .map(([x, y]) => `L ${n(x)} ${n(H - y)}`)
          .join(' ') +
        ' Z';
      body.push(`  <path d="${d}" fill="none" stroke="${CUT_RGB}" stroke-width="${HAIRLINE_MM}"/>`);
    }
  }

  // width/height in mm with a viewBox in the same numbers: one user unit = one
  // millimetre, and no importer has to guess a DPI.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`,
    `     width="${n(W)}mm" height="${n(H)}mm" viewBox="0 0 ${n(W)} ${n(H)}">`,
    `  <title>${esc(meta.title)}</title>`,
    `  <desc>${esc(provenanceLine(meta))}</desc>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch] as string);
}

// ──────────────────────────── the one function ────────────────────────────

function provenanceLine(meta: CutFileMeta): string {
  return `${meta.title} — generated by ${BRAND.name} (${BRAND.urls.hub})`;
}

/** A plain-text sheet that travels with the files: what to cut, what to set the
 *  machine to, and how the thing goes together. MakerWorld requires an assembly
 *  guide on a laser listing, and a cut file with no thickness written on it is
 *  useless six months later. */
function buildReadme(result: SolveResult, meta: CutFileMeta): string {
  const p = meta.params;
  const mat = MATERIALS.find((m) => m.id === p.materialId);
  const lines: (string | null)[] = [
    meta.title,
    '='.repeat(meta.title.length),
    '',
    `Generated by ${BRAND.name} — ${BRAND.urls.hub}`,
    meta.buildId ? `Build: ${meta.buildId}` : null,
    '',
    'CUT THESE',
    `  Material          ${mat?.name ?? p.materialId}`,
    `  Measured thickness${'  '}${p.thicknessMm.toFixed(2)} mm   <- the files were built for THIS number`,
    `  Kerf allowance    ${p.kerfMm.toFixed(2)} mm`,
    `  Fit clearance     ${p.clearanceMm >= 0 ? '+' : ''}${p.clearanceMm.toFixed(2)} mm`,
    `  Sheet             ${result.layout.sheet.name}`,
    `  Total cut path    ${(result.cutLengthMm / 1000).toFixed(2)} m`,
    '',
    'IMPORTANT',
    '  The slot widths are derived from the measured thickness above. If your',
    '  sheet is a different thickness — and it will be, "3 mm" acrylic is legally',
    '  anything from 2.3 to 3.7 mm — re-generate rather than forcing the fit.',
    '  Acrylic does not compress. A joint that needs a hammer will craze weeks later.',
    '',
    'ASSEMBLY',
    '  1. Peel the protective film from both faces.',
    '  2. Take profile A (slot in the TOP edge) and profile B (slot UNDERNEATH).',
    '  3. Lower B onto A so each slot rides in the other. They stop halfway,',
    '     flush, forming a cross. Do not force: if it binds, ease the slot with',
    '     a file rather than pushing.',
    p.base ? '  4. Push the two tabs down through the + slot in the base disc.' : null,
    '',
    'CARE',
    '  Clean with water only. Alcohol and glass cleaner cause stress cracking in',
    '  laser-cut acrylic, and a press-fit joint is exactly where it starts.',
    '',
  ];
  // Drop only the conditional lines (null); '' is a blank line we asked for, and
  // filtering those out collapses every section heading into the text above it.
  return lines.filter((l) => l !== null).join('\n');
}

export interface CutFiles {
  dxf: string;
  svg: string;
  readme: string;
  /** Everything above, zipped — the single download. */
  zip: Uint8Array;
  baseName: string;
}

/** THE export entry point. One call, every format, provenance baked in. */
export function buildCutFiles(result: SolveResult, meta: CutFileMeta): CutFiles {
  const dxf = buildDxf(result.parts, result.layout, meta);
  const svg = buildSvg(result.parts, result.layout, meta);
  const readme = buildReadme(result, meta);
  const baseName = safeName(meta.title);
  const zip = zipSync(
    {
      [`${baseName}.dxf`]: strToU8(dxf),
      [`${baseName}.svg`]: strToU8(svg),
      'README.txt': strToU8(readme),
    },
    { level: 6 },
  );
  return { dxf, svg, readme, zip, baseName };
}

function safeName(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'slot-model';
}

export function downloadCutFiles(result: SolveResult, meta: CutFileMeta): CutFiles {
  const files = buildCutFiles(result, meta);
  triggerDownload(new Blob([files.zip as unknown as BlobPart], { type: 'application/zip' }), `${files.baseName}.zip`);
  return files;
}

export function downloadSingle(text: string, filename: string, mime: string): void {
  triggerDownload(new Blob([text], { type: mime }), filename);
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
