import type { ChangelogEntry } from '@vostok/ui-kit';

/* The update timeline behind the Updates button. Only what shipped, said for the person using the
   tool. Newest first is enforced by date when it renders. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-19',
    title: 'Render Studio',
    changes: [
      { kind: 'added', text: 'Listing photos of your own model, made in your browser. Studio light, soft shadows, every colorway in one download.' },
    ],
  },
];
