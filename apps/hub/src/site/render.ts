// Turns a page into the two strings the HTML template takes: what goes in <head> and what
// goes in #app. Runs at build time (and in the dev server) under a DOM shim, never in the
// browser, so every page arrives as finished HTML.

import { BRAND } from '@vostok/brand';
import { header, footer } from './layout';
import { allPages, type Page } from './pages';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function head(page: Page): string {
  const url = `${BRAND.urls.hub}${page.path}`;
  return [
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
  ].join('\n    ');
}

export function paths(): string[] {
  return allPages().map((p) => p.path);
}

export function renderPage(path: string): { title: string; head: string; body: string } | null {
  const page = allPages().find((p) => p.path === path);
  if (!page) return null;
  const main = document.createElement('main');
  main.className = 'hub-main';
  main.append(...page.render());
  const body = [header(page.path), main, footer()].map((n) => n.outerHTML).join('\n');
  return { title: esc(page.title), head: head(page), body };
}

export function sitemap(): string {
  const urls = paths()
    .filter((p) => p.endsWith('/'))
    .map((p) => `  <url><loc>${BRAND.urls.hub}${p}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
