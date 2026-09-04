declare module 'virtual:makerlab' {
  export const MAKERLAB: boolean;
  export function isEmbedded(): boolean;
  export function initMakerlab(hooks?: {
    onDisconnect?: () => void;
  }): Promise<object | null>;
  export function isReady(): boolean;
  export function can(capability: string): boolean;
  export function sdkExport(options: unknown): Promise<{
    success: boolean;
    errorMessage?: string;
    errorCode?: string;
  }>;
  export function sdkToast(options: {
    message: string;
    type?: string;
  }): Promise<void>;

  // ---- paid features (partial_buyout) ----
  // `isUnlocked` draws the UI; `ensureAccess` is the only thing that decides whether paid
  // logic runs, and it is called before EVERY execution. Both answer false in the public
  // build's stub, so app code can import them unconditionally.
  export const SELLER_PACK: string;
  export function isUnlocked(key: string): boolean;
  export function paymentInfo(key: string): unknown | null;
  export function isUserCancelled(err: unknown): boolean;
  export function ensureAccess(key: string): Promise<boolean>;
  export function formatPrice(price: unknown): string;
  export function currentPrice(key: string): {
    current: string;
    original: string | null;
    endsAt: number | null;
  } | null;
}

/**
 * The paid features (`apps/clicker-generator/src/pro/`), behind the same kind of seam as the
 * SDK glue above.
 *
 * The implementation is gitignored — it is what people are paying for, and this repo is
 * public — so this declaration is what lets `mount.ts` import it and typecheck in a clone
 * that has no `src/pro/` at all. In every non-MakerWorld build the module resolves to an
 * inline stub whose functions do nothing (see the makerlab plugin in vite.config.ts), and
 * the branch that calls it is fenced behind `MAKERLAB` on top of that.
 */
declare module 'virtual:pro-pack' {
  import type { BuildParams, ClickerPart, RGB, Ring } from './types';

  /** The seams the paid panel reaches the generator through. Deliberately narrow: the panel
   *  renders into elements the shell already owns, and asks the shell to do anything that
   *  touches the worker or the viewer. */
  export interface ProDeps {
    /** Where the panel draws itself — an empty div the sidebar already lays out. */
    host: HTMLElement;
    /** Current design state, for the run loop's per-row defaults. */
    getState(): {
      importMode: string;
      fontId: string;
      separateLetters: boolean;
      palette: { filamentRgb: RGB }[];
      params: BuildParams;
    };
    /** Set the status line, the same one the build writes to. */
    setStatus(msg: string): void;
    /** Build ONE clicker off the main thread and resolve its parts. The run loop calls this
     *  N times; the worker is the shell's, and correlates answers by request id. */
    buildOne(
      regions: { filamentRgb: RGB; coverage: number; rings: Ring[]; partName: string }[],
      outline: Ring[],
      params: BuildParams,
    ): Promise<{ parts: ClickerPart[]; warnings: string[] }>;
    /** Put a finished set of parts on screen and make them what Export exports. */
    showParts(parts: ClickerPart[]): void;
    /** Ask the shell to rebuild the single clicker, after a paid parameter changed. */
    rebuild(): void;
  }

  export interface ProPanel {
    /** Re-read app state (called on every store change). */
    refresh(): void;
    /** Everything this panel put outside its own host element. */
    destroy(): void;
    /** Paid additions to `BuildParams`, merged by the shell on every build. Empty when
     *  nothing paid is switched on, which is also what the public stub always returns. */
    paramsPatch(): Partial<BuildParams>;
  }

  export function mountProFeatures(deps: ProDeps): ProPanel;
}
