// A cut file sent to MakerLab instead of downloaded: the zip artifact, its cover, its name, and
// the one call that hands it over and says what became of it.
//
// Every laser app with a MakerLab build sends the same thing — one zip holding the SVG and a
// README of what each colour does, as a 2D export — so the shape of that call lives here, once.
// The app keeps only what is its own: what goes in the README, and the words around its design.
//
// The host itself stays behind each app's glue (`virtual:makerlab`), which this file never
// imports: `exportToHost` takes the glue's functions as a `HostLink`, so the public build, which
// has no glue, compiles and bundles none of it. Everything but `coverDataUrl` and `exportToHost`
// is pure and runs in node.

import { BRAND } from '@vostok/brand';
import { buildZip, bytesToArrayBuffer } from './index';

/** One zip artifact, as the host takes it. */
export interface HostZipArtifact {
  fileName: string;
  format: 'zip';
  buffer: ArrayBuffer;
  /** A PNG or JPEG data URL. */
  coverImage: string;
  description?: string;
}

/** The whole export call. `'2D'` is a cut file: no FDM printer to pick. */
export interface HostExportOptions {
  printerType?: '2D' | '3D';
  artifacts: HostZipArtifact[];
}

/** What the host answered. */
export type HostExportResult =
  | { success: true; format: string }
  | { success: false; errorCode: string; errorMessage?: string };

/** A 1x1 transparent PNG, for when the cover render fails: a blank thumbnail is cosmetic, the
 *  cut file is not, so a cover that will not draw never throws an export away. */
export const BLANK_COVER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Longest description the export sends. */
export const MAX_DESCRIPTION = 1000;

export function clampDescription(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}

/** Longest file name the export sends. */
export const MAX_FILE_NAME = 255;

/** The longest stem a cut file is named with, well under `MAX_FILE_NAME` on purpose. The stem
 *  can be the customer's own text, and it names two files: the zip and the SVG in it. Windows
 *  unzips `<stem>.zip` into a folder of that name, so `Downloads\<stem>\<stem>.svg` would pass
 *  its 260-character path limit long before 255 did; at 100 it cannot. */
export const MAX_STEM = 100;

/** The one stem the zip AND the SVG inside it are named with: `stem` cut to `MAX_STEM` with no
 *  dangling separator, or `fallback` when nothing is left. */
export function cutFileStem(stem: string, fallback: string): string {
  const cut = (s: string) => s.slice(0, MAX_STEM).replace(/^[-_.\s]+|[-_.\s]+$/g, '');
  return cut(stem) || cut(fallback) || 'design';
}

/** The licence in one line, for the artifact's description and the README in the zip. The embed
 *  opens no links, so the licence is said in words wherever the file goes. */
export const HOST_LICENCE_NOTE = `Free for personal use; selling what you make from it requires a commercial license: ${BRAND.urls.mwCommercial}`;

/** The cut file, as the host's zip artifact. */
export function cutArtifact(input: {
  fileName: string;
  buffer: ArrayBuffer;
  coverImage: string;
  description: string;
}): HostZipArtifact {
  return {
    fileName: input.fileName,
    format: 'zip',
    buffer: input.buffer,
    coverImage: input.coverImage,
    description: clampDescription(input.description),
  };
}

/** The whole export call for a cut file. */
export function cutExport(input: Parameters<typeof cutArtifact>[0]): HostExportOptions {
  return { printerType: '2D', artifacts: [cutArtifact(input)] };
}

/** The zip the host receives: the cut file (or one file per sheet), plus the README. */
export function cutZip(input: { svg: string; svgName: string; readme: string } | { files: Record<string, string>; readme: string }): ArrayBuffer {
  const files = 'files' in input ? input.files : { [input.svgName]: input.svg };
  return bytesToArrayBuffer(buildZip({ ...files, 'README.txt': input.readme }));
}

/** What became of one `export()`, in the terms the UI reports it in. */
export type ExportOutcome =
  | { kind: 'sent' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; why: string };

/** A sentinel with its own identity, so a real outcome can never be mistaken for it. */
const TIMED_OUT = Symbol('makerlab-export-timeout');

/** Why an export failed, in words: the error's message, else its code, else what was thrown. */
function whyOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === 'string' && message) return message;
    if (typeof code === 'string' && code) return code;
  }
  return String(err);
}

/** Run one `export()` and say what became of it: `sent`, `cancelled` or `failed` — or, if the
 *  host has not answered within `timeoutMs`, `timeout`, with the outcome still to come in `late`.
 *
 *  Never rejects, whatever `send` does. A throw is an outcome like any other, so the export
 *  button always comes back. A cancel is recognised by `isCancelled` (the glue's
 *  `isExportCancelled`, which keeps the host's codes behind the glue), whether it comes back as
 *  an answer or as a throw.
 *
 *  The race exists because the kit's export panel re-enables its button only in a `finally`: an
 *  answer that never came would leave it greyed for good. `late` still settles if the host
 *  answers after the timeout. */
export async function settleExport(
  send: () => Promise<HostExportResult>,
  isCancelled: (outcome: unknown) => boolean,
  timeoutMs: number,
): Promise<ExportOutcome | { kind: 'timeout'; late: Promise<ExportOutcome> }> {
  const outcome = Promise.resolve()
    .then(send)
    .then((res): ExportOutcome =>
      res.success
        ? { kind: 'sent' }
        : isCancelled(res)
          ? { kind: 'cancelled' }
          : { kind: 'failed', why: res.errorMessage || res.errorCode || 'no reason given' })
    .catch((err: unknown): ExportOutcome =>
      isCancelled(err) ? { kind: 'cancelled' } : { kind: 'failed', why: whyOf(err) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  const first = await Promise.race([outcome, timedOut]);
  clearTimeout(timer);
  return first === TIMED_OUT ? { kind: 'timeout', late: outcome } : first;
}

/** The app's glue, as `exportToHost` needs it: `virtual:makerlab`'s functions, passed in. */
export interface HostLink {
  isEmbedded(): boolean;
  isReady(): boolean;
  can(capability: string): boolean;
  /** The glue's `initMakerlab`: the handshake in flight, or one fresh one if it failed. */
  connect(): Promise<unknown>;
  send(options: HostExportOptions): Promise<HostExportResult>;
  isCancelled(outcome: unknown): boolean;
  hostToast(options: { message: string; type?: 'success' | 'info' | 'warning' | 'error' }): Promise<void>;
}

/** Where `exportToHost` says what happened: the app's status line and its toasts. */
export interface HostReport {
  status(text: string, kind: 'idle' | 'busy' | 'error'): void;
  toast(text: string, kind: 'ok' | 'error'): void;
}

/** How long to wait for the host before the UI admits it does not know. */
export const EXPORT_TIMEOUT_MS = 60_000;

/** Send one export to MakerLab and say what happened. Resolves true when the host took it, and
 *  never rejects.
 *
 *  Connected first, or nothing is made: `link.connect()` waits for a handshake still in flight
 *  (a big package, a slow connection), or runs one fresh one if it failed or dropped. If that
 *  does not connect either, the message names the whole MakerWorld page on purpose, not just
 *  this panel.
 *
 *  Then `make()` builds the options, and `settleExport` reads every answer the host can give —
 *  sent, cancelled, failed, thrown, or nothing within `timeoutMs`. A cancel is the customer
 *  closing MakerLab's own export window, their choice, so it gets a quiet status line and no
 *  toast. On a timeout the status says honestly that it does not know, and a late answer still
 *  reports. `what` names the file in those lines ("the cut file"). */
export async function exportToHost(
  link: HostLink,
  report: HostReport,
  make: () => Promise<HostExportOptions>,
  opts: { what?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  const what = opts.what ?? 'the cut file';
  const connected = () => link.isReady() && link.can('export');
  if (!connected()) {
    if (link.isEmbedded()) {
      report.status('Connecting to MakerLab…', 'busy');
      await link.connect();
    }
    if (!connected()) {
      const msg = 'Not connected to MakerLab, so the file cannot be sent. Reload the whole MakerWorld page, not just this panel, and try again.';
      report.status(msg, 'error');
      report.toast(msg, 'error');
      return false;
    }
  }

  const options = await make();
  report.status('Sending to MakerLab…', 'busy');
  const first = await settleExport(() => link.send(options), link.isCancelled, opts.timeoutMs ?? EXPORT_TIMEOUT_MS);

  if (first.kind === 'timeout') {
    void first.late.then((late) => {
      if (late.kind === 'sent') {
        report.status(`Sent ${what} to MakerLab`, 'idle');
        report.toast(`MakerLab answered after all: ${what} is sent.`, 'ok');
      } else if (late.kind === 'cancelled') {
        report.status('Export cancelled', 'idle');
      } else {
        report.status(`Export failed: ${late.why}`, 'error');
      }
    });
    const msg = 'MakerLab has not answered. Check MakerLab’s own export window, or reload the MakerWorld page and try again.';
    report.status(msg, 'error');
    report.toast(msg, 'error');
    return false;
  }
  if (first.kind === 'sent') {
    report.status(`Sent ${what} to MakerLab`, 'idle');
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

/** The cover's margin, as a share of its edge. */
const COVER_PAD = 0.06;

/** `svg` with every `stroke-width` raised to at least `px` pixels once the drawing is fitted
 *  into an `edge`-pixel cover, read from its viewBox. A file with no viewBox is returned as it
 *  is. Pure, so node can check it. */
export function thickenStrokes(svg: string, edge: number, px: number): string {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (!vb) return svg;
  const room = edge * (1 - COVER_PAD * 2);
  const scale = Math.min(room / Number(vb[1]), room / Number(vb[2]));
  if (!(scale > 0) || !Number.isFinite(scale)) return svg;
  const min = px / scale;
  return svg.replace(/stroke-width="([\d.]+)"/g, (whole, w: string) =>
    Number(w) >= min ? whole : `stroke-width="${min.toFixed(3)}"`);
}

/** A cover for the artifact: the export itself, rasterised — a picture of the file in the zip,
 *  not of whatever the viewport was left showing.
 *
 *  On a white ground on purpose: the file's cuts are red and its engraves black on nothing, and
 *  over the host's dark library card black on transparency is a picture of nothing at all.
 *
 *  `strokePx` draws every line at least that many pixels wide in the cover. A cut file's lines
 *  are hairlines, and a whole sheet shrunk to `edge` pixels turns a file of nothing but cuts — a
 *  box — into a blank square. Only the cover's copy is changed, never the file. Left out, the
 *  file is drawn as it is.
 *
 *  Never throws: a cover that will not render falls back to `BLANK_COVER`. */
export async function coverDataUrl(svg: string, edge = 512, opts: { strokePx?: number } = {}): Promise<string> {
  try {
    if (opts.strokePx) svg = thickenStrokes(svg, edge, opts.strokePx);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('the export SVG would not rasterise'));
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = edge;
      canvas.height = edge;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, edge, edge);
      // Fit the artwork inside a small margin, keeping its aspect: a long piece must not be
      // stretched square, and a square cover is what the host's grid lays out.
      const w = img.naturalWidth || edge;
      const h = img.naturalHeight || edge;
      const pad = edge * COVER_PAD;
      const scale = Math.min((edge - pad * 2) / w, (edge - pad * 2) / h);
      ctx.drawImage(img, (edge - w * scale) / 2, (edge - h * scale) / 2, w * scale, h * scale);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('[makerlab] the cover render failed; exporting with a blank cover.', err);
    return BLANK_COVER;
  }
}
