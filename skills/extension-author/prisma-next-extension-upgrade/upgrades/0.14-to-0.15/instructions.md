---
from: "0.14"
to: "0.15"
changes: []
---

<!--
TML-2787 (M:N slice 3): namespace-scoped execution-default refs land in
`@prisma-next/sql-orm-client` (nested writes through a junction, the
required-payload gate, and the namespace-keyed `ExecutionMutationDefault.ref`).
The changes are internal to the ORM client and its emitted-contract consumption;
the extension-author surface is unchanged. No extension-author action — re-emit
picks up the new contract ref shape. Incidental substrate diff only.
-->

<!--
TML-2886 (redo, PR #841): type SQL enum columns via a baked storage column lookup.
The SQL emitter generates a new `StorageColumnTypes` map in `contract.d.ts`, keyed
`[namespace][table][column]`; `FieldOutputTypes`/`FieldInputTypes` are derived from it
at emit time. The extension-package `contract.d.ts` fixtures (paradedb, pgvector,
postgis, supabase, sql-orm-client test fixture) regenerate to add the `StorageColumnTypes`
block. `contract.json` and hashes are byte-identical; `FieldOutputTypes` is unchanged.
No extension-author API or surface change. Incidental substrate diff only.
-->
