// The preview floor: a real Bambu build plate (or the plain reference grid).
//
// three.js is passed in rather than imported so the package can never pull in a
// second copy of three alongside the app's — the mesh data and the picker stay
// three-free, and only this module touches the scene.
import { getPlate, type PlateChoice } from './registry';

type Three = typeof import('three');
type Group = import('three').Group;

export interface BuildPlateOptions {
  /** Extent of the plain grid, mm. */
  gridSize?: number;
  /** Grid pitch, mm — also the pitch of the lines drawn over a plate. */
  gridStep?: number;
  /** `dark` (default) or `light`. */
  theme?: string;
  /** Height of the plate's top surface along the up axis. Sit it a hair below
   *  the model's bottom face (0) so coplanar faces don't z-fight. */
  topZ?: number;
  /** Which way is up in the host scene. `z` (default) is the CAD convention the
   *  generators use; `y` is three.js's default, which the keycap viewer keeps. */
  up?: 'y' | 'z';
}

export interface BuildPlate {
  /** Add this to the scene. */
  readonly object: Group;
  setChoice(choice: PlateChoice): void;
  getChoice(): PlateChoice;
  setTheme(theme: string): void;
  setTopZ(z: number): void;
  setVisible(on: boolean): void;
  /** Fade the plate to a ghost — for when the camera drops below it and the
   *  solid plate would otherwise sit between you and the model. */
  setGhosted(on: boolean): void;
  /** Largest half-extent of what's currently drawn, mm — handy for framing. */
  radius(): number;
  dispose(): void;
}

const THEMES = {
  dark: { plate: 0x24262b, minor: 0x474c55, major: 0x646b78, gridLine: 0x2d3139, gridAccent: 0x5b9dff },
  light: { plate: 0x3a3d44, minor: 0x5a606b, major: 0x7b828f, gridLine: 0xd1d5db, gridAccent: 0x2563eb },
} as const;

function palette(theme: string) {
  return theme === 'light' ? THEMES.light : THEMES.dark;
}

/** Speckled PEI look: fine monochrome noise, reused by every plate. */
let speckle: import('three').Texture | null = null;
function speckleTexture(THREE: Three): import('three').Texture | null {
  if (speckle) return speckle;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // Mostly mid-grey with a scatter of brighter grains — multiplied over the
    // plate colour it reads as texture rather than as a change of colour.
    const grain = 168 + Math.random() * 70 + (Math.random() < 0.06 ? 55 : 0);
    const v = Math.min(255, grain);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  speckle = tex;
  return tex;
}

export function createBuildPlate(THREE: Three, opts: BuildPlateOptions = {}): BuildPlate {
  const gridSize = opts.gridSize ?? 300;
  const step = opts.gridStep ?? 10;
  let theme = opts.theme ?? 'dark';
  let choice: PlateChoice = 'grid';
  let topZ = opts.topZ ?? -0.05;
  const up = opts.up ?? 'z';
  let extent = gridSize / 2;
  let ghosted = false;
  /** Every material we've made, with the settings it has when not ghosted. */
  const skins: { mat: any; opacity: number; depthWrite: boolean }[] = [];

  const object = new THREE.Group();
  object.renderOrder = -1;

  /** Track a material so ghosting can dim it, and return it unchanged. */
  function skin<T extends { transparent: boolean; opacity: number; depthWrite: boolean }>(mat: T): T {
    skins.push({ mat, opacity: mat.opacity, depthWrite: mat.depthWrite });
    return mat;
  }

  /** Ghosting has to survive a rebuild, so it's applied from the skin list. */
  function applyGhost() {
    for (const s of skins) {
      s.mat.transparent = ghosted || s.opacity < 1;
      s.mat.opacity = ghosted ? s.opacity * 0.16 : s.opacity;
      // A see-through plate must not occlude the model behind it.
      s.mat.depthWrite = ghosted ? false : s.depthWrite;
    }
  }

  function disposeChildren() {
    skins.length = 0;
    for (const child of [...object.children]) {
      object.remove(child);
      child.traverse((n: any) => {
        n.geometry?.dispose?.();
        const m = n.material;
        if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
        else m?.dispose?.();
      });
    }
  }

  /** Line grid over an area, minor lines with every 5th brightened. */
  function makeGrid(halfW: number, halfD: number, c: { minor: number; major: number }, z: number) {
    const minor: number[] = [];
    const major: number[] = [];
    const lines = (from: number, to: number, at: (t: number) => [number, number, number, number]) => {
      for (let t = Math.ceil(from / step) * step; t <= to + 1e-6; t += step) {
        const [x1, y1, x2, y2] = at(t);
        const target = Math.abs(t) % (step * 5) < 1e-6 ? major : minor;
        target.push(x1, y1, z, x2, y2, z);
      }
    };
    lines(-halfW, halfW, (x) => [x, -halfD, x, halfD]);
    lines(-halfD, halfD, (y) => [-halfW, y, halfW, y]);

    const group = new THREE.Group();
    for (const [pts, color, opacity] of [
      [minor, c.minor, 0.5],
      [major, c.major, 0.85],
    ] as const) {
      if (pts.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const seg = new THREE.LineSegments(
        geo,
        skin(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })),
      );
      group.add(seg);
    }
    return group;
  }

  function build() {
    disposeChildren();
    const c = palette(theme);

    if (choice === 'grid') {
      const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / step), c.gridAccent, c.gridLine);
      grid.rotation.x = Math.PI / 2;
      const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
      mats.forEach((m) => {
        m.depthWrite = false;
        skin(m);
      });
      object.add(grid);
      extent = gridSize / 2;
      applyGhost();
      return;
    }

    const plate = getPlate(choice);
    if (!plate) return;
    const { mesh } = plate;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(mesh.indices);
    // Flat shading off the triangles themselves: a slab's 90 degree edges must
    // stay crisp, and smoothing across them muddies the whole plate.
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();

    const tex = speckleTexture(THREE);
    if (tex) {
      tex.repeat.set(mesh.width / 24, mesh.depth / 24);
      // The plate is centred on the origin, so the UVs generated from position
      // below start centred too — nudge them so the tiling isn't symmetric.
      tex.offset.set(0.13, 0.29);
    }
    // Planar UVs from X/Y so the speckle tiles evenly across the top face.
    const pos = flat.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + mesh.width / 2) / mesh.width;
      uv[i * 2 + 1] = (pos.getY(i) + mesh.depth / 2) / mesh.depth;
    }
    flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    const mat = skin(
      new THREE.MeshStandardMaterial({
        color: c.plate,
        roughness: 0.88,
        metalness: 0.15,
        side: THREE.DoubleSide,
        ...(tex ? { map: tex, roughnessMap: tex } : {}),
      }),
    );
    object.add(new THREE.Mesh(flat, mat));

    // Bed grid, inset so it never spills past the rounded corners.
    const inset = 2;
    object.add(makeGrid(mesh.width / 2 - inset, mesh.depth / 2 - inset, c, 0.02));
    extent = Math.max(mesh.width, mesh.depth) / 2;
    applyGhost();
  }

  /** Everything inside the group is built Z-up; a Y-up host just tips the group
   *  a quarter turn, which maps the plate's local +Z onto world +Y. */
  function apply() {
    if (up === 'y') {
      object.rotation.x = -Math.PI / 2;
      object.position.set(0, topZ, 0);
    } else {
      object.position.set(0, 0, topZ);
    }
  }

  build();
  apply();

  return {
    object,
    setChoice(next) {
      if (next === choice) return;
      choice = next;
      build();
    },
    getChoice: () => choice,
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      build();
    },
    setTopZ(z) {
      topZ = z;
      apply();
    },
    setVisible(on) {
      object.visible = on;
    },
    setGhosted(on) {
      if (on === ghosted) return;
      ghosted = on;
      applyGhost();
    },
    radius: () => extent,
    dispose() {
      disposeChildren();
      object.removeFromParent();
    },
  };
}
