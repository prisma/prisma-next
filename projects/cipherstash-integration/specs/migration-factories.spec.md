# Summary

Ship `cipherstash.addSearchConfig({ ... })` and `cipherstash.activatePendingSearches()` migration factories that users invoke from hand-authored `migration.ts` files to install per-column EQL search-mode configuration. Both factories produce `'additive'`-class operations wrapped via the existing Postgres `rawSql({...})` escape hatch — no new framework migration primitive is required, and Project 1 deliberately avoids consuming PR #404's `DataTransformOperation` invariant-aware routing (that's Project 2 territory).

# Description

CipherStash's EQL extension stores per-column search configuration in a `cs_configuration_v2` table containing JSONB documents that enumerate which indexes are active for which `(table, column)` pairs. Each "mode" — `equality`, `freeTextSearch`, etc. — is added by calling the EQL function `eql_v2.add_search_config(table, column, index_name, cast_as)`. The first-attempt integration's `database-dependencies.ts` already shows the canonical SQL shape; this task spec lifts that pattern into Project 1's hand-authored-migration surface.

In Project 1, the user authors a migration file that explicitly issues these calls per encrypted column. In Project 2, the planner will emit them automatically based on contract diff, via `planTypeOperations`. The two ship in different projects because the *automatic* path requires consuming [TML-2338](https://linear.app/prisma-company/issue/TML-2338) (`(table, column)` input to `planTypeOperations`) and [TML-2339](https://linear.app/prisma-company/issue/TML-2339) (prior-state contract for destructive DDL); the *manual* path needs neither — the user supplies `(table, column)` directly as factory arguments.

# Requirements

## Functional Requirements

### `cipherstash.addSearchConfig({ ... })`

```ts
// packages/3-extensions/cipherstash/src/exports/migration.ts
export interface AddSearchConfigInput {
  readonly table: string;
  readonly column: string;
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
}

export function addSearchConfig(
  input: AddSearchConfigInput,
): readonly Op[];   // Op = SqlMigrationPlanOperation, what `rawSql({...})` accepts
```

Behavior:

- Emits **one operation per enabled mode flag**. So `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true })` produces two ops: one calling `eql_v2.add_search_config('user', 'email', 'unique', 'text')` and one calling `eql_v2.add_search_config('user', 'email', 'match', 'text')`.
- Maps user-facing mode flags to EQL internal index names (the same mapping the first-attempt's `database-dependencies.ts` defines):
  - `equality: true` → EQL index name `'unique'`, `cast_as: 'text'`.
  - `freeTextSearch: true` → EQL index name `'match'`, `cast_as: 'text'`.
- Each emitted op carries:
  - `id`: `cipherstash.eql.add_search_config.<table>.<column>.<index_name>` (matches first-attempt convention for stable diff hashing).
  - `label`: `Add EQL <index_name> index on <table>.<column>`.
  - `operationClass`: `'additive'`.
  - `target`: `{ id: 'postgres', details: { objectType: 'type', ... } }` (the `objectType: 'type'` flag routes the op into the `'dep'` classification bucket per `issue-planner.ts:classifyCall`).
  - `precheck`: `SELECT NOT EXISTS (... data #> ARRAY['tables', 'user', 'email', 'indexes'] ? 'unique')` — short-circuits if the mode is already configured.
  - `execute`: `SELECT eql_v2.add_search_config('user', 'email', 'unique', 'text')`.
  - `postcheck`: `SELECT EXISTS (... data #> ... ? 'unique')` — confirms the mode landed.
- The user wraps each emitted op via the standard `rawSql(...)` escape hatch when authoring the migration:

  ```ts
  // migration.ts
  import { Migration } from '@prisma-next/cli/migration';
  import { rawSql } from '@prisma-next/postgres/migration';
  import { addSearchConfig, activatePendingSearches } from '@prisma-next/extension-cipherstash/migration';
  import endContract from './end-contract.json' with { type: 'json' };

  export default class M_001_add_encrypted_email extends Migration {
    override get operations() {
      return [
        ...addSearchConfig({
          table: 'user',
          column: 'email',
          equality: true,
          freeTextSearch: true,
        }).map(rawSql),
        rawSql(activatePendingSearches()),
      ];
    }
  }
  ```

### `cipherstash.activatePendingSearches()`

```ts
export function activatePendingSearches(): Op;
```

Behavior:

- Emits **one** operation that calls EQL's pending-activation function (the first-attempt repo's `database-dependencies.ts` shows the canonical SQL — to be lifted; the spec defers to that file for the exact function name).
- `id`: `cipherstash.eql.activate_pending_searches`.
- `operationClass`: `'additive'`.
- `precheck`: probes `cs_configuration_v2` for any `'pending'` rows; short-circuits when there are none.
- `execute`: the activation SQL.
- `postcheck`: confirms no pending rows remain.

### Mapping table — public flag → EQL index

| Public flag | EQL `index_name` | EQL `cast_as` (for `EncryptedString`) |
|---|---|---|
| `equality: true` | `'unique'` | `'text'` |
| `freeTextSearch: true` | `'match'` | `'text'` |

This table is internal to the migration factory module. It will grow in Project 2 as additional column types and modes ship (`orderAndRange` → `'ore'`, `searchableJson` → `'ste_vec'`, etc.).

### Subpath export

The factories are exported from a new subpath: `@prisma-next/extension-cipherstash/migration`. This keeps the migration-time imports separate from runtime imports (`@prisma-next/extension-cipherstash`), runtime descriptor imports (`/runtime`), control descriptor imports (`/control`), and column-type factory imports (`/column-types`).

### No `DataTransformOperation` consumption

Project 1's factories produce `Op` shapes (the existing `SqlMigrationPlanOperation` type) — they do **not** produce `DataTransformOperation` instances. The reasons are concrete and worth recording in the spec:

- `DataTransformOperation` is built from query-builder closures producing `SqlQueryPlan` instances (see `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`). The query builder doesn't expose `eql_v2.add_search_config(...)` as a callable function; raw EQL function calls aren't naturally expressible as builder AST.
- `DataTransformOperation`'s `operationClass: 'data'` flips the planner into data-policy mode (gated by `policy.allowedOperationClasses` containing `'data'`). The cipherstash search-config installs are *additive structural* operations, not data transforms.
- `rawSql({...})` already provides the exact escape hatch needed: it accepts an arbitrary `SqlMigrationPlanOperation` with precheck/execute/postcheck and lifts it through the planner via `RawSqlCall`. This is the same path `databaseDependencies.init` ops travel.

PR #404 is therefore not a Project 1 dependency — it's a Project 2 dependency, when planner-driven cipherstash ops need to compose with `DataTransformOperation`s under invariant-aware routing.

## Non-Functional Requirements

- **Idempotency.** Re-running a migration with cipherstash factory ops against an already-configured database is a no-op (every op's precheck short-circuits).
- **Stable diff hashing.** Op `id`s are deterministic given the inputs — `cipherstash.eql.add_search_config.<table>.<column>.<index_name>` — so re-emitting the same factory call produces the same op id, no churn.
- **Order independence within a migration.** Multiple `addSearchConfig` calls in one migration produce ops that the planner can sort independently — order of factory invocation doesn't affect the emitted plan's content hash.
- **No new framework primitives.** All functionality lives on top of `rawSql({...})`.

## Non-goals

- **Automatic per-column DDL planning.** Project 2.
- **Migration scaffolding for cipherstash columns.** A `migrate scaffold` command that auto-generates a migration calling `addSearchConfig` for newly-added cipherstash columns is plausibly useful but is Project 2.
- **Re-encryption migrations.** Adopting cipherstash for an existing populated column requires re-encrypting data — handled by the user with a one-off script or a `DataTransformOperation` they author themselves. Not a factory in Project 1.
- **Drop / dropConfig factories.** Removing a search mode from a column would require destructive DDL guarded by prior-state diffing — Project 2 territory.
- **Multi-database routing key support in the factory signature.** Routing to specific ZeroKMS datasets / key-ids is determined at runtime by the codec, not at migration time. The factory's job is purely the EQL-side config row install.

# Acceptance Criteria

## Factory shape

- [ ] **AC-FACT1**: `addSearchConfig({ table, column, equality, freeTextSearch })` returns a readonly array of `Op` shapes (one per enabled flag).
- [ ] **AC-FACT2**: `addSearchConfig({ table, column })` (no flags enabled) returns an empty array.
- [ ] **AC-FACT3**: Each returned op has `operationClass: 'additive'` and a deterministic id of the form `cipherstash.eql.add_search_config.<table>.<column>.<index_name>`.
- [ ] **AC-FACT4**: `activatePendingSearches()` returns one `Op` with `operationClass: 'additive'` and id `cipherstash.eql.activate_pending_searches`.

## SQL shapes

- [ ] **AC-SQL1**: Op `execute` SQL for `equality: true` is exactly `SELECT eql_v2.add_search_config('<table>', '<column>', 'unique', 'text')` (string-quote-escaped per first-attempt's `quoteSqlString` helper).
- [ ] **AC-SQL2**: Op `execute` SQL for `freeTextSearch: true` uses `'match'` as the index name.
- [ ] **AC-SQL3**: Op `precheck` SQL probes `cs_configuration_v2.data` JSONB to short-circuit when the mode is already configured.
- [ ] **AC-SQL4**: Op `postcheck` SQL confirms the mode is now configured.

## Migration integration

- [ ] **AC-MIG1**: A `migration.ts` calling `addSearchConfig({ table: 'user', column: 'email', equality: true })` followed by `activatePendingSearches()`, wrapped via `rawSql(...)`, produces a valid migration plan.
- [ ] **AC-MIG2**: The plan applies cleanly against a fresh Postgres database with EQL installed: `cs_configuration_v2` ends with one row for `(user, email)` with `'unique'` index in `'active'` state.
- [ ] **AC-MIG3**: Re-applying the same migration is a no-op (every op's precheck short-circuits; integration test asserts no errors).
- [ ] **AC-MIG4**: A migration combining cipherstash factory ops with standard `rawSql(...)` ops (e.g. a `CREATE INDEX` for an unrelated column) plans and applies correctly.

## End-to-end

- [ ] **AC-E2E1**: Round-trip integration test (the umbrella's `AC-UMB1` scenario):
  1. `dbInit` creates the table; EQL extension is installed via `databaseDependencies.init`.
  2. Hand-authored `migration.ts` invokes `addSearchConfig({ table: 'user', column: 'email', equality: true, freeTextSearch: true })` + `activatePendingSearches()`, wrapped via `rawSql`.
  3. Migration applies successfully.
  4. Subsequent `findMany({ where: { email: { equals: 'x' } } })` and `findMany({ where: { email: { contains: 'foo' } } })` queries work end-to-end.

# Other Considerations

## Security

EQL config rows in `cs_configuration_v2` reveal which `(table, column)` pairs are encrypted-and-searchable. That's metadata an attacker with database access can already infer from column types — it's not a new disclosure surface. The factories don't store any cryptographic material in `cs_configuration_v2`; keys live in ZeroKMS, ciphertexts live in the column itself.

## Cost

Migration-time only — no runtime cost. EQL function calls are O(1) inserts into a small config table.

## Observability

Migration ops use the standard precheck/execute/postcheck pattern, so the existing migration-runner observability (op-level timings, postcheck failure reporting) applies without bespoke instrumentation.

## Data Protection

Not applicable — these factories install search configuration only; data encryption is the codec's concern.

# References

- [Umbrella spec](../spec.md)
- [envelope-codec-extension task spec](envelope-codec-extension.spec.md) — defines the codec these search modes apply to.
- [psl-encrypted-string-constructor task spec](psl-encrypted-string-constructor.spec.md) — defines the authoring surface that produces `typeParams` matching the modes this factory installs.
- [First-attempt `database-dependencies.ts`](../../../reference/cipherstash/stack/packages/stack/src/prisma/core/database-dependencies.ts) — the canonical EQL operation SQL shapes are lifted from this file.
- [Postgres `rawSql` factory](../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/raw.ts) — the escape hatch this spec rides on.
- [Postgres `RawSqlCall` IR + `classifyCall`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts) — establishes the lifted-op classification path (`objectType: 'type'` → `'dep'` bucket).
- [`DataTransformOperation` shape](../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts) — for context on what Project 1 explicitly does **not** consume.

# Open Questions

1. **EQL `activate_pending_searches` exact function name.** Defer to the first-attempt repo's canonical name (the lift-from file is `database-dependencies.ts`). Some EQL versions expose it as a different SQL function — confirm against the version of EQL the bundled install ships.
2. **`addSearchConfig` factory return type — array vs single op.** Returning an array forces users to spread/map at the call site (`...addSearchConfig({...}).map(rawSql)`). Alternative: return a *grouped* op (single `Op` whose `execute` is multiple SQL statements). Default: array, because per-mode op ids are useful for diff stability and per-mode preflight short-circuiting. Confirm.
3. **Should the factory take a contract argument for invariant-aware routing?** PR #404's `DataTransformOperation` does. `rawSql({...})` ops don't — they're treated as path-dependent and not referenceable from refs (per the `invariantId` field's docstring). For Project 1 this is fine; in Project 2 if the planner wants to compose these ops with refs, they may need to migrate to `DataTransformOperation` shape. Not a Project 1 concern.
4. **Future flag naming alignment.** Project 2 will add `orderAndRange` (→ EQL `'ore'`) and `searchableJson` (→ EQL `'ste_vec'`). Should the public flag names match EQL's internal names exactly (`ore`, `ste_vec`, `unique`, `match`) — abandoning the human-friendly aliases — for consistency? Default: keep the friendly names; the mapping is internal and the public API benefits from being self-documenting (`equality` and `freeTextSearch` are immediately understood; `unique` and `match` are not). Worth flagging because there's a real tension between the surface and the wire format.
