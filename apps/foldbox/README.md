# Fold-Up Box Generator (`foldbox`)

Parametric dielines for glue-free folded boxes — cut on a laser, a blade cutter or by
hand — with a live 3D fold animation driven by the same geometry the file carries.

```bash
pnpm --filter foldbox dev        # http://localhost:5181
pnpm --filter foldbox test       # derivation + fold + printable mesh + export
pnpm --filter foldbox demo       # writes one real cut file per style to demo/
pnpm --filter foldbox build:offline   # -> offline/foldbox-offline.{html,zip}
```

## The offline build

`build:offline` emits **one html file** that runs from `file://` with no server and
no network — the thing you can email someone. Three settings in
`vite.offline.config.ts` do the work, and each is load-bearing:

- **`format: 'iife'`** — a browser will not load an external *module* script from a
  `file://` page; the origin is `null`, so the fetch is cross-origin and blocked.
- **`assetsInlineLimit: Infinity`** — the three woff2 faces are referenced from
  inside the CSS, and once that CSS is inlined those relative URLs point nowhere.
- **`cssCodeSplit: false`** — one stylesheet to fold in rather than several.

Then `../../scripts/offline.mjs` (shared with the clicker) splices the emitted files
into the page and asserts that nothing external survived. Things it learned the hard
way, most of them from the clicker rather than from here:

- **The script has to move to the end of `<body>`.** Vite puts the entry in
  `<head>`, which is fine for a module (deferred by spec) and fatal for an inline
  classic script — it ran before `<div id="app">` existed and mounted into `null`.
- **Splice it with a replacer FUNCTION.** `String.replace` expands `$&`, `` $` ``
  and `$'` inside a *replacement string*, and 700 kB of minified JS contains those
  sequences. The page came up with `SyntaxError: Unexpected token '<'`.
- **Detect ESM by the wrapper, not by grepping for `import`.** Vite tags the entry
  `type="module"` whatever the rollup format is, so the tag proves nothing — and the
  bundle is one minified line apart from newlines inside string literals, one of
  which begins a line with "import drops the size". What is unambiguous is rollup's
  iife tail, `})();`.
- **Check for leftover external refs BEFORE the scripts go in.** Afterwards the scan
  reads the bundle too, and minified JS that builds markup from template literals is
  full of `src="${x}"`.

The clicker adds a worker, a WASM module and 31 MB of assets it fetches at runtime —
and `file://` cannot `fetch()` at all. Rather than edit the bundle, the builder
injects a prelude that hooks **four** paths at which a URL can turn into a request:
`fetch`, `HTMLImageElement.src`, `setAttribute` and `innerHTML`. All four are in use
in that one app, and the last one — a sample grid built as a template string — was
the only thing still reaching the network after the first three were in place.

## The styles

Five of the eight need **no glue at all**, and the two headline ones are transcribed
from production dielines rather than derived — see the block comments above
`buildMailer` and `buildHandleBox`:

| style | glue | how it holds itself shut |
| --- | --- | --- |
| `mailer` | none | roll end tuck top. Each end rolls `wall → 2t strip → inner ply` down over the corner ears and pushes two tabs through slots in the floor. |
| `handle-box` | none | two half-depth lid flaps meet on the centre line; their handle straps stand up through a slot in each side wing, and the strap shoulders sit under it. |
| `tray` | none | same roll lock as the mailer, minus the lid. Optional raised grips make it a basket. |
| `tray-lid` | none | two of the same locking tray, the second sized to nest over the first. |
| `divider` | none | slot-together strips. |
| `tuck-top`, `snap-lock`, `sleeve` | one lap | a tube has to close on itself, and on card only a glued lap does that. |

### The tray used to lie

It was four walls and four ears, and the ears folded in behind the short walls with
**nothing holding them there** — so the "no glue" badge on it was false: the ears
spring back out and the walls fall flat. Every real glue-free tray answers this the
same way, and it is the way the mailer already answered it here, so `tray()` now
builds the short walls as `rollEnd`s. The ear is trapped between the wall and the ply
rolled down inside it, and the roll's own tabs drop through slots in the floor.

`tray-lid` is two of those, the lid sized to clear the tray's floor (`L + 5t`) rather
than its old single-ply outside. `test:fold` asserts the trap on both halves.

The blades' hand hole is worth a look, because it falls out of the derivation for
free: the blade meets its parent along **two** runs — the strap's legs — with the
hole's mouth between them. `buildNet` finds twins under the legs and none under the
mouth, so the legs come out creased and the mouth comes out cut. Nobody wrote that
down anywhere.

Research: [`docs/briefs/foldbox-research.md`](../../docs/briefs/foldbox-research.md) ·
Spec: [`docs/briefs/foldbox-spec.md`](../../docs/briefs/foldbox-spec.md)

## The one idea

A box net's fold graph is a **spanning tree** of its panels' adjacency graph. That is
not a modelling convenience, it is a fact about nets — N panels give exactly N−1 fold
edges and zero cycles. Everything here follows from it:

> **Tree edges are the creases. Non-tree edges are the cuts.**

So a style builder authors *panels only* — each with a `parent` and a `foldAngle` —
and `buildNet` derives the dieline and the fold rig from the same data:

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
  types.ts              Panel / Crease / Net, plus the stock, machine and sheet tables
  geometry/
    poly.ts             polygon helpers — snap, wind, offset, dash
    primitives.ts       tray() tube() rollEnd() handleBlade(), and the clamps
    styles.ts           the eight builders
    net.ts              THE DERIVATION
    solve.ts            fit, kerf, fitToSheet, diagnostics
  fold/rig.ts           panels -> nested three.js hierarchy
  export/cutFiles.ts    the one cut-file function   (SVG + DXF + assembly sheet)
  export/printable.ts   the one printable function  (3MF + STL, phase 2)
  ui/flatView.ts        the dieline preview, drawn from the exporter's paths
```

## Where the geometry comes from

The two glue-free headline styles were **read off live parametric dielines** — a RETT
mailer at 315 × 202 × 62 on 1.5 mm board, and a glue-free bakery box at 250 × 202 × 95
on 0.46 mm — by pulling the SVG out of the generator's DOM and decoding the segment
list. Everything measured there is in the builders as a caliper term, so it survives
the jump from E-flute to 300 gsm:

- the roll's **two parallel creases 2t apart**, which is the wall folding over its own
  thickness twice. Collapse them into one and the inner ply is a caliper too long.
- the base allowing **2.5t per end** for the double-ply roll, not 2t
- the ear being **half the box's depth**, hinged one caliper in from the base's edge
  so it lands flush on the end wall's inner face
- the handle strap's **constant 6° taper** on both profiles, which is what keeps it an
  even thickness instead of pinching at the shoulders

The rest is derived and clamped for the same reason as before:

Every published carton library that was checked against this tool's own parameter
range produced negative, zero or colliding geometry somewhere inside it:

- ECMA's dust flap `(PH + TEH)/2` overlaps by 10.5 mm on **every** square-footprint box
- its 12 mm tuck overshoots any box shorter than 12 mm, and a same-panel tuck needs
  H ≥ 24 mm before it fits at all
- its 45° glue taper insets 12 mm per end, so it needs H > 24 or the two tapers cross
- its crash-lock flaps sum to exactly the opening — zero glue overlap on a glued joint

So every derived dimension is clamped against the dimension it has to fit inside
(`primitives.ts`), and the tests sweep 200×20×200, 50×50×8 and 60×60×60 — the exact
cases that broke the standards.

## Things that cost real time to learn

- **Fold lines are not creases.** No target machine can crease. A laser *scores* (and
  browns the outside of the box — Bambu forbid unattended paper jobs), a blade
  *perforates*, a pen *draws* a line you fold by hand. The machine preset picks one.
- **Caliper is measured, not looked up.** `caliper[µm] = gsm × bulk`, and the spread
  at a given gsm is ~50 %. Every panel, tuck and lid clearance comes from that number.
- **Lid clearance is `2t + 2·play`, never a percentage.** The 2t is pure nesting and
  buys zero play. 7 % of 30 mm is sloppy; 7 % of 300 mm falls off.
- **Nothing big fits.** A tuck blank is roughly `4S+12 × 3S+24` for a cube of side S,
  so a Cricut mat or an H2D tops out near a 70 mm cube. The status line says so
  continuously rather than letting the user discover it at export.
- **Operation is a fill colour, not just a stroke.** Bambu Suite assigns a process by
  fill and only falls back to stroke; its colour picker then selects a whole layer in
  one click.
- **Ship a 100 mm rectangle in every file.** Illustrator's legacy is 72 dpi, most
  cutter front-ends are 96, and the incumbent's own output is 72 — the "my box came
  out 4 % small" bug.
- **Document order is cut order.** Holes and interior slits first, perimeters last, or
  the blank releases mid-job and everything after it misregisters.
- **Two Groups per panel in the rig.** three.js defaults to Euler order `'XYZ'`
  (`Rx·Ry·Rz`), so a single Group carrying both the hinge aim and the fold folds about
  the *parent's* axis. A static frame for the aim, an animated pivot for the fold.
- **`viewer.setParts()` will not hold a hierarchy.** `clearParts()` removes Group
  children without traversing them, leaking every descendant geometry. Hence
  `setFoldRig()` in `@vostok/viewer`, which owns a sibling group and disposes deeply.

## Phase 2 — print the net flat

`src/export/printable.ts`. The same blank as a thin printed sheet you fold once:
**2 × 0.2 mm = 0.40 mm**, against 0.38 mm for 300 gsm card. Fold lines come out as
grooves down to one layer, so it actually hinges instead of cracking.

Two things fell out of what was already there:

- **Caliper already drives every clamp, tab and slot.** Set it to the printed
  thickness and the whole box is dimensioned for plastic — no builder knows or cares
  that it is being printed. The panel says so, and offers the one click.
- **A crease already has a sign.** `dir` says which face the groove belongs on, so
  the export can name the folds that go the other way rather than pretending.

The solid is `sheet` (the whole blank at hinge thickness) + `panels` (each panel
pulled back from its own fold lines, on top). Two shells meeting on a face, which is
what `buildThreeMF`'s part groups are for — and no CSG, so the app still has no WASM
kernel in it.

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
*height* — so the wall's hole and the inner ply's hole overlapped. And the sleeve's
euro hang slot was two overlapping closed rings, which is a figure-of-eight cut path
and has no even-odd interpretation at all.
