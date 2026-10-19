/*
  The studio scene (src/scene.ts) without a GPU: a transparent backdrop draws no wash and no
  floor fade, so the scene builds in node with no 2D canvas, and everything a picture depends on
  apart from its pixels can be read off it: the copy of the model it draws, the materials, the
  framing, the floor, the orientation and the light rig.
*/
import * as THREE from 'three';
import { describe, expect, it } from './support/spec';
import { buildStudioScene, fitDistance, type StudioScene } from '../src/scene';
import { loadRenderModel, type LoadedModel } from '../src/load';
import { sampleModel } from '../src/still';
import { AS_PRINTED, type Colourway } from '../src/regions';
import {
  DEFAULT_LIGHTING, FLAT, PRESET_SHOTS, backdropById, shotById, type SceneOptions,
} from '../src/studio';

/** A binary STL box, `w` by `d` by `h` mm, standing on z = 0. */
function boxStl(w: number, d: number, h: number): Uint8Array {
  const g = new THREE.BoxGeometry(w, d, h).toNonIndexed();
  g.translate(w / 2, d / 2, h / 2);
  const p = g.attributes.position!;
  const n = p.count / 3;
  const buffer = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buffer);
  view.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const at = 84 + t * 50 + 12 + k * 12;
      view.setFloat32(at, p.getX(t * 3 + k), true);
      view.setFloat32(at + 4, p.getY(t * 3 + k), true);
      view.setFloat32(at + 8, p.getZ(t * 3 + k), true);
    }
  }
  return new Uint8Array(buffer);
}

const look = (over: Partial<SceneOptions> = {}): SceneOptions => ({
  shot: PRESET_SHOTS[0]!,
  backdrop: backdropById('transparent'),
  colourway: AS_PRINTED,
  orientation: FLAT,
  lighting: DEFAULT_LIGHTING,
  shadow: true,
  ...over,
});

const env = new THREE.Texture();
const build = (model: LoadedModel, over: Partial<SceneOptions> = {}, aspect = 1) =>
  buildStudioScene(model, look(over), env, aspect);

/** The meshes of the model in a scene: everything but the floor. */
const subjectMeshes = (studio: StudioScene) => {
  const out: THREE.Mesh[] = [];
  studio.scene.traverse((c) => {
    if (c instanceof THREE.Mesh && !(c.geometry instanceof THREE.PlaneGeometry)) out.push(c);
  });
  return out;
};
const floorOf = (studio: StudioScene) =>
  studio.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry)!;
const keyOf = (studio: StudioScene) =>
  studio.scene.children.filter((c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight)[0]!;
const materialsOf = (mesh: THREE.Mesh) => ([] as THREE.Material[]).concat(mesh.material);

const tall = () => loadRenderModel(boxStl(10, 10, 40), 'Tower.stl');

describe('the copy of the model a scene draws', () => {
  it('leaves the loaded model where it was, unpainted', () => {
    const model = tall();
    const loaded = model.object as THREE.Mesh;
    const before = loaded.material;
    const studio = build(model);
    expect(model.object.parent).toBeNull();
    expect(loaded.material).toBe(before);
    expect(loaded.castShadow).toBe(false);
    studio.dispose();
    expect(model.object.parent).toBeNull();
  });

  it('shares the geometry rather than copying it', () => {
    const model = tall();
    const studio = build(model);
    expect(subjectMeshes(studio)[0]!.geometry).toBe((model.object as THREE.Mesh).geometry);
    studio.dispose();
  });

  it('lets two scenes of one model live at once, and disposing one frees nothing of the other', () => {
    const model = tall();
    const a = build(model);
    const b = build(model);
    let freed = 0;
    for (const m of materialsOf(subjectMeshes(b)[0]!)) m.addEventListener('dispose', () => { freed++; });
    a.dispose();
    expect(freed).toBe(0);
    expect(subjectMeshes(b)).toHaveLength(1);
    b.dispose();
    expect(freed).toBe(1);
  });

  it('casts and takes shadows only when the look asks for them', () => {
    const model = tall();
    const on = build(model);
    const off = build(model, { shadow: false });
    expect(subjectMeshes(on)[0]!.castShadow).toBe(true);
    expect(subjectMeshes(off)[0]!.castShadow).toBe(false);
    on.dispose();
    off.dispose();
  });
});

describe('colours', () => {
  it("draws a region in the file's colour, or the placeholder where the file said none", () => {
    const studio = build(tall());
    const m = materialsOf(subjectMeshes(studio)[0]!)[0] as THREE.MeshPhysicalMaterial;
    expect(m.color.getHexString()).toBe('b9a8f5');
    studio.dispose();
  });

  it('draws a colourway over it, with its finish', () => {
    const gold: Colourway = { id: 'g', name: 'Gold', colours: { whole: { hex: '#c9a227', finishId: 'silk' } } };
    const studio = build(tall(), { colourway: gold });
    const m = materialsOf(subjectMeshes(studio)[0]!)[0] as THREE.MeshPhysicalMaterial;
    expect(m.color.getHexString()).toBe('c9a227');
    expect(m.metalness).toBeGreaterThan(0);
    studio.dispose();
  });

  it('gives regions of one colour and finish one material between them', () => {
    const model = loadRenderModel(boxStl(10, 10, 10), 'Box.stl');
    // Two regions on one mesh, as a coloured 3MF has: the same colour on both.
    const mesh = model.object as THREE.Mesh;
    mesh.geometry.clearGroups();
    mesh.geometry.addGroup(0, 18, 0);
    mesh.geometry.addGroup(18, 18, 1);
    mesh.userData.regionKeys = ['a', 'b'];
    model.regions = [
      { key: 'a', label: 'A', source: 'part', fileHex: '#161616', triangles: 6 },
      { key: 'b', label: 'B', source: 'part', fileHex: '#161616', triangles: 6 },
    ];
    const studio = build(model);
    const [first, second] = materialsOf(subjectMeshes(studio)[0]!);
    expect(first).toBe(second);
    studio.dispose();
  });
});

describe('framing', () => {
  it('puts the camera at the fitted distance along the shot, times its zoom', () => {
    const model = tall();
    for (const id of ['hero', 'low', 'top']) {
      const shot = shotById(PRESET_SHOTS, id);
      const studio = build(model, { shot }, 4 / 3);
      const expected = fitDistance(studio.radius, 4 / 3) * shot.zoom;
      expect(studio.camera.position.distanceTo(studio.center)).toBeCloseTo(expected, 6);
      expect(studio.distance).toBeCloseTo(expected, 6);
      const dir = studio.camera.position.clone().sub(studio.center).normalize();
      expect(dir.dot(new THREE.Vector3(...shot.dir).normalize())).toBeCloseTo(1, 9);
      studio.dispose();
    }
  });

  it('looks at the centre moved by the shot\'s pan, at the same distance and direction', () => {
    const model = tall();
    const hero = shotById(PRESET_SHOTS, 'hero');
    const plain = build(model, { shot: hero });
    const panned = build(model, { shot: { ...hero, offset: [0.5, -0.25, 0] } });
    expect(plain.target.distanceTo(plain.center)).toBeCloseTo(0, 9);
    const moved = panned.target.clone().sub(panned.center).divideScalar(panned.radius);
    expect(moved.x).toBeCloseTo(0.5, 9);
    expect(moved.y).toBeCloseTo(-0.25, 9);
    expect(panned.camera.position.distanceTo(panned.target)).toBeCloseTo(plain.distance, 6);
    const dir = panned.camera.position.clone().sub(panned.target).normalize();
    expect(dir.dot(new THREE.Vector3(...hero.dir).normalize())).toBeCloseTo(1, 9);
    plain.dispose();
    panned.dispose();
  });

  it('fits a wide frame by its height and a tall frame by its width', () => {
    expect(fitDistance(10, 0.5)).toBeGreaterThan(fitDistance(10, 1));
    expect(fitDistance(10, 2)).toBeCloseTo(fitDistance(10, 1), 9);
  });

  it('scales the depth range to the model', () => {
    const studio = build(tall());
    expect(studio.camera.near).toBeCloseTo(studio.radius / 100, 9);
    expect(studio.camera.far).toBeGreaterThan(studio.distance + studio.radius);
    studio.dispose();
  });
});

describe('the floor', () => {
  it("sits just under the model's lowest point", () => {
    const studio = build(tall());
    expect(floorOf(studio).position.y).toBeCloseTo(-studio.radius * 0.002, 9);
    studio.dispose();
  });

  it('is only a shadow on the transparent backdrop, as strong as the lighting says', () => {
    const studio = build(tall(), { lighting: { ...DEFAULT_LIGHTING, shadowStrength: 0.5 } });
    const m = floorOf(studio).material as THREE.ShadowMaterial;
    expect(m instanceof THREE.ShadowMaterial).toBe(true);
    expect(m.opacity).toBeCloseTo(0.21, 9);
    studio.dispose();
  });
});

describe('standing the model up', () => {
  const heightOf = (studio: StudioScene) =>
    new THREE.Box3().setFromObject(subjectMeshes(studio)[0]!).getSize(new THREE.Vector3()).y;

  it('stands a z-up file up, and a quarter tip lays it down', () => {
    const model = tall();
    const upright = build(model);
    expect(heightOf(upright)).toBeCloseTo(40, 4);
    const tipped = build(model, { orientation: { ...FLAT, tip: 1 } });
    expect(heightOf(tipped)).toBeCloseTo(10, 4);
    upright.dispose();
    tipped.dispose();
  });

  it('never applies the tumble to the loaded model itself', () => {
    const model = tall();
    const rotation = model.object.rotation.clone();
    build(model, { orientation: { ...FLAT, tip: 1, roll: 3, turnFine: 12 } }).dispose();
    expect(model.object.rotation.equals(rotation)).toBe(true);
  });
});

describe('the light rig', () => {
  it('moves with the camera, like a lightbox, unless locked to the model', () => {
    const model = tall();
    const loose = build(model);
    const before = keyOf(loose).position.clone();
    loose.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    loose.relight();
    expect(keyOf(loose).position.distanceTo(before)).toBeGreaterThan(loose.radius);

    const locked = build(model, { lighting: { ...DEFAULT_LIGHTING, lockToModel: true } });
    const fixed = keyOf(locked).position.clone();
    locked.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    locked.relight();
    expect(keyOf(locked).position.distanceTo(fixed)).toBeCloseTo(0, 9);
    loose.dispose();
    locked.dispose();
  });

  it('jitters the key within its softness, and one pass puts it back', () => {
    const studio = build(tall());
    const base = keyOf(studio).position.clone();
    for (let i = 0; i < 24; i++) {
      studio.jitter(i, 24);
      expect(keyOf(studio).position.distanceTo(base)).toBeLessThanOrEqual(studio.radius * DEFAULT_LIGHTING.softness + 1e-9);
    }
    studio.jitter(0, 1);
    expect(keyOf(studio).position.distanceTo(base)).toBeCloseTo(0, 9);
    studio.dispose();
  });

  it('keeps the key the same distance from the model as it jitters, so exposure holds', () => {
    // The jitter moves the light across a disc perpendicular to its direction: towards or away
    // from the model would brighten or dim the pass.
    const studio = build(tall());
    const base = keyOf(studio).position.clone();
    const towards = base.clone().sub(studio.center).normalize();
    studio.jitter(5, 24);
    const moved = keyOf(studio).position.clone().sub(base);
    expect(moved.dot(towards)).toBeCloseTo(0, 6);
    studio.dispose();
  });
});

describe('the sample sphere', () => {
  it('is one grey region that a colourway can recolour', () => {
    const sample = sampleModel();
    expect(sample).toBe(sampleModel());
    expect(sample.regions.map((r) => [r.key, r.fileHex])).toEqual([['whole', '#8a8d93']]);
    expect(sample.regions[0]!.triangles).toBeGreaterThan(1000);
    const studio = build(sample);
    const m = materialsOf(subjectMeshes(studio)[0]!)[0] as THREE.MeshPhysicalMaterial;
    expect(m.color.getHexString()).toBe('8a8d93');
    // Grey is a shelf filament, so auto finds its matte finish.
    expect(m.roughness).toBeCloseTo(0.78, 9);
    studio.dispose();
  });
});
