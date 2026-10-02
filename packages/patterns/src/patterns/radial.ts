// Radial patterns, all drawn about the region's centre: a layered mandala, the Art-Deco
// stepped fan, a rotational repeat of one motif, a spoked wheel, and concentric polygons.
//
// The bounded ones (mandala, fan, wheel) take a `radius` where 0 means "fit the piece" — what
// a coaster wants, what makes a 40 mm picker tile read, and what keeps them honest in a region
// of any size. `rotational` keeps a real millimetre radius instead, because its `web()` has to
// be a number and a fitted one would not be.
import { SIZE, SPACING, num, number, select, str, toggle } from '../params';
import { TAU, arc, circle, circleSegments, regularPolygon, slot, star } from '../geom';
import { rng } from './fields';
import type { Box, Island, Params, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

const geo = (holes: Ring[] = [], lines: Polyline[] = []): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines, slits: [] });

/** How far the box reaches from the origin — an unbounded radial field draws out to this. */
const reach = (b: Box): number => Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

/** The outer radius a bounded pattern draws to: the param, or the largest circle inside the
 *  region's box when it is 0. */
const outer = (b: Box, p: Params): number => {
  const r = num(p, 'radius');
  return r > 0 ? r : Math.max(1, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2);
};

const RADIUS = () => number('radius', 'Outer radius', 0, 0, 500, 1, 'mm', '0 sizes the pattern to the piece.');

const closed = (ring: Pt[]): Polyline => [...ring, ring[0]!];

/** A closed annular sector: radii r0..r1 between angles a0..a1. */
function sector(r0: number, r1: number, a0: number, a1: number): Ring {
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / TAU) * circleSegments(r1)));
  const out: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push([r1 * Math.cos(t), r1 * Math.sin(t)]);
  }
  if (r0 < 0.05) out.push([0, 0]);
  else for (let i = steps; i >= 0; i--) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push([r0 * Math.cos(t), r0 * Math.sin(t)]);
  }
  return out;
}

/** A petal in polar: from radius a to radius b about angle t, half-width w radians. `bulge`
 *  shapes the sides — under 1 it swells near the inner end, over 1 it narrows to two points. */
function petal(a: number, b: number, t: number, w: number, bulge: number): Ring {
  const steps = 14;
  const at = (u: number, s: number): Pt => {
    const r = a + (b - a) * u;
    const dt = s * w * Math.pow(Math.sin(Math.PI * u), bulge);
    return [r * Math.cos(t + dt), r * Math.sin(t + dt)];
  };
  const out: Ring = [];
  for (let i = 0; i <= steps; i++) out.push(at(i / steps, 1));
  for (let i = steps - 1; i >= 1; i--) out.push(at(i / steps, -1));
  return out;
}

// ---- mandala ---------------------------------------------------------------------------------

// Concentric bands about one centre, each band a ring of motifs whose count is a multiple of
// the symmetry order, phase-shifted against its neighbour so the motifs interlock instead of
// lining up into spokes. The seed picks each band's motif, its petal shape and how many times
// it repeats; every circle is sampled at a multiple of `n` points, so the whole drawing maps
// onto itself exactly when it is turned by 360/n.
export const mandala: PatternDef = {
  id: 'mandala',
  name: 'Mandala',
  family: 'radial',
  tags: ['lines', 'radial', 'rosette', 'symmetry', 'petals', 'ornament'],
  blurb: 'Layered bands of petals, dots and spikes about one centre — turn it by 360/n and nothing moves.',
  ops: ['score', 'engrave'],
  params: [
    number('n', 'Symmetry', 12, 4, 24, 1, '', 'How many times the whole drawing repeats round the centre.'),
    number('bands', 'Bands', 4, 1, 8, 1, ''),
    number('inner', 'Clear centre', 6, 0, 200, 0.5),
    RADIUS(),
    number('seed', 'Seed', 5, 1, 9999, 1, ''),
  ],
  generate: (box, p) => {
    const n = Math.round(num(p, 'n'));
    const bands = Math.round(num(p, 'bands'));
    const R = outer(box, p);
    const r0 = Math.max(0, Math.min(num(p, 'inner'), R - 1));
    const step = (R - r0) / bands;
    const seed = Math.round(num(p, 'seed'));
    const lines: Polyline[] = [];
    // A circle sampled at a multiple of n points: turning by 360/n permutes its samples.
    const band = (r: number): void => {
      if (r < 0.2) return;
      lines.push(closed(regularPolygon(0, 0, r, n * Math.max(2, Math.ceil(circleSegments(r) / n)))));
    };
    band(r0);
    for (let j = 0; j < bands; j++) {
      const a = r0 + j * step;
      const b = a + step;
      const rand = rng(seed * 7919 + j * 104729 + 31);
      // A band repeats its motif a whole multiple of n times, and only an outer band — which
      // has the circumference for it — is allowed the higher multiples.
      const count = n * (1 + Math.min(j, Math.floor(rand() * 3)));
      const kind = Math.floor(rand() * 4);
      const bulge = 0.8 + rand() * 1.1;
      const w = (Math.PI / count) * (0.5 + rand() * 0.3);
      const phase = j % 2 ? Math.PI / count : 0;
      const mid = (a + b) / 2;
      for (let i = 0; i < count; i++) {
        const t = phase + (TAU * i) / count;
        if (kind === 2) {
          const rr = Math.min(step * 0.3, mid * Math.sin(Math.PI / count) * 0.8);
          if (rr < 0.15) continue;
          lines.push(closed(regularPolygon(mid * Math.cos(t), mid * Math.sin(t), rr, 16, t)));
        } else if (kind === 3) {
          lines.push(closed([[a * Math.cos(t), a * Math.sin(t)], [mid * Math.cos(t + w), mid * Math.sin(t + w)], [b * Math.cos(t), b * Math.sin(t)], [mid * Math.cos(t - w), mid * Math.sin(t - w)]]));
        } else {
          lines.push(closed(petal(a + step * 0.12, b - step * 0.12, t, w, bulge)));
        }
      }
      band(b);
    }
    return geo([], lines);
  },
  thumb: { params: { n: 8, bands: 3, inner: 4 } },
};

// ---- deco fan --------------------------------------------------------------------------------

// Nested bands of wedges, each band cut a whole multiple finer than the one inside it so the
// dividers still line up — the 1920s stepped fan. The wedges are the geometry: cut they are
// the holes, scored they draw the band arcs and dividers as a deco double rule.
export const decoFan: PatternDef = {
  id: 'deco-fan',
  name: 'Deco fan',
  family: 'radial',
  tags: ['radial', 'art deco', 'fan', 'sunburst', 'stepped', 'holes'],
  blurb: 'The 1920s stepped fan: nested bands of wedges, each band cut finer than the one inside it.',
  ops: ['score', 'cut', 'engrave'],
  params: [
    number('bands', 'Bands', 4, 1, 12, 1, ''),
    number('sectors', 'Wedges in the first band', 6, 1, 60, 1, ''),
    number('grow', 'Finer per band', 1, 0, 4, 1, '', 'Each band outward is cut this many times finer than the first.'),
    number('span', 'Fan angle', 360, 20, 360, 5, '°', 'Under 360° the fan opens upward.'),
    number('inner', 'Clear centre', 8, 0, 200, 0.5),
    number('gap', 'Gap', 1.5, 0.2, 30, 0.1, 'mm', 'Material left between neighbouring wedges.'),
    RADIUS(),
    toggle('edges', 'Outlines only', false, 'Score the band arcs and dividers as single lines instead of cutting the wedges out.'),
  ],
  generate: (box, p) => {
    const bands = Math.round(num(p, 'bands'));
    const first = Math.max(1, Math.round(num(p, 'sectors')));
    const grow = Math.round(num(p, 'grow'));
    const span = Math.min(TAU, (num(p, 'span') * Math.PI) / 180);
    const full = span >= TAU - 1e-9;
    const a0 = full ? 0 : Math.PI / 2 - span / 2;
    const R = outer(box, p);
    const r0 = Math.max(0, Math.min(num(p, 'inner'), R - 1));
    const g = num(p, 'gap');
    const step = (R - r0) / bands;
    const edges = p.edges === true;
    const holes: Ring[] = [];
    const lines: Polyline[] = [];
    for (let j = 0; j < bands; j++) {
      const a = Math.max(r0 + j * step, 0.3);
      const b = r0 + (j + 1) * step;
      const count = first * (1 + j * grow);
      const dth = span / count;
      if (edges) {
        lines.push(full ? closed(circle(0, 0, a)) : arc(0, 0, a, a0, a0 + span));
        if (j === bands - 1) lines.push(full ? closed(circle(0, 0, b)) : arc(0, 0, b, a0, a0 + span));
        for (let i = 0; i <= (full ? count - 1 : count); i++) {
          const t = a0 + i * dth;
          lines.push([[a * Math.cos(t), a * Math.sin(t)], [b * Math.cos(t), b * Math.sin(t)]]);
        }
        continue;
      }
      // The half-angle whose CHORD at the inner radius is the gap — the straight-line distance
      // between two wedges is then exactly `gap` there, and wider further out.
      const d = Math.asin(Math.min(0.99, g / (2 * a)));
      if (dth / 2 - d <= 1e-4 || b - a - g < 0.2) continue;
      for (let i = 0; i < count; i++) {
        const t = a0 + i * dth;
        holes.push(sector(a + g / 2, b - g / 2, t + d, t + dth - d));
      }
    }
    return geo(holes, lines);
  },
  web: (p) => num(p, 'gap'),
  thumb: { params: { bands: 3, sectors: 5, inner: 3, gap: 0.6 } },
};

// ---- rotational repeat -----------------------------------------------------------------------

const MOTIFS = [
  { value: 'dot', label: 'Dot' },
  { value: 'slot', label: 'Slot' },
  { value: 'teardrop', label: 'Teardrop' },
  { value: 'petal', label: 'Petal' },
  { value: 'star', label: 'Star' },
];

/** Every motif fits a disc of diameter `s`, so one chord rule covers all of them. */
function motifRing(kind: string, s: number): Ring {
  if (kind === 'dot') return circle(0, 0, s / 2);
  if (kind === 'slot') return slot(0, 0, s, s * 0.42);
  if (kind === 'star') return star(0, 0, 5, s / 2, s / 4, 0);
  if (kind === 'teardrop') {
    const rc = s / 3;
    const cx = s / 2 - rc;
    const g = Math.acos(Math.min(1, rc / (cx + s / 2)));
    const out: Ring = [[-s / 2, 0]];
    for (let i = 0; i <= 18; i++) {
      const t = Math.PI + g + ((TAU - 2 * g) * i) / 18;
      out.push([cx + rc * Math.cos(t), rc * Math.sin(t)]);
    }
    return out;
  }
  const w = s * 0.26;
  const out: Ring = [];
  for (let i = 0; i <= 16; i++) out.push([-s / 2 + (s * i) / 16, w * Math.sin((Math.PI * i) / 16) ** 0.8]);
  for (let i = 15; i >= 1; i--) out.push([-s / 2 + (s * i) / 16, -(w * Math.sin((Math.PI * i) / 16) ** 0.8)]);
  return out;
}

interface Rosette { r: number; s: number; phase: number }

/** The rings that actually get drawn: one is skipped when its motifs would touch. */
function rosetteRings(p: Params): Rosette[] {
  const n = Math.round(num(p, 'count'));
  const ratio = num(p, 'ratio');
  const ph = (num(p, 'phase') * Math.PI) / 180;
  const out: Rosette[] = [];
  let r = num(p, 'radius');
  let s = num(p, 'size');
  for (let k = 0; k < Math.round(num(p, 'rings')); k++) {
    if (2 * r * Math.sin(Math.PI / n) - s > 0.05 && r - s / 2 > 0.05) out.push({ r, s, phase: ph + (k % 2 ? Math.PI / n : 0) });
    r *= ratio;
    s *= ratio;
  }
  return out;
}

export const rotational: PatternDef = {
  id: 'rotational',
  name: 'Rotational repeat',
  family: 'radial',
  tags: ['holes', 'radial', 'rosette', 'repeat', 'symmetry'],
  blurb: 'One motif repeated round a ring, and round smaller rings inside it — the rosette every radial design starts from.',
  ops: ['cut', 'engrave', 'score'],
  params: [
    select('motif', 'Motif', 'petal', MOTIFS),
    number('count', 'Per ring', 10, 3, 60, 1, ''),
    SIZE(8, 1, 60, 'Motif size'),
    number('radius', 'Ring radius', 24, 2, 300, 0.5),
    number('rings', 'Rings', 2, 1, 6, 1, ''),
    number('ratio', 'Inner ring ÷ outer', 0.55, 0.2, 0.9, 0.01, ''),
    number('phase', 'Turn', 0, 0, 360, 1, '°'),
  ],
  generate: (_box, p) => {
    const n = Math.round(num(p, 'count'));
    const kind = str(p, 'motif', 'petal');
    const holes: Ring[] = [];
    for (const ring of rosetteRings(p)) {
      const shape = motifRing(kind, ring.s);
      for (let i = 0; i < n; i++) {
        const t = ring.phase + (TAU * i) / n;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        holes.push(shape.map(([x, y]): Pt => [ring.r * cos + x * cos - y * sin, ring.r * sin + x * sin + y * cos]));
      }
    }
    return geo(holes);
  },
  web: (p) => {
    const n = Math.round(num(p, 'count'));
    const rings = rosetteRings(p);
    let w = Infinity;
    for (let k = 0; k < rings.length; k++) {
      const a = rings[k]!;
      w = Math.min(w, 2 * a.r * Math.sin(Math.PI / n) - a.s);
      const b = rings[k + 1];
      if (b) w = Math.min(w, a.r - b.r - (a.s + b.s) / 2);
    }
    return Math.max(0.05, Number.isFinite(w) ? w : 0.05);
  },
  thumb: { params: { radius: 13, size: 6, count: 8 } },
};

// ---- wheel -----------------------------------------------------------------------------------

// A hub, a rim and spokes — drawn as what the laser removes: the sectors between the spokes.
// Optional ring webs split each sector radially for the gear look. Every hole stops `spoke`
// short of its neighbour, so the part comes off the bed in one piece.
export const wheel: PatternDef = {
  id: 'wheel',
  name: 'Wheel',
  family: 'radial',
  tags: ['holes', 'radial', 'spokes', 'gear', 'trivet', 'vent'],
  blurb: 'Hub, rim and spokes with the sectors between them cut away — a trivet, a gear-look coaster.',
  ops: ['cut', 'engrave', 'score'],
  params: [
    number('spokes', 'Spokes', 8, 3, 36, 1, ''),
    number('spoke', 'Spoke width', 4, 0.5, 40, 0.5),
    number('hub', 'Hub radius', 10, 1, 200, 0.5),
    number('rim', 'Rim width', 5, 0.5, 60, 0.5),
    number('rings', 'Ring webs', 1, 0, 4, 1, '', 'Rings of material between the hub and the rim.'),
    number('phase', 'Turn', 0, 0, 360, 1, '°'),
    RADIUS(),
  ],
  generate: (box, p) => {
    const R = outer(box, p);
    const n = Math.round(num(p, 'spokes'));
    const w = num(p, 'spoke');
    const hub = num(p, 'hub');
    const rin = R - num(p, 'rim');
    const bands = Math.round(num(p, 'rings')) + 1;
    const span = (rin - hub - (bands - 1) * w) / bands;
    if (span < 0.3 || hub < 0.2) return geo();
    const ph = (num(p, 'phase') * Math.PI) / 180;
    const dth = TAU / n;
    const holes: Ring[] = [];
    for (let k = 0; k < bands; k++) {
      const a = hub + k * (span + w);
      // A chord of `spoke` at the sector's inner radius: the spoke is that wide at its narrowest.
      const d = Math.asin(Math.min(0.99, w / (2 * a)));
      if (dth / 2 - d <= 1e-4) continue;
      for (let i = 0; i < n; i++) {
        const t = ph + i * dth;
        holes.push(sector(a, a + span, t + d, t + dth - d));
      }
    }
    return geo(holes);
  },
  web: (p) => num(p, 'spoke'),
  thumb: { params: { hub: 4, rim: 2, spoke: 1.5, rings: 0 } },
};

// ---- concentric polygons ---------------------------------------------------------------------

export const polygonRings: PatternDef = {
  id: 'polygon-rings',
  name: 'Polygon rings',
  family: 'radial',
  tags: ['lines', 'concentric', 'polygon', 'octagon', 'radial'],
  blurb: 'Concentric regular polygons of any number of sides, each one turned a little further than the last if you want.',
  ops: ['score', 'engrave'],
  params: [
    number('sides', 'Sides', 8, 3, 16, 1, ''),
    SPACING(5, 0.5, 60),
    number('inner', 'First ring', 5, 0, 200, 0.5),
    number('phase', 'Turn', 0, 0, 360, 1, '°'),
    number('twist', 'Twist per ring', 0, -45, 45, 1, '°'),
  ],
  generate: (box, p) => {
    const k = Math.round(num(p, 'sides'));
    const s = num(p, 'spacing');
    // A polygon of circumradius r covers the box once its inradius does.
    const R = reach(box) / Math.cos(Math.PI / k);
    const ph = (num(p, 'phase') * Math.PI) / 180;
    const tw = (num(p, 'twist') * Math.PI) / 180;
    const lines: Polyline[] = [];
    let j = 0;
    for (let r = num(p, 'inner'); r <= R + s; r += s, j++) {
      if (r < 0.2) continue;
      lines.push(closed(regularPolygon(0, 0, r, k, ph + j * tw)));
    }
    return geo([], lines);
  },
};

export const RADIAL: PatternDef[] = [mandala, decoFan, rotational, wheel, polygonRings];
