# Decision log (ADR-lite)

One entry per settled decision. Future sessions: read this instead of relitigating.
Full reasoning + sources: `../../generators galore/general plan draft.md`.

## 2026-07-17 — Locked with Ian

1. **Brand = Vostok Labs** everywhere; "Generators Galore" is an internal codename.
2. **Pricing**: commercial subscription $15/mo · $40/quarter · $150/year (catalog, while
   active); lifetime one-time $150 / 1 design · $400 / 3 · $1,500 / 12. "Design" is flexible
   (a generator or a specific model), set per sale; delivered manually via email/DM.
3. **Per-generator route = B+C mix**: default C (MW-only scad listing); promote to B
   (enhanced own-site manifold app with MORE features than the MW version) for flagships or
   when analytics show license clicks. No parity mirrors — divergence is intentional.
   Openscad-wasm runner **parked** (plan appendix has the research).
4. **Existing apps stay standalone**: clicker + keycap keep their repos/URLs; hub links out;
   UI polish only. Keycap's MakerLab submission must not be destabilized.
5. **Offline = PWA + single-file HTML** (vite-plugin-singlefile, everything inlined).
   Electron/Tauri/installers **parked** (signing costs, scare-screens).
6. **Hosting = GitHub Pages** (verified OK incl. donation links); Cloudflare Pages is the
   fallback; **never Vercel free** (prohibits commercial use incl. donation links).
7. **ui-kit = framework-free TypeScript + CSS custom properties** (both existing apps are
   vanilla+Vite; no framework, no rewrite). Internal packages ship TS source directly.
8. **Design tokens formalize the existing vibe** (clicker/keycap values): dark default
   `#15171c`/`#1d2027`/accent `#5b9dff`, light theme optional; token names kept
   (`--bg/--panel/--panel-2/--line/--text/--muted/--accent/--accent-text`).
9. **Heading font: Chakra Petch (OFL) — PROPOSED, Ian to veto/confirm.** Body stays system
   stack. Font file not yet bundled (no CDN allowed — invariant 5); until bundled, tokens
   fall back to system. TODO in ToDo §2.
10. **MakerLab SDK**: no adapter layer; keep new apps aligned via cheap habits
    (CLAUDE.md invariants 5/6/8) in case of later submission.
11. **`.scad` source is public by design** (MW makes it downloadable — confirmed by test);
    protection = CC BY-NC-ND header + watermark + license terms, not secrecy.
12. **vendor/pmm-docs is reference-only** (upstream has no license): gitignored, never
    republished; re-clone command in `.gitignore`.
13. **Skills capped at five own** (`openscad-dev`, `pmm-dev`, `ui-kit`, `manifold-app`,
    `new-generator`) + vendored `frontend-design`. `ui-kit`/`manifold-app` skills wait until
    their subjects stabilize. Every ship feeds gotchas back into skills.
14. **MW exclusivity**: only curated output models get enrolled (never a mirrored scad
    listing); exclusive designs stay out of public app presets. MW gave informal OK for
    generators hosted off-platform.
