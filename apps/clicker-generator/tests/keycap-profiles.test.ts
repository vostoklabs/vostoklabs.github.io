/*
  Letter blocks' keycaps (src/geometry/blockKeycaps.ts): the Keycap generator's three MX 1u caps,
  copied into the clicker's public/assets.

  What has to hold, and why:
   - each copy is its source file, byte for byte: a cap re-cut in the Keycap generator has to be
     copied again, or the two apps would print different caps under one name;
   - the numbers the rail and a loaded project use without the file (its top, its socket) are the
     file's own, so the rim's limit on screen is the one the build stops at;
   - each cap is drawn on its own axis, stem and all, with the bottom of its stem on z = 0, which
     is the frame the build seats it in.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs keycap-profiles
*/
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK_KEYCAP_IDS, BLOCK_KEYCAPS } from '../src/geometry/blockKeycaps.ts';
import type { BlockKeycap } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Where each cap comes from in the Keycap generator. */
const SOURCE: Record<BlockKeycap, string> = {
  standard: 'apps/keycap-generator/public/keycaps/standard-profile/1u.json',
  low: 'apps/keycap-generator/public/keycaps/low-profile/1u.json',
  thocky: 'apps/keycap-generator/public/keycaps/thocky-profile/1u.json',
};
/** Each cap's footprint, measured: the well it sits in is sized from it. */
const FOOTPRINT: Record<BlockKeycap, number> = { standard: 18.136, low: 18.136, thocky: 18.2 };

const bytes = (path: string) => readFileSync(join(process.cwd(), path));
const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

check('three profiles, in the order the rail offers them', BLOCK_KEYCAP_IDS.join() === 'standard,low,thocky', BLOCK_KEYCAP_IDS.join());

for (const id of BLOCK_KEYCAP_IDS) {
  const p = BLOCK_KEYCAPS[id];
  const copy = bytes(join('apps/clicker-generator/public', p.file));
  const source = bytes(SOURCE[id]);
  check(`${id}: ${p.file} is the Keycap generator's file, byte for byte`, sha(copy) === sha(source),
    `${sha(copy).slice(0, 16)}… vs ${sha(source).slice(0, 16)}…`);

  const { meta, stem } = JSON.parse(copy.toString('utf-8'));
  const sb = meta.stemBbox;
  check(`${id}: its top and its socket are the numbers the rail uses`,
    meta.hasStem === true && !!stem && Math.abs(meta.topZ - p.topZ) < 1e-3 && Math.abs(sb.max[2] - sb.min[2] - p.socketMm) < 1e-3,
    `top ${meta.topZ.toFixed(4)} (${p.topZ}), socket ${(sb.max[2] - sb.min[2]).toFixed(4)} (${p.socketMm}) mm`);

  const w = meta.bbox.max[0] - meta.bbox.min[0];
  const d = meta.bbox.max[1] - meta.bbox.min[1];
  const mid = [(meta.bbox.min[0] + meta.bbox.max[0]) / 2, (meta.bbox.min[1] + meta.bbox.max[1]) / 2];
  const stemMid = [(sb.min[0] + sb.max[0]) / 2, (sb.min[1] + sb.max[1]) / 2];
  check(`${id}: ${FOOTPRINT[id]} mm square, its stem on its axis, both standing on z = 0`,
    Math.abs(w - FOOTPRINT[id]) < 0.01 && Math.abs(d - FOOTPRINT[id]) < 0.01
      && Math.hypot(meta.center[0] - mid[0], meta.center[1] - mid[1]) < 1e-6
      && Math.hypot(stemMid[0] - meta.center[0], stemMid[1] - meta.center[1]) < 0.01
      && Math.abs(meta.bbox.min[2]) < 1e-3 && Math.abs(sb.min[2]) < 1e-3,
    `${w.toFixed(3)} × ${d.toFixed(3)} mm, stem ${Math.hypot(stemMid[0] - meta.center[0], stemMid[1] - meta.center[1]).toFixed(4)} mm off the axis`);
}

console.log(failures ? `\n${failures} FAILED` : '\nthe keycaps are the Keycap generator\'s');
process.exit(failures ? 1 : 0);
