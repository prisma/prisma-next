# Getting Started

- Start with the [Docs index](../README.md) and `[AGENTS.md](../../AGENTS.md)` for repo entry points.
- Read the [Architecture Overview](../Architecture%20Overview.md) for the high-level model.
- Install and bootstrap:
  - `pnpm install` — also mirrors team-shared rule cards from `.agents/rules/` into `.cursor/rules/` for Cursor (see [Rule sync](./Cursor-Cloud-Agents.md#rule-sync)). Re-run `pnpm sync:rules` whenever you add a new rule under `.agents/rules/`.
- Build and test:
  - `pnpm build`
  - `pnpm test:packages`
- Run the demo:
  - `cd examples/prisma-next-demo`
  - follow `[examples/prisma-next-demo/README.md](../../examples/prisma-next-demo/README.md)`
- Working in a Cursor cloud agent? See [Cursor Cloud Agents](./Cursor-Cloud-Agents.md).

