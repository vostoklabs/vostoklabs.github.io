// A Bambu Suite project (`.lac`) for the H2D profiles.
//
// SVG and DXF carry the SHAPE of a fold line but not what to do with it, and an importer
// that reads shape alone puts every path on one process, so the fold lines get cut through.
// A `.lac` names the process for every object, one `{obj_id, process_type}` each, so a
// fold arrives as a fold.
//
// What this writes, and what it leaves out on purpose:
//
//   1. FIVE PARTS. No machine `.config`: the machine is named by `machine_settings_name`,
//      so we ship no machine presets and no cut settings we never tested.
//   2. NO MATERIAL. `material_name: ""`: the user picks their stock in Suite, against its
//      own settings for it.
//   3. SCALE IS EXACT. Millimetres, 1:1, so the calibration rectangle the SVG and DXF
//      need is left out here.
//
// Only the profiles Bambu Suite can open get one — the three H2D entries and the two
// generic ones. "Plain SVG" gets none: nothing there claims to read the format.

import { BRAND } from '@vostok/brand';
import { buildZip } from '@vostok/export';
import type { Op, Poly, SolveResult } from '../types';
import { dashSegment } from '../geometry/poly';
import { sheetFor } from '../geometry/solve';
import { OP_COLOR, collectPaths, explodeDashes } from './paths';
import type { CutMeta } from './cutFiles';

/** Which machine preset each of our profiles names, and which module runs it:
 *  `process_category` is per batch, 1 = laser, 2 = blade.
 *
 *  The two GENERIC profiles name a specific H2D too. It decides the PROCESSES the file
 *  offers; the project opens on whichever H2D the user has. Each pairing is a real one —
 *  a laser batch on the 40 W, a blade batch on the 10 W combo. */
const LAC_MACHINE: Record<string, { name: string; category: 1 | 2 }> = {
  'h2d-blade': { name: 'Bambu Lab H2D-10W', category: 2 },
  'h2d-laser10': { name: 'Bambu Lab H2D-10W', category: 1 },
  'h2d-laser': { name: 'Bambu Lab H2D-40W', category: 1 },
  laser: { name: 'Bambu Lab H2D-40W', category: 1 },
  blade: { name: 'Bambu Lab H2D-10W', category: 2 },
};

/** Does this machine get a `.lac` at all? The SVG writers ask, because these are the
 *  machines whose users open one, and whose SVG import does not read layer names. */
export function isLacMachine(id: string): boolean {
  return LAC_MACHINE[id] !== undefined;
}

/** Operation -> process. A fold is a pen mark, a laser line, or a dashed cut, and nothing
 *  else: any process a material does not offer would end up as a plain cut, through every
 *  fold line.
 *
 *  `LaserLineEngrave` is the laser's line pass — the one laser process that marks a face
 *  without going through it. Which of the two a FOLD gets is the user's choice and it is
 *  not second-guessed here: "Laser Line" means a whole line on `LaserLineEngrave`, and
 *  "Laser Cut, dashed" means real dashed geometry on `LaserLineCut`, which is a cut
 *  because that is what a perforation is. A box has been cut on cardstock each way.
 *
 *  `ENGRAVE` is the logo, and it always follows the FOLD side of the table: a laser line,
 *  or a pen mark on the blade. It is the one thing here that must never be a cut. */
function processFor(op: Op, category: 1 | 2): string {
  const fold = category === 1 ? 'LaserLineEngrave' : 'KCPenDraw';
  const cut = category === 1 ? 'LaserLineCut' : 'KCBasicCut';
  // `perf` stays a cut — that IS the perforation. On the blade the dashing is an object
  // PROPERTY rather than the geometry: one line, dashed at make time. On the laser it is
  // still geometry.
  return op === 'crease' || op === 'engrave' ? fold : cut;
}

/** "#RRGGBB" -> "R G B A", the only colour form the format uses. Display only: the
 *  process comes from `object_settings`, never from here. Kept faithful to the SVG so
 *  selecting by colour groups the lines the same way it does on an imported file. */
function rgba(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} 255`;
}

function num(v: number): string {
  // Six places, so a diff against the same project saved again stays readable.
  return (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
}

/** `M`/`L` only, absolute, space separated. A closed ring repeats its first point as
 *  its last and sets `is_closed` — it does NOT get a `Z`.
 *
 *  Y is DOWN here and UP in the net, so the net is flipped into the same sheet-relative
 *  frame `buildSvg` uses — which makes the two files numerically the same box instead of
 *  mirror images about y = 0. It must never go negative: the plate origin is the bed
 *  corner, and anything below it would be moved back onto the plate. */
function pathData(points: Poly, closed: boolean, flipBase: number): string {
  const pts = closed ? [...points, points[0] as [number, number]] : points;
  return pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${num(x)} ${num(flipBase - y)}`)
    .join(' ');
}

/** The whole project, as bytes. `null` when the machine is not a Bambu H2D — there is
 *  nothing to open it with. */
export function buildLac(result: SolveResult, meta: CutMeta): Uint8Array | null {
  const machine = LAC_MACHINE[result.params.machineId];
  if (!machine) return null;

  // No calibration rectangle: it exists to settle SVG's 72-vs-96 dpi argument, and this
  // format has no such argument to settle.
  //
  // `native` is the whole difference between this file and the SVG: a `.lac` NAMES the
  // operation, so a fold arrives WHOLE on the pen or the laser score and needs neither
  // the transport dash nor the hem collapse that dashed geometry forces. See `PathOpts`.
  const native = collectPaths(result, { native: true });
  // Only the BLADE gets the format's own dash — that is the one combination a real sheet
  // has been cut with. On the laser a perforation stays real geometry, which no importer
  // can misread, and the laser's own perforation settings live in a machine `.config` we
  // deliberately do not ship. (A laser never reaches here with a perforated FOLD at all;
  // `effectiveFoldMode` has already made it a score. This is the guard for everything
  // else that can be dashed.)
  const paths = (machine.category === 2 ? native : explodeDashes(native)).filter(
    (p) => p.points.length >= 2,
  );
  const mark = `${meta.title}, ${BRAND.name} (${BRAND.urls.hub})`;
  // Every net y is <= bbox[3] <= flipBase, so a non-negative result is arithmetic rather
  // than hope. The net's own top is the base only when a blank has outgrown its sheet.
  const flipBase = Math.max(sheetFor(result.params).heightMm, result.net.bbox[3]);

  // Objects are numbered 16, 18, 21, 24 … — the group first, then leaves in threes.
  // Nothing depends on the stride; it just keeps a re-saved file comparable.
  const GROUP_ID = 16;
  const idOf = (i: number): number => 18 + i * 3;

  const objects = paths.map((p, i) => {
    // Guarded on `p.dash` as well as the op, because a SLIT can also be `op: 'perf'` and
    // a slit is a real cut that must never be broken up. Only the fold loop in paths.ts
    // ever sets `dash`.
    const d = p.op === 'perf' && p.dash ? p.dash : null;
    const a0 = p.points[0] as [number, number];
    const b0 = p.points[1] as [number, number];
    // A dashed line is dashed from its START, with the end dashes stretched to reach the
    // endpoints (`keep_corner`). Our own geometry does the opposite on purpose —
    // `dashSegment` starts half a gap in — because every crease endpoint sits ON a cut
    // ring, so the whole line would plunge the blade through both roots of every fold.
    // Trimming the line to its first and last dash makes the dashing land exactly where
    // the SVG's does.
    const segs = d ? dashSegment(a0, b0, d.cutMm, d.gapMm) : null;
    const first = segs?.[0];
    const last = segs?.[segs.length - 1];
    const pts: Poly =
      segs && segs.length > 1 && first && last
        ? [first[0] as [number, number], last[1] as [number, number]]
        : p.points;
    return {
      color: rgba(OP_COLOR[p.op]),
      // The format's own dashing, applied at make time to one unbroken line: the same
      // keys a file that has cut card on an H2D carries. `style: 4` is "Custom", which is
      // what makes `cut` and `skip` count.
      ...(d ? { dash: { cut: d.cutMm, keep_corner: true, offset: 0, skip: d.gapMm, style: 4 } } : {}),
      flags: ['FreeAspectRatio'],
      is_closed: p.closed,
      // The op is in the name so the object list reads as the dieline does.
      name: `${p.op.toUpperCase()} ${i + 1}`,
      obj_id: idOf(i),
      path_data: pathData(pts, p.closed, flipBase),
      // A dashed line is a MultiLineObject, the type that carries a `dash`. The two share
      // a key set exactly, so the choice costs nothing else.
      type: d ? 'MultiLineObject' : 'PathObject',
    };
  });

  const children = objects.map((o) => ({ obj_id: o.obj_id, transform: '1 0 0 1 0 0' }));
  // The plate holds ONE thing: the group. Arranging works per plate component, so listing
  // the leaves would make every path an independent part, moved on its own: every crease
  // and cut ring stacked onto the edge of the plate, and the blank no longer a blank.
  const groupRef = [{ obj_id: GROUP_ID, transform: '1 0 0 1 0 0' }];

  const model = {
    Application: 'Bambu Suite',
    FileVersion: '01.04.00.00',
    canvas_list: [
      {
        components: groupRef,
        index: 1,
        name: '',
        obj_list: [
          ...objects,
          {
            components: children,
            flags: ['FreeAspectRatio'],
            // Second provenance carrier — survives a re-save, never on a cut. Invariant #2.
            name: mark,
            obj_id: GROUP_ID,
            // ATTACHED, not merely grouped. The two carry an identical key set and differ
            // only in this string, but a group is a selection convenience: its members can
            // still be re-oriented one by one before making, and the blank comes apart on
            // the way to the machine. Attaching pins them. This is a SECOND registration
            // fix, not the same one as the single plate component above: that stops the
            // objects being scattered on load, this stops them being re-arranged before
            // making.
            type: 'AttachedGroup',
          },
        ],
        type_count: {},
      },
    ],
  };

  const settings = {
    canvas_settings: [
      {
        index: 1,
        making_batch_list: [
          {
            // Let Suite lay the plate out rather than placing it ourselves on a rule we
            // cannot check against every sheet. Safe only because the plate holds ONE
            // component: arranging a group moves the blank, arranging twenty-one leaves
            // takes it apart.
            auto_arranged: true,
            batch_settings: { classVersion: 3, processing_mode: 'PLANE' },
            material_id: '',
            material_name: '',
            material_settings_name: '',
            name: '',
            obj_id: 10,
            process_category: machine.category,
            making_plate_list: [
              {
                components: groupRef,
                name: '',
                obj_id: 14,
                plate_mirror: false,
                plate_settings: { classVersion: 3 },
              },
            ],
          },
        ],
        object_settings: objects.map((o, i) => ({
          obj_id: o.obj_id,
          process_type: processFor((paths[i] as { op: Op }).op, machine.category),
        })),
      },
    ],
    project_settings: {
      classVersion: 3,
      machine_settings_name: machine.name,
      version: null,
    },
  };

  return buildZip(
    {
      // `Application` stays as the format expects it. It is the one field a reader might
      // check, and the provenance mark rides on the group name instead.
      '2D/entry.json': json({ Application: 'Bambu Suite', FileVersion: '01.04.00.00' }),
      '2D/2dmodel.json': json(model),
      'Metadata2D/project_settings.json': json(settings),
      '_rels/.rels': RELS,
      '[Content_Types].xml': CONTENT_TYPES,
    },
    { level: 6 },
  );
}

/** 4-space indent with keys in lexicographic order. Cosmetic — it parses either way —
 *  but it keeps a diff against the same project saved again readable. */
function json(o: unknown): string {
  return JSON.stringify(sortKeys(o), null, 4) + '\n';
}

function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeys((o as Record<string, unknown>)[k]);
  return out;
}

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>\n';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
  ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
  ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
  ' <Default Extension="png" ContentType="image/png"/>\n' +
  ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n' +
  '</Types>\n';
