/**
 * The base-shape directory: every shape the picker can offer.
 *
 * **Curated, deliberately, after a failed attempt at the opposite.** The first version of this
 * generated 371 shapes by extracting outer loops from an icon library and filtering them
 * numerically — area fill, inscribed square, aspect ratio. Every one passed a test proving it
 * was closed, printable and not secretly a circle. The result still shipped 28 brand logos
 * (Apple, Microsoft, YouTube — trademarks, which `vite.config.ts` already strips for exactly
 * this reason at the icon level) alongside `backspace`, `barcode` and the whole `align-*`
 * family, whose outer loops are meaningless rectangles.
 *
 * No numeric filter can say "this is the Apple logo and it should not be here". Where taste is
 * the requirement, the review step is a person. So a shape earns its place here by being one
 * somebody would want a clicker shaped like, checked by eye, and the list stays short enough
 * that checking by eye is possible.
 *
 * Two sources now, and the picker does not care which a shape came from:
 *
 *  - **Built-in** — generated in `buildClicker` from `shapePaths.ts`. Free, exact, offline.
 *    Ten of them are parametric: one knob turns a shape into a family.
 *  - **Pack** — seasonal silhouettes from `src/packs/`, through the `baseShape: 'custom'` seam.
 *    Fetched and traced on demand, and opened to a minimum feature thickness by `makeCustom`
 *    so a thin spur cannot catch on the body when the clicker is pressed.
 *
 * A shape is a `ShapeEntry`: an id, a name, categories, a thumbnail path, and either a
 * `BaseShapeKind` or rings. That is the whole contract, and it is why the 2-D editor's output
 * will slot in as a third source without touching this file's consumers.
 */
import type { BaseShapeKind, Ring } from '../types';
import {
  archRing, capsuleRing, circleRing, crossRing, eggRing, heartRing,
  ngonRing, ringToPath, roundedRectRing, shieldRing, squircleRing, starRing, tagRing,
} from '../geometry/shapePaths';
import { inSeason, loadShapeRings, orderedPacks, shapeToken } from '../packs';

/** The knob a parametric shape exposes, if it has one. */
export interface ShapeParam {
  label: string;
  min: number;
  max: number;
  step: number;
  /** What `shapeSides` should be when this shape is picked. */
  value: number;
}

export interface ShapeEntry {
  /** Stable, and stored in saved projects — never rename one. */
  id: string;
  name: string;
  /** Filter chips in the picker. */
  cats: string[];
  /** SVG path `d` in a 40×40 box, for the picker tile. */
  thumb: string;
  /** Built-in shapes map straight onto `BaseShapeKind`. */
  kind?: BaseShapeKind;
  /** Library shapes arrive as normalised rings and build via `baseShape: 'custom'`. */
  rings?: Ring[];
  param?: ShapeParam;
  /** Corner-radius knob, for the shapes that have corners. Separate from `param` because a
   *  rounded rectangle has both a size and a roundness and they are not the same question. */
  corner?: ShapeParam;
  /** The notch knob: how deep the shape cuts in. A star's valley radius, a cross's arm
   *  half-width. Its own field for the same reason `corner` is — a star has both a point count
   *  and a sharpness, and they are two questions. Values are percentages, like `corner`. */
  feature?: ShapeParam;
  /**
   * Keep it out of the picker, but keep it resolvable.
   *
   * `id` is stored in saved projects, so an entry can never simply be deleted — `findShape`
   * and `entryForState` have to keep answering for it or every project that used one loses
   * its shape and its name on the button. This is the difference between "not offered" and
   * "gone", and only the first of those is ever safe here.
   */
  hidden?: true;
}

const t = (r: Ring) => ringToPath(r);

/** The built-ins. `kind` is the value that goes into `baseShape`, so these ids ARE the
 *  existing `BaseShapeKind` strings — every project ever saved keeps working untouched. */
const BUILT_IN: ShapeEntry[] = [
  { id: 'circle', name: 'Circle', cats: ['basic'], thumb: t(circleRing()), kind: 'circle' },
  {
    id: 'square', name: 'Square', cats: ['basic'], thumb: t(roundedRectRing(2, 2)), kind: 'square',
    // The control Ian found missing: `shapeCornerPct` reached `genShape` and `shapeInBox` and
    // had no way to be set, so a square was stuck at whatever 0.22 happened to look like.
    corner: { label: 'Corner radius', min: 0, max: 40, step: 2, value: 22 },
  },
  {
    id: 'rect', name: 'Rectangle', cats: ['basic'], thumb: t(roundedRectRing(2.6, 1.6)), kind: 'rect',
    corner: { label: 'Corner radius', min: 0, max: 40, step: 2, value: 22 },
  },
  { id: 'squircle', name: 'Squircle', cats: ['basic'], thumb: t(squircleRing()), kind: 'squircle' },
  {
    id: 'capsule', name: 'Capsule', cats: ['basic'], thumb: t(capsuleRing()), kind: 'capsule',
  },
  {
    id: 'ngon', name: 'Polygon', cats: ['basic', 'geometric'], thumb: t(ngonRing(6)), kind: 'ngon',
    param: { label: 'Sides', min: 3, max: 8, step: 1, value: 6 },
  },
  /* Not offered any more, and still resolvable — see `hidden`.

     Its thumbnail is `t(ngonRing(6))` and so is Polygon's: the same picture twice, on two
     tiles, where only one of them can change its side count (`HANDLES.hexagon` is `['size']`,
     and `genShape` hard-returns a six-sided ring whatever `shapeSides` says). So the honest
     answer to "how do I get seven sides" was "not from the tile that looks like the answer".
     Removing the duplicate answers the question instead of explaining it. */
  { id: 'hexagon', name: 'Hexagon', cats: ['geometric'], thumb: t(ngonRing(6)), kind: 'hexagon', hidden: true },
  {
    id: 'star', name: 'Star', cats: ['fun', 'geometric'], thumb: t(starRing(5)), kind: 'star',
    param: { label: 'Points', min: 3, max: 8, step: 1, value: 5 },
    // 56 is `makeStar`'s own shipped inner radius, so picking Star gives the star that has
    // been printing for months rather than whatever the last shape's notch happened to be.
    feature: { label: 'Sharpness', min: 30, max: 80, step: 2, value: 56 },
  },
  { id: 'heart', name: 'Heart', cats: ['fun'], thumb: t(heartRing()), kind: 'heart' },
  { id: 'egg', name: 'Egg', cats: ['fun', 'nature'], thumb: t(eggRing()), kind: 'egg' },
  {
    id: 'cross', name: 'Cross', cats: ['geometric'], thumb: t(crossRing()), kind: 'cross',
    feature: { label: 'Arm width', min: 15, max: 45, step: 2, value: 34 },
  },
  { id: 'shield', name: 'Shield', cats: ['badge'], thumb: t(shieldRing()), kind: 'shield' },
  { id: 'tag', name: 'Tag', cats: ['badge'], thumb: t(tagRing()), kind: 'tag' },
  { id: 'arch', name: 'Arch', cats: ['badge'], thumb: t(archRing()), kind: 'arch' },
];

let cache: ShapeEntry[] | null = null;
/** Pack shapes, once their SVGs have been fetched and traced. */
let packEntries: ShapeEntry[] = [];

/** Every shape the picker can show. */
export function allShapes(): ShapeEntry[] {
  if (!cache) cache = [...BUILT_IN];
  return [...cache, ...packEntries];
}

/** One heading in the picker, and the shapes under it. */
export interface ShapeGroup {
  id: string;
  label: string;
  shapes: ShapeEntry[];
}

/** Pack groups, in `orderedPacks` order, filled in by `loadPackShapes`. */
let packGroups: ShapeGroup[] = [];

/**
 * The shapes as the picker lays them out: ours first, then one heading per pack.
 *
 * Grouped by SOURCE rather than filtered by category. The directory holds eighteen shapes,
 * and eighteen tiles fit on one screen — so a category dropdown over them would be a control
 * whose only job is hiding twelve things the user can already see. What a heading does that a
 * filter cannot is say where a shape came from, which is the one thing about a seasonal
 * silhouette that is worth saying.
 */
export function shapeGroups(): ShapeGroup[] {
  const ours = allShapes().filter((s) => !!s.kind && !s.hidden);
  return [{ id: 'built-in', label: 'Shapes', shapes: ours }, ...packGroups];
}

/**
 * Fetch and trace the seasonal packs' silhouettes so they can sit in the picker beside
 * everything else, with real thumbnails rather than a placeholder.
 *
 * Async and called before the picker opens, rather than at module load: a pack shape is a file
 * on disk that has to be fetched and traced, and doing that at import time would put it on the
 * app's startup path for a control most sessions never open. Idempotent, and a pack whose file
 * will not load is simply absent rather than a broken tile.
 */
let packLoad: Promise<void> | null = null;

export function loadPackShapes(): Promise<void> {
  if (packEntries.length) return Promise.resolve();
  // Memoise the PROMISE, not just the result: the picker button can be clicked twice before
  // the first fetch resolves, and two passes would each append a full set of entries.
  if (!packLoad) packLoad = doLoadPackShapes().finally(() => { packLoad = null; });
  return packLoad;
}

async function doLoadPackShapes(): Promise<void> {
  const out: ShapeEntry[] = [];
  const groups: ShapeGroup[] = [];
  for (const pack of orderedPacks()) {
    const mine: ShapeEntry[] = [];
    for (const shape of pack.shapes) {
      try {
        const rings = await loadShapeRings(pack, shape);
        if (!rings.length) continue;
        mine.push({
          id: shapeToken(pack, shape),
          name: shape.name,
          cats: ['seasonal', pack.id],
          thumb: ringToPath(rings[0]),
          rings,
        });
      } catch (err) {
        console.error(`[shapes] pack shape ${pack.id}:${shape.id} failed to load`, err);
      }
    }
    // A pack whose files all failed to load gets no heading, rather than an empty one.
    if (!mine.length) continue;
    out.push(...mine);
    groups.push({
      id: pack.id,
      // The chip is ordering made visible. `inSeason` never hides a pack, so when Halloween
      // sits at the top in October something has to say why.
      label: inSeason(pack) ? `${pack.name} · in season` : pack.name,
      shapes: mine,
    });
  }
  packEntries = out;
  packGroups = groups;
}

export function findShape(id: string): ShapeEntry | null {
  return allShapes().find((s) => s.id === id) ?? null;
}

/**
 * The entry a stored `baseShape` (+ pack token) corresponds to.
 *
 * `outline` has no entry on purpose — it is not a shape, it is "follow the artwork", and it is
 * chosen by a different control. Returning null lets the picker button say so.
 */
export function entryForState(baseShape: string, packShapeToken: string | null): ShapeEntry | null {
  if (baseShape === 'outline') return null;
  if (baseShape === 'custom') return packShapeToken ? findShape(packShapeToken) : null;
  return findShape(baseShape);
}

/** The filter chips, with counts, in the order they should appear. */
export function shapeCategories(): { id: string; label: string; count: number }[] {
  const order: [string, string][] = [
    ['basic', 'Basic'],
    ['geometric', 'Geometric'],
    ['badge', 'Badges'],
    ['fun', 'Fun'],
    ['nature', 'Nature'],
    ['seasonal', 'Seasonal'],
  ];
  const shapes = allShapes();
  return order
    .map(([id, label]) => ({ id, label, count: shapes.filter((s) => s.cats.includes(id)).length }))
    .filter((c) => c.count > 0);
}
