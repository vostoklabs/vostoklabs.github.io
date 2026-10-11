// The cut half of the app behind one door: the files a cutting machine reads.
//
// `virtual:cut-pack` resolves here in `--mode full` (the site's build and `pnpm dev`) and in
// `--mode makerworld`, where the zip goes to the host instead of to a download, which is what
// `buildCutFiles` is exposed for. A build with no mode resolves to the stub in vite.config.ts
// instead: the print-only app, with no cut UI, copy or format string in it.

export { buildCutFiles, downloadCutFiles } from './cutFiles';
