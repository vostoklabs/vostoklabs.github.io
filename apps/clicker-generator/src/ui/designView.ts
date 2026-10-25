/**
 * The Design view: the clicker's top face at true scale, where the picture, the words, the
 * switches, the keyring loop and the base are objects you drag, resize and turn.
 *
 * The stage's 2D mode, beside the 3D one: the rail, the right panel and Download stay where they
 * are, and undo is the app's undo. The rail's sliders set the same values, so a drag here and a
 * slider there are two hands on one setting. It is drawn from the outlines the build actually
 * made (`DesignLayout`, sent back with every clicker build), so what you arrange is what prints.
 *
 * The block underneath is the kit's Design canvas (pan, zoom, selection, handles, snapping,
 * nudging). This file owns what is ON it: which objects there are, how each is drawn, what each
 * may do, the clamps the build would apply anyway (applied live, so a switch stops where the
 * geometry would stop it), and turning a finished drag into one edit for mount.ts. A drag
 * redraws here at once; the build runs once, on release.
 */
import {
  designCanvas, zoomControl,
  type DesignBox, type DesignChange, type DesignObject,
} from '@vostok/ui-kit';
import type { DesignLayout, RGB, Ring, SwitchPlacement } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A word on the cap: its outline in millimetres, centred on its own box and not yet turned. */
export interface DesignWord {
  id: string;
  text: string;
  x: number;
  y: number;
  heightMm: number;
  rotation: number;
  /** Glyph outlines in mm, centred on (0, 0), unrotated. */
  rings: Ring[];
  /** The word's box at that size, mm. */
  w: number;
  rgb: RGB;
}

/** One colour of the picture: its shapes' rings, normalised the way the tracer returns them. */
export interface DesignArtRegion {
  rings: Ring[];
  rgb: RGB;
  coverage: number;
}

/** Everything the view draws, from the last build and the state as it is now. */
export interface DesignInput {
  layout: DesignLayout;
  /** The Design size and Size the layout was built at, so a resize can be drawn at its new size
   *  before the rebuild that makes it lands. */
  builtDesignScale: number;
  builtCapWidthMm: number;
  /** The base follows the picture's outline: the picture IS the base. */
  outlineBase: boolean;
  /** The picture, biggest colour first (smaller ones are carved on top, so they draw on top). */
  art: DesignArtRegion[];
  /** The picture's normalised box (longest side 1). */
  artBox: { w: number; h: number };
  imageOffset: { x: number; y: number };
  designScale: number;
  designRotation: number;
  capWidthMm: number;
  words: DesignWord[];
  switches: SwitchPlacement[];
  /** The clear square an MX switch needs, mm (measured off the socket at init). */
  switchColumnMm: number;
  keychain: { enabled: boolean; angleDeg: number };
  /** The base can be stretched freely (a rectangle, a capsule); every other shape keeps its
   *  proportions when its corners are dragged. */
  freeAspect: boolean;
  bodyRgb: RGB;
  capRgb: RGB;
  /** How far the letters are fattened (+) or thinned (−), mm, as Boldness sets it: Text mode's
   *  letters, which are the picture there, and the words on a picture. */
  artBold: number;
  wordBold: number;
}

/** A finished drag or nudge, as the state it should become. */
export type DesignEdit =
  | { kind: 'art'; offset: { x: number; y: number }; designScale: number; rotation: number }
  | { kind: 'outline'; capWidthMm: number; rotation: number }
  /** An Outline base's picture moved (dx, dy) mm: the switches go the other way. */
  | { kind: 'outline-move'; dx: number; dy: number }
  | { kind: 'word'; id: string; x: number; y: number; heightMm: number; rotation: number }
  | { kind: 'word-delete'; id: string }
  | { kind: 'switch'; index: number; x: number; y: number; rotation: number }
  | { kind: 'loop'; angleDeg: number }
  | { kind: 'base'; w: number; h: number };

/** What was picked, so the rail can open the category that answers to it. */
export type DesignTarget =
  | { kind: 'art' }
  | { kind: 'base' }
  | { kind: 'loop' }
  | { kind: 'word'; id: string }
  | { kind: 'switch'; index: number };

export interface DesignViewOptions {
  /** The stage the view covers while it is shown. */
  stage: HTMLElement;
  onEdit(edit: DesignEdit): void;
  onSelect(target: DesignTarget | null): void;
}

export interface DesignView {
  show(on: boolean): void;
  isShown(): boolean;
  render(input: DesignInput | null): void;
  /** Select by object id ('art', 'base', 'loop', 'word:<id>', 'switch:<i>'); fires nothing. */
  select(id: string | null): void;
  /** Frame the whole clicker again: a new subject, or the view being opened. */
  refit(): void;
  destroy(): void;
}

/* The ranges the controls those objects replace already enforced, so a drag cannot reach a value
   the rail could not. */
const OFFSET_LIMIT = 25;
const SCALE_MIN = 0.3;
const SCALE_MAX = 2;
const SIZE_MIN = 20;
const SIZE_MAX = 70;
const BASE_MIN = 24;
const BASE_MAX = 120;
const WORD_MIN_MM = 2;
const WORD_MAX_MM = 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rgbCss = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const shade = (c: RGB, k: number): RGB => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
const signed = (v: number) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
const turned = (r: number) => (Math.abs(r) >= 0.5 ? ` · ${Math.round(r)}°` : '');
/** Turn a rotation into (-180, 180]. */
const wrapDeg = (d: number) => {
  const r = ((d % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};

/** Rings as one SVG path. Millimetres to two places is finer than any printer and coarser than
 *  JSON; the picture's rings are NORMALISED (longest side 1), where two places would be a third
 *  of a millimetre on the cap and draw every edge as a staircase, so they ask for more. */
export function ringsPath(rings: Ring[], places = 2): string {
  let d = '';
  for (const ring of rings) {
    if (ring.length < 3) continue;
    d += `M${ring.map(([x, y]) => `${+x.toFixed(places)} ${+y.toFixed(places)}`).join('L')}Z`;
  }
  return d;
}

/** The rings' bounding box. */
export function ringsBounds(rings: Ring[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Where the keyring loop sits for a bearing: the ray from the body's area centroid at `angleDeg`
 * leaves the outermost boundary at `p`, and the loop's centre is one loop radius further out.
 * The same construction `edgePointAt` makes in the build, so the loop on the canvas lands where
 * the printed one will.
 */
export function loopCentre(body: Ring[], angleDeg: number, loopR: number): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
  }
  const b = ringsBounds(body);
  const ox = Math.abs(area) > 1e-6 ? cx / (3 * area) : (b.minX + b.maxX) / 2;
  const oy = Math.abs(area) > 1e-6 ? cy / (3 * area) : (b.minY + b.maxY) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  let best = -Infinity;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const ex = ring[i][0] - ax, ey = ring[i][1] - ay;
      const det = -dx * ey + ex * dy;
      if (Math.abs(det) < 1e-12) continue;
      const rx = ax - ox, ry = ay - oy;
      const t = (-rx * ey + ex * ry) / det;
      const u = (dx * ry - dy * rx) / det;
      if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
    }
  }
  if (!Number.isFinite(best)) best = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  return [ox + dx * (best + loopR), oy + dy * (best + loopR)];
}

/** The body's area centroid, for turning a dragged loop back into a bearing. */
function centroidOf(body: Ring[]): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (const ring of body) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
  }
  if (Math.abs(area) > 1e-6) return [cx / (3 * area), cy / (3 * area)];
  const b = ringsBounds(body);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

export function createDesignView(opts: DesignViewOptions): DesignView {
  const root = document.createElement('div');
  root.className = 'cg-design';
  root.hidden = true;

  let input: DesignInput | null = null;
  let shown = false;
  let fitted = false;

  const svg = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): SVGElementTagNameMap[K] => {
    const n = document.createElementNS(SVG_NS, tag);
    if (cls) n.setAttribute('class', cls);
    return n;
  };

  /** The object picked on the canvas: a picked switch is drawn tinted, the others faint. */
  let picked: string | null = null;
  const markPicked = () => {
    [...switchesEl.children].forEach((g, k) => g.classList.toggle('is-picked', picked === `switch:${k}`));
  };
  const canvas = designCanvas({
    label: 'The clicker from above',
    onSelect: (id) => {
      picked = id;
      markPicked();
      opts.onSelect(targetOf(id));
    },
    // While a drag goes on, the thing dragged follows the pointer; on release it is one edit.
    onChange: (id, box, phase, kind) => {
      if (phase === 'end') commit(id, box, kind);
      else preview(id, box);
    },
    onDelete: (id) => {
      if (id.startsWith('word:')) opts.onEdit({ kind: 'word-delete', id: id.slice(5) });
    },
    constrain: (id, box) => constrain(id, box),
    pill: (id, box) => pillOf(id, box),
    guides: { x: [0], y: [0] },
    onZoom: (z) => zoom.set(z),
    onBackground: () => opts.onSelect(null),
  });
  const zoom = zoomControl({ onZoom: (f) => canvas.zoomBy(f), onFit: () => refit() });
  root.append(canvas.root, zoom.root);
  opts.stage.append(root);

  /* The picture, drawn in the content layer's millimetres: a faint grid, the body, the slip-fit
     gap, the cap, then (clipped to the cap's frame) the picture's colours, the words, and on top
     the switches. Built once; `render` only changes what they say. The body and the picture are
     each in a group of their own, so a drag can carry them before the build has run: `baseG` for
     a base being resized, `shapeG` (base and picture together) for an Outline base's picture,
     which is the base. */
  const defs = svg('defs');
  const clip = svg('clipPath');
  clip.id = `cg-design-clip-${Math.random().toString(36).slice(2, 8)}`;
  const clipPath = svg('path');
  clip.append(clipPath);
  // Thinned letters' masks (see `embolden`), made afresh by every draw.
  const masks = svg('g');
  defs.append(clip, masks);
  const grid = svg('path', 'cg-design__grid');
  const gridMajor = svg('path', 'cg-design__grid cg-design__grid--major');
  const bodyEl = svg('path', 'cg-design__body');
  const wellEl = svg('path', 'cg-design__well');
  const capEl = svg('path', 'cg-design__cap');
  const artClip = svg('g');
  artClip.setAttribute('clip-path', `url(#${clip.id})`);
  const artEl = svg('g');
  const wordsEl = svg('g');
  artClip.append(artEl, wordsEl);
  const baseG = svg('g');
  baseG.append(bodyEl, wellEl, capEl);
  const shapeG = svg('g');
  shapeG.append(baseG, artClip);
  const switchesEl = svg('g');
  // The keyring loop while it is dragged: the build draws it into the body's outline after.
  const loopGhost = svg('g', 'cg-design__loop-ghost');
  const loopRing = svg('circle');
  const loopHole = svg('circle', 'cg-design__loop-ghost-hole');
  loopGhost.append(loopRing, loopHole);
  loopGhost.setAttribute('display', 'none');
  canvas.content.append(defs, grid, gridMajor, shapeG, switchesEl, loopGhost);

  /** The artwork's paths, rebuilt only when the picture itself changes. */
  let artFor: DesignArtRegion[] | null = null;

  /* Boldness as the build makes it, a round offset of `bold` mm: fattened, a stroke of the
     shape's own colour round its edge; thinned, a mask taking a band that wide off it. `unit` is
     the millimetres in one of the path's units (the picture is drawn in its normalised ones). */
  let maskSeq = 0;
  function embolden(p: SVGPathElement, colour: string, bold: number, unit: number) {
    p.removeAttribute('mask');
    if (bold > 0.005) {
      p.setAttribute('stroke', colour);
      p.setAttribute('stroke-width', String((2 * bold) / unit));
      p.setAttribute('stroke-linejoin', 'round');
      return;
    }
    p.removeAttribute('stroke');
    p.removeAttribute('stroke-width');
    p.removeAttribute('stroke-linejoin');
    if (bold >= -0.005) return;
    const mask = svg('mask');
    mask.id = `${clip.id}-thin${maskSeq++}`;
    const band = svg('path');
    band.setAttribute('d', p.getAttribute('d') ?? '');
    band.setAttribute('fill', '#fff');
    band.setAttribute('stroke', '#000');
    band.setAttribute('stroke-width', String((-2 * bold) / unit));
    band.setAttribute('stroke-linejoin', 'round');
    mask.append(band);
    masks.append(mask);
    p.setAttribute('mask', `url(#${mask.id})`);
  }

  function drawGrid(b: { minX: number; minY: number; maxX: number; maxY: number }) {
    // 5 mm squares with every 10 mm a little stronger, over twice the clicker's own span.
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 40);
    const lo = (v: number) => Math.floor((v - span) / 10) * 10;
    const hi = (v: number) => Math.ceil((v + span) / 10) * 10;
    const x0 = lo(b.minX), x1 = hi(b.maxX), y0 = lo(b.minY), y1 = hi(b.maxY);
    let minor = '', major = '';
    for (let x = x0; x <= x1; x += 5) (x % 10 === 0 ? (major += `M${x} ${y0}V${y1}`) : (minor += `M${x} ${y0}V${y1}`));
    for (let y = y0; y <= y1; y += 5) (y % 10 === 0 ? (major += `M${x0} ${y}H${x1}`) : (minor += `M${x0} ${y}H${x1}`));
    grid.setAttribute('d', minor);
    gridMajor.setAttribute('d', major);
  }

  /** How the picture is placed right now: the build's own placement, carried to the state's
   *  values so a drag that has ended but not yet been rebuilt draws where it was dropped. */
  function artTransform(i: DesignInput): { s: number; ox: number; oy: number; r: number } {
    const a = i.layout.art;
    if (i.outlineBase) {
      return { s: a.scale * (i.capWidthMm / Math.max(1e-6, i.builtCapWidthMm)), ox: 0, oy: 0, r: i.designRotation };
    }
    return {
      s: a.scale * (i.designScale / Math.max(1e-6, i.builtDesignScale)),
      ox: i.imageOffset.x,
      oy: i.imageOffset.y,
      r: i.designRotation,
    };
  }

  /** The build the outlines were last drawn from: they only change when a new one lands. */
  let layoutFor: DesignLayout | null = null;
  let clipFor = '';

  function draw(i: DesignInput) {
    const L = i.layout;
    // Whatever a drag carried ahead of the build is drawn from the state again.
    shapeG.removeAttribute('transform');
    baseG.removeAttribute('transform');
    loopGhost.setAttribute('display', 'none');
    if (L !== layoutFor) {
      layoutFor = L;
      drawGrid(ringsBounds(L.body));
      // With the keyring loop on, the body as the build made it: the tab, the bridge and the hole.
      bodyEl.setAttribute('d', ringsPath(L.silhouette ?? L.body));
      wellEl.setAttribute('d', ringsPath(L.well));
      capEl.setAttribute('d', ringsPath(L.cap));
      clipFor = '';
    }
    // Words on an Outline base grow the base round them, so only a shape base clips them.
    const clipKey = i.outlineBase ? 'cap' : 'image';
    if (clipKey !== clipFor) {
      clipFor = clipKey;
      clipPath.setAttribute('d', ringsPath(i.outlineBase ? L.cap : L.imageArea));
    }
    bodyEl.setAttribute('fill', rgbCss(i.bodyRgb));
    wellEl.setAttribute('fill', rgbCss(shade(i.bodyRgb, 0.72)));
    capEl.setAttribute('fill', rgbCss(i.capRgb));

    masks.replaceChildren();
    maskSeq = 0;
    const sorted = [...i.art].sort((a, b) => b.coverage - a.coverage);
    if (artFor !== i.art) {
      artFor = i.art;
      artEl.replaceChildren(...sorted.map((r) => {
        const p = svg('path');
        p.setAttribute('d', ringsPath(r.rings, 5));
        return p;
      }));
    }
    // Recolours and boldness arrive without a new trace: painted in place.
    const t = artTransform(i);
    [...artEl.children].forEach((p, k) => {
      if (!sorted[k]) return;
      const colour = rgbCss(sorted[k].rgb);
      p.setAttribute('fill', colour);
      embolden(p as SVGPathElement, colour, i.artBold, t.s);
    });
    artEl.setAttribute('transform', `translate(${t.ox} ${t.oy}) scale(${t.s}) rotate(${t.r})`);

    wordsEl.replaceChildren(...i.words.map((w) => {
      const p = svg('path');
      const colour = rgbCss(w.rgb);
      p.setAttribute('d', ringsPath(w.rings));
      p.setAttribute('fill', colour);
      p.setAttribute('transform', `translate(${w.x} ${w.y}) rotate(${w.rotation})`);
      embolden(p, colour, i.wordBold, 1);
      return p;
    }));

    /* Each switch: the square it needs, tinted, turned with it, and its number upright in the
       middle, the number the Switch category lists it by. A press anywhere in the square takes
       it; the picture is taken round it. */
    switchesEl.replaceChildren(...i.switches.map((sw, k) => {
      const g = svg('g', 'cg-design__switch');
      g.setAttribute('transform', `translate(${sw.x} ${sw.y})`);
      const turn = svg('g');
      turn.setAttribute('transform', `rotate(${sw.rotation})`);
      const half = i.switchColumnMm / 2;
      const sq = svg('rect');
      sq.setAttribute('x', String(-half));
      sq.setAttribute('y', String(-half));
      sq.setAttribute('width', String(i.switchColumnMm));
      sq.setAttribute('height', String(i.switchColumnMm));
      sq.setAttribute('rx', '1.5');
      turn.append(sq);
      const badge = svg('circle', 'cg-design__switch-badge');
      badge.setAttribute('r', '2.6');
      const num = svg('text', 'cg-design__switch-number');
      num.setAttribute('font-size', '3.4');
      // The content layer is +y up; the number is turned back to read the right way round.
      num.setAttribute('transform', 'scale(1 -1)');
      num.setAttribute('text-anchor', 'middle');
      num.setAttribute('dominant-baseline', 'central');
      num.textContent = String(k + 1);
      g.append(turn, badge, num);
      return g;
    }));
    markPicked();
  }

  /** A drag going on, drawn before the build has run: what is dragged follows the pointer. */
  function preview(id: string, box: DesignBox) {
    const i = input;
    if (!i) return;
    if (id === 'art') {
      const t = artTransform(i);
      if (i.outlineBase) {
        // The picture is the base here: they go together, and the words on them.
        const k = t.s > 0 ? box.w / (i.artBox.w * t.s) : 1;
        shapeG.setAttribute('transform', `translate(${box.cx} ${box.cy}) rotate(${box.rotation - t.r}) scale(${k})`);
      } else {
        const s = i.artBox.w > 0 ? box.w / i.artBox.w : t.s;
        artEl.setAttribute('transform', `translate(${box.cx} ${box.cy}) scale(${s}) rotate(${box.rotation})`);
      }
    } else if (id.startsWith('word:')) {
      const k = i.words.findIndex((w) => `word:${w.id}` === id);
      const w = i.words[k];
      if (w) wordsEl.children[k]?.setAttribute('transform', `translate(${box.cx} ${box.cy}) rotate(${box.rotation}) scale(${box.h / w.heightMm})`);
    } else if (id.startsWith('switch:')) {
      const g = switchesEl.children[Number(id.slice(7))];
      g?.setAttribute('transform', `translate(${box.cx} ${box.cy})`);
      g?.firstElementChild?.setAttribute('transform', `rotate(${box.rotation})`);
    } else if (id === 'loop' && i.layout.loop) {
      for (const [c, r] of [[loopRing, i.layout.loop.outerR], [loopHole, i.layout.loop.holeR]] as const) {
        c.setAttribute('cx', String(box.cx));
        c.setAttribute('cy', String(box.cy));
        c.setAttribute('r', String(r));
      }
      loopRing.setAttribute('fill', rgbCss(i.bodyRgb));
      loopGhost.removeAttribute('display');
    } else if (id === 'base') {
      const b = ringsBounds(i.layout.body);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const sx = box.w / Math.max(1e-6, b.maxX - b.minX);
      const sy = box.h / Math.max(1e-6, b.maxY - b.minY);
      baseG.setAttribute('transform', `translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
    }
  }

  function objectsOf(i: DesignInput): DesignObject[] {
    const L = i.layout;
    const out: DesignObject[] = [];
    const b = ringsBounds(L.body);
    if (!i.outlineBase && Number.isFinite(b.minX)) {
      out.push({
        id: 'base',
        label: 'Base',
        box: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY, rotation: 0 },
        move: false,
        resize: i.freeAspect ? 'free' : 'uniform',
        grab: 'border',
        z: 0,
      });
    }
    const t = artTransform(i);
    out.push({
      id: 'art',
      label: i.outlineBase ? 'Picture and base' : 'Picture',
      box: { cx: t.ox, cy: t.oy, w: i.artBox.w * t.s, h: i.artBox.h * t.s, rotation: t.r },
      resize: 'uniform',
      rotate: true,
      z: 1,
    });
    for (const w of i.words) {
      out.push({
        id: `word:${w.id}`,
        label: `Words: ${w.text}`,
        box: { cx: w.x, cy: w.y, w: w.w, h: w.heightMm, rotation: w.rotation },
        resize: 'uniform',
        rotate: true,
        deletable: true,
        z: 2,
      });
    }
    i.switches.forEach((sw, k) => {
      out.push({
        id: `switch:${k}`,
        label: i.switches.length > 1 ? `Switch ${k + 1}` : 'Switch',
        box: { cx: sw.x, cy: sw.y, w: i.switchColumnMm, h: i.switchColumnMm, rotation: sw.rotation },
        rotate: true,
        z: 3,
      });
    });
    if (i.keychain.enabled && L.loop) {
      const d = L.loop.outerR * 2;
      out.push({ id: 'loop', label: 'Keyring loop', box: { cx: L.loop.x, cy: L.loop.y, w: d, h: d, rotation: 0 }, shape: 'circle', z: 3 });
    }
    return out;
  }

  /** How far an Outline base's picture can be dragged, left/right then down/up: as far as keeps
   *  every switch inside the box the build clamps them into, since they move the other way. */
  function outlineReach(i: DesignInput): [number, number, number, number] {
    const sb = i.layout.switchBox;
    let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
    for (const sw of i.switches) {
      loX = Math.max(loX, sw.x - sb.hiX);
      hiX = Math.min(hiX, sw.x - sb.loX);
      loY = Math.max(loY, sw.y - sb.hiY);
      hiY = Math.min(hiY, sw.y - sb.loY);
    }
    // A box with no room on an axis holds the switches still on it, so the picture is too.
    if (!(loX <= hiX)) loX = hiX = 0;
    if (!(loY <= hiY)) loY = hiY = 0;
    return [Math.min(0, loX), Math.max(0, hiX), Math.min(0, loY), Math.max(0, hiY)];
  }

  function constrain(id: string, box: DesignBox): DesignBox {
    const i = input;
    if (!i) return box;
    if (id === 'art') {
      const t = artTransform(i);
      const w0 = i.artBox.w * t.s;
      let k = w0 > 0 ? box.w / w0 : 1;
      if (i.outlineBase) {
        k = clamp(i.capWidthMm * k, SIZE_MIN, SIZE_MAX) / i.capWidthMm;
        const [loX, hiX, loY, hiY] = outlineReach(i);
        return { ...box, cx: clamp(box.cx, loX, hiX), cy: clamp(box.cy, loY, hiY), w: w0 * k, h: i.artBox.h * t.s * k };
      }
      k = clamp(i.designScale * k, SCALE_MIN, SCALE_MAX) / i.designScale;
      return {
        ...box,
        cx: clamp(box.cx, -OFFSET_LIMIT, OFFSET_LIMIT),
        cy: clamp(box.cy, -OFFSET_LIMIT, OFFSET_LIMIT),
        w: w0 * k,
        h: i.artBox.h * t.s * k,
      };
    }
    if (id.startsWith('switch:')) {
      const sb = i.layout.switchBox;
      const mid = (lo: number, hi: number, v: number) => (lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi));
      return { ...box, cx: mid(sb.loX, sb.hiX, box.cx), cy: mid(sb.loY, sb.hiY, box.cy) };
    }
    if (id === 'loop' && i.layout.loop) {
      const [cx, cy] = centroidOf(i.layout.body);
      const angle = (Math.atan2(box.cy - cy, box.cx - cx) * 180) / Math.PI;
      const [x, y] = loopCentre(i.layout.body, angle, i.layout.loop.outerR);
      return { ...box, cx: x, cy: y };
    }
    if (id.startsWith('word:')) {
      const word = i.words.find((w) => `word:${w.id}` === id);
      const h = clamp(box.h, WORD_MIN_MM, WORD_MAX_MM);
      const k = box.h > 0 ? h / box.h : 1;
      const b = ringsBounds(i.layout.body);
      return {
        ...box,
        cx: clamp(box.cx, b.minX, b.maxX),
        cy: clamp(box.cy, b.minY, b.maxY),
        w: word ? (word.w / word.heightMm) * h : box.w * k,
        h,
      };
    }
    if (id === 'base') {
      const w = clamp(box.w, BASE_MIN, BASE_MAX);
      const h = clamp(box.h, BASE_MIN, BASE_MAX);
      return { ...box, w, h };
    }
    return box;
  }

  function commit(id: string, box: DesignBox, kind: DesignChange) {
    const i = input;
    if (!i) return;
    if (id === 'art') {
      const t = artTransform(i);
      const w0 = i.artBox.w * t.s;
      const k = w0 > 0 ? box.w / w0 : 1;
      if (i.outlineBase && (kind === 'move' || kind === 'nudge')) {
        /* The picture is the base, so what moving it changes is where the switches sit on it:
           they move the other way. The view moves with the picture, so it stays where it was
           let go and the switches stay where they were, both on screen. */
        const dx = Math.round(box.cx * 10) / 10;
        const dy = Math.round(box.cy * 10) / 10;
        if (dx || dy) {
          canvas.panBy(dx, dy);
          opts.onEdit({ kind: 'outline-move', dx, dy });
        }
      } else if (i.outlineBase) {
        opts.onEdit({ kind: 'outline', capWidthMm: Math.round(clamp(i.capWidthMm * k, SIZE_MIN, SIZE_MAX)), rotation: Math.round(wrapDeg(box.rotation)) });
      } else {
        opts.onEdit({
          kind: 'art',
          offset: { x: Math.round(box.cx * 10) / 10, y: Math.round(box.cy * 10) / 10 },
          designScale: Math.round(clamp(i.designScale * k, SCALE_MIN, SCALE_MAX) * 100) / 100,
          rotation: Math.round(wrapDeg(box.rotation)),
        });
      }
    } else if (id.startsWith('word:')) {
      opts.onEdit({
        kind: 'word',
        id: id.slice(5),
        x: Math.round(box.cx * 10) / 10,
        y: Math.round(box.cy * 10) / 10,
        heightMm: Math.round(box.h * 10) / 10,
        rotation: Math.round(wrapDeg(box.rotation)),
      });
    } else if (id.startsWith('switch:')) {
      opts.onEdit({
        kind: 'switch',
        index: Number(id.slice(7)),
        x: Math.round(box.cx * 10) / 10,
        y: Math.round(box.cy * 10) / 10,
        rotation: Math.round(wrapDeg(box.rotation)),
      });
    } else if (id === 'loop') {
      const [cx, cy] = centroidOf(i.layout.body);
      const angle = (Math.atan2(box.cy - cy, box.cx - cx) * 180) / Math.PI;
      opts.onEdit({ kind: 'loop', angleDeg: Math.round(((angle % 360) + 360) % 360) });
    } else if (id === 'base') {
      opts.onEdit({ kind: 'base', w: Math.round(box.w), h: Math.round(box.h) });
    }
    // An edit redraws from the state it made; one that changed nothing would leave the drag's
    // drawing where it was let go.
    if (input) draw(input);
  }

  function pillOf(id: string, box: DesignBox): string | null {
    const i = input;
    if (!i) return null;
    if (id === 'art') {
      const t = artTransform(i);
      const w0 = i.artBox.w * t.s;
      const k = w0 > 0 ? box.w / w0 : 1;
      const moved = Math.abs(box.cx) >= 0.05 || Math.abs(box.cy) >= 0.05 ? ` · ${signed(box.cx)}, ${signed(box.cy)} mm` : '';
      if (i.outlineBase) return `${Math.round(i.capWidthMm * k)} mm${moved}${turned(box.rotation)}`;
      return `${Math.round(i.designScale * k * 100)} %${moved}${turned(box.rotation)}`;
    }
    if (id.startsWith('word:')) return `${box.h.toFixed(1)} mm${turned(box.rotation)}`;
    if (id.startsWith('switch:')) return `X ${signed(box.cx)} · Y ${signed(box.cy)} mm${turned(box.rotation)}`;
    if (id === 'loop') {
      const [cx, cy] = centroidOf(i.layout.body);
      return `${Math.round(((Math.atan2(box.cy - cy, box.cx - cx) * 180) / Math.PI + 360) % 360)}°`;
    }
    if (id === 'base') return `${Math.round(box.w)} × ${Math.round(box.h)} mm`;
    return null;
  }

  function targetOf(id: string | null): DesignTarget | null {
    if (!id) return null;
    if (id === 'art' || id === 'base' || id === 'loop') return { kind: id };
    if (id.startsWith('word:')) return { kind: 'word', id: id.slice(5) };
    if (id.startsWith('switch:')) return { kind: 'switch', index: Number(id.slice(7)) };
    return null;
  }

  /** What there is to frame: the body, and the loop beyond it. */
  function boundsOf(i: DesignInput) {
    const { body, loop } = i.layout;
    return ringsBounds(loop ? [...body, [[loop.x - loop.outerR, loop.y - loop.outerR], [loop.x + loop.outerR, loop.y + loop.outerR], [loop.x, loop.y]]] : body);
  }
  /** Room round the clicker when it is framed: a fifth of the canvas each side, never under 90 px,
   *  so it sits in the view with the stage's own tools clear of it rather than filling it. */
  function framePad() {
    const r = canvas.root.getBoundingClientRect();
    return Math.max(90, Math.round(Math.min(r.width, r.height) * 0.2));
  }
  function refit() {
    if (!input || !shown) return;
    const b = boundsOf(input);
    if (!Number.isFinite(b.minX)) return;
    canvas.fit(b, framePad());
    fitted = true;
  }
  /** Whether these bounds sit inside what the canvas shows, short of its edge. */
  function inView(b: ReturnType<typeof ringsBounds>) {
    const r = canvas.root.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || !Number.isFinite(b.minX)) return true;
    const [x0, y0] = canvas.toModel(r.left, r.bottom);
    const [x1, y1] = canvas.toModel(r.right, r.top);
    const m = (12 * (x1 - x0)) / r.width;
    return b.minX >= x0 + m && b.maxX <= x1 - m && b.minY >= y0 + m && b.maxY <= y1 - m;
  }

  return {
    show(on) {
      shown = on;
      root.hidden = !on;
      // Framed the first time it is seen with something to show, and left where it is after.
      if (on && !fitted) refit();
    },
    isShown: () => shown,
    render(next) {
      // A clicker that grew past the edge (words giving an outline base a tab, say) is framed
      // again; one that only left it because someone zoomed in is left where they put it.
      const outgrown = shown && fitted && !!input && !!next && inView(boundsOf(input)) && !inView(boundsOf(next));
      input = next;
      if (!next) {
        canvas.setObjects([]);
        return;
      }
      draw(next);
      canvas.setObjects(objectsOf(next));
      if (shown && (!fitted || outgrown)) refit();
    },
    select: (id) => {
      canvas.select(id);
      picked = id;
      markPicked();
    },
    refit: () => {
      fitted = false;
      refit();
    },
    destroy() {
      canvas.destroy();
      root.remove();
    },
  };
}
