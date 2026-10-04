# Build from blocks

The repo is a shelf of building blocks (`packages/`) and apps assembled from them. A fix to a
block reaches every app that uses it, but only the apps that import it, not the ones holding a
copy.

## Before writing code, look it up

`pnpm catalogue <words>` prints the blocks matching the words; `pnpm catalogue` writes the whole
shelf to `CATALOGUE.md`. Every block has a plain name ("SVG wizard", "3D viewer", "Pattern
engine"), a line on what it is for, its import, and the apps that use it.

1. **It exists: import it.** Never copy it into an app, re-implement it, or restyle it in app CSS.
2. **It almost fits: widen it** in its package, with an option whose default leaves every app
   already using it unchanged, and a test that proves it.
3. **It does not exist: build it on the shelf first**, in the right layer, with its
   `catalogue.json` entry (and a kit-demo entry if it is UI), then use it. Ask before adding a
   control people will see.
4. **Taking code out of an app is a move, not a copy.** The app imports the shared block in the
   same change and its own copy is deleted.
5. **Something a second app wants lives in one app?** Move it to a package first, then import it
   from both.

## Layers: imports point down

- **core**: what things look like. Shapes in millimetres; no machine, no screen, no app.
- **connector**: how shapes get made (the laser job, the 3D-print file). Uses cores.
- **ui**: controls, windows, views. Neutral ones live in `@vostok/ui-kit`; a connector's own
  controls live beside the connector; a core's picker lives beside the core.
- **app**: what this product is, how its screen is arranged, its presets. Uses the shelf, never
  another app.

A core that seems to need something from above takes it as an option from the layer above. A core
changes by addition only: the apps already using it give identical results, and their tests show it.

## The checks hold the line

`pnpm check:shelf` (catalogue, blocks, layers, copies) and `pnpm check:ui` run in CI and fail when
a count goes up: an export with no catalogue entry, an app re-writing a block, an import pointing
up, the same code in two places, a hand-built control. They are ratchets, per app: a number may go
down, never up. Lower a budget when a check says so; never raise one to get a commit through. Run
`pnpm check:shelf` before calling work done.
