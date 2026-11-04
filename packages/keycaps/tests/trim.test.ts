/*
  "Keycap trim", in node: the limits on the three MX profiles as they ship, the clamp, and the
  cut on a stand-in solid that records what was asked of it.

    pnpm --filter @vostok/keycaps test

  The metas are the shipped 1u caps' own, read from the Keycap generator's assets.
*/
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capTrimLimits, clampCapTrim, cutFromBelow, MIN_SOCKET_MM, type Cuttable } from '../src/index';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The repo root: this package's folder when run through pnpm, else where node was started. */
const root = existsSync(join(process.cwd(), 'apps')) ? process.cwd() : join(process.cwd(), '../..');
const meta = (profile: string) =>
  JSON.parse(readFileSync(join(root, `apps/keycap-generator/public/keycaps/${profile}/1u.json`), 'utf8')).meta;

const standard = capTrimLimits(meta('standard-profile'));
check('Standard: lowered up to its socket less the cross, to a tenth', standard.maxLower === Math.floor((9.995465787 - MIN_SOCKET_MM) * 10) / 10 && standard.maxLower === 5.9, JSON.stringify(standard));
check('Standard: the stem recess is capped at 3 mm, safe to 1.1', standard.maxRecess === 3 && standard.safeRecess === 1.1);
for (const p of ['low-profile', 'thocky-profile']) {
  const l = capTrimLimits(meta(p));
  check(`${p}: already on the cross, so no control`, l.maxLower === 0 && l.maxRecess === 0, JSON.stringify(l));
}
check('no stem: no control', capTrimLimits({ topZ: 10 }).maxLower === 0 && capTrimLimits(null).maxLower === 0);
check('stubs: no lower or recess, but a wall', (() => { const l = capTrimLimits(meta('standard-profile'), { stubs: true }); return l.maxLower === 0 && l.minWall > 0; })());

check('the clamp keeps a setting inside the limits', JSON.stringify(clampCapTrim({ lowerMM: 9, recessMM: -1 }, standard)) === JSON.stringify({ lowerMM: 5.9, recessMM: 0, wallMM: null }));
check('lower and recess share the socket', clampCapTrim({ lowerMM: 4, recessMM: 3 }, standard).recessMM === Math.max(0, 5.9 - 4));
check('nothing asked: nothing changes', JSON.stringify(clampCapTrim({}, standard)) === JSON.stringify({ lowerMM: 0, recessMM: 0, wallMM: null }));

// The cut: trimByPlane at the height, translate down, the cut in between freed, the solid left alone.
const log: string[] = [];
class Solid implements Cuttable<Solid> {
  constructor(readonly name: string) {}
  trimByPlane(n: [number, number, number], z: number) { log.push(`${this.name}.trim(${n.join(',')}@${z})`); return new Solid(`${this.name}>trim`); }
  translate(v: [number, number, number]) { log.push(`${this.name}.translate(${v.join(',')})`); return new Solid(`${this.name}>move`); }
  delete() { log.push(`${this.name}.delete`); }
}
const out = cutFromBelow(new Solid('cap'), 3, 3);
check('cutFromBelow keeps what is above the height, moves it down, frees only the cut between',
  out.name === 'cap>trim>move' && log.join(' ') === 'cap.trim(0,0,1@3) cap>trim.translate(0,0,-3) cap>trim.delete', log.join(' '));

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
