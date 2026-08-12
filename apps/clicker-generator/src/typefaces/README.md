# Bundled three.js typefaces

These two `.typeface.json` files used to be imported straight from `three/examples/fonts/`.
**three stopped shipping `examples/fonts/` after 0.171**, so any consumer on a newer version
— Opal Suite is on 0.185 — fails to resolve the import and the build dies. They are vendored
here so the built-in font list depends on this app's own files rather than on which release
of three happens to be installed.

Licence and attribution are unchanged — see `LICENSE`.
