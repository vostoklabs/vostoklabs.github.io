import { zipSync, strToU8 } from 'fflate';
import { projectSettings, colorGroupXml, BBL_NS, BBL_VERSION_META, BBL_APPLICATION } from '@vostok/export';
import { weldPositions } from './meshUtils.js';

// Round to keep the XML compact without losing print precision (1e-4 mm).
const f = (n) => Math.round(n * 1e4) / 1e4;

function meshXml(geom) {
  // Manifold output is already a clean, indexed, watertight solid — use it as-is.
  // Only weld when handed a non-indexed mesh (don't re-weld and risk false merges).
  const g = geom.index ? geom : weldPositions(geom);
  const pos = g.getAttribute('position').array;
  const idx = g.getIndex().array;

  const verts = [];
  for (let i = 0; i < pos.length; i += 3) {
    verts.push(`<vertex x="${f(pos[i])}" y="${f(pos[i + 1])}" z="${f(pos[i + 2])}"/>`);
  }
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    tris.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

// "#rrggbb" -> "#RRGGBBFF" (3MF wants 8-digit sRGB with alpha).
const color3mf = (hex) => '#' + hex.replace('#', '').toUpperCase() + 'FF';

/**
 * Build a multi-material 3MF that loads as a SINGLE model with N parts.
 *
 * @param {Array<{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}>} parts
 *        One entry per body. Order is preserved. `extruder` is the 1-based filament slot
 *        (1 = keycap colour, 2 = legend colour); the stem rides on slot 2 in shine-through.
 *
 *  - Each part is its own <object> (ids 2..N+1); a <components> wrapper (id N+2) references
 *    them all so Bambu Studio / OrcaSlicer import it as "one object with N parts".
 *  - A <basematerials> resource (per-object pid/pindex) gives spec-compliant slicers
 *    (PrusaSlicer + the 3MF base extension) a colour hint.
 *  - Bambu/Orca ignore basematerials for filament assignment and read
 *    Metadata/model_settings.config instead, where each part maps to its extruder slot.
 */
/** "#rrggbb" -> [r, g, b]. */
const rgbOf = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

export function buildThreeMF(parts) {
  const wrapperId = parts.length + 2; // parts use ids 2..N+1, wrapper is N+2

  // The filament slots the parts ask for, densely indexed by (slot - 1).
  // model_settings.config below only says WHICH slot a part wants; it does not
  // create the slot. Someone with a single filament loaded therefore had both
  // bodies clamped onto slot 1 and the keycap imported in one colour. Declaring
  // the palette in project_settings.config is what carries the colours across.
  const palette = [];
  for (const p of parts) {
    const i = Math.max(1, p.extruder) - 1;
    if (!palette[i]) palette[i] = rgbOf(p.color);
  }
  for (let i = 0; i < palette.length; i++) if (!palette[i]) palette[i] = [255, 255, 255];

  const baseMaterials = parts
    .map((p) => `<base name="${p.name}" displaycolor="${color3mf(p.color)}"/>`)
    .join('');
  const objects = parts
    .map((p, i) => `<object id="${i + 2}" type="model" pid="1" pindex="${i}">${meshXml(p.geom)}</object>`)
    .join('');
  const components = parts.map((_, i) => `<component objectid="${i + 2}"/>`).join('');

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"` +
    ` xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"` +
    ` xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"` +
    ` xmlns:bambu="${BBL_NS}"` +
    ` xmlns:BambuStudio="${BBL_NS}"` +
    ` xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">` +
    BBL_VERSION_META +
    `<metadata name="Application">${BBL_APPLICATION}</metadata>` +
    `<resources>` +
    `<basematerials id="1">${baseMaterials}</basematerials>` +
    objects +
    `<object id="${wrapperId}" type="model"><components>${components}</components></object>` +
    colorGroupXml(palette, wrapperId + 1) +
    `</resources>` +
    `<build><item objectid="${wrapperId}"/></build>` +
    `</model>`;

  // Bambu/Orca-flavored metadata: assign each part to its own filament slot.
  const partsCfg = parts
    .map(
      (p, i) =>
        `<part id="${i + 2}" subtype="normal_part">` +
        `<metadata key="name" value="${p.name}"/>` +
        `<metadata key="extruder" value="${p.extruder}"/>` +
        `</part>`
    )
    .join('');
  const modelSettings =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<config>` +
    `<object id="${wrapperId}">` +
    `<metadata key="name" value="keycap"/>` +
    `<metadata key="extruder" value="1"/>` +
    partsCfg +
    `</object>` +
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

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      'Metadata/project_settings.config': strToU8(projectSettings(palette)),
    },
    { level: 6 }
  );
  return new Blob([zipped], { type: 'model/3mf' });
}
