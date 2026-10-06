/*
  What tests/mount.test.mjs gives the clicker in place of the modules node cannot run.

  Each export stands in for one the real mount.ts (or ui/modelMode.ts) imports, under the same
  name: the WebGL viewer, the sidebars, the image tracer, the wizard, the 3MF writer, the paid and
  host seams. They do the least that keeps the app's own logic honest, and they say what happened
  to them in `seen`, so a scenario can ask what is on screen, what was written, and what the cover
  shows. `knobs` are the conditions a scenario sets up: a font that loads slowly, a trace that
  throws, a cover that takes time to draw.

  A trace names itself: its first ring's first point carries an index into `traces`, which the
  test's worker reads back, so a built part is named after the design it came from
  ("built:image:cc=4|w=40|st=0") and a check can say exactly which build reached the file.
*/
import type { ClickerPart, RegionSet } from '../src/types';

/** What the stand-ins saw, for the scenarios to read back. */
export const seen = {
  /** The parts the viewer was last given: what is on screen. */
  screen: [] as ClickerPart[],
  /** Every 3MF the browser path wrote: its parts, its file name and its options (cover, credit). */
  downloads: [] as { parts: ClickerPart[]; name: string; opts: Record<string, unknown> }[],
  /** Every 3MF made in memory for a desktop host: its parts and options. */
  built: [] as { parts: ClickerPart[]; opts: Record<string, unknown> }[],
  /** The parts of every OBJ made for the MakerLab host. */
  objs: [] as ClickerPart[][],
  /** …and what each was told about the design (whose shape it is). */
  objOpts: [] as Record<string, unknown>[],
  /** What each cover drawing shows: the name of the part on screen when the picture was taken. */
  covers: [] as string[],
  /** createUi's callbacks: the controls a scenario presses. */
  ui: null as any,
  /** The state the sidebars were last asked to show. */
  state: null as any,
  /** createModelPanel's options: Model mode's own controls. */
  modelPanel: null as any,
  /** Every artifact set handed to the MakerLab host. */
  sdkExports: [] as any[],
  /** The seams handed to the paid panel, in the MakerWorld build. */
  pro: null as any,
};

/** The conditions a scenario sets up. `reset()` puts them back. */
export const knobs = {
  /** The MakerWorld build, connected to its host. Read when the app mounts. */
  makerlab: false,
  /** How long a cover takes to draw, ms. The picture is taken when it is done, as a viewer that
   *  waited for a frame would take it. */
  coverMs: 0,
  /** A message for the image tracer, or the SVG reader, to throw. */
  imageTraceThrows: null as string | null,
  svgTraceThrows: null as string | null,
  /** How long a face takes to load, ms, by id; faces that fail to load; faces already loaded. */
  fontMs: {} as Record<string, number>,
  fontFails: new Set<string>(),
  fontsLoaded: new Set<string>(),
  /** Faces that cannot write the text typed into them. */
  cantWrite: new Set<string>(),
};

/** Every trace made, so the worker can name a build after the design it came from. */
export const traces: string[] = [];

export function reset() {
  seen.screen = [];
  seen.downloads.length = 0;
  seen.built.length = 0;
  seen.objs.length = 0;
  seen.objOpts.length = 0;
  seen.covers.length = 0;
  seen.ui = null;
  seen.state = null;
  seen.modelPanel = null;
  seen.sdkExports.length = 0;
  seen.pro = null;
  Object.assign(knobs, { makerlab: false, coverMs: 0, imageTraceThrows: null, svgTraceThrows: null, fontMs: {} });
  knobs.fontFails = new Set();
  knobs.fontsLoaded = new Set(['helvetiker-regular', 'helvetiker-bold']);
  knobs.cantWrite = new Set();
  traces.length = 0;
}
reset();

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const noop = () => {};
/** An object whose every method does nothing, apart from the ones given. */
const quiet = <T extends object>(own: T): T & Record<string, any> =>
  new Proxy(own as T & Record<string, any>, { get: (t, p) => (p in t ? t[p as string] : noop) });

/** A trace of `describe`: one region, one ring, whose first point names it. */
function traced(describe: string): RegionSet {
  const id = traces.push(describe) - 1;
  return {
    regions: [{ quantRgb: [10, 20, 30], coverage: 1, components: [{ rings: [[[id, 0], [1, 0], [0, 1]]], coverage: 1 }] }],
    outline: [[[id, 0], [1, 0], [0, 1]]],
    aspect: 1,
  } as unknown as RegionSet;
}

/* ------------------------------------------------- virtual:makerlab, virtual:pro-pack */

export let MAKERLAB = false;
/** Called by the scenarios before mounting: `MAKERLAB` is read when the app mounts. */
export function setMakerlab(on: boolean) {
  MAKERLAB = on;
}
export const SELLER_PACK = 'seller_pack';
export const ensureAccess = async () => false;
export const initMakerlab = async () => null;
export const isReady = () => knobs.makerlab;
export const can = () => knobs.makerlab;
export async function sdkExport(options: any) {
  seen.sdkExports.push(options);
  return { success: true };
}
export const sdkToast = async () => {};
export function mountProFeatures(deps: any) {
  seen.pro = deps;
  return { refresh() {}, gateShape: async () => false, destroy() {}, paramsPatch: () => ({}) };
}
export const openShapeEditor = async () => null;

/* ------------------------------------------------------------- viewer/viewer, plates */

export function createViewer() {
  return quiet({
    setParts(parts: ClickerPart[]) {
      seen.screen = parts;
    },
    async renderCoverPng() {
      if (knobs.coverMs) await wait(knobs.coverMs);
      const shows = seen.screen[0]?.name ?? '';
      seen.covers.push(shows);
      return new TextEncoder().encode(shows);
    },
    renderThumbnail: () => null,
    renderToPng: async () => null,
  });
}
export const mountPlatePicker = noop;

/* ------------------------------------------------------- the sidebars and Model mode's panel */

export function createUi(_left: unknown, _right: unknown, _status: unknown, callbacks: any) {
  seen.ui = callbacks;
  return quiet({
    update(state: any) {
      seen.state = state;
    },
  });
}
export function createModelPanel(options: any) {
  seen.modelPanel = options;
  return quiet({ right: quiet({}), parts: { cut: quiet({}), model: quiet({}), colours: quiet({}) } });
}

/* ------------------------------------------------------------ @vostok/trace, the wizard */

export async function loadFileToImage() {
  return { width: 4, height: 4, data: new Uint8ClampedArray(64) };
}
export function processImage(_image: unknown, colorCount: number) {
  if (knobs.imageTraceThrows) throw new Error(knobs.imageTraceThrows);
  return traced(`image:cc=${colorCount}`);
}
export function parseSvg(text: string) {
  if (knobs.svgTraceThrows) throw new Error(knobs.svgTraceThrows);
  return traced(`svg:${text}`);
}
export function runWizard(options: any) {
  options.onComplete({
    adjusted: options.baseImage,
    preprocess: { keepBackground: false },
    colorCount: 4,
    smoothing: 0.1,
    colorMode: 'normal',
    limitedColors: [],
    paletteOverrides: [],
  });
}
export async function openSvgPreview() {
  return { options: {} };
}

/* ----------------------------------------------------------------- the writers */

export function buildThreeMF(parts: ClickerPart[], opts: Record<string, unknown> = {}) {
  seen.built.push({ parts, opts });
  return new Uint8Array(0);
}
export function downloadThreeMF(parts: ClickerPart[], name: string, opts: Record<string, unknown> = {}) {
  seen.downloads.push({ parts, name, opts });
}
export function clickerObjMtl(parts: ClickerPart[], opts: Record<string, unknown> = {}) {
  seen.objs.push(parts);
  seen.objOpts.push(opts);
  return { obj: '', mtl: '' };
}
export const textToArrayBuffer = () => new ArrayBuffer(0);
export const downloadFile = noop;
export const assemblyMinZ = () => 0;
export const groupBBox = () => ({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
export const plateWarnings = () => [] as string[];

/* ----------------------------------------------- shapes, samples, letters, icons */

export const allShapes = () => [];
export const findShape = () => null;
export const loadPackShapes = async () => {};
export const SAMPLES = [{ name: 'Vostok Labs', src: 'sample.png', load: loadFileToImage }];
export const SVG_SAMPLES: { name: string; src: string }[] = [];
export const LUCIDE_ICONS = [{ name: 'circle', node: [] }];
export const buildSvg = () => '<svg/>';

export const currentFontIdOf = (id: string) => id;
export const fontOptions = () => [
  { id: 'helvetiker-regular', name: 'Standard' },
  { id: 'pacifico', name: 'Pacifico' },
  { id: 'gothic-a1', name: 'Gothic A1' },
];
export const alphabetOf = () => 'Korean';
export const fontWritesText = (id: string) => !knobs.cantWrite.has(id);
export const facesThatWrite = () => fontOptions().map((f) => f.id).filter((id) => !knobs.cantWrite.has(id));
/** As the real one: false when the face cannot be had, and the trace then falls back. */
export async function ensureFont(id: string) {
  if (knobs.fontMs[id]) await wait(knobs.fontMs[id]);
  if (knobs.fontFails.has(id)) return false;
  knobs.fontsLoaded.add(id);
  return true;
}
/** As the real one, a face that is not loaded yet draws as Standard. */
export function parseLetter(text: string, fontId: string) {
  const face = knobs.fontsLoaded.has(fontId) ? fontId : 'helvetiker-regular';
  return { ...traced(`text:${text}:font=${face}`), sizeMul: 1 };
}
export function parseBlockChain(_slots: unknown, fontId: string) {
  return traced(`blocks:font=${fontId}`);
}
export const importFontFile = async () => ({ fonts: [], failed: [] });
