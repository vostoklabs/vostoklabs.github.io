/**
 * The 2-D shape editor.
 *
 * Replaces "Choose a shape"'s drawer. The old picker could only answer *which* of our shapes
 * you wanted; the sliders beside it answered *how many sides* in a place where the shape was
 * not. Ian's note was about exactly that gap — "i wanted to give a user a 2d editor where he
 * can choose and create a shape, and its not this", and "points slider … is just dumb". So the
 * knob moves onto the shape: the corner radius is a grip on a corner, the point count is a grip
 * you swing round the rim, the size is the bounding box's own corners.
 *
 * A THIRD pass (this one) replaces the second's point-editing "Draw" mode with something Ian
 * asked for directly: "For the draw, I think we need just a much simpler editor, where the user
 * can use primitive shapes, drag and drop to do it." Dragging individual points asked a user to
 * think in vertices; nobody thinks in vertices. Dragging shapes is how every other drawing tool
 * works, so "Build" replaces the point tools with a small composer: drop primitives, move them,
 * resize them, rotate them, mark some of them as cuts, and the base is their union minus the
 * cuts. The rules the second pass learned still apply:
 *
 *  1. **Nothing on screen depends on the viewport being tall.** The dialog, the canvas and the
 *     side panel are all sized from the space actually available (`ResizeObserver` + a CSS
 *     height budget, see the arithmetic in `style.css`'s `.cg-shed__grid` comment), not from a
 *     fixed pixel count that happened to fit one monitor.
 *  2. **Every grip has a second, visible way to reach it.** A slider beside the canvas mirrors
 *     each on-shape handle.
 *
 * Two modes over one canvas:
 *
 *  - **Adjust** — unchanged from the second pass. The shape is one of ours, described by
 *    `BaseShapeKind` plus its knobs, shown as on-shape grips AND side-panel sliders. Committing
 *    gives back those knobs, so the build runs its real WASM construction and every project ever
 *    saved keeps meaning what it meant. A pack silhouette can also be picked here without ever
 *    touching Build — it commits by its token, exactly as the old drawer did.
 *  - **Build** — a list of `ComposeItem`s (see `geometry/composeGeometry.ts`): primitives from
 *    the palette, or a frozen `outline` (whatever was in Adjust when Build was first entered, or
 *    a rail tile added while already here). Every "Add" item is unioned first; every "Cut" item
 *    then subtracts from that union — the list's own order never changes the geometry, only
 *    which item a click lands on. Committing always gives back rings (`kind: 'drawn'`), the same
 *    seam a seasonal pack already rides.
 *
 * Nothing here is arithmetic. Adjust's rules — where a handle sits, what dragging it means,
 * which material the build's minimum-feature pass would eat — live in `geometry/
 * editorGeometry.ts`. Build's rules — item transforms, hit-testing, and the rasterise-then-
 * contour pipeline that turns the item list into one outline — live in `geometry/
 * composeGeometry.ts`. Both are DOM-free so `tests/shape-editor.test.ts` and `tests/
 * compose-geometry.test.ts` can assert them; this file owns pixels, pointers and kit components,
 * and nothing else.
 */
import {
  button, buttonRow, dialog, helpTip, iconButton, ICONS, segmentedControl, sliderRow, themeColor,
  thumbGrid, thumbTile, toggleSwitch,
  type ButtonHandle, type DialogHandle, type SliderRowHandle, type ThumbTileHandle,
} from '@vostok/ui-kit';
import { MIN_FEATURE_MM } from '../geometry/buildClicker';
import {
  type ComposeDragStart, type ComposeItem, type ComposeShapeKind, composeBounds, composeItems,
  hitTestItem, ITEM_SIDES_RANGE, itemRing, MIN_ITEM_MM, moveItem, newPrimitiveItem, nextDropSpot,
  normaliseRings, nextItemId, outlineItem, type PlacedItemHandle, placeItemHandles, resizeItem,
  rotateItem,
} from '../geometry/composeGeometry';
import {
  bboxOf, columnFits, CORNER_RANGE, COUNT_RANGE, dragHandle, featureRange, fitRingToBox, HANDLES,
  handleLabel, normaliseRing, placeHandles, previewRingFor, previewRingMm, SIZE_RANGE, thinField,
  type DragStart, type HandleKind, type PlacedHandle, type ShapeParams, type ThinField,
} from '../geometry/editorGeometry';
import {
  archRing, capsuleRing, circleRing, crossRing, eggRing, heartRing, ngonRing, ringToPath,
  roundedRectRing, shieldRing, squircleRing, starRing, tagRing,
} from '../geometry/shapePaths';
import type { ShapeEntry } from '../shapes/directory';
import type { BaseShapeKind, Ring } from '../types';

/** What the editor hands back. Cancelling resolves null instead — same as `openSvgPreview`. */
export type ShapeEditorResult =
  | {
    kind: 'preset';
    baseShape: BaseShapeKind;
    shapeSides: number;
    shapeCornerPct: number;
    shapeArmPct: number;
    fixedSize: { w: number; h: number } | null;
  }
  | {
    kind: 'drawn';
    rings: Ring[];
    fixedSize: { w: number; h: number } | null;
    /** Set when the outline is a library shape the user never edited, so the app can go on
     *  storing it as a TOKEN — its name on the button, and a few bytes in the project file
     *  instead of a few hundred points. Cleared the moment a point moves, and always null for
     *  anything that came out of Build — a composed shape is never one untouched library file. */
    packShapeToken?: string | null;
  };

export interface ShapeEditorOptions {
  /** The curated set, packs included. Becomes the starting points down the left. */
  shapes: ShapeEntry[];
  /** What the app has right now, so opening the editor never changes the model. */
  current: {
    baseShape: BaseShapeKind;
    packShapeToken: string | null;
    shapeSides: number;
    shapeCornerPct: number;
    shapeArmPct: number;
    fixedSize: { w: number; h: number } | null;
    /** The rings behind a `custom` base — a pack silhouette, or one built here before. */
    rings: Ring[] | null;
  };
  /** The base's longest side, mm. Everything on the canvas is measured against it. */
  spanMm: number;
  /** The clear column an MX switch needs, mm — `switchClear` in the build. */
  switchColumnMm: number;
  /** Switch placements, mm from the design's centre. */
  switches: { x: number; y: number }[];
}

/** Snap grid, mm. Fine enough not to fight a placement, coarse enough to line shapes up. Shared
 *  by Adjust's arrow-key nudge and Build's position/size snapping. */
const GRID_MM = 1;
/** Grab radius for a handle, in screen pixels — never in millimetres, or a handle becomes
 *  impossible to hit on a small shape and enormous on a large one. */
const GRAB_PX = 13;
/** How far a click has to land from an item to grab one of its own handles instead of just
 *  moving it, expressed the same way. */
const COMPOSE_RASTER_N = 1024;
/** Contour simplify tolerance, mm — small enough that the traced outline still looks like the
 *  shapes that made it, big enough to drop the staircase a 1024 px raster leaves behind. */
const COMPOSE_TOL_MM = 0.15;
/** A freshly dropped primitive's size, as a fraction of the base's span. */
const NEW_ITEM_FRACTION = 0.45;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** Combined bounding box across several rings — Build's outline is usually more than one
 *  (an outer plus its holes), and the status line wants one box for all of them. */
function bboxOfAll(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    const [a, b, c, d] = bboxOf(r);
    if (a < minX) minX = a;
    if (b < minY) minY = b;
    if (c > maxX) maxX = c;
    if (d > maxY) maxY = d;
  }
  if (!isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

export function openShapeEditor(opts: ShapeEditorOptions): Promise<ShapeEditorResult | null> {
  return new Promise((resolve) => {
    let settled = false;

    /* ---------------------------------------------------------------- state */

    type Source = 'preset' | 'drawn';
    let source: Source = opts.current.baseShape === 'custom' ? 'drawn' : 'preset';
    let params: ShapeParams = {
      kind: opts.current.baseShape === 'outline' ? 'circle' : opts.current.baseShape,
      shapeSides: opts.current.shapeSides,
      shapeCornerPct: opts.current.shapeCornerPct,
      shapeArmPct: opts.current.shapeArmPct,
      sizeMm: opts.current.fixedSize,
    };
    /** The outline Adjust mode is showing, in editor millimetres. For a preset it is regenerated
     *  from `params`; for a drawn/pack shape it IS the shape. Also what Build seeds its first
     *  `outline` item from the first time the user switches tabs. */
    let ring: Ring = [];
    let mode: 'adjust' | 'build' = 'adjust';
    let snap = true;
    /** Which starting shape is lit in the rail. Null once the Adjust outline stops being any of
     *  them — meaningless in Build, where the rail adds items instead of replacing the shape. */
    let pickedId: string | null =
      opts.current.baseShape === 'custom' ? opts.current.packShapeToken : opts.current.baseShape;
    /** The library token behind Adjust's current outline, while it is still untouched. Without
     *  this every seasonal shape picked here came back as an anonymous list of points. */
    let packToken: string | null =
      opts.current.baseShape === 'custom' ? opts.current.packShapeToken : null;
    /** Which handle a hovered (or focused) Adjust slider corresponds to, so its on-canvas grip
     *  can be highlighted. */
    let hoverHandleKind: HandleKind | null = null;

    /** Build's item list. Starts empty — seeded from `ring` the first time the user switches to
     *  Build (see `modeTabs`), never before. Not persisted past this dialog: a Build shape that
     *  is re-opened comes back as one `outline` item wrapping whatever rings it committed, not
     *  the recipe that made them. Storing the recipe is a real feature and a fair follow-up; it
     *  is not this one. */
    let items: ComposeItem[] = [];
    let selectedItemId: string | null = null;
    /** The item list's rasterised-and-traced union, recomputed lazily — see `composeDirty`. */
    let composeRings: Ring[] = [];
    let composeIslands = 0;
    let composeDirty = true;

    const spanMm = Math.max(10, opts.spanMm);

    const rebuildPreset = (): void => { ring = previewRingMm(params, spanMm); };
    if (source === 'drawn' && opts.current.rings?.length) {
      ring = normaliseRing(opts.current.rings[0]).map(
        ([x, y]) => [x * spanMm, y * spanMm] as [number, number],
      );
    } else {
      // A 'custom' base with no rings behind it is a pack file that failed to load; the build
      // draws a circle for it, so the editor opens on one rather than on a shape that has no
      // generator and no points either.
      source = 'preset';
      if (params.kind === 'custom') params.kind = 'circle';
      rebuildPreset();
    }

    /* ---- undo, local to this dialog and discarded with it. The outer app's Ctrl+Z is a
       whole-state history; using it for "put that item back" would revert colours too. */
    interface Snapshot {
      source: Source; params: ShapeParams; ring: Ring;
      pickedId: string | null; packToken: string | null;
      items: ComposeItem[]; selectedItemId: string | null;
    }
    const cloneItems = (list: ComposeItem[]): ComposeItem[] => list.map((it) => ({
      ...it,
      ring: it.ring ? it.ring.map(([x, y]) => [x, y] as [number, number]) : undefined,
    }));
    const undoStack: Snapshot[] = [];
    const redoStack: Snapshot[] = [];
    const snapshot = (): Snapshot => ({
      source, params: { ...params }, ring: ring.map(([x, y]) => [x, y] as [number, number]),
      pickedId, packToken, items: cloneItems(items), selectedItemId,
    });
    const restore = (s: Snapshot): void => {
      source = s.source;
      params = { ...s.params };
      ring = s.ring.map(([x, y]) => [x, y] as [number, number]);
      // Undo used to leave these two behind, so the rail's highlight kept naming the shape you
      // had just come FROM rather than the one back on screen.
      pickedId = s.pickedId;
      packToken = s.packToken;
      items = cloneItems(s.items);
      selectedItemId = s.selectedItemId;
      composeDirty = true;
    };
    const commitStep = (): void => {
      undoStack.push(snapshot());
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      syncButtons();
    };
    /** The dialog's opening state — what "Reset" puts back, and the one thing undo can never
     *  run past. Captured once, here, before any control has had a chance to touch anything. */
    const startSnapshot: Snapshot = snapshot();

    /* ---------------------------------------------------------------- the canvas */

    const body = el('div', 'cg-shed');
    const grid = el('div', 'cg-shed__grid');
    const railWrap = el('div', 'cg-shed__rail');
    const stage = el('div', 'cg-shed__stage');
    const side = el('div', 'cg-shed__side');
    const canvas = document.createElement('canvas');
    canvas.className = 'cg-shed__canvas';
    canvas.tabIndex = 0;
    /* A canvas is a blank rectangle to a screen reader — it has no children, no role and no
       name — so without this it announces as nothing at all and the keyboard user has no idea
       what they have tabbed into. `application` is right here and almost nowhere else: this
       element genuinely handles its own arrow keys, and telling the reader so is what stops it
       intercepting them. The hint line beside it is the running description, so it is both
       pointed at from here and made live. */
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Shape canvas');
    canvas.setAttribute('aria-describedby', 'cgShedHint');
    stage.append(canvas);
    const ctx = canvas.getContext('2d');

    /** Build mode's "what is this piece" label — a DOM element rather than canvas text, so it
     *  reads in the app's own font and colour tokens instead of a hand-picked canvas font
     *  string. Repositioned every frame the selection or its box moves; hidden the rest of the
     *  time rather than removed, so there is nothing to re-create on every draw. */
    const itemLabelEl = el('div', 'cg-shed__item-label');
    itemLabelEl.hidden = true;
    stage.append(itemLabelEl);

    /** The view transform. Recomputed on resize and when the outline is REPLACED — never
     *  during a drag. Refitting mid-drag makes the shape fight the drag (see the size-grip
     *  comment in `pointermove`), so this is frozen deliberately. */
    let zoom = 1;
    let originX = 0;
    let originY = 0;
    let viewDirty = true;

    const toScreenX = (x: number) => originX + x * zoom;
    const toScreenY = (y: number) => originY - y * zoom;
    const toWorldX = (sx: number) => (sx - originX) / zoom;
    const toWorldY = (sy: number) => (originY - sy) / zoom;

    function fitView(): void {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      let box: number;
      if (mode === 'adjust') {
        // Fit the base's own box rather than the current outline, so switching between a wide
        // shape and a tall one does not rescale the world.
        box = params.sizeMm ? Math.max(params.sizeMm.w, params.sizeMm.h) : spanMm;
      } else {
        // Build's items can sit anywhere; the view still centres on the world origin (where the
        // switch lives), so the box just has to be twice the furthest extent in any direction
        // to guarantee everything stays on screen.
        const b = composeBounds(items, spanMm);
        box = Math.max(
          Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY), spanMm / 2,
        ) * 2;
      }
      const pad = 40;
      zoom = Math.min((w - pad * 2) / box, (h - pad * 2) / box);
      originX = w / 2;
      originY = h / 2;
      viewDirty = false;
    }

    /* ---- theme colours, read live. Never a hex literal: five files once had `--bg` written
       out by hand and matched the chrome only by coincidence. `themeColor` and not
       `themeColorHex` — a canvas wants the CSS string, and assigning it a number is silently
       ignored rather than an error. */
    const colours = () => ({
      fill: themeColor('--panel-2', '#20232b'),
      line: themeColor('--line', '#31353f'),
      text: themeColor('--text', '#e6e8ee'),
      muted: themeColor('--muted', '#9aa3b2'),
      accent: themeColor('--accent', '#5b9dff'),
      warn: themeColor('--warn', '#f5a524'),
      red: themeColor('--red', '#ef4444'),
      bg: themeColor('--panel', '#181b21'),
    });

    /** The thin-region raster. Recomputed at most once per frame, and reused between frames
     *  when nothing has moved. */
    let field: ThinField | null = null;
    let fieldStale = true;
    let rafId = 0;

    function invalidate(alsoField = true): void {
      // A discrete change invalidates BOTH the print-minimum raster and (in Build) the
      // rasterise-then-contour pipeline — the second one feeds the first, so recomputing one
      // without the other would show a warning for a shape that is no longer on screen.
      if (alsoField) { fieldStale = true; composeDirty = true; }
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; draw(); });
    }

    /** After any discrete, non-continuous edit — picking a shape, undo/redo/reset, a button, a
     *  committed slider value — everything the side panel shows has to catch up. Bundled here so
     *  no call site can update the state and forget one of them. NOT used inside a pointermove
     *  drag — see the drag handlers below, which call `invalidate()` directly for exactly the
     *  reason `commitStep` is not called there either: once per gesture, not once per frame. */
    function afterEdit(alsoField = true): void {
      paintRail();
      syncButtons();
      syncSideSliders();
      syncModePanels();
      syncItemPanel();
      syncPiecesList();
      invalidate(alsoField);
    }

    function currentRings(): Ring[] {
      return mode === 'build' ? composeRings : [ring];
    }

    function draw(): void {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        viewDirty = true;
      }
      if (viewDirty) fitView();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = colours();
      ctx.clearRect(0, 0, w, h);

      if (mode === 'build' && composeDirty) {
        const result = composeItems(items, spanMm, { n: COMPOSE_RASTER_N, tolMm: COMPOSE_TOL_MM });
        composeRings = result.rings;
        composeIslands = result.islands;
        composeDirty = false;
        fieldStale = true;
      }
      if (fieldStale) {
        const rings = currentRings();
        const totalPts = rings.reduce((n, r) => n + r.length, 0);
        field = thinField(rings, MIN_FEATURE_MM, totalPts > 200 ? 96 : 144);
        fieldStale = false;
      }

      drawGrid(ctx, w, h, c);
      drawShape(ctx, c);
      if (field) drawThin(ctx, field, c);
      drawSwitch(ctx, c);
      if (mode === 'adjust') { drawHandles(ctx, c); itemLabelEl.hidden = true; }
      else drawComposeItems(ctx, c);
      updateStatus();
    }

    function drawGrid(g: CanvasRenderingContext2D, w: number, h: number, c: ReturnType<typeof colours>): void {
      // A light grid, drawn at whatever multiple of the snap step stays legible — at 40 mm
      // across, 1 mm lines would be a grey wash rather than a reference.
      let step = GRID_MM;
      while (step * zoom < 9) step *= 5;
      g.save();
      g.strokeStyle = c.line;
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      g.beginPath();
      const x0 = Math.ceil(toWorldX(0) / step) * step;
      for (let x = x0; toScreenX(x) <= w; x += step) {
        g.moveTo(Math.round(toScreenX(x)) + 0.5, 0);
        g.lineTo(Math.round(toScreenX(x)) + 0.5, h);
      }
      const y0 = Math.ceil(toWorldY(h) / step) * step;
      for (let y = y0; toScreenY(y) >= 0; y += step) {
        g.moveTo(0, Math.round(toScreenY(y)) + 0.5);
        g.lineTo(w, Math.round(toScreenY(y)) + 0.5);
      }
      g.stroke();
      g.restore();
    }

    function tracePath(g: CanvasRenderingContext2D, r: Ring): void {
      if (!r.length) return;
      g.moveTo(toScreenX(r[0][0]), toScreenY(r[0][1]));
      for (let i = 1; i < r.length; i++) g.lineTo(toScreenX(r[i][0]), toScreenY(r[i][1]));
      g.closePath();
    }

    /** The base's own outline. In Build this is EVERY ring the compose pipeline produced (an
     *  outer plus any holes) traced into one path and filled once — the canvas's default
     *  nonzero winding rule punches the holes out on its own, the same rule `CrossSection(...,
     *  'NonZero')` uses in the real build, so what is drawn here is what will print. */
    function drawShape(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>): void {
      const rings = currentRings();
      if (!rings.length) return;
      g.save();
      g.beginPath();
      for (const r of rings) tracePath(g, r);
      // In Build, individual pieces are drawn on top of this in accent/red — a `--panel-2` fill
      // here read as just another piece at a glance. A low-opacity `--text` wash instead reads
      // as "the material", the one thing on screen that is not one of the accent/red overlays.
      // Adjust has no pieces to confuse it with, so it keeps the original solid fill.
      if (mode === 'build') {
        g.fillStyle = c.text;
        g.globalAlpha = 0.14;
        g.fill();
        g.globalAlpha = 1;
      } else {
        g.fillStyle = c.fill;
        g.fill();
      }
      g.strokeStyle = c.text;
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }

    /** Reused between frames. Allocating a canvas per pointermove is how a drag turns into a
     *  garbage-collection stutter on a slower machine. */
    const wash = document.createElement('canvas');

    /** A token's colour as three channels, for writing pixels directly. Handles the two forms
     *  the tokens actually take; anything else falls back to a plain red rather than to
     *  transparent black, which would make the warning invisible. */
    function rgbOf(css: string): [number, number, number] {
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim())?.[1];
      if (hex) {
        const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
        return [
          parseInt(full.slice(0, 2), 16),
          parseInt(full.slice(2, 4), 16),
          parseInt(full.slice(4, 6), 16),
        ];
      }
      const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(css.trim());
      if (m) return [Number(m[1]) | 0, Number(m[2]) | 0, Number(m[3]) | 0];
      return [239, 68, 68];
    }

    /** The material the build's minimum-feature pass would delete, as a soft wash. Drawn from
     *  the raster at its own resolution and scaled up, so a 144x144 grid costs one blit. */
    function drawThin(g: CanvasRenderingContext2D, f: ThinField, c: ReturnType<typeof colours>): void {
      let any = false;
      for (let k = 0; k < f.thin.length; k++) if (f.thin[k]) { any = true; break; }
      if (!any) return;
      const img = wash;
      if (img.width !== f.n) { img.width = f.n; img.height = f.n; }
      const ig = img.getContext('2d');
      if (!ig) return;
      const [rr, gg, bb] = rgbOf(c.red);
      const data = ig.createImageData(f.n, f.n);
      const px = data.data;
      for (let row = 0; row < f.n; row++) {
        const dst = (f.n - 1 - row) * f.n;
        for (let col = 0; col < f.n; col++) {
          if (!f.thin[row * f.n + col]) continue;
          const o = (dst + col) * 4;
          px[o] = rr;
          px[o + 1] = gg;
          px[o + 2] = bb;
          px[o + 3] = 255;
        }
      }
      ig.putImageData(data, 0, 0);
      g.save();
      g.globalAlpha = 0.55;
      g.imageSmoothingEnabled = true;
      const x = toScreenX(f.x0);
      const y = toScreenY(f.y0 + f.n * f.cell);
      g.drawImage(img, x, y, f.n * f.cell * zoom, f.n * f.cell * zoom);
      g.restore();
    }

    /** How many of the switch columns have nowhere to sit. Recomputed with the field. */
    let switchesShort = 0;

    /** Where each switch needs a clear column, and whether it has one. */
    function drawSwitch(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>): void {
      const spot = field?.switchSpot ?? [0, 0];
      const half = opts.switchColumnMm / 2;
      switchesShort = 0;
      g.save();
      for (const sw of opts.switches.length ? opts.switches : [{ x: 0, y: 0 }]) {
        const cx = spot[0] + sw.x;
        const cy = spot[1] + sw.y;
        const fits = field ? columnFits(field, cx, cy, opts.switchColumnMm) : true;
        if (!fits) switchesShort++;
        g.strokeStyle = fits ? c.accent : c.red;
        g.fillStyle = fits ? c.accent : c.red;
        g.globalAlpha = 0.12;
        g.fillRect(toScreenX(cx - half), toScreenY(cy + half), half * 2 * zoom, half * 2 * zoom);
        g.globalAlpha = 0.75;
        g.setLineDash([4, 3]);
        g.lineWidth = 1;
        g.strokeRect(toScreenX(cx - half), toScreenY(cy + half), half * 2 * zoom, half * 2 * zoom);
      }
      g.restore();
    }

    let placed: PlacedHandle[] = [];
    /** Which handle the keyboard has selected. Meaningless to the mouse, which grabs by
     *  position — see the `[` / `]` branch of the key handler. Adjust mode only. */
    let handleIndex = 0;

    function drawHandles(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>): void {
      placed = placeHandles(params, ring);
      g.save();
      if (handleIndex >= placed.length) handleIndex = 0;
      placed.forEach((hnd, i) => {
        const x = toScreenX(hnd.x);
        const y = toScreenY(hnd.y);
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fillStyle = c.accent;
        g.fill();
        g.strokeStyle = c.bg;
        g.lineWidth = 2;
        g.stroke();
        const isKeyboardSel = i === handleIndex && document.activeElement === canvas;
        const isHovered = hnd.kind === hoverHandleKind;
        if (isKeyboardSel || isHovered) {
          g.beginPath();
          g.arc(x, y, 10, 0, Math.PI * 2);
          g.strokeStyle = c.accent;
          g.lineWidth = 1.5;
          g.stroke();
        }
      });
      g.restore();
    }

    /** An item's four corners in world mm, rotated. Used only for drawing the box outline —
     *  `composeGeometry.ts` has its own copy for hit-testing, kept separate on purpose: this one
     *  never needs to be pure/testable, and sharing it would mean a UI change to the box's
     *  drawing order could quietly change what gets clicked. */
    function itemBoxCorners(item: ComposeItem): [number, number][] {
      const hw = item.w / 2;
      const hh = item.h / 2;
      const rad = (item.rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const local: [number, number][] = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
      return local.map(([x, y]) => [item.x + x * cos - y * sin, item.y + x * sin + y * cos]);
    }

    /** Every piece's own shape (not just its bounding box) so a circle reads as a circle rather
     *  than the rotated rectangle its box would draw. Add and cut read as fundamentally
     *  different materials — accent vs red — and that colour never depends on selection, because
     *  a cut piece has to announce "this removes material" whether or not it is the one you are
     *  currently editing (Requirement 3). Selection only changes how LOUD the piece is: a thin
     *  muted line when it is just one of several shapes on the canvas, a solid, heavier one plus
     *  handles and a label when it is the one being edited. */
    function drawComposeItems(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>): void {
      g.save();
      for (const item of items) {
        const ring = itemRing(item);
        if (ring.length < 3) continue;
        const isSel = item.id === selectedItemId;
        const isCut = item.op === 'cut';
        g.beginPath();
        tracePath(g, ring);
        g.fillStyle = isCut ? c.red : c.accent;
        g.globalAlpha = isCut ? (isSel ? 0.30 : 0.16) : (isSel ? 0.16 : 0.05);
        g.fill();
        g.strokeStyle = isCut ? c.red : (isSel ? c.accent : c.muted);
        g.globalAlpha = isSel ? 0.95 : 0.6;
        g.lineWidth = isSel ? 2 : 1;
        g.stroke();
      }
      g.restore();

      const sel = items.find((it) => it.id === selectedItemId) ?? null;
      if (sel) {
        drawSelectionBox(g, c, sel);
        drawItemHandles(g, c, sel);
      }
      updateItemLabel(sel);
    }

    /** A faint, dashed reference box for the SELECTED item only — the eight resize handles sit
     *  at its corners and edges, which would otherwise float in space next to a round or
     *  star-shaped outline with no visible box of its own. */
    function drawSelectionBox(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>, item: ComposeItem): void {
      const corners = itemBoxCorners(item);
      g.save();
      g.beginPath();
      corners.forEach(([x, y], i) => {
        const sx = toScreenX(x);
        const sy = toScreenY(y);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      });
      g.closePath();
      g.setLineDash([4, 3]);
      g.strokeStyle = c.muted;
      g.globalAlpha = 0.6;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }

    /** Positions the DOM label above the selected item's box, or hides it — the answer to
     *  "which of these overlapping circles did I select" that Requirement 3 asks for, right on
     *  the shape rather than only in the side panel's list. */
    function updateItemLabel(item: ComposeItem | null): void {
      if (mode !== 'build' || !item) {
        itemLabelEl.hidden = true;
        return;
      }
      const corners = itemBoxCorners(item);
      const topY = Math.max(...corners.map(([, y]) => y));
      itemLabelEl.textContent = pieceFullLabel(item);
      itemLabelEl.classList.toggle('cg-shed__item-label--cut', item.op === 'cut');
      itemLabelEl.style.left = `${toScreenX(item.x)}px`;
      itemLabelEl.style.top = `${toScreenY(topY) - 8}px`;
      itemLabelEl.hidden = false;
    }

    function drawItemHandles(g: CanvasRenderingContext2D, c: ReturnType<typeof colours>, item: ComposeItem): void {
      const placedHandles = placeItemHandles(item);
      const n = placedHandles.find((h) => h.slot === 'n');
      const rotateHandle = placedHandles.find((h) => h.slot === 'rotate');
      g.save();
      if (n && rotateHandle) {
        g.strokeStyle = c.muted;
        g.globalAlpha = 0.8;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(toScreenX(n.x), toScreenY(n.y));
        g.lineTo(toScreenX(rotateHandle.x), toScreenY(rotateHandle.y));
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const h of placedHandles) {
        const x = toScreenX(h.x);
        const y = toScreenY(h.y);
        if (h.slot === 'rotate') {
          g.beginPath();
          g.arc(x, y, 6, 0, Math.PI * 2);
          g.fillStyle = c.accent;
          g.fill();
          g.strokeStyle = c.bg;
          g.lineWidth = 2;
          g.stroke();
        } else {
          g.fillStyle = c.accent;
          g.fillRect(x - 4, y - 4, 8, 8);
          g.strokeStyle = c.bg;
          g.lineWidth = 1.5;
          g.strokeRect(x - 4, y - 4, 8, 8);
        }
      }
      g.restore();
    }

    /* ---------------------------------------------------------------- pointer */

    let drag: DragStart | null = null;
    /** The outline as it was when the current Adjust handle drag began. Null except during a
     *  drag. */
    let dragRing: Ring | null = null;
    /** Which pointer owns the gesture. `touch-action: none` on the canvas means two fingers
     *  reach these handlers, and without an owner the second one takes over the first one's
     *  drag state mid-motion. */
    let dragPointerId = -1;

    interface ItemDragState {
      kind: 'move' | 'resize' | 'rotate';
      id: string;
      /** The item as it was at pointerdown — every delta is measured from this, never from the
       *  item's own live value, so a drag cannot compound its own output. */
      start: ComposeItem;
      startWorld: [number, number];
      /** move only: where inside the item the drag actually grabbed. */
      grabOffset?: [number, number];
      /** resize/rotate only: which handle. */
      handleSlot?: PlacedItemHandle['slot'];
    }
    let itemDrag: ItemDragState | null = null;

    const localPos = (e: PointerEvent | MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    function handleUnder(sx: number, sy: number): PlacedHandle | null {
      // Nearest within the grab radius, never the first match — corner, count and size grips
      // sit close together on a small shape.
      let best: PlacedHandle | null = null;
      let bestD = GRAB_PX;
      for (const hnd of placed) {
        const d = Math.hypot(sx - toScreenX(hnd.x), sy - toScreenY(hnd.y));
        if (d < bestD) { bestD = d; best = hnd; }
      }
      return best;
    }

    /** The resize cursor for a handle slot — the same eight-way mapping every drawing tool
     *  uses, so a corner reads as a diagonal drag and an edge as a straight one. Rotation is
     *  never dragged with the mouse pointer captured the same way, so it gets `grab` instead. */
    const HANDLE_CURSOR: Record<PlacedItemHandle['slot'], string> = {
      nw: 'nwse-resize', se: 'nwse-resize',
      ne: 'nesw-resize', sw: 'nesw-resize',
      n: 'ns-resize', s: 'ns-resize',
      e: 'ew-resize', w: 'ew-resize',
      rotate: 'grab',
    };
    const cursorForHandle = (slot: PlacedItemHandle['slot']): string => HANDLE_CURSOR[slot];

    /** The selected item's own resize/rotate handles, nearest-within-radius, same rule as
     *  Adjust's `handleUnder` above. Only the SELECTED item has handles to grab — an unselected
     *  item under the cursor is a body to click, not a box to resize. */
    function itemHandleUnder(sx: number, sy: number): PlacedItemHandle | null {
      const item = items.find((it) => it.id === selectedItemId);
      if (!item) return null;
      let best: PlacedItemHandle | null = null;
      let bestD = GRAB_PX;
      for (const h of placeItemHandles(item)) {
        const d = Math.hypot(sx - toScreenX(h.x), sy - toScreenY(h.y));
        if (d < bestD) { bestD = d; best = h; }
      }
      return best;
    }

    canvas.addEventListener('pointerdown', (e) => {
      // A drag is already in progress under another pointer: leave it alone.
      if (dragPointerId >= 0 && e.pointerId !== dragPointerId) return;
      canvas.focus();
      const [sx, sy] = localPos(e);

      if (mode === 'adjust') {
        const hnd = handleUnder(sx, sy);
        if (!hnd) return;
        const [, , maxX, maxY] = bboxOf(ring);
        commitStep();
        dragRing = ring.map(([x, y]) => [x, y] as [number, number]);
        drag = {
          handle: hnd,
          world: [toWorldX(sx), toWorldY(sy)],
          params: { ...params },
          half: [maxX, maxY],
        };
        // Ownership is claimed HERE and not on every pointerdown, because it is released by
        // the matching pointerup or pointercancel.
        dragPointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Build mode: a handle on the already-selected item wins over re-selecting or moving
      // anything else — otherwise a resize started slightly off the exact corner would just
      // move the item instead.
      const worldX = toWorldX(sx);
      const worldY = toWorldY(sy);
      const hnd = itemHandleUnder(sx, sy);
      const selectedItem = items.find((it) => it.id === selectedItemId) ?? null;
      if (hnd && selectedItem) {
        commitStep();
        itemDrag = {
          kind: hnd.slot === 'rotate' ? 'rotate' : 'resize',
          id: selectedItem.id,
          start: { ...selectedItem },
          startWorld: [worldX, worldY],
          handleSlot: hnd.slot,
        };
        dragPointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const hitId = hitTestItem(items, worldX, worldY);
      selectedItemId = hitId;
      if (hitId) {
        const item = items.find((it) => it.id === hitId)!;
        commitStep();
        itemDrag = {
          kind: 'move',
          id: hitId,
          start: { ...item },
          startWorld: [worldX, worldY],
          grabOffset: [worldX - item.x, worldY - item.y],
        };
        dragPointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
      }
      afterEdit(false);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (dragPointerId >= 0 && e.pointerId !== dragPointerId) return;
      const [sx, sy] = localPos(e);

      if (mode === 'adjust') {
        if (!drag) {
          canvas.style.cursor = handleUnder(sx, sy) ? 'grab' : 'crosshair';
          return;
        }
        /* The view does NOT refit mid-drag, and this line is why the size grips were unusable.

           `fitView` fits the SIZE VALUE, so refitting after each frame changed the scale that
           the next frame's `toWorldX` reads — same screen position, larger world coordinate,
           larger size, refit again. Refitting on release instead keeps the shape in view
           without the loop — see `clearDrag`. */
        params = dragHandle(drag, [toWorldX(sx), toWorldY(sy)]);
        if (source === 'preset') rebuildPreset();
        else if (dragRing && params.sizeMm) {
          ring = fitRingToBox(dragRing, params.sizeMm.w, params.sizeMm.h);
        }
        syncSideSliders();
        invalidate();
        return;
      }

      // Build mode.
      if (!itemDrag) {
        const hnd = itemHandleUnder(sx, sy);
        const hoverId = hitTestItem(items, toWorldX(sx), toWorldY(sy));
        canvas.style.cursor = hnd ? cursorForHandle(hnd.slot) : (hoverId ? 'move' : 'default');
        return;
      }
      const world: [number, number] = [toWorldX(sx), toWorldY(sy)];
      const gridMm = snap ? GRID_MM : 0;
      const idx = items.findIndex((it) => it.id === itemDrag!.id);
      if (idx < 0) return;
      if (itemDrag.kind === 'move') {
        const { x, y } = moveItem(world, itemDrag.grabOffset!, gridMm);
        items = items.map((it, i) => (i === idx ? { ...it, x, y } : it));
      } else if (itemDrag.kind === 'resize') {
        const dragStart: ComposeDragStart = {
          item: itemDrag.start, handle: itemDrag.handleSlot!, startWorld: itemDrag.startWorld,
        };
        // Corners keep the aspect ratio by default; Alt frees it. Edges only ever move one
        // axis, so Alt has nothing to invert there — `handleSlot.length === 2` is true for the
        // four corner slots ('nw', 'ne', 'se', 'sw') and false for the four edge ones.
        const keepAspect = itemDrag.handleSlot!.length === 2 && !e.altKey;
        const next = resizeItem(dragStart, world, keepAspect, gridMm);
        items = items.map((it, i) => (i === idx ? { ...it, ...next } : it));
      } else {
        const dragStart: ComposeDragStart = {
          item: itemDrag.start, handle: 'rotate', startWorld: itemDrag.startWorld,
        };
        const rot = rotateItem(dragStart, world);
        items = items.map((it, i) => (i === idx ? { ...it, rot } : it));
      }
      syncItemPanel();
      invalidate();
    });

    /** Drop the gesture without acting on it. Shared by a real release and an abort. */
    const clearDrag = (e: PointerEvent): boolean => {
      if (dragPointerId >= 0 && e.pointerId !== dragPointerId) return false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // The size the drag settled on is the box the view should now fit — refitted HERE, once,
      // rather than per frame, which is the runaway documented in `pointermove`.
      if (drag?.handle.kind === 'size') viewDirty = true;
      if (itemDrag?.kind === 'resize') viewDirty = true;
      const wasDragging = !!drag || !!itemDrag;
      drag = null;
      dragRing = null;
      itemDrag = null;
      dragPointerId = -1;
      return wasDragging;
    };

    canvas.addEventListener('pointerup', (e) => {
      if (dragPointerId >= 0 && e.pointerId !== dragPointerId) return;
      const wasDragging = clearDrag(e);
      if (wasDragging) { syncSideSliders(); syncItemPanel(); invalidate(); }
    });

    // An ABORTED gesture, not a finished one — the stylus left the digitizer, or the OS took
    // the touch for an edge swipe. Nothing about that is a click, so nothing changes further.
    canvas.addEventListener('pointercancel', (e) => {
      const wasDragging = clearDrag(e);
      if (wasDragging) invalidate();
    });

    canvas.addEventListener('keydown', (e) => {
      // Escape's first job here is to clear a Build selection — the same "step back one level"
      // meaning it has everywhere else. Only when there is nothing left to deselect does it fall
      // through unconsumed, so `dialog()`'s own document-level Escape can still close the modal;
      // stopping it unconditionally would have trapped a keyboard user with no way out at all.
      if (e.key === 'Escape') {
        if (mode === 'build' && selectedItemId) {
          e.preventDefault();
          e.stopPropagation();
          selectedItemId = null;
          afterEdit(false);
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'build' && selectedItemId) {
        e.preventDefault();
        e.stopPropagation();
        removeSelectedItem();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && mode === 'build' && selectedItemId) {
        e.preventDefault();
        e.stopPropagation();
        duplicateSelectedItem();
        return;
      }
      if (e.key.startsWith('Arrow') && mode === 'build' && selectedItemId) {
        e.preventDefault();
        e.stopPropagation();
        nudgeSelectedItem(e.shiftKey ? GRID_MM * 5 : GRID_MM, e.key);
        return;
      }
      /* Walking the Adjust handles. NOT on Tab — Tab is how a keyboard user LEAVES a control,
         and preventing it here would trap focus on the canvas. */
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const step = e.key === ']' ? 1 : -1;
        if (mode === 'adjust' && placed.length) {
          handleIndex = (handleIndex + step + placed.length) % placed.length;
          setStatus(`${placed[handleIndex].label} selected. Use the arrow keys to change it.`);
        }
        invalidate(false);
        return;
      }
      // Arrow keys in Adjust mode drive the selected handle, by simulating a small drag away
      // from where it sits — so the keyboard and the mouse go through exactly one code path.
      if (e.key.startsWith('Arrow') && mode === 'adjust' && placed[handleIndex]) {
        e.preventDefault();
        e.stopPropagation();
        const hnd = placed[handleIndex];
        const [, , maxX, maxY] = bboxOf(ring);
        const nudge = e.shiftKey ? 5 : 1;
        const dx = (e.key === 'ArrowRight' ? nudge : 0) - (e.key === 'ArrowLeft' ? nudge : 0);
        const dy = (e.key === 'ArrowUp' ? nudge : 0) - (e.key === 'ArrowDown' ? nudge : 0);
        commitStep();
        params = dragHandle(
          { handle: hnd, world: [hnd.x, hnd.y], params: { ...params }, half: [maxX, maxY] },
          [hnd.x + dx, hnd.y + dy],
        );
        if (hnd.kind === 'size') viewDirty = true;
        if (source === 'preset') rebuildPreset();
        else if (params.sizeMm) ring = fitRingToBox(ring, params.sizeMm.w, params.sizeMm.h);
        syncSideSliders();
        invalidate();
        return;
      }
      // The editor's own undo. Stopped here so the app's window-level Ctrl+Z — which reverts
      // colours, sizes and edges — does not fire while somebody is editing a shape.
      const undoKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      const redoKey = (e.ctrlKey || e.metaKey)
        && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey));
      if (redoKey) { e.preventDefault(); e.stopPropagation(); doRedo(); return; }
      if (undoKey) { e.preventDefault(); e.stopPropagation(); doUndo(); }
    });

    function nudgeSelectedItem(step: number, key: string): void {
      const idx = items.findIndex((it) => it.id === selectedItemId);
      if (idx < 0) return;
      commitStep();
      const dx = (key === 'ArrowRight' ? step : 0) - (key === 'ArrowLeft' ? step : 0);
      const dy = (key === 'ArrowUp' ? step : 0) - (key === 'ArrowDown' ? step : 0);
      items = items.map((it, i) => (i === idx ? { ...it, x: it.x + dx, y: it.y + dy } : it));
      afterEdit();
    }

    function removeSelectedItem(): void {
      if (!selectedItemId) return;
      const idx = items.findIndex((it) => it.id === selectedItemId);
      if (idx < 0) return;
      commitStep();
      items = items.filter((it) => it.id !== selectedItemId);
      selectedItemId = null;
      afterEdit();
    }

    /** Shared by the Duplicate button and Ctrl/Cmd+D — one body, so the keyboard shortcut can
     *  never quietly drift from what the button does. */
    function duplicateSelectedItem(): void {
      const idx = items.findIndex((it) => it.id === selectedItemId);
      if (idx < 0) return;
      commitStep();
      const copy: ComposeItem = { ...items[idx], id: nextItemId(), x: items[idx].x + 4, y: items[idx].y - 4 };
      items = [...items, copy];
      selectedItemId = copy.id;
      afterEdit();
    }

    function doUndo(): void {
      const s = undoStack.pop();
      if (!s) return;
      redoStack.push(snapshot());
      restore(s);
      viewDirty = true;
      afterEdit();
    }
    function doRedo(): void {
      const s = redoStack.pop();
      if (!s) return;
      undoStack.push(snapshot());
      restore(s);
      viewDirty = true;
      afterEdit();
    }

    /* ---------------------------------------------------------------- the rail */

    const tiles = new Map<string, ThumbTileHandle>();
    function paintRail(): void {
      for (const [id, tile] of tiles) tile.setSelected(id === pickedId);
    }

    /** One heading + tile grid. Null when the group is empty, so a catalogue with no seasonal
     *  packs loaded yet shows one clean list instead of an empty heading over nothing. */
    function buildRailGroup(heading: string, shapes: ShapeEntry[]): HTMLElement | null {
      if (!shapes.length) return null;
      const tileGrid = el('div', 'cg-shed__tiles');
      for (const sh of shapes) {
        const tile = thumbTile({
          svgPath: sh.thumb,
          label: sh.name,
          selected: sh.id === pickedId,
          className: 'cg-shed__tile',
          onClick: () => pickStartingShape(sh),
        });
        tiles.set(sh.id, tile);
        tileGrid.append(tile);
      }
      const group = el('div', 'cg-shed__group');
      group.append(el('p', 'cg-shed__caption', heading), tileGrid);
      return group;
    }
    // Grouped by source, so a seasonal silhouette reads as a seasonal silhouette rather than
    // one more tile in the middle of the built-ins.
    const presetGroup = buildRailGroup('Shapes', opts.shapes.filter((s) => !!s.kind && !s.hidden));
    const packGroup = buildRailGroup('Seasonal shapes', opts.shapes.filter((s) => !s.kind && !s.hidden));
    if (presetGroup) railWrap.append(presetGroup);
    if (packGroup) railWrap.append(packGroup);

    /** A rail tile in Build mode does not replace the shape — there is no single shape to
     *  replace — it adds one, the same way a palette primitive does. */
    function addRailShapeInBuild(sh: ShapeEntry): void {
      let raw: Ring;
      if (sh.kind) {
        raw = previewRingFor({
          kind: sh.kind,
          shapeSides: sh.param?.value ?? 6,
          shapeCornerPct: sh.corner ? sh.corner.value / 100 : 0.22,
          shapeArmPct: sh.feature ? sh.feature.value / 100 : 0.34,
          sizeMm: null,
        });
      } else if (sh.rings?.length) {
        raw = sh.rings[0];
      } else {
        return;
      }
      commitStep();
      const size = spanMm * NEW_ITEM_FRACTION;
      const unit = normaliseRing(raw);
      const [dx, dy] = nextDropSpot(items, size);
      const it = outlineItem(unit.map(([x, y]) => [x * size, y * size] as [number, number]), dx, dy);
      items = [...items, it];
      selectedItemId = it.id;
      setStatus(`${sh.name} added.`);
      afterEdit();
    }

    function pickStartingShape(sh: ShapeEntry): void {
      if (mode === 'build') { addRailShapeInBuild(sh); return; }
      commitStep();
      pickedId = sh.id;
      if (sh.kind) {
        source = 'preset';
        packToken = null;
        params = {
          ...params,
          kind: sh.kind,
          shapeSides: sh.param?.value ?? params.shapeSides,
          shapeCornerPct: sh.corner ? sh.corner.value / 100 : params.shapeCornerPct,
          // A shape brings its own default here too. Without it a cross picked after a star
          // inherited the star's 0.30 sharpness as its arm width.
          shapeArmPct: sh.feature ? sh.feature.value / 100 : params.shapeArmPct,
        };
        rebuildPreset();
        setStatus(`${sh.name}. Drag a blue grip, or use a slider on the right.`);
      } else if (sh.rings?.length) {
        source = 'drawn';
        params = { ...params, kind: 'custom' };
        // Remember WHICH library shape it is. Until it is edited, this is still "Bat" and not
        // an anonymous outline, so it can be stored as a token and named on the button.
        packToken = sh.id;
        ring = normaliseRing(sh.rings[0]).map(
          ([x, y]) => [x * spanMm, y * spanMm] as [number, number],
        );
        setStatus(`${sh.name}. Switch to Build to combine it with other shapes.`);
      } else {
        return;
      }
      viewDirty = true;
      afterEdit();
    }

    /* ---------------------------------------------------------------- the controls */

    const modeTabs = segmentedControl<'adjust' | 'build'>({
      label: 'Editing',
      options: [
        { value: 'adjust', label: 'Adjust' },
        { value: 'build', label: 'Build' },
      ],
      value: mode,
      onChange: (v) => {
        mode = v;
        // Entering Build for the first time seeds it from whatever Adjust is showing, so
        // nothing is lost — `ring` is already in editor millimetres, so it drops straight in
        // as an outline item with no rescaling. Only the FIRST entry seeds; switching back and
        // forth after that keeps whatever Build already has.
        if (v === 'build' && items.length === 0 && ring.length >= 3) {
          const seed = outlineItem(ring);
          items = [seed];
          selectedItemId = seed.id;
        }
        viewDirty = true;
        afterEdit(false);
      },
    });
    const shortcutsTip = helpTip(
      'Keyboard: Delete removes the selected shape. Arrow keys nudge it, Shift for 5 mm. '
      + 'Escape clears the selection. Ctrl/Cmd+D duplicates it. Ctrl/Cmd+Z undoes, '
      + 'Ctrl/Cmd+Shift+Z redoes.',
    );
    const modeRow = el('div', 'cg-shed__mode-row');
    modeRow.append(modeTabs, shortcutsTip);

    const freezeNote = el('p', 'cg-shed__note');

    /** Which panel is showing, and (in Adjust) what the freeze note says. Called after every
     *  edit so the wording always describes what is actually on screen. */
    function syncModePanels(): void {
      const adjusting = mode === 'adjust';
      adjustPanel.style.display = adjusting ? '' : 'none';
      buildPanel.style.display = adjusting ? 'none' : '';
      freezeNote.hidden = !adjusting;
      if (!adjusting) return;
      if (source === 'preset') {
        freezeNote.textContent = 'This is a generated shape — sliders and grips reshape it. Switch to Build to combine it with other shapes.';
      } else {
        freezeNote.textContent = pickedId
          ? 'This outline is a library shape, kept as its name and its points until you change it.'
          : 'This shape is your own outline. Reset brings back what you started with.';
      }
    }

    const snapToggle = toggleSwitch({
      label: 'Snap to grid',
      help: `Rounds a shape's position and size to the nearest ${GRID_MM} mm while you drag it.`,
      checked: snap,
      onChange: (on) => { snap = on; },
    });

    const undoBtn: ButtonHandle = iconButton({
      icon: ICONS.undo, label: 'Undo', onClick: () => doUndo(),
    });
    const redoBtn: ButtonHandle = iconButton({
      icon: ICONS.redo, label: 'Redo', onClick: () => doRedo(),
    });
    const resetBtn: ButtonHandle = iconButton({
      icon: ICONS.rotateLeft, label: 'Reset',
      title: 'Put back the shape you opened this dialog with, undoing every change made here',
      onClick: () => {
        commitStep();
        restore(startSnapshot);
        // Reset is meaningful from either tab: if Build is open, it gets the same single
        // "whatever Adjust started as" outline it would have been seeded with on first entry,
        // rather than the empty list `startSnapshot` actually carries (Build had not been
        // entered yet when the dialog opened).
        if (mode === 'build') {
          const seed = outlineItem(ring);
          items = [seed];
          selectedItemId = seed.id;
        }
        handleIndex = 0;
        viewDirty = true;
        setStatus('Back to the shape you started with.');
        afterEdit();
      },
    });
    const freeSizeBtn: ButtonHandle = button({
      label: 'Size follows the design',
      emphasis: 'secondary',
      block: true,
      title: 'Stop pinning the base to an exact width and height',
      onClick: () => {
        commitStep();
        params = { ...params, sizeMm: null };
        if (source === 'preset') rebuildPreset();
        else {
          const [minX, minY, maxX, maxY] = bboxOf(ring);
          const aspect = (maxX - minX) > 1e-6 ? (maxY - minY) / (maxX - minX) : 1;
          ring = fitRingToBox(ring, spanMm, spanMm * aspect);
        }
        viewDirty = true;
        afterEdit();
      },
    });

    /* ---- the Adjust-mode slider panel: the same knobs as the on-shape grips, named and typed.

       Built once and re-pointed per shape via `SliderRowHandle.setBounds` (min/max/label),
       rather than rebuilt — a rebuilt row loses focus and any half-typed edit the moment the
       shape changes under it. `armUndo` gives each one the same "one undo entry per gesture"
       rule the canvas grips already follow. `hoverify` is the other half of "a slider and a
       grip are one control shown two ways". */
    function armUndo(row: SliderRowHandle): void {
      // By class, not `input[type="range"]` — the literal string `type="range"` is what
      // `scripts/check-ui-drift.mjs` greps for to catch a HAND-BUILT slider.
      const range = row.querySelector<HTMLInputElement>('input.vl-slider');
      const val = row.querySelector<HTMLInputElement>('input.vl-val');
      range?.addEventListener('pointerdown', () => commitStep());
      range?.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) commitStep(); });
      val?.addEventListener('focus', () => commitStep());
    }
    function hoverify(row: SliderRowHandle, kind: HandleKind): void {
      const on = () => { hoverHandleKind = kind; invalidate(false); };
      const off = () => { hoverHandleKind = null; invalidate(false); };
      row.addEventListener('mouseenter', on);
      row.addEventListener('mouseleave', off);
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', off);
    }

    const sidesRow = sliderRow({
      label: 'Sides', min: COUNT_RANGE[0], max: COUNT_RANGE[1], step: 1,
      value: params.shapeSides,
      onInput: (v) => {
        params = { ...params, shapeSides: Math.round(v) };
        if (source === 'preset') rebuildPreset();
        viewDirty = true;
        afterEdit();
      },
    });
    armUndo(sidesRow);
    hoverify(sidesRow, 'count');

    const cornerRow = sliderRow({
      label: 'Corner radius', min: Math.round(CORNER_RANGE[0] * 100), max: Math.round(CORNER_RANGE[1] * 100),
      step: 1, unit: '%', value: Math.round(params.shapeCornerPct * 100),
      onInput: (v) => {
        params = { ...params, shapeCornerPct: v / 100 };
        if (source === 'preset') rebuildPreset();
        afterEdit();
      },
    });
    armUndo(cornerRow);
    hoverify(cornerRow, 'corner');

    const featureRow = sliderRow({
      label: 'Notch', min: 0, max: 100, step: 1, unit: '%',
      value: Math.round(params.shapeArmPct * 100),
      onInput: (v) => {
        params = { ...params, shapeArmPct: v / 100 };
        if (source === 'preset') rebuildPreset();
        afterEdit();
      },
    });
    armUndo(featureRow);
    hoverify(featureRow, 'feature');

    function applySize(w: number | null, h: number | null): void {
      const [minX, minY, maxX, maxY] = bboxOf(ring);
      const curW = params.sizeMm?.w ?? Math.round(maxX - minX);
      const curH = params.sizeMm?.h ?? Math.round(maxY - minY);
      const nextW = clamp(w ?? curW, SIZE_RANGE[0], SIZE_RANGE[1]);
      const nextH = clamp(h ?? curH, SIZE_RANGE[0], SIZE_RANGE[1]);
      params = { ...params, sizeMm: { w: nextW, h: nextH } };
      if (source === 'preset') rebuildPreset();
      else ring = fitRingToBox(ring, nextW, nextH);
      viewDirty = true;
      afterEdit();
    }
    const widthRow = sliderRow({
      label: 'Width', min: SIZE_RANGE[0], max: SIZE_RANGE[1], step: 1, unit: 'mm',
      value: params.sizeMm?.w ?? Math.round(spanMm),
      onInput: (v) => applySize(Math.round(v), null),
    });
    armUndo(widthRow);
    hoverify(widthRow, 'size');
    const heightRow = sliderRow({
      label: 'Height', min: SIZE_RANGE[0], max: SIZE_RANGE[1], step: 1, unit: 'mm',
      value: params.sizeMm?.h ?? Math.round(spanMm),
      onInput: (v) => applySize(null, Math.round(v)),
    });
    armUndo(heightRow);
    hoverify(heightRow, 'size');

    /** Show only the sliders this shape's `HANDLES` entry declares, and keep the ones shown
     *  pointed at the live value. */
    function syncSideSliders(): void {
      const kinds = HANDLES[params.kind] ?? [];
      const has = (k: HandleKind) => kinds.includes(k);

      sidesRow.style.display = has('count') ? '' : 'none';
      if (has('count')) {
        sidesRow.setBounds(COUNT_RANGE[0], COUNT_RANGE[1], handleLabel('count', params.kind));
        sidesRow.setValue(params.shapeSides);
      }

      cornerRow.style.display = has('corner') ? '' : 'none';
      if (has('corner')) cornerRow.setValue(Math.round(params.shapeCornerPct * 100));

      featureRow.style.display = has('feature') ? '' : 'none';
      if (has('feature')) {
        const [lo, hi] = featureRange(params.kind);
        featureRow.setBounds(Math.round(lo * 100), Math.round(hi * 100), handleLabel('feature', params.kind));
        featureRow.setValue(Math.round(params.shapeArmPct * 100));
      }

      const hasSize = has('size');
      widthRow.style.display = hasSize ? '' : 'none';
      heightRow.style.display = hasSize ? '' : 'none';
      if (hasSize) {
        const [minX, minY, maxX, maxY] = bboxOf(ring);
        widthRow.setValue(params.sizeMm ? params.sizeMm.w : Math.round(maxX - minX));
        heightRow.setValue(params.sizeMm ? params.sizeMm.h : Math.round(maxY - minY));
      }
      freeSizeBtn.style.display = params.sizeMm ? '' : 'none';
    }

    /* ---- the Build-mode panel: a palette of primitives, then the selected item's own controls. */

    const ITEM_SIZE_MAX = Math.max(200, Math.round(spanMm * 4));

    const PALETTE: { kind: Exclude<ComposeShapeKind, 'outline'>; label: string; ring: Ring }[] = [
      { kind: 'circle', label: 'Circle', ring: circleRing() },
      { kind: 'roundedRect', label: 'Rounded rectangle', ring: roundedRectRing(2, 2, 0.22) },
      { kind: 'ngon', label: 'Polygon', ring: ngonRing(6) },
      { kind: 'star', label: 'Star', ring: starRing(5) },
      { kind: 'heart', label: 'Heart', ring: heartRing() },
      { kind: 'egg', label: 'Egg', ring: eggRing() },
      { kind: 'capsule', label: 'Capsule', ring: capsuleRing() },
      { kind: 'cross', label: 'Cross', ring: crossRing() },
      { kind: 'shield', label: 'Shield', ring: shieldRing() },
      { kind: 'tag', label: 'Tag', ring: tagRing() },
      { kind: 'arch', label: 'Arch', ring: archRing() },
      { kind: 'squircle', label: 'Squircle', ring: squircleRing() },
    ];

    /** Display name for every kind Build can place — the palette's own labels, plus `outline`
     *  for the frozen ring Adjust hands over. Shared by the canvas label and the pieces list, so
     *  the two never name the same piece two different ways. */
    const KIND_LABELS: Partial<Record<ComposeShapeKind, string>> = { outline: 'Outline' };
    for (const p of PALETTE) KIND_LABELS[p.kind] = p.label;
    const pieceKindLabel = (item: ComposeItem): string => KIND_LABELS[item.kind] ?? 'Shape';
    const pieceFullLabel = (item: ComposeItem): string => (
      item.op === 'cut' ? `Cut: ${pieceKindLabel(item)}` : pieceKindLabel(item)
    );

    function addPrimitiveAt(kind: Exclude<ComposeShapeKind, 'outline'>, worldX?: number, worldY?: number): void {
      commitStep();
      const size = Math.max(MIN_ITEM_MM, Math.round(spanMm * NEW_ITEM_FRACTION));
      // An explicit drop point (a drag that ended over the canvas) wins; otherwise — a plain
      // click on the palette tile — the new piece is staggered off the last one so a run of
      // clicks fans out across the canvas instead of stacking invisibly on top of each other.
      const [x, y] = worldX !== undefined && worldY !== undefined
        ? [worldX, worldY]
        : nextDropSpot(items, size);
      const it = newPrimitiveItem(kind, x, y, spanMm, NEW_ITEM_FRACTION);
      items = [...items, it];
      selectedItemId = it.id;
      setStatus(`${KIND_LABELS[kind]} added. Drag its body to move it, or use the sliders on the right.`);
      viewDirty = true;
      afterEdit();
    }

    /** Adds on a plain click (most people click a palette tile once and expect a shape to
     *  appear) or on a drag that ends over the canvas, dropping it exactly where the drag let
     *  go. Built on pointer events rather than the browser's native HTML5 drag-and-drop so it
     *  behaves the same with a mouse, a pen or a finger, like every other gesture on this
     *  canvas. */
    function wirePaletteDrag(tile: HTMLElement, kind: Exclude<ComposeShapeKind, 'outline'>): void {
      let dragging = false;
      tile.addEventListener('pointerdown', (down) => {
        const startX = down.clientX;
        const startY = down.clientY;
        dragging = false;
        const onMove = (move: PointerEvent) => {
          if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) > 6) dragging = true;
        };
        const onUp = (up: PointerEvent) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (!dragging) return; // a plain click — the 'click' listener below handles that
          const rect = canvas.getBoundingClientRect();
          if (up.clientX < rect.left || up.clientX > rect.right || up.clientY < rect.top || up.clientY > rect.bottom) return;
          addPrimitiveAt(kind, toWorldX(up.clientX - rect.left), toWorldY(up.clientY - rect.top));
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      // Fires after `onUp` above on the SAME gesture when it never left the tile — `dragging`
      // still reflects that gesture at this point, so a real drag-and-drop never also adds a
      // second, default-position copy.
      tile.addEventListener('click', () => { if (!dragging) addPrimitiveAt(kind); });
    }

    const paletteTiles = PALETTE.map((p) => {
      const tile = thumbTile({
        svgPath: ringToPath(p.ring),
        label: `Add a ${p.label.toLowerCase()}`,
        className: 'cg-shed__tile cg-shed__tile--add',
      });
      wirePaletteDrag(tile, p.kind);
      return tile;
    });
    const palette = thumbGrid({ heading: 'Add a shape', tiles: paletteTiles, minPx: 44 });

    const composeNote = el(
      'p', 'cg-shed__note',
      'Every Add shape is combined into one first; every Cut shape then removes material from that result. The list order only decides which shape a click lands on.',
    );
    const noSelectionNote = el(
      'p', 'cg-shed__note',
      'Click a shape on the canvas or in the list below to edit it, click one above to add it, or drag one onto the canvas.',
    );

    function updateSelectedItem(patch: Partial<ComposeItem>): void {
      const idx = items.findIndex((it) => it.id === selectedItemId);
      if (idx < 0) return;
      items = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      viewDirty = true;
      afterEdit();
    }

    const opTabs = segmentedControl<'add' | 'cut'>({
      label: 'Type',
      help: 'Add shapes are unioned together; Cut shapes remove material from that union afterwards, regardless of where either sits in the list.',
      options: [{ value: 'add', label: 'Add' }, { value: 'cut', label: 'Cut' }],
      value: 'add',
      onChange: (v) => { commitStep(); updateSelectedItem({ op: v }); },
    });

    const itemWidthRow = sliderRow({
      label: 'Width', min: MIN_ITEM_MM, max: ITEM_SIZE_MAX, step: 1, unit: 'mm',
      value: Math.round(spanMm * NEW_ITEM_FRACTION),
      onInput: (v) => updateSelectedItem({ w: v }),
    });
    armUndo(itemWidthRow);
    const itemHeightRow = sliderRow({
      label: 'Height', min: MIN_ITEM_MM, max: ITEM_SIZE_MAX, step: 1, unit: 'mm',
      value: Math.round(spanMm * NEW_ITEM_FRACTION),
      onInput: (v) => updateSelectedItem({ h: v }),
    });
    armUndo(itemHeightRow);
    const itemRotRow = sliderRow({
      label: 'Rotation', min: 0, max: 359, step: 1, unit: '°', value: 0,
      onInput: (v) => updateSelectedItem({ rot: v }),
    });
    armUndo(itemRotRow);
    const itemSidesRow = sliderRow({
      label: 'Sides', min: ITEM_SIDES_RANGE[0], max: ITEM_SIDES_RANGE[1], step: 1, value: 5,
      onInput: (v) => updateSelectedItem({ sides: Math.round(v) }),
    });
    armUndo(itemSidesRow);

    const duplicateBtn: ButtonHandle = button({
      label: 'Duplicate', emphasis: 'secondary', block: true,
      title: 'Add a copy of the selected shape, slightly offset (Ctrl/Cmd+D)',
      onClick: () => duplicateSelectedItem(),
    });
    const sendBackBtn: ButtonHandle = button({
      label: 'Send to back', emphasis: 'secondary', block: true,
      title: 'Move behind the other shapes — changes which one a click lands on, not the geometry',
      onClick: () => {
        const idx = items.findIndex((it) => it.id === selectedItemId);
        if (idx <= 0) return;
        commitStep();
        const next = items.slice();
        const [it] = next.splice(idx, 1);
        next.unshift(it);
        items = next;
        afterEdit();
      },
    });
    const bringFrontBtn: ButtonHandle = button({
      label: 'Bring to front', emphasis: 'secondary', block: true,
      title: 'Move in front of the other shapes — changes which one a click lands on, not the geometry',
      onClick: () => {
        const idx = items.findIndex((it) => it.id === selectedItemId);
        if (idx < 0 || idx === items.length - 1) return;
        commitStep();
        const next = items.slice();
        const [it] = next.splice(idx, 1);
        next.push(it);
        items = next;
        afterEdit();
      },
    });
    const deleteItemBtn: ButtonHandle = button({
      icon: ICONS.trash, label: 'Delete shape', emphasis: 'secondary', block: true,
      title: 'Remove the selected shape',
      onClick: () => removeSelectedItem(),
    });

    const itemControls = el('div', 'cg-shed__panel');
    itemControls.append(
      opTabs, itemWidthRow, itemHeightRow, itemRotRow, itemSidesRow,
      duplicateBtn, buttonRow(sendBackBtn, bringFrontBtn), deleteItemBtn,
    );

    /** Which item controls apply to the selection, and what they currently read. Called after
     *  every edit — same rule as `syncSideSliders`. */
    function syncItemPanel(): void {
      const item = items.find((it) => it.id === selectedItemId) ?? null;
      noSelectionNote.style.display = item ? 'none' : '';
      itemControls.style.display = item ? '' : 'none';
      if (!item) return;
      opTabs.setValue(item.op);
      itemWidthRow.setValue(Math.round(item.w));
      itemHeightRow.setValue(Math.round(item.h));
      itemRotRow.setValue(Math.round(((item.rot % 360) + 360) % 360));
      const showSides = item.kind === 'ngon' || item.kind === 'star';
      itemSidesRow.style.display = showSides ? '' : 'none';
      if (showSides) itemSidesRow.setValue(item.sides ?? 5);
    }

    /* ---- the pieces list: every item in z-order, one click away from being the selection.
       This is the direct answer to "which of these overlapping circles did I select" — the
       canvas label only names the ALREADY-selected piece, but with three circles stacked on
       each other there is no click that reliably lands on the back one. Rebuilt on every
       `afterEdit` rather than patched in place: membership and order change together (add,
       delete, duplicate, send-to-back, undo/redo), and a list this short costs nothing to
       redraw whole, unlike the Adjust sliders that hold live focus and can't be rebuilt. */
    const piecesListEl = el('div', 'cg-shed__pieces');
    const piecesGroup = el('div', 'cg-shed__piece-group');
    piecesGroup.append(el('p', 'cg-shed__caption', 'Shapes, front to back'), piecesListEl);

    function syncPiecesList(): void {
      piecesGroup.style.display = items.length ? '' : 'none';
      piecesListEl.replaceChildren(...[...items].reverse().map((item) => {
        const row: ButtonHandle = button({
          label: pieceFullLabel(item),
          emphasis: 'ghost',
          block: true,
          className: `cg-shed__piece${item.op === 'cut' ? ' cg-shed__piece--cut' : ''}`,
          title: `Select this ${pieceKindLabel(item).toLowerCase()}`,
          onClick: () => { selectedItemId = item.id; afterEdit(false); },
        });
        // Same mechanism `thumbTile` uses for "the current choice" — the attribute is both the
        // announcement and what the stylesheet keys the highlighted row off, so the two can
        // never disagree. The Add/Cut badge is drawn from `data-badge` by the stylesheet too,
        // rather than a second interactive element inside the row.
        row.setAttribute('aria-pressed', String(item.id === selectedItemId));
        row.setAttribute('data-badge', item.op === 'cut' ? 'Cut' : 'Add');
        return row;
      }));
    }

    const readout = el('div', 'cg-shed__readout');
    const hintLine = el('p', 'cg-shed__hint');
    hintLine.id = 'cgShedHint';
    // Polite, not assertive: this text changes on every drag, and an assertive region would
    // interrupt the reader mid-sentence on each one.
    hintLine.setAttribute('aria-live', 'polite');
    let statusOverride = '';
    let statusTimer = 0;
    function setStatus(text: string): void {
      statusOverride = text;
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => { statusOverride = ''; updateStatus(); }, 4000);
      updateStatus();
    }

    /** One line, changing with the mode and selection, when there is no transient message
     *  overriding it. First contact has to explain the whole idea — Add shapes, overlap them,
     *  Cut makes a hole — because entering Build always seeds one selected outline item, so
     *  neither "nothing selected" nor "one selected" would ever be reached on their own to
     *  carry that explanation. */
    function hintFor(): string {
      if (mode === 'adjust') {
        return 'Drag a blue grip on the shape, or a slider on the right. Press [ then ] to select a grip and the arrow keys to move it.';
      }
      if (items.length <= 1) {
        return 'Add shapes from the panel, drag them to overlap. Set one to Cut to make a hole.';
      }
      if (composeIslands > 1) {
        return 'These shapes don’t touch yet — drag them until they overlap to combine into one base.';
      }
      if (!selectedItemId) {
        return 'Click a shape to select it, or add one from the palette on the right.';
      }
      return 'Drag the body to move it, a square handle to resize it, or the circle above it to rotate it. Delete removes it, Ctrl/Cmd+D duplicates it.';
    }

    /** The geometry warnings — a switch with nowhere to sit, material the build's
     *  minimum-feature pass would delete, or (Build only) shapes that do not combine into one
     *  base. Kept apart from `hintFor`'s guidance and rendered in its own banner near the
     *  footer: a warning that only tints the canvas is easy to miss. */
    function computeWarning(): string {
      if (mode === 'build') {
        if (!items.length) return 'Add at least one shape to build a base.';
        if (composeIslands > 1) return 'Shapes must overlap to make one base.';
        if (composeIslands === 0) return 'Nothing is left after the cuts — add a shape, or remove a cut.';
      }
      if (switchesShort > 0) {
        return switchesShort === 1 && opts.switches.length <= 1
          ? `No room for the switch here: it needs a clear ${opts.switchColumnMm.toFixed(0)} mm square and this shape does not have one.`
          : `${switchesShort} of ${opts.switches.length} switches have no room for their ${opts.switchColumnMm.toFixed(0)} mm column.`;
      }
      if (field && field.survivingFrac <= 0) {
        return `This whole shape is thinner than ${(MIN_FEATURE_MM * 2).toFixed(0)} mm — it will not print. Confirm is off until it is wider, or you undo.`;
      }
      if (field && field.survivingFrac < 0.999) {
        return mode === 'build' || source === 'drawn'
          ? `The red areas are thinner than ${(MIN_FEATURE_MM * 2).toFixed(0)} mm and will be removed when the model is built.`
          : `The red areas are thinner than ${(MIN_FEATURE_MM * 2).toFixed(0)} mm and may not print cleanly.`;
      }
      return '';
    }

    /** Set right after the dialog is built — see the lifecycle section — and read here so
     *  Confirm can be disabled from inside the same status pass that decides what the warning
     *  banner says. */
    let confirmBtn: HTMLButtonElement | null = null;

    function updateStatus(): void {
      const bits: string[] = [];
      const rings = currentRings();
      const [minX, minY, maxX, maxY] = bboxOfAll(rings);
      bits.push(`${(maxX - minX).toFixed(1)} x ${(maxY - minY).toFixed(1)} mm`);
      if (params.sizeMm) bits.push('size locked');
      if (mode === 'build') {
        bits.push(`${items.length} shape${items.length === 1 ? '' : 's'}`);
      } else if (source === 'drawn') {
        bits.push(`${ring.length} points`);
      } else {
        for (const kind of HANDLES[params.kind] ?? []) {
          if (kind === 'count') bits.push(`${handleLabel(kind, params.kind)}: ${params.shapeSides}`);
          if (kind === 'corner') bits.push(`corner ${Math.round(params.shapeCornerPct * 100)}%`);
          if (kind === 'feature') {
            bits.push(`${handleLabel(kind, params.kind).toLowerCase()} ${Math.round(params.shapeArmPct * 100)}%`);
          }
        }
      }
      readout.textContent = bits.join('  ·  ');

      const warnText = computeWarning();
      warnBanner.textContent = warnText;
      warnBanner.hidden = !warnText;

      // The only warnings that mean the build truly cannot run: nothing anywhere in the shape
      // survives the minimum-feature pass, or (Build) the item list does not resolve to exactly
      // one base. Switch-fit is advisory — the model still builds.
      const cannotBuild = !!(field && field.survivingFrac <= 0)
        || (mode === 'build' && (items.length === 0 || composeIslands !== 1));
      if (confirmBtn) {
        confirmBtn.disabled = cannotBuild;
        confirmBtn.title = cannotBuild
          ? (mode === 'build'
            ? 'Fix the shapes above — Confirm needs exactly one combined base — to continue.'
            : 'This shape is thinner than the printer can produce everywhere. Undo, or make it bigger, to continue.')
          : '';
      }

      hintLine.textContent = statusOverride || hintFor();
    }

    function syncButtons(): void {
      undoBtn.setDisabled(undoStack.length === 0);
      redoBtn.setDisabled(redoStack.length === 0);
    }

    const commonTools = el('div', 'cg-shed__tools');
    commonTools.append(undoBtn, redoBtn, resetBtn);

    const adjustPanel = el('div', 'cg-shed__panel');
    adjustPanel.append(sidesRow, cornerRow, featureRow, widthRow, heightRow, freeSizeBtn);

    const buildPanel = el('div', 'cg-shed__panel');
    buildPanel.append(palette, composeNote, snapToggle, piecesGroup, noSelectionNote, itemControls);

    side.append(modeRow, freezeNote, commonTools, adjustPanel, buildPanel, readout);

    const warnBanner = el('p', 'cg-shed__warn');
    warnBanner.hidden = true;

    grid.append(railWrap, stage, side);
    stage.append(hintLine);
    body.append(grid, warnBanner);

    /* ---------------------------------------------------------------- lifecycle */

    const ro = new ResizeObserver(() => { viewDirty = true; invalidate(false); });
    ro.observe(stage);

    const finish = (result: ShapeEditorResult | null): void => {
      if (settled) return;
      settled = true;
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      window.clearTimeout(statusTimer);
      resolve(result);
    };

    const commit = (): void => {
      if (mode === 'build') {
        finish({
          kind: 'drawn',
          rings: normaliseRings(composeRings),
          fixedSize: params.sizeMm,
          packShapeToken: null,
        });
        return;
      }
      if (source === 'preset') {
        finish({
          kind: 'preset',
          baseShape: params.kind,
          shapeSides: params.shapeSides,
          shapeCornerPct: params.shapeCornerPct,
          shapeArmPct: params.shapeArmPct,
          fixedSize: params.sizeMm,
        });
        return;
      }
      finish({
        kind: 'drawn',
        rings: [normaliseRing(ring)],
        fixedSize: params.sizeMm,
        packShapeToken: packToken,
      });
    };

    const handle: DialogHandle = dialog({
      title: 'Shape',
      content: body,
      size: 'xl',
      onClose: () => finish(null),
      actions: [
        { label: 'Cancel', onClick: () => { finish(null); } },
        { label: 'Use this shape', primary: true, onClick: () => { commit(); } },
      ],
    });
    void handle;
    // `dialog()` builds its own action buttons and hands back no reference to them; this is the
    // one control here that needs to grey one out mid-session, so it is found the same way a
    // test would find it rather than growing the kit's dialog API for a single caller.
    confirmBtn = handle.root.querySelector<HTMLButtonElement>('.vl-dialog__actions .vl-btn--primary');

    afterEdit(false);
    // First real paint after layout, so the canvas has a size to fit the shape into.
    requestAnimationFrame(() => { viewDirty = true; draw(); canvas.focus(); });
  });
}
