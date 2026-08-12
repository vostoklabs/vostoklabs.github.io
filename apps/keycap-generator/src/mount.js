/**
 * The keycap generator, wrapped so a host can mount and unmount it.
 *
 * On the web this file's body ran on import: a browser tab loads the script once and never
 * unloads it, so there was nothing to call a `mount()` from. A desktop host is the opposite
 * — it mounts this into an element it owns, and unmounts it when the user opens a different
 * generator. Everything that used to be top-level is now inside `mount()`, and everything
 * that outlives a function call — the renderer, the observers, the document-level listener,
 * the tooltip parked on <body> — is handed back in the teardown.
 *
 * Skipping that teardown is not a tidiness problem. A leaked WebGL context per visit hits
 * the browser's limit at around sixteen, and it starts dropping the OLDEST context: the bug
 * shows up somewhere else entirely, long after the cause.
 *
 * The markup moved to template.js and the styles to style.css for the same reason — there
 * is no index.html in a hosted build. `main.js` is now the three-line web entry.
 */

import { BRAND } from '@vostok/brand';
import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import { topbarLinks, generatorHeader, qualityCallout, sidebarFooter, dialog, isDesktop, closeAllDialogs } from '@vostok/ui-kit';
import { mountPlatePicker, loadPlateChoice, getPlate } from '@vostok/plates';
import { createBuildPlate } from '@vostok/plates/three';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadKeycap } from './keycap.js';
import { parseSvg, logoFootprint } from './logo.js';
import { FONT_OPTIONS, importFontFile, parseLetter, loadBundledFonts } from './letter.js';
import { buildBodies } from './geometry.js';
import { initManifold, geomToManifold, manifoldToGeom, creaseNormals } from './manifold.js';
import { scaleStemComponentsXY, printMatrix } from './meshUtils.js';
import { buildThreeMF } from './export3mf.js';
import { buildObjMtl, objToArrayBuffer } from './exportObj.js';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from './lucideIcons.js';
import { zipSync } from 'fflate';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the real
// SDK glue in the MakerWorld build (`--mode makerworld`) — see vite.config.js.
import {
  MAKERLAB,
  initMakerlab,
  isReady as mlReady,
  can as mlCan,
  sdkExport,
  sdkToast,
} from 'virtual:makerlab';
// Pro Pack (MakerWorld-only, paid). Imported statically so the MAKERLAB=false constant lets
// the bundler drop the whole feature — panel, layouts and set builder — from the public build.
// Through the same kind of virtual seam as the SDK above, because src/pro/ is gitignored: the
// public build resolves this to a no-op stub and never needs those files to exist.
import { mountKeyboardSetPanel } from 'virtual:pro-pack';
import './style.css';
import { TEMPLATE } from './template.js';
import { setAssetBase, assetUrl } from './assets.js';

/**
 * @param {HTMLElement} container where the generator's DOM goes
 * @param {import('@vostok/ui-kit').DesktopHost} [host] absent on the web
 * @returns {() => void} teardown
 */
export function mount(container, host) {
  setAssetBase(host?.assetBase?.() ?? '');
  container.innerHTML = TEMPLATE;
  // Whoever owns the container, WE own its layout: it has to be a bounded flex column or
  // .vl-app sizes to its content and everything past the fold is clipped away (see .kc-root
  // in style.css). Applied here rather than as an `#app` rule so the desktop host — which
  // mounts us into an element of its own, with no id we could select — is covered too.
  container.classList.add('kc-root');

  /** Scoped to the container: two generators can be mid-teardown and mid-mount at once,
   *  and a bare getElementById would happily find the other one's node. */
  const $ = (id) => container.querySelector(`#${id}`);

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups = [];
  cleanups.push(() => container.classList.remove('kc-root'));



  // Mount the unified Vostok topbar — except in the MakerWorld build, where the host provides
  // its own chrome, and on the desktop, where the app around this one already owns the
  // window. In both, a bar of links out is a way out of the product.
  const oldTopbar = $('topbar');
  if (oldTopbar) {
    if (MAKERLAB || isDesktop()) {
      oldTopbar.remove();
    } else {
      oldTopbar.replaceWith(topbarLinks({
        githubUrl: BRAND.urls.github,
        boostUrl: BRAND.urls.makerworld,
      }));
    }
  }

  // Mount header and footer components
  const oldHeader = $('keycapAppHeader');
  if (oldHeader) {
    const header = generatorHeader({
      title: 'Keycap Legend Generator',
      description: 'Pick an icon or letter, size it, export a two-color 3MF.',
    });
    if (MAKERLAB) {
      // MakerWorld review feedback (2026-07-27): the Vostok Labs intro block is the most
      // prominent thing in the embed on first load, and the host would rather off-platform
      // promotion not sit in that spot. In the MakerLab build it moves to the BOTTOM-LEFT
      // — pinned below the left panel's scroll area — and is demoted to a compact muted
      // credit line (see .kc-credit-block in index.html). The host page already shows the
      // app's name, so the top-left heading isn't needed here.
      // The public build keeps the original top-left header.
      header.classList.add('kc-credit-block');
      oldHeader.remove();
      $('keycapCredit')?.append(header);
    } else {
      oldHeader.replaceWith(header);
    }
  }

  const keycapFooter = $('keycapFooter');
  if (keycapFooter) {
    const footer = sidebarFooter({
      formats: [{ id: '3mf', label: '3MF' }],
      onExport: () => $('export')?.click(),
      onSave: () => $('saveProj')?.click(),
      onLoad: (file) => {
        // On the desktop the kit's Load button hands us nothing and expects the host's own
        // picker to be opened instead — there is no file input in that story.
        if (host) { void openFromHost(); return; }
        if (!file) return;
        const projFile = $('projFile');
        if (projFile) {
          const dt = new DataTransfer();
          dt.items.add(file);
          projFile.files = dt.files;
          projFile.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      onHelp: () => {
        dialog({
          title: 'Keycap Legend Generator help',
          content: document.createTextNode('Pick an icon or custom letter, customize size, depth, rotation, and stem clearance, then click Download 3MF to export a print-ready file for your slicer.'),
          actions: [{ label: 'Got it', primary: true }],
        });
      },
      themeStorageKey: 'keycap_theme',
    });
    if (MAKERLAB) {
      footer.querySelector('.vl-action-row')?.remove();
    }
    keycapFooter.replaceWith(footer);
  }

  const busyEl = $('busy');
  const statusEl = $('status');

  function setStatus(msg, kind = '') {
    statusEl.textContent = msg;
    statusEl.className = kind;
  }

  // ---------------------------------------------------------------- three setup
  const viewport = $('viewport');
  // preserveDrawingBuffer (MakerWorld build only) lets us read the canvas with toDataURL() for
  // the host export cover image; the public build keeps the default for a touch less overhead.
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: MAKERLAB });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404654, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(12, 30, 18);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
  fill.position.set(-18, 10, -14);
  scene.add(fill);

  // Ground: a real Bambu build plate (or the plain grid) under the cap, shared
  // with every other generator. This scene is Y-up, so the plate is told which way
  // is up rather than being rotated here.
  const buildPlate = createBuildPlate(THREE, {
    theme: document.documentElement.getAttribute('data-theme') || 'dark',
    up: 'y',
    gridSize: 400,
    topZ: -0.06,
  });
  buildPlate.setChoice(loadPlateChoice());
  scene.add(buildPlate.object);

  function applyViewportTheme(theme) {
    renderer.setClearColor(theme === 'light' ? 0xf3f4f6 : 0x15171c);
    buildPlate.setTheme(theme);
  }
  applyViewportTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  mountPlatePicker(viewport, {
    setPlate: (choice) => buildPlate.setChoice(choice),
  });

  // Native keycap space is Z-up; rotate the display group so it looks right in Y-up.
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  scene.add(group);

  const capMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55, metalness: 0.0 });
  const logoMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.0 });
  const capMesh = new THREE.Mesh(undefined, capMat);
  const logoMesh = new THREE.Mesh(undefined, logoMat);
  // The stem is a constant body; only its material swaps (cap colour normally, legend
  // colour in shine-through). It shares the cap/logo materials so colour edits follow.
  const stemMesh = new THREE.Mesh(undefined, capMat);
  // Print orientation lives on its own group INSIDE the Z-up group. Some profiles can't be
  // printed the way they're modelled — a Choc cap has to stand on its bottom rib, because its
  // two stub stems won't survive being printed flat. Rotating here (and applying the same
  // transform on export) keeps the geometry itself canonical Z-up, so the legend carving, the
  // dish metadata and the size ceiling never have to know about it.
  const printGroup = new THREE.Group();
  printGroup.add(capMesh, logoMesh, stemMesh);
  group.add(printGroup);

  // Point the stem at the right shared material for the current shine-through state.
  // (Single-colour mode prints everything in the cap filament, so the stem stays capMat.)
  function updateStemMaterial() {
    stemMesh.material = $('through').checked ? logoMat : capMat;
  }

  // Rebuild the working stem from the authored one at the current fit tolerance, refreshing
  // the preview. `stemGeometry` (used by both exports) is the scaled body; at 0 tolerance it
  // IS the base solid (no copy). Safe to call before C exists (falls back to 0 tolerance).
  function applyStemTolerance() {
    const prev = stemGeometry;
    if (!baseStemGeometry) {
      stemGeometry = null;
    } else {
      const tol = stemTolValue;
      stemGeometry = Math.abs(tol) > 1e-4
        ? scaleStemComponentsXY(baseStemGeometry, tol)
        : baseStemGeometry;
    }
    if (prev && prev !== baseStemGeometry && prev !== stemGeometry) prev.dispose();
    stemMesh.geometry?.dispose();
    stemMesh.geometry = stemGeometry ? creaseNormals(stemGeometry) : undefined;
    updateStemMaterial();
  }

  function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    // A hidden or zero-sized viewport makes `0 / 0` — NaN — and a NaN aspect poisons the
    // projection matrix permanently, blanking the preview with nothing logged anywhere.
    // framedDistance() already guards this; resize() is where it actually gets in.
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Share of the narrower half-view the cap's bounding sphere should fill when framed. */
  const FRAME_FILL = 0.55;

  /**
   * Camera distance that makes a bounding sphere of `radius` fill `FRAME_FILL` of the view.
   * Uses whichever FOV is narrower — the vertical one is fixed, the horizontal one follows
   * the aspect — because that's the axis the cap will overflow first.
   */
  function framedDistance(radius) {
    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect > 0 && Number.isFinite(camera.aspect) ? camera.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    return radius / (FRAME_FILL * Math.tan(Math.min(vFov, hFov) / 2));
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(viewport);
  cleanups.push(() => resizeObserver.disconnect());

  // Height of the plate's top surface. This scene is Y-up, so "below the plate" is
  // a Y test, not the Z one the other generators use.
  const PLATE_TOP_Y = -0.06;

  // The frame loop has to be stoppable. Left running after unmount it keeps rendering into
  // a detached canvas forever — invisible, but still holding the context and still burning
  // a frame's worth of GPU work every 16ms, once per generator the user has ever opened.
  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    controls.update();
    // Looking up from underneath, an opaque plate hides the cap completely. Fade it
    // to a ghost rather than dropping it, so it never pops as you orbit past level.
    buildPlate.setGhosted(camera.position.y <= PLATE_TOP_Y);
    renderer.render(scene, camera);
  }
  animate();

  /**
   * Stop rendering entirely, for when something full-screen is covering this viewport.
   * Two render loops running at once is double the GPU cost for a scene nobody can see —
   * and it is the extra pressure that makes the browser drop a context.
   */
  function setPaused(paused) {
    if (paused) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      animate();
    }
  }

  cleanups.push(() => {
    cancelAnimationFrame(frame);
    clearTimeout(regenTimer); // a queued rebuild would otherwise fire into a torn-down scene
    controls.dispose();
    buildPlate.dispose?.();
    // forceContextLoss() is what actually hands the WebGL context back; dispose() alone
    // frees three's own objects and leaves the context alive.
    renderer.dispose();
    renderer.forceContextLoss();
  });

  // ---------------------------------------------------------------- state
  let meta = null;            // keycap metadata from convert step
  let shellGeometry = null;   // cap shell geometry, stem removed (native mm)
  let baseStemGeometry = null;// switch stem as authored (clean solid); source for the tolerance scale
  let stemGeometry = null;    // stem after fit-tolerance scaling — the body used for preview + export
  let homingBumpGeometry = null; // homing bump geometry
  let currentLegend = null;   // { contours, box, name }
  let lastBodies = null;      // { keycapGeometry, logoGeometry } for export
  let lastIconSelection = null;
  let currentMode = 'icon';
  let currentUnit = 1;        // size of the active keycap (drives the letter limit)

  // debug handles (harmless; used for automated verification)
  window.__app = {
    THREE, scene, camera, renderer, capMesh, logoMesh, stemMesh, buildThreeMF, buildObjMtl,
    get exportParts() {
      return lastBodies
        ? buildExportParts(lastBodies, $('capColor').value, $('logoColor').value, $('through').checked)
        : null;
    },
    get meta() { return meta; },
    get lastBodies() { return lastBodies; },
    get shellGeometry() { return shellGeometry; },
    get stemGeometry() { return stemGeometry; },
  };

  // paired range + number input -> single value with onChange
  function link(rangeId, numId, onChange) {
    const r = $(rangeId);
    const n = $(numId);
    n.value = r.value;
    r.addEventListener('input', () => { n.value = r.value; onChange(); });
    n.addEventListener('input', () => { r.value = n.value; onChange(); });
    return {
      get: () => parseFloat(r.value),
      set: (v) => { r.value = v; n.value = v; },
      setMax: (v) => { r.max = v; },
    };
  }

  const C = {
    size: link('size', 'sizeNum', scheduleRegen),
    depth: link('depth', 'depthNum', scheduleRegen),
    rot: link('rot', 'rotNum', scheduleRegen),
    offx: link('offx', 'offxNum', scheduleRegen),
    offy: link('offy', 'offyNum', scheduleRegen),
  };

  // Stem fit stepper (− / +): a signed mm offset that rescales only the stem body (no cap CSG
  // rebuild), so it lives outside `C` and drives applyStemTolerance directly.
  let stemTolValue = 0;
  const STEM_TOL_MIN = -0.4, STEM_TOL_MAX = 0.4, STEM_TOL_STEP = 0.02;
  function renderStemTol() {
    const v = stemTolValue;
    $('stemTolVal').textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} mm`;
  }
  function setStemTol(v) {
    stemTolValue = Math.round(Math.min(STEM_TOL_MAX, Math.max(STEM_TOL_MIN, v)) * 100) / 100;
    renderStemTol();
  }
  $('stemTolMinus').addEventListener('click', () => { setStemTol(stemTolValue - STEM_TOL_STEP); applyStemTolerance(); });
  $('stemTolPlus').addEventListener('click', () => { setStemTol(stemTolValue + STEM_TOL_STEP); applyStemTolerance(); });
  renderStemTol();
  $('mirror').addEventListener('change', scheduleRegen);
  $('homingBump').addEventListener('change', scheduleRegen);
  // Shine-through and single-colour are mutually exclusive: one prints the legend in a second
  // (transparent) filament, the other engraves it in the single cap filament.
  $('through').addEventListener('change', () => {
    if ($('through').checked) $('single').checked = false;
    applyModeFlags(); scheduleRegen();
  });
  $('single').addEventListener('change', () => {
    if ($('single').checked) $('through').checked = false;
    applyModeFlags(); scheduleRegen();
  });
  $('capColor').addEventListener('input', () => { capMat.color.set($('capColor').value); });
  $('logoColor').addEventListener('input', () => { logoMat.color.set($('logoColor').value); });

  // ---------------------------------------------------------------- resets
  // Stock values for the per-section reset buttons. `size` is replaced at boot
  // once we know the sensible default for this cap's geometry.
  const DEFAULTS = {
    size: 8, depth: 0.5, rot: 0, offx: 0, offy: 0, stemTol: 0,
    mirror: false, through: false, single: false, homingBump: false,
    capColor: '#1c1c1e', logoColor: '#f2f2f2',
  };

  // Reflect the current shine-through / single-colour state on dependent inputs.
  // Shine-through prints the legend through the wall, so depth no longer applies.
  // Single-colour engraves the legend in the cap filament, so the legend colour is moot.
  function applyModeFlags() {
    $('depth').disabled = $('through').checked;
    $('depthNum').disabled = $('through').checked;
    $('logoColor').disabled = $('single').checked;
    updateStemMaterial();
  }

  function resetPlacement() {
    C.size.set(DEFAULTS.size);
    C.depth.set(DEFAULTS.depth);
    C.rot.set(DEFAULTS.rot);
    C.offx.set(DEFAULTS.offx);
    C.offy.set(DEFAULTS.offy);
    setStemTol(DEFAULTS.stemTol);
    applyStemTolerance();
    $('mirror').checked = DEFAULTS.mirror;
    $('through').checked = DEFAULTS.through;
    $('single').checked = DEFAULTS.single;
    $('homingBump').checked = DEFAULTS.homingBump;
    applyModeFlags();
    scheduleRegen();
  }

  function resetColors() {
    $('capColor').value = DEFAULTS.capColor;
    $('logoColor').value = DEFAULTS.logoColor;
    capMat.color.set(DEFAULTS.capColor);
    logoMat.color.set(DEFAULTS.logoColor);
  }

  function resetLegend() {
    if (currentMode !== 'icon') setLegendMode('icon');
    searchEl.value = '';
    rebuildGallery();
    const first = defaultLucideIcon();
    if (first) selectIcon(first.el || galleryEl.firstElementChild, first.getText, first.name);
  }

  $('resetPlacement').addEventListener('click', resetPlacement);
  $('resetColors').addEventListener('click', resetColors);
  $('resetLegend').addEventListener('click', resetLegend);

  // ---------------------------------------------------------------- geometry
  function currentOpts() {
    return {
      widthMM: C.size.get(),
      depth: C.depth.get(),
      centerX: meta.center[0] + C.offx.get(),
      centerY: meta.center[1] + C.offy.get(),
      rotationDeg: C.rot.get(),
      mirror: $('mirror').checked,
      through: $('through').checked,
      singleColor: $('single').checked,
      homingBump: $('homingBump').checked,
      homingBumpGeom: homingBumpGeometry,
    };
  }

  let regenTimer = null;
  let running = false;
  function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(doRegen, 200);
  }

  async function doRegen() {
    if (!currentLegend || !meta || !shellGeometry) return;
    if (running) { scheduleRegen(); return; }
    running = true;
    busyEl.style.display = 'block';
    await new Promise((r) => setTimeout(r, 0)); // let the spinner paint

    try {
      const fp = logoFootprint(currentLegend.box, C.size.get());
      const { keycapGeometry: capG, logoGeometry: logoG, surfaceVariation } =
        await buildBodies(shellGeometry, meta, currentLegend, currentOpts());

      // Preview meshes get creased normals (cosmetic); export keeps the clean indexed solids.
      capMesh.geometry?.dispose();
      logoMesh.geometry?.dispose();
      lastBodies?.keycapGeometry?.dispose();
      lastBodies?.logoGeometry?.dispose();
      capMesh.geometry = creaseNormals(capG);
      // Single-colour mode returns no legend body — hide the legend mesh; the icon is now a
      // recess carved into the cap geometry itself.
      if (logoG) {
        logoMesh.geometry = creaseNormals(logoG);
        logoMesh.visible = true;
      } else {
        logoMesh.geometry = undefined;
        logoMesh.visible = false;
      }
      updateStemMaterial();
      lastBodies = { keycapGeometry: capG, logoGeometry: logoG };

      $('export').disabled = false;
      const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
      if (Math.max(fp.w, fp.h) > room) {
        setStatus(`Heads up: legend (${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm) is larger than the top (~${room.toFixed(1)} mm) and will be clipped.`, 'warn');
      } else if (surfaceVariation > 0.4) {
        setStatus(`Ready · legend ${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm. Note: top is curved (${surfaceVariation.toFixed(1)} mm). Keep it small so it stays flush.`, 'warn');
      } else if ($('through').checked) {
        setStatus(`Ready · legend ${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm · shine-through: legend + stem print in the legend filament (use transparent to light up).`);
      } else if ($('single').checked) {
        setStatus(`Ready · legend ${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm · single colour: legend engraved ${C.depth.get()} mm deep, prints in one filament.`);
      } else {
        setStatus(`Ready · legend ${fp.w.toFixed(1)}×${fp.h.toFixed(1)} mm · ${C.depth.get()} mm deep.`);
      }
    } catch (e) {
      console.error(e);
      $('export').disabled = true;
      setStatus('Could not generate this legend (try a simpler icon/letter or smaller size).', 'err');
    } finally {
      busyEl.style.display = 'none';
      running = false;
    }
  }

  // ---------------------------------------------------------------- icons
  async function selectIcon(el, getText, name) {
    container.querySelectorAll('.icon.active').forEach((n) => n.classList.remove('active'));
    el.classList.add('active');
    setStatus('Loading icon…');
    try {
      currentLegend = { ...parseSvg(await getText()), name };
      lastIconSelection = { el, getText, name };
      updateSizeMax();
      doRegen();
    } catch (e) {
      console.error(e);
      setStatus(`Couldn't read “${name}”.`, 'err');
    }
  }

  function makeIconEl(thumbUrl, getText, name) {
    const el = document.createElement('div');
    el.className = 'icon';
    el.title = name;
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = name;
    el.appendChild(img);
    el.addEventListener('click', () => selectIcon(el, getText, name));
    return el;
  }

  function setLegendMode(mode) {
    currentMode = mode;
    $('iconMode').classList.toggle('active', mode === 'icon');
    $('uploadMode').classList.toggle('active', mode === 'upload');
    $('letterMode').classList.toggle('active', mode === 'letter');
    $('iconPanel').hidden = mode !== 'icon';
    $('uploadPanel').hidden = mode !== 'upload';
    $('letterPanel').hidden = mode !== 'letter';

    if (mode === 'letter') {
      selectLetter();
    } else if (lastIconSelection) {
      selectIcon(lastIconSelection.el, lastIconSelection.getText, lastIconSelection.name);
    }
  }

  // Bigger caps fit longer legends; 1u stays at 4 characters, scaling up with the unit.
  function letterMaxLen(unit) {
    return Math.max(4, Math.round((unit || 1) * 4));
  }

  // Push the current unit's character cap onto the letter input, trimming any overflow.
  function applyLetterLimit() {
    const input = $('letterText');
    const max = letterMaxLen(currentUnit);
    input.maxLength = max;
    if (input.value.length > max) {
      input.value = input.value.slice(0, max);
      if (currentMode === 'letter') selectLetter();
    }
  }

  function selectLetter() {
    container.querySelectorAll('.icon.active').forEach((n) => n.classList.remove('active'));
    try {
      currentLegend = parseLetter($('letterText').value, $('fontSelect').value, letterMaxLen(currentUnit));
      updateSizeMax();
      setStatus('Generating letter…');
      scheduleRegen();
    } catch (e) {
      console.error(e);
      currentLegend = null;
      $('export').disabled = true;
      setStatus(e.message || 'Could not read this letter.', 'err');
    }
  }

  /** Each entry renders in its own typeface — scanning 30 font names set in the
   *  same UI font tells you nothing about which one you actually want. */
  function addFontOption(font) {
    const option = document.createElement('option');
    option.value = font.id;
    option.textContent = font.name;
    if (font.cssFamily) option.style.fontFamily = font.cssFamily;
    if (font.cssWeight) option.style.fontWeight = font.cssWeight;
    // Display faces vary wildly in x-height; a common size keeps the list scannable.
    option.style.fontSize = '15px';
    $('fontSelect').appendChild(option);
  }

  for (const font of FONT_OPTIONS) addFontOption(font);
  loadBundledFonts(addFontOption); // append the bundled open-source fonts as they parse

  $('iconMode').addEventListener('click', () => setLegendMode('icon'));
  $('uploadMode').addEventListener('click', () => setLegendMode('upload'));
  $('letterMode').addEventListener('click', () => setLegendMode('letter'));
  $('letterText').addEventListener('input', selectLetter);
  $('fontSelect').addEventListener('change', selectLetter);

  $('fontUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const font = await importFontFile(file);
      addFontOption(font);
      $('fontSelect').value = font.id;
      setLegendMode('letter');
      setStatus(`Imported font: ${font.name}`);
    } catch (error) {
      console.error(error);
      setStatus('Could not import this font. Try a TTF, OTF, or typeface JSON file.', 'err');
    } finally {
      e.target.value = '';
    }
  });

  // Curated set shown first when no search is active — picked for keycap legends:
  // clipboard/edit ops, media keys, navigation, and common app-launcher symbols.
  const POPULAR_LUCIDE = [
    // File & clipboard
    'copy', 'clipboard', 'clipboard-paste', 'scissors', 'trash-2', 'save',
    'file', 'files', 'folder', 'folder-open', 'archive', 'download', 'upload',
    // Edit
    'undo-2', 'redo-2', 'search', 'replace', 'eraser', 'pencil', 'type',
    'bold', 'italic', 'underline',
    // Navigation
    'home', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
    'corner-down-left', 'chevron-up', 'chevron-down',
    // Keys & input
    'keyboard', 'mouse', 'command', 'delete',
    // Media
    'play', 'pause', 'skip-back', 'skip-forward', 'volume-2', 'volume-x',
    'mic', 'mic-off', 'music', 'headphones',
    // Display / system
    'sun', 'moon', 'monitor', 'lock', 'unlock', 'eye', 'eye-off',
    'power', 'wifi', 'bluetooth', 'battery',
    // Apps
    'terminal', 'code', 'settings', 'bell', 'calendar', 'mail',
    'message-circle', 'phone', 'camera', 'image',
    // Symbols & fun
    'star', 'heart', 'bookmark', 'flag', 'check', 'x', 'plus', 'minus',
    'refresh-cw', 'rotate-cw', 'flame', 'zap', 'rocket', 'ghost', 'skull',
    'coffee', 'gamepad-2', 'trophy', 'crown',
  ];

  const GALLERY_PAGE = 240;
  const galleryEl = $('gallery');
  const uploadGalleryEl = $('uploadGallery');
  const searchEl = $('iconSearch');
  const searchClearEl = $('iconSearchClear');
  const countEl = $('iconCount');

  let lucideShown = 0;       // how many items rendered for the current query
  let lucideMatches = [];    // current filtered Lucide list
  let moreBtn = null;

  function rankLucide(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const popularSet = new Set(POPULAR_LUCIDE);
      const popular = POPULAR_LUCIDE
        .map((name) => LUCIDE_ICONS.find((ic) => ic.name === name))
        .filter(Boolean);
      const rest = LUCIDE_ICONS.filter((ic) => !popularSet.has(ic.name));
      return popular.concat(rest);
    }
    const out = [];
    for (const ic of LUCIDE_ICONS) {
      const i = ic.name.indexOf(q);
      if (i === -1) continue;
      // exact match → 0, starts-with → 1, contains → 2 (then alpha)
      const rank = ic.name === q ? 0 : i === 0 ? 1 : 2;
      out.push({ ic, rank });
    }
    out.sort((a, b) => a.rank - b.rank || a.ic.name.localeCompare(b.ic.name));
    return out.map((o) => o.ic);
  }

  function renderLucidePage() {
    if (moreBtn) { moreBtn.remove(); moreBtn = null; }
    const end = Math.min(lucideShown + GALLERY_PAGE, lucideMatches.length);
    const frag = document.createDocumentFragment();
    for (let i = lucideShown; i < end; i++) {
      const ic = lucideMatches[i];
      const svgText = buildSvg(ic.node);
      const el = makeIconEl(svgDataUrl(svgText), async () => svgText, ic.name);
      frag.appendChild(el);
    }
    galleryEl.appendChild(frag);
    lucideShown = end;

    if (lucideShown < lucideMatches.length) {
      moreBtn = document.createElement('button');
      moreBtn.id = 'galleryMore';
      moreBtn.type = 'button';
      moreBtn.textContent = `Show ${Math.min(GALLERY_PAGE, lucideMatches.length - lucideShown)} more (${lucideMatches.length - lucideShown} hidden)`;
      moreBtn.addEventListener('click', renderLucidePage);
      galleryEl.appendChild(moreBtn);
    }
    updateCount();
  }

  function updateCount() {
    const total = lucideMatches.length;
    if (total === 0) {
      countEl.textContent = 'No icons match.';
    } else {
      const visible = Math.min(lucideShown, total);
      countEl.textContent = searchEl.value.trim()
        ? `${total} match${total === 1 ? '' : 'es'}` + (visible < total ? ` · showing ${visible}` : '')
        : `${total} icons` + (visible < total ? ` · showing ${visible}` : '');
    }
  }

  function rebuildGallery() {
    galleryEl.innerHTML = '';
    lucideShown = 0;
    lucideMatches = rankLucide(searchEl.value);
    searchClearEl.style.display = searchEl.value ? 'block' : 'none';
    renderLucidePage();
  }

  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(rebuildGallery, 80);
  });
  searchClearEl.addEventListener('click', () => {
    searchEl.value = '';
    rebuildGallery();
    searchEl.focus();
  });

  function defaultLucideIcon() {
    const first = LUCIDE_ICONS.find((ic) => ic.name === POPULAR_LUCIDE[0]) || LUCIDE_ICONS[0];
    if (!first) return null;
    const svgText = buildSvg(first.node);
    // Find rendered tile so we can mark it active.
    const idx = lucideMatches.indexOf(first);
    const el = idx >= 0 && idx < lucideShown ? galleryEl.children[idx] : null;
    return { el, getText: async () => svgText, name: first.name };
  }

  let uploadEmptyEl = null;
  function refreshUploadEmptyState() {
    const empty = uploadGalleryEl.querySelectorAll('.icon').length === 0;
    if (empty && !uploadEmptyEl) {
      uploadEmptyEl = document.createElement('div');
      uploadEmptyEl.id = 'uploadGalleryEmpty';
      uploadEmptyEl.textContent = 'No SVGs yet. Drop files in public/icons/ or use the upload button.';
      uploadGalleryEl.appendChild(uploadEmptyEl);
    } else if (!empty && uploadEmptyEl) {
      uploadEmptyEl.remove();
      uploadEmptyEl = null;
    }
  }

  async function loadBundledSvgs() {
    const list = await fetch(assetUrl('icons-manifest.json')).then((r) => r.json()).catch(() => []);
    for (const { name, file } of list) {
      const el = makeIconEl(assetUrl(file), () => fetch(assetUrl(file)).then((r) => r.text()), name);
      uploadGalleryEl.appendChild(el);
    }
    refreshUploadEmptyState();
  }

  $('upload').addEventListener('change', async (e) => {
    let firstEl = null;
    for (const file of e.target.files) {
      const text = await file.text();
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      const el = makeIconEl(url, async () => text, file.name.replace(/\.svg$/i, ''));
      uploadGalleryEl.appendChild(el);
      if (!firstEl) firstEl = el;
    }
    refreshUploadEmptyState();
    if (firstEl) {
      setLegendMode('upload');
      firstEl.click();
    }
    e.target.value = '';
  });

  // ---------------------------------------------------------------- export
  // Assemble the 3MF body list (cap, legend, and stem) for one set of carved bodies.
  // Shared by the single-cap export and the full-alphabet batch so colour/filament
  // assignment stays identical. The stem rides on the legend filament in shine-through,
  // otherwise the keycap filament.
  function buildExportParts(bodies, capColor, logoColor, through) {
    const parts = [
      { name: 'Keycap', color: capColor, extruder: 1, geom: bodies.keycapGeometry },
    ];
    // Single-colour mode has no separate legend body (it's a recess in the cap).
    if (bodies.logoGeometry) {
      parts.push({ name: 'Legend', color: logoColor, extruder: 2, geom: bodies.logoGeometry });
    }
    if (stemGeometry) {
      parts.push({
        name: 'Stem',
        color: through ? logoColor : capColor,
        extruder: through ? 2 : 1,
        geom: stemGeometry,
      });
    }
    return orientForPrint(parts);
  }

  /**
   * Lay the parts out the way the profile has to be printed — the same rotation the preview
   * applies via `printGroup`, so what the user sees on the plate is what lands in the file.
   *
   * Clones before transforming: these geometries are the live preview meshes.
   */
  function orientForPrint(parts) {
    const m = printMatrix(currentProfile, meta);
    if (!m) return parts;
    return parts.map((p) => ({ ...p, geom: p.geom.clone().applyMatrix4(m) }));
  }

  // 1x1 transparent PNG — last-resort cover if the canvas can't be read (coverImage is a
  // required SDK field). In practice preserveDrawingBuffer makes the real capture succeed.
  const BLANK_COVER =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // Grab the live preview as a PNG data URL for the MakerLab export cover. Render once first so
  // the buffer holds the current frame at the moment of capture.
  function captureCover() {
    try {
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      return url && url.length > 128 ? url : BLANK_COVER;
    } catch (e) {
      console.error('Cover capture failed:', e);
      return BLANK_COVER;
    }
  }

  /**
   * Deliver the finished keycap.
   *
   * In the MakerWorld build, when embedded, follow the SDK guide's OBJ route: hand the host
   * an OBJ (one `o` object per filament region) plus an MTL carrying the two colours, and the
   * host converts it into the 3MF the user receives. Per MakerWorld's 2026-07-27 review this
   * replaces the previous ZIP-with-our-own-.3mf-inside approach.
   *
   * Standalone (public site, or the built app opened outside the host) still downloads the
   * two-colour .3mf we build ourselves — unchanged.
   *
   * @param {() => Array} makeParts  Deferred so the standalone path doesn't pay for OBJ work
   *                                 and the host path doesn't pay for 3MF zipping.
   */
  async function deliverModel(makeParts, baseName, downloadMsg, description) {
    if (MAKERLAB && mlReady() && mlCan('export')) {
      setStatus('Sending to MakerLab…');
      try {
        const { obj, mtl } = buildObjMtl(makeParts(), { mtlFileName: `${baseName}.mtl` });
        const result = await sdkExport({
          artifacts: [
            {
              fileName: `${baseName}.obj`,
              format: 'obj',
              buffer: objToArrayBuffer(obj),
              mtl,
              coverImage: captureCover(),
              description,
            },
          ],
        });
        if (result.success) {
          setStatus('Exported to MakerLab ✓');
          sdkToast({ message: 'Keycap exported to MakerLab', type: 'success' });
        } else {
          setStatus(`Export failed: ${result.errorMessage ?? result.errorCode}`, 'err');
          sdkToast({ message: 'Export failed', type: 'error' });
        }
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return;
    }

    const blob = buildThreeMF(makeParts());

    if (host) {
      // The whole reason the desktop bundle exists: the file does not land in Downloads for
      // you to go and find, it lands in the library and shows up in the grid.
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { indexed } = await host.exportToLibrary(
          { name: `${baseName}.3mf`, bytes },
          { designer: 'Keycap Legend Generator' },
        );
        setStatus(indexed ? 'Exported to your library ✓' : `Exported as ${baseName}.3mf ✓`);
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return;
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}.3mf`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(downloadMsg);
  }

  $('export').addEventListener('click', async () => {
    if (!lastBodies) return;
    const legendSlug = (currentLegend?.name || 'legend').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const baseName = `keycap-${legendSlug}${profileSlug() ? '-' + profileSlug() : ''}`;
    await deliverModel(
      () => buildExportParts(lastBodies, $('capColor').value, $('logoColor').value, $('through').checked),
      baseName,
      $('single').checked
        ? 'Exported 3MF ✓  Single-colour cap with an engraved legend, one filament.'
        : 'Exported 3MF ✓  Open in your slicer and assign two filaments.',
      'Two-colour keycap, made with the Keycap Legend Generator.'
    );
  });

  // Export the bare cap (uncarved shell + stem) in a single colour — no legend.
  // Works for any size; uses the loaded shell directly (already a clean indexed solid).
  $('exportBlank').addEventListener('click', async () => {
    if (!shellGeometry) return;
    const makeParts = () => {
      const capColor = $('capColor').value;
      const parts = [{ name: 'Keycap', color: capColor, extruder: 1, geom: shellGeometry }];
      if (stemGeometry) parts.push({ name: 'Stem', color: capColor, extruder: 1, geom: stemGeometry });
      return parts;
    };

    const sizeLabel = ($('unitSelect').value || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const tags = [profileSlug(), sizeLabel].filter(Boolean).join('-');
    const baseName = `keycap-blank${tags ? '-' + tags : ''}`;
    await deliverModel(
      makeParts,
      baseName,
      'Exported blank keycap ✓  Single-colour cap with no legend.',
      'Blank keycap, made with the Keycap Legend Generator.'
    );
  });

  // -------------------------------------------------------- full alphabet set
  // Batch-generate A–Z keycaps in the current font + placement/colour settings and
  // download them as a single ZIP of 3MFs. 1u-only for now (button is disabled on
  // other sizes). Each letter is carved with the same buildBodies path as the live
  // preview, so what you set up for one letter is what every cap in the pack gets.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alphabetBtn = $('alphabetSet');
  const alphabetHelp = $('alphabetHelp');

  // The set only makes sense for a 1u cap right now; reflect that on the button.
  function updateAlphabetAvailability() {
    const ok = currentUnit === 1;
    alphabetBtn.disabled = !ok || running;
    alphabetHelp.textContent = ok
      ? 'Generates 26 keycaps (A–Z) in the current font & settings, zipped as 3MF files.'
      : 'Full alphabet set is available for the 1u keycap only. Switch size to 1u to enable.';
  }

  async function generateAlphabetSet() {
    if (currentUnit !== 1 || !meta || !shellGeometry || running) return;

    const fontId = $('fontSelect').value;
    const fontName = FONT_OPTIONS.find((f) => f.id === fontId)?.name || 'font';
    const opts = currentOpts();
    const capColor = $('capColor').value;
    const logoColor = $('logoColor').value;
    const through = $('through').checked;

    // Hold the regen lock so live preview rebuilds don't run Manifold concurrently.
    clearTimeout(regenTimer);
    running = true;
    alphabetBtn.disabled = true;
    busyEl.style.display = 'block';
    const files = {};
    // Host path: one OBJ per letter, handed over as a multi-plate artifact (SDK guide,
    // "Export OBJ (Multi-Plate + MTL Materials)") — the host turns the 26 plates into a
    // single multi-plate 3MF. Every letter shares the same two colours, so one MTL covers
    // the whole set. Standalone path still zips 26 of our own .3mf files.
    const toHost = MAKERLAB && mlReady() && mlCan('export');
    const plates = [];
    let plateMtl = '';

    try {
      for (let i = 0; i < ALPHABET.length; i++) {
        const ch = ALPHABET[i];
        setStatus(`Generating alphabet set… ${ch} (${i + 1}/26)`);
        busyEl.textContent = `generating ${ch} (${i + 1}/26)…`;
        await new Promise((r) => setTimeout(r, 0)); // let the spinner/status paint

        const legend = parseLetter(ch, fontId, 1);
        const bodies = await buildBodies(shellGeometry, meta, legend, opts);
        const parts = buildExportParts(bodies, capColor, logoColor, through);
        if (toHost) {
          const { obj, mtl } = buildObjMtl(parts, { mtlFileName: 'keycap-alphabet.mtl' });
          plates.push(objToArrayBuffer(obj));
          plateMtl = mtl;
        } else {
          files[`keycap-${ch}.3mf`] = new Uint8Array(await buildThreeMF(parts).arrayBuffer());
        }
        bodies.keycapGeometry.dispose();
        bodies.logoGeometry?.dispose();
      }

      const fontSlug = fontName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const baseName = `keycap-alphabet-${fontSlug}${profileSlug() ? '-' + profileSlug() : ''}`;

      if (toHost) {
        setStatus('Sending alphabet set to MakerLab…');
        const result = await sdkExport({
          artifacts: [
            {
              fileName: `${baseName}.obj`,
              format: 'obj',
              buffer: plates, // ArrayBuffer[] — one print plate per letter
              mtl: plateMtl,
              coverImage: captureCover(),
              description: 'Full A–Z keycap alphabet set (26 print plates).',
            },
          ],
        });
        if (result.success) {
          setStatus('Exported alphabet set to MakerLab ✓  26 keycaps (A–Z).');
          sdkToast({ message: 'Alphabet set exported', type: 'success' });
        } else {
          setStatus(`Export failed: ${result.errorMessage ?? result.errorCode}`, 'err');
          sdkToast({ message: 'Export failed', type: 'error' });
        }
      } else {
        // 3MFs are already deflated zips — store (level 0) rather than re-compress.
        const zipped = zipSync(files, { level: 0 });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
        a.download = `${baseName}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus('Exported full alphabet set ✓  26 keycaps (A–Z) zipped. Open each 3MF in your slicer.');
      }
    } catch (e) {
      console.error(e);
      setStatus('Could not generate the alphabet set (try a simpler font or smaller size).', 'err');
    } finally {
      busyEl.textContent = 'generating…';
      busyEl.style.display = 'none';
      running = false;
      updateAlphabetAvailability();
      scheduleRegen(); // refresh the live preview to the current inputs after the batch
    }
  }

  alphabetBtn.addEventListener('click', generateAlphabetSet);

  // ---------------------------------------------------------------- keycap swap
  // Install a freshly loaded keycap: dispose the old geometry, clean the new stem,
  // re-frame the camera, and reset the size to a sensible default for this cap.
  // Called at boot and whenever the size dropdown changes. (Manifold must be ready.)
  // Max legend size: a single icon (≈square) is capped by the cap's short side, but a wide
  // legend (multi-letter text) can stretch along the cap's long side. Scale the ceiling by the
  // legend's aspect ratio so long words on wide caps/spacebars can use the room available.
  function updateSizeMax() {
    if (!meta) return;
    const capLong = Math.max(meta.topExtent[0], meta.topExtent[1]);
    const capShort = Math.min(meta.topExtent[0], meta.topExtent[1]);
    let maxW = capShort; // square / no legend yet
    const b = currentLegend?.box;
    if (b) {
      const lng = Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
      const sht = Math.min(b.max.x - b.min.x, b.max.y - b.min.y);
      const aspect = sht > 1e-6 ? lng / sht : 1;
      maxW = Math.min(capLong, capShort * aspect);
    }
    C.size.setMax((maxW * 0.95).toFixed(1));
  }

  // Symmetric ± range for a nudge slider + its number box.
  function setNudgeRange(rangeId, numId, m) {
    $(rangeId).min = -m; $(rangeId).max = m;
    $(numId).min = -m; $(numId).max = m;
  }

  function setKeycap(kc) {
    // Free everything tied to the previous cap before swapping references.
    shellGeometry?.dispose();
    if (stemGeometry && stemGeometry !== baseStemGeometry) stemGeometry.dispose();
    baseStemGeometry?.dispose();
    stemGeometry = null;
    baseStemGeometry = null;
    capMesh.geometry?.dispose();
    stemMesh.geometry?.dispose();

    shellGeometry = kc.shellGeometry;
    meta = kc.meta;
    capMesh.geometry = shellGeometry.clone(); // shown until the first regen carves it

    // Run the stem(s) through Manifold once so they're a watertight, welded, manifold solid
    // (the raw STEP tessellation has split vertices) — clean base for the fit-tolerance scale.
    if (kc.stemGeometry) {
      const m = geomToManifold(kc.stemGeometry);
      baseStemGeometry = manifoldToGeom(m); // clean indexed solid, as authored
      m.delete();
      kc.stemGeometry.dispose();
    }
    applyStemTolerance(); // derive stemGeometry + preview at the current fit tolerance

    // Centre every cap on the world origin so it sits on the grid regardless of its native
    // STEP coordinates (the larger caps are modelled off-origin). The group holds cap + legend
    // + stem, so they all shift together. Group is Z-up rotated; position is world space.
    //
    // A profile printed in a different orientation is placed by printGroup instead, in model
    // space, because the rotation changes which axis rests on the plate.
    const rotDeg = currentProfile?.printRotateX ?? 0;
    printGroup.rotation.x = (rotDeg * Math.PI) / 180;
    if (rotDeg) {
      // +90° about model X maps (x, y, z) -> (x, -z, y). The cap then spans y' [-topZ, 0] and
      // z' [bbox.min[1], bbox.max[1]], so: centre x, centre the (now horizontal) thickness,
      // and drop it until the lowest rib touches the plate.
      printGroup.position.set(-meta.center[0], meta.topZ / 2, -meta.bbox.min[1]);
      group.position.set(0, 0, 0);
    } else {
      printGroup.position.set(0, 0, 0);
      group.position.set(-meta.center[0], 0, meta.center[1]);
    }
    // How tall the cap actually stands, for the camera target: its Z height normally, but the
    // depth of the cap once it's tipped onto its rib.
    const standHeight = rotDeg ? meta.bbox.max[1] - meta.bbox.min[1] : meta.topZ;

    // Frame the camera on the (now origin-centred) cap; pull the distance back proportionally
    // so wide caps (spacebars) still fit the viewport.
    const spanX = meta.bbox.max[0] - meta.bbox.min[0];
    const spanY = meta.bbox.max[1] - meta.bbox.min[1];
    // Aspect has to be current BEFORE the distance is computed: the framing below reads
    // camera.aspect, and on the first cap the camera is still at its placeholder 1:1.
    resize();
    // MakerWorld review feedback (2026-07-27): the default framing filled the embed, so the
    // cap read as the whole app before the panels did.
    //
    // The first attempt at this just scaled the cap's width by a bigger multiplier, which
    // didn't hold: a multiplier says nothing about how much of the VIEW the cap covers, so
    // the result still depended entirely on the viewport's shape, and the embed (wide and
    // short, with the host's chrome eating height) kept landing far closer than intended.
    //
    // Fit properly instead. Take the cap's bounding sphere and put it at a fixed fraction of
    // whichever field of view is narrower — vertical on a wide viewport, horizontal on a tall
    // one — so the cap covers the same share of the stage no matter how the host sizes us.
    // Zoom is untouched, so pulling straight back in is one scroll away.
    //
    // This is the framing in EVERY build. It was fenced behind MAKERLAB while it was being
    // proven in the embed, but the multiplier it replaced has the same flaw on the web — a
    // short, wide browser viewport frames the cap just as tightly as the embed did — and two
    // framings meant the bug could only ever be fixed in one of them.
    const dist = framedDistance(Math.hypot(spanX, spanY, meta.topZ) / 2);
    const target = new THREE.Vector3(0, standHeight / 2, 0);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0.5, 0.45, 0.75).multiplyScalar(dist));
    resize();

    // sensible default size for this cap (also the value the placement reset restores)
    const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
    DEFAULTS.size = Math.round(room * 0.5 * 10) / 10;
    C.size.set(DEFAULTS.size);
    updateSizeMax(); // legend-aspect-aware ceiling (wide text can use the cap's length)

    // Nudge range follows the cap so the legend can reach the edges of wide caps/spacebars.
    setNudgeRange('offx', 'offxNum', Math.max(5, Math.ceil((meta.bbox.max[0] - meta.bbox.min[0]) / 2)));
    setNudgeRange('offy', 'offyNum', Math.max(5, Math.ceil((meta.bbox.max[1] - meta.bbox.min[1]) / 2)));

    applyLetterLimit(); // longer legends on bigger caps
    $('exportBlank').disabled = false; // blank export needs only the shell, ready now

    $('meta').textContent = `Cap ${(meta.bbox.max[0] - meta.bbox.min[0]).toFixed(1)}×${(meta.bbox.max[1] - meta.bbox.min[1]).toFixed(1)}×${meta.topZ.toFixed(1)} mm · ${meta.triangles} tris · from ${meta.generatedFrom}`;
  }

  const profileSelect = $('profileSelect');
  const unitSelect = $('unitSelect');
  let keycapProfiles = [];     // [{ id, label, default, keycaps:[{ id, label, file, unit }] }]
  let currentProfile = null;   // the active profile object
  let keycapManifest = [];     // the active profile's size list (keycaps[])

  // Load a different keycap (profile/size) and rebuild the current legend on it.
  async function switchKeycap(file, label) {
    busyEl.style.display = 'block';
    unitSelect.disabled = true;
    profileSelect.disabled = true;
    try {
      const kc = await loadKeycap(file);
      setKeycap(kc);
      if (currentLegend) scheduleRegen(); else busyEl.style.display = 'none';
    } catch (e) {
      console.error(e);
      busyEl.style.display = 'none';
      setStatus(`Could not load ${label || 'this keycap'}.`, 'err');
    } finally {
      unitSelect.disabled = false;
      profileSelect.disabled = false;
    }
  }

  // Fill the size dropdown from a profile, keeping the same size id when it exists (so flipping
  // profile preserves the chosen size — both profiles carry the same set). Returns the entry.
  function populateSizes(profile, preferredId) {
    keycapManifest = profile.keycaps;
    unitSelect.textContent = '';
    for (const k of keycapManifest) {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = k.label;
      unitSelect.appendChild(opt);
    }
    const entry =
      keycapManifest.find((k) => k.id === preferredId) ||
      keycapManifest.find((k) => k.id === profile.default) ||
      keycapManifest[0];
    unitSelect.value = entry.id;
    return entry;
  }

  // Slug for the active profile, used to keep exported filenames distinct between profiles.
  // Empty when there's only one profile, so single-profile filenames stay unchanged.
  function profileSlug() {
    if (!currentProfile || keycapProfiles.length < 2) return '';
    return currentProfile.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  // ------------------------------------------------- per-profile capabilities
  // Not every profile is a Cherry-style cap with a dished top and a cross stem, and a few
  // controls only make sense on one that is. The rules ride along on the profile entry in
  // index.json (emitted from PROFILE_TUNING in scripts/convert-keycap.mjs), so the geometry
  // and the rules about it stay in one place. A profile that says nothing gets everything,
  // which is why the three original profiles are unaffected.
  function applyProfileCaps(profile) {
    // Homing bump: one shared mesh, positioned by constants hardcoded to the Standard 1u cap
    // and shaped for its dish. It has no business on a flat 3.5 mm Choc top.
    const bumpRow = $('homingBumpRow');
    if (bumpRow) {
      const allowed = profile?.homingBump !== false;
      bumpRow.hidden = !allowed;
      if (!allowed && $('homingBump').checked) {
        $('homingBump').checked = false;
        scheduleRegen();
      }
    }

    // Shine-through subtracts a prism through the FULL height of the shell. On a Cherry cap
    // the cavity below is empty so that's safe. The two Choc stubs attach only ±2.85 mm from
    // the cap centre — directly under the legend — so it would cut the stems off the cap.
    const shineRow = $('shineThroughRow');
    if (shineRow) {
      const allowed = profile?.shineThrough !== false;
      shineRow.hidden = !allowed;
      if (!allowed && $('through').checked) {
        $('through').checked = false;
        applyModeFlags();
        scheduleRegen();
      }
    }

    // Depth ceiling. The stock 0.2–1.5 mm range assumes a Cherry roof (1.8–2.0 mm of material
    // over the void). The Choc top plate is exactly 1.50 mm, so the stock maximum would carve
    // straight through it — a hole, in single-colour recessed mode.
    const maxDepth = profile?.maxDepth ?? 1.5;
    $('depth').max = maxDepth;
    $('depthNum').max = maxDepth;
    if (C.depth.get() > maxDepth) C.depth.set(maxDepth);

    // Print note: how this profile has to be oriented on the plate, if it's not the usual way.
    const note = $('profileNote');
    if (note) {
      note.textContent = profile?.print ?? '';
      note.hidden = !profile?.print;
    }
  }

  profileSelect.addEventListener('change', () => {
    const profile = keycapProfiles.find((p) => p.id === profileSelect.value);
    if (!profile) return;
    currentProfile = profile;
    applyProfileCaps(profile);
    const entry = populateSizes(profile, unitSelect.value); // keep the current size if it exists
    currentUnit = entry.unit || 1;
    updateAlphabetAvailability();
    proPanel?.refresh(); // not every profile ships the sizes a keyboard layout needs
    switchKeycap(entry.file, `${profile.label} ${entry.label}`);
  });

  unitSelect.addEventListener('change', () => {
    const entry = keycapManifest.find((k) => k.id === unitSelect.value);
    if (entry) {
      currentUnit = entry.unit || 1;
      updateAlphabetAvailability();
      switchKeycap(entry.file, entry.label);
    }
  });

  // ------------------------------------------------------- Pro Pack (MakerWorld only)
  // Paid features live behind the host's `requestAccess` gate and are only offered inside the
  // MakerLab embed, so the whole panel is fenced behind the compile-time MAKERLAB flag: the
  // public build drops the branch, and with it the panel, the layouts and the set builder.
  //
  // The panel owns its own paywall and progress; what it needs from here is a snapshot of the
  // live settings and the regen lock, so a batch run can't collide with a preview rebuild.
  let proPanel = null;
  /** The edited keyboard set, so it rides along in Save/Load like any other setting. */
  let keyboardSet = null;
  if (MAKERLAB) {
    const proHost = container.querySelector('.vl-panel--left .vl-panel__scroll');
    if (proHost) {
      proPanel = mountKeyboardSetPanel(proHost, {
        container,
        setMainPaused: setPaused,
        getSavedSet: () => keyboardSet,
        onSetChanged: (set) => { keyboardSet = set; },
        getState: () => ({
          profile: currentProfile,
          profileSlug: profileSlug(),
          fontId: $('fontSelect').value,
          opts: {
            depth: C.depth.get(),
            rotationDeg: C.rot.get(),
            offsetX: C.offx.get(),
            offsetY: C.offy.get(),
            mirror: $('mirror').checked,
            through: $('through').checked,
            singleColor: $('single').checked,
            // The bump is a Cherry-shaped mesh positioned against the Standard dish; a profile
            // that says it has none keeps its F and J plain.
            homingBumpAllowed: currentProfile?.homingBump !== false && !!homingBumpGeometry,
          },
          glyphHeightMM: C.size.get(),
          stemTolMM: stemTolValue,
          capColor: $('capColor').value,
          logoColor: $('logoColor').value,
          homingBumpGeom: homingBumpGeometry,
          maxDepth: currentProfile?.maxDepth ?? 1.5,
          // Pack onto whatever plate the viewport is showing, so what the picker says fits is
          // what the set is laid out for. `grid` has no size — the builder falls back to 256².
          plateSize: getPlate(loadPlateChoice())?.size,
        }),
        begin: () => {
          if (running) return false;
          clearTimeout(regenTimer); // a queued preview rebuild must not run mid-batch
          running = true;
          return true;
        },
        end: () => {
          if (!running) return; // already released — never schedule two rebuilds for one batch
          running = false;
          scheduleRegen(); // back to the live preview for the current inputs
        },
        setStatus,
        setBusy: (text) => {
          busyEl.textContent = text ?? 'generating…';
          busyEl.style.display = text == null ? 'none' : 'block';
        },
        captureCover,
      });
      cleanups.push(() => proPanel.destroy());
    }
  }

  // ------------------------------------------------------- quality callout (dismissable)
  (function initQualityCallout() {
    const callout = $('qualityCallout');
    if (!callout) return;
    // remove(), not `hidden = true`: the ui-kit `.vl-callout` rule sets `display: flex`,
    // which outranks the [hidden] UA style — so setting `hidden` left it fully visible.
    // The MakerLab build drops it entirely: it points users off-platform to a MakerWorld
    // model page, which the host doesn't want surfaced inside the embed.
    if (MAKERLAB) { callout.remove(); return; }
    const KEY = 'keycap_quality_callout';
    try { if (localStorage.getItem(KEY) === 'dismissed') { callout.remove(); return; } } catch {}
    $('qualityCalloutDismiss')?.addEventListener('click', () => {
      callout.remove();
      try { localStorage.setItem(KEY, 'dismissed'); } catch {}
    });
  })();

  // ------------------------------------------------------- theme (viewport sync)
  // The shared ui-kit sidebar footer owns the light/dark toggle; it flips
  // <html data-theme> and persists to 'keycap_theme'. Mirror that into the WebGL
  // viewport (clear colour + grid) on every change, per the ui-kit pattern.
  // Watches <html>, which outlives this generator — so it has to be disconnected, or every
  // theme flip after unmount would still be calling into a disposed renderer.
  const themeObserver = new MutationObserver(() => {
    applyViewportTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => themeObserver.disconnect());

  // ------------------------------------------------------- save/load project
  //
  // Two backends behind the same two buttons. On the web, Save writes a JSON file to
  // Downloads and Load reads one back through a file input — stateless, and the file is the
  // user's problem to keep. Inside a host, a project is a real stored thing with a name, a
  // preview and a list you pick from. Both paths build and consume the same parameter blob,
  // so a project saved in either place describes the same keycap.

  /** The project currently open, so Save overwrites it instead of piling up copies. */
  let currentProjectId;

  function collectState() {
    const projectState = {
      size: parseFloat($('size').value),
      depth: parseFloat($('depth').value),
      rot: parseFloat($('rot').value),
      offx: parseFloat($('offx').value),
      offy: parseFloat($('offy').value),
      capColor: $('capColor').value,
      logoColor: $('logoColor').value,
      mirror: $('mirror').checked,
      homingBump: $('homingBump').checked,
      through: $('through').checked,
      single: $('single').checked,
      profile: $('profileSelect').value,
      unit: $('unitSelect').value,
    };
    if (currentLegend) projectState.legend = currentLegend;
    // An edited keyboard set is hours of work; it belongs in the project file next to
    // everything else. Absent in the public build, where the editor doesn't exist.
    if (keyboardSet) projectState.keyboardSet = keyboardSet;
    return projectState;
  }

  /** The preview the Open list shows. A save is still worth doing without one. */
  function capturePreview() {
    try {
      // The renderer only keeps its drawing buffer when preserveDrawingBuffer is on, which
      // outside the MakerWorld build it is not — so draw one more frame and read it in the
      // same tick, before the browser clears it.
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  async function saveToHost() {
    const suggested = currentLegend?.name || 'Keycap';
    const name = window.prompt('Project name', suggested);
    if (name === null) return;
    try {
      const saved = await host.saveProject({
        id: currentProjectId,
        name: name.trim() || suggested,
        params: collectState(),
        previewDataUrl: capturePreview(),
      });
      currentProjectId = saved.id;
      setStatus(`Saved "${saved.name}" ✓`);
    } catch (err) {
      console.error(err);
      setStatus(`Could not save: ${err.message || err}`, 'err');
    }
  }

  async function openFromHost() {
    let projects;
    try {
      projects = await host.listProjects();
    } catch (err) {
      console.error(err);
      setStatus('Could not read your saved projects', 'err');
      return;
    }
    if (!projects.length) {
      setStatus('No saved projects yet', 'warn');
      return;
    }

    const list = document.createElement('div');
    list.className = 'kc-project-list';
    const handle = dialog({ title: 'Open a project', content: list });

    for (const p of projects) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vl-btn vl-btn--secondary kc-project-row';
      if (p.preview) {
        const img = document.createElement('img');
        img.className = 'kc-project-thumb';
        img.alt = '';
        // `asset:` is how a Tauri webview is allowed to read a file off disk.
        img.src = `asset://localhost/${encodeURIComponent(p.preview)}`;
        row.append(img);
      }
      const label = document.createElement('span');
      label.textContent = p.name;
      row.append(label);
      row.addEventListener('click', async () => {
        handle.close();
        try {
          const project = await host.loadProject(p.id);
          applyLoadedState(project.params);
          currentProjectId = project.id;
          setStatus(`Opened "${project.name}" ✓`);
        } catch (err) {
          console.error(err);
          setStatus(`Could not open: ${err.message || err}`, 'err');
        }
      });
      list.append(row);
    }
  }

  $('saveProj')?.addEventListener('click', () => {
    if (host) { void saveToHost(); return; }
    const blob = new Blob([JSON.stringify(collectState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'keycap-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Project saved ✓');
  });

  $('loadProj')?.addEventListener('click', () => {
    if (host) { void openFromHost(); return; }
    $('projFile').click();
  });
  $('projFile')?.addEventListener('change', () => {
    const f = $('projFile').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyLoadedState(JSON.parse(reader.result));
        setStatus('Project loaded ✓');
      } catch {
        setStatus('Failed to load project file', 'err');
      }
    };
    reader.readAsText(f);
    $('projFile').value = '';
  });

  /** Applies a parameter blob to the live UI. Shared by both load paths. */
  function applyLoadedState(loaded) {
    if (!loaded || typeof loaded !== 'object') throw new Error('Not a keycap project');
    if (loaded.size != null) { $('size').value = loaded.size; $('sizeNum').value = loaded.size; }
    if (loaded.depth != null) { $('depth').value = loaded.depth; $('depthNum').value = loaded.depth; }
    if (loaded.rot != null) { $('rot').value = loaded.rot; $('rotNum').value = loaded.rot; }
    if (loaded.offx != null) { $('offx').value = loaded.offx; $('offxNum').value = loaded.offx; }
    if (loaded.offy != null) { $('offy').value = loaded.offy; $('offyNum').value = loaded.offy; }
    if (loaded.capColor) { $('capColor').value = loaded.capColor; capMat.color.set(loaded.capColor); }
    if (loaded.logoColor) { $('logoColor').value = loaded.logoColor; logoMat.color.set(loaded.logoColor); }
    if (loaded.mirror != null) $('mirror').checked = loaded.mirror;
    if (loaded.homingBump != null) $('homingBump').checked = loaded.homingBump;
    if (loaded.through != null) $('through').checked = loaded.through;
    if (loaded.single != null) $('single').checked = loaded.single;
    if (loaded.profile) $('profileSelect').value = loaded.profile;
    if (loaded.unit) $('unitSelect').value = loaded.unit;
    if (loaded.keyboardSet) keyboardSet = loaded.keyboardSet;
    // Trigger UI sync
    $('size').dispatchEvent(new Event('input'));
    $('profileSelect').dispatchEvent(new Event('change'));
    applyModeFlags();
  }

  // ------------------------------------------------------- help dialog
  $('helpToggle')?.addEventListener('click', () => {
    const overlay = $('whatsNew');
    if (overlay) overlay.hidden = false;
  });

  // ------------------------------------------------------- "what's new" modal
  // Shows on every visit until the user ticks "Don't show this again". Bump
  // WHATS_NEW_VERSION whenever the notes change so the popup resurfaces for everyone.
  (function initWhatsNew() {
    const WHATS_NEW_VERSION = '2026-07-thocky-stem';
    const KEY = 'keycap_whatsnew_dismissed';
    const overlay = $('whatsNew');
    // Not on the desktop. Release notes belong to the app that was released, and inside a
    // host that is the host — announcing this generator's version over someone else's
    // window, on first open, is the wrong app talking.
    if (MAKERLAB || isDesktop() || !overlay) return;

    let dismissed = null;
    try { dismissed = localStorage.getItem(KEY); } catch {}
    if (dismissed === WHATS_NEW_VERSION) return; // user opted out of this version

    const close = () => {
      overlay.hidden = true;
      document.removeEventListener('keydown', onKey);
      if ($('whatsNewHide').checked) {
        try { localStorage.setItem(KEY, WHATS_NEW_VERSION); } catch {}
      }
    };
    function onKey(e) { if (e.key === 'Escape') close(); }

    $('whatsNewClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }); // backdrop
    document.addEventListener('keydown', onKey);
    // `close()` removes this too, but only if the user ever closes the dialog. Unmounting
    // with it still open would otherwise leave an Escape handler on the document for the
    // rest of the session, reaching into a torn-down generator.
    cleanups.push(() => document.removeEventListener('keydown', onKey));
    overlay.hidden = false;
  })();

  // ------------------------------------------------------- MakerLab handshake
  // MakerWorld build only: connect to the host when embedded (no-op otherwise). Runs alongside
  // boot(); the export buttons check mlReady() at click time, so ordering doesn't matter.
  if (MAKERLAB) {
    initMakerlab({
      onDisconnect: () => setStatus('Disconnected from the MakerLab host.', 'warn'),
    }).then((ctx) => {
      if (!ctx) return;
      document.body.classList.add('makerlab');
      console.log('[MakerLab] connected, capabilities:', ctx.capabilities.join(', '));
    });
  }

  // ---------------------------------------------------------------- boot
  (async function boot() {
    try {
      await initManifold(); // engine needed up-front to clean the stem body

      // Pull the manifest; fall back to the single-cap file if it isn't there.
      const index = await fetch(assetUrl('keycaps/index.json'))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      // Accept the profile-aware manifest, or the older flat { default, keycaps } as one profile.
      const profiles = index?.profiles?.length
        ? index.profiles
        : index?.keycaps?.length
          ? [{ id: 'default', label: 'Default', default: index.default, keycaps: index.keycaps }]
          : null;

      let defaultFile = 'keycap.json';
      if (profiles) {
        keycapProfiles = profiles;
        for (const p of profiles) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.label;
          profileSelect.appendChild(opt);
        }
        const defProfile = profiles.find((p) => p.id === index.defaultProfile) || profiles[0];
        currentProfile = defProfile;
        profileSelect.value = defProfile.id;
        const entry = populateSizes(defProfile, defProfile.default);
        applyProfileCaps(defProfile);
        defaultFile = entry.file;
        currentUnit = entry.unit || 1;
        // A single profile needs no picker — keep the size dropdown, hide the profile one.
        if (profiles.length < 2) profileSelect.closest('.field').style.display = 'none';
      } else {
        unitSelect.closest('.section').style.display = 'none'; // no manifest — hide the picker
      }

      try {
        const hb = await loadKeycap('keycaps/homing-bump.json');
        homingBumpGeometry = hb.shellGeometry;
      } catch (e) {
        console.error('Failed to load homing bump geometry:', e);
      }
      setKeycap(await loadKeycap(defaultFile));
      updateAlphabetAvailability();
      proPanel?.refresh(); // the profile is only known now

      rebuildGallery();
      loadBundledSvgs();
      const first = defaultLucideIcon();
      if (first && currentMode === 'icon') {
        selectIcon(first.el || galleryEl.firstElementChild, first.getText, first.name);
      } else if (currentMode === 'letter') {
        selectLetter();
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Failed to load.', 'err');
    }
  })();

  // ---------------------------------------------------------------- help tooltips
  // A single bubble reused by every ".help-badge". Appended to <body> so the right
  // sidebar's overflow:hidden never clips it. Shown on hover/focus of a badge.
  (function initHelpTips() {
    const bubble = document.createElement('div');
    bubble.className = 'help-tip-bubble';
    bubble.hidden = true;
    document.body.appendChild(bubble);
    // Parked on <body>, deliberately — the right sidebar's overflow would clip it. That
    // also puts it outside the container, so container.replaceChildren() never sees it and
    // every mount would leave another orphan bubble behind.
    cleanups.push(() => bubble.remove());

    function show(badge) {
      const tip = badge.getAttribute('data-tip');
      if (!tip) return;
      bubble.textContent = tip;
      bubble.hidden = false;
      const r = badge.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      let left = r.left + r.width / 2 - b.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
      let top = r.top - b.height - 8;
      if (top < 8) top = r.bottom + 8; // flip below if there's no room above
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    }
    const hide = () => { bubble.hidden = true; };

    container.querySelectorAll('.help-badge').forEach((badge) => {
      badge.addEventListener('mouseenter', () => show(badge));
      badge.addEventListener('mouseleave', hide);
      badge.addEventListener('focus', () => show(badge));
      badge.addEventListener('blur', hide);
      badge.addEventListener('click', (e) => e.preventDefault());
    });
  })();


  return () => {
    // Dialogs live on <body>, outside the container the host clears. The magnet wizard's
    // steps carry their own WebGL preview, so a stranded one holds a context for good.
    closeAllDialogs();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.replaceChildren();
  };
}
