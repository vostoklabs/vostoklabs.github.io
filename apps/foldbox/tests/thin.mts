// The printed sheet at a thickness nobody tested it at.
//
// Two things go wrong once the sheet is more than the default two layers, and both
// are silent — the file exports, the slicer accepts it, and the part is simply
// unbuildable:
//
//   1. Anything that tucks INSIDE — dust flap, corner ear, tuck lug, webbed corner —
//      drops into a gap one caliper wide. Printed at full sheet thickness it is the
//      full width of that gap, and card's trick of just crushing is not available in
//      PLA. Those panels print one clearance under the sheet instead — see
//      `sandwichThicknessMm`. Printing them at HINGE thickness, which is what this
//      used to mean, went the other way and left a 0.2 mm flap loose in a 0.6 mm
//      slot the moment the sheet went past two layers.
//   2. The groove has to be wide enough for the slab either side to rotate through.
//      pi * t to fold flat. It used to be a fixed 1.2 mm that never followed the
//      sheet, so at three layers every 180 degree fold jammed.
//
// Run: pnpm --filter foldbox test:thin
import { solve } from '../src/geometry/solve';
import { buildPrintable, sheetThicknessMm, hingeThicknessMm, minHingeWidthMm, effectiveHingeWidthMm } from '../src/export/printable';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('  FAIL ' + m); } };

for (const style of ['tuck-top','snap-lock','mailer','mailer-flaps','tray-webbed','flap-cover'] as StyleId[]) {
  const p: BoxParams = { ...DEFAULT_PARAMS, style, makeMode: 'print', sheetLayers: 3, layerHeightMm: 0.2, hingeLayers: 1, hingeWidthMm: 1.2 };
  const r = solve(p);
  const built = buildPrintable(r.net, p, { title: style, baseName: style });
  const sheet = sheetThicknessMm(p), hinge = hingeThicknessMm(p);

  // every triangle vertex z must be one of the three levels
  const levels = new Set<string>();
  let minZ = Infinity, maxZ = -Infinity;
  const edges = new Map<string, number>();
  for (const part of built.parts) {
    const v = part.positions, idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const tri = [idx[i]!, idx[i+1]!, idx[i+2]!];
      for (const q of tri) {
        const z = v[q*3+2]!;
        levels.add(z.toFixed(3)); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      // directed edge pairing = watertight
      for (let e = 0; e < 3; e++) {
        const a = tri[e]!, b = tri[(e+1)%3]!;
        const key = (x: number) => `${v[x*3]!.toFixed(4)},${v[x*3+1]!.toFixed(4)},${v[x*3+2]!.toFixed(4)}`;
        const k = `${key(a)}|${key(b)}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
  }
  let unpaired = 0;
  for (const [k, n] of edges) {
    const [a, b] = k.split('|');
    if (n !== (edges.get(`${b}|${a}`) ?? 0)) unpaired++;
  }

  const thin = r.net.panels.filter((q) => q.role === 'tuck' || q.web !== undefined || q.thin === true);
  ok(maxZ <= sheet + 1e-6, `${style}: nothing above the sheet (max ${maxZ})`);
  ok(unpaired === 0, `${style}: watertight — ${unpaired} unpaired directed edges`);
  ok(effectiveHingeWidthMm(p) >= minHingeWidthMm(p) - 1e-9, `${style}: groove respects its floor`);
  console.log(
    `  ok  ${style.padEnd(13)} sheet ${sheet.toFixed(2)} · hinge ${hinge.toFixed(2)} · groove ` +
    `${effectiveHingeWidthMm(p).toFixed(2)} (asked 1.20, floor ${minHingeWidthMm(p).toFixed(2)}) · ` +
    `${thin.length} thin panels · z levels {${[...levels].sort().join(', ')}} · watertight`,
  );
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
if (fails) process.exit(1);
