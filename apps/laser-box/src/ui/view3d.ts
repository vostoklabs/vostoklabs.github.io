// The 3D view: the box put together, lid and all, as the pieces will come off the machine.
//
// Each piece is its own outline extruded through its thickness and placed by its frame (the
// engine's origin + u, v, n — a basis matrix, so no Euler angles to get wrong). Engraves are a
// dark skin on the SHOW face (+n), scores lines on it, a flex tab's slits dark cuts through the
// sheet (so they show on the tab's end, outside the box, as they will in wood). The look — the light
// stage, the wood, the burn — is @vostok/laser's material preview's, so a box and a Laser Studio
// stand read as one product.
//
// It renders on demand (a change, an orbit), never in a loop: three.js on a software GPU is a
// CPU core per frame, and a box that is not moving needs no frames. The one animation — the lid
// opening — is a short run of frames that ends on the exact final state, and the final state is
// what a hidden tab gets, since requestAnimationFrame does not run there.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { exploded, frameOf, moved, type Frame } from '../engine/frames';
import type { BuildResult, BuiltPiece } from '../engine/build';
import type { FaceId, Shapes } from '../engine/types';

const BACKGROUND = '#f3f4f5';
const EDGE = '#70502f';
const BURN = '#50321c';
const PICK = '#2563eb';
/** A slit as the beam leaves it: a charred gap about a kerf wide. */
const SLIT = '#24160a';
const SLIT_WIDTH = 0.3;

export interface BoxViewOptions {
  /** A face was clicked (only while picking is on). */
  onPick?: (face: FaceId) => void;
  /** The camera moved: the zoom relative to the framed view (1 = the whole box in view). */
  onZoom?: (zoom: number) => void;
}

export interface BoxView {
  render(result: BuildResult, wood: string): void;
  /** 0 = shut, 1 = open; animates unless `instant`. */
  setOpen(amount: number, instant?: boolean): void;
  setExplode(on: boolean): void;
  /** Sides can be clicked: the one under the pointer lights up. The chosen ones show their
   *  pattern, which is the mark — a tint on every chosen side hid the very pattern being edited. */
  setPicking(on: boolean): void;
  setDimensions(labels: { x: string; y: string; z: string } | null): void;
  /** Frame the whole box again. */
  resetView(): void;
  /** Move the camera toward the box (factor > 1) or away from it. */
  zoomBy(factor: number): void;
  /** The zoom relative to the framed view: 1 = the whole box in view. */
  zoom(): number;
  /** A picture of the current box, for a style card. */
  snapshot(width: number, height: number): string;
  dispose(): void;
}

function toShapes(islands: Shapes): THREE.Shape[] {
  return islands
    .filter((i) => i[0] && i[0].length >= 3)
    .map((island) => {
      const shape = new THREE.Shape(island[0]!.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of island.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
      return shape;
    });
}

function matrixOf(f: Frame): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeBasis(new THREE.Vector3(...f.u), new THREE.Vector3(...f.v), new THREE.Vector3(...f.n));
  m.setPosition(new THREE.Vector3(...f.origin));
  return m;
}

interface Placed {
  piece: BuiltPiece;
  group: THREE.Group;
  body: THREE.Mesh;
  face: THREE.MeshStandardMaterial;
}

export function createBoxView(host: HTMLElement, opts: BoxViewOptions = {}): BoxView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', 'The box in 3D. Drag to turn it, scroll to zoom.');
  host.append(renderer.domElement);
  const labels = document.createElement('div');
  labels.className = 'lb-dims';
  host.append(labels);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 20;
  controls.maxDistance = 3000;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x796552, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-120, -160, 260);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(200, 120, 120);
  scene.add(fill);
  const grid = new THREE.GridHelper(1200, 120, 0xc0c7ce, 0xdce1e5);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.05;
  scene.add(grid);
  // A soft contact shadow so the box sits on the table rather than floating over the grid.
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(40,30,20,0.32)');
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.position.z = 0.02;
  scene.add(shadow);

  const box = new THREE.Group();
  scene.add(box);
  const dims = new THREE.Group();
  scene.add(dims);

  let placed: Placed[] = [];
  let last: BuildResult | null = null;
  let open = 0;
  let explode = false;
  let picking = false;
  let hovered: Placed | null = null;
  let firstFrame = true;
  let dimText: { x: string; y: string; z: string } | null = null;
  const dimLabels: { el: HTMLElement; at: THREE.Vector3 }[] = [];

  const draw = () => {
    renderer.render(scene, camera);
    placeLabels();
  };
  let fitDistance = 1;
  const zoomNow = () => fitDistance / Math.max(1e-6, camera.position.distanceTo(controls.target));
  controls.addEventListener('change', () => {
    draw();
    opts.onZoom?.(zoomNow());
  });
  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function clear() {
    box.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    box.clear();
    placed = [];
    hovered = null;
  }

  function lines(rings: [number, number][][], z: number, closed: boolean, material: THREE.LineBasicMaterial): THREE.LineSegments | null {
    const pts: number[] = [];
    for (const r of rings) {
      const n = closed ? r.length : r.length - 1;
      for (let i = 0; i < n; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        pts.push(a[0], a[1], z, b[0], b[1], z);
      }
    }
    if (!pts.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, material);
  }

  function pieceGroup(p: BuiltPiece, wood: string): Placed {
    const t = p.thickness;
    const group = new THREE.Group();
    const face = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.86 });
    const edge = new THREE.MeshStandardMaterial({ color: EDGE, roughness: 0.94 });
    const geometry = new THREE.ExtrudeGeometry(toShapes(p.nominal), { depth: t, bevelEnabled: false, curveSegments: 8 });
    geometry.translate(0, 0, -t / 2);
    const body = new THREE.Mesh(geometry, [face, edge]);
    body.userData.piece = p.id;
    group.add(body);
    if (p.engrave.length) {
      const skin = new THREE.Mesh(
        new THREE.ShapeGeometry(toShapes(p.engrave)),
        new THREE.MeshStandardMaterial({ color: BURN, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      skin.position.z = t / 2 + 0.02;
      group.add(skin);
    }
    const burn = new THREE.LineBasicMaterial({ color: BURN });
    const scoreClosed = lines(p.score.shapes.flat(), t / 2 + 0.03, true, burn);
    if (scoreClosed) group.add(scoreClosed);
    const scoreOpen = lines(p.score.paths, t / 2 + 0.03, false, burn);
    if (scoreOpen) group.add(scoreOpen);
    if (p.slits.length) {
      // Each slit a thin dark block through the sheet, a hair proud of both faces and the tip.
      const parts = p.slits.map((s) => {
        const a = s[0]!;
        const b = s[s.length - 1]!;
        const g = new THREE.BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.04, SLIT_WIDTH, t + 0.06);
        g.rotateZ(Math.atan2(b[1] - a[1], b[0] - a[0]));
        g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
        return g;
      });
      const merged = mergeGeometries(parts);
      for (const g of parts) g.dispose();
      if (merged) group.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: SLIT })));
    }
    group.matrixAutoUpdate = false;
    return { piece: p, group, body, face };
  }

  /** Where every piece sits now: its frame, opened by `open`, pulled out when exploded. */
  function pose() {
    if (!last) return;
    const c = new THREE.Vector3(last.outside.x / 2, last.outside.y / 2, last.outside.z / 2);
    const gap = Math.max(12, Math.max(last.outside.x, last.outside.y, last.outside.z) * 0.18);
    for (const pl of placed) {
      let f = frameOf(pl.piece.origin, pl.piece.u, pl.piece.v);
      f = moved(f, pl.piece.motion, open);
      if (explode) f = exploded(f, [c.x, c.y, c.z], pl.piece.role === 'body' ? gap : gap * 1.6);
      pl.group.matrix.copy(matrixOf(f));
      pl.group.matrixWorldNeedsUpdate = true;
    }
    paintPicks();
  }

  function paintPicks() {
    for (const pl of placed) {
      const isHover = picking && hovered === pl;
      pl.face.emissive.set(isHover ? PICK : '#000000');
      pl.face.emissiveIntensity = isHover ? 0.22 : 0;
    }
  }

  function frameCamera() {
    if (!last) return;
    const { x, y, z } = last.outside;
    const centre = new THREE.Vector3(x / 2, y / 2, z / 2);
    const d = Math.max(x, y, z, 30) * 2.6;
    camera.position.set(centre.x - d * 0.55, centre.y - d * 0.95, centre.z + d * 0.7);
    controls.target.copy(centre);
    fitDistance = camera.position.distanceTo(centre);
    controls.update();
  }

  // -- dimensions ------------------------------------------------------------------------------
  function buildDims() {
    dims.traverse((o) => {
      if (o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    dims.clear();
    labels.replaceChildren();
    dimLabels.length = 0;
    if (!last || !dimText || explode) return;
    const { x: L, y: W, z: H } = last.outside;
    const off = Math.max(6, Math.max(L, W, H) * 0.07);
    const tick = off * 0.35;
    const pts: number[] = [];
    const seg = (a: number[], b: number[]) => pts.push(...a, ...b);
    // Length along the front-bottom edge, width along the left-bottom edge, height up the
    // front-RIGHT corner — three edges the camera faces, the height kept away from the width so
    // their labels never meet at the front-left corner.
    seg([0, -off, 0], [L, -off, 0]);
    seg([0, -off - tick, 0], [0, -off + tick, 0]);
    seg([L, -off - tick, 0], [L, -off + tick, 0]);
    seg([-off, 0, 0], [-off, W, 0]);
    seg([-off - tick, 0, 0], [-off + tick, 0, 0]);
    seg([-off - tick, W, 0], [-off + tick, W, 0]);
    seg([L + off * 0.7, -off * 0.7, 0], [L + off * 0.7, -off * 0.7, H]);
    seg([L + off * 0.7 - tick, -off * 0.7, 0], [L + off * 0.7 + tick, -off * 0.7, 0]);
    seg([L + off * 0.7 - tick, -off * 0.7, H], [L + off * 0.7 + tick, -off * 0.7, H]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    dims.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5b6573 })));
    for (const [text, at] of [
      [dimText.x, new THREE.Vector3(L / 2, -off, 0)],
      [dimText.y, new THREE.Vector3(-off, W / 2, 0)],
      [dimText.z, new THREE.Vector3(L + off * 0.7, -off * 0.7, H / 2)],
    ] as const) {
      const el = document.createElement('span');
      el.className = 'lb-dims__label';
      el.textContent = text;
      labels.append(el);
      dimLabels.push({ el, at });
    }
  }

  function placeLabels() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    for (const { el, at } of dimLabels) {
      const p = at.clone().project(camera);
      const visible = p.z < 1 && p.z > -1;
      el.style.display = visible ? '' : 'none';
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // -- picking ---------------------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const hit = (ev: PointerEvent): Placed | null => {
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(placed.map((p) => p.body), false);
    const id = hits[0]?.object.userData.piece as string | undefined;
    return placed.find((p) => p.piece.id === id && p.piece.face) ?? null;
  };
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!picking || !down) return;
    const moved2 = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved2 > 5) return; // that was an orbit, not a click
    const p = hit(ev);
    if (p?.piece.face) opts.onPick?.(p.piece.face);
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!picking || ev.buttons) return;
    const p = hit(ev);
    if (p !== hovered) {
      hovered = p;
      renderer.domElement.style.cursor = p ? 'pointer' : '';
      paintPicks();
      draw();
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (hovered) {
      hovered = null;
      paintPicks();
      draw();
    }
  });

  // -- the lid's animation -----------------------------------------------------------------------
  let anim = 0;
  function animateOpen(to: number) {
    cancelAnimationFrame(anim);
    const from = open;
    const started = performance.now();
    const ms = 420;
    // The resting state first, so a hidden tab (no frames) still shows the lid where it ends.
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      open = from + (to - from) * e;
      pose();
      draw();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      open = to;
      pose();
      draw();
      return;
    }
    anim = requestAnimationFrame(step);
  }

  return {
    render(result, wood) {
      last = result;
      clear();
      for (const p of result.pieces) {
        const pl = pieceGroup(p, wood);
        placed.push(pl);
        box.add(pl.group);
      }
      const { x, y } = result.outside;
      shadow.scale.set(x * 1.9, y * 1.9, 1);
      shadow.position.set(x / 2, y / 2, 0.02);
      pose();
      buildDims();
      if (firstFrame) {
        frameCamera();
        firstFrame = false;
      }
      resize();
      draw();
    },
    setOpen(amount, instant = false) {
      if (instant) {
        open = amount;
        pose();
        draw();
      } else animateOpen(amount);
    },
    setExplode(on) {
      explode = on;
      pose();
      buildDims();
      draw();
    },
    setPicking(on) {
      picking = on;
      if (!on) {
        hovered = null;
        renderer.domElement.style.cursor = '';
      }
      paintPicks();
      draw();
    },
    setDimensions(text) {
      dimText = text;
      buildDims();
      draw();
    },
    resetView() {
      frameCamera();
      draw();
      opts.onZoom?.(zoomNow());
    },
    zoomBy(factor) {
      const dir = camera.position.clone().sub(controls.target);
      const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, dir.length() / factor));
      camera.position.copy(controls.target).add(dir.setLength(d));
      controls.update();
    },
    zoom: zoomNow,
    snapshot(width, height) {
      const size = new THREE.Vector2();
      renderer.getSize(size);
      const aspect = camera.aspect;
      const wasDims = dims.visible;
      dims.visible = false;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      dims.visible = wasDims;
      renderer.setSize(size.x, size.y);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      draw();
      return url;
    },
    dispose() {
      cancelAnimationFrame(anim);
      observer.disconnect();
      controls.dispose();
      clear();
      renderer.dispose();
      renderer.domElement.remove();
      labels.remove();
    },
  };
}
