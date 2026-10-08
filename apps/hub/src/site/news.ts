// "New this month" on the home page. Newest first; the first three are shown.

export interface NewsItem {
  /** Month, as YYYY-MM. */
  date: string;
  kind: 'New' | 'Update';
  /** A generator id from generators.json; the item links to its page. */
  generator: string;
  text: string;
}

export const NEWS: NewsItem[] = [
  { date: '2026-10', kind: 'New', generator: 'laser-box', text: 'Laser-cut boxes: lift-off and hinged lids, open trays and chests of drawers.' },
  { date: '2026-10', kind: 'Update', generator: 'laser-studio', text: 'Keychain bases for the keychain templates.' },
  { date: '2026-10', kind: 'Update', generator: 'clicker', text: 'Symbols and more fonts for text caps.' },
];
