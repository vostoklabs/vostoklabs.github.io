// @vostok/patterns — repeating patterns as laser geometry.
//
//   import { PATTERNS, patternById, fillShape } from '@vostok/patterns';
//   const disc = [[circle(0, 0, 45)]];
//   const r = fillShape(disc, patternById('honeycomb')!, { op: 'cut', params: { size: 8, gap: 2 }, web: 2 });
//   r.shapes  → the holes to punch (each its own island)   r.paths → open runs (score lines, hinge slits)
//
// Pure TypeScript, no dependencies, millimetres, Y up. The pattern DEFINITIONS are maths —
// no traced artwork — so nothing here carries a licence into a customer's export. Imported
// SVG tiles (./library) carry their own `source`.

export type {
  Box,
  FillOptions,
  FillResult,
  FillStats,
  Island,
  LatticeCut,
  LatticeStats,
  ParamSpec,
  ParamValue,
  Params,
  PatternDef,
  PatternFamily,
  PatternGeometry,
  PatternOp,
  PatternSource,
  Polyline,
  Pt,
  Ring,
  Shapes,
} from './types';

export { fillShape, insetShapes, geometryBox } from './fill';
export { latticeOf, latticeFaces, strutBands, LATTICE_MIN_WIDTH, LATTICE_MIN_AREA, LATTICE_STATUS, THINNEST_WOOD, type LatticeHost, type LatticeResult, type LatticeSpec } from './lattice';
export { resolveParams, num, bool, str, number, toggle, select, SIZE, GAP, SPACING } from './params';
export { tileGeometry, MAX_CELLS } from './tiler';
export { PATTERNS, FAMILY_LABELS, patternById, patternsOf, registerPatterns } from './patterns/index';
export { fillSvg, thumbPath, OP_COLOUR } from './svg';
export { flattenPathData } from './svgpath';
export { svgTilePattern, type SvgTileSpec } from './library/svgtile';
export { tileSvg, tileLayers, inspireLook, surpriseValues, MONSTER_DARK, MONSTER_LIGHT, type MonsterTile, type MonsterTileMeta, type TileLook } from './library/tile-svg';
export {
  EdgeIndex,
  clipPolylines,
  clipRingsAsLines,
  clipToConvex,
  clipHoleToRegion,
  clipIslandToRegion,
  trimNearEdge,
  mergeLines,
  outlineOfRegions,
  chainSegments,
  dedupeIslands,
  dropNearDuplicates,
  sameRing,
} from './clip';
export {
  SQRT3,
  TAU,
  signedArea,
  bboxOfShapes,
  insideShapes,
  pointInRing,
  isConvex,
  nestRings,
  circle,
  arc,
  regularPolygon,
  hexagon,
  rect,
  roundedRect,
  slot,
  star,
  shrinkRing,
  mapShapes,
} from './geom';
export { rng } from './patterns/fields';
