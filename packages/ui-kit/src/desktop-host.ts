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

  /** Copies a file the user brought in somewhere permanent, and says where. */
  importAsset(kind: 'font' | 'image', file: HostFile, ownerProjectId?: string): Promise<HostAsset>;
  readAsset(path: string): Promise<Uint8Array>;

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
