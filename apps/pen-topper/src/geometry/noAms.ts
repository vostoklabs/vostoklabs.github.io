import { minPlateThickness, type TopperSettings } from '../state';

/** Snap the plate + halo band heights onto layer boundaries so no-AMS pauses land cleanly. */
export function snapLayers(base: number, halo: number, layerHeight: number): { base: number; halo: number } {
  const lh = layerHeight > 0 ? layerHeight : 0.2;
  return {
    base: Math.max(lh, Math.round(base / lh) * lh),
    halo: Math.max(lh, Math.round(halo / lh) * lh),
  };
}

type BandParams = Pick<
  TopperSettings,
  | 'penPath'
  | 'plateThickness'
  | 'haloThickness'
  | 'layerHeight'
  | 'printMode'
  | 'colorScheme'
  | 'barrelDia'
  | 'boreClearance'
  | 'wallThickness'
  | 'holeShape'
>;

/**
 * Where the builder stacks the colour bands, mm: the body's top face, the halo band's
 * height, and where the letters start.
 *
 * The body is not always the Plate thickness slider. Inside the name or straight
 * through, it is held up to the height the bore needs — 14.3 mm for a BIC against the
 * slider's 5 — and in a manual-swap print every band is snapped to whole layers. The
 * builder stacks the parts on these numbers and the pause readout reads them, so the
 * swap it names is the layer the next colour actually starts on. It once read the
 * slider instead and sent people to swap filament 9 mm too low.
 */
export function bandHeights(params: BandParams): { plateT: number; haloT: number; letterZ: number } {
  const body = params.penPath === 'collar'
    ? params.plateThickness
    : Math.max(params.plateThickness, minPlateThickness(params));
  const { base, halo } = params.printMode === 'noams'
    ? snapLayers(body, params.haloThickness, params.layerHeight)
    : { base: body, halo: params.haloThickness };
  return {
    plateT: base,
    haloT: halo,
    letterZ: base + (params.colorScheme === 'plate-halo-text' ? halo : 0),
  };
}

/** The Z heights at which the printer pauses for a manual filament swap — those of the
 *  manual-swap build, whose bands are snapped to the layer height. */
export function noAmsPauses(params: BandParams & Pick<TopperSettings, 'style'>): { z: number; label: string }[] {
  if (params.style !== 'raised' || params.colorScheme === 'single') return [];
  const { plateT, letterZ } = bandHeights({ ...params, printMode: 'noams' });
  if (params.colorScheme === 'plate-halo-text') {
    return [
      { z: plateT, label: 'halo colour' },
      { z: letterZ, label: 'text colour' },
    ];
  }
  return [{ z: letterZ, label: 'text colour' }];
}

/** The line under the print-mode control. */
export function pauseText(params: BandParams & Pick<TopperSettings, 'style'>): string {
  if (params.printMode !== 'noams') return 'Each colour lands on its own filament slot automatically.';
  const pauses = noAmsPauses(params);
  if (pauses.length === 0) return 'Add a second colour with raised letters to use manual swaps.';
  // Two decimals: on a 0.12 or 0.28 mm layer the boundary is not a whole tenth.
  return 'Pause and swap filament at: ' + pauses.map((p) => `${p.z.toFixed(2)} mm → ${p.label}`).join(', ') + '.';
}
