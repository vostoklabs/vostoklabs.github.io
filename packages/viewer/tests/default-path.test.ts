/*
  The viewer with none of its options, as the apps that use it call it, pinned.

    pnpm --filter @vostok/viewer test

  One scripted session of what the generators on the viewer call, with the options they pass
  (none, `frameMul` and `framePad`): parts that grow, shrink, empty out and are anchored; the
  views; colour, offset and pose; the plate and the theme; hover, taps and picks; a fold rig;
  covers, pictures and thumbnails; a pause and a resume; dispose. It runs against the stand-in
  page and WebGL context (tests/support/page.ts), and after each step writes down what the viewer
  did, each line compared with a recorded one:

    camera   where the camera and its target are, and whether the user may orbit;
    scene    what the scene holds (background, lights, plate, parts with their place, colour and
             glow, the rig, the cursor), as a hash: the text is printed when it differs;
    frames   every frame drawn in the step: where the camera stood, the canvas size, the draw
             calls; then the animation frames still waiting;
    gl       every WebGL call the step made: how many, and a hash of them;
    held     what is still on the GPU: geometries, textures, programs and their users, buffers,
             vertex arrays.

  Numbers are compared to four decimals, and the floats inside WebGL calls not at all: their last
  bits need not be the same on every machine. A deliberate change fails here and prints the new
  table: paste it over GOLDEN in the same commit, and say in the commit message what changed.

  After the table, what it cannot see: dispose letting go of the hooks and the outline's material.
*/
import * as THREE from 'three';
import { installPage } from './support/page';
import { PARTS, RED, RED_AT, tetra, WHITE_AT } from './support/parts';

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

/* ------------------------------------------------------------------ reading what the viewer did */

/** Four decimals, and never -0: a number that reads the same on every machine. */
const num = (v: number): string => {
  const r = Math.round(v * 1e4) / 1e4;
  return String(r === 0 ? 0 : r);
};
const vec = (v: { x: number; y: number; z: number }) => `${num(v.x)} ${num(v.y)} ${num(v.z)}`;
const point = (p: [number, number, number] | null) => (p ? p.map(num).join(' ') : 'none');

/** FNV-1a, as hex. */
const fnv = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** A WebGL call as compared: what is in a float array, and any number with a fraction, left out. */
const glLine = (line: string) => line.replace(/(Float(?:32|64)Array\[\d+\])#[0-9a-f]+/g, '$1').replace(/-?\d+\.\d+(?:e[-+]?\d+)?/g, '~');

/** How many of one kind of WebGL object are alive: made and not yet deleted. */
const alive = (kind: string) => page.log.filter((l) => l.startsWith(`create${kind}(`)).length - page.log.filter((l) => l.startsWith(`delete${kind}(`)).length;

function sceneOf(v: Viewer): string {
  const bg = v.scene.background;
  const out = [`background ${bg instanceof THREE.Color ? bg.getHexString() : String(bg)}`];
  const parts = v.partMeshes();
  for (const o of v.scene.children) {
    const hidden = o.visible ? '' : ' (hidden)';
    if (o === v.root) {
      out.push(`model at ${vec(o.position)}${hidden}`);
      for (const m of parts) {
        const mat = m.material as THREE.MeshStandardMaterial;
        out.push(`  part ${m.userData.partIndex} in ${m.parent === v.root ? 'the model' : m.parent?.name} at ${vec(m.position)} turned ${vec(m.rotation)}${m.visible ? '' : ' (hidden)'}`
          + ` #${mat.color.getHexString()} side ${mat.side} glow ${num(mat.emissiveIntensity)}${mat.emissiveIntensity ? ` #${mat.emissive.getHexString()}` : ''}`
          + ` ${m.geometry.getAttribute('position').count} vertices`);
      }
      const other = v.root.children.filter((c) => !parts.includes(c as THREE.Mesh));
      if (other.length) out.push(`  and ${other.map((c) => `${c.type} ${c.name}`).join(', ')}`);
    } else if ((o as THREE.Light).isLight) {
      const l = o as THREE.Light;
      out.push(`${o.type} #${l.color.getHexString()} ${num(l.intensity)} at ${vec(o.position)}${hidden}`);
    } else {
      // The plate (drawn first) and the fold rig: what is in them, and how it is drawn.
      const inside: string[] = [];
      o.traverse((c) => {
        if (c === o) return;
        const mat = (c as THREE.Mesh).material as THREE.Material & { color?: THREE.Color } | undefined;
        inside.push(`${c.type}${c.visible ? '' : ' (hidden)'}${mat ? ` #${mat.color?.getHexString() ?? '-'} ${num(mat.opacity)}${mat.transparent ? ' see-through' : ''}` : ''}`);
      });
      out.push(`${o.renderOrder === -1 ? 'plate' : o.type} at ${vec(o.position)}${hidden}: ${inside.join(', ') || 'empty'}`);
    }
  }
  out.push(`cursor ${(v.renderer.domElement.style as unknown as Record<string, string>).cursor || '-'}`);
  return out.join('\n');
}

function heldOf(v: Viewer): string {
  const { memory } = v.renderer.info;
  const programs = (v.renderer.info.programs ?? []) as unknown as { usedTimes: number }[];
  const users = programs.reduce((n, p) => n + p.usedTimes, 0);
  return `${memory.geometries} geometries, ${memory.textures} textures, ${programs.length} programs (${users} users), `
    + `${alive('Buffer')} buffers, ${alive('VertexArray')} vertex arrays, ${alive('Texture')} GL textures`;
}

/* ------------------------------------------------------------------ the session */

interface Record_ {
  camera: string;
  scene: string;
  frames: string;
  gl: string;
  held: string;
  [extra: string]: string;
}
const actual: Record<string, Record_> = {};
const scenes: Record<string, string> = {};
let frames: string[] = [];
let mark = 0;
let pictureMark = 0;

/** The pictures taken since the last asked, as the canvas reported them. */
function pictures(): string {
  const shots = page.log.slice(pictureMark).filter((l) => l.startsWith('toBlob') || l.startsWith('toDataURL'));
  pictureMark = page.log.length;
  return shots.join(', ') || 'none';
}

/** Note every frame a viewer draws: where the camera stood, the canvas size, the draw calls. */
function watch(v: Viewer): Viewer {
  const render = v.renderer.render.bind(v.renderer);
  v.renderer.render = (scene, camera) => {
    const before = page.log.length;
    render(scene, camera);
    const draws = page.log.slice(before).filter((l) => l.startsWith('draw')).length;
    frames.push(`${vec(camera.position)} at ${v.renderer.domElement.width}x${v.renderer.domElement.height}, ${draws} draws`);
  };
  return v;
}

async function step(name: string, v: Viewer, act: () => unknown, extra?: () => Record<string, string>) {
  frames = [];
  await act();
  const lines = page.log.slice(mark);
  mark = page.log.length;
  scenes[name] = sceneOf(v);
  actual[name] = {
    camera: `${vec(v.camera.position)} looking at ${vec(v.controls.target)}${v.controls.enabled ? '' : ', orbit off'}`,
    scene: fnv(scenes[name]),
    frames: `${frames.join(' | ') || 'none'}; ${page.pendingFrames()} waiting`,
    gl: `${lines.length} calls #${fnv(lines.map(glLine).join('\n'))}`,
    held: heldOf(v),
    ...extra?.(),
  };
}

const part = (i: number | null) => (i === null ? 'none' : String(i));

/** A click: down and up on the same spot. */
const tap = (x: number, y: number) => {
  page.pointer('pointerdown', x, y);
  page.pointer('pointerup', x, y);
};

/** A box's base and a flap on a hinge along its back edge: a fold rig, as the Fold-Up Box hands over. */
function foldRig() {
  const card = () => new THREE.MeshStandardMaterial({ color: 0xd8c3a5 });
  const rig = new THREE.Group();
  rig.add(new THREE.Mesh(new THREE.BoxGeometry(60, 40, 1), card()));
  const hinge = new THREE.Group();
  hinge.position.set(0, 20, 0.5);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 1), card());
  flap.position.set(0, 15, 0);
  hinge.add(flap);
  rig.add(hinge);
  return { rig, hinge };
}

const GROWN = [tetra(-30, -15, 0, 60, RED), ...PARTS.slice(1)];
const SHRUNK = [tetra(-4, -3, 0, 8, RED)];
const OTHER = [tetra(0, 0, 0, 50, RED), tetra(10, 10, 5, 8, [20, 200, 30])];

// No options: the generator template and Pen Topper pass none, House Number `{}`.
{
  const A = watch(createViewer(stage));
  const picked: (number | null)[] = [];
  const picks = () => ({ picks: picked.splice(0).map(part).join(', ') || 'none' });
  await step('A: made', A, () => {});
  await step('A: the first frame', A, () => page.frame());
  await step('A: parts, framed', A, () => (A.setParts(PARTS, true), page.frame()));
  await step('A: a part grows', A, () => (A.setParts(GROWN), page.frame()));
  await step('A: and shrinks', A, () => (A.setParts(SHRUNK), page.frame()));
  await step('A: no parts', A, () => (A.setParts([]), page.frame()));
  await step('A: parts again', A, () => (A.setParts(PARTS), page.frame()));
  await step('A: anchored', A, () => (A.setParts(PARTS, false, [2, 1, 0]), page.frame()));
  await step('A: anchored and framed', A, () => (A.setParts(PARTS, true, [2, 1, 0]), page.frame()));
  for (const view of ['front', 'top', 'left', 'iso'] as const) await step(`A: the ${view} view`, A, () => (A.setView(view), page.frame()));
  await step('A: a colour', A, () => (A.setPartColor(1, [0, 120, 255]), page.frame()));
  await step('A: an offset', A, () => (A.setPartOffset(2, [3, -2, 1]), page.frame()));
  await step('A: a pose', A, () => (A.setPartPose(1, [1, 2, 3], 0.4), page.frame()));
  await step('A: the plate hidden', A, () => (A.setPlateVisible(false), page.frame()));
  await step('A: shown, an A1 mini', A, () => (A.setPlateVisible(true), A.setPlate('a1mini'), page.frame()));
  await step('A: the grid', A, () => (A.setPlate('grid'), page.frame()));
  await step('A: the light theme', A, () => (page.setTheme('light'), page.frame()));
  await step('A: the dark theme', A, () => (page.setTheme('dark'), page.frame()));
  await step('A: back to the A1', A, () => (A.setPlate('a1'), page.frame()));
  await step('A: orbit off', A, () => (A.setOrbitEnabled(false), page.frame()));
  await step('A: orbit on', A, () => (A.setOrbitEnabled(true), page.frame()));

  A.onPartPick((i) => picked.push(i));
  await step('A: framed again', A, () => (A.setParts(PARTS, true), page.frame()));
  await step('A: hover', A, () => (page.pointer('pointermove', ...RED_AT), page.frame()));
  await step('A: the pointer leaves', A, () => (page.pointer('pointerleave', ...RED_AT), page.frame()));
  await step('A: a tap on a part', A, () => (tap(...WHITE_AT), page.frame()), picks);
  await step('A: a tap on nothing', A, () => (tap(5, 5), page.frame()), picks);
  await step('A: an orbit drag is not a tap', A, () => (page.pointer('pointerdown', ...RED_AT), page.pointer('pointerup', RED_AT[0] + 60, RED_AT[1]), page.frame()), picks);
  await step('A: picks', A, () => {}, () => ({
    picks: [
      part(A.pickPart(...RED_AT)), part(A.pickPart(...WHITE_AT)), point(A.pickPoint(...RED_AT)), point(A.pickOnPlane(...RED_AT, 2, 'z')),
      point(A.pickOnPlane(...RED_AT, -3, 'y')), part(A.pickPart(5, 5)), point(A.pickPoint(5, 5)),
    ].join(' | '),
  }));

  // The pictures, with one part selected and another under the pointer.
  await step('A: selected and hovered', A, () => (tap(...WHITE_AT), page.pointer('pointermove', ...RED_AT), page.frame()), picks);
  await step('A: a cover, 300 px', A, () => A.renderCoverPng(300), () => ({ pictures: pictures() }));
  await step('A: a cover, the default size', A, () => A.renderCoverPng(), () => ({ pictures: pictures() }));
  await step('A: a picture of the view', A, () => A.renderToPng(), () => ({ pictures: pictures() }));
  await step('A: a thumbnail', A, () => (A.renderThumbnail(128), page.frame()), () => ({ pictures: pictures() }));
  await step('A: a thumbnail of other parts', A, () => (A.renderThumbnail(64, OTHER), page.frame()), () => ({ pictures: pictures() }));
  await step('A: a new shape for one part', A, () => (A.setPartGeometry(0, tetra(-12, -6, 0, 24, RED)), page.frame()));

  const fold = foldRig();
  await step('A: a fold rig', A, () => (A.setParts([]), A.setFoldRig(fold.rig, true), page.frame()));
  await step('A: the fold moves', A, () => ((fold.hinge.rotation.x = -2.2), A.settleFoldRig(), page.frame()));
  await step('A: a cover of the rig', A, () => A.renderCoverPng(256), () => ({ pictures: pictures() }));
  await step('A: a thumbnail of the rig', A, () => (A.renderThumbnail(96), page.frame()), () => ({ pictures: pictures() }));
  await step('A: the rig cleared', A, () => (A.setFoldRig(null), A.setParts(PARTS), page.frame()));

  await step('A: paused', A, () => (A.setPaused(true), page.frame(2)));
  await step('A: resumed twice', A, () => (A.setPaused(false), A.setPaused(false), page.frame()));
  await step('A: resumed while running', A, () => (A.setPaused(false), page.frame()));
  await step('A: disposed', A, () => A.dispose(), () => ({
    page: `${page.stage.children.length} in the stage, ${page.window.listenerCount()} window listeners, ${page.log.filter((l) => l.includes('loseContext')).length} contexts lost`,
  }));
}

// The Fold-Up Box: framed further out, a rig and its cover.
{
  const B = watch(createViewer(stage, { frameMul: 1.9, framePad: 20 }));
  const fold = foldRig();
  await step('B: made', B, () => page.frame());
  await step('B: a fold rig on the grid', B, () => (B.setFoldRig(fold.rig, true), B.setPlate('grid'), page.frame()));
  await step('B: the fold moves', B, () => ((fold.hinge.rotation.x = -1.2), B.settleFoldRig(), page.frame()));
  await step('B: a cover', B, () => B.renderCoverPng(384), () => ({ pictures: pictures() }));
  await step('B: disposed', B, () => B.dispose());
}

// Keychain Carabiner: framed closer, the plate off, anchored parts dragged on a plane.
{
  const C = watch(createViewer(stage, { frameMul: 1.6 }));
  await step('C: made, no plate', C, () => (C.setPlateVisible(false), page.frame()));
  await step('C: parts, anchored and framed', C, () => (C.setParts(PARTS, true, [1, 0, 0]), page.frame()));
  await step('C: a drag on a plane', C, () => {
    const from = C.pickOnPlane(400, 300, 3, 'z');
    const to = C.pickOnPlane(430, 320, 3, 'z');
    C.setOrbitEnabled(false);
    if (from && to) C.setPartOffset(2, [to[0] - from[0], to[1] - from[1], 0]);
    page.frame();
    C.setOrbitEnabled(true);
  });
  await step('C: the plate for printing', C, () => (C.setPlateVisible(true), C.setParts(PARTS, true, [1, 0, 0]), page.frame()));
  await step('C: a picture of the view', C, () => C.renderToPng(), () => ({ pictures: pictures() }));
  await step('C: disposed', C, () => C.dispose());
}

/* ------------------------------------------------------------------ the golden */

const GOLDEN: Record<string, Record_> = {
  "A: made": {
    "camera": "60 -60 45 looking at 0 0 0",
    "scene": "7c06a07c",
    "frames": "none; 1 waiting",
    "gl": "716 calls #893feb1b",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 41 buffers, 17 vertex arrays, 6 GL textures"
  },
  "A: the first frame": {
    "camera": "60 -60 45 looking at 0 0 0",
    "scene": "7c06a07c",
    "frames": "60 -60 45 at 800x600, 3 draws; 1 waiting",
    "gl": "15 calls #59c412a2",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 41 buffers, 17 vertex arrays, 6 GL textures"
  },
  "A: parts, framed": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "1d441999",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "61 calls #ac19f2f0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: a part grows": {
    "camera": "96.1588 -96.1588 65.821 looking at 0 0 10",
    "scene": "e55391e7",
    "frames": "96.1588 -96.1588 65.821 at 800x600, 6 draws; 1 waiting",
    "gl": "71 calls #f8180a0f",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: and shrinks": {
    "camera": "96.1588 -96.1588 65.821 looking at 0 0 10",
    "scene": "edfd50c6",
    "frames": "96.1588 -96.1588 65.821 at 800x600, 4 draws; 1 waiting",
    "gl": "53 calls #f2ab54d3",
    "held": "16 geometries, 2 textures, 7 programs (13 users), 43 buffers, 18 vertex arrays, 6 GL textures"
  },
  "A: no parts": {
    "camera": "96.1588 -96.1588 65.821 looking at 0 0 10",
    "scene": "c6cb97e1",
    "frames": "96.1588 -96.1588 65.821 at 800x600, 3 draws; 1 waiting",
    "gl": "19 calls #a812daa1",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 41 buffers, 17 vertex arrays, 6 GL textures"
  },
  "A: parts again": {
    "camera": "96.1588 -96.1588 65.821 looking at 0 0 10",
    "scene": "ec0432dc",
    "frames": "96.1588 -96.1588 65.821 at 800x600, 6 draws; 1 waiting",
    "gl": "61 calls #a5c685fb",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: anchored": {
    "camera": "96.1588 -96.1588 65.821 looking at 0 0 10",
    "scene": "63000349",
    "frames": "96.1588 -96.1588 65.821 at 800x600, 6 draws; 1 waiting",
    "gl": "71 calls #1b125b46",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: anchored and framed": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "be6277e6",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "71 calls #3cba4e41",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the front view": {
    "camera": "-2 -55 14.72 looking at -2 4 10",
    "scene": "e5bc9334",
    "frames": "-2 -55 14.72 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the top view": {
    "camera": "-2 -0.72 69 looking at -2 4 10",
    "scene": "e5bc9334",
    "frames": "-2 -0.72 69 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the left view": {
    "camera": "-61 4 14.72 looking at -2 4 10",
    "scene": "e5bc9334",
    "frames": "-61 4 14.72 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the iso view": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "be6277e6",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: a colour": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "2c7f650f",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: an offset": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "7b61790a",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: a pose": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "f2280eac",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #bccb3ffc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the plate hidden": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "5919610e",
    "frames": "57 -55 44.25 at 800x600, 3 draws; 1 waiting",
    "gl": "10 calls #97820fbf",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: shown, an A1 mini": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "58920883",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "84 calls #6fdabca1",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the grid": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "ed2cad00",
    "frames": "57 -55 44.25 at 800x600, 4 draws; 1 waiting",
    "gl": "50 calls #ba4568a2",
    "held": "16 geometries, 2 textures, 6 programs (13 users), 44 buffers, 18 vertex arrays, 6 GL textures"
  },
  "A: the light theme": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "3de87cff",
    "frames": "57 -55 44.25 at 800x600, 4 draws; 1 waiting",
    "gl": "45 calls #fdd86297",
    "held": "16 geometries, 2 textures, 6 programs (13 users), 44 buffers, 18 vertex arrays, 6 GL textures"
  },
  "A: the dark theme": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "ed2cad00",
    "frames": "57 -55 44.25 at 800x600, 4 draws; 1 waiting",
    "gl": "45 calls #2299aef7",
    "held": "16 geometries, 2 textures, 6 programs (13 users), 44 buffers, 18 vertex arrays, 6 GL textures"
  },
  "A: back to the A1": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "f2280eac",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "78 calls #abde33ee",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: orbit off": {
    "camera": "57 -55 44.25 looking at -2 4 10, orbit off",
    "scene": "f2280eac",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #5f7ae9cc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: orbit on": {
    "camera": "57 -55 44.25 looking at -2 4 10",
    "scene": "f2280eac",
    "frames": "57 -55 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #5f7ae9cc",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: framed again": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "1d441999",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "71 calls #eac10ed4",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: hover": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "22066c71",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: the pointer leaves": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "ad117275",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: a tap on a part": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "bf3fcdfb",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "picks": "2"
  },
  "A: a tap on nothing": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "ad117275",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "picks": "none"
  },
  "A: an orbit drag is not a tap": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "ad117275",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "picks": "none"
  },
  "A: picks": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "ad117275",
    "frames": "none; 1 waiting",
    "gl": "0 calls #811c9dc5",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "picks": "0 | 2 | -3.2878 -5 11.9482 | -22.4711 10.0909 2 | -5.8302 -3 10.6298 | none | none"
  },
  "A: selected and hovered": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #abd73fc0",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "picks": "2"
  },
  "A: a cover, 300 px": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "32.5152 -32.5152 34.3864 at 300x300, 3 draws | 59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "33 calls #41eb765b",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "pictures": "toBlob(image/png) 300x300"
  },
  "A: a cover, the default size": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "32.5152 -32.5152 34.3864 at 512x512, 3 draws | 59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "33 calls #0284a095",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "pictures": "toBlob(image/png) 512x512"
  },
  "A: a picture of the view": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "59 -59 44.25 at 1600x1200, 6 draws; 1 waiting",
    "gl": "26 calls #cc5f91d3",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "pictures": "toBlob(image/png) 1600x1200"
  },
  "A: a thumbnail": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "28.2741 -28.2741 31.2056 at 128x128, 3 draws | 59 -59 44.25 at 800x600, 6 draws | 59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "58 calls #179e34ee",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "pictures": "toDataURL(image/png) 128x128"
  },
  "A: a thumbnail of other parts": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "95.6853 -45.6853 78.014 at 64x64, 2 draws | 59 -59 44.25 at 800x600, 6 draws | 59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "94 calls #e9d282ea",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures",
    "pictures": "toDataURL(image/png) 64x64"
  },
  "A: a new shape for one part": {
    "camera": "59 -59 44.25 looking at 0 0 10",
    "scene": "499f82cf",
    "frames": "59 -59 44.25 at 800x600, 6 draws; 1 waiting",
    "gl": "32 calls #2f01f23e",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: a fold rig": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "d074ca78",
    "frames": "110.5499 -110.5499 64.9251 at 800x600, 5 draws; 1 waiting",
    "gl": "76 calls #83c9c497",
    "held": "17 geometries, 2 textures, 7 programs (14 users), 49 buffers, 19 vertex arrays, 6 GL textures"
  },
  "A: the fold moves": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "0b31730d",
    "frames": "110.5499 -110.5499 64.9251 at 800x600, 5 draws; 1 waiting",
    "gl": "20 calls #ad68b7d7",
    "held": "17 geometries, 2 textures, 7 programs (14 users), 49 buffers, 19 vertex arrays, 6 GL textures"
  },
  "A: a cover of the rig": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "0b31730d",
    "frames": "71.7898 -86.5877 66.2641 at 256x256, 2 draws | 110.5499 -110.5499 64.9251 at 800x600, 5 draws; 1 waiting",
    "gl": "29 calls #c03343b1",
    "held": "17 geometries, 2 textures, 7 programs (14 users), 49 buffers, 19 vertex arrays, 6 GL textures",
    "pictures": "toBlob(image/png) 256x256"
  },
  "A: a thumbnail of the rig": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "0b31730d",
    "frames": "62.4259 -77.2238 59.2412 at 96x96, 2 draws | 110.5499 -110.5499 64.9251 at 800x600, 5 draws | 110.5499 -110.5499 64.9251 at 800x600, 5 draws; 1 waiting",
    "gl": "51 calls #8ef73377",
    "held": "17 geometries, 2 textures, 7 programs (14 users), 49 buffers, 19 vertex arrays, 6 GL textures",
    "pictures": "toDataURL(image/png) 96x96"
  },
  "A: the rig cleared": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "81f49aab",
    "frames": "110.5499 -110.5499 64.9251 at 800x600, 6 draws; 1 waiting",
    "gl": "72 calls #249c193c",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: paused": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "81f49aab",
    "frames": "none; 0 waiting",
    "gl": "0 calls #811c9dc5",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: resumed twice": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "81f49aab",
    "frames": "110.5499 -110.5499 64.9251 at 800x600, 6 draws | 110.5499 -110.5499 64.9251 at 800x600, 6 draws; 1 waiting",
    "gl": "44 calls #44ae023f",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: resumed while running": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "81f49aab",
    "frames": "110.5499 -110.5499 64.9251 at 800x600, 6 draws; 1 waiting",
    "gl": "22 calls #d506dc5e",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 47 buffers, 20 vertex arrays, 6 GL textures"
  },
  "A: disposed": {
    "camera": "110.5499 -110.5499 64.9251 looking at 0 0 0.75",
    "scene": "c92b9868",
    "frames": "none; 0 waiting",
    "gl": "71 calls #30fe3764",
    "held": "1 geometries, 1 textures, 3 programs (8 users), 3 buffers, 0 vertex arrays, 5 GL textures",
    "page": "0 in the stage, 0 window listeners, 0 contexts lost"
  },
  "B: made": {
    "camera": "60 -60 45 looking at 0 0 0",
    "scene": "7c06a07c",
    "frames": "60 -60 45 at 800x600, 3 draws; 1 waiting",
    "gl": "731 calls #dd99d9c0",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 44 buffers, 17 vertex arrays, 11 GL textures"
  },
  "B: a fold rig on the grid": {
    "camera": "95.5783 -95.5783 72.4338 looking at 0 0 0.75",
    "scene": "5b25ab7e",
    "frames": "95.5783 -95.5783 72.4338 at 800x600, 3 draws; 1 waiting",
    "gl": "93 calls #dfc6d54e",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 49 buffers, 17 vertex arrays, 11 GL textures"
  },
  "B: the fold moves": {
    "camera": "95.5783 -95.5783 72.4338 looking at 0 0 0.75",
    "scene": "afe8e71c",
    "frames": "95.5783 -95.5783 72.4338 at 800x600, 3 draws; 1 waiting",
    "gl": "11 calls #0e742c23",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 49 buffers, 17 vertex arrays, 11 GL textures"
  },
  "B: a cover": {
    "camera": "95.5783 -95.5783 72.4338 looking at 0 0 0.75",
    "scene": "afe8e71c",
    "frames": "78.7429 -88.0745 73.2189 at 384x384, 2 draws | 95.5783 -95.5783 72.4338 at 800x600, 3 draws; 1 waiting",
    "gl": "19 calls #7d299686",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 49 buffers, 17 vertex arrays, 11 GL textures",
    "pictures": "toBlob(image/png) 384x384"
  },
  "B: disposed": {
    "camera": "95.5783 -95.5783 72.4338 looking at 0 0 0.75",
    "scene": "5db31613",
    "frames": "none; 0 waiting",
    "gl": "66 calls #e8e3fade",
    "held": "1 geometries, 1 textures, 3 programs (8 users), 6 buffers, 0 vertex arrays, 10 GL textures"
  },
  "C: made, no plate": {
    "camera": "60 -60 45 looking at 0 0 0",
    "scene": "976cf441",
    "frames": "60 -60 45 at 800x600, 0 draws; 1 waiting",
    "gl": "717 calls #9466d662",
    "held": "15 geometries, 2 textures, 6 programs (12 users), 47 buffers, 17 vertex arrays, 16 GL textures"
  },
  "C: parts, anchored and framed": {
    "camera": "46 -42 35.25 looking at -1 5 10",
    "scene": "fcc2f3a0",
    "frames": "46 -42 35.25 at 800x600, 3 draws; 1 waiting",
    "gl": "49 calls #065a589d",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 53 buffers, 20 vertex arrays, 16 GL textures"
  },
  "C: a drag on a plane": {
    "camera": "46 -42 35.25 looking at -1 5 10",
    "scene": "c3200e75",
    "frames": "46 -42 35.25 at 800x600, 3 draws; 1 waiting",
    "gl": "7 calls #1f5f7a57",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 53 buffers, 20 vertex arrays, 16 GL textures"
  },
  "C: the plate for printing": {
    "camera": "46 -42 35.25 looking at -1 5 10",
    "scene": "d0003b45",
    "frames": "46 -42 35.25 at 800x600, 6 draws; 1 waiting",
    "gl": "69 calls #799cfcb8",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 53 buffers, 20 vertex arrays, 16 GL textures"
  },
  "C: a picture of the view": {
    "camera": "46 -42 35.25 looking at -1 5 10",
    "scene": "d0003b45",
    "frames": "46 -42 35.25 at 1600x1200, 6 draws; 1 waiting",
    "gl": "26 calls #f591e567",
    "held": "18 geometries, 2 textures, 7 programs (15 users), 53 buffers, 20 vertex arrays, 16 GL textures",
    "pictures": "toBlob(image/png) 1600x1200"
  },
  "C: disposed": {
    "camera": "46 -42 35.25 looking at -1 5 10",
    "scene": "b1532c81",
    "frames": "none; 0 waiting",
    "gl": "71 calls #3d8ce16d",
    "held": "1 geometries, 1 textures, 3 programs (8 users), 9 buffers, 0 vertex arrays, 15 GL textures"
  }
};

const fields = (r: Record_ | undefined) => Object.keys(r ?? {}).sort().join();
check('the same steps, in the same order', JSON.stringify(Object.keys(actual)) === JSON.stringify(Object.keys(GOLDEN)), `${Object.keys(actual).length} steps, ${Object.keys(GOLDEN).length} recorded`);
for (const [name, got] of Object.entries(actual)) {
  const want = GOLDEN[name];
  const moved = Object.keys(got).filter((k) => got[k] !== want?.[k]);
  const same = !!want && moved.length === 0 && fields(got) === fields(want);
  check(`${name}: unchanged`, same, same ? '' : moved.map((k) => `${k}: ${want?.[k] ?? '(none)'} -> ${got[k]}`).join('; '));
  if (!same && moved.includes('scene')) console.log(`  the scene now:\n    ${scenes[name]!.split('\n').join('\n    ')}`);
}

/* ------------------------------------------------------------------ what the table cannot see */

{
  // Dispose lets go: the outline's one material is freed, and no hook is kept, so nothing an
  // app's hook holds outlives the viewer it was given to.
  const gc = (globalThis as { gc?: () => void }).gc;
  const v = createViewer(stage, { outline: true });
  v.setParts(PARTS);
  v.highlightPart(0);
  const line = v.scene.getObjectsByProperty('type', 'LineSegments').find((l) => l.renderOrder === 999) as THREE.LineSegments | undefined;
  let freed = false;
  (line?.material as THREE.Material | undefined)?.addEventListener('dispose', () => void (freed = true));
  const held = (register: (cb: () => void) => unknown) => {
    const state = { held: true };
    register(() => void state.held);
    return new WeakRef(state);
  };
  const frameHook = held((cb) => v.onFrame(cb));
  const partsHook = held((cb) => v.onPartsSet(cb));
  v.dispose();
  await new Promise((done) => setTimeout(done, 0));
  gc?.();
  check('dispose: the outline material is freed', !!line && freed);
  check('dispose: no frame hook is kept', !!gc && frameHook.deref() === undefined, gc ? '' : 'run node with --expose-gc');
  check('dispose: no parts hook is kept', !!gc && partsHook.deref() === undefined);
  check('dispose: and the viewer itself is still there to ask', v.partMeshes().length === 0);
}

/* ------------------------------------------------------------------ report */

console.log(`\ndefault path: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nThe viewer now does (paste over GOLDEN only if the change is deliberate):\n');
  console.log(`const GOLDEN: Record<string, Record_> = ${JSON.stringify(actual, null, 2)};`);
  process.exit(1);
}
