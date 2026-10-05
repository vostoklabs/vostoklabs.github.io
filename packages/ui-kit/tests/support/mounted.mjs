/*
  Run an app's real `mount()` under node, for a test that drives it.

  A mount test is a list of scenarios written against the app as it ships: the same mount.ts,
  the same export path, the same build loop. What node cannot run is swapped for a stand-in at
  bundle time, and only where the app's own source imports it:

    - `@vostok/ui-kit` becomes kit.ts in this folder: the kit's real build loop, worker transport,
      store and project-file reader, with its chrome recorded rather than drawn;
    - every stylesheet is empty;
    - whatever the app names in `replace`: its WebGL viewer, its heavier panels, the paid and host
      seams (`virtual:…`), each to the stand-in the test drives.

  dom.ts, clock.ts and worker.ts in this folder are the document, the timers and the Worker the
  scenarios install. They live here, beside the kit, because every app's mount test needs the
  same three, and kit.ts has to change whenever the kit's exports do.

  Used from an app's tests/ folder:

    import { runMounted } from '../../../packages/ui-kit/tests/support/mounted.mjs';
    await runMounted(new URL('./mount.scenarios.ts', import.meta.url), {
      replace: { './viewer/viewer': new URL('./mount.stand-ins.ts', import.meta.url) },
    });

  The bundle is written to the app's node_modules/.cache and imported; the scenarios end the
  process with their own exit code.
*/

import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT_STAND_IN = fileURLToPath(new URL('./kit.ts', import.meta.url));

/** A path as esbuild and node may each spell it on Windows, compared as one. */
const same = (p) => p.split('\\').join('/').toLowerCase();

/** The folder holding the nearest package.json above `file`: the app the test belongs to. */
function appOf(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  throw new Error(`no package.json above ${file}`);
}

/**
 * Bundle the scenarios at `entry` with the stand-ins in place, and run them.
 *
 * @param {URL} entry The scenarios: a .ts file in the app's tests/ folder.
 * @param {{ replace?: Record<string, URL>, define?: Record<string, string> }} [options]
 *   `replace`: import specifiers exactly as the app's source writes them, each to the stand-in
 *   file it gets instead. `define`: the compile-time constants the app's Vite config defines.
 */
export async function runMounted(entry, { replace = {}, define = {} } = {}) {
  const file = fileURLToPath(entry);
  const app = appOf(file);
  const appSource = same(join(app, 'src')) + '/';
  const cache = join(app, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const outfile = join(cache, `${basename(file).replace(/\.[cm]?[jt]s$/, '')}.mjs`);

  const standIns = {
    name: 'stand-ins',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'empty-stylesheet' }));
      b.onLoad({ filter: /.*/, namespace: 'empty-stylesheet' }, () => ({ contents: '', loader: 'js' }));
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point' || !same(a.importer).startsWith(appSource)) return null;
        if (a.path === '@vostok/ui-kit') return { path: KIT_STAND_IN };
        const to = replace[a.path];
        return to ? { path: fileURLToPath(to) } : null;
      });
    },
  };

  await build({
    entryPoints: [file],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
    logLevel: 'error',
    plugins: [standIns],
    define: { 'import.meta.env': JSON.stringify({ BASE_URL: './' }), ...define },
  });
  process.setSourceMapsEnabled?.(true);
  await import(pathToFileURL(outfile).href);
}
