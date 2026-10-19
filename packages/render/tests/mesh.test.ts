/*
  3MF geometry (src/threemf/mesh.ts): objects, components and build items read without a DOM,
  assembled in world space, narrowed to one plate, split by top-level object, and told which run
  of triangles came from which part, so the colour join can colour an assembly part by part.
*/
import { describe, expect, it } from './support/spec';
import {
  parseTransform, composeTransforms, parseObjectsIndexed, parseBuildItems,
  parsePlateObjects, buildMeshFromParts, plateObjectsFor,
} from '../src/threemf/mesh';
import { buildPaint, colorForObject, colorForPart } from '../src/threemf/colors';

/** A single-document archive's build. */
const buildMesh = (xml: string, only?: ReadonlySet<string>) => buildMeshFromParts([{ name: '', xml }], only);
const xsOf = (positions: Float32Array) => Array.from(positions).filter((_, i) => i % 3 === 0);
const ysOf = (positions: Float32Array) => Array.from(positions).filter((_, i) => i % 3 === 1);

/** A unit tetrahedron: four vertices, four faces, enough to be unambiguous. */
const TETRA_OBJECT = `
  <object id="1" type="model">
    <mesh>
      <vertices>
        <vertex x="0" y="0" z="0"/>
        <vertex x="1" y="0" z="0"/>
        <vertex x="0" y="1" z="0"/>
        <vertex x="0" y="0" z="1"/>
      </vertices>
      <triangles>
        <triangle v1="0" v2="2" v3="1"/>
        <triangle v1="0" v2="1" v3="3"/>
        <triangle v1="0" v2="3" v3="2"/>
        <triangle v1="1" v2="2" v3="3"/>
      </triangles>
    </mesh>
  </object>`;

const MODEL = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${body}</resources>
  <build><item objectid="1"/></build>
</model>`;

describe('parseTransform', () => {
  it('reads the twelve numbers 3MF writes', () => {
    expect(parseTransform('1 0 0 0 1 0 0 0 1 5 6 7')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 6, 7]);
  });

  it('falls back to identity rather than failing', () => {
    // A bad transform should misplace one part, never lose the model.
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(parseTransform('1 2 3')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(parseTransform('a b c d e f g h i j k l')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  });
});

describe('composeTransforms', () => {
  it('leaves a transform alone when composed with identity', () => {
    const t = parseTransform('2 0 0 0 2 0 0 0 2 1 2 3');
    const id = parseTransform(undefined);
    expect(composeTransforms(id, t)).toEqual(t);
  });

  it('accumulates nested translations', () => {
    const a = parseTransform('1 0 0 0 1 0 0 0 1 10 0 0');
    const b = parseTransform('1 0 0 0 1 0 0 0 1 5 0 0');
    expect(composeTransforms(a, b).slice(9)).toEqual([15, 0, 0]);
  });

  it('places by the inner transform first, then the outer', () => {
    // Outer: a quarter turn about z. Inner: a shift of 10 along x. The point at the origin goes
    // to (10, 0, 0) and then turns to (0, 10, 0).
    const turn = parseTransform('0 1 0 -1 0 0 0 0 1 0 0 0');
    const shift = parseTransform('1 0 0 0 1 0 0 0 1 10 0 0');
    const both = composeTransforms(turn, shift);
    expect(both.slice(9).map((v) => Math.round(v))).toEqual([0, 10, 0]);
  });
});

describe('parseObjectsIndexed', () => {
  it("reads a mesh's vertices through its triangle indices", () => {
    const positions = buildMesh(MODEL(TETRA_OBJECT)).positions;
    // Four triangles, three vertices each, three components each.
    expect(positions.length).toBe(4 * 3 * 3);
    // First triangle is v0,v2,v1 → (0,0,0), (0,1,0), (1,0,0).
    expect(Array.from(positions.slice(0, 9))).toEqual([0, 0, 0, 0, 1, 0, 1, 0, 0]);
  });

  it('keeps objects separate rather than letting one bleed into the next', () => {
    const objects = parseObjectsIndexed(MODEL(TETRA_OBJECT + TETRA_OBJECT.replace('id="1"', 'id="2"')));
    expect(objects.size).toBe(2);
    expect(objects.get('1')!.triangles.length).toBe(objects.get('2')!.triangles.length);
  });

  it('skips a triangle whose index is out of range instead of crashing', () => {
    const broken = TETRA_OBJECT.replace('<triangle v1="0" v2="2" v3="1"/>', '<triangle v1="0" v2="99" v3="1"/>');
    const objects = parseObjectsIndexed(MODEL(broken));
    expect(objects.get('1')!.triangles.length).toBe(3 * 3);
  });

  it('returns no geometry for an object that has none', () => {
    const objects = parseObjectsIndexed(MODEL(`<object id="1"><components/></object>`));
    expect(objects.get('1')!.vertices.length).toBe(0);
  });

  it('reads component references and their transforms', () => {
    const xml = MODEL(`${TETRA_OBJECT}
      <object id="2">
        <components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components>
      </object>`);
    const assembly = parseObjectsIndexed(xml).get('2')!;
    expect(assembly.components).toHaveLength(1);
    expect(assembly.components[0]!.objectId).toBe('1');
    expect(assembly.components[0]!.transform.slice(9)).toEqual([10, 0, 0]);
  });

  it("reads an object's own metadata name, and null when it has none", () => {
    const named = TETRA_OBJECT.replace('id="1" type="model"', 'id="1" type="model"><metadata name="Body"/>');
    const objects = parseObjectsIndexed(MODEL(`${named}${TETRA_OBJECT.replace('id="1"', 'id="2"')}`));
    expect(objects.get('1')!.name).toBe('Body');
    expect(objects.get('2')!.name).toBeNull();
  });

  it('reads per-face paint only when asked', () => {
    const painted = TETRA_OBJECT.replace('<triangle v1="1" v2="2" v3="3"/>', '<triangle v1="1" v2="2" v3="3" paint_color="8"/>');
    expect(parseObjectsIndexed(MODEL(painted)).get('1')!.paints).toBeNull();
    expect(parseObjectsIndexed(MODEL(painted), true).get('1')!.paints).toEqual(['', '', '', '8']);
  });
});

describe('parseBuildItems', () => {
  it('reads what the build actually places', () => {
    const items = parseBuildItems(MODEL(TETRA_OBJECT));
    expect(items).toEqual([{ objectId: '1', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }]);
  });

  it('does not mistake a component for a build item', () => {
    const xml = MODEL(`${TETRA_OBJECT}
      <object id="2"><components><component objectid="1"/></components></object>`);
    expect(parseBuildItems(xml)).toHaveLength(1);
  });

  it('returns nothing when there is no build section', () => {
    expect(parseBuildItems(`<model><resources/></model>`)).toEqual([]);
  });
});

describe('building one document', () => {
  it('flattens the build into a triangle soup', () => {
    const mesh = buildMesh(MODEL(TETRA_OBJECT));
    expect(mesh.triangles).toBe(4);
    expect(mesh.positions.length).toBe(4 * 9);
  });

  it('places an item where its transform says', () => {
    const xml = MODEL(TETRA_OBJECT).replace('<item objectid="1"/>',
      '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 0 0"/>');
    const mesh = buildMesh(xml);
    // Every x is shifted by 100; the first vertex was at the origin.
    expect(mesh.positions[0]).toBeCloseTo(100, 4);
  });

  it('assembles a component, so an assembly is not a pile at the origin', () => {
    const xml = `<model><resources>${TETRA_OBJECT}
      <object id="2">
        <components>
          <component objectid="1"/>
          <component objectid="1" transform="1 0 0 0 1 0 0 0 1 50 0 0"/>
        </components>
      </object>
    </resources><build><item objectid="2"/></build></model>`;
    const mesh = buildMesh(xml);
    expect(mesh.triangles).toBe(8);
    expect(Math.max(...xsOf(mesh.positions))).toBeCloseTo(51, 4);
  });

  it('composes nested component transforms', () => {
    const xml = `<model><resources>${TETRA_OBJECT}
      <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>
      <object id="3"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>
    </resources><build><item objectid="3"/></build></model>`;
    const mesh = buildMesh(xml);
    // 10 + 5 = 15 for the vertex that started at the origin.
    expect(mesh.positions[0]).toBeCloseTo(15, 4);
  });

  it('survives a component cycle rather than hanging', () => {
    // Nothing in the format forbids this, so nothing here may assume it cannot happen.
    const xml = `<model><resources>
      <object id="1"><components><component objectid="2"/></components></object>
      <object id="2"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="1"/></build></model>`;
    expect(buildMesh(xml).triangles).toBe(0);
  });

  it('falls back to every object when a file has no build section', () => {
    // Some exporters write none, and a model on screen beats a correct empty scene.
    const mesh = buildMesh(`<model><resources>${TETRA_OBJECT}</resources></model>`);
    expect(mesh.triangles).toBe(4);
  });

  it('returns an empty mesh for something that is not a 3MF model', () => {
    expect(buildMesh('<html><body>nope</body></html>').triangles).toBe(0);
  });

  it('ignores a build item pointing at an object that does not exist', () => {
    const xml = MODEL(TETRA_OBJECT).replace('objectid="1"', 'objectid="404"');
    expect(buildMesh(xml).triangles).toBe(0);
  });

  it('keeps top-level objects apart, with their id and metadata name for the colour join', () => {
    const named = TETRA_OBJECT.replace('id="1" type="model"', 'id="1" type="model"><metadata name="Body"/>');
    const mesh = buildMesh(`<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
      <resources>${named}${TETRA_OBJECT.replace('id="1"', 'id="2"')}</resources>
      <build><item objectid="1"/><item objectid="2"/></build>
    </model>`);
    expect(mesh.objects.map((o) => [o.id, o.name])).toEqual([['1', 'Body'], ['2', null]]);
    expect(mesh.objects[0]!.positions.length).toBe(4 * 9);
    // The per-object split concatenates back to the whole-build soup, in the same order.
    expect(mesh.objects.flatMap((o) => Array.from(o.positions))).toEqual(Array.from(mesh.positions));
  });

  it("puts a component's geometry in the object that references it, not a bucket of its own", () => {
    const xml = `<model><resources>${TETRA_OBJECT}
      <object id="2"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="2"/></build></model>`;
    const mesh = buildMesh(xml);
    expect(mesh.objects).toHaveLength(1);
    expect(mesh.objects[0]!.id).toBe('2');
    expect(mesh.objects[0]!.positions.length).toBe(4 * 9);
  });
});

/**
 * The multi-part shape a slicer writes for a big assembly: the root document carries the build
 * and assembly objects, and each object's geometry lives in its own part file that the
 * components reach through the Production extension's `p:path`.
 */
const PART_ROOT = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
  <resources>${body}</resources>
  <build><item objectid="100"/><item objectid="101"/></build>
</model>`;

const PART_FILE = (objectId: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
  <resources>${body.replace(/id="\d+"/, `id="${objectId}"`)}</resources>
  <build/>
</model>`;

describe('multi-part 3MF (buildMeshFromParts)', () => {
  /** Root assemblies: object 100 → part A's object 1, object 101 → part B's object 1. */
  const parts = () => [
    {
      name: '3D/3dmodel.model',
      xml: PART_ROOT(`
        <object id="100">
          <components><component p:path="/3D/Objects/object_a.model" objectid="1"/></components>
        </object>
        <object id="101">
          <components><component p:path="/3D/Objects/object_b.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 40 0 0"/></components>
        </object>`),
    },
    { name: '3D/Objects/object_a.model', xml: PART_FILE('1', TETRA_OBJECT) },
    { name: '3D/Objects/object_b.model', xml: PART_FILE('1', TETRA_OBJECT) },
  ];

  it('reads the geometry the root only references', () => {
    // The root has no vertices of its own, so reading it alone gives nothing.
    expect(buildMesh(parts()[0]!.xml).triangles).toBe(0);
    const mesh = buildMeshFromParts(parts());
    expect(mesh.triangles).toBe(8);
  });

  it('lands parts where the component transforms say', () => {
    const mesh = buildMeshFromParts(parts());
    // Object 101's tetrahedron is shifted by 40 on x; its farthest vertex is x=41.
    expect(Math.max(...xsOf(mesh.positions))).toBeCloseTo(41, 4);
  });

  it("applies the build item's own transform on top of the assembly", () => {
    const [root, a, b] = parts();
    const shifted = { ...root!, xml: root!.xml.replace('<item objectid="101"/>',
      '<item objectid="101" transform="1 0 0 0 1 0 0 0 1 0 100 0"/>') };
    const mesh = buildMeshFromParts([shifted, a!, b!]);
    // Item translate(0,100,0) then component translate(40,0,0) → farthest vertex at y=101.
    expect(Math.max(...ysOf(mesh.positions))).toBeCloseTo(101, 4);
  });

  it("narrows a multi-part build to one plate's objects", () => {
    const mesh = buildMeshFromParts(parts(), new Set(['101']));
    expect(mesh.triangles).toBe(4);
    // Only the shifted part survives the filter.
    expect(Math.max(...xsOf(mesh.positions))).toBeCloseTo(41, 4);
  });

  it('resolves a component with no p:path in its own part', () => {
    const selfContained = [
      {
        name: '3D/3dmodel.model',
        xml: `<model><resources>${TETRA_OBJECT}
          <object id="100"><components><component objectid="1"/></components></object>
        </resources><build><item objectid="100"/></build></model>`,
      },
    ];
    expect(buildMeshFromParts(selfContained).triangles).toBe(4);
  });

  it('falls back to the first part with objects when no part has a build', () => {
    // The root is a geometry-less assembly without `<build>`; only the part file has vertices.
    // The fallback must point at the part the object ids actually came from.
    const noBuild = [
      {
        name: '3D/3dmodel.model',
        xml: `<model><resources>
          <object id="100"><components><component p:path="/3D/Objects/object_a.model" objectid="1"/></components></object>
        </resources></model>`,
      },
      { name: '3D/Objects/object_a.model', xml: PART_FILE('1', TETRA_OBJECT) },
    ];
    expect(buildMeshFromParts(noBuild).triangles).toBe(4);
  });

  it("labels each bucket with the root object's id, which is what model_settings matches", () => {
    const mesh = buildMeshFromParts(parts());
    expect(mesh.objects.map((o) => o.id)).toEqual(['100', '101']);
    // Object 101's tetrahedron is the shifted one.
    expect(mesh.objects[1]!.positions[0]).toBeCloseTo(40, 4);
    expect(mesh.objects.flatMap((o) => Array.from(o.positions))).toEqual(Array.from(mesh.positions));
  });

  it('says which .model each object and each part was read from', () => {
    // Both part files declare an object id 1, which is legal: the Production extension only
    // requires ids to be unique within a part. Without the entry there is no way to ask the
    // colour join about *this* object 1, and the two collapse into one answer.
    const mesh = buildMeshFromParts(parts(), undefined, { paint: true });
    expect(mesh.objects.map((o) => o.entry)).toEqual(['3D/3dmodel.model', '3D/3dmodel.model']);
    expect(mesh.objects.map((o) => o.partRanges!.map((r) => [r.id, r.entry]))).toEqual([
      [['1', '3D/Objects/object_a.model']],
      [['1', '3D/Objects/object_b.model']],
    ]);
  });
});

/** The shape a slicer writes into `model_settings.config`. */
const MODEL_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2"><metadata key="name" value="Box.stl"/></object>
  <object id="3"><metadata key="name" value="Lid.stl"/></object>
  <object id="4"><metadata key="name" value="Tray.stl"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="index" value="1"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance>
    <model_instance><metadata key="object_id" value="3"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="index" value="2"/>
    <model_instance><metadata key="object_id" value="4"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
</config>`;

describe('parsePlateObjects', () => {
  it('groups objects by the plate they sit on', () => {
    const plates = parsePlateObjects(MODEL_SETTINGS);
    expect([...plates.keys()].sort()).toEqual([1, 2]);
    expect([...plates.get(1)!].sort()).toEqual(['2', '3']);
    expect([...plates.get(2)!]).toEqual(['4']);
  });

  it("does not let one plate's instances bleed into the next", () => {
    const plates = parsePlateObjects(MODEL_SETTINGS);
    expect(plates.get(2)!.has('2')).toBe(false);
  });

  it('returns an empty map for a file with no plate blocks', () => {
    // Which the caller must read as "one plate", not as "no plates".
    expect(parsePlateObjects('<config/>').size).toBe(0);
    expect(parsePlateObjects('').size).toBe(0);
  });

  it('ignores a plate with no objects on it', () => {
    const xml = `<config><plate><metadata key="index" value="1"/></plate></config>`;
    expect(parsePlateObjects(xml).size).toBe(0);
  });
});

describe('plateObjectsFor', () => {
  it("returns the requested plate's objects", () => {
    const plates = parsePlateObjects(MODEL_SETTINGS);
    expect([...(plateObjectsFor(plates, 2) ?? [])].sort()).toEqual(['4']);
  });

  it('falls back to the first plate for an unknown index, never everything', () => {
    const plates = parsePlateObjects(MODEL_SETTINGS);
    expect(plateObjectsFor(plates, 99)).toBe(plates.get(1));
  });

  it('returns nothing for a single-plate file', () => {
    const plates = new Map<number, Set<string>>([[1, new Set(['2'])]]);
    expect(plateObjectsFor(plates, 1)).toBeUndefined();
  });

  it('returns nothing when the file has no plate blocks', () => {
    expect(plateObjectsFor(new Map(), 1)).toBeUndefined();
  });
});

describe('a build narrowed to one plate', () => {
  const TWO_OBJECTS = `<model><resources>
    ${TETRA_OBJECT.replace('id="1"', 'id="2"')}
    ${TETRA_OBJECT.replace('id="1"', 'id="3"')}
  </resources><build>
    <item objectid="2"/>
    <item objectid="3" transform="1 0 0 0 1 0 0 0 1 200 0 0"/>
  </build></model>`;

  it('builds everything when no filter is given', () => {
    // Every plate at once, side by side: what a filter exists to avoid.
    expect(buildMesh(TWO_OBJECTS).triangles).toBe(8);
  });

  it('builds only the objects asked for', () => {
    expect(buildMesh(TWO_OBJECTS, new Set(['2'])).triangles).toBe(4);
    expect(buildMesh(TWO_OBJECTS, new Set(['3'])).triangles).toBe(4);
  });

  it('keeps the plate where the build put it', () => {
    // Plate 2's objects are the same mesh shifted along the bed, so the transform has to survive
    // the filter or the plate renders on top of plate 1.
    const second = buildMesh(TWO_OBJECTS, new Set(['3']));
    expect(second.positions[0]).toBeCloseTo(200, 4);
  });

  it('returns nothing for a plate whose objects are not in the file', () => {
    expect(buildMesh(TWO_OBJECTS, new Set(['99'])).triangles).toBe(0);
  });

  it('still expands components of a selected object', () => {
    // A component belongs to whatever references it; filtering must not take pieces out of a
    // model that was selected.
    const xml = `<model><resources>
      ${TETRA_OBJECT}
      <object id="5"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="5"/></build></model>`;
    expect(buildMesh(xml, new Set(['5'])).triangles).toBe(4);
  });
});

/**
 * An assembly: one wrapper object placing two tetrahedra, which is the shape both a slicer's
 * multi-part object and a spec `<basematerials>` file take. The parts are named on the
 * `<object>` attribute, the way a spec writer does it.
 */
const ASSEMBLY = `<model><resources>
  ${TETRA_OBJECT.replace('id="1" type="model"', 'id="1" type="model" name="Shell"')}
  ${TETRA_OBJECT.replace('id="1" type="model"', 'id="2" type="model" name="Cap"')}
  <object id="10"><components>
    <component objectid="1"/>
    <component objectid="2" transform="1 0 0 0 1 0 0 0 1 40 0 0"/>
  </components></object>
</resources><build><item objectid="10"/></build></model>`;

describe("an object's name", () => {
  it('reads the `name` attribute when there is no metadata element', () => {
    const objects = parseObjectsIndexed(ASSEMBLY);
    expect(objects.get('1')!.name).toBe('Shell');
    expect(objects.get('2')!.name).toBe('Cap');
    expect(objects.get('10')!.name).toBeNull();
  });

  it('reads it out of a whole spec-shaped document, not just a fragment', () => {
    // Hand-written to the core spec. What this pins is that the fallback survives the
    // surroundings a real document has: a default namespace on <model>, a model-level
    // <metadata name="Title"> before <resources>, and other attributes either side of `name` on
    // <object>.
    const document = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">Two-tone bracket</metadata>
  <metadata name="Designer">Not an object name</metadata>
  <resources>
    <basematerials id="1">
      <base name="Shell" displaycolor="#DE4343FF"/><base name="Cap" displaycolor="#161616FF"/>
    </basematerials>
    ${TETRA_OBJECT.replace('id="1" type="model"', 'id="1" pid="1" pindex="0" name="Bracket body" type="model"')}
  </resources>
  <build><item objectid="1"/></build>
</model>`;
    // The model-level metadata sits outside every <object> block and must not leak in.
    expect(parseObjectsIndexed(document).get('1')!.name).toBe('Bracket body');
  });

  it('still prefers the metadata element', () => {
    const both = TETRA_OBJECT
      .replace('id="1" type="model"', 'id="1" type="model" name="Attribute"><metadata name="Element"/');
    expect(parseObjectsIndexed(MODEL(both)).get('1')!.name).toBe('Element');
  });
});

describe('partRanges', () => {
  it('says which run of triangles came from which part', () => {
    // Without this an assembly is one mesh with one colour, and renders in whichever of its
    // parts' filaments happened to be read last.
    const mesh = buildMeshFromParts([{ name: '', xml: ASSEMBLY }], undefined, { paint: true });
    expect(mesh.objects).toHaveLength(1);
    expect(mesh.objects[0]!.partRanges).toEqual([
      { id: '1', name: 'Shell', entry: '', start: 0, count: 4 },
      { id: '2', name: 'Cap', entry: '', start: 4, count: 4 },
    ]);
  });

  it('is not collected when paint was not asked for', () => {
    const mesh = buildMeshFromParts([{ name: '', xml: ASSEMBLY }]);
    expect(mesh.objects[0]!.partRanges).toBeNull();
    expect(mesh.triangles).toBe(8);
  });

  it('covers every triangle of the object exactly once', () => {
    const mesh = buildMeshFromParts([{ name: '', xml: ASSEMBLY }], undefined, { paint: true });
    const ranges = mesh.objects[0]!.partRanges!;
    expect(ranges.reduce((n, r) => n + r.count, 0)).toBe(mesh.objects[0]!.positions.length / 9);
    expect(ranges[1]!.start).toBe(ranges[0]!.count);
  });

  it('stays aligned with the per-face filaments, which subdivide the geometry', () => {
    // A painted face is not one triangle on screen, so a range measured against the unsplit
    // triangles would be off by however many pieces the first painted face turned into.
    const painted = ASSEMBLY.replace('<triangle v1="0" v2="2" v3="1"/>', '<triangle v1="0" v2="2" v3="1" paint_color="40003"/>');
    const mesh = buildMeshFromParts([{ name: '', xml: painted }], undefined, { paint: true });
    const [shell, cap] = mesh.objects[0]!.partRanges!;
    // The first object's painted face became four; the second object is untouched.
    expect(shell!.count).toBe(7);
    expect(cap).toEqual({ id: '2', name: 'Cap', entry: '', start: 7, count: 4 });
    expect(mesh.objects[0]!.filaments!.length).toBe(11);
  });

  it('gives an object with its own geometry a range of itself', () => {
    const mesh = buildMeshFromParts([{ name: '', xml: MODEL(TETRA_OBJECT) }], undefined, { paint: true });
    expect(mesh.objects[0]!.partRanges).toEqual([{ id: '1', name: null, entry: '', start: 0, count: 4 }]);
  });
});

describe('an assembly whose parts sit on different extruders', () => {
  /** The `model_settings.config` a slicer writes for `ASSEMBLY`: two parts, two filaments. */
  const settings = `<config><object id="10">
      <metadata key="name" value="clicker"/>
      <metadata key="extruder" value="1"/>
      <part id="1"><metadata key="name" value="Shell"/><metadata key="extruder" value="1"/></part>
      <part id="2"><metadata key="name" value="Cap"/><metadata key="extruder" value="3"/></part>
    </object></config>`;
  const slice = `<config><plate>
      <filament id="1" color="#FF6A13"/><filament id="3" color="#161616"/>
    </plate></config>`;

  it('resolves a colour per part where the object alone resolves to one', () => {
    const paint = buildPaint(settings, slice);
    const mesh = buildMeshFromParts([{ name: '', xml: ASSEMBLY }], undefined, { paint: true });
    const object = mesh.objects[0]!;

    // The object alone: one id, one colour, the whole model flat.
    expect(colorForObject(paint, object.name ?? undefined, object.id)).toBe('#ff6a13');

    expect(object.partRanges!.map((r) => colorForPart(paint, object.id, r.id, r.name)))
      .toEqual(['#ff6a13', '#161616']);
  });

  it('resolves the same two colours from the spec channel, with no config file at all', () => {
    const spec = ASSEMBLY
      .replace('<resources>', `<resources><basematerials id="1">` +
        `<base name="Shell" displaycolor="#FF6A13FF"/><base name="Cap" displaycolor="#161616FF"/>` +
        `</basematerials>`)
      .replace('id="1" type="model" name="Shell"', 'id="1" type="model" name="Shell" pid="1" pindex="0"')
      .replace('id="2" type="model" name="Cap"', 'id="2" type="model" name="Cap" pid="1" pindex="1"');

    const paint = buildPaint('', '', '', spec);
    const mesh = buildMeshFromParts([{ name: '', xml: spec }], undefined, { paint: true });
    const object = mesh.objects[0]!;

    // The wrapper itself is not coloured: the whole point is that it cannot be.
    expect(colorForObject(paint, object.name ?? undefined, object.id)).toBeNull();
    expect(object.partRanges!.map((r) => colorForPart(paint, object.id, r.id, r.name)))
      .toEqual(['#ff6a13', '#161616']);
  });
});
