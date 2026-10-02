/**
 * Headless build check: real fonts, real manifold, per-part triangle counts.
 *
 * The browser status line reports totals, and a total is exactly the wrong number for
 * catching an empty text body — a plate's triangle count does not vary with its size, so
 * "348 triangles" looked identical for `12`, `80` and `80 / ELM STREET` while the text was
 * contributing nothing at all. Per-part counts make that visible in one line.
 */
import Module from 'manifold-3d';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

import { buildSign } from './buildSign.ts';
import {
  plateOutline, plateSizeFor, screwHolePositions, nudgeClear, distanceToContours, lineContour,
  screwHolePositions4, stencilBridges, counterCount, keyholePositions,
} from './outlines.ts';
import { DEFAULTS, SCREW_HOLE_ROOM_MM, atScale } from '../types.ts';
import { coerceSettings, PRESETS } from '../state.ts';
import { getHorizontalContours, getVerticalContours } from '../../../../packages/fonts/src/textLayout.ts';

const fontPath = process.argv[2]
  ?? fileURLToPath(new URL('../../../../packages/fonts/src/fonts/inter.ttf', import.meta.url));

const wasm = await Module();
wasm.setup();

const font = opentype.parse(readFileSync(fontPath).buffer);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

function layoutFor(params) {
  // Mirrors main.ts's rebuild(): vertical takes `stackSpacing` and no tracking, because the
  // two functions read their spacing argument differently and horizontal's value overlapped
  // the characters by half their height when it was passed through here.
  return params.orientation === 'vertical'
    ? getVerticalContours(font, font, params.text, params.textSize, params.stackSpacing, 0)
    : getHorizontalContours(
        font, font, params.text, params.text2,
        params.textSize, params.line2Size, 0, params.align,
        params.lineSpacing, params.letterSpacing,
        { alignMode: 'block', placement: params.linePlacement, vAlign: params.vAlign },
      );
}

function build(over = {}) {
  const params = { ...DEFAULTS, ...over };
  const layout = layoutFor(params);
  const res = buildSign(wasm, layout.contours, params, layout.lines);
  return {
    ...res,
    tris: Object.fromEntries(res.parts.map((p) => [p.name, p.triVerts.length / 3])),
    contourCount: layout.contours.length,
  };
}

console.log('text body');
{
  const a = build({ text: '12' });
  console.log('   ', JSON.stringify(a.tris), 'contours:', a.contourCount, 'size:', a.size);
  ok('two parts', a.parts.length === 2, `${a.parts.length}`);
  ok('plate has geometry', (a.tris.plate ?? 0) > 0);
  ok('text has geometry', (a.tris.text ?? 0) > 0, `text tris ${a.tris.text}`);

  const b = build({ text: '88888888' });
  console.log('   ', JSON.stringify(b.tris), 'contours:', b.contourCount);
  ok('more glyphs means more text triangles', (b.tris.text ?? 0) > (a.tris.text ?? 0),
     `${a.tris.text} -> ${b.tris.text}`);

  const c = build({ text: '80', text2: 'ELM STREET' });
  console.log('   ', JSON.stringify(c.tris), 'contours:', c.contourCount);
  ok('a second line adds triangles', (c.tris.text ?? 0) > (a.tris.text ?? 0),
     `${a.tris.text} -> ${c.tris.text}`);
}

console.log('counters');
{
  // "8" has two counters, "1" has none. If winding is wrong the counters fill in and the
  // triangle count barely moves.
  const one = build({ text: '1' });
  const eight = build({ text: '8' });
  console.log('    1:', one.tris.text, ' 8:', eight.tris.text);
  ok('a counter glyph has more triangles than a plain one',
     (eight.tris.text ?? 0) > (one.tris.text ?? 0), `${one.tris.text} vs ${eight.tris.text}`);
}

console.log('loose numbers');
{
  const loose = build({ text: '12', shape: 'none' });
  console.log('   ', JSON.stringify(loose.tris));
  ok('no plate part', !('plate' in loose.tris));
  ok('one part per glyph', loose.parts.length === 2, `${loose.parts.length}`);
}

console.log('mounting');
{
  const plain = build({ mount: 'tape' });
  const screws = build({ mount: 'screws' });
  const keyhole = build({ mount: 'keyhole' });
  console.log('    none:', plain.tris.plate, ' screws:', screws.tris.plate, ' keyhole:', keyhole.tris.plate);
  ok('screw holes cut the plate', (screws.tris.plate ?? 0) > (plain.tris.plate ?? 0));
  ok('keyholes cut the plate', (keyhole.tris.plate ?? 0) > (plain.tris.plate ?? 0));
}

console.log('sweep');
{
  const extremes = [
    { textSize: 10 }, { textSize: 200 },
    { padding: 0 }, { padding: 60 },
    { plateThickness: 2 }, { plateThickness: 12 },
    { textThickness: 0.6 }, { textThickness: 10 },
    { frameOn: false }, { frameOn: true, frameWidth: 0.5 }, { frameOn: true, frameWidth: 8 },
    { frameOn: true, frameFollowsText: false, frameHeight: 0.4 },
    { frameOn: true, frameFollowsText: false, frameHeight: 10 },
    // A wide frame with no margin is the case that used to cap the screw holes.
    { frameOn: true, frameWidth: 8, padding: 0, mount: 'screws' },
    { cornerRadius: 0 }, { cornerRadius: 40 },
    { chamfer: 0 }, { chamfer: 2 },
    { orientation: 'vertical' }, { orientation: 'vertical', stackSpacing: 0.8 },
    { orientation: 'vertical', stackSpacing: 2 },
    ...['rounded', 'rect', 'pill', 'plaque'].map((shape) => ({ shape })),
  ];
  let clean = true;
  for (const over of extremes) {
    try {
      const r = build(over);
      if (r.parts.length < 2 || (r.tris.text ?? 0) === 0) {
        clean = false;
        console.log('    empty at', JSON.stringify(over), JSON.stringify(r.tris));
      }
    } catch (e) {
      clean = false;
      console.log('    threw at', JSON.stringify(over), e.message);
    }
  }
  ok('every extreme builds two non-empty parts', clean);
}

/*
 * Stacked layout, which shipped with the characters fused into one blob.
 *
 * The horizontal `lineSpacing` (0.55) was being handed to `getVerticalContours`, where it
 * means something else entirely — a multiplier on one character's step rather than a
 * fraction of two type sizes. It produced a 28.6 mm step under a 52.8 mm glyph, so every
 * digit overlapped its neighbour by 46% of its height. Nothing failed; the mesh was still
 * watertight, just wrong. Measuring the stack's height against the characters in it is what
 * catches that.
 */
console.log('stacked');
{
  const glyph = getVerticalContours(font, font, '8', DEFAULTS.textSize, DEFAULTS.stackSpacing, 0);
  const glyphH = glyph.box.maxY - glyph.box.minY;

  for (const n of [2, 3, 4]) {
    const stack = getVerticalContours(font, font, '8'.repeat(n), DEFAULTS.textSize, DEFAULTS.stackSpacing, 0);
    const step = ((stack.box.maxY - stack.box.minY) - glyphH) / (n - 1);
    ok(`${n} stacked characters clear each other`, step >= glyphH,
       `step ${step.toFixed(2)} mm vs glyph ${glyphH.toFixed(2)} mm — overlap ${(glyphH - step).toFixed(2)} mm`);
  }

  // The default must be usable on its own: a user who never touches the slider still gets a
  // readable stack. This is the assertion the shipped default would have failed.
  const three = build({ orientation: 'vertical', text: '123' });
  ok('a stacked build is taller than it is wide', three.size.height > three.size.width,
     `${three.size.width.toFixed(1)}x${three.size.height.toFixed(1)}`);

  // Stacked has no second line — `getVerticalContours` takes no text2 — so a second line
  // must not silently change the model behind the user's back.
  const withLine2 = build({ orientation: 'vertical', text: '123', text2: 'ELM STREET' });
  ok('stacked ignores the second line rather than half-applying it',
     Math.abs(withLine2.size.width - three.size.width) < 0.01,
     `${three.size.width} vs ${withLine2.size.width}`);
}

/*
 * Alignment. It only ever moves line 2 under line 1 — the plate is sized from the combined
 * bounding box, so a single line has no room to be aligned within and all three settings
 * produce identical geometry. That is now what the UI says, and this pins both halves of it.
 */
/*
 * The margin, on the real text rather than a synthetic rectangle.
 *
 * `outlines.check.mjs` proves the arithmetic; this proves it survives contact with actual
 * glyph outlines, at the sizes the presets ship. The shipped pill put the office text 1.49 mm
 * *outside* its own outline, and the apartment preset kept 2.70 mm of clearance where 10 mm
 * had been asked for — neither of which any existing check could see, because every one of
 * them measured triangles rather than where the text sits.
 */
console.log('the margin holds on the real text');
{
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

  const cases = [
    { name: 'house', shape: 'rounded', text: '12', text2: '', textSize: 60, padding: 12, cornerRadius: 6 },
    { name: 'mailbox', shape: 'rect', text: '12', text2: '', textSize: 28, padding: 8, cornerRadius: 0 },
    { name: 'office', shape: 'plaque', text: '12', text2: 'MEETING ROOM', textSize: 34, line2Size: 14, padding: 10, cornerRadius: 5, frameOn: true, frameWidth: 2.5 },
    { name: 'apartment', shape: 'pill', text: '12', text2: '', textSize: 45, padding: 10, cornerRadius: 0 },
    // The screenshot that started round 2: the office text on a pill.
    { name: 'office-on-a-pill', shape: 'pill', text: '12', text2: 'MEETING ROOM', textSize: 34, line2Size: 14, padding: 10 },
    { name: 'wide frame', shape: 'rounded', text: '80', text2: 'ELM STREET', textSize: 40, line2Size: 16, padding: 6, cornerRadius: 10, frameOn: true, frameWidth: 8 },
  ];

  for (const t of cases) {
    const params = { ...DEFAULTS, ...t };
    const layout = layoutFor(params);
    const clearance = params.padding + (params.frameOn ? params.frameWidth : 0);
    const { width, height } = plateSizeFor(layout.box, clearance, params.shape, params.cornerRadius);
    const poly = plateOutline(params.shape, width, height, params.cornerRadius)[0];

    // buildSign centres the text on the origin, so measure it there.
    const cx = (layout.box.minX + layout.box.maxX) / 2;
    const cy = (layout.box.minY + layout.box.maxY) / 2;

    let worst = Infinity;
    for (const loop of layout.contours) {
      for (const pt of loop) {
        const d = signedDist(poly, pt[0] - cx, pt[1] - cy);
        if (d < worst) worst = d;
      }
    }
    ok(`${t.name}: text sits inside the ${params.shape} with its margin`, worst > clearance - 0.4,
       `clearance ${worst.toFixed(2)} mm, wanted ${clearance} — plate ${width.toFixed(1)}x${height.toFixed(1)}`);
  }
}

/* `beside`: number and room name on one row, at their own sizes. */
console.log('second line beside');
{
  const below = build({ text: '12', text2: 'MEETING ROOM', linePlacement: 'below' });
  const beside = build({ text: '12', text2: 'MEETING ROOM', linePlacement: 'right' });
  ok('beside is wider than below', beside.size.width > below.size.width * 1.3,
     `${below.size.width.toFixed(0)} -> ${beside.size.width.toFixed(0)} mm`);
  ok('beside is shorter than below', beside.size.height < below.size.height,
     `${below.size.height.toFixed(0)} -> ${beside.size.height.toFixed(0)} mm`);
  ok('beside still builds a plate and text', (beside.tris.plate ?? 0) > 0 && (beside.tris.text ?? 0) > 0);

  /*
   * The whole point is that the two keep their own type sizes on one row — so measure line
   * 2's own box, not the block's.
   *
   * The block height is set by the TALLER line, which is line 1 at 60 mm, and stays 66 mm
   * whether line 2 is 18 mm or 28 mm. That is correct: growing the small line does not make
   * a sign taller until it passes the big one.
   */
  const boxOf = (line2Size) =>
    layoutFor({ ...DEFAULTS, text: '12', text2: 'MEETING ROOM', linePlacement: 'right', line2Size }).lines[1];
  const small = boxOf(18), large = boxOf(28);
  ok('the second line keeps its own size when beside',
     large.maxY - large.minY > (small.maxY - small.minY) * 1.4,
     `line 2 ink height ${(small.maxY - small.minY).toFixed(1)} -> ${(large.maxY - large.minY).toFixed(1)} mm`);
  ok('both lines share a baseline when beside',
     Math.abs(boxOf(18).minY - layoutFor({ ...DEFAULTS, text: '12', text2: 'MEETING ROOM', linePlacement: 'right' }).lines[0].minY) < 40,
     'line 2 sits on the same row as line 1');
}

/* The frame prints in its own filament, so it has to be its own part. */
console.log('frame as a separate body');
{
  const off = build({ frameOn: false });
  const on = build({ frameOn: true, frameWidth: 3 });
  ok('no frame means two parts', off.parts.length === 2, `${off.parts.length}`);
  ok('a frame adds a third part', on.parts.length === 3, `${on.parts.map((p) => p.name).join(', ')}`);
  const frame = on.parts.find((p) => p.name === 'frame');
  ok('the frame part carries its own colour',
     !!frame && frame.colorRgb.join() !== on.parts[0].colorRgb.join(),
     frame ? frame.colorRgb.join() : 'no frame part');
}

/* Screw holes must not be punched through the text. */
console.log('screw holes clear the text');
{
  const params = { ...DEFAULTS, mount: 'screws', text: '12', padding: 8 };
  const layout = layoutFor(params);
  const clearance = params.padding;
  const holeRoom = SCREW_HOLE_ROOM_MM;
  const { width } = plateSizeFor(layout.box, clearance + holeRoom, params.shape, params.cornerRadius);
  const { height } = plateSizeFor(layout.box, clearance, params.shape, params.cornerRadius);
  const cx = (layout.box.minX + layout.box.maxX) / 2;
  const cy = (layout.box.minY + layout.box.maxY) / 2;

  let worst = Infinity;
  for (const [hx, hy] of screwHolePositions(width, height, params.mountHoleDia, clearance + holeRoom / 2)) {
    for (const loop of layout.contours) {
      for (const pt of loop) {
        worst = Math.min(worst, Math.hypot(pt[0] - cx - hx, pt[1] - cy - hy) - params.mountHoleDia / 2);
      }
    }
  }
  ok('no glyph reaches a screw hole', worst > 0.5,
     `closest glyph point is ${worst.toFixed(2)} mm from a hole edge`);
}

/* Keyholes: an undercut that never reaches the front face. */
console.log('keyhole slots');
{
  const plain = build({ mount: 'tape', plateThickness: 8 });
  const key = build({ mount: 'keyhole', plateThickness: 8 });
  ok('keyholes cut material away', (key.tris.plate ?? 0) > (plain.tris.plate ?? 0),
     `${plain.tris.plate} -> ${key.tris.plate}`);

  /*
   * The front face is what the sign is read from; a slot showing through it is the failure
   * that makes one unsellable.
   *
   * Asserted by comparing the front face against the same plate with no mounting at all: if
   * the slot had broken through, the face would gain an outline's worth of vertices around
   * it. An absolute z test is the wrong instrument — `bevelExtrude` overshoots the nominal
   * top by its own 0.005 mm epsilon, which says nothing about breaching.
   */
  const faceOf = (r) => {
    const plate = r.parts.find((p) => p.name === 'plate');
    let maxZ = -Infinity;
    for (let i = 2; i < plate.vertProperties.length; i += 3) maxZ = Math.max(maxZ, plate.vertProperties[i]);
    let n = 0;
    for (let i = 2; i < plate.vertProperties.length; i += 3) {
      if (Math.abs(plate.vertProperties[i] - maxZ) < 1e-3) n++;
    }
    return { maxZ, n };
  };
  const a = faceOf(plain), b = faceOf(key);
  ok('the slot never breaches the front face', a.n === b.n && Math.abs(a.maxZ - b.maxZ) < 1e-6,
     `front face ${a.n} verts at z=${a.maxZ.toFixed(3)} -> ${b.n} verts at z=${b.maxZ.toFixed(3)}`);

  // A plate too thin to swallow a screw head should say so rather than emit a useless slot.
  const thin = build({ mount: 'keyhole', plateThickness: 2 });
  ok('a thin plate warns instead of pretending', thin.warnings.some((w) => /keyhole/i.test(w)),
     JSON.stringify(thin.warnings));
}

/* Four-hole mounting, and an inset the user actually controls. */
console.log('screw hole placement');
{
  const two = build({ mount: 'screws', mountFourHoles: false });
  const four = build({ mount: 'screws', mountFourHoles: true });
  ok('four holes cut more than two', (four.tris.plate ?? 0) > (two.tris.plate ?? 0),
     `${two.tris.plate} -> ${four.tris.plate}`);

  /*
   * The inset must actually move the holes.
   *
   * It did not. The plate's hole allowance was derived from the inset, so the plate grew by
   * exactly as much as the inset moved the hole: measured at 4.50 mm from the text edge at
   * inset 5, 10, 20, 30, 45 AND 60 mm. Everything downstream looked right — the plate really
   * did get wider — which is why nothing caught it. Measure the hole against the TEXT, not
   * against the plate.
   */
  const holeX = (mountInset) => {
    const params = { ...DEFAULTS, mount: 'screws', mountInset, text: '12' };
    const layout = layoutFor(params);
    const holeRoom = SCREW_HOLE_ROOM_MM;
    const { width } = plateSizeFor(layout.box, params.padding + holeRoom, params.shape, params.cornerRadius);
    const { height } = plateSizeFor(layout.box, params.padding, params.shape, params.cornerRadius);
    const pos = screwHolePositions(width, height, params.mountHoleDia, mountInset);
    return { x: pos.length ? pos[1][0] : NaN, width };
  };
  const a5 = holeX(5), a20 = holeX(20), a40 = holeX(40);
  ok('the hole inset actually moves the hole',
     a5.x - a20.x > 10 && a20.x - a40.x > 10,
     `inset 5 -> x ${a5.x.toFixed(1)}, 20 -> ${a20.x.toFixed(1)}, 40 -> ${a40.x.toFixed(1)}`);
  ok('the plate does not grow with the inset',
     Math.abs(a5.width - a40.width) < 0.01,
     `${a5.width.toFixed(1)} vs ${a40.width.toFixed(1)} mm`);

  /*
   * The pattern has to stay symmetric.
   *
   * Nudging each hole independently along its own radius let each one stop at a different
   * distance, so a pair sat at unequal insets and a set of four lost its symmetry — the
   * "holes behave very weird" report. It is drilled into a wall from this; asymmetry means
   * the sign hangs crooked.
   */
  for (const four of [false, true]) {
    const params = { ...DEFAULTS, mount: 'screws', mountFourHoles: four, mountInset: 22, text: '12' };
    const layout = layoutFor(params);
    const holeRoom = SCREW_HOLE_ROOM_MM;
    const { width } = plateSizeFor(layout.box, params.padding + holeRoom, params.shape, params.cornerRadius);
    const { height } = plateSizeFor(layout.box, params.padding, params.shape, params.cornerRadius);
    const cx = (layout.box.minX + layout.box.maxX) / 2;
    const cy = (layout.box.minY + layout.box.maxY) / 2;
    const centred = layout.contours.map((l) => l.map((p) => [p[0] - cx, p[1] - cy]));
    const outline = plateOutline(params.shape, width, height, params.cornerRadius);
    const wanted = four
      ? screwHolePositions4(width, height, params.mountHoleDia, params.mountInset)
      : screwHolePositions(width, height, params.mountHoleDia, params.mountInset);

    let push = 0;
    for (const p of wanted) {
      const { at } = nudgeClear(centred, p, params.mountHoleDia / 2, outline);
      push = Math.max(push, Math.hypot(at[0] - p[0], at[1] - p[1]));
    }
    const placed = wanted.map(([px, py]) => {
      const len = Math.hypot(px, py) || 1;
      return [px + (px / len) * push, py + (py / len) * push];
    });
    const radii = placed.map(([x, y]) => Math.hypot(x, y));
    const spread = Math.max(...radii) - Math.min(...radii);
    ok(`${four ? 'four' : 'two'} holes stay symmetric about the centre`, spread < 0.01,
       `radii ${radii.map((r) => r.toFixed(2)).join(', ')}`);
  }

  // And a hole must never end up under a glyph, at any inset.
  for (const inset of [3, 8, 15, 25, 40, 60]) {
    const params = { ...DEFAULTS, mount: 'screws', mountInset: inset, text: '12' };
    const layout = layoutFor(params);
    const holeRoom = SCREW_HOLE_ROOM_MM;
    const { width } = plateSizeFor(layout.box, params.padding + holeRoom, params.shape, params.cornerRadius);
    const { height } = plateSizeFor(layout.box, params.padding, params.shape, params.cornerRadius);
    const cx = (layout.box.minX + layout.box.maxX) / 2;
    const cy = (layout.box.minY + layout.box.maxY) / 2;
    const centred = layout.contours.map((l) => l.map((p) => [p[0] - cx, p[1] - cy]));
    const outline = plateOutline(params.shape, width, height, params.cornerRadius);

    let worst = Infinity;
    for (const p of screwHolePositions(width, height, params.mountHoleDia, inset)) {
      const { at } = nudgeClear(centred, p, params.mountHoleDia / 2, outline);
      worst = Math.min(worst, distanceToContours(centred, at[0], at[1]) - params.mountHoleDia / 2);
    }
    ok(`inset ${inset} mm: the hole clears the glyphs`, worst > 0.3,
       `closest edge-to-ink ${worst.toFixed(2)} mm`);
  }
}

/*
 * The rule, and the promise that justifies it.
 *
 * `shape: 'none'` emits one part per glyph — loose numerals that print unattached, which is
 * the plateless look from the reference signs minus the bar that makes it a single object.
 * Turning the rule on has to weld them into ONE piece. That is the assertion; the rest is
 * detail.
 */
console.log('line');
{
  const loose = build({ shape: 'none', text: '38', text2: 'FOREST RIDGE DR', divider: 'none' });
  const joined = build({ shape: 'none', text: '38', text2: 'FOREST RIDGE DR', divider: 'line' });
  ok('without a line, a plateless sign is loose pieces', loose.parts.length > 1,
     `${loose.parts.length} parts`);
  ok('a line welds a plateless sign into one piece', joined.parts.length === 1,
     `${joined.parts.length} parts: ${joined.parts.map((p) => p.name).join(', ')}`);
  ok('and it warns about the loose case, not the joined one',
     loose.warnings.some((w) => /unattached/.test(w)) && !joined.warnings.some((w) => /unattached/.test(w)));

  // Thickness reaches the model. Measured on a ONE-line sign, where the bar sits below the
  // block and is free to grow: between two lines it spans the gap by construction, so a
  // thickness under the gap is absorbed by it and correctly changes nothing.
  const thin = build({ shape: 'none', text: '38', text2: '', divider: 'line', lineThickness: 2 });
  const thick = build({ shape: 'none', text: '38', text2: '', divider: 'line', lineThickness: 16 });
  ok('line thickness changes the model', thick.size.height > thin.size.height + 4,
     `${thin.size.height.toFixed(1)} -> ${thick.size.height.toFixed(1)} mm`);

  const flush = build({ shape: 'none', text: '38', text2: 'FOREST RIDGE DR', divider: 'line', lineOverhang: 0 });
  const wide = build({ shape: 'none', text: '38', text2: 'FOREST RIDGE DR', divider: 'line', lineOverhang: 40 });
  ok('line overhang widens the sign', wide.size.width > flush.size.width + 70,
     `${flush.size.width.toFixed(1)} -> ${wide.size.width.toFixed(1)} mm`);

  /*
   * The weld has to catch EVERY glyph, not just the one that hangs lowest.
   *
   * A line's box is its ink box, so the upper line's `minY` is the bottom of its deepest
   * descender. On "Marianijeva" that is the `j` — a bar reaching `minY` touched the `j` and
   * nothing else, and every other letter came out a separate piece that would print in
   * mid-air. Words with a descender are the case that exposes it; words without one never did.
   */
  /*
   * A plateless sign cannot always be ONE piece, and pretending otherwise was wrong.
   *
   * The dot on an `i` or a `j` is a separate island in every typeface — a tittle touches
   * nothing, by construction. No bar can attach it, so "Marianijeva" is a body plus three
   * dots however the line is drawn. What the bar is actually responsible for is joining the
   * number to the street name, and that is what this measures: with a line, the count drops
   * to the letters that are inherently loose; without one, every glyph is loose.
   */
  const looseCount = (word, on) =>
    build({ shape: 'none', text: '12', text2: word, divider: on ? 'line' : 'none', lineThickness: 4 })
      .parts.length;

  for (const word of ['FOREST RIDGE DR', 'STREET NAME', 'ELM ST']) {
    ok(`"${word}" welds into one piece`, looseCount(word, true) === 1,
       `${looseCount(word, true)} pieces`);
  }
  // Dotted letters keep their tittles, and that is correct — but the bar must still collapse
  // everything else into a single body.
  for (const word of ['Marianijeva', 'Jimmy']) {
    const withBar = looseCount(word, true);
    const without = looseCount(word, false);
    const dots = (word.match(/[ij]/g) ?? []).length;
    ok(`"${word}" welds to one body plus its ${dots} tittle${dots === 1 ? '' : 's'}`,
       withBar <= dots + 1 && withBar < without,
       `${without} loose -> ${withBar} with a line, ${dots} dots expected`);
  }
  // ...and with the number on top, which is the preset's own arrangement.
  const preset = build({
    shape: 'none', divider: 'line', lineThickness: 6, lineOverhang: 4,
    textSize: 70, line2Size: 18, lineSpacing: 0.42, letterSpacing: 0.06,
    text: '12', text2: 'FOREST RIDGE DR',
  });
  ok('the Street preset welds into one piece', preset.parts.length === 1, `${preset.parts.length} pieces`);

  // Beside placement turns the bar into a vertical divider — the "10 | RYDAL DRIVE" look.
  const divider = build({ text: '10', text2: 'RYDAL DRIVE', linePlacement: 'right', divider: 'line' });
  ok('a vertical divider builds when the lines sit side by side',
     (divider.tris.text ?? 0) > 0 && divider.parts.length >= 2);

  /*
   * ON A PLATE the thickness must be exact and the bar must NOT touch the text.
   *
   * The first version stretched the bar to bridge in every case, because plateless signs
   * need that. On a plate it made the thickness control inert — any value under the gap was
   * swallowed — and grew the bar into the glyphs, which is what it looked like on screen.
   */
  const gapOf = (thickness) => {
    const params = { ...DEFAULTS, text: '12', text2: 'ELM STREET', divider: 'line', lineThickness: thickness };
    const layout = layoutFor(params);
    const bar = lineContour(layout.lines, layout.box, {
      thickness, overhang: 0, length: 0, offset: 0, beside: false, bridge: false,
    });
    const barBox = { minY: Math.min(...bar.map((p) => p[1])), maxY: Math.max(...bar.map((p) => p[1])) };
    const [a, b] = layout.lines;
    const lower = a.minY < b.minY ? a : b;
    const upper = a.minY < b.minY ? b : a;
    return {
      height: barBox.maxY - barBox.minY,
      gapBelow: barBox.minY - lower.maxY,
      gapAbove: upper.minY - barBox.maxY,
    };
  };
  const g2 = gapOf(2), g8 = gapOf(8);
  ok('on a plate the line is exactly as thick as asked',
     Math.abs(g2.height - 2) < 0.01 && Math.abs(g8.height - 8) < 0.01,
     `asked 2 got ${g2.height.toFixed(2)}, asked 8 got ${g8.height.toFixed(2)}`);
  ok('on a plate the line floats clear of the text',
     g2.gapBelow > 0.5 && g2.gapAbove > 0.5,
     `gaps ${g2.gapBelow.toFixed(2)} / ${g2.gapAbove.toFixed(2)} mm`);

  // Position has to reach the model. Measured on the bar itself: moving it inside the gap
  // translates geometry without adding any, so a triangle count says nothing about it.
  const barY = (offset) => {
    const params = { ...DEFAULTS, text: '12', text2: 'ELM STREET' };
    const layout = layoutFor(params);
    const bar = lineContour(layout.lines, layout.box, {
      thickness: 3, overhang: 0, length: 0, offset, beside: false, bridge: false,
    });
    const ys = bar.map((p) => p[1]);
    return (Math.min(...ys) + Math.max(...ys)) / 2;
  };
  ok('line position moves it', Math.abs(barY(8) - barY(0) - 8) < 0.01 && Math.abs(barY(-8) - barY(0) + 8) < 0.01,
     `centre ${barY(0).toFixed(2)}, +8 -> ${barY(8).toFixed(2)}, -8 -> ${barY(-8).toFixed(2)}`);

  const auto = build({ text: '12', text2: 'ELM STREET', divider: 'line', lineLength: 0 });
  const fixed = build({ text: '12', text2: 'ELM STREET', divider: 'line', lineLength: 200 });
  ok('an explicit line length is honoured', fixed.size.width > auto.size.width + 40,
     `${auto.size.width.toFixed(0)} -> ${fixed.size.width.toFixed(0)} mm`);
}

/* The two styles asked for from the reference photos. */
console.log('label bar and recessed text');
{
  // "34 / DRYFESDALE VIEW": the street name set INSIDE a filled bar, knocked out of it.
  const plain = build({ text: '34', text2: 'DRYFESDALE VIEW', divider: 'line', divider: 'line' });
  const label = build({ text: '34', text2: 'DRYFESDALE VIEW', divider: 'line', divider: 'band' });
  ok('a label bar builds', (label.tris.text ?? 0) > 0 && label.parts.length === 2);
  // The bar is wider than the type it holds, so the sign gets wider — and the second line
  // has to survive as a VOID in the fill, which is what a filled-over bar would destroy.
  ok('a label bar widens the sign around the second line',
     label.size.width > plain.size.width,
     `${plain.size.width.toFixed(1)} -> ${label.size.width.toFixed(1)} mm`);
  /*
   * The type must survive as a VOID in the fill, which is exactly what the first version
   * destroyed: subtracting all the text from the bar and unioning that back over all the
   * text gave `bar ∪ glyphs`, so the bar filled straight over line 2. It still "built", and
   * it still widened the sign — only the count of edges inside the bar tells the difference.
   *
   * Same bar, same type size, different number of letters: more letters knocked out means
   * more interior boundary. A filled slab would be flat regardless.
   */
  const few = build({ text: '34', text2: 'II', divider: 'line', divider: 'band' });
  const many = build({ text: '34', text2: 'DRYFESDALE VIEW', divider: 'line', divider: 'band' });
  ok('the knockout keeps the type as a void, not a filled slab',
     (many.tris.text ?? 0) > (few.tris.text ?? 0) * 1.5,
     `"II" ${few.tris.text} tris vs "DRYFESDALE VIEW" ${many.tris.text}`);

  // "6" recessed into a framed panel: one part, the legend cut into the face.
  const raised = build({ text: '6', relief: 'raised', frameOn: true });
  const sunk = build({ text: '6', relief: 'recessed', frameOn: true });
  ok('raised text is its own part', raised.parts.some((p) => p.name === 'text'));
  ok('recessed text emits no separate text body', !sunk.parts.some((p) => p.name === 'text'),
     sunk.parts.map((p) => p.name).join(', '));
  ok('recessed text cuts into the plate', (sunk.tris.plate ?? 0) > (raised.tris.plate ?? 0),
     `${raised.tris.plate} -> ${sunk.tris.plate}`);

  // And it must never punch through the face.
  const thin = build({ text: '6', relief: 'recessed', plateThickness: 2, textThickness: 10 });
  const plate = thin.parts.find((p) => p.name === 'plate');
  let minZ = Infinity;
  for (let i = 2; i < plate.vertProperties.length; i += 3) minZ = Math.min(minZ, plate.vertProperties[i]);
  ok('a deep recess never breaches the back', minZ > -1e-3, `lowest z ${minZ.toFixed(3)}`);
}

/** Highest z in a named part — the test for "flush" versus "standing proud". */
function topOf(r, name) {
  const part = r.parts.find((p) => p.name === name);
  if (!part) return NaN;
  let z = -Infinity;
  for (let i = 2; i < part.vertProperties.length; i += 3) z = Math.max(z, part.vertProperties[i]);
  return z;
}

/*
 * Inlay — the answer to "recessed makes it single colour, who would need that".
 *
 * The same recess, filled flush with a second body in the second filament. Two parts, and
 * the filler has to sit INSIDE the plate's depth: if it stood proud it would just be raised
 * text with extra steps.
 */
console.log('inlay');
{
  const raised = build({ text: '6', relief: 'raised' });
  const engraved = build({ text: '6', relief: 'recessed' });
  const inlay = build({ text: '6', relief: 'inlay' });

  ok('engraved is one part', !engraved.parts.some((p) => p.name === 'text'),
     engraved.parts.map((p) => p.name).join(', '));
  ok('inlay keeps a second part in the second colour',
     inlay.parts.some((p) => p.name === 'text') && inlay.parts.length === 2,
     inlay.parts.map((p) => p.name).join(', '));
  ok('the inlay sits flush with the face',
     Math.abs(topOf(inlay, 'text') - topOf(inlay, 'plate')) < 0.02,
     `text top ${topOf(inlay, 'text').toFixed(2)} vs plate top ${topOf(inlay, 'plate').toFixed(2)}`);
  ok('raised text stands proud, inlay does not',
     topOf(raised, 'text') > topOf(raised, 'plate') + 0.5,
     `raised ${topOf(raised, 'text').toFixed(2)} vs plate ${topOf(raised, 'plate').toFixed(2)}`);
}

/* The edge band — the "300" reference. */
console.log('edge band');
{
  const plain = build({ text: '300', band: 'none' });
  const banded = build({ text: '300', band: 'bottom', bandWidth: 14 });
  ok('a band is its own part', banded.parts.some((p) => p.name === 'band'),
     banded.parts.map((p) => p.name).join(', '));
  /*
   * The band stands PROUD of the plate, and leaves it whole.
   *
   * It was a region cut out of the plate and refilled in a second filament — flush, so it
   * read as a printed stripe. The reference is a bar standing off the face exactly like the
   * numerals: the plateless "bar under the number" look, put on a plate. So the plate is
   * untouched and the band sits on top of it, at the text's own height.
   */
  /*
   * The band does not cut the plate — compared against a plate that is ALSO flat-topped.
   *
   * A band suppresses the plate's chamfer (see below), so a bevelled plate and a banded one
   * differ by hundreds of triangles for a reason that has nothing to do with cutting. At
   * `chamfer: 0` both are flat and the counts are directly comparable.
   */
  const flatPlain = build({ text: '300', band: 'none', chamfer: 0 });
  const flatBanded = build({ text: '300', band: 'bottom', bandWidth: 14, chamfer: 0 });
  ok('the band leaves the plate whole',
     (flatBanded.tris.plate ?? 0) === (flatPlain.tris.plate ?? 0),
     `${flatPlain.tris.plate} -> ${flatBanded.tris.plate}`);
  ok('the band stands proud of the plate',
     topOf(banded, 'band') > topOf(banded, 'plate') + 1,
     `band ${topOf(banded, 'band').toFixed(2)} vs plate ${topOf(banded, 'plate').toFixed(2)}`);
  ok('the band is the same height as the text',
     Math.abs(topOf(banded, 'band') - topOf(banded, 'text')) < 0.02,
     `band ${topOf(banded, 'band').toFixed(2)} vs text ${topOf(banded, 'text').toFixed(2)}`);

  /*
   * No groove between the band and the plate it stands on.
   *
   * Two things put one there. The plate's own chamfer pulls its top face inward by
   * `chamfer`, so anything standing on the perimeter overhangs the lip — the same failure
   * the frame had. And bevelling the band insets *its* outer edge as well, drawing it in
   * from the plate's wall. Either alone leaves a line running the length of the sign.
   *
   * The test is that the two share an outer wall: at the banded edge they must reach the
   * same extent, and the plate's top must be flat there rather than chamfered away.
   */
  const extentY = (r, name) => {
    const part = r.parts.find((p) => p.name === name);
    let lo = Infinity;
    for (let i = 1; i < part.vertProperties.length; i += 3) lo = Math.min(lo, part.vertProperties[i]);
    return lo;
  };
  ok('the band is flush with the plate wall, not inset from it',
     Math.abs(extentY(banded, 'band') - extentY(banded, 'plate')) < 0.01,
     `band reaches ${extentY(banded, 'band').toFixed(3)}, plate ${extentY(banded, 'plate').toFixed(3)}`);

  // A flat top under the band: the plate's own top must sit at exactly its thickness, with no
  // chamfer having pulled it in.
  const plateTop = topOf(banded, 'plate');
  ok('the plate top is flat where the band lands', Math.abs(plateTop - DEFAULTS.plateThickness) < 0.02,
     `plate top ${plateTop.toFixed(3)} vs thickness ${DEFAULTS.plateThickness}`);
  ok('the band carries its own colour',
     banded.parts.find((p) => p.name === 'band').colorRgb.join()
     !== banded.parts.find((p) => p.name === 'plate').colorRgb.join());
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    const r = build({ text: '300', band: edge, bandWidth: 10 });
    ok(`band along the ${edge} builds`, r.parts.some((p) => p.name === 'band'));
  }
}

/* The inset panel — the "6" reference. */
console.log('inset panel');
{
  const flat = build({ text: '6', panelOn: false });
  const panelled = build({ text: '6', panelOn: true, panelInset: 8, panelHeight: 2.5 });
  ok('a panel is its own part', panelled.parts.some((p) => p.name === 'panel'),
     panelled.parts.map((p) => p.name).join(', '));
  ok('the panel is raised above the plate',
     topOf(panelled, 'panel') > topOf(panelled, 'plate') + 2,
     `panel ${topOf(panelled, 'panel').toFixed(2)} vs plate ${topOf(panelled, 'plate').toFixed(2)}`);
  // The panel is the face, so the text must sit on IT rather than float above the plate.
  ok('raised text sits on the panel, not the plate',
     topOf(panelled, 'text') > topOf(flat, 'text'),
     `${topOf(flat, 'text').toFixed(2)} -> ${topOf(panelled, 'text').toFixed(2)}`);

  const inlaidPanel = build({ text: '6', panelOn: true, panelHeight: 3, relief: 'inlay', textThickness: 2 });
  ok('an inlay in a panel stays inside the panel',
     Math.abs(topOf(inlaidPanel, 'text') - topOf(inlaidPanel, 'panel')) < 0.02,
     `text ${topOf(inlaidPanel, 'text').toFixed(2)} vs panel ${topOf(inlaidPanel, 'panel').toFixed(2)}`);
}

/*
 * The fixes from the last pass over the running app.
 */
console.log('sizing, engraving and panels behave');
{
  // A pill takes its cap radius from half the short side, so its auto width follows its
  // height and no margin could bring it in. An explicit width is the escape hatch.
  const auto = build({ shape: 'pill', text: '12', textSize: 45 });
  const narrow = build({ shape: 'pill', text: '12', textSize: 45, plateWidth: 90 });
  ok('an explicit width makes a pill narrower', narrow.size.width < auto.size.width - 5,
     `auto ${auto.size.width.toFixed(0)} -> fixed ${narrow.size.width.toFixed(0)} mm`);

  // ...but never smaller than the text needs.
  const squashed = build({ shape: 'rect', text: '888888', textSize: 60, plateWidth: 20 });
  ok('a width too small for the text grows instead of cropping', squashed.size.width > 40,
     `${squashed.size.width.toFixed(0)} mm`);
  ok('and it says so', squashed.warnings.some((w) => /Width raised/.test(w)),
     JSON.stringify(squashed.warnings));

  /*
   * The panel has to be paid for in the plate's size.
   *
   * Without that the plate was sized to text-plus-margin and the panel inset *inside* it, so
   * the panel came out smaller than the text it was meant to carry and the number hung off
   * both ends of it in mid-air.
   */
  const flat = build({ text: '12', panelOn: false, padding: 8 });
  const panelled = build({ text: '12', panelOn: true, panelInset: 12, padding: 8 });
  ok('a panel widens the plate that carries it',
     panelled.size.width > flat.size.width + 20,
     `${flat.size.width.toFixed(0)} -> ${panelled.size.width.toFixed(0)} mm`);

  // Engraved goes all the way through — a stencil, not a shallow groove.
  const engraved = build({ text: '8', relief: 'recessed', plateThickness: 6 });
  const solid = build({ text: '8', relief: 'raised', plateThickness: 6 });
  const plate = engraved.parts.find((p) => p.name === 'plate');
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < plate.vertProperties.length; i += 3) {
    lo = Math.min(lo, plate.vertProperties[i]);
    hi = Math.max(hi, plate.vertProperties[i]);
  }
  ok('engraved cuts through the whole plate',
     (engraved.tris.plate ?? 0) > (solid.tris.plate ?? 0) && lo < 0.01 && hi > 5.9,
     `plate spans z ${lo.toFixed(2)}..${hi.toFixed(2)}, ${solid.tris.plate} -> ${engraved.tris.plate} tris`);
}

/*
 * A stencil has to stay in one piece.
 *
 * Cut an `8` clean through and its two enclosed islands are attached to nothing — they drop
 * out of the sign, or in a print sit on the bed as loose ovals. `0`, `6`, `9`, `A`, `B` and
 * `D` all do it. The fix is what every stencil alphabet does: leave a narrow tie joining each
 * counter to the field. The test is simply that the plate is still ONE body.
 */
console.log('stencil bridges');
{
  /*
   * Counted from the mesh, not from the parts array — the plate is one entry there whether
   * it is one body or five, which is exactly how a dropped counter would go unnoticed.
   * Union-find over the triangle indices gives the real number of connected components.
   */
  const bodies = (part) => {
    const n = part.vertProperties.length / 3;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const t = part.triVerts;
    for (let i = 0; i < t.length; i += 3) { union(t[i], t[i + 1]); union(t[i + 1], t[i + 2]); }
    const roots = new Set();
    for (let i = 0; i < n; i++) roots.add(find(i));
    return roots.size;
  };

  // `12` and `147` have no enclosed shape at all, so there are no ties to build — and
  // manifold will not make a CrossSection from an empty polygon list. That is the COMMON
  // case, not an edge one, and every earlier check happened to use a glyph with a counter.
  for (const text of ['12', '147', '1', '8', '0', '69', '88', 'AB', '1280']) {
    const r = build({ text, relief: 'recessed', plateThickness: 5 });
    const plate = r.parts.find((p) => p.name === 'plate');
    const n = bodies(plate);
    ok(`"${text}" stencils without dropping its counters`, n === 1, `${n} separate bodies`);
  }

  /*
   * The tie width, measured on the tie.
   *
   * Not on the plate's triangle count: widening a rectangular notch changes no topology, so
   * the count is identical at 0.6 mm and at 5 mm and would "pass" whatever the code did.
   */
  const layout = layoutFor({ ...DEFAULTS, text: '8' });
  /** A tie is a rectangle at an arbitrary angle now, so measure its sides, not its box. */
  const sidesOf = (tie) => {
    const side = (a, b) => Math.hypot(tie[b][0] - tie[a][0], tie[b][1] - tie[a][1]);
    const s = [side(0, 1), side(1, 2)].sort((m, n) => m - n);
    return { width: s[0], length: s[1] };
  };
  const widthOf = (w) => sidesOf(stencilBridges(layout.contours, w)[0]).width;
  ok('the tie is exactly as wide as asked',
     Math.abs(widthOf(1.6) - 1.6) < 0.01 && Math.abs(widthOf(4) - 4) < 0.01,
     `1.6 -> ${widthOf(1.6).toFixed(2)}, 4 -> ${widthOf(4).toFixed(2)}`);
  // An "8" has two counters and a "1" has none, whatever the tie shape.
  ok('at least one tie per counter, and none where there is no counter',
     stencilBridges(layout.contours, 1.6).length >= 2
     && stencilBridges(layoutFor({ ...DEFAULTS, text: '1' }).contours, 1.6).length === 0,
     `"8" -> ${stencilBridges(layout.contours, 1.6).length} ties`);

  /*
   * The tie takes the SHORTEST way out, which is the whole of "they ruin letter e".
   *
   * The old ties ran from the counter's centre past the top and the bottom of the glyph's
   * bounding box, so on an `e` — whose eye sits above a thin crossbar with the field a
   * millimetre away through it — the tie was the full cap height of the letter and cut it in
   * half. The assertion is not "is there a tie" but "is it short": no tie may be longer than
   * the glyph it crosses, and on an `e` it should be a small fraction of it.
   */
  for (const [ch, limit] of [['e', 0.45], ['8', 0.75], ['0', 0.75], ['a', 0.6]]) {
    const l = layoutFor({ ...DEFAULTS, text: ch, textSize: 60 });
    const capH = l.box.maxY - l.box.minY;
    const ties = stencilBridges(l.contours, 1.6);
    const longest = Math.max(0, ...ties.map((t) => sidesOf(t).length));
    ok(`"${ch}": the tie crosses the stroke rather than the whole letter`,
       ties.length > 0 && longest < capH * limit,
       `longest tie ${longest.toFixed(1)} mm against a ${capH.toFixed(1)} mm glyph `
       + `(limit ${(capH * limit).toFixed(1)})`);
  }

  // A small counter gets one tie, not a symmetric pair — two nicks in a 16 mm eye is just
  // two nicks. A big one is wide enough to carry the pair that reads as deliberate.
  const small = stencilBridges(layoutFor({ ...DEFAULTS, text: 'e', textSize: 16 }).contours, 1.6);
  const big = stencilBridges(layoutFor({ ...DEFAULTS, text: '0', textSize: 90 }).contours, 1.6);
  ok('a small counter is tied once and a large one twice',
     small.length === 1 && big.length === 2, `small ${small.length}, large ${big.length}`);

  // And the counter census the warning is written from.
  for (const [text, n] of [['8', 2], ['0', 1], ['1', 0], ['12', 0], ['e', 1], ['808', 5]]) {
    const found = counterCount(layoutFor({ ...DEFAULTS, text }).contours);
    ok(`"${text}" has ${n} enclosed shape${n === 1 ? '' : 's'}`, found === n, `found ${found}`);
  }

  /*
   * ...and the switch that turns them off, which is only defensible where the plate catches
   * the islands.
   *
   * On a bare plate the cut goes right through, so removing the ties really does drop the
   * counters — three bodies where there was one. That is the failure the ties exist to
   * prevent, and asserting it is what stops the switch quietly becoming a no-op. On a
   * PANELLED plate the same cut stops at the panel: the islands sit on a plate that is still
   * whole, so they print fused to it and the ties are two scars paying for nothing.
   */
  const bare = build({ text: '8', relief: 'recessed', plateThickness: 5, bridgesOn: false });
  ok('without ties, a cut-through stencil drops its counters',
     bodies(bare.parts.find((p) => p.name === 'plate')) === 3,
     `${bodies(bare.parts.find((p) => p.name === 'plate'))} bodies`);

  const panelled = build({
    text: '8', relief: 'recessed', plateThickness: 5,
    panelOn: true, panelInset: 8, panelHeight: 2.5, bridgesOn: false,
  });
  ok('in a panel the plate behind is left whole to catch them',
     bodies(panelled.parts.find((p) => p.name === 'plate')) === 1,
     `${bodies(panelled.parts.find((p) => p.name === 'plate'))} plate bodies`);
  ok('and the panel is the layer that carries the loose islands',
     bodies(panelled.parts.find((p) => p.name === 'panel')) === 3,
     `${bodies(panelled.parts.find((p) => p.name === 'panel'))} panel bodies`);
}

/*
 * A "piece" has to be something you could print.
 *
 * `bevelExtrude` unions a scaled top cap onto the base sharing 0.005 mm of z, and that
 * near-coincident face occasionally leaves manifold holding a zero-thickness scrap. On the
 * Street template with `108` set in Anton it was a four-triangle sheet 0.43 x 1.69 mm across,
 * flat at a single z, of exactly zero volume — and `decompose` counted it, so a sign welded
 * into ONE piece reported "2 separate pieces — they print unattached" and the 3MF carried a
 * phantom object into the slicer. The invariant is the general one, not the one font.
 */
console.log('loose pieces are real pieces');
{
  const anton = fileURLToPath(new URL('../../../../packages/fonts/src/fonts/anton.ttf', import.meta.url));
  const faces = [['the check font', font]];
  if (existsSync(anton)) faces.push(['Anton', opentype.parse(readFileSync(anton).buffer)]);

  const STREET = {
    shape: 'none', divider: 'line', lineThickness: 6, lineOverhang: 8,
    textSize: 70, line2Size: 16, lineSpacing: 0.62, letterSpacing: 0.08,
    text2: 'STREET NAME', mount: 'tape', align: 'center',
  };

  for (const [name, face] of faces) {
    for (const text of ['12', '108', '80', '308']) {
      const params = { ...DEFAULTS, ...STREET, text };
      const layout = getHorizontalContours(
        face, face, params.text, params.text2,
        params.textSize, params.line2Size, 0, params.align,
        params.lineSpacing, params.letterSpacing,
        { alignMode: 'block', placement: params.linePlacement, vAlign: params.vAlign },
      );
      const r = buildSign(wasm, layout.contours, params, layout.lines);
      ok(`${name} "${text}": the Street template welds into one piece`,
         r.parts.length === 1 && !r.warnings.some((w) => /unattached/.test(w)),
         `${r.parts.length} parts, ${JSON.stringify(r.warnings)}`);

      // Nothing emitted may be a zero-volume sheet — that is the actual defect, and it would
      // survive a piece count that happened to come out right for some other reason.
      for (const p of r.parts) {
        const v = p.vertProperties, t = p.triVerts;
        let vol = 0;
        for (let i = 0; i < t.length; i += 3) {
          const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
          vol += (v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2])
                - v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2])
                + v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])) / 6;
        }
        ok(`${name} "${text}": ${p.name} has real volume`, Math.abs(vol) > 0.064,
           `${vol.toFixed(4)} mm3 in ${t.length / 3} triangles`);
      }
    }
  }
}

/* Oversize signs get turned to fit rather than a lecture. */
console.log('bed fit');
{
  const big = build({ text: '12', text2: 'A VERY LONG STREET NAME', linePlacement: 'right', textSize: 40 });
  const turned = big.warnings.some((w) => /Turned \d+°/.test(w));
  const refused = big.warnings.some((w) => /larger than a .* bed at any angle/.test(w));
  ok('an oversize sign is either turned to fit or honestly refused', turned || refused,
     JSON.stringify(big.warnings));
  if (turned) {
    // Rotation is rigid, so the part count and triangle count must be untouched.
    ok('turning does not change the solid', (big.tris.text ?? 0) > 0 && big.parts.length >= 2);
  }
}

console.log('alignment');
{
  const tris = (r) => r.tris.text ?? 0;
  const one = ['left', 'center', 'right'].map((align) => build({ align, text: '12', text2: '' }));
  ok('one line is unaffected by alignment',
     tris(one[0]) === tris(one[1]) && tris(one[1]) === tris(one[2]),
     one.map(tris).join(' / '));

  /*
   * The short line is the one that has to move.
   *
   * Under the shared default, `align` only repositions line 2. On a house sign the short
   * line is almost always line 1 — the number — so the street name slid about while the big
   * number stayed pinned, and from the only seat that matters the control did nothing. With
   * `alignMode: 'block'` both lines are placed inside the block, so the number moves.
   */
  const shortLineX = (align) => {
    const layout = layoutFor({ ...DEFAULTS, align, text: '12', text2: 'ELM STREET' });
    // Line 1 is laid out first, so its contours lead the array; its own box is lines[0].
    return layout.lines[0].minX;
  };
  const [xl, xc, xr] = ['left', 'center', 'right'].map(shortLineX);
  ok('alignment moves the short line (the number), not just the long one',
     xl < xc - 1 && xc < xr - 1, `left ${xl.toFixed(1)} / centre ${xc.toFixed(1)} / right ${xr.toFixed(1)}`);

  const two = ['left', 'center', 'right'].map((align) => build({ align, text: '12', text2: 'ELM STREET' }));
  const widths = two.map((r) => r.size.width);
  ok('two lines are laid out for every alignment', two.every((r) => tris(r) > 0));
  // Whichever way line 2 is pushed, the block is as wide as its widest line, so the plate
  // must not resize. Tolerance rather than equality: glyph outlines are rounded to 3 decimal
  // places on their way out of opentype, so the same width can land a hundredth apart.
  ok('alignment does not change the plate size',
     Math.max(...widths) - Math.min(...widths) < 0.05,
     widths.map((w) => w.toFixed(2)).join(' / '));
}

/*
 * All four sides for the second line, not the two it shipped with.
 *
 * A sign is a rectangle and the second line can go on any edge of the first; offering only
 * `below` and `beside` meant a street name OVER the number, or a unit letter in front of it,
 * was not a sign this generator could make. Each assertion measures where line 2 actually
 * landed relative to line 1, because "it builds" is true of a placement that silently fell
 * back to `below`.
 */
console.log('second line, four ways');
{
  const boxes = (placement) => {
    const l = layoutFor({ ...DEFAULTS, text: '12', text2: 'ELM STREET', linePlacement: placement });
    return { one: l.lines[0], two: l.lines[1] };
  };
  const midY = (b) => (b.minY + b.maxY) / 2;
  const midX = (b) => (b.minX + b.maxX) / 2;

  const below = boxes('below');
  ok('below puts line 2 under line 1', midY(below.two) < midY(below.one),
     `${midY(below.one).toFixed(1)} vs ${midY(below.two).toFixed(1)}`);

  const above = boxes('above');
  ok('above puts line 2 over line 1', midY(above.two) > midY(above.one),
     `${midY(above.one).toFixed(1)} vs ${midY(above.two).toFixed(1)}`);

  /*
   * ...and the two are mirror images, not one of them quietly falling back to the other.
   *
   * Measured on the GAP between the ink boxes, not on their centres. The two lines are set at
   * different sizes, so centre-to-centre differs from side to side by half the difference in
   * cap height — a real 29 mm at 60/18 mm — and a mirror test on centres fails a layout that
   * is a perfect mirror.
   */
  const gapBelow = below.one.minY - below.two.maxY;
  const gapAbove = above.two.minY - above.one.maxY;
  ok('above is the mirror of below, not a repeat of it', Math.abs(gapAbove - gapBelow) < 0.05,
     `gap below ${gapBelow.toFixed(2)} mm, gap above ${gapAbove.toFixed(2)} mm`);

  const right = boxes('right');
  ok('right puts line 2 after line 1', right.two.minX > right.one.maxX - 0.01,
     `line 1 ends ${right.one.maxX.toFixed(1)}, line 2 starts ${right.two.minX.toFixed(1)}`);

  const left = boxes('left');
  ok('left puts line 2 before line 1', left.two.maxX < left.one.minX + 0.01,
     `line 2 ends ${left.two.maxX.toFixed(1)}, line 1 starts ${left.one.minX.toFixed(1)}`);

  ok('left and right are the same row, not a stack',
     Math.abs(midY(left.two) - midY(left.one) - (midY(right.two) - midY(right.one))) < 0.05);

  for (const placement of ['above', 'below', 'left', 'right']) {
    const r = build({ text: '12', text2: 'ELM STREET', linePlacement: placement });
    ok(`${placement} builds a plate and text`, (r.tris.plate ?? 0) > 0 && (r.tris.text ?? 0) > 0);
    const d = build({ text: '12', text2: 'ELM STREET', linePlacement: placement, divider: 'line' });
    ok(`${placement} takes a divider`, (d.tris.text ?? 0) > (r.tris.text ?? 0),
       `${r.tris.text} -> ${d.tris.text}`);
  }

  // A project saved before `right` was called `right`.
  ok('a saved `beside` opens as `right`',
     coerceSettings({ linePlacement: 'beside' }).linePlacement === 'right',
     coerceSettings({ linePlacement: 'beside' }).linePlacement);
}

/*
 * The cross-axis alignment, which had no control at all.
 *
 * Stacked, `align` moves the lines left and right and there is nothing vertical to decide. On
 * one row it is the reverse — both lines are placed by their own advance widths, so `align`
 * has nothing to move and the live question is whether the small line sits on the big one's
 * baseline, against its cap height, or halfway up. There was no way to ask it.
 */
console.log('second line alignment on a row');
{
  const line2 = (vAlign) => layoutFor({
    ...DEFAULTS, text: '12', text2: 'ROOM', textSize: 60, line2Size: 16,
    linePlacement: 'right', vAlign,
  }).lines[1];
  const one = layoutFor({
    ...DEFAULTS, text: '12', text2: 'ROOM', textSize: 60, line2Size: 16, linePlacement: 'right',
  }).lines[0];

  const bottom = line2('bottom'), middle = line2('middle'), top = line2('top');
  ok('bottom keeps the shared baseline', Math.abs(bottom.minY - one.minY) < 0.6,
     `line 2 foot ${bottom.minY.toFixed(2)} vs line 1 ${one.minY.toFixed(2)}`);
  ok('top lines the caps up', Math.abs(top.maxY - one.maxY) < 0.05,
     `line 2 top ${top.maxY.toFixed(2)} vs line 1 ${one.maxY.toFixed(2)}`);
  ok('middle centres it', Math.abs((middle.minY + middle.maxY) / 2 - (one.minY + one.maxY) / 2) < 0.05);
  ok('the three are genuinely different', bottom.minY < middle.minY && middle.minY < top.minY,
     `${bottom.minY.toFixed(1)} / ${middle.minY.toFixed(1)} / ${top.minY.toFixed(1)}`);

  // Stacked, it must change nothing — the control is hidden there and must also be inert.
  const a = build({ text: '12', text2: 'ELM STREET', vAlign: 'top' });
  const b = build({ text: '12', text2: 'ELM STREET', vAlign: 'bottom' });
  ok('vertical alignment is inert when the lines are stacked',
     Math.abs(a.size.height - b.size.height) < 0.01);
}

/*
 * Engraving with the ties off used to say nothing at all, which is how a crescent ends up
 * lying loose on the build plate.
 */
console.log('the dropped-counter warning');
{
  const fires = (over) => build({ text: 'street', relief: 'recessed', textSize: 40, ...over })
    .warnings.some((w) => /drop out/.test(w));
  ok('engraving counters with no ties and no panel warns', fires({ bridgesOn: false }),
     JSON.stringify(build({ text: 'street', relief: 'recessed', textSize: 40, bridgesOn: false }).warnings));
  ok('...and says nothing once the ties are on', !fires({ bridgesOn: true }));
  ok('...nor when a panel is there to catch them',
     !fires({ bridgesOn: false, panelOn: true, panelInset: 8, panelHeight: 2.5 }));
  ok('...nor for text with no enclosed shape at all',
     !build({ text: '12', relief: 'recessed', bridgesOn: false }).warnings.some((w) => /drop out/.test(w)));
}

/*
 * Mounting you can place.
 *
 * Two screw holes were nailed to the horizontal centreline and keyhole slots to a fixed 28%
 * of the width, so a tall sign could only be hung from its middle and a slot cutting into the
 * back of the numeral could not be moved off it at all — it just failed, quietly.
 */
console.log('mounting placement');
{
  const rowY = (offset, shape = 'rect') => {
    const params = { ...DEFAULTS, mount: 'screws', shape, text: '12', mountOffsetY: offset };
    const layout = layoutFor(params);
    const holeRoom = SCREW_HOLE_ROOM_MM;
    const { width } = plateSizeFor(layout.box, params.padding + holeRoom, shape, params.cornerRadius);
    const { height } = plateSizeFor(layout.box, params.padding, shape, params.cornerRadius);
    return { pos: screwHolePositions(width, height, params.mountHoleDia, params.mountInset, offset), height };
  };
  const flat = rowY(0), up = rowY(12), down = rowY(-12);
  ok('the hole row moves up and down',
     up.pos[0][1] - flat.pos[0][1] > 11 && flat.pos[0][1] - down.pos[0][1] > 11,
     `${down.pos[0][1].toFixed(1)} / ${flat.pos[0][1].toFixed(1)} / ${up.pos[0][1].toFixed(1)}`);
  ok('and stays level', up.pos.every((p) => Math.abs(p[1] - up.pos[0][1]) < 1e-9));
  ok('a wild offset is clamped to the plate rather than obeyed',
     Math.abs(rowY(500).pos[0][1]) < rowY(500).height / 2,
     `y ${rowY(500).pos[0][1].toFixed(1)} on a ${rowY(500).height.toFixed(1)} mm plate`);

  // The offset must reach the model, and the plate must survive it: on a pill the width falls
  // away with height, so a hole that fitted on the centreline is out in the air once raised.
  for (const shape of ['rect', 'rounded', 'pill', 'plaque']) {
    for (const offset of [0, 10, 25, -25, 120]) {
      const r = build({ mount: 'screws', shape, text: '12', mountOffsetY: offset, plateHeight: 90 });
      const plate = r.parts.find((p) => p.name === 'plate');
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < plate.vertProperties.length; i += 3) {
        lo = Math.min(lo, plate.vertProperties[i]);
        hi = Math.max(hi, plate.vertProperties[i]);
      }
      // A hole that broke the outline would fuse with the outside and the plate would stop
      // being as tall as it was asked to be.
      ok(`${shape} at ${offset} mm keeps its outline`,
         Math.abs((hi - lo) - r.size.height) < 0.5 && (r.tris.plate ?? 0) > 0,
         `plate spans ${(hi - lo).toFixed(2)} mm, size says ${r.size.height.toFixed(2)}`);
    }
  }

  /*
   * The plate is sized from the TEXT, and nothing about the fixings may move it.
   *
   * `holeRoom` was `mountHoleDia * 2.5`, so dragging the screw size from 2 mm to 8 mm grew the
   * sign by 30 mm, and the same strip was added to the height the moment four holes were
   * switched on — a toggle about where the fixings go silently resizing the plate. Both were
   * reported. The strip itself has to stay, or the holes land on the glyphs; it just has to be
   * a constant.
   */
  const sized = (over) => { const r = build({ mount: 'screws', text: '12', ...over }); return `${r.size.width.toFixed(2)}x${r.size.height.toFixed(2)}`; };
  const byDia = [2, 3, 4.5, 6, 8].map((mountHoleDia) => sized({ mountHoleDia }));
  ok('the screw diameter does not resize the plate', new Set(byDia).size === 1, byDia.join(' / '));
  ok('nor does the four-hole toggle',
     sized({ mountFourHoles: false }) === sized({ mountFourHoles: true }),
     `${sized({ mountFourHoles: false })} vs ${sized({ mountFourHoles: true })}`);
  ok('nor does the hole inset, height or countersink',
     new Set([sized({ mountInset: 3 }), sized({ mountInset: 55 }), sized({ mountOffsetY: 30 })]).size === 1,
     [sized({ mountInset: 3 }), sized({ mountInset: 55 }), sized({ mountOffsetY: 30 })].join(' / '));
  /*
   * ...and an existing sign must come out at exactly the size it always did.
   *
   * The constant is the old expression evaluated at the shipped 4.5 mm screw, so this compares
   * the new build against the width the old formula would have produced. Making a control
   * inert is a fix; quietly resizing every sign already saved is not.
   */
  const asShipped = plateSizeFor(
    layoutFor({ ...DEFAULTS, text: '12' }).box,
    DEFAULTS.padding + DEFAULTS.mountHoleDia * 2.5, DEFAULTS.shape, DEFAULTS.cornerRadius,
  ).width;
  ok('a sign saved before the change opens the same size',
     Math.abs(build({ mount: 'screws', text: '12' }).size.width - asShipped) < 0.01,
     `${build({ mount: 'screws', text: '12' }).size.width.toFixed(2)} vs ${asShipped.toFixed(2)} mm`);

  // Keyholes answer to the same inset the screws do, instead of a fixed fraction of the width.
  const spread = (inset) => keyholePositions(160, 9.9, inset);
  ok('the keyhole inset moves the slots',
     spread(10)[1] - spread(40)[1] > 25,
     `inset 10 -> ${spread(10)[1].toFixed(1)}, 40 -> ${spread(40)[1].toFixed(1)}`);
  ok('and never puts one through the edge',
     spread(0.5)[1] <= 160 / 2 - 9.9 / 2 - 9.9 * 0.6 + 1e-6, `${spread(0.5)[1].toFixed(2)}`);
  ok('no inset keeps the shipped proportion, so an existing hole plan is unchanged',
     Math.abs(keyholePositions(160, 9.9, 0)[1] - 160 * 0.28) < 1e-6);

  const keyY = (offset) => build({
    mount: 'keyhole', text: '12', plateThickness: 6, plateHeight: 120, mountOffsetY: offset,
  });
  ok('a keyhole build survives being moved to either end',
     [0, 40, -40, 200, -200].every((o) => (keyY(o).tris.plate ?? 0) > 0));

  /*
   * The slot landing on the legend, which is the failure that was silent.
   *
   * Engraved, the legend is a void cut right through, so a pocket behind it opens through the
   * face — the sign is a colander. Nothing said so.
   */
  const fouled = build({
    mount: 'keyhole', relief: 'recessed', text: '888', textSize: 70, padding: 4,
    plateThickness: 6, mountOffsetY: -30,
  });
  ok('a keyhole running into the engraved legend says so',
     fouled.warnings.some((w) => /keyhole slot/i.test(w)), JSON.stringify(fouled.warnings));
  const clear = build({ mount: 'keyhole', text: '12', textSize: 40, padding: 22, plateThickness: 6 });
  ok('...and a slot clear of it stays quiet',
     !clear.warnings.some((w) => /keyhole slot/i.test(w)), JSON.stringify(clear.warnings));

  /*
   * Raised text is the case that must NOT warn on overlap alone.
   *
   * A big numeral fills its own plate, so no inset or height can put a slot anywhere but
   * behind it — that is normal for a keyhole sign and the pocket is behind the face, not
   * through it. What matters is the plate left over the pocket, and warning without measuring
   * it made the House template trip its own generator's warning.
   */
  const thin = build({ mount: 'keyhole', text: '12', textSize: 70, padding: 14, plateThickness: 4 });
  ok('a thin plate behind raised text warns',
     thin.warnings.some((w) => /keyhole slot sits behind/i.test(w)), JSON.stringify(thin.warnings));
  const thick = build({ mount: 'keyhole', text: '12', textSize: 70, padding: 14, plateThickness: 7 });
  ok('...and a plate with material to spare does not',
     !thick.warnings.some((w) => /keyhole slot sits behind/i.test(w)), JSON.stringify(thick.warnings));
}

/*
 * Every template has to build clean.
 *
 * The House preset shipped tripping the generator's own keyhole warning, and before that its
 * own thin-plate one — twice, because nothing ever asserted that a starting point starts
 * clean. A template is the first thing a user clicks; a warning on it reads as "this tool is
 * broken", not as advice.
 */
console.log('the templates start clean');
{
  for (const preset of PRESETS) {
    const r = build({ ...preset.patch, text: preset.patch.text2 ? '12' : '12' });
    ok(`${preset.label} builds without a warning`, r.warnings.length === 0,
       JSON.stringify(r.warnings));
    ok(`${preset.label} emits geometry`,
       r.parts.length > 0 && r.parts.every((p) => p.triVerts.length > 0),
       r.parts.map((p) => `${p.name}:${p.triVerts.length / 3}`).join(' '));
  }
}

/*
 * One handle on how big the sign is.
 *
 * Everything that sets the footprint was individually adjustable and nothing moved them
 * together, so "the same sign, but bigger" meant dragging five sliders and hoping. The
 * assertion is that it is a genuine scale — the footprint tracks it linearly and the
 * PROPORTIONS do not move — and that the printing dimensions deliberately stay put.
 */
console.log('overall size');
{
  const at = (scale, over = {}) => {
    const params = atScale({ ...DEFAULTS, text: '12', text2: 'ELM STREET', ...over, scale });
    const layout = layoutFor(params);
    return buildSign(wasm, layout.contours, params, layout.lines);
  };

  const one = at(1), half = at(0.5), twice = at(2);
  ok('the footprint tracks the size',
     Math.abs(twice.size.width - one.size.width * 2) < 0.05
     && Math.abs(half.size.width - one.size.width / 2) < 0.05,
     `${half.size.width.toFixed(1)} / ${one.size.width.toFixed(1)} / ${twice.size.width.toFixed(1)} mm`);
  ok('and the proportions do not move',
     Math.abs(twice.size.width / twice.size.height - one.size.width / one.size.height) < 1e-3,
     `${(one.size.width / one.size.height).toFixed(4)} vs ${(twice.size.width / twice.size.height).toFixed(4)}`);

  // Thickness, text depth, the bevel and the screw are printing decisions, not proportions:
  // scaling them would make a 3x sign a 24 mm slab that no longer fits its own screws.
  const zOf = (r) => {
    const plate = r.parts.find((p) => p.name === 'plate');
    let hi = -Infinity;
    for (let i = 2; i < plate.vertProperties.length; i += 3) hi = Math.max(hi, plate.vertProperties[i]);
    return hi;
  };
  ok('thickness is not swept along with it', Math.abs(zOf(twice) - zOf(one)) < 0.02,
     `${zOf(one).toFixed(2)} vs ${zOf(twice).toFixed(2)} mm`);
  ok('nor is the screw', atScale({ ...DEFAULTS, scale: 3 }).mountHoleDia === DEFAULTS.mountHoleDia);
  ok('nor the bevel or the stencil tie, which are sized by the nozzle',
     atScale({ ...DEFAULTS, scale: 3 }).chamfer === DEFAULTS.chamfer
     && atScale({ ...DEFAULTS, scale: 3 }).bridgeWidth === DEFAULTS.bridgeWidth);

  ok('every template survives being scaled either way',
     PRESETS.every((p) => [0.3, 1, 2.5].every((s) => {
       const r = at(s, p.patch);
       return r.parts.length > 0 && r.parts.every((q) => q.triVerts.length > 0);
     })));

  // A project saved before the control existed has no `scale`, and must open unchanged.
  ok('a project saved before the control opens at its own size',
     coerceSettings({ text: '12' }).scale === 1);
}

/*
 * The band, on a row as well as stacked.
 *
 * The knockout split the glyphs by Y alone — fine while the only two-line layout was one line
 * over another, and wrong the moment they could share a row. Side by side both lines occupy
 * the same band of Y, so every glyph came back as line 2: the number was never unioned back
 * in, and subtracting it from a bar it sits outside removed nothing. It did not go behind the
 * band, it left the model. Measured on the ink, because "it builds" was true throughout.
 */
console.log('the band keeps the number');
{
  const inkArea = (r) => {
    const part = r.parts.find((p) => p.name === 'text');
    if (!part) return 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < part.vertProperties.length; i += 3) {
      lo = Math.min(lo, part.vertProperties[i]);
      hi = Math.max(hi, part.vertProperties[i]);
    }
    return hi - lo;
  };

  /*
   * The Office door template's own proportions, and they are the assertion.
   *
   * A Y-only split misclassifies a line-1 glyph exactly when line 1's centre falls inside
   * line 2's band — which on a shared baseline means whenever line 2 is at least half the
   * height of line 1. At the 60/18 mm default it is not, and the bug hides; at Office door's
   * 30/15 it is, which is where it was found. A first pass at this check used 30/12 and
   * passed cleanly with the bug reinstated, which is worth more than the check itself.
   *
   * Small type also for a second reason: at 60/18 this sign is wider than the 240 mm bed, so
   * the build turns it to fit, and a rotated part has a different x span for a reason that has
   * nothing to do with the band.
   */
  const SMALL = { text: '12', text2: 'MEETING ROOM', textSize: 30, line2Size: 15, padding: 6 };
  for (const placement of ['below', 'above', 'left', 'right']) {
    const band = build({ ...SMALL, divider: 'band', linePlacement: placement });
    const plain = build({ ...SMALL, divider: 'none', linePlacement: placement });
    ok(`${placement}: nothing rotated, so the span is comparable`,
       band.warnings.length === 0 && plain.warnings.length === 0,
       JSON.stringify([...plain.warnings, ...band.warnings]));
    // The bar only ever ADDS material around line 2, so the text body must reach at least as
    // far as it did without it. Losing the number showed up here as a 24 mm collapse.
    ok(`${placement}: the band does not eat the first line`,
       inkArea(band) >= inkArea(plain) - 0.01,
       `text spans ${inkArea(plain).toFixed(1)} mm without the band, ${inkArea(band).toFixed(1)} with it`);
    ok(`${placement}: the band still knocks the second line out`,
       (band.tris.text ?? 0) > 0 && band.parts.length >= 2);
  }

  // ...and the knockout is still a knockout: more letters in the bar means more interior edge.
  const few = build({ ...SMALL, text2: 'II', divider: 'band', linePlacement: 'right' });
  const many = build({ ...SMALL, divider: 'band', linePlacement: 'right' });
  ok('on a row the type is a void in the fill, not a filled slab',
     (many.tris.text ?? 0) > (few.tris.text ?? 0) * 1.4,
     `"II" ${few.tris.text} tris vs "MEETING ROOM" ${many.tris.text}`);

  /*
   * Swept across the size ratio, because the misclassification is a function of it.
   *
   * One pair of sizes tests one point on a curve. Line 2 anywhere from a third to the full
   * height of line 1 crosses the threshold where a Y-only split starts swallowing line 1, so
   * the sweep is what makes this a check on the rule rather than on one template.
   */
  // A short second line, so the whole ratio can be swept without any of it reaching the bed
  // limit — the turn-to-fit rotation is the one thing that makes an x span incomparable, and
  // it is asserted against rather than assumed.
  for (const line2Size of [10, 15, 20, 25, 30]) {
    for (const placement of ['left', 'right']) {
      const over = { ...SMALL, text2: 'ROOM', line2Size, linePlacement: placement };
      const b = build({ ...over, divider: 'band' });
      const p = build({ ...over, divider: 'none' });
      const still = b.warnings.length === 0 && p.warnings.length === 0;
      ok(`${placement} at ${line2Size}/30 mm keeps both lines`,
         still && inkArea(b) >= inkArea(p) - 0.01,
         still ? `${inkArea(p).toFixed(1)} mm -> ${inkArea(b).toFixed(1)} mm`
           : `sign left the bed, so the spans are not comparable: ${JSON.stringify([...p.warnings, ...b.warnings])}`);
    }
  }

  // The template the report came from, exactly as it ships.
  const office = PRESETS.find((x) => x.id === 'office');
  const asShipped = build({ ...office.patch, divider: 'band' });
  const noBand = build({ ...office.patch, divider: 'none' });
  ok('Office door with a band keeps its number',
     inkArea(asShipped) >= inkArea(noBand) - 0.01,
     `${inkArea(noBand).toFixed(1)} mm -> ${inkArea(asShipped).toFixed(1)} mm`);
}

/*
 * Aligning ONE line, which was not possible at all.
 *
 * `align` reached the text layout, where it places two lines against each other inside their
 * own block — so with a single line it had nothing to move and was hidden. The case a user
 * means by "align it left" is one line on a plate they have given a width, and the text sat
 * dead centre of it whatever the control said.
 */
console.log('aligning the text on its plate');
{
  const inkX = (r) => {
    const part = r.parts.find((p) => p.name === 'text');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < part.vertProperties.length; i += 3) {
      lo = Math.min(lo, part.vertProperties[i]);
      hi = Math.max(hi, part.vertProperties[i]);
    }
    return { lo, hi, mid: (lo + hi) / 2 };
  };

  const wide = { text: '12', text2: '', plateWidth: 200, shape: 'rect' };
  const l = inkX(build({ ...wide, align: 'left' }));
  const c = inkX(build({ ...wide, align: 'center' }));
  const r = inkX(build({ ...wide, align: 'right' }));
  ok('a single line moves left, centre and right on a wide plate',
     l.mid < c.mid - 20 && c.mid < r.mid - 20,
     `centres ${l.mid.toFixed(1)} / ${c.mid.toFixed(1)} / ${r.mid.toFixed(1)} mm`);
  ok('centre is still centred', Math.abs(c.mid) < 0.01, `${c.mid.toFixed(3)}`);
  ok('and the two ends are mirror images', Math.abs(l.mid + r.mid) < 0.01,
     `${l.mid.toFixed(2)} vs ${r.mid.toFixed(2)}`);

  // The margin is the limit: aligned hard left, the text stops exactly on it and no closer.
  const params = { ...DEFAULTS, ...wide, align: 'left' };
  const built = build({ ...wide, align: 'left' });
  ok('aligning never pushes the text past its own margin',
     l.lo >= -built.size.width / 2 + params.padding - 0.4,
     `text starts ${l.lo.toFixed(2)} mm, plate edge ${(-built.size.width / 2).toFixed(2)}, margin ${params.padding}`);

  // On an auto-sized plate there is no room, so it must change nothing rather than crop.
  const autoL = inkX(build({ text: '12', text2: '', align: 'left' }));
  const autoR = inkX(build({ text: '12', text2: '', align: 'right' }));
  ok('an auto-sized plate has no room to align within, and does not pretend to',
     Math.abs(autoL.mid - autoR.mid) < 0.01);

  // Every shape solves its own clearance, so every shape has to respect it when sliding.
  for (const shape of ['rect', 'rounded', 'pill', 'plaque']) {
    const b = build({ text: '12', text2: '', shape, plateWidth: 200, align: 'left', padding: 12 });
    const x = inkX(b);
    ok(`${shape}: the text stays inside its margin when aligned left`,
       x.lo >= -b.size.width / 2 + 12 - 0.5,
       `text starts ${x.lo.toFixed(2)} mm on a ${b.size.width.toFixed(0)} mm plate`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
