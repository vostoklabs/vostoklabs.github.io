/**
 * `virtual:makerlab` — the MakerLab seam, for tsc.
 *
 * In `--mode makerworld` it resolves to src/makerlab/glue.ts (gitignored, with the NDA SDK
 * under it); in every other build to an inline stub in vite.config.ts whose `MAKERLAB` is the
 * literal `false`. Same shape both ways, so mount.ts imports it unconditionally and a public
 * clone with no src/makerlab/ still typechecks.
 *
 * The free surface only: this generator sells nothing on MakerWorld, so there is no
 * `requestAccess`, no function key and no price here.
 *
 * The artifact types are the subset of the SDK's `ExportArtifactInput` this app sends, written
 * out rather than imported, because the SDK's own .d.ts is not in a public clone.
 */
declare module 'virtual:makerlab' {
  /** The SDK's `ExportLayerHeight`, copied from `EXPORT_LAYER_HEIGHT` in its `lib/index.d.ts`.
   *  A string, never a number, and never a value off this list: anything else is rejected by
   *  the host's schema, and only this union makes tsc say so here. */
  export type MakerlabLayerHeight =
    | '0.06' | '0.08' | '0.1' | '0.12' | '0.14' | '0.16' | '0.18' | '0.2'
    | '0.24' | '0.28' | '0.3' | '0.32' | '0.36' | '0.4' | '0.42' | '0.48' | '0.56';

  /** The SDK's `ExportPrinterType` (`EXPORT_PRINTER_TYPE`, since the 2026-09-17 SDK). Set once
   *  per `export()` call, not per artifact. `'3D'` is the host's default: it asks the user for
   *  a printer and nozzle before it delivers the file. `'2D'` skips that and opens the download
   *  dialog directly, which is what a zip of cut files wants. */
  export type MakerlabPrinterType = '2D' | '3D';

  interface MakerlabArtifactBase {
    fileName: string;
    /** Base64 PNG/JPEG data URL. Required by the host for every format. */
    coverImage: string;
    /** Max 1000 characters. */
    description?: string;
  }
  export interface MakerlabZipArtifact extends MakerlabArtifactBase {
    format: 'zip';
    buffer: ArrayBuffer;
  }
  export interface MakerlabObjArtifact extends MakerlabArtifactBase {
    format: 'obj';
    /** One `ArrayBuffer` per plate; a single one is a single plate. */
    buffer: ArrayBuffer | ArrayBuffer[];
    mtl?: string;
    /** Force every mesh on a plate into one object. Force-enable only: `false` is the same
     *  as omitting it, and the host merges by itself only above 500 meshes. */
    mergeObj?: boolean;
    /** The host's OBJ -> 3MF settings. */
    printConfig?: { layerHeight?: MakerlabLayerHeight };
  }

  export const MAKERLAB: boolean;
  export function isEmbedded(): boolean;
  export function initMakerlab(hooks?: { onDisconnect?: () => void }): Promise<object | null>;
  export function isReady(): boolean;
  export function can(capability: string): boolean;
  /** The SDK's `ExportResult`: a discriminated union, so the failure fields only exist on
   *  the failure branch. */
  export type MakerlabExportResult =
    | { success: true; format: string }
    | { success: false; errorCode: string; errorMessage?: string };
  /** The subset of the SDK's `ExportOptions` this app sends. */
  export interface MakerlabExportOptions {
    printerType?: MakerlabPrinterType;
    artifacts: (MakerlabZipArtifact | MakerlabObjArtifact)[];
  }
  export function sdkExport(options: MakerlabExportOptions): Promise<MakerlabExportResult>;
  export function sdkToast(options: {
    message: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  }): Promise<void>;
}
