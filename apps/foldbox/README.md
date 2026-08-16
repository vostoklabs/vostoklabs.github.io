# Fold-Up Box Generator (`foldbox`)

Parametric dielines for folded card boxes — cut on a laser, a blade cutter, or by
hand — with a live 3D fold animation driven by the same geometry the file carries.

```bash
pnpm --filter foldbox dev        # http://localhost:5181
pnpm --filter foldbox test       # 486 checks: derivation + export
pnpm --filter foldbox demo       # writes one real cut file per style to demo/
```

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
    primitives.ts       tray() and tube(), and the clamps (see below)
    styles.ts           the seven builders
    net.ts              THE DERIVATION
    solve.ts            fit, kerf, diagnostics
  fold/rig.ts           panels -> nested three.js hierarchy
  export/cutFiles.ts    the one export function
  ui/flatView.ts        the dieline preview, drawn from the exporter's paths
```

## Why nothing here is a standard constant

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

## Phase 2

Printing the net flat and folding it once is a separate product, not a toggle — the
allowance system inverts above ~0.6 mm caliper and a printed net has no glue, so every
glue-flap style is inapplicable. The data model is ready for it: `Crease` already
carries `foldAngle` and `creaseWidthMm`, and `dir` distinguishes the mountain folds
that need their V-groove on the other face.
