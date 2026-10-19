# Print Price Calculator

What a print costs you in filament, time and wear, and what to sell it for.

```bash
pnpm --filter price-calculator dev
pnpm --filter price-calculator test
```

Two columns from `appShell()`: the inputs in the middle, the answer on the right. Filament is the
only thing on the first screen that needs filling in; your time, printer wear and power, and
hardware and fees are folded sections that still show what they add while closed. Every number
updates as it is typed.

- `src/price.ts`: the maths, with no DOM: filament by weight, labour by the hour, printer wear
  spread over its life, electricity by the kWh, fixed costs added, and cuts of the sale grossed up
  (a 10% marketplace fee comes off the price, not the cost). Currencies are written in their own
  locale. Tested in `tests/price.test.mts`.
- `src/main.ts`: the screen, from kit blocks only (`numberField` with `live` and `emptyValue`,
  `collapsibleSection` with `detail`, `sliderRow`, `chip`, `diagnosticsList`).

The calculator works on the seller's own numbers and produces no design, so it carries no
generator licence and no licence window.
