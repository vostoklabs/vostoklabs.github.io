/**
 * The Christmas pack.
 *
 * Fifteen flat-colour drawings for the cap, no base shapes. Each design is a small palette PNG
 * with a hard edge on transparency and only the drawing's own colours (no blended edge pixels),
 * so the colour wizard finds the colours that are really there and the trace stays clean.
 *
 * `id` is stored in saved projects. Renaming one breaks every project that used it, so pick
 * the id once and change only the `name` afterwards. Every `name` is unique across every grid,
 * because the picker knows the loaded sample by its name.
 */
import type { Pack } from './types';

export const CHRISTMAS: Pack = {
  id: 'christmas',
  name: 'Christmas',
  blurb: 'Christmas artwork: a tree, a snowman, a gift and the rest.',
  dir: 'christmas',
  // 15 November to 6 January: the run-up, the holidays and twelfth night. Wraps the new year.
  // It never overlaps Halloween's season, so at most one pack leads at a time.
  season: { from: '11-15', to: '01-06' },

  // No base shapes: the shape picker skips a pack without any.
  shapes: [],

  designs: [
    { id: 'santa-hat',   name: 'Santa hat',       file: 'santa-hat.png' },
    { id: 'tree',        name: 'Christmas tree',  file: 'tree.png' },
    { id: 'snowman',     name: 'Snowman',         file: 'snowman.png' },
    { id: 'candy-cane',  name: 'Candy cane',      file: 'candy-cane.png' },
    { id: 'gift',        name: 'Gift',            file: 'gift.png' },
    { id: 'stocking',    name: 'Stocking',        file: 'stocking.png' },
    { id: 'reindeer',    name: 'Reindeer',        file: 'reindeer.png' },
    { id: 'gingerbread', name: 'Gingerbread man', file: 'gingerbread.png' },
    { id: 'bell',        name: 'Bell',            file: 'bell.png' },
    { id: 'wreath',      name: 'Wreath',          file: 'wreath.png' },
    { id: 'bauble',      name: 'Bauble',          file: 'bauble.png' },
    { id: 'snowflake',   name: 'Snowflake',       file: 'snowflake.png' },
    { id: 'cocoa',       name: 'Hot cocoa',       file: 'cocoa.png' },
    { id: 'star',        name: 'Star',            file: 'star.png' },
    { id: 'elf-hat',     name: 'Elf hat',         file: 'elf-hat.png' },
  ],
};
