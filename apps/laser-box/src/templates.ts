// Templates — a finished box to start from (Ian, 2026-10-03: "several templates, like with
// premade settings and pattern as a starting point"). Each sets what the box IS — its type, size,
// compartments, drawers, bottom and pattern — and leaves what the customer's laser and stock
// are: material, thickness, kerf, fit, joints (tab width included) and sheet stay as they were.
//
// They show as sample tiles under the chosen box type; the pictures are rendered by a test script.
import { DEFAULT_DECORATION, coerceSettings, type BoxSettings } from './state';
import type { Decoration } from './engine/decor';

export interface BoxTemplate {
  id: string;
  name: string;
  /** What it sets; everything not named here is reset to the default, except the stock. */
  settings: Partial<BoxSettings>;
}

const pattern = (d: Partial<Decoration>): Decoration => ({ ...DEFAULT_DECORATION, on: 'pick', ...d });

// The four Ian kept from the first eight (2026-10-03; Tea box, Gift box, Desk tidy and Tray
// organiser were dropped), the slim drawer he asked for after them, and three lift-off boxes
// ("add some to lift off templates").
export const TEMPLATES: BoxTemplate[] = [
  {
    id: 'jewellery',
    name: 'Jewellery box',
    settings: { style: 'hinge', length: 160, width: 110, height: 40, dividersX: 2, dividersY: 1, decorations: [pattern({ faces: ['lid'], pattern: 'asanoha', op: 'score', margin: 6 })] },
  },
  {
    // Two standard poker decks (63.5 × 88.9 mm cards, about 17 mm a deck) lying flat: 1.5 mm of
    // room round them and 2 mm over them. Sized from the inside, on a raised floor.
    id: 'cards',
    name: 'Card box',
    settings: { style: 'hinge', measure: 'inside', length: 92, width: 67, height: 36, bottom: 'slots', decorations: [pattern({ faces: ['lid'], pattern: 'stars', op: 'score', margin: 5 })] },
  },
  {
    id: 'chest',
    name: 'Chest of drawers',
    settings: { style: 'drawer', drawers: 3, length: 150, width: 120, height: 150, bottom: 'feet', decorations: [pattern({ faces: ['front'], pattern: 'ogee', op: 'score', margin: 5 })] },
  },
  {
    id: 'keepsake',
    name: 'Keepsake box',
    settings: { style: 'lid', length: 160, width: 120, height: 70, decorations: [pattern({ faces: ['lid'], pattern: 'seigaiha', op: 'engrave', zoom: 160, margin: 6 })] },
  },
  {
    // Six-by-four photos (152 × 102 mm) lying flat, 2 mm round them; a cut heart on the lid.
    id: 'photos',
    name: 'Photo box',
    settings: { style: 'lid', measure: 'inside', length: 156, width: 106, height: 50, decorations: [pattern({ faces: ['lid'], pattern: 'pm-japanese-pattern-4', op: 'cut', window: 'heart', windowSize: 70, frame: true })] },
  },
  {
    // A stack of 100 mm coasters, 2 mm round them.
    id: 'coasters',
    name: 'Coaster box',
    settings: { style: 'lid', measure: 'inside', length: 104, width: 104, height: 30, decorations: [pattern({ faces: ['lid'], pattern: 'shippo', op: 'score', margin: 5 })] },
  },
  {
    // One slim, deep drawer with the pattern all round it — the case's top, back and sides and the
    // drawer's front — as Ian built it in his screenshot (2026-10-03: 80 wide, 117 deep, 36 high,
    // the default pattern scored).
    id: 'trinket',
    name: 'Trinket drawer',
    settings: { style: 'drawer', drawers: 1, length: 80, width: 120, height: 36, decorations: [pattern({ faces: ['lid', 'front', 'back', 'left', 'right'], pattern: 'pm-japanese-pattern-4', op: 'score', margin: 4 })] },
  },
  {
    id: 'lantern',
    name: 'Tealight lantern',
    settings: { style: 'open', length: 90, width: 90, height: 130, fingerHole: false, decorations: [pattern({ faces: ['front', 'back', 'left', 'right'], pattern: 'pm-japanese-pattern-2', op: 'cut', web: 1, margin: 8 })] },
  },
];

/** The settings a template gives this customer: the template over the defaults, their stock kept. */
export function fromTemplate(t: BoxTemplate, current: BoxSettings): BoxSettings {
  const { material, thickness, kerf, kerfAuto, fit, joint, finger, sheet, sheetW, sheetH } = current;
  return coerceSettings({ ...t.settings, material, thickness, kerf, kerfAuto, fit, joint, finger, sheet, sheetW, sheetH });
}
