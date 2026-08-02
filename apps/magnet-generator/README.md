# Image to Fridge Magnet Generator

Turn any image, logo, or photo into a printable fridge magnet: colors carved into
the front face, flat back, and a pocket sized for the magnets you actually own —
or no pocket at all if you're using magnetic sheet.

B-route app (own-site), built on the clicker generator's image pipeline +
manifold-3d worker + three.js viewer. Spec: `docs/briefs/magnet-generator-spec.md`.

## Run

```
pnpm --filter magnet-generator dev
```

## Check the geometry

```
pnpm --filter magnet-generator test:geometry
```

Headless sweep (no browser): 90 shape × size × magnet × mode combinations plus
volume, hex-clearance and shape-distinctness assertions. This is the executable
version of the spec's acceptance criteria — run it after touching
`src/geometry/buildMagnet.ts`.

## How it's put together

- `src/image/` — decode, adjust, colorspace, matte (background removal), quantize,
  trace. Ported from the clicker.
- `src/geometry/buildMagnet.ts` — the whole model: silhouette → color inlays →
  front bevel → magnet pockets → watermark. Runs in the worker.
- `src/geometry/identityMark.ts` — covert provenance voids, buried in the back wall.
- `src/viewer/viewer.ts` — three.js viewer with front/back/3D camera presets,
  body-space picking and the draggable magnet handles. The camera is only
  re-framed when the model changes size enough to leave view.
- `src/ui/wizard.ts` — the two-question first-run magnet setup.
- `src/export/threemfExport.ts` — 3MF (one object, N pre-colored parts). It also
  carries `buildStlBinary`, currently unwired (the export block matches the
  clicker's single 3MF button).

## Print orientation

Everything assumes **back face down, image face up** — that's how the model is
built, exported and meant to be printed. No supports. The back stays flat because
it's the face that meets the fridge, so edge bevels only touch the front rim.

## The three attachment modes

| Mode | What you get | What you do |
|---|---|---|
| Magnetic sheet | Flat back, no pocket | Stick the print onto adhesive magnetic sheet |
| Glue-on | Pocket open at the back | Drop the magnet in and glue it. Strongest hold |
| Embedded | Blind cavity inside | Add one pause at the layer the app shows you, drop the magnet in, resume |

The body is never allowed to be thinner than the magnet needs
(`magnet height + back wall + 0.8 mm cover`) — the Thickness slider snaps back
rather than cut a pocket that can't hold the magnet.

## Placing the magnets

Auto placement samples the **eroded silhouette**, not its bounding box, so odd
shapes take the magnets they actually have room for (a 70 mm "V" fits four ⌀10
discs). Switch the stage to **Magnet** mode to drag the pockets on the model, or
use the d-pad in step 1. The first manual move seeds itself from wherever auto
had put them, so nothing jumps; anything that would break the 2 mm wall to the
edge or a neighbour is pulled back and reported.

## Not in v1

MW/PMM listing, batch size-run export, true fillet edges, magnet-sheet recess.
See the spec's out-of-scope list.
