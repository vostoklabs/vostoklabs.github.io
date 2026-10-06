// What every keycap export writes: the parts (cap, legends, stem; the blank cap; the fit-test
// row), laid out the way the profile prints, and the names the files get. One module for the app
// and for its export golden (tests/export-golden.test.mjs), so the golden tests the code that
// ships instead of a copy of it. No DOM and no app state: everything comes in as arguments.
import * as THREE from 'three';
import { printMatrix, weldPositions } from './meshUtils.js';

/** A name as a file-name part: runs of anything but letters and digits become one hyphen. */
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/** "#rrggbb" -> [r, g, b]. */
const rgbOf = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/**
 * One keycap part in the shape the shelf's writers take: the 3MF (export3mf.js) and the OBJ
 * (exportObj.js). One conversion for both, so the two files cannot describe different solids.
 *
 * @param {{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}} p
 */
export function shelfPart(p) {
  // Manifold output is already a clean, indexed, watertight solid — use it as-is.
  // Only weld when handed a non-indexed mesh (don't re-weld and risk false merges).
  const g = p.geom.index ? p.geom : weldPositions(p.geom);
  const idx = g.getIndex().array;
  return {
    name: p.name,
    color: rgbOf(p.color),
    extruder: p.extruder,
    positions: g.getAttribute('position').array,
    // three keeps a small mesh's index as 16-bit; the writers take 32.
    indices: idx instanceof Uint32Array ? idx : Uint32Array.from(idx),
  };
}

/** Who made the file, for the provenance mark every keycap file carries (invariant #2). */
export function keycapMark() {
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = import.meta.env ?? {};
  return { title: 'Keycap', generator: 'keycap-generator', buildId: env.VITE_BUILD_ID };
}

/**
 * The single cap's parts: the cap, the legend, any extra legends, and the stem. Shared by the
 * single-cap export and the full-alphabet batch so colour/filament assignment stays identical.
 * The stem rides on the legend filament in shine-through, otherwise the keycap filament.
 *
 * @param {{ keycapGeometry: THREE.BufferGeometry, logoGeometry: THREE.BufferGeometry|null,
 *           extraGeometries?: Array<THREE.BufferGeometry|null> }} bodies  what the carve made
 * @param {{ capColor: string, logoColor: string, through: boolean,
 *           extraColors?: Array<string|undefined>, stem?: THREE.BufferGeometry|null }} opts
 *        `extraColors[i]` is extra legend i's colour (the first legend's when missing); `stem`
 *        is the stem at the current fit tolerance, or none.
 */
export function capParts(bodies, { capColor, logoColor, through, extraColors = [], stem = null }) {
  // Filament slots, by colour. Slot 1 is the cap and slot 2 is the legend, unconditionally
  // and as they always have been — even when the two are set to the same hex, which is a
  // two-filament file someone may well have asked for on purpose.
  //
  // Extra legends are matched against what is already claimed instead, so a second legend in
  // the SAME colour as the first shares its slot rather than demanding a third filament for
  // a colour the plate is already loaded with.
  const bySlot = [capColor];
  const slotOf = (hex) => {
    const i = bySlot.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
    if (i >= 0) return i + 1;
    bySlot.push(hex);
    return bySlot.length;
  };

  const parts = [
    { name: 'Keycap', color: capColor, extruder: 1, geom: bodies.keycapGeometry },
  ];
  // Single-colour mode has no separate legend body (it's a recess in the cap) — and with no
  // legend body there are no extra ones either, so no slot is claimed and never filled.
  if (bodies.logoGeometry) {
    bySlot.push(logoColor); // slot 2
    parts.push({ name: 'Legend', color: logoColor, extruder: 2, geom: bodies.logoGeometry });
  }
  (bodies.extraGeometries ?? []).forEach((geom, i) => {
    if (!geom) return;
    const color = extraColors[i] ?? logoColor;
    parts.push({ name: `Legend ${i + 2}`, color, extruder: slotOf(color), geom });
  });
  if (stem) {
    parts.push({
      name: 'Stem',
      color: through ? logoColor : capColor,
      extruder: through ? 2 : 1,
      geom: stem,
    });
  }
  return parts;
}

/**
 * Lay the parts out the way the profile has to be printed — the same rotation the preview
 * applies through its print group, so what the user sees on the plate is what lands in the file.
 *
 * Clones before transforming: the geometries handed in are the live preview's.
 */
export function orientForPrint(parts, profile, meta) {
  const m = printMatrix(profile, meta);
  if (!m) return parts;
  return parts.map((p) => ({ ...p, geom: p.geom.clone().applyMatrix4(m) }));
}

/** The bare cap, uncarved, and its stem, in one colour: the loaded shell is already a clean
 *  indexed solid. */
export function blankParts(shell, stem, capColor) {
  const parts = [{ name: 'Keycap', color: capColor, extruder: 1, geom: shell }];
  if (stem) parts.push({ name: 'Stem', color: capColor, extruder: 1, geom: stem });
  return parts;
}

/**
 * The fit-test row as parts. Each piece's row offset is baked into real vertex positions, since
 * an export part is a standalone geometry with no parent transform (unlike the preview meshes,
 * which carry the offset as `mesh.position`).
 *
 * @param {Array<object>} pieces  `buildFitTestRow` output: a watertight piece is one solid, the
 *        rare piece whose union came back in two bodies is its tab and its stem.
 */
export function fitTestParts(pieces, capColor) {
  // A copy of the positions: `translate()` would otherwise move the preview's vertices too.
  const geom = (plain, dx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(plain.positions.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(plain.indices, 1));
    return g.translate(dx, 0, 0);
  };
  const parts = [];
  for (const p of pieces) {
    if (p.watertight) {
      // A space, not a hyphen, before the label: the label carries its own sign, and
      // `Test-${label}` named the negative rungs "Test--0.10" in the slicer's object list.
      parts.push({ name: `Fit test ${p.label}`, color: capColor, extruder: 1, geom: geom(p.geometry, p.offsetX) });
    } else {
      parts.push({ name: `Fit test tab ${p.label}`, color: capColor, extruder: 1, geom: geom(p.tabGeometry, p.offsetX) });
      parts.push({ name: `Fit test stem ${p.label}`, color: capColor, extruder: 1, geom: geom(p.stemGeometry, p.offsetX) });
    }
  }
  return parts;
}

// ------------------------------------------------------------------------------ file names

/** The profile's part of a file name, which keeps exports from different profiles apart. Empty
 *  when there is only one profile, so a single-profile build keeps its plain names. */
export function profileTag(profile, profileCount) {
  if (!profile || profileCount < 2) return '';
  return slug(profile.id);
}

const tagged = (base, tags) => {
  const tail = tags.filter(Boolean).join('-');
  return tail ? `${base}-${tail}` : base;
};

/** `keycap-<legend>[-<profile>]`, the single cap. */
export const capFileName = (legendName, tag) => tagged(`keycap-${slug(legendName || 'legend')}`, [tag]);

/** `keycap-blank[-<profile>][-<size>]`, the bare cap. */
export const blankFileName = (tag, sizeId) => tagged('keycap-blank', [tag, slug(sizeId || '')]);

/** `keycap-fit-test[-<profile>]`, the fit-test row. */
export const fitTestFileName = (tag) => tagged('keycap-fit-test', [tag]);

/** `keycap-alphabet-<font>[-<profile>]`, the full alphabet set. */
export const alphabetFileName = (fontName, tag) => tagged(`keycap-alphabet-${slug(fontName)}`, [tag]);

/** One MTL names the materials of every plate of the alphabet set. */
export const ALPHABET_MTL = 'keycap-alphabet.mtl';

/** The alphabet set's letters, and what each letter's 3MF is called in its zip. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const alphabetEntryName = (ch) => `keycap-${ch}.3mf`;
