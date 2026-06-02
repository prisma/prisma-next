# Slice: Driver runtime — one-shot session calls

_Parent project: [`projects/ppg-serverless/`](../../). Outcome this slice contributes: top-level `SqlDriver` operations (`execute`, `query`, `executePrepared`) round-trip against a real `@prisma/ppg` session, with errors normalised to `SqlQueryError` / `SqlConnectionError`. Slice 3 will then add long-lived sessions + transactions on top of this lifecycle._

## At a glance

Replace the Slice-1 placeholder driver in `packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts` with a real `SqlDriver<PpgBinding>` implementation. Each top-level `execute`/`query`/`executePrepared` call opens a fresh PPG `client.newSession()` (D1: WebSocket transport only), runs the statement, streams rows back, and closes the session. `acquireConnection()` still throws — that's Slice 3's seam. Errors from PPG (`DatabaseError`, `WebSocketError`, `ValidationError`, `HttpResponseError`) are translated to the same `SqlQueryError` / `SqlConnectionError` shapes the TCP driver produces (NFR4 parity).

## Chosen design

### `PpgBinding` discriminated union

Two-variant discriminated union mirroring the TCP driver's `pgClient` / `pgPool` split. The `url` variant has the driver construct its own PPG client from a connection string; the `ppgClient` variant accepts a pre-built `Client` whose lifecycle the caller owns.

```ts
import type { Client as PpgClient } from '@prisma/ppg';

export type PpgBinding =
  | { kind: 'url'; url: string }
  | { kind: 'ppgClient'; client: PpgClient };
```

### Driver lifecycle

Identical surface to `PostgresUnboundDriverImpl` (the wrapper) → `PostgresPoolDriverImpl` (the bound impl) split in the TCP driver, but the bound impl is a single class (no `pgPool` vs `pgClient` divergence — PPG handles pooling on the wire side).

```text
PpgServerlessUnboundDriverImpl (Slice 1 placeholder → upgraded here)
  - state: 'unbound' | 'connected' | 'closed'
  - connect(binding)  → constructs PpgServerlessBoundDriverImpl, stores delegate
  - close()           → clears delegate, marks closed
  - execute/query/executePrepared → routes to delegate (or throws "not connected")
  - acquireConnection() → routes to delegate (delegate throws "not implemented; Slice 3")

PpgServerlessBoundDriverImpl
  - holds a PpgClient (either constructed from {url} or accepted from {ppgClient})
  - ownsClient: boolean (true for {url}, false for {ppgClient}) — informs close()
  - execute/query/executePrepared → one-shot session per call (see below)
  - acquireConnection() → throws NotImplementedError (Slice 3 seam)
  - close() → marks closed; no PPG-side cleanup needed (Client has no close;
              sessions are per-call and self-clean)
```

### One-shot session per call

Each `execute` / `query` / `executePrepared` call follows the same lifecycle:

```ts
async *execute<Row>({ sql, params }: SqlExecuteRequest): AsyncIterable<Row> {
  const session = await this.#client.newSession();
  try {
    const resultset = await session.query(sql, ...(params ?? []));
    for await (const ppgRow of resultset.rows) {
      yield mapRowToRecord<Row>(ppgRow, resultset.columns);
    }
  } catch (err) {
    throw normalizePpgError(err);
  } finally {
    session.close();
  }
}
```

`query` is `execute` with row collection: open session, run, `await resultset.rows.collect()`, map all rows, close. Returns `SqlQueryResult<Row>` with `rows` populated and `rowCount: rows.length` (PPG's `Resultset` doesn't expose a separate row-count field — using the collected array length is the truthful answer for SELECTs; rowcount for DML is out of scope here since `Session.query` doesn't return one).

`executePrepared` is a direct alias for `execute`. The `handle` cache parameter is accepted (the seam signature requires it) but never read or written (D2).

### Row mapping

PPG's `Row.values: unknown[]` is positional (index `i` corresponds to `columns[i].name`). Our `SqlQueryResult` rows are keyed by column name. The mapper recombines them:

```ts
function mapRowToRecord<Row = Record<string, unknown>>(
  ppgRow: { readonly values: readonly unknown[] },
  columns: ReadonlyArray<{ readonly name: string }>,
): Row {
  const record: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    record[columns[i].name] = ppgRow.values[i];
  }
  return castAs<Row>(record);
}
```

`castAs<Row>` is used per NFR3 — bare `as Row` is forbidden. The cast is justified because the mapper recombines a positionally-typed source (`readonly unknown[]` indexed by column position) into a name-keyed `Record<string, unknown>` whose shape genuinely matches the caller's `Row` type parameter. The cast doesn't *narrow* the unknown values (the runtime stays untyped); it only re-shapes the record-vs-array dimension. The justification is documented inline at the cast site.

### Error normalisation (`normalize-error.ts`)

A new file at `packages/3-targets/7-drivers/ppg-serverless/src/normalize-error.ts` that mirrors the structure of `driver-postgres/src/normalize-error.ts` (NFR4 — middleware and user code should not have to branch on driver).

```ts
import { DatabaseError, HttpResponseError, ValidationError, WebSocketError } from '@prisma/ppg';
import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

export function normalizePpgError(error: unknown): SqlQueryError | SqlConnectionError | Error {
  if (error instanceof DatabaseError) {
    // SQLSTATE-bearing query error → SqlQueryError (parity with driver-postgres).
    return new SqlQueryError(error.message, {
      cause: error,
      sqlState: error.code,
      // PPG's details: Record<string, string>; pluck the conventional fields if present.
      constraint: error.details.constraint,
      table: error.details.table,
      column: error.details.column,
      detail: error.details.detail,
    });
  }

  if (error instanceof WebSocketError) {
    // Wire-side failure → SqlConnectionError. Abnormal closure codes are transient;
    // normal closures (1000, 1001) shouldn't surface as errors at all but handle defensively.
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: isTransientWebSocketClosure(error.closureCode),
    });
  }

  if (error instanceof HttpResponseError) {
    // Shouldn't fire — D1 says WS only — but defensive: 5xx is transient, 4xx is not.
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: error.status >= 500,
    });
  }

  if (error instanceof ValidationError) {
    // Programmer error (e.g. malformed connection string). Pass through; no normalisation.
    return error;
  }

  // Unknown error — pass through with original stack.
  if (error instanceof Error) return error;
  return new Error(String(error));
}
```

`isTransientWebSocketClosure(code?: number)`: returns `true` for codes other than `1000` (normal) and `1001` (going away); returns `false` for `undefined` (we don't have enough signal). This is best-effort — refinement based on observed PPG behaviour comes in later slices.

### Module structure

```
packages/3-targets/7-drivers/ppg-serverless/src/
├── core/
│   ├── descriptor-meta.ts                       # unchanged from Slice 1
│   └── row-mapper.ts                            # new — mapRowToRecord helper
├── exports/
│   └── runtime.ts                               # major surgery — real driver lives here
├── ppg-driver.ts                                # new — bound driver impl + binding types + create function
└── normalize-error.ts                           # new — error normalisation
```

`ppg-driver.ts` mirrors the role of `postgres-driver.ts` in the TCP driver: holds the bound impl class, the binding type, the `createBoundDriverFromBinding(binding)` factory. `exports/runtime.ts` keeps the unbound wrapper + descriptor (mirroring `postgres/src/exports/runtime.ts`).

## Coherence rationale

The whole "one-shot session per call" surface ships together — `execute`, `query`, `executePrepared`, the row mapper, the error normalisation, the bound/unbound split, and the tests that cover all four paths. Splitting (e.g. "ship `execute` in one dispatch, `query` in the next") would carve at non-stable joints: each method individually doesn't satisfy a meaningful slice-DoD because all three share the session lifecycle, the row mapper, and the error-normalisation pipeline. One reviewer holds the coherence: "one-shot session per call works end-to-end through a mocked PPG client, errors normalise to the shared SQL error vocabulary." Rollback is `git revert` of this slice's commits, leaving Slice 1's placeholder in place.

## Scope

**In:**

- `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` — bound driver impl, `PpgBinding` type, `createBoundDriverFromBinding` factory, `PpgServerlessDriverCreateOptions` type (likely empty or thin — PPG's `Client` config is per-instance).
- `packages/3-targets/7-drivers/ppg-serverless/src/normalize-error.ts` — PPG → SqlQueryError / SqlConnectionError mapping.
- `packages/3-targets/7-drivers/ppg-serverless/src/core/row-mapper.ts` — `mapRowToRecord` helper with the `castAs<Row>` justification.
- `packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts` — replace the Slice 1 placeholder unbound class with a real wrapper; descriptor's 4th type-param tightens from `RuntimeDriverInstance<'sql', 'postgres'>` to `RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver<PpgBinding>` so the binding type is part of the public surface (mirrors `PostgresRuntimeDriver`).
- `packages/3-targets/7-drivers/ppg-serverless/test/` — new test directory:
  - `driver.basic.test.ts` — success-path tests (mocked PPG client/session). Mirrors `driver-postgres/test/driver.basic.test.ts` shape: `execute` streams, `query` collects, row-mapping by column name. Skipped: cursor mode (none); prepared-statement handle behaviour (collapsed per D2).
  - `driver.errors.test.ts` — error-path tests (mocked PPG throws `DatabaseError`, `WebSocketError`, etc., assert normalised shapes).
  - `normalize-error.test.ts` — direct unit tests on the normaliser.
  - `driver.unbound.test.ts` — unbound-state tests (`state` transitions, methods throw before `connect`).
- `architecture.config.json` — extend or add globs for the new `core/`, `normalize-error.ts`, `ppg-driver.ts` files (the existing `src/core/**` glob already covers `core/row-mapper.ts`; the new top-level files need entries).

**Out:**

- `acquireConnection()` real behaviour (throws "not implemented" for now). → Slice 3.
- Transactions (`beginTransaction`, `commit`, `rollback`). → Slice 3.
- Long-lived sessions (PPG `newSession` used outside one-shot scope). → Slice 3.
- Integration tests against `@prisma/dev`'s PPG endpoint. → Slice 6.
- Facade package work. → Slices 4–5.
- README "Usage" / Architecture sections (the `<!-- TODO -->` placeholders survive Slice 2). → Slice 5 (when the facade ships, the README example matures) or Slice 6 (close-out polish).
- `explain()` — `SqlQueryable.explain?` is optional; not implementing this slice. The PPG-via-session "EXPLAIN <sql>" pattern is mechanical and the TCP driver already does it; deferring to keep this slice tight. _(Open Question 1 below.)_
- Custom PPG parsers/serializers exposed through `PpgServerlessDriverCreateOptions`. The framework SPI may or may not pipe these through; needs investigation if SqlDriver consumers expect codec customisation hooks. Defer to Slice 5 (facade wiring will surface what the facade users need). _(Open Question 2 below.)_

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| PPG `Session.query` doesn't expose `rowsAffected` for SELECTs — DML rowcount is on `exec`, not `query`. | Implement `SqlDriver.query` via `session.query` + `rows.collect()`; set `rowCount: rows.length`. For DML the caller pattern in this codebase is `execute(...)` which streams (zero rows yielded means success); `query` is used for SELECT-like flows where `rows.length` is meaningful. | Acceptable but worth surfacing in the implementer's report so we know if downstream callers expect a separate `rowsAffected` semantics for `query` on DML. |
| PPG's `Resultset` has an async `rows: CollectableIterator<Row>`. The iterator holds the WS resource; closing the session mid-iteration is the cleanup mechanism. | Wrap the iteration body in `try { for await ... } finally { session.close() }`. Yielding from inside `try` and closing in `finally` is the standard async-iterator cleanup pattern; downstream consumers calling `iterator.return()` on the AsyncIterable trigger the `finally` correctly. | Mirrors the `pg-cursor` cleanup pattern in `driver-postgres/src/postgres-driver.ts` § `executeWithCursor`. |
| PPG params take rest args (`...params: unknown[]`); SqlDriver passes `params?: readonly unknown[]`. | Spread at call site: `session.query(sql, ...(params ?? []))`. | Mechanical; no risk. |
| `Client` from `client(config)` has no `close()` method per PPG's typings — only `Session` is closeable. | Driver `close()` is a state-reset: mark closed, no PPG-side cleanup. For `{ kind: 'url' }` binding we drop the reference; for `{ kind: 'ppgClient' }` we never had ownership in the first place. | Verify on disk by reading PPG's source if uncertain. Documented in the bound impl. |
| `Session` is `Disposable` (TC39 `Symbol.dispose`). Should we use `using session = ...` syntax? | No. The codebase's tsconfig may not target ES2023+; explicit `try/finally` + `session.close()` is portable and matches the codebase style. | Confirmed by reading `@prisma-next/tsconfig/base` — defer to that target. |

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/driver-ppg-serverless test` passes a unit-test surface that covers `execute`, `query`, `executePrepared`, `mapRowToRecord`, and `normalizePpgError` against a mocked PPG client/session.
- [ ] `pnpm lint:deps` green (the new files land in the existing `targets/drivers/{shared,runtime}` glob coverage; no new entries needed if files fit under `src/core/**` + the runtime export).

CI-green, reviewer-accept, project-DoD floor (no `pg`/`pg-cursor`/`@types/pg`; no bare `as` casts) are inherited and not restated.

## Open Questions

1. **`explain()` in scope or out?** Working position: **out** for this slice — defer to Slice 6 (close-out polish) unless a downstream consumer needs it. The `SqlQueryable.explain?` is optional. The TCP driver implements it because pg-cursor / pg-pool give it cheaply; PPG would need a `session.query('EXPLAIN ' + sql, ...)` shim. Cheap to add later. _Override: include explain() in Slice 2 if you want full SqlQueryable parity from day one._
2. **`PpgServerlessDriverCreateOptions` shape.** Working position: **empty interface for now** (`interface PpgServerlessDriverCreateOptions {}`), matching the descriptor's `TCreateOptions = void` default behaviour. PPG's `ClientConfig` accepts `parsers?` / `serializers?` (custom OID parsers/serializers), but our SqlDriver layer doesn't currently surface a custom-codec hook at the create-options level. Surfacing it here would be premature without a consumer ask. _Override: prefigure the shape now if you want the option-bag locked in._
3. **`Session.close()` is sync (`close(): void`) per PPG's typings.** Working position: **call it sync in `finally`**. The driver method bodies are `async`; calling a sync `close()` inside `finally` doesn't change anything. _Surfaced for verification — the implementer should confirm PPG's typings match runtime (the README example uses `await session.close()` but the typing says `void`; one of the two is wrong)._

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md), [`projects/ppg-serverless/plan.md`](../../plan.md), [`projects/ppg-serverless/design-notes.md`](../../design-notes.md)
- Slice 1 (the package shell this slice fills in): [`projects/ppg-serverless/slices/01-driver-scaffold/spec.md`](../01-driver-scaffold/spec.md)
- Existing TCP driver (the structural template — bound/unbound split, normalize-error shape, test layout): [`packages/3-targets/7-drivers/postgres/`](../../../../packages/3-targets/7-drivers/postgres/)
- SqlDriver SPI: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)
- `castAs<Type>` cast helper: [`packages/1-framework/0-foundation/utils/src/casts.ts`](../../../../packages/1-framework/0-foundation/utils/src/casts.ts) and rule [`.agents/rules/no-bare-casts.mdc`](../../../../.agents/rules/no-bare-casts.mdc).
- `SqlQueryError` / `SqlConnectionError` shape: [`packages/2-sql/0-core/sql-errors/src/`](../../../../packages/2-sql/0-core/sql-errors/src/)
- `@prisma/ppg` v1.0.1 public surface: `node_modules/.pnpm/@prisma+ppg@1.0.1/node_modules/@prisma/ppg/dist/index.d.ts` (Client, Session, Resultset, Row, Column, DatabaseError, WebSocketError, HttpResponseError, ValidationError; `client(config)` factory).

## Adapter-impact section

Per `drive/spec/README.md`, slices touching `packages/3-targets/**` declare adapter impact.

**Adapters affected:** None. This slice is driver-only (`packages/3-targets/7-drivers/ppg-serverless/`). The driver shares `targetId: 'postgres'` with `driver-postgres`, so the postgres adapter (`packages/3-targets/6-adapters/postgres/`) is reused unchanged — no adapter edits.
