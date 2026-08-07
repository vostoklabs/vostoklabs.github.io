import { PLATE_MESHES, type PlateMesh } from './meshes.generated';

/** Plates we ship meshes for. */
export type PlateId = 'a1' | 'a1mini' | 'h2d';
/** What the preview is standing the model on. `grid` is the plain reference grid. */
export type PlateChoice = PlateId | 'grid';

export interface PlateDef {
  id: PlateId;
  /** What the picker calls it — also what the closed button shows. */
  name: string;
  /** Size and the printers it belongs to, for the picker's second line. */
  details: string;
  /** Plate body size in mm (measured off the mesh, tab excluded). */
  size: [number, number];
  mesh: PlateMesh;
}

function def(id: PlateId, name: string, printers: string): PlateDef {
  const mesh = PLATE_MESHES[id];
  if (!mesh) throw new Error(`no mesh generated for plate "${id}" . Run pnpm --filter @vostok/plates build-meshes`);
  const size: [number, number] = [mesh.width, mesh.depth];
  const dims = `${Math.round(size[0])} × ${Math.round(size[1])} mm`;
  return { id, name, details: printers ? `${dims} · ${printers}` : dims, size, mesh };
}

/** Order matters: this is the order the picker lists them in. */
export const PLATES: PlateDef[] = [
  def('a1', 'Plate: A1, P/X series', 'A1, P1 Series, X1 Series, X2D, P2S'),
  def('a1mini', 'Plate: A1 mini', ''),
  def('h2d', 'Plate: H series', 'H2D, H2C'),
];

/** The A1's 256 x 256 plate — the one most people are printing on. */
export const DEFAULT_PLATE: PlateChoice = 'a1';

export function getPlate(id: string | null | undefined): PlateDef | null {
  return PLATES.find((p) => p.id === id) ?? null;
}

/** Narrows an arbitrary string (a stored preference, a URL param) to a choice. */
export function toPlateChoice(value: string | null | undefined): PlateChoice | null {
  if (value === 'grid') return 'grid';
  return getPlate(value)?.id ?? null;
}

/** What the closed picker button reads, e.g. `Plate: A1, P/X series`. */
export function plateLabel(choice: PlateChoice): string {
  return getPlate(choice)?.name ?? 'No plate';
}

// ---------------------------------------------------------------------------
// Preference, shared by every generator on the origin.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'vl.buildPlate';

export function loadPlateChoice(): PlateChoice {
  try {
    return toPlateChoice(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_PLATE;
  } catch {
    return DEFAULT_PLATE;
  }
}

export function savePlateChoice(choice: PlateChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private mode / storage disabled — the pick just doesn't stick */
  }
}
