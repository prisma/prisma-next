---
from: "0.14"
to: "0.15"
changes: []
---

<!--
TML-2787 (M:N slice 3): namespace-scoped execution-default refs. The contract's
`ExecutionMutationDefault.ref` now carries a `namespace` alongside `table` and
`column`, so an execution-time mutation default is keyed by `(namespace, table,
column)` — disambiguating same-named tables across namespaces. The emitter writes the
new ref shape, so every emitted `contract.json` / `contract.d.ts` and the example
migration snapshots regenerate accordingly. No user action: a re-emit picks up the
new shape, and the runtime applies defaults by namespace transparently. Incidental
substrate diff only.

TML-2790: adds many-to-many ORM-client examples (connect / disconnect / nested
create through a junction) and a `Post`↔`Tag` M:N relation to the
`prisma-next-demo-sqlite` example, with the re-emitted demo contract. Purely
additive demo material — existing contracts are unaffected. No user-side action
required.
-->
