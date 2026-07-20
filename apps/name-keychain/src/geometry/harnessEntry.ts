// Entry point bundled by scripts/harness.mjs so the headless harness runs the
// real geometry code. Not imported by the app.
export { buildProfiles, buildKeychain } from './buildKeychain';
export { getHorizontalContours, getVerticalContours } from './textLayout';
export { noAmsPauses } from './noAms';
