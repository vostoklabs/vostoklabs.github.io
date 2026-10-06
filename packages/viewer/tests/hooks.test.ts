/*
  The 3D viewer's options and hooks, each off until an app asks for it, run against a stand-in
  page and WebGL context (tests/support/page.ts).

    pnpm --filter @vostok/viewer test

  First what a viewer is with no options at all, which is what the generators that use it get;
  then each option and hook, on and doing what it says.
*/
import * as THREE from 'three';
import { installPage } from './support/page';
import { PARTS, RED, RED_AT, tetra, WHITE_AT } from './support/parts';

const page = installPage();
const { createViewer } = await import('../src/index');
type ViewerPart = import('../src/index').ViewerPart;

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const stage = page.stage as unknown as HTMLElement;

/** The selection outlines: edge lines drawn last (the plate's grid is line segments too). */
const outlinesOf = (v: ReturnType<typeof createViewer>) => v.scene.getObjectsByProperty('type', 'LineSegments').filter((l) => l.renderOrder === 999);
const emissive = (v: ReturnType<typeof createViewer>) => v.partMeshes().map((m) => (m.material as THREE.MeshStandardMaterial).emissiveIntensity);

/* ------------------------------------------------------------------ no options */

{
  const v = createViewer(stage);
  const canvas = page.canvas();
  // What the viewer decides, not three's whole request, which is three's to change.
  const asked = canvas.contextAttributes!;
  check('default: the renderer asks for antialiasing, a kept drawing buffer and no stencil',
    asked.antialias === true && asked.preserveDrawingBuffer === true && asked.stencil !== true, JSON.stringify(asked));
  check('default: no stencil, an opaque clear, no local clipping, ACES tone mapping, a room environment',
    !v.hasStencil && v.renderer.getClearAlpha() === 1 && !v.renderer.localClippingEnabled && v.renderer.toneMapping === THREE.ACESFilmicToneMapping && !!v.scene.environment);
  check('default: its canvas is put in the stage', (page.stage.children as unknown[]).includes(v.renderer.domElement));
  check('default: the controls and the renderer are reachable', v.controls.object === v.camera && v.renderer.domElement === (canvas as unknown));
  v.setParts(PARTS);
  check('default: every part sits in the model group itself', v.partMeshes().every((m) => m.parent === v.root) && v.partMeshes().length === 3);
  const hit = v.pickPart(...RED_AT);
  v.highlightParts([0, 1, 2].filter((i) => i !== hit));
  page.pointer('pointerdown', ...RED_AT, { shiftKey: true });
  page.pointer('pointerup', ...RED_AT, { shiftKey: true });
  check('default: a shift-click selects the one part, like any click', hit !== null && emissive(v).filter((e) => e > 0).length === 1, emissive(v).join());
  check('default: no outline is drawn round a selection', (v.highlightPart(0), !outlinesOf(v).length));
  const before = page.log.length;
  v.dispose();
  check('default: dispose leaves the context to the browser', !page.log.slice(before).some((l) => l.includes('loseContext')));
  check('default: dispose takes its canvas out of the stage', !(page.stage.children as unknown[]).includes(v.renderer.domElement));
}

/* ------------------------------------------------------------------ the renderer's options */

{
  const v = createViewer(stage, { stencil: true, alpha: true, localClipping: true, preserveDrawingBuffer: false, forceContextLoss: true });
  const attrs = page.canvas().contextAttributes!;
  check('stencil: asked for, and reported given', attrs.stencil === true && v.hasStencil);
  check('alpha: a clear that shows through', v.renderer.getClearAlpha() === 0);
  check('preserveDrawingBuffer: false when asked', attrs.preserveDrawingBuffer === false);
  check('localClipping: materials may clip', v.renderer.localClippingEnabled);
  const before = page.log.length;
  v.dispose();
  check('forceContextLoss: dispose hands the context back', page.log.slice(before).includes('WEBGL_lose_context.loseContext()'));
}
{
  // A context that cannot give a stencil buffer reports so, whatever it was asked for.
  page.limitContext({ stencil: false });
  const v = createViewer(stage, { stencil: true });
  check('stencil: asked for but not given, and reported not given', page.canvas().contextAttributes!.stencil === true && !v.hasStencil);
  v.dispose();
  page.limitContext({});
}
{
  const own = document.createElement('canvas');
  const holder = document.createElement('div');
  holder.appendChild(own);
  const v = createViewer(stage, { canvas: own });
  check('canvas: drawn into the one given', v.renderer.domElement === own);
  check('canvas: not moved into the stage', own.parentNode === (holder as unknown) && !(page.stage.children as unknown[]).includes(own));
  v.dispose();
  check('canvas: left where it was on dispose', own.parentNode === (holder as unknown));
}

/* ------------------------------------------------------------------ the look and the framing */

{
  const v = createViewer(stage, { look: 'soft' });
  const lights = v.scene.children.filter((o) => (o as THREE.Light).isLight) as THREE.Light[];
  const sky = lights.find((l) => (l as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined;
  check('soft: a hemisphere light from above, a key and a cool fill', lights.length === 3 && !!sky && sky.position.z === 1
    && lights.filter((l) => (l as THREE.DirectionalLight).isDirectionalLight).map((l) => l.color.getHexString()).sort().join() === '9fb6ff,ffffff');
  check('soft: no environment and no tone mapping', !v.scene.environment && v.renderer.toneMapping === THREE.NoToneMapping);
  v.dispose();
}
{
  const v = createViewer(stage, { frame: { fill: 0.55 } });
  v.setParts(PARTS);
  const box = new THREE.Box3();
  for (const m of v.partMeshes()) box.expandByObject(m);
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const dist = v.camera.position.distanceTo(v.controls.target);
  const vFov = (45 * Math.PI) / 180;
  const want = radius / (0.55 * Math.tan(Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * (800 / 600))) / 2));
  check('frame: the model\'s bounding sphere fills 55% of the view', near(dist, want, 1e-6), `${dist.toFixed(4)} vs ${want.toFixed(4)}`);
  v.setView('front');
  check('frame: every view at that distance', near(v.camera.position.distanceTo(v.controls.target), want, 1e-6));
  v.dispose();
}

/* ------------------------------------------------------------------ parts */

{
  const v = createViewer(stage);
  const wide = (p: ViewerPart): ViewerPart => {
    const out = new Float32Array((p.positions.length / 3) * 6);
    for (let i = 0; i < p.positions.length / 3; i++) out.set([p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!, 9, 9, 9], i * 6);
    return { ...p, positions: out, stride: 6 };
  };
  v.setParts(PARTS.map(wide));
  const strided = v.partMeshes().map((m) => [...(m.geometry.getAttribute('position').array as Float32Array)].join());
  v.setParts(PARTS);
  const plain = v.partMeshes().map((m) => [...(m.geometry.getAttribute('position').array as Float32Array)].join());
  check('stride: six floats a vertex draw what three do', JSON.stringify(strided) === JSON.stringify(plain));
  const seatedPlain = v.root.position.clone();

  const top = v.layer('top');
  v.setParts(PARTS.map((p, i) => (i ? { ...p, layer: 'top' } : p)));
  check('layer: its parts are drawn in its group, the rest in the model group', v.partMeshes()[0]!.parent === v.root && v.partMeshes()[1]!.parent === top && v.partMeshes()[2]!.parent === top);
  // Moved sideways as well as up: measured where it was moved, the layer would widen the model
  // and shift its centre, and the model would be seated somewhere else.
  const moved = new THREE.Vector3(30, -12, 25);
  top.position.copy(moved);
  v.setParts(PARTS.map((p, i) => (i ? { ...p, layer: 'top' } : p)));
  check('layer: a moved layer keeps its place, and its group, across setParts', v.layer('top') === top && top.position.equals(moved) && top.children.length === 2);
  check('layer: the model is seated with every layer in its place', v.root.position.equals(seatedPlain), `${v.root.position.toArray()} vs ${seatedPlain.toArray()}`);

  const camera = v.camera.position.clone();
  const keep = v.partMeshes()[1]!;
  const material = keep.material;
  v.setPartGeometry(1, tetra(0, 0, 0, 2, RED));
  check('setPartGeometry: a new shape, the same mesh and colour, nothing else moved',
    v.partMeshes()[1] === keep && keep.material === material && keep.geometry.getAttribute('position').count === 12 && v.camera.position.equals(camera));
  v.setPartVisible(2, false);
  check('setPartVisible: hidden, and shown again', !v.partMeshes()[2]!.visible && (v.setPartVisible(2, true), v.partMeshes()[2]!.visible));
  check('partMeshes: a copy, in part order', v.partMeshes() !== v.partMeshes() && v.partMeshes().map((m) => m.userData.partIndex).join() === '0,1,2');
  v.dispose();
}

/* ------------------------------------------------------------------ selection */

{
  const v = createViewer(stage, { multiSelect: true, outline: true });
  v.setParts(PARTS, true);
  const picks: (number | null)[] = [];
  v.onPartPick((i) => picks.push(i));
  const hit = v.pickPart(...RED_AT);
  page.pointer('pointerdown', ...RED_AT);
  page.pointer('pointerup', ...RED_AT);
  v.highlightParts([0, 2]);
  check('highlightParts: every part named glows', emissive(v).map((e) => (e > 0 ? 1 : 0)).join() === '1,0,1', emissive(v).join());
  check('outline: an edge outline on each selected part, drawn last', outlinesOf(v).length === 2
    && outlinesOf(v).every((l, i) => l.parent === v.partMeshes()[[0, 2][i]!] && ((l as THREE.LineSegments).material as THREE.LineBasicMaterial).depthTest === false));
  v.clearHighlight();
  check('outline: gone with the selection', outlinesOf(v).length === 0);
  if (hit !== null) {
    page.pointer('pointerdown', ...RED_AT);
    page.pointer('pointerup', ...RED_AT);
    v.highlightParts([...[0, 1, 2].filter((i) => i !== hit)]);
    page.pointer('pointerdown', ...RED_AT, { shiftKey: true });
    page.pointer('pointerup', ...RED_AT, { shiftKey: true });
    check('multiSelect: shift-click adds a part to the selection', emissive(v).every((e) => e > 0), emissive(v).join());
    page.pointer('pointerdown', ...RED_AT, { shiftKey: true });
    page.pointer('pointerup', ...RED_AT, { shiftKey: true });
    check('multiSelect: and takes it out again', emissive(v).filter((e) => e > 0).length === 2 && emissive(v)[hit] === 0, emissive(v).join());
    page.pointer('pointerdown', ...RED_AT);
    page.pointer('pointerup', ...RED_AT);
    check('multiSelect: a plain click selects one', emissive(v).filter((e) => e > 0).length === 1);
    check('the pick callback is told the part clicked', picks.every((p) => p === hit), picks.join());
  } else {
    check('the red part is under the pointer', false, 'nothing under the pointer');
  }
  v.dispose();
}
{
  // An outline is drawn on its part: it moves, turns and hides with it.
  const v = createViewer(stage, { outline: true });
  v.setParts(PARTS, true);
  v.highlightParts([0, 2]);
  const [first, third] = outlinesOf(v);
  const meshes = v.partMeshes();
  const world = (o: THREE.Object3D) => (o.updateWorldMatrix(true, false), o.matrixWorld.elements);
  const sameWorld = (a: THREE.Object3D, b: THREE.Object3D) => world(a).every((e, i) => near(e, world(b)[i]!));
  v.setPartOffset(2, [5, -4, 3]);
  check('outline: slides with its part', !!third && sameWorld(third, meshes[2]!), third ? `${new THREE.Vector3().setFromMatrixPosition(third.matrixWorld).toArray()}` : 'no outline');
  v.setPartPose(0, [1, 2, 3], 0.7);
  check('outline: turns with its part', !!first && sameWorld(first, meshes[0]!));
  const draws = () => {
    const before = page.log.length;
    page.frame();
    return page.log.slice(before).filter((l) => l.startsWith('draw')).length;
  };
  const shown = draws();
  v.setPartVisible(2, false);
  check('outline: hidden with its part', shown - draws() === 2, 'the part and its outline both left out of the frame');
  v.dispose();
}
{
  // A pick looks from where the camera is now: one made after a rebuild has framed the parts,
  // before the next frame is drawn, finds what the new view puts under the pointer.
  const v = createViewer(stage);
  page.frame();
  v.setParts(PARTS, true);
  const before = [v.pickPart(...RED_AT), v.pickPart(...WHITE_AT)];
  const planeBefore = v.pickOnPlane(...RED_AT, 2, 'z');
  page.frame();
  const planeAfter = v.pickOnPlane(...RED_AT, 2, 'z');
  check('picks: before the next frame, from the camera where it is now', before.join() === '0,2', before.join());
  check('pickOnPlane: the same point before the next frame as after it', !!planeBefore && !!planeAfter && planeBefore.every((c, i) => near(c, planeAfter[i]!)),
    `${planeBefore?.map((c) => c.toFixed(3))} then ${planeAfter?.map((c) => c.toFixed(3))}`);
  v.setPartOffset(2, [0, 0, 40]);
  check('picks: a part slid away is not under the pointer before the next frame either', v.pickPart(...WHITE_AT) !== 2, String(v.pickPart(...WHITE_AT)));
  v.dispose();
}

/* ------------------------------------------------------------------ hooks and the loop */

{
  const v = createViewer(stage);
  const seen: number[] = [];
  const stop = v.onPartsSet((meshes, parts) => seen.push(meshes.length * 10 + parts.length));
  v.setParts(PARTS);
  v.setParts([]);
  stop();
  v.setParts(PARTS);
  check('onPartsSet: after every setParts, with the meshes, until stopped', seen.join() === '33,0', seen.join());

  let frames = 0;
  const off = v.onFrame(() => frames++);
  page.frame(3);
  off();
  page.frame(2);
  check('onFrame: once a frame, until stopped', frames === 3, String(frames));

  v.setPaused(true);
  const drawn = page.log.filter((l) => l.startsWith('drawElements') || l.startsWith('drawArrays')).length;
  page.frame(3);
  check('setPaused: no frames while paused', page.pendingFrames() === 0
    && page.log.filter((l) => l.startsWith('drawElements') || l.startsWith('drawArrays')).length === drawn);
  v.setPaused(false);
  page.frame(1);
  check('setPaused: drawing again once resumed', page.pendingFrames() === 1);
  v.dispose();
  check('dispose: the window keeps none of its listeners', page.window.listenerCount() === 0);
}
{
  // A disposed viewer stays stopped, whatever pausing and resuming its app does after.
  const draws = (count: number) => {
    const before = page.log.length;
    page.frame(count);
    return page.log.slice(before).filter((l) => l.startsWith('draw')).length;
  };
  const pausedFirst = createViewer(stage);
  pausedFirst.setParts(PARTS);
  pausedFirst.setPaused(true);
  pausedFirst.dispose();
  pausedFirst.setPaused(false);
  check('dispose: a paused viewer is not started again by a resume', page.pendingFrames() === 0 && draws(2) === 0, `${page.pendingFrames()} frames waiting`);
  const running = createViewer(stage);
  running.setParts(PARTS);
  page.frame();
  running.dispose();
  running.setPaused(true);
  running.setPaused(false);
  check('dispose: nor a running one by a pause and a resume', page.pendingFrames() === 0 && draws(2) === 0, `${page.pendingFrames()} frames waiting`);
}
{
  // A frame hook that throws costs its own work, not the frame: the stage is still drawn, the
  // hooks after it still run, and the error is logged once rather than every frame.
  const v = createViewer(stage);
  v.setParts(PARTS);
  const draws = () => {
    const before = page.log.length;
    let escaped = false;
    try {
      page.frame();
    } catch {
      escaped = true;
    }
    return escaped ? -1 : page.log.slice(before).filter((l) => l.startsWith('draw')).length;
  };
  const perFrame = draws();
  const logged: unknown[][] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  let after = 0;
  const offBroken = v.onFrame(() => {
    throw new Error('a hook that breaks');
  });
  const offAfter = v.onFrame(() => void after++);
  const drawn = [draws(), draws(), draws()];
  console.error = error;
  check('onFrame: a hook that throws, and every frame is still drawn', perFrame > 0 && drawn.every((d) => d === perFrame), `${drawn.join(', ')} draws (${perFrame} a frame)`);
  check('onFrame: the hooks after it still run', after === 3, String(after));
  check('onFrame: and the error is logged once', logged.length === 1 && String(logged[0]).includes('a hook that breaks'), `${logged.length} times`);
  offBroken();
  offAfter();
  v.dispose();
}

/* ------------------------------------------------------------------ pictures */

{
  const v = createViewer(stage, { alpha: true });
  v.setParts(PARTS, true);
  v.controls.target.set(0, 0, 0);
  v.camera.position.set(0, -80, 10); // the user looking from the front
  v.controls.update();
  const shots: { at: THREE.Vector3; bg: unknown; w: number; plate: boolean; model: boolean }[] = [];
  const render = v.renderer.render.bind(v.renderer);
  v.renderer.render = (scene, camera) => {
    const plate = scene.children.some((o) => o.renderOrder === -1 && o.visible);
    shots.push({ at: camera.position.clone(), bg: (scene as THREE.Scene).background, w: v.renderer.domElement.width, plate, model: v.root.visible });
    render(scene, camera);
  };
  const viewDir = v.camera.position.clone().sub(v.controls.target).normalize();
  const camBefore = v.camera.position.clone();

  shots.length = 0;
  await v.renderCoverPng({ edge: 300, angle: 'view' });
  const cover = shots[0]!;
  const box = new THREE.Box3().setFromObject(v.root);
  const coverDir = cover.at.clone().sub(box.getCenter(new THREE.Vector3())).normalize();
  check('cover, angle view: shot from where the user is looking', coverDir.distanceTo(viewDir) < 1e-9, coverDir.toArray().join());
  check('cover: at the edge asked for, then the stage put back', cover.w === 300 && v.renderer.domElement.width === 800 && v.camera.position.distanceTo(camBefore) < 1e-9,
    `${cover.w} px, then ${v.renderer.domElement.width} px, camera ${v.camera.position.toArray()} (was ${camBefore.toArray()})`);

  shots.length = 0;
  const url = v.renderThumbnail(128);
  check('thumbnail: a PNG data URL, 128 pixels a side', !!url && url.startsWith('data:image/png') && shots[0]!.w === 128);
  check('thumbnail, alpha: no background and no plate behind the model', shots[0]!.bg === null && !shots[0]!.plate);
  check('thumbnail: the stage put back as it was', v.scene.background !== null && v.renderer.domElement.width === 800 && v.camera.position.distanceTo(camBefore) < 1e-9,
    `background ${v.scene.background}, ${v.renderer.domElement.width} px, camera ${v.camera.position.toArray()}`);

  const meshesBefore = v.scene.getObjectsByProperty('type', 'Mesh').length;
  shots.length = 0;
  let drawnWith: THREE.MeshStandardMaterial[] = [];
  const shoot = v.renderer.render;
  v.renderer.render = (scene, camera) => {
    if (!drawnWith.length) drawnWith = scene.getObjectsByProperty('type', 'Mesh').filter((m) => m.parent !== v.root && m.parent?.parent === scene && (m.parent as THREE.Group).isGroup && !m.parent.renderOrder).map((m) => (m as THREE.Mesh).material as THREE.MeshStandardMaterial);
    shoot(scene, camera);
  };
  v.renderThumbnail(64, [tetra(0, 0, 0, 50, RED)]);
  v.renderer.render = shoot;
  check('thumbnail of other parts: drawn without the model, framed on them, then freed', !shots[0]!.model && v.root.visible
    && v.scene.getObjectsByProperty('type', 'Mesh').length === meshesBefore && shots[0]!.at.length() > 100, `camera ${shots[0]!.at.length().toFixed(1)} mm out`);
  // Drawn as the stage draws a part: both sides of every face, the same finish.
  const stageMaterial = v.partMeshes()[0]!.material as THREE.MeshStandardMaterial;
  const finish = (m: THREE.MeshStandardMaterial) => `side ${m.side}, metalness ${m.metalness}, roughness ${m.roughness}, #${m.color.getHexString()}`;
  check('thumbnail of other parts: drawn with the material the stage uses', drawnWith.length === 1 && finish(drawnWith[0]!) === finish(stageMaterial),
    `${drawnWith.map(finish).join('; ')} vs ${finish(stageMaterial)}`);

  // A model that lives in a fold rig alone is framed too, as the cover frames it.
  v.setParts([]);
  const rig = new THREE.Group();
  rig.add(new THREE.Mesh(new THREE.BoxGeometry(120, 80, 2), new THREE.MeshStandardMaterial()));
  v.setFoldRig(rig);
  shots.length = 0;
  v.renderThumbnail(64);
  const rigBox = new THREE.Box3().setFromObject(rig);
  const rigDist = shots[0]!.at.distanceTo(rigBox.getCenter(new THREE.Vector3()));
  const rigWant = rigBox.getSize(new THREE.Vector3()).length() / 2 / Math.sin(Math.PI / 8);
  check('thumbnail of a fold rig: framed on the rig', near(rigDist, rigWant, 1e-6), `${rigDist.toFixed(2)} vs ${rigWant.toFixed(2)} mm`);
  v.dispose();
}

/* ------------------------------------------------------------------ what a picture shows */

{
  // The cover and the thumbnail alike: the model as it is built, every layer back in its place,
  // and none of the pointer's business (no hover, no selection, no outline); all of it back on
  // the stage once the picture is taken.
  const v = createViewer(stage, { outline: true });
  const top = v.layer('top');
  const exploded = new THREE.Vector3(0, 0, 30);
  top.position.copy(exploded);
  v.setParts(PARTS.map((p, i) => (i === 2 ? { ...p, layer: 'top' } : p)), true);
  page.frame();
  // Hover the lifted part where it is drawn now: through the middle of its corners.
  const lifted = v.partMeshes()[2]!;
  lifted.updateWorldMatrix(true, false);
  const corners = lifted.geometry.getAttribute('position');
  const middle = new THREE.Vector3();
  for (let i = 0; i < corners.count; i++) middle.add(new THREE.Vector3().fromBufferAttribute(corners, i));
  const onScreen = middle.divideScalar(corners.count).applyMatrix4(lifted.matrixWorld).project(v.camera);
  const at = [((onScreen.x + 1) / 2) * 800, ((1 - onScreen.y) / 2) * 600] as const;
  v.highlightPart(0);
  page.pointer('pointermove', ...at);
  const state = () => `glow ${emissive(v).join(' ')}, ${outlinesOf(v).length} outlines, top at ${top.position.toArray().join(' ')}`;
  const onStage = state();
  const seen: string[] = [];
  const render = v.renderer.render.bind(v.renderer);
  v.renderer.render = (scene, camera) => {
    seen.push(state());
    render(scene, camera);
  };
  check('pictures: set up with a selection, a hover and a lifted layer', v.pickPart(...at) === 2 && onStage === 'glow 0.2 0 0.4, 1 outlines, top at 0 0 30', onStage);
  const pictured = 'glow 0 0 0, 0 outlines, top at 0 0 0';
  await v.renderCoverPng(64);
  check('pictures: the cover shows the model built, with nothing highlighted', seen[0] === pictured, seen[0]);
  check('pictures: and the stage gets its highlight and its layer back', state() === onStage && seen[1] === onStage, `${state()}; drawn with ${seen[1]}`);
  seen.length = 0;
  v.renderThumbnail(64);
  check('pictures: so does the thumbnail', seen[0] === pictured && state() === onStage && seen[1] === onStage, `${seen[0]}, then ${state()}`);
  v.dispose();
}

/* ------------------------------------------------------------------ hidden parts */

{
  // A hidden part is not there: the pointer goes through it, and a picture frames what is drawn.
  const v = createViewer(stage);
  v.setParts(PARTS, true);
  page.frame();
  const picks: (number | null)[] = [];
  v.onPartPick((i) => picks.push(i));
  const shown = v.pickPart(...WHITE_AT);
  v.setPartVisible(2, false);
  page.pointer('pointerdown', ...WHITE_AT);
  page.pointer('pointerup', ...WHITE_AT);
  check('hidden: a hidden part is not picked', shown === 2 && v.pickPart(...WHITE_AT) !== 2 && picks.length === 1 && picks[0] !== 2,
    `${shown}, then ${v.pickPart(...WHITE_AT)}; a tap told ${picks.join()}`);
  v.setPartVisible(2, true);
  v.layer('top').visible = false;
  v.setParts(PARTS.map((p, i) => (i === 2 ? { ...p, layer: 'top' } : p)));
  page.frame();
  check('hidden: nor is a part in a hidden layer', v.pickPart(...WHITE_AT) !== 2, String(v.pickPart(...WHITE_AT)));
  v.layer('top').visible = true;

  // The big red part hidden: the cover and the thumbnail frame the other two.
  v.setParts(PARTS);
  v.setPartVisible(0, false);
  const shots: THREE.Vector3[] = [];
  const render = v.renderer.render.bind(v.renderer);
  v.renderer.render = (scene, camera) => {
    shots.push(camera.position.clone());
    render(scene, camera);
  };
  page.frame();
  const box = new THREE.Box3();
  for (const m of v.partMeshes().slice(1)) box.expandByObject(m);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  shots.length = 0;
  await v.renderCoverPng(64);
  const coverAt = shots[0]!.distanceTo(centre);
  check('hidden: the cover frames the parts that are drawn', near(coverAt, (radius / Math.sin(Math.PI / 8)) * 1.15, 1e-6), `${coverAt.toFixed(2)} mm out`);
  shots.length = 0;
  v.renderThumbnail(64);
  const thumbAt = shots[0]!.distanceTo(centre);
  check('hidden: and so does the thumbnail', near(thumbAt, radius / Math.sin(Math.PI / 8), 1e-6), `${thumbAt.toFixed(2)} mm out`);
  v.dispose();
}

/* ------------------------------------------------------------------ report */

console.log(`\nhooks: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
