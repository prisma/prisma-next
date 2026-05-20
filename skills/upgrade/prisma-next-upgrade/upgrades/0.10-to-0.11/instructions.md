---
from: "0.10"
to: "0.11"
changes: []
---

# 0.10 → 0.11 — User upgrade instructions

No user-facing changes in this transition so far. The `examples/` diff currently in flight is an internal-only devDependency normalization (`tsx: "^4.19.2"` → `tsx: "catalog:"`) made when `tsx` was added to the workspace catalog in `pnpm-workspace.yaml`. Both ranges resolve to the same installed `tsx` major; the change is purely a source-level consistency fix that keeps `examples/*/package.json` aligned with the catalog convention already used by `@types/node`, `typescript`, `vitest`, and friends.

Consumers do not need to take any action. Further breaking changes shipping in 0.11 will append to this file as `changes[]` entries with their own scripts and prose.
