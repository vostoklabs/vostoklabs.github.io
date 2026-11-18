/*
  The picture window's own rules, without its DOM (the window cannot run in node: it builds its
  layout from an HTML string). The window draws what these modules say, so what is held here is
  what the window does:

   - the colour list (`colourChoices`): the default split, the stepper re-merging by closest
     pair, a filament picked by hand and a merge made by hand kept across stepper presses, "+"
     past the colours found asking for a finer split until there is none, and a window reopened
     on a mapping saved at a finer split opening with the same colours and count, on a picture
     drawn here as well as on a scripted finder;
   - the tools (`wizardTools`): the edit list with Undo, Put everything back and its limit, what
     the row under the preview shows on each view, when "Remove this colour" is offered, what a
     tap does, and what a crop drag leaves.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs picture-window
*/
import { findColours, MAX_PICTURE_EDITS, type ColourCandidate, type PictureEdit, type RgbaImage } from '@vostok/trace';
import { colourChoices } from '../src/ui/colourChoices.ts';
import { CROP_HINT, FULL_HINT, TAP_HINT, canRemoveColour, editList, nextCrop, tapAction, toolsRow } from '../src/ui/wizardTools.ts';
import type { RGB } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const same = (a: RGB, b: RGB) => a.join() === b.join();

/* ---------------------------------------------------------------- a scripted finder */

const black: RGB = [10, 10, 10], white: RGB = [245, 245, 245], red: RGB = [200, 30, 40], pink: RGB = [230, 90, 140];
const dark: RGB = [150, 20, 30], rose: RGB = [240, 150, 180], blush: RGB = [250, 190, 205];
const gold: RGB = [245, 197, 24], teal: RGB = [0, 150, 150];
/** Each finer detail holds the colours of the one below it, exactly, as `findColours` does. */
const LISTS: ColourCandidate[][] = [
  [{ rgb: black, coverage: 0.4 }, { rgb: white, coverage: 0.3 }, { rgb: red, coverage: 0.2 }, { rgb: pink, coverage: 0.1 }],
  [{ rgb: black, coverage: 0.38 }, { rgb: white, coverage: 0.28 }, { rgb: red, coverage: 0.16 }, { rgb: pink, coverage: 0.08 }, { rgb: dark, coverage: 0.06 }, { rgb: rose, coverage: 0.04 }],
  [{ rgb: black, coverage: 0.37 }, { rgb: white, coverage: 0.27 }, { rgb: red, coverage: 0.16 }, { rgb: pink, coverage: 0.07 }, { rgb: dark, coverage: 0.06 }, { rgb: rose, coverage: 0.04 }, { rgb: blush, coverage: 0.03 }],
];
const asked: number[] = [];
const scripted = (d: number) => {
  asked.push(d);
  return LISTS[Math.min(d, LISTS.length - 1)].map((c) => ({ rgb: [...c.rgb] as RGB, coverage: c.coverage }));
};
const kOf = (ch: ReturnType<typeof colourChoices>, rgb: RGB) => ch.candidates.findIndex((c) => same(c.rgb, rgb));
const together = (ch: ReturnType<typeof colourChoices>, a: RGB, b: RGB) => ch.groupOf(kOf(ch, a)) === ch.groupOf(kOf(ch, b));
const filamentOfColour = (ch: ReturnType<typeof colourChoices>, rgb: RGB) => ch.filamentOf(ch.groupOf(kOf(ch, rgb)));
const groups = (ch: ReturnType<typeof colourChoices>) => ch.groupsInOrder().length;

{
  const ch = colourChoices(scripted);
  ch.refresh();
  check('opens with every colour its own filament (four colours: flat art up to five)',
    groups(ch) === 4 && ch.detail === 0 && ch.candidates.every((c) => same(filamentOfColour(ch, c.rgb), c.rgb)), `${groups(ch)} groups`);

  ch.setCount(3);
  check('"-" merges the closest pair, red and pink', groups(ch) === 3 && together(ch, red, pink), ch.countText());
  ch.recolour(kOf(ch, red), gold);
  ch.setCount(4);
  check('"+" takes it apart; red still prints in the gold picked for it, pink in its own colour',
    groups(ch) === 4 && same(filamentOfColour(ch, red), gold) && same(filamentOfColour(ch, pink), pink),
    `red ${hex(filamentOfColour(ch, red))}, pink ${hex(filamentOfColour(ch, pink))}`);

  // A merge made by hand: white printed with black.
  const changedGroups = ch.merge(kOf(ch, white), ch.groupOf(kOf(ch, black)));
  check('a hand merge: white prints with black, the count goes down', changedGroups && groups(ch) === 3 && together(ch, white, black) && same(filamentOfColour(ch, white), black), ch.countText());
  ch.setCount(2);
  check('"-" after a hand merge keeps it, and merges the closest pair as well',
    groups(ch) === 2 && together(ch, white, black) && together(ch, red, pink), JSON.stringify(ch.mapping().colors.map((c) => c.group)));
  ch.setCount(3);
  check('"+" takes apart the closest pair first; the hand merge stays',
    groups(ch) === 3 && together(ch, white, black) && !together(ch, red, pink) && same(filamentOfColour(ch, red), gold),
    JSON.stringify(ch.mapping().colors.map((c) => c.group)));
  ch.setCount(4);
  check('"+" with no other merge left takes the hand merge apart', groups(ch) === 4 && !together(ch, white, black), ch.countText());

  // A colour that does not lead its group, given a filament of its own.
  ch.setCount(3);
  ch.recolour(kOf(ch, pink), teal);
  check('a recolour of a colour that does not lead its group: it leaves the group with that filament',
    groups(ch) === 4 && !together(ch, red, pink) && same(filamentOfColour(ch, pink), teal), ch.countText());
  ch.setCount(3);
  ch.setCount(4);
  check('…and its filament is kept through "-" and "+"', same(filamentOfColour(ch, pink), teal) && same(filamentOfColour(ch, red), gold),
    `pink ${hex(filamentOfColour(ch, pink))}`);

  // Past the colours found: a finer split.
  asked.length = 0;
  ch.setCount(5);
  check('"+" past the colours found asks for a finer split, after the window\'s debounce', ch.wantFiner && asked.length === 0, `asked ${asked.join()}`);
  ch.splitFiner();
  check('the finer split: detail 1, five filaments, the picks kept',
    !ch.wantFiner && ch.detail === 1 && groups(ch) === 5 && ch.candidates.length === 6 && same(filamentOfColour(ch, red), gold) && same(filamentOfColour(ch, pink), teal),
    `detail ${ch.detail}, ${ch.countText()}`);
  ch.setCount(8);
  ch.splitFiner();
  check('asking for more than the finest split has: every colour, the stepper ends there',
    ch.exhausted && ch.detail === 2 && groups(ch) === 7 && ch.stepperTop() === 7 && ch.countText() === '7 filaments, every colour it has',
    `detail ${ch.detail}, top ${ch.stepperTop()}, "${ch.countText()}"`);
  ch.setCount(6);
  check('after the end, "-" merges one: six', groups(ch) === 6 && !ch.wantFiner, ch.countText());

  // Reopened on what was confirmed at the finer split.
  ch.setCount(7);
  const saved = ch.mapping();
  asked.length = 0;
  const again = colourChoices(scripted, saved);
  again.refresh();
  check('reopened on a mapping saved at a finer split: the same colours, the same count, the same filaments',
    again.candidates.length === 7 && groups(again) === 7 && JSON.stringify(again.mapping()) === JSON.stringify(saved),
    `asked details ${asked.join()}; ${again.candidates.length} colours, ${groups(again)} groups`);
  const reopenedAt5 = (() => { const c = colourChoices(scripted); c.refresh(); c.setCount(5); c.splitFiner(); return c.mapping(); })();
  const five = colourChoices(scripted, reopenedAt5);
  five.refresh();
  check('reopened at five filaments of six colours: five, with the same groups',
    groups(five) === 5 && JSON.stringify(five.mapping()) === JSON.stringify(reopenedAt5), five.countText());
  const plain = colourChoices(scripted, { colors: [], filaments: [] });
  plain.refresh();
  check('reopened on an empty mapping: the default split', groups(plain) === 4 && plain.detail === 0, plain.countText());
}

/* ---------------------------------------------------------------- a picture drawn here */

/** Two flat discs, each shaded in three steps out to its rim: a sticker's soft shading. */
function shadedDiscs(): RgbaImage {
  const W = 260, H = 140;
  const data = new Uint8ClampedArray(W * H * 4);
  const discs: { c: RGB; cx: number; cy: number }[] = [{ c: [60, 140, 220], cx: 70, cy: 70 }, { c: [230, 120, 40], cx: 190, cy: 70 }];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const d of discs) {
        const t = Math.hypot(x - d.cx, y - d.cy) / 60;
        if (t > 1) continue;
        const k = t < 0.55 ? 1 : t < 0.8 ? 0.93 : 0.86;
        const o = (y * W + x) * 4;
        data[o] = d.c[0] * k; data[o + 1] = d.c[1] * k; data[o + 2] = d.c[2] * k; data[o + 3] = 255;
      }
    }
  }
  return { data, width: W, height: H };
}
{
  const img = shadedDiscs();
  const find = (d: number) => findColours(img, true, {}, d);
  const ch = colourChoices(find);
  ch.refresh();
  const opened = ch.candidates.length;
  let presses = 0;
  while (!ch.exhausted && presses < 12) {
    ch.setCount(groups(ch) + 1);
    if (ch.wantFiner) ch.splitFiner();
    presses++;
  }
  check('a shaded picture: "+" finds finer colours than it opens with', ch.detail > 0 && ch.candidates.length > opened,
    `opens with ${opened} colours, ends with ${ch.candidates.length} at detail ${ch.detail} after ${presses} presses`);
  const saved = ch.mapping();
  const again = colourChoices(find, saved);
  again.refresh();
  check('…confirmed there and reopened: the same colours and the same count, nothing lost',
    again.detail === ch.detail && groups(again) === groups(ch) && JSON.stringify(again.mapping()) === JSON.stringify(saved),
    `${groups(again)} of ${groups(ch)} groups at detail ${again.detail}`);
}

/* ---------------------------------------------------------------- the tools */

{
  const remove = (x: number): PictureEdit => ({ op: 'remove', x, y: 0.5 });
  const list = editList();
  check('no edits: nothing to undo or put back', !list.undo() && !list.reset() && list.edits.length === 0, '');
  list.push(remove(0.1));
  list.push(remove(0.2));
  list.undo();
  check('Undo takes back the last one only', list.edits.length === 1 && list.edits[0].op === 'remove' && (list.edits[0] as { x: number }).x === 0.1, JSON.stringify(list.edits));
  list.push(remove(0.3));
  check('Put everything back takes all of them', list.reset() && list.edits.length === 0, '');
  for (let i = 0; i < MAX_PICTURE_EDITS; i++) list.push(remove(i / MAX_PICTURE_EDITS));
  check(`at ${MAX_PICTURE_EDITS} the list is full and takes nothing more`, list.full && !list.push(remove(0.5)) && list.edits.length === MAX_PICTURE_EDITS, `${list.edits.length}`);
  list.undo();
  check('one undone: room for one more', !list.full && list.push(remove(0.5)), '');
  const seeded = editList(Array.from({ length: MAX_PICTURE_EDITS + 5 }, (_, i) => remove(i / 300)));
  check('a reopened list keeps at most the limit', seeded.edits.length === MAX_PICTURE_EDITS, `${seeded.edits.length}`);

  const row = (o: Partial<Parameters<typeof toolsRow>[0]>) => toolsRow({ view: 'result', marked: null, edits: 0, full: false, cropped: false, ...o });
  const r0 = row({});
  check('Result, nothing changed: the tap line, no Undo or Put everything back, no Reset crop',
    r0.hint === TAP_HINT && r0.mark === null && !r0.history && !r0.resetCrop, JSON.stringify(r0));
  const r1 = row({ edits: 1 });
  check('after the first edit: Undo and Put everything back show', r1.history && r1.hint === TAP_HINT, JSON.stringify(r1));
  const rm = row({ marked: 'remove', edits: 1 }), rb = row({ marked: 'restore' });
  check('something marked: its button in place of the line, "Remove" or "Bring back"',
    rm.mark === 'Remove' && rm.hint === null && rb.mark === 'Bring back' && rb.hint === null, `${JSON.stringify(rm)} ${JSON.stringify(rb)}`);
  const rf = row({ marked: 'remove', edits: MAX_PICTURE_EDITS, full: true });
  check('at the limit: no Remove, the line says why, Undo still there', rf.mark === null && rf.hint === FULL_HINT && rf.history, JSON.stringify(rf));
  const o0 = row({ view: 'original', edits: 3 }), o1 = row({ view: 'original', cropped: true, marked: 'remove' });
  check('Original: the crop line; Reset crop only once cropped; never the Result\'s tools',
    o0.hint === CROP_HINT && !o0.resetCrop && !o0.history && o0.mark === null && o1.resetCrop && o1.mark === null && !o1.history,
    `${JSON.stringify(o0)} ${JSON.stringify(o1)}`);
  check('Result never shows Reset crop', !row({ cropped: true }).resetCrop, '');

  check('"Remove this colour": only while another colour would be left, and below the limit',
    !canRemoveColour(1, false) && canRemoveColour(2, false) && !canRemoveColour(5, true), '');

  const mark = new Uint8Array(4 * 3);
  mark[1 * 4 + 2] = 1;
  check('a tap off the picture takes the mark off', tapAction(mark, null, 4, false) === 'clear', '');
  check('a tap on the mark again takes it off', tapAction(mark, { px: 2, py: 1 }, 4, false) === 'clear', '');
  check('a tap beside the mark marks what is there', tapAction(mark, { px: 0, py: 0 }, 4, false) === 'mark' && tapAction(null, { px: 0, py: 0 }, 4, false) === 'mark', '');
  check('at the limit a tap marks nothing', tapAction(null, { px: 0, py: 0 }, 4, true) === 'clear', '');

  const half = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const a = nextCrop(null, half);
  check('a crop drag: the crop is the box, changed', a.changed && !a.showWhole && JSON.stringify(a.crop) === JSON.stringify(half), JSON.stringify(a));
  const b = nextCrop(a.crop, { ...half });
  check('the same box again: unchanged, the same crop kept', !b.changed && b.crop === a.crop, JSON.stringify(b));
  const c = nextCrop(a.crop, { x: 0.002, y: 0, w: 0.997, h: 0.999 });
  check('pulled out to within a hair of the picture: no crop, and the box goes back to the whole picture',
    c.changed && c.crop === null && c.showWhole, JSON.stringify(c));
  const d = nextCrop(null, { x: 0, y: 0, w: 1, h: 1 });
  check('the whole picture with no crop: nothing changed', !d.changed && d.crop === null && d.showWhole, JSON.stringify(d));
}

console.log(failures ? `\n${failures} FAILED` : '\nthe picture window keeps its rules');
process.exit(failures ? 1 : 0);
