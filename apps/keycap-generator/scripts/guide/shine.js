// The "How to print shine-through" pictures, drawn from the app's own modules: the cap, carved
// as the app carves it in shine-through, and its stem. Three pictures, each a PNG data URL in
// `window.__shots` when `window.__done` is set; scripts/guide/render.mjs saves them.
import * as THREE from 'three';
import { loadKeycap } from '/src/keycap.js';
import { initManifold, geomToManifold, manifoldToGeom } from '/src/manifold.js';
import { buildBodies } from '/src/geometry.js';
import { parseLetter } from '/src/letter.js';

const W = 640, H = 440;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.localClippingEnabled = true;
document.body.append(renderer.domElement);

await initManifold();
const kc = await loadKeycap('/keycaps/standard-profile/1u.json');
const m = geomToManifold(kc.stemGeometry);
const stem = manifoldToGeom(m);
m.delete();
const legend = parseLetter('A', 'helvetiker-bold');
const bodies = await buildBodies(kc.shellGeometry, kc.meta, legend, {
  widthMM: 8.5, depth: 0.5, centerX: kc.meta.center[0], centerY: kc.meta.center[1],
  rotationDeg: 0, mirror: false, through: true, singleColor: false, homingBump: false,
});

const centre = new THREE.Vector3(-kc.meta.center[0], -kc.meta.center[1], 0);
/** The cap's parts in a Z-up group stood up for three's Y-up camera, centred on the origin. */
function capGroup(materials, lift = { legend: 0, stem: 0 }) {
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  const add = (geom, mat, dz) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(centre).add(new THREE.Vector3(0, 0, dz));
    g.add(mesh);
  };
  add(bodies.keycapGeometry, materials.cap, 0);
  add(bodies.logoGeometry, materials.legend, lift.legend);
  add(stem, materials.stem, lift.stem);
  return g;
}

function scene(lights) {
  const s = new THREE.Scene();
  for (const l of lights) s.add(l);
  return s;
}
const studio = () => {
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(12, 30, 22);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
  fill.position.set(-18, 10, -14);
  return [new THREE.HemisphereLight(0xffffff, 0x404654, 1.0), key, fill];
};
const camera = (pos, target) => {
  const c = new THREE.PerspectiveCamera(32, W / H, 0.1, 500);
  c.position.set(...pos);
  c.lookAt(...target);
  return c;
};
const shot = (s, c) => {
  renderer.setClearColor(0x000000, 0);
  renderer.render(s, c);
  return renderer.domElement.toDataURL('image/png');
};

const capDark = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, side: THREE.DoubleSide });
const clear = new THREE.MeshPhysicalMaterial({
  color: 0xf2f6ff, roughness: 0.25, transmission: 0.6, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
});
const shots = {};

// 1 · What prints in clear: the cap as tinted glass, so the legend and the stem inside it, the
// two parts that print in clear filament, stand out.
{
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.4, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const solidClear = new THREE.MeshStandardMaterial({ color: 0xe9f0ff, roughness: 0.35 });
  const s = scene(studio());
  s.add(capGroup({ cap: glass, legend: solidClear, stem: solidClear }));
  shots.cutaway = shot(s, camera([14, 30, 30], [0, 5, 0]));
}

// 2 · The parts as the slicer gets them, pulled apart: Keycap; Legend and Stem in clear.
{
  const s = scene(studio());
  s.add(capGroup({ cap: capDark, legend: clear, stem: clear }, { legend: 8, stem: -9 }));
  shots.parts = shot(s, camera([26, 50, 54], [0, 4, 0]));
}

// 3 · Lit from below: light from the switch comes up the stem and out through the legend.
{
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.4 });
  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.6);
  rim.position.set(-20, 18, -10);
  const s = scene([new THREE.HemisphereLight(0x8090b0, 0x101018, 0.6), rim]);
  const under = new THREE.PointLight(0xffd9a0, 60, 40);
  under.position.set(0, -2, 0);
  s.add(under);
  s.add(capGroup({ cap: new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.7 }), legend: glow, stem: glow }));
  renderer.setClearColor(0x05070b, 1);
  renderer.render(s, camera([16, 34, 38], [0, 5, 0]));
  shots.lit = renderer.domElement.toDataURL('image/png');
}

window.__shots = shots;
window.__done = true;
