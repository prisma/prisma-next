import type { Contract } from '@prisma-next/contract/types';
import type {
  ExecutionStackInstance,
  RuntimeDriverInstance,
} from '@prisma-next/framework-components/execution';
import {
  AsyncIterableResult,
  checkMiddlewareCompatibility,
  RuntimeCore,
  type RuntimeLog,
  runtimeError,
  runWithMiddleware,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  AnyQueryAst,
  CodecRegistry,
  LoweredStatement,
  SqlDriver,
  SqlQueryable,
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import type { RuntimeScope } from '@prisma-next/sql-relational-core/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { decodeRow } from './codecs/decoding';
import { encodeParams } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { computeSqlFingerprint } from './fingerprint';
import { lowerSqlPlan } from './lower-sql-plan';
import { parseContractMarkerRow } from './marker';
import { runBeforeCompileChain } from './middleware/before-compile-chain';
import type { SqlMiddleware, SqlMiddlewareContext } from './middleware/sql-middleware';
import type {
  RuntimeFamilyAdapter,
  RuntimeTelemetryEvent,
  RuntimeVerifyOptions,
  TelemetryOutcome,
} from './runtime-spi';
import type {
  ExecutionContext,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionInstance,
} from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';

export type Log = RuntimeLog;

export interface RuntimeOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verify: RuntimeVerifyOptions;
  readonly middleware?: readonly SqlMiddleware[];
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
  readonly middleware?: readonly SqlMiddleware[];
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

export interface RuntimeQueryable extends RuntimeScope {}

export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
}

export type { RuntimeTelemetryEvent, RuntimeVerifyOptions, TelemetryOutcome };

function isExecutionPlan(plan: SqlExecutionPlan | SqlQueryPlan): plan is SqlExecutionPlan {
  return 'sql' in plan;
}

class SqlRuntimeImpl<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>
  extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>
  implements Runtime
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  private readonly driver: SqlDriver<unknown>;
  private readonly familyAdapter: RuntimeFamilyAdapter<Contract<SqlStorage>>;
  private readonly codecRegistry: CodecRegistry;
  private readonly jsonSchemaValidators: JsonSchemaValidatorRegistry | undefined;
  private readonly sqlCtx: SqlMiddlewareContext;
  private readonly verify: RuntimeVerifyOptions;
  private codecRegistryValidated: boolean;
  private verified: boolean;
  private startupVerified: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, adapter, driver, verify, middleware, mode, log } = options;

    if (middleware) {
      for (const mw of middleware) {
        checkMiddlewareCompatibility(mw, 'sql', context.contract.target);
      }
    }

    const sqlCtx: SqlMiddlewareContext = {
      contract: context.contract,
      mode: mode ?? 'strict',
      now: () => Date.now(),
      log: log ?? {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    super({ middleware: middleware ?? [], ctx: sqlCtx });

    this.contract = context.contract;
    this.adapter = adapter;
    this.driver = driver;
    this.familyAdapter = new SqlFamilyAdapter(context.contract, adapter.profile);
    this.codecRegistry = context.codecs;
    this.jsonSchemaValidators = context.jsonSchemaValidators;
    this.sqlCtx = sqlCtx;
    this.verify = verify;
    this.codecRegistryValidated = false;
    this.verified = verify.mode === 'startup' ? false : verify.mode === 'always';
    this.startupVerified = false;
    this._telemetry = null;

    if (verify.mode === 'startup') {
      validateCodecRegistryCompleteness(this.codecRegistry, context.contract);
      this.codecRegistryValidated = true;
    }
  }

  /**
   * Lower a `SqlQueryPlan` (AST + meta) into a `SqlExecutionPlan` with
   * encoded parameters ready for the driver. This is the single point at
   * which params transition from app-layer values to driver wire-format.
   */
  protected override async lower(plan: SqlQueryPlan): Promise<SqlExecutionPlan> {
    const lowered = lowerSqlPlan(this.adapter, this.contract, plan);
    return Object.freeze({
      ...lowered,
      params: await encodeParams(lowered, this.codecRegistry),
    });
  }

  /**
   * Default driver invocation. Production execution paths override the
   * queryable target (e.g. transaction or connection) by going through
   * `executeAgainstQueryable`; this implementation supports any caller of
   * `super.execute(plan)` and the abstract-base contract.
   */
  protected override runDriver(exec: SqlExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.driver.execute<Record<string, unknown>>({
      sql: exec.sql,
      params: exec.params,
    });
  }

  /**
   * SQL pre-compile hook. Runs the registered middleware `beforeCompile`
   * chain over the plan's draft (AST + meta) and returns a `SqlQueryPlan`
   * with the rewritten AST when the chain mutates it.
   */
  protected override async runBeforeCompile(plan: SqlQueryPlan): Promise<SqlQueryPlan> {
    const rewrittenDraft = await runBeforeCompileChain(
      this.middleware,
      { ast: plan.ast, meta: plan.meta },
      this.sqlCtx,
    );
    return rewrittenDraft.ast === plan.ast ? plan : { ...plan, ast: rewrittenDraft.ast };
  }

  override execute<Row>(
    plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
  ): AsyncIterableResult<Row> {
    return this.executeAgainstQueryable<Row>(plan, this.driver);
  }

  private executeAgainstQueryable<Row>(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const exec: SqlExecutionPlan = isExecutionPlan(plan)
        ? Object.freeze({
            ...plan,
            params: await encodeParams(plan, self.codecRegistry),
          })
        : await self.lower(await self.runBeforeCompile(plan));

      self.familyAdapter.validatePlan(exec, self.contract);
      self._telemetry = null;

      if (!self.startupVerified && self.verify.mode === 'startup') {
        await self.verifyMarker();
      }

      if (!self.verified && self.verify.mode === 'onFirstUse') {
        await self.verifyMarker();
      }

      const startedAt = Date.now();
      let outcome: TelemetryOutcome | null = null;

      try {
        if (self.verify.mode === 'always') {
          await self.verifyMarker();
        }

        const stream = runWithMiddleware<SqlExecutionPlan, Record<string, unknown>>(
          exec,
          self.middleware,
          self.ctx,
          () =>
            queryable.execute<Record<string, unknown>>({
              sql: exec.sql,
              params: exec.params,
            }),
        );

        for await (const rawRow of stream) {
          const decodedRow = await decodeRow(
            rawRow,
            exec,
            self.codecRegistry,
            self.jsonSchemaValidators,
          );
          yield decodedRow as Row;
        }

        outcome = 'success';
      } catch (error) {
        outcome = 'runtime-error';
        throw error;
      } finally {
        if (outcome !== null) {
          self.recordTelemetry(exec, outcome, Date.now() - startedAt);
        }
      }
    };

    return new AsyncIterableResult(generator());
  }

  async connection(): Promise<RuntimeConnection> {
    const driverConn = await this.driver.acquireConnection();
    const self = this;

    const wrappedConnection: RuntimeConnection = {
      async transaction(): Promise<RuntimeTransaction> {
        const driverTx = await driverConn.beginTransaction();
        return self.wrapTransaction(driverTx);
      },
      async release(): Promise<void> {
        await driverConn.release();
      },
      async destroy(reason?: unknown): Promise<void> {
        await driverConn.destroy(reason);
      },
      execute<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable<Row>(plan, driverConn);
      },
    };

    return wrappedConnection;
  }

  private wrapTransaction(driverTx: SqlTransaction): RuntimeTransaction {
    const self = this;
    return {
      async commit(): Promise<void> {
        await driverTx.commit();
      },
      async rollback(): Promise<void> {
        await driverTx.rollback();
      },
      execute<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable<Row>(plan, driverTx);
      },
    };
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private ensureCodecRegistryValidated(): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecRegistry, this.contract);
      this.codecRegistryValidated = true;
    }
  }

  private async verifyMarker(): Promise<void> {
    if (this.verify.mode === 'always') {
      this.verified = false;
    }

    if (this.verified) {
      return;
    }

    const readStatement = this.familyAdapter.markerReader.readMarkerStatement();
    const result = await this.driver.query(readStatement.sql, readStatement.params);

    if (result.rows.length === 0) {
      if (this.verify.requireMarker) {
        throw runtimeError('CONTRACT.MARKER_MISSING', 'Contract marker not found in database');
      }

      this.verified = true;
      return;
    }

    const marker = parseContractMarkerRow(result.rows[0]);

    const contract = this.contract as {
      storage: { storageHash: string };
      execution?: { executionHash?: string | null };
      profileHash?: string | null;
    };

    if (marker.storageHash !== contract.storage.storageHash) {
      throw runtimeError(
        'CONTRACT.MARKER_MISMATCH',
        'Database storage hash does not match contract',
        {
          expected: contract.storage.storageHash,
          actual: marker.storageHash,
        },
      );
    }

    const expectedProfile = contract.profileHash ?? null;
    if (expectedProfile !== null && marker.profileHash !== expectedProfile) {
      throw runtimeError(
        'CONTRACT.MARKER_MISMATCH',
        'Database profile hash does not match contract',
        {
          expectedProfile,
          actualProfile: marker.profileHash,
        },
      );
    }

    this.verified = true;
    this.startupVerified = true;
  }

  private recordTelemetry(
    plan: SqlExecutionPlan,
    outcome: TelemetryOutcome,
    durationMs?: number,
  ): void {
    const contract = this.contract as { target: string };
    this._telemetry = Object.freeze({
      lane: plan.meta.lane,
      target: contract.target,
      fingerprint: computeSqlFingerprint(plan.sql),
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
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
    execute<Row>(
      plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
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
