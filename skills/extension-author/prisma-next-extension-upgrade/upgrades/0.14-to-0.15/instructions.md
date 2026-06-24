---
from: "0.14"
to: "0.15"
changes:
  - id: sql-contract-createnamespace-required
    summary: |
      The SQL family no longer materialises a placeholder namespace, so authoring a SQL contract now
      requires a target namespace factory. If your extension builds a contract via `prismaContract(...)`
      or `defineContract(...)` from `@prisma-next/sql-contract-psl` / `@prisma-next/sql-contract-ts`
      (rather than through a target pack's own `defineContract` wrapper, which already supplies it),
      pass the now-required `createNamespace` option: `postgresCreateNamespace` from
      `@prisma-next/target-postgres/types`, or `sqliteCreateNamespace` from `@prisma-next/target-sqlite/control`.
      Without it, `contract emit` / build fails at runtime with "createNamespace is not a function".
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "prismaContract("
        - "defineContract("
      anyMatch: true
  - id: sql-namespace-types-renamed-and-removed
    summary: |
      `SqlNamespace` is now an abstract class and the family placeholder concretion is gone. Rename the
      factory-input type `SqlNamespaceTablesInput` -> `SqlNamespaceInput` (it is the `createNamespace`
      factory input, not a tables-only type). The removed symbols `buildSqlNamespace`,
      `buildSqlNamespaceMap`, `SqlBoundNamespace`, and `SqlUnboundNamespace` have no drop-in replacement:
      construct SQL namespaces only through a target `createNamespace` factory (`postgresCreateNamespace`
      / `sqliteCreateNamespace`). Any hand-written SQL namespace type literal or fixture must carry the
      target `kind` (e.g. `'postgres-schema'`) instead of the removed `'sql-namespace'` discriminator.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      contains:
        - "SqlNamespaceTablesInput"
        - "buildSqlNamespace"
        - "SqlBoundNamespace"
        - "SqlUnboundNamespace"
        - "'sql-namespace'"
      anyMatch: true
---

<!--
TML-2787 (M:N slice 3): namespace-scoped execution-default refs land in
`@prisma-next/sql-orm-client` (nested writes through a junction, the
required-payload gate, and the namespace-keyed `ExecutionMutationDefault.ref`).
The changes are internal to the ORM client and its emitted-contract consumption;
the extension-author surface is unchanged. No extension-author action — re-emit
picks up the new contract ref shape. Incidental substrate diff only.

TML-2929 (replace legacy PSL parser with CST symbol table): the SQL/Mongo PSL
interpreters now consume a symbol table built from the CST parser instead of the
legacy `parsePslDocument` AST. The only `packages/3-extensions/` touch is a
test-file call-shape rewire in `postgres/test/psl-namespace-qualifier-routing.test.ts`
(`{ document }` → the symbol-table interpreter input); no extension-author API
changed. No extension-author action. Incidental substrate diff only.

TML-2794 (M:N slice 5): wires the `mn-psl` integration fixture into the
`@prisma-next/sql-orm-client` test `emit` script. Test-fixture infrastructure
only; no extension-author surface change. Incidental substrate diff only.

TML-2868 (Postgres RLS slice 1): adds the additive Postgres row-level-security
authoring feature. The only `packages/3-extensions/` touches are the re-emitted
`supabase/src/contract/contract.d.ts` (regeneration picks up the new RLS-capable
contract shape) and the `supabase/test/supabase-bootstrap.ts` test helper. No
extension-author API changed — the framework SPI is unchanged and re-emit
absorbs the contract shape. Incidental substrate diff only.
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
