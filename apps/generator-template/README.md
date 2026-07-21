# Generator template

The starting point for a new Vostok Labs parametric generator. It gives you the
whole page frame — already consistent with every other generator — so a new tool
is mostly "wire the settings + the 3D preview."

## What you get for free

- **Layout** (`appShell`): full-width topbar over a left settings panel, a center
  3D stage, and a right panel. Thin scrollbars, responsive, light/dark aware.
- **Topbar** (`topbarLinks`): View on GitHub · Get commercial license · Boost on
  MakerWorld · Ko-fi.
- **Header** (`generatorHeader`): generator name + description + "Made by Vostok Labs".
- **Quality callout** (`qualityCallout`): the "for best print quality…" note,
  dismissable.
- **Footer** (`sidebarFooter`): Export 3MF + Save project / Load project / Help /
  Light mode.

All of these live in `@vostok/ui-kit` — this app just arranges them.

## Make a new generator

1. Copy this folder to `apps/<your-generator>`, update `name` in `package.json`.
2. Open `src/main.ts` and fill in the 5 numbered sections:
   1. **State** — your settings object (Save/Load serialise it).
   2. **Rebuild** — post state to your geometry worker; mount the result on `shell.stage`.
   3. **Settings** — your controls (`sliderRow`, `segmentedControl`, `selectField`, `toggleSwitch`; each takes an optional `help` tooltip).
   4. **Chrome** — tweak the header text, callout, and export/help handlers.
   5. **Assemble** — usually unchanged.
3. `pnpm --filter <your-generator> dev`.

## Run this template

```
pnpm --filter generator-template dev
```
