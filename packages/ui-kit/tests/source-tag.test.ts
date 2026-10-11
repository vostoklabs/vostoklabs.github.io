/*
  The value-source tag and `setTag()`, in a stand-in document (support/mini-dom.ts) with the
  kit's stylesheets cascaded onto it (support/cascade.ts).

  `sourceTag()` names the level a value comes from and, set at that level, turns accent with a
  reset. `setTag()` on a slider, stepper, switch, option tabs, dropdown and nudge pad puts a node
  at the end of the control's caption line; never called, the control is what it always was, and
  taken off again (`null`), the markup is back to what it was byte for byte.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { el } from '../src/dom';
import { contrastRatio } from '../src/components/filament';
import { sourceTag } from '../src/components/source-tag';
import {
  segmentedControl,
  selectField,
  sliderRow,
  stepperRow,
  toggleSwitch,
  type Taggable,
} from '../src/components/controls';
import { nudgePad } from '../src/components/nudge-pad';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

/** Markup with the counter ids renumbered from the start, so two builds compare. */
function norm(node: unknown): string {
  const seen = new Map<string, string>();
  return html(node as MiniElement).replace(/\b(vl-[a-z]+)-(\d+)\b/g, (m, prefix: string) => {
    if (!seen.has(m)) seen.set(m, `${prefix}-#${seen.size}`);
    return seen.get(m)!;
  });
}
const mini = (node: unknown) => node as MiniElement;
const styles = (markup: string) => (markup.match(/ style="/g) ?? []).length;

/* ------------------------------------------------------------------- the tag */

{
  let resets = 0;
  const tag = sourceTag({ label: 'Board', onReset: () => resets++ });
  const t = mini(tag);
  const reset = t.querySelector('.vl-source-tag__reset')!;
  check('sourceTag: names the level', t.querySelector('.vl-source-tag__label')!.textContent === 'Board' && t.classList.contains('vl-source-tag'));
  check('sourceTag: inherited, it is quiet and has nothing to reset', !t.classList.contains('vl-source-tag--local') && reset.hidden);
  check('sourceTag: the reset is a real button with a name', reset.localName === 'button' && reset.getAttribute('type') === 'button' && reset.getAttribute('aria-label') === 'Back to the level above');
  tag.set({ label: 'Key', local: true });
  check('sourceTag: set() renames it and marks it set here', t.querySelector('.vl-source-tag__label')!.textContent === 'Key' && t.classList.contains('vl-source-tag--local') && !reset.hidden);
  reset.click();
  check('sourceTag: the reset calls onReset', resets === 1);
  tag.set({ label: 'Numbers' });
  check('sourceTag: set() without local is inherited again', !t.classList.contains('vl-source-tag--local') && reset.hidden && t.textContent === 'Numbers');
  check('sourceTag: no inline style', styles(html(t)) === 0);
  const local = mini(sourceTag({ label: 'Key', local: true }));
  check('sourceTag: built local, it starts in the accent with its reset', local.classList.contains('vl-source-tag--local') && !local.querySelector('.vl-source-tag__reset')!.hidden);
}

/* --------------------------------------------------------- setTag on each control */

interface Case {
  name: string;
  build: () => Taggable & HTMLElement;
  /** Where the slot must land: [its parent's class or tag, the class of the next sibling or null]. */
  where: (root: MiniElement, slot: MiniElement) => boolean;
  /** The caption that has to become a line of its own, if any. */
  line?: (root: MiniElement) => MiniElement;
}

const CASES: Case[] = [
  {
    name: 'sliderRow',
    build: () => sliderRow({ label: 'Depth', min: 0, max: 2, step: 0.1, value: 0.5, unit: 'mm', help: 'How deep.' }),
    where: (r, s) => s.parentNode === r.querySelector('.vl-slider-head') && !!s.nextElementSibling?.classList.contains('vl-val-fit'),
  },
  {
    name: 'sliderRow with a default mark',
    build: () => sliderRow({ label: 'Depth', min: 0, max: 2, step: 0.1, value: 0.5, defaultValue: 0.6 }),
    where: (r, s) => !!s.previousElementSibling?.classList.contains('vl-default-mark') && !!s.nextElementSibling?.classList.contains('vl-val-fit'),
  },
  {
    name: 'stepperRow',
    build: () => stepperRow({ label: 'Legends', min: 1, max: 3, value: 2 }),
    where: (r, s) => s.parentNode === r.querySelector('.vl-slider-head') && s.nextElementSibling === null,
  },
  {
    name: 'toggleSwitch',
    build: () => toggleSwitch({ label: 'Homing bump', help: 'A bump to find by touch.' }),
    where: (r, s) => s.parentNode === r && s.previousElementSibling?.localName === 'label' && !!s.nextElementSibling?.classList.contains('vl-toggle'),
  },
  {
    name: 'segmentedControl',
    build: () => segmentedControl({ label: 'Legends', help: 'How many.', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }] }),
    where: (r, s) => s.parentNode === r.querySelector('.vl-control-label') && s.nextElementSibling === null,
    line: (r) => r.querySelector('.vl-control-label')!,
  },
  {
    name: 'selectField',
    build: () => selectField({ label: 'Font', options: [{ value: 'a', label: 'A' }] }),
    where: (r, s) => s.parentNode === r.querySelector('label') && s.nextElementSibling === null,
    line: (r) => r.querySelector('label')!,
  },
  {
    name: 'nudgePad with a label',
    build: () => nudgePad({ label: 'Nudge', x: { label: 'X' }, y: { label: 'Y' } }),
    where: (r, s) => s.parentNode === r.querySelector('.vl-control-label') && s.nextElementSibling === null,
    line: (r) => r.querySelector('.vl-control-label')!,
  },
];

for (const c of CASES) {
  const fresh = norm(c.build());
  const row = c.build();
  const r = mini(row);
  check(`${c.name}: built, it has no slot and no tagged caption`, !fresh.includes('vl-tag-slot') && !fresh.includes('vl-caption--tagged'));
  const tag = sourceTag({ label: 'Board' });
  row.setTag(tag);
  const slot = r.querySelector('.vl-tag-slot')!;
  check(`${c.name}: setTag puts the tag in one slot`, !!slot && slot.children.length === 1 && slot.firstElementChild === mini(tag) && r.querySelectorAll('.vl-tag-slot').length === 1);
  check(`${c.name}: the slot is at the end of the caption line`, c.where(r, slot), html(r));
  if (c.line) check(`${c.name}: its caption becomes a line while it holds the tag`, c.line(r).classList.contains('vl-caption--tagged'));
  check(`${c.name}: no inline style for it`, styles(html(r)) === styles(fresh));
  const other = sourceTag({ label: 'Key', local: true });
  row.setTag(other);
  check(`${c.name}: a second setTag replaces the first`, r.querySelectorAll('.vl-tag-slot').length === 1 && r.querySelector('.vl-tag-slot')!.firstElementChild === mini(other) && !r.contains(mini(tag)));
  row.setTag(null);
  check(`${c.name}: setTag(null) gives back exactly what was built`, norm(row) === fresh, norm(row));
  row.setTag(null);
  check(`${c.name}: a second null is harmless`, norm(row) === fresh);
}

{
  // A tag is placed, not wired: the control goes on working with one on its caption.
  let seen = -1;
  const s = sliderRow({ label: 'Size', min: 1, max: 10, value: 3, onInput: (v) => (seen = v) });
  s.setTag(sourceTag({ label: 'Numbers', local: true }));
  s.setValue(5, true);
  check('a tagged slider still takes and reports its value', seen === 5 && s.getValue() === 5);
  const sw = toggleSwitch({ label: 'Mirror' });
  sw.setTag(sourceTag({ label: 'Board' }));
  const input = mini(sw).querySelector('input')!;
  check('a tagged switch keeps its caption pointing at its checkbox', mini(sw).querySelector('label')!.getAttribute('for') === input.id);
}

/* A control with no caption line has nowhere to put one: it says so instead of dropping it. */
{
  const bare = segmentedControl({ options: [{ value: 'a', label: 'A' }] });
  let threw = '';
  try { bare.setTag(sourceTag({ label: 'Board' })); } catch (e) { threw = (e as Error).message; }
  check('segmentedControl without a caption: setTag throws, naming the fix', /segmentedControl.*label/.test(threw), threw);
  let nullThrew = false;
  try { bare.setTag(null); } catch { nullThrew = true; }
  check('segmentedControl without a caption: setTag(null) is harmless', !nullThrew);
  const pad = nudgePad({ x: { label: 'X' }, y: { label: 'Y' } });
  threw = '';
  try { pad.setTag(sourceTag({ label: 'Board' })); } catch (e) { threw = (e as Error).message; }
  check('nudgePad without a label: setTag throws, naming the fix', /nudgePad.*label/.test(threw), threw);
}

/* ------------------------------------------------------- the nudge pad's caption */

{
  const build = (label?: string, help?: string) =>
    nudgePad({ x: { label: 'X', id: 'offxNum' }, y: { label: 'Y', id: 'offyNum' }, ...(label === undefined ? {} : { label }), ...(help ? { help } : {}) });
  const plain = norm(build());
  check('nudgePad: no label builds no caption, as before', !plain.includes('vl-control') && mini(build()).classList.contains('vl-nudge'));
  check('nudgePad: label: undefined builds what the default builds', norm(build(undefined)) === plain);
  const labelled = mini(build('Nudge', 'Move the legend a little.'));
  const body = labelled.querySelector('.vl-nudge')!;
  const cap = labelled.querySelector('.vl-control-label')!;
  check('nudgePad label: a caption line over the pad', labelled.classList.contains('vl-control') && labelled.firstElementChild === cap && cap.textContent.startsWith('Nudge') && !!cap.querySelector('.vl-help'));
  check('nudgePad label: the pad and its numbers are a group named by it', body.getAttribute('role') === 'group' && body.getAttribute('aria-labelledby') === cap.firstElementChild!.id);
  /** Ids renumbered per prefix, so a caption's id does not shift the pad's own. */
  const byPrefix = (node: unknown) => {
    const seen = new Map<string, string>();
    const counts = new Map<string, number>();
    return html(node as MiniElement).replace(/\b(vl-[a-z]+)-(\d+)\b/g, (m, prefix: string) => {
      if (!seen.has(m)) {
        const n = counts.get(prefix) ?? 0;
        counts.set(prefix, n + 1);
        seen.set(m, `${prefix}-#${n}`);
      }
      return seen.get(m)!;
    });
  };
  check('nudgePad label: the pad itself is built as before, named by the caption',
    byPrefix(body).replace(' role="group" aria-labelledby="vl-cap-#0"', '') === byPrefix(build()), byPrefix(body));
  const pad = build('Nudge');
  pad.setValue({ x: 1.5, y: -2 });
  check('nudgePad label: still a ValueRow (setValue, getValue)', pad.getValue().x === 1.5 && pad.getValue().y === -2);
  pad.setDisabled(true);
  check('nudgePad label: setDisabled greys the whole captioned control', mini(pad).classList.contains('vl-control--disabled'));
}

/* ------------------------------------------- what the stylesheet does, in both themes */

{
  const rules = kitRules();
  const v = (e: unknown, prop: string) => cssValue(e as MiniElement, prop, rules, 1280);
  const mount = (node: unknown) => {
    miniDocument.body.replaceChildren(node as MiniElement);
    return node as MiniElement;
  };
  const panelColour = () => v(mount(el('div', { attrs: { style: 'background: var(--panel)' } })), 'background');

  for (const theme of ['dark', 'light'] as const) {
    miniDocument.documentElement.setAttribute('data-theme', theme);
    const panel = panelColour();
    const inherited = mount(sourceTag({ label: 'Board' }));
    const quiet = v(inherited, 'color');
    check(`${theme}: an inherited tag is muted, ${contrastRatio(quiet, panel).toFixed(2)}:1 on the panel (>= 4.5)`, /^#/.test(quiet) && contrastRatio(quiet, panel) >= 4.5, `${quiet} on ${panel}`);
    const local = mount(sourceTag({ label: 'Key', local: true }));
    const accent = v(local, 'color');
    check(`${theme}: a tag set here is the accent, ${contrastRatio(accent, panel).toFixed(2)}:1 on the panel (>= 4.5)`, accent !== quiet && contrastRatio(accent, panel) >= 4.5, `${accent} on ${panel}`);
    const reset = local.querySelector('.vl-source-tag__reset')!;
    const resetInk = v(reset, 'color');
    const resetGround = v(reset, 'background');
    check(`${theme}: the reset's arrow reads on its own ground, ${contrastRatio(resetInk, resetGround).toFixed(2)}:1 (>= 3)`, contrastRatio(resetInk, resetGround) >= 3, `${resetInk} on ${resetGround}`);
  }
  miniDocument.documentElement.removeAttribute('data-theme');

  const tag = mount(sourceTag({ label: 'Board' }));
  check('the tag is small caps text, the metadata size', v(tag, 'font-size') === '11px' && v(tag, 'text-transform') === 'uppercase');
  check('a hidden reset is not drawn', v(tag.querySelector('.vl-source-tag__reset'), 'display') === 'none');
  check('the tag fades its colour on the hover tier, never a hand-typed time', /var\(--dur-hover\)|110ms/.test(v(tag, 'transition')), v(tag, 'transition'));

  const slider = sliderRow({ label: 'Depth', min: 0, max: 2, value: 1, unit: 'mm' });
  slider.setTag(sourceTag({ label: 'Board' }));
  mount(slider);
  const head = mini(slider).querySelector('.vl-slider-head')!;
  // A narrow panel cannot hold caption, tag and value box on one line: the tag goes under the
  // caption and the value box stands beside both, rather than wrapping onto a line of its own.
  check('slider: a tagged head is a grid', v(head, 'display') === 'grid', v(head, 'display'));
  check("slider: the tag is on the caption's second line", v(head.querySelector('.vl-tag-slot'), 'grid-row') === '2' && v(head.querySelector('.vl-tag-slot'), 'margin-left') === '0');
  check('slider: the value box stands beside caption and tag', v(head.querySelector('.vl-val-fit'), 'grid-column') === '3' && v(head.querySelector('.vl-val-fit'), 'margin-left') === '0');
  const plainSlider = mount(sliderRow({ label: 'Depth', min: 0, max: 2, value: 1 }));
  check('slider without a tag: the head is the row it always was', v(plainSlider.querySelector('.vl-slider-head'), 'display') === 'flex');
  check('slider without a tag: the value box keeps its margin', v(plainSlider.querySelector('.vl-val-fit'), 'margin-left') === 'auto');
  const capMax = v(plainSlider.querySelector('.vl-slider-head > label'), 'max-width');
  check('slider: a long caption may not take the value box room, so it wraps itself instead of the box',
    /calc\(100% - 96px - (var\(--space-2\)|8px)\)/.test(capMax), capMax);

  const sw = toggleSwitch({ label: 'Mirror' });
  sw.setTag(sourceTag({ label: 'Board' }));
  mount(sw);
  check('switch: the tag sits beside the switch, away from the caption', v(mini(sw).querySelector('.vl-tag-slot'), 'margin-left') === 'auto');

  const tabs = segmentedControl({ label: 'Legends', options: [{ value: '1', label: '1' }] });
  tabs.setTag(sourceTag({ label: 'Board' }));
  mount(tabs);
  const line = mini(tabs).querySelector('.vl-control-label')!;
  check('caption over a control: a flex line while it holds a tag, the tag at its end', v(line, 'display') === 'flex' && v(line.querySelector('.vl-tag-slot'), 'margin-left') === 'auto');
  tabs.setTag(null);
  check('caption over a control: back to its own display once the tag is off', v(line, 'display') === '');
}

console.log(`\nsource tag: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
