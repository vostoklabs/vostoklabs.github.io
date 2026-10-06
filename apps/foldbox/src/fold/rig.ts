// The fold rig: a flat net turned into a hierarchy that folds itself.
//
// Two nested Groups per panel, and only one of them ever animates:
//
//   frame  — static. Sits at the hinge and rotates about Z to aim it.
//   pivot  — animated. Only ever gets `rotation.x`.
//
// A single Group would be simpler and wrong. three.js defaults to Euler order 'XYZ',
// whose matrix is Rx·Ry·Rz — so Rz is applied to the vector FIRST and the X rotation
// then happens about the PARENT's axis rather than about the hinge. Setting both on
// one object folds every non-axis-aligned panel around the wrong line, which looks
// almost right on a rectangular box and falls apart on a tapered tray or a gable.
//
// The panel polygon is authored in the pivot's own frame: rotate the net-space
// outline by −θ about the hinge start, so the hinge lands on local y = 0 running
// from x = 0, and the panel body sits at y > 0. `ShapeGeometry` emits in the XY
// plane at z = 0, which is already that frame, so nothing needs translating
// afterwards — and holes come along for free on `shape.holes`, which is how the
// window ends up genuinely see-through.

import * as THREE from 'three';
import type { Net, Panel, Poly, Pt } from '../types';
import { polysBounds, pointInRing, signedArea } from '../geometry/poly';

/** Net-space -> panel-local: rotate by -angle about origin. */
interface Frame {
  ox: number;
  oy: number;
  angle: number;
}

function toLocal(p: Pt, f: Frame): Pt {
  const dx = p[0] - f.ox;
  const dy = p[1] - f.oy;
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return [dx * c + dy * s, -dx * s + dy * c];
}

export interface PanelNode {
  panel: Panel;
  frame: THREE.Group;
  pivot: THREE.Group;
  /** Where in the master scrub this panel folds. */
  t0: number;
  t1: number;
  target: number;
  overshoot: number;
  /** Root panels only: the two poses this subtree slides between as it assembles. */
  rootFrom?: THREE.Vector3;
  rootTo?: THREE.Vector3;
  /** Total rotation about X this root reaches at t = 1: a lid arriving upside down,
   *  or a tube standing itself upright. */
  rootTilt?: number;
  /** Tilting roots only: the bottom edge's local y, below the centroid the frame sits
   *  at. The tilt pivots about that edge, so the box stands up the way a carton does on
   *  a table, rather than spinning about its middle and dipping through the plate. */
  rootEdge?: number;
  /** Flipping roots only: how high the piece is lifted at the middle of its turn, so a
   *  lid turning over never passes through the plate. Half the base's diagonal. */
  rootHover?: number;
  /** Set on the two halves of a webbed corner. See `driveWeb`. */
  web?: {
    kind: 'a' | 'b';
    /** Which way the diagonal folds. The four corners of a tray are two mirror pairs
     *  and a reflection reverses it; `calibrateWebs` measures which is which. */
    hand: number;
    /** The wall this corner is stretched between — the one whose live angle drives it. */
    wall: PanelNode;
    /** Valley or mountain, taken off the panel's authored fold. */
    sign: number;
    /** When the press flat runs: from the moment the walls finish rising. */
    pressT0: number;
    pressT1: number;
  };
}

export interface FoldRig {
  object: THREE.Group;
  nodes: PanelNode[];
  /** Drive the whole thing from one scalar in [0, 1]. */
  setProgress(t: number): void;
  dispose(): void;
}

export interface RigStyle {
  /** Card colour, 0..1 linear-ish sRGB triple. */
  color: string;
  /** Darker line along every panel edge, so the dieline stays readable folded. */
  edge: string;
  /** How thick each panel is drawn, in mm. Absent or 0 draws zero-thickness sheets,
   *  which is what the tests measure against.
   *
   *  A function, because a printed sheet is not one thickness: anything that ends up
   *  sandwiched between two plies (a tuck, a web, a dust flap) is built at the hinge
   *  thickness, and the exporter is the one place that rule lives. Card is uniform. */
  thickness?: (panel: Panel) => number;
}

function shapeFrom(outline: Poly, holes: Poly[], f: Frame): THREE.Shape {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(...toLocal(p, f))));
  for (const h of holes) {
    shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(...toLocal(p, f)))));
  }
  return shape;
}

function centroid(poly: Poly): Pt {
  const [minX, minY, maxX, maxY] = polysBounds([poly]);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Smoothstep, clamped at both ends — so a panel outside its own window is already
 *  at 0 or 1 and needs no special case. Same function three.js ships in MathUtils;
 *  inlined so the timing curve sits next to the thing it times. */
function smoothstep(x: number, lo: number, hi: number): number {
  if (hi - lo < 1e-6) return x < lo ? 0 : 1;
  const u = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}

// ------------------------------------------------------------- webbed corners --
//
// A webbed corner is the one place a box net is NOT a tree. The web is a square of
// card spanning two walls, split on its diagonal: half of it is continuous with one
// wall, half with the other. That is a closed kinematic loop, and a fold tree can
// hold only one of its two edges — so the other is free to swing away, and the
// corner rips open mid-fold. It measured 46 mm apart at its worst: the web left the
// tray entirely and sailed back in later.
//
// The loop has a closed-form solution, so the fix is to stop guessing and solve it.
// Put the corner at the origin with one wall hinged on x and the other on y, both
// risen by θ, and let the web's free corner be B. Requiring B to be reachable from
// EITHER wall gives, for a square web:
//
//   α(θ) = atan(sin θ) + acos(cos θ / √(1 + sin²θ))     the web's swing off its wall
//   ψ(θ) = 2θ                                           the fold on the diagonal
//
// α runs 0 → 135° and ψ runs 0 → 180° as the walls rise, and the corner stays shut to
// floating-point exactly the whole way. So the web pops out as a fin and arrives fully
// doubled at the moment the walls stand up — which is what the card really does.
//
// At θ = 90° the loop goes degenerate: both wall edges land on the same vertical line,
// so B is free to sit anywhere on a circle. That is the slack the press flat uses —
// swinging the doubled web from 135° down to 90°, flat against the end wall, while the
// walls hold still. Being degenerate, that phase cannot open the corner either.

/** The web's swing off the wall it is hinged to, for walls risen by `theta`. */
function webSwing(theta: number): number {
  const s = Math.sin(theta);
  const r = Math.hypot(1, s);
  return Math.atan2(s, 1) + Math.acos(Math.max(-1, Math.min(1, Math.cos(theta) / r)));
}

/** Where `webSwing` ends up once the walls are up — the pose the press flat starts from. */
const WEB_SWING_FULL = (3 * Math.PI) / 4;

export function buildRig(net: Net, style: RigStyle): FoldRig {
  const object = new THREE.Group();
  const byId = new Map(net.panels.map((p) => [p.id, p]));
  const creaseByChild = new Map(net.creases.map((c) => [c.panelId, c]));

  // Two materials, not one double-sided one. A zero-thickness panel rendered
  // DoubleSide shades its inside and its outside identically, so an open form — a
  // sleeve, a tray before its lid arrives, anything mid-fold — reads as a solid lump
  // with no way to tell which face you are looking at. Splitting front from back is
  // the cheapest depth cue there is: the geometry is shared, only the material
  // differs, and suddenly the inside of a box looks like the inside of a box.
  const CARD = new THREE.Color(style.color);
  const INSIDE = CARD.clone().multiplyScalar(0.6);
  const face = (color: THREE.Color, side: THREE.Side) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.93,
      metalness: 0,
      side,
      // Push the panel back a hair IN DEPTH-BUFFER UNITS, so the dieline drawn on its
      // surface always wins. Lifting the lines by a fixed 0.01 mm (below) cannot do
      // that job on its own: depth precision falls off as the square of the viewing
      // distance, and at the 400 mm a 200 mm blank is seen from the buffer resolves
      // about 0.095 mm — ten times coarser than the lift — so the outlines broke up
      // into dashes. polygonOffset is measured against the depth slope rather than in
      // millimetres, so it holds at every zoom.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  // Four, because a panel needs a light face and a dark face AND which of its two
  // sides is the outside depends on the style. Mutating `side` on a shared material
  // would flip the whole box at once.
  const frontLight = face(CARD, THREE.FrontSide);
  const backDark = face(INSIDE, THREE.BackSide);
  const frontDark = face(INSIDE, THREE.FrontSide);
  const backLight = face(CARD, THREE.BackSide);
  // The logo's ink. One material per face direction, front-only, because the decal is
  // a surface on ONE side of a zero-thickness panel: rendered DoubleSide it would show
  // through the card from the other side, which is exactly what a logo does not do.
  // Pulled FORWARD in the depth buffer by the same trick the panels are pushed back
  // with, so it never breaks up against its own panel at any zoom.
  const decal = (side: THREE.Side) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#26272b'),
      roughness: 0.88,
      metalness: 0,
      side,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  const decalFront = decal(THREE.FrontSide);
  const decalBack = decal(THREE.BackSide);
  const decalLine = new THREE.LineBasicMaterial({ color: new THREE.Color('#26272b') });
  // The cut edge of the board. Every panel is a SLAB, not a sheet: the caliper the net
  // was dimensioned for is drawn, so a 1.5 mm board looks like board and a printed sheet
  // like a printed sheet, and the gaps the net leaves for plies (the 2t strip across a
  // rolled end, the relief beside an ear) are filled by material instead of showing as
  // air. Hinged on the mid-plane, so the net's centre-to-centre dimensions are exact
  // and a 90° corner interpenetrates by t/2 on the inside, which is where a real crease
  // crushes. Distinctly darker than the face: a 0.4 mm edge is two pixels wide on a
  // 90 mm box, and two pixels of nearly-the-same-white is no thickness at all.
  const edgeFace = new THREE.MeshStandardMaterial({
    color: CARD.clone().multiplyScalar(0.7),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mats = [frontLight, backDark, frontDark, backLight, decalFront, decalBack, edgeFace];

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(style.edge),
    transparent: true,
    opacity: 0.5,
  });

  const nodes: PanelNode[] = [];
  const frames = new Map<string, Frame>();
  const nodeById = new Map<string, PanelNode>();

  // Deepest-last, so a parent's pivot always exists before its children ask for it.
  const depthOf = (p: Panel): number => {
    let d = 0;
    let cur: Panel | undefined = p;
    const seen = new Set<string>();
    while (cur?.parent && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent);
      d++;
    }
    return d;
  };
  const ordered = [...net.panels].sort((a, b) => depthOf(a) - depthOf(b));
  // Stage the animation on the LARGEST of tree depth and explicit order. A mailer
  // has a fold tree only three deep but seven distinct moves in it — walls, ears,
  // roll, inner ply, lid, tuck — and sizing the timeline on depth alone crushed the
  // last four into the final 15% of the scrub, where they read as one jump.
  const stageOf = (p: Panel): number => p.order ?? depthOf(p);
  const maxFoldStage = Math.max(1, ...ordered.map(stageOf));
  // A tube stands itself upright LAST, in a stage of its own after every flap is home.
  // It used to tilt across the whole second half of the scrub, on top of the closures:
  // the box rotated through the air while its dust flaps and tucks were still going in,
  // which read as a carton tumbling rather than being folded. A person closes both ends
  // with the tube lying on the table and only then stands it up, and that is the order
  // here now. Lids that fly in (`flip`, no tilt) keep their own window below.
  const tiltStage = maxFoldStage + 1;
  const maxStage = ordered.some((p) => p.rootPose?.tilt) ? tiltStage : maxFoldStage;

  // Everything assembles around where the primary blank already sits, so the box
  // comes together in place instead of sliding across the view.
  const primary = byId.get(net.rootId) ?? ordered[0];
  const primaryCentre = primary ? centroid(primary.outline) : ([0, 0] as Pt);

  for (const panel of ordered) {
    const crease = creaseByChild.get(panel.id);
    const isRoot = !panel.parent || !crease;

    let frame: Frame;
    let pivotFrame: THREE.Group;

    if (isRoot) {
      const c = centroid(panel.outline);
      frame = { ox: c[0], oy: c[1], angle: 0 };
      pivotFrame = new THREE.Group();
      pivotFrame.position.set(c[0], c[1], 0);
      object.add(pivotFrame);
    } else {
      const parentFrame = frames.get(panel.parent!) ?? { ox: 0, oy: 0, angle: 0 };

      // Order the hinge so the panel body ends up at local y > 0. Get this backwards
      // and a positive fold angle swings the flap away from the box instead of into
      // it — which is exactly the bug that makes a rig look "inside out".
      let a = crease!.a;
      let b = crease!.b;
      const test = { ox: a[0], oy: a[1], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      const c = centroid(panel.outline);
      if (toLocal(c, test)[1] < 0) {
        [a, b] = [b, a];
      }
      frame = { ox: a[0], oy: a[1], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };

      const hingeInParent = toLocal(a, parentFrame);
      const hingeFrame = new THREE.Group();
      hingeFrame.position.set(hingeInParent[0], hingeInParent[1], 0);
      hingeFrame.rotation.z = frame.angle - parentFrame.angle;

      pivotFrame = new THREE.Group();
      hingeFrame.add(pivotFrame);
      (nodeById.get(panel.parent!)?.pivot ?? object).add(hingeFrame);
    }

    frames.set(panel.id, frame);

    // The slab: a face at +half, a face at -half, and the cut edge between them. The
    // two faces are the same geometry either side of the hinge plane; the edge is the
    // side wall of an extrusion, with its caps thrown away because the faces already
    // are the caps (and a cap cannot be lit light on one side and dark on the other).
    const half = Math.max(0, style.thickness?.(panel) ?? 0) / 2;
    const shape = shapeFrom(panel.outline, panel.holes, frame);
    const geo = new THREE.ShapeGeometry(shape);
    geo.translate(0, 0, half);
    const mesh = new THREE.Mesh(geo, frontLight);
    mesh.userData.panelId = panel.id;
    pivotFrame.add(mesh);
    // Back faces only. With no thickness it is the same geometry: one extra draw
    // call, no extra memory.
    const backGeo = half > 0 ? geo.clone().translate(0, 0, -2 * half) : geo;
    const inner = new THREE.Mesh(backGeo, backDark);
    inner.userData.innerOf = panel.id;
    pivotFrame.add(inner);
    if (half > 0) {
      const ext = new THREE.ExtrudeGeometry(shape, { depth: 2 * half, bevelEnabled: false });
      const sides = ext.groups.find((g) => g.materialIndex === 1);
      if (sides) {
        const slice = (name: string) => {
          const a = ext.getAttribute(name) as THREE.BufferAttribute;
          const arr = (a.array as Float32Array).slice(sides.start * a.itemSize, (sides.start + sides.count) * a.itemSize);
          return new THREE.BufferAttribute(arr, a.itemSize);
        };
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', slice('position'));
        edgeGeo.setAttribute('normal', slice('normal'));
        edgeGeo.translate(0, 0, -half);
        const edgeMesh = new THREE.Mesh(edgeGeo, edgeFace);
        edgeMesh.userData.edgeOf = panel.id;
        pivotFrame.add(edgeMesh);
      }
      ext.dispose();
    }

    // The panel's own outline as a line, so every crease and cut stays visible once
    // the box is closed. This is the cheapest way to make a folded preview read as a
    // dieline rather than as an anonymous solid. On the +z face, a hair proud of it.
    const lineZ = half + 0.01;
    const ring = panel.outline.map((p) => {
      const l = toLocal(p, frame);
      return new THREE.Vector3(l[0], l[1], lineZ);
    });
    pivotFrame.add(
      new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), edgeMaterial),
    );
    for (const hole of panel.holes) {
      const hp = hole.map((p) => {
        const l = toLocal(p, frame);
        return new THREE.Vector3(l[0], l[1], lineZ);
      });
      pivotFrame.add(
        new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hp), edgeMaterial),
      );
    }

    // The logo, as a decal a hair off one face of the panel.
    //
    // WHICH face is not a choice — it is the file, and the file is decided by the fold.
    // A score, a pen crease and a printed groove all fold SHUT, so the marked face turns
    // inward: on a cut sheet the machine marks the face that is up, which becomes the
    // INSIDE of the box, and a printed sheet is marked on its underside for exactly that
    // reason, which becomes the outside. Every panel here folds towards +Z, so the net's
    // +Z face is the box's inside and its -Z face is the outside. So 'top' marks sit at
    // +z facing +Z and 'bottom' marks at -z facing -Z, and either way what you see on
    // the folded box is what the file will actually produce.
    const markZ = net.markFace === 'bottom' ? -(half + 0.02) : half + 0.02;
    for (const mark of net.marks) {
      if (mark.panelId !== panel.id) continue;
      const outers = mark.rings.filter((r) => signedArea(r) > 0);
      const holes = mark.rings.filter((r) => signedArea(r) <= 0);
      for (const outer of outers) {
        const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(...toLocal(p, frame))));
        for (const h of holes) {
          const probe = h[0];
          if (probe && pointInRing(probe, outer)) {
            shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(...toLocal(p, frame)))));
          }
        }
        const geo = new THREE.ShapeGeometry(shape);
        geo.translate(0, 0, markZ);
        const mesh = new THREE.Mesh(geo, markZ < 0 ? decalBack : decalFront);
        // Exempt from the face-flip pass below, which decides a panel's light and dark
        // sides from which way it ends up pointing. A decal has one side by design.
        mesh.userData.decal = true;
        pivotFrame.add(mesh);
      }
      for (const line of mark.lines) {
        const pts = line.map((p) => {
          const l = toLocal(p, frame);
          return new THREE.Vector3(l[0], l[1], markZ);
        });
        pivotFrame.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), decalLine));
      }
    }

    // Stage from tree depth, which already reproduces "walls up, then dust flaps,
    // then the tuck last" on every style without a line of per-style authoring.
    // `order` overrides it for the handful of cases depth gets wrong — a tray's ears
    // have to fold before the side walls come up over them, and they are siblings.
    const stage = stageOf(panel);
    const span = 1 / (maxStage + 1);
    const t0 = Math.max(0, Math.min(0.85, (stage - 1) * span * 0.92));
    const node: PanelNode = {
      panel,
      frame: pivotFrame,
      pivot: pivotFrame,
      t0,
      t1: Math.min(1, t0 + span * 1.35),
      target: (crease?.foldAngle ?? panel.foldAngle) - (panel.undershoot ?? 0),
      overshoot: panel.overshoot ?? 0,
    };

    if (isRoot) {
      const c = centroid(panel.outline);
      const pose = panel.rootPose;
      node.rootFrom = new THREE.Vector3(c[0], c[1], 0);
      node.rootTo = new THREE.Vector3(
        primaryCentre[0] + (pose?.offset[0] ?? 0),
        primaryCentre[1] + (pose?.offset[1] ?? 0),
        pose?.offset[2] ?? 0,
      );
      node.rootTilt = (pose?.flip ? Math.PI : 0) + (pose?.tilt ?? 0);
      if (pose?.tilt) {
        // No overlap with the stage before it, unlike every other stage: the box must
        // not start tipping while its last tuck is still going in.
        const lastFoldT1 = Math.min(1, (maxFoldStage - 1) * span * 0.92 + span * 1.35);
        node.t0 = Math.min(0.85, lastFoldT1);
        node.t1 = Math.min(1, node.t0 + span * 1.35);
        node.rootEdge = polysBounds([panel.outline])[1] - c[1];
      } else {
        node.t0 = 0.45;
        node.t1 = 1;
        if (pose?.flip) {
          // Turned over about its own middle, a lid the size of the tray swept half of
          // itself 18 mm through the plate. Lifted by half its diagonal at mid-turn it
          // clears the table however it is proportioned, and reads as picked up,
          // turned over and set down.
          const [x0, y0, x1, y1] = polysBounds([panel.outline]);
          node.rootHover = Math.hypot(x1 - x0, y1 - y0) / 2;
        }
      }
    }

    // A web half is driven by its wall, not by its own stage, so find that wall now.
    // `a` hangs off the wall directly; `b` hangs off `a`, so the wall is one further up.
    if (panel.web) {
      const parentNode = nodeById.get(panel.parent!);
      const wall = panel.web === 'a' ? parentNode : nodeById.get(parentNode?.panel.parent ?? '');
      if (wall) {
        node.web = {
          kind: panel.web,
          hand: 1,
          wall,
          sign: Math.sign(panel.foldAngle) || 1,
          // The press flat starts the moment the walls stop rising — before then the
          // loop is rigid and any press of our own would tear the corner open again.
          pressT0: wall.t1,
          pressT1: Math.min(1, wall.t1 + span * 1.35),
        };
      }
    }

    nodes.push(node);
    nodeById.set(panel.id, node);
  }

  /** Where a net-space point on `node`'s panel currently is in the world. The panel
   *  polygon is authored in the pivot's own frame, so this is just the same transform
   *  the geometry got. */
  function worldOf(node: PanelNode, v: Pt): THREE.Vector3 {
    const l = toLocal(v, frames.get(node.panel.id)!);
    return new THREE.Vector3(l[0], l[1], 0).applyMatrix4(node.pivot.matrixWorld);
  }

  /** Which way does each corner's diagonal fold?
   *
   *  Both senses arrive at the same doubled-over pose, so nothing about the finished
   *  box distinguishes them — only the path there does, and picking wrong swings the
   *  web out through the middle of the tray and back. Rather than infer the chirality
   *  from edge windings (which `buildNet` is free to emit either way round, and which
   *  quietly got two corners of four right), measure it: find the panel across the
   *  corner that this web is cut from, fold half way, and keep whichever sense leaves
   *  the two still joined. Self-checking, and it stays right for any web built later. */
  function calibrateWebs(): void {
    const key = (v: Pt) => `${v[0].toFixed(3)},${v[1].toFixed(3)}`;
    const owners = new Map<string, string[]>();
    for (const p of net.panels)
      for (const v of p.outline) {
        const k = key(v);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k)!.push(p.id);
      }

    for (const node of nodes) {
      if (node.web?.kind !== 'b') continue;
      // The far side of the corner: a panel sharing a whole edge with this web that is
      // not its parent. That edge is the join the fold tree had to drop.
      const shared = new Map<string, Pt[]>();
      for (const v of node.panel.outline)
        for (const id of owners.get(key(v)) ?? []) {
          if (id === node.panel.id || id === node.panel.parent) continue;
          if (!shared.has(id)) shared.set(id, []);
          shared.get(id)!.push(v);
        }
      const join = [...shared.entries()].find(([, vs]) => vs.length >= 2);
      const far = join && nodeById.get(join[0]);
      if (!join || !far) continue;

      // Half way up the wall, where the two senses are furthest apart.
      const probe = (node.web.wall.t0 + node.web.wall.t1) / 2;
      let best = 1;
      let bestGap = Infinity;
      for (const hand of [1, -1]) {
        node.web.hand = hand;
        setProgress(probe);
        object.updateMatrixWorld(true);
        const gap = Math.max(...join[1].map((v) => worldOf(node, v).distanceTo(worldOf(far, v))));
        if (gap < bestGap) {
          bestGap = gap;
          best = hand;
        }
      }
      node.web.hand = best;
    }
  }

  function setProgress(t: number): void {
    for (const n of nodes) {
      if (n.rootFrom && n.rootTo) {
        // A second blank travels to its place as the first one closes, so a two-piece
        // box assembles itself instead of appearing already stacked.
        const u = smoothstep(t, n.t0, n.t1);
        if (n.rootEdge !== undefined && n.rootTilt) {
          // Stand up about the bottom edge: the centroid swings on a quarter circle of
          // radius |edge| so the edge itself never leaves the plate. Whatever the
          // authored pose adds beyond that quarter circle is slid in linearly.
          const a = n.rootTilt * u;
          const e = n.rootEdge;
          n.frame.position.set(
            n.rootFrom.x + (n.rootTo.x - n.rootFrom.x) * u,
            n.rootFrom.y + e * (1 - Math.cos(a)) + (n.rootTo.y - n.rootFrom.y - e) * u,
            n.rootFrom.z - e * Math.sin(a) + (n.rootTo.z - n.rootFrom.z + e) * u,
          );
          n.frame.rotation.x = a;
          continue;
        }
        n.frame.position.lerpVectors(n.rootFrom, n.rootTo, u);
        if (n.rootHover) n.frame.position.z += n.rootHover * Math.sin(Math.PI * u);
        if (n.rootTilt) n.frame.rotation.x = n.rootTilt * u;
        continue;
      }
      if (n.web) {
        // Read the wall's angle as it stands RIGHT NOW rather than re-deriving it from
        // t. The wall is earlier in `nodes` (deepest-last), so it is already posed, and
        // reading it means the corner follows the wall through any retiming without
        // the two schedules ever needing to agree.
        const theta = Math.min(Math.PI / 2, Math.abs(n.web.wall.pivot.rotation.x));
        const press = smoothstep(t, n.web.pressT0, n.web.pressT1);
        if (n.web.kind === 'a') {
          // Out to 135 as the walls rise, then pressed back to 90 — flat against the
          // end. The swing is the same either hand: the hinge is shared with the wall,
          // and the frame normalisation above has already absorbed the reflection.
          n.pivot.rotation.x =
            n.web.sign * (webSwing(theta) - (WEB_SWING_FULL - Math.PI / 2) * press);
        } else {
          // The diagonal, exactly twice the wall angle. Its sense DOES follow the
          // corner's chirality — the diagonal is the one hinge whose direction the
          // mirror reverses — and both senses arrive at the same doubled-over pose,
          // which is why only the animation ever showed the difference. Ease off the
          // last hair so the two plies do not z-fight down the whole diagonal.
          n.pivot.rotation.x =
            n.web.sign * n.web.hand * 2 * theta - (n.panel.undershoot ?? 0) * press;
        }
        continue;
      }
      const u = smoothstep(t, n.t0, n.t1);
      // A dust flap swings past its target and settles back, which is what a flap
      // being pushed down by the panel closing over it actually does. Without it the
      // whole animation reads as CAD.
      const bump = n.overshoot > 0 ? Math.sin(Math.PI * u) * n.overshoot : 0;
      n.pivot.rotation.x = n.target * u + bump;
    }
  }

  calibrateWebs();

  // Which face ends up OUTSIDE depends on the style: a tray is rooted on its base so
  // +Z points into the box, a tube is rooted on a wall and tilts upright, so the same
  // +Z ends up pointing out. Rather than guess per style, close the box once and ask
  // each panel which way it actually faces.
  setProgress(1);
  object.updateMatrixWorld(true);
  {
    const centre = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const n = new THREE.Vector3();
    const c = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const node of nodes) {
      for (const child of node.pivot.children) {
        const m = child as THREE.Mesh;
        if (!m.isMesh || m.userData.decal || m.userData.edgeOf) continue;
        m.geometry.computeBoundingSphere();
        const sphere = m.geometry.boundingSphere;
        if (!sphere) continue;
        n.set(0, 0, 1).applyMatrix3(nm.getNormalMatrix(m.matrixWorld)).normalize();
        c.copy(sphere.center).applyMatrix4(m.matrixWorld).sub(centre);
        // A panel through the middle of the box — a base, a divider — has no outward
        // direction worth speaking of; leave it rather than flipping it on noise.
        if (c.lengthSq() < 1) continue;
        const plusZfacesOut = n.dot(c) > 0;
        const isInner = m.userData.innerOf !== undefined;
        m.material = plusZfacesOut
          ? (isInner ? backDark : frontLight)
          : (isInner ? backLight : frontDark);
      }
    }
  }
  setProgress(0);

  return {
    object,
    nodes,
    setProgress,
    dispose() {
      for (const m of mats) m.dispose();
      edgeMaterial.dispose();
      decalLine.dispose();
      object.traverse((c) => {
        const any = c as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
      });
    },
  };
}
