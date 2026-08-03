// Letter-block clickers: one printed block per letter, each holding its own MX switch
// and a real (dished, 1u) keycap with the letter debossed into the top as a separate
// colour body. Blocks snap together into a chain — every joint is two half-walls that
// meet to form one full wall, so the finished row reads as a single object.
//
// Frame (shared with buildClicker): Z = 0 is the switch-plate plane — the top of the MX
// socket cut-out, which in a block is the floor of the keycap well. The bundled
// keycap.json is authored in that same frame (its stem IS the mx-stem asset, verified
// by cross-section), so a keycap needs no Z shift at all: skirt bottom lands exactly on
// the well floor and the cap sits ~3.9 mm proud of the block rim.
//
// The chain runs along +X so text reads left-to-right in the viewer. Ian's block assets
// are authored with their connectable ("half") walls on the NORTH/SOUTH faces, so every
// block is rotated 90° about Z; the keycap and the preview switch are rotated with it so
// the stem cross, the socket and the cap stay mutually aligned.
import type { BuildParams, BuildRegion, ClickerPart, Ring, RGB, SwitchPlacement } from '../types';
import { hardcodedVoids, getMarkSeed, markVoids } from './identityMark';

type Wasm = any;
type Solid = any;
type Section = any;

/** Which faces of a block are halved so they can meet a neighbour. Bit flags in the
 *  assembly frame: N is +Y, S is −Y, E is +X, W is −X. */
export const DIR = { N: 1, S: 2, E: 4, W: 8 } as const;

/** Rotate a connect-mask by +90° CCW: E→N, N→W, W→S, S→E. */
function rotMask(mask: number, quarters: number): number {
  let m = mask;
  for (let q = ((quarters % 4) + 4) % 4; q > 0; q--) {
    m =
      ((m & DIR.E) ? DIR.N : 0) |
      ((m & DIR.N) ? DIR.W : 0) |
      ((m & DIR.W) ? DIR.S : 0) |
      ((m & DIR.S) ? DIR.E : 0);
  }
  return m;
}

/** The six block shells, normalised into the assembly frame (switch axis at the XY
 *  origin, well floor at Z 0) and indexed by the set of faces they connect on. Ian's CAD
 *  covers every one of the 16 possible neighbour patterns once rotations are allowed:
 *  none / 1 face / 2 opposite / 2 adjacent / 3 faces / 4 faces. */
export interface BlockAssets {
  /** mask → the asset that provides it and the Z rotation (degrees) that gets it there. */
  byMask: Map<number, { solid: Solid; rot: number }>;
  /** Centre-to-centre spacing when both blocks at a joint present the same axis (mm). */
  pitch: number;
  /** The larger of the two axis pitches. The shells are not perfectly square (they are
   *  0.34 mm wider than they are deep), so a grid — where neighbours are rotated 90° from
   *  each other — has joints that pair a wide face with a narrow one. Spacing those at the
   *  larger pitch leaves a hair of slop instead of making the parts interfere. */
  pitchMax: number;
}

export interface KeycapAsset {
  shell: { positions: number[]; indices: number[] };
  stem?: { positions: number[]; indices: number[] } | null;
  meta: {
    topZ: number;
    dishBottomZ: number;
    center: [number, number];
    topExtent?: [number, number];
    bbox: { min: number[]; max: number[] };
  };
}

function meshToSolid(wasm: Wasm, positions: ArrayLike<number>, indices: ArrayLike<number>): Solid {
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: positions instanceof Float32Array ? positions : new Float32Array(positions),
    triVerts: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
  });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}

/** Bounding box of a 2D ring list. */
function ringsBBox(rings: Ring[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

/**
 * Normalise one raw block asset into the assembly frame.
 *
 * The blocks are exported from CAD at arbitrary XY positions, so nothing can be placed
 * until each one is re-anchored on its own switch axis. Both anchors are *measured*
 * from the geometry rather than hard-coded, so re-exported assets keep working:
 *   • XY  — slice through the switch pocket (the lower cavity) and take the centre of
 *           the inner ring. On an end block that centre is offset from the bbox centre
 *           by half the wall that was shaved off, which is exactly the offset we need.
 *   • Z   — the pocket floor (measured by intersecting a column over the switch axis)
 *           plus the height of the MX socket asset = the socket's top face = the floor
 *           of the keycap well = Z 0 in the clicker frame.
 */
function normaliseBlock(wasm: Wasm, raw: Solid, socketHeight: number): { solid: Solid; size: [number, number] } {
  const { Manifold, CrossSection } = wasm;
  const bb = raw.boundingBox();
  const sizeX = bb.max[0] - bb.min[0];
  const sizeY = bb.max[1] - bb.min[1];
  const height = bb.max[2] - bb.min[2];
  // Work from a copy sitting on Z = 0 and centred on its own bbox.
  const centred = raw.translate([
    -(bb.min[0] + bb.max[0]) / 2,
    -(bb.min[1] + bb.max[1]) / 2,
    -bb.min[2],
  ]);

  let cx = 0;
  let cy = 0;
  try {
    // 25 % of the height is comfortably inside the switch pocket on these assets.
    const polys = centred.slice(height * 0.25).toPolygons() as Ring[];
    let best: ReturnType<typeof ringsBBox> | null = null;
    let bestArea = Infinity;
    for (const p of polys) {
      const a = ringArea(p);
      if (a < bestArea) {
        bestArea = a;
        best = ringsBBox([p]);
      }
    }
    if (best && polys.length > 1) {
      cx = (best.minX + best.maxX) / 2;
      cy = (best.minY + best.maxY) / 2;
    }
  } catch {
    /* keep the bbox centre */
  }

  // Pocket floor: the only material inside a 13 mm column over the switch axis is the
  // block's bottom slab, so its top face is the floor the switch drops onto.
  let floorZ = 0;
  try {
    const col = Manifold.extrude(
      CrossSection.square([13, 13], true).translate([cx, cy]),
      height + 2,
    ).translate([0, 0, -1]);
    const slab = centred.intersect(col);
    floorZ = slab.boundingBox().max[2];
    col.delete();
    slab.delete();
  } catch {
    floorZ = 0;
  }

  const solid = centred.translate([-cx, -cy, -(floorZ + socketHeight)]);
  centred.delete();
  return { solid, size: [sizeX, sizeY] };
}

/**
 * Measure the block assets once (at worker init) so every build is pure placement.
 * `socket` is the already-normalised MX socket solid (its top face at Z = 0).
 */
export interface RawBlocks {
  noSides: Solid;
  south: Solid;
  northSouth: Solid;
  northWest?: Solid;
  northSouthWest?: Solid;
  allSides?: Solid;
}

export function prepareBlockAssets(wasm: Wasm, socket: Solid, raw: RawBlocks): BlockAssets {
  const sbb = socket.boundingBox();
  const socketHeight = sbb.max[2] - sbb.min[2];

  // Local connect masks, verified against the geometry (the file names are accurate:
  // N = +Y, S = −Y, W = −X, E = +X).
  const sources: [Solid | undefined, number][] = [
    [raw.noSides, 0],
    [raw.south, DIR.S],
    [raw.northSouth, DIR.N | DIR.S],
    [raw.northWest, DIR.N | DIR.W],
    [raw.northSouthWest, DIR.N | DIR.S | DIR.W],
    [raw.allSides, DIR.N | DIR.S | DIR.E | DIR.W],
  ];

  const byMask = new Map<number, { solid: Solid; rot: number }>();
  let noSidesSize: [number, number] | null = null;
  let southSize: [number, number] | null = null;
  let northSouthSize: [number, number] | null = null;

  for (const [src, localMask] of sources) {
    if (!src) continue;
    const { solid, size } = normaliseBlock(wasm, src, socketHeight);
    if (localMask === 0) noSidesSize = size;
    else if (localMask === DIR.S) southSize = size;
    else if (localMask === (DIR.N | DIR.S)) northSouthSize = size;
    // One normalised shell serves all four of its rotations.
    for (let q = 0; q < 4; q++) {
      const m = rotMask(localMask, q);
      if (!byMask.has(m)) byMask.set(m, { solid, rot: q * 90 });
    }
  }

  // A both-ends-connected block is exactly one pitch deep: both walls are halved, so
  // stacking them bbox-to-bbox reproduces a full wall at every joint.
  let pitch = northSouthSize?.[1] ?? 0;
  let pitchMax = pitch;
  if (noSidesSize && southSize) {
    const halfWall = noSidesSize[1] - southSize[1]; // material removed from one face
    const expected = noSidesSize[1] - 2 * halfWall;
    if (!(pitch > 1) || Math.abs(pitch - expected) > 0.05) pitch = expected;
    // Same wall on the other axis — the shells are slightly wider than deep.
    pitchMax = Math.max(pitch, noSidesSize[0] - 2 * halfWall);
  }

  return { byMask, pitch, pitchMax };
}

/** Build the keycap shell (+ stem) once, centred on the switch axis. */
function buildCapBlank(wasm: Wasm, keycap: KeycapAsset, stemTolerance: number): Solid {
  const shell = meshToSolid(wasm, keycap.shell.positions, keycap.shell.indices);
  const [ccx, ccy] = keycap.meta.center;
  const centredShell = shell.translate([-ccx, -ccy, 0]);
  shell.delete();
  if (!keycap.stem) return centredShell;

  const stemRaw = meshToSolid(wasm, keycap.stem.positions, keycap.stem.indices);
  let stem = stemRaw.translate([-ccx, -ccy, 0]);
  stemRaw.delete();
  // Same semantics as the flat clicker cap: grow/shrink the stem's XY footprint so the
  // cross socket opens up (+, easier to press on) or closes (−). Z is untouched so the
  // cap's rest height never moves.
  if (Math.abs(stemTolerance) > 0.001) {
    const sb = stem.boundingBox();
    const dim = Math.max(sb.max[0] - sb.min[0], sb.max[1] - sb.min[1]);
    if (dim > 0.1) {
      const f = Math.max(0.5, (dim + stemTolerance) / dim);
      const scaled = stem.scale([f, f, 1]);
      stem.delete();
      stem = scaled;
    }
  }
  const cap = centredShell.add(stem);
  centredShell.delete();
  stem.delete();
  return cap;
}

/** Copy a mesh out of a solid, shifted in XY (cheap instancing for repeated blocks). */
function meshPart(
  solid: Solid,
  offset: [number, number],
  kind: 'cap' | 'body',
  group: 'top' | 'base',
  colorRgb: RGB,
  name: string,
): ClickerPart {
  const mesh = solid.getMesh();
  const verts = new Float32Array(mesh.vertProperties);
  const [dx, dy] = offset;
  if (dx !== 0 || dy !== 0) {
    for (let i = 0; i < verts.length; i += mesh.numProp) {
      verts[i] += dx;
      verts[i + 1] += dy;
    }
  }
  return {
    kind,
    group,
    colorRgb,
    name,
    numProp: mesh.numProp,
    vertProperties: verts,
    triVerts: new Uint32Array(mesh.triVerts),
  };
}

export function buildBlocks(
  wasm: Wasm,
  blocks: BlockAssets,
  keycap: KeycapAsset,
  regions: BuildRegion[],
  params: BuildParams,
): { parts: ClickerPart[]; switchPlacements: SwitchPlacement[]; warnings: string[] } {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  const parts: ClickerPart[] = [];
  const switchPlacements: SwitchPlacement[] = [];
  const warnings: string[] = [];

  // ---------- Layout ----------
  // Everything is a grid: a row is one row, a column is one column, and "grid" wraps at
  // `blockColumns`. Slots with no drawable outline (a space, or a cell the user emptied)
  // still consume a cell — that is what lets a WASD shape have holes in it.
  const layout = params.blockOrientation ?? 'horizontal';
  const cols =
    layout === 'vertical' ? 1
    : layout === 'grid' ? Math.max(1, Math.round(params.blockColumns ?? 2))
    : regions.length;
  const cells = regions.map((r, i) => ({
    region: r,
    row: Math.floor(i / cols),
    col: i % cols,
    filled: r.rings.some((ring) => ring.length >= 3),
  }));
  const filled = cells.filter((c) => c.filled);
  if (filled.length === 0) {
    return { parts, switchPlacements, warnings: ['Add a letter or a symbol to build blocks.'] };
  }

  // ---------- Block bases ----------
  // A block's shape is decided purely by which of its four neighbours exist, so identical
  // neighbour patterns share one CSG pass and are then instanced by shifting vertices.
  const occupied = new Set(filled.map((c) => `${c.row},${c.col}`));
  const has = (row: number, col: number) => occupied.has(`${row},${col}`);
  const masks = filled.map(
    (cell) =>
      (has(cell.row - 1, cell.col) ? DIR.N : 0) |
      (has(cell.row + 1, cell.col) ? DIR.S : 0) |
      (has(cell.row, cell.col + 1) ? DIR.E : 0) |
      (has(cell.row, cell.col - 1) ? DIR.W : 0),
  );

  // Spacing depends on the rotations the masks force. A row or a column turns every block
  // the same way, so both blocks at a joint present the same face and the tight pitch is
  // exact. A grid alternates 90° rotations, pairing a wide face with a narrow one — space
  // those at the larger pitch so the joint has a little slop rather than interfering.
  const rots = masks.map((m) => blocks.byMask.get(m)?.rot ?? 0);
  const swapped = rots.map((r) => Math.round(r / 90) % 2 === 1);
  const pitch = swapped.every((v) => v === swapped[0]) ? blocks.pitch : blocks.pitchMax;

  // Centre the whole arrangement on the origin. Rows run DOWN the screen (−Y), matching
  // reading order; legends are always cut in world space, so they stay upright.
  const minRow = Math.min(...filled.map((c) => c.row));
  const maxRow = Math.max(...filled.map((c) => c.row));
  const minCol = Math.min(...filled.map((c) => c.col));
  const maxCol = Math.max(...filled.map((c) => c.col));
  const originX = -((minCol + maxCol) / 2) * pitch;
  const originY = ((minRow + maxRow) / 2) * pitch;
  const at = (c: { row: number; col: number }): [number, number] => [
    originX + c.col * pitch,
    originY - c.row * pitch,
  ];
  const variantCache = new Map<number, { solid: Solid; rot: number }>();
  const blockVariant = (mask: number): { solid: Solid; rot: number } => {
    const cached = variantCache.get(mask);
    if (cached) return cached;
    const src = blocks.byMask.get(mask) ?? blocks.byMask.get(0);
    if (!src) throw new Error('No block asset for connect pattern ' + mask);
    let solid = src.rot ? track(src.solid.rotate([0, 0, src.rot])) : src.solid;
    solid = squareConnectTops(solid, mask);
    solid = applyIdentityVoids(solid);
    const v = { solid, rot: src.rot };
    variantCache.set(mask, v);
    return v;
  };

  const N = filled.length;
  // Which block carries the keyring loop: the one furthest towards the chosen side, and on
  // a tie (every block in a row shares a Y, so "top" ties across all of them) the one
  // closest to the middle, which is where a hanger looks deliberate rather than lopsided.
  const loopSide = params.keychainEnd ?? 'left';
  const loopCellIndex = (() => {
    const along = (c: { row: number; col: number }) =>
      loopSide === 'left' ? -c.col
      : loopSide === 'right' ? c.col
      : loopSide === 'top' ? -c.row
      : c.row;
    const across = (c: { row: number; col: number }) =>
      loopSide === 'left' || loopSide === 'right' ? c.row - (minRow + maxRow) / 2
                                                 : c.col - (minCol + maxCol) / 2;
    let best = 0;
    filled.forEach((c, i) => {
      const b = filled[best];
      if (along(c) > along(b) || (along(c) === along(b) && Math.abs(across(c)) < Math.abs(across(b)))) {
        best = i;
      }
    });
    return best;
  })();

  // The socket cut turns with its block, so the switch and the keycap on top of it have
  // to turn by the same amount to stay aligned with the stem cross.
  const cellRot: number[] = [];
  filled.forEach((cell, i) => {
    const mask = masks[i];
    const variant = blockVariant(mask);
    let solid = variant.solid;
    cellRot.push(variant.rot);
    // The keyring loop welds onto a free outer face of one end block, so that block stops
    // being a shared instance.
    const loop = keychainLoop(i, N, mask, solid);
    if (loop) solid = track(solid.add(loop));
    parts.push(meshPart(solid, at(cell), 'body', 'base', params.bodyColorRgb, `block-${i}`));
    switchPlacements.push({ x: at(cell)[0], y: at(cell)[1], rotation: variant.rot });
  });

  // ---------- Keycaps + debossed letters ----------
  const capBlank = track(buildCapBlank(wasm, keycap, params.stemTolerance ?? 0));

  // Seat the cap AT REST on the switch stem.
  //
  // Two numbers set this. The well floor is where the cap bottoms out: keycap.json is
  // authored with its skirt at Z 0 (the socket's top face), but a block keeps a plate ring
  // around the switch cut-out, so the floor sits a fraction higher — measured, not assumed,
  // because the only block material under the cap's own footprint IS that floor. Then the
  // cap has to sit one full switch travel ABOVE it: the cap is carried by the stem, so if
  // it rested on the floor the switch could never be pressed. That leaves the cross fully
  // engaged in the cap's stem tube, stopping `travel` short of bottoming out on the tube's
  // ceiling — which is exactly how far a keycap is pushed onto a real MX switch.
  const anyBlock = variantCache.values().next().value?.solid;
  const floorZ = anyBlock ? Math.max(0, wellFloorZ(anyBlock)) : 0;
  const capLift = floorZ + Math.max(0, params.travel ?? 4);
  // The switch itself doesn't move — it latches on that same plate ring.
  for (const p of switchPlacements) p.z = floorZ;

  // One seated cap blank per distinct block rotation (at most four), so a grid's rotated
  // blocks keep their stem cross aligned. The cap shell is square, so this only matters
  // for the stem — the legend is still cut afterwards in world space and stays upright.
  const capByRot = new Map<number, Solid>();
  const capFor = (rot: number): Solid => {
    const key = ((rot % 360) + 360) % 360;
    const hit = capByRot.get(key);
    if (hit) return hit;
    const rotated = key ? track(capBlank.rotate([0, 0, key])) : capBlank;
    const seated = capLift > 0.001 ? track(rotated.translate([0, 0, capLift])) : rotated;
    capByRot.set(key, seated);
    return seated;
  };

  const topZ = keycap.meta.topZ + capLift;
  const dishBottomZ = (keycap.meta.dishBottomZ ?? keycap.meta.topZ - 2) + capLift;
  // Legend size: one scale for the whole word (so "i" isn't blown up to "W" size),
  // driven by the tallest/widest glyph and capped to the cap's flat top.
  const capTop = keycap.meta.topExtent?.[0] ?? 15.2;
  const maxLegend = Math.max(6, capTop - 4.2); // keep the legend off the cap's shoulders
  let tallest = 0;
  let widest = 0;
  for (const c of filled) {
    const b = ringsBBox(c.region.rings);
    if (isFinite(b.h)) tallest = Math.max(tallest, b.h);
    if (isFinite(b.w)) widest = Math.max(widest, b.w);
  }
  // parseBlockChain hands over one shared scale for the letters (and its own for icons),
  // so the biggest slot in the chain sets the size and the rest stay in proportion.
  const sizeMul = Math.min(1.6, Math.max(0.4, params.legendScale ?? 1));
  const legendScale = (maxLegend / Math.max(tallest, widest, 1e-6)) * sizeMul;
  // Fixed: 0.8 mm is four 0.2 mm layers of legend colour, which is what a multi-colour
  // print needs to read cleanly. It was a slider, but there is no good reason to move it.
  const debossDepth = 0.8;
  // "Boldness": grow (or thin) every legend outline in the plane before it is cut. Lucide
  // symbols are hairline strokes, so this is what makes them printable at all.
  const bold = Math.max(-0.35, Math.min(0.9, params.legendBold ?? 0));

  for (let i = 0; i < N; i++) {
    const cell = filled[i];
    const offset = at(cell);
    const capOriented = capFor(cellRot[i]);
    const region = cell.region;
    const b = ringsBBox(region.rings);
    const gcx = (b.minX + b.maxX) / 2;
    const gcy = (b.minY + b.maxY) / 2;

    const polys: Ring[] = [];
    for (const ring of region.rings) {
      if (ring.length < 3) continue;
      const scaled: Ring = ring.map(([x, y]) => [
        (x - gcx) * legendScale,
        (y - gcy) * legendScale,
      ]);
      if (ringArea(scaled) > 0.0005) polys.push(scaled);
    }

    let capBody: Solid = capOriented;
    let letterBody: Solid | null = null;

    if (polys.length === 0) {
      warnings.push(`Letter ${i + 1} has no printable outline — its cap is blank.`);
    } else {
      try {
        let legend = track(new CrossSection(polys, 'NonZero'));
        if (Math.abs(bold) > 0.005) {
          const grown = track(legend.offset(bold, 'Round', 2.0, 24));
          if (!grown.isEmpty()) legend = grown;
        }
        // Deboss depth is measured from the LOWEST cap surface under the legend, so the
        // letter body is at least `debossDepth` thick everywhere despite the dish.
        const loZ = lowestSurfaceZ(capOriented, legend, dishBottomZ, topZ);
        const bottomZ = loZ - debossDepth;
        const prism = track(
          track(Manifold.extrude(legend, topZ + 3 - bottomZ)).translate([0, 0, bottomZ]),
        );
        const cut = track(capOriented.subtract(prism));
        const ink = track(capOriented.intersect(prism));
        if (!ink.isEmpty()) {
          capBody = cut;
          letterBody = ink;
        } else {
          warnings.push(`Letter ${i + 1} did not reach the cap surface.`);
        }
      } catch {
        warnings.push(`Letter ${i + 1} could not be engraved (bad outline).`);
      }
    }

    // Caps are individually recolourable (clicked in the viewport); the palette's Caps row
    // clears those overrides and sets them all back to one colour.
    const capName = `cap-${i}`;
    const capRgb = params.partOverrides?.[capName] ?? params.baseFilamentRgb;
    parts.push(meshPart(capBody, offset, 'cap', 'top', capRgb, capName));
    if (letterBody) {
      parts.push(meshPart(letterBody, offset, 'cap', 'top', region.filamentRgb, region.partName));
    }
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return { parts, switchPlacements, warnings };

  /**
   * Square off the top edge of the faces that meet a neighbour.
   *
   * The shells carry a ~0.05 mm × 0.15 mm edge break on some of their connectable faces
   * (it is asymmetric — the north+south shell has it on one side only). Two of those meet
   * at a joint and open a hairline V-groove along the top of the shared wall: invisible on
   * a print, but it catches the light in the preview and reads as a crack between blocks.
   *
   * The fix takes the cross-section from just BELOW the break — where the face is at its
   * true plane — and uses it to extend the top section outwards along each connecting
   * direction only, then fills that back up to the top. Nothing else moves: the outer top
   * chamfer of the free faces is defined by the top section itself, which is left alone.
   * On a shell without the break this adds nothing at all.
   */
  function squareConnectTops(block: Solid, mask: number): Solid {
    if (!mask) return block;
    try {
      const bb = block.boundingBox();
      const topZ = bb.max[2];
      const BREAK = 0.4; // depth to look below the top for the true face plane
      const trueFace = track(block.slice(topZ - BREAK));
      let section = track(block.slice(topZ - 0.02));
      if (trueFace.isEmpty() || section.isEmpty()) return block;

      for (const [dir, vec] of [
        [DIR.N, [0, 1]],
        [DIR.S, [0, -1]],
        [DIR.E, [1, 0]],
        [DIR.W, [-1, 0]],
      ] as [number, number[]][]) {
        if (!(mask & dir)) continue;
        // Smear the top section outwards, then clip it back to the real face plane.
        section = track(section.add(track(section.translate([vec[0] * 0.12, vec[1] * 0.12]))));
      }
      const patchSection = track(section.intersect(trueFace));
      if (patchSection.isEmpty()) return block;
      const patch = track(
        track(Manifold.extrude(patchSection, BREAK)).translate([0, 0, topZ - BREAK]),
      );
      return track(block.add(patch));
    } catch {
      return block;
    }
  }

  /** Keyring loop for the block at `i`, or null when it isn't the end that carries one.
   *  A disc with a ring hole, welded to the block's OUTER end face by a bridge that
   *  reaches back into the block, sitting flush with the block's bottom so the whole thing
   *  still prints flat. Local coordinates, so it rides along with the block instance. */
  function keychainLoop(i: number, _count: number, mask: number, block: Solid): Solid | null {
    const kc = params.keychain;
    if (!kc?.enabled) return null;
    if (i !== loopCellIndex) return null;

    // Prefer the face the user asked for; fall back to any free face if that one is taken
    // by a neighbour (a left-side loop on a vertical column, say).
    const side = params.keychainEnd ?? 'left';
    const wanted =
      side === 'right' ? DIR.E : side === 'top' ? DIR.N : side === 'bottom' ? DIR.S : DIR.W;
    const order = [wanted, DIR.W, DIR.E, DIR.N, DIR.S];
    const free = order.find((d) => !(mask & d));
    if (free === undefined) return null;

    const bb = block.boundingBox();
    const holeR = Math.max(1.5, (kc.holeDiameterMm ?? 5.2) / 2);
    const loopR = Math.max(3.2, holeR + 1.8);
    const th = Math.max(2.5, Math.min(5.0, (bb.max[2] - bb.min[2]) * 0.3));
    const dir: [number, number] =
      free === DIR.E ? [1, 0] : free === DIR.W ? [-1, 0] : free === DIR.N ? [0, 1] : [0, -1];
    const face =
      free === DIR.E ? bb.max[0]
      : free === DIR.W ? bb.min[0]
      : free === DIR.N ? bb.max[1]
      : bb.min[1];
    const cx = dir[0] * (Math.abs(face) + loopR);
    const cy = dir[1] * (Math.abs(face) + loopR);

    const disc = track(CrossSection.circle(loopR, 64).translate([cx, cy]));
    // The bridge starts inside the block (so the union is volumetric, never a tangent
    // kiss) and runs out to the loop centre.
    const bridgeLen = loopR + 3;
    const alongY = dir[1] !== 0;
    const bridge = track(
      CrossSection.square(
        alongY ? [loopR * 2, bridgeLen] : [bridgeLen, loopR * 2],
        true,
      ).translate([cx - (dir[0] * bridgeLen) / 2, cy - (dir[1] * bridgeLen) / 2]),
    );
    const fp = track(disc.add(bridge));
    const zBottom = bb.min[2];
    let loop = track(track(Manifold.extrude(fp, th)).translate([0, 0, zBottom]));
    // Break the tab's top and bottom rims so it reads as part of the block instead of a
    // flat sheet stuck to its side (and so the print has no sharp lip to catch on).
    const bevel = Math.min(0.6, th * 0.25);
    for (const [z, down] of [
      [zBottom + th, false],
      [zBottom, true],
    ] as [number, boolean][]) {
      const cutter = edgeBevelCutter(fp, bevel, z, down);
      if (cutter) loop = track(loop.subtract(cutter));
    }
    const hole = track(
      track(Manifold.extrude(track(CrossSection.circle(holeR, 48).translate([cx, cy])), th + 2))
        .translate([0, 0, zBottom - 1]),
    );
    loop = track(loop.subtract(hole));
    return loop;
  }

  /** Cutter that chamfers one horizontal rim of a prism with footprint `fp`: the space
   *  between the footprint and a copy of it shrunk by `r`, swept over `r` of height. Same
   *  single-face approach buildClicker uses for the clicker body, so the two match. */
  function edgeBevelCutter(fp: Section, r: number, zRef: number, isBottom: boolean): Solid | null {
    if (r < 0.05) return null;
    try {
      const b = fp.bounds();
      const W = b.max[0] - b.min[0];
      const H = b.max[1] - b.min[1];
      if (W < 2 * r || H < 2 * r) return null;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;
      const centred = track(fp.translate([-cx, -cy]));
      const outer = track(centred.offset(0.6, 'Round', 2.0, 16));
      const shell = track(Manifold.extrude(outer, r + 0.02));
      const taper = track(
        Manifold.extrude(centred, r + 0.02, 0, 0, [(W - 2 * r) / W, (H - 2 * r) / H]),
      );
      let cutter = track(shell.subtract(taper));
      if (isBottom) {
        cutter = track(
          track(track(cutter.translate([0, 0, -(r + 0.02) / 2])).scale([1, 1, -1]))
            .translate([0, 0, (r + 0.02) / 2]),
        );
      }
      return track(cutter.translate([cx, cy, isBottom ? zRef - 0.02 : zRef - r]));
    } catch {
      return null;
    }
  }

  /** Height of the keycap well's floor in `block`, measured by dropping the cap's own
   *  footprint through it: the cap is narrower than the well, so the only material the
   *  prism can hit is the plate ring below the well. Returns 0 if nothing is in the way. */
  function wellFloorZ(block: Solid): number {
    try {
      const bb = block.boundingBox();
      const fp = track(capBlank.project());
      const prism = track(
        track(Manifold.extrude(fp, bb.max[2] - bb.min[2] + 2)).translate([0, 0, bb.min[2] - 1]),
      );
      const under = track(block.intersect(prism));
      if (under.isEmpty()) return 0;
      const ub = under.boundingBox();
      // Sanity: the floor must be near Z 0, not the block rim (which would mean the
      // footprint clipped a wall and the measurement is meaningless).
      return ub.max[2] > 0 && ub.max[2] < 3 ? ub.max[2] : 0;
    } catch {
      return 0;
    }
  }

  /** Lowest point of the cap's top surface over `legend`: the highest Z at which the cap
   *  still completely covers the legend footprint. Binary search over slices — no
   *  raycaster, and it follows whatever dish the cap profile has. */
  function lowestSurfaceZ(cap: Solid, legend: Section, lo: number, hi: number): number {
    const covered = (z: number): boolean => {
      try {
        const cs = cap.slice(z);
        const outside = legend.subtract(cs);
        const empty = outside.isEmpty ? outside.isEmpty() : outside.area() < 1e-6;
        cs.delete();
        outside.delete();
        return empty;
      } catch {
        return false;
      }
    };
    if (!covered(lo)) return hi; // legend overhangs the cap top — fall back to a flat cut
    let a = lo;
    let bZ = hi;
    for (let k = 0; k < 12; k++) {
      const mid = (a + bZ) / 2;
      if (covered(mid)) a = mid;
      else bZ = mid;
    }
    return a;
  }

  /** Covert provenance voids, identical in spirit to the ones buildClicker buries in the
   *  clicker body: each sphere is only subtracted when it lands fully inside material, so
   *  it can never break a surface. Applied per block variant (each block is its own
   *  printed part, so each one carries the mark). */
  function applyIdentityVoids(block: Solid): Solid {
    let out = block;
    const seed = getMarkSeed();
    const all = [...(seed ? markVoids(seed) : []), ...hardcodedVoids()];
    for (const v of all) {
      const ang = (v.thetaDeg * Math.PI) / 180;
      const sphere = track(
        Manifold.sphere(v.d / 2, 16).translate([
          v.r * Math.cos(ang),
          v.r * Math.sin(ang),
          v.z,
        ]),
      );
      try {
        const inter = track(out.intersect(sphere));
        if (inter.volume() >= sphere.volume() * 0.98) out = track(out.subtract(sphere));
      } catch {
        /* skip this void */
      }
    }
    return out;
  }
}
