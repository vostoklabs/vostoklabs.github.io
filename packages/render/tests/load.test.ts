/*
  Loading a model file for the studio (src/load.ts), from bytes, as a browser hands them over:
  STL and OBJ through the shelf's model reader as one region, a 3MF through this package's reader
  with its own colours as regions, plate 1 only, and z-up turned y-up.

  Every file here is built in the test, so nothing is a fixture of unknown origin.
*/
import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from './support/spec';
import { disposeModel, loadRenderModel, type LoadedModel } from '../src/load';

/** A binary STL of the given triangles, nine numbers each. */
function binaryStl(triangles: number[][]): Uint8Array {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    const at = 84 + i * 50 + 12;
    t.forEach((v, k) => view.setFloat32(at + k * 4, v, true));
  });
  return new Uint8Array(buffer);
}

/** A 3MF archive of the given entries. */
const threeMf = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));

const meshesOf = (model: LoadedModel) => {
  const out: THREE.Mesh[] = [];
  model.object.traverse((c) => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
};

/** Two triangles standing 5 mm tall along z, as a print file stands. */
const TALL = [
  [0, 0, 0, 10, 0, 0, 0, 0, 5],
  [10, 0, 0, 10, 0, 5, 0, 0, 5],
];

const TETRA = (id: string, extra = '') => `
  <object id="${id}" type="model"${extra}><mesh>
    <vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>
      <vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/>
    </vertices>
    <triangles>
      <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>
      <triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>
    </triangles>
  </mesh></object>`;

describe('an STL', () => {
  const model = loadRenderModel(binaryStl(TALL), 'Bracket.stl');

  it('is one region, the whole model, named after the file', () => {
    expect(model.stem).toBe('Bracket');
    expect(model.regions).toEqual([
      { key: 'whole', label: 'Bracket', source: 'whole', fileHex: null, triangles: 2 },
    ]);
    expect(meshesOf(model).map((m) => m.userData.regionKeys)).toEqual([['whole']]);
  });

  it('is a non-indexed soup with a flat normal per triangle', () => {
    const geometry = meshesOf(model)[0]!.geometry;
    expect(geometry.index).toBeNull();
    expect(geometry.attributes.position!.count).toBe(6);
    const n = geometry.attributes.normal!;
    // The three corners of a triangle share its one normal.
    expect([n.getX(0), n.getY(0), n.getZ(0)]).toEqual([n.getX(2), n.getY(2), n.getZ(2)]);
  });

  it('stands up: what was z-up in the file is y-up in the scene', () => {
    const box = new THREE.Box3().setFromObject(model.object);
    expect(box.max.y).toBeCloseTo(5, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
  });

  it('reads an STL whose name has no extension', () => {
    expect(loadRenderModel(binaryStl(TALL), 'upload').regions[0]!.triangles).toBe(2);
  });
});

describe('an OBJ', () => {
  it('is one region too, its polygons fanned into triangles', () => {
    const obj = 'o Plate\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
    const model = loadRenderModel(strToU8(obj), 'plate.obj');
    expect(model.regions).toHaveLength(1);
    expect(model.regions[0]!.triangles).toBe(2);
    expect(meshesOf(model)[0]!.geometry.attributes.position!.count).toBe(6);
  });
});

describe('a file the studio cannot read', () => {
  it('is refused with a sentence a person can read', () => {
    expect(() => loadRenderModel(new Uint8Array(10), 'part.step')).toThrow('Only STL, OBJ and 3MF');
    expect(() => loadRenderModel(strToU8('not a zip'), 'part.3mf')).toThrow('not a valid zip');
    expect(() => loadRenderModel(threeMf({ 'readme.txt': 'hi' }), 'part.3mf')).toThrow('no model');
    expect(() => loadRenderModel(strToU8('solid x\nendsolid x\n'), 'empty.stl')).toThrow('no triangles');
  });

  it('is refused when the first plate has no geometry', () => {
    const empty = threeMf({ '3D/3dmodel.model': '<model><resources/><build/></model>' });
    expect(() => loadRenderModel(empty, 'empty.3mf')).toThrow('no geometry');
  });
});

/** An assembly coloured the spec's way: a `<basematerials>` table, one entry per part. */
const SPEC_ASSEMBLY = `<model unit="millimeter"><resources>
  <basematerials id="9">
    <base name="Shell" displaycolor="#FF6A13FF"/><base name="Cap" displaycolor="#161616FF"/>
  </basematerials>
  ${TETRA('1', ' name="Shell" pid="9" pindex="0"')}
  ${TETRA('2', ' name="Cap" pid="9" pindex="1"')}
  <object id="10" name="Clicker"><components>
    <component objectid="1"/>
    <component objectid="2" transform="1 0 0 0 1 0 0 0 1 40 0 0"/>
  </components></object>
</resources><build><item objectid="10"/></build></model>`;

describe('a 3MF coloured by its own materials', () => {
  const model = loadRenderModel(threeMf({ '3D/3dmodel.model': SPEC_ASSEMBLY }), 'Clicker.3mf');

  it('gives each part its own region, in the colour the file states', () => {
    expect(model.regions.map((r) => [r.label, r.source, r.fileHex, r.triangles])).toEqual([
      ['Shell', 'part', '#ff6a13', 4],
      ['Cap', 'part', '#161616', 4],
    ]);
  });

  it('draws each region as its own group, in region order', () => {
    const [mesh] = meshesOf(model);
    expect(mesh!.geometry.groups.map((g) => [g.start, g.count, g.materialIndex])).toEqual([[0, 12, 0], [12, 12, 1]]);
    expect(mesh!.userData.regionKeys).toEqual(model.regions.map((r) => r.key));
  });

  it('keys regions the same way every time, so a saved colourway still applies', () => {
    const again = loadRenderModel(threeMf({ '3D/3dmodel.model': SPEC_ASSEMBLY }), 'Clicker.3mf');
    expect(again.regions.map((r) => r.key)).toEqual(model.regions.map((r) => r.key));
  });

  it('reads a 3MF whose name has no extension, by its zip signature', () => {
    expect(loadRenderModel(threeMf({ '3D/3dmodel.model': SPEC_ASSEMBLY }), 'upload').regions).toHaveLength(2);
  });
});

/** One object, two faces: one painted in filament 3, one split so a corner is filament 1. */
const PAINTED = `<model><resources><object id="1" type="model"><mesh>
  <vertices>
    <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>
    <vertex x="1" y="1" z="0"/><vertex x="0" y="1" z="0"/>
  </vertices>
  <triangles>
    <triangle v1="0" v2="1" v3="2" paint_color="0C"/>
    <triangle v1="0" v2="2" v3="3" paint_color="40003"/>
  </triangles>
</mesh></object></resources><build><item objectid="1"/></build></model>`;

describe('a painted 3MF from a slicer', () => {
  const model = loadRenderModel(threeMf({
    '3D/3dmodel.model': PAINTED,
    'Metadata/model_settings.config':
      '<config><object id="1"><metadata key="name" value="Tile"/><metadata key="extruder" value="2"/></object></config>',
    'Metadata/project_settings.config': '{"filament_colour": ["#FF0000", "#00FF00", "#0000FF"]}',
  }), 'tile.3mf');

  it('makes a region per painted filament, and one for the faces nobody painted', () => {
    // The unpainted faces keep the object's own slot (2), through the part range every object
    // with its own geometry has. A painted face beats it, because painting is more specific. The
    // part is called what the slicer calls it.
    expect(model.regions.map((r) => [r.source, r.label, r.fileHex, r.triangles])).toEqual([
      ['slot', 'Filament 3', '#0000ff', 1],
      ['part', 'Tile', '#00ff00', 3],
      ['slot', 'Filament 1', '#ff0000', 1],
    ]);
  });

  it('subdivides the painted face, so the regions cover every triangle drawn', () => {
    const [mesh] = meshesOf(model);
    expect(mesh!.geometry.attributes.position!.count).toBe(5 * 3);
    expect(mesh!.geometry.groups.map((g) => g.count)).toEqual([3, 9, 3]);
  });
});

describe('a multi-plate 3MF', () => {
  it('loads plate 1 only', () => {
    const settings = `<config>
      <plate><metadata key="index" value="1"/>
        <model_instance><metadata key="object_id" value="2"/></model_instance></plate>
      <plate><metadata key="index" value="2"/>
        <model_instance><metadata key="object_id" value="3"/></model_instance></plate>
    </config>`;
    const model = loadRenderModel(threeMf({
      '3D/3dmodel.model': `<model><resources>${TETRA('2')}${TETRA('3')}</resources><build>
        <item objectid="2"/><item objectid="3" transform="1 0 0 0 1 0 0 0 1 200 0 0"/>
      </build></model>`,
      'Metadata/model_settings.config': settings,
    }), 'two plates.3mf');
    expect(model.regions.reduce((n, r) => n + r.triangles, 0)).toBe(4);
    expect(new THREE.Box3().setFromObject(model.object).max.x).toBeCloseTo(1, 5);
  });
});

describe('a 3MF whose parts are named only by the slicer', () => {
  it('takes the names model_settings.config gives the parts, as Bambu Studio writes them', () => {
    const model = loadRenderModel(threeMf({
      '3D/3dmodel.model': `<model><resources>
        <basematerials id="1"><base name="a" displaycolor="#112233FF"/><base name="b" displaycolor="#445566FF"/></basematerials>
        ${TETRA('2', ' pid="1" pindex="0"')}${TETRA('3', ' pid="1" pindex="1"')}
        <object id="4" type="model"><components><component objectid="2"/><component objectid="3"/></components></object>
      </resources><build><item objectid="4"/></build></model>`,
      'Metadata/model_settings.config': `<config><object id="4"><metadata key="name" value="tag"/>
        <part id="2" subtype="normal_part"><metadata key="name" value="plate"/><metadata key="extruder" value="1"/></part>
        <part id="3" subtype="normal_part"><metadata key="name" value="Text &amp; logo"/><metadata key="extruder" value="2"/></part>
      </object></config>`,
    }), 'tag.3mf');
    expect(model.regions.map((r) => r.label)).toEqual(['plate', 'Text & logo']);
  });
});

describe('disposeModel', () => {
  it("frees the model's geometry", () => {
    const model = loadRenderModel(binaryStl(TALL), 'Bracket.stl');
    let freed = 0;
    meshesOf(model)[0]!.geometry.addEventListener('dispose', () => { freed++; });
    disposeModel(model);
    expect(freed).toBe(1);
  });
});
