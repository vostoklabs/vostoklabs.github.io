// Author a 3MF that loads as TWO independent objects — "clicker_top" and
// "clicker_base" — each a set of pre-colored, mating parts, so Bambu Studio /
// OrcaSlicer import them clean with each part on its own filament slot and the
// two halves separately printable. See DEV_PLAN.md §7.
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
import { projectSettings, colorGroupXml, paletteOf, BBL_NS, BBL_VERSION_META } from '@vostok/export';
import type { ClickerPart, PartGroup, RGB } from '../types';
import { assemblyMinZ, place, plateLayout, type Placement } from './plateLayout';

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

export function buildThreeMF(parts: ClickerPart[]): Uint8Array {
  // Drop the whole assembly onto the build plate (min Z -> 0), keeping relative
  // positions.
  const minZ = assemblyMinZ(parts);

  const extruders = assignExtruders(parts);

  // Two movable objects, each a <components> wrapper over its colored sub-parts,
  // so the slicer lets you orient "clicker top" and "clicker base" independently.
  const groups: { id: PartGroup; label: string }[] = [
    { id: 'top', label: 'clicker_top' },
    { id: 'base', label: 'clicker_base' },
  ].filter((g) => parts.some((p) => p.group === g.id)) as { id: PartGroup; label: string }[];

  // Arrange parts for print — side by side, top flipped face-down. The
  // placement is BAKED INTO THE VERTICES rather than expressed as an
  // `<item transform>`; see plateLayout() for why.
  const placementFor = plateLayout(parts, minZ);

  const baseMaterials = parts
    .map((p) => `<base name="${p.name}" displaycolor="${hex(p.colorRgb)}"/>`)
    .join('');
  const leafObjects = parts
    .map(
      (p, i) =>
        `<object id="${i + 2}" type="model" pid="1" pindex="${i}">` +
        `${meshXml(p, minZ, placementFor(p.group))}</object>`,
    )
    .join('');

  const firstWrapperId = parts.length + 2;
  const wrapperObjects = groups
    .map((g, gi) => {
      const comps = parts
        .map((p, i) => (p.group === g.id ? `<component objectid="${i + 2}"/>` : ''))
        .join('');
      return `<object id="${firstWrapperId + gi}" type="model"><components>${comps}</components></object>`;
    })
    .join('');

  // Placement is baked into the meshes above, so every item is an independent,
  // untransformed object sitting on the plate.
  const buildItems = groups
    .map((_g, gi) => `<item objectid="${firstWrapperId + gi}" printable="1"/>`)
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
    `<metadata name="Application">Vostok Labs Clicker Generator</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    `<metadata name="Copyright">${esc('© Vostok Labs. Generated by the Vostok Labs Clicker Generator.')}</metadata>` +
    `<metadata name="LicenseTerms">${esc(`CC BY-NC-ND 4.0 — personal use only. Commercial use requires a license: ${COMMERCIAL_URL}`)}</metadata>` +
    `<metadata name="vl:generator">clicker-generator</metadata>` +
    `<metadata name="vl:build">${esc(buildId)}</metadata>`;

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"` +
    ` xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"` +
    ` xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"` +
    ` xmlns:BambuStudio="${BBL_NS}"` +
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
          p.group === g.id
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

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0"` +
    ` Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  // Human-readable provenance + license text (Layer A: survives casual inspection).
  const provenance = [
    'Vostok Labs — Clicker Generator',
    '',
    'This 3MF was generated by the Vostok Labs Clicker Generator.',
    `Build: ${buildId}`,
    `Created: ${creationDate}`,
    '',
    'License: CC BY-NC-ND 4.0 — personal use only.',
    'Commercial use (selling printed designs) requires a membership license:',
    COMMERCIAL_URL,
    '',
    'Provenance / licensing questions: https://makerworld.com/en/@Vostok_Labs',
  ].join('\n');

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      'Metadata/project_settings.config': strToU8(projectSettings(palette)),
      'Metadata/vostok_labs.txt': strToU8(provenance),
    },
    { level: 6 },
  );
}

export function downloadThreeMF(parts: ClickerPart[], fileName = 'clicker.3mf') {
  const bytes = buildThreeMF(parts);
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
