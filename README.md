# vostok-labs-tools

Monorepo for [Vostok Labs](https://ko-fi.com/vostoklabs) generators, seller tools, the hub,
and the shared design system.

- `packages/ui-kit` — design tokens + shared components (license nudge, support links,
  export panel, …)
- `config/` — brand constants (URLs, prices) — single source of truth
- `apps/kit-demo` — component showcase: `pnpm install && pnpm dev:demo`
- `generators.json` — tool registry
- `.claude/skills/` — Claude Code project skills (OpenSCAD dev loop, MakerWorld PMM rules,
  new-generator pipeline)

Plans and task list live in the sibling `generators galore/` folder.
