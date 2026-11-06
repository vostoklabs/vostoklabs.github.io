/*
  A big picture is resized without a web worker.

  `drawToImageData` hands anything over the working size to pica. pica starts its worker from a
  `blob:` URL, and a page whose CSP says `worker-src 'self'` (the policy our hosted builds
  declare) refuses that worker. The browser reports the refusal only as an error event on the
  worker, so the worker is created, never answers, and a resize that waits on it never settles:
  an upload sat on "Reading image…" for good, with nothing in the status to say why.

  The stand-in below is that refused worker: it can be constructed and it never replies. Pinned:
   - a 2400 × 1800 picture comes back at 1100 × 825 within a few seconds;
   - no worker was started at all;
   - the pixels are the picture's (red on the left, blue on the right), not a blank canvas.

  The canvas is faked in plain arrays (node has none). pica recognises a canvas by its
  constructor's name, hence the class name.

    pnpm --filter @vostok/trace test
*/

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

interface FakeImageData { width: number; height: number; data: Uint8ClampedArray }

class Ctx2D {
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  globalCompositeOperation = 'source-over';
  constructor(private readonly canvas: HTMLCanvasElement) {}
  createImageData(width: number, height: number): FakeImageData {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  getImageData(x: number, y: number, width: number, height: number): FakeImageData {
    const out = this.createImageData(width, height);
    const W = this.canvas.width;
    for (let r = 0; r < height; r++) {
      const from = ((y + r) * W + x) * 4;
      out.data.set(this.canvas.px.subarray(from, from + width * 4), r * width * 4);
    }
    return out;
  }
  /** The dirty rectangle is clipped to the image and to the canvas, as a browser does. */
  putImageData(img: FakeImageData, x: number, y: number, dx = 0, dy = 0, dw = img.width, dh = img.height): void {
    const { width: W, height: H } = this.canvas;
    const c0 = Math.max(0, Math.round(dx), -x);
    const c1 = Math.min(img.width, Math.round(dx + dw), W - x);
    const r0 = Math.max(0, Math.round(dy), -y);
    const r1 = Math.min(img.height, Math.round(dy + dh), H - y);
    for (let r = r0; r < r1; r++) {
      const from = (r * img.width + c0) * 4;
      this.canvas.px.set(img.data.subarray(from, (r * img.width + c1) * 4), ((y + r) * W + x + c0) * 4);
    }
  }
  clearRect(): void {
    this.canvas.px.fill(0);
  }
  drawImage(src: HTMLCanvasElement, ...at: number[]): void {
    // decode.ts draws its source 1:1 at the origin; anything else is not faked.
    if (at.length !== 2 || at[0] !== 0 || at[1] !== 0 || src.width !== this.canvas.width || src.height !== this.canvas.height) {
      throw new Error(`fake canvas: drawImage(${at.join(', ')}) is not faked`);
    }
    this.canvas.px.set(src.px);
  }
}

class HTMLCanvasElement {
  px = new Uint8ClampedArray(0);
  private w = 0;
  private h = 0;
  private readonly ctx = new Ctx2D(this);
  get width() { return this.w; }
  set width(v: number) { this.w = v; this.px = new Uint8ClampedArray(this.w * this.h * 4); }
  get height() { return this.h; }
  set height(v: number) { this.h = v; this.px = new Uint8ClampedArray(this.w * this.h * 4); }
  getContext(): Ctx2D { return this.ctx; }
}

let workersStarted = 0;
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`fake document: <${tag}> is not faked`);
    return new HTMLCanvasElement();
  },
};
// A worker the page's CSP refused: constructing it succeeds, and it never replies.
g.Worker = class RefusedWorker {
  constructor() { workersStarted++; }
  postMessage() {}
  terminate() {}
};

// After the globals: pica reads them as it loads.
const { drawToImageData } = await import('../src/decode');

const SRC_W = 2400;
const SRC_H = 1800;
const picture = new HTMLCanvasElement();
picture.width = SRC_W;
picture.height = SRC_H;
for (let y = 0; y < SRC_H; y++) {
  for (let x = 0; x < SRC_W; x++) {
    const i = (y * SRC_W + x) * 4;
    const left = x < SRC_W / 2;
    picture.px[i] = left ? 220 : 20;
    picture.px[i + 1] = 30;
    picture.px[i + 2] = left ? 40 : 210;
    picture.px[i + 3] = 255;
  }
}

const LIMIT_MS = 10_000;
const started = Date.now();
const result = await Promise.race([
  drawToImageData(picture as unknown as CanvasImageSource, SRC_W, SRC_H, 1100),
  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), LIMIT_MS)),
]);
const ms = Date.now() - started;

check(
  'a picture over the working size is resized, with workers refused',
  result !== 'timeout' && result.width === 1100 && result.height === 825,
  result === 'timeout' ? `still waiting after ${LIMIT_MS} ms` : `${SRC_W}×${SRC_H} -> ${result.width}×${result.height} in ${ms} ms`,
);
check('no worker is started', workersStarted === 0, `${workersStarted} started`);
if (result !== 'timeout') {
  const at = (x: number, y: number) => Array.from(result.data.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 4));
  const l = at(200, 400);
  const r = at(900, 400);
  check(
    'the resized pixels are the picture',
    l[0] > 200 && l[2] < 60 && r[0] < 40 && r[2] > 190 && l[3] === 255 && r[3] === 255,
    `left ${JSON.stringify(l)}, right ${JSON.stringify(r)}`,
  );
}

console.log(failures ? `\n${failures} FAILED` : '\na big picture is resized on the page, with no worker to wait for');
process.exit(failures ? 1 : 0);
