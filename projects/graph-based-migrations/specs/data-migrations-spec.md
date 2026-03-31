# Summary

Data migrations are user-authored TypeScript functions that transform data during structural schema migrations. They execute mid-edge in the migration graph — after additive/widening ops create the new schema surface, before destructive ops tighten constraints and drop old columns. The system tracks data migrations as named invariants on graph edges, enabling invariant-aware routing without requiring algebraic reasoning about code semantics.

# Description

Prisma Next's graph-based migration system models schema evolution as a directed graph of contract-hash states connected by structural migration edges. This works well when migrations are purely structural (path-independent), but breaks down when data transformations are involved — two databases at the same contract hash can have meaningfully different data depending on which path was taken.

Data migrations solve this by allowing users to attach executable code to graph edges. The system doesn't reason about what the code does; it tracks that named migrations were applied, and routes through paths that satisfy required invariants. This preserves the graph model's flexibility for structural routing while adding data-awareness without collapsing to linear history.

The primary user is a backend developer who knows SQL but doesn't think about migration theory. They want to describe what should happen and have the system handle safety. The system should detect when data migrations are needed, scaffold the file, and let the user fill in the logic.

# Requirements

These are the problems the system must solve. The Solution section describes how each is addressed.

## R1. Users can transform data during schema migration

Schema evolution often requires data transformations that the database cannot perform automatically: backfilling computed values, converting between types with ambiguous mappings, splitting/merging columns or tables, resolving constraint violations, seeding reference data. The system must provide a way for users to run arbitrary data transformation code as part of a migration. See [data-migration-scenarios.md](./data-migration-scenarios.md) for the full scenario enumeration.

## R2. Data migrations cover a wide range of schema evolution scenarios

The system must handle the common patterns — computed backfill, lossy type changes, column split/merge, table split/merge, normalization/extraction, key identity changes, constraint enforcement, data seeding — and provide a universal escape hatch for anything else. No scenario should be impossible; the system should make common ones easy and rare ones possible.

## R3. Data migrations are safe to retry after partial failure

If a migration fails midway (crash, timeout, constraint violation), re-running it must not corrupt data or produce duplicate effects. The system needs a mechanism to determine whether a data migration has already been applied, and skip it if so.

## R4. Users don't accidentally skip required data transformations

When the planner detects a structural change that implies data migration is needed (e.g., adding a NOT NULL column without a default), it must ensure the user addresses it before the migration can be applied. The scaffolded migration must fail loudly at apply time if the user hasn't filled in the implementation. The system should make it impossible to accidentally apply a migration that needs data work without having done that work.

## R5. Data migration code has access to both old and new schema state

During a data migration, the user's code needs to read from old columns/tables (to get existing data) and write to new columns/tables (to populate transformed data). The old schema must not yet be torn down, and the new schema must already be partially set up.

## R6. Data migrations work on tables of all sizes

Small tables can be migrated within a single transaction for atomicity. Large tables may require batched updates outside of a transaction, or DDL that can't run in a transaction (e.g., `CREATE INDEX CONCURRENTLY`). The execution model must accommodate both extremes.

## R7. Data migrations participate in the graph model

The migration graph must be aware of data migrations. When multiple paths exist to the same contract hash, the system must be able to distinguish paths based on what data transformations they include, and select appropriately.

## R8. Environments can declare which data migrations are required

Different environments (production, staging, dev) may need different data migration guarantees. The system must allow environments to declare which named data migrations must have been applied, and route accordingly.

## R9. Users can write arbitrary SQL when the planner is insufficient

The planner generates structural DDL but cannot handle every case. Users need an escape hatch to write raw SQL (structural or data) that the system executes as a first-class migration. This should not require a separate authoring surface — it should integrate naturally with the data migration mechanism.

## R10. SQL-first users don't need to write TypeScript

Some users prefer writing plain SQL files over TypeScript. The system should support this without requiring them to learn the TypeScript API beyond a minimal wrapper.

## R11. Planning works offline (no database connection required)

Per ADR 169, migration planning must not require a live database connection. Detection of data migration needs and scaffolding must work from contract diffs alone.

## R12. Post-apply verification catches schema mismatches

After a migration (including any data migration) completes, the system must verify that the database schema matches the destination contract. This is the hard safety net — if the user's SQL didn't produce the expected schema state, apply fails.

## R13. No special rollback mechanism

Reverting a migration is just another migration in the opposite direction. The system should not introduce rollback-specific machinery for data migrations. A migration S2→S1 is an ordinary graph edge that can carry its own data migration.

# Solution

## Data migration authoring (R1, R2, R9, R10)

A data migration is defined in a `data-migration.ts` file inside a migration package directory (alongside `ops.json`), using a `defineMigration({ name, transaction, check(db), run(db) })` API.

The `db` parameter provides a minimal raw SQL interface: `db.execute(sql, params?)` (returns rows affected) and `db.query(sql, params?)` (returns rows). Parameterized queries only. This handles 100% of scenarios — any SQL the database supports can be executed.

`data-migration.ts` is compiled at apply time using the project's existing TypeScript execution tooling (tsx/esbuild). Source `.ts` files are committed; compiled JS is not.

Each migration edge supports at most one data migration (single `data-migration.ts` per package).

### Representation in ops.json

A data migration is a first-class operation in `ops.json` — a `data_migration` entry alongside the structural operations. The planner (or `migration new`) inserts it at the correct position between additive/widening and destructive ops. The runner encounters it during sequential execution, resolves and compiles the `data-migration.ts` file, and executes `check`/`run`. This means the data migration participates in the same operation lifecycle as structural ops (prechecks, execution, postchecks) without requiring a separate execution path in the runner.

```typescript
import { defineMigration } from '@prisma-next/migration'

export default defineMigration({
  name: 'split-user-name',
  transaction: 'inline',

  async check(db) {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM "users" WHERE "first_name" IS NULL`
    )
    return result[0].count === 0
  },

  async run(db) {
    await db.execute(
      `UPDATE "users"
       SET "first_name" = split_part("name", $1, 1),
           "last_name"  = split_part("name", $1, 2)
       WHERE "first_name" IS NULL`,
      [' ']
    )
  }
})
```

### SQL-first alternative — `readSql` (R10)

A `readSql(filename)` helper reads a `.sql` file relative to the migration package directory and returns a function compatible with `check` or `run`. This allows SQL-first users to write plain SQL files while using `data-migration.ts` only as a thin wrapper:

```typescript
import { defineMigration, readSql } from '@prisma-next/migration'
export default defineMigration({
  name: 'custom-migration',
  transaction: 'inline',
  check: readSql('check.sql'),
  run: readSql('migration.sql'),
})
```

### Manual authoring — `migration new` (R9)

`migration new` scaffolds a migration package with a `data-migration.ts` and empty (or no) `ops.json`. The user writes all SQL in the `run(db)` function or via `readSql`. This is the escape hatch for when the planner's structural output is wrong, insufficient, or the user needs full control.

`migration new` derives `from` hash from the current migration graph state (same logic as `migration plan`) and `to` hash from the current emitted contract. Both can be overridden with `--from` and `--to` flags.

No verification at authoring time — the system trusts the user's SQL. Post-apply schema verification (R12) catches mismatches at `migration apply` time.

## Retry safety — required `check(db)` (R3)

`check(db)` is **required**. It returns `true` if the data migration has already been applied (skip `run`), `false` if it still needs to run. The runner calls `check` before `run` on every execution, enabling idempotent retries without a separate completion marker. Users who don't need a meaningful check can `return true` (always skip — use with caution) or `return false` (always run).

## Detection and scaffolding (R4, R11)

The planner detects structural changes that imply a data migration is needed:

- NOT NULL column added without a default
- Non-widening type change (e.g., FLOAT → INTEGER)
- Existing nullable column becoming NOT NULL

Detection works offline (no database connection required). The planner scaffolds when the structural diff *could* need a data migration, even if affected tables might be empty at runtime.

When detection triggers, the planner generates a `data-migration.ts` with unimplemented `check` and `run` functions that fail at apply time if left unmodified, plus comments describing what was detected.

For non-widening type changes on the same column (e.g., `price FLOAT` → `price BIGINT`), the planner uses a **temp column strategy**: it emits an additive op to create a temporary column with the target type, places the data migration slot after it, and emits destructive ops to drop the original column and rename the temp column. This gives the user a writable column of the correct target type during the data migration. The temp column name is deterministic and referenced in the scaffold comment.

## Phased execution (R5, R6)

When a data migration is present on an edge, the planner emits a `data_migration` operation entry interleaved with structural ops. The planner partitions structural ops into phases by operation class:

1. **Phase 1**: all `additive` and `widening` ops (new tables, new nullable columns, relaxed constraints)
2. **Phase 2**: `data_migration` operation (references the user's `data-migration.ts`)
3. **Phase 3**: all `destructive` ops (SET NOT NULL, drop old columns, type changes)

This partitioning is implemented as a generic framework-level function over operation classes. Target planners produce structural ops as they do today; the framework inserts the data migration entry and orders the result. For v1, the ordering is a simple class-based partition. When a proper operation dependency model lands (with `dependsOn` and topological sort), the data migration operation should integrate with that.

### Transaction modes (R6)

The data migration declares one of three transaction modes:

| Mode | Behavior | Use case |
|------|----------|----------|
| `inline` | Runs inside the structural migration's transaction. Full atomicity — failure rolls back everything. | Small/fast migrations on small tables. Default. |
| `isolated` | Gets its own transaction. Phase 1 commits first, data migration runs in a separate transaction, phase 3 runs in a third transaction. | Medium tables where you want transactional safety for the data migration but can't hold structural locks open. |
| `unmanaged` | No transaction wrapping. User handles batching/commits. | Large tables, long-running transforms, DDL that can't run in a transaction. |

In `isolated` and `unmanaged` modes, phase 1 ops are skipped on retry via existing idempotency checks (postchecks pass because columns/tables already exist). The data migration step is skipped on retry if `check(db)` returns `true`.

## Graph integration (R7, R8)

The invariant carried by the system is "named data migration X was applied." This is recorded in the ledger when the migration edge completes successfully.

The router finds candidate paths via DFS, collecting data migration names along each path. Path selection:

1. Filter to paths that satisfy required invariants (from environment refs)
2. Prefer paths with more invariants (do the most complete migration)
3. Tie-break by shortest path / deterministic ordering

Environment refs declare desired state as target contract hash + required data migration names. A ref update is explicit and reviewable.

## Post-apply verification (R12)

The existing post-apply schema verification (introspect database, compare against destination contract) serves as the hard safety net for data migrations. No additional verification mechanism is needed — the runner already does this for structural migrations, and it naturally extends to cover data migrations.

## Rollback (R13)

No special rollback mechanism. Reverting state S1→S2 is a new migration S2→S1 — an ordinary graph edge that can carry its own data migration if needed.

# Key Decisions

These document the major design choices, the alternatives considered, and why we chose this approach. They are most useful after reading the Requirements and Solution sections.

## D1. Code-first over operator algebra

**Decision**: Data migrations are TypeScript functions, not algebraic representations (SMO-style typed operators with commutativity analysis).

**Alternatives considered**: The chat exploration designed a V2 operator algebra (`derive`, `derive_across`, `deduplicate`, `expand`, `filter`, `generate`) inspired by PRISM's Schema Modification Operators. This would enable automatic path equivalence reasoning and canonical form comparison.

**Why code-first**: The algebra can't express arbitrary transformations — the expression language inside operators like `derive` does "enormous work" (the chat's own observation). Any scenario the algebra can't handle falls through to an opaque escape hatch the system can't reason about. Code-first handles 100% of scenarios by definition. The algebra remains useful as design thinking (it identifies the right scenario categories) and could become a future optimization layer, but it's not the runtime representation.

**What we give up**: Automatic path equivalence reasoning. Two paths to the same hash can't be proven data-equivalent without running them. The invariant model ("named migration X was applied") handles correctness differently — it doesn't prove equivalence, it tracks what happened.

## D2. Name + hash over semantic postconditions; honest about what invariants are

**Decision**: The system tracks data migrations by **name** (identity, human-readable). The invariant is "named data migration X was applied." Content hash drift detection is deferred.

**What this actually is**: Functionally, this is the same as carrying around proof that specific migrations ran. For any path segment that has data migrations, the model degenerates to "you must take this specific path" — which is linear history for that segment. Data migrations are inherently path-dependent; we're not trying to make them path-independent. The graph's flexibility only helps for structural-only segments.

**Why name rather than hash**: The name is stable under code changes (fixing a bug in the migration doesn't change its identity), human-readable in CLI output and ref files, and serves as the primary key for invariant requirements.

**Alternative considered — semantic postconditions**: Carry checkable predicates about data state ("all phone numbers match E.164"). Problem: we can't exhaustively cover all possible postcondition checks with a typed representation. Any typed system eventually needs an escape hatch that's just code, at which point the postcondition is opaque anyway. The required `check(db)` function (D3) gives us user-authored postconditions for retry safety without pretending the system can reason about them.

## D3. Required `check(db)` postcondition

**Decision**: Every data migration must implement a `check(db)` function that returns `true` if the migration has already been applied.

**Alternatives considered**:
- Optional postconditions with a separate ledger completion marker for retry safety
- No postconditions, relying solely on user code idempotency

**Why required**: Solves three problems with one mechanism: (1) retry safety — runner calls `check()` before `run()`, skipping if already done, (2) no need for a mid-migration ledger write or separate completion marker, (3) forces the user to think about what "done" means. The escape hatch is trivial (`return true` to always skip, `return false` to always run) so it doesn't block users who don't care, but it nudges toward correctness.

## D4. Single-edge with interleaved ops over split into multiple edges

**Decision**: A data migration lives within a single graph edge. Structural ops are partitioned into phases (additive → data migration → destructive) within that edge.

**Alternatives considered**: Split the migration into two edges — Edge 1 (additive ops, creates intermediate contract state) → Edge 2 (destructive ops). The data migration runs between the two edges.

**Why single-edge**:
- The split model requires synthesizing an intermediate contract from partial ops — a function like `applyOp(contract, op) → contract` which does not exist in the system.
- The intermediate contract state is graph noise — an implementation artifact that leaks into the user's mental model. Nobody wants to target it with a ref or reason about it.
- The single-edge model preserves the option for `inline` transaction atomicity (one transaction wrapping everything), which the split model loses since each edge runs its own transaction.
- The single-edge model requires bounded runner changes (pause, run user code, continue) rather than a new contract synthesis capability.

## D5. Co-located with edges, not independent

**Decision**: Data migrations are attached to structural migration edges (Model A from the solutions doc). They are not independent artifacts that float in the graph.

**Alternatives considered**: Model B (independent data migrations applied when schema allows) — data migrations are separate from structural transitions, applied whenever their schema requirements are met.

**Why co-located**: A data migration almost always needs a specific schema to run against. It has a natural home on the edge that creates that schema. Co-location means the structural path determines which data migrations run — no separate routing layer needed. Model B would require its own compatibility checking, routing, and execution model.

## D6. Class-based op partition for v1, dependency model later

**Decision**: For v1, the planner partitions ops by operation class: additive/widening before the data migration, destructive after. A proper operation dependency model (`dependsOn` + topological sort) is future work.

**Alternatives considered**: Implement `dependsOn` from the start, with the data migration operation expressing explicit dependencies on structural ops.

**Why class-based for now**: Covers the common scenarios (S1–S5, S9, S10, S14, S17, S18). The known gap — constraint additions (UNIQUE, CHECK, FK) are classified as `additive` but are semantically tightening and should run after the data migration (S13) — is a real limitation but not a blocker for VP1. The dependency model is the proper fix and should be designed to subsume the class-based partition when it lands.

## D7. Temp column strategy for same-column type changes

**Decision**: When a column's type changes without a rename (e.g., `price FLOAT` → `price BIGINT`), the planner creates a temporary column of the target type, places the data migration after it, and emits destructive ops to drop the original and rename the temp.

**Alternatives considered**:
- Use `ALTER COLUMN TYPE ... USING` to let the database handle the conversion. Problem: this bypasses the data migration entirely — the user can't control the conversion logic.
- Write new-type values to the old-type column. Problem: the old column can't hold values of the new type.
- Change the type first, then transform. Problem: the type change may fail or lose data before the user's conversion runs.

**Why temp column**: It's the only approach that gives the user a writable column of the correct target type while the old data is still available to read from. The temp column name is deterministic and referenced in the scaffold comment. The user never sees it in the final schema.

**Future refinement — `USING` clause for common conversions**: Many type changes can be expressed as a single SQL expression in an `ALTER COLUMN TYPE ... USING` clause (e.g., `USING (price * 100)::bigint`, `USING created_at AT TIME ZONE 'America/New_York'`, `USING CASE status WHEN 1 THEN 'active' END`). When the conversion is a SQL expression, the `USING` approach is simpler — no temp column, no data migration file, just a single structural op. The planner could offer common conversion patterns (multiply, cast, round, timezone, enum lookup) and generate the `USING` clause directly, falling back to the temp column strategy only when the user needs imperative logic (loops, external libraries, cross-table lookups). This fits into the deferred "smart scaffolding / recipe templates" layer.

## D8. Planner detects, scaffolds with context, and prevents accidental no-ops

**Decision**: The planner auto-detects structural changes that imply a data migration is needed (NOT NULL without default, non-widening type change, nullable → NOT NULL) and scaffolds a `data-migration.ts` that: (a) provides the full `defineMigration` boilerplate so the user starts from a working structure, (b) includes comments describing what was detected and what the user needs to provide, and (c) ensures the user cannot accidentally forget to fill in the logic — the scaffold must fail at apply time if left unmodified.

The `throw` in the scaffold is one way to achieve (c), but the key property is that the runner rejects unimplemented data migrations, not the specific mechanism.

**Alternatives considered**:
- Warn only — planner flags the need, user creates the file manually. Problem: easy to miss the warning and proceed without a data migration.
- Block — planner refuses to create the migration package until user provides a data migration. Problem: blocks the plan workflow; user can't see the structural plan until they've written data migration code they don't yet understand.
- Smart scaffolding — pre-fill the `run` function with likely SQL based on the detected pattern. Future DX layer; minimal scaffolding proves the model first.

**Why this approach**: The system takes responsibility for detection and gives the user a starting point with enough context to understand what's needed. The safety property — unimplemented scaffolds fail loudly — prevents data loss from accidentally skipping a required transformation.

# Acceptance Criteria

## Authoring

- [ ] A `data-migration.ts` file using `defineMigration` is recognized by the runner when present in a migration package
- [ ] `check(db)` is required — `defineMigration` without `check` is a type error
- [ ] Runner calls `check(db)` before `run(db)` — if `check` returns `true`, `run` is skipped
- [ ] `db.execute(sql, params)` runs parameterized SQL and returns affected row count
- [ ] `db.query(sql, params)` runs parameterized SQL and returns result rows
- [ ] The `data-migration.ts` file is compiled from TypeScript at apply time without requiring a pre-build step

## Detection and scaffolding

- [ ] `migration plan` scaffolds a `data-migration.ts` when it detects a NOT NULL column added without a default
- [ ] `migration plan` scaffolds when it detects a non-widening type change
- [ ] `migration plan` scaffolds when it detects a nullable → NOT NULL change
- [ ] Scaffolded file includes a comment describing the detected change
- [ ] `migration apply` fails with a clear error when the scaffolded migration is still unimplemented

## Execution

- [ ] With a data migration present, structural ops execute in order: additive/widening → data migration → destructive
- [ ] `inline` mode: data migration runs in the same transaction as structural ops; failure rolls back everything
- [ ] `isolated` mode: phase 1 commits, data migration runs in own transaction, phase 3 runs in own transaction
- [ ] `unmanaged` mode: data migration runs without transaction wrapping
- [ ] On retry after partial failure in `isolated`/`unmanaged` modes, phase 1 ops are skipped via existing idempotency checks
- [ ] On retry, `check(db)` is called — if it returns `true`, the data migration `run` is skipped

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
- **Smart scaffolding / recipe templates**: Pre-filled SQL for common patterns (backfill, type conversion, extraction). Future DX layer.
- **Typed `db` interface**: Query interface typed to the intermediate schema state. Significant complexity for uncertain value.
- **Runtime no-op detection**: Mock-style verification that migration code actually executed meaningful work. Future safety layer.
- **Operator algebra**: Composable migration operators with commutativity analysis. Useful design thinking but the invariant model handles correctness without it.
- **Content hash drift detection**: Warn when data migration code has been modified since it was applied to another environment. Descoped because: (1) storing the hash in the migration manifest requires re-attestation every time the user edits the scaffolded file — the natural workflow is plan → scaffold → user edits → apply, but the manifest is sealed at plan time so the hash is immediately stale after the user fills in the scaffold; (2) storing in the ledger only enables per-database comparison, not cross-environment drift detection (you can't query staging's ledger from production); (3) a separate metadata file adds complexity for uncertain value. Revisit when we have a clearer picture of multi-environment workflows.
- **Question-tree UX**: Interactive workflow where the system asks the user targeted questions about ambiguous diffs and compiles answers into migration code. Future authoring layer.

# Open Questions

1. **Op partitioning edge cases**: The additive/widening → data → destructive split assumes operation classes cleanly separate into "before" and "after" groups. Even for structural ops this isn't always true (e.g., compound type+default changes require drop → alter → set sequences). Constraint additions (UNIQUE, CHECK, FK) are classified as `additive` but are semantically tightening — they should run *after* the data migration (S13). This is a known limitation of the class-based partition. The proper fix is an operation dependency model (`dependsOn` + topological sort) where constraint ops depend on the data migration.

2. **Environment ref format**: Refs currently live in `migrations/refs.json` as `{ "<name>": "<hash>" }` (implemented in TML-2051). To carry invariants, the format needs to expand to something like `{ "<name>": { "hash": "<hash>", "invariants": ["split-user-name"] } }`. This is a breaking change to the ref format. Prerequisite: refactor refs to the new shape, potentially moving them to their own file. TML-2132 (implicit default ref) is a related open ticket. The ref refactor should land before or alongside data migration support.

3. **Cross-table coordinated migrations (S11)**: Scenarios like PK type changes (e.g., `SERIAL` → `UUID`) cascade across the FK graph — every referencing table needs a temp column, UUID generation, FK rewiring, and cleanup. The planner would need to trace FK references across tables and emit coordinated temp column + rename ops for all affected tables. This is significant planner intelligence beyond per-table detection. For v1, the user likely authors these migrations manually. Future work: planner FK graph awareness to auto-detect and scaffold cross-table cascading type changes.

4. **Table drop detection gap (S6)**: Horizontal table splits (one table → two with rows partitioned) may not trigger auto-detection if the new tables don't have NOT NULL columns without defaults. The planner could add a heuristic: "table dropped while new tables with similar schemas are created" → suggest data migration. Low priority for v1 but a known detection gap.

# Other Considerations

## Security

- The `db` interface enforces parameterized queries. String interpolation for SQL construction is not exposed.
- Data migration code runs with the same database permissions as the migration runner. No privilege escalation.
- **Assumption:** Data migration files are trusted code committed to the repository, same as structural migration definitions. No sandboxing is applied.

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
