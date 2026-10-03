import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/**
 * The one place the light/dark choice is kept, for every app.
 *
 * The apps share an origin, so they share storage. They used to keep the choice under ten
 * different keys, so picking Light in one generator was forgotten in the next. An app's old key
 * is still read once, as a fallback, so nobody loses the choice they had already made there.
 * Pre-paint scripts in an app's index.html must read this key first, for the same reason.
 */
export const THEME_KEY = 'vl-theme';

function readTheme(key: string): 'dark' | 'light' | null {
  let saved: string | null = null;
  try { saved = localStorage.getItem(key); } catch { /* private mode */ }
  return saved === 'light' || saved === 'dark' ? saved : null;
}

/** Read the active theme: the shared choice, then `legacyKey` (an app's old key), then the OS. */
export function resolveTheme(legacyKey?: string): 'dark' | 'light' {
  const saved = readTheme(THEME_KEY) ?? (legacyKey ? readTheme(legacyKey) : null);
  if (saved) return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Set <html data-theme> and persist the choice under the shared key. The second argument is
 *  ignored; it is still accepted so the apps that pass their old key keep compiling. */
export function applyTheme(theme: 'dark' | 'light', _legacyKey?: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
}

export interface ThemeToggleOptions {
  /** An app's old storage key, read once as a fallback. The choice is saved under `THEME_KEY`. */
  storageKey?: string;
  /** Apply the saved/system theme immediately on creation (default true). Do this
   *  before building a 3D viewer so it reads the right value. */
  applyOnInit?: boolean;
  /**
   * `action` is the secondary button of the generators' footer row (Save / Load / Help / Light
   * mode) — the look the switch has everywhere outside the topbar, so a page that puts it at the
   * foot of its own rail gets the same control rather than re-deriving the class list.
   */
  variant?: 'plain' | 'action';
  /** Extra classes for the button (e.g. to match an app's utility grid). */
  className?: string;
}

/**
 * A light/dark toggle button. Shows the mode it will switch TO (sun = go light,
 * moon = go dark) plus a label. Flips <html data-theme> + persists; observe
 * data-theme in the app to re-theme the 3D viewer.
 */
export function themeToggleButton(opts: ThemeToggleOptions = {}): HTMLElement {
  if (opts.applyOnInit ?? true) applyTheme(resolveTheme(opts.storageKey));

  const btn = el('button', {
    className: `vl-theme-toggle${opts.variant === 'action' ? ' vl-btn vl-btn--secondary vl-action-btn' : ''}${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { type: 'button' },
  });
  const render = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.replaceChildren(svgEl(isLight ? ICONS.moon : ICONS.sun), document.createTextNode(isLight ? 'Dark mode' : 'Light mode'));
    btn.setAttribute('aria-label', `Switch to ${isLight ? 'dark' : 'light'} mode`);
    btn.title = `Switch to ${isLight ? 'dark' : 'light'} mode`;
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    render();
  });
  render();
  return btn;
}
