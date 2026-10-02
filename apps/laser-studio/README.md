# Laser Studio

Pick a template, type your text, download the cut file.

```bash
pnpm dev:laserStudio            # http://localhost:5187
pnpm --filter laser-studio test:browser   # headless Chrome over CDP against the dev server
```

Two screens. The **gallery** (`#/`) shows every template as a card whose picture is the
template's own default build. The **editor** (`#/t/<id>`) is the house three columns: the
settings on the left in named sections ("<- All templates" pinned above them), the part in the
middle (2D Design, an orbitable 3D Preview, or Export Preview in laser colours), and what
you type on the right — Text, the font cards with "Browse all" and "Import your own font" — over
the standard footer (Download SVG, Save, Load, Help, theme). The keyring hole is dragged on the
preview and lands anywhere you drop it — outside the edge, centred on it with half hanging
over, or inside the part. A hole is held in material by `holdInside()`; a loop tab is free and
the build welds it back on with a neck. The drag writes the same `ringDx`/`ringDy` the nudge pad
does, so the two are one control.

## Adding a template

One file in `src/templates/`, one line in `src/templates/index.ts`. A template is:

```ts
export const myDesign: TemplateDef = {
  id: 'my-design',            // the hash and the file name stem
  name: 'My design',
  blurb: 'One line for the card.',
  tags: ['keychain', 'engrave + cut'],   // the first tag is the gallery filter category
  fields: [ /* the short form, see below */ ],
  async build(values) {        // values → what the engine builds
    return { blank, keyring, layers };
  },
};
```

**Fields** are the whole form. Kinds: `text` (with `symbols: true` for the symbol button),
`font` (the curated font cards + "Browse all"), `number` (a slider: `min`, `max`, `step`,
`unit`), `select` (a segmented control up to four options, a dropdown after that), `toggle`,
`symbol` (the icon library), `blank` (the shape library, `categories` narrows it). Every field
has a `value` — its default. `advanced: true` folds it under "More options"; `group: 'Keyring'`
puts it in its own closed section; `under: 'font'` folds it as a satellite of that field ("Show
font options"); `hidden: true` saves and loads it without a control; `help` adds a "?" tooltip
of one short sentence (the only copy a control gets — no paragraphs, 2026-09-21)
under the control; `visibleWhen: (v) => …` hides it until it applies. Keep the first
screen to three or four fields: text, font, size, the one knob that makes this design this
design.

**build()** returns the engine's `BuildInput`:

- `blank` — `{ kind: 'hug', margin, smoothing }` for an outline that follows the layers,
  `{ kind: 'shape', shapes }` for a blank from `buildBlank()` (or any rings you make),
  `{ kind: 'none' }` for artwork alone.
- `keyring` — `keyringFrom(values)` if you spread `...keyringFields('outside' | 'none')`. The
  control is **Loop tab | None**; `'inside'` is a dead alias that opens as a loop tab. A design
  whose product IS a hole through the body either cuts it itself (`hangHoleFields` +
  `hangingHoleCentre`, the pet tag) or opts the option back in for its own control with
  `keyringFields('hole', { hole: true, … })` — matching keychains is the one that does.
  into the fields; otherwise `{ enabled: false, … }`.
- `layers` — from `textLayer(spec, op)` and `symbolLayer(char, size, op)` in `src/engine/text.ts`,
  or your own `{ id, label, shapes, op }`. `op` is `engrave` (black fill), `score` (blue line),
  `cut` (a hole through the part), or `off` with `hugOnly: true` for shapes that only feed the
  outline.

The engine unions, offsets, clips and punches in a worker (manifold); the preview and the SVG
export draw whatever comes back. Look at `name-keychain.ts` (hug + loop tab), `name-tag.ts`
(a blank, with "shrink to fit"), `symbol-charm.ts` and `connected-text.ts` for the four shapes
a design usually takes.

**More than one piece (2026-09-20).** A build may carry `parts: PartInput[]` — more pieces
built through the same pipeline in their own frames (a backer layer, a stand's base, a set of
place cards), each `{ id, label, blank, layers, keyring?: 'shared', at? }`, laid out beside the
primary by `layout: { flow: 'row' | 'column' | 'wrap', gap, maxWidth }`. `keyring: 'shared'`
punches the primary's hole (and lug) at the same local coordinates, so stacked layers register.
The preview labels each piece; the status line counts them; the export puts every outline in
one CUT group. A layer may also say `keep` (intersect with these shapes first) or `minus`
(subtract them), and a hugging blank takes `bridge` — the minimum width of the automatic
bridges between letters that do not touch. Pure helpers for the templates live beside the
engine: `text.ts` (`glyphLayers`, `arcTextLayer`), `warp.ts` (text warped into a silhouette, a
taper, an arch), `tiles.ts` + `crossword.ts` (letter tiles and their auto layout), `qr.ts`
(offline QR codes), `slots.ts` (kerf-aware slots and tabs for stands).

**Field kinds added the same day:** `lines` (a multi-line list — one name per line; read it
with `lines(values, key)`), `stepper` (an integer count), `thumbs` (a grid of silhouette tiles
to pick a theme). The settings rail picks its icon from the section's name (`railIcon` in
`form.ts`): "Layers", "Tiles", "Stand", "Guests", "Code" and the old "Shape & size" / "Font" /
"Keyring" each get their own.

## The library, 2026-09-20 evening

Twenty-five designs: the nine starters (the pet memorial removed, the Christmas ornament now a
bauble with a cap, connected text rewritten around real bridges and open counters) and the
template programme's sixteen — family crossword (+ its framed ornament and square sign modes),
letter tile keychain, layered keychain, shaped name (the carrot family), family names tree,
hair-tie holder (a shape with a band, or a name ladder), QR stand, name puzzle, cake topper,
place cards from a guest list, split monogram, arc coaster, SVG keychain, framed name ornament,
sports bag tag, house ornament, themed face ornament.

Two-layer designs carry `assembledAt`/`material` on their parts: the gallery card draws the
glued-up stack (dark sheet under light) and the **3D Preview** stacks the sheets by thickness; a
design that STANDS adds `pose` (`engine/types.ts`) so the 3D view shows it standing. The 2D Design
view and the export keep the cut layout with every piece labelled by sheet.

## Checking a template without a browser

```bash
node tests/node/build-template.mjs name-tag text=Zoë size=14   # → tests/node/.out/name-tag.svg + .export.svg
node tests/node/run-all.mjs                                     # every template → .out/index.html contact sheet
node tests/node/shoot.mjs                                       # ONE headless Chrome screenshot of that sheet → .out/index.png
node tests/node/engine.test.mjs                                 # the multi-part engine's own checks
EXTRA_TEMPLATES="<abs path>/src/templates/my-design.ts" node tests/node/build-template.mjs my-design
```

`tests/node/harness.mjs` bundles the real templates and engine with esbuild, reads the fonts
from `packages/fonts/src/fonts` and runs manifold's node build — the same geometry the worker
makes, minus the DOM. `EXTRA_TEMPLATES` lets a template that is not yet in `index.ts` be built.
Twelve templates were built in parallel on this harness; a headless Chrome per builder is what
froze the machine the time before, so builders verify here and one browser pass
(`pnpm test:browser`, `node tests/all-templates.test.mjs`) closes the programme.

## Reuse map

| Here | From |
|---|---|
| `src/engine/build.ts`, `editorGeometry.ts`, `worker.ts` | an internal laser engine (+ `hugOnly`); to be consolidated into `@vostok/laser/build` |
| `src/engine/text.ts` | an internal text layout, slimmed to explicit parameters |
| `src/export/laserSvg.ts` | an internal cut-file writer, renamed — `@vostok/export`'s cut-file writer carries the provenance mark |
| `galleryCard()` / `galleryGrid()` | new in `@vostok/ui-kit` (`components/gallery.ts`, `patterns.css`), lifted from the hub's card |
| everything else in the form and footer | `@vostok/ui-kit` as it stands |

## Shipped, and where it runs (2026-09-22)

**Live on the hub** at `/laser-studio/` — `generators.json` id `laser-studio`, route `app`, built
and copied by `.github/workflows/deploy.yml`, card picture from `pnpm render:laserStudioThumb`.
This app, `packages/laser` and `packages/patterns` are built from source by CI, so nothing the
studio imports can be fenced — treat these three as shipped code.

**MakerWorld** is a second build of the same source: `pnpm --filter laser-studio
build:mw` → `dist-mw/`. Everything specific to it is gated on
`MAKERLAB` from `virtual:makerlab`; the public build resolves that to a stub and contains no
host glue. The export goes to the host as a zip (SVG + a README of the colours),
there is no topbar, no Save/Load, no licence modal and no outbound link, and the cover is the
export itself rasterised.

## Checking the whole library

```bash
node tests/node/run-all.mjs        # all 43 templates through the real engine, in node
pnpm --filter laser-studio test:browser
pnpm typecheck && pnpm check:ui && pnpm check:chrome && pnpm check:notices
```
# Design starter

Copy `src/templates/starter.ts`, rename its export and unique id, and add it to
`TEMPLATES` in `src/templates/index.ts`. The starter is intentionally not in the gallery.
Define fields and geometry only: the shared renderer supplies category navigation,
plain input headings, cursor-aware symbol insertion, font browsing/import,
preview, save/load and SVG export.

Use `panel: 'right'` for what the customer types (text, a list, a symbol, a link) — the font
field is always a LEFT category — and `section` to group left-side
settings. Text fields support symbols by default (`symbols: false` opts out).
Use `visibleWhen` for dependent controls and `advanced` for rarely used settings.
Keep font fields in their own section so the font list can fill the remaining height.
Before registering a design, check default geometry, empty/long text, symbols,
save/load and SVG export at desktop and narrow widths.

## Symbols and previews

The symbol library opens on curated popular choices, with search, categories, 75 bundled
Fluent High Contrast/Tabler Filled SVGs, and the existing Material Symbols library.
Imported icons use the shared UI-kit SVG wizard and are kept in this browser under My icons.
Each inserted icon is an editable token: drag it in the text field, or use its move buttons;
select it to adjust size, horizontal/vertical offset and rotation, replace it, or remove it.
The inspector temporarily replaces the font browser. Close it to return to fonts.

Project saves embed icon outlines and transforms in the reserved __symbols value; no imported
file is needed when the project is loaded on another device. New text templates must pass
readSymbols(values) as TextSpec.symbols, as shown in starter.ts. Private token glyphs are
resolved by a font adapter so existing kerning, two-line layout, fitting and export use the
same contours. Ordinary text is unchanged.

3D Preview extrudes the actual cut plate and shows engraving and scoring on its surface.
Thickness (default 3 mm) is a preview setting, not an SVG/export dimension or a new stacked
layer. Drag to orbit; scroll to zoom. Export Preview keeps the real cut/score/engrave colors.

Bundled third-party icons: Microsoft Fluent Emoji (MIT) and Tabler Icons (MIT). Full notices
ship in public/licenses; the catalog records each icon's source. Regenerate the curated
catalog with node scripts/fetch-symbols.mjs.
