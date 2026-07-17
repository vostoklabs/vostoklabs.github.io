# Vostok Labs Tools — monorepo

Free 3D-print generators + seller tools; revenue = commercial licenses. Public brand:
**Vostok Labs**. Full plan + decisions: `../generators galore/general plan draft.md`
(read §0 decision table first), ordered tasks in `../generators galore/ToDo.md`,
ADRs in `docs/decisions.md`.

## Layout

- `packages/ui-kit` — framework-free TS + CSS design system (tokens + business components)
- `config/` — `@vostok/brand`: every URL, price, license string. **Never hardcode these
  anywhere else.**
- `generators.json` — tool registry; hub cards + CI derive from it. New tool = one entry.
- `apps/kit-demo` — renders every ui-kit component (visual reference)
- `apps/<tool>` — one folder per generator/seller tool (hub comes in ToDo §5)
- `scad/` — source of truth for MakerWorld scad listings
- `vendor/pmm-docs` — cloned external PMM reference (gitignored, reference-only — no license
  upstream, do not republish; re-clone command in `.gitignore`)
- `.claude/skills/` — project skills: `openscad-dev`, `pmm-dev`, `manifold-app`, `ui-kit`,
  `new-generator`, `frontend-design` (vendored from Anthropic's plugin)

## Commands

- `pnpm install` (workspace root)
- `pnpm dev:demo` / `pnpm build:demo` — kit-demo app
- `pnpm typecheck` — all packages
- OpenSCAD CLI: `& "C:\Program Files\OpenSCAD\openscad.com"` — the `.com` console wrapper;
  `.exe` is GUI-only and prints nothing (see openscad-dev skill). Version 2021.01 is correct
  (latest stable + matches MakerWorld PMM) — not stale.

## Invariants (do not violate)

1. **Free tier stays fully functional** — no feature locks, no export limits, ever.
2. **Watermark is never removed or made visible** — it's a covert provenance mark
   (see plan §7); every generator's export path includes it.
3. **License nudge on every export path** — ui-kit `licenseNudge`/`openCommercialModal`.
4. **No hardcoded URLs/prices** — import `@vostok/brand`.
5. **Client-side only, zero external network calls** in apps; bundle all assets/fonts
   (OFL only, with credits). Keeps GH Pages + offline + MakerLab-alignment all working.
6. **No GPL in app bundles** (manifold-3d = Apache-2.0 is the CSG kernel). GPL-clean
   libraries only in distributed `.scad` (BOSL2 = BSD ✅; audit others before first use).
7. **`.scad` files ship with a CC BY-NC-ND 4.0 header** — they're public on MW by design.
8. Export logic stays behind one function per app (keeps future MakerLab `sdk.export()`
   swap trivial; formats stl/obj/zip; cover image via ui-kit `captureCover`).
9. MW listings: license = Standard Digital File License; description links the hub.
10. Keep exclusive-enrolled MW designs out of public app presets (plan §2.3).

## Related repos (siblings, do not restructure)

- `../Image to clicker generator` — live app; source for watermark/3MF extraction (ToDo §4)
- `../Keycap generator` + `../Keycap generator - MakerWorld` — **MakerLab submission in
  review; don't touch the MakerWorld one without Ian**
- Existing apps stay standalone (locked decision) — hub links out; UI polish only.

## Workflow notes

- New generator? Invoke the `new-generator` skill — it runs research → spec → build →
  verify → ship with approval gates after research and spec.
- Any `.scad` work → `openscad-dev` skill (mandatory visual render checks).
- Building/editing a B-route app (three.js + manifold-3d configurator) → `manifold-app` skill
  (worker+WASM architecture, viewer, export, watermark; reference impl = the clicker app).
- Anything MakerWorld/PMM → `pmm-dev` skill (authoritative gotchas live in vendor/pmm-docs).
- UI work → `ui-kit` skill (Vostok tokens/components, brand rule, a11y + direction rules) +
  `frontend-design` (general design judgment).
- After shipping anything: feed new gotchas back into the relevant skill (~10 min rule).
