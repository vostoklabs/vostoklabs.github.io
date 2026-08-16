#!/usr/bin/env node
/*
  pnpm new:generator <id> ["Display Name"] ["one-line description"]

  Copies apps/generator-template into apps/<id> and performs the whole rename
  checklist from the template's README — the eight strings that are *wrong*
  rather than merely generic, three of which silently collide with the template
  if they are missed (the callout key, the theme key, the export provenance id).

  It exists because the checklist was a manual ritual, and a manual ritual is one
  that gets half-followed: the shipped generators drifted apart on exactly the
  items below, and two of them shipped with the browser's default serif because
  the copy step was skipped altogether.

  Nothing here touches geometry. After this runs, the new app builds and exports a
  real 3MF; the work is replacing src/geometry.ts and the settings in src/state.ts.
*/

import { existsSync, readdirSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'apps', 'generator-template');
const SKIP = new Set(['node_modules', 'dist', '.turbo', '.vite']);

const [rawId, rawTitle, rawDescription] = process.argv.slice(2);

if (!rawId) {
  console.error('usage: pnpm new:generator <id> ["Display Name"] ["one-line description"]');
  process.exit(1);
}

const id = rawId.trim();
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
  console.error(`"${id}" is not a valid id — use lowercase kebab-case, e.g. cable-clip.`);
  process.exit(1);
}

const appDir = join(ROOT, 'apps', id);
if (existsSync(appDir)) {
  console.error(`apps/${id} already exists. Pick another id or delete it first.`);
  process.exit(1);
}

const title = rawTitle?.trim() || titleCase(id);
const description = rawDescription?.trim() || `One line on what ${title} makes and who it is for.`;
const prefix = cssPrefix(id);
const camel = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// 1. Copy the template
// ---------------------------------------------------------------------------
copyDir(TEMPLATE, appDir);

// ---------------------------------------------------------------------------
// 2. The rename checklist
// ---------------------------------------------------------------------------
edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.name = id;
  pkg.description = description;
  return JSON.stringify(pkg, null, 2) + '\n';
});

edit('index.html', (s) =>
  s
    .replace('<title>Generator Template · Vostok Labs</title>', `<title>${escapeHtml(title)} · Vostok Labs</title>`)
    .replace(
      'content="Starter template for a Vostok Labs parametric generator."',
      `content="${escapeHtml(description)}"`,
    ),
);

edit('src/main.ts', (s) =>
  s
    // These three collide with the template (and with each other across apps) if missed.
    .replace("storageKey: 'template-quality-callout'", `storageKey: '${id}-quality-callout'`)
    .replace("themeStorageKey: 'template-theme'", `themeStorageKey: '${id}-theme'`)
    .replace("generator: 'generator-template'", `generator: '${id}'`)
    // Provenance + what the user sees in their Downloads folder.
    .replace("application: 'Vostok Labs Generator Template'", `application: 'Vostok Labs ${title}'`)
    .replace("title: 'Tag',", `title: '${title}',`)
    .replace("}, 'tag.3mf');", `}, '${id}.3mf');`)
    .replace("downloadJSON('tag-project.json'", `downloadJSON('${id}-project.json'`)
    .replace("title: 'Generator Template help'", `title: '${title} help'`)
    .replace("title: 'My Generator',", `title: '${title}',`)
    .replace(
      "description: 'One line on what it makes and who it is for.',",
      `description: ${JSON.stringify(description)},`,
    )
    .replaceAll('tpl-', `${prefix}-`),
);

edit('src/style.css', (s) => s.replaceAll('tpl-', `${prefix}-`));

// The template's README documents the template itself; the new app gets a stub that
// points back at it rather than a copy that will rot.
edit('README.md', () => appReadme({ id, title, description }));

// ---------------------------------------------------------------------------
// 3. Wire it into the repo: launch config, root scripts
// ---------------------------------------------------------------------------
const launchPath = join(ROOT, '.claude', 'launch.json');
let port = null;
if (existsSync(launchPath)) {
  const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
  const used = new Set(launch.configurations.map((c) => c.port).filter(Boolean));
  port = 5199;
  while (used.has(port)) port -= 1;
  launch.configurations.push({
    name: id,
    runtimeExecutable: 'pnpm',
    // No `--` separator: pnpm 10 forwards it literally, vite reads it as a positional
    // argument and quietly ignores the port that follows — so the preview opens a tab on
    // a port nothing is serving. Every entry in this file had that bug.
    runtimeArgs: ['--filter', id, 'dev', '--port', String(port), '--strictPort'],
    port,
  });
  writeFileSync(launchPath, JSON.stringify(launch, null, 2) + '\n');
}

const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
rootPkg.scripts[`dev:${camel}`] = `pnpm --filter ${id} dev`;
rootPkg.scripts[`build:${camel}`] = `pnpm --filter ${id} build`;
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');

// ---------------------------------------------------------------------------
console.log(`
Created apps/${id} from the generator template.

  name        ${id}
  title       ${title}
  css prefix  ${prefix}-
  dev port    ${port ?? '(no .claude/launch.json — add one yourself)'}

Next:
  1. pnpm install                       (links the workspace deps)
  2. pnpm dev:${camel}
  3. Replace src/geometry.ts and the settings in src/state.ts — everything else
     (shell, viewer, plate, export, licence nudge) already works.
  4. Read apps/generator-template/README.md: the numbered main.ts walkthrough and
     the chrome measurements your app has to match.
  5. Ship: add the entry to generators.json and a build+copy step to
     .github/workflows/deploy.yml, or the hub card is a 404.
`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (SKIP.has(entry)) continue;
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) copyDir(src, dest);
    else copyFileSync(src, dest);
  }
}

function edit(relative, fn) {
  const path = join(appDir, relative);
  const before = readFileSync(path, 'utf8');
  writeFileSync(path, fn(before));
}

function titleCase(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Short, app-local class prefix: initials for a multi-word id, first letters otherwise.
 *  Never `vl` — that belongs to the kit. */
function cssPrefix(value) {
  const parts = value.split('-');
  const candidate = parts.length > 1 ? parts.map((p) => p[0]).join('') : value.slice(0, 2);
  return candidate === 'vl' ? value.slice(0, 3) : candidate;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function appReadme({ id, title, description }) {
  return `# ${title}

${description}

\`\`\`bash
pnpm --filter ${id} dev
\`\`\`

Scaffolded from \`apps/generator-template\` with \`pnpm new:generator\`. That template's
[README](../generator-template/README.md) is still the reference for the layout, the
numbered \`main.ts\` walkthrough, the export rules and the "nothing may jump" bar — read it
there rather than copying it here, so it stays true when the kit moves.

## What is app-specific here

- \`src/geometry.ts\` — the builder. Emits \`{ name, positions, indices, color }\` parts.
- \`src/state.ts\` — the settings object; Save/Load serialise exactly this.
- \`src/style.css\` — only what is unique to this app. Anything a second generator could
  want belongs in \`@vostok/ui-kit\`.
`;
}
