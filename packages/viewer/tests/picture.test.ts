/*
  A part that shows a picture (`ViewerPart.uv` and `texture`), run against the stand-in page and
  WebGL context (tests/support/page.ts): drawn with the picture and white under it, on the stage
  and in a thumbnail; sent to the GPU once however often the parts are rebuilt; and let go once no
  part shows it. A part without a picture is drawn as it always was: default-path.test.ts pins
  that call for call.

    pnpm --filter @vostok/viewer test
*/
import * as THREE from 'three';
import { installPage } from './support/page';
import { RED, tetra } from './support/parts';

const page = installPage();
const { createViewer } = await import('../src/index');
type Viewer = import('../src/index').Viewer;

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};
const stage = page.stage as unknown as HTMLElement;
const GREEN: [number, number, number] = [20, 200, 30];

/** A picture to show: a canvas of the stand-in page, sized so its uploads can be told apart. */
function picture(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** A uv for each of a tetrahedron's four corners. */
const UV = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const pictured = (texture: HTMLCanvasElement, s = 10) => tetra(0, 0, 0, s, RED, { uv: UV, texture });

const lines = (start: string) => page.log.filter((l) => l.startsWith(start)).length;
/** The times a picture has been sent to the GPU: the WebGL calls that carry it. */
const uploads = (c: HTMLCanvasElement) => page.log.filter((l) => /^tex(Sub)?Image2D\(/.test(l) && l.includes(`canvas ${c.width}x${c.height}`)).length;
/** WebGL textures alive: made and not yet deleted. */
const glTextures = () => lines('createTexture(') - lines('deleteTexture(');
const mapOf = (mesh: THREE.Object3D | undefined) => ((mesh as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;

/** Whether a texture has been disposed since this was called. */
function watchDispose(t: THREE.Texture | null): () => boolean {
  let gone = false;
  t?.addEventListener('dispose', () => (gone = true));
  return () => gone;
}

/** The stand-in context reports no uniforms, so nothing in its draws samples a map, and no draw
 *  sends a picture: a test sends one as a draw would, with three's own `initTexture`. */
const send = (v: Viewer, t: THREE.Texture | null) => t && v.renderer.initTexture(t);

/** The pictures a thumbnail of `parts` was drawn with, each with whether it has been let go. */
function thumbnailMaps(v: Viewer, parts?: Parameters<Viewer['renderThumbnail']>[1]) {
  const maps: { map: THREE.Texture; gone: () => boolean }[] = [];
  const add = v.scene.add;
  v.scene.add = function (...objects: THREE.Object3D[]) {
    for (const o of objects) o.traverse((c) => {
      const map = mapOf(c);
      if (map && !maps.some((m) => m.map === map)) maps.push({ map, gone: watchDispose(map) });
    });
    return add.apply(this, objects);
  };
  try {
    return { url: v.renderThumbnail(64, parts), maps };
  } finally {
    v.scene.add = add;
  }
}

{
  const v = createViewer(stage);
  page.frame();
  const sky = picture(120, 90);
  const before = glTextures();
  const mark = page.log.length;
  v.setParts([pictured(sky), tetra(20, 0, 0, 10, GREEN)], true);
  page.frame();

  const [shown, plain] = v.partMeshes();
  const m = shown!.material as THREE.MeshStandardMaterial;
  const p = plain!.material as THREE.MeshStandardMaterial;
  check('a picture: the part is drawn with it, in sRGB', m.map?.image === sky && m.map.colorSpace === THREE.SRGBColorSpace);
  check('a picture: white under it, so its colours are its own', m.color.getHex() === 0xffffff, m.color.getHexString());
  check('a picture: the same surface as every other part', m.roughness === p.roughness && m.metalness === p.metalness && m.side === THREE.DoubleSide && p.side === THREE.DoubleSide);
  check('a picture: its uv on the geometry', shown!.geometry.getAttribute('uv')?.count === shown!.geometry.getAttribute('position').count);
  const green = new THREE.Color().setRGB(GREEN[0] / 255, GREEN[1] / 255, GREEN[2] / 255, THREE.SRGBColorSpace);
  check('no picture: the part beside it is its colour, with no map and no uv', p.map === null && p.color.equals(green) && !plain!.geometry.getAttribute('uv'));

  const map = m.map;
  send(v, map);
  const stored = page.log.slice(mark).filter((l) => l.startsWith('texStorage2D('));
  check('a picture: sent to the GPU once, stored as sRGB', uploads(sky) === 1 && stored.length === 1 && stored[0]!.includes('SRGB8_ALPHA8, 120, 90'), stored.join(' | '));
  check('a picture: one texture more on the GPU', glTextures() === before + 1, `${glTextures() - before}`);

  // A slider drag rebuilds the parts on every step: the same picture, the same texture, so
  // nothing is sent again.
  for (let i = 1; i <= 3; i++) {
    v.setParts([pictured(sky), tetra(20, 0, 0, 10 + i, GREEN)]);
    page.frame();
    send(v, mapOf(v.partMeshes()[0]));
  }
  check('rebuilt three times: the same texture, never marked for sending again', mapOf(v.partMeshes()[0]) === map && map!.version === 1, `version ${map?.version}`);
  check('rebuilt three times: still sent once, still one texture', uploads(sky) === 1 && glTextures() === before + 1);

  v.setPartGeometry(0, pictured(sky, 12));
  check('a new shape for the part: its uv comes with it, and the picture stays', !!v.partMeshes()[0]!.geometry.getAttribute('uv') && mapOf(v.partMeshes()[0]) === map);

  // Only one of the two is no picture; and a picture no part shows any more is let go.
  const skyGone = watchDispose(map);
  v.setParts([tetra(0, 0, 0, 10, RED, { texture: sky }), tetra(20, 0, 0, 10, GREEN, { uv: UV })]);
  page.frame();
  check('a texture without a uv, or a uv without a texture: the part is its colour', v.partMeshes().every((mesh) => mapOf(mesh) === null));
  check('a picture no part shows: let go, and off the GPU', skyGone() && glTextures() === before);

  v.setParts([pictured(sky)]);
  page.frame();
  const onStage = mapOf(v.partMeshes()[0]);
  send(v, onStage);
  check('shown again: a new texture, sent again', onStage !== null && onStage !== map && uploads(sky) === 2);

  // Thumbnails: the stage's picture is drawn with the stage's texture and kept; one only the
  // thumbnail shows is made for it and let go after it.
  const same = thumbnailMaps(v, [pictured(sky)]);
  check('a thumbnail of the stage\'s picture: drawn with the stage\'s texture, which stays',
    same.url !== null && same.maps.length === 1 && same.maps[0]!.map === onStage && !same.maps[0]!.gone() && mapOf(v.partMeshes()[0]) === onStage);
  const sea = picture(80, 60);
  const own = thumbnailMaps(v, [pictured(sea)]);
  check('a thumbnail of a picture of its own: drawn with it, then let go',
    own.url !== null && own.maps.length === 1 && own.maps[0]!.map.image === sea && own.maps[0]!.gone());
  const stageGone = watchDispose(onStage);
  thumbnailMaps(v);
  check('the stage\'s picture is kept through every thumbnail', !stageGone() && mapOf(v.partMeshes()[0]) === onStage && uploads(sky) === 2);

  const deleted = lines('deleteTexture(');
  v.dispose();
  check('dispose: the picture is let go with the stage, and off the GPU', stageGone() && lines('deleteTexture(') > deleted);
}

console.log(`\npicture: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
