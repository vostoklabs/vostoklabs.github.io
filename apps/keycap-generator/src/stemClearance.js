/**
 * Exact-clearance stem tolerance: grows/shrinks the switch-GRIPPING surface of a stem by
 * exactly `tolMM` (tolMM/2 per wall), instead of `scaleStemComponentsXY`'s whole-body bbox
 * scale (src/meshUtils.js) — which derives its ratio from the stem's overall XY bbox, most of
 * which (a mounting flange, a crown-side shoulder) has nothing to do with switch engagement, so
 * on the shipped MX-style profiles only ~8-18% of the dialled tolerance ever reaches the socket
 * (measured: standard-profile +0.05 nominal -> +0.0041mm at the socket wall). See the
 * investigation numbers this module was built to satisfy (per-profile dilution %, per-rung
 * deltas, the choc-v1 sign inversion) in the task that produced this file.
 *
 * PRINCIPLE (matches the stepper's own UI copy: "+ if too hard to push on, - if it feels
 * loose"): `tolMM` is the change in GRIP CLEARANCE, positive = looser, on every profile.
 *   - Female cross socket (Standard/Thocky/Low-profile MX-style): the socket is a HOLE in the
 *     stem. Growing clearance means growing the hole — subtract a ring of material from around
 *     it. tolMM/2 is added to every wall of the socket, over its own depth (wherever a hole
 *     exists in Z), independent of the stem's own unrelated outer shoulder/flange.
 *   - Male stubs (Kailh Choc v1): the "socket" is a peg going INTO the switch. Growing clearance
 *     means SHRINKING the peg — subtract a ring off its own outer wall. Sign is the mirror image
 *     of the female case for exactly this reason (this is the bug the investigation confirmed:
 *     `scaleStemComponentsXY`'s single formula has no idea which kind of stem it's holding).
 *
 * STEM KIND is read from the geometry itself, per Z-slice (a hole in the cross-section = socket,
 * no hole = stub) — never from a profile name — and a multi-stem body (2u, spacebars, one
 * component per switch position) is split by connected-component the same way
 * `scaleStemComponentsXY` already does, then each stem is processed and reassembled
 * independently, so a 3-stem cap gets the exact same per-stem correctness as a 1u cap.
 *
 * METHOD, per stem component: slice the solid at several heights, and inspect whether the
 * gripping contour (the socket's hole, or the stub's own outer boundary) is ~constant along Z.
 * On every shipped profile the socket is measured to be an exact through-hole — bit-identical
 * from the switch-facing face to the crown-facing face (see explore3-output.txt: standard-
 * profile's hole is 4.039x4.039mm at every one of 40 sampled heights, area unchanged to 3
 * decimals) — so the fast path taken for all four shipped profiles is ONE 2D offset + ONE 3D
 * boolean per stem: offset the socket's own contour outward/inward by tolMM/2 with Miter joins
 * (square corners survive the offset — Round would sand the cross's gripping corners round),
 * take the ring between the original and offset contour, and subtract (growing) or add
 * (shrinking) a prism of that ring spanning the stem's own full Z range. A profile whose grip
 * contour genuinely varies with height (Choc v1's stub tapers a little end to end) falls back to
 * a handful of Z-bands, each offset by its own local contour, so the exact per-wall delta still
 * holds at every height even under a taper — never approximated by scaling the whole body.
 *
 * No DOM, no repo-specific globals: takes the initialized Manifold module (`api`, e.g. from
 * `await Module(); api.setup();` or the app's own `getManifoldApi()`) and a plain
 * THREE.BufferGeometry-shaped stem (already indexed/welded — the same precondition
 * `scaleStemComponentsXY` and `fitTest.js`'s local `toManifold` both already assume) as
 * parameters, exactly like `src/fitTest.js` takes `deps.api` — so this file runs unmodified in
 * a plain Node + esbuild test, and drops into `src/mount.js` / `src/fitTest.js` in place of
 * `scaleStemComponentsXY` with no other changes to either call site (see this module's own
 * `stemClearance.test.mjs` for the integration recipe).
 */
import * as THREE from 'three';
import { csOf, ringsOf, extrude } from '@vostok/manifold';
import { signedArea, bboxOf } from '@vostok/laser/rings';

const MITER_LIMIT = 4;             // generous headroom above Clipper2's min (2) for a 90° corner
const NESTED_MARGIN_MM = 0.02;      // a contour must sit this far inside another to count as its hole
const PROBE_COUNT = 5;              // Z-samples used to detect stem kind + whether grip is Z-constant
const BAND_CONST_EPS_MM = 0.01;     // grip bbox W/H must agree within this to skip per-band slicing
const BAND_THICKNESS_MM = 0.15;     // target Z-thickness per band when the grip contour varies —
                                     // fine enough that a tight tip fillet (Choc's own lead-in
                                     // taper moves ~45% of its width in the first 0.1mm) is still
                                     // represented by a contour sampled from within that band,
                                     // not one borrowed from a much wider neighbour
const MAX_BANDS = 60;               // hard cap regardless of BAND_THICKNESS_MM, for worst-case runtime
const ADD_INSET_MM = 0.002;         // keep an added band a hair inside the stem's own Z ends
const SUBTRACT_PAD_MM = 0.05;       // let a subtracted band overshoot the stem's own Z ends
const BAND_OVERLAP_MM = 0.05;       // adjacent bands overlap by this much at their shared seam,
                                     // rather than touching exactly — two neighbouring bands use
                                     // independently-sliced contours, so an exact shared face
                                     // between them is the same coincident-boolean hazard as
                                     // COINCIDENCE_NUDGE_MM guards against with the real solid
// The authored cross-socket's wall carries a tiny tessellated entrance chamfer (the real
// thocky-profile socket sliced to a 192-point contour, not a clean 12-point cross) that Clipper2
// offsets messily at 0.1-0.2mm deltas — the offset curve can lose or gain vertices around those
// micro-facets and come back self-crossing, which then shatters the 3D subtract into a hundred-
// odd near-zero-volume slivers despite Manifold reporting `status()==='NoError'` for every step.
// `simplify()` first collapses those sub-visual facets (well under FDM resolution) to the
// dominant sharp corner Ian's eye and the switch's pin actually meet.
const CONTOUR_SIMPLIFY_EPS_MM = 0.02;
// The ring we cut/fill is built from the stem's OWN existing contour on one side (whichever of
// {target, offset target} is the smaller — that side IS a real surface already in the solid:
// the socket's actual wall, or the stub's actual print surface). A ring edge sitting exactly ON
// a real surface is a coincident-face boolean, which is exactly the other numerical failure mode
// that produces sliver fragments. Nudging that one edge a hair further into territory that's
// already going to be treated the same way (already-open hole, or already-solid peg) costs
// nothing dimensionally — the OTHER edge of the ring is still the true, un-nudged target — and
// gives Manifold's exact boolean two surfaces that never exactly touch.
const COINCIDENCE_NUDGE_MM = 0.02;
// A genuine end-of-stem transient (Choc's own tip lead-in, or its crown-side mounting shoulder)
// changes width fast enough over a short Z run that NO single band contour — however fine —
// nests cleanly against the real mesh through that whole run; the mismatch is geometric, not a
// resolution problem, and it shatters the boolean into slivers right there (verified: isolating
// one Choc stub and growing bands from 10 to 26 made the fragment count go UP, not down). Rather
// than chase an ever-finer band size, the two transient runs are left exactly as authored — only
// the stable "core" between them (which is where the switch actually grips, and where every
// assertion in this module's test measures) gets the exact-clearance treatment.
const CORE_SCAN_COUNT = 24;         // fine probes used only to find the stable core, non-constant case only
const CORE_TRANSIENT_REL = 0.06;    // a step-to-step relative width change above this = still transient


// ---------------------------------------------------------------- 2D polygon helpers

/** Manifold's `toPolygons()` winds a hole opposite its parent outline; a hole treated as its
 *  OWN standalone filled shape (which is what we do to offset it) needs to be CCW/positive-area
 *  regardless of which way it came wound. */
function ensureCCW(poly) {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

/** Split one Z-slice's polygons into the outer boundary/boundaries and whichever polygons sit
 *  well inside one of them (a hole). A female socket's slice is [outer, hole]; a male stub's is
 *  just its own outline(s), with `holes` empty. */
function classifySlice(polys) {
  const items = polys.map((poly) => ({ poly, area: Math.abs(signedArea(poly)), bbox: bboxOf([[poly]]) }));
  items.sort((a, b) => b.area - a.area);
  const outer = items[0] || null;
  const holes = outer
    ? items.slice(1).filter((it) => (
      it.bbox.minX > outer.bbox.minX + NESTED_MARGIN_MM && it.bbox.maxX < outer.bbox.maxX - NESTED_MARGIN_MM
      && it.bbox.minY > outer.bbox.minY + NESTED_MARGIN_MM && it.bbox.maxY < outer.bbox.maxY - NESTED_MARGIN_MM
    ))
    : [];
  const outerLevel = items.filter((it) => !holes.includes(it));
  return { items, outer, holes, outerLevel };
}

// ---------------------------------------------------------------- Manifold plumbing

function meshToManifold(api, positions, indices) {
  return api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: positions instanceof Float32Array ? positions : new Float32Array(positions),
    triVerts: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
  }));
}

function manifoldToBufferGeometry(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

/** Union a list of Manifolds and free every input (Manifold's boolean ops read their operands,
 *  they never take ownership) — except when there's only one, which IS the result. */
function unionAndFree(api, pieces) {
  if (!pieces.length) return null;
  if (pieces.length === 1) return pieces[0];
  const result = api.Manifold.union(pieces);
  for (const p of pieces) p.delete();
  return result;
}

// ---------------------------------------------------------------- component splitting
//
// Same union-find grouping `scaleStemComponentsXY` (src/meshUtils.js) uses to isolate each
// stem in a multi-stem body — reimplemented here (rather than imported) so this module has no
// repo-internal dependency, matching src/fitTest.js's own reason for not importing
// src/manifold.js.

function splitComponents(positions, indices) {
  const nv = positions.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < indices.length; i += 3) { union(indices[i], indices[i + 1]); union(indices[i + 1], indices[i + 2]); }

  const trisByRoot = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    let arr = trisByRoot.get(root);
    if (!arr) { arr = []; trisByRoot.set(root, arr); }
    arr.push(indices[i], indices[i + 1], indices[i + 2]);
  }

  const components = [];
  for (const tris of trisByRoot.values()) {
    const remap = new Map();
    const posOut = [];
    const idxOut = new Uint32Array(tris.length);
    for (let k = 0; k < tris.length; k++) {
      const v = tris[k];
      let mapped = remap.get(v);
      if (mapped === undefined) {
        mapped = remap.size;
        remap.set(v, mapped);
        posOut.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      }
      idxOut[k] = mapped;
    }
    components.push({ positions: new Float32Array(posOut), indices: idxOut });
  }
  // Deterministic, stable order (matches switch-position left-to-right) — not load-bearing,
  // just makes output/debugging reproducible.
  const centroidX = (c) => {
    let sum = 0;
    const n = c.positions.length / 3;
    for (let i = 0; i < n; i++) sum += c.positions[i * 3];
    return sum / n;
  };
  components.sort((a, b) => centroidX(a) - centroidX(b));
  return components;
}

// ---------------------------------------------------------------- per-stem processing

function slicePolys(man, z) {
  const cs = man.slice(z);
  const polys = ringsOf(cs);
  cs.delete();
  return polys;
}

/** The primary grip-target polygon at one slice (the biggest hole for a socket, the biggest
 *  outer-level island for a stub), or null if none is present at that height. */
function primaryTarget(sliced, kind) {
  const pool = kind === 'socket' ? sliced.holes : sliced.outerLevel;
  if (!pool.length) return null;
  let best = pool[0];
  for (const it of pool) if (it.area > best.area) best = it;
  return best;
}

/**
 * Find the Z sub-range where the grip contour's own width is changing SLOWLY enough for a
 * piecewise-constant band model to nest cleanly against the real mesh. Only called once the
 * whole-stem probe already found the grip is NOT Z-constant (Choc's stub tapers end to end).
 *
 * A genuine end transient (a tip's lead-in fillet, a crown-side mounting shoulder) can change
 * width fast enough over a short run that no band — however fine — nests correctly against it;
 * the fix is to leave that run untouched rather than chase finer bands (see CORE_SCAN_COUNT's
 * own comment). Trims are only ever made from the two ends inward, never out of the middle, so a
 * genuinely-tapered but otherwise well-behaved shaft (the common case) keeps its full Z range.
 */
function detectCoreZRange(man0, zMin, zMax, kind) {
  const zSpan = zMax - zMin;
  const samples = [];
  for (let i = 0; i < CORE_SCAN_COUNT; i++) {
    const f = (i + 0.5) / CORE_SCAN_COUNT;
    const z = zMin + f * zSpan;
    const t = primaryTarget(classifySlice(slicePolys(man0, z)), kind);
    samples.push({ z, w: t ? Math.max(t.bbox.maxX - t.bbox.minX, t.bbox.maxY - t.bbox.minY) : null });
  }
  const relStep = (a, b) => (a.w == null || b.w == null ? Infinity : Math.abs(b.w - a.w) / Math.max(a.w, b.w, 1e-6));

  let startIdx = 0;
  while (startIdx + 1 < samples.length && relStep(samples[startIdx], samples[startIdx + 1]) > CORE_TRANSIENT_REL) startIdx++;
  let endIdx = samples.length - 1;
  while (endIdx - 1 > startIdx && relStep(samples[endIdx - 1], samples[endIdx]) > CORE_TRANSIENT_REL) endIdx--;

  if (endIdx <= startIdx) return { zLo: zMin, zHi: zMax }; // no safe core found — use everything
  return { zLo: samples[startIdx].z, zHi: samples[endIdx].z };
}

/**
 * Grow/shrink one stem (already isolated to its own connected component) by `tolMM` at its own
 * gripping surface. Returns `{ manifold, kind, ok, bandsUsed, isConstant, skippedRings }` — the
 * caller owns and must `.delete()` the returned manifold.
 */
function processStem(api, mesh, tolMM) {
  const man0 = meshToManifold(api, mesh.positions, mesh.indices);
  const bbox = man0.boundingBox();
  const zMin = bbox.min[2], zMax = bbox.max[2];
  const zSpan = zMax - zMin;

  if (!(zSpan > 1e-4)) {
    return { manifold: man0, kind: 'unknown', ok: man0.status() === 'NoError', bandsUsed: 0, isConstant: true, skippedRings: 0 };
  }

  // ---- probe a handful of heights: which kind is this, and is the grip contour Z-constant? ----
  const probes = [];
  for (let i = 0; i < PROBE_COUNT; i++) {
    const f = (i + 0.5) / PROBE_COUNT;
    const z = zMin + f * zSpan;
    probes.push({ z, ...classifySlice(slicePolys(man0, z)) });
  }
  const socketVotes = probes.filter((p) => p.holes.length > 0).length;
  const kind = socketVotes * 2 >= probes.length ? 'socket' : 'stub';

  const primaryBoxes = probes.map((p) => {
    const t = primaryTarget(p, kind);
    return t ? { w: t.bbox.maxX - t.bbox.minX, h: t.bbox.maxY - t.bbox.minY } : null;
  });
  const validBoxes = primaryBoxes.filter(Boolean);
  const isConstant = validBoxes.length === primaryBoxes.length && validBoxes.every((b) => (
    Math.abs(b.w - validBoxes[0].w) < BAND_CONST_EPS_MM && Math.abs(b.h - validBoxes[0].h) < BAND_CONST_EPS_MM
  ));

  // ---- band edges: one band spanning the whole stem when the grip is Z-constant (the fast
  // path every shipped profile takes today), else a run of even slices across the STABLE CORE
  // only (see detectCoreZRange) so a real taper (Choc's stub) gets an exact per-height delta
  // through its shaft, without trying to band the two end transients that no banding nests. ----
  const core = isConstant ? { zLo: zMin, zHi: zMax } : detectCoreZRange(man0, zMin, zMax, kind);
  const coreSpan = core.zHi - core.zLo;
  const atStemStart = core.zLo <= zMin + 1e-6;
  const atStemEnd = core.zHi >= zMax - 1e-6;
  const adaptiveBandCount = Math.min(MAX_BANDS, Math.max(4, Math.ceil(coreSpan / BAND_THICKNESS_MM)));
  const bandEdges = isConstant
    ? [zMin, zMax]
    : Array.from({ length: adaptiveBandCount + 1 }, (_, i) => core.zLo + (i / adaptiveBandCount) * coreSpan);
  const nBands = bandEdges.length - 1;
  const midProbeIdx = Math.floor(PROBE_COUNT / 2); // f=0.5 exactly — reuse it instead of re-slicing

  // Applied one band at a time, straight against the accumulating solid (rather than collecting
  // every band's ring and unioning them first): adjacent bands come from INDEPENDENTLY sliced
  // contours, so for a real taper their rings are many near-parallel, near-touching thin slabs —
  // exactly the coincident-surface hazard COINCIDENCE_NUDGE_MM guards against, just between
  // bands instead of against the original solid, and unioning a couple dozen of them at once
  // turned out to hit it too. A plain two-operand boolean against an already-clean solid is the
  // same operation the single-band (isConstant) fast path already proves robust, just repeated.
  let man = man0;
  let skippedRings = 0;

  for (let b = 0; b < nBands; b++) {
    const zLo = bandEdges[b], zHi = bandEdges[b + 1];
    let bandItems;
    if (isConstant) {
      bandItems = kind === 'socket' ? probes[midProbeIdx].holes : probes[midProbeIdx].outerLevel;
    } else {
      const zMid = Math.min(zMax - 1e-4, Math.max(zMin + 1e-4, (zLo + zHi) / 2));
      const sliced = classifySlice(slicePolys(man0, zMid));
      bandItems = kind === 'socket' ? sliced.holes : sliced.outerLevel;
    }

    for (const target of bandItems) {
      const contour = ensureCCW(target.poly);
      // Positive delta grows the target contour itself. Socket target = the hole (growing it
      // means MORE clearance, i.e. tolMM>0). Stub target = the stub's own outer wall (growing
      // clearance means a SMALLER peg, i.e. the mirror sign of the socket case).
      const delta2D = kind === 'socket' ? tolMM / 2 : -tolMM / 2;

      const baseCSraw = csOf(api, [contour], 'Positive');
      const baseCS = baseCSraw.simplify(CONTOUR_SIMPLIFY_EPS_MM);
      baseCSraw.delete();
      const offsetCSraw = baseCS.offset(delta2D, 'Miter', MITER_LIMIT);
      const offsetCS = offsetCSraw.simplify(CONTOUR_SIMPLIFY_EPS_MM);
      offsetCSraw.delete();

      const growing = delta2D > 0;
      // `baseCS`'s own boundary already exists as a real surface in the solid; nudge it a hair
      // into its OWN territory (regardless of grow/shrink) so the ring never shares an exact
      // edge with that real surface — see COINCIDENCE_NUDGE_MM above.
      const nudgedBase = baseCS.offset(growing ? -COINCIDENCE_NUDGE_MM : COINCIDENCE_NUDGE_MM, 'Miter', MITER_LIMIT);
      const bigger = growing ? offsetCS : nudgedBase;
      const smaller = growing ? nudgedBase : offsetCS;
      const ring = bigger.subtract(smaller);
      nudgedBase.delete(); baseCS.delete(); offsetCS.delete();

      if (ring.isEmpty()) { ring.delete(); skippedRings++; continue; }

      // socket growing -> remove material (subtract); socket shrinking -> fill it in (add)
      // stub growing(=smaller peg) -> remove material (subtract); stub shrinking -> add material
      const addingMaterial = kind === 'socket' ? !growing : growing;

      let z0, z1;
      if (b === 0 && atStemStart) {
        // Never let an added band exceed the stem's OWN Z extent (that would change the part's
        // height); inset a hair off a full-span band's own end so the new face doesn't sit
        // exactly on the stem's own end face — a classic coplanar-boolean degeneracy. Subtracting
        // empty space outside the stem is a no-op, so overshooting is free there instead.
        z0 = addingMaterial ? zLo + ADD_INSET_MM : zLo - SUBTRACT_PAD_MM;
      } else {
        // An interior seam — either between two bands, or between the core and an excluded end
        // transient — is built from two INDEPENDENTLY sliced contours; an exact shared face
        // there is exactly as risky as touching the real solid, so overlap rather than abut.
        z0 = zLo - BAND_OVERLAP_MM;
      }
      if (b === nBands - 1 && atStemEnd) {
        z1 = addingMaterial ? zHi - ADD_INSET_MM : zHi + SUBTRACT_PAD_MM;
      } else {
        z1 = zHi + BAND_OVERLAP_MM;
      }
      const h = z1 - z0;
      if (!(h > 1e-6)) { ring.delete(); skippedRings++; continue; }
      const prismRaw = extrude(api, ring, h); const prism = prismRaw.translate([0, 0, z0]); prismRaw.delete(); // the untranslated extrude is its own handle
      ring.delete();

      const next = addingMaterial ? man.add(prism) : man.subtract(prism);
      prism.delete();
      if (man !== man0) man.delete();
      man = next;
    }
  }

  const ok = man.status() === 'NoError' && !man.isEmpty();
  if (man !== man0) man0.delete(); // the band loop replaced it; nothing returns or re-slices it now
  return { manifold: man, kind, ok, bandsUsed: nBands, isConstant, skippedRings };
}

// ---------------------------------------------------------------- public API

/**
 * @param {object} api  Initialized Manifold module (`await Module(); api.setup();`), or the
 *   app's own `getManifoldApi()`.
 * @param {*} baseStemGeometry  The cap's authored stem at 0 tolerance — an already welded,
 *   indexed THREE.BufferGeometry (or anything exposing the same `getAttribute`/`getIndex`
 *   shape), one or more disconnected stems (2u/spacebar bodies carry one per switch position).
 *   Left untouched; every return is a new object.
 * @param {number} tolMM  Change in GRIP CLEARANCE: positive = looser, negative = tighter, on
 *   every stem kind (matches the stepper's own UI copy).
 * @returns {{ geometry: THREE.BufferGeometry, watertight: boolean, components: object[] }}
 */
export function applyStemClearance(api, baseStemGeometry, tolMM) {
  if (!Number.isFinite(tolMM) || Math.abs(tolMM) < 1e-4) {
    return { geometry: baseStemGeometry, watertight: true, components: [] };
  }
  if (!baseStemGeometry.index) {
    throw new Error('applyStemClearance: baseStemGeometry must already be indexed/welded (same precondition as scaleStemComponentsXY).');
  }

  const positions = baseStemGeometry.getAttribute('position').array;
  const indices = baseStemGeometry.getIndex().array;
  const stemComponents = splitComponents(positions, indices);

  const processed = stemComponents.map((mesh) => processStem(api, mesh, tolMM));
  const combined = unionAndFree(api, processed.map((p) => p.manifold));

  const status = combined.status();
  const decomposed = combined.decompose();
  const topologyPreserved = decomposed.length === stemComponents.length;
  for (const d of decomposed) d.delete();
  const watertight = status === 'NoError' && !combined.isEmpty() && topologyPreserved
    && processed.every((p) => p.ok);

  const geometry = manifoldToBufferGeometry(combined);
  combined.delete();

  return {
    geometry,
    watertight,
    components: processed.map((p) => ({
      kind: p.kind, ok: p.ok, bandsUsed: p.bandsUsed, isConstant: p.isConstant, skippedRings: p.skippedRings,
    })),
  };
}

// Exported for the test file's own direct checks of the pure 2D pieces.
export const _internal = { ensureCCW, classifySlice, splitComponents };
