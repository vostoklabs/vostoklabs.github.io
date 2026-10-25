// Letter-block bodies, generated from the layout instead of loaded from CAD.
//
// The blocks were six CAD shells, one per neighbour pattern, rotated into place so that two
// half-walls met at every joint. That shape of solution cannot make a 3×3 or a WASD cluster
// cleanly: the shells were 0.34 mm wider than deep, so a grid paired wide faces with narrow
// ones, and a wall with no neighbour stayed full, so two diagonal blocks ran their walls into
// each other's corner. It also had no way to leave the walls out, or to put anything on the
// outside.
//
// So the body is built here, in one piece, from the list of key cells:
//
//   - 'walls': one well per key and a wall between neighbours — the look the CAD shells had.
//   - 'open':  one well round every key at keyboard pitch, no wall between them.
//
// The outer wall can carry a texture. It is built as its own mesh (`skinMesh`, in skin.ts,
// which the flat clicker's textured body is built from too): the outline is sampled by arc
// length and every sample is pushed out along its normal by the texture's height at that point,
// ring by ring up the wall. Chamfers come from the same push, inward, at the top and bottom.
// Every corner of the outline is rounded before this runs, and every push is smaller than the
// tightest corner radius, so the surface cannot fold over itself.
//
// Frame (shared with buildBlocks): Z = 0 is the plate plane — the switch latches there and it
// is the floor of the keycap well. Key (0, 0) sits wherever the layout puts it; the whole
// arrangement is centred on the origin.
import { csOf, extrude, ringsOf } from '@vostok/manifold';
import { signedArea } from '@vostok/shapes';
import type { BlockStyle, BlockTexture } from '../types';
import { skinShell } from './skin';

type Wasm = any;
type Solid = any;
type Section = any;
export type Ring = [number, number][];

/** One key on the layout grid. Row 0 is the top row, column 0 the left one. */
export interface KeyCell {
  row: number;
  col: number;
}

export type BodyStyle = BlockStyle;
export type BodyTexture = BlockTexture;

/**
 * Body dimensions, mm. The defaults are measured off the CAD block shells they replace, in
 * the assembly frame: 1.75 mm walls, a 7.9 mm deep keycap well whose floor is 0.27 mm above the
 * plate plane, an underside 9.73 mm below it, ~3 mm corners, a 1 mm top and a 2 mm bottom
 * chamfer. Only the well is square now (the shells were 0.34 mm wider than deep).
 */
export interface KeyBodyDims {
  /** The keycap's footprint, square. */
  cap: number;
  /** Gap between the cap and the wall, per side. */
  clearance: number;
  /** Outer wall, and the wall between two keys. */
  wall: number;
  /** Key spacing with no wall between keys — standard keyboard pitch. */
  openPitch: number;
  /** Top of the body (the rim) above the plate plane. */
  rimZ: number;
  /** Floor of the keycap well. The shells kept a little plate above the socket's top face. */
  floorZ: number;
  /** The underside, below the plate plane. */
  bottomZ: number;
  chamferTop: number;
  chamferBottom: number;
  /** Radius of the outer corners. */
  cornerR: number;
  /** Radius of the inside corners of the outline (a WASD cluster has four). */
  concaveR: number;
}

export const BODY_DIMS: KeyBodyDims = {
  cap: 18.14,
  clearance: 1.08,
  wall: 1.75,
  openPitch: 19.05,
  rimZ: 7.909,
  floorZ: 0.27,
  bottomZ: -9.73,
  chamferTop: 1.0,
  chamferBottom: 2.0,
  cornerR: 3.0,
  concaveR: 2.0,
};

/** The standard body's height, underside to rim, mm: what the Body rim height control reads
 *  before it raises the rim. */
export const BODY_HEIGHT_MM = BODY_DIMS.rimZ - BODY_DIMS.bottomZ;

/** Width of one key's well. */
export function wellSize(d: KeyBodyDims): number {
  return d.cap + 2 * d.clearance;
}

/** Centre-to-centre spacing of two neighbouring keys. */
export function keyPitch(style: BodyStyle, d: KeyBodyDims = BODY_DIMS): number {
  return style === 'open' ? d.openPitch : wellSize(d) + d.wall;
}

/** Where each cell's key sits, the arrangement centred on the origin. Rows run down (−Y). */
export function keyCentres(cells: KeyCell[], pitch: number): [number, number][] {
  if (!cells.length) return [];
  const rows = cells.map((c) => c.row);
  const cols = cells.map((c) => c.col);
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2;
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2;
  return cells.map((c) => [(c.col - midCol) * pitch, -(c.row - midRow) * pitch]);
}

// ---------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------

export interface KeyBodyOptions {
  style: BodyStyle;
  texture: BodyTexture;
  dims?: Partial<KeyBodyDims>;
  /** The switch pocket, centred on the origin, reaching up to the well floor. Cut once under
   *  every key. */
  pocket?: Solid | null;
}

export interface KeyBody {
  /** The finished body. The caller owns it and must `delete()` it. */
  solid: Solid;
  /** Key centres, in the order of `cells`. */
  centres: [number, number][];
  pitch: number;
  /** The body's outline at full size (before chamfers and texture). */
  outline: Ring[];
}

/**
 * Build the body for a set of key cells.
 *
 * Throws on an empty layout; the caller says so in words before it gets here.
 */
export function buildKeyBody(wasm: Wasm, cells: KeyCell[], opts: KeyBodyOptions): KeyBody {
  if (!cells.length) throw new Error('No keys to build a body for.');
  const d: KeyBodyDims = { ...BODY_DIMS, ...opts.dims };
  const { CrossSection, Manifold } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  try {
    const pitch = keyPitch(opts.style, d);
    const centres = keyCentres(cells, pitch);
    const well = wellSize(d);
    const wellR = Math.max(0.3, d.cornerR - d.wall);

    // The wells: sharp squares unioned, THEN rounded, so two overlapping wells in the open
    // style merge into one clean pocket instead of leaving a notch where their corners met.
    const squares = centres.map(([x, y]) => track(track(CrossSection.square([well, well], true)).translate([x, y])));
    const merged = track(CrossSection.union(squares));
    const wells = track(track(merged.offset(-wellR, 'Miter', 2)).offset(wellR, 'Round', 2, 48));

    // The outline: the wells grown by the wall (which carries their rounding out to the outer
    // corners), then closed so every inside corner is round too, with any enclosed hole
    // filled — a ring of keys round an empty middle is a solid top there, not a hole through.
    const grown = track(wells.offset(d.wall, 'Round', 2, 64));
    const closed = track(track(grown.offset(d.concaveR, 'Round', 2, 64)).offset(-d.concaveR, 'Round', 2, 64));
    const outline = ringsOf(closed).filter((r) => signedArea(r) > 0);

    // The outer wall, one closed mesh per separate piece of outline.
    const shells: Solid[] = [];
    for (const ring of outline) {
      shells.push(track(skinShell(wasm, ring, {
        bottomZ: d.bottomZ,
        rimZ: d.rimZ,
        chamferTop: d.chamferTop,
        chamferBottom: d.chamferBottom,
        texture: opts.texture,
      })));
    }
    let body: Solid = shells.length === 1 ? shells[0] : track(Manifold.union(shells));

    // The keycap wells, from their floor up through the rim.
    const wellCut = track(track(extrude(wasm, wells, d.rimZ + 2 - d.floorZ)).translate([0, 0, d.floorZ]));
    body = track(body.subtract(wellCut));

    // The switch pockets.
    if (opts.pocket) {
      const pockets = centres.map(([x, y]) => track(opts.pocket.translate([x, y, 0])));
      const all = pockets.length === 1 ? pockets[0] : track(Manifold.union(pockets));
      body = track(body.subtract(all));
    }

    // Hand the result out of the trash.
    const i = trash.indexOf(body);
    if (i >= 0) trash.splice(i, 1);
    return { solid: body, centres, pitch, outline };
  } finally {
    for (const o of trash) {
      try {
        o.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

/** Cells in reading order for a row/column/grid layout, holes skipped. Mirrors buildBlocks. */
export function cellsInReadingOrder(count: number, cols: number, filled: (i: number) => boolean): KeyCell[] {
  const out: KeyCell[] = [];
  for (let i = 0; i < count; i++) if (filled(i)) out.push({ row: Math.floor(i / cols), col: i % cols });
  return out;
}

// Re-exported for tests: a quick way to make a ring into a section.
export function sectionOf(wasm: Wasm, rings: Ring[]): Section {
  return csOf(wasm, rings, 'Positive');
}
