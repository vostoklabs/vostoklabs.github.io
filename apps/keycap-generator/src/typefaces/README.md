# Bundled three.js typefaces

These eleven `.typeface.json` files used to be imported straight from
`three/examples/fonts/`. **three stopped shipping `examples/fonts/` after 0.171**, so any
consumer on a newer version — Opal Suite is on 0.185 — fails to resolve the import and the
build dies. They are vendored here so this generator's built-in font list depends on its own
files rather than on which release of three happens to be installed.

Only the eleven the app actually imports are kept; the rest of the upstream folder is not.
Licence and attribution are unchanged — see `LICENSE`.
