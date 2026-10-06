// Millimetres or inches, one choice for the whole app: the rulers, the status readout and every
// length a control shows or is typed into; the gallery never (a card has no numbers). The kit's
// length units, remembered per browser under Studio's own key.
import { lengthUnits } from '@vostok/ui-kit';

export const units = lengthUnits({ storageKey: 'laser-studio-unit' });
