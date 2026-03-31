# Summary

Data migrations are user-authored query builder expressions that transform data during structural schema migrations. They are authored in TypeScript using the existing ORM/query builder, serialized to target-agnostic JSON ASTs in `ops.json` at verification time, and rendered to SQL by the target adapter at apply time. They execute mid-edge in the migration graph — after additive/widening ops create the new schema surface, before destructive ops tighten constraints and drop old columns. The system tracks data migrations as named invariants on graph edges, enabling invariant-aware routing.

# Description

Prisma Next's graph-based migration system models schema evolution as a directed graph of contract-hash states connected by structural migration edges. This works well when migrations are purely structural (path-independent), but breaks down when data transformations are involved — two databases at the same contract hash can have meaningfully different data depending on which path was taken.

Data migrations solve this by allowing users to attach serialized query operations to graph edges. The system doesn't reason about what the queries do; it tracks that named migrations were applied, and routes through paths that satisfy required invariants. This preserves the graph model's flexibility for structural routing while adding data-awareness without collapsing to linear history.

The primary user is a backend developer who knows SQL but doesn't think about migration theory. They want to describe what should happen and have the system handle safety. The system should detect when data migrations are needed, scaffold the file, and let the user fill in the logic.

# Requirements

These are the problems the system must solve. The Solution section describes how each is addressed.

## R0. No arbitrary code execution at apply time

Data migrations must not involve executing arbitrary TypeScript at apply time. The authoring surface is TypeScript (using the existing ORM/query builder), but the output is a serialized JSON AST that can be inspected, audited, and shipped to a SaaS runner without trusting user code. This is critical because: (1) migrations will eventually be serialized and shipped to a hosted service, where executing arbitrary code is a non-starter, (2) even locally, importing a TypeScript module executes top-level code, which is a security risk in team settings, (3) serialized ASTs enable plan-time visibility — reviewers see exactly what will execute.

## R1. Users can express data transformations during schema migration

Schema evolution often requires data transformations that the database cannot perform automatically: backfilling computed values, converting between types with ambiguous mappings, splitting/merging columns or tables, resolving constraint violations, seeding reference data. The system must provide a way for users to express data transformation queries as part of a migration. See [data-migration-scenarios.md](./data-migration-scenarios.md) for the full scenario enumeration.

## R2. Data migrations cover a wide range of schema evolution scenarios

The system must handle the common patterns — computed backfill, lossy type changes, column split/merge, table split/merge, normalization/extraction, key identity changes, constraint enforcement, data seeding. The query builder is the sole authoring surface for v1; if it can't express a scenario, that's either a gap to fill in the query builder or an out-of-scope limitation. Scenarios requiring application-level libraries (e.g., bcrypt hashing) or external data sources are out of scope and must be handled outside the migration system.

## R3. Data migrations are safe to retry after partial failure

If a migration fails midway (crash, timeout, constraint violation), re-running it must not corrupt data or produce duplicate effects. The system needs a mechanism to determine whether a data migration has already been applied, and skip it if so.

## R4. Users don't accidentally skip required data transformations

When the planner detects a structural change that implies data migration is needed (e.g., adding a NOT NULL column without a default), it must ensure the user addresses it before the migration can be applied. An unimplemented data migration keeps the package in draft state — `migration verify` cannot attest it, and `migration apply` rejects unattested packages.

## R5. Data migration queries have access to both old and new schema state

During a data migration, the user's queries need to read from old columns/tables (to get existing data) and write to new columns/tables (to populate transformed data). The old schema must not yet be torn down, and the new schema must already be partially set up.

## R6. Data migrations work on tables of all sizes

Small tables can be migrated within a single transaction for atomicity. Large tables may require batched updates outside of a transaction, or DDL that can't run in a transaction (e.g., `CREATE INDEX CONCURRENTLY`). The execution model must accommodate both extremes.

## R7. Data migrations participate in the graph model

The migration graph must be aware of data migrations. When multiple paths exist to the same contract hash, the system must be able to distinguish paths based on what data transformations they include, and select appropriately.

## R8. Environments can declare which data migrations are required

Different environments (production, staging, dev) may need different data migration guarantees. The system must allow environments to declare which named data migrations must have been applied, and route accordingly.

## R9. Users can author migrations manually

Users need to be able to write their own migration (structural DDL, data transformations, or both) without relying on the planner. This should integrate naturally with the data migration mechanism rather than requiring a separate authoring surface.

## R10. Planning works offline (no database connection required)

Per ADR 169, migration planning must not require a live database connection. Detection of data migration needs and scaffolding must work from contract diffs alone.

## R11. Post-apply verification catches schema mismatches

After a migration (including any data migration) completes, the system must verify that the database schema matches the destination contract. This is the hard safety net — if the migration didn't produce the expected schema state, apply fails.

## R12. No special rollback mechanism

Reverting a migration is just another migration in the opposite direction. The system should not introduce rollback-specific machinery for data migrations. A migration S2→S1 is an ordinary graph edge that can carry its own data migration.

# Solution

## Constraints

These apply across the entire solution:

- The framework-level op partitioning function must not depend on target-specific knowledge — it operates solely on operation classes.
- Only serialized JSON ASTs are stored in `ops.json`. The target adapter renders them to SQL at apply time. No TypeScript is loaded or executed at apply time.
- User-authored data migration queries should be idempotent. The required `check` query provides the primary retry-safety mechanism, but truly idempotent `run` queries are the safest approach for `isolated`/`unmanaged` modes.

## Authoring and serialization model (R0, R1, R2, R9)

Data migrations are authored in a `data-migration.ts` file inside the migration package directory (alongside `ops.json`), using a `defineMigration({ name, transaction, check(client), run(client) })` API.

The `client` parameter provides the existing ORM/query builder interface. Functions return query ASTs — they do not execute queries directly. This is the key to R0: the TypeScript is evaluated once (at verification time) to produce ASTs, which are serialized as JSON into `ops.json`. At apply time, the target adapter renders the ASTs to SQL and executes them. No TypeScript is loaded.

Each migration edge supports at most one data migration (single `data-migration.ts` per package).

### Serialization lifecycle

The `data-migration.ts` integrates with the existing Draft → Attested → Applied lifecycle:

1. **Scaffold (Draft)**: `migration plan` detects a data migration is needed, scaffolds `data-migration.ts` with unimplemented functions. The migration package has no `edgeId` (draft state).
2. **Author (Draft)**: User fills in `check` and `run` using the ORM/query builder. Still draft — the TS hasn't been evaluated and the ASTs haven't been serialized.
3. **Verify/Attest**: `migration verify` (or re-running `migration plan`) evaluates the TypeScript, captures the resulting query ASTs, serializes them as JSON into `ops.json` as `data_migration` operation entries. The `edgeId` is computed from the serialized content. The package is now attested.
4. **Apply**: `migration apply` reads the serialized ASTs from `ops.json`, the target adapter renders them to SQL, and executes them. No TypeScript is loaded. Only attested packages are applied (existing behavior).

The `data-migration.ts` file remains in the package as source code for reference, but is not part of the `edgeId` computation. If the TS is edited after attestation, the serialized ASTs are stale — re-running `migration verify` re-evaluates and re-serializes.

### Representation in ops.json

The serialized data migration is a first-class operation in `ops.json` — a `data_migration` entry alongside the structural operations, containing the JSON-serialized query ASTs produced by the ORM/query builder. The target adapter renders these to SQL at apply time, same as structural operations. The runner processes it sequentially like any other operation.

```typescript
import { defineMigration } from '@prisma-next/migration'

export default defineMigration({
  name: 'split-user-name',
  transaction: 'inline',

  check(client) {
    return client.users.count().where({ firstName: null })
    // Serialized as JSON AST in ops.json
    // Rendered at apply time to: SELECT COUNT(*) FROM "users" WHERE "first_name" IS NULL
    // Runner interprets: count === 0 → already applied (skip run)
  },

  run(client) {
    return client.users
      .update({ firstName: expr("split_part(name, ' ', 1)"),
                lastName: expr("split_part(name, ' ', 2)") })
      .where({ firstName: null })
    // Serialized as JSON AST in ops.json
    // Rendered at apply time to: UPDATE "users" SET "first_name" = split_part(...), ...
    // Note: exact API for raw expressions TBD based on query builder capabilities
  }
})
```

### Manual authoring — `migration new` (R9)

`migration new` scaffolds a migration package with a `data-migration.ts` and empty (or no) structural ops. The user writes queries using the ORM/query builder. This is the escape hatch for when the user wants to author the entire migration manually.

`migration new` derives `from` hash from the current migration graph state (same logic as `migration plan`) and `to` hash from the current emitted contract. Both can be overridden with `--from` and `--to` flags.

No verification at authoring time. Post-apply schema verification (R11) catches mismatches.

## Retry safety — required `check` (R3)

`check(client)` is **required**. It returns one of:

- **A query AST** (the common case): the query describes *violations* — rows that indicate the migration still needs to run. Empty result = already applied (skip `run`). Non-empty result = needs to run. This is efficient (`LIMIT 1` for early exit) and the violation rows are useful for diagnostics.
- **`false`**: always run. For seeding, idempotent-by-construction cases, or when a meaningful check isn't worth writing.
- **`true`**: always skip. Use with caution.

The check executes at the same point in the migration — between phase 1 (additive/widening) and phase 3 (destructive) — in two roles:

- **Before `run` (retry)**: determines whether to skip `run`. If the check returns no violations, the data migration is already complete.
- **After `run` (validation)**: confirms that `run` did its job. If violations remain, the migration fails *before* phase 3 tightens constraints — producing a meaningful diagnostic ("47 rows still have first_name IS NULL") instead of a cryptic database error from phase 3 ("cannot set NOT NULL, column contains nulls").

This dual role means the execution within phase 2 is: check → (skip or run) → check again → (fail or proceed to phase 3).

## Detection and scaffolding (R4, R10)

The planner detects structural changes that imply a data migration is needed:

- NOT NULL column added without a default
- Non-widening type change (e.g., FLOAT → INTEGER)
- Existing nullable column becoming NOT NULL

Detection works offline (no database connection required). The planner scaffolds when the structural diff *could* need a data migration, even if affected tables might be empty at runtime.

When detection triggers, the planner generates a `data-migration.ts` with unimplemented `check` and `run` functions. The unimplemented functions prevent `migration verify` from attesting the package — it stays in draft state until the user fills them in.

For non-widening type changes on the same column (e.g., `price FLOAT` → `price BIGINT`), the planner uses a **temp column strategy**: it emits an additive op to create a temporary column with the target type, places the data migration slot after it, and emits destructive ops to drop the original column and rename the temp column. This gives the user's queries a writable column of the correct target type during the data migration. The temp column name is deterministic and referenced in the scaffold comment.

## Phased execution (R5, R6)

When a data migration is present on an edge, the planner emits a `data_migration` operation entry interleaved with structural ops. The planner partitions structural ops into phases by operation class:

1. **Phase 1**: all `additive` and `widening` ops (new tables, new nullable columns, relaxed constraints)
2. **Phase 2**: `data_migration` operation (serialized query ASTs from the data migration)
3. **Phase 3**: all `destructive` ops (SET NOT NULL, drop old columns, type changes)

This partitioning is implemented as a generic framework-level function over operation classes. Target planners produce structural ops as they do today; the framework inserts the data migration entry and orders the result. For v1, the ordering is a simple class-based partition. When a proper operation dependency model lands (with `dependsOn` and topological sort), the data migration operation should integrate with that.

### Transaction modes (R6)

The data migration declares one of three transaction modes:

| Mode | Behavior | Use case |
|------|----------|----------|
| `inline` | Runs inside the structural migration's transaction. Full atomicity — failure rolls back everything. | Small/fast migrations on small tables. Default. |
| `isolated` | Gets its own transaction. Phase 1 commits first, data migration runs in a separate transaction, phase 3 runs in a third transaction. | Medium tables where you want transactional safety for the data migration but can't hold structural locks open. |
| `unmanaged` | No transaction wrapping. The serialized SQL executes without a transaction. | DDL that can't run in a transaction (e.g., `CREATE INDEX CONCURRENTLY`), or cases where the user provides multiple batched statements in their `run`. |

In `isolated` and `unmanaged` modes, phase 1 ops are skipped on retry via existing idempotency checks (postchecks pass because columns/tables already exist). The data migration step is skipped on retry if the serialized check query indicates "already applied".

## Graph integration (R7, R8)

The invariant carried by the system is "named data migration X was applied." This is recorded in the ledger when the migration edge completes successfully.

The router finds candidate paths via DFS, collecting data migration names along each path. Path selection:

1. Filter to paths that satisfy required invariants (from environment refs)
2. Prefer paths with more invariants (do the most complete migration)
3. Tie-break by shortest path / deterministic ordering

Environment refs declare desired state as target contract hash + required data migration names. A ref update is explicit and reviewable.

## Post-apply verification (R11)

The existing post-apply schema verification (introspect database, compare against destination contract) serves as the hard safety net for data migrations. No additional verification mechanism is needed — the runner already does this for structural migrations, and it naturally extends to cover data migrations.

## Rollback (R12)

No special rollback mechanism. Reverting state S1→S2 is a new migration S2→S1 — an ordinary graph edge that can carry its own data migration if needed.

# Key Decisions

These document the major design choices, the alternatives considered, and why we chose this approach. They are most useful after reading the Requirements and Solution sections.

## D1. TypeScript-authored, AST-serialized, SQL-executed — not an operator algebra

**Decision**: Data migrations are authored in TypeScript using the existing ORM/query builder, serialized to JSON ASTs at verification time, and rendered to SQL by the target adapter at apply time. They are not algebraic representations (SMO-style typed operators with commutativity analysis), and they do not execute arbitrary TypeScript at apply time.

**Alternatives considered**:
- **Operator algebra**: A V2 operator algebra (`derive`, `derive_across`, `deduplicate`, `expand`, `filter`, `generate`) inspired by PRISM's Schema Modification Operators. Would enable automatic path equivalence reasoning and canonical form comparison. Rejected because: the expression language does "enormous work", and any scenario the algebra can't handle falls through to an opaque escape hatch.
- **Arbitrary code execution at apply time**: User writes TypeScript that runs directly against the database. Rejected because: (1) migrations will be shipped to a SaaS runner where arbitrary code is a security risk, (2) importing TypeScript modules executes top-level code, (3) serialized ASTs enable plan-time visibility and auditability.

**Why this approach**: The ORM/query builder already exists and is expressive enough for the common data migration scenarios (S1–S14). The authoring experience is TypeScript (familiar, type-safe), but the execution artifact is a JSON AST (serializable, auditable, target-agnostic, shippable). The serialization happens at verification time as part of the existing Draft → Attested lifecycle.

**What we give up**: Scenarios requiring application-level libraries (S16: bcrypt hashing) or external data sources (S17: audit trail from external API) cannot be expressed. These are edge cases handled outside the migration system.

## D2. Name over semantic postconditions; honest about what invariants are

**Decision**: The system tracks data migrations by **name** (identity, human-readable). The invariant is "named data migration X was applied."

**What this actually is**: Functionally, this is the same as carrying around proof that specific migrations ran. For any path segment that has data migrations, the model degenerates to "you must take this specific path" — which is linear history for that segment. Data migrations are inherently path-dependent; we're not trying to make them path-independent. The graph's flexibility only helps for structural-only segments.

**Why name**: The name is stable under code changes (fixing a bug in the migration doesn't change its identity), human-readable in CLI output and ref files, and serves as the primary key for invariant requirements.

**Alternative considered — semantic postconditions**: Carry checkable predicates about data state ("all phone numbers match E.164"). Problem: we can't exhaustively cover all possible postcondition checks with a typed representation. The required `check` function (D3) gives us user-authored postconditions for retry safety without pretending the system can reason about them.

## D3. Required `check` postcondition

**Decision**: Every data migration must implement a `check(client)` function that returns a query AST (describing violations — empty result means done), `false` (always run), or `true` (always skip). The query is serialized to JSON, rendered to SQL at apply time, and executed to determine if the migration has already been applied.

**Alternatives considered**:
- Optional postconditions with a separate ledger completion marker for retry safety
- No postconditions, relying solely on idempotent queries

**Why required**: Solves three problems with one mechanism: (1) retry safety — runner executes the rendered check SQL before the run SQL, skipping if already done, (2) no need for a mid-migration ledger write or separate completion marker, (3) forces the user to think about what "done" means. The escape hatch is trivial (`return false` to always run, `return true` to always skip) so it doesn't block users who don't care, but it nudges toward correctness.

## D4. Single-edge with interleaved ops over split into multiple edges

**Decision**: A data migration lives within a single graph edge. Structural ops are partitioned into phases (additive → data migration → destructive) within that edge.

**Alternatives considered**: Split the migration into two edges — Edge 1 (additive ops, creates intermediate contract state) → Edge 2 (destructive ops). The data migration runs between the two edges.

**Why single-edge**:
- The split model requires synthesizing an intermediate contract from partial ops — a function like `applyOp(contract, op) → contract` which does not exist in the system.
- The intermediate contract state is graph noise — an implementation artifact that leaks into the user's mental model. Nobody wants to target it with a ref or reason about it.
- The single-edge model preserves the option for `inline` transaction atomicity (one transaction wrapping everything), which the split model loses since each edge runs its own transaction.
- The single-edge model requires bounded runner changes (process serialized ASTs between structural op phases) rather than a new contract synthesis capability.

## D5. Co-located with edges, not independent

**Decision**: Data migrations are attached to structural migration edges (Model A from the solutions doc). They are not independent artifacts that float in the graph.

**Alternatives considered**: Model B (independent data migrations applied when schema allows) — data migrations are separate from structural transitions, applied whenever their schema requirements are met.

**Why co-located**: A data migration almost always needs a specific schema to run against. It has a natural home on the edge that creates that schema. Co-location means the structural path determines which data migrations run — no separate routing layer needed. Model B would require its own compatibility checking, routing, and execution model.

## D6. Class-based op partition for v1, dependency model later

**Decision**: For v1, the planner partitions ops by operation class: additive/widening before the data migration, destructive after. A proper operation dependency model (`dependsOn` + topological sort) is future work.

**Alternatives considered**: Implement `dependsOn` from the start, with the data migration operation expressing explicit dependencies on structural ops.

**Why class-based for now**: Covers the common scenarios (S1–S5, S9, S10, S14). The known gap — constraint additions (UNIQUE, CHECK, FK) are classified as `additive` but are semantically tightening and should run after the data migration (S13) — is a real limitation but not a blocker for VP1. The dependency model is the proper fix and should be designed to subsume the class-based partition when it lands.

## D7. Temp column strategy for same-column type changes

**Decision**: When a column's type changes without a rename (e.g., `price FLOAT` → `price BIGINT`), the planner creates a temporary column of the target type, places the data migration after it, and emits destructive ops to drop the original and rename the temp.

**Alternatives considered**:
- Use `ALTER COLUMN TYPE ... USING` to let the database handle the conversion. Problem: this bypasses the data migration entirely — the user can't control the conversion logic.
- Write new-type values to the old-type column. Problem: the old column can't hold values of the new type.
- Change the type first, then transform. Problem: the type change may fail or lose data before the user's conversion runs.

**Why temp column**: It's the only approach that gives the user a writable column of the correct target type while the old data is still available to read from. The temp column name is deterministic and referenced in the scaffold comment. The user never sees it in the final schema.

**Future refinement — `USING` clause for common conversions**: Many type changes can be expressed as a single SQL expression in an `ALTER COLUMN TYPE ... USING` clause (e.g., `USING (price * 100)::bigint`, `USING created_at AT TIME ZONE 'America/New_York'`, `USING CASE status WHEN 1 THEN 'active' END`). When the conversion is a SQL expression, the `USING` approach is simpler — no temp column, no data migration file, just a single structural op. The planner could offer common conversion patterns (multiply, cast, round, timezone, enum lookup) and generate the `USING` clause directly, falling back to the temp column strategy only when the user needs imperative logic that can't be expressed as a single SQL expression. This fits into the deferred "smart scaffolding / recipe templates" layer.

## D8. Planner detects, scaffolds with context, and prevents accidental no-ops

**Decision**: The planner auto-detects structural changes that imply a data migration is needed (NOT NULL without default, non-widening type change, nullable → NOT NULL) and scaffolds a `data-migration.ts` that: (a) provides the full `defineMigration` boilerplate so the user starts from a working structure, (b) includes comments describing what was detected and what the user needs to provide, and (c) keeps the package in draft state until the user fills in the implementation — `migration verify` cannot attest an unimplemented data migration.

**Alternatives considered**:
- Warn only — planner flags the need, user creates the file manually. Problem: easy to miss the warning and proceed without a data migration.
- Block — planner refuses to create the migration package until user provides a data migration. Problem: blocks the plan workflow; user can't see the structural plan until they've written data migration code they don't yet understand.
- Smart scaffolding — pre-fill the `run` function with likely queries based on the detected pattern. Future DX layer; minimal scaffolding proves the model first.

**Why this approach**: The system takes responsibility for detection and gives the user a starting point with enough context to understand what's needed. The draft state guarantees that unimplemented data migrations cannot be applied — the package must be attested first, which requires the TS to produce valid query ASTs.

# Acceptance Criteria

## Authoring and serialization

- [ ] A `data-migration.ts` file using `defineMigration` is recognized during verification/planning
- [ ] `check(client)` is required — `defineMigration` without `check` is a type error
- [ ] `run(client)` and `check(client)` receive the ORM/query builder client and return query ASTs
- [ ] `migration verify` evaluates the TypeScript once and serializes resulting ASTs as JSON into `ops.json`
- [ ] No TypeScript is loaded or executed at `migration apply` time — only serialized ASTs from `ops.json` rendered to SQL by the target adapter
- [ ] The `data-migration.ts` source file is not part of the `edgeId` computation; only serialized ASTs are
- [ ] A migration package with an unresolved `data-migration.ts` (not yet serialized) is in draft state (`edgeId` null/stale)
- [ ] `migration apply` rejects draft (unattested) packages

## Detection and scaffolding

- [ ] `migration plan` scaffolds a `data-migration.ts` when it detects a NOT NULL column added without a default
- [ ] `migration plan` scaffolds when it detects a non-widening type change
- [ ] `migration plan` scaffolds when it detects a nullable → NOT NULL change
- [ ] Scaffolded file includes a comment describing the detected change
- [ ] An unimplemented scaffold prevents attestation — `migration verify` fails or keeps the package in draft state

## Execution

- [ ] With a data migration present, structural ops execute in order: additive/widening → data migration → destructive
- [ ] `inline` mode: data migration runs in the same transaction as structural ops; failure rolls back everything
- [ ] `isolated` mode: phase 1 commits, data migration runs in own transaction, phase 3 runs in own transaction
- [ ] `unmanaged` mode: data migration runs without transaction wrapping
- [ ] On retry after partial failure in `isolated`/`unmanaged` modes, phase 1 ops are skipped via existing idempotency checks
- [ ] On retry, the serialized check query is executed — if it indicates "already applied", the run step is skipped

## Graph integration

- [ ] Data migration name is recorded in ledger on successful edge completion
- [ ] Router selects path satisfying required invariants from environment ref
- [ ] When no invariants are required, router prefers path with more data migrations over path with fewer
- [ ] Environment ref can declare required data migration names alongside target contract hash

## Rollback

- [ ] A migration S2→S1 with a data migration works identically to S1→S2 — no special rollback machinery

# Non-goals

- **Multiple data migrations per edge**: Requires a dependency model between operations. Future work.
- **Pure data migrations (A→A)**: Data-only transformations with no schema change. The model extends naturally to self-edges later, but ADR 039 currently rejects self-loops.
- **Smart scaffolding / recipe templates**: Pre-filled queries for common patterns (backfill, type conversion, extraction). Future DX layer.
- **Arbitrary code execution**: Scenarios requiring application-level libraries (e.g., bcrypt hashing, S16) or external data sources (e.g., audit trail from external API, S17) cannot be expressed in this model. They must be handled outside the migration system.
- **Raw SQL escape hatch (`readSql`, `sql` tagged templates)**: Descoped for v1. The query builder is the sole authoring surface. However, the AST model naturally supports a future `raw_sql` node type — an opaque SQL string stored in the JSON AST, passed through verbatim by the target adapter. This would enable `readSql` (read `.sql` file → `raw_sql` AST node) and raw SQL expressions within the query builder. The `raw_sql` node is inherently target-specific (Postgres adapter executes it, MongoDB adapter would reject it), which is an acceptable tradeoff for an escape hatch. Not implementing in v1 to keep the authoring surface focused on the query builder and validate its expressiveness first.
- **Runtime no-op detection**: Mock-style verification that migration queries actually modified data. Future safety layer.
- **Operator algebra**: Composable migration operators with commutativity analysis. Useful design thinking but the invariant model handles correctness without it.
- **Content hash drift detection**: Warn when data migration source has been modified since it was applied to another environment. Descoped because: (1) the `data-migration.ts` is not part of `edgeId` — only the serialized ASTs are; (2) the serialized ASTs in ops.json already have integrity via `edgeId`; (3) cross-environment comparison requires shared state that doesn't exist. Revisit when we have a clearer picture of multi-environment workflows.
- **Question-tree UX**: Interactive workflow where the system asks the user targeted questions about ambiguous diffs and compiles answers into migration queries. Future authoring layer.

# Open Questions

1. **Op partitioning edge cases**: The additive/widening → data → destructive split assumes operation classes cleanly separate into "before" and "after" groups. Even for structural ops this isn't always true (e.g., compound type+default changes require drop → alter → set sequences). Constraint additions (UNIQUE, CHECK, FK) are classified as `additive` but are semantically tightening — they should run *after* the data migration (S13). This is a known limitation of the class-based partition. The proper fix is an operation dependency model (`dependsOn` + topological sort) where constraint ops depend on the data migration.

2. **Environment ref format**: Refs currently live in `migrations/refs.json` as `{ "<name>": "<hash>" }` (implemented in TML-2051). To carry invariants, the format needs to expand to something like `{ "<name>": { "hash": "<hash>", "invariants": ["split-user-name"] } }`. This is a breaking change to the ref format. Prerequisite: refactor refs to the new shape, potentially moving them to their own file. TML-2132 (implicit default ref) is a related open ticket. The ref refactor should land before or alongside data migration support.

3. **Cross-table coordinated migrations (S11)**: Scenarios like PK type changes (e.g., `SERIAL` → `UUID`) cascade across the FK graph — every referencing table needs a temp column, UUID generation, FK rewiring, and cleanup. The planner would need to trace FK references across tables and emit coordinated temp column + rename ops for all affected tables. This is significant planner intelligence beyond per-table detection. For v1, the user likely authors these migrations manually. Future work: planner FK graph awareness to auto-detect and scaffold cross-table cascading type changes.

4. **Table drop detection gap (S6)**: Horizontal table splits (one table → two with rows partitioned) may not trigger auto-detection if the new tables don't have NOT NULL columns without defaults. The planner could add a heuristic: "table dropped while new tables with similar schemas are created" → suggest data migration. Low priority for v1 but a known detection gap.

5. **Query builder expressiveness for data migrations**: The ORM/query builder needs to support UPDATE, INSERT ... SELECT, DELETE, subqueries with joins, and target-specific functions (e.g., `split_part`, `gen_random_uuid`). The current expressiveness of the query builder for DML operations needs validation against the scenario list. If gaps exist, the query builder needs extending — there is no raw SQL fallback in v1.


# Other Considerations

## Security

- No TypeScript is executed at apply time. Only serialized JSON ASTs (rendered to SQL by the target adapter) are executed.
- Data migration SQL runs with the same database permissions as the migration runner. No privilege escalation.
- The `data-migration.ts` source is evaluated only at verification time on the author's machine. It is not loaded by `migration apply` or shipped to SaaS.

## Observability

- The runner logs data migration start/completion/failure with the migration name and transaction mode.
- The ledger records which named data migrations have been applied to which database instance.

# References

- [data-migrations.md](./data-migrations.md) — Theory: invariants, guarded transitions, desired state model
- [data-migrations-solutions.md](./data-migrations-solutions.md) — Solution exploration: compatibility, routing, integration models
- [data-migration-scenarios.md](./data-migration-scenarios.md) — 18 schema evolution scenarios walked through against the design
- [april-milestone.md](./april-milestone.md) — VP1: prove data migrations work in the graph model
- [chat.md](./chat.md) — Design exploration: operator algebra, scenario enumeration, question-tree UX
- Planner implementation: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
- Runner implementation: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`
- Operation types: `packages/1-framework/1-core/migration/control-plane/src/migrations.ts`
- ADR 037 — Transaction semantics and compensation
- ADR 038 — Operation idempotency classes
- ADR 039 — Graph integrity and validation
- ADR 044 — Pre/post check vocabulary
- ADR 169 — Offline planning and containerization
