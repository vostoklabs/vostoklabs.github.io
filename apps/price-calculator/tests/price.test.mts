/*
  The price maths, without a browser.

    pnpm --filter price-calculator test
*/
import {
  clampMargin, currencyOf, defaultInputs, formatMoney, MARGIN_MAX, priceOf, type PriceInputs,
} from '../src/price';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const make = (patch: Partial<PriceInputs>): PriceInputs => ({ ...defaultInputs(), ...patch });

/* ---- the first screen ---- */

const empty = priceOf(defaultInputs());
check('nothing typed costs nothing', empty.totalCost === 0 && empty.price === 0 && empty.profit === 0);

/* ---- filament ---- */

const one = priceOf(make({ filaments: [{ grams: 120, pricePerRoll: 25 }] }));
check('120 g at 25 a roll is 3.00 of filament', near(one.filament, 3));
check('at the default 40% margin it sells for 4.20 and keeps 1.20', near(one.price, 4.2) && near(one.profit, 1.2));

const two = priceOf(make({ filaments: [{ grams: 100, pricePerRoll: 20 }, { grams: 50, pricePerRoll: 30 }] }));
check('two filaments add up', near(two.filament, 2 + 1.5));

/* ---- time, wear and power ---- */

const time = priceOf(make({ laborMinutes: 30, hourlyRate: 20 }));
check('30 hands-on minutes at 20 an hour is 10', near(time.labor, 10));

const wear = priceOf(make({ printHours: 2, printMinutes: 30, printerCost: 1000, printerLifespan: 5000 }));
check('2 h 30 min on a 1000 printer that lasts 5000 h is 0.50 of wear', near(wear.machine, 0.5));
check('no printer cost means no wear', priceOf(make({ printHours: 5, printerLifespan: 5000 })).machine === 0);
check('a zero lifespan is not a division by zero', priceOf(make({ printHours: 5, printerCost: 800, printerLifespan: 0 })).machine === 0);

const power = priceOf(make({ printHours: 4, printerWatts: 250, electricityRate: 0.2 }));
check('250 W for 4 h at 0.20 a kWh is 0.20', near(power.electricity, 0.2));

/* ---- fees ---- */

const flat = priceOf(make({ filaments: [{ grams: 40, pricePerRoll: 25 }], fees: [{ name: 'Box', value: 1, type: 'flat' }], margin: 0 }));
check('a fixed cost is added to the cost', near(flat.flatFees, 1) && near(flat.totalCost, 2));

const cut = priceOf(make({ filaments: [{ grams: 360, pricePerRoll: 25 }], fees: [{ name: 'Marketplace', value: 10, type: 'percentage' }], margin: 0 }));
check('a 10% cut is grossed up, not added: 9 of cost needs 10 of sale', near(cut.totalCost, 10) && near(cut.percentFeeCost, 1));
check('and after the cut is taken off the sale, the cost is covered', near(cut.price * 0.9, 9));

const tooMuch = priceOf(make({ filaments: [{ grams: 100, pricePerRoll: 20 }], fees: [{ name: 'A', value: 60, type: 'percentage' }, { name: 'B', value: 40, type: 'percentage' }] }));
check('cuts of 100% or more are flagged and ignored', tooMuch.percentTooHigh && near(tooMuch.totalCost, 2) && tooMuch.percentFeeCost === 0);

/* ---- margin ---- */

check('the margin is clamped to 0…MARGIN_MAX', clampMargin(-5) === 0 && clampMargin(999) === MARGIN_MAX && clampMargin(35) === 35);
check('a NaN margin is 0, not NaN', clampMargin(NaN) === 0);
const high = priceOf(make({ filaments: [{ grams: 1000, pricePerRoll: 10 }], margin: 999 }));
check('priceOf clamps the margin too', near(high.price, 10 * (1 + MARGIN_MAX / 100)));

/* ---- rubbish in ---- */

const nan = priceOf(make({ filaments: [{ grams: NaN, pricePerRoll: 25 }], laborMinutes: NaN, printerWatts: Infinity }));
check('a NaN or infinite input counts as 0, never as a NaN price', Number.isFinite(nan.price) && nan.price === 0);

/* ---- money ---- */

check('USD reads $1,200.00', formatMoney(1200, currencyOf('USD')) === '$1,200.00', formatMoney(1200, currencyOf('USD')));
// Intl writes a no-break space between groups and before the symbol.
const czk = formatMoney(1200, currencyOf('CZK')).replace(/\s/g, ' ');
check('CZK reads 1 200,00 Kč, in its own locale', czk === '1 200,00 Kč', czk);
check('an unknown code falls back to USD', currencyOf('XYZ').code === 'USD');

const a = defaultInputs();
a.filaments[0]!.grams = 99;
check('defaultInputs hands out a fresh copy', defaultInputs().filaments[0]!.grams === 0);

console.log(`\nprice: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
