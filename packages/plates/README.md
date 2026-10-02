# @vostok/plates

The build plate every generator's 3D preview stands its model on: real Bambu Lab
plate outlines instead of an abstract grid, plus the picker that switches them.

```
source/*.3mf            the plate exports (metres, off-origin, as they came out of the slicer)
scripts/build-plates.mjs converts them -> src/meshes.generated.ts
src/registry.ts         plate list, labels, the shared localStorage preference
src/buildPlate.ts       the three.js floor object (plates + the plain grid)
src/picker.ts           the dropdown that floats over the stage
src/plates.css          its styling
```

## Coordinates

Generated meshes are **millimetres, Z-up, centred on the plate body, top face at
z = 0** — so a model whose bottom face sits at z = 0 rests exactly on the plate,
centred on the bed.

"Centred on the plate body" matters: the outlines include the handle tab that
sticks out of the front of a real plate, so centring on the bounding box would
put the model ~9 mm off the true bed centre. The converter finds the body by
scanlining the top face and keeping the rows that span nearly the full width.

Re-run the converter after adding or replacing a plate in `source/` (map the new
file to an id in `FILE_TO_ID` first):

```bash
pnpm --filter @vostok/plates build-meshes
```

## Using it in a generator

three.js is **passed in**, never imported here — that way the package can't drag
a second copy of three into an app's bundle.

```ts
import { createBuildPlate } from '@vostok/plates/three';
import { mountPlatePicker, loadPlateChoice } from '@vostok/plates';
import '@vostok/plates/plates.css';

// in the viewer, replacing the GridHelper:
const plate = createBuildPlate(THREE, { theme, topZ: -0.06 });
plate.setChoice(loadPlateChoice());
scene.add(plate.object);

// ...expose it, and ghost it when the camera drops below the plate, so looking
// at the underside of the model doesn't mean looking at the back of the plate:
plate.setGhosted(camera.position.z <= floorZ);   // in the render loop
plate.setTheme(theme);                            // when the theme flips
setPlate: (choice) => plate.setChoice(choice),    // on the viewer's interface

// in the app — mounts the picker, restores the shared choice, persists picks:
mountPlatePicker(shell.stage, viewer);
```

A Y-up scene (the keycap generator) passes `up: 'y'`; everything inside the
plate group stays Z-up and the group is tipped a quarter turn.

Apps using it today: magnet, bubble-pop, clicker, name-keychain, keycap, and the
generator template (via `@vostok/viewer`, which builds the plate in for you).

The preference is stored under `vl.buildPlate`, so a plate picked in one
generator is the plate the next one opens with.
