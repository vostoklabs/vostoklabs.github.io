/**
 * `virtual:makerlab` — the embedded-build seam, for tsc.
 *
 * In `--mode makerworld` it resolves to gitignored host glue; in every other build to an
 * inline stub in vite.config.ts whose `MAKERLAB` is the literal `false`. Same shape both ways,
 * so editor.ts imports it unconditionally and a public clone with no src/makerlab/ still
 * typechecks — which is what deploy.yml depends on.
 *
 * Laser Studio sends one zip holding the cut file.
 */
declare module 'virtual:makerlab' {
  /** Which kind of output an export is: `'2D'` for a cut file. */
  export type MakerlabPrinterType = '2D' | '3D';

  export interface MakerlabZipArtifact {
    fileName: string;
    format: 'zip';
    buffer: ArrayBuffer;
    /** Cover image as a PNG/JPEG data URL. */
    coverImage: string;
    /** Short description. */
    description?: string;
  }

  export const MAKERLAB: boolean;
  export function isEmbedded(): boolean;
  export function initMakerlab(hooks?: { onDisconnect?: () => void }): Promise<object | null>;
  export function isReady(): boolean;
  export function can(capability: string): boolean;

  /** Export result: success, or failure with a code and optional message. */
  export type MakerlabExportResult =
    | { success: true; format: string }
    | { success: false; errorCode: string; errorMessage?: string };

  /** The options this app sends. */
  export interface MakerlabExportOptions {
    printerType?: MakerlabPrinterType;
    artifacts: MakerlabZipArtifact[];
  }

  export function sdkExport(options: MakerlabExportOptions): Promise<MakerlabExportResult>;
  export function sdkToast(options: {
    message: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  }): Promise<void>;

  /* ---- access helpers, stubbed ----------------------------------------------------------
     Nothing in the app calls `ensureAccess`, and the stub answers false to everything here.
     The surface exists so the two builds keep one shape. Nothing in this file can grant
     access; the host decides, and only when it is actually connected. */

  export function isUnlocked(key: string): boolean;
  /** Answers false outside the embedded build, so a paid path does not run there. */
  export function ensureAccess(key: string): Promise<boolean>;
}
