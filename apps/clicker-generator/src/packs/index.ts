/**
 * The seasonal-pack registry.
 *
 * One place that knows which packs exist, where their files are, and how to turn one of their
 * SVGs into something the geometry already understands. Adding a pack is adding a manifest
 * and one line to `PACKS`.
 *
 * Packs are free and present in both builds — see `./types.ts` for why.
 */
import { assetUrl } from '../assets';
import { loadUrlToImage, type RgbaImage } from '../image/decode';
import { parseSvg } from '../image/logo';
import type { RegionSet, Ring } from '../types';
import { HALLOWEEN } from './halloween';
import { inSeason, type Pack, type PackDesign, type PackShape } from './types';

export * from './types';

/** Every pack the app ships. Order here is the fallback order; `orderedPacks()` puts the
 *  one that is in season first. */
export const PACKS: Pack[] = [HALLOWEEN];

/** Packs with at least one asset wired up. A manifest whose files have not been added yet is
 *  a placeholder, and a placeholder must not put an empty group in a picker. */
export function availablePacks(): Pack[] {
  return PACKS.filter((p) => p.shapes.length > 0 || p.designs.length > 0);
}

/** In-season first, then the declared order. Ordering only — nothing is ever hidden. */
export function orderedPacks(now: Date = new Date()): Pack[] {
  const packs = availablePacks();
  return [...packs].sort((a, b) => Number(inSeason(b, now)) - Number(inSeason(a, now)));
}

export function findPack(id: string | null | undefined): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

/** `packId:shapeId` — one opaque token the UI can put in a `<select>` and hand straight back. */
export function shapeToken(pack: Pack, shape: PackShape): string {
  return `${pack.id}:${shape.id}`;
}

export function resolveShape(token: string): { pack: Pack; shape: PackShape } | null {
  const [packId, shapeId] = token.split(':');
  const pack = findPack(packId);
  const shape = pack?.shapes.find((s) => s.id === shapeId);
  return pack && shape ? { pack, shape } : null;
}

/** URL of one of a pack's files. */
export function packAssetUrl(pack: Pack, kind: 'shapes' | 'designs', file: string): string {
  return assetUrl(`assets/packs/${pack.dir}/${kind}/${file}`);
}

/*
  Fetched SVGs are cached by URL for the life of the page.

  A base shape is re-traced on every geometry rebuild, and a rebuild happens on every slider
  drag. Without this, dragging Size across its range would fetch and re-parse the same pumpkin
  forty times. It is also what keeps a pack usable offline once its files have been touched
  once, which matters for the single-file offline build (invariant #5).
*/
const svgCache = new Map<string, Promise<string>>();

function fetchSvg(url: string): Promise<string> {
  let hit = svgCache.get(url);
  if (!hit) {
    hit = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`pack asset ${url}: HTTP ${r.status}`);
      return r.text();
    });
    // A failed fetch must not be remembered as the answer — drop it so a retry can succeed.
    hit.catch(() => svgCache.delete(url));
    svgCache.set(url, hit);
  }
  return hit;
}

/**
 * A pack shape as the geometry wants it: normalised rings for `baseShape: 'custom'`.
 *
 * The silhouette is the UNION of every filled region in the file, not one colour of it — a
 * body has one outline whatever the drawing is coloured. `parseSvg` already computes exactly
 * that as `outline`, so this is a fetch, a parse and a field read.
 */
export async function loadShapeRings(pack: Pack, shape: PackShape): Promise<Ring[]> {
  const svg = await fetchSvg(packAssetUrl(pack, 'shapes', shape.file));
  const set: RegionSet = parseSvg(svg, { removeBg: true });
  return set.outline;
}

/** Where one of a pack's designs lives. Also its thumbnail — the tile shows the artwork
 *  itself, so there is no second file to keep in step with the first. */
export function designUrl(pack: Pack, design: PackDesign): string {
  return packAssetUrl(pack, 'designs', design.file);
}

/** A VECTOR pack design: the same `RegionSet` an uploaded SVG produces, so every colour
 *  control, the palette and the export behave identically. */
export async function loadDesign(pack: Pack, design: PackDesign): Promise<{ svgText: string; regionSet: RegionSet }> {
  const svgText = await fetchSvg(packAssetUrl(pack, 'designs', design.file));
  return { svgText, regionSet: parseSvg(svgText, { removeBg: true }) };
}

/**
 * A BITMAP pack design, decoded exactly as an uploaded photo is.
 *
 * Deliberately the same call the bundled samples make (`image/sample.ts`), which is what makes
 * a pack design open the same colour wizard, quantise with the same settings and land in the
 * same palette as anything the user drags in. A pack that needed its own import path would be
 * a second pipeline to keep in step with the first, and it would drift.
 *
 * Not cached: `loadUrlToImage` already downscales to the pipeline's working size, and holding
 * fifteen decoded bitmaps for a picker most sessions click once is memory spent on nothing.
 * The browser's own HTTP cache covers the second click.
 */
export function loadDesignImage(pack: Pack, design: PackDesign): Promise<RgbaImage> {
  return loadUrlToImage(designUrl(pack, design));
}

/** Every design in every available pack, in the same order the packs are offered. */
export function orderedDesignPacks(now: Date = new Date()): Pack[] {
  return orderedPacks(now).filter((p) => p.designs.length > 0);
}
