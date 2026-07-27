// MakerLab host integration (the real implementation behind `virtual:makerlab`).
//
// This module is bundled ONLY in the MakerWorld build (`vite --mode makerworld`); the
// normal/public build resolves `virtual:makerlab` to an inline no-op stub instead (see the
// makerlab plugin in vite.config.js), so the public site never depends on the SDK.
//
// It imports the MakerLab App SDK from ./lib/, which is proprietary/NDA and gitignored —
// see makerlab/README.md for how to populate it. Everything here is our own code.

import { createMakerLabSDK, BridgeError } from './lib/index.js';

// Compile-time marker read by main.js to switch on MakerWorld behaviour (hide the topbar,
// route exports through the host, capture a cover image, …).
export const MAKERLAB = true;

const params = new URLSearchParams(window.location.search);
const APP_ID = params.get('appId') ?? '';

let sdk = null;
let context = null;
let ready = false;

// Embedded only when the host loaded us in an iframe with an appId. Opening the built app
// directly (e.g. `preview:mw` without the simulator) makes `window.parent === window`, so we
// skip init and every helper below stays a safe no-op / download fallback.
export function isEmbedded() {
  return !!APP_ID && window.parent !== window;
}

/**
 * Handshake with the MakerLab host.
 * @param {{ onDisconnect?: () => void }} [hooks]
 * @returns {Promise<object|null>} granted context when embedded, else null.
 */
export async function initMakerlab({ onDisconnect } = {}) {
  if (!isEmbedded()) return null;

  sdk = createMakerLabSDK({ appId: APP_ID });
  try {
    context = await sdk.init({
      onDisconnect: () => {
        ready = false;
        onDisconnect?.();
      },
      onError: (err) => console.error('[MakerLab SDK] runtime error:', err),
    });
    ready = true;
    return context;
  } catch (err) {
    ready = false;
    sdk = null;
    if (err instanceof BridgeError) {
      console.error(`[MakerLab SDK] init failed: [${err.code}] ${err.message}`);
    } else {
      console.error('[MakerLab SDK] init failed:', err);
    }
    return null;
  }
}

export function isReady() {
  return ready && sdk?.state === 'ready';
}

export function can(capability) {
  return context?.capabilities?.includes(capability) ?? false;
}

/** Send artifacts to the host. Throws if not ready — callers gate on isReady(). */
export async function sdkExport(options) {
  if (!isReady()) throw new Error('MakerLab SDK not ready');
  return sdk.export(options);
}

/** Fire-and-forget host toast; silently ignored when unavailable. */
export async function sdkToast(options) {
  if (!isReady() || !can('toast')) return;
  try {
    await sdk.toast(options);
  } catch (err) {
    console.error('[MakerLab SDK] toast failed:', err);
  }
}
