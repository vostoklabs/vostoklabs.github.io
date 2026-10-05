# Built-in typefaces

The faces the keycap draws legends with, in three.js's typeface format. They are the app's own
files, bundled into the script (three stopped shipping `examples/fonts/` after 0.171), so a
legend can be drawn, and the fit test labelled, before anything else has loaded.

| Shown as | Files | Made from |
| --- | --- | --- |
| Roboto, Roboto Bold | `roboto_*.typeface.json` | Roboto 2.137, by `scripts/typefaces.mjs` |
| Libertinus Sans, Libertinus Sans Bold | `libertinus_sans_*.typeface.json` | Libertinus Sans 7.051, by `scripts/typefaces.mjs` |
| Droid Sans, Sans Bold, Sans Mono, Serif, Serif Bold | `droid/*.typeface.json` | Android's Droid fonts, by `scripts/typefaces.mjs` |
| Gentilis, Gentilis Bold | `gentilis_*.typeface.json` | three.js's example fonts, unchanged |

[`SOURCES.md`](SOURCES.md) names the font file, commit and sha256 each converted face was made
from, and what the conversion changes. To change one, edit the script and run
`node scripts/typefaces.mjs` from the repository root.

Roboto and Libertinus Sans replaced Helvetiker and Optimer, whose licence is not one this project
ships, and kept their ids (`helvetiker-*`, `optimer-*`) so a saved design still finds them. The
Droid files were three's copies; these are made from the Android release of the same fonts whose
files say Apache-2.0.

The licences, with each face's copyright: [`LICENSE`](LICENSE).
