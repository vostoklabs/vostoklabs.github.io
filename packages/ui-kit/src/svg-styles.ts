/**
 * Resolve an SVG's CSS paint into presentation attributes, before three's `SVGLoader` reads it.
 *
 * SVGLoader reads paint from three places, weakest first: the attribute, a `<style>` rule that
 * matches the element's class or id, and the element's own `style=""`. The last two go through
 * the browser's CSSOM, and under a `style-src` with no 'unsafe-inline' they never arrive: a
 * `<style>` element in the parsed file gets no stylesheet and a `style` attribute gets an empty
 * `node.style`. An Illustrator export (`<style>.cls-1{fill:none;stroke:#000}</style>`) then
 * reads as SVGLoader's default, solid black, and an outline drawing arrives as a filled blob.
 *
 * So the cascade is resolved here, in the order SVGLoader would, into attributes: the one
 * place it reads that no policy can block. Class and id selectors only, because that is all
 * SVGLoader supports; anything else in a block is ignored by both. Paint set on a `<g>` lands on
 * the `<g>` and inherits through SVGLoader exactly as before.
 *
 * Ported from the keycap generator (`apps/keycap-generator/src/logo.js`), which found this
 * first and still carries its own JS copy. The fold-up box is the second app to need it, so the
 * shared copy is here; moving the keycap onto it is separate work.
 *
 * `getElementsByTagName` rather than `querySelectorAll`, so a headless test parsing with xmldom
 * (which lacks the latter) still works.
 */

/** The paint and visibility properties SVGLoader reads off an element. `transform` is left out
 *  on purpose: SVGLoader honours only the ATTRIBUTE, so a CSS transform must stay ignored rather
 *  than become one. */
const PAINT_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'opacity', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linejoin', 'stroke-linecap', 'stroke-miterlimit', 'visibility', 'display',
]);

/** `fill:none; stroke: #000` -> `{ fill: 'none', stroke: '#000' }`, paint properties only. */
function parseDecls(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (text ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).replace(/!important/i, '').trim();
    if (PAINT_PROPS.has(k) && v) out[k] = v;
  }
  return out;
}

/** The markup with every element's CSS paint written into attributes, and every `<style>`
 *  block and `style` attribute removed. Returns the input untouched when there is nothing to
 *  resolve, or when it is not an SVG at all (so the caller's parser reports that as before). */
export function flattenSvgStyles(svgText: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  } catch {
    return svgText;
  }
  const root = doc?.documentElement;
  if (!root || root.nodeName !== 'svg') return svgText;

  /** selector -> declarations, in source order so a later rule wins as it does in CSS. */
  const rules = new Map<string, Record<string, string>>();
  for (const styleEl of Array.from(root.getElementsByTagName('style'))) {
    const css = (styleEl.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = parseDecls(m[2] ?? '');
      if (!Object.keys(decls).length) continue;
      for (const sel of (m[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        rules.set(sel, Object.assign(rules.get(sel) ?? {}, decls));
      }
    }
  }

  let touched = false;
  for (const node of Array.from(root.getElementsByTagName('*'))) {
    if (node.nodeName === 'style') continue;
    const decls: Record<string, string> = {};
    for (const cls of (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
      Object.assign(decls, rules.get('.' + cls));
    }
    const id = node.getAttribute('id');
    if (id) Object.assign(decls, rules.get('#' + id));
    Object.assign(decls, parseDecls(node.getAttribute('style')));
    for (const [k, v] of Object.entries(decls)) {
      if (node.getAttribute(k) === v) continue;
      node.setAttribute(k, v);
      touched = true;
    }
    // Resolved, so it goes. Left in, SVGLoader parses it again on its own, which is exactly the
    // parse such a policy refuses.
    if (node.hasAttribute('style')) {
      node.removeAttribute('style');
      touched = true;
    }
  }
  for (const styleEl of Array.from(root.getElementsByTagName('style'))) {
    styleEl.parentNode?.removeChild(styleEl);
    touched = true;
  }
  return touched ? new XMLSerializer().serializeToString(root) : svgText;
}
