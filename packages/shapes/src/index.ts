// @vostok/shapes — shape maths: rings and islands in millimetres, Y up.
//
// Area and winding, bounds, point-in-shape, distances, moving and mirroring, simplifying,
// nesting loose rings into islands, the widest point inside a shape, and the basic outlines
// (circle, rounded rectangle, polygon, star, slot, teardrop...). Pure TypeScript with no
// dependencies, no DOM and no WASM: the laser engine, the pattern engine and the 3D apps all
// build on it, so nothing here knows about a machine, a screen or a file.
//
// The laser engine's ring maths (`@vostok/laser/rings`) and the pattern engine's geometry moved
// here as they were; both packages still hand these out under their old names.

export type { Box, Island, Polyline, Pt, Ring, Shapes, SizedBox } from './types';

export {
  signedArea,
  bboxOf,
  ringBox,
  mapShapes,
  centreShapes,
  placeShapes,
  mirrorX,
  simplifyRing,
  circleRing,
  roundedRectRing,
  teardropRing,
  dogTagRing,
  cancelCoincidentRings,
  islandsFromContours,
  filletRing,
} from './rings';

export {
  TAU,
  SQRT3,
  signedAreaClosingFirst,
  ringLength,
  bboxOfPoints,
  bboxOfShapes,
  boxValid,
  boxCentre,
  pointInRing,
  insideShapes,
  pointSegmentDistance,
  segmentCrossing,
  segmentsIntersect,
  segmentDistance,
  isConvex,
  shrinkRing,
  circleSegments,
  circle,
  arc,
  regularPolygon,
  hexagon,
  rect,
  roundedRect,
  slot,
  star,
  seg,
  nestRings,
  poleOf,
} from './geom';
