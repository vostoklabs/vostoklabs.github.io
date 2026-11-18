// A build of an app at <site>/clicker/, as the package sees it: `import.meta.glob` answers each
// pattern with the matching font files' URLs in the app's assets folder, with a Vite-style hash,
// and `import.meta.env` carries VITE_SITE_FONTS as the Pages deploy sets it when the test runs
// with the argument `site`, and nothing (dev, preview, MakerLab, offline) when it runs with `app`.
// Injected ahead of everything else by the test command (`--inject`), with
// `--define:import.meta.glob=globalThis.__viteGlob` and `--define:import.meta.env=globalThis.__viteEnv`.
const FILES: Record<string, string> = {
  './fonts/source-han-sans-cn-light.otf': 'https://site.test/clicker/assets/source-han-sans-cn-light-DFp6YVuz.otf',
  './fonts/noto-sans-sc.ttf': 'https://site.test/clicker/assets/noto-sans-sc-C0o7kma7.ttf',
  './fonts/anton.ttf': 'https://site.test/clicker/assets/anton-Q1w2E3r4.ttf',
  './fonts/icon-fallback.ttf': 'https://site.test/clicker/assets/icon-fallback-Ic0n_F0n.ttf',
  './fonts/weights/roboto-bold.ttf': 'https://site.test/clicker/assets/roboto-bold-B0ld-123.ttf',
};
const matches = (pattern: string, key: string): boolean =>
  new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(key);
const g = globalThis as { __viteGlob?: (p: string | string[]) => Record<string, string>; __viteEnv?: Record<string, string> };
g.__viteGlob = (patterns) => Object.fromEntries(Object.entries(FILES).filter(([key]) => [patterns].flat().some((p) => matches(p, key))));
g.__viteEnv = process.argv[2] === 'site' ? { VITE_SITE_FONTS: 'shared/fonts/' } : {};
export {};
