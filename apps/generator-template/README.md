# Generator template

A **complete, working generator** — not a skeleton. Run it and you get a live 3D
preview on a Bambu build plate, sliders that rebuild the model, a mode bar, an
upload + samples panel, and an Export button that writes a real multi-colour 3MF.

Copy it, replace the geometry, ship.

```bash
pnpm --filter generator-template dev
```

## What you get for free

| Package | What it gives you |
| --- | --- |
| `@vostok/ui-kit` | Layout, topbar, header, callout, footer, controls, **and the shared patterns**: source cards, dropzone, sample grid, mode bar, stage panel, status line, sections |
| `@vostok/viewer` | The 3D preview: Z-up CAD frame, PBR lighting, view presets, part picking + highlight, theme following, PNG capture |
| `@vostok/plates` | The real Bambu build plate under the model, plus the plate picker |
| `@vostok/export` | Multi-part 3MF with per-colour filament slots, binary STL, OBJ |
| `@vostok/brand` | Every URL, price and licence string — never hardcode these |

If you catch yourself restyling one of those, **fix it in the package**. That is
what keeps the generators looking like one product instead of five cousins.

## Where things go

This layout is the house style. Keep it, or the catalogue drifts apart.

```
 ┌──────────────────────────────────────────────────────────────┐
 │ topbar: GitHub · licence · MakerWorld · Ko-fi                │
 ├───────────────┬──────────────────────────────┬───────────────┤
 │ LEFT          │ STAGE                        │ RIGHT         │
 │               │                              │               │
 │ header        │ ┌ label      mode bar  plate┐│ inputs        │
 │ quality note  │ │                       ▼   ││  (upload,     │
 │               │ │        the model          ││   samples)    │
 │ YOUR          │ │                           ││ colours       │
 │ SETTINGS      │ └ status     hint / panel   ┘│ results       │
 │  1 · Shape    │                              │ ─────────────  │
 │  2 · Details  │                              │ FOOTER:       │
 │               │                              │ Export / Save │
 │               │                              │ / Load / Help │
 └───────────────┴──────────────────────────────┴───────────────┘
```

- **Left** is what the user is *making* — the parameters.
- **Right** is what goes *in and out* — inputs, colours, results, and the export
  footer. The footer belongs to the right panel, never the left.
- The **stage** has five overlay slots (see the map at the top of
  `components/stage.ts`). The status line owns the bottom-left and the nav hint
  the bottom-right — opposite corners, because both grow with their text and a
  centred hint sat directly in the status line's path. The bottom-centre slot is
  the active mode's panel alone.

## Making a new generator

### Step 1 — the rename checklist

Copy this folder to `apps/<your-generator>`, then change every one of these. They
are the only strings that are *wrong* rather than merely generic, and three of
them collide with the template if you miss them.

| Where | What | Why it matters |
| --- | --- | --- |
| `package.json` | `"name"` | `pnpm --filter` uses it |
| `.claude/launch.json` | add an entry + free port | how the preview starts |
| `index.html` | `<title>`, `<meta name="description">` | browser tab, link previews |
| `main.ts` §5 | `qualityCallout({ storageKey })` | **collides** — a shared key means dismissing it in one generator hides it in the other |
| `main.ts` §5 | `sidebarFooter({ themeStorageKey })` | **collides** the same way |
| `main.ts` §5 | `downloadThreeMF(..., { title, generator, application }, 'tag.3mf')` | `generator` is the provenance id baked into every export; the filename is what the user sees in Downloads |
| `main.ts` §5 | the `onHelp` dialog body | it currently says "Explain how to use your generator here" |
| `main.ts` §6 | `generatorHeader({ title, description })` | the name users read |
| `state.ts` | `TagSettings` → your settings, and the type name | Save/Load serialises this |
| `geometry.ts` | `buildTag` → your builder | see step 3 |

Then delete what you don't need: the input section (§4) if nothing is imported,
the mode bar and stage panel (§6) if there is only one thing to do on the model,
and the sample grid if you ship no samples.

### Step 2 — work through `src/main.ts`

It is numbered 1–6, top to bottom:
   1. **State** (`src/state.ts`) — your settings object; Save/Load serialise it.
   2. **Rebuild** — swap `buildTag` for your geometry. Real generators run this
      in a worker with `manifold-3d`; see the magnet or clicker generator.
   3. **Settings** — your controls, kept in a `controls` object so a loaded
      project can push values back with `setValue`.
   4. **Inputs & output** — the upload / sample patterns and the colour rows.
      Delete the input section if your generator has nothing to import.
   5. **Chrome** — callout text, export handlers, help dialog.
   6. **Assemble** — usually unchanged.

### Step 3 — point the geometry at your own shapes

Everything downstream (viewer, 3MF, colours, filament slots) already speaks one
part shape, so emitting this is the whole contract:

```ts
{ name: string, positions: Float32Array, indices: Uint32Array, color: [r, g, b] }
```

Give parts that print in different filaments different `color` values — slots are
assigned per distinct colour, in first-seen order. Parts that must stay separately
movable in the slicer (two halves of a hinge) get a different `group`.

## Export: 3MF only, and don't hand-roll it

The template exports **3MF and nothing else**, on purpose. STL carries neither the
colours nor the part split, so putting a "Download STL" button next to the real
export is a downgrade offered at the moment of success. `@vostok/export` can still
write STL and OBJ if some generator genuinely needs them — just don't put it in
the footer beside the 3MF.

Always go through `@vostok/export`. The 3MF it writes carries three things that
are easy to miss and invisible until a user complains:

- `Metadata/project_settings.config` — the filament list. Without it, someone with
  a single filament loaded opens your model and every part collapses onto slot 1.
- The `BambuStudio:3mfVersion` metadata and matching `xmlns:BambuStudio`. Bambu
  Studio only reads the file above when these are present; otherwise it says
  *"The 3mf is not from Bambu Lab, load geometry data and color data only"* and
  throws the filament list away. Both markers are required — the config alone
  does nothing.
- `<m:colorgroup>` for the standard-3MF path (PrusaSlicer, Orca).

## Nothing may jump

Drag **Corner radius** in the template. The model reshapes and *nothing else
moves* — the camera, the framing and the model's position on the plate all stay
exactly where you left them. That is the bar. Every control in every generator
should feel like that one.

A parameter edit is allowed to change the model. It is not allowed to move the
camera, re-centre the view, or reposition the model on the plate. Three things
break that, and all three have shipped at least once:

1. **Threshold re-framing.** A rule like "re-frame when the model grew past 1.6x"
   is a discontinuity by construction: nothing happens for most of a drag, then
   one lurch. Worse, re-framing to a preset angle throws away whatever orbit the
   user set. Measured over a 20→120 mm width drag, the old rule moved the camera
   **132 units in a single step and rotated the view 28°**; the current rule moves
   ~27 per step, spread evenly, and rotates it **0°**. If the camera must move,
   move it a little on every step, never a lot on one.

2. **Stale world matrices.** `Box3.expandByObject()` and `setFromObject()` refresh
   the object's own matrix but reuse its *parent's* cached one. Measure a model
   after re-centring its group without calling `updateMatrixWorld(true)` first and
   you get last build's frame, so the new offset stacks on the old one and the
   model hops above or sinks into the plate on every rebuild.

3. **Anchoring on something that moves.** Centre on a bounding box that includes
   the part the user is editing and the model slides sideways on every keystroke.
   Anchor X/Y on the stable body and take Z from the full assembly.

If a control still feels jumpy, measure it rather than eyeballing it: record the
camera position across a scripted sweep and look for one step that is much larger
than its neighbours. That is the jump, and it will point straight at the cause.

## Verify it in the browser before you call it done

Same loop the catalogue is held to: `preview_start`, then read the console and
measure the DOM. Chrome the template shares with the shipped generators should
*measure* the same — footer 309px, primary button 269×42, action buttons 130×39
in a 2×2 grid. If yours differs, the cause is usually double padding or a
`display` that overrides a kit rule, not a value worth hardcoding locally.

## Two things the demo geometry is showing you

Both cost real debugging time, so they are worth copying:

- **Clamp before you build** (`fitSettings`). Sliders will happily ask for a
  10 mm hole in a 15 mm tag. Shrink the feature; never emit a torn mesh.
- **Weld your loops** (`weldLoop`). A closed outline that repeats its first
  point turns into zero-area slivers, and enough of those tear the mesh open —
  which slicers *will* complain about. The demo geometry is verified watertight
  (no open, non-manifold, or degenerate triangles) across its whole parameter
  range.
