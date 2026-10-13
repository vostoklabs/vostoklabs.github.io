# Photo Frames Studio

Frames, holders and music plaques for your prints, from Instant mini to A5, with a stand, magnets or a key ring.

```bash
pnpm --filter photo-frame dev
```

Scaffolded from `apps/generator-template` with `pnpm new:generator`. That template's
[README](../generator-template/README.md) is still the reference for the layout, the rules
for the rail's categories and the settings in them, the numbered `main.ts` walkthrough, the
export rules and the "nothing may jump" bar — read it there rather than copying it here, so
it stays true when the kit moves.

## What is app-specific here

- `src/designs.ts` — the designs the gallery opens, each a set of settings under a name.
- `src/settings.ts`, `src/state.ts` — the settings object and how a loaded one is checked;
  Save/Load serialise exactly this.
- `src/rules.ts` — what each design and print can take, and how settings are kept inside it.
- `src/sizes.ts` — the print sizes and the magnets.
- `src/ink.ts`, `src/text.ts`, `src/pattern.ts` — everything printed in the second colour: the
  words, the player or post art, the pattern.
- `src/geometry/` — the worker's side: `layout.ts` places everything in millimetres,
  `outline.ts` draws the outlines, `glyphs.ts` the player and post art, `build.ts` makes the
  solids, standing and laid flat for the printer.
- `src/gallery.ts`, `src/walkthrough.ts`, `src/choose.ts`, `src/pictures.ts`, `src/tiles.ts` —
  the gallery, "Help me choose" and the pictures of real builds they show.
- `src/samples.ts`, `src/photoPreview.ts` — the sample photos shown in the preview, never in a file.
- `src/main.ts` — the controls, the rail's categories and what goes on the right.
- `tests/` — every design and print size built without a browser.
- `src/style.css` — only what is unique to this app. Anything a second generator could
  want belongs in `@vostok/ui-kit`.
