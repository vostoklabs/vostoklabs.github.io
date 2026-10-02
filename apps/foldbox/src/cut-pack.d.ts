/** True only in the `--mode full` build, and replaced by that literal at build time
 *  (`define`, vite.config.ts) — so every `if (CUT)` branch in the print-only build is
 *  `if (false)`, which the bundler removes along with everything inside it. */
declare const __FOLDBOX_CUT__: boolean;

declare module 'virtual:cut-pack' {
  export function downloadCutFiles(
    result: import('./types').SolveResult,
    meta: import('./export/cutFiles').CutMeta,
  ): import('./export/cutFiles').CutFiles;
}
