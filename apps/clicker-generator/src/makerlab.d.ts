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
