# Summary

Add a callback-based transaction API to the ORM client and SQL builder surfaces so users can execute multiple operations atomically within a single database transaction. The transaction commits on callback success and rolls back on error.

# Description

The ORM client (`db.orm`) and SQL builder (`db.sql`) currently execute each operation independently — there is no way for users to group multiple operations into an atomic unit. Transactions are used *internally* by the mutation executor for nested create/update mutations (`withMutationScope` in `mutation-executor.ts`), but this plumbing is not exposed to users.

Users need transactions for common patterns: transferring funds between accounts, creating an entity and its audit log atomically, or performing conditional updates that must not interleave with concurrent writes. Without a transaction API, users must either drop to raw SQL with manual `BEGIN`/`COMMIT` or accept the risk of partial writes.

The transaction API is a method on the target client (e.g., `PostgresClient`) that accepts a callback. The callback receives an object providing access to both the ORM client and the SQL builder, both bound to the same underlying database connection and transaction. If the callback completes successfully, the transaction commits. If the callback throws, the transaction rolls back and the error propagates to the caller.

# Before / After

## API surface

**Before** — no way to group operations atomically:

```typescript
const db = postgres<Contract, TypeMaps>({ contractJson, url });

// These execute on separate connections — not atomic
await db.orm.account.where({ id: fromId }).update({ balance: fromBalance - amount });
await db.orm.account.where({ id: toId }).update({ balance: toBalance + amount });
```

**After** — callback-based transaction:

```typescript
const db = postgres<Contract, TypeMaps>({ contractJson, url });

await db.transaction(async (tx) => {
  // Both operations execute on the same connection within a single transaction
  await tx.orm.account.where({ id: fromId }).update({ balance: fromBalance - amount });
  await tx.orm.account.where({ id: toId }).update({ balance: toBalance + amount });

  // SQL builder is also available, bound to the same transaction
  const plan = tx.sql.from(tables.auditLog).insert({ action: 'transfer', amount }).build();
  await tx.execute(plan);
});
// Transaction committed here. If any operation threw, everything rolled back.
```

# Requirements

## Functional Requirements

1. **`transaction` method on the target client.** `db.transaction(callback)` accepts an async callback and returns a `Promise` that resolves with the callback's return value on commit or rejects with the callback's error after rollback.

2. **Transaction context object.** The callback receives a transaction context (`tx`) that provides:
   - `tx.orm` — ORM client (same `Collection` API) bound to the transaction's connection.
   - `tx.sql` — SQL builder (`Db<TContract>`) bound to the transaction's connection.
   - `tx.execute(plan)` — executes a built query plan against the transaction's connection.

3. **Automatic lifecycle management.** The runtime acquires a connection, issues `BEGIN`, runs the callback, issues `COMMIT` on success or `ROLLBACK` on error, and releases the connection. Users never see `BEGIN`/`COMMIT`/`ROLLBACK`.

4. **Error propagation.** If the callback throws, the transaction rolls back and the original error is re-thrown to the caller. If `ROLLBACK` itself fails, the rollback error wraps or accompanies the original error.

5. **Return value forwarding.** `db.transaction(async (tx) => { ... return result; })` resolves to `result` after commit.

6. **ORM nested mutations within transactions.** When the ORM's mutation executor (`withMutationScope`) runs inside a transaction context, it must reuse the transaction's connection rather than acquiring a new one. This means the `RuntimeQueryable` passed to the ORM inside `tx.orm` must route through the transaction scope.

7. **Connection scoping.** The transaction holds a single connection for its duration. All `tx.orm` and `tx.sql` operations execute on that connection.

## Non-Functional Requirements

1. **No connection leaks.** If the callback hangs or the process crashes, the connection must be released (via `finally` semantics). The runtime must not accumulate unreleased connections from failed transactions.

2. **Type safety.** `tx.orm` must have the same collection types as `db.orm`. `tx.sql` must have the same table types as `db.sql`. `tx.execute` must accept the same plan types as the runtime's `execute`. The `transaction` method must be generic over the callback's return type.

3. **No nesting.** The transaction context must **not** expose `transaction` — calling `tx.transaction(...)` is a compile-time error (absent from the type) and, if bypassed, a runtime error.

## Non-goals

- **Isolation levels.** Default isolation level only (typically `READ COMMITTED` for Postgres). Configurable isolation is deferred.
- **Savepoints / nested transactions.** No `SAVEPOINT` support. Transactions do not nest.
- **Automatic retry on serialization failures.** No retry logic. Users who need retries wrap `transaction` in their own retry loop.
- **Interactive (explicit) transaction API.** No `db.begin()` returning a handle with `.commit()` / `.rollback()`. Callback-only.
- **Timeout / max duration.** No built-in transaction timeout. Deferred to a follow-up.
- **Document (Mongo) family.** SQL-only for now. Mongo transactions can follow the same pattern later.

# Acceptance Criteria

## Core API

- [x] `db.transaction(callback)` is callable on `PostgresClient` and returns `Promise<T>` where `T` is the callback's return value.
- [x] The callback receives a context object with `orm`, `sql`, and `execute` properties.
- [x] `tx.sql` has the same table proxy types as `db.sql`.
- [x] `tx.execute(plan)` executes a query plan against the transaction's connection.
- [x] `tx.orm` has the same collection types and API as `db.orm`.

## Lifecycle

- [x] A successful callback triggers `COMMIT` and the promise resolves with the return value.
- [x] A throwing callback triggers `ROLLBACK` and the promise rejects with the original error.
- [x] The connection is released after both commit and rollback paths.
- [x] Multiple sequential transactions can reuse connections from the pool without leaking.

## Atomicity

- [x] Two writes within `transaction` are both visible after commit (integration test against Postgres).
- [x] A throw after the first write rolls back all writes — neither is visible (integration test).

## ORM integration

- [x] ORM operations inside `transaction` (including nested mutation patterns like `create` with relation callbacks) execute on the transaction's connection, not a new one.
- [x] ORM reads inside `transaction` see writes made earlier in the same transaction.

## Type safety

- [x] `tx` does **not** have a `transaction` method (compile-time check via negative type test).
- [x] `db.transaction` infers the callback return type correctly (type-level test).

## Escaped result safety

- [x] An `AsyncIterableResult` created inside a transaction that is consumed after commit/rollback produces a clear error message.
- [x] `await db.transaction((tx) => tx.execute(plan))` drains eagerly via `PromiseLike` and returns `Row[]` (the safe common case).

## Edge cases

- [x] Calling `transaction` before `connect()` auto-connects lazily (same as `db.runtime()`).
- [x] If the callback returns without throwing but `COMMIT` fails, the promise rejects with the commit error.

# Other Considerations

## Security

No new security surface. Transactions use the same authenticated connection pool as regular queries. No user-supplied SQL is introduced.

## Observability

**Assumption:** Transaction begin/commit/rollback are logged through the existing runtime telemetry pipeline. No new telemetry events are added in this project — the existing `execute` telemetry captures individual statements, and the driver-level `BEGIN`/`COMMIT`/`ROLLBACK` commands flow through the same path.

## Cost

No cost impact. Transactions use the same connection pool. Holding a connection for the duration of the callback is inherent to the feature.

# References

- Existing internal transaction plumbing: `packages/3-extensions/sql-orm-client/src/mutation-executor.ts` (`withMutationScope`)
- Runtime transaction interfaces: `packages/2-sql/5-runtime/src/sql-runtime.ts` (`Runtime`, `RuntimeConnection`, `RuntimeTransaction`)
- Postgres driver implementation: `packages/3-targets/7-drivers/postgres/src/postgres-driver.ts` (`PostgresConnectionImpl`, `PostgresTransactionImpl`)
- Target client entry point: `packages/3-extensions/postgres/src/runtime/postgres.ts` (`PostgresClient`)
- ORM client factory: `packages/3-extensions/sql-orm-client/src/orm.ts` (`orm()`)
- SQL builder factory: `packages/2-sql/4-lanes/sql-builder/src/runtime/sql.ts` (`sql()`)
- [ADR 187 — Transaction-scoped streams use invalidation, not buffering](../../docs/architecture%20docs/adrs/ADR%20187%20-%20Transaction-scoped%20streams%20use%20invalidation%20not%20buffering.md)

# Open Questions

1. **~~Method name~~** — Resolved: `transaction` (not `$transaction`). Since the method lives on `db`, not on the ORM client directly, there is no model-name collision risk.

2. **~~Pre-connect behavior~~** — Resolved: auto-connects lazily, same as `db.runtime()`.

3. **~~Implementation location~~** — Resolved: reusable `withTransaction` helper in `sql-runtime` (`packages/2-sql/5-runtime/`). Target clients expose it as `db.transaction(...)` and can override with a custom implementation if needed.

4. **~~AsyncIterableResult leaking out of the callback~~** — Resolved: the transaction-scoped `RuntimeQueryable` is invalidated on commit/rollback. Any `AsyncIterableResult` consumed after the transaction ends produces a clear, actionable error. Direct returns are already safe because `AsyncIterableResult` implements `PromiseLike<Row[]>`, so `await` drains it. No eager buffering, no type gymnastics — `execute()` semantics stay consistent inside and outside transactions. See the Design Notes section below for the full analysis.

# Design Notes: AsyncIterableResult and transaction scope

## The safe case

`AsyncIterableResult<Row>` implements `PromiseLike<Row[]>` (see `packages/1-framework/4-runtime/runtime-executor/src/async-iterable-result.ts`). When the callback is `async` and returns an `AsyncIterableResult`, the implicit `await` on the return value triggers `.then()` → `.toArray()`, draining the iterator before the callback resolves. So the common pattern works correctly:

```typescript
// SAFE — PromiseLike drains via .then() before callback resolves
const posts = await db.transaction((tx) => tx.orm.posts.all());
```

Similarly, `await tx.execute(plan)` inside the callback drains eagerly via `PromiseLike`.

## The hazardous case

If the user wraps an unconsumed `AsyncIterableResult` in a return object, it escapes the transaction scope:

```typescript
const result = await db.transaction(async (tx) => {
  return {
    users: tx.execute(userPlan),  // AsyncIterableResult — not awaited
    posts: tx.execute(postPlan),  // AsyncIterableResult — not awaited
  };
});
// Transaction committed, connection released
for await (const user of result.users) { /* connection gone */ }
```

## Design decision: fail clearly on post-transaction reads

Rather than silently buffering all results or preventing this at the type level, the transaction context should **invalidate its connection scope on commit/rollback**. Any `AsyncIterableResult` created by `tx.execute()` that is consumed after the transaction ends should produce a clear, actionable error:

*"Cannot read from a query result after the transaction has ended. Await the result or call .toArray() inside the transaction callback."*

This approach:
- Keeps `execute()` semantics consistent inside and outside transactions (always lazy)
- Avoids silent behavioral differences (no hidden eager buffering)
- Produces a clear error at the point of misuse, not at commit time
- Does not require tracking created results or walking return values — the connection/transaction scope itself becomes invalid, and any attempt to pull rows through it fails

Implementation: the transaction-scoped `RuntimeQueryable` passed to `tx.execute()` can set an `invalidated` flag after commit/rollback. The underlying async generator checks this flag before each yield or on first pull.

## Postgres wire protocol and unconsumed result streams (resolved)

**Concern:** In the Rust tokio-postgres driver used by the previous Prisma engine, errors from the database (e.g. constraint violations) were only surfaced when reading from the result stream, because the connection must be explicitly polled. If this were a Postgres wire protocol issue, unconsumed streams could silently swallow query errors within a transaction.

**Finding — client-side error delivery:** This is a tokio-postgres architectural issue, not a wire protocol issue. The Postgres wire protocol is push-oriented — the server sends `ErrorResponse` immediately as part of its normal response sequence. In node-postgres (`pg`), the library attaches `stream.on('data', ...)` to the socket, so the event loop eagerly drains all server responses regardless of whether user code has consumed the result. Errors are routed to the active query immediately. Additionally, failed transaction state is tracked server-side — a subsequent `COMMIT` returns the command tag `ROLLBACK` if any statement has failed.

**Finding — cursor correctness analysis:** With cursors (DECLARE CURSOR + FETCH), execution is truly suspended server-side. Unfetched rows are never evaluated. This has implications:

- **DML (INSERT/UPDATE/DELETE) without RETURNING:** Does not use cursors. Executes fully and atomically. **No correctness issue.**
- **DML with RETURNING:** SQL `DECLARE CURSOR` is SELECT/VALUES-only. The current driver's cursor path does not apply to DML RETURNING. **No issue.**
- **Plain SELECT:** The server genuinely doesn't execute unfetched rows. A runtime error on row N+1 never occurs if you only FETCH N rows — the error condition was never evaluated. The transaction's writes are independent of SELECT consumption. **No correctness issue for committed data.**
- **SELECT with data-modifying CTEs (`WITH ... INSERT/UPDATE/DELETE`):** The DML substatements run to completion regardless of how much of the outer SELECT is consumed. **No issue.**
- **SELECT with side-effecting VOLATILE functions:** Partial consumption means some function calls never execute. The ORM/SQL builder does not generate these. **Not a concern for current API surface.**
- **SELECT ... FOR UPDATE:** Locks are acquired per-FETCH. Partial consumption means later qualifying rows are neither seen nor locked. However, SELECT FOR UPDATE is only useful if you read the results to act on them within the same transaction — if you don't consume the stream, you have nothing to update, so incomplete locking is a consequence of an already-broken application pattern, not something the transaction API needs to guard against.

**Conclusion:** For all current and foreseeable operations, there is no correctness issue with unconsumed cursor-based streams in transactions. Mutations always execute fully regardless of streaming. Unconsumed SELECTs mean unread data, not suppressed errors or incorrect commits.
