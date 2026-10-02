// A tile drawn the way Pattern Monster draws it — the same `<pattern>` element, the same
// stroke/fill/join rules per mode, the same scale · rotate · spacing · slide controls — so a
// gallery card here looks like the card there, and a customer who knows the site is at home.
// Pure string building; nothing touches the DOM.
//
// Mirrors `svgPattern()` in the repo's src/routes/[slug].svelte (MIT): the pattern's cell is
// the tile plus its spacing, the background rect takes colour 0, layer i takes colour i+1, a
// stroke tile is `fill='none' stroke=…`, a stroke-join tile adds round joins and caps (join 2)
// or square caps (join 1), a fill tile is `stroke='none' fill=…`, and every layer is nudged
// right by half the horizontal spacing.
export interface MonsterTileMeta {
  id: string;
  title: string;
  mode: 'stroke' | 'stroke-join' | 'fill';
  /** How many colours the tile is drawn with, background included. */
  colors: number;
  maxStroke: number;
  maxScale: number;
  maxSpacing: [number, number];
  vHeight: number;
  width: number;
  height: number;
  tags: string[];
  created: string;
  /** Number of colour layers (paths). */
  layers?: number;
  /** The period in mm the tile reads at on a coaster, measured from its line density. */
  size?: number;
}

export interface MonsterTile extends MonsterTileMeta {
  /** Path data per colour layer, in the tile's own units, SVG orientation. */
  paths: string[];
}

export interface TileLook {
  /** Colour 0 (the background) and the layer colours after it. A single foreground colour is
   *  used for every layer when only two are given. */
  colours: string[];
  /** Stroke width in tile units (Pattern Monster's own slider, 0.5 … maxStroke). Default 1. */
  stroke?: number;
  /** Pattern Monster's Zoom: a scale on the pattern. Default 1 (the gallery card), 2 (the page). */
  scale?: number;
  /** Degrees. */
  angle?: number;
  /** Extra space added to the cell, tile units, [x, y]. */
  spacing?: [number, number];
  /** Stroke-join tiles: 1 = square caps, 2 = round joins and caps. */
  join?: 1 | 2;
  /** Slide the pattern, in tile units (before the scale). */
  moveX?: number;
  moveY?: number;
}

/** Pattern Monster's own dark and light palettes (index 0 is the background). */
export const MONSTER_DARK = ['hsla(240,6.7%,17.6%,1)', 'hsla(47,80.9%,61%,1)', 'hsla(4.1,89.6%,58.4%,1)', 'hsla(186.8,100%,41.6%,1)', 'hsla(258.5,59.4%,59.4%,1)'];
export const MONSTER_LIGHT = ['hsla(0,0%,100%,1)', 'hsla(258.5,59.4%,59.4%,1)', 'hsla(339.6,82.2%,51.6%,1)', 'hsla(198.7,97.6%,48.4%,1)', 'hsla(47,80.9%,61%,1)'];

let counter = 0;

/** The layers of one tile as `<path>` markup, ready to sit inside a `<pattern>`. */
export function tileLayers(tile: MonsterTile, look: TileLook): string {
  const stroke = look.stroke ?? 1;
  const join = look.join ?? 1;
  const dx = (look.spacing?.[0] ?? 0) / 2;
  const colourOf = (i: number): string => look.colours[i + 1] ?? look.colours[1] ?? '#000';
  return tile.paths
    .map((d, i) => {
      const colour = colourOf(i);
      const paint =
        tile.mode === 'fill'
          ? `stroke="none" fill="${colour}"`
          : tile.mode === 'stroke-join'
            ? `fill="none" stroke="${colour}" stroke-width="${stroke}" ${join === 2 ? 'stroke-linejoin="round" stroke-linecap="round"' : 'stroke-linecap="square"'}`
            : `fill="none" stroke="${colour}" stroke-width="${stroke}"`;
      const move = dx ? ` transform="translate(${dx},0)"` : '';
      return `<path d="${d}"${move} ${paint}/>`;
    })
    .join('');
}

/**
 * A complete SVG of the tile repeated over a box, Pattern Monster style. `width`/`height` are
 * the SVG's size attributes (numbers or '100%'); the pattern is drawn in user units, so a
 * 300 × 200 card at scale 1 shows the tile at its own unit size, as the gallery does.
 */
export function tileSvg(tile: MonsterTile, look: TileLook, width: number | string = '100%', height: number | string = '100%'): string {
  const sx = look.spacing?.[0] ?? 0;
  const sy = look.spacing?.[1] ?? 0;
  const scale = look.scale ?? 1;
  const angle = look.angle ?? 0;
  const id = `pm${(counter = (counter + 1) % 1e9)}`;
  const transform = `scale(${scale}) rotate(${angle})`;
  const bg = look.colours[0] ?? 'none';
  const slide = look.moveX || look.moveY ? ` transform="translate(${(look.moveX ?? 0) * scale},${(look.moveY ?? 0) * scale})"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile.width + sx}" height="${tile.height + sy}" patternTransform="${transform}">` +
    `<rect x="0" y="0" width="100%" height="100%" fill="${bg}"/>${tileLayers(tile, look)}</pattern></defs>` +
    `<rect width="800%" height="800%"${slide} fill="url(#${id})"/></svg>`
  );
}

/** A small deterministic generator for "Inspire me". */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * An "Inspire me" look in a form's pattern vocabulary: the site's Zoom is a multiplier around
 * 2 and a form's is a percentage where 100 % is the tile at its own size, so ×50 and nothing
 * else; the angle folds into the half turn a slider offers (a pattern at 190° is one at 10°);
 * spacing is capped by what the TILE allows. Ignorant of the sliders' own limits on purpose —
 * the form clamps each value to its field's range afterwards.
 */
export function surpriseValues(look: TileLook | { scale?: number; angle?: number; stroke?: number; spacing?: [number, number] }, tile: { maxSpacing: [number, number] }): Record<string, number> {
  return {
    patternScale: Math.round((look.scale ?? 1) * 50),
    patternAngle: (look.angle ?? 0) % 180,
    patternStroke: look.stroke ?? 1,
    patternSpacingX: Math.min(look.spacing?.[0] ?? 0, tile.maxSpacing[0]),
    patternSpacingY: Math.min(look.spacing?.[1] ?? 0, tile.maxSpacing[1]),
  };
}

/** Pattern Monster's "Inspire me" for one tile: a random stroke, zoom, spacing, angle and
 *  join inside the tile's own ranges — the same tile look for the same seed. */
export function inspireLook(tile: MonsterTileMeta, seed: number, colours: string[]): TileLook {
  const r = lcg(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const spacing = Math.round(between(0, tile.maxSpacing[0] / 3));
  return {
    colours,
    stroke: Math.round(between(0.5, tile.maxStroke) * 2) / 2,
    scale: Math.round(between(2, Math.max(2, tile.maxScale / 3)) * 10) / 10,
    spacing: [tile.maxSpacing[0] > 0 ? spacing : 0, tile.maxSpacing[1] > 0 ? spacing : 0],
    angle: Math.round(between(0, 360) / 5) * 5,
    join: r() < 0.5 ? 1 : 2,
  };
}
