# Fold-Up Box Generator (`foldbox`)

Parametric folding-carton nets, printed **flat as one thin grooved sheet** you fold up by
hand — with a live 3D fold animation driven by the same geometry the file carries.

```bash
pnpm dev:foldbox                 # http://localhost:5180
pnpm build:foldbox               # what deploy.yml ships
```

> This app ships print-only. `vite.config.ts` builds a second mode that is not part of this
> repo; `virtual:cut-pack` resolves to a stub here and every `if (CUT)` branch is folded out,
> so `pnpm --filter foldbox dev` / `build:full` / `build:offline` only run where that mode's
> sources are. Use `dev:print` — which is what `pnpm dev:foldbox` runs — in a clone.

## The styles

Four structures, all **glue-free** — glue does not take to PLA the way it takes to board, so a
printed sheet only gets structures that lock themselves shut. Each is a standard trade
structure, none is anyone's proprietary design, and each is re-derived here as formulas in
L/W/H/caliper. See the block comment above `buildMailer`.

| style | how it holds itself shut |
| --- | --- |
| `mailer` | roll end tuck top. Each end rolls `wall → 2t strip → inner ply` down over the corner ears and pushes two tabs through slots in the floor. |
| `mailer-flaps` | the same roll lock, with side flaps under the lid. |
| `tray` | the same roll lock, minus the lid. Optional raised grips make it a basket. |
| `tray-lid` | two of the same locking tray, the second sized to nest over the first. |

### The tray used to lie

It was four walls and four ears, and the ears folded in behind the short walls with
**nothing holding them there** — so the "no glue" badge on it was false: the ears
spring back out and the walls fall flat. Every real glue-free tray answers this the
same way, and it is the way the mailer already answered it here, so `tray()` now
builds the short walls as `rollEnd`s. The ear is trapped between the wall and the ply
rolled down inside it, and the roll's own tabs drop through slots in the floor.

`tray-lid` is two of those, the lid sized to clear the tray's floor (`L + 5t`) rather
than its old single-ply outside. `test:fold` asserts the trap on both halves.

## The one idea

A box net's fold graph is a **spanning tree** of its panels' adjacency graph. That is
not a modelling convenience, it is a fact about nets — N panels give exactly N−1 fold
edges and zero cycles. Everything here follows from it:

> **Tree edges are the creases. Non-tree edges are the cuts.**

So a style builder authors *panels only* — each with a `parent` and a `foldAngle` —
and `buildNet` derives the outline and the fold rig from the same data:

1. **snap** every vertex to a 1e-4 mm grid, so shared corners compare equal;
2. **split** every panel edge at any other panel's vertex lying on it — this is what
   turns a partial contact (a narrow tuck hinged to a wide closure panel) into an
   exact shared edge;
3. an edge with a **reverse twin** is interior → **crease**; an edge with **no twin**
   is boundary → **cut**;
4. **walk** the boundary edges into closed rings — the blank;
5. the **hinge** is whatever segment a panel shares with its parent.

The payoff is that a whole class of bug cannot exist. The silhouette can never
disagree with the creases, because nobody ever draws a silhouette. A builder cannot
emit a fold it forgot to cut around. And the flat preview is rendered from the
exporter's own path list, so if it looks wrong on screen it is wrong in the file.

It also means **no dependencies**: no WASM kernel, no worker, no polygon library. The
whole solve is straight-line 2D work on a few dozen panels and runs synchronously, so
a slider drag has no async flicker in it.

## Layout

```
src/
  types.ts              Panel / Crease / Net, plus the stock and sheet tables
  geometry/
    poly.ts             polygon helpers — snap, wind, offset, dash
    primitives.ts       tray() tube() rollEnd() handleBlade(), and the clamps
    styles.ts           the style builders
    net.ts              THE DERIVATION
    solve.ts            fit, fitToSheet, diagnostics
  fold/rig.ts           panels -> nested three.js hierarchy
  export/paths.ts       the net as an ordered path list, one op per path
  export/printable.ts   the one printable function  (3MF)
  ui/flatView.ts        the flat preview, drawn from the exporter's paths
```

## Where the geometry comes from

The glue-free headline styles were worked out by **measuring rendered examples** — a RETT
mailer at 315 × 202 × 62 on 1.5 mm board, and a glue-free bakery box at 250 × 202 × 95
on 0.46 mm — by pulling the SVG out of the generator's DOM and decoding the segment
list. Everything measured there is in the builders as a caliper term, so it survives
the jump from 300 gsm board to a 0.40 mm printed sheet:

- the roll's **two parallel creases 2t apart**, which is the wall folding over its own
  thickness twice. Collapse them into one and the inner ply is a caliper too long.
- the base allowing **2.5t per end** for the double-ply roll, not 2t
- the ear being **half the box's depth**, hinged one caliper in from the base's edge
  so it lands flush on the end wall's inner face

The rest is derived and clamped, because every published carton library that was checked
against this tool's own parameter range produced negative, zero or colliding geometry
somewhere inside it:

- ECMA's dust flap `(PH + TEH)/2` overlaps by 10.5 mm on **every** square-footprint box
- its 12 mm tuck overshoots any box shorter than 12 mm, and a same-panel tuck needs
  H ≥ 24 mm before it fits at all
- its 45° glue taper insets 12 mm per end, so it needs H > 24 or the two tapers cross
- its crash-lock flaps sum to exactly the opening — zero glue overlap on a glued joint

So every derived dimension is clamped against the dimension it has to fit inside
(`primitives.ts`), and the tests sweep 200×20×200, 50×50×8 and 60×60×60 — the exact
cases that broke the standards.

## Printing the net flat

`src/export/printable.ts`. The blank comes out as a thin printed sheet you fold once:
**2 × 0.2 mm = 0.40 mm**, against 0.38 mm for 300 gsm card. Fold lines come out as
grooves down to one layer, so it actually hinges instead of cracking.

Two things fell out of what was already there:

- **Caliper already drives every clamp, tab and slot.** Set it to the printed
  thickness and the whole box is dimensioned for plastic — no builder knows or cares
  that it is being printed.
- **A crease already has a sign.** `dir` says which face the groove belongs on, so
  the export can name the folds that go the other way rather than pretending.

The solid is `sheet` (the whole blank at hinge thickness) + `panels` (each panel
pulled back from its own fold lines, on top). Two shells meeting on a face, which is
what `buildThreeMF`'s part groups are for — and no CSG, so the app still has no WASM
kernel in it. On a sheet thicker than two layers `panels` splits into one shell per
step of the groove's chamfer: a square root is where a rigid sheet splits, so the slab
wall climbs out of the groove floor at 45°, one layer height per layer. At two layers
the slab IS one layer and there is nothing to ramp, which is the honest answer rather
than a sub-layer chamfer.

Three things the sheet needs from the geometry, all of them once bugs:

- **The groove is not the slider.** It is cut at `max(slider, π × sheet)` and then
  ramped by the chamfer, and `keepOutMm` measures to the top of that ramp. Reading the
  raw slider put the mailer's lock slots 28 µm inside their own groove, and since the
  slab may not roof over a hole, the whole 92 × 61 mm base came out one layer thick —
  at every sheet thickness, every groove width, silently. A hole near a fold now trims
  that one edge's pull-back; it never voids a panel.
- **Webbed corners are not printable.** They fold flat through two plies, and their
  hinges run at 45° — the same angle the sheet's one solid layer is filled at, so the
  extrusions run *along* the fold instead of across it. 142 mm of it on the webbed
  tray, 184 mm on the hinged lid. `StyleMeta.webbedCorners` keeps them out of this
  build; every style that stays folds only on 0 and 90.
- **The hinge is the first layer.** So the 3MF carries the process keys that decide
  it — `layer_height`, `initial_layer_print_height`, `elefant_foot_compensation`,
  `infill_direction` — via `ExportMeta.process`. A stock profile's flat 0.2 mm first
  layer turns a 0.36 mm sheet into 0.2 + 0.08 + 0.08 with a hinge too thick to fold.

### Why it does not ear-clip

`ShapeUtils.triangulateShape` (earcut) removes holes by bridging each one to the
outer ring, and each bridge needs a pair of zero-area slivers to stay a valid simple
polygon. Where the bridge lands on collinear geometry those slivers are dropped and
the surface comes out **torn along a line with material on both sides** — the area
still adds up to the last decimal, so only an edge-pairing test finds it. That is not
a corner case here: a mailer's four locking slots are mirrored about the centre of the
floor, so every bridge is horizontal and collinear, and every blank tore.

So `tessellate()` is a y-sweep into trapezoids instead. No bridges, and the walls are
built from the tessellation's own unpaired edges rather than from the input rings, so
they cannot fall out of step with it. `pnpm --filter foldbox test:print` checks every
style at four sizes for watertightness (each directed edge has exactly one opposite),
outward winding, and volume.

That test earned its keep immediately: it found the mailer's two hand holes drawn
90° out — `stadium()` takes width before height and the roll end's x axis is the box's
*height* — so the wall's hole and the inner ply's hole overlapped.

## Other things that cost real time to learn

- **Caliper is measured, not looked up.** `caliper[µm] = gsm × bulk`, and the spread
  at a given gsm is ~50 %. Every panel, tuck and lid clearance comes from that number.
- **Lid clearance is `2t + 2·play`, never a percentage.** The 2t is pure nesting and
  buys zero play. 7 % of 30 mm is sloppy; 7 % of 300 mm falls off.
- **Nothing big fits.** A blank is roughly `4S+12 × 3S+24` for a cube of side S, so a
  256 mm plate tops out near a 70 mm cube. The status line says so continuously rather
  than letting the user discover it at export.
- **Two Groups per panel in the rig.** three.js defaults to Euler order `'XYZ'`
  (`Rx·Ry·Rz`), so a single Group carrying both the hinge aim and the fold folds about
  the *parent's* axis. A static frame for the aim, an animated pivot for the fold.
- **`viewer.setParts()` will not hold a hierarchy.** `clearParts()` removes Group
  children without traversing them, leaking every descendant geometry. Hence
  `setFoldRig()` in `@vostok/viewer`, which owns a sibling group and disposes deeply.
