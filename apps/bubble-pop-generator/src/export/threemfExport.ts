// Author a 3MF that loads as a SINGLE object with N pre-colored, mating parts —
// the format the keycap/clicker generators use, so Bambu Studio / OrcaSlicer
// import it clean with each part on its own filament slot.
//
//  - Each part is its own <object> (ids 2..N+1); a <components> wrapper (id N+2)
//    references them all -> "one object, N parts".
//  - <basematerials> gives spec-compliant slicers (PrusaSlicer) a color hint.
//  - Bambu/Orca read Metadata/model_settings.config, where each part maps to a
//    1-based filament slot (`extruder`). Parts sharing a color share a slot.
//  - The assembly is already built flat-back-down (Z = 0 is the back face), so
//    it prints as-is with no flipping or rearrangement.
import { zipSync, strToU8 } from 'fflate';
import { BRAND } from '@vostok/brand';
import { projectSettings, colorGroupXml, paletteOf, BBL_NS, BBL_VERSION_META, BBL_APPLICATION } from '@vostok/export';
import type { PopPart, RGB } from '../types';

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
const VL_NS = 'https://vostoklabs.com/3mf/2026';

function hex(rgb: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}FF`;
}

/** Stable 1-based filament slot per unique color, in first-seen order. */
function assignExtruders(parts: PopPart[]): number[] {
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

function meshXml(p: PopPart, minZ: number): string {
  const np = p.numProp;
  const vp = p.vertProperties;
  const tv = p.triVerts;
  const verts: string[] = [];
  for (let i = 0; i < vp.length; i += np) {
    verts.push(`<vertex x="${f(vp[i])}" y="${f(vp[i + 1])}" z="${f(vp[i + 2] - minZ)}"/>`);
  }
  const tris: string[] = [];
  for (let i = 0; i < tv.length; i += 3) {
    tris.push(`<triangle v1="${tv[i]}" v2="${tv[i + 1]}" v3="${tv[i + 2]}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

export function buildThreeMF(parts: PopPart[]): Uint8Array {
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.vertProperties.length; i += p.numProp) {
      if (p.vertProperties[i] < minZ) minZ = p.vertProperties[i];
    }
  }
  if (!isFinite(minZ)) minZ = 0;

  const extruders = assignExtruders(parts);

  const baseMaterials = parts
    .map((p) => `<base name="${p.name}" displaycolor="${hex(p.colorRgb)}"/>`)
    .join('');
  const leafObjects = parts
    .map((p, i) => `<object id="${i + 2}" type="model" pid="1" pindex="${i}">${meshXml(p, minZ)}</object>`)
    .join('');

  // One wrapper object per part GROUP: the slab (body + colour inlays) is one,
  // and every button is its own. The buttons print in place and never move, but
  // they still have to be separate objects — fusing them into the slab would
  // leave the slicer unable to give them their own filament, and would stop
  // anyone re-printing a single lost button.
  const groups: { name: string; indices: number[] }[] = [];
  const byGroup = new Map<string, number>();
  parts.forEach((p, i) => {
    let g = byGroup.get(p.group);
    if (g === undefined) {
      g = groups.length;
      byGroup.set(p.group, g);
      groups.push({ name: p.group === 'body' ? 'pop-fidget' : p.group, indices: [] });
    }
    groups[g].indices.push(i);
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

  const buildItems = groups.map((_, i) => `<item objectid="${wrapperIdFor(i)}"/>`).join('');


  // The filament slots the parts above ask for. `model_settings.config` only

  // says WHICH slot each part wants — it does not create them, so a user with a

  // single filament loaded had every part clamped to slot 1 and the model arrived

  // monochrome. Declaring the palette makes it travel with the file.

  const palette = paletteOf(parts.map((p) => ({ color: p.colorRgb })), extruders);

  const colorGroup = colorGroupXml(palette, parts.length + 2 + groups.length);

  // Provenance / license identity. Well-known 3MF Core metadata names are shown
  // by Bambu Studio / Orca / Prusa; the vl:* names are namespaced per spec.
  const viteEnv: Record<string, string> = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
  const buildId = viteEnv.VITE_BUILD_ID ?? 'dev';
  const creationDate = new Date().toISOString().slice(0, 10);
  const metadata =
    BBL_VERSION_META +
    `<metadata name="Title">Bubble Pop Fidget</metadata>` +
    `<metadata name="Designer">Vostok Labs</metadata>` +
    `<metadata name="Application">${BBL_APPLICATION}</metadata>` +
    `<metadata name="vl:application">Vostok Labs Bubble Pop Generator</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    `<metadata name="Copyright">${esc('© Vostok Labs. Generated by the Vostok Labs Bubble Pop Generator.')}</metadata>` +
    `<metadata name="LicenseTerms">${esc(`CC BY-NC-ND 4.0 — personal use only. Commercial use requires a license: ${COMMERCIAL_URL}`)}</metadata>` +
    `<metadata name="vl:generator">bubble-pop-generator</metadata>` +
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
              `<metadata key="name" value="${esc(parts[pi].name)}"/>` +
              `<metadata key="extruder" value="${extruders[pi]}"/>` +
              `</part>`,
          )
          .join('') +
        `</object>`,
    )
    .join('');
  const modelSettings =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<config>` +
    objectsCfg +
    `</config>`;

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

  // Human-readable provenance + license text (survives casual inspection).
  const provenance = [
    'Vostok Labs — Bubble Pop Fidget Generator',
    '',
    'This 3MF was generated by the Vostok Labs Bubble Pop Generator.',
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

export function downloadThreeMF(parts: PopPart[], fileName = 'bubble-pop.3mf') {
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
