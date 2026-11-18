/*
  What the stage's message button says about the status line: busy, news, a warning or an error.

    pnpm test        (bundled and run with the clicker's other suites; on its own, from the root:)

    node apps/clicker-generator/tests/suites.mjs status-tone

  The message sits behind the button, so the button's colour is the only thing on the stage that
  tells a problem from news. A build's notes are a warning only while the line still says exactly
  what the build flagged: a save or a load after them must not inherit the warning's colour.
*/
import { statusTone } from '../src/ui/statusTone.ts';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const NOTES = 'Base widened so the switch fits. · Words too thin to print.';
const at = (status: string, statusWarnText = '', building = false) => statusTone({ status, statusWarnText, building });

check('a build running is busy, whatever the line says', at('Building clicker…', '', true) === 'busy' && at(NOTES, NOTES, true) === 'busy');
check("the build's notes are a warning", at(NOTES, NOTES) === 'warn');
check('a later message does not inherit the warning', at('Project saved ✓', NOTES) === 'idle');
check('news is news', at('Sample: Star. Drop your own image to replace it.') === 'idle');
check('nothing to say is news, not a warning', at('', '') === 'idle');
for (const failed of [
  'Error: the worker stopped',
  'Export failed: no file',
  'Could not save: denied',
  "Couldn't read that image. Try a PNG or JPG.",
  'Failed to load switch assets: 404',
  'That font could not be loaded. Pick another one.',
]) {
  check(`a failure is an error: "${failed.slice(0, 24)}…"`, at(failed) === 'error');
}
check('an error flagged as a note is still an error', at('Error: x', 'Error: x') === 'error');

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} status tone checks pass`);
process.exit(fails.length ? 1 : 0);
