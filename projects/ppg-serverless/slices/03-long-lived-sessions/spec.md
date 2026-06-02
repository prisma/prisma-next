# Slice: Driver runtime — long-lived sessions + transactions

_Parent project: [`projects/ppg-serverless/`](../../). Outcome this slice contributes: `acquireConnection()` returns a real `SqlConnection` backed by a long-lived PPG session; `beginTransaction()` issues `BEGIN`/`COMMIT`/`ROLLBACK` on that session. Combined with Slice 2's one-shot paths, this closes the data-plane surface — Slice 5 then wires it into the facade, Slice 6 validates end-to-end against `@prisma/dev`._

## At a glance

Replace `acquireConnection()`'s "not yet implemented" body with a real implementation: open one PPG `client.newSession()` and return a `SqlConnection` whose `execute`/`query`/`executePrepared` route through that single session for its lifetime. `release()` and `destroy(reason)` close the session. `beginTransaction()` issues `BEGIN` on the session and returns a `SqlTransaction` whose `commit()`/`rollback()` issue `COMMIT`/`ROLLBACK` on the same session. To avoid duplicating Slice 2's session-running code three ways, factor an abstract `PpgServerlessQueryable` base inside `ppg-driver.ts` that owns the SqlQueryable contract (`execute`/`executePrepared`/`query`) and delegates session acquisition through an `acquireSession()` / `releaseSession()` hook. Each of the three queryable kinds — bound driver (one-shot session per call), connection (held session, no-op release), transaction (held session, no-op release) — provides its own hook.

## Chosen design

### Inheritance shape

```text
abstract class PpgServerlessQueryable implements SqlQueryable {
  protected abstract acquireSession(): Promise<Session>
  protected abstract releaseSession(session: Session): Promise<void>

  // concrete (use acquire/release):
  execute(req)         // open → run → stream rows → close (in finally)
  executePrepared(req) // alias to execute (D2)
  query(sql, params)   // open → run → collect rows → close (in finally)
}

class PpgServerlessBoundDriverImpl extends PpgServerlessQueryable {
  // acquireSession: client.newSession()         (one new session per call)
  // releaseSession: session.close()             (close at end of call)
  // plus: connect/acquireConnection/close/state
}

class PpgServerlessSessionConnection extends PpgServerlessQueryable {
  // acquireSession: returns this.#session       (the held one)
  // releaseSession: no-op
  // plus: beginTransaction / release / destroy
}

class PpgServerlessSessionTransaction extends PpgServerlessQueryable {
  // acquireSession: returns this.#session       (same as connection)
  // releaseSession: no-op
  // plus: commit / rollback
}
```

Transaction does **not** extend Connection — mirrors `driver-postgres` where both extend `PostgresQueryable` directly. Cleaner separation of capabilities (commit/rollback on transaction; release/destroy on connection).

### Connection / Transaction class details

`PpgServerlessSessionConnection`:

```ts
class PpgServerlessSessionConnection extends PpgServerlessQueryable implements SqlConnection {
  readonly #session: Session;
  #released = false;

  constructor(session: Session) {
    super();
    this.#session = session;
  }

  protected override acquireSession(): Promise<Session> {
    if (this.#released) {
      throw driverError('DRIVER.CONNECTION_RELEASED', RELEASED_MESSAGE);
    }
    return Promise.resolve(this.#session);
  }

  protected override releaseSession(_session: Session): Promise<void> {
    return Promise.resolve();
  }

  async beginTransaction(): Promise<SqlTransaction> {
    if (this.#released) {
      throw driverError('DRIVER.CONNECTION_RELEASED', RELEASED_MESSAGE);
    }
    try {
      await this.#session.query('BEGIN');
    } catch (err) {
      throw normalizePpgError(err);
    }
    return new PpgServerlessSessionTransaction(this.#session);
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    this.#session.close();
  }

  async destroy(reason?: unknown): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    // PPG's `Session.close()` is synchronous; no failure mode beyond what
    // close() itself surfaces. The `reason` argument is advisory per the
    // SqlConnection contract — informational only, not rethrown.
    this.#session.close();
  }
}
```

`PpgServerlessSessionTransaction`:

```ts
class PpgServerlessSessionTransaction extends PpgServerlessQueryable implements SqlTransaction {
  readonly #session: Session;

  constructor(session: Session) {
    super();
    this.#session = session;
  }

  protected override acquireSession(): Promise<Session> {
    return Promise.resolve(this.#session);
  }

  protected override releaseSession(_session: Session): Promise<void> {
    return Promise.resolve();
  }

  async commit(): Promise<void> {
    try {
      await this.#session.query('COMMIT');
    } catch (err) {
      throw normalizePpgError(err);
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.#session.query('ROLLBACK');
    } catch (err) {
      throw normalizePpgError(err);
    }
  }
}
```

### Bound impl: `acquireConnection()` body

```ts
async acquireConnection(): Promise<SqlConnection> {
  if (this.#closed) {
    throw driverError('DRIVER.CLOSED', CLOSED_MESSAGE);
  }
  const session = await this.#client.newSession();
  return new PpgServerlessSessionConnection(session);
}
```

The old "not implemented" error message is removed.

### `PpgServerlessQueryable` execute/query/executePrepared bodies

Distilled from Slice 2's `PpgServerlessBoundDriverImpl` — same logic, but now using the abstract `acquireSession` / `releaseSession` hooks:

```ts
async *execute<Row>({ sql, params }: SqlExecuteRequest): AsyncIterable<Row> {
  const session = await this.acquireSession();
  try {
    const resultset = await session.query(sql, ...(params ?? []));
    for await (const ppgRow of resultset.rows) {
      yield mapRowToRecord<Row>(ppgRow, resultset.columns);
    }
  } catch (err) {
    throw normalizePpgError(err);
  } finally {
    await this.releaseSession(session);
  }
}
```

`executePrepared` aliases `execute`. `query` similar but calls `await resultset.rows.collect()`.

### Concurrency semantics

PPG `Session` is a single-threaded resource (one query at a time). Our `SqlConnection` and `SqlTransaction` inherit that property: callers running `execute` and `query` in parallel against the same connection trigger PPG-level errors. We mirror the postgres-driver behaviour (no extra mutex around it) — surfacing the underlying constraint to the caller. The reviewer should not be surprised by this; the bound impl already had this property implicitly (one-shot sessions are trivially serial).

### Open scope details

| Decision | Resolution |
|---|---|
| Where does the `PpgServerlessQueryable` abstract live? | Same file, `ppg-driver.ts`. Not exported. Slice 5's facade only needs the concrete classes + binding type. |
| Does `Transaction` extend `Connection`? | No — both extend `Queryable` directly (matches postgres pattern). Avoids inheriting `release`/`destroy`/`beginTransaction` semantics into the transaction. |
| Connection's `#session` ownership on `release()` vs `destroy()`. | Both close the session. PPG's `session.close()` is synchronous and has no "this was a clean release" vs "this was a forced eviction" semantic difference (unlike pg-pool). The `reason` argument is captured for symmetry with the SqlConnection contract but informational only — not rethrown, not used to influence behaviour. |
| Double `release()` / `release()` after `destroy()` semantics. | Guard with a `#released` flag; subsequent calls are no-ops. SqlConnection contract says "Calling destroy() or release() more than once after a successful teardown is caller error and behaves as the underlying primitive dictates" — for us, "no-op" is the kind interpretation. |
| Behaviour after `release()`: subsequent `execute`/`query`/`executePrepared` calls? | `acquireSession()` throws `DRIVER.CONNECTION_RELEASED`. The async-iterable surface needs to yield the error on iterator start — use the same `throwingAsyncIterable` helper Slice 2 introduced for the bound impl's `#closed` case. |
| Bound driver's `close()` does not auto-close sessions the caller acquired but didn't release. | Mirrors postgres-driver semantics — caller-owned acquired connections are caller's responsibility. The bound driver's `#closed` flag prevents NEW acquires; existing held sessions stay alive until the caller calls `release()` or `destroy()`. |

### Module structure delta

```
packages/3-targets/7-drivers/ppg-serverless/src/
├── core/
│   ├── descriptor-meta.ts
│   └── row-mapper.ts                     # unchanged from Slice 2
├── exports/
│   └── runtime.ts                        # unchanged — the wrapper already routes acquireConnection
├── ppg-driver.ts                         # major refactor: abstract base + 2 new classes + updated bound impl
└── normalize-error.ts                    # unchanged from Slice 2
```

No new files in `src/`. No new architecture-config entries needed.

### Test surface

Two new files in `test/`:

- `driver.connection.test.ts` — `acquireConnection` returns a connection that round-trips `execute`/`query`/`executePrepared` through the held session (verified by call-count probes on `_fakes.ts`'s fake client: `newSession` called exactly once per `acquireConnection`; subsequent execute calls reuse the same session). `release()` closes the session. `destroy(reason)` closes the session; reason is captured (or ignored — TBD per Open Question). Subsequent calls on a released connection throw `DRIVER.CONNECTION_RELEASED`. Double-release is a no-op.
- `driver.transaction.test.ts` — `beginTransaction()` issues `BEGIN` on the session (verified by query-history probe). The returned transaction's `execute`/`query`/`executePrepared` route through the same session. `commit()` issues `COMMIT`; `rollback()` issues `ROLLBACK`. Failed commit (PPG `DatabaseError`) surfaces as a normalised `SqlQueryError`. Transaction operations after `commit`/`rollback` aren't forbidden at the transaction level — but the underlying session may reject; we let PPG surface that.

Plus extend `test/_fakes.ts` with: `Session` mock now tracks query history (`sessionQueryHistory`), `active` flag, `closeCount`; `Client.newSessionCalls` already tracks `newSession()` invocations from Slice 2.

## Coherence rationale

Long-lived session + transaction surface is one PR-shaped unit. The connection class and the transaction class can't ship without each other (`beginTransaction` returns a transaction, so the connection class references the transaction class), and the refactor that lets them share execute/query/executePrepared logic with the bound impl is the substrate for both. Splitting (e.g. "ship connection now, transaction next slice") would leave `beginTransaction` returning a stub for a slice's lifetime — a half-implemented seam that downstream code (Slice 5's facade) couldn't wire against. One reviewer holds the coherence: "long-lived session + transactions work; the refactor doesn't regress Slice 2's behaviour."

## Scope

**In:**

- `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` — major refactor: introduce `PpgServerlessQueryable` abstract base; move `execute`/`executePrepared`/`query` bodies onto it; update `PpgServerlessBoundDriverImpl` to provide one-shot `acquireSession`/`releaseSession` hooks; add `PpgServerlessSessionConnection` and `PpgServerlessSessionTransaction` classes; replace `acquireConnection()` body with the real implementation; remove `NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE` constant.
- `packages/3-targets/7-drivers/ppg-serverless/test/driver.connection.test.ts` — new test file (~10–14 tests).
- `packages/3-targets/7-drivers/ppg-serverless/test/driver.transaction.test.ts` — new test file (~8–10 tests).
- `packages/3-targets/7-drivers/ppg-serverless/test/_fakes.ts` — extended to track session query-history + close count.

**Out:**

- `explain()` on the abstract base. Still optional; out per Slice 2's resolution.
- Connection-pool layer on top of PPG. PPG handles wire-side pooling; we don't add another layer.
- The "destroyed-driver auto-evicts its acquired connections" pattern that pg-pool needs. PPG sessions are independent of the client; the bound driver's `close()` doesn't affect held connections (this matches postgres-driver's pool-mode behaviour, where the pool stays usable as long as some clients reference it).
- Integration tests against real PPG. Slice 6.
- Facade wiring. Slice 5.
- README polish. Slice 6.
- Changing `PpgServerlessBoundDriverImpl`'s public surface — the class name, the `state` getter shape, the constructor signature, and the `close()` semantics stay identical. Slice 5's facade compiles against the same surface.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| PPG's `Session.active: boolean` flag — should we use it to short-circuit on dead sessions? | No. Use our `#released` flag for explicit state. PPG may flip `active` due to wire-side closure, but our SqlConnection contract is about caller-visible state. If PPG's session is dead under the hood, the next `session.query()` will error and `normalizePpgError` will surface a `SqlConnectionError`. | We don't second-guess PPG. |
| `release()` after `destroy()` — should it be a no-op or error? | No-op. The SqlConnection contract is permissive about double-teardown ("behaves as the underlying primitive dictates"); for us the underlying primitive is a sync `session.close()` and a `#released` boolean — both already-true on the second call means nothing to do. | Mirrors postgres-driver's tolerant teardown. |
| Test mock for `session.query('BEGIN' \| 'COMMIT' \| 'ROLLBACK')` — does PPG actually return a `Resultset` for transaction commands? | Yes — PPG's `session.query` is a uniform interface; the resultset will have `columns: []` and `rows.collect()` returning `[]`. Mock the fake `Session.query` to return an empty resultset for any SQL starting with `BEGIN`/`COMMIT`/`ROLLBACK`. | Verify behaviour by reading PPG's `dist/index.js` `Session.query` if uncertain. |
| Concurrent `execute` on the same connection. | Caller error. Not guarded at the driver layer. PPG's session is single-threaded; concurrent calls will queue or fail at PPG's layer — surfaced verbatim to the caller. | Matches postgres-driver's no-mutex approach. |
| `beginTransaction()` called on a released connection. | Throws `DRIVER.CONNECTION_RELEASED` (same guard as `acquireSession` in the connection). |  |
| `commit()` called twice. | Second call surfaces PPG's `DatabaseError` (PostgreSQL responds with `25P01` "no active transaction") wrapped as `SqlQueryError`. Don't guard at the driver layer — let PPG surface the error. | Matches postgres-driver. |

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/driver-ppg-serverless test` passes the existing 45 tests (no regression from Slice 2) **plus** the new connection + transaction tests. Total expected: ~60–70 tests.
- [ ] `pnpm lint:deps` green (no new package dependencies introduced).

CI-green, reviewer-accept, project-DoD floor (no `pg`/`pg-cursor`/`@types/pg`; no bare `as` casts; no transient project IDs) are inherited and not restated.

## Open Questions

1. **Should the `Connection.destroy(reason)` argument propagate to any observable surface?** Working position: no — PPG's `session.close()` takes no argument, and the `reason` is purely advisory per the SqlConnection contract. We accept the arg for API parity but ignore it (informational metadata only — not logged, not rethrown, not influencing close behaviour). _Override: log it via some observability hook if downstream consumers need it._
2. **Naming: `PpgServerlessSessionConnection` vs `PpgServerlessConnection`?** Working position: `PpgServerlessSessionConnection` — distinguishes from "connection" in a pool sense (which doesn't apply to PPG). Slice-5 facade users see this class name when their connection type is inferred from `acquireConnection()`'s return. _Override: shorter name if you prefer._
3. **Should `Transaction.commit()` mark the underlying connection as in some "post-commit, can't reuse" state?** Working position: no — the SqlTransaction contract doesn't require it. The connection remains usable for more queries after commit (the caller can `beginTransaction` again). _Override: explicit single-use transaction semantics if downstream consumers expect that._

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md), [`projects/ppg-serverless/plan.md`](../../plan.md)
- Prior slices: [`projects/ppg-serverless/slices/01-driver-scaffold/spec.md`](../01-driver-scaffold/spec.md), [`projects/ppg-serverless/slices/02-driver-one-shot/spec.md`](../02-driver-one-shot/spec.md)
- Reference template (the abstract-base + connection/transaction subclasses pattern): [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts) lines 119–386 — `PostgresQueryable`, `PostgresConnectionImpl`, `PostgresTransactionImpl`.
- Reference tests: [`packages/3-targets/7-drivers/postgres/test/driver.connection.test.ts`](../../../../packages/3-targets/7-drivers/postgres/test/driver.connection.test.ts) (if it exists; otherwise mirror the `driver.basic.test.ts` style applied to connection/transaction surfaces).
- SqlDriver SPI: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts) — `SqlConnection`, `SqlTransaction`, `release`/`destroy` contract.
- `@prisma/ppg` `Session` interface: `node_modules/.pnpm/@prisma+ppg@1.0.1/node_modules/@prisma/ppg/dist/index.d.ts` — `Session extends Statements, Disposable`, `close(): void`, `active: boolean`.

## Adapter-impact section

Per `drive/spec/README.md`, slices touching `packages/3-targets/**` declare adapter impact.

**Adapters affected:** None. Driver-only refactor. The shared `postgres` adapter is unchanged.
