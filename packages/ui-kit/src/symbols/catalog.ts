/*
  The bundled symbol set: 75 monochrome drawings, each an SVG file with a name, a source and
  a category.

    Fluent Emoji, High Contrast style   Copyright (c) Microsoft Corporation          MIT
      https://github.com/microsoft/fluentui-emoji
    Tabler Icons, filled set            Copyright (c) 2020-2026 Paweł Kuna           MIT
      https://github.com/tabler/tabler-icons

  MIT asks for its notice to travel with every copy. The two licence texts sit beside the
  data (`fluent-emoji.LICENSE.txt`, `tabler-icons.LICENSE.txt`), and
  `scripts/third-party-notices.mjs` writes both into the THIRD-PARTY-NOTICES of every app
  whose source names an export of this module — using the catalog is all it takes to be
  covered, there is no list to remember to update.

  Data only: no tracing and no font. What a drawing becomes (a traced outline, a tile, an
  inline token) belongs to the app, so the file travels as its own text and each app reads it
  with the tracer it already has. Nothing here runs at import, so an app that never names
  these exports never bundles the 190 KB behind them.
*/
import data from './catalog.json';

export interface CatalogSymbol {
  /** Stable id, `fluent-…` or `tabler-…`. */
  id: string;
  /** What to call it: "Grinning face", "Paw". */
  label: string;
  /** The set it comes from: "Fluent Emoji" or "Tabler Filled". */
  source: string;
  /** "Smileys", "Pictorial" or "Solid icons". */
  category: string;
  /** The SVG file as text, in the source's own colours (`#212121` fills, `currentColor`). */
  svg: string;
}

export const SYMBOL_CATALOG: readonly CatalogSymbol[] = data;

/** The catalog symbols a picker puts first, in catalog order. */
export const POPULAR_SYMBOL_IDS: readonly string[] = [
  'fluent-grinning-face',
  'fluent-smiling-face-with-heart-eyes',
  'fluent-cat-face',
  'fluent-dog-face',
  'tabler-heart',
  'tabler-star',
  'tabler-paw',
  'tabler-butterfly',
  'tabler-flower',
  'tabler-moon',
  'tabler-crown',
];
