// `import.meta.glob` for the node tests that need the font files themselves: every pattern this
// package globs, answered with `file://` URLs of the real files on disk, as Vite answers it with
// asset URLs in a build. Injected ahead of everything else by the test command (`--inject`),
// with `--define:import.meta.glob=globalThis.__viteGlob`. The fetch beside it reads those URLs,
// which node's own fetch does not.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// cwd, not `import.meta.url`: esbuild bundles this into node_modules/.cache.
const SRC = join(process.cwd(), 'src');

(globalThis as { __viteGlob?: (pattern: string) => Record<string, string> }).__viteGlob = (pattern: string) => {
  const out: Record<string, string> = {};
  const rel = pattern.replace(/^\.\//, '');
  const slash = rel.lastIndexOf('/');
  const dir = join(SRC, rel.slice(0, slash));
  const name = rel.slice(slash + 1);
  if (!existsSync(dir)) return out;
  const match = new RegExp(`^${name.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);
  for (const f of readdirSync(dir)) if (match.test(f)) out[`./${rel.slice(0, slash)}/${f}`] = pathToFileURL(join(dir, f)).href;
  return out;
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('file:')) return realFetch(input, init);
  const bytes = readFileSync(fileURLToPath(url));
  return new Response(bytes);
}) as typeof fetch;

export {};
