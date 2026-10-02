// The one entry point: a region, a pattern, an operation → what the laser does.
//
// Pattern space is the pattern's own frame (a cell at the origin, or a field about the
// origin). Region space is the caller's, Y up, mm. Between them sits one similarity —
// scale, rotate about the region's centre, slide — and everything the laser cares about is
// decided in region space against the region's real outline:
//
//   cut      closed shapes become holes at their drawn size — what Engrave shows is what Cut out
//            cuts. The zone is the region shrunk by the inset (at least `web`), so the edge keeps
//            its border: a hole crossing the zone's edge is clipped to it, never dropped whole.
//            The web governs every cut: two holes closer than `web` both give way by half the
//            shortfall; a hole whose neighbours are all a web off keeps its drawn size. A piece
//            under the floors (a 1 mm disc at its widest — a 0.8 mm slot, for a hole three times
//            as long as it is wide — or 2 mm²) stays wood. When too much stays wood the cut is the
//            host's (`latticeFaces`' rule 0), which refuses or says so with a zoom it has tried
//            there — building the pattern again, which is the worker's work, not this thread's.
//            A pattern with no holes of its own to punch — lines, or a fill whose shapes touch —
//            is cut as a LATTICE instead: its lines become struts `web` wide and the faces
//            between them are cut (`lattice.ts`; the result carries the recipe in `lattice`,
//            and the host's `latticeFaces` does the rest — or, where the shapes only touched
//            across a tile's seams and stand apart on one background, cuts them as motifs).
//   score    lines are clipped to the material; closed shapes are scored round as lines.
//   engrave  closed shapes are filled regions clipped to the outline; lines ride along as
//            hairline engraves.
//
// An inset shrinks the region first (a vertex offset with a mitre cap — enough for the blanks
// this fills, and it gives up cleanly on an outline it cannot shrink: a cut then measures every
// hole against the bare outline instead, a score or an engrave runs to the edge and says so).
import { EdgeIndex, clipHoleToRegion, clipIslandToRegion, clipPolylines, dedupeIslands, dropNearDuplicates, mergeLines, outlineOfRegions, trimNearEdge } from './clip';
import { bboxOfShapes, boxCentre, boxValid, isConvex, pointSegmentDistance, poleOf, ringLength, segmentDistance, segmentsIntersect, signedArea, slot as slotRing } from './geom';
import { FINGER_BAND, FINGER_LONG, FINGER_MIN, FLOORED_QUIET, FLOOR_SLACK, HELD_SHARE, KERF_WALL, LATTICE_MIN_AREA, LATTICE_MIN_WIDTH, NEAR_EMPTY, SLOT_LONG, SLOT_MIN_WIDTH, THINNEST_WOOD, betweenCuts, giveWay, latticeOf, nearestGaps, nothingReaches } from './lattice';
import { resolveParams } from './params';
import { tileGeometry } from './tiler';
import type { Box, FillOptions, FillResult, FillStats, Island, Params, PatternDef, PatternGeometry, Pt, Polyline, Ring, Shapes } from './types';

const DEFAULT_WEB = 1.5;

export function fillShape(region: Shapes, def: PatternDef, opts: FillOptions): FillResult {
  const warnings: string[] = [];
  const stats: FillStats = { cells: 0, holes: 0, dropped: 0, lines: 0, lineLength: 0, area: 0, unclipped: 0, struts: 0 };
  const op = opts.op;
  const empty = (): FillResult => ({ op, shapes: [], paths: [], stats, warnings });

  const live = region.map((i) => i.filter((r) => r.length >= 3)).filter((i) => i.length > 0);
  const box = bboxOfShapes(live);
  if (!live.length || !boxValid(box)) return empty();
  const p = resolveParams(def, opts.params);
  // Every pattern can be cut — as holes when it lists `cut`, as a lattice when it does not.
  if (!def.ops.includes(op) && op !== 'cut') warnings.push(`${def.name} is meant to be ${def.ops.join(' or ')}, not ${op}.`);

  // ---- the similarity between pattern space and region space ----
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const theta = ((opts.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const c = boxCentre(box);
  const align = opts.align ?? 'centre';
  const o: Pt = align === 'centre' ? c : [box.minX, box.minY];
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  const toRegion = ([x, y]: Pt): Pt => {
    const px = x * scale + (o[0] - c[0]);
    const py = y * scale + (o[1] - c[1]);
    return [c[0] + px * cos - py * sin + dx, c[1] + px * sin + py * cos + dy];
  };
  const toPattern = ([x, y]: Pt): Pt => {
    const rx = x - c[0] - dx;
    const ry = y - c[1] - dy;
    const px = rx * cos + ry * sin;
    const py = -rx * sin + ry * cos;
    return [(px - (o[0] - c[0])) / scale, (py - (o[1] - c[1])) / scale];
  };
  const regionCorners: Pt[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  const corners = regionCorners.map(toPattern);
  const pbox: Box = {
    minX: Math.min(...corners.map((q) => q[0])),
    minY: Math.min(...corners.map((q) => q[1])),
    maxX: Math.max(...corners.map((q) => q[0])),
    maxY: Math.max(...corners.map((q) => q[1])),
  };

  // ---- generate ----
  let geo: PatternGeometry;
  if (def.tile && def.cell) {
    const t = tileGeometry(def, p, pbox, align === 'centre');
    stats.cells = t.cells;
    if (t.overflow) {
      warnings.push(`${def.name} at this size would need ${t.cells.toLocaleString()} cells — make it larger.`);
      return empty();
    }
    geo = t.geo;
  } else if (def.generate) {
    geo = def.generate(pbox, p);
  } else return empty();

  // Rings with no area (a dot flattened to a line) are not shapes; an island whose outer is one
  // is nothing at all.
  const holes = dedupeIslands(
    geo.holes
      .map((i) => i.map((r) => r.map(toRegion)).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6))
      .filter((i) => i.length > 0),
  );
  const lines = mergeLines(geo.lines.map((l) => l.map(toRegion)));
  const slits = mergeLines(geo.slits.map((l) => l.map(toRegion)));

  const web = Math.max(0, opts.web ?? DEFAULT_WEB);

  // ---- cut as a lattice ----
  // Nothing of its own to punch — a pattern of lines, or shapes that touch (a measured web of
  // 0: cut out, the material between them would go and whatever they enclose would drop out) —
  // so the drawing a Score burns becomes the struts: the lines, and the outline of the shapes
  // (an edge two cells share cancels, one where shapes cross stays). Before the inset, which the
  // host does with a real boolean (a mitred vertex offset folds on a card's rounded corner, and
  // then the faces would run to the edge).
  const asLattice = (withLines = true): FillResult => {
    // The shapes' outline is traced by the host, off this thread (`LatticeCut.outlines`).
    // The pattern's own solids (a hub for rays to land on), in region space like the rest — less
    // any whose middle a reserve already covers: the lines land on the reserve there, and a hub
    // bigger than the reserve would bulge out of it as a boss of plain wood (Rays at 200 % under
    // a card's panel).
    const reserves = live.flatMap((island) => island.slice(1));
    const solids = (geo.solids ?? []).map((i) => i.map((r) => r.map(toRegion))).filter((i) => i.length > 0)
      .filter((i) => { const m = boxCentre(bboxOfShapes([i])); return !reserves.some((r) => pointInRingFast(m, r)); });
    const cell = def.tile ? def.cell?.(p) : undefined;
    const period = cell ? Math.min(cell.w, cell.h) * scale : undefined;
    // A pattern of shapes (no line of it on the region) also hands over its shapes whole, as
    // Engrave draws them, and a pattern drawn in strokes the width Engrave burns them at: the host
    // cuts either as motifs where they stand apart on one background (`latticeFaces`' rule 0).
    // (A hole cut handed over to say why is its holes alone, as the hole path read them.)
    const stroke = withLines && def.strokeWidth ? opts.strokeWidth ?? def.strokeWidth(p) : 0;
    const ink = withLines ? lines : [];
    // A library tile's lines with no stroke are hairlines: the shapes they close may be motifs.
    const hairline = !!def.source && !(stroke > 0) && ink.length > 0;
    const made = latticeOf(ink, live, { name: def.name, web, inset: opts.inset ?? web, outlines: holes.flat(), solids, scale, origin: toRegion([0, 0]), ...(period ? { period } : {}), ...(holes.length ? { shapes: holes } : {}), ...(stroke > 0 ? { stroke } : {}), ...(hairline ? { hairline } : {}), ...(withLines ? {} : { holes: true, ...(def.tile ? {} : { field: true }) }), ...(stroke > 0 || hairline ? { drawn: { lines: geo.lines, c, o, cos, sin, d: [dx, dy] as Pt } } : {}), ...(opts.thinnest ? { thinnest: opts.thinnest } : {}) });
    if (!made) {
      warnings.push(nothingReaches(def.name));
      return empty();
    }
    stats.struts = made.runs.length;
    for (const run of made.runs) stats.lineLength += ringLength(run, false);
    return { op, shapes: [], paths: [], lattice: made.cut, stats, warnings };
  };
  if (op === 'cut' && !slits.length) {
    const wanted = def.web?.(p);
    const touching = wanted !== undefined && wanted <= 1e-6;
    if (touching || !def.ops.includes('cut') || !holes.length) return asLattice();
  }

  // ---- the region to clip against ----
  const inset = Math.max(0, opts.inset ?? (op === 'cut' ? web : 0));
  let clipRegion = live;
  // A cut on an outline the vertex offset cannot shrink (a card whose 3 mm corners are rounder
  // than a 4 mm margin: the offset folds there) still keeps its margin: the holes are clipped to
  // the bare outline and every one that comes nearer its edge than the margin is dropped
  // (`marginOf`). Exact, where the offset was only ever an approximation, so nothing to say.
  let marginOf: EdgeIndex | null = null;
  if (inset > 0) {
    const shrunk = insetShapes(live, inset);
    if (shrunk) clipRegion = shrunk;
    else if (op === 'cut') marginOf = new EdgeIndex(live);
    else warnings.push(`Could not keep a ${inset} mm margin on this outline; the pattern runs to the edge.`);
  }
  const index = new EdgeIndex(clipRegion);
  const partial = opts.partial ?? 'clip';

  // ---- closed shapes ----
  const shapes: Shapes = [];
  // For a cut: which of `holes` each of `shapes` came from, and whether the zone's edge clipped it.
  const sourceOf: number[] = [];
  const clippedOf: boolean[] = [];
  const scoredRings: Ring[] = [];
  // A score the host traces (`hostOutline`): the shapes whose painted region's outline it scores.
  const outlined: Island[] = [];
  let hostClips = false;
  for (let k = 0; k < holes.length; k++) {
    const island = holes[k]!;
    const outer = island[0]!;
    const mark = (clipped: boolean) => { while (sourceOf.length < shapes.length) { sourceOf.push(k); clippedOf.push(clipped); } };
    const state = classify(outer, index);
    if (state === 'outside') {
      stats.dropped++;
      continue;
    }
    if (op === 'score') {
      if (opts.hostOutline) outlined.push(island);
      else for (const r of island) scoredRings.push(r);
      continue;
    }
    if (state === 'inside') {
      if (marginOf && outer.some((a, i) => marginOf!.segmentDistance(a, outer[(i + 1) % outer.length]!, inset) < inset)) {
        stats.dropped++;
        continue;
      }
      if (op === 'cut' && island.length > 1) {
        // An annulus cut out drops its middle on the bed; cut the outer only.
        shapes.push([outer]);
      } else shapes.push(island);
      mark(false);
      continue;
    }
    // Crossing the (inset) edge. A cut clips it there too, as an engrave does: the shape Engrave
    // shows is the hole Cut out makes, and the zone is already a border in from the outline. Where
    // the inset folded there is no zone's edge to clip to, and it goes, as a whole hole nearer the
    // outline than the margin does.
    if (partial === 'drop' || (op === 'cut' && marginOf)) {
      stats.dropped++;
      continue;
    }
    if (partial === 'keep') {
      shapes.push(island);
      mark(false);
      continue;
    }
    if (op === 'cut') {
      const pieces = clipCut(outer, clipRegion, index);
      // (Not when the pattern's lines reach the region: the host would cut those as a lattice.)
      if (!pieces && !clipPolylines(lines, new EdgeIndex(live)).length) {
        hostClips = true;
        break;
      }
      if (pieces?.length) {
        shapes.push(...pieces);
        mark(true);
        stats.clipped = (stats.clipped ?? 0) + pieces.length;
      } else stats.dropped++;
      continue;
    }
    if (island.length === 1 && isConvex(outer)) {
      const clipped = clipHoleToRegion(outer, clipRegion);
      if (clipped.length) shapes.push(...clipped);
      else stats.dropped++;
      continue;
    }
    // Any other shape: the general intersection, and the host's boolean or the whole shape
    // only when a degenerate crossing defeats it.
    const general = clipIslandToRegion(island, index);
    if (general) {
      if (general.length) shapes.push(...general);
      else stats.dropped++;
    } else if (opts.clipPolygons) {
      const clipped = opts.clipPolygons([island], clipRegion);
      if (clipped.length) shapes.push(...clipped);
      else stats.dropped++;
    } else {
      // Whole, and the result says where it must be trimmed (`zone`): handed on as it is, an
      // island the clip gave up on was engraved into the border.
      shapes.push(island);
      stats.unclipped++;
    }
  }

  // A concave hole the clip could not take (a crossing on a vertex): the host's booleans clip the
  // whole pattern instead, as motifs (`latticeFaces`' rule 0) — still what Engrave shows.
  if (hostClips) {
    stats.dropped = 0;
    stats.unclipped = 0;
    delete stats.clipped;
    return asLattice();
  }

  // The web, then the floors, for a cut's holes (a hinge's slits come after, and cannot give way).
  const notes: string[] = [];
  if (op === 'cut' && shapes.length) {
    const block = def.tile && def.cell && !slits.length ? tileBlock(def, p, scale) : null;
    // A clipped hole that gives way is shrunk whole and clipped again: its side along the zone's
    // edge faces the border, not another cut.
    const reclip = (k: number, d: number): Shapes | null => {
      const source = holes[k]![0]!;
      const smaller = insetShapes([[source]], d)?.[0]?.[0];
      if (!smaller || Math.abs(signedArea(smaller)) < 1e-6) {
        return !isConvex(source) && widest([source], d + SLOT_MIN_WIDTH / 2) > d + SLOT_MIN_WIDTH / 2 ? null : [];
      }
      const state = classify(smaller, index);
      if (state === 'inside') return [[smaller]];
      return state === 'outside' ? [] : clipCut(smaller, clipRegion, index);
    };
    // (A hinge's slits are its pattern, a kerf wide by design: no finger rule for a hinge.)
    const held = holdHoles(shapes, sourceOf, clippedOf, holes, reclip, block, web, slits.length ? 0 : Math.max(THINNEST_WOOD, opts.thinnest ?? THINNEST_WOOD));
    // (With no web — a thumbnail — there is nothing to say: the holes are the drawing.)
    if (held === 'host' || (held.says && web > 0)) {
      // The host's (`latticeFaces`' rule 0), in the worker: two holes closer than a kerf wall are
      // joined where they touch and held a web apart where they do not, and a hole that must give
      // way but is not a plain convex one shrinks true only with booleans — as does a hole that may
      // hold a finger of wood (round 7); and a cut that must say why — too small, too tight, parts
      // left as wood — says it with a zoom tried there, which is building the pattern again: the
      // worker's work, never this thread's (the editor builds its template here, on every change).
      stats.dropped = 0;
      stats.unclipped = 0;
      delete stats.clipped;
      return asLattice(held === 'host');
    }
    stats.tooSmall = held.tooSmall;
    if (held.gaveWay) stats.gaveWay = held.gaveWay;
    shapes.splice(0, shapes.length, ...held.kept);
  }

  // ---- lines ----
  let paths: Polyline[] = [];
  // Which cut each of `shapes` is, once a hinge's slits come back as slots: a slit is a slot per
  // straight run, abutting end to end, and a cross hinge's two arms cross by design — each is ONE
  // opening, with no wall inside it to measure. The holes before them are each their own.
  let cutOf: number[] | undefined;
  if (op === 'cut') {
    if (slits.length) {
      // Clipped to the bare outline when the inset folded, so the whole margin is trimmed here.
      const kept = trimNearEdge(clipPolylines(slits, index), index, marginOf ? Math.max(inset, web) : Math.max(0, web - inset));
      if (opts.slitWidth && opts.slitWidth > 0) {
        const cuts = slitCuts(kept, opts.slitWidth + MEET);
        cutOf = shapes.map((_, i) => -1 - i);
        kept.forEach((run, i) => {
          for (const s of slitsToSlots(run, opts.slitWidth!)) {
            shapes.push([s]);
            cutOf!.push(cuts[i]!);
          }
        });
      } else paths = kept;
    }
  } else {
    // (A line a tile draws twice a few microns off itself would be burnt twice.)
    const wanted: Polyline[] = [...dropNearDuplicates(lines), ...slits];
    paths = clipPolylines(wanted, index);
    if (op === 'score' && scoredRings.length) {
      // The boundary of the UNION of the regions, not every region's own outline: a tiled fill
      // is built cell by cell, so a motif crossing a cell boundary leaves both cells carrying
      // that edge, and tracing them one by one burns a grid straight through the pattern. See
      // `outlineOfRegions`. Clipped to the material afterwards, as lines — a scored region and a
      // scored line are the same burn, and the outline is no longer one loop per island anyway.
      paths.push(...clipPolylines(outlineOfRegions(scoredRings), index));
    }
    if (op === 'engrave') {
      // Engraved lines are burnt as bands when a width is known: a quad per segment and a
      // disc at every joint and end, overlapping where they meet — the host's union makes
      // them one region, and a same-colour fill reads as one anyway.
      const width = opts.strokeWidth ?? def.strokeWidth?.(p) ?? 0;
      if (width >= 0.1 && paths.length) {
        for (const run of paths) for (const band of bandsOf(run, width)) shapes.push([band]);
        paths = [];
      }
    }
  }

  // A hinge's slits are a kerf wide — nothing to give way: where two cuts of it come closer than
  // the web asked for (its slots between one opening and another, `cutOf`), the sentence says so.
  if (op === 'cut' && slits.length && shapes.length > 1) {
    const wall = narrowestWall(shapes.map((island) => island[0]!), web, cutOf);
    if (wall < web - 1e-3) notes.push(betweenCuts(def.name, wall));
  }
  warnings.push(...notes);

  stats.holes = shapes.length;
  stats.lines = paths.length;
  for (const line of paths) stats.lineLength += ringLength(line, false);
  for (const island of shapes) {
    if (op === 'score') stats.lineLength += ringLength(island[0]!, true);
    else for (let i = 0; i < island.length; i++) stats.area += (i === 0 ? 1 : -1) * Math.abs(signedArea(island[i]!));
  }
  if (op === 'cut' && stats.unclipped === 0 && stats.holes === 0 && stats.lines === 0) {
    if (slits.length) warnings.push(`Nothing of ${def.name} fits inside this shape with a ${round(web)} mm web — shrink the pattern or the web.`);
    else if (holes.length) warnings.push(nothingReaches(def.name));
  }
  const result: FillResult = { op, shapes, paths, stats, warnings };
  if (outlined.length) result.outline = { shapes: outlined, zone: clipRegion };
  if (op === 'engrave' && stats.unclipped) result.zone = clipRegion;
  const erode = op === 'cut' ? 0 : (def.erode?.(p) ?? 0) * scale;
  if (erode > 0) result.erode = erode;
  return result;
}

/**
 * A cut's holes held to the web and the floors — the hole path's rule 0 (`motifCut` is the host's).
 * Where two holes come closer than `web`, both give way by half the shortfall, all round
 * (`giveWay`); a hole whose neighbours are all a web off keeps its drawn size, and a hole's wall with
 * itself is no wall between two cuts. A hole under the floors at its drawn size (`holeFloors`) stays
 * wood, so nothing gives way to it; and once the floors have left a hole that gave way as wood, the
 * web is held again among the holes that are cut, so a hole that gave way to it alone takes its
 * drawn size back. `says` when the cut must say why: no hole above the floors, fewer than
 * `HELD_SHARE` of those that were held to the web, under `NEAR_EMPTY` of what is drawn, or more than
 * `FLOORED_QUIET` of it left as wood — `fillShape` hands such a cut to the host, which says it with a
 * zoom it has tried. The shares count the pattern's WHOLE holes, when one of them is above the
 * floors: a sliver the zone's edge clipped off is the edge's, at any zoom. When none is — a narrow
 * zone where every hole big enough to cut crosses its edge, and only the crumbs between them are
 * whole (Octagons & squares on the framed card) — they count every hole.
 * 'host' when two holes are closer than a kerf wall (the host's booleans join them where they touch,
 * and hold the web between them where they do not), or a hole that must give way is not a plain
 * convex one. `block` is one cell of a tile among its neighbours: when it holds the web, every hole
 * does. A hole the zone's edge clipped gives way whole and is clipped again (`reclip`): its side along
 * the edge faces the border, not another cut. Round 7: a hole above the floors that looks to hold a
 * finger of wood thinner than `thinnest` (`fingerLike`: a comb's, never the V between a star's
 * points) is handed over to say why (`says`): rule 0 finds its fingers with the host's booleans and
 * cuts it only where it holds the slot. (`thinnest` 0: a hinge's, exempt.)
 */
function holdHoles(shapes: Shapes, sourceOf: number[], clippedOf: boolean[], holes: Shapes, reclip: (k: number, d: number) => Shapes | null,
  block: Ring[] | null, web: number, thinnest: number):
  'host' | { kept: Shapes; tooSmall: number; gaveWay: number; says: boolean } {
  const least = (gaps: number[]) => gaps.reduce((m, g) => Math.min(m, g), Infinity);
  const blockHolds = !!block && least(nearestGaps(block, web).gap) >= web - 1e-3;
  // Two holes closer than a kerf wall: the host's, to join where they touch and hold apart elsewhere.
  if (!blockHolds && closePairs(shapes.map((island) => island[0]!), KERF_WALL, measurer(KERF_WALL)).length) return 'host';
  // One unit per hole of the pattern: its pieces on the zone (one, or the pieces a clip left), and
  // whether it is above the floors as drawn.
  type Unit = { k: number; drawn: Island[]; clipped: boolean; ok: boolean; gap: number; now: Island[]; exact: boolean };
  const byHole = new Map<number, Unit>();
  shapes.forEach((island, i) => {
    const k = sourceOf[i] ?? -1 - i;
    const u = byHole.get(k) ?? { k, drawn: [], clipped: false, ok: false, gap: Infinity, now: [], exact: true };
    u.drawn.push(island);
    u.clipped ||= !!clippedOf[i];
    byHole.set(k, u);
  });
  const units = [...byHole.values()];
  const sourceRing = (u: Unit): Ring => (u.k >= 0 ? holes[u.k]![0]! : u.drawn[0]![0]!);
  // (Each island's floors found once: a hole that does not give way is asked again as it was drawn.)
  const floorsOf = new Map<Island, boolean>();
  const floors = (island: Island, clipped: boolean): boolean => {
    let v = floorsOf.get(island);
    if (v === undefined) floorsOf.set(island, (v = holeFloors(island, clipped)));
    return v;
  };
  for (const u of units) {
    u.now = u.drawn;
    u.ok = u.drawn.some((island) => floors(island, u.clipped));
  }
  const cut = units.filter((u) => u.ok);
  // (With no web — a thumbnail — the holes are the drawing, fingers and all. A tile's holes are copies
  // of a few shapes: each asked once.)
  const combs = new Map<string, boolean>();
  const comb = (ring: Ring): boolean => {
    if (isConvex(ring)) return false;
    const key = `${ring.length},${Math.round(signedArea(ring) * 1e4)},${Math.round(ringLength(ring, true) * 1e4)}`;
    let v = combs.get(key);
    if (v === undefined) combs.set(key, (v = fingerLike(ring, thinnest)));
    return v;
  };
  if (web > 0 && thinnest > 0 && cut.some((u) => u.drawn.some((island) => comb(island[0]!)))) return { kept: [], tooSmall: 0, gaveWay: 0, says: true };
  // Every two holes to cut that come closer than the web, as drawn — found once: a hole that gives
  // way only moves away, so in any pass a hole's nearest other cut is among them.
  const rings: Ring[] = [];
  const owner: Unit[] = [];
  for (const u of cut) for (const island of u.drawn) {
    rings.push(island[0]!);
    owner.push(u);
  }
  const measure = measurer(web);
  const close = blockHolds ? [] : closePairs(rings, web, measure);
  // What each hole shrinks to, by how much — kept: a second pass asks most of them again.
  const shrunk = new Map<string, Island[] | null>();
  const shrink = (u: Unit, source: Ring, d: number): Island[] | null => {
    const key = `${u.k}:${d}`;
    if (shrunk.has(key)) return shrunk.get(key)!;
    let out: Island[] | null;
    if (u.clipped && u.k >= 0) out = reclip(u.k, d);
    else {
      const smaller = insetShapes([[source]], d)?.[0]?.[0];
      if (smaller && Math.abs(signedArea(smaller)) > 1e-6) out = [[smaller]];
      else out = !isConvex(source) && widest([source], d + SLOT_MIN_WIDTH / 2) > d + SLOT_MIN_WIDTH / 2 ? null : [];
    }
    shrunk.set(key, out);
    return out;
  };
  // The web among `among`, the holes that are cut: each one's nearest other, as far as the web, and
  // what it shrinks to. The number that gave way, or 'host'.
  const hold = (among: Set<Unit>): number | 'host' => {
    for (const u of units) {
      u.gap = Infinity;
      u.now = u.drawn;
      u.exact = true;
    }
    for (const q of close) {
      const a = owner[q.i]!;
      const b = owner[q.j]!;
      if (!among.has(a) || !among.has(b)) continue;
      a.gap = Math.min(a.gap, q.d);
      b.gap = Math.min(b.gap, q.d);
    }
    let gave = 0;
    for (const u of among) {
      const d = giveWay(u.gap, web);
      if (d <= 0) continue;
      const source = sourceRing(u);
      if (u.k < 0 && u.drawn[0]!.length > 1) return 'host';
      gave++;
      // A hole shrinks along its bisectors — exactly, when it is convex and no corner of it is
      // sharper than the mitre cap (`insetExact`); one that shrinks away is under the floors. One the
      // vertex offset cannot shrink although it is wide enough to stay — a concave hole that would
      // part in two — is the host's.
      u.exact = insetExact(source);
      const pieces = shrink(u, source, d);
      if (!pieces) return 'host';
      u.now = pieces;
    }
    // Two holes that shrank exactly are a web apart (each half the shortfall inside its drawn
    // outline); where either did not, the mitre cap or a notch may leave them under the web after
    // all, and the host's booleans shrink them true. (Only two that were closer than the web can be.)
    if (gave) {
      for (const q of close) {
        const a = owner[q.i]!;
        const b = owner[q.j]!;
        if (!among.has(a) || !among.has(b) || (a.now === a.drawn && b.now === b.drawn) || (a.exact && b.exact)) continue;
        for (const x of a.now) for (const y of b.now) if (x !== y && measure(x[0]!, y[0]!) < web - 0.01) return 'host';
      }
    }
    return gave;
  };
  let cutting = new Set(cut);
  const passing = (u: Unit): Island[] => (cutting.has(u) ? u.now.filter((island) => floors(island, u.clipped)) : []);
  let gaveWay = hold(cutting);
  if (gaveWay === 'host') return 'host';
  const cutNow = cut.filter((u) => passing(u).length > 0);
  if (gaveWay && cutNow.length < cut.length) {
    // Given way to holes the floors then left as wood: held again among those that are cut.
    // (Giving way less only grows a hole; should one fall under the floors all the same — an
    // offset's arcs — the first pass stands.)
    const first = new Map(units.map((u) => [u, u.now] as const));
    const again = hold(new Set(cutNow));
    if (again === 'host') return 'host';
    if (cutNow.every((u) => passing(u).length > 0)) {
      gaveWay = again;
      cutting = new Set(cutNow);
    } else for (const u of units) u.now = first.get(u)!;
  }
  const kept: Shapes = [];
  const scored = units.map((u) => {
    const pass = passing(u);
    kept.push(...pass);
    return { u, drawnOk: u.ok, survived: pass.length > 0, drawnArea: u.drawn.reduce((s, i) => s + islandArea(i), 0), keptArea: pass.reduce((s, i) => s + islandArea(i), 0) };
  });
  const whole = scored.filter((x) => !x.u.clipped);
  const judge = whole.some((x) => x.drawnOk) ? whole : scored;
  const before = judge.filter((x) => x.drawnOk).length;
  const heldBefore = judge.filter((x) => x.drawnOk && x.survived).length;
  const drawnArea = judge.reduce((s, x) => s + x.drawnArea, 0);
  const keptArea = judge.reduce((s, x) => s + x.keptArea, 0);
  const lostArea = judge.reduce((s, x) => s + (x.survived ? 0 : x.drawnArea), 0);
  const out = { kept, tooSmall: scored.filter((x) => !x.survived).length, gaveWay };
  if (!before || heldBefore < HELD_SHARE * before || keptArea < NEAR_EMPTY * drawnArea) return { ...out, kept: [], says: true };
  // Said when more than `FLOORED_QUIET` of the whole holes stays wood — or of all the holes on the
  // zone, clipped ones too (they are the edge's one by one, not when they are most of the pattern).
  const allArea = scored.reduce((s, x) => s + x.drawnArea, 0);
  const lostAll = scored.reduce((s, x) => s + (x.survived ? 0 : x.drawnArea), 0);
  return { ...out, says: lostArea > FLOORED_QUIET * drawnArea || lostAll > FLOORED_QUIET * allArea };
}

/** Two rings' least distance, as far as `cap` — once for each two shapes and the step between them:
 *  a tile's holes are copies, and so are most of their pairs. */
function measurer(cap: number): (a: Ring, b: Ring) => number {
  const measured = new Map<string, number>();
  return (a, b) => {
    const k = `${a.length},${Math.round(signedArea(a) * 1e4)},${b.length},${Math.round(signedArea(b) * 1e4)},${Math.round((b[0]![0] - a[0]![0]) * 1e4)},${Math.round((b[0]![1] - a[0]![1]) * 1e4)}`;
    let d = measured.get(k);
    if (d === undefined) measured.set(k, (d = ringGap(a, b, cap)));
    return d;
  };
}

/** Every two rings closer than `limit`, and how close: pairs whose boxes come that near, found
 *  through a grid of the boxes, then measured edge to edge (`measure`). */
function closePairs(rings: Ring[], limit: number, measure: (a: Ring, b: Ring) => number): { i: number; j: number; d: number }[] {
  const boxes = rings.map((r) => bboxOfShapes([[r]]));
  const size = Math.max(limit, Math.sqrt(boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0) / Math.max(1, boxes.length)));
  const grid = new Map<number, number[]>();
  boxes.forEach((b, i) => {
    for (let x = Math.floor((b.minX - limit / 2) / size); x <= Math.floor((b.maxX + limit / 2) / size); x++) {
      for (let y = Math.floor((b.minY - limit / 2) / size); y <= Math.floor((b.maxY + limit / 2) / size); y++) {
        const k = x * 1048576 + y;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  const out: { i: number; j: number; d: number }[] = [];
  const seen = new Set<number>();
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = Math.min(list[x]!, list[y]!);
        const j = Math.max(list[x]!, list[y]!);
        const key = i * rings.length + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = boxes[i]!;
        const B = boxes[j]!;
        if (A.maxX + limit < B.minX || B.maxX + limit < A.minX || A.maxY + limit < B.minY || B.maxY + limit < A.minY) continue;
        const d = measure(rings[i]!, rings[j]!);
        if (d < limit) out.push({ i, j, d });
      }
    }
  }
  return out;
}

/** Does the vertex offset shrink this ring exactly (`insetShapes`)? When it is convex and turns no
 *  corner sharper than the mitre cap's (3d: an inside angle of 39°). */
function insetExact(ring: Ring): boolean {
  if (!isConvex(ring)) return false;
  let prev: Pt | null = null;
  const n = ring.length;
  for (let i = 0; i <= n; i++) {
    const a = ring[i % n]!;
    const b = ring[(i + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    if (prev && prev[0] * u[0] + prev[1] * u[1] < MITRE_TURN) return false;
    prev = u;
  }
  return true;
}
/** The cosine of the sharpest turn the vertex offset's mitre takes uncapped: cos 141°. */
const MITRE_TURN = -0.777;

/** A hole's floors: 2 mm², and a 1 mm disc at its widest — the studio's own; a whole hole
 *  `SLOT_LONG` times as long as it is wide may be a slot `SLOT_MIN_WIDTH` wide instead (a sliver the
 *  zone's edge clipped may not: it must hold the disc). */
function holeFloors(island: Island, clipped: boolean): boolean {
  const area = islandArea(island);
  if (area < LATTICE_MIN_AREA) return false;
  const disc = LATTICE_MIN_WIDTH / 2 - FLOOR_SLACK;
  const slot = SLOT_MIN_WIDTH / 2 - FLOOR_SLACK;
  // A convex hole (a dot, a slot, a hexagon) is answered exactly, shrunk by each floor in turn;
  // its widest disc is looked for only when it is a slot at best.
  if (island.length === 1 && isConvex(island[0]!)) {
    if (convexInsetArea(island[0]!, disc) > SHRUNK_MIN) return true;
    if (clipped || !(convexInsetArea(island[0]!, slot) > SHRUNK_MIN)) return false;
    // Its widest disc lies between the two floors: found by halves, shrinking it (a hundred-
    // thousandth of a millimetre in a dozen steps).
    let lo = slot;
    let hi = disc + FLOOR_SLACK;
    for (let step = 0; step < 12; step++) {
      const mid = (lo + hi) / 2;
      if (convexInsetArea(island[0]!, mid) > 0) lo = mid;
      else hi = mid;
    }
    return area >= SLOT_LONG * (2 * lo) ** 2;
  }
  // Its widest disc, found once, as far as either floor needs to know.
  const r = widest(island, disc + PLAIN);
  if (holdsCut(island, r, LATTICE_MIN_WIDTH)) return true;
  return !clipped && holdsCut(island, r, SLOT_MIN_WIDTH) && area >= SLOT_LONG * (2 * r) ** 2;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The least wood between two of the holes a cut punches — `rings`, their outer rings, each against
 * every other, and each against ITSELF where it comes back round a finger of wood (a bauble whose
 * two halves meet at the tips of a zigzag band: the band hangs on those tips) — looking no further
 * than `limit`: Infinity when none come that close. Holes are paired through a grid of their
 * boxes, and only a pair whose boxes come within the best so far is measured. With `cut` (which
 * opening each ring is part of: a hinge's slots), two rings of one opening are not a wall, and a
 * slot never comes back round on itself — only a hole (a negative `cut`) is tried against itself.
 */
function narrowestWall(rings: Ring[], limit: number, cut?: number[]): number {
  const items = rings.map((r, i) => ({ r, box: bboxOfShapes([[r]]), cut: cut?.[i] ?? -1 - i })).filter((it) => it.r && it.r.length >= 3);
  if (!items.length) return Infinity;
  const size = Math.max(limit, Math.sqrt(items.reduce((s, it) => s + (it.box.maxX - it.box.minX) * (it.box.maxY - it.box.minY), 0) / items.length));
  const grid = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (let x = Math.floor((it.box.minX - limit / 2) / size); x <= Math.floor((it.box.maxX + limit / 2) / size); x++) {
      for (let y = Math.floor((it.box.minY - limit / 2) / size); y <= Math.floor((it.box.maxY + limit / 2) / size); y++) {
        const k = `${x},${y}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  let best = limit;
  const gap = (a: Box, b: Box) => Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY);
  const seen = new Set<number>();
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = Math.min(list[x]!, list[y]!);
        const j = Math.max(list[x]!, list[y]!);
        const key = i * items.length + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = items[i]!;
        const B = items[j]!;
        if (A.cut === B.cut || gap(A.box, B.box) >= best) continue;
        best = Math.min(best, ringGap(A.r, B.r, best));
      }
    }
  }
  for (const it of items) if (it.cut < 0) best = Math.min(best, selfGap(it.r, best));
  return best < limit ? best : Infinity;
}

/**
 * Which opening each slit cuts, by index: its own, unless its SLOT touches another's — the
 * centrelines closer than `reach`, a slot's width and a hair: a cross hinge's two arms, one
 * plus-shaped opening by design; two slits that meet end to end in an L at a panel's corner; or
 * pieces of one wavy slit (`mergeLines` groups segments by their line rounded to 5 µm and rebuilds
 * each on the first line of its group, so a wave or a serpentine comes back as runs a few microns
 * off each other: the same slot, cut twice). Slits that only come NEAR each other stay two
 * openings, and the wood between them is a wall like any other.
 */
function slitCuts(runs: Polyline[], reach = MEET): number[] {
  const root = runs.map((_, i) => i);
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = root[root[i]!]!;
    return i;
  };
  const boxes = runs.map((r) => bboxOfShapes([[r]]));
  const size = Math.max(1, Math.sqrt(boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0) / Math.max(1, boxes.length)));
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let x = Math.floor((b.minX - reach) / size); x <= Math.floor((b.maxX + reach) / size); x++) {
      for (let y = Math.floor((b.minY - reach) / size); y <= Math.floor((b.maxY + reach) / size); y++) {
        const list = grid.get(`${x},${y}`);
        if (list) list.push(i);
        else grid.set(`${x},${y}`, [i]);
      }
    }
  });
  const meet = (a: Polyline, b: Polyline): boolean => {
    for (let i = 0; i + 1 < a.length; i++) {
      for (let j = 0; j + 1 < b.length; j++) if (segmentDistance(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!) < reach) return true;
    }
    return false;
  };
  const seen = new Set<number>();
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = Math.min(list[x]!, list[y]!);
        const j = Math.max(list[x]!, list[y]!);
        if (seen.has(i * runs.length + j)) continue;
        seen.add(i * runs.length + j);
        const A = boxes[i]!;
        const B = boxes[j]!;
        if (A.maxX + reach < B.minX || B.maxX + reach < A.minX || A.maxY + reach < B.minY || B.maxY + reach < A.minY) continue;
        if (find(i) !== find(j) && meet(runs[i]!, runs[j]!)) root[find(i)] = find(j);
      }
    }
  }
  return runs.map((_, i) => find(i));
}

/** Two slits' centrelines closer than this are one opening, mm: over the few microns
 *  `mergeLines`' rounding moves a piece of a slit (measured: 2.4–2.7 µm on the wave and spring
 *  hinges), a tenth of the closest two slits any hinge draws apart (0.2 mm: honeycomb's least
 *  corner web at the least zoom). */
const MEET = 0.02;

/** The least distance between two rings, or `cap` when it is no less. */
function ringGap(a: Ring, b: Ring, cap: number): number {
  let best = cap;
  const bb = bboxOfShapes([[b]]);
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    if (Math.min(p[0], q[0]) - bb.maxX >= best || bb.minX - Math.max(p[0], q[0]) >= best || Math.min(p[1], q[1]) - bb.maxY >= best || bb.minY - Math.max(p[1], q[1]) >= best) continue;
    for (let j = 0; j < b.length; j++) {
      const d = segmentDistance(p, q, b[j]!, b[(j + 1) % b.length]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/** The least wood across which a ring comes back to itself — two of its sides more than four
 *  `cap`s apart round it, with wood between them — or `cap`. A small hole has no such sides. */
function selfGap(r: Ring, cap: number): number {
  const at: number[] = [0];
  for (let i = 1; i <= r.length; i++) at.push(at[i - 1]! + Math.hypot(r[i % r.length]![0] - r[i - 1]![0], r[i % r.length]![1] - r[i - 1]![1]));
  const perimeter = at[r.length]!;
  if (perimeter < 8 * cap) return cap;
  let best = cap;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    for (let j = i + 2; j < r.length; j++) {
      const round = at[j]! - at[i]!;
      if (Math.min(round, perimeter - round) < 4 * cap) continue;
      const c = r[j]!;
      const e = r[(j + 1) % r.length]!;
      const d = segmentDistance(a, b, c, e);
      if (d >= best) continue;
      if (pointInRingFast([(a[0] + b[0] + c[0] + e[0]) / 4, (a[1] + b[1] + c[1] + e[1]) / 4], r)) continue;
      best = d;
    }
  }
  return best;
}

/**
 * Round 7 in plain arithmetic, for the hole path: does a hole's outline look to hold a FINGER of wood —
 * a band thinner than `thin` between two of its own arms, over `FINGER_MIN` long, `FINGER_LONG` times
 * as long as it is wide, filling `FINGER_BAND` of that band (the host's own test, `fingersOf`)? The
 * outline is walked a fifth of a millimetre at a time; each point's width is the wood across to the
 * nearest other stretch of it — not round a corner (four times the width along it, as the kerf's own
 * test) — and a finger is a run of points under `thin` whose widths hold up along it: the V between a
 * star's points widens from its tip, and fills half its band. A yes or no only, to hand the hole to the
 * host, which measures its fingers exactly.
 */
function fingerLike(ring: Ring, thin: number): boolean {
  const pts: Pt[] = [];
  const at: number[] = [];
  const starts: number[] = [];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    starts.push(s);
    const n = Math.max(1, Math.ceil(len / 0.2));
    for (let k = 0; k < n; k++) {
      pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      at.push(s + (len * k) / n);
    }
    s += len;
  }
  const total = s;
  if (total < 2 * FINGER_MIN) return false;
  // The edges in a grid a width `thin` wide.
  const size = Math.max(thin, 0.05);
  const grid = new Map<string, number[]>();
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    for (let x = Math.floor((Math.min(a[0], b[0]) - thin) / size); x <= Math.floor((Math.max(a[0], b[0]) + thin) / size); x++) {
      for (let y = Math.floor((Math.min(a[1], b[1]) - thin) / size); y <= Math.floor((Math.max(a[1], b[1]) + thin) / size); y++) {
        const k = `${x},${y}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  const width = pts.map((p, i) => {
    let best = Infinity;
    for (const j of grid.get(`${Math.floor(p[0] / size)},${Math.floor(p[1] / size)}`) ?? []) {
      const a = ring[j]!;
      const b = ring[(j + 1) % ring.length]!;
      const d = pointSegmentDistance(p, a, b);
      if (d >= thin || d >= best || d < 1e-9) continue;
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const l2 = vx * vx + vy * vy;
      const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
      const c: Pt = [a[0] + vx * t, a[1] + vy * t];
      const way = Math.abs(starts[j]! + Math.sqrt(l2) * t - at[i]!);
      if (Math.min(way, total - way) <= 4 * d) continue;
      // Across wood — outside the hole — not across the cut itself.
      if (pointInRingFast([(p[0] + c[0]) / 2, (p[1] + c[1]) / 2], ring)) continue;
      best = d;
    }
    return best;
  });
  // Runs of points under `thin`, round the ring.
  const first = width.findIndex((w) => !(w < thin));
  if (first < 0) return false;
  let run = 0;
  let widest = 0;
  let band = 0;
  for (let k = 1; k <= pts.length; k++) {
    const i = (first + k) % pts.length;
    const prev = (first + k - 1) % pts.length;
    if (width[i]! < thin) {
      if (width[prev]! < thin) {
        const step = (at[i]! - at[prev]! + total) % total;
        run += step;
        band += ((width[i]! + width[prev]!) / 2) * step;
      }
      widest = Math.max(widest, width[i]!);
      continue;
    }
    if (run + widest > FINGER_MIN && run >= FINGER_LONG * widest && band >= FINGER_BAND * run * widest) return true;
    run = 0;
    widest = 0;
    band = 0;
  }
  return false;
}

/** One cell of a tile among its neighbours, as the hole rings a cut would punch, at `scale`. */
function tileBlock(def: PatternDef, p: Params, scale: number): Ring[] {
  const cell = def.cell!(p);
  const t = tileGeometry(def, p, { minX: -cell.w / 2, minY: -cell.h / 2, maxX: cell.w / 2, maxY: cell.h / 2 }, true);
  return dedupeIslands(t.geo.holes.map((island) => island.map((r) => r.map(([x, y]): Pt => [x * scale, y * scale]))).filter((island) => island[0] && island[0].length >= 3 && Math.abs(signedArea(island[0])) > 1e-6))
    .map((island) => island[0]!);
}

/**
 * A cut's hole that crosses the zone's edge, clipped to it as Engrave clips it: the pieces of it
 * on the zone, each cut by its outline. A piece keeps a counter only where a reserve's corner
 * reaches into it and runs on outside it (the wood there stays joined to the rest); a piece round
 * a WHOLE reserve would cut it loose, and goes. Null when a concave hole defeats the clip (a
 * crossing on a vertex): the host's booleans clip the pattern instead.
 */
function clipCut(outer: Ring, clipRegion: Shapes, index: EdgeIndex): Shapes | null {
  const pieces = clipIslandToRegion([outer], index) ?? (isConvex(outer) ? clipHoleToRegion(outer, clipRegion) : null);
  if (!pieces) return null;
  return pieces.filter((island) => !!island[0] && island[0].length >= 3 && island.slice(1).every((h) => ringGap(h, island[0]!, 1e-3) < 1e-3));
}

/** Area of an island: its outer ring less its counters. */
function islandArea(island: Island): number {
  return island.reduce((s, r, i) => s + (i === 0 ? 1 : -1) * Math.abs(signedArea(r)), 0);
}

/** The radius of the widest disc an island holds, mm — read off its middle when that is plainly
 *  `enough` (a dot, a hexagon), else searched for (`poleOf`), stopping once it is enough. */
function widest(island: Island, enough = Infinity): number {
  const outer = island[0]!;
  let x = 0;
  let y = 0;
  for (const q of outer) {
    x += q[0];
    y += q[1];
  }
  const c: Pt = [x / outer.length, y / outer.length];
  if (pointInRingFast(c, outer) && !island.slice(1).some((h) => pointInRingFast(c, h))) {
    let d = Infinity;
    for (const r of island) for (let i = 0; i < r.length; i++) d = Math.min(d, pointSegmentDistance(c, r[i]!, r[(i + 1) % r.length]!));
    if (d >= enough) return d;
  }
  return poleOf(outer, 0.01, island.slice(1), enough).radius;
}

/** Something of substance left of an island whose widest disc is `r` — over `SHRUNK_MIN` — once shrunk
 *  by half `minWidth`, less a hair (the lattice's measure of a face). Judged at its WIDEST, then: a
 *  thin arm does not condemn the shape, and a sliver the zone's edge clipped is cut only where it is
 *  wide enough to cut. */
function holdsCut(island: Island, r: number, minWidth: number): boolean {
  const d = minWidth / 2 - FLOOR_SLACK;
  // A widest disc this much wider keeps a disc of π·0.057² > `SHRUNK_MIN` on its own.
  if (r >= d + PLAIN) return true;
  if (r < d) return false;
  return (island.length === 1 && isConvex(island[0]!) ? convexInsetArea(island[0]!, d) : shrunkArea(island, d)) > SHRUNK_MIN;
}
/** How much wider than the floor a widest disc is plainly enough on its own, mm. */
const PLAIN = 0.057;

/** What shrinking a CONVEX ring by `d` leaves of it, mm², exactly: the ring cut by each edge's line
 *  moved `d` in (a convex shape's nearest edge is the nearest edge's line). A slot, a dot or a
 *  hexagon at the floor is answered in a few dozen steps, where sampling took thousands. */
function convexInsetArea(ring: Ring, d: number): number {
  const s = signedArea(ring) > 0 ? 1 : -1;
  let poly: Pt[] = ring;
  for (let i = 0; i < ring.length && poly.length >= 3; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const nx = (-(b[1] - a[1]) / len) * s;
    const ny = ((b[0] - a[0]) / len) * s;
    const side = (q: Pt): number => (q[0] - a[0]) * nx + (q[1] - a[1]) * ny - d;
    const next: Pt[] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j]!;
      const q = poly[(j + 1) % poly.length]!;
      const fp = side(p);
      const fq = side(q);
      if (fp >= 0) next.push(p);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = next;
  }
  return poly.length >= 3 ? Math.abs(signedArea(poly)) : 0;
}

/** What shrinking by `d` leaves of an island, mm² — sampled on a grid a fiftieth of a millimetre
 *  fine, for the few pieces at the floor (whose shrunk box is a sliver). */
function shrunkArea(island: Island, d: number): number {
  const b = bboxOfShapes([island]);
  const s = 0.02;
  // (Only whether it is over `SHRUNK_MIN` is asked: counting stops there.)
  const enough = SHRUNK_MIN / (s * s);
  // Each edge is filed under every cell of a coarse grid that it comes within `d` of (and a
  // nanometre), and a sample measures only its own cell's edges. No other edge can be within `d`
  // of it, so each sample, and the count, come out as measuring every edge did. Measuring every
  // edge was the cost: a Tribal - 5 sun has hundreds of edges, sampled thousands of times, per copy.
  const g = 0.25;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / g));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / g));
  const col = (x: number): number => Math.min(cols - 1, Math.max(0, Math.floor((x - b.minX) / g)));
  const row = (y: number): number => Math.min(rows - 1, Math.max(0, Math.floor((y - b.minY) / g)));
  const cells: Array<Array<[Pt, Pt]>> = [];
  const reach = d + 1e-6;
  for (const r of island) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const c = r[(i + 1) % r.length]!;
      const j1 = row(Math.max(a[1], c[1]) + reach);
      const i1 = col(Math.max(a[0], c[0]) + reach);
      for (let jj = row(Math.min(a[1], c[1]) - reach); jj <= j1; jj++) {
        for (let ii = col(Math.min(a[0], c[0]) - reach); ii <= i1; ii++) (cells[jj * cols + ii] ??= []).push([a, c]);
      }
    }
  }
  const holes = island.slice(1);
  let n = 0;
  for (let x = b.minX + d + s / 2; x < b.maxX - d; x += s) {
    const ci = col(x);
    for (let y = b.minY + d + s / 2; y < b.maxY - d; y += s) {
      const p: Pt = [x, y];
      const near = cells[row(y) * cols + ci];
      if (near && near.some(([a, c]) => pointSegmentDistance(p, a, c) <= d)) continue;
      if (!pointInRingFast(p, island[0]!) || holes.some((h) => pointInRingFast(p, h))) continue;
      if (++n > enough) return n * s * s;
    }
  }
  return n * s * s;
}

/** Of a shape shrunk by half the narrowest cut, what counts as something left, mm² — the studio's
 *  booleans drop anything smaller as dust. */
const SHRUNK_MIN = 0.01;

/** Wholly on material, wholly off it, or across the edge. */
function classify(ring: Ring, index: EdgeIndex): 'inside' | 'outside' | 'crossing' {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const near = index.near(minX, minY, maxX, maxY);
  if (near.length) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      for (const e of near) if (segmentsIntersect(a, b, e.c, e.d)) return 'crossing';
    }
    // No edge crosses the ring, but a region island could sit wholly inside it (a counter of a
    // letter inside a big hole): then the hole is not on plain material either.
    for (const e of near) if (pointInRingFast(e.c, ring)) return 'crossing';
  }
  return index.inside(ring[0]!) ? 'inside' : 'outside';
}

function pointInRingFast(p: Pt, ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** A polyline as a band of `width`: one quad per segment, a disc at each joint and both ends. */
function bandsOf(run: Polyline, width: number): Ring[] {
  const out: Ring[] = [];
  const h = width / 2;
  const disc = (c: Pt): Ring => {
    const n = Math.max(8, Math.min(24, Math.ceil((Math.PI * width) / 0.3)));
    const r: Ring = [];
    for (let i = 0; i < n; i++) r.push([c[0] + h * Math.cos((i / n) * 2 * Math.PI), c[1] + h * Math.sin((i / n) * 2 * Math.PI)]);
    return r;
  };
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i]!;
    const b = run[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * h;
    const ny = (dx / len) * h;
    out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  }
  for (const q of run) out.push(disc(q));
  return out;
}

/** A slit as closed slots, one per straight run, so a host with a shapes-only cut layer can
 *  take a living hinge. */
function slitsToSlots(run: Polyline, width: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i]!;
    const b = run[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = slotRing(0, 0, len + width, width);
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    out.push(s.map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]));
  }
  return out;
}

/**
 * The region shrunk by `d` on every side: each ring's vertices slide along their angle
 * bisectors toward the material, mitres capped at 3d so a sharp corner does not spike, and a
 * corner rounder than `d` (whose short edges would run backwards) collapses to the sharp corner
 * its neighbours make. Null when a ring would still fold over itself (a feature narrower than
 * 2d) — the caller then clips to the real outline.
 */
export function insetShapes(shapes: Shapes, d: number): Shapes | null {
  const out: Shapes = [];
  for (const island of shapes) {
    const isl: Island = [];
    for (let k = 0; k < island.length; k++) {
      const ring = island[k]!;
      // Outers run CCW, holes CW: the material is then always on the left of travel.
      const ccw = signedArea(ring) > 0;
      const oriented = (k === 0) === ccw ? ring : [...ring].reverse();
      const moved = offsetRingLeft(oriented, d);
      if (!moved) return null;
      if (k === 0 && Math.abs(signedArea(moved)) < 1e-6) return null;
      if (k === 0 || Math.abs(signedArea(moved)) > 1e-6) isl.push(moved);
    }
    if (isl.length) out.push(isl);
  }
  return out.length ? out : null;
}

function offsetRingLeft(ring: Ring, d: number): Ring | null {
  // The ring's edges, zero-length ones dropped: a start, a unit direction, a left normal.
  const E: { a: Pt; ux: number; uy: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    E.push({ a, ux, uy, nx: -uy, ny: ux });
  }
  const m0 = E.length;
  if (m0 < 3) return null;
  // Where the offsets of edges e and f meet. Beside each other, that is the mitre along the
  // bisector at their shared corner, capped at 3d so a sharp corner does not spike. Once edges
  // between them have collapsed, it is where their offset lines cross — exact on a convex corner,
  // and capped the same way on a notch.
  const meet = (e: number, f: number): Pt | null => {
    const A = E[e]!;
    const B = E[f]!;
    const corner = B.a;
    const cross = A.ux * B.uy - A.uy * B.ux;
    if (f === (e + 1) % m0) {
      let mx = A.nx + B.nx;
      let my = A.ny + B.ny;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-9) {
        // A hairpin: fall back to the first normal.
        mx = A.nx;
        my = A.ny;
      } else {
        mx /= ml;
        my /= ml;
      }
      const cosHalf = mx * A.nx + my * A.ny;
      const len = Math.min(3 * d, d / Math.max(cosHalf, 1 / 3));
      return [corner[0] + mx * len, corner[1] + my * len];
    }
    if (Math.abs(cross) < 1e-9) return null;
    const cross2 = (px: number, py: number, qx: number, qy: number) => px * qy - py * qx;
    const hit = (p: Pt, q: Pt): Pt => {
      const t = cross2(q[0] - p[0], q[1] - p[1], B.ux, B.uy) / cross;
      return [p[0] + A.ux * t, p[1] + A.uy * t];
    };
    const off = hit([A.a[0] + A.nx * d, A.a[1] + A.ny * d], [B.a[0] + B.nx * d, B.a[1] + B.ny * d]);
    if (cross > 0) return off;
    const q = hit(A.a, B.a);
    const dx = off[0] - q[0];
    const dy = off[1] - q[1];
    const l = Math.hypot(dx, dy);
    return l <= 3 * d ? off : [q[0] + (dx / l) * 3 * d, q[1] + (dy / l) * 3 * d];
  };
  const next = E.map((_, i) => (i + 1) % m0);
  const prev = E.map((_, i) => (i + m0 - 1) % m0);
  const alive = E.map(() => true);
  // V[i]: where edge i starts once offset — the meeting of edge prev(i) and edge i.
  const V: (Pt | null)[] = E.map((_, i) => meet(prev[i]!, i));
  if (V.some((v) => !v)) return null;
  // A corner rounder than the offset — a card's 3 mm corner under a 4 mm margin — turns its short
  // edges round: offset, each runs backwards. Such an edge has collapsed; take it out, and let its
  // neighbours' offsets meet instead, until nothing runs backwards. What is left is the true inset
  // of those corners: sharp, where the straight sides' offsets cross.
  const backwards = (i: number): boolean => {
    const a = V[i]!;
    const b = V[next[i]!]!;
    return (b[0] - a[0]) * E[i]!.ux + (b[1] - a[1]) * E[i]!.uy < -1e-9;
  };
  let live = m0;
  const queue = E.map((_, i) => i);
  while (queue.length) {
    const i = queue.pop()!;
    if (!alive[i] || !backwards(i)) continue;
    alive[i] = false;
    if (--live < 3) return null;
    const p = prev[i]!;
    const n = next[i]!;
    next[p] = n;
    prev[n] = p;
    const v = meet(p, n);
    if (!v) return null;
    V[n] = v;
    queue.push(p, n);
  }
  const out: Ring = [];
  const first = alive.indexOf(true);
  let i = first;
  do {
    out.push(V[i]!);
    i = next[i]!;
  } while (i !== first && out.length <= m0);
  if (out.length < 3) return null;
  // Folded over: an edge crosses a non-adjacent edge, or the winding flipped.
  if (Math.sign(signedArea(out)) !== Math.sign(signedArea(ring))) return null;
  const m = out.length;
  if (m <= 400) {
    for (let i = 0; i < m; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % m]!;
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue;
        const cc = out[j]!;
        const dd = out[(j + 1) % m]!;
        if (segmentsIntersect(a, b, cc, dd)) return null;
      }
    }
  }
  return out;
}

export function geometryBox(geo: PatternGeometry): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = ([x, y]: Pt) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  };
  for (const i of geo.holes) for (const r of i) for (const q of r) grow(q);
  for (const l of geo.lines) for (const q of l) grow(q);
  for (const l of geo.slits) for (const q of l) grow(q);
  return b;
}
