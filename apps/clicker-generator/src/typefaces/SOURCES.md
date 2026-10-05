# Where these typefaces come from

Written by `scripts/typefaces.mjs`, which makes each file below from the font file named, at the
commit named, and stops if that file's sha256 has changed. Change the script and run it again
rather than editing these files.

| File | Face | Source | Commit | sha256 of the source | Licence |
| --- | --- | --- | --- | --- | --- |
| `roboto_regular.typeface.json` | Roboto 2.137 | [google/fonts `apache/roboto/Roboto-Regular.ttf`](https://github.com/google/fonts/blob/7b64519fb0fd8b03b563b32ff55d2362db2c90bf/apache/roboto/Roboto-Regular.ttf) | `7b64519` | `79e851404657dac2106b3d22ad256d47824a9a5765458edb72c9102a45816d95` | Apache-2.0 |
| `roboto_bold.typeface.json` | Roboto Bold 2.137 | [google/fonts `apache/roboto/Roboto-Bold.ttf`](https://github.com/google/fonts/blob/7b64519fb0fd8b03b563b32ff55d2362db2c90bf/apache/roboto/Roboto-Bold.ttf) | `7b64519` | `7d0b991ee3e0be7af01ad7ea8cd2beea6c00a25e679a0226b6737f079aafff86` | Apache-2.0 |

What the conversion changes: the outlines are scaled to 1000 units per 0.72 em and rounded to whole units, and only Latin, Greek, Cyrillic, punctuation and common symbols are kept. The outlines are otherwise the font's own.

Each file says so in its `conversion` field, and carries the font's own name table, with its
copyright and licence, in `original_font_information`.
