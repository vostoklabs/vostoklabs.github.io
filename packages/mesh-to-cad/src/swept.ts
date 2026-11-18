// Surfaces made by sweeping a profile curve: round an axis (a revolve) or along a direction (an
// extrude). CAD draws these from a sketched spline; their distance is the distance from the
// point's own profile coordinates to the profile curve.

import { type V3, basis, cross, dot, madd, norm, normalize, scale, sub } from './linalg';
import { type Spline, closest } from './bspline';

/**
 * A profile in the half-plane (rho, z) swept round the axis through o along unit a. `ref` (unit,
 * perpendicular to a) is the side the profile is written on in the file: away from the face, so
 * the seam of the revolution is too.
 */
export type Revolution = { kind: 'revolution'; o: V3; a: V3; ref: V3; profile: Spline };
/** A profile in the plane through o spanned by e1, e2 (e1 × e2 = a), swept along unit a. */
export type Extrusion = { kind: 'extrusion'; o: V3; a: V3; e1: V3; e2: V3; profile: Spline };
export type Swept = Revolution | Extrusion;

/** The point in the profile's own 2D coordinates: (rho, z) round an axis, (x, y) across a direction. */
export function profilePoint(s: { kind: 'revolution' | 'extrusion'; o: V3; a: V3 }, p: V3): [number, number] {
  const v = sub(p, s.o);
  if (s.kind === 'revolution') {
    const z = dot(v, s.a);
    return [norm(madd(v, s.a, -z)), z];
  }
  const [e1, e2] = basis(s.a);
  return [dot(v, e1), dot(v, e2)];
}

function local(s: Swept, p: V3): { q: [number, number]; u: V3; w: V3 } {
  const v = sub(p, s.o);
  if (s.kind === 'revolution') {
    const z = dot(v, s.a);
    const radial = madd(v, s.a, -z);
    const rho = norm(radial);
    return { q: [rho, z], u: rho > 1e-12 ? scale(radial, 1 / rho) : s.ref, w: s.a };
  }
  return { q: [dot(v, s.e1), dot(v, s.e2)], u: s.e1, w: s.e2 };
}

/**
 * Signed distance, positive on the side of the surface's own normal (dS/du × dS/dv as STEP
 * parametrises it). In profile coordinates that normal is the profile tangent turned clockwise,
 * for both kinds.
 */
export function sweptDistance(s: Swept, p: V3): number {
  const { q } = local(s, p);
  const c = closest(s.profile, q);
  const dx = q[0] - c.p[0], dy = q[1] - c.p[1];
  const d = Math.hypot(dx, dy);
  const side = dx * c.d1[1] - dy * c.d1[0];
  return side >= 0 ? d : -d;
}

export function sweptNormal(s: Swept, p: V3): V3 {
  const { q, u, w } = local(s, p);
  const c = closest(s.profile, q);
  const t = Math.hypot(c.d1[0], c.d1[1]) || 1;
  return normalize(madd(scale(u, c.d1[1] / t), w, -c.d1[0] / t));
}

/** The profile as a 3D curve, as the file needs it: on the `ref` side of the axis, or in its plane. */
export function profileIn3D(s: Swept): Spline {
  const map = (c: number[]): number[] =>
    s.kind === 'revolution'
      ? madd(madd(s.o, s.ref, c[0]), s.a, c[1])
      : madd(madd(s.o, s.e1, c[0]), s.e2, c[1]);
  return { degree: s.profile.degree, knots: s.profile.knots, ctrl: s.profile.ctrl.map(map) };
}

/** e1, e2 for an extrusion along a (right-handed, e1 × e2 = a). */
export function extrusionAxes(a: V3): { e1: V3; e2: V3 } {
  const [e1, e2] = basis(a);
  // basis() is right-handed already; checked here because the normal's sign depends on it.
  if (dot(cross(e1, e2), a) < 0) return { e1: e2, e2: e1 };
  return { e1, e2 };
}
