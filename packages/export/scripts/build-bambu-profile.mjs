// Snapshot Bambu Studio's system presets into src/bambuProfile.generated.ts.
//
// WHY THIS EXISTS
// ---------------
// Our 3MFs used to ship a nine-key project_settings.config naming "Generic PLA"
// and nothing else. Bambu Studio read it, found no printer or process preset it
// recognised, and fell back to EXTERNAL presets — which it names after the file.
// That is the "(name-keychain (1).3mf)" showing up in the Printer, Filament and
// Process pickers, plus the purge-volume warning that comes with an unresolved
// printer.
//
// Studio only keeps a preset's real name when the config in the project matches
// a system preset value-for-value (PresetCollection::load_external_preset ->
// profile_print_params_same). "Value-for-value" means: start from the built-in
// defaults, apply the keys the project carries, and diff against the system
// preset. So the project has to carry the whole preset, not a label.
//
// A system preset is itself just a chain of JSON diffs over those same built-in
// defaults, shipped inside Bambu Studio. This script resolves that chain and
// writes it out, which is exactly the config Studio would have built. Keys the
// chain never touches are LEFT OUT on purpose — Studio fills those from the same
// defaults it compares against, so writing them would only add drift.
//
// USAGE
//   node scripts/build-bambu-profile.mjs \
//     [--studio "C:/Program Files/Bambu Studio"] \
//     [--ref path/to/real-bambu-project.3mf ...]
//
// --ref takes 3MFs saved by Bambu Studio (or MakerWorld's Parametric Model
// Maker). Their project_settings.config key sets become a whitelist: we only
// emit keys Studio itself writes into a project. That drops back-compat keys the
// profile JSONs still carry but the current Studio no longer understands, which
// would otherwise import as "unknown key" substitutions.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flags = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));

const STUDIO = flag('studio', 'C:/Program Files/Bambu Studio');
const OUT = resolve(HERE, '..', flag('out', 'src/bambuProfile.generated.ts'));
const MACHINE = flag('machine', 'Bambu Lab A1 0.4 nozzle');
const PROCESS = flag('process', '0.20mm Standard @BBL A1');
const FILAMENT = flag('filament', 'Bambu PLA Basic @BBL A1');
const REFS = flags('ref');

const PROFILES = join(STUDIO, 'resources/profiles/BBL');

/** The Studio build we are snapshotting, e.g. "02.07.01.62".
 *
 *  This is the app version, not the profile-bundle version in BBL.json — it goes
 *  into the project's `version` and into the 3MF's Application metadata, the two
 *  places Studio reads to decide whether the file predates a config migration. */
function studioVersion() {
  const given = flag('app-version');
  if (given) return given;
  const exe = join(STUDIO, 'bambu-studio.exe');
  if (process.platform === 'win32' && existsSync(exe)) {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Item ${JSON.stringify(exe)}).VersionInfo.FileVersion`],
      { encoding: 'utf8' },
    ).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(out)) return out;
  }
  throw new Error('could not read the Bambu Studio version — pass --app-version');
}

/** Bookkeeping the profile files carry that is not print configuration. */
const NOT_CONFIG = new Set([
  'type', 'name', 'from', 'instantiation', 'inherits', 'include', 'setting_id',
  'base_id', 'version', 'description', 'renamed_from', 'filament_id', 'family',
  'machine_model_list', 'process_list', 'filament_list', 'default_materials',
  // The process's own compatibility list; it lands in the project as
  // `print_compatible_printers`, which we write explicitly further down.
  'compatible_printers', 'compatible_printers_condition',
  'compatible_prints', 'compatible_prints_condition',
  // Empty placeholders in the profile files — a preset's id comes from its
  // `name`. projectSettings() writes the real ones.
  'printer_settings_id', 'print_settings_id', 'filament_settings_id',
]);

function readProfile(kind, name) {
  const path = join(PROFILES, kind, `${name}.json`);
  if (!existsSync(path)) throw new Error(`no such ${kind} profile: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Walk `inherits` to the root, then merge child-last so the leaf wins. */
function resolveChain(kind, name) {
  const stack = [];
  const seen = new Set();
  for (let cur = name; cur; ) {
    if (seen.has(cur)) throw new Error(`inherits cycle at ${kind}/${cur}`);
    seen.add(cur);
    const node = readProfile(kind, cur);
    stack.unshift(node);
    cur = node.inherits;
  }
  const merged = {};
  for (const node of stack) Object.assign(merged, node);
  // The long gcode blocks live in sibling "<profile> template <key>" files that
  // the profile lists under `include`; the value left inline is a stub.
  for (const inc of merged.include ?? []) {
    const tpl = readProfile(kind, inc);
    for (const [k, v] of Object.entries(tpl)) if (!NOT_CONFIG.has(k)) merged[k] = v;
  }
  return { merged, chain: stack.map((n) => n.name), version: stack.at(-1).version };
}

function configOf(kind, name) {
  const { merged, chain } = resolveChain(kind, name);
  const out = {};
  for (const [k, v] of Object.entries(merged)) if (!NOT_CONFIG.has(k)) out[k] = v;
  return { config: out, chain, raw: merged };
}

/** project_settings.config out of every reference 3MF, for the key whitelist. */
function referenceConfigs(paths) {
  return paths.map((p) => {
    const files = unzipSync(readFileSync(p));
    const key = Object.keys(files).find((k) => k.endsWith('project_settings.config'));
    if (!key) throw new Error(`no project_settings.config in ${p}`);
    return { path: p, config: JSON.parse(new TextDecoder().decode(files[key])) };
  });
}

const machine = configOf('machine', MACHINE);
const process_ = configOf('process', PROCESS);
const filament = configOf('filament', FILAMENT);

const refs = referenceConfigs(REFS);
const whitelist = refs.length ? new Set(refs.flatMap((r) => Object.keys(r.config))) : null;

// Keys the filament preset owns. Two of them (`pre_start_fan_time`) are also set
// by the process chain — the filament is the one that owns the option, so it
// wins and the process copy is dropped.
const filamentKeys = new Set(Object.keys(filament.config));

const base = {};
const dropped = [];
for (const src of [machine.config, process_.config]) {
  for (const [k, v] of Object.entries(src)) {
    if (filamentKeys.has(k)) continue;
    if (whitelist && !whitelist.has(k)) { dropped.push(k); continue; }
    base[k] = v;
  }
}
const perFilament = {};
for (const [k, v] of Object.entries(filament.config)) {
  if (whitelist && !whitelist.has(k)) { dropped.push(k); continue; }
  perFilament[k] = v;
}

// Identity. Studio matches presets by these names first, then verifies the
// values above; both halves have to be right.
const identity = {
  printerSettingsId: MACHINE,
  printSettingsId: PROCESS,
  filamentSettingsId: FILAMENT,
  filamentId: filament.raw.filament_id ?? '',
  studioVersion: studioVersion(),
};

if (!identity.filamentId) throw new Error(`filament profile ${FILAMENT} has no filament_id`);

const ts = `// GENERATED by scripts/build-bambu-profile.mjs — do not edit by hand.
//
// Bambu Studio ${identity.studioVersion} system presets, resolved through their
// \`inherits\` chains, for:
//
//   printer   ${machine.chain.join(' <- ')}
//   process   ${process_.chain.join(' <- ')}
//   filament  ${filament.chain.join(' <- ')}
//
// Only keys the presets actually set are here. Everything else Studio fills from
// its built-in defaults — the same defaults it diffs our project against — so
// listing them would add drift, not fidelity. See the script header for why the
// whole preset has to travel with the file.
${
  refs.length
    ? `//\n// Key whitelist taken from real Studio-written projects:\n${refs
        .map((r) => `//   ${r.path.replace(/\\/g, '/').split('/').pop()}`)
        .join('\n')}\n`
    : ''
}
/** Printer + process settings. One value per key, exactly as the presets set them. */
export const BAMBU_BASE: Readonly<Record<string, unknown>> = ${JSON.stringify(base, null, 2)};

/** Filament settings. Each value is one filament's worth and repeats per slot. */
export const BAMBU_FILAMENT: Readonly<Record<string, unknown>> = ${JSON.stringify(perFilament, null, 2)};

/** Preset names Studio matches on, plus the version that produced the snapshot. */
export const BAMBU_IDENTITY = ${JSON.stringify(identity, null, 2)} as const;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ts);

const unique = [...new Set(dropped)];
console.log(`printer   ${machine.chain.join(' <- ')}`);
console.log(`process   ${process_.chain.join(' <- ')}`);
console.log(`filament  ${filament.chain.join(' <- ')}  (${identity.filamentId})`);
console.log(`studio    ${identity.studioVersion}`);
console.log(`\nbase keys ${Object.keys(base).length}, filament keys ${Object.keys(perFilament).length}`);
if (unique.length) console.log(`dropped (not written by Studio): ${unique.join(', ')}`);
console.log(`\nwrote ${OUT}`);
