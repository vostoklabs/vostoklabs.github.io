/*
 * The MakerLab glue, as the shelf's `exportToHost` takes it ("MakerLab export"): one link for every
 * keycap export that goes to MakerLab, so each sends, waits for the handshake and reads a cancel
 * the same way. The glue behind `virtual:makerlab` is the MakerWorld build's; every other build
 * gets the stub in vite.config.js, whose `isEmbedded()` is false, so nothing here is ever sent.
 */
import {
  isEmbedded, isReady, can, initMakerlab, sdkExport, sdkToast, isExportCancelled, needsUpdate,
} from 'virtual:makerlab';

export const HOST_LINK = {
  isEmbedded,
  isReady,
  can,
  // The handshake mount.js started, while it is in flight or once it has connected; a fresh one
  // only if it failed or dropped.
  connect: () => initMakerlab(),
  send: (options) => sdkExport(options),
  isCancelled: isExportCancelled,
  hostToast: sdkToast,
  needsUpdate,
};

/**
 * Where `exportToHost` says what happened: a generator's status line (`setStatus(msg, kind)`,
 * kind '' or 'err') and the kit's toasts (`toast`, passed in so the node tests can stand it in).
 */
export function hostReport(setStatus, toast) {
  return {
    status: (text, kind) => setStatus(text, kind === 'error' ? 'err' : ''),
    toast: (text, kind) => toast(text, { kind }),
  };
}
