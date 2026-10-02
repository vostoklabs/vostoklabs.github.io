/**
 * The Halloween pack.
 *
 * ## Adding the artwork
 *
 * Drop the SVGs into `public/assets/packs/halloween/shapes/` and `.../designs/`, then add one
 * line each to the arrays below. Nothing else. No geometry change, no exporter change, no new
 * `BaseShapeKind` — a shape becomes `baseShape: 'custom'` with its rings traced by `parseSvg`,
 * and a design goes down exactly the path an uploaded SVG already takes.
 *
 * ## What makes a good pack SHAPE (the base silhouette)
 *
 * These become the printed body, so they answer to the geometry rather than to taste:
 *
 *  - **One closed silhouette, filled, no strokes.** `parseSvg` traces fills. A stroke-only
 *    outline traces as a thin ring and the base comes out as a hollow loop.
 *  - **Solid, not lacy.** The body has to contain a 17 mm switch column anywhere the user
 *    moves the switch to. A bat with 3 mm wings will have the column bulge straight out of
 *    them, and the build will say so — but a rounder bat simply will not.
 *  - **Keep detail above ~2 mm at print size.** A 40 mm pumpkin means its stalk is a couple
 *    of millimetres; anything finer is below what the base can hold.
 *  - **Convex-ish reads best.** Deep concavities are legal (the star and heart presets are
 *    already concave) but the cap has to slip into the well, and a sharp valley is where a
 *    cap binds.
 *
 * ## What makes a good pack DESIGN (the artwork on the cap)
 *
 * Flat colour regions, the way the existing SVG samples are. Every distinct fill becomes a
 * filament, so 3–4 colours is the sweet spot: it prints on any AMS and stays under the
 * 16-slot ceiling even in a batch run, where the whole run shares one palette.
 *
 * ## Naming
 *
 * `id` is stored in saved projects. Renaming one breaks every project that used it, so pick
 * the id once and change only the `name` afterwards.
 */
import type { Pack } from './types';

export const HALLOWEEN: Pack = {
  id: 'halloween',
  name: 'Halloween',
  blurb: 'Spooky season shapes and artwork — pumpkins, ghosts, bats and the rest.',
  dir: 'halloween',
  // 1 October to 2 November: the run-up plus the day or two afterwards when people are still
  // printing. Ordering and an "In season" chip only — see `inSeason` for why it never hides.
  season: { from: '10-01', to: '11-02' },

  /* ---- Base shapes ------------------------------------------------------------------
     The bodies. One line per SVG in public/assets/packs/halloween/shapes/, and a line only
     once its file is on disk — `loadPackShapes` skips a shape that will not load, so a
     manifest entry ahead of its artwork is an absence rather than a broken tile, which is
     worse than useless because nothing says which one it was. */
  shapes: [
    { id: 'pumpkin', name: 'Pumpkin', file: 'pumpkin.svg' },
    { id: 'coffin',  name: 'Coffin',  file: 'coffin.svg'  },
    { id: 'potion',  name: 'Potion',  file: 'potion.svg'  },
    // "Crest" and not "Shield": the built-in directory already has a Shield, and two tiles
    // reading the same word in one picker is a picker you have to click to understand.
    { id: 'shield',  name: 'Crest',   file: 'shield.svg'  },
  ],

  /* ---- Designs ----------------------------------------------------------------------
     The artwork that goes on the cap. Raster, not vector — see `PackDesign` for why the
     loader reads the extension rather than a field here. Ordered for the grid rather than
     alphabetically: the pumpkins lead because they are what the season looks like.

     Ids are permanent (they go into saved projects) and they are NOT the filenames by
     accident — both were chosen at the same time, before anything referenced either, which
     is the only moment renaming one is free. */
  designs: [
    { id: 'pumpkin-classic',   name: 'Jack-o’-lantern',   file: 'pumpkin-classic.png' },
    { id: 'pumpkin-wicked',    name: 'Wicked pumpkin',    file: 'pumpkin-wicked.png' },
    { id: 'pumpkin-happy',     name: 'Happy pumpkin',     file: 'pumpkin-happy.png' },
    { id: 'pumpkin-surprised', name: 'Surprised pumpkin', file: 'pumpkin-surprised.png' },
    { id: 'ghost',             name: 'Ghost',             file: 'ghost.png' },
    { id: 'ghost-boo',         name: 'Boo',               file: 'ghost-boo.png' },
    { id: 'bat',               name: 'Bat',               file: 'bat.png' },
    { id: 'skull',             name: 'Skull',             file: 'skull.png' },
    { id: 'witch-hat',         name: 'Witch hat',         file: 'witch-hat.png' },
    { id: 'cauldron',          name: 'Cauldron',          file: 'cauldron.png' },
    { id: 'potion',            name: 'Potion',            file: 'potion.png' },
    { id: 'coffin',            name: 'Coffin',            file: 'coffin.png' },
    { id: 'candy-corn',        name: 'Candy corn',        file: 'candy-corn.png' },
    { id: 'web',               name: 'Cobweb',            file: 'web.png' },
  ],

  /* Creepster is already bundled (see public/fonts) and licensed OFL, so the pack costs
     nothing to suggest it.

     NOTHING READS THIS YET, or `palette` below. Both were written against an `onPackApply`
     that was described in a comment and never built, so they are a declared intent rather
     than a working feature — said plainly here because the alternative is the next person
     going looking for the function, not finding it, and assuming they misread the code. */
  fontId: 'creepster',

  // Orange, purple, black and bone. Four, because that is what an AMS holds without a swap
  // and what a batch run can share across every item. Also unread — see `fontId`.
  palette: ['#ff6a13', '#5b2d8e', '#161616', '#d9c8a9'],
};
