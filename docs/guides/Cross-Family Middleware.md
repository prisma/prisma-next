# Cross-Family Middleware

This guide is for makers writing runtime middleware that should work against **both** SQL (Postgres, SQLite) and Mongo runtimes. It covers what the middleware SPI guarantees across families, the composition patterns that hold up across both, when it is legitimate to branch on family, three worked examples that compile and run on either family, and the common foot-guns to avoid.

If you only ever target one family, you can author a `SqlMiddleware` or `MongoMiddleware` directly and ignore most of this guide. The patterns here apply when the middleware is genuinely cross-cutting — telemetry, retries, rate limiting, caching, mocks — and you want one implementation that runs everywhere.

For the runtime/middleware mechanics this guide builds on, see [Subsystem 4 — Runtime & Middleware Framework](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md). For the architectural rule against branching on target, see [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc).

## SPI guarantees across families

The middleware SPI lives in [`@prisma-next/framework-components/runtime`](../../packages/1-framework/1-core/framework-components/src/execution/runtime-middleware.ts) and is the **single source of truth** for what cross-family middleware can rely on. Both `SqlRuntimeImpl` and `MongoRuntimeImpl` extend the same abstract `RuntimeCore` and orchestrate middleware through the same `runWithMiddleware` helper, so the lifecycle is identical on both sides:

```typescript
export interface RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan> {
  readonly name: string;
  readonly familyId?: string;
  readonly targetId?: string;

  intercept?(plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<InterceptResult | undefined>;
  beforeExecute?(plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<void>;
  onRow?(row: Record<string, unknown>, plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<void>;
  afterExecute?(plan: TPlan, result: AfterExecuteResult, ctx: RuntimeMiddlewareContext): Promise<void>;
}
```

What is **family-agnostic** (you can rely on these on both SQL and Mongo):

- The five lifecycle hooks (`intercept`, `beforeExecute`, `onRow`, `afterExecute`) and their ordering — see [Subsystem 4 § `runWithMiddleware` Helper](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#runwithmiddleware-helper).
- `RuntimeMiddlewareContext` — `mode` (`'strict' | 'permissive'`), `now()`, `log` (`info` / `warn` / `error` / optional `debug`), and `contentHash(exec)` for stable per-execution identity.
- `plan.meta` — `target`, `storageHash`, optional `lane`, optional `profileHash`, optional `refs`, optional `projection`, optional `annotations`. Both families populate the same shape (see `PlanMeta` in [`@prisma-next/contract/types`](../../packages/1-framework/0-foundation/contract/src/types.ts)).
- `AfterExecuteResult` — `rowCount`, `latencyMs`, `completed`, and `source: 'driver' | 'middleware'` (the latter set when an `intercept` hook short-circuited the driver).
- Row shape inside `onRow` and `InterceptResult.rows` — `Record<string, unknown>`. **Untyped on purpose**: SQL rows arrive pre-decoding; Mongo rows arrive as raw documents.
- Compatibility validation: a middleware with `familyId: 'sql'` registered on a Mongo runtime (or vice versa) throws `RUNTIME.MIDDLEWARE_FAMILY_MISMATCH` at construction time via `checkMiddlewareCompatibility`.

What is **per-family** (do not assume these in cross-family code):

- The concrete plan payload. SQL `beforeExecute` receives [`SqlExecutionPlan`](../../packages/2-sql/4-lanes/relational-core/src/sql-execution-plan.ts) (`{ sql, params, ast?, meta }`); Mongo receives [`MongoExecutionPlan`](../../packages/2-mongo-family/7-runtime/src/mongo-execution-plan.ts) (`{ command, meta }`). Cross-family middleware narrows `TPlan` to the framework `QueryPlan` marker and reads `plan.meta` only.
- `beforeCompile` — the AST-rewrite hook on `SqlMiddleware` for soft-delete / tenant-isolation / etc. Does not exist on `MongoMiddleware`. Cross-family middleware must not declare it.
- Decoded vs raw row shape. The SQL runtime decodes `onRow` rows through its codec pass before yielding to the consumer; intercepted rows are decoded the same way. Mongo yields driver documents straight through. Both shapes match `Record<string, unknown>`, but the value semantics differ — use codec-decoded values via the runtime, not by reaching into the row inside middleware.
- Adapters — only the family's adapter is involved in lowering. Middleware never sees adapter internals.

The minimum cross-family middleware therefore:

- Declares no `familyId`.
- Implements only `intercept` / `beforeExecute` / `onRow` / `afterExecute`.
- Reads `plan.meta` and `ctx`, never `plan.sql` / `plan.command` / `plan.ast`.
- Returns rows as `Record<string, unknown>` from any `intercept` it implements.

## Composition patterns

### Ordering and short-circuiting

Middleware run in **registration order** for every hook. The first interceptor to return a non-`undefined` `InterceptResult` wins; subsequent middleware's `intercept` does not fire on that execution. `beforeExecute` is suppressed entirely on the intercepted hit path; `afterExecute` still fires once with `source: 'middleware'`. See [Subsystem 4 § Intercepting Execution](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#intercepting-execution) for the full state machine.

Practical consequence: register middleware **outside-in**.

```typescript
middleware: [
  retryMiddleware,    // outermost: re-runs the rest on transient failures
  cacheMiddleware,    // intercepts before driver work
  metricsMiddleware,  // observes everything that gets to the driver
  loggingMiddleware,  // innermost: sees the final per-row stream
]
```

The cache reads "first writer wins" semantics from this ordering — once it intercepts, the metrics middleware below it sees `afterExecute` with `source: 'middleware'` and can discount the latency. The retry middleware sits above the cache because cache hits should not be retried on driver errors that never happened.

### Wrapping `AsyncIterableResult`

Every `runtime.execute(plan)` returns an [`AsyncIterableResult<Row>`](../../packages/1-framework/1-core/framework-components/src/execution/async-iterable-result.ts) — an `AsyncIterable<Row>` that also implements `PromiseLike<Row[]>` (so callers can `await runtime.execute(plan)` to drain it). Two consumption rules apply identically on SQL and Mongo:

- **An `AsyncIterableResult` can be consumed once.** A second `for await` or `.toArray()` throws `RUNTIME.ITERATOR_CONSUMED` with an actionable suggestion. Middleware that needs to expose results twice (e.g. caching middleware that records on miss and replays on hit) must materialize the rows itself; do not hand the same iterable out twice.
- **`onRow` runs on the driver path.** It is the right place to count or sample rows that originated at the driver. It does **not** run on intercepted rows — those did not come from a driver stream and `runWithMiddleware` deliberately suppresses `onRow` for them. If your middleware needs uniform per-row visibility on both paths, observe rows inside its own `intercept` (when serving the rows) and inside `onRow` (when not).

### Transaction-scoped middleware

Today **only the SQL family ships transactions** ([Subsystem 4 § Transactions](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#transactions)). The transaction callback receives a `TransactionContext` (`tx.orm`, `tx.sql`, `tx.execute`) bound to a transaction-scoped `RuntimeQueryable`; nested ORM mutations reuse that connection rather than acquiring a new one. Mongo-family transactions are an explicit deferral.

For cross-family middleware this means:

- **Do not assume a transaction exists.** A middleware that asserts "must run inside a transaction" cannot be portable. If you need transaction semantics, implement them family-side or document the requirement and gate behind `familyId: 'sql'`.
- **Plan identity, not connection identity, is the per-execution key.** `runWithMiddleware` produces a fresh `exec` object per call (SQL via `Object.freeze({...lowered, params})`, Mongo by lowering per call). A `WeakMap<exec, ...>` keyed on the post-lowering plan is safe for per-execution scratch space on both sides — see [Subsystem 4 § Plan-identity invariant](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#intercepting-execution).
- **Errors thrown inside `intercept` / `beforeExecute` / `onRow` propagate through the transaction.** Transactions roll back on any callback throw (including a middleware throw); commit failures and rollback failures are surfaced via the wrapping `transaction(...)` call, not the middleware. Treat your throws as causes of rollback.
- **Unconsumed `AsyncIterableResult` returned from a `tx.execute` callback is invalidated** when the transaction commits or rolls back. Middleware that hands an iterable back to its caller must drain it inside the transaction's lifetime; relying on lazy consumption afterwards throws.

### Composing with family-specific middleware

Cross-family middleware composes freely with family-specific middleware as long as ordering rules are respected. Typical Postgres setup:

```typescript
import { lints, budgets } from '@prisma-next/sql-runtime';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';

middleware: [
  createTelemetryMiddleware(), // generic; observes everything
  lints(),                     // SQL-only; fails plans with no WHERE on UPDATE/DELETE
  budgets({ maxRows: 10_000, maxLatencyMs: 1_000 }), // SQL-only
]
```

The cross-family middleware is registered first because it should observe *every* execution, including those that lints or budgets reject. The SQL-specific middleware runs after, narrowing scope before the driver loop begins.

## Family-detection and branching

The default rule: **do not branch on family inside cross-family middleware**. The `RuntimeMiddlewareContext` and `plan.meta` shapes are designed to make branching unnecessary. If you find yourself reaching for `plan.meta.target === 'postgres'`, that is a strong signal you should split into two middleware (one SQL, one Mongo) and let the runtime's `checkMiddlewareCompatibility` reject the wrong one at construction time. See [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc) for the architectural reasoning.

It is **legitimate to read `plan.meta.target` or `plan.meta.targetFamily` for observation only** — labelling a metric, tagging a log line, choosing a counter bucket. That does not change behavior; it merely propagates a value the runtime already exposed.

It is **not legitimate** to:

- Inspect `plan.sql` / `plan.params` / `plan.ast` (SQL only) or `plan.command` (Mongo only) and call them through a `instanceof` / property check. Middleware that does this becomes wedged to the family it was tested against and breaks silently when the other family's plan shape changes.
- Catch a driver-level error and rethrow a different type per family. Use the cross-family error envelope (see [Error Handling](../Error%20Handling.md)) and keep the originating error attached.
- Branch to skip the driver work on one family. If you need to short-circuit, use `intercept` — it works on both families through the same `runWithMiddleware` path.

When in doubt: write the middleware as if both families were the same, run it against both example apps, and only specialize when a concrete divergence forces you to.

## Worked examples

The three middlewares below all carry no `familyId` and run unchanged on both Postgres (via `@prisma-next/postgres/runtime`) and Mongo (via `@prisma-next/mongo-runtime`). They are syntactically validated against the real SPI (`RuntimeMiddleware`, `RuntimeMiddlewareContext`, `AfterExecuteResult`) — copy them into a project and `pnpm typecheck` will accept them.

To register, drop them into the `middleware` array of either example's `db.ts`:

- Postgres: [`examples/prisma-next-demo/src/prisma/db.ts`](../../examples/prisma-next-demo/src/prisma/db.ts)
- Mongo: [`examples/mongo-demo/src/db.ts`](../../examples/mongo-demo/src/db.ts)

### 1. Logging middleware

A minimal cross-family logger that records every execution's lane, target, and outcome. Useful as a first integration point and as a template for richer middleware.

```typescript
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { PlanMeta } from '@prisma-next/contract/types';

export function createLoggingMiddleware(): RuntimeMiddleware {
  return {
    name: 'logging',
    async beforeExecute(plan: { readonly meta: PlanMeta }, ctx: RuntimeMiddlewareContext) {
      ctx.log.info({
        event: 'query.start',
        lane: plan.meta.lane,
        target: plan.meta.target,
        storageHash: plan.meta.storageHash,
      });
    },
    async afterExecute(
      plan: { readonly meta: PlanMeta },
      result: AfterExecuteResult,
      ctx: RuntimeMiddlewareContext,
    ) {
      ctx.log.info({
        event: 'query.end',
        lane: plan.meta.lane,
        target: plan.meta.target,
        rowCount: result.rowCount,
        latencyMs: result.latencyMs,
        completed: result.completed,
        source: result.source,
      });
    },
  };
}
```

Notes:

- We type `plan` as `{ readonly meta: PlanMeta }` rather than the framework `QueryPlan` because `meta.lane` is the only field we read; this keeps the middleware honest about what it depends on.
- `source: 'middleware'` flows through automatically when an `intercept` upstream short-circuits, so cache hits log distinctly without any code path here.

### 2. Retry middleware

Re-execute on transient driver errors. Implemented via `intercept`: the middleware drives the inner runtime by re-issuing the plan after a backoff. Because both runtimes flow through the same `runWithMiddleware`, the retry surface is identical.

```typescript
import type {
  InterceptResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';

export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly isTransient: (error: unknown) => boolean;
  readonly retry: (plan: ExecutionPlan) => AsyncIterable<Record<string, unknown>>;
}

export function createRetryMiddleware(options: RetryOptions): RuntimeMiddleware {
  return {
    name: 'retry',
    async intercept(plan, ctx: RuntimeMiddlewareContext): Promise<InterceptResult | undefined> {
      let lastError: unknown;
      for (let attempt = 0; attempt < options.attempts; attempt++) {
        try {
          const rows: Record<string, unknown>[] = [];
          for await (const row of options.retry(plan)) {
            rows.push(row);
          }
          return { rows };
        } catch (error) {
          if (!options.isTransient(error)) throw error;
          lastError = error;
          ctx.log.warn({
            event: 'query.retry',
            attempt: attempt + 1,
            target: plan.meta.target,
            error,
          });
          await new Promise((r) => setTimeout(r, options.baseDelayMs * 2 ** attempt));
        }
      }
      throw lastError;
    },
  };
}
```

Caveats deliberately exposed in the signature:

- The caller supplies `retry`. Middleware cannot reach the underlying driver itself — that would be a layering violation. In practice you wire `retry` to a sibling runtime (a "raw" runtime without retry middleware) so re-executions go to the driver, not back through the retry chain.
- `intercept` materializes rows into an array. Streaming retries are possible (re-yield from the `AsyncIterable` until it errors), but most retry policies want to retry the whole query, which means buffering. For very large result sets, prefer pushing retry into the application layer.
- `isTransient` is application-supplied because transience is target-specific (Postgres `serialization_failure` vs Mongo `WriteConflict`). The middleware itself stays target-agnostic; the policy lives in the configuration.

### 3. Metrics middleware

Aggregate latency / row count by `target` + `lane`. Exposes a small surface that integrates with any metrics sink (Prometheus, OpenTelemetry, custom). The `source` field on `AfterExecuteResult` lets callers separate driver-served from intercepted executions without an out-of-band signal.

```typescript
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { PlanMeta } from '@prisma-next/contract/types';

export interface MetricsSink {
  recordLatency(labels: Record<string, string>, value: number): void;
  recordRowCount(labels: Record<string, string>, value: number): void;
  incrementCounter(labels: Record<string, string>): void;
}

export function createMetricsMiddleware(sink: MetricsSink): RuntimeMiddleware {
  return {
    name: 'metrics',
    async afterExecute(
      plan: { readonly meta: PlanMeta },
      result: AfterExecuteResult,
      _ctx: RuntimeMiddlewareContext,
    ) {
      const labels = {
        target: plan.meta.target,
        lane: plan.meta.lane ?? 'unknown',
        source: result.source,
        completed: String(result.completed),
      };
      sink.recordLatency(labels, result.latencyMs);
      sink.recordRowCount(labels, result.rowCount);
      sink.incrementCounter(labels);
    },
  };
}
```

Notes:

- We deliberately read `plan.meta.target` for **labelling only** — never to branch behavior. This is the legitimate observation pattern from [Family-detection and branching](#family-detection-and-branching).
- We do not read `plan.sql` to derive a SQL fingerprint here. If you want fingerprinting, the SQL family ships [`computeSqlFingerprint`](../../packages/2-sql/5-runtime/src/fingerprint.ts) and that belongs in a SQL-specific telemetry middleware (compare to [`@prisma-next/middleware-telemetry`](../../packages/3-extensions/middleware-telemetry/src/telemetry-middleware.ts), which stays generic).

For an end-to-end working reference, [`packages/3-extensions/middleware-telemetry`](../../packages/3-extensions/middleware-telemetry/src/telemetry-middleware.ts) is shipped as a first-party generic middleware and exercised against both runtimes by the cross-family proof at [`test/integration/test/cross-package/cross-family-middleware.test.ts`](../../test/integration/test/cross-package/cross-family-middleware.test.ts).

## Anti-patterns

### Assuming SQL placeholders

```typescript
// BAD: assumes SqlExecutionPlan
async beforeExecute(plan, ctx) {
  if (plan.params.length > 100) throw new Error('too many params');
}
```

This compiles only against `SqlMiddleware` (where `TPlan = SqlExecutionPlan`). On a generic `RuntimeMiddleware`, `plan.params` does not exist. Even if you cast, the middleware will throw on every Mongo execution. Either narrow `familyId: 'sql'` and let the runtime reject mongo registration, or move the check into `lints()`.

### Leaking driver-level objects

```typescript
// BAD: cache the underlying connection
async beforeExecute(plan, ctx) {
  const conn = (ctx as any).__driverConnection;
  await conn.query('SET LOCAL ...');
}
```

`RuntimeMiddlewareContext` does not expose driver connections — that is by design. Reaching into private fields couples the middleware to a specific runtime build and breaks silently across versions. SQL-only side effects belong inside transaction callbacks (`db.transaction(async (tx) => ...)`) or in the SQL-family adapter, not in cross-family middleware.

### Blocking inside async iteration

```typescript
// BAD: synchronous CPU work per row blocks the row loop
async onRow(row, plan, ctx) {
  const hash = computeExpensiveHashSync(row); // 10 ms each
  ctx.log.debug({ hash });
}
```

`onRow` runs sequentially in registration order before each row is yielded to the consumer. A 10 ms hook on a 10 000-row stream adds 100 s of latency before the consumer sees the last row. Either make the work cheap, defer to `afterExecute`, or sample (e.g. only hash every Nth row).

### Mutating the plan

```typescript
// BAD: mutate in place
async beforeExecute(plan, ctx) {
  (plan as any).meta.annotations = { ...plan.meta.annotations, traced: true };
}
```

Plans are immutable (see [ADR 011 — Unified Plan model](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)). Mutation breaks plan-identity invariants the cache and request-coalescing middleware rely on, and the runtime treats `exec` as a `WeakMap` key. SQL middleware that needs to rewrite the query uses the typed AST surface in `beforeCompile` — see [Subsystem 4 § Rewriting ASTs](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#rewriting-asts-sql-family). Mongo has no equivalent today.

### Branching on `target`

```typescript
// BAD: behavior changes per target
async beforeExecute(plan, ctx) {
  if (plan.meta.target === 'postgres') {
    await ensurePgExtension(ctx);
  } else if (plan.meta.target === 'mongo') {
    await ensureMongoIndex(ctx);
  }
}
```

Two different concerns shoved into one middleware. Split it: one Postgres-targeted middleware (`familyId: 'sql', targetId: 'postgres'`), one Mongo-targeted middleware (`familyId: 'mongo'`). The runtime's `checkMiddlewareCompatibility` will reject the wrong one at construction time, you get one stack trace per misconfiguration, and the middleware is not lying about being cross-family. See [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc).

### Ignoring `source` on telemetry

```typescript
// BAD: latency metric mixes cache hits with driver round-trips
async afterExecute(plan, result, ctx) {
  metrics.observe('query_latency_ms', result.latencyMs);
}
```

`AfterExecuteResult.source` is `'middleware'` whenever an `intercept` short-circuits the driver — typically a cache hit, mock, or rate-limit reject. Mixing those into a "driver latency" histogram makes the p99 lie. Always propagate `source` as a label, or filter on it.

### Holding a reference to the result iterable

```typescript
// BAD: hand the iterable back to a consumer outside the transaction
const result = await db.transaction(async (tx) => tx.execute(plan));
for await (const row of result) { /* throws — connection released */ }
```

The transaction invalidates its `RuntimeQueryable` on commit/rollback. Drain inside the callback (`await tx.execute(plan)` or `for await (const row of tx.execute(plan)) ...`) and return concrete data. The same caution applies to middleware: do not stash an `AsyncIterableResult` past the lifetime of its execution.
