/**
 * `createSupabaseRuntime` — userspace per-request RLS-scoped runtime factory (T2.2).
 *
 * Headline mechanism of the PoC. Wraps a shared `pg.Pool` so each
 * request can `authenticate({ jwtClaims, role })` and receive a
 * `SqlRuntime`-shaped session that runs every plan inside its own
 * `BEGIN; SET LOCAL request.jwt.claims = …; SET LOCAL ROLE …; <plan>; COMMIT`
 * envelope. The role downgrade (from `postgres` superuser → `authenticated`
 * / `anon`) is what activates the RLS policies authored in the M1 migration;
 * `auth.uid()` reads the `sub` claim from the GUC.
 *
 * Lives in the example (no `packages/` edits, R-NF-1 / R-NF-2). The factory
 * is the proof that PN's existing public surface is sufficient to assemble
 * a Supabase-style developer experience without framework changes — the
 * headline result of the PoC for the realtime/RLS half.
 *
 * ## Design choices (kept here so the call site stays small)
 *
 * - **Transaction-per-plan.** `'transaction'` mode is the only supported
 *   `scopeMode` today; it matches the realistic Supabase deployment
 *   (Supavisor transaction-mode pooler rebinds underlying connections
 *   between transactions, so only `SET LOCAL` inside `BEGIN..COMMIT` is
 *   safe). Each `runtime.execute(plan)` borrows a `PoolClient`, runs
 *   `BEGIN; SET LOCAL …` (2 round-trips), executes the plan, then
 *   `COMMIT` and returns the client to the pool. Connection-mode is the
 *   M3 stretch; not built here.
 * - **Identifier validation, not parameterization.** `SET ROLE` does not
 *   accept bind parameters in Postgres — the role must be in the SQL
 *   text. We allowlist-check the role against `allowedRoles` synchronously
 *   (R-FX-5) and additionally validate it against a strict identifier
 *   regex before quoting it with `"…"`. `request.jwt.claims` *does*
 *   parameterize via `set_config('request.jwt.claims', $1, true)` (the
 *   `true` flag = local to the current transaction, equivalent to
 *   `SET LOCAL`).
 * - **Lazy connection acquisition.** `authenticate()` is synchronous and
 *   never touches the pool — it constructs the scoped driver and
 *   wraps it in a `Runtime`. The pool is touched only when the caller
 *   first calls `session.execute(plan)`. This is what makes R-FX-5 work:
 *   a disallowed role throws synchronously, before any SQL is sent.
 * - **Mid-iteration error → ROLLBACK + evict.** `execute()` is an async
 *   generator; the `try/finally` cleanup distinguishes successful
 *   completion (COMMIT + `release()`) from interrupted iteration
 *   (ROLLBACK + `destroy(err)`, which evicts the client from the pool
 *   so a possibly-broken connection is never reused). R-FX-7.
 * - **`session.beginTransaction()` throws synchronously** with code
 *   `runtime/unsupported-scoped-tx` (R-FX-8). User-initiated transactions
 *   inside the per-plan transaction have subtle semantics we explicitly
 *   ruled out for the PoC; the throw is the bright line. Tracked as
 *   [FL-21](../../../../projects/supabase-poc/framework-limitations.md).
 *
 * ## Public surface
 *
 * ```ts
 * const factory = createSupabaseRuntime({
 *   context: adminDb.context,
 *   pool,
 *   scopeMode: 'transaction',
 *   allowedRoles: ['authenticated', 'anon'],
 * });
 *
 * const session = factory.authenticate({
 *   jwtClaims: { sub: userId, role: 'authenticated' },
 *   role: 'authenticated',
 * });
 * try {
 *   const rows = await session.execute(plan); // RLS-scoped
 * } finally {
 *   await session.end(); // no-op in transaction mode; required in connection mode (M3)
 * }
 * ```
 *
 * `SupabaseSession` is structurally a `SqlRuntime` plus `end()` and a
 * `beginTransaction()` that throws. Calling code does not need to know
 * the runtime is RLS-scoped — the lane / plan / middleware story is
 * unchanged.
 *
 * @see projects/supabase-poc/spec.md § Functional requirements (R-FX-*)
 * @see projects/supabase-poc/plan.md § Milestone 2 → 2.2
 * @see projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md § 5
 */
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext, Runtime } from '@prisma-next/sql-runtime';
import { createRuntime, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Pool, PoolClient } from 'pg';

export type ScopeMode = 'transaction';

export interface SupabaseRuntimeOptions<TContract extends Contract<SqlStorage>> {
  /** Execution context built from the contract — typically `adminDb.context`. */
  readonly context: ExecutionContext<TContract>;
  /**
   * Shared `pg.Pool` the factory borrows from. The factory does **not** own
   * the pool; the caller is responsible for `pool.end()` at process shutdown.
   */
  readonly pool: Pool;
  /** Only `'transaction'` is supported in M2. Connection-scope mode is the M3 stretch. */
  readonly scopeMode: ScopeMode;
  /**
   * Allowlist of role names that `authenticate({ role })` may pass through to
   * `SET LOCAL ROLE`. R-FX-5: any role outside this list throws synchronously
   * before any SQL is sent (the spy-based test verifies the pool is never
   * touched on rejection).
   */
  readonly allowedRoles: readonly string[];
}

export interface AuthenticateOptions {
  /** JWT claims to expose via `request.jwt.claims` GUC. Supabase's `auth.uid()` reads `sub`. */
  readonly jwtClaims: Readonly<Record<string, unknown>>;
  /** Postgres role to `SET LOCAL` for the duration of the per-plan transaction. */
  readonly role: string;
}

export interface SupabaseSession extends Runtime {
  /**
   * R-FX-8: user-initiated transactions inside the per-plan transaction
   * are out of scope for the PoC. Throws synchronously with code
   * `runtime/unsupported-scoped-tx`.
   */
  beginTransaction(): never;
  /**
   * Tear-down hook. In transaction-scope mode this is a no-op (every plan
   * is already its own self-contained transaction); kept on the surface so
   * call sites are forward-compatible with the connection-scope mode (M3),
   * which borrows a long-lived `PoolClient` and releases it here.
   */
  end(): Promise<void>;
}

export interface SupabaseRuntimeFactory {
  authenticate(options: AuthenticateOptions): SupabaseSession;
}

/** Strict Postgres identifier — defensive, since `SET ROLE <ident>` cannot be parameterized. */
const IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface UnsupportedScopedTxError extends Error {
  readonly code: 'runtime/unsupported-scoped-tx';
}

function unsupportedScopedTxError(): UnsupportedScopedTxError {
  const err = new Error(
    'createSupabaseRuntime: session.beginTransaction() is not supported in transaction-scope mode. ' +
      'Each plan already runs in its own implicit transaction with `SET LOCAL` for the request identity. ' +
      'Nested user-initiated transactions are out of scope for the PoC; see FL-21 in framework-limitations.md.',
  ) as UnsupportedScopedTxError;
  Object.assign(err, { code: 'runtime/unsupported-scoped-tx' as const });
  return err;
}

/**
 * Typed error for the R-FX-5 allowlist rejection. The factory throws
 * synchronously from `authenticate()` when the requested role is not in
 * `allowedRoles`; the scoped-runtime middleware (T4.4) `instanceof`-
 * checks this shape (or matches on `code`) to map the throw to a 403
 * `auth/role-not-allowed` response rather than letting it propagate as
 * a 500 ("server bug") to the client. Exposing a class — rather than
 * making the middleware brittle-match on the message string — keeps
 * the boundary explicit at the type level.
 */
export interface RoleNotAllowedError extends Error {
  readonly code: 'auth/role-not-allowed';
  readonly role: string;
  readonly allowedRoles: readonly string[];
}

export function isRoleNotAllowedError(err: unknown): err is RoleNotAllowedError {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === 'auth/role-not-allowed' &&
    typeof (err as { role?: unknown }).role === 'string' &&
    Array.isArray((err as { allowedRoles?: unknown }).allowedRoles)
  );
}

function roleNotAllowedError(role: string, allowedRoles: readonly string[]): RoleNotAllowedError {
  const err = new Error(
    `createSupabaseRuntime: role '${role}' is not in allowedRoles ` +
      `[${allowedRoles.map((r) => `'${r}'`).join(', ')}]. ` +
      'Reject the request before issuing any SQL.',
  ) as RoleNotAllowedError;
  Object.assign(err, {
    code: 'auth/role-not-allowed' as const,
    role,
    allowedRoles,
  });
  return err;
}

/** Pre-validated session config — the bits that get baked into each `SET LOCAL`. */
interface ScopedSessionConfig {
  readonly jwtClaimsJson: string;
  readonly setRoleSql: string;
}

/**
 * `pg`'s `Client.query` typing wants `unknown[] | undefined`; the SqlDriver
 * SPI hands us `readonly unknown[] | undefined`. The cast erases the
 * `readonly` brand only — `pg` does not mutate the array — so this is
 * safe and the cast scope is one expression rather than three call sites
 * (per AGENTS.md "minimize cast scope").
 */
function toPgParams(params: readonly unknown[] | undefined): unknown[] | undefined {
  return params as unknown[] | undefined;
}

/**
 * If `destroy()` fails on a cleanup path we already have an upstream error
 * we are about to propagate; attach the destroy failure as `cause` so it
 * reaches the caller's stack trace instead of being silently swallowed
 * (M3 reviewer follow-up). We only set `cause` when it is undefined to
 * avoid clobbering a richer chain the caller might have constructed.
 */
function attachDestroyFailure(upstream: unknown, destroyError: unknown): void {
  if (upstream instanceof Error && destroyError instanceof Error && upstream.cause === undefined) {
    (upstream as { cause?: unknown }).cause = destroyError;
  }
}

/**
 * Async generator helper that turns a (potentially) thrown iteration into
 * a destroy-instead-of-release decision. Used by the driver-level
 * `execute()` (per-plan transaction) wrapper.
 *
 * Cleanup semantics:
 *  - Generator runs to completion → `success = true` → `release()` (COMMIT + return to pool).
 *  - Generator throws (downstream SQL error) → caught → destroy + attach destroy failure (if any) as `cause` → re-throw.
 *  - `for await` body throws (consumer error) → `iterator.return()` → finally fires → `destroy()` (ROLLBACK + evict).
 *    A destroy failure on this path cannot be attached to the consumer's error (we don't see it from inside the generator); it is silenced.
 *
 * The third case is what R-FX-7 (mid-iteration throw) exercises.
 */
async function* iterateAndCleanup<Row>(
  rows: AsyncIterable<Row>,
  release: () => Promise<void>,
  destroy: (reason?: unknown) => Promise<void>,
): AsyncGenerator<Row, void, unknown> {
  let success = false;
  let consumerCancelled = true;
  try {
    try {
      for await (const row of rows) {
        yield row;
      }
      success = true;
      consumerCancelled = false;
    } catch (generatorError) {
      consumerCancelled = false;
      await destroy(generatorError).catch((destroyError) => {
        attachDestroyFailure(generatorError, destroyError);
      });
      throw generatorError;
    }
  } finally {
    if (success) {
      await release();
    } else if (consumerCancelled) {
      // Consumer broke / threw / early-returned out of the for-await; we
      // cannot reach their error from here, so a destroy failure is
      // silently lost. Documented above; cross-references FL-17.
      await destroy().catch(() => undefined);
    }
  }
}

/**
 * `SqlConnection` wrapping a `PoolClient` already inside a transaction with
 * `SET LOCAL` applied. `release()` issues `COMMIT` + returns the client to
 * the pool; `destroy(reason)` issues `ROLLBACK` + releases with an error so
 * the pool evicts the client (state may be indeterminate — e.g. a failed
 * COMMIT/ROLLBACK leaves the protocol in a state we do not want to reuse).
 *
 * `execute()` runs the plan via the buffered path (`client.query(sql, params)`
 * then yields rows). Cursor mode is intentionally not used — it requires
 * `pg-cursor` (a transitive dep of `@prisma-next/driver-postgres`, not a
 * direct dep of the example) and the ergonomic gain is small for the
 * fixture-sized result sets in this PoC.
 */
class ScopedConnection implements SqlConnection {
  readonly #client: PoolClient;
  #released = false;

  constructor(client: PoolClient) {
    this.#client = client;
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const result = await this.#client.query(request.sql, toPgParams(request.params));
    for (const row of result.rows as Row[]) {
      yield row;
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.#client.query(sql, toPgParams(params));
    return result as unknown as SqlQueryResult<Row>;
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const result = await this.#client.query(text, toPgParams(request.params));
    return { rows: result.rows as ReadonlyArray<Record<string, unknown>> };
  }

  beginTransaction(): Promise<SqlTransaction> {
    throw unsupportedScopedTxError();
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    try {
      await this.#client.query('COMMIT');
      this.#client.release();
    } catch (commitError) {
      // COMMIT failed — protocol state is ambiguous. Try a best-effort
      // ROLLBACK to put the server back in a known state, then evict the
      // client either way (truthy arg to release() = pool eviction).
      await this.#client.query('ROLLBACK').catch(() => undefined);
      this.#client.release(commitError instanceof Error ? commitError : new Error('COMMIT failed'));
      throw commitError;
    }
  }

  async destroy(reason?: unknown): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#client.query('ROLLBACK').catch(() => undefined);
    const evictArg: Error =
      reason instanceof Error ? reason : new Error('ScopedConnection destroyed');
    this.#client.release(evictArg);
  }
}

/**
 * Custom `SqlDriver` that owns the per-plan transaction lifecycle. Each
 * top-level `execute()` borrows a `PoolClient`, opens a transaction,
 * applies the per-session GUCs, runs the plan, then either COMMITs (clean
 * iteration) or ROLLBACKs and evicts (interrupted iteration / SQL error).
 *
 * The driver does **not** own the `pg.Pool`. `close()` is a no-op; the
 * caller (the host process) is responsible for `pool.end()`. The factory
 * builds one driver per `authenticate()` call so the per-session config
 * (claims JSON + role identifier) is captured by the closure rather than
 * threaded through the SPI.
 */
class ScopedDriver implements SqlDriver<void> {
  readonly state: SqlDriverState = 'connected';
  readonly #pool: Pool;
  readonly #config: ScopedSessionConfig;

  constructor(pool: Pool, config: ScopedSessionConfig) {
    this.#pool = pool;
    this.#config = config;
  }

  async connect(): Promise<void> {
    // No-op: the driver is constructed already "connected" to the shared
    // pool. Defined so the SqlDriver SPI is satisfied; the framework never
    // calls it on a custom driver instance supplied via createRuntime().
  }

  async close(): Promise<void> {
    // No-op: the factory does not own the pool. Calling pool.end() here
    // would tear down the shared resource for every other in-flight
    // session against this factory.
  }

  async acquireConnection(): Promise<SqlConnection> {
    return this.#acquireScopedConnection();
  }

  /**
   * Internal variant of `acquireConnection()` that returns the concrete
   * `ScopedConnection` type so callers (e.g. `explain()`) can invoke
   * methods that are optional on the `SqlConnection` SPI but always
   * defined on `ScopedConnection`. Avoids casts at each call site.
   */
  async #acquireScopedConnection(): Promise<ScopedConnection> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Parameterize the JWT claims via set_config(name, value, is_local).
      // SET LOCAL request.jwt.claims = $1 is NOT a valid parameterized form
      // in Postgres — the value must be a literal in SET syntax — so we use
      // the function-call form, which accepts a bind parameter.
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        this.#config.jwtClaimsJson,
      ]);
      // SET ROLE cannot be parameterized either; the identifier is in the
      // SQL text, validated against IDENT_PATTERN and quoted by the factory
      // before reaching here.
      await client.query(this.#config.setRoleSql);
    } catch (setupError) {
      await client.query('ROLLBACK').catch(() => undefined);
      const evictArg: Error =
        setupError instanceof Error ? setupError : new Error('ScopedDriver setup failed');
      client.release(evictArg);
      throw setupError;
    }
    return new ScopedConnection(client);
  }

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const driver = this;
    return {
      async *[Symbol.asyncIterator]() {
        const conn = await driver.#acquireScopedConnection();
        const release = (): Promise<void> => conn.release();
        const destroy = (reason?: unknown): Promise<void> => conn.destroy(reason);
        yield* iterateAndCleanup<Row>(conn.execute<Row>(request), release, destroy);
      },
    };
  }

  /**
   * Top-level `query()` is the runtime's back-channel for marker
   * verification (`RuntimeCore.verifyPlanIfNeeded` calls
   * `driver.query(readMarkerSql, [])` on first plan execution to compare
   * the contract hash against the database's `__prisma_next_marker` row).
   * That table is in the `prisma_contract` schema, which is **not**
   * readable to the downgraded `authenticated` / `anon` roles — running
   * the marker query inside the per-plan `BEGIN; SET LOCAL ROLE …`
   * envelope would fail with `permission denied for schema
   * prisma_contract` and surface as a runtime error to the caller.
   *
   * Marker verification is conceptually admin-y: it asks "is this
   * database the right shape for this contract?", not "what data is this
   * user allowed to see?". So we deliberately run `query()` **without**
   * the role downgrade — a plain pool checkout, executed as the pool's
   * underlying superuser. RLS scoping is preserved on the user-visible
   * paths (`execute()` and `acquireConnection()`).
   *
   * User code does not have a path to `runtime.query()`; the public
   * `Runtime` surface exposes only `execute()` and `connection()`. The
   * back-channel split is invisible at the call site.
   *
   * (If/when the framework grows a "skip verify entirely" mode, this
   * back-channel can collapse into a single per-plan envelope. Tracked
   * as FL-14. A related concern — every `authenticate()` produces a fresh
   * runtime instance, so the marker query fires once per session — is
   * tracked as FL-17.)
   */
  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query(sql, toPgParams(params));
      return result as unknown as SqlQueryResult<Row>;
    } finally {
      client.release();
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    // Use the private accessor so we get the concrete `ScopedConnection`
    // type and can call `.explain()` directly — avoids the SPI-level
    // optional-method cast that the original implementation needed.
    const conn = await this.#acquireScopedConnection();
    try {
      const result = await conn.explain(request);
      await conn.release();
      return result;
    } catch (error) {
      await conn.destroy(error).catch((destroyError) => {
        attachDestroyFailure(error, destroyError);
      });
      throw error;
    }
  }
}

export function createSupabaseRuntime<TContract extends Contract<SqlStorage>>(
  options: SupabaseRuntimeOptions<TContract>,
): SupabaseRuntimeFactory {
  if (options.scopeMode !== 'transaction') {
    throw new Error(
      `createSupabaseRuntime: scopeMode '${String(options.scopeMode)}' is not supported in M2. ` +
        "Only 'transaction' is implemented; 'connection' mode is the M3 stretch.",
    );
  }
  const allowedRoles = new Set(options.allowedRoles);

  // Build a stack instance once and reuse it across sessions. The `driver`
  // descriptor field is intentionally omitted: `createSqlExecutionStack` accepts
  // it as optional, and `createRuntime` reads `stackInstance.adapter` but
  // never `stackInstance.driver` when the caller supplies a `SqlDriver`
  // instance directly (which we do — each session constructs its own
  // ScopedDriver below). Importing `postgresDriver` here would be dead weight.
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack);

  return {
    authenticate({ jwtClaims, role }: AuthenticateOptions): SupabaseSession {
      // R-FX-5: synchronous validation. Throw before constructing any driver
      // / runtime so the spy-based test can prove the pool was never touched.
      // The error is typed (`RoleNotAllowedError` w/ `code:
      // 'auth/role-not-allowed'`) so the scoped-runtime middleware (T4.4) can
      // map the throw to a 403 `auth/role-not-allowed` response — a
      // forged-but-valid JWT carrying `role: 'admin'` is an auth failure, not
      // a server bug, and shouldn't surface to the client as a 500.
      if (!allowedRoles.has(role)) {
        throw roleNotAllowedError(role, [...allowedRoles]);
      }
      // Defensive: even though the role is in the allowlist, validate it as
      // a Postgres identifier before interpolating into `SET LOCAL ROLE`,
      // which cannot be parameterized.
      if (!IDENT_PATTERN.test(role)) {
        throw new Error(
          `createSupabaseRuntime: role '${role}' is not a valid Postgres identifier ` +
            `(must match ${IDENT_PATTERN.source}). Refusing to interpolate into SET LOCAL ROLE.`,
        );
      }

      const config: ScopedSessionConfig = {
        jwtClaimsJson: JSON.stringify(jwtClaims),
        // Quote the identifier defensively even though it has already passed
        // IDENT_PATTERN — keeps the SQL self-evidently safe to a reader and
        // matches the convention used by the migration factories.
        setRoleSql: `SET LOCAL ROLE "${role.replace(/"/g, '""')}"`,
      };

      const driver = new ScopedDriver(options.pool, config);
      const runtime: Runtime = createRuntime({
        stackInstance,
        context: options.context,
        driver,
        // Marker verification fires once per session (FL-17) via the
        // back-channel `query()` path, which runs as the pool's underlying
        // superuser (FL-14) — so the marker table is always readable here
        // even though the per-plan envelope downgrades the role. We
        // therefore enable `requireMarker: true`: a missing marker now
        // fails loudly (e.g. pool pointed at the wrong DB), instead of
        // surfacing later as "queries return zero rows."
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      // Build the session as a wrapper rather than mutating `runtime` in
      // place (M1 reviewer follow-up). Forwarding methods explicitly keeps
      // the `SupabaseSession ⊆ Runtime` relationship structural, avoids
      // shadowing surprises if `Runtime` ever grows a `beginTransaction`
      // of its own, and pins the override semantics at the type level.
      const session: SupabaseSession = {
        execute: runtime.execute.bind(runtime),
        connection: runtime.connection.bind(runtime),
        telemetry: runtime.telemetry.bind(runtime),
        close: runtime.close.bind(runtime),
        beginTransaction(): never {
          throw unsupportedScopedTxError();
        },
        async end(): Promise<void> {
          // Transaction-scope mode: every plan is its own self-contained
          // transaction, so there is no long-lived per-session connection
          // to release here. Connection-scope mode (M3) will release the
          // borrowed client.
        },
      };

      return session;
    },
  };
}
