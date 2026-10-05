# Where these typefaces come from

Written by `scripts/typefaces.mjs`, which makes each file below from the font file named, at the
commit named, and stops if that file's sha256 has changed. Change the script and run it again
rather than editing these files.

| File | Face | Source | Commit | sha256 of the source | Licence |
| --- | --- | --- | --- | --- | --- |
| `roboto_regular.typeface.json` | Roboto 2.137 | [google/fonts `apache/roboto/Roboto-Regular.ttf`](https://github.com/google/fonts/blob/7b64519fb0fd8b03b563b32ff55d2362db2c90bf/apache/roboto/Roboto-Regular.ttf) | `7b64519` | `79e851404657dac2106b3d22ad256d47824a9a5765458edb72c9102a45816d95` | Apache-2.0 |
| `roboto_bold.typeface.json` | Roboto Bold 2.137 | [google/fonts `apache/roboto/Roboto-Bold.ttf`](https://github.com/google/fonts/blob/7b64519fb0fd8b03b563b32ff55d2362db2c90bf/apache/roboto/Roboto-Bold.ttf) | `7b64519` | `7d0b991ee3e0be7af01ad7ea8cd2beea6c00a25e679a0226b6737f079aafff86` | Apache-2.0 |
| `libertinus_sans_regular.typeface.json` | Libertinus Sans Regular 7.051 | [google/fonts `ofl/libertinussans/LibertinusSans-Regular.ttf`](https://github.com/google/fonts/blob/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/libertinussans/LibertinusSans-Regular.ttf) | `9710da1` | `2d261d21add710a08b2ffbd89072d7fd2f29a19582e872da4b8f8f6d622cd78b` | OFL-1.1, no Reserved Font Name |
| `libertinus_sans_bold.typeface.json` | Libertinus Sans Bold 7.051 | [google/fonts `ofl/libertinussans/LibertinusSans-Bold.ttf`](https://github.com/google/fonts/blob/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/libertinussans/LibertinusSans-Bold.ttf) | `9710da1` | `92e1e56b0d949241c400e3bca9a772a5318d3b49de7c5f7ccff0413d1a4cc339` | OFL-1.1, no Reserved Font Name |
| `droid/droid_sans_regular.typeface.json` | Droid Sans 1.00 build 113 | [aosp-mirror/platform_frameworks_base `data/fonts/DroidSans.ttf`](https://github.com/aosp-mirror/platform_frameworks_base/blob/8f4b5a561813ee8c22d2b8e73c33299471d4a3f3/data/fonts/DroidSans.ttf) | `8f4b5a5` (tag android-1.6_r1) | `4e2371bc0e4cf6983342e150412f140da79d674c9be0b56458401f581072ecd3` | Apache-2.0 |
| `droid/droid_sans_bold.typeface.json` | Droid Sans Bold 1.00 build 112 | [aosp-mirror/platform_frameworks_base `data/fonts/DroidSans-Bold.ttf`](https://github.com/aosp-mirror/platform_frameworks_base/blob/8f4b5a561813ee8c22d2b8e73c33299471d4a3f3/data/fonts/DroidSans-Bold.ttf) | `8f4b5a5` (tag android-1.6_r1) | `b631b677af5aa7316297a8b56a1fe3bb1da706737f8c9785d5a5fc94faae1ea9` | Apache-2.0 |
| `droid/droid_sans_mono_regular.typeface.json` | Droid Sans Mono 1.00 build 112 | [aosp-mirror/platform_frameworks_base `data/fonts/DroidSansMono.ttf`](https://github.com/aosp-mirror/platform_frameworks_base/blob/8f4b5a561813ee8c22d2b8e73c33299471d4a3f3/data/fonts/DroidSansMono.ttf) | `8f4b5a5` (tag android-1.6_r1) | `089bdaac95caeed25a8392a6f0606328d009473119f1c7465b642d5cebe5320c` | Apache-2.0 |
| `droid/droid_serif_regular.typeface.json` | Droid Serif 1.00 build 112 | [aosp-mirror/platform_frameworks_base `data/fonts/DroidSerif-Regular.ttf`](https://github.com/aosp-mirror/platform_frameworks_base/blob/8f4b5a561813ee8c22d2b8e73c33299471d4a3f3/data/fonts/DroidSerif-Regular.ttf) | `8f4b5a5` (tag android-1.6_r1) | `57e4e2f2bc0194e05be42b40826f0c7d2b046047e0e94b8bdddef10bc47470fb` | Apache-2.0 |
| `droid/droid_serif_bold.typeface.json` | Droid Serif Bold 1.00 build 112 | [aosp-mirror/platform_frameworks_base `data/fonts/DroidSerif-Bold.ttf`](https://github.com/aosp-mirror/platform_frameworks_base/blob/8f4b5a561813ee8c22d2b8e73c33299471d4a3f3/data/fonts/DroidSerif-Bold.ttf) | `8f4b5a5` (tag android-1.6_r1) | `ed3235ab9bf3551d3739a3978ae8bb21493cf37046f3a01f557f9df7ef03219f` | Apache-2.0 |

What the conversion changes: the outlines are scaled to 1000 units per 0.72 em and rounded to whole units, and only Latin, Greek, Cyrillic, punctuation and common symbols are kept. The outlines are otherwise the font's own.

`libertinus_sans_regular.typeface.json` and `libertinus_sans_bold.typeface.json` keep less: only Latin, punctuation, common and key symbols, and Optimer's Greek letters (Optimer is the face this replaces).

Each file says so in its `conversion` field, and carries the font's own name table, with its
copyright and licence, in `original_font_information`.
