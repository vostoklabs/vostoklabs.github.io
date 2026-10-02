#!/usr/bin/env node
/*
  pnpm check:public

  This repository is public and is the live site. Everything committed here, comments and
  commit messages included, is published and stays readable in forks. This check refuses
  text that should not be published (see .claude/rules/public-repo.md).

    node scripts/check-public.mjs --all             every tracked file (CI)
    node scripts/check-public.mjs --staged          lines being committed, staged and unstaged
    node scripts/check-public.mjs --hook            Claude Code PreToolUse hook (reads JSON on stdin)
    node scripts/check-public.mjs --rev <commit>    every file at a commit (for testing the rules)

  Most terms worth refusing are themselves private, so they never belong in this file. Put
  one regular expression per line in docs/private-terms.txt (docs/ is not published) or in
  the PUBLIC_CHECK_TERMS environment variable (newline or comma separated).

  A hit is fixed by rewriting the text, never by adding an exception here.
*/

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RULES = [
  { id: 'unreleased', re: /\b(unreleased|unlaunched|not yet (released|launched|shipped))\b/i,
    why: 'Describes something that is not released. Leave it out of public text.' },
  { id: 'pricing', re: /[$\u20ac\u00a3]\s?(\d{2,}|\d+[.,]\d{2})\b/,
    why: 'A price. Public prices live only in config/brand.ts and the LICENSE files.' },
  { id: 'personal', re: /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`%]+|\/Users\/[A-Za-z0-9._-]+\/|\/home\/(?!user\/|runner\/)[a-z][a-z0-9._-]*\//,
    why: 'A local file path with a username.' },
  { id: 'private-docs',
    re: /(?<![\w/.:-])docs\/(?!\S*-listing\.md)(?!\S*\.(png|jpe?g|gif|svg|webp)\b)\S|\bDEV_PLAN\b|\bdev plan\b|\.design\.md\b|\b\d\d-[a-z0-9-]+\.md\b/i,
    why: 'Points at private notes. Keep the engineering sentence, drop the reference.' },
];

// Files whose job is to contain these words, or that are not ours to edit.
const SKIP = [
  /^scripts\/check-public\.mjs$/,
  /^\.claude\/rules\/public-repo\.md$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)THIRD-PARTY-NOTICES\.txt$/,
  /(^|\/)public\/licenses\//,
  /(^|\/)(LICENSE|OFL)(\.txt)?$/,
  /\.typeface\.json$/,
  /^packages\/fonts\/src\/icons\.ts$/, // generated icon metadata (search keywords)
];
// Where public prices are allowed.
const PRICE_OK = [/^config\/brand\.ts$/, /^apps\/[^/]+\/LICENSE\.md$/, /^scripts\/licenses\.mjs$/];

function privateRules() {
  const lines = [];
  const file = join(ROOT, 'docs', 'private-terms.txt');
  if (existsSync(file)) lines.push(...readFileSync(file, 'utf8').split('\n'));
  if (process.env.PUBLIC_CHECK_TERMS) lines.push(...process.env.PUBLIC_CHECK_TERMS.split(/[\n,]/));
  return lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ id: 'private-term', re: new RegExp(l, 'i'), why: 'Matches a private term.' }));
}

const ALL_RULES = [...RULES, ...privateRules()];

function scanText(path, text, firstLine = 1) {
  const hits = [];
  if (path && SKIP.some((re) => re.test(path))) return hits;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of ALL_RULES) {
      if (rule.id === 'pricing' && path && PRICE_OK.some((re) => re.test(path))) continue;
      if (rule.id === 'private-docs' && path && /(^|\/)\.gitignore$/.test(path)) continue;
      if (rule.re.test(line)) hits.push({ path: path || '(commit message)', line: firstLine + i, rule, text: line.trim() });
    }
  });
  return hits;
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

function scanTree(rev) {
  return [...scanFiles(rev), ...lockfileHits(rev)];
}

function scanFiles(rev) {
  const files = (rev ? git('ls-tree', '-r', '--name-only', rev) : git('ls-files')).split('\n').filter(Boolean);
  const hits = [];
  for (const f of files) {
    if (SKIP.some((re) => re.test(f))) continue;
    let buf;
    try {
      buf = rev ? execFileSync('git', ['show', `${rev}:${f}`], { cwd: ROOT, maxBuffer: 1 << 28 }) : readFileSync(join(ROOT, f));
    } catch {
      continue; // deleted in the working tree
    }
    if (!isText(buf)) continue;
    hits.push(...scanText(f, buf.toString('utf8')));
  }
  return hits;
}

/** Added lines of a unified diff, with their file and line number. */
function scanDiff(diff) {
  const hits = [];
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { lineNo = Number(m[1]); continue; }
    if (line.startsWith('+') && file && file !== '/dev/null') {
      hits.push(...scanText(file, line.slice(1), lineNo));
      lineNo++;
    }
  }
  return hits;
}

function scanPending() {
  const hits = [
    ...scanDiff(git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff')),
    ...scanDiff(git('diff', '-U0', '--no-color', '--no-ext-diff')),
  ];
  // New files a `git add -A` in the same command would pick up.
  for (const f of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
    let buf;
    try { buf = readFileSync(join(ROOT, f)); } catch { continue; }
    if (isText(buf)) hits.push(...scanText(f, buf.toString('utf8')));
  }
  return [...hits, ...lockfileHits()];
}

/** pnpm writes every workspace member into the lockfile, private apps included. */
function lockfileHits(rev) {
  let lock;
  try { lock = rev ? git('show', `${rev}:pnpm-lock.yaml`) : readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'); } catch { return []; }
  const published = new Set(
    (rev ? git('ls-tree', '-r', '--name-only', rev) : git('ls-files') + git('ls-files', '--others', '--exclude-standard'))
      .split('\n').map((f) => f.split('/').slice(0, 2).join('/')),
  );
  const hits = [];
  lock.split('\n').forEach((line, i) => {
    const m = /^  ((?:apps|packages)\/[^:/]+):\s*$/.exec(line);
    if (m && !published.has(m[1])) {
      hits.push({ path: 'pnpm-lock.yaml', line: i + 1, text: line.trim(),
        rule: { id: 'lockfile', why: `Names ${m[1]}, which is not published. Restore pnpm-lock.yaml from the last commit before committing.` } });
    }
  });
  return hits;
}

function report(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.path}:${h.line}:${h.rule.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`  ${h.path}:${h.line}  [${h.rule.id}] ${h.rule.why}\n      ${h.text.slice(0, 160)}`);
  }
  return out;
}

function fail(lines, hook) {
  const msg =
    `check:public found ${lines.length} line(s) that must not be published (this repo is public):\n` +
    lines.join('\n') +
    '\nRewrite them in neutral engineering terms or move the context to docs/ (not published). ' +
    'See .claude/rules/public-repo.md. Do not add exceptions to the check.\n';
  process.stderr.write(msg);
  process.exit(hook ? 2 : 1);
}

const args = process.argv.slice(2);
const mode = args[0];

if (mode === '--hook') {
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
  let command = '';
  try { command = JSON.parse(input)?.tool_input?.command ?? ''; } catch { process.exit(0); }
  // Only a real `git ... commit` invocation, not text that mentions one.
  if (!/(^|[;&|\n(]|\$\()\s*git(\s+-[A-Za-z-]+(\s+(?!commit\b)[^\s;&|-]\S*)?)*\s+commit\b/.test(command)) process.exit(0);
  const lines = report([...scanPending(), ...scanText(null, command)]);
  if (lines.length) fail(lines, true);
  process.exit(0);
} else if (mode === '--staged') {
  const lines = report(scanPending());
  if (lines.length) fail(lines, false);
  console.log('check:public ok (pending changes)');
} else if (mode === '--rev') {
  const lines = report(scanTree(args[1]));
  if (lines.length) fail(lines, false);
  console.log(`check:public ok (${args[1]})`);
} else {
  const lines = report(scanTree(null));
  if (lines.length) fail(lines, false);
  console.log('check:public ok (all tracked files)');
}
