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
import { bboxOf } from '../geometry/poly';

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
}

function shapeFrom(outline: Poly, holes: Poly[], f: Frame): THREE.Shape {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(...toLocal(p, f))));
  for (const h of holes) {
    shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(...toLocal(p, f)))));
  }
  return shape;
}

function centroid(poly: Poly): Pt {
  const [minX, minY, maxX, maxY] = bboxOf([poly]);
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
    new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0, side });
  // Four, because a panel needs a light face and a dark face AND which of its two
  // sides is the outside depends on the style. Mutating `side` on a shared material
  // would flip the whole box at once.
  const frontLight = face(CARD, THREE.FrontSide);
  const backDark = face(INSIDE, THREE.BackSide);
  const frontDark = face(INSIDE, THREE.FrontSide);
  const backLight = face(CARD, THREE.BackSide);
  const mats = [frontLight, backDark, frontDark, backLight];

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
  const maxDepth = Math.max(1, ...ordered.map(depthOf));

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

    const geo = new THREE.ShapeGeometry(shapeFrom(panel.outline, panel.holes, frame));
    const mesh = new THREE.Mesh(geo, frontLight);
    mesh.userData.panelId = panel.id;
    pivotFrame.add(mesh);
    // Same geometry, back faces only. One extra draw call, no extra memory.
    const inner = new THREE.Mesh(geo, backDark);
    inner.userData.innerOf = panel.id;
    pivotFrame.add(inner);

    // The panel's own outline as a line, so every crease and cut stays visible once
    // the box is closed. This is the cheapest way to make a folded preview read as a
    // dieline rather than as an anonymous solid.
    const ring = panel.outline.map((p) => {
      const l = toLocal(p, frame);
      return new THREE.Vector3(l[0], l[1], 0.01);
    });
    pivotFrame.add(
      new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), edgeMaterial),
    );
    for (const hole of panel.holes) {
      const hp = hole.map((p) => {
        const l = toLocal(p, frame);
        return new THREE.Vector3(l[0], l[1], 0.01);
      });
      pivotFrame.add(
        new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hp), edgeMaterial),
      );
    }

    // Stage from tree depth, which already reproduces "walls up, then dust flaps,
    // then the tuck last" on every style without a line of per-style authoring.
    // `order` overrides it for the handful of cases depth gets wrong — a tray's ears
    // have to fold before the side walls come up over them, and they are siblings.
    const stage = panel.order ?? depthOf(panel);
    const span = 1 / (maxDepth + 1);
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
      node.t0 = 0.45;
      node.t1 = 1;
    }

    nodes.push(node);
    nodeById.set(panel.id, node);
  }

  function setProgress(t: number): void {
    for (const n of nodes) {
      if (n.rootFrom && n.rootTo) {
        // A second blank travels to its place as the first one closes, so a two-piece
        // box assembles itself instead of appearing already stacked.
        const u = smoothstep(t, n.t0, n.t1);
        n.frame.position.lerpVectors(n.rootFrom, n.rootTo, u);
        if (n.rootTilt) n.frame.rotation.x = n.rootTilt * u;
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
        if (!m.isMesh) continue;
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
      object.traverse((c) => {
        const any = c as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
      });
    },
  };
}
