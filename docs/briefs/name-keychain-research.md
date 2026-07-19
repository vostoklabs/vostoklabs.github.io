---
id: name-keychain
stage: research
created: 2026-07-18
status: awaiting-approval
---

# Name Keychain — Research brief

Factory shakedown #1. Route recommendation: **C (MW scad listing)** — see bottom.
Watermark deferred this build (Ian's call). Intake: two styles (plate + connected 3D
letters), many fonts incl. **pixel (must)** + script "Barbie" fonts, repositionable ring,
ring-type options, targets sellers *and* buyers.

## The landscape — this is a crowded, proven lane

Name keychains are one of the highest-volume personalized-print categories, and on MakerWorld
the winners are **free OpenSCAD customizers** — exactly our C-route. Traction is huge.

| Tool | Type | Traction (approx, MW labels are ambiguous) | Style | Notable |
|---|---|---|---|---|
| **Name Keychain Generator [NO AMS]** — Pumpkin Studios | MW / OpenSCAD | ~**143k** customizations · ~40k downloads · rel. 2025-12 | Plate w/ "bubble outline" | **Sells $4.99/mo membership = commercial rights to ALL their generators.** No-AMS layer-swap baked in. |
| **Parametric Customizable Name Keychain Creator** — Ballache | MW / OpenSCAD | ~**92k** customizations · ~25k downloads · 4.9★ · rel. 2025-04 | Plate | 2 lines, movable hole, raised/engraved, AMS mode, **batch names (comma)**, Bambu ~8000-font override, multilingual |
| **PrintPal Name Plate Generator** | Web (browser) | n/a | Plate (base + recessed inset + raised text) | 9–20 fonts (Lobster/Pacifico…), TTF/OTF upload, hole presets, STL+**SCAD** export. Tool is "free"; their AI platform is $10/mo Pro, commercial rights all tiers |

**Dead-end check: NOT a dead end.** Free tools exist, but the licensing angle is *validated*
(a competitor literally sells the exact model) and none of them cover our full style/font
breadth. This is a funnel + breadth play, not a "this one keychain sells licenses" play.

## What's paywalled elsewhere that we'd give free (license-sale ammo)
- Pumpkin gates **commercial rights** behind $4.99/mo. Our free download already carries a
  seller-usable license story (breadth = the moat), so "free to use, one license covers the
  whole catalog" is the counter.
- PrintPal gates advanced params / formats behind Pro. We give SCAD + STL free.

## Feature matrix

**Table stakes (everyone has — we must match):**
- Editable text (1–2 lines), font + size + thickness, movable/repositionable keyring hole,
  raised **or** engraved, plate style, no-AMS 2-color via layer-pause, mm/inch.

**Their differentiators (selectively match):**
- Batch / multi-name (Ballache: comma-separated) · Bambu 8000-font override · multilingual.

**Our enrichment ideas (2–5; seller-oriented = double weight):**
1. **★ Batch / plate-pack mode** — auto-arrange N names on one plate. Ballache users are
   *literally begging* ("I need multiples like 200") and he only does comma-separated, not
   packed. Direct seller throughput win.
2. **★ Connected-3D-letters style** (your pic 2) — freestanding joined letters, leveled base,
   optional randomized letter-top heights. **Neither top competitor offers this** — a distinct
   second SKU from the same tool.
3. **Curated, bundled, license-clean font set incl. pixel + script** — competitors lean on
   Bambu's fragile font-name override (their #1 bug: names starting Y/T/X/W break the hole) or
   ~9 Google fonts. A vetted OFL set that renders identically everywhere both differentiates
   *and* fixes their top complaint.
4. **Both color paths baked in + surfaced** — the #1 support question on both rivals is "how do
   I get 2 colors." Ship AMS *and* no-AMS with the layer-pause height shown in the description.
5. **Uniform-size / size-run toggle** — sellers want a consistent look across a rack ("same
   height regardless of name length"). Cheap to add, seller-flavored.

## Route call
**C — MW OpenSCAD listing.** It's the exact proven lane, lowest geometry risk, ideal shakedown.
Plate style is the safe v1 core; the connected-3D-letters style is the standout differentiator
but carries the real geometry risk (reliably joining adjacent glyphs + leveled base). B-route
(enhanced hub app: live preview, bigger font gallery) is a strong *later* follow, not the
shakedown.

## Open questions for Ian (≤3)
1. **Pricing signal:** a direct competitor sells "all my generators" at **$4.99/mo** vs our
   $15/mo. Flagging only — lean on catalog breadth + quality + lifetime options, or revisit
   pricing separately? (Not a blocker for this build.)
2. **Scope of v1 styles:** ship **plate-style first**, add connected-3D-letters as a fast
   follow — or is *both styles* a v1 must? (Both = more geometry risk on the shakedown.)
3. **Fonts v1:** OK to curate **~6–10 bundled OFL fonts (incl. pixel + 1–2 script)** for v1
   rather than "a lot" on day one, then grow the set? License-clean bundling is the constraint.
