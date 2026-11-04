/*
  "MakerLab export", in node: everything but the two functions that need a page.

    pnpm --filter @vostok/export check

  The host is a stand-in here: `exportToHost` takes the app's glue as plain functions, so each
  answer the host can give is driven directly and the words the app shows are read back.
*/
import { unzipSync, strFromU8 } from 'fflate';
import {
  MAX_STEM, cutExport, cutFileStem, cutZip, clampDescription, exportToHost, modelArtifact, modelExport, settleExport,
  thickenStrokes, type HostExportOptions, type HostExportResult, type HostLink, type HostObjArtifact,
} from '../src/makerlab';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---- names, descriptions, the call ----
check('a stem is cut to MAX_STEM with no dangling separator', cutFileStem(`${'a'.repeat(MAX_STEM - 1)}-xyz`, 'f') === 'a'.repeat(MAX_STEM - 1));
check('an empty stem falls back', cutFileStem('--', 'laser-box') === 'laser-box');
check('a long description is clamped to 1000', clampDescription('x'.repeat(2000)).length === 1000);
const call = cutExport({ fileName: 'a.zip', buffer: new ArrayBuffer(1), coverImage: 'data:', description: 'd' });
check('a cut file goes out as one 2D zip artifact', call.printerType === '2D' && call.artifacts.length === 1 && call.artifacts[0]!.format === 'zip');

// ---- a 3D model: the OBJ the host makes the 3MF from ----
const text = (b: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(b));
const model = modelArtifact({ fileName: 'frame.obj', obj: 'o a\nv 0 0 0', mtl: 'newmtl m', coverImage: 'data:', description: 'x'.repeat(2000) });
check('one plate: one buffer holding the OBJ text', model.format === 'obj' && !Array.isArray(model.buffer) && text(model.buffer) === 'o a\nv 0 0 0' && model.mtl === 'newmtl m');
check('a model description is clamped to 1000', model.description!.length === 1000);
check('mergeObj is left out unless asked for', !('mergeObj' in model) && !('mergeObj' in modelArtifact({ fileName: 'f.obj', obj: '', mtl: '', coverImage: '', description: '', mergeObj: false })));
const plates = modelArtifact({ fileName: 'f.obj', obj: ['o top', 'o body'], mtl: '', coverImage: '', description: '', mergeObj: true, printConfig: { layerHeight: '0.2', plates: [{}, { enableSupport: '1' }] } });
check('plates: one buffer a plate, in order', Array.isArray(plates.buffer) && plates.buffer.length === 2 && text(plates.buffer[1]!) === 'o body');
check('mergeObj and printConfig go out as given', plates.mergeObj === true && plates.printConfig?.layerHeight === '0.2' && plates.printConfig?.plates?.[1]?.enableSupport === '1');
const modelCall = modelExport({ fileName: 'f.obj', obj: 'o a', mtl: '', coverImage: '', description: '' });
check('a model goes out as one artifact with no printer type (the host asks for the printer)', !('printerType' in modelCall) && modelCall.artifacts.length === 1 && (modelCall.artifacts[0] as HostObjArtifact).format === 'obj');

// ---- the zip, one file or one per sheet ----
const one = unzipSync(new Uint8Array(cutZip({ svg: '<svg/>', svgName: 'box.svg', readme: 'R' })));
check('one SVG + README', Object.keys(one).sort().join() === 'README.txt,box.svg' && strFromU8(one['README.txt']!) === 'R');
const many = unzipSync(new Uint8Array(cutZip({ files: { 'b-sheet-1.svg': '<svg/>', 'b-sheet-2.svg': '<svg/>' }, readme: 'R' })));
check('one SVG a sheet + README', Object.keys(many).sort().join() === 'README.txt,b-sheet-1.svg,b-sheet-2.svg');

// ---- the cover's strokes ----
const sheet = '<svg viewBox="0 0 290 210"><path stroke-width="0.025"/><path stroke-width="9"/></svg>';
const thick = thickenStrokes(sheet, 512, 1.5);
const widths = [...thick.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
const scale = (512 * 0.88) / 290;
check('a hairline is drawn at least strokePx wide in the cover', Math.abs(widths[0]! * scale - 1.5) < 0.01, `${(widths[0]! * scale).toFixed(3)} px`);
check('a line already wide enough is left alone', widths[1] === 9);
check('no viewBox: the SVG is returned as it is', thickenStrokes('<svg><path stroke-width="0.025"/></svg>', 512, 1.5) === '<svg><path stroke-width="0.025"/></svg>');

// ---- settleExport ----
const cancelled = (o: unknown) => (o as { errorCode?: string; code?: string })?.errorCode === 'CANCEL' || (o as { code?: string })?.code === 'CANCEL';
const ok: HostExportResult = { success: true, format: 'zip' };
check('sent', (await settleExport(async () => ok, cancelled, 1000)).kind === 'sent');
check('cancelled, resolved', (await settleExport(async () => ({ success: false, errorCode: 'CANCEL' }), cancelled, 1000)).kind === 'cancelled');
check('cancelled, thrown', (await settleExport(async () => { throw { code: 'CANCEL' }; }, cancelled, 1000)).kind === 'cancelled');
const failed = await settleExport(async () => { throw new Error('boom'); }, cancelled, 1000);
check('a throw is a failure with its message', failed.kind === 'failed' && failed.why === 'boom');
const slow = await settleExport(() => new Promise<HostExportResult>((r) => setTimeout(() => r(ok), 60)), cancelled, 10);
check('no answer in time is a timeout, and the late answer still arrives', slow.kind === 'timeout' && (await slow.late).kind === 'sent');

// ---- exportToHost ----
function stand(over: Partial<HostLink<HostExportOptions>> = {}) {
  const said: string[] = [];
  const toasts: string[] = [];
  const hostToasts: string[] = [];
  let made = 0;
  const link: HostLink<HostExportOptions> = {
    isEmbedded: () => true, isReady: () => true, can: () => true, connect: async () => null,
    send: async () => ok, isCancelled: cancelled,
    hostToast: async (o) => { hostToasts.push(o.message); },
    ...over,
  };
  const report = { status: (t: string) => { said.push(t); }, toast: (t: string) => { toasts.push(t); } };
  const make = async (): Promise<HostExportOptions> => { made++; return call; };
  return { link, report, make, said, toasts, hostToasts, made: () => made };
}
{
  const s = stand();
  const sent = await exportToHost(s.link, s.report, s.make);
  check('sent: true, the status says so, the host toasts', sent && s.said.at(-1) === 'Sent the cut file to MakerLab' && s.hostToasts[0] === 'Exported the cut file');
}
{
  let ready = false;
  const s = stand({ isReady: () => ready, connect: async () => { ready = true; return {}; } });
  check('not ready: waits for the handshake, then sends', await exportToHost(s.link, s.report, s.make) && s.said[0] === 'Connecting to MakerLab…');
}
{
  const s = stand({ isReady: () => false });
  const sent = await exportToHost(s.link, s.report, s.make);
  check('never connects: nothing is made, the page reload is named', !sent && s.made() === 0 && /Reload the whole MakerWorld page/.test(s.toasts[0] ?? ''));
}
{
  const s = stand({ send: async () => ({ success: false, errorCode: 'CANCEL' }) });
  const sent = await exportToHost(s.link, s.report, s.make);
  check('cancelled: quiet — a status line, no toast anywhere', !sent && s.said.at(-1) === 'Export cancelled' && !s.toasts.length && !s.hostToasts.length);
}
{
  const s = stand({ send: async () => { throw new Error('nope'); } });
  const sent = await exportToHost(s.link, s.report, s.make);
  check('failed: both toasts, the reason on the status line', !sent && s.said.at(-1) === 'Export failed: nope' && s.toasts.length === 1 && s.hostToasts[0] === 'Export failed');
}
{
  const s = stand({ send: async () => ({ success: false, errorCode: 'CANCEL' }) });
  s.make = async () => modelCall;
  const sent = await exportToHost(s.link, s.report, s.make, { what: 'the model' });
  check('a model cancelled (or out of exports): quiet as well', !sent && s.said.at(-1) === 'Export cancelled' && !s.toasts.length && !s.hostToasts.length);
}
{
  const s = stand();
  s.make = async () => modelCall;
  check('a model sent: named as the model', await exportToHost(s.link, s.report, s.make, { what: 'the model' }) && s.said.at(-1) === 'Sent the model to MakerLab' && s.hostToasts[0] === 'Exported the model');
}
{
  const s = stand({ isReady: () => false, needsUpdate: () => true });
  const sent = await exportToHost(s.link, s.report, s.make);
  check('an SDK the host has outgrown: says the app needs an update, not reload', !sent && s.made() === 0 && /needs an update/.test(s.toasts[0] ?? '') && !/Reload/.test(s.toasts[0] ?? ''));
}
{
  const s = stand({ isReady: () => false, needsUpdate: () => false });
  await exportToHost(s.link, s.report, s.make);
  check('needsUpdate false: the reload message as before', /Reload the whole MakerWorld page/.test(s.toasts[0] ?? ''));
}

console.log(`\n${pass}/${pass + fails.length} checks passed`);
if (fails.length) process.exit(1);
