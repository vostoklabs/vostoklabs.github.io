// Entry point for the headless render harness (scripts/render-topper.mjs), so the
// harness exercises the REAL geometry rather than a copy of it. Not imported by the
// app, and deliberately free of anything DOM- or Vite-shaped.
export { buildProfiles, buildTopper } from './buildTopper';
export { getHorizontalContours, getVerticalContours } from '@vostok/fonts/textLayout';
export { noAmsPauses } from './noAms';
export { identityVoids } from './identityMark';
export { DEFAULT_SETTINGS, boreFor, gripFor, interferenceFor, ribHeightForFit, FIT_RIB_OFFSET_MM, BORE_CLEARANCE_MM, PEN_PRESETS } from '../state';
// The export path too, so the harness can unzip a real 3MF rather than trust that
// the Download button did the right thing.
export { buildThreeMF } from '@vostok/export';
// The plate packer too, so a set's layout can be checked without a browser.
export { packShelf, packFits, plateSize } from '@vostok/plates';
