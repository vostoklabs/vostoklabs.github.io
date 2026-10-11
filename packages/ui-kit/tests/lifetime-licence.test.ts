/*
  lifetimeLicenceButton() in the stand-in document: it sells until the licence is held, then
  opens the certificate; one offer at a time, from the click until the purchase settles; and a
  purchase that is declined, dismissed or throws leaves it ready to be pressed again.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { lifetimeLicenceButton } from '../src/components/lifetime-licence';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const body = miniDocument.body as MiniElement;
const dialogs = () => body.querySelectorAll('.vl-dialog').map((d) => d.getAttribute('aria-label'));
const action = (label: string) =>
  body.querySelectorAll('.vl-dialog__actions button').find((b) => b.textContent === label)!;
const tick = () => new Promise((r) => setTimeout(r, 0));
const closeAll = () => { for (const o of body.querySelectorAll('.vl-overlay')) o.remove(); };

function make(buy: () => Promise<boolean>) {
  const state = { owned: false, purchased: 0, buys: 0 };
  const btn = lifetimeLicenceButton({
    owned: () => state.owned,
    offer: () => ({
      title: 'Lifetime commercial licence',
      price: 'PRICE',
      terms: ['Sell what you make'],
      buyLabel: 'Buy it',
      onBuy: () => { state.buys++; return buy(); },
    }),
    certificate: { title: 'Your commercial licence', lede: 'Keep this.', bodyText: 'TERMS' },
    title: 'Sell what you make, forever',
    onPurchased: () => { state.purchased++; },
  });
  return { btn: btn as unknown as MiniElement & typeof btn, state };
}

/* --------------------------------------------------------------- selling */

{
  // The host's payment flow, held open until the test says it is done.
  let finish = (_ok: boolean) => {};
  const { btn, state } = make(() => new Promise<boolean>((resolve) => {
    finish = (ok) => { state.owned = ok; resolve(ok); };
  }));
  check('unowned: says Unlock lifetime commercial licence', btn.textContent === 'Unlock lifetime commercial licence', btn.textContent);
  check('unowned: the cta rung, full width', btn.classList.contains('vl-btn--cta') && btn.classList.contains('vl-btn--block'));
  check('unowned: carries its tooltip', btn.getAttribute('title') === 'Sell what you make, forever');

  btn.click();
  btn.click();
  check('a click opens the offer, and a second click opens no second one', dialogs().join() === 'Lifetime commercial licence', dialogs().join());

  action('Buy it').click();
  check('buy closes the offer before the purchase settles', dialogs().length === 0);
  btn.click();
  check('no new offer while the purchase is in flight', dialogs().length === 0);
  finish(true);
  await tick();
  check('a completed purchase is reported once', state.purchased === 1 && state.buys === 1);
  check('owned: says Show licence terms', btn.textContent === 'Show licence terms', btn.textContent);
  check('owned: a quiet secondary, no tooltip', btn.classList.contains('vl-btn--secondary')
    && !btn.classList.contains('vl-btn--cta') && !btn.classList.contains('vl-btn--primary')
    && btn.getAttribute('title') === null);

  btn.click();
  check('owned: a click opens the certificate, not the offer', dialogs().join() === 'Your commercial licence', dialogs().join());
  closeAll();
}

/* ----------------------------------------------------- nothing bought */

{
  const { btn, state } = make(async () => false);
  btn.click();
  action('Not now').click();
  btn.click();
  check('Not now: the next click opens the offer again', dialogs().length === 1);
  action('Buy it').click();
  await tick();
  check('a declined purchase reports nothing and changes nothing', state.purchased === 0
    && btn.textContent === 'Unlock lifetime commercial licence');
  btn.click();
  check('declined: the next click opens the offer again', dialogs().length === 1);
  closeAll();
}

{
  const { btn, state } = make(async () => { throw new Error('host gone'); });
  btn.click();
  action('Buy it').click();
  await tick();
  await tick();
  btn.click();
  check('a purchase that throws leaves the button working', dialogs().length === 1 && state.purchased === 0);
  closeAll();
}

/* ----------------------------------------------- held when it is built */

{
  const { btn, state } = make(async () => true);
  state.owned = true;
  btn.refresh();
  check('refresh() reads ownership again', btn.textContent === 'Show licence terms');
  state.owned = false;
  btn.refresh();
  check('and back, when the host says it is not held', btn.textContent === 'Unlock lifetime commercial licence'
    && btn.classList.contains('vl-btn--cta'));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
