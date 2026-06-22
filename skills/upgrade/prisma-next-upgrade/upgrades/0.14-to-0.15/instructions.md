---
from: "0.14"
to: "0.15"
changes: []
---

<!--
TML-2891 (eliminate the SQL family placeholder namespace): app authors who build
contracts through the public facades / target `defineContract` wrappers
(`@prisma-next/postgres`, `@prisma-next/sqlite`) are unaffected — those wrappers
supply the now-required `createNamespace` factory, so no app-author code changes.
The only `examples/` diff is regenerated migration `end-contract.d.ts` snapshots
whose SQL namespace `kind` changed from `'sql-namespace'` to `'postgres-schema'`;
the next `contract emit` picks this up automatically, and historical migration
snapshots are type-only (the runtime reads `contract.json`, which already carried
`postgres-schema`). No app-author action. Incidental substrate diff only.
-->
