// Tiny DOM helper, keeps components dependency-free and readable.

interface ElProps {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
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
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
