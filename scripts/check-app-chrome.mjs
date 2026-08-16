#!/usr/bin/env node
/*
  pnpm check:chrome

  Two cheap assertions that have each cost a shipped generator:

  1. No app redefines the page frame. `packages/ui-kit/src/root.css` owns `body`'s font,
     colour, background and margin. An app that restates them is drifting by definition —
     and the version of this that actually shipped was an app that *omitted* them back when
     each app owned its own, which rendered the whole panel in Times New Roman.

  2. The kit still sets them. If root.css ever loses the font rule, every app silently falls
     back to the browser default and nothing else in CI would notice.
*/

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

// 1. The kit must own the page frame.
const rootCss = join(ROOT, 'packages', 'ui-kit', 'src', 'root.css');
if (!existsSync(rootCss)) {
  problems.push('packages/ui-kit/src/root.css is missing — the page frame has no owner.');
} else {
  const css = readFileSync(rootCss, 'utf8');
  for (const declaration of ['font-family: var(--font-body)', 'font-size: var(--fs-body)', 'margin: 0']) {
    if (!css.includes(declaration)) {
      problems.push(`packages/ui-kit/src/root.css no longer sets \`${declaration}\` on body.`);
    }
  }
  const styles = readFileSync(join(ROOT, 'packages', 'ui-kit', 'src', 'styles.css'), 'utf8');
  if (!styles.includes("@import './root.css'")) {
    problems.push('packages/ui-kit/src/styles.css does not import root.css — no app gets the page frame.');
  }
}

// 2. No app may restate it.
const appsDir = join(ROOT, 'apps');
for (const app of readdirSync(appsDir)) {
  const srcDir = join(appsDir, app, 'src');
  if (!existsSync(srcDir)) continue;
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.css')) continue;
    const path = join(srcDir, file);
    for (const rule of cssRules(readFileSync(path, 'utf8'))) {
      if (!/(^|[\s,])(body|:root|html)([\s,{:]|$)/.test(rule.selector)) continue;
      for (const property of ['font-family', 'font-size']) {
        if (new RegExp(`(^|[;{\\s])${property}\\s*:`).test(rule.body)) {
          problems.push(
            `apps/${app}/src/${file}: \`${rule.selector.trim()}\` sets ${property}. ` +
              'The page frame belongs to @vostok/ui-kit (root.css); an app sets only `body { overflow: hidden }`.',
          );
        }
      }
    }
  }
}

if (problems.length) {
  console.error('Page-frame check failed:\n\n' + problems.map((p) => '  • ' + p).join('\n') + '\n');
  process.exit(1);
}
console.log('Page-frame check passed: the kit owns body, no app restates it.');

/** Good-enough CSS rule splitter — comments stripped, at-rule bodies flattened. */
function* cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(clean)) !== null) {
    yield { selector: match[1], body: match[2] };
  }
}
