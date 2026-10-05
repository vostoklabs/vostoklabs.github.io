// @vostok/laser — the engine under every laser tool: what a cut file is made of and how to
// make one.
//
// Ops, rings, 2D CSG, blanks, keyring, text, burn palette and materials. Units are
// millimetres, Y up, throughout. The image tracer is `@vostok/trace`.

export type { Op, Shapes, Keyring, KeychainParams } from './types';
export { DEFAULT_KEYRING } from './types';

export { OPS, OP_ORDER, type OpSpec } from './ops';

export {
  signedArea,
  bboxOf,
  cancelCoincidentRings,
  mapShapes,
  centreShapes,
  placeShapes,
  mirrorX,
  simplifyRing,
  circleRing,
  filletRing,
  roundedRectRing,
  teardropRing,
  dogTagRing,
  type Pt,
  type Box,
} from './rings';

export {
  withScope,
  toCS,
  fromCS,
  csOf,
  ringsOf,
  offsetShapes,
  unionShapes,
  subtractShapes,
  intersectShapes,
  applyKeyring,
  buildKeychainProfile,
  type Keep,
} from './csg2d';

export {
  BLANKS,
  CATEGORY_LABELS,
  blankById,
  cornerLabel,
  buildBlank,
  blankThumb,
  blankSilhouette,
  polygonRing,
  starRing,
  ellipseRing,
  heartRing,
  lugRing,
  textBoxOf,
  carrotRootRing,
  carrotLeaves,
  fishBodyRing,
  fishExtras,
  cloudRing,
  eggRing,
  bowKnotRing,
  bowLoops,
  catEars,
  bunnyEars,
  bearEars,
  dogEars,
  faceMarks,
  blankDetail,
  strokeRing,
  seamArc,
  roundPolygonRing,
  footballLaces,
  basketballSeams,
  soccerSeams,
  baseballSeams,
  tennisSeam,
  houseChimneyRing,
  houseChimneyExtras,
  houseDoorWindows,
  baubleRing,
  baubleStripes,
  treeRing,
  treeApexBoss,
  snowflakeHubRing,
  snowflakeArms,
  scallopDiscRing,
  shieldRing,
  swingTagRing,
  ribbonRing,
  pennantRing,
  leafRing,
  type DetailSpec,
  type BlankDef,
  type BlankParams,
  type BlankCategory,
  type HoleSide,
} from './blanks';

export { edgePoint, holeCentre, nearestEdge } from './keyring';

export { buildText, buildSymbol, islandsFromContours, DEFAULT_TEXT, type TextParams } from './text';

export { burnStyle, type BurnStyle } from './burn';
export { MATERIALS, materialById, SHEET_PRESETS, presetById, type Material, type SheetPreset } from './sheets';
