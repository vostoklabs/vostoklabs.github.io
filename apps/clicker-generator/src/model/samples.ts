// The samples Model mode opens on. Each is a finished clicker the moment it loads — its cutter
// and cut already chosen, and every one builds without a warning at them — so a tile shows what
// a cutter does rather than handing over a blank shape to configure.
//
// Our own models, sculpted in code, packed to the 3MFs here and checked to build at their
// presets. Nothing to license or credit. They ship as files and load exactly like
// an upload, because meshing them in the app would cost seven to ten seconds each.
import type { ModelCutParams } from './types';

export type SampleId = 'pumpkin' | 'skull' | 'ghost' | 'duck' | 'cupcake';

export interface ModelSample {
  id: SampleId;
  label: string;
  /** What it opens with, over whatever the mode had. */
  preset: Pick<ModelCutParams, 'cutter'> & Partial<Pick<ModelCutParams, 'slice' | 'stand'>>;
}

export const MODEL_SAMPLES: ModelSample[] = [
  { id: 'pumpkin', label: 'Pumpkin', preset: { cutter: 'slice', slice: { heightMm: null, hideSeam: true } } },
  { id: 'skull', label: 'Skull', preset: { cutter: 'slice', slice: { heightMm: 29, hideSeam: true } } },
  { id: 'ghost', label: 'Ghost', preset: { cutter: 'stand', stand: { shape: 'circle', marginMm: 2.5 } } },
  { id: 'duck', label: 'Duck', preset: { cutter: 'stand', stand: { shape: 'circle', marginMm: 2.5 } } },
  { id: 'cupcake', label: 'Cupcake', preset: { cutter: 'slice', slice: { heightMm: 19, hideSeam: true } } },
];

/** The one the mode opens on when nothing is loaded. */
export const FIRST_SAMPLE: SampleId = 'skull';

export const sampleById = (id: string): ModelSample | undefined => MODEL_SAMPLES.find((s) => s.id === id);

/** The model file, relative to the app's asset base. */
export const sampleFile = (id: SampleId): string => `assets/samples/${id}.3mf`;

/** Its tile's picture: the app's own render of it at its preset, on a transparent background. */
export const samplePicture = (id: SampleId): string => `assets/samples/${id}.webp`;
