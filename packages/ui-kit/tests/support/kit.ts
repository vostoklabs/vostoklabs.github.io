/*
  What a mount test hands an app in place of `@vostok/ui-kit` (mounted.mjs swaps it in).

  The kit's behaviour is the kit's own, imported from its source: the build loop, the worker
  transport, the store and the project-file reader are exactly what the app runs in a browser,
  because they are what a mount test is testing. Its chrome is not: a toast, the licence nudge, a
  dialog are recorded in `kit` for the test to read back, and a control is a bare element.

  Of the chrome, only what some app's mount test needs is here. An app whose mount imports
  something missing fails to bundle, naming it, and the answer is to add it here, once, for
  every app.
*/
import { FakeElement } from './dom';

export { buildLoop, workerClient, answerRequests, NothingBuiltError, BuildTimeoutError } from '../../src/build-loop';
export { createStore } from '../../src/store';
export { markProject, readProjectFile } from '../../src/components/project-file';
// Data, not chrome: the filament shelf an app offers is the kit's own list.
export { FILAMENTS } from '../../src/components/filament';

/** What the app asked of the kit's chrome, oldest first. */
export const kit = {
  toasts: [] as { message: string; kind?: string }[],
  /** One entry per `licenseAfterExport()`: invariant #3's nudge, one per export. */
  licence: [] as unknown[],
  dialogs: [] as unknown[],
};

export function resetKit() {
  kit.toasts.length = 0;
  kit.licence.length = 0;
  kit.dialogs.length = 0;
}

export function toast(message: string, opts: { kind?: string } = {}) {
  kit.toasts.push({ message, kind: opts.kind });
}
export function licenseAfterExport(opts?: unknown) {
  kit.licence.push(opts ?? {});
}
export function dialog(opts: unknown) {
  kit.dialogs.push(opts);
  return { close() {}, root: new FakeElement() };
}
export const closeAllDialogs = () => {};
export const promptDialog = async () => null;
export const isDesktop = () => false;
export const bindExternalLinks = () => {};
export const applyTheme = () => {};
export const hostAssetUrl = (_host: unknown, path: string) => path;
export const rememberFile = async () => {};
export const chooseFile = async () => null;
export const topbarLinks = () => new FakeElement('header');
export const listRow = () => new FakeElement('button');
export const stageHandle = () => Object.assign(new FakeElement('button'), { setLabel() {}, place() {} });
