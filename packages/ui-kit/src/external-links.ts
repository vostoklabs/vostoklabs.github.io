/**
 * Links that go somewhere, from inside an app that has no address bar.
 *
 * A generator's body copy is full of `target="_blank"` — the MakerWorld print profile, the
 * icon site to browse for logos, the licence. On the web every one of those is correct. In
 * a webview inside a desktop app, `target="_blank"` is at best ignored (nothing happens,
 * which reads as a broken link) and at worst navigates the webview itself, replacing the
 * application with a web page that has no way back.
 *
 * `isDesktop()` already hides the *chrome* that links out — the topbar, the support row,
 * the licence nudge. It does not touch the sentences inside the panels, because those are
 * strings in a generator rather than components in the kit, and there is no version of
 * "hide them all" that survives someone writing the next hint.
 *
 * So this does not hide anything. One delegated listener, registered once per mount,
 * catches every outbound click — the ones written today and the ones written next month —
 * and hands the URL to the host, which opens it in the user's real browser. The link keeps
 * working, and it stops being able to eat the application.
 *
 * Without a host there is no listener and no behaviour: the browser builds are untouched.
 */
import type { DesktopHost } from './desktop-host';

/** Anything that leaves the app. `mailto:` counts; a `#hash` or a relative path does not. */
function outboundHref(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const href = anchor.getAttribute('href') ?? '';
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

/**
 * Sends outbound clicks to the host's browser instead of to this window.
 *
 * Registers its own teardown through `host.onBeforeUnmount`, so a generator needs one call
 * and no cleanup bookkeeping. Returns a disposer as well, for a caller that would rather
 * own it.
 *
 * Listening on `document` in the capture phase rather than on the generator's container:
 * dialogs, toasts and the import wizards all render on `<body>`, outside any container a
 * host handed over, and those are exactly where the licence and profile links live.
 */
export function bindExternalLinks(host?: DesktopHost): () => void {
  if (!host?.openExternal) return () => {};
  const open = host.openExternal.bind(host);

  const onClick = (e: MouseEvent) => {
    // Leave modified clicks alone. They mean "open this somewhere else", and somewhere
    // else is the host's business rather than ours to pre-empt.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = outboundHref(e.target);
    if (!href) return;
    e.preventDefault();
    try {
      open(href);
    } catch (err) {
      console.warn('[host] could not open', href, err);
    }
  };

  document.addEventListener('click', onClick, true);
  const dispose = () => document.removeEventListener('click', onClick, true);
  host.onBeforeUnmount(dispose);
  return dispose;
}
