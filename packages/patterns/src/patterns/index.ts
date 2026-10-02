// The registry. One line per pattern file; a family is a file.
import { FIELDS } from './fields';
import { GEOMETRIC } from './geometric';
import { HINGES } from './hinges';
import { ISLAMIC } from './islamic';
import { JAPANESE } from './japanese';
import { LATTICES } from './lattices';
import { ORGANIC } from './organic';
import { RADIAL } from './radial';
import { TEXTILE } from './textile';
import { TILINGS } from './tilings';
import type { PatternDef, PatternFamily } from '../types';

export const PATTERNS: PatternDef[] = [...GEOMETRIC, ...LATTICES, ...ISLAMIC, ...TILINGS, ...JAPANESE, ...TEXTILE, ...HINGES, ...FIELDS, ...RADIAL, ...ORGANIC];

export const FAMILY_LABELS: Record<PatternFamily, string> = {
  geometric: 'Geometric',
  lines: 'Lines & lattices',
  japanese: 'Japanese',
  islamic: 'Islamic',
  textile: 'Textile & ornament',
  hinge: 'Living hinges',
  radial: 'Radial',
  engrave: 'Engrave fills',
  organic: 'Organic & random',
  library: 'Tile library',
};

const byId = new Map(PATTERNS.map((p) => [p.id, p]));

export const patternById = (id: string): PatternDef | undefined => byId.get(id);

/** Add patterns at runtime — an app's own, or a library loaded lazily. Later ids win. */
export function registerPatterns(defs: PatternDef[]): void {
  for (const d of defs) {
    if (!byId.has(d.id)) PATTERNS.push(d);
    else {
      const i = PATTERNS.findIndex((p) => p.id === d.id);
      if (i >= 0) PATTERNS[i] = d;
    }
    byId.set(d.id, d);
  }
}

export function patternsOf(family: PatternFamily): PatternDef[] {
  return PATTERNS.filter((p) => p.family === family);
}
