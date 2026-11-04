// One `export()` to MakerLab, and what the screen says became of it.
//
// The host's answer is read by the shelf's `settleExport` ("MakerLab export"): sent, cancelled,
// failed, thrown, or nothing within a minute. A cancel is recognised by the glue's
// `isExportCancelled` whether it comes back as an answer or as a throw. What is said about each
// outcome is this app's. Pure but for the functions it is handed, so node checks it
// (tests/makerlab-send.mts).

import {
  EXPORT_TIMEOUT_MS,
  settleExport,
  type HostExportResult,
  type HostLink,
  type HostReport,
} from '@vostok/export/makerlab';

/** Send one export and say what happened. Resolves true when the host took it, and never
 *  rejects, so the export buttons always come back.
 *
 *  `sdk.export` has no timeout of its own: it waits for the host for ever. The kit's export
 *  panel re-enables its buttons only in a `finally`, so a host that never answered would leave
 *  both greyed. At `timeoutMs` the UI comes back and says honestly that it does not know, and a
 *  late answer is still reported rather than contradicted.
 *
 *  A cancel ends in MakerLab's own export window, which has already told the customer what
 *  happened. It is not a failure, so it gets a quiet status line, no toast and no retry. `what`
 *  names the file in those lines ("the 3MF"). */
export async function sendToMakerlab(
  send: () => Promise<HostExportResult>,
  link: Pick<HostLink, 'isCancelled' | 'hostToast'>,
  report: HostReport,
  what: string,
  timeoutMs = EXPORT_TIMEOUT_MS,
): Promise<boolean> {
  report.status('Sending to MakerLab…', 'idle');
  const first = await settleExport(send, link.isCancelled, timeoutMs);

  if (first.kind === 'timeout') {
    void first.late.then((late) => {
      if (late.kind === 'sent') {
        report.status(`Exported ${what} to MakerLab`, 'idle');
        report.toast(`MakerLab answered after all: exported ${what}.`, 'ok');
      } else if (late.kind === 'cancelled') {
        report.status('Export cancelled', 'idle');
      } else {
        report.status(`Export failed: ${late.why}`, 'error');
      }
    });
    const msg =
      'MakerLab has not answered. Check MakerLab’s own export window, or reload the MakerWorld page and try again.';
    report.status(msg, 'error');
    report.toast(msg, 'error');
    return false;
  }

  if (first.kind === 'sent') {
    report.status(`Exported ${what} to MakerLab`, 'idle');
    void link.hostToast({ message: `Exported ${what}`, type: 'success' });
    return true;
  }
  if (first.kind === 'cancelled') {
    report.status('Export cancelled', 'idle');
    return false;
  }
  report.status(`Export failed: ${first.why}`, 'error');
  void link.hostToast({ message: 'Export failed', type: 'error' });
  report.toast(`Export failed: ${first.why}`, 'error');
  return false;
}
