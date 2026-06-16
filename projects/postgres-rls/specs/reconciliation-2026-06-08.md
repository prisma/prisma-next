# postgres-rls spec reconciliation — 2026-06-08

> **Superseded (2026-06-16).** Several items below describe the pre-rebase model that was replaced on the branch. Preserved for historical provenance. The authoritative design is in `spec.md`, `plan.md`, and the slice specs. Do not rely on §§ D1 (StorageTable.rls), §§ Architectural placement corrections (the `rls?` field), or § Two open design decisions (D1/D2/D3 — all settled). Delete on project close-out.

Provenance note for the spec/plan rewrite. Captures where the weeks-old spec diverged
from the **actual landed code** of its now-merged dependencies. Produced by three
parallel code investigations against the worktree. Delete on project close-out.

## Dependency status (vs. umbrella README, which is stale)

| Dependency | README said | Actual landed reality |
|---|---|---|
| TML-2459 target-extensible-ir | Done & closed | Done. IR base + SPI seams landed (names differ from spec — see below). |
| TML-2493 control-policy | Effectively done | **Fully landed.** `ControlPolicy` type + two-layer verifier/planner dispatch live. Project dir gone; design in ADR 224. |
| TML-2500 cross-contract-refs | Next up | **M1+M2+M3a MERGED**, M3b in flight. Brand machinery (`extensionModel`, `TargetFieldRef<TSpaceId>`, `ForeignKeyReference.spaceId?`) fully available — **depend-able now**. |
| TML-2537 target-contributed-psl-blocks | In flight; gates PSL surface | Substrate **slices 1–3 LANDED** (declarative PSL-block SPI usable now). Slice 4 (ADR + close-out) open; dir still present. Real tickets: TML-2804/2854/2849/2806. |

`examples/supabase` walking skeleton **exists** (extension-supabase M1, live in CI). `bootstrapSupabaseShim`
exists at `packages/3-extensions/supabase/test/supabase-bootstrap.ts` but deliberately **omits Postgres roles +
`auth.*` functions** — its comment marks those as postgres-rls's job.

## Mechanical renames (spec vocabulary → real code)

| Spec says | Reality | Location |
|---|---|---|
| `SchemaNodeBase` | `IRNodeBase` (framework) / `SqlNode extends IRNodeBase` (SQL family) | `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts`; `packages/2-sql/1-core/contract/src/ir/sql-node.ts` |
| `PostgresTable extends SqlTableBase` | No such class. Tables are `StorageTable extends SqlNode` (SQL-family, shared by PG+SQLite) | `packages/2-sql/1-core/contract/src/ir/storage-table.ts` |
| `PostgresStorage` | No such class. Storage root is shared `SqlStorage`; per-namespace container is `PostgresSchema` with `entries: { table, type }` | `packages/2-sql/1-core/contract/src/ir/sql-storage.ts`; `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` |
| `__unspecified__` (IR/DDL sentinel) | `UNBOUND_NAMESPACE_ID = '__unbound__'` at IR layer. `__unspecified__` is **PSL-parser-only** vocabulary, never reaches IR | `packages/1-framework/1-core/framework-components/src/ir/namespace.ts` |
| `AuthoringContributions.entities` | `AuthoringContributions.entityTypes` (+ new `pslBlockDescriptors`) | `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` |
| `TargetFieldRef { source: 'local'|'space' }` | `source: 'string'|'token'` (authoring provenance); cross-space discriminated by **`spaceId?` presence** | `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` |
| `PslField.typeContractSpace` | `PslField.typeContractSpaceId` | contract-psl |

## Architectural placement corrections

> **Partially superseded.** The `StorageTable.rls` bullet below was removed in the shipped model. See note at top.

- **`PostgresRlsPolicy` / `PostgresRole` attach to `PostgresSchema.entries`** (new slots, following the
  `PostgresEnumType` precedent in `entries.type`), **NOT to a table class**. Register via
  `postgresAuthoringEntityTypes` (`entityTypes` contribution) — same precedent as `enum`.
  See `packages/3-targets/3-targets/postgres/src/core/authoring.ts`. Entity kind key is `policy` (not `rlsPolicy`).
- ~~**`StorageTable` gains `rls: 'auto'|'enabled'|'disabled'`**~~ — **Removed in shipped model.** RLS-enabled
  state is *derived* (planner emits `ENABLE ROW LEVEL SECURITY` when a table has ≥1 declared policy); no `rls`
  field on `StorageTable`.
- **Serializer**: extend `PostgresContractSerializer.serializePostgresNamespace()` + `hydrateSqlNamespaceEntry()`
  (`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`).
- **Verifier seam**: `PostgresSchemaVerifier.verifyTargetExtensions()` is a stub returning `[]` — the exact seam
  for RLS catalog introspection (`packages/3-targets/3-targets/postgres/src/core/postgres-schema-verifier.ts`).
  No `pg_policies`/`pg_roles`/`relrowsecurity` queries exist anywhere yet.
- **Migration ops**: extend the `PostgresOpFactoryCall` union (`.../core/migrations/op-factory-call.ts`) + add pure
  factory fns in a new `.../core/migrations/operations/rls.ts`; register planner strategies in `planner-strategies.ts`.
  DDL is built inline in factory fns via `step()`/`targetDetails()` (`operations/shared.ts`) — there is no separate renderer.

## Control-policy dispatch — more nuanced than the spec's prose

> **Superseded.** The shipped model uses `SchemaDiffIssue {coordinate, outcome}` (generic differ, no framework RLS
> issue kinds). The old `SchemaIssue` widening approach below was rejected. The control-policy severity
> integration for RLS drift is slice 2 work. See `spec.md § D5` and `plan.md § Slice 2`.

~~Real shape is **two layers**:~~
~~1. `classifySqlVerifierIssueKind(kind) → VerifierIssueCategory`~~
~~2. `dispositionForCategory(controlPolicy, category) → 'fail'|'warn'|'suppress'`~~

~~New issue kinds must be categorized: `missing_rls_policy → declaredMissing`, `extra_rls_policy → extraAuxiliary`,
`missing_role → declaredMissing`. Emit via `emitIssueUnderControlPolicy(...)`~~

~~**Correction to spec prose:** outcomes are `fail|warn|suppress` (not `error`). Under `external`, **declaredMissing still
FAILS**~~

~~**Planner:** control gating is a **pre-filter** (`partitionIssuesByControlPolicy`)~~

## Two open design decisions the rewrite must settle

> **Superseded.** All three decisions below were settled. See `spec.md § D3/D5` and `plan.md § Architecture decisions`.

### D1 — `SchemaIssue` widening (**settled: rejected**)

Widening the framework `SchemaIssue` union is the layering violation. Shipped model: generic `SchemaDiffIssue {coordinate, outcome}` — the framework enumerates nothing. See `spec.md § D5 Alternatives`.

### D2 — PSL keyword shape (**settled: per-operation keywords adopted**)

`policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`. See `spec.md § D3`.

### D3 — `.rls()` method gating (**settled: top-level helper, not builder method**)

`policySelect(model, { … })` top-level helper (Postgres-contributed via `entityTypes`), not a chained builder method. See `spec.md § D3`.

## Usable substrate (build directly on these)
1. Declarative PSL-block SPI (`AuthoringPslBlockDescriptor`, `ref/value/option/list` params, generic parser/printer,
   `extensionBlocks` slot, `entries[kind][name]` storage) — slices 1–3 landed.
2. `SqlSchemaVerifierBase.verifyTargetExtensions()` stub — the RLS verifier seam.
3. `IRNodeBase` + `freezeNode`.
4. `ContractModelBuilder` `.relations() → .attributes() → .sql()` chain — `.rls()` is the 4th stage.
5. `examples/supabase` walking skeleton (live CI) + `bootstrapSupabaseShim` (extend with roles + `auth.*` fns).
6. `extensionModel(...)` handles (`AuthUser` etc.) already bake `{ namespaceId, tableName }` — `ref()` reads them
   directly; no aggregate lookup needed.
</content>
</invoke>
