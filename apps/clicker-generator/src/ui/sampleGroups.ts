/*
  The Image panel's sample groups: one kit sample grid per pack, then the stock samples.

  Every group folds under its heading, so a long pack list does not push the stock samples out of
  sight. A pack starts open in its season and folded out of it; the stock samples always start
  open. The rule decides on each visit (nothing is saved), and the kit opens the group holding a
  design the moment it becomes the loaded one (`setSelected`), so it is never hidden.
*/
import { sampleGrid, type SampleGridHandle } from '@vostok/ui-kit';
import type { RgbaImage } from '@vostok/trace';
import { SAMPLES } from '../image/sample';
import { designUrl, inSeason, loadDesignImage, orderedDesignPacks, packFold } from '../packs';

/** The groups in the order they show, each ready to append. `onSample` is the panel's own
 *  callback: what to load, and the name the loaded tile is known by. */
export function sampleGroups(
  onSample: (load: () => Promise<RgbaImage>, label: string) => void,
  now: Date = new Date(),
): SampleGridHandle[] {
  const grids: SampleGridHandle[] = [];
  /* Packs FIRST, samples after. The packs are the artwork people come for and the bundled
     samples are a demo; with the samples on top, the pack sat below the fold of a 768px
     screen and had to be scrolled to. */
  for (const pack of orderedDesignPacks(now)) {
    grids.push(sampleGrid({
      // The chip is ordering made visible, never a gate — `inSeason` never hides a pack, so
      // the heading has to explain why Halloween is at the top in October and lower in June.
      heading: inSeason(pack, now) ? `${pack.name} · in season` : pack.name,
      fold: packFold(pack, now),
      // Keyed by NAME rather than a `packId:designId` pair: `onSample`'s only channel back
      // from `mount.ts` is the label it built the status line from (`design.name` /
      // `s.name`, below), not an id, so the name is the one string both sides actually share.
      items: pack.designs.map((d) => ({ id: d.name, src: designUrl(pack, d), label: d.name })),
      onPick: (_item, index) => {
        // By index into the same array `items` was built from, rather than re-finding the
        // design by id — the two are already in lockstep (`items` is a 1:1 map of
        // `pack.designs`).
        const design = pack.designs[index];
        // Straight down the sample path: one decode, the same colour wizard, the same
        // quantiser and the same palette an uploaded PNG gets. A pack that imported its
        // artwork its own way would be a second pipeline to keep in step with the first.
        if (design) onSample(() => loadDesignImage(pack, design), design.name);
      },
    }));
  }
  grids.push(sampleGrid({
    heading: 'Choose a sample image',
    fold: 'open',
    items: SAMPLES.map((s) => ({ id: s.name, src: s.src, label: s.name })),
    onPick: (_item, idx) => onSample(SAMPLES[idx].load, SAMPLES[idx].name),
  }));
  return grids;
}
