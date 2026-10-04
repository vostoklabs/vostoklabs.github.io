# @vostok/fonts

The shared font set for every generator that puts type on a model: 152 bundled
faces, the opentype loader, and the text→contours layout.

Used by the **name keychain** and the **magnet generator**'s Text source.

## What's here

| Path | What it is |
|---|---|
| `src/fonts/*.ttf` | The faces themselves, plus `icon-fallback.ttf` for missing glyphs |
| `src/registry.ts` | Generated: id / label / category / curated / subsets / bytes |
| `src/coverage.ts` | What each `subsets` name means, as a character set, and what a character needs |
| `src/fonts.css` | Generated: `@font-face` rules, family `VL-<id>` — **HTML previews only** |
| `src/textLayout.ts` | opentype path commands → 2D polygon contours, Y-up |
| `src/index.ts` | `getFont`, `parseFont`, `registerCustomFont`, `isFontSupported`, `getRequiredSubsets`, `fontScripts`, `fontFamilyFor` |

`registry.ts`, `fonts.css` and `fonts/CREDITS.md` are written by
`pnpm --filter @vostok/fonts fetch-fonts` — don't hand-edit them.

## Two ways a font is used, and they are not the same

- **Preview** — the HTML font grid renders in `VL-<id>` from `fonts.css`. Import
  it once in your app's stylesheet: `@import '@vostok/fonts/fonts.css';`
- **Geometry** — the model comes from `getFont(id)` → opentype → `textLayout`.
  Nothing here touches the DOM, so it also runs headless.

## Offline bundles

The `.ttf` files are referenced through `import.meta.glob` as **asset URLs**, so
every app's own `vite build` emits its own copy into its own `dist/`. Sharing the
source dedupes the repo without coupling the outputs — shipping one generator as
a standalone offline bundle stays a straight copy of its `dist/`. Both the
keychain and the magnet generator emit all 153 files today; that duplication in
the *output* is deliberate.

Because of the glob, this package must be consumed **as source** (it is —
`exports` points at `.ts`), never pre-bundled.

## Coverage

A face's `subsets` are measured from its own cmap against the character sets in
`src/coverage.ts`, never copied from the font API: Google Fonts' subset names
(`latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `vietnamese`, `korean`,
`japanese`, `chinese-simplified`, `armenian`, `georgian`) plus `kana`, for hiragana
and katakana without the kanji. `isFontSupported` checks text against the same sets,
and `fontScripts` turns them into the alphabet names the kit's font list filters by.
`pnpm --filter @vostok/fonts test` fails when the registry and the files disagree.

## Adding a font

1. Add the slug to the table in `scripts/fetch-fonts.mjs`. A face wanted for another
   alphabet also goes in `UPSTREAM` there: it is taken from google/fonts and, when large,
   cut to that alphabet's common set.
2. `pnpm --filter @vostok/fonts fetch-fonts`
3. Commit the new `.ttf` plus the regenerated `registry.ts` / `fonts.css` / `CREDITS.md`.

`curated: true` puts a face in the instant grid; everything else lives behind
"Browse all fonts". A curated face's file is fetched by every generator that shows
the grid, so weigh its `bytes` first: a CJK face is hundreds of KB even when cut.
