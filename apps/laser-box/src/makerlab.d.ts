/**
 * `virtual:makerlab` — the embedded-build seam, for tsc.
 *
 * In `--mode makerworld` it resolves to the host glue in src/makerlab/ (gitignored, NDA SDK); in
 * every other build to an inline stub in vite.config.ts whose `MAKERLAB` is the literal `false`.
 * Same shape both ways, so main.ts imports it unconditionally. The export's own types are the
 * shelf's ("MakerLab export", `@vostok/export/makerlab`).
 */
declare module 'virtual:makerlab' {
  import type { HostExportOptions, HostExportResult } from '@vostok/export/makerlab';

  export const MAKERLAB: boolean;
  export function isEmbedded(): boolean;
  /** The handshake: one live SDK per iframe. A later call returns the handshake in flight or
   *  connected; only a failed or dropped one is replaced, by one fresh attempt per call. */
  export function initMakerlab(hooks?: { onDisconnect?: () => void }): Promise<object | null>;
  export function isReady(): boolean;
  export function can(capability: string): boolean;
  export function sdkExport(options: HostExportOptions): Promise<HostExportResult>;
  /** True when the customer closed MakerLab's export window — a choice, not a failure. */
  export function isExportCancelled(outcome: unknown): boolean;
  export function sdkToast(options: {
    message: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  }): Promise<void>;

  /* The paid seam, unused: the stub answers false to both. */
  export function isUnlocked(key: string): boolean;
  export function ensureAccess(key: string): Promise<boolean>;
}
