# This repository is public

Everything committed here is published: code, comments, commit messages, `.gitignore`,
READMEs, `package.json` scripts, and HTML comments inside template strings (those ship in the
bundle). Forks and clones keep every version. Deleting text later does not unpublish it.

Comments describe our own code: what it does and the engineering reason. Do not commit:

- third-party material: other parties' documentation, internals, limits or feedback;
- correspondence, contract terms, legal matters, customer data;
- plans, names or dates of anything not live on the site, including `.gitignore` entries,
  root `package.json` scripts and "ported from" notes;
- prices outside `config/brand.ts` and `apps/*/LICENSE.md`;
- pointers into private notes (`docs/...`, plans, research or design note filenames);
- paid feature source. It lives only in gitignored folders and is reached through virtual
  modules whose public stubs do nothing.

Private context belongs in `docs/` (not published) or outside the repo.

## Mechanics

- `.gitignore` holds patterns only. `apps/` and `packages/` are private by default: a new
  one is ignored until the day it ships, when it is re-included there and given its
  `generators.json` entry, root scripts and deploy steps.
- `node scripts/check-public.mjs` runs before every `git commit` (hook in
  `.claude/settings.json`) and in CI. It also reads `docs/private-terms.txt` or the
  `PUBLIC_CHECK_TERMS` variable. If it flags something, rewrite the text; never add an
  exception to get past it.
