/*
  The real Design view (src/ui/designView.ts) in the stand-in document, for what the app's state
  path relies on from it: the corner's range, and the Design size a move hands back.

   - The corner stops at Design size's own top, or at `designScaleMax` when the input gives one
     (a picture that keeps its size may run to HOLD_SCALE_MAX), and never under the floor.
   - An arrow-key move of a held picture hands back `roundShare` of the share it was drawn at,
     unchanged, which is the number mount.ts compares to tell a move from a resize, so a move
     never creeps the millimetres held.
   - The underside (the rail's Bottom category open): the bottom picture is the one thing on it,
     drawn where its place puts it, and a move hands back its place seen from below; the top's
     picture and switches are not there to pick.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs design-view
*/
import '../../../packages/ui-kit/tests/support/install-mini-dom';
import { artShare, createDesignView, type DesignEdit, type DesignInput } from '../src/ui/designView.ts';
import { HOLD_SCALE_MAX, holdScale, roundShare } from '../src/geometry/pictureHold.ts';
import { DESIGN_SCALE_MAX, DESIGN_SCALE_MIN } from '../src/geometry/sizeLimits.ts';
import type { Ring } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---- the corner's range
{
  const plain = { designScale: 1 };
  check('the corner stops at Design size\'s top without a designScaleMax', artShare(plain, 10) === DESIGN_SCALE_MAX, String(artShare(plain, 10)));
  check('...and at its floor', artShare(plain, 0.001) === DESIGN_SCALE_MIN, String(artShare(plain, 0.001)));
  const held = { designScale: 3, designScaleMax: HOLD_SCALE_MAX };
  check(`held: the corner runs past 200 % up to ${HOLD_SCALE_MAX * 100} %`, artShare(held, 2) === 6 && artShare(held, 100) === HOLD_SCALE_MAX,
    `${artShare(held, 2)}, ${artShare(held, 100)}`);
  const text = { designScale: 1, designScaleMin: 0.5 };
  check('a designScaleMin is the floor instead', artShare(text, 0.1) === 0.5, String(artShare(text, 0.1)));
}

// ---- a move of a held picture, through the real view and the kit's canvas
{
  const square = (h: number): Ring[] => [[[-h, -h], [h, -h], [h, h], [-h, h]]];
  const artMm = 52.37, fit = 30.6;
  const drawn = holdScale(artMm, fit);
  const input: DesignInput = {
    layout: {
      cap: square(17), imageArea: square(16), body: square(18), well: square(17.5),
      art: { scale: artMm, fit, offX: 0, offY: 0, rotation: 0 },
      switchBox: { loX: -5, hiX: 5, loY: -5, hiY: 5 },
      textureMm: 0,
    },
    builtDesignScale: drawn,
    builtCapWidthMm: 35,
    outlineBase: false,
    art: [{ rings: square(0.5), rgb: [200, 30, 30], coverage: 1 }],
    artBox: { w: 1, h: 1 },
    imageOffset: { x: 0, y: 0 },
    designScale: drawn,
    designScaleMax: HOLD_SCALE_MAX,
    designRotation: 0,
    capWidthMm: 35,
    words: [],
    switches: [{ x: 0, y: 0, rotation: 0 }],
    switchColumnMm: 14,
    keychain: { enabled: false, angleDeg: 90 },
    freeAspect: false,
    bodyRgb: [40, 40, 40],
    capRgb: [240, 240, 240],
    artBold: 0,
    wordBold: 0,
  };
  const edits: DesignEdit[] = [];
  const stage = document.createElement('div');
  const view = createDesignView({ stage, onEdit: (e) => edits.push(e), onSelect: () => {} });
  view.show(true);
  view.render(input);
  view.select('art');
  const root = stage.querySelector('.vl-design-canvas') ?? stage.firstElementChild?.querySelector('.vl-design-canvas');
  (root as unknown as { dispatchEvent(e: object): void } | null)?.dispatchEvent({ type: 'keydown', key: 'ArrowRight', shiftKey: false });
  const art = edits.find((e): e is Extract<DesignEdit, { kind: 'art' }> => e.kind === 'art');
  check('an arrow key on the picture is one art edit', !!art && edits.length === 1, JSON.stringify(edits));
  check(`it hands back the share it was drawn at, rounded, unchanged (${drawn.toFixed(4)} -> ${roundShare(drawn)})`,
    !!art && art.designScale === roundShare(drawn), String(art?.designScale));
  check('and the picture moved', !!art && art.offset.x > 0 && art.offset.y === 0, JSON.stringify(art?.offset));

  // ---- the underside, on the same view
  edits.length = 0;
  const place = { x: 1.5, y: -1, rotation: 20, scale: 1.2 };
  const under: DesignInput = {
    ...input,
    layout: { ...input.layout, bottom: { cx: 3, cy: -2, autoMm: 20, safe: square(15) } },
    underside: { art: [{ rings: square(0.5), rgb: [30, 30, 200], coverage: 1 }], artBox: { w: 1, h: 0.5 }, place },
  };
  view.render(under);
  const key = () => (root as unknown as { dispatchEvent(e: object): void } | null)?.dispatchEvent({ type: 'keydown', key: 'ArrowRight', shiftKey: false });
  view.select('art');
  key();
  view.select('switch:0');
  key();
  check('underside: the top\'s picture and switches are not there to move', edits.length === 0, JSON.stringify(edits));
  view.select('bottom');
  key();
  const bottom = edits.find((e): e is Extract<DesignEdit, { kind: 'bottom' }> => e.kind === 'bottom');
  check('underside: an arrow key on the bottom picture is one bottom edit, moved right as seen from below, its size and turn kept',
    !!bottom && edits.length === 1 && bottom.place.x > place.x && bottom.place.y === place.y && bottom.place.scale === place.scale && bottom.place.rotation === place.rotation,
    JSON.stringify(edits));
  view.destroy();
}

if (failures) {
  console.error(`\ndesign-view: ${failures} failed`);
  process.exit(1);
}
console.log('\ndesign-view: all passed');
