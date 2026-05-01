# Summary

Ship `cipherstash.addSearchConfig({ ... })` and `cipherstash.activatePendingSearches()` migration factories that users invoke from hand-authored `migration.ts` files to install per-column EQL search-mode configuration. Both factories produce `DataTransformOperation`s — not `rawSql({...})` `'additive'`-class ops — so they can carry `invariantId`s for invariant-aware ref routing per [PR #404](https://github.com/prisma/prisma-next/pull/404). Each factory builds a `SqlQueryPlan` containing a `RawSqlExpr` AST node (delivered by [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md)) directly via the package-internal API — no dependency on the (separate, parallel) public `raw\`...\`` template-literal factory at [`sql-raw-factory`](../../sql-raw-factory/spec.md).

# Description

CipherStash's EQL extension stores per-column search configuration in a `cs_configuration_v2` table containing JSONB documents that enumerate which indexes are active for which `(table, column)` pairs. Each "mode" — `equality`, `freeTextSearch`, etc. — is added by calling the EQL function `eql_v2.add_search_config(table, column, index_name, cast_as)`. The first-attempt integration's `database-dependencies.ts` already shows the canonical SQL shape; this task spec lifts that pattern into Project 1's hand-authored-migration surface.

In Project 1, the user authors a migration file that explicitly issues these calls per encrypted column. In Project 2, the planner will emit them automatically based on contract diff, via `planTypeOperations`. The two ship in different projects because the *automatic* path requires framework prerequisites (per-column `(table, column)` input to `planTypeOperations`; prior-state contract supplied to `planTypeOperations` for destructive DDL) that haven't started; the *manual* path needs neither — the user supplies `(table, column)` directly as factory arguments.

The factories produce `DataTransformOperation`s rather than `rawSql({...})` `SqlMigrationPlanOperation`s for two reasons:

1. **Invariant-aware ref routing.** PR #404 routes downstream migration operations across these ops by `invariantId`. `SqlMigrationPlanOperation`s lifted via `rawSql(...)` are path-dependent — they can't be the target of a ref. Search-config installs must be referenceable so future migrations can encode "after `cipherstash.user.email.search-enabled` …" dependencies.
2. **Conceptual fit.** The user is supplying *application-layer state* via SQL, not declaring a new schema object. `DataTransformOperation` is the operation class for "I am running SQL to mutate data state, with an opaque invariant key for cross-migration referencing." That's the right bucket. (TML-2292 will eventually collapse `SqlMigrationPlanOperation` and `DataTransformOperation` into one — at which point this distinction goes away — but until then the choice of `DataTransformOperation` is correct.)

The construction path is:

```
factory call
  ↓
RawSqlExpr.of(fragments, [ParamRef.of(value, { codecId }), ...])  ← from raw-sql-ast-node task spec
  ↓
planFromAst(ast, endContract)                                       ← from raw-sql-ast-node task spec
  ↓
SqlQueryPlan { ast: RawSqlExpr, params: [], meta }
  ↓
dataTransform({ run: () => plan, invariantId })                     ← existing Postgres factory
  ↓
DataTransformOperation { operationClass: 'data', invariantId, ... }
```

The user never sees `RawSqlExpr` directly. The factory hides it behind `addSearchConfig({ ... })` / `activatePendingSearches()`. `RawSqlExpr` flows through `dataTransform`'s `Buildable` interface unchanged because `Buildable` returns a `SqlQueryPlan` and `RawSqlExpr` is now a valid `AnyQueryAst` arm.

# Requirements

## Functional Requirements

### `cipherstash.addSearchConfig({ ... })`

```ts
// packages/3-extensions/cipherstash/src/exports/migration.ts
import type { Migration } from '@prisma-next/cli/migration';
import type { Contract, SqlStorage } from '@prisma-next/sql-relational-core';

export interface AddSearchConfigInput {
  readonly table: string;
  readonly column: string;
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
}

/**
 * Returns an array of migration ops, one per enabled mode flag. The user
 * spreads these into the migration's `operations` getter via
 * `this.dataTransform(...)` calls.
 *
 * The returned shape is opaque to the user — they invoke `this.dataTransform`
 * inside their `migration.ts` against each entry.
 */
export interface AddSearchConfigEntry {
  readonly invariantId: string;
  readonly run: () => SqlQueryPlan;
}

export function addSearchConfig(
  input: AddSearchConfigInput,
  contract: Contract<SqlStorage>,
): readonly AddSearchConfigEntry[];
```

Behavior:

- Emits **one entry per enabled mode flag**. So `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true }, endContract)` produces two entries: one for `eql_v2.add_search_config('user', 'email', 'unique', 'text')`, one for `eql_v2.add_search_config('user', 'email', 'match', 'text')`.
- Maps user-facing mode flags to EQL internal index names (the same mapping the first-attempt's `database-dependencies.ts` defines):
  - `equality: true` → EQL index name `'unique'`, `cast_as: 'text'`.
  - `freeTextSearch: true` → EQL index name `'match'`, `cast_as: 'text'`.
- Each entry's `run()` constructs a `SqlQueryPlan` whose `ast` is a `RawSqlExpr` rendering the EQL function call. The four arguments to `eql_v2.add_search_config` flow as `ParamRef`s with codec id `'pg/text@1'` — they are parameterized, not text-inlined, which sidesteps any SQL-injection concern around the user-supplied `table` / `column` strings.
- Each entry's `invariantId` is deterministic from the input: `cipherstash.search-config.<table>.<column>.<index_name>`. Stable across migration regenerations; readable in invariant-routing diagnostics.

Construction sketch (factory-internal):

```ts
import { RawSqlExpr, ParamRef, planFromAst } from '@prisma-next/sql-relational-core';

function makeAddSearchConfigEntry(
  table: string,
  column: string,
  indexName: 'unique' | 'match',
  castAs: 'text',
  contract: Contract<SqlStorage>,
): AddSearchConfigEntry {
  const invariantId = `cipherstash.search-config.${table}.${column}.${indexName}`;
  const run = () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.add_search_config(', ', ', ', ', ', ', ')'],
      [
        ParamRef.of(table,     { codecId: 'pg/text@1' }),
        ParamRef.of(column,    { codecId: 'pg/text@1' }),
        ParamRef.of(indexName, { codecId: 'pg/text@1' }),
        ParamRef.of(castAs,    { codecId: 'pg/text@1' }),
      ],
    );
    return planFromAst(ast, contract);
  };
  return { invariantId, run };
}
```

### `cipherstash.activatePendingSearches()`

```ts
export function activatePendingSearches(
  contract: Contract<SqlStorage>,
): AddSearchConfigEntry;
```

Behavior:

- Emits **one** entry that calls EQL's pending-activation function (the first-attempt repo's `database-dependencies.ts` shows the canonical SQL — to be lifted; the spec defers to that file for the exact function name).
- `invariantId`: `cipherstash.search-config.activate-pending`.
- `run()` constructs a `SqlQueryPlan` with a `RawSqlExpr` AST containing zero interpolated args — just the static SQL fragment. (`RawSqlExpr.of(['SELECT eql_v2.activate_pending_searches()'], [])` is valid by AC-AST3 / AC-LOW5 of the AST node spec.)

### Mapping table — public flag → EQL index

| Public flag | EQL `index_name` | EQL `cast_as` (for `EncryptedString`) |
|---|---|---|
| `equality: true` | `'unique'` | `'text'` |
| `freeTextSearch: true` | `'match'` | `'text'` |

This table is internal to the migration factory module. It will grow in Project 2 as additional column types and modes ship (`orderAndRange` → `'ore'`, `searchableJson` → `'ste_vec'`, etc.).

### User-side migration shape

```ts
// migration.ts
import { Migration } from '@prisma-next/cli/migration';
import {
  addSearchConfig,
  activatePendingSearches,
} from '@prisma-next/extension-cipherstash/migration';
import endContract from './end-contract.json' with { type: 'json' };

export default class M_001_add_encrypted_email extends Migration {
  override get operations() {
    const entries = [
      ...addSearchConfig(
        { table: 'user', column: 'email', equality: true, freeTextSearch: true },
        endContract,
      ),
      activatePendingSearches(endContract),
    ];

    return entries.map(({ invariantId, run }) =>
      this.dataTransform(endContract, invariantId, { invariantId, run }),
    );
  }
}
```

The `this.dataTransform(...)` call is the standard Postgres-target factory at `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`. It wraps the entry into a `DataTransformOperation` with `operationClass: 'data'` and the supplied `invariantId`.

### Subpath export

The factories are exported from a new subpath: `@prisma-next/extension-cipherstash/migration`. This keeps the migration-time imports separate from runtime imports (`@prisma-next/extension-cipherstash`), runtime descriptor imports (`/runtime`), control descriptor imports (`/control`), and column-type factory imports (`/column-types`).

### Why `DataTransformOperation`, not `rawSql({...})`

PR #404 introduces `invariantId`-based routing in the migration planner: refs encoded in subsequent migrations resolve through invariant ids attached to data-class operations. `SqlMigrationPlanOperation`s lifted via `rawSql(...)` are *path-dependent* — they can't be the target of a ref because they don't carry an invariant key. Search-config installs need to be referenceable: a future Project 2 migration that depends on "search config for `user.email` is active" will encode that as a ref against `cipherstash.search-config.user.email.unique`, which only works if the originating op was a `DataTransformOperation`.

Concretely, `packages/1-framework/3-tooling/migration/src/invariants.ts:deriveProvidedInvariants` filters by `op.operationClass === 'data'` and reads `invariantId` from `DataTransformOperation`s only. Lifted `rawSql(...)` ops never appear in the invariant index.

This was a previous-design reversal worth recording: an earlier draft of this spec used `rawSql({...})` because it was simpler. That draft was wrong — see the user feedback in the design transcript that motivated the switch to `DataTransformOperation`.

### Why `RawSqlExpr` directly, not the public `raw\`...\`` factory

The public `raw\`...\`` factory ships in [`sql-raw-factory`](../../sql-raw-factory/spec.md), a sibling component of the cipherstash-integration umbrella that is not on Project 1's critical path. Cipherstash needs the raw-SQL capability *now* (for Project 1), and the AST node + lowerer arm in [raw-sql-ast-node task spec](raw-sql-ast-node.spec.md) is sufficient. Constructing `RawSqlExpr.of(...)` directly is a small amount of factory-internal boilerplate; the user-facing `cipherstash.addSearchConfig({...})` API hides it entirely. When `sql-raw-factory` lands, this factory could be refactored to use `raw\`...\`` internally for cosmetic clarity, but there's no functional reason to gate Project 1 on that refactor.

## Non-Functional Requirements

- **Idempotency.** Re-running a migration with cipherstash factory ops against an already-configured database is a no-op. EQL's `add_search_config` and activation functions are themselves idempotent on duplicate input (it's worth confirming from the EQL bundle source); if not, the factory's `run` closure can issue a guarded `INSERT ... ON CONFLICT DO NOTHING`-style construct, but the simpler pattern is to lean on EQL's own idempotency.
- **Stable invariant ids.** `invariantId`s are deterministic given the inputs — `cipherstash.search-config.<table>.<column>.<index_name>` — so re-emitting the same factory call across migration regenerations produces the same id, no churn.
- **Order independence within a migration.** Multiple `addSearchConfig` calls in one migration produce entries that the planner can sort independently — order of factory invocation doesn't affect the emitted plan's content hash.
- **No new framework primitives.** All functionality lives on top of (a) the `RawSqlExpr` AST node from the raw-sql-ast-node task spec and (b) the existing `dataTransform` factory.
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

- [ ] **AC-FACT1**: `addSearchConfig({ table, column, equality, freeTextSearch }, contract)` returns a readonly array of `AddSearchConfigEntry` (one per enabled flag).
- [ ] **AC-FACT2**: `addSearchConfig({ table, column }, contract)` (no flags enabled) returns an empty array.
- [ ] **AC-FACT3**: Each returned entry has a deterministic `invariantId` of the form `cipherstash.search-config.<table>.<column>.<index_name>`.
- [ ] **AC-FACT4**: `activatePendingSearches(contract)` returns one `AddSearchConfigEntry` with `invariantId: 'cipherstash.search-config.activate-pending'`.

## SQL shapes

- [ ] **AC-SQL1**: A factory entry's `run()` produces a `SqlQueryPlan` whose `ast` is a `RawSqlExpr`. After `adapter.lower(plan.ast, ctx)`, the rendered SQL is `SELECT eql_v2.add_search_config($1, $2, $3, $4)` with `params: ['<table>', '<column>', '<index_name>', '<cast_as>']`.
- [ ] **AC-SQL2**: For `freeTextSearch: true`, the `params[2]` is `'match'`; for `equality: true`, it's `'unique'`.
- [ ] **AC-SQL3**: `activatePendingSearches`'s lowered SQL is the EQL pending-activation function call with no parameters.
- [ ] **AC-SQL4**: Adversarial table / column names (containing single-quote, backslash, NUL, newline) flow through unchanged in `params` — they're parameterized values, not text-inlined into the SQL string.

## Migration integration

- [ ] **AC-MIG1**: A `migration.ts` calling `addSearchConfig({ table: 'user', column: 'email', equality: true }, endContract)` followed by `activatePendingSearches(endContract)`, each wrapped via `this.dataTransform(...)`, produces a valid migration plan.
- [ ] **AC-MIG2**: Each emitted `DataTransformOperation` has `operationClass: 'data'` and the expected `invariantId`.
- [ ] **AC-MIG3**: `deriveProvidedInvariants` over the resulting plan reports the cipherstash invariant ids as available.
- [ ] **AC-MIG4**: The plan applies cleanly against a fresh Postgres database with EQL installed: `cs_configuration_v2` ends with one row for `(user, email)` with `'unique'` index in `'active'` state.
- [ ] **AC-MIG5**: Re-applying the same migration is a no-op (EQL's idempotency or the operation's precheck pattern, whichever ends up in scope; integration test asserts no errors).
- [ ] **AC-MIG6**: A migration combining cipherstash factory ops with standard `rawSql(...)` ops or other `dataTransform(...)` ops plans and applies correctly.

## End-to-end

- [ ] **AC-E2E1**: Round-trip integration test (the umbrella's `AC-UMB1` scenario):
  1. `dbInit` creates the table; EQL extension is installed via `databaseDependencies.init`.
  2. Hand-authored `migration.ts` invokes `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true }, endContract)` + `activatePendingSearches(endContract)`, each wrapped via `this.dataTransform(...)`.
  3. Migration applies successfully.
  4. Subsequent `findMany({ where: { email: { equals: 'x' } } })` and `findMany({ where: { email: { contains: 'foo' } } })` queries work end-to-end.
- [ ] **AC-E2E2**: A second migration that depends on the cipherstash search-config invariant id via the ref system (per PR #404) sequences correctly after the search-config-installing migration.

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
- [Postgres `dataTransform` factory](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts) — the `Buildable`-consuming factory that produces `DataTransformOperation`s.
- [`invariants.ts:deriveProvidedInvariants`](../../../../packages/1-framework/3-tooling/migration/src/invariants.ts) — confirms that only `operationClass: 'data'` ops contribute invariants to the index.
- [PR #404](https://github.com/prisma/prisma-next/pull/404) — invariant-aware ref routing.
- [`sql-raw-factory`](../../sql-raw-factory/spec.md) — sibling component of the cipherstash-integration umbrella that ships the user-facing `raw\`...\`` template-literal factory (not a dependency of this spec).

# Open Questions

1. **EQL `activate_pending_searches` exact function name.** Defer to the first-attempt repo's canonical name (the lift-from file is `database-dependencies.ts`). Some EQL versions expose it as a different SQL function — confirm against the version of EQL the bundled install ships.
2. **`addSearchConfig` factory return type — array vs single op.** Returning an array forces users to spread/map at the call site. Alternative: return a *grouped* op (single entry whose `run` produces a `SqlQueryPlan` with multiple statements). `RawSqlExpr` doesn't naturally express a multi-statement script; lowering it would either require a multi-statement SQL string or a sequence of plans. Default: array, because per-mode invariant ids are useful for ref routing and per-mode preflight short-circuiting. Confirm.
3. **Should the factory accept the contract implicitly?** The user has the `endContract` available in their `migration.ts` and threads it into both `this.dataTransform(endContract, ...)` *and* into `addSearchConfig(..., endContract)`. Threading twice is mildly annoying. Alternatives: (a) the factory holds onto the contract via a small builder pattern (`cipherstash.migrationFactories(endContract).addSearchConfig({...})`), (b) the contract is read from a thread-local-ish context. Default: thread it twice and document the redundancy; the boilerplate is small and the explicit form is clearer for migration files (which are stable, hand-authored artifacts that benefit from explicit dataflow).
4. **Idempotency mechanism — EQL self-idempotency vs explicit precheck.** `dataTransform` doesn't natively support precheck/postcheck (that's `SqlMigrationPlanOperation`'s shape). If EQL's `add_search_config` isn't itself idempotent, the factory's `run` closure has to issue a guarded SQL form (e.g. `... WHERE NOT EXISTS (...)`) or a stored-procedure call that wraps the idempotency check. Defer the exact shape to implementation; verify against EQL's behavior first.
5. **Future flag naming alignment.** Project 2 will add `orderAndRange` (→ EQL `'ore'`) and `searchableJson` (→ EQL `'ste_vec'`). Should the public flag names match EQL's internal names exactly — abandoning the human-friendly aliases — for consistency? Default: keep the friendly names; the mapping is internal and the public API benefits from being self-documenting (`equality` and `freeTextSearch` are immediately understood; `unique` and `match` are not). Worth flagging because there's a real tension between the surface and the wire format.
