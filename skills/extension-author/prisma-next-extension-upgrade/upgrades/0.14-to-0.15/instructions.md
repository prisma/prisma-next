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

TML-2931 (entity-kind-migration-seam): implements the entity-kind seam for
schema diffing and provenance-symmetric RLS diff. The `packages/3-extensions/`
touches are test updates in `pgvector/test/migrations/` (planner fixtures
converted to `PostgresSchemaIR`) and `pgvector/test/descriptor.test.ts`
(contract shape updated to remove `__unbound__` namespace and adjust
`FieldOutputTypes`/`FieldInputTypes` to namespace-keyed form; precheck/postcheck
SQL assertions updated for parameterised queries). No extension-author API
changed. Incidental substrate diff only.
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

<!--
TML-2919: typed-DDL conversion of the not-null-with-temporary-default recipe (slice
1 of the typed-DDL migration-ops project). The recipe's ADD COLUMN execute step
now lowers a typed `PostgresAlterTable` DDL node through the adapter, with the
temporary backfill value carried as a `FunctionColumnDefault` — so the emitted
DEFAULT clause parenthesizes its expression (e.g. `DEFAULT ('')` instead of the
previous `DEFAULT ''`). Semantically identical in PostgreSQL. The recipe's DROP
DEFAULT step also routes through a new typed `DropDefaultAction`. The pgvector
`planner.behavior.test.ts` assertion that pins the recipe's emitted ADD COLUMN
SQL was updated to the parenthesized form. Test-only assertion update — no
extension-author API change. Incidental substrate diff only. (The 0.13 → 0.14
counterpart entry already records the same change; this entry covers the same
substrate diff against the post-0.14.0 main.)
-->

<!--
TML-2911 (native scalar-array storage machinery): the emitted contracts now carry
the adapter-reported `scalarList` capability marker and the bumped envelope
version. The scalar-list machinery threaded through this release is internal — no
authoring path emits a list storage column yet, so extension contracts and runtime
behaviour are unchanged. No extension-author API or surface change. Incidental
substrate diff only.
-->
