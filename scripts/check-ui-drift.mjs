#!/usr/bin/env node
/*
  pnpm check:ui

  The build's opinion about the UI layer, and the reason nobody has to track this by hand.

  ## Why this exists

  `@vostok/ui-kit` has looked like a design system since it shipped, and for the chrome it
  is one. For the single most common control in the product it was a **stylesheet**:
  `.vl-btn` and its whole ladder — primary, secondary, ghost, icon, block, busy — lived in
  `base.css` with no `button()` anywhere, so every app built its own `<button>` and tried
  to remember the class by hand.

  Mostly they did not. On the day this check was written the apps held 163 hand-built
  buttons wearing `class="tab"`, `class="primary"` and `class="switch-pad-btn"` — none of
  which the kit defines — plus 7,588 lines of app-local CSS against the kit's 1,887. A
  stylesheet can only style what opts into it by name, which is why fixing one button has
  never once fixed the others, and why "the apps look different" was never a discipline
  problem: it was a missing layer.

  The layer is now `packages/ui-kit/src/components/button.ts`. This file is what keeps it.

  ## The three checks

  1. **Hand-built controls** — a raw `<button>`/`<select>`/`<input>`/`<textarea>`, or an
     `el('button')`/`createElement('button')`, in app code where a kit component exists.
     **Ratcheted**: 163 buttons cannot be fixed in one commit and should not block every
     commit until they are, so each baseline holds today's line and the check fails only
     when a count goes *up*. When one falls it prints the new baseline and asks for it to
     be lowered, so ground gained is never given back.

  2. **Tokens that resolve nowhere** — a `var(--x)` no stylesheet declares. **Hard
     failure**, because an unresolvable `var()` invalidates the whole declaration and the
     property silently falls back to its initial value. Nothing else in CI notices.

  3. **Class names with no rule** — a class used in `.ts`/`.html` that no stylesheet
     defines. **Hard failure.** The element renders unstyled and nothing reports it. This
     found `.vl-topbar-btn--theme`, which the kit's own topbar has been setting on the
     theme button for months against no rule at all.

  Checks 2 and 3 carry a named list of what was already broken when the check was written,
  rather than a count — so a *new* one always fails, and fixing an old one is a deletion
  from the list. The lists are the to-do; they are not permission.

  Run by CI (`.github/workflows/check.yml`) and on its own with `pnpm check:ui`.
*/

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
  The baselines, and the only numbers to edit.

  Lower one whenever the check tells you to. Never raise one: if a change genuinely needs
  a control the kit cannot express, widen the component, not the budget.

  2026-08-25, the day `button()` landed. Where the 163 buttons sit:
    83  apps/clicker-generator/src/ui/ui.ts
    22  apps/magnet-generator/src/mount.ts
    13  apps/kit-demo/src/main.ts
    12  apps/bubble-pop-generator/src/main.ts
     9  apps/name-keychain/src/mount.ts
     6  apps/pen-topper/src/main.ts
    ...and a long tail of three and two. Clicker's `switch-pad-btn` d-pad and its rows of
    `class="tab"` are the two biggest single wins — `dpad()` and `segmentedControl()`
    already express both.
    range     eleven hand-built sliders, every one of which `sliderRow` already expresses
    input     the colour wells and text fields the kit has no component for yet
*/
const BUDGET = {
  // 163 -> 138 on 2026-08-26: wave 1 of the migration moved every `el('button')` that was
  // already wearing a `vl-btn` class onto `button()`. What is left is either a control the
  // kit does not express yet (chips, cards, pickers) or a `<button>` written inside an
  // `innerHTML` template literal, which cannot be swapped without restructuring the block.
  // 138 -> 118 on 2026-08-26: wave 3 moved the app-local chips, cards, rows, steppers and
  // mode bars onto the kit components that already expressed them. Most were re-derivations
  // of `.vl-source-card`, `.vl-swatch`, `.vl-stepper` and `modeBar` under app-local names.
  // 118 -> 106 on 2026-08-26: the clicker's two d-pads. Twelve `<button class="switch-pad-btn">`
  // elements written into the sidebar innerHTML, plus their delegated [data-dir]/[data-rot]/
  // [data-nudge] listeners, replaced by two `dpad()` calls. The kit's dpad was ported FROM
  // this control originally, so it went home.
  // 106 -> 95 on 2026-08-26: four `<div class="tabs">` rows of hand-built `<button class="tab">`
  // became `segmentedControl()` calls. Each had TWO halves that could disagree — a delegated
  // click listener and a separate loop toggling `.active` — and the component is both.
  // 95 -> 93 on 2026-08-26: shapeTypeTabs, the fifth and last static tab row. It needed a
  // new `setOptionVisible()` on segmentedControl — icon mode hides the Outline option, and
  // hiding a child from app CSS leaves a dead grid column for the indicator to travel into.
  // 93 -> 71 on 2026-08-26: the final sweep across the independent app files. What is left
  // is concentrated in clicker/ui/ui.ts, plus a handful of controls the kit deliberately
  // does not express (a floating colour popover, a live-glyph font card).
  // 71 -> 61 on 2026-08-31: the clicker's welcome modal, "what's new" modal and ten-step
  // tour, deleted rather than migrated. Three overlays stacked on first load, and the middle
  // one told first-time visitors what had changed "since your last visit". What was worth
  // keeping — the changelog — is now `changelogButton()` behind a button people press.
  // 61 -> 58 on 2026-08-31: the edit-mode bar (Color / Extrude), migrated to the kit's
  // modeBar(). It was the last hand-built tab row in an app where five others already slide,
  // which is what made it read as unfinished. Also deleted the two duplicate sync loops that
  // both toggled .active from [data-editmode].
  // 58 -> 56 on 2026-08-31: the licence modal and reminder toast, which the clicker had
  // re-derived locally. The kit pair guards on isDesktop(), reads prices from @vostok/brand and
  // manages focus; the local copy did none of those and hardcoded a creativecommons.org URL.
  // 56 -> 53 on 2026-09-01: undo / refresh / redo. They were hand-built inside `.btn-row`, a
  // TWO-column grid, so the third wrapped onto its own line. `buttonRow()` is flex, so the count
  // lives in the markup instead of in a column template nobody remembers to update.
  // 53 -> 49 on 2026-09-03: the clicker's keyring position controls. Two hand-built
  // `.tol-stepper` rows — rotate around the edge, slide along it — became one `dpad()`. They
  // were asking almost the same question twice: both move the loop ALONG the body edge, and on
  // a circle they are the same motion.
  // 49 -> 26 on 2026-09-04: the clicker's import-source cards, active-switch chips and both
  // edge-style pickers (segmentedControl(), the last four hand-built tab rows in the file);
  // the keychain hole-size and Raise-panel steppers (stepperRow()); and the palette rows
  // (filamentRow()), which took most of the count with them since each `.fil-row` carried
  // its own `<button class="fil-chip">`.
  // 26 -> 22 on 2026-09-04: continued palette-row migration in the same pass.
  button: 22,
  // 2 -> 1 on 2026-09-02: the clicker's base-shape `<select>`. It held seven options and the
  // shape directory now holds several hundred, which a dropdown cannot show you — a shape is a
  // picture. It became the kit's symbol picker (widened to take an SVG preview per item), so
  // the search, the category chips and the paging came free.
  // 1 -> 0 on 2026-09-04: the clicker's colour-count `<select id="ccount">`, onto
  // selectField() (paired with the new setFieldOptions() for the synthetic limited-mode
  // option).
  select: 0,
  // 44 -> 38, range 11 -> 5 on 2026-08-26: the clicker's six sliders. Each was a label + a
  // text readout + a bare range, wired by a local `bindValInput()` that re-derived
  // clamp-on-type, select-on-focus and commit-on-Enter. `sliderRow()` is all of it.
  // 15 -> 14 on 2026-08-31, and the number is a bigger win than it looks: the comment
  // stripper above was fixed in the same commit, which handed this check 130 lines of the
  // clicker's import panel that it had never been able to see (5 inputs and 2 textareas
  // hiding in the blind spot). Six hand-built `<label class="toggle">` switches moved to
  // `toggleSwitch()` and the two textareas to `textareaField()`, which absorbed the newly
  // visible debt and still came out one under the old budget.
  input: 14,
  textarea: 0,
  range: 2,
};

/*
  Already broken when this check was written. A new one is a hard failure; these are the
  backlog. Delete an entry when it is fixed — the check will tell you to.
*/
const KNOWN_UNRESOLVED_TOKENS = new Set([
  '--swatch', // packages/ui-kit/src/components.css — set inline by the filament row at runtime
  '--hover', // clicker + name-keychain stylesheets
]);

const KNOWN_ORPHAN_CLASSES = new Set([
  // The kit's own, and the worst of the three because every app inherits it.
  'vl-topbar-btn--theme',
  'vl-stage-panel__body',
  // clicker-generator
  // `edge-size-minus`/`edge-size-plus`: read only via `classList.contains(...)` in a
  // delegated click handler (ui.ts), which this check's query-hook detector does not parse
  // (it only recognises querySelector/closest/matches and classList add/remove/toggle) —
  // a real JS hook, not a missed style, same as `reset-part-colors` beside it.
  'edge-radius-label', 'reset-part-colors', 'edge-size-minus', 'edge-size-plus',
  // magnet-generator
  'body-row', 'region-row', 'mg-magnet-step',
  // the rest
  'hn-report', 'hub-hero__license-btn', 'nk-reset-section', 'nk-reset-btn',
  'pt-pauses', 'pt-fb__name',
]);

/*
  Ask git what the repository contains, rather than walking the disk.

  Everything this check must not look at is already excluded from git for its own
  reasons: `dist/`, `dist-offline/` and `offline/` are build outputs, `vendor/` is someone
  else's code, `apps/laser-slot/` is unpublished, and foldbox's two abandoned copies of its
  `src/` (`srcfit/`, `testfit/`) are fenced — a disk walk happily counted all of them.

  Publishing an app therefore RAISES the counts, because its source enters this check for
  the first time. Foldbox shipping print-only on 2026-08-26 brought in three hand-built
  controls; they were migrated in the same commit rather than budgeted for. Expect the same
  the next time something moves out of the unpublished fence.

  `--others --exclude-standard` keeps work that is new rather than gitignored, so an app
  that has been scaffolded but not yet committed — `apps/pen-topper` on the day this was
  written — is checked from its first line rather than from its first commit.
*/
const tracked = (dir) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

const rel = (p) => p;
const abs = (p) => join(ROOT, p);

const APP_FILES = tracked('apps');
const PKG_FILES = tracked('packages');

const isCode = (f) => (/\.ts$/.test(f) && !f.endsWith('.d.ts')) || f.endsWith('.html');

/* Only app code is *counted*. `packages/` is the definition layer — a raw <button> in the
   kit is a component being defined, which is exactly where one belongs. */
const CODE = APP_FILES.filter(isCode);

/* But the correctness checks read the kit too. A dead class or an unresolvable token is a
   bug wherever it lives, and it is worst in the kit, because every app inherits it —
   `vl-topbar-btn--theme` has been on the theme button in `topbar-links.ts` against no rule
   at all, and an app-only scan is exactly what let it sit there. */
const ALL_CODE = [...CODE, ...PKG_FILES.filter(isCode)];
const CSS = [...APP_FILES, ...PKG_FILES].filter((f) => f.endsWith('.css'));

/* ------------------------------------------------------- 1 · the ratcheted counts */

/* Both ways a control gets built in a framework-free app: written into a template
   literal or an index.html, and constructed through `el()` / `createElement`. */
const built = (tag) =>
  new RegExp(`<${tag}\\b|(?:el|createElement)\\(\\s*['"\`]${tag}['"\`]`, 'g');

const PATTERNS = {
  button: built('button'),
  select: built('select'),
  // A checkbox and a radio are the platform's own controls and `toggleSwitch` wraps rather
  // than replaces them, so they are counted with the text fields they sit beside. Range is
  // counted separately because `sliderRow` is its component.
  input: /<input\b(?![^>]*type=["']range["'])|(?:el|createElement)\(\s*['"`]input['"`]/g,
  textarea: built('textarea'),
  range: /type=["']range["']/g,
};

/*
  Comments are prose, not markup.

  This check caught its own documentation the first time it ran: the line telling the next
  author never to hand-write a `<button>` counted as a hand-written button. A commented-out
  control is not a control either. The URL guard keeps `https://` from starting a comment.

  A block comment must OPEN at a boundary — start of line, or after whitespace or one of
  `(,;={`. Without that guard an `accept="image/[star]"` attribute opened one, and it ran to
  the next comment-close in the file. In the clicker that was the JSDoc 130 lines later, so
  the entire right-hand import panel — exactly where a hand-built control is most likely to
  appear — was invisible to this check while it reported a clean pass. Counting nothing looks
  identical to counting zero, which is the failure mode a ratchet can least afford.
  (Written as [star] above for the obvious reason.)
*/
const stripComments = (src) =>
  src.replace(/(^|[\s(,;={])\/\*[\s\S]*?\*\//gm, '$1 ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const counts = Object.fromEntries(Object.keys(BUDGET).map((k) => [k, 0]));
const byFile = [];

for (const file of CODE) {
  const src = stripComments(readFileSync(abs(file), 'utf8'));
  let any = 0;
  for (const [kind, re] of Object.entries(PATTERNS)) {
    const n = (src.match(re) ?? []).length;
    if (n) {
      counts[kind] += n;
      any += n;
    }
  }
  if (any) byFile.push({ file: rel(file), any });
}

/* --------------------------------------------------------------- 2 · tokens */

const declaredTokens = new Set();
for (const f of CSS) {
  for (const m of readFileSync(abs(f), 'utf8').matchAll(/(--[\w-]+)\s*:/g)) declaredTokens.add(m[1]);
}

/* Set by JavaScript at runtime rather than declared in a stylesheet — a slider's fill
   percentage, a stagger index. Legitimately undefined at rest. */
const RUNTIME_TOKENS = new Set(['--pct', '--p', '--i', '--w']);

const unresolvedTokens = new Map();
for (const file of [...CSS, ...ALL_CODE]) {
  for (const m of readFileSync(abs(file), 'utf8').matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (declaredTokens.has(m[1]) || RUNTIME_TOKENS.has(m[1])) continue;
    if (!unresolvedTokens.has(m[1])) unresolvedTokens.set(m[1], new Set());
    unresolvedTokens.get(m[1]).add(rel(file));
  }
}

/* --------------------------------------------------------------- 3 · class names */

const definedClasses = new Set();
for (const f of CSS) {
  for (const m of readFileSync(abs(f), 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) definedClasses.add(m[1]);
}

/* Strip `${...}` interpolations before pulling literals out, repeatedly so a nested one
   goes too. Doing it in this order is the whole trick: an interpolation *contains* string
   literals, so stripping afterwards leaves the expression itself looking like one. A
   computed class name is not something a static check can vouch for either way. */
function stripInterpolations(value) {
  let out = value;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/\$\{[^{}]*\}/g, ' ');
    if (next === out) return out;
    out = next;
  }
  return out;
}

/*
  A class the code only ever looks up is a JS hook, not a style hook, and it is correct
  for no stylesheet to define it. `.reset-part-colors` is a real one: it sits beside
  `vl-btn vl-btn--ghost vl-btn--block`, which carry all the styling, and exists purely so
  the clicker can find that button again.
*/
const queryHooks = new Set();
for (const file of ALL_CODE) {
  const src = readFileSync(abs(file), 'utf8');
  for (const m of src.matchAll(/\.(?:querySelector|querySelectorAll|closest|matches)\(\s*["'`]([^"'`]*)["'`]/g)) {
    for (const name of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) queryHooks.add(name[1]);
  }
}

const orphanClasses = new Map();

for (const file of ALL_CODE) {
  const src = stripInterpolations(readFileSync(abs(file), 'utf8'));
  const found = [];

  // `class="…"` in a template literal or an index.html.
  for (const m of src.matchAll(/\bclass=["']([^"']*)["']/g)) found.push(m[1]);
  // `el('div', { className: '…' })` and `node.className = '…'`.
  for (const m of src.matchAll(/\bclassName\s*[:=]\s*["'`]([^"'`]*)["'`]/g)) found.push(m[1]);
  // Only the FIRST literal after the paren: `toggle('hidden', v !== 'image')` must not
  // contribute `image`. Under-reporting is safe here; a false positive is not.
  for (const m of src.matchAll(/\bclassList\.(?:add|remove|toggle)\(\s*["'`]([^"'`]*)["'`]/g)) {
    found.push(m[1]);
  }

  for (const chunk of found) {
    for (const name of chunk.split(/\s+/)) {
      if (!name || !/^[a-zA-Z][\w-]*$/.test(name)) continue;
      // `fb-badge--${level}` survives interpolation-stripping as the prefix `fb-badge--`.
      // A name ending in a dash is a fragment, never a class anyone wrote.
      if (name.endsWith('-')) continue;
      if (definedClasses.has(name) || queryHooks.has(name)) continue;
      if (!orphanClasses.has(name)) orphanClasses.set(name, new Set());
      orphanClasses.get(name).add(rel(file));
    }
  }
}

/* ------------------------------------------------------------------------ report */

let failed = false;

const over = Object.keys(BUDGET).filter((k) => counts[k] > BUDGET[k]);
const under = Object.keys(BUDGET).filter((k) => counts[k] < BUDGET[k]);

if (over.length > 0) {
  failed = true;
  console.error('\nUI drift: a hand-built control was added instead of using @vostok/ui-kit.\n');
  for (const k of Object.keys(BUDGET)) {
    const flag = counts[k] > BUDGET[k] ? '  <-- up' : '';
    console.error(`  ${k.padEnd(9)} ${String(counts[k]).padStart(4)}  (budget ${BUDGET[k]})${flag}`);
  }
  console.error('\nThe worst offenders right now:');
  for (const f of byFile.sort((a, b) => b.any - a.any).slice(0, 8)) {
    console.error(`  ${String(f.any).padStart(3)}  ${f.file}`);
  }
  console.error(
    '\nUse the kit: button, iconButton, buttonRow, toggleSwitch, sliderRow,\n' +
      'segmentedControl, selectField, dpad, dialog, toast, exportPanel, dropZone.\n' +
      'They render the same element with the same class, so adopting one is a one-line\n' +
      'change. If the kit genuinely cannot express what you need, widen the component\n' +
      'rather than the budget — see invariant #9 in CLAUDE.md.\n',
  );
}

const newTokens = [...unresolvedTokens].filter(([t]) => !KNOWN_UNRESOLVED_TOKENS.has(t));
if (newTokens.length > 0) {
  failed = true;
  console.error('\nUI drift: a CSS custom property is used but declared nowhere.');
  console.error('An unresolvable var() invalidates the whole declaration, so the property');
  console.error('silently falls back to its initial value — a transparent background, an');
  console.error('inherited colour — and nothing anywhere reports it.\n');
  for (const [t, files] of newTokens) console.error(`  ${t.padEnd(22)} ${[...files].join(', ')}`);
  console.error('');
}

const newOrphans = [...orphanClasses].filter(([n]) => !KNOWN_ORPHAN_CLASSES.has(n));
if (newOrphans.length > 0) {
  failed = true;
  console.error('\nUI drift: a class name is used in code but no stylesheet defines it.');
  console.error('The element renders completely unstyled, and nothing reports it — this is');
  console.error('how the kit shipped a theme button carrying `vl-topbar-btn--theme`, a class');
  console.error('that has never existed in this repository.\n');
  for (const [name, files] of newOrphans) {
    console.error(`  .${name.padEnd(26)} ${[...files].slice(0, 3).join(', ')}`);
  }
  console.error('');
}

if (failed) process.exit(1);

/* Ground gained. Never a failure — nobody should have a commit rejected for improving
   things — but loud enough that the number actually gets lowered. */
const fixedTokens = [...KNOWN_UNRESOLVED_TOKENS].filter((t) => !unresolvedTokens.has(t));
const fixedClasses = [...KNOWN_ORPHAN_CLASSES].filter((c) => !orphanClasses.has(c));

if (under.length > 0 || fixedTokens.length > 0 || fixedClasses.length > 0) {
  console.log('\nUI drift: ground gained. Update scripts/check-ui-drift.mjs:\n');
  for (const k of under) console.log(`  BUDGET.${k}: ${BUDGET[k]} -> ${counts[k]}`);
  for (const t of fixedTokens) console.log(`  drop '${t}' from KNOWN_UNRESOLVED_TOKENS`);
  for (const c of fixedClasses) console.log(`  drop '${c}' from KNOWN_ORPHAN_CLASSES`);
  console.log('');
}

console.log(
  'ui drift ok — ' +
    Object.keys(BUDGET)
      .map((k) => `${k} ${counts[k]}`)
      .join(', ') +
    '; tokens and class names all resolve',
);
