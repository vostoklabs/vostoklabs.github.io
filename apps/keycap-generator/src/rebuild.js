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
import { FULL_TRAVEL_MM, ACTUATION_MM } from './shapes/clearance.js';

/**
 * Letters shorter than this come out with strokes about one 0.4 mm extrusion wide, which print
 * patchy or not at all. A long word on a small cap shrinks to fit, so this is where it says so.
 */
export const SMALL_TEXT_MM = 3;

/** An extra legend (a second or third on the cap) smaller than this, on its longer side, has
 *  strokes about one 0.4 mm extrusion wide. */
export const SMALL_LEGEND_MM = 3.5;

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
    // A raised legend carves nothing out of the cap, so chaining alone cannot keep two of them
    // apart: each one is told the legends already standing there instead.
    const extraOpts = extra.opts.raisedMM > 0 ? { ...extra.opts, avoid: [logoG, ...extraG] } : extra.opts;
    const r = await buildBodies(capG, meta, extra.legend, extraOpts);
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
 * layer most likely to be pushed out to an edge. A legend fits when its own width and height,
 * turned by its rotation, fit the top's width and depth: comparing its longer side with the top's
 * SHORT side, as this once did, warned about every word that fits a wide cap ("Shift" on a 2.25u).
 *
 * A stem recessed past the safe depth (`rimRecess`, mm, 0 when it is not) is the third warning:
 * the cap's rim may touch the switch when the key is pressed all the way.
 *
 * @param {{ footprints: Array<{w:number,h:number,rot?:number}>, top: [number, number],
 *           surfaceVariation: number, through: boolean, single: boolean, depth: number,
 *           raised?: number, rimLifted?: boolean, rimRecess?: number, textHeight?: number }} carve
 *           `rot`: the legend's rotation in degrees; `top`: the cap's usable top, width and depth (meta.topExtent);
 *           `raised`: how far a raised legend stands, 0 when it is not raised; `rimLifted`: the
 *           rim sits above the stem's bottom, so open side down it needs supports;
 *           `textHeight`: how tall typed letters come out, when the first legend is typed text;
 *           `travel`: how far the key goes down before the cap's sides meet the switch, when the
 *           cap knows (a made shape: its `meta.travelMM`, a recess included), else null. Short of
 *           full travel it is said as a fact, so a round 1u always says how far it presses.
 */
export function carveReport({ footprints, top, surfaceVariation, through, single, depth, raised = 0, rimLifted = false, rimRecess = 0, textHeight = 0, travel = null }) {
  const mm = (fp) => `${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm`;
  const word = footprints.length > 1 ? 'legends' : 'legend';
  const sizes = footprints.map(mm).join(' + ');
  const diagnostics = [];
  const fits = (fp) => {
    const a = ((fp.rot ?? 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return fp.w * c + fp.h * s <= top[0] + 1e-6 && fp.w * s + fp.h * c <= top[1] + 1e-6;
  };
  const tooBig = footprints.findIndex((fp) => !fits(fp));
  if (tooBig >= 0) {
    const which = footprints.length > 1 ? `Legend ${tooBig + 1}` : 'Legend';
    const topText = Math.abs(top[0] - top[1]) < 0.05 ? `${top[0].toFixed(1)} mm` : `${top[0].toFixed(1)}×${top[1].toFixed(1)} mm`;
    diagnostics.push({
      level: 'warning',
      code: 'legend-too-big',
      message: `Heads up: ${which.toLowerCase()} (${mm(footprints[tooBig])}) is larger than the top (~${topText}) and will be clipped.`,
    });
  }
  if (surfaceVariation > 0.4) {
    diagnostics.push({
      level: 'warning',
      code: 'curved-top',
      message: `Ready · ${word} ${sizes}. Note: top is curved (${surfaceVariation.toFixed(1)} mm). Keep it small so it stays flush.`,
    });
  }
  const small = footprints.findIndex((fp, i) => i > 0 && Math.max(fp.w, fp.h) < SMALL_LEGEND_MM);
  if (small > 0) {
    const fp = footprints[small];
    diagnostics.push({
      level: 'warning',
      code: 'small-legend',
      message: `Legend ${small + 1} is ${Math.max(fp.w, fp.h).toFixed(1)} mm: print with a 0.2 mm nozzle if you have one, or make it bigger.`,
    });
  }
  if (textHeight > 0 && textHeight < SMALL_TEXT_MM) {
    diagnostics.push({
      level: 'warning',
      code: 'small-text',
      message: `Small letters (${textHeight.toFixed(1)} mm tall): the thinnest strokes may not print cleanly with a 0.4 mm nozzle.`,
    });
  }
  if (travel != null && travel < ACTUATION_MM) {
    diagnostics.push({
      level: 'warning',
      code: 'travel-too-short',
      message: `Presses only ${Math.max(0, travel).toFixed(1)} mm of ${FULL_TRAVEL_MM} before the sides meet the switch: not enough to register (${ACTUATION_MM}). Make the cap bigger or the stem longer.`,
    });
  } else if (travel != null && travel < FULL_TRAVEL_MM - 1e-6) {
    diagnostics.push({
      level: 'warning',
      code: 'travel-short',
      message: `Presses ${travel.toFixed(1)} mm of ${FULL_TRAVEL_MM} before the sides meet the switch (it registers at ${ACTUATION_MM}).`,
    });
  }
  if (rimRecess > 0) {
    diagnostics.push({
      level: 'warning',
      code: 'rim-may-touch',
      message: `Stem ${rimRecess.toFixed(1)} mm shorter than the walls: the cap's edge may touch the switch when the key is pressed all the way.`,
    });
  }
  // A raised legend is the one cap that must NOT be flipped face down: the legend would be the only
  // thing on the plate, with the top hanging in the air above it.
  let ok = raised
    ? `Ready · ${word} ${sizes} · raised ${raised} mm. Print as exported, open side down${rimLifted ? ', with supports under the edge' : ''}; do not flip it.`
    : through
    ? `Ready · ${word} ${sizes} · shine-through: legend + stem print in the legend filament (use transparent to light up).`
    : single
      ? `Ready · ${word} ${sizes} · single colour: legend engraved ${depth} mm deep, prints in one filament.`
      : `Ready · ${word} ${sizes} · ${depth} mm deep.`;
  // Walls cut shorter than the stem (Wall height): the cap stands on its stem, its walls in the
  // air. The raised line above already says it its own way.
  if (rimLifted && !raised) ok += ' The walls end above the stem: print with supports under them.';
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
        footprints: [s.legend, ...s.extras.map((e) => e.legend)].map((l, i) => {
          const o = i === 0 ? s.opts : s.extras[i - 1].opts;
          return { ...logoFootprint(l.box, o.widthMM), rot: o.rotationDeg };
        }),
        top: s.meta.topExtent,
        surfaceVariation: bodies.surfaceVariation,
        through: !!s.opts.through,
        single: !!s.opts.singleColor,
        depth: s.opts.depth,
        raised: s.opts.raisedMM > 0 ? s.opts.raisedMM : 0,
        rimLifted: s.meta.bbox.min[2] > 0.05,
        rimRecess: s.rimRecess ?? 0,
        travel: s.travel ?? null,
        // The letters' height is the legend's own height on the cap, whichever way it is turned.
        textHeight: s.text ? logoFootprint(s.legend.box, s.opts.widthMM).h : 0,
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
