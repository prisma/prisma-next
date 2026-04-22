# ORM Client Transaction API — Plan

## Summary

Add `db.transaction(callback)` to the target client (e.g., `PostgresClient`) so users can execute ORM and SQL builder operations atomically within a single database transaction. The callback receives a transaction context with `tx.orm`, `tx.sql`, and `tx.execute`, all bound to the same connection. Commit on success, rollback on throw. The implementation lives as a reusable `withTransaction` helper in `sql-runtime`, exposed by target clients.

**Spec:** `projects/orm-client-transaction-api/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Alexey | Drives execution |

## Milestones

### Milestone 1: Transaction runtime plumbing

Implement the core transaction lifecycle in `sql-runtime` and expose it on `PostgresClient`. No ORM integration yet — only `tx.execute(plan)` works at this stage.

**Tasks:**

- [ ] **1.1** Add `TransactionContext` interface and `withTransaction` helper to `sql-runtime` (`packages/2-sql/5-runtime/src/sql-runtime.ts`). The helper acquires a connection from the `Runtime`, calls `beginTransaction()`, runs the callback with a `RuntimeQueryable` scoped to the transaction, commits on success, rolls back on throw, and releases the connection in `finally`. Add an `invalidated` flag to the transaction-scoped queryable that is set after commit/rollback — any subsequent `execute()` call throws a clear error per ADR 187.
- [ ] **1.2** Export `TransactionContext`, `withTransaction`, and related types from `sql-runtime` exports (`packages/2-sql/5-runtime/src/exports/index.ts`). Also export `RuntimeConnection` and `RuntimeTransaction` interfaces which are currently internal.
- [ ] **1.3** Add `transaction<R>(fn: (tx: TransactionContext) => PromiseLike<R>): Promise<R>` to the `PostgresClient` interface and implementation (`packages/3-extensions/postgres/src/runtime/postgres.ts`). The implementation delegates to `withTransaction`, passing the runtime (lazy-initializing via `getRuntime()` like existing methods). `TransactionContext` exposes `execute` but NOT `transaction` (no nesting).
- [ ] **1.4** Wire `tx.sql` — create the `Db<TContract>` proxy bound to the transaction's execute. The SQL builder (`sql()` from `sql-builder`) is stateless and only needs an `ExecutionContext`; the transaction context provides `tx.execute(plan)` for running built plans. Expose `tx.sql` on the transaction context so users can build queries against the same table proxies.
- [ ] **1.5** Unit tests for `withTransaction` lifecycle: successful commit, rollback on throw, connection release on both paths, error propagation, return value forwarding, COMMIT failure propagation. Test the invalidation flag — `execute()` after commit/rollback throws with actionable message.
- [ ] **1.6** Integration test against Postgres: two INSERTs in a transaction are both visible after commit. A throw after the first INSERT rolls back both — neither is visible.

### Milestone 2: ORM integration

Wire `tx.orm` so ORM collections inside the transaction use the transaction's connection, and the mutation executor's `withMutationScope` reuses it instead of acquiring a new transaction.

**Tasks:**

- [ ] **2.1** Add `tx.orm` to `TransactionContext`. Create an ORM client (`orm()`) bound to the transaction's `RuntimeQueryable`. The key: the `RuntimeQueryable` passed to `orm()` must route `execute()` through the transaction scope and must NOT expose `connection()` or `transaction()` — when `withMutationScope` checks `typeof runtime.transaction === 'function'`, it must get `false` (or the method must be absent) so it uses the scope directly rather than starting a nested transaction.
- [ ] **2.2** Verify that `withMutationScope` in `mutation-executor.ts` correctly falls through to `acquireRuntimeScope` when the runtime has no `transaction` method — and that `acquireRuntimeScope` returns the transaction-scoped execute. Read the code paths and add a targeted unit test confirming nested creates within a transaction reuse the transaction scope.
- [ ] **2.3** Integration test: ORM `.create()` with nested relation mutations inside `db.transaction()` — verify all rows are created atomically and a throw rolls back everything including nested creates.
- [ ] **2.4** Integration test: ORM reads inside `transaction` see writes made earlier in the same transaction (read-your-own-writes within tx).

### Milestone 3: Type safety and edge cases

Ensure compile-time and runtime safety for the transaction API.

**Tasks:**

- [ ] **3.1** Type-level test using vitest `expectTypeOf`: `tx.orm` has the same collection types as `db.orm`. `tx.sql` has the same table proxy types as `db.sql`.
- [ ] **3.2** Negative type test using vitest `expectTypeOf`: `tx` does NOT have a `transaction` property. Use `expectTypeOf<typeof tx>().not.toHaveProperty('transaction')`.
- [ ] **3.3** Type-level test using vitest `expectTypeOf`: `db.transaction` correctly infers the callback return type — `db.transaction(async () => 42)` resolves to `Promise<number>`.
- [ ] **3.4** Test: `await db.transaction((tx) => tx.execute(plan))` drains eagerly via `PromiseLike` and returns `Row[]` (the safe common case — `AsyncIterableResult.then()` triggers `.toArray()`).
- [ ] **3.5** Test: `AsyncIterableResult` created inside a transaction, consumed after commit, produces a clear error message mentioning `.toArray()`.
- [ ] **3.6** Test: calling `db.transaction()` before explicit `connect()` auto-connects lazily.
- [ ] **3.7** Test: sequential `db.transaction()` calls reuse pooled connections without leaking.

### Milestone 4: Close-out

- [ ] **4.1** Verify all acceptance criteria from `projects/orm-client-transaction-api/spec.md` are met.
- [ ] **4.2** Ensure ADR 187 is finalized and accurate. Migrate any other long-lived docs into `docs/`.
- [ ] **4.3** Strip repo-wide references to `projects/orm-client-transaction-api/**` (replace with canonical `docs/` links or remove).
- [ ] **4.4** Delete `projects/orm-client-transaction-api/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `db.transaction(callback)` callable, returns `Promise<T>` | Unit + Type | 1.5, 3.3 | |
| Callback receives context with `orm`, `sql`, `execute` | Unit | 1.5, 2.1 | |
| `tx.orm` has same collection types as `db.orm` | Type | 3.1 | |
| `tx.sql` has same table proxy types as `db.sql` | Type | 3.1 | |
| `tx.execute(plan)` runs against transaction connection | Unit + Integration | 1.5, 1.6 | |
| Successful callback → COMMIT, promise resolves with return value | Unit + Integration | 1.5, 1.6 | |
| Throwing callback → ROLLBACK, promise rejects with original error | Unit + Integration | 1.5, 1.6 | |
| Connection released after commit and rollback | Unit | 1.5 | |
| Sequential transactions reuse pool without leaking | Integration | 3.7 | |
| Two writes visible after commit | Integration | 1.6 | |
| Throw after first write rolls back all writes | Integration | 1.6 | |
| ORM operations use transaction connection (including nested mutations) | Integration | 2.2, 2.3 | |
| ORM reads see earlier writes in same tx | Integration | 2.4 | |
| `tx` has no `transaction` method (compile-time) | Type (negative) | 3.2 | |
| `db.transaction` infers callback return type | Type | 3.3 | |
| Escaped `AsyncIterableResult` produces clear error | Unit | 3.5 | ADR 187 |
| `await db.transaction((tx) => tx.execute(plan))` drains via `PromiseLike` | Unit | 3.4 | |
| `transaction` before `connect()` auto-connects | Integration | 3.6 | |
| COMMIT failure → promise rejects | Unit | 1.5 | Mock commit to throw |

## Open Items

None — all spec open questions are resolved. See spec for resolved decisions and design notes.
