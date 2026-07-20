import type { BuildParams } from '../types';

/** Snap the base + halo band heights onto layer boundaries so no-AMS pauses land cleanly. */
export function snapLayers(base: number, halo: number, layerHeight: number): { base: number; halo: number } {
  const lh = layerHeight > 0 ? layerHeight : 0.2;
  return {
    base: Math.max(lh, Math.round(base / lh) * lh),
    halo: Math.max(lh, Math.round(halo / lh) * lh),
  };
}

/** The Z heights at which the printer pauses for a manual filament swap (no-AMS mode). */
export function noAmsPauses(
  params: Pick<BuildParams, 'colorScheme' | 'style' | 'baseThickness' | 'haloThickness' | 'layerHeight'>,
): { z: number; label: string }[] {
  const hasHalo = params.colorScheme === 'plate-halo-text';
  const multi = params.colorScheme !== 'single';
  if (params.style !== 'raised' || !multi) return [];
  const { base, halo } = snapLayers(params.baseThickness, params.haloThickness, params.layerHeight);
  if (hasHalo) {
    return [
      { z: base, label: 'halo colour' },
      { z: base + halo, label: 'text colour' },
    ];
  }
  return [{ z: base, label: 'text colour' }];
}
