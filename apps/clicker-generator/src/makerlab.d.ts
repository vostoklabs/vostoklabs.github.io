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
}
