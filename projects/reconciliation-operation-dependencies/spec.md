# Summary

Add dependency ordering between reconciliation operations so the planner produces plans that execute in a valid order against Postgres, rather than relying on alphabetical issue-kind sorting.

# Description

## Problem

The reconciliation planner (`planner-reconciliation.ts`) builds operations from schema issues and sorts them alphabetically by issue kind via `sortSchemaIssues`. This happens to produce a valid execution order for many scenarios, but fails for others — specifically cases where Postgres enforces dependencies between database objects.

### Known failures

Three compound-scenario integration tests exposed ordering and coverage bugs:

**1. Drop unique constraint referenced by a FK (runner execution failure)**

When the contract removes a unique constraint from a parent table while a child table's FK still references those columns, the planner emits a DROP CONSTRAINT. Postgres refuses with error `2BP01`: *cannot drop constraint parent_code_key because other objects depend on it*. The planner has no awareness that the FK depends on the unique index.

**2. Stale default not detected (silent data issue)**

When a column goes from `NOT NULL DEFAULT 'active'` to `NULL` (no default), the verifier detects the nullability change but has no `extra_default` issue kind. The default silently remains in the database. This is a verifier gap, not an ordering issue, but was discovered alongside the ordering bugs. It is tracked separately in `projects/reconciliation-testing/issue-triage.md`.

**3. Primary key mismatch produces conflict instead of operations (planner gap)**

When the contract changes which columns form the PK, the planner returns a conflict (`indexIncompatible`) because `primary_key_mismatch` has no operation builder. This is a known gap documented in the code. Also tracked separately.

Problems 2 and 3 are separate work items tracked in `projects/reconciliation-testing/issue-triage.md`.

### Deeper analysis of problem 1: not an ordering issue

On closer examination, this is **not an operation ordering problem**. The FK isn't being dropped — it's staying in the contract. There's no FK-drop operation to reorder before the unique-drop. The real issue is:

**The verifier incorrectly reports the unique constraint as "extra."** The contract has a FK from `child(parent_code)` → `parent(code)`. In Postgres, that FK *requires* a unique constraint (or PK) on `parent(code)`. The unique is implicitly required by the FK — it's not extra.

The fix belongs in the verifier's extra-unique detection: when checking for extra uniques in strict mode, also check whether any FK in the contract (across all tables) references those columns on that table. If so, the unique is implicitly required and should not be reported as `extra_unique_constraint`. The same principle applies to PKs referenced by FKs.

This spec still covers dependency ordering as a separate concern — the alphabetical sort is fragile and should be replaced with explicit dependencies. But the immediate failing test is a verifier bug, not an ordering bug.

### Why alphabetical sorting is insufficient

The current sort orders operations by `issue.kind` alphabetically, then by table/column/constraint name. This works when:
- `extra_column` < `extra_index` (column drop before index drop — PG cascades, idempotency probe handles it)
- `extra_foreign_key` < `extra_table` (FK drop before table drop — correct order by coincidence)
- `default_missing` < `nullability_mismatch` (set default before set NOT NULL — correct order by coincidence)

But it is fragile:
- The correct ordering is accidental, not intentional
- Future issue kinds may not sort into a valid order
- If the sort order changes (e.g., new issue kinds inserted), existing correct orderings may break silently

### Exhaustive dependency analysis

The reconciliation planner can emit the following operations:

**Column-level** (same table, same column): `alterType`, `setDefault`, `alterDefault`, `dropDefault`, `setNotNull`, `dropNotNull`
**Object-level drops**: `dropTable`, `dropColumn`, `dropIndex`, `dropConstraint` (FK, unique, PK)

Every meaningful pair was checked. The following are the **only** pairs that require ordering:

#### Same-column dependencies

| Pair | Dependency | Notes |
|---|---|---|
| `alterType` + `setDefault`/`alterDefault` | **Compound: drop→type→set** (see below) | Neither order is universally safe |
| `dropDefault` + `alterType` | `dropDefault` before `alterType` | Old default may be incompatible with new type |
| `setDefault` + `setNotNull` | `setDefault` before `setNotNull` | Default should exist before tightening nullability |

#### Cross-object dependencies

| Pair | Dependency | Notes |
|---|---|---|
| `dropConstraint`(FK) + `dropTable`(referenced table) | FK drop first | PG error 2BP01 otherwise |
| `dropConstraint`(FK) + `dropConstraint`(unique/PK it references) | FK drop first | FK requires the unique/PK to exist |

#### Pairs with NO dependency

| Pair | Why |
|---|---|
| `alterType` + `setNotNull`/`dropNotNull` | Independent in PG |
| `dropDefault` + `dropNotNull` | Independent in PG |
| `dropIndex` + `dropColumn` | PG cascades automatically |
| `dropConstraint` + `dropColumn` (same table) | PG cascades |
| Any two operations on different columns | Independent |

### The type+default compound problem

The `alterType` + `setDefault`/`alterDefault` pair is unique because the dependency direction is **not fixed** — it depends on which direction the types are changing:

**Direction 1:** `int4 DEFAULT 1` → `text DEFAULT 'active'`
- `SET DEFAULT 'active'` first → **fails** (can't cast `'active'` to int4)
- `ALTER TYPE text` first → succeeds (old default `1` casts to text), then `SET DEFAULT 'active'` succeeds

**Direction 2:** `text DEFAULT 'active'` → `int4 DEFAULT 1`
- `ALTER TYPE int4` first → **fails** (PG checks existing default `'active'`, can't cast to int4)
- `SET DEFAULT 1` first → succeeds (implicit cast), then `ALTER TYPE int4` succeeds

No single ordering works for both directions. The only universally safe sequence is **3 steps**:

1. `DROP DEFAULT` (remove old default)
2. `ALTER TYPE` (change column type — no default to conflict)
3. `SET DEFAULT` (set new default — column is already the new type)

This means: when the planner detects both `type_mismatch` and `default_mismatch` (or `default_missing`) for the same column, it must emit **3 operations** instead of 2 — injecting an explicit `dropDefault` before the `alterType`, and the original `setDefault`/`alterDefault` after it.

### Concrete scenarios

Each scenario describes a reconciliation plan with multiple operations and whether it currently passes or fails. Scenarios marked **FAILS** are the motivation for this work; scenarios marked **passes (by coincidence)** work only because the alphabetical sort happens to produce the right order.

All tests are in `packages/3-targets/3-targets/postgres/test/migrations/planner.reconciliation.integration.test.ts` on the `fix/planner-known-failures` branch.

#### S1. Change type and default — new default incompatible with old type (FAILS)

`int4 DEFAULT 1` → `text DEFAULT 'active'`. Issues: `default_mismatch`, `type_mismatch`. Alphabetical sort runs `SET DEFAULT 'active'` on the old `int4` column — PG rejects it.

With the compound 3-step approach (drop old default → alter type → set new default), this works regardless of direction.

**Test:** `planner.reconciliation.integration.test.ts` — "changes column type and default when new default is incompatible with old type"

#### S2. Change type and default — old default incompatible with new type (passes by coincidence, fragile)

`text DEFAULT 'active'` → `int4 DEFAULT 1`. Same issues as S1. Alphabetical sort runs `SET DEFAULT 1` first — succeeds via implicit cast on the text column. Then `ALTER TYPE int4` succeeds because the default is now `1` which casts to int4.

This works **only because** the implicit cast happens to succeed. If the default were a value that can't be implicitly cast (e.g., a JSON string), it would fail. The compound 3-step approach handles this safely.

**Test:** `planner.reconciliation.integration.test.ts` — "changes column type and default together"

#### S8. Change type and default — both defaults compatible with both types (passes by coincidence)

`int4 DEFAULT 0` → `int8 DEFAULT 0`. Both defaults cast both ways. Either order works, but the compound 3-step approach is still safest.

No dedicated test yet — covered implicitly by the working S2 test.

#### S3. Tighten nullability and add default (passes by coincidence)

`text NULL` → `text NOT NULL DEFAULT 'unknown'`. Issues: `default_missing`, `nullability_mismatch`. Alphabetically `default_missing` < `nullability_mismatch` — correct order.

**Test:** `planner.reconciliation.integration.test.ts` — "tightens nullability and adds a default together"

#### S4. Drop FK and parent table (passes by coincidence)

Remove FK from child, remove parent table. Issues: `extra_foreign_key`, `extra_table`. Alphabetically `extra_foreign_key` < `extra_table` — correct order.

**Test:** `planner.reconciliation.integration.test.ts` — "drops a foreign key and its parent table"

#### S5. Widen nullability and drop default (passes by coincidence)

`text NOT NULL DEFAULT 'active'` → `text NULL` (no default). Issues: `extra_default`, `nullability_mismatch`. Alphabetically `extra_default` < `nullability_mismatch` — `DROP DEFAULT` before `DROP NOT NULL`. Both orders are valid in PG, so no dependency needed.

**Test:** `planner.reconciliation.integration.test.ts` — "widens nullability and drops default from a NOT NULL DEFAULT column"

#### S6. Drop unique constraint referenced by FK (FAILS — verifier bug)

Remove unique on `parent(code)` while child FK still references it. The verifier reports the unique as `extra_unique_constraint`, but the unique is implicitly required by the FK. PG error `2BP01`.

This is a **verifier bug** (the unique isn't extra), not a dependency ordering issue. But the fix belongs in the same project because it requires relational context (checking whether FKs reference the unique).

**Test:** `planner.reconciliation.integration.test.ts` — "drops unique constraint while FK still references the column"

#### S7. Replace primary key (FAILS — planner gap)

Change PK from `(id)` to `(uuid)`. The planner returns a conflict (`indexIncompatible`) because `primary_key_mismatch` has no operation builder. Not an ordering issue — separate gap.

**Test:** `planner.reconciliation.integration.test.ts` — "replaces primary key (drop old PK + add new PK on different column)"

## Proposed solution

### Prerequisite: fix compound type+default operation emission

The type+default ordering problem (see "The type+default compound problem" above) is not solvable by reordering alone — the dependency direction is bidirectional. This is a **planner bug** that must be fixed independently: when `type_mismatch` and a default issue (`default_mismatch` or `default_missing`) co-occur for the same column, the planner should emit **3 operations**:

1. `dropDefault.{table}.{column}` — remove old default (so ALTER TYPE doesn't conflict)
2. `alterType.{table}.{column}` — change column type (no default to interfere)
3. `setDefault.{table}.{column}` — set new default (column is already the target type)

When `type_mismatch` + `extra_default` co-occur (type changes and default is removed), only 2 operations are needed: `dropDefault` before `alterType`. This is a subset of the compound case.

This fix is orthogonal to dependency ordering — it corrects the planner's operation emission so that the operations it produces are individually valid. Even after this fix, the remaining dependency patterns still need explicit ordering.

### Operation dependency ordering via `dependsOn`

#### Data model change

```typescript
export interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  // ... existing fields ...
  readonly dependsOn?: readonly string[];  // operation IDs that must complete before this one
}
```

This is a minimal, additive change. The field is optional, so all existing operations and consumers are unaffected. The runner doesn't need to change — it already executes operations in array order. The planner just needs to topologically sort the array before returning it.

#### Dependency rules

The second pass matches operations using the structured `target.details` metadata (`{ schema, objectType, name, table? }`) — no ID string parsing required.

| Rule | Match condition | `dependsOn` |
|---|---|---|
| Default before NOT NULL | `setDefault` + `setNotNull` on same `{table, column}` | `setNotNull` depends on `setDefault` |
| FK before table drop | `dropConstraint`(FK) + `dropTable` where FK references that table | `dropTable` depends on `dropConstraint` |
| FK before unique/PK drop | `dropConstraint`(FK) + `dropConstraint`(unique/PK) where FK depends on it | unique/PK drop depends on FK drop |

The type+default ordering is handled by the prerequisite planner fix (compound operation emission) and does not use `dependsOn`.

#### Dependency resolution (second pass)

After building all operations, `buildReconciliationPlan` runs a `resolveDependencies(operations, contract)` pass that:

1. Iterates operations and matches pairs using `target.details` metadata
2. For cross-table dependencies (FK→table, FK→unique), uses the **contract** to discover which FKs reference which tables/columns
3. For same-column dependencies (default→nullability), matches by table+column from structured metadata
4. Populates `dependsOn` with the IDs of prerequisite operations
5. Topologically sorts the operations array

### Why the contract is the right lookup source

The second pass needs relational context (e.g., "which FKs reference table X?"). Three sources were considered:

1. **Operation target details** (`PostgresPlanTargetDetails`): Has `schema`, `objectType`, `name`, `table?`. Tells you what the operation *modifies* but not what it *relates to*. A FK-drop operation doesn't carry which table it references. Enriching this would require a data model change that ripples across the codebase.

2. **Contract**: Has the full relational structure — FK references, unique constraint columns, etc. Already available in `buildReconciliationPlan`. The contract represents the *destination* state, so it has the FKs that are staying (which is exactly what you need to know — "is there a FK that depends on this unique I'm about to drop?").

3. **Schema IR** (introspected state): Has the same info but represents the *current* database state. Not currently passed to `buildReconciliationPlan`.

The contract is the right choice: it's already available, it has the relational structure, and it represents the state we're migrating *toward* — so FKs in the contract are FKs that will exist after migration, which are exactly the ones that constrain what we can drop.

### Topological sort

After populating `dependsOn`, a standard topological sort produces the execution order. If a cycle is detected (shouldn't happen in practice — DDL dependencies are acyclic), it should be reported as a conflict rather than silently failing.

## Alternatives considered

### A. Implicit ordering via operation class priority
Assign priority tiers (e.g., "drop FKs" before "drop tables" before "drop columns"). Simple but brittle — doesn't handle cases like "this specific unique can't be dropped because a specific FK depends on it."

### B. Enrich `PostgresPlanTargetDetails` with relational context
Add fields like `referencedTable` to FK operations so the second pass can work from operations alone without consulting the contract. Clean in theory but changes the target-specific data model, ripples across serialization/display/runner code, and duplicates information already in the contract.

### C. Runner-level dependency resolution
Move dependency resolution into the runner instead of the planner. The runner would inspect operations and reorder them. Rejected because: the planner owns plan semantics; the runner should be a dumb executor; the plan should be valid *before* reaching the runner.

### D. No explicit dependencies — use CASCADE
Emit `DROP ... CASCADE` instead of `DROP`. Rejected because it silently drops objects that may not be in the plan, violating the principle that the plan explicitly describes all changes.

# Requirements

## Functional Requirements

1. **Compound expansion:** When `type_mismatch` and `default_mismatch`/`default_missing` co-occur for the same column, emit 3 operations: `dropDefault` → `alterType` → `setDefault`
2. **`dependsOn` field:** Add an optional `dependsOn` field to `SqlMigrationPlanOperation` containing operation IDs that must complete before the operation runs
3. **Dependency resolution pass:** Implement a second pass in `buildReconciliationPlan` that populates `dependsOn` using structured `target.details` metadata (not ID parsing)
4. **Topological sort:** Sort operations by `dependsOn` before returning the plan
5. Handle the following `dependsOn` patterns:
   - `dropTable` depends on `dropConstraint` for FKs referencing the table
   - `dropConstraint` (unique/PK) depends on `dropConstraint` for FKs depending on the constraint
   - `setNotNull` depends on `setDefault` on the same column (if both exist)
6. Report cycles as conflicts rather than producing an invalid plan
7. Fix verifier to not report unique constraints as "extra" when a FK in the contract implicitly requires them

## Non-Functional Requirements

1. The runner must not change — it continues to execute operations in array order
2. The `dependsOn` field must be optional to maintain backward compatibility
3. The dependency resolution must use the contract (already available) for relational context, not require new data plumbed through

## Non-goals

- Adding new issue kinds (`extra_default`, `primary_key_mismatch` operation builder) — these are separate work items
- Runner-level dependency resolution or reordering
- CASCADE support
- Cross-plan dependencies (dependencies between migration steps, not operations within a step)

# Acceptance Criteria

## Prerequisite planner fix (compound type+default)

- [ ] When `type_mismatch` + `default_mismatch`/`default_missing` co-occur for the same column, the planner emits 3 operations: `dropDefault` → `alterType` → `setDefault`
- [ ] When `type_mismatch` + `extra_default` co-occur, the planner emits `dropDefault` before `alterType`

## Data model

- [ ] `SqlMigrationPlanOperation` has an optional `dependsOn?: readonly string[]` field
- [ ] The runner is not modified — it continues to execute operations in array order

## Dependency resolution

- [ ] A second pass in `buildReconciliationPlan` populates `dependsOn` using `target.details` metadata and topologically sorts operations
- [ ] `dropTable` depends on `dropConstraint` for FKs referencing the table
- [ ] `dropConstraint` (unique/PK) depends on `dropConstraint` for FKs depending on it
- [ ] `setNotNull` depends on `setDefault` on the same column
- [ ] A cycle in `dependsOn` produces a conflict, not an invalid plan

## Scenario tests

All scenarios from the "Concrete scenarios" section must pass as integration tests:

- [ ] **S1** "changes column type and default when new default is incompatible with old type" — currently FAILS, must pass
- [ ] **S2** "changes column type and default together" — currently passes, must not regress
- [ ] **S3** "tightens nullability and adds a default together" — currently passes, must not regress
- [ ] **S4** "drops a foreign key and its parent table" — currently passes, must not regress
- [ ] **S5** "widens nullability and drops default from a NOT NULL DEFAULT column" — currently passes, must not regress
- [ ] **S6** "drops unique constraint while FK still references the column" — currently FAILS (verifier bug), must pass
- [ ] **S7** "replaces primary key" — currently FAILS (planner gap), separate work item (not blocked by this project)
- [ ] **S8** type+default with compatible types — must not regress

## Verifier fix

- [ ] Verifier does not report `extra_unique_constraint` when a FK in the contract references those columns (the unique is implicitly required)

## Regressions

- [ ] All existing tests continue to pass

# References

- `projects/reconciliation-testing/issue-triage.md` — bug reports from compound integration tests
- `projects/reconciliation-testing/plans/compound-reconciliation-scenarios.plan.md` — test plan that exposed the bugs
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts` — reconciliation planner
- `packages/2-sql/3-tooling/family/src/core/migrations/types.ts` — `SqlMigrationPlanOperation` type
- `packages/1-framework/1-core/migration/control-plane/src/migrations.ts` — `MigrationPlanOperation` base type

# Future direction: operation touch model

The `dependsOn` approach solves the immediate ordering problem, but a richer model would also enable **commutative migration detection** — determining whether two independently-authored migrations can be applied in either order.

The idea: each operation declares what database objects it **reads**, **writes**, **creates**, or **drops**, at property-level granularity (e.g., `column:user.status/type`, `column:user.status/default`). Ordering rules, commutativity, and cycle detection all derive from standard read/write conflict analysis:

- write/write on same object → non-commutative
- read/write on same object → non-commutative (ordering matters)
- read/read → always commutative
- create before read, read before drop

This subsumes `dependsOn` — instead of explicitly wiring up dependencies, the planner would declare what each operation touches, and the ordering would be computed. Cycles in the graph indicate operations that need decomposition (e.g., the type+default compound case, where `alterType` reads `default` and `setDefault` reads `type`).

Not in scope for this project, but the `dependsOn` model should be designed so it doesn't preclude this direction.

# Open Questions

1. Should `dependsOn` live on `SqlMigrationPlanOperation` (SQL-family level) or `MigrationPlanOperation` (framework level)? Dependency ordering may be useful for non-SQL families too, but we don't have evidence yet. Starting at the SQL level is safer — it can be promoted later.
2. Should the topological sort be stable (preserve existing alphabetical order for operations with no dependencies)? Stability makes test assertions easier and produces more predictable plans.
3. Should the same implicit-requirement logic apply to PKs? A FK can reference a PK instead of a unique — if the contract has a FK referencing a table and the PK covers those columns, the PK is implicitly required and should not be reported as `extra_primary_key`.
