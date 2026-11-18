/*
  cropBox(): its maths (src/components/crop-box-math.ts) in node, then the box in the stand-in
  document (support/mini-dom.ts). That has no layout, so a drag is driven with a measured size
  given to the box by hand; the rest is held to what needs none: its parts, names, keys, the
  phases it reports, its stylesheet, and that it writes no style attribute.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { CROP_GRIPS, FULL_CROP, clampCrop, dragCrop, nudgeCrop, sameCrop, type CropGrip, type CropRect } from '../src/components/crop-box-math';
import { cropBox } from '../src/components/crop-box';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const show = (v: unknown) => JSON.stringify(v);
const box = (x: number, y: number, w: number, h: number): CropRect => ({ x, y, w, h });
const inside = (b: CropRect) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-12 && b.y + b.h <= 1 + 1e-12;

/* ------------------------------------------------- dragCrop: each grip moves its own sides */

{
  const start = box(0.2, 0.2, 0.5, 0.5);
  const d = 0.1;
  // grip -> the box after pulling it (+d, +d): only the sides the grip names move.
  const want: Record<CropGrip, CropRect> = {
    nw: box(0.3, 0.3, 0.4, 0.4),
    n: box(0.2, 0.3, 0.5, 0.4),
    ne: box(0.2, 0.3, 0.6, 0.4),
    e: box(0.2, 0.2, 0.6, 0.5),
    se: box(0.2, 0.2, 0.6, 0.6),
    s: box(0.2, 0.2, 0.5, 0.6),
    sw: box(0.3, 0.2, 0.4, 0.6),
    w: box(0.3, 0.2, 0.4, 0.5),
    move: box(0.3, 0.3, 0.5, 0.5),
  };
  for (const g of [...CROP_GRIPS, 'move' as const]) {
    const got = dragCrop(start, g, d, d, 0.08);
    check(`drag ${g}: moves only the sides it holds`, sameCrop(got, want[g], 1e-12), show(got));
  }
  check('drag: the start box is not changed', sameCrop(start, box(0.2, 0.2, 0.5, 0.5)));
  check('grips: eight, in order round the box', CROP_GRIPS.join() === 'nw,n,ne,e,se,s,sw,w');
}

/* ------------------------------------------------- bounds, minimum, never inside out */

{
  const start = box(0.2, 0.2, 0.5, 0.5);
  const out = dragCrop(start, 'nw', -1, -1, 0.08);
  check('drag past the picture: stops at its edge', sameCrop(out, box(0, 0, 0.7, 0.7), 1e-12), show(out));
  const far = dragCrop(start, 'se', 5, 5, 0.08);
  check('drag past the far edge: stops there', sameCrop(far, box(0.2, 0.2, 0.8, 0.8), 1e-12), show(far));
  const flip = dragCrop(start, 'w', 2, 0, 0.08);
  check('an edge pulled past the other: stops at the minimum, never flips', Math.abs(flip.w - 0.08) < 1e-12 && Math.abs(flip.x + flip.w - 0.7) < 1e-12, show(flip));
  const flipUp = dragCrop(start, 's', 0, -2, 0.08);
  check('bottom pulled above the top: the minimum, the top stays', Math.abs(flipUp.h - 0.08) < 1e-12 && flipUp.y === 0.2, show(flipUp));
  const corner = dragCrop(start, 'ne', -3, 3, 0.08);
  check('a corner pulled through: both sides at the minimum', Math.abs(corner.w - 0.08) < 1e-12 && Math.abs(corner.h - 0.08) < 1e-12 && corner.x === 0.2, show(corner));
  const moved = dragCrop(start, 'move', 0.9, -0.9, 0.08);
  check('move: stops at the edges, keeps its size', sameCrop(moved, box(0.5, 0, 0.5, 0.5), 1e-12), show(moved));
  const small = box(0.4, 0.4, 0.05, 0.05);
  const smallDrag = dragCrop(small, 'e', -0.5, 0, 0.08);
  check('a box already under the minimum keeps its size, never jumps up', Math.abs(smallDrag.w - 0.05) < 1e-12, show(smallDrag));
  let worst = true;
  for (let i = 0; i < 400; i++) {
    const g = [...CROP_GRIPS, 'move' as const][i % 9]!;
    const b = dragCrop(box(0.1, 0.15, 0.6, 0.7), g, Math.sin(i) * 1.5, Math.cos(i * 1.3) * 1.5, 0.08);
    if (!inside(b) || b.w < 0.08 - 1e-12 || b.h < 0.08 - 1e-12) worst = false;
  }
  check('any pull: inside the picture and at least the minimum', worst);
  const back = dragCrop(start, 'se', 0, 0, 0.08);
  check('a pull of nothing gives the start back', sameCrop(back, start));
}

/* ------------------------------------------------- nudge, clamp */

{
  check('nudge: moves the whole box', sameCrop(nudgeCrop(box(0.1, 0.1, 0.5, 0.5), 0.01, -0.05), box(0.11, 0.05, 0.5, 0.5), 1e-12));
  check('nudge: stops at the edge', sameCrop(nudgeCrop(box(0, 0, 0.5, 0.5), -0.01, -0.01), box(0, 0, 0.5, 0.5)));
  check('clamp: junk is the whole picture', sameCrop(clampCrop({ x: NaN, y: 0, w: 1, h: 1 }), FULL_CROP));
  check('clamp: pulled inside the picture', sameCrop(clampCrop(box(0.8, -0.2, 0.5, 0.5)), box(0.5, 0, 0.5, 0.5)));
  check('clamp: a side longer than the picture is the picture', sameCrop(clampCrop(box(0, 0, 3, 0.5)), box(0, 0, 1, 0.5)));
  check('clamp: the minimum, when asked', sameCrop(clampCrop(box(0.5, 0.5, 0.01, 0.01), 0.08), box(0.5, 0.5, 0.08, 0.08)));
}

/* ------------------------------------------------- the box in a document */

const noStyleAttribute = (node: MiniElement): boolean =>
  !node.attributeNames.includes('style') && node.children.every((child) => noStyleAttribute(child));

{
  const said: { box: CropRect; phase: string }[] = [];
  const crop = cropBox({ label: 'Crop', value: box(0.1, 0.2, 0.5, 0.6), onChange: (b, phase) => said.push({ box: b, phase }) });
  const root = crop as unknown as MiniElement;
  miniDocument.body.replaceChildren(root);
  const frame = root.querySelector('.vl-crop-box__frame')!;
  const grips = root.querySelectorAll('.vl-crop-box__grip');

  check('box: eight grips inside the frame, in order round it', grips.length === 8 && grips.map((g) => g.getAttribute('data-grip')).join() === CROP_GRIPS.join() && grips.every((g) => g.parentNode === frame));
  check('box: four dimmed strips, hidden from a screen reader', root.querySelectorAll('.vl-crop-box__shade').length === 4 && root.querySelectorAll('.vl-crop-box__shade').every((s) => s.getAttribute('aria-hidden') === 'true'));
  check('box: the frame is named and focusable', frame.getAttribute('aria-label') === 'Crop' && frame.getAttribute('tabindex') === '0');
  check('grips: each has a name and takes the focus', grips.every((g) => !!g.getAttribute('aria-label') && g.getAttribute('tabindex') === '0') && grips[0]!.getAttribute('aria-label') === 'Top left corner' && grips[7]!.getAttribute('aria-label') === 'Left edge');
  check('box: placed in percent of the picture, through the CSSOM', frame.style.getPropertyValue('left') === '10%' && frame.style.getPropertyValue('top') === '20%' && frame.style.getPropertyValue('width') === '50%' && frame.style.getPropertyValue('height') === '60%', frame.style.cssText);
  const right = root.querySelector('.vl-crop-box__shade--right')!;
  check('dim: the right strip starts where the box ends', right.style.getPropertyValue('left') === '60%', right.style.cssText);
  check('box: no style attribute anywhere, which a strict style-src would refuse', noStyleAttribute(root));
  check('getValue: the box it was given', sameCrop(crop.getValue(), box(0.1, 0.2, 0.5, 0.6)));

  // Keys: the frame moves the box 1 % (Shift 5 %), a grip pulls its own side; one 'end' a press.
  const key = (node: MiniElement, k: string, shiftKey = false) => node.dispatchEvent({ type: 'keydown', key: k, shiftKey });
  key(frame, 'ArrowRight');
  check('arrow on the box: moves it 1 %, one end', said.length === 1 && said[0]!.phase === 'end' && sameCrop(said[0]!.box, box(0.11, 0.2, 0.5, 0.6), 1e-12), show(said));
  key(frame, 'ArrowUp', true);
  check('Shift+arrow: 5 %', said.length === 2 && sameCrop(said[1]!.box, box(0.11, 0.15, 0.5, 0.6), 1e-12), show(said[1]));
  key(grips[3]!, 'ArrowLeft');
  check('arrow on the right edge: pulls that edge only, one end', said.length === 3 && sameCrop(said[2]!.box, box(0.11, 0.15, 0.49, 0.6), 1e-12), show(said[2]));
  key(frame, 'Enter');
  check('another key: nothing', said.length === 3);
  crop.setValue(box(0, 0, 0.5, 0.5));
  check('setValue: shows the box and says nothing', said.length === 3 && sameCrop(crop.getValue(), box(0, 0, 0.5, 0.5)) && frame.style.getPropertyValue('left') === '0%');
  key(frame, 'ArrowLeft');
  check('arrow against the edge: no change, nothing said', said.length === 3);
  crop.setValue(null);
  check('setValue(null): the whole picture', sameCrop(crop.getValue(), FULL_CROP));

  // A drag: the box measures 400 x 200 on screen; live while it moves, one end on release.
  (root as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });
  said.length = 0;
  const ptr = (node: MiniElement, type: string, clientX: number, clientY: number) =>
    node.dispatchEvent({ type, pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY });
  ptr(grips[0]!, 'pointerdown', 0, 0);
  ptr(root, 'pointerup', 0, 0);
  check('a press that never moved: nothing said', said.length === 0);
  ptr(grips[0]!, 'pointerdown', 0, 0);
  ptr(root, 'pointermove', 40, 20);
  ptr(root, 'pointermove', 80, 40);
  check('dragging the top left corner: live, in fractions of the picture', said.length === 2 && said.every((s) => s.phase === 'live') && sameCrop(said[1]!.box, box(0.2, 0.2, 0.8, 0.8), 1e-12), show(said));
  ptr(root, 'pointerup', 80, 40);
  check('release: one end, with the last box', said.length === 3 && said[2]!.phase === 'end' && sameCrop(said[2]!.box, box(0.2, 0.2, 0.8, 0.8), 1e-12), show(said[2]));
  ptr(root, 'pointermove', 200, 100);
  check('after release the pointer moves nothing', said.length === 3);
  ptr(frame, 'pointerdown', 100, 100);
  ptr(root, 'pointermove', -400, 100);
  ptr(root, 'pointerup', -400, 100);
  check('dragging inside: the box moves and stops at the edge', sameCrop(crop.getValue(), box(0, 0.2, 0.8, 0.8), 1e-12) && said.at(-1)?.phase === 'end', show(crop.getValue()));
  said.length = 0;
  ptr(grips[4]!, 'pointerdown', 400, 200);
  ptr(root, 'pointermove', -400, -400);
  ptr(root, 'pointerup', -400, -400);
  check('a corner dragged through the box: stops at the minimum (8 %)', Math.abs(crop.getValue().w - 0.08) < 1e-12 && Math.abs(crop.getValue().h - 0.08) < 1e-12, show(crop.getValue()));

  const small = cropBox({ label: 'Crop', minFraction: 0.3 });
  check('no value: the whole picture', sameCrop(small.getValue(), FULL_CROP));
  check('default: a whole-picture box takes a press inside it (no pass class)', !(small as unknown as MiniElement).querySelector('.vl-crop-box__frame')!.classList.contains('vl-crop-box__frame--pass'));

  // passWhenFull: a press inside a box that is the whole picture is the app's (its pan).
  {
    const pass = cropBox({ label: 'Crop', passWhenFull: true });
    const host = miniDocument.createElement('div');
    let appPresses = 0;
    host.addEventListener('pointerdown', () => { appPresses++; });
    host.append(pass as unknown as MiniElement);
    miniDocument.body.replaceChildren(host);
    (pass as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });
    const pRoot = pass as unknown as MiniElement;
    const pFrame = pRoot.querySelector('.vl-crop-box__frame')!;
    const pGrips = pRoot.querySelectorAll('.vl-crop-box__grip');
    const pPtr = (node: MiniElement, type: string, clientX: number, clientY: number) =>
      node.dispatchEvent({ type, pointerId: 2, pointerType: 'mouse', button: 0, clientX, clientY });
    check('passWhenFull: the whole picture marks the frame as passing', pFrame.classList.contains('vl-crop-box__frame--pass'));
    pPtr(pFrame, 'pointerdown', 200, 100);
    pPtr(pRoot, 'pointermove', 100, 100);
    pPtr(pRoot, 'pointerup', 100, 100);
    check('passWhenFull: a press inside the whole box reaches the app and moves nothing', appPresses === 1 && sameCrop(pass.getValue(), FULL_CROP), show(pass.getValue()));
    pPtr(pGrips[0]!, 'pointerdown', 0, 0);
    pPtr(pRoot, 'pointermove', 40, 20);
    pPtr(pRoot, 'pointerup', 40, 20);
    check('passWhenFull: a grip still pulls, and its press stays the box\'s', appPresses === 1 && sameCrop(pass.getValue(), box(0.1, 0.1, 0.9, 0.9), 1e-12), show(pass.getValue()));
    check('passWhenFull: once smaller, the frame is a move handle again', !pFrame.classList.contains('vl-crop-box__frame--pass'));
    pPtr(pFrame, 'pointerdown', 200, 100);
    pPtr(pRoot, 'pointermove', 160, 80);
    pPtr(pRoot, 'pointerup', 160, 80);
    check('passWhenFull: a press inside the smaller box moves it and is not the app\'s', appPresses === 1 && sameCrop(pass.getValue(), box(0, 0, 0.9, 0.9), 1e-12), show(pass.getValue()));
    pass.setValue(null);
    check('passWhenFull: set back to the whole picture, it passes again', pFrame.classList.contains('vl-crop-box__frame--pass'));
    const pRules = kitRules();
    check('css: a passing frame shows the app\'s cursor, not a move cursor', cssValue(pFrame, 'cursor', pRules, 1280) !== 'move', cssValue(pFrame, 'cursor', pRules, 1280));
    miniDocument.body.replaceChildren(root);
  }

  // What the stylesheet makes of it.
  const rules = kitRules();
  const css = (node: MiniElement | null, prop: string) => (node ? cssValue(node, prop, rules, 1280) : '');
  check('css: fills the positioned box it is put in', css(root, 'position') === 'absolute' && ['top', 'right', 'bottom', 'left'].every((side) => css(root, side) === '0'));
  check('css: only the box and its grips take a press', css(root, 'pointer-events') === 'none' && css(frame, 'pointer-events') === 'auto' && css(grips[0]!, 'pointer-events') === 'auto');
  check('css: a drag on the box is never a page scroll', css(frame, 'touch-action') === 'none' && css(grips[0]!, 'touch-action') === 'none');
  check('css: grips keep their size when the picture is zoomed', css(grips[0]!, 'inline-size').includes('12px') && css(grips[0]!, 'inline-size').includes('/'), css(grips[0]!, 'inline-size'));
  check('css: the box is drawn in the accent', css(frame, 'border').includes('#'), css(frame, 'border'));
  check('css: the cursor says which way a grip pulls', css(grips[0]!, 'cursor') === 'nwse-resize' && css(grips[1]!, 'cursor') === 'ns-resize' && css(frame, 'cursor') === 'move');
  miniDocument.body.replaceChildren();
}

console.log(`\ncrop box: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
