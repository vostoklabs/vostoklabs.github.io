// What a print costs and what to sell it for: every number on the screen, from the inputs alone.
// No DOM, so the tests run it in node.

export interface Filament {
  /** Grams the slicer says the print uses. */
  grams: number;
  /** What one 1 kg roll costs. */
  pricePerRoll: number;
}

export interface Fee {
  name: string;
  value: number;
  /** `flat` is a cost added once; `percentage` is a cut taken off the sale price. */
  type: 'flat' | 'percentage';
}

export interface PriceInputs {
  filaments: Filament[];
  fees: Fee[];
  printHours: number;
  printMinutes: number;
  /** Hands-on minutes: supports, sanding, packing. */
  laborMinutes: number;
  hourlyRate: number;
  printerCost: number;
  /** Hours the printer is expected to run in its life. */
  printerLifespan: number;
  printerWatts: number;
  /** Per kWh. */
  electricityRate: number;
  /** Percent on top of the total cost. */
  margin: number;
}

export interface PriceBreakdown {
  filament: number;
  labor: number;
  machine: number;
  electricity: number;
  flatFees: number;
  /** The percentage cuts added together. */
  percentFees: number;
  /** What the cuts take, in money, at this price. */
  percentFeeCost: number;
  /** Cuts of 100% or more leave nothing to price against, so they are ignored. */
  percentTooHigh: boolean;
  totalCost: number;
  price: number;
  profit: number;
}

/** Far past anything usual, so the margin control is never the reason a price is wrong: a
 *  hand-painted one-off really can sell at four times what the filament cost. */
export const MARGIN_MAX = 200;
export const MARGIN_STOPS = [20, 40, 60] as const;

export const DEFAULT_INPUTS: PriceInputs = {
  filaments: [{ grams: 0, pricePerRoll: 25 }],
  fees: [],
  printHours: 0,
  printMinutes: 0,
  laborMinutes: 0,
  hourlyRate: 20,
  printerCost: 0,
  printerLifespan: 5000,
  printerWatts: 0,
  electricityRate: 0.15,
  margin: 40,
};

/** A fresh copy, so nothing is shared with the defaults. */
export function defaultInputs(): PriceInputs {
  return {
    ...DEFAULT_INPUTS,
    filaments: DEFAULT_INPUTS.filaments.map((f) => ({ ...f })),
    fees: [],
  };
}

const n = (v: number) => (Number.isFinite(v) ? v : 0);

export function clampMargin(v: number): number {
  return Number.isFinite(v) ? Math.min(MARGIN_MAX, Math.max(0, v)) : 0;
}

export function priceOf(input: PriceInputs): PriceBreakdown {
  const filament = input.filaments.reduce((sum, f) => sum + (n(f.grams) / 1000) * n(f.pricePerRoll), 0);
  const printHours = n(input.printHours) + n(input.printMinutes) / 60;
  const labor = (n(input.laborMinutes) / 60) * n(input.hourlyRate);
  const machine = n(input.printerLifespan) > 0 && n(input.printerCost) > 0
    ? (n(input.printerCost) / n(input.printerLifespan)) * printHours
    : 0;
  const electricity = (n(input.printerWatts) / 1000) * printHours * n(input.electricityRate);
  const flatFees = input.fees.filter((f) => f.type === 'flat').reduce((sum, f) => sum + n(f.value), 0);
  const percentFees = input.fees.filter((f) => f.type === 'percentage').reduce((sum, f) => sum + n(f.value), 0);

  const baseCost = filament + labor + machine + electricity + flatFees;
  // A platform cut comes off the sale price, not the cost, so it is grossed up rather than
  // added. At 100% or more there is nothing left to gross up to.
  const percentTooHigh = percentFees >= 100;
  const totalCost = percentTooHigh ? baseCost : baseCost / (1 - percentFees / 100);
  const price = totalCost * (1 + clampMargin(input.margin) / 100);
  return {
    filament,
    labor,
    machine,
    electricity,
    flatFees,
    percentFees,
    percentFeeCost: totalCost - baseCost,
    percentTooHigh,
    totalCost,
    price,
    profit: price - totalCost,
  };
}

/*
 * `symbol` is for the unit beside a field ("£/h", "Kč/kWh"), a label rather than an amount.
 * `locale` is how amounts are written, and it is the currency's own rather than the reader's:
 * a price in CZK is a price shown to a Czech buyer, and `Intl` asked for CZK in `en-US` gives
 * "CZK 1,200.00", the right currency with the wrong symbol place and separators. The
 * currency's own locale gives "1 200,00 Kč". EUR has no single home, so it takes de-DE, which
 * agrees with CZK on grouping and decimals.
 */
export interface Currency {
  code: string;
  symbol: string;
  locale: string;
  label: string;
}

export const CURRENCIES: readonly Currency[] = [
  { code: 'USD', symbol: '$', locale: 'en-US', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', locale: 'de-DE', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', locale: 'en-GB', label: 'GBP (£)' },
  { code: 'CZK', symbol: 'Kč', locale: 'cs-CZ', label: 'CZK (Kč)' },
];

export function currencyOf(code: string): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;
}

/** Money, written by the platform: thousands separators included, which is the one place on
 *  this screen a misread number costs real money. */
export function formatMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat(currency.locale, { style: 'currency', currency: currency.code }).format(n(value));
}
