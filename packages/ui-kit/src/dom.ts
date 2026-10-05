// Tiny DOM helper, keeps components dependency-free and readable.

let lastId = 0;

/**
 * A document-unique id, for pointing a label or a description at its control.
 *
 * A counter, not a clock. The fields used `performance.now()`, which browsers coarsen to tens of
 * microseconds, so two fields built in the same loop got the same id and the second label
 * pointed at the first field.
 */
export function uid(prefix = 'vl'): string {
  lastId += 1;
  return `${prefix}-${lastId}`;
}

interface ElProps {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/**
 * Make an element with its class, attributes, listeners and children in one call.
 *
 * The short form `el(tag, className, text)` makes a plain element with a class and its text, the
 * shape of the small helper several files had each written for themselves.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K];
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | null | undefined,
  text?: string | number | null,
): HTMLElementTagNameMap[K];
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps | string | null = {},
  children: (Node | string)[] | string | number | null = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // Each argument is read for what it is, so one form can never swallow the other's half.
  if (typeof props === 'string' || props === null) {
    if (props) node.className = props;
  } else {
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        // `style` goes through the CSSOM, never `setAttribute`. A `style-src` policy with no
        // 'unsafe-inline' refuses a style ATTRIBUTE set from script, and reports it only in the
        // console: every filament swatch and colour chip rendered transparent, because `--swatch`
        // never landed. Assigning `cssText` is a
        // CSSOM write, which the directive does not cover.
        if (k === 'style') node.style.cssText = v;
        else node.setAttribute(k, v);
      }
    }
    if (props.on) {
      for (const [k, fn] of Object.entries(props.on)) {
        if (fn) node.addEventListener(k, fn as EventListener);
      }
    }
  }
  if (typeof children === 'string' || typeof children === 'number') {
    node.append(String(children));
  } else {
    for (const child of children ?? []) {
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * An SVG element with its attributes: `el()` for SVG, which `document.createElement` cannot
 * make. (`svgEl()` in `icons.ts` is a different thing: it parses a string of markup.) A `style`
 * attribute goes through the CSSOM for the same reason as in `el()`.
 */
export function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: Node[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style.cssText = String(v);
    else node.setAttribute(k, String(v));
  }
  node.append(...children);
  return node;
}
