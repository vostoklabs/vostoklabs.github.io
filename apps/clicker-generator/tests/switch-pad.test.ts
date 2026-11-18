/*
  The Switch category's d-pad and the box a switch is held in (src/ui/switchPad.ts): one press is
  0.5 mm on one axis, never past the box the build clamps switches into, always on the 0.1 mm
  grid; and the one hold rule the 2D view, its drag and the pad share.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs switch-pad
*/
import { holdInBox, litSwitch, nudgeSwitch, padPress, sliderReach, SWITCH_PAD_STEP_MM, SWITCH_PAD_TURN_DEG, switchPadHasRoom, switchReach, turnSwitch, type SwitchReach } from '../src/ui/switchPad.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const show = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`;

const BOX: SwitchReach = { loX: -10.2, hiX: 10.2, loY: -6.35, hiY: 6.35 };

{
  const at = { x: 1, y: -1 };
  const got = (['right', 'left', 'up', 'down'] as const).map((d) => nudgeSwitch(at, BOX, d));
  const want = [{ x: 1.5, y: -1 }, { x: 0.5, y: -1 }, { x: 1, y: -0.5 }, { x: 1, y: -1.5 }];
  check('each arrow moves 0.5 mm on its own axis: right +x, left -x, up +y, down -y',
    SWITCH_PAD_STEP_MM === 0.5 && JSON.stringify(got) === JSON.stringify(want), got.map(show).join(' '));
}
{
  const edge = nudgeSwitch({ x: 10.2, y: 0 }, BOX, 'right');
  check('a press at the edge leaves it there', edge.x === 10.2, show(edge));
  const over = nudgeSwitch({ x: 10, y: 0 }, BOX, 'right');
  check('a press that would go past the edge stops on it', over.x === 10.2, show(over));
  const top = nudgeSwitch({ x: 0, y: 6.1 }, BOX, 'up');
  check('an edge off the 0.1 grid: the press stops on the grid inside it (6.35 → 6.3)', top.y === 6.3, show(top));
  const bottom = nudgeSwitch({ x: 0, y: -6.1 }, BOX, 'down');
  check('…and the low edge rounds up, not down (-6.35 → -6.3)', bottom.y === -6.3, show(bottom));
}
{
  const out = { x: 30, y: 0 };
  const dirs = ['up', 'down'] as const;
  const got = dirs.map((d) => nudgeSwitch(out, BOX, d));
  check('a switch saved outside the box comes into view on any press, even one on the other axis',
    got.every((p) => p.x === 10.2) && got[0].y === 0.5 && got[1].y === -0.5, got.map(show).join(' '));
  const left = nudgeSwitch(out, BOX, 'left');
  check('…and a press towards the middle starts from where it is drawn', left.x === 9.7, show(left));
}
{
  const off = nudgeSwitch({ x: 3.27, y: 0 }, BOX, 'right');
  check('a value off the grid lands on it (3.27 + 0.5 → 3.8)', off.x === 3.8, show(off));
}
{
  const flat: SwitchReach = { loX: 2, hiX: -2, loY: -5, hiY: 5 };
  const r = nudgeSwitch({ x: 7, y: 1 }, flat, 'right');
  check('an axis with no room holds the switch at its middle and does not move it', r.x === 0 && r.y === 1, show(r));
  const u = nudgeSwitch({ x: 7, y: 1 }, flat, 'up');
  check('…while the other axis still moves', u.x === 0 && u.y === 1.5, show(u));
}
{
  const before = switchReach(null, 40);
  check('before a first build the reach is the base: ±20 on a 40 mm cap',
    before.loX === -20 && before.hiX === 20 && before.loY === -20 && before.hiY === 20, JSON.stringify(before));
  check('after a build it is the build\'s box', switchReach(BOX, 40) === BOX, JSON.stringify(switchReach(BOX, 40)));
}
{
  const cases: [SwitchReach, boolean][] = [
    [BOX, true],
    [{ loX: 0, hiX: 0, loY: -1, hiY: 1 }, true],
    [{ loX: -1, hiX: 1, loY: 2, hiY: -2 }, true],
    [{ loX: 0, hiX: 0, loY: 0, hiY: 0 }, false],
    [{ loX: 1, hiX: -1, loY: 3, hiY: -3 }, false],
  ];
  const got = cases.map(([r]) => switchPadHasRoom(r));
  check('the pad hides only when neither axis has room', got.every((g, i) => g === cases[i][1]), got.join(','));
}
{
  let p = { x: 0, y: 0 };
  for (let i = 0; i < 8; i++) p = nudgeSwitch(p, BOX, 'right');
  check('eight presses right from 0 read 4 exactly (no drift from rounding)', p.x === 4 && p.y === 0, show(p));
  for (let i = 0; i < 30; i++) p = nudgeSwitch(p, BOX, 'right');
  check('…held on, it stops at the edge', p.x === 10.2, show(p));
}
{
  const got = [holdInBox(5, -1, 1), holdInBox(-5, -1, 1), holdInBox(0.3, -1, 1), holdInBox(4, 3, -1)];
  check('holdInBox: inside stays, outside is held at the edge, no room is the middle',
    JSON.stringify(got) === JSON.stringify([1, -1, 0.3, 1]), JSON.stringify(got));
}
// ---- what the Switch category does with it (ui.ts: the pad's onMove and update())
{
  const r = sliderReach(BOX);
  check('the sliders range over the box pulled in onto their 0.5 mm step',
    r.loX === -10 && r.hiX === 10 && r.loY === -6 && r.hiY === 6, JSON.stringify(r));
  const before = sliderReach(switchReach(null, 41.4));
  check('before a first build: half the cap, on the step (±20.5 on a 41.4 mm cap)', before.loX === -20.5 && before.hiX === 20.5, JSON.stringify(before));
  const thin: SwitchReach = { loX: 0.1, hiX: 0.4, loY: -0.2, hiY: 0.2 };
  check('a box narrower than a step on both axes: no slider, so no pad either',
    switchPadHasRoom(thin) && !switchPadHasRoom(sliderReach(thin)), JSON.stringify(sliderReach(thin)));
  check('one axis with a step of room: the pad shows', switchPadHasRoom(sliderReach({ loX: -1, hiX: 1, loY: 0, hiY: 0 })), '');
}
{
  const state = {
    activeSwitchIndex: 1,
    switches: [{ x: -5, y: 0 }, { x: 5, y: 0 }],
    switchBox: BOX,
    capWidthMm: 40,
  };
  const got = padPress(state, 'right');
  check('a press moves the lit switch 0.5 mm, and names it', JSON.stringify(got) === JSON.stringify({ index: 1, x: 5.5, y: 0 }), JSON.stringify(got));
  const up = padPress(state, 'up');
  check('up moves it on y only', JSON.stringify(up) === JSON.stringify({ index: 1, x: 5, y: 0.5 }), JSON.stringify(up));
  const stale = padPress({ ...state, activeSwitchIndex: 4 }, 'left');
  check('a lit index past the switches there are is the last one', stale?.index === 1 && stale.x === 4.5, JSON.stringify(stale));
  check('litSwitch: below 0 is the first', litSwitch({ activeSwitchIndex: -1, switches: [1, 2] }) === 0, '');
  check('no switch: no press', padPress({ ...state, switches: [] }, 'right') === null, '');
  const unbuilt = padPress({ ...state, switchBox: null, switches: [{ x: 19.8, y: 0 }], activeSwitchIndex: 0 }, 'right');
  check('before a first build a press is held on the base (20 on a 40 mm cap)', unbuilt?.x === 20, JSON.stringify(unbuilt));
}

// ---- the rotate corners: one press turns the lit switch one step, inside the Turn slider's range
{
  check('a rotate press is 15°', SWITCH_PAD_TURN_DEG === 15, String(SWITCH_PAD_TURN_DEG));
  const cases: [number, number, number][] = [
    [0, 15, 15], [0, -15, -15], [170, 15, -175], [-170, -15, 175], [165, 15, 180], [-165, -15, -180], [180, 15, -165], [-180, -15, 165], [45, 0, 45],
  ];
  const bad = cases
    .filter(([r, d, want]) => turnSwitch(r, d) !== want)
    .map(([r, d, want]) => `${r}${d >= 0 ? '+' : ''}${d} = ${turnSwitch(r, d)}, want ${want}`);
  check('a turn adds the step and wraps inside -180..180', bad.length === 0, bad.join('; '));
}

if (failures) {
  console.error(`\nswitch-pad: ${failures} failed`);
  process.exit(1);
}
console.log('\nswitch-pad: all passed');
