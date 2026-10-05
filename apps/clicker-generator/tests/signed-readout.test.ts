/*
  The fit steppers' signed readout, read back.

    pnpm test        (bundled and run with the clicker's other suites; on its own, from the root:)

    node_modules/.bin/esbuild apps/clicker-generator/tests/signed-readout.test.ts --bundle \
      --platform=node --format=esm --outfile=apps/clicker-generator/.signed-readout-test.mjs \
      && node apps/clicker-generator/.signed-readout-test.mjs

  "Top / base gap", "Stem fit" and "Socket fit" show an offset from a baseline, and write a
  negative with the typographic minus, U+2212: "−0.15 mm". The kit's value box hands a
  stepper's `parse` the first number it finds and the raw text behind it, and reads only "-" as a
  sign, so from that readout `parse` gets 0.15. `readSigned` takes the sign back from the text;
  without it a readout edited in place came back positive.

  The pairs below are what the box hands over: the number it read, and the text it read it from.
*/
import { fmtSignedMm, readSigned } from '../src/ui/signedReadout.ts';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_FIT_STEP_MM } from '../src/geometry/stemFit.ts';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — got ${detail}` : ''}`);
};
const MINUS = '−';

// What the readout says.
check('a negative offset is written with the typographic minus', fmtSignedMm(-0.15, 2) === `${MINUS}0.15 mm`, JSON.stringify(fmtSignedMm(-0.15, 2)));
check('a positive offset is written with a plus', fmtSignedMm(0.15, 2) === '+0.15 mm', JSON.stringify(fmtSignedMm(0.15, 2)));
check('no offset is written with no sign', fmtSignedMm(0, 2) === '0.00 mm', JSON.stringify(fmtSignedMm(0, 2)));

// What comes back from it.
check(`"${MINUS}0.15 mm" reads back as -0.15`, readSigned(0.15, `${MINUS}0.15 mm`) === -0.15, String(readSigned(0.15, `${MINUS}0.15 mm`)));
check('"-0.15", typed with a hyphen, reads as -0.15', readSigned(-0.15, '-0.15') === -0.15, String(readSigned(-0.15, '-0.15')));
check('"+0.15 mm" reads back as 0.15', readSigned(0.15, '+0.15 mm') === 0.15, String(readSigned(0.15, '+0.15 mm')));
check('"0.00 mm" reads back as 0', readSigned(0, '0.00 mm') === 0, String(readSigned(0, '0.00 mm')));
check('"0", typed, reads as 0', readSigned(0, '0') === 0, String(readSigned(0, '0')));

// Every value the Stem fit stepper can hold survives being shown and read back. The readout
// holds one number, the magnitude, so that is what the box reads from it.
{
  const bad: string[] = [];
  const steps = Math.round((STEM_FIT_MAX_MM - STEM_FIT_MIN_MM) / STEM_FIT_STEP_MM);
  for (let i = 0; i <= steps; i++) {
    const v = Number((STEM_FIT_MIN_MM + i * STEM_FIT_STEP_MM).toFixed(2));
    const shown = fmtSignedMm(v, 2);
    const back = readSigned(Number(Math.abs(v).toFixed(2)), shown);
    if (back !== v) bad.push(`${v} -> "${shown}" -> ${back}`);
  }
  check(`every Stem fit value from ${STEM_FIT_MIN_MM} to ${STEM_FIT_MAX_MM} mm reads back as itself`, bad.length === 0, bad.join('; '));
}

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} signed readout checks pass`);
process.exit(fails.length ? 1 : 0);
