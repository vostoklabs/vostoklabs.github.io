# Bubble Pop Fidget Generator

Pick a shape (or upload an image), choose how many pop buttons, get a printable
snap-fit bubble-pop fidget.

**Status: scaffold.** `src/main.ts` is still the `generator-template` frame with
this app's name on it. The build plan is `docs/briefs/bubble-pop-spec.md`.

```bash
pnpm --filter bubble-pop-generator dev
```

## The pop module

`public/assets/pop-socket/pop-socket-module.3mf` is Ian's Plasticity design
(`3d printing/my desings/Pop fidget/`), the mechanism this generator places.
It is a **fixed-size** snap fit — measured, not guessed:

| Part | Dimensions (mm) |
| --- | --- |
| Housing sleeve | OD ⌀19.55 · bore ⌀11.46 · 13.00 tall · 0.5 chamfer both bore ends |
| Spring windows | 2 opposed, through the wall, z 4.94–7.53, 10.54 wide (chord) |
| Spring tab | tapered cantilever per window, z 5.59–6.91, tip 4.594 from axis (1.14 into the bore) |
| Button | 16.43 tall · skirt & cap ⌀11.08 · neck ⌀8.72 · snap bead ⌀10.22 max at z 8.23 |

Derived: sliding fit 0.38 diametral (0.19 radial); the bead interferes with the
tab tip by **0.52 mm radial** — that deflection is the pop. Bottom face (z = 0)
is the only fully flat side: button skirt and housing rim are coplanar there.
This is the image face.

Consequences the generator has to respect: **13 mm of depth per socket**, a
**⌀19.55 keep-out** per button, and a minimum centre pitch of 19.55 + wall.
