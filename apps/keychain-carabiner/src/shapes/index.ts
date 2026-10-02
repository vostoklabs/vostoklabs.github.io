/*
  The shape directory: every silhouette the three pickers can offer.

  Two sources, and nothing downstream cares which:
    - built-in formulas (`builtin.ts`), present from the first paint;
    - Ian's SVG assets under `public/assets/shapes/`, listed in `manifest.json` there and
      fetched once at startup. Adding a shape is adding a file and a manifest line.

  A geometry build receives a `ShapeGeom` — the ring and its three markers — never an id, so
  the worker (and a future host that ports the builder) stays free of the registry.
*/
import { BUILTIN_SHAPES, type ShapeDef, type ShapeGroup } from './builtin';
import { shapeFromSvg } from './svgShape';
import { ringToThumbPath, type Ring } from './ring';

export type { ShapeDef, ShapeGroup } from './builtin';
export type { Ring, Pt } from './ring';

/** What a build is handed for each of the three parts. */
export interface ShapeGeom {
  ring: Ring;
  gate: number;
  eye: number;
  top: number;
  /** The gate was placed by hand (an SVG's `#gate` marker). Otherwise the builder places it
   *  on the outline AS HUNG — the authored-frame guess lands on the wrong side of a shape
   *  that has to turn to hang from its eye. */
  gateFixed?: boolean;
}

const shapes: ShapeDef[] = [...BUILTIN_SHAPES];

export function allShapes(): ShapeDef[] {
  return shapes;
}

export function shapeById(id: string): ShapeDef {
  return shapes.find((s) => s.id === id) ?? shapes[0]!;
}

export function geomOf(id: string): ShapeGeom {
  const s = shapeById(id);
  return { ring: s.ring, gate: s.gate, eye: s.eye, top: s.top, gateFixed: s.gateFixed };
}

export function thumbOf(s: ShapeDef): string {
  return ringToThumbPath(s.ring);
}

interface ManifestEntry {
  id: string;
  name: string;
  file: string;
  /** Picker group; assets default to "seasonal". */
  group?: ShapeGroup;
}

/** The picker's groups, in order, each with the shapes it holds. Empty groups are dropped. */
export function shapeGroups(): { id: ShapeGroup; label: string; shapes: ShapeDef[] }[] {
  const groups: { id: ShapeGroup; label: string }[] = [
    { id: 'basic', label: 'Basic' },
    { id: 'fun', label: 'Fun' },
    { id: 'seasonal', label: 'Seasonal' },
  ];
  return groups.map((g) => ({ ...g, shapes: shapes.filter((s) => s.group === g.id) })).filter((g) => g.shapes.length > 0);
}

/**
 * Load the SVG assets. Missing manifest = no assets, silently: the built-ins are the
 * product and the assets are additions. A broken file is reported and skipped rather than
 * taking the rest down with it.
 */
export async function loadSvgShapes(baseUrl: string): Promise<{ added: ShapeDef[]; issues: string[] }> {
  const added: ShapeDef[] = [];
  const issues: string[] = [];
  let manifest: ManifestEntry[] = [];
  try {
    const res = await fetch(`${baseUrl}manifest.json`);
    if (!res.ok) return { added, issues: res.status === 404 ? [] : [`manifest: HTTP ${res.status}`] };
    manifest = (await res.json()) as ManifestEntry[];
  } catch (err) {
    return { added, issues: [`manifest: ${err instanceof Error ? err.message : String(err)}`] };
  }
  for (const entry of manifest) {
    try {
      const res = await fetch(`${baseUrl}${entry.file}`);
      if (!res.ok) throw new Error(`${entry.file}: HTTP ${res.status}`);
      const def = shapeFromSvg(entry.id, entry.name, await res.text(), entry.group ?? 'seasonal');
      if (shapes.some((s) => s.id === def.id)) {
        issues.push(`${entry.id}: id already taken`);
        continue;
      }
      shapes.push(def);
      added.push(def);
    } catch (err) {
      issues.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { added, issues };
}
