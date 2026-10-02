// Living hinges: the one family where lines ARE cut through. A slit is safe because the rows
// are short, staggered and separated by unbroken strips of material; the sheet stays one
// piece and the strips twist to let it bend.
//
// Numbers, for 3 mm ply/MDF (the hobby default): slits 20–30 mm long, 3 mm of web between the
// ends of two slits in a row, rows 1.5–2 mm apart, every other row offset by half a period.
// Tighter rows bend tighter and snap sooner; the fill's `web` warns below 1.5 mm.
import { SQRT3 } from '../geom';
import { SIZE, SPACING, num, number } from '../params';
import type { PatternDef, PatternGeometry, Polyline, Pt } from '../types';

const slitsOnly = (slits: Polyline[]): PatternGeometry => ({ holes: [], lines: [], slits });

/**
 * The tightest radius, in mm, a straight-slot lattice hinge will take without the links
 * shearing — the number to put beside the slider, not a promise about a particular sheet.
 *
 * A lattice hinge bends by TWISTING each link (the strip of material between two rows of
 * slits) rather than by bending the sheet. Rolling to radius R turns each link by
 * `spacing / R`, and that twist is spread along the link's free length, so the shear strain at
 * the surface is `thickness · spacing / (length · R)`. Setting that to the strain plywood
 * takes gives `R = t · spacing / (length · γ)`.
 *
 * γ = 0.055 is fitted to the published 3 mm birch-ply figures (Patrick Fenner / Deferred
 * Procrastination's lattice-hinge work, Ponoko's "How To Design a Living Hinge": 15–20 mm
 * slots, 1–1.4 mm webs, 3–4 mm rows → a minimum radius of about 10–12 mm, with 10 mm already
 * stressing the material). Fenner's own torsional-link worked example — t = 3, links 3 mm
 * wide, 0.2 mm kerf → 23 links and a 44 mm internal radius for 90° — is the same mechanism
 * counted per link.
 */
export function hingeBendRadius(hinge: { length: number; gap: number; spacing: number }, thickness: number): number {
  const SHEAR = 0.055;
  // The web at each slit end clamps the link, so the twisting span is a little short of the slit.
  const free = Math.max(0.5, hinge.length - hinge.gap);
  return (thickness * hinge.spacing) / (free * SHEAR);
}

export const livingHinge: PatternDef = {
  id: 'living-hinge',
  name: 'Living hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'lattice', 'kerf'],
  blurb: 'Staggered slits that let a flat sheet bend — the classic lattice hinge. Slits run across the fold; keep the fold along the slit direction.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    number('length', 'Slit length', 20, 4, 120, 0.5),
    number('gap', 'Web between slits', 3, 1, 20, 0.1, 'mm', 'Material left between the end of one slit and the start of the next in the same row.'),
    SPACING(1.8, 0.8, 12),
  ],
  cell: (p) => ({ w: num(p, 'length') + num(p, 'gap'), h: 2 * num(p, 'spacing') }),
  tile: (p) => {
    const L = num(p, 'length');
    const g = num(p, 'gap');
    const d = num(p, 'spacing');
    const w = L + g;
    return slitsOnly([
      [[g / 2, d / 2], [g / 2 + L, d / 2]],
      [[g / 2 + w / 2, (3 * d) / 2], [g / 2 + w / 2 + L, (3 * d) / 2]],
    ]);
  },
  web: (p) => Math.min(num(p, 'gap'), num(p, 'spacing')),
};

export const waveHinge: PatternDef = {
  id: 'wave-hinge',
  name: 'Wave hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'wave'],
  blurb: 'Sinuous slits in place of straight ones — bends the same way, looks like water.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    number('length', 'Slit length', 20, 4, 120, 0.5),
    number('gap', 'Web between slits', 3, 1, 20, 0.1),
    SPACING(2.6, 0.8, 12),
    number('amplitude', 'Wave depth', 0.4, 0.1, 3, 0.1),
  ],
  cell: (p) => ({ w: num(p, 'length') + num(p, 'gap'), h: 2 * num(p, 'spacing') }),
  tile: (p) => {
    const L = num(p, 'length');
    const g = num(p, 'gap');
    const d = num(p, 'spacing');
    const A = num(p, 'amplitude');
    const w = L + g;
    const wave = (x0: number, y0: number): Polyline => {
      const n = Math.max(8, Math.ceil(L / 0.5));
      const out: Polyline = [];
      for (let i = 0; i <= n; i++) {
        const x = (L * i) / n;
        out.push([x0 + x, y0 + A * Math.sin((2 * Math.PI * x) / L)]);
      }
      return out;
    };
    return slitsOnly([wave(g / 2, d / 2), wave(g / 2 + w / 2, (3 * d) / 2)]);
  },
  web: (p) => Math.min(num(p, 'gap'), num(p, 'spacing') - 2 * num(p, 'amplitude')),
};

/** A slit shortened by `trim` at both ends, so the corner it runs into keeps its bridge. */
function trimmed(a: Pt, b: Pt, trim: number): Polyline {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = Math.min(trim, 0.45 * len) / (len || 1);
  return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [b[0] - (b[0] - a[0]) * t, b[1] - (b[1] - a[1]) * t]];
}

/** How far back from a corner each slit must stop for `web` mm of material to be left, when
 *  the closest pair of slits there meet at `angle` degrees. */
const cornerTrim = (web: number, angleDeg: number): number => web / (2 * Math.sin((angleDeg * Math.PI) / 360));

export const diamondHinge: PatternDef = {
  id: 'diamond-hinge',
  name: 'Diamond hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'lattice', 'diamond', 'argyle'],
  blurb: 'Slits on a diamond lattice, cut short at every corner — the lattice hinge that will bend either way.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    number('width', 'Diamond width', 10, 3, 60),
    number('height', 'Diamond height', 14, 3, 80),
    number('gap', 'Corner web', 1.5, 0.6, 12, 0.1, 'mm', 'Material left where four slits meet.'),
  ],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'height') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = num(p, 'height');
    // Four slits meet at each lattice point, at ±α and 180 ± α: the tight pair is whichever of
    // 2α and 180 − 2α is smaller.
    const alpha = (Math.atan2(h, w) * 180) / Math.PI;
    const trim = cornerTrim(num(p, 'gap'), Math.min(2 * alpha, 180 - 2 * alpha));
    const diamond = (cx: number, cy: number): Polyline[] => {
      const v: Pt[] = [[cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy], [cx, cy - h / 2]];
      return v.map((a, i) => trimmed(a, v[(i + 1) % 4]!, trim));
    };
    // Both diamonds of the cell: the two share their edges and the engine drops the duplicates.
    return slitsOnly([...diamond(w / 2, h / 2), ...diamond(0, 0)]);
  },
  web: (p) => {
    const w = num(p, 'width');
    const h = num(p, 'height');
    return Math.min(num(p, 'gap'), (w * h) / (2 * Math.hypot(w, h)));
  },
};

export const crossHinge: PatternDef = {
  id: 'cross-hinge',
  name: 'Cross hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'cross', 'plus', 'dome'],
  blurb: 'Short crossed slits in offset rows — flexes in both directions at once, for a dome rather than a fold.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    number('length', 'Arm span', 6, 2, 40, 0.5),
    number('gap', 'Web between arms', 2, 0.6, 12, 0.1, 'mm', 'Material left between the arm of one cross and the next.'),
    SPACING(5, 1, 30),
  ],
  cell: (p) => ({ w: num(p, 'length') + num(p, 'gap'), h: 2 * num(p, 'spacing') }),
  tile: (p) => {
    const L = num(p, 'length');
    const d = num(p, 'spacing');
    const w = L + num(p, 'gap');
    const cross = (cx: number, cy: number): Polyline[] => [
      [[cx - L / 2, cy], [cx + L / 2, cy]],
      [[cx, cy - L / 2], [cx, cy + L / 2]],
    ];
    return slitsOnly([...cross(w / 2, d / 2), ...cross(0, (3 * d) / 2)]);
  },
  web: (p) => {
    const L = num(p, 'length');
    const g = num(p, 'gap');
    const d = num(p, 'spacing');
    return Math.max(0.05, Math.min(g, Math.hypot(g / 2, d - L / 2), 2 * d - L));
  },
};

export const honeycombHinge: PatternDef = {
  id: 'honeycomb-hinge',
  name: 'Honeycomb hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'hexagon', 'honeycomb', 'dome'],
  blurb: 'Hexagon cells cut open except at their corners — the most even of the hinges, and the weakest sideways.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    SIZE(6, 2, 40, 'Cell size'),
    number('gap', 'Corner web', 1.5, 0.5, 8, 0.1, 'mm', 'Material left where three slits meet.'),
  ],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    // Three slits meet at every hexagon corner, 120° apart.
    const trim = cornerTrim(num(p, 'gap'), 120);
    const r = s / SQRT3;
    const cell = (cx: number, cy: number): Polyline[] => {
      const v: Pt[] = [];
      for (let k = 0; k < 6; k++) v.push([cx + r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), cy + r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
      return v.map((a, i) => trimmed(a, v[(i + 1) % 6]!, trim));
    };
    return slitsOnly([...cell(s / 2, (s * SQRT3) / 2), ...cell(0, 0)]);
  },
  web: (p) => num(p, 'gap'),
};

export const springHinge: PatternDef = {
  id: 'spring-hinge',
  name: 'Spring hinge',
  family: 'hinge',
  tags: ['slits', 'hinge', 'bend', 'stretch', 'serpentine', 'spring'],
  blurb: 'Serpentine slits: the links between them meander, so the sheet stretches as well as bends.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    number('length', 'Slit length', 22, 6, 120, 0.5),
    number('gap', 'Web between slits', 3, 1, 20, 0.1),
    SPACING(4.5, 1.2, 20),
    number('waves', 'Waves per slit', 3, 1, 8, 1, ''),
    number('amplitude', 'Wave depth', 1.2, 0.2, 6, 0.1),
  ],
  cell: (p) => ({ w: num(p, 'length') + num(p, 'gap'), h: 2 * num(p, 'spacing') }),
  tile: (p) => {
    const L = num(p, 'length');
    const g = num(p, 'gap');
    const d = num(p, 'spacing');
    const n = Math.round(num(p, 'waves'));
    const A = Math.min(num(p, 'amplitude'), (d - 0.4) / 2);
    const w = L + g;
    const serpentine = (x0: number, y0: number): Polyline => {
      const steps = Math.max(16, Math.ceil(L / 0.4));
      const out: Polyline = [];
      for (let i = 0; i <= steps; i++) {
        const x = (L * i) / steps;
        out.push([x0 + x, y0 + A * Math.sin((2 * Math.PI * n * x) / L)]);
      }
      return out;
    };
    return slitsOnly([serpentine(g / 2, d / 2), serpentine(g / 2 + w / 2, (3 * d) / 2)]);
  },
  web: (p) => Math.max(0.05, Math.min(num(p, 'gap'), num(p, 'spacing') - 2 * Math.min(num(p, 'amplitude'), (num(p, 'spacing') - 0.4) / 2))),
};

export const HINGES: PatternDef[] = [livingHinge, waveHinge, diamondHinge, crossHinge, honeycombHinge, springHinge];
