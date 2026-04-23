import type { Contract, ExecutionPlan } from '@prisma-next/contract/types';
import type {
  ExecutionStackInstance,
  RuntimeDriverInstance,
} from '@prisma-next/framework-components/execution';
import { checkMiddlewareCompatibility } from '@prisma-next/framework-components/runtime';
import type {
  Log,
  Middleware,
  RuntimeCore,
  RuntimeCoreOptions,
  RuntimeTelemetryEvent,
  RuntimeVerifyOptions,
  TelemetryOutcome,
} from '@prisma-next/runtime-executor';
import {
  AsyncIterableResult,
  createRuntimeCore,
  runtimeError,
} from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  AnyQueryAst,
  CodecRegistry,
  LoweredStatement,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { ifDefined } from '@prisma-next/utils/defined';
import { decodeRow } from './codecs/decoding';
import { encodeParams } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { lowerSqlPlan } from './lower-sql-plan';
import type {
  ExecutionContext,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionInstance,
} from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';

export interface RuntimeOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verify: RuntimeVerifyOptions;
  readonly middleware?: readonly Middleware<TContract>[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface CreateRuntimeOptions<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
  TTargetId extends string = string,
> {
  readonly stackInstance: ExecutionStackInstance<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    RuntimeDriverInstance<'sql', TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >;
  readonly context: ExecutionContext<TContract>;
  readonly driver: SqlDriver<unknown>;
  readonly verify: RuntimeVerifyOptions;
  readonly middleware?: readonly Middleware<TContract>[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface Runtime extends RuntimeQueryable {
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
}

export interface RuntimeConnection extends RuntimeQueryable {
  transaction(): Promise<RuntimeTransaction>;
  /**
   * Returns the connection to the pool for reuse. Only call this when the
   * connection is known to be in a clean state. If a transaction
   * commit/rollback failed or the connection is otherwise suspect, call
   * `destroy(reason)` instead.
   */
  release(): Promise<void>;
  /**
   * Evicts the connection so it is never reused. Call this when the
   * connection may be in an indeterminate state (e.g. a failed rollback
   * leaving an open transaction, or a broken socket).
   *
   * If teardown fails the error is propagated and the connection remains
   * retryable, so the caller can decide whether to swallow the failure or
   * retry cleanup. Calling destroy() or release() more than once after a
   * successful teardown is caller error.
   *
   * `reason` is advisory context only. It may be surfaced to driver-level
   * observability hooks (e.g. pg-pool's `'release'` event) but does not
   * influence eviction behavior and is not rethrown.
   */
  destroy(reason?: unknown): Promise<void>;
}

export interface RuntimeTransaction extends RuntimeQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface RuntimeQueryable {
  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row>;
}

export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
}

interface CoreQueryable {
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
}

export type { RuntimeTelemetryEvent, RuntimeVerifyOptions, TelemetryOutcome };

class SqlRuntimeImpl<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>
  implements Runtime
{
  private readonly core: RuntimeCore<TContract, SqlDriver<unknown>>;
  private readonly contract: TContract;
  private readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  private readonly codecRegistry: CodecRegistry;
  private readonly jsonSchemaValidators: JsonSchemaValidatorRegistry | undefined;
  private codecRegistryValidated: boolean;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, adapter, driver, verify, middleware, mode, log } = options;
    this.contract = context.contract;
    this.adapter = adapter;
    this.codecRegistry = context.codecs;
    this.jsonSchemaValidators = context.jsonSchemaValidators;
    this.codecRegistryValidated = false;

    if (middleware) {
      for (const mw of middleware) {
        checkMiddlewareCompatibility(mw, 'sql', context.contract.target);
      }
    }

    const familyAdapter = new SqlFamilyAdapter(context.contract, adapter.profile);

    const coreOptions: RuntimeCoreOptions<TContract, SqlDriver<unknown>> = {
      familyAdapter,
      driver,
      verify,
      ...ifDefined('middleware', middleware),
      ...ifDefined('mode', mode),
      ...ifDefined('log', log),
    };

    this.core = createRuntimeCore(coreOptions);

    if (verify.mode === 'startup') {
      validateCodecRegistryCompleteness(this.codecRegistry, context.contract);
      this.codecRegistryValidated = true;
    }
  }

  private ensureCodecRegistryValidated(contract: Contract<SqlStorage>): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecRegistry, contract);
      this.codecRegistryValidated = true;
    }
  }

  private toExecutionPlan<Row>(plan: ExecutionPlan<Row> | SqlQueryPlan<Row>): ExecutionPlan<Row> {
    const isSqlQueryPlan = (p: ExecutionPlan<Row> | SqlQueryPlan<Row>): p is SqlQueryPlan<Row> => {
      return 'ast' in p && !('sql' in p);
    };

    return isSqlQueryPlan(plan) ? lowerSqlPlan(this.adapter, this.contract, plan) : plan;
  }

  private executeAgainstQueryable<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
    queryable: CoreQueryable,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated(this.contract);
    const executablePlan = this.toExecutionPlan(plan);

    const iterator = async function* (
      self: SqlRuntimeImpl<TContract>,
    ): AsyncGenerator<Row, void, unknown> {
      const encodedParams = encodeParams(executablePlan, self.codecRegistry);
      const planWithEncodedParams: ExecutionPlan<Row> = {
        ...executablePlan,
        params: encodedParams,
      };

      const coreIterator = queryable.execute(planWithEncodedParams);

      for await (const rawRow of coreIterator) {
        const decodedRow = decodeRow(
          rawRow as Record<string, unknown>,
          executablePlan,
          self.codecRegistry,
          self.jsonSchemaValidators,
        );
        yield decodedRow as Row;
      }
    };

    return new AsyncIterableResult(iterator(this));
  }

  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row> {
    return this.executeAgainstQueryable(plan, this.core);
  }

  async connection(): Promise<RuntimeConnection> {
    const coreConn = await this.core.connection();
    const self = this;
    const wrappedConnection: RuntimeConnection = {
      async transaction(): Promise<RuntimeTransaction> {
        const coreTx = await coreConn.transaction();
        return {
          commit: coreTx.commit.bind(coreTx),
          rollback: coreTx.rollback.bind(coreTx),
          execute<Row = Record<string, unknown>>(
            plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
          ): AsyncIterableResult<Row> {
            return self.executeAgainstQueryable(plan, coreTx);
          },
        };
      },
      release: coreConn.release.bind(coreConn),
      destroy: coreConn.destroy.bind(coreConn),
      execute<Row = Record<string, unknown>>(
        plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable(plan, coreConn);
      },
    };
    return wrappedConnection;
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this.core.telemetry();
  }

  close(): Promise<void> {
    return this.core.close();
  }
}

function transactionClosedError(): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_CLOSED',
    'Cannot read from a query result after the transaction has ended. Await the result or call .toArray() inside the transaction callback.',
    {},
  );
}

export async function withTransaction<R>(
  runtime: Runtime,
  fn: (tx: TransactionContext) => PromiseLike<R>,
): Promise<R> {
  const connection = await runtime.connection();
  const transaction = await connection.transaction();

  let invalidated = false;
  const txContext: TransactionContext = {
    get invalidated() {
      return invalidated;
    },
    execute<Row = Record<string, unknown>>(
      plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
    ): AsyncIterableResult<Row> {
      if (invalidated) {
        throw transactionClosedError();
      }
      const inner = transaction.execute(plan);
      const guarded = async function* (): AsyncGenerator<Row, void, unknown> {
        for await (const row of inner) {
          if (invalidated) {
            throw transactionClosedError();
          }
          yield row;
        }
      };
      return new AsyncIterableResult(guarded());
    },
  };

  let connectionDisposed = false;
  const destroyConnection = async (reason: unknown): Promise<void> => {
    if (connectionDisposed) return;
    connectionDisposed = true;
    // SqlConnection.destroy() propagates teardown errors so callers can
    // decide what to do with them. Here, we're already about to throw a
    // more informative error describing why we're evicting the connection
    // (rollback/commit failure), so swallowing the teardown error is the
    // right call — surfacing it would mask the original cause.
    await connection.destroy(reason).catch(() => undefined);
  };

  try {
    let result: R;
    try {
      result = await fn(txContext);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        await destroyConnection(rollbackError);
        const wrapped = runtimeError(
          'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
          'Transaction rollback failed after callback error',
          { rollbackError },
        );
        wrapped.cause = error;
        throw wrapped;
      }
      throw error;
    } finally {
      invalidated = true;
    }

    try {
      await transaction.commit();
    } catch (commitError) {
      // After a failed COMMIT the server-side transaction may be: (a) already
      // committed (error on response path), (b) already rolled back (deferred
      // constraint / serialization failure), or (c) still open (COMMIT never
      // reached the server). Attempt a best-effort rollback to cover (c) and
      // confirm the protocol is healthy.
      //
      // If rollback succeeds, the server is definitely no longer in a
      // transaction (no-op in (a)/(b), real cleanup in (c)) and we've just
      // proved the connection round-trips correctly — it's safe to return
      // to the pool. If rollback fails, the connection state is ambiguous
      // (broken socket, protocol desync, etc.) and we must destroy it.
      try {
        await transaction.rollback();
      } catch {
        await destroyConnection(commitError);
      }
      const wrapped = runtimeError(
        'RUNTIME.TRANSACTION_COMMIT_FAILED',
        'Transaction commit failed',
        { commitError },
      );
      wrapped.cause = commitError;
      throw wrapped;
    }
    return result;
  } finally {
    if (!connectionDisposed) {
      await connection.release();
    }
  }
}

export function createRuntime<TContract extends Contract<SqlStorage>, TTargetId extends string>(
  options: CreateRuntimeOptions<TContract, TTargetId>,
): Runtime {
  const { stackInstance, context, driver, verify, middleware, mode, log } = options;

  return new SqlRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
    verify,
    ...ifDefined('middleware', middleware),
    ...ifDefined('mode', mode),
    ...ifDefined('log', log),
  });
}
