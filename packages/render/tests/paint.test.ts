/*
  Per-face paint (src/threemf/paint.ts): the subdivision tree a painted triangle carries, decoded
  last nibble first, and the build that subdivides painted faces into their colours.
*/
import { describe, expect, it } from './support/spec';
import { flatPaintState, forEachPaintedTriangle } from '../src/threemf/paint';
import { buildMeshFromParts } from '../src/threemf/mesh';

/** The three vertices of a unit triangle, as the decoder wants them. */
const A = [0, 0, 0] as const;
const B = [1, 0, 0] as const;
const C = [0, 1, 0] as const;

/** Collects what a code decodes to, as `[filament, area]` pairs. */
function decode(code: string) {
  const out: { filament: number; area: number }[] = [];
  const ok = forEachPaintedTriangle(code, A, B, C, (a, b, c, filament) => {
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const vx = c[0] - a[0], vy = c[1] - a[1];
    out.push({ filament, area: Math.abs(ux * vy - uy * vx) / 2 });
  });
  return { ok, out };
}

describe('forEachPaintedTriangle', () => {
  it('reads a whole-face colour, nibbles last-first', () => {
    // `4` is a leaf whose two state bits are 01: filament 1, the file's first colour.
    expect(decode('4').out).toEqual([{ filament: 1, area: 0.5 }]);
  });

  it('reads the extended state, which is where the third filament lives', () => {
    // `0C`: the last nibble is the root, `C` is a leaf whose state bits are 0b11, so the
    // remaining nibble carries state - 3. Read the other way round it does not decode.
    expect(decode('0C').out).toEqual([{ filament: 3, area: 0.5 }]);
    expect(decode('1C').out).toEqual([{ filament: 4, area: 0.5 }]);
  });

  it('covers the parent exactly when a triangle is split', () => {
    // A three-side split: four children, each an unpainted quarter but for the last.
    const { ok, out } = decode('4000' + '3');
    expect(ok).toBe(true);
    expect(out).toHaveLength(4);
    expect(out.reduce((n, t) => n + t.area, 0)).toBeCloseTo(0.5, 10);
    expect(out.map((t) => t.filament)).toEqual([0, 0, 0, 1]);
  });

  it('covers the parent exactly for one- and two-side splits too', () => {
    for (const code of ['001', '0002']) {
      const { ok, out } = decode(code);
      expect(ok).toBe(true);
      expect(out.reduce((n, t) => n + t.area, 0)).toBeCloseTo(0.5, 10);
    }
  });

  it('refuses a code it did not consume exactly', () => {
    // Nibbles left over mean the tree was misread, whatever it decoded into first.
    expect(decode('44').ok).toBe(false);
    // And a split whose children were never written runs out of nibbles.
    expect(decode('3').ok).toBe(false);
    expect(decode('').ok).toBe(false);
  });

  it('emits nothing at all when the code is refused', () => {
    const seen: number[] = [];
    forEachPaintedTriangle('3', A, B, C, (_a, _b, _c, f) => seen.push(f));
    expect(seen).toEqual([]);
  });
});

describe('flatPaintState', () => {
  it('agrees with the walker on the codes it answers', () => {
    for (const code of ['4', '8', '0C', '1C']) {
      expect(flatPaintState(code)).toBe(decode(code).out[0]!.filament);
    }
  });

  it('declines anything that is not a single leaf', () => {
    expect(flatPaintState('001')).toBeNull();
    expect(flatPaintState('3')).toBeNull();
    expect(flatPaintState('')).toBeNull();
  });
});

/**
 * A minimal 3MF in the shape Bambu Studio writes: one square of two triangles, one painted in
 * filament 3 outright and one split so that a corner of it is filament 1.
 */
const PAINTED_MODEL = `<model><resources><object id="1" type="model"><mesh>
  <vertices>
    <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>
    <vertex x="1" y="1" z="0"/><vertex x="0" y="1" z="0"/>
  </vertices>
  <triangles>
    <triangle v1="0" v2="1" v3="2" paint_color="0C"/>
    <triangle v1="0" v2="2" v3="3" paint_color="40003"/>
  </triangles>
</mesh></object></resources>
<build><item objectid="1"/></build></model>`;

describe('buildMeshFromParts, with paint', () => {
  it('subdivides painted faces and reports a filament per triangle', () => {
    const mesh = buildMeshFromParts([{ name: '', xml: PAINTED_MODEL }], undefined, { paint: true });
    // The flat face stays one triangle; the split one becomes four.
    expect(mesh.triangles).toBe(5);
    expect([...(mesh.objects[0]!.filaments ?? [])]).toEqual([3, 0, 0, 0, 1]);
  });

  it('leaves geometry alone when paint was not asked for', () => {
    const mesh = buildMeshFromParts([{ name: '', xml: PAINTED_MODEL }]);
    expect(mesh.triangles).toBe(2);
    expect(mesh.objects[0]!.filaments).toBeNull();
  });

  it('carries no filaments for a file that painted nothing', () => {
    const plain = PAINTED_MODEL.replace(/ paint_color="[^"]*"/g, '');
    const mesh = buildMeshFromParts([{ name: '', xml: plain }], undefined, { paint: true });
    expect(mesh.triangles).toBe(2);
    expect(mesh.objects[0]!.filaments).toBeNull();
  });

  it('leaves a face whose code does not decode whole and unpainted', () => {
    const broken = PAINTED_MODEL.replace('paint_color="40003"', 'paint_color="3"');
    const mesh = buildMeshFromParts([{ name: '', xml: broken }], undefined, { paint: true });
    expect(mesh.triangles).toBe(2);
    expect([...(mesh.objects[0]!.filaments ?? [])]).toEqual([3, 0]);
  });
});
