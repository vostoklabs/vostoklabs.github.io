// `import.meta.glob` exists only under Vite. Under node the font files are read from disk by the
// test itself, so the package's URL table can stay empty. Injected ahead of everything else by
// the test command (`--inject`), with `--define:import.meta.glob=globalThis.__viteGlob`.
(globalThis as { __viteGlob?: () => Record<string, string> }).__viteGlob = () => ({});
export {};
