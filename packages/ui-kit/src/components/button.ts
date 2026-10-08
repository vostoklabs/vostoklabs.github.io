import { el } from '../dom';
import { svgEl } from '../icons';

/* The button, as a component rather than as a class name.

   `.vl-btn` and its whole ladder — primary, secondary, ghost, icon, block, busy —
   have been in base.css since the kit shipped, and every app still built its own
   `<button>` and tried to remember the class. Mostly they did not: the clicker has
   `class="tab"`, `class="primary"` and `class="switch-pad-btn"`, and none of the
   three is anything the kit defines. A stylesheet can only style what opts into it
   by name, so there was never one place where "a button" was defined, which is why
   fixing one has never once fixed the others.

   These render the element they always were with the classes that already exist, so
   adopting one is a one-line change and never a redesign. A component cannot be
   forgotten and cannot be half-applied. */

/** Where the button sits on the emphasis ladder. One primary per view, at most. */
/** Where the button sits on the emphasis ladder. One primary per view, at most.
 *
 *  `cta` is the rung ABOVE primary, and there is at most one in the whole app: the button
 *  that asks for money. A primary is the main action of a view; a cta is the action a view
 *  exists to produce. The clicker's licence dialog is what forced it — its buy button was a
 *  `primary` sitting beside a `plain` "Not now", and next to the app's other primaries it read
 *  as one more blue button rather than as the offer. Widened here rather than restyled at the
 *  call site on purpose: a local class is how `.vl-btn` grew 163 impostors. */
export type ButtonEmphasis = 'cta' | 'primary' | 'secondary' | 'ghost' | 'plain';

const EMPHASIS: Record<ButtonEmphasis, string> = {
  cta: 'vl-btn vl-btn--primary vl-btn--cta',
  primary: 'vl-btn vl-btn--primary',
  secondary: 'vl-btn vl-btn--secondary',
  ghost: 'vl-btn vl-btn--ghost',
  plain: 'vl-btn',
};

export interface ButtonOptions {
  label: string;
  /** Default `plain`. */
  emphasis?: ButtonEmphasis;
  /** Raw SVG string, i.e. a member of `ICONS`. Rendered before the label. */
  icon?: string;
  /** Full-width — `.vl-btn--block`, the footer/sidebar shape. */
  block?: boolean;
  disabled?: boolean;
  /** Native tooltip. */
  title?: string;
  /**
   * A quieter second line under the label, for a button that carries a fact as well as an
   * action. The price on a buy button is the whole reason this exists: a label plus a price
   * on one line either overflows a sidebar or wraps, and a wrapped label in
   * a centred flex row strands the icon on the far left, which is what it did.
   *
   * Only when it is set does the label get a wrapping element. A button without one keeps the
   * bare text node it always had, so no existing button changes shape.
   */
  sublabel?: string;
  /**
   * A small pill at the trailing edge, for marking a control as paid.
   *
   * This existed twice before it existed here: the keycap generator grew `.kc-pill-badge` and
   * the clicker grew `.cg-pro-badge`, the same sparkle and the same word, drifting apart. Worse,
   * neither could reach the one control that most needed it — the clicker's "Draw your own
   * shape" button lives in FREE code, which cannot import a paid module's icon, so it shipped
   * with no marker at all and opened the purchase prompt cold.
   *
   * On the button rather than as a free-standing component because that is where it always
   * goes, and because a pill you have to remember to append is a pill three apps will forget.
   */
  badge?: string;
  /**
   * Extra classes for *placement only* — a grid area, a margin, an app-local hook.
   * Never a restyle: if the button needs to look different, it needs a new emphasis
   * on the ladder here, not an override in an app stylesheet.
   */
  className?: string;
  onClick?: (e: MouseEvent) => void;
}

/** A button that can be relabelled, disabled and put into its working state. */
export type ButtonHandle = HTMLButtonElement & {
  setLabel(text: string): void;
  /** Set or clear the quiet second line. Adds one if the button was built without it. */
  setSublabel(text: string): void;
  /** Show or hide the trailing pill. Only ever present if the button was built with one. */
  setBadge(text: string): void;
  /** Swap the leading icon. Adds one if the button was built without it. */
  setIcon(icon: string): void;
  setDisabled(disabled: boolean): void;
  /** Disabled *and* spinning, with `aria-busy`. The shape `exportPanel` uses. */
  setBusy(busy: boolean): void;
};

/** The standard button. `button({ label: 'Export', emphasis: 'primary' })`. */
export function button(opts: ButtonOptions): ButtonHandle {
  const classes = [EMPHASIS[opts.emphasis ?? 'plain']];
  if (opts.block) classes.push('vl-btn--block');
  if (opts.className) classes.push(opts.className);

  // A text node rather than a wrapping span, so no new class enters the stylesheet —
  // and `setLabel` writes to it directly, which is what keeps an icon from being
  // wiped the way a `.textContent =` on the button itself would wipe it.
  const text = document.createTextNode(opts.label);
  const node = el('button', {
    className: classes.join(' '),
    attrs: { type: 'button', ...(opts.title ? { title: opts.title } : {}) },
  }) as ButtonHandle;

  /* The label's container, created ONLY when there is a second line to stack under it. Without
     a sublabel the button keeps the bare text node it has always had, so nothing that exists
     today changes shape or gains a class. */
  let stack: HTMLElement | null = null;
  let sub: HTMLElement | null = null;
  const ensureStack = (): HTMLElement => {
    if (stack) return stack;
    stack = el('span', { className: 'vl-btn__text' });
    text.replaceWith(stack);
    stack.append(text);
    return stack;
  };

  let iconNode: SVGElement | null = opts.icon ? svgEl(opts.icon) : null;
  if (iconNode) node.append(iconNode);
  node.append(text);
  if (opts.sublabel) {
    sub = el('span', { className: 'vl-btn__sub', text: opts.sublabel });
    ensureStack().append(sub);
  }

  /* The sparkle is drawn here rather than taken from ICONS, because it is not an icon in the
     sense the rest of the ladder means: it is part of the pill, sized in `em` so it tracks the
     pill's own text, and it must never be swappable by `setIcon`. Four points, not a padlock —
     a padlock says "you cannot use this", and these controls open, configure and preview for
     free. Only the result costs. */
  let badgeNode: HTMLElement | null = null;
  if (opts.badge) {
    /* The label has to GROW once a pill is sharing the row, and it has to stop being centred.
       Left as a centred bare text node it gets squeezed by the pill's `margin-left: auto` and
       wraps to two lines with a pill floating beside the middle of them. Growing it left-aligned
       is what the keycap generator's card label does, and for the same reason. */
    node.classList.add('vl-btn--badged');
    ensureStack();
    badgeNode = el('span', { className: 'vl-btn__badge' });
    const spark = el('span', { className: 'vl-btn__badge-icon' });
    spark.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
      + '<path d="M12 2l2.2 6.4a2 2 0 0 0 1.4 1.4L22 12l-6.4 2.2a2 2 0 0 0-1.4 1.4L12 22l-2.2-6.4'
      + 'a2 2 0 0 0-1.4-1.4L2 12l6.4-2.2a2 2 0 0 0 1.4-1.4z"/></svg>';
    badgeNode.append(spark, el('span', { text: opts.badge }));
    node.append(badgeNode);
  }
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', (e) => opts.onClick!(e as MouseEvent));

  node.setLabel = (value) => {
    text.data = value;
  };
  node.setSublabel = (value) => {
    if (!value) {
      sub?.remove();
      sub = null;
      return;
    }
    if (!sub) {
      sub = el('span', { className: 'vl-btn__sub' });
      ensureStack().append(sub);
    }
    sub.textContent = value;
  };
  node.setBadge = (value) => {
    if (!badgeNode) return;
    badgeNode.hidden = !value;
    if (value) badgeNode.lastElementChild!.textContent = value;
  };
  node.setIcon = (icon) => {
    const next = svgEl(icon);
    if (iconNode) iconNode.replaceWith(next);
    // Before the label, which is the stack once there is a sublabel and the bare node before.
    else node.insertBefore(next, stack ?? text);
    iconNode = next;
  };
  node.setDisabled = (disabled) => {
    node.disabled = disabled;
  };
  // Matches exportPanel exactly: disabled, spinning and announced. `.vl-btn--busy`
  // draws on ::before precisely so relabelling cannot wipe the spinner.
  node.setBusy = (busy) => {
    node.disabled = busy;
    node.classList.toggle('vl-btn--busy', busy);
    if (busy) node.setAttribute('aria-busy', 'true');
    else node.removeAttribute('aria-busy');
  };
  return node;
}

export interface LinkButtonOptions {
  label: string;
  href: string;
  /** Default `plain`. The same ladder as `button()`. */
  emphasis?: ButtonEmphasis;
  /** Raw SVG string, i.e. a member of `ICONS`. Rendered before the label. */
  icon?: string;
  block?: boolean;
  /** Opens in a new tab. Only for a page that is not embedded: the hub, never a generator. */
  external?: boolean;
  /** Placement only, exactly as on `button()`. */
  className?: string;
}

/**
 * A link that looks like a button: the hub's "Open app", "Get it on MakerWorld" and every
 * other action that goes to an address rather than doing something on the page.
 *
 * An `<a>` and not a `<button>` with a click handler, because it is a navigation: it can be
 * opened in a new tab, it shows its address on hover, and it works in a page that was
 * rendered ahead of time with no script attached. The hub wrote these by hand as
 * `el('a', { className: 'vl-btn …' })`, which is the class-name-instead-of-a-component
 * pattern this file exists to end.
 */
export function linkButton(opts: LinkButtonOptions): HTMLAnchorElement {
  const classes = [EMPHASIS[opts.emphasis ?? 'plain']];
  if (opts.block) classes.push('vl-btn--block');
  if (opts.className) classes.push(opts.className);
  const node = el('a', {
    className: classes.join(' '),
    attrs: {
      href: opts.href,
      ...(opts.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
    },
  }) as HTMLAnchorElement;
  if (opts.icon) node.append(svgEl(opts.icon));
  node.append(document.createTextNode(opts.label));
  return node;
}

export interface IconButtonOptions extends Omit<ButtonOptions, 'label' | 'icon' | 'block'> {
  /** Raw SVG string, i.e. a member of `ICONS`. */
  icon: string;
  /** Required: the button has no text, so this is its whole accessible name. */
  label: string;
}

/** A square icon-only button. The label becomes `aria-label`, never visible text. */
export function iconButton(opts: IconButtonOptions): ButtonHandle {
  const classes = ['vl-btn', 'vl-btn--icon'];
  if (opts.emphasis && opts.emphasis !== 'plain') classes.push(`vl-btn--${opts.emphasis}`);
  if (opts.className) classes.push(opts.className);

  const node = el('button', {
    className: classes.join(' '),
    attrs: {
      type: 'button',
      'aria-label': opts.label,
      title: opts.title ?? opts.label,
    },
  }) as ButtonHandle;

  let iconNode = svgEl(opts.icon);
  node.append(iconNode);
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', (e) => opts.onClick!(e as MouseEvent));

  // No label node to swap, so setLabel moves the accessible name instead.
  node.setLabel = (value) => {
    node.setAttribute('aria-label', value);
    node.setAttribute('title', value);
  };
  // An icon button has no visible text, so it has nowhere to put a second line. Present so the
  // handle type is honest rather than optional at every call site.
  node.setSublabel = () => {};
  node.setBadge = () => {};
  node.setIcon = (icon) => {
    const next = svgEl(icon);
    iconNode.replaceWith(next);
    iconNode = next;
  };
  node.setDisabled = (disabled) => {
    node.disabled = disabled;
  };
  node.setBusy = (busy) => {
    node.disabled = busy;
    node.classList.toggle('vl-btn--busy', busy);
    if (busy) node.setAttribute('aria-busy', 'true');
    else node.removeAttribute('aria-busy');
  };
  return node;
}

/** Buttons side by side, sharing the width evenly (`.vl-btn-row`). */
export function buttonRow(...buttons: HTMLElement[]): HTMLElement {
  return el('div', { className: 'vl-btn-row' }, buttons);
}

export interface ButtonGridOptions {
  buttons: HTMLElement[];
  /** Columns. Default 2. */
  columns?: number;
}

/**
 * Buttons in a wrapping grid, all the same width.
 *
 * `buttonRow` is one flex line with `flex: 1` on each child, which is right for two or three
 * actions and wrong for a set of choices: the carabiner's six starter presets on one line are
 * six buttons too narrow to read their own names. A grid is the honest shape for "here are the
 * options" — and it is here rather than as an app-local class because the alternative, six
 * `.kc-preset-grid`-style rules across six generators, is precisely how `.vl-btn` acquired
 * 163 impostors.
 */
export function buttonGrid(opts: ButtonGridOptions): HTMLElement {
  const grid = el('div', { className: 'vl-btn-grid' }, opts.buttons);
  if (opts.columns) grid.style.setProperty('--btn-cols', String(opts.columns));
  return grid;
}
