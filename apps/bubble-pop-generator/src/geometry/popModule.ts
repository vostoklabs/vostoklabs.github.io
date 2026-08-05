// The pop module: Ian's snap-fit socket, turned into the three solids the
// builder places. Runs in the geometry worker.
//
// `public/assets/pop-socket/pop-socket-module.3mf` holds three objects:
//   sleeve  — the housing tube (OD 19.55, bore 11.46, 13 tall)
//   beam    — one spring beam, bridging a pocket in the bore wall
//   button  — the plunger (16.43 tall, snap bead at z 8.23)
//
// We take the BEAM and the BUTTON from the mesh — they're the shapes that make
// the mechanism work and re-deriving them in code would be re-designing them.
// The sleeve is different: what the builder needs is its NEGATIVE (the void to
// cut out of the slab), and `solidCylinder − sleeveMesh` is a boolean between
// two surfaces that are meant to be coincident, tessellated differently. That
// leaves slivers. The negative is a bore, two chamfers and two boxes, and every
// one of those numbers is in POP — so we build it exactly, from the measurements,
// and `tests/geometry-sweep.mts` asserts it still contains the beam and clears
// the button.
import { POP } from '../types';
import { parse3MFObjects, type RawObject } from './threemfImport';

type Wasm = any;
type Solid = any;

export interface PopModule {
  /** Volume to subtract from the slab at each socket: bore + chamfers + pockets. */
  negative: Solid;
  /** Both spring beams, unioned, ready to add back into the body. */
  beams: Solid;
  /** The button, sitting at rest (skirt at z = 0). */
  button: Solid;
}

function bbox(m: RawObject) {
  const v = m.vertProperties;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (v[i + a] < min[a]) min[a] = v[i + a];
      if (v[i + a] > max[a]) max[a] = v[i + a];
    }
  }
  return { min, max };
}

function meshToSolid(wasm: Wasm, o: RawObject, dx: number, dy: number): Solid {
  const verts = new Float32Array(o.vertProperties);
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] -= dx;
    verts[i + 1] -= dy;
  }
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(o.triVerts) });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
}

/** Identify the three objects by shape, not by id — a re-export from Plasticity
 *  may renumber them, and silently swapping the button for the sleeve would
 *  produce a model that looks plausible and cannot possibly work. */
function classify(objs: RawObject[]) {
  if (objs.length < 3) throw new Error(`pop module: expected 3 objects, found ${objs.length}`);
  const withBox = objs.map((o) => ({ o, b: bbox(o) }));
  const spanXY = (e: (typeof withBox)[number]) =>
    Math.max(e.b.max[0] - e.b.min[0], e.b.max[1] - e.b.min[1]);
  const spanZ = (e: (typeof withBox)[number]) => e.b.max[2] - e.b.min[2];

  // The sleeve is the widest thing in the file (OD 19.55).
  const sleeve = withBox.reduce((a, b) => (spanXY(a) >= spanXY(b) ? a : b));
  const rest = withBox.filter((e) => e !== sleeve);
  // Of what's left, the button is the tall one (16.43 vs the beam's 1.32).
  const button = rest.reduce((a, b) => (spanZ(a) >= spanZ(b) ? a : b));
  const beam = rest.find((e) => e !== button)!;

  const tol = 0.5;
  if (Math.abs(spanXY(sleeve) - POP.outerDiameter) > tol) {
    throw new Error(
      `pop module: housing is ⌀${spanXY(sleeve).toFixed(2)}, expected ⌀${POP.outerDiameter}. ` +
        'The CAD changed — re-measure it and update POP in types.ts before shipping.',
    );
  }
  if (Math.abs(spanZ(button) - POP.buttonHeight) > tol) {
    throw new Error(
      `pop module: button is ${spanZ(button).toFixed(2)} mm tall, expected ${POP.buttonHeight}. ` +
        'The CAD changed — re-measure it and update POP in types.ts before shipping.',
    );
  }
  return { sleeve, button, beam };
}

/** Build the three solids. `clearance` is an extra DIAMETRAL allowance on the
 *  bore only — the beam and the bead keep their designed 0.52 mm interference. */
export function loadPopModule(wasm: Wasm, buffer: ArrayBuffer, clearance: number): PopModule {
  const { Manifold } = wasm;
  const { sleeve, button, beam } = classify(parse3MFObjects(buffer));

  // The socket axis. Taken from the sleeve because it's the only object that is
  // truly concentric and finely tessellated; the beam sits off to one side, so
  // its own centre is meaningless here.
  const ax = (sleeve.b.min[0] + sleeve.b.max[0]) / 2;
  const ay = (sleeve.b.min[1] + sleeve.b.max[1]) / 2;

  const c = Math.max(-0.3, Math.min(0.6, clearance)) / 2; // diametral → radial
  const rBore = POP.boreDiameter / 2 + c;
  const rMouth = POP.boreChamferDiameter / 2 + c;
  const h = POP.height;
  const eps = 0.02;

  // Bore, run past both faces so the boolean never resolves coplanar caps.
  const parts: Solid[] = [Manifold.cylinder(h + 2 * eps, rBore, rBore, 96).translate([0, 0, -eps])];

  // Chamfers at both mouths. The cone is extrapolated the extra `eps` below the
  // face so its slope is preserved rather than truncated.
  const slope = (rMouth - rBore) / POP.boreChamfer;
  const rAtEps = rMouth + slope * eps;
  parts.push(
    Manifold.cylinder(POP.boreChamfer + eps, rAtEps, rBore, 96).translate([0, 0, -eps]),
    Manifold.cylinder(POP.boreChamfer + eps, rBore, rAtEps, 96).translate([0, 0, h - POP.boreChamfer]),
  );

  // The two spring-beam pockets. Blind: they stop short of the outer wall.
  const w = POP.window;
  const pocket = Manifold.cube([w.rOut - w.rIn, 2 * w.halfY, w.zMax - w.zMin], true).translate([
    (w.rIn + w.rOut) / 2,
    0,
    (w.zMin + w.zMax) / 2,
  ]);
  // Rotate, never mirror — a mirrored pocket is the enantiomorph of the one the
  // beam was drawn for, and the beam would no longer fit it.
  parts.push(pocket, pocket.rotate([0, 0, 180]));

  const negative = Manifold.union(parts);

  const beamSolid = meshToSolid(wasm, beam.o, ax, ay);
  const beams = Manifold.union([beamSolid, beamSolid.rotate([0, 0, 180])]);

  // The button is concentric, so its own centre is the most accurate origin.
  const bx = (button.b.min[0] + button.b.max[0]) / 2;
  const by = (button.b.min[1] + button.b.max[1]) / 2;
  const buttonSolid = meshToSolid(wasm, button.o, bx, by);

  return { negative, beams, button: buttonSolid };
}
