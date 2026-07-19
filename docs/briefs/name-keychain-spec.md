---
id: name-keychain
stage: spec
created: 2026-07-18
status: awaiting-approval
route: both
---

# Spec — Name Keychain (name-keychain)

> **Scope evolved to flagship / both-route (2026-07-18).** See the "v2 scope update" section
> at the bottom for the C-route feature additions and the B-route app split — those supersede
> the "Route: C" framing below where they conflict.

- **Route:** C (MW OpenSCAD/PMM listing). v1 = **plate style only**, built modular so the
  connected-3D-letters style + more features drop in for the fast MVP follow.
- **One-liner:** A personalized name keychain — raised name on an outline backing plate with a
  repositionable ring — for Etsy/market sellers and gift-makers. Big curated font picker is the edge.
- **Watermark:** deferred (Ian). Reserve safe-zone now so the follow-up is trivial: underside
  centre of the base plate (always solid at every param extreme).

## Parameters

| Name | Type | Default | Range/Options | Section | Annotation | Notes |
|---|---|---|---|---|---|---|
| `name_text` | string | `"Name"` | free text | Text | — | single line v1; 2nd line = fast-follow |
| `font_name` | string | `"Fredoka"` | curated dropdown | Text | `// font` | curated list of best PMM families (below) |
| `custom_font` | string | `""` | free text | Text | — | overrides dropdown; escape-hatch to PMM's ~8000 |
| `text_size` | number | 18 | 8–40 | Size | `// [8:40]` | glyph height mm |
| `uniform_height` | bool | false | true/false | Size | — | seller toggle: fix plate height regardless of name length |
| `base_thickness` | number | 2 | 1–4 | Size | `// [1:0.2:4]` | = the color-swap layer for no-AMS |
| `text_thickness` | number | 1.6 | 0.6–4 | Size | `// [0.6:0.2:4]` | raised height above base |
| `outline_width` | number | 2.5 | 0–8 | Style | `// [0:0.5:8]` | plate margin around glyphs (0 = tight) |
| `corner_round` | number | 1.5 | 0–5 | Style | `// [0:0.5:5]` | softens the outline silhouette |
| `letter_style` | string | `"Raised"` | Raised / Engraved | Style | — | "flushed mode" equivalent |
| `ring_style` | string | `"Loop tab"` | Loop tab / Plain hole / Side hole | Ring | — | repositionable attachment |
| `ring_pos_x` | number | 0 | -60–60 | Ring | `// [-60:60]` | move along the name |
| `ring_pos_y` | number | 0 | -20–20 | Ring | `// [-20:20]` | nudge up/down |
| `hole_dia` | number | 4 | 2–8 | Ring | `// [2:0.5:8]` | split-ring clearance |
| `color_scheme` | string | `"Plate + Outline + Text"` | Single / Plate + Text / Plate + Outline + Text | Color | — | drives how many colored Z-bands generate |
| `base_hex` | string | `"#1d2027"` | hex | Color | `// color` | plate (bottom band) |
| `outline_hex` | string | `"#5b9dff"` | hex | Color | `// color` | raised halo ring around glyphs (mid band) |
| `text_hex` | string | `"#f2f4f8"` | hex | Color | `// color` | name (top band) |
| `halo_width` | number | 1.2 | 0–4 | Color | `// [0:0.2:4]` | thickness of the colored halo hugging each glyph |
| `halo_thickness` | number | 0.8 | 0.4–2 | Color | `// [0.4:0.2:2]` | Z height of the halo band (= 2nd no-AMS pause) |
| `show_base` / `show_text` | bool | true | — | `/* [Hidden] */` | for single-color part isolation |
| `$fn_budget` | number | 28 | — | `/* [Hidden] */` | arc detail — capped for PMM timeout safety |

**Curated font picker** (all verified present in PMM's built-in set — no upload needed):
- *Bubble/fun:* Fredoka · Bungee · Luckiest Guy · Chewy · Bubblegum Sans · Baloo 2 · Titan One · Lilita One · Modak
- *Script "Barbie":* Pacifico · Lobster · Dancing Script · Great Vibes · Sacramento · Grand Hotel · Alex Brush
- *Pixel/retro (must):* Press Start 2P · Silkscreen · VT323 · Pixelify Sans · Jersey 10 · Micro 5 · Handjet
- *Clean/bold:* Roboto · Montserrat · Poppins · Oswald · Anton

## Geometry approach

Pure OpenSCAD, **no external libraries** (avoids GPL + PMM timeout/library risk). Two stacked
`linear_extrude` layers:
1. **Base plate** = `offset(r=outline_width)` around `text()` → the sticker-style silhouette;
   `offset(corner_round)`/`offset(-corner_round)` pair to round; extruded `base_thickness`.
2. **Halo** (mid band, `Plate + Outline + Text` only) = `offset(r=halo_width)` around `text()`,
   extruded from `base_thickness` to `base_thickness+halo_thickness` → the raised colored ring
   that peeks around each glyph (the vinyl-sticker look from pic 3).
3. **Name** (top band) = `text()` extruded `text_thickness`, sitting **entirely above** the halo
   (raised) or `difference()`-cut into the plate (engraved).
4. **Ring** = tab/hole unioned into the plate via `hull()` between the ring anchor and the nearest
   plate mass, so it is **always connected** — this is the fix for the rivals' known bug where
   names starting Y/T/X/W detach the hole (their tab sits at a fixed x with no guaranteed overlap).

**Layered multicolor (not bare-bones):** three independently-colored Z-bands — plate / halo /
name — stacked lowest→highest so each color boundary is a clean horizontal layer.
- **No-AMS:** pause + swap at **two** surfaced heights — `base_thickness` (plate→halo) and
  `base_thickness+halo_thickness` (halo→name). Description prints both exact layer numbers.
- **AMS:** each band carries its own `// color`, auto multi-color, no pauses.
- `color_scheme` degrades gracefully: `Plate + Text` skips the halo (one pause / two filaments);
  `Single` = one color, halo suppressed. So users pick 1–3 colors, geometry follows.

**Perf/PMM notes:** `$fn` capped (~28); script letters at large sizes are the heaviest `offset`
case — sweep-tested. Well under the 240×235 arrange limit. **No multi-plate 3MF in v1** (it
disables STL download, which sellers want) — batch/plate-pack revisited as a follow-up.

## Seller features
- **In v1:** curated font picker + custom-font escape hatch; raised/engraved; both color paths;
  `uniform_height` toggle for consistent racks; a few tasteful presets (font+size+outline combos).
- **Out of scope v1 (fast-follow):** batch/plate-pack
  (mind the multi-plate STL tradeoff) · watermark · B-route hub app with live preview.

## MW listing plan
- **Title:** "Name Keychain Generator — 30+ Fonts, Pixel & Script | No AMS Multicolor"
- **Tags:** keychain, name, personalized, customizable, OpenSCAD, nametag, bagtag, pixel, no-ams, gift
- **Covers:** hero render (plate, script font, ring) · a pixel-font one · a font-grid contact sheet ·
  a no-AMS "pause here" diagram · the color/size options shot.
- **Description skeleton:** what it makes → how to customize (fonts, ring, colors) → the no-AMS
  pause-at-layer tip → hub link (vostoklabs) → commercial-license line (from `config/brand.ts`).
- **License:** SDFL (Standard Digital File License). `default.png` = hero render.

## Acceptance criteria
- [ ] Sweep renders clean at: names `"Al"` / `"Name"` / `"Alexandria"`; sizes 8/18/40; outline 0/2.5/8.
- [ ] Ring stays fused for names starting **Y, T, X, W** (the rival-bug regression check).
- [ ] Each font category (bubble/script/pixel/clean) renders legibly; custom-font override works.
- [ ] Raised **and** engraved both clean; zero export/OpenSCAD warnings.
- [ ] 3-color stack: plate/halo/name occupy non-overlapping Z-bands → two clean no-AMS pauses;
      `Plate + Text` and `Single` schemes degrade correctly (halo suppressed, no stray geometry).
- [ ] `uniform_height` gives equal plate height across short/long names.
- [ ] STL still downloadable (i.e. no multi-plate used).

---

## v2 scope update (2026-07-18) — flagship, both-route

After the first working build, Ian added features that split the product across both routes.

### C-route scad — added & verified this pass
- **Multi-language.** `lang` selector + per-script font dropdowns (Chinese/Japanese/Korean/
  Cyrillic/Hebrew/Arabic), Noto + regional families (all in PMM's set). RTL direction for
  Hebrew/Arabic. Pattern adapted from the Diego V3 reference (`docs/reference/name keychain code/`).
- **Vertical or horizontal layout.** Vertical stacks characters under a top ring loop.
- **Font style** dropdown (Regular…Black/Italic) via `font:style=` — fixes the rivals' font-style bug.
- **License acknowledgement** toggle (`/* [License] */`) — visible legal nudge, wording adjustable.
- **Deterministic left-align ring** (from the Vanessa/Diego references): text origin is fixed
  (left edge at `x=gap`, or stacked from `y=0`), so the ring lug always fuses — no width estimate.
  This *replaces* the v1 `len()`-estimate hack.

### B-route hub app — the reason this is a flagship (next build)
- **Live colour preview** as users pick their plate, halo, and text colours.
- **Live font preview** — see the entered name rendered in each bundled font before choosing.
- **Plate-only geometry** — raised or engraved text, with the same ring and layout options as the MakerWorld version.

### Decisions
- **Close-source the `.scad` on MW — CONFIRMED possible** (Ian's upload-UI screenshot). Each file
  has an **"Open Source" checkbox** → leave it **UNCHECKED**: MW keeps the source private but still
  runs it server-side, so the model stays fully customizable (users get the customizer + 3MF, not
  the `.scad`). **Uncheck it for our generators** — protects the parametric IP, a real edge over
  rivals who leave theirs open. (My earlier "not possible" note during the ultra pass was wrong —
  it came from outdated forum threads; the real upload UI is authoritative.) The file also showed
  **"Passed"** = cleared MW's PMM validation. Watermark stays deferred (low value on a trivial
  output, and now the source itself is protected).
- **License = SDFL** (MakerWorld Standard Digital File License): personal-print only, no resale,
  no redistribution, no remix — the tightest base; our paid commercial license lifts it. Header
  updated to match (was CC BY-NC-ND, which is self-contradictory for a customizer — ND forbids the
  derivatives a customizer exists to make).
- Halo accent default stays brand blue `#5b9dff` (Ian confirmed).

### Caveats / open verification
- **Render time / PMM timeout: OK.** PMM's backend is Manifold-enabled (employee-confirmed) —
  ~10–50× faster than local CGAL — so the model's 14–21 s *local* renders are ~1–2 s on PMM, under
  its ~10–15 s timeout. Optimised anyway (`corner_round=0` default, `$fn` 40→22, multi-word
  connector): default 14 s → typical names faster. Still worth a glance at the real generation
  time on the first MW upload.
- **CJK/Hebrew/Arabic glyphs can't be verified on local 2021.01** (fonts not installed; Latin
  proves the logic). `script`/`language` params added for HarfBuzz shaping (Arabic joining) — but
  **Arabic especially is best-effort; confirm on MW at upload.**
- **Multi-word names** ("Mary Jane") now fuse via an automatic connector (was 2 disconnected
  plates). Apostrophes/high marks in odd fonts remain an edge case.
- Batch/plate-pack (Diego does it via multi-plate) still deferred — multi-plate disables STL download.

---

## v3 customizer restructure (2026-07-19) — from real MW customizer feedback

Ian tested the draft in MW's customizer; six UX/geometry fixes (supersede the v1 parameter table above):

- **Sections reordered & renamed** for an intuitive top-down flow:
  `[Please read]` (license ack — now FIRST) → `[Your name]` → `[Font]` → `[Colours]` →
  `[Size & shape]` → `[Keyring]` → `[Advanced]` → `[Hidden]`.
- **`custom_font` removed** — the `// font` picker already exposes every MW font.
- **Language collapsed** from 7 controls (lang + 6 per-script font dropdowns) to **one `script`
  dropdown** (Latin / Arabic / Hebrew). CJK needs no special control — pick a Noto Sans SC/JP/KR
  from the normal font picker. (OpenSCAD customizer can't do conditional UI, so fewer static
  controls is the win.)
- **Ring sizing fixed.** Was inflated by the plate offset into a huge disc. Now the lug outer
  radius is set directly (`lug_outer = hole_dia/2 + ring_thickness`) and pre-shrunk by
  `plate_margin` so the offset restores it. New **`ring_thickness`** control + `hole_dia`. New
  **"Corner hole"** ring style (embedded, no protruding tab). Ring always fuses via a hull bridge
  to a point inside the name (robust even at `outline_width=0`).
- **`smoothing`** (default 2.0) replaces `corner_round` — morphological closing that merges tight
  inter-letter notches (Ian's "small empty spaces"). Re-enabled by default now that PMM's Manifold
  backend makes the cost negligible.
- **License spelling** US ("license") to match the header.

Re-verified after the rewrite: 10/10 sweep cases `Simple: yes`, zero warnings (all layouts,
styles, scripts, `outline_width=0`, uniform, pixel/script fonts, multi-word).

---

## v4 cleanup (2026-07-19)

The connected-letter experiment was removed. The generator is deliberately plate-only: raised or
engraved lettering, the reliable fused ring, horizontal/vertical layouts, multilingual text,
and one- to three-colour print bands.
