// Headless check of the pure-2D outline maths, importing the TypeScript directly —
// Node 24 strips types natively, and the module is deliberately free of manifold and DOM
// so this works with no build step.
import { pathToFileURL } from 'node:url';

// Defaults to the sibling module. Resolve to a URL directly rather than via `pathname`:
// on Windows a file URL's pathname keeps a leading slash (`/C:/…`), which `pathToFileURL`
// then re-encodes into something that does not exist.
const target = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('./outlines.ts', import.meta.url).href;
const m = await import(target);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

console.log('roundedRect');
{
  const r = m.roundedRect(100, 40, 6);
  const b = m.bboxOf([r]);
  ok('spans the requested width', Math.abs((b.maxX - b.minX) - 100) < 0.01, `${b.maxX - b.minX}`);
  ok('spans the requested height', Math.abs((b.maxY - b.minY) - 40) < 0.01, `${b.maxY - b.minY}`);
  ok('is counter-clockwise', m.signedArea(r) > 0, `${m.signedArea(r)}`);
  ok('is centred on the origin', Math.abs(b.minX + b.maxX) < 0.01 && Math.abs(b.minY + b.maxY) < 0.01);

  const big = m.roundedRect(100, 40, 999);
  const bb = m.bboxOf([big]);
  ok('clamps an oversized radius to a pill', Math.abs((bb.maxY - bb.minY) - 40) < 0.01, `${bb.maxY - bb.minY}`);
  ok('oversized radius stays CCW', m.signedArea(big) > 0);
  ok('oversized radius spans full width', Math.abs((bb.maxX - bb.minX) - 100) < 0.01, `${bb.maxX - bb.minX}`);

  const sq = m.roundedRect(20, 20, 0);
  ok('zero radius gives 4 points', sq.length === 4, `${sq.length}`);
}

console.log('plaque');
{
  const p = m.plaque(80, 40, 8);
  const b = m.bboxOf([p]);
  ok('spans width', Math.abs((b.maxX - b.minX) - 80) < 0.01);
  ok('has 8 corners', p.length === 8, `${p.length}`);
  ok('is CCW', m.signedArea(p) > 0);
  const expected = 80 * 40 - 4 * (8 * 8 / 2);
  ok('area = rect minus four corner triangles', Math.abs(m.signedArea(p) - expected) < 0.5,
     `${m.signedArea(p)} vs ${expected}`);
}

console.log('plateOutline');
{
  ok('none emits nothing', m.plateOutline('none', 100, 40, 6).length === 0);
  for (const shape of ['rounded', 'rect', 'pill', 'plaque']) {
    const s = m.plateOutline(shape, 100, 40, 6);
    ok(`${shape} is one CCW loop`, s.length === 1 && m.signedArea(s[0]) > 0);
  }
}

console.log('screw holes');
{
  const holes = m.screwHoles(120, 40, 4.5, 12);
  ok('two holes', holes.length === 2, `${holes.length}`);
  const b = m.bboxOf(holes);
  ok('stay inside the plate', b.minX > -60 && b.maxX < 60, `${b.minX}..${b.maxX}`);
  ok('are symmetric about the centre', Math.abs(b.minX + b.maxX) < 0.01);
  ok('all loops CCW', holes.every((h) => m.signedArea(h) > 0));

  const tight = m.screwHoles(10, 40, 4.5, 12);
  ok('drops holes when the plate is too narrow', tight.length === 0, `${tight.length}`);

  // The clamp must keep a real wall between hole and edge at every inset.
  for (const inset of [0.1, 5, 12, 40, 500]) {
    const hs = m.screwHolePositions(120, 40, 4.5, inset);
    if (hs.length === 0) continue;
    const edge = 60 - (Math.abs(hs[0][0]) + 4.5 / 2);
    ok(`inset ${inset} keeps a wall`, edge >= 4.5 * 0.75 - 0.01, `wall ${edge.toFixed(2)}`);
  }
}

console.log('keyhole');
{
  /*
   * These assertions replace ones that pinned the old, broken shape — including
   * "neck runs downward", which was the bug written down as a requirement.
   *
   * A keyhole works because the sign FALLS onto a fixed screw, which means the screw travels
   * *upward* through the sign's own frame. So the wide entry is at the bottom and the narrow
   * slot runs up from it. And it has to be an undercut — a head-width chamber behind a
   * shank-width mouth — or the head simply jams against the slot and cannot slide at all.
   */
  const k = m.keyhole(0, 0, 12, 5, 10);
  ok('mouth and chamber', k.mouth.length === 2 && k.chamber.length === 2);
  ok('every loop CCW', [...k.mouth, ...k.chamber].every((l) => m.signedArea(l) > 0));

  const mouthBox = m.bboxOf(k.mouth);
  ok('the slot runs UPWARD from the entry', mouthBox.maxY > 9 && mouthBox.minY > -6.5,
     `minY ${mouthBox.minY.toFixed(1)} maxY ${mouthBox.maxY.toFixed(1)}`);
  ok('the screw comes to rest above the entry', k.restsAt[1] > 0, `${k.restsAt}`);

  // The mouth is what stops the head coming back out, so away from the entry circle it must
  // be narrower than the head. Measured above the entry, clear of it.
  const slotOnly = k.mouth[1];
  const highPoints = slotOnly.filter((p) => p[1] > 7);
  const slotWidth = Math.max(...highPoints.map((p) => p[0])) - Math.min(...highPoints.map((p) => p[0]));
  ok('the mouth is narrower than the head', slotWidth < 12 - 1, `slot ${slotWidth.toFixed(1)} vs head 12`);

  // ...and the chamber behind it must be head-width for the whole travel, or the head has
  // nowhere to slide. This is the half that was missing entirely.
  const chamberSlot = k.chamber[1];
  const chamberHigh = chamberSlot.filter((p) => p[1] > 7);
  const chamberWidth = Math.max(...chamberHigh.map((p) => p[0])) - Math.min(...chamberHigh.map((p) => p[0]));
  ok('the chamber is head-width so the head can slide', chamberWidth > slotWidth + 3,
     `chamber ${chamberWidth.toFixed(1)} vs mouth ${slotWidth.toFixed(1)}`);

  // A mouth wider than the head would let the sign fall straight back off.
  const silly = m.keyhole(0, 0, 12, 999, 10);
  const sillyHigh = silly.mouth[1].filter((p) => p[1] > 7);
  const sillyWidth = Math.max(...sillyHigh.map((p) => p[0])) - Math.min(...sillyHigh.map((p) => p[0]));
  ok('the mouth is clamped below the head diameter', sillyWidth < 12, `${sillyWidth.toFixed(1)}`);
}

console.log('plateSizeFor');
{
  const s = m.plateSizeFor({ minX: -30, maxX: 30, minY: -10, maxY: 10 }, 12);
  ok('adds padding on both sides', Math.abs(s.width - 84) < 0.01 && Math.abs(s.height - 44) < 0.01,
     `${s.width}x${s.height}`);
  const z = m.plateSizeFor({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 0);
  ok('never returns a zero dimension', z.width > 0 && z.height > 0);
}

/*
 * The check that was missing, and the reason a pill shipped with the text hanging off it.
 *
 * "Adds padding on both sides" is a claim about arithmetic, not about the model: it passed
 * for every shape while `plateOutline` cut the corners straight back off again. What a
 * margin actually promises is that the text sits inside the *outline* with that much room
 * everywhere — so that is what this measures, by walking the returned outline.
 */
console.log('the margin holds on every shape');
{
  /** Distance from a point to a closed polygon; negative outside it. */
  const signedDist = (poly, x, y) => {
    let inside = false, best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi, dy = yj - yi;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
    }
    return inside ? best : -best;
  };

  // A rectangle of text centred on the origin, exactly as buildSign centres the real thing.
  const cases = [
    { shape: 'rect', tw: 60, th: 20, c: 10, r: 0 },
    { shape: 'rounded', tw: 60, th: 20, c: 10, r: 6 },
    { shape: 'rounded', tw: 60, th: 20, c: 4, r: 40 },   // radius far larger than the margin
    { shape: 'pill', tw: 60, th: 20, c: 10, r: 0 },
    { shape: 'pill', tw: 77, th: 56, c: 10, r: 0 },      // the office text on a pill
    { shape: 'pill', tw: 30, th: 40, c: 10, r: 0 },      // taller than it is wide
    { shape: 'plaque', tw: 77, th: 56, c: 10, r: 5 },
    { shape: 'plaque', tw: 60, th: 20, c: 2, r: 20 },    // cut far larger than the margin
  ];

  for (const t of cases) {
    const box = { minX: -t.tw / 2, maxX: t.tw / 2, minY: -t.th / 2, maxY: t.th / 2 };
    const { width, height } = m.plateSizeFor(box, t.c, t.shape, t.r);
    const poly = m.plateOutline(t.shape, width, height, t.r)[0];

    // For these outlines the tightest point is always a corner of the text box.
    let worst = Infinity;
    for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) {
      worst = Math.min(worst, signedDist(poly, x, y));
    }
    // Tolerance of one arc chord: the outline is a polygon approximation of the curve, so
    // an edge can sit a hair inside the true circle.
    ok(`${t.shape} ${t.tw}x${t.th} margin ${t.c}`, worst > t.c - 0.35,
       `clearance ${worst.toFixed(2)} mm, wanted ${t.c} — plate ${width.toFixed(1)}x${height.toFixed(1)}`);
  }

  // A frame stands inside the outline, so it is paid for out of the same budget.
  const box = { minX: -30, maxX: 30, minY: -10, maxY: 10 };
  const bare = m.plateSizeFor(box, 10, 'rounded', 6);
  const framed = m.plateSizeFor(box, 13, 'rounded', 6);
  ok('a frame widens the plate rather than eating the margin',
     framed.width > bare.width + 5.9 && framed.height > bare.height + 5.9,
     `${bare.width}x${bare.height} -> ${framed.width}x${framed.height}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
