# ADR — Runtime target-layer class

**Status:** Draft (workspace ADR; promoted to `docs/architecture docs/adrs/` at project close-out).

**Related:** [ADR 005 — Thin core, fat targets](../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md), [`no-target-branches.mdc`](../../../.agents/rules/no-target-branches.mdc), this project's [`spec.md`](../spec.md).

---

## Decision

`SqlRuntime` is exported from `@prisma-next/sql-runtime` as an **abstract class**. Target packages subclass it to produce their concrete runtimes; target factories construct those concrete classes directly. No family-level factory (`createRuntime`) exists.

```
abstract class RuntimeCore<TQueryPlan, TExecPlan, TMiddleware>    // framework-components
  ↑ extends
abstract class SqlRuntime<TContract>                               // sql-runtime (exported)
  ↑ extends
class PostgresRuntime<TContract> extends SqlRuntime<TContract>     // @prisma-next/postgres
class SqliteRuntime<TContract> extends SqlRuntime<TContract>       // @prisma-next/sqlite

  ↑ extends
class SupabaseRuntime<TContract> extends PostgresRuntime<TContract> // @prisma-next/extension-supabase
```

Target factories (`postgres()`, `sqlite()`, `supabase()`) construct their respective concrete classes; app code consumes the `Runtime` interface, not the class hierarchy.

Extension authors who need target-specific runtime behaviour subclass the **target** class (e.g. `PostgresRuntime`), not `SqlRuntime` directly.

## Session bootstrap — the protected seam

`SqlRuntime` exposes two `protected` primitives for target subclasses that need to issue SQL below the user middleware chain before the typed query runs:

```ts
// packages/2-sql/5-runtime/src/sql-runtime.ts

/**
 * Narrow view of a raw transaction exposed to bootstrap closures.
 * Only query() leaks to the caller — no lifecycle methods.
 */
export interface RawSessionConnection {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;
}
```

```ts
// Single-query variant: acquire → BEGIN → bootstrap(rawConn) → execute(plan) via middleware → COMMIT/ROLLBACK → release
protected executeWithSessionBootstrap<Row>(
  plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
  bootstrap: (conn: RawSessionConnection) => Promise<void>,
  options?: RuntimeExecuteOptions,
): AsyncIterableResult<Row>

// Multi-statement variant: same acquire/BEGIN/bootstrap preamble, then fn(tx) where tx routes through middleware on the same transaction
protected async executeTransactionWithBootstrap<R>(
  bootstrap: (conn: RawSessionConnection) => Promise<void>,
  fn: (tx: TransactionContext) => PromiseLike<R>,
): Promise<R>
```

**Why below-middleware matters for security.** User middleware observes the typed `SqlExecutionPlan` flowing through `runWithMiddleware`. Bootstrap SQL runs directly against `RawSessionConnection.query()` on the raw transaction — it is never presented to the user middleware chain. A user cannot observe, reorder, or remove bootstrap SQL by registering middleware. This makes bootstrap SQL structurally non-bypassable, which is the property that makes Postgres RLS enforcement sound.

**Execution order:**

```
acquire connection
  └─ BEGIN
       ├─ bootstrap(RawSessionConnection)  ← raw tx.query(); below user middleware
       └─ executeAgainstQueryable(plan, tx) ← middleware chain wraps typed execute
            ├─ intercept?
            ├─ beforeExecute
            ├─ runDriver (tx)
            └─ afterExecute
  └─ COMMIT (or ROLLBACK on error)
release connection
```

## Supabase — the proving case

`SupabaseRuntime` is the first subclass in production. It applies a Postgres role and JWT claims on every execute using `set_config()` in a bootstrap closure:

```ts
// packages/3-extensions/supabase/src/runtime/supabase-runtime.ts
export interface SupabaseRoleBinding {
  readonly role: 'anon' | 'authenticated' | 'service_role';
  readonly claims?: Record<string, unknown>;
}

export class SupabaseRuntime<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends PostgresRuntime<TContract> {
  executeWithRole<Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.executeWithSessionBootstrap(
      plan,
      (conn: RawSessionConnection) => this.applyRoleBinding(conn, binding),
      options,
    );
  }

  executeRoleTransaction<R>(
    binding: SupabaseRoleBinding,
    fn: (tx: TransactionContext) => PromiseLike<R>,
  ): Promise<R> {
    return this.executeTransactionWithBootstrap(
      (conn: RawSessionConnection) => this.applyRoleBinding(conn, binding),
      fn,
    );
  }

  private async applyRoleBinding(
    conn: RawSessionConnection,
    binding: SupabaseRoleBinding,
  ): Promise<void> {
    await conn.query('SELECT set_config($1, $2, true)', ['role', binding.role]);
    await conn.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify(binding.claims ?? {}),
    ]);
  }
}
```

**`set_config($1, $2, true)` — not `SET LOCAL role = $1`.** Postgres rejects `SET LOCAL role = $1` (parameters are not permitted in `SET` statements). String-building `SET LOCAL role = '${role}'` would be injectable. `SELECT set_config($1, $2, true)` is parameterized, runs inside the transaction (`true` = transaction-local), and is the canonical safe form.

**Role binding lives in bootstrap closures, not in `RuntimeExecuteOptions`.** `RuntimeExecuteOptions` is a cross-family type in `framework-components/runtime`. Embedding a Postgres-specific `role` field there would couple the framework type to a SQL/RLS concept. The bootstrap closure pattern keeps `RuntimeExecuteOptions` clean and puts role semantics where they belong — in the Supabase extension.

The `supabase()` factory constructs one shared `SupabaseRuntime` and produces per-role `RoleBoundDb` instances that call `executeWithRole`/`executeRoleTransaction` with a fixed binding. Binding construction is cheap (no I/O); the connection pool is shared across bindings.

Proven by `examples/supabase/test/rls-role-binding.integration.test.ts`: raw-SQL RLS policy, `asUser` sees only own rows, `asAnon` sees none, `asServiceRole` sees all, recording middleware never sees `set_config` calls.

## Alternatives considered

**Keep `createRuntime` + a default concrete `SqlRuntimeImpl`.** A factory at the family layer constructs a concrete class the target layer never sees. Rejected: construction at the family layer contradicts thin-core/fat-targets — the family layer doesn't know which target it's serving. It also leaves extension authors with no class to subclass, forcing composition or a re-entrant factory pattern.

**Composition/decorator for `SupabaseRuntime`.** `SupabaseRuntime` holds a base `Runtime` and forwards every method, wrapping `execute` to issue `set_config` first. Rejected: forwarding tax on every new method, `SupabaseRuntime` IS-NOT-A `PostgresRuntime` in any type-safe sense, and the decoration must be updated whenever the `Runtime` interface grows.

**Role/claims via `RuntimeExecuteOptions`.** Add `role?: string; claims?: Record<string, unknown>` fields to `RuntimeExecuteOptions` and let `SqlRuntime.execute` handle them. Rejected: couples a Postgres RLS concept into a cross-family framework type. Middleware compatibility checks (`checkMiddlewareCompatibility`) would need family-specific branches. The per-binding DB object (`RoleBoundDb`) also disappears — callers would specify a role on every call instead of once at binding time.

## Consequences

- **No family-level `createRuntime` factory.** Target factories are the only construction path. App code that previously passed `Runtime` through doesn't change (it consumed the interface, not the class).
- **`SqlRuntime` is a public extension point.** Extension authors can subclass `SqlRuntime` directly, bypassing the target layer. Acceptable, but the extension-authoring guide documents that subclassing the target class is the right choice.
- **Target runtimes are thin today.** `PostgresRuntime` and `SqliteRuntime` are currently identity subclasses — their value is structural (the extension point exists) and will grow as Postgres-specific runtime behaviour lands (prepared-statement caching, `LISTEN`/`NOTIFY`, etc.).
- **`SupabaseRuntime.executeWithRole` / `executeRoleTransaction` are not on `Runtime`.** They're on `SupabaseRuntime` directly. The `supabase()` factory returns a `SupabaseDb<TContract>` with `asUser`/`asAnon`/`asServiceRole` methods; app code never calls `executeWithRole` directly.
- **Three-layer pattern is now consistent across IR and runtime.** The IR layer (ADR 225) and the runtime layer follow the same `framework → family → target` shape.
