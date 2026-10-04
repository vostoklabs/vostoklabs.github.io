// Letter-block clickers: one key per letter — a real MX switch under a real (dished, 1u)
// keycap with the letter debossed into its top as a separate colour body — in one printed body
// that holds them all.
//
// The body is generated from the layout (keyBody.ts): a wall between every key, or one open
// well round them all like a keyboard; in a row, a column, a grid or any shape with holes in it,
// such as a WASD cluster; smooth or textured outside. It replaced six CAD shells that were
// rotated into place so their half-walls met, which could make a row or a column but never a
// clean grid. Its dimensions are the shells' own, measured: see BODY_DIMS.
//
// Frame (shared with buildClicker): Z = 0 is the switch-plate plane — the top of the MX socket
// cut-out. The bundled keycap.json is authored in that same frame (its stem IS the mx-stem
// asset, verified by cross-section), so a keycap only moves up by the height it rests at.
//
// The arrangement runs along +X so text reads left-to-right in the viewer, rows running down.
import { csOf, extrude } from '@vostok/manifold';
import type { BuildParams, BuildRegion, ClickerPart, Ring, RGB, SwitchPlacement } from '../types';
import { hardcodedVoids, getMarkSeed, markVoids } from './identityMark';
import { applyStemFit } from './stemFit';
import { BODY_DIMS, buildKeyBody, wellSize, type KeyBodyDims, type KeyCell } from './keyBody';

type Wasm = any;
type Solid = any;
type Section = any;

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

/** The switch opening the CAD shells had, mm square. The socket asset's is 13.86 × 13.84. */
export const BLOCK_POCKET_MM = 13.93;

/**
 * The switch pocket cut under each key, centred on the origin.
 *
 * It is the MX socket asset, grown in X and Y to the 13.93 mm opening the CAD shells had (the
 * shells' pocket was exactly that: the socket scaled 1.0048 × 1.0067, cavity included), then
 * scaled again by the Socket fit setting — the same way the flat clicker's fit works, because
 * now the pocket is a subtraction here too. The opening is carried up through the plate the
 * shells kept above the socket's top face, to the well floor.
 *
 * Z is never scaled: the pocket's depth is what seats the switch.
 */
export function blockPocket(
  wasm: Wasm,
  socket: Solid,
  fitPct: number,
  floorZ: number,
  track: <T extends { delete(): void }>(o: T) => T,
): Solid {
  const top = track(socket.slice(-0.05));
  const b = top.bounds();
  const f = 1 + (fitPct || 0) / 100;
  const sx = (BLOCK_POCKET_MM / Math.max(1, b.max[0] - b.min[0])) * f;
  const sy = (BLOCK_POCKET_MM / Math.max(1, b.max[1] - b.min[1])) * f;
  const grown = track(socket.scale([sx, sy, 1]));
  if (floorZ <= 0.001) return grown;
  const opening = track(top.scale([sx, sy]));
  const riser = track(track(extrude(wasm, opening, floorZ + 0.2)).translate([0, 0, -0.1]));
  return track(grown.add(riser));
}

/** Build the keycap shell (+ stem) once, centred on the switch axis. */
function buildCapBlank(wasm: Wasm, keycap: KeycapAsset, stemFitMm: number, warnings: string[]): Solid {
  const shell = meshToSolid(wasm, keycap.shell.positions, keycap.shell.indices);
  const [ccx, ccy] = keycap.meta.center;
  const centredShell = shell.translate([-ccx, -ccy, 0]);
  shell.delete();
  if (!keycap.stem) return centredShell;

  const stemRaw = meshToSolid(wasm, keycap.stem.positions, keycap.stem.indices);
  const authored = stemRaw.translate([-ccx, -ccy, 0]);
  stemRaw.delete();
  // The same exact offset of the cross hole as the flat clicker cap (stemFit.ts). The outer
  // post and Z are untouched, so the cap's rest height never moves.
  const fit = applyStemFit(wasm, authored, stemFitMm);
  authored.delete();
  if (!fit.applied) warnings.push('Switch stem fit could not be applied. The stem prints as designed.');
  const cap = centredShell.add(fit.solid);
  centredShell.delete();
  fit.solid.delete();
  return cap;
}

/** Copy a mesh out of a solid, shifted in XY (cheap instancing for repeated caps). */
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

/** The keycap's footprint, read off the asset: its bounding box, which is square. */
function capFootprint(keycap: KeycapAsset): number {
  const bb = keycap.meta.bbox;
  const w = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]);
  return Number.isFinite(w) && w > 10 ? w : BODY_DIMS.cap;
}

export function buildBlocks(
  wasm: Wasm,
  socket: Solid,
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

  try {
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
      filled: params.blockKeys?.[i] ?? r.rings.some((ring) => ring.length >= 3),
    }));
    const filled = cells.filter((c) => c.filled);
    if (filled.length === 0) {
      return { parts, switchPlacements, warnings: ['Add a letter or a symbol to build blocks.'] };
    }
    const N = filled.length;

    // ---------- The body ----------
    const dims: KeyBodyDims = { ...BODY_DIMS, cap: capFootprint(keycap) };
    const pocket = blockPocket(wasm, socket, params.socketFitPct ?? 0, dims.floorZ, track);
    const body = buildKeyBody(wasm, filled.map((c): KeyCell => ({ row: c.row, col: c.col })), {
      style: params.blockStyle ?? 'walls',
      texture: params.blockTexture ?? 'smooth',
      dims,
      pocket,
    });
    let solid: Solid = track(body.solid);
    const pitch = body.pitch;
    const centres = body.centres;
    // From a key's centre to the outer face of the wall beside it.
    const halfCell = wellSize(dims) / 2 + dims.wall;

    const minRow = Math.min(...filled.map((c) => c.row));
    const maxRow = Math.max(...filled.map((c) => c.row));
    const minCol = Math.min(...filled.map((c) => c.col));
    const maxCol = Math.max(...filled.map((c) => c.col));
    const occupied = new Set(filled.map((c) => `${c.row},${c.col}`));
    const has = (row: number, col: number) => occupied.has(`${row},${col}`);

    // Which key carries the keyring loop: the one furthest towards the chosen side, and on a
    // tie (every key in a row shares a Y, so "top" ties across all of them) the one closest to
    // the middle, which is where a hanger looks deliberate rather than lopsided.
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

    /** Keyring loop on the outer face beside one key, or null when the keychain is off.
     *  A disc with a ring hole, welded to that face by a bridge that reaches back into the
     *  body, flush with the body's underside so the whole thing still prints flat. */
    const keychainLoop = (): Solid | null => {
      const kc = params.keychain;
      if (!kc?.enabled) return null;
      const cell = filled[loopCellIndex];
      // Prefer the face the user asked for; fall back to any free face if that one is taken
      // by a neighbour (a left-side loop on a vertical column, say).
      const free = { left: !has(cell.row, cell.col - 1), right: !has(cell.row, cell.col + 1),
                     top: !has(cell.row - 1, cell.col), bottom: !has(cell.row + 1, cell.col) };
      const order: (keyof typeof free)[] = [loopSide, 'left', 'right', 'top', 'bottom'];
      const side = order.find((s) => free[s]);
      if (!side) return null;

      const holeR = Math.max(1.5, (kc.holeDiameterMm ?? 5.2) / 2);
      const loopR = Math.max(3.2, holeR + 1.8);
      const th = Math.max(2.5, Math.min(5.0, (dims.rimZ - dims.bottomZ) * 0.3));
      const dir: [number, number] =
        side === 'right' ? [1, 0] : side === 'left' ? [-1, 0] : side === 'top' ? [0, 1] : [0, -1];
      const [kx, ky] = centres[loopCellIndex];
      /* Slide along the face — only on the face the user ASKED for (on a fallback face the
         slide would be measured along the wrong axis and walk the bridge off the body), and
         clamped to half a key: past that the bridge stops overlapping the body and the loop
         welds tangentially or not at all. A clamp that is silent is the Size-slider bug again —
         the number on the control moves and the geometry does not — so an over-run says so
         through `warnings`, which the status line shows. */
      const slideLimit = pitch / 2;
      const asked = side === loopSide ? (params.keychainSlideMm ?? 0) : 0;
      const slide = Math.max(-slideLimit, Math.min(slideLimit, asked));
      if (Math.abs(asked) > slideLimit + 0.01) {
        warnings.push(
          `The keyring can only slide ${slideLimit.toFixed(0)} mm along that side before it comes `
          + 'off the block. Move it to a different side for more room.',
        );
      }
      // Perpendicular to `dir`, so the bridge stays the same length and keeps its overlap.
      const tan: [number, number] = [-dir[1], dir[0]];
      const cx = kx + dir[0] * (halfCell + loopR) + tan[0] * slide;
      const cy = ky + dir[1] * (halfCell + loopR) + tan[1] * slide;

      const disc = track(track(CrossSection.circle(loopR, 64)).translate([cx, cy]));
      // The bridge starts inside the body (so the union is volumetric, never a tangent kiss)
      // and runs out to the loop centre.
      const bridgeLen = loopR + 3;
      const alongY = dir[1] !== 0;
      const bridge = track(
        track(CrossSection.square(alongY ? [loopR * 2, bridgeLen] : [bridgeLen, loopR * 2], true))
          .translate([cx - (dir[0] * bridgeLen) / 2, cy - (dir[1] * bridgeLen) / 2]),
      );
      const fp = track(disc.add(bridge));
      const zBottom = dims.bottomZ;
      let loop = track(track(extrude(wasm, fp, th)).translate([0, 0, zBottom]));
      // Break the tab's top and bottom rims so it reads as part of the body instead of a flat
      // sheet stuck to its side (and so the print has no sharp lip to catch on).
      const bevel = Math.min(0.6, th * 0.25);
      for (const [z, down] of [
        [zBottom + th, false],
        [zBottom, true],
      ] as [number, boolean][]) {
        const cutter = edgeBevelCutter(fp, bevel, z, down);
        if (cutter) loop = track(loop.subtract(cutter));
      }
      const hole = track(
        track(extrude(wasm, track(track(CrossSection.circle(holeR, 48)).translate([cx, cy])), th + 2))
          .translate([0, 0, zBottom - 1]),
      );
      return track(loop.subtract(hole));
    };

    /** Cutter that chamfers one horizontal rim of a prism with footprint `fp`: the space
     *  between the footprint and a copy of it shrunk by `r`, swept over `r` of height. Same
     *  single-face approach buildClicker uses for the clicker body, so the two match. */
    const edgeBevelCutter = (fp: Section, r: number, zRef: number, isBottom: boolean): Solid | null => {
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
        const shell = track(extrude(wasm, outer, r + 0.02));
        const taper = track(extrude(wasm, centred, r + 0.02, 0, 0, [(W - 2 * r) / W, (H - 2 * r) / H]));
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
    };

    /* The maker's mark, debossed into the underside — the one large, flat, support-free face.

       Under the key nearest the middle of the body, rather than at the middle of its bounding
       box, which for an L or a WASD cluster can fall outside the body altogether. Sized the
       way buildClicker sizes it, clamped to 0.6 of a key so it stays clear of the walls and of
       the corner rounding. One mark: the body is one printed piece now. */
    const debossMark = (part: Solid): Solid => {
      const mark = params.brandMark;
      if (!mark || mark.rings.length === 0) return part;
      const MARK_DEPTH = 0.6;
      const bb = part.boundingBox();
      const mx = (bb.min[0] + bb.max[0]) / 2;
      const my = (bb.min[1] + bb.max[1]) / 2;
      let [cx, cy] = centres[0];
      for (const [x, y] of centres) if (Math.hypot(x - mx, y - my) < Math.hypot(cx - mx, cy - my)) [cx, cy] = [x, y];
      const maxSide = 2 * halfCell * 0.6;
      const size = Math.min(Math.max(3, mark.sizeMm), maxSide);
      // Negated X is the mirror: the underside is read from below. One CrossSection with NonZero
      // over all rings, so counters stay holes and overlapping shapes merge — see buildClicker.
      const polys = mark.rings
        .filter((ring) => ring.length >= 3)
        .map((ring) => ring.map(([x, y]) => [-x * size + cx, y * size + cy] as [number, number]));
      if (!polys.length) return part;
      const section = track(csOf(wasm, polys, 'NonZero'));
      if (section.isEmpty()) return part;
      // From just below the underside up to MARK_DEPTH above it: the overshoot guarantees a
      // clean cut through the face rather than a coplanar one, which renders as z-fighting.
      const cut = track(track(extrude(wasm, section, MARK_DEPTH + 0.3)).translate([0, 0, bb.min[2] - 0.3]));
      return track(part.subtract(cut));
    };

    /** Covert provenance voids, identical in spirit to the ones buildClicker buries in the
     *  clicker body: each sphere is only subtracted when it lands fully inside material, so it
     *  can never break a surface. Laid out round the first key, the frame the CAD blocks had. */
    const applyIdentityVoids = (part: Solid): Solid => {
      let out = part;
      const [ox, oy] = centres[0];
      const seed = getMarkSeed();
      const all = [...(seed ? markVoids(seed) : []), ...hardcodedVoids()];
      for (const v of all) {
        const ang = (v.thetaDeg * Math.PI) / 180;
        const sphere = track(
          track(Manifold.sphere(v.d / 2, 16)).translate([
            ox + v.r * Math.cos(ang),
            oy + v.r * Math.sin(ang),
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
    };

    solid = applyIdentityVoids(solid);
    const loop = keychainLoop();
    if (loop) solid = track(solid.add(loop));
    solid = debossMark(solid);
    // One body. Named like the blocks it replaces so every `block-N` match in the app (colour
    // picking, the body palette row) still finds it.
    parts.push(meshPart(solid, [0, 0], 'body', 'base', params.bodyColorRgb, 'block-0'));
    // The switch latches on the plate under the well floor, which is where the shells had it.
    for (const [x, y] of centres) switchPlacements.push({ x, y, rotation: 0, z: dims.floorZ });

    // ---------- Keycaps + debossed letters ----------
    const capBlank = track(buildCapBlank(wasm, keycap, params.stemFitMm ?? 0, warnings));

    // Seat the cap AT REST on the switch stem: one full switch travel above the well floor.
    // The cap is carried by the stem, so if it rested on the floor the switch could never be
    // pressed. That leaves the cross fully engaged in the cap's stem tube, stopping `travel`
    // short of bottoming out on the tube's ceiling — which is exactly how far a keycap is
    // pushed onto a real MX switch.
    const capLift = dims.floorZ + Math.max(0, params.travel ?? 4);
    const cap = capLift > 0.001 ? track(capBlank.translate([0, 0, capLift])) : capBlank;

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
    // "Boldness": grow (or thin) every legend outline in the plane before it is cut. Thin
    // symbols are hairline strokes, so this is what makes them printable at all.
    const bold = Math.max(-0.35, Math.min(0.9, params.legendBold ?? 0));

    for (let i = 0; i < N; i++) {
      const cell = filled[i];
      const offset = centres[i];
      const region = cell.region;
      const b = ringsBBox(region.rings);
      const gcx = (b.minX + b.maxX) / 2;
      const gcy = (b.minY + b.maxY) / 2;

      const polys: Ring[] = [];
      for (const ring of region.rings) {
        if (ring.length < 3) continue;
        const scaled: Ring = ring.map(([x, y]) => [(x - gcx) * legendScale, (y - gcy) * legendScale]);
        if (ringArea(scaled) > 0.0005) polys.push(scaled);
      }

      let capBody: Solid = cap;
      let letterBody: Solid | null = null;

      if (polys.length === 0) {
        // A key nobody printed anything on is a blank cap, on purpose; one whose character
        // the font could not draw is worth saying.
        if (region.rings.length) warnings.push(`Letter ${i + 1} has no printable outline. Its cap is blank.`);
      } else {
        try {
          let legend = track(csOf(wasm, polys, 'NonZero'));
          if (Math.abs(bold) > 0.005) {
            const grown = track(legend.offset(bold, 'Round', 2.0, 24));
            if (!grown.isEmpty()) legend = grown;
          }
          // Deboss depth is measured from the LOWEST cap surface under the legend, so the
          // letter body is at least `debossDepth` thick everywhere despite the dish.
          const loZ = lowestSurfaceZ(cap, legend, dishBottomZ, topZ);
          const bottomZ = loZ - debossDepth;
          const prism = track(track(extrude(wasm, legend, topZ + 3 - bottomZ)).translate([0, 0, bottomZ]));
          const cut = track(cap.subtract(prism));
          const ink = track(cap.intersect(prism));
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

    return { parts, switchPlacements, warnings };
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

/** Lowest point of the cap's top surface over `legend`: the highest Z at which the cap still
 *  completely covers the legend footprint. Binary search over slices — no raycaster, and it
 *  follows whatever dish the cap profile has. */
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
