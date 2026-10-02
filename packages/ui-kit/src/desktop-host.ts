/**
 * What an embedding host can do for a generator that a browser tab cannot.
 *
 * A generator receives one of these — or nothing at all, on the web — and every capability
 * it describes has a browser fallback the generator already implements. Save becomes a
 * JSON download, load becomes a file picker, export becomes a download, an imported font
 * lives until the tab is closed.
 *
 * The interface is declared here, in the shared kit, rather than in any host, for one
 * reason: a generator must never import from the host. The moment it does, the web builds
 * stop working and the codebase forks.
 *
 * Structural typing does the rest. A host builds an object that satisfies this; it does not
 * have to know this file exists.
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

/**
 * What a generator hands over when it lets the host own its projects.
 *
 * Every generator already has these three under its own names — `buildProject` /
 * `applyProject` / `capturePreview` in one, `collectState` / `applyLoadedState` in another.
 * Naming them once is what lets one implementation of autosave, Save, Open, Rename and
 * Delete serve all of them, instead of each generator growing its own.
 */
export interface ProjectAdapter {
  /** The generator's own state blob — the same one its Save already sends. */
  getState(): unknown;
  /**
   * Put a blob back on screen. May be async: some generators re-decode an image first.
   *
   * `assets` is whatever `assets()` returned when this was stored. A generator that
   * imported a typeface has to re-register it here: parameters that restore without their
   * font come back in the wrong face, and nothing on screen says so.
   */
  applyState(state: unknown, assets?: HostAsset[]): void | Promise<void>;
  /** Files this design depends on, so they travel with it. */
  assets?(): HostAsset[];
  /** A `data:image/png;base64,…` from the generator's renderer, for the host's lists. */
  capturePreview?(): string | undefined;
  /** A starting point for the name field, e.g. the text being carved. */
  suggestName?(): string;
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
   * What the user has imported before, newest use first. Optional.
   *
   * Omitting `kind` returns everything.
   */
  listMedia?(kind?: string): Promise<HostAsset[]>;

  /**
   * Turns a stored asset path into something an `<img>`, a `@font-face` or a `fetch` can
   * load. Optional — a generator falls back to the path itself.
   *
   * **A generator must never build this string itself.** The URL form is the host's to
   * choose and can differ between platforms, so a hand-rolled copy can be a silently broken
   * image.
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
   * An embedded webview has no address bar, so a link that navigates it replaces the
   * generator. `bindExternalLinks` in `external-links.ts` is what routes every
   * outbound click here without any generator having to know which of its sentences
   * contains one.
   */
  openExternal?(url: string): void;

  /**
   * Hands the host everything it needs to own this generator's projects. Optional.
   *
   * A generator that calls this stops owning Save, Load, autosave and "which project am I
   * in" — the host draws all of it, in its own chrome, the same way for every generator it
   * hosts. Three functions the generator already has under its own names are the whole
   * price, and a generator that does not call it keeps every path it has today.
   *
   * **A generator that calls this must also tell its own Save/Load block to stand down**,
   * by passing `hostOwnsProjects` to `projectActions` / `sidebarFooter`. Two Save buttons
   * that do different things is worse than either one alone.
   */
  registerProject?(adapter: ProjectAdapter): void;

  /**
   * Opens the host's own file picker and resolves with the chosen file, or null. Optional.
   *
   * Called from a generator's own import affordance. On the web there is no host, and
   * `chooseFile` in `host-assets.ts` falls back to the file input the generator has always
   * had.
   */
  pickMedia?(opts?: { kind?: string; extensions?: string[] }): Promise<HostFile | null>;

  /** Writes an exported model where the host wants it, and indexes it. */
  exportToLibrary(file: HostFile, opts?: { designer?: string }): Promise<{ path: string; indexed: boolean }>;

  /** Where this generator's bundled assets are served from. Replaces
   *  `import.meta.env.BASE_URL`, which is not the same string inside a host. */
  assetBase(): string;

  /** Register a cleanup to run when the host unmounts the generator. */
  onBeforeUnmount(fn: () => void): void;
}

/** The entry point every generator exports once it can run inside a host. */
export type MountFn = (container: HTMLElement, host?: DesktopHost) => () => void;
