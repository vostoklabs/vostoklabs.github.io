# Built-in typefaces

"Standard" and "Standard Bold" are Roboto Regular and Bold 2.137, the last static release of
Roboto under the Apache licence, in three.js's typeface format. They are the app's own files,
bundled into the script (three stopped shipping `examples/fonts/` after 0.171), so the default
text and the fit test's labels are drawn before anything else has loaded.

[`SOURCES.md`](SOURCES.md) names the font file, commit and sha256 each was made from, and what the
conversion changes. To change one, edit `scripts/typefaces.mjs` and run
`node scripts/typefaces.mjs` from the repository root.

Standard used to be Helvetiker, whose licence is not one this project ships. Roboto keeps its ids
(`helvetiker-regular`, `helvetiker-bold`), so a saved project still finds it.

Licence: Apache License 2.0, in [`LICENSE`](LICENSE). Copyright 2011 Google Inc.
