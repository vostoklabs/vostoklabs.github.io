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
export type ButtonEmphasis = 'primary' | 'secondary' | 'ghost' | 'plain';

const EMPHASIS: Record<ButtonEmphasis, string> = {
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

  let iconNode: SVGElement | null = opts.icon ? svgEl(opts.icon) : null;
  if (iconNode) node.append(iconNode);
  node.append(text);
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', (e) => opts.onClick!(e as MouseEvent));

  node.setLabel = (value) => {
    text.data = value;
  };
  node.setIcon = (icon) => {
    const next = svgEl(icon);
    if (iconNode) iconNode.replaceWith(next);
    else node.insertBefore(next, text);
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
