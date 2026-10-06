/*
 * The single cap's rebuild: the carve, what it says about itself, and the loop that runs it.
 *
 * One carve at a time, 200 ms after the last change, always of the settings as they are when it
 * starts (`buildLoop` from the kit, "Build loop"). An export awaits `settled()` and gets the cap
 * that matches the panel: a change made a moment before the click is carved first, where the
 * export used to take whichever carve had finished last. A batch of its own (the alphabet set, a
 * paid set) holds the loop while it uses the engine.
 */
import { buildLoop } from '@vostok/ui-kit/build-loop';
import { buildBodies } from './geometry.js';
import { logoFootprint } from './logo.js';

/** A build asked for while nothing can be carved: no legend yet, Fit test open, or a paid mode
 *  owning the stage. Not a failure, so nothing is said about it. */
export class CarveDeclined extends Error {
  constructor() {
    super('There is no cap to carve right now.');
    this.name = 'CarveDeclined';
  }
}

/**
 * Carve the cap: the first legend, then each extra legend on the cap the pass before it left.
 *
 * Chaining rather than carving every legend against the original shell is what makes two
 * legends that touch impossible to get wrong: pass 2 intersects a cap that has already had pass
 * 1's material taken out of it, so an overlapping sliver belongs to legend 1 and the two bodies
 * can never claim the same space in the exported file. Carving both against the shell would hand
 * the slicer two solids sharing a volume.
 *
 * @param {Array<{legend: object, opts: object}>} extras  the legends beyond the first
 */
export async function carveCap(shell, meta, legend, opts, extras = []) {
  let { keycapGeometry: capG, logoGeometry: logoG, surfaceVariation } = await buildBodies(shell, meta, legend, opts);
  const extraG = [];
  for (const extra of extras) {
    const r = await buildBodies(capG, meta, extra.legend, extra.opts);
    capG.dispose(); // superseded by the cap this pass carved
    capG = r.keycapGeometry;
    extraG.push(r.logoGeometry);
    surfaceVariation = Math.max(surfaceVariation, r.surfaceVariation);
  }
  return { keycapGeometry: capG, logoGeometry: logoG, extraGeometries: extraG, surfaceVariation };
}

/**
 * What a carve says about itself: its warnings, as the kit's diagnostics, and the line the status
 * shows when there are none. Neither warning stops an export (the cap still prints).
 *
 * One footprint per legend, so the "it won't fit" warning covers the second one too: it is the
 * layer most likely to be pushed out to an edge.
 *
 * @param {{ footprints: Array<{w:number,h:number}>, room: number, surfaceVariation: number,
 *           through: boolean, single: boolean, depth: number }} carve
 */
export function carveReport({ footprints, room, surfaceVariation, through, single, depth }) {
  const mm = (fp) => `${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm`;
  const word = footprints.length > 1 ? 'legends' : 'legend';
  const sizes = footprints.map(mm).join(' + ');
  const diagnostics = [];
  const tooBig = footprints.findIndex((fp) => Math.max(fp.w, fp.h) > room);
  if (tooBig >= 0) {
    const which = footprints.length > 1 ? `Legend ${tooBig + 1}` : 'Legend';
    diagnostics.push({
      level: 'warning',
      code: 'legend-too-big',
      message: `Heads up: ${which.toLowerCase()} (${mm(footprints[tooBig])}) is larger than the top (~${room.toFixed(1)} mm) and will be clipped.`,
    });
  }
  if (surfaceVariation > 0.4) {
    diagnostics.push({
      level: 'warning',
      code: 'curved-top',
      message: `Ready · ${word} ${sizes}. Note: top is curved (${surfaceVariation.toFixed(1)} mm). Keep it small so it stays flush.`,
    });
  }
  const ok = through
    ? `Ready · ${word} ${sizes} · shine-through: legend + stem print in the legend filament (use transparent to light up).`
    : single
      ? `Ready · ${word} ${sizes} · single colour: legend engraved ${depth} mm deep, prints in one filament.`
      : `Ready · ${word} ${sizes} · ${depth} mm deep.`;
  return { diagnostics, ok };
}

/**
 * The rebuild lock: how a batch of the app's own (the alphabet set, a paid set) holds the loop, so
 * no preview carve runs Manifold beside it, and gives it back.
 *
 * `begin()` takes it, and says false while a carve runs or another batch holds it. `end()` gives it
 * back, once however often it is called, and only then calls `afterRelease` (the app asks for a
 * carve of what the panel says now), so nothing that runs after the release can keep the loop held.
 * A batch calls `end()` first in its `finally`, and never awaits the loop's `settled()` between the
 * two: that waits for this very release. `held()` says the lock is taken; the loop's own `busy`
 * does not count a hold.
 *
 * @param {{ hold: () => (() => void) | null }} loop
 * @param {() => void} [afterRelease]
 */
export function createRebuildLock(loop, afterRelease) {
  let release = null;
  return {
    begin() {
      const r = loop.hold();
      if (!r) return false;
      release = r;
      return true;
    },
    end() {
      if (!release) return; // already given back: never ask for two carves for one batch
      const r = release;
      release = null;
      r();
      afterRelease?.();
    },
    held: () => release !== null,
  };
}

/**
 * The rebuild loop.
 *
 * `settings()` is read when a carve STARTS: `{ shell, meta, profile, legend, opts, extras }` as
 * the panel says them, or null when nothing can be carved (the carve then declines, quietly).
 * What a carve hands on, to the preview and to an export, is the settings it was carved from with
 * the bodies and the report, so an export names and lays out the cap it actually holds.
 *
 * @param {{ settings: () => object|null, onStart?: () => void, onShow: (carve: object) => void,
 *           onFail: (err: Error) => void, onIdle?: () => void }} hooks
 */
export function rebuildLoop({ settings, onStart, onShow, onFail, onIdle }) {
  return buildLoop({
    debounceMs: 200,
    run: async () => {
      const s = settings();
      if (!s) throw new CarveDeclined();
      await new Promise((r) => setTimeout(r, 0)); // let the busy chip paint
      const bodies = await carveCap(s.shell, s.meta, s.legend, s.opts, s.extras);
      const report = carveReport({
        footprints: [s.legend, ...s.extras.map((e) => e.legend)].map((l, i) =>
          logoFootprint(l.box, i === 0 ? s.opts.widthMM : s.extras[i - 1].opts.widthMM)),
        room: Math.min(s.meta.topExtent[0], s.meta.topExtent[1]),
        surfaceVariation: bodies.surfaceVariation,
        through: !!s.opts.through,
        single: !!s.opts.singleColor,
        depth: s.opts.depth,
      });
      return { ...s, bodies, report };
    },
    onStart,
    onResult: onShow,
    onError: (err) => { if (!(err instanceof CarveDeclined)) onFail(err); },
    onIdle,
    // Warnings only today: they are shown, and an export goes ahead (the cap still prints).
    diagnose: (carve) => carve.report.diagnostics,
  });
}
