// Field patterns: drawn about the region's centre rather than repeated — rays, rings, a
// spiral, sunflower dots, hatch fills for engraving, and the seeded ones (stipple, Truchet)
// that a tile cannot express because every cell has to differ.
import { SQRT3, arc, circle, slot } from '../geom';
import { SIZE, SPACING, num, number, toggle } from '../params';
import type { Box, Island, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

const geo = (holes: Ring[] = [], lines: Polyline[] = [], slits: Polyline[] = []): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines, slits });

/** How far the box reaches from the origin — every radial pattern draws out to this. */
const reach = (b: Box): number => Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

/** A small deterministic generator, so a seed always draws the same field. */
export function rng(seed: number): () => number {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export const hatch: PatternDef = {
  id: 'hatch',
  name: 'Hatch',
  family: 'engrave',
  tags: ['lines', 'engrave', 'fill', 'shading'],
  blurb: 'Parallel lines — the engraver\'s fill. Turn the whole pattern for the angle.',
  ops: ['engrave', 'score'],
  params: [SPACING(1, 0.1, 30)],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const lines: Polyline[] = [];
    for (let y = Math.floor(box.minY / s) * s; y <= box.maxY + s; y += s) lines.push([[box.minX - s, y], [box.maxX + s, y]]);
    return geo([], lines);
  },
};

export const crosshatch: PatternDef = {
  id: 'crosshatch',
  name: 'Crosshatch',
  family: 'engrave',
  tags: ['lines', 'engrave', 'fill', 'shading', 'grid'],
  blurb: 'Two families of lines crossing at a chosen angle.',
  ops: ['engrave', 'score'],
  params: [SPACING(1.5, 0.1, 30), number('angle', 'Crossing angle', 90, 15, 90, 5, '°')],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const a = (num(p, 'angle') * Math.PI) / 180;
    const R = reach(box) + s;
    const lines: Polyline[] = [];
    for (let y = -R; y <= R; y += s) lines.push([[-R, y], [R, y]]);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (let d = -R; d <= R; d += s) {
      // The second family: lines at angle a, perpendicular offset d.
      const nx = -sin;
      const ny = cos;
      lines.push([[nx * d - cos * R, ny * d - sin * R], [nx * d + cos * R, ny * d + sin * R]]);
    }
    return geo([], lines);
  },
};

export const rays: PatternDef = {
  id: 'rays',
  name: 'Rays',
  family: 'radial',
  tags: ['lines', 'sunburst', 'radial', 'deco'],
  blurb: 'Lines from the centre outward — a sunburst, a compass rose.',
  ops: ['score', 'engrave'],
  params: [number('count', 'Rays', 24, 2, 360, 1, ''), number('inner', 'Clear centre', 10, 0, 200, 0.5), number('phase', 'Turn', 0, 0, 360, 1, '°')],
  generate: (box, p) => {
    const n = Math.round(num(p, 'count'));
    const r0 = num(p, 'inner');
    const R = reach(box) + 1;
    const ph = (num(p, 'phase') * Math.PI) / 180;
    const lines: Polyline[] = [];
    for (let i = 0; i < n; i++) {
      const t = ph + (2 * Math.PI * i) / n;
      lines.push([[r0 * Math.cos(t), r0 * Math.sin(t)], [R * Math.cos(t), R * Math.sin(t)]]);
    }
    // Cut out, the rays land on a solid hub the size of the clear centre — the sun of the
    // sunburst — so every ray is held at both ends; without it each is a finger held only at the
    // rim. Drawn round the circle (chords outside it), so every ray's end is on or inside it. A
    // score or an engrave never sees it.
    const hub = r0 > 0.2 ? [[circle(0, 0, r0 / Math.cos(Math.PI / 96), 96)]] : [];
    return { ...geo([], lines), solids: hub };
  },
};

export const rings: PatternDef = {
  id: 'rings',
  name: 'Rings',
  family: 'radial',
  tags: ['lines', 'concentric', 'circles', 'target', 'radial'],
  blurb: 'Concentric circles from the centre out.',
  ops: ['score', 'engrave'],
  params: [SPACING(4, 0.5, 60), number('inner', 'First ring', 4, 0, 200, 0.5)],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const R = reach(box);
    const lines: Polyline[] = [];
    for (let r = num(p, 'inner'); r <= R + s; r += s) {
      if (r < 0.2) continue;
      const c = circle(0, 0, r);
      lines.push([...c, c[0]!]);
    }
    return geo([], lines);
  },
};

export const radialSlots: PatternDef = {
  id: 'radial-slots',
  name: 'Radial slots',
  family: 'radial',
  tags: ['holes', 'radial', 'slots', 'wheel', 'vent'],
  blurb: 'Slots on rings about the centre — a wheel, a vent, a clock face.',
  ops: ['cut', 'engrave', 'score'],
  params: [number('count', 'Per ring', 12, 2, 120, 1, ''), number('length', 'Slot length', 8, 1, 100), number('height', 'Slot width', 2.5, 0.5, 30, 0.1), number('inner', 'First ring radius', 12, 0, 300, 0.5), number('step', 'Ring spacing', 12, 1, 100, 0.5)],
  generate: (box, p) => {
    const n = Math.round(num(p, 'count'));
    const L = num(p, 'length');
    const w = num(p, 'height');
    const R = reach(box) + L;
    const holes: Ring[] = [];
    let ring = 0;
    for (let r = num(p, 'inner'); r <= R; r += num(p, 'step'), ring++) {
      // Every other ring turns by half a step so the slots stagger.
      const ph = ring % 2 ? Math.PI / n : 0;
      // Slots crowd near the centre: skip any ring where they would touch.
      if ((2 * Math.PI * r) / n < L + w) continue;
      for (let i = 0; i < n; i++) {
        const t = ph + (2 * Math.PI * i) / n;
        const s = slot(0, 0, L, w);
        // A slot lies along the ring (tangent), centred at radius r.
        const ang = t + Math.PI / 2;
        holes.push(s.map(([x, y]): Pt => [r * Math.cos(t) + x * Math.cos(ang) - y * Math.sin(ang), r * Math.sin(t) + x * Math.sin(ang) + y * Math.cos(ang)]));
      }
    }
    return geo(holes);
  },
  web: (p) => Math.max(0.2, num(p, 'step') - num(p, 'height')),
  thumb: { params: { count: 8, length: 4, height: 1.4, inner: 5, step: 5 } },
};

export const spiral: PatternDef = {
  id: 'spiral',
  name: 'Spiral',
  family: 'radial',
  tags: ['lines', 'spiral', 'radial'],
  blurb: 'One line winding out from the centre at a steady pitch.',
  ops: ['score', 'engrave'],
  params: [number('pitch', 'Pitch', 3, 0.3, 60, 0.1), number('arms', 'Arms', 1, 1, 8, 1, '')],
  generate: (box, p) => {
    const pitch = num(p, 'pitch');
    const arms = Math.round(num(p, 'arms'));
    const R = reach(box) + pitch;
    const lines: Polyline[] = [];
    for (let k = 0; k < arms; k++) {
      const line: Polyline = [];
      const turns = R / (pitch * arms);
      const steps = Math.max(32, Math.ceil(turns * 2 * Math.PI * (R / 2) / 0.6));
      for (let i = 0; i <= steps; i++) {
        const t = (turns * 2 * Math.PI * i) / steps;
        const r = (pitch * arms * t) / (2 * Math.PI);
        const a = t + (2 * Math.PI * k) / arms;
        line.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      lines.push(line);
    }
    return geo([], lines);
  },
};

export const sunflower: PatternDef = {
  id: 'sunflower',
  name: 'Sunflower dots',
  family: 'radial',
  tags: ['holes', 'phyllotaxis', 'fibonacci', 'radial', 'organic'],
  blurb: 'Dots placed the way a sunflower places its seeds — the golden-angle spiral.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(3, 0.5, 30, 'Dot size'), SPACING(5, 1, 40), toggle('grow', 'Grow outward', false, 'Dots get larger away from the centre.')],
  generate: (box, p) => {
    const d = num(p, 'size');
    const c = num(p, 'spacing') / 2;
    const R = reach(box);
    const holes: Ring[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let n = 1; ; n++) {
      const r = c * Math.sqrt(n);
      if (r > R + d) break;
      const t = n * golden;
      const size = p.grow === true ? d * (0.4 + (0.6 * r) / (R || 1)) : d;
      holes.push(circle(r * Math.cos(t), r * Math.sin(t), size / 2));
    }
    return geo(holes);
  },
  web: (p) => Math.max(0.2, num(p, 'spacing') - num(p, 'size')),
};

export const stipple: PatternDef = {
  id: 'stipple',
  name: 'Stipple',
  family: 'organic',
  tags: ['holes', 'random', 'dots', 'texture', 'engrave'],
  blurb: 'Random dots at a chosen density — the same field every time for the same seed.',
  ops: ['engrave', 'cut', 'score'],
  params: [SIZE(1.2, 0.2, 20, 'Dot size'), number('density', 'Density', 30, 1, 100, 1, '%'), number('seed', 'Seed', 7, 1, 9999, 1, '')],
  generate: (box, p) => {
    const d = num(p, 'size');
    const density = num(p, 'density') / 100;
    const random = rng(num(p, 'seed'));
    // Blue-noise-ish: jitter a grid whose pitch gives the asked coverage, never closer than 1.4 d.
    const pitch = Math.max(1.4 * d, d / Math.sqrt(Math.max(density, 0.01)));
    const holes: Ring[] = [];
    for (let y = box.minY; y <= box.maxY + pitch; y += pitch) {
      for (let x = box.minX; x <= box.maxX + pitch; x += pitch) {
        if (random() > density * 1.6 + 0.2) continue;
        const jx = (random() - 0.5) * (pitch - 1.4 * d);
        const jy = (random() - 0.5) * (pitch - 1.4 * d);
        holes.push(circle(x + jx, y + jy, d / 2, 12));
      }
    }
    return geo(holes);
  },
  web: (p) => 0.4 * num(p, 'size'),
};

export const truchet: PatternDef = {
  id: 'truchet',
  name: 'Truchet arcs',
  family: 'organic',
  tags: ['lines', 'random', 'arcs', 'maze', 'generative'],
  blurb: 'Quarter-circle tiles turned at random into an endless winding maze.',
  ops: ['score', 'engrave'],
  params: [SIZE(8, 2, 80, 'Tile'), number('seed', 'Seed', 3, 1, 9999, 1, '')],
  generate: (box, p) => {
    const s = num(p, 'size');
    const random = rng(num(p, 'seed'));
    const lines: Polyline[] = [];
    const i0 = Math.floor(box.minX / s) - 1;
    const i1 = Math.ceil(box.maxX / s) + 1;
    const j0 = Math.floor(box.minY / s) - 1;
    const j1 = Math.ceil(box.maxY / s) + 1;
    // The seed decides per cell from a hash, so scrolling the region does not reshuffle the maze.
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const h = rng(num(p, 'seed') * 7919 + i * 104729 + j * 1299709 + 12345)();
        const x = i * s;
        const y = j * s;
        if (h < 0.5) {
          lines.push(arc(x, y, s / 2, 0, Math.PI / 2));
          lines.push(arc(x + s, y + s, s / 2, Math.PI, (3 * Math.PI) / 2));
        } else {
          lines.push(arc(x + s, y, s / 2, Math.PI / 2, Math.PI));
          lines.push(arc(x, y + s, s / 2, -Math.PI / 2, 0));
        }
      }
    }
    void random;
    return geo([], lines);
  },
};

export const hexRings: PatternDef = {
  id: 'hex-rings',
  name: 'Hexagon rings',
  family: 'radial',
  tags: ['lines', 'concentric', 'hexagon', 'radial'],
  blurb: 'Concentric hexagons from the centre out.',
  ops: ['score', 'engrave'],
  params: [SPACING(5, 0.5, 60), number('inner', 'First ring', 5, 0, 200, 0.5)],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const R = reach(box) * 2 / SQRT3;
    const lines: Polyline[] = [];
    for (let r = num(p, 'inner'); r <= R + s; r += s) {
      if (r < 0.2) continue;
      const ring: Pt[] = [];
      for (let k = 0; k < 6; k++) ring.push([r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
      lines.push([...ring, ring[0]!]);
    }
    return geo([], lines);
  },
};

export const FIELDS: PatternDef[] = [hatch, crosshatch, rays, rings, hexRings, radialSlots, spiral, sunflower, stipple, truchet];
