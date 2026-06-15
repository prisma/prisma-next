# postgres-rls spec reconciliation — 2026-06-08

Provenance note for the spec/plan rewrite. Captures where the weeks-old spec diverges
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

- **`PostgresRlsPolicy` / `PostgresRole` attach to `PostgresSchema.entries`** (new slots, following the
  `PostgresEnumType` precedent in `entries.type`), **NOT to a table class**. Register via
  `postgresAuthoringEntityTypes` (`entityTypes` contribution) — same precedent as `enum`.
  See `packages/3-targets/3-targets/postgres/src/core/authoring.ts`.
- **`StorageTable` gains `rls: 'auto'|'enabled'|'disabled'`**; policies live at schema level, cross-referenced
  to tables by name. (`StorageTable` already carries `control?: ControlPolicy`.)
- **Serializer**: extend `PostgresContractSerializer.serializePostgresNamespace()` + `hydrateSqlNamespaceEntry()`
  (`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`).
- **Verifier seam**: `PostgresSchemaVerifier.verifyTargetExtensions()` is a stub returning `[]` — the exact seam
  for RLS catalog introspection (`packages/3-targets/3-targets/postgres/src/core/postgres-schema-verifier.ts`).
  No `pg_policies`/`pg_roles`/`relrowsecurity` queries exist anywhere yet.
- **Migration ops**: extend the `PostgresOpFactoryCall` union (`.../core/migrations/op-factory-call.ts`) + add pure
  factory fns in a new `.../core/migrations/operations/rls.ts`; register planner strategies in `planner-strategies.ts`.
  DDL is built inline in factory fns via `step()`/`targetDetails()` (`operations/shared.ts`) — there is no separate renderer.

## Control-policy dispatch — more nuanced than the spec's prose

Real shape is **two layers**:
1. `classifySqlVerifierIssueKind(kind) → VerifierIssueCategory` (SQL family) —
   `packages/2-sql/9-family/src/core/schema-verify/verifier-disposition.ts`.
2. `dispositionForCategory(controlPolicy, category) → 'fail'|'warn'|'suppress'` (framework) —
   `packages/1-framework/1-core/framework-components/src/control/verifier-disposition.ts`.

New issue kinds must be categorized: `missing_rls_policy → declaredMissing`, `extra_rls_policy → extraAuxiliary`,
`missing_role → declaredMissing`. Emit via `emitIssueUnderControlPolicy(...)` / `emitIssueAndNodeUnderControlPolicy(...)`.

**Correction to spec prose:** outcomes are `fail|warn|suppress` (not `error`). Under `external`, **declaredMissing still
FAILS** — `external` only suppresses *extras*. So a declared role with `control:'external'` absent from `pg_roles`
**does** surface (AC9 holds), but the spec sentence "external ignores both [missing and extra]" is wrong. `observed → warn`,
not silent.

**Planner:** control gating is a **pre-filter** (`partitionIssuesByControlPolicy`, called in `planner.ts` before
`planIssues`), not a planner-internal switch. Hook new RLS issue kinds into `resolvePostgresIssueControlPolicySubject`
(+ `POSTGRES_ISSUE_CREATION_FACTORY` for the creation-flavored `missing_role`) in
`packages/3-targets/3-targets/postgres/src/core/migrations/control-policy.ts`.

## Two open design decisions the rewrite must settle

### D1 — `SchemaIssue` widening (was assumed "free" target-side; it is NOT)
`SchemaIssue` is a **closed discriminated union in the framework package** (`control-result-types.ts`). There is no
target-side widening mechanism — TML-2459 explicitly deferred it (comment in `schema-verifier.ts`). Options:
- **(a)** Add `rls_policy_renamed | rls_policy_tampered | rls_not_enabled` to the framework union (small framework touch;
  follows the existing `EnumValuesChangedIssue` precedent).
- **(b)** Define a Postgres-local `PostgresSchemaIssue = SchemaIssue | RlsIssue` for the verifier and only fold
  framework-typed issues back into the shared pipeline.
Lean: (a) — matches the `EnumValuesChangedIssue` precedent and avoids a parallel issue type. Confirm during specify.

### D2 — PSL keyword shape (spec contradicts the landed substrate)
Spec wants a single `policy <name> { operation = select|insert|... }` block. The landed target-contributed-psl-blocks
substrate **deliberately rejects** conditional-parameter blocks in favor of **per-operation keywords**
(`policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`), each with a fixed unconditional
parameter set (fixture: `declarative-policy-select-extension.ts`). The substrate's declarative SPI only supports
`ref|value|option|list` params — no conditional bodies.
Lean: **adopt per-operation keywords** to align with the substrate (the design already landed). The rewrite should
update the PSL grammar accordingly and note the TS `.rls([{ operation }])` array surface stays as-is (TS is unconstrained).

### D3 — `.rls()` method gating (pack-aware *presence*, which doesn't exist yet)
`PackAwareSqlConstraints<IndexTypes>` gates index **option shapes** inside `.sql()`, NOT method *presence*. Making
`.rls()` visible only under Postgres needs a capability-set type param on `ContractModelBuilder`. `ExtractPackCapabilities`
type machinery exists in `contract-types.ts` but is **not wired** to method visibility. Options: build the capability-gating
mechanism (larger), or expose `.rls()` always and make it a lowering error off-Postgres (smaller, matches the
"explicit-opt-in-over-diagnostics" posture loosely). Decide during specify/plan.

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
