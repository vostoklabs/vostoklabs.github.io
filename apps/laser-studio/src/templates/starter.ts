import { readSymbols } from '../symbols/model';
/** Copy this file, give the design a unique id, then register it in index.ts.
 * The shared form owns navigation, symbols, fonts, import and responsive layout.
 * Keep design-specific UI in fields; keep geometry in build(). */
import { textLayer } from '../engine/text';
import { keyringFields, keyringFrom } from './keyring';
import { num, str, type TemplateDef } from './types';

export const starter: TemplateDef = {
  id: 'my-design',
  name: 'My design',
  blurb: 'A short description of what your customer can make.',
  tags: ['sign', 'engrave + cut'],
  fields: [
    { kind: 'text', key: 'text', label: 'Text', panel: 'right', section: 'Text', value: 'Hello', maxLength: 24 },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'pacifico' },
    { kind: 'number', key: 'size', label: 'Text size', section: 'Size', value: 20, min: 5, max: 100, step: 1, unit: 'mm' },
    { kind: 'number', key: 'margin', label: 'Border', section: 'Size', value: 3, min: 1, max: 12, step: 0.5, unit: 'mm' },
    ...keyringFields('none'),
  ],
  async build(v) {
    return {
      blank: { kind: 'hug', margin: num(v, 'margin'), smoothing: 0.5 },
      keyring: keyringFrom(v),
      layers: await textLayer({ symbols: readSymbols(v), text: str(v, 'text'), font: str(v, 'font'), size: num(v, 'size') }, 'engrave'),
    };
  },
  fileName: (v) => `${str(v, 'text') || 'design'}-sign`,
};
