import { BRAND } from '@vostok/brand';
import { el } from '../dom';
import { ICONS, svgEl } from '../icons';
import { themeToggleButton } from './theme';
import { button } from './button';
import { openChangelog, type ChangelogOptions } from './changelog';
import { isDesktop } from '../host-env';

/* Shared chrome for every Vostok generator so they all look the same: a header
   (name + description + "Made by Vostok Labs"), an optional dismissable quality
   callout, and the Save / Load / Help / Light-mode action block under the export
   button. Modelled on the shipped clicker app, sized on the ui-kit token scale. */

// The Vostok mark, inlined so it inherits currentColor (works in light & dark).
const VOSTOK_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568.55431 524.21602" fill="none" stroke="currentColor" stroke-width="20" class="vl-credit-logo" aria-hidden="true">
  <path d="M385.471,8.276 h171.043 l-194.874,507.665 h-165.99 l82.995,-229.373 z"/>
  <path d="M255.292,225.733 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M208.588,104.064 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M152.519,8.276 l-73.63,203.492 l-23.352,-60.835 l51.618,-142.657 z"/>
  <path d="M61.79,8.276 l-29.606,81.823 l-23.352,-60.835 l7.594,-20.988 z"/>
</svg>`;

function parseSvg(raw: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw.trim();
  return tpl.content.firstElementChild!;
}

export interface GeneratorHeaderOptions {
  /** Generator name, e.g. "Name Keychain Generator". */
  title: string;
  /** One-line description under the title. Omitted, the header is the title alone. */
  description?: string;
  /** Where "Made by Vostok Labs" links (default: the MakerWorld profile). */
  madeByUrl?: string;
  /** Whether to hide the "Made by Vostok Labs" credit. */
  hideCredit?: boolean;
  /**
   * The host owns outbound navigation, so the credit is TEXT, not a link — the same answer and
   * the same reason as `panelCredit`'s option of this name.
   */
  hostOwnsLinks?: boolean;
}

/** Title + description + "Made by Vostok Labs" — the top of every generator sidebar. */
export function generatorHeader(opts: GeneratorHeaderOptions): HTMLElement {
  const children: HTMLElement[] = [
    el('h1', { className: 'vl-app-title', text: opts.title }),
    ...(opts.description ? [el('p', { className: 'vl-app-subtitle', text: opts.description })] : []),
  ];

  // Inside a desktop app the title and description still earn their place — they say which
  // tool you are looking at. The credit does not. On the web it is how someone finds the
  // other generators; inside a desktop host the line is a byline repeated once per
  // generator, and its link is a way out of the product.
  //
  // Decided here rather than at each call site on purpose: four generators passing
  // `hideCredit: true` is four chances to forget, and the answer is a property of the host
  // rather than of any one generator.
  if (!opts.hideCredit && !isDesktop()) {
    const credit = opts.hostOwnsLinks
      ? el('span', { className: 'vl-credit-link vl-credit-link--text' })
      : el('a', {
          className: 'vl-credit-link',
          attrs: { href: opts.madeByUrl ?? BRAND.urls.makerworld, target: '_blank', rel: 'noopener noreferrer' },
        });
    credit.append(parseSvg(VOSTOK_MARK), document.createTextNode('Vostok Labs'));
    children.push(el('p', { className: 'vl-app-credit' }, [document.createTextNode('Made by '), credit]));
  }

  return el('div', { className: 'vl-app-header' }, children);
}

export interface QualityCalloutOptions {
  /** Callout body as HTML (links allowed). Use this or `text`. */
  html?: string;
  /** Callout body as plain text. */
  text?: string;
  /** localStorage key so a dismiss sticks across visits. Omit = not dismissable. */
  storageKey?: string;
}

/**
 * The "for best print quality…" info callout that sits under the header. Pass a
 * storageKey to make it dismissable (an × that hides it and remembers). Returns
 * null when it was previously dismissed, so callers can `if (c) parent.append(c)`.
 */
export function qualityCallout(opts: QualityCalloutOptions): HTMLElement | null {
  if (opts.storageKey) {
    try { if (localStorage.getItem(opts.storageKey) === 'dismissed') return null; } catch { /* ignore */ }
  }

  const body = el('div', { className: 'vl-callout__body' });
  if (opts.html) body.innerHTML = opts.html;
  else body.textContent = opts.text ?? '';

  const root = el('div', { className: 'vl-callout' }, [svgEl(ICONS.info), body]);

  if (opts.storageKey) {
    const dismiss = el('button', {
      className: 'vl-callout__dismiss',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Dismiss' },
    });
    dismiss.addEventListener('click', () => {
      try { localStorage.setItem(opts.storageKey!, 'dismissed'); } catch { /* ignore */ }
      root.remove();
    });
    root.append(dismiss);
  }
  return root;
}

export interface PanelCreditOptions {
  /**
   * The generator's name, in small type, above the byline.
   *
   * Optional, but pass it: the two-line block is the shape this strip is meant to be, and it
   * is what leaves the right half of the row empty for the Updates button to sit in. Omit it
   * only where the name would be a third repetition on one screen.
   */
  title?: string;
  /** Where "Made by Vostok Labs" points. Defaults to the MakerWorld profile. */
  madeByUrl?: string;
  /**
   * The host owns outbound navigation, so the byline is TEXT here, not a link.
   *
   * The same answer `isDesktop()` already gives below, for a host this component cannot
   * detect. The embedded build has no outbound links; the host owns navigation, and a link
   * that cannot navigate is a control that does nothing when pressed — what invariant #7
   * exists to stop. Explicit rather than inferred, for the reason `hostOwnsProjects` is: the
   * host knows, this component does not.
   */
  hostOwnsLinks?: boolean;
  /**
   * Put the update timeline in the strip. Its button is the compact one — an icon and a
   * word — because this line is a signature, not a call to action.
   */
  updates?: ChangelogOptions;
}

/**
 * The pinned credit strip at the foot of a settings panel: who made this, and what changed.
 *
 * The keycap generator moved its header into a compact line pinned to the bottom-left, and it
 * turned out to be the better shape everywhere: the byline stops competing with the first
 * control, and the bottom of the panel is where a signature belongs.
 *
 * Updates rides here for the same reason. It is the answer to "has my bug been fixed", which
 * is a question people ask rather than one to interrupt them with, and a full-width button in
 * the settings column made it look like a step in the workflow. Next to the byline it reads
 * as what it is: the version of the thing you are using.
 *
 * Pin it OUTSIDE the panel's scrolling area (`.vl-panel__scroll`), or it scrolls away with
 * the controls and the strip is pointless.
 */
export function panelCredit(opts: PanelCreditOptions): HTMLElement {
  /* Inside a desktop host the byline is a way OUT of the product — the same call
     `generatorHeader` makes about its own credit, made here too so a generator cannot grow a
     second outbound link by moving its byline. */
  const byline: (HTMLElement | Node)[] = [document.createTextNode('Made by ')];
  if (isDesktop() || opts.hostOwnsLinks) {
    byline.push(parseSvg(VOSTOK_MARK), document.createTextNode(BRAND.name));
  } else {
    const link = el('a', {
      className: 'vl-credit-link',
      attrs: {
        href: opts.madeByUrl ?? BRAND.urls.makerworld,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    });
    link.append(parseSvg(VOSTOK_MARK), document.createTextNode(BRAND.name));
    byline.push(link);
  }

  const text = el('div', { className: 'vl-panel-credit__text' }, [
    ...(opts.title ? [el('span', { className: 'vl-panel-credit__title', text: opts.title })] : []),
    el('p', { className: 'vl-app-credit' }, byline),
  ]);

  const children: HTMLElement[] = [text];
  if (opts.updates) {
    const updates = opts.updates;
    children.push(button({
      label: 'Updates',
      // Secondary, not ghost. Ghost is borderless and reads as a caption sitting next to a
      // byline that is also muted text — reported, twice, as "that is not a button". Secondary
      // is the hairline-bordered rung, which is unmistakably one without out-shouting Export.
      emphasis: 'secondary',
      icon: ICONS.history,
      className: 'vl-panel-credit__updates',
      title: 'What has changed in this generator',
      onClick: () => openChangelog(updates),
    }));
  }

  return el('div', { className: 'vl-panel-credit' }, children);
}

function actionBtn(label: string, icon: string | null, onClick: () => void, title?: string): HTMLButtonElement {
  const btn = el('button', {
    className: 'vl-btn vl-btn--secondary vl-action-btn',
    attrs: title ? { type: 'button', title } : { type: 'button' },
  }) as HTMLButtonElement;
  if (icon) btn.append(svgEl(icon));
  btn.append(el('span', { text: label }));
  btn.addEventListener('click', onClick);
  return btn;
}

export interface ProjectActionsOptions {
  /** Serialize + download the current project. */
  onSave: () => void;
  /** Load a project file the user picked (or undefined if desktop native picker should be used). */
  onLoad: (file?: File) => void;
  /** Show the help/intro. Omit to hide the Help button. */
  onHelp?: () => void;
  /** Include the light/dark toggle (default true). */
  theme?: boolean;
  /** localStorage key for the theme toggle. */
  themeStorageKey?: string;
  /**
   * The host draws Save and Open itself, so this block must not.
   *
   * Pass `Boolean(host?.registerProject)` — not `isDesktop()`. The two are different
   * questions: a desktop host that has not implemented project ownership still needs these
   * buttons, and inferring one from the other is how a generator ends up with no way to
   * save at all. Explicit, so every combination is correct rather than assumed.
   */
  hostOwnsProjects?: boolean;
}

/**
 * The Save project / Load project / Help / Light-mode block that sits under the
 * export button. One row of short-labelled buttons, matching the clicker.
 *
 * With `hostOwnsProjects` the first row is gone and only Help (and, on the web, the theme
 * toggle) remains — the block collapses to what the host is not already providing rather
 * than disappearing, because Help is the generator's own and nobody else can draw it.
 */
export function projectActions(opts: ProjectActionsOptions): HTMLElement {
  const fileInput = el('input', {
    attrs: { type: 'file', accept: 'application/json', hidden: '' },
  }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) opts.onLoad(f);
    fileInput.value = '';
  });

  /* ONE row. Save / Load on one line and Help / Light mode on another spent two rows of the
     sidebar's fixed footer on four small actions, and the footer's height is taken straight
     out of the settings above it. Short labels ("Save", not "Save project") are what let
     three or four buttons share a 293 px line; the full name lives in the tooltip. */
  const save = actionBtn('Save', ICONS.save, () => opts.onSave(), 'Save project');
  const load = actionBtn('Load', ICONS.load, () => {
    if (isDesktop()) {
      opts.onLoad();
    } else {
      fileInput.click();
    }
  }, 'Load project');

  const row: (HTMLElement | Node)[] = [];
  if (!opts.hostOwnsProjects) row.push(save, load, fileInput);
  if (opts.onHelp) row.push(actionBtn('Help', ICONS.help, () => opts.onHelp!()));
  // No per-generator theme toggle on the desktop: the host app already has one, and two
  // switches writing the same `data-theme` attribute is a bug waiting to be reported.
  if ((opts.theme ?? true) && !isDesktop()) {
    row.push(themeToggleButton({ storageKey: opts.themeStorageKey, variant: 'action' }));
  }

  return el('div', { className: 'vl-project-actions' }, row.length ? [el('div', { className: 'vl-action-row' }, row)] : []);
}
