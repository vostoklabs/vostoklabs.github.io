import { el } from '../dom';
import { ICONS, svgEl } from '../icons';
import { toast } from './toast';

/* Share/bookmark exact generator configurations via the URL hash.
   Sellers keep links to their proven product configs; links shared in groups
   bring people straight into a configured generator. */

const HASH_KEY = '#p=';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode params into a `#p=...` hash fragment (append to the app URL). */
export function encodeParamsToHash(params: Record<string, unknown>): string {
  return HASH_KEY + toBase64Url(JSON.stringify(params));
}

/** Read params back from the current URL hash; null if absent/invalid. */
export function readParamsFromHash(): Record<string, unknown> | null {
  const h = window.location.hash;
  if (!h.startsWith(HASH_KEY)) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(h.slice(HASH_KEY.length)));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Button: writes current params into the URL and copies the link. */
export function presetShareButton(opts: {
  getParams: () => Record<string, unknown>;
  label?: string;
}): HTMLElement {
  const btn = el('button', {
    className: 'vl-btn',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        window.location.hash = encodeParamsToHash(opts.getParams());
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast('Link copied. It opens with these exact settings.', { kind: 'ok' });
        } catch {
          toast('Link is in the address bar. Copy it from there.');
        }
      },
    },
  });
  btn.append(svgEl(ICONS.link), opts.label ?? 'Share this design');
  return btn;
}
