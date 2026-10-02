/**
 * Headless check: does the project_settings.config we write actually match Bambu's
 * system presets?
 *
 * The failure this guards against is silent. A config that is merely close still
 * imports — Studio just quietly stops recognising the presets and names them after
 * the file, which is the "(name-keychain (1).3mf)" in every picker. So the check is
 * value-for-value against the same source Studio compares us to (the installed
 * profile chains), plus a shape check on the per-slot arrays, which are the part
 * that varies with the model and so the part a snapshot cannot cover.
 *
 *   node src/bambuProfile.check.mjs [--studio "C:/Program Files/Bambu Studio"]
 *                                   [--ref path/to/real-bambu-project.3mf ...]
 *
 * With --ref it also checks we emit nothing Studio itself would not write; those
 * keys import as unknown-key substitutions.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

import { projectSettings, buildThreeMF } from './index.ts';
import { BAMBU_BASE, BAMBU_FILAMENT, BAMBU_IDENTITY } from './bambuProfile.generated.ts';

const argv = process.argv.slice(2);
const flag = (n, d) => (argv.indexOf(`--${n}`) === -1 ? d : argv[argv.indexOf(`--${n}`) + 1]);
const flags = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));

const PROFILES = join(flag('studio', 'C:/Program Files/Bambu Studio'), 'resources/profiles/BBL');
const REFS = flags('ref');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

const read = (kind, name) => JSON.parse(readFileSync(join(PROFILES, kind, `${name}.json`), 'utf8'));

/** Same merge Studio does: walk `inherits` to the root, child wins, then inline
 *  the gcode templates the profile lists under `include`. */
function resolveChain(kind, name) {
  const stack = [];
  for (let cur = name; cur; ) {
    const node = read(kind, cur);
    stack.unshift(node);
    cur = node.inherits;
  }
  const merged = {};
  for (const node of stack) Object.assign(merged, node);
  for (const inc of merged.include ?? []) Object.assign(merged, read(kind, inc));
  return merged;
}

const PALETTES = {
  1: [[255, 255, 255]],
  2: [[255, 255, 255], [0, 0, 0]],
  3: [[18, 34, 51], [255, 106, 0], [240, 240, 240]],
  5: [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]],
};
const configs = Object.fromEntries(
  Object.entries(PALETTES).map(([n, p]) => [n, JSON.parse(projectSettings(p))]),
);

// ---------------------------------------------------------------- preset match
if (existsSync(PROFILES)) {
  const SKIP = new Set([
    'type', 'name', 'from', 'instantiation', 'inherits', 'include', 'setting_id',
    'base_id', 'version', 'description', 'renamed_from', 'filament_id', 'family',
    'machine_model_list', 'process_list', 'filament_list', 'default_materials',
    'compatible_printers', 'compatible_printers_condition',
    'compatible_prints', 'compatible_prints_condition',
    // Empty placeholders in the profile files — a preset's id comes from its
    // `name`, and the "presets are named" check below covers the real values.
    'printer_settings_id', 'print_settings_id', 'filament_settings_id',
    // Deprecated keys the profile JSONs still carry but Studio no longer writes
    // into a project; emitting them would import as unknown-key substitutions.
    'extruder_height_gap', 'extruder_clearance_radius', 'adaptive_layer_height',
    'layer_time_smoothing', 'layer_time_smoothing_threshold', 'only_one_wall_top',
    'wall_infill_order', 'filament_long_retractions_when_ec',
    'filament_retraction_distances_when_ec', 'filament_ingredients_safe',
    'filament_emission_safe', 'filament_contact_safe',
  ]);

  const chains = {
    printer: resolveChain('machine', BAMBU_IDENTITY.printerSettingsId),
    process: resolveChain('process', BAMBU_IDENTITY.printSettingsId),
    filament: resolveChain('filament', BAMBU_IDENTITY.filamentSettingsId),
  };
  const filamentKeys = new Set(Object.keys(chains.filament));

  for (const [kind, chain] of Object.entries(chains)) {
    const cfg = configs[3];
    const missing = [];
    const wrong = [];
    for (const [key, want] of Object.entries(chain)) {
      if (SKIP.has(key)) continue;
      // The filament preset owns every key it sets, including the two the process
      // chain also mentions; the process copy is meant to lose.
      if (kind === 'process' && filamentKeys.has(key)) continue;
      if (!(key in cfg)) { missing.push(key); continue; }
      // Per-slot keys are the preset's value repeated, so compare one slot's worth.
      const got = filamentKeys.has(key) ? cfg[key].slice(0, want.length) : cfg[key];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${key}: got ${JSON.stringify(got).slice(0, 60)} want ${JSON.stringify(want).slice(0, 60)}`);
      }
    }
    ok(`${kind} preset: every key present`, missing.length === 0, missing.join(', '));
    ok(`${kind} preset: every value matches`, wrong.length === 0, '\n      ' + wrong.join('\n      '));
  }
} else {
  console.log(`  SKIP preset match — no Bambu Studio profiles at ${PROFILES}`);
}

// ------------------------------------------------------------- per-slot shapes
for (const [n, cfg] of Object.entries(configs)) {
  const slots = Number(n);
  const badLength = Object.entries(BAMBU_FILAMENT)
    .filter(([key, value]) => cfg[key]?.length !== value.length * slots)
    .map(([key]) => `${key}=${cfg[key]?.length}`);
  ok(`${slots} slots: filament arrays sized per slot`, badLength.length === 0, badLength.join(', '));

  ok(`${slots} slots: one colour per slot`, cfg.filament_colour.length === slots);
  ok(`${slots} slots: colours are 8-digit uppercase sRGB`,
    cfg.filament_colour.every((c) => /^#[0-9A-F]{8}$/.test(c)), cfg.filament_colour.join(' '));
  ok(`${slots} slots: every slot carries a filament id`,
    cfg.filament_ids.length === slots && cfg.filament_ids.every((v) => v === BAMBU_IDENTITY.filamentId));
  ok(`${slots} slots: filament_self_index is 1..n`,
    JSON.stringify(cfg.filament_self_index) ===
      JSON.stringify(Array.from({ length: slots }, (_, i) => String(i + 1))));
  // One entry per preset in the project: the process, each filament, the printer.
  ok(`${slots} slots: nothing marked modified`,
    cfg.different_settings_to_system.length === slots + 2 &&
      cfg.different_settings_to_system.every((v) => v === '') &&
      cfg.inherits_group.length === slots + 2 &&
      cfg.inherits_group.every((v) => v === ''),
    JSON.stringify(cfg.different_settings_to_system));
}

const cfg = configs[2];
ok('presets are named', cfg.printer_settings_id === BAMBU_IDENTITY.printerSettingsId &&
  cfg.print_settings_id === BAMBU_IDENTITY.printSettingsId &&
  cfg.filament_settings_id.every((v) => v === BAMBU_IDENTITY.filamentSettingsId));
ok('process is declared compatible with the printer',
  JSON.stringify(cfg.print_compatible_printers) === JSON.stringify([BAMBU_IDENTITY.printerSettingsId]));
ok('project is stamped with the Studio it was snapshotted from',
  cfg.version === BAMBU_IDENTITY.studioVersion && cfg.name === 'project_settings' && cfg.from === 'project');

// ------------------------------------------------------------------ placement
// Studio reads a Bambu project's layout literally — it only auto-arranges files
// it does not recognise as one. So an untransformed item puts the mesh origin on
// the bed's front-left corner, and anything modelled around (0,0) lands half off
// the plate. Check the model comes back inside the bed, wherever it was authored.
{
  const bed = (BAMBU_BASE.printable_area ?? []).map((c) => c.split('x').map(Number));
  const bedMaxX = Math.max(...bed.map((p) => p[0]));
  const bedMaxY = Math.max(...bed.map((p) => p[1]));

  // Authored around the origin, off to one side, and far from it — the three ways
  // a generator's own coordinate space tends to differ from the bed's.
  for (const [label, ox, oy] of [['origin-centred', -20, -12], ['positive', 0, 0], ['far', 300, -400]]) {
    const box = (dx) => {
      const pts = [[0,0,0],[40,0,0],[40,24,0],[0,24,0],[0,0,4],[40,0,4],[40,24,4],[0,24,4]];
      const positions = new Float32Array(pts.flatMap(([x, y, z]) => [x + dx + ox, y + oy, z]));
      return { positions, indices: new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]) };
    };
    const parts = [
      { name: 'a', ...box(0), color: [0, 0, 0], group: 'a' },
      { name: 'b', ...box(45), color: [255, 0, 0], group: 'b' },
    ];
    const files = unzipSync(buildThreeMF(parts, { title: 'placement', generator: 'check' }));
    const model = new TextDecoder().decode(files['3D/3dmodel.model']);

    const items = [...model.matchAll(/<item [^>]*transform="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    ok(`${label}: every item is placed`, items.length === 2 && items.every((t) => t === items[0]),
      JSON.stringify(items));

    const [, , , , , , , , , tx, ty] = items[0].split(' ').map(Number);
    const xs = [], ys = [];
    for (const p of parts) {
      for (let i = 0; i < p.positions.length; i += 3) {
        xs.push(p.positions[i] + tx);
        ys.push(p.positions[i + 1] + ty);
      }
    }
    const onBed = Math.min(...xs) >= 0 && Math.max(...xs) <= bedMaxX &&
      Math.min(...ys) >= 0 && Math.max(...ys) <= bedMaxY;
    ok(`${label}: lands on the bed`, onBed,
      `x ${Math.min(...xs)}..${Math.max(...xs)}  y ${Math.min(...ys)}..${Math.max(...ys)}  bed ${bedMaxX}x${bedMaxY}`);
    ok(`${label}: centred on the bed`,
      Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - bedMaxX / 2) < 0.01 &&
      Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - bedMaxY / 2) < 0.01);
  }
}

// ------------------------------------------------- nothing Studio would not write
if (REFS.length) {
  const known = new Set(
    REFS.flatMap((path) => {
      const files = unzipSync(readFileSync(path));
      const key = Object.keys(files).find((k) => k.endsWith('project_settings.config'));
      return Object.keys(JSON.parse(new TextDecoder().decode(files[key])));
    }),
  );
  const unknown = Object.keys(cfg).filter((k) => !known.has(k));
  ok('no key Studio would not write', unknown.length === 0, unknown.join(', '));
} else {
  console.log('  SKIP unknown-key check — pass --ref <real bambu project>.3mf');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
