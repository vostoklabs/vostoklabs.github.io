// Emit the demo cut files — the thing that actually gets sent to a laser.
//
// Run: pnpm --filter laser-slot demo
//
// Writes into apps/laser-slot/demo/. Everything here goes through the same
// `buildCutFiles` the app's Export button calls, so what a reviewer opens is
// byte-for-byte what a user would get.

import Module from 'manifold-3d';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { solve } from '../src/geometry/buildSlot.ts';
import { buildCutFiles } from '../src/export/laserExport.ts';
import { DEFAULT_PARAMS, MATERIALS, type SlotParams } from '../src/types.ts';
import { SAMPLES } from '../src/samples.generated.ts';

const wasm: any = await (Module as any)();
wasm.setup();

// cwd, not import.meta.url: the script is bundled into node_modules/.cache
// before it runs, so a path relative to the module lands inside node_modules.
const out = resolve(process.cwd(), 'demo');
mkdirSync(out, { recursive: true });

// 3 mm basswood on the H2D's 40 W work area: one pass, about three minutes, and
// it does not trip the machine's attended-operation check the way every
// official acrylic preset does.
// Sizes are the top of each sample's usable window on this sheet, found by
// sweeping heights until the solver stops complaining. The palm is the tightest
// of the four: its trunk is slim, so a 3 mm slot needs 12 mm of material there,
// and two profiles plus a base disc have to fit 310 x 250.
// Sizes are the top of each sample's usable window on this sheet, found by
// sweeping heights until the solver stops complaining. The palm is the tightest
// of the four — its trunk is slim, so a 3 mm slot needs 12 mm of material
// there, which forces a tall object, which then has to share 310 x 250 with its
// own base. It only just fits.
const CASES: { shape: string; name: string; params: Partial<SlotParams> }[] = [
  { shape: 'palm', name: 'Palm tree 180mm 3mm ply', params: { heightMm: 180 } },
  { shape: 'cactus', name: 'Cactus 180mm 3mm ply', params: { heightMm: 180 } },
  { shape: 'pine-tree', name: 'Pine tree 180mm 3mm ply', params: { heightMm: 180 } },
  { shape: 'mushroom', name: 'Mushroom 170mm 3mm ply', params: { heightMm: 170 } },
];

let failed = 0;

for (const c of CASES) {
  const shape = SAMPLES.find((s) => s.id === c.shape)!;
  const params: SlotParams = { ...DEFAULT_PARAMS, ...c.params };
  const result = solve(wasm, shape.rings, params);

  const errors = result.diagnostics.filter((d) => d.level === 'error');
  const warnings = result.diagnostics.filter((d) => d.level === 'warning');

  const files = buildCutFiles(result, { title: c.name, params });
  writeFileSync(resolve(out, `${files.baseName}.dxf`), files.dxf);
  writeFileSync(resolve(out, `${files.baseName}.svg`), files.svg);
  writeFileSync(resolve(out, `${files.baseName}.README.txt`), files.readme);

  const material = MATERIALS.find((m) => m.id === params.materialId);
  console.log(
    `${c.name}\n` +
      `  ${result.parts.length} parts · ${(result.cutLengthMm / 1000).toFixed(2)} m cut · ` +
      `slot ${(params.thicknessMm + params.clearanceMm - params.kerfMm).toFixed(2)} mm · ` +
      `${material?.name}\n` +
      `  sheet ${result.layout.sheet.name}${result.layout.overflow ? ' — OVERFLOW' : ''}\n` +
      `  ${errors.length} errors, ${warnings.length} warnings` +
      (errors.length ? `\n  ! ${errors.map((e) => e.message).join('\n  ! ')}` : ''),
  );
  if (errors.length || result.layout.overflow) failed++;
}

console.log(`\nWrote to ${out}`);
process.exit(failed ? 1 : 0);
