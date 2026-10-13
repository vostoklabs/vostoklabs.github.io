// The card as solids: the flat design (design/types.ts) made into one part per colour, in the
// geometry worker, with manifold-3d. Built face up, as the preview shows it; a flush card is turned
// over for the plate at export (main.ts), which is a rotation, so nothing here is mirrored for it.
//
//   RAISED  the colour fields lie flush in the card's top layers; the lettering, the icons, the QR
//           and a pattern in colour stand up on top (in the card's own colour: a relief).
//   FLUSH   everything on the face is laid into its top layers (the plate side once turned over).
//   BACK    on a two-sided card the back is laid into the bottom layers, in either finish.
//   CARVED  recessed into the face, through whatever colour is there; with a REVEAL colour the
//           card under the face's top layers is that colour, and the carving shows it.
//   POCKET  an NFC tag's cavity between the two faces, with whole layers above and below it.
//
// Every height is a whole number of 0.2 mm layers (the bundled process's first layer and layer
// height), so each colour change and the pause land on a layer line.
import { csOf, extrude, ringsOf, withScope, type Keep } from '@vostok/manifold';
import { fromCS, offsetShapes, subtractShapes, toCS } from '@vostok/laser/csg2d';
import { latticeFaces } from '@vostok/patterns/lattice';
import type { Ring, Shapes } from '@vostok/shapes';
import { POCKET_WALL } from '../design/layout';
import type { Design, Face, PatternPart, Role } from '../design/types';

export const LAYER = 0.2;
/** Plastic over an NFC tag, mm: enough to hide it and hold it, thin enough that a phone reads it. */
const POCKET_COVER = 0.6;
/** Outline points nearer than this to the line through their neighbours are dropped, mm. A
 *  hundredth of a millimetre is far under what a 0.4 mm nozzle or a 0.2 mm layer can show, and
 *  letters and round offsets come with three times the points that leaves; every point costs the
 *  booleans that carve the card and the triangles the preview draws. */
const DETAIL = 0.01;

export interface SolidParams {
  /** The card's thickness asked for, mm, raised lettering not included. */
  thickness: number;
  /** How far the lettering stands up, mm; 0 is a flush card, printed face down. */
  raise: number;
  /** How deep colour is laid into a face, and how deep carving goes, mm. */
  inlay: number;
  /** The NFC tag's pocket depth, mm (when the design has a pocket). */
  pocketDepth: number;
}

export interface SolidPart {
  /** Its colour, `#rrggbb`: one filament. */
  colour: string;
  /** What it holds, for its name in the slicer. */
  roles: Role[];
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

export interface SolidResult {
  parts: SolidPart[];
  /** What will not print: the export stops on these. */
  warnings: string[];
  /** The card's thickness as built: more than asked when the pocket or two inlays needed it. */
  thickness: number;
  /** The top of the pocket, mm above the plate as the card PRINTS (flush cards print turned over). */
  pocketCeiling: number | null;
  notes: string[];
}

/** Round up to a whole layer. */
const layers = (mm: number) => Math.ceil(mm / LAYER - 1e-6) * LAYER;

const area = (r: Ring) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Islands as rings wound for a positive fill: each outer anticlockwise, each hole clockwise.
 *  Shapes come from fonts, symbols, the QR engine and the pattern engine; this is where they agree. */
function wound(shapes: Shapes): Ring[] {
  const out: Ring[] = [];
  for (const island of shapes) {
    island.forEach((ring, i) => {
      if (ring.length < 3) return;
      const a = area(ring);
      if (Math.abs(a) < 1e-9) return;
      out.push((a > 0) === (i === 0) ? ring : ring.slice().reverse());
    });
  }
  return out;
}

function circle(cx: number, cy: number, r: number, seg = 96): Ring {
  return Array.from({ length: seg }, (_, i): [number, number] => {
    const t = (2 * Math.PI * i) / seg;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
}

/** One colour's share of a face: where it lies, and whether it is lettering (raised on a raised
 *  card) or a field (laid flush whatever the finish). */
interface Region {
  colour: string;
  roles: Set<Role>;
  cs: any;
  stands: boolean;
}

/** Build the card. `wasm` is the loaded manifold module. */
export function buildSolid(wasm: any, d: Design, p: SolidParams): SolidResult {
  return withScope((keep) => {
    const notes: string[] = [];
    const warnings: string[] = [];
    const raised = p.raise > 1e-6;
    const empty = () => keep(csOf(wasm, [], 'Positive'));
    const cs = (shapes: Shapes) => (shapes.length ? keep(csOf(wasm, wound(shapes), 'Positive')) : empty());
    const union = (a: any, b: any) => keep(a.add(b));
    const minus = (a: any, b: any) => keep(a.subtract(b));
    const and = (a: any, b: any) => keep(a.intersect(b));
    const prism = (section: any, z0: number, z1: number) => {
      if (z1 - z0 < 1e-6 || section.isEmpty()) return null;
      const m = keep(extrude(wasm, section, z1 - z0));
      return z0 ? keep(m.translate([0, 0, z0])) : m;
    };

    // ---- the card's outline, less everything cut through it ------------------------------
    let card = cs([[d.outline]]);
    card = minus(card, cs(d.cutouts));
    if (d.front.pattern?.mode === 'cut') {
      const holes = d.front.pattern.lattice ? latticeHoles(wasm, d.front.pattern, notes, d.pocket) : d.front.pattern.shapes;
      card = minus(card, cs(holes));
    }

    /**
     * A face's colours, made disjoint, topmost first: the lettering and its kin (each colour in the
     * order it first appears), then a pattern in colour, then the fields less their gaps. A piece
     * with an `onFields` colour takes that colour where it crosses the fields.
     */
    const regionsOf = (face: Face): { regions: Region[]; carved: any } => {
      const fieldCs = and(minus(cs(face.fields), cs(face.gaps)), card);
      const byColour = new Map<string, Region>();
      const order: string[] = [];
      const put = (colour: string, role: Role, shape: any, stands: boolean) => {
        if (shape.isEmpty()) return;
        let r = byColour.get(colour);
        if (!r) {
          r = { colour, roles: new Set(), cs: empty(), stands };
          byColour.set(colour, r);
          order.push(colour);
        }
        r.cs = union(r.cs, shape);
        r.roles.add(role);
      };
      let taken = empty();
      const claim = (colour: string, role: Role, shape: any, stands: boolean) => {
        const own = minus(and(shape, card), taken);
        if (own.isEmpty()) return;
        taken = union(taken, own);
        put(colour, role, own, stands);
      };
      for (const piece of face.ink) {
        let s = cs(piece.shapes);
        if (piece.grow && piece.grow > 1e-4) s = keep(s.offset(piece.grow, 'Round', 2, 16));
        if (piece.minus?.length) s = minus(s, cs(piece.minus));
        s = keep(s.simplify(DETAIL));
        if (piece.onFields) {
          claim(piece.onFields, piece.role, and(s, fieldCs), true);
          claim(piece.colour, piece.role, minus(s, fieldCs), true);
        } else {
          claim(piece.colour, piece.role, s, true);
        }
      }
      let carved = cs(face.carved);
      const pat = face.pattern;
      if (pat && (pat.mode === 'colour' || pat.mode === 'carved')) {
        let s = cs(pat.shapes);
        if (pat.keep?.length) s = and(s, cs(pat.keep));
        if (pat.erode && pat.erode > 1e-4) s = keep(s.offset(-pat.erode, 'Round', 2, 16));
        s = keep(s.simplify(DETAIL));
        if (pat.mode === 'colour') claim(pat.colour, 'pattern', s, true);
        else carved = union(carved, minus(s, taken));
      }
      claim(d.fieldColour, 'shapes', fieldCs, false);
      return { regions: order.map((c) => byColour.get(c)!), carved: and(carved, card) };
    };

    const front = regionsOf(d.front);
    const back = d.back ? regionsOf(d.back) : null;
    const inlay = layers(p.inlay);
    const isCard = (r: Region) => r.colour.toLowerCase() === d.card.toLowerCase();

    // ---- heights ---------------------------------------------------------------------------
    // What the front lays into the card: every colour (flush), or only the fields (raised); and
    // what is carved into it, which goes as deep as an inlay.
    const frontInlaid = front.regions.filter((r) => !isCard(r) && (!raised || !r.stands));
    const frontRaised = raised ? front.regions.filter((r) => r.stands) : [];
    const frontDepth = frontInlaid.length || !front.carved.isEmpty() || d.reveal ? inlay : 0;
    // What the back lays in: every colour but the card's, as the card is there already, except on
    // a card with a reveal, whose body under the front's top layers (the back face with it) is the
    // reveal colour, so the card's own colour has to be laid in like any other.
    const backInlaid = back ? back.regions.filter((r) => !!d.reveal || !isCard(r)) : [];
    const backDepth = backInlaid.length ? inlay : 0;
    let T = layers(Math.max(p.thickness, backDepth + frontDepth + LAYER));
    let pocketZ: [number, number] | null = null;
    let pocketCeiling: number | null = null;
    if (d.pocket) {
      const depth = layers(p.pocketDepth);
      // As it prints: the bottom face's inlay (or two solid layers), a layer of card, the pocket,
      // then 0.6 mm of cover over the tag, the top face's inlay counting towards it, with at least
      // one plain layer bridging the pocket before any colour is laid over it.
      const bottom = raised ? backDepth : frontDepth;
      const top = raised ? frontDepth : backDepth;
      const floor = Math.max(bottom + LAYER, 2 * LAYER);
      const cover = Math.max(LAYER, POCKET_COVER - top);
      const needed = layers(floor + depth + cover + top);
      if (needed > T + 1e-6) {
        T = needed;
        notes.push(`Card made ${T.toFixed(1)} mm thick to hold the tag`);
      }
      pocketCeiling = floor + depth;
      // In the model's own frame (face up): a flush card prints turned over.
      pocketZ = raised ? [floor, floor + depth] : [T - floor - depth, T - floor];
    } else if (T > p.thickness + 1e-6) {
      notes.push(`Card made ${T.toFixed(1)} mm thick for both faces' colour`);
    }
    const R = raised ? layers(p.raise) : 0;

    // ---- the parts -------------------------------------------------------------------------
    const solids = new Map<string, { roles: Set<Role>; parts: any[] }>();
    const add = (colour: string, roles: Iterable<Role>, m: any) => {
      if (!m) return;
      const key = colour.toLowerCase();
      let e = solids.get(key);
      if (!e) solids.set(key, (e = { roles: new Set(), parts: [] }));
      for (const r of roles) e.roles.add(r);
      e.parts.push(m);
    };
    // The card first, so it is the first filament.
    solids.set(d.card.toLowerCase(), { roles: new Set(['card']), parts: [] });

    let body = prism(card, 0, T);
    const carve = (m: any) => { if (m && body) body = keep(body.subtract(m)); };
    // A face's inlays share a depth, so they are carved out of the card in one go: their union
    // taken flat, one boolean on the body a face rather than one a piece (on a flush card that
    // is every letter, icon and module, and the body is the biggest mesh there is).
    const together = (rs: Region[]) => keep(wasm.CrossSection.union(rs.map((r) => r.cs)));
    for (const r of frontInlaid) add(r.colour, r.roles, prism(r.cs, T - frontDepth, T));
    if (frontInlaid.length) carve(prism(together(frontInlaid), T - frontDepth, T));
    for (const r of frontRaised) add(r.colour, r.roles, prism(r.cs, T, T + R));
    if (back) {
      for (const r of backInlaid) add(r.colour, r.roles, prism(r.cs, 0, backDepth));
      if (backInlaid.length) carve(prism(together(backInlaid), 0, backDepth));
    }
    if (pocketZ && d.pocket) {
      const disc = cs([[circle(d.pocket.at[0], d.pocket.at[1], d.pocket.r)]]);
      // A pocket that reaches a hole or the edge would open the card: refused, not printed.
      if (minus(disc, card).area() > 0.01) warnings.push('The NFC pocket would break into a cut-out here. Try another template.');
      else carve(prism(disc, pocketZ[0], pocketZ[1]));
    }
    // The carving goes down through whatever the face carries there.
    const recess = !front.carved.isEmpty() ? prism(front.carved, T - frontDepth, T + R + 1) : null;
    if (recess) {
      carve(recess);
      for (const e of solids.values()) e.parts = e.parts.map((m) => keep(m.subtract(recess)));
    }
    // A reveal: the card under the face's top layers is the reveal colour.
    if (body && d.reveal) {
      const under = prism(card, 0, T - frontDepth);
      if (under) {
        add(d.reveal, ['shapes'], keep(body.intersect(under)));
        body = keep(body.subtract(under));
      }
    }
    add(d.card, ['card'], body);

    const parts: SolidPart[] = [];
    for (const [colour, e] of solids) {
      if (!e.parts.length) continue;
      // One batch union a colour: pairwise, each step re-meshed everything joined so far.
      const m = e.parts.length > 1 ? keep(wasm.Manifold.union(e.parts)) : e.parts[0];
      if (m.isEmpty()) continue;
      const mesh = m.getMesh();
      const stride = mesh.numProp;
      const verts = new Float32Array((mesh.vertProperties.length / stride) * 3);
      for (let i = 0, j = 0; i < mesh.vertProperties.length; i += stride, j += 3) {
        verts[j] = mesh.vertProperties[i];
        verts[j + 1] = mesh.vertProperties[i + 1];
        verts[j + 2] = mesh.vertProperties[i + 2];
      }
      parts.push({ colour, roles: [...e.roles], vertProperties: verts, triVerts: new Uint32Array(mesh.triVerts) });
    }
    return { parts, warnings, thickness: T, pocketCeiling: warnings.length ? null : pocketCeiling, notes };
  });
}

/**
 * A pattern cut as a lattice: its faces, from the shelf's `latticeFaces` with manifold's booleans
 * as the host, as Laser Studio's worker gives them. An NFC pocket is a reserve of the region, with
 * its wall of card, so the lattice's frame runs round it and no face opens into it.
 */
function latticeHoles(wasm: any, part: PatternPart, notes: string[], pocket: Design['pocket']): Shapes {
  const spec = pocket
    ? { ...part.lattice!, region: subtractShapes(wasm, part.lattice!.region, [[circle(pocket.at[0], pocket.at[1], pocket.r + POCKET_WALL)]]) }
    : part.lattice!;
  const r = latticeFaces(spec, {
    offset: (s, dd, coarse) => (coarse && Math.abs(dd) > 0.2
      ? withScope((keep: Keep) => fromCS(keep(toCS(wasm, s, keep).offset(dd, 'Round', 2.0, 8)), keep))
      : offsetShapes(wasm, s, dd)),
    subtract: (a, b) => subtractShapes(wasm, a, b),
    outline: (rings) => {
      const c = csOf(wasm, rings, 'EvenOdd');
      try {
        return ringsOf(c);
      } finally {
        c.delete();
      }
    },
  });
  notes.push(...r.warnings);
  return r.faces;
}
