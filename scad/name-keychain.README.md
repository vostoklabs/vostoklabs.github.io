# Name Keychain Generator (`name-keychain.scad`)

Parametric name keychain for MakerWorld PMM (C-route) — the factory-shakedown build.
Plate + colour-halo + letters in clean Z-bands, multi-language, vertical/horizontal,
always-fused keyring. License: CC BY-NC-ND 4.0 (see header); commercial sales require a
Vostok Labs license.

## Local render / verify
Uses OpenSCAD **2021.01** (MW-compatible). CLI must be `openscad.com` on Windows.
```
& "C:\Program Files\OpenSCAD\openscad.com" -o renders\check.stl "name-keychain.scad"
```
CJK/Hebrew/Arabic glyphs won't render locally (fonts not installed) — verify those on MW.

## Changelog
- **v0.1 (2026-07-18)** — first build. 3-colour halo stack; bubble/script/pixel fonts +
  font-style + custom override; multi-language (CJK/Cyrillic/Hebrew/Arabic) with RTL;
  horizontal & vertical layout; deterministic always-fused loop (fixes rivals' Y/T/X/W
  detach bug); raised/engraved; uniform-height tag mode; license-acknowledgement toggle.
  **Watermark: deferred** (no seed era yet — source is close-sourced on MW instead).

## Deferred / fast-follow
Batch/plate-pack (needs multi-plate, which disables STL download) · watermark module · B-route
hub app (live colour + font preview).
