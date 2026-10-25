/*
  designCanvas(): its maths (src/components/design-canvas-math.ts) in node, then the canvas in the
  stand-in document (support/mini-dom.ts). That has no layout, so the canvas is held only to what
  needs none: its names, its keys, its API, its stylesheet, and that it writes no style attribute.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import {
  boxCorners,
  canvasBounds,
  canvasToModel,
  cornerCursor,
  fitView,
  grabs,
  handlesOf,
  hitHandle,
  hitObject,
  insideShape,
  modelToCanvas,
  normalizeDegrees,
  nudgeBox,
  outlineDistance,
  outlinePath,
  pillPosition,
  resizeBox,
  resizeView,
  rotationTowards,
  snapToGuides,
  zoomView,
  type Corner,
  type DesignBox,
  type View,
} from '../src/components/design-canvas-math';
import { designCanvas, type DesignObject } from '../src/components/design-canvas';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearPt = (p: [number, number], q: [number, number], eps = 1e-9) => near(p[0], q[0], eps) && near(p[1], q[1], eps);
const nearBox = (a: DesignBox, b: DesignBox, eps = 1e-9) =>
  near(a.cx, b.cx, eps) && near(a.cy, b.cy, eps) && near(a.w, b.w, eps) && near(a.h, b.h, eps) && near(a.rotation, b.rotation, eps);
const show = (v: unknown) => JSON.stringify(v);
const opposite = (c: Corner) => ((c + 2) % 4) as Corner;

/* ------------------------------------------------- the canvas and the model, y flipped */

{
  const view: View = { s: 4, ox: 200, oy: 150 };
  check('view: the model origin sits where the view puts it', nearPt(modelToCanvas(view, 0, 0), [200, 150]));
  check('view: +y in the model is up the canvas, a smaller canvas y', nearPt(modelToCanvas(view, 10, 5), [240, 130]));
  check('view: and back again', nearPt(canvasToModel(view, 240, 130), [10, 5]));
  let worst = 0;
  for (let i = 0; i < 50; i++) {
    const x = Math.sin(i) * 80;
    const y = Math.cos(i * 1.7) * 60;
    const [px, py] = modelToCanvas(view, x, y);
    const [bx, by] = canvasToModel(view, px, py);
    worst = Math.max(worst, Math.hypot(bx - x, by - y));
  }
  check('view: a round trip lands where it started', worst < 1e-9, String(worst));
}

/* ------------------------------------------------- fit, zoom, resize */

{
  const v = fitView({ minX: -25, minY: -25, maxX: 25, maxY: 25 }, 400, 300, 20);
  check('fit: the tighter side fills the canvas less its padding', near(v.s, 260 / 50), String(v.s));
  check('fit: the bounds are centred', nearPt(modelToCanvas(v, 0, 0), [200, 150]));
  check('fit: their top edge sits on the padding', near(modelToCanvas(v, 0, 25)[1], 20));
  const off = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 300, 200, 0);
  check('fit: bounds off the origin are centred too', near(off.s, 3) && nearPt(modelToCanvas(off, 50, 25), [150, 100]));
  check('fit: their corners land on the canvas', nearPt(modelToCanvas(off, 0, 50), [0, 25]) && nearPt(modelToCanvas(off, 100, 0), [300, 175]));
  const tiny = fitView({ minX: -5, minY: -5, maxX: 5, maxY: 5 }, 30, 30, 24);
  check('fit: a canvas smaller than its padding still shows all of it', near(tiny.s, 3) && nearPt(modelToCanvas(tiny, 5, 5), [30, 0]));

  const z0: View = { s: 2, ox: 100, oy: 100 };
  const z = zoomView(z0, 2, 160, 40);
  check('zoom: the scale is multiplied', near(z.s, 4));
  check('zoom: the point under the pointer stays under it', nearPt(canvasToModel(z, 160, 40), canvasToModel(z0, 160, 40)));
  const capped = zoomView(z0, 100, 30, 70, 1, 10);
  check('zoom: held at the most it may zoom in, the point still kept', near(capped.s, 10) && nearPt(canvasToModel(capped, 30, 70), canvasToModel(z0, 30, 70)));
  check('zoom: and at the least', near(zoomView(z0, 0.01, 0, 0, 1, 10).s, 1));
  const r = resizeView(z0, { w: 400, h: 300 }, { w: 600, h: 200 });
  check('resize: the point at the centre stays at the centre, at the same scale', near(r.s, 2) && nearPt(canvasToModel(r, 300, 100), canvasToModel(z0, 200, 150)));
}

/* ------------------------------------------------- handles on a turned box */

{
  const view: View = { s: 2, ox: 0, oy: 0 };
  const flat: DesignBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
  const h0 = handlesOf(view, flat, 22);
  check(
    'handles: corners bottom-left, bottom-right, top-right, top-left',
    nearPt(h0.corners[0], [-20, 10]) && nearPt(h0.corners[1], [20, 10]) && nearPt(h0.corners[2], [20, -10]) && nearPt(h0.corners[3], [-20, -10]),
    show(h0.corners),
  );
  check('handles: the grip is straight above the top edge, 22 px off it', nearPt(h0.stem, [0, -10]) && nearPt(h0.grip, [0, -32]));
  check('handles: still 22 px off it zoomed in', nearPt(handlesOf({ s: 8, ox: 0, oy: 0 }, flat, 22).grip, [0, -62]));

  // A quarter turn anticlockwise: the top faces -x, so the top-right corner is at model (5, 10).
  const h90 = handlesOf(view, { cx: 10, cy: 0, w: 20, h: 10, rotation: 90 }, 22);
  check('handles, 90°: the corners turn with the box', nearPt(h90.corners[2], [10, -20]) && nearPt(h90.corners[0], [30, 20]), show(h90.corners));
  check('handles, 90°: the grip is off the side the top faces', nearPt(h90.stem, [10, 0]) && nearPt(h90.grip, [-12, 0]), show(h90));

  const h30 = handlesOf(view, { cx: 3, cy: -4, w: 10, h: 6, rotation: 30 }, 22);
  const dir: [number, number] = [h30.grip[0] - h30.stem[0], h30.grip[1] - h30.stem[1]];
  const top: [number, number] = [h30.corners[2][0] - h30.corners[3][0], h30.corners[2][1] - h30.corners[3][1]];
  check('handles, 30°: the stem is 22 px whatever the turn', near(Math.hypot(...dir), 22));
  check('handles, 30°: and square to the top edge', near(top[0] * dir[0] + top[1] * dir[1], 0));
  const [cx, cy] = modelToCanvas(view, 3, -4);
  check('handles, 30°: pointing away from the centre', Math.hypot(h30.grip[0] - cx, h30.grip[1] - cy) > Math.hypot(h30.stem[0] - cx, h30.stem[1] - cy));
}

/* ------------------------------------------------- what a press is on */

{
  const bar: DesignBox = { cx: 0, cy: 0, w: 20, h: 4, rotation: 45 };
  check('inside a turned box: a point along its length', insideShape(bar, 5, 5));
  check('inside a turned box: not the same distance across it', !insideShape(bar, 5, -5));
  check('inside a turned box: not past its end', !insideShape(bar, 8, 8));
  const disc: DesignBox = { cx: 2, cy: 3, w: 10, h: 10, rotation: 0 };
  check("a 'circle' takes its middle", insideShape(disc, 2, 3, 'circle'));
  check("a 'circle' does not take its box's corner", insideShape(disc, 6.5, 7.5) && !insideShape(disc, 6.5, 7.5, 'circle'));
  const oval: DesignBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 90 };
  check('an ellipse turns with its box', insideShape(oval, 0, 9, 'circle') && !insideShape(oval, 9, 0, 'circle'));

  const sq: DesignBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
  check('outline distance: from the middle, to the nearest side', near(outlineDistance(sq, 0, 0), 5));
  check('outline distance: on a side, none', near(outlineDistance(sq, 10, 2), 0));
  check('outline distance: outside a side', near(outlineDistance(sq, 12, 0), 2));
  check('outline distance: outside a corner, to the corner', near(outlineDistance(sq, 13, 9), 5));

  const frame = { box: sq, grab: 'border' as const };
  check("'border': a press in the middle falls through", !grabs(frame, 0, 0, 1));
  check("'border': a press just inside the line takes it", grabs(frame, 9.4, 0, 1));
  check("'border': a press just outside it takes it", grabs(frame, 10.8, 0, 1));
  check("'border': a press past the band does not", !grabs(frame, 11.5, 0, 1));
  check("'border' on a turned box: the band turns with it", grabs({ ...frame, box: { ...sq, rotation: 90 } }, 0, 10, 0.5) && !grabs({ ...frame, box: { ...sq, rotation: 90 } }, 10, 0, 0.5));
  const ring = { box: { cx: 27, cy: 0, w: 8, h: 8, rotation: 0 }, grab: 'border' as const, shape: 'circle' as const };
  check("'border' on a circle: the band follows the circle, not its box", grabs(ring, 31.3, 0, 0.5) && !grabs(ring, 27, 0, 0.5) && !grabs(ring, 31, 4, 0.5));
}

{
  const picture = { id: 'picture', box: { cx: 0, cy: 0, w: 30, h: 30, rotation: 0 } };
  const part = { id: 'part', box: { cx: 0, cy: -2, w: 16, h: 16, rotation: 0 }, grab: 'border' as const, z: 1 };
  const base = { id: 'base', box: { cx: 0, cy: 0, w: 50, h: 50, rotation: 0 }, shape: 'circle' as const, z: -1 };
  const list = [base, picture, part];
  check('z: a press inside a border object reaches the picture under it', hitObject(list, 0, -2, 0.5)?.id === 'picture');
  check('z: a press on its border takes it, over the picture', hitObject(list, 8, -2, 0.5)?.id === 'part');
  check('z: past the picture, the base under both', hitObject(list, 20, 0, 0.5)?.id === 'base');
  check('z: on nothing, nothing', hitObject(list, 40, 40, 0.5) === null);
  const a = { id: 'a', box: picture.box };
  const b = { id: 'b', box: picture.box };
  check('z: of equal z, the one later in the list, drawn on top', hitObject([a, b], 0, 0, 0.5)?.id === 'b');
  check('z: a higher z wins from anywhere in the list', hitObject([{ ...a, z: 2 }, b], 0, 0, 0.5)?.id === 'a');
  const cat = { id: 'cat', box: picture.box, hit: (x: number, y: number) => Math.hypot(x, y) < 10 };
  check("hit: a press in a picture's box but off its silhouette reaches what is under it", hitObject([base, cat], 13, 13, 0.5)?.id === 'base' && hitObject([base, cat], 2, 2, 0.5)?.id === 'cat');
  check("hit: not read for a 'border' object", !grabs({ box: part.box, grab: 'border', hit: () => true }, 0, -2, 0.5));
}

{
  const view: View = { s: 4, ox: 200, oy: 200 };
  const box: DesignBox = { cx: 0, cy: 0, w: 20, h: 20, rotation: 0 };
  const spec = { resize: true, rotate: true, stemPx: 22, gripPx: 5.5, handlePx: 4.5, slopPx: 4 };
  const h = handlesOf(view, box, 22);
  check('handle: a press on the grip turns', hitHandle(view, box, spec, h.grip[0] + 3, h.grip[1])?.kind === 'rotate');
  const c = hitHandle(view, box, spec, h.corners[2][0] + 5, h.corners[2][1] - 5);
  check('handle: a press by a corner takes that corner', c?.kind === 'corner' && c.corner === 2, show(c));
  check('handle: a press in the middle takes none', hitHandle(view, box, spec, 200, 200) === null);
  check('handle: no corners on a box that does not resize', hitHandle(view, box, { ...spec, resize: false }, h.corners[2][0], h.corners[2][1]) === null);
  check('handle: no grip on a box that does not turn', hitHandle(view, box, { ...spec, rotate: false }, h.grip[0], h.grip[1]) === null);
  check(
    'handle: a finger reaches farther than a mouse',
    hitHandle(view, box, spec, h.corners[2][0] + 14, h.corners[2][1]) === null &&
      hitHandle(view, box, { ...spec, slopPx: 18 }, h.corners[2][0] + 14, h.corners[2][1])?.kind === 'corner',
  );
  const small: DesignBox = { cx: 0, cy: 0, w: 3, h: 3, rotation: 0 }; // 12 px across
  check('handle: on a box drawn small, its middle still moves it', hitHandle(view, small, { ...spec, rotate: false }, 202, 198) === null);
  check('handle: and its corner still resizes it', hitHandle(view, small, { ...spec, rotate: false }, 206, 194)?.kind === 'corner');
}

/* ------------------------------------------------- resize from a corner */

{
  const sq: DesignBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
  const free = resizeBox(sq, 2, 8, 6, false);
  check('resize, free: width and height follow the corner', nearBox(free, { cx: 1.5, cy: 0.5, w: 13, h: 11, rotation: 0 }), show(free));
  check('resize, free: the opposite corner stays put', nearPt(boxCorners(free)[0], [-5, -5]));
  const kept = resizeBox(sq, 2, 8, 6, true);
  check('resize, uniform or Shift: one scale for both, along the diagonal', nearBox(kept, { cx: 1, cy: 1, w: 12, h: 12, rotation: 0 }), show(kept));

  const wide: DesignBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
  const wideKept = resizeBox(wide, 1, 20, -10, true);
  check('resize, uniform: a 2:1 box stays 2:1', nearBox(wideKept, { cx: 5, cy: -2.5, w: 30, h: 15, rotation: 0 }), show(wideKept));
  check('resize, uniform: dragged by the bottom-right, the top-left stays put', nearPt(boxCorners(wideKept)[3], [-10, 5]));

  // A quarter turn: the box's own width runs up the model's y.
  const r90: DesignBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 90 };
  const out90 = resizeBox(r90, 2, -9, 14, false);
  check('resize, 90°: sizes measured along the box\'s own axes', nearBox(out90, { cx: -2, cy: 2, w: 24, h: 14, rotation: 90 }), show(out90));
  check('resize, 90°: the opposite corner stays put', nearPt(boxCorners(out90)[0], [5, -10]));

  const turned: DesignBox = { cx: 3, cy: -2, w: 16, h: 8, rotation: 30 };
  let drift = 0;
  let aspect = true;
  for (const corner of [0, 1, 2, 3] as const) {
    for (const keep of [false, true]) {
      for (const [x, y] of [[25, 17], [-14, 9], [0, -20], [6, 1]] as const) {
        const held = boxCorners(turned)[opposite(corner)];
        const out = resizeBox(turned, corner, x, y, keep);
        const now = boxCorners(out)[opposite(corner)];
        drift = Math.max(drift, Math.hypot(now[0] - held[0], now[1] - held[1]));
        if (keep && !near(out.w / out.h, 2)) aspect = false;
        if (out.rotation !== 30 || out.w < 1 - 1e-9 || out.h < 1 - 1e-9) aspect = false;
      }
    }
  }
  check('resize, 30°: whichever corner is dragged, wherever, its opposite stays put', drift < 1e-9, String(drift));
  check('resize, 30°: uniform keeps 2:1, the turn is kept, no side under 1 mm', aspect);

  const crushed = resizeBox(sq, 2, -20, -20, false);
  check('resize: a corner dragged past the opposite one stops at 1 mm, not inside out', near(crushed.w, 1) && near(crushed.h, 1) && nearPt(boxCorners(crushed)[0], [-5, -5]), show(crushed));
  const crushedU = resizeBox(sq, 2, -20, -20, true);
  check('resize, uniform: likewise, at 1 mm', near(crushedU.w, 1) && near(crushedU.h, 1) && nearPt(boxCorners(crushedU)[0], [-5, -5]));
  const minWide = resizeBox(wide, 2, -50, -50, true);
  check('resize, uniform: a 2:1 box stops at 2 x 1 mm, its short side at the minimum', near(minWide.w, 2) && near(minWide.h, 1), show(minWide));
}

/* ------------------------------------------------- turn, snap, nudge */

{
  const box: DesignBox = { cx: 5, cy: 5, w: 10, h: 10, rotation: 0 };
  check('turn: a pointer straight above the centre is 0°', near(rotationTowards(box, 5, 20, false), 0));
  check('turn: to its left is 90°, anticlockwise', near(rotationTowards(box, -5, 5, false), 90));
  check('turn: to its right is -90°', near(rotationTowards(box, 15, 5, false), -90));
  check('turn: below it is 180°, never -180°', rotationTowards(box, 5, -5, false) === 180);
  const at = (deg: number): [number, number] => [5 + 10 * Math.cos(((deg + 90) * Math.PI) / 180), 5 + 10 * Math.sin(((deg + 90) * Math.PI) / 180)];
  check('turn: any angle comes back as itself', near(rotationTowards(box, ...at(37), false), 37) && near(rotationTowards(box, ...at(-128.5), false), -128.5));
  check(
    'turn, Shift: snaps to 15°',
    near(rotationTowards(box, ...at(37), true), 30) && near(rotationTowards(box, ...at(38), true), 45) && near(rotationTowards(box, ...at(-97), true), -90),
  );
  check(
    'turn: angles brought into (-180, 180]',
    normalizeDegrees(270) === -90 && normalizeDegrees(-180) === 180 && normalizeDegrees(540) === 180 && Object.is(normalizeDegrees(-360), 0) && Object.is(normalizeDegrees(-0), 0),
  );

  const b: DesignBox = { cx: 1.2, cy: -0.4, w: 10, h: 10, rotation: 0 };
  const s = snapToGuides(b, { x: [0], y: [0] }, 1.5);
  check('snap: a centre within 1.5 mm of a guide lands on it', s.box.cx === 0 && s.box.cy === 0 && s.x === 0 && s.y === 0, show(s));
  const far = snapToGuides({ ...b, cx: 1.6 }, { x: [0], y: [] }, 1.5);
  check('snap: farther off it is left alone, and an axis with no lines snaps nothing', far.box.cx === 1.6 && far.x === null && far.box.cy === -0.4 && far.y === null);
  const two = snapToGuides({ ...b, cx: 0.7 }, { x: [0, 1] }, 1.5);
  check('snap: of two guides in reach, the nearer', two.box.cx === 1 && two.x === 1);
  check('snap: only the centre moves', two.box.w === 10 && two.box.h === 10 && two.box.rotation === 0);

  const n: DesignBox = { cx: 1, cy: 2, w: 5, h: 5, rotation: 10 };
  check('nudge: an arrow moves 0.5 mm', nearBox(nudgeBox(n, 'ArrowRight', false)!, { ...n, cx: 1.5 }) && nearBox(nudgeBox(n, 'ArrowLeft', false)!, { ...n, cx: 0.5 }));
  check('nudge: up is +y', nearBox(nudgeBox(n, 'ArrowUp', false)!, { ...n, cy: 2.5 }) && nearBox(nudgeBox(n, 'ArrowDown', false)!, { ...n, cy: 1.5 }));
  check('nudge, Shift: 5 mm', nearBox(nudgeBox(n, 'ArrowUp', true)!, { ...n, cy: 7 }) && nearBox(nudgeBox(n, 'ArrowLeft', true)!, { ...n, cx: -4 }));
  check('nudge: any other key, nothing', nudgeBox(n, 'a', false) === null && nudgeBox(n, 'Enter', true) === null);
}

/* ------------------------------------------------- drawing: outlines, the pill, cursors */

{
  const view: View = { s: 2, ox: 50, oy: 50 };
  const sq: DesignBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
  check('outline: a box is its four corners, closed', outlinePath(view, sq) === 'M40 60L60 60L60 40L40 40Z', outlinePath(view, sq));
  const circle = outlinePath(view, sq, 'circle');
  check('outline: a circle is two arcs through its sides', circle === 'M40 50A10 10 0 0 1 60 50A10 10 0 0 1 40 50Z', circle);
  const tilted = outlinePath(view, { cx: 0, cy: 0, w: 20, h: 10, rotation: 90 }, 'circle');
  check('outline: an ellipse turned 90° runs up and down', tilted.startsWith('M50 70A20 10 -90 0 1 50 30'), tilted);
  const b = canvasBounds(view, { cx: 0, cy: 0, w: 10, h: 10, rotation: 45 });
  check('bounds: a turned box reaches out to its diagonal', near(b.maxX - b.minX, 20 * Math.SQRT2) && near(b.maxY - b.minY, 20 * Math.SQRT2));
  const e = canvasBounds(view, { cx: 0, cy: 0, w: 20, h: 10, rotation: 90 }, 'circle');
  check('bounds: a turned ellipse swaps its extents', near(e.maxX - e.minX, 20) && near(e.maxY - e.minY, 40));

  const canvas = { w: 400, h: 300 };
  const pill = { w: 80, h: 20 };
  check('pill: right of the corner, centred on the bottom edge', nearPt(pillPosition({ minX: 100, minY: 100, maxX: 200, maxY: 180 }, pill, canvas), [208, 170]));
  check('pill: on the left when the right has no room', nearPt(pillPosition({ minX: 250, minY: 100, maxX: 350, maxY: 180 }, pill, canvas), [162, 170]));
  check('pill: never off the bottom of the canvas', pillPosition({ minX: 100, minY: 200, maxX: 200, maxY: 299 }, pill, canvas)[1] === 276);

  check('cursor: top-right and bottom-left share a diagonal', cornerCursor(sq, 2) === 'nesw' && cornerCursor(sq, 0) === 'nesw');
  check('cursor: bottom-right and top-left the other', cornerCursor(sq, 1) === 'nwse' && cornerCursor(sq, 3) === 'nwse');
  check('cursor: a quarter turn swaps them', cornerCursor({ ...sq, rotation: 90 }, 2) === 'nwse');
}

/* ------------------------------------------------- the canvas, in the stand-in document */

const noStyleAttribute = (node: MiniElement): boolean =>
  !node.attributeNames.includes('style') && node.children.every((child) => noStyleAttribute(child));

{
  const said: string[] = [];
  const changes: { id: string; box: DesignBox; phase: string; kind: string }[] = [];
  const canvas = designCanvas({
    label: 'Design',
    onSelect: (id) => said.push(`select ${id}`),
    onChange: (id, box, phase, kind) => changes.push({ id, box, phase, kind }),
    onDelete: (id) => said.push(`delete ${id}`),
    constrain: (id, box) => (id === 'pic' ? { ...box, cx: Math.min(box.cx, 0.3) } : box),
    pill: (id, box) => `${id} ${box.cx.toFixed(1)} ${box.cy.toFixed(1)}`,
    onZoom: (zoom) => said.push(`zoom ${zoom}`),
  });
  const root = canvas.root as unknown as MiniElement;
  miniDocument.body.replaceChildren(root);
  const objects: DesignObject[] = [
    { id: 'pic', label: 'Picture', box: { cx: 0, cy: 0, w: 20, h: 20, rotation: 0 }, resize: 'uniform', rotate: true },
    { id: 'ring', label: 'Ring', box: { cx: 27, cy: 0, w: 8, h: 8, rotation: 0 }, shape: 'circle', move: false },
    { id: 'words', label: 'Words: MILO', box: { cx: 0, cy: -15, w: 20, h: 6, rotation: 0 }, deletable: true },
  ];
  canvas.setObjects(objects);

  check('canvas: an application to a screen reader, with its name', root.getAttribute('role') === 'application' && root.getAttribute('aria-label') === 'Design');
  check('canvas: focusable, but not a Tab stop of its own', root.getAttribute('tabindex') === '-1');
  const twins = () => root.querySelectorAll('.vl-design-canvas__proxy');
  check(
    'canvas: one focusable twin per object, in list order, named by its label',
    twins().length === 3 &&
      twins().map((p) => p.getAttribute('aria-label')).join('|') === 'Picture|Ring|Words: MILO' &&
      twins().every((p) => p.getAttribute('tabindex') === '0' && p.getAttribute('role') === 'button'),
  );
  const about = (p: MiniElement | undefined) =>
    (p?.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => root.querySelector(`#${id}`)?.textContent).join(' ');
  check(
    'canvas: what each can do is read after its name',
    about(twins()[0]) === 'Arrow keys move it.' && about(twins()[1]) === '' && about(twins()[2]) === 'Arrow keys move it. Delete removes it.',
    [0, 1, 2].map((i) => about(twins()[i])).join(' / '),
  );
  check('canvas: the app draws into a group of its own', !!canvas.content && (canvas.content as unknown as MiniElement).localName === 'g');

  canvas.select('pic');
  check('select(): fires nothing', said.length === 0 && canvas.selected() === 'pic');
  check('select(): the selection is drawn', root.querySelector('.vl-design-canvas__outline')?.getAttribute('display') === null);
  const handles = root.querySelectorAll('.vl-design-canvas__handle');
  check('select(): corners for a box that resizes, and the grip for one that turns', handles.length === 4 && handles.every((h) => h.getAttribute('display') === null) && root.querySelector('.vl-design-canvas__grip')?.getAttribute('display') === null);
  const pill = root.querySelector('.vl-design-canvas__pill');
  check('pill: shows the value the app gives it', !!pill && !pill.hidden && pill.textContent === 'pic 0.0 0.0', pill?.textContent);
  check('canvas: no style attribute anywhere, which a strict style-src would refuse', noStyleAttribute(root));

  const key = (k: string, shiftKey = false) => root.dispatchEvent({ type: 'keydown', key: k, shiftKey });
  key('ArrowRight');
  check(
    'arrow: one nudge, one end, through constrain',
    changes.length === 1 && changes[0]!.id === 'pic' && changes[0]!.phase === 'end' && changes[0]!.kind === 'nudge' && near(changes[0]!.box.cx, 0.3),
    show(changes),
  );
  check('arrow: the new value is said', root.querySelector('.vl-design-canvas__said')?.textContent === 'pic 0.3 0.0');
  check('arrow: and drawn in the pill', pill?.textContent === 'pic 0.3 0.0');
  key('ArrowUp', true);
  check('Shift+arrow: 5 mm up, from where the last nudge left it', changes.length === 2 && near(changes[1]!.box.cy, 5) && near(changes[1]!.box.cx, 0.3), show(changes[1]));
  key('Delete');
  check('Delete: nothing for an object that is not deletable', !said.some((s) => s.startsWith('delete')));
  canvas.select('ring');
  key('ArrowLeft');
  check('arrow: nothing for an object that does not move', changes.length === 2);
  check('select(): no corners or grip for one that neither resizes nor turns', handles.every((h) => h.getAttribute('display') === 'none') && root.querySelector('.vl-design-canvas__grip')?.getAttribute('display') === 'none');
  canvas.select('words');
  key('Backspace');
  check('Backspace: a deletable object is removed by asking the app', said.join() === 'delete words');
  said.length = 0;
  key('Escape');
  check('Esc: lets go, and says so', canvas.selected() === null && said.join() === 'select null');
  said.length = 0;
  key('ArrowRight');
  check('arrow with nothing selected: nothing', changes.length === 2);
  twins()[1]!.dispatchEvent({ type: 'focus' });
  check("focus on an object's twin picks it", canvas.selected() === 'ring' && said.join() === 'select ring');
  said.length = 0;

  canvas.setObjects(objects.filter((o) => o.id !== 'ring'));
  check('setObjects without the selected object: the selection goes, silently', canvas.selected() === null && said.length === 0);
  check('setObjects: its twin goes with it', twins().length === 2);
  canvas.select('pic');
  canvas.setObjects(objects);
  check('setObjects: the selection is kept by id', canvas.selected() === 'pic');
  check('setObjects: the twins follow the list order', twins().map((p) => p.getAttribute('aria-label')).join('|') === 'Picture|Ring|Words: MILO');
  canvas.select('nothing-here');
  check('select(): an id it does not have selects nothing', canvas.selected() === null);

  canvas.fit({ minX: -30, minY: -30, maxX: 30, maxY: 30 });
  check('fit: zoom 1, said to onZoom', canvas.zoom() === 1 && said.join() === 'zoom 1');
  // panBy: the drawing moves (dx, dy) mm on screen, +y up, at the scale it is drawn at; no zoom.
  const worldOf = () => (root.querySelector('.vl-design-canvas__svg > g') as MiniElement | null)?.getAttribute('transform') ?? '';
  const matrix = () => (worldOf().match(/-?[\d.]+/g) ?? []).map(Number);
  const [s0, , , , ox0, oy0] = matrix();
  canvas.panBy(10, 5);
  const [s1, , , , ox1, oy1] = matrix();
  check('panBy: the drawing moves right and up by the millimetres asked, at once, at the same zoom',
    s1 === s0 && near(ox1 - ox0, 10 * s0) && near(oy1 - oy0, -5 * s0) && canvas.zoom() === 1, `${worldOf()}, from ox ${ox0} oy ${oy0}`);

  const rules = kitRules();
  const css = (node: MiniElement | null, prop: string) => (node ? cssValue(node, prop, rules, 1280) : '');
  check('css: the canvas takes every gesture: no page scroll or browser pinch under it', css(root, 'touch-action') === 'none');
  check('css: it fills the positioned box it is put in', css(root, 'position') === 'absolute' && ['top', 'right', 'bottom', 'left'].every((side) => css(root, side) === '0'));
  check('css: nothing drawn over the picture takes a press', css(root.querySelector('.vl-design-canvas__overlay'), 'pointer-events') === 'none' && css(root.querySelector('.vl-design-canvas__proxies'), 'pointer-events') === 'none');
  const accent = css(root.querySelector('.vl-design-canvas__pill'), 'background');
  check('css: the selection and the pill are drawn in the one accent', accent.startsWith('#') && css(root.querySelector('.vl-design-canvas__outline'), 'stroke') === accent, accent);
  const hint = root.querySelector('.vl-design-canvas__hint');
  check('css: the words for a screen reader are not drawn', css(hint, 'position') === 'absolute' && css(hint, 'clip-path') === 'inset(50%)');

  const parent = root.parentNode;
  canvas.destroy();
  check('destroy: the canvas leaves the page', !!parent && !parent.contains(root));
}

console.log(`\ndesign canvas: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
