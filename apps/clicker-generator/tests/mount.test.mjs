#!/usr/bin/env node
/*
  The clicker's real mount(), driven in node: what Export writes, after what the user did.

    node apps/clicker-generator/tests/mount.test.mjs

  The scenarios are in mount.scenarios.ts. mount.ts, the build-on-screen tracker, Model mode's
  controller and the kit's store run as they ship; what node cannot run is swapped for the
  stand-ins in mount.stand-ins.ts (the viewer, the sidebars, the tracer, the 3MF writer, the
  paid and host seams), and the geometry worker is a scripted stand-in that answers in the
  order it was asked, as the real one does. Time is virtual (the kit's tests/support/clock.ts),
  so the debounces cost nothing to wait out. tests/shown-build.test.ts tests the tracker alone.
*/
import { runMounted } from '../../../packages/ui-kit/tests/support/mounted.mjs';

const standIns = new URL('./mount.stand-ins.ts', import.meta.url);
const replaced = [
  './viewer/viewer',
  '@vostok/plates',
  '@vostok/export',
  './ui/ui',
  './modelPanel',
  '@vostok/trace',
  './ui/wizard',
  './ui/svgPreview',
  './export/threemfExport',
  './export/objExport',
  './export/plateLayout',
  './shapes/directory',
  './image/sample',
  './image/letter',
  './image/lucideIcons',
  'virtual:makerlab',
  'virtual:pro-pack',
  'virtual:shape-editor',
];

await runMounted(new URL('./mount.scenarios.ts', import.meta.url), {
  replace: Object.fromEntries(replaced.map((specifier) => [specifier, standIns])),
  define: { __SHAPE_EDITOR__: 'false' },
});
