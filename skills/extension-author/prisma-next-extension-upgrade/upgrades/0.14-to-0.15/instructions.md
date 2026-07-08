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
  - id: codec-render-value-literal-for-restricted-columns
    summary: |
      A field/column restricted to a value set (e.g. an enum) now derives its narrowed TS literal
      union **through the codec**, not the framework's (now-deleted) domain-enum override. If your
      extension authors a custom codec descriptor (`extends CodecDescriptorImpl`) used by a
      restricted/enum column, implement `renderValueLiteral(value, side)` on it so the column narrows
      to its value union; without it the column widens to the codec's output type
      (`CodecTypes[id][side]`). If your extension builds a `CodecLookup` by hand and drives the
      framework emitter (`generateContractDts`), expose `renderValueLiteralFor` so the emit path can
      reach your descriptor's renderer. Framework-built lookups (via the CLI/build / control-stack)
      already supply it — no action there. (`side`: `output` = the read/SELECT type, `input` = the
      create/update type.)
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "CodecDescriptorImpl"
        - "renderValueTypeFor"
        - "renderOutputType"
      anyMatch: true
  - id: mongo-derive-json-schema-value-sets-param
    summary: |
      `deriveJsonSchema` / `derivePolymorphicJsonSchema` (from `@prisma-next/mongo-contract-psl`) now
      source a value-set field's `$jsonSchema` `enum` keyword from a value-set map, not the domain
      enum. Their fourth argument changed from a domain-enum map
      (`Record<string, ContractEnum>`, read as `members.map(m => m.value)`) to a value-set map
      (`FieldValueSets` = `Record<string, { values: readonly JsonValue[] }>`, keyed by the field's
      `valueSet` `entityName`). If your extension calls either function directly, pass the storage
      value sets (`contract.storage.namespaces[<ns>].entries.valueSet`) instead of `domain.enum`; the
      values are identical for enums, so the rendered validator is unchanged. Most extensions author
      Mongo contracts through `mongoContract(...)` / `defineContract(...)`, which call these
      internally — those need no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "deriveJsonSchema"
        - "derivePolymorphicJsonSchema"
      anyMatch: true
  - id: sql-migration-planner-keep-diff-issue-to-ownership-oracle
    summary: |
      `MigrationPlanner.plan()` (and the SQL family's `SqlMigrationPlannerPlanOptions`) drops the
      `keepDiffIssue` option — a caller-supplied `(issue: DiffIssue) => boolean` predicate the
      planner applied to its schema diff for multi-space ownership scoping. It is replaced by
      `ownership?: SchemaOwnership` — an ownership oracle (`{ declaresEntity(entityName): boolean }`,
      exported from `@prisma-next/framework-components/control`) that the `ContractSpaceAggregate`
      satisfies. The planner asks it, per live extra node, whether any contract space declares that
      entity: a node another space owns is left untouched, a node no space owns is a genuine extra it
      may drop under a destructive policy. If your extension calls `planner.plan(...)` directly with
      `keepDiffIssue` (rather than through the aggregate's `db init` / `db update` / `migrate`
      orchestration, which passes the aggregate as the oracle for you), drop the predicate and pass
      the aggregate (or any object implementing `SchemaOwnership`) as `ownership`. There is no
      names-set and no filter function — ownership lives in the aggregate; the planner only asks.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "keepDiffIssue"
      anyMatch: true
  - id: family-sql-collect-sql-schema-issues-removed
    summary: |
      `collectSqlSchemaIssues`, `collectSqlSchemaIssuesPerNamespace`, and their
      `CollectSqlSchemaIssuesOptions` options type are removed from `@prisma-next/family-sql/diff`.
      They implemented the coordinate-based relational schema diff the migration planner used before
      it moved onto the generic node differ (`plan(start, end)`). There is no drop-in replacement —
      if your extension called either function directly to compare a contract against a live/derived
      schema, use the generic node differ instead: `diffSchemas` (from
      `@prisma-next/framework-components/control`) over two schema-IR trees, or a target's own
      `buildXPlanDiff` (e.g. `buildPostgresPlanDiff` from `@prisma-next/target-postgres/diff-database-schema`,
      `buildSqlitePlanDiff` from the sqlite target) for the same op-render-stamped comparison the
      planner itself runs.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "collectSqlSchemaIssues"
        - "collectSqlSchemaIssuesPerNamespace"
        - "CollectSqlSchemaIssuesOptions"
      anyMatch: true
  - id: sql-control-target-descriptor-diff-database-schema-removed
    summary: |
      `SqlControlTargetDescriptor` (from `@prisma-next/family-sql/control`) drops the
      `diffDatabaseSchema` field — the per-target `SchemaDiffer` hook that used to back the
      coordinate-based relational diff. If your extension implements a custom SQL target descriptor
      and supplied this field, remove it; the migration planner reaches the one differ directly via
      the target's own diff-tree builder now (see the `family-sql-collect-sql-schema-issues-removed`
      entry above). `diffSchemaForVerdict` (the full-tree node diff the verify verdict derives from)
      is unaffected and still required.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "diffDatabaseSchema"
      anyMatch: true
  - id: migration-tools-aggregate-strategy-rename
    summary: |
      `@prisma-next/migration-tools/aggregate` renames its exported graph-walk strategy to say what
      it does, not how it's implemented: `graphWalkStrategy` -> `resolveRecordedPath`,
      `GraphWalkOutcome` -> `ResolveRecordedPathOutcome`, `GraphWalkStrategyInputs` ->
      `ResolveRecordedPathInputs`. The function's behaviour, inputs, and outcome shape are
      unchanged — only the names. If your extension imports any of these symbols directly (rather
      than going through `planMigration`, which handles this internally), update the import names.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "graphWalkStrategy"
        - "GraphWalkOutcome"
        - "GraphWalkStrategyInputs"
      anyMatch: true
  - id: target-postgres-diff-postgres-database-schema-removed
    summary: |
      `diffPostgresDatabaseSchema` is removed from `@prisma-next/target-postgres/planner` — the
      Postgres-specific coordinate-based `SchemaDiffer` implementation, retired alongside
      `SqlControlTargetDescriptor.diffDatabaseSchema` (see the entry above). If your extension
      imported it directly, use `buildPostgresPlanDiff` from
      `@prisma-next/target-postgres/diff-database-schema` instead — it runs the same one-differ
      comparison the planner itself uses (relational + RLS-policy issues in one node-typed list,
      filter to the subset you need) and additionally stamps the op-render payload the planner reads.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "diffPostgresDatabaseSchema"
      anyMatch: true
  - id: schema-issue-vocabulary-retired
    summary: |
      The coordinate-based issue vocabulary is gone: `BaseSchemaIssue`, `SchemaIssue`,
      `EnumValuesChangedIssue`, and the `DiffIssue` union are removed from
      `@prisma-next/framework-components/control`. `SchemaDiffIssue` (`{ path, reason, message,
      expected?, actual? }`) is the only issue shape everywhere now — verify results, the codec
      `verifyType` hook, and `SchemaVerifier.issues` all report it. Its `outcome` field is also
      gone; use `reason` (`'not-found'` | `'not-expected'` | `'not-equal'`) instead — `outcome`'s
      `'missing'` / `'extra'` / `'mismatch'` map onto those three respectively. If your extension
      imports any of the removed types, constructs a `{ kind, table, message }`-shaped issue by
      hand, or reads `.outcome` off a `SchemaDiffIssue`, switch to the node-typed shape and
      `reason`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "BaseSchemaIssue"
        - "EnumValuesChangedIssue"
        - "SchemaDiffOutcome"
        - ".outcome === 'missing'"
        - ".outcome === 'extra'"
        - ".outcome === 'mismatch'"
      anyMatch: true
  - id: schema-finding-lists-single-list
    summary: |
      `SchemaFindingLists` (and therefore `VerifyDatabaseSchemaResult.schema` /
      `.schema.warnings`) collapses from two lists (`issues: SchemaIssue[]`, `schemaDiffIssues:
      SchemaDiffIssue[]`) to one: `{ issues: SchemaDiffIssue[] }`. The framework `SchemaDiff`
      class follows the same collapse — its constructor now takes one issue array instead of
      two (`new SchemaDiff(issues)`, not `new SchemaDiff(issues, schemaDiffIssues)`), and
      `.filter()` narrows the single list. If your extension reads
      `result.schema.schemaDiffIssues` (or `.schema.warnings.schemaDiffIssues`) directly, or
      constructs a `SchemaDiff` by hand, update both call sites to the single-list shape —
      concatenate the old two lists into one, in the same order, if you need to reproduce prior
      combined output.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "schemaDiffIssues"
        - "new SchemaDiff("
      anyMatch: true
  - id: codec-verify-type-hook-returns-schema-diff-issue
    summary: |
      `CodecControlHooks.verifyType` (the storage-type verification hook,
      `@prisma-next/family-sql/control`) now returns `readonly SchemaDiffIssue[]` instead of
      `readonly SchemaIssue[]` — no more `kind` string; classify by `reason` instead. A storage
      type (e.g. a native enum) only ever diverges in its value set, so every paired
      `not-equal` finding grades as value drift (suppressed under an `external` control policy,
      same as before); `not-found` is a missing type, `not-expected` an extra one. If your
      extension implements a custom codec's `verifyType` hook, return `{ path, reason, message,
      expected?, actual? }` issues instead of the old `{ kind, table, message }` shape.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "verifyType:"
        - "verifyType("
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

TML-2884 (Mongo enum end-to-end vertical): adds the Mongo domain-enum authoring
surface. The `packages/3-extensions/mongo/` touches are:
- New `mongo/src/contract/enum-type.ts` and exports in `mongo/src/exports/contract-builder.ts`
  (`enumType`, `member`, `EnumTypeHandle`, `EnumMember`) — all net-new exports; nothing
  existing was changed or removed.
- `mongo/src/runtime/mongo.ts` gains a `db.enums` facade property — an additive
  field on `MongoClient`; existing fields are unchanged.
- `mongo/package.json` gains `@prisma-next/emitter` and `@prisma-next/mongo-emitter`
  devDependencies for the new e2e test.
The `EnumTypeHandle` brand changed from a `Symbol()` to a string-key phantom (`__prismaNextEnumTypeHandle__`);
extension authors never construct or assert against the brand directly, so the structural surface
is unchanged. No extension-author action required — the enum surface is purely additive and
re-emit absorbs the new contract shape. Incidental substrate diff only.
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

<!--
PR #894 (postgres-rls slice 2, schema-node-tree-restructure): restructures the
schema-diff node tree, splits `db verify` into per-space contract-satisfaction
plus one unclaimed-elements list, and moves plan/verify scoping into the
aggregate orchestration. The only `packages/3-extensions/` touches are test
files: `pgvector/test/migrations/planner.*.test.ts` (planner fixtures rebuilt
for the schema-node tree) and `supabase/test/classification.e2e.test.ts`
(comment wording). The renamed internals (`AggregateContractSpace`,
`combineVerifyResults`, the planner keep-predicate) are migration-tools/CLI
internals with no references in any extension source. No extension-author API
changed; no extension-author action. Incidental substrate diff only.
-->

<!--
Exercise Mongo enums in retail-store (this PR): the `MongoClient` facade gains two
additive members — `raw` (MongoRawClient) and `execute<Row>(plan)` (direct query
execution without going through `runtime()`). Both additive; existing extension code
is unaffected. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2955 (expose the static ExecutionContext symmetrically): the built-in target
facades gain a client-safe `@prisma-next/{mongo,postgres,sqlite}/static` entrypoint
(`<target>Static`) and expose `db.context` / `db.contract`. Internally, the mongo
adapter codec now imports `ObjectId` from `bson` instead of `mongodb` so the static
`ExecutionContext` is genuinely driver-free (client-bundle-safe). All additive /
internal — no extension-author API or surface change; existing extensions are
unaffected. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2503 (extension-supabase slice D): `@prisma-next/extension-supabase` gains a
secondary `.supabase` admin root on `asServiceRole()` — new `ServiceRoleDb` /
`SupabaseInternalDb` exports from `/runtime`, backed by the extension contract's own
execution context plus a second runtime sharing the app pool + `service_role` session.
Purely additive for extension authors — no other extension's API is affected, and no
released surface changed (the `WithExtensionNamespaces` export existed only on this
branch's earlier, unmerged merge-design revision and was removed before merge). No
extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2892 (migration-author ContractView): the `unboundNamespace` helper that the
SQLite and Mongo runtimes use to unwrap their single default namespace was lifted
into the shared foundation (`@prisma-next/framework-components/ir`); the two
extension runtimes (`packages/3-extensions/{mongo,sqlite}/src/runtime`) now import
it from there instead of defining a local copy. Behaviour-preserving — the runtime
facade surface (`db.enums`, `sql`, `orm`) is byte-identical. No extension-author
API or surface change; nothing to migrate. Incidental substrate diff only.
-->

<!--
TML-2915 (infer an enum's `@@type` from its members): a PSL `enum` block may now
omit `@@type` and have the codec inferred (text for bare/string members, int for
integers). Additive: the framework gains an optional `AuthoringEntityContext.enumInferenceCodecs`
and a `resolveEnumCodecId` export; each built-in target's config supplies its default
codec ids, and `@prisma-next/adapter-mongo` gains a `./codec-ids` entrypoint. Explicit
`@@type` is unchanged. No extension-author action required — the new context field is
optional and framework-populated. Incidental substrate diff only.
-->

<!--
TML-2912 (PSL native scalar lists, end-to-end): PSL now lowers scalar-list fields
(`String[]`, `Int[]`, …) to native array storage columns instead of the JSONB
fallback, gated on the adapter-reported `scalarList` capability. The review-round
follow-up also makes the adapter capability matrix required end-to-end on the
contract-source seam — `ContractSourceContext.capabilities`,
`InterpretPslDocumentToSqlContractInput`, and the SQL PSL resolution inputs are no
longer optional. These are framework-internal contract-emission types that the
control stack always populates; extension authors do not construct them. The only
`packages/3-extensions/` touch is a one-line test-context update in
`postgres/test/psl-namespace-qualifier-routing.test.ts` (threading the now-required
`capabilities` field). No extension-author API changed — re-emit absorbs the
scalar-list contract shape. No extension-author action required. Incidental
substrate diff only.
-->

<!--
Postgres-RLS slice 2.5 (one-differ-two-ir-planner, the cutover to
`plan(start, end)`): the migration planner now diffs two derived schema IRs
via the generic node differ instead of the coordinate-based relational walk.
The only `packages/3-extensions/` touch is a fixture fix in
`pgvector/test/migrations/{planner.behavior,planner.contract-to-schema-ir}.test.ts`
— the hand-built `PostgresTableSchemaNode` foreign-key fixtures now stamp
`resolvedReferencedSchema` (the differ pairs FK nodes by id, which folds in
that field; an unresolved FK on a hand-built actual node no longer paired with
the derived expected side). Test-fixture-only; no extension-author API
changed. See the `sql-migration-planner-keep-diff-issue-to-ownership-oracle`,
`family-sql-collect-sql-schema-issues-removed`,
`sql-control-target-descriptor-diff-database-schema-removed`,
`migration-tools-aggregate-strategy-rename`,
`target-postgres-diff-postgres-database-schema-removed`,
`schema-issue-vocabulary-retired`, `schema-finding-lists-single-list`, and
`codec-verify-type-hook-returns-schema-diff-issue` entries above for the real
breaking changes this slice makes to the framework SPI.
-->
