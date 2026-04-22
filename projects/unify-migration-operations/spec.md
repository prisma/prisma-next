# Spec — Unify data transforms with regular migration operations

## Decision

Lower data-transform operations into the standard `MigrationPlanOperation` shape (`{ precheck, execute, postcheck }`) at factory time, and delete the dedicated runner branch that handles them today. Postgres-only; ~200 LOC net deletion. The user-facing `ctx.dataTransform({ name, check, run })` API does not change.

## Grounding example

A user-authored data transform — backfill `users.email` so a NOT-NULL constraint can land:

```ts
ctx.dataTransform({
  name: 'backfill_users_email',
  check: () => ctx.db.users.find({ where: { email: { isNull: true } } }),
  run:   () => ctx.db.users.update({
    where: { email: { isNull: true } },
    data:  { email: 'n/a' },
  }),
});
```

After verify-time lowering, this lands in `ops.json` today as:

```json
{
  "id": "data_migration.backfill_users_email",
  "label": "Data transform: backfill_users_email",
  "operationClass": "data",
  "name": "backfill_users_email",
  "source": "…/migration.ts",
  "check": { "sql": "SELECT 1 FROM users WHERE email IS NULL", "params": [] },
  "run":   [{ "sql": "UPDATE users SET email = $1 WHERE email IS NULL", "params": ["n/a"] }]
}
```

The Postgres runner sees `operationClass: "data"`, takes a [dedicated branch](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) (`runner.ts:206–217`), and dispatches into a 70-line `executeDataTransform` method (`runner.ts:279–343`) that hand-rolls a check → skip-or-run → check lifecycle.

Under this proposal, the same authoring lowers into the standard shape at the factory:

```json
{
  "id": "data_migration.backfill_users_email",
  "label": "Data transform: backfill_users_email",
  "operationClass": "widening",
  "name": "backfill_users_email",
  "source": "…/migration.ts",
  "precheck": [],
  "execute": [
    { "sql": "UPDATE users SET email = $1 WHERE email IS NULL",
      "params": ["n/a"],
      "description": "Run backfill_users_email" }
  ],
  "postcheck": [
    { "sql": "SELECT NOT EXISTS (SELECT 1 FROM users WHERE email IS NULL) AS ok",
      "description": "Check backfill_users_email",
      "meta": { "kind": "dtCheck", "name": "backfill_users_email" } }
  ]
}
```

The runner now treats this op identically to a DDL op. The dispatch branch, the `executeDataTransform` method, and the `isDataTransformOperation` type guard all delete.

## Why this works

The runner's existing op loop already supplies what data transforms need; the dedicated branch only exists because the data-transform op shape doesn't *look* like a regular op. Three apparent semantic differences turn out to collapse:

**1. Idempotency-skip.** A regular DDL op skips when its postcheck is already satisfied (truthy first cell). A data transform skips when its check returns no violation rows. These are the same predicate viewed from opposite directions: wrap the violation query in `SELECT NOT EXISTS (<check.sql>) AS ok` and the truthy-cell semantics fall out exactly. The runner's existing postcheck-pre-satisfied-skip branch then handles "skip when already done" for free.

**2. Post-execute validation.** A regular DDL op runs its postcheck after execute and fails on falsy. A data transform re-runs its check after run and fails on non-empty result. Same wrapper, same code path.

**3. Step payload.** Data-transform "steps" carry `params` for driver binding; DDL steps don't. This is purely a structural difference: extending `SqlMigrationPlanOperationStep` with an optional `params?: readonly unknown[]` field is mechanical and backward-compatible. Existing DDL steps with no params keep working.

The boolean-literal sentinels on the data-transform `check` (`true` = always skip; `false` = always run) lower trivially: `check === true` becomes an op with empty `execute` and empty `postcheck` (a no-op that the ledger still records as completed); `check === false` becomes an op with the run steps and an empty `postcheck` (always run, no validation).

That's the whole trick. Once the lowering produces a unified shape, the runner branch has no reason to exist.

## What changes

### `SqlMigrationPlanOperationStep` gains an optional `params` field

```ts
interface SqlMigrationPlanOperationStep {
  readonly sql: string;
  readonly params?: readonly unknown[]; // NEW
  readonly description: string;
  readonly meta?: Record<string, unknown>;
}
```

`runExecuteSteps` and `runExpectationSteps` change to call `driver.query(step.sql, step.params ?? [])`. No call site needs to opt in unless it has params to pass.

### `createDataTransform` emits the unified shape

| Today's DT field | Lowered into |
|---|---|
| `run: SerializedQueryPlan[]` | `execute: Step[]`, each step carries `sql` + `params` from the plan |
| `check: SerializedQueryPlan` | `postcheck: [{ sql: 'SELECT NOT EXISTS (${check.sql}) AS ok', params: check.params, description, meta: { kind: 'dtCheck', name } }]` |
| `check === true` | `execute: []`, `postcheck: []` (no-op; ledger records completion) |
| `check === false` | `execute: <run lowered>`, `postcheck: []` (always run, no validation) |
| `check === null` | draft state; should never reach the runner |
| (no precheck on DT) | `precheck: []` |

### Runner deletions

- `isDataTransformOperation` type guard — `runner.ts:50–60`.
- The `operationClass === 'data'` dispatch — `runner.ts:206–217`.
- The `executeDataTransform` method — `runner.ts:279–343`.

### `DataTransformOperation` collapses

The interface either deletes outright or reduces to a transitional `type DataTransformOperation = MigrationPlanOperation` alias. The fields it added (`name`, `source`) become optional fields on the base `MigrationPlanOperation` so the ledger can still read them.

### Ledger keys on `name`, not `operationClass`

The ledger today records data-transform invariants by checking `operationClass === 'data'` and reading `op.name`. After unification it checks for the presence of `op.name` (or, equivalently, a `meta.kind === 'dtCheck'` marker on a postcheck step). This is a one-call-site change.

### `operationClass: 'data'` disposition

Removed from the `MigrationOperationClass` enum. A unified data-transform op carries the class of the surrounding schema change (`'widening'` for a backfill during a NOT-NULL tightening, `'destructive'` for an enum-value removal, etc.) — which is already how `DataTransformCall.operationClass` works in the class-flow IR ([op-factory-call.test.ts:74–82](../../packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts)). This aligns with the established direction.

## Execution

Single PR, three commits:

1. **Add `params` to `Step` and thread through `driver.query`.** Pure plumbing, no behaviour change.
2. **Lower `createDataTransform` to the unified shape.** Data transforms now emit `precheck`/`execute`/`postcheck` ops. `DataTransformOperation` becomes a transitional alias. Existing tests should still pass because the runner's special-case still matches the new shape (it dispatches on `operationClass === 'data'`, which the lowered op still carries until step 3).
3. **Delete the runner branch and `operationClass: 'data'`.** Update the ledger key. `DataTransformOperation` deletes. `MigrationOperationClass` loses `'data'`.

`ops.json` shape changes between today and post-PR. Coordinate with whatever schema-versioning approach `ops.json` already uses; if there isn't one, this is a forcing function to introduce a `schemaVersion` field. Re-emit fixtures as part of the PR.

Estimate: 2–3 days, including test re-baselines and the `ops.json` migration tactic.

## Acceptance criteria

- The Postgres runner has a single execution loop. `isDataTransformOperation`, the `operationClass === 'data'` branch, and `executeDataTransform` are deleted.
- A data transform with a real check query produces a `postcheck` step wrapped in `SELECT NOT EXISTS (…)`. Running the migration twice still skips the second time.
- A data transform with `check === true` produces a no-op operation that the ledger records as completed on first apply.
- A data transform with `check === false` always runs and never skips, regardless of the runner's idempotency setting.
- `MigrationOperationClass` no longer contains `'data'`. The ledger records data-transform invariant names without inspecting `operationClass`.
- `SqlMigrationPlanOperationStep.params` is threaded through `driver.query` on every step execution path.
- All existing Postgres migration tests pass: unit (`packages/3-targets/3-targets/postgres/test/migrations/`), integration (`test/integration/`), and e2e (`test/e2e/`). The data-transform e2e ([data-transform.e2e.test.ts](../../test/integration/test/cli-journeys/data-transform.e2e.test.ts)) is the primary canary.
- `ops.json` files emitted by the new pipeline can be applied successfully; old `ops.json` files are either re-emitted or read through a migration adapter.

## Non-goals

- **Mongo.** Mongo has the same dispatch-branch shape but its "query" is a command document, not parameterized SQL — `Step.params` doesn't translate. Mongo unification is a parallel project; this spec is Postgres-only.
- **DDL parameterization.** Today's planner inlines user-provided values (column defaults, CHECK expressions, partial-index predicates, enum labels) via per-call-site escape helpers. The infrastructure introduced here (`Step.params`) makes parameterizing those sites possible, but doing so is a separate, larger project (see Alternatives). This spec only uses `params` for data-transform lowering.
- **Authoring API changes.** `ctx.dataTransform({ name, check, run })` stays exactly as-is.
- **Query-builder changes.** The query builder already produces `SerializedQueryPlan`; only `createDataTransform` (the consumer) changes.
- **Step-ordering changes.** Data transforms run in the same position within an edge as they do today. Only the runner's dispatch is collapsed.
- **`migration.json` (attestation) format.** Only `ops.json` is touched.

## Open questions

1. **`ops.json` schema versioning.** Does the codebase already stamp a `schemaVersion` on emitted `ops.json`? If yes, this PR bumps it. If no, this PR introduces it (one-line field on the envelope; runner refuses unknown values). Default: introduce here.
2. **`check === true` ledger semantics.** `check === true` lowers to an op with empty execute and empty postcheck. The ledger's data-transform-invariant recording must still fire on first apply (so that a future `require(name)` resolves), even though nothing runs. Verify during step 2 that this works without special-casing in the ledger.

## Alternatives considered

### Inline values everywhere; drop `Step.params`

Don't extend `Step` at all. Instead, lower data transforms by string-interpolating their query-builder values into the SQL at verify time, the same way DDL today inlines user values. Result: a single uniform shape (`{ sql, description }`) for every step.

Rejected because: requires a per-driver literal serializer that handles every type the query builder produces (`Buffer`, `Date`, `string[]`, JSON, enums, plus driver-specific shapes like `inet` and `tsvector`), and that serializer must produce byte-equivalent output to the driver's parameter binder. A mismatch is a silent data-corruption bug. Reusing the driver's binder is strictly safer.

### Parameterize DDL too; drive escape helpers out of the planner

The infrastructure `Step.params` introduces is reusable: planner sites that today inline user-provided values (`SetDefaultCall`, `AddCheckConstraintCall`, partial-index predicates, generated-column expressions) could migrate to parameter binding where Postgres supports it. This collapses the diffuse escape-bug surface in the planner into the driver's well-tested binder.

Rejected from this spec's scope because: it's a separate project. Each migrated DDL site is an audit + integration test pinning the rendered SQL, easily a few days each. There's no semantic linkage to the data-transform unification — `Step.params` is a prerequisite this spec already provides, but the migration of DDL sites should be planned and reviewed independently.

Worth filing as a follow-up spec. The unification PR makes it strictly cheaper to land.

### Keep the runner branch; only deduplicate the helpers

A minimal-churn alternative: leave `DataTransformOperation` and the dispatch branch, but extract the shared parts of `executeDataTransform` (error mapping, idempotency check) into helpers reused by the main loop.

Rejected because: it's the kind of refactor that adds abstraction without removing complexity. The runner still has two execution paths; readers still have to learn both. The "data is special" mental model persists. The whole point is to remove the branch, not polish it.

### Move data transforms entirely outside the migration runner

Treat data transforms as a separate pre/post hook that runs around the migration runner, not as operations within it. Each transform becomes its own ledger-tracked event with its own apply lifecycle.

Rejected because: data transforms are step-ordered with the surrounding DDL (a backfill must run between `addColumn(nullable)` and `setNotNull`). Pulling them out of the operation list either loses that ordering or requires re-implementing it in a parallel system. The current model — operations execute in order, some happen to be data transforms — is structurally correct; only the dispatch is wrong.

## References

- Runner branch and helper: [packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) — `isDataTransformOperation` at 50–60, dispatch at 206–217, `executeDataTransform` at 279–343.
- Type definitions: [packages/1-framework/1-core/framework-components/src/control-migration-types.ts](../../packages/1-framework/1-core/framework-components/src/control-migration-types.ts) — `MigrationOperationClass` at 28, `DataTransformOperation` at 57–84, `MigrationPlanOperation` at 111–118.
- Data-transform factory: [packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts](../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts).
- Class-flow IR precedent (`operationClass` already decoupled from runner dispatch): [packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts:74–82](../../packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts).
- Origin context: this spec emerged from PR 2 review of `projects/postgres-class-flow-migrations/` — specifically the observation that `DataTransformCall.operationClass` is caller-supplied (`'widening'`, `'destructive'`, etc.), proving that `'data'` is not load-bearing as a runner-dispatch key.
- Mongo counterpart (out of scope): [packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts](../../packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts).
