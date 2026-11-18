# STL to STEP

An STL exported from a CAD program, back into a STEP file with real faces and edges: flat,
cylinder, cone, sphere, torus, revolved, extruded and free-form faces. It runs in the browser;
the file never leaves the computer.

```bash
pnpm dev:stlToStep
```

- `src/main.ts` — the page: drop an STL, the STL and the STEP side by side (Edges or Colors),
  the file check, Download STEP.
- `src/worker.ts` — the conversion, off the page's thread.
- The engine is `@vostok/mesh-to-cad` (`packages/mesh-to-cad`). A face that does not close with
  its neighbours is written as the STL's own flat facets, so the STEP is always one closed solid.
