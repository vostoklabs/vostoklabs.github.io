// The clicker's 3MF, written by the shelf's writer (@vostok/export, "3MF export"). This file only
// says what the clicker is to it.
//
//  - Every plate object is its own slicer object, so each can be moved and oriented on its own:
//    "clicker_top" and "clicker_base" for one clicker, two per row for a batch run, one per
//    piece for the fit test.
//  - The pieces are laid out for print by plateLayout() — packed onto the chosen bed, tops
//    flipped face-down — and the placement is BAKED INTO THE VERTICES rather than written as an
//    `<item transform>`; see plateLayout() for why. The writer only slides the whole
//    arrangement to the middle of the bed.
import { buildThreeMF as writeThreeMF, downloadFile, type ExportPart, type ProvenanceMeta } from '@vostok/export';
import { plateSize, type PlateChoice } from '@vostok/plates';
import type { ClickerPart } from '../types';
import { assemblyMinZ, objectKeyOf, objectKeys, placed, plateLayout } from './plateLayout';

export interface ThreeMFOptions {
  /** The bed to lay the model out on. Defaults to the plate picker's shared preference —
   *  the plate the user is looking at is the plate the file is written for. */
  plate?: PlateChoice;
  /**
   * A PNG of the design, embedded so the file shows what is in it.
   *
   * Without one, every export is a generic icon in the file browser and a blank card in a
   * slicer's project list — which is exactly how a folder of forty customer orders becomes
   * unsearchable. Optional: a file with no cover is still a valid 3MF.
   */
  coverPng?: Uint8Array;
  /** The same picture, small, for a slicer's list rows. Falls back to `coverPng`. */
  coverSmallPng?: Uint8Array;
  /**
   * The file a Model-mode clicker was cut from (its name, as uploaded).
   *
   * Set, the file stops claiming the shape as ours: the model is the uploader's (or whoever they
   * got it from), under whatever licence it came with, and a "© Vostok Labs, CC BY-NC-ND" line
   * over somebody else's figure would be a false statement in the one place people look to find
   * out whose a design is. What we made — the switch pocket, the stem, the fit — is still said.
   */
  sourceModel?: string;
}

/** What a plate object is called in the slicer's object list. */
function labelFor(parts: ClickerPart[], key: string): string {
  const p = parts.find((x) => objectKeyOf(x) === key);
  return p?.objectLabel ?? (p?.group === 'top' ? 'clicker_top' : 'clicker_base');
}

/** The provenance mark every clicker file carries, the 3MF and the OBJ alike (invariant #2).
 *  `sourceModel` is the file a Model-mode clicker was cut from: see `ThreeMFOptions`. */
export function clickerMark(sourceModel?: string): ProvenanceMeta {
  // Read without assuming Vite, so a node script that imports this file still runs.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return {
    title: 'Clicker',
    generator: 'clicker-generator',
    application: 'Vostok Labs Clicker Generator',
    buildId: env.VITE_BUILD_ID,
    sourceModel,
  };
}

export function buildThreeMF(parts: ClickerPart[], opts: ThreeMFOptions = {}): Uint8Array {
  // Drop the whole assembly onto the build plate (min Z -> 0), keeping relative positions,
  // then pack the pieces onto the chosen bed.
  const minZ = assemblyMinZ(parts);
  const layout = plateLayout(parts, minZ, { plate: opts.plate });

  // The writer makes one slicer object per group and names it after the group, so a plate
  // object's group is its label, kept unique: objects whose labels coincide (the fit test's
  // pieces all fall back to "clicker_base") stay separate as "clicker_base_2", "_3"…
  const groupOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const key of objectKeys(parts)) {
    const label = labelFor(parts, key);
    let group = label;
    for (let n = 2; taken.has(group); n++) group = `${label}_${n}`;
    taken.add(group);
    groupOf.set(key, group);
  }

  return writeThreeMF(
    parts.map((p): ExportPart<Float64Array> => ({
      name: p.name,
      color: p.colorRgb,
      extruder: p.extruder,
      positions: placed(p, minZ, layout.placementFor(objectKeyOf(p))),
      indices: p.triVerts,
      group: groupOf.get(objectKeyOf(p)),
    })),
    {
      ...clickerMark(opts.sourceModel),
      plateSize: plateSize(layout.plate),
      cover: opts.coverPng,
      coverSmall: opts.coverSmallPng,
    },
  );
}

export function downloadThreeMF(parts: ClickerPart[], fileName = 'clicker.3mf', opts: ThreeMFOptions = {}): void {
  downloadFile(buildThreeMF(parts, opts), fileName, 'model/3mf');
}
