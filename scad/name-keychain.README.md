# Name Keychain Generator (`name-keychain.scad`)

Parametric name keychain for MakerWorld PMM (C-route) — the factory-shakedown build.
Plate + colour-halo + letters in clean Z-bands, multi-language, vertical/horizontal,
always-fused keyring, optional bevelled edges and outline/rectangle plate. License:
free for personal use only (MakerWorld Standard Digital File License, see header);
commercial sales require a Vostok Labs license.

## Local render / verify
Uses OpenSCAD **2021.01** (MW-compatible). CLI must be `openscad.com` on Windows.
```
& "C:\Program Files\OpenSCAD\openscad.com" -o renders\check.stl "name-keychain.scad"
```
CJK/Hebrew/Arabic glyphs won't render locally (fonts not installed) — verify those on MW.

## Changelog
- **v0.2 (2026-07-20)** — parity pass with the B-route web app. Added: **line spacing**
  (`line_spacing`), **letter spacing** (`letter_spacing`, via `text(spacing=)`), **boldness**
  (`boldness`, via `offset()`), **bevelled top edges** on plate + letters (`chamfer`, a light
  1–2 step inset taper), and a **Rectangle plate** option (`plate_shape`, an estimated rounded
  box unioned with `hull(glyphs)` so a wide name can't overflow). Two-line connector widened to
  the line overlap (no thin plastic neck); vertical ring re-seated cleanly above the stack;
  no-AMS pause heights `echo`ed. **Removed** uniform-height mode. License header corrected to
  SDFL (personal-use) — was self-contradictory CC BY-NC-ND. Line-2 stays left-aligned (centre/
  right needs `textmetrics`, unreliable in 2021.01 — that alignment is a web-app-only extra).
- **v0.1 (2026-07-18)** — first build. 3-colour halo stack; bubble/script/pixel fonts +
  font-style + custom override; multi-language (CJK/Cyrillic/Hebrew/Arabic) with RTL;
  horizontal & vertical layout; deterministic always-fused loop (fixes rivals' Y/T/X/W
  detach bug); raised/engraved; uniform-height tag mode; license-acknowledgement toggle.
  **Watermark: deferred** (no seed era yet — source is close-sourced on MW instead).

## Deferred / fast-follow
Batch/plate-pack (needs multi-plate, which disables STL download) · watermark module · B-route
hub app (live colour + font preview).
