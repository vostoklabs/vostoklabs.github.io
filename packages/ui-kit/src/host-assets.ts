/**
 * The three lines every generator would otherwise write four times.
 *
 * A generator's import handlers are the place where the difference between the web build
 * and a hosted one is largest — on the web an imported font lives until the tab closes and
 * an imported image lives until the reload — and they are also the place where the
 * difference is easiest to forget, because everything still *works* without it. So the
 * remembering is a helper rather than a paragraph copied into each handler: one call, no
 * host check, no try/catch, and no behaviour at all when there is no host.
 *
 * Every function here is a no-op or an identity when the capability is missing, which is
 * what lets a generator built against a newer host keep running on an older one and keep
 * building for the web where there is no host at all.
 */
import type { DesktopHost, HostAsset, HostFile } from './desktop-host';

/**
 * Keeps a file the user just brought in, and says where it went.
 *
 * Call it the moment the bytes arrive — not when the project is saved. Save is a thing the
 * user can forget; importing is a thing they just did, and keeping on arrival is what makes
 * the *second* design free.
 *
 * Returns null when there is no host, when the host is too old to have `importAsset`, or
 * when the copy failed. A failed copy is deliberately quiet: the file is already decoded and
 * on screen, the design works, and interrupting someone mid-import to tell them about
 * next week is a worse trade than a line in the console.
 */
export async function rememberImport(
  host: DesktopHost | undefined,
  kind: string,
  file: HostFile,
): Promise<HostAsset | null> {
  if (!host?.importAsset) return null;
  try {
    return await host.importAsset(kind, file);
  } catch (err) {
    console.warn(`[host] "${file.name}" is usable now but could not be kept:`, err);
    return null;
  }
}

/**
 * `rememberImport` for a DOM `File` straight out of an input or a drop.
 *
 * The one-liner the import handlers actually want: `void rememberFile(host, 'image', f)`
 * next to the line that decodes it. Deliberately fire-and-forget — reading the bytes a
 * second time costs nothing next to decoding and tracing an image, and the design must not
 * wait on a copy that only matters next week.
 */
export async function rememberFile(
  host: DesktopHost | undefined,
  kind: string,
  file: File,
): Promise<HostAsset | null> {
  if (!host?.importAsset) return null;
  try {
    return await rememberImport(host, kind, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (err) {
    console.warn(`[host] "${file.name}" could not be read a second time to keep:`, err);
    return null;
  }
}

/** `rememberImport` for something already in memory as bytes rather than as a File. */
export async function rememberBytes(
  host: DesktopHost | undefined,
  kind: string,
  name: string,
  bytes: Uint8Array | ArrayBuffer,
): Promise<HostAsset | null> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return rememberImport(host, kind, { name, bytes: view });
}

/**
 * A stored path, as something the DOM can load.
 *
 * Falls back to the path itself, which is what a browser build wants and what an older host
 * gets. See the note on `assetUrl` in `desktop-host.ts` for why a generator must not write
 * the protocol out by hand.
 */
export function hostAssetUrl(host: DesktopHost | undefined, path: string): string {
  return host?.assetUrl?.(path) ?? path;
}

/** Media the user imported before, or an empty list when the host cannot offer any. */
export async function hostMedia(
  host: DesktopHost | undefined,
  kind?: string,
): Promise<HostAsset[]> {
  if (!host?.listMedia) return [];
  try {
    return await host.listMedia(kind);
  } catch {
    return [];
  }
}
