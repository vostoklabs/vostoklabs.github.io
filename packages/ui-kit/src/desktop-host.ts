/**
 * What a desktop app can do for a generator that a browser tab cannot.
 *
 * A generator receives one of these — or nothing at all, on the web — and every capability
 * it describes has a browser fallback the generator already implements. Save becomes a
 * JSON download, load becomes a file picker, export becomes a download, an imported font
 * lives until the tab is closed.
 *
 * The interface is declared here, in the shared kit, rather than in the host app, for one
 * reason: a generator must never import from the host. The moment it does, the web builds
 * stop working and the two codebases fork — and these generators are still live and still
 * free on the web, so a fork is two products to maintain instead of one.
 *
 * Structural typing does the rest. The host app builds an object that satisfies this; it
 * does not have to know this file exists.
 */

/** A file crossing the boundary, in the only shape both sides agree on. */
export interface HostFile {
  name: string;
  bytes: Uint8Array;
}

/** An asset a saved project carries: the image it was built from, an imported font. */
export interface HostAsset {
  role: string;
  /** Where the host put its own copy. Opaque to the generator. */
  path: string;
  originalName: string;
}

/** A saved project, as the host stores it. `params` is the generator's own state blob —
 *  the host never looks inside it. */
export interface HostProject {
  id: string;
  name: string;
  preview: string;
  params: unknown;
  assets: HostAsset[];
  createdAt: number;
  updatedAt: number;
}

export interface DesktopHost {
  saveProject(input: {
    id?: string;
    name: string;
    params: unknown;
    assets?: HostAsset[];
    /** `data:image/png;base64,…`, usually from the renderer's own canvas. */
    previewDataUrl?: string;
  }): Promise<HostProject>;
  loadProject(id: string): Promise<HostProject>;
  listProjects(): Promise<Omit<HostProject, 'params' | 'assets'>[]>;
  deleteProject(id: string): Promise<void>;

  /**
   * Copies a file the user brought in somewhere permanent, and says where.
   *
   * `kind` is a label for grouping, not a whitelist: a generator that starts importing
   * SVGs, colour profiles or 3MF modules passes its own word and the host stores it the
   * same way. Narrowing it to the two things today's generators import is how the next
   * generator ends up not remembering anything.
   */
  importAsset(kind: string, file: HostFile, ownerProjectId?: string): Promise<HostAsset>;
  readAsset(path: string): Promise<Uint8Array>;

  /**
   * What the user has imported before, newest use first. Optional — an older host has none.
   *
   * This is the shelf a local app can offer and a web page cannot: the photo traced last
   * week, the typeface imported for a different design. Omitting `kind` returns everything.
   */
  listMedia?(kind?: string): Promise<HostAsset[]>;

  /**
   * Turns a stored asset path into something an `<img>`, a `@font-face` or a `fetch` can
   * load. Optional — a generator falls back to the path itself.
   *
   * **A generator must never build this string itself.** Tauri serves its asset protocol as
   * `asset://localhost/…` on macOS and Linux and as `http://asset.localhost/…` on Windows,
   * so a hand-rolled copy is a silently broken image on one of the two platforms — which is
   * exactly what every "Open a project" thumbnail was, on Windows, for months.
   */
  assetUrl?(path: string): string;

  /**
   * A saved project the host wants opened as soon as the generator can accept one.
   *
   * Set when the user clicked a project rather than the generator's own tile. Optional, and
   * safe to ignore: on the web there is no host and so nothing to ask.
   */
  initialProjectId?(): string | undefined;

  /**
   * Opens a URL in the user's real browser. Optional.
   *
   * A desktop webview has no address bar, so a link that navigates it is a link that eats
   * the application. `bindExternalLinks` in `external-links.ts` is what routes every
   * outbound click here without any generator having to know which of its sentences
   * contains one.
   */
  openExternal?(url: string): void;

  /** Writes an exported model where the host wants it, and indexes it. */
  exportToLibrary(file: HostFile, opts?: { designer?: string }): Promise<{ path: string; indexed: boolean }>;

  /** Where this generator's bundled assets are served from. Replaces
   *  `import.meta.env.BASE_URL`, which is not the same string inside a host app. */
  assetBase(): string;

  /** Register a cleanup to run when the host unmounts the generator. */
  onBeforeUnmount(fn: () => void): void;
}

/** The entry point every generator exports once it can run inside a host. */
export type MountFn = (container: HTMLElement, host?: DesktopHost) => () => void;
