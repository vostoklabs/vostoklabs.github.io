// How a job LOOKS once the laser has run, on this material — the one palette the design
// view's Preview mode and the studios' Preview stage share. File colours (red cut, blue score,
// black engrave) say what the machine does; this says what the piece looks like afterwards:
// a filled engrave is a burn, a cut is a thin dark kerf with the piece still in the sheet, a
// score is a faint line.
export interface BurnStyle {
  /** The material face. */
  material: string;
  /** Fill of an engraved area. */
  engrave: string;
  /** The kerf of a through-cut, drawn as a thin line. */
  cut: string;
  /** A score: a light line pass. */
  score: string;
  /** Width of the kerf line, mm. */
  kerfMm: number;
}

/** sRGB luminance 0..1 of "#rrggbb". */
function luma(hex: string): number {
  const v = parseInt(hex.replace('#', ''), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

/**
 * Wood and light materials burn dark; slate, anodised aluminium and dark acrylic mark light.
 * `materialId` refines the two families where a name is known.
 */
export function burnStyle(materialHex: string, materialId = ''): BurnStyle {
  const dark = luma(materialHex) < 0.45;
  const id = materialId.toLowerCase();
  if (id.includes('slate')) return { material: materialHex, engrave: '#cfd3d6', cut: '#e6e8ea', score: '#b8bdc2', kerfMm: 0.25 };
  if (id.includes('anod') || id.includes('metal')) return { material: materialHex, engrave: '#f2f2f2', cut: '#ffffff', score: '#d9d9d9', kerfMm: 0.2 };
  if (id.includes('acryl') && !dark) return { material: materialHex, engrave: '#e9ecef', cut: '#8a9099', score: '#d0d4d9', kerfMm: 0.2 };
  if (dark) return { material: materialHex, engrave: '#e8e4dc', cut: '#f4f1ea', score: '#cfc9bd', kerfMm: 0.25 };
  // Wood, card, cork, leather: the burn is a dark brown, the kerf nearly black.
  return { material: materialHex, engrave: '#3b2412', cut: '#1c1006', score: '#7a5233', kerfMm: 0.25 };
}
