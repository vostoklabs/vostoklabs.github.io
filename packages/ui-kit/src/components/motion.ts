import { ICONS } from '../icons';
import { button } from './button';

/* The motion preference, as an app-facing setting.

   `motion.css` does the work; this is the switch. Deliberately shaped like `theme.ts` —
   resolve / apply / a toggle button — because a second persisted preference that behaved
   differently from the first is how two settings end up with two mental models.

   The stored value and the DOM attribute use the same vocabulary as the Opal suite, so a
   preference means the same thing in both products. */

/** What the user chose. `system` follows the OS and is the default. */
export type MotionPreference = 'system' | 'full' | 'reduced';

/** What actually applies right now, once the OS has been consulted. */
export type EffectiveMotion = 'full' | 'reduced';

const DEFAULT_KEY = 'vl-motion';

/** Read the stored preference. Returns `system` when nothing has been chosen. */
export function resolveMotion(storageKey: string = DEFAULT_KEY): MotionPreference {
  let saved: string | null = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* private mode */ }
  return saved === 'full' || saved === 'reduced' ? saved : 'system';
}

/**
 * What the page is actually doing right now.
 *
 * The DOM attribute is checked first, and that ordering is the point: when a generator runs
 * inside a host — the Opal desktop app — the host sets `data-motion` on its own root from
 * its own Settings screen and never touches this module's localStorage. Reading storage
 * first made the generator report `full` while the page was visibly running reduced.
 * Falls back to the stored preference, then to the OS.
 */
export function effectiveMotion(storageKey: string = DEFAULT_KEY): EffectiveMotion {
  const attr = document.documentElement.getAttribute('data-motion');
  if (attr === 'full' || attr === 'reduced') return attr;
  const pref = resolveMotion(storageKey);
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}

/**
 * Set `<html data-motion>` and persist the choice.
 *
 * `system` removes the attribute rather than writing one, which is what lets the
 * `prefers-reduced-motion` media query in motion.css take over again — an explicit
 * `data-motion="system"` would match neither rule and silently pin full motion.
 */
export function applyMotion(pref: MotionPreference, storageKey: string = DEFAULT_KEY): void {
  if (pref === 'system') document.documentElement.removeAttribute('data-motion');
  else document.documentElement.setAttribute('data-motion', pref);
  try {
    if (pref === 'system') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, pref);
  } catch { /* private mode */ }
}

export interface MotionToggleOptions {
  /** localStorage key (default 'vl-motion'). */
  storageKey?: string;
  /** Apply the stored preference immediately on creation (default true). */
  applyOnInit?: boolean;
  /** Extra classes for the button. */
  className?: string;
}

/**
 * An animation on/off button.
 *
 * Two visible states rather than three: it flips between an explicit `full` and an
 * explicit `reduced`, starting from whichever the OS currently resolves to. A three-way
 * control including `system` reads as a puzzle on a setting most people touch once —
 * `applyMotion('system', …)` is there for a Settings screen that wants the third option.
 */
export function motionToggleButton(opts: MotionToggleOptions = {}): HTMLElement {
  const storageKey = opts.storageKey ?? DEFAULT_KEY;
  if (opts.applyOnInit ?? true) applyMotion(resolveMotion(storageKey), storageKey);

  /* Built from `button()` rather than from a class string.

     `themeToggleButton` predates the component and only sets `.vl-theme-toggle`, which is a
     flex-layout helper with no fill, no border and no radius — so it renders as a raw
     browser button unless the caller remembers to pass
     `vl-btn vl-btn--secondary vl-action-btn`. Its one real caller does; this one cannot be
     got wrong, because there is no class string to forget. */
  const btn = button({
    label: 'Animation on',
    emphasis: 'secondary',
    icon: ICONS.zap,
    className: `vl-theme-toggle${opts.className ? ` ${opts.className}` : ''}`,
  });

  const render = () => {
    const on = effectiveMotion(storageKey) === 'full';
    btn.setIcon(on ? ICONS.zap : ICONS.zapOff);
    btn.setLabel(on ? 'Animation on' : 'Animation off');
    const next = on ? 'off' : 'on';
    btn.setAttribute('aria-label', `Turn animation ${next}`);
    btn.title = `Turn animation ${next}`;
    btn.setAttribute('aria-pressed', String(on));
  };

  btn.addEventListener('click', () => {
    applyMotion(effectiveMotion(storageKey) === 'full' ? 'reduced' : 'full', storageKey);
    render();
  });

  // The setting can also change from outside this button — a host application's own
  // Settings screen writing `data-motion` on the root. Without this the label goes stale
  // and offers to turn on something that is already on.
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion'],
  });

  render();
  return btn;
}
