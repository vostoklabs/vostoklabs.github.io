// Prerenders the hub: every page in src/site/pages.ts becomes its own index.html, written at
// build time and served the same way by the dev server. GitHub Pages serves folders, so
// /generators/clicker/ is the file generators/clicker/index.html; nothing has to route.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { parseHTML } from 'linkedom';

const RENDER = '/src/site/render.ts';
const HEAD = '<!--site-head-->';
const BODY = '<!--site-body-->';

type Render = typeof import('./src/site/render');

// The kit builds elements through `document`; a shim gives it one outside the browser.
function installDom(): void {
  if ((globalThis as { __hubDom?: boolean }).__hubDom) return;
  const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  const g = globalThis as Record<string, unknown>;
  g.window = window;
  g.document = document;
  for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'DocumentFragment', 'Text', 'Event', 'CustomEvent']) {
    g[k] ??= (window as unknown as Record<string, unknown>)[k];
  }
  g.__hubDom = true;
}

// The template keeps a <title> of its own (the third-party notices name the hub by it); each
// page swaps in its own rather than adding a second.
function fill(template: string, page: { title: string; head: string; body: string }): string {
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`)
    .replace(HEAD, page.head)
    .replace(BODY, page.body);
}

/** /make -> /make/, /make/index.html -> /make/, so one page has one address. */
function normalise(url: string): string {
  const path = decodeURI(url.split(/[?#]/)[0]);
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  return path;
}

export function sitePages(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'hub-site-pages',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server: ViteDevServer) {
      installDom();
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.url) return next();
        const path = normalise(req.url);
        try {
          const mod = (await server.ssrLoadModule(RENDER)) as Render;
          const known = mod.paths();
          if (!path.endsWith('/') && known.includes(`${path}/`)) {
            res.statusCode = 301;
            res.setHeader('Location', `${path}/`);
            return res.end();
          }
          if (!known.includes(path)) return next();
          const page = mod.renderPage(path)!;
          const template = readFileSync(join(root, 'index.html'), 'utf8');
          const html = await server.transformIndexHtml(req.url, fill(template, page));
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          next(err);
        }
      });
    },
    // The client bundle is built from index.html as usual; its output is the template.
    async closeBundle() {
      installDom();
      const vite = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
      try {
        const mod = (await vite.ssrLoadModule(RENDER)) as Render;
        const template = readFileSync(join(outDir, 'index.html'), 'utf8');
        for (const path of mod.paths()) {
          const file = path.endsWith('/') ? join(outDir, path, 'index.html') : join(outDir, path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, fill(template, mod.renderPage(path)!));
        }
        writeFileSync(join(outDir, 'sitemap.xml'), mod.sitemap());
      } finally {
        await vite.close();
      }
    },
  };
}
