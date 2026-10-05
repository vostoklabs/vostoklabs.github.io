// Sheet presets — Bambu Lab machine beds and the blank sizes people actually own — and materials.
//
// Machines are Bambu Lab's only — never another maker's, and no material brand either (Ian,
// 2026-10-03): a competitor's bed in this list advertises it.
//
// A preset is a starting point, never a lock: picking one fills the width and height fields
// and the user can type over them. Sizes are the WORK AREA, not the enclosure.
export interface SheetPreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  group: 'Machines' | 'Sheets & blanks';
}

export const SHEET_PRESETS: SheetPreset[] = [
  { id: 'h2d-10w', name: 'Bambu Lab H2D · 10 W laser', widthMm: 310, heightMm: 270, group: 'Machines' },
  { id: 'h2d-40w', name: 'Bambu Lab H2D · 40 W laser', widthMm: 310, heightMm: 250, group: 'Machines' },
  { id: 'sheet-12x12', name: '12 × 12 in sheet', widthMm: 305, heightMm: 305, group: 'Sheets & blanks' },
  { id: 'sheet-12x20', name: '12 × 20 in sheet', widthMm: 508, heightMm: 305, group: 'Sheets & blanks' },
  { id: 'sheet-a4', name: 'A4', widthMm: 297, heightMm: 210, group: 'Sheets & blanks' },
  { id: 'sheet-a3', name: 'A3', widthMm: 420, heightMm: 297, group: 'Sheets & blanks' },
  { id: 'sheet-400x400', name: '400 × 400 mm', widthMm: 400, heightMm: 400, group: 'Sheets & blanks' },
  { id: 'sheet-300x300', name: '300 × 300 mm', widthMm: 300, heightMm: 300, group: 'Sheets & blanks' },
  { id: 'sheet-300x200', name: '300 × 200 mm', widthMm: 300, heightMm: 200, group: 'Sheets & blanks' },
  { id: 'sheet-200x200', name: '200 × 200 mm', widthMm: 200, heightMm: 200, group: 'Sheets & blanks' },
  { id: 'sheet-100x100', name: '100 × 100 mm (slate coaster)', widthMm: 100, heightMm: 100, group: 'Sheets & blanks' },
  { id: 'sheet-card', name: '85 × 54 mm (aluminium card)', widthMm: 85, heightMm: 54, group: 'Sheets & blanks' },
  { id: 'custom', name: 'Custom size', widthMm: 200, heightMm: 200, group: 'Sheets & blanks' },
];

export interface Material {
  id: string;
  name: string;
  thicknessMm: number;
  /** Beam width on a typical diode / small CO₂. 0 = engrave-only surface. */
  kerfMm: number;
  /** What the sheet looks like on the workspace. */
  hex: string;
  /** Only engraving makes sense — slate, anodised metal. */
  engraveOnly?: boolean;
}

export const MATERIALS: Material[] = [
  { id: 'ply15', name: 'Basswood plywood 1.5 mm', thicknessMm: 1.5, kerfMm: 0.15, hex: '#d6b98a' },
  { id: 'ply3', name: 'Basswood plywood 3 mm', thicknessMm: 3, kerfMm: 0.18, hex: '#c9a978' },
  { id: 'ply4', name: 'Basswood plywood 4 mm', thicknessMm: 4, kerfMm: 0.2, hex: '#c9a978' },
  // The stock a stand's base wants. Its kerf continues the measured progression above
  // (1.5 → 0.15, 3 → 0.18, 4 → 0.20); without the entry `materialById('ply6')` falls back to
  // `ply3` and a sheet labelled 6 mm is cut with 3 mm joints.
  { id: 'ply6', name: 'Basswood plywood 6 mm', thicknessMm: 6, kerfMm: 0.24, hex: '#c9a978' },
  { id: 'mdf3', name: 'MDF 3 mm', thicknessMm: 3, kerfMm: 0.2, hex: '#b09a7a' },
  // Thick board, for parts that carry a load. Its kerf is a first number, as every one here
  // is: a test cut is what settles it.
  { id: 'mdf6', name: 'MDF 6 mm', thicknessMm: 6, kerfMm: 0.25, hex: '#b09a7a' },
  { id: 'acr-opaque3', name: 'Opaque acrylic 3 mm', thicknessMm: 3, kerfMm: 0.18, hex: '#d64550' },
  { id: 'acr-clear3', name: 'Clear acrylic 3 mm', thicknessMm: 3, kerfMm: 0.18, hex: '#bfe3ee' },
  { id: 'leatherette', name: 'Leatherette 1.4 mm', thicknessMm: 1.4, kerfMm: 0.1, hex: '#6b4a2f' },
  { id: 'card2', name: 'Greyboard / card 2 mm', thicknessMm: 2, kerfMm: 0.12, hex: '#9aa0a6' },
  { id: 'slate', name: 'Slate (engrave only)', thicknessMm: 8, kerfMm: 0, hex: '#4a4f57', engraveOnly: true },
  { id: 'anodised', name: 'Anodised aluminium (engrave only)', thicknessMm: 0.5, kerfMm: 0, hex: '#8d9298', engraveOnly: true },
];

export const presetById = (id: string): SheetPreset | undefined => SHEET_PRESETS.find((p) => p.id === id);
export const materialById = (id: string): Material => MATERIALS.find((m) => m.id === id) ?? MATERIALS[1]!;
