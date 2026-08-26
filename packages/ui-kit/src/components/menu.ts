import { el } from '../dom';
import { svgEl } from '../icons';

/* An anchored popover menu.

   The kit had no menu at all, so anything needing one either used a `<select>` (wrong
   semantics for commands) or built a floating div by hand. Styling is adopted from Opal's
   `.opal-menu`; the interaction below is this kit's own, because Opal's lives in React
   state and does not port.

   Positioned `fixed` off the trigger's rect rather than absolutely inside it: a generator
   sidebar is a scrolling, `overflow: hidden` column, and a menu positioned inside one is
   clipped by it. Fixed escapes the panel, and the trade — it does not follow a scroll — is
   handled by closing on scroll instead, which is also what every desktop menu does. */

export interface MenuItem {
  label: string;
  /** Raw SVG string from `ICONS`. */
  icon?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

/** A horizontal rule between groups of commands. */
export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface MenuOptions {
  /** The element the menu hangs off. Its rect decides placement. */
  anchor: HTMLElement;
  entries: MenuEntry[];
  /** Horizontal alignment against the anchor. Default `start`. */
  align?: 'start' | 'end';
}

export interface MenuHandle {
  close(): void;
}

const isSeparator = (e: MenuEntry): e is MenuSeparator => 'separator' in e;

/** Every menu currently on screen, so a second one closes the first. */
const open = new Set<() => void>();

/** Close every open menu. Call on teardown. */
export function closeAllMenus(): void {
  for (const close of [...open]) close();
}

/**
 * Open a menu anchored to an element. Returns a handle; the menu also closes itself on
 * select, Escape, outside pointer-down, scroll, and resize.
 */
export function openMenu(opts: MenuOptions): MenuHandle {
  closeAllMenus();

  const root = el('div', { className: 'vl-menu', attrs: { role: 'menu' } });
  const items: HTMLButtonElement[] = [];

  for (const entry of opts.entries) {
    if (isSeparator(entry)) {
      root.append(el('div', { className: 'vl-menu__sep', attrs: { role: 'separator' } }));
      continue;
    }
    const btn = el('button', {
      className: 'vl-menu__item',
      attrs: { type: 'button', role: 'menuitem' },
    });
    if (entry.icon) btn.append(svgEl(entry.icon));
    btn.append(document.createTextNode(entry.label));
    if (entry.disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      close();
      entry.onSelect?.();
    });
    items.push(btn);
    root.append(btn);
  }

  document.body.append(root);

  // Measure after mounting, then place. Flips up or left when the menu would overflow.
  const anchorBox = opts.anchor.getBoundingClientRect();
  const menuBox = root.getBoundingClientRect();
  const gap = 6;

  let top = anchorBox.bottom + gap;
  if (top + menuBox.height > window.innerHeight - gap) {
    top = anchorBox.top - menuBox.height - gap;
    root.style.transformOrigin = 'bottom left';
  }
  /* Both axes get clamped to the viewport, not just the horizontal one. Flipping up only
     helps when the anchor is near the bottom edge; an anchor that is off-screen entirely —
     a menu opened from a keyboard shortcut while the list is scrolled away — would still
     have placed the menu outside the window, where it is invisible and untappable. */
  top = Math.max(gap, Math.min(top, window.innerHeight - menuBox.height - gap));

  let left = opts.align === 'end' ? anchorBox.right - menuBox.width : anchorBox.left;
  left = Math.max(gap, Math.min(left, window.innerWidth - menuBox.width - gap));

  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;

  /* The open state is an attribute, and it is set in a separate task rather than an rAF.
     rAF does not fire while the tab is hidden, and a menu that opens invisibly and stays
     that way is worse than one that appears without its transition. */
  const raise = setTimeout(() => root.setAttribute('data-open', ''), 0);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(raise);
    open.delete(close);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    root.removeAttribute('data-open');
    // Let the exit transition play, then go. Timed rather than transitionend-gated: under
    // reduced motion the duration is ~1ms and a missed event would strand the node.
    setTimeout(() => root.remove(), 120);
    opts.anchor.focus?.();
  }

  function onOutside(e: PointerEvent) {
    const target = e.target as Node;
    if (!root.contains(target) && !opts.anchor.contains(target)) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const usable = items.filter((b) => !b.disabled);
    if (usable.length === 0) return;
    e.preventDefault();
    const current = usable.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? usable.length - 1
      : e.key === 'ArrowDown' ? (current + 1) % usable.length
      : (current - 1 + usable.length) % usable.length;
    usable[next]?.focus();
  }

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  open.add(close);

  items.find((b) => !b.disabled)?.focus();

  return { close };
}
