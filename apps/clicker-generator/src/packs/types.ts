/**
 * Seasonal content packs — what one is, and what it can contain.
 *
 * A pack is DATA. Adding Halloween must not mean adding a `case 'pumpkin'` to the geometry,
 * because the second pack would then mean another one, and by the third the shape switch in
 * buildClicker is the changelog. So everything a pack contributes goes in through a seam that
 * already existed or was widened once:
 *
 *   shapes  → `baseShape: 'custom'` + `baseShapeRings`, traced from the SVG by `parseSvg`
 *   designs → exactly the path an uploaded SVG takes, no new code at all
 *   font    → an id from FONT_OPTIONS, which the text/blocks modes already accept
 *   palette → filament suggestions, applied the way the palette swatches already are
 *
 * The consequence, on purpose: a new pack is a folder of SVGs and one manifest file. Nothing
 * in `src/geometry/` or `src/export/` has to know it exists.
 *
 * Packs are FREE and present in both builds — the public site and the MakerLab embed. They are
 * content, not capability, and invariant #1 is about capability. A seasonal pack is also the
 * thing most likely to bring someone to the app in the first place, which is worth more than
 * what gating it would earn.
 */

/** One silhouette a pack contributes to the base-shape picker. */
export interface PackShape {
  /** Stable id — it is stored in saved projects, so it must never be renamed. */
  id: string;
  /** What the picker calls it. */
  name: string;
  /** SVG file, relative to the pack's asset folder. */
  file: string;
}

/**
 * One piece of artwork a pack contributes to the design picker.
 *
 * The file may be a vector (`.svg`) or a bitmap (`.png`, `.jpg`, `.webp`), and which one it is
 * decides nothing but the loader: a vector goes down the path an uploaded SVG takes, a bitmap
 * goes down the path an uploaded photo takes. Both end at the same `RegionSet`, so every colour
 * control, the palette and the exporter behave identically either way — which is the whole
 * reason a pack is allowed to mix them.
 *
 * `designIsVector` is the discriminator, and it reads the extension rather than a field in the
 * manifest on purpose: a manifest that can disagree with the file on disk will, eventually, and
 * the failure is silent — `parseSvg` on PNG bytes throws inside a promise nobody awaits.
 */
export interface PackDesign {
  /** Stable id — stored in saved projects, so it must never be renamed. */
  id: string;
  name: string;
  /** File under the pack's `designs/` folder. */
  file: string;
}

/** Is this design a vector file? Everything else is a bitmap and rides the upload path. */
export function designIsVector(design: PackDesign): boolean {
  return /\.svgz?$/i.test(design.file);
}

/**
 * When a pack is the one to lead with. Month/day only — a season recurs, and pinning it to a
 * year would mean editing every pack every January.
 *
 * `to` before `from` wraps the new year, which Christmas needs and Halloween does not.
 */
export interface Season {
  /** Inclusive, "MM-DD". */
  from: string;
  /** Inclusive, "MM-DD". */
  to: string;
}

export interface Pack {
  id: string;
  /** Shown as a group heading in the pickers. */
  name: string;
  /** One line, for the pack's own row. */
  blurb: string;
  /** Folder under `public/assets/packs/`. */
  dir: string;
  /** When to lead with it. Ordering only — see `inSeason` for why it never hides anything. */
  season?: Season;
  shapes: PackShape[];
  designs: PackDesign[];
  /** A font from `FONT_OPTIONS` that suits the pack, offered rather than forced. */
  fontId?: string;
  /** Filament colours that suit the pack, as hex. Offered as a one-click palette. */
  palette?: string[];
}

/**
 * Is today inside the pack's season?
 *
 * Used ONLY to order the pack list and to draw an "In season" chip. Never to hide a pack.
 *
 * A pack that disappeared on the 1st of November would take a half-finished design with it —
 * the shape the user picked would no longer exist, the project would not reload, and the app
 * would have broken something the user made while they were not looking. Seasonal content is
 * a reason to surface something, never a reason to withdraw it.
 */
export function inSeason(pack: Pack, now: Date = new Date()): boolean {
  if (!pack.season) return false;
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { from, to } = pack.season;
  // A season that wraps the new year (Dec 15 → Jan 06) is two ranges, not one.
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
