// Author a 3MF that loads as TWO independent objects — "clicker_top" and
// "clicker_base" — each a set of pre-colored, mating parts, so Bambu Studio /
// OrcaSlicer import them clean with each part on its own filament slot and the
// two halves separately printable.
//
//  - Each part is its own <object> (ids 2..N+1); one <components> wrapper per
//    group references its parts -> "two objects, N parts total".
//  - The two groups are laid out side by side on the plate (top flipped
//    face-down) in MESH coordinates — see the note in buildThreeMF.
//  - <basematerials> gives spec-compliant slicers (PrusaSlicer) a color hint.
//  - Bambu/Orca read Metadata/model_settings.config, where each part maps to a
//    1-based filament slot (`extruder`). Parts sharing a color share a slot.
import { zipSync, strToU8 } from 'fflate';
import { BRAND } from '@vostok/brand';
import {
  projectSettings, colorGroupXml, paletteOf, plateItemTransform, type PlateBounds,
  BBL_NS, BBL_VERSION_META, BBL_APPLICATION,
} from '@vostok/export';
import { plateSize, type PlateChoice } from '@vostok/plates';
import type { ClickerPart, RGB } from '../types';
import { assemblyMinZ, objectKeyOf, objectKeys, place, plateLayout, type Placement } from './plateLayout';

/* Bambu's own cover relationships, verbatim from a 3MF Bambu Studio saved. Bambu Studio
   and Orca read these, not the OPC thumbnail rel. */
const BBL_COVER_MID = `${BBL_NS}/cover-thumbnail-middle`;
const BBL_COVER_SMALL = `${BBL_NS}/cover-thumbnail-small`;

const f = (n: number): string => String(Math.round(n * 1e4) / 1e4);

/** Escape a string for use as XML text/attribute content. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COMMERCIAL_URL = BRAND.urls.mwCommercial;
// Custom metadata namespace (need not resolve; identifies our provenance keys).
const VL_NS = 'https://vostoklabs.com/3mf/2026';

function hex(rgb: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}FF`;
}

/** Stable 1-based filament slot per unique color, in first-seen order. */
function assignExtruders(parts: ClickerPart[]): number[] {
  const slotByColor = new Map<string, number>();
  return parts.map((p) => {
    const key = p.colorRgb.join(',');
    let slot = slotByColor.get(key);
    if (slot === undefined) {
      slot = slotByColor.size + 1;
      slotByColor.set(key, slot);
    }
    return p.extruder ?? slot;
  });
}

function meshXml(p: ClickerPart, minZ: number, pl: Placement): string {
  const np = p.numProp;
  const vp = p.vertProperties;
  const tv = p.triVerts;
  const verts: string[] = [];
  for (let i = 0; i < vp.length; i += np) {
    const [x, y, z] = place(vp[i], vp[i + 1], vp[i + 2] - minZ, pl);
    verts.push(`<vertex x="${f(x)}" y="${f(y)}" z="${f(z)}"/>`);
  }
  const tris: string[] = [];
  for (let i = 0; i < tv.length; i += 3) {
    tris.push(`<triangle v1="${tv[i]}" v2="${tv[i + 1]}" v3="${tv[i + 2]}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

export interface ThreeMFOptions {
  /** The bed to lay the model out on. Defaults to the plate picker's shared preference —
   *  the plate the user is looking at is the plate the file is written for. */
  plate?: PlateChoice;
  /**
   * A PNG of the design, embedded so the file shows what is in it.
   *
   * Without one, every export is a generic icon in the file browser and a blank card in a
   * slicer's project list — which is exactly how a folder of forty customer orders becomes
   * unsearchable. Optional: a file with no cover is still a valid 3MF.
   */
  coverPng?: Uint8Array;
  /** The same picture, small, for a slicer's list rows. Falls back to `coverPng`. */
  coverSmallPng?: Uint8Array;
  /**
   * The file a Model-mode clicker was cut from (its name, as uploaded).
   *
   * Set, the file stops claiming the shape as ours: the model is the uploader's (or whoever they
   * got it from), under whatever licence it came with, and a "© Vostok Labs, CC BY-NC-ND" line
   * over somebody else's figure would be a false statement in the one place people look to find
   * out whose a design is. What we made — the switch pocket, the stem, the fit — is still said.
   */
  sourceModel?: string;
}

/** What a plate object is called in the slicer's object list. */
function labelFor(parts: ClickerPart[], key: string): string {
  const p = parts.find((x) => objectKeyOf(x) === key);
  return p?.objectLabel ?? (p?.group === 'top' ? 'clicker_top' : 'clicker_base');
}

export function buildThreeMF(parts: ClickerPart[], opts: ThreeMFOptions = {}): Uint8Array {
  // Drop the whole assembly onto the build plate (min Z -> 0), keeping relative
  // positions.
  const minZ = assemblyMinZ(parts);

  const extruders = assignExtruders(parts);

  // One movable object per plate object, each a <components> wrapper over its colored
  // sub-parts, so the slicer lets you orient every piece independently. For one clicker that
  // is "clicker_top" and "clicker_base", as it always was; for a batch run it is two per row.
  const groups = objectKeys(parts).map((id) => ({ id, label: labelFor(parts, id) }));

  // Arrange parts for print — packed onto the chosen bed, tops flipped face-down. The
  // placement is BAKED INTO THE VERTICES rather than expressed as an
  // `<item transform>`; see plateLayout() for why.
  const layout = plateLayout(parts, minZ, { plate: opts.plate });
  const placementFor = (key: string): Placement => layout.placementFor(key);

  const baseMaterials = parts
    .map((p) => `<base name="${p.name}" displaycolor="${hex(p.colorRgb)}"/>`)
    .join('');
  const leafObjects = parts
    .map(
      (p, i) =>
        `<object id="${i + 2}" type="model" pid="1" pindex="${i}">` +
        `${meshXml(p, minZ, placementFor(objectKeyOf(p)))}</object>`,
    )
    .join('');

  const firstWrapperId = parts.length + 2;
  const wrapperObjects = groups
    .map((g, gi) => {
      const comps = parts
        .map((p, i) => (objectKeyOf(p) === g.id ? `<component objectid="${i + 2}"/>` : ''))
        .join('');
      return `<object id="${firstWrapperId + gi}" type="model"><components>${comps}</components></object>`;
    })
    .join('');

  // The side-by-side layout is baked into the meshes above; the item transform
  // only slides that whole arrangement to the middle of the bed. Measure the
  // footprint AFTER the placement — the raw meshes are the stacked assembly, and
  // centring on those would put the laid-out halves somewhere else entirely.
  // Without any transform the mesh origin lands on the bed's front-left corner.
  const bounds: PlateBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of parts) {
    const pl = placementFor(objectKeyOf(p));
    for (let i = 0; i < p.vertProperties.length; i += p.numProp) {
      const [x, y] = place(p.vertProperties[i], p.vertProperties[i + 1], 0, pl);
      if (x < bounds.minX) bounds.minX = x;
      if (x > bounds.maxX) bounds.maxX = x;
      if (y < bounds.minY) bounds.minY = y;
      if (y > bounds.maxY) bounds.maxY = y;
    }
  }
  const transform = plateItemTransform(bounds, plateSize(layout.plate));
  const buildItems = groups
    .map((_g, gi) => `<item objectid="${firstWrapperId + gi}" transform="${transform}" printable="1"/>`)
    .join('');

  // The filament slots the parts above ask for. `model_settings.config` only
  // says WHICH slot each part wants — it does not create them, so a user with a
  // single filament loaded had every part clamped to slot 1 and the model arrived
  // monochrome. Declaring the palette makes it travel with the file.
  const palette = paletteOf(parts.map((p) => ({ color: p.colorRgb })), extruders);
  const colorGroup = colorGroupXml(palette, parts.length + 2 + groups.length);

  // Provenance / license identity (Layer A). Well-known 3MF Core metadata names are
  // shown by Bambu Studio / Orca / Prusa; the vl:* names are namespaced per spec.
  const viteEnv: Record<string, string> = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
  const buildId = viteEnv.VITE_BUILD_ID ?? 'dev';
  const creationDate = new Date().toISOString().slice(0, 10);
  const metadata =
    BBL_VERSION_META +
    `<metadata name="Title">Clicker</metadata>` +
    `<metadata name="Designer">Vostok Labs</metadata>` +
    `<metadata name="Application">${BBL_APPLICATION}</metadata>` +
    `<metadata name="vl:application">Vostok Labs Clicker Generator</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    (opts.sourceModel
      ? `<metadata name="Copyright">${esc(`The shape is from ${opts.sourceModel} and belongs to its creator. Clicker mechanism generated by the Vostok Labs Clicker Generator.`)}</metadata>` +
        `<metadata name="LicenseTerms">${esc(`The model keeps its own licence — check it before sharing or selling prints. The generated mechanism: ${COMMERCIAL_URL}`)}</metadata>`
      : `<metadata name="Copyright">${esc('© Vostok Labs. Generated by the Vostok Labs Clicker Generator.')}</metadata>` +
        `<metadata name="LicenseTerms">${esc(`CC BY-NC-ND 4.0. Personal use only. Commercial use requires a license: ${COMMERCIAL_URL}`)}</metadata>`) +
    `<metadata name="vl:generator">clicker-generator</metadata>` +
    `<metadata name="vl:build">${esc(buildId)}</metadata>`;

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"` +
    ` xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"` +
    ` xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"` +
    ` xmlns:bambu="${BBL_NS}"` +
    ` xmlns:BambuStudio="${BBL_NS}"` +
    ` xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"` +
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

  const objectCfg = groups
    .map((g, gi) => {
      const partsCfg = parts
        .map((p, i) =>
          objectKeyOf(p) === g.id
            ? `<part id="${i + 2}" subtype="normal_part">` +
              `<metadata key="name" value="${p.name}"/>` +
              `<metadata key="extruder" value="${extruders[i]}"/>` +
              `</part>`
            : '',
        )
        .join('');
      return (
        `<object id="${firstWrapperId + gi}">` +
        `<metadata key="name" value="${g.label}"/>` +
        `<metadata key="extruder" value="1"/>` +
        partsCfg +
        `</object>`
      );
    })
    .join('');
  const modelSettings =
    `<?xml version="1.0" encoding="UTF-8"?>\n` + `<config>` + objectCfg + `</config>`;

  const cover = opts.coverPng;
  const coverSmall = opts.coverSmallPng ?? cover;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/>` +
    (cover ? `<Default Extension="png" ContentType="image/png"/>` : '') +
    `<Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>` +
    `</Types>`;

  /* Three relationships for one picture, because three readers look for it three ways.

     This used to declare only the first, and aimed it at a `Metadata/thumbnail.png` we
     invented, on the assumption that Bambu Studio and Orca find `plate_1.png` by convention
     rather than by relationship. They do not, and so the cover never appeared in either. The
     shape below is copied from a 3MF Bambu Studio wrote itself: the OPC thumbnail rel (what
     the 3MF spec and Windows' own shell read) aimed at `plate_1.png`, plus Bambu's own two
     cover rels beside it. One picture, one name, every reader pointed at it. */
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>
` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0"` +
    ` Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    (cover
      ? `<Relationship Target="/Metadata/plate_1.png" Id="rel-thumb"` +
        ` Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>` +
        `<Relationship Target="/Metadata/plate_1.png" Id="rel-cover-mid" Type="${BBL_COVER_MID}"/>` +
        `<Relationship Target="/Metadata/plate_1_small.png" Id="rel-cover-small"` +
        ` Type="${BBL_COVER_SMALL}"/>`
      : '') +
    `</Relationships>`;

  // Human-readable provenance + license text (Layer A: survives casual inspection).
  const provenance = (opts.sourceModel
    ? [
      'Vostok Labs - Clicker Generator',
      '',
      `This clicker was cut from an uploaded model: ${opts.sourceModel}.`,
      'The model\'s shape belongs to its creator and keeps its original licence.',
      'Check that licence before sharing or selling prints of it.',
      '',
      'The clicker mechanism (switch pocket, stem, fit) was generated by the',
      `Vostok Labs Clicker Generator. Build: ${buildId}. Created: ${creationDate}.`,
      `Commercial use of the mechanism: ${COMMERCIAL_URL}`,
      '',
      `Provenance / licensing questions: ${BRAND.urls.makerworld}`,
    ]
    : [
      'Vostok Labs - Clicker Generator',
      '',
      'This 3MF was generated by the Vostok Labs Clicker Generator.',
      `Build: ${buildId}`,
      `Created: ${creationDate}`,
      '',
      'License: CC BY-NC-ND 4.0. Personal use only.',
      'Commercial use (selling printed designs) requires a membership license:',
      COMMERCIAL_URL,
      '',
      `Provenance / licensing questions: ${BRAND.urls.makerworld}`,
    ]).join('\n');

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      'Metadata/project_settings.config': strToU8(projectSettings(palette)),
      'Metadata/vostok_labs.txt': strToU8(provenance),
      ...(cover
        ? { 'Metadata/plate_1.png': cover, 'Metadata/plate_1_small.png': coverSmall! }
        : {}),
    },
    { level: 6 },
  );
}

export function downloadThreeMF(parts: ClickerPart[], fileName = 'clicker.3mf', opts: ThreeMFOptions = {}) {
  const bytes = buildThreeMF(parts, opts);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'model/3mf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
