import type { Client } from '@prisma/ppg';
import { client, defaultClientConfig } from '@prisma/ppg';
import type {
  PreparedExecuteRequest,
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlQueryResult,
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

const NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE =
  'driver-ppg-serverless: long-lived sessions are not yet implemented; this driver currently supports only top-level execute/query/executePrepared via one-shot sessions';

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_IMPLEMENTED' | 'DRIVER.CLOSED';
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

/**
 * Real bound `SqlDriver<PpgBinding>` implementation. Each `execute` / `query`
 * / `executePrepared` call opens a fresh PPG session, runs the statement,
 * and closes the session in `finally` — the canonical one-shot pattern for
 * stateless workloads (WebSocket transport per project decision D1).
 *
 * `acquireConnection()` throws a neutral "not implemented" error: long-lived
 * sessions and the transaction surface are wired in a later slice of this
 * project.
 */
class PpgServerlessBoundDriverImpl implements SqlDriver<PpgBinding> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly #client: Client;
  readonly #ownsClient: boolean;
  #closed = false;

  constructor(ppgClient: Client, ownsClient: boolean) {
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
    throw driverError('DRIVER.NOT_IMPLEMENTED', NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE);
  }

  async close(): Promise<void> {
    // PPG's `Client` has no `close()` (only sessions do). For `{ kind: 'url' }`
    // bindings we drop our reference; for `{ kind: 'ppgClient' }` bindings the
    // caller retains ownership and we never had any to relinquish. Either way,
    // the visible effect is a state flip.
    this.#closed = true;
  }

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    if (this.#closed) {
      return throwingAsyncIterable<Row>(driverError('DRIVER.CLOSED', CLOSED_MESSAGE));
    }
    return this.#executeStreaming<Row>(request.sql, request.params);
  }

  executePrepared<Row = Record<string, unknown>>(
    request: PreparedExecuteRequest,
  ): AsyncIterable<Row> {
    if (this.#closed) {
      return throwingAsyncIterable<Row>(driverError('DRIVER.CLOSED', CLOSED_MESSAGE));
    }
    // D2: the `handle` cache slot is accepted (the SPI requires it) but neither
    // read nor written. PPG has no per-driver prepared-statement registry to
    // attach to it; collapsing executePrepared into execute keeps the slice
    // surface tight.
    return this.#executeStreaming<Row>(request.sql, request.params);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    if (this.#closed) {
      throw driverError('DRIVER.CLOSED', CLOSED_MESSAGE);
    }
    const session = await this.#client.newSession();
    try {
      const resultset = await session.query(sql, ...(params ?? []));
      const ppgRows = await resultset.rows.collect();
      const rows = ppgRows.map((ppgRow) => mapRowToRecord<Row>(ppgRow, resultset.columns));
      return { rows, rowCount: rows.length };
    } catch (err) {
      throw normalizePpgError(err);
    } finally {
      session.close();
    }
  }

  async *#executeStreaming<Row>(
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const session = await this.#client.newSession();
    try {
      const resultset = await session.query(sql, ...(params ?? []));
      for await (const ppgRow of resultset.rows) {
        yield mapRowToRecord<Row>(ppgRow, resultset.columns);
      }
    } catch (err) {
      throw normalizePpgError(err);
    } finally {
      // `Session.close()` is synchronous in PPG (typed `void`, sync at
      // runtime — confirmed in `@prisma/ppg/dist/index.js`). Calling it in
      // `finally` after an `await` is well-defined and matches the
      // try/finally cleanup pattern that async-iterator consumers rely on
      // when calling `iterator.return()` early.
      session.close();
    }
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

function throwingAsyncIterable<Row>(error: Error): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Row>> {
          throw error;
        },
      };
    },
  };
}

/**
 * Builds a bound driver instance from the binding the user passed to
 * `descriptor.create(...).connect(binding)`.
 *
 * Exported so the package's `./runtime` entry point can call it, and so
 * future slices (long-lived sessions, transactions, facade integration) can
 * compose the bound impl with their own wrappers without re-implementing
 * binding resolution.
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

export type { PpgServerlessBoundDriverImpl };
