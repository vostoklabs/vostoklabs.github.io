# @vostok/fonts

The shared font set for every generator that puts type on a model: 256 bundled
faces, the opentype loader, and the text→contours layout.

Used by the **name keychain** and the **magnet generator**'s Text source.

## What's here

| Path | What it is |
|---|---|
| `src/fonts/*.ttf` | The faces themselves, plus `icon-fallback.ttf` for missing glyphs |
| `src/fonts/*.otf` | A face shipped as its maker released it (Source Han Sans CN) |
| `src/registry.ts` | Generated: id / label / category / curated / subsets / latinExtB / han / preview / bytes |
| `src/coverage.ts` | What each `subsets` name means, as a character set, and what a character needs |
| `src/fonts.css` | Generated: `@font-face` rules, family `VL-<id>` — **HTML previews only** |
| `src/textLayout.ts` | opentype path commands → 2D polygon contours, Y-up |
| `src/index.ts` | `getFont`, `parseFont`, `registerCustomFont`, `isFontSupported`, `getRequiredSubsets`, `fontScripts`, `fontFamilyFor` |

`registry.ts`, `fonts.css` and `fonts/CREDITS.md` are written by
`pnpm --filter @vostok/fonts fetch-fonts` — don't hand-edit them.

## Two ways a font is used, and they are not the same

- **Preview** — the HTML font grid renders in `VL-<id>` from `fonts.css`. Import
  it once in your app's stylesheet: `@import '@vostok/fonts/fonts.css';`
  A face too heavy to fetch just to draw its row (Source Han Sans CN, 8 MB) has a
  `preview` face instead and no rule in `fonts.css`: `toPickerFont` draws its row in
  the preview face, and `getFont` declares it from its own bytes once it has loaded.
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

**On the website** every font file is kept once for the whole site. The Pages deploy builds every
app with `VITE_SITE_FONTS=shared/fonts/`, so `getFont`, `getFontUrl`, the symbol font and the other
weights fetch each file from `<site>/shared/fonts/` (`src/site.ts`), and then runs
`scripts/site-fonts.mjs`, which puts the package's files there, points each app's built
stylesheet (`fonts.css`'s rules) at them, and takes out each app's copies. It checks everything
first and changes nothing if an app was built without the folder, a copy differs from the
package's file, or a stylesheet or page would still name a copy. Unset — dev servers,
`vite preview`, MakerLab and offline builds — every face comes from the app's own `dist/`, as
above, and `keepOnlyFonts` narrows a build the same way either way.

**Leaving faces out.** `leaveOutFonts(ids)` (also `@vostok/fonts/vite`) is the other way round:
the build keeps the whole library but the named faces. Their files are never emitted, and the
index learns their names, so `FONTS`, `curatedFonts()`, every picker built on them and
`fallbackFaces` stop offering a face that is not there (`inThisBuild(id)` answers for one face).
The clicker's MakerLab build keeps 186 faces this way.

## Coverage

A face's `subsets` are measured from its own cmap against the character sets in
`src/coverage.ts`, never copied from the font API: Google Fonts' subset names
(`latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `vietnamese`, `korean`,
`japanese`, `chinese-simplified`, `armenian`, `georgian`) plus `kana`, for hiragana
and katakana without the kanji. Latin Extended-B (U+0180–024F) has no name: faces cover it
too unevenly, so each file's letters from it are listed as `latinExtB` and text is checked
against them letter by letter. A Han character past the common sets the CJK faces are cut
to needs that very character: a face whole enough to hold more lists its Han characters as
runs in `han` (only Source Han Sans CN does). `isFontSupported` checks text against the same sets, and
`fontScripts` turns them into the alphabet names the kit's font list filters by.
`pnpm --filter @vostok/fonts test` fails when the registry and the files disagree.

## Adding a font

1. Add the slug to the table in `scripts/fetch-fonts.mjs`. A face wanted for another
   alphabet also goes in `UPSTREAM` there: it is taken from google/fonts and, when large,
   cut to that alphabet's common set.
2. `pnpm --filter @vostok/fonts fetch-fonts`. It reads the family's licence file in
   google/fonts at the pinned commit, and refuses a face from the font API named with a
   name that file reserves: such a family goes in `ORIGINALS`, as its original file.
   A face google/fonts does not carry goes in `RELEASES`: its maker's own file, pinned by
   commit and sha256, shipped whole, its licence read from the release at that commit.
3. Commit the new `.ttf` (or `.otf`) plus the regenerated `registry.ts` / `fonts.css` /
   `CREDITS.md` and the face's row in the repo's `assets.json`, which `pnpm check:assets`
   holds it to.

`curated: true` puts a face in the instant grid; everything else lives behind
"Browse all fonts". A curated face's file is fetched by every generator that shows
the grid, so weigh its `bytes` first: a CJK face is hundreds of KB even when cut.
