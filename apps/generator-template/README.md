# Generator template

A **complete, working generator** in the house look — not a skeleton, and not a sketch of
one. Run it and you get the screen the clicker, the keycap generator and Laser Studio share:
the settings rail on the left, a live 3D preview on a Bambu build plate in the middle, what
the customer types on the right, and a Download button that writes a real two-colour 3MF.

The demo product is a name tag: type a name, and it stands on the tag in a second colour.
Replace the product; keep the screen.

```bash
pnpm --filter generator-template dev
pnpm --filter generator-template test
```

## Built from the shelf

Every piece of the screen is a block from the shelf, imported by name. The template writes
only what is this product's own: the settings, the geometry, and which block goes where.

| On screen | Block (`pnpm catalogue <name>`) | Import |
| --- | --- | --- |
| The page: top bar, three columns, phone layout | App frame, Top bar | `appShell`, `topbarLinks` |
| The name at the top left, the credit strip at its foot | Generator header | `generatorHeader`, `panelCredit` |
| The categories down the left | Settings rail | `settingsRail` |
| The controls inside them | Slider, Switch, Filament colours, Font chooser | `sliderRow`, `toggleSwitch`, `filamentRow`, `fontChooser` |
| What the customer types | Form fields, Panel section | `textField`, `section` |
| Reset, Download, Save, Load, Help, Light mode | Button, Sidebar footer | `button`, `buttonRow`, `sidebarFooter` |
| The 3D preview and the plate under it | 3D viewer, Plate picker | `createViewer`, `mountPlatePicker` |
| 3D · Top, the status line | Stage overlays, Status line | `previewBar`, `stageTools`, `stageRow`, `stageStatus` |
| One build at a time; export waits for it | Build loop | `buildLoop` |
| Load, Reset: the controls follow, clamped | Settings sync, Project file | `syncControls`, `readProjectFile`, `markProject` |
| The file, and the licence window after it | 3MF export, Licence pop-up | `downloadThreeMF`, `licenseAfterExport` |
| The text as outlines, letters with their holes | Text to outlines, Shape maths | `getHorizontalContours`, `islandsFromContours` |
| The icons on the rail | Interface icons | `ICONS` |

If you catch yourself restyling one of those, **fix it in the package**. That is what keeps
the generators looking like one product instead of five cousins. If one almost fits, widen
it there with an option whose default changes nothing for the apps already using it; if one
is missing, build it on the shelf first (`.claude/rules/building-blocks.md`).

That includes the page frame. `packages/ui-kit/src/root.css` sets `body`'s font, size,
colour, background and margin; this app's `style.css` adds only `body { overflow: hidden }`.
`pnpm check:chrome` fails the build if an app restates it.

### Every control is a kit component

Not a bare `<button>` in a template literal, and not `el('button', { className: 'vl-btn' })`
either: `button()`, `iconButton()`, `buttonRow()`, `toggleSwitch()`, `sliderRow()`,
`segmentedControl()`, `selectField()`, `dpad()`, `dropZone()`, `dialog()`, `toast()`.
A class ladder is not a component: a stylesheet can only style what opts into it *by name*,
which is how the catalogue once grew 163 hand-built buttons wearing class names the kit never
defined. If the kit cannot express the control you need, **widen the kit**. `pnpm check:ui`
fails the build the moment a new hand-built control appears.

## Where things go

This layout is the house style. Keep it, or the catalogue drifts apart.

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ topbar: generators · licence · MakerWorld · Buy me a coffee                │
 ├─────────────────────────┬─────────────────────────────────┬────────────────┤
 │ LEFT                    │ STAGE                           │ RIGHT          │
 │ My Generator            │ 3D · Top                plate ▾ │ TEXT           │
 │ ┌─────────┬───────────┐ │                                 │ What the tag   │
 │ │ Size    │ SIZE &    │ │                                 │ says           │
 │ │ Font    │ SHAPE     │ │             the model           │ [Hello       ] │
 │ │Lettering│ Width     │ │                                 │                │
 │ │ Keyring │ Height    │ │                                 │                │
 │ │ Colors  │ …         │ │                                 ├────────────────┤
 │ └─────────┴───────────┘ │                                 │ Download 3MF   │
 │ ↺ Reset all settings    │                                 │ Save Load Help │
 │ Made by Vostok Labs     │ status                     hint │ Light mode     │
 └─────────────────────────┴─────────────────────────────────┴────────────────┘
```

- **Left** is every setting, in categories on the rail, one open at a time. Reset sits at
  its foot and the credit strip (with the Updates drawer) under that.
- **Right** is only what the customer types or brings in — text, a list, an image, a
  symbol — and Download at its foot. A setting never goes on the right, however
  important it is: if it changes the product, it lives in a category on the left.
- The **stage** has its overlay slots mapped at the top of the kit's `components/stage.ts`:
  how the preview is shown top-left, the plate picker top-right, the status line
  bottom-left, the "hold left click to rotate" hint bottom-right.
- On a narrow screen (`appShell({ phone: true })`) the rail moves behind a Settings button
  pinned beside Download.

## Categories and settings that make sense

The rail is the whole product to a customer: every category is a promise about what is
behind it. The rules below are what make one generator feel like the next, and a template
that breaks them gets copied into every generator after it.

### A category

1. **It is one thing the customer would name.** The test: can they say "I want to change
   the ___" with the label? *Size*, *Font*, *Lettering*, *Keyring*, *Colors* pass. *Advanced*,
   *Details*, *Options*, *Geometry*, *Params*, *Other* and numbered steps (`1 · Shape`) do not.
2. **One word under the icon.** The heading over the open category can say more
   (`title: 'Size & shape'`); the label under the icon cannot.
3. **The icon pictures the thing the category sets**, so it can be found without reading:
   a chain link for Keyring, a drop for Colors, a large and a small A for Lettering. No two
   categories on one rail share an icon. If `ICONS` has nothing that pictures it, add one to
   the kit (`packages/ui-kit/src/icons.ts`, Lucide or Feather, then `pnpm gen:assets`), as
   `lettering` was added for this template. Never borrow a near one, and never fall back to
   `sliders` or `maximize`: a rail of generic glyphs reads as one icon repeated.
4. **In the order the customer thinks about the product**: what it is and how big, then
   what goes on it and how it looks, then colours, then fit and printing. Selling (a licence
   category) comes last, set apart with `divider: true`.
5. **There is no "More".** Every setting sits in the category it changes: letter spacing
   in Lettering, never in Size or in a catch-all drawer. A setting with no obvious home means
   the categories are wrong, not that it needs a miscellaneous one.
6. **Hidden, never greyed.** A setting that does not apply right now is hidden
   (`row.hidden = true`), and a category whose rows are all hidden leaves the rail on its own
   (`rail.refresh()` re-reads it). Hole size only shows while there is a hole.

### A setting inside it

1. **The label says what changes, in the customer's words**: *Hole size*, not *lug radius*;
   *Raised by*, not *extrude depth*. Two labels must never be readable as the same thing
   (*Text size* is how big the letters are; *Raised by* is how far they stand up).
2. **Every number carries its unit** (`unit: 'mm'`, `'%'`, `'°'`).
3. **Help is one short sentence in a "?" tooltip** (`help:`), and only where the label
   cannot carry it on its own. Never a paragraph under a control.
4. **The control fits the decision**: a switch for on or off, option tabs for two to four
   choices (pictures when it is a look), a slider for an amount, a stepper for a count, a
   dropdown only for a long list.
5. **Defaults print well as they are**, on a Bambu printer with the standard profile. The
   first screen is a product someone would download without touching anything.
6. **Ranges are what prints.** A slider's ends are the sensible limits; combinations a slider
   cannot see (a hole bigger than the tag) are clamped in the geometry (`fitSettings`), and
   the status line says what changed ("Text made smaller to fit").
7. **Only what the product needs.** A kit block existing is not a reason to place it. Ask
   before adding a control the request did not name.

### Check it before calling it done

- Read the rail aloud. Is every word a thing the customer would recognise?
- Cover the labels. Can you still tell each category by its icon?
- For every control: which category would a customer open to find it? Is it there?
- Every number has a unit, every "?" is one sentence, nothing is greyed out, and the right
  panel holds nothing but what is typed or brought in.

## Making a new generator

### Step 1 — run the scaffold, don't copy by hand

```bash
pnpm new:generator <id> "Display Name" "one-line description"
pnpm install
```

That copies this folder to `apps/<id>`, performs the rename checklist below and adds a
`.claude/launch.json` entry on a free port. The app runs immediately.

The checklist is kept here because it says *why* each string matters — read it when
something looks wrong, not to execute it.

| Where | What | Why it matters |
| --- | --- | --- |
| `package.json` | `"name"` | `pnpm --filter` uses it |
| `.claude/launch.json` | add an entry + free port | how the preview starts |
| `index.html` | `<title>`, `<meta name="description">` | browser tab, link previews |
| `main.ts` §5 | `sidebarFooter({ themeStorageKey })` | **collides** — a shared key means a theme chosen in one generator changes the other |
| `main.ts` §5 | `downloadThreeMF(..., { title, generator, application }, 'tag.3mf')` | `generator` is the provenance id baked into every export; the filename is what the user sees in Downloads |
| `main.ts` §1, §5 | the project file's `app` and its file name | the app and the template would open each other's projects |
| `main.ts` §5 | the help dialog's title | it is the name people read |
| `main.ts` §5, §7 | `generatorHeader({ title })`, `panelCredit({ title })` | the name users read, at the top and in the credit strip |
| `state.ts` | `TagSettings` → your settings | Save/Load serialise this |
| `geometry.ts` | `buildTag` → your builder | see step 3 |

The scaffold does every row above except the last two — `state.ts` and `geometry.ts` are the
actual work. It also rewrites the `tpl-` CSS prefix to your app's own, so two generators never
fight over a class name.

### Step 2 — work through `src/main.ts`

It is numbered 1–7, top to bottom:

1. **State** (`src/state.ts`) — your settings object; Save/Load serialise it.
2. **Rebuild** — the build loop. Swap `buildTag` for your geometry. Real generators run it in
   a worker with `manifold-3d` (`workerClient()` / `answerRequests()`).
3. **Settings** — your controls, kept in the `controls` map so a loaded project can be pushed
   back into them, then **the rail**: decide the categories with the rules above before you
   write the first slider.
4. **What the customer types** — the right panel. Text here; an import (a drop zone, samples)
   or a list where the product needs one.
5. **Chrome** — header, Reset, export, save, load and help.
6. **Stage** — the preview and its overlays. Drop the view bar if there is one way to look.
7. **Assemble** — usually unchanged.

### Step 3 — point the geometry at your own shapes

Everything downstream (viewer, 3MF, colours, filament slots) already speaks one part shape,
so emitting this is the whole contract:

```ts
{ name: string, positions: Float32Array, indices: Uint32Array, color: [r, g, b] }
```

Give parts that print in different filaments different `color` values — slots are assigned
per distinct colour, in first-seen order. Parts that must stay separately movable in the
slicer (two halves of a hinge) get a different `group`.

Keep the geometry free of the font library and the DOM, as `geometry.ts` is: it takes the
parsed face from `main.ts`, so a worker or a node test can run it unchanged.

### Step 4 — replace the test

`tests/geometry.test.mts` sweeps the demo across its range and checks what a customer would
notice: every part a closed mesh, the letters on the tag and clear of the hole, long text
made smaller rather than hanging off the edge. Swap it for the same promises about your
product; `pnpm test` runs it in CI.

## Export: 3MF only, and don't hand-roll it

The template exports **3MF and nothing else**, on purpose. STL carries neither the colours
nor the part split, so a "Download STL" button next to the real export is a downgrade offered
at the moment of success. `@vostok/export` can still write STL and OBJ if a generator
genuinely needs them — just don't put it in the footer beside the 3MF.

The export path is one function: `await loop.settled()` (the build that matches the screen,
never a variable holding the last one), the shelf's writer, then `licenseAfterExport()`.

Always go through `@vostok/export`. The 3MF it writes carries three things that are easy to
miss and invisible until a user complains:

- `Metadata/project_settings.config` — the filament list, and Bambu's A1 / 0.4 nozzle /
  Bambu PLA Basic presets in full. Without the filament list, someone with a single filament
  loaded opens your model and every part collapses onto slot 1. Without the *whole* presets,
  Studio cannot match them to its own and labels the printer, process and every filament with
  your file's name instead. A near-match is the same as no match — see `projectSettings()`.
- The `BambuStudio:3mfVersion` metadata and matching `xmlns:BambuStudio`. Bambu Studio only
  reads the file above when these are present; otherwise it says *"The 3mf is not from Bambu
  Lab, load geometry data and color data only"* and throws the filament list away.
- `<m:colorgroup>` for the standard-3MF path (PrusaSlicer, Orca).

The presets are a snapshot of an installed Bambu Studio, regenerated with
`pnpm --filter @vostok/export profile:build` and verified against real Studio projects by
`pnpm --filter @vostok/export check`.

## Nothing may jump

Drag **Corner radius**, or type on the right. The model changes and *nothing else moves* —
the camera, the framing and the model's position on the plate all stay where you left them.
That is the bar. Every control in every generator should feel like that one.

A parameter edit is allowed to change the model. It is not allowed to move the camera,
re-centre the view, or reposition the model on the plate. Three things break that, and all
three have shipped at least once:

1. **Threshold re-framing.** A rule like "re-frame when the model grew past 1.6x" is a
   discontinuity by construction: nothing happens for most of a drag, then one lurch. The
   viewer only eases the camera outward, a little on every step, while the model is
   outgrowing the frame — never a lot on one.
2. **Stale world matrices.** `Box3.expandByObject()` and `setFromObject()` refresh the
   object's own matrix but reuse its *parent's* cached one. Measure a model after re-centring
   its group without `updateMatrixWorld(true)` first and you get last build's frame, so the
   model hops above or sinks into the plate on every rebuild.
3. **Anchoring on something that moves.** Centre on a bounding box that includes the part
   the user is editing and the model slides sideways on every keystroke. Anchor X/Y on the
   stable body (`setParts(parts, refit, anchor)`) and take Z from the full assembly.

Only a new model refits the camera (`triggerRebuild(true)`): the first build, Load, Reset.

## Verify it in the browser before you call it done

Drive the real UI: change a setting in every category, type, Download, and open the file in
Bambu Studio — the parts on their own filaments, in the colours the rows show. Put it beside
the clicker or the keycap generator at the same window size: the panels, the rail and the
footer should measure the same. If yours differs, the cause is usually double padding or a
`display` that overrides a kit rule, not a value worth hardcoding locally.

## Two things the demo geometry is showing you

Both cost real debugging time, so they are worth copying:

- **Clamp before you build** (`fitSettings`). Sliders will happily ask for a 10 mm hole in
  a 10 mm tag. Shrink the feature; never emit a torn mesh. Text that is too long is made
  smaller to fit, and the status line says so.
- **Weld your loops** (`weldLoop`). A closed outline that repeats its first point turns into
  zero-area slivers, and enough of those tear the mesh open — which slicers *will* complain
  about. A font's outlines repeat their first point, so the letters need it too. The test
  holds every part watertight across the whole range.
