import { buildThreeMF } from '../src/export/threemfExport.ts';
import { unzipSync, strFromU8 } from 'fflate';

const tetra = (
  color: [number, number, number],
  name: string,
  z: number,
  group: 'top' | 'base',
) => ({
  kind: 'cap' as const,
  group,
  colorRgb: color,
  name,
  numProp: 3,
  vertProperties: new Float32Array([0, 0, z, 10, 0, z, 0, 10, z, 0, 0, z + 10]),
  triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
});

// Two parts in the top group, one in the base — the shape a real clicker has, and the
// one that proves the grouping rather than a 1:1 part-to-object mapping.
const parts = [
  tetra([255, 0, 0], 'top-base', 5, 'top'),
  tetra([0, 255, 0], 'top-color-0-0', 5, 'top'),
  tetra([0, 128, 255], 'base-body', 8, 'base'),
];
const bytes = buildThreeMF(parts as any);

const files = unzipSync(bytes);
const names = Object.keys(files);
const relsNoCover = strFromU8(files['_rels/.rels']);

// The same file again, this time with a cover image. Not a real PNG — nothing here decodes
// it, and what is being tested is that the bytes reach the package under both names with
// the relationship and the content type that make them findable.
const fakePng = new TextEncoder().encode('PNG-BYTES-STAND-IN');
const fakeSmallPng = new TextEncoder().encode('SMALL-PNG-STAND-IN');
const coverFiles = unzipSync(buildThreeMF(parts as any, { coverPng: fakePng }));
const coverNames = Object.keys(coverFiles);
const relsCover = strFromU8(coverFiles['_rels/.rels']);
const typesCover = strFromU8(coverFiles['[Content_Types].xml']);
const model = strFromU8(files['3D/3dmodel.model']);
const settings = strFromU8(files['Metadata/model_settings.config']);

// Per-object mesh bounding boxes, as a slicer sees them BEFORE any item
// transform. Both objects must sit on Z=0 and must not overlap in X, or Bambu
// Studio treats the file as one assembly and merges top+base into a single
// object with parts.
const objBoxes = [...model.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)]
  .map(([, id, body]) => {
    const zs = [...body.matchAll(/z="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    const xs = [...body.matchAll(/x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    return zs.length ? { id, minZ: Math.min(...zs), minX: Math.min(...xs), maxX: Math.max(...xs) } : null;
  })
  .filter((b): b is NonNullable<typeof b> => b !== null);

const allOnPlate = objBoxes.every((b) => Math.abs(b.minZ) < 1e-6);
// leaves 2,3 = top; leaf 4 = base, in the fixture above
const topBox = objBoxes.find((b) => b.id === '2')!;
const baseBox = objBoxes.find((b) => b.id === '4')!;
const separatedInX = topBox.minX > baseBox.maxX || baseBox.minX > topBox.maxX;

// The two independently-movable objects: one <components> wrapper each, one build item
// each. Both items carry the SAME transform — it only slides the whole plate layout to
// the middle of the bed, so the side-by-side arrangement baked into the meshes survives.
const wrappers = [...model.matchAll(/<object id="(\d+)" type="model"><components>(.*?)<\/components>/g)]
  .map(([, id, body]) => ({ id, comps: (body.match(/objectid=/g) || []).length }));
const itemTransforms = [...model.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1]);
const itemObjectIds = [...model.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1]);
// Every part in model_settings.config must sit under one of the two wrappers, and the
// wrappers must be the objects the build items reference — that pairing is what makes
// Bambu Studio show "clicker_top" and "clicker_base" as two movable objects.
const cfgObjects = [...settings.matchAll(/<object id="(\d+)"><metadata key="name" value="([^"]+)"\/>((?:(?!<\/object>)[\s\S])*)/g)]
  .map(([, id, name, body]) => ({ id, name, parts: (body.match(/<part /g) || []).length }));

const checks: [string, boolean][] = [
  ['has [Content_Types].xml', names.includes('[Content_Types].xml')],
  ['has _rels/.rels', names.includes('_rels/.rels')],
  ['has 3D/3dmodel.model', names.includes('3D/3dmodel.model')],
  ['unit=millimeter', /unit="millimeter"/.test(model)],
  ['3 basematerials', (model.match(/<base /g) || []).length === 3],
  ['3 leaf mesh objects', (model.match(/<object [^>]*pid="1"/g) || []).length === 3],
  ['2 group wrappers', wrappers.length === 2],
  ['top wrapper holds both top parts', wrappers[0]?.comps === 2],
  ['base wrapper holds the one base part', wrappers[1]?.comps === 1],
  ['2 build items', itemObjectIds.length === 2],
  ['build items reference the wrappers, not the leaves',
    itemObjectIds.join(',') === wrappers.map((w) => w.id).join(',')],
  ['both items share one transform (layout stays baked in the meshes)',
    itemTransforms.length === 2 && itemTransforms[0] === itemTransforms[1]],
  ['model_settings names two objects: clicker_top, clicker_base',
    cfgObjects.map((o) => o.name).join(',') === 'clicker_top,clicker_base'],
  ['model_settings groups parts 2 + 1 under them',
    cfgObjects[0]?.parts === 2 && cfgObjects[1]?.parts === 1],
  ['every object mesh sits on the plate (min z=0)', allOnPlate],
  ['top and base do not overlap in X', separatedInX],
  ['dropped to plate (min z=0)', /z="0"/.test(model)],
  ['blue color present', /displaycolor="#0080ffFF"/i.test(model)],
  // BambuStudio-<version> is required: bbs_3mf.cpp only sets is_bbl_3mf when Application
  // starts with it, and without that flag Studio skips project_settings.config and the
  // model imports monochrome. Our own identity lives in the vl:* keys.
  ['Application marks the file as a Bambu project',
    /<metadata name="Application">BambuStudio-[\d.]+<\/metadata>/.test(model)],
  ['vl:application metadata', /<metadata name="vl:application">Vostok Labs Clicker Generator<\/metadata>/.test(model)],
  ['Designer metadata', /<metadata name="Designer">Vostok Labs<\/metadata>/.test(model)],
  ['vl namespace declared', /xmlns:vl="/.test(model)],
  ['has Metadata/vostok_labs.txt', names.includes('Metadata/vostok_labs.txt')],
  // A file with no cover is still a valid 3MF, and must not gain a png content type or a
  // thumbnail relationship pointing at a part that is not there.
  ['no cover means no thumbnail part', !names.includes('Metadata/plate_1.png')],
  ['no cover means no thumbnail relationship', !/metadata\/thumbnail/i.test(relsNoCover)],
  ['no cover means no Bambu cover relationship', !/cover-thumbnail/i.test(relsNoCover)],
  /* With a cover: one image under one name, aimed at by all three relationships a reader
     might look through. The earlier shape wrote the bytes twice, as an invented
     `Metadata/thumbnail.png` for the OPC relationship and as `Metadata/plate_1.png` on the
     assumption that Bambu Studio finds that by convention. It does not — it reads its own
     two cover relationships, which were not there, so the cover never appeared in Bambu or
     Orca and the file carried the picture twice for nothing. The names and relationship
     types below are copied from a 3MF Bambu Studio saved itself. */
  ['cover written as Metadata/plate_1.png', coverNames.includes('Metadata/plate_1.png')],
  ['cover not written twice', !coverNames.includes('Metadata/thumbnail.png')],
  ['cover bytes survive the zip intact',
    strFromU8(coverFiles['Metadata/plate_1.png']) === strFromU8(fakePng)],
  ['small cover falls back to the full-size one when not supplied',
    strFromU8(coverFiles['Metadata/plate_1_small.png']) === strFromU8(fakePng)],
  ['small cover used when supplied',
    strFromU8(
      unzipSync(buildThreeMF(parts as any, { coverPng: fakePng, coverSmallPng: fakeSmallPng }))[
        'Metadata/plate_1_small.png'
      ],
    ) === strFromU8(fakeSmallPng)],
  ['OPC thumbnail relationship aimed at plate_1.png',
    /Target="\/Metadata\/plate_1\.png"[^>]*relationships\/metadata\/thumbnail/.test(relsCover)],
  ['Bambu middle cover relationship declared',
    /Target="\/Metadata\/plate_1\.png"[^>]*cover-thumbnail-middle/.test(relsCover)],
  ['Bambu small cover relationship declared',
    /Target="\/Metadata\/plate_1_small\.png"[^>]*cover-thumbnail-small/.test(relsCover)],
  ['png declared in [Content_Types].xml',
    /<Default Extension="png" ContentType="image\/png"\/>/.test(typesCover)],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? 'PASS ' : 'FAIL ') + label);
  if (!pass) ok = false;
}
console.log(ok ? '\nALL EXPORT CHECKS PASSED' : '\nEXPORT CHECKS FAILED');
process.exit(ok ? 0 : 1);
