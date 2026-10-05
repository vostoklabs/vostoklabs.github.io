// The material preview held to its two promises, in node, no browser:
//
// 1. With no options it is Laser Studio's 3D view, number for number: the light stage, the
//    lamps, the 10 mm grid, the camera and where the first render frames it, the wood, the burn
//    and where the engraves and scores sit on the face. Every option was added with a default
//    that keeps this, and these checks are what holds it.
// 2. Each option does what it says: the camera, the lamps, the grid size, the contact shadow,
//    framing on given bounds, pieces placed by their own axes, slits, moving pieces without
//    rebuilding them, zoom, projecting a point onto the canvas, and picking a piece by clicking
//    it (the main button, a click and not a drag; the nearest piece wins).
//
// three.js runs for real; only the WebGL renderer is a stand-in that records what it was asked,
// and the page is a few fake elements. `FINGERPRINT=1` prints a digest of the whole default scene
// (every vertex, every material) instead, so two versions of the module can be compared:
//   PREVIEW_MODULE=<path to another material-preview.ts> FINGERPRINT=1 node tests/material-preview.test.mjs
//
// Run: node tests/material-preview.test.mjs   (esbuild bundles the TS source under test)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const root = `${here}..`;
const tmp = `${here}.tmp-material-preview`;
mkdirSync(tmp, { recursive: true });
const MODULE = (process.env.PREVIEW_MODULE ?? `${root}/src/material-preview.ts`).split('\\').join('/');
const FINGERPRINT = !!process.env.FINGERPRINT;
/** Another version of the module (the comparison above): only the default look applies to it. */
const OTHER = !!process.env.PREVIEW_MODULE;

// --------------------------------------------------------------------------------- the page --
/** What the stand-in renderer was asked, in order. */
const log = [];
class FakeTarget {
  listeners = new Map();
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  fire(type, extra = {}) {
    const ev = { type, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const fn of this.listeners.get(type) ?? []) fn.call(this, ev);
  }
}
const W = 800;
const H = 600;
const rootNode = new FakeTarget();
class FakeCanvas extends FakeTarget {
  style = {};
  attrs = {};
  removed = false;
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  getRootNode() {
    return rootNode;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, x: 0, y: 0, width: W, height: H, right: W, bottom: H };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  remove() {
    this.removed = true;
  }
}
/** The WebGL renderer, as far as the preview drives it. */
class FakeRenderer {
  constructor(params) {
    this.domElement = new FakeCanvas();
    log.push(['new', params]);
    FakeRenderer.last = this;
  }
  setPixelRatio(r) {
    log.push(['setPixelRatio', r]);
  }
  setSize(w, h) {
    log.push(['setSize', w, h]);
  }
  render(scene, camera) {
    // What the real one does before drawing: bring every matrix up to date.
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
    this.scene = scene;
    this.camera = camera;
    log.push(['render']);
  }
  dispose() {
    log.push(['dispose']);
  }
}
globalThis.__FakeRenderer = FakeRenderer;
globalThis.devicePixelRatio = 1;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
// The contact shadow draws its fade on a canvas.
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' }),
  }),
};
const host = () => ({ clientWidth: W, clientHeight: H, dataset: {}, children: [], append(el) { this.children.push(el); } });

// ------------------------------------------------------------------------ bundle with stand-in --
const THREE_STAND_IN = 'three-with-a-fake-renderer';
await build({
  stdin: {
    contents: `export * from '${MODULE}'; export * as THREE from 'three';`,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: `${tmp}/bundle.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
  plugins: [{
    name: 'fake-renderer',
    setup(b) {
      // Everything that imports three gets three with the WebGL renderer swapped out; the
      // stand-in itself gets the real thing.
      b.onResolve({ filter: /^three$/ }, (a) => (a.namespace === THREE_STAND_IN ? null : { path: 'three', namespace: THREE_STAND_IN }));
      b.onLoad({ filter: /.*/, namespace: THREE_STAND_IN }, () => ({
        contents: `export * from 'three'; export const WebGLRenderer = globalThis.__FakeRenderer;`,
        resolveDir: root,
        loader: 'js',
      }));
    },
  }],
});
const M = await import(`${pathToFileURL(`${tmp}/bundle.mjs`).href}?${Date.now()}`);
const { createMaterialPreview, THREE } = M;

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + what);
  }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearV = (v, w, eps = 1e-9) => near(v.x, w[0], eps) && near(v.y, w[1], eps) && near(v.z, w[2], eps);
const fmt = (v) => `(${[v.x, v.y, v.z].map((n) => +n.toFixed(4)).join(', ')})`;

// ------------------------------------------------------------------------------ fixtures --
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A 100 × 50 plate with a hole, an engraved patch, a scored ring and a jigsaw seam. */
const FLAT = {
  plate: [[rect(0, 0, 100, 50), rect(10, 10, 20, 20).reverse()]],
  objects: [
    { id: 'plate', op: 'cut', shapes: [] },
    { id: 'logo', op: 'engrave', shapes: [[rect(40, 10, 60, 30)]] },
    { id: 'ring', op: 'score', shapes: [[rect(70, 10, 90, 40)]] },
    { id: 'seam', op: 'cut', shapes: [], paths: [[[0, 25], [30, 25]]] },
  ],
};
/** Two pieces posed by angles, one of them kraft card. */
const POSED = {
  plate: [],
  objects: [],
  pieces: [
    { plate: [[rect(-40, -25, 40, 25)]], objects: [{ id: 'mark', op: 'score', shapes: [[rect(-10, -10, 10, 10)]] }], pose: { x: 0, y: 0, z: 1.5 } },
    { plate: [[rect(-40, -30, 40, 30)]], objects: [], pose: { x: 0, y: 25, z: 30, rx: 90 }, thickness: 0.6, hex: '#b08a5a' },
  ],
};

const lights = (scene) => scene.children.filter((o) => o.isLight);
const meshesOf = (o) => {
  const out = [];
  o.traverse((x) => x.isMesh && out.push(x));
  return out;
};

// ------------------------------------------------------------------- 1. the default look --
function defaultLook() {
  log.length = 0;
  const h = host();
  const view = createMaterialPreview(h);
  const r = FakeRenderer.last;
  view.render(FLAT, 3);
  const { scene, camera } = r;

  ok(JSON.stringify(log[0]) === JSON.stringify(['new', { antialias: true, alpha: false }]), `renderer made with ${JSON.stringify(log[0])}`);
  ok(log[1]?.[0] === 'setPixelRatio' && log[1][1] === 1, 'pixel ratio min(devicePixelRatio, 2)');
  ok(h.children[0] === r.domElement, 'the canvas goes into the host');
  ok(r.domElement.getAttribute('aria-label') === '3D material preview. Drag to orbit and scroll to zoom.', 'the canvas names itself');
  ok(h.dataset.grid === '10mm', 'the host says its grid is 10 mm');
  ok(scene.background.getHexString() === 'f3f4f5', `stage ${scene.background.getHexString()}`);
  ok(camera.fov === 35 && camera.near === 0.1 && camera.far === 5000, `camera ${camera.fov}° ${camera.near}–${camera.far}`);
  ok(nearV(camera.up, [0, 0, 1]), 'Z up');
  ok(camera.aspect === W / H, `aspect ${camera.aspect}`);
  // Scene order: the sky, the lamp, the grid, the product.
  ok(scene.children.map((o) => o.type).join(',') === 'HemisphereLight,DirectionalLight,GridHelper,Group', `scene ${scene.children.map((o) => o.type).join(',')}`);
  const [sky, lamp] = lights(scene);
  ok(sky.color.getHex() === 0xffffff && sky.groundColor.getHex() === 0x796552 && sky.intensity === 2.2, 'sky 0xffffff over 0x796552 at 2.2');
  ok(lamp.color.getHex() === 0xffffff && lamp.intensity === 3 && nearV(lamp.position, [-60, -80, 160]), `lamp ${lamp.intensity} at ${fmt(lamp.position)}`);
  const grid = scene.children[2];
  grid.geometry.computeBoundingBox();
  const gb = grid.geometry.boundingBox;
  ok(near(gb.max.x - gb.min.x, 600) && grid.geometry.attributes.position.count === 61 * 4, `grid ${gb.max.x - gb.min.x} mm, ${grid.geometry.attributes.position.count / 4 - 1} cells`);
  ok(near(grid.rotation.x, Math.PI / 2) && grid.position.z === -0.05, 'grid flat on the table, a hair under it');
  const tones = new Set();
  const col = grid.geometry.attributes.color;
  for (let i = 0; i < col.count; i++) tones.add(new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)).getHexString());
  ok([...tones].sort().join() === 'c0c7ce,dce1e5', `grid lines ${[...tones].sort().join(' and ')}`);

  // The product: the plate in wood with its edge, the burn, the score as a closed line, the seam
  // as an open one.
  const piece = scene.children[3].children[0];
  const [body, skin] = meshesOf(piece);
  ok(body.geometry.type === 'ExtrudeGeometry' && body.geometry.parameters.options.depth === 3 && body.geometry.parameters.options.curveSegments === 8 && body.geometry.parameters.options.bevelEnabled === false, 'the plate extruded 3 mm, no bevel');
  ok(body.material[0].color.getHexString() === 'c6a676' && body.material[0].roughness === 0.86, 'face: wood #c6a676, rough 0.86');
  ok(body.material[1].color.getHexString() === '70502f' && body.material[1].roughness === 0.94, 'edge: #70502f, rough 0.94');
  ok(body.position.z === 0, 'the flat sheet sits on the table');
  ok(skin.material.color.getHexString() === '50321c' && skin.material.side === THREE.DoubleSide && skin.material.polygonOffsetFactor === -2 && near(skin.position.z, 3.015), `engrave a burnt skin at z ${skin.position.z}`);
  const lines = piece.children.filter((o) => o.type === 'Line');
  ok(lines.length === 2, `${lines.length} lines (score ring + seam)`);
  const ring = lines[0].geometry.attributes.position;
  ok(ring.count === 5 && near(ring.getZ(0), 3.02, 1e-6) && ring.getX(0) === ring.getX(4), 'the score ring is closed, on the face');
  ok(lines[1].geometry.attributes.position.count === 2, 'the seam stays open');
  ok(lines.every((l) => l.material.color.getHexString() === '50321c'), 'lines burn the same brown');

  // Framed: the longest side × 1.8, from front right a little above, on everything drawn (the
  // score lines 0.02 above the face count: the bounds run up to z 3.02).
  const c = [50, 25, 1.51];
  const d = 100 * 1.8;
  // (Within float32: the bounds are read off the vertex buffers.)
  ok(nearV(camera.position, [c[0] + d * 0.3, c[1] - d * 0.9, c[2] + d * 0.6], 1e-6), `camera at ${fmt(camera.position)}`);

  // Re-rendering keeps the camera; after reset() the next render frames again.
  const at = camera.position.clone();
  view.render(POSED, 3);
  ok(camera.position.equals(at), 'a second render keeps the camera');
  const [plate, card] = scene.children[3].children;
  ok(plate.position.z === 1.5 && card.rotation.order === 'ZYX' && near(card.rotation.x, Math.PI / 2), 'pieces posed by angles, X first');
  ok(meshesOf(card)[0].geometry.parameters.options.depth === 0.6 && meshesOf(card)[0].material[0].color.getHexString() === 'b08a5a', 'a piece of its own thickness and colour');
  ok(near(meshesOf(plate)[0].position.z, -1.5), 'a posed piece is centred on its thickness');
  view.reset();
  view.render(POSED, 3);
  ok(!camera.position.equals(at), 'reset() frames the next render');

  view.dispose();
  ok(r.domElement.removed && log.at(-1)[0] === 'dispose', 'dispose removes the canvas and frees the renderer');

  // A screen of three device pixels to the CSS pixel still renders at two.
  globalThis.devicePixelRatio = 3;
  log.length = 0;
  createMaterialPreview(host()).dispose();
  ok(log[1]?.[0] === 'setPixelRatio' && log[1][1] === 2, `pixel ratio capped at 2 (${log[1]?.[1]})`);
  globalThis.devicePixelRatio = 1;
  return { scene, camera };
}

// --------------------------------------------------- the whole default scene, as one digest --
function digest() {
  log.length = 0;
  const view = createMaterialPreview(host());
  const r = FakeRenderer.last;
  const states = [];
  const snap = () => {
    const { scene, camera } = r;
    scene.updateMatrixWorld(true);
    const nodes = [];
    scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      nodes.push({
        type: o.type,
        matrix: Array.from(o.matrixWorld.elements),
        visible: o.visible,
        light: o.isLight ? [o.color.getHex(), o.intensity, o.groundColor?.getHex() ?? null] : null,
        geometry: o.geometry
          ? {
              type: o.geometry.type,
              position: createHash('sha256').update(new Uint8Array(o.geometry.attributes.position.array.buffer)).digest('hex'),
              index: o.geometry.index ? createHash('sha256').update(new Uint8Array(o.geometry.index.array.buffer)).digest('hex') : null,
              groups: o.geometry.groups,
            }
          : null,
        materials: mats.map((m) => ({ type: m.type, color: m.color?.getHex(), roughness: m.roughness, side: m.side, polygonOffset: m.polygonOffset, factor: m.polygonOffsetFactor, units: m.polygonOffsetUnits, emissive: m.emissive?.getHex(), emissiveIntensity: m.emissiveIntensity, transparent: m.transparent, vertexColors: m.vertexColors })),
      });
    });
    states.push({
      background: scene.background.getHex(),
      camera: { fov: camera.fov, near: camera.near, far: camera.far, aspect: camera.aspect, matrix: Array.from(camera.matrixWorld.elements), projection: Array.from(camera.projectionMatrix.elements) },
      nodes,
    });
  };
  view.render(FLAT, 3);
  snap();
  view.render(POSED, 3);
  snap();
  view.reset();
  view.render(POSED, 4, '#d6b98a');
  snap();
  view.dispose();
  return {
    scene: createHash('sha256').update(JSON.stringify(states)).digest('hex'),
    calls: createHash('sha256').update(JSON.stringify(log)).digest('hex'),
    renders: log.filter((x) => x[0] === 'render').length,
  };
}

if (FINGERPRINT) {
  console.log(JSON.stringify(digest()));
  process.exit(0);
}

defaultLook();
if (OTHER) {
  console.log(`\n${pass} passed, ${fail} failed (the default look, on ${MODULE})`);
  process.exit(fail ? 1 : 0);
}

// ------------------------------------------------------------------------ 2. the options --
{
  // A product framed on its given bounds, with its own camera, lamps, a bigger grid and a shadow.
  log.length = 0;
  const zooms = [];
  let frames = 0;
  const h = host();
  const view = createMaterialPreview(h, {
    camera: { fov: 32, near: 1, far: 8000, minDistance: 20, maxDistance: 3000, view: [-0.55, -0.95, 0.7], distance: 2.6, minSize: 30 },
    light: { key: { intensity: 2.6, position: [-120, -160, 260] }, fill: { intensity: 0.8, position: [200, 120, 120] } },
    grid: { size: 1200 },
    contactShadow: true,
    onZoom: (z) => zooms.push(z),
    onFrame: () => frames++,
  });
  const r = FakeRenderer.last;
  const t = 3;
  const B = { min: [0, 0, 0], max: [120, 80, 60] };
  // Three upright panels placed by their axes, each with its origin at a bottom corner: A runs
  // along X (u = X, v = Z, its show face toward −Y), B along Y (u = Y, v = Z, show face toward +X),
  // and C, which cannot be picked, stands between them.
  const panelA = { plate: [[rect(0, 0, 120, 60)]], objects: [], frame: { origin: [0, t / 2, 0], u: [1, 0, 0], v: [0, 0, 1] }, slits: [[[10, 0], [10, 8]]], pick: 'a' };
  const panelB = { plate: [[rect(0, 0, 80, 60)]], objects: [], frame: { origin: [120 - t / 2, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }, pick: 'b' };
  const panelC = { plate: [[rect(0, 0, 80, 40)]], objects: [], frame: { origin: [60, 0, 0], u: [0, 1, 0], v: [0, 0, 1] } };
  view.render({ plate: [], objects: [], pieces: [panelA, panelB, panelC], bounds: B }, t, '#c9a978');
  const { scene, camera } = r;

  ok(camera.fov === 32 && camera.near === 1 && camera.far === 8000, 'camera: its own lens');
  const [, key, fill] = lights(scene);
  ok(key.intensity === 2.6 && nearV(key.position, [-120, -160, 260]), 'the key lamp moved');
  ok(fill?.intensity === 0.8 && nearV(fill.position, [200, 120, 120]), 'a fill lamp from the other side');
  ok(scene.children.map((o) => o.type).join(',') === 'HemisphereLight,DirectionalLight,DirectionalLight,GridHelper,Mesh,Group', `scene ${scene.children.map((o) => o.type).join(',')}`);
  const grid = scene.children[3];
  grid.geometry.computeBoundingBox();
  ok(near(grid.geometry.boundingBox.max.x * 2, 1200) && grid.geometry.attributes.position.count === 121 * 4, 'grid 1200 mm, still 10 mm cells');
  const shadow = scene.children[4];
  ok(shadow.visible && near(shadow.scale.x, 120 * 1.9) && near(shadow.scale.y, 80 * 1.9) && nearV(shadow.position, [60, 40, 0.02]), `shadow ${fmt(shadow.scale)} at ${fmt(shadow.position)}`);
  ok(shadow.material.transparent && shadow.material.depthWrite === false && !!shadow.material.map, 'the shadow is a soft fade that hides nothing');

  // Framed on the bounds, not on the pieces.
  const c = [60, 40, 30];
  const d = 120 * 2.6;
  ok(nearV(camera.position, [c[0] - d * 0.55, c[1] - d * 0.95, c[2] + d * 0.7]), `framed at ${fmt(camera.position)}`);
  ok(zooms.length >= 1 && near(zooms.at(-1), 1), `framing says zoom 1 (${zooms.at(-1)})`);
  ok(frames > 0 && frames === log.filter((x) => x[0] === 'render').length, `onFrame after every frame (${frames})`);

  // A frame puts local (x, y) at origin + x·u + y·v, the show face along u × v (or n).
  const [gA, gB] = scene.children[5].children;
  const local = (g, x, y, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
  ok(nearV(local(gA, 120, 60), [120, t / 2, 60]), `A's far corner at ${fmt(local(gA, 120, 60))}`);
  ok(nearV(local(gA, 0, 0, t / 2), [0, 0, 0]), 'A: its show face looks along u × v (−Y)');
  ok(nearV(local(gB, 80, 0, t / 2), [120, 80, 0]), 'B: n given, its show face looks along +X');
  const slit = meshesOf(gA).find((m) => m.material.type === 'MeshBasicMaterial');
  slit.geometry.computeBoundingBox();
  const sb = slit.geometry.boundingBox;
  ok(slit.material.color.getHexString() === '24160a', 'a slit is a charred gap');
  ok(near(sb.min.y, -0.02, 1e-6) && near(sb.max.y, 8.02, 1e-6) && near(sb.max.x - sb.min.x, 0.3, 1e-6) && near(sb.min.z, -t / 2 - 0.03, 1e-6) && near(sb.max.z, t / 2 + 0.03, 1e-6), `slit bounds ${fmt(sb.min)}–${fmt(sb.max)}`);

  // A given `n` is used as it is (here the other way round from u × v).
  view.setPoses([{ frame: panelA.frame }, { frame: { ...panelB.frame, n: [-1, 0, 0] } }]);
  ok(nearV(local(gB, 80, 0, t / 2), [120 - t, 80, 0]), `n is taken as given: ${fmt(local(gB, 80, 0, t / 2))}`);
  view.setPoses([{ frame: panelA.frame }, { frame: panelB.frame }]);

  // Moving the pieces keeps them: no rebuild, just a new place.
  const before = scene.children[5].children.slice();
  view.setPoses([{ frame: { origin: [0, t / 2 - 40, 0], u: [1, 0, 0], v: [0, 0, 1] } }, { pose: { x: 200, y: 0, z: 0 } }]);
  ok(scene.children[5].children.every((g, i) => g === before[i]), 'setPoses moves the same pieces');
  ok(nearV(local(gA, 0, 0), [0, t / 2 - 40, 0]), 'A moved 40 along −Y');
  ok(gB.matrixAutoUpdate && nearV(gB.position, [200, 0, 0]), 'a frame piece can be posed by angles too');
  view.setPoses([{ frame: panelA.frame }, { frame: panelB.frame }]);

  // Zoom: relative to the framed view, within the camera's limits.
  view.zoomBy(2);
  ok(near(zooms.at(-1), 2, 1e-9), `zoomBy(2) → zoom ${zooms.at(-1)}`);
  view.zoomBy(1e9);
  ok(near(camera.position.distanceTo(new THREE.Vector3(...c)), 20, 1e-6), 'zoom stops at minDistance');
  view.zoomBy(1e-9);
  ok(near(camera.position.distanceTo(new THREE.Vector3(...c)), 3000, 1e-6), 'and at maxDistance');
  view.reset();
  view.render({ plate: [], objects: [], pieces: [panelA, panelB, panelC], bounds: B }, t);

  // Project: the target is the middle of the canvas; a point behind the camera is not visible.
  const mid = view.project(c);
  ok(near(mid.x, W / 2, 1e-6) && near(mid.y, H / 2, 1e-6) && mid.visible, `the target projects to ${mid.x.toFixed(2)}, ${mid.y.toFixed(2)}`);
  const behind = camera.position.clone().multiplyScalar(2).sub(new THREE.Vector3(...c));
  ok(!view.project([behind.x, behind.y, behind.z]).visible, 'behind the camera: not visible');
  const top = view.project([60, 40, 60]);
  ok(top.y < H / 2, 'up is up on the canvas');

  // Picking, seen from the front: a low panel that cannot be picked stands before a tall one
  // that can. Nothing is picked until picking is on; then hover lights the piece, a click with
  // the main button picks it, a drag or another button does not, and the low panel hides what is
  // behind it.
  const picks = [];
  const low = { plate: [[rect(0, 0, 120, 30)]], objects: [], frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] } };
  const tall = { plate: [[rect(0, 0, 120, 60)]], objects: [], frame: { origin: [0, 80, 0], u: [1, 0, 0], v: [0, 0, 1] }, pick: 'tall' };
  const view2 = createMaterialPreview(host(), { onPick: (p) => picks.push(p), camera: { view: [0, -1, 0.0001] } });
  const scene2 = { plate: [], objects: [], pieces: [low, tall], bounds: B };
  view2.render(scene2, t);
  const canvas = FakeRenderer.last.domElement;
  const tallFace = () => meshesOf(FakeRenderer.last.scene.children[3].children[1])[0].material[0];
  const onTall = view2.project([60, 80, 45]);
  const onLow = view2.project([60, 0, 15]);
  const click = (p, dx = 0, button = 0) => {
    canvas.fire('pointerdown', { clientX: p.x, clientY: p.y, button });
    canvas.fire('pointerup', { clientX: p.x + dx, clientY: p.y, button });
  };
  click(onTall);
  ok(picks.length === 0, 'no picks while picking is off');
  view2.setPicking(true);
  canvas.fire('pointermove', { clientX: onTall.x, clientY: onTall.y });
  ok(tallFace().emissive.getHexString() === '2563eb' && near(tallFace().emissiveIntensity, 0.22) && canvas.style.cursor === 'pointer', 'the piece under the pointer lights up');
  click(onTall);
  ok(picks.join() === 'tall', `a click picks it (${picks.join()})`);
  click(onTall, 12);
  ok(picks.length === 1, 'a drag is an orbit, not a pick');
  click(onTall, 0, 2);
  ok(picks.length === 1, 'another button pans: no pick');
  canvas.fire('pointerdown', { clientX: onTall.x, clientY: onTall.y, button: 0 });
  canvas.fire('pointercancel', { clientX: onTall.x, clientY: onTall.y, button: 0 });
  canvas.fire('pointerup', { clientX: onTall.x, clientY: onTall.y, button: 0 });
  ok(picks.length === 1, 'a cancelled pointer picks nothing');
  click(onLow);
  ok(picks.length === 1, `a piece without a pick hides the one behind it (${picks.join()})`);
  canvas.fire('pointermove', { clientX: onLow.x, clientY: onLow.y });
  ok(tallFace().emissive.getHex() === 0 && canvas.style.cursor === '', 'nothing lights up over a piece that cannot be picked');
  canvas.fire('pointermove', { clientX: onTall.x, clientY: onTall.y });
  canvas.fire('pointerleave');
  ok(tallFace().emissive.getHex() === 0 && canvas.style.cursor === '', 'leaving the canvas puts the light out');
  canvas.fire('pointermove', { clientX: onTall.x, clientY: onTall.y });
  view2.render(scene2, t);
  ok(canvas.style.cursor === '' && tallFace().emissive.getHex() === 0, 'a rebuild under the pointer leaves no stale pointer cursor');
  canvas.fire('pointermove', { clientX: onTall.x, clientY: onTall.y });
  view2.setPicking(false);
  ok(tallFace().emissive.getHex() === 0 && tallFace().emissiveIntensity === 0 && canvas.style.cursor === '', 'picking off clears the hover');
  click(onTall);
  ok(picks.length === 1, 'and clicks pick nothing again');
  view2.dispose();

  // A camera field given as undefined keeps its default.
  const view5 = createMaterialPreview(host(), { camera: { fov: undefined, near: undefined, far: undefined, minDistance: undefined, maxDistance: undefined, view: undefined, distance: undefined, minSize: undefined } });
  view5.render(FLAT, 3);
  const cam5 = FakeRenderer.last.camera;
  ok(cam5.fov === 35 && cam5.near === 0.1 && cam5.far === 5000 && nearV(cam5.position, [50 + 54, 25 - 162, 1.51 + 108], 1e-6), `undefined fields keep the defaults (fov ${cam5.fov}, at ${fmt(cam5.position)})`);
  view5.zoomBy(1e9);
  ok(near(cam5.position.distanceTo(new THREE.Vector3(50, 25, 1.51)), 5, 1e-6), 'and the default orbit limit');
  view5.dispose();

  // The default orbit limits are Studio's: 5 to 1000 mm from what it looks at.
  const view4 = createMaterialPreview(host());
  const cam4 = () => FakeRenderer.last.camera;
  view4.render(FLAT, 3);
  const c4 = new THREE.Vector3(50, 25, 1.51);
  view4.zoomBy(1e9);
  ok(near(cam4().position.distanceTo(c4), 5, 1e-6), `closest ${cam4().position.distanceTo(c4)}`);
  view4.zoomBy(1e-9);
  ok(near(cam4().position.distanceTo(c4), 1000, 1e-6), `farthest ${cam4().position.distanceTo(c4)}`);
  view4.dispose();

  // Without onPick the canvas carries only the orbit controls' own listeners.
  const view3 = createMaterialPreview(host());
  const types = [...FakeRenderer.last.domElement.listeners.keys()].sort().join(',');
  ok(types === 'contextmenu,pointercancel,pointerdown,wheel', `default canvas listeners: ${types}`);
  view3.dispose();

  view.dispose();
  ok(r.domElement.removed, 'disposed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
