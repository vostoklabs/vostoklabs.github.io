import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/** Read the active theme from localStorage, falling back to the OS preference. */
export function resolveTheme(storageKey: string): 'dark' | 'light' {
  let saved: string | null = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* private mode */ }
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Set <html data-theme> and persist the choice. */
export function applyTheme(theme: 'dark' | 'light', storageKey: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(storageKey, theme); } catch { /* private mode */ }
}

export interface ThemeToggleOptions {
  /** localStorage key (default 'vl-theme'). */
  storageKey?: string;
  /** Apply the saved/system theme immediately on creation (default true). Do this
   *  before building a 3D viewer so it reads the right value. */
  applyOnInit?: boolean;
  /** Extra classes for the button (e.g. to match an app's utility grid). */
  className?: string;
}

/**
 * A light/dark toggle button. Shows the mode it will switch TO (sun = go light,
 * moon = go dark) plus a label. Flips <html data-theme> + persists; observe
 * data-theme in the app to re-theme the 3D viewer.
 */
export function themeToggleButton(opts: ThemeToggleOptions = {}): HTMLElement {
  const storageKey = opts.storageKey ?? 'vl-theme';
  if (opts.applyOnInit ?? true) applyTheme(resolveTheme(storageKey), storageKey);

  const btn = el('button', {
    className: `vl-theme-toggle${opts.className ? ` ${opts.className}` : ''}`,
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
    applyTheme(next, storageKey);
    render();
  });
  render();
  return btn;
}
