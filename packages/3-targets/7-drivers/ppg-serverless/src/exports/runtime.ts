import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/framework-components/execution';
import type {
  PreparedExecuteRequest,
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
} from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { ppgServerlessDriverDescriptorMeta } from '../core/descriptor-meta';
import {
  createBoundDriverFromBinding,
  type PpgBinding,
  type PpgServerlessDriverCreateOptions,
} from '../ppg-driver';

export type PpgServerlessRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> &
  SqlDriver<PpgBinding>;

const USE_BEFORE_CONNECT_MESSAGE =
  'driver-ppg-serverless: driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'driver-ppg-serverless: driver already connected. Call close() before reconnecting with a new binding.';

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED';
  readonly category: 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const error = blindCast<
    DriverRuntimeError,
    'augmenting a fresh Error with code / category / severity / details properties below; the assertion only widens the in-construction value so Object.assign can populate the readonly fields without TS losing track of them'
  >(new Error(message));
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'RUNTIME' as const,
    severity: 'error' as const,
    message,
    details,
  });
}

function unboundExecute<Row>(): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Row>> {
          throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
        },
      };
    },
  };
}

/**
 * Public unbound wrapper. Constructed by `descriptor.create(options?)`.
 *
 * Lifecycle:
 *   unbound (no binding yet) → connect(binding) → connected (delegate held) →
 *   close() → closed.
 *
 * Reconnect after close is permitted, mirroring `@prisma-next/driver-postgres`.
 *
 * All `SqlQueryable` methods delegate to the bound impl when connected, and
 * throw `DRIVER.NOT_CONNECTED` otherwise.
 */
class PpgServerlessUnboundDriverImpl implements PpgServerlessRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  #delegate: SqlDriver<PpgBinding> | null = null;
  #closed = false;
  readonly #options: PpgServerlessDriverCreateOptions | undefined;

  constructor(options?: PpgServerlessDriverCreateOptions) {
    this.#options = options;
  }

  get state(): SqlDriverState {
    if (this.#delegate !== null) {
      return 'connected';
    }
    if (this.#closed) {
      return 'closed';
    }
    return 'unbound';
  }

  #requireDelegate(): SqlDriver<PpgBinding> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate;
  }

  async connect(binding: PpgBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#delegate = createBoundDriverFromBinding(binding, this.#options);
    this.#closed = false;
  }

  async acquireConnection(): Promise<SqlConnection> {
    // Routes to the bound impl, which throws a neutral "not implemented"
    // error. The wrapper exposes the seam now so that the surface a caller
    // sees today is the same surface they will see once long-lived sessions
    // are wired in — only the bound impl's body changes.
    const delegate = this.#requireDelegate();
    return delegate.acquireConnection();
  }

  async close(): Promise<void> {
    const delegate = this.#delegate;
    if (delegate !== null) {
      this.#delegate = null;
      await delegate.close();
    }
    this.#closed = true;
  }

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const delegate = this.#delegate;
    if (delegate === null) {
      return unboundExecute<Row>();
    }
    return delegate.execute<Row>(request);
  }

  executePrepared<Row = Record<string, unknown>>(
    request: PreparedExecuteRequest,
  ): AsyncIterable<Row> {
    const delegate = this.#delegate;
    if (delegate === null) {
      return unboundExecute<Row>();
    }
    return delegate.executePrepared<Row>(request);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const delegate = this.#requireDelegate();
    return delegate.query<Row>(sql, params);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const delegate = this.#requireDelegate();
    if (delegate.explain === undefined) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate.explain(request);
  }
}

const ppgServerlessRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PpgServerlessDriverCreateOptions,
  PpgServerlessRuntimeDriver
> = {
  ...ppgServerlessDriverDescriptorMeta,
  create(options?: PpgServerlessDriverCreateOptions): PpgServerlessRuntimeDriver {
    return new PpgServerlessUnboundDriverImpl(options);
  },
};

export default ppgServerlessRuntimeDriverDescriptor;
export type { PpgBinding, PpgServerlessDriverCreateOptions } from '../ppg-driver';
export { createBoundDriverFromBinding } from '../ppg-driver';
