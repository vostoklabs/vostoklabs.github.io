# Halloween pack assets

**The SVGs here are placeholders.** Replace them with the real artwork; nothing in the code
changes when you do — the manifest is `src/packs/halloween.ts` and it is one line per file.

## Adding a file

1. Drop the SVG into `shapes/` (a base silhouette) or `designs/` (artwork for the cap).
2. Uncomment — or add — its line in `src/packs/halloween.ts`.
3. That is all. No geometry change, no exporter change.

## What the files have to be

**Shapes** become the printed body:

- One closed silhouette, **filled** — `parseSvg` traces fills, and a stroke-only outline
  traces as a thin ring, so the base comes out as a hollow loop.
- Several filled elements are fine: the silhouette is their union.
- **Solid, not lacy.** The body must contain a ~17 mm switch column anywhere the switch is
  moved to. Thin wings or spindly legs make the build bulge the base out to clear it (it
  warns, but the shape is then not the shape you drew).
- Nothing finer than ~2 mm at print size. On a 40 mm pumpkin the stalk is a couple of
  millimetres; below that the base cannot hold it.

**Designs** go on the cap: flat colour regions, 3–4 colours. Each distinct fill becomes a
filament, and a batch run shares one palette across every item under a 16-slot ceiling.

## Ids are permanent

The `id` in the manifest is stored in saved projects. Rename the `name`, never the `id`.
