// Shared model exporters, promoted from the magnet generator's export/ (the
// clicker, keycap, keychain and bubble-pop all ship a near-identical copy).
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

export type RGB = [number, number, number];

/** The one part shape everything speaks: the same object the viewer takes. */
export interface ExportPart {
  name: string;
  /** Flat xyz triples, millimetres. */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  color: RGB;
  /** Parts sharing a group become one slicer object. Defaults to one group. */
  group?: string;
  /** Force a filament slot (1-based) instead of deriving it from the colour. */
  extruder?: number;
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
function assignExtruders(parts: ExportPart[]): number[] {
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

function meshXml(p: ExportPart, minZ: number): string {
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
export function plateItemTransform(bounds: PlateBounds): string {
  const [cx, cy] = plateCentre();
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    return `1 0 0 0 1 0 0 0 1 ${f(cx)} ${f(cy)} 0`;
  }
  const tx = cx - (bounds.minX + bounds.maxX) / 2;
  const ty = cy - (bounds.minY + bounds.maxY) / 2;
  return `1 0 0 0 1 0 0 0 1 ${f(tx)} ${f(ty)} 0`;
}

/** The lowest z across every part — the model is dropped onto the bed by it. */
function lowestZ(parts: ExportPart[]): number {
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.positions.length; i += 3) {
      const z = p.positions[i]!;
      if (z < minZ) minZ = z;
    }
  }
  return isFinite(minZ) ? minZ : 0;
}

export function buildThreeMF(parts: ExportPart[], meta: ExportMeta): Uint8Array {
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
  const transform = plateItemTransform(xyBounds(parts.map((p) => p.positions)));
  const buildItems = groups
    .map((_, i) => `<item objectid="${wrapperIdFor(i)}" transform="${transform}" printable="1"/>`)
    .join('');

  // Materials-Extension colour group, one entry per filament slot, taking the
  // next free resource id after the wrappers. Slicers that read the standard 3MF
  // colour path (PrusaSlicer, and Bambu's "standard 3MF" import dialog) look for
  // this; without it they treat the file as single-colour whatever basematerials
  // says. Bambu also ignores lowercase hex here, hence the uppercase.
  const colorGroup = colorGroupXml(palette, parts.length + 2 + groups.length);

  // Provenance / licence identity. Well-known 3MF Core metadata names are shown
  // by Bambu Studio / Orca / Prusa; the vl:* names are namespaced per spec.
  const buildId = meta.buildId ?? 'dev';
  const application = meta.application ?? `${BRAND.name} ${meta.title}`;
  const creationDate = new Date().toISOString().slice(0, 10);
  const metadata =
    BBL_VERSION_META +
    `<metadata name="Title">${esc(meta.title)}</metadata>` +
    `<metadata name="Designer">${esc(BRAND.name)}</metadata>` +
    `<metadata name="Application">${BBL_APPLICATION}</metadata>` +
    `<metadata name="vl:application">${esc(application)}</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    `<metadata name="Copyright">${esc(`© ${BRAND.name}. Generated by the ${application}.`)}</metadata>` +
    `<metadata name="LicenseTerms">${esc(
      `CC BY-NC-ND 4.0. Personal use only. Commercial use requires a license: ${BRAND.urls.mwCommercial}`,
    )}</metadata>` +
    `<metadata name="vl:generator">${esc(meta.generator)}</metadata>` +
    `<metadata name="vl:build">${esc(buildId)}</metadata>`;

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
    `<Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0"` +
    ` Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  // Human-readable provenance + licence text (survives casual inspection).
  const provenance = [
    `${BRAND.name} - ${meta.title}`,
    '',
    `This 3MF was generated by the ${application}.`,
    `Build: ${buildId}`,
    `Created: ${creationDate}`,
    '',
    'License: CC BY-NC-ND 4.0. Personal use only.',
    'Commercial use (selling printed designs) requires a membership license:',
    BRAND.urls.mwCommercial,
    '',
    `Provenance / licensing questions: ${BRAND.urls.makerworld}`,
  ].join('\n');

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      // Declares the filament slots the parts above are asking for, so the colours
      // survive the trip into Bambu Studio / Orca even from a one-filament setup.
      'Metadata/project_settings.config': strToU8(projectSettings(palette, meta.process)),
      'Metadata/vostok_labs.txt': strToU8(provenance),
    },
    { level: 6 },
  );
}

/** Binary STL of the whole assembly (single solid, all parts merged). */
export function buildStl(parts: ExportPart[], header = `${BRAND.name} - CC BY-NC-ND 4.0`): Uint8Array {
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
export function buildObj(parts: ExportPart[]): string {
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

/** Save bytes or text to the user's downloads folder. */
export function downloadFile(data: Uint8Array | string, fileName: string, mime: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadThreeMF(parts: ExportPart[], meta: ExportMeta, fileName: string): void {
  downloadFile(buildThreeMF(parts, meta), fileName, 'model/3mf');
}

export function downloadStl(parts: ExportPart[], fileName: string): void {
  downloadFile(buildStl(parts), fileName, 'model/stl');
}

export function downloadObj(parts: ExportPart[], fileName: string): void {
  downloadFile(buildObj(parts), fileName, 'text/plain');
}
