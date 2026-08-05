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

## Which source owns the design

`activeSource` (`'image' | 'svg' | 'text'`) is the single authority, and
`reprocess()` switches on it. It does **not** sniff whichever of
`originalImage` / `svgText` / `textSource` happens to be non-null: that made the
answer depend on the order of the if-chain and required every import path to
remember to null the other three. It broke twice — importing an image while text
was loaded silently re-laid-out the text.

Because ownership is explicit, nothing is discarded when you switch. The tabs
round-trip: leave Text for Image and your image comes back, with its palette
intact.

## Text as a source

The Import Source panel has three tabs: **Image**, **SVG** and **Text**. Text
uses the same 152 fonts, opentype loader and layout as the name keychain, all
shared from `@vostok/fonts`.

`src/image/text.ts` is the whole adapter. It takes glyph contours and applies the
normalization every source shares — centre, scale so the longest side is 1, emit
one region plus the union silhouette. From there nothing downstream knows it was
text: base shape, size, magnet pockets, per-shape colours and slider mode all
work unchanged.

Two looks fall out of the existing Base shape control:

- **Image outline** — the body hugs the letters (plus the frame margin), like a
  keychain plate with no ring. The morphological closing in `buildMagnet` merges
  letters that touch; pull **Letter spacing** negative to make them touch.
- **A preset shape** — the letters are inlaid into a plate.

One gotcha worth knowing if you touch `text.ts`: `pathCommandsToPolygons` already
negates the font's Y-down coordinates, so text contours are **Y-up** like the
image tracer's. `parseSvg` flips Y because raw SVG is Y-down — do not copy that
line into the text path.

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
at the default 0.2 mm gets a ⌀6.2 mm round socket. Blocks get it on each of width
and length.

**Round and hex do not get the same clearance.** A round pocket is sliced as a
chord-approximated polygon and the extrusion pulls inward, so it prints undersize
— the clearance is what buys that back. A hex pocket is six flat walls the slicer
traces exactly, so it prints true and the same clearance lands as pure slop. A
printed ⌀10 hex socket came out 0.2 mm loose across the flats *on top of* 1.78 mm
of corner gap. So `ROUND_SHRINK_ALLOWANCE_MM` (0.2) is subtracted for hex:

| profile | fit 0.2 | fit 0.5 |
|---|---|---|
| round ⌀6 | ⌀6.20 | ⌀6.50 |
| hex ⌀6 | 6.00 across flats | 6.30 across flats |

Raising the slider above the allowance still opens a hex pocket 1:1, so it
remains a real fit control. The report states the resolved socket — both across
flats and across corners for hex, since the flats are what grip and the corners
are what you see. The sweep asserts all four numbers above.

Corner gap is inherent to a hexagon: it is always `1/cos30` = 15.5% wider corner
to corner than the magnet it holds. That is what leaves room for glue, and it is
why `sliderGridSpec` spaces a hex array off the hexagon rather than the disc.

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

### Why the second piece is sometimes mirrored

You assemble by turning one piece over, and **a flip about an in-plane axis maps
a footprint to its mirror**. So the two silhouettes only stack flush if the
second piece was built mirrored — otherwise an asymmetric outline overhangs its
partner all the way round. That was a real print defect, not a theoretical one.

But mirroring is only needed when the silhouette is asymmetric:

- **Image outline** → mirrored. The trade-off is unavoidable: the mirrored half
  also carries mirrored artwork. You cannot have both a flush profile and
  un-reversed art on an asymmetric shape — they are opposite handednesses of the
  same part. The UI says so.
- **Any preset shape** (circle, square, rounded rect, rectangle, pointy-top
  hexagon) → **rigid copy**. All are symmetric about both axes, so a flip already
  lands them on themselves, and mirroring would needlessly reverse the artwork
  inlaid on the plate.

Either way both pieces print **image-up, pockets-down**, side by side. The mirror
is in X; an earlier Z-flip put the art face down with the pockets facing the sky
and inverted the embedded pause layer. Reflection reverses triangle winding, so
that is fixed too. The sweep flips piece 2 back and asserts ≥97% of its back-face
outline lands on piece 1 — it reports 87% without the mirror and 100% with.

The 3MF carries the halves as two separate objects so the slicer can arrange each
on its own.

## Not in v1

MW/PMM listing, batch size-run export, true fillet edges, magnet-sheet recess.
See the spec's out-of-scope list.
