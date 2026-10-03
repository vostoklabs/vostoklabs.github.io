/*
  What makes an overlay modal, in one place.

  Every modal in the kit (`dialog()`, the licence window, "What's new") used to do this for
  itself: a document Escape listener, a focus on the first `a, button` it could find, and
  nothing else. So the page behind stayed reachable with Tab and with a screen reader, Escape
  closed every open modal at once rather than the top one, and the licence window put focus on
  its sales link, so a stray Enter opened a shop. One function now does it for all of them.

  The page behind goes `inert`: unfocusable and hidden from assistive tech, without walking it.
  Tab therefore cannot leave the modal, which is the same behaviour as the platform's own
  `<dialog>.showModal()`. Anything marked `data-vl-above-modal` stays live: the toast stack and
  the licence reminder must still be heard while a modal is open.
*/

interface Layer {
  onEscape?: () => void;
}

/** Open modals, bottom to top. Only the top one answers Escape. */
const layers: Layer[] = [];

/* Window, capture phase: it runs before any listener on `document`, so the top modal can take
   Escape for itself and a drawer or popover underneath does not also close. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const top = layers[layers.length - 1];
  if (!top?.onEscape) return;
  e.preventDefault();
  e.stopPropagation();
  top.onEscape();
}

export interface ModalOptions {
  /** Escape, while this is the topmost modal. Usually the overlay's own close. */
  onEscape?: () => void;
  /** Where focus goes on open. Default: the first control inside that is not a link. */
  initialFocus?: HTMLElement | null;
}

/**
 * Make an overlay that is already in the document modal. Returns `release`, which undoes it
 * and puts focus back where it was. Call `release` from the overlay's close; calling it twice
 * is harmless.
 */
export function holdModal(overlay: HTMLElement, opts: ModalOptions = {}): () => void {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const madeInert: HTMLElement[] = [];
  for (const node of Array.from(document.body.children)) {
    if (node === overlay || !(node instanceof HTMLElement)) continue;
    if (node.inert || node.hasAttribute('data-vl-above-modal')) continue;
    node.inert = true;
    madeInert.push(node);
  }

  const layer: Layer = { onEscape: opts.onEscape };
  layers.push(layer);
  if (layers.length === 1) window.addEventListener('keydown', onKey, true);

  (opts.initialFocus ?? firstControl(overlay)).focus({ preventScroll: true });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = layers.indexOf(layer);
    if (at !== -1) layers.splice(at, 1);
    if (layers.length === 0) window.removeEventListener('keydown', onKey, true);
    for (const node of madeInert) node.inert = false;
    if (previouslyFocused?.isConnected && !previouslyFocused.closest('[inert]')) previouslyFocused.focus();
  };
}

/**
 * The first thing in the overlay worth pressing, skipping links: a link in a modal is nearly
 * always "read more" or "buy", and focus landing there turns a stray Enter into a new tab.
 * With nothing to press, the box itself takes focus so reading starts inside it.
 */
function firstControl(overlay: HTMLElement): HTMLElement {
  const found = overlay.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (found) return found;
  const box = overlay.querySelector<HTMLElement>('[role="dialog"]') ?? overlay;
  if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
  return box;
}
