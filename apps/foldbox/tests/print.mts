// Is the printable sheet a solid a slicer will accept?
//
// A dieline that is wrong shows up as a box that will not fold. A MESH that is wrong
// shows up as a slicer silently repairing it, or as a part with a face missing that
// prints as a puddle — and neither is visible in a preview. So this checks the two
// things that actually decide it:
//
//   1. every shell is watertight and consistently wound — each directed edge has
//      exactly one opposite twin, which is the definition, not an approximation
//   2. the enclosed volume matches the blank's area times its thickness
//
// Run: pnpm --filter foldbox test:print

import { solve } from '../src/geometry/solve';
import { buildPrintable, buildPrintableFile, sheetThicknessMm, hingeThicknessMm, sandwichThicknessMm } from '../src/export/printable';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';
import { signedArea } from '../src/geometry/poly';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${msg}`);
}

/** Even-odd point in ring, so a triangle can be attributed to the panel it sits on. */
function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed volume of a closed triangle mesh, by the divergence theorem. Positive for
 *  outward-facing triangles, which is also a check on the winding. */
function volume(pos: Float32Array, idx: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!;
    const bx = pos[b]!, by = pos[b + 1]!, bz = pos[b + 2]!;
    const cx = pos[c]!, cy = pos[c + 1]!, cz = pos[c + 2]!;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Every directed edge must have exactly one opposite. Anything else is a hole in
 *  the surface, a duplicated face, or an inconsistently wound triangle. */
function manifoldReport(pos: Float32Array, idx: Uint32Array): string | null {
  // Weld by rounded position, not index: the same corner is emitted once per ring
  // it belongs to, so index identity is not vertex identity.
  const key = new Map<string, number>();
  const weld = new Int32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${pos[i * 3]!.toFixed(3)},${pos[i * 3 + 1]!.toFixed(3)},${pos[i * 3 + 2]!.toFixed(3)}`;
    let w = key.get(k);
    if (w === undefined) {
      w = i;
      key.set(k, w);
    }
    weld[i] = w;
  }

  const edges = new Map<string, number>();
  let degenerate = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const t = [weld[idx[i]!]!, weld[idx[i + 1]!]!, weld[idx[i + 2]!]!];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) {
      degenerate++;
      continue;
    }
    for (let e = 0; e < 3; e++) {
      const a = t[e]!;
      const b = t[(e + 1) % 3]!;
      const fwd = `${a}|${b}`;
      const rev = `${b}|${a}`;
      edges.set(fwd, (edges.get(fwd) ?? 0) + 1);
      void rev;
    }
  }
  let unmatched = 0;
  let doubled = 0;
  for (const [k, n] of edges) {
    const [a, b] = k.split('|');
    if (n > 1) doubled++;
    if ((edges.get(`${b}|${a}`) ?? 0) !== n) unmatched++;
  }
  const bits: string[] = [];
  if (degenerate) bits.push(`${degenerate} degenerate triangles`);
  if (unmatched) bits.push(`${unmatched} unpaired directed edges`);
  if (doubled) bits.push(`${doubled} duplicated directed edges`);
  return bits.length ? bits.join(', ') : null;
}

const STYLES: StyleId[] = ['mailer', 'tray', 'tray-webbed', 'flap-cover', 'tray-lid', 'cake-box', 'divider', 'tuck-top', 'snap-lock', 'gable', 'sleeve'];
/** What the print-only build actually offers — see isPrintStyle in main.ts. */
const PRINT_STYLES: StyleId[] = ['mailer', 'mailer-flaps', 'tray', 'tray-lid', 'cake-box'];
const SIZES: [number, number, number][] = [
  [90, 60, 25],
  [120, 80, 50],
  [60, 60, 60],
  [40, 30, 15],
];

console.log('\nprintable sheet — watertight, wound outward, right volume?');
for (const style of STYLES) {
  for (const [L, W, H] of SIZES) {
    const p: BoxParams = {
      ...DEFAULT_PARAMS,
      style,
      lengthMm: L,
      widthMm: W,
      heightMm: H,
      // Print at the printed thickness, which is the only correct thing to do.
      caliperMm: sheetThicknessMm(DEFAULT_PARAMS),
      handle: true,
    };
    const r = solve(p);
    const { parts, stats } = buildPrintable(r.net, p);
    const tag = `${style} ${L}x${W}x${H}`;

    ok(parts.length > 0, `${tag}: produced geometry`);
    let vol = 0;
    for (const part of parts) {
      const bad = manifoldReport(part.positions, part.indices);
      ok(bad === null, `${tag} [${part.name}]: watertight — ${bad ?? 'ok'}`);
      const v = volume(part.positions, part.indices);
      ok(v > 0, `${tag} [${part.name}]: wound outward (volume ${v.toFixed(1)} mm3)`);
      vol += v;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 2; i < part.positions.length; i += 3) {
        minZ = Math.min(minZ, part.positions[i]!);
        maxZ = Math.max(maxZ, part.positions[i]!);
      }
      ok(minZ >= -1e-6 && maxZ <= stats.sheetMm + 1e-6, `${tag} [${part.name}]: within the sheet`);
    }

    // Volume has to sit between "the whole blank at hinge thickness" and "the whole
    // blank at full thickness". Outside that band means a slab is missing or one has
    // been extruded over the wrong footprint.
    const blankArea = r.net.cutRings.reduce((a, ring) => a + signedArea(ring), 0)
      + r.net.loose.filter((l) => l.op !== 'film').reduce((a, l) => a + Math.abs(signedArea(l.outline)), 0);
    const lo = blankArea * hingeThicknessMm(p) - 1;
    const hi = blankArea * stats.sheetMm + 1;
    ok(vol >= lo && vol <= hi, `${tag}: volume ${vol.toFixed(0)} within ${lo.toFixed(0)}..${hi.toFixed(0)} mm3`);

    if (L === 90) {
      console.log(
        `  ok  ${tag.padEnd(24)} ${stats.parts} parts · ${stats.triangles} tris · ` +
          `${vol.toFixed(0)} mm3 · ${stats.mountains} mountain fold(s) · ${stats.allHinge} all-hinge panel(s)`,
      );
    }
  }
}

// A sheet with no groove has to be the simplest possible thing: one closed shell.
console.log('\nno groove — a single closed shell');
{
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'mailer', hingeLayers: DEFAULT_PARAMS.sheetLayers };
  const { parts, stats } = buildPrintable(solve(p).net, p);
  ok(parts.length === 1, `one part, got ${parts.length}`);
  ok(stats.hingeMm === stats.sheetMm, 'hinge equals sheet');
  const bad = manifoldReport(parts[0]!.positions, parts[0]!.indices);
  ok(bad === null, `watertight — ${bad ?? 'ok'}`);
  console.log(`  ok  plain sheet ${stats.sheetMm} mm · ${stats.triangles} tris`);
}

// Every panel that is NOT deliberately sandwiched inside the finished box has to
// come out at full sheet thickness.
//
// This is the mailer's floor. Four lock slots sit a fraction of a millimetre from
// the fold they lock into; the exporter will not roof over a hole, and it used to
// answer a hole that close by voiding the ENTIRE panel — so the default box printed
// with a 92 x 61 mm base one layer thick, at every sheet thickness and every groove
// width, and said nothing. Counting the voided panels against the ones that were
// meant to be thin is what makes that visible.
console.log('\nevery panel is as thick as its job needs');
/* A wall is the full sheet. A flap that tucks INSIDE one stops short, because the gap
 * it drops into is one sheet wide and PLA does not crush — but "stops short" used to
 * mean "is the hinge", which at two layers is half the gap and at four is a 0.2 mm
 * tongue rattling in a 0.8 mm slot. So this measures the material actually emitted
 * over each panel's footprint rather than counting voided panels. */
for (const style of PRINT_STYLES) {
  const line: string[] = [];
  for (const sheetLayers of [2, 3, 4]) {
    const p: BoxParams = {
      ...DEFAULT_PARAMS,
      style,
      makeMode: 'print',
      sheetLayers,
      caliperMm: sheetThicknessMm({ ...DEFAULT_PARAMS, sheetLayers }),
      // The DERIVED flap is what this section measures. The default is now the full
      // sheet (a thinner flap never grips), so ask for the derivation.
      flapLayers: 0,
    };
    const r = solve(p);
    const sheet = sheetThicknessMm(p);
    const hinge = hingeThicknessMm(p);
    const sandwich = sandwichThicknessMm(p);

    ok(
      sandwich < sheet - 1e-9 || sandwich === hinge,
      `${style} at ${sheetLayers}: a sandwiched panel (${sandwich}) has to be thinner than the sheet (${sheet})`,
    );
    ok(sandwich >= hinge - 1e-9, `${style} at ${sheetLayers}: ${sandwich} is under the hinge ${hinge}`);

    const { parts } = buildPrintable(r.net, p);
    // Highest material over each panel's footprint, by triangle centroid.
    const top = new Map<string, number>();
    for (const part of parts) {
      if (part.name === 'inserts') continue;
      const v = part.positions;
      const idx = part.indices;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
        const cx = (v[a]! + v[b]! + v[c]!) / 3;
        const cy = (v[a + 1]! + v[b + 1]! + v[c + 1]!) / 3;
        const cz = Math.max(v[a + 2]!, v[b + 2]!, v[c + 2]!);
        for (const panel of r.net.panels) {
          if (!inRing(cx, cy, panel.outline)) continue;
          top.set(panel.id, Math.max(top.get(panel.id) ?? 0, cz));
          break;
        }
      }
    }

    let sandwiched = 0;
    let overThick = 0;
    let atCeiling = 0;
    for (const panel of r.net.panels) {
      if (!(panel.role === 'tuck' || panel.web !== undefined || panel.thin === true)) continue;
      const z = top.get(panel.id);
      if (z === undefined) continue;
      sandwiched++;
      if (z > sandwich + 1e-6) overThick++;
      else if (z >= sandwich - 1e-6) atCeiling++;
    }
    ok(overThick === 0, `${style} at ${sheetLayers} layers: ${overThick} sandwiched panel(s) built past ${sandwich} mm`);
    // At three layers and up the ceiling is genuinely above the hinge, so at least
    // one of them has to reach it — otherwise the fix is inert and this test is
    // asserting nothing.
    ok(
      sandwich <= hinge + 1e-9 || sandwiched === 0 || atCeiling > 0,
      `${style} at ${sheetLayers} layers: no sandwiched panel reached ${sandwich} mm — they are all still hinge-thin`,
    );
    line.push(`${sheetLayers}L ${sandwich.toFixed(2)}/${sheet.toFixed(2)}`);
  }
  console.log(`  ok  ${style.padEnd(13)} flap/sheet · ${line.join(' · ')}`);
}

/* The flap thickness, when it is asked for rather than derived.
 *
 * The derived figure is a CLEARANCE fit, and at the default two-layer sheet it lands on a
 * single layer, half the sheet the flap tucks behind. So the number is now
 * settable, and the thing to hold is that asking for it actually MOVES the mesh: the same
 * geometry that clips a sandwiched panel to the derived ceiling has to clip it to the
 * asked-for one, up to the sheet and no further. */
console.log('\nflap thickness follows the setting, not just the sheet');
for (const sheetLayers of [2, 3, 4]) {
  const base: BoxParams = {
    ...DEFAULT_PARAMS,
    style: 'mailer-flaps',
    makeMode: 'print',
    sheetLayers,
    caliperMm: sheetThicknessMm({ ...DEFAULT_PARAMS, sheetLayers }),
  };
  const sheet = sheetThicknessMm(base);
  const hinge = hingeThicknessMm(base);

  // The default is the full sheet: 2 layers, capped at the sheet, so on every sheet here
  // a box that never touched the setting gets flaps the sheet's own thickness (2L) or two
  // layers of it (3L, 4L) — never the derived clearance fit, which is what 0 asks for.
  ok(
    sandwichThicknessMm(base) === Math.min(sheet, DEFAULT_PARAMS.flapLayers * base.layerHeightMm),
    `${sheetLayers}L: the default flap is ${DEFAULT_PARAMS.flapLayers} layers capped at the sheet`,
  );
  ok(
    sandwichThicknessMm({ ...base, flapLayers: 0 }) < sheet - 1e-9 || sandwichThicknessMm({ ...base, flapLayers: 0 }) === hinge,
    `${sheetLayers}L: 0 means derive — a clearance under the sheet, or the hinge when that is all there is`,
  );
  ok(
    sandwichThicknessMm({ ...base, flapLayers: sheetLayers }) === sheet,
    `${sheetLayers}L: asking for the whole sheet gives the whole sheet`,
  );
  ok(
    sandwichThicknessMm({ ...base, flapLayers: 99 }) === sheet,
    `${sheetLayers}L: a flap can never be thicker than the sheet it is cut from`,
  );
  ok(
    sandwichThicknessMm({ ...base, flapLayers: 1 }) >= hinge - 1e-9,
    `${sheetLayers}L: a flap can never be thinner than the crease it folds on`,
  );
  // The web's gap is not the user's to spend: two halves fold into one gap, so an
  // override that fills it would leave the corner unable to close.
  ok(
    sandwichThicknessMm({ ...base, flapLayers: sheetLayers }, 2) === sandwichThicknessMm(base, 2),
    `${sheetLayers}L: a webbed corner keeps its derived pair budget`,
  );

  // And it has to reach the mesh, not just the arithmetic.
  const p: BoxParams = { ...base, flapLayers: sheetLayers };
  const r = solve(p);
  const { parts } = buildPrintable(r.net, p);
  const lug = r.net.panels.find((q) => q.id === 'ml-tucklf')!;
  let top = 0;
  for (const part of parts) {
    if (part.name === 'inserts') continue;
    const v = part.positions;
    const idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
      const cx = (v[a]! + v[b]! + v[c]!) / 3;
      const cy = (v[a + 1]! + v[b + 1]! + v[c + 1]!) / 3;
      if (!inRing(cx, cy, lug.outline)) continue;
      top = Math.max(top, v[a + 2]!, v[b + 2]!, v[c + 2]!);
    }
  }
  ok(
    Math.abs(top - sheet) < 1e-6,
    `${sheetLayers}L: the tuck lug should be built to the full ${sheet.toFixed(2)} mm — got ${top.toFixed(2)}`,
  );
  console.log(`  ok  sheet ${sheet.toFixed(2)} mm · asked for the full sheet · lug built to ${top.toFixed(2)} mm`);
}

// The 3MF has to carry the settings the geometry assumes. The hinge IS the first
// layer, so a stock profile's flat 0.2 mm first layer prints a 0.12 mm hinge two
// thirds too thick — see `sheetProcess`.
console.log('\nthe 3MF tells the slicer what the hinge needs');
{
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'mailer', makeMode: 'print', layerHeightMm: 0.12 };
  const file = buildPrintableFile(
    solve(p).net,
    p,
    { title: 'Fold-up box', baseName: 'foldbox', buildId: 'test' },
    '3mf',
  );
  const zip = unzipSync(file.data);
  const cfg = JSON.parse(strFromU8(zip['Metadata/project_settings.config'] as Uint8Array));
  ok(cfg.layer_height === '0.12', `layer_height is 0.12, got ${cfg.layer_height}`);
  ok(cfg.initial_layer_print_height === '0.12', `first layer is 0.12, got ${cfg.initial_layer_print_height}`);
  ok(cfg.elefant_foot_compensation === '0', `no elephant foot, got ${cfg.elefant_foot_compensation}`);
  ok(cfg.infill_direction === '45', `fill crosses the folds at 45, got ${cfg.infill_direction}`);
  // Declared as edits, or Studio shows an unmodified system preset whose values
  // silently disagree with the project's.
  const diff = String(cfg.different_settings_to_system?.[0] ?? '');
  for (const key of ['layer_height', 'initial_layer_print_height', 'elefant_foot_compensation', 'infill_direction']) {
    ok(diff.split(';').includes(key), `${key} declared as an edit, got "${diff}"`);
  }
  console.log(`  ok  0.12 mm sheet · first layer 0.12 · foot 0 · fill 45 · ${diff.split(';').length} edits declared`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
