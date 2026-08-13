// The Shape stage: what will actually be cut, before it becomes a solid.
//
// This exists because the trace was a black box. An image went in, a model came
// out, and when the model was wrong there was no way to see which step had gone
// wrong or to do anything about it. Three things are drawn that the 3D view
// cannot show:
//
//   - the DROPPED islands, in red. Despeckle throwing away a speck is right;
//     throwing away a limb is not, and until you can see it you cannot tell
//     which just happened.
//   - the CROSSING LINE, as a line on the shape you drag, rather than a
//     percentage in a sidebar.
//   - the WEB BAND: the material the slot needs either side of that line. When
//     it is too thin you watch it pinch, instead of reading an error after the
//     fact.

import type { Ring } from '../types';

export interface ShapeEditorState {
  /** Kept geometry, normalised (longest side = 1, centred, Y-up). */
  rings: Ring[];
  /** Islands despeckle discarded, same space. */
  dropped: Ring[];
  /** The source image, if this came from one. */
  source: CanvasImageSource | null;
  /** Maps source pixels into normalised space. */
  transform: { scale: number; cx: number; cy: number } | null;
  /** Crossing line, 0..1 across the shape's bounding box. */
  axisFrac: number;
  /** Joint position, 0..1 up the material run on that line. */
  jointFrac: number;
  /** Millimetres per normalised unit — turns the web rule into pixels. */
  mmPerUnit: number;
  /** Total width a slot plus its webs needs, mm. */
  needMm: number;
  /** Slot width, mm. */
  slotMm: number;
}

export interface ShapeEditor {
  root: HTMLElement;
  setState(next: Partial<ShapeEditorState>): void;
  onAxisChange(cb: (frac: number) => void): void;
  onJointChange(cb: (frac: number) => void): void;
  resize(): void;
  dispose(): void;
}

const COLOR = {
  fill: 'rgba(203, 213, 225, 0.92)',
  hole: '#15171c',
  dropped: 'rgba(239, 68, 68, 0.55)',
  droppedLine: '#ef4444',
  axis: '#5b9dff',
  web: 'rgba(91, 157, 255, 0.16)',
  webBad: 'rgba(239, 68, 68, 0.22)',
  slot: 'rgba(21, 23, 28, 0.85)',
  text: '#9aa3b2',
};

export function createShapeEditor(): ShapeEditor {
  const root = document.createElement('div');
  root.className = 'ls-shape-editor';
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const ctx = canvas.getContext('2d')!;

  let state: ShapeEditorState = {
    rings: [],
    dropped: [],
    source: null,
    transform: null,
    axisFrac: 0.5,
    jointFrac: 0.5,
    mmPerUnit: 100,
    needMm: 12,
    slotMm: 3,
  };

  let axisCb: (f: number) => void = () => {};
  let jointCb: (f: number) => void = () => {};
  let dragging: 'axis' | 'joint' | null = null;

  // View transform, recomputed on every draw.
  let zoom = 1;
  let originX = 0;
  let originY = 0;
  let bounds: [number, number, number, number] = [-0.5, -0.5, 0.5, 0.5];

  const toScreenX = (x: number): number => originX + x * zoom;
  const toScreenY = (y: number): number => originY - y * zoom;
  const toWorldX = (sx: number): number => (sx - originX) / zoom;
  const toWorldY = (sy: number): number => (originY - sy) / zoom;

  function computeBounds(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of [...state.rings, ...state.dropped]) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    bounds = isFinite(minX) ? [minX, minY, maxX, maxY] : [-0.5, -0.5, 0.5, 0.5];
  }

  /** Vertical runs of material at a given x — the same question the solver asks
   *  when it places the joint, answered here so the handle sits on the shape. */
  function runsAt(x: number): [number, number][] {
    const hits: { y: number; w: number }[] = [];
    for (const ring of state.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a[0] <= x === b[0] <= x) continue;
        const t = (x - a[0]) / (b[0] - a[0]);
        hits.push({ y: a[1] + t * (b[1] - a[1]), w: b[0] > a[0] ? 1 : -1 });
      }
    }
    hits.sort((p, q) => p.y - q.y);
    const out: [number, number][] = [];
    let wind = 0;
    let start = 0;
    for (const h of hits) {
      const prev = wind;
      wind += h.w;
      if (prev === 0 && wind !== 0) start = h.y;
      else if (prev !== 0 && wind === 0 && h.y > start) out.push([start, h.y]);
    }
    return out;
  }

  function axisX(): number {
    return bounds[0] + state.axisFrac * (bounds[2] - bounds[0]);
  }

  function tracePath(ring: Ring): void {
    ctx.moveTo(toScreenX(ring[0][0]), toScreenY(ring[0][1]));
    for (let i = 1; i < ring.length; i++) ctx.lineTo(toScreenX(ring[i][0]), toScreenY(ring[i][1]));
    ctx.closePath();
  }

  function draw(): void {
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    computeBounds();
    const spanX = bounds[2] - bounds[0] || 1;
    const spanY = bounds[3] - bounds[1] || 1;
    const pad = 56;
    zoom = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    originX = w / 2 - ((bounds[0] + bounds[2]) / 2) * zoom;
    originY = h / 2 + ((bounds[1] + bounds[3]) / 2) * zoom;

    if (!state.rings.length) {
      ctx.fillStyle = COLOR.text;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No silhouette yet — pick a sample or drop an image.', w / 2, h / 2);
      return;
    }

    // Source image, faint, so the threshold can be judged against the original.
    if (state.source && state.transform) {
      const { scale, cx, cy } = state.transform;
      const s = scale * zoom;
      const src = state.source as HTMLCanvasElement;
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.drawImage(src, originX - cx * s, originY - cy * s, src.width * s, src.height * s);
      ctx.restore();
    }

    // Silhouette. Even-odd so interior rings punch holes.
    ctx.beginPath();
    for (const ring of state.rings) tracePath(ring);
    ctx.fillStyle = COLOR.fill;
    ctx.fill('evenodd');

    // What was thrown away.
    if (state.dropped.length) {
      ctx.beginPath();
      for (const ring of state.dropped) tracePath(ring);
      ctx.fillStyle = COLOR.dropped;
      ctx.fill('evenodd');
      ctx.strokeStyle = COLOR.droppedLine;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // The web band: slot plus the material it needs either side. Clipped to the
    // silhouette so it reads as part of the shape, not a floating rectangle.
    const ax = axisX();
    const runs = runsAt(ax);
    const needU = state.needMm / state.mmPerUnit;
    const slotU = state.slotMm / state.mmPerUnit;
    const run = runs.length
      ? runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
      : null;

    ctx.save();
    ctx.beginPath();
    for (const ring of state.rings) tracePath(ring);
    ctx.clip('evenodd');

    // Is there enough material across the band, at the joint?
    let thin = false;
    if (run) {
      const jy = run[0] + state.jointFrac * (run[1] - run[0]);
      const widths: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const y = run[0] + ((run[1] - run[0]) * i) / 24;
        const xs = crossingsAtY(y);
        const seg = xs.find(([a, b]) => ax >= a && ax <= b);
        widths.push(seg ? seg[1] - seg[0] : 0);
      }
      const atJoint = crossingsAtY(jy).find(([a, b]) => ax >= a && ax <= b);
      thin = !atJoint || atJoint[1] - atJoint[0] < needU;
      ctx.fillStyle = thin ? COLOR.webBad : COLOR.web;
      ctx.fillRect(toScreenX(ax - needU / 2), toScreenY(run[1]), needU * zoom, (run[1] - run[0]) * zoom);
      void widths;
    }

    // The slot itself.
    if (run) {
      const jy = run[0] + state.jointFrac * (run[1] - run[0]);
      ctx.fillStyle = COLOR.slot;
      ctx.fillRect(toScreenX(ax - slotU / 2), toScreenY(run[1]), slotU * zoom, (run[1] - jy) * zoom);
    }
    ctx.restore();

    // Crossing line, full height so it can be grabbed anywhere.
    ctx.strokeStyle = COLOR.axis;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(toScreenX(ax), toScreenY(bounds[3]) - 26);
    ctx.lineTo(toScreenX(ax), toScreenY(bounds[1]) + 26);
    ctx.stroke();
    ctx.setLineDash([]);

    // Joint handle.
    if (run) {
      const jy = run[0] + state.jointFrac * (run[1] - run[0]);
      const hx = toScreenX(ax);
      const hy = toScreenY(jy);
      ctx.beginPath();
      ctx.arc(hx, hy, 8, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.axis;
      ctx.fill();
      ctx.strokeStyle = '#15171c';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Labels.
    ctx.fillStyle = COLOR.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(state.axisFrac * 100).toFixed(1)}%`, toScreenX(ax), toScreenY(bounds[3]) - 34);
    if (thin) {
      ctx.fillStyle = '#ef4444';
      ctx.fillText(
        `needs ${state.needMm.toFixed(1)} mm across here`,
        toScreenX(ax),
        toScreenY(bounds[1]) + 42,
      );
    }
    if (state.dropped.length) {
      ctx.fillStyle = COLOR.droppedLine;
      ctx.textAlign = 'left';
      ctx.fillText(`${state.dropped.length} piece(s) discarded`, 12, h - 12);
    }
  }

  /** Horizontal runs at a height — the transpose of runsAt. */
  function crossingsAtY(y: number): [number, number][] {
    const hits: { x: number; w: number }[] = [];
    for (const ring of state.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a[1] <= y === b[1] <= y) continue;
        const t = (y - a[1]) / (b[1] - a[1]);
        hits.push({ x: a[0] + t * (b[0] - a[0]), w: b[1] > a[1] ? -1 : 1 });
      }
    }
    hits.sort((p, q) => p.x - q.x);
    const out: [number, number][] = [];
    let wind = 0;
    let start = 0;
    for (const hit of hits) {
      const prev = wind;
      wind += hit.w;
      if (prev === 0 && wind !== 0) start = hit.x;
      else if (prev !== 0 && wind === 0 && hit.x > start) out.push([start, hit.x]);
    }
    return out;
  }

  function hitTest(sx: number, sy: number): 'axis' | 'joint' | null {
    const ax = axisX();
    const runs = runsAt(ax);
    if (runs.length) {
      const run = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const jy = run[0] + state.jointFrac * (run[1] - run[0]);
      if (Math.hypot(sx - toScreenX(ax), sy - toScreenY(jy)) < 14) return 'joint';
    }
    return Math.abs(sx - toScreenX(ax)) < 12 ? 'axis' : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (!dragging) {
      canvas.style.cursor = hitTest(sx, sy) ? (hitTest(sx, sy) === 'joint' ? 'ns-resize' : 'ew-resize') : 'default';
      return;
    }
    if (dragging === 'axis') {
      const frac = (toWorldX(sx) - bounds[0]) / (bounds[2] - bounds[0] || 1);
      axisCb(Math.max(0, Math.min(1, frac)));
    } else {
      const runs = runsAt(axisX());
      if (!runs.length) return;
      const run = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const frac = (toWorldY(sy) - run[0]) / (run[1] - run[0] || 1);
      jointCb(Math.max(0.15, Math.min(0.85, frac)));
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    dragging = hitTest(e.clientX - r.left, e.clientY - r.top);
    if (dragging) canvas.setPointerCapture(e.pointerId);
  });
  const stop = (): void => {
    dragging = null;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  function resize(): void {
    const r = root.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * devicePixelRatio);
    canvas.height = Math.max(1, r.height * devicePixelRatio);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  return {
    root,
    setState(next) {
      state = { ...state, ...next };
      draw();
    },
    onAxisChange(cb) {
      axisCb = cb;
    },
    onJointChange(cb) {
      jointCb = cb;
    },
    resize,
    dispose() {
      ro.disconnect();
      root.remove();
    },
  };
}
