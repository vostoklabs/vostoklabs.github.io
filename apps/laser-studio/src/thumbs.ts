// Every template's picture is its own default build, rendered once and kept. A new design in
// the registry is a new card in the gallery with nothing else to draw.
import { build } from './engine/engine';
import type { BuildOutput } from './engine/types';
import { defaultsOf, type TemplateDef } from './templates';

const cache = new Map<string, Promise<BuildOutput | null>>();

export function thumbnailFor(t: TemplateDef): Promise<BuildOutput | null> {
  let p = cache.get(t.id);
  if (!p) {
    p = t.build(defaultsOf(t)).then(build).catch((err) => { console.error(`thumbnail for ${t.id}`, err); return null; });
    cache.set(t.id, p);
  }
  return p;
}
