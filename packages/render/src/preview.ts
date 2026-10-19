/**
 * The studio, live, at one pass.
 *
 * The only honest preview of a render is the same scene the still renderer draws, so this calls
 * `buildStudioScene` and nothing else. Backdrop, floor fade, filament, finish, key, fill, rim,
 * exposure and shadow are all whatever the options say, because they are the same code.
 *
 * What is deliberately *not* the same is the sample count. A still averages many passes with the
 * key light jittered around a disc, which is what makes its shadow soft; this draws one, so the
 * preview's shadow is harder-edged than the output's and everything else matches. That is the
 * right side to err on: a preview accurate to the shadow but taking two seconds a frame would not
 * be a preview.
 *
 * It has its own WebGL context, deliberately: the still renderer's is resized to the output size
 * for every still (see `still.ts`).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LoadedModel } from './load';
import { buildEnvironment, buildStudioScene, fitDistance, type StudioScene } from './scene';
import { PRESET_SHOTS, type SceneOptions } from './studio';

/** Where the preview camera is, in the terms a `Shot` is written in. */
export interface ViewSnapshot {
  /** Direction from the model to the camera, y-up, normalised. */
  dir: [number, number, number];
  /** Distance as a multiple of the fitted distance, so it survives a change of aspect. */
  zoom: number;
  /** Where the camera looks, from the model's centre, in model radii: the pan, as a `Shot` holds it. */
  offset: [number, number, number];
}

export interface StudioPreviewOptions {
  /**
   * Called the first time the user drags or zooms after the model or the view key changed, so a
   * panel can stop claiming the shot it framed is what is on screen.
   */
  onOrbit?: () => void;
  /**
   * Called when the user lets go after moving the camera (a drag, a wheel, a pinch), and again
   * once the easing after it has come to rest, with where the camera is: for saving into the shot
   * being framed. `readView()` gives the same at any other moment.
   */
  onViewEnd?: (view: ViewSnapshot) => void;
  /** Let a right-drag pan. Default true. A photo whose model must stay centred turns it off. */
  pan?: boolean;
  /**
   * Keep the camera above the floor the model stands on: a view from under it shows the model
   * from below through a floor that is not drawn from that side, which is never a photo anyone
   * wants. Default false: the camera goes all the way round.
   */
  aboveFloor?: boolean;
}

export interface StudioPreview {
  /** The preview's canvas, inside the host, filling it. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Shows `model` as `look` describes it, and draws at once.
   *
   * Call it whenever anything in the look changes. The camera keeps wherever the user dragged it
   * for as long as the model and `viewKey` stay the same; a new `viewKey` (a different shot, or a
   * reset of the same one) frames the model from `look.shot` again. Null clears the preview.
   */
  update(model: LoadedModel | null, look: SceneOptions, viewKey: string): void;
  /** The camera now, for saving as a shot. The hero direction when nothing is shown. */
  readView(): ViewSnapshot;
  /**
   * Stops drawing while on, for example while a batch of stills is rendering, so the two do not
   * compete for the GPU. Not needed for correctness: a still and the preview never share objects.
   */
  pause(on: boolean): void;
  /** Frees the WebGL context and removes the canvas. The preview cannot be used afterwards. */
  dispose(): void;
}

/**
 * A live preview of the studio scene inside `host`, orbited by drag and zoomed by wheel or pinch.
 *
 * `host` must have a size of its own (the canvas fills it at 100% and follows it as it resizes).
 * Where the backdrop is transparent the canvas is too, so whatever the host shows behind it (a
 * checkerboard, say) shows through. Draws only when something changed.
 */
export function createStudioPreview(host: HTMLElement, opts: StudioPreviewOptions = {}): StudioPreview {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.cursor = 'grab';
  host.appendChild(canvas);

  const env = buildEnvironment(renderer);

  let current: { studio: StudioScene; controls: OrbitControls } | null = null;
  /*
   * Where the camera was left, so a change of colour or backdrop does not throw away the framing
   * the user just spent a minute on. Dropped when the model or the view key changes, because then
   * moving the camera is the entire point of the change.
   */
  let kept: { model: LoadedModel; viewKey: string; dir: THREE.Vector3; distance: number; target: THREE.Vector3 } | null = null;
  let shown: { model: LoadedModel | null; viewKey: string } | null = null;
  let orbited = false;
  let paused = false;
  let disposed = false;
  let frame = 0;
  /** Set between the user letting go and the camera settling; see `onViewEnd`. */
  let settling: ReturnType<typeof setTimeout> | null = null;
  let moving = false;

  /** Follows the host's size. The host can settle a frame or two after the preview is made. */
  const fit = () => {
    if (!current) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const pr = renderer.getPixelRatio();
    if (canvas.width === Math.floor(w * pr) && canvas.height === Math.floor(h * pr)) return;
    renderer.setSize(w, h, false);
    current.studio.camera.aspect = w / h;
    current.studio.camera.updateProjectionMatrix();
  };

  const draw = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (disposed || paused || !current) return;
    fit();
    current.controls.update();
    current.studio.relight();
    current.studio.jitter(0, 1);
    renderer.render(current.studio.scene, current.studio.camera);
  };
  const invalidate = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(draw);
  };

  const release = () => {
    if (!current) return;
    current.controls.dispose();
    current.studio.dispose();
    current = null;
  };

  const observer = new ResizeObserver(() => {
    fit();
    invalidate();
  });
  observer.observe(host);

  const api: StudioPreview = {
    canvas,

    update(model, look, viewKey) {
      if (disposed) return;
      if (!shown || shown.model !== model || shown.viewKey !== viewKey) orbited = false;
      shown = { model, viewKey };
      release();
      if (!model) {
        renderer.setClearAlpha(0);
        renderer.clear();
        return;
      }

      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      renderer.setClearAlpha(look.backdrop.sky ? 1 : 0);
      renderer.toneMappingExposure = look.lighting.exposure;

      const studio = buildStudioScene(model, look, env, w / h);
      const { camera, radius } = studio;
      const target = studio.target.clone();

      if (kept && kept.model === model && kept.viewKey === viewKey) {
        target.copy(kept.target);
        camera.position.copy(target).addScaledVector(kept.dir, kept.distance);
        camera.lookAt(target);
      } else {
        kept = null;
      }

      const controls = new OrbitControls(camera, canvas);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.minDistance = radius * 0.4;
      controls.maxDistance = radius * 40;
      controls.enablePan = opts.pan ?? true;
      if (opts.aboveFloor) controls.maxPolarAngle = Math.PI / 2 - 0.02;
      // Before the listeners: the first update moves nothing, but reports a change.
      controls.update();

      const report = () => {
        if (current?.controls === controls && opts.onViewEnd) opts.onViewEnd(api.readView());
      };
      /** The camera has been still for a moment since the user let go: report where. */
      const settle = () => {
        if (settling) clearTimeout(settling);
        settling = setTimeout(() => {
          settling = null;
          report();
        }, 160);
      };
      controls.addEventListener('change', () => {
        kept = {
          model,
          viewKey,
          dir: camera.position.clone().sub(controls.target).normalize(),
          distance: camera.position.distanceTo(controls.target),
          target: controls.target.clone(),
        };
        invalidate();
        // The easing after a release moves the camera on; wait for it to stop.
        if (!moving && settling) settle();
      });
      controls.addEventListener('start', () => { moving = true; });
      // Reported as the user lets go, so nothing waits on the easing, and again once it stops: on
      // a slow machine the easing can take seconds.
      controls.addEventListener('end', () => { moving = false; report(); settle(); });
      // `start` fires on a real drag or wheel, never on a programmatic `update`, so this is the
      // honest signal that the shot no longer describes what is on screen.
      controls.addEventListener('start', () => {
        if (orbited) return;
        orbited = true;
        opts.onOrbit?.();
      });

      current = { studio, controls };
      draw();
    },

    readView() {
      if (!current) {
        const [x, y, z] = PRESET_SHOTS[0]?.dir ?? [1, 0.8, 1.25];
        const d = new THREE.Vector3(x, y, z).normalize();
        return { dir: [d.x, d.y, d.z], zoom: 1, offset: [0, 0, 0] };
      }
      const { camera, center, radius } = current.studio;
      const target = current.controls.target;
      const dir = camera.position.clone().sub(target).normalize();
      const fitted = fitDistance(radius, camera.aspect || 1) || 1;
      const offset = target.clone().sub(center).divideScalar(radius);
      return {
        dir: [dir.x, dir.y, dir.z],
        zoom: camera.position.distanceTo(target) / fitted,
        offset: [offset.x, offset.y, offset.z],
      };
    },

    pause(on) {
      paused = on;
      if (!on) draw();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      release();
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return api;
}
