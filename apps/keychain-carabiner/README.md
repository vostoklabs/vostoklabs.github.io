# Keychain Carabiner Set

A snap-hook clip, chain links, connector rings and a charm — each in any shape, with a
symbol on the clip that you place by dragging it on the model. Everything prints flat, face
up, in one job. Two views of the same parts: the print layout (what downloads) and the set
as worn.

```bash
pnpm dev:keychainCarabiner        # dev server (port 5190 in .claude/launch.json)
pnpm --filter keychain-carabiner build
node scripts/render-carabiner.mjs # headless sweep: PNGs + a report, no browser needed
```

## How it is built

Every part is one construction: a **silhouette** → a **band** (the outline minus itself
inset by the bar width) → features cut or fused at marked points on the outline.

| Part | Construction |
| --- | --- |
| Hook | band → S-cut gate (the whole ring is the spring) → filled icon inlaid where you dragged it → gusset at the eye → a plain loop, or the swivel housing |
| Link, connector | band → one slit where the band is thinnest; closed by hand |
| Charm | filled outline or band → symbol cut through / engraved / raised → a loop at `top`, or the swivel's captive stem |

Shapes come from `src/shapes/builtin.ts` (formulas) and from SVG assets in
`public/assets/shapes/` (see the README there for the one-file contract).

**The swivel** is Ian's render: a window straight through the neck with a barrel lying in
it, axis along the hang, stem out through a round tunnel in the floor. The round stem in the
round tunnel holds the barrel in every direction but down; the barrel holds "down". It needs
the hook at least 5 mm thick; below that the builder warns and substitutes a plain loop. The
captive piece (ring or charm) is printed as thick as the hook.

**Edges** are rounded by warping the extrusion into a quarter-circle profile, inset per
vertex and capped by the local thickness — a real round-over, not stacked slices.

## Portable by design

`src/geometry/` and `src/shapes/` import nothing from the app. `buildSet(wasm, params)` takes
rings and glyph contours and returns meshes for both layouts, so the whole generator can be
lifted into another host — the clicker, say — as a unit. `src/geometry/harnessEntry.ts` is
the seam the node harness uses; a host would import the same thing.

## Print notes

- The gate cut is the only clearance in the hook. `Firm` is 0.4 mm and the first to fuse on
  an over-extruding printer; `Soft` is 0.5 mm.
- Swivel clearances are 0.4 mm and never scale with the size slider.
- PETG makes a springier gate than PLA.
