// Single source of truth for every Vostok Labs URL, price, and license string.
// Rule: NOTHING in any app hardcodes these - always import from @vostok/brand.
// A price or link change is one edit here.

export const BRAND = {
  name: 'Vostok Labs',
  urls: {
    // TODO(ian): replace with the real hub URL once deployed (and later, the custom domain)
    hub: 'https://vostoklabs.github.io',
    kofi: 'https://ko-fi.com/vostoklabs',
    makerworld: 'https://makerworld.com/en/@Vostok_Labs',
    // The "Get commercial license" target (from the live clicker topbar):
    mwCommercial: 'https://makerworld.com/en/@Vostok_Labs#commercial-membership-open',
    github: 'https://github.com/vostoklabs',
    // TODO(ian): verify — assumed from the repo name vostoklabs/Clicker-Generator
    clickerApp: 'https://vostoklabs.github.io/Clicker-Generator/',
    keycapApp: 'https://vostoklabs.github.io/SVG-keycap-generator/',
    // TODO: license/terms page on the hub once it exists
    licenseTerms: 'TODO_LICENSE_PAGE_URL',
  },
  pricing: {
    currency: 'USD',
    subscription: {
      month: 15,
      quarter: 40,
      year: 150,
      covers: 'the entire catalog',
      note: 'valid while the membership is active',
    },
    lifetime: {
      one: 150,
      three: 400,
      twelve: 1500,
      covers: 'a design (whole generator or a specific model), set at purchase',
      note: 'one-time payment, yours forever',
    },
  },
  freeTierLine:
    'Free for personal use. Selling prints requires a commercial license.',
} as const;

export type Brand = typeof BRAND;
