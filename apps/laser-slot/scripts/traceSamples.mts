// Trace the sample art in samples/*.png into baked outlines.
//
// Run: pnpm --filter laser-slot samples
// Writes: src/samples.generated.ts
//
// WHY BAKE RATHER THAN TRACE AT RUNTIME
// The source art is four 2304x1848 PNGs, about 19 MB. Shipping that to a
// browser to recompute the same four outlines on every visit would be the
// single largest thing in the bundle, for a result that never changes. Baking
// costs a few kB of coordinates and makes the sample buttons instant.
//
// The tracer here is the SAME `processImage` the drop zone calls, so a sample
// and an uploaded image go through identical code — if tracing breaks, it
// breaks in both places, and this script's output is where you would see it.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { decodePng, downscale } from './png.mts';
import { processImage } from '../src/image/pipeline.ts';
import type { Ring } from '../src/types.ts';

/** What the app's own decoder resamples to before tracing. Matching it keeps a
 *  baked sample identical to the same file dropped on the drop zone. */
const WORKING_SIZE = 1100;

/** Millimetre-free simplification: the outline is normalised (longest side = 1)
 *  at this point, so this is a fraction of the object, not a length. The solver
 *  simplifies again in mm once it knows the real size. */
const NORMALISED_EPSILON = 0.0015;

const root = process.cwd();
const srcDir = resolve(root, 'samples');
const outFile = resolve(root, 'src/samples.generated.ts');

/** Nicely-cased display name from a filename: "pine-tree" -> "Pine tree". */
function titleOf(file: string): string {
  const stem = basename(file, extname(file)).replace(/[-_]+/g, ' ').trim();
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** Ramer-Douglas-Peucker on a closed ring. The tracer's own output is dense
 *  enough that the generated file would otherwise be a megabyte of noise no
 *  laser could resolve. */
function simplify(ring: Ring, epsilon: number): Ring {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    const [ax, ay] = ring[s];
    const [bx, by] = ring[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

const round = (v: number): number => Number(v.toFixed(4));

// The palm is the reference product this generator was built to reproduce, so
// it leads the grid and is what the app boots with. Everything else falls back
// to alphabetical.
const LEAD = ['palm'];
const rank = (f: string): number => {
  const i = LEAD.indexOf(basename(f, extname(f)).toLowerCase());
  return i === -1 ? LEAD.length : i;
};

const files = readdirSync(srcDir)
  .filter((f) => /\.png$/i.test(f))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

if (!files.length) throw new Error(`No PNGs in ${srcDir}`);

interface Baked {
  id: string;
  name: string;
  rings: Ring[];
}

const baked: Baked[] = [];

for (const file of files) {
  const buf = readFileSync(resolve(srcDir, file));
  const full = decodePng(buf);
  const img = downscale(full, WORKING_SIZE);
  const traced = processImage(img, 2, { removeBg: true, smoothing: 0.5 });

  if (!traced.outline.length) {
    console.log(`  SKIP ${file} — traced to nothing`);
    continue;
  }

  const before = traced.outline.reduce((n, r) => n + r.length, 0);
  const rings = traced.outline
    .map((r) => simplify(r, NORMALISED_EPSILON).map(([x, y]) => [round(x), round(y)] as [number, number]))
    .filter((r) => r.length >= 3);
  const after = rings.reduce((n, r) => n + r.length, 0);

  baked.push({ id: basename(file, extname(file)).toLowerCase(), name: titleOf(file), rings });
  console.log(
    `  ${file}: ${full.width}x${full.height} -> ${img.width}x${img.height}, ` +
      `${rings.length} ring(s), ${before} -> ${after} points`,
  );
}

const body = baked
  .map(
    (s) =>
      `  {\n    id: '${s.id}',\n    name: '${s.name}',\n    rings: [\n` +
      s.rings
        .map((r) => `      [${r.map(([x, y]) => `[${x},${y}]`).join(',')}],`)
        .join('\n') +
      `\n    ],\n  },`,
  )
  .join('\n');

writeFileSync(
  outFile,
  `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/traceSamples.mts from samples/*.png, using the same
// \`processImage\` pipeline the drop zone runs on an uploaded image. Re-run with:
//
//     pnpm --filter laser-slot samples
//
// Coordinates are normalised the way the tracer emits them: longest side = 1,
// centred on the origin, Y-up. The solver rescales to the requested height.

import type { Ring } from './types';

export interface Sample {
  id: string;
  name: string;
  rings: Ring[];
}

export const SAMPLES: Sample[] = [
${body}
];
`,
  'utf8',
);

console.log(`\nWrote ${outFile} (${baked.length} samples)`);
