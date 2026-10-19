import '@vostok/ui-kit/styles.css';
import './style.css';

import { Box3, Euler, Matrix4, Vector3 } from 'three';
import {
  appShell,
  topbarLinks,
  generatorHeader,
  panelCredit,
  sidebarFooter,
  settingsRail,
  section,
  segmentedControl,
  sliderRow,
  numberField,
  paletteRow,
  pictureStrip,
  previewCard,
  previewBar,
  stageStatus,
  busyChip,
  dropZone,
  uploadCta,
  button,
  buttonRow,
  iconButton,
  thumbGrid,
  thumbTile,
  emptyState,
  toast,
  dialog,
  setExportLabel,
  setExportNote,
  syncControls,
  markProject,
  readProjectFile,
  ICONS,
  el,
  type ProjectShape,
  type PictureStripItem,
} from '@vostok/ui-kit';
import { buildZip, downloadFile } from '@vostok/export';
import {
  AUTO_FINISH, CUSTOM_BACKDROP, STUDIO_FILAMENTS, backdropById, canRender, createStudioPreview,
  disposeModel, loadRenderModel, nextColourwayId, regionColour, renderStill, renderThumb, safeSlug,
  type Colourway, type LoadedModel, type Orientation, type PaintRegion, type SceneOptions,
  type StudioPreview,
} from '@vostok/render';
import {
  ANGLES, BACKGROUNDS, DEFAULT_LOOK, FINISH_CHOICES, LIGHTS, MAX_PHOTOS, PHOTO_SHAPES, RESTS, SIDE_MAX, SIDE_MIN,
  aspectOf, backdropOf, coerceColourways, coerceLook, coercePhotos, defaultPhotos, downloadName,
  generateWords, renderLabel, finishShown, firstColourway, isDefaultSet, lightingOf, nextPhotoId, orientationOf,
  photoAt, photoSize, planShoot, regionsBySize, shotOf, showsFileColours, sizeText,
  type AngleId, type Look, type Photo, type RestId, type SizeId,
} from './shoot';
import { backdropSwatch, sizeSwatch } from './swatches';
import { CHANGELOG } from './changelog';

/*
  Render Studio: listing photos of the seller's own model. The picture in the middle IS the photo,
  in its own shape; the strip under it is every photo Generate makes; the rail on the left changes
  how they look. The right panel is the model, the renders once made (each to view and download,
  or all as one ZIP), and Generate at its foot.

  Every look is chosen from a picture. Quality is the engine's call, not a knob. The batch is two
  ideas: photos × colorways.
*/

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------

const LOOK_KEY = 'render-studio:look';
const SAMPLE = 'name-keychain.3mf';
/** Every photo is made like this: soft shadows and clean edges, with no knob for it. */
const STILL = { samples: 24, supersample: 2 };
/**
 * `?quick` on the dev server: renders at an eighth of the size, two passes each. For driving the
 * tool headlessly, where software rendering takes minutes over one 2000 px still. Never in a
 * build: `import.meta.env.DEV` is false there and the branch is dropped.
 */
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

/** The shop's look, remembered in this browser. A private window has no storage: the page works
 *  without it. */
function readLook(): Look {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    return raw ? coerceLook(JSON.parse(raw)) : { ...DEFAULT_LOOK };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}
function keepLook() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* nothing to keep it in */ }
}

let look: Look = readLook();
/** Which way up, as the controls hold it. */
let rest: RestId = 'as-loaded';
let turn: '0' | '1' | '2' | '3' = '0';

let model: LoadedModel | null = null;
let fileName = SAMPLE;
let isSample = true;
let regions: PaintRegion[] = [];
let ways: Colourway[] = [];
let selectedWay = '';
let photos: Photo[] = [];
let selectedPhoto = '';
/** Bumped whenever the camera should be framed from the selected photo again. */
let viewNonce = 0;
/** A batch is being made. */
let making = false;

const orientation = (): Orientation => orientationOf(rest, Number(turn));
const thePhoto = () => photos.find((p) => p.id === selectedPhoto) ?? photos[0]!;
const theWay = () => ways.find((w) => w.id === selectedWay) ?? ways[0]!;

/** Everything the photo looks like, for one photo in one colorway. */
function sceneOf(photo: Photo, way: Colourway, l: Look = look, o: Orientation = orientation()): SceneOptions {
  return {
    shot: shotOf(photo),
    backdrop: backdropOf(l),
    colourway: way,
    orientation: o,
    lighting: lightingOf(l),
    shadow: true,
  };
}

/** The model's size in millimetres as it stands: width, height, depth (y-up). */
function sizeOf(m: LoadedModel, o: Orientation): [number, number, number] {
  const box = new Box3().setFromObject(m.object);
  const q = Math.PI / 2;
  box.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(o.tip * q, o.turn * q, o.roll * q, 'YXZ')));
  const s = box.getSize(new Vector3());
  return [s.x, s.y, s.z];
}

const angleName = (p: Photo) => (p.angle === 'view' ? 'Your angle' : ANGLES.find((a) => a.id === p.angle)!.name);

// ---------------------------------------------------------------------------
// 2. PICTURES ON TILES — small renders of the real scene, one at a time, the selected photo
//    first, a beat after the last change, never while a batch is being made.
// ---------------------------------------------------------------------------

const urls = new Map<string, string>();
/** A picture for a tile, as a URL, freeing the one it replaces. */
function keep(key: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  const old = urls.get(key);
  if (old) URL.revokeObjectURL(old);
  urls.set(key, url);
  return url;
}

let thumbGen = 0;
let thumbTimer: ReturnType<typeof setTimeout> | undefined;
let thumbChain: Promise<void> = Promise.resolve();
let lightsMade = false;
let restsMadeFor: LoadedModel | null = null;

function scheduleThumbs(delay = 600) {
  thumbGen++;
  const gen = thumbGen;
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    thumbChain = thumbChain.then(() => runThumbs(gen)).catch(() => undefined);
  }, delay);
}

async function runThumbs(gen: number) {
  const m = model;
  if (!m || making) return;
  const live = () => gen === thumbGen && model === m && !making;
  const aspect = aspectOf(look);
  const way = theWay();
  // The photos, the selected one first.
  for (const p of [thePhoto(), ...photos.filter((x) => x.id !== selectedPhoto)]) {
    if (!live()) return;
    const blob = await renderStill(m, { ...sceneOf(p, way), width: Math.round(128 * aspect), height: 128, samples: 6, supersample: 1 });
    if (!live()) return;
    if (photos.some((x) => x.id === p.id)) photoStrip.setImage(p.id, keep(`photo:${p.id}`, blob));
  }
  // The colorways, from the selected photo's angle.
  for (const w of ways) {
    if (!live()) return;
    const blob = await renderStill(m, { ...sceneOf(thePhoto(), w), width: 152, height: 152, samples: 6, supersample: 1 });
    if (!live()) return;
    if (ways.some((x) => x.id === w.id)) wayStrip.setImage(w.id, keep(`way:${w.id}`, blob));
  }
  // The six resting sides, once per model.
  if (restsMadeFor !== m) {
    for (const r of RESTS) {
      if (!live()) return;
      const o = orientationOf(r.id, 0);
      const blob = await renderStill(m, { ...sceneOf(photoAt('rest', 'angled'), way, look, o), width: 160, height: 120, samples: 4, supersample: 1 });
      if (!live()) return;
      controls.rest.setOptionImage(r.id, keep(`rest:${r.id}`, blob));
    }
    restsMadeFor = m;
  }
  // The five lights on a white sphere, once.
  if (!lightsMade) {
    for (const l of LIGHTS) {
      if (!live()) return;
      const blob = await renderThumb(null, {
        // A gray sphere: on white, a white one hides the very shading these tiles are for.
        ...sceneOf(photoAt('light', 'angled'), { id: 'gray', name: 'Gray', colours: { whole: { hex: '#8a8d93', finishId: 'satin' } } }, { ...DEFAULT_LOOK, lightId: l.id }, orientationOf('as-loaded', 0)),
      }, 120);
      controls.lightId.setOptionImage(l.id, keep(`light:${l.id}`, blob));
    }
    lightsMade = true;
  }
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left rail) — every look from a picture.
// ---------------------------------------------------------------------------

/* Colors: the colorways, then one row per part of the model, biggest first. */
const wayStrip = pictureStrip({
  items: [],
  value: '',
  heading: 'Colorways',
  wrap: true,
  size: 72,
  addLabel: 'Add a colorway. Every photo comes in each one.',
  removeLabel: (item) => `Remove ${item.label.toLowerCase()}`,
  onSelect: (id) => { selectedWay = id; wayStrip.setValue(id); showColours(); refresh(); },
  onAdd: () => {
    const made: Colourway = { id: nextColourwayId(ways), name: '', colours: structuredClone(theWay().colours) };
    ways = [...ways, made];
    selectedWay = made.id;
    drawWays();
    refresh();
  },
  onRemove: (id) => {
    const at = ways.findIndex((w) => w.id === id);
    ways = ways.filter((w) => w.id !== id);
    if (selectedWay === id) selectedWay = ways[Math.max(0, at - 1)]!.id;
    drawWays();
    refresh();
  },
});
function drawWays() {
  ways.forEach((w, i) => { w.name = `Colorway ${i + 1}`; });
  wayStrip.setItems(ways.map((w): PictureStripItem => ({ id: w.id, label: w.name, src: urls.get(`way:${w.id}`) })));
  wayStrip.setValue(selectedWay);
  showColours();
}

const colourRows = el('div', { className: 'rs-rows' });
const rowByKey = new Map<string, ReturnType<typeof paletteRow>>();
const fileColours = button({
  label: "Use the file's colors",
  icon: ICONS.rotateLeft,
  emphasis: 'ghost',
  onClick: () => {
    theWay().colours = firstColourway(regions).colours;
    showColours();
    refresh();
  },
});

/** The shelf a region's colour is picked from: the file's own colour first, then the filaments. */
function optionsFor(region: PaintRegion) {
  const shelf = STUDIO_FILAMENTS.map((f) => ({ name: f.name, hex: f.hex }));
  return region.fileHex ? [{ name: 'From the file', hex: region.fileHex }, ...shelf] : shelf;
}

/** The Finish tiles under a region's colours, made each time its picker opens. */
function finishTiles(region: PaintRegion): HTMLElement {
  const now = regionColour(region, theWay());
  const control = segmentedControl({
    label: 'Finish',
    variant: 'tiles',
    size: 'compact',
    columns: 3,
    options: FINISH_CHOICES.map((f) => ({ value: f.id, label: f.name, image: urls.get(`finish:${now.hex}:${f.id}`) })),
    value: finishShown(now.hex, now.finishId),
    onChange: (finishId) => {
      const current = regionColour(region, theWay());
      theWay().colours[region.key] = { hex: current.hex, finishId };
      refresh();
    },
  });
  // Each finish on a sphere of this colour, rendered as the picker opens.
  void (async () => {
    for (const f of FINISH_CHOICES) {
      const key = `finish:${now.hex}:${f.id}`;
      if (urls.has(key)) continue;
      const blob = await renderThumb(null, sceneOf(
        photoAt('finish', 'angled'),
        { id: 'finish', name: '', colours: { whole: { hex: now.hex, finishId: f.id } } },
        { ...look, backdropId: 'studio-light' },
        orientationOf('as-loaded', 0),
      ), 96);
      const url = keep(key, blob);
      if (control.isConnected) control.setOptionImage(f.id, url);
    }
  })();
  return control;
}

function drawColourRows() {
  rowByKey.clear();
  colourRows.replaceChildren(...regionsBySize(regions).map((region) => {
    const row = paletteRow({
      label: regions.length === 1 ? 'Model' : region.label.charAt(0).toUpperCase() + region.label.slice(1),
      value: regionColour(region, theWay()).hex,
      options: optionsFor(region),
      // A picked finish stays when the colour changes; an unpicked one follows the filament.
      onChange: (hex) => {
        const was = theWay().colours[region.key];
        theWay().colours[region.key] = { hex, finishId: was?.finishId ?? AUTO_FINISH };
        fileColours.hidden = !regions.some((r) => r.fileHex) || showsFileColours(theWay(), regions);
        refresh();
      },
      popoverFooter: () => finishTiles(region),
    });
    rowByKey.set(region.key, row);
    return row;
  }));
}

/** The rows show the selected colorway. */
function showColours() {
  for (const region of regions) rowByKey.get(region.key)?.setValue(regionColour(region, theWay()).hex);
  fileColours.hidden = !regions.some((r) => r.fileHex) || showsFileColours(theWay(), regions);
}

/* Background, Lighting, Rotate, Size: the controls that sync with a loaded shoot and Reset. */
const controls = {
  backdropId: segmentedControl({
    variant: 'tiles',
    size: 'compact',
    columns: 3,
    ariaLabel: 'Background',
    options: BACKGROUNDS.map((b) => ({
      value: b.id,
      label: b.name,
      image: backdropSwatch(b.id === CUSTOM_BACKDROP ? backdropOf({ ...look, backdropId: CUSTOM_BACKDROP }) : backdropById(b.id)),
    })),
    value: look.backdropId,
    onChange: (id) => { look.backdropId = id; lookChanged(); },
  }),
  custom: paletteRow({
    label: 'Color',
    value: look.custom,
    onChange: (hex) => {
      look.custom = hex;
      controls.backdropId.setOptionImage(CUSTOM_BACKDROP, backdropSwatch(backdropOf({ ...look, backdropId: CUSTOM_BACKDROP })));
      lookChanged();
    },
  }),
  lightId: segmentedControl({
    variant: 'tiles',
    size: 'compact',
    columns: 3,
    ariaLabel: 'Light',
    options: LIGHTS.map((l) => ({ value: l.id, label: l.name })),
    value: look.lightId,
    onChange: (id) => { look.lightId = id; lookChanged(); },
  }),
  brightness: sliderRow({
    label: 'Brightness', min: 50, max: 150, step: 5, unit: '%', value: look.brightness,
    onInput: (v) => { look.brightness = v; lookChanged(); },
  }),
  rest: segmentedControl<RestId>({
    variant: 'tiles',
    size: 'compact',
    columns: 3,
    ariaLabel: 'Resting side',
    options: RESTS.map((r) => ({ value: r.id, label: r.name })),
    value: rest,
    onChange: (id) => { rest = id; poseChanged(); },
  }),
  turn: segmentedControl<'0' | '1' | '2' | '3'>({
    label: 'Turn',
    help: 'Which way the model faces the Front photo.',
    options: [{ value: '0', label: '0°' }, { value: '1', label: '90°' }, { value: '2', label: '180°' }, { value: '3', label: '270°' }],
    value: turn,
    onChange: (t) => { turn = t; poseChanged(); },
  }),
  sizeId: segmentedControl<SizeId>({
    variant: 'tiles',
    size: 'compact',
    columns: 3,
    ariaLabel: 'Photo size',
    options: [
      ...PHOTO_SHAPES.map((s) => ({ value: s.id, label: s.name, image: sizeSwatch(s.width, s.height), description: s.ratio })),
      { value: 'custom' as const, label: 'Custom', image: sizeSwatch(look.customWidth, look.customHeight, true), description: 'Your size' },
    ],
    value: look.sizeId,
    onChange: (id) => { look.sizeId = id; sizeChanged(); },
  }),
  // The custom size, in pixels. Taken when the number is committed (Enter, or leaving the box),
  // so the frame does not reshape at every keystroke.
  customWidth: numberField({
    label: 'Width', value: look.customWidth, min: SIDE_MIN, max: SIDE_MAX, step: 1, unit: 'px',
    onInput: (v) => { look.customWidth = v; sizeChanged(); },
  }),
  customHeight: numberField({
    label: 'Height', value: look.customHeight, min: SIDE_MIN, max: SIDE_MAX, step: 1, unit: 'px',
    help: 'Up to 6000 px a side.',
    onInput: (v) => { look.customHeight = v; sizeChanged(); },
  }),
};
const customSize = el('div', { className: 'rs-custom-size' }, [controls.customWidth, controls.customHeight]);

const rail = settingsRail({
  label: 'Photo settings',
  flush: true,
  items: [
    { id: 'colors', label: 'Colors', icon: ICONS.droplet, body: [wayStrip.root, colourRows, buttonRow(fileColours)] },
    { id: 'background', label: 'Background', icon: ICONS.backdrop, body: [controls.backdropId, controls.custom] },
    { id: 'lighting', label: 'Lighting', icon: ICONS.lighting, body: [controls.lightId, controls.brightness] },
    { id: 'rotate', label: 'Rotate', title: 'Which way up', icon: ICONS.rotate3d, body: [controls.rest, controls.turn] },
    { id: 'size', label: 'Size', title: 'Photo size', icon: ICONS.ratio, body: [controls.sizeId, customSize] },
  ],
});

/** Hide what does not apply: the custom colour only while Custom is the background, the custom
 *  size only while Custom is the size. */
function applyVisibility() {
  controls.custom.hidden = look.backdropId !== CUSTOM_BACKDROP;
  customSize.hidden = look.sizeId !== 'custom';
  rail.refresh();
}

/** Put the state into every control, and keep only what the controls can show (Load, Reset). */
function showSettings() {
  const s = { ...look, rest, turn };
  syncControls(s, controls);
  look = coerceLook(s);
  rest = s.rest;
  turn = s.turn;
  controls.backdropId.setOptionImage(CUSTOM_BACKDROP, backdropSwatch(backdropOf({ ...look, backdropId: CUSTOM_BACKDROP })));
  applyVisibility();
}

function lookChanged() {
  keepLook();
  applyVisibility();
  refresh();
}
/** Which way up changed: the framing refits to the new shape, the camera's direction kept. */
function poseChanged() {
  viewNonce++;
  refresh();
}
/** The photo's shape changed: the frame takes it in place, and the model is refit into it. */
function sizeChanged() {
  keepLook();
  applyVisibility();
  controls.sizeId.setOptionImage('custom', sizeSwatch(look.customWidth, look.customHeight, true));
  photoHost.style.setProperty('--rs-aspect', String(aspectOf(look)));
  photoStrip.setAspect(aspectOf(look));
  viewNonce++;
  refresh();
}

// ---------------------------------------------------------------------------
// 4. THE STAGE — the photo in its own shape, the angle switch over it, the photos under it.
// ---------------------------------------------------------------------------

const status = stageStatus('');
const chip = busyChip({ delay: 300 });
const photoHost = el('div', { className: 'rs-photo' });
photoHost.style.setProperty('--rs-aspect', String(aspectOf(look)));
const photoFit = el('div', { className: 'rs-photo-fit' }, [photoHost]);
const photoWrap = el('div', { className: 'rs-photo-wrap' }, [photoFit]);

const angleBar = previewBar<AngleId>({
  label: 'Angle',
  modes: {
    label: 'Angle',
    options: ANGLES.map((a) => ({ value: a.id, label: a.name })),
    value: 'angled',
    // Points the selected photo there, at once: a click carries no momentum.
    onChange: (angle) => {
      const at = photos.findIndex((p) => p.id === selectedPhoto);
      photos[at] = photoAt(selectedPhoto, angle);
      viewNonce++;
      drawStrip();
      refresh();
    },
  },
});
const hint = el('p', { className: 'rs-hint', text: 'Drag to turn · right-drag to move · scroll to zoom' });

const photoStrip = pictureStrip({
  items: [],
  value: '',
  size: 64,
  max: MAX_PHOTOS,
  aspect: aspectOf(look),
  addLabel: 'Add a photo of this view',
  removeLabel: (item) => `Remove ${item.label.split(' ·')[0]!.toLowerCase()}`,
  onSelect: (id) => selectPhoto(id),
  onAdd: () => {
    const made: Photo = { ...structuredClone(thePhoto()), id: nextPhotoId(photos) };
    photos = [...photos, made];
    selectPhoto(made.id);
  },
  onRemove: (id) => {
    const at = photos.findIndex((p) => p.id === id);
    photos = photos.filter((p) => p.id !== id);
    if (selectedPhoto === id) selectPhoto(photos[Math.max(0, at - 1)]!.id);
    else { drawStrip(); refresh(); }
  },
});
const stripHost = el('div', { className: 'rs-strip' }, [photoStrip.root]);

function drawStrip() {
  photoStrip.setItems(photos.map((p, i): PictureStripItem => ({ id: p.id, label: `Photo ${i + 1} · ${angleName(p)}`, src: urls.get(`photo:${p.id}`) })));
  photoStrip.setValue(selectedPhoto);
}

function selectPhoto(id: string) {
  selectedPhoto = id;
  viewNonce++;
  const p = thePhoto();
  angleBar.setValue(p.angle as AngleId);
  drawStrip();
  refresh();
}

const card = previewCard({
  start: [angleBar.root],
  end: [hint],
  view: [photoWrap, chip],
  status: status.root,
  footer: [stripHost],
});
// Under the strip on a wide screen, so nothing covers the photo; over its corner on a phone,
// which buys the picture height.
const wide = window.matchMedia('(min-width: 901px)');
card.statusBelow(wide.matches);
wide.addEventListener('change', () => card.statusBelow(wide.matches));

let preview: StudioPreview | null = null;
try {
  preview = createStudioPreview(photoHost, {
    // Panning moves the model in the frame, and is kept with the photo like the angle and zoom.
    pan: true,
    aboveFloor: true,
    // The first drag: no angle on the switch describes the view any more.
    onOrbit: () => angleBar.setValue('view' as AngleId),
    // Dragging edits the selected photo: what you frame is what you get.
    onViewEnd: (view) => {
      const p = thePhoto();
      p.dir = view.dir;
      p.zoom = view.zoom;
      p.offset = view.offset;
      p.angle = 'view';
      drawStrip();
      scheduleThumbs();
    },
  });
} catch {
  photoWrap.replaceChildren(emptyState({
    icon: ICONS.box,
    title: "This browser can't draw 3D",
    body: 'Turn on hardware acceleration in your browser settings, or try Chrome, Edge or Firefox.',
  }));
}

/** Everything on screen follows the state. The camera only moves when the view key changes. */
function refresh() {
  if (model && preview) preview.update(model, sceneOf(thePhoto(), theWay()), `${selectedPhoto}:${viewNonce}`);
  photoHost.classList.toggle('rs-photo--clear', !backdropOf(look).sky);
  const words = generateWords(photos.length, ways.length, photoSize(look));
  setExportLabel(footer, 'renders', words.label);
  setExportNote(footer, words.note);
  showStale();
  scheduleThumbs();
}

// ---------------------------------------------------------------------------
// 5. THE MODEL (right panel)
// ---------------------------------------------------------------------------

const ACCEPT = '.stl,.obj,.3mf';
const modelBody = el('div', { className: 'rs-model' });
const modelSection = section({ title: 'Your model', body: [modelBody] });

/* The renders, once made: a grid to look at, each one opening large with its own Download, and
   all of them as one ZIP. They stay until the next Generate or a new model. */
interface Made { fileName: string; label: string; blob: Blob; url: string; thumb: string }
let renders: Made[] = [];
/** What the renders on screen were made from, to say when the settings have moved on. */
let madeFrom = '';
let madeAspect = 1;
let modelCount = 0;
const rendersBody = el('div', { className: 'rs-renders' });
const rendersSection = section({ title: 'Renders', body: [rendersBody] });
rendersSection.hidden = true;
const staleNote = el('p', { className: 'vl-hint', text: 'Settings changed since. Generate again to update them.' });
const downloadAll = button({
  label: 'Download all (ZIP)',
  icon: ICONS.download,
  block: true,
  onClick: () => {
    if (!model || !renders.length) return;
    const name = downloadName(model.stem, renders);
    if (renders.length === 1) {
      downloadFile(renders[0]!.blob, name, 'image/png');
      return;
    }
    void Promise.all(renders.map(async (r) => [r.fileName, new Uint8Array(await r.blob.arrayBuffer())] as const))
      // PNGs are compressed already: the ZIP only holds them.
      .then((files) => downloadFile(buildZip(Object.fromEntries(files), { level: 0 }), name, 'application/zip'));
  },
});

/** Everything that changes what Generate would make. */
const shootKey = () => JSON.stringify([modelCount, look, rest, turn, photos, ways]);

function showStale() {
  staleNote.hidden = !renders.length || madeFrom === shootKey();
}

function drawRenders() {
  rendersSection.hidden = renders.length === 0;
  if (!renders.length) {
    rendersBody.replaceChildren();
    return;
  }
  downloadAll.setLabel(renders.length === 1 ? 'Download PNG' : `Download all ${renders.length} (ZIP)`);
  rendersBody.replaceChildren(
    thumbGrid({
      tiles: renders.map((r, i) => thumbTile({ src: r.thumb, label: r.label, onClick: () => openViewer(i) })),
      minPx: 96,
      aspect: madeAspect,
    }),
    staleNote,
    downloadAll,
  );
  showStale();
}

function clearRenders() {
  for (const r of renders) {
    URL.revokeObjectURL(r.url);
    URL.revokeObjectURL(r.thumb);
  }
  renders = [];
  drawRenders();
}

/** A small copy of a render for its tile, so the grid does not decode a dozen 2000 px images. */
async function thumbOf(blob: Blob, aspect: number): Promise<string> {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(320 * Math.min(1, aspect));
  canvas.height = Math.round(canvas.width / aspect);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  image.close();
  const small = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return URL.createObjectURL(small ?? blob);
}

/** One render, large, with its own Download; the arrows (and the arrow keys) step through them. */
function openViewer(start: number) {
  let at = start;
  const image = el('img', { className: 'rs-viewer__image', attrs: { alt: '' } }) as HTMLImageElement;
  const caption = el('p', { className: 'rs-viewer__caption' });
  const show = () => {
    const r = renders[at]!;
    image.src = r.url;
    image.alt = r.label;
    caption.textContent = renders.length > 1 ? `${r.label} · ${at + 1} of ${renders.length}` : r.label;
  };
  const step = (by: number) => {
    at = (at + by + renders.length) % renders.length;
    show();
  };
  const many = renders.length > 1;
  const frame = el('div', { className: `rs-viewer__frame${backdropOf(look).sky ? '' : ' rs-viewer__frame--clear'}` }, [image]);
  const nav = el('div', { className: 'rs-viewer__nav' }, [
    ...(many ? [iconButton({ icon: ICONS.chevronLeft, label: 'Previous render', onClick: () => step(-1) })] : []),
    caption,
    ...(many ? [iconButton({ icon: ICONS.chevronRight, label: 'Next render', onClick: () => step(1) })] : []),
  ]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  };
  if (many) document.addEventListener('keydown', keys);
  show();
  dialog({
    title: 'Renders',
    size: 'wide',
    content: el('div', { className: 'rs-viewer' }, [frame, nav]),
    onClose: () => document.removeEventListener('keydown', keys),
    actions: [
      { label: 'Close' },
      {
        label: 'Download PNG',
        primary: true,
        // Stays open: the next one may be wanted too.
        onClick: () => {
          const r = renders[at]!;
          downloadFile(r.blob, r.fileName, 'image/png');
          return false;
        },
      },
    ],
  });
}

function drawModelPanel() {
  if (isSample) {
    modelBody.replaceChildren(dropZone({
      title: 'Drop your model',
      text: 'or click to choose a file',
      note: 'STL, OBJ or 3MF. It stays on your computer.',
      accept: ACCEPT,
      // A drop anywhere on the page is the window's to handle, so one drop is opened once.
      bubble: true,
      onFiles: (files) => void openFiles(files),
    }));
  } else {
    modelBody.replaceChildren(
      el('p', { className: 'rs-file', text: fileName }),
      uploadCta({ label: 'Replace model', icon: ICONS.upload, accept: ACCEPT, onFiles: (files) => void openFiles(files) }),
    );
  }
}

/** The status line's words for a loaded model. */
function describeModel(m: LoadedModel): string {
  if (isSample) return 'Sample model · drop your own on the right';
  const size = sizeText(sizeOf(m, orientation()));
  const coloured = regions.filter((r) => r.fileHex);
  if (!coloured.length) return size;
  const n = new Set(coloured.map((r) => r.fileHex)).size;
  return `${size} · ${n} ${n === 1 ? 'color' : 'colors'}`;
}

function errorText(err: unknown, name: string): string {
  const text = err instanceof Error ? err.message : String(err);
  if (!canRender(name) || /only stl, obj and 3mf/i.test(text)) return 'Render Studio opens STL, OBJ and 3MF. Export your model as one of those.';
  if (/has no model in it/i.test(text)) return 'There is no model in this 3MF. Export it again from your slicer.';
  if (/first plate/i.test(text)) return 'Plate 1 of this 3MF is empty. Move the model to plate 1 and export again.';
  return 'This file could not be read. Export it again and try once more.';
}

async function openFiles(files: File[]) {
  const file = files.find((f) => canRender(f.name)) ?? files[0];
  if (!file) return;
  if (!canRender(file.name)) {
    status.set(errorText(null, file.name), 'error');
    return;
  }
  await openModel(await file.arrayBuffer(), file.name, false);
}

async function openModel(bytes: ArrayBuffer, name: string, sample: boolean) {
  chip.show(`Reading ${name}…`);
  // A frame for the chip to show before the file is read on this thread.
  await new Promise((r) => setTimeout(r, 30));
  let next: LoadedModel;
  try {
    next = loadRenderModel(bytes, name);
  } catch (err) {
    chip.hide();
    status.set(errorText(err, name), 'error');
    return;
  }
  const old = model;
  model = next;
  modelCount++;
  clearRenders();
  fileName = name;
  isSample = sample;
  regions = next.regions;
  rest = 'as-loaded';
  turn = '0';
  ways = [firstColourway(regions)];
  selectedWay = ways[0]!.id;
  // A shop shoots every product the same way: photos the customer made are kept; an untouched
  // default set is picked again for the new shape.
  if (!photos.length || isDefaultSet(photos)) photos = defaultPhotos(sizeOf(next, orientation()));
  selectedPhoto = photos[0]!.id;
  viewNonce++;
  for (const r of RESTS) controls.rest.setOptionImage(r.id, null);
  showSettings();
  drawColourRows();
  drawWays();
  drawStrip();
  angleBar.setValue(thePhoto().angle as AngleId);
  drawModelPanel();
  refresh();
  status.set(describeModel(next));
  chip.hide();
  if (old) {
    // The tiles may still be drawing the old one.
    await thumbChain;
    disposeModel(old);
  }
}

// A file dropped anywhere on the page opens.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void openFiles(files);
});

// ---------------------------------------------------------------------------
// 6. GENERATE, SAVE, LOAD — every photo in every colorway, made into the Renders section.
// ---------------------------------------------------------------------------

const PROJECT_FILE: ProjectShape = { app: 'render-studio', keys: ['look', 'photos', 'colorways'] };

async function generate() {
  const m = model;
  if (!m) return;
  // The camera may still be easing after a drag: the selected photo is what is on screen now.
  if (preview && thePhoto().angle === 'view') {
    const view = preview.readView();
    Object.assign(thePhoto(), { dir: view.dir, zoom: view.zoom, offset: view.offset });
  }
  // A snapshot: the rail stays usable while the renders are made, and changes wait for the next.
  const jobs = planShoot(m.stem, photos, ways).map((job) => ({ ...job, scene: structuredClone(sceneOf(job.photo, job.way)) }));
  const shape = photoSize(look);
  const size = QUICK
    ? { width: Math.round(shape.width / 8), height: Math.round(shape.height / 8), samples: 2, supersample: 1 }
    : { width: shape.width, height: shape.height, ...STILL };
  const from = shootKey();
  const stop = new AbortController();
  making = true;
  thumbGen++;
  preview?.pause(true);
  clearRenders();
  madeFrom = from;
  madeAspect = shape.width / shape.height;
  try {
    for (const [i, job] of jobs.entries()) {
      chip.show(`Making render ${i + 1} of ${jobs.length}`, () => stop.abort());
      const blob = await renderStill(m, { ...job.scene, ...size }, { signal: stop.signal });
      // Each one shows as soon as it is made.
      renders.push({
        fileName: job.fileName,
        label: renderLabel(job, ways.length),
        blob,
        url: URL.createObjectURL(blob),
        thumb: await thumbOf(blob, madeAspect),
      });
      drawRenders();
    }
    status.set(`${renders.length} ${renders.length === 1 ? 'render' : 'renders'} ready on the right`);
  } catch {
    if (stop.signal.aborted) {
      status.set(renders.length ? `Stopped after ${renders.length} of ${jobs.length}.` : 'Stopped. Nothing was made.');
    } else {
      status.set('The renders could not be made. Reload the page and try again.', 'error');
    }
  } finally {
    chip.hide();
    making = false;
    preview?.pause(false);
    drawRenders();
    scheduleThumbs();
  }
}

const footer = sidebarFooter({
  formats: [{ id: 'renders', label: 'Generate 3 renders' }],
  exportNote: '',
  // The photos are of the customer's own model, not of a design of ours: no licence window.
  onExport: () => generate(),
  onSave: () => downloadFile(
    JSON.stringify(markProject(PROJECT_FILE, { look, photos, rest, turn, colorways: ways, model: fileName }), null, 2),
    `${safeSlug(model?.stem ?? 'render') || 'render'}-render.json`,
    'application/json',
  ),
  onLoad: (file?: File) => file && readProjectFile(file, (data) => {
    const d = data as Record<string, unknown>;
    look = coerceLook(d.look);
    keepLook();
    photos = coercePhotos(d.photos) ?? photos;
    selectedPhoto = photos[0]!.id;
    // The rotation and the colorways belong to one model: they come back only onto that one.
    if (d.model === fileName) {
      if (RESTS.some((r) => r.id === d.rest)) rest = d.rest as RestId;
      if (['0', '1', '2', '3'].includes(String(d.turn))) turn = String(d.turn) as typeof turn;
      const loaded = coerceColourways(d.colorways);
      if (loaded) { ways = loaded; selectedWay = ways[0]!.id; }
    }
    viewNonce++;
    showSettings();
    sizeChanged();
    drawWays();
    drawStrip();
    angleBar.setValue(thePhoto().angle as AngleId);
    toast('Project loaded', { kind: 'ok' });
  }, PROJECT_FILE),
  onHelp: () => dialog({
    title: 'Render Studio help',
    content: 'Drop your model on the right. Drag the picture to turn it, right-drag (or Shift-drag) to move it in the frame, and scroll to zoom; pressing an angle above it puts it back in the middle. Each picture in the strip under it is a photo Generate makes. Colors, background, lighting and size are on the left. Generate renders every photo in every colorway; they appear on the right, where you can open each one and download it, or download them all as a ZIP. The photos are yours to use anywhere.',
    actions: [{ label: 'Got it', primary: true }],
  }),
  themeStorageKey: 'render-studio-theme',
});

const reset = button({
  label: 'Reset all settings',
  icon: ICONS.rotateLeft,
  emphasis: 'ghost',
  onClick: () => {
    look = { ...DEFAULT_LOOK };
    try { localStorage.removeItem(LOOK_KEY); } catch { /* nothing stored */ }
    rest = 'as-loaded';
    turn = '0';
    ways = [firstColourway(regions)];
    selectedWay = ways[0]!.id;
    if (model) photos = defaultPhotos(sizeOf(model, orientation()));
    selectedPhoto = photos[0]!.id;
    showSettings();
    sizeChanged();
    drawWays();
    drawStrip();
    angleBar.setValue(thePhoto().angle as AngleId);
    toast('Settings reset', { kind: 'ok' });
  },
});

// ---------------------------------------------------------------------------
// 7. ASSEMBLE
// ---------------------------------------------------------------------------

const shell = appShell({
  topbar: topbarLinks({ themeToggle: false }),
  phone: true,
  left: {
    compact: true,
    header: [generatorHeader({ title: 'Render Studio', hideCredit: true })],
    scroll: [rail],
    footer: [buttonRow(reset)],
    credit: panelCredit({ title: 'Render Studio', updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [card.root],
  right: { scroll: [modelSection, rendersSection], footer: [footer] },
});
document.getElementById('app')!.append(shell.root);

showSettings();
drawModelPanel();

// The first screen is already a product: our own name keychain, three filaments, lit and framed,
// with four photos ready to download before anything is touched.
void (async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${SAMPLE}`);
    if (!res.ok) throw new Error(String(res.status));
    await openModel(await res.arrayBuffer(), SAMPLE, true);
  } catch {
    status.set('Drop your model on the right.');
  }
})();
