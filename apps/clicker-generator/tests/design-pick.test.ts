/*
  What a press on the Design view takes (src/ui/designPick.ts), run through the kit canvas's own
  hit test, so the order (switch over picture over body) is the canvas's and not restated here.

   - A round body with a round picture over most of it and a switch in the middle. Before: the
     body was a 'border' object on its BOX, so a press had to land near a square that only touches
     a round body at four points, and the picture took its whole box. The share of the body's area
     that picks the body is measured both ways; after, every point of the body that is not on the
     picture's drawing or the switch picks the body.
   - The picture is taken inside the hull round its drawing, placed as the build places it (moved,
     scaled, turned), and not in the empty corners of its box.
   - On an Outline base the picture is the base: anywhere on the body takes it.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs design-pick
*/
import { hitObject, type Grabbable } from '../../../packages/ui-kit/src/components/design-canvas-math';
import { artHull, onArt, onBody, toArt } from '../src/ui/designPick.ts';
import type { Ring } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const circle = (cx: number, cy: number, r: number, n = 96): Ring =>
  Array.from({ length: n }, (_, k): [number, number] => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);
const inCircle = (x: number, y: number, r: number) => x * x + y * y < r * r;

type Obj = Grabbable & { id: string };
/** 6 px of band at 8 px a millimetre, the canvas's mouse band at a usual zoom. */
const BAND = 6 / 8;

/** The share of the body's area that picks each object, on a 0.25 mm grid. */
function shares(objects: Obj[], bodyR: number) {
  const n: Record<string, number> = {};
  let total = 0;
  for (let x = -bodyR; x <= bodyR; x += 0.25) {
    for (let y = -bodyR; y <= bodyR; y += 0.25) {
      if (!inCircle(x, y, bodyR - 0.3)) continue;
      total++;
      const id = hitObject(objects, x, y, BAND)?.id ?? 'nothing';
      n[id] = (n[id] ?? 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(n)) out[k] = v / total;
  return out;
}
const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(1)} %`;

// ---- a round body, a round picture over most of it, a switch in the middle
{
  const bodyR = 20;
  const body: Ring[] = [circle(0, 0, bodyR)];
  // The picture as the tracer hands it: normalised, longest side 1, a disc filling its box.
  const art = [{ rings: [circle(0, 0, 0.5)] }];
  const t = { s: 30, ox: 0, oy: 0, r: 0 };
  const switchBox = { cx: 0, cy: 0, w: 14, h: 14, rotation: 0 };
  const box = { cx: 0, cy: 0, w: 2 * bodyR, h: 2 * bodyR, rotation: 0 };
  const artBox = { cx: 0, cy: 0, w: 30, h: 30, rotation: 0 };

  const before: Obj[] = [
    { id: 'base', box, grab: 'border', z: 0 },
    { id: 'art', box: artBox, z: 1 },
    { id: 'switch:0', box: switchBox, z: 3 },
  ];
  const after: Obj[] = [
    { id: 'base', box, hit: onBody(body), z: 0 },
    { id: 'art', box: artBox, hit: onArt(artHull(art), t), z: 1 },
    { id: 'switch:0', box: switchBox, z: 3 },
  ];
  const b = shares(before, bodyR);
  const a = shares(after, bodyR);
  // The body showing round a 15 mm picture on a 20 mm body: 1 - 15² / 20², less the band kept off its edge.
  const showing = 1 - 15 ** 2 / (bodyR - 0.3) ** 2;
  check('before: almost none of the body picks the body', (b.base ?? 0) < 0.05, `body ${pct(b.base)}, picture ${pct(b.art)}, nothing ${pct(b.nothing)}`);
  check('after: all the body showing round the picture picks the body', Math.abs((a.base ?? 0) - showing) < 0.02 && !a.nothing,
    `body ${pct(a.base)} (showing ${pct(showing)}), picture ${pct(a.art)}, switch ${pct(a['switch:0'])}`);
  // Point by point: on the switch, the switch; on the picture, the picture; else the body.
  let wrong = 0;
  for (let x = -19; x <= 19; x += 0.5) {
    for (let y = -19; y <= 19; y += 0.5) {
      if (!inCircle(x, y, 19.5)) continue;
      const want = Math.abs(x) <= 7 && Math.abs(y) <= 7 ? 'switch:0' : inCircle(x, y, 14.9) ? 'art' : inCircle(x, y, 15.1) ? null : 'base';
      const got = hitObject(after, x, y, BAND)?.id;
      if (want && got !== want) wrong++;
    }
  }
  check('point by point: the switch over the picture over the body', wrong === 0, `${wrong} points picked the wrong thing`);
  check('off the body, nothing is picked', hitObject(after, 21, 21, BAND) === null && hitObject(after, 0, 20.6, BAND) === null,
    String(hitObject(after, 21, 21, BAND)?.id));
}

// ---- the picture: its drawing, placed, not its box
{
  // An L-shaped drawing: its hull leaves the box's top-right corner empty.
  const L: Ring = [[-0.5, -0.5], [0.5, -0.5], [0.5, -0.3], [-0.3, -0.3], [-0.3, 0.5], [-0.5, 0.5]];
  const hull = artHull([{ rings: [L] }]);
  const t = { s: 20, ox: 5, oy: -3, r: 30 };
  const on = onArt(hull, t);
  const place = ([x, y]: [number, number]): [number, number] => {
    const a = (t.r * Math.PI) / 180;
    return [t.ox + t.s * (x * Math.cos(a) - y * Math.sin(a)), t.oy + t.s * (x * Math.sin(a) + y * Math.cos(a))];
  };
  const back = toArt(t, ...place([0.2, -0.1]));
  check('a point placed and taken back lands where it was', Math.abs(back[0] - 0.2) < 1e-9 && Math.abs(back[1] + 0.1) < 1e-9, JSON.stringify(back));
  check('a press on the drawing, placed, takes the picture', on(...place([-0.4, 0.4])) && on(...place([0.4, -0.4])) && on(...place([-0.2, -0.2])),
    'three points of the L');
  check('a press in the empty corner of its box does not', !on(...place([0.4, 0.4])) && !on(...place([0.3, 0.3])), 'the corner the L leaves');
  check('a drawing with no area takes nothing', !onArt(artHull([{ rings: [[[0, 0], [1, 1]]] }]), t)(5, -3), 'a line');
}

// ---- an Outline base: the picture is the base
{
  const body: Ring[] = [circle(0, 0, 18)];
  const art = [{ rings: [circle(0, 0, 0.4)] }];
  const onPicture = onArt(artHull(art), { s: 30, ox: 0, oy: 0, r: 0 });
  const onShape = onBody(body);
  const objects: Obj[] = [{ id: 'art', box: { cx: 0, cy: 0, w: 30, h: 30, rotation: 0 }, hit: (x, y) => onShape(x, y) || onPicture(x, y), z: 1 }];
  const s = shares(objects, 18);
  check('Outline base: anywhere on the body takes the picture and base', Math.abs((s.art ?? 0) - 1) < 1e-9, `picture ${pct(s.art)}`);
}

// ---- a loop's hole is not the body
{
  const body: Ring[] = [circle(0, 0, 20), circle(0, 24, 2.6)];
  const outer: Ring = circle(0, 24, 5);
  const on = onBody([body[0], outer, body[1]]);
  check('the body with its loop: the tab is body, the loop\'s hole is not', on(0, 27.5) && !on(0, 24) && on(0, 0), 'tab / hole / middle');
}

if (failures) {
  console.error(`\ndesign-pick: ${failures} failed`);
  process.exit(1);
}
console.log('\ndesign-pick: all passed');
