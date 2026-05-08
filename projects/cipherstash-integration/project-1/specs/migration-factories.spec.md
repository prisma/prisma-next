# Summary

Ship `cipherstash.addSearchConfig({ ... })` and `cipherstash.activatePendingSearches()` migration factories that users invoke from hand-authored `migration.ts` files to install per-column EQL search-mode configuration. Each factory returns **a single migration operation** — `addSearchConfig` returns one op per `(table, column)` whose `execute` payload contains one EQL `add_search_config(...)` statement per enabled mode flag; `activatePendingSearches` returns one op per migration. Both factories carry `invariantId`s for invariant-aware ref routing per [PR #404](https://github.com/prisma/prisma-next/pull/404). The factory builds each statement around a `RawSqlExpr` AST node (delivered by [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md)) via package-internal API — no dependency on the (separate, parallel) public `raw\`...\`` template-literal factory at [`sql-raw-factory`](../../sql-raw-factory/spec.md).

**The shape is deliberately planner-friendly.** The user (in Project 1) and the migration planner (in Project 2) emit one literal `addSearchConfig({ table, column, equality?, freeTextSearch? }, endContract)` line per model field with search modes declared. No loops, no per-mode unrolling, no wrapping at the call site — the factory hands back a complete operation ready to drop into the migration's `operations` array.

# Description

CipherStash's EQL extension stores per-column search configuration in a `cs_configuration_v2` table containing JSONB documents that enumerate which indexes are active for which `(table, column)` pairs. Each "mode" — `equality`, `freeTextSearch`, etc. — is added by calling the EQL function `eql_v2.add_search_config(table, column, index_name, cast_as)`. The first-attempt integration's `database-dependencies.ts` already shows the canonical SQL shape; this task spec lifts that pattern into Project 1's hand-authored-migration surface.

In Project 1, the user authors a migration file that explicitly issues these calls per encrypted column. In Project 2, the planner will emit them automatically based on contract diff, via `planTypeOperations`. The two ship in different projects because the *automatic* path requires framework prerequisites (per-column `(table, column)` input to `planTypeOperations`; prior-state contract supplied to `planTypeOperations` for destructive DDL) that haven't started; the *manual* path needs neither — the user supplies `(table, column)` directly as factory arguments.

The factory returns a single migration operation per call. Behavioral requirements:

1. **Multi-statement `execute` payload.** A single `addSearchConfig({ table, column, equality, freeTextSearch }, contract)` call covers both `equality: true` and `freeTextSearch: true` for a `(table, column)` pair via two EQL `add_search_config(...)` statements within one operation's `execute` array. Operations with multi-step `execute` payloads are the established shape (see `SqlMigrationPlanOperation`'s `execute: readonly SqlMigrationPlanOperationStep[]` at `packages/2-sql/9-family/src/core/migrations/types.ts`); this factory uses that capacity rather than emitting one op per statement. The motivation is planner-friendliness: emitting one literal line per `(table, column)` is what a contract-diff-driven planner can do without writing loops or control flow.

2. **Invariant-aware ref routing.** PR #404 routes downstream migration operations by `invariantId`. Search-config installs must be referenceable so future migrations can encode "after `cipherstash.search-config.user.email` …" dependencies. The op carries one `invariantId` per call (per `(table, column)`), not per mode flag — the granularity of the reference matches the granularity of "the search config for this column is in place".

3. **Conceptual fit.** The user is supplying *application-layer state* via SQL, not declaring a new schema object. The right bucket is "running SQL to mutate data state, with an opaque invariant key for cross-migration referencing." TML-2292 will eventually unify `SqlMigrationPlanOperation` and `DataTransformOperation` — at which point the operation-class question is moot. Until then, see § Open Questions for the implementation choice between (a) `DataTransformOperation` extended to support multi-statement plans, (b) `SqlMigrationPlanOperation` extended to participate in invariant routing, or (c) a new operation shape that combines both.

The construction path is:

```
factory call (one per (table, column))
  ↓
For each enabled mode flag:
  RawSqlExpr.of(fragments, [ParamRef.of(value, { codecId }), ...])  ← from raw-sql-ast-node task spec
  ↓
  planFromAst(ast, contract) → SqlQueryPlan                          ← from raw-sql-ast-node task spec
  ↓
  Adapter lowers plan → SqlMigrationPlanOperationStep { description, sql }
  ↓
Bundle steps into one operation:
  { invariantId, operationClass, target, execute: [step1, step2, ...] }
  ↓
Returned to user / planner as a single operation
```

The user never sees `RawSqlExpr` directly. The factory hides it behind `addSearchConfig({ ... })` / `activatePendingSearches()`. The number of statements in the resulting op's `execute` array equals the number of enabled mode flags.

# Requirements

## Functional Requirements

### `cipherstash.addSearchConfig({ ... })`

```ts
// packages/3-extensions/cipherstash/src/exports/migration.ts
import type { Contract, SqlStorage } from '@prisma-next/sql-relational-core';
import type { CipherstashMigrationOperation } from '../core/migration-operation';

export interface AddSearchConfigInput {
  readonly table: string;
  readonly column: string;
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
}

/**
 * Returns one migration operation for the given (table, column). The op's
 * `execute` payload contains one EQL `add_search_config(...)` statement per
 * enabled mode flag — both flags enabled produces a two-statement op, one
 * flag enabled produces a one-statement op. The user places the returned
 * value directly in the migration's `operations` array; no wrapping.
 *
 * `CipherstashMigrationOperation` is the concrete operation type — see
 * § Open Questions on the underlying op-shape choice.
 */
export function addSearchConfig(
  input: AddSearchConfigInput,
  contract: Contract<SqlStorage>,
): CipherstashMigrationOperation;
```

Behavior:

- Emits **one operation per `(table, column)` call**. So `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true }, endContract)` produces a single op whose `execute` array has two steps: one for `eql_v2.add_search_config('user', 'email', 'unique', 'text')`, one for `eql_v2.add_search_config('user', 'email', 'match', 'text')`. `addSearchConfig({ ..., equality: true }, endContract)` (one flag) produces a single op with one step.
- Maps user-facing mode flags to EQL internal index names (the same mapping the first-attempt's `database-dependencies.ts` defines):
  - `equality: true` → EQL index name `'unique'`, `cast_as: 'text'`.
  - `freeTextSearch: true` → EQL index name `'match'`, `cast_as: 'text'`.
- Each step's SQL renders an `eql_v2.add_search_config` function call constructed from a `RawSqlExpr` AST node. The four arguments flow as `ParamRef`s with codec id `'pg/text@1'` — they are parameterized, not text-inlined, which sidesteps any SQL-injection concern around the user-supplied `table` / `column` strings.
- The op's `invariantId` is deterministic from the input: `cipherstash.search-config.<table>.<column>` (one per call, *not* per mode flag). Stable across migration regenerations; readable in invariant-routing diagnostics.
- Calling `addSearchConfig({ table, column }, contract)` with **no flags enabled** is a programming error (the empty-flags op would have an empty `execute` array, which is meaningless). The factory throws synchronously on this input. Rationale: a planner-emitted call should always carry at least one flag because the planner only emits a call when the model field has at least one search mode declared.

### `cipherstash.activatePendingSearches()`

```ts
export function activatePendingSearches(
  contract: Contract<SqlStorage>,
): CipherstashMigrationOperation;
```

Behavior:

- Emits **one** op that calls EQL's pending-activation function (the first-attempt repo's `database-dependencies.ts` shows the canonical SQL — to be lifted; the spec defers to that file for the exact function name).
- `invariantId`: `cipherstash.search-config.activate-pending`.
- The op's `execute` array contains a single step whose SQL is built from a `RawSqlExpr` AST containing zero interpolated args — just the static SQL fragment. (`RawSqlExpr.of(['SELECT eql_v2.activate_pending_searches()'], [])` is valid by AC-AST3 / AC-LOW5 of the AST node spec.)

### Mapping table — public flag → EQL index

| Public flag | EQL `index_name` | EQL `cast_as` (for `EncryptedString`) |
|---|---|---|
| `equality: true` | `'unique'` | `'text'` |
| `freeTextSearch: true` | `'match'` | `'text'` |

This table is internal to the migration factory module. It will grow in Project 2 as additional column types and modes ship (`orderAndRange` → `'ore'`, `searchableJson` → `'ste_vec'`, etc.).

### User-side migration shape

```ts
// migration.ts
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import {
  addSearchConfig,
  activatePendingSearches,
} from '@prisma-next/extension-cipherstash/migration';
import endContract from './end-contract.json' with { type: 'json' };

export default class M_001_add_encrypted_email extends Migration {
  override describe() {
    return { from: 'sha256:...', to: 'sha256:...' };
  }

  override get operations() {
    return [
      addSearchConfig(
        { table: 'user', column: 'email', equality: true, freeTextSearch: true },
        endContract,
      ),
      addSearchConfig(
        { table: 'order', column: 'shippingAddress', equality: true },
        endContract,
      ),
      activatePendingSearches(endContract),
    ];
  }
}

MigrationCLI.run(import.meta.url, M_001_add_encrypted_email);
```

Each factory call produces exactly one operation, placed directly in the `operations` array. No `.map`, no spread, no `this.dataTransform(...)` wrapping at the call site — the factory hands back a complete operation object. DDL ops (`createTable`, `addColumn`, etc.) — when present — sit alongside the cipherstash ops in the same array.

This is the shape the Project 2 planner will emit: one literal `addSearchConfig({...}, endContract)` line per model field with search modes declared, plus one `activatePendingSearches(endContract)` per migration. The planner doesn't emit loops or per-mode unrolling.

### Subpath export

The factories are exported from a new subpath: `@prisma-next/extension-cipherstash/migration`. This keeps the migration-time imports separate from runtime imports (`@prisma-next/extension-cipherstash`), runtime descriptor imports (`/runtime`), control descriptor imports (`/control`), and column-type factory imports (`/column-types`).

### Why a per-`(table, column)` op with multi-statement `execute`, not per-mode-flag ops

An earlier draft of this spec emitted **one operation per mode flag** — `addSearchConfig({ equality: true, freeTextSearch: true }, ...)` would have produced two ops, each with one statement. That shape was rejected for two reasons:

1. **Planner-friendliness.** The Project 2 contract-diff-driven planner emits one literal factory call per model field that has search modes. Per-mode-flag ops would force the planner to spread/unroll calls based on flag combinations, or force the user (in Project 1) to write `for`/`map` loops over the factory output. Neither is the right shape for a generated artifact. One op per call keeps the migration source readable and the planner's emit logic flat.
2. **Invariant granularity.** A reference like "depends on the user.email search config" is naturally one referent — the column's search config — not one referent per mode. Per-mode-flag invariants (`...user.email.unique`, `...user.email.match`) would force downstream refs to either pick one or list all, both of which leak the mode-flag-to-EQL-index mapping into ref-routing concerns. Per-`(table, column)` invariants give downstream refs a single stable target.

Operations modeling their `execute` payload as an array of statements is the established shape — see `SqlMigrationPlanOperation.execute: readonly SqlMigrationPlanOperationStep[]` at `packages/2-sql/9-family/src/core/migrations/types.ts`. Multi-statement ops are not novel; the cipherstash factories use that capacity rather than fighting it.

### Why these ops must carry `invariantId`s

PR #404 introduces `invariantId`-based routing in the migration planner: refs encoded in subsequent migrations resolve through invariant ids attached to ops. Search-config installs need to be referenceable — a future Project 2 migration that depends on "search config for `user.email` is active" will encode that as a ref against `cipherstash.search-config.user.email`, which only works if the originating op participates in the invariant index.

Concretely, `packages/1-framework/3-tooling/migration/src/invariants.ts:deriveProvidedInvariants` is the function that builds the index. The implementation question — described in § Open Questions — is whether the cipherstash factories (a) produce a `DataTransformOperation` whose plan supports multi-statement output, (b) produce a `SqlMigrationPlanOperation` extended with an `invariantId` field that `deriveProvidedInvariants` recognizes, or (c) produce a new operation shape that combines invariant tracking with a multi-statement `execute` payload. All three options preserve the user-facing factory contract; only the implementer chooses between them based on which path is least invasive to the framework.

### Why `RawSqlExpr` directly, not the public `raw\`...\`` factory

The public `raw\`...\`` factory ships in [`sql-raw-factory`](../../sql-raw-factory/spec.md), a sibling component of the cipherstash-integration umbrella that is not on Project 1's critical path. Cipherstash needs the raw-SQL capability *now* (for Project 1), and the AST node + lowerer arm in [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md) is sufficient. Constructing `RawSqlExpr.of(...)` directly is a small amount of factory-internal boilerplate; the user-facing `cipherstash.addSearchConfig({...})` API hides it entirely. When `sql-raw-factory` lands, this factory could be refactored to use `raw\`...\`` internally for cosmetic clarity, but there's no functional reason to gate Project 1 on that refactor.

## Non-Functional Requirements

- **Idempotency.** Re-running a migration with cipherstash factory ops against an already-configured database is a no-op. EQL's `add_search_config` and activation functions are themselves idempotent on duplicate input (it's worth confirming from the EQL bundle source); if not, individual `execute` steps can render a guarded SQL form, but the simpler pattern is to lean on EQL's own idempotency. See OQ4.
- **Stable invariant ids.** `invariantId`s are deterministic given the inputs — `cipherstash.search-config.<table>.<column>` — so re-emitting the same factory call across migration regenerations produces the same id, no churn.
- **Order independence within a migration.** Multiple `addSearchConfig` calls in one migration produce ops that the planner can sort independently — order of factory invocation doesn't affect the emitted plan's content hash.
- **Minimal framework changes.** The user-facing factory contract is satisfied by existing primitives (`RawSqlExpr` from raw-sql-ast-node, the `Migration` class from the family-postgres surface). The op-shape implementation choice (OQ2) may require a targeted framework change — extending `DataTransformOperation` to carry multi-statement plans, or extending `SqlMigrationPlanOperation` to participate in invariant routing — but no new top-level primitive.
- **No coupling to `sql-raw-factory`.** Project 1 ships without the public `raw\`...\`` template-literal factory existing.

## Non-goals

- **Automatic per-column DDL planning.** Project 2.
- **Migration scaffolding for cipherstash columns.** A `migrate scaffold` command that auto-generates a migration calling `addSearchConfig` for newly-added cipherstash columns is plausibly useful but is Project 2.
- **Re-encryption migrations.** Adopting cipherstash for an existing populated column requires re-encrypting data — handled by the user with a one-off script or a `DataTransformOperation` they author themselves. Not a factory in Project 1.
- **Drop / dropConfig factories.** Removing a search mode from a column would require destructive DDL guarded by prior-state diffing — Project 2 territory.
- **Multi-database routing key support in the factory signature.** Routing to specific ZeroKMS datasets / key-ids is determined at runtime by the codec, not at migration time. The factory's job is purely the EQL-side config row install.
- **Dependency on the public `raw\`...\`` factory.** That's `projects/sql-raw-factory/`'s deliverable; this project doesn't gate on it.

# Acceptance Criteria

## Factory shape

- [ ] **AC-FACT1**: `addSearchConfig({ table, column, equality?, freeTextSearch? }, contract)` returns a single migration operation object (not an array, not a thunk).
- [ ] **AC-FACT2**: `addSearchConfig({ table, column }, contract)` with no flags enabled throws synchronously with a clear error message naming the affected `(table, column)`.
- [ ] **AC-FACT3**: The returned op has a deterministic `invariantId` of the form `cipherstash.search-config.<table>.<column>` — one per `(table, column)` call, **not** per mode flag.
- [ ] **AC-FACT4**: `activatePendingSearches(contract)` returns a single migration operation with `invariantId: 'cipherstash.search-config.activate-pending'`.
- [ ] **AC-FACT5**: The returned op exposes a multi-step `execute` payload (the standard SQL-family op shape — `readonly SqlMigrationPlanOperationStep[]`) — or, if implemented via an underlying `DataTransformOperation`, exposes equivalent multi-step semantics through whatever inspection surface that op type provides.

## SQL shapes

- [ ] **AC-SQL1**: An `addSearchConfig` op produces one `execute` step per enabled mode flag. `addSearchConfig({ ..., equality: true, freeTextSearch: true })` → 2 steps; `addSearchConfig({ ..., equality: true })` → 1 step.
- [ ] **AC-SQL2**: Each step's rendered SQL is `SELECT eql_v2.add_search_config($1, $2, $3, $4)` with `params: ['<table>', '<column>', '<index_name>', '<cast_as>']`. The `<index_name>` is `'unique'` for the `equality` step and `'match'` for the `freeTextSearch` step; `<cast_as>` is `'text'` in both cases.
- [ ] **AC-SQL3**: `activatePendingSearches`'s op produces one `execute` step rendering the EQL pending-activation function call with no parameters.
- [ ] **AC-SQL4**: Adversarial table / column names (containing single-quote, backslash, NUL, newline) flow through unchanged in `params` — they're parameterized values, not text-inlined into the SQL string.
- [ ] **AC-SQL5**: Each step's SQL is built from a `RawSqlExpr` AST node via `planFromAst` (per [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md)), then lowered to a `SqlMigrationPlanOperationStep` by the adapter.

## Migration integration

- [ ] **AC-MIG1**: A `migration.ts` placing `addSearchConfig({ table: 'user', column: 'email', equality: true }, endContract)` and `activatePendingSearches(endContract)` directly in the `operations` array (no `.map`, no `this.dataTransform(...)` wrapping) produces a valid migration plan.
- [ ] **AC-MIG2**: The cipherstash ops in the resulting plan carry the expected `invariantId`s — one per `(table, column)` call for `addSearchConfig`, plus the activate-pending invariant.
- [ ] **AC-MIG3**: `deriveProvidedInvariants` over the resulting plan reports the cipherstash invariant ids as available — the chosen op shape (see § Open Questions) participates in the invariant index.
- [ ] **AC-MIG4**: The plan applies cleanly against a fresh Postgres database with EQL installed: the EQL config table ends with one row for `(user, email)` for each enabled mode in `'active'` state.
- [ ] **AC-MIG5**: Re-applying the same migration is a no-op (EQL's idempotency or the operation's precheck pattern, whichever ends up in scope; integration test asserts no errors).
- [ ] **AC-MIG6**: A migration combining cipherstash factory ops with standard `rawSql(...)` ops or `dataTransform(...)` ops plans and applies correctly.

## End-to-end

- [ ] **AC-E2E1**: Round-trip integration test (the umbrella's `AC-UMB1` scenario):
  1. `dbInit` creates the table; EQL extension is installed via `databaseDependencies.init`.
  2. Hand-authored `migration.ts` places `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true }, endContract)` and `activatePendingSearches(endContract)` directly in `operations`.
  3. Migration applies successfully.
  4. Subsequent `findMany({ where: { email: { equals: 'x' } } })` and `findMany({ where: { email: { contains: 'foo' } } })` queries work end-to-end.
- [ ] **AC-E2E2**: A second migration that depends on the cipherstash search-config invariant id (`cipherstash.search-config.user.email`) via the ref system (per PR #404) sequences correctly after the search-config-installing migration.

# Other Considerations

## Security

EQL config rows in `cs_configuration_v2` reveal which `(table, column)` pairs are encrypted-and-searchable. That's metadata an attacker with database access can already infer from column types — it's not a new disclosure surface. The factories don't store any cryptographic material in `cs_configuration_v2`; keys live in ZeroKMS, ciphertexts live in the column itself.

The factories' four user-supplied string inputs (table, column, the index-name and cast-as values, both factory-controlled) flow as `ParamRef`s (parameterized) rather than text-inlined into the SQL fragment. SQL injection isn't possible at this layer regardless of input.

## Cost

Migration-time only — no runtime cost. EQL function calls are O(1) inserts into a small config table.

## Observability

`DataTransformOperation`s flow through the standard migration-runner observability surface. Op-level timings and failure attribution use `invariantId` as the natural identifier, which is already structured and human-readable.

## Data Protection

Not applicable — these factories install search configuration only; data encryption is the codec's concern.

# References

- [Project 1 spec](../spec.md)
- [Umbrella spec](../../spec.md)
- [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md) — the AST node + lowerer arm + `planFromAst` envelope helper this factory consumes.
- [envelope-codec-extension task spec](envelope-codec-extension.spec.md) — defines the codec these search modes apply to.
- [psl-encrypted-string-constructor task spec](psl-encrypted-string-constructor.spec.md) — defines the authoring surface that produces `typeParams` matching the modes this factory installs.
- [First-attempt `database-dependencies.ts`](../../../../reference/cipherstash/stack/packages/stack/src/prisma/core/database-dependencies.ts) — the canonical EQL operation SQL shapes are lifted from this file.
- [Postgres `dataTransform` factory](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts) — the `Buildable`-consuming factory that produces `DataTransformOperation`s. Referenced from OQ2 as one option for the underlying op shape.
- [`SqlMigrationPlanOperation` definition](../../../../packages/2-sql/9-family/src/core/migrations/types.ts) — defines the multi-step `execute: readonly SqlMigrationPlanOperationStep[]` shape that's the established pattern for SQL-family ops.
- [`invariants.ts:deriveProvidedInvariants`](../../../../packages/1-framework/3-tooling/migration/src/invariants.ts) — the function that builds the migration-time invariant index. The op shape this spec's factories produce must be reachable by this function (see OQ2).
- [PR #404](https://github.com/prisma/prisma-next/pull/404) — invariant-aware ref routing.
- [`sql-raw-factory`](../../sql-raw-factory/spec.md) — sibling component of the cipherstash-integration umbrella that ships the user-facing `raw\`...\`` template-literal factory (not a dependency of this spec).

# Open Questions

1. **EQL `activate_pending_searches` exact function name.** Defer to the first-attempt repo's canonical name (the lift-from file is `database-dependencies.ts`). Some EQL versions expose it as a different SQL function — confirm against the version of EQL the bundled install ships.

2. **Underlying op-shape choice — multi-statement `execute` + invariant-routing participation.** The factory's user-facing contract is settled (one op per `(table, column)`, `execute`-array semantics, deterministic `invariantId`), but the framework currently has two op types with overlapping but non-identical capabilities:
   - `SqlMigrationPlanOperation` carries a multi-statement `execute: SqlMigrationPlanOperationStep[]` payload, but as of writing it doesn't carry an `invariantId` field — `deriveProvidedInvariants` reads invariants from `DataTransformOperation`s only.
   - `DataTransformOperation` carries `invariantId` and is the operation class `deriveProvidedInvariants` filters on — but its execution model wraps a single `Buildable` plan, not an array of statements.

   Three viable resolutions:

   - **(a) Extend `DataTransformOperation`** to support a multi-statement plan (either via `Buildable` returning a `SqlQueryPlan`-like value with multiple `ast` arms, or via a sibling `Buildable` shape that lowers to multiple steps). Smallest scope if the framework's transform-runner can be taught to walk a multi-statement plan.
   - **(b) Extend `SqlMigrationPlanOperation`** with an `invariantId` field and update `deriveProvidedInvariants` to recognize it. Cleaner conceptually (the cipherstash op is more "schema-touching SQL with multiple steps" than "data transform"), but is a broader framework change.
   - **(c) New operation shape** that explicitly combines invariant tracking with multi-statement `execute`. Most explicit, but introduces a third op type into a system TML-2292 is already planning to *unify*.

   Defer to the implementer; each option is observable in the same factory return type from the user's perspective, but they imply different framework changes and different ACs to verify (AC-FACT5, AC-MIG3). Worth flagging at the next CipherStash-team-facing checkpoint and worth resolving before T2.c.6 / T3 implementation lands.

3. **Should the factory accept the contract implicitly?** The user has `endContract` available in their `migration.ts` and threads it into `addSearchConfig(..., endContract)`. (Now that the user-facing shape no longer wraps with `this.dataTransform(...)`, the threading happens once per call rather than twice — but it still happens once per call.) Alternatives: (a) the factory holds onto the contract via a small builder pattern (`cipherstash.migrationFactories(endContract).addSearchConfig({...})`), (b) the contract is read from a thread-local-ish context. Default: thread it explicitly; the boilerplate is small and the explicit form is clearer for migration files (which are stable, hand-authored artifacts that benefit from explicit dataflow).

4. **Idempotency mechanism — EQL self-idempotency vs explicit precheck.** With multi-step `execute` semantics, the factory can in principle add a per-step precheck. If EQL's `add_search_config` isn't itself idempotent, the factory can render a guarded SQL form (e.g. `... WHERE NOT EXISTS (...)`) or a stored-procedure call that wraps the idempotency check. Defer the exact shape to implementation; verify against EQL's behavior first. Note that the resolution interacts with OQ2 — `SqlMigrationPlanOperation` exposes a separate `precheck` array, while `DataTransformOperation`'s precheck story is different.

5. **Future flag naming alignment.** Project 2 will add `orderAndRange` (→ EQL `'ore'`) and `searchableJson` (→ EQL `'ste_vec'`). Should the public flag names match EQL's internal names exactly — abandoning the human-friendly aliases — for consistency? Default: keep the friendly names; the mapping is internal and the public API benefits from being self-documenting (`equality` and `freeTextSearch` are immediately understood; `unique` and `match` are not). Worth flagging because there's a real tension between the surface and the wire format.
