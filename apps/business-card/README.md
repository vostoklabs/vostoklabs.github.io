# Business Card Generator

Pick a template, type your details, print a business card.

```bash
pnpm --filter business-card dev
```

Scaffolded from `apps/generator-template` with `pnpm new:generator`. That template's
[README](../generator-template/README.md) is still the reference for the layout, the rules
for the rail's categories and the settings in them, the numbered `main.ts` walkthrough, the
export rules and the "nothing may jump" bar — read it there rather than copying it here, so
it stays true when the kit moves.

## What is app-specific here

- `src/design/` — the flat card, in millimetres: `build.ts` runs a template's front and back and
  hands the worker a design; `lockup.ts` fits the lettering at one scale and never under a
  finish's floor; `text.ts` sets lines by cap height and thickens thin strokes; `qr.ts` sizes the
  shelf's QR code for the nozzle; `pattern.ts` fills a pattern area for a print; `svg.ts` draws a
  design flat (the template pictures); `templates/` holds one file per template.
- `src/geometry/` — the worker: `solid.ts` makes the design solid (raised or flush, the back's
  inlay, cut-outs, lattices, the NFC pocket and its pause height), `worker.ts` boots manifold.
- `src/state.ts` — the settings and the typed details; Save/Load serialise exactly this.
- `src/main.ts` — the controls, the rail's categories, the right panel and the export.
- `tests/card.test.mts` — every template through the whole build, no browser (`PREVIEW=1` writes
  each card's front and back as SVG to `tests/.out/`).

A new template is one file in `src/design/templates/` and one line in its `index.ts`.
