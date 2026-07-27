# manifold-noeval

A rebuild of [manifold-3d](https://github.com/elalish/manifold) **v3.5.1** with
`-sDYNAMIC_EXECUTION=0`, vendored so the generators can run under a CSP without
`'unsafe-eval'`.

## Why this exists

MakerWorld's MakerLab review (2026-07-27) requires `script-src` to drop `'unsafe-eval'`
and keep only `'wasm-unsafe-eval'`.

The published npm build can't satisfy that. Emscripten's Embind generates a JS invoker for
every binding by assembling source text and calling `new Function(args, body)`
(`craftInvokerFunction`). That is dynamic code evaluation, so the stock `manifold.js`
requires `'unsafe-eval'` — and without it manifold fails to initialise, which means **no
geometry is generated at all** in either app.

Building with `-sDYNAMIC_EXECUTION=0` makes Emscripten emit its closure-based invoker path
instead. Same API, same results, no strings evaluated as code.

Verified: `new Function` occurrences went **2 → 0** versus the npm build.

## How it's wired in

The apps still depend on `manifold-3d` from npm — that keeps the TypeScript types — but
`resolve.alias` in `apps/keycap-generator/vite.config.js` and
`apps/clicker-generator/vite.config.ts` points the *runtime* import at this directory.
Both the public and MakerWorld builds use it, so there is only one geometry engine to
reason about.

## How it was built

```bash
git clone --depth 1 --branch v3.5.1 https://github.com/elalish/manifold.git
# add -sDYNAMIC_EXECUTION=0 to target_link_options in bindings/wasm/CMakeLists.txt
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:latest bash -c "\
  emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release -DMANIFOLD_PAR=OFF \
    -DMANIFOLD_TEST=OFF -DMANIFOLD_PYBIND=OFF -DMANIFOLD_JSBIND=ON \
    -DBUILD_SHARED_LIBS=OFF -DMANIFOLD_USE_BUILTIN_CLIPPER2=ON && \
  cmake --build build -j\$(nproc)"
# artifacts land in bindings/wasm/manifold.{js,wasm}
```

Built with emcc 6.0.4. Only the link flag differs from upstream v3.5.1 — no source changes.

## Equivalence check

Manifold carves every keycap legend and every clicker colour region, so the rebuild was
diffed against the npm build before adoption: identical construction and boolean sequences
run through both, comparing vertex arrays, triangle indices, volume, surface area and genus.

| Operation | Verts | Tris | Identical |
| --- | --- | --- | --- |
| cube | 8 | 12 | yes |
| sphere | 1026 | 2048 | yes |
| difference | 553 | 1102 | yes |
| union | 200 | 396 | yes |
| intersection | 840 | 1676 | yes |
| extrude | 88 | 176 | yes |
| carve | 96 | 188 | yes |
| hull | 521 | 1038 | yes |

All eight matched **bit-for-bit**.

## Upgrading

This is a hand-built artifact — `pnpm update manifold-3d` will **not** refresh it. When
bumping manifold, rebuild with the same flag, re-run the equivalence check against the new
npm version, and update the version noted above.

Upstream is Apache-2.0; see `LICENSE`.
