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
import {
  topbarLinks, generatorHeader, qualityCallout, sidebarFooter, dialog, isDesktop, closeAllDialogs,
  promptDialog, hostAssetUrl, rememberFile, bindExternalLinks, chooseFile,
  button, dropZone, toast, themeColorHex, captureCover, stageStatus,
  nudgePad, busyChip, panelCredit, paletteRow, segmentedControl, readProjectFile, appShell, sliderRow,
  toggleSwitch, settingsRail, stageTools, stageRow, previewBar, stepperRow, selectField, iconButton, el,
  fontChooser, historyControls,
} from '@vostok/ui-kit';
import { mountPlatePicker, loadPlateChoice, getPlate } from '@vostok/plates';
import { createViewer } from '@vostok/viewer';
import { createBuildPlate } from '@vostok/plates/three';
import { downloadFile } from '@vostok/export';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadKeycap } from './keycap.js';
import { parseLogo } from './logo.js';
import { openSvgPreview } from './svgPreview.js';
import { FONT_OPTIONS, importFontFile, parseLetter, loadBundledFonts, LEGEND_MAX_CHARS } from './letter.js';
import { letterFontList, installLetterFontPreviews, ensureLetterFont, fontWritesText, facesThatWrite, alphabetOf } from './letterFonts.js';
import { initManifold, geomToManifold, manifoldToGeom, creaseNormals, getManifoldApi } from './manifold.js';
import { applyStemClearance } from './stemClearance.js';
import { legendSizeMax, textHeightOf, sizeForTextHeight } from './legendSize.js';
import { trimCap, capTrimLimits, clampCapTrim } from './capHeight.js';
import { extraProfiles, capFile, withCapSettings, isShapeProfile } from './shapes/profiles.js';
import { SIZE_RANGE_MM, DEFAULT_SIZE_MM, sizeRangeMM } from './shapes/index.js';
import {
  FIT_TEST_STEP_MM, FIT_TEST_STEP_OPTIONS, FIT_TEST_FONT_ID, computeFitTestLadder, buildFitTestRow,
} from './fitTest.js';
import { keycapThreeMF } from './export3mf.js';
import { keycapObjMtl } from './exportObj.js';
import { profileTag } from './exportParts.js';
import { createExports, LICENSE_NOTE, stageCover } from './exports.js';
import { rebuildLoop, createRebuildLock } from './rebuild.js';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from './lucideIcons.js';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the real
// host glue in the MakerWorld build (`--mode makerworld`) — see vite.config.js.
import { MAKERLAB, initMakerlab } from 'virtual:makerlab';
// Paid features (MakerWorld-only). Imported statically so the MAKERLAB=false constant lets
// the bundler drop the whole feature — tabs, layouts and set builder — from the public build.
// Through the same kind of virtual seam as the host glue above, because src/pro/ is gitignored: the
// public build resolves this to a no-op stub and never needs those files to exist.
import { mountProFeatures, PRO_CHANGELOG } from 'virtual:pro-pack';
import './style.css';
import { ICONS } from '@vostok/ui-kit';
import { CHANGELOG } from './changelog';
import { TEMPLATE } from './template.js';
import { setAssetBase, assetUrl } from './assets.js';
import { PROJECT_FILE, projectFileText } from './projectFile.js';

/**
 * @param {HTMLElement} container where the generator's DOM goes
 * @param {import('@vostok/ui-kit').DesktopHost} [host] absent on the web
 * @returns {() => void} teardown
 */
export function mount(container, host) {
  setAssetBase(host?.assetBase?.() ?? '');

  // Outbound links go to the user's real browser rather than to this window, which has no
  // address bar and so no way back. One delegated listener, and a no-op on the web.
  bindExternalLinks(host);
  container.innerHTML = TEMPLATE;
  // Whoever owns the container, WE own its layout: it has to be a bounded flex column or
  // .vl-app sizes to its content and everything past the fold is clipped away (see .kc-root
  // in style.css). Applied here rather than as an `#app` rule so the desktop host — which
  // mounts us into an element of its own, with no id we could select — is covered too.
  container.classList.add('kc-root');

  /** Scoped to the container: two generators can be mid-teardown and mid-mount at once,
   *  and a bare getElementById would happily find the other one's node. */
  const $ = (id) => container.querySelector(`#${id}`);

  /* The frame is the kit's appShell(); the template holds what goes in it, and each holder is
     emptied into its part. `contained`: the frame fills the box it is mounted in, under the
     topbar, rather than the window. The topbar stays outside it, in .kc-root's column, so the
     frame has no bar row (`--no-topbar`). The stage keeps the id everything finds it by. */
  const takeChildren = (id) => {
    const holder = $(id);
    const nodes = [...holder.childNodes];
    holder.remove();
    return nodes;
  };
  const appFrame = appShell({
    contained: true,
    left: { scroll: takeChildren('kcLeft'), credit: $('keycapCredit') },
    stage: takeChildren('kcStage'),
    right: { scroll: takeChildren('kcRight'), footer: [$('keycapFooter')] },
  });
  appFrame.stage.id = 'viewport';
  container.append(appFrame.root);

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups = [];
  cleanups.push(() => container.classList.remove('kc-root'));

  /* The left panel is the kit's settings rail, one category open at a time, as in the clicker and
     Laser Studio. Each `data-rail` holder in the template is a category: its rows move into the
     rail here, ids and all, so everything below still finds them, and the holders go. The rail
     takes a category off while every row in it is hidden (Font, until the legend is text). */
  const RAIL_ITEMS = [
    { id: 'keycap', label: 'Keycap', icon: ICONS.box },
    // A paid mode's board settings; off the rail while its host is hidden (One cap).
    { id: 'layout', label: 'Layout', icon: ICONS.grid },
    { id: 'dimensions', label: 'Dimensions', icon: ICONS.dimensions },
    { id: 'legend', label: 'Legend', icon: ICONS.sliders, title: 'Legend placement' },
    { id: 'style', label: 'Style', icon: ICONS.layers },
    { id: 'font', label: 'Font', icon: ICONS.text },
    { id: 'colors', label: 'Colors', icon: ICONS.droplet },
    { id: 'fit', label: 'Fit', icon: ICONS.ruler, title: 'Fit & print' },
  ];
  const railHolders = RAIL_ITEMS.map((it) => container.querySelector(`[data-rail="${it.id}"]`));
  const settings = settingsRail({
    label: 'Keycap settings',
    items: RAIL_ITEMS.map((it, i) => ({ ...it, body: [...railHolders[i].children] })),
  });
  railHolders[0].before(settings);
  for (const h of railHolders) h.remove();

  // The size dropdown: the kit's, with the id the app and the paid modes find it by.
  const unitField = selectField({ id: 'unitSelect', label: 'Size', options: [] });
  unitField.id = 'kcUnitField';
  $('unitFieldMount').replaceWith(unitField);

  // What the legend is made from: a picture card each, the clicker's import cards.
  const legendSource = segmentedControl({
    variant: 'cards',
    columns: 3,
    stacked: true,
    options: [
      { value: 'icon', label: 'Icon', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
      { value: 'upload', label: 'SVG', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' },
      { value: 'letter', label: 'Text', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' },
    ],
    value: 'icon',
    onChange: (v) => setLegendMode(v),
  });
  $('legendSourceMount').replaceWith(legendSource);
  /* The font: the kit's chooser over the keycap's own faces and the shelf's library
     (letterFonts.js). Typing letters the face lacks moves the text to the plainest face that
     writes them, as the clicker does (selectLetter). The paid modes read the face through
     `legendUI.fontId` and listen for 'fontSelect' changes through `onShellEvent`. */
  let currentFontId = FONT_OPTIONS[0]?.id ?? 'helvetiker-regular';
  const fontSubs = new Set();
  /** The cards: a handful of faces that suit a keycap, or, for text in another alphabet, the
   *  faces that write it. */
  const CURATED_FONTS = [
    'helvetiker-regular', 'helvetiker-bold', 'droid-sans-mono-regular', 'bundled-bebas-neue',
    'bundled-orbitron', 'bundled-chakra-petch', 'bundled-press-start-2p', 'bundled-pacifico',
  ];
  const fontCardsFor = (text) => {
    const needs = alphabetOf(text);
    return needs && needs !== 'accented' ? facesThatWrite(text).slice(0, 8) : CURATED_FONTS;
  };
  let fontCardsNeed = null;
  const fontName = (id) => FONT_OPTIONS.find((f) => f.id === id)?.name ?? letterFontList().find((f) => f.id === id)?.label ?? id;
  const fontField = fontChooser({
    fonts: letterFontList(),
    curated: CURATED_FONTS,
    value: currentFontId,
    sample: 'A',
    fill: true,
    supports: (f, text) => fontWritesText(f.id, text),
    onChange: (id) => { void chooseFont(id); },
    onImport: async (file) => {
      void rememberFile(host, 'font', file); // kept for next time; a no-op without a host
      const font = await importFontFile(file);
      return [{ id: font.id, label: font.name, family: font.cssFamily ?? 'sans-serif', category: 'Custom' }];
    },
    importAccept: '.ttf,.otf,.json',
    host,
  });
  $('fontChooserMount').replaceWith(fontField);
  cleanups.push(installLetterFontPreviews());
  // The keycap's own TTFs arrive one by one after boot: each joins the list as it parses.
  loadBundledFonts(() => fontField.setFonts(letterFontList(), fontCardsFor($('letterText').value)));
  // The Font category is for typed text: off the rail until the legend is text.
  fontField.hidden = true;
  settings.refresh();
  /** The latest face asked for, so a slow load (a Chinese face is megabytes) cannot overwrite a
   *  newer choice. */
  let fontPick = 0;
  async function chooseFont(id) {
    const pick = ++fontPick;
    const loaded = FONT_OPTIONS.some((f) => f.id === id);
    if (!loaded) setBusyState('loading font…');
    const ok = await ensureLetterFont(id);
    if (!loaded && !singleCapSuspended) setBusyState(null);
    if (pick !== fontPick) return;
    if (!ok) {
      setStatus('Could not load this font.', 'err');
      fontField.setValue(currentFontId);
      return;
    }
    currentFontId = id;
    fontField.setValue(id);
    for (const fn of fontSubs) fn({ target: { value: id } });
    legendSink.font();
  }




  // Mount the unified Vostok topbar — except in the MakerWorld build, where the host provides
  // its own chrome, and on the desktop, where the app around this one already owns the
  // window. In both, a bar of links out is a way out of the product.
  const oldTopbar = $('topbar');
  if (oldTopbar) {
    if (MAKERLAB || isDesktop()) {
      oldTopbar.remove();
    } else {
      oldTopbar.replaceWith(topbarLinks({
        boostUrl: BRAND.urls.makerworld,
        // Sold on Buy Me a Coffee; the terms match the licence document the buyer receives.
        lifetimeLicence: {
          product: 'Custom Keycap Generator',
          href: BRAND.urls.keycapLifetimeLicence,
          terms: [
            'Sell digital files',
            'Pay once, get a lifetime license',
            'Sell physical prints',
            'No subscription',
            'No credit or attribution required',
          ],
        },
      }));
    }
  }

  // Mount header and footer components
  const oldHeader = $('keycapAppHeader');
  if (oldHeader) {
    if (MAKERLAB) {
      // The host page already shows the app's name, so in this build the header simply
      // goes — the credit strip pinned at the foot of the panel (panelCredit, below) carries
      // the byline in both builds now.
      oldHeader.remove();
    } else {
      oldHeader.replaceWith(generatorHeader({
        title: 'Keycap Legend Generator',
        description: 'Pick an icon or letter, size it, export a two-color 3MF.',
        // The byline lives in the credit strip at the foot of this panel. Saying "Made by
        // Vostok Labs" at both ends of one column is one time too many.
        hideCredit: true,
      }));
    }
  }

  /** The footer's primary export button, once the footer exists. Relabelled per mode.
   *  Declared before the footer is built — the block below assigns it. */
  let exportBtn = null;
  /** The footer's export block, so a paid mode can hang its price note under the button. */
  let exportPanelEl = null;

  const keycapFooter = $('keycapFooter');
  if (keycapFooter) {
    const footer = sidebarFooter({
      // The host draws Save and Open itself when it owns projects; two Save buttons that
      // do different things is worse than either one alone. `Boolean(...)`, not `isDesktop()`:
      // a desktop host without the capability still needs these.
      //
      // Also true in the MakerLab embed, where nobody owns them: the embedded build has no
      // download path, so it has no Save or Load. The kit then draws only Help and the theme
      // toggle — which is what the live listing has always shown. This used to be done by
      // removing "the first action row" after the fact, and when the kit folded its two rows
      // into one that took Help and Light mode with it.
      hostOwnsProjects: MAKERLAB || Boolean(host?.registerProject),
      // The label names the user's FILE, and the verb names what happens to it.
      //
      // Two wrong answers were tried first. "Export to MakerWorld" named the wrong platform
      // outright — the host here is MakerLab. "Export to MakerLab" named the right one, but
      // naming our host describes our side of the transaction; the user came for a 3MF.
      // Plain "Download 3MF" is the other miss: the embedded build has no download path, the
      // file goes to the host, and a button that says otherwise is the one thing this label
      // has to stop doing.
      //
      // "Export 3MF" is the file plus an honest verb. The kit passes a label already starting
      // with "Export" through untouched and turns a bare one into "Download 3MF", so the web
      // build keeps the word that is true there. Where it went is the status line's job, and
      // it says so.
      formats: [{ id: '3mf', label: MAKERLAB ? 'Export 3MF' : '3MF' }],
      // Always travels. A paid mode may have relabelled this button ("Unlock Pro"),
      // but that is a label: the click goes down the same path either way and meets the gate at
      // the far end, which is the only thing that decides whether paid work runs.
      //
      // RETURNED, not fired and forgotten. The kit greys this button for as long as the promise
      // is pending, which is the whole feedback story for a keyboard set — see runPrimaryExport.
      onExport: () => runPrimaryExport(),
      onSave: () => {
        if (host) { void saveToHost(); return; }
        downloadFile(projectFileText(collectState()), 'keycap-project.json', 'application/json');
        setStatus('Project saved ✓');
      },
      onLoad: (file) => {
        // On the desktop the kit's Load button hands us nothing and expects the host's own
        // picker to be opened instead — there is no file input in that story.
        if (host) { void openFromHost(); return; }
        if (!file) return;
        // A file that is not a keycap project (another generator's, or not one at all) is
        // refused with the kit's message and changes nothing.
        void readProjectFile(file, (data) => {
          applyLoadedState(data);
          setStatus('Project loaded ✓');
        }, PROJECT_FILE);
      },
      onHelp: () => {
        dialog({
          title: 'Keycap Legend Generator help',
          content: document.createTextNode(
            MAKERLAB
              ? 'Pick an icon or custom letter, customize size, depth, rotation and stem clearance, then send the finished keycap to MakerLab with the button above.'
              : 'Pick an icon or custom letter, customize size, depth, rotation and stem clearance, then click Download 3MF to export a print-ready file for your slicer.',
          ),
          actions: [{ label: 'Got it', primary: true }],
        });
      },
      themeStorageKey: 'keycap_theme',
    });
    keycapFooter.replaceWith(footer);
    // The one primary action, whatever the mode. Set mode relabels it rather than adding a
    // second export button somewhere else — there is one place to press to get a file.
    exportBtn = footer.querySelector('.vl-export .vl-btn--primary');
    exportPanelEl = footer.querySelector('.vl-export');
  }

  const busyEl = busyChip();
  /* The kit's status line, in the stage's bottom-left corner where the template's own line was:
     a carve's warnings come through `setDiagnostics`, every other message through `setStatus`. */
  const status = stageStatus('Loading…');
  $('status').replaceWith(status.root);
  $('viewport').append(busyEl);

  /* The stage's top-left: the paid modes' switch (One cap · Full set; the public build has none),
     how the preview looks at the cap (Top or 3D), and the cap's size line under them. They take
     the stage label's slot. */
  let stageView = '3d';
  const viewBar = previewBar({
    label: 'View',
    modes: {
      label: 'View',
      options: [{ value: 'top', label: 'Top' }, { value: '3d', label: '3D' }],
      value: stageView,
      onChange: (v) => { stageView = v; aimCamera(); },
    },
  });
  // The cap's size line under the stage bar, hidden whenever a mode owns the stage (setStageOwner).
  $('viewport').append(stageTools([stageRow([$('kcModeTabs'), viewBar.root]), stageRow([$('meta')])]));
  $('viewport').querySelector('.vl-stage__label')?.setAttribute('hidden', '');

  /**
   * The one way the busy chip is shown or hidden.
   *
   * `onCancel` is the half that was missing. Switching tabs during a keyboard set was refused
   * with "let it finish or cancel it first" while nothing anywhere could cancel it, and the
   * free A-Z batch had the same trap: twenty-six carves with no way out but closing the tab.
   * A batch that can be stopped passes one in; the live rebuild is 200ms and passes none.
   */
  function setBusyState(text, onCancel) {
    if (text == null) busyEl.hide();
    else busyEl.show(text, onCancel);
  }

  /** One line on the stage. `kind` 'warn' or 'err' colours it; anything else ('', 'ok') is plain. */
  function setStatus(msg, kind = '') {
    status.set(msg, kind === 'err' ? 'error' : kind === 'warn' ? 'warn' : 'idle');
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

  // Read the token rather than a copy of it. Both hex values written here had already gone
  // stale against tokens.css (--bg is #eef1f6 / #101620 now), so the stage painted a slightly
  // different colour from the panels either side of it.
  function applyViewportTheme(theme) {
    renderer.setClearColor(themeColorHex('--bg', theme === 'light' ? 0xeef1f6 : 0x101620));
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

  const capMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55, metalness: 0.0 });
  const logoMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.5, metalness: 0.0 });
  const capMesh = new THREE.Mesh(undefined, capMat);
  const logoMesh = new THREE.Mesh(undefined, logoMat);
  /**
   * Meshes for legends BEYOND the first — see `extraLegends` under state.
   *
   * One mesh and one material each, not a shared material: a layer's colour is its own, and
   * pointing two legends at `logoMat` is what makes the second one silently follow the first
   * everywhere the user changes a colour.
   *
   * @type {Array<{mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial}>}
   */
  const extraLegendMeshes = [];
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

  /** Grow or shrink the extra-legend mesh pool to `n`, freeing whatever it drops. */
  function ensureExtraMeshes(n) {
    while (extraLegendMeshes.length < n) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.0 });
      const mesh = new THREE.Mesh(undefined, mat);
      printGroup.add(mesh);
      extraLegendMeshes.push({ mesh, mat });
    }
    while (extraLegendMeshes.length > n) {
      const { mesh, mat } = extraLegendMeshes.pop();
      mesh.geometry?.dispose();
      printGroup.remove(mesh);
      mat.dispose();
    }
  }

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
      if (Math.abs(tol) > 1e-4) {
        const result = applyStemClearance(getManifoldApi(), baseStemGeometry, tol);
        if (!result.watertight) console.warn('Stem clearance was not watertight at tol', tol, '— keeping the previous stem.');
        stemGeometry = result.watertight ? result.geometry : (stemGeometry ?? baseStemGeometry);
      } else {
        stemGeometry = baseStemGeometry;
      }
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
    ensureExtraMeshes(0);     // pooled meshes carry a material each, which renderer.dispose() misses
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
  /**
   * Legends carved into this cap BEYOND the first one, in carve order.
   *
   * Empty by default and empty for good in the free build — the list is something a mode hands
   * us through `shell.setExtraLegends`, and the free single-cap path never hands us one. What
   * the shell knows is only that a cap may carry more than one legend, each with its own
   * placement and its own colour; which legends those are, and how you choose them, belongs to
   * whoever supplies the list.
   *
   * @type {Array<{legend: object, placement: object, color: string}>}
   */
  let extraLegends = [];
  let lastIconSelection = null;
  /** What the legend on the cap is made from, as a project saves it: a lucide icon by name, an
   *  uploaded SVG by its markup, typed text with its face. The parsed legend itself holds three.js
   *  objects, which a saved file cannot bring back. */
  let legendSourceState = null;
  /** Counts legend picks, so only the latest one lands (selectIcon). A bundled SVG's markup is
   *  fetched, so a pick made before it (the type card re-picking the last tile on the way to an
   *  upload) could resolve after a later one and put the old legend back on the cap. */
  let iconPick = 0;
  let currentMode = 'icon';
  let currentUnit = 1;        // size of the active keycap (drives the letter limit)

  // debug handles (harmless; used for automated verification)
  window.__app = {
    THREE, scene, camera, renderer, capMesh, logoMesh, stemMesh, keycapThreeMF, keycapObjMtl,
    get exportParts() {
      const carve = loop.latest;
      return carve
        ? exportsApi.buildExportParts(carve, { capColor: $('capColor').value, logoColor: $('logoColor').value })
        : null;
    },
    get meta() { return meta; },
    get lastBodies() { return loop.latest?.bodies ?? null; },
    get shellGeometry() { return shellGeometry; },
    get stemGeometry() { flushStemApply(); return stemGeometry; },
    /** The project as Save writes it, and Load: the embedded build has neither button. */
    get project() { return collectState(); },
    applyProject: (data) => applyLoadedState(data),
    /** Undo steps behind and ahead of the one on screen. */
    get historyDepth() { return [historyPast.length, historyFuture.length]; },
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

  // The two block buttons in the panels. Kit `button()`s built into their mount points,
  // keeping their ids: everything below still finds them with $('exportBlank') / $('alphabetSet').
  /** Millimetres per arrow press. Declared up here because the pad below reads it. */
  const NUDGE_STEP = 0.5;

  /* The nudge pad, before the C block below: it BUILDS #offxNum / #offyNum, and `link()`
     binds them by id. */
  const nudge = nudgePad({
    label: 'Nudge',
    step: NUDGE_STEP,
    x: { id: 'offxNum', label: 'X' },
    y: { id: 'offyNum', label: 'Y' },
    // The app writes, not the pad: `nudgeBy` clamps against the hidden per-cap ranges, which
    // the pad cannot see (a legend reaches the edge of a 6.25u spacebar, not of a 1u cap).
    onNudge: (dx, dy) => nudgeBy(dx, dy),
    onReset: () => {
      C.offx.set(0);
      C.offy.set(0);
      announce(['offx', 'offy']);
      scheduleRegen();
    },
  });
  $('nudgePadMount').replaceWith(nudge);

  const exportBlankBtn = button({
    label: 'Export blank keycap',
    emphasis: 'secondary',
    block: true,
    icon: ICONS.download,
    title: 'The bare cap and stem, no legend, in one colour',
  });
  exportBlankBtn.id = 'exportBlank';
  exportBlankBtn.disabled = true;
  $('exportBlankMount').replaceWith(exportBlankBtn);

  const alphabetSetBtn = button({ label: 'Get full alphabet set', emphasis: 'secondary', block: true });
  alphabetSetBtn.id = 'alphabetSet';
  $('alphabetSetMount').replaceWith(alphabetSetBtn);

  /* Size, Depth and Rotation are the kit's sliders. The paid modes listen to them by the ids the
     hand-built rows had ('size' and 'sizeNum', …): `onShellEvent` hands such a listener to the
     row's own subscribers, which get an input-shaped event with the new value, as they did. */
  const sliderSubs = new Map();
  const SLIDER_IDS = { size: 'size', sizeNum: 'size', depth: 'depth', depthNum: 'depth', rot: 'rot', rotNum: 'rot' };
  function kitSlider(key, mountId, opts, onChange) {
    const subs = new Set();
    sliderSubs.set(key, subs);
    const row = sliderRow({
      ...opts,
      onInput: (v) => {
        onChange();
        for (const fn of subs) fn({ target: { value: String(v) } });
      },
    });
    $(mountId).replaceWith(row);
    return {
      row,
      get: () => row.getValue(),
      set: (v) => row.setValue(Number(v)),
      setMax: (v) => row.setBounds(opts.min, Number(v)),
    };
  }
  const C = {
    size: kitSlider('size', 'sizeRowMount',
      { label: 'Size', min: 3, max: 16, step: 0.1, value: 8, unit: 'mm', help: 'The legend’s longer side.' },
      () => { rememberTextHeight(); scheduleRegen(); }),
    depth: kitSlider('depth', 'depthRowMount',
      { label: 'Depth', min: 0.2, max: 1.5, step: 0.05, value: 0.5, unit: 'mm', help: 'How deep the legend goes into the top.' },
      scheduleRegen),
    rot: kitSlider('rot', 'rotRowMount', { label: 'Rotation', min: -180, max: 180, step: 1, value: 0, unit: '°' }, scheduleRegen),
    offx: link('offx', 'offxNum', scheduleRegen),
    offy: link('offy', 'offyNum', scheduleRegen),
  };

  // Text keeps the letter height that was asked for (legendSize.js): the Size slider sets it,
  // and a new word, font or cap keeps it, shrinking only when the word would not fit. Null until
  // the first text legend, which takes the size on screen as its height.
  let textHeightMM = null;
  /** Is the Size slider pointed at the single cap's own text legend? Not while a paid mode has
   *  it pointed at a second legend (`placementOverride`) or at a board. */
  const sizingText = () => currentMode === 'letter' && !!currentLegend?.box && !placementOverride && !singleCapSuspended;
  function rememberTextHeight() {
    if (sizingText()) textHeightMM = textHeightOf(currentLegend.box, C.size.get());
  }
  /** Draw the text at the remembered height, or as tall as fits this cap. Says whether it did. */
  function fitTextSize() {
    if (!sizingText() || !meta) return false;
    if (textHeightMM == null) textHeightMM = C.size.get();
    C.size.set(sizeForTextHeight(currentLegend.box, textHeightMM, legendSizeMax(currentLegend.box, meta.topExtent)));
    return true;
  }

  // Stem fit stepper (− / +): a signed mm offset that rescales only the stem body (no cap CSG
  // rebuild), so it lives outside `C` and drives applyStemTolerance directly.
  let stemTolValue = 0;
  const STEM_TOL_MIN = -0.4, STEM_TOL_MAX = 0.4, STEM_TOL_STEP = 0.02;
  const stemTolRow = stepperRow({
    label: 'Stem fit tolerance',
    min: STEM_TOL_MIN, max: STEM_TOL_MAX, step: STEM_TOL_STEP, value: 0,
    help: 'How tightly the stem grips the switch: + if the keycap is too hard to push on, − if it feels loose. 0 is as designed.',
    format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} mm`,
    onInput: (v) => { setStemTol(v); scheduleStemApply(); },
  });
  $('stemTolMount').replaceWith(stemTolRow);
  function renderStemTol() {
    stemTolRow.setValue(stemTolValue);
  }
  function setStemTol(v) {
    stemTolValue = Math.round(Math.min(STEM_TOL_MAX, Math.max(STEM_TOL_MIN, v)) * 100) / 100;
    renderStemTol();
  }
  // Applying the stepper's value runs real CSG once the tolerance is non-zero
  // (applyStemClearance), which measures 170-280ms on a Choc cap's two stub stems — running
  // that synchronously per click would stack up behind a rapid burst of presses. Coalescing
  // onto the next animation frame means a burst applies once, at whatever value the user has
  // landed on by the time that frame runs — MX's 5-50ms case just applies a frame later, which
  // is imperceptible.
  let stemApplyRaf = null;
  /** Apply a pending stepper value right now. Called by everything that reads the stem for an
   *  export: requestAnimationFrame stops in a background tab, so a frame that has not run yet
   *  must never be the reason an exported stem is at the wrong tolerance. */
  function flushStemApply() {
    if (stemApplyRaf == null) return;
    cancelAnimationFrame(stemApplyRaf);
    stemApplyRaf = null;
    applyStemTolerance();
    if (fitTestActive) renderFitTest();
  }
  function scheduleStemApply() {
    if (stemApplyRaf != null) return; // a frame is already pending; it reads stemTolValue fresh
    stemApplyRaf = requestAnimationFrame(() => {
      stemApplyRaf = null;
      applyStemTolerance();
      if (fitTestActive) renderFitTest();
    });
  }
  cleanups.push(() => { if (stemApplyRaf != null) cancelAnimationFrame(stemApplyRaf); });
  renderStemTol();

  // ---------------------------------------------------------------- fit test (free)
  //
  // A free alternate view of the single cap: instead of the real keycap, the preview shows a
  // row of small test pieces — the stem standing up out of a flat tab, its own tolerance value
  // debossed beside it — at a fixed ladder from -0.40 to +0.40. Print the
  // row, press each stem onto a real switch, and dial the stepper to the one that fits. Every
  // number on a printed piece is a value the stepper itself could show, so there is never a
  // gap between what got printed and what the app can dial in afterwards.
  //
  // A same-stage alternate state, like Double legends, not a stage takeover like Full set: it
  // never calls setStageOwner or setSingleOnlyVisible, only hides the real cap's own meshes and
  // shows its own pooled ones in their place.
  const FIT_TEST_EXPORT_LABEL = MAKERLAB ? 'Export fit test 3MF' : 'Download fit test 3MF';
  // What the footer restores to on exit — the same value `shell.defaultExportLabel` (below)
  // computes for every OTHER mode handing the button back, kept as its own constant here since
  // that one lives inside the Pro panel's own options object.
  const FIT_TEST_IDLE_EXPORT_LABEL = MAKERLAB ? 'Export 3MF' : 'Download 3MF';
  let fitTestActive = false;
  let fitTestPieces = null;       // the last built row's pieces, kept for export
  let fitTestSavedCamera = null;  // camera position/target from just before entering

  /** Pooled meshes for the fit-test row, sharing capMat so a colour change follows for free —
   *  exactly like the real stem already does. Sized to whatever the current row needs: one
   *  mesh per watertight piece, two for the rare piece whose union came back in two bodies. */
  const fitTestMeshes = [];
  function ensureFitTestMeshes(n) {
    while (fitTestMeshes.length < n) {
      const mesh = new THREE.Mesh(undefined, capMat);
      group.add(mesh); // NOT printGroup — the fit test ignores per-profile print rotation
      fitTestMeshes.push(mesh);
    }
    while (fitTestMeshes.length > n) {
      const mesh = fitTestMeshes.pop();
      mesh.geometry?.dispose();
      group.remove(mesh);
    }
  }

  /** The step between fit-test rungs, chosen with the Step control below while Fit test is open.
   *  Kept for the session, so leaving and re-entering Fit test does not reset it. */
  let fitTestStep = FIT_TEST_STEP_MM;

  /** Five rungs `fitTestStep` apart, centred on the Stem fit stepper: at 0 with the default step
   *  that is -0.20 to +0.20, and after a first print a finer step tunes around the value that fit. */
  function fitTestLadder() {
    return computeFitTestLadder(stemTolValue, fitTestStep, STEM_TOL_MIN, STEM_TOL_MAX);
  }

  const fitStepControl = segmentedControl({
    label: 'Fit test step',
    options: FIT_TEST_STEP_OPTIONS.map((s) => ({ value: s.toFixed(2), label: `${s.toFixed(2)} mm` })),
    value: FIT_TEST_STEP_MM.toFixed(2),
    onChange: (v) => { fitTestStep = Number(v); renderFitTest(); },
  });
  // In a row of its own (.kc-fit-row in style.css), which setFitTestLock shows while Fit test is open.
  const fitStepRow = $('fitTestStepMount');
  fitStepRow.append(fitStepControl);

  /** {positions, indices} (fitTest.js's plain output) -> a real THREE.BufferGeometry, for the
   *  preview.
   *
   *  Copies `positions` rather than wrapping it: a `BufferAttribute` keeps whatever array it's
   *  given, and the export (`fitTestParts`) translates its own copy of the same pieces to bake
   *  in the row offset — sharing the array would let that move the preview's vertices too, out
   *  from under a mesh whose position is ALSO offset, doubling it up. */
  function plainToFitTestGeometry(plain) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(plain.positions.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(plain.indices, 1));
    g.computeVertexNormals();
    return g;
  }

  /** (Re)build the row for the current ladder and cap, and reframe the camera on it. Cheap
   *  enough (a handful of small booleans) to run with no busy chip, same as applyStemTolerance. */
  function renderFitTest() {
    if (!fitTestActive || !baseStemGeometry || !meta) return;
    let pieces;
    try {
      pieces = buildFitTestRow(
        {
          api: getManifoldApi(),
          baseStemGeometry,
          meta,
          letterContour: (text) => parseLetter(text, FIT_TEST_FONT_ID, 6),
        },
        fitTestLadder(),
      );
    } catch (e) {
      console.error(e);
      setStatus('Could not build the fit test for this cap.', 'err');
      return;
    }
    fitTestPieces = pieces;

    ensureFitTestMeshes(pieces.reduce((n, p) => n + (p.watertight ? 1 : 2), 0));
    let mi = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pieces) {
      minX = Math.min(minX, p.pieceBBox.min[0] + p.offsetX);
      maxX = Math.max(maxX, p.pieceBBox.max[0] + p.offsetX);
      minY = Math.min(minY, p.pieceBBox.min[1]);
      maxY = Math.max(maxY, p.pieceBBox.max[1]);
      minZ = Math.min(minZ, p.pieceBBox.min[2]);
      maxZ = Math.max(maxZ, p.pieceBBox.max[2]);
      const place = (plain) => {
        const mesh = fitTestMeshes[mi++];
        mesh.geometry?.dispose();
        mesh.geometry = creaseNormals(plainToFitTestGeometry(plain));
        mesh.position.set(p.offsetX, 0, 0);
        mesh.visible = true;
      };
      if (p.watertight) place(p.geometry);
      else { place(p.tabGeometry); place(p.stemGeometry); }
    }

    const n = pieces.length;
    const values = pieces.map((p) => p.label).join(', ');
    setStatus(
      `Fit test ready · ${n} piece${n === 1 ? '' : 's'} (${values}) · press each stem onto a `
      + 'switch, then set Stem fit tolerance to the one that fits.',
    );

    const dist = framedDistance(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
    const target = new THREE.Vector3(0, (maxZ - minZ) / 2, 0);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0.5, 0.45, 0.75).multiplyScalar(dist));
  }

  /** proPanel.paint() relabels the footer on every Pro mode/tab change and does not know Fit
   *  test exists — called after anything that can trigger a paint while Fit test is open. */
  function syncFitTestExportLabel() {
    if (fitTestActive && exportBtn) exportBtn.textContent = FIT_TEST_EXPORT_LABEL;
  }

  /**
   * Fit test shows stems, not a keycap, so nothing that shapes the keycap may reach the screen
   * while it is open. Ian, after picking an icon in Fit test put a legend floating over a test
   * piece: "this and similar issues should not be possible".
   *
   * So the guarantee is structural rather than a list of mesh flags to remember:
   *  - the whole `printGroup` (cap, legend, stem, every extra legend) is hidden, so whatever a
   *    rebuild sets on a single mesh's `.visible`, none of it can draw;
   *  - `canRegen()` declines while this is open, so no rebuild runs in the first place;
   *  - the controls that only shape a keycap (the legend picker, placement, the cap toggles,
   *    the blank export) are `inert` and dimmed, so they cannot be used and say so.
   * Profile and size stay live (they change the stem under test), and so do the stem stepper,
   * the colours and Print settings, which all apply to the test pieces too.
   */
  function setFitTestLock(on) {
    const locked = [
      container.querySelector('.legend-section'),
      settings.panel('legend'),
      settings.panel('style'),
      settings.panel('font'),
      $('exportBlank'),
    ];
    for (const node of locked) {
      if (!node) continue;
      node.inert = on;
      node.classList.toggle('kc-fit-locked', on);
    }
    const note = $('fitTestNote');
    if (note) note.hidden = !on;
    fitStepRow.hidden = !on;
  }

  function enterFitTest() {
    if (fitTestActive) return;
    // A Pro mode owns the stage: hand it back to Single first, same as clicking its own tab —
    // stem fit is a profile setting, not a per-mode one, so Fit test should work from wherever
    // it's pressed rather than bouncing back with nothing shown. The one case it can't borrow
    // the stage is a set actually generating, which has nowhere to report into if stopped.
    if (singleCapSuspended && !proPanel?.goToSingle?.()) {
      setStatus('The set is still generating. Let it finish or cancel it first.', 'warn');
      fitTestControl.setValue('cap');
      return;
    }
    // No stem to test — bounce the tab back rather than leave it looking selected with nothing
    // to show.
    if (!baseStemGeometry) { fitTestControl.setValue('cap'); return; }
    fitTestActive = true;
    printGroup.visible = false; // a carve already asked for declines when its turn comes
    setFitTestLock(true);
    fitTestSavedCamera = { position: camera.position.clone(), target: controls.target.clone() };
    if (exportBtn) exportBtn.textContent = FIT_TEST_EXPORT_LABEL;
    renderFitTest();
  }

  function exitFitTest() {
    if (!fitTestActive) return;
    fitTestActive = false;
    ensureFitTestMeshes(0);
    fitTestPieces = null;
    fitTestControl.setValue('cap'); // a no-op if this IS how we got here (the user clicked it)
    setFitTestLock(false);
    // The cap's own meshes kept whatever visibility their last rebuild gave them (single colour,
    // shine-through, extra legends), so showing the group is enough; the rebuild below then
    // applies anything that changed while the fit test was open.
    printGroup.visible = true;
    if (exportBtn) exportBtn.textContent = FIT_TEST_IDLE_EXPORT_LABEL;
    if (fitTestSavedCamera) {
      camera.position.copy(fitTestSavedCamera.position);
      controls.target.copy(fitTestSavedCamera.target);
      fitTestSavedCamera = null;
    }
    scheduleRegen();
  }

  const fitTestControl = segmentedControl({
    options: [
      { value: 'cap', label: 'Keycap' },
      { value: 'fit', label: 'Fit test' },
    ],
    value: 'cap',
    onChange: (v) => { if (v === 'fit') enterFitTest(); else exitFitTest(); },
  });
  $('fitTestMount').append(fitTestControl);

  // Stem: the MX stem the caps are drawn with, or the low-profile one (shapes/lowProfile.js) for
  // low-profile MX-cross switches, which also cuts the cap down to suit them. Every MX cap takes
  // either, so it is a choice beside the profile, not a profile; Choc's stubs are another switch
  // and hide it.
  let stemType = 'mx';
  /** The stem the current cap is made with: always MX on a profile with stubs. */
  const capStem = () => (currentProfile?.stems === 'stubs' ? 'mx' : stemType);
  /** What a size's file is loaded with: the stem, and a shape's size (null: the shape's own
   *  default). */
  const shapeCap = { sizeMM: null };
  const capSettings = () => ({
    stem: capStem(),
    ...(isShapeProfile(currentProfile) ? { sizeMM: shapeCap.sizeMM ?? undefined } : {}),
  });
  /* A generated shape's width (shapes/). Its walls always come down flush with the stem; how tall
     it stands is Cap height, the same setting the modelled caps have. */
  const capSizeRow = sliderRow({
    label: 'Cap size', min: SIZE_RANGE_MM.min, max: SIZE_RANGE_MM.max, step: 0.1, value: DEFAULT_SIZE_MM.square, unit: 'mm',
    help: 'How wide the cap is. 18.1 mm fills the space of a standard MX cap.',
    onCommit: (v) => {
      shapeCap.sizeMM = v;
      reloadCap();
    },
  });
  capSizeRow.hidden = true;
  $('shapeCapMount').replaceWith(capSizeRow);
  /** Show the row on a shape, at the value the cap was built with. */
  function syncShapeRows() {
    const on = isShapeProfile(currentProfile) && meta?.sizeMM != null;
    capSizeRow.hidden = !on;
    if (!on) return;
    // A narrow tapered cap would put a wide key's outer stems through its wall: those sizes
    // start wider (shapes/dimensions.js).
    const range = sizeRangeMM(currentProfile.shape, unitSelect.value);
    capSizeRow.setBounds(range.min, range.max);
    capSizeRow.setValue(meta.sizeMM);
  }

  /** Load the size on screen again, as the cap's settings now say. */
  function reloadCap() {
    const entry = keycapManifest.find((k) => k.id === unitSelect.value);
    if (entry) switchKeycap(capFile(entry.file, capSettings()), entry.label);
    proPanel?.refresh(); // a board's caps are made the same way
  }
  const stemTypeControl = selectField({
    label: 'Stem',
    help: 'Low-profile MX is for low-profile switches with an MX cross (Gateron LP 2.0, Kailh Choc v2). The cap is cut down to suit them.',
    options: [
      { value: 'mx', label: 'MX' },
      { value: 'mx-lp', label: 'Low-profile MX' },
    ],
    value: 'mx',
    onChange: (v) => {
      stemType = v;
      reloadCap();
    },
  });
  $('stemTypeMount').replaceWith(stemTypeControl);

  // ---------------------------------------------------------------- cap height (capHeight.js)
  //
  // Two heights, shown as what they are in millimetres. Cap height is how tall the cap stands:
  // lowering it shortens the stem and the walls together, so the cap sits lower and its rim keeps
  // its place. Stem height is how far the stem reaches down: shorter than the walls, it ends
  // inside the cap and the cap sits lower still. Underneath they are the two trims capHeight.js
  // makes (`lowerMM`, `recessMM`). The cap as loaded is kept, and every change trims a fresh copy
  // of it, so the full heights give the loaded cap back exactly. Applied when the value is let go
  // of or typed, not on every step of a drag: a trim rebuilds the cap, and doing it then means
  // there is never a trim still waiting when an export reads the cap. Hidden on caps that already
  // rest on the switch's cross.
  let loadedCap = null;                 // the cap as loaded, never changed
  let trimLimits = { maxLower: 0, maxRecess: 0, safeRecess: 0, minWall: 0 };
  /** `wallMM`: how far the walls come down from the top, null for all the way (capHeight.js). */
  const capTrim = { lowerMM: 0, recessMM: 0, wallMM: null };
  /** Who hears a Dimension change: a paid board cuts its caps the same way (onShellEvent 'capTrim'). */
  const capTrimSubs = new Set();
  /** The loaded cap's own heights: its top above the rim, and its stem from the rim to the
   *  ceiling (the socket's depth). */
  const trimBase = { top: 0, stem: 0 };
  const r1 = (v) => Math.round(v * 10) / 10;
  const trimKind = () => ({ stubs: currentProfile?.stems === 'stubs' });
  const copyCap = (kc) => ({
    shellGeometry: kc.shellGeometry.clone(),
    stemGeometry: kc.stemGeometry ? kc.stemGeometry.clone() : null,
    meta: kc.meta,
  });
  const capLowerRow = sliderRow({
    label: 'Cap height', min: 0, max: 12, step: 0.1, value: 12, unit: 'mm',
    help: 'How tall the cap stands. Lower sits closer to the switch, and the stem shortens with it.',
    onCommit: (v) => { capTrim.lowerMM = r1(trimBase.top - v); applyCapTrim(); },
  });
  const stemRecessRow = sliderRow({
    label: 'Stem height', min: 0, max: 12, step: 0.1, value: 12, unit: 'mm',
    help: 'How far the stem reaches down. Shorter than the walls, it ends inside the cap and the cap sits lower.',
    onCommit: (v) => { capTrim.recessMM = r1(trimBase.stem - capTrim.lowerMM - v); applyCapTrim(); },
  });
  /* The walls alone, cut short from below: the top part of a cap on a full stem. All the way down
     is no cut (null), so the cap as loaded comes back exactly. */
  const wallRow = sliderRow({
    label: 'Wall height', min: 0, max: 12, step: 0.1, value: 12, unit: 'mm',
    help: 'How far the walls come down from the top. Shorter than the stem, the stem shows below them; the shortest is the top alone.',
    onCommit: (v) => { capTrim.wallMM = v; applyCapTrim(); },
  });
  $('capTrimMount').append(capLowerRow, wallRow, stemRecessRow);

  /** Show the rows this cap can use, with its own limits, and the values clamped to them. */
  function syncCapTrimRows() {
    Object.assign(capTrim, clampCapTrim(capTrim, trimLimits, trimBase.top));
    capLowerRow.hidden = !trimLimits.maxLower;
    stemRecessRow.hidden = !trimLimits.maxRecess;
    wallRow.hidden = !trimLimits.minWall;
    const full = r1(trimBase.top - capTrim.lowerMM);
    if (trimLimits.minWall) wallRow.setBounds(trimLimits.minWall, full);
    wallRow.setValue(capTrim.wallMM ?? full);
    if (trimLimits.maxLower) capLowerRow.setBounds(r1(trimBase.top - trimLimits.maxLower), r1(trimBase.top));
    // The stem can be as long as the walls, and as short as the socket that is left allows.
    const stemTop = trimBase.stem - capTrim.lowerMM;
    const recessRoom = Math.min(trimLimits.maxRecess, Math.max(0, trimLimits.maxLower - capTrim.lowerMM));
    if (trimLimits.maxRecess) stemRecessRow.setBounds(r1(stemTop - recessRoom), r1(stemTop));
    capLowerRow.setValue(r1(trimBase.top - capTrim.lowerMM));
    stemRecessRow.setValue(r1(stemTop - capTrim.recessMM));
  }

  /** A freshly loaded cap: kept as loaded (the two settings trim copies of it), its limits shown,
   *  and put on screen at the current settings. Every cap load goes through here. */
  function showLoadedCap(kc) {
    if (loadedCap) {
      loadedCap.shellGeometry.dispose();
      loadedCap.stemGeometry?.dispose();
    }
    loadedCap = kc;
    trimLimits = capTrimLimits(kc.meta, trimKind());
    const sb = kc.meta.stemBbox;
    trimBase.top = kc.meta.topZ;
    trimBase.stem = kc.meta.socketDepthMM ?? (sb ? sb.max[2] - sb.min[2] : 0);
    syncCapTrimRows();
    setKeycap(trimCap(getManifoldApi(), copyCap(kc), capTrim, trimKind()));
  }

  /** The loaded cap, trimmed to the current settings, on screen. */
  function applyCapTrim() {
    if (!loadedCap) return;
    syncCapTrimRows();
    setKeycap(trimCap(getManifoldApi(), copyCap(loadedCap), capTrim, trimKind()), { retrim: true });
    if (canRegen()) scheduleRegen();
    for (const fn of capTrimSubs) fn({ target: { value: { ...capTrim } } });
  }

  // ---------------------------------------------------------------- nudge d-pad
  //
  // The pad does not replace the nudge values, it DRIVES them: it clamps against whatever range
  // this cap allows (setNudgeRange), writes the hidden range and its number box, and then
  // announces — so everything already listening for a nudge hears it exactly as it would from a
  // dragged slider. That includes a Pro mode that has the nudge pointed at a different legend,
  // which is why this must not write `currentOpts` directly.
  function nudgeBy(dx, dy) {
    const move = (ctl, id, d) => {
      if (!d) return;
      const input = $(id);
      const lo = parseFloat(input.min), hi = parseFloat(input.max);
      ctl.set(Math.min(hi, Math.max(lo, Math.round((ctl.get() + d) * 100) / 100)));
    };
    move(C.offx, 'offx', dx);
    move(C.offy, 'offy', dy);
    announce(['offx', 'offy']); // the range's own listener syncs its number box
    scheduleRegen();
  }
  /* The kit's nudgePad(): the d-pad and the X/Y fields as one control. It builds the two
     number inputs, so they keep the ids the rest of this file and both paid modes already
     bind to (`offxNum` / `offyNum`) — the pad is a new way to reach the same values, not a
     new place for them to live. Arrow presses come back through `onMove` and go out through
     `nudgeBy`, which is what clamps against the hidden per-cap ranges. */

  // The cap's switches, from the kit. Their checkboxes keep the ids the rest of this file and the
  // paid modes read and listen to (`$('through')` and the like), and a kit switch draws its state
  // from its checkbox, so a value set from code shows on screen too.
  const capSwitch = (id, label, help) => toggleSwitch({ id, label, ...(help ? { help } : {}) });
  const homingRow = capSwitch('homingBump', 'Homing bump');
  homingRow.id = 'homingBumpRow';
  // Shine-through, single colour and raised are the Style picker's state: their switches stay,
  // hidden, because the app and the paid modes read and listen to them by id.
  const throughRow = capSwitch('through', 'Shine through');
  const singleRow = capSwitch('single', 'Single color, recessed legend');
  const raisedSwitchRow = capSwitch('raised', 'Raised legend');
  for (const r of [throughRow, singleRow, raisedSwitchRow]) r.hidden = true;
  /* A cap cut in half, drawn small: what each style does to the top. The legend in the accent
     blue, light in amber, the cap a grey that reads on both themes. */
  const styleDrawing = (legend, { notch = false, light = false } = {}) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84"><path fill="#6b7587" d="M16 74L28 30${notch ? 'H48V36H72V30' : ''}H92L104 74H94L84 38H36L26 74Z"/>${legend}${light ? '<path d="M60 6v11M45 10l5 8M75 10l-5 8" stroke="#f5b942" stroke-width="3" stroke-linecap="round" fill="none"/>' : ''}</svg>`,
  )}`;
  const stylePicker = segmentedControl({
    variant: 'tiles',
    columns: 2,
    label: 'Style',
    help: 'How the legend is made: flush in a second colour, standing on the top, carved in one colour, or carved through to light up.',
    options: [
      { value: 'flush', label: 'Flush', image: styleDrawing('<rect x="48" y="30" width="24" height="5" fill="#5b9dff"/>') },
      { value: 'raised', label: 'Raised', image: styleDrawing('<rect x="48" y="22" width="24" height="8" fill="#5b9dff"/>') },
      { value: 'engraved', label: 'Engraved', image: styleDrawing('', { notch: true }) },
      { value: 'through', label: 'Shine-through', image: styleDrawing('<rect x="48" y="30" width="24" height="8" fill="#cfe2ff"/>', { light: true }) },
    ],
    value: 'flush',
    onChange: (v) => setStyle(v),
  });
  /* How to print shine-through: three pictures drawn from this app's own cap (scripts/guide), one
     line each. Offered under the tiles while Shine-through is the style, because what makes it
     work happens in the slicer and on the spool, not here. */
  const shineGuideBtn = button({ label: 'How to print shine-through', emphasis: 'secondary', block: true, icon: ICONS.help });
  shineGuideBtn.hidden = true;
  shineGuideBtn.addEventListener('click', () => {
    const steps = [
      ['cutaway', 'Print the legend and the stem in clear filament (transparent PLA or PETG). The cap can be any opaque colour.'],
      ['parts', 'The file already puts the legend and the stem on filament 2. In the slicer, load the clear filament as filament 2.'],
      ['lit', 'On a keyboard with lights under the keys, the light comes up the stem and out through the legend.'],
    ];
    dialog({
      title: 'How to print shine-through',
      content: el('div', { className: 'kc-guide' }, steps.map(([pic, text], i) => el('figure', { className: 'kc-guide__step' }, [
        el('img', { attrs: { src: assetUrl(`guides/shine-${pic}.png`), alt: '', width: '640', height: '440' } }),
        el('figcaption', { text: `${i + 1}. ${text}` }),
      ]))),
      actions: [{ label: 'Got it', primary: true }],
    });
  });

  /** Turn the hidden state to a style, telling whoever listens, as the switches did. */
  function setStyle(v) {
    const want = { through: v === 'through', single: v === 'engraved', raised: v === 'raised' };
    for (const id of ['through', 'single', 'raised']) {
      if ($(id).checked !== want[id]) {
        $(id).checked = want[id];
        announce([id], 'change');
      }
    }
    applyModeFlags();
    scheduleRegen();
  }
  // Raised legend: the legend stands on the top instead of sitting in it (geometry.js). It is the
  // third way to print a legend, beside shine-through and single colour, and like them one at a
  // time; the depth gives way to how far it stands.
  const raiseRow = sliderRow({
    label: 'Raise by', min: 0.2, max: 1.5, step: 0.1, value: 0.6, unit: 'mm',
    help: 'How far the legend stands above the top.',
    // Announced as the switch's change: a paid mode listens to that, and a new height is the
    // same news to it (it reads the height back through `raisedMM`).
    onInput: () => { scheduleRegen(); announce(['raised'], 'change'); },
  });
  raiseRow.hidden = true; // shown while Raised legend is on (applyModeFlags)
  $('styleMount').replaceWith(stylePicker, shineGuideBtn);
  $('capSwitchesMount').replaceWith(raiseRow, capSwitch('mirror', 'Mirror horizontally'), throughRow, singleRow, raisedSwitchRow);
  $('homingBumpMount').replaceWith(homingRow);
  /** How far the legend stands above the top, or 0 when it is carved in. */
  const raisedMM = () => ($('raised').checked ? raiseRow.getValue() : 0);

  $('mirror').addEventListener('change', scheduleRegen);
  $('homingBump').addEventListener('change', scheduleRegen);
  // Shine-through, single-colour and raised are mutually exclusive: one prints the legend in a
  // second (transparent) filament, one engraves it in the single cap filament, one stands it up.
  $('through').addEventListener('change', () => {
    if ($('through').checked) { $('single').checked = false; $('raised').checked = false; }
    applyModeFlags(); scheduleRegen();
  });
  $('single').addEventListener('change', () => {
    if ($('single').checked) { $('through').checked = false; $('raised').checked = false; }
    applyModeFlags(); scheduleRegen();
  });
  $('raised').addEventListener('change', () => {
    if ($('raised').checked) {
      // Announced, unlike the two above: a paid mode listens to these two and not to this one.
      for (const id of ['through', 'single']) {
        if ($(id).checked) { $(id).checked = false; announce([id], 'change'); }
      }
    }
    applyModeFlags(); scheduleRegen();
  });
  $('capColor').addEventListener('input', () => { capMat.color.set($('capColor').value); });
  $('logoColor').addEventListener('input', () => { logoMat.color.set($('logoColor').value); });

  /* Filament swatches, the same shelf the clicker picks from.

     A `<input type="color">` is the wrong instrument for a printed object: it asks the user
     to invent a colour out of sixteen million, when what they are choosing is a spool they
     own. The two inputs are still here, hidden, because they are the state everything else
     reads — `$('capColor').value`, the project file, and both paid modes, which listen for
     their `input` event. Each row writes its hex into one and announces it, so a swatch press
     and a typed hex are the same event to everything downstream. */
  function paletteFor(id, label, mount, labelId) {
    const input = $(id);
    const row = paletteRow({
      label,
      labelId,
      value: input.value,
      onChange: (hex) => {
        if (hex.toLowerCase() === input.value.toLowerCase()) return;
        input.value = hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
    });
    $(mount).replaceWith(row);
    // A project load, or a reset, writes the input directly — the swatches follow.
    input.addEventListener('input', () => row.setValue(input.value));
    return row;
  }
  // `logoColorLabel` is the id a paid mode renames ("Legend" -> "Legend 1"), so the row is
  // asked for it rather than reached into afterwards.
  const capColorRow = paletteFor('capColor', 'Keycap', 'capColorMount');
  const logoColorRow = paletteFor('logoColor', 'Legend', 'logoColorMount', 'logoColorLabel');

  // ---------------------------------------------------------------- print settings
  /* What the exported 3MF tells the slicer. One choice today: the wall generator. Arachne by
     default: variable-width walls keep a legend's thin strokes from dropping out and make
     layer lines less visible. Ian asked for it to be the user's call: "add a print setting
     section where user can set arachne wall for his export". Read at export time by
     `printConfig()` and `projectProcess()` in exports.js. */
  let wallGenerator = 'arachne';
  const wallsRow = segmentedControl({
    label: 'Walls',
    options: [
      { value: 'arachne', label: 'Arachne' },
      { value: 'classic', label: 'Classic' },
    ],
    value: wallGenerator,
    onChange: (v) => { wallGenerator = v; },
  });
  $('printSettingsMount').replaceWith(wallsRow);

  // ---------------------------------------------------------------- resets
  // Stock values for the per-section reset buttons. `size` is replaced at boot
  // once we know the sensible default for this cap's geometry.
  const DEFAULTS = {
    size: 8, depth: 0.5, rot: 0, offx: 0, offy: 0, stemTol: 0,
    mirror: false, through: false, single: false, homingBump: false,
    // Both are shelf colours from the kit's filament list, so the palette opens with a
    // swatch selected rather than inventing a custom one for a hex nobody prints.
    capColor: '#161616', logoColor: '#f7f7f5',
  };

  // Reflect the current shine-through / single-colour state on dependent inputs.
  // Shine-through prints the legend through the wall, so depth no longer applies.
  // Single-colour engraves the legend in the cap filament, so the legend colour is moot.
  function applyModeFlags() {
    // Shine-through carves right through and a raised legend has a height instead: neither
    // has a depth to set, so the row goes (hidden, never greyed).
    const raised = $('raised').checked;
    raiseRow.hidden = !raised;
    C.depth.row.hidden = raised || $('through').checked;
    shineGuideBtn.hidden = !$('through').checked;
    stylePicker.setValue(raised ? 'raised' : $('through').checked ? 'through' : $('single').checked ? 'engraved' : 'flush');
    // Both: the hidden input is what a paid mode reads, the row is what the user sees. Only
    // disabling the input left the swatches live in single-colour mode, offering a choice
    // that no longer prints.
    $('logoColor').disabled = $('single').checked;
    logoColorRow.setDisabled($('single').checked);
    updateStemMaterial();
  }

  /**
   * Tell everyone the value changed.
   *
   * `C.*.set()` and a direct `.checked =` assign the property, which fires nothing — fine when
   * the only listener was this file's own `scheduleRegen`, and wrong the moment anything else
   * is listening. A Pro mode watching these inputs is exactly that: without this, Reset
   * placement silently moved the sliders and left the board drawn at the old numbers.
   */
  function announce(ids, type = 'input') {
    for (const id of ids) {
      const key = type === 'input' ? SLIDER_IDS[id] : null;
      if (key) {
        const value = String(C[key].get());
        for (const fn of sliderSubs.get(key)) fn({ target: { value } });
      } else $(id)?.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  function resetPlacement() {
    C.size.set(DEFAULTS.size);
    textHeightMM = null; // text starts again from the default, as tall as it fits
    fitTextSize();
    C.depth.set(DEFAULTS.depth);
    C.rot.set(DEFAULTS.rot);
    C.offx.set(DEFAULTS.offx);
    C.offy.set(DEFAULTS.offy);
    setStemTol(DEFAULTS.stemTol);
    applyStemTolerance();
    if (capTrim.lowerMM || capTrim.recessMM) {
      capTrim.lowerMM = 0;
      capTrim.recessMM = 0;
      applyCapTrim(); // re-renders the fit test itself, through setKeycap
    }
    if (fitTestActive) renderFitTest();
    $('mirror').checked = DEFAULTS.mirror;
    $('through').checked = DEFAULTS.through;
    $('single').checked = DEFAULTS.single;
    $('raised').checked = false;
    raiseRow.setValue(0.6);
    $('homingBump').checked = DEFAULTS.homingBump;
    applyModeFlags();
    announce(['size', 'depth', 'rot', 'offx', 'offy']);
    announce(['mirror', 'through', 'single', 'homingBump'], 'change');
    scheduleRegen();
  }

  function resetColors() {
    $('capColor').value = DEFAULTS.capColor;
    $('logoColor').value = DEFAULTS.logoColor;
    capMat.color.set(DEFAULTS.capColor);
    logoMat.color.set(DEFAULTS.logoColor);
    announce(['capColor', 'logoColor']);
  }

  function resetLegend() {
    if (currentMode !== 'icon') setLegendMode('icon');
    searchEl.value = '';
    rebuildGallery();
    const first = defaultLucideIcon();
    if (first) selectIcon(first.el || galleryEl.firstElementChild, first.getText, first.name);
  }

  // One reset per place: the Legend category's placement, the Colors category, the legend picked.
  const resetPlacementBtn = button({ label: 'Reset placement', emphasis: 'secondary', block: true, icon: ICONS.rotateLeft });
  resetPlacementBtn.addEventListener('click', resetPlacement);
  $('resetPlacementMount').replaceWith(resetPlacementBtn);
  const resetColorsBtn = button({ label: 'Reset colors', emphasis: 'secondary', block: true, icon: ICONS.rotateLeft });
  resetColorsBtn.addEventListener('click', resetColors);
  $('resetColorsMount').replaceWith(resetColorsBtn);
  const resetLegendBtn = iconButton({ label: 'Reset legend', icon: ICONS.rotateLeft });
  resetLegendBtn.addEventListener('click', () => legendSink.reset());
  $('resetLegendMount').replaceWith(resetLegendBtn);

  // ---------------------------------------------------------------- geometry
  /**
   * Where the FIRST legend's placement sits while something else has the sliders.
   *
   * Normally — and always, in the free build — the sliders are the first legend's placement and
   * this is null. A mode that borrows them to edit a different legend has to park the first
   * one's numbers somewhere, or every drag moves both legends: the sliders would be showing one
   * legend and `currentOpts` would be carving the other with them.
   *
   * @type {{sizeMM:number, depth:number, rotationDeg:number, offsetX:number, offsetY:number}|null}
   */
  let placementOverride = null;

  function currentOpts() {
    const p = placementOverride;
    return {
      widthMM: p ? p.sizeMM : C.size.get(),
      depth: p ? p.depth : C.depth.get(),
      centerX: meta.center[0] + (p ? p.offsetX : C.offx.get()),
      centerY: meta.center[1] + (p ? p.offsetY : C.offy.get()),
      rotationDeg: p ? p.rotationDeg : C.rot.get(),
      mirror: $('mirror').checked,
      through: $('through').checked,
      singleColor: $('single').checked,
      homingBump: $('homingBump').checked,
      homingBumpGeom: homingBumpGeometry,
      raisedMM: raisedMM(),
    };
  }

  /**
   * The same options for an EXTRA legend, whose placement is carried on its layer rather than
   * read off the sliders (the sliders show whichever layer is being edited).
   *
   * Mirror, shine-through and single-colour are still read live, because they are properties of
   * the CAP and not of a legend: a cap cannot have one legend printed through the top and
   * another one not, and a mirrored cap is mirrored. The homing bump is forced off for a
   * different reason — it is unioned into the cap by the FIRST pass, and a later pass asking
   * for it again would merge a second copy into a cap that already has one.
   */
  function placementOpts(p) {
    return {
      widthMM: p.sizeMM,
      depth: p.depth,
      centerX: meta.center[0] + p.offsetX,
      centerY: meta.center[1] + p.offsetY,
      rotationDeg: p.rotationDeg,
      mirror: $('mirror').checked,
      through: $('through').checked,
      singleColor: $('single').checked,
      homingBump: false,
      homingBumpGeom: null,
      raisedMM: raisedMM(),
    };
  }

  /**
   * Would a rebuild carve anything now? A Pro mode owns the stage, Fit test is open, or there is
   * no legend or no cap yet: then a change is not carved, and a carve already asked for declines
   * quietly when its turn comes.
   *
   * `switchKeycap` turns the chip on and leaves it to the rebuild to turn off again. When the
   * rebuild declines — a Pro mode owns the stage, or there is no legend yet — nothing else
   * ever did: changing profile from inside the Full set mode pinned "generating…" over the
   * preview for the rest of the session.
   */
  function canRegen() {
    // A Pro mode owns the stage — the cap this would rebuild is hidden behind its board. Fit
    // test is the same case in the free app: the stage shows test pieces, and a rebuild is what
    // used to put a legend back on screen over them. exitFitTest() rebuilds on the way out.
    return !singleCapSuspended && !fitTestActive && !!currentLegend && !!meta && !!shellGeometry;
  }

  /** The single cap as a carve reads it (rebuild.js), or null when there is nothing to carve. */
  function carveSettings() {
    if (!canRegen()) return null;
    return {
      shell: shellGeometry,
      meta,
      profile: currentProfile,
      profileTag: profileSlug(),
      legend: currentLegend,
      opts: currentOpts(),
      extras: extraLegends.map((layer) => ({ legend: layer.legend, opts: placementOpts(layer.placement) })),
      // A stem recessed past the safe depth: the rim may touch the switch when pressed (rebuild.js).
      // A made shape knows how far the key travels before its sides meet the switch, which says
      // the same thing better: its trimmed meta already counts the recess (capHeight.js).
      rimRecess: meta.travelMM == null && capTrim.recessMM > trimLimits.safeRecess + 1e-6 ? capTrim.recessMM : 0,
      travel: meta.travelMM ?? null,
      // Typed text, whose letters earn a warning when they come out small (rebuild.js).
      text: currentMode === 'letter',
    };
  }

  /** The carve on screen, whose geometry is freed when the next one replaces it. */
  let shownCarve = null;
  /** The busy chip is the rebuild's while it shows it: a batch or a paid mode may own it. */
  let chipIsRebuilds = false;

  const loop = rebuildLoop({
    settings: carveSettings,
    onStart: () => {
      if (!canRegen()) return;
      chipIsRebuilds = true;
      setBusyState('generating…');
    },
    onShow: showCarve,
    onFail: (e) => {
      console.error(e);
      setStatus('Could not generate this legend (try a simpler icon/letter or smaller size).', 'err');
    },
    onIdle: () => {
      scheduleNote(); // the cap on screen is settled: one step of undo, once the chain stops
      if (!chipIsRebuilds) return;
      chipIsRebuilds = false;
      setBusyState(null);
    },
  });
  cleanups.push(() => loop.dispose()); // a queued rebuild would otherwise run into a torn-down scene

  /** Something the cap is carved from changed: carve it again, 200 ms after the last change. */
  function scheduleRegen() {
    if (canRegen()) loop.request();
  }

  /** Carve it again now, with no wait: a new legend was picked. */
  function regenNow() {
    if (!canRegen()) return;
    loop.request();
    loop.flush();
  }

  /** A finished carve, on screen. */
  function showCarve(carve) {
    const { keycapGeometry: capG, logoGeometry: logoG, extraGeometries: extraG } = carve.bodies;
    // Preview meshes get creased normals (cosmetic); export keeps the clean indexed solids.
    capMesh.geometry?.dispose();
    logoMesh.geometry?.dispose();
    if (shownCarve) {
      shownCarve.bodies.keycapGeometry?.dispose();
      shownCarve.bodies.logoGeometry?.dispose();
      for (const g of shownCarve.bodies.extraGeometries ?? []) g?.dispose();
    }
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
    ensureExtraMeshes(extraG.length);
    extraG.forEach((g, i) => {
      const { mesh, mat } = extraLegendMeshes[i];
      mesh.geometry?.dispose();
      mesh.geometry = g ? creaseNormals(g) : undefined;
      mesh.visible = !!g;
      mat.color.set(extraLegends[i].color);
    });
    updateStemMaterial();
    shownCarve = carve;

    // Every warning counted, the worst shown: "2 problems · …" when the legend is both too big
    // for the top and on a curved one, where the line used to show the first alone.
    status.setDiagnostics(carve.report.diagnostics, carve.report.ok);
  }

  /** The rebuild lock (rebuild.js): a batch (the alphabet set, a paid set) holds the loop, so no
   *  preview rebuild runs Manifold beside it, and gives it back to a rebuild of the current inputs. */
  const rebuildLock = createRebuildLock(loop, scheduleRegen);

  // ---------------------------------------------------------------- legend sink
  /**
   * Where the right panel's legend picker writes.
   *
   * The picker — type cards, icon gallery, search, letter box, font list — is the same
   * control in every mode; only its TARGET changes. On the single cap it drives the one
   * legend. In the Pro keyboard set it drives whichever key or group is selected, and the
   * gallery, the search and the font list all work exactly as they already did.
   *
   * Swapping a sink rather than building a second picker is what keeps the set mode looking
   * like the rest of the app: there is only one legend picker, and it is this one.
   *
   * The four events are kept apart on purpose. They all mean "re-render this legend" on the
   * single cap, so an earlier version routed the lot through one `letter()` — and that is
   * destructive the moment the target is a SELECTION: changing the font fired the same call
   * that types into a legend, which wrote the letter box's contents onto every selected key.
   */
  const singleCapSink = {
    icon: (name, getText, el) => { void selectIcon(el, getText, name, 'icon'); },
    /** An uploaded or bundled SVG. On ONE cap it is the same act as picking a lucide icon —
     *  parse the markup, carve it — and only the keyboard set needs the two kept apart, because
     *  it stores a lucide icon by name and an upload by content. */
    svg: (name, getText, el) => { void selectIcon(el, getText, name, 'svg'); },
    /** The user typed in the letter box. */
    letter: () => selectLetter(),
    /** The user picked a different font — same legend, different shapes. */
    font: () => selectLetter(),
    /** The user clicked one of the Icon / SVG / Letter cards. */
    typeChanged: (mode) => {
      if (mode === 'letter') selectLetter();
      else if (lastIconSelection) {
        void selectIcon(lastIconSelection.el, lastIconSelection.getText, lastIconSelection.name, lastIconSelection.kind);
      }
    },
    reset: () => resetLegend(),
  };
  let legendSink = singleCapSink;

  // ---------------------------------------------------------------- icons
  async function selectIcon(el, getText, name, kind = 'icon') {
    const pick = ++iconPick;
    container.querySelectorAll('.icon.active').forEach((n) => n.classList.remove('active'));
    el?.classList.add('active'); // null: a restored icon whose tile is not drawn yet
    setStatus('Loading icon…');
    try {
      const text = await getText();
      if (pick !== iconPick) return;
      currentLegend = { ...parseLogo(text), name };
      lastIconSelection = { el, getText, name, kind };
      legendSourceState = kind === 'svg' ? { type: 'svg', name, svg: text } : { type: 'icon', name };
      updateSizeMax();
      regenNow();
    } catch (e) {
      console.error(e);
      setStatus(`Couldn't read “${name}”.`, 'err');
    }
  }

  /**
   * One gallery tile.
   *
   * `kind` says which gallery it came from, and it is the tile's job to say so because nothing
   * downstream can tell: a lucide icon and an uploaded file arrive here as the same pair of a
   * name and a getText. The keyboard set stores the two differently — an icon by name, an
   * upload by content — so a tile that could not name its own kind used to be stored as a
   * lucide icon whatever it was, and an upload then failed to resolve.
   */
  function makeIconEl(thumbUrl, getText, name, kind = 'icon') {
    // A <button>, not a <div>. Icon is the default legend mode and there are ~1750 tiles in
    // it, none of which a keyboard could reach while they were divs with a click listener.
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'icon';
    el.title = name;
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = name;
    el.appendChild(img);
    el.addEventListener('click', () => legendSink[kind](name, getText, el));
    return el;
  }

  /** Mark one gallery tile as the chosen one. Used by every sink, including the set's. */
  function markActiveIcon(name) {
    for (const tile of container.querySelectorAll('.icon')) {
      tile.classList.toggle('active', name != null && tile.title === name);
    }
  }

  function setLegendMode(mode) {
    currentMode = mode;
    // `.active` is a class, which the accessibility tree cannot see. The row calls itself a
    // tablist, so its tabs have to carry their own selected state as well.
    legendSource.setValue(mode);
    fontField.hidden = mode !== 'letter';
    settings.refresh();
    $('iconPanel').hidden = mode !== 'icon';
    $('uploadPanel').hidden = mode !== 'upload';
    $('letterPanel').hidden = mode !== 'letter';

    // Through the sink: on the single cap this re-renders the legend in the new type, and in a
    // Pro mode it does nothing but show the panel — picking a type is not the same as choosing
    // a legend, and acting on it would stamp the letter box over everything selected.
    legendSink.typeChanged(mode);
  }

  // Any cap takes a long word: it shrinks to fit (fitTextSize), and small letters are warned
  // about rather than refused (rebuild.js). The cap per legend is only a guard against a pasted
  // paragraph (letter.js). Takes the unit still, for the paid modes that ask per cap.
  function letterMaxLen(_unit) {
    return LEGEND_MAX_CHARS;
  }

  // Push the character cap onto the letter input, trimming any overflow.
  function applyLetterLimit() {
    const input = $('letterText');
    const max = letterMaxLen(currentUnit);
    input.maxLength = max;
    if (input.value.length > max) {
      input.value = input.value.slice(0, max);
      // Characters vanishing from a text box with nothing said reads as the app losing work.
      toast(`Legend trimmed to ${max} characters`, { kind: 'warn' });
      if (currentMode === 'letter') selectLetter();
    }
  }

  function selectLetter() {
    iconPick++; // an icon still loading must not land on top of the text
    container.querySelectorAll('.icon.active').forEach((n) => n.classList.remove('active'));
    const text = $('letterText').value;
    fontField.setSample(Array.from(text.trim() || 'A').slice(0, 6).join(''), text);
    const need = alphabetOf(text);
    if (need !== fontCardsNeed) {
      fontCardsNeed = need;
      fontField.setFonts(letterFontList(), fontCardsFor(text));
    }
    // Letters the face cannot draw would print as "?": typing them moves the text to the
    // plainest face that can, and says so. A face picked by hand keeps its mark and stays.
    if (text.trim() && !fontWritesText(currentFontId, text)) {
      const next = facesThatWrite(text)[0];
      if (next && next !== currentFontId) {
        toast(`${fontName(currentFontId)} has no ${need ? `${need} letters` : 'letters for that'}, so the text is set in ${fontName(next)}.`);
        void chooseFont(next); // carves again once the face has loaded
        return;
      }
    }
    try {
      currentLegend = parseLetter(text, currentFontId, letterMaxLen(currentUnit));
      legendSourceState = { type: 'letter', text, fontId: currentFontId };
      updateSizeMax();
      fitTextSize();
      // Fit test declines the rebuild (canRegen), so nothing would ever replace this line and it
      // would sit over the fit-test status for good. The letter still applies on the way out.
      if (!fitTestActive) setStatus('Generating letter…');
      scheduleRegen();
    } catch (e) {
      console.error(e);
      currentLegend = null;
      // The cap on screen is the previous legend's, which these letters no longer describe:
      // an Export now says so instead of quietly sending it.
      loop.invalidate();
      setStatus(e.message || 'Could not read this letter.', 'err');
    }
  }

  $('letterText').addEventListener('input', () => legendSink.letter());

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
      const el = makeIconEl(assetUrl(file), () => fetch(assetUrl(file)).then((r) => r.text()), name, 'svg');
      uploadGalleryEl.appendChild(el);
    }
    refreshUploadEmptyState();
  }

  /* Every upload goes through the import preview first: the file beside what the tracer will
     make of it, and Fill / Outline / Off per part. What the tile stores is the file WITH those
     choices written in (see svgPreview.js), so the paid dual legend and the keyboard set —
     which read the tile's markup and parse it themselves — get the same result as this cap. */
  async function addSvgFiles(files) {
    let firstEl = null;
    for (const file of files) {
      // Per file, and reported. The whole loop used to run unguarded: a file the tracer threw
      // on (applySvgChoices parses it a second time, and unlike describeLogo it does not catch)
      // rejected the promise, nothing was shown, and the rest of the selection was dropped.
      try {
        const text = await openSvgPreview(await file.text(), file.name.replace(/\.svg$/i, ''));
        if (text == null) continue; // the preview was cancelled — not a failure
        void rememberFile(host, 'svg', file);
        const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        const el = makeIconEl(url, async () => text, file.name.replace(/\.svg$/i, ''), 'svg');
        uploadGalleryEl.appendChild(el);
        if (!firstEl) firstEl = el;
      } catch (err) {
        console.error(err);
        setStatus(`Could not read ${file.name}.`, 'err');
        toast(`Could not read ${file.name}`, { kind: 'error' });
      }
    }
    refreshUploadEmptyState();
    if (firstEl) {
      setLegendMode('upload');
      firstEl.click();
    }
  }

  /* The kit's drop target, replacing a file-picker label under a line of copy that said
     "Drop any SVG here". Nothing in this app listened for a drop, so dropping a file on that
     panel did nothing — or, once the browser handled it, navigated the tab to the raw SVG and
     took the session with it. */
  const uploadDropEl = dropZone({
    title: 'Drop an SVG here',
    text: 'or click to browse',
    note: 'For brand and app logos, simpleicons.org is a good source',
    accept: '.svg,image/svg+xml',
    multiple: true,
    onFiles: (files) => { void addSvgFiles(files); },
  });
  $('uploadDrop').replaceWith(uploadDropEl);

  // In a desktop host the file comes from the host's own picker, so its click has to win
  // before the drop zone opens a browser file input. Capture phase, for that reason.
  uploadDropEl.addEventListener('click', (e) => {
    if (!host?.pickMedia) return;
    e.preventDefault();
    e.stopPropagation();
    void chooseFile(host, { kind: 'svg', extensions: ['svg'] }, () => {}).then(async (file) => {
      if (file) await addSvgFiles([file]);
    });
  });

  // ---------------------------------------------------------------- export
  /** The live preview as the MakerLab export's cover (exports.js `stageCover`). In practice
   *  preserveDrawingBuffer, on in the MakerWorld build, makes the real capture succeed. */
  const cover = () => stageCover(renderer, scene, camera);

  /** What an export reads, as the controls and the loaded cap say it now (exports.js). The
   *  carved cap itself comes from the rebuild loop, settled. */
  function exportState() {
    return {
      capColor: $('capColor').value,
      logoColor: $('logoColor').value,
      through: $('through').checked,
      extraColors: extraLegends.map((l) => l?.color),
      stem: stemGeometry,
      shell: shellGeometry,
      meta,
      profile: currentProfile,
      profileTag: profileSlug(),
      unit: currentUnit,
      unitId: $('unitSelect').value,
      fontId: currentFontId,
      opts: meta ? currentOpts() : null,
      fitTestActive,
      fitTestPieces,
      wallGenerator,
    };
  }

  const exportsApi = createExports({
    $,
    host,
    setStatus,
    setBusy: setBusyState,
    busyText: (text) => busyEl.setText(text),
    cover,
    pro: () => proPanel,
    begin: rebuildLock.begin,
    end: rebuildLock.end,
    busy: rebuildLock.held,
    settled: () => loop.settled(),
    flushStem: flushStemApply,
    state: exportState,
    fontWrites: fontWritesText,
  });
  const { runPrimaryExport, updateAlphabetAvailability, nudgeLicense, printConfig } = exportsApi;
  $('exportBlank').addEventListener('click', () => exportsApi.exportBlank());

  // ---------------------------------------------------------------- keycap swap
  // Install a freshly loaded keycap: dispose the old geometry, clean the new stem,
  // re-frame the camera, and reset the size to a sensible default for this cap.
  // Called at boot and whenever the size dropdown changes. (Manifold must be ready.)
  // Max legend size: a single icon (≈square) is capped by the cap's short side, but a wide
  // legend (multi-letter text) can stretch along the cap's long side. Scale the ceiling by the
  // legend's aspect ratio so long words on wide caps/spacebars can use the room available.
  function updateSizeMax() {
    if (!meta) return;
    C.size.setMax(legendSizeMax(currentLegend?.box ?? null, meta.topExtent).toFixed(1));
  }

  // Symmetric ± range for a nudge slider + its number box.
  function setNudgeRange(rangeId, numId, m) {
    $(rangeId).min = -m; $(rangeId).max = m;
    $(numId).min = -m; $(numId).max = m;
    // The pad clamps typed values against the same limit.
    nudge.setRange(numId === 'offxNum' ? 'x' : 'y', m);
  }

  /** Where the camera frames the cap (setKeycap), and the stage's view of it: Top looks straight
   *  down at the top, 3D from the front and above. Orbiting stays free in both. */
  let camFrame = null;
  function aimCamera() {
    if (!camFrame) return;
    const { target, dist } = camFrame;
    controls.target.copy(target);
    if (stageView === 'top') camera.position.set(target.x, target.y + dist, target.z + dist * 0.001);
    else camera.position.copy(target).add(new THREE.Vector3(0.5, 0.45, 0.75).multiplyScalar(dist));
    controls.update();
  }

  /**
   * Frame a new cap without throwing the view away. The first cap is framed from scratch; after
   * that the angle and zoom someone chose are theirs, so a cap of about the same size (another
   * profile, a new cap size, a different stem) leaves the camera exactly where it is. Only a cap
   * that would no longer fit, or would look lost, is re-framed, and then from the same angle at
   * the same relative zoom.
   */
  function frameCap(target, dist) {
    const prev = camFrame;
    camFrame = { target, dist };
    if (!prev) { aimCamera(); return; }
    const ratio = dist / prev.dist;
    if (ratio > 0.8 && ratio < 1.25) return;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(ratio);
    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.update();
  }

  /**
   * Put a cap on screen. `retrim`: the same cap, cut to a new height (applyCapTrim), so the camera
   * and the legend's size stay where they are.
   */
  function setKeycap(kc, { retrim = false } = {}) {
    // A carve of the previous cap no longer describes what is on screen: dropped when it lands,
    // and never handed to an export.
    loop.invalidate();
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

    // A re-trim is the same cap, a little shorter: the view and the legend's size stay put.
    if (!retrim) {
      // Frame the camera on the (now origin-centred) cap; pull the distance back proportionally
      // so wide caps (spacebars) still fit the viewport.
      const spanX = meta.bbox.max[0] - meta.bbox.min[0];
      const spanY = meta.bbox.max[1] - meta.bbox.min[1];
      // Aspect has to be current BEFORE the distance is computed: the framing below reads
      // camera.aspect, and on the first cap the camera is still at its placeholder 1:1.
      resize();
      // Framing: the cap's bounding sphere sits at a fixed fraction of whichever field of view
      // is narrower — vertical on a wide viewport, horizontal on a tall one — so the cap covers
      // the same share of the stage whatever the viewport's shape. A width multiplier cannot do
      // that: it says nothing about how much of the VIEW the cap covers. Orbit/zoom untouched,
      // and the same framing in every build.
      const dist = framedDistance(Math.hypot(spanX, spanY, meta.topZ) / 2);
      frameCap(new THREE.Vector3(0, standHeight / 2, 0), dist);
      resize();

      // sensible default size for this cap (also the value the placement reset restores)
      const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
      DEFAULTS.size = Math.round(room * 0.5 * 10) / 10;
      updateSizeMax(); // legend-aspect-aware ceiling (wide text can use the cap's length)
      // Text keeps its letter height and grows on a wider cap (fitTextSize). Anything else keeps
      // its size while it still fits the new cap; one that does not starts from this cap's own
      // size, and says so, rather than the slider simply jumping.
      if (!fitTextSize()) {
        const previousSize = C.size.get();
        const max = legendSizeMax(currentLegend?.box ?? null, meta.topExtent);
        if (!previousSize || previousSize > max + 1e-6) {
          C.size.set(DEFAULTS.size);
          if (previousSize && Math.abs(previousSize - DEFAULTS.size) > 0.05) {
            toast(`Legend size reset to ${DEFAULTS.size} mm for this cap`);
          }
        }
      }
    }

    // Nudge range follows the cap so the legend can reach the edges of wide caps/spacebars.
    setNudgeRange('offx', 'offxNum', Math.max(5, Math.ceil((meta.bbox.max[0] - meta.bbox.min[0]) / 2)));
    setNudgeRange('offy', 'offyNum', Math.max(5, Math.ceil((meta.bbox.max[1] - meta.bbox.min[1]) / 2)));

    applyLetterLimit(); // longer legends on bigger caps
    $('exportBlank').disabled = false; // blank export needs only the shell, ready now

    syncShapeRows();
    settings.refresh(); // Dimensions has nothing to show on a cap that sits on the cross
    $('meta').textContent = `Cap ${(meta.bbox.max[0] - meta.bbox.min[0]).toFixed(1)}×${(meta.bbox.max[1] - meta.bbox.min[1]).toFixed(1)}×${meta.topZ.toFixed(1)} mm · ${meta.triangles} tris · from ${meta.generatedFrom}`;

    // A cap with no stem has nothing for Fit test to show.
    fitTestControl?.setOptionVisible('fit', !!baseStemGeometry);
    if (fitTestActive) {
      if (!baseStemGeometry) exitFitTest();
      else renderFitTest(); // profile/size switch while open: rebuild against the new stem
    }
  }

  const profileSelect = $('profileSelect');
  const unitSelect = $('unitSelect');
  let keycapProfiles = [];     // [{ id, label, default, keycaps:[{ id, label, file, unit }] }]
  let currentProfile = null;   // the active profile object
  let keycapManifest = [];     // the active profile's size list (keycaps[])

  // Load a different keycap (profile/size) and rebuild the current legend on it.
  /** Cap loads in flight: an undo's settle waits for them (settleApply). */
  let capLoads = 0;
  async function switchKeycap(file, label) {
    capLoads++;
    // The chip is ours only while the single cap is what's on screen. Behind a Pro mode's board
    // this load is invisible, and that mode may have progress of its own up there.
    if (!singleCapSuspended) setBusyState('generating…');
    unitSelect.disabled = true;
    profileSelect.disabled = true;
    try {
      showLoadedCap(await loadKeycap(file));
      // Hand the chip to the rebuild only when one is actually going to run — see canRegen().
      if (canRegen()) scheduleRegen();
      else if (!singleCapSuspended) setBusyState(null);
    } catch (e) {
      console.error(e);
      if (!singleCapSuspended) setBusyState(null);
      setStatus(`Could not load ${label || 'this keycap'}.`, 'err');
    } finally {
      capLoads--;
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
    return profileTag(currentProfile, keycapProfiles.length);
  }

  // ------------------------------------------------- stage handover
  /**
   * Who is drawing into the viewport: this generator's single cap, or a Pro mode with a
   * scene of its own (the keyboard set's board).
   *
   * Handing the stage over is four things that must happen together, which is why it is one
   * function rather than four the caller has to remember: stop the render loop, hide the
   * canvas, stop rebuilding a cap nobody can see, and drop the one-cap readout. Getting the
   * third wrong is the expensive one — every slider move would run a full CSG rebuild behind
   * the board, competing with it for the same Manifold instance.
   */
  let singleCapSuspended = false;
  /** The undo row (built with the credit strip, below); hidden while a board owns the stage. */
  let historyRow = null;
  function setStageOwner(owner) {
    const pro = owner === 'pro';
    // Full set taking the stage always force-exits Fit test cleanly first — a stage-owning
    // mode's board is the only thing that gets to be on screen, and the fit-test row is not it.
    if (pro && fitTestActive) exitFitTest();
    singleCapSuspended = pro;
    setPaused(pro);
    renderer.domElement.style.display = pro ? 'none' : '';
    const metaEl = $('meta');
    if (metaEl) metaEl.hidden = pro; // describes one cap; meaningless for a board
    viewBar.root.hidden = pro; // aims the single cap's camera; a board has its own
    if (historyRow) historyRow.hidden = pro; // undo is the single cap's
    if (pro) {
      // Any rebuild still queued will now decline, so the chip it was going to clear has to be
      // put away here — before the mode starts using it for progress of its own.
      chipIsRebuilds = false;
      setBusyState(null);
    } else {
      resize();       // the viewport may have been resized while we weren't watching it
      scheduleRegen();
    }
  }

  // ------------------------------------------------- mode visibility
  /**
   * Controls that only make sense one cap at a time.
   *
   * The Pro keyboard set reuses this whole panel, so rather than a second sidebar it hides
   * the handful of controls a board has no answer for: the size dropdown (a board's widths
   * are per key), the A–Z batch (a different feature), the blank-cap export (one cap), and
   * the homing bump (chosen per key there, not for all sixty-one).
   */
  let singleOnlyVisible = true;
  function applyModeVisibility() {
    const show = singleOnlyVisible;
    for (const id of ['kcUnitField', 'alphabetBlock', 'exportBlank']) {
      const node = $(id);
      if (node) node.hidden = !show;
    }
    const bumpRow = $('homingBumpRow');
    // Two independent reasons to hide it; the profile's is not the mode's to overwrite.
    if (bumpRow) bumpRow.hidden = !show || currentProfile?.homingBump === false;
    settings.refresh(); // a mode shows or hides a whole category (Layout) when it switches
  }

  // ------------------------------------------------- per-profile capabilities
  // Not every profile is a Cherry-style cap with a dished top and a cross stem, and a few
  // controls only make sense on one that is. The rules ride along on the profile entry in
  // index.json (emitted from PROFILE_TUNING in scripts/convert-keycap.mjs), so the geometry
  // and the rules about it stay in one place. A profile that says nothing gets everything,
  // which is why the three original profiles are unaffected.
  function applyProfileCaps(profile) {
    // Choc's stubs go into another switch: there is no MX stem to choose.
    stemTypeControl.hidden = profile?.stems === 'stubs';
    // Homing bump: one shared mesh, positioned by constants hardcoded to the Standard 1u cap
    // and shaped for its dish. It has no business on a flat 3.5 mm Choc top.
    // Visibility is shared with the mode rules (set mode picks the bump per key), so it is
    // decided in one place rather than fought over by two.
    if ($('homingBumpRow')) {
      const allowed = profile?.homingBump !== false;
      applyModeVisibility();
      if (!allowed && $('homingBump').checked) {
        $('homingBump').checked = false;
        scheduleRegen();
      }
    }

    // Shine-through subtracts a prism through the FULL height of the shell. On a Cherry cap
    // the cavity below is empty so that's safe. The two Choc stubs attach only ±2.85 mm from
    // the cap centre — directly under the legend — so it would cut the stems off the cap.
    {
      const allowed = profile?.shineThrough !== false;
      stylePicker.setOptionVisible('through', allowed);
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
    C.depth.setMax(maxDepth);
    if (C.depth.get() > maxDepth) C.depth.set(maxDepth);

    // Print note: how this profile has to be oriented on the plate, if it's not the usual way.
    const note = $('profileNote');
    if (note) {
      note.textContent = profile?.print ?? '';
      note.hidden = !profile?.print;
    }
  }

  /** The profile picker: a picture of each profile's 1u cap (drawn once the app is up) over its
   *  name. It drives the hidden `profileSelect`, which is what everything else reads. */
  let profilePicker = null;
  let picturesStopped = false;
  cleanups.push(() => { picturesStopped = true; });
  function buildProfilePicker(value) {
    profilePicker = segmentedControl({
      variant: 'tiles',
      size: 'compact',
      label: 'Profile',
      columns: 3,
      // "Standard profile" is the file's name for it; on a tile under the heading Profile, the
      // word is said once already.
      options: keycapProfiles.map((p) => ({ value: p.id, label: p.label.replace(/ profile$/i, '') })),
      value,
      onChange: (v) => {
        if (profileSelect.value === v) return;
        profileSelect.value = v;
        profileSelect.dispatchEvent(new Event('change'));
      },
    });
    $('profilePickerMount').replaceWith(profilePicker);
    setTimeout(() => { void drawProfilePictures(); }, 400);
  }
  /** Each profile's 1u, drawn from its own mesh by the shelf's 3D viewer (`renderThumbnail`, the
   *  picture grab for cards), one at a time in a viewer of its own that is never shown, so the
   *  stage's renderer and its frame are not touched. A picture that fails is left pulsing. */
  async function drawProfilePictures() {
    let viewer = null;
    try {
      viewer = createViewer(document.createElement('div'), { alpha: true, observeTheme: false });
      for (const p of keycapProfiles) {
        if (picturesStopped) break;
        const entry = p.keycaps.find((k) => k.id === '1u') ?? p.keycaps[0];
        let kc = null;
        try {
          kc = await loadKeycap(entry.file);
        } catch { continue; }
        if (picturesStopped) break;
        const parts = [kc.shellGeometry, kc.stemGeometry].filter(Boolean).map((g, i) => ({
          name: i ? 'stem' : 'cap',
          positions: g.getAttribute('position').array,
          indices: Uint32Array.from(g.getIndex().array),
          color: [104, 112, 126],
        }));
        const url = viewer.renderThumbnail(240, parts);
        if (url) profilePicker?.setOptionImage(p.id, url);
        kc.shellGeometry.dispose();
        kc.stemGeometry?.dispose();
      }
    } catch (e) {
      console.warn('Profile pictures could not be drawn:', e);
    } finally {
      viewer?.dispose();
    }
  }

  profileSelect.addEventListener('change', () => {
    const profile = keycapProfiles.find((p) => p.id === profileSelect.value);
    if (!profile) return;
    profilePicker?.setValue(profile.id);
    currentProfile = profile;
    applyProfileCaps(profile);
    const entry = populateSizes(profile, unitSelect.value); // keep the current size if it exists
    currentUnit = entry.unit || 1;
    updateAlphabetAvailability();
    proPanel?.refresh(); // not every profile ships the sizes a keyboard layout needs
    syncFitTestExportLabel(); // refresh() can repaint the footer label; Fit test owns it for now
    switchKeycap(capFile(entry.file, capSettings()), `${profile.label} ${entry.label}`);
  });

  unitSelect.addEventListener('change', () => {
    const entry = keycapManifest.find((k) => k.id === unitSelect.value);
    if (entry) {
      currentUnit = entry.unit || 1;
      updateAlphabetAvailability();
      switchKeycap(capFile(entry.file, capSettings()), entry.label);
    }
  });

  // -------------------------------------------------- paid features (MakerWorld only)
  // Paid features are gated by the host and are only offered inside the
  // MakerLab embed, so the whole panel is fenced behind the compile-time MAKERLAB flag: the
  // public build drops the branch, and with it the panel, the layouts and the set builder.
  //
  // The panel owns its own purchase prompt and progress; what it needs from here is a
  // snapshot of the live settings and the regen lock, so a batch run can't collide with a
  // preview rebuild.
  let proPanel = null;
  /** The edited keyboard set, so it rides along in Save/Load like any other setting. */
  let keyboardSet = null;
  /** The second legend, likewise — an opaque blob the Pro mode writes and reads. */
  let dualLegend = null;
  if (MAKERLAB) {
    if ($('kcModeTabs')) {
      proPanel = mountProFeatures({
        container,
        // The shell's own anchors. The Pro modes render INTO these rather than into an
        // overlay of their own, which is the whole point: one set of panels, one look.
        hosts: {
          /** On the stage bar: the switch between one cap and a board. */
          tabs: $('kcModeTabs'),
          /** Top of the left panel, over the rail: the lifetime licence offer. */
          licence: $('kcLicenceMount'),
          profileExtra: $('kcProfileExtra'),
          /** The Layout category: a board's settings. Hidden (and the category with it) until a
           *  mode shows it; `applyModeVisibility` re-reads the rail. */
          layout: $('kcLayoutExtra'),
          /** Above the Size/Depth/Rotation/Nudge sliders — for a control that decides what
           *  those sliders are pointed at, and so has to be read before them. */
          placementLead: $('kcPlacementLead'),
          placementExtra: $('kcPlacementExtra'),
          legendExtra: $('kcLegendExtra'),
          /** In the Colors category, under the legend colour: an extra legend's own colour. */
          colorsExtra: $('kcColorsExtra'),
          /** The footer's export block. A purchase prompt goes HERE rather than in the panel
           *  that configures the paid feature, because the thing being refused is the export. */
          exportPanel: exportPanelEl,
          viewport,
        },
        /** What the shell lets a mode change about itself. */
        shell: {
          /** Hide the one-cap-only controls (size dropdown, A–Z, blank export, homing). */
          setSingleOnlyVisible: (v) => { singleOnlyVisible = v; applyModeVisibility(); },
          setStageOwner,
          /** Retarget the right panel's legend picker. Null restores the single cap. */
          setLegendSink: (sink) => { legendSink = sink ?? singleCapSink; },
          /**
           * The shell's own sink, for a mode that edits the first legend ALONGSIDE something
           * else and wants the picker to reach both. Delegating to it is the only way to set
           * the first legend without reimplementing the icon and letter paths — and a second
           * implementation of "the user picked an icon" is one that will drift.
           */
          ownLegendSink: singleCapSink,
          /**
           * What the primary button says in single mode when nothing is locked, and what every
           * paid mode restores when it hands the button back (see panel.js and setMode.js).
           * One constant rather than a literal per mode, so the button cannot come back from
           * Full set wearing a different name than it went in with.
           */
          defaultExportLabel: MAKERLAB ? 'Export 3MF' : 'Download 3MF',
          /** The picker's own controls, so a sink can show the selected key's legend. */
          legendUI: {
            setType: setLegendMode,
            markActiveIcon,
            get letterText() { return $('letterText').value; },
            set letterText(v) { $('letterText').value = v; },
            get fontId() { return currentFontId; },
            set fontId(v) { currentFontId = v; fontField.setValue(v); },
            setLetterMaxLength: (n) => { $('letterText').maxLength = n; },
            /** What the limit should be for the cap that is loaded. A mode handing the picker
             *  back needs this: the number is a property of the cap, not of the mode. */
            letterMaxLen: () => letterMaxLen(currentUnit),
            get letterMaxLength() { return $('letterText').maxLength; },
            // Readable as well as writable, so a mode that borrows the picker can put it back
            // exactly as it found it. A mode that can only WRITE the picker has to remember
            // what it did instead, and the two records drift the moment anything else moves.
            get type() { return currentMode; },
            get activeIcon() { return container.querySelector('.icon.active')?.title ?? null; },
          },
          /**
           * Relabel the one primary action for the active mode — including, in a paid mode that
           * has not been bought, to name the purchase and its price.
           *
           * There is deliberately no second seam for "locked". The button was greyed once, with
           * a separate Unlock button under it, and it made the user pick between an action and a
           * purchase that were the same intent — they pressed the dead one. One button that
           * changes what it says is the whole mechanism; what it does is decided by the gate at
           * the far end of the click, not here.
           */
          setExportLabel: (text) => { if (exportBtn) exportBtn.textContent = text; },
          /** Subscribe to shell inputs by id. Returns an unsubscribe. */
          onShellEvent: (ids, type, fn) => {
            // The kit's sliders and the font chooser are not the DOM inputs these ids once named:
            // their listeners go to the controls' own subscribers, with an input-shaped event.
            const offs = [];
            const seen = new Set();
            for (const id of ids) {
              const subs = type === 'input' && SLIDER_IDS[id] ? sliderSubs.get(SLIDER_IDS[id])
                : type === 'change' && id === 'fontSelect' ? fontSubs
                  : type === 'change' && id === 'capTrim' ? capTrimSubs : null;
              if (subs) {
                if (seen.has(subs)) continue;
                seen.add(subs);
                subs.add(fn);
                offs.push(() => subs.delete(fn));
                continue;
              }
              const n = $(id);
              if (!n) continue;
              n.addEventListener(type, fn);
              offs.push(() => n.removeEventListener(type, fn));
            }
            return () => { for (const off of offs) off(); };
          },
          /**
           * Show these values on the shell's own placement controls WITHOUT announcing them.
           * A mode calls this when the thing being edited changes (a different key selected),
           * which is a display update — announcing it would echo straight back as an edit.
           */
          setPlacementValues: ({ size, depth, rot, offx, offy }) => {
            if (size != null) C.size.set(size);
            if (depth != null) C.depth.set(depth);
            if (rot != null) C.rot.set(rot);
            if (offx != null) C.offx.set(offx);
            if (offy != null) C.offy.set(offy);
          },
          /**
           * The single cap's Size ceiling is that cap's top; a board needs its own.
           *
           * Null puts it back — and something has to, or leaving a mode leaves the slider at
           * whatever ceiling that mode wanted. `updateSizeMax` only runs when the legend or the
           * cap changes, so nothing else was ever going to restore it.
           */
          setSizeRange: (max) => { if (max == null) updateSizeMax(); else C.size.setMax(max); },

          /**
           * Put a tag at the end of the Size, Depth, Rotation and Nudge captions (the kit's
           * `setTag`), saying where the values come from while a mode points the controls at
           * something layered. Null takes them all off again.
           */
          setPlacementTags: (tags) => {
            C.size.row.setTag(tags?.size ?? null);
            C.depth.row.setTag(tags?.depth ?? null);
            C.rot.row.setTag(tags?.rot ?? null);
            nudge.setTag(tags?.nudge ?? null);
          },
          /** Which settings category is open on the left (Keycap, Legend, Colors…). */
          railCategory: () => settings.getValue(),

          /**
           * Carve these legends into the cap as well as the one the picker owns.
           *
           * Each entry is `{ legend, placement: {sizeMM, depth, rotationDeg, offsetX, offsetY,
           * mirror}, color }` — the placement in the same terms the sliders use, so a mode never
           * has to know about cap metadata or where the dish sits. Null or empty puts the cap
           * back to one legend. Always schedules a rebuild: the caller changed what the cap is.
           */
          setExtraLegends: (list) => {
            extraLegends = Array.isArray(list) ? list : [];
            scheduleRegen();
          },

          /**
           * Park the FIRST legend's placement here while the sliders are showing something
           * else. Null hands it back to the sliders. The object is read on every rebuild, so a
           * mode that mutates it in place gets what it changed on the next carve.
           */
          setPlacementOverride: (p) => { placementOverride = p ?? null; scheduleRegen(); },

          /**
           * Re-read the extra layers' colours onto their materials.
           *
           * Separate from `setExtraLegends` because a colour never changes a shape, and routing
           * it through the carve would spend a full CSG rebuild — half a second of the preview
           * freezing — on repainting a mesh. This is the same thing the cap and legend colour
           * inputs do for their own materials.
           */
          refreshExtraColors: () => {
            extraLegends.forEach((l, i) => extraLegendMeshes[i]?.mat.color.set(l.color));
          },
        },
        setMainPaused: setPaused,
        getSavedSet: () => keyboardSet,
        onSetChanged: (set) => { keyboardSet = set; },
        // The second legend rides along in Save/Load the same way an edited board does: the
        // shell keeps the blob and never looks inside it, and the mode that wrote it is the one
        // that reads it back — when it is next opened, not on load, so opening a project cannot
        // put you inside a paid mode you did not ask for.
        getSavedDual: () => dualLegend,
        onDualChanged: (v) => { dualLegend = v; scheduleNote(); },
        getState: () => ({
          profile: withCapSettings(currentProfile, capSettings()),
          profileSlug: profileSlug(),
          fontId: currentFontId,
          opts: {
            depth: C.depth.get(),
            rotationDeg: C.rot.get(),
            offsetX: C.offx.get(),
            offsetY: C.offy.get(),
            mirror: $('mirror').checked,
            through: $('through').checked,
            singleColor: $('single').checked,
            // How far a raised legend stands, 0 when it is carved in: the board carves the same
            // four styles the single cap does (geometry.js), so it reads all of them.
            raisedMM: raisedMM(),
            // The bump is a Cherry-shaped mesh positioned against the Standard dish; a profile
            // that says it has none keeps its F and J plain.
            homingBumpAllowed: currentProfile?.homingBump !== false && !!homingBumpGeometry,
          },
          glyphHeightMM: C.size.get(),
          // The usable top of the cap that is loaded, so a mode can place a legend as a
          // fraction of the room available instead of in absolute millimetres that only
          // happen to look right on a 1u.
          topExtent: meta ? [meta.topExtent[0], meta.topExtent[1]] : null,
          // The first legend's artwork proportions. A mode placing a second legend beside it
          // has to know how wide the first one actually comes out — the Size control scales the
          // LONGER side, so everything else follows from this box and nothing else can supply
          // it: this module owns the parsed legend.
          legendBox: currentLegend
            ? {
              w: currentLegend.box.max.x - currentLegend.box.min.x,
              h: currentLegend.box.max.y - currentLegend.box.min.y,
            }
            : null,
          stemTolMM: stemTolValue,
          // The Dimensions: how much lower the cap sits, how short its walls and stem are.
          capTrim: { ...capTrim },
          capColor: $('capColor').value,
          logoColor: $('logoColor').value,
          homingBumpGeom: homingBumpGeometry,
          maxDepth: currentProfile?.maxDepth ?? 1.5,
          // Pack onto whatever plate the viewport is showing, so what the picker says fits is
          // what the set is laid out for. `grid` has no size — the builder falls back to 256².
          plateSize: getPlate(loadPlateChoice())?.size,
        }),
        begin: rebuildLock.begin,
        end: rebuildLock.end,
        setStatus,
        // `onCancel` is optional and only a batch passes one: it puts a Cancel button in the
        // chip, which is what makes "let it finish or cancel it first" a true sentence.
        setBusy: (text, onCancel) => setBusyState(text ?? null, onCancel),
        captureCover: cover,
        // Invariant #3, on the one export path a file-level mark cannot reach: a comment in
        // an OBJ is not metadata, so the licence line has to ride in the export's
        // description instead, and the nudge has to fire from there too. See
        // setMode.js, where both are used exactly as the single-cap path uses them here.
        nudgeLicense,
        licenseNote: LICENSE_NOTE,
        // The Print settings wall choice, so the Full set export honours it too.
        printConfig,
      });
      cleanups.push(() => proPanel.destroy());
    }
  }

  // ------------------------------------------------------- quality callout (dismissable)
  // The kit's own component, which already builds this markup and already remembers a dismiss
  // against a storage key. The app hand-rolled both, with the MakerWorld listing URL written
  // into the template — and because the mw:strip fence only ever ran over index.html, that
  // copy shipped inside the embed's bundle and was deleted again at runtime. Behind
  // `!MAKERLAB` the bundler drops it from that build outright.
  if (!MAKERLAB) {
    const callout = qualityCallout({
      html:
        'For the best quality printed keycap, please use the print profile and instructions available on '
        + `<a class="vl-link" href="${BRAND.urls.keycapListing}" target="_blank" rel="noopener">MakerWorld</a>.`,
      storageKey: 'keycap_quality_callout',
    });
    const slot = $('qualityCalloutMount');
    if (callout) slot.replaceWith(callout);
    else slot.remove();
  } else {
    $('qualityCalloutMount')?.remove();
  }

  // ------------------------------------------------------- credit strip + updates
  // Pinned to the foot of the left panel, outside its scroll: who made this, and what changed.
  // Updates rides here rather than as a full-width button among the controls — it is the
  // answer to "has my bug been fixed", a question people ask rather than one to interrupt
  // them with, and next to the byline it reads as the version of the thing you are using.
  /** The Updates panel's entries: the free changelog, plus the paid features' own in the
   *  MakerWorld build (src/pro/changelog.js), merged by date so one day reads as one section.
   *  The public build's pro stub exports an empty list, so it shows only the free one. */
  function updateEntries() {
    if (!MAKERLAB || !PRO_CHANGELOG.length) return CHANGELOG;
    const byDate = new Map(CHANGELOG.map((e) => [e.date, { ...e, changes: [...e.changes] }]));
    for (const e of PRO_CHANGELOG) {
      const into = byDate.get(e.date);
      if (into) into.changes.push(...e.changes);
      else byDate.set(e.date, { ...e, changes: [...e.changes] });
    }
    return [...byDate.values()];
  }

  // ------------------------------------------------------- undo / redo
  //
  // Each step is the project as Save writes it (collectState), taken when the cap on screen has
  // settled (the rebuild loop's onIdle) or a colour changed, and put back through the one path a
  // loaded project takes (applyLoadedState). The parsed legend is left out of a step: it is what
  // the source rebuilds, and it is large. Undo is the single cap's; a board has its own state.
  const HISTORY_MAX = 60;
  const historyPast = [];
  const historyFuture = [];
  let historyNow = null;   // the step on screen
  let historyStart = null; // the session's first step, which the middle button goes back to
  let historyApplying = false;
  let historyApplyTimer = null;
  let historyNoteTimer = null;
  const historyStep = () => { const s = collectState(); delete s.legend; return JSON.stringify(s); };
  historyRow = historyControls({
    onUndo: () => historyGo(-1),
    onRedo: () => historyGo(1),
    onRefresh: () => historyGo(0),
    labels: { refresh: 'Back to how this session started' },
  });
  historyRow.classList.add('kc-history');
  function paintHistory() {
    historyRow.setState({
      canUndo: historyPast.length > 0,
      canRedo: historyFuture.length > 0,
      canRefresh: historyStart != null && historyNow !== historyStart,
    });
  }
  /** Record the settled state as one step, unless it is the step already on screen. */
  function noteChange() {
    if (singleCapSuspended || !currentLegend) return;
    if (historyApplying) { settleApply(); return; }
    const now = historyStep();
    if (historyNow == null) { historyNow = historyStart = now; paintHistory(); return; }
    if (now === historyNow) return;
    historyPast.push(historyNow);
    if (historyPast.length > HISTORY_MAX) historyPast.shift();
    historyFuture.length = 0;
    historyNow = now;
    paintHistory();
  }
  /** A step once changes stop. One action can rebuild the cap several times over (an extra legend
   *  is seeded, laid out, then carved), and that is still one step; a colour rebuilds nothing. */
  function scheduleNote() {
    clearTimeout(historyNoteTimer);
    historyNoteTimer = setTimeout(noteChange, 500);
  }
  /** An undo's own rebuilds are not new steps: wait for them to stop, then take what settled as
   *  the step on screen (a load can clamp a value to the cap it lands on). */
  function settleApply() {
    clearTimeout(historyApplyTimer);
    historyApplyTimer = setTimeout(() => {
      if (capLoads > 0) { settleApply(); return; }
      historyApplying = false;
      historyNow = historyStep();
      paintHistory();
    }, 400);
  }
  /** -1 undo, 1 redo, 0 back to the start (itself a step, so it can be undone). */
  function historyGo(dir) {
    if (historyNow == null) return;
    let target;
    if (dir < 0) {
      if (!historyPast.length) return;
      target = historyPast.pop();
      historyFuture.push(historyNow);
    } else if (dir > 0) {
      if (!historyFuture.length) return;
      target = historyFuture.pop();
      historyPast.push(historyNow);
    } else {
      if (historyStart == null || historyNow === historyStart) return;
      target = historyStart;
      historyPast.push(historyNow);
      historyFuture.length = 0;
    }
    historyApplying = true;
    historyNow = target;
    try {
      applyLoadedState(JSON.parse(target));
    } catch (e) {
      console.error(e);
      setStatus('Could not go back to that step.', 'err');
    }
    settleApply();
    paintHistory();
  }
  // Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y), except while typing: a text box has its own undo.
  const onHistoryKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || singleCapSuspended) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); historyGo(-1); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); historyGo(1); }
  };
  document.addEventListener('keydown', onHistoryKey);
  cleanups.push(() => {
    document.removeEventListener('keydown', onHistoryKey);
    clearTimeout(historyApplyTimer);
    clearTimeout(historyNoteTimer);
  });
  for (const id of ['capColor', 'logoColor']) $(id).addEventListener('input', scheduleNote);
  $('keycapCredit')?.append(historyRow);

  $('keycapCredit')?.append(panelCredit({
    // The name goes in both builds. Two lines is the shape of this strip — it is what fills
    // its left half and leaves the right half for the button.
    title: 'Keycap Legend Generator',
    updates: { entries: updateEntries(), title: 'Keycap updates' },
  }));

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
      size: C.size.get(),
      depth: C.depth.get(),
      rot: C.rot.get(),
      offx: parseFloat($('offx').value),
      offy: parseFloat($('offy').value),
      stemTol: stemTolValue,
      capLower: capTrim.lowerMM,
      stemRecess: capTrim.recessMM,
      wallHeight: capTrim.wallMM,
      stem: stemType,
      shapeSize: shapeCap.sizeMM,
      capColor: $('capColor').value,
      logoColor: $('logoColor').value,
      mirror: $('mirror').checked,
      homingBump: $('homingBump').checked,
      through: $('through').checked,
      single: $('single').checked,
      raised: raisedMM(),
      profile: $('profileSelect').value,
      unit: $('unitSelect').value,
      wallGenerator,
      fontId: currentFontId,
      legendSource: legendSourceState,
    };
    if (currentLegend) projectState.legend = currentLegend;
    // An edited keyboard set is hours of work; it belongs in the project file next to
    // everything else. Absent in the public build, where the editor doesn't exist.
    if (keyboardSet) projectState.keyboardSet = keyboardSet;
    if (dualLegend) projectState.dualLegend = dualLegend;
    return projectState;
  }

  /** The preview the Open list shows. A save is still worth doing without one. */
  function capturePreview() {
    try {
      // The renderer only keeps its drawing buffer when preserveDrawingBuffer is on, which
      // outside the MakerWorld build it is not — so the kit draws one more frame and reads it in
      // the same tick, before the browser clears it.
      return captureCover(renderer, scene, camera);
    } catch {
      return undefined;
    }
  }

  async function saveToHost() {
    const suggested = currentLegend?.name || 'Keycap';
    const name = await promptDialog({
      title: currentProjectId ? 'Rename and save' : 'Save project',
      label: 'Project name',
      value: suggested,
    });
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
        // The host turns a stored path into a URL. A hand-written one can break on some
        // platforms, and says nothing in the console when it does.
        img.src = hostAssetUrl(host, p.preview);
        row.append(img);
      }
      const label = document.createElement('span');
      label.textContent = p.name;
      row.append(label);
      row.addEventListener('click', () => {
        handle.close();
        void openProject(p.id);
      });
      list.append(row);
    }
  }

  /**
   * Loads one saved project into the live UI.
   *
   * Shared by the Open list and by the host handing us a project on arrival — the user
   * clicked a saved keycap in the app's picker rather than the generator's own tile, and
   * making them find it again in a dialog would be a strange way to honour that click.
   *
   * @param {string} projectId
   */
  async function openProject(projectId) {
    if (!host) return;
    try {
      const project = await host.loadProject(projectId);
      applyLoadedState(project.params);
      currentProjectId = project.id;
      setStatus(`Opened "${project.name}" ✓`);
    } catch (err) {
      console.error(err);
      setStatus(`Could not open: ${err.message || err}`, 'err');
    }
  }

  /**
   * Hand the host the three things it needs to own projects for this generator.
   *
   * Autosave, the unsaved dot, Save, Open, Rename, Delete and Start fresh then belong to
   * the host, drawn once in its own chrome for every generator it hosts, rather than a
   * fourth copy of that machinery living in here. Absent on the web, where every path
   * below keeps working exactly as it did.
   */
  host?.registerProject?.({
    getState: () => collectState(),
    applyState: (loaded) => applyLoadedState(loaded),
    capturePreview,
    suggestName: () => currentLegend?.name || 'Keycap',
  });

  // Only when the host is *not* owning projects: with `registerProject` it opens the
  // arriving project itself, and doing it here too would open it twice.
  if (!host?.registerProject) {
    const arrivingWith = host?.initialProjectId?.();
    if (arrivingWith) void openProject(arrivingWith);
  }

  /** Applies a parameter blob to the live UI. Shared by both load paths. */
  function applyLoadedState(loaded) {
    if (!loaded || typeof loaded !== 'object') throw new Error('Not a keycap project');
    // Fit test is never part of a saved project — opening one always lands on the normal cap
    // view, cleanly, rather than leaving a stale row from whatever was on screen before.
    if (fitTestActive) exitFitTest();
    // The project's extra legends, read before anything below is set: setting a value makes the
    // paid legends mode save its legends as they are now, over the ones being loaded.
    const savedDual = loaded.dualLegend ?? null;
    // What is on screen now, so only what changed is rebuilt: undo calls this for every step,
    // and reloading the cap for a slider would make each one take a second.
    const before = {
      profile: $('profileSelect').value, unit: $('unitSelect').value, stem: stemType,
      shape: shapeCap.sizeMM, lower: capTrim.lowerMM, recess: capTrim.recessMM, wall: capTrim.wallMM,
    };
    if (loaded.size != null) C.size.set(loaded.size);
    if (loaded.depth != null) C.depth.set(loaded.depth);
    if (loaded.rot != null) C.rot.set(loaded.rot);
    if (loaded.offx != null) { $('offx').value = loaded.offx; $('offxNum').value = loaded.offx; }
    if (loaded.offy != null) { $('offy').value = loaded.offy; $('offyNum').value = loaded.offy; }
    if (loaded.stemTol != null) { setStemTol(loaded.stemTol); applyStemTolerance(); }
    // Applied by the cap load the profile change below starts, clamped to that cap's limits.
    capTrim.lowerMM = Number(loaded.capLower) || 0;
    capTrim.recessMM = Number(loaded.stemRecess) || 0;
    capTrim.wallMM = loaded.wallHeight != null && Number.isFinite(Number(loaded.wallHeight)) ? Number(loaded.wallHeight) : null;
    stemType = loaded.stem === 'mx-lp' ? 'mx-lp' : 'mx';
    stemTypeControl.setValue(stemType);
    shapeCap.sizeMM = Number.isFinite(Number(loaded.shapeSize)) && loaded.shapeSize != null ? Number(loaded.shapeSize) : null;
    // `.value = ` fires nothing, and the swatch rows follow the inputs by listening for
    // `input` — so a loaded project used to leave both palettes showing the old colour while
    // the preview showed the new one.
    if (loaded.capColor) { $('capColor').value = loaded.capColor; capMat.color.set(loaded.capColor); capColorRow.setValue(loaded.capColor); }
    if (loaded.logoColor) { $('logoColor').value = loaded.logoColor; logoMat.color.set(loaded.logoColor); logoColorRow.setValue(loaded.logoColor); }
    if (loaded.mirror != null) $('mirror').checked = loaded.mirror;
    if (loaded.homingBump != null) $('homingBump').checked = loaded.homingBump;
    if (loaded.through != null) $('through').checked = loaded.through;
    if (loaded.single != null) $('single').checked = loaded.single;
    $('raised').checked = Number(loaded.raised) > 0;
    if (Number(loaded.raised) > 0) raiseRow.setValue(Number(loaded.raised));
    if (loaded.profile) $('profileSelect').value = loaded.profile;
    if (loaded.unit) $('unitSelect').value = loaded.unit;
    if (loaded.wallGenerator === 'arachne' || loaded.wallGenerator === 'classic') {
      wallGenerator = loaded.wallGenerator;
      wallsRow.setValue(loaded.wallGenerator);
    }
    if (loaded.keyboardSet) keyboardSet = loaded.keyboardSet;
    // The legend itself, from what it was made of. A project from before sources were saved
    // keeps the legend on screen, as loading always did.
    restoreLegend(loaded.legendSource, loaded.fontId);
    // Trigger UI sync: the size is the text's remembered height now, and the paid modes hear it.
    rememberTextHeight();
    announce(['size']);
    const capChanged = $('profileSelect').value !== before.profile || $('unitSelect').value !== before.unit
      || stemType !== before.stem || shapeCap.sizeMM !== before.shape;
    if (capChanged || !loadedCap) $('profileSelect').dispatchEvent(new Event('change'));
    else if (capTrim.lowerMM !== before.lower || capTrim.recessMM !== before.recess || capTrim.wallMM !== before.wall) applyCapTrim();
    else scheduleRegen();
    applyModeFlags();
    // Absent means one legend: a project saved with one must not keep the legends on screen.
    dualLegend = savedDual;
    proPanel?.applySavedLegends?.(savedDual);
  }

  /** Put a saved legend source back on the cap (applyLoadedState). False when there is none. */
  function restoreLegend(src, fontId) {
    if (!src || typeof src !== 'object') return false;
    if (JSON.stringify(src) === JSON.stringify(legendSourceState)) return true; // already on the cap
    if (src.type === 'letter') {
      $('letterText').value = String(src.text ?? '');
      const face = src.fontId ?? fontId;
      void (async () => {
        // The face first: text carved in the old one could be refused by it ("no letters for
        // that") and moved to another face before the saved one arrived.
        if (face && face !== currentFontId) await chooseFont(face);
        setLegendMode('letter');
        if (legendSink !== singleCapSink) selectLetter(); // the single cap's sink already did
      })();
      return true;
    }
    if (src.type === 'icon') {
      const ic = LUCIDE_ICONS.find((x) => x.name === src.name);
      if (!ic) return false;
      const text = buildSvg(ic.node);
      setLegendMode('icon');
      const tile = [...galleryEl.querySelectorAll('.icon')].find((t) => t.title === src.name);
      void selectIcon(tile ?? null, async () => text, src.name, 'icon');
      return true;
    }
    if (src.type === 'svg' && typeof src.svg === 'string') {
      const text = src.svg;
      let tile = [...uploadGalleryEl.querySelectorAll('.icon')].find((t) => t.title === src.name);
      if (!tile) {
        tile = makeIconEl(URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), async () => text, src.name, 'svg');
        uploadGalleryEl.appendChild(tile);
        refreshUploadEmptyState();
      }
      setLegendMode('upload');
      void selectIcon(tile, async () => text, src.name, 'svg');
      return true;
    }
    return false;
  }

  // ------------------------------------------------------- MakerLab handshake
  // MakerWorld build only: connect to the host when embedded (no-op otherwise). Runs alongside
  // boot(); the export buttons check mlReady() at click time, so ordering doesn't matter.
  if (MAKERLAB) {
    initMakerlab({
      onDisconnect: () => {
        setStatus('Disconnected from the MakerLab host.', 'warn');
        // Losing the connection means ownership is unknown: repaint locked.
        proPanel?.refresh();
        syncFitTestExportLabel();
      },
    }).then((ctx) => {
      if (!ctx) return;
      document.body.classList.add('makerlab');
      console.log('[MakerLab] connected');
      // Repaint now: ownership and price are unknown until connected.
      proPanel?.refresh();
      syncFitTestExportLabel();
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
        // The owner's profiles, then the round and square shapes the app makes (shapes/profiles.js).
        keycapProfiles = [...profiles, ...extraProfiles()];
        for (const p of keycapProfiles) {
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
        buildProfilePicker(defProfile.id);
        if (keycapProfiles.length < 2) profilePicker.hidden = true;
      } else {
        $('kcUnitField').hidden = true; // no manifest — hide the picker
      }

      try {
        const hb = await loadKeycap('keycaps/homing-bump.json');
        homingBumpGeometry = hb.shellGeometry;
      } catch (e) {
        console.error('Failed to load homing bump geometry:', e);
      }
      showLoadedCap(await loadKeycap(defaultFile));
      updateAlphabetAvailability();
      proPanel?.refresh(); // the profile is only known now
      syncFitTestExportLabel();

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
