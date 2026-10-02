// Convert the keycap STEP files to indexed meshes + metadata the web app loads.
// Run with: npm run convert   (re-run whenever you add/replace a .stp in the folder)
//
// Layout of `Step files of keycaps/`:
//   <Profile name>/<size>.stp   one sub-folder per keycap PROFILE ("Standard profile",
//                               "Low profile", …); each holds the same set of sizes.
//   Homing bump.stp             a single shared bump (profile-independent) at the top level.
// (If there are no sub-folders, every top-level .stp is treated as one implicit profile —
//  the pre-profiles layout still converts.)
//
// Each cap STEP holds the cap SHELL (walls + dished top, hollow underneath) plus one or more
// switch STEMs. Shell and stems are emitted as separate bodies so the app can recolour the
// stem(s) on their own (shine-through mode). The shell goes in the top-level positions/indices
// (back-compat with the dev test scripts); the stem(s) merge into `stem`. A single-solid STEP
// still works — everything becomes the shell, no stem.
//
// Output:
//   public/keycaps/<profileId>/<id>.json   one mesh file per size, per profile
//   public/keycaps/homing-bump.json        the shared bump
//   public/keycaps/index.json              manifest: profiles -> sizes (drives the dropdowns)
//   public/keycap.json                     default profile's default size (dev scripts/back-compat)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import occtimportjs from 'occt-import-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const stepDir = join(root, 'Step files of keycaps');
const outDir = join(root, 'public', 'keycaps');

// --- per-profile ingest tuning --------------------------------------------------------
// Keyed by the id parseProfileName() derives from the folder name. A profile NOT listed here
// takes the original code path verbatim, so every already-committed public/keycaps/**.json
// stays bit-for-bit identical.
//
//   orient           'y-up' — the STEP is authored lying on its side with the cap height
//                    along +Y (measured: the Choc shell spans Y 36.302..39.802 and the stubs
//                    sit at Y 34.502..38.302, i.e. below it, so +Y is the top face). Rotated
//                    +90° about X so +Y becomes +Z, then re-zeroed on the SHELL base.
//   rimBandFraction  top-rim band as a fraction of cap height, instead of the flat 1.2 mm.
//                    1.2 mm is ~10% of an 11.83 mm Cherry cap but 34% of a 3.50 mm Choc one,
//                    where it reaches past the taper and reports the BASE footprint
//                    (17.50×16.50) as the top face (really 15.90×14.90).
//   flatTop          the cap top is a flat plane, so there is no dish to find.
//   print            print guidance, passed through index.json to the UI.
//   homingBump       false — the shared bump is modelled against the Cherry dish.
//   shineThrough     false — see below.
//
// Choc shineThrough is OFF for a load-bearing reason, not a cosmetic one: shine-through
// subtracts a full-height prism through the shell, and the two Choc stubs attach at only
// ±2.85 mm from the cap centre, directly under the legend area. Leaving it on would cut the
// stems clean off the cap for any reasonably sized legend.
const PROFILE_TUNING = {
  'choc-v1': {
    orient: 'y-up',
    rimBandFraction: 0.04, // 0.14 mm on a 3.50 mm cap — the flat plate only, clear of the fillet
    maxDepth: 1.0, // the Choc top plate is exactly 1.50 mm; the stock 1.5 mm slider max would
    //              carve straight through it (a hole, in single-colour recessed mode)
    // Stand the cap on its bottom rib for printing: +90° about the model X axis. Applied to
    // the PREVIEW and the EXPORT only — model space stays Z-up so the legend pipeline, the
    // dish metadata and the size ceiling all keep working unchanged.
    printRotateX: 90,
    flatTop: true,
    homingBump: false,
    shineThrough: false,
    print:
      'Print these standing on their side, as modelled, with supports for the switch stems. ' +
      'Printing face down works too and needs no supports, but the two stems snap off much more easily.',
  },
};

// Convert ONE profile only, leaving the others' committed JSON untouched:
//   node scripts/convert-keycap.mjs --only choc-v1
// Without this, adding a profile rewrites all 34 committed mesh files, because
// meta.generatedAt is a fresh timestamp on every run.
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 ? process.argv[onlyArg + 1] : null;

// --- locate the .stp/.step files, grouped by profile sub-folder ---
const isStep = (f) => /\.(stp|step)$/i.test(f);
let rootEntries;
try {
  rootEntries = readdirSync(stepDir, { withFileTypes: true });
} catch {
  console.error(`Folder not found: ${stepDir}`);
  process.exit(1);
}

const subDirs = rootEntries.filter((e) => e.isDirectory()).map((e) => e.name);
const topFiles = rootEntries.filter((e) => e.isFile() && isStep(e.name)).map((e) => e.name);

// The shared homing bump lives at the top level (one file, profile-independent).
const homingFile = topFiles.find((f) => /homing\s*bump/i.test(f));
const topCaps = topFiles.filter((f) => f !== homingFile);

// Each sub-folder is a profile; if there are none, fall back to the old flat layout where
// every top-level cap is one implicit "Standard" profile.
const profileDirs = subDirs.length
  ? subDirs.map((name) => ({ name, dir: join(stepDir, name) }))
  : topCaps.length
    ? [{ name: 'Standard', dir: stepDir }]
    : [];

if (!profileDirs.length) {
  console.error(`No keycap .stp/.step files found under ${stepDir}`);
  process.exit(1);
}

// "Standard profile" -> { id: 'standard-profile', label: 'Standard profile' }
// (sentence-cased so the dropdown reads naturally next to its "Profile" label).
function parseProfileName(folder) {
  const clean = folder.trim().replace(/\s+/g, ' ');
  const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  const label = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  return { id, label };
}

// Derive a unit, a friendly label, a URL-safe id and a sort key from the file name.
// The unit token ("<n> u") may sit anywhere in the name, and either word order works, so
// both "6,5 u spacebar" and "spacebar 6,5u" parse the same. Examples:
//   "1 u" / "1u"          -> 1u
//   "1,25 u"              -> 1.25u
//   "2u 3 stem"           -> 2u (3 stems)
//   "spacebar 6,25u"      -> 6.25u Spacebar
function parseKeycapName(file) {
  const base = basename(file).replace(/\.(stp|step)$/i, '');
  if (/homing\s*bump/i.test(base)) {
    return { id: 'homing-bump', label: 'Homing Bump', unit: 0, isSpacebar: false, stemCount: 0, isHomingBump: true };
  }
  // Find the "<number> u" token wherever it appears; comma is the decimal separator ("1,25 u").
  // The (?![a-z]) guard keeps the "u" from matching inside a word (e.g. "unit").
  const m = base.match(/(\d+(?:,\d+)?)\s*u(?![a-z])/i);
  const unit = m ? parseFloat(m[1].replace(',', '.')) : 0;
  const unitStr = m ? m[1].replace(',', '.') : '?';

  const isSpacebar = /spacebar/i.test(base);
  const stemMatch = base.match(/(\d+)\s*stems?/i);
  const stemCount = stemMatch ? parseInt(stemMatch[1], 10) : 0;

  let label = `${unitStr}u`;
  if (isSpacebar) label += ' Spacebar';
  else if (stemCount) label += ` (${stemCount} stem${stemCount === 1 ? '' : 's'})`;

  let id = `${unitStr.replace('.', '_')}u`;
  if (isSpacebar) id += '-spacebar';
  else if (stemCount) id += `-${stemCount}stem`;

  return { id, label, unit, isSpacebar, stemCount };
}

const bboxOf = (positions) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
};

const mergeBodies = (bodies) => {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const b of bodies) {
    for (const v of b.positions) positions.push(v);
    for (const i of b.indices) indices.push(i + offset);
    offset += b.positions.length / 3;
  }
  return { positions, indices };
};

const round = (n) => Math.round(n * 1e4) / 1e4;

const occt = await occtimportjs();

// Tessellate one STEP file and return { out, meta } ready to serialise.
// `tune` is the PROFILE_TUNING entry for this profile ({} for the untuned majority).
function convertStep(stepPath, stepFile, tune = {}) {
  const buf = new Uint8Array(readFileSync(stepPath));

  // Fine tessellation so the dished top reads as smooth (chordal error 0.04 mm).
  const result = occt.ReadStepFile(buf, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.04,
    angularDeflection: 0.2,
  });
  if (!result || !result.success || !result.meshes?.length) {
    throw new Error(`STEP import failed for ${stepFile}`);
  }

  const bodies = result.meshes.map((mesh) => ({
    positions: Array.from(mesh.attributes.position.array),
    indices: Array.from(mesh.index.array),
  }));

  // Bring a side-authored profile into the Z-up convention every downstream step assumes,
  // BEFORE anything is classified or measured. +90° about X: (x, y, z) -> (x, -z, y), so the
  // cap height that was along +Y ends up along +Z with the top face still pointing up.
  if (tune.orient === 'y-up') {
    for (const b of bodies) {
      const p = b.positions;
      for (let i = 0; i < p.length; i += 3) {
        const y = p[i + 1], z = p[i + 2];
        p[i + 1] = -z;
        p[i + 2] = y;
      }
    }
  }

  // Classify bodies by XY footprint. The shell dwarfs every stem, so anything under a
  // quarter of the largest footprint is a stem (robust for 1 stem, N stems, spacebars).
  const ranked = bodies.map((b) => {
    const bb = bboxOf(b.positions);
    return { b, fp: (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) };
  });
  const maxFp = Math.max(...ranked.map((r) => r.fp));
  const stemParts = ranked.filter((r) => r.fp < maxFp * 0.25);
  const shellParts = ranked.filter((r) => r.fp >= maxFp * 0.25);

  const hasStem = stemParts.length > 0;
  const shell = mergeBodies(shellParts.map((e) => e.b));
  const stem = hasStem ? mergeBodies(stemParts.map((e) => e.b)) : null;
  console.log(
    `  ${bodies.length} bodies · ${stemParts.length} stem${stemParts.length === 1 ? '' : 's'}` +
      ` (${stemParts.map((e) => e.fp.toFixed(0)).join('+') || '—'} mm²)` +
      ` · shell ${shellParts.map((e) => e.fp.toFixed(0)).join('+')} mm²`
  );

  // Re-zero on the SHELL base. Every existing profile lands with bbox.min[2] ≈ 0, and the app
  // reads meta.topZ as the cap HEIGHT — it aims the orbit target at topZ/2, feeds it to the
  // camera framing, and prints it as the third dimension. A rotated Choc cap otherwise sits at
  // Z 36.302..39.802 and would report a 3.5 mm cap as 39.8 mm tall, floating 36 mm off the grid.
  // Zero on the shell, not the whole model: the stubs hang 1.8 mm below the cap and must stay
  // below Z = 0.
  if (tune.orient) {
    const baseZ = bboxOf(shell.positions).min[2];
    for (let i = 2; i < shell.positions.length; i += 3) shell.positions[i] -= baseZ;
    if (stem) for (let i = 2; i < stem.positions.length; i += 3) stem.positions[i] -= baseZ;
  }

  // --- bounding box + top-surface metadata from the SHELL (units = mm, Z up) ---
  const { min, max } = bboxOf(shell.positions);
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  const topZ = max[2];

  // Top-rim opening: lateral extent of vertices within 1.2 mm of the very top.
  // Lowest point of the dish (near the lateral centre): the seat for preview.
  let rimMinX = Infinity, rimMaxX = -Infinity, rimMinY = Infinity, rimMaxY = -Infinity;
  let dishBottomZ = topZ;
  const halfX = (max[0] - min[0]) / 2;
  const halfY = (max[1] - min[1]) / 2;
  const P = shell.positions;
  // 1.2 mm is the historical band — about 10% of the 11.83 mm Standard cap, so it samples the
  // dish opening. On a 3.50 mm Choc cap it is 34% of the whole cap and reaches past the taper,
  // reporting the base footprint (17.50×16.50) as the top face when the real flat plate is
  // 15.90×14.90. Profiles that opt in scale the band with their own height instead.
  const rimBand = tune.rimBandFraction ? (max[2] - min[2]) * tune.rimBandFraction : 1.2;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (z >= topZ - rimBand) {
      if (x < rimMinX) rimMinX = x; if (x > rimMaxX) rimMaxX = x;
      if (y < rimMinY) rimMinY = y; if (y > rimMaxY) rimMaxY = y;
    }
    // central 40% of the cap, upper half in Z -> find the dish's lowest point.
    // A flat-topped profile has no dish: the top plane tessellates from its boundary, so this
    // scan finds no exterior vertex in the central window at all and instead latches onto the
    // shell's inner ceiling — 1.5 mm inside a Choc cap. Skip it and leave dishBottomZ === topZ.
    if (!tune.flatTop && Math.abs(x - centerX) < halfX * 0.4 && Math.abs(y - centerY) < halfY * 0.4 && z > (min[2] + max[2]) / 2) {
      if (z < dishBottomZ) dishBottomZ = z;
    }
  }

  const totalTris = (shell.indices.length + (stem?.indices.length || 0)) / 3;
  const totalVerts = (shell.positions.length + (stem?.positions.length || 0)) / 3;

  const meta = {
    generatedFrom: stepFile,
    generatedAt: new Date().toISOString(),
    triangles: totalTris,
    vertices: totalVerts,
    bbox: { min, max },          // shell bounds
    center: [centerX, centerY],
    topZ,                 // highest point of the cap (rim of the dish)
    dishBottomZ,          // lowest point of the dished top (seat for the logo preview)
    topExtent: [rimMaxX - rimMinX, rimMaxY - rimMinY], // usable opening of the top dish
    hasStem,
    stemBbox: stem ? bboxOf(stem.positions) : null,
  };

  const out = {
    meta,
    positions: shell.positions.map(round),  // shell (top-level = back-compat with dev scripts)
    indices: shell.indices,
  };
  if (stem) {
    out.stem = { positions: stem.positions.map(round), indices: stem.indices };
  }
  return { out, meta };
}

mkdirSync(outDir, { recursive: true });

// Order sizes within a profile: by unit, then plain < stem-count variants < spacebar.
const sortSizes = (a, b) =>
  a.unit - b.unit ||
  Number(a.isSpacebar) - Number(b.isSpacebar) ||
  a.stemCount - b.stemCount;

// Convert each profile's caps into public/keycaps/<profileId>/<id>.json.
const profiles = [];
for (const { name, dir } of profileDirs) {
  const { id: profileId, label: profileLabel } = parseProfileName(name);
  const capFiles = (dir === stepDir ? topCaps : readdirSync(dir).filter(isStep));
  if (!capFiles.length) {
    console.warn(`(skipping empty profile "${name}")`);
    continue;
  }
  mkdirSync(join(outDir, profileId), { recursive: true });
  console.log(`\nProfile "${name}"  ->  ${profileId} ("${profileLabel}")`);

  const tune = PROFILE_TUNING[profileId] ?? {};
  // With --only, other profiles are read back from disk rather than re-converted, so their
  // committed JSON keeps its original timestamp and floats while index.json stays complete.
  const skip = only && profileId !== only;

  const sizes = [];
  for (const stepFile of capFiles) {
    const info = parseKeycapName(stepFile);
    const outPath = join(outDir, profileId, `${info.id}.json`);
    let out;
    if (skip) {
      out = JSON.parse(readFileSync(outPath, 'utf8'));
      console.log(`  (keeping ${profileId}/${info.id}.json)`);
    } else {
      console.log(`  Reading ${stepFile}  ->  ${info.id} ("${info.label}")`);
      ({ out } = convertStep(join(dir, stepFile), stepFile, tune));
      writeFileSync(outPath, JSON.stringify(out));
    }
    sizes.push({ ...info, file: `keycaps/${profileId}/${info.id}.json`, out });
  }
  sizes.sort(sortSizes);
  const profileDefault = (sizes.find((s) => s.id === '1u') || sizes[0]).id;
  profiles.push({ id: profileId, label: profileLabel, default: profileDefault, sizes, tune });
}

// Convert the shared homing bump once (profile-independent), if present.
if (homingFile && !only) {
  console.log(`\nReading ${homingFile}  ->  homing-bump (shared)`);
  const { out } = convertStep(join(stepDir, homingFile), homingFile);
  writeFileSync(join(outDir, 'homing-bump.json'), JSON.stringify(out));
}

// Standard profile leads the dropdown; everything else follows alphabetically.
const isStd = (p) => /standard/i.test(p.id) || /standard/i.test(p.label);
profiles.sort((a, b) => Number(isStd(b)) - Number(isStd(a)) || a.label.localeCompare(b.label));
const defaultProfile = profiles[0];

const index = {
  defaultProfile: defaultProfile.id,
  // Per-profile UI rules ride along here — spread conditionally so the three existing
  // entries' JSON text is unchanged.
  profiles: profiles.map((p) => ({
    id: p.id,
    label: p.label,
    default: p.default,
    ...(p.tune?.print ? { print: p.tune.print } : {}),
    ...(p.tune?.homingBump === false ? { homingBump: false } : {}),
    ...(p.tune?.shineThrough === false ? { shineThrough: false } : {}),
    ...(p.tune?.maxDepth ? { maxDepth: p.tune.maxDepth } : {}),
    ...(p.tune?.printRotateX ? { printRotateX: p.tune.printRotateX } : {}),
    keycaps: p.sizes.map(({ id, label, file, unit }) => ({ id, label, file, unit })),
  })),
};
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

// Keep public/keycap.json as the default profile's default size (dev scripts + back-compat).
const defaultSize = defaultProfile.sizes.find((s) => s.id === defaultProfile.default) || defaultProfile.sizes[0];
writeFileSync(join(root, 'public', 'keycap.json'), JSON.stringify(defaultSize.out));

const totalCaps = profiles.reduce((n, p) => n + p.sizes.length, 0);
console.log(`\nWrote ${totalCaps} keycaps across ${profiles.length} profile(s) to public/keycaps/ + index.json`);
console.log(`Default: ${defaultProfile.id}/${defaultProfile.default} (also public/keycap.json)`);
