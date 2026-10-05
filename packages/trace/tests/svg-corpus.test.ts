/*
  Every reading of the SVG reader, pinned over every Lucide icon and a set of drawings with fills.

  The reader grows by options, and with a new option left out every caller must get exactly what
  it got before, to the bit. Each hash below covers one reading of a whole set of files (the files,
  and how a reading is hashed, are in `corpus.ts`), recorded from the reader as it stood before it
  last grew. A reading that moves for any one file moves its hash.

  The keycap's one-colour reading, `parseSvgLegend`, is pinned the same way, by hashes recorded
  from the keycap's own reader with its result put in the shape the shared one returns. The two
  agree on every file here.

  If the files themselves change (a newer lucide), the first check says so: every hash then needs
  recording again, from a reader known not to have changed.

    pnpm --filter @vostok/trace test
*/
import { DOMParser } from '@xmldom/xmldom';
import { lucideFiles, FILLED, LEGEND_FILES, READINGS, digestOf, inputDigest } from './corpus';
(globalThis as any).DOMParser = DOMParser;
const { describeSvg, parseSvg, parseSvgLegend } = await import('../src/logo');

// Three warns about every path painted `currentColor`, a colour it does not know. The reader
// gives those paths its own ink, so here the warning is only noise.
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (!String(args[0]).startsWith('THREE.Color: Unknown color')) warn(...args);
};

const PINNED = {
  /** lucide 1.25.0: 1,748 icons, and the drawings in `corpus.ts`. */
  files: '115bdf16df6f7f3d8bb9f9209b1e0f0ac8cbdc56329569af8c2da4252568f8d3',
  /** [every icon, the drawings with fills], per reading in `READINGS`. */
  readings: {
    'as the file says': [
      '4524b52084fd187e02d819c05a78a9dd4f497eaff38ecb23ac5ca445b7a8e17c',
      'd3360b0447cf912b49823b0381d6ba219304ad49df349bd01687416455ca7d67',
    ],
    'strokes filled': [
      '103846c9c0d14c5a4ce73be31e535536230cc5fe903087e241aa3dc111d55ac6',
      'c3eb46f215b6d12d352b3e5b4b16af7aaf671d3be45eddfb3067b6c805b1a814',
    ],
    'as painted': [
      '903abc3f71a7e2559a615fa22926c09c83d349108782b456f2e2c4bae2a9b40b',
      'c111c4120e86db4e454f8a445f903827fd8b351ac9ca2878f040ae7b56a24142',
    ],
    'as painted, strokes filled': [
      '69a6d8dd5b4a16ae18b244e17baf4421d36432ecd77893421e0244a529e013d0',
      '2b294f4379fe532cec918aab49ee7fd55305bb69aeec455005db8306db6a3bdf',
    ],
    'background removed': [
      '4524b52084fd187e02d819c05a78a9dd4f497eaff38ecb23ac5ca445b7a8e17c',
      '68888c2759cd850ad77ef453a389fd9c73a4fc3574b597116d5cc20e6a34dd27',
    ],
    'chosen in the import window': [
      'e4b43e4c6bea49e8c1ddf1610ec3adbdc880ca26f42f76b7a0465b11b0b38e31',
      'cbb3323fcecf0e226e70d5a14bc60d26de3f94a1941de23d0624bd8a07d64b7d',
    ],
    'chosen, background removed, as painted': [
      '4606f60fc3817ce6e16ea95fb0a861215df809722fe7b996deccb2e580a0a26a',
      '115f5787e606523d6ecfe32883fc7dfd2f0fc89191a31f634ed71ab06dee8e47',
    ],
  } as Record<string, [string, string]>,
  /** `describeSvg` over every icon and every drawing in `LEGEND_FILES`. */
  described: '9300151ec4b502fd090e2c4b0a244ca94e80b5bce1e826260efad3e9f4e8b1d8',
  /** [every icon, `LEGEND_FILES`], as the keycap's own reader read them. */
  legend: [
    '1bcdf1a5fce9bfc42c2ef27dbbbe55902221d7e589b1d900585effe837874b29',
    '4d17b759c2191421cf1d3415bb85f79d233f7ccf7877e88d756658f25a1f5c13',
  ],
};

let failures = 0;
const check = (name: string, want: string | undefined, digest: () => string) => {
  const t0 = performance.now();
  const got = digest();
  const ms = Math.round(performance.now() - t0);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${ok ? got.slice(0, 16) : `${got}, pinned ${want ?? 'nothing'}`}  (${ms} ms)`);
  if (!ok) failures++;
};

const started = performance.now();
const icons = lucideFiles();

check(`the files: ${icons.length} icons and ${LEGEND_FILES.length} drawings`, PINNED.files, () => inputDigest([...icons, ...LEGEND_FILES]));

for (const [name, opts] of READINGS) {
  const [iconsPin, filledPin] = PINNED.readings[name] ?? [];
  check(`${name}: every icon`, iconsPin, () => digestOf(icons, (svg) => parseSvg(svg, opts)));
  check(`${name}: the drawings with fills`, filledPin, () => digestOf(FILLED, (svg) => parseSvg(svg, opts)));
}

check('described: every icon and every drawing', PINNED.described, () => digestOf([...icons, ...LEGEND_FILES], (svg) => describeSvg(svg)));

check('legend: every icon, as the keycap read it', PINNED.legend[0], () => digestOf(icons, (svg) => parseSvgLegend(svg)));
check('legend: the drawings, as the keycap read them', PINNED.legend[1], () => digestOf(LEGEND_FILES, (svg) => parseSvgLegend(svg)));

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(failures
  ? `\n${failures} FAILED (${seconds} s)`
  : `\nevery reading is what it was, on every file (${seconds} s)`);
process.exit(failures ? 1 : 0);
