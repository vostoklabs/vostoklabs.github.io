// The grouped symbol library lives in `@vostok/fonts` (`symbolGroups.ts`). This file
// used to hold its own copy of the same idea — a hand-picked Popular set and a dozen
// human-named groups — written before the package had one, and it had already drifted:
// its groups still named Font Awesome's categories (`emoji`, `fruits-vegetables`) long
// after the shared version existed, so the two apps disagreed about what "Popular"
// meant. One copy, and the keychain does the same.
export { POPULAR_IDS, POPULAR, QUICK_PICKS, SYMBOL_GROUPS, searchGroup, type SymbolGroup } from '@vostok/fonts';
