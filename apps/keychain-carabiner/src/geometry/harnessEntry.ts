// Entry point for the headless render harness (scripts/render-carabiner.mjs), so the
// harness exercises the REAL geometry rather than a copy of it. Not imported by the app,
// and deliberately free of anything DOM- or Vite-shaped.
export { buildSet, SWIVEL_MIN_THICK } from './buildSet';
export { identityVoids } from './identityMark';
export { BUILTIN_SHAPES } from '../shapes/builtin';
export { pathToRing } from '../shapes/svgShape';
export { frameAt, perimeter, normalize, tAtAngle } from '../shapes/ring';
export { DEFAULT_SETTINGS, GATE_GAP_MM } from '../state';
export { pathCommandsToPolygons } from '@vostok/fonts/textLayout';
export { buildThreeMF } from '@vostok/export';
export { pipGeometry, pipLevels, pipLayout, pipMesh, pipFeatures, overlapAlong, at as pipAt } from './pipChain';
