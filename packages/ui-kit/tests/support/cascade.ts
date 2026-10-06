/*
  The kit's stylesheets, cascaded onto the stand-in document (mini-dom.ts), for tests of what a
  rule does rather than what an element carries: which value wins for a property on an element,
  at a window width, with the theme and density the document root says.

  It reads src/styles.css and the files it imports, in that order, and resolves the cascade the
  way a browser does for the resting state: media queries by width (reduced motion and the
  colour-scheme queries are off; the theme comes from `data-theme`), specificity, order,
  `!important`, inline styles, inherited properties and custom properties with `var()`.
  Interaction states (`:hover`, `:focus-visible`...) never match, and a pseudo-element's rule
  styles no element. No layout: a value is the declared one, `calc()` and all.

  Tests run from the package's folder (`pnpm --filter @vostok/ui-kit test`), which is where the
  stylesheets are looked for.
*/
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { miniDocument, type MiniElement } from './mini-dom';

export interface CssRule {
  selectors: string[];
  media: string[];
  decls: { prop: string; value: string; important: boolean }[];
  order: number;
}

/* ------------------------------------------------------------------------- parsing -- */

/** Split at a delimiter outside (), [] and quotes. */
export function splitTop(s: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === delim && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseDecls(body: string): CssRule['decls'] {
  const out: CssRule['decls'] = [];
  for (const d of splitTop(body, ';')) {
    const colon = d.indexOf(':');
    if (colon < 0) continue;
    const prop = d.slice(0, colon).trim().toLowerCase();
    let value = d.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    out.push({ prop, value, important });
  }
  return out;
}

/** Rules in order, each with the media queries it sits under. */
export function parseCss(css: string, rules: CssRule[] = []): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (s: string, media: string[]) => {
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i]!)) i++;
      if (i >= s.length) break;
      let j = i;
      let depth = 0;
      let quote = '';
      while (j < s.length) {
        const ch = s[j]!;
        if (quote) { if (ch === quote) quote = ''; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (depth === 0 && (ch === '{' || ch === ';')) break;
        j++;
      }
      const prelude = s.slice(i, j).trim();
      if (j >= s.length) break;
      if (s[j] === ';') { i = j + 1; continue; }
      let k = j + 1;
      let open = 1;
      quote = '';
      while (k < s.length && open) {
        const ch = s[k]!;
        if (quote) { if (ch === quote) quote = ''; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '{') open++;
        else if (ch === '}') open--;
        k++;
      }
      const body = s.slice(j + 1, k - 1);
      i = k;
      if (prelude.startsWith('@')) {
        const name = prelude.slice(1).split(/[\s(]/)[0]!.toLowerCase();
        const params = prelude.slice(1 + name.length).trim();
        if (name === 'media') walk(body, [...media, params]);
        else if (name === 'supports' || name === 'layer') walk(body, media);
        // @keyframes, @font-face: nothing there styles an element.
        continue;
      }
      rules.push({ selectors: splitTop(prelude, ','), media, decls: parseDecls(body), order: rules.length });
    }
  };
  walk(src, []);
  return rules;
}

/** The kit's stylesheets in import order, as one list of rules. */
export function kitRules(extraCss = ''): CssRule[] {
  const dir = join(process.cwd(), 'src');
  const entry = join(dir, 'styles.css');
  if (!existsSync(entry)) throw new Error(`cascade: no ${entry}; run the kit's tests from packages/ui-kit`);
  const files = [...readFileSync(entry, 'utf8').matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]!);
  const rules: CssRule[] = [];
  for (const f of files) parseCss(readFileSync(join(dir, f), 'utf8'), rules);
  if (extraCss) parseCss(extraCss, rules);
  return rules;
}

/* ----------------------------------------------------------------------- selectors -- */

type Complex = { compound: string; combinator: string }[];

function parseComplex(s: string): Complex {
  const parts: Complex = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  let comb = ' ';
  const flush = () => {
    if (cur.trim()) { parts.push({ compound: cur.trim(), combinator: comb }); comb = ' '; }
    cur = '';
  };
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) { flush(); comb = ch; continue; }
    if (depth === 0 && /\s/.test(ch)) { flush(); continue; }
    cur += ch;
  }
  flush();
  return parts;
}

interface Simple { kind: 'tag' | 'class' | 'id' | 'attr' | 'pseudo' | 'element' | 'any'; name: string; arg?: string; op?: string; value?: string }

function parseCompound(c: string): Simple[] {
  const out: Simple[] = [];
  let i = 0;
  const ident = () => {
    let s = '';
    while (i < c.length && /[\w-]/.test(c[i]!)) s += c[i++];
    return s;
  };
  while (i < c.length) {
    const ch = c[i]!;
    if (ch === '*') { i++; out.push({ kind: 'any', name: '*' }); continue; }
    if (ch === '.') { i++; out.push({ kind: 'class', name: ident() }); continue; }
    if (ch === '#') { i++; out.push({ kind: 'id', name: ident() }); continue; }
    if (ch === '[') {
      let j = i + 1;
      let quote = '';
      while (j < c.length && (quote || c[j] !== ']')) {
        if (quote) { if (c[j] === quote) quote = ''; } else if (c[j] === '"' || c[j] === "'") quote = c[j]!;
        j++;
      }
      const body = c.slice(i + 1, j);
      i = j + 1;
      const m = body.match(/^\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*$/);
      if (!m) throw new Error(`cascade: attribute selector [${body}]`);
      out.push({ kind: 'attr', name: m[1]!, op: m[2], value: m[3] ?? m[4] ?? m[5] });
      continue;
    }
    if (ch === ':') {
      const element = c[i + 1] === ':';
      i += element ? 2 : 1;
      const name = ident();
      let arg: string | undefined;
      if (c[i] === '(') {
        let depth = 1;
        let j = i + 1;
        while (j < c.length && depth) { if (c[j] === '(') depth++; if (c[j] === ')') depth--; j++; }
        arg = c.slice(i + 1, j - 1);
        i = j;
      }
      out.push({ kind: element || ['before', 'after', 'first-line', 'first-letter'].includes(name) ? 'element' : 'pseudo', name, arg });
      continue;
    }
    if (/[\w-]/.test(ch)) { out.push({ kind: 'tag', name: ident().toLowerCase() }); continue; }
    throw new Error(`cascade: selector ${c}`);
  }
  return out;
}

const siblings = (e: MiniElement) => (e.parentNode ? e.parentNode.children : [e]);

function nth(arg: string, n: number): boolean {
  const a = arg.replace(/\s+/g, '');
  if (a === 'odd') return n % 2 === 1;
  if (a === 'even') return n % 2 === 0;
  if (/^\d+$/.test(a)) return n === Number(a);
  const m = a.match(/^([+-]?\d*)n([+-]\d+)?$/);
  if (!m) return false;
  const k = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  const b = Number(m[2] ?? 0);
  if (k === 0) return n === b;
  const t = (n - b) / k;
  return t >= 0 && Number.isInteger(t);
}

const INERT_STATES = new Set([
  'hover', 'active', 'focus', 'focus-visible', 'focus-within', 'visited', 'link', 'any-link', 'placeholder-shown',
  'indeterminate', 'invalid', 'valid', 'target', 'popover-open', 'modal', 'fullscreen', 'autofill', '-webkit-autofill',
]);

function matchSimple(e: MiniElement, s: Simple): boolean {
  switch (s.kind) {
    case 'any': return true;
    case 'tag': return e.localName === s.name;
    case 'class': return e.classList.contains(s.name);
    case 'id': return e.getAttribute('id') === s.name;
    case 'element': return false;
    case 'attr': {
      const v = e.getAttribute(s.name);
      if (v === null) return false;
      if (!s.op) return true;
      const want = s.value ?? '';
      if (s.op === '=') return v === want;
      if (s.op === '~=') return v.split(/\s+/).includes(want);
      if (s.op === '^=') return v.startsWith(want);
      if (s.op === '$=') return v.endsWith(want);
      if (s.op === '*=') return v.includes(want);
      return v === want || v.startsWith(`${want}-`);
    }
    case 'pseudo': {
      const sibs = siblings(e);
      const i = sibs.indexOf(e);
      if (INERT_STATES.has(s.name)) return false;
      switch (s.name) {
        case 'root': return e === miniDocument.documentElement;
        case 'not': return !splitTop(s.arg!, ',').some((x) => matches(e, x));
        case 'is': case 'where': return splitTop(s.arg!, ',').some((x) => matches(e, x));
        case 'has': return splitTop(s.arg!, ',').some((x) => hasRelative(e, x));
        case 'first-child': return i === 0;
        case 'last-child': return i === sibs.length - 1;
        case 'only-child': return sibs.length === 1;
        case 'nth-child': return nth(s.arg!, i + 1);
        case 'nth-last-child': return nth(s.arg!, sibs.length - i);
        case 'first-of-type': return sibs.filter((x) => x.localName === e.localName)[0] === e;
        case 'last-of-type': { const t = sibs.filter((x) => x.localName === e.localName); return t[t.length - 1] === e; }
        case 'empty': return e.childNodes.length === 0;
        case 'checked': return !!e.checked;
        case 'disabled': return e.disabled;
        case 'enabled': return !e.disabled;
        case 'defined': return true;
      }
      throw new Error(`cascade: :${s.name}`);
    }
  }
}

const matchCompound = (e: MiniElement, compound: string) => parseCompound(compound).every((s) => matchSimple(e, s));

function matchFrom(e: MiniElement, sel: Complex, k: number): boolean {
  const part = sel[k]!;
  if (!matchCompound(e, part.compound)) return false;
  if (k === 0) return true;
  if (part.combinator === '>') return !!e.parentNode && matchFrom(e.parentNode, sel, k - 1);
  if (part.combinator === ' ') {
    for (let p = e.parentNode; p; p = p.parentNode) if (matchFrom(p, sel, k - 1)) return true;
    return false;
  }
  const sibs = siblings(e);
  const i = sibs.indexOf(e);
  if (part.combinator === '+') return i > 0 && matchFrom(sibs[i - 1]!, sel, k - 1);
  return sibs.slice(0, i).some((s) => matchFrom(s, sel, k - 1));
}

export function matches(e: MiniElement, selector: string): boolean {
  const sel = parseComplex(selector);
  return matchFrom(e, sel, sel.length - 1);
}

/** `:has(> a b)`, `:has(a)`, `:has(+ a)`: does the relative selector find an element from `e`? */
function hasRelative(e: MiniElement, rel: string): boolean {
  const r = rel.trim();
  const lead = r[0] === '>' || r[0] === '+' || r[0] === '~' ? r[0] : ' ';
  const sel = parseComplex(lead === ' ' ? r : r.slice(1).trim());
  // Anchor the chain's first compound to `e` with the leading combinator, then match the rest.
  const anchored = (first: MiniElement) => matchCompound(first, sel[0]!.compound) && (sel.length === 1 || matchRest(first, 1));
  const matchRest = (from: MiniElement, k: number): boolean => {
    const part = sel[k]!;
    const pool: MiniElement[] = [];
    if (part.combinator === '>') pool.push(...from.children);
    else if (part.combinator === ' ') { const walk = (n: MiniElement) => { for (const c of n.children) { pool.push(c); walk(c); } }; walk(from); }
    else { const s = siblings(from); const i = s.indexOf(from); pool.push(...(part.combinator === '+' ? s.slice(i + 1, i + 2) : s.slice(i + 1))); }
    return pool.some((c) => matchCompound(c, part.compound) && (k === sel.length - 1 || matchRest(c, k + 1)));
  };
  if (lead === '>') return e.children.some(anchored);
  if (lead === ' ') { const all: MiniElement[] = []; const walk = (n: MiniElement) => { for (const c of n.children) { all.push(c); walk(c); } }; walk(e); return all.some(anchored); }
  const s = siblings(e);
  const i = s.indexOf(e);
  return (lead === '+' ? s.slice(i + 1, i + 2) : s.slice(i + 1)).some(anchored);
}

type Spec = [number, number, number];
function specificity(selector: string): Spec {
  let a = 0, b = 0, c = 0;
  for (const part of parseComplex(selector)) {
    for (const s of parseCompound(part.compound)) {
      if (s.kind === 'id') a++;
      else if (s.kind === 'class' || s.kind === 'attr') b++;
      else if (s.kind === 'tag' || s.kind === 'element') c++;
      else if (s.kind === 'pseudo' && s.name !== 'where') {
        if (s.name === 'not' || s.name === 'is' || s.name === 'has') {
          const best = splitTop(s.arg!, ',').map((x) => specificity(x.replace(/^[>+~]\s*/, ''))).sort(bySpec).pop() ?? [0, 0, 0];
          a += best[0]; b += best[1]; c += best[2];
        } else b++;
      }
    }
  }
  return [a, b, c];
}
const bySpec = (x: Spec, y: Spec) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/* ------------------------------------------------------------------------- the cascade -- */

function mediaMatches(query: string, width: number): boolean {
  return query.split(',').some((part) => {
    const p = part.trim();
    if (/^print\b/.test(p)) return false;
    const ok = [...p.matchAll(/\(([^)]+)\)/g)].every(([, raw]) => {
      const c = raw!.trim();
      let m = c.match(/^max-width:\s*([\d.]+)px$/);
      if (m) return width <= Number(m[1]);
      m = c.match(/^min-width:\s*([\d.]+)px$/);
      if (m) return width >= Number(m[1]);
      if (/^(prefers-reduced-motion|prefers-color-scheme|forced-colors)/.test(c)) return false;
      if (/^hover:\s*hover|^pointer:\s*fine/.test(c)) return true;
      if (/^(any-)?pointer:\s*coarse/.test(c)) return false;
      throw new Error(`cascade: media feature (${c})`);
    });
    return /^not\b/.test(p) ? !ok : ok;
  });
}

const SIDES = ['top', 'right', 'bottom', 'left'];
function sides(v: string): string[] {
  const t = splitTop(v, ' ');
  const [a, b = a, c = a, d = b] = t;
  return [a!, b!, c!, d!];
}

/** The longhands a shorthand sets, for the shorthands the kit writes. */
function longhands(prop: string, value: string): [string, string][] {
  const v = value.trim();
  switch (prop) {
    case 'inset': return sides(v).map((x, i) => [SIDES[i]!, x]);
    case 'padding': case 'margin': return sides(v).map((x, i) => [`${prop}-${SIDES[i]}`, x]);
    case 'padding-inline': case 'margin-inline': { const [s, e = s] = splitTop(v, ' '); const p = prop.split('-')[0]; return [[`${p}-left`, s!], [`${p}-right`, e!]]; }
    case 'padding-block': case 'margin-block': { const [s, e = s] = splitTop(v, ' '); const p = prop.split('-')[0]; return [[`${p}-top`, s!], [`${p}-bottom`, e!]]; }
    case 'gap': { const [r, c = r] = splitTop(v, ' '); return [['row-gap', r!], ['column-gap', c!]]; }
    case 'overflow': { const [x, y = x] = splitTop(v, ' '); return [['overflow-x', x!], ['overflow-y', y!]]; }
    case 'flex': {
      if (v === 'none') return [['flex-grow', '0'], ['flex-shrink', '0'], ['flex-basis', 'auto']];
      if (v === 'auto') return [['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', 'auto']];
      const t = splitTop(v, ' ');
      if (t.length === 1) return /^[\d.]+$/.test(t[0]!) ? [['flex-grow', t[0]!], ['flex-shrink', '1'], ['flex-basis', '0%']] : [['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', t[0]!]];
      if (t.length === 2) return /^[\d.]+$/.test(t[1]!) ? [['flex-grow', t[0]!], ['flex-shrink', t[1]!], ['flex-basis', '0%']] : [['flex-grow', t[0]!], ['flex-shrink', '1'], ['flex-basis', t[1]!]];
      return [['flex-grow', t[0]!], ['flex-shrink', t[1]!], ['flex-basis', t[2]!]];
    }
    case 'font': return v === 'inherit' ? ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'].map((p) => [p, 'inherit'] as [string, string]) : [['font', v]];
  }
  return [[prop, v]];
}

const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'visibility', 'white-space', 'cursor']);

interface Computed { props: Map<string, string>; custom: Map<string, string> }

function compute(e: MiniElement, rules: CssRule[], width: number, parent: Computed | null): Computed {
  type Win = { value: string; important: boolean; spec: Spec; order: number };
  const won = new Map<string, Win>();
  const offer = (prop: string, w: Win) => {
    const cur = won.get(prop);
    const better = !cur || (w.important !== cur.important ? w.important : bySpec(w.spec, cur.spec) !== 0 ? bySpec(w.spec, cur.spec) > 0 : w.order >= cur.order);
    if (better) won.set(prop, w);
  };
  let n = 0;
  for (const r of rules) {
    if (!r.media.every((m) => mediaMatches(m, width))) continue;
    const spec = r.selectors.filter((s) => matches(e, s)).map(specificity).sort(bySpec).pop();
    if (!spec) continue;
    for (const d of r.decls) for (const [p, v] of longhands(d.prop, d.value)) offer(p, { value: v, important: d.important, spec, order: r.order * 1000 + n++ });
  }
  for (const part of splitTop(e.style.cssText, ';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    for (const [p, v] of longhands(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim())) {
      offer(p, { value: v, important: false, spec: [1e6, 0, 0], order: 1e12 });
    }
  }
  const custom = new Map(parent?.custom ?? []);
  for (const [p, w] of won) if (p.startsWith('--')) custom.set(p, w.value);
  const resolve = (v: string, depth = 0): string =>
    depth > 20 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fallback?: string) =>
      resolve(custom.get(name) ?? fallback ?? '', depth + 1));
  for (const [name, raw] of custom) custom.set(name, resolve(raw));
  const props = new Map<string, string>();
  for (const [p, w] of won) {
    if (p.startsWith('--')) continue;
    const v = resolve(w.value).replace(/\s+/g, ' ').trim();
    props.set(p, v === 'inherit' ? parent?.props.get(p) ?? '' : v);
  }
  if (parent) for (const p of INHERITED) if (!props.has(p) && parent.props.has(p)) props.set(p, parent.props.get(p)!);
  return { props, custom };
}

/** Everything that cascades onto `e` at a window `width`: its properties, `var()`s resolved. */
export function computedStyle(e: MiniElement, rules: CssRule[], width: number): Map<string, string> {
  const chain: MiniElement[] = [];
  for (let n: MiniElement | null = e; n; n = n.parentNode) chain.unshift(n);
  let c: Computed | null = null;
  for (const n of chain) c = compute(n, rules, width, c);
  return c!.props;
}

/** One property of `e` at a window `width`; '' when no rule sets it. */
export const cssValue = (e: MiniElement, prop: string, rules: CssRule[], width: number): string =>
  computedStyle(e, rules, width).get(prop) ?? '';
