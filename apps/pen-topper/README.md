# Pen Topper Generator

Snap-on pen and pencil toppers with names, symbols and a socket that fits your pen.

```bash
pnpm --filter pen-topper dev
```

Scaffolded from `apps/generator-template` with `pnpm new:generator`. That template's
[README](../generator-template/README.md) is still the reference for the layout, the
numbered `main.ts` walkthrough, the export rules and the "nothing may jump" bar — read it
there rather than copying it here, so it stays true when the kit moves.

## What is app-specific here

- `src/geometry.ts` — the builder. Emits `{ name, positions, indices, color }` parts.
- `src/state.ts` — the settings object; Save/Load serialise exactly this.
- `src/style.css` — only what is unique to this app. Anything a second generator could
  want belongs in `@vostok/ui-kit`.
