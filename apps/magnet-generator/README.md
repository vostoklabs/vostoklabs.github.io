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
volume, hex-clearance and shape-distinctness assertions, then the slider block —
array placement at every press-fit clearance, pitch/travel/clicks, the rigid-copy
invariant for the second piece, the blank twin, and embedded sealing on both
halves. This is the executable version of the spec's acceptance criteria — run it
after touching `src/geometry/buildMagnet.ts`.

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

## Colours: rows vs shapes

A palette row is one **quantised colour**, and one quantised colour is usually
several disconnected shapes. So there are two scopes, and the UI keeps them
distinct:

- **Sidebar swatch** — recolours the whole bucket. It also clears any per-shape
  overrides in that bucket, otherwise the swatch would change and half the model
  wouldn't follow.
- **Clicking a shape on the model** — recolours only that shape, via
  `componentColors` (keyed by the part name, `inlay-<region>-<part>`).

Overrides are dropped on every re-trace: the keys are part names, and a re-trace
renumbers the parts, so a kept override would land on a different shape. Because
overrides can push the model past a 4-slot AMS, the palette shows a live filament
count and warns past four.

Extrude level is still per-row, not per-shape.

## Press fit

`pocketFit` is added to the magnet's **diameter**, not its radius — a ⌀6 magnet
at the default 0.2 mm gets a ⌀6.2 mm socket. Blocks get it on each of width and
length. The report states the resolved socket size; the sweep asserts the removed
volume matches `π·((d + fit)/2)²·depth` so this can't silently become radial.

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

## The magnetic fidget slider

`Product → Magnetic slider` builds a two-piece slider instead of a single magnet.

A slider clicks because each half carries a magnet array on a fixed pitch with
**alternating polarity** up each column. Offset the halves by one pitch and every
facing pair flips from repel to attract — that snap is the detent. So:

- The pitch **is** the click distance, and `rows − 1` is the number of clicks.
- Both halves must share the pitch exactly, which is why slider pockets come from
  a derived array (`sliderGridSpec` in `src/types.ts`) rather than the fridge
  magnet's farthest-point sampling, and why they can't be dragged.
- The array is two columns wide — one column lets the halves twist.
- Layouts are 4 (2×2), 6 (2×3) and 8 (2×4) magnets **per half**. 8 × ⌀6×3 per
  half (16 total) is what commercial sliders use.
- Small discs only. ⌀5–8 mm glides; ⌀10+ clamps shut.
- **Magnet spacing** adds plastic between pockets on top of the 2 mm printable
  minimum (default 3 mm). Packed at 0 the array reads as one solid block; opening
  it up lengthens the throw between clicks and grows the body with it.
- Default body is 55 mm, not the fridge magnet's 70 — a slider is a pocket toy.

`sliderGridSpec` is the single source of truth for the pitch, and
`sliderMinBodySizeFor` turns that into the smallest body of the chosen base
shape — the UI's size floor and the builder's placement both call them. They used
to compute the size separately and disagreed by the press-fit gap, which meant no
pocket was ever cut. The shape matters too: a circle has to swallow the array's
diagonal and a rounded rect clips exactly the corners the outer pockets want, so
quoting the bare rectangle figure promised a minimum the builder then refused.

Switching Product → Magnetic slider on a design that can't hold the array (an
image outline, or a body under the minimum) opens a dialog offering the two
fixes — rounded rect at the right size, or keep the shape and just resize —
rather than flipping the product and throwing a warning. The first-run wizard
routes through the same path.

Both halves are **identical rigid copies**, printed side by side, image-up and
pockets-down. You assemble by turning one over, and turning something over is a
rotation, not a reflection — the image on the underside still reads correctly. A
reflected or Z-flipped twin would print as the wrong part. The 3MF carries them
as two separate objects so the slicer can arrange each half on its own.

## Not in v1

MW/PMM listing, batch size-run export, true fillet edges, magnet-sheet recess.
See the spec's out-of-scope list.
