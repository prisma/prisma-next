---
from: "0.12"
to: "0.13"
changes: []
---

<!--
TML-2843: @prisma-next/sqlite gained a facade-level transaction API
(`SqliteClient.transaction()` + `SqliteTransactionContext`), mirroring
the existing Postgres facade. Purely additive public surface backed by
the unchanged SQL runtime `withTransaction` helper; existing extension
code is unaffected. Incidental substrate diff only.
-->

# 0.12 → 0.13 — Extension-author upgrade instructions
