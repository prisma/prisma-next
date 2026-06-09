# Slice: session-bootstrap-primitive

Parent project: `projects/runtime-target-layer/`. Outcome: the family runtime can run a caller-supplied bootstrap (e.g. `SET LOCAL role`) on the exact connection a typed query then runs on, below the user middleware chain, inside an implicit transaction — the substrate `SupabaseRuntime` consumes in slice 3.

## At a glance

Add `protected executeWithSessionBootstrap(plan, bootstrap, options?)` to `SqlRuntime`. It opens an implicit transaction on a freshly-acquired connection, invokes `bootstrap` against that transaction's **raw** connection (issuing `SET LOCAL …` via `query()`, which never enters the middleware chain), then runs the typed query against the **same** transaction so the session state is in force, and commits / rolls back / releases with the same lifecycle discipline as the existing `withTransaction`.

```ts
// SqlRuntime (family layer). Illustrative — exact internal mechanics are the implementer's.
protected executeWithSessionBootstrap<Row>(
  plan: SqlQueryPlan<Row> | SqlExecutionPlan<Row>,
  bootstrap: (conn: RawSessionConnection) => Promise<void>,
  options?: RuntimeExecuteOptions,
): AsyncIterableResult<Row> {
  // acquire raw connection → begin raw transaction (sticky)
  // await bootstrap(rawSessionView(tx))         // SET LOCAL …, BELOW middleware
  // yield* this.executeAgainstQueryable(plan, tx, { ...options, scope: 'transaction' })  // middleware wraps THIS
  // commit on drain; rollback on throw/abort; release / destroy per withTransaction discipline
}
```

`RawSessionConnection` is a narrow view — only `query(sql, params)` — so the consumer can issue session SQL but cannot reach connection lifecycle methods (`release`/`destroy`/`beginTransaction`).

## Chosen design

**Layer: `SqlRuntime` (family), not `RuntimeCore`.** Confirmed by inspection — connection acquisition (`this.driver.acquireConnection()`), `executeAgainstQueryable`, `connection()`, and `wrapTransaction` all live on `SqlRuntime`; `RuntimeCore` has no connection concept. The Mongo family, when it needs this, adds its own primitive at the Mongo family layer (out of scope here).

**Mechanism (grounded in the existing code):**

1. `const conn = await this.driver.acquireConnection()` — the raw `SqlConnection` (driver-types.ts), *not* the public `RuntimeConnection` wrapper.
2. `const tx = await conn.beginTransaction()` — raw `SqlTransaction`.
3. `await bootstrap(view)` where `view` exposes `query(sql, params)` backed by `tx.query(...)`. `tx.query` is the raw driver call — it does **not** go through `executeAgainstQueryable`, so no user middleware, no codec pipeline, no telemetry sees it. This is the below-middleware guarantee, structural.
4. `yield* this.executeAgainstQueryable<Row>(plan, tx, { ...options, scope: 'transaction' })` — the typed query runs against the same `tx`. `executeAgainstQueryable` is a private method on this same class, so the new protected method calls it directly; middleware wraps this call as normal, but it runs on the connection the bootstrap already configured.
5. Lifecycle: commit after the row stream drains; on throw / abort, roll back; mirror `withTransaction`'s release-vs-destroy discipline exactly (destroy on failed rollback; the commit-failure → best-effort-rollback → destroy-on-failure path; `RUNTIME.TRANSACTION_ROLLBACK_FAILED` / `RUNTIME.TRANSACTION_COMMIT_FAILED` envelopes). Do not reinvent this — factor or reuse the existing logic so the two paths cannot drift.

**Streaming boundary (the one real subtlety).** The method returns an `AsyncIterableResult<Row>`; the transaction must stay open across stream consumption and commit only after the stream drains (rollback on error mid-stream). Wrap the `executeAgainstQueryable` generator in the commit/rollback/release try-finally, the same way `withTransaction` guards its stream. A `SET LOCAL` issued in step 3 persists for the transaction's lifetime and is reset by COMMIT/ROLLBACK before the connection returns to the pool — the pool-safety property.

**Role/claims do not appear here.** The primitive is target-agnostic and Supabase-agnostic: it knows nothing about roles, JWTs, or `SET LOCAL`. The *consumer* (slice 3) supplies a `bootstrap` closure that issues the role SQL. Nothing about role binding touches `RuntimeExecuteOptions` (which stays `{ signal?, scope? }`).

## Coherence rationale

One new protected method plus its unit tests, all in `@prisma-next/sql-runtime`. The method, the `RawSessionConnection` type, and the tests are one reviewable unit — a reviewer holds "below-middleware bootstrap on a sticky transaction, lifecycle-correct" in one sitting. No consumer yet (that's slice 3), so there is nothing to migrate and nothing else to touch.

## Scope

**In:** `executeWithSessionBootstrap` on `SqlRuntime`; the `RawSessionConnection` narrow type; reuse/refactor of the `withTransaction` lifecycle discipline so the two share one correct implementation; unit tests.

**Out:** `PostgresRuntime` / `SupabaseRuntime` / `supabase()` (slice 3); any `SET LOCAL` / role / JWT code; any change to `RuntimeExecuteOptions`; the public `Runtime` interface (the new method is `protected`, invisible to `Runtime` consumers); Mongo parity.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Bootstrap closure throws | Roll back, release/destroy, propagate — no query runs | Same discipline as a callback throw in `withTransaction`. |
| Error / abort mid-stream | Roll back; `SET LOCAL` discarded; connection released or destroyed per rollback success | The transaction must not commit on a partially-consumed erroring stream. |
| Commit fails | Best-effort rollback → destroy on rollback failure; `RUNTIME.TRANSACTION_COMMIT_FAILED` | Mirror `withTransaction` exactly; do not invent new semantics. |
| Nesting with the existing public `withTransaction` / `.transaction()` | Out of scope to support arbitrary nesting in this slice | Slice 3's `RoleBoundDb.transaction()` composition is specified there (project spec open question 3); this slice ships the single-execute primitive only. |

## Slice-specific done conditions

- [ ] Unit test: the connection the `bootstrap` closure receives is the **same** connection the subsequent typed query executes on (stickiness — assert connection identity, e.g. via a fake driver recording which connection each call hit).
- [ ] Unit test: a registered user middleware does **not** observe the bootstrap SQL — it sees only the typed query's `execute` (proves below-middleware).
- [ ] Unit test: bootstrap-throw and mid-stream-throw both roll back and release/destroy correctly (no commit; connection not leaked); commit-failure path matches `withTransaction`.
- [ ] `executeWithSessionBootstrap` is `protected` (not on the public `Runtime` interface); `RuntimeExecuteOptions` is unchanged.

## Open Questions

1. **Reuse vs duplicate the lifecycle.** Working position: factor the connection+transaction lifecycle (acquire → tx → commit/rollback/release/destroy) out of `withTransaction` into a shared internal helper the new primitive also uses, so correctness lives in one place. If the refactor proves invasive, an acceptable fallback is a faithfully-mirrored copy with a test asserting both paths handle the commit/rollback-failure envelopes identically — but prefer the shared helper.
2. **`RawSessionConnection` exact name/shape.** Working position: a narrow interface exposing only `query(sql: string, params?: readonly unknown[])`, a slice of `SqlQueryable`. Implementer may name it differently; the constraint is "no lifecycle methods leak to the bootstrap closure."

## References

- Parent project: `projects/runtime-target-layer/spec.md`
- Linear issue: [TML-2879](https://linear.app/prisma-company/issue/TML-2879)
- Code: `packages/2-sql/5-runtime/src/sql-runtime.ts` (`executeAgainstQueryable` ~L388, `connection`/`wrapTransaction` ~L609, `withTransaction` ~L756); `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts` (`SqlConnection`/`SqlTransaction`/`SqlQueryable`).
- Builds on slice 1 (TML-2878): the exported `SqlRuntime` class.
