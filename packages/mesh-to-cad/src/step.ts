// Writes a boundary representation as a STEP file (ISO 10303-21, AP214 "automotive_design"),
// one solid in millimetres: the entity set every CAD package reads.

import { type V3, basis, dot, madd, normalize } from './linalg';
import { type Spline, compressKnots } from './bspline';
import { type Surface } from './surfaces';
import { profileIn3D } from './swept';
import { type Brep, type Curve } from './topology';

class Writer {
  private lines: string[] = [];
  private n = 0;
  add(entity: string): string {
    this.n++;
    this.lines.push(`#${this.n}=${entity};`);
    return `#${this.n}`;
  }
  text(): string { return this.lines.join('\n'); }
}

/** A STEP REAL: always has a decimal point (1. , 2.5 , 1.E-07). */
export function real(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`not a finite number: ${x}`);
  if (Math.abs(x) < 1e-14) return '0.';
  let s = String(+x.toPrecision(15));
  if (!s.includes('.') && !s.includes('e')) s += '.';
  s = s.replace(/^(-?\d+)e/, '$1.e').toUpperCase();
  return s;
}

/** The least a swept profile is written running on past each end (mm), and the share of its own length. */
const RUN_ON = 0.1, RUN_ON_SHARE = 0.02;

/**
 * A swept profile running straight on a little past each end. A face's outline can end a hair
 * beyond the profile its surface was read from (its last vertices sit on the curve where the next
 * face begins), and a surface that stops short of its own outline is one an importer cannot trim:
 * its repair gives up on the whole file. The curve itself is unchanged; a straight piece is added
 * at each end, leaving it as the curve does. `keep`: whether the far end of a piece may be there.
 */
function runOn(c: Spline, keep: (far: number[]) => boolean = () => true): Spline {
  const n = c.ctrl.length, K = c.knots.length;
  // Only a cubic held at both ends (four equal knots), which is how every profile is made.
  if (c.degree !== 3 || n < 4 || c.knots[3] !== c.knots[0] || c.knots[K - 4] !== c.knots[K - 1]) return c;
  let length = 0;
  for (let i = 0; i + 1 < n; i++) length += Math.hypot(...c.ctrl[i].map((x, d) => c.ctrl[i + 1][d] - x));
  const L = Math.max(RUN_ON, RUN_ON_SHARE * length), span = RUN_ON_SHARE * (c.knots[K - 1] - c.knots[0]);
  const ctrl = c.ctrl.map((q) => [...q]), knots = [...c.knots];
  const piece = (from: number[], before: number[]) => {
    const d = from.map((x, i) => x - before[i]), size = Math.hypot(...d);
    if (!(size > 1e-12)) return null;
    const at = (k: number) => from.map((x, i) => x + (d[i] / size) * ((L * k) / 3));
    return keep(at(3)) ? [at(1), at(2), at(3)] : null;
  };
  const after = piece(ctrl[n - 1], ctrl[n - 2]);
  if (after) { const k = knots.pop()! + span; knots.push(k, k, k, k); ctrl.push(...after); }
  const ahead = piece(ctrl[0], ctrl[1]);
  if (ahead) { const k = knots.shift()! - span; knots.unshift(k, k, k, k); ctrl.unshift(...ahead.reverse()); }
  return { degree: 3, knots, ctrl };
}

/** Whether a point is further from an axis than a profile is run on: a profile must not be run on across its own axis. */
function offAxis(q: number[], o: V3, a: V3): boolean {
  const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]], h = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  return Math.hypot(d[0] - h * a[0], d[1] - h * a[1], d[2] - h * a[2]) > RUN_ON;
}

export function writeStep(b: Brep, name = 'Part', tolerance = 1e-3): string {
  const w = new Writer();
  const P = (p: V3) => w.add(`CARTESIAN_POINT('',(${real(p[0])},${real(p[1])},${real(p[2])}))`);
  const D = (d: V3) => { const u = normalize(d); return w.add(`DIRECTION('',(${real(u[0])},${real(u[1])},${real(u[2])}))`); };
  const AX = (o: V3, z: V3, x?: V3) => {
    const zz = normalize(z);
    const xx = x ? normalize(madd(x, zz, -dot(x, zz))) : basis(zz)[0];
    return w.add(`AXIS2_PLACEMENT_3D('',${P(o)},${D(zz)},${D(xx)})`);
  };

  const app = w.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const pc = w.add(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const prod = w.add(`PRODUCT('${name}','${name}','',(${pc}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
  const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pdc = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  const pd = w.add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
  const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);

  const len = w.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const ang = w.add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const sol = w.add(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  // The solid's own measured tolerance where it has one (never less than asked for): the gap its
  // edges actually meet, so an importer neither sees open edges nor merges real features.
  const stated = Math.max(tolerance, b.tolerance ?? 0);
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(stated)}),${len},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${len},${ang},${sol})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);

  const spline = (c: Spline): string => {
    const { knots, mults } = compressKnots(c.knots);
    const pts = c.ctrl.map((q) => P(q as V3)).join(',');
    return w.add(`B_SPLINE_CURVE_WITH_KNOTS('',${c.degree},(${pts}),.UNSPECIFIED.,.F.,.F.,(${mults.join(',')}),(${knots.map(real).join(',')}),.UNSPECIFIED.)`);
  };
  // Faces on one surface share the object, and the file holds it once.
  const written = new Map<Surface, string>();
  const surface = (s: Surface): string => {
    let id = written.get(s);
    if (id === undefined) written.set(s, (id = surfaceEntity(s)));
    return id;
  };
  const surfaceEntity = (s: Surface): string => {
    switch (s.kind) {
      case 'revolution':
        return w.add(`SURFACE_OF_REVOLUTION('',${spline(runOn(profileIn3D(s), (q) => offAxis(q, s.o, s.a)))},${w.add(`AXIS1_PLACEMENT('',${P(s.o)},${D(s.a)})`)})`);
      case 'extrusion':
        return w.add(`SURFACE_OF_LINEAR_EXTRUSION('',${spline(runOn(profileIn3D(s)))},${w.add(`VECTOR('',${D(s.a)},1.)`)})`);
      case 'bspline': {
        const ku = compressKnots(s.knotsU), kv = compressKnots(s.knotsV);
        const net = s.ctrl.map((row) => `(${row.map((q) => P(q as V3)).join(',')})`).join(',');
        return w.add(`B_SPLINE_SURFACE_WITH_KNOTS('',${s.degU},${s.degV},(${net}),.UNSPECIFIED.,.F.,.F.,.F.,(${ku.mults.join(',')}),(${kv.mults.join(',')}),(${ku.knots.map(real).join(',')}),(${kv.knots.map(real).join(',')}),.UNSPECIFIED.)`);
      }
      case 'plane': return w.add(`PLANE('',${AX(s.o, s.n)})`);
      case 'cylinder': return w.add(`CYLINDRICAL_SURFACE('',${AX(s.o, s.a)},${real(s.r)})`);
      case 'sphere': return w.add(`SPHERICAL_SURFACE('',${AX(s.c, s.pole ?? [0, 0, 1])},${real(s.r)})`);
      case 'torus': return w.add(`TOROIDAL_SURFACE('',${AX(s.c, s.a)},${real(s.R)},${real(s.r)})`);
      case 'cone': {
        // Placed one unit up the axis from the apex, where the radius is tan(semi-angle).
        const o = madd(s.apex, s.a, 1);
        return w.add(`CONICAL_SURFACE('',${AX(o, s.a)},${real(Math.tan(s.ang))},${real(s.ang)})`);
      }
    }
  };
  const curve = (c: Curve): string => {
    switch (c.kind) {
      case 'line': return w.add(`LINE('',${P(c.o)},${w.add(`VECTOR('',${D(c.d)},1.)`)})`);
      case 'circle': return w.add(`CIRCLE('',${AX(c.c, c.n, c.ref)},${real(c.r)})`);
      case 'bspline': {
        const pts = c.ctrl.map(P).join(',');
        return w.add(`B_SPLINE_CURVE_WITH_KNOTS('',${c.degree},(${pts}),.UNSPECIFIED.,.F.,.F.,(${c.mults.join(',')}),(${c.knots.map(real).join(',')}),.UNSPECIFIED.)`);
      }
    }
  };

  const vtx = b.vertices.map((p) => w.add(`VERTEX_POINT('',${P(p)})`));
  const edges = b.edges.map((e) => w.add(`EDGE_CURVE('',${vtx[e.v0]},${vtx[e.v1]},${curve(e.curve)},.T.)`));
  // A face written as part of another has no loops of its own and is not written.
  const faces = b.faces.map((f) => {
    if (!f.loops.length) return null;
    const bounds = f.loops.map((loop) => {
      const oes = loop.map((oe) => w.add(`ORIENTED_EDGE('',*,*,${edges[oe.edge]},${oe.fwd ? '.T.' : '.F.'})`));
      return w.add(`FACE_BOUND('',${w.add(`EDGE_LOOP('',(${oes.join(',')}))`)},.T.)`);
    });
    return w.add(`ADVANCED_FACE('',(${bounds.join(',')}),${surface(f.surf)},${f.sameSense ? '.T.' : '.F.'})`);
  });
  // One solid per body: faces joined through their edges. Separate bodies in one shell are not
  // a manifold solid, and a CAD package is right to refuse them.
  const body = faces.map((_, i) => i);
  const root = (i: number): number => (body[i] === i ? i : (body[i] = root(body[i])));
  for (const e of b.edges) body[root(e.faces[0])] = root(e.faces[1]);
  const bodies = new Map<number, string[]>();
  faces.forEach((f, i) => { if (f === null) return; const r = root(i); if (!bodies.has(r)) bodies.set(r, []); bodies.get(r)!.push(f); });
  let count = 0;
  const solids = [...bodies.values()].map((group) => {
    count++;
    return w.add(`MANIFOLD_SOLID_BREP('${bodies.size > 1 ? `${name} ${count}` : name}',${w.add(`CLOSED_SHELL('',(${group.join(',')}))`)})`);
  });
  const origin = AX([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${origin},${solids.join(',')}),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${name}'),'2;1');`,
    `FILE_NAME('${name}.step','${stamp}',(''),(''),'Vostok Labs mesh to CAD','Vostok Labs mesh to CAD','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;',
    'DATA;',
    w.text(),
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
