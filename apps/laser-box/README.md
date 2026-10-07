# Laser Box

Pick a box, set its size and material, add a pattern, download a cut file that fits together.

```bash
pnpm --filter laser-box dev --port 5179     # the dev server (.claude/launch.json: laser-box)
pnpm --filter laser-box typecheck
node apps/laser-box/tests/run.mjs           # every build checked in 3D (SWEEP=200 for the long sweep)
ALLOW_CHROME=1 node apps/laser-box/tests/drive.mjs   # the real UI, one headless Chrome
ALLOW_CHROME=1 node apps/laser-box/tests/shot.mjs --shot=out.png [--eval="<js>"]
```

In dev, `window.__laserBox` holds the 3D view and the settings, for headless captures: no
control part-opens a lid or hides the dimensions.

## Where things are

| | |
|---|---|
| `src/engine/slabs.ts` | slabs → who keeps what → traced outlines. The joint model; read its header first |
| `src/engine/boxes.ts` | the four styles, the body, dividers, flex tabs (slits + rounded tips), hinge/drawer features |
| `src/engine/fingers.ts` | how many fingers an edge gets |
| `src/engine/decor.ts` | which faces a pattern goes on, the room on each, the shape windows |
| `src/engine/build.ts` | the worker's build: features → patterns → kerf → sheets |
| `src/engine/layout.ts` | MaxRects sheet packing |
| `src/engine/frames.ts` | poses and the lid / drawer motions |
| `src/ui/panel.ts` | the settings: the box (tiles + size) on the right, the rail (Material · Joints · Inside · Pattern) on the left |
| `src/ui/icons.ts` | the joint and bottom diagrams, the pattern shapes' silhouettes |
| `src/assets/styles/` | the box tiles' pictures — renders, remade by `ALLOW_CHROME=1 node tests/pictures.mjs` |
| `src/ui/view3d.ts` | the 3D view (three.js, on demand, face picking, dimensions) |
| `src/ui/flat.ts` | 2D Design and Export Preview |
| `src/export/svg.ts` | the one export: an SVG per sheet, a zip when there are several |
| `src/state.ts` | settings, materials + kerf, fit stops, sheets, load/share coercion |

## Rules this app keeps

- A new box style is a function in `boxes.ts` that places slabs and joints; never a hand-drawn
  outline for a jointed piece. Run `tests/run.mjs` — the 3D check is the definition of done.
- Moving parts get their own clearances, derived in the style's header; the Fit setting is only
  for friction joints.
- Kerf is applied once, in `build.ts`. Nothing upstream of it is kerf-compensated.
