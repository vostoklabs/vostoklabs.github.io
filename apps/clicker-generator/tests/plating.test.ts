/*
  The build plate, which until now the export only pretended to know about.

  Two things were wrong and neither made a sound:

   • The two halves were placed side by side with no idea how wide the bed was. Blocks mode
     already produces N clickers in a row, and at six letters the pair of strips is wider than
     an A1 bed — so the file was written with pieces hanging off the plate and the slicer was
     the first thing to notice.
   • The plate picker did not reach the exporter at all. Every file was laid out and centred
     against the A1 preset, whichever plate the user had chosen in the viewer.

  These are synthetic parts rather than real builds, deliberately: the thing under test is the
  arrangement, and a plain box of a known size makes an off-by-a-plate obvious where a traced
  clicker would not.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/plating.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.plating-test.mjs \
      && node apps/clicker-generator/.plating-test.mjs
*/
import { plateLayout, plateWarnings, place, assemblyMinZ } from '../src/export/plateLayout.ts';
import { plateSize } from '@vostok/plates';
import type { ClickerPart, PartGroup } from '../src/types.ts';

/** A box `w × d × h` centred on the origin in XY, sitting on Z 0..h. */
function boxPart(
  name: string, group: PartGroup, key: string, w: number, d: number, h: number,
): ClickerPart {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, -hd, 0, hw, -hd, 0, hw, hd, 0, -hw, hd, 0,
    -hw, -hd, h, hw, -hd, h, hw, hd, h, -hw, hd, h,
  ];
  const t = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  return {
    kind: group === 'top' ? 'cap' : 'body',
    group,
    objectKey: key,
    colorRgb: [200, 200, 200],
    name,
    numProp: 3,
    vertProperties: new Float32Array(v),
    triVerts: new Uint32Array(t),
  };
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Where every part actually lands, once the placement is applied. */
function laidOut(parts: ClickerPart[], plate: Parameters<typeof plateSize>[0]) {
  const minZ = assemblyMinZ(parts);
  const layout = plateLayout(parts, minZ, { plate });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZOut = Infinity;
  for (const p of parts) {
    const pl = layout.placementFor(p.objectKey!);
    for (let i = 0; i < p.vertProperties.length; i += p.numProp) {
      const [x, y, z] = place(
        p.vertProperties[i], p.vertProperties[i + 1], p.vertProperties[i + 2] - minZ, pl,
      );
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZOut) minZOut = z;
    }
  }
  return { layout, w: maxX - minX, d: maxY - minY, minZ: minZOut };
}

// --- One clicker: the arrangement that already worked must keep working.
const one = [
  boxPart('top-base', 'top', 'top', 40, 40, 6),
  boxPart('base-body', 'base', 'base', 45, 45, 9),
];
const oneA1 = laidOut(one, 'a1');
check(
  'one clicker still lays out on a single plate',
  oneA1.layout.plates === 1 && oneA1.layout.oversized.length === 0,
  `${oneA1.layout.plates} plate, ${oneA1.w.toFixed(0)} × ${oneA1.d.toFixed(0)} mm`,
);
check(
  'both halves are seated on the bed, not floating',
  Math.abs(oneA1.minZ) < 1e-4,
  `lowest Z ${oneA1.minZ.toFixed(4)}`,
);
check(
  'the halves are side by side, not stacked',
  oneA1.w > 80,
  `arrangement is ${oneA1.w.toFixed(0)} mm wide (two 40–45 mm pieces plus a gap)`,
);
check(
  'nothing said about a layout that fits',
  plateWarnings(one, { plate: 'a1' }).length === 0,
  plateWarnings(one, { plate: 'a1' }).join(' | ') || 'silent, as it should be',
);

// --- The blocks case that was silently exported off the bed. Two 200 mm strips side by side
//     is 400 mm; an A1's usable width is 244. It has to wrap, not overhang.
const strips = [
  boxPart('blocks-top', 'top', 'top', 200, 22, 10),
  boxPart('blocks-base', 'base', 'base', 200, 22, 14),
];
const wrapped = laidOut(strips, 'a1');
const [a1w] = plateSize('a1');
check(
  'a six-letter block chain wraps onto a second row instead of running off the bed',
  wrapped.w <= a1w && wrapped.d > 22,
  `${wrapped.w.toFixed(0)} × ${wrapped.d.toFixed(0)} mm on a ${a1w} mm bed`,
);
check(
  'and it still fits one plate once wrapped',
  wrapped.layout.plates === 1 && wrapped.layout.oversized.length === 0,
  `${wrapped.layout.plates} plate`,
);

// --- The plate picker has to reach the layout, which is the half that was pure decoration.
//     Two 100 mm pieces sit side by side on an A1 (244 mm usable) and cannot on an A1 mini
//     (168 mm), so the arrangement itself has to differ. Deliberately NOT the 200 mm strips
//     above: those are wider than the mini on their own, and an over-wide item gets its own
//     row on any plate — so they lay out identically and would have proved nothing.
const pair = [
  boxPart('pair-top', 'top', 'top', 100, 40, 6),
  boxPart('pair-base', 'base', 'base', 100, 40, 9),
];
const pairA1 = laidOut(pair, 'a1');
const pairMini = laidOut(pair, 'a1mini');
check(
  'the chosen plate changes the arrangement (the picker is no longer decoration)',
  pairA1.w > pairMini.w && pairMini.d > pairA1.d,
  `a1 ${pairA1.w.toFixed(0)}×${pairA1.d.toFixed(0)} (side by side) vs `
  + `a1mini ${pairMini.w.toFixed(0)}×${pairMini.d.toFixed(0)} mm (wrapped)`,
);

// The 200 mm strips are the other half of the same point: they fit an A1 and overhang a mini,
// and only the plate the user picked can tell those apart.
check(
  'a chain that fits an A1 is flagged as overhanging an A1 mini',
  plateWarnings(strips, { plate: 'a1' }).length === 0
    && plateWarnings(strips, { plate: 'a1mini' }).some((w) => w.includes('too big')),
  plateWarnings(strips, { plate: 'a1mini' }).join(' | ') || '(silent on the mini)',
);

// --- Something genuinely too big must be reported, not quietly overhung.
const huge = [boxPart('huge', 'base', 'base', 300, 300, 10)];
check(
  'a piece bigger than the bed is reported',
  plateWarnings(huge, { plate: 'a1' }).some((w) => w.includes('too big')),
  plateWarnings(huge, { plate: 'a1' }).join(' | ') || '(silent — the old behaviour)',
);

// --- More than one plate means more than one print, and that is worth a sentence.
const many: ClickerPart[] = [];
for (let i = 0; i < 40; i++) {
  many.push(boxPart(`r${i}-top`, 'top', `r${i}:top`, 45, 45, 6));
  many.push(boxPart(`r${i}-base`, 'base', `r${i}:base`, 50, 50, 9));
}
const manyOut = laidOut(many, 'a1');
check(
  'a 40-item run is packed as 80 separate objects across the plates it needs',
  manyOut.layout.plates > 1,
  `${manyOut.layout.plates} plates for 40 clickers on an A1`,
);
check(
  'and the run says how many prints that is',
  plateWarnings(many, { plate: 'a1' }).some((w) => w.includes('plates')),
  plateWarnings(many, { plate: 'a1' }).join(' | ') || '(silent)',
);

console.log(failures ? `\n${failures} FAILED` : '\nthe plate picker reaches the export, and overflow is reported');
process.exit(failures ? 1 : 0);
