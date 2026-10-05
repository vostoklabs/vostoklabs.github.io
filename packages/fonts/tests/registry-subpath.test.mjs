/*
  pnpm --filter @vostok/fonts test

  `@vostok/fonts/registry` must load in plain node, by the package's own name. That is how Vite
  loads an app's vite.config.ts: it bundles the config and hands the bare imports to node as
  they are, so a config that names the faces it keeps (with keepOnlyFonts) reaches the list
  through node, with no bundler in between. registry.ts is TypeScript that node strips by itself,
  and it imports nothing, so nothing further has to resolve.
*/
const registry = await import('@vostok/fonts/registry');
const vite = await import('@vostok/fonts/vite');

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};
ok(Array.isArray(registry.FONTS) && registry.FONTS.length > 200, `FONTS through @vostok/fonts/registry: ${registry.FONTS?.length}`);
ok(Array.isArray(registry.WEIGHTS) && registry.WEIGHTS.some((f) => f.id === 'roboto-bold'), 'WEIGHTS beside it');
ok(typeof vite.keepOnlyFonts === 'function' && vite.keepOnlyFonts(['anton']).name === 'vostok:keep-only-fonts', 'keepOnlyFonts through @vostok/fonts/vite');
console.log(failed ? `registry subpath: ${failed} FAILED` : 'registry subpath: loads in node by the package name, and so does the build plugin');
process.exit(failed ? 1 : 0);
