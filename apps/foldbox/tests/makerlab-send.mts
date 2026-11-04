// What the screen says after one MakerLab export, for every answer the host can give.
//
// A cancel ends in MakerLab's own export window, which has already told the customer what
// happened. It is not a failure. The SDK can answer it or throw it, so both are run, and neither
// may leave an error on the status line or a toast, ours or the host's. A real failure is still
// said, a throw is never an unhandled rejection, and a host that does not answer in time is said
// so, with a late answer still reported.
//
// The host is a stand-in: `sendToMakerlab` takes the glue as plain functions, and 'CANCEL' is
// the stand-in's code (the SDK's own stay behind the glue).
//
// Run: pnpm --filter foldbox test:send

import { sendToMakerlab } from '../src/export/makerlabSend';
import type { HostExportResult } from '@vostok/export/makerlab';

let failures = 0;
let checks = 0;
const ok = (cond: boolean, msg: string, detail = '') => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${msg}${detail ? `  —  ${detail}` : ''}`);
  }
};

const CANCEL = 'CANCEL';
/** The glue's `isExportCancelled`, reading the stand-in's code the way the glue reads the SDK's. */
const isCancelled = (o: unknown) =>
  !!o && typeof o === 'object' && ((o as { code?: unknown }).code === CANCEL || (o as { errorCode?: unknown }).errorCode === CANCEL);

interface Said {
  sent: boolean;
  statuses: string[];
  toasts: string[];
  hostToasts: string[];
}

/** One export with the host answering `send`; what the screen said, and what it said later. */
async function answering(send: () => Promise<HostExportResult>, timeoutMs = 1000): Promise<Said> {
  const said: Said = { sent: false, statuses: [], toasts: [], hostToasts: [] };
  said.sent = await sendToMakerlab(
    send,
    { isCancelled, hostToast: async (t) => void said.hostToasts.push(`${t.type}:${t.message}`) },
    { status: (text, kind) => void said.statuses.push(`${kind}:${text}`), toast: (text, kind) => void said.toasts.push(`${kind}:${text}`) },
    'the 3MF',
    timeoutMs,
  );
  return said;
}
const told = (s: Said) => `${s.statuses.join(' | ')}; toasts ${JSON.stringify(s.toasts)}; host ${JSON.stringify(s.hostToasts)}`;
const quiet = (s: Said) =>
  !s.sent && s.statuses.at(-1) === 'idle:Export cancelled' && !s.statuses.some((t) => t.startsWith('error:'))
    && !s.toasts.length && !s.hostToasts.length;

// ---- a cancel, either way the SDK says it ----
const answered = await answering(async () => ({ success: false, errorCode: CANCEL, errorMessage: 'cancelled' }));
ok(quiet(answered), 'a cancel answered: a quiet "Export cancelled", no error, no toast', told(answered));
const thrown = await answering(async () => {
  throw Object.assign(new Error('cancelled'), { code: CANCEL });
});
ok(quiet(thrown), 'a cancel thrown: the same, quiet', told(thrown));

// ---- sent ----
const sent = await answering(async () => ({ success: true, format: 'obj' }));
ok(sent.sent && sent.statuses.at(-1) === 'idle:Exported the 3MF to MakerLab' && sent.hostToasts.join() === 'success:Exported the 3MF' && !sent.toasts.length,
  'sent: said on the status line and in the host\'s success toast', told(sent));

// ---- a real failure is still said ----
const failed = await answering(async () => ({ success: false, errorCode: 'EXPORT_FAILED', errorMessage: 'the host could not build the 3MF' }));
ok(!failed.sent && failed.statuses.at(-1) === 'error:Export failed: the host could not build the 3MF'
  && failed.hostToasts.join() === 'error:Export failed' && failed.toasts.join() === 'error:Export failed: the host could not build the 3MF',
  'a failure answered: an error on the status line, the host\'s error toast and ours', told(failed));
const broke = await answering(async () => {
  throw new Error('MakerLab SDK not ready');
});
ok(!broke.sent && broke.statuses.at(-1) === 'error:Export failed: MakerLab SDK not ready',
  'anything else thrown: a failure too, and sendToMakerlab still resolves', told(broke));

// ---- no answer in time, then a late one ----
const late = (answer: HostExportResult) => () => new Promise<HostExportResult>((resolve) => setTimeout(() => resolve(answer), 40));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const slowCancel = await answering(late({ success: false, errorCode: CANCEL }), 5);
ok(!slowCancel.sent && slowCancel.statuses.at(-1)?.startsWith('error:MakerLab has not answered'), 'no answer in time: said so', told(slowCancel));
const toastsAtTimeout = slowCancel.toasts.length;
await wait(80);
ok(slowCancel.statuses.at(-1) === 'idle:Export cancelled' && slowCancel.toasts.length === toastsAtTimeout && !slowCancel.hostToasts.length,
  'a late cancel: the status line goes quiet, and no toast follows', told(slowCancel));
const slowSent = await answering(late({ success: true, format: 'zip' }), 5);
await wait(80);
ok(slowSent.statuses.at(-1) === 'idle:Exported the 3MF to MakerLab' && slowSent.toasts.at(-1) === 'ok:MakerLab answered after all: exported the 3MF.',
  'a late success: reported, not contradicted', told(slowSent));

console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `all ${checks} MakerLab send checks pass`);
process.exit(failures ? 1 : 0);
