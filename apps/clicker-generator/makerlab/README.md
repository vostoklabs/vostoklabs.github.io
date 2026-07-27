# MakerWorld (MakerLab) build

The public app and the MakerWorld ("MakerLab") app are **one codebase**. MakerWorld is just a
build target: the same `src/` produces both, and the MakerWorld-specific behaviour is switched
on by a build flag.

## What differs in the MakerWorld build

Everything is gated on the `MAKERLAB` flag from the `virtual:makerlab` module (see
`vite.config.ts`):

- **No topbar** — the shared Vostok header is not mounted (MakerWorld provides its own chrome).
- **Export goes through the host** — instead of a browser download, the 3MF is sent
  to MakerWorld as a ZIP containing the `.3mf` (via the SDK `export()` API), with a preview
  cover image. Standalone/public still downloads the `.3mf` directly.
- **No license modals** — the license reminder modal and toast are suppressed; licensing is
  handled by MakerWorld's own platform.
- **No quality callout link** — the MakerWorld print-profile link is suppressed (external links
  don't work in the sandboxed iframe).
- **Handshake** — the SDK connects to the host on load (`initMakerlab`).

The public build resolves `virtual:makerlab` to a tiny no-op stub, so it never touches the SDK
and behaves exactly as before.

## NDA note — files you must reconstruct

The MakerLab SDK is proprietary/NDA and is **gitignored**. After a fresh clone, repopulate:

- `src/makerlab/lib/index.js`, `src/makerlab/lib/index.d.ts` — copy from the SDK zip's `lib/`.
- `makerlab/server.cjs` — copy from the SDK zip's `server.cjs` (local host simulator).

`src/makerlab/glue.ts`, `makerlab/config.json`, and `makerlab/pack.mjs` are our own code and
are committed.

## Commands

```bash
# Produce the submission zip (dist/ + config.json) → makerlab/clicker-generator-mw.zip
npm run pack:mw

# Preview the MakerWorld build locally, embedded in the host simulator:
npm run build:mw          # build with the MakerWorld flag
npm run preview:mw        # serve the build at http://localhost:5174  (terminal 1)
npm run serve:mw          # host simulator at http://localhost:8001   (terminal 2)
# → open http://localhost:8001
```

The normal `npm run dev` / `npm run build` are unchanged and never include the SDK.
