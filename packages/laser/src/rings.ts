// The laser engine's ring maths moved to @vostok/shapes, the shape-maths core every engine
// builds on. This door hands it on under the same names, so `@vostok/laser/rings` and the
// engine's own files import exactly what they did. New code imports @vostok/shapes.
export { signedArea, bboxOf, cancelCoincidentRings, islandsFromContours, simplifyRing } from '@vostok/shapes';
export { mapShapes, centreShapes, placeShapes, mirrorX } from '@vostok/shapes';
export { circleRing, filletRing, roundedRectRing, teardropRing, dogTagRing } from '@vostok/shapes';
export type { Pt, Box } from '@vostok/shapes';
