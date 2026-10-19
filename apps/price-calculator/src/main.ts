import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  section,
  collapsibleSection,
  textField,
  numberField,
  selectField,
  sliderRow,
  chip,
  button,
  buttonRow,
  iconButton,
  diagnosticsList,
  toast,
  ICONS,
  el,
  type NumberFieldHandle,
} from '@vostok/ui-kit';
import {
  CURRENCIES, MARGIN_MAX, MARGIN_STOPS, clampMargin, currencyOf, defaultInputs, formatMoney, priceOf,
  type Fee, type Filament, type PriceInputs,
} from './price';

/*
  Print Price Calculator: what a print costs you in filament, time and wear, and what to sell it
  for. Two columns: the inputs in the middle, the answer on the right.

  The first screen asks for one thing, the filament. Time, printer wear and fees are folded away
  until asked for, and a folded one still shows what it adds, so nothing is hidden, only folded.
  Every number updates as it is typed; the price is on screen the whole time.
*/

let inputs: PriceInputs = defaultInputs();
let name = '';
let currencyCode = 'USD';
const symbol = () => currencyOf(currencyCode).symbol;
const money = (v: number) => formatMoney(v, currencyOf(currencyCode));

// ---------------------------------------------------------------------------
// The inputs (middle)
// ---------------------------------------------------------------------------

/** A field whose unit names the currency ("$", "£/h"), so a switch relabels it in place. */
interface Priced { field: NumberFieldHandle; unit: (symbol: string) => string }
const fixedPriced: Priced[] = [];
let filamentPriced: Priced[] = [];
let feePriced: Priced[] = [];
const inCurrency = (list: Priced[], field: NumberFieldHandle, unit: (symbol: string) => string) => {
  list.push({ field, unit });
  field.setUnit(unit(symbol()));
  return field;
};
const relabel = () => {
  for (const p of [...fixedPriced, ...filamentPriced, ...feePriced]) p.field.setUnit(p.unit(symbol()));
};

/** A number box that may be left empty, which is 0, and reports as it is typed. */
const amount = (
  label: string,
  value: number,
  opts: { unit?: string; placeholder?: string; help?: string; max?: number; step?: number },
  set: (v: number) => void,
) =>
  numberField({
    label, value, min: 0, max: opts.max, step: opts.step, unit: opts.unit, help: opts.help,
    placeholder: opts.placeholder ?? '0', emptyValue: 0, live: true, alignUnit: true,
    onInput: (v) => { set(v); update(); },
  });
const pair = (...cells: HTMLElement[]) => el('div', { className: 'pc-row' }, cells);

const nameField = textField({
  label: 'Name', value: name, placeholder: 'e.g. Dragon Head',
  onInput: (v) => { name = v; update(); },
});
const currencyField = selectField({
  label: 'Currency',
  options: CURRENCIES.map((c) => ({ value: c.code, label: c.label })),
  value: currencyCode,
  onChange: (code) => { currencyCode = code; relabel(); update(); },
});

/* Filaments: one row each. The list is drawn again when a row is added or removed, never while
   a number is typed, so a field never loses the cursor. */
const filamentList = el('div', { className: 'pc-list' });
function drawFilaments() {
  filamentPriced = [];
  const many = inputs.filaments.length > 1;
  filamentList.replaceChildren(...inputs.filaments.map((f: Filament, i) => {
    const remove = iconButton({
      icon: ICONS.trash, label: 'Remove this filament',
      onClick: () => { inputs.filaments.splice(i, 1); drawFilaments(); update(); },
    });
    // Hidden with one row, and its column kept, so adding a second row moves nothing.
    remove.hidden = !many;
    return el('div', { className: 'pc-row pc-row--filament' }, [
      amount(many ? `Filament ${i + 1}` : 'Filament used', f.grams, { unit: 'g' }, (v) => { f.grams = v; }),
      inCurrency(filamentPriced, amount('Price per roll', f.pricePerRoll, { help: 'What a 1 kg roll costs you.' }, (v) => { f.pricePerRoll = v; }), (s) => s),
      remove,
    ]);
  }));
}
const addFilament = button({
  label: 'Add another filament', icon: ICONS.plus,
  onClick: () => { inputs.filaments.push({ grams: 0, pricePerRoll: 25 }); drawFilaments(); update(); },
});

const thePrint = section({
  title: 'The print',
  body: [
    el('p', { className: 'vl-hint', text: 'Filament is the only thing you have to fill in. Everything below it is optional and folded away until you want it.' }),
    el('div', { className: 'pc-row pc-row--name' }, [nameField, currencyField]),
    filamentList,
    buttonRow(addFilament),
  ],
});

/* Your time */
const laborMinutes = amount('Hands-on time', inputs.laborMinutes, { unit: 'min', help: 'Supports, sanding, packing. Print time is charged under Printer wear & power.' }, (v) => { inputs.laborMinutes = v; });
const hourlyRate = inCurrency(fixedPriced, amount('Your rate', inputs.hourlyRate, {}, (v) => { inputs.hourlyRate = v; }), (s) => `${s}/h`);
const time = collapsibleSection({ title: 'Your time', open: false, body: [pair(laborMinutes, hourlyRate)] });

/* Printer wear & power */
const printHours = amount('Print time', inputs.printHours, { unit: 'h' }, (v) => { inputs.printHours = v; });
const printMinutes = amount('and', inputs.printMinutes, { unit: 'min', max: 59 }, (v) => { inputs.printMinutes = v; });
const printerCost = inCurrency(fixedPriced, amount('Printer cost', inputs.printerCost, {}, (v) => { inputs.printerCost = v; }), (s) => s);
const printerLifespan = amount('Expected life', inputs.printerLifespan, { unit: 'h', help: 'How many hours of printing you expect from the printer.' }, (v) => { inputs.printerLifespan = v; });
const printerWatts = amount('Power draw', inputs.printerWatts, { unit: 'W', placeholder: '250' }, (v) => { inputs.printerWatts = v; });
const electricityRate = inCurrency(fixedPriced, amount('Electricity', inputs.electricityRate, { step: 0.01 }, (v) => { inputs.electricityRate = v; }), (s) => `${s}/kWh`);
const machine = collapsibleSection({
  title: 'Printer wear & power', open: false,
  body: [pair(printHours, printMinutes), pair(printerCost, printerLifespan), pair(printerWatts, electricityRate)],
});

/* Hardware, packaging & fees */
const feeList = el('div', { className: 'pc-list' });
const feeProblems = diagnosticsList();
function drawFees() {
  feePriced = [];
  feeList.replaceChildren(...inputs.fees.map((f: Fee, i) => {
    const unit = (s: string) => (f.type === 'flat' ? s : '%');
    const value = inCurrency(feePriced, numberField({
      label: 'Amount', value: f.value, min: 0, placeholder: '0', emptyValue: 0, live: true, alignUnit: true,
      onInput: (v) => { f.value = v; update(); },
    }), unit);
    return el('div', { className: 'pc-row pc-row--fee' }, [
      textField({ label: 'What it is', value: f.name, placeholder: 'e.g. M3 screws', onInput: (v) => { f.name = v; } }),
      value,
      selectField<Fee['type']>({
        label: 'Kind',
        options: [{ value: 'flat', label: 'Fixed cost' }, { value: 'percentage', label: 'Cut of the sale' }],
        value: f.type,
        help: 'A cut of the sale, like a 10% marketplace fee, comes off the sale price.',
        onChange: (type) => { f.type = type; value.setUnit(unit(symbol())); update(); },
      }),
      iconButton({ icon: ICONS.trash, label: 'Remove', onClick: () => { inputs.fees.splice(i, 1); drawFees(); update(); } }),
    ]);
  }));
}
const addFee = button({
  label: 'Add a cost or fee', icon: ICONS.plus,
  onClick: () => { inputs.fees.push({ name: '', value: 0, type: 'flat' }); drawFees(); update(); },
});
const fees = collapsibleSection({
  title: 'Hardware, packaging & fees', open: false,
  body: [feeList, feeProblems.root, buttonRow(addFee)],
});

const form = el('div', { className: 'pc-form' }, [
  generatorHeader({ title: 'Print Price Calculator', hideCredit: true }),
  thePrint,
  el('div', { className: 'pc-optional' }, [time, machine, fees]),
]);

// ---------------------------------------------------------------------------
// The answer (right)
// ---------------------------------------------------------------------------

const priceText = el('p', { className: 'pc-hero__price' });
const priceLine = el('p', { className: 'vl-hint' });
const hero = el('div', { className: 'pc-hero' }, [
  el('p', { className: 'vl-label pc-hero__label', text: 'Sell it for' }),
  priceText,
  priceLine,
]);

// One continuous control, because margin is the one number here you feel your way to while
// watching the price move. The usual margins are stops you can click.
const margin = sliderRow({
  label: 'Margin', min: 0, max: MARGIN_MAX, step: 1, value: inputs.margin, unit: '%',
  onInput: (v) => { inputs.margin = clampMargin(v); update(); },
});
const stops = MARGIN_STOPS.map((m) => chip({
  label: `${m}%`, centered: true,
  onToggle: () => { inputs.margin = m; margin.setValue(m); update(); },
}));
const marginBlock = el('div', { className: 'pc-margin' }, [margin, el('div', { className: 'pc-stops' }, stops)]);

/** One line of the breakdown, shown only while it applies. */
function costRow(label: string, className = ''): { row: HTMLElement; set(value: number | null, label?: string): void } {
  const name = el('span', { text: label });
  const value = el('span', { className: 'pc-costs__value' });
  const row = el('div', { className: `pc-costs__row${className ? ` ${className}` : ''}` }, [name, value]);
  return {
    row,
    set(v, newLabel) {
      row.hidden = v === null;
      if (v !== null) value.textContent = money(v);
      if (newLabel) name.textContent = newLabel;
    },
  };
}
const rows = {
  filament: costRow('Filament'),
  labor: costRow('Your time'),
  machine: costRow('Printer wear'),
  electricity: costRow('Electricity'),
  flat: costRow('Hardware & packaging'),
  cut: costRow('Platform cut'),
};
const totalRow = costRow('Total cost', 'pc-costs__row--total');
const profitRow = costRow('Profit', 'pc-costs__row--profit');
const costs = section({
  title: 'What it costs you',
  body: [
    el('div', { className: 'pc-costs' }, [
      ...Object.values(rows).map((r) => r.row),
      el('hr', { className: 'pc-costs__rule' }),
      totalRow.row,
      profitRow.row,
    ]),
  ],
});

const reset = button({
  label: 'Reset', icon: ICONS.rotateLeft, emphasis: 'ghost', title: 'Clear every field',
  onClick: () => {
    inputs = defaultInputs();
    name = '';
    nameField.setValue('');
    const fixed: [NumberFieldHandle, number][] = [
      [laborMinutes, inputs.laborMinutes], [hourlyRate, inputs.hourlyRate], [printHours, inputs.printHours],
      [printMinutes, inputs.printMinutes], [printerCost, inputs.printerCost], [printerLifespan, inputs.printerLifespan],
      [printerWatts, inputs.printerWatts], [electricityRate, inputs.electricityRate],
    ];
    for (const [field, value] of fixed) field.setValue(value);
    margin.setValue(inputs.margin);
    drawFilaments();
    drawFees();
    update();
    toast('Every field cleared', { kind: 'ok' });
  },
});

// ---------------------------------------------------------------------------
// One function puts every number on screen
// ---------------------------------------------------------------------------

function update() {
  const p = priceOf(inputs);
  const has = p.totalCost > 0;
  priceText.textContent = has ? money(p.price) : '—';
  priceText.classList.toggle('pc-hero__price--empty', !has);
  const who = name.trim();
  priceLine.textContent = has
    ? `${who ? `${who}: c` : 'C'}osts you ${money(p.totalCost)}, keeps ${money(p.profit)}.`
    : 'Fill in grams and roll price to see a price.';

  MARGIN_STOPS.forEach((s, i) => stops[i]!.setPressed(inputs.margin === s));

  rows.filament.set(p.filament);
  rows.labor.set(p.labor > 0 ? p.labor : null);
  rows.machine.set(p.machine > 0 ? p.machine : null);
  rows.electricity.set(p.electricity > 0 ? p.electricity : null);
  rows.flat.set(p.flatFees > 0 ? p.flatFees : null);
  rows.cut.set(p.percentFeeCost > 0 ? p.percentFeeCost : null, `Platform cut (${p.percentFees}%)`);
  totalRow.set(p.totalCost);
  profitRow.set(p.profit, `Profit at ${inputs.margin}%`);

  // A folded section still says what it adds.
  time.setDetail(p.labor > 0 ? money(p.labor) : '');
  const overhead = p.machine + p.electricity;
  machine.setDetail(overhead > 0 ? money(overhead) : '');
  fees.setDetail([p.percentFees > 0 ? `${p.percentFees}%` : '', p.flatFees > 0 ? money(p.flatFees) : ''].filter(Boolean).join(' + '));

  feeProblems.set(p.percentTooHigh
    ? [{
      level: 'error',
      message: `Cuts of the sale add up to ${p.percentFees}%, which leaves nothing to price against.`,
      fix: 'They are ignored until they add up to less than 100%.',
    }]
    : []);
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const shell = appShell({
  topbar: topbarLinks({ themeToggle: true, themeStorageKey: 'price-calculator-theme' }),
  stage: [form],
  pageStage: true,
  right: {
    scroll: [hero, marginBlock, costs],
    footer: [buttonRow(reset)],
  },
});
document.getElementById('app')!.append(shell.root);

drawFilaments();
drawFees();
update();
