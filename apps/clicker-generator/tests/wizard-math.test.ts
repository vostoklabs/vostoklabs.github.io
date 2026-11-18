/*
  Where a tap on the picture window's Result view lands (src/ui/wizardMath.ts): the traced rings
  are drawn on a square canvas shown with object-fit: contain, zoomed and panned, and a tap there
  has to find the pixel of the picture the rings came from. Checked on a real trace, with the
  frame the tracer reports, at two zooms; and the place an edit keeps points back at the pixel
  that was tapped, so the edit removes what was marked.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs wizard-math
*/
import { findColours, pictureAreaAt, prepareArtwork, processImage, type RgbaImage, type TraceFrame } from '@vostok/trace';
import { clientToPixel, containRect, pictureRect, pictureToCanvas, pixelOfFraction, resultScale, toFraction } from '../src/ui/wizardMath.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

{
  const r = containRect(400, 300, 1200, 1200);
  check('a square canvas in a wide box sits in the middle, full height', r.x === 50 && r.y === 0 && r.w === 300 && r.h === 300, JSON.stringify(r));
  const t = containRect(200, 500, 300, 100);
  check('a wide picture in a tall box sits in the middle, full width', t.x === 0 && Math.abs(t.y - 216.6667) < 1e-3 && t.w === 200 && Math.abs(t.h - 66.6667) < 1e-3, JSON.stringify(t));
  const z = containRect(0, 300, 10, 10);
  check('an empty box holds nothing', z.w === 0 && z.h === 0, JSON.stringify(z));
}

{
  // The formula the Result view always drew with, before it moved into wizardMath.
  const old = (aspect: number, w: number, h: number) => {
    const bw = aspect >= 1 ? 1 : aspect;
    const bh = aspect >= 1 ? 1 / aspect : 1;
    return 0.94 * Math.min(w / bw, h / bh);
  };
  const cases = [1, 2, 0.5, 1.37, 0.2];
  check('the drawing scale is the one the Result view used', cases.every((a) => resultScale({ aspect: a }, 1200, 1200) === old(a, 1200, 1200)),
    cases.map((a) => resultScale({ aspect: a }, 1200, 1200).toFixed(1)).join(', '));
  check('…and an aspect of 0 counts as square', resultScale({ aspect: 0 }, 1200, 1200) === old(1, 1200, 1200), String(resultScale({ aspect: 0 }, 1200, 1200)));
}

/** A white picture with a black block and a red disc beside it. */
function picture(): RgbaImage {
  const W = 300, H = 200;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (x >= 60 && x < 180 && y >= 40 && y < 140) { data[o] = 20; data[o + 1] = 20; data[o + 2] = 20; }
      else if (Math.hypot(x - 230, y - 90) < 25) { data[o] = 210; data[o + 1] = 30; data[o + 2] = 40; }
    }
  }
  return { data, width: W, height: H };
}
const copy = (img: RgbaImage): RgbaImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

const pic = picture();
let frame: TraceFrame | null = null;
const set = processImage(copy(pic), 2, { removeBg: true, smoothing: 0.1, designMm: 40, onFrame: (f) => { frame = f; } });
const f = frame as TraceFrame | null;
check('the tracer reports where the artwork sits', !!f && f.w === 195 && f.h === 100, JSON.stringify(f));

if (f) {
  // The traced outline, taken back to pixels with the frame, is where the block and disc were.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ring of set.outline) for (const [x, y] of ring) {
    const px = f.cx + x * f.side, py = f.cy - y * f.side;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  check('the traced outline, back in pixels, covers the block and the disc', Math.abs(minX - 60) <= 1.5 && Math.abs(maxX - 255) <= 1.5
    && Math.abs(minY - 40) <= 1.5 && Math.abs(maxY - 140) <= 1.5, `x ${minX.toFixed(1)}..${maxX.toFixed(1)}, y ${minY.toFixed(1)}..${maxY.toFixed(1)}`);

  // A pixel, drawn on the 1200 px canvas, shown in a 400 x 300 box (moved by a pan and a zoom),
  // and tapped at its centre: the same pixel comes back.
  const CW = 1200, CH = 1200;
  const scale = resultScale(set, CW, CH);
  const t = pictureToCanvas(f, scale, CW, CH);
  // The block's corners, the middles, and two pixels of the background near the canvas's corners.
  const pixels = [[60, 40], [179, 139], [120, 90], [230, 90], [55, 15], [258, 192]];
  for (const zoom of [1, 2.5]) {
    const rect = { left: 37 - 80 * (zoom - 1), top: 11 - 30 * (zoom - 1), width: 400 * zoom, height: 300 * zoom };
    const shown = containRect(rect.width, rect.height, CW, CH);
    const back = pixels.map(([px, py]) => {
      const X = t.k * (px + 0.5) + t.dx, Y = t.k * (py + 0.5) + t.dy;
      return clientToPixel(rect.left + shown.x + (X / CW) * shown.w, rect.top + shown.y + (Y / CH) * shown.h, rect, CW, CH, f, scale, pic);
    });
    check(`a tap at zoom ${zoom} finds the pixel it was drawn from`, back.every((b, i) => b?.px === pixels[i][0] && b?.py === pixels[i][1]),
      back.map((b) => (b ? `${b.px},${b.py}` : 'null')).join(' '));
  }
  // The drawn transform is the one the rings use: a ring point lands where its pixel is drawn.
  const ring = set.outline[0][0];
  const viaRing = [CW / 2 + ring[0] * scale, CH / 2 - ring[1] * scale];
  const viaPixel = [t.k * (f.cx + ring[0] * f.side) + t.dx, t.k * (f.cy - ring[1] * f.side) + t.dy];
  check('the mark is drawn under the rings, not beside them', Math.hypot(viaRing[0] - viaPixel[0], viaRing[1] - viaPixel[1]) < 1e-6,
    `${viaRing.map((v) => v.toFixed(3))} vs ${viaPixel.map((v) => v.toFixed(3))}`);
  const rect = { left: 0, top: 0, width: 400, height: 300 };
  // The picture runs on past the canvas's left edge here (its artwork is drawn to fit), so the
  // margin beside the canvas would still name a pixel.
  check('a tap beside the canvas finds nothing', clientToPixel(10, 150, rect, CW, CH, f, scale, pic) === null
    && clientToPixel(395, 5, rect, CW, CH, f, scale, pic) === null, 'left margin, top right corner');
  check('…nor a tap on the canvas above the picture', clientToPixel(200, 0.5, rect, CW, CH, f, scale, pic) === null, 'top edge');

  // The place an edit keeps is the pixel that was tapped, so Remove takes the disc it marked.
  const tap = clientToPixel(...((): [number, number] => {
    const shown = containRect(400, 300, CW, CH);
    const X = t.k * 230.5 + t.dx, Y = t.k * 90.5 + t.dy;
    return [shown.x + (X / CW) * shown.w, shown.y + (Y / CH) * shown.h];
  })(), rect, CW, CH, f, scale, pic);
  const at = tap ? toFraction(tap.px, tap.py, pic.width, pic.height) : null;
  const after = at ? processImage(copy(pic), 2, { removeBg: true, smoothing: 0.1, designMm: 40, edits: [{ op: 'remove', ...at }] }) : null;
  const red = (s: typeof set) => s.regions.filter((r) => r.quantRgb[0] > 150 && r.quantRgb[1] < 100).length;
  check('a tap on the disc, kept as a place and applied by the tracer, takes the disc and only it',
    !!after && red(set) === 1 && red(after) === 0 && after.regions.length === 1, `before ${set.regions.length} regions (${red(set)} red), after ${after?.regions.length} (${after ? red(after) : '-'} red)`);
}

{
  // Every pixel of a picture the tracer works at (1100 px) and of an odd small one survives the
  // round trip through the kept fraction, as the tracer reads it back.
  let bad = 0;
  for (const W of [1100, 7, 733]) {
    for (let px = 0; px < W; px++) {
      const { x } = toFraction(px, 0, W, 1);
      if (pixelOfFraction(x, 0, W, 1).px !== px || Math.min(W - 1, Math.max(0, Math.floor(x * W))) !== px) bad++;
    }
  }
  check('a kept place points back at the pixel it was made from', bad === 0, `${bad} pixels off`);
  const edge = toFraction(1099, 1099, 1100, 1100);
  check('…written with 5 decimals', edge.x === 0.99955 && String(edge.y).split('.')[1].length <= 5, JSON.stringify(edge));
}

{
  // The crop box is laid over the picture as the Original view draws it: the canvas sits inside
  // the stage's padding and shows the picture with object-fit: contain.
  const canvas = { left: 12, top: 12, width: 376, height: 276 };
  const r = pictureRect(canvas, pic.width, pic.height);
  check('the crop box sits exactly over the picture, inside the stage\'s padding',
    r.x === 12 && Math.abs(r.y - (12 + (276 - 376 * 200 / 300) / 2)) < 1e-9 && r.w === 376 && Math.abs(r.h - 376 * 200 / 300) < 1e-9, JSON.stringify(r));
  const tall = pictureRect(canvas, 100, 400);
  check('…and over a tall one, centred across', Math.abs(tall.x - (12 + (376 - 69) / 2)) < 1e-9 && tall.y === 12 && tall.h === 276 && Math.abs(tall.w - 69) < 1e-9,
    JSON.stringify(tall));
  // A corner of the box, a fraction of that rect, is the same fraction of the picture's pixels:
  // the box and the tracer's mask agree.
  const box = { x: 0.25, y: 0.4, w: 0.5, h: 0.35 };
  const corner = { x: r.x + box.x * r.w, y: r.y + box.y * r.h };
  const px = ((corner.x - r.x) / r.w) * pic.width;
  const py = ((corner.y - r.y) / r.h) * pic.height;
  check('…so a corner of the box over the picture is the pixel the crop starts at', Math.abs(px - 75) < 1e-9 && Math.abs(py - 80) < 1e-9,
    `${px.toFixed(3)}, ${py.toFixed(3)}`);
}

{
  // What lies outside the box is not traced, and its colours leave the list.
  const red = (s: { regions: { quantRgb: number[] }[] }) => s.regions.filter((r) => r.quantRgb[0] > 150 && r.quantRgb[1] < 100).length;
  const bounds = (s: typeof set, fr: TraceFrame) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ring of s.outline) for (const [x, y] of ring) {
      const px = fr.cx + x * fr.side, py = fr.cy - y * fr.side;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    return { minX, maxX, minY, maxY };
  };
  const trace = (crop: { x: number; y: number; w: number; h: number }) => {
    let fr: TraceFrame | null = null;
    const s = processImage(copy(pic), 2, { removeBg: true, smoothing: 0.1, designMm: 40, crop, onFrame: (v) => { fr = v; } });
    return { s, fr: fr as TraceFrame | null };
  };

  // Round the block only: the disc beside it is outside.
  const block = trace({ x: 0.15, y: 0.15, w: 0.5, h: 0.7 });
  check('a box round the block traces the block and not the disc beside it',
    !!block.fr && red(block.s) === 0 && block.s.regions.length === 1 && block.fr.w === 120 && block.fr.h === 100,
    `${block.s.regions.length} regions, ${red(block.s)} red, frame ${JSON.stringify(block.fr)}`);
  check('…and its colours leave the list', findColours(copy(pic), true, { crop: { x: 0.15, y: 0.15, w: 0.5, h: 0.7 } }).every((c) => !(c.rgb[0] > 150 && c.rgb[1] < 100))
    && findColours(copy(pic), true).some((c) => c.rgb[0] > 150 && c.rgb[1] < 100), 'red found without the crop, not with it');

  // Through the block: it is cut at the box's edge, and nothing is traced past it.
  const cut = { x: 0.4, y: 0, w: 0.5, h: 1 };
  const through = trace(cut);
  const b = through.fr ? bounds(through.s, through.fr) : null;
  check('a box through the block cuts it at the box\'s edge, and nothing is traced outside the box',
    !!b && Math.abs(b.minX - 120) <= 1.5 && b.maxX <= 270 + 1.5 && red(through.s) === 1,
    b ? `x ${b.minX.toFixed(1)}..${b.maxX.toFixed(1)}, ${red(through.s)} red` : 'no frame');

  // A tap outside the box finds nothing to mark: what is not traced cannot be taken out.
  const work = copy(pic);
  const { base } = prepareArtwork(work, { removeBg: true, crop: cut, forPicking: true });
  check('a tap outside the box marks nothing; inside it still does',
    pictureAreaAt(work, base!, 70, 90, cut) === null && (pictureAreaAt(work, base!, 150, 90, cut)?.count ?? 0) > 0, 'block left of the box, block inside it');
}

console.log(failures ? `\n${failures} FAILED` : '\nwizard-math: all checks passed');
process.exit(failures ? 1 : 0);
