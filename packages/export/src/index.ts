// Shared model exporters, promoted from the magnet generator's export/.
//
// The 3MF is authored as a SINGLE object with N pre-coloured, mating parts —
// the shape Bambu Studio / OrcaSlicer import cleanly with each part on its own
// filament slot:
//
//  - each part is its own <object> (ids 2..N+1); a <components> wrapper
//    references them all -> "one object, N parts"
//  - <basematerials> gives spec-compliant slicers (PrusaSlicer) a colour hint
//  - Bambu/Orca read Metadata/model_settings.config, where each part maps to a
//    1-based filament slot (`extruder`); parts sharing a colour share a slot
//  - parts carrying a different `group` become separate objects, so physically
//    separate pieces stay independently movable in the slicer
//  - Metadata/project_settings.config carries Bambu's own A1 / 0.4 nozzle /
//    Bambu PLA Basic presets in full, so Studio resolves them by name instead of
//    inventing project presets named after the file — see projectSettings()
import { zipSync, strToU8 } from 'fflate';
import { BRAND } from '@vostok/brand';
import { BAMBU_BASE, BAMBU_FILAMENT, BAMBU_IDENTITY } from './bambuProfile.generated';

// The reader lives in its own module (also `@vostok/export/read`), so a worker that only reads
// models does not carry the writers and the Bambu profile.
export { readModel, modelFormatOf, type ModelFormat, type ModelMesh } from './read';

export type RGB = [number, number, number];

/** The one part shape everything speaks: the same object the viewer takes. */
export interface ExportPart<Positions extends ArrayLike<number> = Float32Array> {
  name: string;
  /**
   * Flat xyz triples, millimetres. Float32 by default, which is what the viewer takes. The file
   * writers take `ExportPart<ArrayLike<number>>`, so a part placed with Float64 maths reaches the
   * file at full precision instead of rounded to Float32 on the way.
   */
  positions: Positions;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  color: RGB;
  /** Parts sharing a group become one slicer object. Defaults to one group. */
  group?: string;
  /** Force a filament slot (1-based) instead of deriving it from the colour. */
  extruder?: number;
}

/**
 * A manifold mesh (`Manifold.getMesh()`, or the same three fields sent from a worker) as an
 * `ExportPart`. The mesh holds `numProp` floats per vertex, xyz first. At 3 its own arrays are
 * used, with no copy; past 3 the xyz are copied out, because every writer here reads positions
 * three to a vertex.
 */
export function exportPartOf(
  mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array },
  rest: Omit<ExportPart, 'positions' | 'indices'>,
): ExportPart {
  const { numProp, vertProperties: vp } = mesh;
  let positions = vp;
  if (numProp !== 3) {
    positions = new Float32Array((vp.length / numProp) * 3);
    for (let i = 0, j = 0; i < vp.length; i += numProp, j += 3) {
      positions[j] = vp[i]!;
      positions[j + 1] = vp[i + 1]!;
      positions[j + 2] = vp[i + 2]!;
    }
  }
  return { ...rest, positions, indices: mesh.triVerts };
}

export interface ExportMeta {
  /** Model name shown in the slicer, e.g. "Name keychain". */
  title: string;
  /** Generator id for provenance, e.g. "magnet-generator". */
  generator: string;
  /** Human application name, e.g. "Vostok Labs Magnet Generator". */
  application?: string;
  /** Build id; pass `import.meta.env.VITE_BUILD_ID`. */
  buildId?: string;
  /** The uploaded model the parts were made from, when they were: see `ProvenanceMeta`. */
  sourceModel?: string;
  /**
   * The bed the user picked, in mm: `plateSize(loadPlateChoice())` from `@vostok/plates`. The
   * model is centred on it. Left out, it is centred on the profile's own bed, an A1, so an
   * A1 mini owner opened a layout sitting 45 mm off the back of their plate.
   */
  plateSize?: [number, number];
  /**
   * A PNG of the model, for the file's thumbnail.
   *
   * Written as `Metadata/plate_1.png` and pointed at by three relationships: the OPC
   * thumbnail rel that the 3MF spec and Windows' own shell read, plus Bambu's two cover
   * rels, which are what Bambu Studio and Orca actually read. Aiming the OPC rel at a
   * `thumbnail.png` of our own and assuming Bambu would find `plate_1.png` by convention
   * was the earlier shape, and it showed no cover in either slicer.
   * Get it from `viewer.renderToPng()`.
   */
  cover?: Uint8Array;
  /** The same picture, small, for a slicer's list rows. Falls back to `cover`. */
  coverSmall?: Uint8Array;
  /** Process-preset keys this model needs slicing a particular way, written into
   *  the project settings and declared as edits against the system preset.
   *
   *  For a normal solid model there is nothing to say here — the system process is
   *  correct and overriding it would only take choices away. It exists for parts
   *  whose GEOMETRY encodes an assumption about how they will be sliced: the fold-up
   *  box's printed sheet is the case, where the fold hinge is literally the first
   *  layer, so a profile whose first layer is 0.2 mm silently prints a 0.12 mm hinge
   *  two thirds too thick and the box will not fold.
   *
   *  Values are Bambu process keys, exactly as the presets spell them. */
  process?: Record<string, string | string[]>;
}

const VL_NS = 'https://vostoklabs.com/3mf/2026';

/** Bambu's 3MF extension namespace, and the version tag that goes with it.
 *
 *  These two are the switch. Bambu Studio's importer sets an internal
 *  `is_bbl_3mf` flag when it sees the `BambuStudio:3mfVersion` metadata, and
 *  ONLY then does it read `Metadata/project_settings.config`. Without them the
 *  importer takes the generic path — "The 3mf is not from Bambu Lab, load
 *  geometry data and color data only" — and every part collapses onto whatever
 *  single filament the user happens to have loaded.
 *
 *  This is the normal way to write the Bambu project flavour (OrcaSlicer emits
 *  the same namespace); it declares which dialect the file speaks, and the
 *  Designer/Application metadata still name Vostok Labs. */
export const BBL_NS = 'http://schemas.bambulab.com/package/2021';
export const SLIC3R_NS = 'http://schemas.slic3r.org/3mf/2017/06';

export const BBL_VERSION_META =
  '<metadata name="BambuStudio:3mfVersion">1</metadata>' +
  '<metadata name="bambu:3mfVersion">1</metadata>' +
  '<metadata name="slic3rpe:Version3mf">1</metadata>';

// Bambu Studio's bbs_3mf.cpp only sets is_bbl_3mf when Application starts with
// "BambuStudio-"; without it, project_settings.config is skipped and every part
// collapses to a single filament. The version has to be the one whose presets we
// snapshotted — Studio reads it to decide whether the file predates a config
// migration, and running an old migration over a current config would edit the
// values back out of agreement with the system presets.
export const BBL_APPLICATION = `BambuStudio-${BAMBU_IDENTITY.studioVersion}`;

const f = (n: number): string => String(Math.round(n * 1e4) / 1e4);

/** Escape a string for use as XML text/attribute content. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Where the human-readable half of the mark rides inside the zip. */
export const PROVENANCE_FILE = 'Metadata/vostok_labs.txt';

export interface ProvenanceMeta {
  /** Model title, e.g. "Keycap". */
  title: string;
  /** Which generator made it, e.g. "keycap-generator". */
  generator: string;
  /** Build stamp; 'dev' when a bundler has not stamped one in. */
  buildId?: string;
  /** Human name of the app, defaults to "Vostok Labs <title>". */
  application?: string;
  /**
   * The file the model was made from, when the shape is someone else's: an uploaded model a
   * generator cut or fitted something to (its name, as uploaded).
   *
   * Set, the mark stops claiming the shape. The model belongs to whoever made it, under its
   * own licence, and a "© Vostok Labs, CC BY-NC-ND" line over it would be a false statement in
   * the one place people look to find out whose a design is. What the generator added is still
   * credited, with its commercial terms. Left out, the mark is the usual one.
   */
  sourceModel?: string;
}

/**
 * The provenance mark, in the two forms a 3MF carries it: Core metadata that slicers show,
 * and a plain-text file inside the zip that survives casual inspection.
 *
 * One function rather than a block inside `buildThreeMF`, because not every file is a 3MF: the
 * OBJ header (`provenanceComment`) and the laser cut file (`buildCutSvg`) carry the same mark.
 * Every export path in the catalogue can call this, whatever writes the rest of the file around
 * it.
 *
 * It is forensic evidence, not DRM: nothing here gates a feature, none of it is visible on a
 * print, and it is disclosed in the licence and the FAQ. See invariant #2.
 */
export function provenance(meta: ProvenanceMeta): { metadata: string; text: string } {
  const buildId = meta.buildId ?? 'dev';
  const application = meta.application ?? `${BRAND.name} ${meta.title}`;
  const creationDate = new Date().toISOString().slice(0, 10);
  const source = meta.sourceModel;

  // Well-known 3MF Core metadata names are shown by Bambu Studio / Orca / Prusa; the vl:*
  // names are namespaced per spec.
  const metadata =
    BBL_VERSION_META +
    `<metadata name="Title">${esc(meta.title)}</metadata>` +
    `<metadata name="Designer">${esc(BRAND.name)}</metadata>` +
    `<metadata name="Application">${BBL_APPLICATION}</metadata>` +
    `<metadata name="vl:application">${esc(application)}</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    (source
      ? `<metadata name="Copyright">${esc(
          `The shape is from ${source} and belongs to its creator. Everything added to it was generated by the ${application}.`,
        )}</metadata>` +
        `<metadata name="LicenseTerms">${esc(
          `The model keeps its own licence — check it before sharing or selling prints. Commercial use of what was added: ${BRAND.urls.mwCommercial}`,
        )}</metadata>`
      : `<metadata name="Copyright">${esc(`© ${BRAND.name}. Generated by the ${application}.`)}</metadata>` +
        `<metadata name="LicenseTerms">${esc(
          `CC BY-NC-ND 4.0. Personal use only. Commercial use requires a license: ${BRAND.urls.mwCommercial}`,
        )}</metadata>`) +
    `<metadata name="vl:generator">${esc(meta.generator)}</metadata>` +
    `<metadata name="vl:build">${esc(buildId)}</metadata>`;

  const text = (
    source
      ? [
          `${BRAND.name} - ${meta.title}`,
          '',
          `This file was made from an uploaded model: ${source}.`,
          "The model's shape belongs to its creator and keeps its original licence.",
          'Check that licence before sharing or selling prints of it.',
          '',
          `Everything added to it was generated by the ${application}.`,
          `Build: ${buildId}`,
          `Created: ${creationDate}`,
          '',
          'Commercial use of what was added requires a membership license:',
          BRAND.urls.mwCommercial,
          '',
          `Provenance / licensing questions: ${BRAND.urls.makerworld}`,
        ]
      : [
          `${BRAND.name} - ${meta.title}`,
          '',
          `This file was generated by the ${application}.`,
          `Build: ${buildId}`,
          `Created: ${creationDate}`,
          '',
          'License: CC BY-NC-ND 4.0. Personal use only.',
          'Commercial use (selling printed designs) requires a membership license:',
          BRAND.urls.mwCommercial,
          '',
          `Provenance / licensing questions: ${BRAND.urls.makerworld}`,
        ]
  ).join('\n');

  return { metadata, text };
}

/** The same mark for a text format that has no metadata of its own: the OBJ header. */
export function provenanceComment(meta: ProvenanceMeta): string {
  return provenance(meta)
    .text.split('\n')
    .map((line) => (line ? `# ${line}` : '#'))
    .join('\n');
}

/** #rrggbbff — sRGB with the alpha byte 3MF's core `displaycolor` wants. Bambu
 *  silently ignores lowercase hex digits, so anything it reads gets uppercased at
 *  the call site. */
function hex(rgb: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}FF`;
}

/** Materials-Extension colour group, one `<m:color>` per filament slot, at the
 *  given free resource id. Slicers that read the standard 3MF colour path
 *  (PrusaSlicer, and Bambu's "standard 3MF" import dialog) look for this; without
 *  it they treat the file as single-colour whatever `basematerials` says. Bambu
 *  also ignores lowercase hex digits here, hence the uppercase. */
export function colorGroupXml(palette: RGB[], id: number): string {
  return (
    `<m:colorgroup id="${id}">` +
    palette.map((c) => `<m:color color="${hex(c).toUpperCase()}"/>`).join('') +
    `</m:colorgroup>`
  );
}

/** The distinct colours in the model, indexed by (1-based slot − 1). */
export function paletteOf(parts: { color: RGB }[], extruders: number[]): RGB[] {
  const palette: RGB[] = [];
  parts.forEach((p, i) => {
    const slot = extruders[i]!;
    if (!palette[slot - 1]) palette[slot - 1] = p.color;
  });
  // A forced `extruder` can leave a hole (parts on slots 1 and 3 but not 2);
  // the arrays below must stay dense or the slot indices shift.
  for (let i = 0; i < palette.length; i++) if (!palette[i]) palette[i] = [255, 255, 255];
  return palette;
}

/** The project's printer, process and filament presets.
 *
 *  Two problems live in this file, and they need different amounts of it.
 *
 *  The first is "I open the 3MF in Bambu Studio and everything is one colour".
 *  `model_settings.config` only says which SLOT each part wants; it does not
 *  create the slots. Someone with a single filament loaded therefore had every
 *  part clamped onto slot 1. Declaring N filaments here is what makes the palette
 *  travel with the file and land on slots 1..N.
 *
 *  The second is the preset pickers reading "(name-keychain (1).3mf)" instead of
 *  a printer, a process and a filament. Studio keeps a preset's real name only
 *  when the project carries a config that matches a system preset value-for-value
 *  (PresetCollection::load_external_preset -> profile_print_params_same). Naming
 *  the preset is not enough; a near-miss is not enough. So the whole preset has
 *  to be in the file, which is what `bambuProfile.generated.ts` holds — Bambu's
 *  own A1 / 0.4 nozzle / Bambu PLA Basic presets, resolved from an installed
 *  Studio. Anything those presets do not set is deliberately absent: Studio fills
 *  it from the same built-in defaults it compares us against, and from the user's
 *  own project for things like bed type and purge volumes.
 *
 *  Only read when the file also carries the Bambu extension markers — see
 *  `BBL_NS` / `BBL_VERSION_META`. Without them Studio reports "The 3mf is not
 *  from Bambu Lab, load geometry data and color data only" and skips this file
 *  entirely, which is the monochrome import above. */
export function projectSettings(palette: RGB[], process: ExportMeta['process'] = {}): string {
  const n = Math.max(1, palette.length);
  const fill = <T,>(v: T): T[] => Array.from({ length: n }, () => v);

  const cfg: Record<string, unknown> = {
    version: BAMBU_IDENTITY.studioVersion,
    name: 'project_settings',
    from: 'project',
    ...BAMBU_BASE,
  };

  // One slot's worth of filament settings, repeated per slot. A few keys (the AMS
  // drying tables) hold several values per slot, so the whole group repeats
  // rather than just the first entry.
  for (const [key, value] of Object.entries(BAMBU_FILAMENT)) {
    cfg[key] = Array.isArray(value) ? fill(value).flat() : fill(value);
  }

  // Per-slot identity. `filament_colour` is project data, not part of the preset,
  // so setting it costs nothing; a non-empty `filament_id` is what lets the
  // printer honour an AMS slot assignment instead of falling back to the
  // external spool. Studio writes these as 8-digit uppercase sRGB.
  cfg.filament_colour = palette.map((c) => hex(c).toUpperCase());
  cfg.filament_ids = fill(BAMBU_IDENTITY.filamentId);
  cfg.filament_settings_id = fill(BAMBU_IDENTITY.filamentSettingsId);
  cfg.filament_self_index = Array.from({ length: n }, (_, i) => String(i + 1));

  cfg.print_settings_id = BAMBU_IDENTITY.printSettingsId;
  cfg.printer_settings_id = BAMBU_IDENTITY.printerSettingsId;
  cfg.print_compatible_printers = [BAMBU_IDENTITY.printerSettingsId];

  // Anything the model needs sliced its own way, applied over the system process.
  // Written LAST so it wins, and declared below so Studio shows the process as
  // modified rather than as a system preset whose values quietly disagree.
  const edited = Object.keys(process);
  for (const [key, value] of Object.entries(process)) cfg[key] = value;

  // "Nothing here was edited away from the system preset", one entry per preset
  // the project carries: the process, each filament, then the printer. Studio
  // shows a preset as modified when its entry is non-empty — which is exactly what
  // an override above is, so the process entry names the keys it changed.
  const presetCount = n + 2;
  cfg.different_settings_to_system = Array.from({ length: presetCount }, (_, i) =>
    i === 0 ? edited.join(';') : '',
  );
  cfg.inherits_group = Array.from({ length: presetCount }, () => '');

  return JSON.stringify(cfg, null, 2);
}

/** Stable 1-based filament slot per unique colour, in first-seen order. */
function assignExtruders(parts: ExportPart<ArrayLike<number>>[]): number[] {
  const slotByColor = new Map<string, number>();
  return parts.map((p) => {
    const key = p.color.join(',');
    let slot = slotByColor.get(key);
    if (slot === undefined) {
      slot = slotByColor.size + 1;
      slotByColor.set(key, slot);
    }
    return p.extruder ?? slot;
  });
}

function meshXml(p: ExportPart<ArrayLike<number>>, minZ: number): string {
  const v = p.positions;
  const t = p.indices;
  const verts: string[] = [];
  for (let i = 0; i < v.length; i += 3) {
    verts.push(`<vertex x="${f(v[i]!)}" y="${f(v[i + 1]!)}" z="${f(v[i + 2]! - minZ)}"/>`);
  }
  const tris: string[] = [];
  for (let i = 0; i < t.length; i += 3) {
    tris.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

/** Footprint of everything written to the file, in millimetres. */
export interface PlateBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** XY footprint of some flat vertex arrays. `stride` is the floats per vertex —
 *  manifold meshes can carry properties past xyz. */
export function xyBounds(meshes: ArrayLike<number>[], stride = 3): PlateBounds {
  const b: PlateBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const v of meshes) {
    for (let i = 0; i < v.length; i += stride) {
      const x = v[i]!;
      const y = v[i + 1]!;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/** The middle of the bed, read from the profile's `printable_area` (four "XxY"
 *  corners) so it follows whichever printer we snapshot. */
function plateCentre(): [number, number] {
  const corners = BAMBU_BASE.printable_area as string[] | undefined;
  const pts = (corners ?? []).map((c) => c.split('x').map(Number));
  const xs = pts.map((p) => p[0]!).filter((n) => Number.isFinite(n));
  const ys = pts.map((p) => p[1]!).filter((n) => Number.isFinite(n));
  if (!xs.length || !ys.length) return [128, 128];
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The `transform` a `<build><item>` needs to land the model mid-plate.
 *
 *  Without one, the mesh's own origin lands on the bed's origin — its front-left
 *  corner — so anything modelled around (0,0) arrives half off the plate. Studio
 *  reads the layout literally now that the file resolves as a real Bambu project;
 *  it only auto-arranges 3MFs it does not recognise as one.
 *
 *  Every item in an export takes the SAME translation, so a model whose pieces
 *  were arranged relative to each other keeps that arrangement.
 *
 *  3MF wants a row-major 4x3: three basis vectors, then the translation. Z stays
 *  at zero because the meshes are already written with their lowest point on the
 *  bed. */
export function plateItemTransform(bounds: PlateBounds, plateSize?: [number, number]): string {
  // The bed the model is being centred on. Without `plateSize` this is the snapshot profile's
  // own plate, which is an A1 — so every export landed mid-A1 whichever plate the user had
  // picked in the viewer. An A1 mini owner got a layout centred 45 mm past the back of their
  // bed. Callers that know the choice pass it; the default keeps the old behaviour for those
  // that do not.
  const [cx, cy] = plateSize ? [plateSize[0] / 2, plateSize[1] / 2] : plateCentre();
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    return `1 0 0 0 1 0 0 0 1 ${f(cx)} ${f(cy)} 0`;
  }
  const tx = cx - (bounds.minX + bounds.maxX) / 2;
  const ty = cy - (bounds.minY + bounds.maxY) / 2;
  return `1 0 0 0 1 0 0 0 1 ${f(tx)} ${f(ty)} 0`;
}

/** The lowest z across every part — the model is dropped onto the bed by it. */
function lowestZ(parts: ExportPart<ArrayLike<number>>[]): number {
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.positions.length; i += 3) {
      const z = p.positions[i]!;
      if (z < minZ) minZ = z;
    }
  }
  return isFinite(minZ) ? minZ : 0;
}

export function buildThreeMF(parts: ExportPart<ArrayLike<number>>[], meta: ExportMeta): Uint8Array {
  const minZ = lowestZ(parts);
  const extruders = assignExtruders(parts);
  const palette = paletteOf(parts, extruders);

  const baseMaterials = parts.map((p) => `<base name="${esc(p.name)}" displaycolor="${hex(p.color)}"/>`).join('');
  const leafObjects = parts
    .map((p, i) => `<object id="${i + 2}" type="model" pid="1" pindex="${i}">${meshXml(p, minZ)}</object>`)
    .join('');

  // One wrapper object per part GROUP. Most models are a single group, giving
  // the usual "one object, N parts"; a two-piece model (a slider, a lid) keeps
  // its halves separate so the slicer can move or duplicate either alone.
  const groups: { name: string; indices: number[] }[] = [];
  const byGroup = new Map<string, number>();
  parts.forEach((p, i) => {
    const gKey = p.group ?? meta.title;
    let g = byGroup.get(gKey);
    if (g === undefined) {
      g = groups.length;
      byGroup.set(gKey, g);
      groups.push({ name: gKey, indices: [] });
    }
    groups[g]!.indices.push(i);
  });

  const wrapperIdFor = (g: number) => parts.length + 2 + g;
  const wrapperObjects = groups
    .map(
      (g, i) =>
        `<object id="${wrapperIdFor(i)}" type="model"><components>` +
        g.indices.map((pi) => `<component objectid="${pi + 2}"/>`).join('') +
        `</components></object>`,
    )
    .join('');
  const transform = plateItemTransform(xyBounds(parts.map((p) => p.positions)), meta.plateSize);
  const buildItems = groups
    .map((_, i) => `<item objectid="${wrapperIdFor(i)}" transform="${transform}" printable="1"/>`)
    .join('');

  // Materials-Extension colour group, one entry per filament slot, taking the
  // next free resource id after the wrappers. Slicers that read the standard 3MF
  // colour path (PrusaSlicer, and Bambu's "standard 3MF" import dialog) look for
  // this; without it they treat the file as single-colour whatever basematerials
  // says. Bambu also ignores lowercase hex here, hence the uppercase.
  const colorGroup = colorGroupXml(palette, parts.length + 2 + groups.length);

  // Provenance / licence identity (invariant #2), from the one place that writes it.
  const mark = provenance(meta);
  const metadata = mark.metadata;

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"` +
    ` xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"` +
    ` xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"` +
    ` xmlns:bambu="${BBL_NS}"` +
    ` xmlns:BambuStudio="${BBL_NS}"` +
    ` xmlns:slic3rpe="${SLIC3R_NS}"` +
    ` xmlns:vl="${VL_NS}">` +
    metadata +
    `<resources>` +
    `<basematerials id="1">${baseMaterials}</basematerials>` +
    leafObjects +
    wrapperObjects +
    colorGroup +
    `</resources>` +
    `<build>${buildItems}</build>` +
    `</model>`;

  const objectsCfg = groups
    .map(
      (g, i) =>
        `<object id="${wrapperIdFor(i)}">` +
        `<metadata key="name" value="${esc(g.name)}"/>` +
        `<metadata key="extruder" value="1"/>` +
        g.indices
          .map(
            (pi) =>
              `<part id="${pi + 2}" subtype="normal_part">` +
              `<metadata key="name" value="${esc(parts[pi]!.name)}"/>` +
              `<metadata key="extruder" value="${extruders[pi]}"/>` +
              `</part>`,
          )
          .join('') +
        `</object>`,
    )
    .join('');
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>\n<config>${objectsCfg}</config>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/>` +
    (meta.cover ? `<Default Extension="png" ContentType="image/png"/>` : '') +
    `<Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0"` +
    ` Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    (meta.cover
      ? `<Relationship Target="/Metadata/plate_1.png" Id="rel-thumb"` +
        ` Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>` +
        `<Relationship Target="/Metadata/plate_1.png" Id="rel-cover-mid"` +
        ` Type="${BBL_NS}/cover-thumbnail-middle"/>` +
        `<Relationship Target="/Metadata/plate_1_small.png" Id="rel-cover-small"` +
        ` Type="${BBL_NS}/cover-thumbnail-small"/>`
      : '') +
    `</Relationships>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      // Declares the filament slots the parts above are asking for, so the colours
      // survive the trip into Bambu Studio / Orca even from a one-filament setup.
      'Metadata/project_settings.config': strToU8(projectSettings(palette, meta.process)),
      [PROVENANCE_FILE]: strToU8(mark.text),
      ...(meta.cover
        ? {
            'Metadata/plate_1.png': meta.cover,
            'Metadata/plate_1_small.png': meta.coverSmall ?? meta.cover,
          }
        : {}),
    },
    { level: 6 },
  );
}

/** Binary STL of the whole assembly (single solid, all parts merged). */
export function buildStl(parts: ExportPart<ArrayLike<number>>[], header = `${BRAND.name} - CC BY-NC-ND 4.0`): Uint8Array {
  let triCount = 0;
  for (const p of parts) triCount += p.indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const ascii = new TextEncoder().encode(header);
  for (let i = 0; i < 80; i++) view.setUint8(i, ascii[i] ?? 0);
  view.setUint32(80, triCount, true);
  let off = 84;
  for (const p of parts) {
    const v = p.positions;
    const t = p.indices;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i]! * 3;
      const b = t[i + 1]! * 3;
      const c = t[i + 2]! * 3;
      const ax = v[a]!, ay = v[a + 1]!, az = v[a + 2]!;
      const bx = v[b]!, by = v[b + 1]!, bz = v[b + 2]!;
      const cx = v[c]!, cy = v[c + 1]!, cz = v[c + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(off, nx / len, true); off += 4;
      view.setFloat32(off, ny / len, true); off += 4;
      view.setFloat32(off, nz / len, true); off += 4;
      view.setFloat32(off, ax, true); off += 4;
      view.setFloat32(off, ay, true); off += 4;
      view.setFloat32(off, az, true); off += 4;
      view.setFloat32(off, bx, true); off += 4;
      view.setFloat32(off, by, true); off += 4;
      view.setFloat32(off, bz, true); off += 4;
      view.setFloat32(off, cx, true); off += 4;
      view.setFloat32(off, cy, true); off += 4;
      view.setFloat32(off, cz, true); off += 4;
      view.setUint16(off, 0, true); off += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Wavefront OBJ text of the whole assembly. */
export function buildObj(parts: ExportPart<ArrayLike<number>>[]): string {
  const lines: string[] = [];
  let vOff = 0;
  for (const p of parts) {
    lines.push(`o ${p.name.replace(/\s+/g, '_')}`);
    for (let i = 0; i < p.positions.length; i += 3) {
      lines.push(`v ${f(p.positions[i]!)} ${f(p.positions[i + 1]!)} ${f(p.positions[i + 2]!)}`);
    }
    for (let i = 0; i < p.indices.length; i += 3) {
      lines.push(`f ${p.indices[i]! + 1 + vOff} ${p.indices[i + 1]! + 1 + vOff} ${p.indices[i + 2]! + 1 + vOff}`);
    }
    vOff += p.positions.length / 3;
  }
  return lines.join('\n');
}

export interface ObjMtlOptions {
  /** What the OBJ's `mtllib` line names. A standalone .obj opened next to its .mtl needs it
   *  right. */
  mtlFileName?: string;
  /** The provenance mark, written as the OBJ's header comment (invariant #2). */
  provenance?: ProvenanceMeta;
  /**
   * What a material stands for. `'color'` (the default): one per distinct colour, so two parts
   * of one colour print from one filament. `'extruder'`: one per filament slot, numbered the
   * way `buildThreeMF` numbers its slots (`ExportPart.extruder`, or the slot its colour gets),
   * so two parts of the same colour on two slots stay two materials, as they are in the 3MF.
   */
  materialBy?: 'color' | 'extruder';
  /**
   * The materials table to name materials from and add to, shared by every OBJ of one export
   * (a set's plates) so that each names one filament the same way; `buildMtl` writes it once.
   * Every writer on one table names materials one way (`materialBy`, which the table records):
   * a writer asking for the other way throws. Default: a table of its own.
   */
  materials?: ObjMaterials;
}

export interface ObjMtl {
  obj: string;
  mtl: string;
  materialCount: number;
}

/** One material of an OBJ export. */
export interface ObjMaterial {
  /** Its `newmtl` name: `filament1`, `filament2`… */
  name: string;
  /** Its `Kd`: the colour of the first part given it. */
  color: RGB;
}

/**
 * The materials an export's OBJ files use, in the order they were first used, and the slot each
 * colour has been given. One table per export: `objMaterials()` makes one, the writers fill it,
 * `buildMtl` writes it.
 */
export interface ObjMaterials {
  /** Material per key (a colour, or a slot), in the order first used. */
  readonly byKey: Map<string, ObjMaterial>;
  /** Filament slot per colour, in the order first seen: `buildThreeMF`'s numbering. */
  readonly slotByColor: Map<string, number>;
  /** How its materials are named (`ObjMtlOptions.materialBy`): set by the first writer given the
   *  table. By colour and by slot, the first colour and slot 1 would both be `filament1`. */
  materialBy?: 'color' | 'extruder';
}

/** An empty materials table, for the OBJ files of one export to share. */
export function objMaterials(): ObjMaterials {
  return { byKey: new Map(), slotByColor: new Map() };
}

/** The MTL of a materials table: one `Kd` colour per material. */
export function buildMtl(materials: ObjMaterials): string {
  return [...materials.byKey.values()].map((m) => `newmtl ${m.name}\nKd ${kd(m.color)}`).join('\n\n') + '\n';
}

/** An OBJ being written a part at a time. */
export interface ObjWriter {
  /** Write one part: its object, its material, its vertices and faces. */
  add(part: ExportPart<ArrayLike<number>>): void;
  /** True until a part with a vertex in it has been added. */
  readonly isEmpty: boolean;
  /** The OBJ so far. */
  readonly text: string;
  /** The table its materials are named from. */
  readonly materials: ObjMaterials;
}

/** "r g b" as 0..1 floats, the only colour form MTL's `Kd` takes. */
const kd = (rgb: RGB): string => rgb.map((v) => (Math.max(0, Math.min(255, v)) / 255).toFixed(4)).join(' ');

/** OBJ object and material names are whitespace-delimited, so keep them token-safe. */
const objSlug = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';

/**
 * An OBJ written one part at a time: what `buildObjMtl` writes, without holding every part
 * until the end. A set of keycaps carved one after another can add each the moment it is made
 * and let its geometry go.
 *
 * Several writers given one `materials` table (several plates of one export) name each filament
 * the same way; `buildMtl` writes that table as the export's one MTL.
 */
export function objWriter(opts: ObjMtlOptions = {}): ObjWriter {
  const materials = opts.materials ?? objMaterials();
  const materialBy = opts.materialBy ?? 'color';
  if (materials.materialBy && materials.materialBy !== materialBy) {
    const way = (by: 'color' | 'extruder') => (by === 'color' ? 'colour' : 'filament slot');
    throw new Error(`This materials table names its materials by ${way(materials.materialBy)}, so an OBJ cannot add to it by ${way(materialBy)}.`);
  }
  materials.materialBy = materialBy;
  const byExtruder = materialBy === 'extruder';
  /** The material a part's colour, or its slot, stands for: made the first time it is asked. */
  const materialFor = (p: ExportPart<ArrayLike<number>>): string => {
    const colour = p.color.join(',');
    // Every colour is numbered, forced slot or not, exactly as buildThreeMF numbers them.
    let slot = materials.slotByColor.get(colour);
    if (slot === undefined) {
      slot = materials.slotByColor.size + 1;
      materials.slotByColor.set(colour, slot);
    }
    const n = byExtruder ? (p.extruder ?? slot) : slot;
    const key = byExtruder ? `slot ${n}` : `color ${colour}`;
    let m = materials.byKey.get(key);
    if (!m) {
      // A copy: `buildMtl` reads it later, and a caller may refill one array for every part.
      m = { name: `filament${n}`, color: [p.color[0], p.color[1], p.color[2]] };
      materials.byKey.set(key, m);
    }
    return m.name;
  };

  const lines: string[] = [
    ...(opts.provenance ? provenanceComment(opts.provenance).split('\n') : []),
    '# Units: millimetres. One `o` object per part, coloured through the MTL.',
    `mtllib ${opts.mtlFileName ?? 'model.mtl'}`,
  ];
  // Face indices are 1-based and GLOBAL across the file, so every object's indices shift by
  // the number of vertices already written.
  let vOff = 0;
  const used = new Set<string>();

  return {
    add(p) {
      const base = objSlug(p.group ? `${p.group}_${p.name}` : p.name);
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
      used.add(name);

      lines.push(`o ${name}`, `usemtl ${materialFor(p)}`);
      for (let i = 0; i < p.positions.length; i += 3) {
        lines.push(`v ${f(p.positions[i]!)} ${f(p.positions[i + 1]!)} ${f(p.positions[i + 2]!)}`);
      }
      for (let i = 0; i < p.indices.length; i += 3) {
        lines.push(`f ${p.indices[i]! + 1 + vOff} ${p.indices[i + 1]! + 1 + vOff} ${p.indices[i + 2]! + 1 + vOff}`);
      }
      vOff += p.positions.length / 3;
    },
    get isEmpty() {
      return vOff === 0;
    },
    get text() {
      return lines.join('\n') + '\n';
    },
    materials,
  };
}

/**
 * OBJ + MTL: a multi-colour model as one OBJ plus an MTL of `Kd` colours.
 *
 * Writes one `o` object per part with its own `usemtl`, and one `Kd` material per distinct
 * colour, or per filament slot with `materialBy: 'extruder'`.
 *
 * Millimetres in the parts' own coordinates, Z up exactly as `buildThreeMF` writes it.
 *
 * Given a shared `materials` table, the `mtl` and `materialCount` it returns are the whole
 * table's: every material any writer on the table has added so far, not only this OBJ's.
 *
 * The header comment carries the provenance mark. A comment is not metadata; a caller that
 * needs the licence to travel should also put it in the export's description.
 */
export function buildObjMtl(parts: ExportPart<ArrayLike<number>>[], opts: ObjMtlOptions = {}): ObjMtl {
  const writer = objWriter(opts);
  for (const p of parts) writer.add(p);
  return {
    obj: writer.text,
    mtl: buildMtl(writer.materials),
    materialCount: writer.materials.byKey.size,
  };
}

/** UTF-8 bytes of a text file as an exact `ArrayBuffer`. Sliced, so no shared or oversized
 *  backing store goes with it. */
export function textToArrayBuffer(text: string): ArrayBuffer {
  return bytesToArrayBuffer(new TextEncoder().encode(text));
}

/** The exact bytes of a view as their own `ArrayBuffer`. `view.buffer` alone can be larger
 *  than the view (fflate's output is), and a host that reads the whole buffer gets garbage. */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export interface ZipOptions {
  /**
   * Deflate level, 0 to 9. Default 6, fflate's own default and the right trade for SVG, which is
   * text and compresses to a fraction. 0 stores the files as they are: for files that are
   * already compressed (a 3MF is a zip), where deflating again costs time and saves nothing.
   */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Zip a handful of named files — text or bytes — into one archive.
 *
 *  Here rather than in an app because more than one app wants it. */
export function buildZip(files: Record<string, string | Uint8Array>, opts: ZipOptions = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) {
    entries[name] = typeof data === 'string' ? strToU8(data) : data;
  }
  return zipSync(entries, { level: opts.level ?? 6 });
}

/** A flat ring in millimetres, Y up, as manifold's `CrossSection.toPolygons()` returns it. */
export type CutRing = [number, number][];

/** One operation's worth of shapes in a cut file. */
export interface CutLayer {
  /** The group's id, e.g. 'CUT' or 'ENGRAVE'. */
  name: string;
  /** What this group is, in words, as a `<desc>` inside the group — for a layer an id cannot
   *  explain: "Card — kraft 300 gsm, score only". Never drawn, so never on the piece. */
  desc?: string;
  /** The operation colour. Laser software sorts a file into jobs by it: red cuts, black engraves. */
  color: string;
  /**
   * 'line': every ring is its own hairline path, each hole before the ring around it. A cut or a score.
   * 'fill': every island is one filled compound path, so the counter of an "o" stays a hole. An engrave.
   */
  mode: 'line' | 'fill';
  /** One entry per island: its outer ring and its holes, in any order and either winding. */
  shapes: CutRing[][];
  /**
   * OPEN polylines: written as their own hairline paths with no closing `Z`. A score the part's
   * outline cut into arcs, or the seam where one welded letter meets the next — a line that is
   * genuinely not a loop, and closing it would burn straight across the piece.
   * Only meaningful on a 'line' layer.
   */
  paths?: CutRing[];
  /**
   * Raster engraves on this layer: a dithered picture placed on the part. Same frame as the
   * rings (millimetres, Y up), `x`/`y` the bottom-left corner. `href` is a data URL, so the
   * file stays a single self-contained SVG; the pixels ride at whatever resolution the
   * dither was made at, and `width`/`height` in mm are what the laser software sizes it to.
   * Only meaningful on a 'fill' layer.
   */
  images?: CutImage[];
}

/** A picture engraved as pixels rather than paths. */
export interface CutImage {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Hairline: what Epilog and Trotec drivers read as "vector, not raster" (0.001 in). */
const CUT_HAIRLINE_MM = 0.025;
const CUT_MARGIN_MM = 2;

/** Millimetres to 3 dp, which is finer than any laser positions to, and never "-0.000". */
const mm = (v: number): string => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);

function ringArea(ring: CutRing): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/**
 * A laser or cutter SVG: one group per operation, one user unit per millimetre.
 *
 * The rules are the ones real machines taught, written once here so the next cut file does not
 * have to learn them again:
 *
 *  1. ONE CLOSED RING PER PATH on a line layer. A machine with no explicit pen lift only lifts
 *     between objects, so a second subpath in one element becomes a travel line cut straight
 *     across the part.
 *  2. HOLES BEFORE THE RING AROUND THEM. Document order is cut order: cut the outline first and
 *     the piece is loose on the bed before its hole is cut.
 *  3. RINGS CLOSE WITH `Z`, never with a repeated point, which stops the head on one spot.
 *  4. NO TRANSFORMS. The Y flip is baked into the numbers, because a `transform` is exactly what
 *     importers drop, and width/height are mm with a viewBox in the same numbers, so no importer
 *     has to guess a DPI.
 *
 * A fill layer is the one exception to rule 1: an engrave has to be one compound path per
 * island, or the counter of every "o" gets engraved solid.
 *
 * The provenance mark rides in `<desc>`, which is never drawn, so never on the piece (invariant #2).
 */
export function buildCutSvg(layers: CutLayer[], meta: ProvenanceMeta): string {
  // Rule 3, and nothing that cannot enclose an area.
  const tidy = (ring: CutRing): CutRing => {
    const a = ring[0];
    const b = ring[ring.length - 1];
    return ring.length > 1 && a && b && a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
  };
  const live = layers
    .map((l) => ({
      ...l,
      shapes: l.shapes.map((s) => s.map(tidy).filter((r) => r.length >= 3)).filter((s) => s.length > 0),
      // An open path keeps every point it was given: its last point is where the line stops,
      // not a duplicate of its first.
      paths: l.mode === 'line' ? (l.paths ?? []).filter((p) => p.length >= 2) : [],
      images: (l.images ?? []).filter((i) => i.width > 0 && i.height > 0 && i.href),
    }))
    .filter((l) => l.shapes.length > 0 || l.paths.length > 0 || l.images.length > 0);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of live) {
    for (const s of [...l.shapes, l.paths]) {
      for (const r of s) {
        for (const [x, y] of r) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    for (const i of l.images) {
      if (i.x < minX) minX = i.x;
      if (i.x + i.width > maxX) maxX = i.x + i.width;
      if (i.y < minY) minY = i.y;
      if (i.y + i.height > maxY) maxY = i.y + i.height;
    }
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
  const W = maxX - minX + 2 * CUT_MARGIN_MM;
  const H = maxY - minY + 2 * CUT_MARGIN_MM;

  const point = ([x, y]: [number, number]) => `${mm(x - minX + CUT_MARGIN_MM)} ${mm(maxY - y + CUT_MARGIN_MM)}`;
  const openPath = (r: CutRing) => `M ${point(r[0]!)} ${r.slice(1).map((p) => `L ${point(p)}`).join(' ')}`;
  const ringPath = (r: CutRing) => `${openPath(r)} Z`;

  const body: string[] = [];
  for (const l of live) {
    body.push(`  <g id="${esc(l.name)}">`);
    // What the group is, where an id cannot say it — a second material, a different power. Never
    // drawn, so it can never end up on the piece.
    if (l.desc) body.push(`    <desc>${esc(l.desc)}</desc>`);
    // Pictures first, under any paths on the same layer. The Y flip puts the image's TOP edge
    // at its y + height; `image-rendering: pixelated` keeps a 1-bit dither crisp in viewers
    // rather than smeared into grey by bilinear scaling.
    for (const i of l.images) {
      body.push(
        `    <image href="${i.href}" x="${mm(i.x - minX + CUT_MARGIN_MM)}" y="${mm(maxY - (i.y + i.height) + CUT_MARGIN_MM)}"` +
          ` width="${mm(i.width)}" height="${mm(i.height)}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`,
      );
    }
    if (l.mode === 'fill') {
      for (const s of l.shapes) {
        body.push(`    <path d="${s.map(ringPath).join(' ')}" fill="${l.color}" fill-rule="evenodd"/>`);
      }
    } else {
      // Open polylines FIRST, each its own path and none of them closed (rule 1 still holds: one
      // line per element, so the head lifts between them). On a cut layer they are the piece's
      // inner cuts — a jigsaw's seams — and like a hole they must run before the outline frees
      // the piece (rule 2). On a score layer the order changes nothing.
      for (const p of l.paths) {
        body.push(`    <path d="${openPath(p)}" fill="none" stroke="${l.color}" stroke-width="${CUT_HAIRLINE_MM}"/>`);
      }
      // Smallest first, within an island and across islands (rule 2): a hole is smaller than
      // the ring around it, and an island sitting in a hole is smaller than the island it is in.
      const ordered = l.shapes
        .map((s) => s.map((r) => ({ r, area: ringArea(r) })).sort((a, b) => a.area - b.area))
        .sort((a, b) => a[a.length - 1]!.area - b[b.length - 1]!.area);
      for (const s of ordered) {
        for (const { r } of s) {
          body.push(`    <path d="${ringPath(r)}" fill="none" stroke="${l.color}" stroke-width="${CUT_HAIRLINE_MM}"/>`);
        }
      }
    }
    body.push('  </g>');
  }

  // The size in words, so a user can check their software imported it at the right scale.
  const size = `Artwork: ${(maxX - minX).toFixed(1)} x ${(maxY - minY).toFixed(1)} mm`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${mm(W)}mm" height="${mm(H)}mm" viewBox="0 0 ${mm(W)} ${mm(H)}">`,
    `  <title>${esc(meta.title)}</title>`,
    `  <desc>${esc(`${provenance(meta).text}\n\n${size}`)}</desc>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

/** One file of a cut download: a sheet's SVG, or the README that goes with the sheets. */
export interface CutFile {
  name: string;
  text: string;
}

/** A file ready to save or to hand to a host: its name, its contents, its type. */
export interface FileToSave {
  name: string;
  data: string | Uint8Array;
  mime: string;
}

/**
 * What a cut download saves. One sheet is its SVG, as it is. More are one zip, `<stem>.zip`,
 * of every sheet and then the README (`README.txt`) when there is one: a README beside a single
 * SVG would turn one file into a zip for the sake of a note.
 */
export function cutFileBundle(sheets: CutFile[], stem: string, readme?: string): FileToSave {
  if (sheets.length === 1) return { name: sheets[0]!.name, data: sheets[0]!.text, mime: 'image/svg+xml' };
  const files: Record<string, string> = {};
  for (const s of sheets) files[s.name] = s.text;
  if (readme !== undefined) files['README.txt'] = readme;
  return { name: `${stem}.zip`, data: buildZip(files), mime: 'application/zip' };
}

/** Save a cut download (`cutFileBundle`) to the downloads folder. Returns the file name saved. */
export function downloadCut(sheets: CutFile[], stem: string, readme?: string): string {
  const file = cutFileBundle(sheets, stem, readme);
  downloadFile(file.data, file.name, file.mime);
  return file.name;
}

/** Save bytes, text or a ready Blob to the user's downloads folder. */
export function downloadFile(data: Uint8Array | string | Blob, fileName: string, mime: string): void {
  const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadThreeMF(parts: ExportPart<ArrayLike<number>>[], meta: ExportMeta, fileName: string): void {
  downloadFile(buildThreeMF(parts, meta), fileName, 'model/3mf');
}

export function downloadStl(parts: ExportPart<ArrayLike<number>>[], fileName: string): void {
  downloadFile(buildStl(parts), fileName, 'model/stl');
}

export function downloadObj(parts: ExportPart<ArrayLike<number>>[], fileName: string): void {
  downloadFile(buildObj(parts), fileName, 'text/plain');
}
