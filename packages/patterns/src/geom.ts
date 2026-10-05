// The pattern engine's geometry moved to @vostok/shapes, the shape-maths core every engine
// builds on. This door hands it on under the same names, so the engine's files import exactly
// what they did. `signedArea` here is the engine's own order of summing an area
// (`signedAreaClosingFirst`), which it has always used, not the laser engine's.
export { TAU, SQRT3, signedAreaClosingFirst as signedArea, ringLength, isConvex, nestRings, poleOf } from '@vostok/shapes';
export { bboxOfPoints, bboxOfShapes, boxValid, boxCentre, pointInRing, insideShapes } from '@vostok/shapes';
export { pointSegmentDistance, segmentCrossing, segmentsIntersect, segmentDistance, mapShapes, shrinkRing } from '@vostok/shapes';
export { circleSegments, circle, arc, regularPolygon, hexagon, rect, roundedRect, slot, star, seg } from '@vostok/shapes';
