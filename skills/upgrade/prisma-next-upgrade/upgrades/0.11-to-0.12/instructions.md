---
from: "0.11"
to: "0.12"
changes: []
---

# 0.11 → 0.12 — User upgrade instructions

No user-facing changes in this transition so far. The `examples/` diff currently in flight bumps a small group of dev-only Cloudflare-worker tooling (`pkg-pr-new`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `wrangler`) inside `examples/prisma-next-cloudflare-worker`. These dependencies are confined to the demo app's own dev workflow; downstream Prisma Next consumers are unaffected and do not need to take any action.

Further breaking changes shipping in 0.12 will append to this file as `changes[]` entries with their own scripts and prose.
