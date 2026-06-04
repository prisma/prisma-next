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
import { withArrayParsers } from './core/array-parsers';
import { mapRowToRecord } from './core/row-mapper';
import { normalizePpgError } from './normalize-error';

export type PpgBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'ppgClient'; readonly client: Client };

/**
 * Reserved for a future codec-customisation hook. `descriptor.create` keeps
 * its option-bag arity so adding a field later does not break callers.
 */
export type PpgServerlessDriverCreateOptions = {
  readonly _reservedForFutureCodecCustomisation?: never;
};

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
 * Shared substrate for the three queryable kinds (bound driver, long-lived
 * connection, transaction). Subclasses override `acquireSession` /
 * `releaseSession` to decide whether each call opens a fresh PPG session or
 * reuses a held one; the row-mapping + error-normalisation + iterator-cleanup
 * boilerplate lives here once.
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
    // PPG has no client-side PREPARE; params are still parameterised on the
    // wire. The SPI's `handle` cache slot is accepted but unused.
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
      await this.releaseSession(session);
    }
  }
}

/**
 * Bound `SqlDriver<PpgBinding>`. Top-level calls open a fresh WebSocket
 * session per call (PPG has no stateless HTTP path here); `acquireConnection`
 * returns a long-lived session callers can hold across statements + a
 * transaction.
 */
class PpgServerlessBoundDriverImpl extends PpgServerlessQueryable implements SqlDriver<PpgBinding> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly #client: Client;
  #closed = false;

  constructor(ppgClient: Client) {
    super();
    this.#client = ppgClient;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  async connect(_binding: PpgBinding): Promise<void> {
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
    // PPG's `Client` has no `.close()` — only sessions do. The state flip
    // short-circuits future `acquireConnection` / `acquireSession` calls;
    // already-acquired connections / transactions hold their own sessions
    // until the caller releases them.
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
}

/**
 * Long-lived `SqlConnection` over a single held PPG session. The transaction
 * subclass shares the same session so the `BEGIN` / statements / `COMMIT`
 * sequence stays on one transport.
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
    // PPG's `Session.close()` has no clean-release vs forced-eviction
    // distinction, so `destroy` and `release` are the same teardown.
    if (this.#released) {
      return;
    }
    this.#released = true;
    this.#session.close();
  }
}

/**
 * `SqlTransaction` sharing the connection's PPG session. Does not close the
 * session on `commit` / `rollback` — the connection is free to issue further
 * statements (or open another transaction) afterwards.
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

export function createBoundDriverFromBinding(
  binding: PpgBinding,
  _options?: PpgServerlessDriverCreateOptions,
): PpgServerlessBoundDriverImpl {
  switch (binding.kind) {
    case 'url': {
      // Framework adapter expects `text[]` etc. as JS arrays (matching `pg`'s
      // native hydration); PPG's `defaultClientConfig` parsers are scalar-only,
      // so extend before constructing. User-owned clients opt in via the
      // exported `withArrayParsers`.
      const config = defaultClientConfig(binding.url);
      const ppgClient = client({
        ...config,
        parsers: withArrayParsers(config.parsers ?? []),
      });
      return new PpgServerlessBoundDriverImpl(ppgClient);
    }
    case 'ppgClient': {
      return new PpgServerlessBoundDriverImpl(binding.client);
    }
  }
}

export type {
  PpgServerlessBoundDriverImpl,
  PpgServerlessSessionConnection,
  PpgServerlessSessionTransaction,
};
