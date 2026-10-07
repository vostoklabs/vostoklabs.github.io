// Millimetres or inches, one choice for the whole app: every length control, the 3D view's
// dimensions, the flat views and the status line read it from here. The kit's length units,
// remembered per browser under this app's own key.
import { lengthUnits } from '@vostok/ui-kit';

export const units = lengthUnits({ storageKey: 'laser-box-unit' });
