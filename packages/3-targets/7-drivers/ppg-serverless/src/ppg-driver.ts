import type { Client, Session } from '@prisma/ppg';
import { client, defaultClientConfig } from '@prisma/ppg';
import type {
  PreparedExecuteRequest,
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlQueryable,
  SqlQueryResult,
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { mapRowToRecord } from './core/row-mapper';
import { normalizePpgError } from './normalize-error';

/**
 * Discriminated union of accepted bindings for the PPG serverless driver.
 *
 * - `{ kind: 'url' }`: the driver constructs its own PPG `Client` from the
 *   given connection string and owns its lifecycle.
 * - `{ kind: 'ppgClient' }`: the caller supplies a pre-built PPG `Client` and
 *   retains ownership. The driver never closes it.
 *
 * (No `{ kind: 'ppgPool' }` variant: PPG handles pooling on the wire side,
 * unlike `pg` where the driver manages a `Pool`.)
 */
export type PpgBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'ppgClient'; readonly client: Client };

/**
 * Driver-level creation options. Currently empty: PPG's per-instance
 * configuration (parsers / serializers) is exposed on its `Client`, and the
 * framework-level SqlDriver create-options seam does not surface a
 * codec-customisation hook today. The interface is reserved for future use
 * so consumers can pass `descriptor.create(options)` without an arity churn
 * if/when a hook is added.
 */
// biome-ignore lint/suspicious/noEmptyInterface: reserved future surface; see jsdoc above
export interface PpgServerlessDriverCreateOptions {}

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.CLOSED' | 'DRIVER.CONNECTION_RELEASED';
  readonly category: 'RUNTIME';
  readonly severity: 'error';
}

function driverError(code: DriverRuntimeError['code'], message: string): DriverRuntimeError {
  const error = blindCast<
    DriverRuntimeError,
    'augmenting a fresh Error with code / category / severity properties below; the assertion only widens the in-construction value so Object.assign can populate the readonly fields without TS losing track of them'
  >(new Error(message));
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'RUNTIME' as const,
    severity: 'error' as const,
  });
}

const CLOSED_MESSAGE =
  'driver-ppg-serverless: driver is closed. Reconnect with connect(binding) before issuing further calls.';

const RELEASED_MESSAGE =
  'driver-ppg-serverless: connection has been released; acquire a new connection before issuing further queries.';

/**
 * Abstract `SqlQueryable` substrate. Owns the canonical `execute` /
 * `executePrepared` / `query` flow against a PPG `Session`, deferring session
 * acquisition and release to subclasses through two hooks:
 *
 * - `acquireSession()`: produces the `Session` the call should run against.
 *   For the bound driver this is a fresh `client.newSession()`; for the
 *   long-lived connection and transaction subclasses it is the same held
 *   session, returned each call.
 * - `releaseSession(session)`: invoked from the `finally` block after each
 *   call. The bound driver closes the session here; the long-lived
 *   subclasses no-op (their session is released only at connection
 *   release/destroy time).
 *
 * Keeping all three queryable kinds (bound driver, long-lived connection,
 * transaction) on this single substrate avoids duplicating the
 * row-mapping + error-normalisation + iterator-cleanup boilerplate three
 * ways.
 */
abstract class PpgServerlessQueryable implements SqlQueryable {
  protected abstract acquireSession(): Promise<Session>;
  protected abstract releaseSession(session: Session): Promise<void>;

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    return this.#executeStreaming<Row>(request.sql, request.params);
  }

  executePrepared<Row = Record<string, unknown>>(
    request: PreparedExecuteRequest,
  ): AsyncIterable<Row> {
    // The `handle` cache slot is accepted (the SPI requires it) but neither
    // read nor written. PPG has no per-driver prepared-statement registry to
    // attach to it; collapsing executePrepared into execute is the
    // structurally-correct simplification for this driver.
    return this.#executeStreaming<Row>(request.sql, request.params);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const session = await this.acquireSession();
    try {
      const resultset = await session.query(sql, ...(params ?? []));
      const ppgRows = await resultset.rows.collect();
      const rows = ppgRows.map((ppgRow) => mapRowToRecord<Row>(ppgRow, resultset.columns));
      return { rows, rowCount: rows.length };
    } catch (err) {
      throw normalizePpgError(err);
    } finally {
      await this.releaseSession(session);
    }
  }

  async *#executeStreaming<Row>(
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const session = await this.acquireSession();
    try {
      const resultset = await session.query(sql, ...(params ?? []));
      for await (const ppgRow of resultset.rows) {
        yield mapRowToRecord<Row>(ppgRow, resultset.columns);
      }
    } catch (err) {
      throw normalizePpgError(err);
    } finally {
      // `Session.close()` is synchronous in PPG (typed `void`, sync at
      // runtime — confirmed in `@prisma/ppg/dist/index.js`). The
      // `releaseSession` hook may still be async in the general case (a
      // subclass might defer real work) so we await it; for the one-shot and
      // held-session subclasses the await is a no-op tick.
      await this.releaseSession(session);
    }
  }
}

/**
 * Real bound `SqlDriver<PpgBinding>` implementation. Each `execute` / `query`
 * / `executePrepared` call opens a fresh PPG session, runs the statement,
 * and closes the session in `finally` — the canonical one-shot pattern for
 * stateless workloads (the driver uses WebSocket transport throughout — no
 * stateless HTTP path is exercised).
 *
 * `acquireConnection()` returns a `PpgServerlessSessionConnection` backed by
 * a long-lived `client.newSession()`, so callers that want a single PPG
 * session across multiple statements (e.g. for transactions) can route
 * through that surface.
 */
class PpgServerlessBoundDriverImpl extends PpgServerlessQueryable implements SqlDriver<PpgBinding> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly #client: Client;
  readonly #ownsClient: boolean;
  #closed = false;

  constructor(ppgClient: Client, ownsClient: boolean) {
    super();
    this.#client = ppgClient;
    this.#ownsClient = ownsClient;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  async connect(_binding: PpgBinding): Promise<void> {
    // The bound impl is constructed already-connected by
    // `createBoundDriverFromBinding`. The unbound wrapper is the public
    // entry point for `connect()`; reaching this method directly would be a
    // misuse.
    throw new Error(
      'driver-ppg-serverless: PpgServerlessBoundDriverImpl is constructed already-bound; call connect() on the unbound wrapper instead.',
    );
  }

  async acquireConnection(): Promise<SqlConnection> {
    if (this.#closed) {
      throw driverError('DRIVER.CLOSED', CLOSED_MESSAGE);
    }
    const session = await this.#client.newSession();
    return new PpgServerlessSessionConnection(session);
  }

  async close(): Promise<void> {
    // PPG's `Client` has no `close()` (only sessions do). For `{ kind: 'url' }`
    // bindings we drop our reference; for `{ kind: 'ppgClient' }` bindings the
    // caller retains ownership and we never had any to relinquish. Either way,
    // the visible effect is a state flip — the `#closed` flag short-circuits
    // future `acquireConnection` / `acquireSession` calls.
    //
    // Already-acquired SqlConnection / SqlTransaction instances are unaffected
    // by `close()`: their sessions live until the caller releases them.
    this.#closed = true;
  }

  protected override async acquireSession(): Promise<Session> {
    if (this.#closed) {
      throw driverError('DRIVER.CLOSED', CLOSED_MESSAGE);
    }
    return this.#client.newSession();
  }

  protected override async releaseSession(session: Session): Promise<void> {
    session.close();
  }

  /**
   * Used by the unbound wrapper's `close()` to decide whether to drop the
   * client reference. Exposed package-private; the field is not part of the
   * SqlDriver surface.
   */
  get ownsClient(): boolean {
    return this.#ownsClient;
  }
}

/**
 * Long-lived `SqlConnection` backed by a single PPG `Session`. All
 * `execute` / `query` / `executePrepared` calls route through the held
 * session for the connection's lifetime; `release()` and `destroy()` close
 * it. `beginTransaction()` issues `BEGIN` on the session and returns a
 * `PpgServerlessSessionTransaction` that shares the same session, so the
 * `BEGIN` / statements / `COMMIT` sequence stays on one PPG transport.
 */
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
    if (this.#released) {
      return;
    }
    this.#released = true;
    this.#session.close();
  }

  async destroy(_reason?: unknown): Promise<void> {
    if (this.#released) {
      return;
    }
    this.#released = true;
    // PPG's `Session.close()` is synchronous and has no "clean release" vs
    // "forced eviction" semantic difference (unlike pg-pool's truthy-arg
    // eviction signal). The `reason` argument is captured for symmetry with
    // the SqlConnection contract; it is advisory only — not rethrown, not
    // influencing teardown behaviour.
    this.#session.close();
  }
}

/**
 * `SqlTransaction` backed by the same PPG `Session` as the originating
 * connection. Inherits `execute` / `query` / `executePrepared` from the
 * abstract base and adds `commit` / `rollback`. The transaction does not
 * close the session itself — that remains the originating connection's
 * responsibility, so a caller can run further statements (or open another
 * transaction) on the same connection after `commit`/`rollback`.
 */
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

/**
 * Builds a bound driver instance from the binding the user passed to
 * `descriptor.create(...).connect(binding)`.
 *
 * Exported so the package's `./runtime` entry point can call it, and so the
 * facade layer can compose the bound impl with its own wrappers without
 * re-implementing binding resolution.
 */
export function createBoundDriverFromBinding(
  binding: PpgBinding,
  _options?: PpgServerlessDriverCreateOptions,
): PpgServerlessBoundDriverImpl {
  switch (binding.kind) {
    case 'url': {
      const ppgClient = client(defaultClientConfig(binding.url));
      return new PpgServerlessBoundDriverImpl(ppgClient, /* ownsClient */ true);
    }
    case 'ppgClient': {
      return new PpgServerlessBoundDriverImpl(binding.client, /* ownsClient */ false);
    }
  }
}

export type {
  PpgServerlessBoundDriverImpl,
  PpgServerlessSessionConnection,
  PpgServerlessSessionTransaction,
};
