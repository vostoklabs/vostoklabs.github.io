/*
  linkButton(): a link that looks like a button, in the stand-in document (support/mini-dom.ts).

  It is an <a> with the same emphasis ladder as button(), so a page rendered ahead of time keeps
  a working link with no script. A new tab is opt-in, and only `external` opts in.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { linkButton } from '../src/components/button';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const plain = linkButton({ label: 'Details', href: '/generators/clicker/' });
check('is a link, not a button', plain.tagName === 'A', plain.tagName);
check('goes to its address', plain.getAttribute('href') === '/generators/clicker/');
check('reads its label', plain.textContent === 'Details', plain.textContent);
check('plain by default', plain.className === 'vl-btn', plain.className);
check('same tab by default', !plain.hasAttribute('target') && !plain.hasAttribute('rel'));

const primary = linkButton({ label: 'Open app', href: '/clicker/', emphasis: 'primary', block: true, className: 'vl-row' });
check('primary rung', primary.classList.contains('vl-btn--primary'), primary.className);
check('block shape', primary.classList.contains('vl-btn--block'), primary.className);
check('placement class kept', primary.classList.contains('vl-row'), primary.className);

const cta = linkButton({ label: 'Get a licence', href: '/licences/', emphasis: 'cta' });
check('cta rung is primary plus cta', cta.classList.contains('vl-btn--primary') && cta.classList.contains('vl-btn--cta'), cta.className);

const out = linkButton({ label: 'MakerWorld', href: 'https://example.com/', external: true });
check('external opens a new tab', out.getAttribute('target') === '_blank');
check('external never hands over the opener', out.getAttribute('rel') === 'noopener noreferrer', out.getAttribute('rel') ?? '');

console.log(`\nlink-button: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
